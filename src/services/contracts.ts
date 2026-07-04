import { ContractStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { conflict, notFound } from "../lib/errors";
import { canTransition } from "../validation/transitions";
import { recordEvent } from "./events";
import { ContractPayload } from "../schemas/contract";
import { emitToOrg } from "../lib/socket";

export type ListParams = {
  status?: ContractStatus;
  clientName?: string;
  contractId?: string;
  page: number;
  pageSize: number;
};

// Org-scoped search with server-side filtering + pagination.
export async function listContracts(orgId: string, params: ListParams) {
  const where: Prisma.ContractWhereInput = { orgId };
  if (params.status) where.status = params.status;
  if (params.clientName) {
    where.clientName = { contains: params.clientName, mode: "insensitive" };
  }
  if (params.contractId) {
    // Partial match on id supports "search by contract ID".
    where.id = { contains: params.contractId, mode: "insensitive" };
  }

  const [data, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.contract.count({ where }),
  ]);

  return { data, total, page: params.page, pageSize: params.pageSize };
}

// Fetch a single contract, enforcing org ownership (404 if not in this org).
export async function getContract(orgId: string, id: string) {
  const contract = await prisma.contract.findFirst({ where: { id, orgId } });
  if (!contract) throw notFound("Contract not found");
  return contract;
}

export async function createContract(orgId: string, payload: ContractPayload) {
  const contract = await prisma.$transaction(async (tx) => {
    const c = await tx.contract.create({
      data: {
        orgId,
        clientName: payload.client_name,
        poRefNo: payload.po_ref_no,
        poDate: new Date(payload.po_date),
        status: "DRAFT",
        fieldData: payload as unknown as Prisma.InputJsonValue,
      },
    });
    await recordEvent(tx, {
      orgId,
      contractId: c.id,
      eventType: "CREATED",
      toStatus: "DRAFT",
      changes: { payload: payload as unknown as Prisma.InputJsonValue },
    });
    return c;
  });
  emitToOrg(orgId, "contract:created", { id: contract.id, status: contract.status });
  return contract;
}

// Update is only permitted while the contract is a DRAFT.
export async function updateContract(orgId: string, id: string, payload: ContractPayload) {
  const existing = await getContract(orgId, id);
  if (existing.status !== "DRAFT") {
    throw conflict("Only DRAFT contracts can be edited");
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.contract.update({
      where: { id },
      data: {
        clientName: payload.client_name,
        poRefNo: payload.po_ref_no,
        poDate: new Date(payload.po_date),
        fieldData: payload as unknown as Prisma.InputJsonValue,
      },
    });
    await recordEvent(tx, {
      orgId,
      contractId: id,
      eventType: "UPDATED",
      changes: {
        before: existing.fieldData as Prisma.InputJsonValue,
        after: payload as unknown as Prisma.InputJsonValue,
      },
    });
    return updated;
  });
}

// Enforce the DRAFT -> FINALIZED -> ARCHIVED workflow; invalid moves throw 409.
export async function changeStatus(orgId: string, id: string, to: ContractStatus) {
  const existing = await getContract(orgId, id);
  if (!canTransition(existing.status, to)) {
    throw conflict(`Invalid status transition: ${existing.status} -> ${to}`);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.contract.update({ where: { id }, data: { status: to } });
    await recordEvent(tx, {
      orgId,
      contractId: id,
      eventType: "STATUS_CHANGED",
      fromStatus: existing.status,
      toStatus: to,
    });
    return c;
  });
  emitToOrg(orgId, "contract:updated", { id: updated.id, status: updated.status });
  return updated;
}

// Delete is only permitted while the contract is a DRAFT.
export async function deleteContract(orgId: string, id: string) {
  const existing = await getContract(orgId, id);
  if (existing.status !== "DRAFT") {
    throw conflict("Only DRAFT contracts can be deleted");
  }
  await prisma.$transaction(async (tx) => {
    // Record the audit event first; SetNull on the FK preserves it after delete.
    await recordEvent(tx, {
      orgId,
      contractId: id,
      eventType: "DELETED",
      fromStatus: existing.status,
    });
    await tx.contract.delete({ where: { id } });
  });
  emitToOrg(orgId, "contract:deleted", { id });
}

export async function listEvents(orgId: string, id: string) {
  await getContract(orgId, id); // ensures the contract belongs to the org
  return prisma.contractEvent.findMany({
    where: { orgId, contractId: id },
    orderBy: { createdAt: "asc" },
  });
}

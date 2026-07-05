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
  // Soft-deleted contracts are hidden from the default listing.
  const where: Prisma.ContractWhereInput = { orgId, deletedAt: null };
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
// Soft-deleted contracts are treated as absent unless includeDeleted is set
// (e.g. so their audit trail stays viewable).
export async function getContract(orgId: string, id: string, includeDeleted = false) {
  const where: Prisma.ContractWhereInput = { id, orgId };
  if (!includeDeleted) where.deletedAt = null;
  const contract = await prisma.contract.findFirst({ where });
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
  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.contract.update({
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
    return c;
  });
  // Carry the full row so list tabs can patch just this contract in place
  // instead of refetching and rerendering the whole table.
  emitToOrg(orgId, "contract:updated", { id: updated.id, status: updated.status, contract: updated });
  return updated;
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
  emitToOrg(orgId, "contract:updated", { id: updated.id, status: updated.status, contract: updated });
  return updated;
}

// Soft delete: only permitted while the contract is a DRAFT. The row is retained
// with deletedAt set so the contract (and its audit trail) stays traceable in
// contract_events; getContract already treats a soft-deleted row as absent, so a
// repeat delete resolves to 404.
export async function deleteContract(orgId: string, id: string) {
  const existing = await getContract(orgId, id);
  if (existing.status !== "DRAFT") {
    throw conflict("Only DRAFT contracts can be deleted");
  }
  await prisma.$transaction(async (tx) => {
    // Move to the terminal DELETED status and stamp deletedAt; the row survives.
    await tx.contract.update({
      where: { id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    // Recorded as a real DRAFT -> DELETED transition (toStatus = DELETED). A
    // snapshot is retained and contractId is preserved (no SetNull fires), so the
    // deletion is fully traceable from contract_events.
    await recordEvent(tx, {
      orgId,
      contractId: id,
      eventType: "DELETED",
      fromStatus: existing.status,
      toStatus: "DELETED",
      changes: { snapshot: existing.fieldData as Prisma.InputJsonValue },
    });
  });
  emitToOrg(orgId, "contract:deleted", { id });
}

export async function listEvents(orgId: string, id: string) {
  // includeDeleted: a contract's audit history remains viewable after soft delete.
  await getContract(orgId, id, true); // ensures the contract belongs to the org
  return prisma.contractEvent.findMany({
    where: { orgId, contractId: id },
    orderBy: { createdAt: "asc" },
  });
}

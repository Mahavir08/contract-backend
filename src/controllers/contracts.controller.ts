import { Request, Response } from "express";
import { ContractStatus } from "@prisma/client";

// Route params for the /:id family; typing these keeps req.params.id a string
// now that standalone handlers no longer get per-route param inference.
type IdParams = { id: string };
import { badRequest } from "../lib/errors";
import { contractPayloadSchema, contractUpdateSchema, toFieldErrors } from "../schemas/contract";
import {
  changeStatus,
  createContract,
  deleteContract,
  getContract,
  listContracts,
  listEvents,
  updateContract,
} from "../services/contracts";

const STATUSES: ContractStatus[] = ["DRAFT", "FINALIZED", "ARCHIVED"];

function parseStatus(value: unknown): ContractStatus | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "string" && STATUSES.includes(value as ContractStatus)) {
    return value as ContractStatus;
  }
  throw badRequest(`Invalid status filter. Allowed: ${STATUSES.join(", ")}`);
}

function parseIntParam(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

// Controller: translates HTTP <-> the contracts service. Holds no business logic.
export const contractsController = {
  // GET /api/contracts — search, filter, paginate
  async list(req: Request, res: Response) {
    const result = await listContracts(req.orgId!, {
      status: parseStatus(req.query.status),
      clientName: typeof req.query.clientName === "string" ? req.query.clientName : undefined,
      contractId: typeof req.query.contractId === "string" ? req.query.contractId : undefined,
      page: parseIntParam(req.query.page, 1, 1, 1_000_000),
      pageSize: parseIntParam(req.query.pageSize, 20, 1, 100),
    });
    res.json(result);
  },

  // POST /api/contracts — upload + validate JSON
  async create(req: Request, res: Response) {
    const parsed = contractPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Contract validation failed", toFieldErrors(parsed.error));
    }
    const contract = await createContract(req.orgId!, parsed.data);
    res.status(201).json(contract);
  },

  // GET /api/contracts/:id — detail
  async get(req: Request<IdParams>, res: Response) {
    const contract = await getContract(req.orgId!, req.params.id);
    res.json(contract);
  },

  // PATCH /api/contracts/:id — edit (draft only)
  async update(req: Request<IdParams>, res: Response) {
    const parsed = contractUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Contract validation failed", toFieldErrors(parsed.error));
    }
    const updated = await updateContract(req.orgId!, req.params.id, parsed.data);
    res.json(updated);
  },

  // POST /api/contracts/:id/finalize — DRAFT -> FINALIZED
  async finalize(req: Request<IdParams>, res: Response) {
    const updated = await changeStatus(req.orgId!, req.params.id, "FINALIZED");
    res.json(updated);
  },

  // POST /api/contracts/:id/archive — FINALIZED -> ARCHIVED
  async archive(req: Request<IdParams>, res: Response) {
    const updated = await changeStatus(req.orgId!, req.params.id, "ARCHIVED");
    res.json(updated);
  },

  // DELETE /api/contracts/:id — soft delete (draft only)
  async remove(req: Request<IdParams>, res: Response) {
    await deleteContract(req.orgId!, req.params.id);
    res.status(204).send();
  },

  // GET /api/contracts/:id/events — audit history
  async events(req: Request<IdParams>, res: Response) {
    const events = await listEvents(req.orgId!, req.params.id);
    res.json(events);
  },
};

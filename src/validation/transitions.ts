import { ContractStatus } from "@prisma/client";

// Allowed forward-only status workflow: DRAFT -> FINALIZED -> ARCHIVED.
// DELETED is reached only via soft delete (see deleteContract), not changeStatus,
// and is terminal — nothing transitions out of it.
const ALLOWED: Record<ContractStatus, ContractStatus[]> = {
  DRAFT: ["FINALIZED"],
  FINALIZED: ["ARCHIVED"],
  ARCHIVED: [],
  DELETED: [],
};

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return ALLOWED[from].includes(to);
}

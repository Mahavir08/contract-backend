import { ContractStatus } from "@prisma/client";

// Allowed forward-only status workflow: DRAFT -> FINALIZED -> ARCHIVED.
const ALLOWED: Record<ContractStatus, ContractStatus[]> = {
  DRAFT: ["FINALIZED"],
  FINALIZED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return ALLOWED[from].includes(to);
}

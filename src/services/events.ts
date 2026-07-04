import { ContractStatus, EventType, Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

// Records an audit event. Always called inside the same transaction as the
// mutation it describes, so state and audit trail can never diverge.
export async function recordEvent(
  tx: Tx,
  input: {
    orgId: string;
    contractId: string | null;
    eventType: EventType;
    fromStatus?: ContractStatus | null;
    toStatus?: ContractStatus | null;
    changes?: Prisma.InputJsonValue;
  }
) {
  return tx.contractEvent.create({
    data: {
      orgId: input.orgId,
      contractId: input.contractId,
      eventType: input.eventType,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      changes: input.changes ?? Prisma.JsonNull,
    },
  });
}

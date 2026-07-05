-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'FINALIZED', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'DELETED');

-- CreateTable
CREATE TABLE "organisations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "poRefNo" TEXT NOT NULL,
    "poDate" DATE NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "fieldData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractId" TEXT,
    "eventType" "EventType" NOT NULL,
    "fromStatus" "ContractStatus",
    "toStatus" "ContractStatus",
    "changes" JSONB,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisations_slug_key" ON "organisations"("slug");

-- CreateIndex
CREATE INDEX "contracts_orgId_status_idx" ON "contracts"("orgId", "status");

-- CreateIndex
CREATE INDEX "contracts_orgId_clientName_idx" ON "contracts"("orgId", "clientName");

-- CreateIndex
CREATE INDEX "contracts_orgId_createdAt_idx" ON "contracts"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "contracts_orgId_deletedAt_idx" ON "contracts"("orgId", "deletedAt");

-- CreateIndex
CREATE INDEX "contract_events_orgId_idx" ON "contract_events"("orgId");

-- CreateIndex
CREATE INDEX "contract_events_contractId_createdAt_idx" ON "contract_events"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_contractId_idx" ON "attachments"("contractId");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

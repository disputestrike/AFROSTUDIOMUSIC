CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');
CREATE TYPE "BillingIntentKind" AS ENUM ('CREDIT_PACK', 'SUBSCRIPTION');
CREATE TYPE "BillingIntentStatus" AS ENUM ('CREATED', 'PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'CANCELED', 'FAILED');

ALTER TABLE "ProviderJob"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "chargeLedgerId" TEXT;

ALTER TABLE "CreditLedger"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "reversalOfId" TEXT;

CREATE TABLE "JobOutbox" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "providerJobId" TEXT NOT NULL,
  "queueName" TEXT NOT NULL,
  "jobName" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMPTZ(6),
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "JobOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingIntent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "kind" "BillingIntentKind" NOT NULL,
  "status" "BillingIntentStatus" NOT NULL DEFAULT 'CREATED',
  "plan" "Plan",
  "packKey" TEXT,
  "amountUsd" DECIMAL(12,2),
  "currency" CHAR(3),
  "creditsCents" INTEGER,
  "paypalOrderId" TEXT,
  "paypalSubscriptionId" TEXT,
  "approvalUrl" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BillingIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingEvent" (
  "id" TEXT NOT NULL,
  "paypalEventId" TEXT NOT NULL,
  "workspaceId" TEXT,
  "eventType" TEXT NOT NULL,
  "resourceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "errorCode" TEXT,
  "processedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderJob_chargeLedgerId_key" ON "ProviderJob"("chargeLedgerId");
CREATE UNIQUE INDEX "ProviderJob_workspaceId_kind_idempotencyKey_key" ON "ProviderJob"("workspaceId", "kind", "idempotencyKey");
CREATE UNIQUE INDEX "CreditLedger_reversalOfId_key" ON "CreditLedger"("reversalOfId");
CREATE UNIQUE INDEX "CreditLedger_workspaceId_idempotencyKey_key" ON "CreditLedger"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "JobOutbox_providerJobId_key" ON "JobOutbox"("providerJobId");
CREATE INDEX "JobOutbox_status_nextAttemptAt_idx" ON "JobOutbox"("status", "nextAttemptAt");
CREATE INDEX "JobOutbox_workspaceId_idx" ON "JobOutbox"("workspaceId");
CREATE UNIQUE INDEX "BillingIntent_paypalOrderId_key" ON "BillingIntent"("paypalOrderId");
CREATE UNIQUE INDEX "BillingIntent_paypalSubscriptionId_key" ON "BillingIntent"("paypalSubscriptionId");
CREATE UNIQUE INDEX "BillingIntent_workspaceId_kind_idempotencyKey_key" ON "BillingIntent"("workspaceId", "kind", "idempotencyKey");
CREATE INDEX "BillingIntent_workspaceId_createdAt_idx" ON "BillingIntent"("workspaceId", "createdAt" DESC);
CREATE UNIQUE INDEX "BillingEvent_paypalEventId_key" ON "BillingEvent"("paypalEventId");
CREATE INDEX "BillingEvent_workspaceId_createdAt_idx" ON "BillingEvent"("workspaceId", "createdAt" DESC);
CREATE INDEX "BillingEvent_status_createdAt_idx" ON "BillingEvent"("status", "createdAt");

ALTER TABLE "ProviderJob"
  ADD CONSTRAINT "ProviderJob_chargeLedgerId_fkey"
  FOREIGN KEY ("chargeLedgerId") REFERENCES "CreditLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CreditLedger"
  ADD CONSTRAINT "CreditLedger_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "CreditLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JobOutbox"
  ADD CONSTRAINT "JobOutbox_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "JobOutbox_providerJobId_fkey"
  FOREIGN KEY ("providerJobId") REFERENCES "ProviderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingIntent"
  ADD CONSTRAINT "BillingIntent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingEvent"
  ADD CONSTRAINT "BillingEvent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

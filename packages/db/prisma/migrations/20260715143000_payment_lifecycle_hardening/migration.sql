CREATE TYPE "BillingSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELED');
CREATE TYPE "BillingEntitlementKind" AS ENUM ('CREDIT_PACK', 'SUBSCRIPTION_CYCLE');
CREATE TYPE "BillingAdjustmentKind" AS ENUM ('REFUND', 'REVERSAL', 'DISPUTE');

ALTER TABLE "Release"
  ADD COLUMN "distributionStatusAt" TIMESTAMPTZ(6);

CREATE TABLE "BillingSubscription" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "billingIntentId" TEXT NOT NULL,
  "paypalSubscriptionId" TEXT NOT NULL,
  "plan" "Plan" NOT NULL,
  "status" "BillingSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
  "statusEventAt" TIMESTAMPTZ(6),
  "activatedAt" TIMESTAMPTZ(6),
  "endedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingEntitlement" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "billingIntentId" TEXT,
  "subscriptionId" TEXT,
  "kind" "BillingEntitlementKind" NOT NULL,
  "paypalTransactionId" TEXT NOT NULL,
  "grossAmountCents" INTEGER,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "creditsGranted" INTEGER NOT NULL,
  "grantLedgerId" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingEntitlement_positive_grant" CHECK ("creditsGranted" > 0),
  CONSTRAINT "BillingEntitlement_positive_gross" CHECK ("grossAmountCents" IS NULL OR "grossAmountCents" > 0)
);

CREATE TABLE "BillingAdjustment" (
  "id" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "paypalEventId" TEXT NOT NULL,
  "kind" "BillingAdjustmentKind" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceStatus" TEXT NOT NULL,
  "amountCents" INTEGER,
  "creditsAtRisk" INTEGER NOT NULL,
  "ledgerDelta" INTEGER NOT NULL DEFAULT 0,
  "ledgerId" TEXT,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingAdjustment_nonnegative_amount" CHECK ("amountCents" IS NULL OR "amountCents" >= 0),
  CONSTRAINT "BillingAdjustment_nonnegative_risk" CHECK ("creditsAtRisk" >= 0)
);

CREATE UNIQUE INDEX "BillingSubscription_billingIntentId_key" ON "BillingSubscription"("billingIntentId");
CREATE UNIQUE INDEX "BillingSubscription_paypalSubscriptionId_key" ON "BillingSubscription"("paypalSubscriptionId");
CREATE INDEX "BillingSubscription_workspaceId_status_statusEventAt_idx" ON "BillingSubscription"("workspaceId", "status", "statusEventAt" DESC);

CREATE UNIQUE INDEX "BillingEntitlement_paypalTransactionId_key" ON "BillingEntitlement"("paypalTransactionId");
CREATE UNIQUE INDEX "BillingEntitlement_grantLedgerId_key" ON "BillingEntitlement"("grantLedgerId");
CREATE INDEX "BillingEntitlement_workspaceId_occurredAt_idx" ON "BillingEntitlement"("workspaceId", "occurredAt" DESC);
CREATE INDEX "BillingEntitlement_subscriptionId_occurredAt_idx" ON "BillingEntitlement"("subscriptionId", "occurredAt" DESC);

CREATE UNIQUE INDEX "BillingAdjustment_ledgerId_key" ON "BillingAdjustment"("ledgerId");
CREATE UNIQUE INDEX "BillingAdjustment_paypalEventId_entitlementId_key" ON "BillingAdjustment"("paypalEventId", "entitlementId");
CREATE INDEX "BillingAdjustment_entitlementId_kind_sourceId_occurredAt_idx" ON "BillingAdjustment"("entitlementId", "kind", "sourceId", "occurredAt" DESC);

ALTER TABLE "BillingSubscription"
  ADD CONSTRAINT "BillingSubscription_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BillingSubscription_billingIntentId_fkey"
    FOREIGN KEY ("billingIntentId") REFERENCES "BillingIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingEntitlement"
  ADD CONSTRAINT "BillingEntitlement_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BillingEntitlement_billingIntentId_fkey"
    FOREIGN KEY ("billingIntentId") REFERENCES "BillingIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "BillingEntitlement_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "BillingSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "BillingEntitlement_grantLedgerId_fkey"
    FOREIGN KEY ("grantLedgerId") REFERENCES "CreditLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingAdjustment"
  ADD CONSTRAINT "BillingAdjustment_entitlementId_fkey"
    FOREIGN KEY ("entitlementId") REFERENCES "BillingEntitlement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BillingAdjustment_ledgerId_fkey"
    FOREIGN KEY ("ledgerId") REFERENCES "CreditLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "BillingSubscription" (
  "id",
  "workspaceId",
  "billingIntentId",
  "paypalSubscriptionId",
  "plan",
  "status",
  "statusEventAt",
  "activatedAt",
  "endedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'billing_subscription_' || bi."id",
  bi."workspaceId",
  bi."id",
  bi."paypalSubscriptionId",
  bi."plan",
  CASE
    WHEN bi."status"::text = 'CANCELED' THEN 'CANCELED'::"BillingSubscriptionStatus"
    WHEN bi."status"::text IN ('APPROVED', 'COMPLETED') THEN 'ACTIVE'::"BillingSubscriptionStatus"
    ELSE 'PENDING'::"BillingSubscriptionStatus"
  END,
  bi."updatedAt",
  CASE WHEN bi."status"::text IN ('APPROVED', 'COMPLETED') THEN COALESCE(bi."completedAt", bi."updatedAt") END,
  CASE WHEN bi."status"::text = 'CANCELED' THEN bi."updatedAt" END,
  bi."createdAt",
  bi."updatedAt"
FROM "BillingIntent" bi
WHERE bi."kind" = 'SUBSCRIPTION'
  AND bi."paypalSubscriptionId" IS NOT NULL
  AND bi."plan" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "BillingEntitlement" (
  "id",
  "workspaceId",
  "billingIntentId",
  "subscriptionId",
  "kind",
  "paypalTransactionId",
  "grossAmountCents",
  "currency",
  "creditsGranted",
  "grantLedgerId",
  "occurredAt",
  "createdAt"
)
SELECT
  'billing_entitlement_' || cl."id",
  cl."workspaceId",
  bi."id",
  NULL,
  'CREDIT_PACK'::"BillingEntitlementKind",
  cl."paypalEventId",
  ROUND(bi."amountUsd" * 100)::INTEGER,
  COALESCE(bi."currency", 'USD'),
  cl."delta",
  cl."id",
  cl."createdAt",
  cl."createdAt"
FROM "CreditLedger" cl
JOIN "BillingIntent" bi ON bi."id" = cl."meta"->>'billingIntentId'
WHERE cl."reason" = 'topup_paypal'
  AND cl."delta" > 0
  AND cl."paypalEventId" IS NOT NULL
  AND bi."amountUsd" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "BillingEntitlement" (
  "id",
  "workspaceId",
  "billingIntentId",
  "subscriptionId",
  "kind",
  "paypalTransactionId",
  "grossAmountCents",
  "currency",
  "creditsGranted",
  "grantLedgerId",
  "occurredAt",
  "createdAt"
)
SELECT
  'billing_entitlement_' || cl."id",
  cl."workspaceId",
  bs."billingIntentId",
  bs."id",
  'SUBSCRIPTION_CYCLE'::"BillingEntitlementKind",
  cl."meta"->>'saleId',
  NULL,
  'USD',
  cl."delta",
  cl."id",
  cl."createdAt",
  cl."createdAt"
FROM "CreditLedger" cl
JOIN "BillingSubscription" bs ON bs."paypalSubscriptionId" = cl."meta"->>'subscriptionId'
WHERE cl."reason" = 'paypal_subscription_cycle'
  AND cl."delta" > 0
  AND cl."meta"->>'saleId' IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE "Release" release
SET "distributionStatusAt" = latest."occurredAt"
FROM (
  SELECT "releaseId", MAX("occurredAt") AS "occurredAt"
  FROM "DistributionEvent"
  WHERE "applied" = TRUE
  GROUP BY "releaseId"
) latest
WHERE release."id" = latest."releaseId";

UPDATE "Release"
SET "distributionStatusAt" = "liveAt"
WHERE "distributionStatusAt" IS NULL
  AND "status" = 'live'
  AND "liveAt" IS NOT NULL;

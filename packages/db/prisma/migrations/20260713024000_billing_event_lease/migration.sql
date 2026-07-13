ALTER TABLE "BillingEvent"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "processingAt" TIMESTAMPTZ(6);

UPDATE "BillingEvent"
SET "processingAt" = "createdAt"
WHERE "status" = 'processing' AND "processingAt" IS NULL;

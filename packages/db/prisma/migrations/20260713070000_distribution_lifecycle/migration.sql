ALTER TABLE "Release"
  ADD COLUMN "submittedAt" TIMESTAMPTZ(6),
  ADD COLUMN "liveAt" TIMESTAMPTZ(6),
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Release"
SET
  "status" = 'legacy_unverified',
  "submittedAt" = COALESCE("submittedAt", "createdAt")
WHERE "status" = 'released';

UPDATE "Song" AS song
SET "status" = 'EXPORTED'
FROM "Release" AS release
WHERE release."songId" = song."id"
  AND release."status" = 'legacy_unverified'
  AND song."status" = 'RELEASED';

CREATE UNIQUE INDEX "Release_externalId_key" ON "Release"("externalId");

CREATE TABLE "DistributionEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "applied" BOOLEAN NOT NULL DEFAULT false,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DistributionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DistributionEvent_eventId_key"
  ON "DistributionEvent"("eventId");
CREATE INDEX "DistributionEvent_releaseId_occurredAt_idx"
  ON "DistributionEvent"("releaseId", "occurredAt");
CREATE INDEX "DistributionEvent_externalId_receivedAt_idx"
  ON "DistributionEvent"("externalId", "receivedAt");

ALTER TABLE "DistributionEvent"
  ADD CONSTRAINT "DistributionEvent_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "Release"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only job-event channel. This is the primitive that unblocks real
-- streaming/progress: the UI reads the event tail to show TRUE pipeline stages
-- (instead of a poll-loop counter) and to surface a playable instrumental bed
-- URL minutes before a sung render finishes. Deliberately NO foreign key to
-- "ProviderJob" so emitJobEvent stays fail-soft (it can never throw into a
-- render), and "seq" is a global SERIAL so a client can poll with ?since=<seq>.

CREATE TABLE "JobEvent" (
    "seq" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("seq")
);

-- Tail read: newest-for-job and since-cursor scans are both served by this one
-- composite index (jobId equality + seq range/order).
CREATE INDEX "JobEvent_jobId_seq_idx" ON "JobEvent"("jobId", "seq");

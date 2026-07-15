import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTerminalProviderJobStatus,
  refundRetryDelayMs,
} from "../src/lib/jobs.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const workerIndex = readFileSync(
  join(repo, "apps/worker/src/index.ts"),
  "utf8"
);
const workerJobs = readFileSync(
  join(repo, "apps/worker/src/lib/jobs.ts"),
  "utf8"
);
const orchestrationWorker = readFileSync(
  join(repo, "apps/api/src/lib/orchestration-worker.ts"),
  "utf8"
);

for (const status of ["SUCCEEDED", "FAILED", "CANCELED"]) {
  assert.equal(
    isTerminalProviderJobStatus(status),
    true,
    `${status} must short-circuit redelivery`
  );
}
for (const status of ["QUEUED", "RUNNING"]) {
  assert.equal(
    isTerminalProviderJobStatus(status),
    false,
    `${status} must remain executable`
  );
}

assert.equal(refundRetryDelayMs(1), 10_000);
assert.equal(refundRetryDelayMs(2), 20_000);
assert.equal(refundRetryDelayMs(8), 15 * 60_000);
assert.equal(refundRetryDelayMs(10_000), 15 * 60_000);
assert.ok(refundRetryDelayMs(3) > refundRetryDelayMs(2));

const managedAttempt = workerIndex.slice(
  workerIndex.indexOf("async function runManagedAttempt"),
  workerIndex.indexOf("function makeWorker")
);
const initialLookup = managedAttempt.indexOf("const initialState");
const terminalGuard = managedAttempt.indexOf(
  "isTerminalProviderJobStatus(initialState.status)"
);
const handlerInvocation = managedAttempt.indexOf("await handler()");
assert.ok(initialLookup >= 0, "managed jobs must load persisted state");
assert.ok(terminalGuard > initialLookup, "terminal guard must follow state lookup");
assert.ok(
  handlerInvocation > terminalGuard,
  "terminal guard must run before the provider handler"
);
assert.match(
  managedAttempt,
  /initialState\.status === ["']FAILED["'][\s\S]*refundFailedJob\(dbJobId\)/
);
assert.match(
  managedAttempt,
  /status:\s*\{\s*in:\s*\[["']FAILED["'],\s*["']QUEUED["']\]\s*\}/
);

assert.match(workerJobs, /prisma\.\$transaction\(async tx =>/);
assert.match(
  workerJobs,
  /status:\s*finalAttempt\s*\?\s*JobStatus\.FAILED\s*:\s*JobStatus\.QUEUED/
);
assert.match(workerJobs, /REFUND_OUTBOX_MARKER\s*=\s*["']refund_pending:/);
assert.match(
  workerJobs,
  /tx\.jobOutbox\.updateMany\([\s\S]*lastError:\s*`\$\{REFUND_OUTBOX_MARKER\}scheduled`/
);
assert.match(workerJobs, /retryPendingFailedJobRefunds/);
assert.match(workerIndex, /const refundRetryTimer = setInterval/);
assert.match(workerIndex, /clearInterval\(refundRetryTimer\)/);

const failureTransaction = orchestrationWorker.indexOf(
  "const failed = await prisma.$transaction"
);
const immediateRefund = orchestrationWorker.indexOf(
  "await refundWorkspaceCharge"
);
assert.ok(failureTransaction >= 0);
assert.ok(
  immediateRefund > failureTransaction,
  "refund obligation must commit before the immediate refund attempt"
);
assert.match(
  orchestrationWorker,
  /status:\s*args\.finalAttempt\s*\?\s*["']FAILED["']\s*:\s*["']QUEUED["']/
);
assert.match(
  orchestrationWorker,
  /if\s*\(isTerminalJobStatus\(owned\.status\)\)\s*return/g
);
assert.match(
  orchestrationWorker,
  /orchestration refund deferred for durable retry/
);
assert.doesNotMatch(orchestrationWorker, /material batch refund failed/);

console.log("job redelivery + durable refunds: PASS");

import assert from "node:assert/strict";
import creditCharge from "../dist/credit-charge.js";

const {
  DEFAULT_ORPHAN_CHARGE_AGE_MS,
  MAX_ORPHAN_CHARGE_BATCH_SIZE,
  MIN_ORPHAN_CHARGE_AGE_MS,
  QUEUE_BOUND_MEDIA_CREDIT_KEYS,
  QUEUE_BOUND_MEDIA_REFERENCE_TABLES,
  isOrphanQueueBoundMediaDebit,
  refundOrphanedQueueBoundMediaCharges,
  resolveOrphanQueueChargeRecoveryPolicy,
} = creditCharge;

const now = new Date("2026-07-15T12:00:00.000Z");
const policy = resolveOrphanQueueChargeRecoveryPolicy({
  now,
  batchSize: MAX_ORPHAN_CHARGE_BATCH_SIZE + 900,
});
assert.equal(
  policy.cutoff.toISOString(),
  new Date(now.getTime() - DEFAULT_ORPHAN_CHARGE_AGE_MS).toISOString()
);
assert.equal(policy.batchSize, MAX_ORPHAN_CHARGE_BATCH_SIZE);
assert.throws(
  () =>
    resolveOrphanQueueChargeRecoveryPolicy({
      now,
      minAgeMs: MIN_ORPHAN_CHARGE_AGE_MS - 1,
    }),
  /at least 15 minutes/
);

const cutoff = policy.cutoff;
const eligible = {
  delta: -25_000,
  reason: "beat_idea_short_30s",
  creditKey: "beat_idea_short_30s",
  refTable: "Song",
  refId: "song_1",
  createdAt: new Date(cutoff.getTime() - 1),
  chargedJob: null,
  reversal: null,
};

assert.equal(isOrphanQueueBoundMediaDebit(eligible, cutoff), true);
for (const creditKey of QUEUE_BOUND_MEDIA_CREDIT_KEYS) {
  assert.equal(
    isOrphanQueueBoundMediaDebit(
      { ...eligible, creditKey, reason: creditKey },
      cutoff
    ),
    true,
    creditKey
  );
}
for (const refTable of QUEUE_BOUND_MEDIA_REFERENCE_TABLES) {
  assert.equal(
    isOrphanQueueBoundMediaDebit({ ...eligible, refTable }, cutoff),
    true,
    refTable
  );
}

const excluded = [
  [
    "synchronous text",
    { ...eligible, creditKey: "lyrics_full", reason: "lyrics_full" },
  ],
  [
    "synchronous scoring",
    { ...eligible, creditKey: "hit_predict", reason: "hit_predict" },
  ],
  [
    "billing grant",
    {
      ...eligible,
      delta: 25_000,
      creditKey: null,
      reason: "subscription_grant",
      refTable: "Workspace",
    },
  ],
  ["recent charge", { ...eligible, createdAt: new Date(cutoff.getTime() + 1) }],
  ["attached job", { ...eligible, chargedJob: { id: "job_1" } }],
  ["existing reversal", { ...eligible, reversal: { id: "refund_charge_1" } }],
  ["ambiguous reference", { ...eligible, refTable: "BillingIntent" }],
  ["missing reference", { ...eligible, refId: "   " }],
  ["non-charge reason", { ...eligible, reason: "manual_adjustment" }],
];
for (const [name, candidate] of excluded) {
  assert.equal(isOrphanQueueBoundMediaDebit(candidate, cutoff), false, name);
}

const rows = [
  { ...eligible, id: "charge_eligible", workspaceId: "workspace_1" },
  ...excluded.map(([name, candidate], index) => ({
    ...candidate,
    id: "excluded_" + index,
    workspaceId: "workspace_" + name.replace(/s+/g, "_"),
  })),
];
let capturedTake = 0;
let balanceIncrements = 0;
let refundCreates = 0;

const tx = {
  $queryRaw: async () => [{ locked: 1 }],
  $queryRawUnsafe: async () => [{ id: "charge_eligible" }],
  workspace: {
    update: async () => {
      balanceIncrements += 1;
      return {};
    },
  },
  creditLedger: {
    findFirst: async args => {
      const row = rows.find(item => item.id === args.where.id);
      return row?.chargedJob || row?.reversal ? null : (row ?? null);
    },
    create: async args => {
      refundCreates += 1;
      const charge = rows.find(item => item.id === args.data.reversalOfId);
      if (!charge) throw new Error("charge missing");
      charge.reversal = { id: args.data.id };
      return { id: args.data.id };
    },
  },
};

const client = {
  creditLedger: {
    findMany: async args => {
      capturedTake = args.take;
      return rows;
    },
  },
  $transaction: async callback => callback(tx),
};

const first = await refundOrphanedQueueBoundMediaCharges(client, {
  internalMode: false,
  now,
  batchSize: 1_000,
});
assert.equal(capturedTake, MAX_ORPHAN_CHARGE_BATCH_SIZE);
assert.deepEqual(first.chargeIds, ["charge_eligible"]);
assert.equal(first.refunded, 1);
assert.equal(first.amount, 25_000);
assert.equal(balanceIncrements, 1);
assert.equal(refundCreates, 1);

const replay = await refundOrphanedQueueBoundMediaCharges(client, {
  internalMode: false,
  now,
});
assert.equal(replay.refunded, 0);
assert.equal(balanceIncrements, 1);
assert.equal(refundCreates, 1);

console.log("orphan charge recovery proof passed");

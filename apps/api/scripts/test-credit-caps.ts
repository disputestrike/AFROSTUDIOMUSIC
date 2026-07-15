import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chargeWorkspaceCredits, refundWorkspaceCharge, PrismaClient } from "@afrohit/db";
import { costOf } from "@afrohit/shared";

function assertTestDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const url = new URL(raw);
  const database = url.pathname.replace(/^\//, "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    (!database.endsWith("_ci") && !database.startsWith("afrohit_"))
  ) {
    throw new Error(
      "credit cap test refuses to run outside a local test database"
    );
  }
}

async function createWorkspace(
  prisma: PrismaClient,
  prefix: string,
  plan: "CREATOR" | "PRO" = "CREATOR"
) {
  const slug = `${prefix}-${randomUUID()}`;
  return prisma.workspace.create({
    data: {
      name: "Credit cap proof",
      slug,
      plan,
      creditsCents: 100_000_000,
    },
  });
}

async function main() {
  assertTestDatabase();
  const prisma = new PrismaClient();
  const workspaces: string[] = [];

  try {
    const internal = await createWorkspace(prisma, "credit-internal");
    workspaces.push(internal.id);
    const internalOptions = {
      workspaceId: internal.id,
      key: "full_song_demo" as const,
      multiplier: 2,
      internalMode: true,
      dailyCap: 2,
      monthlyCap: 10,
      now: new Date("2026-07-14T12:00:00.000Z"),
    };
    const concurrent = await Promise.all([
      chargeWorkspaceCredits(prisma, {
        ...internalOptions,
        idempotencyKey: "concurrent-a",
      }),
      chargeWorkspaceCredits(prisma, {
        ...internalOptions,
        idempotencyKey: "concurrent-b",
      }),
    ]);
    const accepted = concurrent.filter(result => result.ok);
    const refused = concurrent.filter(result => !result.ok);
    assert.equal(accepted.length, 1, "workspace lock must admit one charge");
    assert.equal(refused.length, 1, "workspace lock must refuse one charge");
    assert.equal(refused[0]!.ok ? null : refused[0]!.reason, "daily_cap");

    const successfulKey = concurrent[0]!.ok ? "concurrent-a" : "concurrent-b";
    const replay = await chargeWorkspaceCredits(prisma, {
      ...internalOptions,
      idempotencyKey: successfulKey,
    });
    assert.equal(replay.ok, true);
    if (!replay.ok) throw new Error("unreachable");
    assert.equal(replay.replayed, true, "replay must win before cap rejection");

    const acceptedCharge = accepted[0]!;
    if (!acceptedCharge.ok) throw new Error("unreachable");
    const row = await prisma.creditLedger.findUniqueOrThrow({
      where: { id: acceptedCharge.chargeId },
      select: { creditKey: true, units: true, planUnits: true },
    });
    assert.deepEqual(row, {
      creditKey: "full_song_demo",
      units: 2,
      planUnits: 2,
    });

    const refund = await refundWorkspaceCharge(prisma, {
      workspaceId: internal.id,
      chargeId: acceptedCharge.chargeId,
      internalMode: true,
      refTable: "ProviderJob",
      refId: "failed-owner-job",
    });
    assert.equal(refund.refunded, true);
    const duplicateRefund = await refundWorkspaceCharge(prisma, {
      workspaceId: internal.id,
      chargeId: acceptedCharge.chargeId,
      internalMode: true,
    });
    assert.equal(duplicateRefund.refunded, false, "refund must be idempotent");
    assert.equal(duplicateRefund.refundId, refund.refunded ? refund.refundId : undefined);
    const internalAfterRefund = await prisma.workspace.findUniqueOrThrow({
      where: { id: internal.id },
      select: { creditsCents: true },
    });
    assert.equal(
      internalAfterRefund.creditsCents,
      internal.creditsCents,
      "owner-mode refund restores cap units without minting balance"
    );
    const afterRefund = await chargeWorkspaceCredits(prisma, {
      ...internalOptions,
      idempotencyKey: "after-refund",
    });
    assert.equal(
      afterRefund.ok,
      true,
      "reversed charges must restore generation capacity"
    );

    const invalidConfig = await createWorkspace(prisma, "credit-invalid-cap");
    workspaces.push(invalidConfig.id);
    const invalidCapResult = await chargeWorkspaceCredits(prisma, {
      workspaceId: invalidConfig.id,
      key: "brief_polish",
      multiplier: 101,
      internalMode: true,
      dailyCap: Number.NaN,
      monthlyCap: 1_000,
      idempotencyKey: "invalid-cap",
      now: new Date("2026-07-14T12:00:00.000Z"),
    });
    assert.equal(invalidCapResult.ok, false);
    if (invalidCapResult.ok) throw new Error("unreachable");
    assert.equal(
      invalidCapResult.reason,
      "daily_cap",
      "invalid cap config must fall back closed"
    );

    const tenant = await createWorkspace(prisma, "credit-plan");
    workspaces.push(tenant.id);
    await prisma.creditLedger.create({
      data: {
        workspaceId: tenant.id,
        delta: -23 * costOf("full_song_demo"),
        reason: "full_song_demo",
        creditKey: "full_song_demo",
        units: 23,
        planUnits: 23,
      },
    });
    const planConcurrent = await Promise.all([
      chargeWorkspaceCredits(prisma, {
        workspaceId: tenant.id,
        key: "full_song_demo",
        internalMode: false,
        idempotencyKey: "plan-a",
      }),
      chargeWorkspaceCredits(prisma, {
        workspaceId: tenant.id,
        key: "full_song_demo",
        internalMode: false,
        idempotencyKey: "plan-b",
      }),
    ]);
    assert.equal(planConcurrent.filter(result => result.ok).length, 1);
    const planRefusal = planConcurrent.find(result => !result.ok);
    assert.ok(planRefusal && !planRefusal.ok);
    if (!planRefusal || planRefusal.ok) throw new Error("unreachable");
    assert.equal(planRefusal.reason, "plan_limit:monthlyDemoSongs");

    const videoTenant = await createWorkspace(prisma, "credit-video-plan");
    workspaces.push(videoTenant.id);
    await prisma.creditLedger.create({
      data: {
        workspaceId: videoTenant.id,
        delta: -costOf("video_20s"),
        reason: "video_20s",
        creditKey: "video_20s",
        units: 1,
        planUnits: 20,
      },
    });
    const videoAllowed = await chargeWorkspaceCredits(prisma, {
      workspaceId: videoTenant.id,
      key: "video_20s",
      planUnits: 16,
      internalMode: false,
      idempotencyKey: "video-allowed",
    });
    assert.equal(videoAllowed.ok, true);
    const videoRefused = await chargeWorkspaceCredits(prisma, {
      workspaceId: videoTenant.id,
      key: "video_8s",
      planUnits: 1,
      internalMode: false,
      idempotencyKey: "video-refused",
    });
    assert.equal(videoRefused.ok, false);
    if (videoRefused.ok) throw new Error("unreachable");
    assert.equal(videoRefused.reason, "plan_limit:monthlyVideoSeconds");

    console.log(
      "credit caps: concurrency, units, replay, refunds, config, and plan limits passed"
    );
  } finally {
    if (workspaces.length) {
      await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
    }
    await prisma.$disconnect();
  }
}

void main();

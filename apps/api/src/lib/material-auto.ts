import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "@afrohit/db";
import { getSoundDNA } from "@afrohit/ai";
import { laneMaterialNeeds } from "@afrohit/shared";
import { createQueuedProviderJob } from "./queued-job";
import {
  kitRolesFor,
  homeKeyFor,
  pickMaterial,
  materialCoverage,
  claudeArrangement,
  type MaterialRow,
  type MaterialPick,
} from "./material-plan";
import { loadLaneProfileForGenre } from "./lane-context";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForTerminalJobs(
  workspaceId: string,
  jobIds: string[],
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const jobs: Array<{
      id: string;
      status: string;
      outputJson: unknown;
      errorJson: unknown;
    }> = await prisma.providerJob.findMany({
      where: { id: { in: jobIds }, workspaceId },
      select: { id: true, status: true, outputJson: true, errorJson: true },
    });
    if (jobs.length !== jobIds.length)
      throw new Error("auto material child job missing or outside workspace");
    if (
      jobs.every(job =>
        ["SUCCEEDED", "FAILED", "CANCELED"].includes(job.status)
      )
    )
      return jobs;
    if (Date.now() >= deadline)
      throw new Error("auto material operation timed out");
    await sleep(10_000);
  }
}

function stableSeed(key: string): number {
  return (
    Number.parseInt(
      createHash("sha256").update(key).digest("hex").slice(0, 8),
      16
    ) % 100_000
  );
}

function loadShelf(workspaceId: string, genre: string): Promise<MaterialRow[]> {
  return prisma.materialAsset.findMany({
    where: { workspaceId, genre },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      url: true,
      role: true,
      bpm: true,
      keySignature: true,
      source: true,
      readiness: true,
      qualityState: true,
      rightsBasis: true,
      roleEvidence: true,
    },
  });
}

async function assembleFrom(
  app: FastifyInstance,
  workspaceId: string,
  projectId: string,
  genre: string,
  bpm: number,
  keySignature: string,
  vibe: string | undefined,
  songId: string | undefined,
  picks: MaterialPick[],
  operationKey: string,
  prepaid = false
): Promise<string> {
  const sections = await claudeArrangement(
    genre,
    bpm,
    picks.map(pick => pick.role),
    vibe
  );
  const idempotencyKey = `${operationKey}:assemble`;
  const charged = prepaid
    ? undefined
    : await app.chargeCredits({
        workspaceId,
        key: "beat_idea_short_30s",
        refTable: "Project",
        refId: projectId,
        idempotencyKey,
      });
  if (charged && !charged.ok)
    throw new Error(
      `auto material assembly refused: ${charged.reason ?? "insufficient credits"}`
    );
  const charge = charged?.ok ? charged : undefined;

  const job = await createQueuedProviderJob({
    app,
    queue: app.queues.music,
    jobName: "assemble-beat",
    workspaceId,
    projectId,
    kind: "music",
    provider: "material",
    inputJson: {
      assemble: true,
      prepaid,
      genre,
      bpm,
      keySignature,
      vibe,
      songId,
      picks: picks.map(pick => pick.role),
      sections,
    },
    charge,
    idempotencyKey,
    payload: jobId => ({
      jobId,
      workspaceId,
      projectId,
      songId,
      bpm,
      genre,
      picks,
      sections,
    }),
  });
  return job.jobId;
}

export interface AutoMaterialOpts {
  projectId: string;
  genre: string;
  bpm?: number;
  keySignature?: string;
  vibe?: string;
  songId?: string;
  operationKey?: string;
}

export interface FinishAutoMaterialPayload {
  jobId: string;
  workspaceId: string;
  operationKey: string;
  childJobIds: string[];
  options: Omit<AutoMaterialOpts, "operationKey"> & {
    bpm: number;
    keySignature: string;
    wantedRoles?: string[];
  };
}

/** Durable second half of an automatic material build. */
export async function finishAutoMaterialBeat(
  app: FastifyInstance,
  payload: FinishAutoMaterialPayload
) {
  const { workspaceId, options } = payload;
  const project = await prisma.project.findFirst({
    where: { id: options.projectId, workspaceId },
    select: { id: true },
  });
  if (!project)
    throw new Error("auto material project missing or outside workspace");
  if (options.songId) {
    const song = await prisma.song.findFirst({
      where: { id: options.songId, projectId: options.projectId, workspaceId },
      select: { id: true },
    });
    if (!song) throw new Error("auto material song missing or outside project");
  }

  if (payload.childJobIds.length) {
    await waitForTerminalJobs(workspaceId, payload.childJobIds, 15 * 60_000);
  }

  const shelf = await loadShelf(workspaceId, options.genre);
  const picks = pickMaterial(
    shelf,
    options.genre,
    options.bpm,
    options.keySignature,
    {
      varietySeed: stableSeed(payload.operationKey),
      roles: options.wantedRoles,
    }
  );
  const coverage = materialCoverage(picks);
  if (!picks.length) {
    // ZERO material is the only honest stop — there is nothing to assemble.
    throw new Error(
      "auto material build produced no usable material — forge loops for this genre first"
    );
  }
  if (!coverage.ready) {
    // NEVER-DIES LAW (last remaining hard-throw, audit 2026-07-19): a thin bed
    // ships sparse with an honest note instead of failing the whole build — the
    // child assembler (processAssembleBeat) already sparse-renders and the
    // parent gates were converted the same way. Only zero material stops.
    app.log.warn(
      { workspaceId, genre: options.genre, beds: coverage.beds, rhythm: coverage.rhythm, lowEnd: coverage.lowEnd, tonal: coverage.tonal },
      "[material-auto] sparse bed after forging — assembling anyway (never-dies)"
    );
  }

  const assemblyJobId = await assembleFrom(
    app,
    workspaceId,
    options.projectId,
    options.genre,
    options.bpm,
    options.keySignature,
    options.vibe,
    options.songId,
    picks,
    payload.operationKey,
    true
  );
  const [assembly] = await waitForTerminalJobs(
    workspaceId,
    [assemblyJobId],
    15 * 60_000
  );
  if (!assembly || assembly.status !== "SUCCEEDED") {
    const detail =
      (assembly?.errorJson as { message?: string } | null)?.message ??
      assembly?.status ??
      "missing";
    throw new Error(`auto material assembly failed (${detail})`);
  }
  const output = (assembly.outputJson ?? {}) as {
    beatId?: string;
    url?: string;
    laneAssessment?: unknown;
  };
  if (!output.beatId || !output.url)
    throw new Error("auto material assembly succeeded without a playable beat");
  return {
    assemblyJobId,
    beatId: output.beatId,
    url: output.url,
    laneAssessment: output.laneAssessment ?? null,
    roles: picks.map(pick => pick.role),
    bpm: options.bpm,
    keySignature: options.keySignature,
  };
}

async function queueAutoMaterialBundle(
  app: FastifyInstance,
  workspaceId: string,
  operationKey: string,
  missing: string[],
  options: FinishAutoMaterialPayload["options"]
) {
  // One reservation covers every missing loop plus the final assembly. The
  // parent orchestration owns the charge, so a completed beat is the billable
  // outcome rather than a half-stocked shelf after a mid-loop credit failure.
  const units = missing.length + 1;
  const charge = await app.chargeCredits({
    workspaceId,
    key: "beat_idea_short_30s",
    multiplier: units,
    refTable: "Project",
    refId: options.projectId,
    idempotencyKey: `${operationKey}:batch`,
  });
  if (!charge.ok) return { ok: false as const, charge };

  const replay = async () => {
    const existing = await prisma.providerJob.findUnique({
      where: { chargeLedgerId: charge.chargeId },
      select: { id: true, inputJson: true },
    });
    if (!existing) return null;
    const input = (existing.inputJson ?? {}) as {
      forging?: Array<{ role: string; jobId: string }>;
    };
    return { jobId: existing.id, forging: input.forging ?? [], replayed: true };
  };
  if (charge.replayed) {
    const existing = await replay();
    if (existing) return { ok: true as const, ...existing };
  }

  let created: {
    jobId: string;
    forging: Array<{
      role: string;
      jobId: string;
      payload: Record<string, unknown>;
      delayMs: number;
    }>;
    parentPayload: FinishAutoMaterialPayload;
  };
  try {
    created = await prisma.$transaction(async tx => {
      // delta <= 0: a $0 FREE receipt is a valid binding (own-engine free law).
      const ledger = await tx.creditLedger.findFirst({
        where: {
          id: charge.chargeId,
          workspaceId,
          delta: { lte: 0 },
          reversal: null,
        },
        select: { id: true },
      });
      if (!ledger)
        throw new Error(
          "auto material batch charge is missing or already reversed"
        );

      const forging: Array<{
        role: string;
        jobId: string;
        payload: Record<string, unknown>;
        delayMs: number;
      }> = [];
      for (let index = 0; index < missing.length; index += 1) {
        const role = missing[index]!;
        const idempotencyKey = `${operationKey}:forge:${role}`;
        const child = await tx.providerJob.create({
          data: {
            workspaceId,
            projectId: options.projectId,
            kind: "material",
            provider: "workspace-music",
            status: "QUEUED",
            inputJson: {
              genre: options.genre,
              role,
              bpm: options.bpm,
              keySignature: options.keySignature,
              prepaid: true,
            } as never,
            idempotencyKey,
          },
          select: { id: true },
        });
        const payload = {
          jobId: child.id,
          workspaceId,
          genre: options.genre,
          role,
          bpm: options.bpm,
          keySignature: options.keySignature,
        };
        const delayMs = index * 30_000;
        await tx.jobOutbox.create({
          data: {
            workspaceId,
            providerJobId: child.id,
            queueName: app.queues.music.name,
            jobName: "forge-material",
            payload: payload as never,
            ...(delayMs
              ? { nextAttemptAt: new Date(Date.now() + delayMs) }
              : {}),
          },
        });
        forging.push({ role, jobId: child.id, payload, delayMs });
      }

      const publicForging = forging.map(({ role, jobId }) => ({ role, jobId }));
      const parent = await tx.providerJob.create({
        data: {
          workspaceId,
          projectId: options.projectId,
          kind: "material-orchestration",
          provider: "internal",
          status: "QUEUED",
          chargeLedgerId: charge.chargeId,
          idempotencyKey: `${operationKey}:finish`,
          inputJson: {
            childJobIds: forging.map(item => item.jobId),
            forging: publicForging,
            options,
            prepaidUnits: units,
          } as never,
        },
        select: { id: true },
      });
      const parentPayload: FinishAutoMaterialPayload = {
        jobId: parent.id,
        workspaceId,
        operationKey,
        childJobIds: forging.map(item => item.jobId),
        options,
      };
      await tx.jobOutbox.create({
        data: {
          workspaceId,
          providerJobId: parent.id,
          queueName: app.queues.orchestration.name,
          jobName: "finish-auto-material",
          payload: parentPayload as never,
        },
      });
      return { jobId: parent.id, forging, parentPayload };
    });
  } catch (error) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await replay();
      if (existing) return { ok: true as const, ...existing };
      await sleep(50 * (attempt + 1));
    }
    if (!charge.replayed) {
      await app
        .refundCredits({
          workspaceId,
          key: "beat_idea_short_30s",
          refTable: "Project",
          refId: options.projectId,
          chargeId: charge.chargeId,
        })
        .catch(() => undefined);
    }
    throw error;
  }

  await app
    .dispatchPendingJobs()
    .catch(error =>
      app.log.warn(
        { err: error, jobId: created.jobId },
        "material bundle remains durable in outbox"
      )
    );

  return {
    ok: true as const,
    jobId: created.jobId,
    forging: created.forging.map(({ role, jobId }) => ({ role, jobId })),
    replayed: false,
  };
}

/**
 * Forge missing measured-lane roles and durably hand the follow-up assembly to
 * the orchestration queue. A process restart cannot lose the second half.
 */
export async function autoMaterialBeat(
  app: FastifyInstance,
  workspaceId: string,
  opts: AutoMaterialOpts
) {
  const project = await prisma.project.findFirst({
    where: { id: opts.projectId, workspaceId },
    select: { id: true },
  });
  if (!project)
    throw new Error("auto material project missing or outside workspace");
  if (opts.songId) {
    const song = await prisma.song.findFirst({
      where: { id: opts.songId, projectId: opts.projectId, workspaceId },
      select: { id: true },
    });
    if (!song) throw new Error("auto material song missing or outside project");
  }

  const operationKey = opts.operationKey ?? `material-auto:${randomUUID()}`;
  const bpm = opts.bpm ?? getSoundDNA(opts.genre)?.typicalBpm ?? 108;
  const keySignature = opts.keySignature ?? homeKeyFor(opts.genre);
  const profile = await loadLaneProfileForGenre(workspaceId, opts.genre);
  // Measured needs supplement the genre's real performance kit; they never
  // replace it with the old generic drums/bass/chords vocabulary.
  const measuredRoles = profile
    ? laneMaterialNeeds(profile).roles.map(role => role.role)
    : [];
  const wanted = [
    ...new Set([...kitRolesFor(opts.genre, 14), ...measuredRoles]),
  ];
  const materialSource = profile
    ? `profile-driven (${Object.keys(profile.features).length} measured features)`
    : "fallback-hardcoded (lane underprofiled: < 3 measured refs)";

  const shelf = await loadShelf(workspaceId, opts.genre);
  const picks = pickMaterial(shelf, opts.genre, bpm, keySignature, {
    varietySeed: stableSeed(operationKey),
    roles: wanted,
  });
  const have = new Set(picks.map(pick => pick.role));
  const missing = wanted.filter(role => !have.has(role));

  if (!missing.length && materialCoverage(picks).ready) {
    const jobId = await assembleFrom(
      app,
      workspaceId,
      opts.projectId,
      opts.genre,
      bpm,
      keySignature,
      opts.vibe,
      opts.songId,
      picks,
      operationKey
    );
    return {
      status: "assembling" as const,
      jobId,
      roles: picks.map(pick => pick.role),
      bpm,
      keySignature,
      materialSource,
    };
  }

  const options = {
    projectId: opts.projectId,
    genre: opts.genre,
    bpm,
    keySignature,
    vibe: opts.vibe,
    songId: opts.songId,
    wantedRoles: wanted,
  };
  const bundle = await queueAutoMaterialBundle(
    app,
    workspaceId,
    operationKey,
    missing,
    options
  );
  if (!bundle.ok) {
    return {
      status: "payment_required" as const,
      error: "insufficient_credits" as const,
      ...bundle.charge,
      bpm,
      keySignature,
      materialSource,
    };
  }

  return {
    status: "forging" as const,
    jobId: bundle.jobId,
    replayed: bundle.replayed,
    forging: bundle.forging,
    bpm,
    keySignature,
    materialSource,
    note: `AI is forging ${bundle.forging.length} missing ${opts.genre} role(s); the parent job turns green only after the final playable beat is verified.`,
  };
}

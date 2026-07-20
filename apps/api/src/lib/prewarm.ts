import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@afrohit/db';
import { getSoundDNA } from '@afrohit/ai';
import { laneMaterialNeeds } from '@afrohit/shared';
import {
  kitRolesFor,
  homeKeyFor,
  pickMaterial,
  materialCoverage,
  type MaterialRow,
} from './material-plan';
import { loadLaneProfileForGenre } from './lane-context';

/**
 * ANTICIPATORY LANE PRE-WARM — forge the lane's own-engine kit BEFORE the user
 * clicks Create, so the render skips the multi-minute forge floor and jumps
 * straight to assembly. This is a pure perceived-speed win and it is safe:
 *
 *  - $0-OWN-KIT ONLY: it enqueues the exact `forge-material` children a render
 *    would later need (kind 'material', the workspace's OWN connected engine).
 *    processForgeMaterial does NOT charge credits, and forged loops PERSIST
 *    per-lane on the shelf. It never touches a paid provider hook (Suno/MiniMax
 *    generate) — those are gated out here by construction.
 *  - IDEMPOTENT PER (workspace, genre, day): a stable prewarm marker job with a
 *    unique (workspaceId, kind, idempotencyKey) constraint means a chip that is
 *    hovered/tapped repeatedly can forge a given lane at most ONCE per UTC day.
 *  - FAIL-SOFT: any error degrades to a no-op — prewarm can never break a
 *    genre pick or a later create; the render still forges on demand.
 *  - ENGINE-GATED: with no workspace engine connected there is nothing to forge
 *    for free, so it no-ops (never enqueues doomed jobs, never spends).
 */

const MAX_PREWARM_ROLES = 10;

/** UTC-day idempotency key. Stable within a day; distinct across days/genres. */
export function prewarmIdempotencyKey(genre: string, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `prewarm:${normalizeGenre(genre)}:${day}`;
}

export function normalizeGenre(genre: string): string {
  return genre.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 40);
}

function stableSeed(key: string): number {
  return (
    Number.parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16) %
    100_000
  );
}

function loadShelf(workspaceId: string, genre: string): Promise<MaterialRow[]> {
  return prisma.materialAsset.findMany({
    where: { workspaceId, genre },
    orderBy: { createdAt: 'desc' },
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

export interface PrewarmPlan {
  wanted: string[];
  missing: string[];
  coverageReady: boolean;
}

/** PURE: which own-engine kit roles this lane still needs (given its shelf). */
export function computePrewarmPlan(
  shelf: MaterialRow[],
  genre: string,
  bpm: number,
  keySignature: string,
  measuredRoles: string[],
  operationKey: string
): PrewarmPlan {
  const wanted = [...new Set([...kitRolesFor(genre, 14), ...measuredRoles])];
  const picks = pickMaterial(shelf, genre, bpm, keySignature, {
    varietySeed: stableSeed(operationKey),
    roles: wanted,
  });
  const have = new Set(picks.map(pick => pick.role));
  const missing = wanted.filter(role => !have.has(role));
  return { wanted, missing, coverageReady: materialCoverage(picks).ready };
}

export type PrewarmResult =
  | { ok: true; warmed: 'already'; jobId: string }
  | { ok: true; warmed: 'ready'; jobId: string; roles: number }
  | { ok: true; warmed: 'forging'; jobId: string; forging: string[] }
  | { ok: true; warmed: false; reason: 'no_engine' | 'unknown_genre' }
  | { ok: false; warmed: false; reason: string };

/**
 * Warm one lane's own-engine kit. Idempotent per (workspace, genre, UTC day);
 * $0; never enqueues paid provider work.
 */
export async function prewarmLaneKit(
  app: FastifyInstance,
  workspaceId: string,
  genreInput: string
): Promise<PrewarmResult> {
  const genre = normalizeGenre(genreInput);
  if (!genre) return { ok: true, warmed: false, reason: 'unknown_genre' };
  const idempotencyKey = prewarmIdempotencyKey(genre);

  // Idempotency: one prewarm per lane per day. A repeated chip tap returns the
  // marker instead of forging (or spending) again.
  const existing = await prisma.providerJob.findFirst({
    where: { workspaceId, kind: 'prewarm', idempotencyKey },
    select: { id: true },
  });
  if (existing) return { ok: true, warmed: 'already', jobId: existing.id };

  // BUDGET GUARD: forging the $0 own kit needs the workspace's OWN engine. With
  // none connected there is nothing free to forge, so no-op (never enqueue a
  // doomed forge, never touch a paid provider). This is a pure optimization —
  // the render still forges on demand when the user actually creates.
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { musicProvider: true, musicApiKey: true },
  });
  if (!ws?.musicProvider || !ws.musicApiKey) {
    return { ok: true, warmed: false, reason: 'no_engine' };
  }

  const bpm = getSoundDNA(genre)?.typicalBpm ?? 108;
  const keySignature = homeKeyFor(genre);
  const profile = await loadLaneProfileForGenre(workspaceId, genre);
  const measuredRoles = profile
    ? laneMaterialNeeds(profile).roles.map(role => role.role)
    : [];
  const shelf = await loadShelf(workspaceId, genre);
  const plan = computePrewarmPlan(
    shelf,
    genre,
    bpm,
    keySignature,
    measuredRoles,
    idempotencyKey
  );

  // Already stocked: record the marker (so the day is idempotent) and stop.
  if (!plan.missing.length && plan.coverageReady) {
    const marker = await createPrewarmMarker(workspaceId, idempotencyKey, {
      warmed: 'ready',
      genre,
      missing: 0,
    });
    if (marker.replayed) return { ok: true, warmed: 'already', jobId: marker.jobId };
    return { ok: true, warmed: 'ready', jobId: marker.jobId, roles: plan.wanted.length };
  }

  // Bound provider spend per prewarm to a sane number of loops.
  const missing = plan.missing.slice(0, MAX_PREWARM_ROLES);

  let created: { jobId: string };
  try {
    created = await prisma.$transaction(async tx => {
    // The unique (workspaceId, kind, idempotencyKey) makes this the race gate.
    const marker = await tx.providerJob.create({
      data: {
        workspaceId,
        kind: 'prewarm',
        provider: 'internal',
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        idempotencyKey,
        inputJson: { genre, bpm, keySignature } as never,
        outputJson: { warmed: 'forging', genre, roles: missing } as never,
      },
      select: { id: true },
    });

    for (let index = 0; index < missing.length; index += 1) {
      const role = missing[index]!;
      const child = await tx.providerJob.create({
        data: {
          workspaceId,
          kind: 'material',
          provider: 'workspace-music',
          status: 'QUEUED',
          // prepaid: the own-kit forge path is $0 to the user; processForgeMaterial
          // performs no charge. This flag mirrors the auto-forge floor's contract.
          inputJson: { genre, role, bpm, keySignature, prepaid: true, prewarm: true } as never,
          idempotencyKey: `${idempotencyKey}:forge:${role}`,
        },
        select: { id: true },
      });
      await tx.jobOutbox.create({
        data: {
          workspaceId,
          providerJobId: child.id,
          queueName: app.queues.music.name,
          jobName: 'forge-material',
          payload: {
            jobId: child.id,
            workspaceId,
            genre,
            role,
            bpm,
            keySignature,
          } as never,
          // Stagger to respect the provider's low creation rate (observed ~6/min).
          ...(index ? { nextAttemptAt: new Date(Date.now() + index * 30_000) } : {}),
        },
      });
    }
    return { jobId: marker.id };
    });
  } catch (err) {
    // Concurrent double-fire lost the unique race: the other call is already
    // forging this lane today — return its marker as idempotent.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const other = await prisma.providerJob.findFirst({
        where: { workspaceId, kind: 'prewarm', idempotencyKey },
        select: { id: true },
      });
      if (other) return { ok: true, warmed: 'already', jobId: other.id };
    }
    throw err;
  }

  // Best-effort kick; anything still PENDING is replayed by the outbox loop.
  await app
    .dispatchPendingJobs()
    .catch(err =>
      app.log.warn({ err, jobId: created.jobId }, 'prewarm forges remain durable in outbox')
    );

  return { ok: true, warmed: 'forging', jobId: created.jobId, forging: missing };
}

async function createPrewarmMarker(
  workspaceId: string,
  idempotencyKey: string,
  output: Record<string, unknown>
): Promise<{ jobId: string; replayed: boolean }> {
  try {
    const marker = await prisma.providerJob.create({
      data: {
        workspaceId,
        kind: 'prewarm',
        provider: 'internal',
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        idempotencyKey,
        inputJson: { prewarm: true } as never,
        outputJson: output as never,
      },
      select: { id: true },
    });
    return { jobId: marker.id, replayed: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.providerJob.findFirst({
        where: { workspaceId, kind: 'prewarm', idempotencyKey },
        select: { id: true },
      });
      if (existing) return { jobId: existing.id, replayed: true };
    }
    throw err;
  }
}

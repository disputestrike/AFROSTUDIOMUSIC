import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { getSoundDNA } from '@afrohit/ai';
import { laneMaterialNeeds } from '@afrohit/shared';
import { createQueuedProviderJob } from './queued-job';
import { kitRolesFor, homeKeyFor, pickMaterial, materialCoverage, claudeArrangement, type MaterialRow, type MaterialPick } from './material-plan';
import { loadLaneProfileForGenre } from './lane-context';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stableSeed(key: string): number {
  return Number.parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16) % 100_000;
}

function loadShelf(workspaceId: string, genre: string): Promise<MaterialRow[]> {
  return prisma.materialAsset.findMany({
    where: { workspaceId, genre },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, url: true, role: true, bpm: true, keySignature: true, source: true,
      readiness: true, qualityState: true, rightsBasis: true, roleEvidence: true,
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
  operationKey: string
): Promise<string> {
  const sections = await claudeArrangement(genre, bpm, picks.map((pick) => pick.role), vibe);
  const idempotencyKey = `${operationKey}:assemble`;
  const charge = await app.chargeCredits({
    workspaceId,
    key: 'beat_idea_short_30s',
    refTable: 'Project',
    refId: projectId,
    idempotencyKey,
  });
  if (!charge.ok) throw new Error(`auto material assembly refused: ${charge.reason ?? 'insufficient credits'}`);

  const job = await createQueuedProviderJob({
    app,
    queue: app.queues.music,
    jobName: 'assemble-beat',
    workspaceId,
    projectId,
    kind: 'music',
    provider: 'material',
    inputJson: { assemble: true, genre, bpm, keySignature, vibe, songId, picks: picks.map((pick) => pick.role), sections },
    charge,
    idempotencyKey,
    payload: (jobId) => ({ jobId, workspaceId, projectId, songId, bpm, genre, picks, sections }),
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
  options: Omit<AutoMaterialOpts, 'operationKey'> & { bpm: number; keySignature: string; wantedRoles?: string[] };
}

/** Durable second half of an automatic material build. */
export async function finishAutoMaterialBeat(app: FastifyInstance, payload: FinishAutoMaterialPayload) {
  const { workspaceId, options } = payload;
  const project = await prisma.project.findFirst({ where: { id: options.projectId, workspaceId }, select: { id: true } });
  if (!project) throw new Error('auto material project missing or outside workspace');
  if (options.songId) {
    const song = await prisma.song.findFirst({ where: { id: options.songId, projectId: options.projectId, workspaceId }, select: { id: true } });
    if (!song) throw new Error('auto material song missing or outside project');
  }

  const deadline = Date.now() + 15 * 60_000;
  while (payload.childJobIds.length) {
    const children = await prisma.providerJob.findMany({
      where: { id: { in: payload.childJobIds }, workspaceId },
      select: { id: true, status: true },
    });
    if (children.length !== payload.childJobIds.length) throw new Error('auto material child job missing or outside workspace');
    if (children.every((child: { status: string }) => child.status === 'SUCCEEDED' || child.status === 'FAILED' || child.status === 'CANCELED')) break;
    if (Date.now() >= deadline) throw new Error('auto material forge timed out');
    await sleep(10_000);
  }

  const shelf = await loadShelf(workspaceId, options.genre);
  const picks = pickMaterial(shelf, options.genre, options.bpm, options.keySignature, {
    varietySeed: stableSeed(payload.operationKey),
    roles: options.wantedRoles,
  });
  const coverage = materialCoverage(picks);
  if (!coverage.ready) {
    throw new Error(`auto material build is incomplete after forging (beds=${coverage.beds}, rhythm=${coverage.rhythm}, low-end=${coverage.lowEnd}, tonal=${coverage.tonal})`);
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
    payload.operationKey
  );
  return { assemblyJobId, roles: picks.map((pick) => pick.role), bpm: options.bpm, keySignature: options.keySignature };
}

/**
 * Forge missing measured-lane roles and durably hand the follow-up assembly to
 * the orchestration queue. A process restart cannot lose the second half.
 */
export async function autoMaterialBeat(app: FastifyInstance, workspaceId: string, opts: AutoMaterialOpts) {
  const project = await prisma.project.findFirst({ where: { id: opts.projectId, workspaceId }, select: { id: true } });
  if (!project) throw new Error('auto material project missing or outside workspace');
  if (opts.songId) {
    const song = await prisma.song.findFirst({ where: { id: opts.songId, projectId: opts.projectId, workspaceId }, select: { id: true } });
    if (!song) throw new Error('auto material song missing or outside project');
  }

  const operationKey = opts.operationKey ?? `material-auto:${randomUUID()}`;
  const bpm = opts.bpm ?? getSoundDNA(opts.genre)?.typicalBpm ?? 108;
  const keySignature = opts.keySignature ?? homeKeyFor(opts.genre);
  const profile = await loadLaneProfileForGenre(workspaceId, opts.genre);
  // Measured needs supplement the genre's real performance kit; they never
  // replace it with the old generic drums/bass/chords vocabulary.
  const measuredRoles = profile ? laneMaterialNeeds(profile).roles.map((role) => role.role) : [];
  const wanted = [...new Set([...kitRolesFor(opts.genre, 14), ...measuredRoles])];
  const materialSource = profile
    ? `profile-driven (${Object.keys(profile.features).length} measured features)`
    : 'fallback-hardcoded (lane underprofiled: < 3 measured refs)';

  const shelf = await loadShelf(workspaceId, opts.genre);
  const picks = pickMaterial(shelf, opts.genre, bpm, keySignature, { varietySeed: stableSeed(operationKey), roles: wanted });
  const have = new Set(picks.map((pick) => pick.role));
  const missing = wanted.filter((role) => !have.has(role));

  if (!missing.length && materialCoverage(picks).ready) {
    const jobId = await assembleFrom(app, workspaceId, opts.projectId, opts.genre, bpm, keySignature, opts.vibe, opts.songId, picks, operationKey);
    return { status: 'assembling' as const, jobId, roles: picks.map((pick) => pick.role), bpm, keySignature, materialSource };
  }

  const forging: Array<{ role: string; jobId: string }> = [];
  for (let index = 0; index < missing.length; index += 1) {
    const role = missing[index]!;
    const idempotencyKey = `${operationKey}:forge:${role}`;
    const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s', refTable: 'Project', refId: opts.projectId, idempotencyKey });
    if (!charge.ok) break;
    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.music,
      jobName: 'forge-material',
      workspaceId,
      projectId: opts.projectId,
      kind: 'material',
      provider: 'workspace-music',
      inputJson: { genre: opts.genre, role, bpm, keySignature },
      charge,
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId, genre: opts.genre, role, bpm, keySignature }),
      delayMs: index * 30_000,
    });
    forging.push({ role, jobId: job.jobId });
  }

  const options = { projectId: opts.projectId, genre: opts.genre, bpm, keySignature, vibe: opts.vibe, songId: opts.songId, wantedRoles: wanted };
  const orchestration = await createQueuedProviderJob({
    app,
    queue: app.queues.orchestration,
    jobName: 'finish-auto-material',
    workspaceId,
    projectId: opts.projectId,
    kind: 'material-orchestration',
    provider: 'internal',
    inputJson: { childJobIds: forging.map((item) => item.jobId), options },
    idempotencyKey: `${operationKey}:finish`,
    payload: (jobId) => ({ jobId, workspaceId, operationKey, childJobIds: forging.map((item) => item.jobId), options }),
  });

  return {
    status: 'forging' as const,
    jobId: orchestration.jobId,
    forging,
    bpm,
    keySignature,
    materialSource,
    note: `AI is forging ${forging.length} missing ${opts.genre} role(s); durable orchestration will assemble the beat when they finish.`,
  };
}

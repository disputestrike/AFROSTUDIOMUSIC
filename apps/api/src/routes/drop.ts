import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { runWithBrainContext, brainRunCosts } from '@afrohit/ai';
import { dropBatchSchema, requestedMaterialRoleContract } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { runChatTool } from '../services/chat-tools';
import { BLOW_TARGET, willItBlowGate } from '../lib/will-it-blow';
import { createQueuedProviderJob } from '../lib/queued-job';
import { emitJobEvent } from '../lib/job-events';

/**
 * The Drop Machine — batch song factory.
 *
 * From one theme, run the full pipeline N times (hooks → A&R picks the best →
 * lyrics → full sung song with the ad-lib arranger), then return a shortlist
 * ranked by the A&R hook score. Audio renders in the background; the daily cost
 * cap still applies so a big batch can never overrun. Turns you from
 * button-presser into curator.
 */
export default async function drop(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: dropBatchSchema } },
    async (req, reply) => {
      const { workspaceId, userId } = requireAuth(req);
      let input = dropBatchSchema.parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

      // OWN-ENGINE PRE-FLIGHT — pure, before any LLM spend. OWNER DOCTRINE
      // (2026-07-19, live 422 on "steel pan"): Our Engine is the DEFAULT — it
      // never dead-ends a create over an instrument it cannot prove. The
      // unprovable instruments are STRIPPED from the ask and the create
      // proceeds; the disclosure rides the response + the job record so the
      // artist knows exactly what was left out (honesty, not a wall).
      let droppedInstruments: string[] = [];
      if (input.songEngine === 'own' && input.instruments?.length) {
        const roleRequest = requestedMaterialRoleContract(input.instruments);
        if (roleRequest.unsupportedInstruments.length) {
          const unsupported = new Set(roleRequest.unsupportedInstruments.map((name) => name.toLowerCase()));
          droppedInstruments = roleRequest.unsupportedInstruments;
          input = { ...input, instruments: input.instruments.filter((name) => !unsupported.has(name.toLowerCase())) };
        }
      }

      // IDEMPOTENT START: the client retries a network-dead POST (redeploy
      // window) with the SAME Idempotency-Key — a duplicate key returns the
      // drop already running instead of double-creating (and double-charging).
      const rawIdem = req.headers['idempotency-key'];
      const idem = typeof rawIdem === 'string' && rawIdem.trim() ? rawIdem.trim() : undefined;
      if (idem && idem.length > 128) return reply.code(400).send({ error: 'invalid_idempotency_key' });
      if (idem) {
        const existing = await prisma.providerJob.findFirst({
          where: { workspaceId, kind: 'drop', idempotencyKey: idem },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          reply.code(202);
          return { jobId: existing.id, status: 'queued', theme: input.theme };
        }
      }

      // The request returns immediately, while BullMQ owns execution and retry.
      // A restart releases the queue lock instead of losing an in-process promise.
      const dropJob = await createQueuedProviderJob({
        app,
        queue: app.queues.orchestration,
        jobName: 'run-drop',
        workspaceId,
        projectId: project.id,
        kind: 'drop',
        provider: 'internal',
        inputJson: {
          ...input,
          ...(idem ? { _idem: idem } : {}),
          ...(droppedInstruments.length ? { _droppedInstruments: droppedInstruments } : {}),
        },
        idempotencyKey: idem,
        payload: (jobId) => ({ jobId, workspaceId, userId, projectId: project.id, input }),
      });

      reply.code(202);
      return {
        jobId: dropJob.jobId,
        status: 'queued',
        theme: input.theme,
        replayed: dropJob.replayed,
        ...(droppedInstruments.length
          ? { instrumentNote: `Our Engine has no proven material for: ${droppedInstruments.join(', ')} — rendering without ${droppedInstruments.length === 1 ? 'it' : 'them'}. Upload or forge that material and it joins future renders.` }
          : {}),
      };
    }
  );
}

export type DropCtx = { app: FastifyInstance; workspaceId: string; userId: string; projectId: string };
export type DropInput = ReturnType<typeof dropBatchSchema.parse>;

type DropTake = {
  songId?: string;
  hookId?: string;
  hookText?: string;
  title?: string;
  score: number | null;
  jobId?: string;
  error?: string;
  /** Honest engine disclosure (e.g. own engine: "instrumental bed — add vocals
   *  by upload or re-sing"), carried into the drop's outputJson. */
  note?: string;
};

export type DropChildJob = {
  id: string;
  status: string;
  idempotencyKey: string | null;
  inputJson: unknown;
  outputJson: unknown;
  errorJson: unknown;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type PersistedPlayable = {
  assetType: 'beat' | 'mix' | 'master';
  id: string;
  projectId: string;
  songId: string | null;
  url: string;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: Date | null;
  approved: boolean;
  createdAt: Date;
  meta: unknown;
};

export type DropQualityGateEvidence = {
  /** true only when the hit-read cleared the certification bar. */
  passed: boolean;
  willBlow: boolean;
  bestScore: number;
  passes: number;
  target: number;
  receiptJobId?: string;
};

export type DropPlayableOutput = {
  songId: string;
  projectId: string;
  initialChildJobId: string;
  childJobId: string;
  assetType: PersistedPlayable['assetType'];
  assetId: string;
  url: string;
  contentHash: string;
  verifiedAt: string;
  qualityState: 'passed';
  approved: true;
  /** true = cleared the hit-read certification bar; false = delivered honestly
   *  below the bar (playable, owned, NOT release-certified). A paid create must
   *  never end in nothing — the live failure this fixes: EVERY drop died at a
   *  90-point wall after hooks+lyrics+render all succeeded (measured 62 vs 90). */
  certified: boolean;
  qualityGate: DropQualityGateEvidence;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 240);
  const message = record(value)?.message;
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 240) : undefined;
}

/** Pure terminal-state policy used by the poller and focused regression tests. */
export function dropChildTerminalState(
  expectedJobIds: string[],
  jobs: Array<{ id: string; status: string; errorJson?: unknown }>
): 'pending' | 'succeeded' {
  const expected = [...new Set(expectedJobIds)];
  if (!expected.length) throw new Error('drop produced zero render children');

  const byId = new Map(jobs.map((job) => [job.id, job]));
  const missing = expected.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(`drop child job missing or outside workspace/project (${missing.join(', ')})`);
  }

  for (const id of expected) {
    const job = byId.get(id)!;
    if (job.status === 'FAILED' || job.status === 'CANCELED') {
      const detail = errorMessage(job.errorJson);
      throw new Error(`drop child ${id} ${job.status.toLowerCase()}${detail ? `: ${detail}` : ''}`);
    }
    if (!['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(job.status)) {
      throw new Error(`drop child ${id} has unexpected status ${job.status}`);
    }
  }

  return expected.every((id) => byId.get(id)!.status === 'SUCCEEDED') ? 'succeeded' : 'pending';
}

export function isCertifiedPlayableAsset(asset: {
  url: string;
  approved: boolean;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: Date | null;
}): boolean {
  return asset.url.trim().length > 0
    && asset.approved
    && asset.qualityState === 'passed'
    && /^[a-f0-9]{64}$/i.test(asset.contentHash ?? '')
    && asset.verifiedAt instanceof Date
    && Number.isFinite(asset.verifiedAt.getTime());
}

export function passedDropQualityGate(
  hitRead: unknown,
  target = BLOW_TARGET
): DropQualityGateEvidence | null {
  const evidence = dropQualityGateEvidence(hitRead, target);
  return evidence?.passed ? evidence : null;
}

/** The gate as EVIDENCE, not a wall: always returns what was measured (or null
 *  when there is no usable read at all). `passed` says whether the score cleared
 *  the certification bar — the drop DELIVERS either way and labels honestly. */
export function dropQualityGateEvidence(
  hitRead: unknown,
  target = BLOW_TARGET
): DropQualityGateEvidence | null {
  const read = record(hitRead);
  const bestScore = Number(read?.bestScore);
  const passes = Number(read?.blowPasses);
  if (!Number.isFinite(bestScore)) return null;
  return {
    passed: read?.willBlow === true && bestScore >= target,
    willBlow: read?.willBlow === true,
    bestScore,
    passes: Number.isFinite(passes) ? Math.max(0, Math.trunc(passes)) : 0,
    target,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function positiveMs(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

async function waitForDropChildren(ctx: DropCtx, childJobIds: string[]): Promise<DropChildJob[]> {
  const ids = [...new Set(childJobIds)];
  if (!ids.length) dropChildTerminalState([], []);
  const timeoutMs = positiveMs('DROP_CHILD_TIMEOUT_MS', 30 * 60_000);
  const pollMs = positiveMs('DROP_CHILD_POLL_MS', 5_000);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const jobs: DropChildJob[] = await prisma.providerJob.findMany({
      where: {
        id: { in: ids },
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        kind: 'music',
      },
      select: {
        id: true,
        status: true,
        idempotencyKey: true,
        inputJson: true,
        outputJson: true,
        errorJson: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    if (dropChildTerminalState(ids, jobs) === 'succeeded') return jobs;
    if (Date.now() >= deadline) {
      const pending = jobs.filter((job) => job.status !== 'SUCCEEDED').map((job) => `${job.id}:${job.status}`);
      throw new Error(`drop child jobs did not reach terminal state before timeout (${pending.join(', ')})`);
    }
    await sleep(pollMs);
  }
}

type RenderedDropTake = DropTake & { jobId: string; songId: string };

async function requirePassedDropQualityGates(
  ctx: DropCtx,
  rendered: RenderedDropTake[]
): Promise<{
  evidenceBySongId: Map<string, DropQualityGateEvidence>;
  gateJobBySongId: Map<string, DropChildJob>;
}> {
  const songIds = [...new Set(rendered.map((item) => item.songId))];
  const songs: Array<{ id: string; hitRead: unknown }> = await prisma.song.findMany({
    where: {
      id: { in: songIds },
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
    },
    select: { id: true, hitRead: true },
  });
  if (songs.length !== songIds.length) {
    throw new Error('drop quality gate song missing or outside workspace/project');
  }

  const songById = new Map(songs.map((song) => [song.id, song]));
  const readKeyBySongId = new Map(
    rendered.map((item) => [
      item.songId,
      `will-it-blow:${item.jobId}:${item.songId}:initial-read`,
    ] as const)
  );
  const readJobs: Array<{
    id: string;
    idempotencyKey: string | null;
    status: string;
    outputJson: unknown;
    errorJson: unknown;
  }> = await prisma.providerJob.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: 'ar-read',
      idempotencyKey: { in: [...readKeyBySongId.values()] },
    },
    select: { id: true, idempotencyKey: true, status: true, outputJson: true, errorJson: true },
  });
  const readJobByKey = new Map(
    readJobs.flatMap((job) => job.idempotencyKey ? [[job.idempotencyKey, job] as const] : [])
  );
  const evidenceBySongId = new Map<string, DropQualityGateEvidence>();
  for (const item of rendered) {
    const readJob = readJobByKey.get(readKeyBySongId.get(item.songId)!);
    if (!readJob) throw new Error(`drop quality gate receipt unavailable for song ${item.songId}`);
    if (readJob.status !== 'SUCCEEDED') {
      const detail = errorMessage(readJob.errorJson);
      throw new Error(
        `drop quality gate receipt ${readJob.status.toLowerCase()} for song ${item.songId}${detail ? `: ${detail}` : ''}`
      );
    }
    const receiptValue = record(record(readJob.outputJson)?.value);
    if (typeof receiptValue?.hitScore !== 'number' && typeof receiptValue?.viralScore !== 'number') {
      throw new Error(`drop quality gate receipt unavailable for song ${item.songId}`);
    }
    const hitRead = songById.get(item.songId)?.hitRead;
    // DELIVER, DON'T DESTROY (live incident 2026-07-19): the old code THREW here
    // on any below-bar score, so a paid drop whose hooks+lyrics+render all
    // SUCCEEDED (measured 62 vs a 90 wall) died as FAILED with nothing to play.
    // A below-bar read is now honest evidence (passed:false) — the song ships,
    // labeled. Only a missing/unreadable receipt is still an infrastructure error.
    const evidence = dropQualityGateEvidence(hitRead);
    if (!evidence) {
      throw new Error(`drop quality gate unavailable for song ${item.songId}`);
    }
    evidenceBySongId.set(item.songId, { ...evidence, receiptJobId: readJob.id });
  }

  // A gate that improved the writing must also land the corrective re-render.
  // will-it-blow persists blowPasses, while the re-render has this stable key.
  const gateKeyBySongId = new Map(
    rendered.flatMap((item) => {
      const evidence = evidenceBySongId.get(item.songId)!;
      return evidence.passes > 0
        ? [[item.songId, `will-it-blow:${item.jobId}:${item.songId}:resing`] as const]
        : [];
    })
  );
  if (!gateKeyBySongId.size) {
    return { evidenceBySongId, gateJobBySongId: new Map() };
  }

  const gateJobs: Array<{ id: string; idempotencyKey: string | null }> = await prisma.providerJob.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: 'music',
      idempotencyKey: { in: [...gateKeyBySongId.values()] },
    },
    select: { id: true, idempotencyKey: true },
  });
  const gateJobByKey = new Map<string, { id: string; idempotencyKey: string | null }>(
    gateJobs.flatMap((job) => job.idempotencyKey ? [[job.idempotencyKey, job]] : [])
  );
  // passes>0 does NOT guarantee a corrective render exists: will-it-blow only
  // re-sings when the rewrite improved >= +4 (and resing itself can refuse —
  // artist-authored verbatim law, contamination-rejected rewrite, route error).
  // A missing corrective render is therefore a FALLBACK to the direct render,
  // never a reason to destroy the paid drop.
  for (const [songId, key] of [...gateKeyBySongId.entries()]) {
    if (!gateJobByKey.has(key)) {
      console.warn(`[drop] corrective render absent for song ${songId} (rewrite not rendered) — delivering the direct render`);
      gateKeyBySongId.delete(songId);
    }
  }
  if (!gateKeyBySongId.size) {
    return { evidenceBySongId, gateJobBySongId: new Map() };
  }

  const terminalGateJobs = await waitForDropChildren(ctx, gateJobs.map((job) => job.id));
  const terminalById = new Map(terminalGateJobs.map((job) => [job.id, job]));
  const gateJobBySongId = new Map<string, DropChildJob>();
  for (const [songId, key] of gateKeyBySongId) {
    const job = gateJobByKey.get(key)!;
    gateJobBySongId.set(songId, terminalById.get(job.id)!);
  }
  return { evidenceBySongId, gateJobBySongId };
}

function stringField(value: Record<string, unknown> | null, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === 'string' && field.trim() ? field : undefined;
}

export function assetProducedByChild(asset: PersistedPlayable, child: DropChildJob, songId: string): boolean {
  if (asset.songId !== songId) return false;
  const output = record(child.outputJson);
  const expectedId = stringField(output, `${asset.assetType}Id`);
  if (expectedId === asset.id) return true;

  const expectedHashes = [
    stringField(output, asset.assetType + 'ContentHash'),
    stringField(output, 'contentHash'),
    stringField(output, 'sourceContentHash'),
  ].filter((hash): hash is string =>
    typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash)
  );
  if (!!asset.contentHash && expectedHashes.includes(asset.contentHash)) return true;

  const outputUrls = ['url', 'masterUrl', 'wavUrl', 'mp3Url']
    .map((key) => stringField(output, key))
    .filter((url): url is string => !!url);
  const deliveryUrl = stringField(record(record(asset.meta)?.deliveryMp3), 'url');
  if (outputUrls.includes(asset.url) || (!!deliveryUrl && outputUrls.includes(deliveryUrl))) return true;

  return false;
}

async function loadDropPlayableOutputs(
  ctx: DropCtx,
  rendered: RenderedDropTake[],
  directChildren: DropChildJob[],
  quality: Awaited<ReturnType<typeof requirePassedDropQualityGates>>
): Promise<DropPlayableOutput[]> {
  const songIds = [...new Set(rendered.map((item) => item.songId))];
  const children = [...directChildren, ...quality.gateJobBySongId.values()];
  const outputRecords = children.map((child) => record(child.outputJson));
  const referencedIds = (key: string) => [...new Set(
    outputRecords.map((output) => stringField(output, key)).filter((id): id is string => !!id)
  )];
  const beatIds = referencedIds('beatId');
  const mixIds = referencedIds('mixId');
  const masterIds = referencedIds('masterId');
  const certifiedWhere = {
    projectId: ctx.projectId,
    project: { workspaceId: ctx.workspaceId },
    approved: true,
    qualityState: 'passed',
    contentHash: { not: null },
    verifiedAt: { not: null },
  } as const;
  const select = {
    id: true,
    projectId: true,
    songId: true,
    url: true,
    qualityState: true,
    contentHash: true,
    verifiedAt: true,
    approved: true,
    createdAt: true,
    meta: true,
  } as const;

  const [beats, mixes, masters] = await Promise.all([
    prisma.beatAsset.findMany({
      where: { ...certifiedWhere, OR: [{ songId: { in: songIds } }, { id: { in: beatIds } }] },
      select,
    }),
    prisma.mix.findMany({
      where: { ...certifiedWhere, OR: [{ songId: { in: songIds } }, { id: { in: mixIds } }] },
      select,
    }),
    prisma.master.findMany({
      where: { ...certifiedWhere, OR: [{ songId: { in: songIds } }, { id: { in: masterIds } }] },
      select,
    }),
  ]) as [
    Array<Omit<PersistedPlayable, 'assetType'>>,
    Array<Omit<PersistedPlayable, 'assetType'>>,
    Array<Omit<PersistedPlayable, 'assetType'>>,
  ];
  const candidates: PersistedPlayable[] = [
    ...beats.map((asset) => ({ ...asset, assetType: 'beat' as const })),
    ...mixes.map((asset) => ({ ...asset, assetType: 'mix' as const })),
    ...masters.map((asset) => ({ ...asset, assetType: 'master' as const })),
  ].filter(isCertifiedPlayableAsset);
  const rank = { beat: 1, mix: 2, master: 3 } as const;
  candidates.sort((a, b) => rank[b.assetType] - rank[a.assetType]
    || b.createdAt.getTime() - a.createdAt.getTime());

  const directById = new Map(directChildren.map((child) => [child.id, child]));
  return rendered.map((item) => {
    const gate = quality.evidenceBySongId.get(item.songId)!;
    const child = quality.gateJobBySongId.get(item.songId) ?? directById.get(item.jobId);
    if (!child) throw new Error(`drop terminal child evidence missing for song ${item.songId}`);
    const asset = candidates.find((candidate) => assetProducedByChild(candidate, child, item.songId));
    if (!asset) {
      throw new Error(`drop child ${child.id} succeeded without a persisted certified playable asset`);
    }
    return {
      songId: item.songId,
      projectId: ctx.projectId,
      initialChildJobId: item.jobId,
      childJobId: child.id,
      assetType: asset.assetType,
      assetId: asset.id,
      url: asset.url,
      contentHash: asset.contentHash!,
      verifiedAt: asset.verifiedAt!.toISOString(),
      qualityState: 'passed',
      approved: true,
      certified: gate.passed, // below-bar delivers honestly, never certified
      qualityGate: gate,
    };
  });
}

/** The actual Drop Machine pipeline; the orchestration worker owns its retry.
 *  Exported so Albums can generate "the next track in this album's style". */
export async function runDropPipeline(app: FastifyInstance, ctx: DropCtx, input: DropInput, dropJobId: string) {
  // COST RECEIPT: the whole pipeline runs inside a metered brain context — every
  // LLM call lands on this run's bill, and the drop's outputJson carries it
  // ("one song, this much", not a vibe). User drops keep their taste tiers;
  // only the NIGHT runs force bulk.
  return runWithBrainContext({ runId: dropJobId }, () => runDropPipelineInner(app, ctx, input, dropJobId));
}

async function runDropPipelineInner(app: FastifyInstance, ctx: DropCtx, input: DropInput, dropJobId: string) {
  // STAGE TIMING — the writer now drafts + critic-polishes + arranges before the
  // render is queued, so this can run several minutes. Log where the time goes
  // so a slow drop is diagnosable from the API logs (not guessed at).
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
  app.log.info({ dropJobId, count: input.count }, `[drop] start`);
  // REAL PROGRESS (kills the fake spinner): every stage boundary below emits a
  // breadcrumb on the PARENT drop job so the Create page shows true stages
  // (writing hooks -> writing lyrics -> building the beat -> singing) instead of
  // stage text derived from a poll-loop counter. All emits are fail-soft.
  await emitJobEvent(dropJobId, 'drop_started', { count: input.count });
  // OUR ENGINE + VOCALS — resolved UP FRONT, before a cent of LLM spend, never
  // as a 422 after the song is written (the 2026-07-16 regression: hooks + A&R
  // + full lyrics were paid for, THEN create_beat_job refused). The own engine
  // renders the INSTRUMENTAL bed only; createBeatJob's own branch binds that
  // bed to the song carrying the fresh lyrics and discloses "vocals by upload
  // or re-sing" in its note (captured into every take below). The lyrics are
  // still written on purpose — they are exactly what a later re-sing sings.
  // One shared brief for the whole drop. ADVISORY, NEVER LOAD-BEARING: when the
  // polish LLM fails (cap hit, bad JSON, provider down) the writers used to read
  // briefs[0] === undefined and the user's ENTIRE description — song-name anchor,
  // vibe, mood, fusion, influence — silently never reached a single prompt. Now a
  // failed polish falls back to a brief built VERBATIM from the structured input.
  try {
    const polished = (await runChatTool({ ...ctx, operationKey: `drop:${dropJobId}:brief`, name: 'polish_brief', args: { rawIdea: input.theme } })) as { error?: string } | null;
    if (polished && (polished as { error?: string }).error) throw new Error((polished as { error: string }).error);
    app.log.info({ dropJobId }, `[drop] brief polished @${secs()}s`);
    await emitJobEvent(dropJobId, 'brief_ready', {});
  } catch (err) {
    app.log.error({ err, dropJobId }, '[drop] polish_brief failed — writing the fallback brief from the structured input');
    await prisma.songBrief
      .create({
        data: {
          projectId: ctx.projectId,
          mood: input.mood ?? null,
          topic: input.vibe ?? input.theme,
          language: input.languages ?? [],
          bpm: input.bpm ?? null,
          notes: [
            input.songTitle ? `Song title (law): ${input.songTitle}` : null,
            input.influence ? `Influence: ${input.influence}` : null,
            input.fusionGenres?.length ? `Fusion: ${input.fusionGenres.join(', ')}` : null,
          ].filter(Boolean).join('\n') || null,
          approved: true,
        },
      })
      .catch(() => undefined);
  }

  const drops: DropTake[] = [];

      for (let i = 0; i < input.count; i++) {
        try {
          // Structured selections ride FIRST-CLASS next to languages — the
          // polish-brief LLM re-extracting them from the theme prose was the
          // only carrier before, so a polish hiccup dropped mood/fusion/influence.
          const sel = { mood: input.mood, fusionGenres: input.fusionGenres, influence: input.influence, songTitle: input.songTitle };
          const hk = (await runChatTool({ ...ctx, operationKey: `drop:${dropJobId}:take:${i}:hooks:1`, name: 'generate_hooks', args: { count: 3, languages: input.languages, ...sel } })) as {
            hooks?: Array<{ id: string; text: string; score: number | null }>;
          };
          let hooks = hk?.hooks ?? [];
          if (!hooks.length) {
            // NEVER skip silently. Empty hooks = the creative brain returned
            // nothing usable (down/degraded, or JSON that didn't match the
            // schema). Record WHY so the drop surfaces a real reason instead of a
            // blank "Could not start the render".
            const why = (hk as { error?: string })?.error;
            drops.push({ score: null, error: why ? `no hooks: ${why}` : 'no hooks — the creative brain returned nothing (check ANTHROPIC / OPENAI keys + billing on the API service, then Try again)' });
            continue;
          }
          // If the Claude A&R didn't score them, score via the taste engine — but
          // NEVER let a scoring hiccup kill the whole take. If it fails, we ship
          // the hooks unscored (ranked by generation order) rather than failing.
          if (hooks.every((h) => h.score == null)) {
            try {
              const sc = (await runChatTool({ ...ctx, operationKey: `drop:${dropJobId}:take:${i}:score:1`, name: 'score_hooks', args: { hookIds: hooks.map((h) => h.id) } })) as { scores?: Array<{ id: string; overall: number }> };
              const m = new Map((sc?.scores ?? []).map((s) => [s.id, s.overall]));
              hooks = hooks.map((h) => ({ ...h, score: m.get(h.id) ?? h.score }));
            } catch { /* scoring unavailable — keep the hooks, pick the first */ }
          }
          let best = hooks.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]!;

          // Quality floor: if the best hook is below the bar, regenerate ONCE more
          // and keep the best across both rounds. Raises the floor without ever
          // hard-failing the drop (a strong hook is what carries an Afrobeats record).
          const MIN_HOOK_SCORE = Number(process.env.MIN_HOOK_SCORE ?? 6.5);
          if ((best.score ?? 0) < MIN_HOOK_SCORE) {
            const hk2 = (await runChatTool({ ...ctx, operationKey: `drop:${dropJobId}:take:${i}:hooks:2`, name: 'generate_hooks', args: { count: 3, languages: input.languages, ...sel } })) as {
              hooks?: Array<{ id: string; text: string; score: number | null }>;
            };
            let hooks2 = hk2?.hooks ?? [];
            if (hooks2.length && hooks2.every((h) => h.score == null)) {
              try {
                const sc2 = (await runChatTool({ ...ctx, operationKey: `drop:${dropJobId}:take:${i}:score:2`, name: 'score_hooks', args: { hookIds: hooks2.map((h) => h.id) } })) as { scores?: Array<{ id: string; overall: number }> };
                const m2 = new Map((sc2?.scores ?? []).map((s) => [s.id, s.overall]));
                hooks2 = hooks2.map((h) => ({ ...h, score: m2.get(h.id) ?? h.score }));
              } catch { /* scoring unavailable — keep hooks2 as-is */ }
            }
            const combined = [...hooks, ...hooks2].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            if (combined[0]) best = combined[0];
          }

          app.log.info({ dropJobId }, `[drop] take ${i + 1}: hook picked @${secs()}s`);
          await emitJobEvent(dropJobId, 'hooks_done', { take: i, hook: best.text?.slice(0, 120), score: best.score ?? null });
          const ap = (await runChatTool({ ...ctx, operationKey: `drop:${dropJobId}:take:${i}:approve`, name: 'approve_hook', args: { hookId: best.id } })) as {
            songId?: string;
          };
          const lyricRes = (await runChatTool({ ...ctx, operationKey: `drop:${dropJobId}:take:${i}:lyrics`, name: 'generate_lyrics', args: { hookId: best.id, cleanVersion: true, languages: input.languages, ...sel } })) as {
            error?: string; reason?: string; rejected?: boolean; decision?: string;
          };
          // HONEST CAUSE BUBBLING (live incident 2026-07-19: the writer step
          // died on insufficient_credits/daily_cap, but the drop reported the
          // DOWNSTREAM symptom "no_lyrics — write the lyrics first" — a
          // misleading error for a paying user). A failed/rejected lyric step
          // names ITSELF as this take's cause.
          if (lyricRes?.error) {
            throw new Error(
              lyricRes.error === 'insufficient_credits'
                ? `out of credits at the lyric step (${lyricRes.reason ?? 'balance'}) — top up or wait for the daily reset, then create again`
                : `lyric step failed: ${lyricRes.error}`
            );
          }
          if (lyricRes?.rejected) {
            throw new Error(`the writer rejected this concept (${lyricRes.decision ?? 'REJECT_AND_RESTART'}) — try a different theme`);
          }
          app.log.info({ dropJobId }, `[drop] take ${i + 1}: lyrics written (draft+polish) @${secs()}s`);
          await emitJobEvent(dropJobId, 'lyrics_done', { take: i });
          const beat = (await runChatTool({
            ...ctx,
            operationKey: `drop:${dropJobId}:take:${i}:beat`,
            name: 'create_beat_job',
            // THE CREATE-PAGE PATH: this is the render users actually hit. It must
            // carry the SAME brief the chat path (runDropTool) carries — voice and
            // vibe were silently dropped here while the fix landed only in chat.
            // vibe (the raw musical description) is preferred over theme, which is
            // wrapped in title-anchor boilerplate the music engine can't use.
            // songId = the song approve_hook just minted: the render (own-engine
            // bed included) binds to THE song carrying this take's lyrics, not
            // to whatever happens to be the project's latest row.
            args: { genre: input.genre, fusionGenres: input.fusionGenres, mood: input.mood, pinnedReferenceId: input.pinnedReferenceId, bpm: input.bpm, withVocals: input.withVocals, songEngine: input.songEngine, influence: input.influence, languages: input.languages, voice: input.voice, vibePrompt: input.vibe, candidates: input.candidates, instruments: input.instruments, songId: ap?.songId },
          })) as { jobId?: string; songId?: string; error?: string; note?: string };

          // The user's typed song name IS the title — the writers already treat it
          // as the creative anchor (via theme); without this the field was dead
          // and the song shipped under the AI's own title.
          const producedSongId = ap?.songId ?? beat?.songId;
          if (input.songTitle && producedSongId) {
            const t = input.songTitle.slice(0, 80);
            await prisma.song.update({ where: { id: producedSongId }, data: { title: t } }).catch(() => undefined);
            await prisma.lyricDraft.updateMany({ where: { songId: producedSongId }, data: { title: t } }).catch(() => undefined);
          }

          app.log.info({ dropJobId, jobId: beat?.jobId, err: beat?.error }, `[drop] take ${i + 1}: render ${beat?.jobId ? 'QUEUED' : 'NOT queued'} @${secs()}s`);
          // BED-FIRST UNBLOCKER (finding #1): surface the render child id THE
          // MOMENT it is enqueued — not after waitForDropChildren blocks on the
          // whole batch. The client reads this off the parent's event tail and
          // starts watching the child immediately, so it can play the bed
          // (own-engine.ts emits 'bed_ready' with {url}) minutes before the
          // vocal finishes and hot-swap to the master on the child's SUCCEEDED.
          if (beat?.jobId) {
            await emitJobEvent(dropJobId, 'render_queued', {
              take: i,
              renderJobId: beat.jobId,
              songId: producedSongId ?? null,
              projectId: ctx.projectId,
              hook: best.text?.slice(0, 160),
              score: best.score ?? null,
              title: input.songTitle?.slice(0, 80) ?? null,
            });
          }
          drops.push({
            songId: producedSongId,
            hookId: best.id,
            hookText: best.text,
            title: input.songTitle?.slice(0, 80),
            score: best.score ?? null,
            jobId: beat?.jobId,
            error: beat?.error,
            // The engine's own disclosure (own engine: instrumental bed) rides
            // the take so the UI/outputJson never oversell what rendered.
            note: beat?.note,
          });

      // If the daily cap was hit mid-batch, stop cleanly.
      if (beat?.error === 'insufficient_credits') break;
    } catch (err) {
      app.log.warn({ err }, 'drop iteration failed');
      // Surface the REAL reason (truncated) so failures are diagnosable instead
      // of a generic "take failed" — the user (and we) can see WHY.
      const why = (err as Error)?.message?.slice(0, 160) || 'unknown error';
      drops.push({ score: null, error: `this take failed: ${why}` });
    }
  }

  drops.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  // A queued child ID is not an output. The parent remains RUNNING until every
  // direct render reaches a successful terminal state.
  const queued = drops.filter((item): item is DropTake & { jobId: string } => !!item.jobId);
  if (!queued.length) {
    const detail = drops.find((item) => item.error)?.error
      ?? 'the studio produced no render child this run';
    throw new Error(`drop produced zero render children: ${detail}`);
  }
  const rendered: RenderedDropTake[] = queued.map((item) => {
    if (!item.songId) throw new Error(`drop child ${item.jobId} has no persisted song identity`);
    return { ...item, songId: item.songId };
  });
  // SING-IT-AGAIN LAW (live 2026-07-19, first fal-default drop): the AUTO-routed
  // singer failed the lyric-fidelity gate and the paying user got a dead end +
  // refund instead of a song. When a take died ONLY on vocal/lyric alignment and
  // the user did NOT explicitly pick an engine, re-sing that take ONCE on the
  // proven standard engine — same song row, same approved lyrics, one retry,
  // disclosed on the take note (class language only, never a vendor name).
  // Explicit engine picks are honored: no silent substitution. The failed child
  // has already been auto-refunded, so the net charge stays one render.
  // Kill switch: DROP_ALIGN_FALLBACK=0.
  const ALIGN_FAIL = /rendered vocals did not match the approved lyrics/i;
  let directChildren: DropChildJob[];
  try {
    directChildren = await waitForDropChildren(ctx, rendered.map((item) => item.jobId));
  } catch (err) {
    const fallbackOn = process.env.DROP_ALIGN_FALLBACK !== '0';
    const autoRouted = !input.songEngine;
    if (!fallbackOn || !autoRouted || !input.withVocals || !ALIGN_FAIL.test((err as Error)?.message ?? '')) throw err;
    const failed = await prisma.providerJob.findMany({
      where: { id: { in: rendered.map((item) => item.jobId) }, workspaceId: ctx.workspaceId, status: 'FAILED' },
      select: { id: true, errorJson: true },
    });
    const retriable = failed.filter((job) => ALIGN_FAIL.test(errorMessage(job.errorJson) ?? ''));
    if (!retriable.length || retriable.length !== failed.length) throw err; // any non-alignment failure keeps the original outcome
    app.log.warn(
      { dropJobId, resing: retriable.map((job) => job.id) },
      '[drop] auto singer missed the approved lyrics — re-singing once on the standard engine'
    );
    for (const dead of retriable) {
      const take = rendered.find((item) => item.jobId === dead.id);
      if (!take) throw err;
      const redo = (await runChatTool({
        ...ctx,
        operationKey: `drop:${dropJobId}:resing:${dead.id}`,
        name: 'create_beat_job',
        args: { genre: input.genre, fusionGenres: input.fusionGenres, mood: input.mood, pinnedReferenceId: input.pinnedReferenceId, bpm: input.bpm, withVocals: input.withVocals, songEngine: 'minimax', influence: input.influence, languages: input.languages, voice: input.voice, vibePrompt: input.vibe, candidates: input.candidates, instruments: input.instruments, songId: take.songId },
      })) as { jobId?: string; error?: string };
      if (!redo?.jobId) throw err;
      take.jobId = redo.jobId;
      take.note = [take.note, 'the first singer missed the lyrics — re-sung on the standard engine'].filter(Boolean).join('; ');
    }
    directChildren = await waitForDropChildren(ctx, rendered.map((item) => item.jobId));
  }
  app.log.info({ dropJobId, children: directChildren.length }, `[drop] render children terminal @${secs()}s`);

  // Every rendered song needs a persisted passing quality receipt. A corrective
  // re-render created by the gate is also a required terminal child.
  await willItBlowGate(app, ctx.workspaceId, rendered);
  const quality = await requirePassedDropQualityGates(ctx, rendered);
  const belowBar = [...quality.evidenceBySongId.values()].filter((e) => !e.passed);
  app.log.info(
    { dropJobId, songs: quality.evidenceBySongId.size, belowBar: belowBar.length },
    `[drop] quality read complete (${belowBar.length ? `${belowBar.length} below the ${BLOW_TARGET} bar — delivering labeled` : 'all certified'}) @${secs()}s`
  );

  const playableOutputs = await loadDropPlayableOutputs(ctx, rendered, directChildren, quality);
  if (!playableOutputs.length) {
    throw new Error('drop completed without a persisted certified playable output');
  }

  // The orchestration worker owns the single parent terminal write. Returning
  // concrete evidence keeps SUCCEEDED synonymous with "can be played now".
  const costs = brainRunCosts();
  return {
    theme: input.theme,
    requested: input.count,
    produced: playableOutputs.length,
    drop: drops,
    childJobs: directChildren.map((child) => ({ jobId: child.id, status: 'SUCCEEDED' as const })),
    playableOutputs,
    qualityGate: {
      status: belowBar.length ? ('below_bar' as const) : ('passed' as const),
      target: BLOW_TARGET,
      songs: [...quality.evidenceBySongId.entries()].map(([songId, evidence]) => ({ songId, ...evidence })),
      ...(belowBar.length
        ? { note: `${belowBar.length} of ${quality.evidenceBySongId.size} song(s) read under the ${BLOW_TARGET}-point certification bar — delivered anyway (yours to keep, playable), with the A&R read attached. Certification (release eligibility) needs a take at or above the bar.` }
        : {}),
    },
    ...(costs ? { llmCosts: { estUsd: +costs.estUsd.toFixed(4), calls: costs.calls, byBrain: Object.fromEntries(Object.entries(costs.byBrain).map(([k, v]) => [k, { calls: v.calls, estUsd: +v.estUsd.toFixed(4) }])), degraded: costs.degraded, note: 'LLM writing bill (estimates); the render cost lands on the render job' } } : {}),
  };
}

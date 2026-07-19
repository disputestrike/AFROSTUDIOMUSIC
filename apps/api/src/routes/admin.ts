/**
 * Admin pathway — operator tools gated by ADMIN_EMAILS (comma-separated env).
 * Same pattern as the GOVSURE remediation: no separate role system, just an
 * allowlist of operator emails checked against the authenticated user.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@afrohit/db';
import * as db from '@afrohit/db';

/** The sandbox compile shim (tools/shim/db-shim.d.ts) only declares the prisma
 *  exports, so the autonomy helpers are pulled through a typed view of the
 *  module. The union + signatures mirror packages/db/src/index.ts exactly. */
type AutonomyJob = 'morning_drop' | 'zap_radar' | 'nightly_compound' | 'will_it_blow';
const { allAutonomyFlags, setAutonomyEnabled } = db as unknown as {
  allAutonomyFlags(): Promise<Record<AutonomyJob, boolean>>;
  setAutonomyEnabled(job: AutonomyJob, enabled: boolean): Promise<void>;
};
import { isInternalMode, requireAuth } from '../middleware/auth';
import { validAdminGrant } from '../lib/session';
import { GENRES, isFirstPartyWorkspace, resolveEngineForWorkspace, TRAINING_LICENSE_CLAUSE, TRAINING_LICENSE_VERSION } from '@afrohit/shared';
import { hashTrainingLicense, resolveWorkspaceTrainingConsent } from '../lib/training-license';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { operationErrorBody, runIdempotentOperation } from '../lib/idempotent-operation';
import { assertOwnedKey, assertWorkspaceAsset, publicUrlFor } from '../lib/storage';
import { buildWorkspaceTrainingManifest } from '../lib/training-capture';

export async function hasAdminAccess(req: FastifyRequest): Promise<boolean> {
  const { userId, workspaceId } = requireAuth(req);
  // WO-1 SAFETY RAIL: the API is publicly reachable, and in internal mode
  // requireAuth never rejects — so "the one resolved user IS the operator" made
  // every admin/trigger route (spend triggers included) open to the internet.
  // Internal mode exchanges ADMIN_SECRET for a bounded HttpOnly grant. The raw
  // operator secret is never persisted by browser JavaScript.
  if (isInternalMode()) {
    return validAdminGrant(req, userId, workspaceId);
  }
  // Multi-user modes: gate by ADMIN_EMAILS allowlist.
  const allow = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && allow.includes(user.email.toLowerCase());
}

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  if (await hasAdminAccess(req)) return;
  const statusCode = isInternalMode() ? 401 : 403;
  const message = isInternalMode() ? 'admin locked: unlock this browser session' : 'forbidden';
  throw Object.assign(new Error(message), { statusCode });
}

const grantSchema = z.object({
  deltaCents: z.number().int(), // positive = grant, negative = clawback (1/100-cent units)
  reason: z.string().min(3).max(200),
});

export default async function admin(app: FastifyInstance) {
  app.get('/status', async (req) => ({ admin: await hasAdminAccess(req) }));

  // "SEE THE MUSIC" — the REAL catalog (material loops, instrumentals, vocals)
  // as a rights-gated training manifest: what may train our own model and what
  // is refused, with reasons. Read-only. user-original counts as trainable only
  // when training-license consent is applied (ToS-on-signup; default fail-closed
  // via TRAINING_CONSENT_DEFAULT=1, or ?consent=1 to preview).
  app.get('/training/manifest', async (req, reply) => {
    await requireAdmin(req);
    const q = (req.query ?? {}) as { workspaceId?: string; consent?: string };
    // REAL CONSENT (the door, 2026-07-19): a recorded, versioned, hashed grant
    // per workspace — resolved fail-closed. ?consent=1 remains a PREVIEW-ONLY
    // override, clearly labeled; the env-flag stand-in is gone.
    const recorded = q.workspaceId
      ? await resolveWorkspaceTrainingConsent(q.workspaceId)
      : { granted: false, current: false, reason: 'per-workspace consent — pass workspaceId' };
    const preview = q.consent === '1';
    const consentApplied = preview || (recorded.granted && recorded.current);
    const manifest = await buildWorkspaceTrainingManifest({
      workspaceId: q.workspaceId,
      resolveConsent: () => consentApplied,
    });
    return reply.send({
      scannedWorkspace: manifest.scannedWorkspace,
      consentApplied,
      consent: { ...recorded, ...(preview ? { previewOverride: true } : {}) },
      trainableNow: manifest.eligible.length,
      counts: manifest.counts,
      rejectedSample: manifest.rejected.slice(0, 25),
    });
  });

  /**
   * GRANT the training license for a workspace (the consent door). Records the
   * versioned + hashed acceptance — the exact clause text, tamper-evident.
   * This is how the OWNER's own studio (which never passes through /signup)
   * unlocks its user-original catalog for the flywheel. Auditable, revocable.
   */
  const consentSchema = z.object({ workspaceId: z.string().min(1) });
  app.post('/training/consent', { schema: { body: consentSchema } }, async (req, reply) => {
    await requireAdmin(req);
    const { userId } = requireAuth(req);
    const { workspaceId } = consentSchema.parse(req.body);
    // ADMIN SURFACE = REAL ERRORS (live 500 on the owner's first tap was masked
    // as "internal_error"; the likely class — e.g. the TrainingConsent table
    // missing because a deploy's db push didn't land — must NAME itself).
    try {
      await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { id: true } });
      const existing = await prisma.trainingConsent.findFirst({
        where: { workspaceId, revokedAt: null, consentVersion: TRAINING_LICENSE_VERSION },
        select: { id: true },
      });
      if (existing) return reply.send({ ok: true, alreadyGranted: true, consentId: existing.id });
      const row = await prisma.trainingConsent.create({
        data: {
          workspaceId,
          grantedByUserId: userId,
          consentText: TRAINING_LICENSE_CLAUSE,
          consentVersion: TRAINING_LICENSE_VERSION,
          consentTextHash: hashTrainingLicense(),
        },
      });
      reply.code(201);
      return { ok: true, consentId: row.id, version: TRAINING_LICENSE_VERSION };
    } catch (err) {
      const e = err as Error & { code?: string };
      req.log.error({ err }, 'training consent grant failed');
      return reply.code(500).send({
        error: 'training_consent_failed',
        code: e.code ?? null,
        message: (e.message ?? 'unknown').slice(0, 300),
        ...(e.code === 'P2021'
          ? { hint: 'The TrainingConsent table does not exist yet — the deploy\'s `prisma db push` has not landed. Redeploy the API service (or run prisma db push) and tap again.' }
          : {}),
      });
    }
  });

  /** WITHDRAW the grant for FUTURE training (fail-closed from the next run). */
  app.delete<{ Params: { workspaceId: string } }>('/training/consent/:workspaceId', async (req, reply) => {
    await requireAdmin(req);
    const updated = await prisma.trainingConsent.updateMany({
      where: { workspaceId: req.params.workspaceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return reply.send({ ok: true, revoked: updated.count });
  });

  // One-tap compounding: run the lake jobs NOW instead of waiting for tonight.
  const runSchema = z.object({ task: z.enum(['nightly-compound', 'measure-backfill', 'learn-backfill', 'listen-back', 'refile-references', 'mine-lexicon', 'lexicon-research', 'wiktionary-harvest', 'wiktionary-burst', 'lexicon-gloss', 'lexicon-verify', 'recert-sweep']) });
  app.post('/run', { schema: { body: runSchema } }, async (req, reply) => {
    await requireAdmin(req);
    const { workspaceId } = requireAuth(req);
    const { task } = runSchema.parse(req.body);
    // Background tasks run on the LAKE queue — they never contend with renders.
    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, `admin-lake:${task}`);
    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.lake,
      jobName: task,
      workspaceId,
      kind: 'lake',
      provider: 'internal',
      inputJson: { task },
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId }),
    });
    reply.code(202);
    return { queued: task, jobId: job.jobId, replayed: job.replayed, note: 'Running on the worker now; results land in /lanes/inventory.' };
  });

  // MASTER-REFERENCE INGESTION — the door for the owner's rights-cleared
  // reference tracks (3 per core genre by doctrine). The API half validates +
  // enqueues; the WORKER half (processors/compound.ts) downloads, measures,
  // and stores ONLY the measured tonal vector + rights attestation in the
  // SystemSetting bank below. NUMBERS ONLY: no audio is ever persisted by this
  // path, and the fixture manifest stays as a read-only fallback (the DB bank
  // wins — see the reference-seam contract in worker lib/ffmpeg.ts).
  const MASTER_REFERENCES_SETTING_KEY = 'master.references.v1'; // mirrors worker lib/ffmpeg.ts
  const masterRefSchema = z
    .object({
      genre: z.string().min(2).max(40),
      title: z.string().min(1).max(200),
      // A REAL attestation sentence, not a checkbox — it is stored verbatim
      // beside the numbers as the rights record for this reference.
      rightsAttestation: z.string().min(10).max(500),
      audioUrl: z.string().min(4).max(2048).optional(),
      uploadKey: z.string().min(4).max(1024).optional(),
    })
    .refine((b) => !!b.audioUrl !== !!b.uploadKey, {
      message: 'provide exactly one of audioUrl or uploadKey',
    });
  app.post('/master-references', { schema: { body: masterRefSchema } }, async (req, reply) => {
    await requireAdmin(req);
    const { workspaceId } = requireAuth(req);
    const body = masterRefSchema.parse(req.body);
    if (!(GENRES as readonly string[]).includes(body.genre)) {
      return reply.code(400).send({ error: 'unknown_genre', message: `genre must be one of the studio lanes (e.g. ${GENRES.slice(0, 6).join(', ')}, …)` });
    }
    // Resolve the audio source to something the worker can download: an owned
    // upload key becomes a canonical storage URI; a storage URI must belong to
    // this workspace; plain https passes through (admin-gated route).
    let audioUrl: string;
    if (body.uploadKey) {
      audioUrl = publicUrlFor(assertOwnedKey(workspaceId, body.uploadKey));
    } else if (/^storage:/i.test(body.audioUrl!)) {
      assertWorkspaceAsset(workspaceId, body.audioUrl!);
      audioUrl = body.audioUrl!;
    } else if (/^https?:\/\//i.test(body.audioUrl!)) {
      audioUrl = body.audioUrl!;
    } else {
      return reply.code(400).send({ error: 'unsupported_audio_source', message: 'audioUrl must be https or an owned storage reference' });
    }
    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, `admin-master-ref:${body.genre}:${body.title}`);
    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.lake,
      jobName: 'master-reference-ingest',
      workspaceId,
      kind: 'lake',
      provider: 'internal',
      inputJson: { genre: body.genre, title: body.title, rightsAttestation: body.rightsAttestation, audioUrl },
      idempotencyKey,
      payload: (jobId) => ({
        jobId,
        workspaceId,
        genre: body.genre,
        title: body.title,
        rightsAttestation: body.rightsAttestation,
        audioUrl,
      }),
    });
    reply.code(202);
    return {
      queued: true,
      jobId: job.jobId,
      replayed: job.replayed,
      genre: body.genre,
      title: body.title,
      note: 'The worker measures the audio and stores numbers + attestation only — the recording itself is never kept. Re-ingesting the same genre+title replaces its measurement.',
    };
  });

  // The current reference bank — measured vectors + attestations, verbatim
  // from the SystemSetting store (the worker computes per-genre aggregates
  // from these tracks at render time; nothing here is recomputed or invented).
  app.get('/master-references', async (req) => {
    await requireAdmin(req);
    const row = await prisma.systemSetting.findUnique({ where: { key: MASTER_REFERENCES_SETTING_KEY } });
    let store: { version?: number; genres?: Record<string, { tracks?: unknown[] }> } | null = null;
    try {
      store = row ? JSON.parse(row.value) : null;
    } catch {
      store = null; // corrupt store reads as empty; the next ingest rebuilds it
    }
    const genres = store?.genres ?? {};
    return {
      key: MASTER_REFERENCES_SETTING_KEY,
      updatedAt: row?.updatedAt ?? null,
      trackCounts: Object.fromEntries(Object.entries(genres).map(([g, e]) => [g, e?.tracks?.length ?? 0])),
      genres,
      note: 'Numbers only — measured tonal vectors + rights attestations. Masters report deltas (and clamped match-EQ) against these lanes automatically once tracks exist.',
    };
  });

  // WRITER A/B — blind bench: same hook/brief/polish, Claude vs OpenAI writer
  // (OPENAI_TEXT_MODEL picks the GPT). The judge's ear decides (§1.5); the
  // reveal is base64 so nobody peeks before picking.
  const abSchema = z.object({
    genre: z.string().min(2).max(40),
    mood: z.string().max(40).optional(),
    languages: z.array(z.string().max(12)).max(5).optional(),
    theme: z.string().max(400).optional(),
    hookText: z.string().max(300).optional(),
  });
  app.post('/writer-ab', { schema: { body: abSchema } }, async (req, reply) => {
    await requireAdmin(req);
    const { workspaceId } = requireAuth(req);
    const input = abSchema.parse(req.body);
    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'admin-writer-ab');
    const charge = await app.chargeCredits({ workspaceId, key: 'lyrics_full', multiplier: 2, refTable: 'WriterAb', idempotencyKey });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
    const operation = await runIdempotentOperation({
      workspaceId,
      kind: 'admin-writer-ab',
      provider: 'text',
      idempotencyKey,
      chargeLedgerId: charge.chargeId,
      inputJson: input,
      execute: async () => {
        const { runWriterAb } = await import('../lib/writer-ab');
        try {
          const out = await runWriterAb({ workspaceId, ...input });
          if ('error' in out) {
            await app.refundCredits({ workspaceId, key: 'lyrics_full', multiplier: 2, refTable: 'WriterAb', chargeId: charge.chargeId });
            return { statusCode: 503 as const, body: out };
          }
          return {
            statusCode: 200 as const,
            body: { ...out, note: 'Judge blind, pick A or B, THEN decode reveal (base64). Same hook, same brief, same polish - the model is the only variable.' },
          };
        } catch (error) {
          await app.refundCredits({ workspaceId, key: 'lyrics_full', multiplier: 2, refTable: 'WriterAb', chargeId: charge.chargeId });
          throw error;
        }
      },
    });
    if (operation.state !== 'completed') {
      const failure = operationErrorBody(operation);
      return reply.code(failure.statusCode).send(failure.body);
    }
    return reply.code(operation.value.statusCode).send(operation.value.body);
  });

  // A3-3 — ENGINE STATUS CARD: "which engine is being used" answered at a
  // glance, live. Admin-only (real vendor names live here — §1.11).
  app.get('/engines', async (req) => {
    await requireAdmin(req);
    const { workspaceId } = requireAuth(req);
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const workspaceKey = !!workspace?.musicApiKey;
    const sunoAvailable = (workspace?.musicProvider === 'suno' && workspaceKey) || !!(process.env.SUNO_API_KEY || process.env.SUNOAPI_KEY);
    const elevenAvailable = (workspace?.musicProvider === 'eleven' && workspaceKey) ||
      !!(process.env.ELEVEN_API_KEY || process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || process.env.XI_API_KEY);
    const replicateAvailable = (workspace?.musicProvider === 'replicate' && workspaceKey) ||
      !!(process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_TOKEN);
    const firstParty = isFirstPartyWorkspace(workspaceId);
    const vocal = resolveEngineForWorkspace(undefined, {
      firstParty,
      sunoAvailable,
      elevenAvailable: elevenAvailable && (firstParty || process.env.ELEVEN_MUSIC_CUSTOMER_ROUTE_APPROVED === '1'),
      replicateAvailable,
    });
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const spend = await prisma.providerJob.groupBy({
      by: ['provider'],
      where: { kind: 'music', status: 'SUCCEEDED', createdAt: { gte: since } },
      _count: true,
      _sum: { cost: true },
    });
    const llm24 = await prisma.analyticsEvent.findMany({
      where: { name: 'llm.call', createdAt: { gte: since } },
      select: { properties: true },
      take: 2000,
    });
    const llmByBrain = new Map<string, { calls: number; estCostUsd: number }>();
    for (const e of llm24) {
      const p = (e.properties ?? {}) as { brain?: string; estCostUsd?: number | null };
      const k = p.brain ?? 'unknown';
      const cur = llmByBrain.get(k) ?? { calls: 0, estCostUsd: 0 };
      cur.calls++;
      cur.estCostUsd += p.estCostUsd ?? 0;
      llmByBrain.set(k, cur);
    }
    return {
      musicProvider: process.env.MUSIC_PROVIDER ?? '(unset)',
      resolved: {
        vocalDefault: vocal.engine,
        draftFallback: 'ace_step',
        instrumental: process.env.MUSIC_PROVIDER ?? 'unavailable',
        stemsMode: (process.env.DEMUCS_MODE ?? '').toLowerCase() || 'default (measure=local, user=replicate)',
        firstParty,
        bridgeAvailable: sunoAvailable && firstParty,
      },
      renderRouting: {
        locked: 'replicate (owner-approved configuration; fal removed entirely 2026-07-11 — any cheaper route re-enters only via a measured bake-off)',
        adapters: {
          minimax: 'minimax/music-2.6 via Replicate',
          ace_step: 'lucataco/ace-step via Replicate',
          musicgen: 'MusicGen via Replicate',
          eleven: 'Eleven Music v2 when the approved route is enabled',
          suno: 'bridge/gateway when SUNO_API_KEY set (first-party only)',
        },
      },
      brainTiers: {
        judgment: { brain: 'anthropic', configured: !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) },
        // The judgment ladder's safety net (generate.ts: Claude -> OpenAI) —
        // it was WIRED but invisible on this console (owner: "I don't see any
        // OpenAI"). Now reported: configured = the fallback is armed.
        fallback: { brain: 'openai', configured: !!process.env.OPENAI_API_KEY },
        bulk: { brain: 'cerebras', configured: !!(process.env.CEREBRAS_API_KEY || process.env.CEREBRAS_API_KEYS), model: process.env.CEREBRAS_MODEL ?? 'gpt-oss-120b' },
        last24h: Object.fromEntries(llmByBrain),
      },
      last24hRenderSpend: spend.map((s: { provider: string | null; _count: number; _sum: { cost: unknown } }) => ({ engine: s.provider, renders: s._count, costUsd: Math.round(Number(s._sum.cost ?? 0) * 100) / 100 })),
    };
  });

  // ECONOMICS: operational render efficiency and unreconciled cost telemetry.
  // Gross margin requires settlement and invoice reconciliation outside this view.
  app.get<{ Querystring: { days?: string } }>('/economics', async (req) => {
    await requireAdmin(req);
    const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [renders, failed, costAgg, keptSongs] = await Promise.all([
      prisma.providerJob.findMany({
        where: { kind: 'music', status: 'SUCCEEDED', createdAt: { gte: since } },
        select: { provider: true, cost: true, outputJson: true },
      }),
      prisma.providerJob.count({ where: { kind: 'music', status: 'FAILED', createdAt: { gte: since } } }),
      prisma.providerJob.aggregate({ where: { kind: 'music', status: 'SUCCEEDED', createdAt: { gte: since } }, _sum: { cost: true } }),
      prisma.song.count({
        where: { createdAt: { gte: since }, OR: [{ masters: { some: {} } }, { mixes: { some: {} } }, { beats: { some: {} } }] },
      }),
    ]);
    const byEngine = new Map<string, { engine: string; renders: number; costUsd: number }>();
    let candidatesRendered = 0;
    for (const r of renders) {
      const k = r.provider ?? 'unknown';
      const cur = byEngine.get(k) ?? { engine: k, renders: 0, costUsd: 0 };
      cur.renders++;
      cur.costUsd += Number(r.cost ?? 0);
      byEngine.set(k, cur);
      const bo = ((r.outputJson ?? {}) as { bestOf?: { rendered?: number } }).bestOf;
      candidatesRendered += Math.max(1, bo?.rendered ?? 1);
    }
    const totalCost = Number(costAgg._sum.cost ?? 0);

    // LLM and stem telemetry is operational evidence, not reconciled billing.
    const [llmEvents, stemEvents] = await Promise.all([
      prisma.analyticsEvent.findMany({ where: { name: 'llm.call', createdAt: { gte: since } }, select: { properties: true }, take: 10_000 }),
      prisma.analyticsEvent.findMany({ where: { name: 'stems.run', createdAt: { gte: since } }, select: { properties: true }, take: 10_000 }),
    ]);
    const llmByTier = new Map<string, { calls: number; estCostUsd: number }>();
    const llmByTask = new Map<string, { calls: number; estCostUsd: number; tier: string }>();
    // PER-BRAIN LATENCY + DEGRADATION — the lens the 2026-07-16 slowdown
    // needed: an Anthropic overload night burned full retry budgets per call
    // (7-8 min lyric stages) while the console showed nothing, and this
    // surface could not say which brain was slow or why the ladder moved.
    const llmByBrain = new Map<string, { calls: number; avgMs: number; maxMs: number; degraded: number; lastDegraded?: string }>();
    for (const e of llmEvents) {
      const p = (e.properties ?? {}) as { tier?: string; task?: string; estCostUsd?: number | null; brain?: string; ms?: number; degraded?: string };
      const tier = p.tier ?? 'judgment';
      const t = llmByTier.get(tier) ?? { calls: 0, estCostUsd: 0 };
      t.calls++; t.estCostUsd += p.estCostUsd ?? 0;
      llmByTier.set(tier, t);
      const taskKey = p.task ?? 'unlabeled';
      const tk = llmByTask.get(taskKey) ?? { calls: 0, estCostUsd: 0, tier };
      tk.calls++; tk.estCostUsd += p.estCostUsd ?? 0;
      llmByTask.set(taskKey, tk);
      const brainKey = p.brain ?? 'unknown';
      const b = llmByBrain.get(brainKey) ?? { calls: 0, avgMs: 0, maxMs: 0, degraded: 0 };
      const ms = Number(p.ms ?? 0);
      b.avgMs = (b.avgMs * b.calls + ms) / (b.calls + 1);
      b.maxMs = Math.max(b.maxMs, ms);
      b.calls++;
      if (p.degraded) { b.degraded++; b.lastDegraded = String(p.degraded).slice(0, 120); }
      llmByBrain.set(brainKey, b);
    }
    const stemsByMode = new Map<string, { runs: number; estCostUsd: number; avgWallS: number }>();
    for (const e of stemEvents) {
      const p = (e.properties ?? {}) as { mode?: string; estCostUsd?: number; wallMs?: number };
      const m = p.mode ?? 'unknown';
      const cur = stemsByMode.get(m) ?? { runs: 0, estCostUsd: 0, avgWallS: 0 };
      cur.avgWallS = (cur.avgWallS * cur.runs + (p.wallMs ?? 0) / 1000) / (cur.runs + 1);
      cur.runs++; cur.estCostUsd += p.estCostUsd ?? 0;
      stemsByMode.set(m, cur);
    }
    return {
      windowDays: days,
      renders: { succeeded: renders.length, failed, candidatesRendered },
      costUsd: { total: Math.round(totalCost * 100) / 100, perRender: renders.length ? Math.round((totalCost / renders.length) * 1000) / 1000 : null },
      keptSongs,
      rendersPerKeptSong: keptSongs ? Math.round((candidatesRendered / keptSongs) * 100) / 100 : null,
      byEngine: [...byEngine.values()].map((e) => ({ ...e, costUsd: Math.round(e.costUsd * 100) / 100 })).sort((a, b) => b.renders - a.renders),
      llm: {
        byTier: Object.fromEntries([...llmByTier].map(([k, v]) => [k, { ...v, estCostUsd: Math.round(v.estCostUsd * 1000) / 1000, note: k === 'judgment' ? 'Anthropic costs read from billing, not estimated here — calls counted' : undefined }])),
        byTask: [...llmByTask].map(([task, v]) => ({ task, ...v, estCostUsd: Math.round(v.estCostUsd * 1000) / 1000 })).sort((a, b) => b.calls - a.calls).slice(0, 12),
        byBrain: Object.fromEntries([...llmByBrain].map(([k, v]) => [k, { calls: v.calls, avgMs: Math.round(v.avgMs), maxMs: v.maxMs, degraded: v.degraded, ...(v.lastDegraded ? { lastDegraded: v.lastDegraded } : {}) }])),
      },
      stems: { byMode: Object.fromEntries([...stemsByMode].map(([k, v]) => [k, { ...v, estCostUsd: Math.round(v.estCostUsd * 100) / 100, avgWallS: Math.round(v.avgWallS) }])) },
      costEvidence: {
        classification: 'mixed_unreconciled',
        basis: 'ProviderJob cost fields and analytics estimates; not provider invoices or payment-settlement truth.',
      },
      note: 'rendersPerKeptSong is a production-efficiency signal only. Gross margin requires reconciled provider invoices, refunds, payment fees, storage, egress, and operating costs.',
    };
  });

  // ADDENDUM C-3 — the re-file review list. The scanner NEVER moves a reference
  // itself; every move is approved here (§1.5 — the user's ear outranks).
  // AUTONOMY — what the money-spending overnight jobs are, their on/off state,
  // and what they cost in the last N days, so the operator can decide + toggle.
  app.get<{ Querystring: { days?: string } }>('/autonomy', async (req) => {
    await requireAdmin(req);
    const days = Math.max(1, Math.min(30, Number(req.query.days ?? 2)));
    const since = new Date(Date.now() - days * 86_400_000);
    const flags = await allAutonomyFlags();
    // Cost = the LLM calls each job tags itself with + any paid stem runs.
    const [llm, stems] = await Promise.all([
      prisma.analyticsEvent.findMany({ where: { name: 'llm.call', createdAt: { gte: since } }, select: { properties: true } }),
      prisma.analyticsEvent.findMany({ where: { name: 'stems.run', createdAt: { gte: since } }, select: { properties: true } }),
    ]);
    const jobOf = (task: string) => /morning|drop/i.test(task) ? 'morning_drop' : /zap/i.test(task) ? 'zap_radar' : /listen|measure|backfill|refile|lexicon|gloss|verify|compound|radar/i.test(task) ? 'nightly_compound' : 'user/other';
    const cost: Record<string, { calls: number; usd: number }> = {};
    for (const e of llm) {
      const p = (e.properties ?? {}) as { task?: string; estCostUsd?: number };
      const j = jobOf(p.task ?? '');
      (cost[j] ??= { calls: 0, usd: 0 }); cost[j].calls++; cost[j].usd += p.estCostUsd ?? 0;
    }
    let stemUsd = 0;
    for (const e of stems) { const p = (e.properties ?? {}) as { estCostUsd?: number }; stemUsd += p.estCostUsd ?? 0; }
    return {
      windowDays: days,
      jobs: [
        { job: 'morning_drop', enabled: flags.morning_drop, schedule: 'daily 05:00 UTC', what: '20 hooks + A&R score + email, per enrolled artist', valueSignal: 'only useful if you want a daily hook drop' },
        { job: 'zap_radar', enabled: flags.zap_radar, schedule: `${process.env.ZAP_RUNS_PER_DAY ?? '1'}×/day`, what: 'pull charts + learn trend craft into the lake', valueSignal: 'marginal — trend seasoning' },
        { job: 'nightly_compound', enabled: flags.nightly_compound, schedule: 'daily 02:45 UTC + after each deploy (20h cooldown)', what: 're-score back-catalog (A&R) + MEASURE references + refile + forge shelf loops', valueSignal: 'the useful one — measuring makes your training actually influence renders' },
        { job: 'will_it_blow', enabled: flags.will_it_blow, schedule: 'after EVERY produced song', what: 'A&R score + one rewrite + ONE EXTRA RENDER per under-bar song (bar 90 ⇒ nearly every song)', valueSignal: 'the invisible per-song spender — off = songs ship as rendered, no auto-improve' },
      ],
      costLast: Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, { calls: v.calls, estUsd: +v.usd.toFixed(2) }])),
      paidStemsEstUsd: +stemUsd.toFixed(2),
      note: 'estUsd is ESTIMATED (chars×rate); billing truth is your Anthropic/Replicate console. Toggle any job with POST /admin/autonomy { job, enabled }.',
    };
  });
  app.post<{ Body: { job: AutonomyJob; enabled: boolean } }>('/autonomy', async (req, reply) => {
    await requireAdmin(req);
    const { job, enabled } = req.body ?? {};
    if (!['morning_drop', 'zap_radar', 'nightly_compound', 'will_it_blow'].includes(job)) return reply.code(400).send({ error: 'unknown_job' });
    await setAutonomyEnabled(job, !!enabled);
    return { job, enabled: !!enabled };
  });

  app.get('/refile', async (req) => {
    await requireAdmin(req);
    const rows = await prisma.soundReference.findMany({
      where: { recipe: { path: ['refile', 'status'], equals: 'proposed' } },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, title: true, genre: true, sourceUrl: true, createdAt: true, recipe: true },
    });
    return {
      proposals: rows.map((r: { id: string; title: string | null; genre: string | null; sourceUrl: string; createdAt: Date; recipe: unknown }) => {
        const rf = ((r.recipe ?? {}) as { refile?: { proposedLane?: string; detectedScore?: number; filedScore?: number | null } }).refile ?? {};
        return { id: r.id, title: r.title, filedLane: r.genre, proposedLane: rf.proposedLane, detectedScore: rf.detectedScore, filedScore: rf.filedScore, learnedAt: r.createdAt };
      }),
      note: 'Approve moves the reference; BOTH lanes’ profiles rebuild on next read; grounding lines update. Run {"task":"refile-references"} to scan more history.',
    };
  });

  const refileActSchema = z.object({ action: z.enum(['approve', 'reject']), lane: z.string().max(40).optional() });
  app.post<{ Params: { id: string } }>('/refile/:id', { schema: { body: refileActSchema } }, async (req, reply) => {
    await requireAdmin(req);
    const { action, lane } = refileActSchema.parse(req.body);
    const row = await prisma.soundReference.findUnique({ where: { id: req.params.id }, select: { id: true, workspaceId: true, genre: true, recipe: true } });
    if (!row) return reply.code(404).send({ error: 'reference_not_found' });
    const rec = (row.recipe ?? {}) as Record<string, unknown> & { refile?: { status?: string; proposedLane?: string } };
    if (rec.refile?.status !== 'proposed') return reply.code(409).send({ error: 'not_proposed', status: rec.refile?.status ?? 'unchecked' });
    if (action === 'reject') {
      await prisma.soundReference.update({ where: { id: row.id }, data: { recipe: { ...rec, refile: { ...rec.refile, status: 'rejected', decidedAt: new Date().toISOString() } } as never } });
      return { id: row.id, status: 'rejected' };
    }
    const target = lane ?? rec.refile?.proposedLane;
    if (!target) return reply.code(400).send({ error: 'no_target_lane' });
    await prisma.soundReference.update({
      where: { id: row.id },
      data: { genre: target, recipe: { ...rec, refile: { ...rec.refile, status: 'approved', movedFrom: row.genre, decidedAt: new Date().toISOString() } } as never },
    });
    // The ledger row — every move is on the record.
    await prisma.analyticsEvent.create({
      data: { workspaceId: row.workspaceId, name: 'refile.approved', properties: { referenceId: row.id, from: row.genre, to: target } as never },
    }).catch(() => undefined);
    return { id: row.id, status: 'approved', movedFrom: row.genre, movedTo: target, note: 'Both lanes’ profiles + grounding rebuild on next read.' };
  });

  app.post('/refile/bulk-approve', async (req) => {
    await requireAdmin(req);
    const rows = await prisma.soundReference.findMany({
      where: { recipe: { path: ['refile', 'status'], equals: 'proposed' } },
      take: 200,
      select: { id: true, workspaceId: true, genre: true, recipe: true },
    });
    let moved = 0;
    for (const row of rows) {
      const rec = (row.recipe ?? {}) as Record<string, unknown> & { refile?: { proposedLane?: string } };
      const target = rec.refile?.proposedLane;
      if (!target) continue;
      await prisma.soundReference.update({
        where: { id: row.id },
        data: { genre: target, recipe: { ...rec, refile: { ...rec.refile, status: 'approved', movedFrom: row.genre, decidedAt: new Date().toISOString() } } as never },
      });
      await prisma.analyticsEvent.create({ data: { workspaceId: row.workspaceId, name: 'refile.approved', properties: { referenceId: row.id, from: row.genre, to: target, bulk: true } as never } }).catch(() => undefined);
      moved++;
    }
    return { approved: moved, ledger: 'AnalyticsEvent refile.approved rows written per move' };
  });

  app.get('/stats', async (req) => {
    await requireAdmin(req);
    const [workspaces, users, songs, jobs, openReviews, failedJobs] = await Promise.all([
      prisma.workspace.count(),
      prisma.user.count(),
      prisma.song.count(),
      prisma.providerJob.count(),
      prisma.reviewTask.count({ where: { status: 'open' } }),
      prisma.providerJob.count({ where: { status: 'FAILED' } }),
    ]);
    return { workspaces, users, songs, jobs, openReviews, failedJobs };
  });

  app.get('/workspaces', async (req) => {
    await requireAdmin(req);
    return prisma.workspace.findMany({
      select: {
        id: true, name: true, slug: true, plan: true, creditsCents: true,
        suspendedAt: true, createdAt: true,
        _count: { select: { members: true, projects: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });

  app.post<{ Params: { id: string } }>(
    '/workspaces/:id/credits',
    { schema: { body: grantSchema } },
    async (req) => {
      await requireAdmin(req);
      const { deltaCents, reason } = grantSchema.parse(req.body);
      const [ws] = await prisma.$transaction([
        prisma.workspace.update({
          where: { id: req.params.id },
          data: { creditsCents: { increment: deltaCents } },
        }),
        prisma.creditLedger.create({
          data: {
            workspaceId: req.params.id,
            delta: deltaCents,
            reason: `admin_${deltaCents >= 0 ? 'grant' : 'clawback'}: ${reason}`,
          },
        }),
      ]);
      return { id: ws.id, creditsCents: ws.creditsCents };
    }
  );

  app.post<{ Params: { id: string } }>('/workspaces/:id/suspend', async (req) => {
    await requireAdmin(req);
    const ws = await prisma.workspace.update({
      where: { id: req.params.id },
      data: { suspendedAt: new Date() },
    });
    return { id: ws.id, suspendedAt: ws.suspendedAt };
  });

  app.post<{ Params: { id: string } }>('/workspaces/:id/unsuspend', async (req) => {
    await requireAdmin(req);
    const ws = await prisma.workspace.update({
      where: { id: req.params.id },
      data: { suspendedAt: null },
    });
    return { id: ws.id, suspendedAt: null };
  });

  /** Re-enqueue a failed job from its persisted inputJson. */
  app.post<{ Params: { id: string } }>('/jobs/:id/retry', async (req, reply) => {
    await requireAdmin(req);
    const job = await prisma.providerJob.findUniqueOrThrow({ where: { id: req.params.id }, include: { outbox: true } });
    if (job.status !== 'FAILED') return reply.code(400).send({ error: 'only_failed_jobs' });
    if (!job.outbox) return reply.code(409).send({ error: 'legacy_job_payload_unavailable', message: 'This pre-outbox job cannot be replayed safely; start the action again.' });

    await prisma.$transaction([
      prisma.providerJob.update({
        where: { id: job.id },
        data: { status: 'QUEUED', errorJson: Prisma.DbNull, startedAt: null, finishedAt: null },
      }),
      prisma.jobOutbox.update({
        where: { id: job.outbox.id },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), dispatchedAt: null, lastError: null },
      }),
    ]);
    await app.dispatchPendingJobs();
    return { id: job.id, status: 'requeued' };
  });

  app.get('/jobs/failed', async (req) => {
    await requireAdmin(req);
    return prisma.providerJob.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
}

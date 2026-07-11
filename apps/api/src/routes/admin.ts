/**
 * Admin pathway — operator tools gated by ADMIN_EMAILS (comma-separated env).
 * Same pattern as the GOVSURE remediation: no separate role system, just an
 * allowlist of operator emails checked against the authenticated user.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma, allAutonomyFlags, setAutonomyEnabled, type AutonomyJob } from '@afrohit/db';
import { isInternalMode, requireAuth } from '../middleware/auth';
import { isFirstPartyWorkspace, resolveEngineForWorkspace } from '@afrohit/shared';
import { enqueue, QUEUES, type QueueName } from '../lib/queue';

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  const { userId } = requireAuth(req);
  // WO-1 SAFETY RAIL: the API is publicly reachable, and in internal mode
  // requireAuth never rejects — so "the one resolved user IS the operator" made
  // every admin/trigger route (spend triggers included) open to the internet.
  // Internal mode now requires the ADMIN_SECRET header. No secret configured =
  // 401 for everyone (set ADMIN_SECRET on the API service; send x-admin-secret).
  if (isInternalMode()) {
    const secret = process.env.ADMIN_SECRET ?? '';
    const given = String(req.headers['x-admin-secret'] ?? '');
    if (!secret) {
      throw Object.assign(new Error('admin locked: set ADMIN_SECRET on the API service and send the x-admin-secret header'), { statusCode: 401 });
    }
    if (given !== secret) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    return;
  }
  // Multi-user modes: gate by ADMIN_EMAILS allowlist.
  const allow = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) throw Object.assign(new Error('admin not configured'), { statusCode: 403 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user || !allow.includes(user.email.toLowerCase())) {
    throw Object.assign(new Error('forbidden'), { statusCode: 403 });
  }
}

const grantSchema = z.object({
  deltaCents: z.number().int(), // positive = grant, negative = clawback (1/100-cent units)
  reason: z.string().min(3).max(200),
});

export default async function admin(app: FastifyInstance) {
  // One-tap compounding: run the lake jobs NOW instead of waiting for tonight.
  const runSchema = z.object({ task: z.enum(['nightly-compound', 'measure-backfill', 'learn-backfill', 'listen-back', 'refile-references', 'mine-lexicon', 'lexicon-research', 'wiktionary-harvest', 'wiktionary-burst', 'lexicon-gloss', 'lexicon-verify']) });
  app.post('/run', { schema: { body: runSchema } }, async (req, reply) => {
    await requireAdmin(req);
    const { task } = runSchema.parse(req.body);
    // Background tasks run on the LAKE queue — they never contend with renders.
    await enqueue({ queue: app.queues.lake, name: task, payload: {} });
    reply.code(202);
    return { queued: task, note: 'Running on the worker now — watch worker logs; results land in /lanes/inventory.' };
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
    const charge = await app.chargeCredits({ workspaceId, key: 'lyrics_full', multiplier: 2, refTable: 'WriterAb' });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
    const { runWriterAb } = await import('../lib/writer-ab');
    const out = await runWriterAb({ workspaceId, ...input });
    if ('error' in out) return reply.code(503).send(out);
    return { ...out, note: 'Judge blind, pick A or B, THEN decode reveal (base64). Same hook, same brief, same polish — the model is the only variable.' };
  });

  // A3-3 — ENGINE STATUS CARD: "which engine is being used" answered at a
  // glance, live. Admin-only (real vendor names live here — §1.11).
  app.get('/engines', async (req) => {
    await requireAdmin(req);
    const sunoAvailable = !!process.env.SUNO_API_KEY;
    const firstParty = isFirstPartyWorkspace('(internal)');
    const vocal = resolveEngineForWorkspace(undefined, { firstParty, sunoAvailable });
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
        instrumental: process.env.MUSIC_PROVIDER ?? 'stub',
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
          suno: 'bridge/gateway when SUNO_API_KEY set (first-party only)',
        },
      },
      brainTiers: {
        judgment: { brain: 'anthropic', configured: !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) },
        bulk: { brain: 'cerebras', configured: !!(process.env.CEREBRAS_API_KEY || process.env.CEREBRAS_API_KEYS), model: process.env.CEREBRAS_MODEL ?? 'gpt-oss-120b' },
        last24h: Object.fromEntries(llmByBrain),
      },
      last24hRenderSpend: spend.map((s) => ({ engine: s.provider, renders: s._count, costUsd: Math.round(Number(s._sum.cost ?? 0) * 100) / 100 })),
    };
  });

  // WO-15 — ECONOMICS: marginal cost per render and RENDERS-PER-KEPT-SONG (the
  // margin number; the ear's success metric — quality structurally lowers cost).
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

    // A3-6 — LLM spend by tier/task + stems by mode + projected savings vs the
    // OLD routing (assumptions stated in the payload; costs are estimates).
    const [llmEvents, stemEvents] = await Promise.all([
      prisma.analyticsEvent.findMany({ where: { name: 'llm.call', createdAt: { gte: since } }, select: { properties: true }, take: 10_000 }),
      prisma.analyticsEvent.findMany({ where: { name: 'stems.run', createdAt: { gte: since } }, select: { properties: true }, take: 10_000 }),
    ]);
    const llmByTier = new Map<string, { calls: number; estCostUsd: number }>();
    const llmByTask = new Map<string, { calls: number; estCostUsd: number; tier: string }>();
    let bulkCalls = 0;
    for (const e of llmEvents) {
      const p = (e.properties ?? {}) as { tier?: string; task?: string; brain?: string; estCostUsd?: number | null };
      const tier = p.tier ?? 'judgment';
      const t = llmByTier.get(tier) ?? { calls: 0, estCostUsd: 0 };
      t.calls++; t.estCostUsd += p.estCostUsd ?? 0;
      llmByTier.set(tier, t);
      const taskKey = p.task ?? 'unlabeled';
      const tk = llmByTask.get(taskKey) ?? { calls: 0, estCostUsd: 0, tier };
      tk.calls++; tk.estCostUsd += p.estCostUsd ?? 0;
      llmByTask.set(taskKey, tk);
      if (tier === 'bulk' && p.brain === 'cerebras') bulkCalls++;
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
    // Projected savings vs the OLD routing. ASSUMPTIONS (stated, not billing truth):
    // local stems would have cost ~$0.10/run on Replicate; a bulk-tier call would
    // have run on the judgment brain at ~$0.01/call; per-engine render savings =
    // assumed old Replicate price minus the recorded cost, floored at 0.
    const OLD_RENDER_PRICE: Record<string, number> = { ace_step: 0.1, minimax: 0.12, replicate: 0.05 };
    let renderSavings = 0;
    for (const [k, v] of byEngine) {
      const old = OLD_RENDER_PRICE[k];
      if (old) renderSavings += Math.max(0, v.renders * old - v.costUsd);
    }
    const localStemRuns = stemsByMode.get('local')?.runs ?? 0;
    const stemsSavings = localStemRuns * 0.1;
    const llmSavings = Math.max(0, bulkCalls * 0.01 - (llmByTier.get('bulk')?.estCostUsd ?? 0));
    const projectedSavingsUsd = Math.round((renderSavings + stemsSavings + llmSavings) * 100) / 100;

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
      },
      stems: { byMode: Object.fromEntries([...stemsByMode].map(([k, v]) => [k, { ...v, estCostUsd: Math.round(v.estCostUsd * 100) / 100, avgWallS: Math.round(v.avgWallS) }])) },
      projectedSavings: {
        usd: projectedSavingsUsd,
        window: `${days}d`,
        assumptions: 'old routing = Replicate renders (ace $0.10 / minimax $0.12 / musicgen $0.05), paid stems $0.10/run, bulk LLM calls on the judgment brain ~$0.01/call. Estimates for pricing sign-off (§7.4), not billing truth.',
      },
      note: 'rendersPerKeptSong is THE margin number — the ear lowering it is the moat (§E2). Costs are provider estimates recorded per job.',
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
        { job: 'nightly_compound', enabled: flags.nightly_compound, schedule: 'daily 02:45 UTC + after each deploy', what: 're-score back-catalog (A&R) + MEASURE references + refile', valueSignal: 'the useful one — measuring makes your training actually influence renders' },
      ],
      costLast: Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, { calls: v.calls, estUsd: +v.usd.toFixed(2) }])),
      paidStemsEstUsd: +stemUsd.toFixed(2),
      note: 'estUsd is ESTIMATED (chars×rate); billing truth is your Anthropic/Replicate console. Toggle any job with POST /admin/autonomy { job, enabled }.',
    };
  });
  app.post<{ Body: { job: AutonomyJob; enabled: boolean } }>('/autonomy', async (req, reply) => {
    await requireAdmin(req);
    const { job, enabled } = req.body ?? {};
    if (!['morning_drop', 'zap_radar', 'nightly_compound'].includes(job)) return reply.code(400).send({ error: 'unknown_job' });
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
      proposals: rows.map((r) => {
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
    const job = await prisma.providerJob.findUniqueOrThrow({ where: { id: req.params.id } });
    if (job.status !== 'FAILED') return reply.code(400).send({ error: 'only_failed_jobs' });

    const queueForKind: Record<string, QueueName> = {
      music: QUEUES.music,
      voice: QUEUES.voice,
      voice_profile: QUEUES.voice,
      mix: QUEUES.mix,
      master: QUEUES.master,
      image: QUEUES.image,
      video: QUEUES.video,
      export: QUEUES.exportBundle,
    };
    const queueName = queueForKind[job.kind];
    if (!queueName) return reply.code(400).send({ error: `no_queue_for_kind:${job.kind}` });

    await prisma.providerJob.update({
      where: { id: job.id },
      data: { status: 'QUEUED', errorJson: undefined, startedAt: null, finishedAt: null },
    });
    await enqueue({
      queue: app.queues[queueName],
      name: job.kind === 'voice_profile' ? 'setup-voice-profile' : `retry-${job.kind}`,
      payload: { jobId: job.id, workspaceId: job.workspaceId, projectId: job.projectId, ...(job.inputJson as Record<string, unknown>) },
    });
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

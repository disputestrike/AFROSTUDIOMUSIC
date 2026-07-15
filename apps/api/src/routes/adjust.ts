/**
 * §10 — ADJUST SONG: hear → classify → confirm → plan → repair → compare.
 *
 * The contract, verbatim from the FINAL INSTRUCTION:
 *  - the repair plan is shown BEFORE any spend (GET lane-report / POST plan cost $0);
 *  - the USER confirms or overrides the target lane before execution (their ear
 *    outranks the machine's — anti-pattern #8);
 *  - execute repairs ONLY the failing layer by dispatching to the EXISTING routes
 *    (material rebuild / steered re-render / master chain / hook rewrite) via
 *    app.inject — same auth, same credits, same steering, zero duplicated logic;
 *  - never regenerate the whole song unless the lane itself is wrong (and even
 *    then, lyrics/hook are preserved by the material + regenerate paths);
 *  - the response DISCLOSES which route ran. Compare/revert of the resulting take
 *    already exists (POST /songs/:id/versions/revert).
 */
import type { FastifyInstance } from 'fastify';
import { generateJson } from '@afrohit/ai';
import { snapshotLyricVersion } from '../lib/lyric-versions';
import { createQueuedProviderJob, scopedRequestKey, type SuccessfulCharge } from '../lib/queued-job';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';
import { buildLaneReport, planAdjustRoutes, classifyAllLanes, unseededForLane, type AdjustRoute } from '../lib/lane-report';
import type { MeasuredAnalysis } from '@afrohit/shared';
import {
  playableArrangement,
  playableAssetHistory,
  playableAssetRef,
} from '../lib/current-playable-asset';

export default async function adjust(app: FastifyInstance) {
  // §9 — the producer-brain block for a song. Read-only, always honest.
  app.get<{ Params: { id: string } }>('/:id/lane-report', async (req) => {
    const { workspaceId } = requireAuth(req);
    return buildLaneReport(workspaceId, req.params.id);
  });

  // §10 steps 2–5 — hear / classify(all lanes) / plan. ZERO spend.
  const planSchema = z.object({ targetLane: z.string().max(40).optional() });
  app.post<{ Params: { id: string } }>('/:id/adjust/plan', { schema: { body: planSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const body = planSchema.parse(req.body ?? {});
    const report = await buildLaneReport(workspaceId, req.params.id);
    if (!report.available) return reply.code(422).send({ error: 'not_measurable', ...report });

    // User override of the target lane (§10 step 4) — rebuild the report against it.
    const finalReport = body.targetLane && body.targetLane !== report.targetLane
      ? await (async () => {
          // ownership already verified by buildLaneReport above (BeatAsset has no workspaceId column)
          const beat = await prisma.beatAsset.findFirst({ where: { songId: req.params.id }, orderBy: { createdAt: 'desc' }, select: { id: true, meta: true } });
          const meta = (beat?.meta ?? {}) as Record<string, unknown>;
          await prisma.beatAsset.update({ where: { id: beat!.id }, data: { meta: { ...meta, assessedGenre: body.targetLane } as never } });
          return buildLaneReport(workspaceId, req.params.id);
        })()
      : report;

    return {
      report: finalReport,
      routes: planAdjustRoutes(finalReport),
      spend: 'NOTHING has been charged. Executing a route below charges exactly what that existing action always costs.',
    };
  });

  // §10 step 6 — execute ONE confirmed route by dispatching to the existing endpoint.
  const execSchema = z.object({
    route: z.enum(['rebuild_beat_material', 'rerender_steered', 'remix_only', 'rewrite_hook']),
    targetLane: z.string().max(40).optional(),
  });
  app.post<{ Params: { id: string } }>('/:id/adjust/execute', { schema: { body: execSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const body = execSchema.parse(req.body);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      select: { id: true, projectId: true, project: { select: { genre: true, bpm: true } } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const genre = body.targetLane ?? song.project.genre ?? 'afrobeats';
    // §1.5 — the user's confirmed lane outranks the stored one, on EVERY repair
    // route: rerender/hooks/writers all read project.genre server-side, so a
    // targetLane that isn't persisted was silently ignored by 3 of 4 routes.
    if (body.targetLane && body.targetLane !== song.project.genre) {
      await prisma.project.update({ where: { id: song.projectId }, data: { genre: body.targetLane } });
    }

    const headers = {
      authorization: (req.headers.authorization as string) ?? '',
      'content-type': 'application/json',
      cookie: (req.headers.cookie as string) ?? '',
      ...(typeof req.headers['idempotency-key'] === 'string' ? { 'idempotency-key': req.headers['idempotency-key'] } : {}),
    };
    const dispatch: Record<AdjustRoute['route'], { method: 'POST'; url: string; payload: unknown }> = {
      rebuild_beat_material: { method: 'POST', url: '/api/v1/materials/auto', payload: { projectId: song.projectId, genre, bpm: song.project.bpm ?? undefined, songId: song.id } },
      // Current providers cannot prove full-song audio conditioning; request an
      // honest unconditioned rerender until a supported route is connected.
      rerender_steered: { method: 'POST', url: `/api/v1/songs/${song.id}/regenerate-beat`, payload: {} },
      remix_only: { method: 'POST', url: `/api/v1/songs/${song.id}/master`, payload: {} },
      rewrite_hook: { method: 'POST', url: `/api/v1/projects/${song.projectId}/hooks`, payload: {} },
    };
    const d = dispatch[body.route];
    const res = await app.inject({ method: d.method, url: d.url, headers, payload: d.payload as never });
    const out = res.json() as Record<string, unknown>;
    return reply.code(res.statusCode >= 400 ? res.statusCode : 202).send({
      dispatched: `${d.method} ${d.url}`, // disclosed — the user sees exactly which repair ran
      route: body.route,
      targetLane: genre,
      result: out,
      next: 'Poll the returned job, then compare takes (versions panel) — the winner is explained in lane terms, never “this one was louder.”',
    });
  });

  // Classify an arbitrary MeasuredAnalysis against ALL profiled lanes (Listen page §9).
  app.post('/classify', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const body = (req.body ?? {}) as { analysis?: MeasuredAnalysis; songId?: string };
    let analysis = body.analysis;
    if (!analysis && body.songId) {
      const beat = await prisma.beatAsset.findFirst({ where: { songId: body.songId, song: { workspaceId } }, orderBy: { createdAt: 'desc' }, select: { meta: true } });
      analysis = ((beat?.meta ?? {}) as { measured?: MeasuredAnalysis }).measured;
    }
    if (!analysis) return reply.code(400).send({ error: 'need_analysis_or_measured_songId' });
    const dist = await classifyAllLanes(workspaceId, analysis);
    return { ...dist, lexiconUnseeded: dist.distribution[0] ? await unseededForLane(dist.distribution[0].lane) : [] };
  });
  // ---------------------------------------------------------------------------
  // TALK TO YOUR SONG — the chat editor. One instruction -> ONE typed op ->
  // executed (existing routes via inject, timeline ops via the song-edit job)
  // -> a NEW VERSION that auto-plays and reverts in one tap. The differentiator.
  // section map for the Arrange strip (same math the chat brain sees)
  app.get<{ Params: { id: string } }>('/:id/sections', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        masters: { orderBy: { createdAt: 'asc' } },
        mixes: { orderBy: { createdAt: 'asc' } },
        beats: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const history = playableAssetHistory(song);
    const currentAudio = history.at(-1) ?? null;
    const arrangement = playableArrangement(history, currentAudio);
    const dur = arrangement?.durationS ?? 0;
    const bs = arrangement?.boundaries ?? [];
    const edges = [0, ...bs, dur];
    return {
      currentAudio: playableAssetRef(currentAudio),
      durationS: dur || null,
      sections: dur ? edges.slice(0, -1).map((s0, i) => ({ index: i + 1, label: `S${i + 1}`, startS: Math.round(s0), endS: Math.round(edges[i + 1]!) })) : [],
    };
  });

  app.post<{ Params: { id: string }; Body: { message: string; versionIndex?: number } }>('/:id/chat', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const message = String((req.body as { message?: string })?.message ?? '').slice(0, 500);
    const versionIndex = (req.body as { versionIndex?: number })?.versionIndex;
    if (!message.trim()) return reply.code(400).send({ error: 'empty_message' });
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        project: { select: { genre: true } },
        masters: { orderBy: { createdAt: 'asc' } },
        mixes: { orderBy: { createdAt: 'asc' } },
        lyric: true,
        beats: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    // TALK TO THE CURRENT VERSION — the freshest of master/mix/beat (the same
    // rule the catalog player uses). The old masters[0]??beats[0] pick silently
    // edited a STALE master when a re-sing/upload was newer ("you should be
    // talking to the current version, not the previous one"). An explicit
    // versionIndex (from the chat's version picker) overrides.
    const audioHistory = playableAssetHistory(song);
    const currentAudio = audioHistory.at(-1) ?? null;
    let sourceAudio = currentAudio;
    let sourceUrl = sourceAudio?.url;
    let talkingTo = 'current version';
    if (versionIndex != null) {
      sourceAudio = audioHistory[versionIndex] ?? null;
      sourceUrl = sourceAudio?.url;
      talkingTo = `version ${versionIndex + 1} of ${audioHistory.length}`;
      if (!sourceUrl) return reply.code(400).send({ error: 'version_not_found', message: `No version #${versionIndex + 1} — pick one from the selector.` });
    }
    if (!sourceUrl) return reply.code(400).send({ error: 'no_audio_yet', message: 'Render the song first — then talk to it.' });
    const arrangement = playableArrangement(audioHistory, sourceAudio);
    const durationS = arrangement?.durationS ?? 180;
    const bounds = arrangement?.boundaries ?? [];
    const secEdges = [0, ...bounds, durationS];
    const sectionMap = secEdges.slice(0, -1).map((s0, i) => `S${i + 1} ${Math.round(s0)}–${Math.round(secEdges[i + 1]!)}s`).join(' · ');
    const bpm = arrangement?.bpm ?? null;

    const plan = await generateJson<{ reply: string; op: null | Record<string, unknown> }>({
      tier: 'bulk',
      task: 'adjust-op-parse',
      system: `You are this song's producer at the desk. Song: genre ${song.project?.genre ?? 'unknown'}, duration ${Math.round(durationS)}s${bpm ? `, ~${Math.round(bpm)} BPM` : ''}.
SECTION MAP: ${sectionMap || 'not measured yet'}.\nParse the artist's instruction into EXACTLY ONE op (the FIRST actionable step if they asked for several — say what's next in reply). Times like "1:20" become SECONDS. Ops:
- {"kind":"transform","tempo":0.5-1.5?,"semitones":-6..6?}  // speed / key
- {"kind":"remaster","preset":"warm|loud|club|radio"}       // tone/loudness feel incl reverb-ish "warm"
- {"kind":"regen_beat"}                                      // new sound, SAME structure (self-clone)
- {"kind":"add_layer","prompt":"<instrument direction>"}     // e.g. add snares/keys/strings texture
- {"kind":"add_fill","timesS":[80]}                          // drum fill at timestamps (seconds)
- {"kind":"cut","fromS":45,"toS":60}                         // remove a region
- {"kind":"move_section","fromIndex":3,"toIndex":2}          // Arrange: move a section (1-based, see map)
- {"kind":"duplicate_section","index":3}                     // Arrange: repeat a section right after itself
- {"kind":"stem_fx","stem":"vocals|drums|bass|other","fx":"reverb|eq_low|eq_high|gain","amount":0-1}  // fx on ONE stem only
- {"kind":"vocal_drop","fromS":45,"toS":60}                  // silence ONLY the vocal in a region (open a verse)
- {"kind":"resing_section","index":3}                        // re-play a section: FRESH beat under the ORIGINAL vocal
- {"kind":"rename","title":"Midnight in Lekki"}              // rename ONLY (label surgery, instant)
- {"kind":"rebuild_hook","title":"Midnight in Lekki"}        // creative surgery: rewrite the HOOK around this name, then re-sing
- {"kind":"make_bigger"}                                     // "make it longer / add a verse / more complex": A&R rewrite grows the song, then re-sings
If nothing fits, op:null and coach them in reply (mixer, versions, adjust exist). Return {"reply","op"} ONLY. reply is UNDER 15 WORDS — no preamble, no explaining, just the move.`,
      user: message,
      maxTokens: 700,
      temperature: 0.2,
    }).catch((err: unknown) => ({ reply: `The chat brain errored — ${String((err as Error)?.message ?? err).slice(0, 140)}`, op: null as null }));

    const op = plan.op as (null | { kind?: string } & Record<string, unknown>);
    if (!op?.kind) return { reply: plan.reply, dispatched: null };

    const headers: Record<string, string> = {};
    for (const h of ['authorization', 'x-workspace-id', 'cookie']) {
      const v = req.headers[h]; if (typeof v === 'string') headers[h] = v;
    }
    if (typeof req.headers['idempotency-key'] === 'string') headers['idempotency-key'] = req.headers['idempotency-key'];
    headers['content-type'] = 'application/json';

    if (op.kind === 'rename') {
      const newTitle = String((op as { title?: unknown }).title ?? '').trim().slice(0, 80);
      if (!newTitle) return { reply: 'Give me the name.', dispatched: null };
      await prisma.song.update({ where: { id: song.id }, data: { title: newTitle } });
      // The catalog displays lyric.title ahead of song.title — without this the
      // rename "never sticks" on screen.
      await prisma.lyricDraft.updateMany({ where: { songId: song.id }, data: { title: newTitle } });
      return { reply: `Renamed: “${newTitle}”.`, dispatched: 'rename' };
    }

    if (op.kind === 'rebuild_hook') {
      const anchor = String((op as { title?: unknown }).title ?? '').trim().slice(0, 80);
      if (!anchor) return { reply: 'Give me the name to build the hook around.', dispatched: null };
      if (!song.lyric?.body) return { reply: 'No lyric on this song yet — generate one first.', dispatched: null };
      const rw = await generateJson<{ body: string }>({
        tier: 'bulk',
        task: 'hook-surgery',
        system: 'You are a hit songwriter performing HOOK SURGERY. Rewrite ONLY the hook/chorus sections of the lyric so the given TITLE is sung as their centerpiece (or a natural in-language variant). Keep every verse, bridge, section header, and language EXACTLY as-is. No production words in lyrics. Return {"body"} = the FULL lyric with only hooks changed.',
        user: `TITLE: "${anchor}"

LYRIC:
${song.lyric.body.slice(0, 4000)}`,
        maxTokens: 2500,
      }).catch(() => null);
      if (!rw?.body) return { reply: 'Hook surgery failed — try again.', dispatched: null };
      await snapshotLyricVersion(song.lyric.id, 'before hook rebuild');
      // cleanVersion outranks body at re-sing time — leaving the old one in
      // place made the engine sing the PRE-rebuild lyric.
      await prisma.lyricDraft.update({ where: { id: song.lyric.id }, data: { body: rw.body, title: anchor, cleanVersion: null } });
      await prisma.song.update({ where: { id: song.id }, data: { title: anchor } });
      const res = await app.inject({ method: 'POST', url: `/api/v1/songs/${song.id}/regenerate-beat`, headers, payload: {} });
      const body = res.json() as Record<string, unknown>;
      if (res.statusCode >= 400) {
        const why = String(body.message ?? body.error ?? `HTTP ${res.statusCode}`).slice(0, 160);
        return { reply: `Rebuilt the hook around “${anchor}”, but the re-sing didn't start: ${why}`, dispatched: null, jobId: null, status: res.statusCode };
      }
      return { reply: `Hook rebuilt around “${anchor}” — re-singing now.`, dispatched: 'rebuild_hook', jobId: (body.jobId as string) ?? null };
    }

    if (op.kind === 'transform' || op.kind === 'remaster' || op.kind === 'regen_beat' || op.kind === 'make_bigger') {
      const d = op.kind === 'transform'
        ? { url: `/api/v1/songs/${song.id}/transform`, payload: { tempo: op.tempo, semitones: op.semitones } }
        : op.kind === 'remaster'
          // The chat speaks feel-words; the worker speaks MASTER_TARGETS keys —
          // unmapped names silently fell back to -14, ignoring the user's ask.
          ? { url: `/api/v1/songs/${song.id}/master`, payload: { preset: ({ warm: 'breathe_-16.5', loud: 'afro_stream_-9', club: 'club_-9', radio: 'streaming_lufs_-14' } as Record<string, string>)[String(op.preset ?? 'warm')] ?? op.preset } }
          : op.kind === 'make_bigger'
            ? { url: `/api/v1/songs/${song.id}/make-it-bigger`, payload: {} }
            : { url: `/api/v1/songs/${song.id}/regenerate-beat`, payload: {} };
      const res = await app.inject({ method: 'POST', url: d.url, headers, payload: d.payload as never });
      const body = res.json() as Record<string, unknown>;
      // Honest failures: a 4xx here used to ride back inside a 200 with the
      // upbeat plan.reply — the user saw "on it!" and nothing ever happened.
      if (res.statusCode >= 400) {
        const why = String(body.message ?? body.error ?? `HTTP ${res.statusCode}`).slice(0, 160);
        return { reply: `Couldn't run ${op.kind}: ${why}`, dispatched: null, jobId: null, status: res.statusCode };
      }
      return { reply: plan.reply, dispatched: op.kind, jobId: (body.jobId as string) ?? null, status: res.statusCode };
    }

    // timeline ops -> the song-edit job
    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, `song-edit:${op.kind}`);
    const providerBacked = ['add_layer', 'stem_fx', 'vocal_drop', 'resing_section'].includes(op.kind);
    let charge: SuccessfulCharge | undefined;
    if (providerBacked) {
      const charged = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s', refTable: 'Song', refId: song.id, idempotencyKey });
      if (!charged.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charged });
      charge = charged;
    }
    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.music,
      jobName: 'song-edit',
      workspaceId,
      projectId: song.projectId,
      kind: 'music',
      provider: 'song-chat',
      inputJson: { songId: song.id, sourceAsset: playableAssetRef(sourceAudio), op },
      charge,
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId, projectId: song.projectId, songId: song.id, sourceUrl, sourceAsset: playableAssetRef(sourceAudio), genre: song.project?.genre, durationS, bpm, boundaries: bounds, op }),
    });
    reply.code(202);
    return { reply: plan.reply, dispatched: op.kind, jobId: job.jobId, replayed: job.replayed, talkingTo, sourceAudio: playableAssetRef(sourceAudio) };
  });

}

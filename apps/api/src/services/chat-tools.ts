/**
 * Tool dispatcher for Studio Chat.
 *
 * Each tool corresponds to one of the prompts/studio-chat.ts entries. We
 * intentionally re-use the credit-charging and queue-dispatch logic so that
 * a tool call from chat is indistinguishable from a direct API call.
 *
 * Every tool returns a plain object. The model uses these for the
 * second-turn summary.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { prompts, responsesJson, scoreItems, runRightsCheck, canonicalReceiptHash, directorRefineHooks, researchTrends, enrichLyricsForVocals } from '@afrohit/ai';
import { enqueue } from '../lib/queue';
import { memoryContext, recordFeedback } from './artist-memory';

type Ctx = {
  app: FastifyInstance;
  workspaceId: string;
  userId: string;
  projectId: string | null;
};

export async function runChatTool(args: Ctx & { name: string; args: Record<string, unknown> }) {
  const { name, args: a, ...ctx } = args;
  switch (name) {
    case 'research_trends':
      return researchTrendsTool(ctx, a as never);
    case 'polish_brief':
      return polishBrief(ctx, String(a.rawIdea ?? ''));
    case 'generate_hooks':
      return generateHooks(ctx, Number(a.count ?? 20));
    case 'score_hooks':
      return scoreHooks(ctx, (a.hookIds as string[]) ?? []);
    case 'approve_hook':
      return approveHook(ctx, String(a.hookId));
    case 'generate_lyrics':
      return generateLyrics(ctx, String(a.hookId), Boolean(a.cleanVersion ?? true));
    case 'create_beat_job':
      return createBeatJob(ctx, a as never);
    case 'render_demo_vocal':
      return renderDemoVocal(ctx, a as never);
    case 'generate_cover_art':
      return generateCoverArt(ctx, a as never);
    case 'generate_video_storyboard':
      return generateStoryboard(ctx, a as never);
    case 'render_video':
      return renderVideo(ctx, a as never);
    case 'run_rights_check':
      return rightsCheck(ctx, String(a.songId));
    case 'create_release_kit':
      return createReleaseKit(ctx, String(a.songId));
    case 'request_approval':
      return requestApproval(ctx, String(a.gate), String(a.note ?? ''));
    default:
      return { error: `unknown_tool:${name}` };
  }
}

// -------------------------------------------------------------------------

async function researchTrendsTool(ctx: Ctx, a: { genre?: string; region?: string; query?: string }) {
  const project = ctx.projectId
    ? await prisma.project.findFirst({ where: { id: ctx.projectId, workspaceId: ctx.workspaceId } })
    : null;
  const trends = await researchTrends({
    genre: a.genre ?? project?.genre,
    region: a.region,
    query: a.query,
  });
  if (!trends) {
    return { error: 'trends_unavailable', hint: 'Set TAVILY_API_KEY on the api service to enable live trend research.' };
  }
  return { digest: trends.digest, sources: trends.sources };
}

async function polishBrief(ctx: Ctx, rawIdea: string) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'brief_polish' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const polished = await responsesJson<{
    mood: string; topic: string; language: string[]; audience: string;
    bpm: number; references: Array<{ name: string; lane: string }>; notes: string;
  }>({
    system: prompts.BRIEF_POLISH_SYSTEM,
    user: JSON.stringify({ rawIdea }),
    temperature: 0.4,
  });
  const brief = await prisma.songBrief.create({
    data: {
      projectId: ctx.projectId,
      mood: polished.mood, topic: polished.topic,
      language: polished.language ?? [], audience: polished.audience,
      bpm: polished.bpm, references: polished.references ?? [], notes: polished.notes,
    },
  });
  return { briefId: brief.id, polished };
}

async function generateHooks(ctx: Ctx, count: number) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const project = await prisma.project.findFirstOrThrow({
    where: { id: ctx.projectId, workspaceId: ctx.workspaceId },
    include: { artist: true, briefs: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  const charge = await ctx.app.chargeCredits({
    workspaceId: ctx.workspaceId, key: 'hooks_batch_20',
    multiplier: Math.max(1, Math.ceil(count / 20)),
  });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };

  const tasteMemory = await memoryContext(project.artistId);
  const trendData = await researchTrends({ genre: project.genre }).catch(() => null);
  const trends = trendData?.digest;
  const result = await responsesJson<{ hooks: Array<{ text: string; language?: string[]; bpm?: number; syllablePattern?: string; melodyNotes?: string; callResponse?: boolean }> }>({
    system: prompts.HOOK_SYSTEM,
    user: prompts.hookUserPrompt({ artist: project.artist as never, brief: project.briefs[0] as never, count, tasteMemory, trends }),
    temperature: 0.95,
    maxOutputTokens: 4_000,
  });

  // Multi-model A&R: Claude refines + scores GPT's drafts (falls back to drafts).
  const drafts = (result.hooks ?? []).map((h) => h.text);
  const refined = await directorRefineHooks({
    artist: project.artist as never,
    brief: project.briefs[0] as never,
    drafts,
    tasteMemory,
    trends,
  });

  const rows = refined
    ? refined.map((h) => ({
        text: h.text,
        language: (h.language ?? []) as never,
        score: typeof h.score === 'number' ? h.score : null,
        meta: { reason: h.reason, needsNativeReview: h.needsNativeReview, director: 'claude' } as never,
      }))
    : (result.hooks ?? []).map((h) => ({
        text: h.text,
        language: (h.language ?? []) as never,
        score: null as number | null,
        meta: { syllablePattern: h.syllablePattern, director: 'none' } as never,
      }));

  const created = await prisma.$transaction(
    rows.map((r) =>
      prisma.hookCandidate.create({
        data: { projectId: project.id, text: r.text, language: r.language, score: r.score, meta: r.meta },
      })
    )
  );
  created.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return {
    hooks: created.map((c) => ({ id: c.id, text: c.text, score: c.score })),
    director: refined ? 'claude' : 'none',
  };
}

async function scoreHooks(ctx: Ctx, hookIds: string[]) {
  if (!hookIds.length) return { error: 'no_hookIds' };
  const hooks = await prisma.hookCandidate.findMany({
    where: { id: { in: hookIds }, project: { workspaceId: ctx.workspaceId } },
    include: { project: { include: { artist: true } } },
  });
  if (!hooks.length) return { error: 'no_hooks' };
  const charge = await ctx.app.chargeCredits({
    workspaceId: ctx.workspaceId, key: 'taste_score_batch_50',
    multiplier: Math.ceil(hooks.length / 50),
  });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };

  const scores = await scoreItems({
    artist: hooks[0]!.project.artist as never,
    items: hooks.map((h) => ({ id: h.id, text: h.text, kind: 'hook' })),
  });
  await Promise.all(
    scores.map((s) =>
      prisma.hookCandidate.update({ where: { id: s.id }, data: { score: s.overall } })
    )
  );
  return { scores: scores.map((s) => ({ id: s.id, overall: s.overall, notes: s.notes })) };
}

async function approveHook(ctx: Ctx, hookId: string) {
  const hook = await prisma.hookCandidate.findFirstOrThrow({
    where: { id: hookId, project: { workspaceId: ctx.workspaceId } },
    include: { project: { select: { artistId: true } } },
  });
  const song = await prisma.song.create({
    data: {
      workspaceId: ctx.workspaceId,
      projectId: hook.projectId,
      title: hook.text.split('\n')[0]!.slice(0, 80),
      status: 'SKETCH',
    },
  });
  await prisma.hookCandidate.update({
    where: { id: hook.id },
    data: { approved: true, songId: song.id },
  });
  await prisma.approval.create({
    data: { workspaceId: ctx.workspaceId, projectId: hook.projectId, userId: ctx.userId, gate: 'hook', decision: 'approved' },
  });
  await recordFeedback({
    workspaceId: ctx.workspaceId,
    artistId: hook.project.artistId,
    kind: 'approved',
    content: hook.text,
    sourceKind: 'hook',
    sourceId: hook.id,
  });
  return { hookId, songId: song.id };
}

async function generateLyrics(ctx: Ctx, hookId: string, cleanVersion: boolean) {
  const hook = await prisma.hookCandidate.findFirstOrThrow({
    where: { id: hookId, project: { workspaceId: ctx.workspaceId } },
    include: { project: { include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } } } },
  });
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'lyrics_full' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };

  const output = await responsesJson<{ title: string; body: string; cleanVersion?: string; explicit?: boolean; structure?: unknown; languageMix?: Record<string, number>; needsNativeReview?: string[] }>({
    system: prompts.LYRIC_SYSTEM,
    user: prompts.lyricUserPrompt({
      artist: hook.project.artist as never,
      brief: hook.project.briefs[0] as never,
      hookText: hook.text,
      cleanVersion,
    }),
    temperature: 0.8,
    maxOutputTokens: 4_000,
  });
  const lyric = await prisma.lyricDraft.create({
    data: {
      projectId: hook.projectId,
      songId: hook.songId,
      title: output.title,
      body: output.body,
      cleanVersion: output.cleanVersion,
      explicit: output.explicit ?? false,
      structure: output.structure as never,
      languageMix: output.languageMix as never,
    },
  });
  if (hook.songId) {
    await prisma.song.update({
      where: { id: hook.songId },
      data: { lyricId: lyric.id, status: 'DEMO' },
    });
  }
  return { lyric: { id: lyric.id, title: lyric.title } };
}

async function createBeatJob(ctx: Ctx, a: { genre: string; bpm: number; keySignature?: string; durationS?: number; vibePrompt?: string; withStems?: boolean; withVocals?: boolean }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };

  // Full song WITH AI vocals: grab the latest lyric so the model can sing it.
  let lyrics: string | undefined;
  let songId: string | undefined;
  if (a.withVocals) {
    const song = await prisma.song.findFirst({
      where: { projectId: ctx.projectId },
      orderBy: { createdAt: 'desc' },
      include: { lyric: true },
    });
    songId = song?.id;
    const lyric =
      song?.lyric ??
      (await prisma.lyricDraft.findFirst({
        where: { projectId: ctx.projectId },
        orderBy: { createdAt: 'desc' },
      }));
    lyrics = lyric?.cleanVersion ?? lyric?.body ?? undefined;
    if (!lyrics) return { error: 'no_lyrics — write the lyrics first, then make the full song' };
  }

  // Arrange the vocal to sound ALIVE — ad-libs, doubled/harmonized hook.
  let styleHints = '';
  if (a.withVocals && lyrics) {
    const project = await prisma.project.findUnique({
      where: { id: ctx.projectId },
      include: { artist: true },
    });
    const enriched = await enrichLyricsForVocals({
      lyricBody: lyrics,
      languages: project?.artist.languages,
      laneSummary: project?.artist.laneSummary ?? undefined,
    });
    if (enriched) {
      lyrics = enriched.enrichedLyrics;
      styleHints = enriched.styleTags.join(', ');
    }
  }

  const charge = await ctx.app.chargeCredits({
    workspaceId: ctx.workspaceId,
    key: a.withVocals || a.withStems ? 'full_song_demo' : 'beat_idea_short_30s',
  });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await prisma.providerJob.create({
    data: {
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: 'music',
      provider: a.withVocals ? 'ace_step' : process.env.MUSIC_PROVIDER ?? 'stub',
      status: 'QUEUED',
      inputJson: a as never,
    },
  });
  await enqueue({
    queue: ctx.app.queues.music,
    name: 'generate-music',
    payload: {
      jobId: job.id,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      songId,
      input: {
        ...a,
        vibePrompt: [a.vibePrompt, styleHints].filter(Boolean).join(', ') || undefined,
        durationS: a.durationS ?? (a.withVocals ? 150 : 60),
        withStems: a.withStems ?? !a.withVocals,
        withVocals: a.withVocals ?? false,
        lyrics,
      },
    },
  });
  return { jobId: job.id, status: 'queued', mode: a.withVocals ? 'full_song_with_vocals' : 'instrumental' };
}

async function renderDemoVocal(ctx: Ctx, a: { voiceProfileId: string; lyricId: string; role?: 'lead' | 'double' | 'ad-lib' | 'harmony' }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const voice = await prisma.voiceProfile.findFirstOrThrow({
    where: { id: a.voiceProfileId, workspaceId: ctx.workspaceId, status: 'READY' },
  });
  const lyric = await prisma.lyricDraft.findFirstOrThrow({
    where: { id: a.lyricId, projectId: ctx.projectId, approved: true },
  });
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'voice_render_full' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await prisma.providerJob.create({
    data: {
      workspaceId: ctx.workspaceId, projectId: ctx.projectId, kind: 'voice',
      provider: voice.provider, status: 'QUEUED', inputJson: a as never,
    },
  });
  await enqueue({
    queue: ctx.app.queues.voice,
    name: 'render-vocal',
    payload: {
      jobId: job.id, workspaceId: ctx.workspaceId, projectId: ctx.projectId,
      voiceProfileId: voice.id, providerVoiceId: voice.providerVoiceId,
      lyricBody: lyric.cleanVersion ?? lyric.body, role: a.role ?? 'lead',
    },
  });
  return { jobId: job.id, status: 'queued' };
}

async function generateCoverArt(ctx: Ctx, a: { prompt: string; quality?: 'low' | 'medium' | 'high'; size?: '1024x1024' | '1024x1792' | '1792x1024' }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const charge = await ctx.app.chargeCredits({
    workspaceId: ctx.workspaceId,
    key: (a.quality ?? 'medium') === 'high' ? 'cover_art_high' : 'cover_art_low',
  });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await prisma.providerJob.create({
    data: {
      workspaceId: ctx.workspaceId, projectId: ctx.projectId, kind: 'image',
      provider: process.env.IMAGE_PROVIDER ?? 'openai', status: 'QUEUED', inputJson: a as never,
    },
  });
  await enqueue({
    queue: ctx.app.queues.image,
    name: 'generate-image',
    payload: { jobId: job.id, workspaceId: ctx.workspaceId, projectId: ctx.projectId, prompt: a.prompt, size: a.size ?? '1024x1024', quality: a.quality ?? 'medium', kind: 'cover' },
  });
  return { jobId: job.id };
}

async function generateStoryboard(ctx: Ctx, a: { durationS?: number; format?: 'vertical' | 'square' | 'landscape'; prompt?: string }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const project = await prisma.project.findFirstOrThrow({
    where: { id: ctx.projectId, workspaceId: ctx.workspaceId },
    include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } },
  });
  const result = await responsesJson<{ title: string; shots: Array<{ index: number; prompt: string; duration_s: number; motion?: string; lighting?: string }> }>({
    system: prompts.STORYBOARD_SYSTEM,
    user: JSON.stringify({
      artist: { stageName: project.artist.stageName, lane: project.artist.laneSummary },
      brief: project.briefs[0] ?? {},
      totalDurationS: a.durationS ?? 15,
      format: a.format ?? 'vertical',
      extraPrompt: a.prompt,
    }),
    temperature: 0.7,
  });
  const concept = await prisma.videoConcept.create({
    data: {
      projectId: project.id,
      title: result.title,
      storyboard: result.shots as never,
      durationS: a.durationS ?? 15,
      format: a.format ?? 'vertical',
    },
  });
  return { concept: { id: concept.id, title: concept.title, shots: result.shots } };
}

async function renderVideo(ctx: Ctx, a: { conceptId: string; shotIndex?: number }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const concept = await prisma.videoConcept.findFirstOrThrow({
    where: { id: a.conceptId, project: { workspaceId: ctx.workspaceId } },
  });
  const shots = (concept.storyboard as Array<{ duration_s?: number }>) ?? [];
  const totalSec =
    a.shotIndex == null
      ? shots.reduce((s, sh) => s + (sh.duration_s ?? 3), 0)
      : shots[a.shotIndex]?.duration_s ?? 3;
  const charge = await ctx.app.chargeCredits({
    workspaceId: ctx.workspaceId,
    key: totalSec <= 8 ? 'video_8s' : 'video_20s',
  });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await prisma.providerJob.create({
    data: {
      workspaceId: ctx.workspaceId, projectId: ctx.projectId, kind: 'video',
      provider: process.env.VIDEO_PROVIDER ?? 'stub', status: 'QUEUED', inputJson: a as never,
    },
  });
  await enqueue({
    queue: ctx.app.queues.video,
    name: 'render-video',
    payload: { jobId: job.id, workspaceId: ctx.workspaceId, projectId: ctx.projectId, conceptId: concept.id, shotIndex: a.shotIndex, shots, format: concept.format },
  });
  return { jobId: job.id };
}

async function rightsCheck(ctx: Ctx, songId: string) {
  const song = await prisma.song.findFirstOrThrow({
    where: { id: songId, workspaceId: ctx.workspaceId },
    include: {
      project: { include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } } },
      lyric: true,
    },
  });
  const hook = await prisma.hookCandidate.findFirst({ where: { songId, approved: true } });
  const check = await runRightsCheck({
    lyricBody: song.lyric?.body,
    hookText: hook?.text,
    references: song.project.artist.references as never,
    producerNotes: song.project.briefs[0]?.notes ?? undefined,
  });
  const approvals = await prisma.approval.findMany({ where: { projectId: song.projectId, decision: 'approved' } });
  const hash = await canonicalReceiptHash({ songId, check, approvals, t: new Date().toISOString() });
  const receipt = await prisma.rightsReceipt.create({
    data: {
      workspaceId: ctx.workspaceId, projectId: song.projectId, songId,
      providers: [], prompts: { rightsCheck: check } as never,
      approvals: approvals.map((a) => ({ id: a.id, gate: a.gate, decision: a.decision })) as never,
      aiDisclosure: { distroDisclosure: 'GenAI-assisted, human-edited', credits: { lyrics: 'AI-assisted, human-edited' } } as never,
      hash,
    },
  });
  return { receiptId: receipt.id, check };
}

async function createReleaseKit(ctx: Ctx, songId: string) {
  const song = await prisma.song.findFirstOrThrow({
    where: { id: songId, workspaceId: ctx.workspaceId },
  });
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'release_export' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await prisma.providerJob.create({
    data: {
      workspaceId: ctx.workspaceId, projectId: song.projectId, kind: 'export',
      provider: 'internal', status: 'QUEUED', inputJson: { songId } as never,
    },
  });
  await enqueue({
    queue: ctx.app.queues.export,
    name: 'export-release',
    payload: { jobId: job.id, workspaceId: ctx.workspaceId, projectId: song.projectId, songId },
  });
  return { jobId: job.id };
}

async function requestApproval(ctx: Ctx, gate: string, note: string) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  // Surface a pending approval to the user. The web app picks it up via /projects/:id.
  await prisma.approval.create({
    data: {
      workspaceId: ctx.workspaceId, projectId: ctx.projectId, userId: ctx.userId,
      gate, decision: 'changes_requested', notes: note,
    },
  });
  return { ok: true, gate, note };
}

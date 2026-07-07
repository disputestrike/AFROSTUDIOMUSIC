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
import { joinBriefs, prompts, generateJson, scoreItems, runRightsCheck, canonicalReceiptHash, directorRefineHooks, researchTrends, enrichLyricsForVocals, soundBrief, blendSoundBrief, predictHit} from '@afrohit/ai';
import { enqueue } from '../lib/queue';
import { assertSafeUrl } from '../lib/url-guard';
import { learnedReferenceBrief, learnedStyleTags, learnedLyricCraftBrief, snapshotTrend, freshnessBrief } from '../lib/learned';
import { learnLyricCraft, findLearnedLyric } from '../lib/lyric-learn';
import { lexiconPalette } from '../lib/lexicon';
import { fuseSoundDna } from '../lib/fuse';
import { kitRolesFor, homeKeyFor, pickMaterial, claudeArrangement } from '../lib/material-plan';
import { memoryContext, recordFeedback } from './artist-memory';

type Ctx = {
  app: FastifyInstance;
  workspaceId: string;
  userId: string;
  projectId: string | null;
};

// ---------------------------------------------------------------------------
// HARD CONSTRAINTS — the user's SELECTIONS are law, not flavor. Injected at the
// top of every writer prompt; language obedience is VERIFIED after generation.
const LANG_NAMES: Record<string, string> = { pcm: 'Nigerian Pidgin', en: 'English', yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa', fr: 'French', pt: 'Portuguese', sw: 'Swahili', zu: 'Zulu', twi: 'Twi', es: 'Spanish' };
const normLang = (l: string) => {
  const x = l.toLowerCase().trim();
  const alias: Record<string, string> = { english: 'en', pidgin: 'pcm', 'nigerian pidgin': 'pcm', yoruba: 'yo', igbo: 'ig', hausa: 'ha', french: 'fr', portuguese: 'pt', swahili: 'sw', zulu: 'zu', spanish: 'es' };
  return alias[x] ?? x;
};
function hardConstraints(genre: string, languages?: string[] | null): string {
  const g = genre.replace(/_/g, ' ');
  const lines = [
    'HARD CONSTRAINTS (the artist SELECTED these — they are law, not suggestions):',
    `- GENRE: this is a ${g} record. Every choice — imagery, slang, word-rhythm, hook shape — must serve ${g}. Drifting to another genre's feel is a FAILURE.`,
  ];
  if (languages?.length) {
    lines.push(
      `- LANGUAGES: write ONLY in ${languages.map((l) => LANG_NAMES[normLang(l)] ?? l).join(' + ')}. Every single line. A line in any other language is a FAILURE and the whole take gets discarded.`
    );
  }
  return lines.join('\n');
}
/** Languages the model reported vs what was selected — the guardrail check. */
function languageViolations(reported: Record<string, number> | undefined, allowed?: string[] | null): string[] {
  if (!allowed?.length || !reported) return [];
  const ok = new Set(allowed.map(normLang));
  return Object.entries(reported)
    .filter(([lang, share]) => (Number(share) || 0) >= 8 && !ok.has(normLang(lang)))
    .map(([lang]) => lang);
}

export async function runChatTool(args: Ctx & { name: string; args: Record<string, unknown> }) {
  const { name, args: a, ...ctx } = args;
  switch (name) {
    case 'research_trends':
      return researchTrendsTool(ctx, a as never);
    case 'polish_brief':
      return polishBrief(ctx, String(a.rawIdea ?? ''));
    case 'generate_hooks':
      return generateHooks(ctx, Number(a.count ?? 8), a.languages as string[] | undefined);
    case 'score_hooks':
      return scoreHooks(ctx, (a.hookIds as string[]) ?? []);
    case 'approve_hook':
      return approveHook(ctx, String(a.hookId));
    case 'generate_lyrics':
      return generateLyrics(ctx, String(a.hookId), Boolean(a.cleanVersion ?? true), a.languages as string[] | undefined);
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
    case 'analyze_audio':
      return analyzeAudioTool(ctx, String(a.url));
    case 'run_drop':
      return runDropTool(ctx, a as never);
    case 'master_song':
      return masterSongTool(ctx, String(a.songId), a.preset ? String(a.preset) : undefined);
    case 'make_snippet':
      return makeSnippetTool(ctx, a.songId ? String(a.songId) : undefined, Number(a.startS ?? 0));
    case 'reject_hook':
      return rejectHookTool(ctx, String(a.hookId));
    case 'list_beats':
      return listBeatsTool(ctx);
    case 'list_catalog':
      return listCatalogTool(ctx);
    case 'set_release_rights':
      return setReleaseRightsTool(ctx, a as never);
    case 'predict_hit':
      return predictHitTool(ctx, a.songId ? String(a.songId) : undefined);
    case 'forge_materials':
      return forgeMaterialsTool(ctx, a as never);
    case 'assemble_beat':
      return assembleBeatTool(ctx, a as never);
    case 'separate_stems':
      return separateStemsTool(ctx, a.songId ? String(a.songId) : undefined, a.mode === 'full' ? 'full' : 'instrumental');
    case 'learn_lyrics':
      return learnLyricsTool(ctx, String(a.lyrics ?? ''), a.genreHint ? String(a.genreHint) : undefined);
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
    return { error: 'trends_unavailable', hint: 'All trend sources failed (YouTube/Apple charts/Tavily/Brave/news) — likely a network issue; try again.' };
  }
  void snapshotTrend(ctx.workspaceId, a.genre ?? project?.genre, trends);
  return { digest: trends.digest, sources: trends.sources, chartSource: trends.source };
}

/**
 * LEARN FROM A LYRIC (chat) — study any pasted lyrics into the data lake:
 * craft/patterns only, never the words. Future hooks + lyrics read from it.
 */
async function learnLyricsTool(ctx: Ctx, lyrics: string, genreHint?: string) {
  if (lyrics.trim().length < 40) return { error: 'lyrics_too_short', hint: 'Paste the full lyric (at least a verse + hook) so there is real craft to study.' };
  // Dedupe BEFORE charging — the same lyrics twice return the existing lesson free.
  const existing = await findLearnedLyric(ctx.workspaceId, lyrics);
  if (!existing) {
    const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'brief_polish' });
    if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  }
  const { referenceId, craft } = await learnLyricCraft({ workspaceId: ctx.workspaceId, raw: lyrics, genreHint });
  const inLibrary = await prisma.soundReference.count({ where: { workspaceId: ctx.workspaceId, sourceUrl: { startsWith: 'lyric:' } } });
  return {
    learned: true,
    referenceId,
    craftTitle: craft.craftTitle,
    genre: craft.genre,
    mode: craft.mode,
    craftLessons: craft.craftLessons,
    lyricCraftInLibrary: inLibrary,
    note: 'Craft (patterns/technique) shelved in the library — the words themselves are never stored. Every future hook and lyric now pulls from this.',
  };
}

async function polishBrief(ctx: Ctx, rawIdea: string) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'brief_polish' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const polished = await generateJson<{
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

async function generateHooks(ctx: Ctx, count: number, languages?: string[]) {
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
  void snapshotTrend(ctx.workspaceId, project.genre, trendData);
  const hmood = (project.briefs[0] as { mood?: string } | undefined)?.mood;
  const soundDna = fuseSoundDna({ extra: hardConstraints(project.genre, languages), freshness: await freshnessBrief(ctx.workspaceId), palette: await lexiconPalette({ workspaceId: ctx.workspaceId, languages, mood: hmood, rotate: count }), dna: soundBrief(project.genre).brief, learnedRef: await learnedReferenceBrief(ctx.workspaceId, project.genre), learnedCraft: await learnedLyricCraftBrief(ctx.workspaceId, project.genre), hitCraft: prompts.hitCraftBrief('hook', hmood) });
  // FAST + RELIABLE: OpenAI writes (word-palette gives the vocab), Claude scores
  // lean. The drop pipeline runs this per song, so speed here is what kills the
  // "nothing's happening" feel.
  const result = await generateJson<{ hooks?: Array<{ text: string; language?: string[]; syllablePattern?: string }> }>({
    system: prompts.HOOK_SYSTEM,
    user: prompts.hookUserPrompt({ artist: project.artist as never, brief: project.briefs[0] as never, count, tasteMemory, trends, soundDna }),
    temperature: 0.95,
    maxTokens: 3_500,
  });
  const refined = await directorRefineHooks({ artist: project.artist as never, brief: project.briefs[0] as never, drafts: (result.hooks ?? []).map((h) => h.text), tasteMemory, trends, soundDna });

  const rows = refined
    ? refined.map((h) => ({
        text: h.text,
        language: (h.language ?? []) as never,
        score: typeof h.score === 'number' ? h.score : null,
        meta: { reason: h.reason, needsNativeReview: h.needsNativeReview, director: 'claude', viralScore: h.viralScore, dimensions: h.dimensions, tiktokMoment: h.tiktokMoment } as never,
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
    // projectId lets the UI approve/edit a hook DIRECTLY (deterministic), instead
    // of relying on the model to parse "use hook 3" from a chat message.
    projectId: project.id,
    hooks: created.map((c) => {
      const m = (c.meta as { viralScore?: number; tiktokMoment?: string } | null) ?? null;
      return { id: c.id, text: c.text, score: c.score, viralScore: m?.viralScore ?? null, tiktokMoment: m?.tiktokMoment ?? null };
    }),
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

async function generateLyrics(ctx: Ctx, hookId: string, cleanVersion: boolean, languages?: string[]) {
  const hook = await prisma.hookCandidate.findFirstOrThrow({
    where: { id: hookId, project: { workspaceId: ctx.workspaceId } },
    include: { project: { include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } } } },
  });
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'lyrics_full' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };

  const firstOutput = await generateJson<{ title: string; body: string; cleanVersion?: string; explicit?: boolean; structure?: unknown; languageMix?: Record<string, number>; needsNativeReview?: string[] }>({
    system: prompts.LYRIC_SYSTEM,
    user: prompts.lyricUserPrompt({
      artist: hook.project.artist as never,
      brief: hook.project.briefs[0] as never,
      hookText: hook.text,
      cleanVersion,
      soundDna: fuseSoundDna({ extra: hardConstraints(hook.project.genre, languages), freshness: await freshnessBrief(ctx.workspaceId), palette: await lexiconPalette({ workspaceId: ctx.workspaceId, languages, mood: (hook.project.briefs[0] as { mood?: string } | undefined)?.mood, rotate: Date.now() % 97 }), dna: soundBrief(hook.project.genre).brief, learnedRef: await learnedReferenceBrief(ctx.workspaceId, hook.project.genre), learnedCraft: await learnedLyricCraftBrief(ctx.workspaceId, hook.project.genre), hitCraft: prompts.hitCraftBrief('lyric', (hook.project.briefs[0] as { mood?: string } | undefined)?.mood) }),
    }),
    temperature: 0.8,
    maxTokens: 4_000,
  });

  // GUARDRAIL: verify language obedience against the SELECTION; one stern
  // retry on violation. Any remaining violation is reported, never hidden.
  let output = firstOutput;
  let langViolation = languageViolations(output.languageMix, languages);
  if (langViolation.length) {
    const retry = await generateJson<typeof firstOutput>({
      system: prompts.LYRIC_SYSTEM,
      user:
        `YOUR PREVIOUS ATTEMPT FAILED THE LANGUAGE RULE — it used: ${langViolation.join(', ')}. ` +
        `REWRITE THE WHOLE LYRIC using ONLY ${(languages ?? []).map((l) => LANG_NAMES[normLang(l)] ?? l).join(' + ')}. No exceptions, not even one line.\n\n` +
        prompts.lyricUserPrompt({
          artist: hook.project.artist as never,
          brief: hook.project.briefs[0] as never,
          hookText: hook.text,
          cleanVersion,
          soundDna: hardConstraints(hook.project.genre, languages),
        }),
      temperature: 0.7,
      maxTokens: 4_000,
    }).catch(() => null);
    if (retry?.body) {
      output = retry;
      langViolation = languageViolations(retry.languageMix, languages);
    }
  }
  // LyricDraft.songId is @unique — a song can have ONE lyric. Re-running lyrics
  // (Continue/Regenerate) must UPDATE it, not crash on the unique constraint.
  const lyricData = {
    projectId: hook.projectId,
    title: output.title,
    body: output.body,
    cleanVersion: output.cleanVersion,
    explicit: output.explicit ?? false,
    structure: output.structure as never,
    languageMix: output.languageMix as never,
  };
  const lyric = hook.songId
    ? await prisma.lyricDraft.upsert({
        where: { songId: hook.songId },
        create: { ...lyricData, songId: hook.songId },
        update: lyricData,
      })
    : await prisma.lyricDraft.create({ data: lyricData });
  if (hook.songId) {
    await prisma.song.update({
      where: { id: hook.songId },
      data: { lyricId: lyric.id, status: 'DEMO' },
    });
  }
  return { lyric: { id: lyric.id, title: lyric.title }, ...(langViolation.length ? { languageWarning: `still contains: ${langViolation.join(', ')} — regenerate or edit` } : {}) };
}

async function createBeatJob(ctx: Ctx, a: { genre: string; fusionGenres?: string[]; mood?: string; pinnedReferenceId?: string; bpm: number; keySignature?: string; durationS?: number; vibePrompt?: string; withStems?: boolean; withVocals?: boolean; songEngine?: 'suno' | 'ace_step' | 'minimax'; influence?: string; languages?: string[] }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };

  // Honor the requested genre for the whole session — the chat's scratch project
  // defaults to afro_fusion, so sync it to what was actually asked for.
  if (a.genre) await prisma.project.update({ where: { id: ctx.projectId }, data: { genre: a.genre } }).catch(() => {});

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

  // Genre Sound DNA (blended when mixing genres, COLORED by the mood) + what it
  // LEARNED from the artist's own references — the pinned just-listened one
  // first. Learned tokens join the MUSIC-MODEL tags so the heard sound shapes
  // the audio, not only the words.
  const dna = a.fusionGenres?.length ? blendSoundBrief([a.genre, ...a.fusionGenres], a.mood) : soundBrief(a.genre, a.mood);
  const learned = await learnedReferenceBrief(ctx.workspaceId, a.genre, a.pinnedReferenceId);
  const learnedTags = await learnedStyleTags(ctx.workspaceId, a.genre, a.pinnedReferenceId);
  const dnaTags = [...(dna.tags ?? []), ...learnedTags];

  // Arrange the vocal to sound ALIVE — ad-libs, doubled/harmonized hook.
  let styleHints: string[] = [];
  if (a.withVocals && lyrics) {
    const project = await prisma.project.findUnique({
      where: { id: ctx.projectId },
      include: { artist: true },
    });
    const enriched = await enrichLyricsForVocals({
      lyricBody: lyrics,
      // The user's SELECTED languages outrank the artist profile's defaults.
      languages: a.languages?.length ? a.languages : project?.artist.languages,
      laneSummary: project?.artist.laneSummary ?? undefined,
      soundDna: joinBriefs([dna.brief, learned]),
    });
    if (enriched) {
      lyrics = enriched.enrichedLyrics;
      styleHints = enriched.styleTags;
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
      provider: a.withVocals ? a.songEngine ?? 'ace_step' : process.env.MUSIC_PROVIDER ?? 'stub',
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
        // Influence = steer the SOUND toward an artist's lane (vibe/energy),
        // never a clone and never named. Goes to the music model as a style cue.
        // ANTI-SOUP: vibe stays short (vibe + influence only); styleHints ride
        // as tags on dnaTags where terse tokens belong.
        vibePrompt: [a.vibePrompt, a.influence ? `in the vibe/lane of ${a.influence} (capture the feel, not a copy)` : null].filter(Boolean).join(', ') || undefined,
        durationS: a.durationS ?? (a.withVocals ? 150 : 60),
        withStems: a.withStems ?? !a.withVocals,
        withVocals: a.withVocals ?? false,
        songEngine: a.songEngine,
        dnaTags: [...dnaTags, ...styleHints.slice(0, 3)],
        languages: a.languages?.length ? a.languages : undefined,
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
  const result = await generateJson<{ title: string; shots: Array<{ index: number; prompt: string; duration_s: number; motion?: string; lighting?: string }> }>({
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

// ===========================================================================
// "Connected to everything" — listen, batch, master, snippet, taste, catalog.
// ===========================================================================

async function analyzeAudioTool(ctx: Ctx, url: string) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  // Bright-line + SSRF guard (no streaming catalog, no private/metadata hosts).
  const chk = await assertSafeUrl(url);
  if (!chk.ok) return { error: chk.error, message: chk.message };
  // Paid inference → daily cap like every other generation path.
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'analyze_audio' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await prisma.providerJob.create({
    data: { workspaceId: ctx.workspaceId, projectId: ctx.projectId, kind: 'analyze', provider: 'replicate', status: 'QUEUED', inputJson: { url } as never },
  });
  await enqueue({ queue: ctx.app.queues.music, name: 'analyze-audio', payload: { jobId: job.id, workspaceId: ctx.workspaceId, projectId: ctx.projectId, url } });
  return { jobId: job.id, status: 'queued', note: 'Listening — poll the job; outputJson.profile has BPM/key/genre/mood/instruments + a fresh-vibe prompt to create an original from.' };
}

async function runDropTool(ctx: Ctx, a: { theme: string; count?: number; genre?: string; bpm?: number; withVocals?: boolean; songEngine?: 'suno' | 'ace_step' | 'minimax' }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const count = Math.min(Math.max(Number(a.count ?? 3), 1), 6);
  const genre = a.genre ?? 'afrobeats';
  const bpm = Number(a.bpm ?? 103);
  await polishBrief(ctx, a.theme);
  const drops: Array<{ songId?: string; hookText?: string; score: number | null; jobId?: string; error?: string }> = [];
  for (let i = 0; i < count; i++) {
    const hk = (await generateHooks(ctx, 10)) as { hooks?: Array<{ id: string; text: string; score: number | null }> };
    let hooks = hk?.hooks ?? [];
    if (!hooks.length) continue;
    if (hooks.every((h) => h.score == null)) {
      const sc = (await scoreHooks(ctx, hooks.map((h) => h.id))) as { scores?: Array<{ id: string; overall: number }> };
      const m = new Map((sc?.scores ?? []).map((s) => [s.id, s.overall]));
      hooks = hooks.map((h) => ({ ...h, score: m.get(h.id) ?? h.score }));
    }
    const best = hooks.slice().sort((x, y) => (y.score ?? 0) - (x.score ?? 0))[0]!;
    const ap = (await approveHook(ctx, best.id)) as { songId?: string };
    await generateLyrics(ctx, best.id, true);
    const beat = (await createBeatJob(ctx, { genre, bpm, withVocals: a.withVocals ?? true, songEngine: a.songEngine })) as { jobId?: string; songId?: string; error?: string };
    drops.push({ songId: ap?.songId ?? beat?.songId, hookText: best.text, score: best.score ?? null, jobId: beat?.jobId, error: beat?.error });
    if (beat?.error === 'insufficient_credits') break;
  }
  drops.sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
  return { produced: drops.length, drop: drops };
}

async function masterSongTool(ctx: Ctx, songId: string, preset?: string) {
  const song = await prisma.song.findFirst({
    where: { id: songId, workspaceId: ctx.workspaceId },
    include: { mixes: { orderBy: { createdAt: 'desc' }, take: 1 }, masters: { orderBy: { createdAt: 'desc' }, take: 1 }, beats: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!song) return { error: 'song_not_found' };
  // Master the freshest audio (see songs.ts /:id/master for the rationale).
  const latestMix = song.mixes[0];
  const latestBeat = song.beats[0];
  const realMix = latestMix && latestMix.preset !== 'source' && (!latestBeat || latestMix.createdAt >= latestBeat.createdAt) ? latestMix : null;
  let mixId: string;
  if (realMix) {
    mixId = realMix.id;
  } else {
    const src = latestBeat?.url ?? latestMix?.url ?? song.masters[0]?.url;
    if (!src) return { error: 'nothing_to_master — no audio on this song yet' };
    const mix = await prisma.mix.create({ data: { projectId: song.projectId, songId: song.id, preset: 'source', url: src, notes: 'Master source (current rendered audio)', approved: true } });
    mixId = mix.id;
  }
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'master_preset' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const p = preset ?? 'streaming_lufs_-14';
  const job = await prisma.providerJob.create({ data: { workspaceId: ctx.workspaceId, projectId: song.projectId, kind: 'master', provider: 'internal', status: 'QUEUED', inputJson: { songId, mixId, preset: p } as never } });
  await enqueue({ queue: ctx.app.queues.master, name: 'create-master', payload: { jobId: job.id, workspaceId: ctx.workspaceId, projectId: song.projectId, songId, mixId, preset: p } });
  return { jobId: job.id, status: 'queued', preset: p };
}

async function makeSnippetTool(ctx: Ctx, songId: string | undefined, startS: number) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const song = songId
    ? await prisma.song.findFirst({ where: { id: songId, workspaceId: ctx.workspaceId }, select: { id: true } })
    : await prisma.song.findFirst({ where: { projectId: ctx.projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (!song) return { error: 'no_song_to_clip' };
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'beat_idea_short_30s' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await prisma.providerJob.create({ data: { workspaceId: ctx.workspaceId, projectId: ctx.projectId, kind: 'video', provider: 'snippet', status: 'QUEUED', inputJson: { songId: song.id, startS } as never } });
  await enqueue({ queue: ctx.app.queues.music, name: 'snippet', payload: { jobId: job.id, workspaceId: ctx.workspaceId, projectId: ctx.projectId, songId: song.id, startS: startS || 0 } });
  return { jobId: job.id, status: 'queued' };
}

async function rejectHookTool(ctx: Ctx, hookId: string) {
  const hook = await prisma.hookCandidate.findFirst({ where: { id: hookId, project: { workspaceId: ctx.workspaceId } }, include: { project: { select: { artistId: true } } } });
  if (!hook) return { error: 'hook_not_found' };
  await prisma.hookCandidate.update({ where: { id: hookId }, data: { approved: false, score: 0 } });
  await recordFeedback({ workspaceId: ctx.workspaceId, artistId: hook.project.artistId, kind: 'rejected', content: hook.text, sourceKind: 'hook', sourceId: hook.id });
  return { ok: true, hookId, note: 'Rejected — the taste engine will avoid this pattern.' };
}

async function listBeatsTool(ctx: Ctx) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const beats = await prisma.beatAsset.findMany({ where: { projectId: ctx.projectId }, orderBy: { createdAt: 'desc' }, take: 20, include: { stems: { select: { role: true } } } });
  return { beats: beats.map((b) => ({ id: b.id, provider: b.provider, bpm: b.bpm, key: b.keySignature, durationS: b.duration, stems: b.stems.map((s) => s.role), url: b.url })) };
}

async function listCatalogTool(ctx: Ctx) {
  const songs = await prisma.song.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { masters: { orderBy: { createdAt: 'desc' }, take: 1 }, mixes: { orderBy: { createdAt: 'desc' }, take: 1 }, beats: { orderBy: { createdAt: 'desc' }, take: 1 }, lyric: { select: { title: true } } },
  });
  return {
    count: songs.length,
    songs: songs.map((s) => ({ id: s.id, title: s.lyric?.title || s.title, status: s.status, releaseReady: s.releaseReady, audioUrl: s.masters[0]?.url ?? s.mixes[0]?.url ?? s.beats[0]?.url ?? null })),
  };
}

async function predictHitTool(ctx: Ctx, songId: string | undefined) {
  const song = songId
    ? await prisma.song.findFirst({ where: { id: songId, workspaceId: ctx.workspaceId }, include: { project: { select: { genre: true, bpm: true, artist: { select: { languages: true } } } }, lyric: true, masters: { orderBy: { createdAt: 'desc' }, take: 1 }, hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 } } })
    : ctx.projectId
    ? await prisma.song.findFirst({ where: { projectId: ctx.projectId }, orderBy: { createdAt: 'desc' }, include: { project: { select: { genre: true, bpm: true, artist: { select: { languages: true } } } }, lyric: true, masters: { orderBy: { createdAt: 'desc' }, take: 1 }, hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 } } })
    : null;
  if (!song) return { error: 'no_song' };
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'hit_predict' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const genre = song.project.genre;
  const trends = (await researchTrends({ genre }).catch(() => null))?.digest;
  const prediction = await predictHit({
    title: song.lyric?.title || song.title,
    genre,
    bpm: song.project.bpm ?? undefined,
    hook: song.hooks[0]?.text ?? undefined,
    lyrics: song.lyric?.body ?? undefined,
    soundDna: soundBrief(genre).brief,
    trends,
    hasMaster: song.masters.length > 0,
    languages: song.project.artist.languages,
  });
  if (!prediction) return { error: 'a&r_unavailable — add ANTHROPIC_API_KEY for the hit scout' };
  return { songId: song.id, ...prediction };
}

async function separateStemsTool(ctx: Ctx, songId: string | undefined, mode: 'instrumental' | 'full') {
  const song = songId
    ? await prisma.song.findFirst({ where: { id: songId, workspaceId: ctx.workspaceId }, include: { beats: { orderBy: { createdAt: 'desc' }, take: 1 } } })
    : ctx.projectId
    ? await prisma.song.findFirst({ where: { projectId: ctx.projectId }, orderBy: { createdAt: 'desc' }, include: { beats: { orderBy: { createdAt: 'desc' }, take: 1 } } })
    : null;
  if (!song) return { error: 'no_song' };
  const beat = song.beats[0];
  if (!beat) return { error: 'no_audio_to_separate' };
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'beat_idea_short_30s' });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await prisma.providerJob.create({ data: { workspaceId: ctx.workspaceId, projectId: song.projectId, kind: 'stems', provider: 'replicate', status: 'QUEUED', inputJson: { songId: song.id, beatId: beat.id, mode } as never } });
  await enqueue({ queue: ctx.app.queues.music, name: 'stems', payload: { jobId: job.id, workspaceId: ctx.workspaceId, projectId: song.projectId, songId: song.id, beatId: beat.id, mode } });
  return { jobId: job.id, status: 'queued', mode, note: mode === 'instrumental' ? 'Instrumental will appear in the song download shortly.' : 'Stems (vocals/drums/bass/other) will appear in the song download shortly.' };
}

/** Forge isolated loops (the material layer's raw stock) for a genre. */
async function forgeMaterialsTool(ctx: Ctx, a: { genre: string; bpm?: number; keySignature?: string }) {
  const bpm = Number(a.bpm ?? 108);
  const keySignature = a.keySignature ?? homeKeyFor(a.genre);
  const roles = kitRolesFor(a.genre);
  const jobs: Array<{ role: string; jobId: string }> = [];
  for (const role of roles) {
    const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'beat_idea_short_30s' });
    if (!charge.ok) return { error: 'insufficient_credits', forged: jobs };
    const job = await prisma.providerJob.create({
      data: { workspaceId: ctx.workspaceId, kind: 'material', provider: 'replicate', status: 'QUEUED', inputJson: { genre: a.genre, role, bpm, keySignature } as never },
    });
    // Staggered — Replicate throttles prediction creation (6/min observed live).
    await enqueue({ queue: ctx.app.queues.music, name: 'forge-material', payload: { jobId: job.id, workspaceId: ctx.workspaceId, genre: a.genre, role, bpm, keySignature }, delayMs: jobs.length * 30_000 });
    jobs.push({ role, jobId: job.id });
  }
  return { forging: jobs, keySignature, note: `Forging ${jobs.length} isolated ${a.genre} loops at ${bpm}bpm in ${keySignature}. QC-passed loops land in the material library; then call assemble_beat.` };
}

/** Assemble the EXACT beat from real material — Claude arranges, worker places. */
async function assembleBeatTool(ctx: Ctx, a: { genre: string; bpm?: number; keySignature?: string; vibe?: string }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const bpm = Number(a.bpm ?? 108);
  const rows = await prisma.materialAsset.findMany({ where: { workspaceId: ctx.workspaceId, genre: a.genre }, orderBy: { createdAt: 'desc' }, take: 100 });
  const picks = pickMaterial(rows, a.genre, bpm, a.keySignature);
  if (picks.length < 2) return { error: 'not_enough_material', have: picks.map((p) => p.role), note: `Forge ${a.genre} loops first (forge_materials), then assemble.` };
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'beat_idea_short_30s' });
  if (!charge.ok) return { error: 'insufficient_credits' };
  const sections = await claudeArrangement(a.genre, bpm, picks.map((p) => p.role), a.vibe);
  const job = await prisma.providerJob.create({
    data: { workspaceId: ctx.workspaceId, projectId: ctx.projectId, kind: 'music', provider: 'material', status: 'QUEUED', inputJson: { assemble: true, genre: a.genre, bpm, picks: picks.map((p) => p.role), sections } as never },
  });
  await enqueue({ queue: ctx.app.queues.music, name: 'assemble-beat', payload: { jobId: job.id, workspaceId: ctx.workspaceId, projectId: ctx.projectId, bpm, genre: a.genre, picks, sections } });
  return {
    jobId: job.id,
    status: 'queued',
    roles: picks.map((p) => p.role),
    arrangement: sections ? sections.map((s) => `${s.name}:${s.bars}bars[${s.roles.join('+')}]`) : 'classic template',
    note: 'Assembling the EXACT beat from real material — deterministic layers, real placement.',
  };
}

async function setReleaseRightsTool(ctx: Ctx, a: { songId: string; splitSheet?: Array<{ name: string; role: string; share: number }>; nativeReviewOk?: boolean }) {
  const song = await prisma.song.findFirst({ where: { id: a.songId, workspaceId: ctx.workspaceId }, select: { id: true } });
  if (!song) return { error: 'song_not_found' };
  const data: Record<string, unknown> = {};
  if (a.splitSheet) data.splitSheet = a.splitSheet as never;
  if (typeof a.nativeReviewOk === 'boolean') data.nativeReviewOk = a.nativeReviewOk;
  if (!Object.keys(data).length) return { error: 'nothing_to_set' };
  await prisma.song.update({ where: { id: song.id }, data });
  const sum = (a.splitSheet ?? []).reduce((t, s) => t + (Number(s.share) || 0), 0);
  return { ok: true, songId: song.id, splitsSumTo: sum, note: 'Saved. Finalize ISRC/UPC + green-light on the Release page (rights assignment stays on the canonical release step).' };
}

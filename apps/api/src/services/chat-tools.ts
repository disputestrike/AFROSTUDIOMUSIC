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
import { createHash } from 'node:crypto';
import { prisma } from '@afrohit/db';
import { joinBriefs, prompts, generateJson, scoreItems, runRightsCheck, canonicalReceiptHash, directorRefineHooks, researchTrends, enrichLyricsForVocals } from '@afrohit/ai';
import { laneDna, laneDnaBrief } from '../lib/lane-pipeline';
import { createQueuedProviderJob } from '../lib/queued-job';
import { assertSafeUrl } from '../lib/url-guard';
import { musicRouteCapabilities, validateMusicRoute } from '../lib/music-capabilities';
import { learnedReferenceBrief, learnedStyleTags, learnedMeasuredTags, learnedUsage, learnedLyricCraftBrief, snapshotTrend, freshnessBrief } from '../lib/learned';
import { blueprintForReference } from '../lib/blueprint';
import { genreSignature, structureBrief, pickLawfulTitle, lyricQaCheck, normalizeLyricBody } from '@afrohit/shared';
import { learnLyricCraft, findLearnedLyric } from '../lib/lyric-learn';
import { dataLakeReport } from '../lib/data-lake';
import { lexiconPalette } from '../lib/lexicon';
import { laneContext } from '../lib/lane-context';
import { fuseSoundDna } from '../lib/fuse';
import { presongIntelligence } from '../lib/presong';
import { kitRolesFor, homeKeyFor, pickMaterial, claudeArrangement, ownShelfRoles } from '../lib/material-plan';
import { autoMaterialBeat } from '../lib/material-auto';
import { arReadSong } from '../lib/ar-read';
import { applySingingBrain, craftOf } from '../lib/singing-pipeline';
import { memoryContext, recordFeedback } from './artist-memory';
import { operationErrorBody, runIdempotentOperation } from '../lib/idempotent-operation';

type Ctx = {
  app: FastifyInstance;
  workspaceId: string;
  userId: string;
  projectId: string | null;
  operationKey?: string;
};

function toolKey(ctx: Ctx, scope: string): string | undefined {
  if (!ctx.operationKey) return undefined;
  const digest = createHash('sha256').update(`${ctx.operationKey}|${scope}`).digest('hex').slice(0, 24);
  return `chat:${scope}:${digest}`;
}

// ---------------------------------------------------------------------------
// HARD CONSTRAINTS — the user's SELECTIONS are law, not flavor. Injected at the
// top of every writer prompt; language obedience is VERIFIED after generation.
const LANG_NAMES: Record<string, string> = { pcm: 'Nigerian Pidgin', en: 'English', yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa', fr: 'French', pt: 'Portuguese', sw: 'Swahili', zu: 'Zulu', twi: 'Twi', es: 'Spanish' };
const normLang = (l: string) => {
  const x = l.toLowerCase().trim();
  const alias: Record<string, string> = { english: 'en', pidgin: 'pcm', 'nigerian pidgin': 'pcm', yoruba: 'yo', igbo: 'ig', hausa: 'ha', french: 'fr', portuguese: 'pt', swahili: 'sw', zulu: 'zu', spanish: 'es' };
  return alias[x] ?? x;
};

// Identity-class ENGINE tags, shared by every render path (chat, Create-page
// drop, from-lyrics beats route, regenerate). They ride in dnaTags — NOT in
// vibePrompt, whose 160-char anti-soup cap would truncate them away.
export function voiceVocalTag(voice?: 'auto' | 'female' | 'male' | 'duet' | 'group' | null): string | null {
  if (!voice || voice === 'auto') return null;
  return {
    female: 'female lead vocal',
    male: 'male lead vocal',
    duet: 'male and female duet, trading lines and harmonies',
    group: 'group vocals, choir-style call-and-response',
  }[voice] ?? null;
}
export function languageVocalTag(languages?: string[] | null): string {
  const list = languages ?? [];
  const names = list.map((l) => LANG_NAMES[normLang(l)] ?? l).join(' + ') || 'English';
  const norm = list.map(normLang);
  return `vocals sung strictly in ${names}${norm.includes('ig') ? ' — Igbo lines with authentic IGBO (Nigerian) pronunciation, never Swahili or Zulu phonetics' : ''}${norm.includes('yo') ? ' — Yoruba lines with true Yoruba tonality' : ''}`;
}
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
  // The writer reports FRACTIONS ({ yo: 0.7 }, per the prompt's example) but this
  // guard was thresholding at 8 — i.e. 800% — so it could never fire. Normalize
  // both scales (fractions and percentages) to percent, then flag >= 8%.
  return Object.entries(reported)
    .filter(([lang, share]) => {
      const n = Number(share) || 0;
      const pct = n <= 1 ? n * 100 : n;
      return pct >= 8 && !ok.has(normLang(lang));
    })
    .map(([lang]) => lang);
}

export async function runChatTool(args: Ctx & { name: string; args: Record<string, unknown> }) {
  if (!args.operationKey) return dispatchChatTool(args);
  const operation = await runIdempotentOperation({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    kind: `chat-tool:${args.name}`,
    provider: 'internal',
    idempotencyKey: args.operationKey,
    inputJson: { name: args.name, args: args.args },
    execute: () => dispatchChatTool(args),
  });
  if (operation.state === 'completed') return operation.value;
  return operationErrorBody(operation).body;
}

async function dispatchChatTool(args: Ctx & { name: string; args: Record<string, unknown> }) {
  const { name, args: a, ...ctx } = args;
  switch (name) {
    case 'research_trends':
      return researchTrendsTool(ctx, a as never);
    case 'polish_brief':
      return polishBrief(ctx, String(a.rawIdea ?? ''));
    case 'generate_hooks':
      return generateHooks(ctx, Number(a.count ?? 3), a.languages as string[] | undefined, a.refineFrom as string[] | undefined, selectionsOf(a), a.genre ? String(a.genre) : undefined);
    case 'score_hooks':
      return scoreHooks(ctx, (a.hookIds as string[]) ?? []);
    case 'approve_hook':
      return approveHook(ctx, String(a.hookId));
    case 'generate_lyrics':
      return generateLyrics(ctx, String(a.hookId), Boolean(a.cleanVersion ?? true), a.languages as string[] | undefined, selectionsOf(a), a.genre ? String(a.genre) : undefined);
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
    case 'make_material_beat':
      return makeMaterialBeatTool(ctx, a as never);
    case 'separate_stems':
      return separateStemsTool(ctx, a.songId ? String(a.songId) : undefined, a.mode === 'full' ? 'full' : 'instrumental');
    case 'learn_lyrics':
      return learnLyricsTool(ctx, String(a.lyrics ?? ''), a.genreHint ? String(a.genreHint) : undefined);
    case 'show_data_lake':
      return dataLakeReport(ctx.workspaceId);
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
  await snapshotTrend(ctx.workspaceId, a.genre ?? project?.genre, trends).catch(() => {});
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
  let charge: Awaited<ReturnType<FastifyInstance['chargeCredits']>> | undefined;
  if (!existing) {
    charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'brief_polish', refTable: 'Workspace', refId: ctx.workspaceId, idempotencyKey: toolKey(ctx, 'learn-lyrics') });
    if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  }
  let learned;
  try {
    learned = await learnLyricCraft({ workspaceId: ctx.workspaceId, raw: lyrics, genreHint });
  } catch (error) {
    if (charge?.ok) await ctx.app.refundCredits({ workspaceId: ctx.workspaceId, key: 'brief_polish', refTable: 'Workspace', refId: ctx.workspaceId, chargeId: charge.chargeId });
    throw error;
  }
  const { referenceId, craft } = learned;
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
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'brief_polish', refTable: 'Project', refId: ctx.projectId, idempotencyKey: toolKey(ctx, 'polish-brief') });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  try {
    const polished = await generateJson<{
      mood: string; topic: string; language: string[]; audience: string;
      bpm: number; references: Array<{ name: string; lane: string }>; notes: string;
    }>({
      tier: 'bulk',
      task: 'brief-polish',
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
  } catch (error) {
    await ctx.app.refundCredits({ workspaceId: ctx.workspaceId, key: 'brief_polish', refTable: 'Project', refId: ctx.projectId, chargeId: charge.chargeId });
    throw error;
  }
}

/** The user's STRUCTURED create selections, plucked from tool args — passed
 *  first-class to the writers so a polish-brief hiccup can never drop them. */
type Selections = { mood?: string; fusionGenres?: string[]; influence?: string; songTitle?: string };
function selectionsOf(a: Record<string, unknown>): Selections | undefined {
  const sel: Selections = {
    mood: typeof a.mood === 'string' ? a.mood : undefined,
    fusionGenres: Array.isArray(a.fusionGenres) ? (a.fusionGenres as string[]) : undefined,
    influence: typeof a.influence === 'string' ? a.influence : undefined,
    songTitle: typeof a.songTitle === 'string' ? a.songTitle : undefined,
  };
  return Object.values(sel).some(Boolean) ? sel : undefined;
}

// ---------------------------------------------------------------------------
// NEVER RETELL A STORY — the writer kept circling the same baby/minor love
// story. The workspace's recent drafts (title + opening lines = the story's
// fingerprint) become a DO-NOT-RETELL list every new hook/lyric must take a
// different story/angle/scene from. ONE query (projectId → workspace via the
// project relation), best-effort: a recall failure never blocks a take.
async function recentStoriesTold(workspaceId: string, excludeSongId?: string | null): Promise<string[]> {
  const drafts: Array<{ title: string | null; body: string }> = await prisma.lyricDraft
    .findMany({
      where: { project: { workspaceId }, ...(excludeSongId ? { NOT: { songId: excludeSongId } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { title: true, body: true },
    })
    .catch(() => []);
  return drafts
    .map((d) => {
      // First TWO content lines — [Section] headers and blanks carry no story.
      const lines = String(d.body ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('['))
        .slice(0, 2);
      return [(d.title ?? '').trim() || 'Untitled', lines.join(' / ')]
        .filter(Boolean)
        .join(' — ')
        .slice(0, 160);
    })
    .filter((s) => s && s !== 'Untitled');
}

async function generateHooks(ctx: Ctx, count: number, languages?: string[], refineFrom?: string[], selections?: Selections, genre?: string) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  // CHAT LANE TRUTH (audit): on the freeform path the scratch project's genre
  // only ever synced inside createBeatJob — so hooks briefed in a STALE lane.
  // When the tool names a genre, sync the project FIRST (same one-liner
  // createBeatJob uses) so every read below — lane context, learned references,
  // hard constraints — pulls the RIGHT lane.
  if (genre) await prisma.project.update({ where: { id: ctx.projectId }, data: { genre } }).catch(() => {});
  // REFINE MODE: when the user hits "Regenerate" on hooks that already exist, the
  // chat model passes their TEXT here. The writer then sharpens THESE in the same
  // lane instead of brainstorming an unrelated set. Cap + clean so a huge/garbage
  // payload can't blow the prompt; empty ⇒ fresh first generation (unchanged).
  const refine = (refineFrom ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  const project = await prisma.project.findFirstOrThrow({
    where: { id: ctx.projectId, workspaceId: ctx.workspaceId },
    include: { artist: true, briefs: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  const charge = await ctx.app.chargeCredits({
    workspaceId: ctx.workspaceId, key: 'hooks_batch_20',
    multiplier: Math.max(1, Math.ceil(count / 20)),
    refTable: 'Project',
    refId: project.id,
    idempotencyKey: toolKey(ctx, 'generate-hooks'),
  });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };

  try {
  const tasteMemory = await memoryContext(project.artistId);
  // NEVER RETELL A STORY: recent drafts become a banned-angles list on FRESH
  // generation only — refine mode sharpens the CURRENT hooks in place, and
  // banning their own story would fight that contract.
  const storiesTold = refine.length ? [] : await recentStoriesTold(ctx.workspaceId);
  const trendData = await researchTrends({ genre: project.genre }).catch(() => null);
  const trends = trendData?.digest;
  await snapshotTrend(ctx.workspaceId, project.genre, trendData).catch(() => {});
  const hmood = (project.briefs[0] as { mood?: string } | undefined)?.mood;
  const hookLane = await laneContext(ctx.workspaceId, project.genre);
  // Pre-song recall rides with the hard constraints in the extra slot (leads the fuse).
  const presong = await presongIntelligence(ctx.workspaceId, project.genre, hmood);
  const soundDna = fuseSoundDna({ laneTargets: hookLane.laneTargets, extra: [hardConstraints(project.genre, languages), presong].filter(Boolean).join('\n\n'), freshness: await freshnessBrief(ctx.workspaceId), palette: await lexiconPalette({ workspaceId: ctx.workspaceId, languages, mood: hmood, rotate: count }), dna: laneDnaBrief(project.genre), learnedRef: await learnedReferenceBrief(ctx.workspaceId, project.genre), learnedCraft: await learnedLyricCraftBrief(ctx.workspaceId, project.genre), hitCraft: prompts.hitCraftBrief('hook', hmood) });
  // BULK tier (owner's cost law): hook DRAFTS are heavy lifting — Cerebras
  // first, laddering up on any failure; the A&R refine below (directorRefineHooks)
  // stays Claude. The drop pipeline runs this per song, so speed here is what
  // kills the "nothing's happening" feel.
  const result = await generateJson<{ hooks?: Array<{ text: string; language?: string[]; syllablePattern?: string }> }>({
    tier: 'bulk',
    task: 'hooks-draft',
    system: prompts.HOOK_SYSTEM,
    user: prompts.hookUserPrompt({ artist: project.artist as never, brief: project.briefs[0] as never, count, tasteMemory, trends, soundDna, refineFrom: refine.length ? refine : undefined, selections, storiesTold: storiesTold.length ? storiesTold : undefined }),
    temperature: 0.95,
    maxTokens: 3_500,
  });
  const refined = await directorRefineHooks({ artist: project.artist as never, brief: project.briefs[0] as never, drafts: (result.hooks ?? []).map((h) => h.text), tasteMemory, trends, soundDna });

  // BUGFIX: an EMPTY refined array (director ran but returned nothing) is truthy
  // and would silently discard the raw hooks → the drop pipeline then sees zero
  // hooks and skips the whole take. Only prefer refined when it actually has rows.
  const rows = refined && refined.length
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

  if (!rows.length) {
    await ctx.app.refundCredits({ workspaceId: ctx.workspaceId, key: 'hooks_batch_20', multiplier: Math.max(1, Math.ceil(count / 20)), refTable: 'Project', refId: project.id, chargeId: charge.chargeId });
    return { error: 'hooks_generation_empty' };
  }

  const created = await prisma.$transaction(
    rows.map((r) =>
      prisma.hookCandidate.create({
        data: { projectId: project.id, text: r.text, language: r.language, score: r.score, meta: r.meta },
      })
    )
  );
  created.sort((a: { score: number | null }, b: { score: number | null }) => (b.score ?? 0) - (a.score ?? 0));
  return {
    // projectId lets the UI approve/edit a hook DIRECTLY (deterministic), instead
    // of relying on the model to parse "use hook 3" from a chat message.
    projectId: project.id,
    hooks: created.map((c: { id: string; text: string; score: number | null; meta: unknown }) => {
      const m = (c.meta as { viralScore?: number; tiktokMoment?: string } | null) ?? null;
      return { id: c.id, text: c.text, score: c.score, viralScore: m?.viralScore ?? null, tiktokMoment: m?.tiktokMoment ?? null };
    }),
    director: refined ? 'claude' : 'none',
  };
  } catch (error) {
    await ctx.app.refundCredits({ workspaceId: ctx.workspaceId, key: 'hooks_batch_20', multiplier: Math.max(1, Math.ceil(count / 20)), refTable: 'Project', refId: project.id, chargeId: charge.chargeId });
    throw error;
  }
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
    refTable: 'Project',
    refId: hooks[0]!.projectId,
    idempotencyKey: toolKey(ctx, 'score-hooks'),
  });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };

  try {
    const scores = await scoreItems({
      artist: hooks[0]!.project.artist as never,
      items: hooks.map((h: { id: string; text: string }) => ({ id: h.id, text: h.text, kind: 'hook' })),
    });
    if (!scores.length) {
      await ctx.app.refundCredits({ workspaceId: ctx.workspaceId, key: 'taste_score_batch_50', multiplier: Math.ceil(hooks.length / 50), refTable: 'Project', refId: hooks[0]!.projectId, chargeId: charge.chargeId });
      return { error: 'hook_scoring_empty' };
    }
    await Promise.all(
      scores.map((score) =>
        prisma.hookCandidate.update({ where: { id: score.id }, data: { score: score.overall } })
      )
    );
    return { scores: scores.map((score) => ({ id: score.id, overall: score.overall, notes: score.notes })) };
  } catch (error) {
    await ctx.app.refundCredits({ workspaceId: ctx.workspaceId, key: 'taste_score_batch_50', multiplier: Math.ceil(hooks.length / 50), refTable: 'Project', refId: hooks[0]!.projectId, chargeId: charge.chargeId });
    throw error;
  }
}

async function approveHook(ctx: Ctx, hookId: string) {
  const hook = await prisma.hookCandidate.findFirstOrThrow({
    where: { id: hookId, project: { workspaceId: ctx.workspaceId } },
    include: { project: { select: { artistId: true } } },
  });
  // IDEMPOTENT — approving an already-approved hook must NOT spawn a duplicate
  // song. Repeated approves (a user tap + the model also calling approve_hook, or
  // a re-run) were a real source of empty lyric-only shells in the catalog.
  if (hook.songId) {
    return { hookId, songId: hook.songId, alreadyApproved: true };
  }
  const song = await prisma.song.create({
    data: {
      workspaceId: ctx.workspaceId,
      projectId: hook.projectId,
      // TITLE LAW: the hook's first line is usually a SENTENCE — gate it, and
      // when it fails, derive a 1-3 word title from the hook's content words.
      title: pickLawfulTitle([hook.text.split('\n')[0]!], hook.text),
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

async function generateLyrics(ctx: Ctx, hookId: string, cleanVersion: boolean, languages?: string[], selections?: Selections, genre?: string) {
  const hook = await prisma.hookCandidate.findFirstOrThrow({
    where: { id: hookId, project: { workspaceId: ctx.workspaceId } },
    include: { project: { include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } } } },
  });
  // CHAT LANE TRUTH (audit, same as generate_hooks): when the tool names a genre
  // that differs from the (possibly stale scratch) project's, sync the project
  // first — and since hook.project was fetched BEFORE the sync, laneGenre below
  // is the single lane truth every brief in this take reads from.
  if (genre && genre !== hook.project.genre) {
    await prisma.project.update({ where: { id: hook.projectId }, data: { genre } }).catch(() => {});
  }
  const laneGenre = genre ?? hook.project.genre;
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'lyrics_full', refTable: 'Project', refId: hook.projectId, idempotencyKey: toolKey(ctx, 'generate-lyrics') });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };

  try {
  const lmood = (hook.project.briefs[0] as { mood?: string } | undefined)?.mood;
  // NEVER RETELL A STORY: the workspace's recent drafts — MINUS this song's own
  // draft, so a Regenerate on the same hook never bans its own story.
  const storiesTold = await recentStoriesTold(ctx.workspaceId, hook.songId);
  // Pre-song recall rides with the hard constraints in the extra slot (same as
  // hooks — the lyrics fuse was missing it, so the verses never saw the
  // measured winners/losers the hooks were briefed on).
  const lpresong = await presongIntelligence(ctx.workspaceId, laneGenre, lmood);
  const lyricSoundDna = fuseSoundDna({
    extra: [hardConstraints(laneGenre, languages), lpresong].filter(Boolean).join('\n\n'),
    freshness: await freshnessBrief(ctx.workspaceId),
    palette: await lexiconPalette({ workspaceId: ctx.workspaceId, languages: languages?.length ? languages : hook.project.artist.languages, mood: lmood, rotate: Date.now() % 97 }),
    dna: laneDnaBrief(laneGenre),
    learnedRef: await learnedReferenceBrief(ctx.workspaceId, laneGenre),
    learnedCraft: await learnedLyricCraftBrief(ctx.workspaceId, laneGenre),
    hitCraft: prompts.hitCraftBrief('lyric', lmood),
  }, 6000); // lyrics: leaner than hooks — a huge input + long output JSON breaks more often

  // WRITING BRAIN craft fields (premise/hookCell/anchors/sectionPurposes) ride
  // on every pass — the Singing Brain downstream consumes them from craftJson.
  type LyricOut = { title: string; body: string; cleanVersion?: string; explicit?: boolean; structure?: unknown; languageMix?: Record<string, number>; needsNativeReview?: string[]; premise?: string; hookCell?: string; anchors?: string[]; sectionPurposes?: Record<string, string> };
  const lyricUser = prompts.lyricUserPrompt({ artist: hook.project.artist as never, brief: hook.project.briefs[0] as never, hookText: hook.text, cleanVersion, languages: languages?.length ? languages : hook.project.artist.languages, soundDna: lyricSoundDna, selections, storiesTold: storiesTold.length ? storiesTold : undefined });

  // RETRY UNTIL NON-EMPTY: a long multi-line lyric returned as a JSON string
  // sometimes comes back empty/broken (~1 in 3 live) — regenerate up to 3x
  // instead of failing the take. The last good attempt wins.
  let firstOutput: LyricOut = { title: '', body: '' };
  for (let attempt = 0; attempt < 3; attempt++) {
    let out = await generateJson<LyricOut>({ tier: 'judgment', system: prompts.LYRIC_SYSTEM, user: lyricUser, temperature: 0.8, maxTokens: 5_000, timeoutMs: 90_000, model: process.env.WRITER_MODEL, task: 'lyrics-draft' }).catch(() => null);
    // THE CRAFT POLISH (the Blue-Tick lesson): the same brain, shown its own
    // draft through an editor's eyes, writes a clearly better song than any
    // one-shot. One extra call (~2-3c) buys the v2. WRITER_TWO_PASS=0 disables.
    if (out?.body && process.env.WRITER_TWO_PASS !== '0') {
      const polished = await generateJson<{ title: string; body: string; cleanVersion?: string; whatChanged?: string[]; captionLine?: string; premise?: string; hookCell?: string; anchors?: string[]; sectionPurposes?: Record<string, string> }>({
        tier: 'judgment',
        system: prompts.LYRIC_POLISH_SYSTEM,
        user: prompts.lyricPolishPrompt({ draftTitle: out.title, draftBody: out.body, genre: laneGenre, mood: lmood, languages: languages?.length ? languages : hook.project.artist.languages }),
        temperature: 0.7,
        maxTokens: 5_000,
        timeoutMs: 90_000,
        model: process.env.WRITER_MODEL,
        task: 'lyric-polish',
      }).catch(() => null);
      if (polished?.body && polished.body.length > 200) {
        // Craft object from the FINAL pass wins — the polish rewrote the lyric,
        // so its premise/hookCell/anchors describe the shipped version. Fall
        // back to the draft's only when the polish omitted a field.
        out = {
          ...out,
          title: polished.title || out.title,
          body: polished.body,
          cleanVersion: polished.cleanVersion ?? out.cleanVersion,
          premise: polished.premise ?? out.premise,
          hookCell: polished.hookCell ?? out.hookCell,
          anchors: Array.isArray(polished.anchors) && polished.anchors.length ? polished.anchors : out.anchors,
          sectionPurposes: polished.sectionPurposes ?? out.sectionPurposes,
        };
      }
    }
    if (out && typeof out.body === 'string' && out.body.trim().length >= 20) { firstOutput = out; break; }
    firstOutput = out ?? firstOutput;
  }

  // GUARDRAIL: verify language obedience against the SELECTION; one stern
  // retry on violation. Any remaining violation is reported, never hidden.
  let output = firstOutput;
  let langViolation = languageViolations(output.languageMix, languages);
  if (langViolation.length) {
    const retry = await generateJson<typeof firstOutput>({
      // JUDGMENT tier: this rewrites the WHOLE lyric — final lyric writing.
      tier: 'judgment',
      task: 'lyrics-language-retry',
      system: prompts.LYRIC_SYSTEM,
      user:
        `YOUR PREVIOUS ATTEMPT FAILED THE LANGUAGE RULE — it used: ${langViolation.join(', ')}. ` +
        `REWRITE THE WHOLE LYRIC using ONLY ${(languages ?? []).map((l) => LANG_NAMES[normLang(l)] ?? l).join(' + ')}. No exceptions, not even one line.\n\n` +
        prompts.lyricUserPrompt({
          artist: hook.project.artist as never,
          brief: hook.project.briefs[0] as never,
          hookText: hook.text,
          cleanVersion,
          languages: languages?.length ? languages : hook.project.artist.languages,
          soundDna: hardConstraints(laneGenre, languages),
          storiesTold: storiesTold.length ? storiesTold : undefined,
        }),
      temperature: 0.7,
      maxTokens: 5_000,
    }).catch(() => null);
    if (retry?.body) {
      output = retry;
      langViolation = languageViolations(retry.languageMix, languages);
    }
  }
  // GUARD: `body` is required (non-null). A truncated/salvaged JSON response can
  // arrive without it — never pass undefined to Prisma (that's the ugly
  // "Invalid prisma.lyricDraft.upsert()" the user saw). If the body is missing,
  // this take failed cleanly; the drop batch continues.
  let body = typeof output.body === 'string' ? output.body.trim() : '';
  if (body.length < 20) {
    throw new Error('lyric came back empty/truncated — regenerating recommended');
  }
  // WRITING BRAIN craft object for the downstream Singing Brain — parsed
  // tolerantly (absent/malformed fields = null; the take never fails on craft).
  // `output` is whichever pass won (draft → polish → language retry), so the
  // FINAL pass's craft ships. Always written (nulls included) so a Regenerate
  // overwrites any stale craft from a prior take.
  const craftJson = {
    premise: typeof output.premise === 'string' && output.premise.trim() ? output.premise.trim() : null,
    hookCell: typeof output.hookCell === 'string' && output.hookCell.trim() ? output.hookCell.trim() : null,
    anchors: Array.isArray(output.anchors)
      ? output.anchors.filter((w): w is string => typeof w === 'string' && w.trim().length > 0).map((w) => w.trim())
      : null,
    sectionPurposes:
      output.sectionPurposes && typeof output.sectionPurposes === 'object' && !Array.isArray(output.sectionPurposes)
        ? output.sectionPurposes
        : null,
  };
  // LyricDraft.songId is @unique — a song can have ONE lyric. Re-running lyrics
  // (Continue/Regenerate) must UPDATE it, not crash on the unique constraint.
  const lyricData = {
    projectId: hook.projectId,
    // TITLE LAW: the writer's title is gated; on failure derive from the hook
    // cell (the title IS the cell), then the hook text. lyric.title outranks
    // song.title on every display surface, so this is the title that ships.
    title: pickLawfulTitle(
      [typeof output.title === 'string' ? output.title.trim() : ''],
      craftJson.hookCell || hook.text
    ),
    body,
    cleanVersion: typeof output.cleanVersion === 'string' ? output.cleanVersion : undefined,
    explicit: output.explicit ?? false,
    structure: (output.structure ?? undefined) as never,
    languageMix: (output.languageMix ?? undefined) as never,
    craftJson: craftJson as never,
  };
  // CATALOGUE QA GATE (owner audit 2026-07-12): empty/duplicate/contaminated/
  // production-note lyrics must NEVER advance to a render or the catalogue. Check
  // against the workspace's existing lyrics (dup detection) and block fatally —
  // the drop treats a returned error as a failed take (no wasted render credit).
  const catRows = await prisma.song.findMany({
    where: { workspaceId: ctx.workspaceId, quarantined: false, lyric: { isNot: null }, ...(hook.songId ? { NOT: { id: hook.songId } } : {}) },
    select: { id: true, title: true, lyric: { select: { body: true } } },
    take: 300,
    orderBy: { createdAt: 'desc' },
  });
  const catalogue = catRows.map((s: { id: string; title: string; lyric: { body: string } | null }) => ({ id: s.id, title: s.title, bodyNorm: normalizeLyricBody(s.lyric?.body ?? '') }));
  let qa = lyricQaCheck({
    title: lyricData.title,
    body,
    hookCell: craftJson.hookCell,
    languageMix: output.languageMix as Record<string, number> | undefined,
    artistAuthored: false,
    catalogue,
  });
  // REJECT_AND_RESTART loop (owner spec + feedback): a blocked lyric is not a
  // dead take — feed the exact QA failures back to the writer and REGENERATE, up
  // to 2 corrective passes, so Create self-corrects (e.g. strips environment
  // stuffing) instead of just erroring. The last attempt either clears the gate
  // or fails honestly.
  let curLangMix = output.languageMix as Record<string, number> | undefined;
  for (let fix = 0; !qa.ok && fix < 2; fix++) {
    const rewrite = await generateJson<LyricOut>({
      tier: 'judgment',
      task: 'lyric-qa-fix',
      system: prompts.LYRIC_SYSTEM,
      user: JSON.stringify({
        REWRITE_REASON: 'Your previous lyric was REJECTED by the A&R gate. Rewrite it obeying THE RECORD LAW and fixing EVERY failure below. Keep the hook cell and the language; make it leaner and less descriptive.',
        QA_FAILURES_MUST_FIX: qa.blocks,
        AVOID: 'Do NOT open on a location. Do NOT put a place/food/transport noun in most lines. Do NOT write a confession bridge or an explaining outro. The hook must survive with the setting words removed.',
        hook: hook.text,
        keep_hook_cell: craftJson.hookCell,
        languages: languages?.length ? languages : hook.project.artist.languages,
      }),
      temperature: 0.7,
      maxTokens: 4_000,
      timeoutMs: 90_000,
      model: process.env.WRITER_MODEL,
    }).catch(() => null);
    if (!rewrite?.body || rewrite.body.trim().length < 20) break;
    body = rewrite.body.trim();
    if (typeof rewrite.hookCell === 'string' && rewrite.hookCell.trim()) craftJson.hookCell = rewrite.hookCell.trim();
    lyricData.body = body;
    lyricData.title = pickLawfulTitle([typeof rewrite.title === 'string' ? rewrite.title.trim() : ''], craftJson.hookCell || hook.text);
    curLangMix = (rewrite.languageMix as Record<string, number>) ?? curLangMix;
    lyricData.languageMix = (rewrite.languageMix ?? lyricData.languageMix) as never;
    qa = lyricQaCheck({ title: lyricData.title, body, hookCell: craftJson.hookCell, languageMix: curLangMix, artistAuthored: false, catalogue });
  }
  if (!qa.ok) {
    // Quarantine the shell song if one exists so nothing half-written lingers visible.
    if (hook.songId) await prisma.song.update({ where: { id: hook.songId }, data: { quarantined: true, quarantineReason: qa.blocks.join('; ') } }).catch(() => {});
    await ctx.app.refundCredits({ workspaceId: ctx.workspaceId, key: 'lyrics_full', refTable: 'Project', refId: hook.projectId, chargeId: charge.chargeId });
    return { error: `lyric_qa_blocked (after 2 corrective rewrites): ${qa.blocks.join('; ')}`, qa: { blocks: qa.blocks, band: qa.band } };
  }
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
  } catch (error) {
    await ctx.app.refundCredits({ workspaceId: ctx.workspaceId, key: 'lyrics_full', refTable: 'Project', refId: hook.projectId, chargeId: charge.chargeId });
    throw error;
  }
}

async function createBeatJob(ctx: Ctx, a: { genre: string; fusionGenres?: string[]; mood?: string; pinnedReferenceId?: string; bpm: number; keySignature?: string; durationS?: number; vibePrompt?: string; withStems?: boolean; withVocals?: boolean; songEngine?: 'suno' | 'eleven' | 'ace_step' | 'minimax' | 'own'; influence?: string; languages?: string[]; voice?: 'auto' | 'female' | 'male' | 'duet' | 'group'; candidates?: number; instruments?: string[] }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  if (a.withVocals && a.songEngine === 'own') {
    return { error: 'own_vocal_pipeline_unavailable', message: 'Our Engine currently produces instrumentals only. Choose a vocal-capable engine for a sung song.' };
  }

  // Honor the requested genre for the whole session — the chat's scratch project
  // defaults to afro_fusion, so sync it to what was actually asked for.
  if (a.genre) await prisma.project.update({ where: { id: ctx.projectId }, data: { genre: a.genre } }).catch(() => {});

  // OUR OWN ENGINE — parity with the REST path (beats.ts). This path had NO own
  // branch, so picking "Our Engine" on Describe-it fell through to musicAdapter
  // ('own' is not a provider) → the Stub → a guaranteed fail with a MISLEADING
  // "no music engine configured". Assemble from the artist's material instead.
  // Sung vocals aren't wired to the own engine yet — the bed renders and we SAY
  // SO honestly rather than shipping an instrumental labeled as a song.
  // MATERIAL-FIRST AUTO (audit: 'auto' ALWAYS rented a provider): engine unset/
  // 'auto' + INSTRUMENTAL ask + a stocked shelf (≥ OWN_ENGINE_MIN_ROLES distinct
  // roles for this genre) → route here too, and SAY so (materialSource).
  // withVocals NEVER auto-routes here — the own engine cannot sing.
  const engineUnset = !a.songEngine || (a.songEngine as string) === 'auto';
  const autoOwnRoles = engineUnset && !a.withVocals && a.genre ? await ownShelfRoles(ctx.workspaceId, a.genre) : null;
  if (a.songEngine === 'own' || autoOwnRoles) {
    const idempotencyKey = toolKey(ctx, 'beat-own');
    const ownCharge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'beat_idea_short_30s', refTable: 'Project', refId: ctx.projectId, idempotencyKey });
    if (!ownCharge.ok) return { error: 'insufficient_credits', ...ownCharge };
    const ownBpm = a.bpm ?? genreSignature(a.genre).bpm;
    const ownSong = a.withVocals
      ? await prisma.song.findFirst({ where: { projectId: ctx.projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
      : null;
    const ownJob = await createQueuedProviderJob({
      app: ctx.app,
      queue: ctx.app.queues.music,
      jobName: 'own-engine',
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: 'music',
      provider: 'afrohit-own',
      inputJson: { ownEngine: true, genre: a.genre, bpm: ownBpm, ...(autoOwnRoles ? { autoOwn: true } : {}) },
      charge: ownCharge,
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId: ctx.workspaceId, projectId: ctx.projectId, songId: ownSong?.id, genre: a.genre, bpm: ownBpm, melodyPrompt: genreSignature(a.genre).melodyPrompt }),
    });
    return {
      jobId: ownJob.jobId, status: 'queued', replayed: ownJob.replayed, engine: 'afrohit-own-v1',
      ...(autoOwnRoles ? { materialSource: `own-shelf (${autoOwnRoles} roles)` } : {}),
      note: a.withVocals
        ? 'Our engine builds the INSTRUMENTAL bed from your own + synthesized material — sung vocals are not wired to it yet. Add a vocal by upload, or pick MiniMax for a fully sung take.'
        : autoOwnRoles
        ? `The shelf is stocked — own-shelf (${autoOwnRoles} roles) of your own material — so this beat is assembled from YOUR OWN material instead of renting a provider. Poll the job.`
        : 'Building the beat from your own + synthesized material (owned engine). Poll the job.',
    };
  }

  const route = validateMusicRoute(a.songEngine, await musicRouteCapabilities(ctx.workspaceId), !!a.withVocals);
  if (!route.ok) return { error: route.error, message: route.message, statusCode: route.statusCode };

  // Full song WITH AI vocals: grab the latest lyric so the model can sing it.
  let lyrics: string | undefined;
  let songId: string | undefined;
  let artistAuthored = false;
  let draftCraft: ReturnType<typeof craftOf> = null;
  let hookText: string | undefined;
  if (a.withVocals) {
    const song = await prisma.song.findFirst({
      where: { projectId: ctx.projectId },
      orderBy: { createdAt: 'desc' },
      include: { lyric: true, hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    songId = song?.id;
    const lyric =
      song?.lyric ??
      (await prisma.lyricDraft.findFirst({
        where: { projectId: ctx.projectId },
        orderBy: { createdAt: 'desc' },
      }));
    // VERBATIM LAW (parity with the REST path — this path used to sing the AI
    // cleanVersion of an artist-authored draft and then enrich it): the
    // artist's own words reach the engine EXACTLY as written — body, never
    // cleanVersion, never enrichment, never the Singing Brain.
    artistAuthored = !!(lyric as { artistAuthored?: boolean } | null)?.artistAuthored;
    lyrics = artistAuthored ? lyric?.body ?? undefined : lyric?.cleanVersion ?? lyric?.body ?? undefined;
    // Writing Brain craft (premise/hookCell/anchors) for the Singing Brain;
    // the approved hook is the hookCell fallback on old drafts (null craftJson).
    draftCraft = craftOf(lyric);
    hookText = song?.hooks?.[0]?.text;
    if (!lyrics) return { error: 'no_lyrics — write the lyrics first, then make the full song' };
  }

  // Genre Sound DNA (blended when mixing genres, COLORED by the mood) + what it
  // LEARNED from the artist's own references — the pinned just-listened one
  // first. Learned tokens join the MUSIC-MODEL tags so the heard sound shapes
  // the audio, not only the words.
  const dna = a.fusionGenres?.length ? laneDna(a.genre, { mood: a.mood, fusionGenres: a.fusionGenres }) : laneDna(a.genre, { mood: a.mood });
  const learned = await learnedReferenceBrief(ctx.workspaceId, a.genre, a.pinnedReferenceId);
  const learnedTags = await learnedStyleTags(ctx.workspaceId, a.genre, a.pinnedReferenceId);
  // PARITY with the REST path (audit: the chat path skipped both): DSP-measured
  // facts reach the render, and the job records WHICH references it used.
  const measuredTags = await learnedMeasuredTags(ctx.workspaceId, a.genre, a.pinnedReferenceId);
  const trainingUsage = await learnedUsage(ctx.workspaceId, a.genre, a.pinnedReferenceId);
  // BLUEPRINT (precision mode): a PINNED, MEASURED reference contributes its
  // SKELETON as a hard contract — same section count/lengths/BPM, all-new flesh.
  const blueprint = a.pinnedReferenceId ? await blueprintForReference(ctx.workspaceId, a.pinnedReferenceId) : null;
  const bpBrief = blueprint ? structureBrief(blueprint) : '';
  const dnaTags = [...measuredTags, ...(dna.tags ?? []), ...learnedTags, ...(blueprint ? [`structure ${blueprint.sections.length} sections`, ...(blueprint.bpm ? [`${blueprint.bpm} bpm exact`] : [])] : [])];

  // Arrange the vocal to sound ALIVE — ad-libs, doubled/harmonized hook —
  // then the SINGING BRAIN converts the (possibly enriched) semantic lyric to
  // the measured sung form. BOTH are skipped for artist-authored drafts: the
  // artist's words are never transformed (verbatim law), and the job records
  // that honestly in sungForm.
  let styleHints: string[] = [];
  let sungForm: Record<string, unknown> | undefined;
  if (a.withVocals && lyrics) {
    if (artistAuthored) {
      sungForm = { applied: false, skipped: 'artist-authored — verbatim law' };
    } else {
      const project = await prisma.project.findUnique({
        where: { id: ctx.projectId },
        include: { artist: true },
      });
      // The user's SELECTED languages outrank the artist profile's defaults.
      const langs = a.languages?.length ? a.languages : project?.artist.languages;
      const enriched = await enrichLyricsForVocals({
        genre: a.genre,
        voice: a.voice,
        lyricBody: lyrics,
        languages: langs,
        laneSummary: project?.artist.laneSummary ?? undefined,
        soundDna: joinBriefs([bpBrief, dna.brief, learned]),
      });
      if (enriched) {
        lyrics = enriched.enrichedLyrics;
        styleHints = enriched.styleTags;
      }
      // SINGING BRAIN — scorecard-measured, one retry, never blocks: a failing
      // conversion ships the SEMANTIC form with the failures recorded.
      const sung = await applySingingBrain({
        semanticLyric: lyrics,
        draftCraft,
        hookText,
        genre: a.genre,
        languages: langs,
      });
      lyrics = sung.lyrics;
      sungForm = sung.sungForm;
    }
  }

  // PHASE 4 — Lane pipeline. Pull the measured lane context; on a REGEN of a take
  // that drifted, its stored repair steering (Phase 3) becomes concrete style
  // directives that push the render back in-lane. Empty on a fresh gen — additive.
  const lane = await laneContext(ctx.workspaceId, a.genre, songId);
  const laneSteer = lane.repair
    ? lane.repair.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()).slice(0, 3)
    : [];

  const idempotencyKey = toolKey(ctx, 'beat-generate');
  const charge = await ctx.app.chargeCredits({
    workspaceId: ctx.workspaceId,
    key: a.withVocals || a.withStems ? 'full_song_demo' : 'beat_idea_short_30s',
    // WO-1/WO-5: N candidates = N renders = N charges against the cap.
    multiplier: Math.max(1, a.candidates ?? 1),
    refTable: 'Project',
    refId: ctx.projectId,
    idempotencyKey,
  });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  // ONE final tag set, stored AND sent — the Truth report reads the stored copy
  // (promptStyleTags) and needs songId to FIND this job at all; the engine
  // renders from the payload copy. They must never diverge.
  const finalDnaTags = [
    // Voice + language identity as TAGS: uncapped by the vibe budget, so
    // they always reach the engine. The Igbo/Yoruba pronunciation belts
    // ride here — the whole reason "ig" was being sung with Bantu phonetics.
    ...[voiceVocalTag(a.voice), languageVocalTag(a.languages)].filter((t): t is string => !!t),
    // VOCAL-RHYTHM DIRECTIVE: the sung text carries the syllables; this tag
    // carries the pocket (parity with the REST path).
    ...((sungForm as { applied?: boolean } | null)?.applied ? ['vocal delivery: syncopated Afro phrasing, off-beat pushes into the hook, melisma runs held on open vowels'] : []),
    ...dnaTags, ...styleHints.slice(0, 3), ...laneSteer,
  ].slice(0, 12);
  const job = await createQueuedProviderJob({
    app: ctx.app,
    queue: ctx.app.queues.music,
    jobName: 'generate-music',
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    kind: 'music',
    provider: a.songEngine ?? 'auto',
    inputJson: { ...a, songId, trainingUsage, dnaTags: finalDnaTags, ...(sungForm ? { sungForm } : {}) },
    charge,
    idempotencyKey,
    payload: (jobId) => ({
      jobId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      songId,
      input: {
        ...a,
        // Influence = steer the SOUND toward an artist's lane (vibe/energy),
        // never a clone and never named. Goes to the music model as a style cue.
        // ANTI-SOUP: vibe stays short (vibe + influence only); styleHints ride
        // as tags on dnaTags where terse tokens belong. The LANGUAGE belt rides
        // in dnaTags too — composeStyleTags caps vibePrompt at 160ch, and the
        // belt alone is ~155ch with Igbo selected, so putting it here starved
        // the engine of the vibe AND clipped the belt itself.
        vibePrompt: [[a.vibePrompt].filter(Boolean).join(' '), a.influence ? `in the vibe/lane of ${a.influence} (capture the feel, not a copy)` : null].filter(Boolean).join(', ') || undefined,
        durationS: a.durationS ?? blueprint?.totalDurationS ?? (a.withVocals ? genreSignature(a.genre).durationS : 60),
        withStems: a.withStems ?? !a.withVocals,
        withVocals: a.withVocals ?? false,
        songEngine: a.songEngine,
        dnaTags: finalDnaTags,
        languages: a.languages?.length ? a.languages : undefined,
        lyrics,
        blueprint: blueprint ?? undefined,
      },
    }),
  });
  return { jobId: job.jobId, replayed: job.replayed, status: 'queued', mode: a.withVocals ? 'full_song_with_vocals' : 'instrumental' };
}

async function renderDemoVocal(ctx: Ctx, a: { voiceProfileId: string; lyricId: string; role?: 'lead' | 'double' | 'ad-lib' | 'harmony' }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const voice = await prisma.voiceProfile.findFirstOrThrow({
    where: { id: a.voiceProfileId, workspaceId: ctx.workspaceId, status: 'READY' },
  });
  const lyric = await prisma.lyricDraft.findFirstOrThrow({
    where: { id: a.lyricId, projectId: ctx.projectId, approved: true },
  });
  const idempotencyKey = toolKey(ctx, 'voice-render');
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'voice_render_full', refTable: 'Project', refId: ctx.projectId, idempotencyKey });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await createQueuedProviderJob({
    app: ctx.app,
    queue: ctx.app.queues.voice,
    jobName: 'render-vocal',
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    kind: 'voice',
    provider: voice.provider,
    inputJson: a,
    charge,
    idempotencyKey,
    payload: (jobId) => ({
      jobId, workspaceId: ctx.workspaceId, projectId: ctx.projectId,
      voiceProfileId: voice.id, providerVoiceId: voice.providerVoiceId,
      lyricBody: lyric.cleanVersion ?? lyric.body, role: a.role ?? 'lead',
    }),
  });
  return { jobId: job.jobId, replayed: job.replayed, status: 'queued' };
}

async function generateCoverArt(ctx: Ctx, a: { prompt: string; quality?: 'low' | 'medium' | 'high'; size?: '1024x1024' | '1024x1792' | '1792x1024' }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const idempotencyKey = toolKey(ctx, 'cover-art');
  const charge = await ctx.app.chargeCredits({
    workspaceId: ctx.workspaceId,
    key: (a.quality ?? 'medium') === 'high' ? 'cover_art_high' : 'cover_art_low',
    refTable: 'Project',
    refId: ctx.projectId,
    idempotencyKey,
  });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await createQueuedProviderJob({
    app: ctx.app,
    queue: ctx.app.queues.image,
    jobName: 'generate-image',
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    kind: 'image',
    provider: process.env.IMAGE_PROVIDER ?? 'openai',
    inputJson: a,
    charge,
    idempotencyKey,
    payload: (jobId) => ({ jobId, workspaceId: ctx.workspaceId, projectId: ctx.projectId, prompt: a.prompt, size: a.size ?? '1024x1024', quality: a.quality ?? 'medium', kind: 'cover' }),
  });
  return { jobId: job.jobId, replayed: job.replayed };
}

async function generateStoryboard(ctx: Ctx, a: { durationS?: number; format?: 'vertical' | 'square' | 'landscape'; prompt?: string }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const project = await prisma.project.findFirstOrThrow({
    where: { id: ctx.projectId, workspaceId: ctx.workspaceId },
    include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } },
  });
  const result = await generateJson<{ title: string; shots: Array<{ index: number; prompt: string; duration_s: number; motion?: string; lighting?: string }> }>({
    tier: 'bulk',
    task: 'storyboard',
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
    where: { id: a.conceptId, projectId: ctx.projectId, project: { workspaceId: ctx.workspaceId } },
  });
  const shots = (concept.storyboard as Array<{ duration_s?: number }>) ?? [];
  const totalSec =
    a.shotIndex == null
      ? shots.reduce((s, sh) => s + (sh.duration_s ?? 3), 0)
      : shots[a.shotIndex]?.duration_s ?? 3;
  const idempotencyKey = toolKey(ctx, 'video-render');
  const charge = await ctx.app.chargeCredits({
    workspaceId: ctx.workspaceId,
    key: totalSec <= 8 ? 'video_8s' : 'video_20s',
    refTable: 'Project',
    refId: ctx.projectId,
    idempotencyKey,
  });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await createQueuedProviderJob({
    app: ctx.app,
    queue: ctx.app.queues.video,
    jobName: 'render-video',
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    kind: 'video',
    provider: process.env.VIDEO_PROVIDER ?? 'stub',
    inputJson: a,
    charge,
    idempotencyKey,
    payload: (jobId) => ({ jobId, workspaceId: ctx.workspaceId, projectId: ctx.projectId, conceptId: concept.id, shotIndex: a.shotIndex, shots, format: concept.format }),
  });
  return { jobId: job.jobId, replayed: job.replayed };
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
      approvals: approvals.map((a: { id: string; gate: string; decision: string }) => ({ id: a.id, gate: a.gate, decision: a.decision })) as never,
      aiDisclosure: { distroDisclosure: 'GenAI-assisted, human-edited', credits: { lyrics: 'AI-assisted, human-edited' } } as never,
      hash,
    },
  });
  return { receiptId: receipt.id, check };
}

async function createReleaseKit(ctx: Ctx, songId: string) {
  const song = await prisma.song.findFirstOrThrow({
    where: { id: songId, workspaceId: ctx.workspaceId },
    include: {
      masters: { take: 1 },
      mixes: { take: 1 },
      beats: { take: 1 },
    },
  });
  // NEVER bundle a "release" for a song with no rendered audio — that's how
  // autopilot ended up marking a song RELEASED with audioUrl:null and telling the
  // user "release complete" when nothing had rendered. Require real audio first.
  if (!song.masters.length && !song.mixes.length && !song.beats.length) {
    return {
      error: 'not_rendered',
      message: 'The song has no audio yet — it is still rendering. Wait for the beat/master to finish, then bundle the release.',
    };
  }
  const idempotencyKey = toolKey(ctx, 'release-export');
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'release_export', refTable: 'Song', refId: songId, idempotencyKey });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await createQueuedProviderJob({
    app: ctx.app,
    queue: ctx.app.queues.export,
    jobName: 'export-release',
    workspaceId: ctx.workspaceId,
    projectId: song.projectId,
    kind: 'export',
    provider: 'internal',
    inputJson: { songId },
    charge,
    idempotencyKey,
    payload: (jobId) => ({ jobId, workspaceId: ctx.workspaceId, projectId: song.projectId, songId }),
  });
  return { jobId: job.jobId, replayed: job.replayed };
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
  const idempotencyKey = toolKey(ctx, 'analyze-audio');
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'analyze_audio', refTable: 'Project', refId: ctx.projectId, idempotencyKey });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await createQueuedProviderJob({
    app: ctx.app,
    queue: ctx.app.queues.music,
    jobName: 'analyze-audio',
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    kind: 'analyze',
    provider: 'replicate',
    inputJson: { url },
    charge,
    idempotencyKey,
    payload: (jobId) => ({ jobId, workspaceId: ctx.workspaceId, projectId: ctx.projectId, url }),
  });
  return { jobId: job.jobId, replayed: job.replayed, status: 'queued', note: 'Listening — poll the job; outputJson.profile has BPM/key/genre/mood/instruments + a fresh-vibe prompt to create an original from.' };
}

async function runDropTool(ctx: Ctx, a: { theme: string; count?: number; genre?: string; bpm?: number; withVocals?: boolean; songEngine?: 'suno' | 'eleven' | 'ace_step' | 'minimax'; languages?: string[]; mood?: string; fusionGenres?: string[]; influence?: string; durationS?: number; voice?: 'auto' | 'female' | 'male' | 'duet' | 'group'; songTitle?: string }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const count = Math.min(Math.max(Number(a.count ?? 3), 1), 6);
  const genre = a.genre ?? 'afrobeats';
  const bpm = Number(a.bpm ?? 103);
  await polishBrief({ ...ctx, operationKey: ctx.operationKey ? `${ctx.operationKey}:brief` : undefined }, a.theme);
  const drops: Array<{ songId?: string; hookText?: string; score: number | null; jobId?: string; error?: string }> = [];
  for (let i = 0; i < count; i++) {
    const stepCtx = { ...ctx, operationKey: ctx.operationKey ? `${ctx.operationKey}:take:${i}` : undefined };
    // Languages are LAW for the writers too — omitting them here left chat drops
    // writing in the artist-profile defaults regardless of what the user picked.
    // The genre rides along the same way (lane truth): drops synced the project
    // genre only at createBeatJob — AFTER the hooks were already written stale.
    const hk = (await generateHooks(stepCtx, 3, a.languages, undefined, undefined, a.genre)) as { hooks?: Array<{ id: string; text: string; score: number | null }> };
    let hooks = hk?.hooks ?? [];
    if (!hooks.length) continue;
    if (hooks.every((h) => h.score == null)) {
      const sc = (await scoreHooks(stepCtx, hooks.map((h) => h.id))) as { scores?: Array<{ id: string; overall: number }> };
      const m = new Map((sc?.scores ?? []).map((s) => [s.id, s.overall]));
      hooks = hooks.map((h) => ({ ...h, score: m.get(h.id) ?? h.score }));
    }
    const best = hooks.slice().sort((x, y) => (y.score ?? 0) - (x.score ?? 0))[0]!;
    const ap = (await approveHook(stepCtx, best.id)) as { songId?: string };
    await generateLyrics(stepCtx, best.id, true, a.languages);
    const beat = (await createBeatJob(stepCtx, { genre, bpm, withVocals: a.withVocals ?? true, songEngine: a.songEngine, languages: a.languages, mood: a.mood, fusionGenres: a.fusionGenres, influence: a.influence, durationS: a.durationS, voice: a.voice, vibePrompt: a.theme })) as { jobId?: string; songId?: string; error?: string };
    // The user's typed song name IS the title (songTitle was a dead field).
    const producedSongId = ap?.songId ?? beat?.songId;
    if (a.songTitle && producedSongId) {
      const t = a.songTitle.slice(0, 80);
      await prisma.song.update({ where: { id: producedSongId }, data: { title: t } }).catch(() => undefined);
      await prisma.lyricDraft.updateMany({ where: { songId: producedSongId }, data: { title: t } }).catch(() => undefined);
    }
    drops.push({ songId: producedSongId, hookText: best.text, score: best.score ?? null, jobId: beat?.jobId, error: beat?.error });
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
    const mix = (await prisma.mix.findFirst({ where: { projectId: song.projectId, songId: song.id, preset: 'source', url: src } })) ??
      (await prisma.mix.create({ data: { projectId: song.projectId, songId: song.id, preset: 'source', url: src, notes: 'Master source (current rendered audio)', approved: true } }));
    mixId = mix.id;
  }
  const idempotencyKey = toolKey(ctx, 'master-song');
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'master_preset', refTable: 'Song', refId: song.id, idempotencyKey });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  // 'finished' routes the chain (light-touch conform for finished-engine renders
  // and uploaded masters — the full chain on a finished master dulls it; see
  // songs.ts /:id/master). LOUDNESS LAW v2: default target = commercial Afro
  // loudness (-9 LUFS, two-pass driven); 'breathe_-16.5' is the dynamics opt-in.
  const finished =
    (!realMix && ['minimax', 'suno'].includes(latestBeat?.provider ?? '')) || realMix?.preset === 'uploaded';
  const p = preset || 'afro_stream_-9';
  const job = await createQueuedProviderJob({
    app: ctx.app,
    queue: ctx.app.queues.master,
    jobName: 'create-master',
    workspaceId: ctx.workspaceId,
    projectId: song.projectId,
    kind: 'master',
    provider: 'internal',
    inputJson: { songId, mixId, preset: p, finished },
    charge,
    idempotencyKey,
    payload: (jobId) => ({ jobId, workspaceId: ctx.workspaceId, projectId: song.projectId, songId, mixId, preset: p, finished }),
  });
  return { jobId: job.jobId, replayed: job.replayed, status: 'queued', preset: p };
}

async function makeSnippetTool(ctx: Ctx, songId: string | undefined, startS: number) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const song = songId
    ? await prisma.song.findFirst({ where: { id: songId, workspaceId: ctx.workspaceId }, select: { id: true, projectId: true } })
    : await prisma.song.findFirst({ where: { projectId: ctx.projectId, workspaceId: ctx.workspaceId }, orderBy: { createdAt: 'desc' }, select: { id: true, projectId: true } });
  if (!song) return { error: 'no_song_to_clip' };
  const idempotencyKey = toolKey(ctx, 'snippet');
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'beat_idea_short_30s', refTable: 'Song', refId: song.id, idempotencyKey });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await createQueuedProviderJob({
    app: ctx.app,
    queue: ctx.app.queues.music,
    jobName: 'snippet',
    workspaceId: ctx.workspaceId,
    projectId: song.projectId,
    kind: 'video',
    provider: 'snippet',
    inputJson: { songId: song.id, startS },
    charge,
    idempotencyKey,
    payload: (jobId) => ({ jobId, workspaceId: ctx.workspaceId, projectId: song.projectId, songId: song.id, startS: startS || 0 }),
  });
  return { jobId: job.jobId, replayed: job.replayed, status: 'queued' };
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
  return { beats: beats.map((b: { id: string; provider: string; bpm: number | null; keySignature: string | null; duration: number | null; stems: Array<{ role: string }>; url: string }) => ({ id: b.id, provider: b.provider, bpm: b.bpm, key: b.keySignature, durationS: b.duration, stems: b.stems.map((s: { role: string }) => s.role), url: b.url })) };
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
    songs: songs.map((s: { id: string; title: string; status: string; releaseReady: boolean; lyric: { title: string | null } | null; masters: Array<{ url: string }>; mixes: Array<{ url: string }>; beats: Array<{ url: string }> }) => ({ id: s.id, title: s.lyric?.title || s.title, status: s.status, releaseReady: s.releaseReady, audioUrl: s.masters[0]?.url ?? s.mixes[0]?.url ?? s.beats[0]?.url ?? null })),
  };
}

async function predictHitTool(ctx: Ctx, songId: string | undefined) {
  const song = songId
    ? await prisma.song.findFirst({ where: { id: songId, workspaceId: ctx.workspaceId }, include: { project: { select: { genre: true, bpm: true, artist: { select: { languages: true } } } }, lyric: true, masters: { orderBy: { createdAt: 'desc' }, take: 1 }, hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 } } })
    : ctx.projectId
    ? await prisma.song.findFirst({ where: { projectId: ctx.projectId }, orderBy: { createdAt: 'desc' }, include: { project: { select: { genre: true, bpm: true, artist: { select: { languages: true } } } }, lyric: true, masters: { orderBy: { createdAt: 'desc' }, take: 1 }, hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 } } })
    : null;
  if (!song) return { error: 'no_song' };
  const prediction = await arReadSong(ctx.app, ctx.workspaceId, song.id, toolKey(ctx, 'predict-hit'));
  if (!prediction) return { error: 'a&r_unavailable — add ANTHROPIC_API_KEY for the hit scout' };
  return { songId: song.id, ...prediction };
}

async function separateStemsTool(ctx: Ctx, songId: string | undefined, mode: 'instrumental' | 'full') {
  const assetIncludes = {
    masters: { orderBy: { createdAt: 'desc' as const }, take: 1 },
    mixes: { orderBy: { createdAt: 'desc' as const }, take: 1 },
    beats: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  };
  const song = songId
    ? await prisma.song.findFirst({ where: { id: songId, workspaceId: ctx.workspaceId }, include: assetIncludes })
    : ctx.projectId
    ? await prisma.song.findFirst({ where: { projectId: ctx.projectId }, orderBy: { createdAt: 'desc' }, include: assetIncludes })
    : null;
  if (!song) return { error: 'no_song' };
  const beat = song.beats[0];
  if (!beat) return { error: 'no_audio_to_separate' };
  // Separate what the user HEARS — freshest master → mix → beat (mirror of
  // routes/songs.ts freshestAudioUrl; the raw pre-vocal beat is the last resort).
  const cands = [song.masters[0], song.mixes[0], song.beats[0]].filter(Boolean) as Array<{ url: string; createdAt: Date }>;
  cands.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const sourceUrl = cands[0]?.url ?? beat.url;
  const idempotencyKey = toolKey(ctx, `stems-${mode}`);
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'beat_idea_short_30s', refTable: 'Song', refId: song.id, idempotencyKey });
  if (!charge.ok) return { error: 'insufficient_credits', ...charge };
  const job = await createQueuedProviderJob({
    app: ctx.app,
    queue: ctx.app.queues.music,
    jobName: 'stems',
    workspaceId: ctx.workspaceId,
    projectId: song.projectId,
    kind: 'stems',
    provider: 'replicate',
    inputJson: { songId: song.id, beatId: beat.id, mode, sourceUrl },
    charge,
    idempotencyKey,
    payload: (jobId) => ({ jobId, workspaceId: ctx.workspaceId, projectId: song.projectId, songId: song.id, beatId: beat.id, mode, sourceUrl }),
  });
  return { jobId: job.jobId, replayed: job.replayed, status: 'queued', mode, note: mode === 'instrumental' ? 'Making the true instrumental: the finished song with the voice taken out and everything else kept, loudness-matched to the original. It lands in the song download in a few minutes.' : 'Stems (vocals/drums/bass/other) will appear in the song download shortly.' };
}

/** Forge isolated loops (the material layer's raw stock) for a genre. */
async function forgeMaterialsTool(ctx: Ctx, a: { genre: string; bpm?: number; keySignature?: string }) {
  const bpm = Number(a.bpm ?? 108);
  const keySignature = a.keySignature ?? homeKeyFor(a.genre);
  const roles = kitRolesFor(a.genre);
  const jobs: Array<{ role: string; jobId: string }> = [];
  for (const [index, role] of roles.entries()) {
    const idempotencyKey = toolKey(ctx, `forge-${role}`);
    const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'beat_idea_short_30s', refTable: 'Project', refId: ctx.projectId ?? undefined, idempotencyKey });
    if (!charge.ok) return { error: 'insufficient_credits', forged: jobs };
    const job = await createQueuedProviderJob({
      app: ctx.app,
      queue: ctx.app.queues.music,
      jobName: 'forge-material',
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: 'material',
      provider: 'replicate',
      inputJson: { genre: a.genre, role, bpm, keySignature },
      charge,
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId: ctx.workspaceId, genre: a.genre, role, bpm, keySignature }),
      delayMs: index * 30_000,
    });
    jobs.push({ role, jobId: job.jobId });
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
  const sections = await claudeArrangement(a.genre, bpm, picks.map((p) => p.role), a.vibe);
  const idempotencyKey = toolKey(ctx, 'assemble-beat');
  const charge = await ctx.app.chargeCredits({ workspaceId: ctx.workspaceId, key: 'beat_idea_short_30s', refTable: 'Project', refId: ctx.projectId, idempotencyKey });
  if (!charge.ok) return { error: 'insufficient_credits' };
  const job = await createQueuedProviderJob({
    app: ctx.app,
    queue: ctx.app.queues.music,
    jobName: 'assemble-beat',
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    kind: 'music',
    provider: 'material',
    inputJson: { assemble: true, genre: a.genre, bpm, picks: picks.map((p) => p.role), sections },
    charge,
    idempotencyKey,
    payload: (jobId) => ({ jobId, workspaceId: ctx.workspaceId, projectId: ctx.projectId, bpm, genre: a.genre, picks, sections }),
  });
  return {
    jobId: job.jobId,
    replayed: job.replayed,
    status: 'queued',
    roles: picks.map((p) => p.role),
    arrangement: sections ? sections.map((s) => `${s.name}:${s.bars}bars[${s.roles.join('+')}]`) : 'classic template',
    note: 'Assembling the EXACT beat from real material — deterministic layers, real placement.',
  };
}

/** AI-AUTOMATIC material beat: forge the missing kit + assemble in one action. */
async function makeMaterialBeatTool(ctx: Ctx, a: { genre?: string; bpm?: number; vibe?: string; songId?: string }) {
  if (!ctx.projectId) return { error: 'no_project_in_thread' };
  const project = await prisma.project.findFirstOrThrow({ where: { id: ctx.projectId, workspaceId: ctx.workspaceId } });
  return autoMaterialBeat(ctx.app, ctx.workspaceId, {
    projectId: ctx.projectId,
    genre: a.genre ?? project.genre,
    bpm: a.bpm ?? project.bpm ?? undefined,
    vibe: a.vibe,
    songId: a.songId,
    operationKey: toolKey(ctx, 'auto-material'),
  });
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

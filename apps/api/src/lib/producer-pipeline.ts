/**
 * EXECUTIVE PRODUCER / ORCHESTRATOR — agent #1 of the multi-agent producer
 * studio (owner spec 2026-07-12). It does NOT write any component itself; it
 * runs the specialist agents as a STAGED pipeline over one shared, versioned
 * SONG_STATE, routes failures back to the responsible stage, and emits ONLY the
 * three legal verdicts — never "mastered", "release-ready", or "10/10".
 *
 * Stage 0  catalogue precheck   -> forbidden list (titles/vocab/hook-shapes)
 * Stage 1  creative brief       -> one artist, one moment, one premise, one mode
 * Stage 2  beat lab             -> Music Producer (groove behavior + arrangement)
 * Stage 3  topline (melody-first) -> Melody Brain composes; hook cell + rhythm map
 * Stage 4  lyric fitting        -> writer fits WORDS to the melody, QA-gated
 * Stage 5  language review      -> Language Agent (APPROVED/REWRITE/HUMAN_REVIEW)
 * Stage 6  vocal production     -> Vocal Producer (separated objects + rejection)
 * Stage 9  catalogue QA         -> A&R scorer (12 dims, fatal<7) + dup checks
 * Stage 10 decision             -> REJECT_AND_RESTART | REVISE_FROM_STAGE_X |
 *                                  CANDIDATE_FOR_HUMAN_AR
 *
 * HONESTY BOUNDARY: Stage 7 (beat re-arrangement around the lead) and Stage 8
 * (audio render + listening rounds, the sing-back test) need a controllable
 * singing engine that is NOT hosted yet. They are declared, not faked — the
 * pipeline stops at a text+composition CANDIDATE and hands to a human/audio pass.
 */
import { prisma } from '@afrohit/db';
import {
  produceBeatDna,
  reviewLanguage,
  produceVocal,
  scoreForAR,
  titleTooClose,
  generateJson,
  prompts,
} from '@afrohit/ai';
import {
  composeMelody,
  lyricQaCheck,
  normalizeLyricBody,
  pickLawfulTitle,
  newSongState,
  advanceState,
  rejectToStage,
  type SongState,
  type CreativeBrief,
  type LyricMode,
  type CatalogueSimilarity,
  type MelodyRhythmMap,
  type MelodyScore,
} from '@afrohit/shared';

const OVERUSED = ['shine', 'hustle', 'street', 'grind', 'gbedu', 'log', 'night', 'rise', 'throne', 'haters', 'vibe', 'fire'];

export interface ProducerPipelineInput {
  workspaceId: string;
  projectId: string;
  songId: string;
  /** Raw idea/theme from the create form. */
  theme: string;
  genre: string;
  bpm?: number;
  mood?: string;
  languages?: string[];
  fusion?: string[];
}

/** Stage 0 — the forbidden list, built from the workspace's real catalogue. */
async function cataloguePrecheck(workspaceId: string, genre: string): Promise<CatalogueSimilarity> {
  const rows = await prisma.song.findMany({
    where: { workspaceId, quarantined: false, lyric: { isNot: null } },
    select: { title: true, project: { select: { genre: true } }, lyric: { select: { body: true } } },
    take: 200,
    orderBy: { createdAt: 'desc' },
  });
  const titles = rows.map((r: { title: string }) => r.title).filter(Boolean);
  // Over-used vocab measured from the actual catalogue bodies (top offenders).
  const freq = new Map<string, number>();
  for (const r of rows as Array<{ lyric: { body: string } | null }>) {
    for (const w of normalizeLyricBody(r.lyric?.body ?? '').split(' ')) {
      if (w.length < 3) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const measuredOverused = [...freq.entries()].filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w);
  return {
    nearestTitles: titles.slice(0, 20),
    forbiddenStructures: ['Intro/Verse/Pre-Hook/Hook/Verse2/Bridge/Outro (the over-used catalogue template)'],
    forbiddenVocab: [...new Set([...OVERUSED, ...measuredOverused])],
    forbiddenHookShapes: ['a hook that is four full sentences repeated', 'a hook whose strongest line is in the verse'],
    note: `Checked against ${titles.length} live catalogue songs.`,
  };
}

const BRIEF_SYSTEM = `You are the EXECUTIVE PRODUCER of an Afro record studio. From a raw idea, define ONE record's creative identity. Do NOT write lyrics. Choose the lyric MODE honestly from the idea's mood — most dance/party records are "chant" or "image_collage", not "narrative".
Return STRICT JSON: {"primaryEmotion":"one sentence","listenerMoment":"club|headphones|wedding|worship|drive|dance challenge|street celebration|intimate room|...","artistIdentity":"age, attitude, vocal character, POV","corePremise":"ONE sentence","tension":"one contradiction OR empty","borrowedQualities":["3 market qualities to borrow, never copy"],"lyricMode":"chant|flirtation|image_collage|confession|snapshot|narrative|testimony|brag"}`;

const LYRIC_MODES: LyricMode[] = ['chant', 'flirtation', 'image_collage', 'confession', 'snapshot', 'narrative', 'testimony', 'brag'];

async function buildBrief(input: ProducerPipelineInput, sim: CatalogueSimilarity): Promise<CreativeBrief> {
  const bpm = input.bpm ?? 104;
  const raw = await generateJson<{
    primaryEmotion?: string; listenerMoment?: string; artistIdentity?: string;
    corePremise?: string; tension?: string; borrowedQualities?: string[]; lyricMode?: string;
  }>({
    tier: 'bulk',
    task: 'exec-producer-brief',
    system: BRIEF_SYSTEM,
    user: JSON.stringify({ idea: input.theme, genre: input.genre, mood: input.mood, bpm, forbidden: sim.forbiddenVocab.slice(0, 12) }),
    maxTokens: 700,
  });
  const mode = (LYRIC_MODES.includes(raw.lyricMode as LyricMode) ? raw.lyricMode : 'chant') as LyricMode;
  return {
    primaryEmotion: raw.primaryEmotion?.trim() || input.mood || 'confident',
    listenerMoment: raw.listenerMoment?.trim() || 'the floor',
    artistIdentity: raw.artistIdentity?.trim() || 'a Nigerian Afro-fusion artist',
    genre: input.genre,
    fusion: input.fusion,
    tempoRange: [bpm - 4, bpm + 4],
    corePremise: raw.corePremise?.trim() || input.theme.slice(0, 160),
    tension: raw.tension?.trim() || undefined,
    borrowedQualities: Array.isArray(raw.borrowedQualities) ? raw.borrowedQualities.slice(0, 3) : [],
    forbidden: sim.forbiddenVocab.slice(0, 8),
    lyricMode: mode,
  };
}

/** Stage 3 — derive the melody's rhythm map from the composed hook section. */
function melodyRhythmMap(score: MelodyScore): MelodyRhythmMap {
  const hook = score.sections.find((s) => /hook|chorus/i.test(s.name)) ?? score.sections[0];
  const notes = hook?.notes ?? [];
  const heldVowelSlots: number[] = [];
  const pickups: number[] = [];
  notes.forEach((n, i) => {
    if (n.durBeats >= 1.5) heldVowelSlots.push(i); // long notes want open vowels
    if (n.startBeat % 1 !== 0) pickups.push(i); // off-beat entries are pickups
  });
  // Breaths at section-phrase boundaries (every ~8 notes).
  const breaths: number[] = [];
  for (let i = 8; i < notes.length; i += 8) breaths.push(i);
  return { syllableSlots: notes.length, breaths, heldVowelSlots, pickups };
}

const FIT_SYSTEM = `${prompts.LYRIC_SYSTEM}

MELODY-FIRST MODE: a melody already exists. Do NOT make the melody serve your paragraph — make the WORDS serve the melody. You are given the hook cell (already the melody's spine), the syllable budget, the held-vowel slots (put open vowels there), and the breaths. Write the FEWEST words that sing this melody. The hook is the cell repeated. Obey THE RECORD LAW above.`;

/**
 * Run the full producer pipeline. Returns the final SONG_STATE with an honest
 * decision. NEVER mutates the song to MASTERED — a human/audio pass owns that.
 */
export async function runProducerPipeline(input: ProducerPipelineInput): Promise<SongState> {
  let state = newSongState(input.songId);

  // Stage 0 — catalogue precheck.
  const sim = await cataloguePrecheck(input.workspaceId, input.genre);
  state = advanceState(state, { catalogueSimilarity: sim }, { stage: 'catalogue_precheck', by: 'executive-producer', changed: 'forbidden list', why: sim.note });

  // Stage 1 — creative brief.
  const brief = await buildBrief(input, sim);
  state = advanceState(state, { brief }, { stage: 'creative_brief', by: 'executive-producer', changed: `mode=${brief.lyricMode}`, why: brief.primaryEmotion });

  // Stage 2 — beat lab (Music Producer).
  const { beatDna, arrangement } = await produceBeatDna({ brief, similarity: sim });
  state = advanceState(state, { beatDna, arrangementMap: arrangement }, { stage: 'beat_lab', by: 'music-producer', changed: 'BEAT_DNA + arrangement', why: beatDna.signatureEvent });

  // Stage 3 — topline (melody-first). Compose the melody over SCAT placeholders
  // (the words come after, at Stage 4), then derive the rhythm map. This is the
  // "hum before words" rule made concrete without a hosted singing engine.
  const scat = (n: number) => Array.from({ length: n }, () => 'la').join(' ');
  const score = composeMelody({
    genre: input.genre,
    bpm: beatDna.bpm,
    key: beatDna.key,
    seed: (input.songId.charCodeAt(0) || 7) + input.theme.length,
    sections: [
      { name: 'Hook', kind: 'hook', lines: [scat(6), scat(6)], contour: 'arch', density: 'sparse' },
      { name: 'Verse', kind: 'verse', lines: [scat(8), scat(8)], contour: 'wave', density: 'flowing' },
    ],
  });
  const mrm = melodyRhythmMap(score);
  const hookCell = brief.corePremise.split(/\s+/).slice(0, 3).join(' '); // provisional; the writer locks the real cell
  state = advanceState(state, {
    hookCandidates: [{ id: 'topline-1', contour: 'composed', noteRhythmMapId: String(score.seed), audioId: null, singbackScore: null }],
    selectedTopline: { candidateId: 'topline-1', hookCell, melodyRhythmMap: mrm, reason: 'Melody Brain composed; audio sing-back pending a hosted singing engine.' },
  }, { stage: 'topline', by: 'topline-composer', changed: `${mrm.syllableSlots} syllable slots`, why: 'melody-first; words fit the melody', testNext: 'audio sing-back when an engine is hosted' });

  // Stage 4 — lyric fitting (writer fits words to the melody), then QA gate.
  const fit = await generateJson<{ title?: string; body?: string; hookCell?: string; languageMix?: Record<string, number> }>({
    tier: 'judgment',
    task: 'lyric-fitting',
    system: FIT_SYSTEM,
    user: JSON.stringify({
      brief, primary_language: (input.languages ?? ['pcm'])[0], languages_allowed: input.languages ?? ['pcm', 'en'],
      hook_cell_spine: hookCell, syllable_budget: mrm.syllableSlots, held_vowel_slots: mrm.heldVowelSlots, breaths: mrm.breaths,
      forbidden_vocab: sim.forbiddenVocab, lyric_mode: brief.lyricMode,
    }),
    maxTokens: 2200,
  });
  const body = (fit.body ?? '').trim();
  const cell = (fit.hookCell ?? hookCell).trim();
  const title = pickLawfulTitle([fit.title ?? ''], cell || body);
  const catRows = await prisma.song.findMany({ where: { workspaceId: input.workspaceId, quarantined: false, lyric: { isNot: null }, NOT: { id: input.songId } }, select: { id: true, title: true, lyric: { select: { body: true } } }, take: 300 });
  const qa = lyricQaCheck({ title, body, hookCell: cell, languageMix: fit.languageMix, catalogue: catRows.map((s: { id: string; title: string; lyric: { body: string } | null }) => ({ id: s.id, title: s.title, bodyNorm: normalizeLyricBody(s.lyric?.body ?? '') })) });
  if (!qa.ok) {
    state = rejectToStage(state, 'lyric_fitting', `QA blocked: ${qa.blocks.join('; ')}`, 'catalogue-qa');
    return { ...advanceState(state, {}, { stage: 'lyric_fitting', by: 'songwriter', why: `blocked: ${qa.blocks.join('; ')}` }), decision: 'REJECT_AND_RESTART' };
  }
  state = advanceState(state, { sungWords: { sections: [{ name: 'draft', lines: body.split(/\r?\n/).filter(Boolean) }] } }, { stage: 'lyric_fitting', by: 'songwriter', changed: `title="${title}", ${qa.wordCount} words`, why: `mode=${brief.lyricMode}`, testNext: qa.warnings.join('; ') || undefined });

  // Stage 5 — language review.
  const lang = await reviewLanguage({ lyricBody: body, languages: input.languages ?? ['pcm', 'en'], hasMelody: true });
  state = advanceState(state, { languageReview: lang.entries }, { stage: 'language_review', by: 'language-agent', changed: `${lang.entries.length} phrases`, why: lang.blocksRelease ? 'HUMAN_NATIVE_REVIEW_REQUIRED on a tone-language phrase' : 'clear' });

  // Stage 6 — vocal production (separated objects + rejection authority).
  const vp = await produceVocal({ sungLyric: body, hookCell: cell, melodyRhythmMap: mrm, languages: input.languages });
  if (vp.rejected) {
    state = rejectToStage(state, 'vocal_production', vp.rejectReasons.join('; '), 'vocal-producer');
    return { ...advanceState(state, { adlibOptions: vp.adlibOptions, leadPerformanceMap: vp.leadPerformanceMap }, { stage: 'vocal_production', by: 'vocal-producer', why: vp.rejectReasons.join('; ') }), decision: 'REVISE_FROM_STAGE_X' };
  }
  state = advanceState(state, {
    sungWords: vp.sungWords, adlibOptions: vp.adlibOptions, leadPerformanceMap: vp.leadPerformanceMap,
    doublesHarmonies: vp.doublesHarmonies, productionNotes: vp.productionNotes,
  }, { stage: 'vocal_production', by: 'vocal-producer', changed: 'sung form + performance map', why: 'lead comped, ad-libs selective' });

  // Stage 9 — catalogue QA (A&R scorer + originality).
  const clash = titleTooClose(title, sim.nearestTitles);
  const ar = await scoreForAR({ title, sungLyric: body, hookCell: cell, genre: input.genre, languages: input.languages });
  let decision = ar.verdict;
  if (clash) decision = 'REVISE_FROM_STAGE_X';
  if (lang.blocksRelease && decision === 'CANDIDATE_FOR_HUMAN_AR') {
    // A tone-language song can still be a candidate, but flagged for the native pass.
    decision = 'CANDIDATE_FOR_HUMAN_AR';
  }
  state = advanceState(state, { qaScores: ar.scores }, { stage: 'catalogue_qa', by: 'ar-scorer', changed: `verdict=${decision}`, why: clash ? `title too close to "${clash}"` : ar.note, testNext: ar.failedDimensions.join(', ') || undefined });

  // Stage 10 — decision. NEVER "mastered".
  state = advanceState(state, { decision }, { stage: 'decision', by: 'executive-producer', changed: decision, why: 'audio render + human A&R own the final call — no AI "mastered"' });
  return state;
}

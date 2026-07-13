/**
 * PRODUCE — the multi-agent producer pipeline, run in the WORKER because it must
 * RENDER audio (the topline proof) before the songwriter is allowed to write.
 *
 * Owner feedback (2026-07-13): "a written description of a melody does not count
 * — require actual audio artifacts." So this processor composes the melody, then
 * RENDERS a playable arrangement sketch + >=3 hook melody renders (ffmpeg, local,
 * free), and only when those audio files exist does it unblock the songwriter.
 *
 * HONESTY (stated in the SONG_STATE + here): the renders are SYNTHESIZED melody
 * GUIDES (the composed notes as tone), NOT a voice singing a hum — no hosted
 * engine sings a hum yet. The melody is proven AUDIBLY; the timbre is not.
 */
import { prisma } from '@afrohit/db';
import {
  produceBeatDna, reviewLanguage, produceVocal, scoreForAR, titleTooClose,
  generateJson, prompts,
} from '@afrohit/ai';
import {
  composeMelody, lyricQaCheck, normalizeLyricBody, pickLawfulTitle,
  newSongState, advanceState, rejectToStage, toplineProven,
  type SongState, type CreativeBrief, type LyricMode, type CatalogueSimilarity,
  type MelodyRhythmMap, type MelodyScore, type ToplineProof, type LyricQaResult,
} from '@afrohit/shared';
import { renderMelodyGuide } from '../lib/melody-guide';
import { uploadBytes } from '../lib/storage';
import { markRunning, markSucceeded, markFailed } from '../lib/jobs';

interface ProducePayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  theme: string;
  genre: string;
  bpm?: number;
  mood?: string;
  languages?: string[];
  fusion?: string[];
}

const OVERUSED = ['shine', 'hustle', 'street', 'grind', 'gbedu', 'log', 'night', 'rise', 'throne', 'haters', 'vibe', 'fire'];
const LYRIC_MODES: LyricMode[] = ['chant', 'flirtation', 'image_collage', 'confession', 'snapshot', 'narrative', 'testimony', 'brag'];

const BRIEF_SYSTEM = `You are the EXECUTIVE PRODUCER of an Afro record studio. From a raw idea, define ONE record's creative identity. Do NOT write lyrics. Choose the lyric MODE honestly — most dance/party records are "chant" or "image_collage", not "narrative".
Return STRICT JSON: {"primaryEmotion":"one sentence","listenerMoment":"club|drive|street celebration|intimate room|...","artistIdentity":"age, attitude, vocal character, POV","corePremise":"ONE sentence","tension":"one contradiction OR empty","borrowedQualities":["3 market qualities to borrow, never copy"],"lyricMode":"chant|flirtation|image_collage|confession|snapshot|narrative|testimony|brag"}`;

async function cataloguePrecheck(workspaceId: string): Promise<CatalogueSimilarity> {
  const rows = await prisma.song.findMany({
    where: { workspaceId, quarantined: false, lyric: { isNot: null } },
    select: { title: true, lyric: { select: { body: true } } },
    take: 200, orderBy: { createdAt: 'desc' },
  });
  const titles = rows.map((r: { title: string }) => r.title).filter(Boolean);
  const freq = new Map<string, number>();
  for (const r of rows as Array<{ lyric: { body: string } | null }>) {
    for (const w of normalizeLyricBody(r.lyric?.body ?? '').split(' ')) { if (w.length >= 3) freq.set(w, (freq.get(w) ?? 0) + 1); }
  }
  const measured = [...freq.entries()].filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w);
  return {
    nearestTitles: titles.slice(0, 20),
    forbiddenStructures: ['Intro/Verse/Pre-Hook/Hook/Verse2/Bridge/Outro (over-used template)'],
    forbiddenVocab: [...new Set([...OVERUSED, ...measured])],
    forbiddenHookShapes: ['a hook that is four full sentences repeated', 'a hook made only of setting words'],
    note: `Checked against ${titles.length} live catalogue songs.`,
  };
}

async function buildBrief(p: ProducePayload, sim: CatalogueSimilarity): Promise<CreativeBrief> {
  const bpm = p.bpm ?? 104;
  const raw = await generateJson<{ primaryEmotion?: string; listenerMoment?: string; artistIdentity?: string; corePremise?: string; tension?: string; borrowedQualities?: string[]; lyricMode?: string }>({
    tier: 'bulk', task: 'exec-producer-brief', system: BRIEF_SYSTEM,
    user: JSON.stringify({ idea: p.theme, genre: p.genre, mood: p.mood, bpm, forbidden: sim.forbiddenVocab.slice(0, 12) }), maxTokens: 700,
  }).catch(() => ({} as Record<string, never>));
  const mode = (LYRIC_MODES.includes(raw.lyricMode as LyricMode) ? raw.lyricMode : 'chant') as LyricMode;
  return {
    primaryEmotion: raw.primaryEmotion?.trim() || p.mood || 'confident',
    listenerMoment: raw.listenerMoment?.trim() || 'the floor',
    artistIdentity: raw.artistIdentity?.trim() || 'a Nigerian Afro-fusion artist',
    genre: p.genre, fusion: p.fusion, tempoRange: [bpm - 4, bpm + 4],
    corePremise: raw.corePremise?.trim() || p.theme.slice(0, 160),
    tension: raw.tension?.trim() || undefined,
    borrowedQualities: Array.isArray(raw.borrowedQualities) ? raw.borrowedQualities.slice(0, 3) : [],
    forbidden: sim.forbiddenVocab.slice(0, 8), lyricMode: mode,
  };
}

function melodyRhythmMap(score: MelodyScore): MelodyRhythmMap {
  const hook = score.sections.find((s) => /hook|chorus/i.test(s.name)) ?? score.sections[0];
  const notes = hook?.notes ?? [];
  const heldVowelSlots: number[] = []; const pickups: number[] = [];
  notes.forEach((n, i) => { if (n.durBeats >= 1.5) heldVowelSlots.push(i); if (n.startBeat % 1 !== 0) pickups.push(i); });
  const breaths: number[] = []; for (let i = 8; i < notes.length; i += 8) breaths.push(i);
  return { syllableSlots: notes.length, breaths, heldVowelSlots, pickups };
}

const scat = (n: number) => Array.from({ length: n }, () => 'la').join(' ');
function hookScore(genre: string, bpm: number, key: string, seed: number): MelodyScore {
  return composeMelody({ genre, bpm, key, seed, sections: [{ name: 'Hook', kind: 'hook', lines: [scat(6), scat(6)], contour: 'arch', density: 'sparse' }] });
}

const FIT_SYSTEM = `${prompts.LYRIC_SYSTEM}

MELODY-FIRST MODE: a melody already exists and has been rendered to audio. Do NOT make the melody serve your paragraph — make the WORDS serve the melody. You are given the hook cell (the melody's spine), the syllable budget, held-vowel slots, and breaths. Write the FEWEST words that sing this melody. The hook is the cell repeated. Do NOT open on a location, do NOT stuff a place/food/transport noun into most lines, no confession bridge, no explaining outro. Obey THE RECORD LAW above.`;

export async function processProduce(p: ProducePayload): Promise<void> {
  await markRunning(p.jobId);
  try {
    let state: SongState = newSongState(p.songId);

    // Stage 0-1.
    const sim = await cataloguePrecheck(p.workspaceId);
    state = advanceState(state, { catalogueSimilarity: sim }, { stage: 'catalogue_precheck', by: 'executive-producer', changed: 'forbidden list', why: sim.note });
    const brief = await buildBrief(p, sim);
    state = advanceState(state, { brief }, { stage: 'creative_brief', by: 'executive-producer', changed: `mode=${brief.lyricMode}`, why: brief.primaryEmotion });

    // Stage 2 — Music Producer.
    const { beatDna, arrangement } = await produceBeatDna({ brief, similarity: sim });
    state = advanceState(state, { beatDna, arrangementMap: arrangement }, { stage: 'beat_lab', by: 'music-producer', changed: 'BEAT_DNA', why: beatDna.signatureEvent });

    // Stage 3 — TOPLINE, melody-first, then RENDER the audio proof.
    const seed = (p.songId.charCodeAt(0) || 7) + p.theme.length;
    const fullScore = composeMelody({
      genre: p.genre, bpm: beatDna.bpm, key: beatDna.key, seed,
      sections: [
        { name: 'Hook', kind: 'hook', lines: [scat(6), scat(6)], contour: 'arch', density: 'sparse' },
        { name: 'Verse', kind: 'verse', lines: [scat(8), scat(8)], contour: 'wave', density: 'flowing' },
      ],
    });
    const mrm = melodyRhythmMap(fullScore);

    // RENDER: the arrangement sketch + 3 distinct hook melody renders (ffmpeg,
    // local, free). If rendering fails, the topline is NOT proven -> block.
    let proof: ToplineProof = { beatSketchUrl: null, hookRenderUrls: [], selectedContour: 'arch', syllableCap: mrm.syllableSlots, breathSlots: mrm.breaths };
    try {
      const sketchBytes = await renderMelodyGuide(fullScore);
      const beatSketchUrl = await uploadBytes({ workspaceId: p.workspaceId, kind: 'beats', bytes: sketchBytes, contentType: 'audio/wav', ext: 'wav' });
      const hookUrls: string[] = [];
      for (const s of [seed + 1, seed + 2, seed + 3]) {
        const bytes = await renderMelodyGuide(hookScore(p.genre, beatDna.bpm, beatDna.key, s));
        hookUrls.push(await uploadBytes({ workspaceId: p.workspaceId, kind: 'beats', bytes, contentType: 'audio/wav', ext: 'wav' }));
      }
      proof = { beatSketchUrl, hookRenderUrls: hookUrls, selectedContour: 'arch', syllableCap: mrm.syllableSlots, breathSlots: mrm.breaths };
    } catch (e) {
      state = advanceState(state, { toplineProof: proof }, { stage: 'topline', by: 'topline-composer', why: `topline render failed: ${(e as Error).message.slice(0, 120)}` });
    }
    const hookCell = brief.corePremise.split(/\s+/).slice(0, 3).join(' ');
    state = advanceState(state, {
      toplineProof: proof,
      selectedTopline: { candidateId: 'topline-1', hookCell, melodyRhythmMap: mrm, reason: 'Melody Brain composed; hook melody rendered to audio guides.' },
    }, { stage: 'topline', by: 'topline-composer', changed: `${proof.hookRenderUrls.length} hook renders + ${proof.beatSketchUrl ? 'sketch' : 'no sketch'}`, why: 'melody-first, proven audibly (synthesized guide, not a sung hum)' });

    // TOPLINE GATE — block the songwriter unless the topline is audibly proven.
    if (!toplineProven(proof)) {
      state = advanceState(state, { decision: 'TOPLINE_NOT_PROVEN' }, { stage: 'topline', by: 'executive-producer', why: 'audio artifacts missing — songwriter blocked' });
      await prisma.song.update({ where: { id: p.songId }, data: { quarantined: true, quarantineReason: 'TOPLINE_NOT_PROVEN', proofPack: state as never } }).catch(() => {});
      await markSucceeded(p.jobId, { decision: 'TOPLINE_NOT_PROVEN', songId: p.songId }, 0.02);
      return;
    }

    // Stage 4 — lyric fitting (words fit the melody), QA gate + corrective loop.
    const catRows = await prisma.song.findMany({ where: { workspaceId: p.workspaceId, quarantined: false, lyric: { isNot: null }, NOT: { id: p.songId } }, select: { id: true, title: true, lyric: { select: { body: true } } }, take: 300 });
    const catalogue = catRows.map((s: { id: string; title: string; lyric: { body: string } | null }) => ({ id: s.id, title: s.title, bodyNorm: normalizeLyricBody(s.lyric?.body ?? '') }));
    let body = ''; let cell = hookCell; let title = ''; let langMix: Record<string, number> | undefined;
    let qa: LyricQaResult = { ok: false, blocks: ['not-generated'], warnings: [], band: 'F', bodyNorm: '', wordCount: 0 };
    for (let attempt = 0; attempt < 3 && !qa.ok; attempt++) {
      const fit = await generateJson<{ title?: string; body?: string; hookCell?: string; languageMix?: Record<string, number> }>({
        tier: 'judgment', task: 'lyric-fitting', system: FIT_SYSTEM,
        user: JSON.stringify({
          brief, primary_language: (p.languages ?? ['pcm'])[0], languages_allowed: p.languages ?? ['pcm', 'en'],
          hook_cell_spine: cell, syllable_budget: mrm.syllableSlots, held_vowel_slots: mrm.heldVowelSlots, breaths: mrm.breaths,
          forbidden_vocab: sim.forbiddenVocab, lyric_mode: brief.lyricMode,
          ...(attempt > 0 ? { FIX_THESE_QA_FAILURES: qa.blocks } : {}),
        }), maxTokens: 2200,
      }).catch(() => null);
      if (!fit?.body || fit.body.trim().length < 20) continue;
      body = fit.body.trim();
      cell = (fit.hookCell ?? cell).trim();
      title = pickLawfulTitle([fit.title ?? ''], cell || body);
      langMix = fit.languageMix;
      qa = lyricQaCheck({ title, body, hookCell: cell, languageMix: langMix, catalogue });
    }
    if (!qa.ok) {
      state = rejectToStage(state, 'lyric_fitting', `QA blocked after retries: ${qa.blocks.join('; ')}`, 'catalogue-qa');
      state = advanceState(state, { decision: 'REJECT_AND_RESTART' }, { stage: 'lyric_fitting', by: 'songwriter', why: qa.blocks.join('; ') });
      await prisma.song.update({ where: { id: p.songId }, data: { title: title || 'Rejected', quarantined: true, quarantineReason: `REJECT_AND_RESTART: ${qa.blocks.join('; ')}`, proofPack: state as never } }).catch(() => {});
      await markSucceeded(p.jobId, { decision: 'REJECT_AND_RESTART', songId: p.songId, blocks: qa.blocks }, 0.05);
      return;
    }
    state = advanceState(state, { sungWords: { sections: [{ name: 'draft', lines: body.split(/\r?\n/).filter(Boolean) }] } }, { stage: 'lyric_fitting', by: 'songwriter', changed: `"${title}", ${qa.wordCount} words`, why: `mode=${brief.lyricMode}`, testNext: qa.warnings.join('; ') || undefined });

    // Stage 5-6 — Language + Vocal Producer.
    const lang = await reviewLanguage({ lyricBody: body, languages: p.languages ?? ['pcm', 'en'], hasMelody: true }).catch(() => ({ entries: [], blocksRelease: false }));
    state = advanceState(state, { languageReview: lang.entries }, { stage: 'language_review', by: 'language-agent', changed: `${lang.entries.length} phrases`, why: lang.blocksRelease ? 'HUMAN_NATIVE_REVIEW_REQUIRED' : 'clear' });
    const vp = await produceVocal({ sungLyric: body, hookCell: cell, melodyRhythmMap: mrm, languages: p.languages }).catch(() => null);
    if (vp?.rejected) {
      state = rejectToStage(state, 'vocal_production', vp.rejectReasons.join('; '), 'vocal-producer');
      state = advanceState(state, { adlibOptions: vp.adlibOptions, decision: 'REVISE_FROM_STAGE_X' }, { stage: 'vocal_production', by: 'vocal-producer', why: vp.rejectReasons.join('; ') });
    } else if (vp) {
      state = advanceState(state, { sungWords: vp.sungWords, adlibOptions: vp.adlibOptions, leadPerformanceMap: vp.leadPerformanceMap, doublesHarmonies: vp.doublesHarmonies, productionNotes: vp.productionNotes }, { stage: 'vocal_production', by: 'vocal-producer', changed: 'sung form + performance map', why: 'lead comped, ad-libs selective' });
    }

    // Stage 9-10 — A&R + decision.
    const clash = titleTooClose(title, sim.nearestTitles);
    const ar = await scoreForAR({ title, sungLyric: body, hookCell: cell, genre: p.genre, languages: p.languages }).catch(() => null);
    let decision: SongState['decision'] = ar?.verdict ?? 'CANDIDATE_FOR_HUMAN_AR';
    if (state.decision === 'REVISE_FROM_STAGE_X') decision = 'REVISE_FROM_STAGE_X';
    if (clash) decision = 'REVISE_FROM_STAGE_X';
    state = advanceState(state, { qaScores: ar?.scores, decision }, { stage: 'decision', by: 'executive-producer', changed: decision, why: clash ? `title too close to "${clash}"` : (ar?.note ?? 'scored'), testNext: 'audio render + human A&R own the final call — no AI "mastered"' });

    // Persist. CANDIDATE => a renderable DEMO; anything else => quarantined shell.
    const sung = (state.sungWords?.sections.flatMap((s) => s.lines).join('\n')) || body;
    if (decision === 'CANDIDATE_FOR_HUMAN_AR') {
      const lyric = await prisma.lyricDraft.create({ data: { projectId: p.projectId, songId: p.songId, title, body: sung, approved: false } });
      await prisma.song.update({ where: { id: p.songId }, data: { title, lyricId: lyric.id, status: 'DEMO', proofPack: state as never } });
    } else {
      await prisma.song.update({ where: { id: p.songId }, data: { title: title || 'Revise', quarantined: true, quarantineReason: `pipeline: ${decision}`, proofPack: state as never } });
    }
    await markSucceeded(p.jobId, { decision, songId: p.songId, title, toplineProven: true, hookRenders: proof.hookRenderUrls.length }, 0.12);
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}

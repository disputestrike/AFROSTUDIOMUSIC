/**
 * HIT CONCEPT & ARTIST IDENTITY DIRECTOR — agent #0 of the studio (owner
 * directive 2026-07-13). It runs BEFORE the Music Producer and is the upstream
 * fix for the danfo / pepper-soup / "gbe body" disease: those songs failed not
 * at the lyricist but at CONCEPTION — they started from a Nigerian object instead
 * of a human feeling. This gate refuses to let a scenery-first premise enter
 * production.
 *
 * It takes the raw idea, re-expresses it as ONE human engine (an emotion/desire/
 * conflict/attitude with NO props), yields a compact emotional title + hook cell,
 * runs the OBJECT-REMOVAL TEST in code, scores it, and returns approved:false when
 * the concept is scenery-dependent or emotionally weak. Cost law: tier:'bulk'
 * (Cerebras) — concept selection is analysis-class.
 */
import type { LyricMode } from '@afrohit/shared';
import {
  CONCEPT_LAW_BRIEF, POSITIVE_CONCEPT_EXEMPLARS, NEGATIVE_CONCEPT_EXEMPLARS,
  HUMAN_ENGINES, conceptSceneryDependent,
} from '@afrohit/shared';
import { generateJson } from '../generate';

export interface ConceptResult {
  approved: boolean;
  reason: string;
  humanEngine: string; // one sentence, NO scenery
  artistIdentity: string;
  title: string; // compact emotional phrase
  hookCell: string; // the chantable spine
  lyricMode: LyricMode;
  scores: { emotionalPower: number; artistIdentity: number; hookPotential: number };
}

const LYRIC_MODES: LyricMode[] = ['chant', 'flirtation', 'image_collage', 'confession', 'snapshot', 'narrative', 'testimony', 'brag'];

const SYSTEM = [
  'You are the HIT CONCEPT & ARTIST IDENTITY DIRECTOR — the first gate in an Afro record studio.',
  'Your ONLY job: turn a raw idea into ONE emotion-first concept, or reject it.',
  '',
  CONCEPT_LAW_BRIEF,
  '',
  'EMOTION-FIRST EXEMPLARS (study the pattern — a feeling yields a compact chantable title; NONE need a prop):',
  ...POSITIVE_CONCEPT_EXEMPLARS.slice(0, 24).map((e) => `- "${e.title}": ${e.engine}`),
  '',
  'NEGATIVE EXEMPLARS (never do this):',
  ...NEGATIVE_CONCEPT_EXEMPLARS.map((e) => `- ${e.title}: ${e.why}`),
  '',
  `Human engines to choose from: ${HUMAN_ENGINES.join(', ')}.`,
  '',
  'Given the raw idea, find the HUMAN FEELING underneath it and build the concept from THAT — strip the props. If the idea is ONLY scenery with no extractable feeling, still return your best emotion-first reinterpretation but score emotionalPower low.',
  'Return STRICT JSON: {"humanEngine":"one sentence, no props/places/foods/artist names","artistIdentity":"age, attitude, vocal character, POV","title":"1-4 word emotional phrase, open vowels, chantable","hookCell":"the 1-4 word chantable spine (usually = title)","lyricMode":"chant|flirtation|image_collage|confession|snapshot|narrative|testimony|brag","scores":{"emotionalPower":0-10,"artistIdentity":0-10,"hookPotential":0-10}}',
].join('\n');

/**
 * Generate + gate a concept. approved=false (REJECT_CONCEPT_SCENERY_DEPENDENT)
 * when the returned concept fails the object-removal test OR any fatal score
 * (emotionalPower / hookPotential / artistIdentity) is below 8.
 */
export async function directConcept(opts: { idea: string; genre: string; mood?: string }): Promise<ConceptResult> {
  const raw = await generateJson<{
    humanEngine?: string; artistIdentity?: string; title?: string; hookCell?: string; lyricMode?: string;
    scores?: { emotionalPower?: number; artistIdentity?: number; hookPotential?: number };
  }>({
    tier: 'bulk',
    task: 'concept-director',
    system: SYSTEM,
    user: JSON.stringify({ raw_idea: opts.idea, genre: opts.genre, mood: opts.mood }),
    maxTokens: 600,
  }).catch(() => ({} as Record<string, never>));

  const humanEngine = (raw.humanEngine ?? '').trim();
  const title = (raw.title ?? '').trim().replace(/^["']|["']$/g, '');
  const hookCell = (raw.hookCell ?? title).trim().replace(/^["']|["']$/g, '');
  const mode = (LYRIC_MODES.includes(raw.lyricMode as LyricMode) ? raw.lyricMode : 'chant') as LyricMode;
  const scores = {
    emotionalPower: Number(raw.scores?.emotionalPower ?? 0),
    artistIdentity: Number(raw.scores?.artistIdentity ?? 0),
    hookPotential: Number(raw.scores?.hookPotential ?? 0),
  };

  // OBJECT-REMOVAL TEST (code, the final word): does the concept survive stripped
  // of props? Run it on the human engine AND the title.
  const sceneryDependent = conceptSceneryDependent(`${humanEngine} ${title}`);
  const fatalLow = scores.emotionalPower < 8 || scores.hookPotential < 8 || scores.artistIdentity < 8;

  let reason = 'concept passes: emotion-first, survives the object-removal test.';
  let approved = true;
  if (!humanEngine || !title) { approved = false; reason = 'concept incomplete — no human engine or title produced.'; }
  else if (sceneryDependent) { approved = false; reason = 'REJECT_CONCEPT_SCENERY_DEPENDENT: the concept is built from props/places, not a feeling — it dies when the scenery is removed.'; }
  else if (fatalLow) { approved = false; reason = `weak concept: emotionalPower ${scores.emotionalPower}, hookPotential ${scores.hookPotential}, artistIdentity ${scores.artistIdentity} — a fatal dimension is below 8.`; }

  return {
    approved, reason,
    humanEngine: humanEngine || opts.idea.slice(0, 140),
    artistIdentity: (raw.artistIdentity ?? 'a Nigerian Afro-fusion artist').trim(),
    title: title || 'Untitled', hookCell: hookCell || title || 'Untitled', lyricMode: mode, scores,
  };
}

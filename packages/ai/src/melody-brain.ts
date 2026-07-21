/**
 * Melody Brain — the TASTE layer over the composed melody (Own Singer piece 3).
 *
 * Division of labor is the whole point: composeMelody in @afrohit/shared is
 * the MUSIC-THEORY engine that emits every note (deterministic, validated,
 * testable); this brain only asks the LLM for phrasing PARAMETERS per section
 * — contour shape, density, a starting degree, an optional motif pitch-class.
 * The model never writes a note. Every parameter is validated HARD against a
 * closed vocabulary and clamped ranges; anything off-shape (or any transport
 * failure) falls back to the pure composer with the same seed, so the melody
 * is ALWAYS composed and always deterministic — taste is a garnish, never a
 * dependency. Cost law: 'bulk' tier (Cerebras-first, laddering up), task
 * 'melody-phrasing' for the economics log.
 */
import {
  composeMelody,
  type ComposeMelodyOpts,
  type MelodyContour,
  type MelodyDensity,
  type MelodyScore,
  type MelodySectionInput,
} from '@afrohit/shared';
import { generateJson } from './generate';
import { runWithBrainContext } from './brain-context';

const CONTOURS: ReadonlySet<string> = new Set(['rise', 'fall', 'arch', 'wave']);
const DENSITIES: ReadonlySet<string> = new Set(['sparse', 'flowing', 'dense']);
const MOTIF_RX = /^[A-Ga-g][#b]?$/;

interface PhrasingSection {
  contourShape: MelodyContour;
  densityHint: MelodyDensity;
  startDegree: number;
  motifNote?: string;
}

const MELODY_BRAIN_SYSTEM = `You are the Melody Brain's taste layer. The studio's own music-theory engine composes every note — you NEVER write notes, pitches, rhythms or MIDI. You only choose phrasing parameters per section, and the engine turns them into a melody that obeys the lane's laws (scale, tessitura, prosody, hook cell, singability).

For EACH section, in the order given, pick:
- "contourShape": one of "rise" | "fall" | "arch" | "wave" — the phrase arc. Verses usually fall home, pre-hooks rise, hooks arch, bridges wave.
- "densityHint": one of "sparse" | "flowing" | "dense" — syllable-flow feel for the lane and tempo.
- "startDegree": integer 1-8 — the scale degree the section's first note aims for (1 = tonic, 8 = tonic an octave up). Verses low (1-3), hooks higher (3-5), bridges off-home (4 or 6).
- "motifNote": OPTIONAL pitch-class letter for the hook's opening note, e.g. "F#" — only when you have a strong reason; it must belong to the key or it is ignored.

Return ONLY JSON: {"sections":[{"contourShape":"...","densityHint":"...","startDegree":n,"motifNote":"..."}]} — exactly one entry per section, same order, no extra keys, no prose.`;

/**
 * Compose a melody with LLM-chosen phrasing. Any failure — transport, parse,
 * wrong length, off-vocabulary value — degrades gracefully to the pure
 * composer with the same seed: deterministic notes either way.
 */
export async function melodyBrain(opts: ComposeMelodyOpts): Promise<MelodyScore> {
  let phrasing: PhrasingSection[] | null = null;
  try {
    // COST LAW — close the paid-brain leak (songspeed audit): this taste-garnish
    // is 'bulk' tier, but tier alone still lets generate.ts LADDER up to Claude on
    // any Cerebras hiccup/misconfig. Wrap in forceTier:'bulk' (EXACTLY like
    // producer-brain.ts) so a failed bulk call tops out at the OpenAI draft and
    // NEVER bills Sonnet — a phrasing garnish must never silently spend taste
    // money. The wrap is scoped to THIS call only (AsyncLocalStorage), so it can
    // never leak into produce's intentional judgment lyric-fitting call.
    const out = await runWithBrainContext({ forceTier: 'bulk' }, () =>
      generateJson<{ sections: PhrasingSection[] }>({
        tier: 'bulk',
        task: 'melody-phrasing',
        system: MELODY_BRAIN_SYSTEM,
        user: [
          `GENRE: ${opts.genre}`,
          `BPM: ${opts.bpm}`,
          `KEY: ${opts.key}`,
          `SECTIONS (choose parameters for each, in order):`,
          ...opts.sections.map(
            (s, i) =>
              `${i + 1}. [${s.kind}] "${s.name}" — ${s.lines.length} line(s); first line: "${s.lines[0] ?? ''}"${s.anchors?.length ? `; anchors: ${s.anchors.join(', ')}` : ''}`
          ),
        ].join('\n'),
        temperature: 0.6,
        maxTokens: 1200,
      })
    );
    // HARD validation — closed vocabulary, exact length, integer ranges. One
    // bad field voids the WHOLE phrasing (never mix trusted and untrusted).
    const secs = out?.sections;
    if (Array.isArray(secs) && secs.length === opts.sections.length) {
      const clean: PhrasingSection[] = [];
      for (const s of secs) {
        if (!s || typeof s !== 'object') break;
        if (!CONTOURS.has(s.contourShape as string)) break;
        if (!DENSITIES.has(s.densityHint as string)) break;
        if (!Number.isInteger(s.startDegree) || s.startDegree < 1 || s.startDegree > 8) break;
        if (s.motifNote !== undefined && (typeof s.motifNote !== 'string' || !MOTIF_RX.test(s.motifNote))) break;
        clean.push({
          contourShape: s.contourShape,
          densityHint: s.densityHint,
          startDegree: s.startDegree,
          ...(s.motifNote ? { motifNote: s.motifNote } : {}),
        });
      }
      if (clean.length === opts.sections.length) phrasing = clean;
      else console.warn('[melody-brain] phrasing failed hard validation — pure composer takes the take');
    } else {
      console.warn('[melody-brain] phrasing wrong shape/length — pure composer takes the take');
    }
  } catch (err) {
    console.warn(`[melody-brain] taste layer unavailable (${(err as Error)?.message?.slice(0, 100)}) — pure composer takes the take`);
  }

  if (!phrasing) return composeMelody(opts); // graceful + deterministic — the seed decides
  const sections: MelodySectionInput[] = opts.sections.map((s, i) => ({
    ...s,
    contour: phrasing![i]!.contourShape,
    density: phrasing![i]!.densityHint,
    startDegree: phrasing![i]!.startDegree,
    ...(phrasing![i]!.motifNote ? { motifNote: phrasing![i]!.motifNote } : {}),
  }));
  return composeMelody({ ...opts, sections });
}

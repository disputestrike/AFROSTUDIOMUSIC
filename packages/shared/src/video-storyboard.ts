import { CREDIT_COSTS, type CreditKey } from "./credits";
import {
  DEFAULT_VIDEO_ENGINE_CLASS,
  type VideoEngineClass,
} from "./likeness";

export interface NormalizedStoryboardShot {
  index: number;
  prompt: string;
  duration_s: number;
  motion?: string;
  lighting?: string;
  subjects?: string[];
  negativePrompt?: string;
}

const PROVIDER_DURATIONS = [4, 8, 12] as const;
const MAX_SHOTS = 15;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

function providerDuration(value: unknown): number {
  const parsed = Number(value);
  const requested = Number.isFinite(parsed)
    ? Math.max(1, Math.min(12, Math.round(parsed)))
    : 4;
  return (
    PROVIDER_DURATIONS.find(duration => duration >= requested) ??
    PROVIDER_DURATIONS[PROVIDER_DURATIONS.length - 1]!
  );
}

/**
 * Treat model-authored storyboard JSON as untrusted. The normalized plan has a
 * finite shot count and provider-supported durations that never exceed the
 * duration the user approved.
 */
export function normalizeStoryboardShots(
  value: unknown,
  targetDurationS: number
): NormalizedStoryboardShot[] {
  if (!Array.isArray(value)) return [];
  const target = Math.max(8, Math.min(60, Math.floor(targetDurationS)));
  let remaining = target;
  const shots: NormalizedStoryboardShot[] = [];

  for (const item of value.slice(0, MAX_SHOTS)) {
    if (remaining < PROVIDER_DURATIONS[0]) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const prompt = cleanText(row.prompt, 2_000);
    if (!prompt) continue;

    const requested = providerDuration(row.duration_s);
    const duration =
      [...PROVIDER_DURATIONS]
        .reverse()
        .find(candidate => candidate <= requested && candidate <= remaining) ??
      PROVIDER_DURATIONS.find(candidate => candidate <= remaining);
    if (!duration) break;

    const subjects = Array.isArray(row.subjects)
      ? row.subjects
          .map(subject => cleanText(subject, 120))
          .filter((subject): subject is string => Boolean(subject))
          .slice(0, 8)
      : undefined;
    shots.push({
      index: shots.length,
      prompt,
      duration_s: duration,
      ...(cleanText(row.motion, 300)
        ? { motion: cleanText(row.motion, 300) }
        : {}),
      ...(cleanText(row.lighting, 300)
        ? { lighting: cleanText(row.lighting, 300) }
        : {}),
      ...(subjects?.length ? { subjects } : {}),
      ...(cleanText(row.negativePrompt, 500)
        ? { negativePrompt: cleanText(row.negativePrompt, 500) }
        : {}),
    });
    remaining -= duration;
  }

  return shots;
}

// ===========================================================================
// FULL-SONG TREATMENT — the creative-director rebuild (owner verdict,
// 2026-07-16: "GRAMMY quality… a FULL video that encompasses the full song…
// CREATIVE and not just basic the song lyric"). One treatment, two
// deliverables: sequences mapped 1:1 to the song's MEASURED sections, and a
// social teaser cut derived FROM the same treatment. Model JSON is treated as
// hostile: timing comes from measurement (never from the model), text is
// capped, shots are clamped, and the flat shots[] view keeps every legacy
// consumer (per-shot billing, the render worker, the lyrics-panel list) alive.
// ===========================================================================

/** Hard cap on shots across the WHOLE treatment (~40 per the design law). */
export const MAX_TREATMENT_SHOTS = 40;
/** A sequence carries 2-5 representative shots; never more than 5. */
const MAX_SEQUENCE_SHOTS = 5;
/** Creative shot length band (seconds). Providers snap to their own grid at
 *  render time (see packages/ai providers/video.ts supportedDuration), and
 *  billing snaps via providerDuration below — so 2-8s here is safe. */
const MIN_SHOT_S = 2;
const MAX_SHOT_S = 8;
/** More sequences than this and a 1-shot-per-sequence treatment would already
 *  blow the shot budget — merge measured sections down to this many. */
const MAX_TREATMENT_SEQUENCES = 12;
type TeaserDurationS = 15 | 30;

export interface TreatmentSection {
  index: number;
  label: string;
  startS: number;
  endS: number;
}

export interface NormalizedTreatmentShot extends NormalizedStoryboardShot {
  /** Which sequence (index into treatment.sequences) this shot belongs to. */
  sequenceIndex: number;
}

export interface NormalizedTreatmentSequence {
  index: number;
  label: string;
  startS: number;
  endS: number;
  /** What this passage does emotionally. */
  intent?: string;
  /** Setting / visual beat. */
  setting?: string;
  /** Continuity notes binding this passage to the whole. */
  continuity?: string;
  /** PERFORMER LAW: which roster leads are ON SCREEN in this passage
   *  (e.g. ["LEAD_A","LEAD_B"]). Optional — solo plans may omit it. */
  performers?: string[];
  /** Indices into the treatment's flat shots[] view. */
  shotIndexes: number[];
}

export interface TeaserCut {
  durationS: TeaserDurationS;
  format: "vertical";
  /** Indices into the treatment's flat shots[] view. Always non-empty. */
  shotRefs: number[];
  hookMoment?: string;
}

export interface NormalizedVideoTreatment {
  /** Shape discriminator so consumers can tell treatment from legacy array. */
  kind: "treatment";
  /** The one-line idea. */
  concept: string;
  logline: string;
  visualWorld?: string;
  /** 3-5 recurring images that accumulate meaning. */
  motifs: string[];
  colorStory?: string;
  castingNotes?: string;
  /** The declared performance-vs-narrative balance. */
  balance?: string;
  /** 'measured' = sections come from the audio's measured boundaries;
   *  'assumed' = honest fallback (standard 3-act arc over the known length). */
  structureSource: "measured" | "assumed";
  /** Full treatment length in seconds — the whole song, not a 12s clip. */
  durationS: number;
  sequences: NormalizedTreatmentSequence[];
  /** FLAT COMPATIBILITY VIEW — every legacy consumer of the storyboard column
   *  (per-shot billing, the render worker payload, the lyrics-panel shot list)
   *  reads this array. Same element shape as the old storyboard. */
  shots: NormalizedTreatmentShot[];
  /** The socials clip derived FROM this treatment — never a separate plan. */
  teaserCut: TeaserCut;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

const asRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function clampShotDuration(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4;
  return Math.max(MIN_SHOT_S, Math.min(MAX_SHOT_S, Math.round(parsed)));
}

/** Positional structure labels — hypotheses from position, not lyric claims. */
function positionalLabel(index: number, total: number): string {
  if (total <= 1) return "Full song";
  if (index === 0) return "Intro";
  if (index === total - 1) return "Outro";
  const interior = total - 2;
  const position = index - 1;
  if (interior >= 4 && position === interior - 1) return "Bridge";
  return position % 2 === 0 ? `Verse ${Math.floor(position / 2) + 1}` : "Hook";
}

/**
 * Turn the song's MEASURED section boundaries into labeled treatment sections.
 * Segments under 3s merge into their neighbor; more than MAX_TREATMENT_SEQUENCES
 * segments merge evenly so a busy measurement can't explode the shot budget.
 */
export function treatmentSectionsFromBoundaries(
  durationS: number,
  boundaries: number[]
): TreatmentSection[] {
  const total =
    Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
  if (!total) return [];
  const inner = [
    ...new Set(
      boundaries
        .filter(
          value => Number.isFinite(value) && value > 0 && value < total
        )
        .map(round3)
    ),
  ].sort((left, right) => left - right);
  let edges = [0, ...inner, total];
  // Merge slivers (<3s) into the previous segment.
  const kept: number[] = [0];
  for (let index = 1; index < edges.length; index++) {
    const edge = edges[index]!;
    if (index === edges.length - 1) {
      if (edge - kept[kept.length - 1]! < 3 && kept.length > 1) kept.pop();
      kept.push(edge);
    } else if (edge - kept[kept.length - 1]! >= 3) {
      kept.push(edge);
    }
  }
  edges = kept;
  // Merge evenly down to the sequence cap.
  const segments = edges.length - 1;
  if (segments > MAX_TREATMENT_SEQUENCES) {
    const merged: number[] = [0];
    for (let group = 1; group < MAX_TREATMENT_SEQUENCES; group++) {
      merged.push(edges[Math.round((group * segments) / MAX_TREATMENT_SEQUENCES)]!);
    }
    merged.push(total);
    edges = [...new Set(merged)].sort((left, right) => left - right);
  }
  const count = edges.length - 1;
  return edges.slice(0, -1).map((startS, index) => ({
    index,
    label: positionalLabel(index, count),
    startS: round3(startS),
    endS: round3(edges[index + 1]!),
  }));
}

/**
 * Richer honest fallback when no measurement exists: a full pop-song arc
 * (intro / verses / choruses / bridge / final chorus / outro) scaled to the
 * song's duration. A 3-block arc hands the director only three settings — the
 * top cause of one-location, repetitive imported-song videos (an imported song
 * has no measured structure, so it fell here). This gives 5-8 DISTINCT sections
 * so the NO-REPETITION LAW has room to travel. Still an ASSUMPTION
 * (structureSource stays 'assumed'); a MEASURED structure always wins when we
 * have one.
 */
export function assumedSongArcSections(durationS: number): TreatmentSection[] {
  const total = Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
  if (!total) return [];
  if (total < 24) {
    return [{ index: 0, label: "Full song", startS: 0, endS: round3(total) }];
  }
  // (label, share of song) — shares sum to 1. Choruses carry the weight; intro
  // and outro stay short. Shorter songs get fewer sections so no passage is too
  // thin to stage.
  const arc: Array<[string, number]> =
    total < 75
      ? [
          ["Intro", 0.12],
          ["Verse 1", 0.24],
          ["Chorus 1", 0.24],
          ["Bridge", 0.16],
          ["Final Chorus", 0.16],
          ["Outro", 0.08],
        ]
      : [
          ["Intro", 0.08],
          ["Verse 1", 0.15],
          ["Chorus 1", 0.15],
          ["Verse 2", 0.15],
          ["Chorus 2", 0.15],
          ["Bridge", 0.1],
          ["Final Chorus", 0.15],
          ["Outro", 0.07],
        ];
  const sections: TreatmentSection[] = [];
  let cursor = 0;
  arc.forEach(([label, share], index) => {
    const startS = round3(cursor);
    const endS =
      index === arc.length - 1
        ? round3(total)
        : round3(Math.min(total, cursor + total * share));
    sections.push({ index, label, startS, endS });
    cursor = endS;
  });
  return sections;
}

/** Honest fallback when no measurement exists: a standard 3-act arc. Kept as
 *  the last-resort tiler in sanitizeSections; the treatment path now prefers
 *  the richer assumedSongArcSections above. */
export function assumedThreeActSections(durationS: number): TreatmentSection[] {
  const total =
    Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
  if (!total) return [];
  if (total < 24) {
    return [{ index: 0, label: "Full song", startS: 0, endS: round3(total) }];
  }
  const firstEdge = round3(total * 0.3);
  const secondEdge = round3(total * 0.75);
  return [
    { index: 0, label: "Act I — establish", startS: 0, endS: firstEdge },
    { index: 1, label: "Act II — escalate", startS: firstEdge, endS: secondEdge },
    { index: 2, label: "Act III — payoff", startS: secondEdge, endS: round3(total) },
  ];
}

/**
 * THE ±10% LAW. Sections must tile the song's duration — the model never
 * supplies timing, but a caller (or a stale cache) might hand sections whose
 * span drifted from the audio's truth. Outside ±10% we rescale linearly to the
 * song; inside it we still pin the last edge so the treatment claims exactly
 * the song's length.
 */
function sanitizeSections(
  sections: TreatmentSection[] | undefined,
  durationS: number
): TreatmentSection[] {
  const valid = (sections ?? [])
    .filter(
      section =>
        section &&
        Number.isFinite(section.startS) &&
        Number.isFinite(section.endS) &&
        section.endS > section.startS &&
        section.startS >= 0
    )
    .sort((left, right) => left.startS - right.startS)
    .slice(0, MAX_TREATMENT_SEQUENCES + 2);
  if (!valid.length) return assumedThreeActSections(durationS);
  const span = valid[valid.length - 1]!.endS;
  const scale = span > 0 ? durationS / span : 1;
  let cursor = 0;
  const tiled = valid.map((section, index) => {
    const startS = cursor;
    const endS =
      index === valid.length - 1
        ? round3(durationS)
        : round3(Math.min(durationS, Math.max(startS, section.endS * scale)));
    cursor = endS;
    return {
      index,
      label:
        typeof section.label === "string" && section.label.trim()
          ? section.label.trim().slice(0, 60)
          : positionalLabel(index, valid.length),
      startS,
      endS,
    };
  }).filter(section => section.endS > section.startS);
  return tiled.length
    ? tiled.map((section, index) => ({ ...section, index }))
    : assumedThreeActSections(durationS);
}

interface RawSequenceBucket {
  intent?: string;
  setting?: string;
  continuity?: string;
  performers?: string[];
  shots: unknown[];
}

/** Read the model's sequences (hostile JSON) into per-section buckets. */
function bucketModelSequences(
  raw: unknown,
  sectionCount: number
): RawSequenceBucket[] {
  const buckets: RawSequenceBucket[] = Array.from(
    { length: sectionCount },
    () => ({ shots: [] })
  );
  if (!Array.isArray(raw)) return buckets;
  // Distrust: consider at most sections+2 model sequences (splits allowed —
  // their shots fold into the section they name).
  const considered = raw.slice(0, sectionCount + 2);
  considered.forEach((item, order) => {
    const row = asRecord(item);
    const declared = Number(row.sectionIndex ?? row.index);
    const target =
      Number.isInteger(declared) && declared >= 0 && declared < sectionCount
        ? declared
        : Math.min(order, sectionCount - 1);
    const bucket = buckets[target]!;
    bucket.intent ??= cleanText(row.intent, 400);
    bucket.setting ??= cleanText(row.setting ?? row.visualBeat, 400);
    bucket.continuity ??= cleanText(row.continuity ?? row.continuityNotes, 400);
    // PERFORMER LAW: which roster leads the model put ON SCREEN here.
    if (!bucket.performers && Array.isArray(row.performers)) {
      const leads = row.performers
        .map(entry => cleanText(entry, 40))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 6);
      if (leads.length) bucket.performers = leads;
    }
    if (Array.isArray(row.shots)) bucket.shots.push(...row.shots);
  });
  return buckets;
}

function normalizeTreatmentShot(
  item: unknown,
  sequenceIndex: number,
  globalIndex: number
): NormalizedTreatmentShot | null {
  const row = asRecord(item);
  const prompt = cleanText(row.prompt, 2_000);
  if (!prompt) return null;
  const subjects = Array.isArray(row.subjects)
    ? row.subjects
        .map(subject => cleanText(subject, 120))
        .filter((subject): subject is string => Boolean(subject))
        .slice(0, 8)
    : undefined;
  return {
    index: globalIndex,
    sequenceIndex,
    prompt,
    duration_s: clampShotDuration(row.duration_s ?? row.durationS),
    ...(cleanText(row.motion, 300) ? { motion: cleanText(row.motion, 300) } : {}),
    ...(cleanText(row.lighting, 300)
      ? { lighting: cleanText(row.lighting, 300) }
      : {}),
    ...(subjects?.length ? { subjects } : {}),
    ...(cleanText(row.negativePrompt, 500)
      ? { negativePrompt: cleanText(row.negativePrompt, 500) }
      : {}),
  };
}

function normalizeTeaser(
  value: unknown,
  shots: NormalizedTreatmentShot[],
  sequences: NormalizedTreatmentSequence[]
): TeaserCut {
  const row = asRecord(value);
  const requested = Number(row.durationS ?? row.duration_s);
  const durationS: TeaserCut["durationS"] =
    Number.isFinite(requested) && requested >= 23 ? 30 : 15;
  let shotRefs = Array.isArray(row.shotRefs)
    ? [
        ...new Set(
          row.shotRefs
            .map(Number)
            .filter(
              ref => Number.isInteger(ref) && ref >= 0 && ref < shots.length
            )
        ),
      ].slice(0, 8)
    : [];
  if (!shotRefs.length) {
    // Derive the teaser from the treatment's own peak: hook/payoff passages
    // first, else the middle of the arc, else the opening shots.
    const peak = sequences.filter(sequence =>
      /hook|chorus|payoff|act ii/i.test(sequence.label)
    );
    const pool = (peak.length ? peak : sequences).flatMap(
      sequence => sequence.shotIndexes
    );
    shotRefs = pool.slice(0, 3);
    if (!shotRefs.length) {
      shotRefs = shots.slice(0, Math.min(3, shots.length)).map(shot => shot.index);
    }
  }
  const hookMoment = cleanText(row.hookMoment, 300);
  return {
    durationS,
    format: "vertical",
    shotRefs,
    ...(hookMoment ? { hookMoment } : {}),
  };
}

export interface NormalizeTreatmentOptions {
  /** The song's measured (or honestly assumed) full duration in seconds. */
  durationS: number;
  /** Authoritative sections (measured boundaries or the 3-act fallback). */
  sections?: TreatmentSection[];
  structureSource?: "measured" | "assumed";
}

/**
 * Treat the model's treatment JSON as untrusted. Timing NEVER comes from the
 * model — sequences tile the caller's measured sections (±10% law enforced by
 * rescaling); shots are 2-8s, ≤5 per sequence, ≤MAX_TREATMENT_SHOTS overall;
 * every sequence keeps at least one shot (synthesized from its own intent when
 * the model left it empty) so the flat view always covers the song; the teaser
 * always resolves to valid shot references. Legacy/flat model output (shots
 * without sequences) is distributed across the sections rather than rejected.
 */
export function normalizeVideoTreatment(
  value: unknown,
  options: NormalizeTreatmentOptions
): NormalizedVideoTreatment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const durationS =
    Number.isFinite(options.durationS) && options.durationS > 0
      ? round3(options.durationS)
      : 0;
  if (!durationS) return null;

  const sections = sanitizeSections(options.sections, durationS);
  const buckets = bucketModelSequences(root.sequences, sections.length);

  // Legacy / stub shape: flat shots at the root, no sequences — distribute
  // them across the sections evenly so nothing honest gets rejected.
  const hasSequenceShots = buckets.some(bucket => bucket.shots.length > 0);
  if (!hasSequenceShots && Array.isArray(root.shots) && root.shots.length) {
    const flat = root.shots.slice(0, MAX_TREATMENT_SHOTS);
    const perSection = Math.max(1, Math.ceil(flat.length / sections.length));
    flat.forEach((shot, index) => {
      const target = Math.min(
        Math.floor(index / perSection),
        sections.length - 1
      );
      buckets[target]!.shots.push(shot);
    });
  }

  const concept =
    cleanText(root.concept, 300) ??
    cleanText(root.title, 300) ??
    cleanText(root.logline, 300);
  if (!concept) return null;

  const shots: NormalizedTreatmentShot[] = [];
  const sequences: NormalizedTreatmentSequence[] = sections.map(
    (section, sequenceIndex) => {
      const bucket = buckets[sequenceIndex]!;
      const remainingSequences = sections.length - sequenceIndex - 1;
      // Budget so every remaining sequence can still hold at least one shot.
      const budget = Math.max(
        1,
        Math.min(
          MAX_SEQUENCE_SHOTS,
          MAX_TREATMENT_SHOTS - shots.length - remainingSequences
        )
      );
      const shotIndexes: number[] = [];
      for (const candidate of bucket.shots) {
        if (shotIndexes.length >= budget) break;
        const shot = normalizeTreatmentShot(
          candidate,
          sequenceIndex,
          shots.length
        );
        if (!shot) continue;
        shots.push(shot);
        shotIndexes.push(shot.index);
      }
      if (!shotIndexes.length && shots.length < MAX_TREATMENT_SHOTS) {
        // A sequence with no usable shots still gets one honest beat built
        // from its own passage, so the flat view covers the whole song.
        const fallbackCast = cleanText(root.castingNotes, 300);
        const fallbackPrompt =
          ([bucket.setting, bucket.intent].filter(Boolean).join(" — ") ||
            `${concept} — ${section.label.toLowerCase()} passage`) +
          // CAST LAW: even a synthesized beat states who is on screen —
          // an uncast prompt renders the engine's training-set default.
          (fallbackCast ? ` — on screen: ${fallbackCast}` : "");
        const fallback: NormalizedTreatmentShot = {
          index: shots.length,
          sequenceIndex,
          prompt: fallbackPrompt.slice(0, 2_000),
          duration_s: 4,
          motion: "slow push-in",
        };
        shots.push(fallback);
        shotIndexes.push(fallback.index);
      }
      return {
        index: sequenceIndex,
        label: section.label,
        startS: section.startS,
        endS: section.endS,
        ...(bucket.intent ? { intent: bucket.intent } : {}),
        ...(bucket.setting ? { setting: bucket.setting } : {}),
        ...(bucket.continuity ? { continuity: bucket.continuity } : {}),
        ...(bucket.performers ? { performers: bucket.performers } : {}),
        shotIndexes,
      };
    }
  );
  if (!shots.length) return null;

  const motifs = Array.isArray(root.motifs)
    ? root.motifs
        .map(motif => cleanText(motif, 200))
        .filter((motif): motif is string => Boolean(motif))
        .slice(0, 5)
    : [];
  const logline = cleanText(root.logline, 500) ?? concept;
  const visualWorld = cleanText(root.visualWorld, 800);
  const colorStory = cleanText(root.colorStory, 500);
  const castingNotes = cleanText(root.castingNotes, 500);
  const balance = cleanText(
    root.balance ?? root.performanceNarrativeBalance,
    300
  );

  return {
    kind: "treatment",
    concept,
    logline,
    ...(visualWorld ? { visualWorld } : {}),
    motifs,
    ...(colorStory ? { colorStory } : {}),
    ...(castingNotes ? { castingNotes } : {}),
    ...(balance ? { balance } : {}),
    structureSource: options.structureSource ?? "assumed",
    durationS: Math.round(durationS),
    sequences,
    shots,
    teaserCut: normalizeTeaser(root.teaserCut, shots, sequences),
  };
}

export type TreatmentReviewMode = "critic" | "repair";

/**
 * COMPACT TREATMENT FOR REVIEW — the prompt SHRINK that keeps the critic and
 * repair calls under the bulk brain's ~28k-char context guard so they actually
 * resolve to the fast Cerebras tier instead of silently escalating up the
 * paid-brain ladder (packages/ai generate.ts routes a bulk prompt > 28k chars
 * UP, and under a forced-bulk run "up" tops out at the OpenAI draft — never
 * Sonnet — but Cerebras is the goal, so we stay under the guard).
 *
 * The raw model treatment (up to MAX_TREATMENT_SHOTS shots, each a long
 * render-ready prompt + verbatim cast subjects + craft) plus the song lyrics
 * routinely blows past 28k on a full-song plan. Two modes, by what the call
 * needs:
 *  - "critic": the critic only SCORES a fixed rubric and never returns a
 *    treatment, so it gets an AGGRESSIVE projection — top-level creative +
 *    per-sequence intent/setting/continuity/performers + per-shot prompt +
 *    subjects only (≤3 shots/sequence, short caps). Nothing here is persisted,
 *    so the trim costs no output fidelity.
 *  - "repair": the repair must RETURN a corrected treatment that re-normalizes,
 *    so it gets a HIGH-FIDELITY projection — a generous prompt cap that leaves
 *    realistic shot prompts untouched, plus motion/lighting/durationS/
 *    negativePrompt and the teaser — bounded to the same MAX_TREATMENT_SHOTS
 *    the normalizer keeps anyway. Only pathologically long prompts (>800 chars,
 *    which the normalizer would itself cap at 2000) lose tail detail.
 *
 * Both bound the shot budget to MAX_TREATMENT_SHOTS across the whole treatment
 * (one shot minimum per sequence) so a runaway model can't reinflate the prompt,
 * and both re-anchor sequences to the authoritative sections (label +
 * sectionIndex) exactly as normalizeVideoTreatment does.
 */
export function compactTreatmentForReview(
  raw: unknown,
  sections: TreatmentSection[],
  mode: TreatmentReviewMode
): Record<string, unknown> {
  const full = mode === "repair";
  const root = asRecord(raw);
  const rawSequences = Array.isArray(root.sequences) ? root.sequences : [];
  const perSequence = full ? MAX_SEQUENCE_SHOTS : 3;
  const promptCap = full ? 800 : 200;
  const subjectCap = full ? 120 : 80;
  const metaCap = full ? 300 : 140;

  let shotBudgetUsed = 0;
  const sequences = sections.map((section, index) => {
    const src = asRecord(
      rawSequences.find(seq => {
        const declared = Number(asRecord(seq).sectionIndex ?? asRecord(seq).index);
        return Number.isInteger(declared) && declared === index;
      }) ?? rawSequences[index]
    );
    // Same one-shot-per-remaining-sequence budgeting the normalizer uses, so the
    // review sees the same coverage the stored treatment will keep.
    const remaining = sections.length - index - 1;
    const budget = Math.max(
      1,
      Math.min(perSequence, MAX_TREATMENT_SHOTS - shotBudgetUsed - remaining)
    );
    const rawShots = Array.isArray(src.shots) ? src.shots.slice(0, budget) : [];
    const shots: Record<string, unknown>[] = [];
    for (const item of rawShots) {
      const shot = asRecord(item);
      const prompt = cleanText(shot.prompt, promptCap);
      if (!prompt) continue;
      const subjects = Array.isArray(shot.subjects)
        ? shot.subjects
            .map(subject => cleanText(subject, subjectCap))
            .filter((subject): subject is string => Boolean(subject))
            .slice(0, full ? 6 : 4)
        : undefined;
      const durationS = Number(shot.durationS ?? shot.duration_s);
      const motion = full ? cleanText(shot.motion, 120) : undefined;
      const lighting = full ? cleanText(shot.lighting, 120) : undefined;
      const negativePrompt = full ? cleanText(shot.negativePrompt, 160) : undefined;
      shots.push({
        prompt,
        ...(subjects?.length ? { subjects } : {}),
        ...(motion ? { motion } : {}),
        ...(lighting ? { lighting } : {}),
        ...(full && Number.isFinite(durationS) ? { durationS } : {}),
        ...(negativePrompt ? { negativePrompt } : {}),
      });
    }
    shotBudgetUsed += shots.length;

    const performers = Array.isArray(src.performers)
      ? src.performers
          .map(entry => cleanText(entry, 40))
          .filter((entry): entry is string => Boolean(entry))
          .slice(0, 6)
      : undefined;
    const intent = cleanText(src.intent, metaCap);
    const setting = cleanText(src.setting ?? src.visualBeat, metaCap);
    const continuity = cleanText(src.continuity ?? src.continuityNotes, metaCap);
    return {
      sectionIndex: index,
      label: section.label,
      ...(intent ? { intent } : {}),
      ...(setting ? { setting } : {}),
      ...(continuity ? { continuity } : {}),
      ...(performers?.length ? { performers } : {}),
      shots,
    };
  });

  const motifs = Array.isArray(root.motifs)
    ? root.motifs
        .map(motif => cleanText(motif, 200))
        .filter((motif): motif is string => Boolean(motif))
        .slice(0, 5)
    : undefined;
  const title = cleanText(root.title, 200);
  const concept = cleanText(root.concept, 300);
  const logline = cleanText(root.logline, 500);
  const visualWorld = full ? cleanText(root.visualWorld, 800) : undefined;
  const colorStory = cleanText(root.colorStory, 500);
  const castingNotes = cleanText(root.castingNotes, 500);
  const balance = cleanText(root.balance ?? root.performanceNarrativeBalance, 300);
  const teaser = asRecord(root.teaserCut);
  return {
    ...(title ? { title } : {}),
    ...(concept ? { concept } : {}),
    ...(logline ? { logline } : {}),
    ...(visualWorld ? { visualWorld } : {}),
    ...(motifs?.length ? { motifs } : {}),
    ...(colorStory ? { colorStory } : {}),
    ...(castingNotes ? { castingNotes } : {}),
    ...(balance ? { balance } : {}),
    sequences,
    ...(full && Object.keys(teaser).length ? { teaserCut: teaser } : {}),
  };
}

/**
 * FLAT SHOTS from either storage shape — the legacy array or the treatment
 * object's compatibility view. Every reader of VideoConcept.storyboard that
 * needs a shot list goes through this.
 */
export function storyboardShots(value: unknown): NormalizedStoryboardShot[] {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray((value as { shots?: unknown } | null)?.shots)
      ? ((value as { shots: unknown[] }).shots)
      : [];
  return rows.filter(
    (row): row is NormalizedStoryboardShot =>
      row != null &&
      typeof row === "object" &&
      typeof (row as { prompt?: unknown }).prompt === "string"
  );
}

/** The rich treatment when the stored storyboard carries one, else null. */
export function videoTreatmentOf(
  value: unknown
): NormalizedVideoTreatment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.sequences) || !Array.isArray(row.shots)) return null;
  return row as unknown as NormalizedVideoTreatment;
}

// ===========================================================================
// OWNER-APPROVED PER-CLASS PRICING (verbatim, 2026-07-16: "I like your
// pricing"): Draft $0.50/scene, Standard $2.00/scene, Flagship $6.00/scene.
// ONE pure law prices every surface — the /renders route, /render-all's
// upfront charge, and the web confirm dialog all call the same functions, so
// what the user is shown and what the ledger debits can never disagree.
// ===========================================================================

/** The credit key a scene render bills against, per engine class. */
export type VideoShotCreditKey = Extract<
  CreditKey,
  "video_shot_draft" | "video_shot_standard" | "video_shot_flagship"
>;

const VIDEO_SHOT_CREDIT_KEYS: Record<VideoEngineClass, VideoShotCreditKey> = {
  draft: "video_shot_draft",
  standard: "video_shot_standard",
  flagship: "video_shot_flagship",
};

/** Class → credit key. Legacy callers without a class bill as 'standard'. */
export function videoShotCreditKey(
  engineClass?: VideoEngineClass | null
): VideoShotCreditKey {
  return VIDEO_SHOT_CREDIT_KEYS[engineClass ?? DEFAULT_VIDEO_ENGINE_CLASS];
}

/**
 * TOTAL COST of rendering `shotCount` scenes at a class, in 1/100-cent units.
 * Exported for BOTH sides of the wire: the server charges exactly
 * costOf(key) × count and the web confirm dialog displays this same number —
 * parity is proven by the worker suite, not promised.
 */
export function videoRenderTotalCost(
  shotCount: number,
  engineClass?: VideoEngineClass | null
): number {
  const count = Number.isFinite(shotCount)
    ? Math.max(0, Math.floor(shotCount))
    : 0;
  return CREDIT_COSTS[videoShotCreditKey(engineClass)] * count;
}

export interface VideoRenderUsage {
  creditKey: VideoShotCreditKey;
  /** Scenes billed — per-scene pricing: one unit per selected shot. */
  billingUnits: number;
  /** Provider seconds requested — plan caps still meter real workload. */
  planUnits: number;
  shotCount: number;
}

/**
 * Convert selected shots into the billing workload. CLASS-AWARE (owner-
 * approved per-scene pricing): the credit key is the engine class's shot key
 * and billingUnits is the number of scenes; legacy callers that pass no class
 * default to 'standard'. Fails closed on anything that is not a shot ARRAY
 * (a treatment object passed whole returns null — no charge, no crashed
 * worker job). Render-ALL-in-one-job keeps the legacy 15-shot cost guard;
 * single-shot renders work across a full treatment (up to
 * MAX_TREATMENT_SHOTS) so per-shot billing survives the full-song shape.
 */
export function videoRenderUsage(
  shots: Array<{ duration_s?: number }>,
  shotIndex?: number,
  engineClass?: VideoEngineClass | null
): VideoRenderUsage | null {
  if (!Array.isArray(shots) || shots.length === 0) return null;
  const maxSelectable = shotIndex == null ? MAX_SHOTS : MAX_TREATMENT_SHOTS;
  if (shots.length > maxSelectable) return null;
  const selected =
    shotIndex == null ? shots : shots[shotIndex] ? [shots[shotIndex]!] : [];
  if (!selected.length) return null;

  const durations = selected.map(shot => providerDuration(shot.duration_s));
  const planUnits = durations.reduce((sum, duration) => sum + duration, 0);
  if (!Number.isInteger(planUnits) || planUnits <= 0) return null;
  return {
    creditKey: videoShotCreditKey(engineClass),
    billingUnits: selected.length,
    planUnits,
    shotCount: selected.length,
  };
}

export interface VideoRenderAllUsage {
  creditKey: VideoShotCreditKey;
  /** Scenes billed = UNRENDERED scenes only — rendered ones are never re-billed. */
  billingUnits: number;
  /** Provider seconds across the unrendered scenes (plan caps). */
  planUnits: number;
  /** The shot indexes that will actually be queued. */
  shotIndexes: number[];
  /** Excluded from the bill — already have a successful render. */
  renderedShotIndexes: number[];
  /** costOf(creditKey) × billingUnits, in 1/100-cent units. */
  totalCost: number;
}

/**
 * ONE-CLICK FULL VIDEO billing law: charge per-shot cost × UNRENDERED shots
 * only. Already-rendered scenes (by shot index) are excluded — double-billing
 * is impossible by construction, and totalCost === videoRenderTotalCost(
 * shotIndexes.length, class) so the client confirm and the server charge are
 * the same number. Null only for a shotless/oversized/non-array storyboard;
 * "everything already rendered" returns billingUnits 0 so the route can 409
 * with an honest breakdown instead of a vague no.
 */
export function videoRenderAllUsage(
  shots: Array<{ duration_s?: number }>,
  renderedShotIndexes: Iterable<number>,
  engineClass?: VideoEngineClass | null
): VideoRenderAllUsage | null {
  if (!Array.isArray(shots) || shots.length === 0) return null;
  if (shots.length > MAX_TREATMENT_SHOTS) return null;
  const rendered = new Set(
    [...renderedShotIndexes].filter(
      index => Number.isInteger(index) && index >= 0 && index < shots.length
    )
  );
  const shotIndexes: number[] = [];
  let planUnits = 0;
  shots.forEach((shot, index) => {
    if (rendered.has(index)) return;
    shotIndexes.push(index);
    planUnits += providerDuration(shot.duration_s);
  });
  const creditKey = videoShotCreditKey(engineClass);
  return {
    creditKey,
    billingUnits: shotIndexes.length,
    planUnits,
    shotIndexes,
    renderedShotIndexes: [...rendered].sort((a, b) => a - b),
    totalCost: videoRenderTotalCost(shotIndexes.length, engineClass),
  };
}

// ===========================================================================
// PERFORMER ROSTER LAW (2026-07-17, owner: a duet rendered with one male lead
// and the female singer never appeared). The treatment brain used to receive
// ONE scalar vocalist; now it receives a structured roster, and the route can
// GATE a duet plan that forgot a lead before a cent is spent.
// ===========================================================================

export interface PerformerRosterEntry {
  id: string;
  vocal: "female" | "male";
}

export interface Performers {
  mode: "solo_female" | "solo_male" | "duet" | "group" | "unknown";
  roster: PerformerRosterEntry[];
}

/** PURE mapping from the render-time voice setting to the roster the
 *  treatment brain must cast. 'group' keeps an empty roster (front lead is
 *  inferred from the lyrics; the ensemble is described, not enumerated). */
export function performersFromVoice(
  voice: string | null | undefined
): Performers {
  switch (voice) {
    case "female":
      return { mode: "solo_female", roster: [{ id: "LEAD_A", vocal: "female" }] };
    case "male":
      return { mode: "solo_male", roster: [{ id: "LEAD_A", vocal: "male" }] };
    case "duet":
      return {
        mode: "duet",
        roster: [
          { id: "LEAD_A", vocal: "female" },
          { id: "LEAD_B", vocal: "male" },
        ],
      };
    case "group":
      return { mode: "group", roster: [] };
    default:
      return { mode: "unknown", roster: [] };
  }
}

/** DUET GATE (pure, route-enforced): a duet treatment must give BOTH leads a
 *  presence — each roster id (or an explicit gendered description) must
 *  appear in castingNotes, and at least one sequence must put each lead on
 *  screen (via sequence.performers or a shot prompt naming them). Returns the
 *  missing lead ids; empty = the plan casts everyone. */
export function missingDuetLeads(
  performers: Performers,
  treatment: {
    castingNotes?: string;
    sequences: Array<{ performers?: string[] }>;
    shots: Array<{ prompt: string }>;
  }
): string[] {
  if (performers.mode !== "duet") return [];
  const casting = (treatment.castingNotes ?? "").toUpperCase();
  const promptText = treatment.shots
    .map(shot => shot.prompt)
    .join("\n")
    .toUpperCase();
  const sequencePerformers = new Set(
    treatment.sequences.flatMap(sequence => sequence.performers ?? [])
  );
  // Word-boundary matching: "WOMAN" must never satisfy a MALE check via its
  // "MAN" substring (nor "FEMALE" a "MALE" check).
  const genderPattern: Record<string, RegExp> = {
    female: /\b(WOMAN|WOMEN|FEMALE|SHE|HER)\b/,
    male: /\b(MAN|MEN|MALE|HE|HIS|HIM)\b/,
  };
  return performers.roster
    .filter(lead => {
      const id = lead.id.toUpperCase();
      const pattern = genderPattern[lead.vocal];
      const inCasting =
        casting.includes(id) || (pattern ? pattern.test(casting) : false);
      const onScreen =
        sequencePerformers.has(lead.id) ||
        promptText.includes(id) ||
        (pattern ? pattern.test(promptText) : false);
      return !(inCasting && onScreen);
    })
    .map(lead => lead.id);
}

// ===========================================================================
// PACKAGE B — SAME FACES ALL VIDEO (2026-07-17).
// Scene renders are independent generations with no memory; identity holds
// only through (1) verbatim cast descriptions (Package A), (2) sequence
// continuity text folded into every shot prompt, and (3) ONE character-sheet
// portrait per lead used as the i2v keyframe on that lead's scenes.
// ===========================================================================

export interface RenderShotDecoration extends NormalizedStoryboardShot {
  sequenceIndex?: number;
  /** The roster lead who fronts this shot (first ON-SCREEN performer of its
   *  sequence) — the worker keys character-sheet keyframes off this. */
  lead?: string;
}

/** PURE: fold each shot's sequence continuity into its prompt and attach the
 *  sequence's fronting lead. Legacy storyboards (no treatment) pass through
 *  untouched. */
export function decorateTreatmentShotsForRender(
  storyboard: unknown,
  shots: NormalizedStoryboardShot[]
): RenderShotDecoration[] {
  const treatment = videoTreatmentOf(storyboard);
  if (!treatment) return shots;
  const bySequence = new Map(
    treatment.sequences.map(sequence => [sequence.index, sequence])
  );
  return shots.map(shot => {
    const sequenceIndex = (shot as { sequenceIndex?: unknown }).sequenceIndex;
    const sequence = Number.isInteger(sequenceIndex)
      ? bySequence.get(sequenceIndex as number)
      : undefined;
    const continuity = sequence?.continuity?.trim();
    const lead = sequence?.performers?.[0];
    return {
      ...shot,
      ...(Number.isInteger(sequenceIndex)
        ? { sequenceIndex: sequenceIndex as number }
        : {}),
      ...(continuity
        ? { prompt: `${shot.prompt}\nContinuity: ${continuity}` }
        : {}),
      ...(lead ? { lead } : {}),
    };
  });
}

/** PURE: build the character-sheet portrait prompt for one roster lead from
 *  castingNotes (the lead's own locked description leads; the whole notes
 *  text rides as context so wardrobe/world stay coherent). */
export function characterSheetPrompt(
  castingNotes: string | undefined,
  leadId: string
): string {
  const notes = (castingNotes ?? "").trim();
  const leadLine =
    notes
      .split(/(?=LEAD_[A-Z])/)
      .find(part => part.trim().toUpperCase().startsWith(leadId.toUpperCase()))
      ?.trim() ?? "";
  return [
    "Character reference portrait for a music video.",
    leadLine || `${leadId} — the lead performer, Black African per the cast law.`,
    leadLine && notes !== leadLine ? `World: ${notes}` : "",
    "Three-quarter body, facing camera, neutral stance, clean studio background, soft key light, photorealistic, high detail. One person only. No text, no logos.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3000);
}

/**
 * BLUEPRINT — structure transfer, not vibe transfer.
 *
 * "Make in this lane" was carrying tags, tempo and mood into a text prompt and
 * hoping. A Blueprint carries the MEASURED SKELETON of a source record — section
 * count, section lengths in bars, BPM — as a hard contract: same architecture,
 * every part replaced (new beat, new words, new melody). Extract → Contract →
 * Verify: the rendered take is re-measured and scored against the blueprint, so
 * "same structure" is a number on the report, never a vibe.
 *
 * Sources must be MEASURED audio we may analyze: the user's owned uploads and the
 * studio's own renders. (A zap's metadata cannot yield a real skeleton — honesty
 * law: we do not fabricate structure we never measured.)
 */
import type { MeasuredAnalysis } from './dsp-analysis';

export interface BlueprintSection {
  index: number;
  startS: number;
  endS: number;
  bars: number | null; // null when tempo unknown — seconds still compared honestly
}

export interface SongBlueprint {
  bpm: number | null;
  totalDurationS: number;
  totalBars: number | null;
  sections: BlueprintSection[];
  /** e.g. "S1 8b · S2 16b · S3 8b · S4 16b · S5 12b @ 112 BPM" */
  structureString: string;
}

type MaybeMeasured = { value?: unknown } | null | undefined;
const num = (f: MaybeMeasured): number | null => {
  const v = (f as { value?: unknown } | null)?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const arr = (f: MaybeMeasured): number[] | null => {
  const v = (f as { value?: unknown } | null)?.value;
  return Array.isArray(v) && v.every((x) => typeof x === 'number') ? (v as number[]) : null;
};

export function blueprintFromMeasured(m: MeasuredAnalysis | null | undefined): SongBlueprint | null {
  if (!m || !(m as { engineOk?: boolean }).engineOk) return null;
  const mm = m as unknown as Record<string, MaybeMeasured>;
  const dur = num(mm.durationS);
  const bpm = num(mm.tempoBpm);
  const bounds = arr(mm.sectionBoundaries) ?? [];
  if (!dur || dur < 20) return null;
  // Boundary times → sections. Ensure 0 and dur are edges; drop <4s slivers.
  const edges = [...new Set([0, ...bounds.filter((t) => t > 2 && t < dur - 2), dur])].sort((a, b) => a - b);
  const secPerBar = bpm ? (60 / bpm) * 4 : null;
  const sections: BlueprintSection[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const startS = edges[i]!, endS = edges[i + 1]!;
    if (endS - startS < 4) continue;
    sections.push({ index: sections.length, startS, endS, bars: secPerBar ? Math.max(1, Math.round((endS - startS) / secPerBar)) : null });
  }
  if (sections.length < 2) return null; // one blob is not a structure
  const totalBars = sections.every((s) => s.bars != null) ? sections.reduce((a, s) => a + (s.bars ?? 0), 0) : null;
  const structureString =
    sections.map((s) => `S${s.index + 1} ${s.bars != null ? `${s.bars}b` : `${Math.round(s.endS - s.startS)}s`}`).join(' · ') +
    (bpm ? ` @ ${Math.round(bpm)} BPM` : '');
  return { bpm: bpm ? Math.round(bpm) : null, totalDurationS: Math.round(dur), totalBars, sections, structureString };
}

/** The prompt-side CONTRACT — injected into lyric enrichment and the engine brief. */
export function structureBrief(bp: SongBlueprint): string {
  const counts = bp.sections.map((s) => (s.bars != null ? `${s.bars} bars` : `${Math.round(s.endS - s.startS)}s`)).join(', ');
  return (
    `STRUCTURE CONTRACT — clone the skeleton, replace ALL the flesh. ` +
    `${bp.sections.length} sections${bp.bpm ? ` at ${bp.bpm} BPM` : ''}${bp.totalBars ? `, ${bp.totalBars} bars total` : ''}, ` +
    `section lengths IN ORDER: ${counts}. ` +
    `Write EXACTLY ${bp.sections.length} [Section] blocks with those bar counts (about one lyric line per bar). ` +
    `Do NOT add, remove, merge, or reorder sections. Everything INSIDE each section must be new — new words, new melody, new sound.`
  );
}

/** 0–1: how closely a rendered take's measured skeleton matches the source's. */
export function structureMatch(rendered: SongBlueprint | null, source: SongBlueprint | null): number | null {
  if (!rendered || !source) return null;
  const a = rendered.sections, b = source.sections;
  if (!a.length || !b.length) return null;
  const countScore = 1 - Math.min(1, Math.abs(a.length - b.length) / Math.max(a.length, b.length));
  const L = Math.min(a.length, b.length);
  let durScore = 0;
  for (let i = 0; i < L; i++) {
    const da = a[i]!.bars ?? a[i]!.endS - a[i]!.startS;
    const db = b[i]!.bars ?? b[i]!.endS - b[i]!.startS;
    durScore += Math.min(da, db) / Math.max(da, db, 0.001);
  }
  durScore /= L;
  const totalScore = Math.min(rendered.totalDurationS, source.totalDurationS) / Math.max(rendered.totalDurationS, source.totalDurationS, 1);
  return Math.round((0.35 * countScore + 0.45 * durScore + 0.2 * totalScore) * 100) / 100;
}

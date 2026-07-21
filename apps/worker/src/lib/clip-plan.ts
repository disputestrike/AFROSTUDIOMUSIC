/**
 * AUTO-CLIP PLANNER (Phase 2, PURE) — decides how many clips of which lengths,
 * and WHERE on the master each one starts. HOOK-FIRST by doctrine, and honest
 * about how much it really knows.
 *
 * HONEST HOOK NOTE: this planner does NOT run audio analysis to detect the hook.
 *   - When the song carries a real section map (labelled intro/verse/hook/
 *     chorus/bridge WITH timestamps), clips START on the HOOK/chorus section(s)
 *     first, then spread across the remaining distinct sections so they are not
 *     duplicates.
 *   - When there is NO section map, it falls back to a HEURISTIC: the first
 *     strong moment near the FIRST THIRD (where an Afro hook usually lands) plus
 *     evenly-spaced starts across the record. That is a PLACEMENT heuristic, not
 *     hook DETECTION — every heuristic start is tagged 'heuristic:*' so nobody
 *     mistakes it for real analysis. Better hook detection needs an audio pass
 *     (flagged as owner follow-up), never faked here.
 *
 * No ffmpeg, no Redis, no DB — so the worker test drives it directly.
 */

export type ClipKind = 'short' | 'reel' | 'tiktok';

/** A section on the MASTER-VIDEO timeline (the caller adds any splash lead-in
 *  when it maps the song's audio-time arrangement onto the cut). */
export interface ClipSection {
  name: string;
  startS: number;
}

export interface PlannedClip {
  durationS: number;
  startS: number;
  kind: ClipKind;
  /** The section this clip starts on, or a 'heuristic:*' tag when the start was
   *  placed by the no-analysis fallback. */
  sectionLabel: string;
}

export interface ClipCount {
  durationS: number;
  count: number;
}

/** Ship default: 4×15s + 3×30s + 3×60s = 10 clips. Env-tunable via CLIP_COUNTS. */
export const DEFAULT_CLIP_COUNTS: ClipCount[] = [
  { durationS: 15, count: 4 },
  { durationS: 30, count: 3 },
  { durationS: 60, count: 3 },
];

/** Parse CLIP_COUNTS ("15x4,30x3,60x3" or "15:4,30:3,60:3"). Any malformed or
 *  out-of-range entry is dropped; an empty/invalid whole value keeps the ship
 *  default so the engine always produces a sane batch. */
export function parseClipCounts(raw: string | undefined | null): ClipCount[] {
  if (!raw || !raw.trim()) return DEFAULT_CLIP_COUNTS;
  const parsed = raw
    .split(',')
    .map((part) => {
      const m = part.trim().match(/^(\d+)\s*[x:]\s*(\d+)$/i);
      if (!m) return null;
      const durationS = Number(m[1]);
      const count = Number(m[2]);
      if (
        !Number.isFinite(durationS) ||
        !Number.isFinite(count) ||
        durationS < 3 ||
        durationS > 180 ||
        count < 0 ||
        count > 30
      ) {
        return null;
      }
      return { durationS, count };
    })
    .filter((x): x is ClipCount => !!x && x.count > 0);
  return parsed.length ? parsed : DEFAULT_CLIP_COUNTS;
}

export function clipKindFor(durationS: number): ClipKind {
  if (durationS <= 15) return 'short';
  if (durationS <= 30) return 'reel';
  return 'tiktok';
}

/** Sections whose arrival is the hook (the strongest moment to open a clip on). */
const HOOK_RE = /hook|chorus|drop/i;

/** Round to ms — clip starts never need sub-ms precision and this keeps the
 *  stored/asserted numbers clean. */
const ms = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The heuristic start pool (no section map): the first-third strong moment, then
 * evenly-spaced starts across the usable runtime. Deterministic and distinct.
 */
export function heuristicStarts(totalS: number, leadInS: number, slots: number): number[] {
  const usable = Math.max(1, totalS - leadInS);
  const n = Math.max(1, slots);
  const firstThird = leadInS + usable / 3;
  const spread = [firstThird];
  for (let k = 0; k < n; k++) spread.push(leadInS + (usable * (k + 0.5)) / n);
  // Dedupe (a small master can collapse points) while preserving order.
  const seen = new Set<number>();
  const out: number[] = [];
  for (const s of spread.map((v) => ms(v))) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * Build the clip plan.
 *   - counts:   how many of each length (default 4×15 / 3×30 / 3×60).
 *   - sections: the master's section map (video-time) or null → heuristic.
 *   - leadInS:  seconds skipped at the FRONT of the master (the logo splash) so
 *               no clip opens on the splash. Bounded to <=20% of the runtime.
 * Longest clips claim the earliest (hook) starts; every clip is clamped so
 * startS + durationS <= totalDurationS and startS >= leadInS.
 */
export function planClips(opts: {
  totalDurationS: number;
  counts?: ClipCount[];
  sections?: ClipSection[] | null;
  leadInS?: number;
}): PlannedClip[] {
  const total = Math.max(1, opts.totalDurationS);
  const leadIn = Math.max(0, Math.min(opts.leadInS ?? 0, total * 0.2));
  const counts = opts.counts ?? DEFAULT_CLIP_COUNTS;

  // Flatten to a duration list, LONGEST first so 60s clips get the hook start
  // and the short 15s clips fill the remaining sections/gaps.
  const durations: number[] = [];
  for (const c of counts) for (let i = 0; i < c.count; i++) durations.push(c.durationS);
  durations.sort((a, b) => b - a);
  if (!durations.length) return [];

  const usableSections = (opts.sections ?? [])
    .filter((s) => s && Number.isFinite(s.startS) && s.startS >= 0 && s.startS < total)
    .sort((a, b) => a.startS - b.startS);

  // Ordered candidate starts: every HOOK/chorus section first, then the rest of
  // the distinct sections in time order.
  const sectionStarts: Array<{ startS: number; label: string }> = [];
  if (usableSections.length) {
    for (const s of usableSections) if (HOOK_RE.test(s.name)) sectionStarts.push({ startS: s.startS, label: s.name });
    for (const s of usableSections) if (!HOOK_RE.test(s.name)) sectionStarts.push({ startS: s.startS, label: s.name });
  }

  const heuristic = heuristicStarts(total, leadIn, durations.length);

  const plan: PlannedClip[] = [];
  for (let i = 0; i < durations.length; i++) {
    const durationS = durations[i]!;
    let chosen: { startS: number; label: string };
    if (i < sectionStarts.length) {
      chosen = sectionStarts[i]!;
    } else {
      const h = heuristic[(i - sectionStarts.length) % heuristic.length]!;
      // Tag the first heuristic clip when NO map existed as the first-third hook
      // guess; every other heuristic start is an honest even-spread.
      const label =
        !usableSections.length && i === 0 ? 'heuristic:first-third' : 'heuristic:spread';
      chosen = { startS: h, label };
    }
    // Clamp so the whole clip fits and never opens on the splash lead-in.
    const maxStart = Math.max(leadIn, total - durationS);
    const startS = Math.min(Math.max(leadIn, chosen.startS), maxStart);
    plan.push({
      durationS,
      startS: ms(startS),
      kind: clipKindFor(durationS),
      sectionLabel: chosen.label,
    });
  }
  return plan;
}

/**
 * Read a best-effort section map from a song's stored arrangement (Song.storyboard).
 * Returns AUDIO-TIME sections when a recognizable shape is present, else null —
 * honest "unknown", never invented. Accepts the tolerant shapes the arrangement
 * has taken over time:
 *   - { sections: [{ name, startS | start | atS | tS }] }
 *   - [{ name, startS }]
 *   - { sections: [{ name, bars }] } + a bpm (bars → seconds at 4/4)
 */
export function extractSongSections(
  storyboard: unknown,
  bpm?: number | null
): ClipSection[] | null {
  const rawList = Array.isArray(storyboard)
    ? storyboard
    : storyboard && typeof storyboard === 'object' && Array.isArray((storyboard as { sections?: unknown }).sections)
      ? (storyboard as { sections: unknown[] }).sections
      : null;
  if (!rawList || !rawList.length) return null;

  const barSeconds = bpm && Number.isFinite(bpm) && bpm > 0 ? (60 / bpm) * 4 : null;
  let cursor = 0;
  const out: ClipSection[] = [];
  let sawExplicit = false;
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name : typeof row.section === 'string' ? row.section : '';
    if (!name) continue;
    const explicit = [row.startS, row.start, row.atS, row.tS, row.t]
      .map((v) => Number(v))
      .find((v) => Number.isFinite(v) && v >= 0);
    if (explicit !== undefined) {
      sawExplicit = true;
      out.push({ name, startS: explicit });
      continue;
    }
    // No explicit time — fall back to accumulating bar durations when we can.
    const bars = Number(row.bars);
    if (barSeconds && Number.isFinite(bars) && bars > 0) {
      out.push({ name, startS: cursor });
      cursor += bars * barSeconds;
    }
  }
  // Only trust an explicit-time map, or a fully bar-derived one — never a
  // half-known mix that would place clips on guessed timestamps.
  if (sawExplicit) return out.filter((s) => Number.isFinite(s.startS));
  if (out.length && out.every((s) => Number.isFinite(s.startS)) && barSeconds) return out;
  return null;
}

/**
 * Wrap a caption to burn cleanly: collapse whitespace, hard-wrap to at most
 * `maxCharsPerLine`, cap at `maxLines`. drawtext does not auto-wrap, so the
 * caller pre-wraps and passes the result via a textfile.
 */
export function wrapCaption(text: string, maxCharsPerLine = 26, maxLines = 3): string {
  const words = (text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxCharsPerLine && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines).join('\n');
}

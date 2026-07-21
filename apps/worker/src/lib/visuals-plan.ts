/**
 * AUTO-VISUALS PLANNER (Phase 3, PURE) — decides how the lyric video PAGES its
 * words and which THUMBNAIL variants to render. No ffmpeg, no Redis, no DB, so
 * the worker test drives it directly.
 *
 * HONEST TIMING (the same finding as Phase 2): there is NO reliable per-line
 * lyric-to-audio timing persisted in this repo. The lyric-audio ALIGNMENT score
 * is an identity gate (did the singer sing THESE words), not timestamps; the
 * melody-score syllable timing is a compose-time artifact, never persisted as
 * per-song audio timing. So this planner does NOT fake karaoke sync. It pages
 * the lyrics EVENLY across the song duration (N lines per screen, advancing on a
 * fixed cadence = duration / page-count). True per-line sync needs a real timing
 * pass (forced alignment) — flagged as an owner follow-up, never faked here.
 *
 * VERBATIM law: the words are paged exactly as written — wrapped for the frame,
 * never reworded, never summarized.
 */

/** A section marker like "[Hook]" / "[Verse 2]" — arrangement annotation, NOT a
 *  sung lyric, so it is dropped from the lyric video (the same rule the clip
 *  caption uses when it skips `^\[` lines). */
const SECTION_MARKER_RE = /^\s*[[(](?:intro|verse|pre-?chorus|chorus|hook|bridge|outro|refrain|drop|break|interlude|ad-?lib|vamp|coda|tag)\b/i;

/**
 * Verbatim lyric lines from a stored lyric body: trimmed, blank lines dropped,
 * `[section]` markers dropped. Every surviving line is an EXACT sung line — the
 * VERBATIM law forbids rewording. Returns [] when there are no lyric lines
 * (an instrumental) — the caller then ships only the visualizer.
 */
export function parseLyricLines(body: string | null | undefined): string[] {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !SECTION_MARKER_RE.test(l) && !/^[[(].*[\])]$/.test(l));
}

/**
 * Hard-wrap ONE lyric line to at most `maxChars`, keeping EVERY word (verbatim).
 * drawtext does not auto-wrap, so the caller pre-wraps and rides the result via
 * a textfile. Unlike a caption this never DROPS words — a long line becomes
 * several display lines, all of them shown.
 */
export function wrapLyricLine(text: string, maxChars = 24): string[] {
  const words = (text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface LyricPage {
  index: number;
  /** The page's text (verbatim lyric lines, wrapped, joined with newlines). */
  text: string;
  /** EVEN-PACED window on the song timeline — NOT karaoke sync (see file head). */
  startS: number;
  endS: number;
}

export interface LyricPagePlan {
  pages: LyricPage[];
  /** Total verbatim lyric lines paged (0 = instrumental → no lyric video). */
  lineCount: number;
  /** How the timing was assigned — stated honestly for the receipt/UI. */
  timing: "even-paced";
}

/** Round to ms — page windows never need sub-ms precision. */
const ms = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Page the lyrics EVENLY across the song. `linesPerPage` source lines per
 * screen; each source line is wrapped so long lines still show in full. Page i
 * holds the timeline window [i·pageDur, (i+1)·pageDur) where pageDur =
 * duration / pageCount — a fixed cadence, NOT detected timing (see file head).
 * A per-page window is clamped to [minPageS, maxPageS] only for the RECEIPT's
 * honesty; the drawtext enable windows still tile the whole song exactly.
 */
export function planLyricPages(opts: {
  body: string | null | undefined;
  totalDurationS: number;
  linesPerPage?: number;
  maxCharsPerLine?: number;
}): LyricPagePlan {
  const lines = parseLyricLines(opts.body);
  const linesPerPage = Math.max(1, Math.min(6, opts.linesPerPage ?? 4));
  const maxChars = Math.max(12, Math.min(40, opts.maxCharsPerLine ?? 24));
  const total = Math.max(1, opts.totalDurationS);
  if (!lines.length) return { pages: [], lineCount: 0, timing: "even-paced" };

  // Group verbatim source lines into pages, wrapping each so nothing is lost.
  const grouped: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    grouped.push(lines.slice(i, i + linesPerPage));
  }
  const pageDur = total / grouped.length;
  const pages: LyricPage[] = grouped.map((group, i) => {
    const displayLines = group.flatMap((l) => wrapLyricLine(l, maxChars));
    return {
      index: i,
      text: displayLines.join("\n"),
      startS: ms(i * pageDur),
      // The LAST page runs to the very end so no gap of blank frames trails it.
      endS: ms(i === grouped.length - 1 ? total : (i + 1) * pageDur),
    };
  });
  return { pages, lineCount: lines.length, timing: "even-paced" };
}

// ---------------------------------------------------------------------------
// THUMBNAILS — 3-5 CTR stills off the cover + a bold title/hook overlay. Each
// variant differs by which text it carries (title vs hook), where the cover is
// cropped, and where the text sits — deterministic, so the same song always
// produces the same considered set.
// ---------------------------------------------------------------------------

export type ThumbCrop = "center" | "top" | "bottom";
export type ThumbTextPos = "bottom" | "top" | "center" | "none";

export interface ThumbnailVariant {
  id: string;
  /** Pre-cleaned display text (empty for the text-free "clean cover" variant). */
  text: string;
  crop: ThumbCrop;
  textPos: ThumbTextPos;
  /** A colored accent bar behind the text — one variant carries it for punch. */
  accent: boolean;
}

/** Collapse + trim a title/hook to a short, punchy thumbnail line. Never
 *  reworded — only trimmed to a sane length so the overlay stays legible. */
export function thumbnailText(raw: string | null | undefined, maxChars = 40): string {
  const cleaned = (raw ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  // Cut on a word boundary, never mid-word.
  const cut = cleaned.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Plan 3-5 thumbnail variants. The title anchors most of them; the hook (when
 * present and distinct) gives one variant a different line. A text-free "clean
 * cover" variant is always included so the artist has a pure-art option too.
 */
export function planThumbnailVariants(opts: {
  title: string;
  hook?: string | null;
  count?: number;
}): ThumbnailVariant[] {
  const title = thumbnailText(opts.title, 40);
  const hookRaw = thumbnailText(opts.hook ?? "", 40);
  const hook = hookRaw && hookRaw.toLowerCase() !== title.toLowerCase() ? hookRaw : "";
  const count = Math.max(3, Math.min(5, opts.count ?? 5));

  // The full considered set, in priority order — the title-forward CTR options
  // first, then the hook option, then the clean cover.
  const all: ThumbnailVariant[] = [
    { id: "title-bottom", text: title, crop: "center", textPos: "bottom", accent: false },
    { id: "title-top", text: title, crop: "bottom", textPos: "top", accent: true },
    { id: "hook-center", text: hook || title, crop: "top", textPos: "center", accent: false },
    { id: "title-bottom-accent", text: title, crop: "top", textPos: "bottom", accent: true },
    { id: "clean-cover", text: "", crop: "center", textPos: "none", accent: false },
  ];
  return all.slice(0, count);
}

/**
 * SINGING PIPELINE — the ONE place every render path converts a SEMANTIC
 * lyric into the SUNG form a vocalist actually delivers, before the engine
 * sings it. Wired identically into: REST generate (routes/beats.ts), chat
 * createBeatJob (services/chat-tools.ts) and the will-it-blow re-sing
 * (lib/will-it-blow.ts).
 *
 * Laws enforced here:
 * - THE OVERRIDE RULE never blocks a render: the sung form ships only when
 *   the lyric-scorecard PASSES it; a failing conversion gets exactly ONE
 *   retry (told precisely which metrics broke), and if both attempts fail
 *   the SEMANTIC form rides while the failures are recorded honestly in the
 *   job's sungForm receipt (ProviderJob.inputJson — the Truth report reads
 *   it verbatim).
 * - THE VERBATIM LAW lives in the CALLERS: artist-authored drafts never
 *   reach applySingingBrain at all — they record
 *   { applied: false, skipped: 'artist-authored — verbatim law' } instead.
 */
import { singingBrain, type SungConversion } from '@afrohit/ai';
import { scoreSungLyric, parseLyricSections, type SungLyricScore } from '@afrohit/shared';

/** The Writing Brain's craft object (LyricDraft.craftJson) — null on old drafts. */
export interface DraftCraft {
  premise?: string;
  hookCell?: string;
  anchors?: string[];
}

/** Safe reader for LyricDraft.craftJson (Json? column — any shape may be stored). */
export function craftOf(row: { craftJson?: unknown } | null | undefined): DraftCraft | null {
  const c = row?.craftJson;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const o = c as { premise?: unknown; hookCell?: unknown; anchors?: unknown };
  const anchors = Array.isArray(o.anchors) ? o.anchors.filter((a): a is string => typeof a === 'string' && !!a.trim()) : undefined;
  return {
    premise: typeof o.premise === 'string' && o.premise.trim() ? o.premise : undefined,
    hookCell: typeof o.hookCell === 'string' && o.hookCell.trim() ? o.hookCell.trim() : undefined,
    anchors: anchors?.length ? anchors : undefined,
  };
}

/** Shortest non-empty, non-header line of the text, trimmed to ≤5 words. */
function deriveHookCell(text?: string | null): string | undefined {
  if (!text?.trim()) return undefined;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[[^\]]+\]$/.test(l));
  if (!lines.length) return undefined;
  const shortest = lines.reduce((a, b) => (b.length < a.length ? b : a));
  const cell = shortest.split(/\s+/).slice(0, 5).join(' ').replace(/[.,!?;:]+$/, '').trim();
  return cell || undefined;
}

const scoreOf = (take: SungConversion, hookCell: string | undefined): SungLyricScore =>
  scoreSungLyric({ sungLyric: take.sungLyric, hookCell: hookCell ?? '', alignment: take.alignment });

export interface SungFormResult {
  /** What the engine should sing — the sung form when it PASSED, else the semantic form. */
  lyrics: string;
  /** The honest receipt for ProviderJob.inputJson (numbers/strings only — the Truth report shows it verbatim). */
  sungForm: Record<string, unknown>;
}

/**
 * Convert a semantic lyric to its measured sung form. Never throws, never
 * blocks: any failure path returns the semantic lyric with an honest record.
 */
export async function applySingingBrain(opts: {
  semanticLyric: string;
  draftCraft?: DraftCraft | null;
  /** Approved hook text — hookCell fallback when the draft has no craftJson (old drafts). */
  hookText?: string;
  genre: string;
  languages?: string[];
}): Promise<SungFormResult> {
  const { semanticLyric, draftCraft, genre, languages } = opts;
  // Hook cell priority: the Writing Brain's own cell → derived from the
  // approved hook → derived from the lyric's own [Hook] section (old drafts
  // with neither craft nor hook candidate) → undefined (scored against '' so
  // hookRecurrence fails honestly and the semantic form ships).
  const hookCell =
    draftCraft?.hookCell ||
    deriveHookCell(opts.hookText) ||
    deriveHookCell(
      parseLyricSections(semanticLyric)
        .find((s) => s.kind === 'hook')
        ?.lines.join('\n')
    ) ||
    undefined;

  const brainOpts = {
    semanticLyric,
    hookCell,
    anchors: draftCraft?.anchors,
    premise: draftCraft?.premise,
    genre,
    languages,
  };

  // A null from the brain (truncated JSON, dropped header, transient LLM blip)
  // gets ONE immediate re-ask before we give up — the first live run died on
  // exactly this and the whole stage silently sat out the render.
  let first = await singingBrain(brainOpts);
  if (!first) first = await singingBrain(brainOpts);
  if (!first) {
    return {
      lyrics: semanticLyric,
      sungForm: { applied: false, note: 'singing brain unavailable (2 attempts) — semantic form rode as-is' },
    };
  }

  let best: { take: SungConversion; score: SungLyricScore } = { take: first, score: scoreOf(first, hookCell) };
  let retries = 0;
  if (!best.score.pass) {
    // ONE retry, told exactly which laws broke — never more (cost law).
    retries = 1;
    const second = await singingBrain({
      ...brainOpts,
      sectionNotes: `PREVIOUS ATTEMPT FAILED THE SCORECARD: ${best.score.failures.join('; ')}. Fix exactly these while keeping everything else.`,
    });
    if (second) {
      const secondScore = scoreOf(second, hookCell);
      // A passing take wins; both failing → fewer failures wins (tie keeps the first).
      if (secondScore.pass || secondScore.failures.length < best.score.failures.length) {
        best = { take: second, score: secondScore };
      }
    }
  }

  const sungForm: Record<string, unknown> = {
    applied: best.score.pass,
    pass: best.score.pass,
    retries,
    metrics: best.score.metrics,
    failures: best.score.failures,
    warnings: best.score.warnings,
    alignmentCount: best.take.alignment.length,
    summary: best.take.summary,
  };
  // THE OVERRIDE RULE: ship the sung form ONLY when it measurably passes;
  // otherwise the semantic form rides and the receipt says exactly why.
  return best.score.pass ? { lyrics: best.take.sungLyric, sungForm } : { lyrics: semanticLyric, sungForm };
}

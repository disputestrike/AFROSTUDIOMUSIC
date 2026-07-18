/**
 * LEARNING AUTOMATION — proof (2026-07-17).
 *
 * Owner's law: "we have an ear, it needs to listen and fix… learn every day,
 * every night, and get better… learning that feeds and doesn't just wait." The
 * app already learned PER RENDER; three loops were measuring and then dropping
 * the signal on the floor. This pins the close of each:
 *
 *  A. REPORT CARD -> GENERATION. The nightly report card measured recurring
 *     per-lane identity gaps and only console.logged them. Now it writes them to
 *     a SystemSetting the writer reads (presong.houseGapBrief), so the next take
 *     in a weak lane is steered to fix exactly what keeps failing — and a
 *     brand-new workspace with no catalog of its own learns from the house.
 *  B. AUTO-APPLY REFILES. The refile scan only ever PROPOSED lane corrections
 *     and waited on a human ear. Now an unambiguous misfile (detected >= 80 in
 *     another lane AND <= 20 in the filed one) is MOVED on its own; the
 *     mid-confidence band still parks a proposal for /admin.
 *  C. BENCHMARK -> TASTE. The ear-vs-machine bench (a human, blind, judging our
 *     record against a real competitor — the highest-quality signal we own) died
 *     in a table. Now a validated verdict feeds the SAME taste graph a hit-read
 *     feeds (recordFeedback -> memoryContext -> generation).
 *
 * House idiom: source-invariant pins — a regression that unwires any loop trips
 * exactly the assertion naming it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const compound = read("../worker/src/processors/compound.ts");
const presong = read("src/lib/presong.ts");
const taste = read("src/routes/taste.ts");
const benchmark = read("src/routes/benchmark.ts");

// ── A. REPORT CARD -> GENERATION ────────────────────────────────────────────
assert.match(
  compound,
  /export const REPORT_CARD_GAPS_KEY = "reportcard:gaps:v1";/,
  "A: the report card exports the SystemSetting key the writer reads"
);
// It must PERSIST the measured gaps, not only log them.
assert.match(
  compound,
  /reportCardGaps\[g\] = \{/,
  "A: measured per-lane gaps are collected for persistence"
);
assert.match(
  compound,
  /where: \{ key: REPORT_CARD_GAPS_KEY \}/,
  "A: the gaps are upserted to the report-card SystemSetting"
);
// Only lanes with a REAL recurring gap are written (no empty steer).
const topGapsAt = compound.indexOf("if (topGaps.length) {");
assert.ok(topGapsAt >= 0, "A: only lanes with a recurring gap are persisted");
// Read side: the writer turns the setting into a generation steer.
assert.match(
  presong,
  /const REPORT_CARD_GAPS_KEY = 'reportcard:gaps:v1';/,
  "A: presong reads the SAME key the report card writes"
);
assert.match(
  presong,
  /export async function houseGapBrief\(genre\?: string \| null\): Promise<string>/,
  "A: houseGapBrief exists to turn the report card into a steer"
);
assert.match(
  presong,
  /STUDIO REPORT CARD — recent .* keep scoring weak on/,
  "A: the steer names the recurring gaps to fix"
);
// The thin-workspace fallback: a new account with < 3 of its own scored songs
// still gets the house's learned gaps instead of nothing.
assert.match(
  presong,
  /const houseLine = await houseGapBrief\(genre\);/,
  "A: presongIntelligence computes the house steer"
);
assert.match(
  presong,
  /if \(lane\.length < 3\) return houseLine;/,
  "A: a thin/new workspace falls back to the house's learned gaps"
);
assert.match(
  presong,
  /if \(houseLine\) parts\.push\(houseLine\);/,
  "A: an established workspace also gets the house steer appended"
);

// ── B. AUTO-APPLY REFILES ───────────────────────────────────────────────────
assert.match(
  compound,
  /REFILE_AUTO_APPLY_DETECTED \?\? 80/,
  "B: the auto-apply DETECTED floor is configurable and defaults to 80"
);
assert.match(
  compound,
  /REFILE_AUTO_APPLY_FILED \?\? 20/,
  "B: the auto-apply FILED ceiling is configurable and defaults to 20"
);
// The tier-1 branch MOVES the genre (not just stamps a status).
const autoMoveAt = compound.indexOf('status: "auto-applied"');
const genreMoveAt = compound.indexOf("genre: best!.lane", autoMoveAt - 400);
assert.ok(
  genreMoveAt >= 0 && autoMoveAt >= 0,
  "B: a tier-1 auto-move actually reassigns the reference's genre"
);
assert.match(
  compound,
  /best!\.score >= AUTO_APPLY_DETECTED &&\s*\r?\n?\s*\(filedScore \?\? 100\) <= AUTO_APPLY_FILED/,
  "B: auto-move requires BOTH a high detected score AND a low filed score"
);
// The mid-confidence band still only PROPOSES (human keeps the middle).
assert.match(
  compound,
  /else if \(misfiled && best!\.score >= 60 && \(filedScore \?\? 0\) <= 35\)/,
  "B: the mid-confidence band still parks a proposal, not a move"
);
// The ledger tells the truth now that things move on their own.
assert.match(
  compound,
  /auto-moved=\$\{autoApplied\}/,
  "B: the ledger reports how many references were auto-moved"
);
// The taste surface must not flag an already-moved row as a stale mismatch.
assert.match(
  taste,
  /refileStatus === 'auto-applied' \? null/,
  "B: an auto-applied row silences the stale detected-genre mismatch flag"
);

// ── C. BENCHMARK -> TASTE ───────────────────────────────────────────────────
assert.match(
  benchmark,
  /import \{ recordFeedback \} from "\.\.\/services\/artist-memory";/,
  "C: the bench feeds the same taste graph a hit-read feeds"
);
assert.match(
  benchmark,
  /async function feedBenchmarkTaste\(opts: \{/,
  "C: a single best-effort feed helper carries the verdict into taste"
);
// The receipt — a learning feed is real only when it's recorded.
assert.match(
  benchmark,
  /name: "benchmark\.taste_fed"/,
  "C: every taste feed writes an inspectable receipt event"
);
// /rate: a top rating on OUR OWN render approves; a bottom rating rejects.
assert.match(
  benchmark,
  /if \(b\.source === "afrohit" && b\.songId\) \{/,
  "C: only an afrohit-sourced, song-linked rating is a verdict on our record"
);
assert.match(
  benchmark,
  /if \(b\.humanRating >= 5\) \{[\s\S]*?kind: "approved"/,
  "C: a 5-star rating approves the record's hook"
);
assert.match(
  benchmark,
  /else if \(b\.humanRating <= 2\) \{[\s\S]*?kind: "rejected"/,
  "C: a 1-2 star rating rejects the record's hook"
);
// /judge: the blind A/B vs a competitor, gated on the songwriting sub-score.
assert.match(
  benchmark,
  /winner === "afrohit" && afrohitScores\.songwriting >= 4/,
  "C: beating the competitor with strong writing teaches the hook forward"
);
assert.match(
  benchmark,
  /winner === "competitor" && afrohitScores\.songwriting <= 2/,
  "C: losing to the competitor with weak writing teaches what to avoid"
);
// The feed pulls the PRIMARY hook (approved, then best-scored, then original).
assert.match(
  benchmark,
  /orderBy: \[\s*\r?\n?\s*\{ approved: "desc" \},\s*\r?\n?\s*\{ score: "desc" \}/,
  "C: the feed teaches from the record's primary hook"
);

console.log(
  "learning loops: report-card->generation, auto-apply refiles, and benchmark->taste all wired and pinned"
);

/**
 * LYRIC QUALITY FLOOR — proof (2026-07-18).
 *
 * Owner: the last song "was back to old habits" — weak/bland lyrics. A quality
 * audit found the root: the QA gate is a REJECT-FLOOR only. A lyric that dodged
 * the contamination regexes but is MEDIOCRE (band 'C' = >=3 quality warnings:
 * scenery-leaning, over-long, ad-lib-stuffed, template, English-heavy) passed
 * straight to DEMO exactly like a great record. This pins the floor being made
 * load-bearing on the live drop/chat path, plus two ungated holes closed:
 *   - band 'C' now triggers a rewrite-from-the-emotion (not just a hard REJECT)
 *   - the language-retry stage feeds the bulk-brain provenance gate too
 *   - produce.ts gates the text it ACTUALLY saves (the vocal-producer's
 *     restructured 'sung' form), falling back to the already-gated body
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const chatTools = read("src/services/chat-tools.ts");
const produce = read("../worker/src/processors/produce.ts");

// ── Band-C is load-bearing: a mediocre lyric gets rewritten, not shipped ──────
assert.match(
  chatTools,
  /for \(let fix = 0; \(!qa\.ok \|\| qa\.band === "C"\) && fix < 2; fix\+\+\)/,
  "the rewrite loop now fires on a WEAK lyric (band C), not only a hard reject"
);
assert.match(
  chatTools,
  /const weakOnly = qa\.ok && qa\.band === "C";/,
  "a passed-but-weak take is distinguished from a rejected one"
);
assert.match(
  chatTools,
  /PASSED the gate but is WEAK[\s\S]*?Rewrite from the EMOTION/,
  "the weak-lyric rewrite steers from the emotion, not the reject rubric"
);
assert.match(
  chatTools,
  /QA_FAILURES_MUST_FIX: qa\.blocks\.length \? qa\.blocks : qa\.warnings/,
  "the rewrite targets the warnings when there are no hard blocks"
);

// ── The language-retry stage feeds the provenance gate (no bulk-brain hole) ───
assert.equal(
  (chatTools.match(/onBrain: markBrain/g) ?? []).length,
  4,
  "draft, polish, qa-fix AND the language-retry all report their brain"
);

// ── produce.ts gates the text it actually persists ───────────────────────────
assert.match(
  produce,
  /if \(sung !== body\) \{\s*\r?\n?\s*const sungQa = lyricQaCheck\(\{ title, body: sung/,
  "produce.ts re-gates the vocal-producer's restructured 'sung' text"
);
assert.match(
  produce,
  /if \(!sungQa\.ok\) persistBody = body;/,
  "on a sung-only gate failure it ships the already-gated body (never ungated)"
);
assert.match(
  produce,
  /body: persistBody,/,
  "the DEMO is created from the gated text, not the raw sung form"
);
// It must NOT quarantine on a sung-only failure (legit sung forms clip words).
const sungAt = produce.indexOf("if (sung !== body)");
const nextQuarantineAt = produce.indexOf("quarantined: true", sungAt);
const createAt = produce.indexOf("prisma.lyricDraft.create", sungAt);
assert.ok(
  createAt > sungAt && (nextQuarantineAt < 0 || createAt < nextQuarantineAt),
  "a sung-only gate failure falls back to the body — it does NOT quarantine a paid record"
);

console.log(
  "lyric quality floor: band-C weak lyrics are rewritten (not shipped), the language-retry feeds provenance, and produce.ts persists only gated text"
);

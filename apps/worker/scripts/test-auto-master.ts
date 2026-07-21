/**
 * AUTO-MASTER contract test (owner: "every song has to be mastered").
 *
 * Every song-completion point must land an APPROVED Master row so the release
 * gate (which needs `master.findFirst({ approved: true })`) passes — with NO
 * user click and NO charge (own engine is free-by-owner-order; mastering is
 * LOCAL ffmpeg). This CI-able, DB-free test pins the exact wiring at all three
 * completion points so it can never silently regress:
 *
 *   (a) own-engine INSTRUMENTAL  → wraps the finished beat as an approved source
 *       Mix and runs processMaster inline → approved Master + status MASTERED
 *   (b) own-engine VOCAL         → promotes the already-mastered sung mix to an
 *       approved Master + MASTERED (not MIXED)
 *   (c) provider INSTRUMENTAL    → the inline auto-master gate no longer requires
 *       vocals; instrumentals auto-master too
 *   (d) idempotent               → never double-masters (existing-Master guard)
 *   (e) fail-soft                → a master miss never fails the render
 *   (f) release gate             → master.findFirst({ approved: true }) matches
 *       because every path shelves the Master with approved: true
 *
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-auto-master.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

const ownEngine = read("../src/processors/own-engine.ts");
const singing = read("../src/processors/afroone-singing.ts");
const music = read("../src/processors/music.ts");
const master = read("../src/processors/master.ts");
const release = read("../../api/src/routes/release.ts");

function slice(src: string, from: string, to: string, label: string): string {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `${label}: anchor not found: ${JSON.stringify(from)}`);
  const end = src.indexOf(to, start);
  assert.ok(end > start, `${label}: closing anchor not found: ${JSON.stringify(to)}`);
  return src.slice(start, end);
}

let ok = 0;
function check(cond: boolean, msg: string) {
  assert.ok(cond, msg);
  console.log("  ok:", msg);
  ok += 1;
}

// ---------------------------------------------------------------------------
// (a) OWN-ENGINE INSTRUMENTAL → approved source Mix, inline processMaster,
//     approved Master + MASTERED.
// ---------------------------------------------------------------------------
{
  const block = slice(
    ownEngine,
    "AUTO-MASTER (owner:",
    "  } catch (err) {",
    "own-engine auto-master",
  );
  check(
    ownEngine.includes('import { processMaster } from "./master";'),
    "(a) own-engine imports processMaster from the worker master processor",
  );
  check(
    /if \(p\.songId && !singing\)/.test(block),
    "(a) own-engine auto-master runs only for a song and only when NOT singing (vocal path owns its own master)",
  );
  // Wraps the finished beat as an approved 'source' Mix — the exact songs.ts:1663 shape.
  check(
    /preset: "source"/.test(block) &&
      /qualityState: "passed"/.test(block) &&
      /contentHash: beat\.contentHash/.test(block) &&
      /verifiedAt: beat\.verifiedAt/.test(block) &&
      /approved: true/.test(block),
    "(a) own-engine wraps the finished beat as an approved, passed, certified 'source' Mix",
  );
  check(
    /url: beat\.url/.test(block),
    "(a) the source Mix uses the beat's own url so its contentHash re-asserts against stored bytes",
  );
  // Runs processMaster inline with that mixId (free ffmpeg) — no credit-charged API route.
  check(
    /await processMaster\(\{/.test(block) &&
      /mixId: sourceMix\.id/.test(block) &&
      /preset: "afro_stream_-9"/.test(block),
    "(a) own-engine runs processMaster INLINE with the wrapped mixId (local ffmpeg, free)",
  );
  // processMaster shelves the approved Master and sets the song MASTERED.
  const masterCreate = slice(master, "tx.master.create", "await tx.song.update", "master create");
  check(/approved: true/.test(masterCreate), "(a) processMaster shelves the Master with approved: true");
  const songUpdate = slice(master, "await tx.song.update", "await tx.providerJob.update", "master song update");
  check(/status: 'MASTERED'/.test(songUpdate), "(a) processMaster sets Song.status = MASTERED");
}

// ---------------------------------------------------------------------------
// (b) OWN-ENGINE VOCAL → promote the already-mastered mix to an approved Master
//     + MASTERED (not MIXED).
// ---------------------------------------------------------------------------
{
  const block = slice(
    singing,
    "AUTO-MASTER (owner:",
    "const finalApproved = mix ? mix.approved : approved;",
    "afroone-singing auto-master",
  );
  // Only promotes when the chain ACTUALLY mastered and the mix passed approval
  // (honesty: a fail-open un-mastered mix is never dressed up as a Master).
  check(
    /if \(mix && finishedMix && payload\.songId && mix\.approved && vocalForward\?\.mastered\)/.test(block),
    "(b) vocal path promotes a Master only when the mix is approved AND was actually mastered",
  );
  check(
    /tx\.master\.create\(\{/.test(block) &&
      /url: finishedMix\.url/.test(block) &&
      /contentHash: finishedMix\.contentHash/.test(block) &&
      /qualityState: 'passed'/.test(block) &&
      /approved: true/.test(block),
    "(b) vocal path creates an approved Master from the already-mastered certified mix",
  );
  check(
    /path: 'own-engine-vocal'/.test(block),
    "(b) the promoted Master records its auto-master provenance",
  );
  // The song lands at MASTERED when promoted, else the prior MIXED/DEMO truth.
  check(
    /status: promotedMaster \? 'MASTERED' : mix\.approved \? 'MIXED' : 'DEMO'/.test(block),
    "(b) a promoted sung mix lands the song at MASTERED (not MIXED)",
  );
  check(
    /masterId: promotedMaster\?\.id \?\? null/.test(singing),
    "(b) the singing job output carries the promoted masterId as a receipt",
  );
}

// ---------------------------------------------------------------------------
// (c) PROVIDER INSTRUMENTAL → the inline auto-master no longer needs vocals.
// ---------------------------------------------------------------------------
{
  const gateIdx = music.indexOf("if (!placeholder && p.songId) {");
  check(gateIdx >= 0, "(c) provider auto-master gate is `!placeholder && p.songId` (instrumentals included)");
  check(
    !music.includes("if (wantsVocals && !placeholder && p.songId)"),
    "(c) the old vocals-only auto-master gate is gone",
  );
  const block = slice(
    music,
    "if (!placeholder && p.songId) {",
    "PHASE 4 — close the lane loop",
    "provider auto-master",
  );
  check(
    /tx\.master\.create\(\{/.test(block) && /approved: true/.test(block),
    "(c) the provider path shelves an approved Master for instrumentals too",
  );
  check(
    /assetKind: wantsVocals \? 'full_mix' : 'instrumental'/.test(block),
    "(c) an instrumental source Mix is tagged 'instrumental', not 'full_mix'",
  );
  check(
    /state: 'not_applicable'/.test(block),
    "(c) an instrumental carries vocalAlignment not_applicable (no fabricated vocal alignment)",
  );
}

// ---------------------------------------------------------------------------
// (d) IDEMPOTENT — never double-master.
// ---------------------------------------------------------------------------
{
  const block = slice(
    ownEngine,
    "AUTO-MASTER (owner:",
    "  } catch (err) {",
    "own-engine auto-master idempotency",
  );
  check(
    /prisma\.master\.findFirst\(\{\s*where: \{ songId: p\.songId, approved: true \}/.test(block),
    "(d) own-engine checks for an existing approved Master and skips if found",
  );
  check(
    /if \(!alreadyMastered\)/.test(block),
    "(d) the wrap+master only runs when no approved Master exists",
  );
  check(
    /const existingSource =\s*[\s\S]*?prisma\.mix\.findFirst/.test(block) &&
      /existingSource \?\?/.test(block),
    "(d) an identical approved 'source' Mix is reused rather than stacked",
  );
}

// ---------------------------------------------------------------------------
// (e) FAIL-SOFT — a master miss never fails the render.
// ---------------------------------------------------------------------------
{
  // own-engine: the hook is AFTER markSucceeded and its catch only warns.
  const succeededIdx = ownEngine.indexOf("await markSucceeded(p.jobId");
  const hookIdx = ownEngine.indexOf("AUTO-MASTER (owner:");
  check(
    succeededIdx >= 0 && hookIdx > succeededIdx,
    "(e) own-engine auto-master runs AFTER markSucceeded (the render is already committed)",
  );
  const hookCatch = slice(
    ownEngine,
    "} catch (masterErr) {",
    "  } catch (err) {",
    "own-engine auto-master catch",
  );
  check(
    hookCatch.includes("console.warn") && !/\bthrow\b/.test(hookCatch),
    "(e) own-engine auto-master swallows any master error (warn only, never throws)",
  );
  // processMaster marks only its OWN job on failure and never rethrows.
  const pmCatch = slice(master, "} catch (error) {", "\n}", "processMaster catch");
  check(
    /markFailed\(payload\.jobId, error\)/.test(pmCatch) && !/\bthrow\b/.test(pmCatch),
    "(e) processMaster marks only its own job failed and never rethrows into the caller",
  );
  // provider: instrumental auto-master miss does NOT throw (only the vocal path throws).
  const musicCatch = slice(
    music,
    "await Promise.allSettled(uncommittedMasterUrls.map",
    "PHASE 4 — close the lane loop",
    "provider auto-master catch",
  );
  check(
    /if \(wantsVocals\) \{\s*throw new Error/.test(musicCatch),
    "(e) only the VOCAL provider path throws on a master miss",
  );
  check(
    /console\.warn\(`\[music\] instrumental auto-master skipped/.test(musicCatch),
    "(e) the INSTRUMENTAL provider path warns and keeps the render (fail-soft)",
  );
}

// ---------------------------------------------------------------------------
// (f) RELEASE GATE — the exact query every path is built to satisfy.
// ---------------------------------------------------------------------------
{
  check(
    /prisma\.master\.findFirst\(\{\s*where: \{ songId: song\.id, approved: true \}/.test(release),
    "(f) the release gate matches on master.findFirst({ approved: true })",
  );
  // Every completion path shelves an approved Master → the gate query finds a row.
  const ownBlock = slice(ownEngine, "AUTO-MASTER (owner:", "  } catch (err) {", "own gate");
  const masterCreate = slice(master, "tx.master.create", "await tx.song.update", "master gate");
  const singBlock = slice(singing, "AUTO-MASTER (owner:", "const finalApproved", "sing gate");
  const provBlock = slice(music, "if (!placeholder && p.songId) {", "PHASE 4 — close the lane loop", "prov gate");
  check(
    /processMaster\(/.test(ownBlock) && /approved: true/.test(masterCreate),
    "(f) own-engine instrumental → approved Master via processMaster",
  );
  check(/approved: true/.test(singBlock), "(f) own-engine vocal → approved Master");
  check(/approved: true/.test(provBlock), "(f) provider instrumental → approved Master");
}

console.log(`\nAUTO-MASTER contract: PASS (${ok} assertions)`);

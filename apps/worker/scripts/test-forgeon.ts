/**
 * FORGEON — real-instrument forging is the AUTOMATIC DEFAULT (owner order
 * 2026-07-20, explicit + emphatic: "Turn on the forging. Let it forge always
 * automatically ... Make REAL-INSTRUMENT forging the AUTOMATIC DEFAULT").
 *
 * Root cause this build fixes (verified in own-engine.ts): the $0 synth backfill
 * used to fill the shelf FIRST — coverage went ready before any forge stage ran,
 * so auto-forge never fired and real-forge was opt-IN (OWN_ENGINE_REAL_FORGE=1).
 * Every render shipped 4 synth primitives ("one sound"). Now the lane's CORE
 * REAL KIT forges BEFORE the synth backfill whenever a Replicate token is
 * reachable (house OR workspace), and synth fills only the JOBS forging could
 * not land. Enforced forever:
 *
 *  1. DEFAULT ON, no flag — engineConnected runs whenever a Replicate token is
 *     present; OWN_ENGINE_REAL_FORGE=0 disables (opt-out), OWN_ENGINE_AUTOFORGE=0
 *     is the master kill switch; replay-locked renders never forge.
 *  2. REAL KIT BEFORE SYNTH — richMissing (requested roles + forgeKitFor(12),
 *     'fill' excluded, only roles the shelf lacks) forges BEFORE the synth
 *     backfill; synth is job-aware and fills only jobs still below the floor.
 *  3. NO DOUBLE-FORGE — a role already on the shelf is never re-forged (loops
 *     persist per lane: pay once, reuse).
 *  4. $0 TO THE USER — forge provider jobs carry no _charge; the worker never
 *     charges credits (operator's authorized Replicate spend only).
 *  5. FAIL-OPEN + DETERMINISTIC — no token → the honest full synth floor; the
 *     kit candidate list is deterministic per genre/seed.
 *  6. COST VISIBILITY — a "forge floor: N real + M synth" note rides the render.
 *
 * Source-inspection + pure-function (mirrors the own-engine predicates exactly);
 * no DB, no network. Run:
 *   pnpm --filter @afrohit/worker exec tsx scripts/test-forgeon.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forgeKitFor,
  synthKitFor,
  materialCoverage,
  isMaterialRole,
  jobOf,
  GENRE_KIT_KEYS,
} from "@afrohit/shared";
import { replicateToken } from "@afrohit/ai";
import { forgePromptFor } from "../src/lib/forge-prompts";

const ownEngineSrc = readFileSync(
  join(__dirname, "..", "src", "processors", "own-engine.ts"),
  "utf-8"
);

// ── Predicates that MIRROR own-engine.ts exactly ────────────────────────────
// The lane's core real kit the forge stage renders BEFORE synth: requested
// roles first, then forgeKitFor(12) priority, 'fill' excluded, only roles the
// shelf lacks (no double-forge), only forgeable, capped per render.
const richMissingFor = (
  genre: string,
  shelfRoles: readonly string[],
  requestedRoles: readonly string[] = [],
  cap = 8
): string[] => {
  const have = new Set(shelfRoles);
  return [...requestedRoles, ...forgeKitFor(genre, 12)]
    .filter((role, i, arr) => arr.indexOf(role) === i)
    .filter(role => role !== "fill")
    .filter(role => !have.has(role))
    .filter(role => Boolean(forgePromptFor(role, genre, 110, "A minor")))
    .slice(0, cap);
};

// The JOB-AWARE synth backfill: a coarse target is synth-forged only when the
// REAL shelf is still below the floor for that job. 'fill' + explicit requests
// always floor by exact role.
const coarseJobOf = (role: string): string | null =>
  isMaterialRole(role)
    ? jobOf(role)
    : (
        {
          drums: "rhythm",
          percussion: "rhythm",
          bass: "low_end",
          log_drum: "low_end",
          chords: "harmony",
        } as Record<string, string>
      )[role] ?? null;
const jobBelowFloor = (
  cov: ReturnType<typeof materialCoverage>,
  job: string | null
): boolean => {
  if (job === "rhythm") return cov.rhythm < 2;
  if (job === "low_end") return cov.lowEnd < 1;
  if (job === "harmony" || job === "melody") return cov.tonal < 1;
  return true;
};
const synthMissingFor = (
  genre: string,
  shelfRoles: readonly string[],
  requestedRoles: readonly string[] = []
): string[] => {
  const cov = materialCoverage(shelfRoles.map(role => ({ role })));
  const have = new Set(shelfRoles);
  const requestedSet = new Set(requestedRoles);
  const targets = [...new Set([...synthKitFor(genre), ...requestedRoles])];
  return targets.filter(role => {
    if (have.has(role)) return false;
    if (role === "fill") return true;
    if (requestedSet.has(role)) return true;
    return jobBelowFloor(cov, coarseJobOf(role));
  });
};

function main() {
  // ══ 1) DEFAULT ON, NO FLAG — token present ⇒ real forging runs ═════════════
  const savedTok = process.env.REPLICATE_API_TOKEN;
  const savedTok2 = process.env.REPLICATE_TOKEN;
  try {
    process.env.REPLICATE_API_TOKEN = "r8_house_token";
    delete process.env.REPLICATE_TOKEN;
    assert.ok(
      replicateToken(),
      "the operator's REPLICATE_API_TOKEN alone makes a forge engine reachable — NO workspace key, NO OWN_ENGINE_REAL_FORGE=1"
    );
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.REPLICATE_TOKEN;
    assert.ok(
      !replicateToken(),
      "no token ⇒ not reachable ⇒ the render falls back to the honest synth floor"
    );
  } finally {
    if (savedTok == null) delete process.env.REPLICATE_API_TOKEN;
    else process.env.REPLICATE_API_TOKEN = savedTok;
    if (savedTok2 == null) delete process.env.REPLICATE_TOKEN;
    else process.env.REPLICATE_TOKEN = savedTok2;
  }
  // The gate is default-ON: it must NOT require the old opt-in literal, and it
  // must invert to an opt-OUT plus the master kill switch, with replay excluded.
  assert.ok(
    !ownEngineSrc.includes('OWN_ENGINE_REAL_FORGE === "1"'),
    "the old opt-IN (OWN_ENGINE_REAL_FORGE === '1') is GONE — real forging is no longer gated behind a flag"
  );
  assert.ok(
    /process\.env\.OWN_ENGINE_REAL_FORGE !== "0"/.test(ownEngineSrc) &&
      /process\.env\.OWN_ENGINE_AUTOFORGE !== "0"/.test(ownEngineSrc),
    "real forge is opt-OUT (OWN_ENGINE_REAL_FORGE=0) under the master kill switch (OWN_ENGINE_AUTOFORGE=0)"
  );
  assert.ok(
    /const forgeReachable =\s*Boolean\(replicateToken\(\)\) \|\| Boolean\(workspaceForgeKey\)/.test(
      ownEngineSrc
    ),
    "reachable = the house token OR the workspace's own Replicate key"
  );
  const engineConnectedBlock = ownEngineSrc.slice(
    ownEngineSrc.indexOf("const engineConnected ="),
    ownEngineSrc.indexOf("const forgeCap =")
  );
  assert.ok(
    engineConnectedBlock.includes("!replayLocked") &&
      engineConnectedBlock.includes("forgeReachable"),
    "engineConnected excludes replay-locked renders and requires a reachable forge engine"
  );

  // ══ 2) REAL KIT FORGES BEFORE SYNTH BACKFILL ═══════════════════════════════
  const idxRichForge = ownEngineSrc.indexOf(
    "await forEachPool(richMissing, FORGE_FANOUT_CONCURRENCY"
  );
  const idxSynthBackfill = ownEngineSrc.indexOf("processSynthMaterial({");
  const idxRichDef = ownEngineSrc.indexOf(
    "const richMissing = [...requestedRoles, ...forgeKitFor(p.genre, 12)]"
  );
  assert.ok(idxRichDef > 0, "the real kit is forgeKitFor(12) with requested roles first");
  assert.ok(
    idxRichForge > 0 && idxSynthBackfill > 0 && idxRichForge < idxSynthBackfill,
    "the real-kit forge fan-out runs BEFORE the synth backfill (real instruments are the floor)"
  );
  // The synth backfill is JOB-AWARE (only fills jobs still below the floor).
  assert.ok(
    ownEngineSrc.includes("const jobBelowFloor =") &&
      ownEngineSrc.includes("realCoverage.rhythm < 2") &&
      ownEngineSrc.includes("realCoverage.lowEnd < 1") &&
      ownEngineSrc.includes("realCoverage.tonal < 1"),
    "synth backfill is gated on the real shelf being below the floor for each JOB"
  );
  // richMissing excludes 'fill' and roles the shelf already holds (no double-forge).
  const richDefBlock = ownEngineSrc.slice(idxRichDef, idxRichForge);
  assert.ok(
    richDefBlock.includes('.filter(r => r !== "fill")') &&
      richDefBlock.includes(".filter(r => !haveRoles.has(r))") &&
      richDefBlock.includes("forgePromptFor(r, p.genre, bpm, homeKey)"),
    "richMissing excludes 'fill' and already-held roles, and only forgeable roles qualify"
  );

  // ── Pure-function proof: real kit lands ⇒ synth fills only the gaps ─────────
  // afrobeats: the top-8 real kit covers rhythm/low-end/harmony, so synth adds
  // ONLY the transition fill — zero synth drums/percussion/bass/chords.
  const afroKit = richMissingFor("afrobeats", []);
  const afroCov = materialCoverage(afroKit.map(role => ({ role })));
  assert.equal(
    afroCov.ready,
    true,
    `[afrobeats] the forged real kit alone reaches the floor (beds=${afroCov.beds}, rhythm=${afroCov.rhythm}, low=${afroCov.lowEnd}, tonal=${afroCov.tonal})`
  );
  assert.deepEqual(
    synthMissingFor("afrobeats", afroKit),
    ["fill"],
    "[afrobeats] a full real kit ⇒ synth backfills ONLY the fill (no drums/percussion/bass/chords primitives)"
  );

  // gqom: the real kit carries NO tonal role (no harmony/melody in the palette),
  // so synth fills the harmony gap — and nothing else (rhythm/low-end are real).
  const gqomKit = richMissingFor("gqom", []);
  const gqomSynth = synthMissingFor("gqom", gqomKit);
  assert.ok(
    gqomSynth.includes("chords") && gqomSynth.includes("fill"),
    `[gqom] synth fills the tonal gap the real kit could not land (got ${gqomSynth.join("+")})`
  );
  for (const covered of ["drums", "percussion", "bass"]) {
    assert.ok(
      !gqomSynth.includes(covered),
      `[gqom] synth does NOT re-add '${covered}' — the real kit already covers that job`
    );
  }
  const gqomFull = materialCoverage(
    [...gqomKit, ...gqomSynth].map(role => ({ role }))
  );
  assert.equal(gqomFull.ready, true, "[gqom] real kit + synth gap-fill reaches the floor");

  // ── FALLBACK: no forge landed (token off / unreachable) ⇒ the FULL synth floor
  for (const genre of ["afrobeats", "gqom", "amapiano", "highlife"]) {
    const floor = synthMissingFor(genre, []);
    assert.deepEqual(
      [...floor].sort(),
      [...synthKitFor(genre)].sort(),
      `[${genre}] an empty shelf ⇒ the full $0 synth floor (never thinner than the baseline)`
    );
  }

  // ══ 3) NO DOUBLE-FORGE — a held role is never re-forged ═════════════════════
  const held = ["shekere", "talking_drum"];
  const afterHeld = richMissingFor("afrobeats", held);
  for (const role of held) {
    assert.ok(
      !afterHeld.includes(role),
      `a persisted '${role}' is never re-forged (pay once per lane, then reuse)`
    );
  }
  // Requested roles lead the kit (an explicit ask is forged first).
  const withRequest = richMissingFor("afrobeats", [], ["rhodes"]);
  assert.equal(withRequest[0], "rhodes", "a requested role leads the forge order");

  // ══ 4) $0 TO THE USER ══════════════════════════════════════════════════════
  const idxReal = ownEngineSrc.indexOf("const realForged: string[] = [];");
  const realBlock = ownEngineSrc.slice(idxReal, idxSynthBackfill);
  assert.ok(
    realBlock.includes('auto: "own-engine-ondemand"'),
    "the real-forge provider jobs are stamped with their origin"
  );
  assert.ok(
    !realBlock.includes("_charge"),
    "no _charge ever rides a real-forge provider job — the user pays nothing"
  );
  assert.ok(
    !ownEngineSrc.includes("chargeCredits"),
    "the worker never charges credits for own-engine forging"
  );
  // A role only counts as forged when its job receipt says SUCCEEDED (honest note).
  assert.ok(
    realBlock.includes('forged?.status === "SUCCEEDED"'),
    "a real loop counts only when its forge job receipt says SUCCEEDED (honest cost visibility)"
  );

  // ══ 5) DETERMINISTIC per genre/seed ════════════════════════════════════════
  for (const genre of ["afrobeats", "amapiano", "gqom"]) {
    assert.deepEqual(
      forgeKitFor(genre, 12),
      forgeKitFor(genre, 12),
      `[${genre}] the kit candidate list is deterministic`
    );
    assert.deepEqual(
      richMissingFor(genre, []),
      richMissingFor(genre, []),
      `[${genre}] the forge target list is deterministic`
    );
  }

  // ══ 6) COST VISIBILITY — the render note names the shape ════════════════════
  assert.ok(
    ownEngineSrc.includes("forge floor:") &&
      ownEngineSrc.includes("real instrument loop(s) forged") &&
      ownEngineSrc.includes("synth gap-filler(s)"),
    "a 'forge floor: N real + M synth' note rides the render so the operator sees what happened"
  );
  assert.ok(
    ownEngineSrc.includes("user charged $0") &&
      ownEngineSrc.includes("operator Replicate spend"),
    "the note is honest about the cost shape (operator spend, user $0)"
  );

  // ══ EVERY KIT GENRE reaches the floor with real-first + synth gap-fill ═════
  for (const genre of GENRE_KIT_KEYS) {
    const kit = richMissingFor(genre, []);
    const synth = synthMissingFor(genre, kit);
    const full = materialCoverage([...kit, ...synth].map(role => ({ role })));
    assert.equal(
      full.ready,
      true,
      `[${genre}] real kit (${kit.length}) + synth gap-fill (${synth.filter(r => r !== "fill").length}) reaches the floor`
    );
  }

  console.log(
    `forgeon: real-instrument forging is the automatic default — the lane's core real kit forges BEFORE the synth backfill whenever a Replicate token is reachable (house or workspace, no flag); synth is job-aware and fills only the jobs forging could not land (afrobeats ⇒ fill only, gqom ⇒ fill+chords); no double-forge of persisted loops; $0 to the user; deterministic per genre; ${GENRE_KIT_KEYS.length} kit genres reach the floor real-first — all enforced.`
  );
}

main();

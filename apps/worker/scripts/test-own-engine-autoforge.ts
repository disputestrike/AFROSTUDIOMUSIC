/**
 * AUTO-FORGE GATE — owner order 2026-07-19 night, enforced forever.
 *
 * When a user picks AfroOne on a shelf BELOW the material floor, the engine
 * must FORGE the missing starter material first, then assemble — instead of
 * synthesizing from nothing and dying with "assembled take failed QC (flat)".
 * Proves: (1) the pure planner reaches the floor from an empty shelf for every
 * kit genre, bounded and deterministic; (2) covered roles / 'fill' are never
 * re-planned; (3) the hard cap (8 loops) holds under any deficit; (4) at or
 * above the floor the plan is EMPTY (auto-forge never fires on a healthy
 * shelf); (5) every planned role is actually forgeable (has a real prompt);
 * (6) processOwnEngine wiring: flag default-ON ('0' disables), plan runs
 * BEFORE assembly dispatch, reuses processForgeMaterial (never a new synth),
 * success read from the job receipt, no user charge, honest disclosure, and
 * the fb9bb78 thin-shelf fallback stays intact for the OFF/failed path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_FORGE_LOOP_CAP,
  GENRE_KIT_KEYS,
  forgeKitFor,
  materialCoverage,
  planAutoForge,
  synthKitFor,
} from "@afrohit/shared";
import { forgePromptFor } from "../src/lib/forge-prompts";

delete process.env.OWN_ENGINE_MIN_BEDS;

// Mirrors the processOwnEngine call site exactly: rich kit first, coarse
// synth-kit roles as fallback (the tonal guarantee for lanes like gqom whose
// top-12 rich kit carries no harmony/melody role).
const candidatesFor = (genre: string) =>
  [...forgeKitFor(genre, 12), ...synthKitFor(genre)].filter(role =>
    Boolean(forgePromptFor(role, genre, 110, "A minor"))
  );

// ── 1) BELOW FLOOR + AUTOFORGE ON → the plan alone reaches the floor ────────
// The brand-new-user case: an EMPTY shelf. For every genre with a kit, the
// planner must name a bounded starter set whose coverage is READY — the exact
// set processOwnEngine forges before dispatching assembly.
for (const genre of GENRE_KIT_KEYS) {
  const empty = materialCoverage([]);
  assert.equal(empty.ready, false, "an empty shelf is below the floor");
  const plan = planAutoForge({
    coverage: empty,
    coveredRoles: [],
    candidateRoles: candidatesFor(genre),
  });
  assert.ok(plan.length > 0, `[${genre}] below-floor must plan a forge`);
  assert.ok(
    plan.length <= AUTO_FORGE_LOOP_CAP,
    `[${genre}] plan of ${plan.length} exceeds the ${AUTO_FORGE_LOOP_CAP}-loop cap`
  );
  assert.equal(
    new Set(plan).size,
    plan.length,
    `[${genre}] plan repeats a role`
  );
  assert.ok(!plan.includes("fill"), `[${genre}] a fill is not a bed`);
  const after = materialCoverage(plan.map(role => ({ role })));
  assert.equal(
    after.ready,
    true,
    `[${genre}] plan must reach the floor (got beds=${after.beds}, rhythm=${after.rhythm}, low=${after.lowEnd}, tonal=${after.tonal} from ${plan.join("+")})`
  );
  for (const role of plan) {
    assert.ok(
      Boolean(forgePromptFor(role, genre, 110, "A minor")),
      `[${genre}] planned role '${role}' has no forge prompt — unforgeable`
    );
  }
}

// ── 2) PARTIAL SHELF: only the missing jobs are forged, never what's owned ──
const covered = ["drums", "percussion", "chords"]; // rhythm=2, tonal=1, low=0, beds=3
const partial = materialCoverage(covered.map(role => ({ role })));
assert.equal(partial.ready, false, "3 beds without low end is below the floor");
const partialPlan = planAutoForge({
  coverage: partial,
  coveredRoles: covered,
  candidateRoles: candidatesFor("afrobeats"),
});
assert.equal(
  partialPlan.length,
  1,
  `only the low-end gap needs forging (got ${partialPlan.join("+")})`
);
for (const role of partialPlan) {
  assert.ok(!covered.includes(role), `'${role}' is already covered — wasteful`);
}
const combined = materialCoverage(
  [...covered, ...partialPlan].map(role => ({ role }))
);
assert.equal(combined.ready, true, "covered + planned reaches the floor");
assert.ok(combined.lowEnd >= 1, "the planned role fills the low-end gap");

// ── 3) THE HARD CAP holds under any deficit ─────────────────────────────────
process.env.OWN_ENGINE_MIN_BEDS = "30";
const deep = materialCoverage([]);
assert.equal(deep.minBeds, 30, "env floor honored for the cap scenario");
const capped = planAutoForge({
  coverage: deep,
  coveredRoles: [],
  candidateRoles: candidatesFor("afrobeats"),
});
assert.equal(
  capped.length,
  AUTO_FORGE_LOOP_CAP,
  `a 30-bed deficit still caps at ${AUTO_FORGE_LOOP_CAP} loops (got ${capped.length})`
);
const overCap = planAutoForge({
  coverage: deep,
  coveredRoles: [],
  candidateRoles: candidatesFor("afrobeats"),
  cap: 99,
});
assert.ok(
  overCap.length <= AUTO_FORGE_LOOP_CAP,
  "a caller can never raise the cap past the hard ceiling"
);
const tightCap = planAutoForge({
  coverage: deep,
  coveredRoles: [],
  candidateRoles: candidatesFor("afrobeats"),
  cap: 3,
});
assert.equal(tightCap.length, 3, "a tighter caller cap is respected");
delete process.env.OWN_ENGINE_MIN_BEDS;

// ── 4) AT/ABOVE THE FLOOR the plan is empty — auto-forge never fires ────────
const healthy = materialCoverage(synthKitFor("afrobeats").map(role => ({ role })));
assert.equal(healthy.ready, true, "the synth floor is a healthy shelf");
assert.equal(
  planAutoForge({
    coverage: healthy,
    coveredRoles: synthKitFor("afrobeats"),
    candidateRoles: candidatesFor("afrobeats"),
  }).length,
  0,
  "a ready shelf plans nothing"
);

// ── 5) WIRING: processOwnEngine forges BEFORE assembly, flag-gated, honest ──
const ownEngineSrc = readFileSync(
  join(__dirname, "..", "src", "processors", "own-engine.ts"),
  "utf-8"
);
const materialSrc = readFileSync(
  join(__dirname, "..", "src", "processors", "material.ts"),
  "utf-8"
);

// Flag: default ON, only the literal '0' disables; replay receipts never forge.
assert.ok(
  /!coverage\.ready &&\s*!replayLocked &&\s*process\.env\.OWN_ENGINE_AUTOFORGE !== "0"/.test(
    ownEngineSrc
  ),
  "auto-forge is gated on below-floor + not-replay + OWN_ENGINE_AUTOFORGE !== '0' (default ON)"
);

// Order: the plan and the forging run BEFORE the assembly child is dispatched.
const idxPlan = ownEngineSrc.indexOf("planAutoForge({");
const idxAssemble = ownEngineSrc.indexOf("processAssembleBeat({");
assert.ok(idxPlan > 0, "processOwnEngine calls planAutoForge");
assert.ok(
  idxAssemble > idxPlan,
  "auto-forge runs BEFORE the grid-assembly dispatch"
);
const branch = ownEngineSrc.slice(idxPlan, idxAssemble);

// Reuse, not reinvention: the branch calls the EXISTING kit-driven forge and
// selects candidates from the SAME forgeKitFor(genre, 12) list pickKit uses,
// so a landed loop is always re-selectable.
assert.ok(
  branch.includes("processForgeMaterial({"),
  "auto-forge reuses processForgeMaterial — never a new synth"
);
assert.ok(
  branch.includes("forgeKitFor(p.genre, 12)"),
  "candidates come from the SAME top-12 kit list pickKit selects with"
);

// Receipts, not vibes: forge success is read from the job row (the forge
// processor marks its own job and never rethrows).
assert.ok(
  branch.includes('=== "SUCCEEDED") autoForgedRoles.push(role)'),
  "a role only counts as forged when its job receipt says SUCCEEDED"
);

// Free by owner order: the auto-forge provider jobs carry no user charge.
assert.ok(
  branch.includes('auto: "own-engine-autoforge"'),
  "auto-forge jobs are stamped with their origin"
);
assert.ok(
  !branch.includes("_charge"),
  "no _charge ever rides an auto-forge provider job — the user pays nothing"
);
assert.ok(
  !ownEngineSrc.includes("chargeCredits"),
  "the worker never charges credits for own-engine forging"
);

// Honest disclosure: the render notes + beat meta name what was forged.
assert.ok(
  ownEngineSrc.includes("upload your own kit to make it yours"),
  "the forged-starter disclosure rides the render"
);

// The fb9bb78 fallback stays intact for OFF/failed: sparse-shelf honest note,
// terminal shelf-class failures, and the QC error that names the fix.
assert.ok(
  ownEngineSrc.includes("sparse shelf: rendered from"),
  "the sparse-shelf honest note remains the fallback"
);
assert.ok(
  ownEngineSrc.includes("shelf is too thin|no bed material"),
  "shelf-class failures remain terminal (no wasted retries)"
);
assert.ok(
  materialSrc.includes(
    "your shelf is too thin to build from: upload a kit or forge starter material"
  ),
  "the thin-shelf QC failure still names the fix"
);

console.log(
  `own-engine auto-forge: ${GENRE_KIT_KEYS.length} kit genres reach the floor from an empty shelf, bounded at ${AUTO_FORGE_LOOP_CAP} loops; covered roles never re-forged; healthy shelves plan nothing; wiring proven (flag default ON, forge-before-assembly, job-receipt success, $0 to the user, honest fallback intact).`
);

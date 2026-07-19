/**
 * ADDENDUM §1.11 — THE WALL, acceptance tests (W-2 + W-1 mapping + C-1 gate).
 * Pure-function tests: the routing law must hold in code, not policy.
 */
import {
  engineClass,
  resolveEngineForWorkspace,
  isFirstPartyWorkspace,
  recommendEngine,
  referenceOrigin,
  groundingOf,
  describeGrounding,
  promotionEligible,
  buildLicenseCertificate,
  validateDatasetManifest,
  priorAnalyses,
  buildLaneProfile,
  scoreLaneCompliance,
  planRepairs,
  type MeasuredAnalysis,
} from "@afrohit/shared";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  calibrationGateStatus,
  LOGDRUM_CALIBRATION_SCHEMA_VERSION,
} from "../src/lib/ear-corpus";

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) fail++;
};

// W-2: a customer workspace forcing suno is hard-substituted to a resellable engine
const customer = resolveEngineForWorkspace("suno", {
  firstParty: false,
  sunoAvailable: true,
  replicateAvailable: true,
  falAvailable: false, // legacy ladder pinned explicitly (env-independent test)
});
check(
  "customer + suno forced → resellable engine",
  customer.engine === "minimax"
);
check(
  "customer + suno forced → substitution logged flag",
  customer.wallSubstituted === true
);

// OWNER ORDER 2026-07-19: fal connected → the open ACE-Step is the default
// singer, and the suno wall substitutes to it (still resellable, cheaper).
// BAKE-OFF VERDICT (owner's ear, 2026-07-19 evening): minimax holds the
// default singer even with fal connected — the tuned ACE-Step take passed the
// lyric gate but failed the owner's listen. ACE-Step stays explicit-pickable
// (dual-route) and is the default only when it is the ONLY route left.
const falDefault = resolveEngineForWorkspace(undefined, {
  firstParty: false,
  sunoAvailable: false,
  replicateAvailable: true,
  falAvailable: true,
});
check("fal connected + replicate → minimax still the default singer", falDefault.engine === "minimax");
const falWall = resolveEngineForWorkspace("suno", {
  firstParty: false,
  sunoAvailable: true,
  replicateAvailable: true,
  falAvailable: true,
});
check("customer + suno + fal → wall-substituted to minimax", falWall.engine === "minimax" && falWall.wallSubstituted === true);
const falLastResort = resolveEngineForWorkspace(undefined, {
  firstParty: false,
  sunoAvailable: false,
  replicateAvailable: false,
  falAvailable: true,
});
check("fal as the ONLY route → ace_step is the last-resort default", falLastResort.engine === "ace_step");
const falOnly = resolveEngineForWorkspace("ace_step", {
  firstParty: false,
  sunoAvailable: false,
  replicateAvailable: false,
  falAvailable: true,
});
check("ace_step is dual-route: fal alone satisfies an explicit pick", falOnly.engine === "ace_step");

// W-2: first-party keeps the bridge
const fp = resolveEngineForWorkspace("suno", {
  firstParty: true,
  sunoAvailable: true,
});
check(
  "first-party + suno → bridge allowed",
  fp.engine === "suno" && !fp.wallSubstituted
);

// W-2: no suno key → graceful fallback, not a wall event
const nokey = resolveEngineForWorkspace("suno", {
  firstParty: true,
  sunoAvailable: false,
});
check(
  "first-party + suno, no key → unavailable without wall flag",
  nokey.engine === "unavailable" && !nokey.wallSubstituted
);

const approved = resolveEngineForWorkspace(undefined, {
  firstParty: false,
  sunoAvailable: false,
  elevenAvailable: true,
  replicateAvailable: false,
});
check(
  "customer auto route prefers connected approved engine",
  approved.engine === "eleven"
);
const none = resolveEngineForWorkspace(undefined, {
  firstParty: false,
  sunoAvailable: false,
  elevenAvailable: false,
  replicateAvailable: false,
});
check(
  "no connected customer-safe engine → unavailable",
  none.engine === "unavailable"
);

// W-2: default engine for a customer never lands on the bridge
const cdef = resolveEngineForWorkspace(undefined, {
  firstParty: false,
  sunoAvailable: true,
  replicateAvailable: true,
});
check("customer default never bridge", cdef.engine !== "suno");

// W-2: recommendEngine never returns suno for non-first-party
check(
  "recommendEngine customer → not suno",
  recommendEngine("amapiano", {
    sunoAvailable: true,
    replicateAvailable: true,
    firstParty: false,
  }).engine !== "suno"
);
check(
  "recommendEngine first-party → suno when available",
  recommendEngine("amapiano", {
    sunoAvailable: true,
    replicateAvailable: true,
    firstParty: true,
  }).engine === "suno"
);

// W-1: class mapping is the single public vocabulary
check("engineClass suno=flagship", engineClass("suno") === "flagship");
check(
  "engineClass eleven=standard until commercial certification",
  engineClass("eleven") === "standard"
);
check("engineClass afrohit-own=own", engineClass("afrohit-own") === "own");
check(
  "engineClass minimax/ace/replicate=standard",
  engineClass("minimax") === "standard" &&
    engineClass("ace_step") === "standard" &&
    engineClass("replicate") === "standard"
);
check(
  "engineClass unknown/stub/unavailable fail closed",
  engineClass("unknown") === "unavailable" &&
    engineClass("stub") === "unavailable" &&
    engineClass("unavailable") === "unavailable"
);

// W-2: first-party resolution — internal mode is first-party; multi-tenant needs the list
check(
  "internal mode = first-party",
  isFirstPartyWorkspace("anyws", { AUTH_MODE: "internal" })
);
check(
  "multi-tenant unlisted = customer",
  !isFirstPartyWorkspace("ws_b", {
    AUTH_MODE: "clerk",
    FIRST_PARTY_WORKSPACE_IDS: "ws_a",
  })
);
check(
  "multi-tenant listed = first-party",
  isFirstPartyWorkspace("ws_a", {
    AUTH_MODE: "clerk",
    FIRST_PARTY_WORKSPACE_IDS: "ws_a, ws_x",
  })
);

// C-1: synthetic, unsigned, unbalanced, or rights-unverified evidence cannot
// open the measured DSP gate. A real artifact also requires the runtime secret.
const calPath = join(
  __dirname,
  "..",
  "py",
  "fixtures",
  "logdrum_calibration.json"
);
if (existsSync(calPath)) {
  const cal = JSON.parse(readFileSync(calPath, "utf-8")) as Record<
    string,
    unknown
  >;
  const signingKey = process.env.LOGDRUM_CALIBRATION_SIGNING_KEY;
  const gate = calibrationGateStatus(cal, signingKey);
  if (cal.provenance === "real-9track" && signingKey) {
    check("C-1: signed rights-clean real artifact opens the gate", gate.open);
  } else {
    check(
      `C-1: ${String(cal.provenance ?? "missing")} artifact keeps gate shut`,
      !gate.open
    );
  }
  check(
    "C-1: artifact schema is current",
    cal.schemaVersion === LOGDRUM_CALIBRATION_SCHEMA_VERSION
  );
  check(
    "C-1: artifact carries explicit rights truth",
    typeof cal.rightsVerified === "boolean"
  );
} else {
  check("C-1: no artifact = gate shut (uncalibrated)", true);
}
// C-2: origin classification + grounding rule
check(
  "origin: generated recipe = self",
  referenceOrigin("https://r2/x.wav", { source: "generated" }) ===
    "self-generated"
);
check(
  "origin: facts: prefix = facts-only",
  referenceOrigin("facts:https://r2/y.wav", {}) === "facts-only"
);
check(
  "origin: attested upload = owned",
  referenceOrigin("https://r2/z.wav", {}, "user-attested") === "owned-upload"
);
check(
  "origin: unclassified URL = unknown",
  referenceOrigin("https://outside/z.wav", {}) === "unknown"
);
const unground = groundingOf([
  { origin: "owned-upload" },
  { origin: "self-generated" },
  { origin: "self-generated" },
  { origin: "self-generated" },
]);
check(
  "C-2: 1 external + 3 self = NOT grounded (self cannot bootstrap)",
  !unground.grounded
);
check(
  "C-2: ungrounded line names the lock",
  describeGrounding(unground).includes("self-promotion locked")
);
const ground = groundingOf([
  { origin: "owned-upload" },
  { origin: "facts-only" },
  { origin: "facts-only" },
  { origin: "self-generated" },
]);
check("C-2: 3 non-self (1 owned + 2 facts) = grounded", ground.grounded);
check(
  "C-2: grounded line prints external + self split",
  describeGrounding(ground).includes("3 external + 1 self")
);

// C-3 KNOCK-ON: a previously-measured self take (85/0.85) is NOT promotable
// while its lane is expert-prior — and becomes promotable, with ZERO
// re-rendering, the moment the lane grounds (e.g. re-filed refs reclaimed).
check(
  "C-3: take 85/0.85 on UNgrounded lane → held on the gap map only",
  !promotionEligible({ laneScore: 85, coverage: 0.85, grounded: false })
);
check(
  "C-3: SAME take once lane grounds → promotable retroactively",
  promotionEligible({ laneScore: 85, coverage: 0.85, grounded: true })
);
check(
  "C-3: grounded but below bar (65) → still not promoted",
  !promotionEligible({ laneScore: 65, coverage: 0.85, grounded: true })
);
check(
  "C-3: grounded, high score, thin coverage (0.5) → not promoted",
  !promotionEligible({ laneScore: 90, coverage: 0.5, grounded: true })
);
check(
  "C-3: unmeasured can never promote",
  !promotionEligible({ laneScore: null, coverage: null, grounded: true })
);

// LIVE-DATA hotfix — the expert-prior fourOnFloor inversion (caught on the gap
// map: 'drop the four-on-floor' told to amapiano, and EVERY take scoring 0 on
// the dim). Priors now emit the boolean; scoring + repair must both be sane.
{
  const priors = priorAnalyses("amapiano");
  const profile = buildLaneProfile("amapiano", "genre", priors, { minRefs: 1 });
  const broken = JSON.parse(JSON.stringify(priors[1])) as MeasuredAnalysis;
  (broken as unknown as { fourOnFloor: { value: boolean } }).fourOnFloor.value =
    false;
  const badScore = scoreLaneCompliance(broken, profile);
  const fofBad = badScore.dimensions.find(d => d.key === "fourOnFloor");
  check(
    "prior-fix: amapiano take WITHOUT 4x4 fails the dim",
    fofBad?.status === "out-of-lane"
  );
  const repair = planRepairs(badScore).repairs.find(
    r => r.key === "fourOnFloor"
  );
  check(
    "prior-fix: repair says ADD four-on-floor (was inverted!)",
    repair?.direction === "add" &&
      /FOUR-ON-FLOOR/i.test(repair?.instruction ?? "")
  );
  const good = priors[1]!;
  const fofGood = scoreLaneCompliance(good, profile).dimensions.find(
    d => d.key === "fourOnFloor"
  );
  check(
    "prior-fix: a CORRECT 4x4 take is in-lane on the dim (was scoring 0)",
    fofGood?.status === "in-lane"
  );
}

// W-3: certificates — class-only, bridge never certifiable, standard = pass-through
const certOk = buildLicenseCertificate({
  songId: "s1",
  workspaceId: "w1",
  engineClass: "certified-clean",
  issuedAt: "2026-07-10",
  certificateId: "c1",
});
check("W-3: certified-clean is certifiable", certOk.ok === true);
check(
  "W-3: certificate carries NO vendor name",
  certOk.ok &&
    !/suno|eleven|minimax|ace[_-]?step|replicate|stable[_ ]?audio/i.test(
      JSON.stringify(certOk.certificate)
    )
);
check(
  "W-3: bridge render never certifiable",
  buildLicenseCertificate({
    songId: "s1",
    workspaceId: "w1",
    engineClass: "flagship",
    issuedAt: "x",
    certificateId: "c",
  }).ok === false
);
check(
  "W-3: standard = pass-through terms, no certificate",
  buildLicenseCertificate({
    songId: "s1",
    workspaceId: "w1",
    engineClass: "standard",
    issuedAt: "x",
    certificateId: "c",
  }).ok === false
);
check(
  "W-3: unavailable = no certificate",
  buildLicenseCertificate({
    songId: "s1",
    workspaceId: "w1",
    engineClass: "unavailable",
    issuedAt: "x",
    certificateId: "c",
  }).ok === false
);

// W-5: dataset provenance — third-party origins fail the build with reasons
const manifest = validateDatasetManifest([
  { id: "001", origin: "own-master" },
  { id: "002", origin: "licensed-catalog" },
  { id: "003", origin: "bridge" },
  { id: "004" },
]);
check(
  "W-5: clean origins pass, bridge + missing rejected",
  !manifest.ok && manifest.rejected.length === 2
);
check(
  "W-5: rejection reasons printed",
  manifest.rejected.every(r => r.includes("track"))
);

console.log(fail === 0 ? "\nALL GREEN" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { characterSheetPrompt, decorateTreatmentShotsForRender, missingDuetLeads, normalizeStoryboardShots, performersFromVoice, videoRenderUsage } from "@afrohit/shared";

// THE CAST LAW (2026-07-17, owner feedback: the rendered cast defaulted to
// engine training-set bias). Both video brains must direct the cast
// EXPLICITLY in every shot prompt — pin the law in BOTH prompts so no
// rewrite can silently drop it.
{
  const prompts = readFileSync(
    join(process.cwd(), "../../packages/ai/src/prompts/storyboard.ts"),
    "utf8"
  );
  const castLawCount = (prompts.match(/THE CAST LAW/g) ?? []).length;
  assert.ok(
    castLawCount >= 2,
    "the cast law must live in BOTH video brains (treatment + legacy)"
  );
  assert.match(prompts, /Black African by\s+default/);
  assert.match(prompts, /EVERY shot's "prompt" states the cast explicitly/);
  assert.match(prompts, /unstated cast is a WRONG cast/);
}

const normalized = normalizeStoryboardShots(
  [
    { prompt: " first shot ", duration_s: 1 },
    { prompt: "", duration_s: 12 },
    { prompt: "second", duration_s: 5, subjects: ["lead", "", 42] },
    { prompt: "third", duration_s: 99 },
    { prompt: "fourth", duration_s: 3 },
  ],
  20
);
assert.deepEqual(
  normalized.map(shot => shot.duration_s),
  [4, 8, 8],
  "durations should use provider-supported values within the approved total"
);
assert.equal(
  normalized.reduce((sum, shot) => sum + shot.duration_s, 0),
  20
);
assert.deepEqual(normalized[1]!.subjects, ["lead"]);
assert.deepEqual(
  normalized.map(shot => shot.index),
  [0, 1, 2]
);

// OWNER-APPROVED PER-SCENE PRICING: no engine class → bills as 'standard'
// ($2.00/scene); billingUnits = scenes, planUnits still meter provider
// seconds for the plan caps. (Legacy video_8s/video_20s keys survive only
// for historical ledger rows — never for a new charge.)
const fanOut = videoRenderUsage(
  Array.from({ length: 6 }, () => ({ duration_s: 1 }))
);
assert.deepEqual(fanOut, {
  creditKey: "video_shot_standard",
  billingUnits: 6,
  planUnits: 24,
  shotCount: 6,
});

const single = videoRenderUsage(normalized, 0);
assert.deepEqual(single, {
  creditKey: "video_shot_standard",
  billingUnits: 1,
  planUnits: 4,
  shotCount: 1,
});
assert.equal(
  videoRenderUsage(normalized, 0, "draft")!.creditKey,
  "video_shot_draft"
);
assert.equal(
  videoRenderUsage(normalized, 0, "flagship")!.creditKey,
  "video_shot_flagship"
);
assert.equal(videoRenderUsage(normalized, 99), null);
assert.equal(
  videoRenderUsage(Array.from({ length: 16 }, () => ({ duration_s: 4 }))),
  null
);

console.log("video storyboard: normalization and shot-aware billing passed");

// PERFORMER ROSTER LAW (2026-07-17, duet incident: the female singer never
// appeared). Pure laws under test: voice → roster mapping, and the duet gate
// that rejects a plan which forgot a lead BEFORE a cent is spent.
{
  assert.deepEqual(performersFromVoice("duet"), {
    mode: "duet",
    roster: [
      { id: "LEAD_A", vocal: "female" },
      { id: "LEAD_B", vocal: "male" },
    ],
  });
  assert.deepEqual(performersFromVoice("female").roster, [{ id: "LEAD_A", vocal: "female" }]);
  assert.equal(performersFromVoice("auto").mode, "unknown");
  assert.equal(performersFromVoice(null).roster.length, 0);

  const duet = performersFromVoice("duet");
  // The exact live failure: one male lead throughout, no female anywhere.
  const oneManShow = {
    castingNotes: "LEAD_B — the male lead: a Nigerian man in a leather jacket",
    sequences: [{ performers: ["LEAD_B"] }, {}],
    shots: [{ prompt: "the man walks Lagos streets at dusk" }],
  };
  assert.deepEqual(
    missingDuetLeads(duet, oneManShow),
    ["LEAD_A"],
    "a duet plan without the female lead must be rejected"
  );
  // A proper duet plan passes.
  const properDuet = {
    castingNotes:
      "LEAD_A — the female lead: dark-skinned Nigerian woman, gold braids. LEAD_B — the male lead: tall man in agbada.",
    sequences: [{ performers: ["LEAD_A"] }, { performers: ["LEAD_A", "LEAD_B"] }],
    shots: [
      { prompt: "LEAD_A sings under neon rain" },
      { prompt: "LEAD_A and LEAD_B share the frame on the hook" },
    ],
  };
  assert.deepEqual(missingDuetLeads(duet, properDuet), []);
  // Solo plans never trip the duet gate.
  assert.deepEqual(missingDuetLeads(performersFromVoice("female"), oneManShow), []);
  console.log("performer roster law: voice mapping and the duet gate hold");
}

// PACKAGE B — SAME FACES ALL VIDEO (pure laws): continuity folds into every
// shot prompt, the sequence's fronting lead rides each shot, and the
// character-sheet prompt locks onto the lead's own castingNotes line.
{
  const storyboard = {
    kind: "treatment",
    concept: "test",
    logline: "test",
    motifs: [],
    structureSource: "assumed",
    durationS: 20,
    sequences: [
      { index: 0, label: "Intro", startS: 0, endS: 10, continuity: "gold chain and red jacket carry through", performers: ["LEAD_B"], shotIndexes: [0] },
      { index: 1, label: "Hook", startS: 10, endS: 20, performers: ["LEAD_A", "LEAD_B"], shotIndexes: [1] },
    ],
    shots: [
      { index: 0, sequenceIndex: 0, prompt: "the man walks in", duration_s: 4 },
      { index: 1, sequenceIndex: 1, prompt: "both leads share the frame", duration_s: 4 },
    ],
    teaserCut: { durationS: 15, format: "vertical", shotRefs: [1] },
  };
  const decorated = decorateTreatmentShotsForRender(
    storyboard,
    storyboard.shots as never
  );
  assert.match(decorated[0]!.prompt, /Continuity: gold chain and red jacket/);
  assert.equal(decorated[0]!.lead, "LEAD_B", "the sequence's fronting lead rides the shot");
  assert.equal(decorated[1]!.lead, "LEAD_A");
  assert.ok(!decorated[1]!.prompt.includes("Continuity:"), "no continuity text → no fold");
  // Legacy storyboards (no treatment) pass through untouched.
  const legacy = decorateTreatmentShotsForRender([{ index: 0, prompt: "x", duration_s: 4 }], [
    { index: 0, prompt: "x", duration_s: 4 },
  ] as never);
  assert.equal(legacy[0]!.prompt, "x");

  const sheet = characterSheetPrompt(
    "LEAD_A — the female lead: dark-skinned Nigerian woman, gold braids. LEAD_B — the male lead: tall man in agbada.",
    "LEAD_A"
  );
  assert.match(sheet, /female lead: dark-skinned Nigerian woman/);
  assert.match(sheet, /One person only/);
  assert.doesNotMatch(sheet.split("World:")[0]!, /LEAD_B — the male lead/, "the portrait frames ONE lead");
  console.log("package B laws: continuity fold, fronting lead, and sheet prompts hold");
}

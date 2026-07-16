// Pure proof for the FULL-SONG TREATMENT normalizer (packages/shared/src/
// video-storyboard.ts) — the creative-director rebuild. Runs against the
// compiled @afrohit/shared dist (build shared first: pnpm --filter
// @afrohit/shared build), no HTTP, no DB, no AI keys.
//
//   node scripts/test-video-treatment.mjs
import assert from "node:assert/strict";
import {
  MAX_TREATMENT_SHOTS,
  assumedThreeActSections,
  normalizeVideoTreatment,
  storyboardShots,
  treatmentSectionsFromBoundaries,
  videoRenderUsage,
  videoTreatmentOf,
} from "../packages/shared/dist/index.js";

// ---- Section building from MEASURED boundaries -----------------------------
{
  const sections = treatmentSectionsFromBoundaries(210, [12, 40, 70, 100, 130, 160, 190]);
  assert.equal(sections.length, 8, "8 measured segments");
  assert.equal(sections[0].label, "Intro");
  assert.equal(sections.at(-1).label, "Outro");
  assert.equal(sections[0].startS, 0);
  assert.equal(sections.at(-1).endS, 210, "sections tile the full song");
  for (let i = 1; i < sections.length; i++) {
    assert.equal(sections[i].startS, sections[i - 1].endS, "contiguous sections");
  }
  // Sliver boundaries merge; boundary spam cannot explode the sequence count.
  const spam = treatmentSectionsFromBoundaries(
    240,
    Array.from({ length: 79 }, (_, i) => (i + 1) * 3)
  );
  assert.ok(spam.length <= 12, `sections capped (got ${spam.length})`);
  assert.equal(spam.at(-1).endS, 240);

  const acts = assumedThreeActSections(180);
  assert.equal(acts.length, 3, "assumed fallback is a 3-act arc");
  assert.equal(acts.at(-1).endS, 180);
  assert.equal(assumedThreeActSections(15).length, 1, "tiny duration = one passage");
}

// ---- Full treatment normalization: caps, clamps, timing distrust -----------
const sections = treatmentSectionsFromBoundaries(200, [20, 60, 90, 130, 160]);
const modelOutput = {
  title: "Model Title",
  concept: "  A city that only lights up when she sings  ",
  logline: "One night, one voice, one grid of light.",
  visualWorld: "Lagos at blue hour, sodium lamps, wet asphalt",
  motifs: ["light", "wire", "water", "gold", "dust", "EXTRA", "EXTRA2"],
  colorStory: "cold city into warm gold",
  castingNotes: "female lead, matching the declared vocalist",
  balance: "60% narrative / 40% performance",
  sequences: sections.map((section, i) => ({
    sectionIndex: i,
    // Hostile timing — the model tries to claim its own clock. Must be IGNORED.
    startS: 999 + i,
    endS: 5_000 + i,
    intent: `intent ${i}`,
    setting: `setting ${i}`,
    continuity: `continuity ${i}`,
    shots: Array.from({ length: 9 }, (_, s) => ({
      prompt: `sequence ${i} shot ${s}`,
      durationS: s === 0 ? 0.4 : s === 1 ? 99 : 5, // clamp band 2-8
      motion: "slow push-in",
      lighting: "neon night",
      subjects: ["the performer", "", 42],
    })),
  })),
  teaserCut: {
    durationS: 22, // snaps to 15 (only 15|30 allowed, <23 → 15)
    format: "landscape", // forced vertical
    shotRefs: [0, 0, 3, 999, -1, "7"],
    hookMoment: "the first grid-wide blackout on the hook",
  },
};
const treatment = normalizeVideoTreatment(modelOutput, {
  durationS: 200,
  sections,
  structureSource: "measured",
});
assert.ok(treatment, "valid model output normalizes");
assert.equal(treatment.kind, "treatment");
assert.equal(treatment.concept, "A city that only lights up when she sings");
assert.equal(treatment.motifs.length, 5, "motifs capped at 5");
assert.equal(treatment.structureSource, "measured");
assert.equal(treatment.sequences.length, sections.length, "sequences map 1:1 to sections");
assert.ok(
  treatment.sequences.length <= sections.length + 2,
  "sequences within sections+2"
);
// Timing comes from measurement, never from the model.
treatment.sequences.forEach((seq, i) => {
  assert.equal(seq.startS, sections[i].startS, "sequence timing = measured section timing");
  assert.equal(seq.endS, sections[i].endS);
  assert.ok(seq.shotIndexes.length >= 1 && seq.shotIndexes.length <= 5, "2-5 law: ≤5 kept, ≥1 always");
});
// ±10% duration law: the treatment claims the song's length, exactly.
assert.ok(
  Math.abs(treatment.durationS - 200) <= 0.1 * 200,
  "treatment duration within ±10% of the song"
);
// Shot clamps.
assert.ok(treatment.shots.length <= MAX_TREATMENT_SHOTS, "≤40 shots overall");
for (const shot of treatment.shots) {
  assert.ok(shot.duration_s >= 2 && shot.duration_s <= 8, "each shot 2-8s");
  assert.ok(Number.isInteger(shot.duration_s));
  assert.equal(typeof shot.sequenceIndex, "number");
}
assert.deepEqual(treatment.shots[0].subjects, ["the performer"], "subjects cleaned");
// Flat view indices are the storage law: shots[i].index === i.
treatment.shots.forEach((shot, i) => assert.equal(shot.index, i));
// Teaser: snapped duration, forced vertical, refs deduped + validated.
assert.equal(treatment.teaserCut.durationS, 15);
assert.equal(treatment.teaserCut.format, "vertical");
assert.ok(treatment.teaserCut.shotRefs.length > 0, "teaser refs never empty");
for (const ref of treatment.teaserCut.shotRefs) {
  assert.ok(Number.isInteger(ref) && ref >= 0 && ref < treatment.shots.length, "teaser refs are valid shot indices");
}
assert.equal(new Set(treatment.teaserCut.shotRefs).size, treatment.teaserCut.shotRefs.length, "teaser refs deduped");

// ---- Model omits the teaser → synthesized from the treatment's own peak ----
{
  const noTeaser = normalizeVideoTreatment(
    { ...modelOutput, teaserCut: undefined },
    { durationS: 200, sections, structureSource: "measured" }
  );
  assert.ok(noTeaser.teaserCut.shotRefs.length > 0, "synthesized teaser has refs");
  assert.equal(noTeaser.teaserCut.durationS, 15);
  assert.equal(noTeaser.teaserCut.format, "vertical");
}

// ---- Model gives an empty sequence → an honest beat is synthesized ---------
{
  const sparse = normalizeVideoTreatment(
    {
      concept: "the idea",
      sequences: [{ sectionIndex: 0, intent: "opening", shots: [] }],
    },
    { durationS: 100, sections: treatmentSectionsFromBoundaries(100, [30, 70]) }
  );
  assert.ok(sparse, "sparse output still normalizes");
  for (const seq of sparse.sequences) {
    assert.ok(seq.shotIndexes.length >= 1, "every sequence keeps at least one shot");
  }
}

// ---- Legacy / stub shape (flat shots, no sequences) is distributed ---------
{
  const legacyModel = {
    title: "Lagos Golden Hour",
    shots: [
      { prompt: "a", duration_s: 3 },
      { prompt: "b", duration_s: 4 },
      { prompt: "c", duration_s: 3 },
      { prompt: "d", duration_s: 5 },
    ],
  };
  const fromLegacy = normalizeVideoTreatment(legacyModel, { durationS: 15 });
  assert.ok(fromLegacy, "stub/legacy model output is accepted");
  assert.equal(fromLegacy.concept, "Lagos Golden Hour", "title backfills the concept");
  assert.ok(fromLegacy.shots.length >= 4, "all legacy shots survive");
  assert.equal(fromLegacy.durationS, 15);
}

// ---- Garbage in → null, never a fabricated treatment ------------------------
assert.equal(normalizeVideoTreatment(null, { durationS: 200 }), null);
assert.equal(normalizeVideoTreatment([], { durationS: 200 }), null);
assert.equal(normalizeVideoTreatment({}, { durationS: 200 }), null, "no concept/title/shots = refuse");
assert.equal(normalizeVideoTreatment(modelOutput, { durationS: 0 }), null, "no duration = refuse");

// ---- Flat-shots compatibility view ------------------------------------------
{
  // Treatment object → its .shots; legacy array → itself; junk → [].
  const flat = storyboardShots(treatment);
  assert.equal(flat.length, treatment.shots.length);
  assert.equal(flat[0].prompt, treatment.shots[0].prompt);
  const legacyArray = [{ index: 0, prompt: "old shot", duration_s: 4 }];
  assert.deepEqual(storyboardShots(legacyArray), legacyArray);
  assert.deepEqual(storyboardShots(null), []);
  assert.deepEqual(storyboardShots({ nope: true }), []);

  // Rich-shape detection.
  assert.ok(videoTreatmentOf(treatment), "stored treatment detected");
  assert.equal(videoTreatmentOf(legacyArray), null, "legacy array is not a treatment");
  assert.equal(videoTreatmentOf(null), null);
}

// ---- Per-shot billing survives the full-song shape ---------------------------
{
  const flat = storyboardShots(treatment);
  assert.ok(flat.length > 15, "this treatment exceeds the legacy render-all cap");
  const single = videoRenderUsage(flat, flat.length - 1);
  assert.ok(single, "single-shot billing works past 15 shots");
  assert.equal(single.shotCount, 1);
  assert.ok(single.planUnits > 0);
  // Render-ALL keeps the legacy 15-shot cost guard.
  assert.equal(videoRenderUsage(flat), null, "render-all of a 40-shot treatment is refused");
  // A treatment object passed whole (the untouched chat render path) fails
  // CLOSED: no charge, no crashed worker job.
  assert.equal(videoRenderUsage(treatment), null);
  // Legacy arrays keep the exact old behavior.
  const legacy = Array.from({ length: 6 }, () => ({ duration_s: 4 }));
  assert.deepEqual(videoRenderUsage(legacy, 0), {
    creditKey: "video_8s",
    billingUnits: 1,
    planUnits: 4,
    shotCount: 1,
  });
  assert.ok(videoRenderUsage(legacy), "legacy render-all still allowed");
}

console.log(
  `video treatment: sections, clamps, teaser refs, flat-shots compatibility and billing all passed (${treatment.shots.length} shots / ${treatment.sequences.length} sequences over ${treatment.durationS}s)`
);

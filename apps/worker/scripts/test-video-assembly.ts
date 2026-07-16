/**
 * VIDEO ASSEMBLY GATING (Wave 9) — the pure law behind POST /videos/assemble.
 * No ffmpeg, no DB: this asserts the honest gate ('full' needs >=1 rendered
 * shot per sequence, 'teaser' needs every teaserCut ref rendered — failures
 * name exactly what is missing), the edit-decision-list order (sequence order,
 * shots in order within, crossfade boundaries only at sequence changes), the
 * newest-render-per-shot rule, the teaser hook offset (+ song-length clamp),
 * and that assembled artifacts never gate themselves.
 */
import assert from "node:assert/strict";
import {
  perShotRenders,
  planVideoAssembly,
  videoAssemblyStatus,
  type AssemblyRenderRow,
} from "@afrohit/shared";

// A treatment-shaped storyboard exactly as VideoConcept.storyboard stores it:
// 3 sequences / 6 shots, teaser cut of shots [2, 3] from the Hook (startS 40).
const treatment = {
  kind: "treatment",
  concept: "Neon night drive",
  logline: "A record about leaving at 2am.",
  motifs: [],
  structureSource: "measured",
  durationS: 180,
  sequences: [
    { index: 0, label: "Intro", startS: 0, endS: 20, shotIndexes: [0, 1] },
    { index: 1, label: "Hook", startS: 40, endS: 70, shotIndexes: [2, 3] },
    { index: 2, label: "Outro", startS: 160, endS: 180, shotIndexes: [4, 5] },
  ],
  shots: [
    { index: 0, sequenceIndex: 0, prompt: "wide skyline", duration_s: 4 },
    { index: 1, sequenceIndex: 0, prompt: "keys on table", duration_s: 3 },
    { index: 2, sequenceIndex: 1, prompt: "dance circle", duration_s: 4 },
    { index: 3, sequenceIndex: 1, prompt: "singer closeup", duration_s: 2 },
    { index: 4, sequenceIndex: 2, prompt: "empty road", duration_s: 3 },
    { index: 5, sequenceIndex: 2, prompt: "sunrise", duration_s: 4 },
  ],
  teaserCut: { durationS: 15 as const, format: "vertical" as const, shotRefs: [2, 3] },
};

const render = (
  id: string,
  shotIndex: number,
  at: string,
  meta: Record<string, unknown> = {}
): AssemblyRenderRow => ({
  id,
  url: `s3://bucket/ws/videos/${id}.mp4`,
  createdAt: at,
  meta: { shotIndex, ...meta },
});

// ---- 1) HONEST 409: missing sequences are named exactly -------------------
{
  const gate = planVideoAssembly({
    kind: "full",
    storyboard: treatment,
    renders: [render("r0", 0, "2026-07-01T00:00:00Z")],
  });
  assert.equal(gate.ok, false);
  assert.equal(!gate.ok && gate.error, "shots_missing");
  assert.deepEqual(
    !gate.ok && gate.error === "shots_missing"
      ? gate.missing.map(m => m.label)
      : [],
    ["Hook", "Outro"],
    "the 409 must name exactly the sequences that lack renders"
  );
}

// ---- 2) FULL plan: EDL order, skipped unrendered shots, boundaries --------
{
  const renders = [
    render("r0", 0, "2026-07-01T00:00:00Z"),
    // shot 1 unrendered — Intro still covered by shot 0, shot 1 is skipped
    render("r2", 2, "2026-07-01T01:00:00Z"),
    render("r3", 3, "2026-07-01T02:00:00Z"),
    render("r5", 5, "2026-07-01T03:00:00Z"),
  ];
  const gate = planVideoAssembly({ kind: "full", storyboard: treatment, renders });
  assert.equal(gate.ok, true, "every sequence has >=1 render — gate must pass");
  const plan = gate.ok ? gate.plan : null!;
  assert.deepEqual(
    plan.clips.map(c => c.shotIndex),
    [0, 2, 3, 5],
    "clips play in sequence order, shots in order within, unrendered skipped"
  );
  assert.deepEqual(
    plan.clips.map(c => c.slotS),
    [4, 4, 2, 4],
    "each clip carries the treatment's claimed slot (the trim law)"
  );
  assert.deepEqual(
    plan.sequenceBoundaries,
    [1, 3],
    "crossfade boundaries sit exactly at sequence changes"
  );
  assert.equal(plan.plannedS, 14);
  assert.equal(plan.audioStartS, 0, "the full cut starts the master at 0");
  assert.equal(plan.maxDurationS, null);
}

// ---- 3) Newest render per shot wins; assembly rows never gate themselves --
{
  const rows: AssemblyRenderRow[] = [
    render("old", 2, "2026-07-01T00:00:00Z"),
    render("new", 2, "2026-07-02T00:00:00Z"),
    // an assembled cut row for this concept — carries meta.assembly, no shotIndex claim
    {
      id: "asm",
      url: "s3://bucket/ws/videos/asm.mp4",
      createdAt: "2026-07-03T00:00:00Z",
      meta: { assembly: { kind: "full", shotIndex: 4 } },
    },
    // garbage meta — never evidence
    { id: "junk", url: "s3://bucket/ws/videos/junk.mp4", createdAt: "2026-07-03T00:00:00Z", meta: { note: "no shot" } },
  ];
  const byShot = perShotRenders(rows);
  assert.equal(byShot.size, 1);
  assert.equal(byShot.get(2)?.renderId, "new", "the newest render per shot wins");
  assert.equal(byShot.has(4), false, "an assembled cut is not shot evidence");
}

// ---- 4) TEASER: refs order, hook offset from the ref's sequence, clamp ----
{
  const renders = [
    render("r2", 2, "2026-07-01T00:00:00Z"),
    render("r3", 3, "2026-07-01T00:00:00Z"),
  ];
  const gate = planVideoAssembly({
    kind: "teaser",
    storyboard: treatment,
    renders,
    songDurationS: 180,
  });
  assert.equal(gate.ok, true);
  const plan = gate.ok ? gate.plan : null!;
  assert.deepEqual(plan.clips.map(c => c.shotIndex), [2, 3], "teaserCut.shotRefs order");
  assert.deepEqual(plan.sequenceBoundaries, [], "teaser is hard cuts only");
  assert.equal(plan.maxDurationS, 15, "teaser caps at teaserCut.durationS");
  assert.equal(
    plan.audioStartS,
    40,
    "audio starts at the hook sequence's measured startS"
  );

  // Clamp: a hook so late the teaser would run past the record's end.
  const clamped = planVideoAssembly({
    kind: "teaser",
    storyboard: treatment,
    renders,
    songDurationS: 50,
  });
  assert.equal(clamped.ok, true);
  assert.equal(
    clamped.ok ? clamped.plan.audioStartS : -1,
    35,
    "hook offset clamps to songDurationS - teaser duration"
  );

  // Missing teaser refs are named as shots.
  const missing = planVideoAssembly({
    kind: "teaser",
    storyboard: treatment,
    renders: [render("r2", 2, "2026-07-01T00:00:00Z")],
  });
  assert.equal(missing.ok, false);
  assert.deepEqual(
    !missing.ok && missing.error === "shots_missing"
      ? missing.missing.map(m => m.label)
      : [],
    ["Shot 4"],
    "the teaser 409 names exactly the unrendered teaser shots"
  );
}

// ---- 5) Legacy flat storyboard: full works as ONE sequence; no teaser -----
{
  const legacy = [
    { index: 0, prompt: "scene a", duration_s: 4 },
    { index: 1, prompt: "scene b", duration_s: 4 },
  ];
  const gate = planVideoAssembly({
    kind: "full",
    storyboard: legacy,
    renders: [render("r0", 0, "2026-07-01T00:00:00Z")],
  });
  assert.equal(gate.ok, true, "a legacy concept assembles as one pseudo-sequence");
  assert.deepEqual(gate.ok ? gate.plan.sequenceBoundaries : null, []);
  const teaser = planVideoAssembly({ kind: "teaser", storyboard: legacy, renders: [] });
  assert.equal(!teaser.ok && teaser.error, "no_teaser_cut");
}

// ---- 6) Status surface: chips + both gates from one pure call -------------
{
  const status = videoAssemblyStatus({
    storyboard: treatment,
    renders: [render("r0", 0, "2026-07-01T00:00:00Z"), render("r2", 2, "2026-07-01T00:00:00Z")],
  });
  assert.equal(status.shotCount, 6);
  assert.deepEqual(status.renderedShotIndexes, [0, 2]);
  assert.deepEqual(
    status.sequences.map(s => `${s.label}:${s.renderedShotIndexes.length}/${s.shotIndexes.length}`),
    ["Intro:1/2", "Hook:1/2", "Outro:0/2"]
  );
  assert.equal(status.full.ready, false);
  assert.equal(status.teaser.ready, false);
  assert.equal(!status.teaser.ready ? status.teaser.durationS : null, 15);
}

console.log(
  "video assembly gating: honest 409s, EDL order, newest-per-shot, hook offset + clamp, legacy shape — all passed"
);

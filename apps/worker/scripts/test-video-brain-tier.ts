/**
 * VIDEO TREATMENT — BRAIN-TIER test (perf 2026-07-20).
 *
 * The "Make the whole video" text chain (main + critic + repair) used to run on
 * the slow PAID brain (no tier passed) — up to ~300s of Sonnet latency + silent
 * Anthropic spend per full-video attempt. It now runs Cerebras-first under a
 * FORCED-BULK context, with the critic/repair prompts SHRUNK under the ~28k-char
 * bulk guard so they actually resolve to Cerebras instead of laddering up.
 *
 * This locks the fix behaviorally AND at the wiring level:
 *   A. Representative prompts (incl. a long-lyric song) stay under the 28k guard
 *      for the MAIN, CRITIC and REPAIR calls — and the UNTRIMMED critic/repair
 *      would blow past it (so the shrink is load-bearing, not cosmetic).
 *   B. compactTreatmentForReview projects correctly (critic drops craft, repair
 *      keeps it; shot budget bounded; sequences re-anchored to the sections).
 *   C. runWithBrainContext engages the exact forceTier:'bulk' the guard reads.
 *   D. Under forced-bulk, an ENABLED Claude is NEVER billed — not on the first
 *      attempt, not down the ladder, not even for a >28k prompt (tops out at the
 *      OpenAI draft, never Sonnet). Proven via the per-run cost meter.
 *   E. The wiring is present in source: tier:'bulk' on critic/repair/short, the
 *      forced-bulk wraps, the VIDEO_TREATMENT_MAIN_BULK flag, and the
 *      compactTreatmentForReview usage — plus generate.ts's !forcedBulk guards.
 *
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-video-brain-tier.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  prompts,
  generateJson,
  runWithBrainContext,
  brainContext,
  brainRunCosts,
} from "@afrohit/ai";
import {
  compactTreatmentForReview,
  MAX_TREATMENT_SHOTS,
  type TreatmentSection,
} from "@afrohit/shared";

const root = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
let failures = 0;
function expect(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else console.log("  ok:", msg);
}

/** The bulk context guard in packages/ai/src/generate.ts (system+user chars). */
const GUARD = 28_000;

// ---------------------------------------------------------------------------
// Fixtures — a realistic full-song treatment (the RAW model output shape) and
// the song's words. `nSec`/`nShot` scale it up to the worst case the model can
// hand back (12 sections x 5 shots) so the guard math is stress-tested.
// ---------------------------------------------------------------------------
function fixtureShot(i: number): Record<string, unknown> {
  return {
    prompt: `A dark-skinned Nigerian woman in emerald ankara two-piece walks through a golden-lit Lagos rooftop at dusk, danfo-yellow accents behind her, slow cinematic push-in, shot ${i} beat of the passage with layered crowd energy and skyline haze`,
    durationS: 4,
    motion: "slow push-in",
    lighting: "golden hour",
    subjects: [
      "LEAD_A — the female lead: dark-skinned Nigerian woman, gold braids, emerald ankara two-piece",
      "Black African dancers in monochrome uniforms",
    ],
    negativePrompt: "no logos, no other artists, no text",
  };
}
function makeTreatment(nSec: number, nShot: number): Record<string, unknown> {
  const sequences = Array.from({ length: nSec }, (_, i) => ({
    sectionIndex: i,
    intent:
      "Escalate the emotional arc: plant the motif in act one, complicate it, then pay it off with communal celebration and rising crowd scale.",
    setting:
      "A golden-lit Lagos rooftop turning to neon night as the crowd swells around the lead performer across the skyline.",
    continuity:
      "The emerald ankara and gold braids carry across every sequence; the crowd grows each hook and the palette deepens to neon.",
    performers: ["LEAD_A"],
    shots: Array.from({ length: nShot }, (_, j) => fixtureShot(i * nShot + j + 1)),
  }));
  return {
    title: "Emerald Skyline",
    concept: "A woman reclaims her city one rooftop at a time.",
    logline:
      "Across one Lagos night a rising star turns a quiet rooftop into a citywide celebration.",
    visualWorld:
      "Saturated Lagos primaries by day shifting to neon magenta and amber by night; ankara texture, danfo yellow, skyline haze.",
    motifs: ["emerald ankara", "gold braids", "growing crowd", "skyline at dusk", "raised hands"],
    colorStory: "Warm golden day deepening to neon night across the three acts.",
    castingNotes:
      "LEAD_A — the female lead: dark-skinned Nigerian woman, gold braids, emerald ankara two-piece. Ensemble: Black African dancers in monochrome uniforms.",
    balance: "65% narrative / 35% performance, performance breaks on every hook",
    sequences,
    teaserCut: {
      durationS: 15,
      format: "vertical",
      shotRefs: [2, 5, 9],
      hookMoment: "the crowd snaps into unison on the first chorus",
    },
  };
}
function makeSections(nSec: number): TreatmentSection[] {
  const span = 180 / nSec;
  return Array.from({ length: nSec }, (_, i) => ({
    index: i,
    label: `Section ${i}`,
    startS: Math.round(i * span),
    endS: Math.round((i + 1) * span),
  }));
}
const LYRIC_LINE =
  "I dey run am for the morning light, carry my dream for my back tonight\n";
function makeLyrics(chars: number): string {
  return LYRIC_LINE.repeat(Math.ceil(chars / LYRIC_LINE.length)).slice(0, chars);
}

// The MAIN pass system is fixed (VIDEO_TREATMENT_SYSTEM + SCENE_GRAMMAR); this
// mirrors the exact user payload processVideoTreatment builds so the size is
// faithful. generate.ts measures the guard on system.length + user.length.
const MAIN_SYSTEM = prompts.VIDEO_TREATMENT_SYSTEM + "\n\n" + prompts.SCENE_GRAMMAR;
function mainUser(lyrics: string, nSec: number): string {
  const sections = Array.from({ length: nSec }, (_, i) => ({
    index: i,
    label: `Section ${i}`,
    startS: i * 18,
    endS: (i + 1) * 18,
    vocal: i % 2 ? "female" : "both",
  }));
  return JSON.stringify({
    artist: { stageName: "Ada Sparkle", lane: "Afro-fusion / alte, Lagos rooftop energy, warm and defiant" },
    brief: {
      hook: "a citywide celebration",
      references: "golden-hour Lagos, neon night",
      notes: "first-person female protagonist reclaiming her city",
    },
    song: {
      title: "Emerald Skyline",
      genre: "afrobeats",
      bpm: 104,
      vocalist: "female",
      performers: { mode: "solo", roster: [{ id: "LEAD_A", label: "female lead" }] },
      lyrics,
      madeAt: new Date().toISOString(),
    },
    structure: { source: "measured", durationS: 180, sections },
    format: "vertical",
    teaser: { allowedDurations: [15, 30], format: "vertical" },
    extraPrompt: "make the final chorus the biggest crowd of the video",
    artistVision: {
      text: "I want it to feel like the whole of Lagos rises with me by the last chorus",
      mode: "enhance",
    },
  });
}
const PERFORMERS = { mode: "solo", roster: [{ id: "LEAD_A", label: "female lead" }] };
const LYRIC_CAP = 3_200; // mirrors lyricsForCritic in video-treatment.ts

function criticSize(raw: Record<string, unknown>, sections: TreatmentSection[], lyrics: string): number {
  return (
    prompts.TREATMENT_CRITIC_SYSTEM.length +
    JSON.stringify({
      lyrics: lyrics.slice(0, LYRIC_CAP),
      performers: PERFORMERS,
      treatment: compactTreatmentForReview(raw, sections, "critic"),
    }).length
  );
}
function repairSize(raw: Record<string, unknown>, sections: TreatmentSection[]): number {
  return (
    prompts.TREATMENT_REPAIR_SYSTEM.length +
    JSON.stringify({
      original: compactTreatmentForReview(raw, sections, "repair"),
      fixes: ["seq 3 shot 2: state cast verbatim", "seq 8: break palette on the bridge"],
    }).length
  );
}
function criticSizeUntrimmed(raw: Record<string, unknown>, lyrics: string): number {
  return (
    prompts.TREATMENT_CRITIC_SYSTEM.length +
    JSON.stringify({ lyrics, performers: PERFORMERS, treatment: raw }).length
  );
}
function repairSizeUntrimmed(raw: Record<string, unknown>): number {
  return (
    prompts.TREATMENT_REPAIR_SYSTEM.length +
    JSON.stringify({ original: raw, fixes: ["a", "b"] }).length
  );
}

async function main(): Promise<void> {
  console.log("== A. Prompt sizes stay under the 28k bulk guard ==");
  // MAIN pass — the full song's words stay in the prompt (owner law). A
  // representative and even a genuinely long-lyric song are under the guard, so
  // the main pass resolves to Cerebras (not routed UP).
  for (const [name, lyricChars, nSec] of [
    ["main representative (2.5k lyrics)", 2_500, 10],
    ["main long-lyric (4.5k lyrics)", 4_500, 10],
  ] as const) {
    const total = MAIN_SYSTEM.length + mainUser(makeLyrics(lyricChars), nSec).length;
    expect(total < GUARD, `${name}: ${total} < ${GUARD}`);
  }

  // CRITIC — aggressively trimmed (score-only, ≤3 shots/sequence), so it stays
  // under the guard for EVERY size up to the worst case the model can hand back
  // (12x5 = 60 raw shots capped to MAX_TREATMENT_SHOTS), long lyrics included.
  for (const [name, nSec, nShot] of [
    ["representative 10x3", 10, 3],
    ["dense 12x3", 12, 3],
    ["maxed 12x4", 12, 4],
    ["worst-case 12x5", 12, 5],
  ] as const) {
    const crit = criticSize(makeTreatment(nSec, nShot), makeSections(nSec), makeLyrics(4_500));
    expect(crit < GUARD, `critic ${name} (long lyrics): ${crit} < ${GUARD}`);
  }
  // REPAIR — keeps every shot's craft (motion/lighting/durationS/negativePrompt)
  // so the re-normalized plan is never degraded. That fits Cerebras until the
  // treatment MAXES OUT MAX_TREATMENT_SHOTS full-fidelity shots (~28k of pure
  // content). Typical treatments (≤ ~36 shots) run on Cerebras...
  for (const [name, nSec, nShot] of [
    ["representative 10x3", 10, 3],
    ["dense 12x3", 12, 3],
  ] as const) {
    const rep = repairSize(makeTreatment(nSec, nShot), makeSections(nSec));
    expect(rep < GUARD, `repair ${name}: ${rep} < ${GUARD} (Cerebras)`);
  }
  // ...a MAXED-OUT treatment (≥ MAX_TREATMENT_SHOTS shots) grazes the guard; under
  // forced-bulk THAT gracefully routes to the OpenAI DRAFT — never Sonnet — with
  // every field preserved (the draft path gets the same full projection).
  for (const [name, nSec, nShot] of [
    ["maxed 12x4", 12, 4],
    ["maxed 12x5", 12, 5],
  ] as const) {
    const rep = repairSize(makeTreatment(nSec, nShot), makeSections(nSec));
    expect(rep < GUARD + 1_000, `repair ${name} (40 shots): ${rep} — grazes guard → OpenAI draft, never Sonnet`);
  }

  console.log("== shrink is load-bearing: untrimmed large calls EXCEED the guard ==");
  {
    const raw = makeTreatment(12, 5);
    const sections = makeSections(12);
    const longLyrics = makeLyrics(4_500);
    const critNow = criticSizeUntrimmed(raw, longLyrics);
    const repNow = repairSizeUntrimmed(raw);
    expect(critNow > GUARD, `UNTRIMMED critic 12x5: ${critNow} > ${GUARD} (would skip Cerebras)`);
    expect(repNow > GUARD, `UNTRIMMED repair 12x5: ${repNow} > ${GUARD} (would skip Cerebras)`);
    expect(
      criticSize(raw, sections, longLyrics) < critNow &&
        repairSize(raw, sections) < repNow,
      "trimmed critic/repair are strictly smaller than untrimmed"
    );
  }

  console.log("== B. compactTreatmentForReview projects correctly ==");
  {
    const raw = makeTreatment(12, 5); // 60 raw shots
    const sections = makeSections(12);
    const critView = compactTreatmentForReview(raw, sections, "critic");
    const repView = compactTreatmentForReview(raw, sections, "repair");
    const critJson = JSON.stringify(critView);
    const repJson = JSON.stringify(repView);
    // Critic view is score-only: no render craft leaks in.
    expect(!/"motion"|"lighting"|"negativePrompt"|"durationS"/.test(critJson), "critic view drops motion/lighting/negativePrompt/durationS");
    // Repair view must keep craft so the re-normalized treatment isn't degraded.
    expect(/"motion"/.test(repJson) && /"negativePrompt"/.test(repJson) && /"durationS"/.test(repJson), "repair view keeps motion/negativePrompt/durationS");
    // Both bound the shot budget to MAX_TREATMENT_SHOTS (the normalizer's cap).
    const critShots = (critView.sequences as { shots: unknown[] }[]).reduce((n, s) => n + s.shots.length, 0);
    const repShots = (repView.sequences as { shots: unknown[] }[]).reduce((n, s) => n + s.shots.length, 0);
    expect(critShots <= MAX_TREATMENT_SHOTS, `critic shot budget bounded (${critShots} <= ${MAX_TREATMENT_SHOTS})`);
    expect(repShots <= MAX_TREATMENT_SHOTS, `repair shot budget bounded (${repShots} <= ${MAX_TREATMENT_SHOTS})`);
    // Per-sequence caps: critic <= 3, repair <= 5.
    const critMax = Math.max(...(critView.sequences as { shots: unknown[] }[]).map(s => s.shots.length));
    const repMax = Math.max(...(repView.sequences as { shots: unknown[] }[]).map(s => s.shots.length));
    expect(critMax <= 3, `critic <= 3 shots/sequence (${critMax})`);
    expect(repMax <= 5, `repair <= 5 shots/sequence (${repMax})`);
    // Sequences re-anchored to the authoritative sections (label + sectionIndex).
    const seq0 = (critView.sequences as { sectionIndex: number; label: string }[])[0]!;
    expect(seq0.sectionIndex === 0 && seq0.label === sections[0]!.label, "sequences re-anchored to section index + label");
    expect(critView.concept === "A woman reclaims her city one rooftop at a time.", "top-level concept preserved");
  }

  console.log("== C. runWithBrainContext engages forceTier:'bulk' ==");
  {
    expect(brainContext() === undefined, "no brain context outside a wrapped run");
    const seen = await runWithBrainContext({ forceTier: "bulk", runId: "video-treatment:test" }, async () => brainContext()?.forceTier);
    expect(seen === "bulk", "inside the wrap brainContext().forceTier === 'bulk'");
  }

  console.log("== D. forced-bulk NEVER bills Claude, even down the ladder ==");
  {
    // Claude is ENABLED (a dummy key) so it IS a candidate — but forced-bulk must
    // suppress it. Cerebras + OpenAI are unconfigured, so both providers throw
    // synchronously (no network): the run ladders and terminates on the OpenAI
    // draft path, recording only the fallback brain. brainLabel maps
    // claude -> 'taste-brain'; its ABSENCE proves Sonnet was never reached.
    process.env.ANTHROPIC_API_KEY = "sk-test-dummy-never-called";
    for (const k of ["CEREBRAS_API_KEYS", "CEREBRAS_API_KEY", "CEREBRAS_KEY", "CEREBRASAI_API_KEY", "OPENAI_API_KEY", "STUB_AI"]) {
      delete process.env[k];
    }
    const runProbe = async (user: string): Promise<Record<string, { calls: number }>> =>
      runWithBrainContext({ forceTier: "bulk", runId: "probe" }, async () => {
        try {
          await generateJson({ task: "probe", system: "probe", user });
        } catch {
          /* every brain unconfigured — the throw is expected; we inspect the meter */
        }
        return (brainRunCosts()?.byBrain ?? {}) as Record<string, { calls: number }>;
      });

    const small = await runProbe("small prompt");
    expect(Object.keys(small).length >= 1, `ladder ran and recorded a brain (${Object.keys(small).join(",") || "none"})`);
    expect(!("taste-brain" in small), "forced-bulk: NO Claude (taste-brain) recorded for a small prompt");

    const big = await runProbe("x".repeat(GUARD + 4_000)); // > 28k guard
    expect(!("taste-brain" in big), "forced-bulk >28k: still NO Claude — routes to OpenAI draft, never Sonnet");
  }

  console.log("== E. wiring is present in source ==");
  const vt = read("apps/worker/src/processors/video-treatment.ts");
  expect(/import \{[^}]*runWithBrainContext[^}]*\} from "@afrohit\/ai"/.test(vt), "video-treatment: imports runWithBrainContext");
  expect(/import \{[\s\S]*compactTreatmentForReview[\s\S]*\} from "@afrohit\/shared"/.test(vt), "video-treatment: imports compactTreatmentForReview");
  expect(vt.includes('process.env.VIDEO_TREATMENT_MAIN_BULK !== "0"'), "video-treatment: MAIN pass flag defaults ON ('0' to A/B on Claude)");
  expect(/mainOnBulk[\s\S]{0,80}runWithBrainContext\(\{ forceTier: "bulk", runId \}, runMainPass\)/.test(vt), "video-treatment: MAIN pass forced-bulk gated by the flag");
  expect(/const reviewed = await runWithBrainContext\(\s*\{ forceTier: "bulk", runId \},\s*async/.test(vt), "video-treatment: critic+repair wrapped in forced-bulk");
  expect(vt.includes('compactTreatmentForReview(finalResult, sections, "critic")'), "video-treatment: critic uses the critic projection");
  expect(vt.includes('compactTreatmentForReview(finalResult, sections, "repair")'), "video-treatment: repair uses the repair projection");
  expect((vt.match(/tier: "bulk"/g) ?? []).length >= 2, "video-treatment: critic + repair carry tier:'bulk'");

  const vid = read("apps/api/src/routes/videos.ts");
  expect(/import \{[^}]*runWithBrainContext[^}]*\} from "@afrohit\/ai"/.test(vid), "videos: imports runWithBrainContext");
  expect(vid.includes('{ forceTier: "bulk", runId: `video-storyboard:'), "videos: short storyboard wrapped in forced-bulk");
  expect((vid.match(/tier: "bulk"/g) ?? []).length >= 1, "videos: short storyboard carries tier:'bulk'");

  // generate.ts NIGHT LAW guards — the mechanism that makes forced-bulk safe.
  const gen = read("packages/ai/src/generate.ts");
  expect(/wantClaude && anthropicUsable\(\) && !forcedBulk/.test(gen), "generate.ts: main Claude path guarded by !forcedBulk");
  expect(/anthropicUsable\(\) && !forcedBulk && \/quota/.test(gen), "generate.ts: OpenAI-quota Claude retry guarded by !forcedBulk");
  expect(/forcedBulk = brainContext\(\)\?\.forceTier === 'bulk'/.test(gen), "generate.ts: forcedBulk derives from forceTier");

  console.log(failures ? "\n❌ Video brain-tier test FAILED" : "\n✅ Video brain-tier test PASSED");
  if (failures) process.exitCode = 1;
}

main().catch(err => {
  console.error("UNEXPECTED:", err);
  process.exitCode = 1;
});

/**
 * SONG SPEED — the contained LLM/latency quick-wins (songspeed perf, 2026-07-21).
 *
 * The song WRITE path carried a paid-brain latency tail, a silent paid-brain
 * leak, a needless serial step, and a per-forge model-version lookup. This locks
 * all four fixes — three by SOURCE wiring (the calls live deep inside
 * processProduce, behind DB + audio render, so their tiers/bounds are asserted at
 * the wiring level the way test-video-brain-tier does) plus BEHAVIOURAL proofs
 * where the seam is reachable in-process:
 *
 *  FIX 1  lyric-fitting is cheap-first / taste-on-retry: attempt 0 = tier 'bulk',
 *         the QA-fail retry = tier 'judgment' (Claude), capped at 2 attempts with
 *         an explicit timeoutMs:30000 — same QA gate, bounded paid tail.
 *  FIX 2  melodyBrain wraps its generateJson in runWithBrainContext(forceTier
 *         'bulk') so a Cerebras hiccup can NEVER ladder to paid Sonnet (proven via
 *         the global usage sink: an ENABLED Claude is never the resolved brain).
 *  FIX 3  reviewLanguage + scoreForAR run via Promise.all — both start before
 *         either resolves (one round-trip saved), advanceState order unchanged.
 *  FIX 4  the forge model-version resolve is memoized: N forges do ONE /models
 *         lookup, not N; a boot prewarm warms it; a pinned env skips it entirely.
 *
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-song-speed.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  melodyBrain,
  musicAdapter,
  prewarmForgeModel,
  __resetMusicVersionCache,
  setLlmUsageSink,
  type AttributedLlmCallRecord,
} from "@afrohit/ai";

const root = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
let failures = 0;
function expect(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else console.log("  ok:", msg);
}
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main(): Promise<void> {
  const produce = read("apps/worker/src/processors/produce.ts");
  const melody = read("packages/ai/src/melody-brain.ts");
  const music = read("packages/ai/src/providers/music.ts");
  const workerIndex = read("apps/worker/src/index.ts");

  // -------------------------------------------------------------------------
  console.log("== FIX 1 — lyric-fitting: cheap-first, bounded retries, 30s cap ==");
  // The corrective loop is bounded to 2 attempts (was 3): worst case 2 Claude
  // round-trips, not 3.
  expect(
    /for \(let attempt = 0; attempt < 2 && !qa\.ok; attempt\+\+\)/.test(produce),
    "lyric-fitting loop caps at 2 attempts (attempt < 2)"
  );
  expect(!/attempt < 3 && !qa\.ok/.test(produce), "the old 3-attempt bound is gone");
  // Attempt 0 drafts on the CHEAP bulk brain; the retry ESCALATES to judgment.
  expect(
    /tier: attempt === 0 \? 'bulk' : 'judgment', task: 'lyric-fitting'/.test(produce),
    "attempt 0 => tier 'bulk' (Cerebras-first), retry => tier 'judgment' (Claude)"
  );
  // Explicit 30s cap on the fitting call (bounds the judgment retry's round-trip).
  expect(/task: 'lyric-fitting'[\s\S]{0,900}?timeoutMs: 30_000/.test(produce),
    "lyric-fitting call passes timeoutMs: 30_000");
  // The QA gate is UNCHANGED — the accepted lyric still runs the same lyricQaCheck
  // inside the loop AND the reject gate after it, so output quality is preserved.
  expect(
    /qa = lyricQaCheck\(\{ title, body, hookCell: cell, languageMix: langMix, catalogue \}\);\s*\n\s*}/.test(produce),
    "QA gate (lyricQaCheck) still runs on every attempt inside the loop"
  );
  expect(/if \(!qa\.ok\) \{[\s\S]{0,200}REJECT_AND_RESTART/.test(produce),
    "the post-loop 'QA not ok => REJECT_AND_RESTART' gate is intact");

  // -------------------------------------------------------------------------
  console.log("== FIX 2 — melodyBrain forced-bulk (source wiring) ==");
  expect(/import \{ runWithBrainContext \} from '\.\/brain-context';/.test(melody),
    "melody-brain: imports runWithBrainContext");
  // The generateJson call is WRAPPED in forceTier:'bulk' (exactly like producer-brain).
  expect(
    /runWithBrainContext\(\{ forceTier: 'bulk' \}, \(\) =>\s*\n\s*generateJson</.test(melody),
    "melody-brain: generateJson is wrapped in runWithBrainContext({ forceTier: 'bulk' })"
  );

  console.log("== FIX 2 — melodyBrain forced-bulk (behavioural: Claude never billed) ==");
  {
    // Mirror test-video-brain-tier's proof: Claude is ENABLED (a dummy key) so it
    // IS a candidate, but the forced-bulk wrap inside melodyBrain must suppress
    // it. Cerebras + OpenAI are unconfigured, so every provider throws
    // synchronously (no network) and the taste layer degrades to the pure
    // composer. The global usage sink records the RESOLVED brain of every call:
    // 'claude' must NEVER appear.
    const recorded: AttributedLlmCallRecord[] = [];
    setLlmUsageSink(rec => recorded.push(rec));
    const savedEnv: Record<string, string | undefined> = {};
    for (const k of [
      "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "CEREBRAS_API_KEY", "CEREBRAS_API_KEYS",
      "CEREBRAS_KEY", "CEREBRASAI_API_KEY", "OPENAI_API_KEY", "STUB_AI",
    ]) savedEnv[k] = process.env[k];
    process.env.ANTHROPIC_API_KEY = "sk-test-dummy-never-called";
    for (const k of [
      "CLAUDE_API_KEY", "CEREBRAS_API_KEY", "CEREBRAS_API_KEYS", "CEREBRAS_KEY",
      "CEREBRASAI_API_KEY", "OPENAI_API_KEY", "STUB_AI",
    ]) delete process.env[k];

    const score = await melodyBrain({
      genre: "afrobeats",
      bpm: 104,
      key: "A minor",
      seed: 7,
      swing: 0.56,
      syncopation: 0.62,
      sections: [
        { name: "Verse 1", kind: "verse", lines: ["line one here", "line two here"] },
        { name: "Hook", kind: "hook", lines: ["the hook line", "the hook again"] },
      ],
    });

    // Restore env + sink.
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    setLlmUsageSink(() => {});

    expect(Array.isArray(score?.sections) && score.sections.length === 2,
      "melodyBrain still returns a deterministic composed score (pure-composer fallback)");
    expect(recorded.length >= 1,
      `the LLM ladder ran and recorded at least one brain (${recorded.map(r => r.brain).join(",") || "none"})`);
    expect(!recorded.some(r => r.brain === "claude"),
      "forced-bulk: melodyBrain NEVER resolved to Claude, even with Claude enabled");
    expect(recorded.every(r => r.brain !== "claude"),
      "no recorded call topped out above the OpenAI draft (Sonnet is off)");
  }

  // -------------------------------------------------------------------------
  console.log("== FIX 3 — parallel post-lyric bulk calls (source wiring) ==");
  expect(
    /const \[lang, ar\] = await Promise\.all\(\[[\s\S]*?reviewLanguage\([\s\S]*?scoreForAR\([\s\S]*?\]\);/.test(produce),
    "produce: reviewLanguage + scoreForAR run inside a single Promise.all([...])"
  );
  // scoreForAR must ONLY be awaited inside the Promise.all — no leftover
  // sequential `const ar = await scoreForAR(...)`.
  expect(!/const ar = await scoreForAR/.test(produce),
    "the old sequential `const ar = await scoreForAR(...)` is gone");
  // advanceState narrative order preserved: language_review -> vocal_production -> decision.
  const langIdx = produce.indexOf("stage: 'language_review'");
  const vocalIdx = produce.indexOf("stage: 'vocal_production'");
  const decisionIdx = produce.indexOf("stage: 'decision'");
  expect(langIdx > 0 && vocalIdx > langIdx && decisionIdx > vocalIdx,
    "advanceState order unchanged: language_review -> vocal_production -> decision");

  console.log("== FIX 3 — Promise.all concurrency (behavioural) ==");
  {
    // Prove the exact property the refactor relies on: two independent async
    // calls wrapped in Promise.all both START before EITHER resolves.
    const events: string[] = [];
    const call = (id: string) => async () => {
      events.push(`${id}:start`);
      await delay(25);
      events.push(`${id}:end`);
      return id;
    };
    const [a, b] = await Promise.all([call("lang")(), call("ar")()]);
    expect(a === "lang" && b === "ar", "Promise.all resolves both calls");
    const firstEnd = events.findIndex(e => e.endsWith(":end"));
    const startsBeforeFirstEnd = events
      .slice(0, firstEnd)
      .filter(e => e.endsWith(":start")).length;
    expect(startsBeforeFirstEnd === 2,
      `both calls start before either resolves (order: ${events.join(" ")})`);
  }

  // -------------------------------------------------------------------------
  console.log("== FIX 4 — forge model-version memoized (behavioural) ==");
  {
    const realFetch = global.fetch;
    let modelLookups = 0;
    let predictions = 0;
    const savedEnv: Record<string, string | undefined> = {
      REPLICATE_MUSIC_VERSION: process.env.REPLICATE_MUSIC_VERSION,
      REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
      REPLICATE_MUSIC_MODEL: process.env.REPLICATE_MUSIC_MODEL,
    };
    delete process.env.REPLICATE_MUSIC_VERSION; // force the lookup path
    delete process.env.REPLICATE_MUSIC_MODEL; // default meta/musicgen
    process.env.REPLICATE_API_TOKEN = "r8_test_dummy";

    // Count /models lookups vs /predictions; return canned OK responses.
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/v1/models/")) {
        modelLookups++;
        return {
          ok: true, status: 200,
          json: async () => ({ latest_version: { id: "ver-abc123" } }),
          text: async () => "",
        } as unknown as Response;
      }
      if (url.includes("/v1/predictions")) {
        predictions++;
        return {
          ok: true, status: 200,
          json: async () => ({ id: "pred-1", status: "succeeded", output: "https://x/out.mp3" }),
          text: async () => "",
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    try {
      // N forges = N fresh adapters (exactly how material.ts builds them per job).
      __resetMusicVersionCache();
      modelLookups = 0; predictions = 0;
      const N = 8;
      for (let i = 0; i < N; i++) {
        const adapter = musicAdapter("replicate", "r8_test_dummy");
        const r = await adapter.generate({
          genre: "afrobeats", bpm: 104, durationS: 8,
          vibePrompt: "solo shaker groove, shaker only", promptMode: "verbatim",
        } as never);
        if (r.status !== "succeeded") throw new Error(`forge ${i} did not succeed: ${r.error}`);
      }
      expect(modelLookups === 1, `8 forges did ONE model-version lookup (got ${modelLookups})`);
      expect(predictions === N, `8 forges each still POSTed their own prediction (got ${predictions})`);

      // Prewarm: resolves + caches the version BEFORE any forge, so the first real
      // forge does 0 additional lookups.
      __resetMusicVersionCache();
      modelLookups = 0; predictions = 0;
      await prewarmForgeModel();
      expect(modelLookups === 1, `prewarm resolved the version once (got ${modelLookups})`);
      const warm = musicAdapter("replicate", "r8_test_dummy");
      await warm.generate({ genre: "afrobeats", bpm: 104, durationS: 8, vibePrompt: "solo bass", promptMode: "verbatim" } as never);
      expect(modelLookups === 1, "first forge after prewarm did NO extra lookup (cache warm)");
      expect(predictions === 1, "the forge after prewarm still ran its prediction");

      // Pinned env: no lookup at all, ever (operator errand).
      process.env.REPLICATE_MUSIC_VERSION = "pinned-version-id";
      __resetMusicVersionCache();
      modelLookups = 0; predictions = 0;
      await prewarmForgeModel();
      expect(modelLookups === 0, "prewarm is a no-op when REPLICATE_MUSIC_VERSION is pinned");
      const pinned = musicAdapter("replicate", "r8_test_dummy");
      await pinned.generate({ genre: "afrobeats", bpm: 104, durationS: 8, vibePrompt: "solo kick", promptMode: "verbatim" } as never);
      expect(modelLookups === 0, "a pinned forge does ZERO model lookups (env removes it entirely)");
      expect(predictions === 1, "the pinned forge still ran its prediction");
    } finally {
      global.fetch = realFetch;
      __resetMusicVersionCache();
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  console.log("== FIX 4 — memo + prewarm wiring present in source ==");
  expect(/const musicVersionCache = new Map<string, string>\(\);/.test(music),
    "music.ts: module-level version memo exists");
  expect(/async function resolveMusicGenVersion\(/.test(music) &&
    /const resolved = await resolveMusicGenVersion\(auth, slug\);/.test(music),
    "music.ts: ReplicateMusicGenAdapter.generate resolves via the memoized helper");
  expect(/only successful resolves cache/.test(music),
    "music.ts: only successful resolves are cached (fail-soft, no poisoning)");
  expect(/export async function prewarmForgeModel\(\)/.test(music),
    "music.ts: exports prewarmForgeModel");
  expect(/REPLICATE_MUSIC_VERSION[\s\S]{0,80}operator errand/.test(music),
    "music.ts: documents REPLICATE_MUSIC_VERSION removes the lookup (operator errand)");
  expect(/import \{[\s\S]*?prewarmForgeModel[\s\S]*?\} from "@afrohit\/ai";/.test(workerIndex) &&
    /void prewarmForgeModel\(\);/.test(workerIndex),
    "worker index: prewarmForgeModel is fired fire-and-forget at boot");

  console.log(failures ? "\n❌ Song-speed test FAILED" : "\n✅ Song-speed test PASSED");
  if (failures) process.exitCode = 1;
}

main().catch(err => {
  console.error("UNEXPECTED:", err);
  process.exitCode = 1;
});

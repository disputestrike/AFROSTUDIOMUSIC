/**
 * ONE SCRIPT TO TEST EVERYTHING — the whole Lane pipeline (Phases 0–7) in a single
 * run, plus an optional live health check of the deployed API.
 *
 *   pnpm --filter @afrohit/worker test           (all offline unit tests)
 *   pnpm --filter @afrohit/worker test -- --live (also ping the live API)
 *
 * Each phase test is a self-contained script that exits 0/1; this spawns them all,
 * collects the verdicts, and prints ONE summary. Exit 0 iff every REQUIRED test
 * passes. The real 9-track ear acceptance (eval-ear.ts) and the live check are
 * INFORMATIONAL — they need audio / a network and never fail the suite.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Keep the summary clean — hush Node's shell-spawn deprecation notice (we only spawn
// fixed, trusted script names, never user input).
process.removeAllListeners("warning");
process.on("warning", w => {
  if (w.name !== "DeprecationWarning") console.warn(w);
});

const root = process.cwd(); // worker package dir when run via pnpm --filter
const scripts = join(root, "scripts");
const wantLive = process.argv.includes("--live");
const requireDsp = process.env.REQUIRE_DSP === "1";

type Result = {
  name: string;
  status: "PASS" | "FAIL" | "SKIP" | "INFO";
  note: string;
  required: boolean;
};
const results: Result[] = [];

function runTsx(file: string): { code: number | null; out: string } {
  const r = spawnSync("pnpm", ["exec", "tsx", join("scripts", file)], {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function runPython(file: string): { code: number | null; out: string } {
  for (const bin of [process.env.PYTHON_BIN, "python", "python3"].filter(
    Boolean
  ) as string[]) {
    const r = spawnSync(bin, [join("scripts", file)], {
      cwd: root,
      encoding: "utf8",
      shell: true,
    });
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT")
      continue; // try next python
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  }
  return { code: null, out: "no python interpreter found" };
}

// ---- Phase 0: the ear (Python DSP) ----
{
  const { code, out } = runPython("synth_eartest.py");
  if (/DSP stack unavailable/i.test(out))
    results.push({
      name: "P0  The ear (DSP)",
      status: requireDsp ? "FAIL" : "SKIP",
      note: requireDsp
        ? "required DSP stack is unavailable"
        : "librosa not installed here (runs in the worker image)",
      required: requireDsp,
    });
  else
    results.push({
      name: "P0  The ear (DSP)",
      status: code === 0 ? "PASS" : "FAIL",
      note: code === 0 ? "all 3 gates OK" : "see output",
      required: true,
    });
}

// ---- Owned synth: genre + key awareness (pure numpy, no libsndfile) ----
{
  const pyDir = join(root, "py");
  let code: number | null = null,
    out = "";
  for (const bin of [process.env.PYTHON_BIN, "python", "python3"].filter(
    Boolean
  ) as string[]) {
    const r = spawnSync(bin, ["test_synth.py"], {
      cwd: pyDir,
      encoding: "utf8",
      shell: true,
    });
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT")
      continue;
    code = r.status;
    out = (r.stdout || "") + (r.stderr || "");
    break;
  }
  if (code === 2 || /SKIP/i.test(out) || code === null)
    results.push({
      name: "Synth genre+key aware",
      status: "SKIP",
      note: "numpy not installed here (runs in the worker image)",
      required: false,
    });
  else
    results.push({
      name: "Synth genre+key aware",
      status: code === 0 ? "PASS" : "FAIL",
      note: code === 0 ? "" : out.slice(-200),
      required: true,
    });
}

// ---- Phases 1–7: pure TS unit tests ----
const TS: Array<[string, string]> = [
  ["P0  Ear corpus integrity", "test-ear-corpus.ts"],
  ["P1  LaneProfile", "test-lane-profile.ts"],
  ["P2  Compliance + drift", "test-lane-compliance.ts"],
  ["P3  RepairPlanner", "test-lane-repair.ts"],
  ["P4  Genre signatures", "test-genre-signatures.ts"],
  ["P5  Material selector", "test-lane-material.ts"],
  ["P5  Fill insertion", "test-fills.ts"],
  ["P6  Release gate", "test-release-gate.ts"],
  ["P6  Release package truth", "test-release-package.ts"],
  ["P6  Audio byte certification", "test-audio-certification.ts"],
  ["P7  Competitor evidence", "test-benchmark-evidence.ts"],
  ["Artist memory retrieval", "test-memory-retrieval.ts"],
  ["P7  Engine ceilings", "test-lane-engine.ts"],
  ["Lyric render filter", "test-clean-lyrics.ts"],
  ["The Wall (W-2/C-1)", "test-wall.ts"],
  ["Wall probe (no vendor names)", "test-wall-probe.ts"],
  ["Golden briefs (pipeline gate)", "test-golden-briefs.ts"],
  ["Claims-evidence probe", "test-claims.ts"],
  ["Craft laws (writer/critic/hooks)", "test-craft-laws.ts"],
  ["Genre identity (afro≠reggaeton)", "test-genre-identity.ts"],
  ["Engine adapters (no silent stub)", "test-engine-adapters.ts"],
  ["Production runtime safety", "test-runtime-safety.ts"],
  ["Video provider contracts", "test-video-providers.ts"],
  ["Video shot billing", "test-video-storyboard.ts"],
  ["Video render evidence", "test-video-evidence.ts"],
  ["Media adapters fail closed", "test-media-adapter-safety.ts"],
  ["Email delivery truth", "test-email-delivery.ts"],
  ["Distribution lifecycle contract", "test-distribution-contract.ts"],
  ["Music provider contracts", "test-music-provider-contracts.ts"],
  ["Stem format + persistence integrity", "test-stem-integrity.ts"],
  ["Voice consent enforcement", "test-voice-consent-enforcement.ts"],
  ["Song edit arrangement integrity", "test-song-edit-arrangement.ts"],
  ["Music route capabilities", "test-music-capabilities.ts"],
  ["Genre kits (42 producer kits)", "test-genre-kits.ts"],
  ["Material system (forge/layer/pan)", "test-material-system.ts"],
  ["Material provenance + usage laws", "test-material-provenance.ts"],
  ["Training isolation (lane/pin/zap)", "test-training-isolation.ts"],
  ["Singing brain (sung-form laws)", "test-singing-brain.ts"],
  ["Melody brain (composed, not guessed)", "test-melody-brain.ts"],
  ["Vocal assets + mix truth", "test-vocal-assets.ts"],
  ["Title law (brand, not sentence)", "test-title-law.ts"],
  ["Catalogue QA (blocks the garbage)", "test-lyric-qa.ts"],
  ['SONG_STATE (no AI "mastered")', "test-song-state.ts"],
  ["Night law (bulk run never bills Claude)", "test-night-law.ts"],
  ["Hit concept gate (emotion, not scenery)", "test-concept-gate.ts"],
  ["Security boundaries", "test-security-boundaries.ts"],
  ["Durable jobs + billing receipts", "test-durable-workflows.ts"],
  ["Job redelivery + refund durability", "test-job-durability.ts"],
  ["Mix source lineage", "test-mix-lineage.ts"],
  ["Generated full-song lineage", "test-generated-full-song-lineage.ts"],
  ["Voice singing lineage", "test-voice-sing-lineage.ts"],
  ["Release lineage integrity", "test-release-lineage-integrity.mjs"],
  ["Derived audio lineage", "test-derived-audio-lineage.ts"],
];
for (const [name, file] of TS) {
  if (!existsSync(join(scripts, file))) {
    results.push({
      name,
      status: "SKIP",
      note: "script missing",
      required: false,
    });
    continue;
  }
  const { code, out } = runTsx(file);
  if (code !== 0 && out.trim()) console.error(out.trim());
  results.push({
    name,
    status: code === 0 ? "PASS" : "FAIL",
    note: code === 0 ? "" : "see output above",
    required: true,
  });
}

// ---- Phase 0 real acceptance (needs Benjamin's 9 rights-clean tracks) — INFO ----
{
  const { code, out } = runTsx("eval-ear.ts");
  const note =
    code === 0
      ? "all gates passed on real audio"
      : /needs 9|0 real rows|manifest/i.test(out)
        ? "awaiting 9 reference tracks (3 amapiano + 3 afrobeats + 3 house)"
        : "DSP engine or fixtures unavailable";
  results.push({
    name: "P0  Ear acceptance (real audio)",
    status: code === 0 ? "PASS" : "INFO",
    note,
    required: false,
  });
}

async function main() {
  // ---- Live API health (optional) ----
  if (wantLive) {
    const api =
      process.env.API_URL ||
      "https://afrohitapi-production.up.railway.app/api/v1";
    try {
      const res = await fetch(`${api}/debug/ai`, {
        signal: AbortSignal.timeout(20000),
      });
      const d = (await res.json()) as {
        brainOk?: boolean;
        brainStatus?: string;
        anthropic?: { ok?: boolean };
        openai?: { ok?: boolean };
        audd?: { configured?: boolean };
        engineRoute?: { engine?: string; ceiling?: string };
      };
      results.push({
        name: "LIVE brain (Claude/OpenAI)",
        status: d.brainOk ? "PASS" : "FAIL",
        note:
          d.brainStatus || `claude=${d.anthropic?.ok} openai=${d.openai?.ok}`,
        required: false,
      });
      results.push({
        name: "LIVE Zap (AudD configured)",
        status: d.audd?.configured ? "PASS" : "INFO",
        note: d.audd?.configured ? "configured" : "set AUDD_API_TOKEN",
        required: false,
      });
      results.push({
        name: "LIVE engine route",
        status: "INFO",
        note: `${d.engineRoute?.engine} (${d.engineRoute?.ceiling})`,
        required: false,
      });
    } catch (e) {
      results.push({
        name: "LIVE API health",
        status: "SKIP",
        note: `unreachable (${(e as Error).message})`,
        required: false,
      });
    }
  }

  // ---- Summary ----
  const icon = (s: Result["status"]) =>
    s === "PASS"
      ? "[PASS]"
      : s === "FAIL"
        ? "[FAIL]"
        : s === "SKIP"
          ? "[SKIP]"
          : "[INFO]";
  console.log(
    "\n============== AfroHit - Lane pipeline test suite =============="
  );
  for (const r of results)
    console.log(`${icon(r.status)} ${r.name.padEnd(32)} ${r.note}`);
  const failed = results.filter(r => r.required && r.status === "FAIL");
  console.log(
    "----------------------------------------------------------------"
  );
  const required = results.filter(r => r.required);
  console.log(
    `Required: ${required.filter(r => r.status === "PASS").length}/${required.length} passed` +
      (wantLive ? "" : "   (add --live to also check the deployed API)")
  );
  const informational = results.filter(r => !r.required && r.status !== "PASS");
  console.log(
    failed.length
      ? `\nSUITE FAILED - ${failed.map(f => f.name.trim()).join(", ")}\n`
      : informational.length
        ? "\nREQUIRED OFFLINE PROOFS PASSED - external or environment-gated acceptance remains listed above.\n"
        : "\nSUITE PASSED - every listed proof passed.\n"
  );
  // Set the code and let the loop drain naturally. On Windows + Node 24, calling
  // process.exit() while a spawned/socket handle is mid-close hits a libuv assertion
  // and corrupts the exit code — so we DON'T force-exit.
  process.exitCode = failed.length ? 1 : 0;
}

void main();

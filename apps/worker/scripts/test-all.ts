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
 * Override the 2-minute standard leaf timeout with AFROHIT_TEST_TIMEOUT_MS and
 * the 10-minute synthetic/real ear timeout with AFROHIT_DSP_TIMEOUT_MS.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = process.cwd(); // worker package dir when run via pnpm --filter
const scripts = join(root, "scripts");
const wantLive = process.argv.includes("--live");
const requireDsp = process.env.REQUIRE_DSP === "1";
const leafTimeoutEnv = "AFROHIT_TEST_TIMEOUT_MS";
const dspTimeoutEnv = "AFROHIT_DSP_TIMEOUT_MS";
const defaultLeafTimeoutMs = 120_000;
const defaultDspTimeoutMs = 600_000;
const progressIntervalMs = 15_000;
const forceKillDelayMs = 1_000;
const closeEventGraceMs = 5_000;
const maxTimerMs = 2_147_483_647;
const tsxCli = createRequire(join(root, "package.json")).resolve("tsx/cli");

function configuredTimeoutMs(envName: string, defaultMs: number): number {
  const raw = process.env[envName]?.trim();
  if (!raw) return defaultMs;

  if (!/^[1-9]\d*$/.test(raw)) {
    console.warn(
      `[WARN] Ignoring invalid ${envName}=${JSON.stringify(raw)}; using ${defaultMs}ms.`
    );
    return defaultMs;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > maxTimerMs) {
    console.warn(
      `[WARN] Ignoring out-of-range ${envName}=${JSON.stringify(raw)}; using ${defaultMs}ms.`
    );
    return defaultMs;
  }
  return parsed;
}

const leafTimeoutMs = configuredTimeoutMs(leafTimeoutEnv, defaultLeafTimeoutMs);
const dspTimeoutMs = configuredTimeoutMs(dspTimeoutEnv, defaultDspTimeoutMs);

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const seconds = Math.ceil(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

type Result = {
  name: string;
  status: "PASS" | "FAIL" | "SKIP" | "INFO";
  note: string;
  required: boolean;
};
const results: Result[] = [];

type LeafResult = {
  code: number | null;
  out: string;
  timedOut: boolean;
  error?: NodeJS.ErrnoException;
};

type RunLeafOptions = {
  cwd?: string;
  timeoutMs?: number;
  progressMs?: number;
};

async function runLeaf(
  label: string,
  command: string,
  args: readonly string[],
  options: RunLeafOptions = {}
): Promise<LeafResult> {
  const timeoutMs = options.timeoutMs ?? leafTimeoutMs;
  const heartbeatMs = options.progressMs ?? progressIntervalMs;
  const startedAt = Date.now();
  console.log(`[RUN ] ${label} (timeout ${formatDuration(timeoutMs)})`);

  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd ?? root,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      const spawnError = error as NodeJS.ErrnoException;
      console.log(`[DONE] ${label} (could not start)`);
      resolve({
        code: null,
        out: spawnError.message,
        timedOut: false,
        error: spawnError,
      });
      return;
    }

    let out = "";
    let timedOut = false;
    let settled = false;
    let spawnError: NodeJS.ErrnoException | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let closeEventTimer: NodeJS.Timeout | undefined;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      out += chunk;
    });

    const heartbeat = setInterval(() => {
      console.log(
        `[WAIT] ${label} (${formatDuration(Date.now() - startedAt)} elapsed)`
      );
    }, heartbeatMs);

    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
      closeReported = true
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (closeEventTimer) clearTimeout(closeEventTimer);

      if (!closeReported) {
        const message = `${label} did not report process closure after forced termination`;
        out += `${out ? "\n" : ""}${message}`;
        console.error(`[WARN] ${message}; continuing.`);
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
      }

      const elapsed = formatDuration(Date.now() - startedAt);
      const outcome = timedOut
        ? "timed out"
        : spawnError
          ? "could not start"
          : code === null
            ? `signal ${signal ?? "unknown"}`
            : `exit ${code}`;
      console.log(`[DONE] ${label} (${elapsed}, ${outcome})`);
      resolve({ code, out, timedOut, error: spawnError });
    };

    const requestKill = (signal: NodeJS.Signals) => {
      try {
        child.kill(signal);
      } catch (error) {
        const message = (error as Error).message;
        out += `${out ? "\n" : ""}${message}`;
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(
        `[TIMEOUT] ${label} exceeded ${formatDuration(timeoutMs)}; terminating.`
      );
      requestKill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          requestKill("SIGKILL");
      }, forceKillDelayMs);
      closeEventTimer = setTimeout(() => {
        finish(child.exitCode, child.signalCode, false);
      }, closeEventGraceMs);
    }, timeoutMs);

    child.once("error", error => {
      spawnError = error as NodeJS.ErrnoException;
      out += `${out ? "\n" : ""}${spawnError.message}`;
      if (child.pid === undefined) finish(null, null);
    });

    child.once("close", (code, signal) => {
      finish(code, signal);
    });
  });
}

function runTsx(
  label: string,
  file: string,
  options: RunLeafOptions = {}
): Promise<LeafResult> {
  return runLeaf(
    label,
    process.execPath,
    [tsxCli, join(scripts, file)],
    options
  );
}

type PythonResult = LeafResult & { unavailable: boolean };

async function runPython(
  label: string,
  file: string,
  options: RunLeafOptions = {}
): Promise<PythonResult> {
  const bins = [process.env.PYTHON_BIN, "python", "python3"].filter(
    (bin, index, all): bin is string =>
      Boolean(bin) && all.indexOf(bin) === index
  );
  for (const bin of bins) {
    const result = await runLeaf(`${label} [${bin}]`, bin, [file], {
      ...options,
      cwd: options.cwd ?? root,
    });
    if (result.error?.code === "ENOENT") continue; // try next python
    return { ...result, unavailable: false };
  }
  return {
    code: null,
    out: "no python interpreter found",
    timedOut: false,
    unavailable: true,
  };
}

async function runOfflineTests(): Promise<void> {
  // ---- Phase 0: the ear (Python DSP) ----
  {
    const { code, out, timedOut } = await runPython(
      "P0  The ear (DSP)",
      join(scripts, "synth_eartest.py"),
      { timeoutMs: dspTimeoutMs }
    );
    if (!timedOut && /DSP stack unavailable/i.test(out))
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
        note:
          code === 0
            ? "all 3 gates OK"
            : timedOut
              ? `timed out after ${formatDuration(dspTimeoutMs)}`
              : "see output",
        required: true,
      });
  }

  // ---- Owned synth: genre + key awareness (pure numpy, no libsndfile) ----
  {
    const { code, out, timedOut, unavailable } = await runPython(
      "Synth genre+key aware",
      "test_synth.py",
      { cwd: join(root, "py") }
    );
    if (!timedOut && (code === 2 || /SKIP/i.test(out) || unavailable))
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
        note:
          code === 0
            ? ""
            : timedOut
              ? `timed out after ${formatDuration(leafTimeoutMs)}`
              : out.slice(-200),
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
    ["Feature runtime readiness", "test-config-readiness.ts"],
    ["Video provider contracts", "test-video-providers.ts"],
    ["Video engine tiers (class wall + payloads)", "test-video-engine-tiers.ts"],
    ["Likeness laws (consent/photos/status)", "test-likeness-laws.ts"],
    ["Video shot billing", "test-video-storyboard.ts"],
    ["Video class pricing + render-all parity", "test-video-pricing.ts"],
    ["Video assembly gating (full/teaser)", "test-video-assembly.ts"],
    ["Video assembly speed (pool + folded brand pass)", "test-video-assembly-speed.ts"],
    ["Lip-sync laws (engine body/offsets/gate)", "test-lipsync.ts"],
    ["Video render evidence", "test-video-evidence.ts"],
    ["Brand wave (AfroHits/BXP/splash/watermark)", "test-brand-splash.ts"],
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
    ["SOUNDWAVE1 (verbatim forge/tempo/energy/QC/key)", "test-soundwave1.ts"],
    ["SOUNDWAVE2 (vocal forward + afro pocket + my voice)", "test-soundwave2.ts"],
    ["SOUNDCORE (lead+forge-route+fan-out+conform+sample-seam)", "test-soundcore.ts"],
    ["SOUNDWAVE3 (trained tempo + Learn/Zap wiring)", "test-soundwave3.ts"],
    ["Own-engine auto-forge (floor rescue)", "test-own-engine-autoforge.ts"],
    ["FORGEON (real forge = automatic default)", "test-forgeon.ts"],
    ["Bed-first streaming (synth preview -> forged -> master)", "test-bed-first-streaming.ts"],
    ["Material provenance + usage laws", "test-material-provenance.ts"],
    ["Training isolation (lane/pin/zap)", "test-training-isolation.ts"],
    ["Singing brain (sung-form laws)", "test-singing-brain.ts"],
    ["Melody brain (composed, not guessed)", "test-melody-brain.ts"],
    ["African singing wave (G2P/contour/swing/44.1k)", "test-singer.ts"],
    ["Vocal assets + mix truth", "test-vocal-assets.ts"],
    ["Title law (brand, not sentence)", "test-title-law.ts"],
    ["Catalogue QA (blocks the garbage)", "test-lyric-qa.ts"],
    ['SONG_STATE (no AI "mastered")', "test-song-state.ts"],
    ["Night law (bulk run never bills Claude)", "test-night-law.ts"],
    ["Song speed (cheap-first fit + forced-bulk melody + parallel + memo)", "test-song-speed.ts"],
    ["Video treatment brain-tier (Cerebras bulk)", "test-video-brain-tier.ts"],
    ["Hit concept gate (emotion, not scenery)", "test-concept-gate.ts"],
    ["Producer Brain (plan referee + wiring)", "test-producer-plan.ts"],
    ["Training flywheel (P3: gates+rights+wiring)", "test-training-flywheel.ts"],
    ["Training lifecycle (poll/dedupe/promote/rollback)", "test-training-lifecycle.ts"],
    ["Trained layer (training in the sound)", "test-trained-layer.ts"],
    ["Trainlegal (license lanes+FAD/WER+AfroRef+routes)", "test-trainlegal.ts"],
    ["Genre canon (the 4/12 -> 11/12 flip)", "test-genre-canon.ts"],
    ["Aggregate harness timeout/progress", "test-harness-timeout.ts"],
    ["Security boundaries", "test-security-boundaries.ts"],
    ["Durable jobs + billing receipts", "test-durable-workflows.ts"],
    ["Job redelivery + refund durability", "test-job-durability.ts"],
    ["Master report (density/match-EQ)", "test-master-report.ts"],
    ["Mix source lineage", "test-mix-lineage.ts"],
    ["Generated full-song lineage", "test-generated-full-song-lineage.ts"],
    ["Voice singing lineage", "test-voice-sing-lineage.ts"],
    ["AfroOne genuine singing", "test-afroone-singing.ts"],
    ["AfroOne controlled directions", "test-afroone-directions.ts"],
    ["Producer Evidence Pack", "test-producer-evidence.ts"],
    ["Unified acceptance readiness", "test-acceptance-readiness.ts"],
    ["Release lineage integrity", "test-release-lineage-integrity.mjs"],
    ["Legacy release lineage audit", "test-legacy-release-lineage-audit.ts"],
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
    const { code, out, timedOut } = await runTsx(name, file);
    if (code !== 0 && out.trim()) console.error(out.trim());
    results.push({
      name,
      status: code === 0 ? "PASS" : "FAIL",
      note:
        code === 0
          ? ""
          : timedOut
            ? `timed out after ${formatDuration(leafTimeoutMs)}`
            : "see output above",
      required: true,
    });
  }

  // ---- Phase 0 real acceptance (needs Benjamin's 9 rights-clean tracks) — INFO ----
  {
    const { code, out, timedOut } = await runTsx(
      "P0  Ear acceptance (real audio)",
      "eval-ear.ts",
      { timeoutMs: dspTimeoutMs }
    );
    const note =
      code === 0
        ? "all gates passed on real audio"
        : timedOut
          ? `timed out after ${formatDuration(dspTimeoutMs)}`
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
}

async function main() {
  console.log(
    `AfroHits test harness: ${formatDuration(leafTimeoutMs)} per standard leaf ` +
      `(${leafTimeoutEnv}), ${formatDuration(dspTimeoutMs)} per ear/DSP path ` +
      `(${dspTimeoutEnv}).`
  );
  await runOfflineTests();

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
    "\n============== AfroHits - Lane pipeline test suite =============="
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

async function runHarnessTimeoutProbe(
  configuredTimeoutMs: number
): Promise<void> {
  const probeTimeoutMs = Math.min(configuredTimeoutMs, 1_000);
  const result = await runLeaf(
    "Harness timeout probe",
    process.execPath,
    ["-e", "setTimeout(() => undefined, 60_000)"],
    {
      timeoutMs: probeTimeoutMs,
      progressMs: Math.max(1, Math.min(50, Math.floor(probeTimeoutMs / 3))),
    }
  );
  if (!result.timedOut)
    throw new Error("Harness timeout probe unexpectedly completed.");
  console.log(
    `HARNESS_TIMEOUT_PROBE_OK timeout=${formatDuration(probeTimeoutMs)}`
  );
}

const standardProbe = process.argv.includes("--internal-harness-timeout-probe");
const dspProbe = process.argv.includes("--internal-harness-dsp-timeout-probe");
const start: () => Promise<void> = standardProbe
  ? () => runHarnessTimeoutProbe(leafTimeoutMs)
  : dspProbe
    ? () => runHarnessTimeoutProbe(dspTimeoutMs)
    : main;
void start().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

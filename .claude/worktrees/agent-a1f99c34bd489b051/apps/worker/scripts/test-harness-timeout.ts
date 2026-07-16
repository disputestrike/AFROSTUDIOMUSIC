import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(scriptsDir, "..");
const tsxCli = createRequire(join(workerRoot, "package.json")).resolve(
  "tsx/cli"
);
const harness = join(scriptsDir, "test-all.ts");

function runProbe(argument: string, expectedTimeoutMs: number): void {
  const result = spawnSync(process.execPath, [tsxCli, harness, argument], {
    cwd: workerRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AFROHIT_TEST_TIMEOUT_MS: "250",
      AFROHIT_DSP_TIMEOUT_MS: "350",
    },
    shell: false,
    timeout: 10_000,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  assert.ifError(result.error);
  assert.equal(result.status, 0, output);
  assert.match(
    output,
    new RegExp(
      `\\[RUN \\] Harness timeout probe \\(timeout ${expectedTimeoutMs}ms\\)`
    ),
    output
  );
  assert.match(output, /\[WAIT\] Harness timeout probe/, output);
  assert.match(
    output,
    new RegExp(
      `\\[TIMEOUT\\] Harness timeout probe exceeded ${expectedTimeoutMs}ms`
    ),
    output
  );
  assert.match(
    output,
    new RegExp(`HARNESS_TIMEOUT_PROBE_OK timeout=${expectedTimeoutMs}ms`),
    output
  );
}

runProbe("--internal-harness-timeout-probe", 250);
runProbe("--internal-harness-dsp-timeout-probe", 350);

console.log("Aggregate harness timeout/progress: PASS");

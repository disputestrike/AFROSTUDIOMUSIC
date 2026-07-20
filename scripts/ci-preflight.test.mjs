import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  inspectLockfile,
  main,
  runPreflight,
  satisfiesEngine,
  scanMarkerText,
  summarizeGates,
} from "./ci-preflight.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("engine ranges accept supported versions and reject old versions", () => {
  assert.equal(satisfiesEngine("20.19.0", ">=20.10.0"), true);
  assert.equal(satisfiesEngine("24.14.0", ">=20.10.0"), true);
  assert.equal(satisfiesEngine("20.9.9", ">=20.10.0"), false);
  assert.equal(satisfiesEngine("21.0.0", ">=20.10.0 <21.0.0"), false);
});

test("marker scan fails unknown production placeholders but records reviewed limitations", () => {
  const unsafe = scanMarkerText("apps/api/src/example.ts", "throw new Error('not implemented');\n");
  assert.equal(unsafe.findings.length, 1);
  assert.equal(unsafe.findings[0].marker, "not-implemented");

  const reviewed = scanMarkerText(
    "apps/worker/src/lib/ffmpeg.ts",
    "// TODO(diagnosis follow-up): no kick->bass sidechain this pass - handled elsewhere\n"
  );
  assert.equal(reviewed.findings.length, 0);
  assert.equal(reviewed.reviewed.length, 1);
});

test("lockfile inspection fails closed when an importer specifier drifts", async () => {
  const root = await mkdtemp(join(tmpdir(), "afrostudio-preflight-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ packageManager: "pnpm@9.12.0", dependencies: { leftpad: "1.0.0" } }),
    "utf8"
  );
  await writeFile(join(root, "apps", "api", "package.json"), JSON.stringify({ dependencies: {} }), "utf8");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      leftpad:\n        specifier: 2.0.0\n        version: 2.0.0\n\n  apps/api: {}\n",
    "utf8"
  );
  await assert.rejects(() => inspectLockfile(root), /manifests and lockfile importers disagree/);
});

test("workflow summaries preserve failures and skipped downstream gates", () => {
  const summary = summarizeGates({ preflight: "success", install: "failure", build: "skipped" });
  assert.equal(summary.status, "fail");
  assert.deepEqual(summary.nonPassingGateIds, ["install", "build"]);
  assert.equal(summary.gates.at(-1).outcome, "skipped");
});

test("workflow finalization preserves preflight evidence and writes a job summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "afrostudio-evidence-"));
  const evidencePath = join(root, "ci-evidence.json");
  const summaryPath = join(root, "step-summary.md");
  await writeFile(
    evidencePath,
    JSON.stringify({
      schemaVersion: 1,
      kind: "afrostudio-ci-evidence",
      status: "pass",
      checks: [{ id: "preflight", title: "Repository preflight", status: "pass" }],
    }),
    "utf8"
  );

  await main(["--finalize"], {
    CI_EVIDENCE_PATH: evidencePath,
    CI_GATE_RESULTS_JSON: JSON.stringify({ preflight: "success", build: "failure" }),
    GITHUB_STEP_SUMMARY: summaryPath,
  });

  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const summary = await readFile(summaryPath, "utf8");
  assert.equal(evidence.status, "fail");
  assert.deepEqual(evidence.workflow.nonPassingGateIds, ["build"]);
  assert.match(summary, /Repository preflight:\*\* PASS/);
  assert.match(summary, /Workflow gates:\*\* FAIL/);
  assert.match(summary, /\| build \| FAILURE \|/);
});

test("the checked-in repository satisfies every preflight contract", async () => {
  const evidence = await runPreflight({
    rootDir: repositoryRoot,
    runtimeVersion: process.version,
    env: { ...process.env, CI: "false" },
  });
  assert.equal(
    evidence.status,
    "pass",
    JSON.stringify(evidence.checks.filter(check => check.status === "fail"), null, 2)
  );
  assert.equal(evidence.checks.length, 5);
});

import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXPECTED_CI_NODE = "20.19.0";
const EXPECTED_PYTHON = "3.11";
const PRODUCTION_ROOTS = [
  "apps/api/src",
  "apps/web/src",
  "apps/worker/src",
  "packages/ai/src",
  "packages/db/src",
  "packages/shared/src",
];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const REQUIRED_ROOT_SCRIPTS = [
  "build",
  "lint",
  "verify",
  "security:audit",
  "ci",
  "ci:preflight",
  "ci:preflight:test",
];
const REQUIRED_DB_SCRIPTS = ["generate", "build", "migrate:deploy", "migrate:safe"];
const REQUIRED_WORKFLOW_COMMANDS = [
  "pnpm install --frozen-lockfile",
  "pnpm --filter @afrohit/db migrate:safe",
  "prisma migrate status",
  "prisma migrate diff",
  "pnpm run lint",
  "pnpm run verify",
  "pnpm run build",
  "pnpm run security:audit",
];
const REQUIRED_EXTERNAL_DECLARATIONS = {
  storage: ["S3_ENDPOINT", "S3_BUCKET", "STORAGE_PRIVATE_CONFIRMED"],
  billing: ["PAYPAL_MODE", "PAYPAL_CLIENT_ID", "PAYPAL_WEBHOOK_ID"],
  music: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "REPLICATE_API_TOKEN", "MUSIC_PROVIDER"],
  video: ["VIDEO_PROVIDER", "GCP_PROJECT_ID", "VEO_MODEL", "OPENAI_VIDEO_MODEL"],
  distribution: ["DISTRIBUTOR", "DISTRIBUTOR_WEBHOOK_URL", "DISTRIBUTOR_WEBHOOK_SECRET"],
  observability: ["SENTRY_DSN", "POSTHOG_KEY"],
};
const REVIEWED_MARKERS = [
  {
    path: "apps/worker/src/lib/ffmpeg.ts",
    pattern: /TODO\(diagnosis follow-up\): no kick.*sidechain this pass/i,
    reason: "A scoped DSP limitation, not a fake implementation or user-facing placeholder.",
  },
  {
    path: "packages/ai/src/providers/voice.ts",
    pattern: /soundhelix\.com\/examples\/mp3/i,
    reason: "Development-only stub audio; production rejects the adapter and the worker rejects this host.",
  },
  {
    path: "packages/ai/src/tavily.ts",
    pattern: /example\.com\/trends/i,
    reason: "Development-only STUB_AI response; production runtime safety forbids STUB_AI.",
  },
  {
    path: "packages/shared/src/lyric-qa.ts",
    pattern: /placeholder\|tbd\|xxx/i,
    reason: "A validator that detects placeholder tokens in generated lyrics.",
  },
  {
    path: "packages/shared/src/lyric-qa.ts",
    pattern: /todo\\b\|\\bfixme/i,
    reason: "A validator that detects unfinished notes in generated lyrics.",
  },
];
const MARKER_PATTERNS = [
  { name: "unfinished-comment", pattern: /\b(?:TODO|FIXME|HACK|XXX)\b/i },
  { name: "not-implemented", pattern: /\bnot[ _-]?implemented\b/i },
  { name: "coming-soon", pattern: /\bcoming soon\b/i },
  { name: "filler-copy", pattern: /\blorem ipsum\b/i },
  { name: "placeholder-host", pattern: /(?:example\.com|soundhelix\.com|placehold\.co|via\.placeholder\.com)/i },
];

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function versionTuple(raw) {
  const match = String(raw).trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`invalid semantic version: ${raw}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = versionTuple(left);
  const b = versionTuple(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function satisfiesEngine(version, range) {
  const clauses = String(range).trim().split(/\s+/).filter(Boolean);
  if (!clauses.length) return false;
  return clauses.every(clause => {
    const match = clause.match(/^(>=|>|<=|<|=|\^|~)?(\d+\.\d+\.\d+)$/);
    if (!match) throw new Error(`unsupported engine clause: ${clause}`);
    const operator = match[1] ?? "=";
    const comparison = compareVersions(version, match[2]);
    if (operator === ">=") return comparison >= 0;
    if (operator === ">") return comparison > 0;
    if (operator === "<=") return comparison <= 0;
    if (operator === "<") return comparison < 0;
    if (operator === "=") return comparison === 0;
    if (operator === "^") return comparison >= 0 && versionTuple(version)[0] === versionTuple(match[2])[0];
    return comparison >= 0 && versionTuple(version).slice(0, 2).join(".") === versionTuple(match[2]).slice(0, 2).join(".");
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function packageManagerVersion(manifest) {
  const match = String(manifest.packageManager ?? "").match(/^pnpm@(\d+\.\d+\.\d+)$/);
  if (!match) fail("packageManager must pin an exact pnpm version", { actual: manifest.packageManager ?? null });
  return match[1];
}

function parseImporterSpecifiers(lockfileText) {
  const lines = lockfileText.split(/\r?\n/);
  const importers = new Map();
  let inImporters = false;
  let importer = null;
  let dependencySection = false;
  let dependency = null;

  for (const line of lines) {
    if (line === "importers:") {
      inImporters = true;
      continue;
    }
    if (!inImporters) continue;
    if (/^[^\s]/.test(line) && line.trim()) break;

    const importerMatch = line.match(/^ {2}([^\s][^:]*):\s*$/);
    if (importerMatch) {
      importer = importerMatch[1].replace(/^['"]|['"]$/g, "");
      importers.set(importer, new Map());
      dependencySection = false;
      dependency = null;
      continue;
    }
    if (!importer) continue;

    const sectionMatch = line.match(/^ {4}(dependencies|devDependencies|optionalDependencies):\s*$/);
    if (sectionMatch) {
      dependencySection = true;
      dependency = null;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      dependencySection = false;
      dependency = null;
      continue;
    }
    if (!dependencySection) continue;

    const dependencyMatch = line.match(/^ {6}(.+):\s*$/);
    if (dependencyMatch) {
      dependency = dependencyMatch[1].replace(/^['"]|['"]$/g, "");
      continue;
    }
    const specifierMatch = line.match(/^ {8}specifier:\s*(.+?)\s*$/);
    if (dependency && specifierMatch) {
      importers.get(importer).set(dependency, specifierMatch[1].replace(/^['"]|['"]$/g, ""));
    }
  }
  return importers;
}

async function workspaceManifestPaths(rootDir) {
  const paths = ["package.json"];
  for (const parent of ["apps", "packages"]) {
    const parentPath = join(rootDir, parent);
    if (!(await exists(parentPath))) continue;
    for (const entry of await readdir(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(parentPath, entry.name, "package.json");
      if (await exists(manifest)) paths.push(normalizePath(relative(rootDir, manifest)));
    }
  }
  return paths.sort();
}

export async function inspectLockfile(rootDir) {
  const manifest = await readJson(join(rootDir, "package.json"));
  const pnpmVersion = packageManagerVersion(manifest);
  const lockfileText = await readFile(join(rootDir, "pnpm-lock.yaml"), "utf8");
  if (/^(?:<{7}|={7}|>{7})/m.test(lockfileText)) fail("pnpm-lock.yaml contains merge-conflict markers");

  const lockVersionMatch = lockfileText.match(/^lockfileVersion:\s*['"]?([^'"\s]+)['"]?/m);
  if (!lockVersionMatch) fail("pnpm-lock.yaml does not declare lockfileVersion");
  const lockMajor = Number.parseInt(lockVersionMatch[1], 10);
  const pnpmMajor = versionTuple(pnpmVersion)[0];
  if (lockMajor !== pnpmMajor) {
    fail("pnpm and lockfile major versions disagree", { pnpmVersion, lockfileVersion: lockVersionMatch[1] });
  }

  const importers = parseImporterSpecifiers(lockfileText);
  const manifests = await workspaceManifestPaths(rootDir);
  const overrides = Object.entries(manifest.pnpm?.overrides ?? {});
  const mismatches = [];
  for (const manifestPath of manifests) {
    const importerName = manifestPath === "package.json" ? "." : normalizePath(dirname(manifestPath));
    const workspaceManifest = await readJson(join(rootDir, manifestPath));
    const locked = importers.get(importerName);
    if (!locked) {
      mismatches.push(`${importerName}: missing lockfile importer`);
      continue;
    }
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, specifier] of Object.entries(workspaceManifest[section] ?? {})) {
        const lockedSpecifier = locked.get(name);
        const appliedOverride = overrides.find(([coordinate, replacement]) => {
          const packageName = coordinate.startsWith("@")
            ? coordinate.slice(0, coordinate.indexOf("@", 1) === -1 ? coordinate.length : coordinate.indexOf("@", 1))
            : coordinate.split("@")[0];
          return packageName === name && replacement === lockedSpecifier;
        });
        if (lockedSpecifier !== specifier && !appliedOverride) {
          mismatches.push(`${importerName}:${name}: manifest=${specifier} lock=${locked.get(name) ?? "missing"}`);
        }
      }
    }
  }
  if (mismatches.length) fail("package manifests and lockfile importers disagree", { mismatches });

  return {
    pnpmVersion,
    lockfileVersion: lockVersionMatch[1],
    sha256: hash(lockfileText),
    importerCount: importers.size,
    manifestCount: manifests.length,
  };
}

function markerIsReviewed(path, line) {
  return REVIEWED_MARKERS.some(item => item.path === path && item.pattern.test(line));
}

export function scanMarkerText(path, text) {
  const findings = [];
  const reviewed = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const marker of MARKER_PATTERNS) {
      if (!marker.pattern.test(line)) continue;
      const item = { path, line: index + 1, marker: marker.name, excerpt: line.trim().slice(0, 240) };
      if (markerIsReviewed(path, line)) reviewed.push(item);
      else findings.push(item);
      break;
    }
  }
  return { findings, reviewed };
}

async function walkSourceFiles(rootDir, path, output) {
  const absolute = join(rootDir, path);
  if (!(await exists(absolute))) return;
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const child = normalizePath(join(path, entry.name));
    if (entry.isDirectory()) {
      if (["dist", "node_modules", "test", "tests", "__fixtures__"].includes(entry.name)) continue;
      await walkSourceFiles(rootDir, child, output);
      continue;
    }
    const extension = entry.name.includes(".") ? `.${entry.name.split(".").at(-1)}` : "";
    if (!SOURCE_EXTENSIONS.has(extension) || /\.(?:test|spec)\.[^.]+$/.test(entry.name)) continue;
    output.push(child);
  }
}

async function inspectProductionMarkers(rootDir) {
  const files = [];
  for (const productionRoot of PRODUCTION_ROOTS) await walkSourceFiles(rootDir, productionRoot, files);

  const findings = [];
  const reviewed = [];
  for (const path of [...new Set(files)].sort()) {
    const result = scanMarkerText(path, await readFile(join(rootDir, path), "utf8"));
    findings.push(...result.findings);
    reviewed.push(...result.reviewed);
  }

  const runtimeSafety = await readFile(join(rootDir, "packages/shared/src/runtime-safety.ts"), "utf8");
  const apiEntry = await readFile(join(rootDir, "apps/api/src/index.ts"), "utf8");
  const workerEntry = await readFile(join(rootDir, "apps/worker/src/index.ts"), "utf8");
  const voiceProvider = await readFile(join(rootDir, "packages/ai/src/providers/voice.ts"), "utf8");
  const trendsProvider = await readFile(join(rootDir, "packages/ai/src/tavily.ts"), "utf8");
  const musicProcessor = await readFile(join(rootDir, "apps/worker/src/processors/music.ts"), "utf8");
  const safetyTokens = ["STUB_AI", "ALLOW_STUB_AUDIO", "MUSIC_PROVIDER", "VOICE_PROVIDER", "VIDEO_PROVIDER", "IMAGE_PROVIDER"];
  const missingSafetyTokens = safetyTokens.filter(token => !runtimeSafety.includes(token));
  if (!runtimeSafety.includes("REFUSING TO BOOT") || missingSafetyTokens.length) {
    findings.push({
      path: "packages/shared/src/runtime-safety.ts",
      line: 1,
      marker: "incomplete-production-stub-guard",
      excerpt: `missing safety tokens: ${missingSafetyTokens.join(", ") || "REFUSING TO BOOT"}`,
    });
  }
  for (const [path, content] of [["apps/api/src/index.ts", apiEntry], ["apps/worker/src/index.ts", workerEntry]]) {
    if (!content.includes("assertProductionRuntimeSafety(process.env)")) {
      findings.push({ path, line: 1, marker: "missing-production-stub-guard", excerpt: "startup does not assert production runtime safety" });
    }
  }
  if (!voiceProvider.includes("process.env.NODE_ENV === 'production'") || !voiceProvider.includes("stub voice audio is disabled")) {
    findings.push({ path: "packages/ai/src/providers/voice.ts", line: 1, marker: "unguarded-development-stub", excerpt: "voice stub lacks an explicit production rejection" });
  }
  if (!trendsProvider.includes("process.env.STUB_AI === '1'")) {
    findings.push({ path: "packages/ai/src/tavily.ts", line: 1, marker: "unguarded-development-stub", excerpt: "trend stub is not gated by STUB_AI" });
  }
  if (!musicProcessor.includes("/soundhelix\\.com/i") || !musicProcessor.includes("placeholder audio blocked")) {
    findings.push({ path: "apps/worker/src/processors/music.ts", line: 1, marker: "missing-placeholder-host-rejection", excerpt: "music worker does not reject the development placeholder host" });
  }
  if (findings.length) fail("unreviewed placeholder, stub, or unfinished markers exist in production paths", { findings, reviewed });
  return { filesScanned: files.length, reviewedMarkers: reviewed };
}

async function inspectRuntimeAndWorkflow(rootDir, runtimeVersion, env) {
  const manifest = await readJson(join(rootDir, "package.json"));
  const pnpmVersion = packageManagerVersion(manifest);
  if (!satisfiesEngine(runtimeVersion, manifest.engines?.node ?? "")) {
    fail("current Node runtime does not satisfy package.json engines.node", {
      runtimeVersion,
      engine: manifest.engines?.node ?? null,
    });
  }
  if (env.CI === "true" && compareVersions(runtimeVersion, EXPECTED_CI_NODE) !== 0) {
    fail("CI must run the repository's pinned Node runtime", { expected: EXPECTED_CI_NODE, actual: runtimeVersion });
  }

  const workflow = await readFile(join(rootDir, ".github/workflows/ci.yml"), "utf8");
  const requiredPins = [
    "actions/checkout@v4",
    "actions/setup-python@v5",
    "pnpm/action-setup@v4",
    "actions/setup-node@v4",
    `node-version: ${EXPECTED_CI_NODE}`,
    `python-version: "${EXPECTED_PYTHON}"`,
    `version: ${pnpmVersion}`,
    "actions/upload-artifact@v4",
  ];
  const missingPins = requiredPins.filter(token => !workflow.includes(token));
  const missingCommands = REQUIRED_WORKFLOW_COMMANDS.filter(command => !workflow.includes(command));
  if (missingPins.length || missingCommands.length) {
    fail("CI workflow is missing required compatible pins or heavyweight gates", { missingPins, missingCommands });
  }
  return {
    runtimeVersion: runtimeVersion.replace(/^v/, ""),
    engine: manifest.engines.node,
    ciNodeVersion: EXPECTED_CI_NODE,
    pythonVersion: EXPECTED_PYTHON,
    pnpmVersion,
    actionRuntimeLine: "Node 20-compatible setup actions (setup-node v4, setup-python v5)",
  };
}

async function inspectScriptsAndMigrations(rootDir) {
  const manifest = await readJson(join(rootDir, "package.json"));
  const dbManifest = await readJson(join(rootDir, "packages/db/package.json"));
  const missingRootScripts = REQUIRED_ROOT_SCRIPTS.filter(name => !manifest.scripts?.[name]);
  const missingDbScripts = REQUIRED_DB_SCRIPTS.filter(name => !dbManifest.scripts?.[name]);
  if (missingRootScripts.length || missingDbScripts.length) {
    fail("required CI or database scripts are missing", { missingRootScripts, missingDbScripts });
  }

  const migrationRoot = join(rootDir, "packages/db/prisma/migrations");
  const migrationNames = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  if (!migrationNames.length) fail("no Prisma migrations were found");
  const invalid = [];
  for (const name of migrationNames) {
    if (!/^\d{14}_[a-z0-9_]+$/.test(name)) invalid.push(`${name}: invalid migration directory name`);
    const migrationPath = join(migrationRoot, name, "migration.sql");
    if (!(await exists(migrationPath))) {
      invalid.push(`${name}: migration.sql is missing`);
      continue;
    }
    const sql = await readFile(migrationPath, "utf8");
    if (!sql.trim()) invalid.push(`${name}: migration.sql is empty`);
    if (/^(?:<{7}|={7}|>{7})/m.test(sql)) invalid.push(`${name}: migration.sql contains conflict markers`);
    if (/\b(?:TODO|FIXME|PLACEHOLDER|NOT[ _-]?IMPLEMENTED)\b/i.test(sql)) invalid.push(`${name}: migration.sql contains unfinished markers`);
  }
  if (invalid.length) fail("migration history is incomplete or ambiguous", { invalid });
  return { migrationCount: migrationNames.length, firstMigration: migrationNames[0], latestMigration: migrationNames.at(-1) };
}

function parseEnvDeclarations(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match) names.add(match[1]);
  }
  return names;
}

async function inspectExternalDeclarations(rootDir) {
  const envText = await readFile(join(rootDir, ".env.example"), "utf8");
  const declarations = parseEnvDeclarations(envText);
  const missing = {};
  for (const [integration, names] of Object.entries(REQUIRED_EXTERNAL_DECLARATIONS)) {
    const absent = names.filter(name => !declarations.has(name));
    if (absent.length) missing[integration] = absent;
  }

  const railway = {};
  for (const app of ["api", "worker", "web"]) {
    const path = `apps/${app}/railway.json`;
    const config = await readJson(join(rootDir, path));
    const startCommand = config.deploy?.startCommand;
    if (!startCommand || !startCommand.includes(`@afrohit/${app}`)) {
      missing[`railway-${app}`] = ["deploy.startCommand"];
    }
    if (app !== "worker" && !config.deploy?.healthcheckPath) {
      missing[`railway-${app}`] = [...(missing[`railway-${app}`] ?? []), "deploy.healthcheckPath"];
    }
    if (app === "api" && !String(config.deploy?.preDeployCommand ?? "").includes("migrate:safe")) {
      missing[`railway-${app}`] = [...(missing[`railway-${app}`] ?? []), "deploy.preDeployCommand:migrate:safe"];
    }
    if (app === "worker") {
      const dockerfilePath = config.build?.dockerfilePath;
      if (!dockerfilePath || !(await exists(join(rootDir, dockerfilePath)))) {
        missing[`railway-${app}`] = [...(missing[`railway-${app}`] ?? []), "build.dockerfilePath"];
      }
    } else if (!String(config.build?.buildCommand ?? "").includes("pnpm install --frozen-lockfile")) {
      missing[`railway-${app}`] = [...(missing[`railway-${app}`] ?? []), "build.buildCommand:frozen-lockfile"];
    }
    railway[app] = { path, startCommand, healthcheckPath: config.deploy?.healthcheckPath ?? null };
  }
  if (Object.keys(missing).length) fail("external integration declarations are incomplete", { missing });
  return {
    declaredIntegrations: Object.fromEntries(Object.entries(REQUIRED_EXTERNAL_DECLARATIONS).map(([name, keys]) => [name, keys.length])),
    railway,
    externalChecks: {
      githubRunnerBilling: { verified: false, owner: "GitHub account settings" },
      cloudflareWorkersBuild: { verified: false, owner: "External Cloudflare integration; no repository-owned Worker configuration" },
      railwayDeploymentHealth: { verified: false, owner: "Railway runtime" },
      providerCredentialsQuotasAndOutput: { verified: false, owner: "Configured third-party providers" },
    },
    limitation: "Declarations are verified locally. Credentials, provider availability, Railway deploys, Cloudflare builds, and GitHub account billing require external evidence.",
  };
}

async function executeCheck(id, title, operation) {
  const startedAt = new Date().toISOString();
  try {
    const details = await operation();
    return { id, title, status: "pass", startedAt, completedAt: new Date().toISOString(), details };
  } catch (error) {
    return {
      id,
      title,
      status: "fail",
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      details: error?.details ?? {},
    };
  }
}

export async function runPreflight({ rootDir = DEFAULT_ROOT, runtimeVersion = process.version, env = process.env } = {}) {
  const resolvedRoot = resolve(rootDir);
  const checks = [];
  checks.push(await executeCheck("runtime-workflow", "Runtime and workflow compatibility", () => inspectRuntimeAndWorkflow(resolvedRoot, runtimeVersion, env)));
  checks.push(await executeCheck("lockfile", "Manifest and lockfile consistency", () => inspectLockfile(resolvedRoot)));
  checks.push(await executeCheck("scripts-migrations", "Required scripts and migration history", () => inspectScriptsAndMigrations(resolvedRoot)));
  checks.push(await executeCheck("production-markers", "Production placeholder and stub safety", () => inspectProductionMarkers(resolvedRoot)));
  checks.push(await executeCheck("external-declarations", "External integration declarations", () => inspectExternalDeclarations(resolvedRoot)));

  const failed = checks.filter(check => check.status === "fail");
  return {
    schemaVersion: 1,
    kind: "afrostudio-ci-evidence",
    generatedAt: new Date().toISOString(),
    repositoryRoot: normalizePath(resolvedRoot),
    status: failed.length ? "fail" : "pass",
    checks,
    externalLimitations: [
      "A GitHub-hosted job blocked before runner allocation cannot produce repository-side logs or artifacts; inspect GitHub billing and spending limits.",
      "This preflight validates integration declarations, not live third-party credentials, quotas, provider output quality, or deployment health.",
    ],
  };
}

export function summarizeGates(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("CI_GATE_RESULTS_JSON must be a JSON object");
  const gates = Object.entries(parsed).map(([id, outcome]) => ({ id, outcome: String(outcome) }));
  const nonPassing = gates.filter(gate => gate.outcome !== "success");
  return {
    status: nonPassing.length ? "fail" : "pass",
    gates,
    nonPassingGateIds: nonPassing.map(gate => gate.id),
  };
}

function markdownSummary(evidence) {
  const repositoryStatus = evidence.checks.some(check => check.status === "fail") ? "FAIL" : "PASS";
  const rows = evidence.checks.map(check => `| ${check.title} | ${check.status === "pass" ? "PASS" : "FAIL"} | ${check.status === "pass" ? "Repository evidence recorded" : check.error} |`);
  const workflowRows = (evidence.workflow?.gates ?? []).map(gate => `| ${gate.id} | ${gate.outcome.toUpperCase()} | GitHub step outcome |`);
  return [
    "## AfroStudio CI evidence",
    "",
    `**Repository preflight:** ${repositoryStatus}`,
    `**Workflow gates:** ${evidence.workflow?.status?.toUpperCase() ?? "NOT FINALIZED"}`,
    "",
    "| Gate | Result | Detail |",
    "| --- | --- | --- |",
    ...rows,
    ...workflowRows,
    "",
    "> External boundary: GitHub account billing/runner allocation, deployment services, credentials, provider availability, and output quality are not proven by repository CI.",
    "",
  ].join("\n");
}

async function writeEvidence(path, evidence) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function appendStepSummary(markdown, env) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  await mkdir(dirname(env.GITHUB_STEP_SUMMARY), { recursive: true });
  const previous = (await exists(env.GITHUB_STEP_SUMMARY)) ? await readFile(env.GITHUB_STEP_SUMMARY, "utf8") : "";
  await writeFile(env.GITHUB_STEP_SUMMARY, `${previous}${markdown}`, "utf8");
}

async function finalizeWorkflow(env) {
  const evidencePath = resolve(env.CI_EVIDENCE_PATH ?? "tmp/ci-evidence.json");
  let evidence;
  try {
    evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch {
    evidence = {
      schemaVersion: 1,
      kind: "afrostudio-ci-evidence",
      generatedAt: new Date().toISOString(),
      status: "fail",
      checks: [{ id: "preflight", title: "Repository preflight", status: "fail", error: "Preflight evidence was not produced." }],
      externalLimitations: [],
    };
  }
  const workflow = summarizeGates(env.CI_GATE_RESULTS_JSON ?? "{}");
  evidence.workflow = workflow;
  if (workflow.status === "fail") evidence.status = "fail";
  evidence.completedAt = new Date().toISOString();
  await writeEvidence(evidencePath, evidence);
  await appendStepSummary(markdownSummary(evidence), env);
  console.log(`CI evidence finalized: ${evidence.status.toUpperCase()} (${evidencePath})`);
  if (workflow.nonPassingGateIds.length) {
    console.error(`Non-passing CI gates: ${workflow.nonPassingGateIds.join(", ")}`);
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.includes("--finalize")) {
    await finalizeWorkflow(env);
    return;
  }
  const rootDir = resolve(env.CI_REPOSITORY_ROOT ?? DEFAULT_ROOT);
  const evidencePath = resolve(env.CI_EVIDENCE_PATH ?? join(rootDir, "tmp/ci-evidence.json"));
  const evidence = await runPreflight({ rootDir, env });
  await writeEvidence(evidencePath, evidence);
  await appendStepSummary(markdownSummary(evidence), env);
  for (const check of evidence.checks) {
    const detail = check.status === "pass" ? "" : `: ${check.error}`;
    console[check.status === "pass" ? "log" : "error"](`[${check.status.toUpperCase()}] ${check.title}${detail}`);
  }
  console.log(`Machine-readable evidence: ${evidencePath}`);
  if (evidence.status !== "pass") process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(`CI preflight failed closed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}

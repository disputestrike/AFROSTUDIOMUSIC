#!/usr/bin/env node
/**
 * Production acceptance runner for a deployed AfroHit Studio stack.
 *
 * This script never enables stubs and never spends by default.
 *
 * Examples:
 *   API_URL=https://api.example.com AUTH_TOKEN=... node scripts/live-test.mjs
 *   API_URL=https://api.example.com AUTH_TOKEN=... ACCEPTANCE_MUSIC_ENGINE=minimax \
 *     node scripts/live-test.mjs --scopes infra,music,image --confirm-spend
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const KNOWN_SCOPES = new Set([
  "infra",
  "music",
  "vocal",
  "image",
  "video",
  "voice",
  "paypal",
  "distribution",
]);
const PAID_SCOPES = new Set([
  "music",
  "vocal",
  "image",
  "video",
  "voice",
  "paypal",
  "distribution",
]);
const TERMINAL_JOB_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);
const HASH = /^[a-f0-9]{64}$/i;
const args = process.argv.slice(2);

function argumentValue(name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function hasFlag(name) {
  return args.includes(name);
}

function help() {
  console.log(
    [
      "AfroHit production acceptance",
      "",
      "Required:",
      "  API_URL=https://... AUTH_TOKEN=<JWT>",
      "",
      "Options:",
      "  --scopes infra,music,vocal,image,video,voice,paypal,distribution",
      "  --all                 select every scope",
      "  --confirm-spend       required for every paid/external scope",
      "  --confirm-release     additionally required for distribution submission",
      "  --keep-project        retain the temporary acceptance project",
      "  --output <path>       evidence JSON path",
      "",
      "Provider inputs:",
      "  ACCEPTANCE_MUSIC_ENGINE=suno|eleven|ace_step|minimax",
      "  ACCEPTANCE_VOCAL_ENGINE=suno|eleven|ace_step|minimax",
      "  ACCEPTANCE_VOICE_ID=<ready profile id>",
      "  ACCEPTANCE_SOURCE_SONG_ID=<owned song with audio>",
      "  ACCEPTANCE_RELEASE_PROJECT_ID=<release-ready project>",
      "  ACCEPTANCE_RELEASE_SONG_ID=<release-ready song>",
    ].join("\n")
  );
}

if (hasFlag("--help") || hasFlag("-h")) {
  help();
  process.exit(0);
}

const apiUrl = String(process.env.API_URL ?? process.env.API_BASE ?? "")
  .trim()
  .replace(/\/+$/, "");
const token = String(process.env.AUTH_TOKEN ?? "").trim();
if (!apiUrl || !token) {
  help();
  throw new Error("API_URL and AUTH_TOKEN are required");
}
const parsedApi = new URL(apiUrl);
const localHost = ["localhost", "127.0.0.1", "::1"].includes(
  parsedApi.hostname
);
if (parsedApi.protocol !== "https:" && !localHost) {
  throw new Error("API_URL must use HTTPS outside localhost");
}

const requestedScopes = hasFlag("--all")
  ? [...KNOWN_SCOPES]
  : String(argumentValue("--scopes") ?? "infra")
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
const scopes = new Set(requestedScopes);
for (const scope of scopes) {
  if (!KNOWN_SCOPES.has(scope)) {
    throw new Error("unknown acceptance scope: " + scope);
  }
}
scopes.add("infra");
const selectedPaidScopes = [...scopes].filter(scope => PAID_SCOPES.has(scope));
if (selectedPaidScopes.length && !hasFlag("--confirm-spend")) {
  throw new Error(
    "--confirm-spend is required for scopes: " + selectedPaidScopes.join(", ")
  );
}
if (scopes.has("distribution") && !hasFlag("--confirm-release")) {
  throw new Error(
    "--confirm-release is required before a distributor submission"
  );
}

const runId = randomUUID();
const startedAt = new Date();
const timeoutMs = Math.max(
  60_000,
  Number(process.env.ACCEPTANCE_JOB_TIMEOUT_MS ?? 20 * 60_000)
);
const outputPath = resolve(
  argumentValue("--output") ??
    process.env.ACCEPTANCE_OUTPUT ??
    "artifacts/acceptance/live-" +
      startedAt.toISOString().replace(/[:.]/g, "-") +
      ".json"
);
const steps = [];
const jobs = [];
let projectId = null;
let preBilling = null;
let postBilling = null;

function canonicalize(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    );
  }
  return null;
}

function evidenceHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function identityHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
}

function idempotency(scope) {
  return "acceptance." + runId + "." + scope;
}

function errorDetail(error) {
  const status =
    error && typeof error === "object" && Number.isInteger(error.status)
      ? error.status
      : null;
  const body =
    error && typeof error === "object" && error.body ? error.body : null;
  const code =
    body && typeof body === "object"
      ? String(body.error ?? body.code ?? "")
      : "";
  const message =
    body && typeof body === "object"
      ? String(body.message ?? body.note ?? "")
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    status,
    code: code.slice(0, 120) || null,
    message: message
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/([?&](?:token|key|signature)=)[^&\s]+/gi, "$1[redacted]")
      .slice(0, 500),
  };
}

async function call(path, options = {}) {
  const method = options.method ?? "GET";
  const unsafe = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const headers = {
    accept: "application/json",
    ...(options.auth === false ? {} : { authorization: "Bearer " + token }),
    ...(unsafe ? { "x-afrohit-request": "1" } : {}),
    ...(options.body === undefined
      ? {}
      : { "content-type": "application/json" }),
    ...(options.idempotencyKey
      ? { "idempotency-key": options.idempotencyKey }
      : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(apiUrl + path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return { status: response.status, body };
}

function expectStatus(response, expected, label) {
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(response.status)) {
    const error = new Error(label + " returned HTTP " + response.status);
    error.status = response.status;
    error.body = response.body;
    throw error;
  }
  return response.body;
}

async function step(name, operation) {
  const began = Date.now();
  try {
    const detail = (await operation()) ?? {};
    steps.push({
      name,
      status: "PASS",
      durationMs: Date.now() - began,
      detail,
    });
    console.log("PASS  " + name);
    return detail;
  } catch (error) {
    steps.push({
      name,
      status: "FAIL",
      durationMs: Date.now() - began,
      detail: errorDetail(error),
    });
    console.error("FAIL  " + name + ": " + errorDetail(error).message);
    return null;
  }
}

function collectValues(value, key, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectValues(item, key, output);
  } else if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      if (childKey === key) output.push(child);
      collectValues(child, key, output);
    }
  }
  return output;
}

function assertNoPlaceholderEvidence(value) {
  const placeholders = collectValues(value, "placeholder");
  if (placeholders.some(item => item === true)) {
    throw new Error("job output is marked as a placeholder");
  }
  const quality = collectValues(value, "qualityState");
  if (
    quality.some(item =>
      ["failed", "pending", "unmeasured"].includes(String(item).toLowerCase())
    )
  ) {
    throw new Error("job output contains non-passing quality evidence");
  }
  const costCompleteness = collectValues(value, "costEvidenceComplete");
  if (costCompleteness.some(item => item !== true)) {
    throw new Error("job output contains incomplete provider-cost evidence");
  }
}

function validateSuccessfulJob(job, options) {
  if (!job || job.status !== "SUCCEEDED") {
    throw new Error("job did not succeed");
  }
  const execution = job.executionEvidence;
  if (
    !execution ||
    execution.realProvider !== true ||
    ["unavailable", "unknown"].includes(
      String(execution.providerClass).toLowerCase()
    )
  ) {
    throw new Error("job has no real-provider execution evidence");
  }
  if (!Number.isInteger(execution.chargedUnits) || execution.chargedUnits < 1) {
    throw new Error("job has no durable charged-unit receipt");
  }
  if (execution.refunded) {
    throw new Error("successful job was unexpectedly refunded");
  }
  if (
    options.requireCost !== false &&
    (!Number.isFinite(execution.estimatedCostUsd) ||
      execution.estimatedCostUsd <= 0)
  ) {
    throw new Error("job has no positive measured provider cost");
  }
  assertNoPlaceholderEvidence(job.outputJson);
  const hashes = collectValues(job.outputJson, "contentHash").filter(
    value => typeof value === "string" && HASH.test(value)
  );
  if (options.requireHash !== false && hashes.length === 0) {
    throw new Error("job output has no SHA-256 content evidence");
  }
  return {
    jobId: job.id,
    kind: job.kind,
    providerClass: execution.providerClass,
    estimatedCostUsd: execution.estimatedCostUsd,
    chargedCreditsCents: execution.chargedCreditsCents,
    chargedUnits: execution.chargedUnits,
    contentHashes: [...new Set(hashes)].sort(),
    finishedAt: job.finishedAt,
  };
}

async function pollJob(jobId, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? timeoutMs);
  for (;;) {
    const response = await call("/api/v1/jobs/" + jobId);
    const job = expectStatus(response, 200, "job poll");
    if (TERMINAL_JOB_STATES.has(job.status)) {
      if (job.status !== "SUCCEEDED") {
        const execution = job.executionEvidence ?? {};
        if (
          Number(execution.chargedCreditsCents ?? 0) > 0 &&
          execution.refunded !== true
        ) {
          throw new Error(
            "failed job did not expose a one-time refund receipt"
          );
        }
        const summary = {
          jobId: job.id,
          kind: job.kind,
          status: job.status,
          providerClass: execution.providerClass ?? null,
          chargedCreditsCents: execution.chargedCreditsCents ?? null,
          refunded: execution.refunded ?? false,
        };
        jobs.push(summary);
        throw Object.assign(new Error("provider job " + job.status), {
          body: job.errorJson,
        });
      }
      const summary = validateSuccessfulJob(job, options);
      jobs.push({ ...summary, status: job.status });
      return summary;
    }
    if (Date.now() >= deadline) {
      throw new Error("job " + jobId + " timed out");
    }
    await sleep(2_000);
  }
}

async function queueAndPoll(path, body, scope, options = {}) {
  const queued = await call(path, {
    method: "POST",
    body,
    idempotencyKey: idempotency(scope),
    timeoutMs: 90_000,
  });
  const response = expectStatus(queued, 202, scope + " queue");
  if (!response || typeof response.jobId !== "string") {
    throw new Error(scope + " did not return a job id");
  }
  return pollJob(response.jobId, options);
}

await step("health liveness", async () => {
  const response = await call("/health", { auth: false });
  const body = expectStatus(response, 200, "health");
  if (body?.ok !== true) throw new Error("health did not report ok");
  return { service: body.service ?? null };
});

await step("production auth rejects anonymous access", async () => {
  const response = await call("/api/v1/projects", { auth: false });
  if (![401, 403].includes(response.status)) {
    throw new Error(
      "anonymous API request was accepted with HTTP " + response.status
    );
  }
  return { status: response.status };
});

await step("authenticated identity", async () => {
  const response = await call("/api/v1/auth/me");
  const body = expectStatus(response, 200, "auth identity");
  if (!body?.userId || !body?.workspaceId) {
    throw new Error("authenticated identity is incomplete");
  }
  return {
    user: identityHash(body.userId),
    workspace: identityHash(body.workspaceId),
    plan: body.workspace?.plan ?? null,
  };
});

await step("dependency readiness", async () => {
  const response = await call("/health/ready", { auth: false });
  const body = expectStatus(response, 200, "readiness");
  if (body?.systemOk !== true) {
    throw Object.assign(new Error("dependencies are degraded"), {
      body,
    });
  }
  return {
    database: body.dependencies?.database === true,
    redis: body.dependencies?.redis === true,
    worker: body.dependencies?.worker === true,
    pendingOutbox: body.dependencies?.pendingOutbox ?? null,
  };
});

await step("billing preflight", async () => {
  const response = await call("/api/v1/billing/preflight");
  const body = expectStatus(response, 200, "billing preflight");
  if (selectedPaidScopes.length && body?.ok !== true) {
    throw Object.assign(new Error("workspace cannot afford acceptance"), {
      body,
    });
  }
  return {
    ok: body?.ok === true,
    mode: body?.mode ?? null,
    remainingToday: body?.remainingToday ?? null,
    remainingMonth: body?.remainingMonth ?? null,
    remainingDemos: body?.remainingDemos ?? null,
  };
});

await step("billing opening balance", async () => {
  const response = await call("/api/v1/billing/me");
  const body = expectStatus(response, 200, "billing balance");
  preBilling = {
    creditsCents: Number(body?.creditsCents ?? 0),
    plan: body?.plan ?? null,
  };
  return preBilling;
});

if (scopes.has("music") || scopes.has("vocal")) {
  await step("music route capability", async () => {
    const response = await call("/api/v1/settings/music-capabilities");
    const body = expectStatus(response, 200, "music capabilities");
    if (
      !["flagship", "advanced", "standard"].some(key => body?.[key] === true)
    ) {
      throw new Error("no real music route reports available");
    }
    return body;
  });
  await step("saved music credential authenticates", async () => {
    const response = await call("/api/v1/settings/integrations/test", {
      method: "POST",
      body: {},
      idempotencyKey: idempotency("credential-test"),
    });
    const body = expectStatus(response, 200, "music credential test");
    if (body?.ok !== true) {
      throw new Error("saved music credential was rejected");
    }
    return { ok: true };
  });
}

const needsProject = ["music", "vocal", "image", "video"].some(scope =>
  scopes.has(scope)
);
if (needsProject) {
  await step("temporary acceptance project", async () => {
    const response = await call("/api/v1/projects", {
      method: "POST",
      body: {
        title: "Production acceptance " + startedAt.toISOString(),
        genre: "amapiano",
        bpm: 112,
        keySignature: "F# minor",
      },
      idempotencyKey: idempotency("project"),
    });
    const body = expectStatus(response, 201, "project creation");
    if (!body?.id) throw new Error("project id is missing");
    projectId = body.id;
    return { project: identityHash(projectId), genre: body.genre };
  });
}

if (scopes.has("music")) {
  await step("real amapiano instrumental", async () => {
    if (!projectId) throw new Error("temporary project is unavailable");
    const engine = String(process.env.ACCEPTANCE_MUSIC_ENGINE ?? "").trim();
    if (!["suno", "eleven", "ace_step", "minimax"].includes(engine)) {
      throw new Error(
        "set ACCEPTANCE_MUSIC_ENGINE to an explicitly connected engine"
      );
    }
    return queueAndPoll(
      "/api/v1/projects/" + projectId + "/beats/generate",
      {
        genre: "amapiano",
        bpm: 112,
        keySignature: "F# minor",
        durationS: 30,
        vibePrompt:
          "South African amapiano, patient groove, log drum bass conversation, airy jazz keys, clean shaker pocket",
        instruments: ["log_drum", "soft_kick", "shaker", "rhodes"],
        withStems: true,
        withVocals: false,
        candidates: 1,
        songEngine: engine,
      },
      "music"
    );
  });
}

if (scopes.has("vocal")) {
  await step("real sung amapiano record", async () => {
    if (!projectId) throw new Error("temporary project is unavailable");
    const engine = String(
      process.env.ACCEPTANCE_VOCAL_ENGINE ??
        process.env.ACCEPTANCE_MUSIC_ENGINE ??
        ""
    ).trim();
    if (!["suno", "eleven", "ace_step", "minimax"].includes(engine)) {
      throw new Error(
        "set ACCEPTANCE_VOCAL_ENGINE to a connected vocal engine"
      );
    }
    return queueAndPoll(
      "/api/v1/projects/" + projectId + "/beats/generate",
      {
        genre: "amapiano",
        bpm: 112,
        keySignature: "F# minor",
        durationS: 45,
        vibePrompt:
          "South African amapiano with a patient log drum pocket and a memorable call-and-response chorus",
        languages: ["en", "zu"],
        voice: "female",
        lyrics:
          "[Verse]\nCity lights, I hear the rhythm calling\nStep by step, no fear of falling\n\n[Hook]\nSondela, dance with me tonight\nSondela, everything feels right\nHold the groove, let the whole room know\nSondela, we move it slow",
        richVocals: true,
        withStems: true,
        withVocals: true,
        candidates: 1,
        songEngine: engine,
      },
      "vocal"
    );
  });
}

if (scopes.has("image")) {
  await step("real cover art", async () => {
    if (!projectId) throw new Error("temporary project is unavailable");
    return queueAndPoll(
      "/api/v1/images/cover-art",
      {
        projectId,
        prompt:
          "Editorial album cover, Johannesburg rooftop dance at blue hour, one lead performer in sharp focus, authentic wardrobe, clean title-safe composition, no text",
        quality: "low",
        size: "1024x1024",
      },
      "image"
    );
  });
}

if (scopes.has("video")) {
  await step("real video storyboard", async () => {
    if (!projectId) throw new Error("temporary project is unavailable");
    const response = await call("/api/v1/videos/storyboards", {
      method: "POST",
      body: {
        projectId,
        durationS: 8,
        format: "vertical",
        prompt:
          "One continuous rooftop performance shot with natural movement and clear subject continuity",
      },
      idempotencyKey: idempotency("storyboard"),
      timeoutMs: 90_000,
    });
    const body = expectStatus(response, 201, "storyboard");
    if (!body?.concept?.id) {
      throw new Error("storyboard concept id is missing");
    }
    return { conceptId: body.concept.id };
  }).then(async storyboard => {
    await step("real video render", async () => {
      if (!projectId || !storyboard?.conceptId) {
        throw new Error("storyboard is unavailable");
      }
      return queueAndPoll(
        "/api/v1/videos/renders",
        {
          projectId,
          conceptId: storyboard.conceptId,
          shotIndex: 0,
        },
        "video",
        { timeoutMs: Math.max(timeoutMs, 30 * 60_000) }
      );
    });
  });
}

if (scopes.has("voice")) {
  await step("real owned-voice conversion", async () => {
    const voiceId = String(process.env.ACCEPTANCE_VOICE_ID ?? "").trim();
    const sourceSongId = String(
      process.env.ACCEPTANCE_SOURCE_SONG_ID ?? ""
    ).trim();
    if (!voiceId || !sourceSongId) {
      throw new Error(
        "ACCEPTANCE_VOICE_ID and ACCEPTANCE_SOURCE_SONG_ID are required"
      );
    }
    return queueAndPoll(
      "/api/v1/voices/" + voiceId + "/sing",
      {
        songId: sourceSongId,
        pitchChange: "no-change",
      },
      "voice",
      { timeoutMs: Math.max(timeoutMs, 30 * 60_000) }
    );
  });
}

if (scopes.has("paypal")) {
  await step("PayPal sandbox checkout intent", async () => {
    const pack = String(process.env.ACCEPTANCE_PAYPAL_PACK ?? "pack_10").trim();
    const response = await call("/api/v1/billing/checkout/credits", {
      method: "POST",
      body: { pack },
      idempotencyKey: idempotency("paypal"),
      timeoutMs: 90_000,
    });
    const body = expectStatus(response, 200, "PayPal checkout");
    if (!body?.orderId || !body?.url) {
      throw new Error("PayPal did not return an approval intent");
    }
    const approval = new URL(body.url);
    if (!/paypal\./i.test(approval.hostname)) {
      throw new Error("approval URL is not hosted by PayPal");
    }
    return {
      orderIdHash: identityHash(body.orderId),
      approvalHost: approval.hostname,
      captureCompleted: false,
      limitation:
        "Buyer approval, capture, webhook replay, refund, and reconciliation remain separate sandbox actions.",
    };
  });
}

if (scopes.has("distribution")) {
  await step("real distributor submission", async () => {
    const releaseProjectId = String(
      process.env.ACCEPTANCE_RELEASE_PROJECT_ID ?? ""
    ).trim();
    const releaseSongId = String(
      process.env.ACCEPTANCE_RELEASE_SONG_ID ?? ""
    ).trim();
    if (!releaseProjectId || !releaseSongId) {
      throw new Error(
        "ACCEPTANCE_RELEASE_PROJECT_ID and ACCEPTANCE_RELEASE_SONG_ID are required"
      );
    }
    const response = await call(
      "/api/v1/projects/" +
        releaseProjectId +
        "/release/" +
        releaseSongId +
        "/distribute",
      {
        method: "POST",
        body: {},
        idempotencyKey: idempotency("distribution"),
        timeoutMs: 120_000,
      }
    );
    const body = expectStatus(response, [200, 201, 202], "distribution");
    if (
      !["submitted", "live"].includes(String(body?.status)) ||
      !body?.externalId
    ) {
      throw new Error("distributor did not confirm submission");
    }
    return {
      status: body.status,
      externalIdHash: identityHash(body.externalId),
    };
  });
}

await step("billing closing balance", async () => {
  const response = await call("/api/v1/billing/me");
  const body = expectStatus(response, 200, "billing balance");
  postBilling = {
    creditsCents: Number(body?.creditsCents ?? 0),
    plan: body?.plan ?? null,
  };
  return postBilling;
});

if (selectedPaidScopes.length) {
  await step("durable charge reconciliation", async () => {
    const charged = jobs
      .filter(job => job.status === "SUCCEEDED")
      .reduce((sum, job) => sum + Number(job.chargedCreditsCents ?? 0), 0);
    if (
      Number.isFinite(preBilling?.creditsCents) &&
      Number.isFinite(postBilling?.creditsCents)
    ) {
      const balanceDelta = preBilling.creditsCents - postBilling.creditsCents;
      if (balanceDelta !== charged) {
        throw new Error(
          "balance delta " +
            balanceDelta +
            " does not equal durable charges " +
            charged
        );
      }
      return { chargedCreditsCents: charged, balanceDelta };
    }
    throw new Error("billing balances were unavailable");
  });
}

if (projectId && !hasFlag("--keep-project")) {
  await step("temporary project cleanup", async () => {
    const response = await call("/api/v1/projects/" + projectId, {
      method: "DELETE",
      idempotencyKey: idempotency("cleanup"),
      timeoutMs: 120_000,
    });
    expectStatus(response, [200, 204], "project cleanup");
    return { deleted: true };
  });
}

const failed = steps.filter(item => item.status === "FAIL");
const reportBase = {
  schemaVersion: 2,
  runId,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  apiOrigin: parsedApi.origin,
  scopes: [...scopes].sort(),
  confirmSpend: hasFlag("--confirm-spend"),
  projectRetained: !!projectId && hasFlag("--keep-project"),
  status: failed.length ? "FAIL" : "PASS",
  summary: {
    passed: steps.length - failed.length,
    failed: failed.length,
    jobs: jobs.length,
  },
  steps,
  jobs,
  externalLimitations: [
    "PayPal checkout intent does not prove buyer approval, capture, webhook delivery, refund, or reconciliation.",
    "Email delivery must be proven from the captured PayPal sandbox webhook or an operator-controlled transactional event.",
    "A superiority claim requires the independent blind benchmark corpus and judgments; this runner does not create that claim.",
  ],
};
const report = {
  ...reportBase,
  evidenceHash: evidenceHash(reportBase),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log("");
console.log(
  "Acceptance " +
    report.status +
    ": " +
    report.summary.passed +
    " passed, " +
    report.summary.failed +
    " failed"
);
console.log("Evidence: " + outputPath);
console.log("SHA-256: " + report.evidenceHash);
process.exitCode = failed.length ? 1 : 0;

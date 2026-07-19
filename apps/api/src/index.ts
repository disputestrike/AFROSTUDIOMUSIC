// Load .env first — must happen before any module reads process.env.
// In production (Railway) env vars are already set, so dotenv is a no-op.
import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from "fastify-type-provider-zod";
import pino from "pino";

import {
  assertSecretConfiguration,
  migratePlaintextWorkspaceSecrets,
} from "@afrohit/db";
import {
  assertProductionRuntimeSafety,
  redactSensitiveText,
} from "@afrohit/shared";
import { authPlugin } from "./middleware/auth";
import { privateAssetsPlugin } from "./middleware/private-assets";
import { creditsPlugin } from "./middleware/credits";
import { queuePlugin } from "./lib/queue";
import { startOrchestrationWorker } from "./lib/orchestration-worker";
import {
  captureError,
  initObservability,
  sanitizeRequestUrl,
} from "./lib/observability";
import { assertStorageConfiguration } from "./lib/storage";
import {
  publicRuntimeReadiness,
  runtimeReadinessReport,
} from "./lib/config-readiness";

import projects from "./routes/projects";
import briefs from "./routes/briefs";
import hooks from "./routes/hooks";
import lyrics from "./routes/lyrics";
import beats from "./routes/beats";
import vocals from "./routes/vocals";
import mixes from "./routes/mixes";
import voices from "./routes/voices";
import likeness from "./routes/likeness";
import images from "./routes/images";
import videos from "./routes/videos";
import taste from "./routes/taste";
import rights from "./routes/rights";
import shares from "./routes/shares";
import jobs from "./routes/jobs";
import chat from "./routes/chat";
import webhooks from "./routes/webhooks";
import billing from "./routes/billing";
import artists from "./routes/artists";
import exportsRoute from "./routes/exports";
import admin from "./routes/admin";
import reviews from "./routes/reviews";
import songs from "./routes/songs";
import albums from "./routes/albums";
import materials from "./routes/materials";
import producerKits from "./routes/producer-kits";
import producerEvidence from "./routes/producer-evidence";
import instrumentals from "./routes/instrumentals";
import lexicon from "./routes/lexicon";
import zap from "./routes/zap";
import lanes from "./routes/lanes";
import adjust from "./routes/adjust";
import uploads from "./routes/uploads";
import mixer from "./routes/mixer";
import settings from "./routes/settings";
import analyze from "./routes/analyze";
import snippet from "./routes/snippet";
import drop from "./routes/drop";
import producer from "./routes/producer";
import release from "./routes/release";
import benchmark from "./routes/benchmark";
import authRoutes, { bootstrapOwnerAccount } from "./routes/auth";
import publicRoutes from "./routes/public";
import debug from "./routes/debug";

initObservability("api");

function configuredWebOrigins(): string[] {
  const origins = (process.env.WEB_URL ?? "http://localhost:3000")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const parsed = new URL(entry);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      ) {
        throw new Error(`invalid WEB_URL origin: ${entry}`);
      }
      return parsed.origin;
    });
  if (!origins.length)
    throw new Error("WEB_URL must contain at least one valid origin");
  return [...new Set(origins)];
}

function safeError(error: unknown) {
  const serialized = pino.stdSerializers.err(error as Error);
  return {
    ...serialized,
    message: redactSensitiveText(serialized.message, 1_000),
    stack: redactSensitiveText(serialized.stack, 4_000),
  };
}

function isRedisAvailabilityError(error: {
  code?: string;
  message?: string;
}): boolean {
  if (
    new Set([
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EPIPE",
      "NR_CLOSED",
      "CONNECTION_BROKEN",
    ]).has(error.code ?? "")
  ) {
    return true;
  }
  return /redis|stream isn't writeable|connection is closed|command timed out|max retries per request/i.test(
    error.message ?? ""
  );
}

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty" },
    serializers: {
      err: safeError,
      error: safeError,
      req(request) {
        return {
          method: request.method,
          url: sanitizeRequestUrl(request.url),
          hostname: request.hostname,
          remoteAddress: request.ip,
          remotePort: request.socket?.remotePort,
        };
      },
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-internal-secret"]',
        'res.headers["set-cookie"]',
      ],
      censor: "[redacted]",
    },
  },
  // Behind Railway's proxy every request shares the proxy IP — without this the
  // "per-IP" rate limit throttles all clients as one (and req.ip is useless in logs).
  trustProxy:
    process.env.NODE_ENV === "production"
      ? Math.max(1, Math.min(5, Number(process.env.TRUST_PROXY_HOPS ?? 1) || 1))
      : false,
});

app.setErrorHandler((unknownError, req, reply) => {
  if (reply.sent) return;
  const error = unknownError as Error & {
    code?: string;
    statusCode?: number;
    validation?: unknown;
  };
  const prismaCode = error.code;
  const validation = Array.isArray(error.validation);
  const inferred =
    prismaCode === "P2025"
      ? 404
      : prismaCode === "P2002"
        ? 409
        : isRedisAvailabilityError(error)
          ? 503
          : undefined;
  const status = Math.max(
    400,
    Math.min(599, inferred ?? error.statusCode ?? 500)
  );
  if (status >= 500) {
    req.log.error({ err: error }, "request failed");
    return reply
      .code(status)
      .send({
        error: status === 503 ? "service_unavailable" : "internal_error",
      });
  }
  if (validation) {
    // Surface WHICH field failed instead of an opaque "invalid_request" — the
    // owner kept hitting a blind 400 (create-from-lyrics) with no way to know
    // the cause. Field names + zod messages ONLY (no user values echoed).
    // Logged to Railway AND returned so the next 400 names its own reason.
    const raw = (error.validation as Array<Record<string, unknown>>) ?? [];
    const fields = raw
      .map((v) => {
        const issue = (v.params as { issue?: { path?: unknown[]; message?: string } } | undefined)?.issue;
        const pathArr = (issue?.path ?? (v.path as unknown[] | undefined)) as unknown[] | undefined;
        const path = pathArr?.length
          ? pathArr.join(".")
          : String(v.instancePath ?? "").replace(/^\//, "").replace(/\//g, ".");
        const msg = String(issue?.message ?? v.message ?? "invalid");
        return path ? `${path}: ${msg}` : msg;
      })
      .filter(Boolean)
      .slice(0, 10);
    req.log.warn({ validation: fields, url: req.url, method: req.method }, "request rejected: validation");
    return reply.code(status).send({ error: "invalid_request", fields });
  }
  const code =
    status === 401
      ? "unauthorized"
      : status === 403
        ? "forbidden"
        : status === 404
          ? "not_found"
          : status === 409
            ? "conflict"
            : "request_rejected";
  return reply.code(status).send({
    error: code,
    message: redactSensitiveText(error.message, 240),
  });
});

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

async function bootstrap() {
  assertProductionRuntimeSafety(process.env);
  assertSecretConfiguration();
  assertStorageConfiguration();
  if (process.env.ENCRYPTION_KEY) {
    const migrated = await migratePlaintextWorkspaceSecrets();
    if (migrated)
      app.log.info(
        { migrated },
        "encrypted legacy workspace provider credentials"
      );
  } else {
    app.log.warn(
      "ENCRYPTION_KEY is not configured; integration credentials cannot be saved in this development environment"
    );
  }
  await bootstrapOwnerAccount(app.log);
  await app.register(sensible);
  // CSP (audit 2026-07-17): the API serves JSON + presigned redirects, not
  // HTML apps, so a strict default-src 'none' policy is safe here and adds a
  // header-level defense against any reflected content. The Next web app sets
  // its own CSP; this only governs API responses. Opt back to off with
  // API_CSP=off if a future HTML surface needs a bespoke policy.
  await app.register(helmet, {
    contentSecurityPolicy:
      process.env.API_CSP === "off"
        ? false
        : {
            directives: {
              defaultSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'none'"],
            },
          },
  });
  await app.register(cors, {
    origin: configuredWebOrigins(),
    credentials: true,
  });
  await app.register(queuePlugin);
  const configuredRateLimit = Number.parseInt(
    process.env.RATE_LIMIT_PER_MIN ?? "240",
    10
  );
  const maxRequestsPerMinute =
    Number.isFinite(configuredRateLimit) && configuredRateLimit > 0
      ? configuredRateLimit
      : 240;
  // Redis keeps the abuse boundary consistent across every API replica.
  await app.register(rateLimit, {
    max: maxRequestsPerMinute,
    timeWindow: "1 minute",
    redis: app.rateLimitRedis,
    // RESILIENCE (audit 2026-07-17, CONFIRMED): skipOnError:false made a Redis
    // blip take the ENTIRE API down — the abuse limiter became a single point
    // of failure in front of every route. An abuse limiter degrading to
    // "briefly unmetered" is vastly better than a total outage; the
    // per-workspace guards below still bound the expensive routes when Redis
    // is gone. Chaos-safe: the front door stays open.
    skipOnError: true,
    allowList: req => {
      const path = req.url.split("?")[0] ?? "";
      return (
        path === "/health" ||
        path.startsWith("/health/") ||
        path === "/docs" ||
        path.startsWith("/docs/")
      );
    },
    errorResponseBuilder: (_req, context) => ({
      error: "rate_limited",
      retryInS: Math.max(1, Math.ceil(context.ttl / 1000)),
    }),
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "AfroHit Studio API", version: "0.1.0" },
      servers: [{ url: process.env.API_URL ?? "http://localhost:4000" }],
      components: {
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  // Don't publish the full API schema/Swagger UI publicly in production (audit):
  // it maps every endpoint for an attacker. Enable with EXPOSE_DOCS=1 if wanted.
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.EXPOSE_DOCS === "1"
  ) {
    await app.register(swaggerUI, { routePrefix: "/docs" });
  }

  await app.register(authPlugin);
  await app.register(privateAssetsPlugin);
  await app.register(creditsPlugin);

  app.get("/health", async () => ({
    ok: true,
    service: "api",
    ts: new Date().toISOString(),
    // DEPLOY VERIFIABILITY (2026-07-16): three incidents in one night reduced
    // to "is prod running the fix?" and nothing could answer. The commit sha —
    // and ONLY the sha, no secrets, no config — is public so anyone can check
    // what build is live with a curl. Null outside Railway (local/dev).
    sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
  }));
  app.get("/health/ready", async (_req, reply) => {
    const checkedAt = new Date();
    const withTimeout = async <T>(
      promise: Promise<T>,
      ms: number
    ): Promise<T> => {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<T>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("dependency_timeout")),
              ms
            );
            timer.unref();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    let database = false;
    let redis = false;
    let worker = false;
    let workerSha: string | null = null;
    let earOk: boolean | null = null;
    let workerFeatures: {
      video?: boolean;
      likenessTraining?: boolean;
    } | null = null;
    let pendingOutbox = 0;
    let oldestPendingSeconds: number | null = null;
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 2_000);
      database = true;
      const [heartbeats, pending, oldest] = await withTimeout(
        Promise.all([
          // Heartbeat keys are PER REPLICA (worker/src/index.ts uses
          // RAILWAY_REPLICA_ID ?? HOSTNAME ?? pid), so every deploy leaves a new
          // row behind forever. `take: 20` with NO orderBy asked Postgres for an
          // ARBITRARY twenty of them — so past ~20 deploys the LIVE worker's row
          // could fall outside the window and report the worker dead while it was
          // perfectly healthy. Newest-first makes the freshest heartbeat always
          // visible regardless of how many stale rows have piled up; the worker
          // now prunes the dead ones as it beats.
          prisma.systemSetting.findMany({
            where: { key: { startsWith: "worker:heartbeat:" } },
            select: { value: true },
            orderBy: { updatedAt: "desc" },
            take: 20,
          }),
          prisma.jobOutbox.count({
            where: { status: { in: ["PENDING", "FAILED"] } },
          }),
          prisma.jobOutbox.findFirst({
            where: { status: { in: ["PENDING", "FAILED"] } },
            orderBy: { createdAt: "asc" },
            select: { createdAt: true },
          }),
        ]),
        2_000
      );
      for (const row of heartbeats as Array<{ value: string }>) {
        try {
          const beat = JSON.parse(row.value) as {
            at?: string;
            sha?: string;
            earOk?: boolean | null;
            features?: {
              video?: boolean;
              likenessTraining?: boolean;
            };
          };
          const at = new Date(beat.at ?? 0).getTime();
          if (Number.isFinite(at) && checkedAt.getTime() - at < 45_000) {
            worker = true;
            // DEPLOY VERIFIABILITY: the freshest live worker's build sha (the
            // worker has no HTTP surface of its own — its heartbeat is its
            // health surface, and it now carries the sha). Rows arrive
            // newest-first, so the first live row wins.
            workerSha = typeof beat.sha === "string" ? beat.sha : null;
            // THE EAR STATUS (audit 2026-07-17): surface whether the worker's
            // DSP quality/learning ear is actually listening — false/null here
            // means measurement + learning are silently no-op.
            earOk = typeof beat.earOk === "boolean" ? beat.earOk : null;
            workerFeatures =
              beat.features && typeof beat.features === "object"
                ? beat.features
                : null;
            break;
          }
        } catch {
          /* unreadable heartbeat row — ignore, keep scanning */
        }
      }
      pendingOutbox = pending;
      oldestPendingSeconds = oldest
        ? Math.max(
            0,
            Math.round(
              (checkedAt.getTime() - oldest.createdAt.getTime()) / 1000
            )
          )
        : null;
    } catch (error) {
      app.log.warn({ err: error }, "database readiness check failed");
    }
    try {
      redis = (await withTimeout(app.rateLimitRedis.ping(), 2_000)) === "PONG";
    } catch (error) {
      app.log.warn({ err: error }, "redis readiness check failed");
    }
    // READINESS IS PER-INSTANCE — IT IS NOT A SYSTEM-WIDE LIVENESS PROBE.
    // Railway probes this exact path as the API's DEPLOY GATE (see
    // apps/api/railway.json -> healthcheckPath), so whatever gates the status
    // code decides whether the API is allowed to ship at all.
    //
    // This used to gate on `database && redis && worker`. That meant a dead
    // WORKER failed the API's healthcheck, so Railway rejected the API deploy
    // and kept serving the PREVIOUS build — turning any worker outage into a
    // total, silent deploy freeze for a service that was itself perfectly
    // healthy. With restartPolicyMaxRetries: 5 on the worker, one bad worker
    // could permanently wedge the API.
    //
    // The API does not need the worker to serve: jobs queue durably in the
    // outbox and drain when the worker returns. So the worker is REPORTED here,
    // never gating. Alert on `systemOk`/`worker` in the body instead — that is
    // an ops signal, not a deploy decision.
    const apiReady = database && redis; // this instance's OWN hard dependencies
    const systemOk = apiReady && worker; // whole-system view, for humans + alerts
    const response = {
      ok: apiReady,
      systemOk,
      service: "api",
      checkedAt: checkedAt.toISOString(),
      dependencies: {
        database,
        redis,
        worker,
        workerSha,
        earOk,
        pendingOutbox,
        oldestPendingSeconds,
      },
      features: {
        api: publicRuntimeReadiness(runtimeReadinessReport()),
        worker: workerFeatures,
      },
    };
    return reply.code(apiReady ? 200 : 503).send(response);
  });

  await app.register(
    async api => {
      await api.register(artists, { prefix: "/artists" });
      await api.register(projects, { prefix: "/projects" });
      await api.register(briefs, { prefix: "/projects/:projectId/briefs" });
      await api.register(hooks, { prefix: "/projects/:projectId/hooks" });
      await api.register(lyrics, { prefix: "/projects/:projectId/lyrics" });
      await api.register(beats, { prefix: "/projects/:projectId/beats" });
      await api.register(vocals, { prefix: "/projects/:projectId/vocals" });
      await api.register(mixes, { prefix: "/projects/:projectId/mixes" });
      await api.register(mixer, { prefix: "/projects/:projectId/mixer" });
      await api.register(analyze, { prefix: "/projects/:projectId/analyze" });
      await api.register(snippet, { prefix: "/projects/:projectId/snippet" });
      await api.register(drop, { prefix: "/projects/:projectId/drop" });
      await api.register(producer, { prefix: "/projects" });
      await api.register(release, { prefix: "/projects/:projectId/release" });
      await api.register(images, { prefix: "/images" });
      await api.register(videos, { prefix: "/videos" });
      await api.register(voices, { prefix: "/voices" });
      await api.register(likeness, { prefix: "/likeness" });
      await api.register(taste, { prefix: "/taste" });
      await api.register(rights, { prefix: "/rights" });
      await api.register(shares, { prefix: "/share" });
      await api.register(jobs, { prefix: "/jobs" });
      await api.register(chat, { prefix: "/chat" });
      await api.register(billing, { prefix: "/billing" });
      await api.register(exportsRoute, {
        prefix: "/projects/:projectId/exports",
      });
      await api.register(admin, { prefix: "/admin" });
      await api.register(reviews, { prefix: "/reviews" });
      await api.register(songs, { prefix: "/songs" });
      await api.register(adjust, { prefix: "/songs" }); // §9 lane-report + §10 Adjust-Song
      await api.register(albums, { prefix: "/albums" });
      await api.register(materials, { prefix: "/materials" });
      await api.register(producerKits, { prefix: "/producer-kits" });
      await api.register(producerEvidence, { prefix: "/producer-evidence" });
      await api.register(benchmark, { prefix: "/benchmark" });
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(instrumentals, { prefix: "/instrumentals" });
      await api.register(lexicon, { prefix: "/lexicon" });
      await api.register(zap, { prefix: "/zap" });
      await api.register(lanes, { prefix: "/lanes" });
      await api.register(uploads, { prefix: "/uploads" });
      await api.register(settings, { prefix: "/settings" });
      await api.register(publicRoutes, { prefix: "/public" });
      await api.register(debug, { prefix: "/debug" });
    },
    { prefix: "/api/v1" }
  );

  // webhooks (no prefix, raw body)
  await app.register(webhooks, { prefix: "/webhooks" });
  await startOrchestrationWorker(app);

  const [{ setLlmUsageSink }, { prisma }] = await Promise.all([
    import("@afrohit/ai"),
    import("@afrohit/db"),
  ]);
  setLlmUsageSink(record => {
    const { workspaceId, userId, ...properties } = record;
    void prisma.analyticsEvent
      .create({
        data: {
          workspaceId: workspaceId ?? null,
          userId: userId ?? null,
          name: "llm.call",
          properties: properties as never,
        },
      })
      .catch((error: unknown) =>
        app.log.warn({ err: error }, "llm usage event could not be persisted")
      );
  });

  // Sentry capture on unhandled route errors (after Fastify's own handling).
  app.addHook("onError", async (req, _reply, err) => {
    captureError(err, {
      url: sanitizeRequestUrl(req.url),
      method: req.method,
    });
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API listening on :${port}`);

  // The API runs the WRITERS (hooks/lyrics/A&R) — its brain config must be as
  // loud as the worker's: a stale Railway ANTHROPIC_MODEL here burns silently.
  app.log.info(
    `brains: judgment=${process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5"} (key=${!!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)}) bulk=cerebras(key=${!!(process.env.CEREBRAS_API_KEY || process.env.CEREBRAS_API_KEYS)})`
  );
  // Seed the shared word bank once (idempotent; skips if already populated), then
  // assert coverage — a lane whose prescribed languages are thin must not ship
  // un-reviewed (§11). Fails LOUDLY at boot, never quietly in the lyrics.
  void import("./lib/lexicon")
    .then(async ({ seedLexiconIfEmpty, assertLexiconCoverage }) => {
      const n = await seedLexiconIfEmpty();
      if (n) app.log.info(`lexicon seeded: ${n} entries`);
      await assertLexiconCoverage(app.log);
    })
    .catch(err => app.log.warn({ err }, "lexicon seed skipped"));

  // A3-6 — LLM usage sink: every generateJson call (tier/task/brain/cost) lands
  // as AnalyticsEvent 'llm.call' so /admin/economics can show spend by tier.
}

bootstrap().catch(err => {
  console.error(err);
  process.exit(1);
});

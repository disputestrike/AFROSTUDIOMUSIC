// Load .env first — must happen before any module reads process.env.
// In production (Railway) env vars are already set, so dotenv is a no-op.
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';

import { authPlugin } from './middleware/auth';
import { creditsPlugin } from './middleware/credits';
import { queuePlugin } from './lib/queue';
import { captureError, initObservability } from './lib/observability';

import projects from './routes/projects';
import briefs from './routes/briefs';
import hooks from './routes/hooks';
import lyrics from './routes/lyrics';
import beats from './routes/beats';
import vocals from './routes/vocals';
import mixes from './routes/mixes';
import voices from './routes/voices';
import images from './routes/images';
import videos from './routes/videos';
import taste from './routes/taste';
import rights from './routes/rights';
import shares from './routes/shares';
import jobs from './routes/jobs';
import chat from './routes/chat';
import webhooks from './routes/webhooks';
import billing from './routes/billing';
import artists from './routes/artists';
import exportsRoute from './routes/exports';
import admin from './routes/admin';
import reviews from './routes/reviews';
import songs from './routes/songs';
import albums from './routes/albums';
import materials from './routes/materials';
import instrumentals from './routes/instrumentals';
import lexicon from './routes/lexicon';
import zap from './routes/zap';
import lanes from './routes/lanes';
import adjust from './routes/adjust';
import uploads from './routes/uploads';
import mixer from './routes/mixer';
import settings from './routes/settings';
import analyze from './routes/analyze';
import snippet from './routes/snippet';
import drop from './routes/drop';
import release from './routes/release';
import publicRoutes from './routes/public';
import debug from './routes/debug';

initObservability('api');

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
  },
  // Behind Railway's proxy every request shares the proxy IP — without this the
  // "per-IP" rate limit throttles all clients as one (and req.ip is useless in logs).
  trustProxy: true,
});

// LAUNCH GUARDRAIL — dependency-free per-IP rate limit (token window). Real
// per-plan quotas ride the credit system; this stops abuse and runaway loops.
{
  const WINDOW_MS = 60_000;
  const LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN ?? '240', 10) || 240;
  const hits = new Map<string, { n: number; reset: number }>();
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (path === '/health' || path.startsWith('/docs')) return;
    const now = Date.now();
    const key = req.ip || 'unknown';
    const cur = hits.get(key);
    if (!cur || cur.reset < now) { hits.set(key, { n: 1, reset: now + WINDOW_MS }); return; }
    cur.n++;
    if (cur.n > LIMIT) {
      reply.code(429).send({ error: 'rate_limited', retryInS: Math.ceil((cur.reset - now) / 1000) });
    }
  });
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, WINDOW_MS).unref();
}

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

async function bootstrap() {
  await app.register(sensible);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (process.env.WEB_URL ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: { title: 'AfroHit Studio API', version: '0.1.0' },
      servers: [{ url: process.env.API_URL ?? 'http://localhost:4000' }],
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUI, { routePrefix: '/docs' });

  await app.register(queuePlugin);
  await app.register(authPlugin);
  await app.register(creditsPlugin);

  app.get('/health', async () => ({ ok: true, service: 'api', ts: new Date().toISOString() }));

  await app.register(
    async (api) => {
      await api.register(artists, { prefix: '/artists' });
      await api.register(projects, { prefix: '/projects' });
      await api.register(briefs, { prefix: '/projects/:projectId/briefs' });
      await api.register(hooks, { prefix: '/projects/:projectId/hooks' });
      await api.register(lyrics, { prefix: '/projects/:projectId/lyrics' });
      await api.register(beats, { prefix: '/projects/:projectId/beats' });
      await api.register(vocals, { prefix: '/projects/:projectId/vocals' });
      await api.register(mixes, { prefix: '/projects/:projectId/mixes' });
      await api.register(mixer, { prefix: '/projects/:projectId/mixer' });
      await api.register(analyze, { prefix: '/projects/:projectId/analyze' });
      await api.register(snippet, { prefix: '/projects/:projectId/snippet' });
      await api.register(drop, { prefix: '/projects/:projectId/drop' });
      await api.register(release, { prefix: '/projects/:projectId/release' });
      await api.register(images, { prefix: '/images' });
      await api.register(videos, { prefix: '/videos' });
      await api.register(voices, { prefix: '/voices' });
      await api.register(taste, { prefix: '/taste' });
      await api.register(rights, { prefix: '/rights' });
      await api.register(shares, { prefix: '/share' });
      await api.register(jobs, { prefix: '/jobs' });
      await api.register(chat, { prefix: '/chat' });
      await api.register(billing, { prefix: '/billing' });
      await api.register(exportsRoute, { prefix: '/projects/:projectId/exports' });
      await api.register(admin, { prefix: '/admin' });
      await api.register(reviews, { prefix: '/reviews' });
      await api.register(songs, { prefix: '/songs' });
      await api.register(adjust, { prefix: '/songs' }); // §9 lane-report + §10 Adjust-Song
      await api.register(albums, { prefix: '/albums' });
      await api.register(materials, { prefix: '/materials' });
      await api.register(instrumentals, { prefix: '/instrumentals' });
      await api.register(lexicon, { prefix: '/lexicon' });
      await api.register(zap, { prefix: '/zap' });
      await api.register(lanes, { prefix: '/lanes' });
      await api.register(uploads, { prefix: '/uploads' });
      await api.register(settings, { prefix: '/settings' });
      await api.register(publicRoutes, { prefix: '/public' });
      await api.register(debug, { prefix: '/debug' });
    },
    { prefix: '/api/v1' }
  );

  // webhooks (no prefix, raw body)
  await app.register(webhooks, { prefix: '/webhooks' });

  // Sentry capture on unhandled route errors (after Fastify's own handling).
  app.addHook('onError', async (req, _reply, err) => {
    captureError(err, { url: req.url, method: req.method });
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`API listening on :${port}`);
  // The API runs the WRITERS (hooks/lyrics/A&R) — its brain config must be as
  // loud as the worker's: a stale Railway ANTHROPIC_MODEL here burns silently.
  app.log.info(
    `brains: judgment=${process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'} (key=${!!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)}) bulk=cerebras(key=${!!(process.env.CEREBRAS_API_KEY || process.env.CEREBRAS_API_KEYS)}) fal=${!!process.env.FAL_KEY}`
  );
  // Seed the shared word bank once (idempotent; skips if already populated), then
  // assert coverage — a lane whose prescribed languages are thin must not ship
  // un-reviewed (§11). Fails LOUDLY at boot, never quietly in the lyrics.
  void import('./lib/lexicon').then(async ({ seedLexiconIfEmpty, assertLexiconCoverage }) => {
    const n = await seedLexiconIfEmpty();
    if (n) app.log.info(`lexicon seeded: ${n} entries`);
    await assertLexiconCoverage(app.log);
  }).catch((err) => app.log.warn({ err }, 'lexicon seed skipped'));

  // A3-6 — LLM usage sink: every generateJson call (tier/task/brain/cost) lands
  // as AnalyticsEvent 'llm.call' so /admin/economics can show spend by tier.
  void import('@afrohit/ai').then(async ({ setLlmUsageSink }) => {
    const { prisma } = await import('@afrohit/db');
    let wsId: string | null = null;
    setLlmUsageSink((rec) => {
      void (async () => {
        wsId ??= (await prisma.workspace.findFirst({ select: { id: true } }))?.id ?? null;
        if (!wsId) return;
        await prisma.analyticsEvent.create({ data: { workspaceId: wsId, name: 'llm.call', properties: rec as never } }).catch(() => undefined);
      })();
    });
  }).catch(() => undefined);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

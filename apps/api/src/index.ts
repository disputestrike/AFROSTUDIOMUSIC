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

initObservability('api');

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
  },
});

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
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

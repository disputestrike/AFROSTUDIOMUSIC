import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { integrationsInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';

/**
 * In-app integrations — the music engine key lives here, not in Railway env.
 * Paste your Replicate/Suno key once in Settings and the worker uses it. The
 * raw key is never returned to the client (only a masked hint + connected flag).
 */
export default async function settings(app: FastifyInstance) {
  app.get('/integrations', async (req) => {
    const { workspaceId } = requireAuth(req);
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    return {
      musicProvider: ws.musicProvider ?? null,
      musicConnected: !!ws.musicApiKey,
      keyHint: ws.musicApiKey ? `••••${ws.musicApiKey.slice(-4)}` : null,
    };
  });

  app.patch('/integrations', { schema: { body: integrationsInputSchema } }, async (req) => {
    const { workspaceId } = requireAuth(req);
    const input = integrationsInputSchema.parse(req.body);
    const data: { musicProvider?: string | null; musicApiKey?: string | null } = {};
    if (input.musicProvider !== undefined) data.musicProvider = input.musicProvider;
    // '' = leave existing key; null = disconnect; string = set.
    if (input.musicApiKey === null) data.musicApiKey = null;
    else if (typeof input.musicApiKey === 'string' && input.musicApiKey.trim()) {
      data.musicApiKey = input.musicApiKey.trim();
    }
    const ws = await prisma.workspace.update({
      where: { id: workspaceId },
      data,
      select: { musicProvider: true, musicApiKey: true },
    });
    return {
      musicProvider: ws.musicProvider ?? null,
      musicConnected: !!ws.musicApiKey,
      keyHint: ws.musicApiKey ? `••••${ws.musicApiKey.slice(-4)}` : null,
    };
  });

  // Live check that the saved key actually authenticates with the provider.
  app.post('/integrations/test', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    if (!ws.musicApiKey || !ws.musicProvider) {
      return reply.code(400).send({ ok: false, error: 'No music engine connected yet.' });
    }
    try {
      if (ws.musicProvider === 'replicate') {
        const r = await fetch('https://api.replicate.com/v1/account', {
          headers: { authorization: `Bearer ${ws.musicApiKey}` },
        });
        return r.ok
          ? { ok: true, provider: 'replicate', message: 'Replicate key works ✅' }
          : reply.code(400).send({ ok: false, error: `Replicate rejected the key (${r.status}).` });
      }
      if (ws.musicProvider === 'suno') {
        const base = (process.env.SUNO_API_BASE ?? 'https://api.sunoapi.org').replace(/\/+$/, '');
        const r = await fetch(`${base}/api/v1/generate/credit`, {
          headers: { authorization: `Bearer ${ws.musicApiKey}` },
        });
        return r.ok
          ? { ok: true, provider: 'suno', message: 'Suno key works ✅' }
          : reply.code(400).send({ ok: false, error: `Suno rejected the key (${r.status}).` });
      }
      return { ok: true, provider: ws.musicProvider, message: 'Saved.' };
    } catch (e) {
      // Log the real cause; never echo raw fetch/internal errors to the client.
      req.log.warn({ err: e }, 'integration key test failed');
      return reply.code(502).send({ ok: false, error: 'Could not reach the provider to test the key — try again in a moment.' });
    }
  });
}

import type { FastifyInstance } from 'fastify';
import { openSecret, prisma, sealSecret, secretHint } from '@afrohit/db';
import { integrationsInputSchema } from '@afrohit/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import { musicRouteCapabilities, musicRoutePolicy } from '../lib/music-capabilities';
import {
  resolveVideoProviderReadiness,
  runtimeReadinessReport,
} from '../lib/config-readiness';
import { distributionConfigurationStatus } from '../lib/distribution';

/**
 * In-app integrations — the music engine key lives here, not in Railway env.
 * Paste your Replicate/Suno key once in Settings and the worker uses it. The
 * raw key is never returned to the client (only a masked hint + connected flag).
 */
export default async function settings(app: FastifyInstance) {
  const sunoRouteAllowed = (workspaceId: string) => musicRoutePolicy(workspaceId).sunoAllowed;
  const elevenRouteAllowed = (workspaceId: string) => musicRoutePolicy(workspaceId).elevenAllowed;

  // Any authenticated workspace member may discover class-level route
  // capabilities. Keys and vendor identities remain owner-only below.
  app.get('/music-capabilities', async (req) => {
    const { workspaceId } = requireAuth(req);
    const capabilities = await musicRouteCapabilities(workspaceId);
    return {
      flagship: capabilities.flagship,
      advanced: capabilities.advanced,
      standard: capabilities.standard,
    };
  });

  app.addHook('preHandler', async (req) => {
    requireRole(req, ['OWNER', 'ADMIN']);
  });

  app.get('/runtime-readiness', async (req) => {
    const { workspaceId } = requireAuth(req);
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const workspaceKey =
      workspace.musicProvider === 'replicate'
        ? (openSecret(workspace.musicApiKey) ?? undefined)
        : undefined;
    const distribution = distributionConfigurationStatus();
    return {
      checkedAt: new Date().toISOString(),
      api: runtimeReadinessReport(),
      workspace: {
        replicateConnected: Boolean(workspaceKey),
        video: {
          draft: resolveVideoProviderReadiness({
            engineClass: 'draft',
            workspaceReplicateKey: workspaceKey,
          }),
          standard: resolveVideoProviderReadiness({
            engineClass: 'standard',
            workspaceReplicateKey: workspaceKey,
          }),
          flagship: resolveVideoProviderReadiness({
            engineClass: 'flagship',
            workspaceReplicateKey: workspaceKey,
          }),
          likeness: resolveVideoProviderReadiness({
            engineClass: 'standard',
            useLikeness: true,
            workspaceReplicateKey: workspaceKey,
          }),
        },
      },
      distribution,
      note:
        'This report validates runtime configuration without exposing credentials. Use the existing integration test endpoint to verify workspace-key connectivity.',
    };
  });

  app.get('/integrations', async (req) => {
    const { workspaceId } = requireAuth(req);
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    return {
      musicProvider: ws.musicProvider ?? null,
      musicConnected: !!ws.musicApiKey,
      keyHint: secretHint(ws.musicApiKey),
      sunoRouteAllowed: sunoRouteAllowed(workspaceId),
      elevenRouteAllowed: elevenRouteAllowed(workspaceId),
    };
  });

  app.patch('/integrations', { schema: { body: integrationsInputSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = integrationsInputSchema.parse(req.body);
    if (input.musicProvider === 'suno' && !sunoRouteAllowed(workspaceId)) {
      return reply.code(403).send({
        error: 'flagship_engine_first_party_only',
        message: 'The flagship route is available only for approved first-party release workspaces.',
      });
    }
    if (input.musicProvider === 'eleven' && !elevenRouteAllowed(workspaceId)) {
      return reply.code(403).send({
        error: 'advanced_engine_commercial_approval_required',
        message: 'This route requires current commercial terms and co-branding approval before customer use.',
      });
    }
    const data: { musicProvider?: string | null; musicApiKey?: string | null } = {};
    if (input.musicProvider !== undefined) data.musicProvider = input.musicProvider;
    // '' = leave existing key; null = disconnect; string = set.
    if (input.musicApiKey === null) data.musicApiKey = null;
    else if (typeof input.musicApiKey === 'string' && input.musicApiKey.trim()) {
      data.musicApiKey = sealSecret(input.musicApiKey.trim());
    }
    const ws = await prisma.workspace.update({
      where: { id: workspaceId },
      data,
      select: { musicProvider: true, musicApiKey: true },
    });
    return {
      musicProvider: ws.musicProvider ?? null,
      musicConnected: !!ws.musicApiKey,
      keyHint: secretHint(ws.musicApiKey),
      sunoRouteAllowed: sunoRouteAllowed(workspaceId),
      elevenRouteAllowed: elevenRouteAllowed(workspaceId),
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
    const apiKey = openSecret(ws.musicApiKey)!;
    try {
      if (ws.musicProvider === 'replicate') {
        const r = await fetch('https://api.replicate.com/v1/account', {
          headers: { authorization: `Bearer ${apiKey}` },
        });
        return r.ok
          ? { ok: true, provider: 'replicate', message: 'Replicate key works ✅' }
          : reply.code(400).send({ ok: false, error: `Replicate rejected the key (${r.status}).` });
      }
      if (ws.musicProvider === 'eleven') {
        const r = await fetch('https://api.elevenlabs.io/v1/user', {
          headers: { 'xi-api-key': apiKey },
        });
        return r.ok
          ? { ok: true, provider: 'eleven', message: 'Advanced engine key works.' }
          : reply.code(400).send({ ok: false, error: `The advanced engine rejected the key (${r.status}).` });
      }
      if (ws.musicProvider === 'suno') {
        const base = (process.env.SUNO_API_BASE ?? 'https://api.sunoapi.org').replace(/\/+$/, '');
        const r = await fetch(`${base}/api/v1/generate/credit`, {
          headers: { authorization: `Bearer ${apiKey}` },
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

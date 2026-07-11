import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@afrohit/db';
import { createShareLinkSchema, logShareEventSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';

function newShortCode(): string {
  return randomBytes(5).toString('base64url').slice(0, 7);
}

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export default async function shares(app: FastifyInstance) {
  /**
   * Create a public short link for a song. Returns code + canonical URL.
   * Pattern: afro.hi/<code> → 302 to targetUrl, with a fire-and-forget event log.
   */
  app.post('/links', { schema: { body: createShareLinkSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const { songId, targetUrl } = createShareLinkSchema.parse(req.body);

    await prisma.song.findFirstOrThrow({ where: { id: songId, workspaceId } });

    let code = newShortCode();
    // tiny retry loop in case of collision
    for (let i = 0; i < 4; i++) {
      const exists = await prisma.shareLink.findUnique({ where: { code } });
      if (!exists) break;
      code = newShortCode();
    }

    const link = await prisma.shareLink.create({
      data: { workspaceId, songId, code, targetUrl },
    });
    reply.code(201);
    return { code: link.code, url: `${process.env.WEB_URL ?? 'http://localhost:3000'}/s/${link.code}` };
  });

  /**
   * Public event ingestion endpoint.
   *
   * Called by the /s/:code redirect handler in the web app, and by client-side
   * "play"/"download" beacons. We hash the IP and store plain lat/lng columns.
   *
   * No auth required — these are public events. We rate-limit at the
   * Fastify-level plugin (already registered).
   */
  app.post('/events', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = logShareEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_event' });
    const { shareLinkCode, eventType, sourcePlatform, lat, lng, city, region, country, countryCode } = parsed.data;

    const link = await prisma.shareLink.findUnique({
      where: { code: shareLinkCode },
      select: { id: true, workspaceId: true, songId: true, active: true },
    });
    if (!link || !link.active) return reply.code(404).send({ error: 'no_such_link' });

    await prisma.shareEvent.create({
      data: {
        workspaceId: link.workspaceId,
        shareLinkId: link.id,
        songId: link.songId,
        eventType,
        sourcePlatform,
        city,
        region,
        country,
        countryCode,
        lat: typeof lat === 'number' ? lat : null,
        lng: typeof lng === 'number' ? lng : null,
        ipHash: hashIp(req.ip),
        userAgent: req.headers['user-agent']?.slice(0, 240) ?? null,
      },
    });
    return { ok: true };
  });

  /**
   * Public redirect endpoint for short links. (Mounted under /api/v1 but the
   * web layer can also expose a clean /s/:code route that proxies to here.)
   */
  app.get<{ Params: { code: string } }>('/redirect/:code', async (req, reply) => {
    const link = await prisma.shareLink.findUnique({ where: { code: req.params.code } });
    if (!link || !link.active) return reply.code(404).send({ error: 'not_found' });
    // fire-and-forget event log
    await prisma.shareEvent.create({
      data: {
        workspaceId: link.workspaceId,
        shareLinkId: link.id,
        songId: link.songId,
        eventType: 'click',
        ipHash: hashIp(req.ip),
        userAgent: req.headers['user-agent']?.slice(0, 240) ?? null,
      },
    });
    return reply.redirect(link.targetUrl, 302);
  });

  /**
   * Heatmap aggregation — buckets share events by country/region for the
   * analytics dashboard. Centroid = AVG(lat), AVG(lng) per bucket (a
   * country-level centroid, identical to the old PostGIS result). Uses Prisma
   * groupBy — fully parameterized, no raw SQL, no extensions.
   */
  app.get<{
    Querystring: { songId?: string; eventType?: string; since?: string; until?: string };
  }>('/heatmap', async (req) => {
    const { workspaceId } = requireAuth(req);
    const { songId, eventType, since, until } = req.query;

    const createdAt: { gte?: Date; lte?: Date } = {};
    if (since) createdAt.gte = new Date(since);
    if (until) createdAt.lte = new Date(until);

    const grouped = await prisma.shareEvent.groupBy({
      by: ['country', 'region'],
      where: {
        workspaceId,
        ...(eventType ? { eventType } : {}),
        ...(songId ? { songId } : {}),
        ...(createdAt.gte || createdAt.lte ? { createdAt } : {}),
      },
      _count: { _all: true },
      _avg: { lat: true, lng: true },
    });

    const points = grouped
      .map((g: { country: string | null; region: string | null; _count: { _all: number }; _avg: { lat: number | null; lng: number | null } }) => ({
        country: g.country,
        region: g.region,
        events: g._count._all,
        lat: g._avg.lat,
        lng: g._avg.lng,
      }))
      .sort((a: { events: number }, b: { events: number }) => b.events - a.events)
      .slice(0, 500);

    return { points };
  });
}

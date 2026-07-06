import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { genreSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

/**
 * THE MATERIAL LAYER API — real, owned loops the AI arranges into exact beats.
 *
 *  GET  /            → the material library (per genre/role)
 *  POST /forge       → forge a genre KIT: isolated loops for the core roles
 *  POST /assemble    → arrange picked material into a real beat (exact, deterministic)
 */

// The core kit per genre family — which roles the arranger wants on the shelf.
function kitRolesFor(genre: string): string[] {
  if (/amapiano/.test(genre)) return ['log_drum', 'drums', 'percussion', 'chords'];
  if (/afro|street_pop|highlife|gospel/.test(genre)) return ['drums', 'percussion', 'bass', 'chords'];
  if (/drill|trap|hip_hop/.test(genre)) return ['drums', 'bass', 'chords'];
  if (/house|edm/.test(genre)) return ['drums', 'percussion', 'bass', 'chords'];
  return ['drums', 'percussion', 'bass', 'chords'];
}

export default async function materials(app: FastifyInstance) {
  /** The library — what's on the shelf, grouped for the UI/chat. */
  app.get<{ Querystring: { genre?: string } }>('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.materialAsset.findMany({
      where: { workspaceId, ...(req.query.genre ? { genre: req.query.genre } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      total: rows.length,
      materials: rows.map((m) => ({ id: m.id, role: m.role, genre: m.genre, bpm: m.bpm, bars: m.bars, source: m.source, url: m.url, createdAt: m.createdAt })),
    };
  });

  /**
   * FORGE a genre kit — one isolated loop per core role. Each loop is a paid
   * render (~$0.10) so the whole kit is cost-capped like everything else.
   */
  const forgeSchema = z.object({
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180).optional(),
    roles: z.array(z.enum(['drums', 'log_drum', 'bass', 'percussion', 'chords'])).max(5).optional(),
  });
  app.post('/forge', { schema: { body: forgeSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = forgeSchema.parse(req.body);
    const roles = input.roles?.length ? input.roles : kitRolesFor(input.genre);
    const bpm = input.bpm ?? 108;

    const jobs: Array<{ role: string; jobId: string }> = [];
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i]!;
      const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s' });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', forged: jobs, ...charge });
      const job = await prisma.providerJob.create({
        data: { workspaceId, kind: 'material', provider: 'replicate', status: 'QUEUED', inputJson: { genre: input.genre, role, bpm } as never },
      });
      await enqueue({
        queue: app.queues.music,
        name: 'forge-material',
        payload: { jobId: job.id, workspaceId, genre: input.genre, role, bpm },
        // STAGGER: Replicate throttles prediction creation (observed live: 6/min,
        // burst 1) — parallel forges 429'd. 30s spacing keeps the kit flowing.
        delayMs: i * 30_000,
      });
      jobs.push({ role, jobId: job.id });
    }
    reply.code(202);
    return { forging: jobs, note: `Forging ${jobs.length} isolated ${input.genre} loops at ${bpm}bpm — poll each job; QC-passed loops land in the library.` };
  });

  /**
   * ASSEMBLE — the exact beat. Picks the best material per role (bpm-proximate,
   * artist stems preferred) and hands the arranger an explicit plan.
   */
  const assembleSchema = z.object({
    projectId: z.string().cuid(),
    songId: z.string().cuid().optional(),
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180),
  });
  app.post('/assemble', { schema: { body: assembleSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = assembleSchema.parse(req.body);
    await prisma.project.findFirstOrThrow({ where: { id: input.projectId, workspaceId } });

    // Pick per-role: right genre → closest bpm (±15%) → artist stems first.
    const rows = await prisma.materialAsset.findMany({
      where: { workspaceId, genre: input.genre },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const wanted = kitRolesFor(input.genre);
    const GAINS: Record<string, number> = { drums: 1.0, log_drum: 1.05, bass: 0.95, percussion: 0.8, chords: 0.7 };
    const picks: Array<{ id: string; url: string; sourceBpm: number; role: string; gain: number }> = [];
    for (const role of wanted) {
      const candidates = rows
        .filter((m) => m.role === role && m.bpm && Math.abs(m.bpm - input.bpm) / input.bpm <= 0.15)
        .sort((a, b) => (a.source === 'artist_stem' ? -1 : 0) - (b.source === 'artist_stem' ? -1 : 0) || Math.abs((a.bpm ?? 0) - input.bpm) - Math.abs((b.bpm ?? 0) - input.bpm));
      const best = candidates[0];
      if (best) picks.push({ id: best.id, url: best.url, sourceBpm: best.bpm ?? input.bpm, role, gain: GAINS[role] ?? 0.9 });
    }
    if (picks.length < 2) {
      return reply.code(400).send({
        error: 'not_enough_material',
        have: picks.map((p) => p.role),
        need: wanted,
        message: `The ${input.genre} shelf needs more loops near ${input.bpm}bpm — run POST /materials/forge {"genre":"${input.genre}","bpm":${input.bpm}} first.`,
      });
    }

    const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s', refTable: 'Project', refId: input.projectId });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
    const job = await prisma.providerJob.create({
      data: { workspaceId, projectId: input.projectId, kind: 'music', provider: 'material', status: 'QUEUED', inputJson: { assemble: true, ...input, picks: picks.map((p) => p.role) } as never },
    });
    await enqueue({
      queue: app.queues.music,
      name: 'assemble-beat',
      payload: { jobId: job.id, workspaceId, projectId: input.projectId, songId: input.songId, bpm: input.bpm, genre: input.genre, picks },
    });
    reply.code(202);
    return { jobId: job.id, status: 'queued', roles: picks.map((p) => p.role), note: 'Assembling the exact beat from real material — poll the job.' };
  });
}

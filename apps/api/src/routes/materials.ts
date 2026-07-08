import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { genreSchema } from '@afrohit/shared';
import { getSoundDNA } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';
import { kitRolesFor, homeKeyFor, pickMaterial, claudeArrangement } from '../lib/material-plan';
import { autoMaterialBeat } from '../lib/material-auto';

/**
 * THE MATERIAL LAYER API — real, owned loops the AI arranges into exact beats.
 *
 *  GET  /            → the material library (per genre/role)
 *  POST /forge       → forge a genre KIT: isolated loops for the core roles (in key)
 *  POST /assemble    → Claude arranges picked material into a real beat (exact, deterministic)
 */

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
      materials: rows.map((m) => ({ id: m.id, role: m.role, genre: m.genre, bpm: m.bpm, keySignature: m.keySignature, bars: m.bars, source: m.source, url: m.url, createdAt: m.createdAt })),
    };
  });

  /**
   * FORGE a genre kit — one isolated loop per core role, melodic roles in the
   * genre's home key so separately-forged loops fit together. Each loop is a
   * paid render (~$0.10) so the whole kit is cost-capped like everything else.
   */
  const forgeSchema = z.object({
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180).optional(),
    keySignature: z.string().max(24).optional(),
    roles: z.array(z.enum(['drums', 'log_drum', 'bass', 'talking_drum', 'percussion', 'chords'])).max(6).optional(),
  });
  app.post('/forge', { schema: { body: forgeSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = forgeSchema.parse(req.body);
    const roles = input.roles?.length ? input.roles : kitRolesFor(input.genre);
    const bpm = input.bpm ?? getSoundDNA(input.genre)?.typicalBpm ?? 108;
    const keySignature = input.keySignature ?? homeKeyFor(input.genre);

    const jobs: Array<{ role: string; jobId: string }> = [];
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i]!;
      const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s' });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', forged: jobs, ...charge });
      const job = await prisma.providerJob.create({
        data: { workspaceId, kind: 'material', provider: 'replicate', status: 'QUEUED', inputJson: { genre: input.genre, role, bpm, keySignature } as never },
      });
      await enqueue({
        queue: app.queues.music,
        name: 'forge-material',
        payload: { jobId: job.id, workspaceId, genre: input.genre, role, bpm, keySignature },
        // STAGGER: Replicate throttles prediction creation (observed live: 6/min,
        // burst 1) — parallel forges 429'd. 30s spacing keeps the kit flowing.
        delayMs: i * 30_000,
      });
      jobs.push({ role, jobId: job.id });
    }
    reply.code(202);
    return { forging: jobs, keySignature, note: `Forging ${jobs.length} isolated ${input.genre} loops at ${bpm}bpm in ${keySignature} — poll each job; QC-passed loops land in the library.` };
  });

  /**
   * ASSEMBLE — the exact beat. Picks the best material per role (key-aware,
   * bpm-proximate, artist stems preferred), then CLAUDE ARRANGES the build for
   * this exact material (worker falls back to the classic template if the plan
   * is unusable — never a broken beat).
   */
  const assembleSchema = z.object({
    projectId: z.string().cuid(),
    songId: z.string().cuid().optional(),
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180),
    keySignature: z.string().max(24).optional(),
    vibe: z.string().max(200).optional(),
  });
  /**
   * AUTO — "let AI run it." One action: forge whatever the genre's kit is missing
   * near this bpm, then assemble the exact beat automatically. No manual forge-then-
   * assemble. Returns 'assembling' if the shelf was stocked, else 'forging' (a
   * detached waiter assembles once the loops land).
   */
  const autoSchema = z.object({
    projectId: z.string().cuid(),
    songId: z.string().cuid().optional(),
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180).optional(),
    keySignature: z.string().max(24).optional(),
    vibe: z.string().max(200).optional(),
  });
  app.post('/auto', { schema: { body: autoSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = autoSchema.parse(req.body);
    await prisma.project.findFirstOrThrow({ where: { id: input.projectId, workspaceId } });
    const result = await autoMaterialBeat(app, workspaceId, input);
    reply.code(202);
    return result;
  });

  app.post('/assemble', { schema: { body: assembleSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = assembleSchema.parse(req.body);
    await prisma.project.findFirstOrThrow({ where: { id: input.projectId, workspaceId } });

    const rows = await prisma.materialAsset.findMany({
      where: { workspaceId, genre: input.genre },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const picks = pickMaterial(rows, input.genre, input.bpm, input.keySignature);
    if (picks.length < 2) {
      return reply.code(400).send({
        error: 'not_enough_material',
        have: picks.map((p) => p.role),
        need: kitRolesFor(input.genre),
        message: `The ${input.genre} shelf needs more loops near ${input.bpm}bpm — run POST /materials/forge {"genre":"${input.genre}","bpm":${input.bpm}} first.`,
      });
    }

    const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s', refTable: 'Project', refId: input.projectId });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    const sections = await claudeArrangement(input.genre, input.bpm, picks.map((p) => p.role), input.vibe);

    const job = await prisma.providerJob.create({
      data: { workspaceId, projectId: input.projectId, kind: 'music', provider: 'material', status: 'QUEUED', inputJson: { assemble: true, ...input, picks: picks.map((p) => p.role), sections } as never },
    });
    await enqueue({
      queue: app.queues.music,
      name: 'assemble-beat',
      payload: { jobId: job.id, workspaceId, projectId: input.projectId, songId: input.songId, bpm: input.bpm, genre: input.genre, picks, sections },
    });
    reply.code(202);
    return {
      jobId: job.id,
      status: 'queued',
      roles: picks.map((p) => p.role),
      arrangement: sections ? sections.map((s) => `${s.name}:${s.bars}bars[${s.roles.join('+')}]`) : 'classic template',
      note: 'Assembling the exact beat from real material — poll the job.',
    };
  });
}

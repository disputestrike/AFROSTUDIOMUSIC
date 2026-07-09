import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { genreSchema } from '@afrohit/shared';
import { getSoundDNA } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';
import { kitRolesFor, homeKeyFor, pickMaterial, claudeArrangement } from '../lib/material-plan';
import { blueprintForSong, blueprintForReference } from '../lib/blueprint';
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
      where: { workspaceId, role: { not: 'instrumental' }, ...(req.query.genre ? { genre: req.query.genre } : {}) },
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
    roles: z.array(z.enum(['drums', 'log_drum', 'bass', 'talking_drum', 'percussion', 'chords', 'fill'])).max(7).optional(),
  });
  app.post('/forge', { schema: { body: forgeSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = forgeSchema.parse(req.body);
    // Explicit roles are forged as asked; the DEFAULT kit forges only the GAPS —
    // roles this genre has no material for yet — so re-running just tops up the shelf.
    let roles = input.roles?.length ? input.roles : kitRolesFor(input.genre);
    if (!input.roles?.length) {
      const existing = await prisma.materialAsset.findMany({ where: { workspaceId, genre: input.genre }, select: { role: true } });
      const have = new Set(existing.map((m) => m.role));
      roles = roles.filter((r) => !have.has(r));
      if (!roles.length) {
        return { forging: [], note: `The ${input.genre} kit is already stocked (${[...have].join(', ')}). Nothing to forge.` };
      }
    }
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
  const synthSchema = z.object({ genre: genreSchema, bpm: z.number().int().min(60).max(180).optional() });
  app.post('/synth', { schema: { body: synthSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = synthSchema.parse(req.body);
    // Owned synthesized material (log_drum / shaker / bass glide) — near-zero cost,
    // rights-clean, disclosed as source:'forged' + meta.synth in the shelf.
    await enqueue({ queue: app.queues.music, name: 'synth-material', payload: { workspaceId, genre: input.genre, bpm: input.bpm, roles: ['log_drum', 'percussion', 'bass'] } });
    reply.code(202);
    return { queued: true, roles: ['log_drum', 'percussion', 'bass'], note: 'Synthesized signature loops landing on the shelf in ~seconds.' };
  });

  // THE AFROHIT ENGINE v1 — composed, not rented. One call: owned kit ->
  // grid-locked beat -> optional MusicGen melody conditioned on OUR groove ->
  // measured proof (lane + blueprint). Voice rides /vocals/upload afterwards.
  const ownEngineSchema = z.object({
    projectId: z.string().cuid(),
    songId: z.string().cuid().optional(),
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180).optional(),
    melody: z.boolean().optional(),
    melodyPrompt: z.string().max(300).optional(),
    blueprintSongId: z.string().cuid().optional(),
    blueprintReferenceId: z.string().cuid().optional(),
  });
  app.post('/own-engine', { schema: { body: ownEngineSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = ownEngineSchema.parse(req.body);
    await prisma.project.findFirstOrThrow({ where: { id: input.projectId, workspaceId } });
    const blueprint = input.blueprintSongId
      ? await blueprintForSong(input.blueprintSongId)
      : input.blueprintReferenceId
        ? await blueprintForReference(workspaceId, input.blueprintReferenceId)
        : null;
    const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s', refTable: 'Project', refId: input.projectId });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
    const job = await prisma.providerJob.create({
      data: { workspaceId, projectId: input.projectId, kind: 'music', provider: 'afrohit-own', status: 'QUEUED', inputJson: { ownEngine: true, ...input } as never },
    });
    await enqueue({ queue: app.queues.music, name: 'own-engine', payload: { jobId: job.id, workspaceId, projectId: input.projectId, songId: input.songId, genre: input.genre, bpm: input.bpm, melody: input.melody, melodyPrompt: input.melodyPrompt, blueprint } });
    reply.code(202);
    return { jobId: job.id, status: 'queued', engine: 'afrohit-own-v1', layers: ['owned rhythm (synth+material, grid-locked)', input.melody === false ? 'melody: off' : 'melody: MusicGen conditioned on our groove (fail-open)', 'voice: your upload via /vocals/upload', 'proof: lane compliance + blueprint verify'], note: 'Poll the job; the beat lands approved with measured receipts on its meta.' };
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

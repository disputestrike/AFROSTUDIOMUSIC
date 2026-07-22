/**
 * PRODUCER PIPELINE route — runs the multi-agent Executive Producer over one
 * new song and returns the SONG_STATE. The pipeline NEVER labels a song
 * MASTERED; it hands back a decision (REJECT_AND_RESTART / REVISE_FROM_STAGE_X /
 * CANDIDATE_FOR_HUMAN_AR) plus the full staged rationale. A CANDIDATE writes the
 * fitted lyric onto the song so it can be rendered/heard; a REJECT quarantines
 * the shell so nothing half-made lingers in the catalogue.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';

const bodySchema = z.object({
  theme: z.string().min(3).max(2000),
  genre: z.string().max(40).default('afrobeats'),
  bpm: z.number().int().min(60).max(180).optional(),
  mood: z.string().max(40).optional(),
  languages: z.array(z.string().min(2).max(12)).max(5).optional(),
  fusionGenres: z.array(z.string().max(40)).max(2).optional(),
  // Artist reference ("like Drake") — lane steering for the creative-director
  // layer (production/writing feel only, never a voice clone).
  influence: z.string().max(80).optional(),
});

export default async function producer(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>('/:projectId/produce', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = bodySchema.parse(req.body);
    const project = await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });

    // Charge one full-song unit up front (the pipeline runs several LLM stages).
    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'producer');
    const charge = await app.chargeCredits({ workspaceId, key: 'full_song_demo', refTable: 'Project', refId: project.id, idempotencyKey });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
    if (charge.replayed) {
      const existing = await prisma.providerJob.findUnique({
        where: { chargeLedgerId: charge.chargeId },
        select: { id: true, inputJson: true },
      });
      if (existing) {
        const songId = (existing.inputJson as { songId?: string } | null)?.songId;
        reply.code(202);
        return { jobId: existing.id, songId, replayed: true };
      }
    }

    const song = await prisma.song.create({
      data: { workspaceId, projectId: project.id, title: 'Producing…', status: 'SKETCH' },
    });

    // The pipeline RENDERS the topline audio before the songwriter runs, so it
    // must execute in the worker (ffmpeg + minutes). Enqueue + return a jobId;
    // the client polls GET /jobs/:jobId. The result's outputJson carries the
    // decision; GET /songs/:id/proof carries the full SONG_STATE.
    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.music,
      jobName: 'produce',
      workspaceId,
      projectId: project.id,
      kind: 'music',
      provider: 'afrohit-producer',
      inputJson: { produce: true, songId: song.id, theme: input.theme, genre: input.genre, bpm: input.bpm, mood: input.mood, languages: input.languages, fusion: input.fusionGenres, influence: input.influence },
      charge,
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId, projectId: project.id, songId: song.id, theme: input.theme, genre: input.genre, bpm: input.bpm, mood: input.mood, languages: input.languages, fusion: input.fusionGenres, influence: input.influence }),
    });

    reply.code(202);
    return { jobId: job.jobId, songId: song.id, replayed: job.replayed, note: 'Producing — the topline is rendered to audio BEFORE the songwriter runs; poll GET /jobs/:jobId for the decision (CANDIDATE_FOR_HUMAN_AR / REVISE_FROM_STAGE_X / REJECT_AND_RESTART / TOPLINE_NOT_PROVEN — never "mastered").' };
  });
}

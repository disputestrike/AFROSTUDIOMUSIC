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
import { pickLawfulTitle } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { runProducerPipeline } from '../lib/producer-pipeline';

const bodySchema = z.object({
  theme: z.string().min(3).max(2000),
  genre: z.string().max(40).default('afrobeats'),
  bpm: z.number().int().min(60).max(180).optional(),
  mood: z.string().max(40).optional(),
  languages: z.array(z.string().min(2).max(12)).max(5).optional(),
  fusionGenres: z.array(z.string().max(40)).max(2).optional(),
});

export default async function producer(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>('/:projectId/produce', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = bodySchema.parse(req.body);
    const project = await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });

    // Charge one full-song unit up front (the pipeline runs several LLM stages).
    const charge = await app.chargeCredits({ workspaceId, key: 'full_song_demo', refTable: 'Project', refId: project.id });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    const song = await prisma.song.create({
      data: { workspaceId, projectId: project.id, title: 'Producing…', status: 'SKETCH' },
    });

    let state;
    try {
      state = await runProducerPipeline({
        workspaceId, projectId: project.id, songId: song.id,
        theme: input.theme, genre: input.genre, bpm: input.bpm, mood: input.mood,
        languages: input.languages, fusion: input.fusionGenres,
      });
    } catch (err) {
      await prisma.song.update({ where: { id: song.id }, data: { quarantined: true, quarantineReason: `pipeline error: ${(err as Error).message.slice(0, 200)}` } }).catch(() => {});
      return reply.code(502).send({ error: 'pipeline_failed', message: (err as Error).message.slice(0, 300) });
    }

    // Persist the fitted lyric + the full SONG_STATE (proofPack). A CANDIDATE
    // becomes a real, renderable draft; a REJECT is quarantined (not deleted).
    const sung = state.sungWords?.sections.flatMap((s) => s.lines).join('\n') ?? '';
    const fittedTitle = (() => {
      const t = state.log.find((l) => l.stage === 'lyric_fitting')?.changed?.match(/title="([^"]+)"/)?.[1];
      return t || pickLawfulTitle([], sung || project.title);
    })();
    if (state.decision === 'CANDIDATE_FOR_HUMAN_AR' && sung) {
      const lyric = await prisma.lyricDraft.create({ data: { projectId: project.id, songId: song.id, title: fittedTitle, body: sung, approved: false } });
      await prisma.song.update({ where: { id: song.id }, data: { title: fittedTitle, lyricId: lyric.id, status: 'DEMO', proofPack: state as never } });
    } else {
      await prisma.song.update({ where: { id: song.id }, data: { title: fittedTitle, quarantined: true, quarantineReason: `pipeline: ${state.decision}`, proofPack: state as never } });
    }

    return {
      songId: song.id,
      decision: state.decision,
      version: state.version,
      title: fittedTitle,
      brief: state.brief,
      beatDna: state.beatDna,
      qaScores: state.qaScores,
      languageReview: state.languageReview,
      rejections: state.rejections,
      log: state.log,
    };
  });
}

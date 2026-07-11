import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { createMasterInputSchema, createMixInputSchema, attachSongUploadSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';
import { enqueueHarvest } from '../lib/harvest';
import { publicUrlFor, assertOwnedKey } from '../lib/storage';
import { arReadAfterRender } from '../lib/ar-read';

export default async function mixes(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: createMixInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = createMixInputSchema.omit({ projectId: true }).parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });
      // The song must belong to this workspace — never mix another tenant's song.
      const song = await prisma.song.findFirstOrThrow({
        where: { id: input.songId, workspaceId },
        include: {
          masters: { orderBy: { createdAt: 'desc' }, take: 1 },
          mixes: { orderBy: { createdAt: 'desc' }, take: 1 },
          beats: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      // DEFINITIONAL FIX — 'instrumental'/'acapella' as MIX presets bounced the
      // beat/vocal channels of the pre-vocal session, NOT the finished record
      // ("instrumental" of a mastered song came out as the raw beat). The preset
      // names stay (removing enum members breaks clients); the request reroutes
      // to true stem separation of the freshest audio the user actually hears.
      if (input.preset === 'instrumental' || input.preset === 'acapella') {
        const beat = song.beats[0];
        if (!beat) return reply.code(400).send({ error: 'no_audio_to_separate' });
        const cands = [song.masters[0], song.mixes[0], song.beats[0]].filter(Boolean) as Array<{ url: string; createdAt: Date }>;
        cands.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const sourceUrl = cands[0]!.url;
        const sepCharge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s', refTable: 'Song', refId: input.songId });
        if (!sepCharge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...sepCharge });
        const sepJob = await prisma.providerJob.create({
          data: { workspaceId, projectId: project.id, kind: 'stems', provider: 'replicate', status: 'QUEUED', inputJson: { songId: input.songId, beatId: beat.id, mode: input.preset, sourceUrl } as never },
        });
        await enqueue({ queue: app.queues.music, name: 'stems', payload: { jobId: sepJob.id, workspaceId, projectId: project.id, songId: input.songId, beatId: beat.id, mode: input.preset, sourceUrl } });
        reply.code(202);
        return {
          jobId: sepJob.id,
          note: `${input.preset === 'instrumental' ? 'Instrumental' : 'Acapella'} is separated from the finished song (voice ${input.preset === 'instrumental' ? 'removed' : 'isolated'}, everything else kept, loudness-matched) — not a beat-only bounce. It lands on the song in a few minutes.`,
        };
      }

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'mix_preset',
        refTable: 'Song',
        refId: input.songId,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'mix',
          provider: 'internal',
          status: 'QUEUED',
          inputJson: input as never,
        },
      });

      await enqueue({
        queue: app.queues.mix,
        name: 'create-mix',
        payload: {
          jobId: job.id,
          workspaceId,
          projectId: project.id,
          songId: input.songId,
          preset: input.preset,
        },
      });

      reply.code(202);
      return { jobId: job.id };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { songId: string; preset: string; mixId?: string } }>(
    '/master',
    { schema: { body: createMasterInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = createMasterInputSchema.omit({ projectId: true }).parse(req.body);
      // Verify both the project and the song are in this workspace before charging.
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      await prisma.song.findFirstOrThrow({ where: { id: input.songId, workspaceId } });

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'master_preset',
        refTable: 'Song',
        refId: input.songId,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: req.params.projectId,
          kind: 'master',
          provider: 'internal',
          status: 'QUEUED',
          inputJson: input as never,
        },
      });

      await enqueue({
        queue: app.queues.master,
        name: 'create-master',
        payload: { jobId: job.id, workspaceId, projectId: req.params.projectId, ...input },
      });

      reply.code(202);
      return { jobId: job.id };
    }
  );

  // Upload a FINISHED song / full mix and (by default) master it immediately.
  // Stored as a Mix so the existing mastering chain runs on it verbatim.
  app.post<{ Params: { projectId: string } }>(
    '/upload',
    { schema: { body: attachSongUploadSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = attachSongUploadSchema.parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

      const songId =
        input.songId ??
        (
          await prisma.song.findFirst({
            where: { projectId: project.id },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          })
        )?.id ??
        (
          await prisma.song.create({
            data: {
              workspaceId,
              projectId: project.id,
              title: input.title ?? `${project.title} — uploaded song`,
              status: 'SKETCH',
            },
            select: { id: true },
          })
        ).id;

      const mix = await prisma.mix.create({
        data: {
          projectId: project.id,
          songId,
          preset: 'uploaded',
          url: publicUrlFor(assertOwnedKey(workspaceId, input.key)),
          notes: `Uploaded finished song${input.title ? ` — ${input.title}` : ''} (artist master source)`,
        },
      });

      // LEARN from every finished song the artist brings back (Suno bridge or
      // any upload): the artist chose to push this sound into the studio, so it
      // must feed the lake like a /listen — otherwise "I pushed my Suno songs
      // and it learned nothing". Best-effort: a failed charge or enqueue never
      // blocks the upload itself.
      try {
        const learnCharge = await app.chargeCredits({
          workspaceId,
          key: 'analyze_audio',
          refTable: 'Song',
          refId: songId,
        });
        if (learnCharge.ok) {
          const learnJob = await prisma.providerJob.create({
            data: {
              workspaceId,
              projectId: project.id,
              kind: 'analyze',
              provider: 'replicate',
              status: 'QUEUED',
              inputJson: { url: mix.url, source: 'finished-upload' } as never,
            },
          });
          await enqueue({
            queue: app.queues.music,
            name: 'analyze-audio',
            payload: { jobId: learnJob.id, workspaceId, projectId: project.id, url: mix.url },
          });
        }
      } catch (err) {
        req.log.warn({ err }, 'finished-upload learn enqueue failed (upload still ok)');
      }

      // HARVEST too (audit: finished uploads fed the lake but never the material
      // shelf): stem-split the record and file its NON-VOCAL stems as owned
      // material. Song-scoped — a finished upload has no beat row — and owned by
      // definition (this route only accepts the artist's own key). Best-effort.
      await enqueueHarvest(app, { workspaceId, projectId: project.id, songId, sourceUrl: mix.url, owned: true });

      if (!input.autoMaster) {
        reply.code(201);
        return { mix, songId, mastered: false };
      }

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'master_preset',
        refTable: 'Song',
        refId: songId,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'master',
          provider: 'internal',
          status: 'QUEUED',
          inputJson: { songId, mixId: mix.id, preset: input.masterPreset } as never,
        },
      });
      await enqueue({
        queue: app.queues.master,
        name: 'create-master',
        payload: {
          jobId: job.id,
          workspaceId,
          projectId: project.id,
          songId,
          mixId: mix.id,
          preset: input.masterPreset,
          finished: true, // an uploaded song is already a finished master → conform
        },
      });

      // Finish the pipeline: once the master lands, run Will-it-hit so an uploaded
      // Suno song gets scored just like a generated one (catalog shows it; the
      // release gate can act on it).
      void arReadAfterRender(app, workspaceId, [{ songId, jobId: job.id }]).catch(() => {});

      reply.code(202);
      return { mix, songId, mastered: true, jobId: job.id };
    }
  );
}

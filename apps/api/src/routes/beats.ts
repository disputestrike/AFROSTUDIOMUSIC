import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { generateBeatInputSchema, attachBeatUploadSchema } from '@afrohit/shared';
import { enrichLyricsForVocals, soundBrief, blendSoundBrief } from '@afrohit/ai';
import { learnedReferenceBrief, learnedStyleTags } from '../lib/learned';
import { requireAuth } from '../middleware/auth';
import { enqueue, QUEUES } from '../lib/queue';
import { publicUrlFor, assertOwnedKey } from '../lib/storage';

export default async function beats(app: FastifyInstance) {
  app.get<{ Params: { projectId: string } }>(
    '/',
    async (req) => {
      const { workspaceId } = requireAuth(req);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      return prisma.beatAsset.findMany({
        where: { projectId: req.params.projectId },
        include: { stems: true },
        orderBy: { createdAt: 'desc' },
      });
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/generate',
    { schema: { body: generateBeatInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateBeatInputSchema.omit({ projectId: true }).parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
        include: { artist: true },
      });

      // Full song WITH AI vocals: use provided lyrics, else pull the latest.
      let lyrics = input.lyrics;
      let styleHints: string[] = [];
      if (input.withVocals && !lyrics) {
        const lyric = await prisma.lyricDraft.findFirst({
          where: { projectId: project.id, ...(input.songId ? { songId: input.songId } : {}) },
          orderBy: { createdAt: 'desc' },
        });
        lyrics = lyric?.cleanVersion ?? lyric?.body ?? undefined;
        if (!lyrics) return reply.code(400).send({ error: 'no_lyrics — write lyrics first for a vocal song' });
      }
      // Genre Sound DNA (blended when mixing genres, colored by mood) + learned
      // references (the pinned just-listened one FIRST) so the beat rebuilds the
      // real sound it heard — learned tokens join the music-model tags.
      const dna = input.fusionGenres?.length
        ? blendSoundBrief([input.genre, ...input.fusionGenres], input.mood)
        : soundBrief(project.genre, input.mood);
      const learned = await learnedReferenceBrief(workspaceId, project.genre, input.pinnedReferenceId);
      const learnedTags = await learnedStyleTags(workspaceId, project.genre, input.pinnedReferenceId);
      const dnaTags = [...(dna.tags ?? []), ...learnedTags];

      // Arrange the vocal to sound ALIVE (ad-libs, doubled/harmonized hook).
      if (input.withVocals && lyrics && input.richVocals) {
        const enriched = await enrichLyricsForVocals({
          lyricBody: lyrics,
          languages: project.artist.languages,
          laneSummary: project.artist.laneSummary ?? undefined,
          soundDna: [dna.brief, learned].filter(Boolean).join('\n\n'),
        });
        if (enriched) {
          lyrics = enriched.enrichedLyrics;
          styleHints = enriched.styleTags;
        }
      }

      const charge = await app.chargeCredits({
        workspaceId,
        key: input.withVocals || input.withStems ? 'full_song_demo' : 'beat_idea_short_30s',
        refTable: 'Project',
        refId: project.id,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'music',
          provider: input.withVocals ? input.songEngine ?? 'ace_step' : process.env.MUSIC_PROVIDER ?? 'stub',
          status: 'QUEUED',
          inputJson: input as never,
        },
      });

      await enqueue({
        queue: app.queues.music,
        name: 'generate-music',
        payload: {
          jobId: job.id,
          workspaceId,
          projectId: project.id,
          songId: input.songId,
          input: {
            ...input,
            lyrics,
            // ANTI-SOUP: styleHints are TAGS (they join dnaTags), not sentence glue —
            // an ever-growing vibePrompt used to drown the genre identity.
            vibePrompt: input.vibePrompt || undefined,
            artistTone: project.artist.vocalTone,
            languages: project.artist.languages,
            dnaTags: [...dnaTags, ...styleHints.slice(0, 3)],
          },
        },
      });

      reply.code(202);
      return { jobId: job.id, status: 'queued' };
    }
  );

  // Bring your own beat / instrumental. The artist's authentic audio — stored
  // as-is, auto-approved, and used verbatim through mix + master. Never invented.
  app.post<{ Params: { projectId: string } }>(
    '/upload',
    { schema: { body: attachBeatUploadSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = attachBeatUploadSchema.parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

      // If the artist gave us the beat's tempo/key, write the SONG to the beat —
      // lyrics + melody read project.bpm/keySignature, so the words land in pocket.
      if (input.bpm || input.keySignature) {
        await prisma.project.update({
          where: { id: project.id },
          data: {
            ...(input.bpm ? { bpm: input.bpm } : {}),
            ...(input.keySignature ? { keySignature: input.keySignature } : {}),
          },
        });
      }

      // Bind to a song so mix/master pick this beat up. Use the given song, else
      // the project's most recent one, else start a fresh session around the beat.
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
              title: input.title ?? `${project.title} — uploaded beat`,
              status: 'SKETCH',
            },
            select: { id: true },
          })
        ).id;

      const beat = await prisma.beatAsset.create({
        data: {
          projectId: project.id,
          songId,
          url: publicUrlFor(assertOwnedKey(workspaceId, input.key)),
          format: input.format,
          bpm: input.bpm ?? null,
          keySignature: input.keySignature ?? null,
          duration: input.durationS ?? null,
          provider: 'upload',
          approved: true, // the artist's own beat is authentic — auto-approved
          meta: {
            uploaded: true,
            source: 'artist_upload',
            title: input.title ?? null,
            instrumental: input.instrumental ?? false,
          },
        },
      });

      reply.code(201);
      return { ...beat, songId };
    }
  );
}

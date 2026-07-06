import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { generateLyricsInputSchema, GENRES } from '@afrohit/shared';
import { prompts, responsesJson, soundBrief, generateJson } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';

export default async function lyrics(app: FastifyInstance) {
  app.get<{ Params: { projectId: string } }>(
    '/',
    async (req) => {
      const { workspaceId } = requireAuth(req);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      return prisma.lyricDraft.findMany({
        where: { projectId: req.params.projectId },
        orderBy: { createdAt: 'desc' },
      });
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/generate',
    { schema: { body: generateLyricsInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateLyricsInputSchema.omit({ projectId: true }).parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
        include: { artist: true, briefs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      const hook = await prisma.hookCandidate.findFirstOrThrow({
        where: { id: input.hookId, projectId: project.id },
      });

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'lyrics_full',
        refTable: 'Hook',
        refId: hook.id,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const output = await responsesJson<{
        title: string;
        body: string;
        cleanVersion?: string;
        explicit?: boolean;
        structure?: unknown;
        languageMix?: Record<string, number>;
        needsNativeReview?: string[];
      }>({
        system: prompts.LYRIC_SYSTEM,
        user: prompts.lyricUserPrompt({
          artist: project.artist as never,
          brief: project.briefs[0] as never,
          hookText: hook.text,
          cleanVersion: input.cleanVersion,
          languageMix: input.languageMix as never,
          soundDna: [soundBrief(project.genre).brief, prompts.hitCraftBrief('lyric', (project.briefs?.[0] as { mood?: string } | undefined)?.mood)].filter(Boolean).join('\n\n'),
        }),
        temperature: 0.8,
        maxOutputTokens: 4_000,
      });

      // songId is @unique on LyricDraft — upsert so re-generating a song's lyric
      // updates it instead of hitting the unique constraint.
      const lyricData = {
        projectId: project.id,
        title: output.title,
        body: output.body,
        cleanVersion: output.cleanVersion,
        explicit: output.explicit ?? false,
        structure: output.structure as never,
        languageMix: output.languageMix as never,
        approved: false,
      };
      const lyric = hook.songId
        ? await prisma.lyricDraft.upsert({
            where: { songId: hook.songId },
            create: { ...lyricData, songId: hook.songId },
            update: lyricData,
          })
        : await prisma.lyricDraft.create({ data: lyricData });

      if (hook.songId) {
        await prisma.song.update({
          where: { id: hook.songId },
          data: { lyricId: lyric.id, status: 'DEMO' },
        });
      }

      // Uncertain heritage-language lines become a review task for a native
      // speaker. The lyric stays usable, but the flag is now tracked, not lost.
      const flags = output.needsNativeReview ?? [];
      let reviewTaskId: string | null = null;
      if (flags.length > 0) {
        const task = await prisma.reviewTask.create({
          data: {
            workspaceId,
            projectId: project.id,
            lyricId: lyric.id,
            kind: 'native_language',
            language: flags[0]?.split(':')[0] ?? null,
            items: flags.map((ref) => ({ ref })) as never,
          },
        });
        reviewTaskId = task.id;
      }

      reply.code(201);
      return { lyric, needsNativeReview: flags, reviewTaskId };
    }
  );

  /**
   * FROM-LYRICS path, step 1 — DECONSTRUCT: the artist pastes their own lyrics
   * and the studio reads them like a producer: language mix, lyric success-mode,
   * themes, structure, the hook line, and the genre/BPM/mood it wants to be.
   * Pure analysis (no DB write) — the UI shows it for confirmation before "Go".
   */
  const deconstructSchema = z.object({ lyrics: z.string().min(20).max(6000) });
  app.post<{ Params: { projectId: string } }>(
    '/deconstruct',
    { schema: { body: deconstructSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      const { lyrics: raw } = deconstructSchema.parse(req.body);
      const charge = await app.chargeCredits({ workspaceId, key: 'brief_polish', refTable: 'Project', refId: req.params.projectId });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const modes = prompts.lyricModes().map((m) => `${m.id}: ${m.whenToUse}`).join('\n');
      const out = await generateJson<{
        title: string;
        languages: string[];
        mode: string;
        themes: string[];
        structure: string[];
        hookLine: string | null;
        suggestedGenre: string;
        suggestedBpm: number;
        mood: string;
        vocalDirection: string;
        notes: string;
      }>({
        system:
          'You are a top producer DECONSTRUCTING an artist\'s own lyrics so the studio can produce them correctly. Read the lyrics and return strict JSON: ' +
          'title (from the hook/theme, never an instruction), languages (ISO-ish codes like en/pcm/yo/ig/ha/es/fr among those present), ' +
          `mode (the lyric success-mode id that best fits, one of:\n${modes}\n), ` +
          'themes (3-6 short tags), structure (the sections you can identify in order, e.g. ["verse","pre-hook","hook"...]; infer if unlabeled), ' +
          'hookLine (the single most chantable line, or null), ' +
          `suggestedGenre (EXACTLY one of: ${GENRES.join(', ')}), ` +
          'suggestedBpm (integer 60-180 typical for that genre+flow), mood (one word), ' +
          'vocalDirection (one line: delivery/energy/ad-lib guidance for the singer), notes (one honest line: what these lyrics need to hit). Return only JSON.',
        user: raw,
        temperature: 0.3,
        maxTokens: 900,
      });
      // Never let a hallucinated genre escape the enum.
      const genre = (GENRES as readonly string[]).includes(out.suggestedGenre) ? out.suggestedGenre : 'afrobeats';
      return { ...out, suggestedGenre: genre, suggestedBpm: Math.min(Math.max(Math.round(out.suggestedBpm || 103), 60), 180) };
    }
  );

  /**
   * FROM-LYRICS path, step 2 — ATTACH: bind the artist's own lyrics to a fresh
   * Song so production (beats/generate withVocals) sings EXACTLY these words.
   * Artist-authored = authentic → approved, same doctrine as uploads.
   */
  const attachSchema = z.object({ title: z.string().min(1).max(120), body: z.string().min(20).max(6000) });
  app.post<{ Params: { projectId: string } }>(
    '/attach',
    { schema: { body: attachSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const project = await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      const { title, body } = attachSchema.parse(req.body);
      const song = await prisma.song.create({
        data: { workspaceId, projectId: project.id, title, status: 'SKETCH' },
      });
      const lyric = await prisma.lyricDraft.create({
        data: { projectId: project.id, songId: song.id, title, body, approved: true },
      });
      await prisma.song.update({ where: { id: song.id }, data: { lyricId: lyric.id } });
      reply.code(201);
      return { songId: song.id, lyricId: lyric.id };
    }
  );

  app.post<{ Params: { projectId: string; lyricId: string } }>(
    '/:lyricId/approve',
    async (req, reply) => {
      const { userId, workspaceId } = requireAuth(req);
      // Scope by workspace — never approve another workspace's lyric by id.
      const updated = await prisma.lyricDraft.updateMany({
        where: { id: req.params.lyricId, project: { workspaceId } },
        data: { approved: true },
      });
      if (updated.count === 0) return reply.code(404).send({ error: 'lyric_not_found' });
      const lyric = await prisma.lyricDraft.findUniqueOrThrow({ where: { id: req.params.lyricId } });
      await prisma.approval.create({
        data: {
          workspaceId,
          projectId: req.params.projectId,
          userId,
          gate: 'lyrics',
          decision: 'approved',
        },
      });
      return lyric;
    }
  );
}

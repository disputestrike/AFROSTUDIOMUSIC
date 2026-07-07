import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { generateLyricsInputSchema, GENRES } from '@afrohit/shared';
import { joinBriefs, prompts, responsesJson, soundBrief, generateJson} from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { learnLyricCraft, findLearnedLyric } from '../lib/lyric-learn';
import { learnedReferenceBrief, learnedLyricCraftBrief, freshnessBrief } from '../lib/learned';
import { lexiconPalette } from '../lib/lexicon';

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
          soundDna: joinBriefs([
            await freshnessBrief(workspaceId),
            await lexiconPalette({ workspaceId, languages: project.artist.languages, mood: (project.briefs?.[0] as { mood?: string } | undefined)?.mood, rotate: Date.now() % 97 }),
            soundBrief(project.genre).brief,
            await learnedReferenceBrief(workspaceId, project.genre),
            await learnedLyricCraftBrief(workspaceId, project.genre),
            prompts.hitCraftBrief('lyric', (project.briefs?.[0] as { mood?: string } | undefined)?.mood),
          ]),
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
      // Every lyric brought to the studio ALSO teaches it (fire-and-forget —
      // the craft lands in the data lake and feeds future hooks/lyrics).
      // Deduped by lyric hash and charged like any other LLM call, so
      // re-deconstructing while iterating never double-studies or dodges caps.
      void (async () => {
        if (await findLearnedLyric(workspaceId, raw)) return;
        const learnCharge = await app.chargeCredits({ workspaceId, key: 'brief_polish', refTable: 'Project', refId: req.params.projectId });
        if (!learnCharge.ok) return;
        await learnLyricCraft({ workspaceId, raw, genreHint: genre });
      })().catch(() => {});
      return { ...out, suggestedGenre: genre, suggestedBpm: Math.min(Math.max(Math.round(out.suggestedBpm || 103), 60), 180) };
    }
  );

  /**
   * LEARN FROM A LYRIC — the data-lake teacher (Listen page, third option).
   * Bring ANY lyrics: the studio studies the CRAFT (hook mechanics, flow,
   * repetition, code-switching, imagery field) and shelves the LESSONS — never
   * the words (Feist doctrine, enforced in lyric-learn.ts). Every future hook
   * and lyric pulls from what it learned here.
   */
  const learnSchema = z.object({ lyrics: z.string().min(40).max(6000), genreHint: z.string().max(40).optional() });
  app.post<{ Params: { projectId: string } }>(
    '/learn',
    { schema: { body: learnSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      const input = learnSchema.parse(req.body);
      // Already studied? Return the existing lesson free — no charge, no dup row.
      const existing = await findLearnedLyric(workspaceId, input.lyrics);
      if (!existing) {
        const charge = await app.chargeCredits({ workspaceId, key: 'brief_polish', refTable: 'Project', refId: req.params.projectId });
        if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
      }
      const { referenceId, craft, alreadyLearned } = await learnLyricCraft({ workspaceId, raw: input.lyrics, genreHint: input.genreHint });
      const learned = await prisma.soundReference.count({ where: { workspaceId, sourceUrl: { startsWith: 'lyric:' } } });
      reply.code(201);
      return { referenceId, craft, alreadyLearned: alreadyLearned ?? false, lyricCraftInLibrary: learned };
    }
  );

  /**
   * TRAINING SESSION — learn WORDS + STORYTELLING from a finished listen.
   * Takes an analyze job (one chunk of the 1-2h session), pulls the transcript
   * the studio heard, and studies its CRAFT into the data lake — patterns,
   * storytelling shape, vocabulary registers. NEVER the words themselves
   * (stripVerbatim doctrine in lyric-learn.ts); the audio itself was already
   * purged by the worker. Deduped + charged like every LLM call.
   */
  const lfaSchema = z.object({ analyzeJobId: z.string().cuid() });
  app.post<{ Params: { projectId: string } }>(
    '/learn-from-analysis',
    { schema: { body: lfaSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      const { analyzeJobId } = lfaSchema.parse(req.body);
      const job = await prisma.providerJob.findFirst({ where: { id: analyzeJobId, workspaceId }, select: { status: true, outputJson: true } });
      if (!job || job.status !== 'SUCCEEDED') return reply.code(400).send({ error: 'analyze_not_ready' });
      const profile = (job.outputJson as { profile?: { raw?: string; genre?: string } } | null)?.profile;
      const transcript = /Transcript \(lyrics heard\):\n([\s\S]*?)(?=\nProducer's ear \(audio model description\):|$)/.exec(profile?.raw ?? '')?.[1]?.trim() ?? '';
      if (transcript.replace(/\s/g, '').length < 60) {
        return reply.code(200).send({ learned: false, reason: 'no_usable_vocal — instrumental or too little was heard in this chunk' });
      }
      const existing = await findLearnedLyric(workspaceId, transcript);
      if (existing) return { learned: true, alreadyLearned: true, referenceId: existing.id };
      const charge = await app.chargeCredits({ workspaceId, key: 'brief_polish', refTable: 'Project', refId: req.params.projectId });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
      const { referenceId, craft } = await learnLyricCraft({ workspaceId, raw: transcript, genreHint: profile?.genre });
      return { learned: true, referenceId, craftTitle: craft.craftTitle, mode: craft.mode, genre: craft.genre, lessons: craft.craftLessons.slice(0, 2) };
    }
  );

  /**
   * MUMBLE → LYRICS (Benjamin's own method: "I always start with mumbles and
   * random words... after I get a vibe I go in and make those mumbles into
   * words"). Takes a finished analyze job of a HUMMED/MUMBLED take and converts
   * the phonetics into lyric candidates that PRESERVE the take's rhythm —
   * syllable counts, line lengths, where the stresses land. The vibe was found
   * by the body; the words come after. Improvisation-first, like real writing.
   */
  const mumbleSchema = z.object({ analyzeJobId: z.string().cuid() });
  app.post<{ Params: { projectId: string } }>(
    '/from-mumble',
    { schema: { body: mumbleSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      const { analyzeJobId } = mumbleSchema.parse(req.body);
      const job = await prisma.providerJob.findFirst({ where: { id: analyzeJobId, workspaceId }, select: { status: true, outputJson: true } });
      if (!job || job.status !== 'SUCCEEDED') return reply.code(400).send({ error: 'analyze_not_ready', message: 'The listen job has not finished — poll it first.' });
      const profile = (job.outputJson as { profile?: { raw?: string; bpm?: number; mood?: string; genre?: string; language?: string | null } } | null)?.profile;
      if (!profile) return reply.code(400).send({ error: 'no_profile', message: 'That job has no audio profile.' });
      // profile.raw = signals joined by '\n'; the transcript block runs until the
      // next known signal header (or the end) — transcript lines themselves are
      // multi-line, so never stop at "any capitalized line".
      const transcript =
        /Transcript \(lyrics heard\):\n([\s\S]*?)(?=\nProducer's ear \(audio model description\):|$)/.exec(profile.raw ?? '')?.[1]?.trim() ||
        (profile.raw ?? '').slice(0, 800);
      if (transcript.replace(/\s/g, '').length < 8) {
        return reply.code(400).send({ error: 'no_vocal_heard', message: 'Could not hear a voice in that take — hum or mumble a bit louder/longer (10s+) and try again.' });
      }

      const charge = await app.chargeCredits({ workspaceId, key: 'lyrics_full', refTable: 'Project', refId: req.params.projectId });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const out = await generateJson<{
        candidates: Array<{ title: string; hookLine: string; lyric: string; flowNotes: string }>;
      }>({
        system:
          'You are a songwriter converting a singer\'s MUMBLE TAKE into real words — the artist found the melody and rhythm with their body first; your job is language that fits THAT groove exactly. ' +
          'RULES: (1) PRESERVE THE FLOW — match each mumbled line\'s syllable count, stresses and line length as closely as possible; the words must sing on the same contour. ' +
          '(2) The mumble transcript is phonetic soup — hear THROUGH it: keep any real words/phrases that already landed (they were instinct), replace the rest. ' +
          '(3) Give THREE distinct directions (e.g. love/flex/testimony) so the artist picks the story, not just the words. ' +
          '(4) Each candidate: title, hookLine (the single most chantable line), lyric (a [Hook] + one [Verse] built ON the mumble\'s structure — mark sections), flowNotes (one line: how the words ride the take\'s rhythm). ' +
          '(5) Match the languages heard (pidgin/english/yoruba etc). Return only JSON {candidates:[...3]}.',
        user:
          `MUMBLE TRANSCRIPT (phonetic, from the take):\n${transcript.slice(0, 1200)}\n\n` +
          `HEARD: ${profile.bpm ? profile.bpm + 'bpm, ' : ''}${profile.mood ?? ''} ${profile.genre ?? ''}${profile.language ? ', language: ' + profile.language : ''}`.trim(),
        temperature: 0.8,
        maxTokens: 2500,
      });
      const candidates = (out?.candidates ?? []).filter((c) => c?.lyric).slice(0, 3);
      if (!candidates.length) return reply.code(503).send({ error: 'conversion_failed', message: 'Could not convert this take — try a longer mumble.' });
      return {
        heard: { transcript: transcript.slice(0, 500), bpm: profile.bpm ?? null, mood: profile.mood ?? null, genre: profile.genre ?? null },
        candidates,
      };
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

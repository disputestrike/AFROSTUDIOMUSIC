import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { generateBeatInputSchema, attachBeatUploadSchema, genreSignature } from '@afrohit/shared';
import { enrichLyricsForVocals, defaultSongEngine, defaultInstrumentalEngine } from '@afrohit/ai';
import { learnedReferenceBrief, learnedStyleTags, learnedMeasuredTags, learnedUsage } from '../lib/learned';
import { applySingingBrain, craftOf, type DraftCraft } from '../lib/singing-pipeline';
import { enqueueHarvest, enqueueLearn } from '../lib/harvest';
import { ownShelfRoles } from '../lib/material-plan';
import { laneDna } from '../lib/lane-pipeline';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';
import { publicUrlFor, assertOwnedKey } from '../lib/storage';
import { voiceVocalTag, languageVocalTag } from '../services/chat-tools';

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
      // ARTIST'S WORDS ARE LAW: when the draft is artistAuthored (create-from-
      // lyrics), the render sings the EXACT body — never an AI cleanVersion, and
      // never the enrichment rewrite below. People bring their own lyrics; the
      // studio must not touch a word.
      let artistAuthored = false;
      // Writing Brain craft (LyricDraft.craftJson) — the Singing Brain's
      // premise/hookCell/anchors. Null on old drafts and inline-only lyrics.
      let draftCraft: DraftCraft | null = null;
      if (input.withVocals && !lyrics) {
        const lyric = await prisma.lyricDraft.findFirst({
          where: { projectId: project.id, ...(input.songId ? { songId: input.songId } : {}) },
          orderBy: { createdAt: 'desc' },
        });
        artistAuthored = !!(lyric as { artistAuthored?: boolean } | null)?.artistAuthored;
        lyrics = artistAuthored ? lyric?.body ?? undefined : lyric?.cleanVersion ?? lyric?.body ?? undefined;
        draftCraft = craftOf(lyric);
        if (!lyrics) return reply.code(400).send({ error: 'no_lyrics — write lyrics first for a vocal song' });
      } else if (input.withVocals && lyrics && input.songId) {
        // SERVER-ENFORCED VERBATIM (the hole the client path fell through): when
        // lyrics arrive INLINE the guard above never ran, artistAuthored stayed
        // false, and the enrichment below rewrote the artist's own words. If this
        // song's draft is artistAuthored, the draft body is the law regardless of
        // how the request carried the text.
        const draft = await prisma.lyricDraft.findFirst({
          where: { projectId: project.id, songId: input.songId },
          orderBy: { createdAt: 'desc' },
        });
        if ((draft as { artistAuthored?: boolean } | null)?.artistAuthored) {
          artistAuthored = true;
          lyrics = draft?.body ?? lyrics;
        }
        draftCraft = craftOf(draft);
      }
      // SELECTED genre wins (audit #4): the render path used project.genre — so
      // picking amapiano on an afrobeats project rendered afrobeats. The user's
      // request genre is the truth; the project genre is only the fallback.
      const genre = input.genre ?? project.genre;
      // Genre Sound DNA (blended when mixing genres, colored by mood) + learned
      // references (the pinned just-listened one FIRST) so the beat rebuilds the
      // real sound it heard — learned tokens join the music-model tags.
      const dna = input.fusionGenres?.length
        ? laneDna(genre, { mood: input.mood, fusionGenres: input.fusionGenres })
        : laneDna(genre, { mood: input.mood });
      const learned = await learnedReferenceBrief(workspaceId, genre, input.pinnedReferenceId);
      const learnedTags = await learnedStyleTags(workspaceId, genre, input.pinnedReferenceId);
      // MEASURED facts (the truly reference-specific signal) now reach the render.
      const measuredTags = await learnedMeasuredTags(workspaceId, genre, input.pinnedReferenceId);
      // TRACEABILITY: capture exactly which of the artist's references this render
      // draws on, so "have my beats been used?" is provable per beat. Stored on
      // the job (below) and logged. measured<total = training that hasn't been
      // deep-measured yet contributes little — the honest signal to backfill.
      const trainingUsage = await learnedUsage(workspaceId, genre, input.pinnedReferenceId);
      req.log.info({ workspaceId, genre, usedRefs: trainingUsage.referenceIds.length, measured: `${trainingUsage.measured}/${trainingUsage.total}`, pin: trainingUsage.pinnedReferenceId }, '[training] references applied to this render');
      const dnaTags = [...measuredTags, ...(dna.tags ?? []), ...learnedTags];

      // The user's SELECTED languages outrank the artist profile's defaults —
      // this is the from-lyrics path where Igbo lyrics used to reach the engine
      // with no language identity at all.
      const langs = input.languages?.length ? input.languages : project.artist.languages;

      // Arrange the vocal to sound ALIVE (ad-libs, doubled/harmonized hook).
      // SKIPPED for artist-authored lyrics — enrichment rewrites lines, and the
      // artist's words must reach the engine verbatim.
      if (input.withVocals && lyrics && input.richVocals && !artistAuthored) {
        const enriched = await enrichLyricsForVocals({
          genre,
          lyricBody: lyrics,
          voice: input.voice,
          languages: langs,
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
        // WO-1/WO-5: N candidates = N renders = N charges against the cap.
        multiplier: Math.max(1, input.candidates ?? 1),
        refTable: 'Project',
        refId: project.id,
        // IDEMPOTENCY (audit FAKE_GREEN: supported but never passed): a retried/
        // double-submitted create with the same Idempotency-Key charges ONCE.
        idempotencyKey: (req.headers['idempotency-key'] as string) || undefined,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      // OUR OWN ENGINE (Feature: both MiniMax AND ours). When the user picks
      // 'own', build the instrumental by ASSEMBLING the artist's harvested +
      // synthesized material (processOwnEngine) instead of renting a provider
      // model — the "hard musical control" path. Full sung vocals aren't wired to
      // the own engine yet, so 'own' produces the INSTRUMENTAL bed (vocals via
      // upload or a separate render).
      // MATERIAL-FIRST AUTO (audit: 'auto' ALWAYS rented a provider): engine
      // unset + INSTRUMENTAL ask + a stocked shelf (≥ OWN_ENGINE_MIN_ROLES
      // distinct roles for this genre) → the same own-engine path, and the
      // response SAYS so (materialSource). withVocals NEVER auto-routes here —
      // the own engine cannot sing; that stays with the providers.
      const autoOwnRoles = !input.songEngine && !input.withVocals ? await ownShelfRoles(workspaceId, genre) : null;
      if (input.songEngine === 'own' || autoOwnRoles) {
        const ownBpm = input.bpm ?? genreSignature(genre).bpm;
        const ownJob = await prisma.providerJob.create({
          data: {
            workspaceId, projectId: project.id, kind: 'music', provider: 'afrohit-own', status: 'QUEUED',
            inputJson: { ownEngine: true, genre, bpm: ownBpm, ...(autoOwnRoles ? { autoOwn: true } : {}), _charge: { key: 'beat_idea_short_30s', multiplier: 1 } } as never,
          },
        });
        await enqueue({
          queue: app.queues.music, name: 'own-engine',
          payload: { jobId: ownJob.id, workspaceId, projectId: project.id, songId: input.songId, genre, bpm: ownBpm, melodyPrompt: genreSignature(genre).melodyPrompt },
        });
        reply.code(202);
        return {
          jobId: ownJob.id, status: 'queued', engine: 'afrohit-own-v1',
          ...(autoOwnRoles ? { materialSource: `own-shelf (${autoOwnRoles} roles)` } : {}),
          note: autoOwnRoles
            ? `Your ${genre.replace(/_/g, ' ')} shelf is stocked — own-shelf (${autoOwnRoles} roles) — so this beat is assembled from YOUR OWN material instead of renting a provider. Poll the job.`
            : 'Building the beat from your own + synthesized material (owned engine). Poll the job.',
        };
      }

      // SINGING BRAIN — the sung-form layer between the Writing Brain and the
      // engine. Runs AFTER enrichment on what the engine will actually sing,
      // is MEASURED by the lyric-scorecard (one retry told exactly what broke),
      // and NEVER blocks a render: a failing conversion ships the semantic
      // form and records the failures honestly in sungForm (Truth report).
      // VERBATIM LAW: artist-authored lyrics are never transformed — recorded
      // as skipped instead.
      let sungForm: Record<string, unknown> | undefined;
      if (input.withVocals && lyrics) {
        if (artistAuthored) {
          sungForm = { applied: false, skipped: 'artist-authored — verbatim law' };
        } else {
          // Approved hook = hookCell fallback for old drafts with no craftJson.
          const hook = draftCraft?.hookCell
            ? null
            : await prisma.hookCandidate.findFirst({
                where: { projectId: project.id, ...(input.songId ? { songId: input.songId } : {}), approved: true },
                orderBy: { createdAt: 'desc' },
                select: { text: true },
              });
          const sung = await applySingingBrain({
            semanticLyric: lyrics,
            draftCraft,
            hookText: hook?.text,
            genre,
            languages: langs,
          });
          lyrics = sung.lyrics;
          sungForm = sung.sungForm;
        }
      }

      // ONE final tag set, stored AND sent — the Truth report reads the stored
      // copy (promptStyleTags), the engine renders from the payload copy; they
      // must never diverge.
      // VOCAL-RHYTHM DIRECTIVE (owner directive): when the Singing Brain shaped
      // the sung form, tell the engine HOW to deliver it — the sung text carries
      // the syllables; this tag carries the pocket.
      const sungApplied = !!(sungForm as { applied?: boolean } | null)?.applied;
      const finalDnaTags = [
        ...[voiceVocalTag(input.voice), input.withVocals ? languageVocalTag(langs) : null].filter((t): t is string => !!t),
        ...(sungApplied ? ['vocal delivery: syncopated Afro phrasing, off-beat pushes into the hook, melisma runs held on open vowels'] : []),
        ...dnaTags,
        ...styleHints.slice(0, 3),
      ];
      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'music',
          provider: input.withVocals ? input.songEngine ?? defaultSongEngine() : defaultInstrumentalEngine(),
          status: 'QUEUED',
          // _charge lets the worker REFUND this on failure (charge-before-enqueue).
          // sungForm = the Singing Brain's receipt (applied/pass/metrics/failures)
          // next to trainingUsage/dnaTags — the Truth report reads it verbatim.
          inputJson: { ...input, genre, trainingUsage, dnaTags: finalDnaTags, ...(sungForm ? { sungForm } : {}), _charge: { key: input.withVocals || input.withStems ? 'full_song_demo' : 'beat_idea_short_30s', multiplier: Math.max(1, input.candidates ?? 1) } } as never,
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
            // Pin the SELECTED genre so the worker's tags/kit render THIS lane,
            // not the project's (audit #4).
            genre,
            trainingUsage,
            lyrics,
            // Vocal songs default to FULL LENGTH (genre standard) — the old
            // schema default(60) rendered 60-second "full songs" for any caller
            // that omitted duration. Instrumental sketches stay short.
            durationS: input.durationS ?? (input.withVocals ? genreSignature(genre).durationS : 60),
            // ANTI-SOUP: styleHints are TAGS (they join dnaTags), not sentence glue —
            // an ever-growing vibePrompt used to drown the genre identity.
            // Influence = artist LANE (energy/tempo/production feel), same
            // semantics as the drop path — never a copy, never named.
            vibePrompt: [input.vibePrompt, input.influence ? `in the vibe/lane of ${input.influence} (capture the energy and production feel, never copy)` : null].filter(Boolean).join('. ') || undefined,
            artistTone: project.artist.vocalTone,
            languages: langs,
            dnaTags: finalDnaTags,
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

      // Auto-harvest the artist's own uploaded beat into reusable role loops.
      await enqueueHarvest(app, { workspaceId, projectId: project.id, beatId: beat.id, sourceUrl: beat.url });
      // AUTO-LEARN too (audit: harvested but never learned): the artist's own
      // beat joins the learned lake as a SoundReference — genre hint = the
      // project's genre, read by the analyze processor. Charged; best-effort.
      await enqueueLearn(app, { workspaceId, projectId: project.id, url: beat.url, source: 'beat-upload' });
      reply.code(201);
      return { ...beat, songId };
    }
  );
}

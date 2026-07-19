import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import {
  generateBeatInputSchema,
  attachBeatUploadSchema,
  genreSignature,
  requestedMaterialRoleContract,
} from '@afrohit/shared';
import { enrichLyricsForVocals } from '@afrohit/ai';
import {
  learnedReferenceBrief,
  learnedStyleTags,
  learnedMeasuredTags,
  learnedUsage,
  PinnedLearnedReferenceUnavailableError,
  type TrainingUsage,
} from '../lib/learned';
import { applySingingBrain, craftOf, type DraftCraft } from '../lib/singing-pipeline';
import { enqueueHarvest, enqueueLearn } from '../lib/harvest';
import { ownShelfRoles } from '../lib/material-plan';
import { laneDna } from '../lib/lane-pipeline';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { publicUrlFor, verifyUploadedAudio } from '../lib/storage';
import { voiceVocalTag, languageVocalTag } from '../services/chat-tools';
import { musicRouteCapabilities, validateMusicRoute } from '../lib/music-capabilities';
import { registerBeatForInspection } from '../lib/beat-ingest';

export interface OwnEngineRoutingInput {
  songEngine?: string;
  withVocals?: boolean;
  fusionGenres?: readonly string[];
  mood?: string;
  influence?: string;
  keySignature?: string;
  pinnedReferenceId?: string;
  withStems?: boolean;
  durationS?: number;
  vibePrompt?: string;
  candidates?: number;
}

export type OwnEngineRoutingDecision =
  // 'own' now carries the controls it will IGNORE (owner directive: Our Engine
  // always renders when explicitly chosen; it never rejects).
  | { mode: 'own'; unsupportedControls: string[] }
  | { mode: 'auto-candidate'; unsupportedControls: [] }
  | { mode: 'provider'; unsupportedControls: string[] }
  | { mode: 'reject'; unsupportedControls: string[] };

export function unsupportedOwnEngineControls(
  input: OwnEngineRoutingInput,
  trainingReferenceCount = 0,
): string[] {
  return [
    input.fusionGenres?.length ? 'fusionGenres' : null,
    input.mood?.trim() ? 'mood' : null,
    input.influence?.trim() ? 'influence' : null,
    input.keySignature?.trim() ? 'keySignature' : null,
    input.pinnedReferenceId ? 'pinnedReferenceId' : null,
    trainingReferenceCount > 0 ? 'trainingReferences' : null,
    input.withStems ? 'withStems' : null,
    input.durationS !== undefined ? 'durationS' : null,
    input.vibePrompt?.trim() ? 'vibePrompt' : null,
    (input.candidates ?? 1) > 1 ? 'candidates' : null,
  ].filter((control): control is string => control !== null);
}

export function resolveOwnEngineRouting(
  input: OwnEngineRoutingInput,
  trainingReferenceCount = 0,
): OwnEngineRoutingDecision {
  const unsupportedControls = unsupportedOwnEngineControls(input, trainingReferenceCount);
  if (input.songEngine === 'own') {
    // Owner directive (2026-07-19): "Our Engine is the default and must work for
    // anything." When it's EXPLICITLY chosen it must ALWAYS render — it simply
    // ignores the controls it can't honor yet (mood/vibePrompt/trainingReferences;
    // the own-engine worker never reads them) instead of rejecting the job. The
    // ignored controls are still reported so the UI can note them, softly.
    return { mode: 'own', unsupportedControls };
  }
  if (input.songEngine || input.withVocals || unsupportedControls.length) {
    return { mode: 'provider', unsupportedControls };
  }
  return { mode: 'auto-candidate', unsupportedControls: [] };
}

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
      // Fires BEFORE any lookup or spend, and the message now says the honest
      // way through (the web client sends withVocals:false for 'own' since
      // 2026-07-16; this guards direct API callers with a clear next step).
      if (input.withVocals && input.songEngine === 'own') {
        return reply.code(422).send({
          error: 'own_vocal_pipeline_unavailable',
          message: 'Our Engine currently produces instrumentals only. Send withVocals:false for the instrumental bed (add vocals by upload or re-sing), or choose a vocal-capable engine for a sung song.',
        });
      }
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
        include: { artist: true },
      });
      if (input.songId) {
        await prisma.song.findFirstOrThrow({ where: { id: input.songId, projectId: project.id, workspaceId } });
      }
      // EVERY CREATION HAS A CATALOG HOME (owner: "it's basically saved…
      // would that be my catalog? I can't see anything"): doors 2/3 used to
      // render into an ORPHAN BeatAsset (songId NULL, no Song row) that no
      // catalog view could ever show — the finished beat was undownloadable
      // by invisibility. Mint the Song up front, TYPED, exactly like the
      // upload route always did; the workers bind the audio to it and the
      // catalog card exists from the first second.
      const effectiveSongId =
        input.songId ??
        (
          await prisma.song.create({
            data: {
              workspaceId,
              projectId: project.id,
              title:
                project.title +
                (input.creationKind === 'film_sound'
                  ? ' — film cue'
                  : input.withVocals
                    ? ''
                    : ' — instrumental'),
              status: 'SKETCH',
              kind:
                input.creationKind ??
                (input.withVocals ? 'song' : 'instrumental'),
            },
            select: { id: true },
          })
        ).id;

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
      let learned: string;
      let learnedTags: string[];
      let measuredTags: string[];
      let trainingUsage: TrainingUsage;
      try {
        [learned, learnedTags, measuredTags, trainingUsage] = await Promise.all([
          learnedReferenceBrief(workspaceId, genre, input.pinnedReferenceId),
          learnedStyleTags(workspaceId, genre, input.pinnedReferenceId),
          learnedMeasuredTags(workspaceId, genre, input.pinnedReferenceId),
          learnedUsage(workspaceId, genre, input.pinnedReferenceId),
        ]);
      } catch (error) {
        if (error instanceof PinnedLearnedReferenceUnavailableError) {
          return reply.code(422).send({
            error: error.code,
            message: error.message,
            pinnedReferenceId: error.referenceId,
          });
        }
        throw error;
      }
      // MEASURED facts (the truly reference-specific signal) now reach the render.
      // TRACEABILITY: capture exactly which of the artist's references this render
      // draws on, so "have my beats been used?" is provable per beat. Stored on
      // the job (below) and logged. measured<total = training that hasn't been
      // deep-measured yet contributes little - the honest signal to backfill.
      req.log.info({ workspaceId, genre, usedRefs: trainingUsage.referenceIds.length, measured: `${trainingUsage.measured}/${trainingUsage.total}`, pin: trainingUsage.pinnedReferenceId }, '[training] references applied to this render');
      const dnaTags = [...measuredTags, ...(dna.tags ?? []), ...learnedTags];

      // The user's SELECTED languages outrank the artist profile's defaults —
      // this is the from-lyrics path where Igbo lyrics used to reach the engine
      // with no language identity at all.
      const langs = input.languages?.length ? input.languages : project.artist.languages;

      // Arrange the vocal to sound ALIVE (ad-libs, doubled/harmonized hook).
      // SKIPPED for artist-authored lyrics — enrichment rewrites lines, and the
      // artist's words must reach the engine verbatim.
      let sectionVoicing: Array<{ section: string; voices: string[] }> | undefined;
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
          // PERFORMER LAW hand-off: the arranger's who-sings-what record is
          // persisted in the job input so the VIDEO brain can put the singer
          // of a passage ON SCREEN in it (duet incident, 2026-07-17).
          sectionVoicing = enriched.sectionVoicing;
        }
      }

      const roleRequest = requestedMaterialRoleContract(input.instruments);
      const ownRouting = resolveOwnEngineRouting(input, trainingUsage.total);
      if (ownRouting.mode === 'reject') {
        return reply.code(422).send({
          error: 'own_engine_unsupported_controls',
          message: 'Our Engine cannot honor every selected control yet. Choose Auto or a provider, or remove the listed controls.',
          unsupportedControls: ownRouting.unsupportedControls,
        });
      }
      // Auto may use the owned engine only when its worker contract can preserve
      // every requested semantic. Otherwise it remains on a provider route.
      const autoOwnRoles = ownRouting.mode === 'auto-candidate'
        && !roleRequest.unsupportedInstruments.length
        ? await ownShelfRoles(workspaceId, genre)
        : null;
      const useOwnEngine = ownRouting.mode === 'own' || !!autoOwnRoles;
      if (useOwnEngine && roleRequest.unsupportedInstruments.length) {
        return reply.code(422).send({
          error: 'unsupported_exact_instruments',
          message: 'Our Engine cannot prove an exact material role for every requested instrument.',
          unsupportedInstruments: roleRequest.unsupportedInstruments,
        });
      }
      if (!useOwnEngine) {
        const route = validateMusicRoute(input.songEngine, await musicRouteCapabilities(workspaceId), input.withVocals);
        if (!route.ok) return reply.code(route.statusCode).send({ error: route.error, message: route.message });
      }
      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'beat-generate');
      const charge = await app.chargeCredits({
        workspaceId,
        key: useOwnEngine ? 'beat_idea_short_30s' : input.withVocals || input.withStems ? 'full_song_demo' : 'beat_idea_short_30s',
        // OUR ENGINE IS FREE FOR NOW (owner, 2026-07-19: "anybody using our engine
        // is free — that's how we get people to come test it"). Own-engine renders
        // cost us ~nothing (pure synth) so they cost the USER nothing either:
        // multiplier 0 = zero credits debited. Set OWN_ENGINE_FREE=0 to re-enable
        // charging. Provider renders bill as before (N candidates = N charges).
        multiplier: useOwnEngine
          ? (process.env.OWN_ENGINE_FREE === '0' ? 1 : 0)
          : Math.max(1, input.candidates ?? 1),
        refTable: 'Project',
        refId: project.id,
        // IDEMPOTENCY (audit FAKE_GREEN: supported but never passed): a retried/
        // double-submitted create with the same Idempotency-Key charges ONCE.
        idempotencyKey,
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
      if (useOwnEngine) {
        const ownBpm = input.bpm ?? genreSignature(genre).bpm;
        const ownJob = await createQueuedProviderJob({
          app,
          queue: app.queues.music,
          jobName: 'own-engine',
          workspaceId,
          projectId: project.id,
          kind: 'music',
          provider: 'afrohit-own',
          inputJson: {
            ownEngine: true,
            genre,
            bpm: ownBpm,
            ...(autoOwnRoles ? { autoOwn: true } : {}),
            ...(roleRequest.provenance.instruments.length
              ? {
                  requestedRoles: roleRequest.requestedRoles,
                  requestedRoleProvenance: roleRequest.provenance,
                }
              : {}),
          },
          charge,
          idempotencyKey,
          payload: (jobId) => ({
            jobId,
            workspaceId,
            projectId: project.id,
            songId: effectiveSongId,
            genre,
            bpm: ownBpm,
            melodyPrompt: genreSignature(genre).melodyPrompt,
            ...(roleRequest.provenance.instruments.length
              ? {
                  requestedRoles: roleRequest.requestedRoles,
                  requestedRoleProvenance: roleRequest.provenance,
                }
              : {}),
          }),
        });
        reply.code(202);
        return {
          jobId: ownJob.jobId, status: 'queued', replayed: ownJob.replayed, engine: 'afrohit-own-v1',
          ...(roleRequest.requestedRoles.length ? { requestedRoles: roleRequest.requestedRoles } : {}),
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
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.music,
        jobName: 'generate-music',
        workspaceId,
        projectId: project.id,
        kind: 'music',
        provider: input.songEngine ?? 'auto',
        inputJson: { ...input, genre, trainingUsage, dnaTags: finalDnaTags, ...(sungForm ? { sungForm } : {}), ...(sectionVoicing?.length ? { sectionVoicing } : {}) },
        charge,
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          projectId: project.id,
          songId: effectiveSongId,
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
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, status: 'queued', replayed: job.replayed };
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
      const uploaded = await verifyUploadedAudio(workspaceId, input.key, input.format);
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
      const requestedSong = input.songId
        ? await prisma.song.findFirstOrThrow({
            where: { id: input.songId, projectId: project.id, workspaceId },
            select: { id: true },
          })
        : null;
      const songId =
        requestedSong?.id ??
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

      const uploadUrl = publicUrlFor(uploaded.key);
      const { beat, job: qcJob } = await registerBeatForInspection({
        app,
        workspaceId,
        projectId: project.id,
        songId,
        url: uploadUrl,
        format: input.format,
        provider: 'upload',
        bpm: input.bpm ?? null,
        keySignature: input.keySignature ?? null,
        claimedDurationS: input.durationS ?? null,
        sourceMeta: {
          uploaded: true,
          source: 'artist_upload',
          title: input.title ?? null,
          instrumental: true,
          rightsBasis: 'user-attested',
          rightsConfirmationVersion: input.rightsConfirmation.version,
        },
      });

      // Auto-harvest the artist's own uploaded beat into reusable role loops.
      await enqueueHarvest(app, {
        workspaceId,
        projectId: project.id,
        beatId: beat.id,
        sourceUrl: beat.url,
        rightsConfirmation: input.rightsConfirmation,
      });
      // AUTO-LEARN too (audit: harvested but never learned): the artist's own
      // beat joins the learned lake as a SoundReference — genre hint = the
      // project's genre, read by the analyze processor. Charged; best-effort.
      await enqueueLearn(app, {
        workspaceId,
        projectId: project.id,
        url: beat.url,
        source: 'beat-upload',
        rightsConfirmation: input.rightsConfirmation,
      });
      reply.code(202);
      return { ...beat, songId, jobId: qcJob.jobId, qualityState: 'pending' };
    }
  );
}

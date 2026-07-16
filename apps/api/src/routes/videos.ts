import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@afrohit/db";
import {
  assumedThreeActSections,
  generateStoryboardInputSchema,
  normalizeStoryboardShots,
  normalizeVideoTreatment,
  perShotRenders,
  planVideoAssembly,
  renderAllVideoInputSchema,
  renderVideoInputSchema,
  storyboardShots,
  treatmentSectionsFromBoundaries,
  videoAssemblyStatus,
  videoRenderAllUsage,
  videoRenderUsage,
  type TreatmentSection,
} from "@afrohit/shared";
import { prompts, generateJson } from "@afrohit/ai";
import { requireAuth } from "../middleware/auth";
import { createQueuedProviderJob, scopedRequestKey } from "../lib/queued-job";
import {
  currentPlayableAsset,
  playableArrangement,
  playableAssetHistory,
} from "../lib/current-playable-asset";

type LikenessRenderPayload = {
  trainedModelRef: string;
  triggerWord: string;
  consentId: string;
  rightsBasis: "user-attested-likeness";
};

/**
 * LIKENESS (own-face keyframe → image-to-video). Only when a TRAINED likeness
 * exists for the project's artist under an UNREVOKED consent — null otherwise
 * so the caller can 409 honestly, never silently render without the face the
 * user asked for. Shared by /renders and /render-all: one law, one query.
 */
async function resolveLikenessPayload(
  workspaceId: string,
  artistId: string
): Promise<LikenessRenderPayload | null> {
  const trained = await prisma.artistLikeness.findFirst({
    where: {
      workspaceId,
      artistId,
      deletedAt: null,
      status: "trained",
      trainedModelRef: { not: null },
      consent: { workspaceId, revokedAt: null },
    },
    orderBy: { createdAt: "desc" },
    select: { trainedModelRef: true, consentId: true, meta: true },
  });
  if (!trained?.trainedModelRef) return null;
  const trainedMeta =
    trained.meta && typeof trained.meta === "object" && !Array.isArray(trained.meta)
      ? (trained.meta as Record<string, unknown>)
      : {};
  return {
    trainedModelRef: trained.trainedModelRef,
    triggerWord:
      typeof trainedMeta.triggerWord === "string" && trainedMeta.triggerWord
        ? trainedMeta.triggerWord
        : "AFROHITFACE",
    consentId: trained.consentId,
    rightsBasis: "user-attested-likeness",
  };
}

export default async function videos(app: FastifyInstance) {
  /**
   * Write the video treatment — cheap text generation, no video render yet.
   * User reviews/approves before any expensive video credit is spent.
   *
   * mode:'full_song' (default) is the CREATIVE-DIRECTOR rebuild (owner verdict
   * 2026-07-16: the old writer produced a 12-second lyric slideshow): one
   * treatment covering the WHOLE song, sequenced 1:1 against the audio's
   * MEASURED section boundaries, opening concept-first (concept / logline /
   * visual world / motifs / color story / casting) and ending with a social
   * teaser cut derived from the same treatment. mode:'short' keeps the legacy
   * 8-60s shot list for backward compatibility.
   */
  app.post(
    "/storyboards",
    { schema: { body: generateStoryboardInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateStoryboardInputSchema.parse(req.body);

      const project = await prisma.project.findFirstOrThrow({
        where: { id: input.projectId, workspaceId },
        include: {
          artist: true,
          briefs: { take: 1, orderBy: { createdAt: "desc" } },
        },
      });

      // THE SONG IS THE SUBJECT. This route read the artist lane and the project
      // brief and stopped — so for a project holding several songs it produced
      // one generic treatment that belonged to none of them, and never once read
      // the words being sung. A video recommendation that hasn't heard the song
      // is a stock brief. Scoped through the project we already authorized, so
      // it cannot reach another workspace's song. The audio models come along so
      // the treatment can read the CURRENT audio's measured structure.
      const song = input.songId
        ? await prisma.song.findFirst({
            where: { id: input.songId, projectId: project.id, workspaceId },
            include: {
              lyric: true,
              masters: { orderBy: { createdAt: "desc" }, take: 20 },
              mixes: { orderBy: { createdAt: "desc" }, take: 20 },
              beats: { orderBy: { createdAt: "desc" }, take: 20 },
            },
          })
        : null;
      if (input.songId && !song) {
        return reply.code(404).send({ error: "song_not_found" });
      }

      // WHO IS SINGING. The director was never told the vocalist, so a
      // woman-sung record could get (and did get — live incident, 2026-07-16,
      // "A.I baddie") a male lead copied from the prompt's example. The voice
      // the user picked at creation travels in the render job's input; recover
      // it here so the PERFORMER LAW has something to enforce. 'auto'/absent
      // stays honest: the model must infer from the lyrics' first-person voice.
      let vocalist: string = "unknown — infer from the lyrics' first-person voice";
      if (song) {
        const renderJobs = await prisma.providerJob.findMany({
          where: { workspaceId, projectId: project.id, kind: "music" },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { inputJson: true },
        });
        for (const job of renderJobs) {
          const inputJson = job.inputJson as { songId?: unknown; voice?: unknown } | null;
          const jobSongId = typeof inputJson?.songId === "string" ? inputJson.songId : null;
          const voice = typeof inputJson?.voice === "string" ? inputJson.voice : null;
          if (jobSongId && jobSongId !== song.id) continue;
          if (voice && voice !== "auto") {
            vocalist = voice; // 'female' | 'male' | 'duet' | 'group'
            break;
          }
        }
      }

      // The song itself: its title, its lane, its tempo and its actual WORDS.
      // The treatment should come from what this record is about — that is the
      // whole difference between a recommendation for THIS song and a generic
      // one for the artist. cleanVersion is preferred so an explicit take
      // doesn't drive the imagery; body is the fallback.
      const songPayload = song
        ? {
            title: song.title,
            genre: project.genre,
            bpm: project.bpm,
            vocalist,
            lyrics: song.lyric?.cleanVersion ?? song.lyric?.body ?? null,
            madeAt: song.createdAt.toISOString(),
          }
        : undefined;

      // ---- mode:'short' — the legacy 8-60s shot list, unchanged behavior ----
      if (input.mode === "short") {
        const shortDurationS = input.durationS ?? 15;
        const result = await generateJson<{
          title: string;
          shots: Array<{
            index: number;
            prompt: string;
            duration_s: number;
            motion?: string;
            lighting?: string;
            subjects?: string[];
            negativePrompt?: string;
          }>;
        }>({
          task: "storyboard",
          system: prompts.STORYBOARD_SYSTEM,
          user: JSON.stringify({
            artist: {
              stageName: project.artist.stageName,
              lane: project.artist.laneSummary,
            },
            brief: project.briefs[0] ?? {},
            song: songPayload,
            totalDurationS: shortDurationS,
            format: input.format,
            extraPrompt: input.prompt,
          }),
          temperature: 0.7,
          maxTokens: 1_500,
        });

        const storyboard = normalizeStoryboardShots(result.shots, shortDurationS);
        if (!storyboard.length) {
          return reply.code(502).send({ error: "invalid_storyboard_output" });
        }
        const concept = await prisma.videoConcept.create({
          data: {
            projectId: project.id,
            songId: song?.id ?? null,
            title: result.title,
            storyboard: storyboard as never,
            durationS: storyboard.reduce((sum, shot) => sum + shot.duration_s, 0),
            format: input.format,
          },
        });
        reply.code(201);
        return { concept };
      }

      // ---- mode:'full_song' — the creative-director treatment ----
      // THE SONG'S MEASURED STRUCTURE IS THE SPINE. The current audio's
      // arrangement (measured section boundaries + duration, inherited across
      // versions by playableArrangement) decides the sequences; the model only
      // fills them with craft. No measurement = an honest 3-act arc over the
      // known length, marked structureSource:'assumed' — never a fake claim.
      let sections: TreatmentSection[] = [];
      let structureSource: "measured" | "assumed" = "assumed";
      let songDurationS: number | null = null;
      if (song) {
        const history = playableAssetHistory(song);
        const current = currentPlayableAsset(song);
        const arrangement = current
          ? playableArrangement(history, current)
          : null;
        if (arrangement) {
          songDurationS = arrangement.durationS;
          if (arrangement.boundaries.length) {
            sections = treatmentSectionsFromBoundaries(
              arrangement.durationS,
              arrangement.boundaries
            );
            structureSource = "measured";
          }
        }
      }
      const targetDurationS = songDurationS ?? input.durationS ?? 180;
      if (!sections.length) {
        sections = assumedThreeActSections(targetDurationS);
        structureSource = "assumed";
      }

      // CLAUDE IS THE BRAIN for creative-director work — generateJson routes
      // Claude-first with the OpenAI/Cerebras failure ladder. A full treatment
      // is long-form: give it token room and a longer timeout. Text only —
      // this never spends a video-render credit.
      const result = await generateJson<Record<string, unknown>>({
        task: "video-treatment",
        system: prompts.VIDEO_TREATMENT_SYSTEM,
        user: JSON.stringify({
          artist: {
            stageName: project.artist.stageName,
            lane: project.artist.laneSummary,
          },
          brief: project.briefs[0] ?? {},
          song: songPayload,
          structure: {
            source: structureSource,
            durationS: targetDurationS,
            sections,
          },
          format: input.format,
          teaser: { allowedDurations: [15, 30], format: "vertical" },
          extraPrompt: input.prompt,
        }),
        temperature: 0.7,
        maxTokens: 6_000,
        timeoutMs: 120_000,
      });

      const treatment = normalizeVideoTreatment(result, {
        durationS: targetDurationS,
        sections,
        structureSource,
      });
      if (!treatment) {
        return reply.code(502).send({ error: "invalid_storyboard_output" });
      }
      const title =
        typeof result.title === "string" && result.title.trim()
          ? result.title.trim().slice(0, 200)
          : treatment.concept.slice(0, 200);
      const concept = await prisma.videoConcept.create({
        data: {
          projectId: project.id,
          // Bound to the song, so the recommendation can be found beside its
          // lyrics instead of floating at project level where a multi-song
          // project makes it ambiguous which record it describes.
          songId: song?.id ?? null,
          title,
          // The richer object lives in the same storyboard Json column; its
          // .shots array is the flat compatibility view every legacy reader
          // (per-shot billing, worker payload, lyric-panel list) extracts via
          // storyboardShots().
          storyboard: treatment as never,
          durationS: treatment.durationS,
          format: input.format,
        },
      });

      reply.code(201);
      return { concept };
    }
  );

  app.post(
    "/renders",
    { schema: { body: renderVideoInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = renderVideoInputSchema.parse(req.body);

      const concept = await prisma.videoConcept.findFirstOrThrow({
        where: { id: input.conceptId, project: { workspaceId } },
        include: { project: { select: { artistId: true } } },
      });
      if (concept.projectId !== input.projectId) {
        return reply.code(409).send({ error: "concept_project_mismatch" });
      }

      // ENGINE CLASS (public/internal wall): users pick a class, never a
      // vendor. Absent = 'standard' — the default tier decision, for routing
      // AND billing (owner-approved per-scene pricing: draft $0.50 /
      // standard $2.00 / flagship $6.00 per scene).
      const engineClass = input.engineClass ?? "standard";

      // LIKENESS (own-face keyframe → image-to-video). Only when explicitly
      // requested, only when a TRAINED likeness exists for THIS project's
      // artist under an UNREVOKED consent — otherwise an honest 409, never a
      // silent render without the face the user asked for.
      let likenessPayload: LikenessRenderPayload | null = null;
      if (input.useLikeness) {
        likenessPayload = await resolveLikenessPayload(
          workspaceId,
          concept.project.artistId
        );
        if (!likenessPayload) {
          return reply.code(409).send({
            error: "no_trained_likeness",
            note: "Train your likeness first (My Likeness) — this render was asked to feature your face and there is no trained, consented likeness to use.",
          });
        }
      }

      // Flat shots from EITHER storage shape — the legacy array or the
      // full-song treatment's compatibility view. Per-shot billing and the
      // worker payload keep the exact same shot element shape either way.
      // CLASS-AWARE BILLING (owner-approved): the class the user picked
      // decides the per-scene price — the same pure law the web modal shows.
      const shots = storyboardShots(concept.storyboard);
      const usage = videoRenderUsage(shots, input.shotIndex, engineClass);
      if (!usage) {
        return reply.code(400).send({ error: "invalid_video_shot_selection" });
      }
      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "video-render"
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: usage.creditKey,
        multiplier: usage.billingUnits,
        planUnits: usage.planUnits,
        refTable: "VideoConcept",
        refId: concept.id,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.video,
        jobName: "render-video",
        workspaceId,
        projectId: concept.projectId,
        kind: "video",
        provider: process.env.VIDEO_PROVIDER ?? "unavailable",
        inputJson: input,
        charge,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          projectId: concept.projectId,
          conceptId: concept.id,
          shotIndex: input.shotIndex,
          shots,
          format: concept.format,
          engineClass,
          ...(likenessPayload ? { likeness: likenessPayload } : {}),
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    }
  );

  // ==========================================================================
  // ONE-CLICK FULL VIDEO — "🎬 Make the full video". ONE upfront charge =
  // per-scene class price × UNRENDERED scenes (already-rendered scenes are
  // excluded by the shared videoRenderAllUsage law — double-billing is
  // impossible by construction, and the web confirm shows the SAME totalCost
  // this route charges). Every unrendered scene is queued as its own
  // render-video job (identical payload shape to /renders), and the concept
  // is stamped meta.autoAssemble so the worker enqueues the Wave-9 assembler
  // the moment every sequence holds a successful render.
  // ==========================================================================
  app.post(
    "/render-all",
    { schema: { body: renderAllVideoInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = renderAllVideoInputSchema.parse(req.body);

      // Workspace scope through the concept's OWN project — no projectId in
      // the body means no projectId/conceptId mismatch class of bug either.
      const concept = await prisma.videoConcept.findFirst({
        where: { id: input.conceptId, project: { workspaceId } },
        include: { project: { select: { artistId: true } } },
      });
      if (!concept) return reply.code(404).send({ error: "concept_not_found" });

      let likenessPayload: LikenessRenderPayload | null = null;
      if (input.useLikeness) {
        likenessPayload = await resolveLikenessPayload(
          workspaceId,
          concept.project.artistId
        );
        if (!likenessPayload) {
          return reply.code(409).send({
            error: "no_trained_likeness",
            note: "Train your likeness first (My Likeness) — this render was asked to feature your face and there is no trained, consented likeness to use.",
          });
        }
      }

      // Which scenes already have a successful render — the SAME pure law
      // (perShotRenders) the assembly gate reads, so "rendered" can never
      // mean two different things on the billing and assembly sides.
      const shots = storyboardShots(concept.storyboard);
      const renders = await prisma.videoRender.findMany({
        where: { conceptId: concept.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, url: true, createdAt: true, meta: true },
      });
      const rendered = perShotRenders(renders);
      const usage = videoRenderAllUsage(shots, rendered.keys(), input.engineClass);
      if (!usage) {
        return reply.code(400).send({ error: "invalid_video_shot_selection" });
      }
      if (!usage.billingUnits) {
        // HONEST 409 — nothing is missing, so nothing is billed or queued.
        return reply.code(409).send({
          error: "nothing_to_render",
          note: "Every scene already has a render — assemble the full video instead; assembly is free.",
          breakdown: {
            shotCount: shots.length,
            renderedShotIndexes: usage.renderedShotIndexes,
            unrenderedShotIndexes: [],
          },
        });
      }

      // ONE upfront charge for the whole batch: costOf(class key) × unrendered
      // scenes. The ledger row anchors to the FIRST queued job so the orphan-
      // charge sweeper can see it is attached to real queued work.
      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "video-render-all"
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: usage.creditKey,
        multiplier: usage.billingUnits,
        planUnits: usage.planUnits,
        refTable: "VideoConcept",
        refId: concept.id,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });

      // Queue every unrendered scene — the exact per-shot payload /renders
      // builds, one job per scene so progress/retries stay per-scene.
      const jobIds: string[] = [];
      for (let i = 0; i < usage.shotIndexes.length; i++) {
        const shotIndex = usage.shotIndexes[i]!;
        const job = await createQueuedProviderJob({
          app,
          queue: app.queues.video,
          jobName: "render-video",
          workspaceId,
          projectId: concept.projectId,
          kind: "video",
          provider: process.env.VIDEO_PROVIDER ?? "unavailable",
          inputJson: {
            conceptId: concept.id,
            projectId: concept.projectId,
            shotIndex,
            engineClass: input.engineClass,
            useLikeness: input.useLikeness ?? false,
            source: "render-all",
          },
          // The batch charge anchors to the first job (chargeLedgerId is
          // unique — one ledger row cannot link to N jobs).
          ...(i === 0 ? { charge } : {}),
          ...(idempotencyKey
            ? { idempotencyKey: `${idempotencyKey}:shot${shotIndex}` }
            : {}),
          payload: jobId => ({
            jobId,
            workspaceId,
            projectId: concept.projectId,
            conceptId: concept.id,
            shotIndex,
            shots,
            format: concept.format,
            engineClass: input.engineClass,
            ...(likenessPayload ? { likeness: likenessPayload } : {}),
          }),
        });
        jobIds.push(job.jobId);
      }

      // Stamp the auto-assemble request — the worker single-fires the Wave-9
      // assembler when every sequence gains a render (video.ts trigger). Last
      // step on purpose: if this write failed, the scenes still render and
      // the user can assemble manually; nothing is stranded.
      const existingMeta =
        concept.meta && typeof concept.meta === "object" && !Array.isArray(concept.meta)
          ? (concept.meta as Record<string, unknown>)
          : {};
      await prisma.videoConcept.update({
        where: { id: concept.id },
        data: {
          meta: {
            ...existingMeta,
            autoAssemble: {
              requested: true,
              kind: "full",
              engineClass: input.engineClass,
              requestedAt: new Date().toISOString(),
              queuedShotIndexes: usage.shotIndexes,
            },
          } as never,
        },
      });

      reply.code(202);
      return {
        jobIds,
        queuedShotIndexes: usage.shotIndexes,
        renderedShotIndexes: usage.renderedShotIndexes,
        creditKey: usage.creditKey,
        billingUnits: usage.billingUnits,
        totalCost: usage.totalCost,
        autoAssemble: { requested: true, kind: "full" },
      };
    }
  );

  // ==========================================================================
  // FULL MUSIC-VIDEO ASSEMBLY (Wave 9) — rendered shots + the song's current
  // master become ONE release file ('full' 1920x1080 for YouTube/TV, 'teaser'
  // 1080x1920 for socials). Local ffmpeg on the worker: NO charge — the shots
  // were billed per-shot when they rendered and the master when it was made;
  // gluing them together spends no provider money, only CPU we already own.
  // ==========================================================================

  /** The song's CURRENT audio for a concept — the same newest-master-first
   *  resolution every playback surface uses (currentPlayableAsset), resolved
   *  HERE because auth/workspace scope and the playable-asset law live
   *  API-side; the worker receives plain URLs and adds no new DB read paths. */
  async function resolveConceptAudio(
    concept: { songId: string | null },
    workspaceId: string
  ): Promise<
    | {
        ok: true;
        sourceId: string;
        sourceType: "beat" | "mix" | "master";
        url: string;
        songId: string;
        songDurationS: number | null;
      }
    | { ok: false; error: "no_song_bound" | "no_song_audio" }
  > {
    if (!concept.songId) return { ok: false, error: "no_song_bound" };
    const song = await prisma.song.findFirst({
      where: { id: concept.songId, workspaceId },
      include: {
        masters: { orderBy: { createdAt: "desc" }, take: 20 },
        mixes: { orderBy: { createdAt: "desc" }, take: 20 },
        beats: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!song) return { ok: false, error: "no_song_bound" };
    const history = playableAssetHistory(song);
    const current = currentPlayableAsset(song);
    if (!current) return { ok: false, error: "no_song_audio" };
    const arrangement = playableArrangement(history, current);
    return {
      ok: true,
      sourceId: current.id,
      sourceType: current.type,
      url: current.url,
      songId: song.id,
      songDurationS: arrangement?.durationS ?? current.durationS ?? null,
    };
  }

  /** Extract the honest assembly record from a VideoRender row, if it is one. */
  function assemblyOf(row: {
    id: string;
    url: string;
    durationS: number | null;
    createdAt: Date;
    meta: unknown;
  }) {
    const meta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};
    const assembly =
      meta.assembly && typeof meta.assembly === "object" && !Array.isArray(meta.assembly)
        ? (meta.assembly as Record<string, unknown>)
        : null;
    if (!assembly) return null;
    const num = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) ? value : null;
    return {
      id: row.id,
      kind: assembly.kind === "teaser" ? ("teaser" as const) : ("full" as const),
      url: row.url,
      durationS: num(assembly.durationS) ?? row.durationS,
      coveredS: num(assembly.coveredS),
      songDurationS: num(assembly.songDurationS),
      shotsUsed: Array.isArray(assembly.shotsUsed)
        ? assembly.shotsUsed.filter((index): index is number => Number.isInteger(index))
        : [],
      audioStartS: num(
        (assembly.audioSource as Record<string, unknown> | undefined)?.startS
      ),
      createdAt: row.createdAt,
    };
  }

  /** Assembly state for the Video modal: per-sequence render coverage (chips),
   *  both gates with honest missing lists, audio availability, and the newest
   *  assembled artifact per kind (signed for playback by the assets plugin). */
  app.get<{ Params: { conceptId: string } }>(
    "/concepts/:conceptId/assembly",
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const concept = await prisma.videoConcept.findFirst({
        where: { id: req.params.conceptId, project: { workspaceId } },
      });
      if (!concept) return reply.code(404).send({ error: "concept_not_found" });
      const renders = await prisma.videoRender.findMany({
        where: { conceptId: concept.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, url: true, durationS: true, createdAt: true, meta: true },
      });
      const audio = await resolveConceptAudio(concept, workspaceId);
      const status = videoAssemblyStatus({
        storyboard: concept.storyboard,
        renders,
        songDurationS: audio.ok ? audio.songDurationS : null,
      });
      const assemblies: {
        full: ReturnType<typeof assemblyOf> | null;
        teaser: ReturnType<typeof assemblyOf> | null;
      } = { full: null, teaser: null };
      for (const row of renders) {
        const assembled = assemblyOf(row);
        if (assembled) assemblies[assembled.kind] = assembled; // asc order → newest wins
      }
      return {
        conceptId: concept.id,
        ...status,
        audio: audio.ok
          ? { ready: true, sourceType: audio.sourceType }
          : {
              ready: false,
              reason:
                audio.error === "no_song_bound"
                  ? "This plan is not bound to a song."
                  : "No song audio yet — make the song first.",
            },
        assemblies,
      };
    }
  );

  const assembleVideoInputSchema = z.object({
    conceptId: z.string().cuid(),
    kind: z.enum(["full", "teaser"]),
  });

  app.post(
    "/assemble",
    { schema: { body: assembleVideoInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = assembleVideoInputSchema.parse(req.body);

      const concept = await prisma.videoConcept.findFirst({
        where: { id: input.conceptId, project: { workspaceId } },
      });
      if (!concept) return reply.code(404).send({ error: "concept_not_found" });

      // The song's CURRENT audio — resolved before the gate so a missing
      // record is its own honest 409, never a queued job that must fail.
      const audio = await resolveConceptAudio(concept, workspaceId);
      if (!audio.ok) return reply.code(409).send({ error: audio.error });

      // HONEST GATING (shared law, pure + unit-tested): 'full' needs every
      // sequence to hold >=1 successfully rendered shot; 'teaser' needs every
      // teaserCut shot rendered. Failure names exactly what is missing.
      const renders = await prisma.videoRender.findMany({
        where: { conceptId: concept.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, url: true, createdAt: true, meta: true },
      });
      const gate = planVideoAssembly({
        kind: input.kind,
        storyboard: concept.storyboard,
        renders,
        songDurationS: audio.songDurationS,
      });
      if (!gate.ok) {
        return reply
          .code(409)
          .send(
            gate.error === "shots_missing"
              ? { error: "shots_missing", missing: gate.missing }
              : { error: gate.error }
          );
      }

      // NO CHARGE — deliberate: this is local CPU assembly on our own worker.
      // No provider is called; the shots were already billed per-shot and the
      // master was billed when it was made. Charging again would bill the
      // user twice for work they already paid for.
      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "video-assemble"
      );
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.video,
        jobName: "assemble-video",
        workspaceId,
        projectId: concept.projectId,
        kind: "video",
        provider: "assembler",
        inputJson: input,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          projectId: concept.projectId,
          conceptId: concept.id,
          kind: gate.plan.kind,
          clips: gate.plan.clips,
          plannedS: gate.plan.plannedS,
          maxDurationS: gate.plan.maxDurationS,
          audio: {
            url: audio.url,
            sourceId: audio.sourceId,
            sourceType: audio.sourceType,
            startS: gate.plan.audioStartS,
            songId: audio.songId,
            songDurationS: audio.songDurationS,
          },
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    }
  );
}

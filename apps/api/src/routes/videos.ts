import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@afrohit/db";
import {
  assumedThreeActSections,
  decorateTreatmentShotsForRender,
  generateStoryboardInputSchema,
  missingDuetLeads,
  normalizeStoryboardShots,
  normalizeVideoTreatment,
  performersFromVoice,
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
import { presignAssetRef } from "../lib/storage";
import {
  createQueuedProviderJob,
  scopedRequestKey,
  type SuccessfulCharge,
} from "../lib/queued-job";
import {
  requeueVideoRecovery,
  salvageableVideoShots,
} from "../lib/video-salvage";
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
      let recoveredVoice: string | null = null;
      let sectionVoicing: Array<{ section: string; voices: string[] }> = [];
      if (song) {
        const renderJobs = await prisma.providerJob.findMany({
          where: { workspaceId, projectId: project.id, kind: "music" },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { inputJson: true },
        });
        // TWO-PASS RECOVERY (duet incident, 2026-07-17): exact-song jobs
        // first; project-level jobs WITHOUT a songId only as a legacy
        // fallback. The old single pass let a no-songId job from a SIBLING
        // record cast this song's video.
        const readJob = (inputJson: unknown) => {
          const row = inputJson as {
            songId?: unknown;
            voice?: unknown;
            sectionVoicing?: unknown;
          } | null;
          return {
            songId: typeof row?.songId === "string" ? row.songId : null,
            voice: typeof row?.voice === "string" ? row.voice : null,
            voicing: Array.isArray(row?.sectionVoicing)
              ? (row!.sectionVoicing as Array<{ section?: unknown; voices?: unknown }>)
                  .map(entry => ({
                    section: typeof entry?.section === "string" ? entry.section : "",
                    voices: Array.isArray(entry?.voices)
                      ? entry.voices.filter((v): v is string => typeof v === "string")
                      : [],
                  }))
                  .filter(entry => entry.section && entry.voices.length)
              : [],
          };
        };
        const jobs = renderJobs.map(job => readJob(job.inputJson));
        for (const pass of [
          jobs.filter(job => job.songId === song.id),
          jobs.filter(job => !job.songId),
        ]) {
          for (const job of pass) {
            if (!recoveredVoice && job.voice && job.voice !== "auto") {
              recoveredVoice = job.voice; // 'female' | 'male' | 'duet' | 'group'
              vocalist = job.voice;
            }
            if (!sectionVoicing.length && job.voicing.length) {
              sectionVoicing = job.voicing;
            }
            if (recoveredVoice && sectionVoicing.length) break;
          }
          if (recoveredVoice) break;
        }
      }
      // PERFORMER ROSTER — the structured cast the treatment brain must
      // serve; the scalar vocalist stays alongside for one release.
      const performers = performersFromVoice(recoveredVoice);

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
            // PERFORMER LAW input: the structured roster the treatment brain
            // must cast — every roster member is a LEAD.
            performers,
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
            ...(input.vision?.trim()
              ? {
                  artistVision: {
                    text: input.vision.trim(),
                    mode: input.visionMode,
                  },
                }
              : {}),
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
      // VOCAL-SYNC input: map the arranger-declared section voicing onto the
      // MEASURED sections by label, in order — who SINGS a passage decides
      // who is ON SCREEN in it. Imperfect mapping degrades honestly (no
      // vocal field, the law simply has less to bind).
      const voicingPool = [...sectionVoicing];
      const sectionsForBrain = sections.map(section => {
        const matchIndex = voicingPool.findIndex(
          entry =>
            entry.section.trim().toLowerCase() ===
            section.label.trim().toLowerCase()
        );
        if (matchIndex < 0) return section;
        const [match] = voicingPool.splice(matchIndex, 1);
        const voices = new Set(match!.voices.map(voice => voice.toLowerCase()));
        const vocal =
          voices.size > 1
            ? "both"
            : voices.has("female")
              ? "female"
              : voices.has("male")
                ? "male"
                : "ensemble";
        return { ...section, vocal };
      });

      const result = await generateJson<Record<string, unknown>>({
        task: "video-treatment",
        // The researched SCENE GRAMMAR rides with the director's laws —
        // named choreography, section shot-language, BPM cut math, variety.
        system: prompts.VIDEO_TREATMENT_SYSTEM + "\n\n" + prompts.SCENE_GRAMMAR,
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
            sections: sectionsForBrain,
          },
          format: input.format,
          teaser: { allowedDurations: [15, 30], format: "vertical" },
          extraPrompt: input.prompt,
          // THE ARTIST'S VISION — their own idea for this video, and how
          // faithfully the director must serve it (strict = translate,
          // enhance = elevate but keep it recognizably theirs).
          ...(input.vision?.trim()
            ? {
                artistVision: {
                  text: input.vision.trim(),
                  mode: input.visionMode,
                },
              }
            : {}),
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
      // DUET GATE (owner incident: "there was a female singer as well, but we
      // never saw her"): a duet plan that forgot a lead is REJECTED here —
      // before it can ever spend a render credit. Code mirrors the prompt law.
      const missingLeads = missingDuetLeads(performers, treatment);
      if (missingLeads.length) {
        return reply.code(502).send({
          error: "invalid_storyboard_output",
          note: `performer law failed — missing lead(s): ${missingLeads.join(", ")}. Regenerate the plan.`,
        });
      }

      // PACKAGE C — THE DIRECTOR'S ROOM. A second brain reviews the plan
      // against a fixed rubric BEFORE render money exists to spend. The
      // ANTI-ASSUMPTION TRIPWIRE: a review that cannot quote the lyrics it
      // grounded in (or says "I assume") is discarded. One MINIMAL repair
      // round max; the repair changes ONLY what the critic named and must
      // re-pass the same normalize + duet gates. Best-effort by law: critic
      // trouble never blocks the artist — the original plan stands.
      let finalTreatment = treatment;
      let finalResult: Record<string, unknown> = result;
      let criticReport: Record<string, unknown> | null = null;
      try {
        const lyricsText = songPayload?.lyrics ?? "";
        if (lyricsText) {
          const review = await generateJson<{
            lyricsRead?: string;
            scores?: Record<string, number>;
            verdict?: string;
            fixes?: string[];
          }>({
            task: "video-treatment-critic",
            system: prompts.TREATMENT_CRITIC_SYSTEM,
            user: JSON.stringify({
              lyrics: lyricsText,
              performers,
              treatment: finalResult,
            }),
            temperature: 0.2,
            maxTokens: 1_200,
            timeoutMs: 60_000,
          });
          const quoted = (review.lyricsRead ?? "").trim();
          const grounded =
            quoted.length > 10 &&
            !/i assume/i.test(quoted) &&
            quoted
              .split(/\n|\|/)
              .some(line => line.trim() && lyricsText.includes(line.trim().slice(0, 24)));
          if (grounded) {
            criticReport = {
              lyricsRead: quoted.slice(0, 500),
              scores: review.scores ?? {},
              verdict: review.verdict === "revise" ? "revise" : "pass",
              fixes: (review.fixes ?? []).slice(0, 8),
            };
            if (
              criticReport.verdict === "revise" &&
              (criticReport.fixes as string[]).length
            ) {
              const repaired = await generateJson<Record<string, unknown>>({
                task: "video-treatment-repair",
                system: prompts.TREATMENT_REPAIR_SYSTEM,
                user: JSON.stringify({
                  original: finalResult,
                  fixes: criticReport.fixes,
                }),
                temperature: 0.3,
                maxTokens: 6_000,
                timeoutMs: 120_000,
              });
              const repairedTreatment = normalizeVideoTreatment(repaired, {
                durationS: targetDurationS,
                sections,
                structureSource,
              });
              if (
                repairedTreatment &&
                !missingDuetLeads(performers, repairedTreatment).length
              ) {
                finalTreatment = repairedTreatment;
                finalResult = repaired;
                criticReport.repaired = true;
              } else {
                criticReport.repairFailed = true; // honest: original stands
              }
            }
          }
        }
      } catch (criticError) {
        req.log.warn(
          { err: criticError },
          "treatment critic skipped — the original plan stands"
        );
      }
      const title =
        typeof finalResult.title === "string" && (finalResult.title as string).trim()
          ? (finalResult.title as string).trim().slice(0, 200)
          : finalTreatment.concept.slice(0, 200);
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
          storyboard: finalTreatment as never,
          durationS: finalTreatment.durationS,
          format: input.format,
          // PACKAGE B: the roster rides the concept so the render worker can
          // build one character sheet per lead ("same faces all video").
          // PACKAGE C: the critic's grounded verdict rides beside it.
          meta: { performers, ...(criticReport ? { criticReport } : {}) } as never,
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
      const shots = decorateTreatmentShotsForRender(
        concept.storyboard,
        storyboardShots(concept.storyboard)
      );
      const usage = videoRenderUsage(shots, input.shotIndex, engineClass);
      if (!usage) {
        return reply.code(400).send({ error: "invalid_video_shot_selection" });
      }

      // POST-RENDER SALVAGE: if this scene's last attempt failed AFTER the
      // engine finished (a paid prediction survives in the failed job's
      // progress), recover THAT render — no new charge, no new engine spend.
      // "You never pay twice for work that already ran."
      if (input.shotIndex != null) {
        const salvage = await salvageableVideoShots(workspaceId, concept.id);
        const claim = salvage.get(input.shotIndex);
        if (claim) {
          await requeueVideoRecovery(app, {
            job: claim,
            workspaceId,
            projectId: concept.projectId,
            conceptId: concept.id,
            shots,
            format: concept.format,
          });
          reply.code(202);
          return {
            jobId: claim.jobId,
            replayed: false,
            recovered: true,
            note: "This scene already has a finished, paid render at the engine — recovering it instead of billing a new one.",
          };
        }
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
      const shots = decorateTreatmentShotsForRender(
        concept.storyboard,
        storyboardShots(concept.storyboard)
      );
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

      // POST-RENDER SALVAGE: scenes whose last attempt failed AFTER the
      // engine finished still hold paid predictions — those are recovered
      // for free, and ONLY the scenes with nothing to salvage are billed.
      // The billed number comes from the SAME shared law, fed with salvaged
      // scenes treated as already-rendered, so it can never drift from the
      // per-scene price the modal shows.
      const salvage = await salvageableVideoShots(workspaceId, concept.id);
      const salvagedShotIndexes = usage.shotIndexes.filter(index =>
        salvage.has(index)
      );
      const billUsage = videoRenderAllUsage(
        shots,
        [...usage.renderedShotIndexes, ...salvagedShotIndexes],
        input.engineClass
      );
      if (!billUsage) {
        return reply.code(400).send({ error: "invalid_video_shot_selection" });
      }

      // ONE upfront charge for the whole batch: costOf(class key) × scenes
      // that actually need fresh renders. The ledger row anchors to the
      // FIRST queued job so the orphan-charge sweeper can see it is attached
      // to real queued work. All-salvage batches charge NOTHING.
      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "video-render-all"
      );
      let charge: SuccessfulCharge | null = null;
      if (billUsage.billingUnits > 0) {
        const attempt = await app.chargeCredits({
          workspaceId,
          key: billUsage.creditKey,
          multiplier: billUsage.billingUnits,
          planUnits: billUsage.planUnits,
          refTable: "VideoConcept",
          refId: concept.id,
          idempotencyKey,
        });
        if (!attempt.ok)
          return reply
            .code(402)
            .send({ error: "insufficient_credits", ...attempt });
        charge = attempt;
      }

      // Requeue the salvage claims FIRST — engine delivery links expire by
      // the minute, and these downloads cost nothing.
      const recoveredJobIds: string[] = [];
      const requeuedClaims = new Set<string>();
      for (const index of salvagedShotIndexes) {
        const claim = salvage.get(index)!;
        if (requeuedClaims.has(claim.jobId)) continue;
        requeuedClaims.add(claim.jobId);
        await requeueVideoRecovery(app, {
          job: claim,
          workspaceId,
          projectId: concept.projectId,
          conceptId: concept.id,
          shots,
          format: concept.format,
        });
        recoveredJobIds.push(claim.jobId);
      }

      // Queue every scene that needs a FRESH render — the exact per-shot
      // payload /renders builds, one job per scene so progress/retries stay
      // per-scene.
      const jobIds: string[] = [...recoveredJobIds];
      for (let i = 0; i < billUsage.shotIndexes.length; i++) {
        const shotIndex = billUsage.shotIndexes[i]!;
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
          ...(i === 0 && charge ? { charge } : {}),
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
        // Paid-but-undelivered scenes pulled back in for FREE this batch.
        recoveredShotIndexes: salvagedShotIndexes,
        creditKey: billUsage.creditKey,
        billingUnits: billUsage.billingUnits,
        totalCost: billUsage.totalCost,
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
      // PLAYABLE BY CONTRACT: a private-storage ref can never reach a <video>
      // tag — the finished cut the modal (and the song card) plays must be a
      // time-limited streaming URL, exactly like catalog audio. And NAMED
      // DOWNLOADS ("name the video" — owner): the saved file carries the
      // record's real name, never a storage hash.
      const creditSong = concept.songId
        ? await prisma.song.findFirst({
            where: { id: concept.songId },
            select: {
              title: true,
              lyric: { select: { title: true } },
              project: { select: { artist: { select: { stageName: true } } } },
            },
          })
        : null;
      const displayBase = creditSong
        ? `${creditSong.project.artist.stageName?.trim() || "AfroHit Artist"} - ${(creditSong.lyric?.title || creditSong.title || "Untitled").trim()}`
        : "AfroHit Video";
      for (const kind of ["full", "teaser"] as const) {
        const artifact = assemblies[kind];
        if (!artifact) continue;
        const displayName = `${displayBase} (${kind === "full" ? "Official Video" : "Teaser"})`;
        const storedRef = artifact.url;
        artifact.url = await presignAssetRef(storedRef, 3600);
        (artifact as Record<string, unknown>).displayName = displayName;
        (artifact as Record<string, unknown>).downloadUrl = await presignAssetRef(
          storedRef,
          3600,
          `${displayName}.mp4`
        );
      }

      // LIVE METER ("it doesn't show anything was working" — owner): scenes
      // rendering RIGHT NOW, carrying the worker's persisted heartbeat —
      // status, step, poll count, and the engine-reported percent when its
      // logs printed one. Never a fabricated number: no percent → the UI
      // shows honest indeterminate motion + elapsed time.
      const asRecord = (v: unknown): Record<string, unknown> | null =>
        v != null && typeof v === "object" && !Array.isArray(v)
          ? (v as Record<string, unknown>)
          : null;
      const inFlightJobs = await prisma.providerJob.findMany({
        where: {
          workspaceId,
          kind: "video",
          status: { in: ["QUEUED", "RUNNING"] },
          NOT: { provider: "assembler" },
          inputJson: { path: ["conceptId"], equals: concept.id },
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          startedAt: true,
          inputJson: true,
          outputJson: true,
        },
      });
      const inFlight = inFlightJobs.flatMap(job => {
        const input = asRecord(job.inputJson);
        const rowsJson = asRecord(job.outputJson)?.videoProgress;
        const progressRows = Array.isArray(rowsJson)
          ? rowsJson
              .map(asRecord)
              .filter((r): r is Record<string, unknown> => r !== null)
          : [];
        const jobShot =
          typeof input?.shotIndex === "number" && Number.isInteger(input.shotIndex)
            ? input.shotIndex
            : null;
        const base = {
          jobId: job.id,
          status: job.status,
          startedAt: (job.startedAt ?? job.createdAt).toISOString(),
          recoverOnly: input?.recoverOnly === true,
        };
        const entryFor = (shotIndex: number | null) => {
          const entry = progressRows.find(r => r.shotIndex === shotIndex);
          return {
            ...base,
            shotIndex,
            step: typeof entry?.step === "string" ? entry.step : null,
            progressPct:
              typeof entry?.progressPct === "number" ? entry.progressPct : null,
            pollAttempts:
              typeof entry?.pollAttempts === "number" ? entry.pollAttempts : null,
          };
        };
        if (jobShot != null) return [entryFor(jobShot)];
        const shotsInProgress = progressRows
          .map(r => r.shotIndex)
          .filter((v): v is number => Number.isInteger(v));
        return shotsInProgress.length
          ? shotsInProgress.map(entryFor)
          : [entryFor(null)];
      });

      return {
        inFlight,
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

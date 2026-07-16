import type { FastifyInstance } from "fastify";
import { prisma } from "@afrohit/db";
import {
  generateStoryboardInputSchema,
  normalizeStoryboardShots,
  renderVideoInputSchema,
  videoRenderUsage,
} from "@afrohit/shared";
import { prompts, responsesJson } from "@afrohit/ai";
import { requireAuth } from "../middleware/auth";
import { createQueuedProviderJob, scopedRequestKey } from "../lib/queued-job";

export default async function videos(app: FastifyInstance) {
  /**
   * Build a storyboard — cheap text generation, no video render yet.
   * User reviews/approves before any expensive video credit is spent.
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
      // it cannot reach another workspace's song.
      const song = input.songId
        ? await prisma.song.findFirst({
            where: { id: input.songId, projectId: project.id, workspaceId },
            include: { lyric: true },
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

      const result = await responsesJson<{
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
        system: prompts.STORYBOARD_SYSTEM,
        user: JSON.stringify({
          artist: {
            stageName: project.artist.stageName,
            lane: project.artist.laneSummary,
          },
          brief: project.briefs[0] ?? {},
          // The song itself: its title, its lane, its tempo and its actual
          // WORDS. The treatment should come from what this record is about —
          // that is the whole difference between a recommendation for THIS song
          // and a generic one for the artist. cleanVersion is preferred so an
          // explicit take doesn't drive the imagery; body is the fallback.
          song: song
            ? {
                title: song.title,
                genre: project.genre,
                bpm: project.bpm,
                vocalist,
                lyrics: song.lyric?.cleanVersion ?? song.lyric?.body ?? null,
                madeAt: song.createdAt.toISOString(),
              }
            : undefined,
          totalDurationS: input.durationS,
          format: input.format,
          extraPrompt: input.prompt,
        }),
        temperature: 0.7,
        maxOutputTokens: 1_500,
      });

      const storyboard = normalizeStoryboardShots(
        result.shots,
        input.durationS
      );
      if (!storyboard.length) {
        return reply.code(502).send({ error: "invalid_storyboard_output" });
      }
      const concept = await prisma.videoConcept.create({
        data: {
          projectId: project.id,
          // Bound to the song, so the recommendation can be found beside its
          // lyrics instead of floating at project level where a multi-song
          // project makes it ambiguous which record it describes.
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
  );

  app.post(
    "/renders",
    { schema: { body: renderVideoInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = renderVideoInputSchema.parse(req.body);

      const concept = await prisma.videoConcept.findFirstOrThrow({
        where: { id: input.conceptId, project: { workspaceId } },
      });
      if (concept.projectId !== input.projectId) {
        return reply.code(409).send({ error: "concept_project_mismatch" });
      }

      const shots =
        (concept.storyboard as Array<{ duration_s?: number }>) ?? [];
      const usage = videoRenderUsage(shots, input.shotIndex);
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
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    }
  );
}

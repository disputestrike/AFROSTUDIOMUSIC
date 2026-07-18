import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@afrohit/db";
import {
  generateHooksInputSchema,
  langSchema,
  pickLawfulTitle,
} from "@afrohit/shared";
import {
  prompts,
  generateJson,
  directorRefineHooks,
  researchTrends,
  anthropicEnabled,
} from "@afrohit/ai";
import { laneDnaBrief } from "../lib/lane-pipeline";
import { requireAuth } from "../middleware/auth";
import { memoryContext, recordFeedback } from "../services/artist-memory";
import {
  learnedReferenceBrief,
  learnedLyricCraftBrief,
  snapshotTrend,
  freshnessBrief,
} from "../lib/learned";
import { lexiconPalette } from "../lib/lexicon";
import { fuseSoundDna } from "../lib/fuse";
import { presongIntelligence } from "../lib/presong";
import { scopedRequestKey } from "../lib/queued-job";
import {
  operationErrorBody,
  runIdempotentOperation,
} from "../lib/idempotent-operation";

export default async function hooks(app: FastifyInstance) {
  app.get<{ Params: { projectId: string } }>("/", async req => {
    const { workspaceId } = requireAuth(req);
    await prisma.project.findFirstOrThrow({
      where: { id: req.params.projectId, workspaceId },
    });
    return prisma.hookCandidate.findMany({
      where: { projectId: req.params.projectId },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    });
  });

  app.post<{ Params: { projectId: string } }>(
    "/generate",
    { schema: { body: generateHooksInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateHooksInputSchema
        .omit({ projectId: true })
        .parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
        include: {
          artist: true,
          briefs: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });

      const multiplier = Math.max(1, Math.ceil(input.count / 20));
      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        `hooks-generate:${project.id}`
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: "hooks_batch_20",
        multiplier,
        refTable: "Project",
        refId: project.id,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });

      const operation = await runIdempotentOperation({
        workspaceId,
        projectId: project.id,
        kind: "hooks-generate",
        provider: "text",
        idempotencyKey,
        chargeLedgerId: charge.chargeId,
        inputJson: { projectId: project.id, input },
        execute: async () => {
          try {
            const brief = input.brief ?? project.briefs[0] ?? undefined;
            const mood = (brief as { mood?: string } | undefined)?.mood;
            // SPEED (audit 2026-07-17): these lookups have NO data dependency
            // on each other — they used to run one-after-another (~25s of
            // serial round-trips before the writer even started). Fire them
            // ALL at once; latency drops to the slowest single call.
            const [
              tasteMemory,
              trendData,
              presong,
              freshness,
              palette,
              learnedRef,
              learnedCraft,
            ] = await Promise.all([
              // Taste feedback loop — recent approvals/rejections steer generation.
              memoryContext({
                workspaceId,
                artistId: project.artistId,
                query: JSON.stringify({
                  genre: project.genre,
                  languages: project.artist.languages,
                  brief,
                }),
              }),
              // Live trends so hooks reflect what's popping right now.
              researchTrends({ genre: project.genre }).catch(() => null),
              // Pre-song recall: measured lessons from THIS lane's winners/losers.
              presongIntelligence(workspaceId, project.genre, mood),
              freshnessBrief(workspaceId),
              lexiconPalette({
                workspaceId,
                languages: project.artist.languages,
                mood,
                rotate: input.count,
              }),
              learnedReferenceBrief(workspaceId, project.genre),
              learnedLyricCraftBrief(workspaceId, project.genre),
            ]);
            const trends = trendData?.digest;
            // The digest is shelved in the data lake (one snapshot/genre/day)
            // so it compounds — fire-and-forget, never blocks the writer.
            void snapshotTrend(workspaceId, project.genre, trendData).catch(
              () => {}
            );
            const soundDna = fuseSoundDna({
              extra: presong,
              freshness,
              palette,
              dna: laneDnaBrief(project.genre),
              learnedRef,
              learnedCraft,
              hitCraft: prompts.hitCraftBrief("hook", mood),
            });

            // FAST + RELIABLE: OpenAI writes the hooks (~15s, never rate-limited for
            // us, and the word-palette in soundDna gives it the vocab), then Claude
            // scores them in a LEAN A&R pass (~10s). Two heavy Claude calls were the
            // 67-104s stall; this is ~25s and the A&R score is reliable.
            type DraftHook = {
              text: string;
              language?: string[];
              syllablePattern?: string;
              melodyNotes?: string;
              callResponse?: boolean;
            };
            // BULK tier (owner's cost law): hook DRAFTS are heavy lifting — Cerebras
            // first, laddering up on any failure. The A&R refine below stays Claude
            // (directorRefineHooks) — that's the specific brain.
            const result = await generateJson<{ hooks?: DraftHook[] }>({
              tier: "bulk",
              task: "hooks-draft",
              system: prompts.HOOK_SYSTEM,
              user: prompts.hookUserPrompt({
                artist: project.artist as never,
                brief: brief as never,
                count: input.count,
                tasteMemory,
                trends,
                soundDna,
              }),
              temperature: 0.95,
              maxTokens: 3_500,
            });
            const refined = await directorRefineHooks({
              artist: project.artist as never,
              brief: brief as never,
              drafts: (result.hooks ?? []).map(h => h.text),
              tasteMemory,
              trends,
              soundDna,
            });

            const langFilter = (arr: string[]) =>
              arr.filter((c): c is z.infer<typeof langSchema> =>
                [
                  "yo",
                  "ig",
                  "ha",
                  "pcm",
                  "en",
                  "fr",
                  "pt",
                  "sw",
                  "zu",
                  "xh",
                  "twi",
                ].includes(c)
              );

            const rows =
              refined && refined.length
                ? refined.map(h => ({
                    text: h.text,
                    language: langFilter(h.language ?? []),
                    score: typeof h.score === "number" ? h.score : null,
                    meta: {
                      reason: h.reason,
                      needsNativeReview: h.needsNativeReview,
                      director: "claude",
                      viralScore: h.viralScore,
                      dimensions: h.dimensions,
                      tiktokMoment: h.tiktokMoment,
                    },
                  }))
                : (result.hooks ?? []).map(h => ({
                    text: h.text,
                    language: langFilter(h.language ?? []),
                    score: null as number | null,
                    meta: {
                      syllablePattern: h.syllablePattern,
                      melodyNotes: h.melodyNotes,
                      callResponse: h.callResponse,
                      director: "none",
                    },
                  }));

            if (!rows.length) {
              await app.refundCredits({
                workspaceId,
                key: "hooks_batch_20",
                multiplier,
                refTable: "Project",
                refId: project.id,
                chargeId: charge.chargeId,
              });
              return {
                statusCode: 503,
                body: {
                  error: "hooks_generation_empty",
                  message: "The writer returned no usable hooks. Try again.",
                },
              };
            }

            const created = await prisma.$transaction(
              rows.map(r =>
                prisma.hookCandidate.create({
                  data: {
                    projectId: project.id,
                    text: r.text,
                    language: r.language,
                    score: r.score,
                    meta: r.meta as never,
                  },
                })
              )
            );
            // Best-first when the A&R director scored them.
            created.sort(
              (a: { score: number | null }, b: { score: number | null }) =>
                (b.score ?? 0) - (a.score ?? 0)
            );

            return {
              statusCode: 201,
              body: {
                hooks: created,
                charged: charge.balance,
                director: refined ? "claude" : "none",
                // Diagnostics: does the API actually see the keys?
                anthropicKeyOnApi: anthropicEnabled(),
                trendsPulled: !!trends,
              },
            };
          } catch (error) {
            await app.refundCredits({
              workspaceId,
              key: "hooks_batch_20",
              multiplier,
              refTable: "Project",
              refId: project.id,
              chargeId: charge.chargeId,
            });
            throw error;
          }
        },
      });
      if (operation.state !== "completed") {
        const failure = operationErrorBody(operation);
        return reply.code(failure.statusCode).send(failure.body);
      }
      return reply.code(operation.value.statusCode).send(operation.value.body);
    }
  );

  app.post<{ Params: { projectId: string; hookId: string } }>(
    "/:hookId/approve",
    async req => {
      const { workspaceId } = requireAuth(req);
      const hook = await prisma.hookCandidate.findFirstOrThrow({
        where: {
          id: req.params.hookId,
          projectId: req.params.projectId,
          project: { workspaceId },
        },
        include: { project: { select: { artistId: true } } },
      });
      // Idempotent: re-approving an already-approved hook returns its song instead
      // of spawning a duplicate (matters now that the UI has a direct Approve button).
      if (hook.approved && hook.songId) {
        return { hookId: hook.id, songId: hook.songId, alreadyApproved: true };
      }
      const approved = await prisma.$transaction(async tx => {
        const claimed = await tx.hookCandidate.updateMany({
          where: {
            id: hook.id,
            projectId: hook.projectId,
            approved: false,
            songId: null,
          },
          data: { approved: true },
        });
        if (claimed.count === 0) {
          const existing = await tx.hookCandidate.findUnique({
            where: { id: hook.id },
            select: { songId: true },
          });
          if (existing?.songId)
            return { songId: existing.songId, alreadyApproved: true };
          throw new Error("hook approval is already in progress");
        }
        const song = await tx.song.create({
          data: {
            workspaceId,
            projectId: hook.projectId,
            // TITLE LAW: gate the hook's first line; on failure derive a 1-3 word
            // title from the hook's content words.
            title: pickLawfulTitle([hook.text.split("\n")[0]!], hook.text),
            status: "SKETCH",
          },
        });
        await tx.hookCandidate.update({
          where: { id: hook.id },
          data: { songId: song.id },
        });
        return { songId: song.id, alreadyApproved: false };
      });
      // Feed the taste loop — future generations converge on this.
      await recordFeedback({
        workspaceId,
        artistId: hook.project.artistId,
        kind: "approved",
        content: hook.text,
        sourceKind: "hook",
        sourceId: hook.id,
      });
      return {
        hookId: hook.id,
        songId: approved.songId,
        ...(approved.alreadyApproved ? { alreadyApproved: true } : {}),
      };
    }
  );

  app.post<{ Params: { projectId: string; hookId: string } }>(
    "/:hookId/reject",
    async req => {
      const { workspaceId } = requireAuth(req);
      const hook = await prisma.hookCandidate.findFirstOrThrow({
        where: {
          id: req.params.hookId,
          projectId: req.params.projectId,
          project: { workspaceId },
        },
        include: { project: { select: { artistId: true } } },
      });
      await prisma.hookCandidate.update({
        where: { id: hook.id },
        data: { approved: false, score: 0 },
      });
      await recordFeedback({
        workspaceId,
        artistId: hook.project.artistId,
        kind: "rejected",
        content: hook.text,
        sourceKind: "hook",
        sourceId: hook.id,
      });
      return { hookId: hook.id, rejected: true };
    }
  );

  // Edit a hook's wording before (or after) approving it — surgical control.
  const hookEditSchema = z.object({
    text: z
      .string()
      .trim()
      .min(1, "Hook text cannot be empty.")
      .max(500, "Keep the hook under 500 characters."),
  });
  app.patch<{ Params: { projectId: string; hookId: string } }>(
    "/:hookId",
    { schema: { body: hookEditSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { text } = hookEditSchema.parse(req.body);
      const hook = await prisma.hookCandidate.findFirst({
        where: {
          id: req.params.hookId,
          projectId: req.params.projectId,
          project: { workspaceId },
        },
      });
      if (!hook) return reply.code(404).send({ error: "hook_not_found" });
      const updated = await prisma.hookCandidate.update({
        where: { id: hook.id },
        data: {
          text,
          meta: {
            ...((hook.meta as Record<string, unknown>) ?? {}),
            edited: true,
          } as never,
        },
      });
      // If this hook is bound to a song whose title still mirrors the OLD hook,
      // keep the title in sync. Read-compare-update (no heuristic updateMany).
      if (hook.songId) {
        // Both derivations run through the TITLE LAW gate — the comparison must
        // match what approve actually stored.
        const oldTitle = pickLawfulTitle(
          [hook.text.split("\n")[0]!],
          hook.text
        );
        const song = await prisma.song.findFirst({
          where: { id: hook.songId, workspaceId },
          select: { id: true, title: true },
        });
        if (song && song.title === oldTitle) {
          await prisma.song
            .update({
              where: { id: song.id },
              data: { title: pickLawfulTitle([text.split("\n")[0]!], text) },
            })
            .catch(() => {});
        }
      }
      return { hookId: updated.id, text: updated.text };
    }
  );
}

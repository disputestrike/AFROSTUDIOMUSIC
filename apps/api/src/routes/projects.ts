import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@afrohit/db";
import { genreSchema } from "@afrohit/shared";
import { requireAuth, requireRole } from "../middleware/auth";
import { queueAssetDeletion, uniqueAssetRefs } from "../lib/asset-lifecycle";

const createProjectSchema = z.object({
  artistId: z.string().cuid().optional(), // resolved to the default artist if omitted
  title: z.string().min(1).max(160),
  genre: genreSchema,
  bpm: z.number().int().min(40).max(220).optional(),
  keySignature: z.string().optional(),
});

export default async function projects(app: FastifyInstance) {
  app.get("/", async req => {
    const { workspaceId } = requireAuth(req);
    return prisma.project.findMany({
      where: { workspaceId },
      include: {
        artist: { select: { id: true, stageName: true } },
        _count: { select: { songs: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  });

  app.post(
    "/",
    { schema: { body: createProjectSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { artistId: providedArtistId, ...data } = createProjectSchema.parse(
        req.body
      );

      // Resolve the artist (default to the first, create one if none) so the
      // Create panel can start a project without the user managing artists.
      let artistId = providedArtistId;
      if (artistId) {
        const ownedArtist = await prisma.artist.findFirst({
          where: { id: artistId, workspaceId },
          select: { id: true },
        });
        if (!ownedArtist)
          return reply.code(404).send({ error: "artist_not_found" });
        artistId = ownedArtist.id;
      } else {
        const artist =
          (await prisma.artist.findFirst({
            where: { workspaceId },
            orderBy: { createdAt: "asc" },
          })) ??
          (await prisma.artist.create({
            data: {
              workspaceId,
              name: "My Artist",
              stageName: "My Artist",
              vocalTone: ["smooth"],
              languages: ["pcm", "yo", "en"],
              laneSummary:
                "Edit your Artist DNA in Settings for sharper results.",
            },
          }));
        artistId = artist.id;
      }

      const project = await prisma.project.create({
        data: { workspaceId, artistId, ...data },
      });
      reply.code(201);
      return project;
    }
  );

  app.get<{ Params: { id: string } }>("/:id", async req => {
    const { workspaceId } = requireAuth(req);
    return prisma.project.findFirstOrThrow({
      where: { id: req.params.id, workspaceId },
      include: {
        artist: true,
        briefs: { orderBy: { createdAt: "desc" }, take: 1 },
        hooks: { orderBy: { score: "desc" }, take: 25 },
        lyrics: { orderBy: { createdAt: "desc" }, take: 5 },
        songs: { orderBy: { createdAt: "desc" } },
        beats: { take: 5, orderBy: { createdAt: "desc" } },
        vocalRenders: {
          where: {
            assetKind: "isolated_vocal",
            qualityState: "passed",
            approved: true,
          },
          take: 5,
          orderBy: { createdAt: "desc" },
        },
        mixes: { take: 5, orderBy: { createdAt: "desc" } },
        masters: { take: 5, orderBy: { createdAt: "desc" } },
        imageAssets: { take: 10, orderBy: { createdAt: "desc" } },
        videoConcepts: { take: 5, orderBy: { createdAt: "desc" } },
        approvals: { take: 50, orderBy: { createdAt: "desc" } },
      },
    });
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { schema: { body: createProjectSchema.partial() } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const data = createProjectSchema.partial().parse(req.body);
      if (data.artistId) {
        const ownedArtist = await prisma.artist.findFirst({
          where: { id: data.artistId, workspaceId },
          select: { id: true },
        });
        if (!ownedArtist)
          return reply.code(404).send({ error: "artist_not_found" });
      }
      return prisma.project.update({
        where: { id: req.params.id, workspaceId },
        data,
      });
    }
  );

  const approveSchema = z.object({
    gate: z.enum([
      "brief",
      "hook",
      "lyrics",
      "beat",
      "voice",
      "mix",
      "rights",
      "release",
    ]),
    decision: z.enum(["approved", "rejected", "changes_requested"]),
    notes: z.string().max(2000).optional(),
  });
  app.post<{ Params: { id: string } }>(
    "/:id/approve",
    { schema: { body: approveSchema } },
    async (req, reply) => {
      const { userId, workspaceId } = requireAuth(req);
      const { gate, decision, notes } = approveSchema.parse(req.body);
      // Scope: only approve gates on a project in this workspace.
      const project = await prisma.project.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { id: true },
      });
      if (!project) return reply.code(404).send({ error: "project_not_found" });
      return prisma.approval.create({
        data: {
          workspaceId,
          projectId: project.id,
          userId,
          gate,
          decision,
          notes,
        },
      });
    }
  );

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const { workspaceId } = requireRole(req, ["OWNER", "ADMIN"]);
    type ProjectAssetGraph = {
      id: string;
      songs: Array<{
        instrumentalUrl: string | null;
        acapellaUrl: string | null;
      }>;
      beats: Array<{ url: string; stems: Array<{ url: string }> }>;
      vocalRenders: Array<{ url: string }>;
      mixes: Array<{ url: string }>;
      masters: Array<{ url: string }>;
      imageAssets: Array<{ url: string }>;
      videoRenders: Array<{ url: string }>;
      exports: Array<{ bundle: unknown }>;
    };
    const project: ProjectAssetGraph | null = await prisma.project.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        songs: { select: { instrumentalUrl: true, acapellaUrl: true } },
        beats: { select: { url: true, stems: { select: { url: true } } } },
        vocalRenders: { select: { url: true } },
        mixes: { select: { url: true } },
        masters: { select: { url: true } },
        imageAssets: { select: { url: true } },
        videoRenders: { select: { url: true } },
        exports: { select: { bundle: true } },
      },
    });
    if (project) {
      const refs = uniqueAssetRefs([
        ...project.songs.flatMap(song => [
          song.instrumentalUrl,
          song.acapellaUrl,
        ]),
        ...project.beats.flatMap(beat => [
          beat.url,
          ...beat.stems.map(stem => stem.url),
        ]),
        ...project.vocalRenders.map(asset => asset.url),
        ...project.mixes.map(asset => asset.url),
        ...project.masters.map(asset => asset.url),
        ...project.imageAssets.map(asset => asset.url),
        ...project.videoRenders.map(asset => asset.url),
        ...project.exports.map(asset => asset.bundle),
      ]);
      await prisma.$transaction(async tx => {
        await queueAssetDeletion(tx, {
          workspaceId,
          refs,
          reason: `project:${project.id}`,
        });
        await tx.project.delete({ where: { id: project.id } });
      });
      void app
        .dispatchPendingJobs()
        .catch(error =>
          req.log.error({ err: error }, "asset cleanup dispatch failed")
        );
    }
    reply.code(204);
    return null;
  });
}

import type { FastifyInstance } from "fastify";
import { prisma } from "@afrohit/db";
import { artistDnaSchema } from "@afrohit/shared";
import { requireAuth } from "../middleware/auth";

function publicArtist<T extends { autoPilot?: unknown }>(
  artist: T
): Omit<T, "autoPilot"> {
  const copy = { ...artist };
  delete copy.autoPilot;
  return copy;
}

export default async function artists(app: FastifyInstance) {
  app.get("/", async req => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.artist.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(publicArtist);
  });

  app.post("/", { schema: { body: artistDnaSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const data = artistDnaSchema.parse(req.body);
    const artist = await prisma.artist.create({
      data: {
        workspaceId,
        ...data,
        references: data.references ?? [],
        slang: data.slang ?? [],
      },
    });
    reply.code(201);
    return publicArtist(artist);
  });

  app.get<{ Params: { id: string } }>("/:id", async req => {
    const { workspaceId } = requireAuth(req);
    const artist = await prisma.artist.findFirstOrThrow({
      where: { id: req.params.id, workspaceId },
    });
    return publicArtist(artist);
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { schema: { body: artistDnaSchema.partial() } },
    async req => {
      const { workspaceId } = requireAuth(req);
      const data = artistDnaSchema.partial().parse(req.body);
      const artist = await prisma.artist.update({
        where: { id: req.params.id, workspaceId },
        data: data as never,
      });
      return publicArtist(artist);
    }
  );
}

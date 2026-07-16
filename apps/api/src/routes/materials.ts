import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@afrohit/db";
import {
  genreSchema,
  isMaterialRole,
  materialCanAutoAssemble,
  materialGenreMatches,
  synthKitFor,
} from "@afrohit/shared";
import { getSoundDNA } from "@afrohit/ai";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "./admin";
import { createQueuedProviderJob, scopedRequestKey } from "../lib/queued-job";
import {
  operationErrorBody,
  runIdempotentOperation,
} from "../lib/idempotent-operation";
import {
  kitRolesFor,
  homeKeyFor,
  pickMaterial,
  materialCoverage,
  claudeArrangement,
} from "../lib/material-plan";
import { blueprintForSong, blueprintForReference } from "../lib/blueprint";
import { autoMaterialBeat } from "../lib/material-auto";

/**
 * THE MATERIAL LAYER API — real, rights-classified loops arranged into exact beats.
 *
 *  GET  /            → the material library (per genre/role)
 *  POST /forge       → forge a genre KIT: isolated loops for the core roles (in key)
 *  POST /assemble    → Claude arranges picked material into a real beat (exact, deterministic)
 */

export default async function materials(app: FastifyInstance) {
  // TENANT SURFACE ISOLATION (Wave 8a): the material forge is the operator's
  // engine room — consumers reach beats through Create/Studio flows, which use
  // lib/material-plan internally (never these HTTP routes). Scoped hook =
  // every route in this plugin is server-enforced operator-only.
  app.addHook("preValidation", async req => {
    await requireAdmin(req);
  });

  /** The library — what's on the shelf, grouped for the UI/chat. */
  app.get<{ Querystring: { genre?: string } }>("/", async req => {
    const { workspaceId } = requireAuth(req);
    // GENRE IN JS (source-truth wave item 8): the exact-equality query hid
    // 'Afrobeats'-tagged rows from an '?genre=afrobeats' shelf view. Fetch a
    // wider window when filtering, compare canonically, keep the original
    // 200-row budget. Semantics preserved exactly: with a genre only matching
    // rows show (genre-null rows didn't match the old equality and still
    // don't); without a genre the whole shelf shows, untagged included.
    const shelf = await prisma.materialAsset.findMany({
      where: {
        workspaceId,
        role: { not: "instrumental" },
      },
      orderBy: { createdAt: "desc" },
      take: req.query.genre ? 600 : 200,
      include: { _count: { select: { usages: true } } },
    });
    const rows = req.query.genre
      ? shelf
          .filter(m => materialGenreMatches(m.genre, req.query.genre))
          .slice(0, 200)
      : shelf;
    type Row = {
      id: string;
      role: string;
      genre: string | null;
      bpm: number | null;
      keySignature: string | null;
      bars: number | null;
      source: string;
      url: string;
      createdAt: Date;
      meta: unknown;
      readiness: string;
      qualityState: string;
      roleEvidence: string;
      rightsBasis: string;
      contentHash: string | null;
      verifiedAt: Date | null;
      _count: { usages: number };
    };
    // TRUE ORIGIN per row: source is the rights column ('forged' covers both
    // engines), meta says WHICH machine made it — synth bridge vs the real forge.
    // Stems keep their provenance verbatim (artist_stem / provider_stem).
    const originOf = (m: Row) => {
      const meta = (m.meta ?? {}) as { synth?: boolean; origin?: string };
      return m.source !== "forged"
        ? m.source
        : meta.synth
          ? "synth"
          : (meta.origin ?? "forged");
    };
    // INTEGRITY — "confirm every material is true": same rows, zero extra
    // queries. distinctFiles counts unique underlying audio, so duplicates > 0
    // means the shelf is re-serving the same file under different rows.
    const byOrigin: Record<string, number> = {};
    const byReadiness: Record<string, number> = {};
    for (const m of rows as Row[])
      byOrigin[originOf(m)] = (byOrigin[originOf(m)] ?? 0) + 1;
    for (const m of rows as Row[])
      byReadiness[m.readiness] = (byReadiness[m.readiness] ?? 0) + 1;
    const distinctFiles = new Set(
      (rows as Row[]).map(m => m.contentHash ?? m.url)
    ).size;
    return {
      total: rows.length,
      integrity: {
        totalLoops: rows.length,
        distinctFiles,
        duplicates: rows.length - distinctFiles,
        byOrigin,
        byReadiness,
        usedMaterials: (rows as Row[]).filter(m => m._count.usages > 0).length,
        totalUses: (rows as Row[]).reduce((sum, m) => sum + m._count.usages, 0),
      },
      materials: (rows as Row[]).map(m => ({
        id: m.id,
        role: m.role,
        genre: m.genre,
        bpm: m.bpm,
        keySignature: m.keySignature,
        bars: m.bars,
        source: m.source,
        origin: originOf(m),
        variant: ((m.meta ?? {}) as { variant?: number }).variant ?? null,
        readiness: m.readiness,
        qualityState: m.qualityState,
        roleEvidence: m.roleEvidence,
        rightsBasis: m.rightsBasis,
        contentHash: m.contentHash,
        verifiedAt: m.verifiedAt,
        usageCount: m._count.usages,
        url: m.url,
        createdAt: m.createdAt,
      })),
    };
  });

  /** Exact all-time destinations for one material file. */
  app.get<{ Params: { materialId: string } }>(
    "/:materialId/usage",
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const material = await prisma.materialAsset.findFirst({
        where: { id: req.params.materialId, workspaceId },
        select: { id: true, role: true, contentHash: true },
      });
      if (!material)
        return reply.code(404).send({ error: "material_not_found" });
      const where = { workspaceId, materialId: material.id };
      const [totalUses, uses] = await Promise.all([
        prisma.materialUsage.count({ where }),
        prisma.materialUsage.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            beatId: true,
            songId: true,
            providerJobId: true,
            role: true,
            sourceBpm: true,
            targetBpm: true,
            stretchRatio: true,
            gain: true,
            pan: true,
            sections: true,
            createdAt: true,
          },
        }),
      ]);
      return { material, totalUses, receiptsReturned: uses.length, uses };
    }
  );

  /**
   * FORGE a genre kit — one isolated loop per core role, melodic roles in the
   * genre's home key so separately-forged loops fit together. Each loop is a
   * paid render (~$0.10) so the whole kit is cost-capped like everything else.
   */
  const forgeSchema = z.object({
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180).optional(),
    keySignature: z.string().max(24).optional(),
    roles: z
      .array(
        z
          .string()
          .min(1)
          .max(40)
          .refine(
            role =>
              role === "fill" ||
              ["drums", "bass", "percussion", "chords"].includes(role) ||
              isMaterialRole(role),
            "unknown material role"
          )
      )
      .max(30)
      .optional(),
  });
  app.post("/forge", { schema: { body: forgeSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = forgeSchema.parse(req.body);
    // Explicit roles are forged as asked; the DEFAULT kit forges only the GAPS —
    // roles this genre has no material for yet — so re-running just tops up the shelf.
    let roles = input.roles?.length
      ? input.roles
      : kitRolesFor(input.genre, 14);
    if (!input.roles?.length) {
      const existing: Array<{
        role: string;
        source: string;
        roleEvidence: string;
      }> = await prisma.materialAsset.findMany({
        where: {
          workspaceId,
          genre: input.genre,
          readiness: "ready",
          qualityState: "passed",
          rightsBasis: { not: "unknown" },
        },
        select: { role: true, source: true, roleEvidence: true },
      });
      const have = new Set(
        existing.filter(materialCanAutoAssemble).map(m => m.role)
      );
      roles = roles.filter(r => !have.has(r));
      if (!roles.length) {
        return {
          forging: [],
          note: `The ${input.genre} kit is already stocked (${[...have].join(", ")}). Nothing to forge.`,
        };
      }
    }
    const bpm = input.bpm ?? getSoundDNA(input.genre)?.typicalBpm ?? 108;
    const keySignature = input.keySignature ?? homeKeyFor(input.genre);

    const jobs: Array<{ role: string; jobId: string }> = [];
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i]!;
      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        `material-forge:${role}:${i}`
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: "beat_idea_short_30s",
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", forged: jobs, ...charge });
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.music,
        jobName: "forge-material",
        workspaceId,
        kind: "material",
        provider: "workspace-music",
        inputJson: { genre: input.genre, role, bpm, keySignature },
        charge,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          genre: input.genre,
          role,
          bpm,
          keySignature,
        }),
        // STAGGER: Replicate throttles prediction creation (observed live: 6/min,
        // burst 1) — parallel forges 429'd. 30s spacing keeps the kit flowing.
        delayMs: i * 30_000,
      });
      jobs.push({ role, jobId: job.jobId });
    }
    reply.code(202);
    return {
      forging: jobs,
      keySignature,
      note: `Forging ${jobs.length} isolated ${input.genre} loops at ${bpm}bpm in ${keySignature} — poll each job; QC-passed loops land in the library.`,
    };
  });

  /**
   * ASSEMBLE — the exact beat. Picks the best material per role (key-aware,
   * bpm-proximate, artist stems preferred), then CLAUDE ARRANGES the build for
   * this exact material (worker falls back to the classic template if the plan
   * is unusable — never a broken beat).
   */
  const assembleSchema = z.object({
    projectId: z.string().cuid(),
    songId: z.string().cuid().optional(),
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180),
    keySignature: z.string().max(24).optional(),
    vibe: z.string().max(200).optional(),
  });
  /**
   * AUTO — "let AI run it." One action: forge whatever the genre's kit is missing
   * near this bpm, then assemble the exact beat automatically. No manual forge-then-
   * assemble. Returns 'assembling' if the shelf was stocked, else 'forging'; a
   * durable orchestration job assembles once the loops land.
   */
  const autoSchema = z.object({
    projectId: z.string().cuid(),
    songId: z.string().cuid().optional(),
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180).optional(),
    keySignature: z.string().max(24).optional(),
    vibe: z.string().max(200).optional(),
  });
  const synthSchema = z.object({
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180).optional(),
  });
  app.post("/synth", { schema: { body: synthSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = synthSchema.parse(req.body);
    const roles = synthKitFor(input.genre);
    // Owned synthesized material (log_drum / shaker / bass glide) — near-zero cost,
    // rights-clean, disclosed as source:'forged' + meta.synth in the shelf.
    const idempotencyKey = scopedRequestKey(
      req.headers as Record<string, unknown>,
      "material-synth"
    );
    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.music,
      jobName: "synth-material",
      workspaceId,
      kind: "material-synth",
      provider: "internal",
      inputJson: { genre: input.genre, bpm: input.bpm, roles },
      idempotencyKey,
      payload: jobId => ({
        jobId,
        workspaceId,
        genre: input.genre,
        bpm: input.bpm,
        roles,
      }),
    });
    reply.code(202);
    return {
      queued: true,
      jobId: job.jobId,
      replayed: job.replayed,
      roles,
      note: "Genre-specific synthesized loops are being verified before they land on the shelf.",
    };
  });

  // THE AFROHIT ENGINE v1 — composed, not rented. One call: owned kit ->
  // grid-locked beat -> optional MusicGen melody conditioned on OUR groove ->
  // measured proof (lane + blueprint). Voice rides /vocals/upload afterwards.
  const ownEngineSchema = z.object({
    projectId: z.string().cuid(),
    songId: z.string().cuid().optional(),
    genre: genreSchema,
    bpm: z.number().int().min(60).max(180).optional(),
    melody: z.boolean().optional(),
    melodyPrompt: z.string().max(300).optional(),
    blueprintSongId: z.string().cuid().optional(),
    blueprintReferenceId: z.string().cuid().optional(),
  });
  app.post(
    "/own-engine",
    { schema: { body: ownEngineSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = ownEngineSchema.parse(req.body);
      await prisma.project.findFirstOrThrow({
        where: { id: input.projectId, workspaceId },
      });
      if (input.songId) {
        await prisma.song.findFirstOrThrow({
          where: { id: input.songId, projectId: input.projectId, workspaceId },
        });
      }
      const blueprint = input.blueprintSongId
        ? await blueprintForSong(workspaceId, input.blueprintSongId)
        : input.blueprintReferenceId
          ? await blueprintForReference(workspaceId, input.blueprintReferenceId)
          : null;
      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "own-engine"
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: "beat_idea_short_30s",
        refTable: "Project",
        refId: input.projectId,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.music,
        jobName: "own-engine",
        workspaceId,
        projectId: input.projectId,
        kind: "music",
        provider: "afrohit-own",
        inputJson: { ownEngine: true, ...input },
        charge,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          projectId: input.projectId,
          songId: input.songId,
          genre: input.genre,
          bpm: input.bpm,
          melody: input.melody,
          melodyPrompt: input.melodyPrompt,
          blueprint,
        }),
      });
      reply.code(202);
      return {
        jobId: job.jobId,
        status: "queued",
        replayed: job.replayed,
        engine: "afrohit-controlled-v2",
        layers: [
          "verified workspace material, genre-kit selected and grid locked",
          input.melody === true
            ? "optional provider melody for verified <=30s ideas"
            : "provider melody: off",
          "voice: your upload or trained profile in the vocal workflow",
          "proof: material usage ledger + lane compliance + blueprint verify",
        ],
        note: "Poll the job; the resulting beat keeps queryable material-use and measurement receipts.",
      };
    }
  );

  app.post("/auto", { schema: { body: autoSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = autoSchema.parse(req.body);
    await prisma.project.findFirstOrThrow({
      where: { id: input.projectId, workspaceId },
    });
    if (input.songId) {
      await prisma.song.findFirstOrThrow({
        where: { id: input.songId, projectId: input.projectId, workspaceId },
      });
    }
    const operationKey = scopedRequestKey(
      req.headers as Record<string, unknown>,
      "material-auto"
    );
    const result = await autoMaterialBeat(app, workspaceId, {
      ...input,
      operationKey,
    });
    if (result.status === "payment_required")
      return reply.code(402).send(result);
    reply.code(202);
    return result;
  });

  app.post(
    "/assemble",
    { schema: { body: assembleSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = assembleSchema.parse(req.body);
      await prisma.project.findFirstOrThrow({
        where: { id: input.projectId, workspaceId },
      });
      if (input.songId) {
        await prisma.song.findFirstOrThrow({
          where: { id: input.songId, projectId: input.projectId, workspaceId },
        });
      }

      const rows = await prisma.materialAsset.findMany({
        where: { workspaceId, genre: input.genre },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "material-assemble"
      );
      // A new request gets a fresh combination, while retries of that request get
      // the exact same picks and arrangement.
      const varietySeed = idempotencyKey
        ? Number.parseInt(
            createHash("sha256")
              .update(idempotencyKey)
              .digest("hex")
              .slice(0, 8),
            16
          ) % 100000
        : Date.now() % 100000;
      const wantedRoles = kitRolesFor(input.genre, 14);
      const picks = pickMaterial(
        rows,
        input.genre,
        input.bpm,
        input.keySignature,
        { varietySeed, roles: wantedRoles }
      );
      const coverage = materialCoverage(picks);
      if (!coverage.ready) {
        return reply.code(400).send({
          error: "not_enough_material",
          have: picks.map(p => p.role),
          need: wantedRoles.filter(
            role => !picks.some(pick => pick.role === role)
          ),
          coverage,
          message: `The ${input.genre} shelf needs more loops near ${input.bpm}bpm — run POST /materials/forge {"genre":"${input.genre}","bpm":${input.bpm}} first.`,
        });
      }

      const charge = await app.chargeCredits({
        workspaceId,
        key: "beat_idea_short_30s",
        refTable: "Project",
        refId: input.projectId,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });
      let arrangement;
      try {
        arrangement = await runIdempotentOperation({
          workspaceId,
          projectId: input.projectId,
          kind: "material-arrangement",
          provider: "text",
          idempotencyKey: idempotencyKey
            ? `${idempotencyKey}:arrangement`
            : undefined,
          inputJson: { ...input, picks: picks.map(p => p.id) },
          execute: () =>
            claudeArrangement(
              input.genre,
              input.bpm,
              picks.map(p => p.role),
              input.vibe
            ),
        });
      } catch (error) {
        await app.refundCredits({
          workspaceId,
          key: "beat_idea_short_30s",
          refTable: "Project",
          refId: input.projectId,
          chargeId: charge.chargeId,
        });
        throw error;
      }
      if (arrangement.state !== "completed") {
        const failure = operationErrorBody(arrangement);
        return reply.code(failure.statusCode).send(failure.body);
      }
      const sections = arrangement.value;

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.music,
        jobName: "assemble-beat",
        workspaceId,
        projectId: input.projectId,
        kind: "music",
        provider: "material",
        inputJson: {
          assemble: true,
          ...input,
          picks: picks.map(p => p.role),
          sections,
        },
        charge,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          projectId: input.projectId,
          songId: input.songId,
          bpm: input.bpm,
          genre: input.genre,
          picks,
          sections,
        }),
      });
      reply.code(202);
      return {
        jobId: job.jobId,
        replayed: job.replayed,
        status: "queued",
        roles: picks.map(p => p.role),
        arrangement: sections
          ? sections.map(s => `${s.name}:${s.bars}bars[${s.roles.join("+")}]`)
          : "classic template",
        note: "Assembling the exact beat from real material — poll the job.",
      };
    }
  );
}

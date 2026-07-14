import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { loadReleaseCertification, prisma } from "@afrohit/db";
import {
  evaluateCompetitorBenchmark,
  type BenchmarkScores,
  type CompetitorJudgmentEvidence,
} from "@afrohit/shared";
import { requireAuth, requireRole } from "../middleware/auth";
import { fingerprintUploadedAudio, presignAssetRef } from "../lib/storage";

/**
 * LISTENING BENCHMARK — the ear-vs-machine ground truth loop (Feature 4).
 * The honest answer to "does lane 87 mean it actually sounds good?": rate real
 * renders 1–5, tag the machine's lane score, and compare per genre. Also captures
 * blind A/B picks — ours vs a reference AND our own renders head-to-head
 * (/pair → /pick, logged as ear.ab_pick). Without this the app can lie to itself.
 */
const rateSchema = z.object({
  genre: z.string().min(1),
  audioUrl: z.string().url(),
  humanRating: z.number().int().min(1).max(5),
  source: z.enum(["afrohit", "reference", "suno"]).default("afrohit"),
  songId: z.string().optional(),
  engine: z.string().optional(),
  laneScore: z.number().int().min(0).max(100).optional(),
  blindLabel: z.string().max(4).optional(),
  notes: z.string().max(2000).optional(),
});

const pickSchema = z.object({
  winner: z.string().min(1),
  loser: z.string().min(1),
  note: z.string().max(500).optional(),
});
const scoreSetSchema = z
  .object({
    groove: z.number().int().min(1).max(5),
    genreIdentity: z.number().int().min(1).max(5),
    songwriting: z.number().int().min(1).max(5),
    vocals: z.number().int().min(1).max(5),
    mix: z.number().int().min(1).max(5),
    replayValue: z.number().int().min(1).max(5),
  })
  .strict();

const createCompetitorPairSchema = z
  .object({
    songId: z.string().cuid(),
    referenceKey: z.string().min(4).max(700),
    referenceFormat: z
      .enum(["wav", "mp3", "flac", "aiff", "m4a", "ogg", "webm"])
      .optional(),
    competitor: z.enum(["suno", "udio", "other"]).default("suno"),
    rightsAttestation: z
      .object({
        confirmed: z.literal(true),
        basis: z.enum(["owner", "licensed_evaluation"]),
        note: z.string().trim().min(3).max(500),
      })
      .strict(),
  })
  .strict();

const judgeCompetitorPairSchema = z
  .object({
    winner: z.enum(["a", "b", "tie"]),
    scores: z.object({ a: scoreSetSchema, b: scoreSetSchema }).strict(),
    confidence: z.number().int().min(1).max(5),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

function afrohitAssignedToA(seed: string, userId: string): boolean {
  return (
    createHash("sha256")
      .update(seed + ":" + userId)
      .digest()[0]! %
      2 ===
    0
  );
}

function normalizedWinner(
  side: "a" | "b" | "tie",
  afrohitOnA: boolean
): "afrohit" | "competitor" | "tie" {
  if (side === "tie") return "tie";
  return (side === "a") === afrohitOnA ? "afrohit" : "competitor";
}

/** Freshest playable audio (newest of master/mix/beat) — same rule the catalog
 *  list uses, so the blind test plays exactly what the library plays. */
function freshestUrl(s: {
  masters: Array<{ url: string; createdAt: Date }>;
  mixes: Array<{ url: string; createdAt: Date }>;
  beats: Array<{ url: string; createdAt: Date }>;
}): string | null {
  const cands = [s.masters[0], s.mixes[0], s.beats[0]].filter(
    Boolean
  ) as Array<{ url: string; createdAt: Date }>;
  if (!cands.length) return null;
  cands.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return cands[0]!.url;
}

export default async function benchmark(app: FastifyInstance) {
  // Record one rating.
  app.post("/rate", { schema: { body: rateSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const b = rateSchema.parse(req.body);
    const row = await prisma.benchmarkRating.create({
      data: { workspaceId, ...b },
    });
    reply.code(201);
    return { id: row.id };
  });

  // Songs rendered recently that still need a rating — the queue to listen through.
  app.get("/queue", async req => {
    const { workspaceId } = requireAuth(req);
    const rated = new Set(
      (
        await prisma.benchmarkRating.findMany({
          where: { workspaceId },
          select: { songId: true },
        })
      )
        .map((r: { songId: string | null }) => r.songId)
        .filter(Boolean)
    );
    const beats = await prisma.beatAsset.findMany({
      where: { project: { workspaceId }, approved: true },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        url: true,
        provider: true,
        songId: true,
        project: { select: { genre: true } },
        meta: true,
      },
    });
    type BeatRow = {
      id: string;
      url: string;
      provider: string;
      songId: string | null;
      project: { genre: string | null };
      meta: unknown;
    };
    return beats
      .filter((b: BeatRow) => !b.songId || !rated.has(b.songId))
      .map((b: BeatRow) => ({
        songId: b.songId,
        url: b.url,
        genre: b.project.genre,
        engine: b.provider,
        laneScore:
          ((b.meta ?? {}) as { bestOf?: { laneScore?: number } }).bestOf
            ?.laneScore ?? null,
      }));
  });

  // Per-genre aggregate: human average vs machine lane average + the GAP (where
  // the score and the ear disagree). This is the number that tells the truth.
  app.get("/summary", async req => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.benchmarkRating.findMany({
      where: { workspaceId },
      select: { genre: true, source: true, humanRating: true, laneScore: true },
    });
    const byGenre: Record<
      string,
      {
        n: number;
        humanSum: number;
        laneSum: number;
        laneN: number;
        ref: number[];
        ours: number[];
      }
    > = {};
    for (const r of rows) {
      const g = (byGenre[r.genre] ??= {
        n: 0,
        humanSum: 0,
        laneSum: 0,
        laneN: 0,
        ref: [],
        ours: [],
      });
      g.n++;
      g.humanSum += r.humanRating;
      if (r.laneScore != null) {
        g.laneSum += r.laneScore;
        g.laneN++;
      }
      (r.source === "afrohit" ? g.ours : g.ref).push(r.humanRating);
      void r.source;
    }
    const avg = (a: number[]) =>
      a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null;
    return {
      genres: Object.entries(byGenre).map(([genre, g]) => ({
        genre,
        ratings: g.n,
        avgHuman: +(g.humanSum / g.n).toFixed(2),
        avgLaneScore: g.laneN ? Math.round(g.laneSum / g.laneN) : null,
        // Ear on a 0–100 scale for a like-for-like gap vs the lane score.
        earVsLaneGap: g.laneN
          ? Math.round((g.humanSum / g.n) * 20 - g.laneSum / g.laneN)
          : null,
        avgOurs: avg(g.ours),
        avgReference: avg(g.ref),
        beatsReference:
          avg(g.ours) != null && avg(g.ref) != null
            ? avg(g.ours)! > avg(g.ref)!
            : null,
      })),
      note: "earVsLaneGap = (avgHuman×20) − avgLaneScore. Large negative = the machine scores it higher than your ear does — its confidence is inflated for that genre.",
    };
  });

  // Blind pair: two DIFFERENT random renders from the last 50 with real audio.
  // Tokens are song ids, but the payload carries NO titles and NO lane labels —
  // blindness is the UI's job and this response refuses to help anyone peek.
  app.get("/pair", async req => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.song.findMany({
      where: {
        workspaceId,
        OR: [
          { beats: { some: {} } },
          { mixes: { some: {} } },
          { masters: { some: {} } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        project: { select: { genre: true } },
        masters: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { url: true, createdAt: true },
        },
        mixes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { url: true, createdAt: true },
        },
        beats: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { url: true, createdAt: true },
        },
      },
    });
    type PairRow = {
      id: string;
      project: { genre: string | null };
      masters: Array<{ url: string; createdAt: Date }>;
      mixes: Array<{ url: string; createdAt: Date }>;
      beats: Array<{ url: string; createdAt: Date }>;
    };
    const playable = (rows as PairRow[])
      .map(s => ({
        id: s.id,
        genre: s.project.genre ?? "",
        url: freshestUrl(s),
      }))
      .filter((s): s is { id: string; genre: string; url: string } => !!s.url);
    if (playable.length < 2) return { a: null, b: null };
    // Same lane preferred — a within-lane pick is a fair fight. Cross-lane only
    // when no single lane has two playable renders yet.
    const byLane = new Map<string, typeof playable>();
    for (const s of playable) {
      const l = byLane.get(s.genre) ?? [];
      l.push(s);
      byLane.set(s.genre, l);
    }
    const lanes = [...byLane.values()].filter(l => l.length >= 2);
    const pool = lanes.length
      ? lanes[Math.floor(Math.random() * lanes.length)]!
      : playable;
    const i = Math.floor(Math.random() * pool.length);
    let j = Math.floor(Math.random() * (pool.length - 1));
    if (j >= i) j++;
    return {
      a: { token: pool[i]!.id, url: pool[i]!.url },
      b: { token: pool[j]!.id, url: pool[j]!.url },
    };
  });

  // Record a blind pick + the WHY. The event log IS the record here — no
  // .catch() swallow: if the row didn't write, the pick didn't happen.
  app.post("/pick", { schema: { body: pickSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const b = pickSchema.parse(req.body);
    if (b.winner === b.loser) {
      reply.code(400);
      return { error: "winner and loser must be different songs" };
    }
    // Both tokens must be OUR songs — a pick against someone else's id is noise.
    const owned = await prisma.song.count({
      where: { id: { in: [b.winner, b.loser] }, workspaceId },
    });
    if (owned !== 2) {
      reply.code(404);
      return { error: "unknown song token" };
    }
    await prisma.analyticsEvent.create({
      data: {
        workspaceId,
        name: "ear.ab_pick",
        properties: {
          winner: b.winner,
          loser: b.loser,
          note: b.note ?? null,
        } as never,
      },
    });
    reply.code(201);
    return { ok: true };
  });

  // What the ear has been saying: tally the last 500 blind picks per song and
  // surface the top winners/losers (titles resolved so it's readable) plus the
  // most recent WHY notes — the actual improvement signal.
  app.get("/ab-summary", async req => {
    const { workspaceId } = requireAuth(req);
    const events = await prisma.analyticsEvent.findMany({
      where: { workspaceId, name: "ear.ab_pick" },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { properties: true, createdAt: true },
    });
    type PickRow = { properties: unknown; createdAt: Date };
    const tally: Record<string, { wins: number; losses: number }> = {};
    const rawNotes: Array<{ note: string; winner: string }> = [];
    for (const e of events as PickRow[]) {
      const p = (e.properties ?? {}) as {
        winner?: string;
        loser?: string;
        note?: string | null;
      };
      if (!p.winner || !p.loser) continue;
      (tally[p.winner] ??= { wins: 0, losses: 0 }).wins++;
      (tally[p.loser] ??= { wins: 0, losses: 0 }).losses++;
      if (p.note && rawNotes.length < 5)
        rawNotes.push({ note: p.note, winner: p.winner });
    }
    const ids = Object.keys(tally);
    const named: Array<{
      id: string;
      title: string;
      lyric: { title: string | null } | null;
    }> = ids.length
      ? await prisma.song.findMany({
          where: { id: { in: ids }, workspaceId },
          select: { id: true, title: true, lyric: { select: { title: true } } },
        })
      : [];
    const titleById = new Map<string, string>();
    for (const s of named) titleById.set(s.id, s.lyric?.title || s.title);
    const scored = ids.map(id => ({
      songId: id,
      title: titleById.get(id) ?? "(deleted)",
      wins: tally[id]!.wins,
      losses: tally[id]!.losses,
    }));
    return {
      picks: events.length,
      winners: [...scored]
        .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
        .slice(0, 10),
      losers: [...scored]
        .sort((a, b) => b.losses - a.losses || a.wins - b.wins)
        .slice(0, 10),
      notes: rawNotes.map(n => ({
        note: n.note,
        picked: titleById.get(n.winner) ?? "(deleted)",
      })),
    };
  });

  // Immutable, competitor-labeled benchmark candidates. Only QC-passed audio
  // can enter a comparison; the client never receives the underlying asset ref.
  app.get("/competitor/candidates", async req => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.song.findMany({
      where: {
        workspaceId,
        quarantined: false,
        OR: [
          {
            masters: {
              some: {
                approved: true,
                qualityState: "passed",
                contentHash: { not: null },
                verifiedAt: { not: null },
              },
            },
          },
          {
            mixes: {
              some: {
                approved: true,
                qualityState: "passed",
                contentHash: { not: null },
                verifiedAt: { not: null },
              },
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, title: true, project: { select: { genre: true } } },
    });
    return rows.map(
      (row: { id: string; title: string; project: { genre: string } }) => ({
        id: row.id,
        title: row.title,
        genre: row.project.genre,
      })
    );
  });

  app.post("/competitor/pairs", async (req, reply) => {
    const { workspaceId, userId } = requireRole(req, [
      "OWNER",
      "ADMIN",
      "PRODUCER",
    ]);
    const input = createCompetitorPairSchema.parse(req.body);
    const certification = await loadReleaseCertification(prisma, {
      workspaceId,
      songId: input.songId,
    });
    if (
      !certification.audio ||
      !certification.audio.approved ||
      certification.audio.qualityState !== "passed" ||
      !certification.audio.contentHash ||
      !certification.audio.verifiedAt
    ) {
      return reply.code(409).send({
        error: "certified_afrohit_audio_required",
        message: "Choose a song with an approved, measured master or mix.",
      });
    }

    const reference = await fingerprintUploadedAudio(
      workspaceId,
      input.referenceKey,
      input.referenceFormat
    );
    const existing = await prisma.benchmarkPair.findFirst({
      where: {
        workspaceId,
        songId: input.songId,
        competitor: input.competitor,
        afrohitContentHash: certification.audio.contentHash,
        referenceContentHash: reference.contentHash,
        status: "open",
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, existing: true };

    const attestedAt = new Date();
    const pair = await prisma.benchmarkPair.create({
      data: {
        workspaceId,
        createdById: userId,
        songId: input.songId,
        genre: certification.song.project.genre,
        competitor: input.competitor,
        afrohitAssetRef: certification.audio.url,
        afrohitContentHash: certification.audio.contentHash,
        referenceAssetRef: reference.assetRef,
        referenceContentHash: reference.contentHash,
        referenceSizeBytes: reference.sizeBytes,
        referenceFormat: reference.format,
        rightsBasis: input.rightsAttestation.basis,
        rightsAttestation: {
          schemaVersion: 1,
          confirmed: true,
          basis: input.rightsAttestation.basis,
          note: input.rightsAttestation.note,
          attestedBy: userId,
          attestedAt: attestedAt.toISOString(),
          contentHash: reference.contentHash,
        },
        seed: randomBytes(32).toString("hex"),
      },
      select: { id: true },
    });
    reply.code(201);
    return { id: pair.id, existing: false };
  });

  app.get("/competitor/pairs", async req => {
    const { workspaceId, userId } = requireAuth(req);
    const rows = await prisma.benchmarkPair.findMany({
      where: { workspaceId, status: "open" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        genre: true,
        competitor: true,
        seed: true,
        status: true,
        createdAt: true,
        song: { select: { title: true } },
        judgments: {
          where: { userId },
          take: 1,
          select: { winner: true, createdAt: true },
        },
        _count: { select: { judgments: true } },
      },
    });
    type PairListRow = {
      id: string;
      genre: string;
      competitor: string;
      seed: string;
      status: string;
      createdAt: Date;
      song: { title: string };
      judgments: Array<{ winner: string; createdAt: Date }>;
      _count: { judgments: number };
    };
    return (rows as PairListRow[]).map(row => {
      const judged = row.judgments[0] ?? null;
      const afrohitOnA = afrohitAssignedToA(row.seed, userId);
      return {
        id: row.id,
        genre: row.genre,
        status: row.status,
        createdAt: row.createdAt,
        judgmentCount: row._count.judgments,
        judged: !!judged,
        audio: {
          a: `/benchmark/competitor/pairs/${row.id}/audio/a`,
          b: `/benchmark/competitor/pairs/${row.id}/audio/b`,
        },
        reveal: judged
          ? {
              afrohitSide: afrohitOnA ? "a" : "b",
              afrohitTitle: row.song.title,
              competitor: row.competitor,
              winner: judged.winner,
              judgedAt: judged.createdAt,
            }
          : null,
      };
    });
  });

  app.get<{ Params: { pairId: string; side: string } }>(
    "/competitor/pairs/:pairId/audio/:side",
    async (req, reply) => {
      const { workspaceId, userId } = requireAuth(req);
      if (req.params.side !== "a" && req.params.side !== "b") {
        return reply.code(400).send({ error: "invalid_benchmark_side" });
      }
      const pair = await prisma.benchmarkPair.findFirst({
        where: { id: req.params.pairId, workspaceId, status: "open" },
        select: { seed: true, afrohitAssetRef: true, referenceAssetRef: true },
      });
      if (!pair)
        return reply.code(404).send({ error: "benchmark_pair_not_found" });
      const afrohitOnA = afrohitAssignedToA(pair.seed, userId);
      const useAfrohit = (req.params.side === "a") === afrohitOnA;
      const assetRef = useAfrohit
        ? pair.afrohitAssetRef
        : pair.referenceAssetRef;
      reply.header("cache-control", "private, no-store");
      return reply.redirect(await presignAssetRef(assetRef, 180));
    }
  );

  app.post<{ Params: { pairId: string } }>(
    "/competitor/pairs/:pairId/judge",
    async (req, reply) => {
      const { workspaceId, userId } = requireAuth(req);
      const input = judgeCompetitorPairSchema.parse(req.body);
      const pair = await prisma.benchmarkPair.findFirst({
        where: { id: req.params.pairId, workspaceId, status: "open" },
        select: {
          id: true,
          seed: true,
          competitor: true,
          song: { select: { title: true } },
        },
      });
      if (!pair)
        return reply.code(404).send({ error: "benchmark_pair_not_found" });
      const already = await prisma.benchmarkJudgment.findUnique({
        where: { pairId_userId: { pairId: pair.id, userId } },
        select: { id: true },
      });
      if (already) {
        return reply.code(409).send({
          error: "benchmark_judgment_already_recorded",
          message:
            "A blind judgment cannot be changed after the sources are revealed.",
        });
      }

      const afrohitOnA = afrohitAssignedToA(pair.seed, userId);
      const afrohitScores = (
        afrohitOnA ? input.scores.a : input.scores.b
      ) as BenchmarkScores;
      const competitorScores = (
        afrohitOnA ? input.scores.b : input.scores.a
      ) as BenchmarkScores;
      const winner = normalizedWinner(input.winner, afrohitOnA);
      try {
        await prisma.$transaction([
          prisma.benchmarkJudgment.create({
            data: {
              workspaceId,
              pairId: pair.id,
              userId,
              winner,
              afrohitScores,
              competitorScores,
              confidence: input.confidence,
              note: input.note,
            },
          }),
          prisma.analyticsEvent.create({
            data: {
              workspaceId,
              userId,
              name: "benchmark.competitor_judgment",
              properties: {
                pairId: pair.id,
                winner,
                competitor: pair.competitor,
              } as never,
            },
          }),
        ]);
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          return reply
            .code(409)
            .send({ error: "benchmark_judgment_already_recorded" });
        }
        throw error;
      }
      reply.code(201);
      return {
        recorded: true,
        reveal: {
          afrohitSide: afrohitOnA ? "a" : "b",
          afrohitTitle: pair.song.title,
          competitor: pair.competitor,
          winner,
        },
      };
    }
  );

  app.get("/competitor/evidence", async req => {
    const { workspaceId } = requireAuth(req);
    const [rows, totalPairs] = await Promise.all([
      prisma.benchmarkJudgment.findMany({
        where: { workspaceId },
        select: {
          pairId: true,
          userId: true,
          winner: true,
          afrohitScores: true,
          competitorScores: true,
          pair: { select: { genre: true, competitor: true } },
        },
      }),
      prisma.benchmarkPair.count({ where: { workspaceId } }),
    ]);
    type JudgmentRow = {
      pairId: string;
      userId: string;
      winner: string;
      afrohitScores: unknown;
      competitorScores: unknown;
      pair: { genre: string; competitor: string };
    };
    const evidenceRows = (rows as JudgmentRow[]).map(row => ({
      pairId: row.pairId,
      judgeId: row.userId,
      genre: row.pair.genre,
      competitor: row.pair.competitor,
      winner: row.winner,
      afrohitScores: row.afrohitScores,
      competitorScores: row.competitorScores,
    })) as CompetitorJudgmentEvidence[];
    return {
      totalPairs,
      ...evaluateCompetitorBenchmark(evidenceRows, { competitor: "suno" }),
    };
  });
}

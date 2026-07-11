import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';

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
  source: z.enum(['afrohit', 'reference', 'suno']).default('afrohit'),
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

/** Freshest playable audio (newest of master/mix/beat) — same rule the catalog
 *  list uses, so the blind test plays exactly what the library plays. */
function freshestUrl(s: {
  masters: Array<{ url: string; createdAt: Date }>;
  mixes: Array<{ url: string; createdAt: Date }>;
  beats: Array<{ url: string; createdAt: Date }>;
}): string | null {
  const cands = [s.masters[0], s.mixes[0], s.beats[0]].filter(Boolean) as Array<{ url: string; createdAt: Date }>;
  if (!cands.length) return null;
  cands.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return cands[0]!.url;
}

export default async function benchmark(app: FastifyInstance) {
  // Record one rating.
  app.post('/rate', { schema: { body: rateSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const b = rateSchema.parse(req.body);
    const row = await prisma.benchmarkRating.create({ data: { workspaceId, ...b } });
    reply.code(201);
    return { id: row.id };
  });

  // Songs rendered recently that still need a rating — the queue to listen through.
  app.get('/queue', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rated = new Set((await prisma.benchmarkRating.findMany({ where: { workspaceId }, select: { songId: true } })).map((r: { songId: string | null }) => r.songId).filter(Boolean));
    const beats = await prisma.beatAsset.findMany({
      where: { project: { workspaceId }, approved: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, url: true, provider: true, songId: true, project: { select: { genre: true } }, meta: true },
    });
    type BeatRow = { id: string; url: string; provider: string; songId: string | null; project: { genre: string | null }; meta: unknown };
    return beats
      .filter((b: BeatRow) => !b.songId || !rated.has(b.songId))
      .map((b: BeatRow) => ({
        songId: b.songId, url: b.url, genre: b.project.genre, engine: b.provider,
        laneScore: ((b.meta ?? {}) as { bestOf?: { laneScore?: number } }).bestOf?.laneScore ?? null,
      }));
  });

  // Per-genre aggregate: human average vs machine lane average + the GAP (where
  // the score and the ear disagree). This is the number that tells the truth.
  app.get('/summary', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.benchmarkRating.findMany({ where: { workspaceId }, select: { genre: true, source: true, humanRating: true, laneScore: true } });
    const byGenre: Record<string, { n: number; humanSum: number; laneSum: number; laneN: number; ref: number[]; ours: number[] }> = {};
    for (const r of rows) {
      const g = (byGenre[r.genre] ??= { n: 0, humanSum: 0, laneSum: 0, laneN: 0, ref: [], ours: [] });
      g.n++; g.humanSum += r.humanRating;
      if (r.laneScore != null) { g.laneSum += r.laneScore; g.laneN++; }
      (r.source === 'afrohit' ? g.ours : g.ref).push(r.humanRating);
      void r.source;
    }
    const avg = (a: number[]) => (a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null);
    return {
      genres: Object.entries(byGenre).map(([genre, g]) => ({
        genre, ratings: g.n,
        avgHuman: +(g.humanSum / g.n).toFixed(2),
        avgLaneScore: g.laneN ? Math.round(g.laneSum / g.laneN) : null,
        // Ear on a 0–100 scale for a like-for-like gap vs the lane score.
        earVsLaneGap: g.laneN ? Math.round((g.humanSum / g.n) * 20 - g.laneSum / g.laneN) : null,
        avgOurs: avg(g.ours), avgReference: avg(g.ref),
        beatsReference: avg(g.ours) != null && avg(g.ref) != null ? (avg(g.ours)! > avg(g.ref)!) : null,
      })),
      note: 'earVsLaneGap = (avgHuman×20) − avgLaneScore. Large negative = the machine scores it higher than your ear does — its confidence is inflated for that genre.',
    };
  });

  // Blind pair: two DIFFERENT random renders from the last 50 with real audio.
  // Tokens are song ids, but the payload carries NO titles and NO lane labels —
  // blindness is the UI's job and this response refuses to help anyone peek.
  app.get('/pair', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.song.findMany({
      where: { workspaceId, OR: [{ beats: { some: {} } }, { mixes: { some: {} } }, { masters: { some: {} } }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        project: { select: { genre: true } },
        masters: { orderBy: { createdAt: 'desc' }, take: 1, select: { url: true, createdAt: true } },
        mixes: { orderBy: { createdAt: 'desc' }, take: 1, select: { url: true, createdAt: true } },
        beats: { orderBy: { createdAt: 'desc' }, take: 1, select: { url: true, createdAt: true } },
      },
    });
    type PairRow = { id: string; project: { genre: string | null }; masters: Array<{ url: string; createdAt: Date }>; mixes: Array<{ url: string; createdAt: Date }>; beats: Array<{ url: string; createdAt: Date }> };
    const playable = (rows as PairRow[])
      .map((s) => ({ id: s.id, genre: s.project.genre ?? '', url: freshestUrl(s) }))
      .filter((s): s is { id: string; genre: string; url: string } => !!s.url);
    if (playable.length < 2) return { a: null, b: null };
    // Same lane preferred — a within-lane pick is a fair fight. Cross-lane only
    // when no single lane has two playable renders yet.
    const byLane = new Map<string, typeof playable>();
    for (const s of playable) { const l = byLane.get(s.genre) ?? []; l.push(s); byLane.set(s.genre, l); }
    const lanes = [...byLane.values()].filter((l) => l.length >= 2);
    const pool = lanes.length ? lanes[Math.floor(Math.random() * lanes.length)]! : playable;
    const i = Math.floor(Math.random() * pool.length);
    let j = Math.floor(Math.random() * (pool.length - 1));
    if (j >= i) j++;
    return { a: { token: pool[i]!.id, url: pool[i]!.url }, b: { token: pool[j]!.id, url: pool[j]!.url } };
  });

  // Record a blind pick + the WHY. The event log IS the record here — no
  // .catch() swallow: if the row didn't write, the pick didn't happen.
  app.post('/pick', { schema: { body: pickSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const b = pickSchema.parse(req.body);
    if (b.winner === b.loser) { reply.code(400); return { error: 'winner and loser must be different songs' }; }
    // Both tokens must be OUR songs — a pick against someone else's id is noise.
    const owned = await prisma.song.count({ where: { id: { in: [b.winner, b.loser] }, workspaceId } });
    if (owned !== 2) { reply.code(404); return { error: 'unknown song token' }; }
    await prisma.analyticsEvent.create({
      data: { workspaceId, name: 'ear.ab_pick', properties: { winner: b.winner, loser: b.loser, note: b.note ?? null } as never },
    });
    reply.code(201);
    return { ok: true };
  });

  // What the ear has been saying: tally the last 500 blind picks per song and
  // surface the top winners/losers (titles resolved so it's readable) plus the
  // most recent WHY notes — the actual improvement signal.
  app.get('/ab-summary', async (req) => {
    const { workspaceId } = requireAuth(req);
    const events = await prisma.analyticsEvent.findMany({
      where: { workspaceId, name: 'ear.ab_pick' },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { properties: true, createdAt: true },
    });
    type PickRow = { properties: unknown; createdAt: Date };
    const tally: Record<string, { wins: number; losses: number }> = {};
    const rawNotes: Array<{ note: string; winner: string }> = [];
    for (const e of events as PickRow[]) {
      const p = (e.properties ?? {}) as { winner?: string; loser?: string; note?: string | null };
      if (!p.winner || !p.loser) continue;
      (tally[p.winner] ??= { wins: 0, losses: 0 }).wins++;
      (tally[p.loser] ??= { wins: 0, losses: 0 }).losses++;
      if (p.note && rawNotes.length < 5) rawNotes.push({ note: p.note, winner: p.winner });
    }
    const ids = Object.keys(tally);
    const named: Array<{ id: string; title: string; lyric: { title: string | null } | null }> = ids.length
      ? await prisma.song.findMany({ where: { id: { in: ids }, workspaceId }, select: { id: true, title: true, lyric: { select: { title: true } } } })
      : [];
    const titleById = new Map<string, string>();
    for (const s of named) titleById.set(s.id, s.lyric?.title || s.title);
    const scored = ids.map((id) => ({ songId: id, title: titleById.get(id) ?? '(deleted)', wins: tally[id]!.wins, losses: tally[id]!.losses }));
    return {
      picks: events.length,
      winners: [...scored].sort((a, b) => b.wins - a.wins || a.losses - b.losses).slice(0, 10),
      losers: [...scored].sort((a, b) => b.losses - a.losses || a.wins - b.wins).slice(0, 10),
      notes: rawNotes.map((n) => ({ note: n.note, picked: titleById.get(n.winner) ?? '(deleted)' })),
    };
  });
}

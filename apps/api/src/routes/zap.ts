/**
 * ZAP — the real Shazam layer. Hear a song → IDENTIFY it (fingerprint) → PLAY its
 * licensed preview → LEARN its craft into the data lake so it makes our songs
 * better. Doctrine-clean: we identify + learn the UNCOPYRIGHTABLE CRAFT (genre,
 * era, lane, production/writing techniques) from the METADATA, and only ever play
 * the official licensed preview. We never download, store, or learn from the
 * commercial recording itself (that's the ripping line the /analyze guard enforces).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { recognizeSong, extractSongCraft, parseTrendSong, researchTrends, soundBrief } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { publicUrlFor, assertOwnedKey } from '../lib/storage';

const identifySchema = z.object({ key: z.string().min(4) });
const learnSchema = z.object({
  title: z.string().min(1).max(200),
  artist: z.string().max(200).optional(),
  genre: z.string().max(60).optional(),
  album: z.string().max(200).optional(),
  releaseDate: z.string().max(40).optional(),
  isrc: z.string().max(40).optional(),
});

function normGenre(g?: string | null): string | null {
  if (!g) return null;
  const k = g.toLowerCase().trim().replace(/[\s/-]+/g, '_').replace(/[^a-z_]/g, '');
  const KNOWN = new Set(['afrobeats', 'afro_fusion', 'amapiano', 'afro_dancehall', 'street_pop', 'afro_rnb', 'gospel', 'afro_pop', 'hip_hop', 'highlife', 'reggae', 'pop', 'rnb', 'dancehall', 'drill', 'trap', 'house', 'edm', 'reggaeton', 'latin_pop', 'country', 'rock', 'soul']);
  if (KNOWN.has(k)) return k;
  if (k.includes('afrobeat')) return 'afrobeats';
  if (k.includes('amapiano') || k.includes('piano')) return 'amapiano';
  if (k.includes('hiphop') || k.includes('rap')) return 'hip_hop';
  if (k.includes('rnb') || k.includes('r_b')) return 'rnb';
  return null;
}

export default async function zap(app: FastifyInstance) {
  /** IDENTIFY — fingerprint a captured/uploaded clip → title/artist + licensed preview. */
  app.post('/identify', { schema: { body: identifySchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const { key } = identifySchema.parse(req.body);
    const charge = await app.chargeCredits({ workspaceId, key: 'analyze_audio' });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
    const url = publicUrlFor(assertOwnedKey(workspaceId, key));
    const out = await recognizeSong({ url });
    if (!out.ok) {
      return reply.code(out.error === 'recognition_not_configured' ? 501 : 502).send(out);
    }
    if (out.match) {
      void prisma.analyticsEvent
        .create({ data: { workspaceId, name: 'zap.identify', properties: { title: out.match.title, artist: out.match.artist, genre: out.match.genre } as never } })
        .catch(() => {});
    }
    return { match: out.match };
  });

  /** LEARN — extract the identified song's UNCOPYRIGHTABLE CRAFT into the lake.
   * Metadata only; artist is a LANE reference, never a clone. Deduped by isrc/title. */
  app.post('/learn', { schema: { body: learnSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const m = learnSchema.parse(req.body);
    const marker = `zap:${(m.isrc || `${m.artist ?? ''}-${m.title}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`;
    const existing = await prisma.soundReference.findFirst({ where: { workspaceId, sourceUrl: marker }, select: { id: true } });
    if (existing) return { learned: true, referenceId: existing.id, deduped: true };

    const charge = await app.chargeCredits({ workspaceId, key: 'analyze_audio' });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    const craft = await extractSongCraft({ title: m.title, artist: m.artist, genre: m.genre, releaseDate: m.releaseDate });
    if (!craft?.craft?.length) return reply.code(503).send({ error: 'learn_failed', message: 'Could not extract craft — try again.' });

    const genre = normGenre(craft.genre || m.genre);
    const ref = await prisma.soundReference.create({
      data: {
        workspaceId,
        genre,
        sourceUrl: marker,
        title: `Zap · ${(m.genre || genre || 'song')} lane — "${m.title}" (${m.artist ?? '—'})`,
        recipe: { source: 'zap', title: m.title, artist: m.artist, genre, album: m.album, releaseDate: m.releaseDate, craft: craft.craft, vibe: craft.vibe, bpm: craft.suggestedBpm, mood: craft.mood, languages: craft.languages } as never,
        summary: (craft.whatToLearn || craft.vibe || '').slice(0, 400),
      },
    });
    void prisma.analyticsEvent
      .create({ data: { workspaceId, name: 'zap.learn', properties: { title: m.title, genre } as never } })
      .catch(() => {});
    return { learned: true, referenceId: ref.id, genre, craft: craft.craft, vibe: craft.vibe, whatToLearn: craft.whatToLearn, bpm: craft.suggestedBpm ?? null, mood: craft.mood ?? null, languages: craft.languages ?? null };
  });

  /** HISTORY — everything you've Zapped (button + radar), newest first, so you can
   * SEE what you've learned and make a fresh song in any of those lanes. */
  app.get('/history', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.soundReference.findMany({
      where: { workspaceId, sourceUrl: { startsWith: 'zap:' } },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { id: true, genre: true, summary: true, recipe: true, createdAt: true },
    });
    return rows.map((r) => {
      const rec = (r.recipe ?? {}) as { title?: string; artist?: string; vibe?: string; craft?: string[]; radar?: boolean; bpm?: number; mood?: string; languages?: string[] };
      return {
        id: r.id,
        genre: r.genre,
        // Everything "Make in this lane" needs to auto-produce in the SAME style:
        // the lane's tempo, mood, languages + the artist as a LANE cue (never named
        // in the song). Falls back to the genre's home tempo when a hint is missing.
        bpm: rec.bpm ?? soundBrief(r.genre).typicalBpm ?? 103,
        mood: rec.mood ?? null,
        languages: rec.languages ?? null,
        songTitle: rec.title ?? null,
        artist: rec.artist ?? null,
        vibe: rec.vibe ?? null,
        whatToLearn: r.summary ?? null,
        craft: rec.craft ?? [],
        viaRadar: !!rec.radar,
        at: r.createdAt,
      };
    });
  });

  /** RADAR NOW — run Zap on its own, on demand: pull the charts and learn the
   * craft of new trending songs into the lake. Same thing the daily cron does; this
   * lets the artist top up the lake instantly (capped). Keyless (Apple charts). */
  app.post('/radar', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const GENRES = ['afrobeats', 'amapiano', 'afro_fusion', 'afro_pop', 'street_pop'];
    const MAX = 6;
    let learned = 0;
    const added: Array<{ genre: string; title: string; artist?: string }> = [];
    for (const genre of GENRES) {
      if (learned >= MAX) break;
      const trends = await researchTrends({ genre }).catch(() => null);
      // Only real SONG charts (Apple most-played / YouTube) — never web/news
      // article headlines, which aren't songs and would poison the lake.
      if (!trends || (trends.source !== 'apple_charts' && trends.source !== 'youtube')) continue;
      const songs = (trends.sources ?? [])
        .map((s) => parseTrendSong(s.title))
        .filter((x): x is { title: string; artist: string } => !!x?.artist);
      for (const song of songs) {
        if (learned >= MAX) break;
        const marker = `zap:${`${song.artist ?? ''}-${song.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`;
        if (await prisma.soundReference.findFirst({ where: { workspaceId, sourceUrl: marker }, select: { id: true } })) continue;
        const charge = await app.chargeCredits({ workspaceId, key: 'brief_polish' });
        if (!charge.ok) { learned = MAX; break; }
        const craft = await extractSongCraft({ title: song.title, artist: song.artist, genre });
        if (!craft?.craft?.length) continue;
        await prisma.soundReference
          .create({
            data: {
              workspaceId,
              genre,
              sourceUrl: marker,
              title: `Zap radar · ${genre} lane — "${song.title}" (${song.artist ?? '—'})`,
              recipe: { source: 'zap', radar: true, title: song.title, artist: song.artist, genre, craft: craft.craft, vibe: craft.vibe, bpm: craft.suggestedBpm, mood: craft.mood, languages: craft.languages } as never,
              summary: (craft.whatToLearn || craft.vibe || '').slice(0, 400),
            },
          })
          .catch(() => {});
        learned++;
        added.push({ genre, title: song.title, artist: song.artist });
      }
    }
    return { learned, added };
  });
}

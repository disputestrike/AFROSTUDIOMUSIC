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
import { recognizeSong, generateJson } from '@afrohit/ai';
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

    const craft = await generateJson<{ genre: string; craft: string[]; vibe: string; whatToLearn: string }>({
      system:
        `You are an A&R / producer studying the CRAFT of records. From a song's METADATA ONLY (title, artist, genre, era — NEVER its lyrics or recording), extract the UNCOPYRIGHTABLE craft worth studying: production techniques, groove/pocket, arrangement moves, hook mechanics, energy, what makes this LANE and era of record work. The artist is a LANE REFERENCE ONLY — never to clone, copy melodies/lyrics, or name in any output. Return facts a producer would study to make THEIR OWN fresh record better, not the song itself. Strict JSON only.`,
      user:
        `Song: "${m.title}" by ${m.artist ?? 'unknown'}${m.genre ? ` (${m.genre})` : ''}${m.releaseDate ? `, released ${m.releaseDate}` : ''}.\n` +
        `Return JSON: { "genre": normalized genre, "craft": [4-6 uncopyrightable production/writing techniques of this lane], "vibe": one line, "whatToLearn": one line on what to apply to OUR songs in this lane }.`,
      temperature: 0.6,
      maxTokens: 900,
    });
    if (!craft?.craft?.length) return reply.code(503).send({ error: 'learn_failed', message: 'Could not extract craft — try again.' });

    const genre = normGenre(craft.genre || m.genre);
    const ref = await prisma.soundReference.create({
      data: {
        workspaceId,
        genre,
        sourceUrl: marker,
        title: `Zap · ${(m.genre || genre || 'song')} lane — "${m.title}" (${m.artist ?? '—'})`,
        recipe: { source: 'zap', title: m.title, artist: m.artist, genre, album: m.album, releaseDate: m.releaseDate, craft: craft.craft, vibe: craft.vibe } as never,
        summary: (craft.whatToLearn || craft.vibe || '').slice(0, 400),
      },
    });
    void prisma.analyticsEvent
      .create({ data: { workspaceId, name: 'zap.learn', properties: { title: m.title, genre } as never } })
      .catch(() => {});
    return { learned: true, referenceId: ref.id, genre, craft: craft.craft, vibe: craft.vibe, whatToLearn: craft.whatToLearn };
  });
}

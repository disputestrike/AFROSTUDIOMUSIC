/**
 * ZAP — the real Shazam layer. Hear a song → IDENTIFY it (fingerprint) → PLAY its
 * licensed preview → LEARN its craft into the data lake so it makes our songs
 * better. Identity is retained for display/dedupe only. Training and creation get
 * local genre craft plus numeric facts measured from the official licensed preview;
 * title and artist never enter a provider prompt or generation steering.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { recognizeSong, parseTrendSong, researchTrends } from '@afrohit/ai';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { laneBpm } from '../lib/lane-pipeline';
import { GENRES, genreSignature } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { presignAssetRef, publicUrlFor, verifyUploadedAudio } from '../lib/storage';
import { assertSafeUrl } from '../lib/url-guard';
import { operationErrorBody, runIdempotentOperation } from '../lib/idempotent-operation';

const identifySchema = z.object({ key: z.string().min(4) }).strict();
const learnSchema = z.object({
  /** AudD's LICENSED 30s preview — measured facts-only (real tempo/groove), never stored. */
  previewUrl: z.string().url().optional(),
  title: z.string().min(1).max(200),
  artist: z.string().max(200).optional(),
  genre: z.string().max(60).optional(),
  album: z.string().max(200).optional(),
  releaseDate: z.string().max(40).optional(),
  isrc: z.string().max(40).optional(),
}).strict();

const KNOWN_GENRES = new Set<string>(GENRES);

function normGenre(g?: string | null): string | null {
  if (!g) return null;
  const k = g.toLowerCase().trim().replace(/[\s/-]+/g, '_').replace(/[^a-z_]/g, '');
  if (KNOWN_GENRES.has(k)) return k;
  if (k.includes('afrobeat')) return 'afrobeats';
  if (k.includes('amapiano') || k.includes('piano')) return 'amapiano';
  if (k.includes('hiphop') || k.includes('rap')) return 'hip_hop';
  if (k.includes('rnb') || k.includes('r_b')) return 'rnb';
  if (k.includes('trap')) return 'trap';
  if (k.includes('drill')) return 'drill';
  if (k.includes('dancehall')) return 'dancehall';
  if (k.includes('reggaeton') || k.includes('latin')) return 'reggaeton';
  if (k.includes('reggae')) return 'reggae';
  if (k.includes('house')) return 'house';
  if (k.includes('electro') || k.includes('edm') || k.includes('dance')) return 'edm';
  if (k.includes('gospel') || k.includes('worship') || k.includes('christian')) return 'gospel';
  if (k.includes('highlife')) return 'highlife';
  if (k.includes('soul') || k.includes('funk')) return 'soul';
  if (k.includes('country')) return 'country';
  if (k.includes('rock') || k.includes('metal')) return 'rock';
  if (k.includes('pop')) return 'pop';
  return null;
}

export interface IdentitySafeZapFacts {
  identitySafe: true;
  factBasis: 'genre-signature-v1';
  genre: string;
  craft: string[];
  vibe: string;
  whatToLearn: string;
  suggestedBpm: number;
  mood: null;
  languages: string[];
}

export function identitySafeZapFacts(rawGenre?: string | null): IdentitySafeZapFacts | null {
  const genre = normGenre(rawGenre);
  if (!genre) return null;
  const signature = genreSignature(genre);
  const craft = [
    ...signature.tags.slice(0, 4),
    `arrangement transitions and fills every ${signature.fillBars} bars`,
  ];
  const lane = genre.replace(/_/g, ' ');
  return {
    identitySafe: true,
    factBasis: 'genre-signature-v1',
    genre,
    craft,
    vibe: `${lane} lane: ${signature.tags.slice(0, 3).join(', ')}`,
    whatToLearn: `Apply the ${lane} lane's ${signature.tags.slice(0, 2).join(' and ')} to a fresh original.`,
    suggestedBpm: signature.bpm,
    mood: null,
    languages: [...signature.languages],
  };
}

export default async function zap(app: FastifyInstance) {
  /** IDENTIFY — fingerprint a captured/uploaded clip → title/artist + licensed preview. */
  app.post('/identify', { schema: { body: identifySchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const { key } = identifySchema.parse(req.body);
    const uploaded = await verifyUploadedAudio(workspaceId, key);
    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'zap-identify');
    const charge = await app.chargeCredits({ workspaceId, key: 'analyze_audio', refTable: 'Workspace', refId: workspaceId, idempotencyKey });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
    const operation = await runIdempotentOperation({
      workspaceId,
      kind: 'zap-identify',
      provider: 'audio-recognition',
      idempotencyKey,
      chargeLedgerId: charge.chargeId,
      inputJson: { key: uploaded.key },
      execute: async () => {
    try {
      const url = await presignAssetRef(publicUrlFor(uploaded.key), 900);
      const out = await recognizeSong({ url });
    if (!out.ok) {
      await app.refundCredits({ workspaceId, key: 'analyze_audio', refTable: 'Workspace', refId: workspaceId, chargeId: charge.chargeId });
      return { statusCode: out.error === 'recognition_not_configured' ? 501 as const : 502 as const, body: out };
    }
    if (out.match) {
      await prisma.analyticsEvent
        .create({ data: { workspaceId, name: 'zap.identify', properties: { title: out.match.title, artist: out.match.artist, genre: out.match.genre } as never } })
        .catch(() => {});
      return { statusCode: 200 as const, body: { match: out.match } };
    }
    // AudD heard the clip but matched nothing (common on short/quiet captures, live
    // versions, or very new/underground tracks). Tell the user WHY + how to fix it,
    // instead of a silent "no result" that reads as "it didn't work".
    return {
      statusCode: 200 as const,
      body: {
        match: null,
        hint: 'Heard the clip but could not identify it. Capture ~10-15s of a clear, loud part (ideally the hook), reduce background noise, or upload the audio file directly. Very new/underground tracks may not be in the recognition database.',
      },
    };
    } catch (error) {
      await app.refundCredits({ workspaceId, key: 'analyze_audio', refTable: 'Workspace', refId: workspaceId, chargeId: charge.chargeId });
      throw error;
    }
      },
    });
    if (operation.state !== 'completed') {
      const failure = operationErrorBody(operation);
      return reply.code(failure.statusCode).send(failure.body);
    }
    return reply.code(operation.value.statusCode).send(operation.value.body);
  });

  /** LEARN — retain display identity separately from identity-free lane facts.
   * Provider work receives only the licensed preview URL and numeric/craft facts. */
  app.post('/learn', { schema: { body: learnSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const m = learnSchema.parse(req.body);
    const marker = `zap:${(m.isrc || `${m.artist ?? ''}-${m.title}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`;
    const existing = await prisma.soundReference.findFirst({
      where: { workspaceId, sourceUrl: marker },
      select: { id: true, genre: true, recipe: true, summary: true },
    });
    if (existing) {
      const rec = (existing.recipe ?? {}) as { genre?: string };
      const facts = identitySafeZapFacts(existing.genre ?? rec.genre ?? m.genre);
      return {
        learned: true,
        referenceId: existing.id,
        deduped: true,
        genre: facts?.genre ?? existing.genre,
        craft: facts?.craft ?? [],
        vibe: facts?.vibe ?? null,
        whatToLearn: facts?.whatToLearn ?? existing.summary,
        bpm: facts?.suggestedBpm ?? null,
        mood: null,
        languages: facts?.languages ?? null,
        measurementQueued: false,
      };
    }

    const facts = identitySafeZapFacts(m.genre);
    if (!facts) {
      return reply.code(422).send({
        error: 'lane_unresolved',
        needsGenre: true,
        options: [...GENRES],
        message: 'Choose a genre before adding this Zap to training; identity is never used to guess the lane.',
      });
    }

    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'zap-learn');
    const charge = await app.chargeCredits({ workspaceId, key: 'analyze_audio', refTable: 'Workspace', refId: workspaceId, idempotencyKey });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    const operation = await runIdempotentOperation({
      workspaceId,
      kind: 'zap-learn',
      provider: 'internal',
      idempotencyKey,
      chargeLedgerId: charge.chargeId,
      inputJson: {
        genre: facts.genre,
        factBasis: facts.factBasis,
        previewAvailable: !!m.previewUrl,
      },
      execute: async () => {
    try {
    const ref = await prisma.soundReference.create({
      data: {
        workspaceId,
        genre: facts.genre,
        sourceUrl: marker,
        title: `Zap · ${facts.genre} lane — "${m.title}" (${m.artist ?? '—'})`,
        recipe: {
          source: 'zap',
          title: m.title,
          artist: m.artist,
          genre: facts.genre,
          album: m.album,
          releaseDate: m.releaseDate,
          identitySafe: facts.identitySafe,
          factBasis: facts.factBasis,
          craft: facts.craft,
          vibe: facts.vibe,
          bpm: facts.suggestedBpm,
          mood: facts.mood,
          languages: facts.languages,
        } as never,
        summary: facts.whatToLearn.slice(0, 400),
        analysisState: 'inferred',
        rightsBasis: 'facts-only',
      },
    });
    // MEASURE THE LICENSED PREVIEW (facts, never expression): AudD's official
    // 30s preview is legally obtained — the ear reads its REAL tempo/groove into
    // recipe.measured so "make in this lane" matches the actual record's speed,
    // not an LLM's guess. The preview is never stored; only numbers land.
    let measurementQueued = false;
    if (m.previewUrl) {
      const safe = await assertSafeUrl(m.previewUrl);
      if (safe.ok) {
        await createQueuedProviderJob({
          app,
          queue: app.queues.lake,
          jobName: 'deep-measure',
          workspaceId,
          kind: 'lake',
          provider: 'internal',
          inputJson: { referenceId: ref.id, source: 'licensed-preview' },
          idempotencyKey: `zap-measure:${ref.id}`,
          payload: (jobId) => ({ jobId, referenceId: ref.id, url: m.previewUrl!, workspaceId }),
        });
        measurementQueued = true;
      }
    }
    await prisma.analyticsEvent
      .create({ data: { workspaceId, name: 'zap.learn', properties: { title: m.title, genre: facts.genre, measuredPreview: measurementQueued } as never } })
      .catch(() => {});
    return {
      statusCode: 200 as const,
      body: {
        learned: true,
        referenceId: ref.id,
        genre: facts.genre,
        craft: facts.craft,
        vibe: facts.vibe,
        whatToLearn: facts.whatToLearn,
        bpm: facts.suggestedBpm,
        mood: facts.mood,
        languages: facts.languages,
        measurementQueued,
      },
    };
    } catch (error) {
      await app.refundCredits({ workspaceId, key: 'analyze_audio', refTable: 'Workspace', refId: workspaceId, chargeId: charge.chargeId });
      throw error;
    }
      },
    });
    if (operation.state !== 'completed') {
      const failure = operationErrorBody(operation);
      return reply.code(failure.statusCode).send(failure.body);
    }
    return reply.code(operation.value.statusCode).send(operation.value.body);
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
    return rows.map((r: { id: string; genre: string | null; summary: string | null; recipe: unknown; createdAt: Date }) => {
      const rec = (r.recipe ?? {}) as {
        title?: string;
        artist?: string;
        genre?: string;
        radar?: boolean;
        bpm?: number;
        mood?: string;
        languages?: string[];
        identitySafe?: boolean;
        measured?: { tempoBpm?: { value?: number } };
      };
      const facts = identitySafeZapFacts(r.genre ?? rec.genre);
      const measuredBpm = rec.measured?.tempoBpm?.value;
      return {
        id: r.id,
        genre: facts?.genre ?? r.genre,
        // Display identity stays in history. Creation facts are separately
        // rebuilt from DSP measurements and the identity-free genre signature.
        bpm: measuredBpm ?? (rec.identitySafe ? rec.bpm : undefined) ?? facts?.suggestedBpm ?? laneBpm(r.genre) ?? 103,
        mood: rec.identitySafe ? rec.mood ?? null : null,
        languages: rec.identitySafe ? rec.languages ?? facts?.languages ?? null : facts?.languages ?? null,
        songTitle: rec.title ?? null,
        artist: rec.artist ?? null,
        vibe: facts?.vibe ?? null,
        whatToLearn: facts?.whatToLearn ?? null,
        craft: facts?.craft ?? [],
        viaRadar: !!rec.radar,
        at: r.createdAt,
      };
    });
  });

  /** LANE BRIEF — identity-free creation params for a Zap reference. Measured
   * preview tempo wins; all fallback craft comes from the local genre signature. */
  app.post('/lane-brief', async (req, reply) => {
    const { referenceId } = z.object({ referenceId: z.string().min(6) }).strict().parse(req.body);
    const { workspaceId } = requireAuth(req);
    const ref = await prisma.soundReference.findFirst({
      where: {
        id: referenceId,
        workspaceId,
        active: true,
        analysisState: { not: 'failed' },
        rightsBasis: 'facts-only',
        sourceUrl: { startsWith: 'zap:' },
      },
    });
    if (!ref) return reply.code(404).send({ error: 'reference_not_found' });
    const rec = (ref.recipe ?? {}) as {
      genre?: string;
      identitySafe?: boolean;
      factBasis?: string;
      measured?: { tempoBpm?: { value?: number } };
      [key: string]: unknown;
    };
    const facts = identitySafeZapFacts(ref.genre ?? rec.genre);
    if (!facts) {
      return reply.code(422).send({
        error: 'lane_unresolved',
        needsGenre: true,
        options: [...GENRES],
        message: 'Could not resolve this Zap lane without using song identity; choose a genre explicitly.',
      });
    }
    if (rec.identitySafe !== true || rec.factBasis !== facts.factBasis) {
      await prisma.soundReference
        .update({
          where: { id: ref.id },
          data: {
            genre: facts.genre,
            recipe: {
              ...rec,
              genre: facts.genre,
              identitySafe: facts.identitySafe,
              factBasis: facts.factBasis,
              craft: facts.craft,
              vibe: facts.vibe,
              bpm: facts.suggestedBpm,
              mood: facts.mood,
              languages: facts.languages,
            } as never,
          },
        })
        .catch(() => {});
    }
    const measuredBpm = rec.measured?.tempoBpm?.value;
    return {
      genre: facts.genre,
      bpm: measuredBpm ?? facts.suggestedBpm,
      mood: facts.mood,
      languages: facts.languages,
      influence: null,
      vibe: facts.vibe.slice(0, 240),
      factSource: measuredBpm ? 'measured-preview' : facts.factBasis,
    };
  });

  /** RADAR NOW — pull chart identities for display/dedupe, then attach only the
   * identity-free local craft facts for each known genre (capped). */
  app.post('/radar', async (req) => {
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
        const idempotencyKey = `zap-radar:${marker}`;
        const charge = await app.chargeCredits({ workspaceId, key: 'brief_polish', refTable: 'Workspace', refId: workspaceId, idempotencyKey });
        if (!charge.ok) { learned = MAX; break; }
        const facts = identitySafeZapFacts(genre);
        if (!facts) {
          await app.refundCredits({ workspaceId, key: 'brief_polish', refTable: 'Workspace', refId: workspaceId, chargeId: charge.chargeId });
          continue;
        }
        try {
          await prisma.soundReference.create({
            data: {
              workspaceId,
              genre,
              sourceUrl: marker,
              title: `Zap radar · ${genre} lane — "${song.title}" (${song.artist ?? '—'})`,
              recipe: {
                source: 'zap',
                radar: true,
                title: song.title,
                artist: song.artist,
                genre: facts.genre,
                identitySafe: facts.identitySafe,
                factBasis: facts.factBasis,
                craft: facts.craft,
                vibe: facts.vibe,
                bpm: facts.suggestedBpm,
                mood: facts.mood,
                languages: facts.languages,
              } as never,
              summary: facts.whatToLearn.slice(0, 400),
              analysisState: 'inferred',
              rightsBasis: 'facts-only',
            },
          });
        } catch {
          await app.refundCredits({ workspaceId, key: 'brief_polish', refTable: 'Workspace', refId: workspaceId, chargeId: charge.chargeId });
          continue;
        }
        learned++;
        added.push({ genre, title: song.title, artist: song.artist });
      }
    }
    return { learned, added };
  });
}

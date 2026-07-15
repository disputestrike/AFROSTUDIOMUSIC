import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { dropBatchSchema, learnedGenreMatches } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { isCertifiedPlayableAsset } from './drop';

const ALBUM_SONG_ENGINES = ['suno', 'eleven', 'ace_step', 'minimax'] as const;
type AlbumSongEngine = (typeof ALBUM_SONG_ENGINES)[number];
type AlbumDropInput = ReturnType<typeof dropBatchSchema.parse>;

type CertifiableAlbumAsset = {
  createdAt: Date;
  url: string;
  approved: boolean;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: Date | null;
};

export function selectCertifiedAlbumAsset<T extends CertifiableAlbumAsset>(assets: T[]): T | undefined {
  return assets
    .filter(isCertifiedPlayableAsset)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .at(-1);
}

type AlbumReference = {
  id: string;
  workspaceId: string;
  sourceUrl: string;
  genre: string | null;
  active: boolean;
  analysisState: string;
  rightsBasis: string;
};

type AlbumReferenceUsage = {
  id: string;
  referenceId: string;
  pinned: boolean;
  reference: AlbumReference;
};

type AlbumMaterialUsage = {
  id: string;
  materialId: string;
  material: { id: string; role: string };
};

type AlbumBeat = CertifiableAlbumAsset & {
  id: string;
  bpm: number | null;
  provider: string;
  meta: unknown;
  referenceUsages: AlbumReferenceUsage[];
  materialUsages: AlbumMaterialUsage[];
};

type AlbumMix = CertifiableAlbumAsset & {
  id: string;
  meta: unknown;
  settings: unknown;
};

type AlbumMaster = CertifiableAlbumAsset & {
  id: string;
  mixId: string | null;
  meta: unknown;
  mix: AlbumMix | null;
};

type AlbumPlayable =
  | (AlbumBeat & { assetType: 'beat' })
  | (AlbumMix & { assetType: 'mix' })
  | (AlbumMaster & { assetType: 'master' });

type AlbumLineage = {
  beatId: string | null;
  beatContentHash: string | null;
  vocalRenderIds: string[];
};

const albumRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

function mixLineage(mix: AlbumMix): AlbumLineage {
  const meta = albumRecord(mix.meta);
  const source = albumRecord(meta.source);
  const sourceAsset = albumRecord(meta.sourceAsset);
  const settings = Array.isArray(mix.settings) ? mix.settings.map(albumRecord) : [];
  const settingsBeat = settings.find((entry) => entry.kind === 'beat' && typeof entry.id === 'string');
  return {
    beatId: typeof source.beatId === 'string'
      ? source.beatId
      : sourceAsset.type === 'beat' && typeof sourceAsset.id === 'string'
        ? sourceAsset.id
        : typeof settingsBeat?.id === 'string'
          ? settingsBeat.id
          : null,
    beatContentHash: typeof meta.sourceContentHash === 'string' ? meta.sourceContentHash : null,
    vocalRenderIds: Array.isArray(source.vocalRenderIds)
      ? source.vocalRenderIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

function playableLineage(playable: AlbumPlayable): AlbumLineage | null {
  if (playable.assetType === 'beat') {
    return { beatId: playable.id, beatContentHash: playable.contentHash, vocalRenderIds: [] };
  }
  if (playable.assetType === 'mix') return mixLineage(playable);
  if (playable.mix && isCertifiedPlayableAsset(playable.mix)) return mixLineage(playable.mix);
  const sourceAsset = albumRecord(albumRecord(playable.meta).sourceAsset);
  return sourceAsset.type === 'beat' && typeof sourceAsset.id === 'string'
    ? { beatId: sourceAsset.id, beatContentHash: null, vocalRenderIds: [] }
    : null;
}

type AlbumAnchorBindingRequest = {
  genre: string;
  bpm: number;
  provider: string | null;
  pinnedReferenceId: string | null;
  requiresExactVoice: boolean;
  voiceProfileId: string | null;
  styleBrief: string;
  requestedTheme?: string;
  languages: string[];
  materialRoles: string[];
};

type AlbumAnchorBinding =
  | { ok: true; input: AlbumDropInput; engine: AlbumSongEngine }
  | { ok: false; error: string; message: string };

/** Pure fail-closed binding policy shared with the focused regression test. */
export function bindAlbumDropInput(request: AlbumAnchorBindingRequest): AlbumAnchorBinding {
  if (!request.genre.trim() || !request.styleBrief.trim()) {
    return {
      ok: false,
      error: 'anchor_style_unavailable',
      message: 'The anchor has no complete measured style brief. No album track was queued.',
    };
  }
  if (!Number.isFinite(request.bpm) || request.bpm < 60 || request.bpm > 180) {
    return {
      ok: false,
      error: 'anchor_tempo_unavailable',
      message: 'The anchor has no measured reproducible tempo. No album track was queued.',
    };
  }
  if (request.requiresExactVoice) {
    return {
      ok: false,
      error: request.voiceProfileId ? 'anchor_voice_profile_unsupported' : 'anchor_voice_identity_unsupported',
      message: request.voiceProfileId
        ? 'This anchor uses a specific voice profile, but Drop cannot bind a voice profile yet. No album track was queued.'
        : 'This anchor uses a specific recorded vocal, but Drop cannot bind that performance identity yet. No album track was queued.',
    };
  }

  const engine = ALBUM_SONG_ENGINES.find((candidate) => candidate === request.provider);
  if (!engine) {
    return {
      ok: false,
      error: 'anchor_engine_unsupported',
      message: 'The anchor render engine cannot be reproduced by the vocal Drop path. No album track was queued.',
    };
  }
  if (!request.pinnedReferenceId) {
    return {
      ok: false,
      error: 'anchor_reference_unavailable',
      message: 'The anchor has no usable exact sound reference to pin. No album track was queued.',
    };
  }

  const languages = [...new Set(request.languages)]
    .filter((language) => language.length >= 2 && language.length <= 12)
    .slice(0, 5);
  const instruments = [...new Set(request.materialRoles.map((role) => role.replace(/_/g, ' ')))]
    .filter((role) => role.length >= 2 && role.length <= 32)
    .slice(0, 8);
  const styleBrief = request.styleBrief.trim().slice(0, 1500);
  const nextTheme = (request.requestedTheme?.trim()
    || 'a fresh song in this vocal direction and production lane, with a new story').slice(0, 300);
  const vibe = [
    styleBrief,
    instruments.length ? `Anchor instrumentation: ${instruments.join(', ')}.` : '',
  ].filter(Boolean).join('\n').slice(0, 500);

  return {
    ok: true,
    engine,
    input: dropBatchSchema.parse({
      theme: `${styleBrief}\n\nNEXT ALBUM TRACK: ${nextTheme}`.slice(0, 2000),
      vibe: vibe || undefined,
      count: 1,
      genre: request.genre,
      bpm: request.bpm,
      withVocals: true,
      songEngine: engine,
      pinnedReferenceId: request.pinnedReferenceId,
      ...(languages.length ? { languages } : {}),
      ...(instruments.length ? { instruments } : {}),
    }),
  };
}

/**
 * ALBUMS — anchored to ONE song's sound.
 *
 * "I got a song I really like → build an album of that song, that style, that
 * flow." The anchor song's engine, genre, bpm, hook style and vocal direction
 * are distilled into a styleBrief; every "next track" generates INSIDE that
 * lane so the album holds one voice and one flow.
 */
export default async function albums(app: FastifyInstance) {
  /** List albums with their songs (newest first). */
  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.album.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        songs: {
          orderBy: { createdAt: 'asc' },
          include: {
            masters: {
              where: { approved: true, qualityState: 'passed', contentHash: { not: null }, verifiedAt: { not: null } },
              orderBy: { createdAt: 'desc' }, take: 1,
              select: { createdAt: true, url: true, approved: true, qualityState: true, contentHash: true, verifiedAt: true },
            },
            mixes: {
              where: { approved: true, qualityState: 'passed', contentHash: { not: null }, verifiedAt: { not: null } },
              orderBy: { createdAt: 'desc' }, take: 1,
              select: { createdAt: true, url: true, approved: true, qualityState: true, contentHash: true, verifiedAt: true },
            },
            beats: {
              where: { approved: true, qualityState: 'passed', contentHash: { not: null }, verifiedAt: { not: null } },
              orderBy: { createdAt: 'desc' }, take: 1,
              select: { createdAt: true, url: true, approved: true, qualityState: true, contentHash: true, verifiedAt: true },
            },
            lyric: { select: { title: true } },
          },
        },
      },
    });
    type AlbumSongRow = {
      id: string; title: string | null; status: string; projectId: string;
      masters: CertifiableAlbumAsset[]; mixes: CertifiableAlbumAsset[]; beats: CertifiableAlbumAsset[];
      lyric: { title: string | null } | null;
    };
    type AlbumRow = {
      id: string; title: string; anchorSongId: string | null; styleBrief: unknown; createdAt: Date;
      songs: AlbumSongRow[];
    };
    return rows.map((a: AlbumRow) => ({
      id: a.id,
      title: a.title,
      anchorSongId: a.anchorSongId,
      styleBrief: a.styleBrief,
      createdAt: a.createdAt,
      songs: a.songs.map((s) => {
        const playable = selectCertifiedAlbumAsset([...s.masters, ...s.mixes, ...s.beats]);
        return {
          id: s.id,
          title: s.lyric?.title || s.title,
          status: s.status,
          projectId: s.projectId,
          audioUrl: playable?.url ?? null,
          playable: !!playable,
          completionStatus: playable ? 'certified' : 'pending',
          isAnchor: s.id === a.anchorSongId,
        };
      }),
    }));
  });

  /** Start an album FROM a song — the anchor defines the sound. */
  const createSchema = z.object({ anchorSongId: z.string().cuid(), title: z.string().max(120).optional() });
  app.post('/', { schema: { body: createSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const { anchorSongId, title } = createSchema.parse(req.body);
    const anchor = await prisma.song.findFirst({
      where: { id: anchorSongId, workspaceId },
      include: {
        project: { include: { artist: true } },
        lyric: true,
        hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!anchor) return reply.code(404).send({ error: 'song_not_found' });

    // Distill the anchor's sound into a directive every album track will follow.
    const styleBrief = [
      `ALBUM STYLE ANCHOR — every track must hold this production lane and vocal direction while remaining a fresh song:`,
      `Genre: ${anchor.project.genre}${anchor.project.bpm ? ` at ~${anchor.project.bpm} bpm` : ''}..`,
      anchor.project.artist.vocalTone?.length ? `Vocal direction: ${anchor.project.artist.vocalTone.join(', ')}.` : '',
      anchor.hooks[0] ? `Hook style reference (the FEEL, never reuse the words): "${anchor.hooks[0].text.split('\n')[0]!.slice(0, 90)}"` : '',
      anchor.lyric?.languageMix ? `Language mix: ${JSON.stringify(anchor.lyric.languageMix)}.` : '',
    ].filter(Boolean).join('\n');

    const album = await prisma.album.create({
      data: {
        workspaceId,
        title: title || `${anchor.lyric?.title || anchor.title} — the album`,
        anchorSongId: anchor.id,
        styleBrief,
      },
    });
    await prisma.song.update({ where: { id: anchor.id }, data: { albumId: album.id } });
    reply.code(201);
    return { id: album.id, title: album.title };
  });

  /** Add an existing song to an album. */
  const addSchema = z.object({ songId: z.string().cuid() });
  app.post<{ Params: { albumId: string } }>('/:albumId/add', { schema: { body: addSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const { songId } = addSchema.parse(req.body);
    const album = await prisma.album.findFirst({ where: { id: req.params.albumId, workspaceId }, select: { id: true } });
    if (!album) return reply.code(404).send({ error: 'album_not_found' });
    const updated = await prisma.song.updateMany({ where: { id: songId, workspaceId }, data: { albumId: album.id } });
    if (updated.count === 0) return reply.code(404).send({ error: 'song_not_found' });
    return { ok: true };
  });

  /** Generate the NEXT track in this album's style. Async: 202 + jobId, poll /jobs/:id. */
  const nextSchema = z.object({ theme: z.string().max(300).optional() });
  app.post<{ Params: { albumId: string } }>('/:albumId/next', { schema: { body: nextSchema } }, async (req, reply) => {
    const { workspaceId, userId } = requireAuth(req);
    const { theme } = nextSchema.parse(req.body);
    const album = await prisma.album.findFirst({ where: { id: req.params.albumId, workspaceId } });
    if (!album) return reply.code(404).send({ error: 'album_not_found' });
    const anchor = album.anchorSongId
      ? await prisma.song.findFirst({
          where: { id: album.anchorSongId, workspaceId },
          include: {
            project: { include: { artist: { select: { languages: true } } } },
            lyric: { select: { languageMix: true } },
            masters: {
              where: { approved: true, qualityState: 'passed', contentHash: { not: null }, verifiedAt: { not: null } },
              orderBy: { createdAt: 'desc' }, take: 1,
              select: {
                id: true, url: true, createdAt: true, approved: true, qualityState: true,
                contentHash: true, verifiedAt: true, mixId: true, meta: true,
                mix: {
                  select: {
                    id: true, url: true, createdAt: true, approved: true, qualityState: true,
                    contentHash: true, verifiedAt: true, meta: true, settings: true,
                  },
                },
              },
            },
            mixes: {
              where: { approved: true, qualityState: 'passed', contentHash: { not: null }, verifiedAt: { not: null } },
              orderBy: { createdAt: 'desc' }, take: 1,
              select: {
                id: true, url: true, createdAt: true, approved: true, qualityState: true,
                contentHash: true, verifiedAt: true, meta: true, settings: true,
              },
            },
            beats: {
              where: { qualityState: 'passed', contentHash: { not: null }, verifiedAt: { not: null } },
              orderBy: { createdAt: 'desc' }, take: 1,
              include: {
                referenceUsages: {
                  orderBy: [{ pinned: 'desc' }, { position: 'asc' }],
                  include: {
                    reference: {
                      select: {
                        id: true, workspaceId: true, sourceUrl: true, genre: true,
                        active: true, analysisState: true, rightsBasis: true,
                      },
                    },
                  },
                },
                materialUsages: {
                  orderBy: { createdAt: 'asc' },
                  include: { material: { select: { id: true, role: true } } },
                },
              },
            },
          },
        })
      : null;
    if (!anchor) return reply.code(400).send({ error: 'no_anchor', message: 'This album has no anchor song to take its style from.' });

    const beats = anchor.beats as AlbumBeat[];
    const mixes = anchor.mixes as AlbumMix[];
    const masters = anchor.masters as AlbumMaster[];
    const playable = selectCertifiedAlbumAsset<AlbumPlayable>([
      ...masters.map((asset) => ({ ...asset, assetType: 'master' as const })),
      ...mixes.map((asset) => ({ ...asset, assetType: 'mix' as const })),
      ...beats.map((asset) => ({ ...asset, assetType: 'beat' as const })),
    ]);
    if (!playable) {
      return reply.code(409).send({ error: 'anchor_not_playable', message: 'The anchor has no certified playable audio. No album track was queued.' });
    }

    const lineage = playableLineage(playable);
    if (!lineage || (!lineage.beatId && !lineage.beatContentHash)) {
      return reply.code(409).send({
        error: 'anchor_lineage_unresolved',
        message: 'The certified anchor cannot be tied to one exact source beat. No album track was queued.',
      });
    }

    const beat = playable.assetType === 'beat'
      ? playable
      : await prisma.beatAsset.findFirst({
          where: {
            projectId: anchor.projectId,
            songId: anchor.id,
            qualityState: 'passed',
            contentHash: { not: null },
            verifiedAt: { not: null },
            ...(lineage.beatId
              ? { id: lineage.beatId }
              : { contentHash: lineage.beatContentHash! }),
          },
          include: {
            referenceUsages: {
              orderBy: [{ pinned: 'desc' }, { position: 'asc' }],
              include: {
                reference: {
                  select: {
                    id: true, workspaceId: true, sourceUrl: true, genre: true,
                    active: true, analysisState: true, rightsBasis: true,
                  },
                },
              },
            },
            materialUsages: {
              orderBy: { createdAt: 'asc' },
              include: { material: { select: { id: true, role: true } } },
            },
          },
        }) as AlbumBeat | null;
    if (!beat) {
      return reply.code(409).send({
        error: 'anchor_lineage_source_missing',
        message: 'The certified anchor source evidence is unavailable. No album track was queued.',
      });
    }

    const reusableReference = (reference: AlbumReference) => reference.workspaceId === workspaceId
      && reference.active
      && reference.analysisState !== 'failed'
      && ['user-attested', 'self-generated'].includes(reference.rightsBasis)
      && learnedGenreMatches(reference.genre, anchor.project.genre);
    const provenanceUsage = beat.referenceUsages.find(
      (usage) => usage.pinned && reusableReference(usage.reference)
    );
    const anchorUrls = [...new Set([playable.url, beat.url])];
    const exactReferences = await prisma.soundReference.findMany({
      where: {
        workspaceId,
        sourceUrl: { in: anchorUrls },
        active: true,
        analysisState: { not: 'failed' },
        rightsBasis: { in: ['user-attested', 'self-generated'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, workspaceId: true, sourceUrl: true, genre: true, active: true, analysisState: true, rightsBasis: true },
    });
    const exactReference = exactReferences.find(reusableReference);
    const pinnedReference = exactReference ?? provenanceUsage?.reference ?? null;
    const languageMix = (anchor.lyric?.languageMix ?? {}) as Record<string, unknown>;
    const languages = Object.entries(languageMix)
      .filter(([, share]) => typeof share === 'number' && share > 0)
      .map(([language]) => language);
    const materialRoles = beat.materialUsages.map((usage) => usage.material.role);
    const anchorBpm = anchor.project.bpm ?? beat.bpm;
    if (anchorBpm == null) {
      return reply.code(409).send({
        error: 'anchor_tempo_unavailable',
        message: 'The anchor has no measured reproducible tempo. No album track was queued.',
      });
    }
    const binding = bindAlbumDropInput({
      genre: anchor.project.genre,
      bpm: anchorBpm,
      provider: beat.provider,
      pinnedReferenceId: pinnedReference?.id ?? null,
      requiresExactVoice: lineage.vocalRenderIds.length > 0,
      voiceProfileId: null,
      styleBrief: typeof album.styleBrief === 'string' ? album.styleBrief : '',
      requestedTheme: theme,
      languages: languages.length ? languages : anchor.project.artist.languages,
      materialRoles,
    });
    if (!binding.ok) return reply.code(409).send({ error: binding.error, message: binding.message });
    const input = binding.input;

    const anchorIdentity = {
      songId: anchor.id,
      projectId: anchor.projectId,
      playable: {
        assetType: playable.assetType,
        assetId: playable.id,
        url: playable.url,
        contentHash: playable.contentHash,
        verifiedAt: playable.verifiedAt!.toISOString(),
      },
      voice: {
        mode: 'provider-vocal-direction',
        voiceProfileId: null,
        provider: binding.engine,
      },
      reference: {
        id: pinnedReference!.id,
        source: exactReference ? 'anchor-audio' : 'anchor-render-provenance',
        usageId: exactReference ? null : provenanceUsage?.id ?? null,
      },
      style: {
        genre: anchor.project.genre,
        bpm: input.bpm,
        engine: binding.engine,
        styleBrief: typeof album.styleBrief === 'string' ? album.styleBrief.slice(0, 1500) : '',
      },
      provenance: {
        beatId: beat.id,
        referenceUsageIds: beat.referenceUsages.map((usage) => usage.id),
        referenceIds: beat.referenceUsages.map((usage) => usage.referenceId),
        materialUsageIds: beat.materialUsages.map((usage) => usage.id),
        materialIds: beat.materialUsages.map((usage) => usage.materialId),
        materialRoles,
      },
    };

    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, `album-next:${album.id}`);
    const dropJob = await createQueuedProviderJob({
      app,
      queue: app.queues.orchestration,
      jobName: 'run-drop',
      workspaceId,
      projectId: anchor.projectId,
      kind: 'drop',
      provider: 'internal',
      inputJson: { ...input, albumId: album.id, anchorIdentity },
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId, userId, projectId: anchor.projectId, input, albumId: album.id, anchorIdentity }),
    });

    reply.code(202);
    return { jobId: dropJob.jobId, status: 'queued', albumId: album.id, replayed: dropJob.replayed };
  });

  /** Delete an album (songs keep existing — only the grouping dies). */
  app.delete<{ Params: { albumId: string } }>('/:albumId', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    await prisma.album.deleteMany({ where: { id: req.params.albumId, workspaceId } });
    reply.code(204);
    return null;
  });
}

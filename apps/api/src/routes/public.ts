import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { presignAssetRef } from '../lib/storage';
import { orderFeaturedFirst, readFeaturedSongIds } from '../lib/landing-featured';
import { currentPlayableAsset } from '../lib/current-playable-asset';

/**
 * Public release page data (the pre-save / smart-link catch-page). No workspace
 * scoping — a fan clicking a shared link isn't logged in. Returns only
 * public-safe fields. This is what catches the traffic a snippet drives so the
 * attention doesn't leak.
 */
export default async function publicRoutes(app: FastifyInstance) {
  /**
   * The landing-page song wall. Owner-FEATURED records first (hand-picked REAL
   * songs the house pins — e.g. A.I Baddie — curated order preserved), then up
   * to 12 REAL, releaseReady songs. The studio demos itself with real records,
   * never placeholders. Gate: !quarantined && !deleted, and a playable approved
   * master/mix must exist (a wall card you can't press play on is a dead card —
   * that null-drop below is also what keeps a featured-but-audioless song off
   * the wall). Only public-safe fields leave: no workspace ids, no internals.
   */
  app.get('/trending', async (_req, reply) => {
    const wallInclude = {
      project: { include: { artist: true } },
      masters: { orderBy: { createdAt: 'desc' }, take: 20 },
      mixes: { orderBy: { createdAt: 'desc' }, take: 20 },
      beats: { orderBy: { createdAt: 'desc' }, take: 20 },
    } as const;
    const featuredIds = await readFeaturedSongIds();
    const [featured, trending] = await Promise.all([
      featuredIds.length
        ? prisma.song.findMany({
            where: { id: { in: featuredIds }, quarantined: false, deletedAt: null },
            include: wallInclude,
          })
        : Promise.resolve([]),
      prisma.song.findMany({
        where: { releaseReady: true, quarantined: false, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 24, // over-fetch; songs without a playable asset are dropped below
        include: wallInclude,
      }),
    ]);
    const songs = orderFeaturedFirst(featuredIds, featured, trending);

    const cards = await Promise.all(
      songs.map(async (song) => {
        // THE SAME PLAYABLE-ASSET LAW the catalog plays by — a featured full
        // song whose audio lives as a generated render (not a formal master)
        // still plays; the wall and the catalog can never disagree on what a
        // song sounds like.
        const current = currentPlayableAsset(song);
        const cover = await prisma.imageAsset.findFirst({
          where: { projectId: song.projectId, kind: 'cover', approved: true },
          orderBy: { createdAt: 'desc' },
        });
        const streamRef = current?.url;
        if (!streamRef) return null;
        const [coverUrl, streamUrl] = await Promise.all([
          cover?.url ? presignAssetRef(cover.url, 900) : null,
          presignAssetRef(streamRef, 900),
        ]);
        return {
          id: song.id,
          title: song.title,
          artist: song.project.artist.stageName,
          genre: song.project.genre,
          coverUrl,
          streamUrl,
        };
      }),
    );

    reply.header('cache-control', 'public, max-age=60');
    return { songs: cards.filter((c): c is NonNullable<typeof c> => c !== null).slice(0, 12) };
  });

  app.get<{ Params: { songId: string } }>('/song/:songId', async (req, reply) => {
    const song = await prisma.song.findUnique({
      where: { id: req.params.songId },
      include: { project: { include: { artist: true } }, lyric: true },
    });
    // Only expose songs the artist has green-lit (audit: an unauthenticated,
    // un-scoped endpoint was leaking title/artist/cover/ISRC for ANY song id in
    // ANY workspace). An unreleased song is 404 to the public.
    if (!song || !song.releaseReady || song.status !== 'RELEASED' || song.quarantined) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const [master, mix, cover, snippet] = await Promise.all([
      prisma.master.findFirst({ where: { songId: song.id, approved: true }, orderBy: { createdAt: 'desc' } }),
      prisma.mix.findFirst({ where: { songId: song.id, approved: true }, orderBy: { createdAt: 'desc' } }),
      prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover', approved: true }, orderBy: { createdAt: 'desc' } }),
      prisma.videoRender.findFirst({ where: { projectId: song.projectId, provider: 'snippet', approved: true }, orderBy: { createdAt: 'desc' } }),
    ]);

    const [coverUrl, streamUrl, snippetUrl] = await Promise.all([
      cover?.url ? presignAssetRef(cover.url, 900) : null,
      song.releaseReady && (master?.url || mix?.url) ? presignAssetRef(master?.url ?? mix!.url, 900) : null,
      snippet?.url ? presignAssetRef(snippet.url, 900) : null,
    ]);

    // Only released rows receive short-lived streaming capabilities. The
    // stable private object references never leave the API.
    reply.header('cache-control', 'public, max-age=60');
    return {
      id: song.id,
      title: song.title,
      artist: song.project.artist.stageName,
      genre: song.project.genre,
      coverUrl,
      streamUrl,
      snippetUrl,
      isrc: song.isrc ?? null,
      releaseReady: song.releaseReady,
    };
  });

  /**
   * THE RELEASE PAGE payload — the full public destination a short/social link
   * points at (Phase 4). Everything the studio made for THIS song, gathered for
   * one shareable page: cover, master audio, the music video (or the visualizer
   * that always exists), the short clips, the lyric video, the verbatim lyrics
   * (vocal songs only), and the "what this song is about" story + hook from the
   * release kit.
   *
   * SAME VISIBILITY GATE as /song/:songId above — a song is public ONLY when the
   * owner green-lit it (releaseReady) AND a distributor event moved it to
   * RELEASED AND it is not quarantined. An unreleased, private, or quarantined
   * song is 404 to the public, no matter the id. Nothing workspace-internal
   * leaves: no workspace/project ids, no costs, no other tenant's rows, no
   * sibling songs. Every asset is presigned for short-lived public read; a
   * private s3:// reference never reaches the page.
   */
  app.get<{ Params: { songId: string } }>('/song/:songId/release', async (req, reply) => {
    const song = await prisma.song.findUnique({
      where: { id: req.params.songId },
      include: {
        project: { include: { artist: true } },
        lyric: true,
        masters: { orderBy: { createdAt: 'desc' }, take: 20 },
        mixes: { orderBy: { createdAt: 'desc' }, take: 20 },
        beats: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!song || !song.releaseReady || song.status !== 'RELEASED' || song.quarantined) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const asRecord = (value: unknown): Record<string, unknown> =>
      value != null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    // The master music video — the ONE assembled full cut for this song's
    // concept (resolved the same way the catalog card does: newest assembled
    // cut wins, a full cut outranks a teaser). Absent for audio-only releases,
    // where the auto-generated visualizer becomes the primary visual.
    const concept = await prisma.videoConcept.findFirst({
      where: { songId: song.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    let musicVideoRef: string | null = null;
    if (concept) {
      const renders = await prisma.videoRender.findMany({
        where: { conceptId: concept.id },
        orderBy: { createdAt: 'asc' },
        select: { url: true, meta: true },
      });
      let bestKind: 'full' | 'teaser' | null = null;
      for (const r of renders) {
        const assembly = asRecord(asRecord(r.meta).assembly);
        if (!Object.keys(assembly).length) continue; // only assembled cuts, never a per-shot render
        const kind = assembly.kind === 'teaser' ? ('teaser' as const) : ('full' as const);
        if (bestKind === 'full' && kind === 'teaser') continue;
        bestKind = kind;
        musicVideoRef = r.url;
      }
    }

    // The auto-visuals (lyric video + audio-reactive visualizer) built off the
    // master audio + lyrics + cover — the shareables that exist without a video.
    const visuals = await prisma.songVisual.findMany({
      where: { songId: song.id },
      orderBy: { createdAt: 'desc' },
      select: { kind: true, url: true },
    });
    const visualizerRef = visuals.find((v) => v.kind === 'visualizer')?.url ?? null;
    const lyricVideoRef = visuals.find((v) => v.kind === 'lyric_video')?.url ?? null;

    // A few hook-first vertical clips for the Watch strip — shortest first.
    const clipRows = await prisma.songClip.findMany({
      where: { songId: song.id },
      orderBy: [{ durationS: 'asc' }, { createdAt: 'asc' }],
      take: 8,
      select: { id: true, url: true, durationS: true, aspect: true, kind: true, captionText: true },
    });

    const cover = await prisma.imageAsset.findFirst({
      where: { projectId: song.projectId, kind: 'cover', approved: true },
      orderBy: { createdAt: 'desc' },
    });
    const playable = currentPlayableAsset(song);

    // What the song is about — story + hook only, lifted from the release kit.
    // The rest of the kit (captions, hashtags, calendar, titles) is a creator
    // tool, not fan-facing, so it never leaves the API here.
    const kit = asRecord(song.socialsJson);
    const story = typeof kit.story === 'string' && kit.story.trim() ? kit.story.trim() : null;
    const hook = typeof kit.hook === 'string' && kit.hook.trim() ? kit.hook.trim() : null;

    // Lyrics — VERBATIM, and only for a released VOCAL song (never an
    // instrumental / film-sound cue, which has none).
    const lyrics = song.kind === 'song' && song.lyric?.body ? song.lyric.body : null;

    // Presign every asset in parallel — a storage URI must never reach the page.
    const [coverUrl, audioUrl, musicVideoUrl, visualizerUrl, lyricVideoUrl, clips] = await Promise.all([
      song.coverUrl
        ? presignAssetRef(song.coverUrl, 900)
        : cover?.url
          ? presignAssetRef(cover.url, 900)
          : null,
      playable?.url ? presignAssetRef(playable.url, 900) : null,
      musicVideoRef ? presignAssetRef(musicVideoRef, 900) : null,
      visualizerRef ? presignAssetRef(visualizerRef, 900) : null,
      lyricVideoRef ? presignAssetRef(lyricVideoRef, 900) : null,
      Promise.all(
        clipRows.map(async (c) => ({
          id: c.id,
          url: await presignAssetRef(c.url, 900),
          durationS: c.durationS,
          aspect: c.aspect,
          kind: c.kind,
          captionText: c.captionText,
        })),
      ),
    ]);

    reply.header('cache-control', 'public, max-age=60');
    return {
      id: song.id,
      title: song.title,
      // Per-song display artist wins over the workspace artist (the singer shown
      // on THIS record's card), falling back to the project artist stage name.
      artist: song.displayArtist ?? song.project.artist.stageName,
      genre: song.project.genre,
      coverUrl,
      audioUrl,
      musicVideoUrl,
      visualizerUrl,
      lyricVideoUrl,
      clips,
      lyrics,
      story,
      hook,
      isrc: song.isrc ?? null,
    };
  });
}

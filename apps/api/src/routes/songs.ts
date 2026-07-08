import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { predictHit, soundBrief, researchTrends, enrichLyricsForVocals, generateJson, prompts } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';
import { learnedReferenceBrief } from '../lib/learned';
import { arReadSong, arReadAfterRender } from '../lib/ar-read';
import { improveSongOnce } from '../lib/will-it-blow';
import { snapshotLyricVersion, readVersions } from '../lib/lyric-versions';
import { recordFeedback } from '../services/artist-memory';

/** Freshest playable audio for a song: the most RECENT of master/mix/beat by
 *  createdAt — so a re-sing (new beat) or a re-master (new master) both become
 *  the song's current audio. Edits propagate; the newest render always wins. */
function freshestAudioUrl(s: {
  masters?: Array<{ url: string; createdAt: Date }>;
  mixes?: Array<{ url: string; createdAt: Date }>;
  beats?: Array<{ url: string; createdAt: Date }>;
}): string | null {
  const cands = [s.masters?.[0], s.mixes?.[0], s.beats?.[0]].filter(Boolean) as Array<{ url: string; createdAt: Date }>;
  if (!cands.length) return null;
  cands.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return cands[0]!.url;
}

/**
 * Catalog — the artist's songs as a real WORKSTATION, not a read-only shelf.
 *
 * Nothing is "gone once made": every song can be reused, edited, re-mastered,
 * downloaded, duplicated, and moved. All actions are song-scoped (the catalog
 * only knows a songId) and resolve the project server-side.
 */
export default async function songs(app: FastifyInstance) {
  // ---- List (with per-asset ids/urls so the UI can target the right file) ----
  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.song.findMany({
      // Show songs that have REAL audio (rendered beat/mix/master) OR were just
      // created and are still rendering (< 20 min) — so a fresh song is NEVER
      // invisible while it cooks. OLD lyric-only shells (>20 min, render failed /
      // never ran) stay hidden so they don't clutter or read as "wasted".
      where: {
        workspaceId,
        OR: [
          { beats: { some: {} } },
          { mixes: { some: {} } },
          { masters: { some: {} } },
          { createdAt: { gte: new Date(Date.now() - 20 * 60 * 1000) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        project: { select: { id: true, title: true, genre: true, bpm: true, artist: { select: { stageName: true } } } },
        masters: { orderBy: { createdAt: 'desc' }, take: 1 },
        mixes: { orderBy: { createdAt: 'desc' }, take: 1 },
        beats: { orderBy: { createdAt: 'desc' }, take: 1, include: { stems: true } },
        lyric: { select: { id: true, title: true } },
      },
    });

    const projectIds = [...new Set(rows.map((s) => s.projectId))];
    const covers = await prisma.imageAsset.findMany({
      where: { projectId: { in: projectIds }, kind: 'cover' },
      orderBy: { createdAt: 'desc' },
      select: { projectId: true, url: true },
    });
    const coverByProject = new Map<string, string>();
    for (const c of covers) if (c.projectId && !coverByProject.has(c.projectId)) coverByProject.set(c.projectId, c.url);

    return rows.map((s) => ({
      id: s.id,
      title: s.lyric?.title || s.title,
      versionLabel: s.versionLabel,
      status: s.status,
      artist: s.project.artist.stageName,
      projectId: s.projectId,
      projectTitle: s.project.title,
      genre: s.project.genre,
      bpm: s.project.bpm,
      audioUrl: freshestAudioUrl(s),
      masterUrl: s.masters[0]?.url ?? null,
      mixUrl: s.mixes[0]?.url ?? null,
      beatUrl: s.beats[0]?.url ?? null,
      beatId: s.beats[0]?.id ?? null,
      stemCount: s.beats[0]?.stems.length ?? 0,
      hasLyrics: !!s.lyric,
      releaseReady: s.releaseReady,
      hitScore: s.hitScore,
      viralScore: s.viralScore,
      coverUrl: coverByProject.get(s.projectId) ?? null,
      createdAt: s.createdAt,
    }));
  });

  // ---- Detail: everything about one song ----
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        project: { select: { id: true, title: true, genre: true, bpm: true } },
        masters: { orderBy: { createdAt: 'desc' }, take: 3 },
        mixes: { orderBy: { createdAt: 'desc' }, take: 3 },
        beats: { orderBy: { createdAt: 'desc' }, take: 1, include: { stems: true } },
        lyric: true,
      },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const cover = await prisma.imageAsset.findFirst({
      where: { projectId: song.projectId, kind: 'cover' },
      orderBy: { createdAt: 'desc' },
      select: { url: true },
    });
    return { ...song, coverUrl: cover?.url ?? null };
  });

  // ---- SUNO BRIDGE: everything you need to generate this song in your own Suno
  // account (clean rights, top-tier audio), then bring it back to master + score.
  app.get<{ Params: { id: string } }>('/:id/suno-export', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        project: { include: { artist: true } },
        lyric: true,
        hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const genre = song.project.genre;
    const bpm = song.project.bpm ?? undefined;
    const langs = (song.project.artist.languages ?? []) as string[];
    const brief = soundBrief(genre);
    // Suno's "Style of Music" field — genre + tempo + the genre's signature
    // production tokens + the artist lane. Concise; Suno weights the front.
    const stylePrompt = [
      genre.replace(/_/g, ' '),
      bpm ? `${bpm} bpm` : null,
      langs.length ? `${langs.join('/')} vocals` : null,
      ...(brief.tags ?? []).slice(0, 8),
      song.project.artist.vocalTone?.length ? song.project.artist.vocalTone.slice(0, 3).join(', ') : null,
      song.project.artist.laneSummary ? `lane: ${song.project.artist.laneSummary}` : null,
    ]
      .filter(Boolean)
      .join(', ')
      .slice(0, 380);
    // The lyric body already carries [Verse]/[Chorus] structure and is clean (the
    // ad-lib/stage-direction layer is only added at render time), so it's Suno-ready.
    const lyricsForSuno = (song.lyric?.cleanVersion || song.lyric?.body || '').trim();
    return {
      songId: song.id,
      title: song.lyric?.title || song.title,
      stylePrompt,
      lyricsForSuno,
      hasLyrics: lyricsForSuno.length > 0,
      tips: 'In Suno: Create → Custom Mode → turn "Instrumental" OFF → paste Style + Lyrics → Create. Download the WAV, then use "Bring it back from Suno" here to master + score it — your account, your rights.',
    };
  });

  // ---- General edit (rename / version / status) — "not one-shot" ----
  const patchSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    versionLabel: z.string().max(60).nullable().optional(),
    status: z.enum(['SKETCH', 'DEMO', 'FULL', 'MIXED', 'MASTERED', 'RELEASED']).optional(),
  });
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const body = patchSchema.parse(req.body);
    const found = await prisma.song.findFirst({ where: { id: req.params.id, workspaceId }, select: { id: true } });
    if (!found) return reply.code(404).send({ error: 'song_not_found' });
    return prisma.song.update({ where: { id: found.id }, data: body });
  });

  // ---- Lyrics: view + EDIT (persist) ----
  app.get<{ Params: { id: string } }>('/:id/lyrics', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({ where: { id: req.params.id, workspaceId }, include: { lyric: true } });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    // Fall back to the project's latest lyric if the song isn't linked to one yet.
    const lyric =
      song.lyric ??
      (await prisma.lyricDraft.findFirst({ where: { projectId: song.projectId }, orderBy: { createdAt: 'desc' } }));
    return { lyric };
  });

  const lyricPatchSchema = z.object({
    title: z.string().max(200).optional(),
    body: z.string().min(1).optional(),
    cleanVersion: z.string().nullable().optional(),
    explicit: z.boolean().optional(),
  });
  app.patch<{ Params: { id: string } }>('/:id/lyrics', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const body = lyricPatchSchema.parse(req.body);
    const song = await prisma.song.findFirst({ where: { id: req.params.id, workspaceId }, include: { lyric: true } });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    let lyricId = song.lyric?.id;
    if (!lyricId) {
      const latest = await prisma.lyricDraft.findFirst({ where: { projectId: song.projectId }, orderBy: { createdAt: 'desc' } });
      lyricId = latest?.id;
    }
    // If the song already has an AI-sung vocal, the edit won't be audible until a
    // re-sing — tell the UI so it can offer "Save & re-sing" (surgical edit).
    const needsRegeneration =
      (await prisma.beatAsset.count({ where: { songId: song.id, provider: { not: 'upload' } } })) > 0;
    if (!lyricId) {
      // No lyric yet — create one bound to this song so edits have a home.
      const created = await prisma.lyricDraft.create({
        data: { projectId: song.projectId, songId: song.id, body: body.body ?? '', title: body.title, cleanVersion: body.cleanVersion ?? undefined, explicit: body.explicit ?? false },
      });
      await prisma.song.update({ where: { id: song.id }, data: { lyricId: created.id } });
      return { lyric: created, needsRegeneration };
    }
    // Keep the current version before a manual overwrite too — original + every
    // edit stay recoverable.
    await snapshotLyricVersion(lyricId, 'before edit');
    const updated = await prisma.lyricDraft.update({ where: { id: lyricId }, data: body });
    return { lyric: updated, needsRegeneration };
  });

  // ---- Lyric version history: revert to the ORIGINAL (or any prior take) ----
  // Every rewrite (make-it-bigger, the will-it-blow gate, manual edits) snapshots
  // the current lyric first, so nothing is ever lost. This restores a chosen one.
  app.post<{ Params: { id: string }; Body: { index?: number } }>('/:id/lyrics/revert', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({ where: { id: req.params.id, workspaceId }, include: { lyric: true } });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const lyric = song.lyric ?? (await prisma.lyricDraft.findFirst({ where: { projectId: song.projectId }, orderBy: { createdAt: 'desc' } }));
    if (!lyric) return reply.code(404).send({ error: 'no_lyric' });
    const versions = readVersions(lyric.versions);
    const idx = Math.max(0, Number(req.body?.index ?? 0));
    const target = versions[idx];
    if (!target) return reply.code(400).send({ error: 'no_such_version', have: versions.length });
    // Snapshot the CURRENT first, so reverting is itself reversible.
    await snapshotLyricVersion(lyric.id, 'before revert');
    const updated = await prisma.lyricDraft.update({
      where: { id: lyric.id },
      data: { body: target.body, title: target.title ?? undefined, cleanVersion: target.cleanVersion ?? undefined },
    });
    const needsRegeneration = (await prisma.beatAsset.count({ where: { songId: song.id, provider: { not: 'upload' } } })) > 0;
    return { lyric: updated, needsRegeneration, revertedTo: target.label ?? `version ${idx + 1}` };
  });

  // ---- Download manifest (audio + stems + cover + lyrics) ----
  app.get<{ Params: { id: string } }>('/:id/download', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        masters: { orderBy: { createdAt: 'desc' }, take: 1 },
        mixes: { orderBy: { createdAt: 'desc' }, take: 1 },
        beats: { orderBy: { createdAt: 'desc' }, take: 1, include: { stems: true } },
        lyric: true,
      },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const beat = song.beats[0];
    // `dl` is the proxied download path — forces a real download with a unique,
    // readable filename (the raw R2 url opens in-tab with a cryptic key name).
    return {
      title: song.lyric?.title || song.title,
      files: [
        song.masters[0] && { label: 'Master (WAV)', url: song.masters[0].url, kind: 'master', dl: `/songs/${song.id}/file?type=master` },
        song.mixes[0] && { label: 'Mix (WAV)', url: song.mixes[0].url, kind: 'mix', dl: `/songs/${song.id}/file?type=mix` },
        beat && { label: `Audio (${beat.format?.toUpperCase() ?? 'MP3'})`, url: beat.url, kind: 'audio', dl: `/songs/${song.id}/file?type=audio` },
        ...(beat?.stems ?? []).map((st) => ({ label: `Stem — ${st.role}`, url: st.url, kind: 'stem', dl: `/songs/${song.id}/file?type=stem&stem=${encodeURIComponent(st.role)}` })),
      ].filter(Boolean),
      lyrics: song.lyric ? { body: song.lyric.body, cleanVersion: song.lyric.cleanVersion } : null,
    };
  });

  // ---- Proxied file download — streams with a real, unique filename ----
  app.get<{ Params: { id: string }; Querystring: { type?: string; stem?: string } }>('/:id/file', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const type = req.query.type ?? 'audio';
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        masters: { orderBy: { createdAt: 'desc' }, take: 1 },
        mixes: { orderBy: { createdAt: 'desc' }, take: 1 },
        beats: { orderBy: { createdAt: 'desc' }, take: 1, include: { stems: true } },
        lyric: { select: { title: true } },
      },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const beat = song.beats[0];
    let url: string | undefined;
    let ext = 'mp3';
    if (type === 'master' && song.masters[0]) { url = song.masters[0].url; ext = 'wav'; }
    else if (type === 'mix' && song.mixes[0]) { url = song.mixes[0].url; ext = 'wav'; }
    else if (type === 'stem' && req.query.stem) { url = beat?.stems.find((s) => s.role === req.query.stem)?.url; ext = 'mp3'; }
    else if (beat) { url = beat.url; ext = beat.format ?? 'mp3'; }
    if (!url) return reply.code(404).send({ error: 'no_such_asset' });

    const res = await fetch(url);
    if (!res.ok || !res.body) return reply.code(502).send({ error: 'source_unavailable' });
    // STREAM, never buffer — a WAV master can be 50MB+; buffering N concurrent
    // downloads OOMs the API. Cap at 250MB as a sanity ceiling.
    const MAX_BYTES = 250 * 1024 * 1024;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) return reply.code(413).send({ error: 'file_too_large' });
    const safeTitle = (song.lyric?.title || song.title || 'afrohit').replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 60) || 'afrohit';
    const name = type === 'stem' ? `${safeTitle} - stem-${req.query.stem}` : `${safeTitle} - ${type}`;
    reply.header('content-disposition', `attachment; filename="${name}.${ext}"`);
    reply.header('content-type', res.headers.get('content-type') ?? 'application/octet-stream');
    if (len > 0) reply.header('content-length', String(len));
    const { Readable } = await import('node:stream');
    return reply.send(Readable.fromWeb(res.body as never));
  });

  // ---- Master / re-master on demand (song-first) ----
  app.post<{ Params: { id: string }; Body: { preset?: string } }>('/:id/master', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const preset = (req.body?.preset as string) || 'streaming_lufs_-14';
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        mixes: { orderBy: { createdAt: 'desc' }, take: 1 },
        masters: { orderBy: { createdAt: 'desc' }, take: 1 },
        beats: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });

    // Master the FRESHEST audio. A real console/uploaded mix is used only if it's
    // at least as new as the latest rendered beat; otherwise (or after a
    // regenerate) we (re)wrap the current beat in a fresh 'source' mix — so a
    // re-master never silently masters stale audio.
    const latestMix = song.mixes[0];
    const latestBeat = song.beats[0];
    const realMix =
      latestMix && latestMix.preset !== 'source' && (!latestBeat || latestMix.createdAt >= latestBeat.createdAt)
        ? latestMix
        : null;
    let mixId: string;
    if (realMix) {
      mixId = realMix.id;
    } else {
      const sourceUrl = latestBeat?.url ?? latestMix?.url ?? song.masters[0]?.url;
      if (!sourceUrl) return reply.code(400).send({ error: 'nothing_to_master — no audio on this song yet' });
      const mix = await prisma.mix.create({
        data: { projectId: song.projectId, songId: song.id, preset: 'source', url: sourceUrl, notes: 'Master source (current rendered audio)', approved: true },
      });
      mixId = mix.id;
    }

    const charge = await app.chargeCredits({ workspaceId, key: 'master_preset', refTable: 'Song', refId: song.id });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    const job = await prisma.providerJob.create({
      data: { workspaceId, projectId: song.projectId, kind: 'master', provider: 'internal', status: 'QUEUED', inputJson: { songId: song.id, mixId, preset } as never },
    });
    await enqueue({ queue: app.queues.master, name: 'create-master', payload: { jobId: job.id, workspaceId, projectId: song.projectId, songId: song.id, mixId, preset } });
    reply.code(202);
    return { jobId: job.id, mixId };
  });

  // ---- Reuse the beat in a NEW song (optionally a different project) ----
  app.post<{ Params: { id: string }; Body: { targetProjectId?: string; title?: string } }>('/:id/reuse-beat', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { beats: { orderBy: { createdAt: 'desc' }, take: 1, include: { stems: true } }, project: true },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const beat = song.beats[0];
    if (!beat) return reply.code(400).send({ error: 'no_beat_to_reuse', message: 'This song has no beat yet.' });

    const targetProjectId = (req.body?.targetProjectId as string) || song.projectId;
    const project = await prisma.project.findFirst({ where: { id: targetProjectId, workspaceId }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: 'target_project_not_found' });

    // "Reuse the BEAT" should reuse a clean INSTRUMENTAL when we have one (from a
    // prior stem separation) — not the full song with baked-in vocals. Fall back
    // to the beat audio otherwise (and tell the user so they can run stems first).
    const instrumental = beat.stems.find((s) => s.role === 'instrumental');
    const reuseUrl = instrumental?.url ?? beat.url;
    const cleanInstrumental = !!instrumental;

    const newSong = await prisma.song.create({
      data: { workspaceId, projectId: project.id, title: (req.body?.title as string) || `${song.title} (reuse beat)`, status: 'SKETCH' },
    });
    const newBeat = await prisma.beatAsset.create({
      data: {
        projectId: project.id, songId: newSong.id, url: reuseUrl, format: cleanInstrumental ? 'mp3' : beat.format,
        bpm: beat.bpm, keySignature: beat.keySignature, duration: beat.duration,
        provider: beat.provider, meta: { reusedFromBeat: beat.id, cleanInstrumental } as never, approved: true,
      },
    });
    // Carry over the non-vocal stems so the reused beat is remixable.
    const carry = beat.stems.filter((s) => s.role !== 'vocals' && s.role !== 'instrumental');
    if (carry.length) {
      await prisma.$transaction(carry.map((st) => prisma.stem.create({ data: { beatId: newBeat.id, role: st.role, url: st.url, format: st.format, duration: st.duration } })));
    }
    reply.code(201);
    return {
      songId: newSong.id,
      projectId: project.id,
      beatId: newBeat.id,
      cleanInstrumental,
      message: cleanInstrumental
        ? 'Clean instrumental reused in a new song — write a fresh topline over it.'
        : 'Beat reused (full track — run "Instrumental" on the original first for a vocals-free version).',
    };
  });

  // ---- Reuse ONLY the lyrics in a NEW song (write a fresh beat under them) ----
  app.post<{ Params: { id: string }; Body: { targetProjectId?: string; title?: string } }>('/:id/reuse-lyrics', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { lyric: true },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const lyric =
      song.lyric ?? (await prisma.lyricDraft.findFirst({ where: { projectId: song.projectId }, orderBy: { createdAt: 'desc' } }));
    if (!lyric) return reply.code(400).send({ error: 'no_lyrics_to_reuse', message: 'This song has no lyrics yet — write or generate lyrics first.' });

    const targetProjectId = (req.body?.targetProjectId as string) || song.projectId;
    const project = await prisma.project.findFirst({ where: { id: targetProjectId, workspaceId }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: 'target_project_not_found' });

    const newSong = await prisma.song.create({
      data: { workspaceId, projectId: project.id, title: (req.body?.title as string) || `${song.title} (reuse lyrics)`, status: 'SKETCH' },
    });
    // LyricDraft.songId is @unique → the reused lyrics must be a NEW row. No melody
    // is copied, so a fresh beat/melody is written for the new song.
    const newLyric = await prisma.lyricDraft.create({
      data: {
        projectId: project.id, songId: newSong.id, title: lyric.title, body: lyric.body,
        structure: lyric.structure as never, cleanVersion: lyric.cleanVersion, explicit: lyric.explicit,
        languageMix: lyric.languageMix as never, approved: false,
      },
    });
    await prisma.song.update({ where: { id: newSong.id }, data: { lyricId: newLyric.id } });
    reply.code(201);
    return { songId: newSong.id, projectId: project.id, lyricId: newLyric.id, message: 'Lyrics reused in a new song — make a fresh beat under them (still fully editable).' };
  });

  // ---- Reuse ONLY the clean instrumental (needs stems separated first) ----
  app.post<{ Params: { id: string }; Body: { targetProjectId?: string; title?: string } }>('/:id/reuse-instrumental', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { beats: { orderBy: { createdAt: 'desc' }, take: 1, include: { stems: true } } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const beat = song.beats[0];
    const instrumental = beat?.stems.find((s) => s.role === 'instrumental');
    if (!instrumental) {
      return reply.code(400).send({ error: 'no_instrumental_stem', message: 'Run "Instrumental" on this song first to extract the clean instrumental, then reuse it.' });
    }

    const targetProjectId = (req.body?.targetProjectId as string) || song.projectId;
    const project = await prisma.project.findFirst({ where: { id: targetProjectId, workspaceId }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: 'target_project_not_found' });

    const newSong = await prisma.song.create({
      data: { workspaceId, projectId: project.id, title: (req.body?.title as string) || `${song.title} (instrumental)`, status: 'SKETCH' },
    });
    const newBeat = await prisma.beatAsset.create({
      data: {
        projectId: project.id, songId: newSong.id, url: instrumental.url, format: instrumental.format ?? 'mp3',
        bpm: beat!.bpm, keySignature: beat!.keySignature, duration: instrumental.duration ?? beat!.duration,
        provider: beat!.provider, meta: { reusedInstrumentalFromBeat: beat!.id, instrumental: true } as never, approved: true,
      },
    });
    reply.code(201);
    return { songId: newSong.id, projectId: project.id, beatId: newBeat.id, message: 'Clean instrumental reused in a new song — write fresh lyrics/vocals over it.' };
  });

  // ---- Re-sing the song with the CURRENT (edited) lyrics — the surgical edit ----
  // Edit lyrics → save → re-sing: renders a fresh vocal over the same lane, and
  // because the new beat is the freshest audio it becomes the song's current take.
  app.post<{ Params: { id: string }; Body: { songEngine?: 'suno' | 'ace_step' | 'minimax' } }>('/:id/regenerate-beat', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { project: { include: { artist: true } }, lyric: true, beats: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const lyric = song.lyric ?? (await prisma.lyricDraft.findFirst({ where: { projectId: song.projectId }, orderBy: { createdAt: 'desc' } }));
    const lyrics = lyric?.cleanVersion ?? lyric?.body ?? undefined;
    if (!lyrics) return reply.code(400).send({ error: 'no_lyrics', message: 'Write or edit lyrics first, then re-sing.' });

    const genre = song.project.genre;
    const dna = soundBrief(genre);
    const learned = await learnedReferenceBrief(workspaceId, genre);
    let lyricsForSong = lyrics;
    let styleHints: string[] = [];
    const enriched = await enrichLyricsForVocals({
      lyricBody: lyrics,
      languages: song.project.artist.languages,
      laneSummary: song.project.artist.laneSummary ?? undefined,
      soundDna: [dna.brief, learned].filter(Boolean).join('\n\n'),
    });
    if (enriched) {
      lyricsForSong = enriched.enrichedLyrics;
      styleHints = enriched.styleTags;
    }

    // Keep the previous engine if it was a vocal engine; else let the worker
    // auto-pick the best (Suno V5 when a Suno key is set, ACE-Step otherwise).
    const prev = song.beats[0]?.provider ?? '';
    const songEngine =
      (req.body?.songEngine as 'suno' | 'ace_step' | 'minimax' | undefined) ??
      (['suno', 'minimax', 'ace_step'].includes(prev) ? (prev as 'suno' | 'ace_step' | 'minimax') : undefined);
    const charge = await app.chargeCredits({ workspaceId, key: 'full_song_demo', refTable: 'Song', refId: song.id });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    const job = await prisma.providerJob.create({
      data: { workspaceId, projectId: song.projectId, kind: 'music', provider: songEngine ?? 'suno', status: 'QUEUED', inputJson: { regenerate: true, songId: song.id } as never },
    });
    await enqueue({
      queue: app.queues.music,
      name: 'generate-music',
      payload: {
        jobId: job.id, workspaceId, projectId: song.projectId, songId: song.id,
        input: {
          genre, bpm: song.project.bpm ?? 103, withVocals: true, withStems: false, songEngine,
          lyrics: lyricsForSong,
          artistTone: song.project.artist.vocalTone, languages: song.project.artist.languages,
          dnaTags: [...(dna.tags ?? []), ...styleHints.slice(0, 3)],
        },
      },
    });
    reply.code(202);
    return { jobId: job.id, status: 'queued', message: "Re-singing with your edited lyrics — it becomes the song's current audio when it finishes." };
  });

  // ---- Duplicate a song (deep copy: song + lyric + latest beat + stems) ----
  app.post<{ Params: { id: string }; Body: { targetProjectId?: string } }>('/:id/duplicate', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { lyric: true, beats: { orderBy: { createdAt: 'desc' }, take: 1, include: { stems: true } } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const targetProjectId = (req.body?.targetProjectId as string) || song.projectId;
    const project = await prisma.project.findFirst({ where: { id: targetProjectId, workspaceId }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: 'target_project_not_found' });

    const copy = await prisma.song.create({
      data: {
        workspaceId, projectId: project.id, title: `${song.title} (copy)`, versionLabel: song.versionLabel,
        status: song.status, storyboard: song.storyboard as never,
        // Rights reset — a copy is a fresh work, not the released original.
        splitSheet: song.splitSheet as never, nativeReviewOk: false, releaseReady: false,
      },
    });
    // LyricDraft.songId & Song.lyricId are both @unique → must be a NEW lyric row.
    if (song.lyric) {
      const newLyric = await prisma.lyricDraft.create({
        data: {
          projectId: project.id, songId: copy.id, title: song.lyric.title, body: song.lyric.body,
          structure: song.lyric.structure as never, cleanVersion: song.lyric.cleanVersion, explicit: song.lyric.explicit,
          languageMix: song.lyric.languageMix as never, melody: song.lyric.melody as never, approved: false,
        },
      });
      await prisma.song.update({ where: { id: copy.id }, data: { lyricId: newLyric.id } });
    }
    const beat = song.beats[0];
    if (beat) {
      const newBeat = await prisma.beatAsset.create({
        data: { projectId: project.id, songId: copy.id, url: beat.url, format: beat.format, bpm: beat.bpm, keySignature: beat.keySignature, duration: beat.duration, provider: beat.provider, meta: beat.meta as never, approved: false },
      });
      if (beat.stems.length) {
        await prisma.$transaction(beat.stems.map((st) => prisma.stem.create({ data: { beatId: newBeat.id, role: st.role, url: st.url, format: st.format, duration: st.duration } })));
      }
    }
    reply.code(201);
    return { songId: copy.id, projectId: project.id };
  });

  // ---- Instrumental + stems (Demucs stem separation) ----
  app.post<{ Params: { id: string }; Body: { mode?: 'instrumental' | 'full' } }>('/:id/stems', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const mode = req.body?.mode === 'full' ? 'full' : 'instrumental';
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { beats: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const beat = song.beats[0];
    if (!beat) return reply.code(400).send({ error: 'no_audio_to_separate' });

    const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s', refTable: 'Song', refId: song.id });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    const job = await prisma.providerJob.create({
      data: { workspaceId, projectId: song.projectId, kind: 'stems', provider: 'replicate', status: 'QUEUED', inputJson: { songId: song.id, beatId: beat.id, mode } as never },
    });
    await enqueue({ queue: app.queues.music, name: 'stems', payload: { jobId: job.id, workspaceId, projectId: song.projectId, songId: song.id, beatId: beat.id, mode } });
    reply.code(202);
    return { jobId: job.id, status: 'queued', mode };
  });

  // ---- A&R hit predictor: will it hit / go viral, and how to make it bigger ----
  app.post<{ Params: { id: string } }>('/:id/hit-score', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        project: { select: { genre: true, bpm: true, artistId: true, artist: { select: { languages: true } } } },
        lyric: true,
        masters: { orderBy: { createdAt: 'desc' }, take: 1 },
        hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });

    const charge = await app.chargeCredits({ workspaceId, key: 'hit_predict', refTable: 'Song', refId: song.id });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    const genre = song.project.genre;
    const trends = (await researchTrends({ genre }).catch(() => null))?.digest;
    const hook = song.hooks[0]?.text ?? undefined;
    const prediction = await predictHit({
      title: song.lyric?.title || song.title,
      genre,
      bpm: song.project.bpm ?? undefined,
      hook,
      lyrics: song.lyric?.body ?? undefined,
      soundDna: soundBrief(genre).brief,
      trends,
      hasMaster: song.masters.length > 0,
      languages: song.project.artist.languages,
    });
    if (!prediction) return reply.code(503).send({ error: 'a&r_unavailable', message: 'Hit scout needs a Claude/OpenAI key. Add ANTHROPIC_API_KEY.' });

    // Compounding library: a genuine hit signal teaches the artist's taste graph,
    // so future hooks/lyrics pull toward what actually scores. Real feedback loop.
    if (prediction.hitScore >= 75 && song.hooks[0]) {
      await recordFeedback({ workspaceId, artistId: song.project.artistId, kind: 'approved', content: song.hooks[0].text, sourceKind: 'hook', sourceId: song.hooks[0].id }).catch(() => {});
    }
    // PERSIST the read — the catalog shows it without clicking, and
    // "Make it bigger" implements exactly these notes.
    await prisma.song
      .update({ where: { id: song.id }, data: { hitScore: prediction.hitScore, viralScore: prediction.viralScore, hitRead: prediction as never } })
      .catch(() => {});
    return { songId: song.id, ...prediction };
  });

  /**
   * MAKE IT BIGGER — implement the A&R notes as a NEW VERSION.
   * Takes the stored Will-it-hit read (or runs one now), has Claude rewrite the
   * lyric executing every "toMakeItBigger" note + fixing the risks, then
   * RE-SINGS with the same engine. The render auto-masters and re-scores when
   * it lands — the full loop: analyze → approve → implement → bigger version.
   */
  app.post<{ Params: { id: string } }>('/:id/make-it-bigger', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    // Shared core with the automatic Will-it-blow gate: rewrite the lyric executing
    // the A&R notes → re-sing (auto-masters + re-scores when it lands).
    const res = await improveSongOnce(app, workspaceId, req.params.id);
    if ('error' in res) {
      const status: Record<string, number> = { song_not_found: 404, no_lyrics: 400, 'a&r_unavailable': 503, insufficient_credits: 402, rewrite_failed: 503 };
      const message: Record<string, string> = {
        no_lyrics: 'This song has no lyric to improve — generate or attach one first.',
        'a&r_unavailable': 'The A&R read failed — run "Will it hit?" first; its notes drive the rewrite.',
      };
      return reply.code(status[res.error] ?? 400).send({ error: res.error, ...(message[res.error] ? { message: message[res.error] } : {}) });
    }
    void arReadAfterRender(app, workspaceId, [{ songId: req.params.id, jobId: res.jobId }]).catch(() => {});
    reply.code(202);
    return { jobId: res.jobId, status: 'queued', whatChanged: res.whatChanged, message: 'A&R notes implemented — re-singing the bigger version. It auto-masters and re-scores when done.' };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    await prisma.song.deleteMany({ where: { id: req.params.id, workspaceId } });
    reply.code(204);
    return null;
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

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
      where: { workspaceId },
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
      audioUrl: s.masters[0]?.url ?? s.mixes[0]?.url ?? s.beats[0]?.url ?? null,
      masterUrl: s.masters[0]?.url ?? null,
      mixUrl: s.mixes[0]?.url ?? null,
      beatUrl: s.beats[0]?.url ?? null,
      beatId: s.beats[0]?.id ?? null,
      stemCount: s.beats[0]?.stems.length ?? 0,
      hasLyrics: !!s.lyric,
      releaseReady: s.releaseReady,
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
    if (!lyricId) {
      // No lyric yet — create one bound to this song so edits have a home.
      const created = await prisma.lyricDraft.create({
        data: { projectId: song.projectId, songId: song.id, body: body.body ?? '', title: body.title, cleanVersion: body.cleanVersion ?? undefined, explicit: body.explicit ?? false },
      });
      await prisma.song.update({ where: { id: song.id }, data: { lyricId: created.id } });
      return created;
    }
    return prisma.lyricDraft.update({ where: { id: lyricId }, data: body });
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
    return {
      title: song.lyric?.title || song.title,
      files: [
        song.masters[0] && { label: 'Master (WAV)', url: song.masters[0].url, kind: 'master' },
        song.mixes[0] && { label: 'Mix (WAV)', url: song.mixes[0].url, kind: 'mix' },
        beat && { label: `Audio (${beat.format?.toUpperCase() ?? 'MP3'})`, url: beat.url, kind: 'audio' },
        ...(beat?.stems ?? []).map((st) => ({ label: `Stem — ${st.role}`, url: st.url, kind: 'stem' })),
      ].filter(Boolean),
      lyrics: song.lyric ? { body: song.lyric.body, cleanVersion: song.lyric.cleanVersion } : null,
    };
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

    // The mastering chain masters a Mix. A generated full song has only a beat
    // (baked audio) — wrap it in a Mix row so it can be mastered like anything else.
    let mixId = song.mixes[0]?.id;
    if (!mixId) {
      const sourceUrl = song.mixes[0]?.url ?? song.masters[0]?.url ?? song.beats[0]?.url;
      if (!sourceUrl) return reply.code(400).send({ error: 'nothing_to_master — no audio on this song yet' });
      const mix = await prisma.mix.create({
        data: { projectId: song.projectId, songId: song.id, preset: 'source', url: sourceUrl, notes: 'Master source (from rendered song audio)', approved: true },
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
    if (!beat) return reply.code(400).send({ error: 'no_beat_to_reuse' });

    const targetProjectId = (req.body?.targetProjectId as string) || song.projectId;
    const project = await prisma.project.findFirst({ where: { id: targetProjectId, workspaceId }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: 'target_project_not_found' });

    const newSong = await prisma.song.create({
      data: { workspaceId, projectId: project.id, title: (req.body?.title as string) || `${song.title} (reuse beat)`, status: 'SKETCH' },
    });
    const newBeat = await prisma.beatAsset.create({
      data: {
        projectId: project.id, songId: newSong.id, url: beat.url, format: beat.format,
        bpm: beat.bpm, keySignature: beat.keySignature, duration: beat.duration,
        provider: beat.provider, meta: { ...(beat.meta as object), reusedFromBeat: beat.id } as never, approved: true,
      },
    });
    if (beat.stems.length) {
      await prisma.$transaction(beat.stems.map((st) => prisma.stem.create({ data: { beatId: newBeat.id, role: st.role, url: st.url, format: st.format, duration: st.duration } })));
    }
    reply.code(201);
    return { songId: newSong.id, projectId: project.id, beatId: newBeat.id };
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
          languageMix: song.lyric.languageMix as never, melody: song.lyric.melody as never, approved: song.lyric.approved,
        },
      });
      await prisma.song.update({ where: { id: copy.id }, data: { lyricId: newLyric.id } });
    }
    const beat = song.beats[0];
    if (beat) {
      const newBeat = await prisma.beatAsset.create({
        data: { projectId: project.id, songId: copy.id, url: beat.url, format: beat.format, bpm: beat.bpm, keySignature: beat.keySignature, duration: beat.duration, provider: beat.provider, meta: beat.meta as never, approved: beat.approved },
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

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    await prisma.song.deleteMany({ where: { id: req.params.id, workspaceId } });
    reply.code(204);
    return null;
  });
}

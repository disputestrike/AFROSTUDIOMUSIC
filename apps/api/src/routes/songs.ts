import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { blueprintFromMeasured, structureBrief, genreSignature, type MeasuredAnalysis, type SongBlueprint } from '@afrohit/shared';
import { prisma, Prisma } from '@afrohit/db';
import { predictHit, researchTrends, enrichLyricsForVocals, cleanLyricsForMinimax } from '@afrohit/ai';
import { laneDna, laneDnaBrief } from '../lib/lane-pipeline';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { musicRouteCapabilities, validateMusicRoute } from '../lib/music-capabilities';
import { learnedReferenceBrief } from '../lib/learned';
import { laneContext } from '../lib/lane-context';
import { arReadAfterRender } from '../lib/ar-read';
import { improveSongOnce } from '../lib/will-it-blow';
import { snapshotLyricVersion, readVersions } from '../lib/lyric-versions';
import { recordFeedback } from '../services/artist-memory';
import { languageVocalTag } from '../services/chat-tools';
import { requireAdmin } from './admin';
import { presignAssetRef } from '../lib/storage';
import { safeFetch } from '../lib/url-guard';
import { queueAssetDeletion, songAssetRefs } from '../lib/asset-lifecycle';
import { operationErrorBody, runIdempotentOperation } from '../lib/idempotent-operation';
import { registerBeatForInspection } from '../lib/beat-ingest';

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

/** Shape of a catalog list row (song + the includes the list query selects). */
type CatalogRow = {
  id: string;
  title: string;
  versionLabel: string | null;
  status: string;
  projectId: string;
  releaseReady: boolean;
  hitScore: number | null;
  viralScore: number | null;
  createdAt: Date;
  project: { id: string; title: string; genre: string; bpm: number | null; artist: { stageName: string } };
  masters: Array<{ url: string; createdAt: Date }>;
  mixes: Array<{ url: string; createdAt: Date }>;
  beats: Array<{ id: string; url: string; createdAt: Date; stems: unknown[] }>;
  lyric: { id: string; title: string | null } | null;
};

/**
 * Catalog — the artist's songs as a real WORKSTATION, not a read-only shelf.
 *
 * Nothing is "gone once made": every song can be reused, edited, re-mastered,
 * downloaded, duplicated, and moved. All actions are song-scoped (the catalog
 * only knows a songId) and resolve the project server-side.
 */
export default async function songs(app: FastifyInstance) {
  // ---- List (with per-asset ids/urls so the UI can target the right file) ----
  app.get<{ Querystring: { all?: string } }>('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    // NOTHING IS EVER LOST: default = songs with real audio (or fresh ones still
    // cooking, < 20 min). ?all=1 ALSO returns the hidden ones — lyric-only shells
    // whose render failed/never ran — so "lost versions" are always recoverable
    // from the UI (flagged via audioUrl:null), never silently vanished.
    const showAll = (req.query as { all?: string }).all === '1';
    const rows = await prisma.song.findMany({
      where: {
        workspaceId,
        // QA quarantine: blocked/pulled songs never appear in the catalogue
        // (?all=1 still hides them — quarantine is stronger than the shell filter).
        quarantined: false,
        ...(showAll
          ? {}
          : {
              OR: [
                { beats: { some: {} } },
                { mixes: { some: {} } },
                { masters: { some: {} } },
                { createdAt: { gte: new Date(Date.now() - 20 * 60 * 1000) } },
              ],
            }),
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

    const projectIds = [...new Set(rows.map((s: CatalogRow) => s.projectId))];
    const covers = await prisma.imageAsset.findMany({
      where: { projectId: { in: projectIds }, kind: 'cover' },
      orderBy: { createdAt: 'desc' },
      select: { projectId: true, url: true },
    });
    const coverByProject = new Map<string, string>();
    for (const c of covers) if (c.projectId && !coverByProject.has(c.projectId)) coverByProject.set(c.projectId, c.url);

    return rows.map((s: CatalogRow) => ({
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
  // ADDENDUM R-1 — the bridge pack is FIRST-PARTY tooling: admin-gated, and the
  // vendor identity (brand name, open URL, tips) lives HERE server-side so the
  // public web bundle ships zero vendor strings. '/:id/bridge-export' is the
  // clean route; '/:id/suno-export' stays as a legacy alias (also gated).
  const bridgeExport = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await requireAdmin(req); // §1.11: bridge = first-party only
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
    const brief = laneDna(genre);
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
    // The lyric body carries [Verse]/[Chorus] structure — but OLD drafts can still
    // hold invented production headers ([Drum Fill]) and stage directions Suno
    // would sing. Same render-time law as our own engines (whitelist section
    // tags, map production cues to [Break], strip the rest).
    const lyrics = cleanLyricsForMinimax((song.lyric?.cleanVersion || song.lyric?.body || '').trim());
    return {
      songId: song.id,
      title: song.lyric?.title || song.title,
      stylePrompt,
      lyrics,
      lyricsForSuno: lyrics, // legacy field name — kept for any old client
      hasLyrics: lyrics.length > 0,
      // Vendor identity lives ONLY in this admin-gated response (R-1): the web
      // bundle renders whatever arrives here and ships no vendor strings itself.
      brandName: 'Suno',
      openUrl: 'https://suno.com/create',
      tips: 'In Suno: Create → Custom Mode → turn "Instrumental" OFF → paste Style + Lyrics → Create. Download the WAV, then use "Bring it back" here to master + score it — your account, your rights.',
    };
  };
  // PROOF PACK — "why did this song pass?" from stored measurements only.
  // On demand for ANY song (green-lit or not). Serves the green-light-persisted
  // bundle when it's current; a pack sealed before v2 (no request/training/
  // materials/failures truth) is re-assembled fresh so the richer sections are
  // never hidden behind an old seal — green-light re-persists the new shape.
  app.get<{ Params: { id: string } }>('/:id/proof', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({ where: { id: req.params.id, workspaceId }, select: { proofPack: true } });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const persistedVersion = ((song.proofPack ?? {}) as { proofPackVersion?: number }).proofPackVersion ?? 0;
    if (song.proofPack && persistedVersion >= 2) return { proof: song.proofPack, persisted: true };
    const { assembleProofPack } = await import('../lib/proof-pack');
    const pack = await assembleProofPack(workspaceId, req.params.id);
    if (!pack) return reply.code(404).send({ error: 'song_not_found' });
    return { proof: pack, persisted: false, note: 'assembled on demand — persists automatically at green-light' };
  });

  app.get<{ Params: { id: string } }>('/:id/bridge-export', bridgeExport);
  app.get<{ Params: { id: string } }>('/:id/suno-export', bridgeExport);

  // ---- General edit (rename / version / status) — "not one-shot" ----
  const patchSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    versionLabel: z.string().max(60).nullable().optional(),
    status: z.enum(['SKETCH', 'DEMO', 'FULL', 'MIXED', 'MASTERED', 'RELEASED']).optional(),
    // QA quarantine toggle (operator + the QA gate). Reversible; hides the song
    // from the catalogue/release/public without deleting it.
    quarantined: z.boolean().optional(),
    quarantineReason: z.string().max(300).nullable().optional(),
  });
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const body = patchSchema.parse(req.body);
    const found = await prisma.song.findFirst({ where: { id: req.params.id, workspaceId }, select: { id: true } });
    if (!found) return reply.code(404).send({ error: 'song_not_found' });
    const updated = await prisma.song.update({ where: { id: found.id }, data: body });
    // The catalog displays lyric.title ahead of song.title — keep them in step
    // on rename, or the new name "never sticks" on screen.
    if (body.title) await prisma.lyricDraft.updateMany({ where: { songId: found.id }, data: { title: body.title } });
    return updated;
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

  // ---- VERSIONS: original vs bigger, side by side, so the artist can A/B them.
  // "Make it bigger" re-sings (new beat + master) and rewrites the lyric (the old
  // one snapshotted). Nothing is deleted — the originals were just hidden behind the
  // "freshest" view. This surfaces every audio take + every lyric take together. ----
  app.get<{ Params: { id: string } }>('/:id/versions', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        masters: { orderBy: { createdAt: 'asc' } },
        beats: { orderBy: { createdAt: 'asc' } },
        lyric: { select: { body: true, title: true, versions: true } },
      },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });

    // Audio takes, oldest→newest: prefer masters (the deliverable); fall back to
    // beats if a take never mastered. Drop consecutive duplicate URLs (a promoted
    // master re-points the same file).
    const rows = (song.masters.length ? song.masters : song.beats).map((m: { url: string; createdAt: Date }) => ({ url: m.url, at: m.createdAt }));
    const audio = rows.filter((r: { url: string }, i: number) => i === 0 || r.url !== rows[i - 1]!.url);
    const audioVersions = audio.map((a: { url: string; at: Date }, i: number) => ({
      index: i,
      label: audio.length === 1 ? 'Version' : i === audio.length - 1 ? 'Bigger (current)' : i === 0 ? 'Original' : `Take ${i + 1}`,
      url: a.url,
      at: a.at,
      isCurrent: i === audio.length - 1,
      // per-version download (proxied, clean filename) + a revert affordance for the older takes
      dl: `/songs/${song.id}/file?type=version&index=${i}`,
      canRevert: i !== audio.length - 1,
    }));

    // Lyric takes: the current (bigger) body first, then the snapshot history
    // (the earliest is auto-labelled "original").
    const hist = readVersions(song.lyric?.versions);
    const lyricVersions = [
      { label: 'Bigger (current)', title: song.lyric?.title ?? song.title, body: song.lyric?.body ?? '', at: null as string | null },
      ...hist.map((v) => ({ label: v.label ?? 'earlier take', title: v.title, body: v.body, at: v.at })),
    ].filter((v) => v.body?.trim());

    const hasBigger = /bigger/i.test(song.versionLabel ?? '') || audioVersions.length > 1 || lyricVersions.length > 1;
    return { songId: song.id, versionLabel: song.versionLabel, hasBigger, audioVersions, lyricVersions };
  });

  // ---- Revert audio to ANY prior version (make that take the current one) ----
  // Additive: appends a new master pointing at the chosen take, so nothing is lost
  // and the revert is itself reversible (newest take is always "current").
  app.post<{ Params: { id: string }; Body: { index?: number } }>('/:id/versions/revert', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const idx = Math.max(0, Number(req.body?.index ?? 0));
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { masters: { orderBy: { createdAt: 'asc' } }, beats: { orderBy: { createdAt: 'asc' } } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const rows = (song.masters.length ? song.masters : song.beats).map((m: { url: string }) => ({ url: m.url }));
    const audio = rows.filter((r: { url: string }, i: number) => i === 0 || r.url !== rows[i - 1]!.url);
    const target = audio[idx];
    if (!target) return reply.code(400).send({ error: 'no_such_version', have: audio.length });
    if (idx === audio.length - 1) return { ok: true, alreadyCurrent: true };
    const label = idx === 0 ? 'Original' : `Take ${idx + 1}`;
    const master = await prisma.master.create({
      data: { projectId: song.projectId, songId: song.id, preset: 'reverted', url: target.url, approved: true },
    });
    // The reverted take is now the current audio — a stale instrumental/acapella
    // from the previous take must never be served for it.
    await prisma.song.update({ where: { id: song.id }, data: { instrumentalUrl: null, acapellaUrl: null, instrumentalMeta: Prisma.DbNull } }).catch(() => undefined);
    return { ok: true, revertedTo: label, masterId: master.id, url: target.url };
  });

  // ---- Instrumental for a SPECIFIC version (Demucs on that take) ----
  app.post<{ Params: { id: string }; Body: { index?: number } }>('/:id/versions/instrumental', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const idx = Math.max(0, Number(req.body?.index ?? 0));
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { masters: { orderBy: { createdAt: 'asc' } }, beats: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const rows = song.masters.map((m: { url: string }) => ({ url: m.url }));
    const ded = rows.filter((r: { url: string }, i: number) => i === 0 || r.url !== rows[i - 1]!.url);
    const target = ded[idx] ?? ded[ded.length - 1];
    const beat = song.beats[0];
    if (!target || !beat) return reply.code(400).send({ error: 'no_audio_to_separate' });
    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, `song-instrumental-version:${idx}`);
    const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s', refTable: 'Song', refId: song.id, idempotencyKey });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.music,
      jobName: 'stems',
      workspaceId,
      projectId: song.projectId,
      kind: 'stems',
      provider: 'replicate',
      inputJson: { songId: song.id, beatId: beat.id, mode: 'instrumental', sourceUrl: target.url },
      charge,
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId, projectId: song.projectId, songId: song.id, beatId: beat.id, mode: 'instrumental', sourceUrl: target.url }),
    });
    reply.code(202);
    return { jobId: job.jobId, status: 'queued', replayed: job.replayed, versionIndex: idx, note: 'Instrumental is separating — download it from this version when the job completes.' };
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
        // TRUE INSTRUMENTAL — the finished song minus the voice, loudness-matched
        // to it (never the raw pre-vocal beat). Cleared on re-master/re-sing.
        song.instrumentalUrl && { label: 'Instrumental — full song, voice removed', url: song.instrumentalUrl, kind: 'instrumental', dl: `/songs/${song.id}/file?type=instrumental` },
        song.acapellaUrl && { label: 'Acapella', url: song.acapellaUrl, kind: 'acapella', dl: `/songs/${song.id}/file?type=acapella` },
        ...(beat?.stems ?? []).map((st: { role: string; url: string }) => ({ label: `Stem — ${st.role}`, url: st.url, kind: 'stem', dl: `/songs/${song.id}/file?type=stem&stem=${encodeURIComponent(st.role)}` })),
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
    // The TRUE INSTRUMENTAL / acapella live on the song itself (320k mp3; the WAV
    // is the matching Stem row, served via type=stem).
    else if (type === 'instrumental' && song.instrumentalUrl) { url = song.instrumentalUrl; ext = 'mp3'; }
    else if (type === 'acapella' && song.acapellaUrl) { url = song.acapellaUrl; ext = 'mp3'; }
    else if (type === 'stem' && req.query.stem) {
      // Honest extension: read the stem's REAL stored format (WAV separations
      // were shipping as ".mp3" files under the old hardcode).
      const st = beat?.stems.find((s: { role: string; url: string; format: string }) => s.role === req.query.stem);
      url = st?.url; ext = st?.format ?? 'mp3';
    }
    else if (type === 'version') {
      // Download a SPECIFIC take by its index in the versions list (owned URLs only,
      // resolved server-side — no arbitrary URL, no SSRF).
      const idx = Math.max(0, Number((req.query as { index?: string }).index ?? 0));
      const [ms, bs] = await Promise.all([
        prisma.master.findMany({ where: { songId: song.id }, orderBy: { createdAt: 'asc' }, select: { url: true } }),
        prisma.beatAsset.findMany({ where: { songId: song.id }, orderBy: { createdAt: 'asc' }, select: { url: true, format: true } }),
      ]);
      const rows = ms.length ? ms.map((m: { url: string }) => ({ url: m.url, format: 'wav' })) : bs.map((b: { url: string; format: string | null }) => ({ url: b.url, format: b.format ?? 'mp3' }));
      const ded = rows.filter((r: { url: string }, i: number) => i === 0 || r.url !== rows[i - 1]!.url);
      const t = ded[idx];
      if (t) { url = t.url; ext = ms.length ? 'wav' : (t.format ?? 'mp3'); }
    }
    else if (beat) { url = beat.url; ext = beat.format ?? 'mp3'; }
    if (!url) return reply.code(404).send({ error: 'no_such_asset' });

    const res = await safeFetch(await presignAssetRef(url, 900), { blockMediaHosts: false });
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
  // TRANSFORM — change speed and/or key of the CURRENT take, appended as a new
  // version (Compare/revert already handles it). Pure ffmpeg: no credits charged.
  const transformSchema = z.object({
    tempo: z.number().min(0.5).max(1.5).optional(),
    semitones: z.number().int().min(-6).max(6).optional(),
  }).refine((b) => (b.tempo && Math.abs(b.tempo - 1) > 0.001) || b.semitones, { message: 'set tempo and/or semitones' });
  app.post<{ Params: { id: string } }>('/:id/transform', { schema: { body: transformSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = transformSchema.parse(req.body);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { masters: { orderBy: { createdAt: 'desc' }, take: 1 }, beats: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const sourceUrl = song.masters[0]?.url ?? song.beats[0]?.url;
    if (!sourceUrl) return reply.code(400).send({ error: 'no_audio_yet', message: 'Render the song first, then transform it.' });
    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, `song-transform:${input.tempo ?? 1}:${input.semitones ?? 0}`);
    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.music,
      jobName: 'transform',
      workspaceId,
      projectId: song.projectId,
      kind: 'music',
      provider: 'internal',
      inputJson: { transform: true, songId: song.id, ...input },
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId, projectId: song.projectId, songId: song.id, sourceUrl, ...input }),
    });
    reply.code(202);
    return { jobId: job.jobId, status: 'queued', replayed: job.replayed, note: 'New version lands in Compare Versions in seconds; revert anytime.' };
  });

  app.post<{ Params: { id: string }; Body: { preset?: string } }>('/:id/master', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const requestedPreset = req.body?.preset as string | undefined;
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
      const mix =
        (await prisma.mix.findFirst({ where: { projectId: song.projectId, songId: song.id, preset: 'source', url: sourceUrl } })) ??
        (await prisma.mix.create({
          data: { projectId: song.projectId, songId: song.id, preset: 'source', url: sourceUrl, notes: 'Master source (current rendered audio)', approved: true },
        }));
      mixId = mix.id;
    }

    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, `song-master:${requestedPreset ?? 'default'}`);
    const charge = await app.chargeCredits({ workspaceId, key: 'master_preset', refTable: 'Song', refId: song.id, idempotencyKey });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    // 'finished' routes the CHAIN, not the target: a MiniMax/Suno render (or a
    // re-master of an existing master) is a FINISHED record — light-touch
    // conform, never the full EQ+comp chain that was "mastering a master" into
    // dullness. Raw engines keep the full chain.
    const finished =
      (!realMix && (['minimax', 'suno'].includes(latestBeat?.provider ?? '') || (!latestBeat?.url && !latestMix?.url && !!song.masters[0]?.url))) ||
      realMix?.preset === 'uploaded';
    // LOUDNESS LAW v2: default = commercial Afro loudness (-9 LUFS / -1.0 dBTP,
    // two-pass driven) for every path; 'breathe_-16.5' is the dynamics opt-in.
    const preset = requestedPreset || 'afro_stream_-9';

    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.master,
      jobName: 'create-master',
      workspaceId,
      projectId: song.projectId,
      kind: 'master',
      provider: 'internal',
      inputJson: { songId: song.id, mixId, preset, finished },
      charge,
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId, projectId: song.projectId, songId: song.id, mixId, preset, finished }),
    });
    reply.code(202);
    return { jobId: job.jobId, mixId, replayed: job.replayed };
  });

  // ---- Reuse the beat in a NEW song (optionally a different project) ----
  app.post<{ Params: { id: string }; Body: { targetProjectId?: string; title?: string } }>('/:id/reuse-beat', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { beats: { orderBy: { createdAt: 'desc' }, take: 20, include: { stems: true } }, project: true },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const beat = song.beats.find((candidate: { assetKind: string; qualityState: string; approved: boolean; stems: Array<{ role: string }> }) =>
      candidate.stems.some((stem: { role: string }) => stem.role === 'instrumental')
      || (candidate.assetKind === 'instrumental' && candidate.qualityState === 'passed' && candidate.approved),
    );
    if (!beat) return reply.code(400).send({ error: 'no_beat_to_reuse', message: 'This song has no beat yet.' });

    const targetProjectId = (req.body?.targetProjectId as string) || song.projectId;
    const project = await prisma.project.findFirst({ where: { id: targetProjectId, workspaceId }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: 'target_project_not_found' });

    // "Reuse the BEAT" means a measured instrumental, never a full song with
    // baked-in vocals. A separated stem is re-certified before the mixer sees it.
    const instrumental = beat.stems.find((s: { role: string; url: string }) => s.role === 'instrumental');
    const sourceIsCertifiedInstrumental = beat.assetKind === 'instrumental'
      && beat.qualityState === 'passed'
      && !!beat.contentHash
      && !!beat.verifiedAt
      && beat.approved;
    if (!instrumental && !sourceIsCertifiedInstrumental) {
      return reply.code(409).send({
        error: 'verified_instrumental_required',
        message: 'Extract the instrumental first; a complete song cannot be reused as a backing beat.',
      });
    }
    const reuseUrl = instrumental?.url ?? beat.url;

    const newSong = await prisma.song.create({
      data: { workspaceId, projectId: project.id, title: (req.body?.title as string) || `${song.title} (reuse beat)`, status: 'SKETCH' },
    });
    const pendingCertification = !!instrumental;
    const registered = pendingCertification
      ? await registerBeatForInspection({
          app,
          workspaceId,
          projectId: project.id,
          songId: newSong.id,
          url: reuseUrl,
          format: instrumental!.format ?? 'wav',
          provider: 'instrumental-reuse',
          bpm: beat.bpm,
          keySignature: beat.keySignature,
          claimedDurationS: instrumental!.duration ?? beat.duration,
          sourceMeta: { reusedFromBeat: beat.id, instrumentalStemId: instrumental!.id },
        })
      : null;
    const newBeat = registered?.beat ?? await prisma.beatAsset.create({
      data: {
        projectId: project.id,
        songId: newSong.id,
        url: reuseUrl,
        format: beat.format,
        bpm: beat.bpm,
        keySignature: beat.keySignature,
        duration: beat.duration,
        provider: beat.provider,
        assetKind: 'instrumental',
        qualityState: 'passed',
        contentHash: beat.contentHash,
        verifiedAt: beat.verifiedAt,
        meta: { reusedFromBeat: beat.id, cleanInstrumental: true } as never,
        approved: true,
      },
    });
    // Carry over the non-vocal stems so the reused beat is remixable.
    const carry = beat.stems.filter((s: { role: string }) => s.role !== 'vocals' && s.role !== 'instrumental');
    if (carry.length) {
      await prisma.$transaction(carry.map((st: { role: string; url: string; format: string; duration: number | null }) => prisma.stem.create({ data: { beatId: newBeat.id, role: st.role, url: st.url, format: st.format, duration: st.duration } })));
    }
    reply.code(pendingCertification ? 202 : 201);
    return {
      songId: newSong.id,
      projectId: project.id,
      beatId: newBeat.id,
      cleanInstrumental: true,
      jobId: registered?.job.jobId,
      qualityState: pendingCertification ? 'pending' : 'passed',
      message: pendingCertification
        ? 'Instrumental copied and queued for QC before it enters the mixer.'
        : 'Verified instrumental reused in a new song — write a fresh topline over it.',
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
      include: { beats: { orderBy: { createdAt: 'desc' }, take: 20, include: { stems: true } } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const beat = song.beats.find((candidate: { stems: Array<{ role: string }> }) =>
      candidate.stems.some((stem: { role: string }) => stem.role === 'instrumental'),
    );
    const instrumental = beat?.stems.find((s: { role: string; url: string; format: string; duration: number | null }) => s.role === 'instrumental');
    if (!instrumental) {
      return reply.code(400).send({ error: 'no_instrumental_stem', message: 'Run "Instrumental" on this song first to extract the clean instrumental, then reuse it.' });
    }

    const targetProjectId = (req.body?.targetProjectId as string) || song.projectId;
    const project = await prisma.project.findFirst({ where: { id: targetProjectId, workspaceId }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: 'target_project_not_found' });

    const newSong = await prisma.song.create({
      data: { workspaceId, projectId: project.id, title: (req.body?.title as string) || `${song.title} (instrumental)`, status: 'SKETCH' },
    });
    const { beat: newBeat, job } = await registerBeatForInspection({
      app,
      workspaceId,
      projectId: project.id,
      songId: newSong.id,
      url: instrumental.url,
      format: instrumental.format ?? 'wav',
      bpm: beat!.bpm,
      keySignature: beat!.keySignature,
      claimedDurationS: instrumental.duration ?? beat!.duration,
      provider: 'instrumental-reuse',
      sourceMeta: { reusedInstrumentalFromBeat: beat!.id, instrumental: true },
    });
    reply.code(202);
    return { songId: newSong.id, projectId: project.id, beatId: newBeat.id, jobId: job.jobId, qualityState: 'pending', message: 'Instrumental copied and queued for QC before it enters the mixer.' };
  });

  // ---- Re-sing the song with the CURRENT (edited) lyrics — the surgical edit ----
  // Edit lyrics → save → re-sing: renders a fresh vocal over the same lane, and
  // because the new beat is the freshest audio it becomes the song's current take.
  app.post<{ Params: { id: string }; Body: { songEngine?: 'suno' | 'eleven' | 'ace_step' | 'minimax'; conditionOnCurrent?: boolean } }>('/:id/regenerate-beat', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { project: { include: { artist: true } }, lyric: true, beats: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const lyric = song.lyric ?? (await prisma.lyricDraft.findFirst({ where: { projectId: song.projectId }, orderBy: { createdAt: 'desc' } }));
    const lyrics = lyric?.cleanVersion ?? lyric?.body ?? undefined;
    if (!lyrics) return reply.code(400).send({ error: 'no_lyrics', message: 'Write or edit lyrics first, then re-sing.' });

    // Preserve an explicit or previous vocal route only when it remains legal
    // and connected. Validate before lyric enrichment or credit reservation.
    const prev = song.beats[0]?.provider ?? '';
    const songEngine =
      (req.body?.songEngine as 'suno' | 'eleven' | 'ace_step' | 'minimax' | undefined) ??
      (['suno', 'eleven', 'minimax', 'ace_step'].includes(prev) ? (prev as 'suno' | 'eleven' | 'ace_step' | 'minimax') : undefined);
    const route = validateMusicRoute(songEngine, await musicRouteCapabilities(workspaceId), true);
    if (!route.ok) return reply.code(route.statusCode).send({ error: route.error, message: route.message });

    const genre = song.project.genre;
    const dna = laneDna(genre);
    const learned = await learnedReferenceBrief(workspaceId, genre);
    // SELF-CLONE BLUEPRINT — "same structure, different sound": this song's own
    // measured skeleton becomes the contract for its regeneration.
    const selfBp: SongBlueprint | null = blueprintFromMeasured(((song.beats[0]?.meta ?? {}) as { measured?: MeasuredAnalysis }).measured);
    let lyricsForSong = lyrics;
    let styleHints: string[] = [];
    const enriched = await enrichLyricsForVocals({
      genre: genre,
      lyricBody: lyrics,
      languages: song.project.artist.languages,
      laneSummary: song.project.artist.laneSummary ?? undefined,
      soundDna: [selfBp ? structureBrief(selfBp) : null, dna.brief, learned].filter(Boolean).join('\n\n'),
    });
    if (enriched) {
      lyricsForSong = enriched.enrichedLyrics;
      styleHints = enriched.styleTags;
    }

    // Keep the previous engine if it was a vocal engine; else let the worker
    // Omit the override to use the workspace's connected automatic route.
    // PHASE 4 loop — this IS a regen, so inject the repair steering stored on the
    // song's last measured take (from laneContext) as concrete style directives, the
    // same as createBeatJob. This is where a drifted take gets pushed back in-lane.
    const lane = await laneContext(workspaceId, genre, song.id);
    const laneSteer = lane.repair
      ? lane.repair.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()).slice(0, 3)
      : [];

    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'song-regenerate');
    const charge = await app.chargeCredits({ workspaceId, key: 'full_song_demo', refTable: 'Song', refId: song.id, idempotencyKey });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.music,
      jobName: 'generate-music',
      workspaceId,
      projectId: song.projectId,
      kind: 'music',
      provider: songEngine ?? 'auto',
      inputJson: { regenerate: true, songId: song.id },
      charge,
      idempotencyKey,
      payload: (jobId) => ({
        jobId, workspaceId, projectId: song.projectId, songId: song.id,
        input: {
          genre, bpm: song.project.bpm ?? 103, withVocals: true, withStems: false, songEngine,
          // A3-2: Adjust passes conditionOnCurrent — the song's own audio goes IN
          // as the reference so the repair builds from the sound, not from tags.
          referenceAudioUrl: req.body?.conditionOnCurrent ? song.beats[0]?.url ?? undefined : undefined,
          // A re-sing must stay FULL LENGTH: its own measured duration first,
          // genre standard otherwise. With no durationS at all, ACE-Step fell to
          // its 120s default — the will-it-blow gate's final re-sing was
          // silently SHORTENING finished songs.
          durationS: selfBp?.totalDurationS ?? genreSignature(genre).durationS,
          lyrics: lyricsForSong,
          artistTone: song.project.artist.vocalTone, languages: song.project.artist.languages,
          dnaTags: [languageVocalTag(song.project.artist.languages), ...(dna.tags ?? []), ...styleHints.slice(0, 3), ...laneSteer, ...(selfBp ? [`structure ${selfBp.sections.length} sections`] : [])].slice(0, 12),
          blueprint: selfBp ?? undefined,
        },
      }),
    });
    reply.code(202);
    return { jobId: job.jobId, status: 'queued', replayed: job.replayed, message: "Re-singing with your edited lyrics — it becomes the song's current audio when it finishes." };
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
        await prisma.$transaction(beat.stems.map((st: { role: string; url: string; format: string; duration: number | null }) => prisma.stem.create({ data: { beatId: newBeat.id, role: st.role, url: st.url, format: st.format, duration: st.duration } })));
      }
    }
    reply.code(201);
    return { songId: copy.id, projectId: project.id };
  });

  // ---- Instrumental + stems (Demucs stem separation) ----
  app.post<{ Params: { id: string }; Body: { mode?: 'instrumental' | 'acapella' | 'full' } }>('/:id/stems', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const mode = req.body?.mode === 'full' ? 'full' : req.body?.mode === 'acapella' ? 'acapella' : 'instrumental';
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        masters: { orderBy: { createdAt: 'desc' }, take: 1 },
        mixes: { orderBy: { createdAt: 'desc' }, take: 1 },
        beats: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const beat = song.beats[0];
    if (!beat) return reply.code(400).send({ error: 'no_audio_to_separate' });
    // THE SOURCE IS WHAT THE USER HEARS — freshest master → mix → beat. The old
    // path always separated the raw pre-vocal beat, so "instrumental" wasn't the
    // finished song minus the voice. Resolved server-side; the worker gets a URL.
    const sourceUrl = freshestAudioUrl(song) ?? beat.url;

    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, `song-stems:${mode}`);
    const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s', refTable: 'Song', refId: song.id, idempotencyKey });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    const job = await createQueuedProviderJob({
      app,
      queue: app.queues.music,
      jobName: 'stems',
      workspaceId,
      projectId: song.projectId,
      kind: 'stems',
      provider: 'replicate',
      inputJson: { songId: song.id, beatId: beat.id, mode, sourceUrl },
      charge,
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId, projectId: song.projectId, songId: song.id, beatId: beat.id, mode, sourceUrl }),
    });
    reply.code(202);
    return { jobId: job.jobId, status: 'queued', replayed: job.replayed, mode };
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

    const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'song-hit-score');
    const charge = await app.chargeCredits({ workspaceId, key: 'hit_predict', refTable: 'Song', refId: song.id, idempotencyKey });
    if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

    if (charge.replayed) {
      const prior = await prisma.providerJob.findUnique({ where: { chargeLedgerId: charge.chargeId }, select: { status: true, outputJson: true } });
      if (prior?.status === 'SUCCEEDED' && prior.outputJson) return prior.outputJson;
      if (prior?.status === 'RUNNING' || prior?.status === 'QUEUED') {
        return reply.code(409).send({ error: 'hit_score_in_progress' });
      }
      if (prior?.status === 'FAILED') {
        return reply.code(503).send({ error: 'a&r_unavailable', message: 'The prior hit-scout attempt failed. Start a new request to retry.' });
      }
    }

    let auditJob: { id: string };
    try {
      auditJob = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: song.projectId,
          kind: 'hit-score',
          provider: 'anthropic',
          status: 'RUNNING',
          inputJson: { songId: song.id } as never,
          chargeLedgerId: charge.chargeId,
          idempotencyKey,
          startedAt: new Date(),
        },
        select: { id: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return reply.code(409).send({ error: 'hit_score_in_progress' });
    }

    const genre = song.project.genre;
    const trends = (await researchTrends({ genre }).catch(() => null))?.digest;
    const hook = song.hooks[0]?.text ?? undefined;
    let prediction: Awaited<ReturnType<typeof predictHit>>;
    try {
      prediction = await predictHit({
        title: song.lyric?.title || song.title,
        genre,
        bpm: song.project.bpm ?? undefined,
        hook,
        lyrics: song.lyric?.body ?? undefined,
        soundDna: laneDnaBrief(genre),
        trends,
        hasMaster: song.masters.length > 0,
        languages: song.project.artist.languages,
      });
      if (!prediction) throw new Error('hit predictor unavailable');
    } catch (error) {
      await Promise.all([
        prisma.providerJob.update({ where: { id: auditJob.id }, data: { status: 'FAILED', finishedAt: new Date(), errorJson: { message: error instanceof Error ? error.message : 'hit predictor failed' } as never } }),
        app.refundCredits({ workspaceId, key: 'hit_predict', refTable: 'Song', refId: song.id, chargeId: charge.chargeId }),
      ]);
      return reply.code(503).send({ error: 'a&r_unavailable', message: 'Hit scout needs a configured AI provider and a healthy provider connection.' });
    }

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
    const result = { songId: song.id, ...prediction };
    await prisma.providerJob.update({ where: { id: auditJob.id }, data: { status: 'SUCCEEDED', finishedAt: new Date(), outputJson: result as never } });
    return result;
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
    const operationKey = scopedRequestKey(req.headers as Record<string, unknown>, 'make-it-bigger');
    const operation = await runIdempotentOperation({
      workspaceId,
      kind: 'make-it-bigger',
      provider: 'internal',
      idempotencyKey: operationKey,
      inputJson: { songId: req.params.id },
      execute: () => improveSongOnce(app, workspaceId, req.params.id, { operationKey }),
    });
    if (operation.state !== 'completed') {
      const failure = operationErrorBody(operation);
      return reply.code(failure.statusCode).send(failure.body);
    }
    const res = operation.value;
    if ('error' in res) {
      const status: Record<string, number> = { song_not_found: 404, no_lyrics: 400, 'a&r_unavailable': 503, insufficient_credits: 402, rewrite_failed: 503 };
      const message: Record<string, string> = {
        no_lyrics: 'This song has no lyric to improve — generate or attach one first.',
        'a&r_unavailable': 'The A&R read failed — run "Will it hit?" first; its notes drive the rewrite.',
      };
      return reply.code(status[res.error] ?? 400).send({ error: res.error, ...(message[res.error] ? { message: message[res.error] } : {}) });
    }
    await arReadAfterRender(app, workspaceId, [{ songId: req.params.id, jobId: res.jobId }]);
    reply.code(202);
    return { jobId: res.jobId, status: 'queued', whatChanged: res.whatChanged, message: 'A&R notes implemented — re-singing the bigger version. It auto-masters and re-scores when done.' };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      include: {
        beats: { select: { url: true, stems: { select: { url: true } } } },
        vocalRenders: { select: { url: true } },
        mixes: { select: { url: true } },
        masters: { select: { url: true } },
        exports: { select: { bundle: true } },
      },
    });
    if (song) {
      const refs = songAssetRefs(song);
      await prisma.$transaction(async (tx) => {
        await queueAssetDeletion(tx, { workspaceId, refs, reason: `song:${song.id}` });
        await tx.song.delete({ where: { id: song.id } });
      });
      void app.dispatchPendingJobs().catch((error) => req.log.error({ err: error }, 'asset cleanup dispatch failed'));
    }
    reply.code(204);
    return null;
  });
}

/**
 * LYRICS LOCK AFTER VIDEO (owner, 2026-07-20: "after they make a video, no
 * more lyric edits — critical").
 *
 * "A video is done" is decided by the SAME evidence that puts a video on the
 * song's catalog card (routes/songs.ts list mapping):
 *   1. an ASSEMBLED cut exists — a VideoRender carrying meta.assembly on one
 *      of this song's own concepts (SongRow.video's source), OR on an orphan
 *      concept (songId null, pre-per-song era / chat-made) in the song's
 *      project that is bound to this song the same way the card binds it:
 *      meta.assembly.audioSource.songId (authoritative), or the project holds
 *      only this one song. Never guessed in multi-song projects.
 *   2. rendered SCENES exist — perShotRenders(...) > 0 on the song's own
 *      concepts (the videoScenesReady source). The owner said after they MAKE
 *      a video; paid scene renders are video work done, and an edit that
 *      re-sings the song would orphan every one of them.
 * Either one locks. GET lyrics stays readable, and reuse-lyrics into a NEW
 * song stays allowed — the lock only stops the ORIGINAL's words drifting away
 * from its finished video.
 */
import { prisma } from '@afrohit/db';
import { perShotRenders } from '@afrohit/shared';

export type LyricsLockReason = 'assembled_cut' | 'rendered_scenes';

export const LYRICS_LOCKED_MESSAGE =
  'This song already has a video — its lyrics are locked so the song and video can never drift apart. Reuse the lyrics into a new song to keep writing.';

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const assemblyOf = (meta: unknown): Record<string, unknown> | null =>
  asRecord(asRecord(meta)?.assembly);

export async function lyricsVideoLock(
  songId: string,
  projectId: string,
): Promise<{ locked: boolean; reason: LyricsLockReason | null }> {
  const concepts = await prisma.videoConcept.findMany({
    where: { songId },
    select: { id: true },
  });
  if (concepts.length) {
    const renders = await prisma.videoRender.findMany({
      where: { conceptId: { in: concepts.map((c: { id: string }) => c.id) } },
      select: { id: true, url: true, createdAt: true, meta: true },
    });
    if (renders.some((r: { url: string; meta: unknown }) => !!r.url && !!assemblyOf(r.meta))) {
      return { locked: true, reason: 'assembled_cut' };
    }
    if (perShotRenders(renders).size > 0) {
      return { locked: true, reason: 'rendered_scenes' };
    }
  }
  // Orphan-concept recovery — the same read-only binding the catalog card uses
  // for "missing videos": an assembled cut on a songId-null concept in this
  // project counts only when its audioSource names THIS song, or when the
  // project has no other song it could belong to.
  const orphans = await prisma.videoConcept.findMany({
    where: { projectId, songId: null },
    select: { id: true },
  });
  if (!orphans.length) return { locked: false, reason: null };
  const orphanRenders = await prisma.videoRender.findMany({
    where: { conceptId: { in: orphans.map((c: { id: string }) => c.id) } },
    select: { url: true, meta: true },
  });
  let soleSong: boolean | null = null; // computed lazily — one count at most
  for (const r of orphanRenders) {
    const assembly = assemblyOf(r.meta);
    if (!assembly || !r.url) continue;
    const boundSongId = asRecord(assembly.audioSource)?.songId;
    if (boundSongId === songId) return { locked: true, reason: 'assembled_cut' };
    if (typeof boundSongId === 'string') continue; // bound to a sibling — not ours
    if (soleSong === null) {
      soleSong = (await prisma.song.count({ where: { projectId } })) === 1;
    }
    if (soleSong) return { locked: true, reason: 'assembled_cut' };
  }
  return { locked: false, reason: null };
}

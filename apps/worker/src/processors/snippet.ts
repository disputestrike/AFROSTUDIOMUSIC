import { prisma } from '@afrohit/db';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { downloadToBuffer, uploadBytes } from '../lib/storage';
import { ffmpegAvailable, buildSnippet } from '../lib/ffmpeg';

interface SnippetPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  startS?: number;
}

/** Wrap a hook into short caption lines for the burned-in text. */
function wrapCaption(text: string, max = 20, maxLines = 4): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line.trim());
  return lines.slice(0, maxLines).join('\n');
}

/** Best-effort: fetch a bold display font for the caption. Undefined → no caption. */
async function ensureFont(): Promise<string | undefined> {
  try {
    const res = await fetch('https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf');
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    const p = join(tmpdir(), 'afrohit-anton.ttf');
    await writeFile(p, buf);
    return p;
  } catch {
    return undefined;
  }
}

/**
 * Build a vertical 9:16 shareable snippet — the thing that actually spreads.
 * Uses the finished master (or mix) + cover art + the hook as a caption.
 */
export async function processSnippet(p: SnippetPayload) {
  await markRunning(p.jobId);
  try {
    if (!(await ffmpegAvailable())) throw new Error('ffmpeg not found on worker host');
    const song = await prisma.song.findFirstOrThrow({ where: { id: p.songId }, include: { lyric: true } });

    const master = await prisma.master.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } });
    const mix = await prisma.mix.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } });
    // Fall back to the beat so snippets work for the default Create/Drop/autopilot
    // flow (those produce only a BeatAsset — no master/mix until the user masters).
    const beat = await prisma.beatAsset.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } });
    const audioUrl = master?.url ?? mix?.url ?? beat?.url;
    if (!audioUrl) throw new Error('no audio on this song yet — make the song first');

    const cover = await prisma.imageAsset.findFirst({
      where: { projectId: song.projectId, kind: 'cover' },
      orderBy: { createdAt: 'desc' },
    });
    const hook = await prisma.hookCandidate.findFirst({
      where: { songId: song.id, approved: true },
      orderBy: { createdAt: 'desc' },
    });
    const captionRaw =
      hook?.text?.split('(')[0] ?? song.lyric?.title ?? song.lyric?.body?.split('\n').find((l) => l.trim()) ?? song.title;

    const [audio, coverBuf, fontPath] = await Promise.all([
      downloadToBuffer(audioUrl),
      cover ? downloadToBuffer(cover.url) : Promise.resolve(undefined),
      ensureFont(),
    ]);

    const mp4 = await buildSnippet({
      audio,
      cover: coverBuf,
      captionText: captionRaw ? wrapCaption(captionRaw) : undefined,
      fontPath,
      startS: p.startS ?? 8,
      durS: 22,
    });

    const url = await uploadBytes({
      workspaceId: p.workspaceId,
      kind: 'snippets',
      bytes: mp4,
      contentType: 'video/mp4',
      ext: 'mp4',
    });

    const vr = await prisma.videoRender.create({
      data: {
        projectId: song.projectId,
        url,
        durationS: 22,
        provider: 'snippet',
        meta: { snippet: true, songId: song.id, format: '9:16' } as never,
      },
    });
    await prisma.analyticsEvent
      .create({ data: { workspaceId: p.workspaceId, name: 'taste.snippet_made', properties: { songId: song.id } as never } })
      .catch(() => {});

    await markSucceeded(p.jobId, { url, videoRenderId: vr.id, kind: 'snippet' });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}

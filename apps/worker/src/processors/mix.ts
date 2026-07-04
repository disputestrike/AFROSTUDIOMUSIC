import { prisma } from '@afrohit/db';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { downloadToBuffer, uploadBytes } from '../lib/storage';
import { ffmpegAvailable, mixdown, mixdownConsole, type ConsoleTrack } from '../lib/ffmpeg';

interface ConsoleTrackPayload {
  id: string;
  kind: 'beat' | 'vocal';
  url: string;
  gainDb: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  eq: { low: number; mid: number; high: number };
  comp: { on: boolean; threshold: number; ratio: number };
  reverb: number;
}

interface MixPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  preset: string;
  settings?: ConsoleTrackPayload[];
}

/**
 * Real mixdown: latest approved beat + latest approved lead vocal → FFmpeg
 * preset chain → WAV in object storage → Mix row.
 */
export async function processMix(p: MixPayload) {
  await markRunning(p.jobId);
  try {
    if (!(await ffmpegAvailable())) {
      throw new Error('ffmpeg binary not found on worker host — install ffmpeg (Railway nixpacks includes it)');
    }
    const song = await prisma.song.findFirstOrThrow({ where: { id: p.songId } });

    // Hands-on mixer console: per-track gain/pan/EQ/comp/reverb.
    if (p.settings && p.settings.length) {
      await processConsoleMix(p, song.title);
      return;
    }

    const beat = await prisma.beatAsset.findFirst({
      where: { songId: p.songId, approved: true },
      orderBy: { createdAt: 'desc' },
    });
    const vocal = await prisma.vocalRender.findFirst({
      where: { songId: p.songId, role: 'lead', approved: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!beat) throw new Error('mix requires an approved beat (approve one in the project first)');
    if (!vocal) throw new Error('mix requires an approved lead vocal');

    const [beatBytes, vocalBytes] = await Promise.all([
      downloadToBuffer(beat.url),
      downloadToBuffer(vocal.url),
    ]);
    const mixed = await mixdown({ beat: beatBytes, vocal: vocalBytes, preset: p.preset });
    const url = await uploadBytes({
      workspaceId: p.workspaceId,
      kind: 'mixes',
      bytes: mixed,
      contentType: 'audio/wav',
      ext: 'wav',
    });

    const mix = await prisma.mix.create({
      data: {
        projectId: p.projectId,
        songId: p.songId,
        preset: p.preset,
        url,
        notes: `FFmpeg mixdown — beat ${beat.id.slice(-6)}, vocal ${vocal.id.slice(-6)}. Song: ${song.title}`,
      },
    });
    await prisma.song.update({ where: { id: p.songId }, data: { status: 'MIXED' } });
    await markSucceeded(p.jobId, { mixId: mix.id, url });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}

/**
 * Console mixdown: download each track, apply its channel strip, sum to a Mix.
 * The mixer settings are persisted so the console reloads exactly as left.
 */
async function processConsoleMix(p: MixPayload, songTitle: string) {
  const settings = p.settings!;
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-console-in-'));
  try {
    const tracks: ConsoleTrack[] = await Promise.all(
      settings.map(async (s, i) => {
        const bytes = await downloadToBuffer(s.url);
        const path = join(dir, `t${i}.bin`);
        await writeFile(path, bytes);
        return {
          path,
          gainDb: s.gainDb,
          pan: s.pan,
          mute: s.mute,
          solo: s.solo,
          eq: s.eq,
          comp: s.comp,
          reverb: s.reverb,
        };
      })
    );

    const mixed = await mixdownConsole(tracks);
    const url = await uploadBytes({
      workspaceId: p.workspaceId,
      kind: 'mixes',
      bytes: mixed,
      contentType: 'audio/wav',
      ext: 'wav',
    });

    const mix = await prisma.mix.create({
      data: {
        projectId: p.projectId,
        songId: p.songId,
        preset: 'console',
        url,
        notes: `Console mix — ${settings.length} tracks. Song: ${songTitle}`,
        settings: settings as never,
      },
    });
    await prisma.song.update({ where: { id: p.songId }, data: { status: 'MIXED' } });
    await markSucceeded(p.jobId, { mixId: mix.id, url });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

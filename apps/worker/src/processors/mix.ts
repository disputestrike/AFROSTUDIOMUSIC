import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@afrohit/db';
import { markFailed, markRunning } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer, uploadBytes } from '../lib/storage';
import {
  ffmpegAvailable,
  measureAudioQuality,
  mixdown,
  mixdownConsole,
  type ConsoleTrack,
} from '../lib/ffmpeg';

interface ConsoleTrackPayload {
  id: string;
  kind: 'beat' | 'vocal';
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

const mixableVocalWhere = {
  approved: true,
  assetKind: 'isolated_vocal',
  qualityState: 'passed',
  contentHash: { not: null },
  verifiedAt: { not: null },
} as const;

const mixableBeatWhere = {
  approved: true,
  assetKind: 'instrumental',
  qualityState: 'passed',
  contentHash: { not: null },
  verifiedAt: { not: null },
} as const;

async function certifyAndStore(workspaceId: string, bytes: Buffer) {
  const url = await uploadBytes({
    workspaceId,
    kind: 'mixes',
    bytes,
    contentType: 'audio/wav',
    ext: 'wav',
  });
  try {
    const qc = await measureAudioQuality(url);
    if (qc.verdict !== 'pass') {
      throw new Error(`mix_qc_failed: ${qc.flags.join(', ') || qc.verdict}`);
    }
    return {
      url,
      qc,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      verifiedAt: new Date(),
    };
  } catch (error) {
    await deleteObjectByUrl(url).catch(() => undefined);
    throw error;
  }
}

async function persistSuccess(opts: {
  payload: MixPayload;
  songTitle: string;
  preset: string;
  bytes: Buffer;
  notes: string;
  settings?: ConsoleTrackPayload[];
  source: Record<string, unknown>;
}) {
  const certified = await certifyAndStore(opts.payload.workspaceId, opts.bytes);
  try {
    return await prisma.$transaction(async (tx) => {
      const mix = await tx.mix.create({
        data: {
          projectId: opts.payload.projectId,
          songId: opts.payload.songId,
          preset: opts.preset,
          url: certified.url,
          notes: `${opts.notes} Song: ${opts.songTitle}`,
          settings: opts.settings as never,
          qualityState: 'passed',
          contentHash: certified.contentHash,
          verifiedAt: certified.verifiedAt,
          meta: { qc: certified.qc, source: opts.source } as never,
          approved: true,
        },
      });
      await tx.song.update({ where: { id: opts.payload.songId }, data: { status: 'MIXED' } });
      await tx.providerJob.update({
        where: { id: opts.payload.jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          outputJson: {
            mixId: mix.id,
            url: mix.url,
            qualityState: mix.qualityState,
            contentHash: mix.contentHash,
            qc: certified.qc,
          } as never,
        },
      });
      return mix;
    });
  } catch (error) {
    await deleteObjectByUrl(certified.url).catch(() => undefined);
    throw error;
  }
}

export async function processMix(payload: MixPayload): Promise<void> {
  await markRunning(payload.jobId);
  try {
    if (!(await ffmpegAvailable())) throw new Error('ffmpeg binary not found on worker host');
    const song = await prisma.song.findFirstOrThrow({
      where: {
        id: payload.songId,
        projectId: payload.projectId,
        workspaceId: payload.workspaceId,
      },
    });
    if (payload.settings?.length) {
      await processConsoleMix(payload, song.title);
      return;
    }

    const [beat, vocal] = await Promise.all([
      prisma.beatAsset.findFirst({
        where: { songId: payload.songId, projectId: payload.projectId, ...mixableBeatWhere },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.vocalRender.findFirst({
        where: { songId: payload.songId, projectId: payload.projectId, role: 'lead', ...mixableVocalWhere },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!beat) throw new Error('mix requires an approved beat');
    if (!vocal) throw new Error('mix requires a QC-passed isolated lead vocal');
    const [beatBytes, vocalBytes] = await Promise.all([
      downloadToBuffer(beat.url),
      downloadToBuffer(vocal.url),
    ]);
    const mixed = await mixdown({ beat: beatBytes, vocal: vocalBytes, preset: payload.preset });
    await persistSuccess({
      payload,
      songTitle: song.title,
      preset: payload.preset,
      bytes: mixed,
      notes: `Verified FFmpeg mixdown - beat ${beat.id.slice(-6)}, vocal ${vocal.id.slice(-6)}.`,
      source: { beatId: beat.id, vocalRenderIds: [vocal.id] },
    });
  } catch (error) {
    await markFailed(payload.jobId, error);
  }
}

async function processConsoleMix(payload: MixPayload, songTitle: string): Promise<void> {
  const posted = payload.settings!;
  const ids = [...new Set(posted.map((setting) => setting.id))];
  const [beats, vocals] = await Promise.all([
    prisma.beatAsset.findMany({
      where: {
        id: { in: ids },
        songId: payload.songId,
        projectId: payload.projectId,
        ...mixableBeatWhere,
      },
      select: { id: true, url: true },
    }),
    prisma.vocalRender.findMany({
      where: {
        id: { in: ids },
        songId: payload.songId,
        projectId: payload.projectId,
        ...mixableVocalWhere,
      },
      select: { id: true, url: true },
    }),
  ]);
  const assets = new Map<string, { kind: 'beat' | 'vocal'; url: string }>([
    ...beats.map((beat: { id: string; url: string }) => [beat.id, { kind: 'beat' as const, url: beat.url }] as const),
    ...vocals.map((vocal: { id: string; url: string }) => [vocal.id, { kind: 'vocal' as const, url: vocal.url }] as const),
  ]);
  const invalidIds = ids.filter((id) => !assets.has(id));
  if (invalidIds.length) throw new Error(`console mix contains invalid tracks: ${invalidIds.join(',')}`);

  const settings = posted.map((setting) => ({ ...setting, kind: assets.get(setting.id)!.kind }));
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-console-in-'));
  try {
    const tracks: ConsoleTrack[] = await Promise.all(settings.map(async (setting, index) => {
      const bytes = await downloadToBuffer(assets.get(setting.id)!.url);
      const path = join(dir, `track-${index}.bin`);
      await writeFile(path, bytes);
      return {
        path,
        gainDb: setting.gainDb,
        pan: setting.pan,
        mute: setting.mute,
        solo: setting.solo,
        eq: setting.eq,
        comp: setting.comp,
        reverb: setting.reverb,
      };
    }));
    const mixed = await mixdownConsole(tracks);
    await persistSuccess({
      payload,
      songTitle,
      preset: 'console',
      bytes: mixed,
      notes: `Verified console mix - ${settings.length} tracks.`,
      settings,
      source: {
        beatIds: settings.filter((setting) => setting.kind === 'beat').map((setting) => setting.id),
        vocalRenderIds: settings.filter((setting) => setting.kind === 'vocal').map((setting) => setting.id),
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

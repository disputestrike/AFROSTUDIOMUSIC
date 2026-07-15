import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadReleaseCertification, prisma, releaseEvidenceHash } from '@afrohit/db';
import { canonicalJson } from '@afrohit/shared';
import { ffmpegAvailable, runFfmpeg } from '../lib/ffmpeg';
import { markFailed, markRunning } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer, uploadBytes } from '../lib/storage';

interface ExportPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  receiptId?: string;
}

type PackageFile = { path: string; bytes: Buffer };
type ManifestEntry = { path: string; sizeBytes: number; sha256: string };
type JsonRecord = Record<string, unknown>;

const ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');
const MAX_ARCHIVE_BYTES = 900 * 1024 * 1024;

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeFileBase(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .toLowerCase() || 'afrohit-release';
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return '"' + text.replace(/"/g, '""') + '"';
}

async function renderReleaseMedia(options: {
  audio: Buffer;
  cover: Buffer;
  backingTrack?: Buffer | null;
}): Promise<{ wav: Buffer; mp3: Buffer; coverJpg: Buffer; backingWav?: Buffer }> {
  const directory = await mkdtemp(join(tmpdir(), 'afrohit-release-'));
  const sourceAudio = join(directory, 'source-audio');
  const sourceCover = join(directory, 'source-cover');
  const wavPath = join(directory, 'master.wav');
  const mp3Path = join(directory, 'master.mp3');
  const coverPath = join(directory, 'cover.jpg');
  try {
    await Promise.all([
      writeFile(sourceAudio, options.audio),
      writeFile(sourceCover, options.cover),
    ]);
    await runFfmpeg([
      '-i', sourceAudio,
      '-map_metadata', '-1',
      '-vn',
      '-ac', '2',
      '-ar', '44100',
      '-c:a', 'pcm_s24le',
      '-fflags', '+bitexact',
      '-flags:a', '+bitexact',
      wavPath,
    ]);
    await runFfmpeg([
      '-i', sourceAudio,
      '-map_metadata', '-1',
      '-vn',
      '-ac', '2',
      '-ar', '44100',
      '-c:a', 'libmp3lame',
      '-b:a', '320k',
      '-fflags', '+bitexact',
      '-flags:a', '+bitexact',
      mp3Path,
    ]);
    await runFfmpeg([
      '-i', sourceCover,
      '-map_metadata', '-1',
      '-vf', 'scale=3000:3000:force_original_aspect_ratio=increase:flags=lanczos,crop=3000:3000,format=rgb24',
      '-frames:v', '1',
      '-q:v', '2',
      coverPath,
    ]);

    let backingWav: Buffer | undefined;
    if (options.backingTrack) {
      const backingSource = join(directory, 'backing-source');
      const backingPath = join(directory, 'backing.wav');
      await writeFile(backingSource, options.backingTrack);
      await runFfmpeg([
        '-i', backingSource,
        '-map_metadata', '-1',
        '-vn',
        '-ac', '2',
        '-ar', '44100',
        '-c:a', 'pcm_s24le',
        '-fflags', '+bitexact',
        '-flags:a', '+bitexact',
        backingPath,
      ]);
      backingWav = await readFile(backingPath);
    }
    return {
      wav: await readFile(wavPath),
      mp3: await readFile(mp3Path),
      coverJpg: await readFile(coverPath),
      ...(backingWav ? { backingWav } : {}),
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function addPackageFile(files: PackageFile[], path: string, value: Buffer | string): void {
  files.push({ path, bytes: Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8') });
}

export async function processExport(payload: ExportPayload): Promise<void> {
  await markRunning(payload.jobId);
  let archiveUrl: string | null = null;
  try {
    if (!(await ffmpegAvailable())) throw new Error('release_export_requires_ffmpeg');
    const certification = await loadReleaseCertification(prisma, {
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      songId: payload.songId,
      hitTarget: Number(process.env.WILL_IT_BLOW_TARGET ?? 90),
    });
    if (!certification.readiness.ready) {
      const failed = certification.readiness.checks
        .filter((check: { ok: boolean }) => !check.ok)
        .map((check: { name: string }) => check.name)
        .join(', ');
      throw new Error('export_blocked: ' + (failed || 'release evidence is incomplete'));
    }
    if (!certification.audio || !certification.cover || !certification.lyric || !certification.rightsReceipt) {
      throw new Error('export_blocked: certified audio, cover, lyrics, and rights receipt are required');
    }
    if (payload.receiptId && payload.receiptId !== certification.rightsReceipt.id) {
      throw new Error('export_blocked: queued rights receipt is stale');
    }

    const sourceFingerprint = releaseEvidenceHash({
      version: 1,
      artifacts: certification.artifactSnapshot,
      rightsReceipt: {
        id: certification.rightsReceipt.id,
        hash: certification.rightsReceipt.hash,
      },
      splitAttestation: certification.splitAttestation
        ? { id: certification.splitAttestation.id, hash: certification.splitAttestation.hash }
        : null,
      nativeAttestation: certification.nativeAttestation
        ? { id: certification.nativeAttestation.id, hash: certification.nativeAttestation.hash }
        : null,
      format: {
        wav: 'pcm_s24le_44100_stereo',
        mp3: '320k_44100_stereo',
        cover: 'jpeg_rgb_3000_square',
        zip: 'deflate9_deterministic_date',
      },
    });
    const existing = await prisma.export.findUnique({
      where: { songId_sourceFingerprint: { songId: payload.songId, sourceFingerprint } },
    });
    if (
      existing
      && existing.qualityState === 'ready'
      && existing.archiveUrl
      && existing.contentHash
      && existing.verifiedAt
    ) {
      await prisma.$transaction([
        prisma.song.update({ where: { id: payload.songId }, data: { status: 'EXPORTED' } }),
        prisma.providerJob.update({
          where: { id: payload.jobId },
          data: {
            status: 'SUCCEEDED',
            finishedAt: new Date(),
            outputJson: {
              exportId: existing.id,
              contentHash: existing.contentHash,
              sizeBytes: existing.sizeBytes,
              reused: true,
            } as never,
          },
        }),
      ]);
      return;
    }

    const backing = await prisma.beatAsset.findFirst({
      where: {
        songId: payload.songId,
        assetKind: 'instrumental',
        approved: true,
        qualityState: 'passed',
        contentHash: { not: null },
        verifiedAt: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    const [audioBytes, coverBytes, backingBytes] = await Promise.all([
      downloadToBuffer(certification.audio.url, { maxBytes: 512 * 1024 * 1024 }),
      downloadToBuffer(certification.cover.url, { maxBytes: 50 * 1024 * 1024 }),
      backing
        ? downloadToBuffer(backing.url, { maxBytes: 512 * 1024 * 1024 })
        : Promise.resolve(null),
    ]);
    const media = await renderReleaseMedia({
      audio: audioBytes,
      cover: coverBytes,
      backingTrack: backingBytes,
    });

    const base = safeFileBase(certification.song.title);
    const files: PackageFile[] = [];
    addPackageFile(files, 'audio/' + base + '.wav', media.wav);
    addPackageFile(files, 'audio/' + base + '.mp3', media.mp3);
    addPackageFile(files, 'artwork/cover-3000x3000-rgb.jpg', media.coverJpg);
    if (media.backingWav) {
      addPackageFile(files, 'performance/' + base + '-backing-track.wav', media.backingWav);
    }
    addPackageFile(files, 'lyrics/lyrics.txt', certification.lyric.body.trim() + '\n');
    if (certification.lyric.cleanVersion?.trim()) {
      addPackageFile(files, 'lyrics/clean-lyrics.txt', certification.lyric.cleanVersion.trim() + '\n');
    }

    const metadata = {
      schemaVersion: 1,
      title: certification.song.title,
      artist: certification.song.project.artist.stageName,
      genre: certification.song.project.genre,
      isrc: certification.song.isrc ?? 'distributor-assigned',
      upc: certification.song.upc ?? 'distributor-assigned',
      explicit: certification.lyric.explicit,
      languages: certification.song.project.artist.languages,
      audio: {
        sourceKind: certification.audio.kind,
        sourceId: certification.audio.id,
        sourceContentHash: certification.audio.contentHash,
        deliveryWav: '24-bit PCM, 44.1 kHz, stereo',
        deliveryMp3: '320 kbps, 44.1 kHz, stereo',
      },
      artwork: {
        sourceId: certification.cover.id,
        sourceContentHash: certification.cover.contentHash,
        delivery: '3000x3000 RGB JPEG',
      },
    };
    addPackageFile(files, 'metadata/metadata.json', canonicalJson(metadata) + '\n');
    addPackageFile(
      files,
      'metadata/metadata.csv',
      [
        ['title', 'artist', 'genre', 'isrc', 'upc', 'explicit'],
        [
          metadata.title,
          metadata.artist,
          metadata.genre,
          metadata.isrc,
          metadata.upc,
          metadata.explicit ? 'yes' : 'no',
        ],
      ].map((row) => row.map(csvCell).join(',')).join('\n') + '\n',
    );
    addPackageFile(
      files,
      'rights/split-sheet.csv',
      [
        ['name', 'role', 'share_percent'],
        ...certification.splitSheet.map((split: { name: string; role: string; share: number }) => [
          split.name, split.role, split.share,
        ]),
      ].map((row) => row.map(csvCell).join(',')).join('\n') + '\n',
    );
    addPackageFile(
      files,
      'rights/rights-receipt.json',
      canonicalJson({
        id: certification.rightsReceipt.id,
        hash: certification.rightsReceipt.hash,
        canonicalPayload: certification.rightsReceipt.canonicalPayload,
      }) + '\n',
    );
    const receiptPayload = certification.rightsReceipt.canonicalPayload as JsonRecord | null;
    addPackageFile(
      files,
      'rights/ai-and-provenance.json',
      canonicalJson({
        aiDisclosure: receiptPayload?.aiDisclosure ?? null,
        provenance: receiptPayload?.provenance ?? null,
        artifactFingerprint: certification.artifactFingerprint,
      }) + '\n',
    );

    files.sort((left, right) => left.path.localeCompare(right.path));
    const contentEntries: ManifestEntry[] = files.map((file) => ({
      path: file.path,
      sizeBytes: file.bytes.byteLength,
      sha256: sha256(file.bytes),
    }));
    const omissions = [
      !certification.lyric.cleanVersion?.trim() ? 'clean lyrics not supplied' : null,
      !media.backingWav ? 'certified instrumental backing track not available' : null,
      'stems omitted because individual stem hashes are not stored yet',
      'video omitted because current video assets are not release-certified',
    ].filter(Boolean);
    const manifest = {
      schemaVersion: 1,
      sourceFingerprint,
      artifactFingerprint: certification.artifactFingerprint,
      receiptId: certification.rightsReceipt.id,
      receiptHash: certification.rightsReceipt.hash,
      splitAttestationId: certification.splitAttestation?.id ?? null,
      nativeAttestationId: certification.nativeAttestation?.id ?? null,
      evidenceTimestamp: certification.rightsReceipt.createdAt.toISOString(),
      files: contentEntries,
      omissions,
    };
    const manifestBytes = Buffer.from(canonicalJson(manifest) + '\n', 'utf8');
    addPackageFile(files, 'manifest.json', manifestBytes);
    const checksumEntries = [
      ...contentEntries,
      {
        path: 'manifest.json',
        sizeBytes: manifestBytes.byteLength,
        sha256: sha256(manifestBytes),
      },
    ].sort((left, right) => left.path.localeCompare(right.path));
    addPackageFile(
      files,
      'checksums.sha256',
      checksumEntries.map((entry) => entry.sha256 + '  ' + entry.path).join('\n') + '\n',
    );
    files.sort((left, right) => left.path.localeCompare(right.path));

    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.path, file.bytes, {
        date: ZIP_DATE,
        createFolders: false,
        unixPermissions: 0o644,
      });
    }
    const archive = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
      streamFiles: true,
    });
    if (archive.byteLength < 1024 || archive.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error('release_archive_size_invalid');
    }
    const verifiedZip = await JSZip.loadAsync(archive, { checkCRC32: true });
    for (const required of [
      'manifest.json',
      'checksums.sha256',
      'rights/rights-receipt.json',
      'artwork/cover-3000x3000-rgb.jpg',
      'audio/' + base + '.wav',
    ]) {
      if (!verifiedZip.file(required)) throw new Error('release_archive_missing_' + required);
    }

    const archiveHash = sha256(archive);
    archiveUrl = await uploadBytes({
      workspaceId: payload.workspaceId,
      kind: 'releases/' + payload.songId,
      bytes: archive,
      contentType: 'application/zip',
      ext: 'zip',
    });
    const bundle = {
      title: certification.song.title,
      artist: certification.song.project.artist.stageName,
      artifactFingerprint: certification.artifactFingerprint,
      sourceFingerprint,
      receiptId: certification.rightsReceipt.id,
      files: files.map((file) => file.path),
    };
    const created = await prisma.$transaction(async (tx) => {
      const releaseExport = await tx.export.create({
        data: {
          projectId: payload.projectId,
          songId: payload.songId,
          bundle: bundle as never,
          archiveUrl: archiveUrl!,
          contentHash: archiveHash,
          sourceFingerprint,
          sizeBytes: archive.byteLength,
          qualityState: 'ready',
          manifest: manifest as never,
          verifiedAt: new Date(),
          receiptId: certification.rightsReceipt!.id,
        },
      });
      await tx.song.update({
        where: { id: payload.songId },
        data: { status: 'EXPORTED', releaseReady: true },
      });
      await tx.providerJob.update({
        where: { id: payload.jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          outputJson: {
            exportId: releaseExport.id,
            contentHash: archiveHash,
            sizeBytes: archive.byteLength,
            sourceFingerprint,
            fileCount: files.length,
          } as never,
        },
      });
      return releaseExport;
    });
    void created;
    archiveUrl = null;
  } catch (error) {
    if (archiveUrl) await deleteObjectByUrl(archiveUrl).catch(() => undefined);
    await markFailed(payload.jobId, error);
  }
}

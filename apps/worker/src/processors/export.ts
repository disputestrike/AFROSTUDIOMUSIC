import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadReleaseCertification, prisma, releaseEvidenceHash } from '@afrohit/db';
import { canonicalJson } from '@afrohit/shared';
import {
  assertCertifiableAudioQuality,
  assertStoredContentHash,
} from '../lib/certified-assets';
import {
  ffmpegAvailable,
  measureAudioQuality,
  NATIVE_AUDIO_LIMITS,
  runFfmpeg,
} from '../lib/ffmpeg';
import { markFailed, markRunning } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer, uploadBytes } from '../lib/storage';
import { releaseLineageEvidence, resolveCertifiedReleaseLineage } from './rights';

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
export type CertifiedStemSource = {
  kind: "beat" | "mix" | "master";
  assetId: string;
  contentHash: string;
};
export type ReleaseStemRow = {
  id: string;
  role: string;
  url: string;
  format: string;
  origin: string;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: Date | null;
  lineage: unknown;
};
export type CertifiedReleaseStem = ReleaseStemRow & {
  contentHash: string;
  verifiedAt: Date;
  lineage: JsonRecord;
  archivePath: string;
};


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

const CERTIFIED_HASH = /^[a-f0-9]{64}$/i;
const RELEASE_STEM_FORMATS = new Set([
  "wav",
  "mp3",
  "flac",
  "aiff",
  "m4a",
  "ogg",
]);

/** Fail closed: a stem enters a release only when its own certified bytes and
 * source receipt bind to one exact asset in the current release lineage. */
export function certifiedCurrentReleaseStems(
  rows: ReleaseStemRow[],
  sources: CertifiedStemSource[]
): CertifiedReleaseStem[] {
  const currentSources = new Set(
    sources.map(
      source =>
        `${source.kind}:${source.assetId}:${source.contentHash.toLowerCase()}`
    )
  );
  const certified = rows
    .filter(row => {
      if (
        row.qualityState !== "passed" ||
        !row.verifiedAt ||
        !CERTIFIED_HASH.test(row.contentHash ?? "") ||
        !RELEASE_STEM_FORMATS.has(row.format.toLowerCase())
      ) {
        return false;
      }
      const lineage = jsonRecord(row.lineage);
      const source = jsonRecord(lineage?.source);
      const derivation = jsonRecord(lineage?.derivation);
      if (
        lineage?.schemaVersion !== 1 ||
        lineage?.role !== row.role ||
        !source ||
        !derivation ||
        !["separation", "native_bus", "provider"].includes(
          String(derivation.kind ?? "")
        ) ||
        !["beat", "mix", "master"].includes(String(source.kind ?? "")) ||
        typeof source.assetId !== "string" ||
        typeof source.contentHash !== "string"
      ) {
        return false;
      }
      return currentSources.has(
        `${source.kind}:${source.assetId}:${source.contentHash.toLowerCase()}`
      );
    })
    .sort(
      (left, right) =>
        left.role.localeCompare(right.role) || left.id.localeCompare(right.id)
    );

  return certified.map((row, index) => ({
    ...row,
    contentHash: row.contentHash!.toLowerCase(),
    verifiedAt: row.verifiedAt!,
    lineage: jsonRecord(row.lineage)!,
    archivePath:
      `stems/${String(index + 1).padStart(2, "0")}-` +
      `${safeFileBase(row.role)}.${row.format.toLowerCase()}`,
  }));
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
    const mp3Qc = await measureAudioQuality(mp3Path);
    assertCertifiableAudioQuality(mp3Qc, 'release_mp3');
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

type ReleaseArchiveVerification = {
  expectedContentHash?: string | null;
  expectedSizeBytes?: number | null;
  expectedSourceFingerprint?: string;
  expectedManifest?: unknown;
  requiredPaths?: readonly string[];
};

function jsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function safeArchivePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

export async function verifyReleaseArchive(
  archive: Buffer,
  options: ReleaseArchiveVerification = {},
): Promise<JsonRecord> {
  if (options.expectedSizeBytes != null && archive.byteLength !== options.expectedSizeBytes) {
    throw new Error('release_archive_size_mismatch');
  }
  if (options.expectedContentHash !== undefined) {
    assertStoredContentHash(archive, options.expectedContentHash, 'release_archive');
  }

  const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  const archivePaths = Object.keys(zip.files).filter((path) => !zip.files[path]!.dir);
  if (archivePaths.some((path) => !safeArchivePath(path))) {
    throw new Error('release_archive_unsafe_path');
  }
  const manifestFile = zip.file('manifest.json');
  const checksumsFile = zip.file('checksums.sha256');
  if (!manifestFile || !checksumsFile) throw new Error('release_archive_integrity_files_missing');

  const [manifestBytes, checksumsText] = await Promise.all([
    manifestFile.async('nodebuffer'),
    checksumsFile.async('string'),
  ]);
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('release_archive_manifest_invalid_json');
  }
  const manifest = jsonRecord(parsedManifest);
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('release_archive_manifest_invalid');
  }
  if (
    options.expectedSourceFingerprint !== undefined
    && manifest.sourceFingerprint !== options.expectedSourceFingerprint
  ) {
    throw new Error('release_archive_source_fingerprint_mismatch');
  }
  if (
    options.expectedManifest !== undefined
    && canonicalJson(manifest) !== canonicalJson(options.expectedManifest)
  ) {
    throw new Error('release_archive_persisted_manifest_mismatch');
  }

  const entries: ManifestEntry[] = manifest.files.map((value, index) => {
    const row = jsonRecord(value);
    if (
      !row
      || typeof row.path !== 'string'
      || !safeArchivePath(row.path)
      || row.path === 'manifest.json'
      || row.path === 'checksums.sha256'
      || typeof row.sizeBytes !== 'number'
      || !Number.isInteger(row.sizeBytes)
      || row.sizeBytes < 0
      || typeof row.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/i.test(row.sha256)
    ) {
      throw new Error(`release_archive_manifest_entry_invalid:${index}`);
    }
    return {
      path: row.path,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256.toLowerCase(),
    };
  });
  const entryPaths = new Set(entries.map((entry) => entry.path));
  if (entryPaths.size !== entries.length) throw new Error('release_archive_manifest_duplicate_path');

  const checksums = new Map<string, string>();
  const checksumLines = checksumsText.replace(/\r/g, '').split('\n');
  if (checksumLines.at(-1) === '') checksumLines.pop();
  for (const [index, line] of checksumLines.entries()) {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/i);
    if (!match || !safeArchivePath(match[2]!)) {
      throw new Error(`release_archive_checksum_entry_invalid:${index}`);
    }
    const path = match[2]!;
    if (checksums.has(path)) throw new Error('release_archive_checksum_duplicate_path');
    checksums.set(path, match[1]!.toLowerCase());
  }

  const expectedChecksumPaths = new Set([...entryPaths, 'manifest.json']);
  if (
    checksums.size !== expectedChecksumPaths.size
    || [...checksums.keys()].some((path) => !expectedChecksumPaths.has(path))
  ) {
    throw new Error('release_archive_checksum_set_mismatch');
  }
  const expectedArchivePaths = new Set([...entryPaths, 'manifest.json', 'checksums.sha256']);
  if (
    archivePaths.length !== expectedArchivePaths.size
    || archivePaths.some((path) => !expectedArchivePaths.has(path))
  ) {
    throw new Error('release_archive_file_set_mismatch');
  }
  for (const requiredPath of options.requiredPaths ?? []) {
    if (!expectedArchivePaths.has(requiredPath)) {
      throw new Error(`release_archive_missing_${requiredPath}`);
    }
  }

  if (checksums.get('manifest.json') !== sha256(manifestBytes)) {
    throw new Error('release_archive_manifest_hash_mismatch');
  }
  for (const entry of entries) {
    if (checksums.get(entry.path) !== entry.sha256) {
      throw new Error(`release_archive_checksum_manifest_mismatch:${entry.path}`);
    }
    const file = zip.file(entry.path);
    if (!file) throw new Error(`release_archive_missing_${entry.path}`);
    const bytes = await file.async('nodebuffer');
    if (bytes.byteLength !== entry.sizeBytes) {
      throw new Error(`release_archive_file_size_mismatch:${entry.path}`);
    }
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`release_archive_file_hash_mismatch:${entry.path}`);
    }
  }
  return manifest;
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
    const lineage = await resolveCertifiedReleaseLineage({
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      songId: payload.songId,
      audio: certification.audio,
    });
    const exactLineage = releaseLineageEvidence(lineage);
    const receiptPayload = jsonRecord(certification.rightsReceipt.canonicalPayload);
    if (!receiptPayload || canonicalJson(receiptPayload.lineage) !== canonicalJson(exactLineage)) {
      throw new Error('export_blocked: rights receipt does not bind current exact audio lineage');
    }

    const certifiedStemSources: CertifiedStemSource[] = [
      lineage.beat
        ? {
            kind: "beat" as const,
            assetId: lineage.beat.id,
            contentHash: lineage.beat.contentHash,
          }
        : null,
      {
        kind: "mix" as const,
        assetId: lineage.mix.id,
        contentHash: lineage.mix.contentHash,
      },
      lineage.master
        ? {
            kind: "master" as const,
            assetId: lineage.master.id,
            contentHash: lineage.master.contentHash,
          }
        : null,
    ].filter((value): value is CertifiedStemSource => value !== null);
    const stemRows = lineage.beat
      ? ((await prisma.stem.findMany({
          where: { beatId: lineage.beat.id },
          orderBy: [{ role: "asc" }, { id: "asc" }],
          select: {
            id: true,
            role: true,
            url: true,
            format: true,
            origin: true,
            qualityState: true,
            contentHash: true,
            verifiedAt: true,
            lineage: true,
          },
        })) as ReleaseStemRow[])
      : [];
    const releaseStems = certifiedCurrentReleaseStems(
      stemRows,
      certifiedStemSources
    );
    const stemEvidence = releaseStems.map(stem => ({
      id: stem.id,
      role: stem.role,
      format: stem.format,
      origin: stem.origin,
      contentHash: stem.contentHash,
      lineage: stem.lineage,
    }));

    const sourceFingerprint = releaseEvidenceHash({
      version: 3,
      lineage: exactLineage,
      stems: stemEvidence,
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
        stems: 'certified_original_bytes',
        zip: 'deflate9_deterministic_date',
      },
    });
    const base = safeFileBase(certification.song.title);
    const requiredArchivePaths = [
      'manifest.json',
      'checksums.sha256',
      'rights/rights-receipt.json',
      'artwork/cover-3000x3000-rgb.jpg',
      'audio/' + base + '.wav',
      'audio/' + base + '.mp3',
    ];
    if (lineage.beat) {
      requiredArchivePaths.push('performance/' + base + '-backing-track.wav');
    }
    if (releaseStems.length) {
      requiredArchivePaths.push(
        "metadata/stems.json",
        ...releaseStems.map(stem => stem.archivePath)
      );
    }
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
      const existingArchive = await downloadToBuffer(existing.archiveUrl, {
        maxBytes: MAX_ARCHIVE_BYTES,
        timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
      });
      await verifyReleaseArchive(existingArchive, {
        expectedContentHash: existing.contentHash,
        expectedSizeBytes: existing.sizeBytes,
        expectedSourceFingerprint: sourceFingerprint,
        expectedManifest: existing.manifest,
        requiredPaths: requiredArchivePaths,
      });
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

    const backing = lineage.beat;
    const [audioBytes, coverBytes, backingBytes] = await Promise.all([
      downloadToBuffer(certification.audio.url, {
        maxBytes: 512 * 1024 * 1024,
        timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
      }),
      downloadToBuffer(certification.cover.url, {
        maxBytes: 50 * 1024 * 1024,
        timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
      }),
      backing
        ? downloadToBuffer(backing.url, {
            maxBytes: 512 * 1024 * 1024,
            timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
          })
        : Promise.resolve(null),
    ]);
    assertStoredContentHash(audioBytes, certification.audio.contentHash, 'export_source_audio');
    assertStoredContentHash(coverBytes, certification.cover.contentHash, 'export_source_cover');
    if (backing && backingBytes) {
      assertStoredContentHash(backingBytes, backing.contentHash, 'export_source_backing');
    }
    const certifiedStemFiles: PackageFile[] = [];
    let certifiedStemBytes = 0;
    for (const stem of releaseStems) {
      const bytes = await downloadToBuffer(stem.url, {
        maxBytes: 512 * 1024 * 1024,
        timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
      });
      assertStoredContentHash(
        bytes,
        stem.contentHash,
        `export_stem_${stem.id}`
      );
      certifiedStemBytes += bytes.byteLength;
      if (certifiedStemBytes > MAX_ARCHIVE_BYTES) {
        throw new Error("release_certified_stems_exceed_archive_limit");
      }
      certifiedStemFiles.push({ path: stem.archivePath, bytes });
    }
    const media = await renderReleaseMedia({
      audio: audioBytes,
      cover: coverBytes,
      backingTrack: backingBytes,
    });

    const files: PackageFile[] = [];
    addPackageFile(files, 'audio/' + base + '.wav', media.wav);
    addPackageFile(files, 'audio/' + base + '.mp3', media.mp3);
    addPackageFile(files, 'artwork/cover-3000x3000-rgb.jpg', media.coverJpg);
    if (media.backingWav) {
      addPackageFile(files, 'performance/' + base + '-backing-track.wav', media.backingWav);
    }
    files.push(...certifiedStemFiles);
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
        lineage: exactLineage,
        deliveryWav: '24-bit PCM, 44.1 kHz, stereo',
        deliveryMp3: '320 kbps, 44.1 kHz, stereo',
      },
      artwork: {
        sourceId: certification.cover.id,
        sourceContentHash: certification.cover.contentHash,
        delivery: '3000x3000 RGB JPEG',
      },
      stems: releaseStems.map(stem => ({
        id: stem.id,
        role: stem.role,
        format: stem.format,
        origin: stem.origin,
        contentHash: stem.contentHash,
        verifiedAt: stem.verifiedAt.toISOString(),
        path: stem.archivePath,
        lineage: stem.lineage,
      })),
    };
    addPackageFile(files, 'metadata/metadata.json', canonicalJson(metadata) + '\n');
    if (releaseStems.length) {
      addPackageFile(
        files,
        'metadata/stems.json',
        canonicalJson({ schemaVersion: 1, stems: metadata.stems }) + '\n',
      );
    }
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
    addPackageFile(
      files,
      'rights/ai-and-provenance.json',
      canonicalJson({
        aiDisclosure: receiptPayload?.aiDisclosure ?? null,
        provenance: receiptPayload?.provenance ?? null,
        artifactFingerprint: certification.artifactFingerprint,
        lineage: exactLineage,
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
      stemRows.length === 0 ? 'stems not generated' : null,
      stemRows.length > 0 && releaseStems.length === 0
        ? 'no stems are certified against the current release lineage'
        : null,
      stemRows.length > releaseStems.length && releaseStems.length > 0
        ? `${stemRows.length - releaseStems.length} stale or uncertified stem(s) excluded`
        : null,
      'video omitted because current video assets are not release-certified',
    ].filter(Boolean);
    const manifest = {
      schemaVersion: 1,
      sourceFingerprint,
      artifactFingerprint: certification.artifactFingerprint,
      lineage: exactLineage,
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
    await verifyReleaseArchive(archive, {
      expectedSizeBytes: archive.byteLength,
      expectedSourceFingerprint: sourceFingerprint,
      expectedManifest: manifest,
      requiredPaths: requiredArchivePaths,
    });

    const archiveHash = sha256(archive);
    archiveUrl = await uploadBytes({
      workspaceId: payload.workspaceId,
      kind: 'releases/' + payload.songId,
      bytes: archive,
      contentType: 'application/zip',
      ext: 'zip',
    });
    const uploadedArchive = await downloadToBuffer(archiveUrl, {
      maxBytes: MAX_ARCHIVE_BYTES,
      timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
    });
    await verifyReleaseArchive(uploadedArchive, {
      expectedContentHash: archiveHash,
      expectedSizeBytes: archive.byteLength,
      expectedSourceFingerprint: sourceFingerprint,
      expectedManifest: manifest,
      requiredPaths: requiredArchivePaths,
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

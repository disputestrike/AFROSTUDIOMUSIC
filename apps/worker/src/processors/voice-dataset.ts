import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { prisma } from '@afrohit/db';
import { markFailed, markRunning } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer, uploadBytes } from '../lib/storage';
import {
  ffmpegAvailable,
  measureAudioQuality,
  measureVocalActivity,
  probeDurationS,
  runFfmpeg,
} from '../lib/ffmpeg';

interface VoiceDatasetPayload {
  jobId: string;
  workspaceId: string;
  name: string;
  sampleUrls: string[];
  isolationConfirmed: true;
  purgeSourceSamples: boolean;
}

const MAX_SAMPLE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_SECONDS = 30 * 60;
const MIN_USABLE_SECONDS = 2 * 60;

function objectMeta(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function purgeRefs(refs: string[]): Promise<string[]> {
  let failed = [...new Set(refs)];
  for (let attempt = 0; attempt < 3 && failed.length; attempt += 1) {
    const results = await Promise.allSettled(failed.map((ref) => deleteObjectByUrl(ref)));
    failed = failed.filter((_ref, index) => results[index]?.status === 'rejected');
    if (failed.length && attempt < 2) await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 2_000));
  }
  return failed;
}

/** Build a measured RVC dataset. Every source and every retained segment is
 * decoded and checked before a zip can become an approved VoiceDataset row. */
export async function processVoiceDataset(payload: VoiceDatasetPayload): Promise<void> {
  await markRunning(payload.jobId);
  const dir = await mkdtemp(join(tmpdir(), 'voiceds-'));
  let uploadedDatasetUrl: string | null = null;
  try {
    if (payload.isolationConfirmed !== true) throw new Error('voice_dataset_isolation_not_confirmed');
    if (!(await ffmpegAvailable())) throw new Error('voice_dataset_failed: ffmpeg is not available on this worker');
    const safeName = payload.name
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^[_.]+|[_.]+$/g, '')
      .slice(0, 60) || 'voice';

    const segmentPaths: string[] = [];
    let sourceSeconds = 0;
    for (let index = 0; index < payload.sampleUrls.length; index += 1) {
      const raw = await downloadToBuffer(payload.sampleUrls[index]!, { maxBytes: MAX_SAMPLE_BYTES });
      const inputPath = join(dir, `in${index}`);
      await writeFile(inputPath, raw);
      const [duration, sourceQc, sourceActivity] = await Promise.all([
        probeDurationS(inputPath),
        measureAudioQuality(inputPath),
        measureVocalActivity(inputPath),
      ]);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('voice_dataset_invalid_audio_duration');
      if (!sourceActivity) throw new Error('voice_dataset_activity_measurement_failed');
      if (sourceQc.flags.includes('clipping')) throw new Error(`voice_dataset_source_${index + 1}_clips`);
      if (sourceQc.integratedLufs != null && sourceQc.integratedLufs < -40) {
        throw new Error(`voice_dataset_source_${index + 1}_near_silent`);
      }
      if (sourceActivity.activeRatio < 0.08) throw new Error(`voice_dataset_source_${index + 1}_mostly_silent`);
      sourceSeconds += duration;
      if (sourceSeconds > MAX_TOTAL_SECONDS) throw new Error('voice_dataset_exceeds_30_minutes');
      await runFfmpeg([
        '-i', inputPath,
        '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le',
        '-f', 'segment', '-segment_time', '10',
        join(dir, `seg${index}_%04d.wav`),
      ]);
    }

    const files = (await readdir(dir)).filter((file) => /^seg\d+_\d+\.wav$/.test(file)).sort();
    for (const file of files) segmentPaths.push(join(dir, file));
    if (!segmentPaths.length) throw new Error('voice_dataset_failed: samples produced no audio segments');

    const zip = new JSZip();
    let segments = 0;
    let rejectedSegments = 0;
    let totalSeconds = 0;
    let activeRatioTotal = 0;
    for (const path of segmentPaths) {
      const [duration, qc, activity] = await Promise.all([
        probeDurationS(path),
        measureAudioQuality(path),
        measureVocalActivity(path),
      ]);
      const rejected = duration < 1
        || !activity
        || activity.activeRatio < 0.08
        || qc.flags.includes('clipping')
        || (qc.integratedLufs != null && qc.integratedLufs < -40);
      if (rejected) {
        rejectedSegments += 1;
        continue;
      }
      zip.file(`dataset/${safeName}/split_${segments}.wav`, await readFile(path));
      segments += 1;
      totalSeconds += duration;
      activeRatioTotal += activity.activeRatio;
    }
    if (!segments) throw new Error('voice_dataset_failed: no segment passed vocal QC');
    if (totalSeconds < MIN_USABLE_SECONDS) {
      throw new Error(`voice_dataset_needs_${MIN_USABLE_SECONDS}_usable_seconds_got_${Math.round(totalSeconds)}`);
    }

    const zipBytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const contentHash = createHash('sha256').update(zipBytes).digest('hex');
    const existing = await prisma.voiceDataset.findFirst({
      where: { workspaceId: payload.workspaceId, contentHash, qualityState: 'passed' },
    });
    const datasetZipRef = existing?.url ?? await uploadBytes({
      workspaceId: payload.workspaceId,
      kind: 'voice',
      bytes: zipBytes,
      contentType: 'application/zip',
      ext: 'zip',
    });
    if (!existing) uploadedDatasetUrl = datasetZipRef;

    let dataset = await prisma.voiceDataset.upsert({
      where: { workspaceId_contentHash: { workspaceId: payload.workspaceId, contentHash } },
      create: {
        workspaceId: payload.workspaceId,
        name: safeName,
        url: datasetZipRef,
        contentHash,
        segments,
        totalSeconds: Math.round(totalSeconds),
        qualityState: 'passed',
        verifiedAt: new Date(),
        meta: {
          sampleCount: payload.sampleUrls.length,
          sourceSeconds: Math.round(sourceSeconds),
          rejectedSegments,
          meanActiveRatio: Math.round((activeRatioTotal / segments) * 10_000) / 10_000,
          format: 'wav-48k-mono-pcm16',
          isolationConfirmed: true,
        } as never,
      },
      update: { verifiedAt: new Date() },
    });
    if (uploadedDatasetUrl && dataset.url !== uploadedDatasetUrl) {
      await deleteObjectByUrl(uploadedDatasetUrl);
    }
    uploadedDatasetUrl = null;

    const previousPurge = objectMeta(objectMeta(dataset.meta).sourcePurge);
    const previousFailures = Array.isArray(previousPurge.failedRefs)
      ? previousPurge.failedRefs.filter((value): value is string => typeof value === 'string')
      : [];
    const sourcePurge = {
      requested: payload.purgeSourceSamples || previousPurge.requested === true,
      completed: payload.purgeSourceSamples ? false : previousPurge.completed === true,
      failedRefs: payload.purgeSourceSamples
        ? [...new Set([...previousFailures, ...payload.sampleUrls])]
        : previousFailures,
      attemptedAt: typeof previousPurge.attemptedAt === 'string'
        ? previousPurge.attemptedAt
        : null as string | null,
    };
    const receiptMeta = {
      sampleCount: payload.sampleUrls.length,
      sourceSeconds: Math.round(sourceSeconds),
      rejectedSegments,
      meanActiveRatio: Math.round((activeRatioTotal / segments) * 10_000) / 10_000,
      format: 'wav-48k-mono-pcm16',
      isolationConfirmed: true,
      sourcePurge,
    };
    dataset = await prisma.voiceDataset.update({
      where: { id: dataset.id },
      data: { meta: { ...objectMeta(dataset.meta), ...receiptMeta } as never },
    });

    if (payload.purgeSourceSamples) {
      sourcePurge.failedRefs = await purgeRefs(sourcePurge.failedRefs);
      sourcePurge.completed = sourcePurge.failedRefs.length === 0;
      sourcePurge.attemptedAt = new Date().toISOString();
    }

    await prisma.$transaction(async (tx) => {
      dataset = await tx.voiceDataset.update({
        where: { id: dataset.id },
        data: { meta: { ...objectMeta(dataset.meta), ...receiptMeta, sourcePurge } as never },
      });
      const output = {
        datasetId: dataset.id,
        datasetZipRef: dataset.url,
        contentHash: dataset.contentHash,
        segments: dataset.segments,
        totalSeconds: dataset.totalSeconds,
        rejectedSegments,
        qualityState: dataset.qualityState,
        sourceSamplesPurged: sourcePurge.completed,
        sourceSamplePurgeFailures: sourcePurge.failedRefs.length,
        note: totalSeconds < 600
          ? `Dataset passed QC (${Math.round(totalSeconds / 60)} min). 10-20 minutes of clean solo vocals usually improves the trained voice.`
          : 'Dataset passed QC and is ready for training.',
      };
      await tx.providerJob.update({
        where: { id: payload.jobId },
        data: { status: 'SUCCEEDED', finishedAt: new Date(), outputJson: output as never },
      });
    });
  } catch (error) {
    if (uploadedDatasetUrl) await deleteObjectByUrl(uploadedDatasetUrl).catch(() => undefined);
    await markFailed(payload.jobId, error);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Retry raw-sample deletions recorded by successful dataset jobs. */
export async function processVoiceDatasetPurgeBackfill(): Promise<void> {
  const rows = await prisma.voiceDataset.findMany({ orderBy: { createdAt: 'asc' }, take: 200 });
  let retried = 0;
  let remaining = 0;
  for (const row of rows) {
    const meta = objectMeta(row.meta);
    const sourcePurge = objectMeta(meta.sourcePurge);
    const refs = Array.isArray(sourcePurge.failedRefs)
      ? sourcePurge.failedRefs.filter((value): value is string => typeof value === 'string')
      : [];
    if (!refs.length) continue;
    retried += refs.length;
    const failedRefs = await purgeRefs(refs);
    remaining += failedRefs.length;
    await prisma.voiceDataset.update({
      where: { id: row.id },
      data: {
        meta: {
          ...meta,
          sourcePurge: {
            ...sourcePurge,
            completed: failedRefs.length === 0,
            failedRefs,
            lastAttemptAt: new Date().toISOString(),
          },
        } as never,
      },
    });
  }
  console.log(`[voice-dataset-purge] retried=${retried} remaining=${remaining}`);
}

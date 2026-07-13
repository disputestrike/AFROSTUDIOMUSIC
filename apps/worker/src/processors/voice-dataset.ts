/**
 * DATASET BUILDER — one click from raw recordings to a trainer-ready zip.
 *
 * Downloads each raw sample, converts to 48k MONO wav (the default trainer's
 * documented sample_rate), splits into ~10s segments (ffmpeg segment muxer),
 * and zips them in EXACTLY the layout replicate/train-rvc-model expects:
 * `dataset/<name>/split_<i>.wav`. The zip lands in our storage; the succeeded
 * job carries { datasetZipUrl, segments, totalSeconds } — feed datasetZipUrl
 * straight to POST /voices/train.
 *
 * Deterministic local ffmpeg work — no AI provider, no per-run provider cost.
 * Failures are honest (markFailed with the real reason), never a fake zip.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { downloadToBuffer, uploadBytes } from '../lib/storage';
import { ffmpegAvailable, probeDurationS, runFfmpeg } from '../lib/ffmpeg';

interface VoiceDatasetPayload {
  jobId: string;
  workspaceId: string;
  name: string;
  sampleUrls: string[];
}

const MAX_SAMPLE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_SECONDS = 30 * 60;

export async function processVoiceDataset(p: VoiceDatasetPayload) {
  await markRunning(p.jobId);
  const dir = await mkdtemp(join(tmpdir(), 'voiceds-'));
  try {
    if (!(await ffmpegAvailable())) {
      await markFailed(p.jobId, 'voice_dataset_failed: ffmpeg is not available on this worker');
      return;
    }
    // The name becomes a folder inside the zip — keep it filesystem/zip-safe.
    const safeName = p.name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 60) || 'voice';

    // 1) download + convert + split each sample into ~10s 48k mono wav segments.
    const segmentPaths: string[] = [];
    let sourceSeconds = 0;
    for (let i = 0; i < p.sampleUrls.length; i++) {
      const url = p.sampleUrls[i]!;
      const raw = await downloadToBuffer(url, { maxBytes: MAX_SAMPLE_BYTES });
      const inPath = join(dir, `in${i}`);
      await writeFile(inPath, raw);
      const duration = await probeDurationS(inPath);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('voice_dataset_invalid_audio_duration');
      sourceSeconds += duration;
      if (sourceSeconds > MAX_TOTAL_SECONDS) throw new Error('voice_dataset_exceeds_30_minutes');
      await runFfmpeg([
        '-i', inPath,
        '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le',
        '-f', 'segment', '-segment_time', '10',
        join(dir, `seg${i}_%04d.wav`),
      ]);
    }
    const files = (await readdir(dir)).filter((f) => /^seg\d+_\d+\.wav$/.test(f)).sort();
    for (const f of files) segmentPaths.push(join(dir, f));
    if (!segmentPaths.length) {
      await markFailed(p.jobId, 'voice_dataset_failed: the samples produced no audio segments (are they valid audio files?)');
      return;
    }

    // 2) assemble the zip in the trainer layout, dropping degenerate tails (<1s).
    const zip = new JSZip();
    let segments = 0;
    let totalSeconds = 0;
    for (const path of segmentPaths) {
      const durS = await probeDurationS(path);
      if (durS < 1) continue; // final sliver of a split — useless to the trainer
      zip.file(`dataset/${safeName}/split_${segments}.wav`, await readFile(path));
      segments += 1;
      totalSeconds += durS;
    }
    if (!segments) {
      await markFailed(p.jobId, 'voice_dataset_failed: every segment was under 1 second — record longer takes');
      return;
    }
    const zipBytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // 3) store it privately. The API signs it only when training begins.
    const datasetZipRef = await uploadBytes({
      workspaceId: p.workspaceId,
      kind: 'voice',
      bytes: zipBytes,
      contentType: 'application/zip',
      ext: 'zip',
    });

    await markSucceeded(p.jobId, {
      datasetZipRef,
      segments,
      totalSeconds: Math.round(totalSeconds),
      note:
        totalSeconds < 600
          ? `Dataset ready (${Math.round(totalSeconds / 60)} min). 10–20 minutes of clean solo vocals train the best voice — add more takes if you can, then start training.`
          : 'Dataset ready — start training when ready.',
    });
  } catch (err) {
    await markFailed(p.jobId, err);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

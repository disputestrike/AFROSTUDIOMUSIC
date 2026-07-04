import { prisma } from '@afrohit/db';
import { musicAdapter } from '@afrohit/ai';
import type { MusicGenerationInput } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { ingestRemoteFile } from '../lib/storage';

interface MusicPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId?: string;
  input: MusicGenerationInput;
}

export async function processMusic(p: MusicPayload) {
  await markRunning(p.jobId);
  try {
    const adapter = musicAdapter();
    let result = await adapter.generate(p.input);

    // Poll until terminal — exponential backoff, cap at 25 attempts.
    let attempts = 0;
    while (result.status === 'queued' || result.status === 'running') {
      if (!adapter.poll || !result.externalId) break;
      const wait = result.pollAfterMs ?? 8_000;
      await new Promise((r) => setTimeout(r, wait));
      attempts += 1;
      if (attempts > 25) break;
      result = await adapter.poll(result.externalId);
    }

    if (result.status !== 'succeeded' || !result.output) {
      await markFailed(p.jobId, result.error ?? 'music_generation_failed');
      return;
    }

    // Persist asset + stems. We re-host the audio in our bucket so it survives
    // provider URL expiry and gives us deterministic CDN paths.
    const ingestedMain = await ingestRemoteFile({
      workspaceId: p.workspaceId,
      url: result.output.mainAudioUrl,
      kind: 'beats',
      ext: result.output.format,
      contentType:
        result.output.format === 'mp3'
          ? 'audio/mpeg'
          : result.output.format === 'flac'
          ? 'audio/flac'
          : 'audio/wav',
    });

    const beat = await prisma.beatAsset.create({
      data: {
        projectId: p.projectId,
        songId: p.songId,
        url: ingestedMain,
        format: result.output.format,
        bpm: result.output.bpm ?? p.input.bpm,
        keySignature: result.output.keySignature ?? p.input.keySignature,
        duration: result.output.durationS,
        provider: adapter.name,
        meta: { externalId: result.externalId } as never,
      },
    });

    if (result.output.stems?.length) {
      // Ingest each stem to our bucket first (parallel I/O), THEN build the
      // Prisma transaction. $transaction needs PrismaPromise[], not resolved values.
      const ingested = await Promise.all(
        result.output.stems.map(async (s) => ({
          role: s.role,
          url: await ingestRemoteFile({
            workspaceId: p.workspaceId,
            url: s.url,
            kind: 'stems',
            ext: 'wav',
            contentType: 'audio/wav',
          }),
        }))
      );
      await prisma.$transaction(
        ingested.map((s) =>
          prisma.stem.create({
            data: { beatId: beat.id, role: s.role, url: s.url, format: 'wav' },
          })
        )
      );
    }

    await markSucceeded(p.jobId, { beatId: beat.id, stems: result.output.stems?.length ?? 0 }, result.estimatedCostUsd);
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}

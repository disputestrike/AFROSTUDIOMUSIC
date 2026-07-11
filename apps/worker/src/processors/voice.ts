import { prisma } from '@afrohit/db';
import { voiceAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { ingestRemoteFile, uploadBytes } from '../lib/storage';

interface VoicePayload {
  jobId: string;
  workspaceId: string;
  projectId?: string;
  songId?: string;
  voiceProfileId: string;
  providerVoiceId: string | null;
  lyricBody: string;
  melody?: Record<string, unknown>;
  role: 'lead' | 'double' | 'ad-lib' | 'harmony';
  pitchCorrection?: { strength: number; retune: number };
  effects?: Record<string, unknown>;
}

export async function processVoice(p: VoicePayload) {
  await markRunning(p.jobId);
  try {
    if (!p.providerVoiceId) throw new Error('voice not READY');

    let adapter = voiceAdapter();
    const renderInput = {
      providerVoiceId: p.providerVoiceId,
      lyricBody: p.lyricBody,
      melody: p.melody,
      role: p.role,
      pitchCorrection: p.pitchCorrection,
      effects: p.effects,
    };
    let result = await adapter.render(renderInput);

    let attempts = 0;
    while (result.status === 'queued' || result.status === 'running') {
      if (!adapter.poll || !result.externalId) break;
      await new Promise((r) => setTimeout(r, result.pollAfterMs ?? 5_000));
      attempts += 1;
      if (attempts > 20) break;
      result = await adapter.poll(result.externalId);
    }

    // Graceful fallback to a marked placeholder if the real voice provider is
    // unavailable (e.g. ElevenLabs needs a paid plan), so the render still lands.
    let placeholder = false;
    let fallbackReason: string | undefined;
    if ((result.status !== 'succeeded' || !result.output) && adapter.name !== 'stub') {
      fallbackReason = result.error ?? 'provider_failed';
      const stub = voiceAdapter('stub');
      result = await stub.render({ ...renderInput, providerVoiceId: p.providerVoiceId ?? 'stub' });
      adapter = stub;
      placeholder = true;
    }

    if (result.status !== 'succeeded' || !result.output) {
      await markFailed(p.jobId, result.error ?? 'voice_render_failed');
      return;
    }

    // Re-host into our bucket. Adapters return EITHER raw bytes (upload them) OR a
    // real URL (ingest it). A sentinel/empty URL with no bytes is a hard failure —
    // never store an unplayable "inline:bytes:N" as the vocal (audit #7).
    const contentType = result.output.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
    let storedUrl: string;
    if (result.output.audioBytes?.byteLength) {
      storedUrl = await uploadBytes({
        workspaceId: p.workspaceId,
        kind: 'vocals',
        bytes: result.output.audioBytes,
        contentType,
        ext: result.output.format,
      });
    } else if (result.output.audioUrl && !result.output.audioUrl.startsWith('inline:')) {
      storedUrl = await ingestRemoteFile({
        workspaceId: p.workspaceId,
        url: result.output.audioUrl,
        kind: 'vocals',
        ext: result.output.format,
        contentType,
      });
    } else {
      await markFailed(p.jobId, 'voice_render_failed: engine returned no playable audio');
      return;
    }

    if (p.projectId) {
      await prisma.vocalRender.create({
        data: {
          projectId: p.projectId,
          songId: p.songId,
          voiceProfileId: p.voiceProfileId,
          role: p.role,
          url: storedUrl,
          duration: result.output.durationS,
          pitchCorrection: p.pitchCorrection as never,
          effects: p.effects as never,
          meta: { placeholder, fallbackReason } as never,
        },
      });
    }

    await markSucceeded(p.jobId, { url: storedUrl, placeholder, fallbackReason }, result.estimatedCostUsd);
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}

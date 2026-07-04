import { prisma } from '@afrohit/db';
import { voiceAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { ingestRemoteFile } from '../lib/storage';

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

    const adapter = voiceAdapter();
    let result = await adapter.render({
      providerVoiceId: p.providerVoiceId,
      lyricBody: p.lyricBody,
      melody: p.melody,
      role: p.role,
      pitchCorrection: p.pitchCorrection,
      effects: p.effects,
    });

    let attempts = 0;
    while (result.status === 'queued' || result.status === 'running') {
      if (!adapter.poll || !result.externalId) break;
      await new Promise((r) => setTimeout(r, result.pollAfterMs ?? 5_000));
      attempts += 1;
      if (attempts > 20) break;
      result = await adapter.poll(result.externalId);
    }

    if (result.status !== 'succeeded' || !result.output) {
      await markFailed(p.jobId, result.error ?? 'voice_render_failed');
      return;
    }

    // Some adapters return a sentinel "inline:bytes:N" + bytes side-channel;
    // others return a real URL. Always re-host into our bucket.
    let storedUrl = result.output.audioUrl;
    if (!storedUrl.startsWith('inline:')) {
      storedUrl = await ingestRemoteFile({
        workspaceId: p.workspaceId,
        url: result.output.audioUrl,
        kind: 'vocals',
        ext: result.output.format,
        contentType: result.output.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      });
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
        },
      });
    }

    await markSucceeded(p.jobId, { url: storedUrl }, result.estimatedCostUsd);
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}

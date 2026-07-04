import { prisma, VoiceProfileStatus } from '@afrohit/db';
import { voiceAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';

interface SetupPayload {
  jobId: string;
  workspaceId: string;
  voiceProfileId: string;
  name: string;
  sampleUrls: string[];
  language?: string;
  consentRecordingUrl?: string;
}

export async function processVoiceProfile(p: SetupPayload) {
  await markRunning(p.jobId);
  try {
    const adapter = voiceAdapter();
    await prisma.voiceProfile.update({
      where: { id: p.voiceProfileId },
      data: { status: VoiceProfileStatus.TRAINING },
    });

    const result = await adapter.createProfile({
      voiceProfileId: p.voiceProfileId,
      name: p.name,
      sampleUrls: p.sampleUrls,
      language: p.language,
      consentRecordingUrl: p.consentRecordingUrl,
    });

    if (result.status !== 'succeeded' || !result.output) {
      await prisma.voiceProfile.update({
        where: { id: p.voiceProfileId },
        data: { status: VoiceProfileStatus.FAILED },
      });
      await markFailed(p.jobId, result.error ?? 'voice_profile_failed');
      return;
    }

    await prisma.voiceProfile.update({
      where: { id: p.voiceProfileId },
      data: {
        status: VoiceProfileStatus.READY,
        providerVoiceId: result.output.providerVoiceId,
      },
    });
    await markSucceeded(p.jobId, result.output, result.estimatedCostUsd);
  } catch (err) {
    await prisma.voiceProfile.update({
      where: { id: p.voiceProfileId },
      data: { status: VoiceProfileStatus.FAILED },
    });
    await markFailed(p.jobId, err);
  }
}

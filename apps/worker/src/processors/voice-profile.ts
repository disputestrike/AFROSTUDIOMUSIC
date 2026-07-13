import { prisma, VoiceProfileStatus } from '@afrohit/db';
import { voiceAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { resolveAssetForProvider } from '../lib/storage';

interface SetupPayload {
  jobId: string;
  workspaceId: string;
  voiceProfileId: string;
  provider?: string;
  name: string;
  sampleUrls: string[];
  language?: string;
  consentRecordingUrl?: string;
}

export async function processVoiceProfile(p: SetupPayload) {
  await markRunning(p.jobId);
  try {
    const profile = await prisma.voiceProfile.findFirst({
      where: { id: p.voiceProfileId, workspaceId: p.workspaceId },
      select: { id: true },
    });
    if (!profile) throw new Error('voice_profile_not_found');
    const adapter = voiceAdapter(p.provider);
    await prisma.voiceProfile.update({
      where: { id: p.voiceProfileId },
      data: { status: VoiceProfileStatus.TRAINING },
    });

    const result = await adapter.createProfile({
      voiceProfileId: p.voiceProfileId,
      name: p.name,
      sampleUrls: await Promise.all(p.sampleUrls.map((url) => resolveAssetForProvider(url))),
      language: p.language,
      consentRecordingUrl: p.consentRecordingUrl
        ? await resolveAssetForProvider(p.consentRecordingUrl)
        : undefined,
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
    await prisma.voiceProfile.updateMany({
      where: { id: p.voiceProfileId, workspaceId: p.workspaceId },
      data: { status: VoiceProfileStatus.FAILED },
    });
    await markFailed(p.jobId, err);
  }
}

/**
 * VOICE-MODEL RE-HOST — durability fix (audit 2026-07-13).
 *
 * The default trainer (replicate/train-rvc-model) is a PREDICTION whose output is
 * the trained model FILE served from replicate.delivery — an EPHEMERAL URL. The
 * training poll stored it raw on voiceProfile.trainedVersion, so once Replicate
 * expires the link the voice can no longer /sing (the RVC engine re-downloads the
 * URL on every inference). The sung OUTPUT is already re-hosted (voice-sing.ts) —
 * this closes the asymmetry the audit found by re-hosting the MODEL FILE too.
 *
 * Runs on the worker (streams the download via ingestRemoteFile — no API memory
 * risk on a 100-500MB weights file), then repoints trainedVersion at the durable
 * owned URL, keeping the provider URL under trainingMeta.providerOutput for
 * provenance. Idempotent: a profile already on owned storage is a no-op.
 */
import { prisma } from '@afrohit/db';
import { ingestRemoteFile } from '../lib/storage';

interface VoiceRehostPayload {
  workspaceId: string;
  voiceProfileId: string;
  modelUrl: string; // the ephemeral provider URL to re-host
}

// Provider (ephemeral) hosts we must never keep as the of-record model URL.
const PROVIDER_HOST = /replicate\.delivery|\.blob\.core\.windows|oaidalleapi|fal\.media/i;

export async function processVoiceRehost(p: VoiceRehostPayload) {
  const profile = await prisma.voiceProfile.findUnique({ where: { id: p.voiceProfileId } });
  if (!profile) return;
  // Idempotent — if trainedVersion is already off the provider host, it's re-hosted.
  if (typeof profile.trainedVersion === 'string' && profile.trainedVersion && !PROVIDER_HOST.test(profile.trainedVersion)) return;
  if (!PROVIDER_HOST.test(p.modelUrl)) return; // nothing ephemeral to re-host

  const ext = /\.pth(\?|$)/i.test(p.modelUrl) ? 'pth' : 'zip';
  const durableUrl = await ingestRemoteFile({
    workspaceId: p.workspaceId,
    url: p.modelUrl,
    kind: 'voice-model',
    ext,
    contentType: ext === 'pth' ? 'application/octet-stream' : 'application/zip',
  });

  const meta = (profile.trainingMeta ?? {}) as Record<string, unknown>;
  await prisma.voiceProfile.update({
    where: { id: profile.id },
    data: {
      trainedVersion: durableUrl,
      trainingMeta: { ...meta, output: durableUrl, providerOutput: p.modelUrl, rehostedAt: new Date().toISOString() } as never,
    },
  });
}

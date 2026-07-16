import { JobStatus, prisma, VoiceProfileStatus } from "@afrohit/db";
import { voiceAdapter } from "@afrohit/ai";
import { markFailed } from "../lib/jobs";
import { resolveAssetForProvider } from "../lib/storage";

interface SetupPayload {
  jobId: string;
  workspaceId: string;
  voiceProfileId: string;
  artistId?: string;
  consentId?: string;
  provider?: string;
  name: string;
  sampleUrls: string[];
  language?: string;
  consentRecordingUrl?: string;
}

type AuthorizedProfile = {
  id: string;
  workspaceId: string;
  artistId: string;
  consentId: string;
  provider: string;
  name: string;
  status: VoiceProfileStatus;
  sampleUrls: string[];
  language: string | null;
  meta: unknown;
  consent: {
    id: string;
    workspaceId: string;
    artistId: string | null;
    revokedAt: Date | null;
    consentAudioUrl: string | null;
  };
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function validProviderVoiceArtifactId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{6,128}$/.test(value);
}

export function voiceProfileAuthorizationFailure(
  profile: AuthorizedProfile,
  workspaceId: string
): string | null {
  if (
    profile.workspaceId !== workspaceId ||
    profile.consent.workspaceId !== workspaceId
  )
    return "voice_workspace_mismatch";
  if (profile.consentId !== profile.consent.id) return "voice_consent_mismatch";
  if (profile.consent.revokedAt) return "voice_consent_revoked";
  if (
    !profile.consent.artistId ||
    profile.artistId !== profile.consent.artistId
  )
    return "voice_artist_mismatch";
  const meta = objectValue(profile.meta);
  if (meta.artistId !== profile.artistId)
    return "voice_profile_artist_mismatch";
  if (meta.consentId !== profile.consentId)
    return "voice_profile_consent_mismatch";
  return null;
}

function profileInputs(profile: AuthorizedProfile): string {
  return JSON.stringify({
    provider: profile.provider,
    name: profile.name,
    sampleUrls: profile.sampleUrls,
    language: profile.language,
    consentAudioUrl: profile.consent.consentAudioUrl,
  });
}

async function loadAuthorizedProfile(
  payload: SetupPayload
): Promise<AuthorizedProfile> {
  const profile = await prisma.voiceProfile.findFirst({
    where: { id: payload.voiceProfileId, workspaceId: payload.workspaceId },
    select: {
      id: true,
      workspaceId: true,
      artistId: true,
      consentId: true,
      provider: true,
      name: true,
      status: true,
      sampleUrls: true,
      language: true,
      meta: true,
      consent: {
        select: {
          id: true,
          workspaceId: true,
          artistId: true,
          revokedAt: true,
          consentAudioUrl: true,
        },
      },
    },
  });
  if (!profile) throw new Error("voice_profile_not_found");
  const failure = voiceProfileAuthorizationFailure(
    profile,
    payload.workspaceId
  );
  if (failure) throw new Error(failure);
  if (
    profile.status !== VoiceProfileStatus.PENDING &&
    profile.status !== VoiceProfileStatus.TRAINING
  ) {
    throw new Error(`voice_profile_not_trainable:${profile.status}`);
  }
  return profile;
}

async function deleteUnpersistedProviderVoice(
  provider: string,
  providerVoiceId: string
): Promise<void> {
  if (provider === "stub") return;
  if (provider !== "eleven" || !validProviderVoiceArtifactId(providerVoiceId))
    return;
  const key = process.env.ELEVENLABS_API_KEY ?? process.env.ELEVEN_API_KEY;
  if (!key) return;
  await fetch(
    `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(providerVoiceId)}`,
    {
      method: "DELETE",
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(30_000),
    }
  )
    .then(async response => {
      if (!response.ok && response.status !== 404)
        await response.body?.cancel().catch(() => undefined);
    })
    .catch(() => undefined);
}

export async function processVoiceProfile(payload: SetupPayload) {
  const claimed = await prisma.providerJob.updateMany({
    where: {
      id: payload.jobId,
      workspaceId: payload.workspaceId,
      status: JobStatus.QUEUED,
    },
    data: { status: JobStatus.RUNNING, startedAt: new Date() },
  });
  if (claimed.count !== 1) return;

  let createdProviderVoice: { provider: string; id: string } | null = null;
  try {
    const profile = await loadAuthorizedProfile(payload);
    const job = await prisma.providerJob.findFirst({
      where: {
        id: payload.jobId,
        workspaceId: payload.workspaceId,
        status: JobStatus.RUNNING,
      },
      select: { inputJson: true },
    });
    const jobLineage = objectValue(job?.inputJson);
    if (jobLineage.voiceProfileId !== profile.id)
      throw new Error("voice_job_profile_mismatch");
    if (jobLineage.artistId !== profile.artistId) {
      throw new Error("voice_job_artist_mismatch");
    }
    if (jobLineage.consentId !== profile.consentId) {
      throw new Error("voice_job_consent_mismatch");
    }

    const training = await prisma.voiceProfile.updateMany({
      where: {
        id: profile.id,
        workspaceId: payload.workspaceId,
        artistId: profile.artistId,
        consentId: profile.consentId,
        status: {
          in: [VoiceProfileStatus.PENDING, VoiceProfileStatus.TRAINING],
        },
        consent: {
          workspaceId: payload.workspaceId,
          artistId: profile.artistId,
          revokedAt: null,
        },
      },
      data: { status: VoiceProfileStatus.TRAINING },
    });
    if (training.count !== 1)
      throw new Error("voice_consent_changed_before_training");

    const resolvedSampleUrls = await Promise.all(
      profile.sampleUrls.map(url => resolveAssetForProvider(url))
    );
    const resolvedConsentRecordingUrl = profile.consent.consentAudioUrl
      ? await resolveAssetForProvider(profile.consent.consentAudioUrl)
      : undefined;

    // This reload is deliberately the final awaited operation before the provider call.
    const invocationProfile = await loadAuthorizedProfile(payload);
    if (profileInputs(invocationProfile) !== profileInputs(profile)) {
      throw new Error("voice_profile_inputs_changed_before_provider");
    }
    const adapter = voiceAdapter(invocationProfile.provider);
    const result = await adapter.createProfile({
      voiceProfileId: invocationProfile.id,
      name: invocationProfile.name,
      sampleUrls: resolvedSampleUrls,
      language: invocationProfile.language ?? undefined,
      consentRecordingUrl: resolvedConsentRecordingUrl,
    });

    if (result.status !== "succeeded" || !result.output) {
      await prisma.voiceProfile.updateMany({
        where: {
          id: profile.id,
          workspaceId: payload.workspaceId,
          status: { not: VoiceProfileStatus.REVOKED },
          consent: {
            workspaceId: payload.workspaceId,
            artistId: profile.artistId,
            revokedAt: null,
          },
        },
        data: { status: VoiceProfileStatus.FAILED },
      });
      await markFailed(payload.jobId, result.error ?? "voice_profile_failed");
      return;
    }
    if (!validProviderVoiceArtifactId(result.output.providerVoiceId)) {
      await prisma.voiceProfile.updateMany({
        where: {
          id: profile.id,
          workspaceId: payload.workspaceId,
          status: { not: VoiceProfileStatus.REVOKED },
          consent: {
            workspaceId: payload.workspaceId,
            artistId: profile.artistId,
            revokedAt: null,
          },
        },
        data: { status: VoiceProfileStatus.FAILED },
      });
      await markFailed(payload.jobId, "provider_voice_artifact_missing");
      return;
    }
    const providerOutput = result.output;
    createdProviderVoice = {
      provider: invocationProfile.provider,
      id: providerOutput.providerVoiceId,
    };

    // Recheck again at the persistence boundary, then atomically commit both
    // READY and the provider-job receipt under the same consent predicate.
    const persistenceProfile = await loadAuthorizedProfile(payload);
    if (
      profileInputs(persistenceProfile) !== profileInputs(invocationProfile)
    ) {
      throw new Error("voice_profile_inputs_changed_before_persistence");
    }
    await prisma.$transaction(async tx => {
      const activeConsent = await tx.voiceConsent.updateMany({
        where: {
          id: persistenceProfile.consentId,
          workspaceId: payload.workspaceId,
          artistId: persistenceProfile.artistId,
          revokedAt: null,
        },
        data: { revokedAt: null },
      });
      if (activeConsent.count !== 1)
        throw new Error("voice_consent_changed_before_persistence");
      const persisted = await tx.voiceProfile.updateMany({
        where: {
          id: persistenceProfile.id,
          workspaceId: payload.workspaceId,
          artistId: persistenceProfile.artistId,
          consentId: persistenceProfile.consentId,
          status: VoiceProfileStatus.TRAINING,
          consent: {
            workspaceId: payload.workspaceId,
            artistId: persistenceProfile.artistId,
            revokedAt: null,
          },
        },
        data: {
          status: VoiceProfileStatus.READY,
          providerVoiceId: providerOutput.providerVoiceId,
        },
      });
      if (persisted.count !== 1)
        throw new Error("voice_consent_changed_before_persistence");
      const completed = await tx.providerJob.updateMany({
        where: {
          id: payload.jobId,
          workspaceId: payload.workspaceId,
          status: JobStatus.RUNNING,
        },
        data: {
          status: JobStatus.SUCCEEDED,
          finishedAt: new Date(),
          outputJson: providerOutput as never,
          cost:
            result.estimatedCostUsd == null
              ? undefined
              : (result.estimatedCostUsd.toFixed(6) as never),
        },
      });
      if (completed.count !== 1)
        throw new Error("voice_job_canceled_before_persistence");
    });
    createdProviderVoice = null;
  } catch (error) {
    if (createdProviderVoice) {
      await deleteUnpersistedProviderVoice(
        createdProviderVoice.provider,
        createdProviderVoice.id
      );
    }
    await prisma.voiceProfile.updateMany({
      where: {
        id: payload.voiceProfileId,
        workspaceId: payload.workspaceId,
        status: { not: VoiceProfileStatus.REVOKED },
        consent: { workspaceId: payload.workspaceId, revokedAt: null },
      },
      data: { status: VoiceProfileStatus.FAILED },
    });
    await markFailed(payload.jobId, error);
  }
}

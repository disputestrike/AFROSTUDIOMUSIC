import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  jobReferencesVoiceLineage,
  trainedArtifactIdentifier,
  voiceLineageFailure,
} from "../../api/src/routes/voices";
import {
  validProviderVoiceArtifactId,
  voiceProfileAuthorizationFailure,
} from "../src/processors/voice-profile";
import {
  singVoiceAuthorizationFailure,
  trainedVoiceArtifactIdentifier,
  trainedVoiceModelUrl,
} from "../src/processors/voice-sing";

function ordered(source: string, first: string, second: string): void {
  const firstAt = source.indexOf(first);
  const secondAt = source.indexOf(second, firstAt + first.length);
  assert.notEqual(firstAt, -1, `missing source marker: ${first}`);
  assert.notEqual(
    secondAt,
    -1,
    `missing source marker after ${first}: ${second}`
  );
  assert.ok(firstAt < secondAt, `${first} must occur before ${second}`);
}

async function main() {
  const workspaceId = "workspace-a";
  const modelUrl = "https://models.example.test/voice/model.zip";
  const lineage = {
    id: "voice-a",
    workspaceId,
    artistId: "artist-a",
    consentId: "consent-a",
    status: "READY",
    trainingId: "training-a",
    destinationModel: "artist-a/voice-a",
    trainedVersion: modelUrl,
    trainingMeta: {
      artistId: "artist-a",
      consentId: "consent-a",
      datasetId: "dataset-a",
      datasetContentHash: "dataset-hash-a",
      output: modelUrl,
    },
    voiceDatasetId: "dataset-a",
    consent: {
      id: "consent-a",
      workspaceId,
      artistId: "artist-a",
      revokedAt: null,
    },
    voiceDataset: {
      id: "dataset-a",
      workspaceId,
      contentHash: "dataset-hash-a",
    },
  } as Parameters<typeof voiceLineageFailure>[0];

  assert.equal(voiceLineageFailure(lineage, workspaceId), null);
  assert.equal(
    voiceLineageFailure(
      { ...lineage, consent: { ...lineage.consent, revokedAt: new Date() } },
      workspaceId
    ),
    "voice_consent_revoked"
  );
  assert.equal(
    voiceLineageFailure({ ...lineage, artistId: "artist-b" }, workspaceId),
    "voice_artist_mismatch"
  );
  assert.equal(
    voiceLineageFailure(
      {
        ...lineage,
        trainingMeta: {
          consentId: "consent-a",
          datasetId: "dataset-a",
          datasetContentHash: "dataset-hash-a",
          output: modelUrl,
        },
      },
      workspaceId
    ),
    "voice_training_artist_mismatch"
  );
  assert.equal(
    voiceLineageFailure(
      {
        ...lineage,
        trainingMeta: {
          ...(lineage.trainingMeta as object),
          datasetContentHash: "wrong-hash",
        },
      },
      workspaceId
    ),
    "voice_training_dataset_hash_mismatch"
  );

  assert.equal(trainedArtifactIdentifier(modelUrl), modelUrl);
  assert.equal(
    trainedArtifactIdentifier({ version: "a".repeat(64) }),
    "a".repeat(64)
  );
  assert.equal(trainedArtifactIdentifier({ model: "owner/model" }), null);
  assert.equal(trainedArtifactIdentifier({ output: null }), null);

  const profileIds = new Set(["voice-a", "voice-b"]);
  assert.equal(
    jobReferencesVoiceLineage(
      { inputJson: { voiceProfileId: "voice-b" } },
      profileIds,
      "consent-a"
    ),
    true
  );
  assert.equal(
    jobReferencesVoiceLineage(
      { inputJson: {}, outbox: { payload: { consentId: "consent-a" } } },
      profileIds,
      "consent-a"
    ),
    true
  );
  assert.equal(
    jobReferencesVoiceLineage(
      { inputJson: { voiceProfileId: "voice-c", consentId: "consent-c" } },
      profileIds,
      "consent-a"
    ),
    false
  );

  const setupProfile = {
    id: lineage.id,
    workspaceId,
    artistId: lineage.artistId,
    consentId: lineage.consentId,
    provider: "eleven",
    name: "Lead voice",
    status: "PENDING",
    sampleUrls: ["s3://workspace-a/voice/sample.wav"],
    language: "en",
    meta: { artistId: lineage.artistId, consentId: lineage.consentId },
    consent: { ...lineage.consent, consentAudioUrl: null },
  } as Parameters<typeof voiceProfileAuthorizationFailure>[0];
  assert.equal(
    voiceProfileAuthorizationFailure(setupProfile, workspaceId),
    null
  );
  assert.equal(
    voiceProfileAuthorizationFailure(
      {
        ...setupProfile,
        consent: { ...setupProfile.consent, revokedAt: new Date() },
      },
      workspaceId
    ),
    "voice_consent_revoked"
  );
  assert.equal(
    voiceProfileAuthorizationFailure(
      { ...setupProfile, meta: { artistId: lineage.artistId } },
      workspaceId
    ),
    "voice_profile_consent_mismatch"
  );
  assert.equal(validProviderVoiceArtifactId("voice_artifact_12345"), true);
  assert.equal(validProviderVoiceArtifactId("bad id"), false);

  assert.equal(singVoiceAuthorizationFailure(lineage, workspaceId), null);
  assert.equal(trainedVoiceArtifactIdentifier(lineage), modelUrl);
  assert.equal(trainedVoiceModelUrl(lineage), modelUrl);
  assert.equal(
    singVoiceAuthorizationFailure(
      {
        ...lineage,
        trainedVersion: null,
        trainingMeta: {
          artistId: "artist-a",
          consentId: "consent-a",
          datasetId: "dataset-a",
          datasetContentHash: "dataset-hash-a",
        },
      },
      workspaceId
    ),
    "trained_model_artifact_missing"
  );

  const repo = join(process.cwd(), "..", "..");
  const apiSource = readFileSync(
    join(repo, "apps/api/src/routes/voices.ts"),
    "utf8"
  );
  const setupSource = readFileSync(
    join(repo, "apps/worker/src/processors/voice-profile.ts"),
    "utf8"
  );
  const singSource = readFileSync(
    join(repo, "apps/worker/src/processors/voice-sing.ts"),
    "utf8"
  );

  assert.match(
    apiSource,
    /where: \{ workspaceId, consentId: target\.consentId \}/
  );
  assert.equal(
    apiSource.match(/profile = await prisma\.\$transaction\(async tx => \{/g)
      ?.length,
    2
  );
  assert.ok(
    (apiSource.match(
      /const activeConsent = await tx\.voiceConsent\.updateMany/g
    )?.length ?? 0) >= 2
  );
  ordered(
    apiSource,
    "const revokedConsent = await prisma.voiceConsent.updateMany({",
    "const profiles: RevocationProfile[] = await prisma.voiceProfile.findMany({"
  );
  assert.match(
    apiSource,
    /\.\.\.profiles\.map\(profile\s*=>\s*prisma\.voiceProfile\.update/
  );
  assert.match(apiSource, /status: ["']CANCELED["']/);
  assert.match(
    apiSource,
    /app\.queues\.voice\.remove\(`provider-\$\{job\.id\}`\)/
  );
  assert.match(apiSource, /const completedArtifact =/);
  assert.match(apiSource, /trainedArtifactIdentifier\(state\.output\)/);
  assert.match(apiSource, /trained_model_artifact_missing/);
  assert.match(
    apiSource,
    /datasetContentHash: invocationVoice\.voiceDataset\?\.contentHash/
  );
  ordered(
    apiSource,
    "const invocationProfile = await loadVoiceLineage(workspaceId, profile.id);",
    "training = await startVoiceTraining({"
  );
  ordered(
    apiSource,
    "const state = await getVoiceTraining(",
    "const persistenceProfile = await loadVoiceLineage("
  );

  assert.match(setupSource, /status: JobStatus\.QUEUED/);
  assert.match(setupSource, /jobLineage\.artistId !== profile\.artistId/);
  ordered(
    setupSource,
    "const invocationProfile = await loadAuthorizedProfile(payload);",
    "const result = await adapter.createProfile({"
  );
  ordered(
    setupSource,
    "const persistenceProfile = await loadAuthorizedProfile(payload);",
    "await prisma.$transaction(async"
  );
  assert.match(setupSource, /status: VoiceProfileStatus\.READY/);
  assert.match(setupSource, /provider_voice_artifact_missing/);
  assert.match(
    setupSource,
    /const activeConsent = await tx\.voiceConsent\.updateMany/
  );

  assert.match(singSource, /status: JobStatus\.QUEUED/);
  assert.match(singSource, /input\.voiceDatasetId !== profile\.voiceDatasetId/);
  assert.doesNotMatch(
    singSource,
    /resolveAssetForProvider\(payload\.modelUrl\)/
  );
  ordered(
    singSource,
    "const invocationProfile = await loadAuthorizedVoice(payload);",
    "const conversion = await singWithVoice({"
  );
  ordered(
    singSource,
    "const separationProfile = await loadAuthorizedVoice(payload);",
    "const separated = await separateStemsRouted({"
  );
  ordered(
    singSource,
    "const persistenceProfile = await loadAuthorizedVoice(payload);",
    "const result = await prisma.$transaction(async"
  );
  assert.match(singSource, /consent:\s*\{/);
  assert.match(singSource, /artistId: persistenceProfile\.artistId/);
  assert.match(singSource, /revokedAt: null/);
  assert.equal(
    singSource.match(
      /const activeConsent = await tx\.voiceConsent\.updateMany/g
    )?.length,
    2
  );
  assert.match(singSource, /\.\.\.lineageReceipt/);

  console.log("voice consent enforcement: PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

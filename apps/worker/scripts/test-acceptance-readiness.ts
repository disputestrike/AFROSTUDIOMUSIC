import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { trainingDatasetHash } from "@afrohit/ai";
import {
  AFROONE_DIRECTIONS,
  AFROONE_ONTOLOGY_VERSION,
  AFROONE_RENDER_SPEC_VERSION,
  PRODUCER_EVIDENCE_CURRENT_VERSION,
  PRODUCER_EVIDENCE_FOLLOWUP_VERSION,
  PRODUCER_EVIDENCE_VERSION,
  UNPROMPTED_RETURN_MIN_DELAY_MS,
  type ProducerEvidencePackV2,
} from "@afrohit/shared";
import {
  ACCEPTANCE_READINESS_VERSION,
  SINGING_EXTERNAL_SCORE_EVENT,
  SINGING_EXTERNAL_SCORE_VERSION,
  acceptanceExitCode,
  evaluateAcceptanceReadiness,
  parseSingingExternalScore,
  type AcceptanceEvidenceSnapshot,
  type AcceptanceProviderJob,
} from "../src/lib/acceptance-readiness";
import {
  ACTIVE_MUSIC_MODEL_SETTING_KEY,
  MUSIC_TRAINING_EVALUATION_PREFIX,
} from "../src/lib/training-flywheel";
import { VIDEO_EVIDENCE_VERSION } from "../src/lib/video-evidence";

const workspaceId = "workspace_acceptance";
const projectId = "project_acceptance";
const songId = "song_acceptance";
const ontologyVersion = AFROONE_ONTOLOGY_VERSION;
const hashes = Array.from({ length: 40 }, (_, index) =>
  ((index + 1).toString(16).padStart(2, "0").repeat(32)).slice(0, 64)
);

function job(
  id: string,
  input: Partial<AcceptanceProviderJob> = {}
): AcceptanceProviderJob {
  return {
    id,
    workspaceId,
    projectId,
    kind: "music",
    provider: "afrohit-own",
    externalId: null,
    status: "SUCCEEDED",
    inputJson: {},
    outputJson: {},
    costUsd: 0,
    startedAt: "2026-07-19T12:00:00.000Z",
    finishedAt: "2026-07-19T12:01:00.000Z",
    createdAt: "2026-07-19T11:59:00.000Z",
    ...input,
  };
}

function shelfHash(
  rows: Array<{ materialId: string; materialContentHash: string | null }>
): string {
  const receipt = rows
    .map(row => `${row.materialId}:${row.materialContentHash ?? "unverified"}`)
    .sort()
    .join("|");
  return createHash("sha256").update(receipt).digest("hex");
}

function producerScores() {
  return Array.from({ length: 5 }, (_, index) => ({
    reviewerId: `producer_${index + 1}`,
    independent: index < 2,
    aiSkeptical: index === 2,
    percussionRoleCorrectness: 4.5,
    logDrumPlacement: 4.4,
    arrangementSpace: 4.3,
    hookLift: 4.6,
    lagosFeel: 4.7,
    feelsWestern: false,
    choseOverManualRebuild: index < 4,
    wouldPay: index < 3,
    preferredComparatorLabel: index < 4 ? "A" : "B",
  }));
}

function greenSnapshot(): AcceptanceEvidenceSnapshot {
  const trainingJobId = "training_job";
  const trainingId = "replicate_training";
  const modelRef = "disputestrike/afroone:accepted";
  const trainingAssets = [
    {
      id: "training_own_asset",
      origin: "own-master" as const,
      workspaceId: null,
      contentHash: hashes[0]!,
    },
    {
      id: "training_user_asset",
      origin: "user-original" as const,
      workspaceId,
      contentHash: hashes[1]!,
    },
  ];
  const trainingConsentSnapshot = [
    {
      id: "training_consent",
      workspaceId,
      consentVersion: "training-license-v1",
      consentTextHash: hashes[2]!,
      signedAt: "2026-07-18T09:00:00.000Z",
    },
  ];
  const consentSnapshotHash = createHash("sha256")
    .update(JSON.stringify(trainingConsentSnapshot))
    .digest("hex");
  const datasetHash = trainingDatasetHash(trainingAssets.map(asset => ({
    id: asset.id,
    origin: asset.origin,
    contentFingerprint: asset.contentHash,
  })));
  const evaluatedAt = "2026-07-19T10:10:00.000Z";
  const activatedAt = "2026-07-19T10:11:00.000Z";
  const evaluation = {
    candidateModelRef: modelRef,
    datasetHash,
    candidateScore: 86,
    evaluator: "independent-panel",
    measuredAt: evaluatedAt,
    minGain: 1,
  };
  const route = {
    schemaVersion: 1,
    active: {
      modelRef,
      providerJobId: trainingJobId,
      trainingId,
      datasetHash,
      score: 86,
      evaluatedAt,
      activatedAt,
    },
    previous: {
      modelRef: "disputestrike/afroone:incumbent",
      providerJobId: "training_incumbent_job",
      trainingId: "replicate_training_incumbent",
      datasetHash: hashes[39]!,
      score: 80,
      evaluatedAt: "2026-07-01T10:00:00.000Z",
      activatedAt: "2026-07-01T10:01:00.000Z",
    },
    events: [
      {
        type: "promoted",
        from: "disputestrike/afroone:incumbent",
        to: modelRef,
        at: activatedAt,
        reason: "candidate improved measured score",
      },
    ],
    updatedAt: activatedAt,
  };

  const materialIds = ["material_kick", "material_log", "material_perc", "material_keys"];
  const materialHashes = hashes.slice(1, 5);
  const childIds = materialIds.map((_, index) => `forge_${index}`);
  const coldBeatId = "cold_beat";
  const coldAssemblyId = "cold_assembly";
  const coldParentId = "cold_parent";
  const directionJobs: AcceptanceProviderJob[] = [];
  const replayJobs: AcceptanceProviderJob[] = [];
  const beats: AcceptanceEvidenceSnapshot["beats"] = [
    {
      id: coldBeatId,
      projectId,
      songId,
      url: "s3://acceptance/cold.wav",
      provider: "material",
      qualityState: "passed",
      contentHash: hashes[5]!,
      verifiedAt: "2026-07-19T12:07:00.000Z",
      approved: true,
    },
  ];
  const stems: AcceptanceEvidenceSnapshot["stems"] = [];
  const directionRows: ProducerEvidencePackV2["directions"] = [];
  AFROONE_DIRECTIONS.forEach((direction, index) => {
    const originalId = `direction_${index}`;
    const replayId = `replay_job_${index}`;
    const beatId = `direction_beat_${index}`;
    const replayBeatId = `replay_beat_${index}`;
    const contentHash = hashes[6 + index]!;
    const renderSpec = {
      version: AFROONE_RENDER_SPEC_VERSION,
      ontologyVersion,
      seed: 100 + index,
      direction,
      genre: "afrobeats",
      bpm: 104,
      durationS: 120,
    };
    directionJobs.push(
      job(originalId, {
        inputJson: { renderSpec, batchSeed: 42 },
        outputJson: { beatId },
        startedAt: `2026-07-19T12:1${index}:00.000Z`,
        finishedAt: `2026-07-19T12:${18 + index}:00.000Z`,
      })
    );
    replayJobs.push(
      job(replayId, {
        inputJson: { renderSpec, batchSeed: 42, replayOfBeatId: beatId },
        outputJson: { beatId: replayBeatId },
        startedAt: `2026-07-19T12:2${index}:00.000Z`,
        finishedAt: `2026-07-19T12:2${index + 1}:00.000Z`,
      })
    );
    beats.push(
      {
        id: beatId,
        projectId,
        songId,
        url: `s3://acceptance/${beatId}.wav`,
        provider: "afrohit-own",
        qualityState: "passed",
        contentHash,
        verifiedAt: "2026-07-19T12:20:00.000Z",
        approved: true,
      },
      {
        id: replayBeatId,
        projectId,
        songId,
        url: `s3://acceptance/${replayBeatId}.wav`,
        provider: "afrohit-own",
        qualityState: "passed",
        contentHash,
        verifiedAt: "2026-07-19T12:25:00.000Z",
        approved: true,
      }
    );
    for (const role of ["drums", "bass"]) {
      stems.push({
        id: `${beatId}_${role}`,
        beatId,
        role,
        url: `s3://acceptance/${beatId}-${role}.wav`,
        qualityState: "passed",
        contentHash: hashes[12 + index * 2 + (role === "bass" ? 1 : 0)]!,
        verifiedAt: "2026-07-19T12:20:00.000Z",
        lineage: {
          schemaVersion: 1,
          source: { kind: "beat", assetId: beatId, contentHash },
          derivation: { kind: "native_bus", engine: "afroone", jobId: originalId },
          role,
          createdAt: "2026-07-19T12:20:00.000Z",
        },
      });
    }
    directionRows.push({
      direction,
      jobId: originalId,
      beatId,
      audioUrl: `s3://acceptance/${beatId}.wav`,
      contentHash,
      stemCount: 2,
      stemsClean: true,
      replayVerified: true,
    });
  });

  const materialUsages = directionRows.flatMap(direction =>
    materialIds.map((materialId, index) => ({
      providerJobId: direction.jobId,
      beatId: direction.beatId!,
      materialId,
      materialContentHash: materialHashes[index]!,
    }))
  );
  const pack: ProducerEvidencePackV2 = {
    version: PRODUCER_EVIDENCE_CURRENT_VERSION,
    workspaceId,
    songId,
    shelfSnapshotHash: shelfHash(materialUsages),
    lane: "afrobeats",
    ontologyVersion,
    seed: 42,
    directions: directionRows,
    producerScores: producerScores(),
    session: {
      briefStartedAt: "2026-07-19T12:10:00.000Z",
      firstUsableDirectionAt: "2026-07-19T12:15:00.000Z",
      allDirectionsReadyAt: "2026-07-19T12:20:00.000Z",
      dawImportedAt: "2026-07-19T12:21:00.000Z",
      manualBaselineMs: 20 * 60_000,
      shelfMode: "ready",
      onboardingDurationMs: 0,
      technicalCorrections: [],
      blindedComparatorLabels: ["A", "B"],
    },
    totalWorkflowMs: 10 * 60_000,
    daw: "fl_studio",
    createdAt: "2026-07-19T12:30:00.000Z",
  };

  const singingJobId = "singing_job";
  const vocalRenderId = "vocal_accepted";
  const singingHashes = {
    lyricsHash: hashes[20]!,
    scoreHash: hashes[21]!,
    alignmentHash: hashes[22]!,
    manifestHash: hashes[23]!,
  };
  const vocalHash = hashes[24]!;
  const assetReceipt = {
    schemaVersion: 1,
    afroOneSinging: true,
    assetKind: "isolated_vocal",
    performanceKind: "sung_vocal",
    performanceSource: "generative_singing",
    spokenGuideNotSung: false,
    placeholder: false,
    engine: "ace-step",
    externalId: "singing_provider_1",
    exactScoreInput: false,
    seed: 42,
    ...singingHashes,
    cost: {
      currency: "USD",
      synthesisUsd: 0.1,
      voiceConversionUsd: 0,
      verificationUsd: 0.003,
      totalUsd: 0.103,
      estimated: false,
    },
    attempts: [],
    personalizedVoice: false,
  };

  const sceneIds = ["scene_0", "scene_1"];
  const sceneJobIds = ["scene_job_0", "scene_job_1"];
  const sceneHashes = [hashes[25]!, hashes[26]!];
  const assemblyId = "video_full";
  const assemblyJobId = "video_assembly_job";
  const assemblyHash = hashes[27]!;
  const assembly = {
    evidenceVersion: VIDEO_EVIDENCE_VERSION,
    providerJobId: assemblyJobId,
    kind: "full",
    durationS: 120,
    coveredS: 16,
    plannedS: 16,
    songDurationS: 120,
    shotsUsed: [0, 1],
    renderIdsUsed: sceneIds,
    sourceSceneHashes: sceneIds.map((renderId, index) => ({
      renderId,
      contentHash: sceneHashes[index]!,
    })),
    sequenceCount: 2,
    crossfades: 1,
    loopedCycles: 8,
    width: 1920,
    height: 1080,
    contentHash: assemblyHash,
    sizeBytes: 10_000,
    codec: "h264",
    container: "mp4",
    qualityState: "passed",
    renderedAt: "2026-07-19T13:05:00.000Z",
    audioSource: {
      id: directionRows[0]!.beatId,
      type: "beat",
      startS: 0,
      songId,
    },
  };

  const jobs: AcceptanceProviderJob[] = [
    job(trainingJobId, {
      workspaceId: "training",
      projectId: null,
      kind: "music-training",
      provider: "replicate",
      externalId: trainingId,
      inputJson: {
        datasetHash,
        eligible: trainingAssets.length,
        zipped: trainingAssets.length,
        trainingAssets,
        trainingConsentSnapshot,
        consentSnapshotHash,
      },
      outputJson: {
        phase: "promoted",
        trainingId,
        candidateModelRef: modelRef,
        activeModelRef: modelRef,
        promotedAt: activatedAt,
        evaluation: {
          ...evaluation,
          incumbentModelRef: "disputestrike/afroone:incumbent",
          incumbentScore: 80,
          minGain: 1,
          promote: true,
        },
      },
      costUsd: 0.5,
      startedAt: "2026-07-19T10:00:00.000Z",
      finishedAt: activatedAt,
    }),
    ...childIds.map((id, index) =>
      job(id, {
        kind: "material",
        provider: "workspace-music",
        inputJson: { role: ["kick", "log_drum", "percussion", "chords"][index] },
        outputJson: { materialId: materialIds[index] },
        startedAt: `2026-07-19T12:0${index}:00.000Z`,
        finishedAt: `2026-07-19T12:0${index + 3}:00.000Z`,
        costUsd: 0.01,
      })
    ),
    job(coldAssemblyId, {
      kind: "material",
      provider: "material",
      inputJson: {},
      outputJson: { beatId: coldBeatId },
      startedAt: "2026-07-19T12:05:00.000Z",
      finishedAt: "2026-07-19T12:07:00.000Z",
    }),
    job(coldParentId, {
      kind: "material-orchestration",
      provider: "internal",
      inputJson: { childJobIds: childIds },
      outputJson: {
        assemblyJobId: coldAssemblyId,
        beatId: coldBeatId,
        roles: ["kick", "log_drum", "percussion", "chords"],
      },
      startedAt: "2026-07-19T12:00:00.000Z",
      finishedAt: "2026-07-19T12:07:00.000Z",
    }),
    ...directionJobs,
    ...replayJobs,
    job(singingJobId, {
      kind: "voice",
      provider: "afroone-singing",
      externalId: "singing_provider_1",
      inputJson: { afroOneSinging: true, ...singingHashes },
      outputJson: {
        vocalRenderId,
        contentHash: vocalHash,
        approved: true,
        performanceKind: "sung_vocal",
      },
      costUsd: 0.103,
      startedAt: "2026-07-19T12:31:00.000Z",
      finishedAt: "2026-07-19T12:35:00.000Z",
    }),
    ...sceneJobIds.map((id, index) =>
      job(id, {
        kind: "video",
        provider: "runway",
        outputJson: {
          costEvidenceComplete: true,
          knownCostUsd: 0.2 + index * 0.1,
        },
        costUsd: 0.2 + index * 0.1,
        startedAt: "2026-07-19T12:45:00.000Z",
        finishedAt: "2026-07-19T12:50:00.000Z",
      })
    ),
    job(assemblyJobId, {
      kind: "video",
      provider: "assembler",
      outputJson: { videoRenderId: assemblyId, assembly },
      startedAt: "2026-07-19T13:00:00.000Z",
      finishedAt: "2026-07-19T13:05:00.000Z",
    }),
  ];
  const followupEvents = [0, 1, 2].flatMap(index => {
    const reviewerId = `producer_${index + 1}`;
    const paidAt = new Date(
      Date.parse(pack.createdAt) + (index + 1) * 60_000
    ).toISOString();
    const returnedAt = new Date(
      Date.parse(pack.createdAt) + UNPROMPTED_RETURN_MIN_DELAY_MS + index + 1
    ).toISOString();
    return [
      {
        id: `paid_followup_${index}`,
        workspaceId,
        name: "producer.evidence_followup",
        properties: {
          event: {
            version: PRODUCER_EVIDENCE_FOLLOWUP_VERSION,
            packId: "producer_event",
            reviewerId,
            type: "paid_session_use",
            recordedAt: paidAt,
          },
        },
        createdAt: paidAt,
      },
      {
        id: `return_followup_${index}`,
        workspaceId,
        name: "producer.evidence_followup",
        properties: {
          event: {
            version: PRODUCER_EVIDENCE_FOLLOWUP_VERSION,
            packId: "producer_event",
            reviewerId,
            type: "unprompted_return",
            recordedAt: returnedAt,
          },
        },
        createdAt: returnedAt,
      },
    ];
  });

  return {
    generatedAt: "2026-07-27T13:10:00.000Z",
    workspaceId,
    systemSettings: [
      { key: ACTIVE_MUSIC_MODEL_SETTING_KEY, value: JSON.stringify(route) },
      {
        key: `${MUSIC_TRAINING_EVALUATION_PREFIX}${trainingJobId}`,
        value: JSON.stringify(evaluation),
      },
    ],
    providerJobs: jobs,
    analyticsEvents: [
      {
        id: "producer_event",
        workspaceId,
        name: "producer.evidence_pack",
        properties: { pack },
        createdAt: "2026-07-19T12:30:01.000Z",
      },
      ...followupEvents,
      {
        id: "singing_score_event",
        workspaceId,
        name: SINGING_EXTERNAL_SCORE_EVENT,
        properties: {
          receipt: {
            version: SINGING_EXTERNAL_SCORE_VERSION,
            providerJobId: singingJobId,
            vocalRenderId,
            contentHash: vocalHash,
            evaluatorId: "external_vocal_director",
            independent: true,
            source: "external_human",
            measuredAt: "2026-07-19T12:40:00.000Z",
            releaseUsable: true,
            scores: {
              pitchAccuracy: 4.4,
              lyricClarity: 4.2,
              naturalness: 4.1,
              culturalFit: 4.5,
              releaseReadiness: 4.2,
            },
          },
        },
        createdAt: "2026-07-19T12:41:00.000Z",
      },
    ],
    vocalRenders: [
      {
        id: vocalRenderId,
        projectId,
        songId,
        url: "s3://acceptance/vocal.wav",
        assetKind: "isolated_vocal",
        performanceSource: "generative_singing",
        qualityState: "passed",
        contentHash: vocalHash,
        verifiedAt: "2026-07-19T12:35:00.000Z",
        alignment: { state: "measured", pass: true },
        meta: { receipt: assetReceipt },
        approved: true,
      },
    ],
    beats,
    stems,
    materialAssets: materialIds.map((id, index) => ({
      id,
      readiness: "ready",
      qualityState: "passed",
      contentHash: materialHashes[index]!,
      verifiedAt: "2026-07-19T12:06:00.000Z",
    })),
    materialUsages,
    videoRenders: [
      ...sceneIds.map((id, index) => ({
        id,
        projectId,
        conceptId: "video_concept",
        url: `s3://acceptance/${id}.mp4`,
        durationS: 8,
        provider: "runway",
        meta: {
          evidenceVersion: VIDEO_EVIDENCE_VERSION,
          providerJobId: sceneJobIds[index],
          renderedAt: "2026-07-19T12:50:00.000Z",
          shotIndex: index,
          shotPrompt: `Lagos performance scene ${index}`,
          contentHash: sceneHashes[index],
          sizeBytes: 2_000,
          width: 1920,
          height: 1080,
          measuredDurationS: 8,
          codec: "h264",
          container: "mp4",
          qualityState: "passed",
          outputAspectRatio: "16:9",
        },
        createdAt: "2026-07-19T12:50:00.000Z",
      })),
      {
        id: assemblyId,
        projectId,
        conceptId: "video_concept",
        url: "s3://acceptance/full.mp4",
        durationS: 120,
        provider: "assembler",
        meta: { assembly },
        createdAt: "2026-07-19T13:05:00.000Z",
      },
    ],
    videoConcepts: [
      {
        id: "video_concept",
        storyboard: {
          kind: "treatment",
          sequences: [
            { index: 0, label: "Intro", shotIndexes: [0] },
            { index: 1, label: "Hook", shotIndexes: [1] },
          ],
          shots: [
            { index: 0, sequenceIndex: 0, prompt: "Intro", duration_s: 8 },
            { index: 1, sequenceIndex: 1, prompt: "Hook", duration_s: 8 },
          ],
        },
      },
    ],
    audioArtifacts: [
      {
        id: directionRows[0]!.beatId!,
        kind: "beat",
        projectId,
        songId,
        url: directionRows[0]!.audioUrl!,
        qualityState: "passed",
        contentHash: directionRows[0]!.contentHash!,
        verifiedAt: "2026-07-19T12:20:00.000Z",
        approved: true,
      },
    ],
  };
}

function status(
  snapshot: AcceptanceEvidenceSnapshot,
  gateId: string
): "green" | "red" {
  const found = evaluateAcceptanceReadiness(snapshot).gates.find(
    gate => gate.id === gateId
  );
  assert.ok(found, `missing gate ${gateId}`);
  return found.status;
}

const complete = greenSnapshot();
const report = evaluateAcceptanceReadiness(complete);
assert.equal(report.version, ACCEPTANCE_READINESS_VERSION);
assert.equal(report.ready, true);
assert.deepEqual(report.summary, { green: 6, red: 0, total: 6 });
assert.equal(JSON.parse(JSON.stringify(report)).ready, true, "report must be machine-readable JSON");
assert.equal(acceptanceExitCode(report, true), 0);

const empty: AcceptanceEvidenceSnapshot = {
  generatedAt: complete.generatedAt,
  workspaceId,
  systemSettings: [],
  providerJobs: [],
  analyticsEvents: [],
  vocalRenders: [],
  beats: [],
  stems: [],
  materialAssets: [],
  materialUsages: [],
  videoRenders: [],
  videoConcepts: [],
  audioArtifacts: [],
};
const emptyReport = evaluateAcceptanceReadiness(empty);
assert.equal(emptyReport.ready, false);
assert.equal(emptyReport.summary.red, 6, "missing evidence can never become a synthetic pass");
assert.equal(acceptanceExitCode(emptyReport, false), 0);
assert.equal(acceptanceExitCode(emptyReport, true), 2, "strict mode must be nonzero when red");

const candidateOnly = structuredClone(complete);
const training = candidateOnly.providerJobs.find(row => row.id === "training_job")!;
(training.outputJson as Record<string, unknown>).phase = "candidate_ready";
assert.equal(status(candidateOnly, "training"), "red", "candidate-ready is not promoted");

const unboundEvaluation = structuredClone(complete);
const evaluationSetting = unboundEvaluation.systemSettings.find(row =>
  row.key.startsWith(MUSIC_TRAINING_EVALUATION_PREFIX)
)!;
evaluationSetting.value = JSON.stringify({
  ...JSON.parse(evaluationSetting.value),
  datasetHash: hashes[39],
});
assert.equal(status(unboundEvaluation, "training"), "red");

const unboundTrainingCorpus = structuredClone(complete);
const trainingInput = unboundTrainingCorpus.providerJobs.find(
  row => row.id === "training_job"
)!.inputJson as { trainingAssets: Array<{ contentHash: string }> };
trainingInput.trainingAssets[0]!.contentHash = hashes[38]!;
assert.equal(
  status(unboundTrainingCorpus, "training"),
  "red",
  "the promoted route cannot outlive the exact rights-clean dataset bytes"
);

const baselineOnly = structuredClone(complete);
const baselineRouteSetting = baselineOnly.systemSettings.find(
  row => row.key === ACTIVE_MUSIC_MODEL_SETTING_KEY
)!;
const baselineRoute = JSON.parse(baselineRouteSetting.value);
baselineRoute.previous = null;
baselineRoute.events[0].from = null;
baselineRouteSetting.value = JSON.stringify(baselineRoute);
assert.equal(
  status(baselineOnly, "training"),
  "red",
  "a first baseline is active but does not prove measured improvement"
);

const noExternalSinging = structuredClone(complete);
noExternalSinging.analyticsEvents = noExternalSinging.analyticsEvents.filter(
  row => row.name !== SINGING_EXTERNAL_SCORE_EVENT
);
assert.equal(status(noExternalSinging, "singing"), "red");

const weakSinging = structuredClone(complete);
const weakReceipt = (
  weakSinging.analyticsEvents.find(row => row.name === SINGING_EXTERNAL_SCORE_EVENT)!
    .properties as { receipt: { scores: { naturalness: number } } }
).receipt;
weakReceipt.scores.naturalness = 3.9;
assert.equal(status(weakSinging, "singing"), "red");

const invalidExternal = structuredClone(complete.analyticsEvents.find(
  row => row.name === SINGING_EXTERNAL_SCORE_EVENT
)!);
((invalidExternal.properties as { receipt: { independent: boolean } }).receipt).independent = false;
assert.equal(parseSingingExternalScore(invalidExternal), null);

const slowColdShelf = structuredClone(complete);
slowColdShelf.providerJobs.find(row => row.id === "cold_parent")!.finishedAt =
  "2026-07-19T12:11:00.001Z";
assert.equal(status(slowColdShelf, "cold_shelf"), "red");

const missingColdTimestamp = structuredClone(complete);
missingColdTimestamp.providerJobs.find(row => row.id === "forge_0")!.startedAt = null;
assert.equal(status(missingColdTimestamp, "cold_shelf"), "red");

const politePanel = structuredClone(complete);
const politePack = recordPack(politePanel);
politePack.producerScores = politePack.producerScores.slice(0, 4);
assert.equal(status(politePanel, "producer"), "red");

const forgedTiming = structuredClone(complete);
const forgedPack = recordPack(forgedTiming);
forgedPack.totalWorkflowMs -= 1_001;
assert.equal(status(forgedTiming, "producer"), "red", "reported timing cannot replace job timestamps");

const noFollowups = structuredClone(complete);
noFollowups.analyticsEvents = noFollowups.analyticsEvents.filter(
  row => row.name !== "producer.evidence_followup"
);
assert.equal(
  status(noFollowups, "producer"),
  "red",
  "initial panel answers cannot certify later paid use or return behavior"
);

const legacyOnly = structuredClone(complete);
const currentPack = recordPack(legacyOnly);
const legacyPack = {
  version: PRODUCER_EVIDENCE_VERSION,
  workspaceId: currentPack.workspaceId,
  songId: currentPack.songId,
  shelfSnapshotHash: currentPack.shelfSnapshotHash,
  lane: currentPack.lane,
  ontologyVersion: currentPack.ontologyVersion,
  seed: currentPack.seed,
  directions: currentPack.directions,
  producerScores: currentPack.producerScores.map(scoreRow => ({
    ...scoreRow,
    usedInPaidSession: true,
    returnedUnprompted: true,
  })),
  totalWorkflowMs: currentPack.totalWorkflowMs,
  manualWorkflowMs: currentPack.session.manualBaselineMs,
  daw: currentPack.daw,
  createdAt: currentPack.createdAt,
};
legacyOnly.analyticsEvents = legacyOnly.analyticsEvents
  .filter(row => row.name !== "producer.evidence_followup")
  .map(row =>
    row.name === "producer.evidence_pack"
      ? { ...row, properties: { pack: legacyPack } }
      : row
  );
assert.equal(
  status(legacyOnly, "producer"),
  "red",
  "legacy v1 claims are historical and can never certify readiness"
);

const brokenStem = structuredClone(complete);
brokenStem.stems[0]!.contentHash = null;
assert.equal(status(brokenStem, "stems"), "red");

const unboundStem = structuredClone(complete);
((unboundStem.stems[0]!.lineage as { source: { assetId: string } }).source).assetId =
  "different_beat";
assert.equal(status(unboundStem, "stems"), "red");

const oneScene = structuredClone(complete);
const videoAssembly = recordAssembly(oneScene);
videoAssembly.renderIdsUsed = ["scene_0"];
videoAssembly.shotsUsed = [0];
videoAssembly.sourceSceneHashes = [
  { renderId: "scene_0", contentHash: hashes[25] },
];
videoAssembly.sequenceCount = 1;
syncAssemblyJob(oneScene, videoAssembly);
assert.equal(status(oneScene, "video"), "red");

const unknownCost = structuredClone(complete);
unknownCost.providerJobs.find(row => row.id === "scene_job_0")!.costUsd = null;
assert.equal(status(unknownCost, "video"), "red");

const missingAudio = structuredClone(complete);
missingAudio.audioArtifacts = [];
assert.equal(status(missingAudio, "video"), "red");

const unscoped = structuredClone(complete);
unscoped.workspaceId = null;
const unscopedReport = evaluateAcceptanceReadiness(unscoped);
assert.equal(unscopedReport.ready, false);
assert.equal(
  unscopedReport.gates.filter(gate => gate.id !== "training").every(gate => gate.status === "red"),
  true
);

console.log(
  "acceptance readiness: six real-evidence gates, strict exit, and adversarial fail-closed cases passed"
);

function recordPack(snapshot: AcceptanceEvidenceSnapshot): ProducerEvidencePackV2 {
  const event = snapshot.analyticsEvents.find(row => row.name === "producer.evidence_pack")!;
  return (event.properties as { pack: ProducerEvidencePackV2 }).pack;
}

function recordAssembly(snapshot: AcceptanceEvidenceSnapshot): Record<string, unknown> {
  const row = snapshot.videoRenders.find(render => render.provider === "assembler")!;
  return ((row.meta as { assembly: Record<string, unknown> }).assembly);
}

function syncAssemblyJob(
  snapshot: AcceptanceEvidenceSnapshot,
  assembly: Record<string, unknown>
): void {
  const row = snapshot.videoRenders.find(render => render.provider === "assembler")!;
  snapshot.providerJobs.find(jobRow => jobRow.id === "video_assembly_job")!.outputJson = {
    videoRenderId: row.id,
    assembly,
  };
}

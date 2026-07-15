import assert from "node:assert/strict";
import {
  evaluateBenchmarkCorpus,
  evaluateCompetitorBenchmark,
  type BenchmarkScores,
} from "@afrohit/shared";

const hash = (index: number) => index.toString(16).padStart(64, "0");
const attestedAt = "2026-07-14T12:00:00.000Z";

function normalizationEvidence(index: number) {
  return {
    schemaVersion: 1,
    measuredAt: attestedAt,
    analyzer: {
      name: "ffmpeg",
      version: "7.1",
      loudnessMethod: "ebu_r128",
    },
    tolerances: {
      maxIntegratedLufsDelta: 0.5,
      maxDurationDeltaSeconds: 1,
    },
    afrohit: {
      contentHash: hash(index + 1),
      integratedLufs: -9,
      durationSeconds: 180 + index,
      metadata: { formatTagKeys: [], streamTagKeys: [] },
    },
    reference: {
      contentHash: hash(index + 101),
      integratedLufs: -8.7,
      durationSeconds: 180.5 + index,
      metadata: { formatTagKeys: [], streamTagKeys: [] },
    },
  };
}

function corpusRows() {
  const genres = [
    "afrobeats",
    "amapiano",
    "afro_fusion",
    "highlife",
    "afro_house",
  ];
  return Array.from({ length: 10 }, (_, index) => ({
    pairId: "pair-" + index,
    genre: genres[index % genres.length]!,
    competitor: "suno",
    afrohitContentHash: hash(index + 1),
    referenceContentHash: hash(index + 101),
    referenceSizeBytes: 2_048,
    referenceFormat: "wav",
    rightsBasis: "licensed_evaluation",
    rightsAttestation: {
      schemaVersion: 1,
      confirmed: true,
      basis: "licensed_evaluation",
      note: "Licensed for controlled blind evaluation.",
      attestedBy: "owner-1",
      attestedAt,
      contentHash: hash(index + 101),
      comparisonProtocol: {
        version: 1,
        blind: true,
        identityMetadataRemoved: true,
        loudnessMatched: true,
        durationMatched: true,
        independentJudgesMin: 3,
        note: "Controlled loudness- and duration-matched blind listening.",
        normalizationEvidence: normalizationEvidence(index),
      },
    },
  }));
}

const strong: BenchmarkScores = {
  groove: 5,
  genreIdentity: 5,
  songwriting: 4,
  vocals: 5,
  mix: 5,
  replayValue: 5,
};
const competitor: BenchmarkScores = {
  groove: 4,
  genreIdentity: 4,
  songwriting: 4,
  vocals: 4,
  mix: 4,
  replayValue: 4,
};

function rows(judgesPerPair: number, weakVocals = false) {
  const genres = [
    "afrobeats",
    "amapiano",
    "afro_fusion",
    "highlife",
    "afro_house",
  ];
  return Array.from({ length: 10 }, (_, pairIndex) =>
    Array.from({ length: judgesPerPair }, (_, judgeIndex) => ({
      pairId: `pair-${pairIndex}`,
      judgeId: `judge-${judgeIndex}`,
      genre: genres[pairIndex % genres.length]!,
      competitor: "suno",
      winner:
        judgeIndex === judgesPerPair - 1 && pairIndex < 3
          ? ("competitor" as const)
          : ("afrohit" as const),
      afrohitScores: weakVocals ? { ...strong, vocals: 2 } : strong,
      competitorScores: competitor,
    }))
  ).flat();
}

const empty = evaluateCompetitorBenchmark([]);
assert.equal(empty.claimReady, false);
assert.equal(empty.verdict, "insufficient_evidence");
assert.match(empty.claim, /No evidence-backed claim/);

const underJudged = evaluateCompetitorBenchmark(rows(2));
assert.equal(underJudged.sample.submittedJudgments, 20);
assert.equal(underJudged.sample.eligibleJudgments, 0);
assert.equal(underJudged.claimReady, false);

const proven = evaluateCompetitorBenchmark(rows(3));
assert.equal(proven.sample.eligibleJudgments, 30);
assert.equal(proven.sample.eligiblePairs, 10);
assert.equal(proven.sample.genres, 5);
assert.equal(proven.gates.samplePassed, true);
assert.equal(proven.gates.superiorityPassed, true);
assert.equal(proven.gates.dimensionFloorPassed, true);
assert.equal(proven.claimReady, true);
assert.equal(proven.verdict, "ahead_with_measured_confidence");
assert.ok((proven.winRateLower95 ?? 0) > 0.5);

const vocalDeficit = evaluateCompetitorBenchmark(rows(3, true));
assert.equal(vocalDeficit.gates.samplePassed, true);
assert.equal(vocalDeficit.gates.superiorityPassed, true);
assert.equal(vocalDeficit.gates.dimensionFloorPassed, false);
assert.equal(vocalDeficit.claimReady, false);
assert.equal(vocalDeficit.verdict, "competitive_not_proven_ahead");

const validCorpus = evaluateBenchmarkCorpus(corpusRows());
assert.equal(validCorpus.claimReady, true);
assert.equal(validCorpus.gates.normalizationPassed, true);
assert.equal(validCorpus.sample.normalizationValidPairs, 10);
assert.equal(validCorpus.sample.eligiblePairs, 10);
assert.equal(validCorpus.sample.genres, 5);

const booleanOnlyCorpus = corpusRows();
for (const row of booleanOnlyCorpus) {
  delete (
    (row.rightsAttestation as Record<string, unknown>)
      .comparisonProtocol as Record<string, unknown>
  ).normalizationEvidence;
}
const booleanOnlyResult = evaluateBenchmarkCorpus(booleanOnlyCorpus);
assert.equal(booleanOnlyResult.claimReady, false);
assert.equal(booleanOnlyResult.gates.protocolPassed, true);
assert.equal(booleanOnlyResult.gates.normalizationPassed, false);
assert.equal(booleanOnlyResult.sample.normalizationValidPairs, 0);
assert.equal(booleanOnlyResult.sample.eligiblePairs, 0);

const duplicateCorpus = corpusRows();
duplicateCorpus[1]!.referenceContentHash =
  duplicateCorpus[0]!.referenceContentHash;
(duplicateCorpus[1]!.rightsAttestation as Record<string, unknown>).contentHash =
  duplicateCorpus[0]!.referenceContentHash;
(
  (
    (duplicateCorpus[1]!.rightsAttestation as Record<string, unknown>)
      .comparisonProtocol as Record<string, unknown>
  ).normalizationEvidence as { reference: { contentHash: string } }
).reference.contentHash = duplicateCorpus[0]!.referenceContentHash;
const duplicateResult = evaluateBenchmarkCorpus(duplicateCorpus);
assert.equal(duplicateResult.claimReady, false);
assert.equal(duplicateResult.sample.eligiblePairs, 8);
assert.equal(duplicateResult.sample.duplicateReferencePairs, 2);

const invalidRights = corpusRows();
(invalidRights[0]!.rightsAttestation as Record<string, unknown>).confirmed =
  false;
const invalidRightsResult = evaluateBenchmarkCorpus(invalidRights);
assert.equal(invalidRightsResult.claimReady, false);
assert.equal(invalidRightsResult.sample.invalidRightsPairs, 1);

const invalidProtocol = corpusRows();
(
  (invalidProtocol[0]!.rightsAttestation as Record<string, unknown>)
    .comparisonProtocol as Record<string, unknown>
).loudnessMatched = false;
const invalidProtocolResult = evaluateBenchmarkCorpus(invalidProtocol);
assert.equal(invalidProtocolResult.claimReady, false);
assert.equal(invalidProtocolResult.sample.invalidProtocolPairs, 1);

const invalidLoudness = corpusRows();
(
  (
    (invalidLoudness[0]!.rightsAttestation as Record<string, unknown>)
      .comparisonProtocol as Record<string, unknown>
  ).normalizationEvidence as { reference: { integratedLufs: number } }
).reference.integratedLufs = -7;
const invalidLoudnessResult = evaluateBenchmarkCorpus(invalidLoudness);
assert.equal(invalidLoudnessResult.claimReady, false);
assert.equal(invalidLoudnessResult.sample.invalidNormalizationPairs, 1);

const invalidDuration = corpusRows();
(
  (
    (invalidDuration[0]!.rightsAttestation as Record<string, unknown>)
      .comparisonProtocol as Record<string, unknown>
  ).normalizationEvidence as { reference: { durationSeconds: number } }
).reference.durationSeconds = 182;
assert.equal(
  evaluateBenchmarkCorpus(invalidDuration).sample.invalidNormalizationPairs,
  1
);

const invalidMetadata = corpusRows();
(
  (
    (invalidMetadata[0]!.rightsAttestation as Record<string, unknown>)
      .comparisonProtocol as Record<string, unknown>
  ).normalizationEvidence as {
    reference: { metadata: { formatTagKeys: string[] } };
  }
).reference.metadata.formatTagKeys.push("artist");
assert.equal(
  evaluateBenchmarkCorpus(invalidMetadata).sample.invalidNormalizationPairs,
  1
);

const excessiveTolerance = corpusRows();
(
  (
    (excessiveTolerance[0]!.rightsAttestation as Record<string, unknown>)
      .comparisonProtocol as Record<string, unknown>
  ).normalizationEvidence as {
    tolerances: { maxIntegratedLufsDelta: number };
  }
).tolerances.maxIntegratedLufsDelta = 1.1;
assert.equal(
  evaluateBenchmarkCorpus(excessiveTolerance).sample
    .invalidNormalizationPairs,
  1
);

const crossSide = corpusRows();
crossSide[0]!.referenceContentHash = crossSide[1]!.afrohitContentHash;
(crossSide[0]!.rightsAttestation as Record<string, unknown>).contentHash =
  crossSide[1]!.afrohitContentHash;
(
  (
    (crossSide[0]!.rightsAttestation as Record<string, unknown>)
      .comparisonProtocol as Record<string, unknown>
  ).normalizationEvidence as { reference: { contentHash: string } }
).reference.contentHash = crossSide[1]!.afrohitContentHash;
const crossSideResult = evaluateBenchmarkCorpus(crossSide);
assert.equal(crossSideResult.claimReady, false);
assert.ok(crossSideResult.sample.crossSideHashCollisions > 0);
console.log("benchmark evidence gate tests passed");

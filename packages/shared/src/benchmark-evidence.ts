import { canonicalJson } from "./canonical-json";

export const BENCHMARK_DIMENSIONS = [
  "groove",
  "genreIdentity",
  "songwriting",
  "vocals",
  "mix",
  "replayValue",
] as const;

export type BenchmarkDimension = (typeof BENCHMARK_DIMENSIONS)[number];
export type BenchmarkScores = Record<BenchmarkDimension, number>;

export interface CompetitorJudgmentEvidence {
  pairId: string;
  judgeId: string;
  genre: string;
  competitor: string;
  winner: "afrohit" | "competitor" | "tie";
  afrohitScores: BenchmarkScores;
  competitorScores: BenchmarkScores;
}

export interface BenchmarkEvidenceOptions {
  competitor?: string;
  minJudgments?: number;
  minPairs?: number;
  minGenres?: number;
  minJudgesPerPair?: number;
  maxDimensionDeficit?: number;
}

export interface CompetitorPairEvidence {
  pairId: string;
  genre: string;
  competitor: string;
  afrohitContentHash: string;
  referenceContentHash: string;
  referenceSizeBytes: number;
  referenceFormat: string;
  rightsBasis: string;
  rightsAttestation: unknown;
}

export interface BenchmarkCorpusOptions {
  competitor?: string;
  minPairs?: number;
  minGenres?: number;
}

export const BENCHMARK_NORMALIZATION_LIMITS = {
  maxIntegratedLufsDelta: 1,
  maxDurationDeltaSeconds: 1,
} as const;

export interface BenchmarkNormalizationSideEvidence {
  contentHash: string;
  integratedLufs: number;
  durationSeconds: number;
  metadata: {
    formatTagKeys: string[];
    streamTagKeys: string[];
  };
}

export interface BenchmarkNormalizationEvidence {
  schemaVersion: 1;
  measuredAt: string;
  analyzer: {
    name: string;
    version: string;
    loudnessMethod: "ebu_r128";
  };
  tolerances: {
    maxIntegratedLufsDelta: number;
    maxDurationDeltaSeconds: number;
  };
  afrohit: BenchmarkNormalizationSideEvidence;
  reference: BenchmarkNormalizationSideEvidence;
}

const CONTENT_HASH = /^[a-f0-9]{64}$/i;
const RIGHTS_BASES = new Set(["owner", "licensed_evaluation"]);
const NORMALIZATION_EPSILON = 1e-9;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return canonicalJson(actual) === canonicalJson(expected);
}

function validUtcTimestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.endsWith("Z") &&
    Number.isFinite(Date.parse(value))
  );
}

function hasValidRights(row: CompetitorPairEvidence): boolean {
  if (
    !row.rightsAttestation ||
    typeof row.rightsAttestation !== "object" ||
    Array.isArray(row.rightsAttestation)
  ) {
    return false;
  }
  const attestation = row.rightsAttestation as Record<string, unknown>;
  return (
    attestation.schemaVersion === 1 &&
    attestation.confirmed === true &&
    RIGHTS_BASES.has(row.rightsBasis) &&
    attestation.basis === row.rightsBasis &&
    typeof attestation.note === "string" &&
    attestation.note.trim().length >= 3 &&
    typeof attestation.attestedBy === "string" &&
    attestation.attestedBy.length > 0 &&
    validUtcTimestamp(attestation.attestedAt) &&
    attestation.contentHash === row.referenceContentHash
  );
}

function hasValidComparisonProtocol(row: CompetitorPairEvidence): boolean {
  const attestation =
    row.rightsAttestation &&
    typeof row.rightsAttestation === "object" &&
    !Array.isArray(row.rightsAttestation)
      ? (row.rightsAttestation as Record<string, unknown>)
      : null;
  const protocol =
    attestation?.comparisonProtocol &&
    typeof attestation.comparisonProtocol === "object" &&
    !Array.isArray(attestation.comparisonProtocol)
      ? (attestation.comparisonProtocol as Record<string, unknown>)
      : null;
  return (
    protocol?.version === 1 &&
    protocol.blind === true &&
    protocol.identityMetadataRemoved === true &&
    protocol.loudnessMatched === true &&
    protocol.durationMatched === true &&
    typeof protocol.independentJudgesMin === "number" &&
    Number.isInteger(protocol.independentJudgesMin) &&
    protocol.independentJudgesMin >= 3 &&
    typeof protocol.note === "string" &&
    protocol.note.trim().length >= 10
  );
}

function hasValidNormalizationSide(
  value: unknown,
  expectedContentHash: string
): value is BenchmarkNormalizationSideEvidence {
  const side = record(value);
  const metadata = record(side?.metadata);
  return (
    !!side &&
    hasExactKeys(side, [
      "contentHash",
      "integratedLufs",
      "durationSeconds",
      "metadata",
    ]) &&
    typeof side.contentHash === "string" &&
    CONTENT_HASH.test(side.contentHash) &&
    side.contentHash.toLowerCase() === expectedContentHash.toLowerCase() &&
    typeof side.integratedLufs === "number" &&
    Number.isFinite(side.integratedLufs) &&
    side.integratedLufs >= -70 &&
    side.integratedLufs <= 5 &&
    typeof side.durationSeconds === "number" &&
    Number.isFinite(side.durationSeconds) &&
    side.durationSeconds >= 1 &&
    side.durationSeconds <= 21_600 &&
    !!metadata &&
    hasExactKeys(metadata, ["formatTagKeys", "streamTagKeys"]) &&
    Array.isArray(metadata.formatTagKeys) &&
    metadata.formatTagKeys.length === 0 &&
    Array.isArray(metadata.streamTagKeys) &&
    metadata.streamTagKeys.length === 0
  );
}

/**
 * Validate persisted, asset-bound normalization measurements. Declaration
 * booleans are intentionally insufficient: both sides need measured LUFS and
 * duration values, plus empty post-normalization metadata tag inventories.
 */
export function hasValidBenchmarkNormalizationEvidence(
  row: CompetitorPairEvidence
): boolean {
  const attestation = record(row.rightsAttestation);
  const protocol = record(attestation?.comparisonProtocol);
  const evidence = record(protocol?.normalizationEvidence);
  const analyzer = record(evidence?.analyzer);
  const tolerances = record(evidence?.tolerances);
  if (
    !evidence ||
    !hasExactKeys(evidence, [
      "schemaVersion",
      "measuredAt",
      "analyzer",
      "tolerances",
      "afrohit",
      "reference",
    ]) ||
    evidence.schemaVersion !== 1 ||
    !validUtcTimestamp(evidence.measuredAt) ||
    !analyzer ||
    !hasExactKeys(analyzer, ["name", "version", "loudnessMethod"]) ||
    typeof analyzer.name !== "string" ||
    analyzer.name.trim().length < 2 ||
    typeof analyzer.version !== "string" ||
    analyzer.version.trim().length < 1 ||
    analyzer.loudnessMethod !== "ebu_r128" ||
    !tolerances ||
    !hasExactKeys(tolerances, [
      "maxIntegratedLufsDelta",
      "maxDurationDeltaSeconds",
    ]) ||
    typeof tolerances.maxIntegratedLufsDelta !== "number" ||
    !Number.isFinite(tolerances.maxIntegratedLufsDelta) ||
    tolerances.maxIntegratedLufsDelta < 0 ||
    tolerances.maxIntegratedLufsDelta >
      BENCHMARK_NORMALIZATION_LIMITS.maxIntegratedLufsDelta ||
    typeof tolerances.maxDurationDeltaSeconds !== "number" ||
    !Number.isFinite(tolerances.maxDurationDeltaSeconds) ||
    tolerances.maxDurationDeltaSeconds < 0 ||
    tolerances.maxDurationDeltaSeconds >
      BENCHMARK_NORMALIZATION_LIMITS.maxDurationDeltaSeconds ||
    !hasValidNormalizationSide(evidence.afrohit, row.afrohitContentHash) ||
    !hasValidNormalizationSide(evidence.reference, row.referenceContentHash)
  ) {
    return false;
  }

  const afrohit =
    evidence.afrohit as unknown as BenchmarkNormalizationSideEvidence;
  const reference =
    evidence.reference as unknown as BenchmarkNormalizationSideEvidence;
  return (
    Math.abs(afrohit.integratedLufs - reference.integratedLufs) <=
      tolerances.maxIntegratedLufsDelta + NORMALIZATION_EPSILON &&
    Math.abs(afrohit.durationSeconds - reference.durationSeconds) <=
      tolerances.maxDurationDeltaSeconds + NORMALIZATION_EPSILON
  );
}

/**
 * Select the frozen, rights-attested, byte-independent pair corpus that may
 * contribute to a competitive claim. Duplicate audio is excluded on both
 * sides instead of being allowed to multiply listening judgments.
 */
export function evaluateBenchmarkCorpus(
  rows: CompetitorPairEvidence[],
  options: BenchmarkCorpusOptions = {}
) {
  const competitor = (options.competitor ?? "suno").trim().toLowerCase();
  const minPairs = options.minPairs ?? 10;
  const minGenres = options.minGenres ?? 5;
  const relevant = rows.filter(
    row =>
      row.competitor.trim().toLowerCase() === competitor &&
      row.pairId.trim().length > 0 &&
      row.genre.trim().length > 0
  );
  const referenceCounts = new Map<string, number>();
  const afrohitCounts = new Map<string, number>();
  for (const row of relevant) {
    const referenceHash = row.referenceContentHash.toLowerCase();
    const afrohitHash = row.afrohitContentHash.toLowerCase();
    if (CONTENT_HASH.test(referenceHash)) {
      referenceCounts.set(
        referenceHash,
        (referenceCounts.get(referenceHash) ?? 0) + 1
      );
    }
    if (CONTENT_HASH.test(afrohitHash)) {
      afrohitCounts.set(afrohitHash, (afrohitCounts.get(afrohitHash) ?? 0) + 1);
    }
  }
  const crossSideHashes = new Set(
    [...referenceCounts.keys()].filter(hash => afrohitCounts.has(hash))
  );
  const rightsValid = relevant.filter(hasValidRights);
  const protocolValid = rightsValid.filter(hasValidComparisonProtocol);
  const normalizationValid = protocolValid.filter(
    hasValidBenchmarkNormalizationEvidence
  );
  const eligible = normalizationValid.filter(row => {
    const referenceHash = row.referenceContentHash.toLowerCase();
    const afrohitHash = row.afrohitContentHash.toLowerCase();
    return (
      CONTENT_HASH.test(referenceHash) &&
      CONTENT_HASH.test(afrohitHash) &&
      Number.isInteger(row.referenceSizeBytes) &&
      row.referenceSizeBytes >= 1_000 &&
      row.referenceFormat.trim().length > 0 &&
      referenceCounts.get(referenceHash) === 1 &&
      afrohitCounts.get(afrohitHash) === 1 &&
      referenceHash !== afrohitHash &&
      !crossSideHashes.has(referenceHash) &&
      !crossSideHashes.has(afrohitHash)
    );
  });
  const genres = new Set(eligible.map(row => row.genre.trim().toLowerCase()));
  const duplicateReferencePairs = relevant.filter(
    row =>
      (referenceCounts.get(row.referenceContentHash.toLowerCase()) ?? 0) > 1
  ).length;
  const duplicateAfrohitPairs = relevant.filter(
    row => (afrohitCounts.get(row.afrohitContentHash.toLowerCase()) ?? 0) > 1
  ).length;
  const rightsPassed = rightsValid.length >= minPairs;
  const protocolPassed = protocolValid.length >= minPairs;
  const normalizationPassed = normalizationValid.length >= minPairs;
  const independencePassed = eligible.length >= minPairs;
  const genreCoveragePassed = genres.size >= minGenres;

  return {
    competitor,
    claimReady:
      rightsPassed &&
      protocolPassed &&
      normalizationPassed &&
      independencePassed &&
      genreCoveragePassed,
    eligiblePairIds: eligible.map(row => row.pairId).sort(),
    sample: {
      totalPairs: relevant.length,
      rightsValidPairs: rightsValid.length,
      protocolValidPairs: protocolValid.length,
      normalizationValidPairs: normalizationValid.length,
      eligiblePairs: eligible.length,
      uniqueReferenceHashes: referenceCounts.size,
      uniqueAfrohitHashes: afrohitCounts.size,
      genres: genres.size,
      invalidRightsPairs: relevant.length - rightsValid.length,
      invalidProtocolPairs: rightsValid.length - protocolValid.length,
      invalidNormalizationPairs:
        protocolValid.length - normalizationValid.length,
      duplicateReferencePairs,
      duplicateAfrohitPairs,
      crossSideHashCollisions: crossSideHashes.size,
    },
    gates: {
      rightsPassed,
      protocolPassed,
      normalizationPassed,
      independencePassed,
      genreCoveragePassed,
      required: {
        minPairs,
        minGenres,
        ...BENCHMARK_NORMALIZATION_LIMITS,
      },
    },
  };
}
function wilsonLowerBound(
  successes: number,
  trials: number,
  z = 1.96
): number | null {
  if (trials <= 0) return null;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return Math.max(0, (center - margin) / denominator);
}

function finiteScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 5
  );
}

export function isBenchmarkScores(value: unknown): value is BenchmarkScores {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return BENCHMARK_DIMENSIONS.every(dimension =>
    finiteScore((value as Record<string, unknown>)[dimension])
  );
}

export function evaluateCompetitorBenchmark(
  rows: CompetitorJudgmentEvidence[],
  options: BenchmarkEvidenceOptions = {}
) {
  const competitor = (options.competitor ?? "suno").trim().toLowerCase();
  const minJudgments = options.minJudgments ?? 30;
  const minPairs = options.minPairs ?? 10;
  const minGenres = options.minGenres ?? 5;
  const minJudgesPerPair = options.minJudgesPerPair ?? 3;
  const maxDimensionDeficit = options.maxDimensionDeficit ?? 0.25;

  const valid = rows.filter(
    row =>
      row.competitor.trim().toLowerCase() === competitor &&
      row.pairId &&
      row.judgeId &&
      row.genre &&
      ["afrohit", "competitor", "tie"].includes(row.winner) &&
      isBenchmarkScores(row.afrohitScores) &&
      isBenchmarkScores(row.competitorScores)
  );
  const judgesByPair = new Map<string, Set<string>>();
  for (const row of valid) {
    const judges = judgesByPair.get(row.pairId) ?? new Set<string>();
    judges.add(row.judgeId);
    judgesByPair.set(row.pairId, judges);
  }
  const eligiblePairs = new Set(
    [...judgesByPair.entries()]
      .filter(([, judges]) => judges.size >= minJudgesPerPair)
      .map(([pairId]) => pairId)
  );
  const eligible = valid.filter(row => eligiblePairs.has(row.pairId));
  const genres = new Set(eligible.map(row => row.genre.trim().toLowerCase()));
  const wins = eligible.filter(row => row.winner === "afrohit").length;
  const losses = eligible.filter(row => row.winner === "competitor").length;
  const ties = eligible.filter(row => row.winner === "tie").length;
  const decisive = wins + losses;
  const winRate = decisive ? wins / decisive : null;
  const winRateLower95 = wilsonLowerBound(wins, decisive);

  const dimensionDelta = Object.fromEntries(
    BENCHMARK_DIMENSIONS.map(dimension => {
      const delta = eligible.length
        ? eligible.reduce(
            (sum, row) =>
              sum +
              row.afrohitScores[dimension] -
              row.competitorScores[dimension],
            0
          ) / eligible.length
        : 0;
      return [dimension, Number(delta.toFixed(3))];
    })
  ) as Record<BenchmarkDimension, number>;
  const dimensionFloorPassed = BENCHMARK_DIMENSIONS.every(
    dimension => dimensionDelta[dimension] >= -maxDimensionDeficit
  );
  const samplePassed =
    eligible.length >= minJudgments &&
    eligiblePairs.size >= minPairs &&
    genres.size >= minGenres;
  const superiorityPassed = winRateLower95 !== null && winRateLower95 > 0.5;
  const claimReady = samplePassed && superiorityPassed && dimensionFloorPassed;
  const verdict = !samplePassed
    ? "insufficient_evidence"
    : claimReady
      ? "ahead_with_measured_confidence"
      : winRate !== null && winRate < 0.5
        ? "behind"
        : "competitive_not_proven_ahead";

  return {
    competitor,
    verdict,
    claimReady,
    claim: claimReady
      ? `AfroHits outperformed ${competitor} in this controlled listening benchmark.`
      : `No evidence-backed claim that AfroHits outperforms ${competitor} is permitted yet.`,
    sample: {
      submittedJudgments: valid.length,
      eligibleJudgments: eligible.length,
      eligiblePairs: eligiblePairs.size,
      genres: genres.size,
      wins,
      losses,
      ties,
    },
    winRate: winRate === null ? null : Number(winRate.toFixed(4)),
    winRateLower95:
      winRateLower95 === null ? null : Number(winRateLower95.toFixed(4)),
    dimensionDelta,
    gates: {
      samplePassed,
      superiorityPassed,
      dimensionFloorPassed,
      required: {
        minJudgments,
        minPairs,
        minGenres,
        minJudgesPerPair,
        maxDimensionDeficit,
      },
    },
  };
}

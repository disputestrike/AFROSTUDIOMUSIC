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

const CONTENT_HASH = /^[a-f0-9]{64}$/i;
const RIGHTS_BASES = new Set(["owner", "licensed_evaluation"]);

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
  const eligible = protocolValid.filter(row => {
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
  const independencePassed = eligible.length >= minPairs;
  const genreCoveragePassed = genres.size >= minGenres;

  return {
    competitor,
    claimReady:
      rightsPassed &&
      protocolPassed &&
      independencePassed &&
      genreCoveragePassed,
    eligiblePairIds: eligible.map(row => row.pairId).sort(),
    sample: {
      totalPairs: relevant.length,
      rightsValidPairs: rightsValid.length,
      protocolValidPairs: protocolValid.length,
      eligiblePairs: eligible.length,
      uniqueReferenceHashes: referenceCounts.size,
      uniqueAfrohitHashes: afrohitCounts.size,
      genres: genres.size,
      invalidRightsPairs: relevant.length - rightsValid.length,
      invalidProtocolPairs: rightsValid.length - protocolValid.length,
      duplicateReferencePairs,
      duplicateAfrohitPairs,
      crossSideHashCollisions: crossSideHashes.size,
    },
    gates: {
      rightsPassed,
      protocolPassed,
      independencePassed,
      genreCoveragePassed,
      required: { minPairs, minGenres },
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
      ? `AfroHit outperformed ${competitor} in this controlled listening benchmark.`
      : `No evidence-backed claim that AfroHit outperforms ${competitor} is permitted yet.`,
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

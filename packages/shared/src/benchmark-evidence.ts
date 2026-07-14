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

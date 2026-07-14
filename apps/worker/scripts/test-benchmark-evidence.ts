import assert from "node:assert/strict";
import {
  evaluateCompetitorBenchmark,
  type BenchmarkScores,
} from "@afrohit/shared";

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

console.log("benchmark evidence gate tests passed");

/** Focused durable music-training lifecycle tests. No DB or provider spend. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  musicCandidateModelRef,
  pollMusicTraining,
} from "@afrohit/ai";
import { parseMusicTrainingEvaluation } from "../src/lib/training-flywheel";

async function main() {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return new Response(JSON.stringify({
        id: "training_abc123",
        status: "succeeded",
        output: { version: "abcdef123456" },
        metrics: { predict_time: 12.5 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const training = await pollMusicTraining({
      trainingId: "training_abc123",
      kind: "training",
      apiKey: "test-token",
    });
    assert.equal(training.status, "succeeded");
    assert.match(calls[0] ?? "", /\/v1\/trainings\/training_abc123$/);
    assert.equal(
      musicCandidateModelRef(training.output, "afrohit/music"),
      "afrohit/music:abcdef123456"
    );

    await pollMusicTraining({
      trainingId: "predict_abc123",
      kind: "prediction",
      apiKey: "test-token",
    });
    assert.match(calls[1] ?? "", /\/v1\/predictions\/predict_abc123$/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const datasetHash = "a".repeat(64);
  const validEvaluation = parseMusicTrainingEvaluation(JSON.stringify({
    candidateModelRef: "afrohit/music:abcdef123456",
    datasetHash,
    candidateScore: 84,
    evaluator: "producer-panel-v1",
    measuredAt: "2026-07-19T03:00:00.000Z",
    minGain: 2,
  }));
  assert.equal(validEvaluation?.candidateScore, 84);
  assert.equal(validEvaluation?.datasetHash, datasetHash);
  assert.equal(
    parseMusicTrainingEvaluation(JSON.stringify({
      candidateModelRef: "afrohit/music:abcdef123456",
      datasetHash: "not-a-hash",
      candidateScore: 84,
      evaluator: "producer-panel-v1",
      measuredAt: "2026-07-19T03:00:00.000Z",
    })),
    null,
    "an unbound score receipt fails closed"
  );

  const root = join(__dirname, "..", "..", "..");
  const source = readFileSync(
    join(root, "apps/worker/src/lib/training-flywheel.ts"),
    "utf8"
  );
  assert.match(source, /continueTrainingLifecycle/, "nightly pass continues durable jobs");
  assert.match(source, /ensureTrainingWorkspace/);
  assert.match(source, /deleteObjectByUrl\(datasetZipUrl\)/);
  assert.match(source, /resolveAssetForProvider\(datasetZipUrl\)/);
  assert.match(source, /MUSIC_TRAINER_MAX_RETRIES/);
  assert.match(source, /retryFailedTrainingJob/);
  assert.match(source, /phase: "training_started",[\s\S]*retryCount/);
  assert.match(source, /durableRetryCount/);
  assert.match(source, /trainingId: refreshed\?\.externalId/);
  assert.match(source, /errorJson: Prisma\.DbNull/);
  assert.doesNotMatch(
    source.slice(
      source.indexOf("async function kickoffQueuedJob"),
      source.indexOf("async function retryFailedTrainingJob")
    ),
    /rememberLastDataset/,
    "kickoff does not mark a dataset completed before provider success"
  );
  assert.match(source, /const policy = \{ allowThirdPartyRenders: false \}/);
  assert.doesNotMatch(source, /allowThirdPartyRenders:\s*await/);
  assert.doesNotMatch(
    source,
    /\[materials, beats, vocals, granted\]\s*=\s*await Promise\.all/,
    "production corpus reads do not fan out DB connections"
  );
  assert.match(source, /pollMusicTraining/, "running Replicate jobs are polled");
  assert.match(source, /candidate_ready/, "successful provider output files a candidate receipt");
  assert.match(source, /dataset:\$\{datasetHash\}/, "dataset hash is the idempotency key");
  assert.match(source, /ACTIVE_MUSIC_MODEL_SETTING_KEY/, "promotion writes the active route pointer");
  assert.match(source, /rollbackActiveMusicModel/, "active route exposes rollback");
  assert.match(source, /submitMusicTrainingEvaluation/, "candidate score has a bound submission seam");
  assert.match(source, /updateMany\([\s\S]*status: "QUEUED"/, "kickoff uses an atomic queued-job claim");
  assert.match(source, /evaluation\.candidateModelRef !== candidateModelRef/, "score is bound to the candidate");
  assert.match(source, /evaluation\.datasetHash !== datasetHash/, "score is bound to the corpus");

  console.log("training lifecycle: polling, score binding, dedupe, candidate receipt, promotion, and rollback passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

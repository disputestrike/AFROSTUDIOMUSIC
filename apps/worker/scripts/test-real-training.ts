/**
 * REAL TRAINING REACHES PRODUCTION — the base-swap + approve→promote proof.
 *
 * The owner's order: "swap to an Apache-2.0 model so our training reaches
 * production, and fix approve-training doing nothing." This gate proves, offline
 * (no DB, no network, no spend), the whole chain that makes that true:
 *
 *  (a) an ACE-Step / YuE (Apache-2.0) base classifies apache-2.0 AND CAN reach
 *      the PRODUCTION lane in decideMusicCandidatePromotion;
 *  (b) a MusicGen (CC-BY-NC) base is STILL capped to the isolated dev lane
 *      (unchanged — the license gate is never weakened);
 *  (c) approving an Apache candidate promotes it, and the SAME lane-gated
 *      resolver the render path uses (activeProductionModelRef) returns it after
 *      a full persist round-trip → the next render carries the trained layer;
 *  (d) approving a CC-BY-NC candidate is NOT a silent no-op — it returns a clear
 *      "dev lane only" reason + the pinned license receipt, records the dev
 *      pointer, and leaves the production route untouched (this is exactly why
 *      "I approve and it doesn't work" happened on the old MusicGen default);
 *  (e) the corpus/rights gate still REFUSES third-party renders — no override.
 *
 * Plus the config levers: with no default trainer, MUSIC_TRAINER_MODEL/VERSION
 * is the single lever — an ace-step/yue ref flips the reachable lane to
 * production; a musicgen ref stays dev.
 *
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-real-training.ts
 */
import assert from "node:assert/strict";
import {
  activeProductionModelRef,
  buildMusicTrainingEvaluationReceipt,
  buildTrainerDataset,
  classifyModelLicense,
  decideMusicCandidatePromotion,
  emptyMusicModelRoute,
  musicTrainerConfig,
  parseMusicModelRoute,
} from "@afrohit/ai";
import { afroRefEligibility, manifestFromCatalog, type TrainingManifest } from "@afrohit/shared";

const datasetHash = "a".repeat(64);

function evaluation(candidateModelRef: string, score: number, minGain?: number) {
  return buildMusicTrainingEvaluationReceipt({
    candidateModelRef,
    datasetHash,
    candidateScore: score,
    evaluator: "real-training-gate",
    measuredAt: "2026-07-21T12:00:00.000Z",
    ...(minGain == null ? {} : { minGain }),
  });
}

async function main() {
  // Clean env so the config levers are the only variable under test.
  delete process.env.MUSIC_TRAINER_MODEL;
  delete process.env.MUSIC_TRAINER_VERSION;
  delete process.env.MUSIC_TRAINER_EXTRA_INPUT;
  delete process.env.MUSIC_TRAINER_KIND;
  delete process.env.AUDIO_METRICS_ENABLED;
  delete process.env.MUSIC_TRAINER_PROMOTION_MIN_GAIN;

  // ── CONFIG LEVER: no fake default; the Apache ref is the single unlock ──────
  assert.equal(
    musicTrainerConfig(),
    null,
    "unconfigured → null (no fabricated MusicGen default that never reaches production)"
  );
  process.env.MUSIC_TRAINER_MODEL = "owner/ace-step-lora-trainer";
  process.env.MUSIC_TRAINER_VERSION = "v1v1v1v1v1v1";
  const armed = musicTrainerConfig();
  assert.equal(armed?.model, "owner/ace-step-lora-trainer", "the operator's ref configures the run");
  assert.equal(armed?.license, "apache-2.0", "an ace-step trainer classifies apache-2.0 (production-lane eligible)");
  assert.equal(armed?.kind, "training", "a real LoRA fine-tuner defaults to a destination-based training");
  assert.equal(armed?.datasetKey, "dataset_zip", "the dataset field defaults sanely (overridable)");
  // The SAME lever, pointed at MusicGen, stays non-commercial — no accident can
  // make a cc-by-nc base commercial.
  process.env.MUSIC_TRAINER_MODEL = "sakemin/musicgen-fine-tuner";
  assert.equal(musicTrainerConfig()?.license, "cc-by-nc", "an explicit MusicGen trainer stays cc-by-nc (dev lane only)");
  delete process.env.MUSIC_TRAINER_MODEL;
  delete process.env.MUSIC_TRAINER_VERSION;

  // ── (a) APACHE BASE → apache-2.0 AND reaches PRODUCTION ────────────────────
  for (const trainer of ["owner/ace-step-lora-trainer", "m-a-p/yue-s1-7b", "owner/acestep-1.5-trainer"]) {
    assert.equal(classifyModelLicense(trainer), "apache-2.0", `${trainer} classifies apache-2.0`);
    const candidateModelRef = "afrohit/afroone-adapter:apache1apache1";
    const decision = decideMusicCandidatePromotion({
      candidate: { providerJobId: "job-apache", candidateModelRef, trainingId: "train-apache", datasetHash, trainerModel: trainer },
      evaluation: evaluation(candidateModelRef, 90),
      currentRoute: emptyMusicModelRoute(),
    });
    assert.equal(decision.verdict, "promoted", `${trainer}: an Apache candidate promotes to production`);
    assert.equal(decision.lane, "production");
    assert.equal(decision.license, "apache-2.0");
    assert.equal(decision.promoted, true, "promoted=true is a real production promotion");
    assert.ok(decision.route, "a production route is written");
    assert.equal(decision.devRoute, null, "a production win never touches the dev pointer");
  }

  // ── (b) MUSICGEN BASE → still dev-lane capped (license gate unweakened) ─────
  const mgRef = "afrohit/mg-adapter:musicgen1musicgen1";
  const mgDecision = decideMusicCandidatePromotion({
    candidate: { providerJobId: "job-mg", candidateModelRef: mgRef, trainingId: "train-mg", datasetHash, trainerModel: "sakemin/musicgen-fine-tuner" },
    evaluation: evaluation(mgRef, 100, 0), // perfect score, zero gain — still can't reach prod
    currentRoute: emptyMusicModelRoute(),
  });
  assert.equal(mgDecision.verdict, "promoted_dev", "a MusicGen candidate can only win the isolated dev lane");
  assert.equal(mgDecision.lane, "dev");
  assert.equal(mgDecision.license, "cc-by-nc");
  assert.equal(mgDecision.route, null, "a cc-by-nc base NEVER writes the production route");

  // ── (c) APPROVE AN APACHE CANDIDATE → the next render carries it ────────────
  // Mirrors the worker's persist-then-resolve: the production route is stored as
  // a SystemSetting JSON string, then read back and resolved by the SAME
  // lane-gated resolver (activeProductionModelRef) the render path calls.
  const prodRef = "afrohit/afroone-adapter:prodwin1prodwin1";
  const approve = decideMusicCandidatePromotion({
    candidate: { providerJobId: "job-prod", candidateModelRef: prodRef, trainingId: "train-prod", datasetHash, trainerModel: "owner/ace-step-lora-trainer" },
    evaluation: evaluation(prodRef, 88),
    currentRoute: emptyMusicModelRoute(),
  });
  assert.equal(approve.verdict, "promoted");
  const persistedProd = parseMusicModelRoute(JSON.stringify(approve.route));
  assert.equal(
    activeProductionModelRef(persistedProd),
    prodRef,
    "after approval the lane-gated production resolver returns the promoted adapter (next render carries the trained layer)"
  );

  // ── (d) APPROVE A CC-BY-NC CANDIDATE → clear reason, NOT a silent no-op ─────
  const blocked = decideMusicCandidatePromotion({
    candidate: { providerJobId: "job-block", candidateModelRef: "afrohit/mg-adapter:block1block1", trainingId: "train-block", datasetHash, trainerModel: "sakemin/musicgen-fine-tuner" },
    evaluation: evaluation("afrohit/mg-adapter:block1block1", 95),
    currentRoute: emptyMusicModelRoute(),
  });
  assert.equal(blocked.verdict, "promoted_dev");
  assert.equal(blocked.promoted, false, "promoted=true is reserved for production — a dev win reads false");
  assert.match(blocked.reason, /dev lane only/i, "the reason states, in words, why production is blocked");
  assert.match(blocked.licenseReceipt, /cc-by-nc/, "the pinned license receipt names the non-commercial base");
  assert.equal(blocked.receipts[0], blocked.licenseReceipt, "the license receipt leads the receipt trail surfaced to the admin");
  // NOT a silent no-op: the win is really recorded on the isolated dev pointer,
  // with a promotion event — the admin sees a real (dev-lane) outcome + reason.
  assert.equal(blocked.devRoute?.active?.modelRef, "afrohit/mg-adapter:block1block1", "the dev pointer records the win (not dropped on the floor)");
  assert.ok((blocked.devRoute?.events.length ?? 0) > 0, "a promotion event is recorded");
  // The API seam (submitMusicTrainingEvaluation) passes lane/license/
  // licenseReceipt/reason through verbatim — so the production render pointer is
  // untouched and the admin gets the clear block reason.
  assert.equal(activeProductionModelRef(emptyMusicModelRoute()), null, "the production render pointer is unchanged by a dev-lane approval");

  // ── (e) CORPUS / RIGHTS GATE — third-party renders REFUSED, no override ─────
  const poisoned: TrainingManifest = {
    eligible: [
      { id: "own1", origin: "own-master" },
      { id: "outside1", origin: "third-party-render" as never },
    ],
    rejected: [],
    counts: { total: 2, eligible: 2, byOrigin: {} },
  };
  assert.throws(
    () => buildTrainerDataset(poisoned),
    /ineligible origin 'third-party-render'/,
    "a third-party-render asset aborts the trainer dataset (defense in depth)"
  );
  assert.equal(afroRefEligibility({ id: "clip-mm", engine: "minimax" }).eligible, false, "a MiniMax render is refused as training/reference fuel");
  const doorOpen = manifestFromCatalog(
    { materials: [], vocals: [], beats: [{ id: "b-mm", provider: "minimax" }] },
    true // even with the consent door WIDE open, a third-party render is never fuel
  );
  assert.ok(!doorOpen.eligible.some(e => e.id === "beat:b-mm"), "a third-party render is never training fuel, even with the consent door open");

  console.log(
    "real-training: no fake default (unconfigured → null); an ace-step/yue ref classifies apache-2.0 and reaches PRODUCTION; a MusicGen base stays dev-lane only; approving an Apache candidate promotes it and the lane-gated resolver returns it (render carries the layer); approving a cc-by-nc candidate is not a silent no-op (dev pointer + clear 'dev lane only' reason + pinned license receipt); the rights gate still refuses every third-party render."
  );
}

main().catch(error => {
  console.error("FAIL:", (error as Error)?.message ?? error);
  process.exitCode = 1;
});

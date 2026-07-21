/**
 * TRAINLEGAL GATE — license-gated training lanes, measured audio metrics,
 * AfroRef reference-set law, and per-(genre|language) LoRA routes.
 *
 * Proves, offline (no DB, no network, no spend):
 *  (a) a CC-BY-NC base (MusicGen) can NEVER produce a PRODUCTION promotion —
 *      tried hard: perfect scores, zero minGain, env overrides, casing,
 *      unrecorded bases, hand-smuggled route-table entries, legacy pointers;
 *  (b) an Apache-2.0 base (ACE-Step / YuE) CAN promote to production;
 *  (c) the Frechet (FAD) math is correct on known-distance fixtures;
 *  (d) WER is correct on fixture strings (incl. diacritics + section headers);
 *  (e) the adapter route table returns the per-genre adapter with base
 *      fallback, and dev-lane adapters are invisible to production queries;
 *  (f) AfroRef ingestion REFUSES a MiniMax-stamped clip (and every other
 *      third-party engine), with no override.
 *
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-trainlegal.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afroRefEligibility } from "@afrohit/shared";
import {
  MODEL_LICENSES,
  MUSIC_DEV_MODEL_SETTING_KEY,
  audioMetricsEnabled,
  audioMetricsGate,
  buildMusicTrainingEvaluationReceipt,
  classifyModelLicense,
  computeFadClap,
  decideMusicCandidatePromotion,
  emptyMusicAdapterRouteTable,
  emptyMusicModelRoute,
  frechetDistance,
  gaussianStats,
  licenseAllowsCommercial,
  licenseGateReceipt,
  musicTrainerConfig,
  parseMusicAdapterRouteTable,
  parseMusicAudioMetricsReceipt,
  parseMusicModelRoute,
  resolveMusicAdapterRoute,
  resolveTrainedAdapterForRender,
  toneIntelligibilityScaffold,
  upsertMusicAdapterRoute,
  wordErrorRate,
} from "@afrohit/ai";
import { buildBlindPairingSheet, tallyAbWinRate, type AbSheet } from "./afroref-ab";

const datasetHash = "a".repeat(64);
const candidateRef = "afrohit/afroone-adapter:v1v1v1v1v1v1";
const EXPECTED_CCBYNC_RECEIPT =
  "LICENSE GATE: base model 'sakemin/musicgen-fine-tuner' classifies cc-by-nc (MusicGen weights are CC-BY-NC-4.0) — a fine-tuned adapter of non-commercial weights may NEVER back a commercial/production render; promotion is confined to the isolated 'dev' lane.";

function receipt(score: number, minGain?: number) {
  return buildMusicTrainingEvaluationReceipt({
    candidateModelRef: candidateRef,
    datasetHash,
    candidateScore: score,
    evaluator: "trainlegal-gate",
    measuredAt: "2026-07-20T12:00:00.000Z",
    ...(minGain == null ? {} : { minGain }),
  });
}

function candidate(trainerModel: string | null | undefined) {
  return {
    providerJobId: "job-legal",
    candidateModelRef: candidateRef,
    trainingId: "train-legal",
    datasetHash,
    ...(trainerModel === undefined ? {} : { trainerModel }),
  };
}

async function main() {
  delete process.env.AUDIO_METRICS_ENABLED;
  delete process.env.MUSIC_TRAINER_PROMOTION_MIN_GAIN;
  delete process.env.MUSIC_EVAL_MAX_WER;
  delete process.env.MUSIC_EVAL_MAX_FAD_CLAP;
  delete process.env.MUSIC_TRAINER_MODEL;
  delete process.env.MUSIC_TRAINER_VERSION;
  delete process.env.MUSIC_TRAINER_EXTRA_INPUT;
  delete process.env.MUSIC_ADAPTER_ROUTES_ENABLED;

  // ── LICENSE CLASSIFICATION (the map itself) ────────────────────────────────
  assert.equal(MODEL_LICENSES.musicgen, "cc-by-nc");
  assert.equal(MODEL_LICENSES["ace-step"], "apache-2.0");
  assert.equal(MODEL_LICENSES.yue, "apache-2.0");
  assert.equal(classifyModelLicense("sakemin/musicgen-fine-tuner"), "cc-by-nc");
  assert.equal(classifyModelLicense("META/MusicGen-Stereo-Melody"), "cc-by-nc", "classification is case-insensitive");
  assert.equal(classifyModelLicense("lucataco/ace-step"), "apache-2.0");
  assert.equal(classifyModelLicense("m-a-p/yue-s1-7b"), "apache-2.0");
  assert.equal(classifyModelLicense("somebody/mystery-model"), "unknown", "unmatched refs fail closed");
  assert.equal(licenseAllowsCommercial("sakemin/musicgen-fine-tuner"), false);
  assert.equal(licenseAllowsCommercial("lucataco/ace-step"), true);
  assert.equal(licenseAllowsCommercial(null), false, "no ref can never be commercial");
  assert.equal(licenseGateReceipt("sakemin/musicgen-fine-tuner"), EXPECTED_CCBYNC_RECEIPT, "the license-gate receipt string is pinned");

  // ── (a) CC-BY-NC BASE CAN NEVER PROMOTE TO PRODUCTION — try hard ──────────
  const attempts = [
    // perfect score, zero minGain, empty routes
    decideMusicCandidatePromotion({
      candidate: candidate("sakemin/musicgen-fine-tuner"),
      evaluation: receipt(100, 0),
      currentRoute: emptyMusicModelRoute(),
    }),
    // casing games on the base ref
    decideMusicCandidatePromotion({
      candidate: candidate("META/MusicGen-Stereo-Melody"),
      evaluation: receipt(100, 0),
      currentRoute: emptyMusicModelRoute(),
    }),
    // base unrecorded, candidate ref itself carries the musicgen fingerprint
    decideMusicCandidatePromotion({
      candidate: {
        providerJobId: "job-legal",
        candidateModelRef: "owner/musicgen-ft:abc123abc123",
        trainingId: "train-legal",
        datasetHash,
      },
      evaluation: buildMusicTrainingEvaluationReceipt({
        candidateModelRef: "owner/musicgen-ft:abc123abc123",
        datasetHash,
        candidateScore: 100,
        evaluator: "trainlegal-gate",
        minGain: 0,
      }),
      currentRoute: emptyMusicModelRoute(),
    }),
    // base entirely unrecorded and candidate ref neutral → unknown → dev
    decideMusicCandidatePromotion({
      candidate: candidate(null),
      evaluation: receipt(100, 0),
      currentRoute: emptyMusicModelRoute(),
    }),
  ];
  // env lever cannot help either
  process.env.MUSIC_TRAINER_PROMOTION_MIN_GAIN = "0";
  attempts.push(
    decideMusicCandidatePromotion({
      candidate: candidate("sakemin/musicgen-fine-tuner"),
      evaluation: receipt(100),
      currentRoute: emptyMusicModelRoute(),
    })
  );
  delete process.env.MUSIC_TRAINER_PROMOTION_MIN_GAIN;
  for (const attempt of attempts) {
    assert.equal(attempt.route, null, "a non-commercial/unknown base NEVER returns a production route");
    assert.notEqual(attempt.verdict, "promoted", "verdict can never read as a production promotion");
    assert.equal(attempt.lane, "dev");
  }
  const devWin = attempts[0]!;
  assert.equal(devWin.verdict, "promoted_dev", "a winning cc-by-nc candidate lands in the ISOLATED dev lane");
  assert.equal(devWin.devRoute?.active?.modelRef, candidateRef, "the dev pointer carries the win");
  assert.equal(devWin.devRoute?.active?.lane, "dev");
  assert.equal(devWin.license, "cc-by-nc");
  assert.equal(devWin.licenseReceipt, EXPECTED_CCBYNC_RECEIPT, "the block explains itself with the pinned receipt");
  assert.equal(devWin.receipts[0], EXPECTED_CCBYNC_RECEIPT, "the license receipt leads the receipt trail");
  assert.equal(devWin.promoted, false, "promoted=true is reserved for PRODUCTION promotions");

  // even with a production incumbent in place, the musicgen candidate competes
  // in the dev lane and the production pointer stays untouched
  const productionIncumbent = decideMusicCandidatePromotion({
    candidate: {
      providerJobId: "job-prod",
      candidateModelRef: "afrohit/prod-adapter:p1p1p1p1p1p1",
      trainingId: "train-prod",
      datasetHash,
      trainerModel: "lucataco/ace-step",
    },
    evaluation: buildMusicTrainingEvaluationReceipt({
      candidateModelRef: "afrohit/prod-adapter:p1p1p1p1p1p1",
      datasetHash,
      candidateScore: 50,
      evaluator: "trainlegal-gate",
    }),
    currentRoute: emptyMusicModelRoute(),
  }).route!;
  const devVsProd = decideMusicCandidatePromotion({
    candidate: candidate("sakemin/musicgen-fine-tuner"),
    evaluation: receipt(100, 0),
    currentRoute: productionIncumbent,
  });
  assert.equal(devVsProd.verdict, "promoted_dev");
  assert.equal(devVsProd.route, null, "the production incumbent survives a dev-lane win untouched");

  // legacy pointers (promoted before lanes existed) parse fail-closed to dev
  const legacyRoute = parseMusicModelRoute(JSON.stringify({
    schemaVersion: 1,
    active: {
      modelRef: "disputestrike/afrohit-music:legacy1legacy1",
      providerJobId: "job-old",
      trainingId: "train-old",
      datasetHash,
      score: 80,
      evaluatedAt: "2026-07-19T00:00:00.000Z",
      activatedAt: "2026-07-19T00:00:00.000Z",
    },
    previous: null,
    events: [],
    updatedAt: "2026-07-19T00:00:00.000Z",
  }));
  assert.equal(legacyRoute.active?.lane, "dev", "a legacy active entry (no lane) parses fail-closed to dev");
  assert.equal(legacyRoute.active?.license, "unknown");

  // route-table smuggling: a hand-written 'production' entry with a musicgen
  // base is coerced to dev at write AND at parse
  const smuggledTable = upsertMusicAdapterRoute({
    table: emptyMusicAdapterRouteTable(),
    key: "genre:amapiano",
    modelRef: "afrohit/mg-adapter:s1s1s1s1s1s1",
    trainedFrom: "sakemin/musicgen-fine-tuner",
    lane: "production",
  });
  assert.equal(smuggledTable.adapters["genre:amapiano"]?.lane, "dev", "upsert coerces a cc-by-nc entry out of production");
  const handEdited = parseMusicAdapterRouteTable(JSON.stringify({
    schemaVersion: 1,
    adapters: {
      "genre:amapiano": {
        modelRef: "afrohit/mg-adapter:s1s1s1s1s1s1",
        license: "cc-by-nc",
        lane: "production",
        activatedAt: "2026-07-20T00:00:00.000Z",
      },
    },
    updatedAt: "2026-07-20T00:00:00.000Z",
  }));
  assert.equal(handEdited.adapters["genre:amapiano"]?.lane, "dev", "a hand-edited SystemSetting row cannot smuggle cc-by-nc into production");
  const smuggleResolved = resolveMusicAdapterRoute(handEdited, { genre: "amapiano", lane: "production", baseModelRef: null });
  assert.equal(smuggleResolved.modelRef, null, "a production render never receives the smuggled adapter");

  // ── (b) APACHE BASE CAN PROMOTE TO PRODUCTION ──────────────────────────────
  for (const trainer of ["acme/ace-step-fine-tuner", "m-a-p/yue-s1-7b"]) {
    const win = decideMusicCandidatePromotion({
      candidate: candidate(trainer),
      evaluation: receipt(90),
      currentRoute: emptyMusicModelRoute(),
    });
    assert.equal(win.verdict, "promoted", `${trainer}: commercial base promotes to production`);
    assert.equal(win.lane, "production");
    assert.equal(win.license, "apache-2.0");
    assert.equal(win.route?.active?.modelRef, candidateRef);
    assert.equal(win.route?.active?.lane, "production");
    assert.equal(win.devRoute, null, "a production win never writes the dev pointer");
  }

  // ── (c) FAD MATH on known-distance fixtures ────────────────────────────────
  const diag = (values: number[]) =>
    values.map((value, i) => values.map((_, j) => (i === j ? value : 0)));
  // identical Gaussians → 0
  assert.ok(
    frechetDistance(
      { mean: [1, 2], cov: [[2, 1], [1, 2]] },
      { mean: [1, 2], cov: [[2, 1], [1, 2]] }
    ) < 1e-9,
    "identical distributions have FAD 0"
  );
  // pure mean shift with identity covariance → squared distance (3^2 = 9)
  const meanShift = frechetDistance(
    { mean: [0, 0], cov: diag([1, 1]) },
    { mean: [3, 0], cov: diag([1, 1]) }
  );
  assert.ok(Math.abs(meanShift - 9) < 1e-9, `mean-shift fixture: expected 9, got ${meanShift}`);
  // diagonal covariance mismatch: sum_i (v1 + v2 - 2*sqrt(v1*v2)) = 1 + 4 = 5
  const covMismatch = frechetDistance(
    { mean: [0, 0], cov: diag([4, 9]) },
    { mean: [0, 0], cov: diag([1, 1]) }
  );
  assert.ok(Math.abs(covMismatch - 5) < 1e-9, `covariance fixture: expected 5, got ${covMismatch}`);
  // combined: mean term 2^2=4 + trace term (4+1-2*2)=1 → 5
  const combined = frechetDistance(
    { mean: [2, 0], cov: diag([4, 1]) },
    { mean: [0, 0], cov: diag([1, 1]) }
  );
  assert.ok(Math.abs(combined - 5) < 1e-9, `combined fixture: expected 5, got ${combined}`);
  // sample stats: n-1 covariance, exact with shrinkage/ridge disabled
  const stats = gaussianStats([[0, 0], [2, 0]], { shrinkage: 0, ridge: 0 });
  assert.deepEqual(stats.mean, [1, 0]);
  assert.equal(stats.cov[0]![0], 2, "sample covariance uses the n-1 denominator");
  assert.equal(stats.cov[1]![1], 0);
  // small-set safety: default shrinkage keeps tiny sets finite and >= 0
  const tinyA = gaussianStats([[0, 1, 0], [0.1, 0.9, 0.02]]);
  const tinyB = gaussianStats([[0.05, 0.95, 0.01], [0, 1.05, 0]]);
  const tinyFad = frechetDistance(tinyA, tinyB);
  assert.ok(Number.isFinite(tinyFad) && tinyFad >= 0, "two-clip sets stay finite and non-negative under shrinkage");
  // identical embedding SETS through the full sample pipeline → ~0
  const sameSet = [[0.1, 0.2, 0.3], [0.4, 0.1, 0.0], [0.2, 0.2, 0.2]];
  assert.ok(frechetDistance(gaussianStats(sameSet), gaussianStats(sameSet)) < 1e-9, "identical clip sets measure ~0");

  // ── (d) WER on fixture strings ─────────────────────────────────────────────
  assert.equal(wordErrorRate("shine your eye no dey carry last", "shine your eye no dey carry last").wer, 0);
  const substitution = wordErrorRate("shine your eye no dey carry last", "shine your eye no dey carry first");
  assert.ok(Math.abs(substitution.wer - 1 / 7) < 1e-9, "one substitution over seven words = 1/7");
  assert.equal(substitution.distance, 1);
  const deletion = wordErrorRate("shine your eye no dey carry last", "shine your eye no dey carry");
  assert.ok(Math.abs(deletion.wer - 1 / 7) < 1e-9, "one deletion = 1/7");
  const insertion = wordErrorRate("shine your eye no dey carry last", "shine your eye no dey carry last oo");
  assert.ok(Math.abs(insertion.wer - 1 / 7) < 1e-9, "one insertion = 1/7");
  assert.equal(wordErrorRate("Ọmọ́ mi dára jù", "omo mi dara ju").wer, 0, "Yoruba tone marks normalize before scoring");
  assert.equal(wordErrorRate("[Chorus]\nomo mi dara ju", "omo mi dara ju").wer, 0, "section headers are instructions, not words");
  assert.equal(wordErrorRate("omo mi", "").wer, 1, "silence against a real lyric is total error");
  // tone scaffold: honest — base match only, tones never claimed verified
  const tone = toneIntelligibilityScaffold({
    transcript: "omo mi dara",
    expectedSyllables: [{ syllable: "ọmọ́" }, { syllable: "mi" }, { syllable: "dára" }, { syllable: "jù" }],
  });
  assert.equal(tone.matchedBase, 3);
  assert.equal(tone.toneVerified, false, "ASR text can never verify tone realization");
  assert.match(tone.note, /native-speaker/);

  // ── AUDIO METRICS: spend gate + threshold referee + measured promotion ────
  assert.equal(audioMetricsEnabled(), false, "audio metrics ship OFF");
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const gatedOff = await computeFadClap(["u1", "u2"], ["r1", "r2"]);
    assert.equal(gatedOff.available, false);
    assert.match(gatedOff.reason ?? "", /AUDIO_METRICS_ENABLED/);
    assert.equal(fetchCalls, 0, "gate off spends NOTHING — not even a lookup");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(audioMetricsGate({ lyricWer: 0.8 }).block, true, "WER above the gate blocks");
  assert.equal(audioMetricsGate({ lyricWer: 0.2 }).block, false);
  assert.equal(audioMetricsGate({ fadClap: 5 }).block, false, "FAD is advisory until the operator calibrates a cutoff");
  process.env.MUSIC_EVAL_MAX_FAD_CLAP = "1";
  assert.equal(audioMetricsGate({ fadClap: 5 }).block, true, "a configured FAD cutoff enforces");
  delete process.env.MUSIC_EVAL_MAX_FAD_CLAP;

  const audioReceipt = {
    candidateModelRef: candidateRef,
    datasetHash,
    fadClap: 0.3,
    lyricWer: 0.9,
    measuredAt: "2026-07-20T12:00:00.000Z",
    receipts: ["[audio-metrics] replicate test ~$0.0100"],
  };
  assert.ok(parseMusicAudioMetricsReceipt(JSON.stringify(audioReceipt)), "a bound audio receipt parses");
  assert.equal(
    parseMusicAudioMetricsReceipt(JSON.stringify({ ...audioReceipt, datasetHash: "zz" })),
    null,
    "a malformed hash fails the strict parser closed"
  );
  // gate OFF: metrics receipt present but text-only path decides, unchanged
  const textOnly = decideMusicCandidatePromotion({
    candidate: candidate("acme/ace-step-fine-tuner"),
    evaluation: receipt(90),
    currentRoute: emptyMusicModelRoute(),
    audioMetrics: parseMusicAudioMetricsReceipt(JSON.stringify(audioReceipt)),
  });
  assert.equal(textOnly.verdict, "promoted", "AUDIO_METRICS_ENABLED off => text-only path unchanged");
  assert.ok(!textOnly.receipts.some(line => /WER|FAD/i.test(line)), "no audio lines when the gate is off");
  // gate ON: a failing WER REJECTS even a commercial-base, high-scoring candidate
  process.env.AUDIO_METRICS_ENABLED = "1";
  const measuredBlock = decideMusicCandidatePromotion({
    candidate: candidate("acme/ace-step-fine-tuner"),
    evaluation: receipt(90),
    currentRoute: emptyMusicModelRoute(),
    audioMetrics: parseMusicAudioMetricsReceipt(JSON.stringify(audioReceipt)),
  });
  assert.equal(measuredBlock.verdict, "rejected", "measured WER above the gate blocks promotion in every lane");
  assert.match(measuredBlock.reason, /WER/);
  assert.ok(measuredBlock.receipts.some(line => /lyric WER/.test(line)), "the audio verdict carries receipts");
  // gate ON with passing metrics: promoted, with measured receipts attached
  const measuredPass = decideMusicCandidatePromotion({
    candidate: candidate("acme/ace-step-fine-tuner"),
    evaluation: receipt(90),
    currentRoute: emptyMusicModelRoute(),
    audioMetrics: parseMusicAudioMetricsReceipt(JSON.stringify({ ...audioReceipt, lyricWer: 0.1 })),
  });
  assert.equal(measuredPass.verdict, "promoted");
  assert.ok(measuredPass.receipts.some(line => /measured lyric WER 0\.100/.test(line)));
  // an UNBOUND receipt is ignored fail-soft, never borrowed
  const unbound = decideMusicCandidatePromotion({
    candidate: candidate("acme/ace-step-fine-tuner"),
    evaluation: receipt(90),
    currentRoute: emptyMusicModelRoute(),
    audioMetrics: parseMusicAudioMetricsReceipt(
      JSON.stringify({ ...audioReceipt, datasetHash: "b".repeat(64) })
    ),
  });
  assert.equal(unbound.verdict, "promoted", "an unbound audio receipt cannot block a different candidate");
  assert.ok(unbound.receipts.some(line => /ignored/.test(line)), "the ignore is disclosed");
  delete process.env.AUDIO_METRICS_ENABLED;

  // ── (e) ROUTE TABLE: per-genre adapter with base fallback ──────────────────
  let table = emptyMusicAdapterRouteTable();
  table = upsertMusicAdapterRoute({
    table,
    key: "genre:amapiano",
    modelRef: "afrohit/amapiano-adapter:g1g1g1g1g1g1",
    trainedFrom: "acme/ace-step-fine-tuner",
  });
  table = upsertMusicAdapterRoute({
    table,
    key: "language:yo",
    modelRef: "afrohit/yoruba-adapter:l1l1l1l1l1l1",
    trainedFrom: "m-a-p/yue-s1-7b",
  });
  table = upsertMusicAdapterRoute({
    table,
    key: "genre:gqom",
    modelRef: "afrohit/gqom-dev:d1d1d1d1d1d1",
    trainedFrom: "sakemin/musicgen-fine-tuner", // cc-by-nc → dev lane
  });
  const genreHit = resolveMusicAdapterRoute(table, { genre: "amapiano", lane: "production", baseModelRef: "afrohit/base:b1b1b1b1b1b1" });
  assert.equal(genreHit.modelRef, "afrohit/amapiano-adapter:g1g1g1g1g1g1", "the genre slice routes to its adapter");
  assert.equal(genreHit.source, "genre");
  const languageHit = resolveMusicAdapterRoute(table, { genre: "afrobeats", language: "yo", lane: "production", baseModelRef: "afrohit/base:b1b1b1b1b1b1" });
  assert.equal(languageHit.modelRef, "afrohit/yoruba-adapter:l1l1l1l1l1l1", "no genre adapter → the language slice");
  assert.equal(languageHit.source, "language");
  const baseFallback = resolveMusicAdapterRoute(table, { genre: "highlife", lane: "production", baseModelRef: "afrohit/base:b1b1b1b1b1b1" });
  assert.equal(baseFallback.modelRef, "afrohit/base:b1b1b1b1b1b1", "unmatched slice falls back to the base");
  assert.equal(baseFallback.source, "base");
  const nothing = resolveMusicAdapterRoute(table, { genre: "highlife", lane: "production" });
  assert.equal(nothing.modelRef, null);
  assert.equal(nothing.source, "none");
  // the dev-lane gqom adapter is INVISIBLE to production, visible to dev
  const gqomProd = resolveMusicAdapterRoute(table, { genre: "gqom", lane: "production", baseModelRef: "afrohit/base:b1b1b1b1b1b1" });
  assert.equal(gqomProd.modelRef, "afrohit/base:b1b1b1b1b1b1", "a dev-lane adapter never backs a production render");
  const gqomDev = resolveMusicAdapterRoute(table, { genre: "gqom", lane: "dev" });
  assert.equal(gqomDev.modelRef, "afrohit/gqom-dev:d1d1d1d1d1d1", "the dev lane can experiment with it");
  // the providers/music render-routing seam round-trips the raw setting value
  const rendered = resolveTrainedAdapterForRender({
    routeTableRaw: JSON.stringify(table),
    genre: "amapiano",
    baseModelRef: "afrohit/base:b1b1b1b1b1b1",
  });
  assert.equal(rendered.modelRef, "afrohit/amapiano-adapter:g1g1g1g1g1g1", "providers/music routes renders through the same law");

  // ── trainer default: stereo-melody, cc-by-nc classified ────────────────────
  const config = musicTrainerConfig();
  assert.equal(config?.extraInput.model_version, "stereo-melody", "default fine-tune is 32kHz stereo, melody-conditioned");
  assert.equal(config?.license, "cc-by-nc", "the default trainer carries its non-commercial classification");

  // ── (f) AFROREF INGESTION LAW ──────────────────────────────────────────────
  const minimax = afroRefEligibility({ id: "clip-mm", engine: "minimax" });
  assert.equal(minimax.eligible, false, "a MiniMax-stamped clip is REFUSED from AfroRef");
  assert.equal(minimax.origin, "third-party-render");
  assert.match(minimax.reason ?? "", /NEVER admitted/, "the refusal states there is no override");
  for (const engine of ["suno", "eleven", "ace_step", "musicgen"]) {
    assert.equal(afroRefEligibility({ id: `clip-${engine}`, engine }).eligible, false, `${engine} render refused`);
  }
  const ownRender = afroRefEligibility({ id: "clip-own", engine: "own_engine" });
  assert.equal(ownRender.eligible, true, "an own-engine render anchors the reference set");
  assert.equal(ownRender.origin, "own-master");
  const consented = afroRefEligibility({
    id: "clip-user",
    performanceSource: "artist_upload",
    consentGranted: true,
  });
  assert.equal(consented.eligible, true, "a consented user-original upload is admitted");
  assert.equal(
    afroRefEligibility({ id: "clip-user2", performanceSource: "artist_upload" }).eligible,
    false,
    "no consent, no admission"
  );
  assert.equal(
    afroRefEligibility({ id: "clip-lic", rightsBasis: "licensed" }).eligible,
    false,
    "licensed catalog stays training fuel, not the measuring stick"
  );
  assert.equal(afroRefEligibility({ id: "clip-unknown" }).eligible, false, "unknown provenance fails closed");

  // ── A/B HARNESS: blinded sheet + tally ─────────────────────────────────────
  const candidates = [
    { id: "cand-1", url: "https://x/c1.wav" },
    { id: "cand-2", url: "https://x/c2.wav" },
    { id: "cand-3", url: "https://x/c3.wav" },
  ];
  const references = [
    { id: "ref-1", url: "https://x/r1.wav" },
    { id: "ref-2", url: "https://x/r2.wav" },
    { id: "ref-3", url: "https://x/r3.wav" },
  ];
  const { sheet, key } = buildBlindPairingSheet(candidates, references, "gate-seed");
  assert.equal(sheet.pairs.length, 3);
  const sheetJson = JSON.stringify(sheet);
  for (const clip of [...candidates, ...references]) {
    assert.ok(!sheetJson.includes(clip.id), `the judge's sheet is BLINDED — it never carries id ${clip.id}`);
  }
  for (const pair of sheet.pairs) {
    const entry = key[pair.pairId]!;
    assert.ok(entry, "every pair unblinds through the key");
    const candidateUrl = entry.candidate === "A" ? pair.a.url : pair.b.url;
    assert.ok(candidates.some(clip => clip.url === candidateUrl), "the key points at the true candidate side");
  }
  const repeat = buildBlindPairingSheet(candidates, references, "gate-seed");
  assert.deepEqual(
    repeat.sheet.pairs.map(pair => ({ ...pair })),
    sheet.pairs.map(pair => ({ ...pair })),
    "same seed → same sheet (reproducible)"
  );
  // fill: candidate wins 2, reference wins 1 → 2/3
  const filled: AbSheet = {
    ...sheet,
    pairs: sheet.pairs.map((pair, index) => ({
      ...pair,
      winner:
        index < 2
          ? key[pair.pairId]!.candidate
          : key[pair.pairId]!.candidate === "A"
            ? ("B" as const)
            : ("A" as const),
    })),
  };
  const tally = tallyAbWinRate(filled, key);
  assert.equal(tally.candidateWins, 2);
  assert.equal(tally.referenceWins, 1);
  assert.ok(Math.abs((tally.winRate ?? 0) - 2 / 3) < 1e-3, "win-rate tallies from the unblinding key");
  const unjudged = tallyAbWinRate(sheet, key);
  assert.equal(unjudged.judged, 0);
  assert.equal(unjudged.winRate, null, "no verdicts → no fabricated win-rate");

  // ── WIRING (the law is actually read by worker + api + render path) ───────
  const root = join(__dirname, "..", "..", "..");
  const flywheel = readFileSync(join(root, "apps/worker/src/lib/training-flywheel.ts"), "utf8");
  assert.ok(flywheel.includes("MUSIC_DEV_MODEL_SETTING_KEY"), "flywheel persists dev-lane promotions separately");
  assert.ok(flywheel.includes('"promoted_dev"'), "flywheel stamps the dev phase");
  assert.ok(flywheel.includes("parseMusicAudioMetricsReceipt"), "flywheel feeds bound audio receipts into the gate");
  assert.ok(flywheel.includes('active.lane === "production"'), "production render pointer is lane-enforced");
  assert.ok(flywheel.includes("resolveTrainedAdapterRefForRender"), "per-genre adapter resolver exists in the worker");
  assert.ok(flywheel.includes('process.env.MUSIC_ADAPTER_ROUTES_ENABLED !== "1"'), "adapter routes are flag-gated OFF");
  const ownEngine = readFileSync(join(root, "apps/worker/src/processors/own-engine.ts"), "utf8");
  assert.ok(/resolveTrainedAdapterRefForRender\(\{\s*genre: p\.genre,/m.test(ownEngine), "the render path routes by genre with base fallback");
  const apiSeam = readFileSync(join(root, "apps/api/src/lib/training-evaluation.ts"), "utf8");
  assert.ok(apiSeam.includes("MUSIC_TRAINING_PROMOTED_DEV_PHASE"), "API seam files dev-lane promotions");
  assert.ok(apiSeam.includes("MUSIC_DEV_MODEL_SETTING_KEY"), "API seam writes the same dev pointer");
  assert.equal(MUSIC_DEV_MODEL_SETTING_KEY, "music.training.devModel.v1", "dev pointer key pinned");

  console.log(
    "trainlegal: cc-by-nc bases can never reach production (dev lane only, pinned receipt); apache bases can; FAD + WER math verified on fixtures; audio metrics spend-gated OFF and referee promotion when armed; per-genre adapter routes with base fallback and license coercion; AfroRef refuses every third-party engine; blind A/B sheet + tally verified."
  );
}

main().catch(error => {
  console.error("FAIL:", error?.message ?? error);
  process.exitCode = 1;
});

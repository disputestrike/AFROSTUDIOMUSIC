/**
 * LIKENESS LAWS — the consent doctrine as failing tests:
 *   - consent gate: NO consent (or a revoked one) = training refuses,
 *   - photo-count gate: fewer than 10 photos = training refuses,
 *   - operator flag + provider key gates,
 *   - status transitions: only the legal pending/training/trained/failed
 *     moves exist, and "trained" is IMPOSSIBLE without a model artifact,
 *   - the exact Replicate trainings-API JSON (payload drift = a failing test,
 *     not a burned $2-5 GPU run),
 *   - keyframe request body + trained-model-ref extraction honesty.
 */
import assert from "node:assert/strict";
import {
  LIKENESS_CONSENT_TEXT,
  LIKENESS_CONSENT_VERSION,
  LIKENESS_RIGHTS_BASIS,
  MIN_LIKENESS_TRAINING_PHOTOS,
  likenessTrainingGate,
  nextLikenessStatus,
} from "@afrohit/shared";
import {
  likenessKeyframeRequest,
  likenessTrainerConfig,
  likenessTrainingRequest,
  trainedModelRefFromOutput,
} from "@afrohit/ai";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}\n  ${(error as Error).message}`);
    failures += 1;
  }
}

const allGreen = {
  trainingEnabled: true,
  photoCount: MIN_LIKENESS_TRAINING_PHOTOS,
  consentRecorded: true,
  consentRevoked: false,
  replicateConfigured: true,
};

check("all gates green → training allowed, zero reasons", () => {
  const gate = likenessTrainingGate(allGreen);
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.reasons, []);
});

check("CONSENT GATE: no consent = training refuses, says why", () => {
  const gate = likenessTrainingGate({ ...allGreen, consentRecorded: false });
  assert.equal(gate.ok, false);
  assert.ok(gate.reasons.some(r => /consent/i.test(r)));
});

check("CONSENT GATE: revoked consent = training refuses", () => {
  const gate = likenessTrainingGate({ ...allGreen, consentRevoked: true });
  assert.equal(gate.ok, false);
  assert.ok(gate.reasons.some(r => /revoked/i.test(r)));
});

check(`PHOTO-COUNT GATE: ${MIN_LIKENESS_TRAINING_PHOTOS - 1} photos = refuses with the count`, () => {
  const gate = likenessTrainingGate({
    ...allGreen,
    photoCount: MIN_LIKENESS_TRAINING_PHOTOS - 1,
  });
  assert.equal(gate.ok, false);
  assert.ok(
    gate.reasons.some(r =>
      r.includes(`at least ${MIN_LIKENESS_TRAINING_PHOTOS} photos`)
    )
  );
});

check("OPERATOR FLAG: LIKENESS_TRAINING_ENABLED off = refuses honestly", () => {
  const gate = likenessTrainingGate({ ...allGreen, trainingEnabled: false });
  assert.equal(gate.ok, false);
  assert.ok(gate.reasons.some(r => r.includes("LIKENESS_TRAINING_ENABLED")));
});

check("PROVIDER KEY: no key = refuses (never a stub run)", () => {
  const gate = likenessTrainingGate({ ...allGreen, replicateConfigured: false });
  assert.equal(gate.ok, false);
  assert.ok(gate.reasons.some(r => /key/i.test(r)));
});

check("gates COMPOUND: everything wrong = every reason listed", () => {
  const gate = likenessTrainingGate({
    trainingEnabled: false,
    photoCount: 0,
    consentRecorded: false,
    consentRevoked: false,
    replicateConfigured: false,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reasons.length, 4);
});

// ---- Status transitions ----------------------------------------------------

check("pending → training on start", () => {
  assert.equal(
    nextLikenessStatus("pending", { type: "training_started" }),
    "training"
  );
});

check("trained/failed → training (retrain + retry are legal)", () => {
  assert.equal(
    nextLikenessStatus("trained", { type: "training_started" }),
    "training"
  );
  assert.equal(
    nextLikenessStatus("failed", { type: "training_started" }),
    "training"
  );
});

check("training → trained REQUIRES a model artifact", () => {
  assert.equal(
    nextLikenessStatus("training", {
      type: "training_succeeded",
      trainedModelRef: "owner/model:abc12345",
    }),
    "trained"
  );
  assert.equal(
    nextLikenessStatus("training", {
      type: "training_succeeded",
      trainedModelRef: "   ",
    }),
    null
  );
});

check("training → failed carries through; illegal moves are null", () => {
  assert.equal(
    nextLikenessStatus("training", { type: "training_failed", reason: "boom" }),
    "failed"
  );
  // pending can't skip to trained; trained can't fail without a run; training can't restart.
  assert.equal(
    nextLikenessStatus("pending", {
      type: "training_succeeded",
      trainedModelRef: "owner/model:abc12345",
    }),
    null
  );
  assert.equal(
    nextLikenessStatus("trained", { type: "training_failed", reason: "x" }),
    null
  );
  assert.equal(nextLikenessStatus("training", { type: "training_started" }), null);
});

// ---- Consent record shape ---------------------------------------------------

check("consent text is versioned, own-face framed, and revocable", () => {
  assert.ok(LIKENESS_CONSENT_VERSION.length > 0);
  assert.ok(/I am the person shown/i.test(LIKENESS_CONSENT_TEXT));
  assert.ok(/revoke/i.test(LIKENESS_CONSENT_TEXT));
  assert.ok(/not upload images of any other person/i.test(LIKENESS_CONSENT_TEXT));
  assert.equal(LIKENESS_RIGHTS_BASIS, "user-attested-likeness");
});

// ---- Exact trainings-API JSON ------------------------------------------------

check("trainings request is the EXACT documented shape", () => {
  const request = likenessTrainingRequest({
    model: "replicate/fast-flux-trainer",
    version: "versionhash1234",
    destination: "afrohit/afrohit-likeness-bxp",
    inputImagesUrl: "https://storage.example/likeness.zip?sig=1",
    triggerWord: "BXP",
  });
  assert.equal(
    request.url,
    "https://api.replicate.com/v1/models/replicate/fast-flux-trainer/versions/versionhash1234/trainings"
  );
  assert.deepEqual(request.body, {
    destination: "afrohit/afrohit-likeness-bxp",
    input: {
      input_images: "https://storage.example/likeness.zip?sig=1",
      trigger_word: "BXP",
      lora_type: "subject",
    },
  });
});

check("trainer config defaults to fast-flux-trainer, env overrides win", () => {
  assert.deepEqual(likenessTrainerConfig({}), {
    model: "replicate/fast-flux-trainer",
    version: undefined,
  });
  assert.deepEqual(
    likenessTrainerConfig({
      LIKENESS_TRAINER_MODEL: "ostris/flux-dev-lora-trainer",
      LIKENESS_TRAINER_VERSION: "pinnedhash",
    }),
    { model: "ostris/flux-dev-lora-trainer", version: "pinnedhash" }
  );
});

// ---- Trained-artifact honesty -------------------------------------------------

check("trainedModelRefFromOutput accepts version refs and weights URLs ONLY", () => {
  assert.equal(
    trainedModelRefFromOutput({ version: "afrohit/likeness-bxp:abcdef123456" }),
    "afrohit/likeness-bxp:abcdef123456"
  );
  assert.equal(
    trainedModelRefFromOutput({ weights: "https://replicate.delivery/w.tar" }),
    "https://replicate.delivery/w.tar"
  );
  // A "succeeded" run with no artifact must NOT become a trained likeness.
  assert.equal(trainedModelRefFromOutput({}), null);
  assert.equal(trainedModelRefFromOutput(null), null);
  assert.equal(trainedModelRefFromOutput({ version: "not-a-ref" }), null);
  assert.equal(trainedModelRefFromOutput({ weights: "file:///etc/passwd" }), null);
});

// ---- Keyframe request ----------------------------------------------------------

check("keyframe request runs the TRAINED version, trigger word leads", () => {
  const request = likenessKeyframeRequest({
    trainedModelRef: "afrohit/likeness-bxp:abcdef123456",
    prompt: "on a neon Lagos rooftop at dusk",
    triggerWord: "BXP",
    aspectRatio: "9:16",
  });
  assert.ok(request);
  assert.equal(request!.version, "abcdef123456");
  assert.deepEqual(request!.body, {
    prompt: "BXP, on a neon Lagos rooftop at dusk",
    aspect_ratio: "9:16",
    num_outputs: 1,
    output_format: "png",
    go_fast: true,
  });
});

check("keyframe refuses a weights-URL ref (not runnable as a version)", () => {
  assert.equal(
    likenessKeyframeRequest({
      trainedModelRef: "https://replicate.delivery/w.tar",
      prompt: "x",
      triggerWord: "BXP",
      aspectRatio: "1:1",
    }),
    null
  );
});

if (failures) {
  process.exitCode = 1;
} else {
  console.log("Likeness laws passed.");
}

/**
 * TRAINED LAYER GATE — owner order 2026-07-20 ("where is all the training? we
 * trained — where is it?"), enforced forever.
 *
 * Promotion writes music.training.activeModel.v1; before this wave NOTHING read
 * it — training was invisible in the sound by construction. This gate proves:
 * (1) the pure decision — a promoted ref with the flag not '0' attempts the
 * layer (default ON), no ref or flag '0' skips with an honest reason;
 * (2) the adapter — a mocked Replicate run is requested against the PROMOTED
 * version with genre/bpm conditioning, returns audio + the honest cost, and
 * every failure path returns a "trained layer skipped:" note, never a throw;
 * (3) the rights law — a 'lora'-stamped topping (our trained model's output)
 * classifies OWN-ORIGIN trainable fuel, stock 'musicgen' stays third-party,
 * and an own topping can never LAUNDER a dirty bed (most restrictive wins);
 * (4) the wiring — processOwnEngine gates on pointer+flag, reuses the grid
 * honesty gate, mixes at a modest under-the-bed gain via the fill overlay,
 * stamps engine 'lora', files {trainedModelRef, layerRole, estimatedCostUsd}
 * receipts on the beat meta AND the job output, records the job cost, and
 * supersedes the stock musicgen topping (ONE topping per take). Pointer absent
 * => the only action is an honest note; the path is identical to today.
 *
 * No DB, no network. Run:
 *   pnpm --filter @afrohit/worker exec tsx scripts/test-trained-layer.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  manifestFromCatalog,
  beatToProvenance,
  trainingEligibility,
  isOwnEngineId,
} from "@afrohit/shared";
import {
  renderTrainedMusicLayer,
  trainedLayerDecision,
  trainedModelVersion,
  TRAINED_MUSIC_LAYER_COST_USD,
} from "@afrohit/ai";

const PROMOTED_REF =
  "disputestrike/afrohit-music:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

async function main() {
  // ── 1) PURE DECISION: default ON when a ref exists; '0' kills; no ref skips ─
  const on = trainedLayerDecision({ modelRef: PROMOTED_REF, flag: null });
  assert.equal(on.attempt, true, "promoted ref + flag unset => attempt (default ON)");
  const explicit = trainedLayerDecision({ modelRef: PROMOTED_REF, flag: "1" });
  assert.equal(explicit.attempt, true, "flag '1' attempts");
  const off = trainedLayerDecision({ modelRef: PROMOTED_REF, flag: "0" });
  assert.equal(off.attempt, false, "flag '0' is the kill switch");
  assert.ok(/OWN_ENGINE_TRAINED_LAYER=0/.test(off.reason), "kill switch names itself");
  const noRef = trainedLayerDecision({ modelRef: null, flag: null });
  assert.equal(noRef.attempt, false, "no promoted ref => no attempt (path identical to today)");
  assert.ok(/no promoted music model/.test(noRef.reason), "no-ref reason is honest");

  // Ref parsing: only a runnable owner/name:version yields a version hash.
  assert.equal(
    trainedModelVersion(PROMOTED_REF),
    PROMOTED_REF.split(":")[1],
    "promoted ref parses to its version hash"
  );
  assert.equal(trainedModelVersion("https://weights.example/model.tar"), null, "a weights URL is not runnable via /predictions");
  assert.equal(trainedModelVersion("garbage"), null, "garbage ref refused");
  assert.equal(trainedModelVersion(null), null, "null ref refused");

  // ── 2) ADAPTER: mocked Replicate (same pattern as the music-provider tests) ─
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.REPLICATE_API_TOKEN;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  try {
    process.env.REPLICATE_API_TOKEN = "r8_test_token";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({
        id: "pred_1",
        status: "succeeded",
        output: "https://replicate.delivery/out/topping.wav",
      });
    }) as typeof fetch;

    const okRender = await renderTrainedMusicLayer({
      modelRef: PROMOTED_REF,
      prompt: "warm log-drum melody, amapiano melodic topping over a locked groove, 112 BPM, in A minor",
      durationS: 180,
    });
    assert.equal(calls.length, 1, "one prediction request");
    assert.ok(
      calls[0]!.url.endsWith("/v1/predictions"),
      "layer requested via the predictions endpoint"
    );
    const body = JSON.parse(String(calls[0]!.init?.body)) as {
      version?: string;
      input?: { prompt?: string; duration?: number };
    };
    assert.equal(
      body.version,
      trainedModelVersion(PROMOTED_REF),
      "the PROMOTED version renders the layer — not stock musicgen"
    );
    assert.ok(
      /amapiano/.test(body.input?.prompt ?? "") && /112 BPM/.test(body.input?.prompt ?? ""),
      "prompt carries the render's genre/bpm conditioning"
    );
    assert.equal(body.input?.duration, 30, "duration clamps to the 30s conditioning window");
    assert.equal(okRender.url, "https://replicate.delivery/out/topping.wav", "audio URL returned");
    assert.equal(
      okRender.estimatedCostUsd,
      TRAINED_MUSIC_LAYER_COST_USD,
      "success carries the honest cost estimate"
    );
    assert.equal(TRAINED_MUSIC_LAYER_COST_USD, 0.08, "~$0.08/render — the documented MusicGen-class estimate");

    // Failure paths NEVER throw and always disclose.
    globalThis.fetch = (async () =>
      new Response("boom", { status: 500 })) as typeof fetch;
    const failed = await renderTrainedMusicLayer({
      modelRef: PROMOTED_REF,
      prompt: "x",
      durationS: 20,
    });
    assert.equal(failed.url, null, "provider 500 => no url");
    assert.ok(failed.note.startsWith("trained layer skipped:"), "provider failure discloses honestly");
    assert.equal(failed.estimatedCostUsd, undefined, "no audio => no cost claimed");

    const badRef = await renderTrainedMusicLayer({
      modelRef: "https://weights.example/model.tar",
      prompt: "x",
      durationS: 20,
    });
    assert.equal(badRef.url, null, "unrunnable ref => skip");
    assert.ok(badRef.note.startsWith("trained layer skipped:"), "unrunnable ref discloses honestly");

    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.REPLICATE_TOKEN;
    const noToken = await renderTrainedMusicLayer({
      modelRef: PROMOTED_REF,
      prompt: "x",
      durationS: 20,
    });
    assert.equal(noToken.url, null, "no token => skip, never throw");
    assert.ok(/REPLICATE_API_TOKEN/.test(noToken.note), "no-token skip names the missing key");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken == null) delete process.env.REPLICATE_API_TOKEN;
    else process.env.REPLICATE_API_TOKEN = originalToken;
  }

  // ── 3) RIGHTS LAW: 'lora' topping = OWN fuel; 'musicgen' stays third-party ─
  assert.equal(isOwnEngineId("lora"), true, "'lora' is an OWN engine id");
  assert.equal(isOwnEngineId("musicgen"), false, "'musicgen' is not");

  // The trained topping on an own bed keeps the bed own-origin trainable.
  const loraTopped = beatToProvenance({
    id: "bt",
    provider: "afrohit-own",
    meta: { melodyLayer: { engine: "lora", trainedModelRef: PROMOTED_REF } },
  });
  assert.equal(loraTopped.engine, "afrohit-own", "own topping never downgrades the bed engine");
  const loraVerdict = trainingEligibility(loraTopped);
  assert.equal(loraVerdict.eligible, true, "trained-layer output classifies TRAINABLE");
  assert.equal(loraVerdict.origin, "own-master", "trained-layer output is own-origin");

  // Stock musicgen keeps classifying third-party (the existing law, untouched).
  const stockTopped = beatToProvenance({
    id: "bs",
    provider: "afrohit-own",
    meta: { melodyLayer: { engine: "musicgen" } },
  });
  assert.equal(stockTopped.engine, "musicgen", "stock musicgen topping still downgrades");
  const stockVerdict = trainingEligibility(stockTopped);
  assert.equal(stockVerdict.eligible, false, "stock musicgen topping stays untrainable");
  assert.equal(stockVerdict.origin, "third-party-render", "stock musicgen topping is third-party");

  // NO LAUNDERING: an own topping falls through to the ingredient law — a
  // dirty bed stays dirty, a consent-gated bed stays consent-gated.
  const dirtyBed = beatToProvenance({
    id: "bd",
    provider: "material",
    ingredientRights: ["code-generated", "provider-generated"],
    meta: { melodyLayer: { engine: "lora", trainedModelRef: PROMOTED_REF } },
  });
  assert.equal(
    trainingEligibility(dirtyBed).eligible,
    false,
    "a lora topping can never launder a provider-generated ingredient"
  );
  const attestedBed = beatToProvenance({
    id: "ba",
    provider: "material",
    ingredientRights: ["code-generated", "user-attested"],
    meta: { melodyLayer: { engine: "lora" } },
  });
  assert.equal(
    trainingEligibility(attestedBed).eligible,
    false,
    "a lora topping keeps a user-attested bed consent-gated (no consent => no fuel)"
  );
  assert.equal(
    trainingEligibility({ ...attestedBed, consentGranted: true }).eligible,
    true,
    "consent opens the same attested bed — the door, not a bypass"
  );
  // An unknown topping engine still fails the bed closed (not own => dispositive).
  const weirdTopped = beatToProvenance({
    id: "bw",
    provider: "afrohit-own",
    meta: { melodyLayer: { engine: "mystery-model" } },
  });
  assert.equal(trainingEligibility(weirdTopped).eligible, false, "unknown topping engine fails closed");

  // The same law through the shared manifest builder (the flywheel's path).
  const manifest = manifestFromCatalog(
    {
      materials: [],
      vocals: [],
      beats: [
        { id: "own-clean", provider: "material", ingredientRights: ["code-generated"], meta: { melodyLayer: { engine: "lora", trainedModelRef: PROMOTED_REF } } },
        { id: "stock-top", provider: "afrohit-own", meta: { melodyLayer: { engine: "musicgen" } } },
        { id: "laundry", provider: "material", ingredientRights: ["provider-generated"], meta: { melodyLayer: { engine: "lora" } } },
      ],
    },
    false
  );
  assert.equal(manifest.eligible.length, 1, "only the clean lora-topped bed is fuel");
  assert.equal(manifest.eligible[0]!.id, "beat:own-clean", "the trained-layer take feeds the flywheel");
  assert.ok(manifest.rejected.some(r => r.id === "beat:stock-top"), "stock topping still refused");
  assert.ok(manifest.rejected.some(r => r.id === "beat:laundry"), "laundering still refused");

  // ── 4) WIRING: processOwnEngine reads the pointer, mixes, files receipts ────
  const ownEngineSrc = readFileSync(
    join(__dirname, "..", "src", "processors", "own-engine.ts"),
    "utf-8"
  );

  // Gate: the promotion pointer is READ (the whole point of this wave) and the
  // flag rides the pure decision (default ON, '0' kills).
  assert.ok(
    ownEngineSrc.includes("resolveActiveMusicModelRef()"),
    "the render path reads the promoted-model pointer"
  );
  assert.ok(
    /trainedLayerDecision\(\{\s*modelRef: activeModelRef,\s*flag: process\.env\.OWN_ENGINE_TRAINED_LAYER \?\? null,/m.test(
      ownEngineSrc
    ),
    "pointer + OWN_ENGINE_TRAINED_LAYER flag gate the layer via the pure decision"
  );

  const idxTrained = ownEngineSrc.indexOf("renderTrainedMusicLayer({");
  const idxStock = ownEngineSrc.indexOf("await melodyLayer(");
  const idxProof = ownEngineSrc.indexOf("// L4 — PROOF");
  assert.ok(idxTrained > 0, "processOwnEngine requests the trained layer");
  assert.ok(idxStock > idxTrained, "trained layer runs BEFORE the stock musicgen topping");
  assert.ok(idxProof > idxTrained, "trained layer lands before the proof pass measures the take");
  const trainedBranch = ownEngineSrc.slice(idxTrained, idxStock);

  // Pointer absent / flag off => the ONLY action is an honest note (identical
  // path to today: no render, no DB write, no cost).
  const skipBranch = ownEngineSrc.slice(
    ownEngineSrc.indexOf("if (!trainedDecision.attempt)"),
    idxTrained
  );
  assert.ok(
    skipBranch.includes("notes.push(`trained layer skipped: ${trainedDecision.reason}`)"),
    "skip path files the honest note"
  );
  assert.ok(
    !skipBranch.includes("renderTrainedMusicLayer") && !skipBranch.includes("prisma."),
    "skip path renders nothing and touches nothing"
  );

  // The honesty gate the stock topping earned applies to OUR model too.
  assert.ok(
    trainedBranch.includes("verifyMelodyAgainstGrid(lead, bpm, homeKey)"),
    "trained lead is measured against the grid before touching the bed"
  );

  // Modest gain via the fill-overlay pattern — texture, never the groove anchor.
  assert.ok(
    /const TRAINED_LAYER_GAIN = 0\.6;/.test(ownEngineSrc),
    "trained layer gain is 0.6 (under the bed, below the stock 0.85)"
  );
  assert.ok(
    trainedBranch.includes("overlayFills(bed, lead, [placementS], {") &&
      trainedBranch.includes("fillGain: TRAINED_LAYER_GAIN"),
    "mixing reuses the fill overlay graph at the modest gain"
  );

  // Provenance stamp: engine 'lora' — own-origin trainable by the shared law.
  assert.ok(
    /melodyLayer: \{\s*engine: "lora",\s*trainedModelRef,/m.test(trainedBranch),
    "the layer stamps engine 'lora' + the exact promoted ref on the beat meta"
  );

  // Receipts: {trainedModelRef, layerRole, estimatedCostUsd, normalizedDb}
  // ride the beat's permanent record AND the job output; the job cost is
  // recorded like every other adapter's estimatedCostUsd. normalizedDb is the
  // SOUNDWAVE2 Target D receipt: the measured shelf gain that tamed a hot
  // fine-tune render before the gates.
  for (const receiptField of [
    "trainedModelRef",
    "layerRole",
    "estimatedCostUsd",
    "normalizedDb",
    "tempoConformed",
    "tempoRatio",
    "verifiedBpm",
  ]) {
    assert.ok(
      trainedBranch.includes(receiptField),
      `trained-layer receipt includes ${receiptField}`
    );
  }
  assert.ok(
    trainedBranch.includes("normalizeLoopLoudness(leadRaw)"),
    "the hot fine-tune render is leveled to the loop shelf BEFORE the gates"
  );
  assert.equal(
    (ownEngineSrc.match(/\{ trainedLayer: trainedLayerReceipt \}/g) ?? []).length,
    2,
    "the receipt rides BOTH the beat meta (ownEngine) and the job output"
  );
  assert.ok(
    ownEngineSrc.includes("trainedLayerReceipt ? trainedLayerReceipt.estimatedCostUsd : undefined"),
    "the job row records the trained layer's cost"
  );

  // Fail-open: the mix branch catches and discloses; the take never dies here.
  assert.ok(
    trainedBranch.includes("`trained layer skipped: ${(err as Error)?.message?.slice(0, 120)}`"),
    "a trained-layer failure files the honest note instead of failing the take"
  );

  // ONE topping per take: a mixed trained layer supersedes stock musicgen.
  assert.ok(
    ownEngineSrc.includes("if (trainedLayerReceipt) {") &&
      ownEngineSrc.includes("provider melody superseded"),
    "the stock musicgen topping never stacks on a trained take"
  );

  console.log(
    "trained layer: pointer read in the render path (default ON, '0' kills); promoted version requested with genre/bpm conditioning at ~$" +
      TRAINED_MUSIC_LAYER_COST_USD.toFixed(2) +
      "/render; grid honesty gate + 0.6 fill-overlay mix; 'lora' stamp keeps takes OWN-origin trainable while stock musicgen stays third-party and laundering stays impossible; receipts on beat meta + job output + job cost; every failure fail-open with an honest note."
  );
}

main().catch(err => {
  console.error("FAIL:", err?.message ?? err);
  process.exitCode = 1;
});

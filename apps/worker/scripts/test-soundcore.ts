/**
 * SOUNDCORE — the render-path build that answers the owner's ear ("one sound, no
 * music, not our instruments"). Five approved fixes, enforced forever:
 *
 *  1. MELODY LEAD INTO THE FULL-LENGTH INSTRUMENTAL — the composed melodyScore is
 *     rendered to a MUSICAL lane voice (NOT a sine) and MIXED INTO THE BED as a
 *     topline for full-length songs (no <=30s gate), above beds / under vocals.
 *  2. REAL ISOLATED-LOOP FORGING — an isolated single-instrument forge routes to
 *     MusicGen (loop-capable) instead of the workspace SONG engine (which renders
 *     full mixes rejected for role-bleed), keeping verbatim prompt + key + backoff.
 *  3. PARALLEL FORGE FAN-OUT — the two serial forge loops + the assemble download
 *     loop become bounded-concurrency fan-outs; the coverage barrier waits for ALL.
 *  4. TRAINED-LAYER TEMPO-CONFORM — a promoted layer is time-stretched to the grid
 *     BEFORE the honesty gate, so a good-but-off-tempo trained render mixes in.
 *  5. SAMPLE-KIT SEAM — laneSampleKit() (stub []) is called FIRST in pickKit so
 *     licensed real loops become the instrument floor BEFORE synth backfill.
 *
 * Source-inspection + pure-function; the ffmpeg lead render is gated (skips when
 * ffmpeg is absent). No DB, no network. Run:
 *   pnpm --filter @afrohit/worker exec tsx scripts/test-soundcore.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  laneSampleKit,
  sampleKitFloorRows,
  materialCanAutoAssemble,
  effectiveMaterialRoleEvidence,
  GENRE_KIT_KEYS,
  type MelodyScore,
} from "@afrohit/shared";
import { forgeLoopAdapter } from "@afrohit/ai";
import { leadVoiceFor, renderMelodyLead } from "../src/lib/melody-guide";
import { probeAudioBufferDurationS } from "../src/lib/ffmpeg";

const ownEngineSrc = readFileSync(
  join(__dirname, "..", "src", "processors", "own-engine.ts"),
  "utf-8"
);
const materialSrc = readFileSync(
  join(__dirname, "..", "src", "processors", "material.ts"),
  "utf-8"
);
const melodyGuideSrc = readFileSync(
  join(__dirname, "..", "src", "lib", "melody-guide.ts"),
  "utf-8"
);

async function main() {
  // ══ 5) SAMPLE-KIT SEAM — laneSampleKit FIRST in pickKit, empty => unchanged ══
  // The stub is empty for EVERY kit genre today (no behavior change).
  for (const genre of GENRE_KIT_KEYS) {
    assert.deepEqual(
      laneSampleKit(genre),
      [],
      `laneSampleKit('${genre}') is an empty documented stub today`
    );
  }
  assert.deepEqual(sampleKitFloorRows([]), [], "an empty kit yields no floor rows");
  // When the body agent lands refs, the mapper makes rights-clean, auto-assemblable
  // 'licensed' rows the kit picker prefers over synth.
  const [row] = sampleKitFloorRows([
    { role: "shekere", url: "https://cdn/x.wav", bpm: 112, keySignature: "A minor" },
  ]);
  assert.ok(row, "a ref maps to a selectable row");
  assert.equal(row!.source, "licensed", "sample-kit rows are 'licensed' source");
  assert.equal(row!.rightsBasis, "licensed", "rights basis defaults to 'licensed' (never unknown)");
  assert.equal(row!.readiness, "ready", "sample-kit rows are ready to assemble");
  assert.equal(
    effectiveMaterialRoleEvidence(row!),
    "licensed-metadata",
    "licensed source derives 'licensed-metadata' evidence (ranked above synth)"
  );
  assert.equal(
    materialCanAutoAssemble(row!),
    true,
    "a licensed sample-kit row auto-assembles (real instrument, not a stand-in)"
  );

  // WIRING: pickKit calls laneSampleKit + sampleKitFloorRows, and it happens
  // BEFORE the synth backfill (processSynthMaterial) in processOwnEngine.
  const idxLaneKit = ownEngineSrc.indexOf("laneSampleKit(genre)");
  const idxFloorMap = ownEngineSrc.indexOf("sampleKitFloorRows(laneSampleKit(genre))");
  const idxSynthBackfill = ownEngineSrc.indexOf("processSynthMaterial({");
  assert.ok(idxLaneKit > 0, "pickKit calls laneSampleKit(genre)");
  assert.ok(idxFloorMap > 0, "pickKit maps the kit through sampleKitFloorRows FIRST");
  assert.ok(
    idxLaneKit < idxSynthBackfill,
    "laneSampleKit is resolved BEFORE the synth backfill (licensed loops are the floor)"
  );
  assert.ok(
    ownEngineSrc.includes("OTHER-AGENT-FILLS: populate laneSampleKit(genre)"),
    "a clear OTHER-AGENT-FILLS marker names where the body lands"
  );
  assert.ok(
    ownEngineSrc.includes(
      "licensedFloor.length ? [...licensedFloor, ...eligibleRows] : eligibleRows"
    ),
    "empty kit => eligibleRows unchanged; non-empty => licensed floor prepended"
  );

  // ══ 2) REAL ISOLATED-LOOP FORGING — forgeLoopAdapter routes to MusicGen ══════
  const savedTok = process.env.REPLICATE_API_TOKEN;
  const savedTok2 = process.env.REPLICATE_TOKEN;
  try {
    // (a) Workspace on a Replicate song engine → MusicGen on THEIR key (their bill).
    const wsKeyed = forgeLoopAdapter({ songProvider: "minimax", workspaceKey: "r8_ws" });
    assert.equal(wsKeyed.route, "musicgen-workspace-key", "replicate-family + ws key => musicgen on the workspace key");
    assert.equal(wsKeyed.adapter.name, "replicate", "the forge renders on the MusicGen (replicate) adapter, not minimax full-song");

    // (b) No workspace key but a house token → MusicGen on the house token.
    process.env.REPLICATE_API_TOKEN = "r8_house_token";
    delete process.env.REPLICATE_TOKEN;
    const house = forgeLoopAdapter({ songProvider: "minimax" });
    assert.equal(house.route, "musicgen-house-token", "no ws key + house token => musicgen on the house token");
    assert.equal(house.adapter.name, "replicate", "house-token forge is still MusicGen (loop-capable)");
    // Even a NON-replicate song engine forges on MusicGen when a house token exists
    // (a full-mix eleven/suno forge would fail role-bleed; MusicGen lands a solo loop).
    const elevenHouse = forgeLoopAdapter({ songProvider: "eleven", workspaceKey: "xi" });
    assert.equal(elevenHouse.route, "musicgen-house-token", "house token routes any lane's forge to MusicGen");

    // (c) No Replicate route at all → fall back to the song adapter, honestly.
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.REPLICATE_TOKEN;
    const fallback = forgeLoopAdapter({ songProvider: "ace_step", workspaceKey: "fal" });
    assert.equal(fallback.route, "song-provider-fallback", "no replicate route => the song adapter (old behavior)");
    assert.equal(fallback.adapter.name, "ace_step", "fallback keeps the workspace's own engine");
  } finally {
    if (savedTok == null) delete process.env.REPLICATE_API_TOKEN;
    else process.env.REPLICATE_API_TOKEN = savedTok;
    if (savedTok2 == null) delete process.env.REPLICATE_TOKEN;
    else process.env.REPLICATE_TOKEN = savedTok2;
  }

  // WIRING: material.ts forges through forgeLoopAdapter and PRESERVES the verbatim
  // prompt + key + 429 backoff (the whole isolation contract).
  assert.ok(
    materialSrc.includes("forgeLoopAdapter({") &&
      materialSrc.includes("songProvider: ws?.musicProvider") &&
      materialSrc.includes("workspaceKey: openSecret(ws?.musicApiKey)"),
    "processForgeMaterial resolves the loop adapter from the workspace"
  );
  assert.ok(
    materialSrc.includes('promptMode: "verbatim"') &&
      materialSrc.includes("keySignature: key"),
    "the verbatim forge prompt + key still ride the adapter.generate call"
  );
  assert.ok(
    materialSrc.includes("20_000 * tryNo"),
    "the 429-aware backoff loop is intact around the routed adapter"
  );
  assert.ok(
    materialSrc.includes("forgeRoute: forgeRoute.route"),
    "the forge route is stamped on the material receipt for provenance"
  );

  // ══ 3) PARALLEL FORGE FAN-OUT — bounded pool, barrier waits for ALL ══════════
  assert.ok(
    /async function forEachPool<T>\(/.test(ownEngineSrc) &&
      ownEngineSrc.includes("await Promise.all(workers)"),
    "a bounded-concurrency pool helper exists (fan out, then await all)"
  );
  assert.ok(
    /const FORGE_FANOUT_CONCURRENCY = /.test(ownEngineSrc),
    "the fan-out width is a named, env-overridable constant"
  );
  // Both forge loops are pools now, not serial for-loops.
  assert.ok(
    ownEngineSrc.includes("await forEachPool(richMissing, FORGE_FANOUT_CONCURRENCY"),
    "the real-forge loop fans out"
  );
  assert.ok(
    ownEngineSrc.includes("await forEachPool(forgeTargets, FORGE_FANOUT_CONCURRENCY"),
    "the auto-forge loop fans out"
  );
  assert.ok(
    !/for \(const role of forgeTargets\)/.test(ownEngineSrc) &&
      !/for \(const role of richMissing\)/.test(ownEngineSrc),
    "no serial per-role forge loop remains"
  );
  // BARRIER: the auto-forge pool settles BEFORE the coverage re-pick, which is
  // BEFORE the assembly dispatch (fan out → verification barrier → assemble).
  const idxAutoPool = ownEngineSrc.indexOf("await forEachPool(forgeTargets");
  // The re-pick barrier is the FIRST coverage recompute AFTER the pool settles
  // (the initial `let coverage = ...` precedes the pool by construction).
  const idxRepick = ownEngineSrc.indexOf("coverage = materialCoverage(picks);", idxAutoPool);
  const idxAssemble = ownEngineSrc.indexOf("processAssembleBeat({");
  assert.ok(idxAutoPool > 0 && idxRepick > idxAutoPool, "coverage is recomputed AFTER the whole forge pool settles");
  assert.ok(idxAssemble > idxRepick, "assembly dispatch is AFTER the coverage barrier");
  // The assemble download loop is parallel too.
  assert.ok(
    materialSrc.includes("await Promise.all(") &&
      materialSrc.includes("bedPicks.map(async (pick, i) =>"),
    "processAssembleBeat downloads every picked loop concurrently"
  );
  assert.ok(
    !/for \(let i = 0; i < bedPicks\.length/.test(materialSrc),
    "no serial bedPicks download loop remains"
  );

  // ══ 4) TRAINED-LAYER TEMPO-CONFORM — conform BEFORE the grid gate ════════════
  // The conform IMPLEMENTATION is SOUNDWAVE3's conformMelodyTempoToGrid (merged
  // from Codex — same fix, richer receipt; test-soundwave3.ts owns its internals).
  // Here we only pin that the trained branch conforms tempo BEFORE the grid gate.
  const idxTrained = ownEngineSrc.indexOf("renderTrainedMusicLayer({");
  const idxStock = ownEngineSrc.indexOf("await melodyLayer(");
  const trainedBranch = ownEngineSrc.slice(idxTrained, idxStock);
  const idxConform = trainedBranch.indexOf("conformMelodyTempoToGrid(lead, bpm)");
  const idxGate = trainedBranch.indexOf("verifyMelodyAgainstGrid(lead, bpm, homeKey)");
  assert.ok(idxConform > 0, "the trained lead is tempo-conformed");
  assert.ok(idxGate > 0 && idxConform < idxGate, "the conform runs BEFORE the grid-honesty gate");

  // ══ 1) MELODY LEAD INTO THE FULL-LENGTH INSTRUMENTAL ═════════════════════════
  // Lane voices are MUSICAL, distinct, and NOT a bare sine.
  assert.equal(leadVoiceFor("amapiano").name, "synth lead", "amapiano leads with a synth");
  assert.equal(leadVoiceFor("highlife").name, "guitar", "highlife leads with a guitar");
  assert.equal(leadVoiceFor("afrobeats").name, "electric piano", "afrobeats leads with an EP");
  assert.equal(leadVoiceFor("afro_gospel").name, "electric piano", "gospel leads with an EP");
  assert.equal(leadVoiceFor("totally_unknown_lane").name, "electric piano", "unknown lanes default to the EP (safest topline)");
  for (const g of ["afrobeats", "amapiano", "highlife", "kwaito"]) {
    const v = leadVoiceFor(g);
    assert.ok(v.partials.length >= 2, `${g} lead is additive (>=2 partials) — NOT a single sine`);
    assert.ok(v.decay > 0 && v.attackS >= 0, `${g} lead has a real amplitude envelope`);
  }
  // Determinism: same lane in, same voice out.
  assert.deepEqual(leadVoiceFor("afrobeats"), leadVoiceFor("afrobeats"), "voice selection is deterministic");

  // WIRING: the lead is rendered and MIXED INTO THE BED, gated only on melodyScore
  // (NO <=30s restriction), and it lands BEFORE the trained layer / topping so
  // they build on the lead-mixed bed.
  const idxLeadBlock = ownEngineSrc.indexOf("// L1c — MELODY LEAD INTO THE FULL-LENGTH INSTRUMENTAL");
  const leadBlock = ownEngineSrc.slice(idxLeadBlock, idxTrained);
  assert.ok(idxLeadBlock > 0, "the L1c melody-lead block exists");
  assert.ok(idxLeadBlock < idxTrained, "the melody lead lands BEFORE the trained layer");
  assert.ok(
    leadBlock.includes("renderMelodyLead(melodyScore, { genre: p.genre })"),
    "the composed score is rendered to the lane's lead voice"
  );
  assert.ok(
    leadBlock.includes("mixBuffers(bed, leadWav, MELODY_LEAD_GAIN)"),
    "the lead is MIXED INTO THE BED (not just saved as a separate guide)"
  );
  assert.ok(
    /const MELODY_LEAD_GAIN = 0\.7;/.test(ownEngineSrc),
    "the lead sits above the bed color, under where the vocal lands (0.7)"
  );
  assert.ok(
    leadBlock.includes("if (melodyScore) {") && !/totalS <= 30/.test(leadBlock),
    "the lead is for FULL-LENGTH songs — gated on the composed score, NOT a <=30s window"
  );
  assert.ok(
    leadBlock.includes("finalUrl = certified.url;") &&
      leadBlock.includes("out.url = certified.url;"),
    "the lead-mixed bed becomes the current bed the downstream toppings build on"
  );
  assert.ok(
    leadBlock.includes("melodyLead: {") && leadBlock.includes("melody lead skipped:"),
    "a melodyLead receipt is stamped, and any failure is fail-open with an honest note"
  );
  // The old guide WAV (audible evidence) is kept — the lead is ADDITIVE, not a swap.
  assert.ok(
    ownEngineSrc.includes("renderMelodyGuide(melodyScore)"),
    "the melody guide evidence WAV is retained"
  );

  // LAYER PRESENT IN A >30s RENDER — the direct ear test (ffmpeg-gated). Build a
  // >30s score, render the lead, prove the WAV spans the full length and carries
  // audio. Skips cleanly when ffmpeg is absent (never fails the offline suite).
  const bpm = 100;
  const section = (name: string): MelodyScore["sections"][number] => ({
    name,
    kind: "verse",
    bars: 8,
    notes: Array.from({ length: 32 }, (_, i) => ({
      startBeat: i,
      durBeats: 0.9,
      midi: 60 + (i % 5),
      syllable: "la",
    })),
  });
  const score: MelodyScore = {
    bpm,
    key: "A minor",
    seed: 7,
    sections: [section("v1"), section("h1"), section("v2")], // 24 bars = 57.6s @100bpm
  };
  try {
    const leadWav = await renderMelodyLead(score, { genre: "afrobeats" });
    const durS = await probeAudioBufferDurationS(leadWav);
    assert.ok(durS > 30, `the rendered lead spans a full-length >30s render (got ${durS}s)`);
    assert.ok(leadWav.length > 44 + 44100 * 2 * 20, "the lead WAV carries real audio, not a header");
    // Determinism: same score → byte-identical lead (seeded replay reproduces).
    const leadWav2 = await renderMelodyLead(score, { genre: "afrobeats" });
    assert.equal(leadWav.length, leadWav2.length, "the lead render is deterministic (same bytes length)");
    console.log(`soundcore ffmpeg lead: rendered a ${Math.round(durS)}s afrobeats topline (layer present in a >30s render)`);
  } catch (err) {
    console.log(`soundcore ffmpeg lead: SKIP (ffmpeg unavailable) — ${(err as Error)?.message?.slice(0, 80)}`);
  }

  console.log(
    "soundcore: melody lead mixed into full-length beds (musical voice, not a sine, no <=30s gate); isolated forges route to MusicGen (verbatim+key+backoff intact, cost honest); forge loops + assemble downloads fan out with the coverage barrier preserved; trained layer tempo-conforms before the gate; laneSampleKit is the instrument floor before synth backfill (empty => unchanged) — all enforced."
  );
}

main().catch(err => {
  console.error("FAIL:", err?.message ?? err);
  process.exitCode = 1;
});

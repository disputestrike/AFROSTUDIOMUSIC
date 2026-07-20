/**
 * SOUNDWAVE2 GATE — the owner's two ear verdicts on the first sung AfroOne
 * render ("the voice is behind" / "that's not Afrobeats"), plus the two
 * mid-wave scope additions, pinned forever:
 *
 *  A. VOCAL FORWARD — measured loudness match (vocal a fixed env-tunable
 *     offset ABOVE the bed), sidechain duck of the bed keyed by the vocal,
 *     the 60ms slapback replaced by a subtle early-reflection cluster, and
 *     the sung full mix routed through the SAME two-pass master chain the
 *     instrumental beds get. Receipts: bedLufs/vocalLufs/offset/ducked/
 *     mastered on the take.
 *  B. THE AFROBEATS POCKET — one shared per-genre swing ratio applied to
 *     EVERY 16th-grid voice in the synth floor (sourced from the expert
 *     priors), velocity humanization per seed, the pre-hook drop bar
 *     (kick+bass out for the final bar before each hook), and the audible
 *     transition (fill at 0.8 over a band ducked 4 dB for its bar).
 *  C. SING IN MY VOICE — a READY workspace voice profile auto-converts the
 *     sung take into the artist's own trained timbre (explicit payload
 *     profile wins; auto path fails open with an honest note; kill switch
 *     AFROONE_SING_IN_MY_VOICE=0). Receipts: voiceProfileId + converted.
 *  D. TRAINED LAYER LEVELING — the promoted fine-tune's hot output is
 *     loudness-normalized to the loop shelf BEFORE the QC gates and mix
 *     (receipt: normalizedDb), so hot-but-good renders are tamed in, while
 *     truly broken audio still skips honestly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { laneSwingRatio, LANE_SWING_DEFAULT } from '@afrohit/shared';
import {
  AFROONE_VOCAL_OFFSET_DB_DEFAULT,
  afroOneVocalOffsetDb,
  applyPreHookDrops,
  buildVocalForwardMixGraph,
  isPreHookDropRole,
  PRE_HOOK_DROP_ENERGY,
  VOCAL_FORWARD_DUCK,
  vocalForwardVocalChain,
  vocalGainDbFromLufs,
  type AssemblySection,
} from '../src/lib/ffmpeg';
import {
  buildFillFilterGraph,
  FILL_BAND_DUCK_DB,
  FILL_TRANSITION_GAIN,
} from '../src/lib/fills';
import { singInMyVoiceEnabled } from '../src/processors/afroone-singing';

let failures = 0;
const fail = (m: string) => { console.error(`FAIL: ${m}`); failures++; };

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const singingSrc = src('src/processors/afroone-singing.ts');
const ownEngineSrc = src('src/processors/own-engine.ts');
const materialSrc = src('src/processors/material.ts');
const synthBridgeSrc = src('src/processors/synth-material.ts');
const synthPySrc = src('py/synth_material.py');

// ---- A1: vocal offset math from measured LUFS pairs -----------------------
{
  if (AFROONE_VOCAL_OFFSET_DB_DEFAULT !== 2) fail('offset: the default vocal-over-bed offset is +2 dB');
  if (afroOneVocalOffsetDb({} as NodeJS.ProcessEnv) !== 2) fail('offset: no env -> default 2');
  if (afroOneVocalOffsetDb({ AFROONE_VOCAL_OFFSET_DB: '3.5' } as never) !== 3.5) fail('offset: env override must win');
  if (afroOneVocalOffsetDb({ AFROONE_VOCAL_OFFSET_DB: '' } as never) !== 2) fail('offset: empty env -> default (Number("") is 0, not a setting)');
  if (afroOneVocalOffsetDb({ AFROONE_VOCAL_OFFSET_DB: 'loud' } as never) !== 2) fail('offset: junk env -> default');
  if (afroOneVocalOffsetDb({ AFROONE_VOCAL_OFFSET_DB: '99' } as never) !== 8) fail('offset: clamps to +8 (a typo never screams)');
  if (afroOneVocalOffsetDb({ AFROONE_VOCAL_OFFSET_DB: '-20' } as never) !== -3) fail('offset: clamps to -3 (a typo never buries)');

  const matched = vocalGainDbFromLufs(-14, -20, 2);
  if (!matched.matched || matched.gainDb !== 8) fail(`gain: bed -14 / vocal -20 / +2 must apply +8 dB (got ${matched.gainDb})`);
  const down = vocalGainDbFromLufs(-18, -12, 2);
  if (!down.matched || down.gainDb !== -4) fail(`gain: a HOT stem (bed -18 / vocal -12 / +2) must come DOWN -4 dB (got ${down.gainDb})`);
  const unmeasured = vocalGainDbFromLufs(null, -20, 2);
  if (unmeasured.matched || unmeasured.gainDb !== 0) fail('gain: unmeasurable bed -> 0 dB + matched:false (fail-open, honest note)');
  const unmeasured2 = vocalGainDbFromLufs(-14, null, 2);
  if (unmeasured2.matched || unmeasured2.gainDb !== 0) fail('gain: unmeasurable vocal -> 0 dB + matched:false');
  if (vocalGainDbFromLufs(-8, -40, 2).gainDb !== 12) fail('gain: boost clamps at +12 dB (never drag a whisper into its noise floor)');
  if (vocalGainDbFromLufs(-40, -8, 2).gainDb !== -12) fail('gain: cut clamps at -12 dB');
}

// ---- A2/A3: duck filtergraph + slapback retirement -------------------------
{
  const graph = buildVocalForwardMixGraph(4.5);
  if (!graph.includes('volume=4.5dB')) fail('mix graph: the measured vocal gain must ride the vocal chain');
  if (!graph.includes('asplit=2[vmix][vkey]')) fail('mix graph: the vocal must split into the mix voice and the sidechain KEY');
  if (!graph.includes('[0:a][vkey]sidechaincompress=')) fail('mix graph: the BED must duck under the VOCAL key (sidechaincompress)');
  const d = VOCAL_FORWARD_DUCK;
  if (!(d.ratio >= 2.5 && d.ratio <= 3)) fail(`duck: gentle ratio 2.5-3 is the law (got ${d.ratio})`);
  if (!(d.releaseMs >= 150 && d.releaseMs <= 250)) fail(`duck: musical release 150-250ms (got ${d.releaseMs})`);
  if (!(d.attackMs <= 10)) fail(`duck: fast attack (<=10ms) so phrase onsets duck the bed (got ${d.attackMs})`);
  if (!graph.includes(`sidechaincompress=threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attackMs}:release=${d.releaseMs}`)) {
    fail('mix graph: the duck constants must reach the filter verbatim');
  }
  if (!graph.includes('[bed][vmix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0')) {
    fail('mix graph: honest sum — ducked bed + vocal, normalize=0, bed rules the duration');
  }
  if (!graph.includes('alimiter=level=false:limit=0.891')) fail('mix graph: the house -1 dB safety limiter must close the graph');
  if (/aecho=0\.6:0\.3:60/.test(graph)) fail('mix graph: the dated fixed 60ms slapback must be GONE');
  if (!/aecho=0\.7:0\.22:23\|41\|59/.test(graph)) fail('mix graph: the subtle early-reflection cluster (23/41/59ms, low decay) replaces it');
  const chain = vocalForwardVocalChain(0);
  if (!(chain.indexOf('volume=') < chain.indexOf('acompressor'))) {
    fail('vocal chain: measured gain must land BEFORE the fixed-threshold compressor (predictable level in)');
  }
  if (!chain.includes('highpass=f=90')) fail('vocal chain: the proven 90 Hz highpass stays');
}

// ---- A3/A4: sung mix routed through master + receipts (source law) ---------
{
  if (!/mixdownVocalForward\(\{/.test(singingSrc)) fail('singing: the mix must be the vocal-forward chain (mixdownVocalForward)');
  if (/preset:\s*'radio'/.test(singingSrc)) fail("singing: the static 'radio' demo mix must be GONE from the sung path");
  if (!/master\(\{/.test(singingSrc) || !/preset: 'afro_stream_-9'/.test(singingSrc) || !/genre: payload\.genre/.test(singingSrc)) {
    fail('singing: the finished sung mix must run the SAME two-pass master chain with the genre curve');
  }
  for (const receipt of ['vocalForward', 'bedLufs', 'vocalLufs', 'targetOffsetDb', 'appliedVocalGainDb', 'ducked: true', 'mastered', 'loudnessMatched']) {
    if (!singingSrc.includes(receipt)) fail(`singing receipts: '${receipt}' must ride the take meta`);
  }
  if (!/un-mastered mix shipped/.test(singingSrc)) fail('singing: master failure must fail OPEN with the honest note, never die');
}

// ---- B (pocket 1): one shared per-genre swing -------------------------------
{
  const afro = laneSwingRatio('afrobeats');
  if (!(afro >= 0.56 && afro <= 0.58)) fail(`swing: afrobeats must sit at 56-58% swung 16ths (got ${afro})`);
  if (!(laneSwingRatio('amapiano') >= 0.55)) fail('swing: amapiano must swing at least 55%');
  if (laneSwingRatio('gqom') !== 0.5) fail('swing: gqom is STRAIGHT (0.5) by doctrine');
  if (laneSwingRatio('made_up_lane') !== LANE_SWING_DEFAULT) fail('swing: unknown lanes get the gentle default');
  if (laneSwingRatio('jazz') > 0.62) fail('swing: the ratio clamps at 0.62 — no drunk shuffles');
  if (laneSwingRatio(null) !== LANE_SWING_DEFAULT || laneSwingRatio(undefined) !== LANE_SWING_DEFAULT) {
    fail('swing: absent genre falls back honestly');
  }
  // The bridge passes the authoritative ratio into the synth (argv[8]).
  if (!/laneSwingRatio\(genre\)\.toFixed\(3\)/.test(synthBridgeSrc)) {
    fail('synth bridge: the expert-prior swing must ride the synth argv (one source of truth)');
  }
  // The synth floor: ONE swung() grid for every voice, the hardcoded shaker
  // shift retired, humanized velocities.
  if (!/def swung\(/.test(synthPySrc)) fail('synth floor: the shared swung() helper must exist');
  if (!/def resolve_swing\(/.test(synthPySrc)) fail('synth floor: resolve_swing (caller value -> genre table -> clamp) must exist');
  if (/0\.055 \* beat/.test(synthPySrc)) fail('synth floor: the hardcoded 0.055-beat shaker shift must be GONE (it clashed with straight hats)');
  const putCount = (synthPySrc.match(/\bput\(/g) ?? []).length;
  if (putCount < 12) fail(`synth floor: every voice places hits through the swung grid (put() x${putCount} — expected across drums/log_drum/percussion/chords/fill/bass)`);
  const humCount = (synthPySrc.match(/\bhum\(/g) ?? []).length;
  if (humCount < 10) fail(`synth floor: velocities must be humanized per hit (hum() x${humCount})`);
  if (!/def hum\(/.test(synthPySrc) || !/rng\.uniform\(0\.87, 1\.13\)/.test(synthPySrc)) {
    fail('synth floor: humanization is ±13%, drawn from the SEEDED rng (deterministic per seed)');
  }
}

// ---- B (pocket 2): pre-hook drop bar ----------------------------------------
{
  if (!isPreHookDropRole('drums') || !isPreHookDropRole('bass') || !isPreHookDropRole('log_drum')) {
    fail('drop roles: legacy drums/bass/log_drum carry the kick/low end — they drop');
  }
  if (!isPreHookDropRole('kick') || !isPreHookDropRole('kick_808')) fail('drop roles: taxonomy kicks drop');
  if (isPreHookDropRole('shaker') || isPreHookDropRole('shekere') || isPreHookDropRole('chords')) {
    fail('drop roles: percussion/harmony CARRY the breath — they must not drop');
  }
  if (isPreHookDropRole(undefined)) fail('drop roles: unknown is honorable — never silence what we cannot identify');

  const roles = ['drums', 'shaker', 'bass', 'chords'];
  const sections: AssemblySection[] = [
    { name: 'intro', bars: 4, layerIdx: [0, 1], energy: 0.42 },
    { name: 'verse', bars: 8, layerIdx: [0, 1, 2], energy: 0.62 },
    { name: 'hook', bars: 8, layerIdx: [0, 1, 2, 3], energy: 0.85 },
    { name: 'verse2', bars: 8, layerIdx: [0, 1, 2, 3], energy: 0.68 },
    { name: 'hook2', bars: 8, layerIdx: [0, 1, 2, 3], energy: 0.9 },
    { name: 'outro', bars: 4, layerIdx: [0, 2], energy: 0.38 },
  ];
  const { sections: arranged, drops } = applyPreHookDrops(sections, roles);
  const sum = (list: AssemblySection[]) => list.reduce((a, s) => a + s.bars, 0);
  if (sum(arranged) !== sum(sections)) fail('drop: total bar count must be preserved (the record never shrinks or grows)');
  if (drops.length !== 2) fail(`drop: template has two hooks -> two drop bars (got ${drops.length})`);
  const dropSections = arranged.filter((s) => /_prehook_drop$/.test(s.name));
  if (dropSections.length !== 2) fail('drop: the drop bars must be named *_prehook_drop (receipt-readable)');
  for (const dropSec of dropSections) {
    if (dropSec.bars !== 1) fail('drop: the breath is exactly ONE bar');
    if (dropSec.energy !== PRE_HOOK_DROP_ENERGY) fail('drop: the drop bar sits back (energy 0.25) so equal-power bus math cannot cancel it');
    if (dropSec.layerIdx.some((i) => isPreHookDropRole(roles[i]))) fail('drop: no kick/bass layer survives inside the drop bar');
    if (!dropSec.layerIdx.length) fail('drop: the breath keeps the carriers playing (never silence)');
  }
  const verseDrop = arranged[arranged.findIndex((s) => s.name === 'verse') + 1];
  if (!verseDrop || verseDrop.name !== 'verse_prehook_drop') fail('drop: the drop bar lands immediately before the hook');
  if (arranged.find((s) => s.name === 'verse')!.bars !== 7) fail('drop: the source section shrinks by exactly the drop bar');
  if (JSON.stringify(verseDrop.layerIdx) !== JSON.stringify([1])) fail(`drop: verse [drums,shaker,bass] keeps only the shaker (got ${JSON.stringify(verseDrop?.layerIdx)})`);
  if (JSON.stringify(drops[0]!.droppedLayerIdx) !== JSON.stringify([0, 2])) fail('drop receipt: the silenced layers are recorded');
  if (drops[0]!.into !== 'hook' || drops[1]!.into !== 'hook2') fail('drop receipt: each drop names the hook it leads into');
  // Determinism: replay reproduces.
  const replay = applyPreHookDrops(sections, roles);
  if (JSON.stringify(replay) !== JSON.stringify({ sections: arranged, drops })) fail('drop: deterministic — replay must reproduce byte-identically');

  // Fail-open laws.
  const noHook = applyPreHookDrops([{ name: 'verse', bars: 8, layerIdx: [0, 1, 2] }], roles);
  if (JSON.stringify(noHook.sections) !== JSON.stringify([{ name: 'verse', bars: 8, layerIdx: [0, 1, 2] }]) || noHook.drops.length) {
    fail('drop fail-open: no hook -> untouched');
  }
  const tiny = applyPreHookDrops(
    [{ name: 'lift', bars: 1, layerIdx: [0, 1] }, { name: 'hook', bars: 8, layerIdx: [0, 1] }],
    roles
  );
  if (tiny.drops.length || tiny.sections[0]!.bars !== 1) fail('drop fail-open: a 1-bar section is never split');
  const allDrop = applyPreHookDrops(
    [{ name: 'verse', bars: 8, layerIdx: [0, 1] }, { name: 'hook', bars: 8, layerIdx: [0, 1] }],
    ['drums', 'bass']
  );
  if (allDrop.drops.length || allDrop.sections[0]!.bars !== 8) fail('drop fail-open: when every layer would drop, the breath would be silence -> untouched');
  // Wiring: the assembler actually renders the arranged grid + receipts it.
  if (!/applyPreHookDrops\(/.test(materialSrc)) fail('assembler: applyPreHookDrops must be wired into processAssembleBeat');
  if (!/sections: arrangedSections/.test(materialSrc)) fail('assembler: assembleBeat must render the ARRANGED sections');
  if (!/preHookDrops/.test(materialSrc)) fail('assembler: the drop receipt must ride the beat meta');
}

// ---- B (pocket 3): audible transitions — fill over a ducked band -----------
{
  if (FILL_TRANSITION_GAIN !== 0.8) fail('fill doctrine: the transition fill rides at 0.8');
  if (FILL_BAND_DUCK_DB !== 4) fail('fill doctrine: the band ducks 4 dB under the fill');
  const g = buildFillFilterGraph([10, 30], { bpm: 120, fillGain: FILL_TRANSITION_GAIN, duckDb: FILL_BAND_DUCK_DB })!;
  if (!g) { fail('fill: graph must build'); }
  if (!g.includes("volume=0.6310:enable='between(t,10.000,12.000)'")) fail('fill duck: -4 dB for EXACTLY the first fill bar (10-12s at 120bpm)');
  if (!g.includes("enable='between(t,30.000,32.000)'")) fail('fill duck: every placement gets its own duck window');
  if (!g.includes('[0:a]volume=') || !g.includes('[trk]')) fail('fill duck: the band chain must be its own labeled pad feeding the mix');
  if (!g.includes('volume=0.8,asplit')) fail('fill: the fill itself rides at 0.8 (audible, not half-buried)');
  if (!g.includes('normalize=0')) fail('fill: the honest sum stays');
  // Back-compat: no duckDb -> the old graph, byte-compatible behavior.
  const legacy = buildFillFilterGraph([10, 30], { fillGain: 0.5 })!;
  if (legacy.includes('between(') || legacy.includes('[trk]')) fail('fill back-compat: without duckDb the graph must be unchanged');
  const noBpm = buildFillFilterGraph([10], { fillGain: 0.8, duckDb: 4 })!;
  if (noBpm.includes('between(')) fail('fill duck: without bpm there is no bar window — no duck (fail-open)');
  // Wiring: the assembler passes the doctrine values.
  if (!/fillGain: FILL_TRANSITION_GAIN/.test(materialSrc) || !/duckDb: FILL_BAND_DUCK_DB/.test(materialSrc)) {
    fail('assembler: the transition doctrine (0.8 fill / 4 dB duck) must be wired into overlayFills');
  }
}

// ---- C: sing in my voice (trained-voice conversion) -------------------------
{
  if (!singInMyVoiceEnabled({} as NodeJS.ProcessEnv)) fail('voice: default ON when a ready profile exists');
  if (singInMyVoiceEnabled({ AFROONE_SING_IN_MY_VOICE: '0' } as never)) fail('voice: AFROONE_SING_IN_MY_VOICE=0 is the kill switch');
  if (!singInMyVoiceEnabled({ AFROONE_SING_IN_MY_VOICE: '1' } as never)) fail('voice: =1 stays on');
  if (!/newestReadyVoiceProfileId/.test(singingSrc)) fail('voice: the newest READY workspace profile is the auto-pick');
  if (!/status: 'READY'/.test(singingSrc) || !/revokedAt: null/.test(singingSrc)) {
    fail('voice: the auto-pick demands READY status AND unrevoked consent');
  }
  if (!/orderBy: \{ createdAt: 'desc' \}/.test(singingSrc)) fail('voice: newest profile wins');
  if (!/voiceSource !== 'auto'/.test(singingSrc)) fail('voice: an EXPLICIT payload profile keeps the hard-fail law; only the auto path fails open');
  if (!/sung in the studio voice — voice conversion skipped/.test(singingSrc)) fail('voice: the fail-open note must be the honest sentence');
  if (!/voiceConversion/.test(singingSrc) || !/converted: voiceConverted/.test(singingSrc)) {
    fail('voice receipts: voiceProfileId + converted must ride the take meta and job output');
  }
  if (/loadPersonalVoice\(\s*payload\.workspaceId,\s*payload\.voiceProfileId\s*\)[\s\S]*singWithVoice/.test(singingSrc.split('let voiceConversionUsd')[1] ?? '')) {
    fail('voice: conversion + persistence must re-load by the ACTIVE profile id (voice.id), not the payload field (auto profiles have no payload id)');
  }
  if (!/loadPersonalVoice\(\s*payload\.workspaceId,\s*voice\.id\s*\)/.test(singingSrc)) {
    fail('voice: the invocation re-load must use voice.id');
  }
  // Rights: converted takes keep the voice_conversion performanceSource stamp.
  if (!/performanceSource: voice \? 'voice_conversion' : rendered\.performanceSource/.test(singingSrc)) {
    fail("voice rights: a converted take stamps performanceSource 'voice_conversion' (the training-corpus classifier reads it)");
  }
}

// ---- D: trained layer leveled BEFORE the gates ------------------------------
{
  if (!/normalizeLoopLoudness\(leadRaw\)/.test(ownEngineSrc)) {
    fail('trained layer: the fine-tune output must be loudness-normalized (the forge-loop machinery) before the gates');
  }
  const normIdx = ownEngineSrc.indexOf('normalizeLoopLoudness(leadRaw)');
  const gateIdx = ownEngineSrc.indexOf('verifyMelodyAgainstGrid(lead,');
  const mixIdx = ownEngineSrc.indexOf('overlayFills(bed, lead,');
  if (!(normIdx > 0 && gateIdx > normIdx && mixIdx > gateIdx)) {
    fail('trained layer: order is normalize -> QC/honesty gates -> mix (hot-but-good tamed in; broken still skipped)');
  }
  if (!/normalizedDb/.test(ownEngineSrc)) fail('trained layer receipt: normalizedDb must ride the receipt + meta');
  if (!/LOOP_LOUDNESS_TARGET\.lufs - leadLevel\.preLufs/.test(ownEngineSrc)) {
    fail('trained layer receipt: normalizedDb is MEASURED (shelf target minus measured pre-level), never a guess');
  }
  if (!/trained layer skipped: \$\{\(err as Error\)/.test(ownEngineSrc)) {
    fail('trained layer: the fail-open skip note must survive (broken audio still skips honestly)');
  }
}

if (failures) { console.error(`soundwave2: ${failures} failure(s)`); process.exit(1); }
console.log(
  'soundwave2: vocal loudness-matched +2 dB over the bed (env-tunable, clamped), bed ducks under the vocal (2.8:1, 200ms release), slapback retired for a subtle reflection cluster, sung mixes mastered through the genre chain with receipts; one shared expert-prior swing across every 16th-grid synth voice with ±13% seeded velocity humanization, pre-hook drop bar (kick+bass out, carriers on, bar count preserved, fail-open), transitions audible (fill 0.8 over a 4 dB band duck); trained-voice auto-conversion with kill switch + fail-open note + rights stamp; trained layer leveled to the loop shelf before its gates — all enforced'
);

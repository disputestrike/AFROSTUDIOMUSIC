/**
 * MELODY-BRAIN GATE — composed, not guessed. NO network, NO ffmpeg: this
 * exercises the pure music-theory composer in @afrohit/shared (composeMelody
 * + its validators) with the Own Singer laws, across seeds, plus negative
 * controls proving every validator actually bites. The taste layer
 * (melodyBrain in @afrohit/ai) is import-checked only — it degrades to this
 * exact composer on any LLM failure, so the composer IS the contract.
 * Exit 1 on any regression.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-melody-brain.ts
 */
import {
  composeMelody,
  scoreInKey,
  anchorsOnStrongBeats,
  hookCellRepeats,
  sectionsFitBars,
  melodySpanSemitones,
  syllabify,
  isMelismaToken,
  parseKey,
  degreeToMidi,
  laneFeel,
  seedFrom,
  midiNoteName,
  type MelodyScore,
  type ComposeMelodyOpts,
} from '@afrohit/shared';
import { melodyBrain } from '@afrohit/ai';

let failures = 0;
const fail = (m: string) => { console.error('FAIL:', m); failures++; };
const assert = (cond: boolean, msg: string) => { if (cond) console.log('  ok:', msg); else fail(msg); };

// ---- the brief: afrobeats 104bpm B minor, verse + pre-hook + hook ----------
const BRIEF = (seed: number): ComposeMelodyOpts => ({
  genre: 'afrobeats',
  bpm: 104,
  key: 'B minor',
  seed,
  swing: 0.56,
  syncopation: 0.7, // the Afro pocket — anchors target the off-beat push
  sections: [
    {
      name: 'Verse', kind: 'verse',
      lines: [
        'I was thinking about you when the city lights fade',
        'Only you dey hold my heart for the road tonight',
        'Every fire wey you light still burning in my name',
        'Call my name make I follow you home again',
      ],
      anchors: ['you', 'fire', 'name', 'heart'],
    },
    {
      name: 'Pre-Hook', kind: 'prehook',
      lines: ['So I call your line one more time'],
    },
    {
      name: 'Hook', kind: 'hook',
      lines: [
        "Thinkin' 'bout you all night",
        "Thinkin' 'bout you all night", // the repeated lyric line — the hook cell law
        'All ni-i-ight oh oh',          // the Singing Brain's melisma notation
        'You dey shine my light',
      ],
      anchors: ['night', 'light', 'you'],
    },
  ],
});

// ---- 1: helpers behave (syllabification + melisma + key) -------------------
console.log('\n[1] syllabification, melisma notation, key parsing');
{
  assert(syllabify('thinking').length === 2, `syllabify("thinking") = 2 syllables (got ${JSON.stringify(syllabify('thinking'))})`);
  assert(syllabify('melody').length === 3, `syllabify("melody") = 3 syllables (got ${JSON.stringify(syllabify('melody'))})`);
  assert(syllabify('night').length === 1, 'syllabify("night") = 1 syllable');
  assert(isMelismaToken('ni-i-ight') && isMelismaToken('o-o-oh'), 'melisma notation detected (ni-i-ight, o-o-oh)');
  assert(!isMelismaToken('call-and-response'), 'ordinary hyphenation is NOT melisma');
  const k = parseKey('B minor');
  assert(k.tonicPc === 11 && k.mode === 'minor', 'parseKey("B minor") → tonic B, natural minor');
  assert(degreeToMidi(k, 1) === 59 && degreeToMidi(k, 8) === 71, 'degree 1 = B3 (59), degree 8 = B4 (71)');
  const feel = laneFeel('afrobeats');
  assert(feel.swing >= 0.54 && feel.syncopation > 0.6, 'afrobeats lane feel carries the lilt + the off-beat pocket');
  assert(seedFrom('song-a', 104) !== seedFrom('song-b', 104) && seedFrom('x', 1) === seedFrom('x', 1), 'seedFrom is stable per input, distinct across songs');
}

// ---- 2: every law holds across 3 seeds --------------------------------------
console.log('\n[2] the laws, across seeds 7 / 42 / 1337');
const scores = new Map<number, MelodyScore>();
for (const seed of [7, 42, 1337]) {
  const score = composeMelody(BRIEF(seed));
  scores.set(seed, score);
  const inKey = scoreInKey(score);
  const prosody = anchorsOnStrongBeats(score);
  const span = melodySpanSemitones(score);
  const noteCount = score.sections.reduce((a, s) => a + s.notes.length, 0);
  console.log(`  seed ${seed}: ${noteCount} notes, inKey=${(inKey * 100).toFixed(0)}%, anchorsStrong=${(prosody * 100).toFixed(0)}%, span=${span} semis`);
  assert(inKey === 1, `[seed ${seed}] scoreInKey = 100% (got ${(inKey * 100).toFixed(1)}%)`);
  assert(prosody >= 0.7, `[seed ${seed}] anchorsOnStrongBeats ≥ 0.7 (got ${prosody.toFixed(3)})`);
  assert(hookCellRepeats(score), `[seed ${seed}] hookCellRepeats — repeated hook line keeps its exact pitches`);
  assert(sectionsFitBars(score), `[seed ${seed}] sectionsFitBars — no section overflows its bars`);
  assert(span <= 14, `[seed ${seed}] span ≤ 14 semitones (got ${span})`);

  // melisma: "ni-i-ight" = ONE syllable held across ≥2 notes, stepping down
  const hook = score.sections.find((s) => s.kind === 'hook')!;
  const meli = hook.notes.filter((n) => n.syllable === 'ni-i-ight');
  assert(meli.length >= 2, `[seed ${seed}] melisma "ni-i-ight" maps to ≥ 2 notes (got ${meli.length})`);
  assert(meli.every((n, i) => i === 0 || n.midi <= meli[i - 1]!.midi), `[seed ${seed}] melisma steps DOWN (${meli.map((n) => midiNoteName(n.midi)).join(' → ')})`);

  // hook cell law, checked directly: the two identical lyric lines carry identical pitches
  const firstLineNotes = hook.notes.length; // sanity only
  assert(firstLineNotes > 0, `[seed ${seed}] hook has notes`);
  const verse = score.sections.find((s) => s.kind === 'verse')!;
  const lastVerse = verse.notes[verse.notes.length - 1]!;
  const pc = ((lastVerse.midi % 12) + 12) % 12;
  assert(pc === 11 || pc === 2, `[seed ${seed}] verse arc falls home — final note is tonic/third (B or D, got ${midiNoteName(lastVerse.midi)})`);
  const lastHook = hook.notes[hook.notes.length - 1]!;
  assert(lastHook.durBeats >= 1, `[seed ${seed}] hook line-end long note (last hook note ${lastHook.durBeats} beats)`);
}

// direct pitch-sequence check on the repeated hook line (seed 7)
{
  const hook = scores.get(7)!.sections.find((s) => s.kind === 'hook')!;
  // the two renditions of "Thinkin' 'bout you all night" are the first 2×N notes
  const lineNotes = 6; // thin·kin' + 'bout + you + all + night = 6 syllables
  const a = hook.notes.slice(0, lineNotes).map((n) => n.midi);
  const b = hook.notes.slice(lineNotes, lineNotes * 2).map((n) => n.midi);
  assert(a.length === lineNotes && b.length === lineNotes && a.join() === b.join(), `repeated hook line = identical pitch sequence (${a.map(midiNoteName).join(' ')})`);
}

// ---- 3: determinism — same seed identical, different seeds different --------
console.log('\n[3] determinism per seed');
{
  const again = composeMelody(BRIEF(7));
  assert(JSON.stringify(again) === JSON.stringify(scores.get(7)), 'same seed → deep-equal score');
  const s7 = JSON.stringify(scores.get(7));
  const s42 = JSON.stringify(scores.get(42));
  const s1337 = JSON.stringify(scores.get(1337));
  assert(s7 !== s42 && s42 !== s1337 && s7 !== s1337, 'different seeds → different scores (all three distinct)');
}

// ---- 4: negative controls — every validator actually bites ------------------
console.log('\n[4] validators bite (tampered scores fail for the right reason)');
{
  const base = scores.get(7)!;
  const clone = (): MelodyScore => JSON.parse(JSON.stringify(base)) as MelodyScore;

  const offKey = clone();
  offKey.sections[0]!.notes[0]!.midi += 1; // B minor has no C natural
  assert(scoreInKey(offKey) < 1, 'a chromatic note drops scoreInKey below 100%');

  const drifted = clone();
  const hook = drifted.sections.find((s) => s.kind === 'hook')!;
  hook.notes[1]!.midi += 2; // second rendition of the cell now differs from... the first — drift
  assert(!hookCellRepeats(drifted), 'a drifted hook cell fails hookCellRepeats');

  const overflow = clone();
  const v = overflow.sections[0]!;
  v.notes[v.notes.length - 1]!.durBeats = v.bars * 4; // sustains past the section edge
  assert(!sectionsFitBars(overflow), 'a note past the bars fails sectionsFitBars');

  const rushed = clone();
  for (const s of rushed.sections) for (const n of s.notes) if (n.anchor) n.startBeat += 0.27; // shove anchors off strong
  assert(anchorsOnStrongBeats(rushed) < 0.7, 'anchors shoved off the strong grid fail the prosody law');
}

// ---- 5: the taste layer ships and stays a garnish ---------------------------
console.log('\n[5] melodyBrain shipped in @afrohit/ai');
assert(typeof melodyBrain === 'function', 'melodyBrain exported (LLM picks phrasing only; on any failure this exact composer takes the take)');

// ---- 6: INSTRUMENTAL TOPLINE — a line-less section still gets a tune --------
// A pure instrumental (no lyrics) used to compose notes ONLY inside `if
// (lines.length)`, so a line-less section shipped `notes: []` — a beat with no
// melodic lead. Now a line-less section composes a hummable, in-key motif.
console.log('\n[6] instrumental topline (no lyric lines → a hummable in-key motif)');
{
  const instrumental = (seed: number): MelodyScore =>
    composeMelody({
      genre: 'afrobeats', bpm: 104, key: 'B minor', seed, swing: 0.56, syncopation: 0.7,
      sections: [
        { name: 'Intro', kind: 'intro', lines: [], bars: 8 },
        { name: 'Hook', kind: 'hook', lines: [], bars: 8 },
        { name: 'Verse', kind: 'verse', lines: [], bars: 8 },
      ],
    });
  const s = instrumental(7);
  const intro = s.sections.find((x) => x.kind === 'intro')!;
  const hook = s.sections.find((x) => x.kind === 'hook')!;
  const total = s.sections.reduce((a, x) => a + x.notes.length, 0);
  console.log(`  instrumental: ${total} notes (intro ${intro.notes.length}, hook ${hook.notes.length}), inKey=${(scoreInKey(s) * 100).toFixed(0)}%, span=${melodySpanSemitones(s)} semis`);
  assert(total > 0 && s.sections.every((x) => x.notes.length > 0), `every line-less section gets notes (total ${total})`);
  assert(scoreInKey(s) === 1, `instrumental topline is 100% in key (got ${(scoreInKey(s) * 100).toFixed(0)}%)`);
  assert(sectionsFitBars(s), 'instrumental topline fits its bars (no overflow)');
  assert(melodySpanSemitones(s) <= 14, `instrumental span ≤ 14 semitones (got ${melodySpanSemitones(s)})`);
  assert(anchorsOnStrongBeats(s) >= 0.7, 'instrumental prosody holds (no anchors → vacuously strong)');
  // hook denser + higher than a sparse intro (the earworm arrives)
  assert(hook.notes.length > intro.notes.length, `the hook is DENSER than the intro (${hook.notes.length} > ${intro.notes.length})`);
  // motif repetition: the hook's pitch cell recurs across its phrases (even
  // phrase count → the two halves carry identical pitches)
  const hookMidis = hook.notes.map((n) => n.midi);
  const half = hookMidis.length / 2;
  assert(half >= 2 && hookMidis.slice(0, half).join() === hookMidis.slice(half).join(), `the hook MOTIF repeats (cell ${hookMidis.slice(0, Math.min(4, half)).map(midiNoteName).join(' ')})`);
  // determinism per seed; different seeds diverge
  assert(JSON.stringify(instrumental(7)) === JSON.stringify(s), 'instrumental topline is deterministic per seed');
  assert(JSON.stringify(instrumental(42)) !== JSON.stringify(s), 'different seeds → different instrumental toplines');
  // NOT a scale run — the phrase breathes (call-and-response rests), not wall-to-wall
  const introSounding = intro.notes.reduce((a, n) => a + n.durBeats, 0);
  assert(introSounding < intro.bars * 4, `the intro BREATHES (sounding ${introSounding.toFixed(1)} of ${intro.bars * 4} beats — rests)`);
}

console.log(failures ? `\nmelody-brain: ${failures} FAILURE(S)` : '\nmelody-brain: all composition laws hold (composed, not guessed)');
process.exit(failures ? 1 : 0);

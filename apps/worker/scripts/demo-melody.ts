/** PROOF DEMO — a composed melody, printed note by note (human-readable
 *  evidence for the owner). Not a gate (test-melody-brain.ts asserts the
 *  laws); this shows WHAT the composer writes: note names + syllables +
 *  beats per section, then renders the audible sine guide when ffmpeg is
 *  installed (it is on the worker image; usually not on a dev box). */
import { composeMelody, scoreInKey, anchorsOnStrongBeats, hookCellRepeats, sectionsFitBars, melodySpanSemitones, midiNoteName } from '@afrohit/shared';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const score = composeMelody({
  genre: 'afrobeats',
  bpm: 104,
  key: 'B minor',
  seed: 20260711,
  swing: 0.56,
  syncopation: 0.7,
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
    { name: 'Pre-Hook', kind: 'prehook', lines: ['So I call your line one more time'] },
    {
      name: 'Hook', kind: 'hook',
      lines: [
        "Thinkin' 'bout you all night",
        "Thinkin' 'bout you all night",
        'All ni-i-ight oh oh',
        'You dey shine my light',
      ],
      anchors: ['night', 'light', 'you'],
    },
  ],
});

console.log(`MELODY SCORE — afrobeats · ${score.bpm} bpm · ${score.key} · seed ${score.seed}`);
console.log(`laws: inKey=${(scoreInKey(score) * 100).toFixed(0)}%  anchorsOnStrong=${(anchorsOnStrongBeats(score) * 100).toFixed(0)}%  hookCell=${hookCellRepeats(score) ? 'holds' : 'DRIFTED'}  fitsBars=${sectionsFitBars(score) ? 'yes' : 'NO'}  span=${melodySpanSemitones(score)} semis`);
for (const sec of score.sections) {
  console.log(`\n[${sec.name}] (${sec.kind}, ${sec.bars} bars, ${sec.notes.length} notes)`);
  for (const n of sec.notes) {
    const beat = `${n.startBeat.toFixed(2)}`.padStart(6);
    const dur = `${n.durBeats.toFixed(2)}`;
    console.log(`  beat ${beat}  ${midiNoteName(n.midi).padEnd(3)} (${String(n.midi).padStart(2)})  ${dur} beats  "${n.syllable}"${n.anchor ? '  ← ANCHOR (strong beat)' : ''}`);
  }
}

async function main() {
  const hasFfmpeg = await new Promise<boolean>((resolve) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
  if (!hasFfmpeg) {
    console.log('\nffmpeg not installed here — guide renders on the worker image');
    return;
  }
  const { renderMelodyGuide } = await import('../src/lib/melody-guide');
  const wav = await renderMelodyGuide(score);
  const out = join(tmpdir(), 'melody-guide.wav');
  await writeFile(out, wav);
  console.log(`\nmelody guide rendered → ${out} (${(wav.length / 1024).toFixed(0)} KB, mono 44.1k sine)`);
}

void main();

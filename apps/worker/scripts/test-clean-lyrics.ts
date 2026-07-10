import { cleanLyricsForMinimax } from '../../../packages/ai/src/providers/music';

const hook =
  '[Hook]\nNa the moonlight, we go dey dance free\nIf your heart dey call, I go answer baby\nNa the moonlight, we go dey dance free\nIf your heart dey call, I go answer baby\n';
const verse = (n: number) =>
  '[Verse ' + n + ']\n' + ('Line about love and light number ' + n + ' with plenty words to fill space\n').repeat(8);
const long =
  '[Intro]\nNa the night wey shine\n[Drum Fill]\n' +
  verse(1) + '\n' + hook + '\n' + verse(2) + '\n[Drum Fill]\n' + hook +
  '\n[Bridge]\n' + 'Obi m, if love na gamble I dey ready\n'.repeat(6) +
  '\n' + hook + '\n' + hook +
  '\n[Outro]\nGbera, make we roll am for this sweet night\nNa you wey sweet pass, no be lie\n';

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fail++;
};

console.log('input chars:', long.length);
const out = cleanLyricsForMinimax(long, 1800);
console.log('output chars (cap 1800):', out.length);
check('over-budget output fits cap', out.length <= 1800);
check('[Outro] survives (old code chopped it)', out.includes('[Outro]'));
check('interior hook repeats dropped, first+last kept', (out.match(/\[Hook\]/g) || []).length >= 2);
check('[Drum Fill] header never reaches the engine', !out.includes('Drum Fill'));
check('[Drum Fill] mapped to [Break] (transition intent kept)', out.includes('[Break]'));

const dir = cleanLyricsForMinimax('[Verse]\nreal line (drum roll — build up)\n(eh eh!) chant line\n[Percussion Solo]\nmore words\n');
check('stage-direction parenthetical stripped', !dir.includes('drum roll'));
check('singable ad-lib kept', dir.includes('(eh eh!)'));
check('invented production header handled', !dir.includes('Percussion Solo'));

const okTags = cleanLyricsForMinimax('[Pre Chorus]\nrising line\n[Build Up]\nchant\n[Verse 2]\nwords\n');
check('official MiniMax tags survive', okTags.includes('[Pre Chorus]') && okTags.includes('[Build Up]') && okTags.includes('[Verse 2]'));

const big = cleanLyricsForMinimax('la la la la la la\n'.repeat(600));
check('default cap now 3400 (was 2400)', big.length <= 3400 && big.length > 2400);

const short = cleanLyricsForMinimax('[Hook]\nshort song\n');
check('short lyric passthrough', short.includes('short song'));

console.log(fail === 0 ? '\nALL GREEN' : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);

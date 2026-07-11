/** PROOF DEMO — the groove doctrine as the assembly engine applies it.
 *  Not a gate (test-singing-brain asserts the function); this prints the
 *  human-readable receipt: timekeepers dead-on, hand percussion behind. */
import { grooveOffsetMs } from '@afrohit/shared';

const ROLES = ['kick', 'snare', 'clap', 'bass_guitar', 'sub_bass', 'log_drum', 'shaker', 'shekere', 'conga', 'bongo', 'talking_drum', 'agogo', 'cowbell', 'udu', 'closed_hat', 'open_hat', 'highlife_guitar', 'rhodes', 'piano', 'flute', 'sax'];
console.log('GROOVE DOCTRINE (ms behind the grid; 0 = timekeeper, dead-on):');
for (const r of ROLES) {
  const ms = grooveOffsetMs(r);
  console.log(`  ${r.padEnd(16)} ${String(ms).padStart(2)}ms${ms === 0 ? '  ← anchor (holds the grid)' : ''}`);
}
// The exact filter fragment each offset layer gets in assembleBeat:
console.log('\nffmpeg fragment per grooved layer: ,adelay=<ms>|<ms> (e.g. shaker → ,adelay=7|7)');
console.log('deterministic per role — the same beat assembles identically twice; capped ≤10ms (feel, never sloppiness)');

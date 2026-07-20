import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const create = readFileSync(new URL('../app/(app)/create/page.tsx', import.meta.url), 'utf8');
const drop = readFileSync(new URL('../components/DropMachine.tsx', import.meta.url), 'utf8');

// No mojibake in either file; the Create page also stays emoji-free (matching
// the onboarding gate). DropMachine keeps its pre-existing heading glyph.
for (const [name, source] of [['create', create], ['dropmachine', drop]]) {
  assert.doesNotMatch(source, /(?:Ã|â€|â€”|ðŸ)/, `${name} contains mojibake`);
}
assert.doesNotMatch(create, /\p{Extended_Pictographic}/u, 'create uses emoji text instead of interface icons');

// ── REAL PROGRESS: the fake poll-counter stage text is GONE, replaced by phase ─
// The Create page must no longer fabricate the "writing lyrics" step off a
// counter tick; it reads the server's real phase instead.
assert.doesNotMatch(create, /if \(i === 10\) setStepIdx\(2\)/, 'the fake counter stage must be removed');
assert.match(create, /const PHASE_STEP: Record<string, number>/);
assert.match(create, /const PHASE_LABEL: Record<string, string>/);
assert.match(create, /function applyPhase\(/);
assert.match(create, /applyPhase\(j\.phase\)/, 'the drop poll must drive the UI from the real phase');
assert.match(create, /applyPhase\(job\.phase\)/, 'the render poll must drive the UI from the real phase');
// The live line is rendered in the producing view.
assert.match(create, /\{liveStatus &&/);

// ── BED-FIRST: play the bed on bed_ready, hot-swap to the master on success ────
assert.match(create, /function playBedIfReady\(/);
assert.match(create, /phase !== 'bed_ready'/, 'bed play is gated on the bed_ready phase');
assert.match(create, /instrumental bed/, 'the bed is labeled honestly while it plays');
assert.match(create, /playBedIfReady\(job\.phase, job\.partial, title, bedPlayed\)/);
// The player remounts on URL change so the bed -> master swap loads cleanly.
assert.match(create, /key=\{nowPlaying\.url\}/);

// ── EARLY CHILD ID: watch the render child in the BACKGROUND the moment the drop
// announces it — the drop parent stays authoritative (so the server's auto
// re-sing fallback is never misread as a failure). ─────────────────────────────
assert.match(create, /async function watchRenderChild\(/);
assert.match(create, /void watchRenderChild\(/, 'the child watcher must be started in the background');
assert.match(create, /j\.phase === 'render_queued'/);
assert.match(create, /p\?\.renderJobId/);
// Non-authoritative: a child FAILED here is silent (the drop parent reports it).
assert.match(create, /silent - the drop parent is authoritative|silent — the drop parent is authoritative/);
// The drop parent remains the real success/failure signal.
assert.match(create, /if \(dropFailed\) throw new Error/);

// ── ANTICIPATORY PRE-WARM: debounced, deduped, $0 own-kit hint on genre pick ──
assert.match(create, /const prewarmLane = \(g: string\) =>/);
assert.match(create, /\/prewarm\?genre=/);
assert.match(create, /prewarmedRef\.current\.has\(g\)/, 'prewarm must fire at most once per genre per session');
assert.match(create, /setTimeout\([\s\S]*?\}, 600\)/, 'prewarm must be debounced');
assert.match(create, /prewarmLane\(g\);/, 'picking a genre must warm that lane');
// It is speculative: an error must be swallowed, never surfaced.
assert.match(create, /\/prewarm[\s\S]{0,120}\.catch\(/);

// ── DropMachine: real phase text, no fabricated counter buckets ────────────────
assert.match(drop, /const DROP_PHASE_LABEL: Record<string, string>/);
assert.match(drop, /j\.phase \? DROP_PHASE_LABEL\[j\.phase\]/);
assert.doesNotMatch(drop, /i < 24\s*\n?\s*\?/, 'the fabricated i<24/i<96 stage buckets must be gone');
assert.doesNotMatch(drop, /Ranking the takes & queueing the renders/, 'counter-derived stage copy removed');

console.log('streaming UX: real-phase progress, bed-first, early child id, prewarm — PASS');

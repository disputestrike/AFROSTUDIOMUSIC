/**
 * TRAINING-ISOLATION GATE — proves "have my beats been used?" has laws, not
 * vibes (GPT-audit demand): a trained amapiano reference shapes the next
 * AMAPIANO render's selection and NEVER leaks into afrobeats; the pinned
 * just-listened reference always leads; the artist's real uploads outrank
 * self-training rows; Zap lessons ground a lane as FACTS, never as the
 * artist's own audio. Runs on the pure selection core (learned-select.ts) the
 * API delegates to — same code path, no DB needed. Exit 1 on any regression.
 */
import { selectLearnedRefs, learnedGenreMatches, referenceOrigin, groundingOf } from '@afrohit/shared';

let failures = 0;
const fail = (m: string) => { console.error(`FAIL: ${m}`); failures++; };

type Row = { id: string; genre: string | null; generated: boolean };
const rows: Row[] = [
  { id: 'ama-own-1', genre: 'amapiano', generated: false }, // newest first
  { id: 'ama-own-2', genre: 'Amapiano (SA)', generated: false }, // free-text variant
  { id: 'ama-self-1', genre: 'amapiano', generated: true },
  { id: 'ama-self-2', genre: 'amapiano', generated: true },
  { id: 'afb-own-1', genre: 'afrobeats', generated: false },
  { id: 'fusion-own', genre: 'Afro Fusion', generated: false },
  { id: 'nogenre', genre: null, generated: false },
];

// ---- 1: LANE ISOLATION — amapiano training never leaks into afrobeats ------
const ama = selectLearnedRefs(rows, 'amapiano');
if (!ama.some((r) => r.id === 'ama-own-1')) fail('amapiano render did not use the trained amapiano reference');
if (ama.some((r) => r.id === 'afb-own-1' || r.id === 'fusion-own')) fail(`amapiano selection leaked another lane: ${ama.map((r) => r.id).join(',')}`);
const afb = selectLearnedRefs(rows, 'afrobeats');
if (afb.some((r) => r.id.startsWith('ama-'))) fail(`afrobeats selection leaked amapiano training: ${afb.map((r) => r.id).join(',')}`);
if (!afb.some((r) => r.id === 'afb-own-1')) fail('afrobeats render did not use its own trained reference');

// ---- 2: tolerant matching — historical free-text rows still retrieve -------
if (!ama.some((r) => r.id === 'ama-own-2')) fail("free-text 'Amapiano (SA)' row failed to retrieve for amapiano");
if (!learnedGenreMatches('Afro Fusion', 'afro_fusion')) fail("'Afro Fusion' must match afro_fusion");
if (learnedGenreMatches(null, 'amapiano') || learnedGenreMatches('amapiano', '')) fail('empty genres must never match');

// ---- 3: the artist outranks the machine — self rows are seasoning only -----
const selfCount = ama.filter((r) => r.generated).length;
if (selfCount > 1) fail(`selection carries ${selfCount} self-training rows (max 1 — the artist's real sound leads)`);
if (ama.findIndex((r) => r.generated) !== -1 && ama.findIndex((r) => r.generated) < ama.findIndex((r) => !r.generated)) {
  fail('a self-training row outranked the artist’s real reference');
}

// ---- 4: PIN WINS — the just-listened reference leads even cross-lane -------
const pinned = selectLearnedRefs(rows, 'amapiano', 'afb-own-1');
if (pinned[0]?.id !== 'afb-own-1') fail('pinned reference must LEAD the selection (artist’s explicit intent)');
if (pinned.length > 4) fail('selection must never exceed 4 refs');

// ---- 4b: ROTATION — the whole lake teaches, not just the newest 3 ----------
// (The owner caught it: 184 of 191 references measured but never used — the
// seedless pick was the newest 3 forever.) Seeded picks must (a) stay in-lane,
// (b) differ across seeds, (c) cover most of the pool over many seeds, and
// (d) seedless behavior stays byte-identical for replays.
const bigLake: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: `ama-own-${i}`, genre: 'amapiano', generated: false }));
const seen = new Set<string>();
const combos = new Set<string>();
for (let seed = 0; seed < 24; seed++) {
  const picks = selectLearnedRefs(bigLake, 'amapiano', undefined, { varietySeed: seed });
  if (picks.length !== 3) fail(`seeded selection returned ${picks.length} real refs (wanted 3)`);
  if (new Set(picks.map((r) => r.id)).size !== picks.length) fail('seeded selection returned duplicate refs');
  if (picks.some((r) => !r.id.startsWith('ama-'))) fail('seeded rotation leaked another lane');
  picks.forEach((r) => seen.add(r.id));
  combos.add(picks.map((r) => r.id).join(','));
}
if (seen.size < 10) fail(`rotation only ever used ${seen.size}/12 refs across 24 seeds — the lake must cycle`);
if (combos.size < 6) fail(`rotation produced only ${combos.size} distinct combinations across 24 seeds`);
const legacy = selectLearnedRefs(bigLake, 'amapiano');
if (legacy.map((r) => r.id).join(',') !== 'ama-own-0,ama-own-1,ama-own-2') fail('seedless selection must stay the legacy newest-3 (replays depend on it)');

// ---- 5: Zap origin — chart lessons are FACTS, never the artist's audio -----
if (referenceOrigin('zap:asake-lonely-at-the-top', { source: 'zap' }) !== 'facts-only') fail("zap rows must classify facts-only, not owned-upload");
if (referenceOrigin('https://r2.example/own.wav', {}, 'user-attested') !== 'owned-upload') fail('an attested owned upload must stay owned-upload');
if (referenceOrigin('https://unknown.example/audio.wav', {}) !== 'unknown') fail('unknown provenance must not be promoted to owned-upload');
if (referenceOrigin('facts:manual-entry', {}) !== 'facts-only') fail('facts: rows must stay facts-only');
if (referenceOrigin('https://r2.example/render.wav', { source: 'generated' }) !== 'self-generated') fail('self rows must stay self-generated');
// Grounding math: 2 zap-facts + 1 owned = grounded; 3 self alone never grounds.
const g1 = groundingOf([{ origin: 'facts-only' }, { origin: 'facts-only' }, { origin: 'owned-upload' }]);
if (!g1.grounded) fail('2 facts + 1 owned must ground a lane');
const g2 = groundingOf([{ origin: 'self-generated' }, { origin: 'self-generated' }, { origin: 'self-generated' }]);
if (g2.grounded) fail('self-generated rows alone must NEVER ground a lane (feedback loop)');

if (failures) { console.error(`training-isolation: ${failures} failure(s)`); process.exit(1); }
console.log('training-isolation: lane isolation + pin-first + artist-over-machine + zap=facts — all enforced');

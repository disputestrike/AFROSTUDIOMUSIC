import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeGenre,
  prewarmIdempotencyKey,
  computePrewarmPlan,
} from '../src/lib/prewarm';

// ── PREWARM: idempotent per (workspace, genre, day) + own-engine $0 only ──────

// The key normalizes the genre and is scoped to the UTC day: the same lane on
// the same day is one key (so a chip hovered/tapped repeatedly forges once),
// different lanes/days are different keys.
assert.equal(normalizeGenre('  Afro Beats '), 'afro_beats');
const day = new Date('2026-07-20T09:00:00.000Z');
assert.equal(prewarmIdempotencyKey('amapiano', day), 'prewarm:amapiano:2026-07-20');
assert.equal(
  prewarmIdempotencyKey('Amapiano', day),
  prewarmIdempotencyKey('amapiano', day),
  'genre normalization must make the idempotency key stable across casing'
);
assert.notEqual(
  prewarmIdempotencyKey('amapiano', day),
  prewarmIdempotencyKey('afrobeats', day),
  'different lanes must be different keys'
);
assert.notEqual(
  prewarmIdempotencyKey('amapiano', new Date('2026-07-20T23:59:59Z')),
  prewarmIdempotencyKey('amapiano', new Date('2026-07-21T00:00:01Z')),
  'a new UTC day must be a new key'
);

// PURE PLAN: an empty shelf needs every own-engine kit role forged; the plan is
// not "ready" yet. The wanted roles come only from the own-engine kit taxonomy
// (kitRolesFor) — never a paid provider hook.
const emptyPlan = computePrewarmPlan([], 'afrobeats', 103, 'F', [], 'seed-key');
assert.ok(emptyPlan.wanted.length > 0, 'a real lane wants a non-empty kit');
assert.equal(
  emptyPlan.missing.length,
  emptyPlan.wanted.length,
  'an empty shelf is missing every wanted role'
);
assert.equal(emptyPlan.coverageReady, false, 'an empty shelf is not render-ready');
for (const role of emptyPlan.wanted) {
  assert.equal(typeof role, 'string');
  assert.doesNotMatch(
    role,
    /suno|minimax|ace[-_ ]?step|eleven|provider/i,
    'prewarm must only ever forge own-engine kit roles, never a paid provider hook'
  );
}

// ── SOURCE CONTRACTS ──────────────────────────────────────────────────────────

const prewarmSrc = readFileSync(new URL('../src/lib/prewarm.ts', import.meta.url), 'utf8');
// Own-engine $0 forge path only: the material kind + the forge-material job, and
// the prepaid flag ($0 to the user). It must NEVER charge or call a paid hook.
assert.match(prewarmSrc, /kind: 'prewarm'/);
assert.match(prewarmSrc, /kind: 'material'/);
assert.match(prewarmSrc, /jobName: 'forge-material'/);
assert.match(prewarmSrc, /prepaid: true/);
assert.match(prewarmSrc, /idempotencyKey/);
assert.doesNotMatch(prewarmSrc, /chargeCredits|generate_hooks|score_hooks/);
// The budget guard: with no workspace engine there is nothing free to forge.
assert.match(prewarmSrc, /musicProvider|musicApiKey/);
assert.match(prewarmSrc, /no_engine/);

const jobEventsSrc = readFileSync(new URL('../src/lib/job-events.ts', import.meta.url), 'utf8');
// emitJobEvent is FAIL-SOFT (swallows) so it can never throw into a render.
assert.match(jobEventsSrc, /export async function emitJobEvent/);
assert.match(jobEventsSrc, /try\s*{[\s\S]*jobEvent\.create[\s\S]*}\s*catch/);
// The tail read is a since-cursor, ordered oldest -> newest; latest is desc.
assert.match(jobEventsSrc, /seq:\s*{\s*gt:\s*since\s*}/);
assert.match(jobEventsSrc, /orderBy:\s*{\s*seq:\s*'asc'\s*}/);
assert.match(jobEventsSrc, /orderBy:\s*{\s*seq:\s*'desc'\s*}/);

const jobsRouteSrc = readFileSync(new URL('../src/routes/jobs.ts', import.meta.url), 'utf8');
// GET /jobs/:id folds the newest event in as {phase, partial}; a dedicated tail
// endpoint serves ?since=<seq>.
assert.match(jobsRouteSrc, /phase:\s*latest\?\.phase/);
assert.match(jobsRouteSrc, /partial:\s*latest\?\.payload/);
assert.match(jobsRouteSrc, /"\/:id\/events"/);
assert.match(jobsRouteSrc, /req\.query\.since/);

// ── DROP: the render child id is surfaced EARLY (before the batch is terminal) ─
const dropSrc = readFileSync(new URL('../src/routes/drop.ts', import.meta.url), 'utf8');
assert.match(dropSrc, /emitJobEvent\(dropJobId, 'hooks_done'/);
assert.match(dropSrc, /emitJobEvent\(dropJobId, 'lyrics_done'/);
assert.match(dropSrc, /emitJobEvent\(dropJobId, 'render_queued'/);
assert.match(dropSrc, /renderJobId: beat\.jobId/);
// The early emit must sit BEFORE waitForDropChildren blocks on the whole batch —
// this is the structural unblocker for bed-first streaming.
const queuedEmitAt = dropSrc.indexOf("emitJobEvent(dropJobId, 'render_queued'");
const waitAt = dropSrc.indexOf('directChildren = await waitForDropChildren');
assert.ok(queuedEmitAt > 0 && waitAt > 0, 'both the early emit and the batch wait must exist');
assert.ok(
  queuedEmitAt < waitAt,
  'the render child id must be emitted BEFORE waitForDropChildren blocks on the batch'
);

console.log('streaming events + prewarm: PASS');

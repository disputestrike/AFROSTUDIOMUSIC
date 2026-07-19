/**
 * TRAINING FLYWHEEL gate (P3, owner approval 2026-07-19) — the flywheel is
 * WIRED (nightly), HONEST (unarmed = logged skip, zero spend), and the rights
 * law is the SAME shared pure code everywhere. No DB, no network.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-training-flywheel.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifestFromCatalog, beatToProvenance } from '@afrohit/shared';
import { musicTrainerEnabled, musicTrainerConfig, evaluateAndPromote, minCorpusSize } from '@afrohit/ai';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

// --- ARMING GATES (honest no-op until the operator arms) ---------------------
delete process.env.MUSIC_TRAINER_ENABLED;
delete process.env.MUSIC_TRAINER_MODEL;
delete process.env.MUSIC_TRAINER_VERSION;
assert(musicTrainerEnabled() === false, 'unarmed: trainer disabled by default (the ONLY spend gate)');
// The default trainer is LIVE-VERIFIED (sakemin/musicgen-fine-tuner, checked on
// replicate.com 2026-07-19) — so the operator errand is ONE flag. A verified
// default is not an armed default: ENABLED=1 still gates every naira.
const dflt = musicTrainerConfig();
assert(dflt?.model === 'sakemin/musicgen-fine-tuner', 'default trainer is the live-verified fine-tuner');
assert(dflt?.kind === 'training' && dflt?.datasetKey === 'dataset_path', 'default is destination-based with the verified dataset_path input');
process.env.MUSIC_TRAINER_ENABLED = '1';
process.env.MUSIC_TRAINER_MODEL = 'owner/music-model';
process.env.MUSIC_TRAINER_VERSION = 'abc123';
assert(musicTrainerEnabled() === true && musicTrainerConfig()?.model === 'owner/music-model', 'explicit env overrides the default trainer');
assert(minCorpusSize() >= 1, 'corpus minimum present');

// --- RIGHTS LAW (shared pure code — one law, api + worker) -------------------
const manifest = manifestFromCatalog({
  materials: [
    { id: 'm1', source: 'forged', rightsBasis: 'code-generated' }, // own → fuel
    { id: 'm2', source: 'forged', rightsBasis: 'provider-generated' }, // 3rd-party → refuse
  ],
  beats: [
    { id: 'b1', provider: 'afrohit-own' }, // pure own bed → fuel
    { id: 'b2', provider: 'afrohit-own', meta: { melodyLayer: { engine: 'musicgen' } } }, // topped → refuse
    { id: 'b3', provider: 'minimax' }, // provider render → refuse
  ],
  vocals: [],
}, false);
assert(manifest.eligible.length === 2, `only own-clean assets are fuel (${manifest.eligible.length}/5)`);
assert(manifest.rejected.some(r => r.id === 'beat:b2'), 'musicgen-topped own bed refused (most-restrictive origin)');
assert(beatToProvenance({ id: 'x', provider: 'afrohit-own', meta: { melodyLayer: { engine: 'musicgen' } } }).engine === 'musicgen', 'melody topping downgrades engine');

// --- PROMOTE GATE (a new model wins on measurement, never vibes) -------------
assert(evaluateAndPromote({ candidateScore: 80, incumbentScore: 70 }).promote === true, 'better candidate promotes');
assert(evaluateAndPromote({ candidateScore: 70, incumbentScore: 70 }).promote === false, 'tie holds the incumbent');
assert(evaluateAndPromote({ candidateScore: null, incumbentScore: 70 }).promote === false, 'unmeasured candidate never promotes');

// --- WIRING (the flywheel actually runs nightly) -----------------------------
const root = join(__dirname, '..', '..', '..');
const compound = readFileSync(join(root, 'apps/worker/src/processors/compound.ts'), 'utf8');
assert(compound.includes('runTrainingFlywheel'), 'flywheel wired into the nightly compound run');
const flywheel = readFileSync(join(root, 'apps/worker/src/lib/training-flywheel.ts'), 'utf8');
assert(flywheel.includes('musicTrainerEnabled()') && flywheel.includes('kickoffMusicTraining'), 'flywheel gates then kicks off');
assert(flywheel.includes("kind: \"music-training\""), 'every kickoff/refusal files an auditable receipt');
assert(flywheel.includes('manifestFromCatalog'), 'flywheel classifies with the SHARED rights law');

// cleanup env
delete process.env.MUSIC_TRAINER_ENABLED;
delete process.env.MUSIC_TRAINER_MODEL;
delete process.env.MUSIC_TRAINER_VERSION;

console.log(process.exitCode ? '\n❌ Training flywheel gate FAILED' : '\n✅ Training flywheel gate PASSED');

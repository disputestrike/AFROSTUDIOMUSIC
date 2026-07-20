/**
 * TRAINING FLYWHEEL gate (P3, owner approval 2026-07-19) — the flywheel is
 * WIRED (nightly), HONEST (unarmed = logged skip, zero spend), and the rights
 * law is the SAME shared pure code everywhere. No DB, no network.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-training-flywheel.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifestFromCatalog, beatToProvenance, resolveTrainingConsent, TRAINING_LICENSE_VERSION } from '@afrohit/shared';
import { musicTrainerEnabled, musicTrainerConfig, evaluateAndPromote, minCorpusSize } from '@afrohit/ai';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

// --- ARMING GATES (honest no-op until the operator arms) ---------------------
delete process.env.MUSIC_TRAINER_ENABLED;
delete process.env.MUSIC_TRAINER_MODEL;
delete process.env.MUSIC_TRAINER_VERSION;
delete process.env.MUSIC_TRAINER_EXTRA_INPUT;
assert(musicTrainerEnabled() === false, 'unarmed: trainer disabled by default (the ONLY spend gate)');
// The default trainer is LIVE-VERIFIED (sakemin/musicgen-fine-tuner, checked on
// replicate.com 2026-07-19) — so the operator errand is ONE flag. A verified
// default is not an armed default: ENABLED=1 still gates every naira.
const dflt = musicTrainerConfig();
assert(dflt?.model === 'sakemin/musicgen-fine-tuner', 'default trainer is the live-verified fine-tuner');
assert(dflt?.version === 'b1ec6490e57013463006e928abc7acd8d623fe3e8321d3092e1231bf006898b1', 'default trainer pins the documented fine-tuning version');
assert(dflt?.kind === 'training' && dflt?.datasetKey === 'dataset_path', 'default is destination-based with the verified dataset_path input');
assert(
  dflt?.extraInput.model_version === 'small' &&
    dflt?.extraInput.batch_size === 8 &&
    dflt?.extraInput.epochs === 1 &&
    dflt?.extraInput.updates_per_epoch === 25 &&
    dflt?.extraInput.drop_vocals === false,
  'default trainer uses the cheapest memory-safe MusicGen settings'
);
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

// --- THE CONSENT DOOR (audit root defect, fixed 2026-07-19) ------------------
// A granted workspace's user-original catalog becomes fuel; ungranted stays out.
const ownerCatalog = {
  materials: [{ id: 'm-owner', source: 'artist_stem', rightsBasis: 'user-attested' }],
  beats: [
    // uploaded instrumental with the ownership vouch in meta (used to be 'unknown')
    { id: 'b-import', provider: 'import', meta: { sourceMeta: { rightsBasis: 'user-attested' } } },
  ],
  vocals: [{ id: 'v-take', performanceSource: 'artist_import' }],
};
const doorClosed = manifestFromCatalog(ownerCatalog, false);
assert(doorClosed.eligible.length === 0, 'door closed: owner catalog rejected (fail-closed)');
const doorOpen = manifestFromCatalog(ownerCatalog, true);
assert(doorOpen.eligible.length === 3, `door open: owner masters+import+take all train (${doorOpen.eligible.length}/3)`);
assert(doorOpen.eligible.some(e => e.id === 'beat:b-import'), 'attested uploaded instrumental classifies user-original (vouch now READ)');
// INGREDIENT LAW (owner "why only 38?" 2026-07-19): an assembled bed
// (provider 'material') rates by its DIRTIEST ingredient loop.
const allOwn = beatToProvenance({ id: 'a1', provider: 'material', ingredientRights: ['code-generated', 'self-generated'] });
assert(allOwn.rightsBasis === 'self-generated', 'all-own ingredients -> own bed (was UNKNOWN/refused before)');
const dirty = beatToProvenance({ id: 'a2', provider: 'material', ingredientRights: ['code-generated', 'provider-generated'] });
assert(dirty.rightsBasis === 'provider-generated', 'one provider-generated loop poisons the whole bed');
const attestedMix = beatToProvenance({ id: 'a3', provider: 'material', ingredientRights: ['code-generated', 'user-attested'] });
assert(attestedMix.rightsBasis === 'user-attested', 'a user-attested loop makes the bed consent-gated');
const unresolvable = beatToProvenance({ id: 'a4', provider: 'material', ingredientRights: ['code-generated', null] });
assert(unresolvable.rightsBasis === undefined && unresolvable.engine === 'material', 'an unresolvable ingredient fails the bed closed');
const ingredientManifest = manifestFromCatalog({
  materials: [], vocals: [],
  beats: [
    { id: 'ib-own', provider: 'material', ingredientRights: ['code-generated', 'self-generated'] },
    { id: 'ib-dirty', provider: 'material', ingredientRights: ['provider-generated'] },
  ],
}, false);
assert(ingredientManifest.eligible.some(e => e.id === 'beat:ib-own') && ingredientManifest.eligible.length === 1, 'own-ingredient bed trains without consent; dirty bed never does');

// The vouch never overrides a third-party topping (most-restrictive still wins).
const smuggled = manifestFromCatalog({
  materials: [], vocals: [],
  beats: [{ id: 'b-smuggle', provider: 'import', meta: { sourceMeta: { rightsBasis: 'user-attested' }, melodyLayer: { engine: 'musicgen' } } }],
}, true);
assert(smuggled.eligible.length === 0, 'vouch cannot launder a musicgen-topped bed');
// The recorded-grant resolver: fail-closed on revoke/missing, honors current version.
assert(resolveTrainingConsent(null).granted === false, 'no record -> no grant');
assert(resolveTrainingConsent({ version: TRAINING_LICENSE_VERSION, acceptedAt: new Date(), revokedAt: new Date() }).granted === false, 'revoked -> no grant');
const ok = resolveTrainingConsent({ version: TRAINING_LICENSE_VERSION, acceptedAt: new Date() });
assert(ok.granted === true && ok.current === true, 'valid current grant resolves');

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
assert(flywheel.includes('consentedWorkspaceIds') && flywheel.includes('resolveTrainingConsent'), 'flywheel resolves PER-WORKSPACE recorded grants (the consent door)');
assert(flywheel.includes('trainingConsentSnapshot') && flywheel.includes('consentSnapshotHash'), 'training receipts bind current consent records to the exact dataset');
assert(flywheel.includes('unboundUserAssets'), 'user-original assets without a persisted current grant fail closed');

// cleanup env
delete process.env.MUSIC_TRAINER_ENABLED;
delete process.env.MUSIC_TRAINER_MODEL;
delete process.env.MUSIC_TRAINER_VERSION;

console.log(process.exitCode ? '\n❌ Training flywheel gate FAILED' : '\n✅ Training flywheel gate PASSED');

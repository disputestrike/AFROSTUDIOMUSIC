/**
 * TRAINING CAPTURE — "see the music" proof (2026-07-18).
 * The pure catalog→manifest mapper, on real-catalog-shaped fixtures (no DB), so
 * we KNOW what the live admin manifest will classify before it ships.
 */
import assert from 'node:assert/strict';
import {
  materialToProvenance,
  beatToProvenance,
  vocalToProvenance,
  manifestFromCatalog,
} from '../src/lib/training-capture';

// mappers stamp a type-prefixed id + the right provenance field
assert.equal(materialToProvenance({ id: 'm1', source: 'forged', rightsBasis: 'code-generated' }).id, 'material:m1');
assert.equal(beatToProvenance({ id: 'b1', provider: 'minimax' }).engine, 'minimax');
assert.equal(vocalToProvenance({ id: 'v1', performanceSource: 'artist_upload' }).performanceSource, 'artist_upload');

// RIGHTS LINE (owner incident 2026-07-19): an "afrohit-own" bed that carries a
// THIRD-PARTY melody topping (meta.melodyLayer.engine, e.g. musicgen mixed in)
// must classify by the MOST RESTRICTIVE origin — third-party, never trainable.
assert.equal(
  beatToProvenance({ id: 'b2', provider: 'afrohit-own', meta: { melodyLayer: { engine: 'musicgen' } } }).engine,
  'musicgen',
  'musicgen melody topping downgrades an own bed to third-party'
);
assert.equal(
  beatToProvenance({ id: 'b3', provider: 'afrohit-own', meta: { assembly: 'log' } }).engine,
  'afrohit-own',
  'a pure own bed (no melody topping) stays own'
);

// a realistic catalog snapshot — mixed origins, consent OFF first
const catalog = {
  materials: [
    { id: 'm-own', source: 'forged', rightsBasis: 'code-generated' }, // own → train
    { id: 'm-lic', source: 'artist_stem', rightsBasis: 'licensed' }, // licensed → train
    { id: 'm-usr', source: 'artist_stem', rightsBasis: 'user-attested' }, // user → consent-gated
    { id: 'm-prov', source: 'forged', rightsBasis: 'provider-generated' }, // third-party → refuse
  ],
  beats: [
    { id: 'b-own', provider: 'own_engine' }, // own → train
    { id: 'b-mm', provider: 'minimax' }, // third-party → refuse
    { id: 'b-suno', provider: 'suno' }, // bridge → refuse
  ],
  vocals: [
    { id: 'v-up', performanceSource: 'artist_upload' }, // user → consent-gated
    { id: 'v-rvc', performanceSource: 'voice_conversion' }, // own RVC → train
    { id: 'v-sep', performanceSource: 'stem_separation' }, // unknown → refuse
  ],
};

// consent OFF: own(3) + licensed(1) train; the 2 user-original are refused
const noConsent = manifestFromCatalog(catalog, false);
assert.equal(noConsent.eligible.length, 4, 'consent OFF: 3 own + 1 licensed train (user-original held)');
assert.equal(noConsent.counts.byOrigin['third-party-render'], 3, 'the 3 third-party assets counted');
assert.equal(noConsent.counts.byOrigin['user-original'], 2, 'both user-original assets classified');
assert.ok(noConsent.rejected.some((r) => /consent/i.test(r.reason)), 'user-original refused for missing consent');
assert.ok(noConsent.rejected.some((r) => /ToS|third-party/i.test(r.reason)), 'third-party refused for ToS');

// consent ON (ToS accepted): the 2 user-original now train too → 6 total
const withConsent = manifestFromCatalog(catalog, true);
assert.equal(withConsent.eligible.length, 6, 'consent ON: user-original joins the trainable set');
assert.equal(withConsent.counts.total, 10, 'all 10 catalog rows accounted for');
assert.equal(
  withConsent.eligible.length + withConsent.rejected.length,
  withConsent.counts.total,
  'nothing silently dropped'
);

console.log('training-capture: real-catalog snapshot classified correctly — own/licensed/live train, third-party refused, user-original consent-gated.');
console.log('consent OFF →', JSON.stringify(noConsent.counts.byOrigin), '| trainable', noConsent.eligible.length);
console.log('consent ON  →', 'trainable', withConsent.eligible.length, 'of', withConsent.counts.total);

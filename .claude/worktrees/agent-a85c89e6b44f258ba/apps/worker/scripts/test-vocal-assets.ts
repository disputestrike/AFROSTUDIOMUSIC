import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMixableVocal, scoreLyricAudioAlignment, selectDefaultSessionAssets } from '@afrohit/shared';

const hash = 'a'.repeat(64);
const verifiedAt = new Date('2026-07-13T00:00:00Z');
const passed = {
  approved: true,
  assetKind: 'isolated_vocal',
  qualityState: 'passed',
  contentHash: hash,
  verifiedAt,
};

assert.equal(isMixableVocal(passed), true);
for (const patch of [
  { approved: false },
  { assetKind: 'spoken_guide' },
  { assetKind: 'full_mix' },
  { qualityState: 'unmeasured' },
  { qualityState: 'failed' },
  { contentHash: null },
  { contentHash: 'short' },
  { verifiedAt: null },
]) {
  assert.equal(isMixableVocal({ ...passed, ...patch }), false, JSON.stringify(patch));
}

const selected = selectDefaultSessionAssets(
  [
    { id: 'beat-old', createdAt: '2026-07-01T00:00:00Z' },
    { id: 'beat-new', createdAt: '2026-07-02T00:00:00Z' },
  ],
  [
    { id: 'lead-old', role: 'lead', createdAt: '2026-07-01T00:00:00Z', ...passed },
    { id: 'lead-new', role: 'lead', createdAt: '2026-07-03T00:00:00Z', ...passed },
    { id: 'harmony', role: 'harmony', createdAt: '2026-07-02T00:00:00Z', ...passed },
    { id: 'speech', role: 'lead', createdAt: '2026-07-04T00:00:00Z', ...passed, assetKind: 'spoken_guide' },
    { id: 'full-remix', role: 'lead', createdAt: '2026-07-05T00:00:00Z', ...passed, assetKind: 'full_mix' },
  ],
);
assert.deepEqual(selected.beats.map((beat) => beat.id), ['beat-new']);
assert.deepEqual(selected.vocals.map((vocal) => vocal.id), ['lead-new', 'harmony']);

const expectedLyric = `[Hook]
Jẹ́ ká jó, no rush this song
Pepper kiss, e dey burn slow
[Verse 1]
I carry my love come your door
You tell me make I give you more`;
const matchingTake = scoreLyricAudioAlignment(
  expectedLyric,
  'Je ka jo no rush this song, pepper kiss e dey burn slow. I carry my love come your door, you tell me make I give you more.',
);
assert.equal(matchingTake.pass, true, JSON.stringify(matchingTake));
const wrongTake = scoreLyricAudioAlignment(
  expectedLyric,
  'Tonight we drive to the city, raise every glass and forget what we came for.',
);
assert.equal(wrongTake.pass, false);
assert.ok(wrongTake.failures.includes('lyric_identity_mismatch'));
assert.equal(scoreLyricAudioAlignment(expectedLyric, '').pass, false);

const repo = join(process.cwd(), '..', '..');
const schema = readFileSync(join(repo, 'packages/db/prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  join(repo, 'packages/db/prisma/migrations/20260713040000_vocal_asset_truth/migration.sql'),
  'utf8',
);
const vocalsRoute = readFileSync(join(repo, 'apps/api/src/routes/vocals.ts'), 'utf8');
const mixerRoute = readFileSync(join(repo, 'apps/api/src/routes/mixer.ts'), 'utf8');
const mixWorker = readFileSync(join(repo, 'apps/worker/src/processors/mix.ts'), 'utf8');
const speechWorker = readFileSync(join(repo, 'apps/worker/src/processors/voice.ts'), 'utf8');
const singWorker = readFileSync(join(repo, 'apps/worker/src/processors/voice-sing.ts'), 'utf8');
const datasetWorker = readFileSync(join(repo, 'apps/worker/src/processors/voice-dataset.ts'), 'utf8');
const musicWorker = readFileSync(join(repo, 'apps/worker/src/processors/music.ts'), 'utf8');
const beatInspector = readFileSync(join(repo, 'apps/worker/src/processors/beat-inspect.ts'), 'utf8');

assert.match(schema, /model VoiceDataset/);
assert.match(schema, /assetKind\s+String\s+@default\("isolated_vocal"\)/);
assert.match(schema, /qualityState\s+String\s+@default\("unmeasured"\)/);
assert.match(schema, /assetKind\s+String\s+@default\("instrumental"\)/);
assert.match(schema, /voiceDatasetId\s+String\?/);
assert.match(migration, /WHERE "assetKind" <> 'isolated_vocal'/);
assert.match(migration, /WHERE "assetKind" = 'full_mix'/);
assert.match(vocalsRoute, /performance_source_required/);
assert.doesNotMatch(vocalsRoute, /chargeCredits/);
assert.match(mixerRoute, /assetKind:\s*'isolated_vocal'/);
assert.match(mixerRoute, /assetKind:\s*'instrumental'/);
assert.match(mixerRoute, /qualityState:\s*'passed'/);
assert.match(mixWorker, /mix_qc_failed/);
assert.match(mixWorker, /tx\.providerJob\.update/);
assert.match(speechWorker, /assetKind:\s*'spoken_guide'/);
assert.match(singWorker, /tx\.vocalRender\.create[\s\S]*assetKind:\s*['"]isolated_vocal['"]/);
assert.doesNotMatch(singWorker, /vocalRender\.create[\s\S]{0,1000}fullRemix/);
assert.match(datasetWorker, /voiceDataset\.upsert/);
const datasetReceiptIndex = datasetWorker.indexOf('dataset = await prisma.voiceDataset.update');
const sourcePurgeIndex = datasetWorker.indexOf('sourcePurge.failedRefs = await purgeRefs');
assert.ok(datasetReceiptIndex >= 0, 'dataset purge intent must be durable');
assert.ok(
  sourcePurgeIndex > datasetReceiptIndex,
  'raw samples must only be purged after the dataset receipt is durable',
);
assert.match(datasetWorker, /MIN_USABLE_SECONDS/);
assert.match(datasetWorker, /processVoiceDatasetPurgeBackfill/);
assert.match(datasetWorker, /purgeSourceSamples/);
assert.match(datasetWorker, /tx\.providerJob\.update/);
assert.match(beatInspector, /assetKind !== 'instrumental'/);
assert.match(musicWorker, /scoreLyricAudioAlignment/);
assert.match(musicWorker, /VOCAL_ALIGNMENT_REQUIRED/);
assert.match(musicWorker, /assetKind: wantsVocals \? 'full_mix' : 'instrumental'/);
assert.equal(existsSync(join(repo, 'packages/ai/src/singing-synth.ts')), false);

console.log('vocal asset truth + mixer selection: PASS');

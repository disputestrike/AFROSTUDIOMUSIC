import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bindAlbumDropInput,
  selectCertifiedAlbumAsset,
} from '../src/routes/albums';

const baseBinding = {
  genre: 'afrobeats',
  bpm: 104,
  provider: 'minimax',
  pinnedReferenceId: 'clreference00000000000000000',
  requiresExactVoice: false,
  voiceProfileId: null,
  styleBrief: 'Warm guitar pocket, restrained log drum, airy vocal direction.',
  requestedTheme: 'late-night gratitude',
  languages: ['en', 'pcm', 'en'],
  materialRoles: ['guitar', 'log_drum', 'guitar'],
};

const bound = bindAlbumDropInput(baseBinding);
assert.equal(bound.ok, true);
if (!bound.ok) throw new Error(bound.message);
assert.equal(bound.input.pinnedReferenceId, baseBinding.pinnedReferenceId);
assert.equal(bound.input.songEngine, 'minimax');
assert.equal(bound.input.withVocals, true);
assert.deepEqual(bound.input.languages, ['en', 'pcm']);
assert.deepEqual(bound.input.instruments, ['guitar', 'log drum']);
assert.match(bound.input.vibe ?? '', /Warm guitar pocket/);
assert.doesNotMatch(bound.input.theme, /same voice/i);

assert.deepEqual(
  bindAlbumDropInput({
    ...baseBinding,
    requiresExactVoice: true,
    voiceProfileId: 'clvoice000000000000000000000',
  }),
  {
    ok: false,
    error: 'anchor_voice_profile_unsupported',
    message: 'This anchor uses a specific voice profile, but Drop cannot bind a voice profile yet. No album track was queued.',
  }
);
assert.equal(
  bindAlbumDropInput({ ...baseBinding, pinnedReferenceId: null }).ok,
  false,
  'an album Drop must not fall back to an unrelated learned reference'
);
assert.equal(
  bindAlbumDropInput({ ...baseBinding, provider: 'replicate' }).ok,
  false,
  'an album Drop must not silently substitute an unsupported anchor engine'
);
assert.equal(
  bindAlbumDropInput({ ...baseBinding, styleBrief: '' }).ok,
  false,
  'an album Drop must not invent a missing style anchor'
);
assert.equal(
  bindAlbumDropInput({ ...baseBinding, bpm: 0 }).ok,
  false,
  'an album Drop must not invent a missing tempo'
);

const certified = {
  id: 'master-a',
  url: 's3://workspace/masters/master-a.wav',
  createdAt: new Date('2026-07-15T12:00:00.000Z'),
  approved: true,
  qualityState: 'passed',
  contentHash: 'a'.repeat(64),
  verifiedAt: new Date('2026-07-15T12:00:00.000Z'),
};
assert.equal(selectCertifiedAlbumAsset([certified])?.id, certified.id);
assert.equal(
  selectCertifiedAlbumAsset([
    certified,
    { ...certified, id: 'master-b', createdAt: new Date('2026-07-15T13:00:00.000Z') },
  ])?.id,
  'master-b',
  'the exact newest certified artifact must anchor the album'
);
assert.equal(selectCertifiedAlbumAsset([{ ...certified, approved: false }]), undefined);
assert.equal(selectCertifiedAlbumAsset([{ ...certified, qualityState: 'failed' }]), undefined);
assert.equal(selectCertifiedAlbumAsset([{ ...certified, contentHash: null }]), undefined);
assert.equal(selectCertifiedAlbumAsset([{ ...certified, verifiedAt: null }]), undefined);

const albumsSource = readFileSync(new URL('../src/routes/albums.ts', import.meta.url), 'utf8');
assert.match(albumsSource, /pinnedReferenceId: request\.pinnedReferenceId/);
assert.match(albumsSource, /inputJson: \{ \.\.\.input, albumId: album\.id, anchorIdentity \}/);
assert.match(albumsSource, /payload: \(jobId\).*anchorIdentity/);
assert.match(albumsSource, /materialUsageIds/);
assert.match(albumsSource, /referenceUsageIds/);
assert.match(albumsSource, /playableLineage\(playable\)/);
assert.doesNotMatch(albumsSource, /\?\? beat\.referenceUsages\.find/);
assert.doesNotMatch(albumsSource, /beat\.bpm \?\? 103/);
assert.doesNotMatch(albumsSource, /runDropPipeline\(/);

const workerSource = readFileSync(
  new URL('../src/lib/orchestration-worker.ts', import.meta.url),
  'utf8'
);
const playableAt = workerSource.indexOf('const songId = result.playableOutputs[0]?.songId');
const attachAt = workerSource.indexOf('data: { albumId: album.id }', playableAt);
const successAt = workerSource.indexOf('status: "SUCCEEDED"', attachAt);
assert.ok(playableAt > 0, 'album attachment must consume certified Drop playable output');
assert.ok(attachAt > playableAt, 'the song must attach only after playable evidence exists');
assert.ok(successAt > attachAt, 'the parent must expose success only after album attachment');

console.log('album generation integrity: PASS');

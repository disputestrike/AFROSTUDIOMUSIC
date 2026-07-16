import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  arrangementBlueprint,
  currentPlayableAsset,
  playableArrangement,
  playableAssetHistory,
  playableAssetRef,
  type PlayableAssetRow,
} from '../src/lib/current-playable-asset';

const at = (seconds: number) => new Date(1_700_000_000_000 + seconds * 1000);
const hash = (digit: string) => digit.repeat(64);
const row = (id: string, url: string, seconds: number, extra: Partial<PlayableAssetRow> = {}): PlayableAssetRow => ({
  id,
  url,
  createdAt: at(seconds),
  ...extra,
});

const beat = row('beat-1', 'https://audio/beat.wav', 1, {
  format: 'wav',
  duration: 120,
  bpm: 100,
  approved: true,
  qualityState: 'passed',
  contentHash: hash('a'),
  verifiedAt: at(1),
  meta: {
    measured: {
      engineOk: true,
      durationS: { value: 120 },
      tempoBpm: { value: 100 },
      sectionBoundaries: { value: [30, 60, 90] },
    },
  },
});
const oldMaster = row('master-1', 'https://audio/master.wav', 2, {
  approved: true,
  qualityState: 'passed',
  contentHash: hash('b'),
  verifiedAt: at(2),
  meta: { qc: { durationS: 120 } },
});
const newerMix = row('mix-1', 'https://audio/new-mix.wav', 3, {
  meta: { qc: { durationS: 60 }, transform: { tempo: 2 } },
});

{
  const history = playableAssetHistory({ beats: [beat], masters: [oldMaster], mixes: [newerMix] });
  assert.deepEqual(history.map((asset) => `${asset.type}:${asset.id}`), [
    'beat:beat-1',
    'master:master-1',
    'mix:mix-1',
  ]);
  const current = currentPlayableAsset({ beats: [beat], masters: [oldMaster], mixes: [newerMix] });
  assert.equal(current?.type, 'master', 'uncertified newer rows cannot replace canonical playback');
  assert.equal(current?.id, 'master-1');
  assert.deepEqual(playableAssetRef(current)?.certification, {
    status: 'certified',
    certified: true,
    approved: true,
    qualityState: 'passed',
    contentHash: hash('b'),
    verifiedAt: at(2),
  });

  const arrangement = playableArrangement(history, current);
  assert.equal(arrangement?.durationS, 120);
  assert.deepEqual(arrangement?.boundaries, [30, 60, 90]);
  assert.equal(arrangement?.bpm, 100);
  assert.equal(arrangement?.inherited, true);
  assert.equal(arrangementBlueprint(arrangement)?.sections.length, 4);
}

{
  // CERTIFICATION GATES RELEASE, NOT PLAYBACK (owner doctrine, f6f0465): with
  // no certified take anywhere, the NEWEST playable audio is still the song's
  // current audio — hidden audio was the dishonest claim (the owner's whole
  // pre-certification catalog showed "No audio rendered yet"). The
  // certification object travels as 'uncertified' so every surface can say so.
  // (These two blocks pinned the pre-f6f0465 null behavior and were failing
  // against the doctrine commit itself — updated 2026-07-16.)
  const current = currentPlayableAsset({
    beats: [row('pending', 'https://audio/pending.wav', 20)],
    mixes: [row('failed', 'https://audio/failed.wav', 21, {
      approved: true,
      qualityState: 'failed',
      contentHash: hash('c'),
      verifiedAt: at(21),
    })],
  });
  assert.equal(current?.id, 'failed', 'with nothing certified, the newest playable take is still the current audio');
  assert.equal(current?.certification.certified, false, 'the fallback must SAY it is uncertified, never fake a pass');
}
{
  const current = currentPlayableAsset({
    masters: [row('malformed-hash', 'https://audio/malformed.wav', 22, {
      approved: true,
      qualityState: 'passed',
      contentHash: 'not-a-sha256',
      verifiedAt: at(22),
    })],
  });
  assert.equal(current?.id, 'malformed-hash', 'a malformed hash falls back to playable-but-uncertified, not to silence');
  assert.equal(current?.certification.certified, false, 'malformed hashes cannot satisfy playback certification');
  assert.equal(current?.certification.contentHash, null, 'a malformed hash is recorded as no hash, never echoed back');
}
{
  const current = currentPlayableAsset({
    beats: [beat],
    mixes: [row('same-bytes-wrapper', beat.url, 4)],
  });
  assert.equal(
    current?.id,
    beat.id,
    'an uncertified wrapper around identical bytes cannot erase certified playback evidence'
  );
}

{
  const sameTime = at(10);
  const history = playableAssetHistory({
    beats: [{ ...beat, id: 'tie-beat', createdAt: sameTime }],
    mixes: [{ ...newerMix, id: 'tie-mix', createdAt: sameTime }],
    masters: [{ ...oldMaster, id: 'tie-master', createdAt: sameTime }],
  });
  assert.equal(history.at(-1)?.type, 'master', 'same-time tie-break is deterministic and favors the final artifact');
}

{
  const history = playableAssetHistory({
    beats: [row('same-beat', 'https://audio/same.wav', 1)],
    mixes: [row('same-mix', 'https://audio/same.wav', 2)],
    masters: [
      row('different', 'https://audio/different.wav', 3),
      row('revert', 'https://audio/same.wav', 4),
    ],
  });
  assert.deepEqual(history.map((asset) => asset.id), ['same-mix', 'different', 'revert']);
  assert.equal(history.at(-1)?.id, 'revert', 'a non-consecutive revert remains a version');
}

{
  const edited = row('chat-master', 'https://audio/chat.wav', 4, {
    meta: {
      qc: { durationS: 95 },
      measured: {
        durationS: { value: 95 },
        tempoBpm: { value: 100 },
        sectionBoundaries: { value: [25, 55, 75] },
      },
    },
  });
  const history = playableAssetHistory({ beats: [beat], masters: [edited] });
  const arrangement = playableArrangement(history);
  assert.deepEqual(arrangement?.boundaries, [25, 55, 75]);
  assert.equal(arrangement?.durationS, 95);
  assert.equal(arrangement?.inherited, false, 'an edited master owns its updated structure');
}

const voicesSource = readFileSync(
  new URL('../src/routes/voices.ts', import.meta.url),
  'utf8'
);
assert.equal(voicesSource.includes('const current = currentPlayableAsset(s);'), true);
assert.equal(voicesSource.includes('songInputUrl = current?.url ?? null;'), true);
assert.match(
  voicesSource,
  /masters: \{ orderBy: \{ createdAt: "desc" \}, take: 20 \},[\s\S]*mixes: \{ orderBy: \{ createdAt: "desc" \}, take: 20 \}/,
  'voice conversion must load enough history for certified fallback',
);
const songsSource = readFileSync(
  new URL('../src/routes/songs.ts', import.meta.url),
  'utf8'
);
assert.equal(
  voicesSource.includes('const cands = [s.masters[0], s.mixes[0], s.beats[0]]'),
  false,
  'voice conversion must not select an uncertified source by timestamp'
);
assert.match(songsSource, /mixId: sourceMix\.id,[\s\S]{0,200}preset: 'reverted'/);
assert.match(songsSource, /sourceMixId: sourceMix\.id/);
assert.match(songsSource, /vocalRenderContentHashes: \[\]/);

console.log('current playable asset: chronology, identity, certification, and arrangement passed');

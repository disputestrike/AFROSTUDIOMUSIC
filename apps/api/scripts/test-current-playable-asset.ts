import assert from 'node:assert/strict';
import {
  arrangementBlueprint,
  currentPlayableAsset,
  playableArrangement,
  playableAssetHistory,
  playableAssetRef,
  type PlayableAssetRow,
} from '../src/lib/current-playable-asset';

const at = (seconds: number) => new Date(1_700_000_000_000 + seconds * 1000);
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
  contentHash: 'beat-hash',
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
  contentHash: 'master-hash',
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
  assert.equal(current?.type, 'mix', 'chronology wins over model preference');
  assert.equal(current?.id, 'mix-1');
  assert.deepEqual(playableAssetRef(current)?.certification, {
    status: 'uncertified',
    certified: false,
    approved: false,
    qualityState: 'unmeasured',
    contentHash: null,
    verifiedAt: null,
  });

  const arrangement = playableArrangement(history, current);
  assert.equal(arrangement?.durationS, 60);
  assert.deepEqual(arrangement?.boundaries, [15, 30, 45]);
  assert.equal(arrangement?.bpm, 200);
  assert.equal(arrangement?.inherited, true);
  assert.equal(arrangementBlueprint(arrangement)?.sections.length, 4);
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

console.log('current playable asset: chronology, identity, certification, and arrangement passed');

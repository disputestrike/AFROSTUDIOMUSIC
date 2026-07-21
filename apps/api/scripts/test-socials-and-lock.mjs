/**
 * SOCIALS PACK + LYRICS LOCK AFTER VIDEO (owner orders, 2026-07-20) — the REAL
 * songs routes on a bare Fastify against the in-memory prisma (identity-test-
 * kit pattern; no Postgres, no Redis, no provider keys; STUB_AI keeps the
 * bulk-brain call deterministic). Proves:
 *
 *   (a) POST /:id/socials/generate builds the pack from the song's own
 *       materials, STORES it on the song, and returns the exact shape
 *       { story, captions[3], hashtags, hook, language, generatedAt };
 *       GET /:id/socials then serves the stored pack.
 *   (b) Both socials endpoints are workspace-scoped — a foreign song is 404,
 *       never read, never written. VIEWER cannot generate (role gate).
 *   (c) PATCH /:id/lyrics succeeds while the song has NO video.
 *   (d) Once a video is done (rendered scene OR assembled cut — the same
 *       evidence that fills SongRow.video/videoScenesReady) PATCH returns
 *       409 lyrics_locked_after_video; GET /:id/lyrics reports locked:true
 *       but stays readable. The orphan-concept binding (assembly.audioSource
 *       .songId) locks too.
 *   (e) POST /:id/lyrics/revert is blocked by the same lock.
 *   (f) POST /:id/reuse-lyrics STAYS allowed when locked — it mints a NEW
 *       song; the original's words never move.
 *
 * Run: pnpm --filter @afrohit/api test:socials-and-lock
 */
import assert from 'node:assert/strict';

process.env.AUTH_MODE = 'internal';
process.env.STUB_AI = '1';
process.env.JWT_SECRET = 'socials-test-secret-0123456789abcdef01234567';
process.env.WEB_URL = 'http://localhost:3000';

const { buildApp, installFakePrisma, as } = await import('./identity-test-kit.mjs');

const now = new Date();
const lyricA = {
  id: 'l1',
  projectId: 'p1',
  songId: 'song-A',
  title: 'Sunrise Call',
  body: '[Hook]\nwe rise with the sunrise call',
  cleanVersion: null,
  structure: null,
  languageMix: null,
  explicit: false,
  artistAuthored: false,
  versions: [],
  approved: false,
};
const projectA = { id: 'p1', workspaceId: 'ws-A', title: 'P1', genre: 'afrobeats', bpm: 104, artist: { stageName: 'BENXP' } };
const songA = {
  id: 'song-A',
  workspaceId: 'ws-A',
  projectId: 'p1',
  title: 'Sunrise Call',
  displayArtist: null,
  kind: 'song',
  status: 'FULL',
  lyricId: 'l1',
  deletedAt: null,
  socialsJson: null,
  socialsUpdatedAt: null,
  createdAt: now,
  project: projectA,
  lyric: lyricA,
};
// song-B: NO bound concept of its own — its video evidence lives on an ORPHAN
// concept (songId null) whose assembled cut names it via audioSource.songId.
const songB = {
  id: 'song-B',
  workspaceId: 'ws-A',
  projectId: 'p2',
  title: 'Orphan Video Song',
  displayArtist: null,
  kind: 'song',
  status: 'FULL',
  lyricId: null,
  deletedAt: null,
  socialsJson: null,
  socialsUpdatedAt: null,
  createdAt: now,
  project: { id: 'p2', workspaceId: 'ws-A', title: 'P2', genre: 'afrobeats', bpm: 100, artist: { stageName: 'BENXP' } },
  lyric: null,
};
const songForeign = {
  id: 'song-F',
  workspaceId: 'ws-B',
  projectId: 'pF',
  title: 'Not Mine',
  displayArtist: null,
  kind: 'song',
  status: 'FULL',
  lyricId: null,
  deletedAt: null,
  socialsJson: null,
  socialsUpdatedAt: null,
  createdAt: now,
  project: { id: 'pF', workspaceId: 'ws-B', title: 'PF', genre: 'amapiano', bpm: 112, artist: { stageName: 'OTHER' } },
  lyric: null,
};

const fakes = installFakePrisma({
  song: [songA, songB, songForeign],
  lyricDraft: [lyricA],
  project: [projectA, songB.project, songForeign.project],
  songBrief: [{ id: 'brief1', projectId: 'p1', mood: 'joyful defiance', topic: 'new beginnings', createdAt: now }],
  beatAsset: [],
  videoConcept: [],
  videoRender: [],
});

const app = await buildApp();
const { default: songsRoutes } = await import('../src/routes/songs');
await app.register(songsRoutes, { prefix: '/api/v1/songs' });
await app.ready();

const producer = as('PRODUCER');
const inject = (method, url, opts = {}) =>
  app.inject({ method, url, headers: producer, ...opts });

// ---- (c) PATCH lyrics succeeds while there is NO video --------------------
let res = await inject('PATCH', '/api/v1/songs/song-A/lyrics', {
  payload: { body: '[Hook]\nwe rise, we rise, with the sunrise call' },
});
assert.equal(res.statusCode, 200, `pre-video lyric edit must be 200, got ${res.statusCode}: ${res.body}`);
assert.equal(
  fakes.lyricDraft.rows[0].body,
  '[Hook]\nwe rise, we rise, with the sunrise call',
  'the edit landed on the bound draft'
);

// ---- (a) socials generate: stores + returns the RELEASE KIT ---------------
// (full-kit shape is exhaustively asserted in test-release-kit.mjs; here we
// only prove the socials route still stores + serves a kit next to the lyrics.)
res = await inject('POST', '/api/v1/songs/song-A/socials/generate', { payload: {} });
assert.equal(res.statusCode, 200, `socials generate must be 200, got ${res.statusCode}: ${res.body}`);
const generated = res.json();
assert.equal(generated.exists, true, 'generate returns exists:true');
assert.equal(generated.status, 'ready', 'generate returns status ready');
const pack = generated.socials;
assert.ok(pack && typeof pack === 'object', 'a kit came back');
assert.equal(pack.kind, 'release-kit', 'the stored object is a release kit');
assert.ok(typeof pack.story === 'string' && pack.story.length > 20, 'story is a real string');
assert.ok(Array.isArray(pack.captions) && pack.captions.length === 3, '3 per-platform captions');
assert.ok(pack.hashtags && Array.isArray(pack.hashtags.tier1), 'hashtags are tiered');
assert.ok(typeof pack.hook === 'string' && pack.hook.length > 0, 'a one-line reel hook');
assert.equal(pack.language, 'English', 'English lyric → English kit');
// STORED — the tab opens instantly next time, already populated.
const storedSong = fakes.song.rows.find((s) => s.id === 'song-A');
assert.deepEqual(storedSong.socialsJson, pack, 'the kit is persisted on the song');
assert.equal(storedSong.releaseKitStatus, 'ready', 'kit status stored ready');
assert.ok(storedSong.socialsUpdatedAt instanceof Date, 'socialsUpdatedAt stamped');
res = await inject('GET', '/api/v1/songs/song-A/socials');
assert.equal(res.statusCode, 200);
assert.deepEqual(res.json().socials, pack, 'GET serves the STORED kit verbatim');
assert.equal(res.json().status, 'ready', 'GET reports status ready');

// ---- (b) workspace scoping + role gate -------------------------------------
res = await inject('GET', '/api/v1/songs/song-F/socials');
assert.equal(res.statusCode, 404, `a foreign song's socials must be 404, got ${res.statusCode}`);
res = await inject('POST', '/api/v1/songs/song-F/socials/generate', { payload: {} });
assert.equal(res.statusCode, 404, `generating on a foreign song must be 404, got ${res.statusCode}`);
assert.equal(fakes.song.rows.find((s) => s.id === 'song-F').socialsJson, null, 'the foreign song was never written');
res = await app.inject({ method: 'POST', url: '/api/v1/songs/song-A/socials/generate', headers: as('VIEWER'), payload: {} });
assert.equal(res.statusCode, 403, `VIEWER cannot generate socials, got ${res.statusCode}`);

// ---- (d) video done → PATCH lyrics is 409 ----------------------------------
// Evidence path 1: a RENDERED SCENE on the song's own concept (the
// videoScenesReady source) — paid video work exists, the words freeze.
fakes.videoConcept.rows.push({ id: 'vc1', projectId: 'p1', songId: 'song-A', createdAt: now });
fakes.videoRender.rows.push({ id: 'vr-scene', conceptId: 'vc1', url: 's3://renders/scene0.mp4', createdAt: now, meta: { shotIndex: 0 } });
res = await inject('PATCH', '/api/v1/songs/song-A/lyrics', { payload: { body: '[Hook]\ndrifted words' } });
assert.equal(res.statusCode, 409, `rendered-scene lock must 409, got ${res.statusCode}: ${res.body}`);
assert.equal(res.json().error, 'lyrics_locked_after_video', 'the 409 names the lock');
assert.equal(
  fakes.lyricDraft.rows[0].body,
  '[Hook]\nwe rise, we rise, with the sunrise call',
  'the locked draft was NOT modified'
);
// Evidence path 2 (primary condition): an ASSEMBLED cut — SongRow.video's source.
fakes.videoRender.rows.length = 0;
fakes.videoRender.rows.push({ id: 'vr-full', conceptId: 'vc1', url: 's3://renders/full.mp4', createdAt: now, meta: { assembly: { kind: 'full' } } });
res = await inject('PATCH', '/api/v1/songs/song-A/lyrics', { payload: { body: '[Hook]\ndrifted words' } });
assert.equal(res.statusCode, 409, `assembled-cut lock must 409, got ${res.statusCode}: ${res.body}`);
assert.equal(res.json().error, 'lyrics_locked_after_video');
// GET stays readable and SAYS it is locked — the UI renders read-only from this.
res = await inject('GET', '/api/v1/songs/song-A/lyrics');
assert.equal(res.statusCode, 200, 'reading locked lyrics is always allowed');
assert.equal(res.json().locked, true, 'GET reports locked:true');
assert.equal(res.json().lyric.body, '[Hook]\nwe rise, we rise, with the sunrise call', 'the words are still served');
// Orphan-concept binding: an assembled cut on a songId-null concept whose
// audioSource names song-B — the same recovery the catalog card uses.
fakes.videoConcept.rows.push({ id: 'vc-orphan', projectId: 'p2', songId: null, createdAt: now });
fakes.videoRender.rows.push({
  id: 'vr-orphan',
  conceptId: 'vc-orphan',
  url: 's3://renders/orphan-full.mp4',
  createdAt: now,
  meta: { assembly: { kind: 'full', audioSource: { songId: 'song-B' } } },
});
res = await inject('PATCH', '/api/v1/songs/song-B/lyrics', { payload: { body: '[Hook]\nnew words' } });
assert.equal(res.statusCode, 409, `orphan-bound assembled cut must lock too, got ${res.statusCode}: ${res.body}`);

// ---- (e) revert is an edit too — same lock ---------------------------------
res = await inject('POST', '/api/v1/songs/song-A/lyrics/revert', { payload: { index: 0 } });
assert.equal(res.statusCode, 409, `locked revert must 409, got ${res.statusCode}: ${res.body}`);
assert.equal(res.json().error, 'lyrics_locked_after_video');

// ---- (f) reuse-lyrics STAYS allowed when locked ----------------------------
const songsBefore = fakes.song.rows.length;
res = await inject('POST', '/api/v1/songs/song-A/reuse-lyrics', { payload: {} });
assert.equal(res.statusCode, 201, `reuse-lyrics must stay allowed when locked, got ${res.statusCode}: ${res.body}`);
const reuse = res.json();
assert.ok(reuse.songId && reuse.songId !== 'song-A', 'a NEW song was minted');
assert.equal(fakes.song.rows.length, songsBefore + 1, 'exactly one new song row');
const copiedDraft = fakes.lyricDraft.rows.find((l) => l.songId === reuse.songId);
assert.ok(copiedDraft, 'the words were copied into a NEW draft bound to the new song');
assert.equal(
  fakes.lyricDraft.rows.find((l) => l.id === 'l1').songId,
  'song-A',
  "the ORIGINAL song's draft never moved"
);

await app.close();
console.log(
  'socials + lyrics-lock: pack stored/served with the right shape, workspace + role scoped, edits open pre-video, 409-locked after scenes/assembled/orphan cuts, revert locked, reuse-lyrics still open'
);

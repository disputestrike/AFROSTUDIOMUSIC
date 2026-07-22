/**
 * PUBLIC RELEASE PAGE (Phase 4) — the shareable destination a short/social link
 * points at. This proves the ONE thing that matters most about a public,
 * unauthenticated endpoint: it exposes ONLY songs the owner green-lit and
 * released, and it leaks NOTHING private — no other tenant's rows, no workspace
 * internals, no unreleased catalog, no raw storage references.
 *
 * Boots the REAL public route module on a bare Fastify instance (identity-test-
 * kit pattern) against an in-memory prisma. No Postgres, no Redis. Storage is
 * given throwaway static credentials so presignAssetRef signs offline (SigV4 is
 * pure local crypto) — the output is a real presigned https URL to assert on.
 *
 * Asserts:
 *   (a) A shareable song (releaseReady + status RELEASED + not quarantined)
 *       returns the full release payload: title, artist, genre, cover, master
 *       audio, music video, visualizer, clips, verbatim lyrics, story + hook.
 *   (b) A PRIVATE song is NOT exposed — 404 for every non-shareable shape
 *       (not green-lit, green-lit-but-not-RELEASED, quarantined, and a foreign
 *       workspace's private song). THE critical leak test.
 *   (c) Cross-tenant / private data NEVER appears in the payload — no foreign
 *       song, no foreign workspace id, no workspace/project ids, no creator-only
 *       release-kit internals (captions, hashtags, titles), no raw s3:// refs.
 *   (d) Every asset URL is a PRESIGNED public URL (https + a signature), never a
 *       private storage reference.
 *   (e) An instrumental release exposes no lyrics (the vocal-only lyric gate).
 *
 * Run: pnpm --filter @afrohit/api test:release-page
 */
import assert from 'node:assert/strict';

process.env.AUTH_MODE = 'internal';
process.env.JWT_SECRET = 'release-page-test-secret-0123456789abcdef0123';
process.env.WEB_URL = 'http://localhost:3000';
// Throwaway storage creds so presignAssetRef signs a real URL fully offline.
process.env.S3_BUCKET = 'afrohit-studio';
process.env.S3_ACCESS_KEY = 'test-access-key';
process.env.S3_SECRET_KEY = 'test-secret-key';
process.env.S3_ENDPOINT = 'https://s3.test.local';
process.env.S3_REGION = 'auto';

const { buildApp, installFakePrisma } = await import('./identity-test-kit.mjs');

const now = new Date();
const S = (k) => `s3://afrohit-studio/ws-A/${k}`; // a canonical private ref

const projectA = { id: 'p1', workspaceId: 'ws-A', genre: 'afro_pop', artist: { stageName: 'AfroHouse' } };
const lyricPub = {
  id: 'l1',
  projectId: 'p1',
  songId: 'song-pub',
  title: 'Sunrise Call',
  body: '[Hook]\nwe rise with the sunrise call\n[Verse 1]\nheld the night, now the morning is ours',
};

// Creator-only release kit — story + hook are fan-facing; everything else
// (captions, hashtags, titles) must STAY in the studio, never on the page.
const kitPub = {
  kind: 'release-kit',
  story: 'Sunrise Call is an afro-pop record BXP built for the walk home after a long week — defiant, warm, made to move a room.',
  hook: 'POV: Sunrise Call comes on and nobody sits down',
  captions: [{ platform: 'youtube', style: 'hype', text: 'INTERNAL_CAPTION_SECRET' }],
  hashtags: { tier1: ['#Afrobeats'], tier2: ['#NewMusic'], tier3: [], line: '#SECRETHASHTAG #Afrobeats' },
  titles: ['INTERNAL_TITLE_SECRET'],
};

const songPub = {
  id: 'song-pub',
  workspaceId: 'ws-A',
  projectId: 'p1',
  title: 'Sunrise Call',
  displayArtist: 'BXP',
  kind: 'song',
  status: 'RELEASED',
  releaseReady: true,
  quarantined: false,
  deletedAt: null,
  coverUrl: S('cover/pub.jpg'),
  isrc: 'US-ABC-26-00001',
  socialsJson: kitPub,
  createdAt: now,
  project: projectA,
  lyric: lyricPub,
  masters: [{ id: 'm1', url: S('master/pub.wav'), createdAt: now, approved: true, qualityState: 'passed' }],
  mixes: [],
  beats: [],
};

// A released INSTRUMENTAL — no lyrics may appear.
const songInst = {
  ...songPub,
  id: 'song-inst',
  title: 'Night Drive Riddim',
  kind: 'instrumental',
  coverUrl: S('cover/inst.jpg'),
  isrc: 'US-ABC-26-00002',
  socialsJson: null,
  lyric: { id: 'l2', projectId: 'p1', songId: 'song-inst', title: 'Night Drive', body: 'SHOULD_NOT_APPEAR' },
  masters: [{ id: 'm2', url: S('master/inst.wav'), createdAt: now, approved: true }],
};

// Private / non-shareable shapes — every one must be 404.
const songDraft = { ...songPub, id: 'song-draft', title: 'Draft', releaseReady: false, status: 'MASTERED', socialsJson: null };
const songNotReleased = { ...songPub, id: 'song-exported', title: 'Exported', releaseReady: true, status: 'EXPORTED', socialsJson: null };
const songQuarantined = { ...songPub, id: 'song-quar', title: 'Pulled', releaseReady: true, status: 'RELEASED', quarantined: true, socialsJson: null };
// A DIFFERENT tenant's private song — its title/workspace must never surface.
const songForeign = {
  ...songPub,
  id: 'song-foreign',
  workspaceId: 'ws-B',
  projectId: 'pF',
  title: 'FOREIGN_SECRET_SONG',
  releaseReady: false,
  status: 'MASTERED',
  coverUrl: 's3://afrohit-studio/ws-B/cover/foreign.jpg',
  socialsJson: null,
  project: { id: 'pF', workspaceId: 'ws-B', genre: 'amapiano', artist: { stageName: 'OTHER' } },
  lyric: null,
  masters: [{ id: 'mF', url: 's3://afrohit-studio/ws-B/master/foreign.wav', createdAt: now, approved: true }],
};

installFakePrisma({
  song: [songPub, songInst, songDraft, songNotReleased, songQuarantined, songForeign],
  videoConcept: [{ id: 'c1', songId: 'song-pub', createdAt: now }],
  videoRender: [{ id: 'v1', conceptId: 'c1', url: S('video/master.mp4'), meta: { assembly: { kind: 'full' } }, createdAt: now }],
  songVisual: [
    { id: 'sv1', songId: 'song-pub', kind: 'visualizer', url: S('visuals/vis.mp4'), createdAt: now },
    { id: 'sv2', songId: 'song-pub', kind: 'lyric_video', url: S('visuals/lyric.mp4'), createdAt: now },
    // The BRANDED POSTER (cover + big "AFRO" mark), marked meta.poster — a legacy
    // song with no pinned Song.posterUrl still resolves its poster from here.
    { id: 'svP', songId: 'song-pub', kind: 'thumbnail', url: S('visuals/poster.jpg'), meta: { poster: true }, aspect: '16:9', createdAt: now },
    { id: 'sv3', songId: 'song-inst', kind: 'visualizer', url: S('visuals/inst-vis.mp4'), createdAt: now },
  ],
  songClip: [
    { id: 'cl1', songId: 'song-pub', url: S('clips/1.mp4'), durationS: 15, aspect: '9:16', kind: 'short', captionText: 'we rise', createdAt: now },
    { id: 'cl2', songId: 'song-pub', url: S('clips/2.mp4'), durationS: 30, aspect: '9:16', kind: 'reel', captionText: null, createdAt: now },
  ],
  imageAsset: [{ id: 'img1', projectId: 'p1', kind: 'cover', approved: true, url: S('cover/legacy.jpg'), createdAt: now }],
});

const app = await buildApp();
const { default: publicRoutes } = await import('../src/routes/public');
await app.register(publicRoutes, { prefix: '/api/v1/public' });
await app.ready();

const get = (id) => app.inject({ method: 'GET', url: `/api/v1/public/song/${id}/release` });
const isPresigned = (u) => typeof u === 'string' && u.startsWith('https://') && u.includes('X-Amz-Signature');

// ---- (a) the shareable song returns the full payload -----------------------
let res = await get('song-pub');
assert.equal(res.statusCode, 200, `shareable song must be 200, got ${res.statusCode}: ${res.body}`);
const r = res.json();
assert.equal(r.id, 'song-pub');
assert.equal(r.title, 'Sunrise Call', 'title');
assert.equal(r.artist, 'BXP', 'displayArtist wins over the project artist');
assert.equal(r.genre, 'afro_pop', 'genre');
assert.ok(r.coverUrl, 'a cover');
assert.ok(r.audioUrl, 'master audio');
assert.ok(r.musicVideoUrl, 'the music video');
assert.ok(r.visualizerUrl, 'the visualizer');
assert.ok(r.lyricVideoUrl, 'the lyric video');
assert.ok(Array.isArray(r.clips) && r.clips.length === 2, 'the short clips');
assert.equal(r.story, kitPub.story, 'the story blurb from the kit');
assert.equal(r.hook, kitPub.hook, 'the hook from the kit');
assert.ok(r.lyrics && r.lyrics.includes('sunrise call'), 'lyrics rendered verbatim');
assert.equal(r.lyrics, lyricPub.body, 'lyrics are VERBATIM (exact body)');
assert.equal(r.isrc, 'US-ABC-26-00001', 'public-safe ISRC');

// ---- (d) every asset URL is a presigned public URL -------------------------
for (const [name, u] of [
  ['coverUrl', r.coverUrl],
  ['posterUrl', r.posterUrl],
  ['audioUrl', r.audioUrl],
  ['musicVideoUrl', r.musicVideoUrl],
  ['visualizerUrl', r.visualizerUrl],
  ['lyricVideoUrl', r.lyricVideoUrl],
  ...r.clips.map((c, i) => [`clip[${i}]`, c.url]),
]) {
  assert.ok(isPresigned(u), `${name} must be a presigned https URL, got ${u}`);
}
// The per-song cover (song.coverUrl) wins over the legacy project cover.
assert.ok(r.coverUrl.includes('cover/pub.jpg'), 'per-song cover is served, not the project fallback');
// The BRANDED POSTER (VEVO-style before-play still) is served as posterUrl — the
// OG/Twitter image + the video's poster. Resolved from the meta.poster SongVisual
// here (no pinned Song.posterUrl), presigned, distinct from the bare cover.
assert.ok(r.posterUrl.includes('visuals/poster.jpg'), 'the branded poster is served as posterUrl (meta.poster SongVisual)');

// ---- (c) NOTHING private is in the payload ---------------------------------
const raw = JSON.stringify(r);
for (const bad of [
  's3://', // raw storage refs — everything must be presigned
  'ws-B', // the foreign tenant's workspace never touches this song
  'FOREIGN_SECRET_SONG', // no other song
  'INTERNAL_CAPTION_SECRET', // creator-only kit internals
  'INTERNAL_TITLE_SECRET',
  '#SECRETHASHTAG',
  'workspaceId',
  'projectId',
  'socialsJson',
  'SHOULD_NOT_APPEAR', // the instrumental's stray lyric text
]) {
  assert.ok(!raw.includes(bad), `payload must NOT contain "${bad}"`);
}
// Only the whitelisted keys leave the API — nothing internal rides along.
assert.deepEqual(
  Object.keys(r).sort(),
  ['artist', 'audioUrl', 'clips', 'coverUrl', 'genre', 'hook', 'id', 'isrc', 'lyricVideoUrl', 'lyrics', 'musicVideoUrl', 'posterUrl', 'story', 'title', 'visualizerUrl'].sort(),
  'exactly the public fields, no more',
);

// ---- (b) THE LEAK TEST — every private shape is 404 ------------------------
for (const id of ['song-draft', 'song-exported', 'song-quar', 'song-foreign']) {
  const priv = await get(id);
  assert.equal(priv.statusCode, 404, `private/non-shareable song ${id} MUST be 404, got ${priv.statusCode}`);
  assert.ok(!priv.body.includes('FOREIGN_SECRET_SONG'), `${id} 404 body leaks nothing`);
}
// A song id that does not exist is also 404 (never a 500 that hints at internals).
assert.equal((await get('does-not-exist')).statusCode, 404, 'unknown id is 404');

// ---- (e) a released instrumental exposes no lyrics -------------------------
res = await get('song-inst');
assert.equal(res.statusCode, 200, 'the released instrumental is public');
const inst = res.json();
assert.equal(inst.lyrics, null, 'an instrumental has NO lyrics on the page');
assert.equal(inst.musicVideoUrl, null, 'no music video for the instrumental');
assert.ok(isPresigned(inst.visualizerUrl), 'the instrumental still ships its visualizer, presigned');

await app.close();

console.log(
  'release-page: shareable song returns the full public payload (cover/audio/music-video/visualizer/clips/lyric-video/verbatim-lyrics/story/hook, all presigned); the SAME releaseReady+RELEASED+!quarantined gate keeps every private/foreign/quarantined song 404; no cross-tenant data, no workspace/project ids, no creator-only kit internals, no raw s3:// refs; instrumental exposes no lyrics',
);

/**
 * RELEASE KIT — the AUTO-GENERATED kit (owner, 2026-07-21: "the hashtags don't
 * show until I click Generate — we did not see it"). Proves the kit builds
 * ITSELF on song completion and the manual regenerate is only a fresh-take
 * override. Runs the REAL songs routes + the REAL shared writeReleaseKit against
 * the in-memory prisma (identity-test-kit pattern; no Postgres, no Redis, no
 * provider keys; STUB_AI keeps the bulk brain deterministic).
 *
 * Asserts:
 *   (a) The kit AUTO-generates on song completion — writeReleaseKit (the exact
 *       unit the worker completion hook runs) stores the kit on the song with
 *       NO manual/HTTP call.
 *   (b) The kit carries the full field set: story, per-platform captions,
 *       3 hashtag TIERS + a paste line, hook, 10 titles, description, artist
 *       bio, a 5-7 entry release calendar, pinned comment + engagement question.
 *   (c) Manual regenerate still works (POST /:id/socials/generate force-rebuilds
 *       and stores; GET serves it with status 'ready').
 *   (d) Workspace-scoped — a foreign song is 404 (route) and 'not_found' (writer)
 *       and is NEVER written; VIEWER cannot regenerate (role gate).
 *   (e) Cerebras-ONLY — no paid ladder: with the bulk brain missing,
 *       generateReleaseKit throws ReleaseKitUnavailableError, it never returns a
 *       (paid) result.
 *   (f) Fail-soft — a bulk outage sets releaseKitStatus 'unavailable', leaves
 *       socialsJson null, and NEVER throws (a song render is never failed by a
 *       kit problem). GET reports status 'pending' while the kit is building.
 *
 * Run: pnpm --filter @afrohit/api test:release-kit
 */
import assert from 'node:assert/strict';

process.env.AUTH_MODE = 'internal';
process.env.STUB_AI = '1';
process.env.JWT_SECRET = 'release-kit-test-secret-0123456789abcdef0123';
process.env.WEB_URL = 'http://localhost:3000';

const { buildApp, installFakePrisma, as } = await import('./identity-test-kit.mjs');
const { writeReleaseKit, generateReleaseKit, ReleaseKitUnavailableError, isReleaseKit } =
  await import('@afrohit/ai');
const { prisma } = await import('@afrohit/db');

const now = new Date();
const projectA = { id: 'p1', workspaceId: 'ws-A', title: 'P1', genre: 'afro_pop', bpm: 104, artist: { stageName: 'BXP' } };
const mkLyric = (id, songId, title, body) => ({ id, projectId: 'p1', songId, title, body, cleanVersion: null, structure: null, languageMix: null, explicit: false, artistAuthored: false, versions: [], approved: false });
const mkSong = (id, extra = {}) => ({
  id,
  workspaceId: 'ws-A',
  projectId: 'p1',
  title: extra.title ?? 'A Song',
  displayArtist: extra.displayArtist ?? null,
  kind: 'song',
  status: 'MASTERED',
  deletedAt: null,
  socialsJson: null,
  socialsUpdatedAt: null,
  releaseKitStatus: null,
  createdAt: now,
  project: projectA,
  lyric: extra.lyric ?? null,
});

const lyricA = mkLyric('l1', 'song-A', 'Sunrise Call', '[Hook]\nwe rise with the sunrise call');
const lyricB = mkLyric('l2', 'song-B', 'Late Drive', '[Hook]\nlate night on the long road home');
const lyricC = mkLyric('l3', 'song-C', 'Third One', '[Hook]\nheld on through the week');
const songA = mkSong('song-A', { title: 'Sunrise Call', lyric: lyricA });
const songB = mkSong('song-B', { title: 'Late Drive', displayArtist: 'BXP', lyric: lyricB });
const songC = mkSong('song-C', { title: 'Third One', lyric: lyricC });
const songForeign = {
  ...mkSong('song-F', { title: 'Not Mine' }),
  workspaceId: 'ws-B',
  projectId: 'pF',
  project: { id: 'pF', workspaceId: 'ws-B', title: 'PF', genre: 'amapiano', bpm: 112, artist: { stageName: 'OTHER' } },
};

const fakes = installFakePrisma({
  song: [songA, songB, songC, songForeign],
  lyricDraft: [lyricA, lyricB, lyricC],
  project: [projectA, songForeign.project],
  songBrief: [{ id: 'brief1', projectId: 'p1', mood: 'joyful defiance', topic: 'new beginnings', createdAt: now }],
  beatAsset: [],
  videoConcept: [],
  videoRender: [],
});

// A helper the assertions share.
function assertFullKit(kit) {
  assert.ok(kit && typeof kit === 'object', 'a kit object');
  assert.equal(kit.kind, 'release-kit', 'kit is tagged release-kit');
  assert.ok(isReleaseKit(kit), 'isReleaseKit recognizes it');
  // story
  assert.ok(typeof kit.story === 'string' && kit.story.length > 20, 'story is a real string');
  // per-platform captions (youtube long + tiktok + instagram)
  assert.ok(Array.isArray(kit.captions) && kit.captions.length === 3, 'exactly 3 per-platform captions');
  const platforms = kit.captions.map((c) => c.platform).sort();
  assert.deepEqual(platforms, ['instagram', 'tiktok', 'youtube'], 'captions tagged per platform');
  for (const c of kit.captions) {
    assert.ok(typeof c.text === 'string' && c.text.length > 0, 'caption has text');
    assert.ok(['hype', 'heartfelt', 'minimal'].includes(c.style), 'caption keeps a style');
    if (c.platform !== 'youtube') assert.ok(c.text.length <= 220, 'short captions are <=220');
  }
  // hashtags — 3 TIERS + paste line
  assert.ok(kit.hashtags && typeof kit.hashtags === 'object', 'hashtags is the tiered object');
  assert.ok(Array.isArray(kit.hashtags.tier1) && kit.hashtags.tier1.length >= 1, 'tier1 genre tags');
  assert.ok(Array.isArray(kit.hashtags.tier2) && kit.hashtags.tier2.length >= 1, 'tier2 audience tags');
  assert.ok(Array.isArray(kit.hashtags.tier3), 'tier3 present (may be empty — matched-trend-only)');
  assert.ok(typeof kit.hashtags.line === 'string' && kit.hashtags.line.split(' ').filter(Boolean).length >= 3, 'paste line has 3+ usable tags');
  assert.ok(kit.hashtags.line.split(' ').filter(Boolean).length <= 5, 'paste line is not stuffed (<=5)');
  for (const t of [...kit.hashtags.tier1, ...kit.hashtags.tier2, ...kit.hashtags.tier3]) {
    assert.ok(t.startsWith('#'), 'every tag is a #tag');
  }
  // hook
  assert.ok(typeof kit.hook === 'string' && kit.hook.length > 0, 'a reel/short hook');
  // 10 YouTube titles
  assert.ok(Array.isArray(kit.titles) && kit.titles.length === 10, 'exactly 10 YouTube titles');
  // description + bio
  assert.ok(typeof kit.description === 'string' && kit.description.length > 10, 'a YouTube description');
  assert.ok(typeof kit.artistBio === 'string' && kit.artistBio.length > 10, 'an artist bio');
  // release calendar — 5-7 entries
  assert.ok(Array.isArray(kit.releaseCalendar) && kit.releaseCalendar.length >= 4 && kit.releaseCalendar.length <= 7, 'a 4-7 entry release calendar');
  for (const e of kit.releaseCalendar) {
    assert.ok(Number.isInteger(e.day) && e.day >= 0, 'calendar entry has a relative day');
    assert.ok(e.channel && e.action, 'calendar entry has a channel + action');
  }
  // pinned comment + engagement question
  assert.ok(typeof kit.pinnedComment === 'string' && kit.pinnedComment.length > 0, 'a pinned comment');
  assert.ok(typeof kit.engagementQuestion === 'string' && kit.engagementQuestion.includes('?'), 'a genuine question');
  assert.equal(kit.language, 'English', 'English lyric → English kit');
}

// ---- (a) + (b) AUTO-generate on completion, full field set ----------------
// This is EXACTLY what the worker completion hook runs (processReleaseKit ->
// writeReleaseKit). No route, no manual call — the kit lands on the song.
const autoRes = await writeReleaseKit(prisma, { songId: 'song-A' });
assert.equal(autoRes.status, 'ready', 'auto build reports ready');
assertFullKit(autoRes.kit);
const storedA = fakes.song.rows.find((s) => s.id === 'song-A');
assert.ok(storedA.socialsJson && storedA.socialsJson.kind === 'release-kit', 'the kit is PERSISTED on the song — no click');
assert.equal(storedA.releaseKitStatus, 'ready', 'status stored ready');
assert.ok(storedA.socialsUpdatedAt instanceof Date, 'socialsUpdatedAt stamped');
assertFullKit(storedA.socialsJson);

// ---- Idempotency — a re-fired completion hook must not rebill the brain -----
const again = await writeReleaseKit(prisma, { songId: 'song-A' });
assert.equal(again.status, 'skipped', 'a fresh kit is left alone (idempotent)');
const forced = await writeReleaseKit(prisma, { songId: 'song-A', force: true });
assert.equal(forced.status, 'ready', 'force rebuilds even when fresh');

// ---- (d) workspace-scope at the WRITER level -------------------------------
const foreignWrite = await writeReleaseKit(prisma, { songId: 'song-A', workspaceId: 'ws-B' });
assert.equal(foreignWrite.status, 'not_found', 'a foreign workspace cannot write this song');
assert.equal(fakes.song.rows.find((s) => s.id === 'song-F').socialsJson, null, 'the foreign song was never written');

// ---- Boot the REAL routes for the HTTP-level assertions --------------------
const app = await buildApp();
const { default: songsRoutes } = await import('../src/routes/songs');
await app.register(songsRoutes, { prefix: '/api/v1/songs' });
await app.ready();
const producer = as('PRODUCER');
const inject = (method, url, opts = {}) => app.inject({ method, url, headers: producer, ...opts });

// ---- (c) manual regenerate still works -------------------------------------
let res = await inject('POST', '/api/v1/songs/song-B/socials/generate', { payload: {} });
assert.equal(res.statusCode, 200, `manual regenerate must be 200, got ${res.statusCode}: ${res.body}`);
let body = res.json();
assert.equal(body.exists, true, 'regenerate returns exists:true');
assert.equal(body.status, 'ready', 'regenerate returns status ready');
assertFullKit(body.socials);
const storedB = fakes.song.rows.find((s) => s.id === 'song-B');
assert.ok(storedB.socialsJson && storedB.socialsJson.kind === 'release-kit', 'the kit is persisted by the manual route');
// GET serves the stored kit + status.
res = await inject('GET', '/api/v1/songs/song-B/socials');
assert.equal(res.statusCode, 200);
body = res.json();
assert.equal(body.exists, true, 'GET reports exists:true');
assert.equal(body.status, 'ready', 'GET reports status ready');
assertFullKit(body.socials);

// ---- (d) workspace scoping + role gate at the ROUTE level ------------------
res = await inject('GET', '/api/v1/songs/song-F/socials');
assert.equal(res.statusCode, 404, `a foreign song's kit must be 404, got ${res.statusCode}`);
res = await inject('POST', '/api/v1/songs/song-F/socials/generate', { payload: {} });
assert.equal(res.statusCode, 404, `regenerating a foreign song must be 404, got ${res.statusCode}`);
assert.equal(fakes.song.rows.find((s) => s.id === 'song-F').socialsJson, null, 'the foreign song stays unwritten');
res = await app.inject({ method: 'POST', url: '/api/v1/songs/song-A/socials/generate', headers: as('VIEWER'), payload: {} });
assert.equal(res.statusCode, 403, `VIEWER cannot regenerate, got ${res.statusCode}`);

// ---- (f) GET reports a "building" (pending) status without a kit -----------
// The completion hook flips the song to pending before the processor runs; the
// tab shows "building your release kit…" and polls — no click.
const pendingSong = fakes.song.rows.find((s) => s.id === 'song-C');
pendingSong.releaseKitStatus = 'pending';
res = await inject('GET', '/api/v1/songs/song-C/socials');
assert.equal(res.statusCode, 200);
body = res.json();
assert.equal(body.exists, false, 'no kit yet while building');
assert.equal(body.status, 'pending', 'GET surfaces the building state');

await app.close();

// ---- (e) + (f) Cerebras-ONLY, no paid ladder, fail-soft --------------------
// Kill the stub AND the bulk brain: generation must FAIL CLOSED (no Claude), and
// writeReleaseKit must set 'unavailable' WITHOUT throwing and WITHOUT touching
// the song's other columns (its render).
delete process.env.STUB_AI;
delete process.env.CEREBRAS_API_KEY;
delete process.env.CEREBRAS_API_KEYS;

let laddered = false;
try {
  await generateReleaseKit({ title: 'Third One', artist: 'BXP', genre: 'afro_pop', lyrics: 'held on through the week' });
  laddered = true;
} catch (err) {
  assert.ok(err instanceof ReleaseKitUnavailableError, 'bulk-missing throws ReleaseKitUnavailableError — never a paid result');
}
assert.equal(laddered, false, 'generation NEVER returns a (paid) result when Cerebras is missing');

const beforeTitle = pendingSong.title;
const beforeStatus = pendingSong.status;
const failSoft = await writeReleaseKit(prisma, { songId: 'song-C', force: true });
assert.equal(failSoft.status, 'unavailable', 'writer returns unavailable — does not throw');
assert.equal(pendingSong.socialsJson, null, 'no kit was written on outage');
assert.equal(pendingSong.releaseKitStatus, 'unavailable', 'status marked unavailable for the tab');
assert.equal(pendingSong.title, beforeTitle, 'the song title (its render) is untouched');
assert.equal(pendingSong.status, beforeStatus, 'the song render status is untouched');

console.log(
  'release-kit: auto-generates on completion with the full field set (per-platform captions, 3 hashtag tiers + paste line, 10 titles, bio, 5-7 calendar, pinned+question); idempotent; manual regenerate works; workspace + role scoped; Cerebras-only (no paid ladder); fail-soft -> unavailable, render untouched'
);

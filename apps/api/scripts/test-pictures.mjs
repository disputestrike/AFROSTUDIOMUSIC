/**
 * PICTURES PROOF (identity wave, 2026-07-20) — avatars + song covers + AI
 * covers, run through the REAL routes with an in-memory prisma AND a local
 * S3-compatible stub (a Node http server), so the byte-verification path
 * (magic-byte sniff + full hash) runs for real:
 *
 *   - avatar set: presign screen → PATCH /auth/me{avatarKey} verifies the
 *     BYTES, stores the canonical ref, and /auth/me serves a PRESIGNED link;
 *   - a foreign-workspace avatar key is 403 before any byte is read;
 *   - cover set: PATCH /songs/:id{coverUrl} accepts ONLY this workspace's own
 *     storage — an arbitrary URL is 400, another workspace's ref is 403;
 *   - AI cover: the queued prompt is photorealistic and celebrity names from
 *     the song title are STRIPPED (checked in the actual outbox payload).
 *
 * Run: pnpm --filter @afrohit/api test:pictures
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---- Local S3 stub (HEAD/GET only) BEFORE any storage import ---------------
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(1400, 7),
]);
const objects = new Map([
  ['afrohit-studio/ws-A/uploads/avatar/a.png', png],
  ['afrohit-studio/ws-A/uploads/cover/c.png', png],
]);
const s3stub = createServer((req, res) => {
  const key = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
  const body = objects.get(key);
  if (!body) {
    res.statusCode = 404;
    return res.end();
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'image/png');
  res.setHeader('content-length', String(body.length));
  res.setHeader('etag', '"test"');
  if (req.method === 'HEAD') return res.end();
  return res.end(body);
});
await new Promise((resolve) => s3stub.listen(0, '127.0.0.1', resolve));
const s3port = s3stub.address().port;

process.env.AUTH_MODE = 'internal';
process.env.JWT_SECRET = 'pictures-test-secret-0123456789abcdef01234';
process.env.WEB_URL = 'http://localhost:3000';
process.env.S3_ENDPOINT = `http://127.0.0.1:${s3port}`;
process.env.S3_BUCKET = 'afrohit-studio';
process.env.S3_ACCESS_KEY = 'test-access';
process.env.S3_SECRET_KEY = 'test-secret';
delete process.env.S3_PUBLIC_BASE_URL;
delete process.env.R2_PUBLIC_URL;
delete process.env.ADMIN_EMAILS;

const { buildApp, installFakePrisma, as } = await import('./identity-test-kit.mjs');

const now = new Date();
const songA = {
  id: 'song-A',
  workspaceId: 'ws-A',
  projectId: 'p1',
  title: 'Like Wizkid In Lagos',
  displayArtist: null,
  kind: 'song',
  coverUrl: null,
  instrumentalUrl: null,
  versionLabel: null,
  status: 'SKETCH',
  releaseReady: false,
  hitScore: null,
  viralScore: null,
  quarantined: false,
  quarantineReason: null,
  deletedAt: null,
  deletedReason: null,
  createdAt: now,
  project: { id: 'p1', title: 'P', genre: 'afrobeats', bpm: 110, artist: { stageName: 'BXP' } },
  masters: [],
  mixes: [],
  beats: [],
  lyric: null,
};

const fakes = installFakePrisma({
  workspace: [{ id: 'ws-A', name: 'Studio A', slug: 'studio-a', plan: 'PRO', creditsCents: 0, createdAt: now, suspendedAt: null }],
  workspaceMember: [{ id: 'm1', workspaceId: 'ws-A', userId: 'user-A', role: 'OWNER', createdAt: now }],
  user: [{ id: 'user-A', clerkId: 'x', email: 'a@x.com', fullName: 'A', avatarUrl: null, passwordHash: null }],
  song: [songA],
  songBrief: [{ id: 'brief1', projectId: 'p1', mood: 'gritty feat. Davido energy', createdAt: now }],
  lyricDraft: [],
  imageAsset: [],
  videoConcept: [],
  videoRender: [],
  systemSetting: [],
  providerJob: [],
  jobOutbox: [],
  creditLedger: [{ id: 'chg1', workspaceId: 'ws-A', delta: -3000, reversal: null }],
});

const app = await buildApp();
const chargeCalls = [];
app.decorate('chargeCredits', async (opts) => {
  chargeCalls.push(opts);
  return { ok: true, chargeId: 'chg1', key: opts.key };
});
app.decorate('refundCredits', async () => ({ ok: true }));
app.decorate('queues', { image: { name: 'image', add: async () => ({}) } });
app.decorate('rateLimitRedis', { eval: async () => [1, 60_000] });

const [{ default: authRoutes }, { default: songs }, { default: uploads }] = await Promise.all([
  import('../src/routes/auth'),
  import('../src/routes/songs'),
  import('../src/routes/uploads'),
]);
await app.register(authRoutes, { prefix: '/api/v1/auth' });
await app.register(songs, { prefix: '/api/v1/songs' });
await app.register(uploads, { prefix: '/api/v1/uploads' });
await app.ready();

const inject = (method, url, role, body, extra = {}) =>
  app.inject({ method, url, headers: as(role, extra), ...(body === undefined ? {} : { payload: body }) });

// ---- 1. Image presign: jpeg/png/webp only, ≤5MB ------------------------------
const badType = await inject('POST', '/api/v1/uploads/presign-image', 'OWNER', {
  kind: 'avatar', contentType: 'image/gif', ext: 'png', sizeBytes: 2000,
});
assert.equal(badType.statusCode, 400, 'GIF claims are refused');
const tooBig = await inject('POST', '/api/v1/uploads/presign-image', 'OWNER', {
  kind: 'avatar', contentType: 'image/png', ext: 'png', sizeBytes: 6 * 1024 * 1024,
});
assert.equal(tooBig.statusCode, 400, 'the 5MB cap holds at the schema');
const presigned = await inject('POST', '/api/v1/uploads/presign-image', 'OWNER', {
  kind: 'avatar', contentType: 'image/png', ext: 'png', sizeBytes: 2000,
});
assert.equal(presigned.statusCode, 200, `presign-image: ${presigned.body}`);
const signed = JSON.parse(presigned.body);
assert.ok(signed.key.startsWith('ws-A/uploads/avatar/'), 'keys live under the workspace prefix');
assert.ok(signed.url.startsWith(`http://127.0.0.1:${s3port}/`), 'a presigned PUT url is issued');

// ---- 2. Avatar set — real byte verification against the S3 stub -------------
const avatarSet = await inject('PATCH', '/api/v1/auth/me', 'OWNER', { avatarKey: 'ws-A/uploads/avatar/a.png' });
assert.equal(avatarSet.statusCode, 200, `avatar set: ${avatarSet.body}`);
assert.equal(fakes.user.rows[0].avatarUrl, 's3://afrohit-studio/ws-A/uploads/avatar/a.png', 'the canonical ref is stored');
assert.match(JSON.parse(avatarSet.body).avatarUrl, /^http:\/\/127\.0\.0\.1/, 'the response carries a PRESIGNED link, never the raw ref');

const me = await inject('GET', '/api/v1/auth/me', 'OWNER');
assert.equal(me.statusCode, 200, `me: ${me.body}`);
const meBody = JSON.parse(me.body);
assert.match(meBody.avatarUrl ?? '', /^http:\/\/127\.0\.0\.1/, '/auth/me serves the avatar presigned');
assert.equal(meBody.role, 'OWNER', '/auth/me reports the active-workspace role');

const foreignAvatar = await inject('PATCH', '/api/v1/auth/me', 'OWNER', { avatarKey: 'ws-B/uploads/avatar/x.png' });
assert.equal(foreignAvatar.statusCode, 403, "another workspace's key is refused before any byte is read");

const avatarCleared = await inject('PATCH', '/api/v1/auth/me', 'OWNER', { avatarKey: null });
assert.equal(avatarCleared.statusCode, 200);
assert.equal(fakes.user.rows[0].avatarUrl, null, 'null clears the avatar');

// ---- 3. Song cover set — workspace-prefix law --------------------------------
const coverSet = await inject('PATCH', '/api/v1/songs/song-A', 'PRODUCER', {
  coverUrl: 's3://afrohit-studio/ws-A/uploads/cover/c.png',
});
assert.equal(coverSet.statusCode, 200, `cover set: ${coverSet.body}`);
assert.equal(fakes.song.rows[0].coverUrl, 's3://afrohit-studio/ws-A/uploads/cover/c.png');
assert.match(JSON.parse(coverSet.body).coverUrl, /^http:\/\/127\.0\.0\.1/, 'the PATCH response presigns the cover');

const list = await inject('GET', '/api/v1/songs', 'VIEWER');
assert.equal(list.statusCode, 200);
const card = JSON.parse(list.body)[0];
assert.match(card.coverUrl ?? '', /^http:\/\/127\.0\.0\.1/, 'catalog cards carry a presigned cover, never s3://');

const arbitrary = await inject('PATCH', '/api/v1/songs/song-A', 'PRODUCER', { coverUrl: 'https://evil.example/x.png' });
assert.equal(arbitrary.statusCode, 400, `an arbitrary URL is refused: ${arbitrary.statusCode} ${arbitrary.body}`);
assert.match(arbitrary.body, /cover_must_be_workspace_storage/);
assert.equal(fakes.song.rows[0].coverUrl, 's3://afrohit-studio/ws-A/uploads/cover/c.png', 'the refusal changed nothing');

const foreignCover = await inject('PATCH', '/api/v1/songs/song-A', 'PRODUCER', {
  coverUrl: 's3://afrohit-studio/ws-B/uploads/cover/foreign.png',
});
assert.equal(foreignCover.statusCode, 403, "another workspace's storage ref is refused");
assert.equal(fakes.song.rows[0].coverUrl, 's3://afrohit-studio/ws-A/uploads/cover/c.png', 'still unchanged');

// ---- 4. AI cover: photorealistic prompt, celebrity names stripped ------------
const shared = await import('@afrohit/shared');
const pure = shared.buildPhotorealisticCoverPrompt({
  title: 'Money Dance (like Wizkid, in the style of Burna Boy)',
  genre: 'afrobeats',
  mood: 'feat. Davido energy',
});
for (const name of ['wizkid', 'burna boy', 'davido']) {
  assert.ok(!pure.prompt.toLowerCase().includes(name), `prompt must not contain "${name}"`);
}
assert.ok(pure.stripped.length >= 3, `all three names are reported stripped: ${JSON.stringify(pure.stripped)}`);
assert.match(pure.prompt, /^Photorealistic/, 'the prompt is photorealistic by construction');
assert.match(pure.prompt, /no real person's likeness, no celebrity lookalike/);
assert.match(pure.prompt, /no text, no lettering/);

const generated = await inject('POST', '/api/v1/songs/song-A/cover/generate', 'PRODUCER', {});
assert.equal(generated.statusCode, 202, `AI cover queued: ${generated.statusCode} ${generated.body}`);
const genBody = JSON.parse(generated.body);
assert.ok(genBody.jobId, 'a provider job exists');
assert.ok(genBody.strippedNames.some((n) => /wizkid/i.test(n)), 'the response discloses what was stripped');
const outbox = fakes.jobOutbox.rows.find((r) => r.payload?.songId === 'song-A');
assert.ok(outbox, 'the image queue payload targets the song');
assert.ok(!/wizkid/i.test(outbox.payload.prompt), 'the QUEUED prompt itself carries no celebrity name');
assert.equal(outbox.payload.kind, 'cover');
assert.equal(outbox.payload.size, '1024x1024');
const charge = chargeCalls.find((c) => c.key === 'cover_art_low');
assert.ok(charge && charge.refTable === 'Song' && charge.refId === 'song-A', 'the cover is charged + cost-logged like every AI call');

// ---- 5. Web + worker wiring (source contracts) --------------------------------
const webRoot = join(process.cwd(), '../web');
const nav = readFileSync(join(webRoot, 'components/NavBar.tsx'), 'utf8');
assert.match(nav, /view\.me\?\.avatarUrl \? \(\s*<img src=\{view\.me\.avatarUrl\}/, 'the top bar renders the avatar');
const settingsPage = readFileSync(join(webRoot, 'app/(app)/settings/page.tsx'), 'utf8');
assert.match(settingsPage, /uploadImageToStorage\(file, 'avatar'\)/, 'settings uploads the avatar via the presign flow');
assert.match(settingsPage, /avatarKey: key/, 'settings attaches via PATCH /auth/me');
assert.match(settingsPage, /ProfilePicture/, 'settings renders the avatar section');
const grid = readFileSync(join(webRoot, 'components/CatalogGrid.tsx'), 'utf8');
assert.match(grid, /uploadImageToStorage\(file, "cover"\)/, 'the catalog uploads covers via the presign flow');
assert.match(grid, /coverUrl: assetRef/, 'the catalog attaches the workspace storage ref');
assert.match(grid, /Generate cover/, 'a "Generate cover" button sits next to the upload');
assert.match(grid, /cover\/generate/, 'it calls the AI cover endpoint');
const worker = readFileSync(join(process.cwd(), '../worker/src/processors/image.ts'), 'utf8');
assert.match(worker, /payload\.songId && payload\.kind === 'cover'/, 'the worker stamps Song.coverUrl for song covers');
const cleanup = readFileSync(join(process.cwd(), '../worker/src/processors/asset-cleanup.ts'), 'utf8');
assert.match(cleanup, /song\."coverUrl"/, 'cleanup protects song covers');
assert.match(cleanup, /"avatarUrl"/, 'cleanup protects avatars');
const uploadsSrc = readFileSync(join(process.cwd(), 'src/routes/uploads.ts'), 'utf8');
assert.match(uploadsSrc, /song\."coverUrl"/, 'upload reservations protect song covers');
assert.match(uploadsSrc, /"avatarUrl"/, 'upload reservations protect avatars');

await app.close();
s3stub.close();
console.log('pictures hold: avatar set/cleared with real byte verification, presigned-only display links, workspace-prefix cover law (arbitrary URL 400, foreign ref 403), AI cover queued with celebrity names stripped from the actual payload');

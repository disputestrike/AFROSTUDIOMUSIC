/**
 * RBAC PROOF (identity wave, 2026-07-20) — the role→privilege matrix, enforced
 * by the REAL routes against an in-memory prisma:
 *
 *   VIEWER    cannot mutate anything (songs, projects, beats, settings,
 *             invites, billing) — reads still work.
 *   PRODUCER  makes music (song edit passes) but cannot invite, cannot touch
 *             settings, member roles, or billing, cannot delete songs.
 *   ADMIN     invites members, but cannot change billing or member roles.
 *   OWNER     everything — plus the last-OWNER guard holds.
 *   TENANCY   a workspace-B identity can neither see nor edit workspace-A's
 *             songs, nor switch into workspace A.
 *
 * Run: pnpm --filter @afrohit/api test:rbac
 */
import assert from 'node:assert/strict';

process.env.AUTH_MODE = 'internal';
process.env.JWT_SECRET = 'rbac-test-secret-0123456789abcdef0123456789';
process.env.WEB_URL = 'http://localhost:3000';
delete process.env.ADMIN_EMAILS;

const { buildApp, installFakePrisma, as } = await import('./identity-test-kit.mjs');

const now = new Date();
const songA = {
  id: 'song-A',
  workspaceId: 'ws-A',
  projectId: 'p1',
  title: 'Test Song',
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
  project: { id: 'p1', title: 'P', genre: 'afrobeats', bpm: 110, artist: { stageName: 'BENXP' } },
  masters: [],
  mixes: [],
  beats: [],
  lyric: null,
};

const fakes = installFakePrisma({
  workspace: [
    { id: 'ws-A', name: 'Studio A', slug: 'studio-a', plan: 'PRO', createdAt: now, suspendedAt: null, paypalSubscriptionId: null },
    { id: 'ws-B', name: 'Studio B', slug: 'studio-b', plan: 'STARTER', createdAt: now, suspendedAt: null, paypalSubscriptionId: null },
  ],
  workspaceMember: [
    { id: 'm1', workspaceId: 'ws-A', userId: 'user-A', role: 'OWNER', createdAt: now, workspace: { id: 'ws-A', name: 'Studio A', slug: 'studio-a', plan: 'PRO', createdAt: now, suspendedAt: null } },
    { id: 'm2', workspaceId: 'ws-A', userId: 'user-B', role: 'PRODUCER', createdAt: now, workspace: { id: 'ws-A', name: 'Studio A', slug: 'studio-a', plan: 'PRO', createdAt: now, suspendedAt: null }, user: { email: 'b@x.com', fullName: 'B', avatarUrl: null } },
    { id: 'm3', workspaceId: 'ws-B', userId: 'user-D', role: 'OWNER', createdAt: now, workspace: { id: 'ws-B', name: 'Studio B', slug: 'studio-b', plan: 'STARTER', createdAt: now, suspendedAt: null } },
  ],
  workspaceInvite: [],
  user: [],
  artist: [],
  song: [songA],
  lyricDraft: [],
  songBrief: [],
  imageAsset: [],
  videoConcept: [],
  videoRender: [],
  systemSetting: [],
  providerJob: [],
  jobOutbox: [],
  creditLedger: [],
});

const app = await buildApp();
// Credit + queue seams: charge fails by default so money-spending handlers
// stop deterministically AFTER their role gate (a 402 proves "admitted").
app.decorate('chargeCredits', async () => ({ ok: false, reason: 'test-stub' }));
app.decorate('refundCredits', async () => ({ ok: true }));
app.decorate('queues', { image: { name: 'image', add: async () => ({}) } });

const [{ default: songs }, { default: projects }, { default: beats }, { default: settings }, { default: billing }, { default: workspaces }, { default: images }] =
  await Promise.all([
    import('../src/routes/songs'),
    import('../src/routes/projects'),
    import('../src/routes/beats'),
    import('../src/routes/settings'),
    import('../src/routes/billing'),
    import('../src/routes/workspaces'),
    import('../src/routes/images'),
  ]);

await app.register(songs, { prefix: '/api/v1/songs' });
await app.register(projects, { prefix: '/api/v1/projects' });
await app.register(beats, { prefix: '/api/v1/projects/:projectId/beats' });
await app.register(settings, { prefix: '/api/v1/settings' });
await app.register(billing, { prefix: '/api/v1/billing' });
await app.register(workspaces, { prefix: '/api/v1/workspaces' });
await app.register(images, { prefix: '/api/v1/images' });
await app.ready();

const inject = (method, url, role, body, extra = {}) =>
  app.inject({ method, url, headers: as(role, extra), ...(body === undefined ? {} : { payload: body }) });

// ---- VIEWER: read + play ONLY ----------------------------------------------
for (const [method, url, body] of [
  ['PATCH', '/api/v1/songs/song-A', { title: 'nope' }],
  ['DELETE', '/api/v1/songs/song-A', undefined],
  ['POST', '/api/v1/songs/song-A/cover/generate', {}],
  ['POST', '/api/v1/projects', { title: 'X', genre: 'afrobeats' }],
  ['POST', '/api/v1/projects/p1/beats/generate', { genre: 'afrobeats' }],
  ['PATCH', '/api/v1/settings/integrations', { musicProvider: 'replicate' }],
  ['POST', '/api/v1/workspaces/invites', { email: 'v@x.com', role: 'VIEWER' }],
  ['POST', '/api/v1/billing/subscription/cancel', {}],
  ['PATCH', '/api/v1/images/img-1', { approved: true }],
]) {
  const res = await inject(method, url, 'VIEWER', body);
  assert.equal(res.statusCode, 403, `VIEWER must be refused: ${method} ${url} → ${res.statusCode} ${res.body}`);
}
const viewerRead = await inject('GET', '/api/v1/songs', 'VIEWER');
assert.equal(viewerRead.statusCode, 200, `VIEWER can read the catalog: ${viewerRead.body}`);
const viewerWorkspaces = await inject('GET', '/api/v1/workspaces', 'VIEWER');
assert.equal(viewerWorkspaces.statusCode, 200, 'VIEWER can list their workspaces');

// ---- PRODUCER: makes music; no people/settings/billing power ---------------
for (const [method, url, body] of [
  ['POST', '/api/v1/workspaces/invites', { email: 'p@x.com', role: 'VIEWER' }],
  ['PATCH', '/api/v1/workspaces/members/user-B', { role: 'VIEWER' }],
  ['DELETE', '/api/v1/workspaces/members/user-B', undefined],
  ['POST', '/api/v1/billing/subscription/cancel', {}],
  ['PATCH', '/api/v1/settings/integrations', { musicProvider: 'replicate' }],
  ['DELETE', '/api/v1/songs/song-A', undefined],
  ['PATCH', '/api/v1/images/img-1', { approved: true }],
]) {
  const res = await inject(method, url, 'PRODUCER', body);
  assert.equal(res.statusCode, 403, `PRODUCER must be refused: ${method} ${url} → ${res.statusCode} ${res.body}`);
}
const producerEdit = await inject('PATCH', '/api/v1/songs/song-A', 'PRODUCER', { title: 'Renamed by producer' });
assert.equal(producerEdit.statusCode, 200, `PRODUCER edits songs: ${producerEdit.body}`);
assert.equal(fakes.song.rows[0].title, 'Renamed by producer');
const producerCover = await inject('POST', '/api/v1/songs/song-A/cover/generate', 'PRODUCER', {});
assert.equal(producerCover.statusCode, 402, `PRODUCER passes the cover gate (charge stub → 402): ${producerCover.statusCode} ${producerCover.body}`);

// ---- ADMIN: people yes, money no, member-roles no ---------------------------
for (const [method, url, body, extra] of [
  ['POST', '/api/v1/billing/subscription/cancel', {}, {}],
  ['POST', '/api/v1/billing/checkout/credits', { pack: 'pack_10' }, { headers: { 'idempotency-key': 'rbac-test-1' } }],
  ['PATCH', '/api/v1/workspaces/members/user-B', { role: 'VIEWER' }, {}],
  ['DELETE', '/api/v1/workspaces/members/user-B', undefined, {}],
]) {
  const res = await inject(method, url, 'ADMIN', body, extra);
  assert.equal(res.statusCode, 403, `ADMIN must be refused: ${method} ${url} → ${res.statusCode} ${res.body}`);
}
const adminInvite = await inject('POST', '/api/v1/workspaces/invites', 'ADMIN', { email: 'new@x.com', role: 'PRODUCER' });
assert.equal(adminInvite.statusCode, 201, `ADMIN invites members: ${adminInvite.body}`);
const adminInviteOwner = await inject('POST', '/api/v1/workspaces/invites', 'ADMIN', { email: 'boss@x.com', role: 'OWNER' });
assert.equal(adminInviteOwner.statusCode, 400, 'OWNER is never invitable (schema refuses)');
const adminDelete = await inject('DELETE', '/api/v1/songs/song-A', 'ADMIN');
assert.notEqual(adminDelete.statusCode, 403, `ADMIN may delete songs (gate admits): ${adminDelete.statusCode}`);

// ---- OWNER: everything ------------------------------------------------------
const ownerCancel = await inject('POST', '/api/v1/billing/subscription/cancel', 'OWNER', {});
assert.equal(ownerCancel.statusCode, 400, `OWNER passes the billing gate (no active sub → 400): ${ownerCancel.statusCode} ${ownerCancel.body}`);
const ownerRole = await inject('PATCH', '/api/v1/workspaces/members/user-B', 'OWNER', { role: 'ADMIN' });
assert.equal(ownerRole.statusCode, 200, `OWNER changes member roles: ${ownerRole.body}`);
assert.equal(fakes.workspaceMember.rows.find((m) => m.userId === 'user-B').role, 'ADMIN');
const lastOwner = await inject('PATCH', '/api/v1/workspaces/members/user-A', 'OWNER', { role: 'PRODUCER' });
assert.equal(lastOwner.statusCode, 409, `the last OWNER can never be demoted: ${lastOwner.statusCode} ${lastOwner.body}`);
const ownerCreate = await inject('POST', '/api/v1/workspaces', 'OWNER', { name: 'Second Studio' });
assert.equal(ownerCreate.statusCode, 201, `OWNER creates additional workspaces: ${ownerCreate.body}`);
const ownerInvite = await inject('POST', '/api/v1/workspaces/invites', 'OWNER', { email: 'admin2@x.com', role: 'ADMIN' });
assert.equal(ownerInvite.statusCode, 201, 'OWNER grants ADMIN via invite');

// ---- CROSS-TENANT: workspace B can neither see nor touch A ------------------
const foreignEdit = await inject('PATCH', '/api/v1/songs/song-A', 'OWNER', { title: 'stolen' }, { userId: 'user-D', workspaceId: 'ws-B' });
assert.equal(foreignEdit.statusCode, 404, `cross-tenant song edit reads as not-found: ${foreignEdit.statusCode}`);
assert.notEqual(fakes.song.rows[0].title, 'stolen', 'the foreign edit never ran');
const foreignList = await inject('GET', '/api/v1/songs', 'OWNER', undefined, { userId: 'user-D', workspaceId: 'ws-B' });
assert.equal(foreignList.statusCode, 200);
assert.equal(JSON.parse(foreignList.body).length, 0, "workspace B's catalog never shows workspace A's songs");
const foreignSwitch = await inject('POST', '/api/v1/workspaces/ws-A/switch', 'OWNER', {}, { userId: 'user-D', workspaceId: 'ws-B' });
assert.equal(foreignSwitch.statusCode, 404, `a non-member cannot switch into the workspace: ${foreignSwitch.statusCode}`);
const foreignInvites = await inject('GET', '/api/v1/workspaces/invites', 'ADMIN', undefined, { userId: 'user-D', workspaceId: 'ws-B' });
assert.equal(JSON.parse(foreignInvites.body).length, 0, "workspace B never lists workspace A's invites");

await app.close();
console.log('RBAC matrix holds: VIEWER read-only, PRODUCER makes music only, ADMIN invites but no billing/roles, OWNER everything + last-owner guard, cross-tenant denied');

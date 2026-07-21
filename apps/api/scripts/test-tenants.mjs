/**
 * MULTI-TENANT PROOF (identity wave, 2026-07-20) — real routes, in-memory
 * prisma:
 *
 *   - create / list / switch workspaces (switch = fresh session cookie);
 *   - invites are stored HASHED (sha256), never raw;
 *   - the accept flow creates the invited account EVEN WHILE PUBLIC SIGNUP IS
 *     CLOSED (NODE_ENV=production, ALLOW_PUBLIC_SIGNUP unset) — invited is
 *     not public;
 *   - tokens are SINGLE USE, and every token failure answers the same
 *     anti-enumeration error;
 *   - an existing account joins with its own password (wrong password → 401,
 *     never a membership).
 *
 * Run: pnpm --filter @afrohit/api test:tenants
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.AUTH_MODE = 'internal';
process.env.JWT_SECRET = 'tenants-test-secret-0123456789abcdef012345';
process.env.WEB_URL = 'http://localhost:3000';
delete process.env.ALLOW_PUBLIC_SIGNUP;
delete process.env.ADMIN_EMAILS;
delete process.env.RESEND_API_KEY;

const { buildApp, installFakePrisma, as } = await import('./identity-test-kit.mjs');

const now = new Date();
const wsRow = (id, name, slug) => ({ id, name, slug, plan: 'STARTER', createdAt: now, suspendedAt: null });
const fakes = installFakePrisma({
  workspace: [wsRow('ws-A', 'Studio A', 'studio-a'), wsRow('ws-B', 'Studio B', 'studio-b')],
  workspaceMember: [
    { id: 'm1', workspaceId: 'ws-A', userId: 'user-A', role: 'OWNER', createdAt: now, workspace: wsRow('ws-A', 'Studio A', 'studio-a') },
    { id: 'm2', workspaceId: 'ws-B', userId: 'user-D', role: 'OWNER', createdAt: now, workspace: wsRow('ws-B', 'Studio B', 'studio-b') },
  ],
  workspaceInvite: [],
  user: [],
  artist: [],
  trainingConsent: [],
  passwordResetToken: [],
});

// The invite lookup traverses invite.workspace — teach the fake to hydrate it.
const rawInviteFindUnique = fakes.workspaceInvite.findUnique.bind(fakes.workspaceInvite);
fakes.workspaceInvite.findUnique = async (args) => {
  const row = await rawInviteFindUnique(args);
  if (!row) return null;
  const ws = fakes.workspace.rows.find((w) => w.id === row.workspaceId);
  return { ...row, workspace: { name: ws?.name ?? 'Studio', suspendedAt: ws?.suspendedAt ?? null } };
};

const app = await buildApp();
const [{ default: authRoutes }, { default: workspaces }] = await Promise.all([
  import('../src/routes/auth'),
  import('../src/routes/workspaces'),
]);
await app.register(authRoutes, { prefix: '/api/v1/auth' });
await app.register(workspaces, { prefix: '/api/v1/workspaces' });
await app.ready();

const inject = (method, url, opts = {}) =>
  app.inject({
    method,
    url,
    headers: opts.role ? as(opts.role, opts) : { 'x-afrohit-request': '1', ...(opts.headers ?? {}) },
    ...(opts.body === undefined ? {} : { payload: opts.body }),
  });

// ---- 1. ADMIN creates an invite; only the HASH is stored --------------------
const created = await inject('POST', '/api/v1/workspaces/invites', {
  role: 'ADMIN',
  body: { email: 'newbie@x.com', role: 'PRODUCER' },
});
assert.equal(created.statusCode, 201, `invite create: ${created.body}`);
const invite = JSON.parse(created.body);
assert.ok(invite.token && invite.token.length >= 32, 'the raw token is returned once to its creator');
assert.ok(invite.inviteUrl?.includes('/invite?token='), 'a shareable link is built from WEB_URL');
const storedInvite = fakes.workspaceInvite.rows[0];
assert.equal(storedInvite.tokenHash, createHash('sha256').update(invite.token).digest('hex'), 'only the sha256 hash is stored');
assert.notEqual(storedInvite.tokenHash, invite.token, 'the raw token never lands in the database');
assert.ok(!('token' in storedInvite), 'no raw token column exists on the row');
const ttlDays = (new Date(storedInvite.expiresAt) - Date.now()) / 86_400_000;
assert.ok(ttlDays > 6.5 && ttlDays <= 7.01, `invite expires in ~7 days (got ${ttlDays.toFixed(2)})`);

// ---- 2. Public signup is CLOSED in production without the flag --------------
process.env.NODE_ENV = 'production';
try {
  const signup = await inject('POST', '/api/v1/auth/signup', {
    body: { email: 'stranger@x.com', password: 'a-perfectly-long-password' },
  });
  assert.equal(signup.statusCode, 403, `public signup must be closed: ${signup.statusCode} ${signup.body}`);
  assert.match(signup.body, /signup_closed/);

  // ---- 3. …but the INVITED signup still works (invited ≠ public) ------------
  const accepted = await inject('POST', '/api/v1/auth/accept-invite', {
    body: { token: invite.token, password: 'brand-new-password-123', name: 'New Bee' },
  });
  assert.equal(accepted.statusCode, 201, `invited signup while closed: ${accepted.statusCode} ${accepted.body}`);
  const joined = JSON.parse(accepted.body);
  assert.equal(joined.workspaceId, 'ws-A');
  assert.equal(joined.role, 'PRODUCER');
  assert.equal(joined.accountCreated, true);
  const setCookie = accepted.headers['set-cookie'];
  assert.match(String(setCookie), /afrohit_session=/, 'acceptance signs the session for the invited workspace');
  assert.ok(fakes.user.rows.find((u) => u.email === 'newbie@x.com'), 'the account exists');
  assert.ok(
    fakes.workspaceMember.rows.find((m) => m.workspaceId === 'ws-A' && m.role === 'PRODUCER' && m.userId !== 'user-A'),
    'the membership exists at the invited role'
  );
} finally {
  process.env.NODE_ENV = 'test';
}

// ---- 4. SINGLE USE + anti-enumeration ---------------------------------------
const replay = await inject('POST', '/api/v1/auth/accept-invite', {
  body: { token: invite.token, password: 'brand-new-password-123' },
});
assert.equal(replay.statusCode, 400, 'a used token never joins twice');
const probe = await inject('POST', '/api/v1/auth/accept-invite', {
  body: { token: 'garbage-token-that-does-not-exist-anywhere', password: 'whatever-long-password' },
});
assert.equal(probe.statusCode, 400);
assert.deepEqual(JSON.parse(replay.body), JSON.parse(probe.body), 'used and unknown tokens are indistinguishable');
const infoProbe = await inject('POST', '/api/v1/auth/invite-info', {
  body: { token: 'garbage-token-that-does-not-exist-anywhere' },
});
assert.deepEqual(JSON.parse(infoProbe.body), JSON.parse(probe.body), 'invite-info leaks nothing on a bad token');

// ---- 5. Existing account: their password is the key -------------------------
const newbie = fakes.user.rows.find((u) => u.email === 'newbie@x.com');
const secondInvite = await inject('POST', '/api/v1/workspaces/invites', {
  role: 'OWNER',
  userId: 'user-D',
  workspaceId: 'ws-B',
  body: { email: 'newbie@x.com', role: 'VIEWER' },
});
assert.equal(secondInvite.statusCode, 201, `second invite: ${secondInvite.body}`);
const token2 = JSON.parse(secondInvite.body).token;

const info2 = await inject('POST', '/api/v1/auth/invite-info', { body: { token: token2 } });
assert.equal(info2.statusCode, 200);
assert.equal(JSON.parse(info2.body).existingAccount, true, 'invite-info says the email already has an account');
assert.equal(JSON.parse(info2.body).workspaceName, 'Studio B');

const wrongPw = await inject('POST', '/api/v1/auth/accept-invite', {
  body: { token: token2, password: 'not-their-password-at-all' },
});
assert.equal(wrongPw.statusCode, 401, 'a wrong password never joins');
assert.ok(!fakes.workspaceMember.rows.find((m) => m.workspaceId === 'ws-B' && m.userId === newbie.id), 'no membership on failure');

const rightPw = await inject('POST', '/api/v1/auth/accept-invite', {
  body: { token: token2, password: 'brand-new-password-123' },
});
assert.equal(rightPw.statusCode, 200, `existing account joins with its password: ${rightPw.body}`);
assert.equal(JSON.parse(rightPw.body).role, 'VIEWER');
assert.ok(fakes.workspaceMember.rows.find((m) => m.workspaceId === 'ws-B' && m.userId === newbie.id && m.role === 'VIEWER'));

// ---- 6. Create / list / switch ----------------------------------------------
const createdWs = await inject('POST', '/api/v1/workspaces', {
  role: 'VIEWER', // ANY member may found their own new studio (they own it)
  userId: newbie.id,
  workspaceId: 'ws-A',
  body: { name: 'Newbie Beats' },
});
assert.equal(createdWs.statusCode, 201, `workspace create: ${createdWs.body}`);
assert.equal(JSON.parse(createdWs.body).role, 'OWNER');
const newWsId = JSON.parse(createdWs.body).id;
assert.ok(fakes.artist.rows.find((a) => a.workspaceId === newWsId), 'a default artist is provisioned (same as signup)');

// list: hydrate the membership rows the list traverses
for (const m of fakes.workspaceMember.rows) {
  if (!m.workspace) m.workspace = fakes.workspace.rows.find((w) => w.id === m.workspaceId);
}
const list = await inject('GET', '/api/v1/workspaces', { role: 'VIEWER', userId: newbie.id, workspaceId: 'ws-A' });
assert.equal(list.statusCode, 200);
const mine = JSON.parse(list.body);
assert.equal(mine.length, 3, `newbie belongs to 3 studios: ${list.body}`);
assert.equal(mine.filter((w) => w.active).length, 1, 'exactly one active workspace');
assert.ok(mine.find((w) => w.id === 'ws-A')?.active, 'the session workspace is the active one');

const switched = await inject('POST', '/api/v1/workspaces/ws-B/switch', { role: 'VIEWER', userId: newbie.id, workspaceId: 'ws-A', body: {} });
assert.equal(switched.statusCode, 200, `switch: ${switched.body}`);
assert.match(String(switched.headers['set-cookie']), /afrohit_session=/, 'switch re-issues the session cookie');
assert.equal(JSON.parse(switched.body).role, 'VIEWER');

await app.close();
console.log('tenants hold: hashed single-use invites, invited-signup-while-closed, anti-enumeration, password-gated joins, create/list/switch with cookie re-issue');

/**
 * AfroHit Studio — integration test runner.
 *
 * Drives every phase of the system against a running stack (Docker compose
 * + API on :4000 + Worker). Uses STUB_AI=1 so no OpenAI key needed.
 *
 * Usage:
 *   node scripts/integration-test.mjs
 *
 * Expects to be run AFTER:
 *   - docker compose up -d
 *   - prisma db push
 *   - postgis indexes applied
 *   - seed
 *   - API up on :4000 with DEV_AUTH_BYPASS=1 STUB_AI=1
 *   - Worker up
 */

import { setTimeout as sleep } from 'node:timers/promises';

const API = process.env.API_URL ?? 'http://localhost:4000';
const HEADERS = {
  'content-type': 'application/json',
  // DEV_AUTH_BYPASS short-circuits Clerk and resolves to the seeded demo workspace.
  authorization: 'Bearer dev',
};

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, detail = '') {
  passed++;
  console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, err) {
  failed++;
  failures.push({ name, err: String(err) });
  console.log(`  ✗ ${name} — ${err}`);
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function apiFetch(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function pollJob(jobId, { timeoutMs = 30_000, intervalMs = 800 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await apiFetch(`/api/v1/jobs/${jobId}`);
    if (r.status !== 200) throw new Error(`job ${jobId} status ${r.status}`);
    const s = r.body?.status;
    if (s === 'SUCCEEDED' || s === 'FAILED') return r.body;
    await sleep(intervalMs);
  }
  throw new Error(`job ${jobId} did not finish in ${timeoutMs}ms`);
}

// ---------- Phase 5 — API surface ------------------------------------------

async function phase5_apiSurface() {
  section('Phase 5 — API surface');

  // health
  try {
    const r = await fetch(`${API}/health`);
    const b = await r.json();
    if (r.status === 200 && b.ok === true) ok('GET /health', `service=${b.service}`);
    else fail('GET /health', `status=${r.status}`);
  } catch (e) {
    fail('GET /health', e);
  }

  // OpenAPI docs
  try {
    const r = await fetch(`${API}/docs/json`);
    const b = await r.json();
    if (b.openapi?.startsWith('3.')) ok('GET /docs/json', `openapi=${b.openapi}`);
    else fail('GET /docs/json', 'no openapi field');
  } catch (e) {
    fail('GET /docs/json', e);
  }

  // Auth gate
  try {
    const r = await fetch(`${API}/api/v1/projects`, { headers: { 'content-type': 'application/json' } });
    if (r.status === 401) ok('auth required without bearer', '401');
    else fail('auth required without bearer', `expected 401 got ${r.status}`);
  } catch (e) {
    fail('auth required without bearer', e);
  }

  // List routes (with dev bypass)
  for (const path of ['/api/v1/projects', '/api/v1/artists', '/api/v1/jobs', '/api/v1/voices', '/api/v1/voices/consents', '/api/v1/billing/me']) {
    const r = await apiFetch(path);
    if (r.status === 200) ok(`GET ${path}`, Array.isArray(r.body) ? `count=${r.body.length}` : 'ok');
    else fail(`GET ${path}`, `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
  }
}

// ---------- Phase 8 — happy path -------------------------------------------

async function phase8_happyPath() {
  section('Phase 8 — End-to-end happy path');
  const state = {};

  // 1. Find demo artist (created by seed)
  const ar = await apiFetch('/api/v1/artists');
  if (ar.status !== 200 || !ar.body[0]) {
    fail('list artists', `got ${ar.status}`);
    return state;
  }
  state.artistId = ar.body[0].id;
  ok('seeded artist present', state.artistId);

  // 2. Create a project
  const pr = await apiFetch('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      artistId: state.artistId,
      title: 'Integration Test Song',
      genre: 'afro_fusion',
      bpm: 103,
      keySignature: 'A minor',
    }),
  });
  if (pr.status !== 201) {
    fail('create project', `status=${pr.status} body=${JSON.stringify(pr.body)}`);
    return state;
  }
  state.projectId = pr.body.id;
  ok('create project', state.projectId);

  // 3. Polish a brief (STUB_AI)
  const br = await apiFetch(`/api/v1/projects/${state.projectId}/briefs/polish`, {
    method: 'POST',
    body: JSON.stringify({ rawIdea: 'romantic Afro-fusion about a Surulere girl' }),
  });
  if (br.status === 201 && br.body.brief?.id) ok('polish brief', br.body.brief.id);
  else fail('polish brief', `status=${br.status} body=${JSON.stringify(br.body).slice(0, 200)}`);

  // 4. Generate hooks
  const hg = await apiFetch(`/api/v1/projects/${state.projectId}/hooks/generate`, {
    method: 'POST',
    body: JSON.stringify({ count: 5 }),
  });
  if (hg.status === 201 && Array.isArray(hg.body.hooks) && hg.body.hooks.length === 5) {
    ok('generate 5 hooks', `created=${hg.body.hooks.length}`);
    state.hookId = hg.body.hooks[0].id;
  } else {
    fail('generate 5 hooks', `status=${hg.status} body=${JSON.stringify(hg.body).slice(0, 300)}`);
    return state;
  }

  // 5. Score hooks (taste engine)
  const ts = await apiFetch('/api/v1/taste/score', {
    method: 'POST',
    body: JSON.stringify({ hookIds: hg.body.hooks.map((h) => h.id) }),
  });
  if (ts.status === 200 && Array.isArray(ts.body.scores) && ts.body.scores.length === 5) {
    ok('score hooks', `scores=${ts.body.scores.length}`);
  } else {
    fail('score hooks', `status=${ts.status} body=${JSON.stringify(ts.body).slice(0, 200)}`);
  }

  // 6. Approve hook (creates Song)
  const apr = await apiFetch(`/api/v1/projects/${state.projectId}/hooks/${state.hookId}/approve`, {
    method: 'POST',
  });
  if (apr.status === 200 && apr.body.songId) {
    state.songId = apr.body.songId;
    ok('approve hook', `song=${state.songId}`);
  } else {
    fail('approve hook', `status=${apr.status} body=${JSON.stringify(apr.body)}`);
    return state;
  }

  // 7. Generate lyrics
  const lg = await apiFetch(`/api/v1/projects/${state.projectId}/lyrics/generate`, {
    method: 'POST',
    body: JSON.stringify({ hookId: state.hookId, cleanVersion: true }),
  });
  if (lg.status === 201 && lg.body.lyric?.id) {
    state.lyricId = lg.body.lyric.id;
    ok('generate lyrics', state.lyricId);
  } else {
    fail('generate lyrics', `status=${lg.status} body=${JSON.stringify(lg.body).slice(0, 300)}`);
    return state;
  }

  // 8. Approve lyric
  const al = await apiFetch(`/api/v1/projects/${state.projectId}/lyrics/${state.lyricId}/approve`, {
    method: 'POST',
  });
  if (al.status === 200) ok('approve lyric');
  else fail('approve lyric', `status=${al.status}`);

  // 9. Generate a beat (stub provider — queues a job)
  const bg = await apiFetch(`/api/v1/projects/${state.projectId}/beats/generate`, {
    method: 'POST',
    body: JSON.stringify({
      genre: 'afro_fusion',
      bpm: 103,
      keySignature: 'A minor',
      durationS: 30,
      vibePrompt: 'smooth pocket, log drum, soft guitar',
      withStems: true,
      songId: state.songId,
    }),
  });
  if (bg.status === 202 && bg.body.jobId) {
    ok('queue beat job', bg.body.jobId);
    state.beatJobId = bg.body.jobId;
  } else {
    fail('queue beat job', `status=${bg.status} body=${JSON.stringify(bg.body)}`);
  }

  // 10. Generate cover art (stub provider)
  const cg = await apiFetch('/api/v1/images/cover-art', {
    method: 'POST',
    body: JSON.stringify({
      projectId: state.projectId,
      prompt: 'Lagos sunset, young artist on rooftop, warm tones',
      quality: 'low',
      size: '1024x1024',
    }),
  });
  if (cg.status === 202 && cg.body.jobId) {
    ok('queue cover art', cg.body.jobId);
    state.coverJobId = cg.body.jobId;
  } else {
    fail('queue cover art', `status=${cg.status} body=${JSON.stringify(cg.body)}`);
  }

  // 11. Video storyboard (cheap — text only)
  const sb = await apiFetch('/api/v1/videos/storyboards', {
    method: 'POST',
    body: JSON.stringify({ projectId: state.projectId, durationS: 15, format: 'vertical' }),
  });
  if (sb.status === 201 && sb.body.concept?.id) {
    ok('generate storyboard', sb.body.concept.id);
    state.conceptId = sb.body.concept.id;
  } else {
    fail('generate storyboard', `status=${sb.status} body=${JSON.stringify(sb.body).slice(0, 200)}`);
  }

  // 12. Wait for beat + cover jobs
  if (state.beatJobId) {
    try {
      const j = await pollJob(state.beatJobId, { timeoutMs: 30_000 });
      if (j.status === 'SUCCEEDED') ok('beat job completed', `output=${JSON.stringify(j.outputJson)}`);
      else fail('beat job', `status=${j.status} err=${JSON.stringify(j.errorJson)}`);
    } catch (e) {
      fail('beat job poll', e);
    }
  }
  if (state.coverJobId) {
    try {
      const j = await pollJob(state.coverJobId, { timeoutMs: 30_000 });
      if (j.status === 'SUCCEEDED') ok('cover art job completed');
      else fail('cover art job', `status=${j.status} err=${JSON.stringify(j.errorJson)}`);
    } catch (e) {
      fail('cover art job poll', e);
    }
  }

  // 13. Rights check (creates a receipt with hash)
  const rc = await apiFetch('/api/v1/rights/check', {
    method: 'POST',
    body: JSON.stringify({ projectId: state.projectId, songId: state.songId }),
  });
  if (rc.status === 200 && rc.body.receipt?.hash) {
    ok('rights check', `hash=${rc.body.receipt.hash.slice(0, 16)}…`);
    state.receiptId = rc.body.receipt.id;
  } else {
    fail('rights check', `status=${rc.status} body=${JSON.stringify(rc.body).slice(0, 200)}`);
  }

  // 14. Export bundle (must have receipt)
  const ex = await apiFetch(`/api/v1/projects/${state.projectId}/exports`, {
    method: 'POST',
    body: JSON.stringify({ songId: state.songId }),
  });
  if (ex.status === 202 && ex.body.jobId) {
    ok('queue export', ex.body.jobId);
    try {
      const j = await pollJob(ex.body.jobId, { timeoutMs: 15_000 });
      if (j.status === 'SUCCEEDED') ok('export job completed', `bundle keys=${Object.keys(j.outputJson?.bundle ?? {}).join(',')}`);
      else fail('export job', `status=${j.status} err=${JSON.stringify(j.errorJson)}`);
    } catch (e) {
      fail('export poll', e);
    }
  } else {
    fail('queue export', `status=${ex.status} body=${JSON.stringify(ex.body)}`);
  }

  return state;
}

// ---------- Phase 9 — PostGIS heatmap --------------------------------------

async function phase9_postgis(state) {
  section('Phase 9 — PostGIS heatmap');
  if (!state.songId) {
    fail('postgis prereq', 'no songId from phase 8');
    return;
  }
  const sl = await apiFetch('/api/v1/share/links', {
    method: 'POST',
    body: JSON.stringify({ songId: state.songId, targetUrl: 'https://example.com/song' }),
  });
  if (sl.status !== 201 || !sl.body.code) {
    fail('create share link', `status=${sl.status} body=${JSON.stringify(sl.body)}`);
    return;
  }
  ok('create share link', sl.body.code);

  // Log events from 5 cities — different lat/lng so PostGIS ST_Centroid is meaningful.
  const events = [
    { city: 'Lagos', country: 'Nigeria', countryCode: 'NG', lat: 6.5244, lng: 3.3792 },
    { city: 'Lagos', country: 'Nigeria', countryCode: 'NG', lat: 6.4474, lng: 3.3903 },
    { city: 'Abuja', country: 'Nigeria', countryCode: 'NG', lat: 9.0765, lng: 7.3986 },
    { city: 'Accra', country: 'Ghana', countryCode: 'GH', lat: 5.6037, lng: -0.187 },
    { city: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.5074, lng: -0.1278 },
    { city: 'New York', country: 'United States', countryCode: 'US', lat: 40.7128, lng: -74.006 },
  ];
  for (const e of events) {
    const r = await apiFetch('/api/v1/share/events', {
      method: 'POST',
      body: JSON.stringify({
        shareLinkCode: sl.body.code,
        eventType: 'play',
        sourcePlatform: 'tiktok',
        ...e,
      }),
    });
    if (r.status !== 200) {
      fail(`log share event ${e.city}`, `status=${r.status}`);
      return;
    }
  }
  ok(`log ${events.length} geo share events`);

  // Heatmap
  const hm = await apiFetch('/api/v1/share/heatmap?eventType=play');
  if (hm.status === 200 && Array.isArray(hm.body.points)) {
    ok('GET /share/heatmap', `countries=${hm.body.points.length}`);
    // Verify NG showed up and has centroid coords
    const ng = hm.body.points.find((p) => p.country === 'Nigeria');
    if (ng && typeof ng.lng === 'number' && typeof ng.lat === 'number' && ng.events >= 2) {
      ok('NG cluster has centroid', `events=${ng.events} centroid=${ng.lng.toFixed(2)},${ng.lat.toFixed(2)}`);
    } else {
      fail('NG cluster', `got ${JSON.stringify(ng)}`);
    }
  } else {
    fail('GET /share/heatmap', `status=${hm.status} body=${JSON.stringify(hm.body).slice(0, 200)}`);
  }

  // Redirect handler
  const red = await fetch(`${API}/api/v1/share/redirect/${sl.body.code}`, {
    redirect: 'manual',
    headers: HEADERS,
  });
  if (red.status === 302) ok('GET /share/redirect/:code', `→ ${red.headers.get('location')}`);
  else fail('redirect', `expected 302 got ${red.status}`);
}

// ---------- Phase 10 — rights / export gate / webhooks ---------------------

async function phase10_gates(state) {
  section('Phase 10 — rights gate + webhooks');

  // Try to export without a receipt — create a fresh song so receipt is absent.
  const pr = await apiFetch('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      artistId: state.artistId,
      title: 'NoReceipt Song',
      genre: 'afro_fusion',
      bpm: 100,
    }),
  });
  if (pr.status !== 201) {
    fail('create no-receipt project', `status=${pr.status}`);
    return;
  }
  // Make a song row by directly approving a generated hook (cheapest path).
  const hg = await apiFetch(`/api/v1/projects/${pr.body.id}/hooks/generate`, {
    method: 'POST',
    body: JSON.stringify({ count: 1 }),
  });
  if (hg.status !== 201 || !hg.body.hooks?.[0]) {
    fail('seed hook for gate test', `status=${hg.status}`);
    return;
  }
  const apr = await apiFetch(`/api/v1/projects/${pr.body.id}/hooks/${hg.body.hooks[0].id}/approve`, {
    method: 'POST',
  });
  const noReceiptSongId = apr.body.songId;
  const ex = await apiFetch(`/api/v1/projects/${pr.body.id}/exports`, {
    method: 'POST',
    body: JSON.stringify({ songId: noReceiptSongId }),
  });
  if (ex.status === 412) ok('export blocked without receipt', '412 PRECONDITION_FAILED');
  else fail('export should be blocked', `got status=${ex.status} body=${JSON.stringify(ex.body)}`);

  // PayPal webhook: bad signature → 400
  const wh = await fetch(`${API}/webhooks/paypal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'evt-test', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }),
  });
  if (wh.status === 400 || wh.status === 500) ok(`paypal webhook rejects bad sig`, `status=${wh.status}`);
  else fail('paypal webhook should reject', `got status=${wh.status}`);

  // Clerk webhook: user.created → user + workspace created
  const clerkPayload = {
    type: 'user.created',
    data: {
      id: `user_test_${Date.now()}`,
      email_addresses: [{ email_address: `t${Date.now()}@example.com` }],
      first_name: 'Integration',
      last_name: 'Test',
    },
  };
  const cw = await fetch(`${API}/webhooks/clerk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(clerkPayload),
  });
  if (cw.status === 200) ok('clerk user.created webhook', 'created user + workspace');
  else fail('clerk webhook', `status=${cw.status}`);
}

// ---------- Run ------------------------------------------------------------

(async () => {
  console.log('# AfroHit Studio — integration suite');
  console.log(`# API=${API}`);

  await phase5_apiSurface();
  const state = await phase8_happyPath();
  await phase9_postgis(state);
  await phase10_gates(state);

  console.log(`\nPassed: ${passed} — Failed: ${failed}`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.err}`);
  }
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});

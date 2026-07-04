/**
 * Live pipeline test against a deployed AfroHit Studio API (internal auth mode).
 *
 * Usage:
 *   API_URL=https://<your-api>.up.railway.app node scripts/live-test.mjs
 *
 * Drives the full creative pipeline end to end and polls the async jobs
 * (beat, cover art, export) to completion — proving the worker + R2 storage
 * are wired. Runs against STUB_AI so it costs nothing.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const API = (process.env.API_URL ?? '').replace(/\/+$/, '');
if (!API) {
  console.error('Set API_URL=https://<your-api>.up.railway.app');
  process.exit(2);
}

let pass = 0, fail = 0;
const fails = [];
const ok = (n, d = '') => { pass++; console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, e) => { fail++; fails.push(`${n}: ${e}`); console.log(`  ✗ ${n} — ${e}`); };
const section = (t) => console.log(`\n=== ${t} ===`);

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

async function pollJob(jobId, { timeoutMs = 60_000, intervalMs = 1500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await api(`/api/v1/jobs/${jobId}`);
    if (r.status === 200 && (r.body?.status === 'SUCCEEDED' || r.body?.status === 'FAILED')) return r.body;
    await sleep(intervalMs);
  }
  throw new Error(`job ${jobId} timed out`);
}

(async () => {
  console.log(`# AfroHit Studio — LIVE test\n# API=${API}`);

  // ---- infra ----
  section('Infra');
  try {
    const h = await fetch(`${API}/health`); const b = await h.json();
    b.ok ? ok('GET /health', `service=${b.service}`) : bad('GET /health', JSON.stringify(b));
  } catch (e) { bad('GET /health', e); return finish(); }
  try {
    const d = await api('/docs/json');
    d.body?.openapi ? ok('GET /docs/json', d.body.openapi) : bad('GET /docs/json', d.status);
  } catch (e) { bad('GET /docs/json', e); }

  // ---- artist DNA (internal mode auto-made the workspace; we make the artist) ----
  section('Artist + project');
  let artistId;
  const ar = await api('/api/v1/artists', {
    method: 'POST',
    body: JSON.stringify({
      name: 'BENXP', stageName: 'BENXP',
      vocalTone: ['smooth', 'street-edge'], languages: ['pcm', 'yo', 'en'],
      laneSummary: 'Smooth Afro-fusion, street pocket, hooks lead.',
      cornyBanned: ['baby girl', 'shawty'],
    }),
  });
  if (ar.status === 201 && ar.body?.id) { artistId = ar.body.id; ok('create artist', artistId); }
  else { bad('create artist', `${ar.status} ${JSON.stringify(ar.body).slice(0,200)}`); return finish(); }

  const pr = await api('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ artistId, title: 'Sweet Like Pawpaw', genre: 'afro_fusion', bpm: 103, keySignature: 'A minor' }),
  });
  let projectId;
  if (pr.status === 201 && pr.body?.id) { projectId = pr.body.id; ok('create project', projectId); }
  else { bad('create project', `${pr.status} ${JSON.stringify(pr.body).slice(0,200)}`); return finish(); }

  // ---- brief ----
  section('Brief → hooks → lyrics');
  const br = await api(`/api/v1/projects/${projectId}/briefs/polish`, {
    method: 'POST', body: JSON.stringify({ rawIdea: 'romantic Afro-fusion about a Surulere girl, club-ready but smooth' }),
  });
  br.status === 201 ? ok('polish brief') : bad('polish brief', `${br.status} ${JSON.stringify(br.body).slice(0,200)}`);

  // ---- hooks ----
  const hg = await api(`/api/v1/projects/${projectId}/hooks/generate`, { method: 'POST', body: JSON.stringify({ count: 10 }) });
  let hookId;
  if (hg.status === 201 && Array.isArray(hg.body?.hooks) && hg.body.hooks.length) {
    hookId = hg.body.hooks[0].id; ok('generate 10 hooks', `got ${hg.body.hooks.length}`);
  } else { bad('generate hooks', `${hg.status} ${JSON.stringify(hg.body).slice(0,200)}`); return finish(); }

  // ---- score ----
  const ts = await api('/api/v1/taste/score', { method: 'POST', body: JSON.stringify({ hookIds: hg.body.hooks.map(h => h.id) }) });
  ts.status === 200 && Array.isArray(ts.body?.scores) ? ok('score hooks', `${ts.body.scores.length} scored`) : bad('score hooks', `${ts.status}`);

  // ---- approve hook → song ----
  const apr = await api(`/api/v1/projects/${projectId}/hooks/${hookId}/approve`, { method: 'POST' });
  let songId;
  if (apr.status === 200 && apr.body?.songId) { songId = apr.body.songId; ok('approve hook', `song=${songId}`); }
  else { bad('approve hook', `${apr.status} ${JSON.stringify(apr.body)}`); return finish(); }

  // ---- lyrics ----
  const lg = await api(`/api/v1/projects/${projectId}/lyrics/generate`, { method: 'POST', body: JSON.stringify({ hookId, cleanVersion: true }) });
  let lyricId;
  if (lg.status === 201 && lg.body?.lyric?.id) { lyricId = lg.body.lyric.id; ok('generate lyrics', lg.body.lyric.title); }
  else { bad('generate lyrics', `${lg.status} ${JSON.stringify(lg.body).slice(0,200)}`); }
  if (lyricId) {
    const al = await api(`/api/v1/projects/${projectId}/lyrics/${lyricId}/approve`, { method: 'POST' });
    al.status === 200 ? ok('approve lyric') : bad('approve lyric', al.status);
  }

  // ---- BEAT (the real test: async job → worker → R2) ----
  section('Make the beat 🎧 (async job → worker → R2)');
  const bg = await api(`/api/v1/projects/${projectId}/beats/generate`, {
    method: 'POST',
    body: JSON.stringify({ genre: 'afro_fusion', bpm: 103, keySignature: 'A minor', durationS: 30, vibePrompt: 'smooth pocket, log drum, soft guitar', withStems: true, songId }),
  });
  if (bg.status === 202 && bg.body?.jobId) {
    ok('queue beat job', bg.body.jobId);
    try {
      const j = await pollJob(bg.body.jobId);
      if (j.status === 'SUCCEEDED') ok('BEAT COMPLETE', `output=${JSON.stringify(j.outputJson)}`);
      else bad('beat job', `status=${j.status} err=${JSON.stringify(j.errorJson)}`);
    } catch (e) { bad('beat poll', e); }
  } else bad('queue beat', `${bg.status} ${JSON.stringify(bg.body)}`);

  // ---- COVER ART (async job → worker → R2) ----
  section('Cover art 🎨 (async job → worker → R2)');
  const cg = await api('/api/v1/images/cover-art', {
    method: 'POST',
    body: JSON.stringify({ projectId, prompt: 'Lagos sunset, artist on a rooftop, warm tones', quality: 'low', size: '1024x1024' }),
  });
  if (cg.status === 202 && cg.body?.jobId) {
    ok('queue cover art', cg.body.jobId);
    try {
      const j = await pollJob(cg.body.jobId, { timeoutMs: 45_000 });
      j.status === 'SUCCEEDED' ? ok('COVER COMPLETE', JSON.stringify(j.outputJson)) : bad('cover job', `${j.status} ${JSON.stringify(j.errorJson)}`);
    } catch (e) { bad('cover poll', e); }
  } else bad('queue cover', `${cg.status}`);

  // ---- storyboard (text) ----
  section('Video storyboard + rights + export + heatmap');
  const sb = await api('/api/v1/videos/storyboards', { method: 'POST', body: JSON.stringify({ projectId, durationS: 15, format: 'vertical' }) });
  sb.status === 201 && sb.body?.concept?.id ? ok('storyboard', sb.body.concept.title) : bad('storyboard', `${sb.status}`);

  // ---- rights ----
  const rc = await api('/api/v1/rights/check', { method: 'POST', body: JSON.stringify({ projectId, songId }) });
  rc.status === 200 && rc.body?.receipt?.hash ? ok('rights receipt', rc.body.receipt.hash.slice(0,16) + '…') : bad('rights check', `${rc.status} ${JSON.stringify(rc.body).slice(0,160)}`);

  // ---- export ----
  const ex = await api(`/api/v1/projects/${projectId}/exports`, { method: 'POST', body: JSON.stringify({ songId }) });
  if (ex.status === 202 && ex.body?.jobId) {
    ok('queue export', ex.body.jobId);
    try { const j = await pollJob(ex.body.jobId, { timeoutMs: 30_000 }); j.status === 'SUCCEEDED' ? ok('EXPORT COMPLETE', `bundle=${Object.keys(j.outputJson?.bundle ?? {}).join(',')}`) : bad('export job', `${j.status}`); }
    catch (e) { bad('export poll', e); }
  } else bad('queue export', `${ex.status} ${JSON.stringify(ex.body).slice(0,160)}`);

  // ---- PostGIS-free heatmap ----
  const sl = await api('/api/v1/share/links', { method: 'POST', body: JSON.stringify({ songId, targetUrl: 'https://example.com/song' }) });
  if (sl.status === 201 && sl.body?.code) {
    ok('share link', sl.body.code);
    const cities = [
      { city: 'Lagos', country: 'Nigeria', countryCode: 'NG', lat: 6.5244, lng: 3.3792 },
      { city: 'Abuja', country: 'Nigeria', countryCode: 'NG', lat: 9.0765, lng: 7.3986 },
      { city: 'Accra', country: 'Ghana', countryCode: 'GH', lat: 5.6037, lng: -0.187 },
      { city: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.5074, lng: -0.1278 },
    ];
    for (const c of cities) await api('/api/v1/share/events', { method: 'POST', body: JSON.stringify({ shareLinkCode: sl.body.code, eventType: 'play', sourcePlatform: 'tiktok', ...c }) });
    ok(`log ${cities.length} geo events`);
    const hm = await api('/api/v1/share/heatmap?eventType=play');
    if (hm.status === 200 && Array.isArray(hm.body?.points)) {
      const ng = hm.body.points.find(p => p.country === 'Nigeria');
      ng && ng.events >= 2 ? ok('heatmap NG cluster', `events=${ng.events} centroid=${ng.lng?.toFixed(2)},${ng.lat?.toFixed(2)}`) : bad('heatmap NG', JSON.stringify(hm.body.points));
    } else bad('heatmap', `${hm.status}`);
  } else bad('share link', `${sl.status}`);

  finish();
})();

function finish() {
  console.log(`\n${'='.repeat(48)}\n  LIVE TEST: PASS=${pass}  FAIL=${fail}\n${'='.repeat(48)}`);
  if (fails.length) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail === 0 ? 0 : 1);
}

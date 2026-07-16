#!/usr/bin/env node
/**
 * EVAL HARNESS v1 — measure the studio's creative quality over time.
 *
 * Runs a fixed GOLDEN SET of briefs across genres through the real pipeline
 * (hooks + A&R scoring with viral dimensions), and writes a dated scorecard to
 * docs/APEX/scorecards/. Run it after any prompt/DNA/model change and DIFF the
 * scorecards — "it got better" becomes a measured fact, not a vibe.
 *
 *   node scripts/eval-harness.mjs                      # hooks-only (cheap, default)
 *   node scripts/eval-harness.mjs --genres pop,drill   # subset
 *   API_BASE=https://afrohitapi-production.up.railway.app node scripts/eval-harness.mjs
 *
 * Cost-aware by design: hooks-only (~$0.02/genre). It does NOT render audio.
 * (Full-render eval is a deliberate manual decision — audio costs real money.)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = (process.env.API_BASE ?? 'http://localhost:4000') + '/api/v1';

// The golden set: one culturally-anchored brief per genre. FIXED — never edit
// casually, or scorecards stop being comparable across runs.
const GOLDEN = {
  afrobeats: 'Late-night Lagos love song — confident but tender, log-drum bounce, for the club and the ride home.',
  amapiano: 'Sunset rooftop groove — patient log-drum build, chantable hook, dance-challenge ready.',
  afro_fusion: 'Long-distance love across Lagos and London — warm, bittersweet, mid-tempo.',
  street_pop: 'Hustle anthem for the trenches — triumphant, chant-heavy, zanku energy.',
  gospel: 'Sunday-morning gratitude — testimony of surviving a hard year, call-and-response praise.',
  hip_hop: 'Cold-open flex about building from nothing — hard drums, quotable punchlines.',
  pop: 'Summer situationship anthem — glossy, bittersweet, made to scream in the car.',
  rnb: ' 2am apology text you never sent — intimate, airy falsetto, slow burn.',
  drill: 'Gritty comeback story — sliding 808s, icy confidence, no names named.',
  reggaeton: 'Beach-party perreo with a heartbreak underneath — dembow bounce, bilingual hook.',
  house: 'Lost-in-the-crowd euphoria at 4am — soulful vocal chops, hands-up drop.',
  soul: 'Letter to my younger self — warm keys, live-band feel, one devastating hook line.',
};

const args = process.argv.slice(2);
const genreArg = args.includes('--genres') ? args[args.indexOf('--genres') + 1] : null;
const genres = genreArg ? genreArg.split(',').map((s) => s.trim()) : Object.keys(GOLDEN);

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const rows = [];
for (const genre of genres) {
  const brief = GOLDEN[genre];
  if (!brief) { console.warn(`no golden brief for ${genre} — skipped`); continue; }
  process.stdout.write(`eval ${genre.padEnd(12)} … `);
  try {
    const project = await api('/projects', { method: 'POST', body: { title: `EVAL ${genre}`, genre, bpm: 103 } });
    await api(`/projects/${project.id}/briefs/polish`, { method: 'POST', body: { rawIdea: brief } }).catch(() => null);
    const hk = await api(`/projects/${project.id}/hooks/generate`, { method: 'POST', body: { count: 6 } });
    const hooks = (hk.hooks ?? []).map((h) => ({
      score: h.score ?? null,
      viral: h.meta?.viralScore ?? null,
      needsReview: h.meta?.needsNativeReview ?? false,
    }));
    const scores = hooks.map((h) => h.score).filter((n) => typeof n === 'number');
    const virals = hooks.map((h) => h.viral).filter((n) => typeof n === 'number');
    const row = {
      genre,
      director: hk.director,
      hooks: hooks.length,
      topScore: scores.length ? Math.max(...scores) : null,
      meanScore: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : null,
      topViral: virals.length ? Math.max(...virals) : null,
      meanViral: virals.length ? +(virals.reduce((a, b) => a + b, 0) / virals.length).toFixed(2) : null,
      projectId: project.id,
    };
    rows.push(row);
    console.log(`top ${row.topScore ?? '—'} · viral ${row.topViral ?? '—'} · director ${row.director}`);
    // Clean up the eval project so the catalog stays honest.
    await api(`/projects/${project.id}`, { method: 'DELETE' }).catch(() => null);
  } catch (e) {
    rows.push({ genre, error: String(e.message).slice(0, 160) });
    console.log(`FAILED — ${String(e.message).slice(0, 80)}`);
  }
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const dir = join(process.cwd(), 'docs', 'APEX', 'scorecards');
mkdirSync(dir, { recursive: true });
const ok = rows.filter((r) => !r.error);
const summary = {
  ranAt: new Date().toISOString(),
  apiBase: API,
  genres: rows.length,
  succeeded: ok.length,
  meanTopScore: ok.length ? +(ok.reduce((a, r) => a + (r.topScore ?? 0), 0) / ok.length).toFixed(2) : null,
  meanTopViral: ok.length ? +(ok.reduce((a, r) => a + (r.topViral ?? 0), 0) / ok.length).toFixed(2) : null,
  rows,
};
const file = join(dir, `scorecard-${stamp}.json`);
writeFileSync(file, JSON.stringify(summary, null, 2));
console.log(`\nSCORECARD → ${file}`);
console.log(`genres ${summary.succeeded}/${summary.genres} · mean top A&R ${summary.meanTopScore} · mean top viral ${summary.meanTopViral}`);

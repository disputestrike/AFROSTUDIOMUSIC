/**
 * ENGINE-ADAPTER GATE — no advertised music engine may silently become the stub.
 *
 * The 'beatoven' trap: it was listed in MUSIC_PROVIDERS + .env + docs but had NO
 * case in musicAdapter(), so selecting it fell through to StubMusicAdapter (a
 * SoundHelix placeholder) and shipped a rock sample as an approved Afro beat.
 * This proves every provider the app OFFERS resolves to a real adapter, and that
 * the sung-song engines do too. Exit 1 on regression.
 */
import { musicAdapter, defaultInstrumentalEngine, defaultSongEngine } from '@afrohit/ai';
import { MUSIC_PROVIDERS } from '@afrohit/shared';

let failures = 0;
const fail = (m: string) => { console.error(`FAIL: ${m}`); failures++; };

// REPLICATE-ONLY OPERATOR (Benjamin's exact setup: Replicate key, no Suno). The
// instrumental path must route to a REAL engine on the key that exists, never
// the stub. Save/restore env so the check is hermetic.
{
  const savedMP = process.env.MUSIC_PROVIDER, savedRT = process.env.REPLICATE_API_TOKEN, savedRT2 = process.env.REPLICATE_TOKEN, savedSE = process.env.SONG_ENGINE, savedSK = process.env.SUNO_API_KEY;
  delete process.env.MUSIC_PROVIDER; delete process.env.SONG_ENGINE; delete process.env.SUNO_API_KEY;
  process.env.REPLICATE_API_TOKEN = 'r8_test';
  if (defaultInstrumentalEngine() !== 'replicate') fail(`Replicate-only instrumental should route to 'replicate', got '${defaultInstrumentalEngine()}'`);
  if (musicAdapter(defaultInstrumentalEngine()).name === 'stub') fail('Replicate-only instrumental resolved to the stub adapter');
  if (defaultSongEngine() !== 'ace_step') fail(`Replicate-only (no Suno) song engine should be 'ace_step', got '${defaultSongEngine()}'`);
  // With NO keys at all, instrumental falls to stub (dev) — the processors then fail loudly.
  delete process.env.REPLICATE_API_TOKEN; delete process.env.REPLICATE_TOKEN;
  if (defaultInstrumentalEngine() !== 'stub') fail(`no-keys instrumental should be 'stub' (then blocked at render), got '${defaultInstrumentalEngine()}'`);
  // restore
  if (savedMP !== undefined) process.env.MUSIC_PROVIDER = savedMP;
  if (savedRT !== undefined) process.env.REPLICATE_API_TOKEN = savedRT;
  if (savedRT2 !== undefined) process.env.REPLICATE_TOKEN = savedRT2;
  if (savedSE !== undefined) process.env.SONG_ENGINE = savedSE;
  if (savedSK !== undefined) process.env.SUNO_API_KEY = savedSK;
}

// Every OFFERED instrumental provider (except the explicit 'stub') must map to a
// real adapter — never silently degrade to the placeholder.
for (const p of MUSIC_PROVIDERS) {
  if (p === 'stub') continue;
  const name = musicAdapter(p).name;
  if (name === 'stub') fail(`MUSIC_PROVIDER='${p}' silently resolves to the stub adapter (no real adapter case)`);
}

// The sung-song engines must each be real too.
for (const e of ['suno', 'minimax', 'ace_step', 'minimax_ref', 'replicate']) {
  if (musicAdapter(e).name === 'stub') fail(`song engine '${e}' resolves to the stub adapter`);
}

// beatoven must NOT be advertised any more (it has no adapter).
if ((MUSIC_PROVIDERS as readonly string[]).includes('beatoven')) fail('beatoven is still advertised in MUSIC_PROVIDERS but has no adapter');

// An unknown/typo provider is allowed to resolve to stub (that is the dev
// fallback), but the render processors now BLOCK stub output in production — so
// this only documents the fallback, it is not a silent ship.
if (musicAdapter('totally-not-a-provider').name !== 'stub') {
  console.log('note: unknown provider no longer falls back to stub — ensure it fails loudly instead');
}

if (failures) { console.error(`engine-adapters: ${failures} failure(s)`); process.exit(1); }
console.log(`engine-adapters: all ${MUSIC_PROVIDERS.length} offered providers + 5 song engines resolve to real adapters; no silent-stub trap`);

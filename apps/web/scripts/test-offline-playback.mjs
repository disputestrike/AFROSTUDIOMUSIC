import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// ---- The IndexedDB blob store exists and exposes the offline API. ----------
const store = read('../lib/offline-store.ts');
for (const fn of ['saveSongOffline', 'getOfflineBlobUrl', 'isSavedOffline', 'listOfflineIds', 'removeOffline']) {
  assert.match(store, new RegExp(`export (async )?function ${fn}`), `offline-store must export ${fn}`);
}
// It caches real bytes keyed by song id in IndexedDB — not a fake "saved" flag.
assert.match(store, /indexedDB/, 'offline-store uses IndexedDB');
assert.match(store, /res\.blob\(\)/, 'offline-store downloads and stores the audio blob');
assert.match(store, /URL\.createObjectURL/, 'offline-store returns a playable object URL for the cached blob');

// ---- The player CONSULTS the offline cache first / falls back offline. ------
const player = read('../components/consumer/PlayerContext.tsx');
assert.match(player, /from '@\/lib\/offline-store'/, 'PlayerContext imports the offline store');
assert.match(player, /getOfflineBlobUrl/, 'PlayerContext reads cached blobs from the offline store');
assert.match(player, /navigator\.onLine/, 'PlayerContext checks connectivity to go offline-first');
assert.match(player, /addEventListener\('error'/, 'PlayerContext falls back to the cached blob when the network src errors');
assert.match(player, /revokeObjectURL/, 'PlayerContext revokes object URLs to avoid leaking blobs');

// ---- A minimal, SAFE service worker is registered. -------------------------
assert.ok(existsSync(new URL('../public/sw.js', import.meta.url)), 'public/sw.js must exist');
const sw = read('../public/sw.js');
assert.match(sw, /addEventListener\('install'/, 'sw precaches on install');
assert.match(sw, /addEventListener\('fetch'/, 'sw intercepts fetches');
// SAFETY: the SW must NEVER cache the API proxy or auth — private data stays off any shared cache.
assert.match(sw, /\/backend/, 'sw references the API path to exclude it');
assert.doesNotMatch(sw, /cache\.put\(req\)[^]*\/backend/, 'sw must not cache /backend');
assert.match(sw, /req\.method !== 'GET'/, 'sw only ever touches GET — mutations are never cached');

const reg = read('../components/ServiceWorkerRegister.tsx');
assert.match(reg, /serviceWorker\.register\('\/sw\.js'\)/, 'the registration hook registers /sw.js');
const rootLayout = read('../app/layout.tsx');
assert.match(rootLayout, /ServiceWorkerRegister/, 'the root layout mounts the SW registration');

// ---- The "Save offline" affordance + "offline available" indicator exist. --
const bar = read('../components/consumer/PlayerBar.tsx');
assert.match(bar, /saveSongOffline/, 'the player bar can save the current track offline');
assert.match(bar, /Save for offline|Saved offline/, 'the player bar shows a save-offline control');

const library = read('../app/(app)/library/page.tsx');
assert.match(library, /saveSongOffline/, 'the library can save a song offline');
assert.match(library, /Available offline|offline/, 'the library marks offline-available rows');

console.log('offline playback: IndexedDB store + offline-first player + safe SW registration + save affordance all pass');

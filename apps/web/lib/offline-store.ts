'use client';

/**
 * OFFLINE SONG STORE — "play with no internet" (owner, 2026-07-20).
 *
 * The audio BYTES of a saved song are cached client-side in IndexedDB keyed by
 * song id. This is the reliable half of offline playback: a Blob in IndexedDB
 * survives reloads and needs no network, and the player turns it into an
 * object URL to play with zero connectivity. (A minimal service worker caches
 * the APP SHELL so the page itself opens offline — see public/sw.js — but the
 * SW deliberately never touches the API or these large audio blobs.)
 *
 * Honesty: nothing is faked. If a song was never saved, getOfflineBlobUrl
 * returns null and the UI says so plainly instead of pretending to have it.
 */

const DB_NAME = 'afrohit-offline';
const STORE = 'songs';
const DB_VERSION = 1;

export interface OfflineSongMeta {
  id: string;
  title: string;
  artist: string | null;
  url: string;
  savedAt: number;
  sizeBytes: number;
}

interface OfflineSongRecord extends OfflineSongMeta {
  blob: Blob;
}

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const request = run(t.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('indexeddb tx failed'));
        t.oncomplete = () => db.close();
      }),
  );
}

/**
 * Download a song's master bytes and cache them for offline playback. Fetches
 * the audio directly (no credentials — master URLs are presigned/public refs);
 * a network or CORS failure rejects so the caller can report it honestly rather
 * than mark a song "saved" that was never actually downloaded.
 */
export async function saveSongOffline(input: {
  id: string;
  url: string;
  title: string;
  artist?: string | null;
}): Promise<OfflineSongMeta> {
  if (!hasIDB()) throw new Error('offline storage is not available in this browser');
  const res = await fetch(input.url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`could not download audio (${res.status})`);
  const blob = await res.blob();
  const record: OfflineSongRecord = {
    id: input.id,
    title: input.title,
    artist: input.artist ?? null,
    url: input.url,
    savedAt: Date.now(),
    sizeBytes: blob.size,
    blob,
  };
  await tx('readwrite', (store) => store.put(record));
  const { blob: _omit, ...meta } = record;
  return meta;
}

/** True if this song's audio is cached for offline playback. */
export async function isSavedOffline(id: string): Promise<boolean> {
  if (!hasIDB()) return false;
  try {
    const key = await tx<IDBValidKey | undefined>('readonly', (store) => store.getKey(id));
    return key !== undefined;
  } catch {
    return false;
  }
}

/** All saved song ids — lets a list mark its "offline available" rows in one read. */
export async function listOfflineIds(): Promise<string[]> {
  if (!hasIDB()) return [];
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
    return keys.map((k) => String(k));
  } catch {
    return [];
  }
}

/**
 * An object URL for the cached blob, or null when the song was never saved.
 * The caller OWNS the returned URL and must URL.revokeObjectURL it when done
 * (the player revokes on track change) to avoid leaking blobs.
 */
export async function getOfflineBlobUrl(id: string): Promise<string | null> {
  if (!hasIDB()) return null;
  try {
    const record = await tx<OfflineSongRecord | undefined>('readonly', (store) => store.get(id));
    if (!record?.blob) return null;
    return URL.createObjectURL(record.blob);
  } catch {
    return null;
  }
}

/** Forget a saved song (frees the cached bytes). */
export async function removeOffline(id: string): Promise<void> {
  if (!hasIDB()) return;
  try {
    await tx('readwrite', (store) => store.delete(id));
  } catch {
    /* best-effort */
  }
}

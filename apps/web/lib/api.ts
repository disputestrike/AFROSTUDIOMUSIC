'use client';

import { useMemo } from 'react';

/**
 * Client API helper. Internal mode = no auth token; the API resolves the
 * single default workspace for every request. When you add Google auth later,
 * thread the token through the headers here.
 */

const API_URL = '/backend';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Network-level failures ("Failed to fetch") happen during Railway redeploy
 * windows — the API is down for ~20-40s while the new build swaps in. A hard
 * fail there showed the owner "Couldn't finish that one" on a healthy app.
 * fetch throws TypeError ONLY when no response arrived at all (DNS/conn reset),
 * so no request was processed — safe to retry even for POSTs.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const delays = [2_000, 8_000, 20_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      // A deliberate abort (watchdog/unmount) must surface immediately —
      // retrying a canceled request would resurrect it three times over.
      if ((err as Error)?.name === 'AbortError' || init.signal?.aborted) throw err;
      if (attempt >= delays.length) {
        // Raw "Failed to fetch" reads like the APP is broken — say what actually
        // happened after ~30s of genuine retries.
        throw new Error('The studio is unreachable right now (network blip or a deploy in progress). It usually comes back within a minute — try again.');
      }
      await sleep(delays[attempt]!);
    }
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we're ACTUALLY sending a JSON body.
  // A body-less request (every del(), some gets) that still says
  // `content-type: application/json` trips Fastify's empty-body guard with
  // `400 FST_ERR_CTP_EMPTY_JSON_BODY` — which silently broke EVERY delete in the
  // app (song/project/lexicon/lake all 400'd before the row was ever touched).
  const hasBody = init?.body != null;
  // Cookie-authenticated mutations carry an explicit non-simple header. The API
  // verifies this marker and the exact Origin before accepting state changes.
  const method = (init?.method ?? 'GET').toUpperCase();
  const unsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const res = await fetchWithRetry(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(unsafe ? { 'x-afrohit-request': '1' } : {}),
      ...(unsafe ? { 'idempotency-key': crypto.randomUUID() } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
    credentials: 'include',
  });
  if (!res.ok) {
    // JWT mode: a 401 means the session is missing/expired — send the user to
    // sign in instead of scattering raw 401 errors across every page. Only for
    // non-auth paths (the signin page itself must be able to see a 401) and only
    // in the browser. Internal mode never 401s, so this is inert until the flip.
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      if (!window.location.pathname.startsWith('/signin')) {
        window.location.href = '/signin';
      }
    }
    const errText = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${errText}`);
  }
  if (res.status === 204) return undefined as never;
  return res.json() as Promise<T>;
}

export function useApi() {
  // STABLE IDENTITY: this object used to be rebuilt every render, so any
  // `useCallback(..., [api])` downstream changed identity each render → effect
  // re-ran → setState → render → repeat. That infinite refetch loop hammered
  // GET /songs from the Create page (and release/benchmark panels), burning the
  // per-IP rate limit exactly while a render poll needed it.
  return useMemo(() => ({
    /** Absolute URL for a same-API path (e.g. a proxied file download link). */
    fileHref(path: string): string {
      return `${API_URL}${path}`;
    },
    get<T>(path: string): Promise<T> {
      return apiFetch<T>(path);
    },
    post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
      return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) });
    },
    patch<T>(path: string, body: unknown): Promise<T> {
      return apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
    },
    del(path: string): Promise<void> {
      return apiFetch<void>(path, { method: 'DELETE' });
    },
    /**
     * Upload a File/Blob straight to object storage via a presigned PUT.
     * Returns the storage key + public url. Report progress 0..1 if provided.
     */
    async uploadToStorage(
      file: Blob,
      kind: 'beat' | 'instrumental' | 'vocal' | 'reference' | 'stem',
      onProgress?: (fraction: number) => void
    ): Promise<{ key: string; publicUrl: string; playbackUrl: string }> {
      const name = (file as File).name ?? '';
      const ext = (name.split('.').pop() || (file.type.split('/').pop() ?? 'bin'))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || 'bin';
      const contentType = file.type || 'application/octet-stream';
      const { url, key, assetRef, playbackUrl } = await apiFetch<{
        url: string;
        key: string;
        assetRef: string;
        playbackUrl: string;
      }>('/uploads/presign', {
        method: 'POST',
        body: JSON.stringify({ kind, contentType, ext, sizeBytes: file.size }),
      });
      // XHR (not fetch) so we get real upload progress on large audio files.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.setRequestHeader('content-type', contentType);
        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`upload failed: ${xhr.status} ${xhr.responseText}`));
        xhr.onerror = () => reject(new Error('upload network error'));
        xhr.send(file);
      });
      onProgress?.(1);
      return { key, publicUrl: assetRef, playbackUrl };
    },
    /**
     * Upload small audio (e.g. a mic capture) THROUGH the API to storage.
     * Avoids the browser→R2 cross-origin PUT (which needs R2 CORS) — the browser
     * only talks to our API, whose CORS is already configured.
     */
    async uploadAudioDirect(
      file: Blob,
      kind: 'reference' | 'vocal' | 'beat' = 'reference'
    ): Promise<{ key: string; publicUrl: string; playbackUrl: string }> {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      const dataBase64 = btoa(binary);
      const type = file.type || 'audio/webm';
      const ext = type.includes('ogg')
        ? 'ogg'
        : type.includes('mp4') || type.includes('m4a')
        ? 'm4a'
        : type.includes('mpeg') || type.includes('mp3')
        ? 'mp3'
        : type.includes('wav')
        ? 'wav'
        : 'webm';
      const result = await apiFetch<{ key: string; assetRef: string; playbackUrl: string }>('/uploads/audio', {
        method: 'POST',
        body: JSON.stringify({ kind, contentType: type, ext, dataBase64 }),
      });
      return { key: result.key, publicUrl: result.assetRef, playbackUrl: result.playbackUrl };
    },
    /**
     * POST that consumes a Server-Sent-Events response. Calls onEvent for
     * every `data:` JSON object. Resolves when the stream ends. An optional
     * AbortSignal lets the caller kill a stream that has gone quiet (the
     * chat's dead-air watchdog) instead of hanging forever.
     */
    async postStream(
      path: string,
      body: unknown,
      onEvent: (evt: Record<string, unknown>) => void,
      opts?: { signal?: AbortSignal }
    ): Promise<void> {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetchWithRetry(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-afrohit-request': '1', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(body),
        credentials: 'include',
        signal: opts?.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            onEvent(JSON.parse(dataLine.slice(6)));
          } catch {
            /* malformed frame — skip */
          }
        }
      }
    },
  }), []);
}

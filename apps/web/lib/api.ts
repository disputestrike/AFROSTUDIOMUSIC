'use client';

/**
 * Client API helper. Internal mode = no auth token; the API resolves the
 * single default workspace for every request. When you add Google auth later,
 * thread the token through the headers here.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we're ACTUALLY sending a JSON body.
  // A body-less request (every del(), some gets) that still says
  // `content-type: application/json` trips Fastify's empty-body guard with
  // `400 FST_ERR_CTP_EMPTY_JSON_BODY` — which silently broke EVERY delete in the
  // app (song/project/lexicon/lake all 400'd before the row was ever touched).
  const hasBody = init?.body != null;
  // WO-1: admin/trigger routes require x-admin-secret (set once via the /admin
  // page, kept in localStorage). ONLY attach it to /admin + /debug requests —
  // sending the operator secret on every call needlessly exposed it (audit).
  const needsAdmin = path.startsWith('/admin') || path.startsWith('/debug');
  const adminKey = needsAdmin && typeof localStorage !== 'undefined' ? localStorage.getItem('afrohit.adminKey') : null;
  // Multi-tenant session (AUTH_MODE=jwt): attach the bearer token when signed
  // in. Internal mode ignores it — harmless either way.
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('afrohit.token') : null;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(adminKey ? { 'x-admin-secret': adminKey } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${errText}`);
  }
  if (res.status === 204) return undefined as never;
  return res.json() as Promise<T>;
}

export function useApi() {
  return {
    /** Absolute URL for a same-API path (e.g. a proxied file download link). */
    fileHref(path: string): string {
      return `${API_URL}/api/v1${path}`;
    },
    get<T>(path: string): Promise<T> {
      return apiFetch<T>(path);
    },
    post<T>(path: string, body: unknown): Promise<T> {
      return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
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
    ): Promise<{ key: string; publicUrl: string }> {
      const name = (file as File).name ?? '';
      const ext = (name.split('.').pop() || (file.type.split('/').pop() ?? 'bin'))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || 'bin';
      const contentType = file.type || 'application/octet-stream';
      const { url, key, publicUrl } = await apiFetch<{
        url: string;
        key: string;
        publicUrl: string;
      }>('/uploads/presign', {
        method: 'POST',
        body: JSON.stringify({ kind, contentType, ext }),
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
      return { key, publicUrl };
    },
    /**
     * Upload small audio (e.g. a mic capture) THROUGH the API to storage.
     * Avoids the browser→R2 cross-origin PUT (which needs R2 CORS) — the browser
     * only talks to our API, whose CORS is already configured.
     */
    async uploadAudioDirect(
      file: Blob,
      kind: 'reference' | 'vocal' | 'beat' = 'reference'
    ): Promise<{ key: string; publicUrl: string }> {
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
        ? 'mp4'
        : type.includes('mpeg') || type.includes('mp3')
        ? 'mp3'
        : type.includes('wav')
        ? 'wav'
        : 'webm';
      return apiFetch<{ key: string; publicUrl: string }>('/uploads/audio', {
        method: 'POST',
        body: JSON.stringify({ kind, contentType: type, ext, dataBase64 }),
      });
    },
    /**
     * POST that consumes a Server-Sent-Events response. Calls onEvent for
     * every `data:` JSON object. Resolves when the stream ends.
     */
    async postStream(
      path: string,
      body: unknown,
      onEvent: (evt: Record<string, unknown>) => void
    ): Promise<void> {
      const res = await fetch(`${API_URL}/api/v1${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
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
  };
}

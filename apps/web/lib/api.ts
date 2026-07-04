'use client';

/**
 * Client API helper. Internal mode = no auth token; the API resolves the
 * single default workspace for every request. When you add Google auth later,
 * thread the token through the headers here.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
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
    get<T>(path: string): Promise<T> {
      return apiFetch<T>(path);
    },
    post<T>(path: string, body: unknown): Promise<T> {
      return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
    },
    patch<T>(path: string, body: unknown): Promise<T> {
      return apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
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

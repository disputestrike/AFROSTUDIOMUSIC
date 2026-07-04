'use client';

import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Lightweight API client. Server components should mint their own bearer
 * with `auth().getToken()` and call `apiRaw`. Client components use the
 * `useApi` hook which threads a token through every request.
 */
export async function apiRaw<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
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
  const { getToken } = useAuth();
  return {
    async get<T>(path: string): Promise<T> {
      const token = (await getToken()) ?? null;
      return apiRaw<T>(path, token);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      const token = (await getToken()) ?? null;
      return apiRaw<T>(path, token, { method: 'POST', body: JSON.stringify(body) });
    },
    async patch<T>(path: string, body: unknown): Promise<T> {
      const token = (await getToken()) ?? null;
      return apiRaw<T>(path, token, { method: 'PATCH', body: JSON.stringify(body) });
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
      const token = (await getToken()) ?? null;
      const res = await fetch(`${API_URL}/api/v1${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
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
        // SSE frames are separated by a blank line
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

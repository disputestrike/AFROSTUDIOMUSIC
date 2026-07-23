/**
 * Server-component API helper. Forward the browser's HttpOnly session to the
 * API so authenticated RSC pages and client navigation resolve the same user.
 */
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function apiServer<T>(path: string, init?: RequestInit): Promise<T> {
  const cookie = (await cookies()).toString();
  const method = (init?.method ?? 'GET').toUpperCase();
  const unsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init?.body != null ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(unsafe ? { 'x-afrohit-request': '1', origin: process.env.WEB_URL ?? 'http://localhost:3000' } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    // SESSION vs OUTAGE (owner incident 2026-07-23, hours lost): an expired
    // session made every SSR page report "the studio API isn't reachable" —
    // a login problem wearing an outage's clothes, so the real fix (sign in
    // again) was invisible while the server was chased for bugs it didn't
    // have. 401 is now a TYPED error every page can recognise.
    const err = new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    if (res.status === 401) (err as Error & { status?: number }).status = 401;
    throw err;
  }
  if (res.status === 204) return undefined as never;
  return res.json() as Promise<T>;
}

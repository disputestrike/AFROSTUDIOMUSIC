import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_URL = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FORWARDED_RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
  'location',
  'retry-after',
];

type RouteContext = { params: Promise<{ path: string[] }> };

function expectedOrigin(): string {
  for (const candidate of (process.env.WEB_URL ?? 'http://localhost:3000').split(',')) {
    try {
      return new URL(candidate.trim()).origin;
    } catch {
      // Try the next configured public web origin.
    }
  }
  return 'http://localhost:3000';
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const method = request.method.toUpperCase();
  if (UNSAFE_METHODS.has(method) && request.headers.get('x-afrohit-request') !== '1') {
    return Response.json({ error: 'browser_request_verification_failed' }, { status: 403 });
  }

  const { path } = await context.params;
  const safePath = path.map((segment) => encodeURIComponent(segment)).join('/');
  const target = `${API_URL}/api/v1/${safePath}${request.nextUrl.search}`;
  const headers = new Headers();
  for (const name of ['accept', 'authorization', 'content-type', 'cookie', 'idempotency-key', 'if-none-match', 'range', 'x-afrohit-request']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (UNSAFE_METHODS.has(method)) headers.set('origin', expectedOrigin());

  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    redirect: 'manual',
    cache: 'no-store',
    signal: request.signal,
  };
  if (!['GET', 'HEAD'].includes(method) && request.body) {
    init.body = request.body;
    init.duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json({ error: 'api_unavailable' }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  const cookieHeaders = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (cookieHeaders.length) {
    for (const cookie of cookieHeaders) responseHeaders.append('set-cookie', cookie);
  } else {
    const cookie = upstream.headers.get('set-cookie');
    if (cookie) responseHeaders.append('set-cookie', cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;

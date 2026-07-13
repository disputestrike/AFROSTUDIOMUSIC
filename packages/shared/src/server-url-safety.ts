import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { Agent, fetch as pinnedFetch } from 'undici';

export const BLOCKED_MEDIA_HOSTS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com',
  'spotify.com', 'scdn.co', 'spotifycdn.com',
  'soundcloud.com', 'sndcdn.com',
  'tidal.com', 'deezer.com', 'audiomack.com',
  'music.apple.com', 'itunes.apple.com', 'mzstatic.com',
  'tiktok.com', 'tiktokcdn.com', 'instagram.com', 'facebook.com', 'fbcdn.net',
];

export function hostIsBlocked(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  return BLOCKED_MEDIA_HOSTS.some((blocked) => normalized === blocked || normalized.endsWith(`.${blocked}`));
}

export function ipIsPrivate(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && parts[2] === 100) return true;
    if (a === 203 && b === 0 && parts[2] === 113) return true;
    return a >= 224;
  }
  if (family === 6) {
    const normalized = ip.toLowerCase().split('%')[0]!;
    const words = ipv6Words(normalized);
    if (!words) return true;
    if (words.slice(0, 7).every((word) => word === 0) && words[7]! <= 1) return true;
    if ((words[0]! & 0xfe00) === 0xfc00) return true;
    if ((words[0]! & 0xffc0) === 0xfe80 || (words[0]! & 0xffc0) === 0xfec0) return true;
    if ((words[0]! & 0xff00) === 0xff00) return true;
    if (words[0] === 0x2001 && (words[1] === 0x0db8 || words[1] === 0x0002)) return true;
    if (words[0] === 0x2002) return true;
    const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
    const compatible = words.slice(0, 6).every((word) => word === 0);
    const nat64 = words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0);
    if (mapped || compatible || nat64) {
      return ipIsPrivate(`${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`);
    }
    return false;
  }
  return true;
}

function ipv6Words(value: string): number[] | null {
  let source = value;
  if (source.includes('.')) {
    const colon = source.lastIndexOf(':');
    const ipv4 = source.slice(colon + 1).split('.').map(Number);
    if (colon < 0 || ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    source = `${source.slice(0, colon)}:${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }
  const halves = source.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (part: string) => part ? part.split(':').map((word) => Number.parseInt(word, 16)) : [];
  const left = parseHalf(halves[0]!);
  const right = parseHalf(halves[1] ?? '');
  if ([...left, ...right].some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...left, ...Array(Math.max(0, missing)).fill(0), ...right];
}

function integerHostToIpv4(host: string): string | null {
  let value: number | null = null;
  if (/^\d+$/.test(host)) value = Number(host);
  else if (/^0x[0-9a-f]+$/i.test(host)) value = Number.parseInt(host, 16);
  if (value === null || !Number.isFinite(value) || value < 0 || value > 0xffffffff) return null;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

export type UrlCheck = { ok: true } | { ok: false; code: number; error: string; message?: string };
type SafeResolution = { check: UrlCheck; addresses: string[] };

const COPYRIGHT_MESSAGE =
  "Can't pull from streaming platforms. Use your own files, direct audio links, or rights-cleared royalty-free sources.";

async function resolveSafeUrl(raw: string, options: { blockMediaHosts?: boolean } = {}): Promise<SafeResolution> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { check: { ok: false, code: 400, error: 'invalid_url' }, addresses: [] };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { check: { ok: false, code: 400, error: 'bad_protocol', message: 'Only http(s) URLs are allowed.' }, addresses: [] };
  }
  if (url.username || url.password) return { check: { ok: false, code: 400, error: 'url_credentials_forbidden' }, addresses: [] };
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host.length > 253) return { check: { ok: false, code: 400, error: 'invalid_host' }, addresses: [] };
  if (options.blockMediaHosts !== false && hostIsBlocked(host)) {
    return { check: { ok: false, code: 422, error: 'copyrighted_source', message: COPYRIGHT_MESSAGE }, addresses: [] };
  }
  const lowered = host.toLowerCase();
  if (lowered === 'localhost' || lowered.endsWith('.localhost') || lowered.endsWith('.local') || lowered.endsWith('.internal')) {
    return { check: { ok: false, code: 400, error: 'private_host' }, addresses: [] };
  }

  const literal = net.isIP(host) ? host : integerHostToIpv4(host);
  let addresses: string[];
  if (literal) addresses = [literal];
  else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
    } catch {
      return { check: { ok: false, code: 400, error: 'dns_resolve_failed' }, addresses: [] };
    }
  }
  if (!addresses.length) return { check: { ok: false, code: 400, error: 'dns_resolve_failed' }, addresses: [] };
  if (addresses.some(ipIsPrivate)) {
    return { check: { ok: false, code: 400, error: 'private_host', message: 'That host resolves to a private or internal address.' }, addresses: [] };
  }
  return { check: { ok: true }, addresses };
}

export async function assertSafeUrl(raw: string, options: { blockMediaHosts?: boolean } = {}): Promise<UrlCheck> {
  return (await resolveSafeUrl(raw, options)).check;
}

function bindAgentLifetime(response: Response, agent: Agent): Response {
  if (!response.body) {
    void agent.close();
    return response;
  }
  const reader = response.body.getReader();
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(lifetime);
    if (error) void agent.destroy(error).catch(() => undefined);
    else void agent.close().catch(() => undefined);
  };
  const lifetime = setTimeout(() => {
    void reader.cancel('response_body_timeout').catch(() => undefined);
    finish(new Error('response_body_timeout'));
  }, 2 * 60_000);
  lifetime.unref?.();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          finish();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
        finish(error as Error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      finish();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function safeFetch(
  raw: string,
  init: RequestInit & { maxHops?: number; blockMediaHosts?: boolean } = {},
): Promise<Response> {
  const maxHops = init.maxHops ?? 5;
  let current = raw;
  for (let hop = 0; hop <= maxHops; hop++) {
    const resolved = await resolveSafeUrl(current, { blockMediaHosts: init.blockMediaHosts });
    if (!resolved.check.ok) throw Object.assign(new Error(resolved.check.error), { urlCheck: resolved.check });
    const address = resolved.addresses[0]!;
    const agent = new Agent({
      connect: {
        lookup: ((_hostname: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => {
          callback(null, address, net.isIP(address));
        }) as never,
      },
    });
    const { maxHops: _maxHops, blockMediaHosts: _blockMediaHosts, ...requestInit } = init;
    let response: Response;
    try {
      const fetchInit = { ...requestInit, redirect: 'manual' as const, dispatcher: agent } as Parameters<typeof pinnedFetch>[1];
      response = bindAgentLifetime(
        await pinnedFetch(current, fetchInit) as unknown as Response,
        agent,
      );
    } catch (error) {
      await agent.destroy(error as Error).catch(() => undefined);
      throw error;
    }
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    await response.body?.cancel().catch(() => undefined);
    current = new URL(location, current).toString();
  }
  const check: UrlCheck = { ok: false, code: 400, error: 'too_many_redirects' };
  throw Object.assign(new Error(check.error), { urlCheck: check });
}

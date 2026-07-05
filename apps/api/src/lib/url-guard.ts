/**
 * URL safety guard — shared by /uploads/import and /analyze.
 *
 * Two jobs:
 *  1. Copyright bright line: refuse streaming-platform / DRM'd catalog hosts.
 *  2. SSRF: refuse private/loopback/link-local/metadata targets — resolving DNS
 *     and normalizing integer/hex IP literals, and re-validating every redirect
 *     hop (fetch is done with redirect:'manual').
 *
 * Residual: DNS-rebinding (TOCTOU between resolve and connect) is not fully
 * closed here; acceptable for the current internal single-owner deploy, and the
 * far more common vectors (blocked hosts, IP literals, redirect-to-metadata)
 * are covered.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

// Streaming / DRM'd catalog — refuse (copyright bright line).
export const BLOCKED_HOSTS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com',
  'spotify.com', 'scdn.co', 'spotifycdn.com',
  'soundcloud.com', 'sndcdn.com',
  'tidal.com', 'deezer.com', 'audiomack.com',
  'music.apple.com', 'itunes.apple.com', 'mzstatic.com',
  'tiktok.com', 'tiktokcdn.com', 'instagram.com', 'facebook.com', 'fbcdn.net',
];

export function hostIsBlocked(host: string): boolean {
  const h = host.toLowerCase();
  return BLOCKED_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));
}

/** Is an IP (v4 or v6) in a private / loopback / link-local / metadata range? */
export function ipIsPrivate(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → refuse
    const [a, b] = p as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (fam === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true; // link-local + ULA
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return ipIsPrivate(mapped[1]!);
    return false;
  }
  return true; // not a valid IP string → refuse
}

/** Detect integer/hex/octal IPv4 literals (e.g. 2130706433, 0x7f000001) → dotted. */
function integerHostToIpv4(host: string): string | null {
  let n: number | null = null;
  if (/^\d+$/.test(host)) n = Number(host);
  else if (/^0x[0-9a-f]+$/i.test(host)) n = parseInt(host, 16);
  if (n === null || !Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export type UrlCheck = { ok: true } | { ok: false; code: number; error: string; message?: string };

const COPYRIGHT_MSG =
  "Can't pull from streaming platforms (YouTube/Spotify/SoundCloud/TikTok/etc.) — that's copyrighted catalog. Use your own files, direct audio links, or royalty-free / Creative-Commons sources.";

/** Validate a URL for safe outbound fetch. Resolves DNS + checks every IP. */
export async function assertSafeUrl(raw: string): Promise<UrlCheck> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, code: 400, error: 'invalid_url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, code: 400, error: 'bad_protocol', message: 'Only http(s) URLs are allowed.' };
  }
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (hostIsBlocked(host)) return { ok: false, code: 422, error: 'copyrighted_source', message: COPYRIGHT_MSG };
  const lowered = host.toLowerCase();
  if (lowered === 'localhost' || lowered.endsWith('.local') || lowered.endsWith('.internal') || lowered.endsWith('.railway.internal')) {
    return { ok: false, code: 400, error: 'private_host' };
  }

  // Resolve to concrete IP(s) and reject any private/metadata target.
  let ips: string[] = [];
  const literal = net.isIP(host) ? host : integerHostToIpv4(host);
  if (literal) {
    ips = [literal];
  } else {
    try {
      const res = await lookup(host, { all: true });
      ips = res.map((r) => r.address);
    } catch {
      return { ok: false, code: 400, error: 'dns_resolve_failed' };
    }
  }
  if (!ips.length) return { ok: false, code: 400, error: 'dns_resolve_failed' };
  for (const ip of ips) {
    if (ipIsPrivate(ip)) return { ok: false, code: 400, error: 'private_host', message: 'That host resolves to a private/internal address.' };
  }
  return { ok: true };
}

/**
 * Fetch a URL with SSRF protection: validates the initial URL and re-validates
 * every redirect hop (redirect:'manual'). Returns the final Response.
 * Throws { code, error } on a blocked/invalid target.
 */
export async function safeFetch(raw: string, init: RequestInit & { maxHops?: number } = {}): Promise<Response> {
  const maxHops = init.maxHops ?? 5;
  let url = raw;
  for (let hop = 0; hop <= maxHops; hop++) {
    const check = await assertSafeUrl(url);
    if (!check.ok) throw Object.assign(new Error(check.error), { urlCheck: check });
    const res = await fetch(url, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      url = new URL(loc, url).toString(); // re-validate on next loop iteration
      continue;
    }
    return res;
  }
  throw Object.assign(new Error('too_many_redirects'), { urlCheck: { ok: false, code: 400, error: 'too_many_redirects' } });
}

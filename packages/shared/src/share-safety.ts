/**
 * SHARE-REDIRECT SAFETY (audit 2026-07-17, CONFIRMED open redirect). A public
 * short link (yourdomain/s/CODE) that forwards to ANY http(s) URL is a
 * phishing launder: an attacker wraps a credential-stealing page in the
 * studio's trusted domain. Redirect targets are restricted to an allowlist —
 * the studio's own hosts plus the platforms an artist legitimately links to
 * (music stores, socials). Anything else is refused at redirect time (legacy
 * links included), so the trusted domain can never forward to an attacker.
 */
const DEFAULT_ALLOWED_SHARE_HOSTS = [
  // Music platforms an artist links a release to.
  'audiomack.com', 'boomplay.com', 'open.spotify.com', 'spotify.com',
  'music.apple.com', 'apple.co', 'music.youtube.com', 'youtube.com', 'youtu.be',
  'deezer.com', 'tidal.com', 'soundcloud.com', 'audius.co',
  // Socials where the smart-link lives.
  'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 'facebook.com',
  'linktr.ee', 'linkin.bio',
];

function extraAllowedHosts(env: NodeJS.ProcessEnv): string[] {
  // Own web origins + an operator-configurable list.
  const raw = [
    env.SHARE_REDIRECT_ALLOWED_HOSTS ?? '',
    env.WEB_URL ?? '',
    env.WEB_ORIGINS ?? '',
  ].join(',');
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      try {
        return new URL(part.includes('://') ? part : `https://${part}`).hostname.toLowerCase();
      } catch {
        return part.toLowerCase().replace(/^\.+|\/.*$/g, '');
      }
    })
    .filter(Boolean);
}

/** True when a redirect target host is the allowlist or a subdomain of it. */
export function isAllowedShareTarget(
  url: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }
  const allowed = [...DEFAULT_ALLOWED_SHARE_HOSTS, ...extraAllowedHosts(env)];
  return allowed.some(a => host === a || host.endsWith(`.${a}`));
}

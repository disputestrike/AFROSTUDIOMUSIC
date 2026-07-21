import { createHash } from 'node:crypto';

/**
 * Workspace-invite token handling (identity wave, 2026-07-20).
 *
 * Same "hash at rest" doctrine as password-reset tokens: only the SHA-256
 * hash of the opaque token is ever stored (WorkspaceInvite.tokenHash) — the
 * raw token rides the invite link exclusively, so a database leak cannot be
 * replayed into a membership. Redemption re-hashes the presented token and
 * looks it up; single use is enforced by a race-safe conditional updateMany.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** The link the invited person opens. Empty when WEB_URL is unset (the
 *  creating admin still gets the raw token to share by hand). */
export function inviteUrlFor(token: string): string | null {
  const base = (process.env.WEB_URL ?? '')
    .split(',')[0]!
    .trim()
    .replace(/\/+$/, '');
  return base ? `${base}/invite?token=${encodeURIComponent(token)}` : null;
}

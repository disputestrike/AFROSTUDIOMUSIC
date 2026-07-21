/**
 * RBAC — the one role ladder (identity wave, 2026-07-20).
 *
 * Privileges are MINIMUM-RANK gates, so a single ordered ladder is the whole
 * model. The matrix as shipped:
 *
 *   OWNER     billing, danger zone (member removal), member-role changes —
 *             plus everything below.
 *   ADMIN     member invites, workspace settings, delete songs — plus
 *             everything below.
 *   PRODUCER  create/render/edit songs, beats, projects (the default working
 *             role — every pre-RBAC signup owner already outranks it).
 *   WRITER /  content contributors: same read surface as VIEWER today;
 *   VOCALIST  reserved a rung above VIEWER so granting them write surfaces
 *             later is a gate change, not a schema change.
 *   VIEWER    read + play only. The auth middleware ALSO blocks every unsafe
 *             method for VIEWER globally — this ladder is the per-route,
 *             defense-in-depth layer.
 *
 * Pure and shared so the API (enforcement) and the web (presentation) can
 * never disagree about who outranks whom.
 */

export const WORKSPACE_ROLES = [
  "OWNER",
  "ADMIN",
  "PRODUCER",
  "WRITER",
  "VOCALIST",
  "VIEWER",
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const ROLE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 50,
  ADMIN: 40,
  PRODUCER: 30,
  WRITER: 20,
  VOCALIST: 20,
  VIEWER: 10,
};

export function roleRank(role: string): number {
  return ROLE_RANK[role as WorkspaceRole] ?? 0;
}

/** True when `role` meets or beats `minRole` on the ladder. Unknown roles
 *  rank 0 — fail closed, never open. */
export function hasMinRole(role: string, minRole: WorkspaceRole): boolean {
  return roleRank(role) >= ROLE_RANK[minRole];
}

/** Roles an invite may grant. OWNER is never invitable (ownership moves via
 *  explicit member-role changes by an OWNER), and an inviter can only grant
 *  ranks at or below their own — an ADMIN cannot mint a peer they could not
 *  later manage without OWNER help, except ADMIN itself, which OWNER-approved
 *  delegation explicitly allows. */
export const INVITABLE_ROLES = [
  "ADMIN",
  "PRODUCER",
  "WRITER",
  "VOCALIST",
  "VIEWER",
] as const satisfies readonly WorkspaceRole[];

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function canGrantRole(inviterRole: string, granted: string): boolean {
  if (!(INVITABLE_ROLES as readonly string[]).includes(granted)) return false;
  if (!hasMinRole(inviterRole, "ADMIN")) return false;
  return roleRank(inviterRole) >= roleRank(granted);
}

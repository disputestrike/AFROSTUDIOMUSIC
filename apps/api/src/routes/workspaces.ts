import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { prisma } from '@afrohit/db';
import {
  canGrantRole,
  memberRoleUpdateSchema,
  workspaceCreateSchema,
  workspaceInviteCreateSchema,
} from '@afrohit/shared';
import { requireAuth, requireMinRole, requireRole } from '../middleware/auth';
import { sendEmail, workspaceInviteEmail } from '../lib/email';
import { hashInviteToken, INVITE_TTL_MS, inviteUrlFor } from '../lib/invites';
import { presignAssetRef } from '../lib/storage';
import {
  assertSessionConfiguration,
  sessionCookie,
  signSession,
} from '../lib/session';

/**
 * MULTI-TENANT WORKSPACES (identity wave, 2026-07-20).
 *
 * A user can belong to MANY workspaces (WorkspaceMember has always been
 * many-to-many); this surface makes that real: create additional studios,
 * list memberships, switch the active one, and bring collaborators in via
 * single-use hashed invites.
 *
 * THE ACTIVE WORKSPACE IS THE SESSION. Every session token already carries
 * workspaceId (lib/session.ts) and the auth middleware scopes every request
 * by it — so "switch" simply re-issues the session cookie for another
 * workspace the caller is a member of. No new resolution path, no header to
 * spoof: workspace isolation stays exactly where it always was.
 *
 * RBAC (shared/rbac.ts ladder): invites are ADMIN+, member-role changes and
 * member removal are OWNER-only, and an inviter can never grant a rank above
 * their own (canGrantRole).
 */

const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'studio';

function sessionsAvailable(): boolean {
  try {
    assertSessionConfiguration();
    return true;
  } catch {
    return false;
  }
}

const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export default async function workspaces(app: FastifyInstance) {
  // ---- List MY workspaces (any member) -------------------------------------
  app.get('/', async (req) => {
    const { userId, workspaceId } = requireAuth(req);
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: { workspace: { createdAt: 'asc' } },
      select: {
        role: true,
        workspace: { select: { id: true, name: true, slug: true, plan: true, createdAt: true, suspendedAt: true } },
      },
    });
    return memberships
      .filter((m) => !m.workspace.suspendedAt)
      .map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        plan: m.workspace.plan,
        role: m.role,
        active: m.workspace.id === workspaceId,
        createdAt: m.workspace.createdAt,
      }));
  });

  // ---- Create an additional workspace (any signed-in user; they become its
  // OWNER — exactly what signup does for the first one) ----------------------
  app.post('/', { ...limited, schema: { body: workspaceCreateSchema } }, async (req, reply) => {
    const { userId } = requireAuth(req);
    const input = workspaceCreateSchema.parse(req.body);
    const base = slugify(input.name);
    let slug = base;
    for (let suffix = 2; await prisma.workspace.findUnique({ where: { slug }, select: { id: true } }); suffix++) {
      slug = `${base}-${suffix}`;
    }
    type Tx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
    const workspace = await prisma.$transaction(async (tx: Tx) => {
      const created = await tx.workspace.create({ data: { name: input.name, slug } });
      await tx.workspaceMember.create({ data: { workspaceId: created.id, userId, role: 'OWNER' } });
      // Same default Artist a signup provisions — a workspace without an
      // artist cannot start a project.
      await tx.artist.create({
        data: { workspaceId: created.id, name: input.name, stageName: input.name, languages: ['pcm', 'en'], vocalTone: ['smooth'] },
      });
      return created;
    });
    reply.code(201);
    return { id: workspace.id, name: workspace.name, slug: workspace.slug, plan: workspace.plan, role: 'OWNER', active: false };
  });

  // ---- Switch the ACTIVE workspace: re-issue the session cookie ------------
  app.post<{ Params: { id: string } }>('/:id/switch', { ...limited }, async (req, reply) => {
    const { userId } = requireAuth(req);
    if (!sessionsAvailable()) return reply.code(503).send({ error: 'sessions_disabled' });
    // A workspace the caller is not a member of reads as not-found — a valid
    // foreign workspace id must be indistinguishable from a missing one.
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId, workspaceId: req.params.id },
      select: { role: true, workspace: { select: { suspendedAt: true, name: true } } },
    });
    if (!membership) return reply.code(404).send({ error: 'workspace_not_found' });
    if (membership.workspace.suspendedAt) return reply.code(403).send({ error: 'workspace_suspended' });
    const token = signSession({ sub: userId, workspaceId: req.params.id, role: membership.role });
    reply.header('set-cookie', sessionCookie(token));
    return { workspaceId: req.params.id, role: membership.role, name: membership.workspace.name };
  });

  // ---- Members (any member may see who they work with) ---------------------
  app.get('/members', async (req) => {
    const { workspaceId } = requireAuth(req);
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { email: true, fullName: true, avatarUrl: true } },
      },
    });
    return Promise.all(
      members.map(async (m) => ({
        userId: m.userId,
        role: m.role,
        email: m.user.email,
        name: m.user.fullName,
        avatarUrl: m.user.avatarUrl ? await presignAssetRef(m.user.avatarUrl, 900) : null,
        joinedAt: m.createdAt,
      }))
    );
  });

  // ---- Member-role change — OWNER only (the ladder's top privilege) --------
  app.patch<{ Params: { userId: string } }>(
    '/members/:userId',
    { schema: { body: memberRoleUpdateSchema } },
    async (req, reply) => {
      const { workspaceId } = requireRole(req, ['OWNER']);
      const input = memberRoleUpdateSchema.parse(req.body);
      const target = await prisma.workspaceMember.findFirst({
        where: { workspaceId, userId: req.params.userId },
        select: { id: true, role: true },
      });
      if (!target) return reply.code(404).send({ error: 'member_not_found' });
      // NEVER ORPHAN A WORKSPACE: demoting the last OWNER would leave nobody
      // able to manage billing, roles, or danger — refuse.
      if (target.role === 'OWNER' && input.role !== 'OWNER') {
        const owners = await prisma.workspaceMember.count({ where: { workspaceId, role: 'OWNER' } });
        if (owners <= 1) return reply.code(409).send({ error: 'last_owner', note: 'Promote another OWNER first.' });
      }
      const updated = await prisma.workspaceMember.update({
        where: { id: target.id },
        data: { role: input.role },
        select: { userId: true, role: true },
      });
      return updated;
    }
  );

  // ---- Member removal — OWNER only (danger zone) ----------------------------
  app.delete<{ Params: { userId: string } }>('/members/:userId', async (req, reply) => {
    const { workspaceId } = requireRole(req, ['OWNER']);
    const target = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: req.params.userId },
      select: { id: true, role: true },
    });
    if (!target) return reply.code(404).send({ error: 'member_not_found' });
    if (target.role === 'OWNER') {
      const owners = await prisma.workspaceMember.count({ where: { workspaceId, role: 'OWNER' } });
      if (owners <= 1) return reply.code(409).send({ error: 'last_owner', note: 'A workspace always keeps at least one OWNER.' });
    }
    await prisma.workspaceMember.delete({ where: { id: target.id } });
    return reply.code(204).send();
  });

  // ---- Invites — ADMIN+ creates; the token is HASHED at rest ---------------
  app.post('/invites', { ...limited, schema: { body: workspaceInviteCreateSchema } }, async (req, reply) => {
    const auth = requireMinRole(req, 'ADMIN');
    const input = workspaceInviteCreateSchema.parse(req.body);
    // An inviter can only grant ranks at or below their own; OWNER is never
    // invitable (rbac.ts canGrantRole is the single law).
    if (!canGrantRole(auth.role, input.role)) {
      return reply.code(403).send({ error: 'role_grant_forbidden' });
    }
    const email = input.email.toLowerCase().trim();
    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      const member = await prisma.workspaceMember.findFirst({
        where: { workspaceId: auth.workspaceId, userId: existingUser.id },
        select: { id: true },
      });
      if (member) return reply.code(409).send({ error: 'already_a_member' });
    }
    // Only the NEWEST invite for an email is live (same rule as reset links).
    await prisma.workspaceInvite.updateMany({
      where: { workspaceId: auth.workspaceId, email, usedAt: null },
      data: { usedAt: new Date() },
    });
    const rawToken = randomBytes(32).toString('base64url');
    const invite = await prisma.workspaceInvite.create({
      data: {
        workspaceId: auth.workspaceId,
        email,
        role: input.role,
        tokenHash: hashInviteToken(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: auth.userId,
      },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
    const inviteUrl = inviteUrlFor(rawToken);
    // Delivery is best-effort — the admin always gets the link to share by
    // hand, so a missing email provider never blocks a team.
    if (inviteUrl) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: auth.workspaceId },
        select: { name: true },
      });
      const mail = workspaceInviteEmail(workspace?.name ?? 'an AfroHits studio', invite.role, inviteUrl);
      await sendEmail({ to: email, subject: mail.subject, html: mail.html }).catch((err) =>
        req.log.warn({ err }, 'workspace-invite email send failed (link still returned)'),
      );
    }
    reply.code(201);
    // The raw token appears ONCE — here, to its creator. Only the hash is stored.
    return { ...invite, inviteUrl, token: rawToken };
  });

  app.get('/invites', async (req) => {
    const { workspaceId } = requireMinRole(req, 'ADMIN');
    const rows = await prisma.workspaceInvite.findMany({
      where: { workspaceId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
    return rows;
  });

  app.delete<{ Params: { id: string } }>('/invites/:id', async (req, reply) => {
    const { workspaceId } = requireMinRole(req, 'ADMIN');
    const revoked = await prisma.workspaceInvite.deleteMany({
      where: { id: req.params.id, workspaceId, usedAt: null },
    });
    if (revoked.count !== 1) return reply.code(404).send({ error: 'invite_not_found' });
    return reply.code(204).send();
  });
}

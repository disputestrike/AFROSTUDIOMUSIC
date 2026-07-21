import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { costOf, PLAN_LIMITS } from '@afrohit/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import { billingDiagnosis, isFirstPartyBilling } from '../middleware/credits';
import {
  approveUrlOf,
  cancelSubscription,
  captureOrder,
  createOrder,
  createSubscription,
  getSubscription,
} from '../lib/paypal';
import { CREDIT_PACK_KEYS, CREDIT_PACKS } from '../lib/billing-catalog';
import {
  applyCreditCapture,
  bindSubscriptionIdentity,
  resolveCreditIntent,
} from '../lib/billing-service';

/** PayPal Billing Plan IDs per tier — created once in the PayPal dashboard. */
const PLAN_ID_FOR_TIER: Record<string, string | undefined> = {
  STARTER: process.env.PAYPAL_PLAN_STARTER,
  CREATOR: process.env.PAYPAL_PLAN_CREATOR,
  PRO: process.env.PAYPAL_PLAN_PRO,
  STUDIO: process.env.PAYPAL_PLAN_STUDIO,
};

function urls() {
  const web = (process.env.WEB_URL ?? 'http://localhost:3000').split(',')[0]!.trim();
  const api = process.env.API_URL ?? 'http://localhost:4000';
  return {
    // After approval, PayPal redirects user to the API, which finalizes (capture/refresh) and forwards to the web success page.
    subscribeReturn: `${api}/api/v1/billing/return/subscription`,
    subscribeCancel: `${web}/billing/cancel`,
    orderReturn: `${api}/api/v1/billing/return/order`,
    orderCancel: `${web}/billing/cancel`,
    webSuccess: `${web}/billing/success`,
    webCancel: `${web}/billing/cancel`,
  };
}

const subscribeSchema = z.object({ plan: z.enum(['STARTER', 'CREATOR', 'PRO', 'STUDIO']) });
const packSchema = z.object({ pack: z.enum(CREDIT_PACK_KEYS) });

function configuredCap(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function checkoutKey(headers: Record<string, unknown>): string | null {
  const raw = headers['idempotency-key'];
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  return key && key.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(key) ? key : null;
}

export default async function billing(app: FastifyInstance) {
  /**
   * SELF-DIAGNOSIS — why is billing treating me the way it is? Born from a
   * night of blind fixes (2026-07-16): three first-party detection rules
   * failed live while the owner was locked out and nobody could see WHICH
   * rule missed. Caller-scoped facts straight from the billing engine —
   * booleans only, no emails, no other tenants' data.
   */
  app.get('/diagnose', async (req) => {
    const { userId, workspaceId } = requireAuth(req);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return billingDiagnosis(workspaceId, user?.email ?? null);
  });

  /**
   * PRE-FLIGHT — can the workspace afford a generation RIGHT NOW?
   * Read-only mirror of chargeCredits' gate logic so the UI can refuse BEFORE
   * the user commits to a multi-minute wait (the old flow errored after it).
   */
  app.get('/preflight', async (req) => {
    const { workspaceId } = requireAuth(req);
    const { isInternalMode } = await import('../middleware/auth');
    // THE MIRROR MUST TRACK THE LAW. chargeCredits gained the first-party
    // rule and the pre-launch enforcement valve; this preflight kept
    // answering with the OLD gate, so the UI refused creates that the charge
    // itself would have allowed — the owner's final invisible blocker after
    // every charge-side fix (2026-07-16). First-party: free and uncapped by
    // FIRST_PARTY_* env (default unlimited). Beta valve off: internal-style
    // caps at BETA_DAILY/MONTHLY_GENERATIONS for everyone else.
    const firstParty = await isFirstPartyBilling(workspaceId);
    const billingEnforced = process.env.BILLING_ENFORCEMENT === 'on';
    if (firstParty || !billingEnforced) {
      const dailyCap = firstParty
        ? configuredCap(process.env.FIRST_PARTY_MAX_DAILY_GENERATIONS, 0)
        : configuredCap(process.env.BETA_DAILY_GENERATIONS, 25);
      const monthlyCap = firstParty
        ? configuredCap(process.env.FIRST_PARTY_MAX_MONTHLY_GENERATIONS, 0)
        : configuredCap(process.env.BETA_MONTHLY_GENERATIONS, 300);
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const [todayUsage, monthUsage] = await Promise.all([
        prisma.creditLedger.aggregate({
          where: { workspaceId, createdAt: { gte: dayStart }, delta: { lt: 0 }, reversal: { is: null } },
          _sum: { units: true },
        }),
        prisma.creditLedger.aggregate({
          where: { workspaceId, createdAt: { gte: monthStart }, delta: { lt: 0 }, reversal: { is: null } },
          _sum: { units: true },
        }),
      ]);
      const usedToday = todayUsage._sum.units ?? 0;
      const usedMonth = monthUsage._sum.units ?? 0;
      const remainingToday = dailyCap > 0 ? Math.max(0, dailyCap - usedToday) : Number.MAX_SAFE_INTEGER;
      const remainingMonth = monthlyCap > 0 ? Math.max(0, monthlyCap - usedMonth) : Number.MAX_SAFE_INTEGER;
      return {
        ok: remainingToday > 0 && remainingMonth > 0,
        mode: firstParty ? 'house' : 'beta',
        usedToday,
        usedMonth,
        dailyCap,
        monthlyCap,
        remainingToday,
        remainingMonth,
      };
    }
    if (isInternalMode()) {
      // Mirror chargeCredits exactly: caps are on by default and only the
      // explicit ENFORCE_GENERATION_CAP=0 development override disables them.
      const enforced = process.env.ENFORCE_GENERATION_CAP !== '0';
      const dailyCap = enforced ? configuredCap(process.env.MAX_DAILY_GENERATIONS, 100) : 0;
      const monthlyCap = enforced ? configuredCap(process.env.MAX_MONTHLY_GENERATIONS, 2_000) : 0;
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const [todayUsage, monthUsage] = await Promise.all([
        prisma.creditLedger.aggregate({
          where: {
            workspaceId,
            createdAt: { gte: dayStart },
            delta: { lt: 0 },
            reversal: { is: null },
          },
          _sum: { units: true },
        }),
        prisma.creditLedger.aggregate({
          where: {
            workspaceId,
            createdAt: { gte: monthStart },
            delta: { lt: 0 },
            reversal: { is: null },
          },
          _sum: { units: true },
        }),
      ]);
      const usedToday = todayUsage._sum.units ?? 0;
      const usedMonth = monthUsage._sum.units ?? 0;
      const remainingToday = dailyCap > 0 ? Math.max(0, dailyCap - usedToday) : Number.MAX_SAFE_INTEGER;
      const remainingMonth = monthlyCap > 0 ? Math.max(0, monthlyCap - usedMonth) : Number.MAX_SAFE_INTEGER;
      return {
        ok: remainingToday > 0 && remainingMonth > 0,
        mode: 'internal',
        usedToday,
        usedMonth,
        dailyCap,
        monthlyCap,
        remainingToday,
        remainingMonth,
      };
    }
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { creditsCents: true, plan: true } });
    // A full sung song is the most expensive common action — use its REAL cost as
    // the bar (audit #10: preflight hardcoded $2.00 while the charge is $7.50, so
    // it green-lit renders the user couldn't afford). One cost function everywhere.
    const estimatedCostCents = costOf('full_song_demo');
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const demoUsage = await prisma.creditLedger.aggregate({
      where: {
        workspaceId,
        createdAt: { gte: monthStart },
        delta: { lt: 0 },
        reversal: { is: null },
        creditKey: { in: ['full_song_demo', 'beat_idea_short_30s'] },
      },
      _sum: { planUnits: true },
    });
    const usedDemos = demoUsage._sum.planUnits ?? 0;
    const advertisedCap = PLAN_LIMITS[ws.plan as keyof typeof PLAN_LIMITS]?.monthlyDemoSongs ?? 0;
    const hardCap = Math.ceil(advertisedCap * 1.2);
    const withinPlan = usedDemos < hardCap;
    return {
      ok: ws.creditsCents >= estimatedCostCents && withinPlan,
      mode: 'credits',
      balanceCents: ws.creditsCents,
      estimatedCostCents,
      usedDemos,
      advertisedCap,
      hardCap,
      remainingDemos: Math.max(0, hardCap - usedDemos),
    };
  });

  app.get('/me', async (req) => {
    const { workspaceId } = requireAuth(req);
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { id: true, plan: true, creditsCents: true, paypalSubscriptionId: true },
    });
    return ws;
  });

  /** Create a PayPal Subscription and return the approve URL the web app redirects to. */
  app.post('/checkout/subscribe', { schema: { body: subscribeSchema } }, async (req, reply) => {
    // RBAC (identity wave): billing is the OWNER's privilege alone —
    // ADMIN manages people and settings, never the money.
    const { workspaceId } = requireRole(req, ['OWNER']);
    const { plan } = subscribeSchema.parse(req.body);
    const idempotencyKey = checkoutKey(req.headers as Record<string, unknown>);
    if (!idempotencyKey) return reply.code(400).send({ error: 'idempotency_key_required' });
    const planId = PLAN_ID_FOR_TIER[plan];
    if (!planId) return reply.code(400).send({ error: 'unknown_plan_or_unconfigured' });

    const reservation = await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe(
        'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
        `billing-workspace:${workspaceId}`
      );
      const existingIntent = await tx.billingIntent.findFirst({
        where: { workspaceId, kind: 'SUBSCRIPTION', idempotencyKey },
      });
      if (existingIntent && existingIntent.plan !== plan) {
        return { ok: false as const, error: 'idempotency_key_conflict' };
      }
      if (existingIntent && ['CANCELED', 'FAILED'].includes(existingIntent.status)) {
        return { ok: false as const, error: 'subscription_checkout_closed' };
      }
      const [workspace, billableSubscription, competingIntent] = await Promise.all([
        tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { paypalSubscriptionId: true } }),
        tx.billingSubscription.findFirst({
          where: {
            workspaceId,
            status: { in: ['PENDING', 'ACTIVE'] },
            ...(existingIntent ? { billingIntentId: { not: existingIntent.id } } : {}),
          },
          select: { id: true },
        }),
        tx.billingIntent.findFirst({
          where: {
            workspaceId,
            kind: 'SUBSCRIPTION',
            status: { in: ['CREATED', 'PENDING_APPROVAL', 'APPROVED'] },
            ...(existingIntent ? { id: { not: existingIntent.id } } : {}),
          },
          select: { id: true },
        }),
      ]);
      const providerSubscriptionConflict = workspace.paypalSubscriptionId &&
        workspace.paypalSubscriptionId !== existingIntent?.paypalSubscriptionId;
      if (billableSubscription || competingIntent || providerSubscriptionConflict) {
        return { ok: false as const, error: 'subscription_already_pending_or_active' };
      }
      const intent = existingIntent ?? await tx.billingIntent.create({
        data: { workspaceId, kind: 'SUBSCRIPTION', plan, idempotencyKey },
      });
      return { ok: true as const, intent };
    });
    if (!reservation.ok) return reply.code(409).send({ error: reservation.error });
    const { intent } = reservation;    if (intent.approvalUrl && intent.paypalSubscriptionId) {
      await bindSubscriptionIdentity({
        intentId: intent.id,
        paypalSubscriptionId: intent.paypalSubscriptionId,
      });
      return { url: intent.approvalUrl, subscriptionId: intent.paypalSubscriptionId };
    }

    const u = urls();
    const sub = await createSubscription({
      planId,
      intentId: intent.id,
      requestId: `sub-${intent.id}`,
      returnUrl: u.subscribeReturn,
      cancelUrl: u.subscribeCancel,
    });
    const approve = approveUrlOf(sub.links);
    if (!approve) return reply.code(502).send({ error: 'no_approve_link' });

    await bindSubscriptionIdentity({
      intentId: intent.id,
      paypalSubscriptionId: sub.id,
      approvalUrl: approve,
      markPendingApproval: true,
    });

    return { url: approve, subscriptionId: sub.id };
  });

  /** Create a PayPal Order for a credit pack and return the approve URL. */
  app.post('/checkout/credits', { schema: { body: packSchema } }, async (req, reply) => {
    // RBAC (identity wave): billing is the OWNER's privilege alone —
    // ADMIN manages people and settings, never the money.
    const { workspaceId } = requireRole(req, ['OWNER']);
    const { pack } = packSchema.parse(req.body);
    const { amountUsd: amount, creditsCents } = CREDIT_PACKS[pack];
    const idempotencyKey = checkoutKey(req.headers as Record<string, unknown>);
    if (!idempotencyKey) return reply.code(400).send({ error: 'idempotency_key_required' });

    let intent = await prisma.billingIntent.findFirst({
      where: { workspaceId, kind: 'CREDIT_PACK', idempotencyKey },
    });
    if (intent && intent.packKey !== pack) return reply.code(409).send({ error: 'idempotency_key_conflict' });
    if (!intent) {
      try {
        intent = await prisma.billingIntent.create({
          data: {
            workspaceId,
            kind: 'CREDIT_PACK',
            packKey: pack,
            amountUsd: amount,
            currency: 'USD',
            creditsCents,
            idempotencyKey,
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        intent = await prisma.billingIntent.findFirstOrThrow({
          where: { workspaceId, kind: 'CREDIT_PACK', idempotencyKey },
        });
      }
    }
    if (intent.approvalUrl && intent.paypalOrderId) {
      return { url: intent.approvalUrl, orderId: intent.paypalOrderId };
    }

    const u = urls();
    const order = await createOrder({
      amountUsd: amount,
      intentId: intent.id,
      requestId: `order-${intent.id}`,
      packKey: pack,
      returnUrl: u.orderReturn,
      cancelUrl: u.orderCancel,
    });
    const approve = approveUrlOf(order.links);
    if (!approve) return reply.code(502).send({ error: 'no_approve_link' });
    await prisma.billingIntent.update({
      where: { id: intent.id },
      data: { paypalOrderId: order.id, approvalUrl: approve, status: 'PENDING_APPROVAL' },
    });
    return { url: approve, orderId: order.id };
  });

  /**
   * Return URL after the user approves a *subscription* on PayPal. We hit
   * PayPal once to confirm the subscription is real, persist any updated
   * status, then forward to the web success page. The plan tier itself is
   * applied authoritatively when BILLING.SUBSCRIPTION.ACTIVATED arrives on
   * the webhook — this just gives the user something to look at.
   */
  app.get<{ Querystring: { subscription_id?: string; ba_token?: string } }>(
    '/return/subscription',
    async (req, reply) => {
      const u = urls();
      const subId = req.query.subscription_id;
      if (!subId) return reply.redirect(`${u.webCancel}?reason=missing_subscription`, 302);
      try {
        const sub = await getSubscription(subId);
        const intent = sub.custom_id
          ? await prisma.billingIntent.findFirst({
              where: { id: sub.custom_id, paypalSubscriptionId: subId, kind: 'SUBSCRIPTION' },
            })
          : null;
        if (!intent?.plan || PLAN_ID_FOR_TIER[intent.plan] !== sub.plan_id) {
          return reply.redirect(`${u.webCancel}?reason=invalid_subscription`, 302);
        }
        await prisma.billingIntent.updateMany({
          where: {
            id: intent.id,
            status: { in: ['CREATED', 'PENDING_APPROVAL', 'APPROVED'] },
          },
          data: { status: sub.status === 'ACTIVE' ? 'APPROVED' : 'PENDING_APPROVAL' },
        });
        req.log.info({ subId, status: sub.status, plan: sub.plan_id }, 'paypal sub return');
        return reply.redirect(`${u.webSuccess}?type=subscription&status=${encodeURIComponent(sub.status)}`, 302);
      } catch (err) {
        req.log.error({ err, subId }, 'paypal sub return fetch failed');
        return reply.redirect(`${u.webSuccess}?type=subscription&status=pending`, 302);
      }
    }
  );

  /**
   * Return URL after the user approves a *credit pack order*. PayPal sends
   * `?token=<ORDER_ID>&PayerID=<...>`. We capture the order server-side and
   * grant credits immediately. The webhook is the safety net for the case
   * where the user closes the tab before this fires.
   *
   * Idempotency: the capture id is stored on CreditLedger.paypalEventId,
   * so a webhook arrival for the same capture is a no-op.
   */
  app.get<{ Querystring: { token?: string; PayerID?: string } }>(
    '/return/order',
    async (req, reply) => {
      const u = urls();
      const orderId = req.query.token;
      if (!orderId) return reply.redirect(`${u.webCancel}?reason=missing_order`, 302);
      try {
        const captured = await captureOrder(orderId, `capture-${orderId}`);
        const unit = captured.purchase_units?.[0];
        const cap = unit?.payments?.captures?.[0];
        const customId = cap?.custom_id ?? unit?.custom_id;
        const intent = cap && customId && cap.status === 'COMPLETED' && captured.status === 'COMPLETED'
          ? await resolveCreditIntent({ intentId: customId, paypalOrderId: orderId, amount: cap.amount })
          : null;
        if (!cap || !intent) {
          req.log.warn({ orderId, status: captured.status, captureStatus: cap?.status }, 'paypal capture failed catalog validation');
          return reply.redirect(`${u.webSuccess}?type=order&status=${encodeURIComponent(captured.status)}`, 302);
        }

        await applyCreditCapture({ intent, captureId: cap.id, orderId });

        return reply.redirect(`${u.webSuccess}?type=order&status=COMPLETED`, 302);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          return reply.redirect(`${u.webSuccess}?type=order&status=COMPLETED`, 302);
        }
        req.log.error({ err, orderId }, 'paypal capture failed');
        return reply.redirect(`${u.webCancel}?reason=capture_failed`, 302);
      }
    }
  );

  /**
   * Cancel the active subscription. PayPal will then send
   * BILLING.SUBSCRIPTION.CANCELLED, which downgrades the workspace plan.
   */
  app.post('/subscription/cancel', async (req, reply) => {
    // RBAC (identity wave): billing is the OWNER's privilege alone —
    // ADMIN manages people and settings, never the money.
    const { workspaceId } = requireRole(req, ['OWNER']);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    if (!ws.paypalSubscriptionId) return reply.code(400).send({ error: 'no_active_subscription' });
    await cancelSubscription(ws.paypalSubscriptionId, 'user_request', `cancel-${ws.paypalSubscriptionId}`);
    return { ok: true };
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { costOf } from '@afrohit/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  approveUrlOf,
  cancelSubscription,
  captureOrder,
  createOrder,
  createSubscription,
  getSubscription,
} from '../lib/paypal';
import { CREDIT_PACK_KEYS, CREDIT_PACKS, validateCreditPackCapture } from '../lib/billing-catalog';

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

export default async function billing(app: FastifyInstance) {
  /**
   * PRE-FLIGHT — can the workspace afford a generation RIGHT NOW?
   * Read-only mirror of chargeCredits' gate logic so the UI can refuse BEFORE
   * the user commits to a multi-minute wait (the old flow errored after it).
   */
  app.get('/preflight', async (req) => {
    const { workspaceId } = requireAuth(req);
    const { isInternalMode } = await import('../middleware/auth');
    if (isInternalMode()) {
      // Mirror chargeCredits: the cap only exists when explicitly opted in via
      // ENFORCE_GENERATION_CAP=1 (else unlimited) — so a stale Railway
      // MAX_DAILY_GENERATIONS can never make the UI pre-block a generation.
      const cap = process.env.ENFORCE_GENERATION_CAP === '1' ? Number(process.env.MAX_DAILY_GENERATIONS ?? 1000) : 0; // 0 = unlimited (testing phase)
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const usedToday = await prisma.creditLedger.count({
        where: { workspaceId, createdAt: { gte: since }, delta: { lt: 0 } },
      });
      const remaining = cap > 0 ? Math.max(0, cap - usedToday) : Number.MAX_SAFE_INTEGER;
      return { ok: remaining > 0, mode: 'internal', usedToday, cap, remainingToday: remaining };
    }
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { creditsCents: true } });
    // A full sung song is the most expensive common action — use its REAL cost as
    // the bar (audit #10: preflight hardcoded $2.00 while the charge is $7.50, so
    // it green-lit renders the user couldn't afford). One cost function everywhere.
    const estimatedCostCents = costOf('full_song_demo');
    return { ok: ws.creditsCents >= estimatedCostCents, mode: 'credits', balanceCents: ws.creditsCents, estimatedCostCents };
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
    const { workspaceId } = requireRole(req, ['OWNER', 'ADMIN']);
    const { plan } = subscribeSchema.parse(req.body);
    const planId = PLAN_ID_FOR_TIER[plan];
    if (!planId) return reply.code(400).send({ error: 'unknown_plan_or_unconfigured' });

    const u = urls();
    const sub = await createSubscription({
      planId,
      workspaceId,
      returnUrl: u.subscribeReturn,
      cancelUrl: u.subscribeCancel,
    });
    const approve = approveUrlOf(sub.links);
    if (!approve) return reply.code(502).send({ error: 'no_approve_link' });

    // Stash the subscription id immediately so we can correlate the return URL
    // even before the webhook fires. The plan tier itself isn't applied until
    // BILLING.SUBSCRIPTION.ACTIVATED arrives.
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { paypalSubscriptionId: sub.id },
    });

    return { url: approve, subscriptionId: sub.id };
  });

  /** Create a PayPal Order for a credit pack and return the approve URL. */
  app.post('/checkout/credits', { schema: { body: packSchema } }, async (req, reply) => {
    const { workspaceId } = requireRole(req, ['OWNER', 'ADMIN']);
    const { pack } = packSchema.parse(req.body);
    const { amountUsd: amount, creditsCents } = CREDIT_PACKS[pack];

    const u = urls();
    const order = await createOrder({
      amountUsd: amount,
      workspaceId,
      packKey: pack,
      creditsCents,
      returnUrl: u.orderReturn,
      cancelUrl: u.orderCancel,
    });
    const approve = approveUrlOf(order.links);
    if (!approve) return reply.code(502).send({ error: 'no_approve_link' });
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
        const captured = await captureOrder(orderId);
        const unit = captured.purchase_units?.[0];
        const cap = unit?.payments?.captures?.[0];
        const customId = cap?.custom_id ?? unit?.custom_id;
        const meta = cap && customId && cap.status === 'COMPLETED' && captured.status === 'COMPLETED'
          ? validateCreditPackCapture(customId, cap.amount)
          : null;
        if (!cap || !meta) {
          req.log.warn({ orderId, status: captured.status, captureStatus: cap?.status }, 'paypal capture failed catalog validation');
          return reply.redirect(`${u.webSuccess}?type=order&status=${encodeURIComponent(captured.status)}`, 302);
        }

        // Idempotent credit application keyed by the *capture id*.
        const existing = await prisma.creditLedger.findUnique({ where: { paypalEventId: cap.id } });
        if (!existing) {
          await prisma.$transaction([
            prisma.workspace.update({
              where: { id: meta.workspaceId },
              data: { creditsCents: { increment: meta.creditsCents } },
            }),
            prisma.creditLedger.create({
              data: {
                workspaceId: meta.workspaceId,
                delta: meta.creditsCents,
                reason: 'topup_paypal',
                paypalEventId: cap.id,
                meta: { orderId, pack: meta.pack, captureAmount: cap.amount } as never,
              },
            }),
          ]);
        }

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
    const { workspaceId } = requireRole(req, ['OWNER', 'ADMIN']);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    if (!ws.paypalSubscriptionId) return reply.code(400).send({ error: 'no_active_subscription' });
    await cancelSubscription(ws.paypalSubscriptionId, 'user_request');
    return { ok: true };
  });
}

/**
 * Webhooks — PayPal, music providers, video providers.
 *
 * PayPal verification is an outbound API call to /v1/notifications/verify-webhook-signature
 * with the original headers + body + the configured PAYPAL_WEBHOOK_ID.
 *
 * Raw body is required for downstream provider webhooks that sign over bytes,
 * so we opt out of Fastify's default JSON parser at the plugin scope.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { PLAN_CREDIT_GRANT_CENTS } from '@afrohit/shared';
import { verifyWebhookSignature, type WebhookHeaders } from '../lib/paypal';
import { creditReceiptEmail, sendEmail } from '../lib/email';
import { track } from '../lib/observability';
import { constantTimeSecretEqual } from '../lib/session';
import { applyCreditCapture, resolveCreditIntent } from '../lib/billing-service';

export default async function webhooks(app: FastifyInstance) {
  // Override the default JSON parser within this plugin scope so we keep the
  // raw bytes available. PayPal signature verification needs the parsed JSON
  // object; signed Stripe/Svix-style webhooks (future) need raw bytes.
  // Fastify v5 lets the same content-type be re-registered inside a child scope.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      try {
        const buf = body as Buffer;
        // Stash the raw bytes on the request for handlers that need them later.
        (_req as unknown as { rawBody?: Buffer }).rawBody = buf;
        const json = buf.length ? JSON.parse(buf.toString('utf8')) : {};
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // ---------- PayPal ----------
  app.post('/paypal', async (req, reply) => {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) return reply.code(500).send({ error: 'paypal_webhook_not_configured' });

    const event = req.body as PaypalEvent | null;
    if (!event || !event.id || !event.event_type) {
      return reply.code(400).send({ error: 'bad_body' });
    }

    const headers: WebhookHeaders = {
      'paypal-auth-algo': req.headers['paypal-auth-algo'] as string | undefined,
      'paypal-cert-url': req.headers['paypal-cert-url'] as string | undefined,
      'paypal-transmission-id': req.headers['paypal-transmission-id'] as string | undefined,
      'paypal-transmission-sig': req.headers['paypal-transmission-sig'] as string | undefined,
      'paypal-transmission-time': req.headers['paypal-transmission-time'] as string | undefined,
    };
    const verified = await verifyWebhookSignature({ headers, webhookId, body: event });
    if (!verified) {
      req.log.warn({ eventId: event.id }, 'paypal webhook signature failed');
      return reply.code(400).send({ error: 'bad_signature' });
    }

    const now = new Date();
    const staleBefore = new Date(now.getTime() - 15 * 60_000);
    let claimed = false;
    let audit = await prisma.billingEvent.findUnique({ where: { paypalEventId: event.id } });
    if (audit?.status === 'processed' || audit?.status === 'ignored' || audit?.status === 'unmatched') {
      return reply.send({ received: true, idempotent: true });
    }
    if (!audit) {
      try {
        audit = await prisma.billingEvent.create({
          data: {
            paypalEventId: event.id,
            eventType: event.event_type,
            resourceId: typeof event.resource.id === 'string' ? event.resource.id : null,
            processingAt: now,
          },
        });
        claimed = true;
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        audit = await prisma.billingEvent.findUniqueOrThrow({ where: { paypalEventId: event.id } });
      }
    }
    if (!claimed) {
      const lease = await prisma.billingEvent.updateMany({
        where: {
          id: audit.id,
          status: { notIn: ['processed', 'ignored', 'unmatched'] },
          OR: [
            { status: { not: 'processing' } },
            { processingAt: null },
            { processingAt: { lte: staleBefore } },
          ],
        },
        data: { status: 'processing', errorCode: null, processingAt: now, attempts: { increment: 1 } },
      });
      if (lease.count === 0) return reply.send({ received: true, idempotent: true, processing: true });
    }

    try {
      let workspaceId: string | null = null;
      let recognized = true;
      switch (event.event_type) {
        case 'BILLING.SUBSCRIPTION.ACTIVATED': {
          workspaceId = await activateSubscription(event);
          break;
        }
        case 'BILLING.SUBSCRIPTION.CANCELLED':
        case 'BILLING.SUBSCRIPTION.EXPIRED':
        case 'BILLING.SUBSCRIPTION.SUSPENDED': {
          workspaceId = await downgradeSubscription(event);
          break;
        }
        case 'PAYMENT.CAPTURE.COMPLETED': {
          // One-off credit pack purchases land here as well as the return URL.
          workspaceId = await creditCapture(event);
          break;
        }
        case 'PAYMENT.SALE.COMPLETED': {
          // Recurring subscription payment → grant this cycle's credit allowance
          // (audit: previously a no-op, so month 2+ delivered nothing).
          workspaceId = await grantRecurring(event);
          req.log.info({ eventId: event.id }, 'paypal recurring sale completed');
          break;
        }
        default:
          recognized = false;
          req.log.info({ eventType: event.event_type }, 'paypal webhook unhandled');
          break;
      }
      if (recognized && !workspaceId) {
        req.log.warn({ eventId: event.id, eventType: event.event_type }, 'paypal event did not match a trusted billing intent');
        await prisma.billingEvent.update({
          where: { id: audit.id },
          data: { status: 'unmatched', errorCode: 'unmatched_resource', processedAt: new Date(), processingAt: null },
        });
        return { received: true, matched: false };
      }
      await prisma.billingEvent.update({
        where: { id: audit.id },
        data: {
          status: recognized ? 'processed' : 'ignored',
          processedAt: new Date(),
          processingAt: null,
          workspaceId,
        },
      });
    } catch (error) {
      await prisma.billingEvent.update({
        where: { id: audit.id },
        data: { status: 'failed', processingAt: null, errorCode: (error as { code?: string }).code ?? 'handler_failed' },
      }).catch(() => undefined);
      throw error;
    }

    return { received: true };
  });

  // ---------- Music provider (Eleven / Stable Audio etc) ----------
  app.post('/music', async (req, reply) => {
    const internal = req.headers['x-internal-secret'];
    if (!constantTimeSecretEqual(internal, process.env.INTERNAL_API_SECRET)) {
      // For real providers, replace this with provider-specific signature checks.
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return reply.send({ ok: true });
  });

  // ---------- Video provider ----------
  app.post('/video', async (req, reply) => {
    const internal = req.headers['x-internal-secret'];
    if (!constantTimeSecretEqual(internal, process.env.INTERNAL_API_SECRET)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return reply.send({ ok: true });
  });

  // (Clerk webhook removed — internal auth mode creates the default workspace
  //  lazily; a future Google-auth mode would add its own user-provisioning here.)
}

// --------- PayPal event types (minimal) -------------------------------------

interface PaypalEvent {
  id: string;
  event_type: string;
  resource: Record<string, unknown>;
}

// --------- handlers ---------------------------------------------------------

async function activateSubscription(event: PaypalEvent): Promise<string | null> {
  const r = event.resource as { id?: string; plan_id?: string; custom_id?: string };
  if (!r.custom_id || !r.plan_id || !r.id) return null;
  const plan = mapPlanIdToTier(r.plan_id);
  if (!plan) return null;
  // Activation proves the subscription and flips the plan. Credits are granted
  // only by a completed sale event, so activation plus the first-cycle sale
  // cannot double-credit the workspace.
  const intent = await prisma.billingIntent.findFirst({
    where: { id: r.custom_id, kind: 'SUBSCRIPTION' },
  });
  if (!intent || intent.plan !== plan) return null;
  if (intent.paypalSubscriptionId && intent.paypalSubscriptionId !== r.id) {
    throw new Error('subscription intent provider mismatch');
  }
  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: intent.workspaceId },
      data: { plan, paypalSubscriptionId: r.id },
    }),
    prisma.billingIntent.update({
      where: { id: intent.id },
      data: { paypalSubscriptionId: r.id, status: 'APPROVED' },
    }),
  ]);
  return intent.workspaceId;
}

/** Grant a subscription cycle's credit allowance. Idempotent via the unique
 *  paypalEventId — a re-delivered webhook grants nothing twice. */
async function grantRecurring(event: PaypalEvent): Promise<string | null> {
  const r = event.resource as { id?: string; billing_agreement_id?: string };
  const subId = r.billing_agreement_id;
  if (!subId || !r.id) return null;
  const ws = await prisma.workspace.findUnique({ where: { paypalSubscriptionId: subId } });
  if (!ws) return null;
  const grant = PLAN_CREDIT_GRANT_CENTS[ws.plan as keyof typeof PLAN_CREDIT_GRANT_CENTS] ?? 0;
  if (!grant) return ws.id;
  try {
    await prisma.$transaction([
      prisma.workspace.update({ where: { id: ws.id }, data: { creditsCents: { increment: grant } } }),
      prisma.creditLedger.create({
        data: {
          workspaceId: ws.id,
          delta: grant,
          reason: 'paypal_subscription_cycle',
          paypalEventId: event.id,
          idempotencyKey: `paypal-sale:${subId}:${r.id}`,
          meta: { grant, subscriptionId: subId, saleId: r.id } as never,
        },
      }),
      prisma.billingIntent.updateMany({
        where: { paypalSubscriptionId: subId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
    ]);
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002') throw e;
  }
  return ws.id;
}

async function downgradeSubscription(event: PaypalEvent): Promise<string | null> {
  const r = event.resource as { id?: string; custom_id?: string };
  const subscriptionId = r.id;
  if (!subscriptionId) return null;
  // Find workspace by subscription id (custom_id may not be present on cancel events).
  const ws = await prisma.workspace.findUnique({ where: { paypalSubscriptionId: subscriptionId } });
  if (!ws) return null;
  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: ws.id },
      data: { plan: 'STARTER', paypalSubscriptionId: null },
    }),
    prisma.billingIntent.updateMany({
      where: { paypalSubscriptionId: subscriptionId },
      data: { status: 'CANCELED' },
    }),
  ]);
  return ws.id;
}

async function creditCapture(event: PaypalEvent): Promise<string | null> {
  const r = event.resource as { id?: string; status?: string; custom_id?: string; amount?: { value: string; currency_code: string } };
  if (!r.id || !r.custom_id || r.status !== 'COMPLETED') return null;
  const intent = await resolveCreditIntent({ intentId: r.custom_id, amount: r.amount });
  if (!intent) return null;
  // Idempotency — keyed by capture id (r.id), not the event id, so the
  // return-URL path and the webhook path collapse to the same row.
  const result = await applyCreditCapture({
    intent,
    captureId: r.id,
    webhookEventId: event.id,
  });
  // Receipt email to the workspace owner (best-effort).
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId: intent.workspaceId, role: 'OWNER' },
    include: { user: { select: { email: true, id: true } } },
  });
  if (owner && result.applied) {
    const usd = (n: number) => `$${(n / 10_000).toFixed(2)}`;
    const tpl = creditReceiptEmail(usd(intent.creditsCents!), usd(result.balance));
    await sendEmail({ to: owner.user.email, ...tpl });
    track('credits_purchased', owner.user.id, { pack: intent.packKey, creditsCents: intent.creditsCents });
  }
  return intent.workspaceId;
}

function mapPlanIdToTier(planId: string): 'STARTER' | 'CREATOR' | 'PRO' | 'STUDIO' | null {
  if (planId === process.env.PAYPAL_PLAN_STARTER) return 'STARTER';
  if (planId === process.env.PAYPAL_PLAN_CREATOR) return 'CREATOR';
  if (planId === process.env.PAYPAL_PLAN_PRO) return 'PRO';
  if (planId === process.env.PAYPAL_PLAN_STUDIO) return 'STUDIO';
  return null;
}

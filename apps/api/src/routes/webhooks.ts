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

    // Global idempotency — PayPal retries the same event id on failure.
    const dup = await prisma.creditLedger.findUnique({ where: { paypalEventId: event.id } });
    if (dup) return reply.send({ received: true, idempotent: true });

    try {
      switch (event.event_type) {
        case 'BILLING.SUBSCRIPTION.ACTIVATED': {
          await activateSubscription(event);
          break;
        }
        case 'BILLING.SUBSCRIPTION.CANCELLED':
        case 'BILLING.SUBSCRIPTION.EXPIRED':
        case 'BILLING.SUBSCRIPTION.SUSPENDED': {
          await downgradeSubscription(event);
          break;
        }
        case 'PAYMENT.CAPTURE.COMPLETED': {
          // One-off credit pack purchases land here as well as the return URL.
          await creditCapture(event);
          break;
        }
        case 'PAYMENT.SALE.COMPLETED': {
          // Recurring subscription payment → grant this cycle's credit allowance
          // (audit: previously a no-op, so month 2+ delivered nothing).
          await grantRecurring(event);
          req.log.info({ eventId: event.id }, 'paypal recurring sale completed');
          break;
        }
        default:
          req.log.info({ eventType: event.event_type }, 'paypal webhook unhandled');
          break;
      }
    } catch (err) {
      // Concurrent delivery race (webhook + return-URL landing at once): the
      // check-then-act dup test can pass on both, but the @unique paypalEventId
      // aborts the LOSER'S whole transaction — so credits can never double-apply.
      // Treat that unique violation as idempotent success instead of 500ing
      // (a 500 would make PayPal retry forever).
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') {
        req.log.info({ eventId: event.id }, 'paypal webhook idempotent (concurrent duplicate)');
        return reply.send({ received: true, idempotent: true });
      }
      throw err;
    }

    return { received: true };
  });

  // ---------- Music provider (Eleven / Stable Audio etc) ----------
  app.post('/music', async (req, reply) => {
    const internal = req.headers['x-internal-secret'];
    if (internal !== process.env.INTERNAL_API_SECRET) {
      // For real providers, replace this with provider-specific signature checks.
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return reply.send({ ok: true });
  });

  // ---------- Video provider ----------
  app.post('/video', async (req, reply) => {
    const internal = req.headers['x-internal-secret'];
    if (internal !== process.env.INTERNAL_API_SECRET) {
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

async function activateSubscription(event: PaypalEvent) {
  const r = event.resource as { id?: string; plan_id?: string; custom_id?: string };
  const workspaceId = r.custom_id;
  if (!workspaceId || !r.plan_id || !r.id) return;
  const plan = mapPlanIdToTier(r.plan_id);
  if (!plan) return;
  // GRANT THE TIER'S CREDITS (audit DANGEROUS): activation used to write a
  // delta:0 ledger row — a paying PRO/STUDIO customer received ZERO capability.
  // Now the plan flip, the credit grant, and the idempotency stamp commit as one
  // transaction (paypalEventId unique = replay-safe: a re-delivered webhook
  // collides on the ledger row and grants nothing twice).
  const grant = PLAN_CREDIT_GRANT_CENTS[plan] ?? 0;
  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: workspaceId },
      data: { plan, paypalSubscriptionId: r.id, creditsCents: { increment: grant } },
    }),
    prisma.creditLedger.create({
      data: {
        workspaceId,
        delta: grant,
        reason: 'paypal_subscription_activated',
        paypalEventId: event.id,
        meta: { subscriptionId: r.id, planId: r.plan_id, grant } as never,
      },
    }),
  ]);
}

/** Grant a subscription cycle's credit allowance. Idempotent via the unique
 *  paypalEventId — a re-delivered webhook grants nothing twice. */
async function grantRecurring(event: PaypalEvent) {
  const r = event.resource as { billing_agreement_id?: string; custom_id?: string };
  const subId = r.billing_agreement_id;
  const ws = subId
    ? await prisma.workspace.findUnique({ where: { paypalSubscriptionId: subId } })
    : r.custom_id
      ? await prisma.workspace.findUnique({ where: { id: r.custom_id } })
      : null;
  if (!ws) return;
  const grant = PLAN_CREDIT_GRANT_CENTS[ws.plan as keyof typeof PLAN_CREDIT_GRANT_CENTS] ?? 0;
  if (!grant) return;
  try {
    await prisma.$transaction([
      prisma.workspace.update({ where: { id: ws.id }, data: { creditsCents: { increment: grant } } }),
      prisma.creditLedger.create({
        data: { workspaceId: ws.id, delta: grant, reason: 'paypal_subscription_renewal', paypalEventId: event.id, meta: { grant } as never },
      }),
    ]);
  } catch (e) {
    // Unique paypalEventId collision = already granted for this delivery. Fine.
    if ((e as { code?: string }).code !== 'P2002') throw e;
  }
}

async function downgradeSubscription(event: PaypalEvent) {
  const r = event.resource as { id?: string; custom_id?: string };
  const subscriptionId = r.id;
  if (!subscriptionId) return;
  // Find workspace by subscription id (custom_id may not be present on cancel events).
  const ws = await prisma.workspace.findUnique({ where: { paypalSubscriptionId: subscriptionId } });
  if (!ws) return;
  // One transaction: the downgrade and its idempotency stamp commit together.
  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: ws.id },
      data: { plan: 'STARTER', paypalSubscriptionId: null },
    }),
    prisma.creditLedger.create({
      data: {
        workspaceId: ws.id,
        delta: 0,
        reason: `paypal_${event.event_type.toLowerCase()}`,
        paypalEventId: event.id,
        meta: { subscriptionId } as never,
      },
    }),
  ]);
}

async function creditCapture(event: PaypalEvent) {
  const r = event.resource as { id?: string; custom_id?: string; amount?: { value: string; currency_code: string } };
  if (!r.id || !r.custom_id) return;
  let meta: { workspaceId: string; pack: string; creditsCents: number };
  try {
    meta = JSON.parse(r.custom_id);
  } catch {
    return;
  }
  // Idempotency — keyed by capture id (r.id), not the event id, so the
  // return-URL path and the webhook path collapse to the same row.
  const existing = await prisma.creditLedger.findUnique({ where: { paypalEventId: r.id } });
  if (existing) return;
  const [ws] = await prisma.$transaction([
    prisma.workspace.update({
      where: { id: meta.workspaceId },
      data: { creditsCents: { increment: meta.creditsCents } },
    }),
    prisma.creditLedger.create({
      data: {
        workspaceId: meta.workspaceId,
        delta: meta.creditsCents,
        reason: 'topup_paypal',
        paypalEventId: r.id,
        meta: { pack: meta.pack, captureAmount: r.amount, webhookEventId: event.id } as never,
      },
    }),
  ]);
  // Receipt email to the workspace owner (best-effort).
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId: meta.workspaceId, role: 'OWNER' },
    include: { user: { select: { email: true, id: true } } },
  });
  if (owner) {
    const usd = (n: number) => `$${(n / 10_000).toFixed(2)}`;
    const tpl = creditReceiptEmail(usd(meta.creditsCents), usd(ws.creditsCents));
    await sendEmail({ to: owner.user.email, ...tpl });
    track('credits_purchased', owner.user.id, { pack: meta.pack, creditsCents: meta.creditsCents });
  }
}

function mapPlanIdToTier(planId: string): 'STARTER' | 'CREATOR' | 'PRO' | 'STUDIO' | null {
  if (planId === process.env.PAYPAL_PLAN_STARTER) return 'STARTER';
  if (planId === process.env.PAYPAL_PLAN_CREATOR) return 'CREATOR';
  if (planId === process.env.PAYPAL_PLAN_PRO) return 'PRO';
  if (planId === process.env.PAYPAL_PLAN_STUDIO) return 'STUDIO';
  return null;
}

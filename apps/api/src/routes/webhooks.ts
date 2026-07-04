/**
 * Webhooks — PayPal, music providers, video providers, Clerk.
 *
 * PayPal verification is an outbound API call to /v1/notifications/verify-webhook-signature
 * with the original headers + body + the configured PAYPAL_WEBHOOK_ID.
 *
 * Raw body is required for downstream provider webhooks that sign over bytes,
 * so we opt out of Fastify's default JSON parser at the plugin scope.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { verifyWebhookSignature, type WebhookHeaders } from '../lib/paypal';
import { creditReceiptEmail, sendEmail, welcomeEmail } from '../lib/email';
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
        // Recurring subscription payments. We don't need to do anything here;
        // logging is enough since the plan is already active.
        req.log.info({ eventId: event.id }, 'paypal recurring sale completed');
        break;
      }
      default:
        req.log.info({ eventType: event.event_type }, 'paypal webhook unhandled');
        break;
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

  // ---------- Clerk user.created → mirror into our User table ----------
  app.post('/clerk', async (req, reply) => {
    const event = req.body as ClerkEvent | null;
    if (!event || !event.type || !event.data?.id) {
      return reply.code(400).send({ error: 'bad_body' });
    }
    // Add svix-signature verification here in production.
    if (event.type === 'user.created' || event.type === 'user.updated') {
      const email = event.data.email_addresses[0]?.email_address;
      if (!email) return reply.send({ ok: true });
      const fullName = [event.data.first_name, event.data.last_name].filter(Boolean).join(' ').trim() || undefined;
      const user = await prisma.user.upsert({
        where: { clerkId: event.data.id },
        update: { email, fullName: fullName ?? null, avatarUrl: event.data.image_url ?? null },
        create: {
          clerkId: event.data.id,
          email,
          fullName: fullName ?? null,
          avatarUrl: event.data.image_url ?? null,
        },
      });
      const existing = await prisma.workspaceMember.findFirst({ where: { userId: user.id } });
      if (!existing) {
        const slug = `ws-${user.id.slice(-8).toLowerCase()}`;
        const ws = await prisma.workspace.create({
          data: { name: `${fullName ?? 'My'} Studio`, slug, plan: 'STARTER', creditsCents: 5_000_00 /* $5 onboarding credit */ },
        });
        await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' } });
        const tpl = welcomeEmail(fullName ?? null);
        await sendEmail({ to: email, ...tpl });
        track('user_signed_up', user.id, { workspaceId: ws.id });
      }
    }
    return reply.send({ ok: true });
  });
}

// --------- PayPal event types (minimal) -------------------------------------

interface PaypalEvent {
  id: string;
  event_type: string;
  resource: Record<string, unknown>;
}

interface ClerkEvent {
  type: string;
  data: {
    id: string;
    email_addresses: Array<{ email_address: string }>;
    first_name?: string;
    last_name?: string;
    image_url?: string;
  };
}

// --------- handlers ---------------------------------------------------------

async function activateSubscription(event: PaypalEvent) {
  const r = event.resource as { id?: string; plan_id?: string; custom_id?: string };
  const workspaceId = r.custom_id;
  if (!workspaceId || !r.plan_id || !r.id) return;
  const plan = mapPlanIdToTier(r.plan_id);
  if (!plan) return;
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { plan, paypalSubscriptionId: r.id },
  });
  // Stamp the event so we don't double-process retries.
  await prisma.creditLedger.create({
    data: {
      workspaceId,
      delta: 0,
      reason: 'paypal_subscription_activated',
      paypalEventId: event.id,
      meta: { subscriptionId: r.id, planId: r.plan_id } as never,
    },
  });
}

async function downgradeSubscription(event: PaypalEvent) {
  const r = event.resource as { id?: string; custom_id?: string };
  const subscriptionId = r.id;
  if (!subscriptionId) return;
  // Find workspace by subscription id (custom_id may not be present on cancel events).
  const ws = await prisma.workspace.findUnique({ where: { paypalSubscriptionId: subscriptionId } });
  if (!ws) return;
  await prisma.workspace.update({
    where: { id: ws.id },
    data: { plan: 'STARTER', paypalSubscriptionId: null },
  });
  await prisma.creditLedger.create({
    data: {
      workspaceId: ws.id,
      delta: 0,
      reason: `paypal_${event.event_type.toLowerCase()}`,
      paypalEventId: event.id,
      meta: { subscriptionId } as never,
    },
  });
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

/**
 * Webhooks — PayPal billing and signed distributor lifecycle events.
 *
 * PayPal verification is an outbound API call to /v1/notifications/verify-webhook-signature
 * with the original headers + body + the configured PAYPAL_WEBHOOK_ID.
 *
 * Raw body is required for downstream provider webhooks that sign over bytes,
 * so we opt out of Fastify's default JSON parser at the plugin scope.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@afrohit/db";
import { verifyWebhookSignature, type WebhookHeaders } from "../lib/paypal";
import { creditReceiptEmail, sendEmail } from "../lib/email";
import { track } from "../lib/observability";
import {
  applyBillingAdjustment,
  applyCreditCapture,
  applySubscriptionSale,
  applySubscriptionStatus,
  bindSubscriptionIdentity,
  paypalMoneyToCents,
  resolveCreditIntent,
} from "../lib/billing-service";
import {
  sanitizeDistributionChannels,
  verifyDistributionSignature,
} from "../lib/distribution";

const distributorEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    event: z.literal("release.status"),
    eventId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
    externalId: z.string().min(1).max(200),
    status: z.enum(["accepted", "live", "failed", "cancelled"]),
    occurredAt: z.string().datetime({ offset: true }),
    channels: z.record(z.string()).optional(),
    message: z.string().max(500).optional(),
  })
  .strict();

function singleHeader(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function distributionStatusRank(status: string): number {
  if (status === "accepted") return 1;
  if (status === "failed" || status === "cancelled") return 2;
  if (status === "live") return 3;
  return 0;
}

function shouldApplyDistributionStatus(
  current: { status: string; distributionStatusAt: Date | null },
  incomingStatus: string,
  occurredAt: Date
): boolean {
  const currentRank = distributionStatusRank(current.status);
  const incomingRank = distributionStatusRank(incomingStatus);
  if (incomingRank < currentRank) return false;
  if (!current.distributionStatusAt) return true;
  const timeDelta = occurredAt.getTime() - current.distributionStatusAt.getTime();
  if (timeDelta < 0) return false;
  if (timeDelta === 0) return incomingRank > currentRank;
  return incomingRank >= currentRank;
}

export default async function webhooks(app: FastifyInstance) {
  // Override the default JSON parser within this plugin scope so we keep the
  // raw bytes available. PayPal signature verification needs the parsed JSON
  // object; signed Stripe/Svix-style webhooks (future) need raw bytes.
  // Fastify v5 lets the same content-type be re-registered inside a child scope.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      try {
        const buf = body as Buffer;
        // Stash the raw bytes on the request for handlers that need them later.
        (_req as unknown as { rawBody?: Buffer }).rawBody = buf;
        const json = buf.length ? JSON.parse(buf.toString("utf8")) : {};
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // ---------- PayPal ----------
  app.post("/paypal", async (req, reply) => {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId)
      return reply.code(500).send({ error: "paypal_webhook_not_configured" });

    const event = req.body as PaypalEvent | null;
    if (!event || !event.id || !event.event_type) {
      return reply.code(400).send({ error: "bad_body" });
    }

    const headers: WebhookHeaders = {
      "paypal-auth-algo": req.headers["paypal-auth-algo"] as string | undefined,
      "paypal-cert-url": req.headers["paypal-cert-url"] as string | undefined,
      "paypal-transmission-id": req.headers["paypal-transmission-id"] as
        | string
        | undefined,
      "paypal-transmission-sig": req.headers["paypal-transmission-sig"] as
        | string
        | undefined,
      "paypal-transmission-time": req.headers["paypal-transmission-time"] as
        | string
        | undefined,
    };
    const verified = await verifyWebhookSignature({
      headers,
      webhookId,
      body: event,
    });
    if (!verified) {
      req.log.warn({ eventId: event.id }, "paypal webhook signature failed");
      return reply.code(400).send({ error: "bad_signature" });
    }

    const now = new Date();
    const staleBefore = new Date(now.getTime() - 15 * 60_000);
    let claimed = false;
    let audit = await prisma.billingEvent.findUnique({
      where: { paypalEventId: event.id },
    });
    if (audit?.status === "processed" || audit?.status === "ignored") {
      return reply.send({ received: true, idempotent: true });
    }
    if (!audit) {
      try {
        audit = await prisma.billingEvent.create({
          data: {
            paypalEventId: event.id,
            eventType: event.event_type,
            resourceId:
              typeof event.resource.id === "string" ? event.resource.id : null,
            processingAt: now,
          },
        });
        claimed = true;
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        audit = await prisma.billingEvent.findUniqueOrThrow({
          where: { paypalEventId: event.id },
        });
      }
    }
    if (!claimed) {
      const lease = await prisma.billingEvent.updateMany({
        where: {
          id: audit.id,
          status: { notIn: ["processed", "ignored"] },
          OR: [
            { status: { not: "processing" } },
            { processingAt: null },
            { processingAt: { lte: staleBefore } },
          ],
        },
        data: {
          status: "processing",
          errorCode: null,
          processingAt: now,
          attempts: { increment: 1 },
        },
      });
      if (lease.count === 0)
        return reply.send({
          received: true,
          idempotent: true,
          processing: true,
        });
    }

    try {
      let workspaceId: string | null = null;
      let recognized = true;
      switch (event.event_type) {
        case "BILLING.SUBSCRIPTION.ACTIVATED": {
          workspaceId = await activateSubscription(event);
          break;
        }
        case "BILLING.SUBSCRIPTION.CANCELLED":
        case "BILLING.SUBSCRIPTION.EXPIRED":
        case "BILLING.SUBSCRIPTION.SUSPENDED": {
          workspaceId = await downgradeSubscription(event);
          break;
        }
        case "PAYMENT.CAPTURE.COMPLETED": {
          // One-off credit pack purchases land here as well as the return URL.
          workspaceId = await creditCapture(event);
          break;
        }
        case "PAYMENT.SALE.COMPLETED": {
          // Recurring subscription payment → grant this cycle's credit allowance
          // (audit: previously a no-op, so month 2+ delivered nothing).
          workspaceId = await grantRecurring(event);
          req.log.info(
            { eventId: event.id },
            "paypal recurring sale completed"
          );
          break;
        }
        case "PAYMENT.CAPTURE.REFUNDED":
        case "PAYMENT.SALE.REFUNDED": {
          workspaceId = await refundPayment(event);
          break;
        }
        case "PAYMENT.CAPTURE.REVERSED":
        case "PAYMENT.SALE.REVERSED": {
          workspaceId = await reversePayment(event);
          break;
        }
        case "CUSTOMER.DISPUTE.CREATED":
        case "CUSTOMER.DISPUTE.UPDATED":
        case "CUSTOMER.DISPUTE.RESOLVED": {
          workspaceId = await updateDispute(event);
          break;
        }
        default:
          recognized = false;
          req.log.info(
            { eventType: event.event_type },
            "paypal webhook unhandled"
          );
          break;
      }
      if (recognized && !workspaceId) {
        req.log.warn(
          { eventId: event.id, eventType: event.event_type },
          "paypal event did not match a trusted billing intent"
        );
        await prisma.billingEvent.update({
          where: { id: audit.id },
          data: {
            status: "unmatched",
            errorCode: "unmatched_resource",
            processedAt: new Date(),
            processingAt: null,
          },
        });
        return { received: true, matched: false };
      }
      await prisma.billingEvent.update({
        where: { id: audit.id },
        data: {
          status: recognized ? "processed" : "ignored",
          processedAt: new Date(),
          processingAt: null,
          workspaceId,
        },
      });
    } catch (error) {
      const errorCode = (error as { code?: string }).code ?? "handler_failed";
      if (RETRYABLE_BILLING_DEPENDENCY_CODES.has(errorCode)) {
        await prisma.billingEvent.update({
          where: { id: audit.id },
          data: { status: "retryable", processingAt: null, processedAt: null, errorCode },
        });
        return reply.header("retry-after", "30").code(503).send({ received: false, retryable: true });
      }
      await prisma.billingEvent
        .update({
          where: { id: audit.id },
          data: { status: "failed", processingAt: null, errorCode },
        })
        .catch(() => undefined);
      throw error;
    }

    return { received: true };
  });

  // ---------- Distributor lifecycle ----------
  app.post("/distributor", async (req, reply) => {
    const secret = process.env.DISTRIBUTOR_WEBHOOK_SECRET ?? "";
    if (Buffer.byteLength(secret) < 32) {
      return reply
        .code(500)
        .send({ error: "distributor_webhook_not_configured" });
    }

    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    const timestamp = singleHeader(req.headers["x-afrohit-timestamp"]);
    const signature = singleHeader(req.headers["x-afrohit-signature"]);
    if (
      !rawBody ||
      !verifyDistributionSignature({
        secret,
        timestamp,
        signature,
        body: rawBody,
      })
    ) {
      req.log.warn("distributor webhook signature failed");
      return reply.code(401).send({ error: "bad_signature" });
    }

    const parsed = distributorEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_body" });
    }
    const event = parsed.data;
    const occurredAt = new Date(event.occurredAt);
    if (
      Number.isNaN(occurredAt.getTime()) ||
      occurredAt.getTime() > Date.now() + 5 * 60_000
    ) {
      return reply.code(400).send({ error: "invalid_occurred_at" });
    }

    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const duplicate = await prisma.distributionEvent.findUnique({
      where: { eventId: event.eventId },
    });
    if (duplicate) {
      if (duplicate.payloadHash !== payloadHash) {
        return reply.code(409).send({ error: "event_id_conflict" });
      }
      return {
        received: true,
        idempotent: true,
        applied: duplicate.applied,
      };
    }

    const release = await prisma.release.findUnique({
      where: { externalId: event.externalId },
      select: { id: true, songId: true },
    });
    if (!release) {
      return reply.code(404).send({ error: "release_not_found" });
    }

    const channels = sanitizeDistributionChannels(event.channels);
    try {
      const applied = await prisma.$transaction(async tx => {
        await tx.$queryRawUnsafe(
          "SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))",
          release.songId
        );
        const current = await tx.release.findUniqueOrThrow({
          where: { id: release.id },
          select: {
            liveAt: true,
            songId: true,
            status: true,
            distributionStatusAt: true,
          },
        });
        const didApply = shouldApplyDistributionStatus(
          current,
          event.status,
          occurredAt
        );
        if (didApply) {
          await tx.release.update({
            where: { id: release.id },
            data: {
              status: event.status,
              distributionStatusAt: occurredAt,
              ...(event.status === "live"
                ? {
                    liveAt: current.liveAt ?? occurredAt,
                    releaseDate: current.liveAt ?? occurredAt,
                  }
                : {}),
              ...(channels ? { channels: channels as never } : {}),
            },
          });
          if (event.status === "live") {
            await tx.song.update({
              where: { id: current.songId },
              data: { status: "RELEASED" },
            });
          }
        }

        await tx.distributionEvent.create({
          data: {
            eventId: event.eventId,
            releaseId: release.id,
            externalId: event.externalId,
            status: event.status,
            payloadHash,
            applied: didApply,
            occurredAt,
          },
        });
        return didApply;
      });
      return { received: true, applied };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      const raced = await prisma.distributionEvent.findUnique({
        where: { eventId: event.eventId },
      });
      if (!raced || raced.payloadHash !== payloadHash) {
        return reply.code(409).send({ error: "event_id_conflict" });
      }
      return { received: true, idempotent: true, applied: raced.applied };
    }
  });
  // The Suno-compatible gateway requires a callback URL even though the worker
  // uses authenticated polling as its source of truth. This endpoint has no
  // state-changing behavior, so an unauthenticated callback cannot forge a job.
  app.post("/suno", async (_req, reply) => reply.code(204).send());

  // (Clerk webhook removed — internal auth mode creates the default workspace
  //  lazily; a future Google-auth mode would add its own user-provisioning here.)
}

// --------- PayPal event types (minimal) -------------------------------------

interface PaypalEvent {
  id: string;
  event_type: string;
  create_time?: string;
  resource_type?: string;
  resource: Record<string, unknown>;
}

const RETRYABLE_BILLING_DEPENDENCY_CODES = new Set([
  "billing_entitlement_dependency_missing",
  "credit_intent_dependency_missing",
  "subscription_dependency_missing",
  "subscription_intent_not_found",
]);

function retryableBillingDependency(code: string): Error {
  return Object.assign(new Error(code), { code });
}

// --------- handlers ---------------------------------------------------------

function paypalEventOccurredAt(event: PaypalEvent): Date {
  const resource = event.resource as { create_time?: unknown; update_time?: unknown };
  for (const value of [event.create_time, resource.update_time, resource.create_time]) {
    if (typeof value !== "string") continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

async function activateSubscription(
  event: PaypalEvent
): Promise<string | null> {
  const r = event.resource as {
    id?: string;
    plan_id?: string;
    custom_id?: string;
  };
  if (!r.custom_id || !r.plan_id || !r.id) return null;
  const plan = mapPlanIdToTier(r.plan_id);
  if (!plan) return null;
  // Activation proves the subscription and flips the plan. Credits are granted
  // only by a completed sale event, so activation plus the first-cycle sale
  // cannot double-credit the workspace.
  const intent = await prisma.billingIntent.findFirst({
    where: { id: r.custom_id, kind: "SUBSCRIPTION" },
    select: { id: true, plan: true },
  });
  if (!intent) throw retryableBillingDependency("subscription_intent_not_found");
  if (intent.plan !== plan) return null;
  await bindSubscriptionIdentity({
    intentId: intent.id,
    paypalSubscriptionId: r.id,
  });
  return applySubscriptionStatus({
    paypalSubscriptionId: r.id,
    status: "ACTIVE",
    occurredAt: paypalEventOccurredAt(event),
  });
}

/** Grant a subscription cycle's credit allowance. Idempotent via the unique
 *  paypalEventId — a re-delivered webhook grants nothing twice. */
async function grantRecurring(event: PaypalEvent): Promise<string | null> {
  const r = event.resource as {
    id?: string;
    billing_agreement_id?: string;
    amount?: {
      value?: string;
      currency_code?: string;
      total?: string;
      currency?: string;
    };
  };
  const subId = r.billing_agreement_id;
  if (!subId || !r.id) return null;
  const paid = paypalMoneyToCents(r.amount);
  if (!paid) return null;
  const result = await applySubscriptionSale({
    paypalSubscriptionId: subId,
    saleId: r.id,
    paypalEventId: event.id,
    amountCents: paid.amountCents,
    currency: paid.currency,
    occurredAt: paypalEventOccurredAt(event),
  });
  return result?.workspaceId ?? null;
}

async function downgradeSubscription(
  event: PaypalEvent
): Promise<string | null> {
  const r = event.resource as { id?: string; custom_id?: string };
  const subscriptionId = r.id;
  if (!subscriptionId) return null;
  if (r.custom_id) {
    await bindSubscriptionIdentity({
      intentId: r.custom_id,
      paypalSubscriptionId: subscriptionId,
    });
  }
  const status =
    event.event_type === "BILLING.SUBSCRIPTION.SUSPENDED"
      ? "SUSPENDED"
      : event.event_type === "BILLING.SUBSCRIPTION.EXPIRED"
        ? "EXPIRED"
        : "CANCELED";
  return applySubscriptionStatus({
    paypalSubscriptionId: subscriptionId,
    status,
    occurredAt: paypalEventOccurredAt(event),
  });
}

function providerId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,255}$/.test(value)
    ? value
    : null;
}

function paymentIdFromLinks(
  resource: Record<string, unknown>,
  kind: "capture" | "sale"
): string | null {
  if (!Array.isArray(resource.links)) return null;
  const segment = kind === "capture" ? "captures?" : "sale";
  const pattern = new RegExp(`/v[12]/payments/${segment}/([^/?#]+)`);
  for (const candidate of resource.links) {
    if (!candidate || typeof candidate !== "object") continue;
    const href = (candidate as { href?: unknown }).href;
    if (typeof href !== "string") continue;
    try {
      const match = pattern.exec(new URL(href).pathname);
      const id = match?.[1] ? providerId(decodeURIComponent(match[1])) : null;
      if (id) return id;
    } catch {
      continue;
    }
  }
  return null;
}

function relatedPaymentId(
  event: PaypalEvent,
  kind: "capture" | "sale"
): string | null {
  const resource = event.resource as {
    id?: unknown;
    capture_id?: unknown;
    sale_id?: unknown;
    supplementary_data?: { related_ids?: { capture_id?: unknown } };
  };
  const direct =
    kind === "capture"
      ? providerId(resource.capture_id) ??
        providerId(resource.supplementary_data?.related_ids?.capture_id)
      : providerId(resource.sale_id);
  if (direct) return direct;
  const linked = paymentIdFromLinks(event.resource, kind);
  if (linked) return linked;
  if (
    event.resource_type === kind ||
    event.event_type.endsWith(".REVERSED")
  ) {
    return providerId(resource.id);
  }
  return null;
}

async function refundPayment(event: PaypalEvent): Promise<string | null> {
  const kind = event.event_type.includes(".CAPTURE.") ? "capture" : "sale";
  const paypalTransactionId = relatedPaymentId(event, kind);
  if (!paypalTransactionId) return null;
  const resource = event.resource as {
    id?: unknown;
    amount?: Parameters<typeof paypalMoneyToCents>[0];
    total_refunded_amount?: Parameters<typeof paypalMoneyToCents>[0];
    seller_payable_breakdown?: {
      total_refunded_amount?: Parameters<typeof paypalMoneyToCents>[0];
    };
  };
  const refundId = providerId(resource.id);
  const aggregate = refundId === paypalTransactionId;
  const money = paypalMoneyToCents(
    aggregate
      ? resource.seller_payable_breakdown?.total_refunded_amount ??
          resource.total_refunded_amount ??
          resource.amount
      : resource.amount
  );
  const result = await applyBillingAdjustment({
    paypalTransactionId,
    paypalEventId: event.id,
    kind: "REFUND",
    sourceId:
      refundId && refundId !== paypalTransactionId
        ? `refund:${refundId}`
        : `refund-total:${paypalTransactionId}`,
    sourceStatus: event.event_type,
    amountCents: money?.amountCents,
    currency: money?.currency,
    fullRevoke: !money,
    occurredAt: paypalEventOccurredAt(event),
  });
  return result?.workspaceId ?? null;
}

async function reversePayment(event: PaypalEvent): Promise<string | null> {
  const kind = event.event_type.includes(".CAPTURE.") ? "capture" : "sale";
  const paypalTransactionId = relatedPaymentId(event, kind);
  if (!paypalTransactionId) return null;
  const resourceId = providerId(event.resource.id) ?? paypalTransactionId;
  const result = await applyBillingAdjustment({
    paypalTransactionId,
    paypalEventId: event.id,
    kind: "REVERSAL",
    sourceId: `reversal:${resourceId}`,
    sourceStatus: event.event_type,
    fullRevoke: true,
    occurredAt: paypalEventOccurredAt(event),
  });
  return result?.workspaceId ?? null;
}

const DISPUTE_RELEASE_OUTCOMES = new Set([
  "RESOLVED_SELLER_FAVOUR",
  "RESOLVED_SELLER_FAVOR",
  "RESOLVED_WITH_PAYOUT",
  "CANCELED_BY_BUYER",
  "DENIED",
]);

async function updateDispute(event: PaypalEvent): Promise<string | null> {
  const resource = event.resource as {
    id?: unknown;
    dispute_id?: unknown;
    dispute_amount?: Parameters<typeof paypalMoneyToCents>[0];
    dispute_outcome?: { outcome_code?: unknown };
    disputed_transactions?: Array<{
      seller_transaction_id?: unknown;
      dispute_amount?: Parameters<typeof paypalMoneyToCents>[0];
      transaction_info?: {
        seller_transaction_id?: unknown;
        dispute_amount?: Parameters<typeof paypalMoneyToCents>[0];
      };
    }>;
  };
  const disputeId = providerId(resource.dispute_id) ?? providerId(resource.id);
  if (!disputeId || !Array.isArray(resource.disputed_transactions)) return null;
  const outcome =
    typeof resource.dispute_outcome?.outcome_code === "string"
      ? resource.dispute_outcome.outcome_code
      : "OPEN";
  const release = DISPUTE_RELEASE_OUTCOMES.has(outcome);
  let workspaceId: string | null = null;
  for (const transaction of resource.disputed_transactions) {
    const paypalTransactionId =
      providerId(transaction.seller_transaction_id) ??
      providerId(transaction.transaction_info?.seller_transaction_id);
    if (!paypalTransactionId) continue;
    const money = paypalMoneyToCents(
      transaction.dispute_amount ??
        transaction.transaction_info?.dispute_amount ??
        resource.dispute_amount
    );
    const result = await applyBillingAdjustment({
      paypalTransactionId,
      paypalEventId: event.id,
      kind: "DISPUTE",
      sourceId: `dispute:${disputeId}`,
      sourceStatus: `${event.event_type}:${outcome}`,
      amountCents: money?.amountCents,
      currency: money?.currency,
      fullRevoke: !money,
      release,
      occurredAt: paypalEventOccurredAt(event),
    });
    workspaceId ??= result?.workspaceId ?? null;
  }
  return workspaceId;
}

async function creditCapture(event: PaypalEvent): Promise<string | null> {
  const r = event.resource as {
    id?: string;
    status?: string;
    custom_id?: string;
    amount?: { value: string; currency_code: string };
    supplementary_data?: { related_ids?: { order_id?: unknown } };
  };
  if (!r.id || !r.custom_id || r.status !== "COMPLETED") return null;
  const orderId = providerId(r.supplementary_data?.related_ids?.order_id);
  const intent = await resolveCreditIntent({
    intentId: r.custom_id,
    paypalOrderId: orderId ?? undefined,
    amount: r.amount,
  });
  if (!intent) {
    const dependency = await prisma.billingIntent.findFirst({
      where: { id: r.custom_id, kind: "CREDIT_PACK" },
      select: { id: true },
    });
    if (!dependency) throw retryableBillingDependency("credit_intent_dependency_missing");
    return null;
  }
  // Idempotency — keyed by capture id (r.id), not the event id, so the
  // return-URL path and the webhook path collapse to the same row.
  const result = await applyCreditCapture({
    intent,
    captureId: r.id,
    orderId: orderId ?? undefined,
    webhookEventId: event.id,
    occurredAt: paypalEventOccurredAt(event),
  });
  // Receipt email to the workspace owner (best-effort).
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId: intent.workspaceId, role: "OWNER" },
    include: { user: { select: { email: true, id: true } } },
  });
  if (owner && result.applied) {
    const usd = (n: number) => `$${(n / 10_000).toFixed(2)}`;
    const tpl = creditReceiptEmail(
      usd(intent.creditsCents!),
      usd(result.balance)
    );
    await sendEmail({ to: owner.user.email, ...tpl });
    track("credits_purchased", owner.user.id, {
      pack: intent.packKey,
      creditsCents: intent.creditsCents,
    });
  }
  return intent.workspaceId;
}

function mapPlanIdToTier(
  planId: string
): "STARTER" | "CREATOR" | "PRO" | "STUDIO" | null {
  if (planId === process.env.PAYPAL_PLAN_STARTER) return "STARTER";
  if (planId === process.env.PAYPAL_PLAN_CREATOR) return "CREATOR";
  if (planId === process.env.PAYPAL_PLAN_PRO) return "PRO";
  if (planId === process.env.PAYPAL_PLAN_STUDIO) return "STUDIO";
  return null;
}

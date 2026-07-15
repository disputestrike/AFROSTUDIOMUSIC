import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { prisma } from "@afrohit/db";
import { PLAN_CREDIT_GRANT_CENTS } from "@afrohit/shared";

type PaypalEvent = {
  id: string;
  event_type: string;
  create_time: string;
  resource_type?: string;
  resource: Record<string, unknown>;
};

async function main() {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
  const workspaceIds = {
    payments: `ws_payment_${suffix}`,
    subscription: `ws_subscription_${suffix}`,
  };
  const envKeys = [
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_WEBHOOK_ID",
    "PAYPAL_PLAN_STARTER",
    "PAYPAL_PLAN_CREATOR",
    "PAYPAL_PLAN_PRO",
    "PAYPAL_PLAN_STUDIO",
  ] as const;
  const priorEnv = Object.fromEntries(
    envKeys.map(key => [key, process.env[key]])
  ) as Record<(typeof envKeys)[number], string | undefined>;
  const originalFetch = globalThis.fetch;

  process.env.PAYPAL_CLIENT_ID = "payment-lifecycle-test-client";
  process.env.PAYPAL_CLIENT_SECRET = "payment-lifecycle-test-secret";
  process.env.PAYPAL_WEBHOOK_ID = "payment-lifecycle-test-webhook";
  process.env.PAYPAL_PLAN_STARTER = `P-STARTER-${suffix}`;
  process.env.PAYPAL_PLAN_CREATOR = `P-CREATOR-${suffix}`;
  process.env.PAYPAL_PLAN_PRO = `P-PRO-${suffix}`;
  process.env.PAYPAL_PLAN_STUDIO = `P-STUDIO-${suffix}`;
  globalThis.fetch = (async input => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(
        JSON.stringify({ access_token: "payment-test-token", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
      return new Response(JSON.stringify({ verification_status: "SUCCESS" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected PayPal test request: ${url}`);
  }) as typeof fetch;

  const [{ default: webhooks }, { bindSubscriptionIdentity }] =
    await Promise.all([
      import("../src/routes/webhooks"),
      import("../src/lib/billing-service"),
    ]);
  const app = Fastify({ logger: false });
  await app.register(webhooks, { prefix: "/webhooks" });
  await app.ready();

  const baseTime = Date.now() - 120_000;
  const at = (seconds: number) => new Date(baseTime + seconds * 1_000).toISOString();
  const send = async (event: PaypalEvent) => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      payload: JSON.stringify(event),
      headers: {
        "content-type": "application/json",
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api.paypal.com/cert.pem",
        "paypal-transmission-id": `TX-${event.id}`,
        "paypal-transmission-sig": "test-signature",
        "paypal-transmission-time": event.create_time,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as Record<string, unknown>;
  };
  const credits = async (workspaceId: string) =>
    (
      await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { creditsCents: true },
      })
    ).creditsCents;
  const createPackIntent = async (label: string) => {
    const id = `intent_${label}_${suffix}`;
    const orderId = `ORDER${label}${suffix}`;
    await prisma.billingIntent.create({
      data: {
        id,
        workspaceId: workspaceIds.payments,
        kind: "CREDIT_PACK",
        status: "PENDING_APPROVAL",
        packKey: "pack_10",
        amountUsd: 10,
        currency: "USD",
        creditsCents: 100_000,
        paypalOrderId: orderId,
        idempotencyKey: `pack-${label}-${suffix}`,
      },
    });
    return { id, orderId };
  };
  const capture = async (
    label: string,
    captureId: string,
    occurredAt: string
  ) => {
    const intent = await createPackIntent(label);
    await send({
      id: `WH-${suffix}-${label}-CAPTURE`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      create_time: occurredAt,
      resource_type: "capture",
      resource: {
        id: captureId,
        status: "COMPLETED",
        custom_id: intent.id,
        amount: { value: "10.00", currency_code: "USD" },
        supplementary_data: { related_ids: { order_id: intent.orderId } },
      },
    });
    return intent;
  };

  try {
    await prisma.workspace.createMany({
      data: [
        {
          id: workspaceIds.payments,
          name: "Payment Lifecycle Integration",
          slug: `payment-lifecycle-${suffix.toLowerCase()}`,
        },
        {
          id: workspaceIds.subscription,
          name: "Subscription Lifecycle Integration",
          slug: `subscription-lifecycle-${suffix.toLowerCase()}`,
        },
      ],
    });

    const partialCaptureId = `CAPTURE1${suffix}`;
    const partialIntent = await capture("PARTIAL", partialCaptureId, at(1));
    assert.equal(await credits(workspaceIds.payments), 100_000);

    await send({
      id: `WH-${suffix}-PARTIAL-SECOND-CAPTURE`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      create_time: at(1.5),
      resource_type: "capture",
      resource: {
        id: `CAPTURE-DUPLICATE-${suffix}`,
        status: "COMPLETED",
        custom_id: partialIntent.id,
        amount: { value: "10.00", currency_code: "USD" },
        supplementary_data: { related_ids: { order_id: partialIntent.orderId } },
      },
    });
    assert.equal(await credits(workspaceIds.payments), 100_000);
    assert.equal(
      await prisma.billingEntitlement.count({
        where: { billingIntentId: partialIntent.id, kind: "CREDIT_PACK" },
      }),
      1
    );

    const firstPartialRefund: PaypalEvent = {
      id: `WH-${suffix}-PARTIAL-REFUND-1`,
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      create_time: at(2),
      resource_type: "refund",
      resource: {
        id: `REFUND1${suffix}`,
        status: "COMPLETED",
        capture_id: partialCaptureId,
        amount: { value: "2.50", currency_code: "USD" },
      },
    };
    await send(firstPartialRefund);
    assert.equal(await credits(workspaceIds.payments), 75_000);
    const duplicateRefund = await send(firstPartialRefund);
    assert.equal(duplicateRefund.idempotent, true);
    assert.equal(await credits(workspaceIds.payments), 75_000);
    await send({
      ...firstPartialRefund,
      id: `WH-${suffix}-PARTIAL-REFUND-1-REDELIVERED`,
    });
    assert.equal(await credits(workspaceIds.payments), 75_000);

    await send({
      id: `WH-${suffix}-PARTIAL-REFUND-2`,
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      create_time: at(3),
      resource_type: "refund",
      resource: {
        id: `REFUND2${suffix}`,
        capture_id: partialCaptureId,
        amount: { value: "2.50", currency_code: "USD" },
      },
    });
    assert.equal(await credits(workspaceIds.payments), 50_000);

    await send({
      id: `WH-${suffix}-CAPTURE-REVERSED`,
      event_type: "PAYMENT.CAPTURE.REVERSED",
      create_time: at(4),
      resource_type: "capture",
      resource: { id: partialCaptureId, status: "REVERSED" },
    });
    assert.equal(await credits(workspaceIds.payments), 0);

    const fullCaptureId = `CAPTURE2${suffix}`;
    await capture("FULL", fullCaptureId, at(5));
    await send({
      id: `WH-${suffix}-FULL-REFUND`,
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      create_time: at(6),
      resource_type: "refund",
      resource: {
        id: `REFUNDFULL${suffix}`,
        amount: { value: "10.00", currency_code: "USD" },
        links: [
          {
            rel: "up",
            method: "GET",
            href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${fullCaptureId}`,
          },
        ],
      },
    });
    assert.equal(await credits(workspaceIds.payments), 0);

    const sellerWinCaptureId = `CAPTURE3${suffix}`;
    await capture("DISPUTESELLER", sellerWinCaptureId, at(10));
    const sellerDisputeId = `PP-D-${suffix}A`;
    await send({
      id: `WH-${suffix}-DISPUTE-CREATED`,
      event_type: "CUSTOMER.DISPUTE.CREATED",
      create_time: at(11),
      resource_type: "dispute",
      resource: {
        dispute_id: sellerDisputeId,
        dispute_amount: { value: "5.00", currency_code: "USD" },
        disputed_transactions: [
          { seller_transaction_id: sellerWinCaptureId },
        ],
      },
    });
    assert.equal(await credits(workspaceIds.payments), 50_000);

    await send({
      id: `WH-${suffix}-DISPUTE-SELLER-RESOLVED`,
      event_type: "CUSTOMER.DISPUTE.RESOLVED",
      create_time: at(13),
      resource_type: "dispute",
      resource: {
        dispute_id: sellerDisputeId,
        dispute_amount: { value: "5.00", currency_code: "USD" },
        dispute_outcome: { outcome_code: "RESOLVED_WITH_PAYOUT" },
        disputed_transactions: [
          { seller_transaction_id: sellerWinCaptureId },
        ],
      },
    });
    assert.equal(await credits(workspaceIds.payments), 100_000);

    await send({
      id: `WH-${suffix}-DISPUTE-SELLER-FAVOUR`,
      event_type: "CUSTOMER.DISPUTE.RESOLVED",
      create_time: at(14),
      resource_type: "dispute",
      resource: {
        dispute_id: sellerDisputeId,
        dispute_amount: { value: "5.00", currency_code: "USD" },
        dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" },
        disputed_transactions: [
          { seller_transaction_id: sellerWinCaptureId },
        ],
      },
    });
    assert.equal(await credits(workspaceIds.payments), 100_000);

    await send({
      id: `WH-${suffix}-DISPUTE-STALE-UPDATE`,
      event_type: "CUSTOMER.DISPUTE.UPDATED",
      create_time: at(12),
      resource_type: "dispute",
      resource: {
        dispute_id: sellerDisputeId,
        dispute_amount: { value: "5.00", currency_code: "USD" },
        disputed_transactions: [
          { seller_transaction_id: sellerWinCaptureId },
        ],
      },
    });
    assert.equal(await credits(workspaceIds.payments), 100_000);

    const buyerWinCaptureId = `CAPTURE4${suffix}`;
    await capture("DISPUTEBUYER", buyerWinCaptureId, at(14));
    const buyerDisputeId = `PP-D-${suffix}B`;
    await send({
      id: `WH-${suffix}-BUYER-DISPUTE-CREATED`,
      event_type: "CUSTOMER.DISPUTE.CREATED",
      create_time: at(15),
      resource_type: "dispute",
      resource: {
        dispute_id: buyerDisputeId,
        dispute_amount: { value: "10.00", currency_code: "USD" },
        disputed_transactions: [
          { seller_transaction_id: buyerWinCaptureId },
        ],
      },
    });
    assert.equal(await credits(workspaceIds.payments), 100_000);
    await send({
      id: `WH-${suffix}-BUYER-DISPUTE-RESOLVED`,
      event_type: "CUSTOMER.DISPUTE.RESOLVED",
      create_time: at(16),
      resource_type: "dispute",
      resource: {
        dispute_id: buyerDisputeId,
        dispute_amount: { value: "10.00", currency_code: "USD" },
        dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR" },
        disputed_transactions: [
          { seller_transaction_id: buyerWinCaptureId },
        ],
      },
    });
    assert.equal(await credits(workspaceIds.payments), 100_000);

    const subscriptionIntentId = `intent_subscription_${suffix}`;
    const subscriptionId = `I-${suffix}`;
    const saleId = `SALE${suffix}`;
    await prisma.billingIntent.create({
      data: {
        id: subscriptionIntentId,
        workspaceId: workspaceIds.subscription,
        kind: "SUBSCRIPTION",
        plan: "PRO",
        idempotencyKey: `subscription-${suffix}`,
      },
    });
    await bindSubscriptionIdentity({
      intentId: subscriptionIntentId,
      paypalSubscriptionId: subscriptionId,
      markPendingApproval: true,
    });

    await send({
      id: `WH-${suffix}-SUBSCRIPTION-CANCELLED`,
      event_type: "BILLING.SUBSCRIPTION.CANCELLED",
      create_time: at(30),
      resource_type: "subscription",
      resource: { id: subscriptionId, custom_id: subscriptionIntentId },
    });
    await send({
      id: `WH-${suffix}-SUBSCRIPTION-SALE`,
      event_type: "PAYMENT.SALE.COMPLETED",
      create_time: at(20),
      resource_type: "sale",
      resource: {
        id: saleId,
        billing_agreement_id: subscriptionId,
        amount: { total: "149.00", currency: "USD" },
      },
    });
    const grant = PLAN_CREDIT_GRANT_CENTS.PRO;
    assert.equal(await credits(workspaceIds.subscription), grant);

    await send({
      id: `WH-${suffix}-SUBSCRIPTION-SALE-REDELIVERED`,
      event_type: "PAYMENT.SALE.COMPLETED",
      create_time: at(21),
      resource_type: "sale",
      resource: {
        id: saleId,
        billing_agreement_id: subscriptionId,
        amount: { total: "149.00", currency: "USD" },
      },
    });
    assert.equal(await credits(workspaceIds.subscription), grant);

    await send({
      id: `WH-${suffix}-SUBSCRIPTION-STALE-ACTIVATION`,
      event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
      create_time: at(10),
      resource_type: "subscription",
      resource: {
        id: subscriptionId,
        custom_id: subscriptionIntentId,
        plan_id: process.env.PAYPAL_PLAN_PRO,
      },
    });
    let subscriptionWorkspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceIds.subscription },
      select: { plan: true, paypalSubscriptionId: true },
    });
    assert.deepEqual(subscriptionWorkspace, {
      plan: "STARTER",
      paypalSubscriptionId: null,
    });
    const canceledIdentity = await prisma.billingSubscription.findUniqueOrThrow({
      where: { paypalSubscriptionId: subscriptionId },
    });
    assert.equal(canceledIdentity.status, "CANCELED");

    const duplicateSale = await send({
      id: `WH-${suffix}-SUBSCRIPTION-SALE`,
      event_type: "PAYMENT.SALE.COMPLETED",
      create_time: at(20),
      resource_type: "sale",
      resource: {
        id: saleId,
        billing_agreement_id: subscriptionId,
        amount: { total: "149.00", currency: "USD" },
      },
    });
    assert.equal(duplicateSale.idempotent, true);
    assert.equal(await credits(workspaceIds.subscription), grant);

    await send({
      id: `WH-${suffix}-SUBSCRIPTION-REACTIVATED`,
      event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
      create_time: at(40),
      resource_type: "subscription",
      resource: {
        id: subscriptionId,
        custom_id: subscriptionIntentId,
        plan_id: process.env.PAYPAL_PLAN_PRO,
      },
    });
    subscriptionWorkspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceIds.subscription },
      select: { plan: true, paypalSubscriptionId: true },
    });
    assert.deepEqual(subscriptionWorkspace, {
      plan: "PRO",
      paypalSubscriptionId: subscriptionId,
    });

    await send({
      id: `WH-${suffix}-SALE-PARTIAL-REFUND`,
      event_type: "PAYMENT.SALE.REFUNDED",
      create_time: at(50),
      resource_type: "refund",
      resource: {
        id: `SALEREFUND${suffix}`,
        sale_id: saleId,
        amount: { total: "74.50", currency: "USD" },
      },
    });
    assert.equal(await credits(workspaceIds.subscription), grant / 2);

    await send({
      id: `WH-${suffix}-SALE-REVERSED`,
      event_type: "PAYMENT.SALE.REVERSED",
      create_time: at(60),
      resource_type: "sale",
      resource: { id: saleId, state: "reversed" },
    });
    assert.equal(await credits(workspaceIds.subscription), 0);

    const partialAdjustments = await prisma.billingAdjustment.findMany({
      where: {
        entitlement: { paypalTransactionId: partialCaptureId },
      },
      orderBy: { createdAt: "asc" },
      select: { ledgerDelta: true },
    });
    assert.deepEqual(
      partialAdjustments.map(adjustment => adjustment.ledgerDelta),
      [-25_000, 0, -25_000, -50_000]
    );
    const staleDisputeAdjustment = await prisma.billingAdjustment.findFirstOrThrow({
      where: { paypalEventId: `WH-${suffix}-DISPUTE-STALE-UPDATE` },
      select: { ledgerDelta: true },
    });
    assert.equal(staleDisputeAdjustment.ledgerDelta, 0);

    console.log(
      "Payment lifecycle integration passed: refunds, reversals, disputes, and out-of-order subscriptions."
    );
  } finally {
    await prisma.workspace
      .deleteMany({ where: { id: { in: Object.values(workspaceIds) } } })
      .catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const value = priorEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

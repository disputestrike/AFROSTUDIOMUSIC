import { Prisma, prisma } from '@afrohit/db';
import { PLAN_CREDIT_GRANT_CENTS } from '@afrohit/shared';
import { CREDIT_PACKS, type CreditPackKey } from './billing-catalog';

type BillingAdjustmentKind = 'REFUND' | 'REVERSAL' | 'DISPUTE';
type BillingSubscriptionStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'CANCELED';
type BillingPlan = 'STARTER' | 'CREATOR' | 'PRO' | 'STUDIO';

export type PaypalMoney = {
  value?: string;
  currency_code?: string;
  total?: string;
  currency?: string;
} | undefined;

export type ResolvedCreditIntent = {
  id: string;
  workspaceId: string;
  packKey: string;
  amountUsd: number;
  currency: string;
  creditsCents: number;
  paypalOrderId: string | null;
};

type SubscriptionIdentity = {
  id: string;
  workspaceId: string;
  billingIntentId: string;
  paypalSubscriptionId: string;
  plan: BillingPlan;
};

function lifecycleError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export function paypalMoneyToCents(
  money: PaypalMoney
): { amountCents: number; currency: string } | null {
  const value = money?.value ?? money?.total;
  const currency = money?.currency_code ?? money?.currency;
  if (typeof value !== 'string' || typeof currency !== 'string') return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const amountCents = whole * 100 + fraction;
  if (!Number.isSafeInteger(amountCents)) return null;
  return { amountCents, currency: currency.toUpperCase() };
}

export async function resolveCreditIntent(opts: {
  intentId: string;
  paypalOrderId?: string;
  amount: PaypalMoney;
}): Promise<ResolvedCreditIntent | null> {
  const intent = await prisma.billingIntent.findFirst({
    where: {
      id: opts.intentId,
      kind: 'CREDIT_PACK',
      ...(opts.paypalOrderId ? { paypalOrderId: opts.paypalOrderId } : {}),
    },
    select: {
      id: true,
      workspaceId: true,
      packKey: true,
      amountUsd: true,
      currency: true,
      creditsCents: true,
      paypalOrderId: true,
    },
  });
  if (!intent?.packKey || !intent.amountUsd || !intent.creditsCents) return null;
  const pack = CREDIT_PACKS[intent.packKey as CreditPackKey];
  const paid = paypalMoneyToCents(opts.amount);
  if (!pack || !paid || paid.currency !== 'USD' || intent.currency !== 'USD') return null;
  if (paid.amountCents !== pack.amountUsd * 100) return null;
  if (Number(intent.amountUsd) !== pack.amountUsd) return null;
  if (intent.creditsCents !== pack.creditsCents) return null;
  return {
    id: intent.id,
    workspaceId: intent.workspaceId,
    packKey: intent.packKey,
    amountUsd: Number(intent.amountUsd),
    currency: intent.currency,
    creditsCents: intent.creditsCents,
    paypalOrderId: intent.paypalOrderId,
  };
}

export async function applyCreditCapture(opts: {
  intent: ResolvedCreditIntent;
  captureId: string;
  orderId?: string;
  webhookEventId?: string;
  occurredAt?: Date;
}): Promise<{ applied: boolean; balance: number }> {
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe(
        'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
        `billing-intent:${opts.intent.id}`
      );
      const existing = await tx.billingEntitlement.findFirst({
        where: {
          OR: [
            { paypalTransactionId: opts.captureId },
            { billingIntentId: opts.intent.id, kind: 'CREDIT_PACK' },
          ],
        },
        select: {
          workspaceId: true,
          workspace: { select: { creditsCents: true } },
        },
      });
      if (existing) {
        if (existing.workspaceId !== opts.intent.workspaceId) {
          throw lifecycleError('payment_identity_conflict');
        }
        return { applied: false, balance: existing.workspace.creditsCents };
      }

      const workspace = await tx.workspace.update({
        where: { id: opts.intent.workspaceId },
        data: { creditsCents: { increment: opts.intent.creditsCents } },
        select: { creditsCents: true },
      });
      const ledger = await tx.creditLedger.create({
        data: {
          workspaceId: opts.intent.workspaceId,
          delta: opts.intent.creditsCents,
          reason: 'topup_paypal',
          paypalEventId: opts.captureId,
          idempotencyKey: `paypal-capture:${opts.captureId}`,
          meta: {
            billingIntentId: opts.intent.id,
            orderId: opts.orderId ?? opts.intent.paypalOrderId,
            pack: opts.intent.packKey,
            webhookEventId: opts.webhookEventId,
          } as never,
        },
      });
      await tx.billingEntitlement.create({
        data: {
          workspaceId: opts.intent.workspaceId,
          billingIntentId: opts.intent.id,
          kind: 'CREDIT_PACK',
          paypalTransactionId: opts.captureId,
          grossAmountCents: opts.intent.amountUsd * 100,
          currency: opts.intent.currency,
          creditsGranted: opts.intent.creditsCents,
          grantLedgerId: ledger.id,
          occurredAt: opts.occurredAt ?? new Date(),
        },
      });
      await tx.billingIntent.update({
        where: { id: opts.intent.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return { applied: true, balance: workspace.creditsCents };
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const existing = await prisma.billingEntitlement.findFirst({
      where: {
        OR: [
          { paypalTransactionId: opts.captureId },
          { billingIntentId: opts.intent.id, kind: 'CREDIT_PACK' },
        ],
      },
      select: {
        workspaceId: true,
        workspace: { select: { creditsCents: true } },
      },
    });
    if (!existing) throw error;
    if (existing.workspaceId !== opts.intent.workspaceId) {
      throw lifecycleError('payment_identity_conflict');
    }
    return { applied: false, balance: existing.workspace.creditsCents };
  }
}

export async function bindSubscriptionIdentity(opts: {
  intentId: string;
  paypalSubscriptionId: string;
  approvalUrl?: string;
  markPendingApproval?: boolean;
}): Promise<SubscriptionIdentity> {
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe(
      'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
      `billing-intent:${opts.intentId}`
    );
    const intent = await tx.billingIntent.findUnique({
      where: { id: opts.intentId },
      select: {
        id: true,
        workspaceId: true,
        kind: true,
        plan: true,
        paypalSubscriptionId: true,
      },
    });
    if (!intent || intent.kind !== 'SUBSCRIPTION' || !intent.plan) {
      throw lifecycleError('subscription_intent_not_found');
    }
    if (
      intent.paypalSubscriptionId &&
      intent.paypalSubscriptionId !== opts.paypalSubscriptionId
    ) {
      throw lifecycleError('subscription_intent_provider_mismatch');
    }

    const existing = await tx.billingSubscription.findFirst({
      where: {
        OR: [
          { billingIntentId: intent.id },
          { paypalSubscriptionId: opts.paypalSubscriptionId },
        ],
      },
    });
    if (
      existing &&
      (existing.billingIntentId !== intent.id ||
        existing.paypalSubscriptionId !== opts.paypalSubscriptionId ||
        existing.workspaceId !== intent.workspaceId ||
        existing.plan !== intent.plan)
    ) {
      throw lifecycleError('subscription_identity_conflict');
    }

    const identity =
      existing ??
      (await tx.billingSubscription.create({
        data: {
          workspaceId: intent.workspaceId,
          billingIntentId: intent.id,
          paypalSubscriptionId: opts.paypalSubscriptionId,
          plan: intent.plan,
        },
      }));
    await tx.billingIntent.update({
      where: { id: intent.id },
      data: {
        paypalSubscriptionId: opts.paypalSubscriptionId,
        ...(opts.approvalUrl ? { approvalUrl: opts.approvalUrl } : {}),
      },
    });
    if (opts.markPendingApproval) {
      await tx.billingIntent.updateMany({
        where: { id: intent.id, status: 'CREATED' },
        data: { status: 'PENDING_APPROVAL' },
      });
    }
    return identity;
  });
}

async function resolveSubscriptionIdentity(
  paypalSubscriptionId: string
): Promise<SubscriptionIdentity | null> {
  const existing = await prisma.billingSubscription.findUnique({
    where: { paypalSubscriptionId },
  });
  if (existing) return existing;
  const intent = await prisma.billingIntent.findUnique({
    where: { paypalSubscriptionId },
    select: { id: true, kind: true, plan: true },
  });
  if (!intent || intent.kind !== 'SUBSCRIPTION' || !intent.plan) return null;
  return bindSubscriptionIdentity({
    intentId: intent.id,
    paypalSubscriptionId,
  });
}

const SUBSCRIPTION_STATUS_PRECEDENCE: Record<BillingSubscriptionStatus, number> = {
  PENDING: 0,
  ACTIVE: 1,
  SUSPENDED: 2,
  EXPIRED: 3,
  CANCELED: 4,
};

function shouldApplySubscriptionStatus(
  current: { status: BillingSubscriptionStatus; statusEventAt: Date | null },
  incomingStatus: BillingSubscriptionStatus,
  incomingAt: Date
): boolean {
  if (!current.statusEventAt) return true;
  const timeDelta = incomingAt.getTime() - current.statusEventAt.getTime();
  if (timeDelta !== 0) return timeDelta > 0;
  return (
    (SUBSCRIPTION_STATUS_PRECEDENCE[incomingStatus] ?? -1) >
    (SUBSCRIPTION_STATUS_PRECEDENCE[current.status] ?? -1)
  );
}

async function reconcileWorkspaceSubscription(
  tx: Prisma.TransactionClient,
  workspaceId: string
): Promise<void> {
  const active = await tx.billingSubscription.findFirst({
    where: { workspaceId, status: 'ACTIVE' },
    orderBy: [{ statusEventAt: 'desc' }, { createdAt: 'desc' }],
    select: { paypalSubscriptionId: true, plan: true },
  });
  await tx.workspace.update({
    where: { id: workspaceId },
    data: active
      ? { paypalSubscriptionId: active.paypalSubscriptionId, plan: active.plan }
      : { paypalSubscriptionId: null, plan: 'STARTER' },
  });
}

export async function applySubscriptionStatus(opts: {
  paypalSubscriptionId: string;
  status: BillingSubscriptionStatus;
  occurredAt: Date;
}): Promise<string | null> {
  const identity = await resolveSubscriptionIdentity(opts.paypalSubscriptionId);
  if (!identity) return null;
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe(
      'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
      `billing-workspace:${identity.workspaceId}`
    );
    const current = await tx.billingSubscription.findUniqueOrThrow({
      where: { id: identity.id },
      select: { status: true, statusEventAt: true },
    });
    if (shouldApplySubscriptionStatus(current, opts.status, opts.occurredAt)) {
      await tx.billingSubscription.update({
        where: { id: identity.id },
        data: {
          status: opts.status,
          statusEventAt: opts.occurredAt,
          ...(opts.status === 'ACTIVE'
            ? { activatedAt: opts.occurredAt, endedAt: null }
            : { endedAt: opts.occurredAt }),
        },
      });
      if (opts.status === 'ACTIVE') {
        await tx.billingIntent.updateMany({
          where: { id: identity.billingIntentId, status: { not: 'COMPLETED' } },
          data: { status: 'APPROVED' },
        });
      } else {
        await tx.billingIntent.update({
          where: { id: identity.billingIntentId },
          data: { status: 'CANCELED' },
        });
      }
    }
    await reconcileWorkspaceSubscription(tx, identity.workspaceId);
  });
  return identity.workspaceId;
}

export async function applySubscriptionSale(opts: {
  paypalSubscriptionId: string;
  saleId: string;
  paypalEventId: string;
  amountCents: number;
  currency: string;
  occurredAt: Date;
}): Promise<{ workspaceId: string; applied: boolean } | null> {
  const identity = await resolveSubscriptionIdentity(opts.paypalSubscriptionId);
  if (!identity || opts.amountCents <= 0 || opts.currency !== 'USD') return null;
  const grant =
    PLAN_CREDIT_GRANT_CENTS[
      identity.plan as keyof typeof PLAN_CREDIT_GRANT_CENTS
    ] ?? 0;
  if (!grant) return { workspaceId: identity.workspaceId, applied: false };

  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe(
        'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
        `paypal-payment:${opts.saleId}`
      );
      const existing = await tx.billingEntitlement.findUnique({
        where: { paypalTransactionId: opts.saleId },
        select: { workspaceId: true },
      });
      if (existing) return { workspaceId: existing.workspaceId, applied: false };

      await tx.workspace.update({
        where: { id: identity.workspaceId },
        data: { creditsCents: { increment: grant } },
      });
      const ledger = await tx.creditLedger.create({
        data: {
          workspaceId: identity.workspaceId,
          delta: grant,
          reason: 'paypal_subscription_cycle',
          paypalEventId: opts.paypalEventId,
          idempotencyKey: `paypal-sale:${opts.paypalSubscriptionId}:${opts.saleId}`,
          meta: {
            grant,
            subscriptionId: opts.paypalSubscriptionId,
            saleId: opts.saleId,
            amountCents: opts.amountCents,
            currency: opts.currency,
          } as never,
        },
      });
      await tx.billingEntitlement.create({
        data: {
          workspaceId: identity.workspaceId,
          billingIntentId: identity.billingIntentId,
          subscriptionId: identity.id,
          kind: 'SUBSCRIPTION_CYCLE',
          paypalTransactionId: opts.saleId,
          grossAmountCents: opts.amountCents,
          currency: opts.currency,
          creditsGranted: grant,
          grantLedgerId: ledger.id,
          occurredAt: opts.occurredAt,
        },
      });
      await tx.billingIntent.updateMany({
        where: { id: identity.billingIntentId, status: { not: 'CANCELED' } },
        data: { status: 'COMPLETED', completedAt: opts.occurredAt },
      });
      return { workspaceId: identity.workspaceId, applied: true };
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    return { workspaceId: identity.workspaceId, applied: false };
  }
}

type AdjustmentSnapshot = {
  kind: BillingAdjustmentKind;
  sourceId: string;
  sourceStatus: string;
  creditsAtRisk: number;
  occurredAt: Date;
  createdAt: Date;
};

function adjustmentPrecedence(snapshot: AdjustmentSnapshot): number {
  if (snapshot.kind !== 'DISPUTE') return 1;
  if (snapshot.sourceStatus.includes('RESOLVED')) return 3;
  if (snapshot.sourceStatus.includes('UPDATED')) return 2;
  return 1;
}

function isLaterAdjustment(
  candidate: AdjustmentSnapshot,
  current: AdjustmentSnapshot
): boolean {
  const occurredDelta = candidate.occurredAt.getTime() - current.occurredAt.getTime();
  if (occurredDelta !== 0) return occurredDelta > 0;
  const precedenceDelta = adjustmentPrecedence(candidate) - adjustmentPrecedence(current);
  if (precedenceDelta !== 0) return precedenceDelta > 0;
  return candidate.createdAt.getTime() > current.createdAt.getTime();
}

export async function applyBillingAdjustment(opts: {
  paypalTransactionId: string;
  paypalEventId: string;
  kind: BillingAdjustmentKind;
  sourceId: string;
  sourceStatus: string;
  amountCents?: number | null;
  currency?: string | null;
  fullRevoke?: boolean;
  release?: boolean;
  occurredAt: Date;
}): Promise<{ workspaceId: string; applied: boolean; ledgerDelta: number } | null> {
  const entitlement = await prisma.billingEntitlement.findUnique({
    where: { paypalTransactionId: opts.paypalTransactionId },
  });
  if (!entitlement) return null;
  if (
    opts.amountCents != null &&
    (!opts.currency || opts.currency !== entitlement.currency)
  ) {
    return null;
  }
  const creditsAtRisk = opts.release
    ? 0
    : opts.fullRevoke ||
        opts.amountCents == null ||
        entitlement.grossAmountCents == null
      ? entitlement.creditsGranted
      : Math.min(
          entitlement.creditsGranted,
          Math.ceil(
            (entitlement.creditsGranted * opts.amountCents) /
              entitlement.grossAmountCents
          )
        );

  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe(
      'SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))',
      `billing-entitlement:${entitlement.id}`
    );
    const duplicate = await tx.billingAdjustment.findUnique({
      where: {
        paypalEventId_entitlementId: {
          paypalEventId: opts.paypalEventId,
          entitlementId: entitlement.id,
        },
      },
    });
    if (duplicate) {
      return {
        workspaceId: entitlement.workspaceId,
        applied: false,
        ledgerDelta: 0,
      };
    }

    const prior = await tx.billingAdjustment.findMany({
      where: { entitlementId: entitlement.id },
      select: {
        kind: true,
        sourceId: true,
        sourceStatus: true,
        creditsAtRisk: true,
        ledgerDelta: true,
        occurredAt: true,
        createdAt: true,
      },
    });
    const now = new Date();
    const candidate: AdjustmentSnapshot = {
      kind: opts.kind,
      sourceId: opts.sourceId,
      sourceStatus: opts.sourceStatus,
      creditsAtRisk,
      occurredAt: opts.occurredAt,
      createdAt: now,
    };
    const latestBySource = new Map<string, AdjustmentSnapshot>();
    for (const adjustment of [...prior, candidate]) {
      const key = `${adjustment.kind}:${adjustment.sourceId}`;
      const current = latestBySource.get(key);
      if (!current || isLaterAdjustment(adjustment, current)) {
        latestBySource.set(key, adjustment);
      }
    }
    const targetRevoked = Math.min(
      entitlement.creditsGranted,
      [...latestBySource.values()].reduce(
        (total, adjustment) => total + adjustment.creditsAtRisk,
        0
      )
    );
    const currentRevoked = Math.min(
      entitlement.creditsGranted,
      Math.max(
        0,
        -prior.reduce(
          (total: number, adjustment: { ledgerDelta: number }) =>
            total + adjustment.ledgerDelta,
          0
        )
      )
    );
    const ledgerDelta = currentRevoked - targetRevoked;
    let ledgerId: string | undefined;
    if (ledgerDelta !== 0) {
      await tx.workspace.update({
        where: { id: entitlement.workspaceId },
        data: { creditsCents: { increment: ledgerDelta } },
      });
      const ledger = await tx.creditLedger.create({
        data: {
          workspaceId: entitlement.workspaceId,
          delta: ledgerDelta,
          reason:
            ledgerDelta > 0
              ? 'paypal_entitlement_restore'
              : opts.kind === 'REFUND'
                ? 'paypal_refund'
                : opts.kind === 'REVERSAL'
                  ? 'paypal_reversal'
                  : 'paypal_dispute_hold',
          idempotencyKey: `paypal-adjustment:${opts.paypalEventId}:${opts.paypalTransactionId}`,
          meta: {
            billingEntitlementId: entitlement.id,
            paypalTransactionId: opts.paypalTransactionId,
            paypalEventId: opts.paypalEventId,
            kind: opts.kind,
            sourceId: opts.sourceId,
            sourceStatus: opts.sourceStatus,
            amountCents: opts.amountCents,
            creditsAtRisk,
            targetRevoked,
          } as never,
        },
      });
      ledgerId = ledger.id;
    }
    await tx.billingAdjustment.create({
      data: {
        entitlementId: entitlement.id,
        paypalEventId: opts.paypalEventId,
        kind: opts.kind,
        sourceId: opts.sourceId,
        sourceStatus: opts.sourceStatus,
        amountCents: opts.amountCents,
        creditsAtRisk,
        ledgerDelta,
        ledgerId,
        occurredAt: opts.occurredAt,
      },
    });
    return {
      workspaceId: entitlement.workspaceId,
      applied: ledgerDelta !== 0,
      ledgerDelta,
    };
  });
}

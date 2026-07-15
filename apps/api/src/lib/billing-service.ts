import { prisma } from '@afrohit/db';
import { CREDIT_PACKS, type CreditPackKey } from './billing-catalog';

type CaptureAmount = { value?: string; currency_code?: string } | undefined;

export type ResolvedCreditIntent = {
  id: string;
  workspaceId: string;
  packKey: string;
  amountUsd: number;
  currency: string;
  creditsCents: number;
  paypalOrderId: string | null;
};

export async function resolveCreditIntent(opts: {
  intentId: string;
  paypalOrderId?: string;
  amount: CaptureAmount;
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
  if (!pack) return null;
  if (intent.currency !== 'USD' || opts.amount?.currency_code !== 'USD') return null;
  if (Number(opts.amount.value) !== pack.amountUsd || Number(intent.amountUsd) !== pack.amountUsd) return null;
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
}): Promise<{ applied: boolean; balance: number }> {
  const existing = await prisma.creditLedger.findUnique({
    where: { paypalEventId: opts.captureId },
    select: { workspace: { select: { creditsCents: true } } },
  });
  if (existing) return { applied: false, balance: existing.workspace.creditsCents };

  try {
    const [workspace] = await prisma.$transaction([
      prisma.workspace.update({
        where: { id: opts.intent.workspaceId },
        data: { creditsCents: { increment: opts.intent.creditsCents } },
      }),
      prisma.creditLedger.create({
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
      }),
      prisma.billingIntent.update({
        where: { id: opts.intent.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
    ]);
    return { applied: true, balance: workspace.creditsCents };
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: opts.intent.workspaceId },
      select: { creditsCents: true },
    });
    return { applied: false, balance: workspace.creditsCents };
  }
}

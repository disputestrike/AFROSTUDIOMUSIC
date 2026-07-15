export const CREDIT_PACKS = {
  pack_10: { amountUsd: 10, creditsCents: 10 * 10_000 },
  pack_25: { amountUsd: 25, creditsCents: 25 * 10_000 },
  pack_50: { amountUsd: 50, creditsCents: 50 * 10_000 },
  pack_100: { amountUsd: 100, creditsCents: 100 * 10_000 },
} as const;

export const CREDIT_PACK_KEYS = Object.keys(CREDIT_PACKS) as [keyof typeof CREDIT_PACKS, ...(keyof typeof CREDIT_PACKS)[]];
export type CreditPackKey = keyof typeof CREDIT_PACKS;

export function validateCreditPackCapture(
  customId: string,
  amount: { value?: string; currency_code?: string } | undefined,
): { workspaceId: string; pack: CreditPackKey; creditsCents: number } | null {
  let metadata: { workspaceId?: unknown; pack?: unknown; creditsCents?: unknown };
  try {
    metadata = JSON.parse(customId) as typeof metadata;
  } catch {
    return null;
  }
  if (typeof metadata.workspaceId !== 'string' || metadata.workspaceId.length < 10 || metadata.workspaceId.length > 80) return null;
  if (typeof metadata.pack !== 'string' || !(metadata.pack in CREDIT_PACKS)) return null;
  const pack = metadata.pack as CreditPackKey;
  const expected = CREDIT_PACKS[pack];
  if (amount?.currency_code !== 'USD' || amount.value !== expected.amountUsd.toFixed(2)) return null;
  if (metadata.creditsCents !== undefined && metadata.creditsCents !== expected.creditsCents) return null;
  return { workspaceId: metadata.workspaceId, pack, creditsCents: expected.creditsCents };
}

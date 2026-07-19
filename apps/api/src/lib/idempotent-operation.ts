import { createHash } from 'node:crypto';
import { Prisma, prisma } from '@afrohit/db';
import { redactSensitiveText } from '@afrohit/shared';

export type CompletedOperation<T> = {
  state: 'completed';
  receiptId: string;
  replayed: boolean;
  value: T;
};

export type PendingOperation = {
  state: 'in_progress' | 'failed' | 'canceled' | 'conflict';
  receiptId: string;
  replayed: true;
};

export type IdempotentOperationResult<T> = CompletedOperation<T> | PendingOperation;

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function existingResult<T>(receipt: {
  id: string;
  status: string;
  outputJson: unknown;
  inputJson: unknown;
  startedAt: Date | null;
}, staleBefore: Date, fingerprint: string): Promise<IdempotentOperationResult<T> | null> {
  const storedFingerprint = (receipt.inputJson as { operationFingerprint?: string } | null)?.operationFingerprint;
  if (storedFingerprint && storedFingerprint !== fingerprint) {
    return { state: 'conflict', receiptId: receipt.id, replayed: true };
  }
  if (receipt.status === 'SUCCEEDED') {
    const stored = receipt.outputJson as { value?: T } | null;
    if (stored && Object.prototype.hasOwnProperty.call(stored, 'value')) {
      return { state: 'completed', receiptId: receipt.id, replayed: true, value: stored.value as T };
    }
    return { state: 'failed', receiptId: receipt.id, replayed: true };
  }
  if (receipt.status === 'FAILED') return { state: 'failed', receiptId: receipt.id, replayed: true };
  if (receipt.status === 'CANCELED') return { state: 'canceled', receiptId: receipt.id, replayed: true };
  if (!receipt.startedAt || receipt.startedAt > staleBefore) {
    return { state: 'in_progress', receiptId: receipt.id, replayed: true };
  }
  const reclaimed = await prisma.providerJob.updateMany({
    where: { id: receipt.id, status: { in: ['QUEUED', 'RUNNING'] }, startedAt: { lte: staleBefore } },
    data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, errorJson: Prisma.DbNull },
  });
  return reclaimed.count ? null : { state: 'in_progress', receiptId: receipt.id, replayed: true };
}

export async function runIdempotentOperation<T>(opts: {
  workspaceId: string;
  projectId?: string | null;
  kind: string;
  provider?: string;
  idempotencyKey?: string;
  chargeLedgerId?: string;
  inputJson?: unknown;
  staleAfterMs?: number;
  execute: () => Promise<T>;
}): Promise<IdempotentOperationResult<T>> {
  const staleBefore = new Date(Date.now() - Math.max(60_000, opts.staleAfterMs ?? 30 * 60_000));
  const safeInput = jsonSafe(opts.inputJson);
  const fingerprint = createHash('sha256').update(JSON.stringify(safeInput)).digest('hex');
  const lookup = opts.chargeLedgerId
    ? { chargeLedgerId: opts.chargeLedgerId }
    : opts.idempotencyKey
      ? { workspaceId_kind_idempotencyKey: { workspaceId: opts.workspaceId, kind: opts.kind, idempotencyKey: opts.idempotencyKey } }
      : null;

  if (lookup) {
    const prior = await prisma.providerJob.findUnique({
      where: lookup as never,
      select: { id: true, status: true, outputJson: true, inputJson: true, startedAt: true },
    });
    if (prior) {
      const replay = await existingResult<T>(prior, staleBefore, fingerprint);
      if (replay) return replay;
    }
  }

  if (opts.chargeLedgerId) {
    // delta <= 0: $0 FREE receipts (own-engine, owner order 2026-07-19) bind
    // operations exactly like debits do — exists, in-workspace, not reversed.
    const activeCharge = await prisma.creditLedger.findFirst({
      where: {
        id: opts.chargeLedgerId,
        workspaceId: opts.workspaceId,
        delta: { lte: 0 },
        reversal: null,
      },
      select: { id: true },
    });
    if (!activeCharge) return { state: 'failed', receiptId: opts.chargeLedgerId, replayed: true };
  }

  let receipt: { id: string };
  try {
    receipt = await prisma.providerJob.create({
      data: {
        workspaceId: opts.workspaceId,
        projectId: opts.projectId ?? null,
        kind: opts.kind,
        provider: opts.provider ?? 'internal',
        status: 'RUNNING',
        inputJson: { operationFingerprint: fingerprint, input: safeInput } as never,
        idempotencyKey: opts.idempotencyKey,
        chargeLedgerId: opts.chargeLedgerId,
        startedAt: new Date(),
      },
      select: { id: true },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002' || !lookup) throw error;
    const prior = await prisma.providerJob.findUnique({
      where: lookup as never,
      select: { id: true, status: true, outputJson: true, inputJson: true, startedAt: true },
    });
    if (!prior) throw error;
    const replay = await existingResult<T>(prior, staleBefore, fingerprint);
    if (replay) return replay;
    receipt = { id: prior.id };
  }

  try {
    const value = await opts.execute();
    await prisma.providerJob.update({
      where: { id: receipt.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        outputJson: { value: jsonSafe(value) } as never,
        errorJson: Prisma.DbNull,
      },
    });
    return { state: 'completed', receiptId: receipt.id, replayed: false, value };
  } catch (error) {
    await prisma.providerJob.update({
      where: { id: receipt.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorJson: { message: redactSensitiveText((error as Error)?.message ?? error, 500) } as never,
      },
    }).catch(() => undefined);
    throw error;
  }
}

export function operationErrorBody(result: PendingOperation): { statusCode: 409 | 503; body: Record<string, unknown> } {
  if (result.state === 'in_progress' || result.state === 'conflict') {
    return {
      statusCode: 409,
      body: {
        error: result.state === 'conflict' ? 'idempotency_key_conflict' : 'operation_in_progress',
        receiptId: result.receiptId,
      },
    };
  }
  return {
    statusCode: 503,
    body: {
      error: result.state === 'canceled' ? 'operation_canceled' : 'operation_failed',
      receiptId: result.receiptId,
      message: 'Start a new request to retry this operation.',
    },
  };
}

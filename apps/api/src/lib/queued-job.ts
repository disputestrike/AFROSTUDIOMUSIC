import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { prisma } from '@afrohit/db';
import type { CreditKey } from '@afrohit/shared';
import { enqueue } from './queue';

type Tx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type SuccessfulCharge = {
  ok: true;
  chargeId: string;
  key: CreditKey;
  replayed?: boolean;
};

export async function createQueuedProviderJob<T>(opts: {
  app: FastifyInstance;
  queue: Queue;
  jobName: string;
  workspaceId: string;
  projectId?: string | null;
  kind: string;
  provider: string;
  inputJson: unknown;
  payload: (jobId: string) => T;
  charge?: SuccessfulCharge;
  idempotencyKey?: string;
  delayMs?: number;
}): Promise<{ jobId: string; replayed: boolean }> {
  if (opts.charge?.replayed) {
    const existing = await prisma.providerJob.findUnique({
      where: { chargeLedgerId: opts.charge.chargeId },
      select: { id: true },
    });
    if (existing) return { jobId: existing.id, replayed: true };
  }

  let created: { jobId: string; payload: T };
  try {
    created = await prisma.$transaction(async (tx: Tx) => {
      if (opts.charge) {
        // delta <= 0: a $0 FREE receipt (own-engine renders, owner order
        // 2026-07-19) is a legitimate charge binding — the guard's job is
        // "row exists, in-workspace, not reversed", not "money moved".
        const charge = await tx.creditLedger.findFirst({
          where: { id: opts.charge.chargeId, workspaceId: opts.workspaceId, delta: { lte: 0 }, reversal: null },
          select: { id: true },
        });
        if (!charge) throw new Error('job charge is missing or outside workspace');
      }
      const job = await tx.providerJob.create({
        data: {
          workspaceId: opts.workspaceId,
          projectId: opts.projectId ?? null,
          kind: opts.kind,
          provider: opts.provider,
          status: 'QUEUED',
          inputJson: opts.inputJson as never,
          chargeLedgerId: opts.charge?.chargeId,
          idempotencyKey: opts.idempotencyKey,
        },
        select: { id: true },
      });
      const payload = opts.payload(job.id);
      await tx.jobOutbox.create({
        data: {
          workspaceId: opts.workspaceId,
          providerJobId: job.id,
          queueName: opts.queue.name,
          jobName: opts.jobName,
          payload: payload as never,
          ...(opts.delayMs ? { nextAttemptAt: new Date(Date.now() + opts.delayMs) } : {}),
        },
      });
      return { jobId: job.id, payload };
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      const existing = opts.charge
        ? await prisma.providerJob.findUnique({ where: { chargeLedgerId: opts.charge.chargeId }, select: { id: true } })
        : opts.idempotencyKey
          ? await prisma.providerJob.findFirst({
              where: { workspaceId: opts.workspaceId, kind: opts.kind, idempotencyKey: opts.idempotencyKey },
              select: { id: true },
            })
          : null;
      if (existing) return { jobId: existing.id, replayed: true };
    }
    if (opts.charge) {
      await opts.app.refundCredits({
        workspaceId: opts.workspaceId,
        key: opts.charge.key,
        refTable: 'ProviderJob',
        chargeId: opts.charge.chargeId,
      });
    }
    throw error;
  }

  await enqueue({
    queue: opts.queue,
    name: opts.jobName,
    payload: created.payload,
    delayMs: opts.delayMs,
  });
  return { jobId: created.jobId, replayed: false };
}

export function scopedRequestKey(headers: Record<string, unknown>, scope: string): string | undefined {
  const raw = headers['idempotency-key'];
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim();
  if (!key || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) return undefined;
  return `${scope}:${key}`;
}

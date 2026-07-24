import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, prisma } from '@afrohit/db';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';

type AssetType = 'material' | 'beat' | 'vocal' | 'reference';
type JsonRecord = Record<string, unknown>;

const assetTypeSchema = z.enum(['material', 'beat', 'vocal', 'reference']);
const grantSchema = z.object({
  assetType: assetTypeSchema,
  assetId: z.string().min(1).max(200),
  agreementId: z.string().min(3).max(300),
  licensor: z.string().min(2).max(300),
  evidenceUrl: z.string().url().refine(value => value.startsWith('https://'), {
    message: 'evidenceUrl must use HTTPS',
  }),
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable().optional(),
  territory: z.string().min(2).max(200).default('worldwide'),
}).strict();
const revokeSchema = z.object({
  assetType: assetTypeSchema,
  assetId: z.string().min(1).max(200),
  reason: z.string().min(3).max(500),
}).strict();

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function withTrainingLicense(
  value: unknown,
  receipt: JsonRecord,
  priorRightsBasis?: string
): Prisma.InputJsonValue {
  return {
    ...record(value),
    trainingLicense: {
      ...receipt,
      ...(priorRightsBasis ? { priorRightsBasis } : {}),
    },
  } as Prisma.InputJsonValue;
}

function withoutTrainingLicense(
  value: unknown,
  revocation: { reason: string; userId: string }
): { value: Prisma.InputJsonValue; priorRightsBasis: string | null } {
  const current = record(value);
  const receipt = record(current.trainingLicense);
  const priorRightsBasis =
    typeof receipt.priorRightsBasis === 'string' ? receipt.priorRightsBasis : null;
  const rest = { ...current };
  delete rest.trainingLicense;
  const history = Array.isArray(rest.trainingLicenseHistory)
    ? rest.trainingLicenseHistory
    : [];
  rest.trainingLicenseHistory = [
    ...history,
    {
      ...receipt,
      revokedAt: new Date().toISOString(),
      revokedByUserId: revocation.userId,
      revocationReason: revocation.reason,
    },
  ];
  return { value: rest as Prisma.InputJsonValue, priorRightsBasis };
}

async function attachLicense(
  assetType: AssetType,
  assetId: string,
  receipt: JsonRecord
): Promise<void> {
  if (assetType === 'material') {
    const row = await prisma.materialAsset.findUniqueOrThrow({
      where: { id: assetId },
      select: { meta: true, rightsBasis: true },
    });
    await prisma.materialAsset.update({
      where: { id: assetId },
      data: {
        rightsBasis: 'training-licensed',
        meta: withTrainingLicense(row.meta, receipt, row.rightsBasis),
      },
    });
    return;
  }
  if (assetType === 'beat') {
    const row = await prisma.beatAsset.findUniqueOrThrow({
      where: { id: assetId },
      select: { meta: true },
    });
    await prisma.beatAsset.update({
      where: { id: assetId },
      data: { meta: withTrainingLicense(row.meta, receipt) },
    });
    return;
  }
  if (assetType === 'vocal') {
    const row = await prisma.vocalRender.findUniqueOrThrow({
      where: { id: assetId },
      select: { meta: true },
    });
    await prisma.vocalRender.update({
      where: { id: assetId },
      data: { meta: withTrainingLicense(row.meta, receipt) },
    });
    return;
  }
  const row = await prisma.soundReference.findUniqueOrThrow({
    where: { id: assetId },
    select: { recipe: true, rightsBasis: true },
  });
  await prisma.soundReference.update({
    where: { id: assetId },
    data: {
      rightsBasis: 'training-licensed',
      recipe: withTrainingLicense(row.recipe, receipt, row.rightsBasis),
    },
  });
}

async function revokeLicense(
  assetType: AssetType,
  assetId: string,
  revocation: { reason: string; userId: string }
): Promise<void> {
  if (assetType === 'material') {
    const row = await prisma.materialAsset.findUniqueOrThrow({
      where: { id: assetId },
      select: { meta: true },
    });
    const stripped = withoutTrainingLicense(row.meta, revocation);
    await prisma.materialAsset.update({
      where: { id: assetId },
      data: {
        meta: stripped.value,
        rightsBasis: stripped.priorRightsBasis ?? 'provider-generated',
      },
    });
    return;
  }
  if (assetType === 'beat') {
    const row = await prisma.beatAsset.findUniqueOrThrow({
      where: { id: assetId },
      select: { meta: true },
    });
    await prisma.beatAsset.update({
      where: { id: assetId },
      data: { meta: withoutTrainingLicense(row.meta, revocation).value },
    });
    return;
  }
  if (assetType === 'vocal') {
    const row = await prisma.vocalRender.findUniqueOrThrow({
      where: { id: assetId },
      select: { meta: true },
    });
    await prisma.vocalRender.update({
      where: { id: assetId },
      data: { meta: withoutTrainingLicense(row.meta, revocation).value },
    });
    return;
  }
  const row = await prisma.soundReference.findUniqueOrThrow({
    where: { id: assetId },
    select: { recipe: true },
  });
  const stripped = withoutTrainingLicense(row.recipe, revocation);
  await prisma.soundReference.update({
    where: { id: assetId },
    data: {
      recipe: stripped.value,
      rightsBasis: stripped.priorRightsBasis ?? 'facts-only',
    },
  });
}

/** Register evidence-backed, revocable weight-training rights for every audio
 * asset family. Generic commercial-use permission is deliberately insufficient. */
export function registerTrainingAssetLicenseRoutes(
  app: FastifyInstance,
  requireAdmin: (req: FastifyRequest) => Promise<void>
): void {
  app.post('/training/assets/license', { schema: { body: grantSchema } }, async (req, reply) => {
    await requireAdmin(req);
    const { userId } = requireAuth(req);
    const input = grantSchema.parse(req.body);
    if (input.expiresAt && input.expiresAt <= input.grantedAt) {
      return reply.code(400).send({
        error: 'invalid_training_license_window',
        message: 'expiresAt must follow grantedAt',
      });
    }
    const receipt = {
      scope: 'commercial-model-training',
      agreementId: input.agreementId,
      licensor: input.licensor,
      evidenceUrl: input.evidenceUrl,
      grantedAt: input.grantedAt,
      expiresAt: input.expiresAt ?? null,
      territory: input.territory,
      recordedByUserId: userId,
      recordedAt: new Date().toISOString(),
    };
    await attachLicense(input.assetType, input.assetId, receipt);
    req.log.info(
      {
        adminUserId: userId,
        assetType: input.assetType,
        assetId: input.assetId,
        agreementId: input.agreementId,
      },
      '[admin] commercial model-training license attached'
    );
    return reply.send({
      ok: true,
      assetType: input.assetType,
      assetId: input.assetId,
      weightTraining: 'eligible-on-next-flywheel-scan',
    });
  });

  app.post('/training/assets/license/revoke', { schema: { body: revokeSchema } }, async (req, reply) => {
    await requireAdmin(req);
    const { userId } = requireAuth(req);
    const input = revokeSchema.parse(req.body);
    await revokeLicense(input.assetType, input.assetId, {
      reason: input.reason,
      userId,
    });
    req.log.warn(
      {
        adminUserId: userId,
        assetType: input.assetType,
        assetId: input.assetId,
        reason: input.reason,
      },
      '[admin] commercial model-training license revoked'
    );
    return reply.send({
      ok: true,
      assetType: input.assetType,
      assetId: input.assetId,
      weightTraining: 'removed-from-future-runs',
    });
  });
}

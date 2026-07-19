import type { FastifyInstance } from "fastify";
import { prisma } from "@afrohit/db";
import {
  confirmProducerKitSchema,
  forgeKitFor,
  inferProducerKitFile,
  isMaterialRole,
  isProducerKitRole,
  jobOf,
  materialCoverage,
  materialGenreMatches,
  normalizeMaterialGenre,
  producerKitManifestSchema,
  type ProducerKitManifestInput,
} from "@afrohit/shared";
import { requireAuth } from "../middleware/auth";
import { fingerprintUploadedAudio } from "../lib/storage";

const SETTING_PREFIX = "producer-kit:v1:";
const LIST_LIMIT = 50;

type StoredInference = ReturnType<typeof inferProducerKitFile>;

type StoredKitItem = {
  clientId: string;
  fileName: string;
  materialId: string;
  ownedByKit: boolean;
  duplicateOf: string | null;
  inference: StoredInference;
};

type StoredKit = {
  version: 1;
  kitId: string;
  workspaceId: string;
  name: string;
  genre: string;
  defaultBpm: number | null;
  defaultKeySignature: string | null;
  state: "staged" | "ready" | "needs_attention";
  items: StoredKitItem[];
  createdAt: string;
  confirmedAt: string | null;
};

type MaterialRow = {
  id: string;
  kind: string;
  role: string;
  genre: string | null;
  bpm: number | null;
  keySignature: string | null;
  bars: number | null;
  durationS: number | null;
  url: string;
  source: string;
  readiness: string;
  qualityState: string;
  roleEvidence: string;
  rightsBasis: string;
  contentHash: string | null;
  verifiedAt: Date | null;
  meta: unknown;
  createdAt: Date;
};

function settingKey(workspaceId: string, kitId: string): string {
  return `${SETTING_PREFIX}${workspaceId}:${kitId}`;
}

function parseStoredKit(raw: string, workspaceId: string): StoredKit | null {
  try {
    const kit = JSON.parse(raw) as Partial<StoredKit>;
    if (
      kit.version !== 1 ||
      kit.workspaceId !== workspaceId ||
      typeof kit.kitId !== "string" ||
      !Array.isArray(kit.items)
    ) {
      return null;
    }
    return kit as StoredKit;
  } catch {
    return null;
  }
}

async function readStoredKit(
  workspaceId: string,
  kitId: string
): Promise<StoredKit | null> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey(workspaceId, kitId) },
    select: { value: true },
  });
  return setting ? parseStoredKit(setting.value, workspaceId) : null;
}

function materialJob(role: string): string | null {
  if (isMaterialRole(role)) return jobOf(role);
  return (
    {
      drums: "rhythm",
      percussion: "rhythm",
      bass: "low_end",
      chords: "harmony",
      fill: "rhythm",
    } as Record<string, string>
  )[role] ?? null;
}

function inferredBars(durationS: number | null, bpm: number | null): number | null {
  if (!durationS || !bpm) return null;
  const bars = durationS * bpm / 240;
  const nearest = Math.round(bars);
  return nearest >= 1 && nearest <= 128 && Math.abs(bars - nearest) <= 0.12
    ? nearest
    : null;
}

async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  work: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= values.length) return;
        output[index] = await work(values[index]!, index);
      }
    })
  );
  return output;
}

function publicMaterial(row: MaterialRow, item: StoredKitItem) {
  return {
    clientId: item.clientId,
    fileName: item.fileName,
    materialId: row.id,
    ownedByKit: item.ownedByKit,
    duplicateOf: item.duplicateOf,
    kind: row.kind,
    role: row.role === "other" ? item.inference.role.role : row.role,
    bpm: row.bpm ?? item.inference.bpm,
    keySignature: row.keySignature ?? item.inference.keySignature,
    durationS: row.durationS,
    url: row.url,
    readiness: row.readiness,
    qualityState: row.qualityState,
    roleEvidence: row.roleEvidence,
    rightsBasis: row.rightsBasis,
    contentHash: row.contentHash,
    inference: item.inference,
  };
}

function readinessFor(rows: MaterialRow[], genre: string) {
  const usable = rows.filter(
    row =>
      row.readiness === "ready" &&
      row.qualityState === "passed" &&
      row.rightsBasis !== "unknown" &&
      materialGenreMatches(row.genre, genre)
  );
  const coverage = materialCoverage(usable.map(row => ({ role: row.role })));
  const recommendedRoles = forgeKitFor(genre, 14).filter(role => role !== "fill");
  const have = new Set(usable.map(row => row.role));
  return {
    ready: coverage.ready,
    coverage,
    readyFiles: usable.length,
    roles: [...have].sort(),
    recommendedRoles,
    missingRecommendedRoles: recommendedRoles.filter(role => !have.has(role)),
  };
}

async function hydrateKit(workspaceId: string, kit: StoredKit) {
  const itemIds = [...new Set(kit.items.map(item => item.materialId))];
  const [kitRows, workspaceRows] = await Promise.all([
    prisma.materialAsset.findMany({
      where: { workspaceId, id: { in: itemIds } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.materialAsset.findMany({
      where: { workspaceId, role: { not: "instrumental" } },
      orderBy: { createdAt: "desc" },
      take: 2_000,
    }),
  ]);
  const rowById = new Map(
    (kitRows as MaterialRow[]).map(row => [row.id, row] as const)
  );
  const files = kit.items
    .map(item => {
      const row = rowById.get(item.materialId);
      return row ? publicMaterial(row, item) : null;
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
  return {
    kitId: kit.kitId,
    name: kit.name,
    genre: kit.genre,
    defaultBpm: kit.defaultBpm,
    defaultKeySignature: kit.defaultKeySignature,
    state: kit.state,
    createdAt: kit.createdAt,
    confirmedAt: kit.confirmedAt,
    files,
    kitReadiness: readinessFor(kitRows as MaterialRow[], kit.genre),
    shelfReadiness: readinessFor(workspaceRows as MaterialRow[], kit.genre),
  };
}

export default async function producerKits(app: FastifyInstance) {
  app.get("/", async req => {
    const { workspaceId } = requireAuth(req);
    const settings: Array<{ value: string }> = await prisma.systemSetting.findMany({
      where: { key: { startsWith: `${SETTING_PREFIX}${workspaceId}:` } },
      orderBy: { updatedAt: "desc" },
      take: LIST_LIMIT,
      select: { value: true },
    });
    const kits: StoredKit[] = settings
      .map((setting: { value: string }) => parseStoredKit(setting.value, workspaceId))
      .filter((kit: StoredKit | null): kit is StoredKit => !!kit);
    return {
      total: kits.length,
      kits: await Promise.all(kits.map((kit: StoredKit) => hydrateKit(workspaceId, kit))),
    };
  });

  app.get<{ Params: { kitId: string } }>("/:kitId", async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const kitId = req.params.kitId;
    if (!/^[0-9a-f-]{36}$/i.test(kitId))
      return reply.code(400).send({ error: "invalid_kit_id" });
    const kit = await readStoredKit(workspaceId, kitId);
    if (!kit) return reply.code(404).send({ error: "kit_not_found" });
    return hydrateKit(workspaceId, kit);
  });

  app.post(
    "/manifests",
    { schema: { body: producerKitManifestSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = producerKitManifestSchema.parse(
        req.body
      ) as ProducerKitManifestInput;
      const replay = await readStoredKit(workspaceId, input.kitId);
      if (replay) return hydrateKit(workspaceId, replay);

      const verified = await mapLimit(input.files, 4, async file => {
        const fingerprint = await fingerprintUploadedAudio(workspaceId, file.key);
        if (fingerprint.sizeBytes !== file.sizeBytes) {
          throw Object.assign(new Error("uploaded_audio_size_changed"), {
            statusCode: 409,
          });
        }
        const inference = inferProducerKitFile(file.fileName, file.metrics, {
          genre: input.genre,
          bpm: input.defaultBpm,
          keySignature: input.defaultKeySignature,
        });
        return { file, fingerprint, inference };
      });

      const now = new Date();
      let stored: StoredKit;
      try {
        stored = await prisma.$transaction(async tx => {
          const items: StoredKitItem[] = [];
          for (const entry of verified) {
            const existing = await tx.materialAsset.findUnique({
              where: {
                workspaceId_contentHash: {
                  workspaceId,
                  contentHash: entry.fingerprint.contentHash,
                },
              },
            });
            if (existing) {
              items.push({
                clientId: entry.file.clientId,
                fileName: entry.file.fileName,
                materialId: existing.id,
                ownedByKit: false,
                duplicateOf: existing.id,
                inference: entry.inference,
              });
              continue;
            }

            const proposedRole =
              entry.file.proposedRole ?? entry.inference.role.role ?? "other";
            const proposedBpm = entry.file.proposedBpm ?? entry.inference.bpm;
            const proposedKey =
              entry.file.proposedKeySignature ?? entry.inference.keySignature;
            const material = await tx.materialAsset.create({
              data: {
                workspaceId,
                kind: entry.file.kind,
                role: proposedRole,
                genre: normalizeMaterialGenre(input.genre),
                bpm: proposedBpm,
                keySignature: proposedKey,
                bars: inferredBars(entry.file.metrics?.durationS ?? null, proposedBpm),
                durationS: entry.file.metrics?.durationS ?? null,
                url: entry.fingerprint.assetRef,
                source: "artist_stem",
                readiness: "pending",
                qualityState: "unmeasured",
                roleEvidence: "unknown",
                rightsBasis: "user-attested",
                contentHash: entry.fingerprint.contentHash,
                meta: {
                  producerKit: {
                    version: 1,
                    kitId: input.kitId,
                    kitName: input.name,
                    fileName: entry.file.fileName,
                    clientId: entry.file.clientId,
                    state: "needs_confirmation",
                    format: entry.fingerprint.format,
                    sizeBytes: entry.fingerprint.sizeBytes,
                    browserMetrics: entry.file.metrics,
                    inference: entry.inference,
                  },
                } as never,
              },
            });
            items.push({
              clientId: entry.file.clientId,
              fileName: entry.file.fileName,
              materialId: material.id,
              ownedByKit: true,
              duplicateOf: null,
              inference: entry.inference,
            });
          }

          const ownsFiles = items.some(item => item.ownedByKit);
          const value: StoredKit = {
            version: 1,
            kitId: input.kitId,
            workspaceId,
            name: input.name,
            genre: normalizeMaterialGenre(input.genre),
            defaultBpm: input.defaultBpm ?? null,
            defaultKeySignature: input.defaultKeySignature ?? null,
            state: ownsFiles ? "staged" : "ready",
            items,
            createdAt: now.toISOString(),
            confirmedAt: ownsFiles ? null : now.toISOString(),
          };
          await tx.systemSetting.create({
            data: {
              key: settingKey(workspaceId, input.kitId),
              value: JSON.stringify(value),
            },
          });
          await tx.analyticsEvent.create({
            data: {
              workspaceId,
              name: "producer_kit.staged",
              properties: {
                kitId: input.kitId,
                genre: input.genre,
                files: items.length,
                duplicates: items.filter(item => !item.ownedByKit).length,
              } as never,
            },
          });
          return value;
        });
      } catch (error) {
        const raced = await readStoredKit(workspaceId, input.kitId);
        if (raced) return hydrateKit(workspaceId, raced);
        throw error;
      }

      reply.code(201);
      return hydrateKit(workspaceId, stored);
    }
  );

  app.post<{ Params: { kitId: string } }>(
    "/:kitId/confirm",
    { schema: { body: confirmProducerKitSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = confirmProducerKitSchema.parse(req.body);
      const kit = await readStoredKit(workspaceId, req.params.kitId);
      if (!kit) return reply.code(404).send({ error: "kit_not_found" });
      if (kit.confirmedAt) return hydrateKit(workspaceId, kit);

      const ownedItems = kit.items.filter(item => item.ownedByKit);
      const expected = new Set(ownedItems.map(item => item.materialId));
      const received = new Set(input.files.map(file => file.materialId));
      if (
        expected.size !== received.size ||
        [...expected].some(id => !received.has(id))
      ) {
        return reply.code(409).send({
          error: "kit_confirmation_incomplete",
          expectedMaterialIds: [...expected],
        });
      }

      const rows = (await prisma.materialAsset.findMany({
        where: { workspaceId, id: { in: [...expected] } },
      })) as MaterialRow[];
      if (rows.length !== expected.size)
        return reply.code(409).send({ error: "kit_material_missing" });
      const rowById = new Map(rows.map(row => [row.id, row] as const));
      const itemById = new Map(
        ownedItems.map(item => [item.materialId, item] as const)
      );

      for (const correction of input.files) {
        if (correction.decision === "reject") continue;
        if (!isProducerKitRole(correction.role))
          return reply.code(422).send({
            error: "unknown_material_role",
            materialId: correction.materialId,
          });
        const item = itemById.get(correction.materialId)!;
        if (item.inference.quality.status === "rejected") {
          return reply.code(422).send({
            error: "material_quality_rejected",
            materialId: correction.materialId,
            reasons: item.inference.quality.reasons,
          });
        }
        const job = materialJob(correction.role);
        if (
          ["rhythm", "low_end", "harmony"].includes(job ?? "") &&
          correction.bpm == null
        ) {
          return reply.code(422).send({
            error: "material_bpm_required",
            materialId: correction.materialId,
            role: correction.role,
          });
        }
      }

      const confirmedAt = new Date();
      const accepted = input.files.filter(file => file.decision === "accept");
      const rejected = input.files.filter(file => file.decision === "reject");
      const updatedKit: StoredKit = {
        ...kit,
        state: accepted.length ? "ready" : "needs_attention",
        confirmedAt: confirmedAt.toISOString(),
      };

      await prisma.$transaction(async tx => {
        for (const correction of input.files) {
          const row = rowById.get(correction.materialId)!;
          const oldMeta =
            row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
              ? (row.meta as Record<string, unknown>)
              : {};
          const oldKitMeta =
            oldMeta.producerKit &&
            typeof oldMeta.producerKit === "object" &&
            !Array.isArray(oldMeta.producerKit)
              ? (oldMeta.producerKit as Record<string, unknown>)
              : {};
          if (correction.decision === "reject") {
            await tx.materialAsset.update({
              where: { id: row.id },
              data: {
                readiness: "rejected",
                qualityState: "failed",
                roleEvidence: "human-rejected",
                verifiedAt: null,
                meta: {
                  ...oldMeta,
                  producerKit: {
                    ...oldKitMeta,
                    state: "rejected_by_producer",
                    confirmedAt: confirmedAt.toISOString(),
                  },
                } as never,
              },
            });
            continue;
          }
          const item = itemById.get(correction.materialId)!;
          await tx.materialAsset.update({
            where: { id: row.id },
            data: {
              role: correction.role,
              bpm: correction.bpm,
              keySignature: correction.keySignature,
              bars: inferredBars(row.durationS, correction.bpm),
              readiness: "ready",
              qualityState: "passed",
              roleEvidence: "human-confirmed",
              rightsBasis: "user-attested",
              verifiedAt: confirmedAt,
              meta: {
                ...oldMeta,
                producerKit: {
                  ...oldKitMeta,
                  state: "confirmed",
                  confirmedAt: confirmedAt.toISOString(),
                  qualityBasis:
                    item.inference.quality.status === "passed"
                      ? "browser-analysis+producer-confirmation"
                      : "producer-audition-override",
                  correction: {
                    role: correction.role,
                    bpm: correction.bpm,
                    keySignature: correction.keySignature,
                  },
                },
              } as never,
            },
          });
        }
        await tx.systemSetting.update({
          where: { key: settingKey(workspaceId, kit.kitId) },
          data: { value: JSON.stringify(updatedKit) },
        });
        await tx.analyticsEvent.create({
          data: {
            workspaceId,
            name: "producer_kit.confirmed",
            properties: {
              kitId: kit.kitId,
              accepted: accepted.length,
              rejected: rejected.length,
            } as never,
          },
        });
      });

      return hydrateKit(workspaceId, updatedKit);
    }
  );
}

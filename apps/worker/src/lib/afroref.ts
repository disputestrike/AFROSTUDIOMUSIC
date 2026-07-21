/**
 * AFROREF INGESTION (trainlegal item 4) — feed the rights-clean reference set.
 *
 * The LAW lives in @afrohit/shared (afroRefEligibility, training-corpus.ts):
 * ONLY own-engine renders and consented user-original uploads may anchor the
 * AfroRef measuring stick; third-party renders (MiniMax/Suno/ACE-step/Eleven)
 * are refused UNCONDITIONALLY — this module is only the thin prisma plumbing
 * around that pure gate and re-implements NO classification.
 */
import { prisma } from "@afrohit/db";
import { afroRefEligibility, type AssetProvenance } from "@afrohit/shared";

export interface AfroRefIngestInput {
  /** Provenance of the source asset — the SAME shape the training gate reads. */
  provenance: AssetProvenance;
  url: string;
  genre: string;
  language?: string | null;
  songId?: string | null;
  materialId?: string | null;
  workspaceId?: string | null;
  contentHash?: string | null;
}

export interface AfroRefIngestResult {
  ingested: boolean;
  id?: string;
  reason?: string;
}

/** Gate first, insert second. A refused clip returns the gate's plain reason —
 *  nothing is silently dropped, nothing dirty is silently admitted. */
export async function ingestAfroRefClip(input: AfroRefIngestInput): Promise<AfroRefIngestResult> {
  const verdict = afroRefEligibility(input.provenance);
  if (!verdict.eligible) {
    return { ingested: false, reason: verdict.reason ?? "ineligible for the AfroRef reference set" };
  }
  const genre = input.genre.trim().toLowerCase();
  if (!genre) return { ingested: false, reason: "AfroRef clip requires a genre" };
  if (input.contentHash) {
    const existing = await prisma.afroRefClip.findUnique({
      where: { contentHash: input.contentHash },
      select: { id: true },
    });
    if (existing) return { ingested: false, reason: `duplicate content hash (clip ${existing.id})` };
  }
  const row = await prisma.afroRefClip.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      songId: input.songId ?? null,
      materialId: input.materialId ?? null,
      url: input.url,
      genre,
      language: input.language?.trim().toLowerCase() || null,
      provenance: verdict.origin,
      engine: input.provenance.engine ?? null,
      contentHash: input.contentHash ?? null,
    },
    select: { id: true },
  });
  return { ingested: true, id: row.id };
}

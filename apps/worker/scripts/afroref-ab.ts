/**
 * AFROREF BLIND A/B HARNESS (trainlegal item 4) — a minimal, honest scaffold
 * for human judging: candidate clips vs the rights-clean AfroRef reference
 * set, ids BLINDED so the judge cannot favor the home team.
 *
 * Emit a pairing sheet (+ a separate key file the judge must NOT open):
 *   pnpm --filter @afrohit/worker exec tsx scripts/afroref-ab.ts \
 *     --candidates candidates.json [--references references.json | --from-db --genre amapiano] \
 *     --out sheet.json --key key.json [--seed my-seed]
 *   (clip files: JSON arrays of { "id": "...", "url": "..." })
 *
 * Tally a filled sheet (each pair's "winner" set to "A" | "B" | "tie"):
 *   pnpm --filter @afrohit/worker exec tsx scripts/afroref-ab.ts \
 *     --tally sheet.filled.json --key key.json
 *
 * The pairing and tally functions are PURE and exported for the test gate.
 * --from-db reads the AfroRefClip table (already provenance-gated at ingest);
 * this script never admits clips itself and never spends provider money.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export interface AbClip {
  id: string;
  url: string;
}

export interface AbSheetPair {
  pairId: string;
  /** Blinded sides — URLs only, NO ids, so the judge listens without labels. */
  a: { url: string };
  b: { url: string };
  /** Filled by the human judge: 'A' | 'B' | 'tie'. */
  winner: null | "A" | "B" | "tie";
}

export interface AbSheet {
  schema: "afroref-ab-v1";
  createdAt: string;
  pairs: AbSheetPair[];
}

/** The unblinding key — which side of each pair is the CANDIDATE. Kept in a
 *  separate file so the sheet alone reveals nothing. */
export type AbKey = Record<
  string,
  { candidate: "A" | "B"; candidateId: string; referenceId: string }
>;

/** Deterministic coin from a seed — reproducible sheets for the same inputs. */
function seededBit(seed: string, index: number): boolean {
  const digest = createHash("sha256").update(`${seed}:${index}`).digest();
  return (digest[0]! & 1) === 1;
}

/**
 * Build the randomized, blinded pairing sheet. Pair count = min(candidates,
 * references); references are consumed in a seed-shuffled order so repeated
 * runs with a new seed sample different matchups.
 */
export function buildBlindPairingSheet(
  candidates: AbClip[],
  references: AbClip[],
  seed = "afroref-ab"
): { sheet: AbSheet; key: AbKey } {
  const shuffledRefs = [...references].sort((left, right) => {
    const lh = createHash("sha256").update(`${seed}:${left.id}`).digest("hex");
    const rh = createHash("sha256").update(`${seed}:${right.id}`).digest("hex");
    return lh.localeCompare(rh);
  });
  const pairs: AbSheetPair[] = [];
  const key: AbKey = {};
  const count = Math.min(candidates.length, shuffledRefs.length);
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates[i]!;
    const reference = shuffledRefs[i]!;
    const pairId = createHash("sha256")
      .update(`${seed}:${candidate.id}:${reference.id}`)
      .digest("hex")
      .slice(0, 12);
    const candidateIsA = seededBit(seed, i);
    pairs.push({
      pairId,
      a: { url: candidateIsA ? candidate.url : reference.url },
      b: { url: candidateIsA ? reference.url : candidate.url },
      winner: null,
    });
    key[pairId] = {
      candidate: candidateIsA ? "A" : "B",
      candidateId: candidate.id,
      referenceId: reference.id,
    };
  }
  return {
    sheet: { schema: "afroref-ab-v1", createdAt: new Date().toISOString(), pairs },
    key,
  };
}

export interface AbTally {
  judged: number;
  unjudged: number;
  candidateWins: number;
  referenceWins: number;
  ties: number;
  /** candidateWins / (candidateWins + referenceWins); null until any verdict. */
  winRate: number | null;
}

/** Tally a filled sheet against its key. Pairs without a verdict (or without a
 *  key entry) count as unjudged — never guessed. */
export function tallyAbWinRate(sheet: AbSheet, key: AbKey): AbTally {
  let candidateWins = 0;
  let referenceWins = 0;
  let ties = 0;
  let unjudged = 0;
  for (const pair of sheet.pairs) {
    const entry = key[pair.pairId];
    if (!entry || pair.winner == null) {
      unjudged += 1;
      continue;
    }
    if (pair.winner === "tie") ties += 1;
    else if (pair.winner === entry.candidate) candidateWins += 1;
    else referenceWins += 1;
  }
  const decisive = candidateWins + referenceWins;
  return {
    judged: candidateWins + referenceWins + ties,
    unjudged,
    candidateWins,
    referenceWins,
    ties,
    winRate: decisive > 0 ? Math.round((candidateWins / decisive) * 10_000) / 10_000 : null,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readClips(path: string): AbClip[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array of { id, url }`);
  return raw.map((row, index) => {
    const record = row as { id?: unknown; url?: unknown };
    if (typeof record.id !== "string" || typeof record.url !== "string") {
      throw new Error(`${path}[${index}]: each clip needs string id + url`);
    }
    return { id: record.id, url: record.url };
  });
}

async function referencesFromDb(genre?: string, language?: string): Promise<AbClip[]> {
  // Lazy import: the pure functions above stay importable with no DB at all.
  const { prisma } = await import("@afrohit/db");
  const rows = await prisma.afroRefClip.findMany({
    where: {
      ...(genre ? { genre: genre.toLowerCase() } : {}),
      ...(language ? { language: language.toLowerCase() } : {}),
    },
    select: { id: true, url: true },
    orderBy: { addedAt: "desc" },
    take: 200,
  });
  await prisma.$disconnect().catch(() => undefined);
  return rows;
}

async function main(): Promise<void> {
  const tallyPath = argValue("tally");
  const keyPath = argValue("key");
  if (tallyPath) {
    if (!keyPath) throw new Error("--tally requires --key <key.json>");
    const sheet = JSON.parse(readFileSync(tallyPath, "utf8")) as AbSheet;
    const key = JSON.parse(readFileSync(keyPath, "utf8")) as AbKey;
    const tally = tallyAbWinRate(sheet, key);
    console.log(JSON.stringify(tally, null, 2));
    return;
  }

  const candidatesPath = argValue("candidates");
  if (!candidatesPath) {
    throw new Error(
      "usage: afroref-ab.ts --candidates clips.json [--references clips.json | --from-db --genre g] [--out sheet.json --key key.json --seed s] | --tally sheet.json --key key.json"
    );
  }
  const candidates = readClips(candidatesPath);
  const referencesPath = argValue("references");
  const references = referencesPath
    ? readClips(referencesPath)
    : process.argv.includes("--from-db")
      ? await referencesFromDb(argValue("genre"), argValue("language"))
      : [];
  if (references.length === 0) {
    throw new Error("no reference clips — pass --references <file> or --from-db (with AfroRefClip rows ingested)");
  }
  const seed = argValue("seed") ?? "afroref-ab";
  const { sheet, key } = buildBlindPairingSheet(candidates, references, seed);
  const outPath = argValue("out") ?? "afroref-ab-sheet.json";
  const outKeyPath = keyPath ?? "afroref-ab-key.json";
  writeFileSync(outPath, JSON.stringify(sheet, null, 2));
  writeFileSync(outKeyPath, JSON.stringify(key, null, 2));
  console.log(
    `wrote ${sheet.pairs.length} blinded pair(s) to ${outPath}; unblinding key in ${outKeyPath} — judges fill "winner" ("A"|"B"|"tie") in the sheet WITHOUT opening the key`
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error((error as Error)?.message ?? error);
    process.exitCode = 1;
  });
}

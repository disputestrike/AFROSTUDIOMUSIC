export const SINGING_EXTERNAL_SCORE_EVENT = "afroone.singing.external_score";
export const SINGING_EXTERNAL_SCORE_VERSION =
  "afroone-singing-external-score-v1";

export interface SingingExternalScoreReceipt {
  version: typeof SINGING_EXTERNAL_SCORE_VERSION;
  providerJobId: string;
  vocalRenderId: string;
  contentHash: string;
  evaluatorId: string;
  independent: true;
  source: "external_human";
  measuredAt: string;
  releaseUsable: boolean;
  scores: {
    pitchAccuracy: number;
    lyricClarity: number;
    naturalness: number;
    culturalFit: number;
    releaseReadiness: number;
  };
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function score(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5;
}

export function isSingingExternalScoreReceipt(
  value: unknown
): value is SingingExternalScoreReceipt {
  const receipt = record(value);
  const scores = record(receipt.scores);
  return (
    receipt.version === SINGING_EXTERNAL_SCORE_VERSION &&
    typeof receipt.providerJobId === "string" &&
    receipt.providerJobId.length > 0 &&
    typeof receipt.vocalRenderId === "string" &&
    receipt.vocalRenderId.length > 0 &&
    typeof receipt.contentHash === "string" &&
    /^[a-f0-9]{64}$/i.test(receipt.contentHash) &&
    typeof receipt.evaluatorId === "string" &&
    receipt.evaluatorId.trim().length > 0 &&
    receipt.independent === true &&
    receipt.source === "external_human" &&
    typeof receipt.measuredAt === "string" &&
    Number.isFinite(Date.parse(receipt.measuredAt)) &&
    typeof receipt.releaseUsable === "boolean" &&
    score(scores.pitchAccuracy) &&
    score(scores.lyricClarity) &&
    score(scores.naturalness) &&
    score(scores.culturalFit) &&
    score(scores.releaseReadiness)
  );
}

export function singingExternalScoreAverage(
  receipt: SingingExternalScoreReceipt
): number {
  const values = Object.values(receipt.scores);
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)
  );
}

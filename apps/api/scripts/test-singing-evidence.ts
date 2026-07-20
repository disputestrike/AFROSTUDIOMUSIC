import assert from "node:assert/strict";
import {
  SINGING_EXTERNAL_SCORE_VERSION,
  isSingingExternalScoreReceipt,
  singingExternalScoreAverage,
} from "@afrohit/shared";
import { singingEvidenceSchema } from "../src/routes/singing-evidence";

const input = {
  providerJobId: "clx123456789012345678901",
  vocalRenderId: "clx123456789012345678902",
  contentHash: "ab".repeat(32),
  evaluatorId: "independent-vocal-director",
  measuredAt: "2026-07-19T12:40:00.000Z",
  releaseUsable: true,
  scores: {
    pitchAccuracy: 4.4,
    lyricClarity: 4.2,
    naturalness: 4.1,
    culturalFit: 4.5,
    releaseReadiness: 4.2,
  },
};

assert.equal(singingEvidenceSchema.safeParse(input).success, true);
assert.equal(
  singingEvidenceSchema.safeParse({ ...input, scores: { ...input.scores, naturalness: 5.1 } }).success,
  false
);

const receipt = {
  version: SINGING_EXTERNAL_SCORE_VERSION,
  ...input,
  independent: true,
  source: "external_human",
};
assert.equal(isSingingExternalScoreReceipt(receipt), true);
assert.equal(singingExternalScoreAverage(receipt), 4.28);
assert.equal(isSingingExternalScoreReceipt({ ...receipt, independent: false }), false);
assert.equal(isSingingExternalScoreReceipt({ ...receipt, contentHash: "unverified" }), false);

console.log("Singing evidence capture and shared receipt validation passed");

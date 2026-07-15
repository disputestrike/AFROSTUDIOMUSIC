import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/processors/voice-sing.ts", import.meta.url),
  "utf8"
);

const instrumentalAt = source.indexOf("const rawInstrumentalUrl");
const transactionAt = source.indexOf("const result = await prisma.$transaction");
const beatAt = source.indexOf("const beat = await tx.beatAsset.create", transactionAt);
const vocalAt = source.indexOf("const vocal = await tx.vocalRender.create", transactionAt);
const mixAt = source.indexOf("const mix = await tx.mix.create", transactionAt);
assert.ok(instrumentalAt > 0 && instrumentalAt < transactionAt);
assert.ok(beatAt > transactionAt && beatAt < vocalAt && vocalAt < mixAt);

const persistence = source.slice(transactionAt, source.indexOf("createdUrls.delete", transactionAt));
assert.equal(persistence.includes('assetKind: "instrumental"'), true);
assert.equal(persistence.includes("contentHash: instrumentalContentHash"), true);
assert.equal(persistence.includes("verifiedAt: instrumentalVerifiedAt"), true);
assert.equal(persistence.includes("beatId: beat.id"), true);
assert.equal(persistence.includes("beatContentHash: instrumentalContentHash"), true);
assert.equal(persistence.includes("vocalRenderIds: [vocal.id]"), true);
assert.equal(
  persistence.includes("vocalRenderContentHashes: [vocalInspection.contentHash]"),
  true
);
assert.equal(
  persistence.includes("sourceMixId: mix.id"),
  false,
  "the vocal must not depend on a Mix that is created later"
);
assert.equal(
  source.includes("voice_conversion_stem_separation_returned_no_instrumental"),
  true
);
assert.equal(source.includes("voice_conversion_instrumental_qc_failed"), true);

console.log("voice singing release lineage: PASS");

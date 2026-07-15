import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/processors/music.ts", import.meta.url),
  "utf8"
);
const start = source.indexOf("Full-song source for automatic mastering");
const end = source.indexOf("uncommittedMasterUrls = []", start);
assert.ok(start > 0 && end > start, "provider full-song persistence block must exist");

const prelude = source.slice(Math.max(0, start - 1_500), start);
const block = source.slice(start, end);
assert.equal(prelude.includes("const releaseLineageCertified = false"), true);
assert.equal(
  block.split("approved: releaseLineageCertified").length - 1,
  2,
  "both provider full-song Mix and Master must remain non-approved without exact stems"
);
assert.equal(block.includes("approved: true"), false);
assert.equal(
  block.includes("source: {"),
  false,
  "provider full-song persistence must not fabricate beat/vocal lineage"
);
assert.equal(
  block.split("releaseLineageCertified").length - 1 >= 3,
  true,
  "the non-release state must be persisted as evidence"
);

console.log("generated full-song release lineage: PASS");

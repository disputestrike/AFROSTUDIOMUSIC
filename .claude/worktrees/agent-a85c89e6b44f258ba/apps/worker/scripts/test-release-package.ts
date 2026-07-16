import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJson, evaluateReleaseReadiness } from "@afrohit/shared";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

const nestedA = {
  z: 1,
  evidence: { cover: { hash: "a" }, audio: { hash: "b" } },
  list: [{ y: 2, x: 1 }],
};
const nestedB = {
  list: [{ x: 1, y: 2 }],
  evidence: { audio: { hash: "b" }, cover: { hash: "a" } },
  z: 1,
};
assert.equal(
  canonicalJson(nestedA),
  canonicalJson(nestedB),
  "nested key order must be stable"
);
assert.notEqual(
  canonicalJson(nestedA),
  canonicalJson({
    ...nestedA,
    evidence: { ...nestedA.evidence, audio: { hash: "changed" } },
  }),
  "nested evidence changes must alter the canonical payload"
);

const hash = "a".repeat(64);
const complete = {
  audio: {
    kind: "master" as const,
    approved: true,
    qualityState: "passed",
    contentHash: hash,
    verified: true,
  },
  cover: {
    approved: true,
    qualityState: "passed",
    contentHash: hash,
    verified: true,
    width: 1024,
    height: 1024,
  },
  lyric: { present: true, approved: true, contentHash: hash },
  splits: { total: 100, count: 2, attested: true },
  rights: {
    present: true,
    hashValid: true,
    current: true,
    okToExport: true,
    risk: "low",
  },
  nativeReview: { required: true, attested: true, languages: ["yo"] },
  hitScore: 95,
  hitTarget: 90,
};
assert.equal(
  evaluateReleaseReadiness(complete).ready,
  true,
  "complete evidence should pass"
);
assert.equal(
  evaluateReleaseReadiness({
    ...complete,
    rights: { ...complete.rights, hashValid: false },
  }).ready,
  false,
  "tampered receipt must fail"
);
assert.equal(
  evaluateReleaseReadiness({
    ...complete,
    rights: { ...complete.rights, current: false },
  }).ready,
  false,
  "stale receipt must fail"
);
assert.equal(
  evaluateReleaseReadiness({
    ...complete,
    splits: { ...complete.splits, attested: false },
  }).ready,
  false,
  "unaccepted splits must fail"
);
assert.equal(
  evaluateReleaseReadiness({
    ...complete,
    nativeReview: { ...complete.nativeReview, attested: false },
  }).ready,
  false,
  "required native review must fail closed"
);
assert.equal(
  evaluateReleaseReadiness({
    ...complete,
    cover: { ...complete.cover, approved: false },
  }).ready,
  false,
  "unapproved cover must fail"
);

const exportWorker = source("src/processors/export.ts");
assert.match(exportWorker, /new JSZip\(\)/, "export must create a real ZIP");
assert.match(
  exportWorker,
  /checksums\.sha256/,
  "export must include checksums"
);
assert.match(exportWorker, /archiveUrl/, "export must persist an archive");
assert.match(
  exportWorker,
  /sourceFingerprint/,
  "export must bind exact source evidence"
);
assert.match(
  exportWorker,
  /checkCRC32/,
  "export must verify the generated ZIP"
);
assert.doesNotMatch(
  exportWorker,
  /For MVP|Next pass/i,
  "export cannot be a future-work placeholder"
);

const rightsWorker = source("src/processors/rights.ts");
assert.match(
  rightsWorker,
  /recognizeSong/,
  "rights worker must fingerprint audio"
);
assert.match(
  rightsWorker,
  /canonicalPayload/,
  "rights receipt must retain its hashed payload"
);
assert.match(
  rightsWorker,
  /matched_unconfirmed/,
  "catalog matches must fail without attestation"
);

const workerIndex = source("src/index.ts");
assert.match(
  workerIndex,
  /makeWorker\(["']rights["']/,
  "rights queue must have a worker"
);

const rightsRoute = source("../api/src/routes/rights.ts");
assert.match(
  rightsRoute,
  /app\.queues\.rights/,
  "rights API must queue durable work"
);
assert.doesNotMatch(
  rightsRoute,
  /runRightsCheck\(/,
  "HTTP request must not run the scan inline"
);

const exportsRoute = source("../api/src/routes/exports.ts");
assert.match(
  exportsRoute,
  /:exportId\/download/,
  "verified package needs a download endpoint"
);
assert.match(
  exportsRoute,
  /presignAssetRef/,
  "download must use a short-lived signed URL"
);
assert.doesNotMatch(
  exportsRoute,
  /archiveUrl:\s*row\.archiveUrl/,
  "list API must not leak private refs"
);

const imageRoute = source("../api/src/routes/images.ts");
assert.match(
  imageRoute,
  /image_not_certified/,
  "cover approval must require certification"
);
assert.match(
  imageRoute,
  /updateMany/,
  "approving a cover must retire prior cover approvals"
);

const releaseRoute = source("../api/src/routes/release.ts");
assert.match(
  releaseRoute,
  /loadReleaseCertification/,
  "release status must recompute evidence"
);
assert.match(
  releaseRoute,
  /reply\.code\(501\)/,
  "unsupported distribution must be explicit"
);
assert.match(
  releaseRoute,
  /current_release_package_required/,
  "distribution must require current package"
);
assert.match(
  releaseRoute,
  /latestRelease/,
  "release status must expose persisted distribution state"
);

const releaseUi = source("../web/components/ReleaseReadiness.tsx");
assert.match(
  releaseUi,
  /songId\?: string/,
  "release UI must accept an explicitly selected song"
);
assert.match(
  releaseUi,
  /Release status unavailable/,
  "release load failures must not spin forever"
);
assert.match(
  releaseUi,
  /status\.distribution/,
  "release UI must show distributor state"
);

const catalogUi = source("../web/components/CatalogGrid.tsx");
assert.match(
  catalogUi,
  /\?song=\$\{encodeURIComponent\(s\.id\)\}/,
  "catalog Studio links must preserve the selected song"
);

console.log("release package truth tests passed");

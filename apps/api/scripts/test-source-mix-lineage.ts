import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const writers = [
  ["songs", readFileSync(resolve(repoRoot, "apps/api/src/routes/songs.ts"), "utf8")],
  ["chat", readFileSync(resolve(repoRoot, "apps/api/src/services/chat-tools.ts"), "utf8")],
] as const;

for (const [name, source] of writers) {
  assert.match(source, /current\.type === ["']mix["'][\s\S]*latestMix\?\.id === current\.id/);
  assert.doesNotMatch(
    source,
    /latestMix\.preset !== ["']source["']/,
    `${name} must reuse the current certified mix instead of wrapping it`
  );

  assert.match(source, /else if \(current\.type === ["']master["']\)/);
  assert.match(source, /sourceMixId/);
  assert.match(source, /sourceContentHash/);
  assert.match(source, /id: sourceMixId/);
  assert.match(source, /contentHash: sourceMixHash/);
  assert.match(source, /sourceLineage\?\.beatId/);
  assert.match(source, /sourceLineage\?\.beatContentHash/);
  assert.match(source, /sourceLineage\?\.vocalRenderIds/);
  assert.match(source, /master_source_lineage_unresolved/);

  assert.match(
    source,
    /const sourceEvidence = \{[\s\S]*beatId: current\.id,[\s\S]*beatContentHash: sourceContentHash,[\s\S]*vocalRenderIds: \[\] as string\[\],[\s\S]*vocalRenderContentHashes: \[\] as string\[\]/
  );
  assert.match(source, /qualityState: ["']passed["']/);
  assert.match(source, /contentHash: sourceContentHash/);
  assert.match(source, /verifiedAt: sourceVerifiedAt/);
  assert.match(source, /meta: \{ source: sourceEvidence, sourceContentHash \} as never/);
  assert.match(source, /candidateSource\?\.beatId === current\.id/);
  assert.match(source, /candidateSource\.beatContentHash === sourceContentHash/);
  assert.match(source, /candidateSource\.vocalRenderIds\.length === 0/);
  assert.match(source, /candidateSource\.vocalRenderContentHashes\.length === 0/);
  assert.doesNotMatch(source, /meta:\s*current\.meta/, `${name} must not copy arbitrary metadata`);
  assert.doesNotMatch(
    source,
    /sourceEvidence = \{[\s\S]{0,120}type: current\.type/,
    `${name} must write rights-compatible beat lineage, not a generic wrapper receipt`
  );
}

assert.match(writers[0][1], /project: \{ workspaceId \}/);
assert.match(writers[1][1], /project: \{ workspaceId: ctx\.workspaceId \}/);
assert.match(writers[1][1], /const current = currentPlayableAsset\(song\)/);
assert.match(writers[1][1], /if \(!current\)[\s\S]*master_source_not_certified/);

// ---- CERTIFICATION GATES RELEASE, NOT CATALOG OPERATIONS (2026-07-16) ----
// Re-master must PROCEED on an uncertified legacy source (the master pipeline
// is what produces certification — the old 409 was a circular lockout), and
// the lineage must say so honestly instead of fabricating 'passed'.
for (const [name, source] of writers) {
  assert.match(
    source,
    /legacySource/,
    `${name} must route an uncertified current through the legacy-source wrapper`
  );
  assert.match(
    source,
    /['"]unverified-legacy['"]/,
    `${name} must mark legacy master lineage honestly`
  );
  assert.match(
    source,
    /preset: ['"]legacy-source['"]/,
    `${name} must wrap the legacy source in its own honest preset`
  );
  assert.doesNotMatch(
    source,
    /preset: ['"]legacy-source['"],[\s\S]{0,400}qualityState: ['"]passed['"]/,
    `${name} must never stamp an unverified legacy wrapper 'passed'`
  );
}
// Revert ('Make current') is a catalog operation: the blanket 409 that locked
// the whole pre-certification catalog out is gone; the unproven wrapper path
// carries releaseLineageCertified:false instead.
assert.doesNotMatch(writers[0][1], /error: ['"]version_not_certified['"]/);
assert.match(writers[0][1], /revert-source-unproven/);
assert.match(writers[0][1], /releaseLineageCertified: false/);
// The worker accepts ONLY the honestly-marked legacy wrapper on the
// uncertified path — everything else still fails closed — and it certifies
// the actual source bytes at render time.
const workerMaster = readFileSync(
  resolve(repoRoot, "apps/worker/src/processors/master.ts"),
  "utf8"
);
assert.match(workerMaster, /sourceCertification === ['"]unverified-legacy['"]/);
assert.match(workerMaster, /master_source_mix_not_certified/);
assert.match(workerMaster, /certifiedSource = await certifyAudioBytes/);
assert.match(
  workerMaster,
  /legacySource\s*\?\s*\{\}\s*:/,
  "a legacy source must never be dressed up as an attested direct upload"
);

console.log("source mix lineage tests passed");

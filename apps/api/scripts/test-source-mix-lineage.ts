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
    /const sourceEvidence = \{[\s\S]*beatId: current\.id,[\s\S]*beatContentHash: sourceContentHash,[\s\S]*vocalRenderIds: \[\]/
  );
  assert.match(source, /qualityState: ["']passed["']/);
  assert.match(source, /contentHash: sourceContentHash/);
  assert.match(source, /verifiedAt: sourceVerifiedAt/);
  assert.match(source, /meta: \{ source: sourceEvidence, sourceContentHash \} as never/);
  assert.match(source, /candidateSource\?\.beatId === current\.id/);
  assert.match(source, /candidateSource\.beatContentHash === sourceContentHash/);
  assert.match(source, /candidateSource\.vocalRenderIds\.length === 0/);
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

console.log("source mix lineage tests passed");
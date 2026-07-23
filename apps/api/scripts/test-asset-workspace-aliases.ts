import assert from "node:assert/strict";
import {
  allowedAssetWorkspaceIds,
  assetKeyBelongsToAllowedWorkspace,
  mergeAssetWorkspaceAliases,
  parseAssetWorkspaceAliases,
} from "@afrohit/shared";

const merged = mergeAssetWorkspaceAliases(
  JSON.stringify({ anotherStudio: ["anotherStudio", "legacyZ"] }),
  "operatorStudio",
  ["legacyB", "legacyA", "legacyB"]
);

assert.deepEqual(parseAssetWorkspaceAliases(merged), {
  anotherStudio: ["anotherStudio", "legacyZ"],
  operatorStudio: ["legacyA", "legacyB", "operatorStudio"],
});

const operator = allowedAssetWorkspaceIds("operatorStudio", merged);
assert.equal(
  assetKeyBelongsToAllowedWorkspace("operatorStudio/song/master.wav", operator),
  true,
);
assert.equal(
  assetKeyBelongsToAllowedWorkspace("legacyA/song/master.wav", operator),
  true,
);
assert.equal(
  assetKeyBelongsToAllowedWorkspace("unrelated/song/master.wav", operator),
  false,
);

const source = allowedAssetWorkspaceIds("legacyA", merged);
assert.equal(
  assetKeyBelongsToAllowedWorkspace("operatorStudio/song/master.wav", source),
  false,
  "asset aliases are destination-only and must never grant reciprocal access",
);
assert.equal(
  assetKeyBelongsToAllowedWorkspace("legacyA/song/master.wav", source),
  true,
);
assert.deepEqual(parseAssetWorkspaceAliases("not-json"), {});

console.log("asset workspace aliases: destination reads preserved; tenant isolation preserved");

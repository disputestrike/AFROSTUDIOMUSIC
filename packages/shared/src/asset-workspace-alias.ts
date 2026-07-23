/**
 * Physical storage keys retain the workspace prefix they were created under.
 * When an explicit tenant consolidation moves database ownership, the old
 * prefix remains a valid read location for the destination workspace only.
 */
export const ASSET_WORKSPACE_ALIASES_SETTING_KEY =
  "asset.workspace-prefix-aliases.v1";

export type AssetWorkspaceAliasMap = Record<string, string[]>;

function validWorkspaceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function parseAssetWorkspaceAliases(
  raw: string | null | undefined
): AssetWorkspaceAliasMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const aliases: AssetWorkspaceAliasMap = {};
    for (const [workspaceId, values] of Object.entries(parsed)) {
      if (!validWorkspaceId(workspaceId) || !Array.isArray(values)) continue;
      aliases[workspaceId] = [
        ...new Set(values.filter(validWorkspaceId)),
      ].sort();
    }
    return aliases;
  } catch {
    return {};
  }
}

export function mergeAssetWorkspaceAliases(
  raw: string | null | undefined,
  destinationWorkspaceId: string,
  sourceWorkspaceIds: readonly string[]
): string {
  if (!validWorkspaceId(destinationWorkspaceId)) {
    throw new Error("invalid destination workspace id");
  }
  const aliases = parseAssetWorkspaceAliases(raw);
  aliases[destinationWorkspaceId] = [
    ...new Set([
      destinationWorkspaceId,
      ...(aliases[destinationWorkspaceId] ?? []),
      ...sourceWorkspaceIds.filter(validWorkspaceId),
    ]),
  ].sort();
  return JSON.stringify(aliases);
}

export function allowedAssetWorkspaceIds(
  workspaceId: string,
  raw: string | null | undefined
): Set<string> {
  return new Set([
    workspaceId,
    ...(parseAssetWorkspaceAliases(raw)[workspaceId] ?? []),
  ]);
}

export function assetKeyBelongsToAllowedWorkspace(
  key: string,
  allowedWorkspaceIds: ReadonlySet<string>
): boolean {
  const separator = key.indexOf("/");
  if (separator <= 0) return false;
  return allowedWorkspaceIds.has(key.slice(0, separator));
}

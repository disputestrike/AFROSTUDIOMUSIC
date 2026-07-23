import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  ASSET_WORKSPACE_ALIASES_SETTING_KEY,
  allowedAssetWorkspaceIds,
  assetKeyBelongsToAllowedWorkspace,
  parseStorageUri,
} from '@afrohit/shared';
import { prisma } from '@afrohit/db';
import { canonicalAssetRef, presignAssetRef } from '../lib/storage';

const ALIAS_CACHE_MS = 30_000;
let aliasCache: { value: string | null; expiresAt: number } | null = null;

async function readAssetWorkspaceAliases(): Promise<string | null> {
  const now = Date.now();
  if (aliasCache && aliasCache.expiresAt > now) return aliasCache.value;
  const row = await prisma.systemSetting.findUnique({
    where: { key: ASSET_WORKSPACE_ALIASES_SETTING_KEY },
    select: { value: true },
  });
  aliasCache = { value: row?.value ?? null, expiresAt: now + ALIAS_CACHE_MS };
  return aliasCache.value;
}

async function signForWorkspace(
  value: unknown,
  allowedWorkspaceIds: ReadonlySet<string>,
  cache: Map<string, string>,
  property?: string,
): Promise<unknown> {
  if (typeof value === 'string') {
    const canonical = canonicalAssetRef(value);
    if (!canonical) {
      if (value.startsWith('s3://')) {
        throw Object.assign(new Error('foreign_or_invalid_storage_reference'), { statusCode: 403 });
      }
      return value;
    }
    if (property?.endsWith('Ref')) return canonical;
    const location = parseStorageUri(canonical);
    if (!location) return value;
    if (!assetKeyBelongsToAllowedWorkspace(location.key, allowedWorkspaceIds)) {
      throw Object.assign(new Error('cross_workspace_asset'), { statusCode: 403 });
    }
    const cached = cache.get(canonical);
    if (cached) return cached;
    const signed = await presignAssetRef(canonical, 3600);
    cache.set(canonical, signed);
    return signed;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => signForWorkspace(item, allowedWorkspaceIds, cache, property)));
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await signForWorkspace(item, allowedWorkspaceIds, cache, key)] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Database rows keep stable private s3:// references. Authenticated JSON
 * responses receive short-lived read URLs at the last possible moment.
 */
export const privateAssetsPlugin = fp(async function privateAssets(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply, payload) => {
    if (!req.auth || typeof payload !== 'string') return payload;
    const contentType = String(reply.getHeader('content-type') ?? '');
    if (!contentType.includes('application/json')) return payload;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return payload;
    }
    const allowedWorkspaceIds = allowedAssetWorkspaceIds(
      req.auth.workspaceId,
      await readAssetWorkspaceAliases(),
    );
    const signed = await signForWorkspace(parsed, allowedWorkspaceIds, new Map());
    return JSON.stringify(signed);
  });
});

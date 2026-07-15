import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { parseStorageUri } from '@afrohit/shared';
import { canonicalAssetRef, presignAssetRef } from '../lib/storage';

async function signForWorkspace(
  value: unknown,
  workspaceId: string,
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
    if (!location.key.startsWith(`${workspaceId}/`)) {
      throw Object.assign(new Error('cross_workspace_asset'), { statusCode: 403 });
    }
    const cached = cache.get(canonical);
    if (cached) return cached;
    const signed = await presignAssetRef(canonical, 3600);
    cache.set(canonical, signed);
    return signed;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => signForWorkspace(item, workspaceId, cache, property)));
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await signForWorkspace(item, workspaceId, cache, key)] as const),
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
    const signed = await signForWorkspace(parsed, req.auth.workspaceId, new Map());
    return JSON.stringify(signed);
  });
});

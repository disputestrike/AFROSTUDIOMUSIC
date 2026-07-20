import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { prewarmLaneKit } from '../lib/prewarm';

/**
 * ANTICIPATORY PRE-WARM — workspace-level. The Create page fires this (debounced)
 * when a user PICKS a genre, before they click Create, so the lane's own-engine
 * kit is forged/ready by the time they commit. Idempotent per (workspace, genre,
 * UTC day) and $0 (own-kit forge only, never a paid provider hook). Fail-soft:
 * any error returns a benign no-op body — a prewarm must never break the UI.
 */
export default async function prewarm(app: FastifyInstance) {
  app.post<{ Querystring: { genre?: string }; Body: { genre?: string } | undefined }>(
    '/',
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const genre = (req.query?.genre ?? req.body?.genre ?? '').toString();
      if (!genre.trim()) return reply.code(400).send({ error: 'genre_required' });
      try {
        return await prewarmLaneKit(app, workspaceId, genre);
      } catch (err) {
        app.log.warn({ err, genre }, 'lane prewarm failed (non-fatal)');
        // Never surface an error to a speculative optimization.
        return { ok: false as const, warmed: false as const, reason: 'prewarm_unavailable' };
      }
    }
  );
}

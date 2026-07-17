import type { FastifyInstance } from "fastify";

/**
 * PER-WORKSPACE THROTTLE (audit 2026-07-17). The global limiter is per-IP —
 * a proxy pool sails through it, and one workspace can pin the expensive
 * routes (chat/autopilot LLM spend, generation). This bounds a specific
 * action PER WORKSPACE via a Redis counter with a TTL window.
 *
 * FAIL-OPEN by law: if Redis is unavailable the throttle allows the request
 * (consistent with the rate-limiter resilience fix — an abuse guard must
 * never become a single point of failure). The per-request auth + daily cap
 * still bound the blast radius when Redis is gone.
 */
export async function workspaceThrottle(
  app: FastifyInstance,
  opts: { workspaceId: string; action: string; max: number; windowS: number }
): Promise<{ ok: true } | { ok: false; retryInS: number }> {
  const redis = app.rateLimitRedis;
  if (!redis) return { ok: true };
  const key = `wsthrottle:${opts.action}:${opts.workspaceId}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, opts.windowS);
    if (count > opts.max) {
      const ttl = await redis.ttl(key);
      return { ok: false, retryInS: ttl > 0 ? ttl : opts.windowS };
    }
    return { ok: true };
  } catch {
    // Redis blip → fail open. Better briefly-unmetered than a false 429 storm.
    return { ok: true };
  }
}

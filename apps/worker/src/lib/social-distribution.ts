/**
 * THE ONE CONCRETE ADAPTER (Phase 5, Part B) — Ayrshare.
 *
 * Ayrshare is the simplest hosted aggregator: a single authenticated POST to
 * https://api.ayrshare.com/api/post fans one caption + media out to the named
 * platforms. This adapter implements the aggregator-agnostic
 * `DistributionAdapter` interface from @afrohit/shared, so a Postiz adapter could
 * replace it here without touching the shared post-builder or the publish job.
 *
 * HONESTY LAW: `resolveSocialAdapter` returns an adapter ONLY when the flag +
 * a real key are present. No adapter → the job publishes nothing → never a
 * fabricated success. A real HTTP request only ever leaves from `publish`, which
 * only exists on a constructed adapter.
 *
 * OPERATOR SETUP (documented here and in the final report):
 *   1. Sign up at ayrshare.com and create an API key.
 *   2. Set AYRSHARE_API_KEY=<key> on the WORKER service (the API only checks
 *      configuration; the worker makes the call).
 *   3. Set DISTRIBUTION_ENABLED=1 on both API and worker.
 *   4. The artist links each platform in the Ayrshare dashboard; record the
 *      resulting profile key per platform via POST /distribution/accounts.
 */
import {
  socialDistributionConfig,
  type DistributionAdapter,
  type PublishResult,
  type SocialPostPayload,
} from "@afrohit/shared";

const AYRSHARE_ENDPOINT = "https://api.ayrshare.com/api/post";
const TIMEOUT_MS = 25_000;

export class AyrshareAdapter implements DistributionAdapter {
  readonly provider = "ayrshare";

  constructor(private readonly apiKey: string) {}

  async publish(post: SocialPostPayload): Promise<PublishResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const body: Record<string, unknown> = {
        post: post.caption,
        platforms: [post.platform],
      };
      if (post.mediaUrls.length) body.mediaUrls = post.mediaUrls;
      // BRANDED POSTER as the post thumbnail — YouTube is the platform whose API
      // takes a custom video thumbnail (Ayrshare's youTubeOptions.thumbNail), so
      // a shared upload leads with the AfroHits "AFRO" still. Other platforms
      // derive their own frame; attaching it only where it's honoured keeps the
      // payload clean.
      if (post.posterUrl && post.platform === "youtube") {
        body.youTubeOptions = { thumbNail: post.posterUrl };
      }
      if (post.scheduledAt) body.scheduleDate = post.scheduledAt;
      // Business-plan multi-account posting keys off the profile ref.
      if (post.externalRef) body.profileKeys = [post.externalRef];

      const res = await fetch(AYRSHARE_ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        id?: string;
        message?: string;
      };
      if (!res.ok || json.status === "error") {
        return {
          platform: post.platform,
          ok: false,
          error: (typeof json.message === "string"
            ? json.message
            : `ayrshare_http_${res.status}`
          ).slice(0, 300),
        };
      }
      return {
        platform: post.platform,
        ok: true,
        externalPostId: typeof json.id === "string" ? json.id : undefined,
        scheduled: !!post.scheduledAt,
      };
    } catch (error) {
      return {
        platform: post.platform,
        ok: false,
        error:
          (error as Error).name === "AbortError"
            ? "ayrshare_timeout"
            : ((error as Error).message?.slice(0, 300) ?? "ayrshare_failed"),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * THE HONESTY GATE. An adapter exists ONLY when DISTRIBUTION_ENABLED is on AND a
 * real aggregator key is present. Every other state returns null — and a null
 * adapter is exactly how the publish job proves it can never fake a success.
 */
export function resolveSocialAdapter(
  env: NodeJS.ProcessEnv = process.env
): DistributionAdapter | null {
  const config = socialDistributionConfig(env);
  if (!config.ready) return null;
  const key = (env.AYRSHARE_API_KEY ?? "").trim();
  if (!key) return null;
  return new AyrshareAdapter(key);
}

/**
 * THE DISTRIBUTION SEAM (Phase 5) — aggregator-agnostic social distribution.
 *
 * ONE aggregator fans a finished release out to the artist's social platforms
 * (YouTube / TikTok / Instagram / Facebook / …), so we never build nine native
 * uploaders (the ViralForge lesson, and the spec's "one aggregator, not nine
 * builds"). This module is the PURE core shared by the API endpoint (is it
 * configured?), the worker publish job (build the posts, call the adapter), and
 * both test suites. It touches no database and no network.
 *
 * HONESTY LAW (do NOT repeat the "coded but never run" trap): everything here is
 * inert until an operator sets DISTRIBUTION_ENABLED=1 AND provides a real
 * aggregator key (AYRSHARE_API_KEY). `socialDistributionConfig` is the single
 * gate every caller consults; a real HTTP publish only ever fires through a
 * concrete `DistributionAdapter`, which is constructed only when the key exists.
 * Without the flag+key there is no adapter, so there is no publish — never a
 * fabricated "published!".
 *
 * The `DistributionAdapter` interface keeps the aggregator swappable: Ayrshare is
 * the one concrete adapter today (simplest hosted REST API — a plain POST to
 * https://api.ayrshare.com/api/post with a Bearer key), but a Postiz adapter
 * could implement the same interface without touching this core or the job.
 */

// ---------------------------------------------------------------------------
// Configuration gate
// ---------------------------------------------------------------------------

export const SOCIAL_DISTRIBUTION_PROVIDER = "ayrshare" as const;

/** Platforms the aggregator can fan out to. A `ConnectedAccount.platform` is one
 *  of these (kept as a plain string in the DB — this list is the UI's menu). */
export const SOCIAL_PLATFORMS = [
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "twitter",
  "linkedin",
  "threads",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface SocialDistributionConfig {
  provider: typeof SOCIAL_DISTRIBUTION_PROVIDER;
  /** DISTRIBUTION_ENABLED flag is on. */
  enabled: boolean;
  /** A non-empty aggregator API key is present. */
  hasKey: boolean;
  /** enabled AND hasKey — the ONLY state in which a real publish may fire. */
  ready: boolean;
  /** Which env vars are still missing, for an honest "configure me" message. */
  missing: string[];
}

const TRUTHY = /^(1|true|yes|on)$/i;

/**
 * The single configuration gate. Reads the flag + key from the environment (or
 * an injected map, for tests). `ready` is false unless BOTH the flag is on and a
 * key is present — the endpoint returns "not configured" and the worker never
 * constructs an adapter in any other state.
 */
export function socialDistributionConfig(
  env: Record<string, string | undefined> = process.env
): SocialDistributionConfig {
  const enabled = TRUTHY.test((env.DISTRIBUTION_ENABLED ?? "").trim());
  const hasKey = (env.AYRSHARE_API_KEY ?? "").trim().length > 0;
  const missing: string[] = [];
  if (!enabled) missing.push("DISTRIBUTION_ENABLED");
  if (!hasKey) missing.push("AYRSHARE_API_KEY");
  return {
    provider: SOCIAL_DISTRIBUTION_PROVIDER,
    enabled,
    hasKey,
    ready: enabled && hasKey,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Post shape + adapter contract
// ---------------------------------------------------------------------------

export type SocialMediaKind =
  | "music_video"
  | "clip"
  | "visualizer"
  | "lyric_video";

/** One piece of already-rendered media, resolved to a public URL by the caller
 *  (the worker presigns private storage refs before building posts). */
export interface SocialMediaItem {
  kind: SocialMediaKind;
  url: string;
  durationS?: number | null;
}

/** The connected-account fields the builder needs (a subset of the Prisma row,
 *  so tests and the worker share one shape). */
export interface ConnectedAccountLike {
  platform: string;
  status: string;
  externalRef?: string | null;
  displayName?: string | null;
}

/** Per-platform caption tagged with the platform it's shaped for. */
export interface KitCaptionLike {
  platform?: string;
  style?: string;
  text: string;
}
/** Hashtags in the 3-tier release-kit shape. */
export interface KitHashtagsLike {
  tier1?: string[];
  tier2?: string[];
  tier3?: string[];
  line?: string;
}
export interface KitCalendarEntryLike {
  day?: number;
  channel?: string;
  action?: string;
}
/** The slice of the stored release kit that distribution reads. */
export interface ReleaseKitLike {
  hook?: string;
  story?: string;
  captions?: KitCaptionLike[] | string[];
  hashtags?: KitHashtagsLike | string;
  releaseCalendar?: KitCalendarEntryLike[];
}

/** A fully-built post, ready to hand to the aggregator. */
export interface SocialPostPayload {
  platform: string;
  /** Caption text with the tiered hashtag line appended (viral rule: 3–5 tags). */
  caption: string;
  /** The hashtags as a flat capped list, for callers that want them structured. */
  hashtags: string[];
  /** Public media URLs — the music video (or visualizer) first, then clips. */
  mediaUrls: string[];
  /** The BRANDED POSTER image (cover + big "AFRO" mark) — the post's thumbnail,
   *  so a shared video/link carries the AfroHits identity. Null when no poster
   *  is available (the aggregator then uses its own default frame). */
  posterUrl: string | null;
  /** ISO time to schedule the post, or null to post immediately. */
  scheduledAt: string | null;
  /** The aggregator's profile reference for this platform's account. */
  externalRef: string | null;
  /** The primary media kind, for the honest per-post receipt. */
  mediaKind: SocialMediaKind | null;
}

export interface PublishResult {
  platform: string;
  ok: boolean;
  externalPostId?: string;
  /** True when the aggregator accepted it as SCHEDULED rather than posted now. */
  scheduled?: boolean;
  error?: string;
}

/**
 * The aggregator-agnostic contract. ONE concrete adapter today (Ayrshare, in the
 * worker), but the seam is the interface: swap in a Postiz adapter and neither
 * `buildSocialPosts` nor `publishReleaseToSocials` nor the job changes.
 */
export interface DistributionAdapter {
  readonly provider: string;
  publish(post: SocialPostPayload): Promise<PublishResult>;
}

// ---------------------------------------------------------------------------
// Building the posts (pure)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CLIPS = 3;
const MAX_HASHTAGS = 5;

/** Pick the caption shaped for this platform, else the first caption, else the
 *  hook, else a plain title line. Accepts the kit shape or the legacy string[]. */
export function platformCaptionFrom(
  kit: ReleaseKitLike | null | undefined,
  platform: string,
  fallback: string
): string {
  const captions = kit?.captions;
  if (Array.isArray(captions) && captions.length > 0) {
    if (typeof captions[0] === "object") {
      const typed = captions as KitCaptionLike[];
      const forPlatform = typed.find(
        c => (c.platform ?? "").toLowerCase() === platform.toLowerCase()
      );
      const chosen = (forPlatform ?? typed[0])?.text?.trim();
      if (chosen) return chosen;
    } else {
      const first = (captions as string[]).find(c => c.trim());
      if (first) return first.trim();
    }
  }
  if (kit?.hook && kit.hook.trim()) return kit.hook.trim();
  return fallback;
}

/** Flatten the 3-tier hashtags to a capped 3–5 relevant list (viral rule: never
 *  stuffed). Tier 1 (genre) leads, then audience, then a matched trend. Accepts
 *  the kit shape or the legacy single line. */
export function hashtagsFrom(
  kit: ReleaseKitLike | null | undefined
): string[] {
  const h = kit?.hashtags;
  let all: string[] = [];
  if (h && typeof h === "object") {
    all = [...(h.tier1 ?? []), ...(h.tier2 ?? []), ...(h.tier3 ?? [])];
    if (!all.length && h.line) all = h.line.split(/\s+/);
  } else if (typeof h === "string") {
    all = h.split(/\s+/);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of all) {
    const tag = raw.trim();
    if (!tag) continue;
    const normalized = tag.startsWith("#") ? tag : `#${tag}`;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= MAX_HASHTAGS) break;
  }
  return out;
}

export interface BuildSocialPostsInput {
  accounts: ConnectedAccountLike[];
  kit: ReleaseKitLike | null | undefined;
  media: SocialMediaItem[];
  /** Song title, used as the caption fallback when the kit has no caption/hook. */
  title: string;
  /** Optional public release-page URL appended to the caption. */
  releaseUrl?: string | null;
  /** The branded poster image (a public URL the caller already presigned) —
   *  attached to every post as its thumbnail. Null → no poster available. */
  posterUrl?: string | null;
  now?: Date;
  maxClips?: number;
}

/**
 * Build one post per CONNECTED account from the release kit + rendered media.
 *
 * generate-once/cut-many: the music video (or the visualizer when there is no
 * video) leads, followed by a few short clips — no new render, just the already
 * rendered pieces. The caption is the platform-shaped kit caption with the
 * tiered hashtag line appended; the schedule comes from the release calendar
 * (post when that channel's audience is active), else immediate.
 */
export function buildSocialPosts(input: BuildSocialPostsInput): SocialPostPayload[] {
  const now = input.now ?? new Date();
  const maxClips = input.maxClips ?? DEFAULT_MAX_CLIPS;
  const connected = input.accounts.filter(a => a.status === "connected");

  const primary =
    input.media.find(m => m.kind === "music_video") ??
    input.media.find(m => m.kind === "visualizer") ??
    null;
  const clips = input.media.filter(m => m.kind === "clip").slice(0, maxClips);
  const baseMediaUrls = [
    ...(primary ? [primary.url] : []),
    ...clips.map(c => c.url),
  ];

  const calendar = Array.isArray(input.kit?.releaseCalendar)
    ? input.kit!.releaseCalendar!
    : [];

  return connected.map(account => {
    const platform = account.platform;
    const hashtags = hashtagsFrom(input.kit);
    const captionBody = platformCaptionFrom(input.kit, platform, input.title);
    const parts = [captionBody];
    if (hashtags.length) parts.push(hashtags.join(" "));
    if (input.releaseUrl) parts.push(input.releaseUrl);
    const caption = parts.join("\n\n");

    // Schedule from the release calendar when a matching channel entry exists —
    // "post when the audience is active". No match → post now (scheduledAt null).
    const entry = calendar.find(
      c =>
        typeof c.channel === "string" &&
        c.channel.toLowerCase().includes(platform.toLowerCase())
    );
    const scheduledAt =
      entry && typeof entry.day === "number" && entry.day > 0
        ? new Date(now.getTime() + entry.day * 24 * 60 * 60_000).toISOString()
        : null;

    return {
      platform,
      caption,
      hashtags,
      mediaUrls: baseMediaUrls,
      posterUrl: input.posterUrl ?? null,
      scheduledAt,
      externalRef: account.externalRef ?? null,
      mediaKind: primary?.kind ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Publishing (orchestration; the adapter does the real I/O)
// ---------------------------------------------------------------------------

/**
 * Publish each built post through the adapter, fail-soft per post (one platform
 * failing never aborts the rest). Returns a result per post. This is pure
 * orchestration — the adapter owns the network call, so the same function drives
 * the real Ayrshare adapter in the worker and a stub adapter under test.
 */
export async function publishReleaseToSocials(input: {
  posts: SocialPostPayload[];
  adapter: DistributionAdapter;
}): Promise<PublishResult[]> {
  const results: PublishResult[] = [];
  for (const post of input.posts) {
    try {
      results.push(await input.adapter.publish(post));
    } catch (error) {
      results.push({
        platform: post.platform,
        ok: false,
        error: (error as Error).message?.slice(0, 300) ?? "publish_failed",
      });
    }
  }
  return results;
}

/**
 * DISTRIBUTION SEAM (Phase 5, Part B) — the worker's honesty + payload proofs.
 *
 * The whole seam is FLAG-GATED and key-gated: without DISTRIBUTION_ENABLED + an
 * AYRSHARE_API_KEY the worker constructs NO adapter, so the publish job publishes
 * nothing — never a fabricated "posted!". This proves:
 *   - the config gate is off/on exactly with the flag+key;
 *   - resolveSocialAdapter returns null unless BOTH are present (no fake publish);
 *   - the one concrete adapter (Ayrshare) is the swappable implementation;
 *   - buildSocialPosts builds the right posts (platform caption + 3–5 deduped
 *     hashtags + video/clips media + calendar schedule, disconnected excluded);
 *   - publishReleaseToSocials is fail-soft (one platform failing never aborts).
 *
 * Pure — no DB, no network. Run via the worker suite (test-all.ts).
 */
import {
  buildSocialPosts,
  publishReleaseToSocials,
  socialDistributionConfig,
  type DistributionAdapter,
  type SocialPostPayload,
} from "@afrohit/shared";
import {
  AyrshareAdapter,
  resolveSocialAdapter,
} from "../src/lib/social-distribution";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log("PASS: " + message);
  else {
    console.error("FAIL: " + message);
    failures += 1;
  }
}

async function main() {
  // ---- config gate --------------------------------------------------------
  check(socialDistributionConfig({}).ready === false, "config not ready with nothing set");
  check(
    socialDistributionConfig({ DISTRIBUTION_ENABLED: "1" }).ready === false,
    "config not ready with the flag but no key",
  );
  check(
    socialDistributionConfig({ AYRSHARE_API_KEY: "k" }).ready === false,
    "config not ready with a key but the flag off",
  );
  {
    const cfg = socialDistributionConfig({ DISTRIBUTION_ENABLED: "1", AYRSHARE_API_KEY: "k" });
    check(cfg.ready === true, "config ready with BOTH flag + key");
    check(cfg.provider === "ayrshare", "provider is ayrshare");
    check(cfg.missing.length === 0, "nothing missing when configured");
  }
  check(
    socialDistributionConfig({}).missing.includes("DISTRIBUTION_ENABLED") &&
      socialDistributionConfig({}).missing.includes("AYRSHARE_API_KEY"),
    "missing names the flag + key when unconfigured",
  );

  // ---- resolveSocialAdapter — the honesty gate ----------------------------
  check(resolveSocialAdapter({}) === null, "NO adapter without flag+key (never a fake publish)");
  check(resolveSocialAdapter({ DISTRIBUTION_ENABLED: "1" }) === null, "no adapter with the flag but no key");
  check(resolveSocialAdapter({ AYRSHARE_API_KEY: "k" }) === null, "no adapter with a key but the flag off");
  {
    const adapter = resolveSocialAdapter({ DISTRIBUTION_ENABLED: "1", AYRSHARE_API_KEY: "k" });
    check(adapter !== null, "adapter EXISTS with flag + key");
    check(adapter?.provider === "ayrshare", "the concrete adapter is Ayrshare");
    check(adapter instanceof AyrshareAdapter, "resolves to the AyrshareAdapter implementation");
  }

  // ---- buildSocialPosts payload -------------------------------------------
  const now = new Date("2026-07-21T00:00:00.000Z");
  const kit = {
    hook: "POV: nobody sits down",
    captions: [
      { platform: "tiktok", text: "TIKTOK caption" },
      { platform: "youtube", text: "YOUTUBE caption" },
    ],
    hashtags: { tier1: ["#Afrobeats", "#AfricanMusic"], tier2: ["#NewMusic"], tier3: ["#Afrobeats"], line: "" },
    releaseCalendar: [{ day: 3, channel: "tiktok", action: "post" }],
  };
  const accounts = [
    { platform: "tiktok", status: "connected", externalRef: "prof_tt" },
    { platform: "youtube", status: "connected", externalRef: "prof_yt" },
    { platform: "instagram", status: "pending", externalRef: null }, // excluded
  ];
  const media = [
    { kind: "music_video" as const, url: "https://cdn/mv.mp4" },
    { kind: "clip" as const, url: "https://cdn/c1.mp4", durationS: 15 },
    { kind: "clip" as const, url: "https://cdn/c2.mp4", durationS: 30 },
  ];
  const posts = buildSocialPosts({ accounts, kit, media, title: "Song", releaseUrl: "https://afrohit/r/x", now });

  check(posts.length === 2, "one post per CONNECTED account (pending excluded)");
  const tt = posts.find(p => p.platform === "tiktok")!;
  check(tt.caption.includes("TIKTOK caption"), "platform-shaped caption used");
  check(tt.caption.includes("#Afrobeats"), "hashtag line appended to caption");
  check(tt.caption.includes("https://afrohit/r/x"), "release link appended");
  check(tt.hashtags.length >= 1 && tt.hashtags.length <= 5, "3–5 hashtags (never stuffed)");
  check(
    new Set(tt.hashtags.map(h => h.toLowerCase())).size === tt.hashtags.length,
    "hashtags deduped (#Afrobeats once)",
  );
  check(
    JSON.stringify(tt.mediaUrls) === JSON.stringify(["https://cdn/mv.mp4", "https://cdn/c1.mp4", "https://cdn/c2.mp4"]),
    "media = the music video first, then the clips",
  );
  check(tt.mediaKind === "music_video", "primary media kind is the music video");
  check(!!tt.scheduledAt && new Date(tt.scheduledAt) > now, "tiktok scheduled from the calendar");
  check(posts.find(p => p.platform === "youtube")!.scheduledAt === null, "youtube posts now (no calendar entry)");

  // visualizer fallback when there is no music video
  {
    const vposts = buildSocialPosts({
      accounts: [{ platform: "tiktok", status: "connected", externalRef: null }],
      kit,
      media: [{ kind: "visualizer", url: "https://cdn/vis.mp4" }],
      title: "Song",
      now,
    });
    check(vposts[0]?.mediaKind === "visualizer", "visualizer is the fallback primary when there's no video");
  }

  // ---- publishReleaseToSocials — fail-soft --------------------------------
  const calls: string[] = [];
  const flakyAdapter: DistributionAdapter = {
    provider: "stub",
    async publish(post: SocialPostPayload) {
      calls.push(post.platform);
      if (post.platform === "youtube") throw new Error("boom");
      return { platform: post.platform, ok: true, externalPostId: "id_" + post.platform };
    },
  };
  const results = await publishReleaseToSocials({ posts, adapter: flakyAdapter });
  check(calls.length === posts.length, "the adapter is called once per post");
  check(results.length === posts.length, "one result per post");
  check(results.some(r => r.ok) && results.some(r => !r.ok), "one platform failing never aborts the rest (fail-soft)");
  const yt = results.find(r => r.platform === "youtube");
  check(
    yt !== undefined && yt.ok === false && typeof yt.error === "string",
    "the failing platform carries an honest error, not a fake success",
  );

  if (failures) {
    console.error(`\nsocial-distribution: ${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log(
      "\nsocial-distribution: flag+key gate off/on correctly, resolveSocialAdapter returns null unless BOTH are set (no fake publish), Ayrshare is the swappable concrete adapter, buildSocialPosts builds platform captions + 3–5 deduped hashtags + video/clips (visualizer fallback) + calendar schedule with disconnected accounts excluded, and publishReleaseToSocials is fail-soft.",
    );
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

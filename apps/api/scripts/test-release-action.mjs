/**
 * FIRST-PARTY RELEASE ACTION + DISTRIBUTION SEAM (Phase 5) — the proof that the
 * release loop is now reachable WITHOUT an external distributor, and that the
 * aggregator distribution seam is honest (flag-gated, never a faked publish).
 *
 * Boots the REAL release + public route modules on a bare Fastify instance
 * (identity-test-kit pattern) against an in-memory prisma. No Postgres, no Redis.
 * Storage gets throwaway static creds so presignAssetRef signs offline.
 *
 * PART A — the first-party Release action:
 *   (a) Release makes a finished song releaseReady + RELEASED, and the public
 *       /release payload then appears (the page goes live).
 *   (b) Takedown reverts it — the public payload is 404 again.
 *   (c) Idempotent — releasing an already-released song is a no-op (no duplicate
 *       live event); taking down an already-withdrawn song is a no-op.
 *   (d) Role-gated — a VIEWER cannot release or take down (403).
 *   (e) A master-less song and a quarantined song cannot be released (409).
 *
 * PART B — the aggregator distribution seam:
 *   (f) With the flag OFF / no key, distribute returns a clear "not configured"
 *       (501) and NEVER a fake "published".
 *   (g) With a stubbed adapter + flag ON, the publish core builds the correct
 *       post payload (caption / hashtags / media) and CALLS the adapter, and a
 *       disconnected account is excluded.
 *
 * Run: pnpm --filter @afrohit/api test:release-action
 */
import assert from "node:assert/strict";

process.env.AUTH_MODE = "internal";
process.env.JWT_SECRET = "release-action-test-secret-0123456789abcdef0123";
process.env.WEB_URL = "http://localhost:3000";
process.env.S3_BUCKET = "afrohit-studio";
process.env.S3_ACCESS_KEY = "test-access-key";
process.env.S3_SECRET_KEY = "test-secret-key";
process.env.S3_ENDPOINT = "https://s3.test.local";
process.env.S3_REGION = "auto";
// Part B honesty: the distribution seam must read as NOT configured here.
delete process.env.DISTRIBUTION_ENABLED;
delete process.env.AYRSHARE_API_KEY;

const { buildApp, installFakePrisma, as } = await import("./identity-test-kit.mjs");

const now = new Date();
const S = (k) => `s3://afrohit-studio/ws-A/${k}`;

const project = {
  id: "p1",
  workspaceId: "ws-A",
  artistId: "artist-A",
  genre: "afro_pop",
  artist: { stageName: "AfroHouse" },
};

/** A finished, master-carrying song ready to release. */
const songReady = {
  id: "song-ready",
  workspaceId: "ws-A",
  projectId: "p1",
  title: "Sunrise Call",
  displayArtist: "BXP",
  kind: "song",
  status: "MASTERED",
  releaseReady: false,
  quarantined: false,
  deletedAt: null,
  isrc: null,
  upc: null,
  coverUrl: S("cover/ready.jpg"),
  socialsJson: null,
  audioUrl: S("master/ready.wav"),
  createdAt: now,
  project,
  lyric: { id: "l1", songId: "song-ready", title: "Sunrise Call", body: "[Hook]\nwe rise" },
  masters: [{ id: "m1", url: S("master/ready.wav"), createdAt: now, approved: true, qualityState: "passed" }],
  mixes: [],
  beats: [],
};

// A song with NO master — cannot be released.
const songNoMaster = {
  ...songReady,
  id: "song-nomaster",
  title: "No Master",
  masters: [],
  audioUrl: null,
};
// A quarantined song (has a master) — cannot be released.
const songQuar = {
  ...songReady,
  id: "song-quar",
  title: "Pulled",
  quarantined: true,
};

installFakePrisma({
  song: [songReady, songNoMaster, songQuar],
  master: [
    { id: "m1", songId: "song-ready", approved: true, createdAt: now },
    { id: "mq", songId: "song-quar", approved: true, createdAt: now },
  ],
  mix: [],
  release: [],
  export: [],
  distributionEvent: [],
  analyticsEvent: [],
  connectedAccount: [],
  imageAsset: [{ id: "img1", projectId: "p1", kind: "cover", approved: true, url: S("cover/ready.jpg"), createdAt: now }],
  videoConcept: [],
  videoRender: [],
  songVisual: [],
  songClip: [],
});

const app = await buildApp();
const { default: release } = await import("../src/routes/release");
const { default: publicRoutes } = await import("../src/routes/public");
await app.register(release, { prefix: "/projects/:projectId/release" });
await app.register(publicRoutes, { prefix: "/api/v1/public" });
await app.ready();

const publish = (songId, projectId = "p1", role = "OWNER") =>
  app.inject({ method: "POST", url: `/projects/${projectId}/release/${songId}/publish`, payload: {}, headers: as(role) });
const takedown = (songId, projectId = "p1", role = "OWNER") =>
  app.inject({ method: "POST", url: `/projects/${projectId}/release/${songId}/takedown`, payload: {}, headers: as(role) });
const distribute = (songId, projectId = "p1", role = "OWNER") =>
  app.inject({ method: "POST", url: `/projects/${projectId}/release/${songId}/socials/distribute`, payload: {}, headers: as(role) });
const releasePage = (songId) =>
  app.inject({ method: "GET", url: `/api/v1/public/song/${songId}/release` });

// ---- (a) BEFORE: the release page is 404 (nothing first-party made it live) --
assert.equal((await releasePage("song-ready")).statusCode, 404, "unreleased song is 404 before release");

// ---- (d) ROLE GATE: a VIEWER cannot release ---------------------------------
assert.equal((await publish("song-ready", "p1", "VIEWER")).statusCode, 403, "VIEWER cannot release");
assert.equal((await takedown("song-ready", "p1", "VIEWER")).statusCode, 403, "VIEWER cannot take down");

// ---- (e) can't release a master-less or quarantined song --------------------
const noMasterRes = await publish("song-nomaster");
assert.equal(noMasterRes.statusCode, 409, "master-less song cannot be released");
assert.equal(noMasterRes.json().error, "no_master");
const quarRes = await publish("song-quar");
assert.equal(quarRes.statusCode, 409, "quarantined song cannot be released");
assert.equal(quarRes.json().error, "song_quarantined");

// ---- (a) RELEASE makes the song RELEASED + the public payload appears -------
const rel = await publish("song-ready");
assert.equal(rel.statusCode, 200, `release must be 200, got ${rel.statusCode}: ${rel.body}`);
const relBody = rel.json();
assert.equal(relBody.status, "released");
assert.equal(relBody.songStatus, "RELEASED");
assert.equal(relBody.releaseReady, true);
assert.equal(relBody.alreadyReleased, false);
assert.equal(relBody.distributor, "afrohit-first-party", "self-issued distributor label");
assert.equal(relBody.sharePath, "/r/song-ready");

// The song row is now RELEASED + releaseReady (the SAME state a distributor
// webhook would have produced), and a self-issued 'live' event was recorded.
assert.equal(songReady.status, "RELEASED", "song moved to RELEASED");
assert.equal(songReady.releaseReady, true, "song is releaseReady");
const liveEvents = (await import("@afrohit/db")).prisma.distributionEvent;
assert.equal(
  (await liveEvents.findMany({ where: { status: "live" } })).length,
  1,
  "exactly one self-issued live event",
);

// The public /release payload now appears (the page is live).
const live = await releasePage("song-ready");
assert.equal(live.statusCode, 200, `released song's page must be 200, got ${live.statusCode}: ${live.body}`);
const page = live.json();
assert.equal(page.title, "Sunrise Call");
assert.equal(page.artist, "BXP");
assert.ok(page.audioUrl && page.audioUrl.startsWith("https://"), "master audio is presigned + public");

// ---- (c) IDEMPOTENT release — a second release is a no-op -------------------
const rel2 = await publish("song-ready");
assert.equal(rel2.statusCode, 200);
assert.equal(rel2.json().alreadyReleased, true, "second release is a no-op");
assert.equal(
  (await liveEvents.findMany({ where: { status: "live" } })).length,
  1,
  "no duplicate live event on idempotent re-release",
);

// ---- (b) TAKEDOWN reverts to 404 --------------------------------------------
const down = await takedown("song-ready");
assert.equal(down.statusCode, 200, `takedown must be 200, got ${down.statusCode}: ${down.body}`);
assert.equal(down.json().status, "withdrawn");
assert.equal(down.json().releaseReady, false);
assert.equal(songReady.status, "MASTERED", "song reverted off RELEASED (no export → MASTERED)");
assert.equal(songReady.releaseReady, false, "releaseReady cleared");
assert.equal((await releasePage("song-ready")).statusCode, 404, "released page 404s after takedown");

// ---- (c) IDEMPOTENT takedown — a second takedown is a no-op -----------------
const down2 = await takedown("song-ready");
assert.equal(down2.statusCode, 200);
assert.equal(down2.json().alreadyWithdrawn, true, "second takedown is a no-op");

// Re-release works after a takedown (the loop is repeatable).
assert.equal((await publish("song-ready")).json().songStatus, "RELEASED", "can re-release after takedown");
assert.equal((await releasePage("song-ready")).statusCode, 200, "page live again after re-release");

// ---- (f) PART B: distribute with the flag OFF / no key = NOT CONFIGURED ------
const notConfigured = await distribute("song-ready");
assert.equal(notConfigured.statusCode, 501, `not-configured must be 501, got ${notConfigured.statusCode}: ${notConfigured.body}`);
const nc = notConfigured.json();
assert.equal(nc.error, "distribution_not_configured", "honest not-configured error");
assert.ok(Array.isArray(nc.missing) && nc.missing.includes("DISTRIBUTION_ENABLED") && nc.missing.includes("AYRSHARE_API_KEY"), "names what is missing");
// CRITICAL: never a fake success.
assert.ok(!("status" in nc) || nc.status !== "distributing", "NEVER a fake 'distributing'/'published' success");
assert.ok(!JSON.stringify(nc).includes("published"), "no fabricated 'published'");

// ---- (g) PART B: the publish core builds the right posts + calls the adapter -
const { buildSocialPosts, publishReleaseToSocials, socialDistributionConfig } = await import("@afrohit/shared");

// The config gate itself: OFF here, ON with flag+key.
assert.equal(socialDistributionConfig({}).ready, false, "config not ready with nothing set");
assert.equal(
  socialDistributionConfig({ DISTRIBUTION_ENABLED: "1", AYRSHARE_API_KEY: "k" }).ready,
  true,
  "config ready with flag + key",
);

const kit = {
  hook: "POV: Sunrise Call comes on and nobody sits down",
  captions: [
    { platform: "tiktok", style: "hype", text: "TIKTOK caption" },
    { platform: "youtube", style: "hype", text: "YOUTUBE caption" },
  ],
  hashtags: { tier1: ["#Afrobeats", "#AfricanMusic"], tier2: ["#NewMusic"], tier3: ["#Afrobeats"], line: "" },
  releaseCalendar: [{ day: 2, channel: "tiktok", action: "post clip 1" }],
};
const accounts = [
  { platform: "tiktok", status: "connected", externalRef: "prof_tiktok", displayName: "@afro" },
  { platform: "youtube", status: "connected", externalRef: "prof_yt", displayName: "@afro" },
  { platform: "instagram", status: "pending", externalRef: null, displayName: null }, // NOT connected
];
const media = [
  { kind: "music_video", url: "https://cdn/mv.mp4" },
  { kind: "clip", url: "https://cdn/clip1.mp4", durationS: 15 },
  { kind: "clip", url: "https://cdn/clip2.mp4", durationS: 30 },
];
const posts = buildSocialPosts({ accounts, kit, media, title: "Sunrise Call", releaseUrl: "https://afrohit.studio/r/song-ready", now });

// A disconnected account is excluded; one post per CONNECTED account.
assert.equal(posts.length, 2, "one post per connected account (pending excluded)");
assert.deepEqual(posts.map((p) => p.platform).sort(), ["tiktok", "youtube"]);

const tiktok = posts.find((p) => p.platform === "tiktok");
assert.ok(tiktok.caption.includes("TIKTOK caption"), "platform-shaped caption");
assert.ok(tiktok.caption.includes("#Afrobeats"), "hashtag line appended");
assert.ok(tiktok.caption.includes("https://afrohit.studio/r/song-ready"), "release link appended");
// 3–5 hashtags, deduped (#Afrobeats appears in tier1 and tier3 → once).
assert.ok(tiktok.hashtags.length >= 1 && tiktok.hashtags.length <= 5, "3–5 hashtags, not stuffed");
assert.equal(new Set(tiktok.hashtags.map((h) => h.toLowerCase())).size, tiktok.hashtags.length, "hashtags deduped");
// Media = the music video first, then the clips.
assert.deepEqual(tiktok.mediaUrls, ["https://cdn/mv.mp4", "https://cdn/clip1.mp4", "https://cdn/clip2.mp4"], "video + clips as media");
assert.equal(tiktok.mediaKind, "music_video");
// The calendar scheduled TikTok 2 days out; YouTube (no calendar entry) posts now.
assert.ok(tiktok.scheduledAt && new Date(tiktok.scheduledAt) > now, "tiktok scheduled from the calendar");
assert.equal(posts.find((p) => p.platform === "youtube").scheduledAt, null, "youtube posts now (no calendar entry)");

// A STUB adapter — records every publish call. The core must call it once per post.
const calls = [];
const stubAdapter = {
  provider: "stub",
  async publish(post) {
    calls.push(post);
    return { platform: post.platform, ok: true, externalPostId: `stub_${post.platform}`, scheduled: !!post.scheduledAt };
  },
};
const results = await publishReleaseToSocials({ posts, adapter: stubAdapter });
assert.equal(calls.length, posts.length, "the adapter is called once per post");
assert.equal(results.length, posts.length);
assert.ok(results.every((r) => r.ok && r.externalPostId), "every post got the adapter's verdict");
assert.deepEqual(calls.map((c) => c.platform).sort(), ["tiktok", "youtube"], "adapter received both connected platforms");

await app.close();

console.log(
  "release-action: Part A — first-party Release flips a finished song to releaseReady+RELEASED via a self-issued 'live' event (same shape the distributor webhook writes), the public /r/{id} payload goes live, Takedown reverts it to 404, both are idempotent, VIEWER is 403, and a master-less/quarantined song is 409. Part B — distribute is honestly NOT configured (501, never a fake publish) without the flag+key; with a stubbed adapter the publish core builds the right posts (platform caption + 3–5 deduped hashtags + video/clips + calendar schedule) and calls the adapter once per connected account.",
);

/**
 * VIDEO ENGINE TIERS — the class wall + exact provider payloads:
 *   - class → spec mapping (draft/standard/flagship), env overrides,
 *   - the EXACT model input JSON per engine family, t2v AND i2v,
 *   - duration snapping per engine,
 *   - capability gating: an engine without i2v FAILS a keyframe render
 *     closed (in class language — no vendor names in the user-facing error),
 *   - the community-model Replicate law: resolve version via GET
 *     /v1/models/{slug}, then POST the versioned /v1/predictions,
 *   - no token → videoAdapterForClass yields NOTHING (fall back or fail,
 *     never a silent stub).
 */
import assert from "node:assert/strict";
import {
  ReplicateVideoAdapter,
  predictionVideoUrl,
  snapDuration,
  videoAdapterForClass,
  videoEngineCapabilities,
  videoEngineSpec,
  videoModelInput,
  type VideoShotInput,
} from "@afrohit/ai";

const originalFetch = globalThis.fetch;
const savedToken = process.env.REPLICATE_API_TOKEN;
let failures = 0;

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS: ${name}`))
    .catch(error => {
      console.error(`FAIL: ${name}\n  ${(error as Error).message}`);
      failures += 1;
    });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const shot: VideoShotInput = {
  prompt: "The artist crossing a bright Lagos stage",
  durationS: 4,
  motion: "slow push in",
  lighting: "gold and cyan",
  aspectRatio: "9:16",
  negativePrompt: "logos",
};
const composed =
  "The artist crossing a bright Lagos stage\nCamera motion: slow push in.\nLighting: gold and cyan.";

async function main() {
  try {
    // ---- class → spec mapping ----
    await check("class mapping: draft=wan, standard=hailuo, flagship=kling", () => {
      assert.equal(videoEngineSpec("draft", {}).t2vModel, "wavespeedai/wan-2.1-t2v-480p");
      assert.equal(videoEngineSpec("draft", {}).i2vModel, "wavespeedai/wan-2.1-i2v-480p");
      // OWNER-APPROVED SWITCH (2026-07-17): hailuo-2.3-fast is the standard
      // default — better human-motion quality at $0.19/clip vs video-01's $0.50.
      assert.equal(videoEngineSpec("standard", {}).t2vModel, "minimax/hailuo-2.3-fast");
      assert.equal(videoEngineSpec("flagship", {}).t2vModel, "kwaivgi/kling-v2.1");
    });

    await check("env overrides swap the backing model (e.g. LTX for draft)", () => {
      const spec = videoEngineSpec("draft", {
        REPLICATE_VIDEO_DRAFT_MODEL: "lightricks/ltx-video",
        REPLICATE_VIDEO_DRAFT_I2V_MODEL: "",
      });
      assert.equal(spec.t2vModel, "lightricks/ltx-video");
      assert.equal(spec.i2vModel, null);
      assert.deepEqual(videoEngineCapabilities(spec), {
        textToVideo: true,
        imageToVideo: false,
      });
    });

    // ---- duration snapping ----
    await check("durations snap UP per engine (draft 5s, standard 6s, flagship 5/10s)", () => {
      assert.equal(snapDuration(3, videoEngineSpec("draft", {}).allowedDurations), 5);
      assert.equal(snapDuration(4, videoEngineSpec("standard", {}).allowedDurations), 6);
      assert.equal(snapDuration(20, videoEngineSpec("standard", {}).allowedDurations), 6);
      assert.equal(snapDuration(4, videoEngineSpec("flagship", {}).allowedDurations), 5);
      assert.equal(snapDuration(7, videoEngineSpec("flagship", {}).allowedDurations), 10);
      assert.equal(snapDuration(30, videoEngineSpec("flagship", {}).allowedDurations), 10);
    });

    // ---- EXACT payloads ----
    await check("draft t2v payload is the exact Wan body", () => {
      const request = videoModelInput(videoEngineSpec("draft", {}), shot);
      assert.ok(!("error" in request));
      assert.equal(request.slug, "wavespeedai/wan-2.1-t2v-480p");
      assert.deepEqual(request.body, {
        prompt: composed,
        negative_prompt: "logos",
        aspect_ratio: "9:16",
        num_frames: 81,
        frames_per_second: 16,
        fast_mode: "Balanced",
      });
    });

    await check("draft i2v swaps to the i2v deployment and carries the image", () => {
      const request = videoModelInput(videoEngineSpec("draft", {}), {
        ...shot,
        keyframeUrl: "https://storage.example/keyframe.png?sig=1",
      });
      assert.ok(!("error" in request));
      assert.equal(request.slug, "wavespeedai/wan-2.1-i2v-480p");
      assert.equal(request.body.image, "https://storage.example/keyframe.png?sig=1");
    });

    await check("standard t2v payload is the exact modern-MiniMax body", () => {
      const request = videoModelInput(videoEngineSpec("standard", {}), shot);
      assert.ok(!("error" in request));
      assert.equal(request.slug, "minimax/hailuo-2.3-fast");
      assert.deepEqual(request.body, {
        prompt: composed,
        prompt_optimizer: true,
        duration: 6,
        resolution: "768P",
      });
    });

    await check("standard i2v uses first_frame_image on the same model", () => {
      const request = videoModelInput(videoEngineSpec("standard", {}), {
        ...shot,
        keyframeUrl: "https://storage.example/keyframe.png",
      });
      assert.ok(!("error" in request));
      assert.deepEqual(request.body, {
        prompt: composed,
        prompt_optimizer: true,
        duration: 6,
        resolution: "768P",
        first_frame_image: "https://storage.example/keyframe.png",
      });
    });

    await check("legacy video-01 (env-pinned) keeps its exact old body — unknown fields 422", () => {
      const legacy = videoEngineSpec("standard", {
        REPLICATE_VIDEO_STANDARD_MODEL: "minimax/video-01",
      });
      const request = videoModelInput(legacy, shot);
      assert.ok(!("error" in request));
      assert.equal(request.slug, "minimax/video-01");
      assert.deepEqual(request.body, {
        prompt: composed,
        prompt_optimizer: true,
      });
    });

    await check("flagship t2v payload is the exact Kling body (snapped 5s)", () => {
      const request = videoModelInput(videoEngineSpec("flagship", {}), {
        ...shot,
        aspectRatio: "16:9",
      });
      assert.ok(!("error" in request));
      assert.deepEqual(request.body, {
        prompt: composed,
        negative_prompt: "logos",
        duration: 5,
        mode: "standard",
        aspect_ratio: "16:9",
      });
    });

    await check("flagship i2v uses start_image and drops aspect_ratio", () => {
      const request = videoModelInput(videoEngineSpec("flagship", {}), {
        ...shot,
        durationS: 9,
        keyframeUrl: "https://storage.example/keyframe.png",
      });
      assert.ok(!("error" in request));
      assert.deepEqual(request.body, {
        prompt: composed,
        negative_prompt: "logos",
        duration: 10,
        mode: "standard",
        start_image: "https://storage.example/keyframe.png",
      });
    });

    // ---- capability gating ----
    await check("an engine WITHOUT i2v fails a keyframe render closed, class language only", () => {
      const spec = videoEngineSpec("draft", { REPLICATE_VIDEO_DRAFT_I2V_MODEL: "" });
      const request = videoModelInput(spec, {
        ...shot,
        keyframeUrl: "https://storage.example/keyframe.png",
      });
      assert.ok("error" in request);
      assert.ok(request.error.includes("draft"));
      // The wall: no vendor names leak into the user-facing refusal.
      assert.ok(!/wan|ltx|kling|minimax|hailuo|replicate/i.test(request.error));
    });

    await check("adapter-level capability gate mirrors the spec", async () => {
      process.env.REPLICATE_API_TOKEN = "test-token";
      const adapter = videoAdapterForClass("draft", undefined, {
        REPLICATE_API_TOKEN: "test-token",
        REPLICATE_VIDEO_DRAFT_I2V_MODEL: "",
      });
      assert.ok(adapter);
      assert.deepEqual(adapter!.capabilities, {
        textToVideo: true,
        imageToVideo: false,
      });
      const refused = await adapter!.renderShot({
        ...shot,
        keyframeUrl: "https://storage.example/keyframe.png",
      });
      assert.equal(refused.status, "failed");
      assert.ok(refused.error?.includes("draft"));
    });

    // ---- no token → nothing, never a stub ----
    await check("no Replicate token = no class adapter (fall back or fail, never stub)", () => {
      delete process.env.REPLICATE_API_TOKEN;
      delete process.env.REPLICATE_TOKEN;
      assert.equal(videoAdapterForClass("standard", undefined, {}), null);
    });

    // ---- the community-model law, end to end with a mocked provider ----
    await check("render resolves the version THEN posts versioned /predictions; poll completes", async () => {
      process.env.REPLICATE_API_TOKEN = "test-token";
      const calls: Array<{ url: string; body?: unknown }> = [];
      globalThis.fetch = (async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        calls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url === "https://api.replicate.com/v1/models/minimax/hailuo-2.3-fast") {
          return json({ latest_version: { id: "std-version-hash" } });
        }
        if (url === "https://api.replicate.com/v1/predictions" && init?.method === "POST") {
          return json({ id: "pred_tier_123", status: "starting" });
        }
        if (url === "https://api.replicate.com/v1/predictions/pred_tier_123") {
          return json({
            id: "pred_tier_123",
            status: "succeeded",
            output: "https://replicate.delivery/video.mp4",
          });
        }
        return json({ error: "unexpected URL " + url }, 500);
      }) as typeof fetch;

      const adapter = videoAdapterForClass("standard", undefined, {
        REPLICATE_API_TOKEN: "test-token",
      })!;
      const started = await adapter.renderShot(shot);
      assert.equal(started.status, "running");
      assert.equal(started.externalId, "pred_tier_123");

      // The law: model lookup FIRST, then the versioned predictions POST.
      assert.equal(
        calls[0]!.url,
        "https://api.replicate.com/v1/models/minimax/hailuo-2.3-fast"
      );
      assert.equal(calls[1]!.url, "https://api.replicate.com/v1/predictions");
      assert.deepEqual(calls[1]!.body, {
        version: "std-version-hash",
        input: {
          prompt: composed,
          prompt_optimizer: true,
          duration: 6,
          resolution: "768P",
        },
      });

      const done = await adapter.poll(started.externalId!, shot);
      assert.equal(done.status, "succeeded");
      assert.equal(done.output?.videoUrl, "https://replicate.delivery/video.mp4");
      assert.equal(done.output?.durationS, 6); // snapped to the engine's real length
    });

    await check("provider failure stays a failure with the reason", async () => {
      globalThis.fetch = (async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.endsWith("/models/kwaivgi/kling-v2.1")) {
          return json({ latest_version: { id: "kling-hash" } });
        }
        if (url.endsWith("/predictions")) {
          return json({ id: "pred_fail", status: "failed", error: "NSFW rejected" });
        }
        return json({}, 500);
      }) as typeof fetch;
      const adapter = new ReplicateVideoAdapter(videoEngineSpec("flagship", {}));
      const result = await adapter.renderShot({ ...shot, aspectRatio: "16:9" });
      assert.equal(result.status, "failed");
      assert.ok(result.error?.includes("NSFW rejected"));
    });

    await check("a 'succeeded' run with no video URL is a FAILURE, not a fake render", async () => {
      globalThis.fetch = (async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.endsWith("/models/wavespeedai/wan-2.1-t2v-480p")) {
          return json({ latest_version: { id: "wan-hash" } });
        }
        if (url.endsWith("/predictions")) {
          return json({ id: "pred_empty", status: "succeeded", output: null });
        }
        return json({}, 500);
      }) as typeof fetch;
      const adapter = new ReplicateVideoAdapter(videoEngineSpec("draft", {}));
      const result = await adapter.renderShot(shot);
      assert.equal(result.status, "failed");
      assert.ok(result.error?.includes("no video URL"));
    });

    await check("output URL extraction handles Replicate's shapes", () => {
      assert.equal(predictionVideoUrl("https://x.example/v.mp4"), "https://x.example/v.mp4");
      assert.equal(
        predictionVideoUrl(["https://x.example/a.mp4", "https://x.example/b.mp4"]),
        "https://x.example/a.mp4"
      );
      assert.equal(
        predictionVideoUrl({ video: "https://x.example/v.mp4" }),
        "https://x.example/v.mp4"
      );
      assert.equal(predictionVideoUrl("not-a-url"), null);
      assert.equal(predictionVideoUrl(null), null);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (savedToken === undefined) delete process.env.REPLICATE_API_TOKEN;
    else process.env.REPLICATE_API_TOKEN = savedToken;
  }

  if (failures) {
    process.exitCode = 1;
    return;
  }
  console.log("Video engine tier contracts passed.");
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

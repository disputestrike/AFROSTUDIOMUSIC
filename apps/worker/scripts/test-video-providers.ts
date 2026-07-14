import { generateKeyPairSync } from "node:crypto";
import { videoAdapter } from "@afrohit/ai";

const originalFetch = globalThis.fetch;
const envKeys = [
  "VIDEO_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_VIDEO_MODEL",
  "GCP_PROJECT_ID",
  "GCP_LOCATION",
  "GCP_SERVICE_ACCOUNT_JSON_B64",
  "VEO_MODEL",
  "VEO_RESOLUTION",
] as const;
const savedEnv = new Map(envKeys.map(key => [key, process.env[key]]));
let failures = 0;

function check(condition: boolean, message: string) {
  if (condition) console.log(`PASS: ${message}`);
  else {
    console.error(`FAIL: ${message}`);
    failures += 1;
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const input = {
  prompt: "A singer crossing a bright Lagos stage",
  durationS: 7,
  aspectRatio: "9:16" as const,
  motion: "slow push in",
  lighting: "gold and cyan",
  negativePrompt: "logos",
};

async function main() {
  try {
    process.env.VIDEO_PROVIDER = "unknown";
    const unavailable = await videoAdapter().renderShot(input);
    check(
      unavailable.status === "failed",
      "unknown video providers fail closed"
    );

    process.env.VIDEO_PROVIDER = "sora";
    process.env.OPENAI_API_KEY = "test-openai-key";
    const soraCalls: string[] = [];
    let oversizedSoraContent = false;
    globalThis.fetch = (async (request, init) => {
      const url = String(request);
      soraCalls.push(url);
      if (url === "https://api.openai.com/v1/videos") {
        const form = init?.body as FormData;
        check(
          form.get("seconds") === "8",
          "Sora duration uses an allowed value"
        );
        check(
          form.get("size") === "720x1280",
          "Sora portrait size uses the official field"
        );
        check(
          !form.has("duration_seconds"),
          "obsolete Sora duration field is absent"
        );
        return json({
          id: "video_contract_123",
          status: "queued",
          seconds: "8",
        });
      }
      if (url.endsWith("/video_contract_123")) {
        return json({
          id: "video_contract_123",
          status: "completed",
          seconds: "8",
        });
      }
      if (url.endsWith("/video_contract_123/content")) {
        return new Response(new Uint8Array([0, 1, 2, 3]), {
          headers: {
            "content-type": "video/mp4",
            "content-length": oversizedSoraContent ? "268435457" : "4",
          },
        });
      }
      return json({ error: "unexpected URL" }, 500);
    }) as typeof fetch;

    const sora = videoAdapter();
    const soraStarted = await sora.renderShot(input);
    check(
      soraStarted.status === "running" &&
        soraStarted.externalId === "video_contract_123",
      "Sora create returns a durable job ID"
    );
    const soraDone = await sora.poll!(soraStarted.externalId!, input);
    check(
      soraDone.status === "succeeded" &&
        soraDone.output?.videoBytes?.byteLength === 4,
      "Sora completion downloads authenticated video bytes"
    );
    check(
      soraCalls.some(url => url.endsWith("/content")),
      "Sora content endpoint is used"
    );
    oversizedSoraContent = true;
    const oversizedSora = await sora.poll!(soraStarted.externalId!, input);
    check(
      oversizedSora.status === "failed" &&
        oversizedSora.error?.includes("too large") === true,
      "Sora rejects oversized content before buffering it"
    );

    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const serviceAccount = {
      client_email: "afrohit-video@test-project.iam.gserviceaccount.com",
      private_key: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      project_id: "test-project",
    };
    process.env.VIDEO_PROVIDER = "veo";
    process.env.GCP_PROJECT_ID = "test-project";
    process.env.GCP_LOCATION = "us-central1";
    process.env.VEO_MODEL = "veo-3.1-fast-generate-001";
    process.env.GCP_SERVICE_ACCOUNT_JSON_B64 = Buffer.from(
      JSON.stringify(serviceAccount)
    ).toString("base64");

    const modelPath =
      "projects/test-project/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001";
    const operationName = `${modelPath}/operations/op-contract-123`;
    let sawPredict = false;
    let sawPoll = false;
    let invalidVeoPayload = false;
    globalThis.fetch = (async (request, init) => {
      const url = String(request);
      if (url === "https://oauth2.googleapis.com/token") {
        check(
          init?.body instanceof URLSearchParams &&
            init.body.get("grant_type") ===
              "urn:ietf:params:oauth:grant-type:jwt-bearer",
          "Veo uses the service-account JWT bearer exchange"
        );
        return json({ access_token: "google-token", expires_in: 3600 });
      }
      if (url.endsWith(":predictLongRunning")) {
        sawPredict = true;
        const body = JSON.parse(String(init?.body)) as {
          parameters?: { durationSeconds?: number; aspectRatio?: string };
        };
        check(
          body.parameters?.durationSeconds === 8,
          "Veo duration uses an allowed value"
        );
        check(
          body.parameters?.aspectRatio === "9:16",
          "Veo uses the official aspectRatio field"
        );
        return json({ name: operationName });
      }
      if (url.endsWith(":fetchPredictOperation")) {
        sawPoll = true;
        return json({
          name: operationName,
          done: true,
          response: {
            videos: [
              {
                bytesBase64Encoded: invalidVeoPayload
                  ? "not%base64"
                  : Buffer.from([4, 5, 6, 7]).toString("base64"),
                mimeType: "video/mp4",
              },
            ],
            raiMediaFilteredCount: 0,
          },
        });
      }
      return json({ error: "unexpected URL" }, 500);
    }) as typeof fetch;

    const veo = videoAdapter();
    const veoStarted = await veo.renderShot(input);
    check(
      veoStarted.status === "running" &&
        veoStarted.externalId === operationName,
      "Veo create returns its full long-running operation name"
    );
    const veoDone = await veo.poll!(veoStarted.externalId!, input);
    check(
      veoDone.status === "succeeded" &&
        veoDone.output?.videoBytes?.byteLength === 4,
      "Veo completion decodes inline video bytes"
    );
    check(
      sawPredict && sawPoll,
      "Veo uses predict and fetch operation endpoints"
    );
    invalidVeoPayload = true;
    const invalidVeo = await veo.poll!(veoStarted.externalId!, input);
    check(
      invalidVeo.status === "failed" &&
        invalidVeo.error?.includes("invalid") === true,
      "Veo rejects malformed inline media"
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  if (failures) {
    process.exitCode = 1;
    return;
  }
  console.log("Video provider contracts passed.");
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

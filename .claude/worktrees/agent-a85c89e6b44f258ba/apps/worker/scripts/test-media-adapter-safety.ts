import { imageAdapter, videoAdapter, voiceAdapter } from "@afrohit/ai";

const envKeys = [
  "NODE_ENV",
  "ALLOW_STUB_AUDIO",
  "IMAGE_PROVIDER",
  "VIDEO_PROVIDER",
  "VOICE_PROVIDER",
] as const;
const saved = new Map(envKeys.map(key => [key, process.env[key]]));

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log("PASS: " + message);
  else {
    console.error("FAIL: " + message);
    failures += 1;
  }
}

async function main() {
  try {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_STUB_AUDIO = "1";

    const productionImage = await imageAdapter("stub").generate({
      prompt: "test",
      size: "1024x1024",
      quality: "low",
    });
    check(
      productionImage.status === "failed",
      "production image adapter rejects stub even when the dev flag is set"
    );

    const unknownImage = await imageAdapter("typo-provider").generate({
      prompt: "test",
      size: "1024x1024",
      quality: "low",
    });
    check(
      unknownImage.status === "failed",
      "unknown image provider fails closed instead of returning Picsum"
    );

    process.env.VIDEO_PROVIDER = "stub";
    const productionVideo = await videoAdapter().renderShot({
      prompt: "test",
      durationS: 4,
      aspectRatio: "16:9",
    });
    check(
      productionVideo.status === "failed",
      "production video adapter rejects placeholder footage"
    );

    const productionVoice = await voiceAdapter("stub").render({
      providerVoiceId: "stub",
      lyricBody: "test",
      role: "lead",
    });
    check(
      productionVoice.status === "failed",
      "production voice adapter rejects placeholder audio"
    );

    process.env.NODE_ENV = "development";
    process.env.ALLOW_STUB_AUDIO = "1";
    const developmentImage = await imageAdapter("stub").generate({
      prompt: "test",
      size: "1024x1024",
      quality: "low",
    });
    check(
      developmentImage.status === "succeeded",
      "explicit development fixture remains available for offline UI testing"
    );
  } finally {
    for (const key of envKeys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  if (failures) process.exitCode = 1;
  else console.log("Media adapter safety assertions passed.");
}

void main();

import {
  assertProductionRuntimeSafety,
  productionRuntimeViolations,
} from "@afrohit/shared";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`PASS: ${message}`);
  else {
    console.error(`FAIL: ${message}`);
    failures += 1;
  }
}

check(
  productionRuntimeViolations({
    NODE_ENV: "development",
    STUB_AI: "1",
    ALLOW_STUB_AUDIO: "1",
    MUSIC_PROVIDER: "stub",
  }).length === 0,
  "development can opt into deterministic fixtures"
);

check(
  productionRuntimeViolations({
    NODE_ENV: "production",
    MUSIC_PROVIDER: "replicate",
    VOICE_PROVIDER: "eleven",
    VIDEO_PROVIDER: "sora",
    IMAGE_PROVIDER: "openai",
  }).length === 0,
  "configured production providers pass"
);

const violations = productionRuntimeViolations({
  NODE_ENV: "production",
  STUB_AI: "1",
  ALLOW_STUB_AUDIO: "1",
  VOICE_PROVIDER: "stub",
});
check(
  violations.includes("STUB_AI=1"),
  "production rejects deterministic text fixtures"
);
check(
  violations.includes("ALLOW_STUB_AUDIO=1"),
  "production rejects placeholder media"
);
check(
  violations.includes("VOICE_PROVIDER=stub"),
  "production rejects explicit stub providers"
);

let threw = false;
try {
  assertProductionRuntimeSafety({
    NODE_ENV: "production",
    VIDEO_PROVIDER: "stub",
  });
} catch (error) {
  threw = /REFUSING TO BOOT/.test((error as Error).message);
}
check(threw, "startup assertion fails closed");

if (failures) process.exit(1);
console.log("Runtime safety assertions passed.");

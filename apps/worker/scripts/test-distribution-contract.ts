import { createHmac } from "node:crypto";
import {
  distributionConfigurationStatus,
  distributionLifecycleDiagnostics,
  distributionSignature,
  sanitizeDistributionChannels,
  verifyDistributionSignature,
} from "../../api/src/lib/distribution";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log("PASS: " + message);
  else {
    console.error("FAIL: " + message);
    failures += 1;
  }
}

const secret = "distribution-contract-secret-32-bytes-minimum";
const timestamp = "1783929600";
const body = Buffer.from(
  JSON.stringify({
    schemaVersion: 1,
    event: "release.status",
    eventId: "evt_contract_1",
    externalId: "release_contract_1",
    status: "live",
    occurredAt: "2026-07-13T00:00:00.000Z",
  })
);
const expected =
  "sha256=" +
  createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(body)
    .digest("hex");
const signature = distributionSignature(secret, timestamp, body);

const configured = distributionConfigurationStatus({
  DISTRIBUTOR: "approved_partner",
  DISTRIBUTOR_SUBMIT_URL: "https://distribution.test/releases",
  DISTRIBUTOR_WEBHOOK_SECRET: secret,
});
check(
  configured.ready,
  "distribution readiness accepts signed HTTPS configuration"
);
check(
  configured.endpointSource === "DISTRIBUTOR_SUBMIT_URL",
  "distribution readiness identifies the preferred submission URL source"
);
const legacyConfigured = distributionConfigurationStatus({
  DISTRIBUTOR: "approved_partner",
  DISTRIBUTOR_WEBHOOK_URL: "https://distribution.test/releases",
  DISTRIBUTOR_WEBHOOK_SECRET: secret,
});
check(
  legacyConfigured.ready &&
    legacyConfigured.endpointSource === "DISTRIBUTOR_WEBHOOK_URL",
  "legacy submission URL remains compatible and is diagnosed explicitly"
);
check(
  !distributionConfigurationStatus({
    DISTRIBUTOR: "approved_partner",
    DISTRIBUTOR_WEBHOOK_URL: "http://localhost/releases",
    DISTRIBUTOR_WEBHOOK_SECRET: "short",
  }).ready,
  "distribution readiness rejects weak or non-HTTPS configuration"
);
check(
  distributionConfigurationStatus({
    DISTRIBUTOR_SUBMIT_URL: "https://distribution.test/releases",
    DISTRIBUTOR_WEBHOOK_SECRET: secret,
  }).missing.includes("DISTRIBUTOR"),
  "distribution readiness requires an explicit approved provider"
);
check(
  !distributionConfigurationStatus({
    DISTRIBUTOR: "partner-name",
    DISTRIBUTOR_SUBMIT_URL: "https://distribution-partner.example/releases",
    DISTRIBUTOR_WEBHOOK_SECRET: secret,
  }).ready,
  "distribution readiness rejects documentation placeholders"
);
check(
  !distributionConfigurationStatus({
    DISTRIBUTOR: "approved_partner",
    DISTRIBUTOR_SUBMIT_URL: "https://one.test/releases",
    DISTRIBUTOR_WEBHOOK_URL: "https://two.test/releases",
    DISTRIBUTOR_WEBHOOK_SECRET: secret,
  }).ready,
  "distribution readiness rejects conflicting preferred and legacy endpoints"
);
const lifecycle = distributionLifecycleDiagnostics(
  {
    status: "accepted",
    distributor: "partner",
    externalId: "release_contract_1",
    distributionStatusAt: new Date("2026-07-01T00:00:00.000Z"),
  },
  configured,
  new Date("2026-07-19T00:00:00.000Z")
);
check(lifecycle.stale, "distribution diagnostics expose stale partner states");

check(
  signature === expected,
  "distribution signatures use the documented raw-body HMAC"
);
check(
  verifyDistributionSignature({
    secret,
    timestamp,
    signature,
    body,
    nowSeconds: Number(timestamp),
  }),
  "a current untampered distributor signature verifies"
);
check(
  !verifyDistributionSignature({
    secret,
    timestamp,
    signature,
    body: Buffer.from(body.toString("utf8") + " "),
    nowSeconds: Number(timestamp),
  }),
  "payload tampering invalidates the signature"
);
check(
  !verifyDistributionSignature({
    secret,
    timestamp,
    signature,
    body,
    nowSeconds: Number(timestamp) + 301,
  }),
  "stale distributor signatures are rejected"
);
check(
  !verifyDistributionSignature({
    secret: "too-short",
    timestamp,
    signature,
    body,
    nowSeconds: Number(timestamp),
  }),
  "short signing secrets are rejected"
);

const channels = sanitizeDistributionChannels({
  spotify: "https://open.spotify.com/track/123",
  apple: "http://music.apple.com/album/123",
  youtube: "https://user:password@youtube.com/watch?v=123",
  "invalid channel": "https://example.com",
  tidal: "https://tidal.com/browse/track/123",
});
check(
  channels?.spotify?.startsWith("https://open.spotify.com/") === true &&
    channels?.tidal?.startsWith("https://tidal.com/") === true,
  "valid credential-free HTTPS channel links survive"
);
check(
  channels?.apple === undefined &&
    channels?.youtube === undefined &&
    channels?.["invalid channel"] === undefined,
  "unsafe or malformed distributor channel links are removed"
);

if (failures) process.exitCode = 1;
else console.log("Distribution contract passed.");

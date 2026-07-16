import { createHmac } from "node:crypto";
import {
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

import assert from "node:assert/strict";
import { storedAttestationMatches } from "../src/routes/benchmark";

const candidate = {
  confirmed: true,
  basis: "licensed_evaluation",
  note: "Licensed for this controlled evaluation.",
  contentHash: "reference-sha256",
  comparisonProtocol: {
    version: 1,
    blind: true,
    identityMetadataRemoved: true,
    loudnessMatched: true,
    durationMatched: true,
    independentJudgesMin: 3,
    note: "Controlled blind listening protocol.",
  },
};
const stored = {
  schemaVersion: 1,
  ...candidate,
  attestedBy: "user-a",
  attestedAt: "2026-07-15T12:00:00.000Z",
};

assert.equal(storedAttestationMatches(stored, candidate), true);
assert.equal(
  storedAttestationMatches(
    { ...stored, attestedBy: "user-b", attestedAt: "2026-07-16T12:00:00Z" },
    candidate
  ),
  true
);
assert.equal(
  storedAttestationMatches(
    {
      ...stored,
      comparisonProtocol: {
        ...candidate.comparisonProtocol,
        independentJudgesMin: 5,
      },
    },
    candidate
  ),
  false
);
assert.equal(
  storedAttestationMatches(
    { ...stored, note: "Different rights basis." },
    candidate
  ),
  false
);

console.log("benchmark pair attestation tests passed");

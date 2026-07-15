import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseEvidenceHash } from "@afrohit/db";
import { distributionSubmissionPayload } from "../src/lib/distribution";
import {
  publicReleaseRevisionSnapshot,
  releasePackageIsCurrent,
} from "../src/routes/release";

const artifactFingerprint = "a".repeat(64);
const sourceFingerprint = "b".repeat(64);
const receiptId = "receipt-exact";

const releaseExport = {
  qualityState: "ready",
  archiveUrl: "s3://private/releases/exact.zip",
  contentHash: "c".repeat(64),
  sourceFingerprint,
  receiptId,
  verifiedAt: new Date("2026-07-15T12:00:00.000Z"),
  manifest: {
    schemaVersion: 1,
    artifactFingerprint,
    sourceFingerprint,
    receiptId,
  },
};

assert.equal(
  releasePackageIsCurrent(releaseExport, { artifactFingerprint, receiptId }),
  true
);
assert.equal(
  releasePackageIsCurrent(
    {
      ...releaseExport,
      manifest: {
        ...releaseExport.manifest,
        artifactFingerprint: "d".repeat(64),
      },
    },
    { artifactFingerprint, receiptId }
  ),
  false,
  "a package for another exact audio/cover fingerprint must fail"
);
assert.equal(
  releasePackageIsCurrent(
    {
      ...releaseExport,
      manifest: {
        ...releaseExport.manifest,
        sourceFingerprint: "e".repeat(64),
      },
    },
    { artifactFingerprint, receiptId }
  ),
  false,
  "the persisted row and immutable manifest must agree"
);

const coverA = releaseEvidenceHash({
  audio: {
    kind: "master",
    id: "master-1",
    contentHash: "1".repeat(64),
    source: {
      kind: "mix",
      id: "mix-1",
      contentHash: "2".repeat(64),
    },
  },
  cover: { id: "cover-a", contentHash: "3".repeat(64) },
  lyric: { id: "lyric-1", contentHash: "4".repeat(64) },
});
const coverB = releaseEvidenceHash({
  audio: {
    kind: "master",
    id: "master-1",
    contentHash: "1".repeat(64),
    source: {
      kind: "mix",
      id: "mix-1",
      contentHash: "2".repeat(64),
    },
  },
  cover: { id: "cover-b", contentHash: "3".repeat(64) },
  lyric: { id: "lyric-1", contentHash: "4".repeat(64) },
});
assert.notEqual(
  coverA,
  coverB,
  "selecting another certified cover must change the release fingerprint"
);

const revision = publicReleaseRevisionSnapshot({
  id: "release-1:0000000007",
  revision: 7,
  status: "submitted",
  createdAt: new Date("2026-07-15T12:00:00.000Z"),
  snapshot: {
    title: "Exact Take",
    artistName: "Artist",
    genre: "afrobeats",
    isrc: "NG-ABC-26-00001",
    upc: "123456789012",
    audio: {
      assetId: "master-1",
      kind: "master",
      url: "s3://private/master.wav",
    },
    cover: {
      assetId: "cover-a",
      url: "s3://private/cover.jpg",
    },
    export: {
      exportId: "export-1",
      archiveUrl: "s3://private/release.zip",
      artifactFingerprint,
      evidenceHash: "c".repeat(64),
    },
    distribution: {
      status: "submitted",
      provider: "partner",
      externalId: "partner-1",
      channels: { spotify: "https://open.spotify.com/track/exact" },
      submittedAt: "2026-07-15T12:00:00.000Z",
    },
  },
});
assert.equal(revision.package.audioAssetId, "master-1");
assert.equal(revision.package.coverAssetId, "cover-a");
assert.equal(revision.package.artifactFingerprint, artifactFingerprint);
assert.doesNotMatch(
  JSON.stringify(revision),
  /s3:\/\/private/,
  "revision history must not expose private storage references"
);

const payload = distributionSubmissionPayload(
  {
    releaseId: "release-1",
    revision: 7,
    title: "Exact Take",
    artist: "Artist",
    genre: "afrobeats",
    isrc: "NG-ABC-26-00001",
    upc: "123456789012",
    audioAssetId: "master-1",
    audioAssetKind: "master",
    coverAssetId: "cover-a",
    exportId: "export-1",
    artifactFingerprint,
    audioUrl: "https://signed.example/audio",
    coverUrl: "https://signed.example/cover",
    bundleUrl: "https://signed.example/bundle",
    evidenceHash: "c".repeat(64),
    idempotencyKey: "release:release-1:r7",
  },
  "partner"
);
assert.equal(payload.release.revision, 7);
assert.deepEqual(payload.release.assets, {
  audio: { id: "master-1", kind: "master" },
  cover: { id: "cover-a" },
  export: { id: "export-1" },
});
assert.equal(payload.release.artifactFingerprint, artifactFingerprint);

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const routeSource = readFileSync(
  resolve(repoRoot, "apps/api/src/routes/release.ts"),
  "utf8"
);
const migrationSource = readFileSync(
  resolve(
    repoRoot,
    "packages/db/prisma/migrations/20260715190000_release_artifact_integrity/migration.sql"
  ),
  "utf8"
);assert.match(routeSource, /loadReleaseCertification\(tx,/);
assert.match(routeSource, /current\.revision !== observedHead\.revision/);
assert.match(routeSource, /releaseExport\.sourceFingerprint !==/);
assert.doesNotMatch(
  routeSource,
  /manifestArtwork/,
  "distribution must trust the exact artifact fingerprint, not a nonexistent manifest field"
);
assert.ok(
  migrationSource.indexOf('ROW_NUMBER() OVER') <
    migrationSource.indexOf('CREATE UNIQUE INDEX "Song_isrc_key"'),
  "legacy duplicates must be reconciled before unique indexes are created"
);
assert.match(migrationSource, /ReleaseIdentifierConflict/);

console.log("release artifact integrity tests passed");

import assert from "node:assert/strict";
import {
  LEGACY_RELEASE_LINEAGE_REASON_CODES as REASON,
  buildLegacyReleaseLineageAuditReport,
  classifyBeat,
  classifyMaster,
  classifyMix,
  classifyRelease,
  createLegacyReleaseLineageContext,
  formatLegacyReleaseLineageSummary,
  legacyReleaseLineageReportHasFindings,
  parseLegacyReleaseLineageCliArgs,
  type BeatAuditInput,
  type LegacyReleaseLineageAuditRow,
  type MasterAuditInput,
  type MixAuditInput,
  type ReleaseAuditInput,
  type ReleaseCertificationSnapshotInput,
  type VocalAuditInput,
} from "./audit-legacy-release-lineage";

function hash(character: string): string {
  return character.repeat(64);
}

const verifiedAt = "2026-07-15T12:00:00.000Z";

function certifiedAsset(
  overrides: Partial<BeatAuditInput> = {}
): BeatAuditInput {
  return {
    id: "beat-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    songId: "song-1",
    songProjectId: "project-1",
    songWorkspaceId: "workspace-1",
    approved: true,
    qualityState: "passed",
    contentHash: hash("a"),
    verifiedAt,
    assetKind: "instrumental",
    ...overrides,
  };
}

function certifiedVocal(
  overrides: Partial<VocalAuditInput> = {}
): VocalAuditInput {
  return {
    ...certifiedAsset({
      id: "vocal-1",
      contentHash: hash("b"),
      assetKind: "isolated_vocal",
    }),
    ...overrides,
  };
}

function derivedMix(overrides: Partial<MixAuditInput> = {}): MixAuditInput {
  return {
    ...certifiedAsset({
      id: "mix-1",
      contentHash: hash("c"),
    }),
    meta: {
      source: {
        beatId: "beat-1",
        beatContentHash: hash("a"),
        vocalRenderIds: ["vocal-1"],
        vocalRenderContentHashes: [hash("b")],
      },
    },
    ...overrides,
  };
}

function directMix(overrides: Partial<MixAuditInput> = {}): MixAuditInput {
  return {
    ...certifiedAsset({
      id: "mix-direct",
      contentHash: hash("d"),
    }),
    meta: {
      directOwnedUpload: {
        schemaVersion: 1,
        sourceKind: "workspace_upload",
        sourceContentHash: hash("d"),
        rightsConfirmation: { version: 1, confirmed: true },
        recordedAt: "2026-07-15T11:59:00.000Z",
        certifiedAt: verifiedAt,
      },
    },
    ...overrides,
  };
}

function certifiedMaster(
  overrides: Partial<MasterAuditInput> = {}
): MasterAuditInput {
  return {
    ...certifiedAsset({
      id: "master-1",
      contentHash: hash("e"),
    }),
    mixId: "mix-1",
    meta: {
      sourceMixId: "mix-1",
      sourceContentHash: hash("c"),
    },
    ...overrides,
  };
}

const beat = certifiedAsset();
const vocal = certifiedVocal();
const mix = derivedMix();
const master = certifiedMaster();
const context = createLegacyReleaseLineageContext({
  beats: [beat],
  vocals: [vocal],
  mixes: [mix],
  masters: [master],
});

assert.deepEqual(classifyBeat(beat), {
  classification: "releasable",
  reasonCodes: [],
});

const unmeasuredBeat = certifiedAsset({
  id: "beat-backfill",
  qualityState: "unmeasured",
  contentHash: null,
  verifiedAt: null,
});
assert.deepEqual(classifyBeat(unmeasuredBeat), {
  classification: "requires_backfill",
  reasonCodes: [
    REASON.ASSET_CONTENT_HASH_MISSING,
    REASON.ASSET_QUALITY_UNMEASURED,
    REASON.ASSET_VERIFICATION_MISSING,
  ],
});

const weakBeat = classifyBeat(
  certifiedAsset({ id: "beat-weak", qualityState: "weak" })
);
assert.equal(weakBeat.classification, "blocked");
assert.deepEqual(weakBeat.reasonCodes, [REASON.ASSET_QUALITY_WEAK]);

const malformedBeat = classifyBeat(
  certifiedAsset({ id: "beat-malformed", contentHash: "not-a-sha256" })
);
assert.equal(malformedBeat.classification, "blocked");
assert.ok(
  malformedBeat.reasonCodes.includes(REASON.ASSET_CONTENT_HASH_INVALID)
);

assert.deepEqual(classifyMix(mix, context), {
  classification: "releasable",
  reasonCodes: [],
});
assert.deepEqual(classifyMix(directMix()), {
  classification: "releasable",
  reasonCodes: [],
});

const missingMixLineage = classifyMix(derivedMix({ meta: {} }), context);
assert.equal(missingMixLineage.classification, "requires_backfill");
assert.deepEqual(missingMixLineage.reasonCodes, [REASON.MIX_LINEAGE_MISSING]);

const ambiguousMixLineage = classifyMix(
  derivedMix({
    meta: {
      source: (mix.meta as { source: unknown }).source,
      directOwnedUpload: (directMix().meta as { directOwnedUpload: unknown })
        .directOwnedUpload,
    },
  }),
  context
);
assert.equal(ambiguousMixLineage.classification, "blocked");
assert.ok(ambiguousMixLineage.reasonCodes.includes(REASON.MIX_LINEAGE_INVALID));

const mismatchedDirectHash = classifyMix(directMix({ contentHash: hash("f") }));
assert.equal(mismatchedDirectHash.classification, "blocked");
assert.ok(
  mismatchedDirectHash.reasonCodes.includes(REASON.MIX_SOURCE_HASH_MISMATCH)
);

const staleBeatClaim = classifyMix(
  derivedMix({
    meta: {
      source: {
        beatId: "beat-1",
        beatContentHash: hash("9"),
        vocalRenderIds: ["vocal-1"],
        vocalRenderContentHashes: [hash("b")],
      },
    },
  }),
  context
);
assert.equal(staleBeatClaim.classification, "blocked");
assert.ok(
  staleBeatClaim.reasonCodes.includes(REASON.MIX_SOURCE_BEAT_HASH_MISMATCH)
);

const weakVocal = certifiedVocal({ qualityState: "weak" });
const weakVocalContext = createLegacyReleaseLineageContext({
  beats: [beat],
  vocals: [weakVocal],
  mixes: [mix],
});
const weakVocalMix = classifyMix(mix, weakVocalContext);
assert.equal(weakVocalMix.classification, "blocked");
assert.ok(
  weakVocalMix.reasonCodes.includes(REASON.MIX_SOURCE_VOCAL_NOT_RELEASABLE)
);

assert.deepEqual(classifyMaster(master, context), {
  classification: "releasable",
  reasonCodes: [],
});

const legacyMaster = classifyMaster(
  certifiedMaster({ mixId: null, meta: null }),
  context
);
assert.equal(legacyMaster.classification, "requires_backfill");
assert.deepEqual(legacyMaster.reasonCodes, [
  REASON.MASTER_SOURCE_METADATA_MISSING,
  REASON.MASTER_SOURCE_MIX_ID_MISSING,
]);

const staleMaster = classifyMaster(
  certifiedMaster({
    meta: { sourceMixId: "mix-1", sourceContentHash: hash("f") },
  }),
  context
);
assert.equal(staleMaster.classification, "blocked");
assert.ok(
  staleMaster.reasonCodes.includes(REASON.MASTER_SOURCE_MIX_HASH_MISMATCH)
);

function certification(
  overrides: Partial<ReleaseCertificationSnapshotInput> = {}
): ReleaseCertificationSnapshotInput {
  return {
    song: {
      id: "song-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
    },
    audio: { kind: "master", id: "master-1" },
    artifactFingerprint: hash("1"),
    splitSheet: [{ name: "Artist", role: "writer", share: 100 }],
    requiredNativeLanguages: [],
    rightsReceipt: { id: "receipt-1" },
    splitAttestation: { id: "split-1" },
    nativeAttestation: null,
    readiness: {
      ready: true,
      checks: [
        { name: "Certified master or mix", ok: true },
        { name: "Approved cover art", ok: true },
        { name: "Approved lyrics", ok: true },
        { name: "Accepted split-sheet totals 100%", ok: true },
        { name: "Current rights receipt", ok: true },
        { name: "Native-language review", ok: true },
        { name: "Exact audio lineage", ok: true },
      ],
    },
    evidence: {
      receiptHashValid: true,
      receiptCurrent: true,
      splitAttested: true,
      nativeAttested: false,
      rightsOk: true,
    },
    ...overrides,
  };
}

function release(
  overrides: Partial<ReleaseAuditInput> = {}
): ReleaseAuditInput {
  return {
    id: "release-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    songId: "song-1",
    status: "live",
    audioAssetId: "master-1",
    audioAssetKind: "master",
    artifactFingerprint: hash("1"),
    evidenceHash: hash("2"),
    exportContentHash: hash("2"),
    certification: certification(),
    ...overrides,
  };
}

assert.deepEqual(classifyRelease(release(), context), {
  classification: "releasable",
  reasonCodes: [],
});

assert.deepEqual(
  classifyRelease(release({ exportContentHash: null }), context),
  {
    classification: "requires_backfill",
    reasonCodes: [REASON.RELEASE_EXPORT_CONTENT_HASH_MISSING],
  }
);

assert.deepEqual(
  classifyRelease(release({ exportContentHash: "not-a-sha256" }), context),
  {
    classification: "blocked",
    reasonCodes: [REASON.RELEASE_EXPORT_CONTENT_HASH_INVALID],
  }
);

const legacyRelease = classifyRelease(
  release({ status: "legacy_unverified" }),
  context
);
assert.equal(legacyRelease.classification, "requires_backfill");
assert.deepEqual(legacyRelease.reasonCodes, [REASON.RELEASE_LEGACY_UNVERIFIED]);

const malformedRelease = classifyRelease(
  release({ artifactFingerprint: "weak-fingerprint" }),
  context
);
assert.equal(malformedRelease.classification, "blocked");
assert.ok(
  malformedRelease.reasonCodes.includes(
    REASON.RELEASE_ARTIFACT_FINGERPRINT_INVALID
  )
);

const unavailableCertification = classifyRelease(
  release({ certification: null, certificationUnavailable: true }),
  context
);
assert.equal(unavailableCertification.classification, "blocked");
assert.ok(
  unavailableCertification.reasonCodes.includes(
    REASON.RELEASE_CERTIFICATION_UNAVAILABLE
  )
);

const backfillMix = derivedMix({ id: "mix-backfill", meta: {} });
const backfillContext = createLegacyReleaseLineageContext({
  beats: [beat],
  vocals: [vocal],
  mixes: [backfillMix],
});
const lineageBackfillCertification = certification({
  audio: { kind: "mix", id: "mix-backfill" },
  readiness: {
    ready: false,
    checks: [
      { name: "Certified master or mix", ok: true },
      { name: "Approved cover art", ok: true },
      { name: "Approved lyrics", ok: true },
      { name: "Accepted split-sheet totals 100%", ok: true },
      { name: "Current rights receipt", ok: true },
      { name: "Native-language review", ok: true },
      { name: "Exact audio lineage", ok: false },
    ],
  },
});
const lineageBackfillRelease = classifyRelease(
  release({
    audioAssetId: "mix-backfill",
    audioAssetKind: "mix",
    certification: lineageBackfillCertification,
  }),
  backfillContext
);
assert.equal(lineageBackfillRelease.classification, "requires_backfill");
assert.deepEqual(lineageBackfillRelease.reasonCodes, [
  REASON.RELEASE_LINEAGE_BACKFILL_REQUIRED,
]);

const unsortedRows: LegacyReleaseLineageAuditRow[] = [
  {
    entityType: "master",
    id: "master-z",
    workspaceId: "workspace-1",
    projectId: "project-1",
    songId: "song-1",
    classification: "blocked",
    reasonCodes: [REASON.MASTER_SOURCE_MIX_MISSING],
  },
  {
    entityType: "beat",
    id: "beat-a",
    workspaceId: "workspace-1",
    projectId: "project-1",
    songId: "song-1",
    classification: "releasable",
    reasonCodes: [],
  },
  {
    entityType: "mix",
    id: "mix-b",
    workspaceId: "workspace-1",
    projectId: "project-1",
    songId: "song-1",
    classification: "requires_backfill",
    reasonCodes: [REASON.MIX_LINEAGE_MISSING],
  },
];
const report = buildLegacyReleaseLineageAuditReport(unsortedRows, {
  workspaceId: "workspace-1",
});
assert.deepEqual(
  report.rows.map(row => row.entityType),
  ["beat", "mix", "master"]
);
assert.deepEqual(report.summary.byClassification, {
  releasable: 1,
  blocked: 1,
  requires_backfill: 1,
});
assert.equal(report.summary.findings, 2);
assert.equal(legacyReleaseLineageReportHasFindings(report), true);
assert.equal(
  JSON.stringify(report),
  JSON.stringify(
    buildLegacyReleaseLineageAuditReport([...unsortedRows].reverse(), {
      workspaceId: "workspace-1",
    })
  ),
  "report ordering must not depend on database return order"
);
assert.equal(
  formatLegacyReleaseLineageSummary(report),
  "legacy release-lineage audit: total=3 releasable=1 blocked=1 requires_backfill=1"
);

assert.deepEqual(
  parseLegacyReleaseLineageCliArgs([
    "--workspace-id=workspace-1",
    "--project",
    "project-1",
    "--fail-on-findings",
  ]),
  {
    workspaceId: "workspace-1",
    projectId: "project-1",
    failOnFindings: true,
    help: false,
  }
);
assert.throws(
  () =>
    parseLegacyReleaseLineageCliArgs([
      "--workspace",
      "workspace-1",
      "--workspace-id",
      "workspace-1",
    ]),
  /duplicate_workspace_filter/
);
assert.throws(
  () => parseLegacyReleaseLineageCliArgs(["--unknown"]),
  /unknown_argument/
);

console.log("legacy release-lineage audit tests passed");

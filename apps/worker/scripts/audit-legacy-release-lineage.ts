import {
  loadReleaseCertification,
  prisma,
  releaseEvidenceHash,
  releaseMixSourceClaim,
} from "@afrohit/db";

export const LEGACY_RELEASE_LINEAGE_REASON_CODES = {
  ASSET_CONTENT_HASH_INVALID: "asset_content_hash_invalid",
  ASSET_CONTENT_HASH_MISSING: "asset_content_hash_missing",
  ASSET_ID_INVALID: "asset_id_invalid",
  ASSET_NOT_APPROVED: "asset_not_approved",
  ASSET_QUALITY_FAILED: "asset_quality_failed",
  ASSET_QUALITY_INVALID: "asset_quality_invalid",
  ASSET_QUALITY_UNMEASURED: "asset_quality_unmeasured",
  ASSET_QUALITY_WEAK: "asset_quality_weak",
  ASSET_SCOPE_INVALID: "asset_scope_invalid",
  ASSET_SCOPE_MISMATCH: "asset_scope_mismatch",
  ASSET_SONG_ID_MISSING: "asset_song_id_missing",
  ASSET_VERIFICATION_INVALID: "asset_verification_invalid",
  ASSET_VERIFICATION_MISSING: "asset_verification_missing",
  BEAT_NOT_INSTRUMENTAL: "beat_not_instrumental",
  MIX_DERIVATION_CLAIM_MISMATCH: "mix_derivation_claim_mismatch",
  MIX_DERIVATION_CYCLE: "mix_derivation_cycle",
  MIX_DERIVATION_DEPTH_EXCEEDED: "mix_derivation_depth_exceeded",
  MIX_DERIVATION_EXTERNAL: "mix_derivation_external",
  MIX_DERIVATION_PARENT_HASH_MISMATCH: "mix_derivation_parent_hash_mismatch",
  MIX_DERIVATION_PARENT_MISSING: "mix_derivation_parent_missing",
  MIX_DERIVATION_PARENT_NOT_RELEASABLE: "mix_derivation_parent_not_releasable",
  MIX_DERIVATION_PARENT_SCOPE_MISMATCH: "mix_derivation_parent_scope_mismatch",
  MIX_LINEAGE_INVALID: "mix_lineage_invalid",
  MIX_LINEAGE_MISSING: "mix_lineage_missing",
  MIX_SOURCE_BEAT_HASH_MISMATCH: "mix_source_beat_hash_mismatch",
  MIX_SOURCE_BEAT_MISSING: "mix_source_beat_missing",
  MIX_SOURCE_BEAT_NOT_RELEASABLE: "mix_source_beat_not_releasable",
  MIX_SOURCE_BEAT_SCOPE_MISMATCH: "mix_source_beat_scope_mismatch",
  MIX_SOURCE_HASH_MISMATCH: "mix_source_hash_mismatch",
  MIX_SOURCE_VOCAL_HASH_MISMATCH: "mix_source_vocal_hash_mismatch",
  MIX_SOURCE_VOCAL_MISSING: "mix_source_vocal_missing",
  MIX_SOURCE_VOCAL_NOT_RELEASABLE: "mix_source_vocal_not_releasable",
  MIX_SOURCE_VOCAL_SCOPE_MISMATCH: "mix_source_vocal_scope_mismatch",
  MASTER_SOURCE_METADATA_INVALID: "master_source_metadata_invalid",
  MASTER_SOURCE_METADATA_MISSING: "master_source_metadata_missing",
  MASTER_SOURCE_MIX_HASH_MISMATCH: "master_source_mix_hash_mismatch",
  MASTER_SOURCE_MIX_ID_MISSING: "master_source_mix_id_missing",
  MASTER_SOURCE_MIX_MISSING: "master_source_mix_missing",
  MASTER_SOURCE_MIX_NOT_RELEASABLE: "master_source_mix_not_releasable",
  MASTER_SOURCE_MIX_SCOPE_MISMATCH: "master_source_mix_scope_mismatch",
  RELEASE_ARTIFACT_FINGERPRINT_INVALID: "release_artifact_fingerprint_invalid",
  RELEASE_ARTIFACT_FINGERPRINT_MISSING: "release_artifact_fingerprint_missing",
  RELEASE_ARTIFACT_FINGERPRINT_STALE: "release_artifact_fingerprint_stale",
  RELEASE_AUDIO_NOT_READY: "release_audio_not_ready",
  RELEASE_AUDIO_REFERENCE_INVALID: "release_audio_reference_invalid",
  RELEASE_AUDIO_REFERENCE_MISSING: "release_audio_reference_missing",
  RELEASE_AUDIO_REFERENCE_STALE: "release_audio_reference_stale",
  RELEASE_CERTIFICATION_UNAVAILABLE: "release_certification_unavailable",
  RELEASE_COVER_NOT_READY: "release_cover_not_ready",
  RELEASE_EVIDENCE_HASH_INVALID: "release_evidence_hash_invalid",
  RELEASE_EVIDENCE_HASH_MISSING: "release_evidence_hash_missing",
  RELEASE_EVIDENCE_HASH_STALE: "release_evidence_hash_stale",
  RELEASE_EXPORT_CONTENT_HASH_INVALID: "release_export_content_hash_invalid",
  RELEASE_EXPORT_CONTENT_HASH_MISSING: "release_export_content_hash_missing",
  RELEASE_LEGACY_UNVERIFIED: "release_legacy_unverified",
  RELEASE_LINEAGE_BACKFILL_REQUIRED: "release_lineage_backfill_required",
  RELEASE_LINEAGE_NOT_CURRENT: "release_lineage_not_current",
  RELEASE_LYRICS_NOT_READY: "release_lyrics_not_ready",
  RELEASE_NATIVE_ATTESTATION_INVALID: "release_native_attestation_invalid",
  RELEASE_NATIVE_ATTESTATION_MISSING: "release_native_attestation_missing",
  RELEASE_PROJECT_ID_MISSING: "release_project_id_missing",
  RELEASE_RIGHTS_NOT_CLEAR: "release_rights_not_clear",
  RELEASE_RIGHTS_RECEIPT_INVALID: "release_rights_receipt_invalid",
  RELEASE_RIGHTS_RECEIPT_MISSING: "release_rights_receipt_missing",
  RELEASE_RIGHTS_RECEIPT_STALE: "release_rights_receipt_stale",
  RELEASE_SCOPE_MISMATCH: "release_scope_mismatch",
  RELEASE_SPLIT_ATTESTATION_INVALID: "release_split_attestation_invalid",
  RELEASE_SPLIT_ATTESTATION_MISSING: "release_split_attestation_missing",
  RELEASE_SPLITS_NOT_READY: "release_splits_not_ready",
} as const;

export type LegacyReleaseLineageReasonCode =
  (typeof LEGACY_RELEASE_LINEAGE_REASON_CODES)[keyof typeof LEGACY_RELEASE_LINEAGE_REASON_CODES];
export type LegacyReleaseLineageClassification =
  | "releasable"
  | "blocked"
  | "requires_backfill";
export type LegacyReleaseLineageEntityType =
  | "beat"
  | "mix"
  | "master"
  | "release";

export interface LegacyReleaseLineageClassificationResult {
  classification: LegacyReleaseLineageClassification;
  reasonCodes: LegacyReleaseLineageReasonCode[];
}

export interface ScopedCertifiedAssetInput {
  id: unknown;
  workspaceId: unknown;
  projectId: unknown;
  songId: unknown;
  approved: unknown;
  qualityState: unknown;
  contentHash: unknown;
  verifiedAt: unknown;
  songProjectId?: unknown;
  songWorkspaceId?: unknown;
}

export interface BeatAuditInput extends ScopedCertifiedAssetInput {
  assetKind: unknown;
}

export interface MixAuditInput extends ScopedCertifiedAssetInput {
  meta: unknown;
}

export interface MasterAuditInput extends ScopedCertifiedAssetInput {
  mixId: unknown;
  meta: unknown;
}

export interface VocalAuditInput extends ScopedCertifiedAssetInput {
  assetKind: unknown;
}

export interface LegacyReleaseLineageContext {
  beats: ReadonlyMap<string, BeatAuditInput>;
  mixes: ReadonlyMap<string, MixAuditInput>;
  masters: ReadonlyMap<string, MasterAuditInput>;
  vocals: ReadonlyMap<string, VocalAuditInput>;
}

interface ReleaseReadinessCheckInput {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ReleaseCertificationSnapshotInput {
  song: {
    id: string;
    workspaceId: string;
    projectId: string;
  };
  audio: { kind: "master" | "mix"; id: string } | null;
  artifactFingerprint: string;
  splitSheet: ReadonlyArray<unknown>;
  requiredNativeLanguages: ReadonlyArray<string>;
  rightsReceipt: { id: string } | null;
  splitAttestation: { id: string } | null;
  nativeAttestation: { id: string } | null;
  readiness: {
    ready: boolean;
    checks: ReadonlyArray<ReleaseReadinessCheckInput>;
  };
  evidence: {
    receiptHashValid: boolean;
    receiptCurrent: boolean;
    splitAttested: boolean;
    nativeAttested: boolean;
    rightsOk: boolean;
  };
}

export interface ReleaseAuditInput {
  id: unknown;
  workspaceId: unknown;
  projectId: unknown;
  songId: unknown;
  status: unknown;
  audioAssetId: unknown;
  audioAssetKind: unknown;
  artifactFingerprint: unknown;
  evidenceHash: unknown;
  exportContentHash: unknown;
  certification: ReleaseCertificationSnapshotInput | null;
  certificationUnavailable?: boolean;
}

interface ClassificationBuckets {
  blocked: Set<LegacyReleaseLineageReasonCode>;
  backfill: Set<LegacyReleaseLineageReasonCode>;
}

interface LineageWalkState {
  depth: number;
  path: ReadonlySet<string>;
}

const REASON = LEGACY_RELEASE_LINEAGE_REASON_CODES;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ENTITY_ORDER: Record<LegacyReleaseLineageEntityType, number> = {
  beat: 0,
  mix: 1,
  master: 2,
  release: 3,
};

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function certifiedHash(value: unknown): string | null {
  return typeof value === "string" && SHA256_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function missing(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function validTimestamp(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function buckets(): ClassificationBuckets {
  return { blocked: new Set(), backfill: new Set() };
}

function finish(
  findings: ClassificationBuckets
): LegacyReleaseLineageClassificationResult {
  const reasonCodes = [...findings.blocked, ...findings.backfill].sort(
    compareAscii
  );
  if (findings.blocked.size > 0) {
    return { classification: "blocked", reasonCodes };
  }
  if (findings.backfill.size > 0) {
    return { classification: "requires_backfill", reasonCodes };
  }
  return { classification: "releasable", reasonCodes: [] };
}

function classifyCertifiedAsset(
  row: ScopedCertifiedAssetInput
): ClassificationBuckets {
  const findings = buckets();
  const id = nonEmptyString(row.id);
  const workspaceId = nonEmptyString(row.workspaceId);
  const projectId = nonEmptyString(row.projectId);
  const songId = nonEmptyString(row.songId);

  if (!id) findings.blocked.add(REASON.ASSET_ID_INVALID);
  if (!workspaceId || !projectId) {
    findings.blocked.add(REASON.ASSET_SCOPE_INVALID);
  }
  if (!songId) {
    findings.backfill.add(REASON.ASSET_SONG_ID_MISSING);
  } else if (
    (row.songProjectId !== undefined &&
      nonEmptyString(row.songProjectId) !== projectId) ||
    (row.songWorkspaceId !== undefined &&
      nonEmptyString(row.songWorkspaceId) !== workspaceId)
  ) {
    findings.blocked.add(REASON.ASSET_SCOPE_MISMATCH);
  }

  if (row.approved !== true) {
    findings.blocked.add(REASON.ASSET_NOT_APPROVED);
  }

  if (row.qualityState === "passed") {
    // Passed is the only release-certifiable quality state.
  } else if (
    row.qualityState === "unmeasured" ||
    row.qualityState === "pending" ||
    missing(row.qualityState)
  ) {
    findings.backfill.add(REASON.ASSET_QUALITY_UNMEASURED);
  } else if (row.qualityState === "weak") {
    findings.blocked.add(REASON.ASSET_QUALITY_WEAK);
  } else if (
    row.qualityState === "failed" ||
    row.qualityState === "rejected" ||
    row.qualityState === "duplicate"
  ) {
    findings.blocked.add(REASON.ASSET_QUALITY_FAILED);
  } else {
    findings.blocked.add(REASON.ASSET_QUALITY_INVALID);
  }

  if (missing(row.contentHash)) {
    findings.backfill.add(REASON.ASSET_CONTENT_HASH_MISSING);
  } else if (!certifiedHash(row.contentHash)) {
    findings.blocked.add(REASON.ASSET_CONTENT_HASH_INVALID);
  }

  if (missing(row.verifiedAt)) {
    findings.backfill.add(REASON.ASSET_VERIFICATION_MISSING);
  } else if (!validTimestamp(row.verifiedAt)) {
    findings.blocked.add(REASON.ASSET_VERIFICATION_INVALID);
  }

  return findings;
}

function sameScope(
  child: ScopedCertifiedAssetInput,
  parent: ScopedCertifiedAssetInput
): boolean {
  return (
    nonEmptyString(child.workspaceId) === nonEmptyString(parent.workspaceId) &&
    nonEmptyString(child.projectId) === nonEmptyString(parent.projectId) &&
    nonEmptyString(child.songId) === nonEmptyString(parent.songId)
  );
}

function mapById<T extends { id: unknown }>(
  rows: readonly T[]
): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const id = nonEmptyString(row.id);
    if (id) result.set(id, row);
  }
  return result;
}

export function createLegacyReleaseLineageContext(input: {
  beats?: readonly BeatAuditInput[];
  mixes?: readonly MixAuditInput[];
  masters?: readonly MasterAuditInput[];
  vocals?: readonly VocalAuditInput[];
}): LegacyReleaseLineageContext {
  return {
    beats: mapById(input.beats ?? []),
    mixes: mapById(input.mixes ?? []),
    masters: mapById(input.masters ?? []),
    vocals: mapById(input.vocals ?? []),
  };
}

export function classifyBeat(
  row: BeatAuditInput
): LegacyReleaseLineageClassificationResult {
  const findings = classifyCertifiedAsset(row);
  if (row.assetKind !== "instrumental") {
    findings.blocked.add(REASON.BEAT_NOT_INSTRUMENTAL);
  }
  return finish(findings);
}

function classifyVocal(
  row: VocalAuditInput
): LegacyReleaseLineageClassificationResult {
  const findings = classifyCertifiedAsset(row);
  if (row.assetKind !== "isolated_vocal") {
    findings.blocked.add(REASON.MIX_SOURCE_VOCAL_NOT_RELEASABLE);
  }
  return finish(findings);
}

function initialWalkState(
  kind: "mix" | "master",
  id: unknown
): LineageWalkState {
  const normalizedId = nonEmptyString(id) ?? "<invalid>";
  return { depth: 0, path: new Set([`${kind}:${normalizedId}`]) };
}

function descend(
  state: LineageWalkState,
  key: string
): LineageWalkState | null {
  if (state.depth >= 15) return null;
  if (state.path.has(key)) return null;
  return {
    depth: state.depth + 1,
    path: new Set([...state.path, key]),
  };
}

function addDerivationFinding(
  findings: ClassificationBuckets,
  state: LineageWalkState,
  key: string
): LineageWalkState | null {
  if (state.path.has(key)) {
    findings.blocked.add(REASON.MIX_DERIVATION_CYCLE);
    return null;
  }
  if (state.depth >= 15) {
    findings.blocked.add(REASON.MIX_DERIVATION_DEPTH_EXCEEDED);
    return null;
  }
  return descend(state, key);
}

function validateDerivedMixComponents(
  row: MixAuditInput,
  claim: Record<string, unknown>,
  context: LegacyReleaseLineageContext,
  findings: ClassificationBuckets
): void {
  const beatId = nonEmptyString(claim.beatId)!;
  const beatHash = certifiedHash(claim.beatContentHash)!;
  const beat = context.beats.get(beatId);
  if (!beat) {
    findings.blocked.add(REASON.MIX_SOURCE_BEAT_MISSING);
  } else {
    if (!sameScope(row, beat)) {
      findings.blocked.add(REASON.MIX_SOURCE_BEAT_SCOPE_MISMATCH);
    }
    if (classifyBeat(beat).classification !== "releasable") {
      findings.blocked.add(REASON.MIX_SOURCE_BEAT_NOT_RELEASABLE);
    }
    if (certifiedHash(beat.contentHash) !== beatHash) {
      findings.blocked.add(REASON.MIX_SOURCE_BEAT_HASH_MISMATCH);
    }
  }

  const vocalIds = claim.vocalRenderIds as string[];
  const vocalHashes = claim.vocalRenderContentHashes as string[];
  for (let index = 0; index < vocalIds.length; index += 1) {
    const vocalId = vocalIds[index]!;
    const vocal = context.vocals.get(vocalId);
    if (!vocal) {
      findings.blocked.add(REASON.MIX_SOURCE_VOCAL_MISSING);
      continue;
    }
    if (!sameScope(row, vocal)) {
      findings.blocked.add(REASON.MIX_SOURCE_VOCAL_SCOPE_MISMATCH);
    }
    if (classifyVocal(vocal).classification !== "releasable") {
      findings.blocked.add(REASON.MIX_SOURCE_VOCAL_NOT_RELEASABLE);
    }
    if (certifiedHash(vocal.contentHash) !== vocalHashes[index]) {
      findings.blocked.add(REASON.MIX_SOURCE_VOCAL_HASH_MISMATCH);
    }
  }
}

function validateDerivation(
  row: MixAuditInput,
  claim: Record<string, unknown>,
  context: LegacyReleaseLineageContext,
  findings: ClassificationBuckets,
  state: LineageWalkState
): void {
  const derivation = record(claim.derivedFrom);
  if (!derivation) return;

  const type = nonEmptyString(derivation.type);
  const id = nonEmptyString(derivation.id);
  const sourceHash = certifiedHash(derivation.sourceContentHash);
  const claimHash = certifiedHash(derivation.claimHash);
  if (!type || !id || !sourceHash || !claimHash) {
    findings.blocked.add(REASON.MIX_LINEAGE_INVALID);
    return;
  }
  if (type === "external") {
    findings.blocked.add(REASON.MIX_DERIVATION_EXTERNAL);
    return;
  }

  const key = `${type}:${id}`;
  const nextState = addDerivationFinding(findings, state, key);
  if (!nextState) return;

  if (type === "beat") {
    const parent = context.beats.get(id);
    if (!parent) {
      findings.blocked.add(REASON.MIX_DERIVATION_PARENT_MISSING);
      return;
    }
    if (!sameScope(row, parent)) {
      findings.blocked.add(REASON.MIX_DERIVATION_PARENT_SCOPE_MISMATCH);
    }
    if (classifyBeat(parent).classification !== "releasable") {
      findings.blocked.add(REASON.MIX_DERIVATION_PARENT_NOT_RELEASABLE);
    }
    const parentHash = certifiedHash(parent.contentHash);
    if (parentHash !== sourceHash) {
      findings.blocked.add(REASON.MIX_DERIVATION_PARENT_HASH_MISMATCH);
    }
    if (
      !parentHash ||
      releaseEvidenceHash({
        schemaVersion: 1,
        kind: "derived_mix",
        beatId: id,
        beatContentHash: parentHash,
        vocalRenderIds: [],
        vocalRenderContentHashes: [],
      }) !== claimHash
    ) {
      findings.blocked.add(REASON.MIX_DERIVATION_CLAIM_MISMATCH);
    }
    return;
  }

  if (type === "mix") {
    const parent = context.mixes.get(id);
    if (!parent) {
      findings.blocked.add(REASON.MIX_DERIVATION_PARENT_MISSING);
      return;
    }
    if (!sameScope(row, parent)) {
      findings.blocked.add(REASON.MIX_DERIVATION_PARENT_SCOPE_MISMATCH);
    }
    const parentResult = classifyMixInternal(parent, context, nextState);
    if (parentResult.classification !== "releasable") {
      findings.blocked.add(REASON.MIX_DERIVATION_PARENT_NOT_RELEASABLE);
    }
    if (certifiedHash(parent.contentHash) !== sourceHash) {
      findings.blocked.add(REASON.MIX_DERIVATION_PARENT_HASH_MISMATCH);
    }
    const parentClaim = releaseMixSourceClaim(parent.meta);
    if (!parentClaim || releaseEvidenceHash(parentClaim) !== claimHash) {
      findings.blocked.add(REASON.MIX_DERIVATION_CLAIM_MISMATCH);
    }
    return;
  }

  if (type !== "master") {
    findings.blocked.add(REASON.MIX_LINEAGE_INVALID);
    return;
  }
  const parent = context.masters.get(id);
  if (!parent) {
    findings.blocked.add(REASON.MIX_DERIVATION_PARENT_MISSING);
    return;
  }
  if (!sameScope(row, parent)) {
    findings.blocked.add(REASON.MIX_DERIVATION_PARENT_SCOPE_MISMATCH);
  }
  const parentResult = classifyMasterInternal(parent, context, nextState);
  if (parentResult.classification !== "releasable") {
    findings.blocked.add(REASON.MIX_DERIVATION_PARENT_NOT_RELEASABLE);
  }
  if (certifiedHash(parent.contentHash) !== sourceHash) {
    findings.blocked.add(REASON.MIX_DERIVATION_PARENT_HASH_MISMATCH);
  }
  const parentMixId = nonEmptyString(parent.mixId);
  const parentMix = parentMixId ? context.mixes.get(parentMixId) : null;
  const parentClaim = parentMix ? releaseMixSourceClaim(parentMix.meta) : null;
  if (!parentClaim || releaseEvidenceHash(parentClaim) !== claimHash) {
    findings.blocked.add(REASON.MIX_DERIVATION_CLAIM_MISMATCH);
  }
}

function classifyMixInternal(
  row: MixAuditInput,
  context: LegacyReleaseLineageContext,
  state: LineageWalkState
): LegacyReleaseLineageClassificationResult {
  const findings = classifyCertifiedAsset(row);
  const metadata = record(row.meta);
  if (row.meta !== null && row.meta !== undefined && !metadata) {
    findings.blocked.add(REASON.MIX_LINEAGE_INVALID);
    return finish(findings);
  }
  if (
    !metadata ||
    (!hasOwn(metadata, "source") && !hasOwn(metadata, "directOwnedUpload"))
  ) {
    findings.backfill.add(REASON.MIX_LINEAGE_MISSING);
    return finish(findings);
  }

  let claim: Record<string, unknown> | null = null;
  try {
    claim = releaseMixSourceClaim(row.meta);
  } catch {
    claim = null;
  }
  if (!claim) {
    findings.blocked.add(REASON.MIX_LINEAGE_INVALID);
    return finish(findings);
  }

  if (claim.kind === "direct_owned_upload") {
    const sourceHash = certifiedHash(claim.sourceContentHash);
    const mixHash = certifiedHash(row.contentHash);
    if (sourceHash && mixHash && sourceHash !== mixHash) {
      findings.blocked.add(REASON.MIX_SOURCE_HASH_MISMATCH);
    }
  } else if (claim.kind === "derived_mix") {
    validateDerivedMixComponents(row, claim, context, findings);
  } else {
    findings.blocked.add(REASON.MIX_LINEAGE_INVALID);
  }

  validateDerivation(row, claim, context, findings, state);
  return finish(findings);
}

export function classifyMix(
  row: MixAuditInput,
  context: LegacyReleaseLineageContext = createLegacyReleaseLineageContext({})
): LegacyReleaseLineageClassificationResult {
  return classifyMixInternal(row, context, initialWalkState("mix", row.id));
}

function classifyMasterInternal(
  row: MasterAuditInput,
  context: LegacyReleaseLineageContext,
  state: LineageWalkState
): LegacyReleaseLineageClassificationResult {
  const findings = classifyCertifiedAsset(row);
  const mixId = nonEmptyString(row.mixId);
  if (!mixId) {
    findings.backfill.add(REASON.MASTER_SOURCE_MIX_ID_MISSING);
  }

  const metadata = record(row.meta);
  if (row.meta !== null && row.meta !== undefined && !metadata) {
    findings.blocked.add(REASON.MASTER_SOURCE_METADATA_INVALID);
  }
  const metadataMixId = nonEmptyString(metadata?.sourceMixId);
  const metadataMixHash = certifiedHash(metadata?.sourceContentHash);
  if (
    !metadata ||
    (!hasOwn(metadata, "sourceMixId") && !hasOwn(metadata, "sourceContentHash"))
  ) {
    findings.backfill.add(REASON.MASTER_SOURCE_METADATA_MISSING);
  } else {
    if (!metadataMixId || (mixId && metadataMixId !== mixId)) {
      findings.blocked.add(REASON.MASTER_SOURCE_METADATA_INVALID);
    }
    if (missing(metadata.sourceContentHash)) {
      findings.backfill.add(REASON.MASTER_SOURCE_METADATA_MISSING);
    } else if (!metadataMixHash) {
      findings.blocked.add(REASON.MASTER_SOURCE_METADATA_INVALID);
    }
  }

  if (mixId) {
    const sourceMix = context.mixes.get(mixId);
    if (!sourceMix) {
      findings.blocked.add(REASON.MASTER_SOURCE_MIX_MISSING);
    } else {
      if (!sameScope(row, sourceMix)) {
        findings.blocked.add(REASON.MASTER_SOURCE_MIX_SCOPE_MISMATCH);
      }
      const key = `mix:${mixId}`;
      const nextState = addDerivationFinding(findings, state, key);
      const sourceResult = nextState
        ? classifyMixInternal(sourceMix, context, nextState)
        : null;
      if (!sourceResult || sourceResult.classification !== "releasable") {
        findings.blocked.add(REASON.MASTER_SOURCE_MIX_NOT_RELEASABLE);
      }
      const sourceHash = certifiedHash(sourceMix.contentHash);
      if (metadataMixHash && sourceHash !== metadataMixHash) {
        findings.blocked.add(REASON.MASTER_SOURCE_MIX_HASH_MISMATCH);
      }
    }
  }

  return finish(findings);
}

export function classifyMaster(
  row: MasterAuditInput,
  context: LegacyReleaseLineageContext = createLegacyReleaseLineageContext({})
): LegacyReleaseLineageClassificationResult {
  return classifyMasterInternal(
    row,
    context,
    initialWalkState("master", row.id)
  );
}

function failedCheck(
  certification: ReleaseCertificationSnapshotInput,
  name: string
): boolean {
  return certification.readiness.checks.some(
    check => check.name === name && !check.ok
  );
}

function selectedAudioClassification(
  release: ReleaseAuditInput,
  context: LegacyReleaseLineageContext
): LegacyReleaseLineageClassificationResult | null {
  const id = nonEmptyString(release.audioAssetId);
  if (!id) return null;
  if (release.audioAssetKind === "mix") {
    const row = context.mixes.get(id);
    return row ? classifyMix(row, context) : null;
  }
  if (release.audioAssetKind === "master") {
    const row = context.masters.get(id);
    return row ? classifyMaster(row, context) : null;
  }
  return null;
}

export function classifyRelease(
  row: ReleaseAuditInput,
  context: LegacyReleaseLineageContext = createLegacyReleaseLineageContext({})
): LegacyReleaseLineageClassificationResult {
  const findings = buckets();
  const id = nonEmptyString(row.id);
  const workspaceId = nonEmptyString(row.workspaceId);
  const projectId = nonEmptyString(row.projectId);
  const songId = nonEmptyString(row.songId);
  if (!id) findings.blocked.add(REASON.ASSET_ID_INVALID);
  if (!workspaceId || !songId) {
    findings.blocked.add(REASON.ASSET_SCOPE_INVALID);
  }
  if (!projectId) {
    findings.backfill.add(REASON.RELEASE_PROJECT_ID_MISSING);
  }
  if (row.status === "legacy_unverified") {
    findings.backfill.add(REASON.RELEASE_LEGACY_UNVERIFIED);
  }

  const audioId = nonEmptyString(row.audioAssetId);
  const audioKind = nonEmptyString(row.audioAssetKind);
  if (!audioId && !audioKind) {
    findings.backfill.add(REASON.RELEASE_AUDIO_REFERENCE_MISSING);
  } else if (!audioId || (audioKind !== "mix" && audioKind !== "master")) {
    findings.blocked.add(REASON.RELEASE_AUDIO_REFERENCE_INVALID);
  }

  const fingerprint = certifiedHash(row.artifactFingerprint);
  if (missing(row.artifactFingerprint)) {
    findings.backfill.add(REASON.RELEASE_ARTIFACT_FINGERPRINT_MISSING);
  } else if (!fingerprint) {
    findings.blocked.add(REASON.RELEASE_ARTIFACT_FINGERPRINT_INVALID);
  }
  const evidenceHash = certifiedHash(row.evidenceHash);
  if (missing(row.evidenceHash)) {
    findings.backfill.add(REASON.RELEASE_EVIDENCE_HASH_MISSING);
  } else if (!evidenceHash) {
    findings.blocked.add(REASON.RELEASE_EVIDENCE_HASH_INVALID);
  }
  const exportHash = certifiedHash(row.exportContentHash);
  if (missing(row.exportContentHash)) {
    findings.backfill.add(REASON.RELEASE_EXPORT_CONTENT_HASH_MISSING);
  } else if (!exportHash) {
    findings.blocked.add(REASON.RELEASE_EXPORT_CONTENT_HASH_INVALID);
  } else if (evidenceHash && evidenceHash !== exportHash) {
    findings.blocked.add(REASON.RELEASE_EVIDENCE_HASH_STALE);
  }

  const certification = row.certification;
  if (row.certificationUnavailable || !certification) {
    findings.blocked.add(REASON.RELEASE_CERTIFICATION_UNAVAILABLE);
    return finish(findings);
  }
  if (
    certification.song.id !== songId ||
    certification.song.workspaceId !== workspaceId ||
    (projectId && certification.song.projectId !== projectId)
  ) {
    findings.blocked.add(REASON.RELEASE_SCOPE_MISMATCH);
  }

  if (!certification.audio) {
    findings.blocked.add(REASON.RELEASE_AUDIO_NOT_READY);
  } else if (
    audioId &&
    audioKind &&
    (certification.audio.id !== audioId ||
      certification.audio.kind !== audioKind)
  ) {
    findings.blocked.add(REASON.RELEASE_AUDIO_REFERENCE_STALE);
  }
  if (
    fingerprint &&
    certifiedHash(certification.artifactFingerprint) !== fingerprint
  ) {
    findings.blocked.add(REASON.RELEASE_ARTIFACT_FINGERPRINT_STALE);
  }

  if (!certification.rightsReceipt) {
    findings.backfill.add(REASON.RELEASE_RIGHTS_RECEIPT_MISSING);
  } else {
    if (!certification.evidence.receiptHashValid) {
      findings.blocked.add(REASON.RELEASE_RIGHTS_RECEIPT_INVALID);
    }
    if (!certification.evidence.receiptCurrent) {
      findings.blocked.add(REASON.RELEASE_RIGHTS_RECEIPT_STALE);
    }
    if (!certification.evidence.rightsOk) {
      findings.blocked.add(REASON.RELEASE_RIGHTS_NOT_CLEAR);
    }
  }

  if (!certification.splitAttestation) {
    findings.backfill.add(REASON.RELEASE_SPLIT_ATTESTATION_MISSING);
  } else if (!certification.evidence.splitAttested) {
    findings.blocked.add(REASON.RELEASE_SPLIT_ATTESTATION_INVALID);
  }
  if (certification.requiredNativeLanguages.length > 0) {
    if (!certification.nativeAttestation) {
      findings.backfill.add(REASON.RELEASE_NATIVE_ATTESTATION_MISSING);
    } else if (!certification.evidence.nativeAttested) {
      findings.blocked.add(REASON.RELEASE_NATIVE_ATTESTATION_INVALID);
    }
  }

  if (failedCheck(certification, "Certified master or mix")) {
    findings.blocked.add(REASON.RELEASE_AUDIO_NOT_READY);
  }
  if (failedCheck(certification, "Approved cover art")) {
    findings.blocked.add(REASON.RELEASE_COVER_NOT_READY);
  }
  if (failedCheck(certification, "Approved lyrics")) {
    findings.blocked.add(REASON.RELEASE_LYRICS_NOT_READY);
  }
  if (failedCheck(certification, "Accepted split-sheet totals 100%")) {
    if (certification.splitSheet.length > 0 && certification.splitAttestation) {
      findings.blocked.add(REASON.RELEASE_SPLITS_NOT_READY);
    }
  }
  if (failedCheck(certification, "Exact audio lineage")) {
    const selected = selectedAudioClassification(row, context);
    if (selected?.classification === "requires_backfill") {
      findings.backfill.add(REASON.RELEASE_LINEAGE_BACKFILL_REQUIRED);
    } else {
      findings.blocked.add(REASON.RELEASE_LINEAGE_NOT_CURRENT);
    }
  }

  return finish(findings);
}

export interface LegacyReleaseLineageAuditRow extends LegacyReleaseLineageClassificationResult {
  entityType: LegacyReleaseLineageEntityType;
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  songId: string | null;
}

export interface LegacyReleaseLineageAuditFilters {
  workspaceId?: string;
  projectId?: string;
}

interface ClassificationCounts {
  releasable: number;
  blocked: number;
  requires_backfill: number;
}

export interface LegacyReleaseLineageAuditReport {
  schemaVersion: 1;
  filters: { workspaceId: string | null; projectId: string | null };
  summary: {
    total: number;
    findings: number;
    byClassification: ClassificationCounts;
    byEntity: Record<LegacyReleaseLineageEntityType, ClassificationCounts>;
  };
  rows: LegacyReleaseLineageAuditRow[];
}

function emptyCounts(): ClassificationCounts {
  return { releasable: 0, blocked: 0, requires_backfill: 0 };
}

function normalizedOutputString(value: unknown): string | null {
  return nonEmptyString(value);
}

function auditRow(
  entityType: LegacyReleaseLineageEntityType,
  row: {
    id: unknown;
    workspaceId: unknown;
    projectId: unknown;
    songId: unknown;
  },
  result: LegacyReleaseLineageClassificationResult
): LegacyReleaseLineageAuditRow {
  return {
    entityType,
    id: normalizedOutputString(row.id) ?? "<invalid>",
    workspaceId: normalizedOutputString(row.workspaceId),
    projectId: normalizedOutputString(row.projectId),
    songId: normalizedOutputString(row.songId),
    classification: result.classification,
    reasonCodes: [...result.reasonCodes].sort(compareAscii),
  };
}

function compareAuditRows(
  left: LegacyReleaseLineageAuditRow,
  right: LegacyReleaseLineageAuditRow
): number {
  return (
    ENTITY_ORDER[left.entityType] - ENTITY_ORDER[right.entityType] ||
    compareAscii(left.workspaceId ?? "", right.workspaceId ?? "") ||
    compareAscii(left.projectId ?? "", right.projectId ?? "") ||
    compareAscii(left.songId ?? "", right.songId ?? "") ||
    compareAscii(left.id, right.id)
  );
}

export function buildLegacyReleaseLineageAuditReport(
  rows: readonly LegacyReleaseLineageAuditRow[],
  filters: LegacyReleaseLineageAuditFilters = {}
): LegacyReleaseLineageAuditReport {
  const sortedRows = rows
    .map(row => ({
      ...row,
      reasonCodes: [...row.reasonCodes].sort(compareAscii),
    }))
    .sort(compareAuditRows);
  const byClassification = emptyCounts();
  const byEntity: Record<LegacyReleaseLineageEntityType, ClassificationCounts> =
    {
      beat: emptyCounts(),
      mix: emptyCounts(),
      master: emptyCounts(),
      release: emptyCounts(),
    };
  for (const row of sortedRows) {
    byClassification[row.classification] += 1;
    byEntity[row.entityType][row.classification] += 1;
  }
  return {
    schemaVersion: 1,
    filters: {
      workspaceId: filters.workspaceId ?? null,
      projectId: filters.projectId ?? null,
    },
    summary: {
      total: sortedRows.length,
      findings: byClassification.blocked + byClassification.requires_backfill,
      byClassification,
      byEntity,
    },
    rows: sortedRows,
  };
}

export function legacyReleaseLineageReportHasFindings(
  report: LegacyReleaseLineageAuditReport
): boolean {
  return report.summary.findings > 0;
}

interface PersistedAuditRows {
  beats: BeatAuditInput[];
  mixes: MixAuditInput[];
  masters: MasterAuditInput[];
  vocals: VocalAuditInput[];
}

function assetWhere(filters: LegacyReleaseLineageAuditFilters) {
  return {
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.workspaceId
      ? { project: { workspaceId: filters.workspaceId } }
      : {}),
  };
}

async function validateFilters(
  filters: LegacyReleaseLineageAuditFilters
): Promise<void> {
  if (filters.workspaceId) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: filters.workspaceId },
      select: { id: true },
    });
    if (!workspace) throw new Error("workspace_filter_not_found");
  }
  if (filters.projectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: filters.projectId,
        ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
      },
      select: { id: true },
    });
    if (!project) throw new Error("project_filter_not_found");
  }
}

async function loadPersistedAuditRows(
  filters: LegacyReleaseLineageAuditFilters
): Promise<PersistedAuditRows> {
  const where = assetWhere(filters);
  const [beatRows, mixRows, masterRows, vocalRows] = await Promise.all([
    prisma.beatAsset.findMany({
      where,
      select: {
        id: true,
        projectId: true,
        songId: true,
        approved: true,
        qualityState: true,
        contentHash: true,
        verifiedAt: true,
        assetKind: true,
        project: { select: { workspaceId: true } },
        song: { select: { projectId: true, workspaceId: true } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.mix.findMany({
      where,
      select: {
        id: true,
        projectId: true,
        songId: true,
        approved: true,
        qualityState: true,
        contentHash: true,
        verifiedAt: true,
        meta: true,
        project: { select: { workspaceId: true } },
        song: { select: { projectId: true, workspaceId: true } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.master.findMany({
      where,
      select: {
        id: true,
        projectId: true,
        songId: true,
        mixId: true,
        approved: true,
        qualityState: true,
        contentHash: true,
        verifiedAt: true,
        meta: true,
        project: { select: { workspaceId: true } },
        song: { select: { projectId: true, workspaceId: true } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.vocalRender.findMany({
      where,
      select: {
        id: true,
        projectId: true,
        songId: true,
        approved: true,
        qualityState: true,
        contentHash: true,
        verifiedAt: true,
        assetKind: true,
        project: { select: { workspaceId: true } },
        song: { select: { projectId: true, workspaceId: true } },
      },
      orderBy: { id: "asc" },
    }),
  ]);

  const scope = <
    T extends {
      project: { workspaceId: string };
      song: { projectId: string; workspaceId: string } | null;
    },
  >(
    row: T
  ) => ({
    workspaceId: row.project.workspaceId,
    songProjectId: row.song?.projectId,
    songWorkspaceId: row.song?.workspaceId,
  });
  return {
    beats: beatRows.map(row => ({ ...row, ...scope(row) })),
    mixes: mixRows.map(row => ({ ...row, ...scope(row) })),
    masters: masterRows.map(row => ({ ...row, ...scope(row) })),
    vocals: vocalRows.map(row => ({ ...row, ...scope(row) })),
  };
}

async function loadReleaseAuditRows(
  filters: LegacyReleaseLineageAuditFilters,
  context: LegacyReleaseLineageContext
): Promise<LegacyReleaseLineageAuditRow[]> {
  const releases = await prisma.release.findMany({
    where: {
      ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
    },
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      songId: true,
      status: true,
      audioAssetId: true,
      audioAssetKind: true,
      artifactFingerprint: true,
      evidenceHash: true,
      export: { select: { contentHash: true } },
    },
    orderBy: { id: "asc" },
  });

  const results: LegacyReleaseLineageAuditRow[] = [];
  for (const release of releases) {
    let certification: ReleaseCertificationSnapshotInput | null = null;
    let certificationUnavailable = false;
    try {
      certification = await loadReleaseCertification(prisma, {
        workspaceId: release.workspaceId,
        songId: release.songId,
        ...(release.projectId ? { projectId: release.projectId } : {}),
      });
    } catch {
      certificationUnavailable = true;
    }
    const input: ReleaseAuditInput = {
      ...release,
      exportContentHash: release.export?.contentHash ?? null,
      certification,
      certificationUnavailable,
    };
    results.push(auditRow("release", input, classifyRelease(input, context)));
  }
  return results;
}

export async function auditLegacyReleaseLineage(
  filters: LegacyReleaseLineageAuditFilters = {}
): Promise<LegacyReleaseLineageAuditReport> {
  await validateFilters(filters);
  const persisted = await loadPersistedAuditRows(filters);
  const context = createLegacyReleaseLineageContext(persisted);
  const rows: LegacyReleaseLineageAuditRow[] = [
    ...persisted.beats.map(row => auditRow("beat", row, classifyBeat(row))),
    ...persisted.mixes.map(row =>
      auditRow("mix", row, classifyMix(row, context))
    ),
    ...persisted.masters.map(row =>
      auditRow("master", row, classifyMaster(row, context))
    ),
    ...(await loadReleaseAuditRows(filters, context)),
  ];
  return buildLegacyReleaseLineageAuditReport(rows, filters);
}

export interface LegacyReleaseLineageCliOptions extends LegacyReleaseLineageAuditFilters {
  failOnFindings: boolean;
  help: boolean;
}

function optionValue(
  args: readonly string[],
  index: number,
  option: string
): { value: string; consumed: number } {
  const argument = args[index]!;
  const equalsPrefix = `${option}=`;
  const value = argument.startsWith(equalsPrefix)
    ? argument.slice(equalsPrefix.length)
    : args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(
      `missing_value_for_${option.slice(2).replaceAll("-", "_")}`
    );
  }
  return { value, consumed: argument.startsWith(equalsPrefix) ? 1 : 2 };
}

export function parseLegacyReleaseLineageCliArgs(
  args: readonly string[]
): LegacyReleaseLineageCliOptions {
  const options: LegacyReleaseLineageCliOptions = {
    failOnFindings: false,
    help: false,
  };
  for (let index = 0; index < args.length; ) {
    const argument = args[index]!;
    if (argument === "--fail-on-findings") {
      options.failOnFindings = true;
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      index += 1;
      continue;
    }
    const workspaceOption =
      argument === "--workspace" || argument.startsWith("--workspace=")
        ? "--workspace"
        : argument === "--workspace-id" ||
            argument.startsWith("--workspace-id=")
          ? "--workspace-id"
          : null;
    if (workspaceOption) {
      if (options.workspaceId) throw new Error("duplicate_workspace_filter");
      const parsed = optionValue(args, index, workspaceOption);
      options.workspaceId = parsed.value;
      index += parsed.consumed;
      continue;
    }
    const projectOption =
      argument === "--project" || argument.startsWith("--project=")
        ? "--project"
        : argument === "--project-id" || argument.startsWith("--project-id=")
          ? "--project-id"
          : null;
    if (projectOption) {
      if (options.projectId) throw new Error("duplicate_project_filter");
      const parsed = optionValue(args, index, projectOption);
      options.projectId = parsed.value;
      index += parsed.consumed;
      continue;
    }
    throw new Error(`unknown_argument_${argument}`);
  }
  return options;
}

export function legacyReleaseLineageAuditUsage(): string {
  return [
    "Usage: tsx scripts/audit-legacy-release-lineage.ts [options]",
    "",
    "Options:",
    "  --workspace, --workspace-id <id>  Restrict the audit to one workspace",
    "  --project, --project-id <id>      Restrict the audit to one project",
    "  --fail-on-findings                Exit 1 for blocked or backfill rows",
    "  --help                            Show this help",
  ].join("\n");
}

export function formatLegacyReleaseLineageSummary(
  report: LegacyReleaseLineageAuditReport
): string {
  const counts = report.summary.byClassification;
  return [
    "legacy release-lineage audit:",
    `total=${report.summary.total}`,
    `releasable=${counts.releasable}`,
    `blocked=${counts.blocked}`,
    `requires_backfill=${counts.requires_backfill}`,
  ].join(" ");
}

export async function runLegacyReleaseLineageAuditCli(
  args: readonly string[] = process.argv.slice(2)
): Promise<number> {
  let options: LegacyReleaseLineageCliOptions;
  try {
    options = parseLegacyReleaseLineageCliArgs(args);
  } catch (error) {
    console.error(
      `legacy release-lineage audit argument error: ${(error as Error).message}`
    );
    console.error(legacyReleaseLineageAuditUsage());
    return 2;
  }
  if (options.help) {
    console.log(legacyReleaseLineageAuditUsage());
    return 0;
  }

  try {
    const report = await auditLegacyReleaseLineage({
      workspaceId: options.workspaceId,
      projectId: options.projectId,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    console.error(formatLegacyReleaseLineageSummary(report));
    return options.failOnFindings &&
      legacyReleaseLineageReportHasFindings(report)
      ? 1
      : 0;
  } catch (error) {
    console.error(
      `legacy release-lineage audit failed closed: ${(error as Error).message}`
    );
    return 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void runLegacyReleaseLineageAuditCli().then(code => {
    process.exitCode = code;
  });
}

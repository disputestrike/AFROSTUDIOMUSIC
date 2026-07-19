export const VIDEO_EVIDENCE_VERSION = 1;

export type VideoEvidenceRow = {
  id: string;
  url: string;
  durationS?: number | null;
  provider?: string | null;
  createdAt: Date | string;
  meta?: unknown;
};

export interface VideoEvidenceReport {
  id: string;
  ok: boolean;
  evidenceVersion: number | null;
  missing: string[];
  warnings: string[];
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function positive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sha256(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validDate(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

export function sceneEvidenceReport(row: VideoEvidenceRow): VideoEvidenceReport {
  const meta = record(row.meta);
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!text(row.url)) missing.push("url");
  if (!text(row.provider) || row.provider === "assembler") missing.push("provider");
  if (!positive(row.durationS)) missing.push("durationS");
  if (!Number.isInteger(meta.shotIndex) || Number(meta.shotIndex) < 0)
    missing.push("meta.shotIndex");
  if (!text(meta.shotPrompt)) missing.push("meta.shotPrompt");
  if (!sha256(meta.contentHash)) missing.push("meta.contentHash");
  if (!positive(meta.sizeBytes)) missing.push("meta.sizeBytes");
  if (!positive(meta.width)) missing.push("meta.width");
  if (!positive(meta.height)) missing.push("meta.height");
  if (!positive(meta.measuredDurationS)) missing.push("meta.measuredDurationS");
  if (!text(meta.codec)) missing.push("meta.codec");
  if (!text(meta.container)) missing.push("meta.container");
  if (meta.qualityState !== "passed") missing.push("meta.qualityState");
  if (!text(meta.outputAspectRatio)) missing.push("meta.outputAspectRatio");

  const version =
    typeof meta.evidenceVersion === "number" &&
    Number.isInteger(meta.evidenceVersion)
      ? meta.evidenceVersion
      : null;
  if (version !== VIDEO_EVIDENCE_VERSION)
    warnings.push("legacy scene evidence has no current evidence version");
  if (!text(meta.providerJobId))
    warnings.push("legacy scene evidence has no provider job ID");
  if (!validDate(meta.renderedAt))
    warnings.push("legacy scene evidence has no render timestamp");

  const likeness = record(meta.likeness);
  if (Object.keys(likeness).length) {
    if (likeness.rightsBasis !== "user-attested-likeness")
      missing.push("meta.likeness.rightsBasis");
    if (!text(likeness.trainedModelRef))
      missing.push("meta.likeness.trainedModelRef");
    if (!text(likeness.consentId)) missing.push("meta.likeness.consentId");
    if (!text(likeness.keyframeRef)) missing.push("meta.likeness.keyframeRef");
  }
  return {
    id: row.id,
    ok: missing.length === 0,
    evidenceVersion: version,
    missing,
    warnings,
  };
}

export function assemblyEvidenceReport(
  row: VideoEvidenceRow
): VideoEvidenceReport {
  const meta = record(row.meta);
  const assembly = record(meta.assembly);
  const audio = record(assembly.audioSource);
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!text(row.url)) missing.push("url");
  if (row.provider !== "assembler") missing.push("provider=assembler");
  if (!positive(row.durationS)) missing.push("durationS");
  if (assembly.kind !== "full" && assembly.kind !== "teaser")
    missing.push("assembly.kind");
  if (!positive(assembly.durationS)) missing.push("assembly.durationS");
  if (!sha256(assembly.contentHash)) missing.push("assembly.contentHash");
  if (!positive(assembly.sizeBytes)) missing.push("assembly.sizeBytes");
  if (!positive(assembly.width)) missing.push("assembly.width");
  if (!positive(assembly.height)) missing.push("assembly.height");
  if (!validDate(assembly.renderedAt)) missing.push("assembly.renderedAt");
  if (!Array.isArray(assembly.shotsUsed) || !assembly.shotsUsed.length)
    missing.push("assembly.shotsUsed");
  if (!Array.isArray(assembly.renderIdsUsed) || !assembly.renderIdsUsed.length)
    missing.push("assembly.renderIdsUsed");
  if (!text(audio.id)) missing.push("assembly.audioSource.id");
  if (!new Set(["beat", "mix", "master"]).has(String(audio.type)))
    missing.push("assembly.audioSource.type");
  if (
    typeof audio.startS !== "number" ||
    !Number.isFinite(audio.startS) ||
    audio.startS < 0
  )
    missing.push("assembly.audioSource.startS");

  const version =
    typeof assembly.evidenceVersion === "number" &&
    Number.isInteger(assembly.evidenceVersion)
      ? assembly.evidenceVersion
      : null;
  if (version !== VIDEO_EVIDENCE_VERSION)
    warnings.push("legacy assembly has no current evidence version");
  if (!text(assembly.providerJobId))
    warnings.push("legacy assembly has no provider job ID");
  if (!text(assembly.codec) || !text(assembly.container))
    warnings.push("legacy assembly has incomplete codec/container evidence");
  if (assembly.qualityState !== "passed")
    warnings.push("legacy assembly has no explicit passed quality state");
  if (!Array.isArray(assembly.sourceSceneHashes))
    warnings.push("legacy assembly has no source-scene hash binding");

  return {
    id: row.id,
    ok: missing.length === 0,
    evidenceVersion: version,
    missing,
    warnings,
  };
}

export function completeSceneRows<T extends VideoEvidenceRow>(
  rows: readonly T[]
): { complete: T[]; reports: VideoEvidenceReport[] } {
  const reports = rows
    .filter(row => !record(row.meta).assembly)
    .map(sceneEvidenceReport);
  const completeIds = new Set(reports.filter(report => report.ok).map(report => report.id));
  return {
    complete: rows.filter(row => completeIds.has(row.id)),
    reports,
  };
}

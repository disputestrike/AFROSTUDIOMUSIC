export const VIDEO_EVIDENCE_VERSION = 1;

type EvidenceRow = {
  id?: string;
  url?: string | null;
  durationS?: number | null;
  provider?: string | null;
  meta?: unknown;
};

export interface EvidenceCompleteness {
  ok: boolean;
  missing: string[];
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

export function sceneEvidenceCompleteness(
  row: EvidenceRow,
  options: { likenessRequired?: boolean; requireVersion?: boolean } = {}
): EvidenceCompleteness {
  const meta = record(row.meta);
  const missing: string[] = [];
  if (!text(row.url)) missing.push("url");
  if (!text(row.provider) || row.provider === "assembler") missing.push("provider");
  if (!positive(row.durationS)) missing.push("durationS");
  if (
    options.requireVersion &&
    meta.evidenceVersion !== VIDEO_EVIDENCE_VERSION
  )
    missing.push("meta.evidenceVersion");
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
  if (options.requireVersion && !text(meta.providerJobId))
    missing.push("meta.providerJobId");
  if (options.requireVersion && !validDate(meta.renderedAt))
    missing.push("meta.renderedAt");

  const likeness = record(meta.likeness);
  if (options.likenessRequired || Object.keys(likeness).length > 0) {
    if (likeness.rightsBasis !== "user-attested-likeness")
      missing.push("meta.likeness.rightsBasis");
    if (!text(likeness.trainedModelRef))
      missing.push("meta.likeness.trainedModelRef");
    if (!text(likeness.consentId)) missing.push("meta.likeness.consentId");
    if (!text(likeness.keyframeRef)) missing.push("meta.likeness.keyframeRef");
  }
  return { ok: missing.length === 0, missing };
}

export function assertSceneEvidenceComplete(
  row: EvidenceRow,
  options: { likenessRequired?: boolean; requireVersion?: boolean } = {}
): void {
  const report = sceneEvidenceCompleteness(row, options);
  if (!report.ok) {
    throw new Error(`video_scene_evidence_incomplete: ${report.missing.join(", ")}`);
  }
}

export function assemblyEvidenceCompleteness(
  row: EvidenceRow
): EvidenceCompleteness {
  const meta = record(row.meta);
  const assembly = record(meta.assembly);
  const audio = record(assembly.audioSource);
  const sourceHashes = Array.isArray(assembly.sourceSceneHashes)
    ? assembly.sourceSceneHashes.map(record)
    : [];
  const renderIds = Array.isArray(assembly.renderIdsUsed)
    ? assembly.renderIdsUsed
    : [];
  const shots = Array.isArray(assembly.shotsUsed) ? assembly.shotsUsed : [];
  const missing: string[] = [];
  if (!text(row.url)) missing.push("url");
  if (row.provider !== "assembler") missing.push("provider=assembler");
  if (!positive(row.durationS)) missing.push("durationS");
  if (assembly.evidenceVersion !== VIDEO_EVIDENCE_VERSION)
    missing.push("assembly.evidenceVersion");
  if (assembly.kind !== "full" && assembly.kind !== "teaser")
    missing.push("assembly.kind");
  if (!positive(assembly.durationS)) missing.push("assembly.durationS");
  if (!sha256(assembly.contentHash)) missing.push("assembly.contentHash");
  if (!positive(assembly.sizeBytes)) missing.push("assembly.sizeBytes");
  if (!positive(assembly.width)) missing.push("assembly.width");
  if (!positive(assembly.height)) missing.push("assembly.height");
  if (!text(assembly.codec)) missing.push("assembly.codec");
  if (!text(assembly.container)) missing.push("assembly.container");
  if (assembly.qualityState !== "passed") missing.push("assembly.qualityState");
  if (!text(assembly.providerJobId)) missing.push("assembly.providerJobId");
  if (!validDate(assembly.renderedAt)) missing.push("assembly.renderedAt");
  if (!shots.length || shots.some(value => !Number.isInteger(value)))
    missing.push("assembly.shotsUsed");
  if (!renderIds.length || renderIds.some(value => !text(value)))
    missing.push("assembly.renderIdsUsed");
  if (
    sourceHashes.length !== renderIds.length ||
    sourceHashes.some(
      source => !text(source.renderId) || !sha256(source.contentHash)
    )
  )
    missing.push("assembly.sourceSceneHashes");
  if (!text(audio.id)) missing.push("assembly.audioSource.id");
  if (!new Set(["beat", "mix", "master"]).has(String(audio.type)))
    missing.push("assembly.audioSource.type");
  if (
    typeof audio.startS !== "number" ||
    !Number.isFinite(audio.startS) ||
    audio.startS < 0
  )
    missing.push("assembly.audioSource.startS");
  return { ok: missing.length === 0, missing };
}

export function assertAssemblyEvidenceComplete(row: EvidenceRow): void {
  const report = assemblyEvidenceCompleteness(row);
  if (!report.ok) {
    throw new Error(
      `video_assembly_evidence_incomplete: ${report.missing.join(", ")}`
    );
  }
}

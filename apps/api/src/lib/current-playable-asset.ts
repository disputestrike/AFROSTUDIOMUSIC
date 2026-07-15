import type { SongBlueprint } from '@afrohit/shared';

export type PlayableAssetType = 'beat' | 'mix' | 'master';

export interface PlayableAssetRow {
  id: string;
  url: string;
  createdAt: Date;
  approved?: boolean | null;
  qualityState?: string | null;
  contentHash?: string | null;
  verifiedAt?: Date | null;
  meta?: unknown;
  format?: string | null;
  duration?: number | null;
  bpm?: number | null;
}

export interface PlayableAssetCollections {
  beats?: ReadonlyArray<PlayableAssetRow>;
  mixes?: ReadonlyArray<PlayableAssetRow>;
  masters?: ReadonlyArray<PlayableAssetRow>;
}

export interface PlayableAssetCertification {
  status: 'certified' | 'uncertified';
  certified: boolean;
  approved: boolean;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: Date | null;
}

export interface PlayableAsset {
  type: PlayableAssetType;
  id: string;
  url: string;
  createdAt: Date;
  format: string;
  durationS: number | null;
  bpm: number | null;
  meta: unknown;
  certification: PlayableAssetCertification;
}

export interface PlayableAssetRef {
  type: PlayableAssetType;
  id: string;
  url: string;
  createdAt: Date;
  format: string;
  certification: PlayableAssetCertification;
}

export interface PlayableArrangement {
  durationS: number;
  boundaries: number[];
  bpm: number | null;
  structureSource: { type: PlayableAssetType; id: string } | null;
  inherited: boolean;
}

const TYPE_ORDER: Record<PlayableAssetType, number> = {
  beat: 0,
  mix: 1,
  master: 2,
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const finitePositive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const measuredValue = (value: unknown): unknown => asRecord(value).value;

const numericArray = (value: unknown): number[] => {
  const candidate = measuredValue(value);
  if (!Array.isArray(candidate)) return [];
  return candidate.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
};

function certificationOf(row: PlayableAssetRow): PlayableAssetCertification {
  const approved = row.approved === true;
  const qualityState = row.qualityState ?? 'unmeasured';
  const contentHash = row.contentHash?.trim() || null;
  const verifiedAt = row.verifiedAt instanceof Date && Number.isFinite(row.verifiedAt.getTime())
    ? row.verifiedAt
    : null;
  const certified = approved && qualityState === 'passed' && contentHash != null && verifiedAt != null;
  return {
    status: certified ? 'certified' : 'uncertified',
    certified,
    approved,
    qualityState,
    contentHash,
    verifiedAt,
  };
}

function normalizeAsset(type: PlayableAssetType, row: PlayableAssetRow): PlayableAsset {
  const meta = asRecord(row.meta);
  const measured = asRecord(meta.measured);
  const qc = asRecord(meta.qc);
  const durationS =
    finitePositive(measuredValue(measured.durationS))
    ?? finitePositive(row.duration)
    ?? finitePositive(qc.durationS);
  const bpm = finitePositive(measuredValue(measured.tempoBpm)) ?? finitePositive(row.bpm);
  return {
    type,
    id: row.id,
    url: row.url,
    createdAt: row.createdAt,
    format: type === 'beat' ? row.format ?? 'mp3' : 'wav',
    durationS,
    bpm,
    meta: row.meta,
    certification: certificationOf(row),
  };
}

function chronological(left: PlayableAsset, right: PlayableAsset): number {
  const byTime = left.createdAt.getTime() - right.createdAt.getTime();
  if (byTime !== 0) return byTime;
  const byType = TYPE_ORDER[left.type] - TYPE_ORDER[right.type];
  if (byType !== 0) return byType;
  const byId = left.id.localeCompare(right.id);
  return byId !== 0 ? byId : left.url.localeCompare(right.url);
}

/**
 * Oldest-to-newest playable history across every audio model. Consecutive rows
 * that point at the same bytes collapse to the newer wrapper, while a later
 * revert to an older URL remains a distinct chronological version.
 */
export function playableAssetHistory(collections: PlayableAssetCollections): PlayableAsset[] {
  const ordered = [
    ...(collections.beats ?? []).map((row) => normalizeAsset('beat', row)),
    ...(collections.mixes ?? []).map((row) => normalizeAsset('mix', row)),
    ...(collections.masters ?? []).map((row) => normalizeAsset('master', row)),
  ].filter((asset) => asset.id && asset.url).sort(chronological);

  const deduped: PlayableAsset[] = [];
  for (const asset of ordered) {
    const previous = deduped.at(-1);
    if (previous?.url !== asset.url) {
      deduped.push(asset);
      continue;
    }
    // A newer database wrapper around the same bytes cannot erase stronger
    // certification evidence. Prefer the newer wrapper only when it is also
    // certified, or when neither wrapper is certified.
    if (asset.certification.certified || !previous.certification.certified) {
      deduped[deduped.length - 1] = asset;
    }
  }
  return deduped;
}

export function currentPlayableAsset(collections: PlayableAssetCollections): PlayableAsset | null {
  const history = playableAssetHistory(collections);
  for (let index = history.length - 1; index >= 0; index--) {
    const asset = history[index]!;
    if (asset.certification.certified) return asset;
  }
  return null;
}

export function playableAssetRef(asset: PlayableAsset | null | undefined): PlayableAssetRef | null {
  if (!asset) return null;
  return {
    type: asset.type,
    id: asset.id,
    url: asset.url,
    createdAt: asset.createdAt,
    format: asset.format,
    certification: asset.certification,
  };
}

interface LocalArrangement {
  durationS: number | null;
  boundaries: number[];
  bpm: number | null;
  tempoFactor: number | null;
}

function localArrangement(asset: PlayableAsset): LocalArrangement {
  const meta = asRecord(asset.meta);
  const measured = asRecord(meta.measured);
  const arrangement = asRecord(meta.arrangement);
  const blueprint = asRecord(meta.blueprint);
  const transform = asRecord(meta.transform);
  const blueprintSections = Array.isArray(blueprint.sections) ? blueprint.sections : [];
  const measuredBoundaries = numericArray(measured.sectionBoundaries);
  const arrangementBoundaries = Array.isArray(arrangement.boundaries)
    ? arrangement.boundaries.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : [];
  const blueprintBoundaries = blueprintSections
    .map((section) => finiteNumber(asRecord(section).endS))
    .filter((value): value is number => value != null);
  const durationS =
    asset.durationS
    ?? finitePositive(arrangement.durationS)
    ?? finitePositive(blueprint.totalDurationS);
  const boundaries = measuredBoundaries.length
    ? measuredBoundaries
    : arrangementBoundaries.length
      ? arrangementBoundaries
      : blueprintBoundaries;
  return {
    durationS,
    boundaries,
    bpm: asset.bpm ?? finitePositive(arrangement.bpm) ?? finitePositive(blueprint.bpm),
    tempoFactor: finitePositive(transform.tempo),
  };
}

const normalizeBoundaries = (boundaries: number[], durationS: number): number[] =>
  [...new Set(boundaries
    .filter((value) => Number.isFinite(value) && value > 0 && value < durationS)
    .map((value) => Math.round(value * 1000) / 1000))]
    .sort((left, right) => left - right);

/** Resolve the selected version's current timeline, not the newest beat's. */
export function playableArrangement(
  history: ReadonlyArray<PlayableAsset>,
  target: PlayableAsset | number | null | undefined = history.length - 1,
): PlayableArrangement | null {
  const targetIndex = typeof target === 'number'
    ? target
    : target
      ? history.findIndex((asset) => asset.type === target.type && asset.id === target.id)
      : history.length - 1;
  if (targetIndex < 0 || targetIndex >= history.length) return null;

  const selected = history[targetIndex]!;
  const selectedLocal = localArrangement(selected);
  let structureIndex = -1;
  let tempoIndex = -1;
  for (let index = targetIndex; index >= 0; index--) {
    const local = localArrangement(history[index]!);
    if (structureIndex < 0 && local.boundaries.length) structureIndex = index;
    if (tempoIndex < 0 && local.bpm != null) tempoIndex = index;
    if (structureIndex >= 0 && tempoIndex >= 0) break;
  }

  const structureAsset = structureIndex >= 0 ? history[structureIndex]! : null;
  const structure = structureAsset ? localArrangement(structureAsset) : null;
  const durationS = selectedLocal.durationS ?? structure?.durationS;
  if (durationS == null) return null;

  const structureDuration = structure?.durationS ?? durationS;
  const scale = structureDuration > 0 ? durationS / structureDuration : 1;
  const boundaries = normalizeBoundaries(
    (structure?.boundaries ?? []).map((boundary) => boundary * scale),
    durationS,
  );

  let bpm = tempoIndex >= 0 ? localArrangement(history[tempoIndex]!).bpm : null;
  if (bpm != null) {
    for (let index = tempoIndex + 1; index <= targetIndex; index++) {
      const factor = localArrangement(history[index]!).tempoFactor;
      if (factor != null) bpm *= factor;
    }
    bpm = Math.round(bpm * 1000) / 1000;
  }

  return {
    durationS,
    boundaries,
    bpm,
    structureSource: structureAsset ? { type: structureAsset.type, id: structureAsset.id } : null,
    inherited: structureAsset != null && (structureAsset.type !== selected.type || structureAsset.id !== selected.id),
  };
}

export function arrangementBlueprint(arrangement: PlayableArrangement | null | undefined): SongBlueprint | null {
  if (!arrangement || arrangement.durationS < 20) return null;
  const edges = [0, ...normalizeBoundaries(arrangement.boundaries, arrangement.durationS), arrangement.durationS];
  const secondsPerBar = arrangement.bpm ? (60 / arrangement.bpm) * 4 : null;
  const sections = edges.slice(0, -1).map((startS, index) => {
    const endS = edges[index + 1]!;
    return {
      index,
      startS,
      endS,
      bars: secondsPerBar ? Math.max(1, Math.round((endS - startS) / secondsPerBar)) : null,
    };
  }).filter((section) => section.endS - section.startS >= 4);
  if (sections.length < 2) return null;
  const totalBars = sections.every((section) => section.bars != null)
    ? sections.reduce((sum, section) => sum + (section.bars ?? 0), 0)
    : null;
  const structureString = sections
    .map((section) => `S${section.index + 1} ${section.bars != null ? `${section.bars}b` : `${Math.round(section.endS - section.startS)}s`}`)
    .join(' / ') + (arrangement.bpm ? ` @ ${Math.round(arrangement.bpm)} BPM` : '');
  return {
    bpm: arrangement.bpm ? Math.round(arrangement.bpm) : null,
    totalDurationS: Math.round(arrangement.durationS),
    totalBars,
    sections,
    structureString,
  };
}

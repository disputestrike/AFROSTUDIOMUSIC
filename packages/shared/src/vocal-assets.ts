export const VOCAL_ASSET_KINDS = ['isolated_vocal', 'spoken_guide', 'full_mix'] as const;
export type VocalAssetKind = (typeof VOCAL_ASSET_KINDS)[number];

export const VOCAL_PERFORMANCE_SOURCES = [
  'artist_upload',
  'artist_import',
  'voice_conversion',
  'score_synth',
  'tts_guide',
  'stem_separation',
  'unknown',
] as const;
export type VocalPerformanceSource = (typeof VOCAL_PERFORMANCE_SOURCES)[number];

export const VOCAL_QUALITY_STATES = ['pending', 'passed', 'failed', 'unmeasured'] as const;
export type VocalQualityState = (typeof VOCAL_QUALITY_STATES)[number];

export interface VocalAssetGateInput {
  approved: boolean;
  assetKind: string;
  qualityState: string;
  contentHash?: string | null;
  verifiedAt?: Date | string | null;
}

/** One law for every mix surface: only measured, isolated audio is a vocal. */
export function isMixableVocal(asset: VocalAssetGateInput): boolean {
  return asset.approved === true
    && asset.assetKind === 'isolated_vocal'
    && asset.qualityState === 'passed'
    && typeof asset.contentHash === 'string'
    && asset.contentHash.length === 64
    && asset.verifiedAt != null;
}

export interface DatedAsset {
  id: string;
  createdAt: Date | string;
}

export interface DatedVocalAsset extends DatedAsset, VocalAssetGateInput {
  role: string;
}

function newestFirst<T extends DatedAsset>(left: T, right: T): number {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

/** Default console/session selection: one current beat and one current take per
 * vocal role. Older takes remain in storage/history, but never all start playing
 * at once just because they are approved. */
export function selectDefaultSessionAssets<TBeat extends DatedAsset, TVocal extends DatedVocalAsset>(
  beats: TBeat[],
  vocals: TVocal[],
): { beats: TBeat[]; vocals: TVocal[] } {
  const currentBeat = [...beats].sort(newestFirst)[0];
  const selectedVocals: TVocal[] = [];
  const seenRoles = new Set<string>();
  for (const vocal of [...vocals].filter(isMixableVocal).sort(newestFirst)) {
    const role = vocal.role || 'lead';
    if (seenRoles.has(role)) continue;
    seenRoles.add(role);
    selectedVocals.push(vocal);
  }
  return { beats: currentBeat ? [currentBeat] : [], vocals: selectedVocals };
}

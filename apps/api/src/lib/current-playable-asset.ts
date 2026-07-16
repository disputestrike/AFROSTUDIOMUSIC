/**
 * THE PLAYABLE-ASSET LAW moved to @afrohit/shared (playable-asset.ts) so the
 * worker's auto-assemble trigger resolves a concept's audio through the exact
 * same pure law — this file stays as the API-side import path so no existing
 * route changes. One law, one source; this is a re-export, not a copy.
 */
export {
  playableAssetHistory,
  currentPlayableAsset,
  playableAssetRef,
  playableArrangement,
  arrangementBlueprint,
  type PlayableAssetType,
  type PlayableAssetRow,
  type PlayableAssetCollections,
  type PlayableAssetCertification,
  type PlayableAsset,
  type PlayableAssetRef,
  type PlayableArrangement,
} from '@afrohit/shared';

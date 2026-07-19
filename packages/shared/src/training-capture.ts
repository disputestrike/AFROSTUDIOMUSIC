/**
 * TRAINING CAPTURE (pure half) — catalog-row → provenance mappers + the
 * manifest builder. Moved from apps/api/lib so the WORKER's nightly flywheel
 * (P3, owner approval 2026-07-19) classifies assets with EXACTLY the same
 * rights logic the API admin manifest uses — one law, two callers, zero drift.
 *
 * The live DB reads stay app-side (each app queries its own slice); everything
 * here is pure and unit-tested on real-catalog-shaped fixtures.
 */
import {
  buildTrainingManifest,
  type AssetProvenance,
  type TrainingManifest,
} from './training-corpus';

/** MaterialAsset (instrument/beat loop) → provenance. */
export function materialToProvenance(row: {
  id: string;
  source?: string | null;
  rightsBasis?: string | null;
  consentGranted?: boolean;
}): AssetProvenance {
  return { id: `material:${row.id}`, materialSource: row.source, rightsBasis: row.rightsBasis, consentGranted: row.consentGranted };
}

/** BeatAsset (instrumental / full mix) → provenance. `provider` IS the engine —
 *  EXCEPT when the bed carries a third-party melody topping (meta.melodyLayer,
 *  e.g. MusicGen mixed into an "afrohit-own" render): the MOST RESTRICTIVE
 *  origin wins, so a musicgen-layered bed classifies as a third-party render
 *  and can NEVER train our model (rights doctrine — their ToS, our line). */
export function beatToProvenance(row: {
  id: string;
  provider?: string | null;
  consentGranted?: boolean;
  meta?: unknown;
}): AssetProvenance {
  const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
    ? (row.meta as Record<string, unknown>)
    : null;
  const layer = meta?.melodyLayer && typeof meta.melodyLayer === 'object'
    ? (meta.melodyLayer as Record<string, unknown>)
    : null;
  const layerEngine = typeof layer?.engine === 'string' && layer.engine.trim() ? layer.engine : null;
  return { id: `beat:${row.id}`, engine: layerEngine ?? row.provider, consentGranted: row.consentGranted };
}

/** VocalRender → provenance. performanceSource carries the origin. */
export function vocalToProvenance(row: {
  id: string;
  performanceSource?: string | null;
  consentGranted?: boolean;
}): AssetProvenance {
  return { id: `vocal:${row.id}`, performanceSource: row.performanceSource, consentGranted: row.consentGranted };
}

export interface CaptureInput {
  materials: Array<{ id: string; source?: string | null; rightsBasis?: string | null }>;
  beats: Array<{ id: string; provider?: string | null; meta?: unknown }>;
  vocals: Array<{ id: string; performanceSource?: string | null }>;
}

/**
 * PURE: map a catalog snapshot → a training manifest. `consentGranted` is the
 * resolved training-license verdict for THIS workspace (applied to user-original
 * assets). Fully testable without a DB.
 */
export function manifestFromCatalog(input: CaptureInput, consentGranted: boolean): TrainingManifest {
  const rows: AssetProvenance[] = [
    ...input.materials.map((m) => materialToProvenance({ ...m, consentGranted })),
    ...input.beats.map((b) => beatToProvenance({ ...b, consentGranted })),
    ...input.vocals.map((v) => vocalToProvenance({ ...v, consentGranted })),
  ];
  return buildTrainingManifest(rows);
}

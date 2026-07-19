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
  /** rightsBasis of every ingredient MaterialAsset (assembled beds carry
   *  meta.materialIds; callers resolve them). A bed is as clean as its
   *  DIRTIEST loop: any provider-generated/unresolvable ingredient refuses the
   *  whole bed; any user-attested makes it consent-gated; all code/self-
   *  generated = own-master. This is what lets the own engine's assembled
   *  records ('provider: material' — previously classified UNKNOWN and thrown
   *  away, owner incident 2026-07-19 "why only 38?") count as fuel honestly. */
  ingredientRights?: Array<string | null | undefined>;
}): AssetProvenance {
  const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
    ? (row.meta as Record<string, unknown>)
    : null;
  const layer = meta?.melodyLayer && typeof meta.melodyLayer === 'object'
    ? (meta.melodyLayer as Record<string, unknown>)
    : null;
  const layerEngine = typeof layer?.engine === 'string' && layer.engine.trim() ? layer.engine : null;
  // INGREDIENT LAW (most restrictive wins, after the melody-topping check):
  if (!layerEngine && row.ingredientRights?.length) {
    const rights = row.ingredientRights.map(r => (r ?? '').trim().toLowerCase());
    if (rights.some(r => r === 'provider-generated')) {
      return { id: `beat:${row.id}`, rightsBasis: 'provider-generated', consentGranted: row.consentGranted };
    }
    if (rights.some(r => !r || r === 'unknown')) {
      // an unresolvable ingredient fails the whole bed closed
      return { id: `beat:${row.id}`, engine: row.provider, consentGranted: row.consentGranted };
    }
    if (rights.some(r => r === 'user-attested')) {
      return { id: `beat:${row.id}`, materialSource: 'upload', rightsBasis: 'user-attested', consentGranted: row.consentGranted };
    }
    // all ingredients code/self-generated → the bed is fully our own audio
    return { id: `beat:${row.id}`, rightsBasis: 'self-generated', consentGranted: row.consentGranted };
  }
  // THE OWNERSHIP VOUCH (audit 2026-07-19): an uploaded/imported instrumental
  // carries the artist's "user-attested" rights vouch in meta — it used to sit
  // UNREAD, so owner uploads classified 'unknown' and were refused. With no
  // third-party melody topping, an attested import/upload now classifies as
  // USER-ORIGINAL (consent-gated — the door, not a bypass).
  const provider = (row.provider ?? '').trim().toLowerCase();
  const sourceMeta = meta?.sourceMeta && typeof meta.sourceMeta === 'object'
    ? (meta.sourceMeta as Record<string, unknown>)
    : null;
  const attested =
    meta?.rightsBasis === 'user-attested' || sourceMeta?.rightsBasis === 'user-attested';
  if (!layerEngine && attested && (provider === 'import' || provider === 'upload')) {
    return {
      id: `beat:${row.id}`,
      materialSource: 'upload',
      rightsBasis: 'user-attested',
      consentGranted: row.consentGranted,
    };
  }
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
  beats: Array<{ id: string; provider?: string | null; meta?: unknown; ingredientRights?: Array<string | null | undefined> }>;
  vocals: Array<{ id: string; performanceSource?: string | null }>;
}

/** The ingredient MaterialAsset ids an assembled bed was built from
 *  (meta.materialIds) — callers resolve these to rightsBasis values and pass
 *  them back as `ingredientRights` for the lineage-aware classification. */
export function beatIngredientIds(meta: unknown): string[] {
  const m = meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null;
  return Array.isArray(m?.materialIds)
    ? (m.materialIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)
    : [];
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

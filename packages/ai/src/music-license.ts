/**
 * MODEL LICENSE LAW + PER-GENRE/LANGUAGE ADAPTER ROUTES (trainlegal wave).
 *
 * THE LEGAL BUG THIS FILE FIXES (audit 2026-07-20, highest priority): Meta's
 * MusicGen weights ship under CC-BY-NC-4.0 — NON-COMMERCIAL. A fine-tuned
 * adapter of non-commercial weights is a derivative of those weights and may
 * NEVER back a commercial render. Our default trainer
 * (sakemin/musicgen-fine-tuner) fine-tunes MusicGen, so every adapter it
 * produces is CC-BY-NC by inheritance — training on our rights-clean corpus
 * does not launder the BASE MODEL's license. Until this wave, a promoted
 * MusicGen fine-tune backed the paid own-engine trained layer: a live license
 * violation.
 *
 * THE FIX, code-enforced (never a comment):
 *  - every model ref classifies to a license (MODEL_LICENSES); anything not
 *    positively classified as commercial-friendly FAILS CLOSED to 'unknown',
 *  - two route LANES exist: 'production' (commercial renders) and 'dev'
 *    (isolated experiments, never a paying user's take),
 *  - laneForBaseModel() puts every non-commercial or unknown base in 'dev';
 *    decideMusicCandidatePromotion (music-training-evaluation.ts) can then
 *    NEVER promote such an adapter to the production route,
 *  - the per-(genre|language) adapter route table stores license + lane per
 *    entry and resolveMusicAdapterRoute() refuses to hand a production render
 *    anything but a commercially-licensed production-lane adapter.
 *
 * Everything here is PURE (no fetch, no DB) so the same law runs identically
 * in the API seam, the worker flywheel, and the offline test gates.
 */

export type ModelLicense = 'cc-by-nc' | 'apache-2.0' | 'unknown';
export type RouteLane = 'dev' | 'production';

/**
 * Base-model families we knowingly train/serve, keyed by the substring that
 * identifies the family inside a model ref (trainer slug, destination name,
 * or candidate ref). Matching is substring-based because Replicate refs vary
 * ('sakemin/musicgen-fine-tuner', 'meta/musicgen-stereo-melody', ...).
 *  - musicgen  → CC-BY-NC-4.0 (Meta's published weight license) — NEVER commercial.
 *  - ace-step  → Apache-2.0 (open, commercial-friendly).
 *  - yue       → Apache-2.0 (open, commercial-friendly).
 * Anything unmatched is 'unknown' — and unknown NEVER opens the production lane.
 */
export const MODEL_LICENSES: Readonly<Record<string, ModelLicense>> = {
  musicgen: 'cc-by-nc',
  'ace-step': 'apache-2.0',
  ace_step: 'apache-2.0',
  acestep: 'apache-2.0', // hyphen-less trainer slugs (e.g. owner/acestep-1.5-lora)
  yue: 'apache-2.0',
};

/** Licenses that permit backing COMMERCIAL renders. The list is intentionally
 *  a positive allowlist — 'unknown' can never sneak in. */
const COMMERCIAL_LICENSES: ReadonlySet<ModelLicense> = new Set(['apache-2.0']);

export function commercialLicense(license: ModelLicense): boolean {
  return COMMERCIAL_LICENSES.has(license);
}

/** Classify a model ref (trainer slug / candidate ref / adapter ref) to its
 *  base-model license. Fail-closed: no match → 'unknown'. */
export function classifyModelLicense(modelRef: string | null | undefined): ModelLicense {
  const text = (modelRef ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
  for (const [family, license] of Object.entries(MODEL_LICENSES)) {
    if (text.includes(family)) return license;
  }
  return 'unknown';
}

/** May adapters of this base model back commercial renders? Fail-closed. */
export function licenseAllowsCommercial(modelRef: string | null | undefined): boolean {
  return commercialLicense(classifyModelLicense(modelRef));
}

/** The lane an adapter of this base model is ALLOWED to occupy. Non-commercial
 *  and unknown bases are confined to the isolated dev lane, always. */
export function laneForBaseModel(modelRef: string | null | undefined): RouteLane {
  return licenseAllowsCommercial(modelRef) ? 'production' : 'dev';
}

/** The receipt that rides every promotion decision — WHY the lane was chosen,
 *  in plain words, so the block is auditable and never silent. */
export function licenseGateReceipt(baseModelRef: string | null | undefined): string {
  const ref = (baseModelRef ?? '').trim() || '(base model unrecorded)';
  const license = classifyModelLicense(baseModelRef);
  if (commercialLicense(license)) {
    return `LICENSE GATE: base model '${ref}' classifies ${license} — commercial use permitted; production lane open.`;
  }
  if (license === 'cc-by-nc') {
    return `LICENSE GATE: base model '${ref}' classifies cc-by-nc (MusicGen weights are CC-BY-NC-4.0) — a fine-tuned adapter of non-commercial weights may NEVER back a commercial/production render; promotion is confined to the isolated 'dev' lane.`;
  }
  return `LICENSE GATE: base model '${ref}' has no known license classification — fail-closed to the isolated 'dev' lane; only a positively known commercial license (apache-2.0) opens the production lane.`;
}

// ---------------------------------------------------------------------------
// PER-(GENRE|LANGUAGE) ADAPTER ROUTE TABLE — one active pointer per key
// instead of one global active model, each entry carrying its license + lane.
// ---------------------------------------------------------------------------

export interface MusicAdapterRouteEntry {
  modelRef: string;
  /** License inherited from the BASE model the adapter was fine-tuned from. */
  license: ModelLicense;
  /** 'production' only when the license is commercial — coerced otherwise. */
  lane: RouteLane;
  /** The trainer/base model ref the adapter came from (provenance). */
  trainedFrom?: string | null;
  activatedAt: string;
}

export interface MusicAdapterRouteTable {
  schemaVersion: 1;
  /** key ('genre:<g>' | 'language:<l>') → active adapter for that lane slice. */
  adapters: Record<string, MusicAdapterRouteEntry>;
  updatedAt: string;
}

export function emptyMusicAdapterRouteTable(
  at = new Date(0).toISOString()
): MusicAdapterRouteTable {
  return { schemaVersion: 1, adapters: {}, updatedAt: at };
}

/** Canonical route key for one genre or language slice. */
export function musicAdapterRouteKey(input: {
  genre?: string | null;
  language?: string | null;
}): string | null {
  const genre = input.genre?.trim().toLowerCase();
  if (genre) return `genre:${genre}`;
  const language = input.language?.trim().toLowerCase();
  if (language) return `language:${language}`;
  return null;
}

/** Resolution order for a render: the genre slice first, then the language
 *  slice, then the caller's base fallback. */
export function musicAdapterRouteKeys(input: {
  genre?: string | null;
  language?: string | null;
}): string[] {
  const keys: string[] = [];
  const genre = input.genre?.trim().toLowerCase();
  if (genre) keys.push(`genre:${genre}`);
  const language = input.language?.trim().toLowerCase();
  if (language) keys.push(`language:${language}`);
  return keys;
}

/** LANE COERCION, enforced at every write AND every parse: an entry whose
 *  license is not commercial can only ever sit in the dev lane — even a
 *  hand-edited SystemSetting row cannot smuggle a cc-by-nc adapter into
 *  production. */
function coerceEntryLane(entry: MusicAdapterRouteEntry): MusicAdapterRouteEntry {
  if (entry.lane === 'production' && !commercialLicense(entry.license)) {
    return { ...entry, lane: 'dev' };
  }
  return entry;
}

function adapterEntry(value: unknown): MusicAdapterRouteEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.modelRef !== 'string' || !row.modelRef.trim()) return null;
  if (typeof row.activatedAt !== 'string' || !row.activatedAt) return null;
  const license: ModelLicense =
    row.license === 'cc-by-nc' || row.license === 'apache-2.0'
      ? row.license
      : 'unknown';
  const lane: RouteLane = row.lane === 'production' ? 'production' : 'dev';
  return coerceEntryLane({
    modelRef: row.modelRef.trim(),
    license,
    lane,
    trainedFrom: typeof row.trainedFrom === 'string' ? row.trainedFrom : null,
    activatedAt: row.activatedAt,
  });
}

export function parseMusicAdapterRouteTable(
  raw: string | null | undefined
): MusicAdapterRouteTable {
  if (!raw) return emptyMusicAdapterRouteTable();
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.schemaVersion !== 1) return emptyMusicAdapterRouteTable();
    const adapters: Record<string, MusicAdapterRouteEntry> = {};
    const rows =
      value.adapters && typeof value.adapters === 'object' && !Array.isArray(value.adapters)
        ? (value.adapters as Record<string, unknown>)
        : {};
    for (const [key, row] of Object.entries(rows)) {
      if (!/^(genre|language):[a-z0-9 _-]+$/.test(key)) continue;
      const entry = adapterEntry(row);
      if (entry) adapters[key] = entry;
    }
    return {
      schemaVersion: 1,
      adapters,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyMusicAdapterRouteTable();
  }
}

/** Upsert one adapter route. License is (re)classified from the base model so
 *  a caller cannot assert a friendlier license than the base carries; the lane
 *  is coerced by that license. */
export function upsertMusicAdapterRoute(input: {
  table: MusicAdapterRouteTable;
  key: string;
  modelRef: string;
  trainedFrom?: string | null;
  lane?: RouteLane;
  at?: string;
}): MusicAdapterRouteTable {
  const at = input.at ?? new Date().toISOString();
  const license = classifyModelLicense(input.trainedFrom ?? input.modelRef);
  const entry = coerceEntryLane({
    modelRef: input.modelRef,
    license,
    lane: input.lane ?? laneForBaseModel(input.trainedFrom ?? input.modelRef),
    trainedFrom: input.trainedFrom ?? null,
    activatedAt: at,
  });
  return {
    schemaVersion: 1,
    adapters: { ...input.table.adapters, [input.key]: entry },
    updatedAt: at,
  };
}

export interface MusicAdapterResolution {
  modelRef: string | null;
  source: 'genre' | 'language' | 'base' | 'none';
  key?: string;
  receipt: string;
}

/**
 * Resolve the adapter for one render slice, with base fallback. A PRODUCTION
 * query only ever sees production-lane entries with a commercial license —
 * dev-lane adapters are invisible to paying renders BY CONSTRUCTION. A dev
 * query may see everything (that is what the isolated lane is for).
 */
export function resolveMusicAdapterRoute(
  table: MusicAdapterRouteTable,
  query: {
    genre?: string | null;
    language?: string | null;
    lane: RouteLane;
    baseModelRef?: string | null;
  }
): MusicAdapterResolution {
  for (const key of musicAdapterRouteKeys(query)) {
    const entry = table.adapters[key];
    if (!entry) continue;
    if (
      query.lane === 'production' &&
      (entry.lane !== 'production' || !commercialLicense(entry.license))
    ) {
      continue; // license law: never route a commercial render to this adapter
    }
    return {
      modelRef: entry.modelRef,
      source: key.startsWith('genre:') ? 'genre' : 'language',
      key,
      receipt: `adapter route: ${key} → ${entry.modelRef} (license ${entry.license}, lane ${entry.lane})`,
    };
  }
  if (query.baseModelRef) {
    return {
      modelRef: query.baseModelRef,
      source: 'base',
      receipt: `adapter route: no ${query.lane}-lane adapter for the requested slice — base fallback ${query.baseModelRef}`,
    };
  }
  return {
    modelRef: null,
    source: 'none',
    receipt: `adapter route: no ${query.lane}-lane adapter and no base fallback`,
  };
}

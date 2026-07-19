/**
 * GENRE CANONICALIZATION — the audit's highest-leverage quick-win (approved
 * 2026-07-19). Every musical table (kits, signatures, DNA, palettes) keys on
 * the raw genre string, so 'Lo-Fi', 'hip hop', 'afro r&b', 'Amapiano',
 * 'UK drill', 'praise song' silently missed and fell to the generic
 * 106bpm/A-minor defaults. MEASURED: the heuristic resolved 4/12 real chat
 * requests; 7 of the 8 misses were pure case/space/hyphen/alias brittleness —
 * this one normalization flips them.
 *
 * Pure + conservative: fold case/diacritics/separators, then exact-match into
 * the canonical GENRES enum, then a hand-checked alias table. Unknown genres
 * return null — callers keep their existing fallback, they just stop missing
 * genres we DO have tables for.
 */
import { GENRES } from './constants';

export type CanonicalGenre = (typeof GENRES)[number];

const GENRE_SET = new Set<string>(GENRES);

/** Fold a raw genre string to lookup shape: lowercase, strip diacritics,
 *  '&'→'n', separators→'_', drop stray punctuation, collapse underscores. */
export function foldGenre(raw?: string | null): string {
  return (raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // jùjú → juju, coupé-décalé → coupe-decale
    .replace(/&/g, 'n') // r&b → rnb
    .replace(/[\s/-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Hand-checked aliases (folded form → canonical). Every entry maps a REAL
 *  user phrasing seen in chat/create onto a genre we have full tables for. */
const GENRE_ALIASES: Record<string, CanonicalGenre> = {
  // afro core
  afrobeat: 'afrobeats',
  afro_beat: 'afrobeats',
  afro_beats: 'afrobeats',
  afrofusion: 'afro_fusion',
  afropop: 'afro_pop',
  afrosoul: 'afro_soul',
  afrohouse: 'afro_house',
  afrogospel: 'afro_gospel',
  afrodancehall: 'afro_dancehall',
  afrornb: 'afro_rnb',
  afro_rb: 'afro_rnb',
  afro_randb: 'afro_rnb',
  afro_rnb_soul: 'afro_rnb',
  // street / rap
  streetpop: 'street_pop',
  street_pop_zanku: 'street_pop',
  zanku: 'street_pop',
  hiphop: 'hip_hop',
  hip_hop_rap: 'hip_hop',
  rap: 'hip_hop',
  uk_drill: 'drill',
  // rnb / pop / global
  rb: 'rnb',
  randb: 'rnb',
  r_n_b: 'rnb',
  lo_fi: 'lofi',
  lofi_hip_hop: 'lofi',
  lo_fi_hip_hop: 'lofi',
  latinpop: 'latin_pop',
  dance_hall: 'dancehall',
  // continental
  bongoflava: 'bongo_flava',
  bongo: 'bongo_flava',
  coupedecale: 'coupe_decale',
  // faith
  praise_song: 'praise',
  praise_songs: 'praise',
  praise_worship: 'praise',
  worship_song: 'worship',
  gospel_music: 'gospel',
};

/**
 * Resolve ANY user/AI genre phrasing to the canonical enum, or null when we
 * genuinely have no table for it. 'Amapiano'→'amapiano', 'Lo-Fi'→'lofi',
 * 'hip hop'→'hip_hop', 'afro r&b'→'afro_rnb', 'UK drill'→'drill',
 * 'praise song'→'praise', 'Jùjú'→'juju'.
 */
export function canonicalizeGenre(raw?: string | null): CanonicalGenre | null {
  const folded = foldGenre(raw);
  if (!folded) return null;
  if (GENRE_SET.has(folded)) return folded as CanonicalGenre;
  const alias = GENRE_ALIASES[folded];
  if (alias) return alias;
  // trailing-'s' tolerance both ways ('afrobeats' table vs 'afrobeat' ask handled
  // above; generic: 'reggaetons' → 'reggaeton').
  if (folded.endsWith('s') && GENRE_SET.has(folded.slice(0, -1))) {
    return folded.slice(0, -1) as CanonicalGenre;
  }
  if (GENRE_SET.has(`${folded}s`)) return `${folded}s` as CanonicalGenre;
  return null;
}

/** Canonical key for TABLE LOOKUPS: the canonical genre when known, else the
 *  folded raw (so legacy behavior — exact-normalized match — still applies). */
export function genreLookupKey(raw?: string | null): string {
  return canonicalizeGenre(raw) ?? foldGenre(raw);
}

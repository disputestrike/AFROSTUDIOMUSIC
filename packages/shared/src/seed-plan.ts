/**
 * SEED PLAN — Wave 4 of the training flywheel. Owner directive: "seed it now
 * with the instrument, the materials" — the own engine sang thin because its
 * material library is sparse. This computes the DETERMINISTIC worklist of
 * rights-clean loops to forge (genre × kit-role × target count) so the owned
 * synth has real vocabulary to assemble from — AND every forged loop is
 * own-origin, so it doubles as training fuel (training-corpus.ts own-master).
 *
 * Pure + deterministic (no forge, no spend). The worker consumes this plan to
 * enqueue forge jobs; executing the batch costs compute and is gated separately.
 */
import { GENRES } from './constants';
import { genreSignature } from './genre-signatures';

/** kitRoles ('log_drum'|'percussion'|'bass'|'chords'|'fill') → MaterialAsset.role. */
const ROLE_MAP: Record<string, string> = {
  log_drum: 'log_drum',
  percussion: 'percussion',
  bass: 'bass',
  chords: 'chords',
  fill: 'drums',
};

/** The Afro/diaspora core leads seeding — it's the product's identity + the
 *  lanes the own engine most needs to nail first. */
const AFRO_CORE = new Set<string>([
  'afrobeats', 'afro_fusion', 'amapiano', 'afro_dancehall', 'street_pop',
  'afro_rnb', 'afro_pop', 'afro_soul', 'highlife', 'alte', 'gqom', 'kwaito',
  'afro_house', 'bongo_flava', 'azonto', 'coupe_decale', 'ndombolo', 'soukous',
]);

export interface SeedItem {
  genre: string;
  role: string;
  targetCount: number;
  /** 1 = Afro-core (forge first), 2 = the rest. */
  priority: number;
}

/**
 * Build the seeding worklist. Every genre gets its signature kit roles plus a
 * baseline 'drums' loop set; Afro-core genres are prioritized and get a deeper
 * target. Deterministic ordering (priority, then genre, then role) so a partial
 * run is resumable and reproducible.
 */
export function buildSeedPlan(opts: { perRole?: number; genres?: readonly string[]; maxItems?: number } = {}): SeedItem[] {
  const perRole = Math.max(1, opts.perRole ?? 8);
  const genres = opts.genres ?? GENRES;
  const items: SeedItem[] = [];

  for (const genre of genres) {
    const sig = genreSignature(genre);
    const core = AFRO_CORE.has(genre);
    const priority = core ? 1 : 2;
    // 'drums' is the backbone every lane needs; then the signature roles.
    const roles = new Set<string>(['drums']);
    for (const kr of sig.kitRoles) {
      const mapped = ROLE_MAP[kr];
      if (mapped) roles.add(mapped);
    }
    for (const role of roles) {
      items.push({
        genre,
        role,
        // Afro-core forges a touch deeper (its identity roles carry the product).
        targetCount: core && (role === 'log_drum' || role === 'percussion') ? perRole + 4 : perRole,
        priority,
      });
    }
  }

  items.sort((a, b) => a.priority - b.priority || a.genre.localeCompare(b.genre) || a.role.localeCompare(b.role));
  return typeof opts.maxItems === 'number' ? items.slice(0, Math.max(0, opts.maxItems)) : items;
}

/** Total loops the plan will forge — the size of the seeding batch. */
export function seedPlanTotal(plan: SeedItem[]): number {
  return plan.reduce((sum, i) => sum + i.targetCount, 0);
}

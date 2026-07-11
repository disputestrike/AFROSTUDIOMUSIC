/**
 * LEARNED-REFERENCE SELECTION — the pure core of "which of the artist's
 * references does THIS render draw on", extracted from the API's learned.ts so
 * the lane-isolation law is TESTABLE (worker gate) without a database:
 *
 *  1. LANE ISOLATION: only in-genre rows are ever selected — a trained amapiano
 *     reference must shape the next amapiano render and NEVER leak into an
 *     afrobeats one (fusion passes its own primary genre).
 *  2. PIN WINS: the reference the artist JUST listened to leads, even when the
 *     lake holds newer rows.
 *  3. THE ARTIST OUTRANKS THE MACHINE: real uploads/listens (up to 3) come
 *     before self-training rows (at most 1, seasoning only).
 */

const norm = (g?: string | null) => (g ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Tolerant genre match: exact-normalized, or one contains the other — so
 *  historical free-text rows ("Afro Fusion") still retrieve for afro_fusion. */
export function learnedGenreMatches(a?: string | null, b?: string | null): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export interface LearnedSelectable {
  id: string;
  genre: string | null;
  /** recipe.source === 'generated' — the machine's own promoted output. */
  generated: boolean;
}

/**
 * Priority: (1) the explicitly pinned reference, (2) the artist's real
 * uploads/listens newest-first (rows arrive newest-first), (3) at most ONE
 * self-training row as seasoning. Never more than 4 total.
 */
export function selectLearnedRefs<T extends LearnedSelectable>(rows: T[], genre: string, pinnedId?: string | null): T[] {
  const inGenre = rows.filter((r) => learnedGenreMatches(r.genre, genre));
  const pinned = pinnedId ? rows.filter((r) => r.id === pinnedId) : [];
  const real = inGenre.filter((r) => !r.generated && r.id !== pinnedId);
  const generated = inGenre.filter((r) => r.generated && r.id !== pinnedId);
  return [...pinned, ...real.slice(0, 3), ...generated.slice(0, 1)].slice(0, 4);
}

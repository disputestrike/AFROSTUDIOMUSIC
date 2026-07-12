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
 * uploads/listens, (3) at most ONE self-training row as seasoning. Never more
 * than 4 total.
 *
 * ROTATION (the "184 unused references" fix — the owner caught it on the
 * utilization table): without a seed the pick is the newest 3 real refs
 * FOREVER, so a lake of 80 heard songs teaches with only its 3 newest and the
 * rest sit measured-but-idle. With a varietySeed each render draws a DIFFERENT
 * window of the lane's real refs (newest still favored: the pool is the newest
 * 12), so the whole lake cycles through renders over time. No seed = legacy
 * deterministic behavior (tests + replays depend on it).
 */
export function selectLearnedRefs<T extends LearnedSelectable>(rows: T[], genre: string, pinnedId?: string | null, opts?: { varietySeed?: number }): T[] {
  const inGenre = rows.filter((r) => learnedGenreMatches(r.genre, genre));
  const pinned = pinnedId ? rows.filter((r) => r.id === pinnedId) : [];
  const real = inGenre.filter((r) => !r.generated && r.id !== pinnedId);
  const generated = inGenre.filter((r) => r.generated && r.id !== pinnedId);
  let pickedReal = real.slice(0, 3);
  if (opts?.varietySeed != null && real.length > 3) {
    const pool = real.slice(0, Math.min(12, real.length));
    const seed = Math.abs(Math.floor(opts.varietySeed));
    pickedReal = [0, 1, 2].map((i) => pool[(seed + i * 5) % pool.length]!);
    // Distinct picks guaranteed when pool ≥ 4 and stride 5 is coprime-ish with
    // small pools — dedupe defensively and top up newest-first.
    pickedReal = [...new Map(pickedReal.map((r) => [r.id, r])).values()];
    for (const r of pool) {
      if (pickedReal.length >= 3) break;
      if (!pickedReal.some((p) => p.id === r.id)) pickedReal.push(r);
    }
  }
  return [...pinned, ...pickedReal, ...generated.slice(0, 1)].slice(0, 4);
}

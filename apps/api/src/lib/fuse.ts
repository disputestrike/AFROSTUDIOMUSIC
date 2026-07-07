/**
 * FUSE THE DATA LAKE — assemble the full generation context so EVERY layer
 * actually reaches the writer, not just the first two.
 *
 * The problem this fixes: a single flat char-cap dropped whatever came after
 * the big genre-DNA block (learned references, studied lyric craft, hit-craft
 * modes were silently truncated out). Instead we cap EACH layer to a sane size
 * so all of them fit in a bounded, fast prompt — the word bank + freshness +
 * genre DNA + your learned sound + studied craft + hit modes, all present.
 */
export interface LakeParts {
  freshness?: string;   // banned-repeats + African storytelling (small, keep full)
  palette?: string;     // the Word Bank vocabulary for this song (keep full — it's the point)
  dna?: string;         // genre production recipe (verbose → capped)
  learnedRef?: string;  // the artist's heard/uploaded songs
  learnedCraft?: string;// lyrics the artist studied
  hitCraft?: string;    // proven hit-mode craft (verbose → capped)
  extra?: string;       // any caller-specific brief (e.g. hard constraints) — leads
}

const cap = (s: string | undefined, n: number) => (s ? s.slice(0, n) : '');

export function fuseSoundDna(p: LakeParts): string {
  // Order: constraints → freshness → WORD BANK → genre DNA → learned → craft →
  // hit modes. Word bank sits high so it always survives and leads word choice.
  return [
    cap(p.extra, 900),
    cap(p.freshness, 800),
    cap(p.palette, 1400), // the vocabulary — generous
    cap(p.dna, 2800),
    cap(p.learnedRef, 1600),
    cap(p.learnedCraft, 1400),
    cap(p.hitCraft, 2200),
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n'); // ~11k chars max — full breadth, still bounded
}

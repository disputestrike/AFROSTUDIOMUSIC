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
  // PHASE 4 — the Lane pipeline. MEASURED truth leads the brief:
  repair?: string;      // Phase-3 steering addendum for a regen (the strongest signal — leads)
  laneTargets?: string; // Phase-1 measured lane fingerprint (what this lane actually IS)
}

const cap = (s: string | undefined, n: number) => (s ? s.slice(0, n) : '');

/**
 * @param maxTotal optional overall budget. Hooks use the full ~11k; lyrics pass
 *   a leaner ~6k (a huge INPUT + a long multi-line lyric OUTPUT as JSON breaks
 *   more often, so lyrics stay tighter). The word bank + freshness + hard
 *   constraints always survive; the verbose genre-DNA/hit-craft blocks yield first.
 */
export function fuseSoundDna(p: LakeParts, maxTotal = 11000, opts?: { forLyrics?: boolean }): string {
  // Order: constraints → freshness → WORD BANK → genre DNA → learned → craft →
  // hit modes. Word bank sits high so it always survives and leads word choice.
  // Repair steering + measured lane targets lead — they are the measured TRUTH about
  // the lane and the concrete fixes for this take, so they must never be truncated out.
  //
  // FOR LYRICS (audit 2026-07-18): the studied hit-craft + learned lyric craft are
  // what make the WORDS land; the verbose beat RECIPE (dna) is the least useful to
  // the lyricist (who is told not to lean on it). At the lean ~6k lyric budget the
  // old order let dna eat the room and DROP the craft entirely — the exact "old
  // habits / bland" cause. So for lyrics, craft outranks dna and dna is trimmed.
  // The laws + word bank still lead; this only reorders the tail. Hooks keep the
  // original order (verify: do NOT change the shared hook prompt).
  const forLyrics = opts?.forLyrics === true;
  const parts = (forLyrics
    ? [
        cap(p.repair, 900),
        cap(p.laneTargets, 900),
        cap(p.extra, 900),
        cap(p.freshness, 800),
        cap(p.palette, 1400), // the vocabulary — generous
        cap(p.hitCraft, 2200), // hit modes lead for lyrics — they shape the words
        cap(p.learnedCraft, 1600),
        cap(p.learnedRef, 1200),
        cap(p.dna, 1200), // beat recipe trimmed for the lyricist — least useful here
      ]
    : [
        cap(p.repair, 900),
        cap(p.laneTargets, 900),
        cap(p.extra, 900),
        cap(p.freshness, 800),
        cap(p.palette, 1400), // the vocabulary — generous
        cap(p.dna, 2800),
        cap(p.learnedRef, 1600),
        cap(p.learnedCraft, 1400),
        cap(p.hitCraft, 2200),
      ]
  ).map((s) => s.trim()).filter(Boolean);

  const out: string[] = [];
  let used = 0;
  for (const s of parts) {
    if (used + s.length > maxTotal) {
      const room = maxTotal - used;
      if (room > 300) out.push(s.slice(0, room));
      break;
    }
    out.push(s);
    used += s.length + 2;
  }
  return out.join('\n\n');
}

import { prisma } from '@afrohit/db';

/**
 * The "listen & learn" retrieval — rebuilt for FIDELITY:
 *
 *  1. The artist's OWN material (uploads + listens) always outranks self-training
 *     rows (source:'generated') — the machine's own output can season the brief
 *     but never bury the artist's real sound.
 *  2. Genre matching is tolerant ("Afro Fusion" ≈ "afro_fusion" ≈ "afrofusion")
 *     so historical rows and free-text model genres still retrieve.
 *  3. The RICH recipe fields (drums/percussion/bass/groove/flow/arrangement/bpm/
 *     vocal) drive the brief — not just the one-line summary.
 *  4. learnedStyleTags() gives terse tokens for the MUSIC MODEL itself, so what
 *     was heard shapes the AUDIO, not only the words.
 */

interface RecipeShape {
  source?: string;
  drums?: string | null;
  percussion?: string | null;
  bass?: string | null;
  groove?: string | null;
  flow?: string | null;
  arrangement?: string | null;
  vocalStyle?: string | null;
  vocalGender?: string | null;
  bpm?: number | null;
  key?: string | null;
  learnedRecipe?: string | null;
}

interface RefRow {
  id: string;
  title: string | null;
  summary: string | null;
  genre: string | null;
  createdAt: Date;
  recipe: RecipeShape;
  generated: boolean;
}

const norm = (g?: string | null) => (g ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Tolerant genre match: exact-normalized, or one contains the other. */
function genreMatches(a?: string | null, b?: string | null): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

async function fetchRefs(workspaceId: string, genre: string, pinnedId?: string | null): Promise<RefRow[]> {
  const rows = await prisma.soundReference.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { id: true, title: true, summary: true, genre: true, createdAt: true, recipe: true },
  });
  const all: RefRow[] = rows.map((r) => {
    const recipe = (r.recipe ?? {}) as RecipeShape;
    return { ...r, recipe, generated: recipe.source === 'generated' };
  });
  const inGenre = all.filter((r) => genreMatches(r.genre, genre));
  // Priority: (1) an explicitly pinned reference (the one JUST listened to),
  // (2) the artist's real uploads/listens newest-first, (3) at most ONE
  // self-training row as seasoning.
  const pinned = pinnedId ? all.filter((r) => r.id === pinnedId) : [];
  const real = inGenre.filter((r) => !r.generated && r.id !== pinnedId);
  const generated = inGenre.filter((r) => r.generated && r.id !== pinnedId);
  return [...pinned, ...real.slice(0, 3), ...generated.slice(0, 1)].slice(0, 4);
}

function refLines(refs: RefRow[]): string[] {
  return refs
    .map((r) => {
      const rec = r.recipe;
      const bits = [
        rec.bpm ? `${rec.bpm}bpm` : null,
        rec.key || null,
        rec.drums ? `DRUMS: ${rec.drums}` : null,
        rec.percussion ? `PERCUSSION: ${rec.percussion}` : null,
        rec.bass ? `BASS: ${rec.bass}` : null,
        rec.groove ? `GROOVE: ${rec.groove}` : null,
        rec.arrangement ? `ARRANGEMENT: ${rec.arrangement}` : null,
        rec.flow || rec.vocalStyle ? `VOCAL: ${[rec.vocalGender, rec.vocalStyle, rec.flow].filter(Boolean).join(', ')}` : null,
      ].filter(Boolean);
      const body = bits.length ? bits.join(' · ') : rec.learnedRecipe || r.summary || '';
      if (!body) return '';
      const tag = r.generated ? ' (from a previous strong render)' : '';
      return `• ${r.title ? r.title + tag + ': ' : ''}${body.slice(0, 900)}`;
    })
    .filter(Boolean);
}

/**
 * Rich production brief for the LLM prompts (hooks/lyrics/arranger/A&R).
 * `pinnedReferenceId` guarantees the reference the artist JUST listened to leads
 * the brief — the remake must rebuild THAT record's sound, not whatever happens
 * to be recent.
 */
export async function learnedReferenceBrief(
  workspaceId: string,
  genre?: string | null,
  pinnedReferenceId?: string | null
): Promise<string> {
  if (!genre) return '';
  const refs = await fetchRefs(workspaceId, genre, pinnedReferenceId);
  const lines = refLines(refs);
  if (!lines.length) return '';
  return (
    "LEARNED FROM THE ARTIST'S OWN REFERENCE SONGS — rebuild THIS real, layered sound (the drums, " +
    'percussion/log-drum, bass, groove and vocal flow it heard); make it this rich and complex, never generic:\n' +
    lines.join('\n')
  );
}

/**
 * Terse learned tokens for the MUSIC MODEL (≤4, short) — the sound it heard must
 * shape the AUDIO prompt, not just the lyric prompts. Pulled from the newest
 * REAL reference in genre (or the pinned one).
 */
export async function learnedStyleTags(
  workspaceId: string,
  genre?: string | null,
  pinnedReferenceId?: string | null
): Promise<string[]> {
  if (!genre) return [];
  const refs = await fetchRefs(workspaceId, genre, pinnedReferenceId);
  const src = refs.find((r) => !r.generated) ?? refs[0];
  if (!src) return [];
  const rec = src.recipe;
  const shorten = (s?: string | null, max = 44) => {
    if (!s) return null;
    const clause = (s.split(/[—:;(.]/)[0] ?? s).split(',')[0] ?? s;
    const t = clause.trim();
    return t.length > 4 ? t.slice(0, max) : null;
  };
  return [shorten(rec.drums), shorten(rec.percussion, 36), shorten(rec.groove, 36), shorten(rec.bass, 32)]
    .filter((t): t is string => !!t)
    .slice(0, 4);
}

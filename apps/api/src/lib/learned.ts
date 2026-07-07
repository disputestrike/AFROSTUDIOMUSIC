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
  sourceUrl: string;
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
  // The lake holds more than SOUND now (lyric craft, trend snapshots) — those
  // are excluded IN THE QUERY, not after take:60, so a growing lake can never
  // evict the artist's real heard/uploaded references from the window.
  const rows = await prisma.soundReference.findMany({
    where: {
      workspaceId,
      NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { id: true, title: true, summary: true, genre: true, sourceUrl: true, createdAt: true, recipe: true },
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

/**
 * LEARNED LYRIC CRAFT — what the studio has studied from lyrics brought to it
 * (patterns/technique only, never words — see lyric-learn.ts doctrine).
 * In-genre lessons lead; craft transfers, so off-genre lessons still season.
 * Feeds the hook writer + lyric writer alongside hit-craft.
 */
export async function learnedLyricCraftBrief(workspaceId: string, genre?: string | null): Promise<string> {
  const rows = await prisma.soundReference.findMany({
    where: { workspaceId, sourceUrl: { startsWith: 'lyric:' } },
    orderBy: { createdAt: 'desc' },
    take: 24,
    select: { title: true, summary: true, genre: true },
  });
  if (!rows.length) return '';
  const inGenre = genre ? rows.filter((r) => genreMatches(r.genre, genre)) : [];
  const rest = rows.filter((r) => !inGenre.includes(r));
  const picked = [...inGenre.slice(0, 2), ...rest.slice(0, 1)].filter((r) => r.summary);
  if (!picked.length) return '';
  return (
    'STUDIED LYRIC CRAFT (from lyrics the artist brought to learn from — apply the TECHNIQUES to brand-new words, never reuse phrasing). ' +
    'THE LESSON IS THE FLOOR, NOT THE CEILING: outdo the studied songs — a sharper hook, a fresher angle, more original imagery than what was studied:\n' +
    picked.map((r) => `• ${r.title ? r.title + ': ' : ''}${r.summary!.slice(0, 700)}`).join('\n')
  );
}

/**
 * Shelve a trend digest into the data lake (one snapshot per genre per day) so
 * chart-awareness COMPOUNDS instead of evaporating after each request.
 * Best-effort: never throws into the caller's path.
 */
export async function snapshotTrend(
  workspaceId: string,
  genre: string | null | undefined,
  trend: { digest: string; source: string; sources?: Array<{ title: string; url: string }> } | null
): Promise<void> {
  try {
    if (!trend?.digest || !genre) return;
    const day = new Date().toISOString().slice(0, 10);
    const title = `trends:${genre}:${day}`;
    // Deterministic id = race-proof dedupe: two concurrent generations both
    // trying to snapshot the same genre+day collide on the PRIMARY KEY and the
    // second create simply throws into this catch — exactly one row per day.
    const id = `trend_${workspaceId.slice(-8)}_${genre.replace(/[^a-z0-9]/gi, '')}_${day.replace(/-/g, '')}`;
    await prisma.soundReference.create({
      data: {
        id,
        workspaceId,
        genre,
        sourceUrl: `trend:${trend.source}`,
        title,
        summary: trend.digest.slice(0, 2000),
        recipe: { source: 'trend', provider: trend.source, charts: (trend.sources ?? []).slice(0, 12) } as never,
      },
    });
  } catch {
    /* duplicate day-snapshot or transient DB error — never worth failing a generation */
  }
}

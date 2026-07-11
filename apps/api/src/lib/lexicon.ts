import { prisma } from '@afrohit/db';
import { SEED_LEXICON, EXPANSION_LEXICON, SA_LEXICON, PARITY_LEXICON } from '@afrohit/ai';

/**
 * THE WORD BANK — thousands of authentic African/diaspora terms the writer
 * SAMPLES from so it stops repeating the same words. Seeded on boot (idempotent)
 * from the baked seed pack; searchable; and injected into generation as a
 * rotating palette per language/mood/genre.
 */

const norm = (l?: string | null) => (l ?? '').toLowerCase().trim();
// User language codes → lexicon language buckets (mixed/motif always included).
const LANG_BUCKETS: Record<string, string[]> = {
  pcm: ['pcm', 'mixed', 'motif', 'en'],
  en: ['en', 'mixed', 'motif'],
  yo: ['yo', 'mixed', 'motif'],
  ig: ['ig', 'mixed', 'motif'],
  ha: ['ha', 'mixed', 'motif'],
  twi: ['twi', 'mixed', 'motif'],
  sw: ['sw', 'mixed', 'motif'],
  // South African lanes — requestable now; the word bank needs native seeding
  // (Phase 7), and release stays blocked on native review until a speaker signs off.
  zu: ['zu', 'mixed', 'motif'],
  xh: ['xh', 'mixed', 'motif'],
  st: ['st', 'mixed', 'motif'],
};

/** Seed the shared library once. Cheap: skips entirely if already populated. */
export async function seedLexiconIfEmpty(): Promise<number> {
  try {
    const ALL = [...SEED_LEXICON, ...EXPANSION_LEXICON, ...SA_LEXICON, ...PARITY_LEXICON];
    const have = await prisma.lexiconEntry.count({ where: { source: { in: ['seed', 'research'] } } });
    if (have >= ALL.length * 0.95) return 0; // already seeded
    let n = 0;
    for (const r of ALL) {
      await prisma.lexiconEntry
        .upsert({
          where: { term_language_category: { term: r.term, language: r.language, category: r.category } },
          create: { workspaceId: null, term: r.term, language: r.language, category: r.category, register: r.register ?? null, meaning: r.meaning ?? null, example: r.example ?? null, tags: r.tags ?? [], source: (r.meaning ? 'research' : 'seed') },
          update: {},
        })
        .then(() => { n++; })
        .catch(() => {});
    }
    return n;
  } catch {
    return 0; // table may not exist yet on first deploy — next boot seeds it
  }
}

/** Search the word bank (shared + this workspace's private additions). */
export async function searchLexicon(opts: {
  workspaceId: string;
  q?: string;
  language?: string;
  category?: string;
  take?: number;
}) {
  const where: Record<string, unknown> = {
    OR: [{ workspaceId: null }, { workspaceId: opts.workspaceId }],
  };
  if (opts.language) where.language = norm(opts.language);
  if (opts.category) where.category = norm(opts.category);
  if (opts.q) where.term = { contains: opts.q, mode: 'insensitive' };
  return prisma.lexiconEntry.findMany({
    where,
    orderBy: [{ category: 'asc' }, { term: 'asc' }],
    take: Math.min(opts.take ?? 200, 1000),
  });
}

/** Counts by language + category — for the data-lake report + the page header. */
export async function lexiconStats(workspaceId: string) {
  const [total, byLang, byCat] = await Promise.all([
    prisma.lexiconEntry.count({ where: { OR: [{ workspaceId: null }, { workspaceId }] } }),
    prisma.lexiconEntry.groupBy({ by: ['language'], where: { OR: [{ workspaceId: null }, { workspaceId }] }, _count: true }),
    prisma.lexiconEntry.groupBy({ by: ['category'], where: { OR: [{ workspaceId: null }, { workspaceId }] }, _count: true }),
  ]);
  return {
    total,
    byLanguage: byLang.map((l: { language: string; _count: number }) => ({ language: l.language, count: l._count })).sort((a: { count: number }, b: { count: number }) => b.count - a.count),
    byCategory: byCat.map((c: { category: string; _count: number }) => ({ category: c.category, count: c._count })).sort((a: { count: number }, b: { count: number }) => b.count - a.count),
  };
}

/**
 * §11 boot assertion — log coverage per prescribed language and warn LOUDLY about
 * "thin" lanes (< 20 terms). A song primarily in a thin language must not ship
 * un-reviewed; the REVIEW_LANGS release gate already enforces that. This makes the
 * gap visible at boot instead of surfacing as wrong-language lyrics.
 */
export async function assertLexiconCoverage(log: { info: (m: string) => void; warn: (m: string) => void }): Promise<void> {
  try {
    const byLang = await prisma.lexiconEntry.groupBy({ by: ['language'], where: { workspaceId: null }, _count: true });
    const counts = new Map<string, number>(byLang.map((l: { language: string; _count: number }) => [l.language, l._count] as [string, number]));
    const PRESCRIBED = ['yo', 'ig', 'ha', 'pcm', 'en', 'zu', 'xh', 'st', 'tn', 'tsotsitaal'];
    log.info(`lexicon coverage: ${PRESCRIBED.map((l) => `${l}=${counts.get(l) ?? 0}`).join(' ')}`);
    const thin = PRESCRIBED.filter((l) => (counts.get(l) ?? 0) < 20);
    if (thin.length) log.warn(`lexicon THIN languages (<20 terms): ${thin.join(', ')} — songs primarily in these are BLOCKED from release until native-reviewed. Seed to parity with a native speaker.`);
  } catch {
    /* lexicon table may not exist on first boot */
  }
}

// Which lexicon categories matter for a given mood — so the palette is relevant.
const MOOD_CATEGORIES: Record<string, string[]> = {
  love: ['love', 'slang', 'proverb', 'adlib'],
  sexy: ['love', 'slang', 'adlib'],
  heartbreak: ['love', 'street', 'proverb'],
  party: ['party', 'dance', 'adlib', 'slang'],
  vibey: ['party', 'dance', 'slang', 'adlib'],
  confident: ['party', 'street', 'slang', 'motif'],
  triumphant: ['party', 'faith', 'proverb', 'motif'],
  hustle: ['street', 'proverb', 'faith', 'places'],
  nostalgic: ['street', 'places', 'proverb'],
  spiritual: ['faith', 'proverb', 'adlib'],
  luxury: ['party', 'slang', 'crossover'],
  lifestyle: ['party', 'places', 'slang'],
  family: ['faith', 'proverb', 'street'],
};

/**
 * A rotating PALETTE for a generation — a handful of fresh, authentic terms
 * per relevant category in the artist's languages. Injected into the writer
 * prompt as "draw from these" (not "use all"), and rotated by a caller-supplied
 * seed so back-to-back songs don't converge on the same words.
 */
export async function lexiconPalette(opts: {
  workspaceId: string;
  languages?: string[];
  mood?: string;
  rotate?: number;
  perCategory?: number;
}): Promise<string> {
  try {
    const langs = (opts.languages?.length ? opts.languages : ['pcm', 'en']).map(norm);
    const buckets = new Set<string>(['mixed', 'motif']);
    for (const l of langs) for (const b of LANG_BUCKETS[l] ?? [l]) buckets.add(b);
    const cats = MOOD_CATEGORIES[norm(opts.mood)] ?? ['love', 'street', 'party', 'slang', 'proverb', 'adlib'];

    // QUALITY FIRST: curated rows (seed/research/user — meanings verified,
    // categorized) fill the palette before the machine firehose. With 25k+
    // unranked wiktionary rows and no orderBy, a single query let unglossed
    // machine rows drown the curated bank the writers were meant to pull from.
    const whereBase = { OR: [{ workspaceId: null }, { workspaceId: opts.workspaceId }], language: { in: [...buckets] }, category: { in: cats } };
    const curated = await prisma.lexiconEntry.findMany({
      // A3-5 guard (c): bulk-drafted rows are quarantined until the judgment
      // brain verifies them — they never reach the writers.
      where: { ...whereBase, source: { in: ['seed', 'research', 'user'] }, NOT: { tags: { has: 'bulk_unverified' } } },
      select: { term: true, category: true, language: true },
      take: 1000,
    });
    const rows = curated.length >= 200
      ? curated
      : [
          ...curated,
          ...(await prisma.lexiconEntry.findMany({
            where: { ...whereBase, source: { notIn: ['seed', 'research', 'user'] }, NOT: [{ tags: { has: 'unglossed' } }, { tags: { has: 'bulk_unverified' } }] },
            select: { term: true, category: true, language: true },
            take: 1000 - curated.length,
          })),
        ];
    if (rows.length < 4) return '';

    const perCat = opts.perCategory ?? 10;
    const rot = Math.abs(Math.floor(opts.rotate ?? 0));
    const byCat = new Map<string, string[]>();
    for (const r of rows) byCat.set(r.category, [...(byCat.get(r.category) ?? []), r.term]);
    const lines: string[] = [];
    for (const cat of cats) {
      const terms = byCat.get(cat);
      if (!terms?.length) continue;
      // Deterministic rotation window so each song pulls a different slice.
      const start = (rot * 5) % terms.length;
      const picked = [];
      for (let i = 0; i < Math.min(perCat, terms.length); i++) picked.push(terms[(start + i) % terms.length]);
      lines.push(`${cat}: ${[...new Set(picked)].join(', ')}`);
    }
    if (!lines.length) return '';
    return (
      'WORD BANK — YOUR VOCABULARY FOR THIS SONG. These are authentic, specific terms from the studio word bank. ' +
      'REACH FOR THESE instead of generic English filler — but ONLY where a real speaker would drop them mid-sentence. A forced-in vocabulary word is a FAILURE worse than plain language (the "written not sung" defect). Zero is acceptable; natural beats many. ' +
      'Specific, textured African words are what make the writing feel real — generic words ("baby, money, vibe, party, shine") are the failure to avoid.\n' +
      lines.join('\n')
    );
  } catch {
    return '';
  }
}

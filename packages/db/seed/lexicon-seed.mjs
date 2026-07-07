/**
 * LEXICON SEED — load the curated multilingual word bank into LexiconEntry.
 *
 * Idempotent: upsert on (term, language, category). Reads:
 *   1. afrobeat_seed_lexicon.json  (the ChatGPT seed pack — 800+ curated terms)
 *   2. lexicon-expansion.json      (research-expanded rows, if present)
 *
 * Run:  node packages/db/seed/lexicon-seed.mjs
 * (also invoked from the app on boot — see packages/db seedLexicon()).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const HERE = dirname(fileURLToPath(import.meta.url));

// Map the seed pack's category keys → our (language, category, register).
const CAT_MAP = {
  pidgin_core: { language: 'pcm', category: 'slang', register: 'casual' },
  ghana_pidgin_twi_ga: { language: 'twi', category: 'slang', register: 'casual' },
  yoruba: { language: 'yo', category: 'slang', register: 'casual' },
  igbo: { language: 'ig', category: 'slang', register: 'casual' },
  hausa: { language: 'ha', category: 'slang', register: 'casual' },
  diaspora_african: { language: 'en', category: 'diaspora', register: 'poetic' },
  places: { language: 'en', category: 'places', register: 'casual' },
  love_emotion: { language: 'mixed', category: 'love', register: 'poetic' },
  street_story: { language: 'mixed', category: 'street', register: 'casual' },
  celebration_flex: { language: 'mixed', category: 'party', register: 'flex' },
  faith_prayer: { language: 'mixed', category: 'faith', register: 'sacred' },
  music_terms: { language: 'en', category: 'music', register: 'casual' },
  drum_syllables: { language: 'motif', category: 'drums', register: 'chant' },
  adlibs: { language: 'mixed', category: 'adlib', register: 'chant' },
  hit_motif_words: { language: 'mixed', category: 'motif', register: 'poetic' },
  dance_commands: { language: 'mixed', category: 'dance', register: 'chant' },
  romance_heartbreak_modern: { language: 'mixed', category: 'love', register: 'casual' },
  global_crossover_terms: { language: 'en', category: 'crossover', register: 'flex' },
  amapiano_terms: { language: 'en', category: 'music', register: 'casual' },
  afropop_production: { language: 'en', category: 'music', register: 'casual' },
  hook_particles: { language: 'motif', category: 'adlib', register: 'chant' },
  proverb_fragments: { language: 'mixed', category: 'proverb', register: 'poetic' },
  // skipped: hit_title_words_not_lyrics, hit_era_artists_reference, afropop_eras
  //          (reference-only, not song vocabulary)
};

function rowsFromPack(pack) {
  const lex = pack.lexicon ?? {};
  const rows = [];
  for (const [key, arr] of Object.entries(lex)) {
    const m = CAT_MAP[key];
    if (!m || !Array.isArray(arr)) continue;
    for (const raw of arr) {
      const term = String(raw).trim();
      if (!term || term.length > 120) continue;
      rows.push({ term, ...m, source: 'seed', tags: [key] });
    }
  }
  return rows;
}

export async function loadSeedRows() {
  const rows = [];
  const packPath = join(HERE, 'afrobeat_seed_lexicon.json');
  if (existsSync(packPath)) rows.push(...rowsFromPack(JSON.parse(readFileSync(packPath, 'utf8'))));
  const expPath = join(HERE, 'lexicon-expansion.json');
  if (existsSync(expPath)) {
    const exp = JSON.parse(readFileSync(expPath, 'utf8'));
    for (const e of Array.isArray(exp) ? exp : []) {
      if (!e?.term || !e?.language || !e?.category) continue;
      rows.push({
        term: String(e.term).trim().slice(0, 120),
        language: String(e.language).slice(0, 12),
        category: String(e.category).slice(0, 24),
        register: e.register ? String(e.register).slice(0, 24) : null,
        meaning: e.meaning ? String(e.meaning).slice(0, 400) : null,
        example: e.example ? String(e.example).slice(0, 400) : null,
        tags: Array.isArray(e.tags) ? e.tags.map(String).slice(0, 6) : [],
        source: 'research',
      });
    }
  }
  // Dedupe on (term, language, category) — later rows (research, richer) win.
  const seen = new Map();
  for (const r of rows) seen.set(`${r.term}|${r.language}|${r.category}`, r);
  return [...seen.values()];
}

export async function seedLexicon(prisma) {
  const rows = await loadSeedRows();
  let written = 0;
  // Chunked upserts keep it fast + idempotent on re-run.
  for (const r of rows) {
    await prisma.lexiconEntry.upsert({
      where: { term_language_category: { term: r.term, language: r.language, category: r.category } },
      create: { ...r, workspaceId: null },
      update: { register: r.register, meaning: r.meaning ?? undefined, example: r.example ?? undefined, tags: r.tags, source: r.source },
    });
    written++;
  }
  return written;
}

// Direct-run mode.
if (process.argv[1] && process.argv[1].endsWith('lexicon-seed.mjs')) {
  const prisma = new PrismaClient();
  seedLexicon(prisma)
    .then((n) => { console.log(`seeded ${n} lexicon entries`); return prisma.$disconnect(); })
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}

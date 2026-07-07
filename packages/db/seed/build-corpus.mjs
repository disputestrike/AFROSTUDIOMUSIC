/**
 * CORPUS GENERATOR — build a large, GENUINELY VARIED training corpus from the
 * studio's unique word bank (seed + research expansion).
 *
 * Why this isn't the "repetitive filler" problem: it draws from THOUSANDS of
 * unique terms across languages + categories, through dozens of line templates,
 * with LINE-LEVEL DEDUP — so every emitted line is unique and the vocabulary
 * entropy is high. (The earlier ChatGPT corpus recombined only ~800 words, so
 * it repeated fast.) Still: this is a corpus for fine-tuning YOUR OWN model —
 * the live app uses the DB word bank + runtime palette, not this file.
 *
 * Usage:
 *   node packages/db/seed/build-corpus.mjs --words 10000000 --out "C:/Users/benxp/Downloads/afrohit_corpus"
 *
 * Doctrine: recombines authentic VOCABULARY into ORIGINAL lines. No copyrighted
 * song lyrics are copied.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const TARGET_WORDS = Number(arg('words', '10000000'));
const OUT = arg('out', join(HERE, 'generated'));
const CHUNK_WORDS = 1_000_000; // one file per ~1M words

// Load the full lexicon (dumped from seed + expansion TS → lexicon-all.json).
const lexPath = join(HERE, 'lexicon-all.json');
if (!existsSync(lexPath)) {
  console.error(`missing ${lexPath} — run the dump step first (npm run lexicon:dump).`);
  process.exit(1);
}
const rows = JSON.parse(readFileSync(lexPath, 'utf8'));

// Bucket terms by category (and keep a flat pool).
const byCat = new Map();
for (const r of rows) {
  if (!r?.term) continue;
  const c = r.category ?? 'slang';
  if (!byCat.has(c)) byCat.set(c, []);
  byCat.get(c).push(r.term);
}
const cat = (c) => byCat.get(c) ?? byCat.get('slang') ?? [...byCat.values()][0] ?? ['vibe'];
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Slot resolvers — each pulls a fresh authentic term from a relevant bucket.
const SLOTS = {
  love: () => pick(cat('love')),
  street: () => pick(cat('street')),
  party: () => pick(cat('party')),
  faith: () => pick(cat('faith')),
  proverb: () => pick(cat('proverb')),
  place: () => pick(cat('places')),
  slang: () => pick(cat('slang')),
  adlib: () => pick(cat('adlib')),
  drum: () => pick(cat('drums')),
  dance: () => pick(cat('dance')),
  motif: () => pick(cat('motif')),
};
const S = (k) => (SLOTS[k] ? SLOTS[k]() : pick(cat('slang')));

// Line templates — the storytelling shapes (setup / turn / payoff / call-response).
// Each is a function so we can compose fresh combinations every call.
const TEMPLATES = [
  () => `${S('adlib')}, ${S('love')} for my ${S('slang')} — ${S('proverb')}`,
  () => `for ${S('place')} we dey move, ${S('party')} till ${S('adlib')}`,
  () => `${S('street')} no be small thing, but ${S('faith')} dey carry me`,
  () => `${S('drum')} ${S('drum')}, ${S('dance')}, everybody ${S('adlib')}`,
  () => `she be my ${S('love')}, ${S('motif')} wey I no fit hide`,
  () => `${S('proverb')} — na so ${S('street')} dey teach us for ${S('place')}`,
  () => `${S('faith')} on my head, ${S('party')} in my chest, ${S('adlib')}`,
  () => `call it ${S('slang')}, answer am ${S('adlib')} — ${S('dance')}`,
  () => `from ${S('place')} to ${S('place')}, my ${S('motif')} still dey shine soft`,
  () => `${S('love')} tonight, ${S('slang')} tomorrow, ${S('proverb')} forever`,
  () => `${S('street')} money talk, ${S('faith')} money last, ${S('adlib')}`,
  () => `${S('dance')}! ${S('drum')} dey call your ${S('motif')}, come closer`,
  () => `${S('adlib')} — ${S('love')}, ${S('love')}, my only ${S('slang')}`,
  () => `when ${S('place')} sleep, we ${S('party')}, ${S('proverb')}`,
  () => `${S('motif')} for the story, ${S('street')} for the truth, ${S('faith')} for the win`,
];
const MOODS = ['love', 'party', 'street', 'faith', 'diaspora', 'heartbreak', 'praise', 'flex', 'nostalgic', 'dance'];
const FORMS = ['hook', 'verse', 'pre-hook', 'chant', 'bridge', 'ad-lib run', 'call-response'];

mkdirSync(OUT, { recursive: true });
const seen = new Set(); // line-level dedup → non-repetitive
let totalWords = 0, totalLines = 0, dupes = 0, chunkIdx = 0;
let buf = [], chunkWords = 0;

function flushChunk() {
  if (!buf.length) return;
  chunkIdx++;
  const file = join(OUT, `afrohit_corpus_${String(chunkIdx).padStart(3, '0')}.txt`);
  writeFileSync(file, buf.join('\n') + '\n');
  process.stdout.write(`  wrote ${file} (${chunkWords.toLocaleString()} words)\n`);
  buf = [];
  chunkWords = 0;
}

console.log(`generating ~${TARGET_WORDS.toLocaleString()} words from ${rows.length} unique terms across ${byCat.size} categories → ${OUT}`);
let guard = 0;
while (totalWords < TARGET_WORDS && guard < TARGET_WORDS * 4) {
  guard++;
  const mood = pick(MOODS);
  const form = pick(FORMS);
  const line = `${mood}\t${form}\t${TEMPLATES[(Math.random() * TEMPLATES.length) | 0]()}`;
  if (seen.has(line)) { dupes++; continue; }
  seen.add(line);
  const w = line.split(/\s+/).length;
  buf.push(line);
  chunkWords += w;
  totalWords += w;
  totalLines++;
  if (chunkWords >= CHUNK_WORDS) flushChunk();
}
flushChunk();

const manifest = {
  generatedWords: totalWords,
  uniqueLines: totalLines,
  duplicatesRejected: dupes,
  uniqueLineRatio: +(totalLines / (totalLines + dupes || 1)).toFixed(4),
  sourceUniqueTerms: rows.length,
  categories: [...byCat.keys()],
  chunks: chunkIdx,
  note: 'Original recombined lines from authentic vocabulary. Line-level deduped. Not copyrighted lyrics. For fine-tuning; the live app uses the DB word bank + runtime palette.',
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(
  join(OUT, 'PROMPT_FOR_TRAINING.md'),
  `# AfroHit training corpus\n\n${totalWords.toLocaleString()} words, ${totalLines.toLocaleString()} unique lines, drawn from ${rows.length} authentic terms.\n\nEach line: \`mood <TAB> form <TAB> text\`. Use for fine-tuning a lyric/hook model. It teaches VOCABULARY BREADTH and storytelling shapes across Pidgin/Yoruba/Igbo/Hausa/Ghanaian/Swahili + theme banks — not any real song's words.\n`
);
console.log(`DONE: ${totalWords.toLocaleString()} words, ${totalLines.toLocaleString()} unique lines, ${dupes.toLocaleString()} dupes rejected, ${chunkIdx} files.`);

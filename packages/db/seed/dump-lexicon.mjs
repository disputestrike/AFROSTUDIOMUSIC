/**
 * Dump the baked lexicon TS modules (SEED_LEXICON + EXPANSION_LEXICON) into a
 * flat lexicon-all.json the corpus generator reads. They are pure JSON arrays
 * behind an `export const ... =` prefix, so we slice + parse.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const AI = join(HERE, '..', '..', 'ai', 'src');

function parseArrayExport(file) {
  if (!existsSync(file)) return [];
  const src = readFileSync(file, 'utf8');
  // Slice the array from the `= [ ... ];` of the export — NOT the first `[`,
  // which is the `SeedLexRow[]` type annotation (that gave an empty array).
  const eq = src.indexOf('] = ');
  const from = eq >= 0 ? src.indexOf('[', eq + 3) : src.indexOf('= [') >= 0 ? src.indexOf('[', src.indexOf('= [')) : src.indexOf('[');
  const end = src.lastIndexOf(']');
  if (from < 0 || end < 0 || end <= from) return [];
  try { return JSON.parse(src.slice(from, end + 1)); } catch { return []; }
}

const seed = parseArrayExport(join(AI, 'lexicon-seed.ts'));
const expansion = parseArrayExport(join(AI, 'lexicon-expansion.ts'));
const all = [...seed, ...expansion].filter((r) => r?.term);
writeFileSync(join(HERE, 'lexicon-all.json'), JSON.stringify(all));
console.log(`dumped ${all.length} terms (${seed.length} seed + ${expansion.length} expansion) → lexicon-all.json`);

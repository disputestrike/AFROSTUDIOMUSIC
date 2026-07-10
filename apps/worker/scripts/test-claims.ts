/**
 * CLAIMS-EVIDENCE probe (docs/CLAIMS_EVIDENCE.md) — fails the suite if a HELD
 * phrase or an invented number appears in user-visible web source strings.
 * Adopted from the CrucibAI honesty layer: a claim without stored evidence
 * never ships. Comments are skipped (stripped from production bundles).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const WEB_ROOT = join(__dirname, '..', '..', 'web');
// Held phrases + invented-number shapes. Hex colors (#1f2937) are excluded by
// requiring a non-hex boundary after "#1".
const HELD: Array<{ re: RegExp; why: string }> = [
  { re: /radio[- ]ready/i, why: 'held: say "mastered to a competitive streaming loudness (measured)"' },
  { re: /studio[- ]quality|industry[- ]standard/i, why: 'held: unmeasured comparative' },
  { re: /guaranteed hit|will go viral/i, why: 'held: A&R is advisory — "N/100, your ear decides"' },
  { re: /\bnumber one\b|best in the world/i, why: 'held: superlative without external evidence' },
  { re: /#1(?![0-9a-fA-F])/, why: 'held: superlative without external evidence' },
  { re: /\b9[0-9]\.[0-9]%|\b[0-9]{2,3}% success/i, why: 'held: invented percentage — metrics render from stored values only' },
  { re: /99\.9+% (uptime|reliable)/i, why: 'held: fabricated uptime' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const hits: string[] = [];
for (const file of walk(WEB_ROOT)) {
  const rel = relative(WEB_ROOT, file).replace(/\\/g, '/');
  readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    for (const h of HELD) {
      if (h.re.test(line)) hits.push(`${rel}:${i + 1} [${h.why}] ${t.slice(0, 100)}`);
    }
  });
}

if (hits.length) {
  console.log('FAIL  claims probe — held phrases/invented numbers in user-visible source:');
  for (const h of hits.slice(0, 15)) console.log('  ' + h);
  process.exit(1);
}
console.log('PASS  claims probe: no held phrases, no invented numbers (docs/CLAIMS_EVIDENCE.md)');
process.exit(0);

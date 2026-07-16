/**
 * Scans user-visible web sources for provider brand names. Internal lowercase
 * identifiers are allowed, and the explicit benchmark screen may identify the
 * competitor whose evidence it measures. All other product surfaces stay neutral.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const WEB_ROOT = join(__dirname, '..', '..', 'web');
const VENDOR = /Suno|ElevenLabs|Eleven Labs|MiniMax|ACE-Step|Ace Step|Stable Audio|Replicate|sunoapi|replicate\.com|suno\.com/;
const ALLOW = new Set<string>([
  'app/(app)/benchmark/page.tsx',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

let fail = 0;
const hits: string[] = [];
for (const file of walk(WEB_ROOT)) {
  const rel = relative(WEB_ROOT, file).replace(/\\/g, '/');
  if (ALLOW.has(rel)) continue;
  const lines = readFileSync(file, 'utf-8').split('\n');
  lines.forEach((line, i) => {
    const t = line.trim();
    // Comments are stripped from production bundles — copy in strings/JSX is not.
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (VENDOR.test(line)) hits.push(`${rel}:${i + 1}: ${t.slice(0, 110)}`);
  });
}

if (hits.length) {
  fail = 1;
  console.log('FAIL  wall-probe: vendor names in user-visible web sources:');
  for (const h of hits.slice(0, 20)) console.log('  ' + h);
} else {
  console.log('PASS  wall-probe: vendor names are isolated to the explicit benchmark surface');
}
process.exit(fail);

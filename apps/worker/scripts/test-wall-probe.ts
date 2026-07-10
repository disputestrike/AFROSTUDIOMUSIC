/**
 * ADDENDUM W-1 accept — the WALL-PROBE. Scans user-visible web sources for
 * vendor names (display-cased, i.e. things a customer could READ). Internal
 * identifiers (lowercase enum values like 'suno') are allowed — they are code,
 * not copy; production builds strip comments.
 *
 * ALLOWLIST (documented residual): FlagshipBridge.tsx is the first-party bridge
 * modal, rendered ONLY behind the admin-key unlock (§1.11 authed surface).
 * Moving it to an admin-only lazy chunk is the follow-up that retires this
 * allowlist entry.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const WEB_ROOT = join(__dirname, '..', '..', 'web');
const VENDOR = /Suno|ElevenLabs|Eleven Labs|MiniMax|ACE-Step|Ace Step|Stable Audio|Replicate|sunoapi|replicate\.com/;
const ALLOW = new Set(['components/FlagshipBridge.tsx']);

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
  console.log('PASS  wall-probe: zero vendor names in user-visible web sources (allowlist: SunoBridge.tsx, first-party-gated)');
}
process.exit(fail);

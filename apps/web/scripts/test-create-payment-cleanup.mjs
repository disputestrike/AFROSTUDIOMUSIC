import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/(app)/create/page.tsx', import.meta.url), 'utf8');

assert.match(source, /function isExplicitPaymentRequired\(error: unknown\)/);
assert.match(source, /\/\^402\(\?:\\s\|\$\)\//);

const flows = [
  { route: '/drop', accepted: 'saveProduce({ dropJobId:' },
  { route: '/beats/generate', accepted: 'saveProduce({ renderJobId:' },
];

for (const flow of flows) {
  const start = source.indexOf(flow.route);
  assert.ok(start > 0, flow.route + ' generation call must exist');
  const end = source.indexOf(flow.accepted, start);
  const block = source.slice(start, end);
  assert.match(block, /catch \(error\)/);
  assert.match(block, /if \(isExplicitPaymentRequired\(error\)\)[\s\S]*api\.del\('\/projects\/' \+ project\.id\)/);
}

assert.doesNotMatch(source, /catch \{[\s\S]{0,120}api\.del\('\/projects\/'/);

console.log('create payment cleanup: explicit 402 only');

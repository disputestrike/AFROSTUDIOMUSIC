/**
 * EVIDENCE DEMO — owner wave 2026-07-12 (titles + instrumentation).
 * Feeds the catalog's REAL sentence-soup titles through the new Title Law and
 * prints the exact style prompt an engine receives with instrument picks.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/demo-title-instruments.ts
 */
import { titleLawCheck, pickLawfulTitle } from '@afrohit/shared';
import { composeStyleTags } from '@afrohit/ai';

console.log('=== TITLE LAW on the catalog\'s real titles ===');
const realTitles = [
  'Mama, my voice dey blast, hot like jollof—ooo',
  'Wetin We Go Call This Kind God',
  'This Block Na We Get Am',
  'Only Perfume I Wear',
  'Steady Love, No Rush',
  'First Salary Land',
  'Night No Stop',
  'Voice Dey Blast',
  'Tobechi',
];
for (const t of realTitles) {
  const check = titleLawCheck(t);
  const after = check.ok ? t : pickLawfulTitle([t], t);
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  "${t}"${check.ok ? '' : `  ->  "${after}"  (${check.reasons.join('; ')})`}`);
}

console.log('\n=== INSTRUMENTATION LINE — what the engine actually receives ===');
const tags = composeStyleTags(
  {
    genre: 'afrobeats',
    bpm: 104,
    keySignature: 'A minor',
    dnaTags: ['shekere 16ths', 'talking drum fills'],
    vibePrompt: 'midnight Lagos drive energy',
    instruments: ['saxophone', 'talking drum', 'highlife guitar', 'warm sub bass'],
  } as never,
  { fallbackLiteral: 'radio-ready' }
);
tags.forEach((t, i) => console.log(`  [${i}] ${t}`));

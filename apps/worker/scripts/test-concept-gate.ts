/**
 * HIT CONCEPT GATE test — the object-removal test that kills scenery-first
 * premises before production (owner directive 2026-07-13: the danfo/pepper-soup/
 * "gbe body" failures were UPSTREAM — props instead of a feeling).
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-concept-gate.ts
 */
import { conceptSceneryDependent, POSITIVE_CONCEPT_EXEMPLARS, NEGATIVE_CONCEPT_EXEMPLARS, HUMAN_ENGINES, writerTrainingBrief, WRITER_HOOK_ANCHORS } from '@afrohit/shared';

function assert(cond: boolean, msg: string) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg); }

// SCENERY-DEPENDENT concepts (the failures) are rejected.
assert(conceptSceneryDependent('A lively afrobeats song about people dancing beside a danfo at the bus stop'), 'danfo party concept flagged scenery-dependent');
assert(conceptSceneryDependent('Pepper soup by the bus stop, steam rising, the whole market smells it'), 'pepper-soup scene flagged scenery-dependent');
assert(conceptSceneryDependent('Gbe body by danfo lane, streetlight, generator, gele'), 'gbe-body scenery flagged');

// EMOTION-FIRST concepts (the exemplars) survive the object-removal test.
assert(!conceptSceneryDependent('defiance and self-belief — I move without waiting for anyone to approve me'), 'defiance concept survives (No Permission)');
assert(!conceptSceneryDependent('two lovers each pretending they are ready to walk away'), 'pretend-breakup concept survives (Call My Bluff)');
assert(!conceptSceneryDependent('a shy person keeps denying an attraction their body already revealed'), 'hidden-attraction concept survives (No Dey Hide)');
assert(!conceptSceneryDependent('finally receiving recognition after years of being overlooked'), 'recognition concept survives (My Turn)');

// The corpus is present and teachable.
assert(POSITIVE_CONCEPT_EXEMPLARS.length >= 45, `>=45 positive exemplars loaded (${POSITIVE_CONCEPT_EXEMPLARS.length})`);
assert(POSITIVE_CONCEPT_EXEMPLARS.every((e) => !conceptSceneryDependent(e.engine)), 'EVERY positive exemplar passes the object-removal test');
assert(NEGATIVE_CONCEPT_EXEMPLARS.some((e) => /sip am bam|gbe body|danfo/i.test(e.title + e.why)), 'negative exemplars name the real failures');
assert((HUMAN_ENGINES as readonly string[]).includes('defiance') && (HUMAN_ENGINES as readonly string[]).includes('longing'), 'human-engine menu present');

// WRITER TRAINING — the exemplars now train the LYRIC (not just the concept).
const brief = writerTrainingBrief();
assert(brief.includes('STUDY THESE') && brief.includes('No Permission'), 'writer training brief carries the positive hook anchors');
assert(/NEVER write hooks like these/.test(brief) && /Sip am bam/i.test(brief), 'writer training brief carries the negative hooks');
assert(WRITER_HOOK_ANCHORS.length >= 8, `>=8 writer hook anchors (${WRITER_HOOK_ANCHORS.length})`);

console.log(process.exitCode ? '\n❌ Concept gate test FAILED' : '\n✅ Concept gate test PASSED');

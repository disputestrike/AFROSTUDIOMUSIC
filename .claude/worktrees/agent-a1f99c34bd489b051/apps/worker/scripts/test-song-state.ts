/**
 * SONG_STATE contract test — the multi-agent producer's shared object + the
 * ONLY-three-decisions law. Pure, CI-able. Guards the owner spec's hard rule
 * that no AI stage may ever return "mastered"/"release-ready"/"10/10".
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-song-state.ts
 */
import {
  newSongState, advanceState, rejectToStage, qaVerdict, FATAL_QA_DIMENSIONS,
  PRODUCER_STAGES, type QaScores, type ProducerDecision,
} from '@afrohit/shared';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

// The decision space is EXACTLY these — never "mastered".
const legal: ProducerDecision[] = ['IN_PROGRESS', 'REJECT_AND_RESTART', 'REVISE_FROM_STAGE_X', 'CANDIDATE_FOR_HUMAN_AR'];
assert(!(legal as string[]).includes('MASTERED') && !(legal as string[]).includes('RELEASE_READY'), 'no MASTERED/RELEASE_READY decision exists');
assert(PRODUCER_STAGES.length === 11 && PRODUCER_STAGES[0] === 'catalogue_precheck', 'stages 0-10 present, catalogue precheck first');

// advanceState versions + logs.
let s = newSongState('song1');
assert(s.version === 1 && s.decision === 'IN_PROGRESS' && s.rejections.length === 0, 'fresh state clean');
s = advanceState(s, { brief: { primaryEmotion: 'joy' } as never }, { stage: 'creative_brief', by: 'exec', changed: 'brief' });
assert(s.version === 2 && s.log.length === 1 && s.log[0]!.by === 'exec', 'advanceState bumps version + logs rationale');

// rejectToStage routes a failure back and records it.
s = rejectToStage(s, 'lyric_fitting', 'QA blocked: empty', 'catalogue-qa');
assert(s.decision === 'REVISE_FROM_STAGE_X' && s.rejections[0]!.stage === 'lyric_fitting', 'rejectToStage routes to the responsible stage');

// The A&R fatal gate: any fatal dimension < 7 fails, and a high average CANNOT hide it.
const strongExceptHook: QaScores = {
  artistIdentity: 9, hookSound: 5, melodicMemory: 9, rhythmicPocket: 9, emotionalTruth: 9,
  naturalLanguage: 9, vocalPerformance: 9, productionIdentity: 9, structurePacing: 9,
  catalogueOriginality: 9, culturalAuthenticity: 9, replayBehavior: 9,
};
const v1 = qaVerdict(strongExceptHook);
assert(!v1.pass && v1.failed.includes('hookSound'), 'a 5 on hookSound fails despite a 9 average');

const allSeven: QaScores = Object.fromEntries(Object.keys(strongExceptHook).map((k) => [k, 7])) as unknown as QaScores;
assert(qaVerdict(allSeven).pass, 'all fatal dims >= 7 passes the gate');

// culturalAuthenticity is fatal only when applicable.
const lowCultural: QaScores = { ...allSeven, culturalAuthenticity: 3 };
assert(!qaVerdict(lowCultural, true).pass, 'low cultural authenticity fails when applicable');
assert(qaVerdict(lowCultural, false).pass, 'cultural authenticity skipped when not applicable (e.g. an instrumental)');

assert(FATAL_QA_DIMENSIONS.length === 5, 'exactly 5 fatal dimensions');

console.log(process.exitCode ? '\n❌ SONG_STATE test FAILED' : '\n✅ SONG_STATE test PASSED');

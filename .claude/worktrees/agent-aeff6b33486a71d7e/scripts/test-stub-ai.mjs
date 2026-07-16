// Verify STUB_AI mode returns deterministic canned data for every prompt family.
// Drive directly against the compiled @afrohit/ai package — no HTTP, no DB needed.
process.env.STUB_AI = '1';
process.env.OPENAI_API_KEY = 'not-needed';

import { responsesJson, scoreItems, runRightsCheck, canonicalReceiptHash } from '../packages/ai/dist/index.js';
import * as prompts from '../packages/ai/dist/prompts/index.js';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); pass++; }
  else { console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); fail++; }
}

console.log('=== STUB_AI verification ===');

// Hooks
const h = await responsesJson({ system: prompts.HOOK_SYSTEM, user: JSON.stringify({ task: 'generate 7 hooks' }) });
check('stub HOOK returns hooks array', Array.isArray(h.hooks));
check('stub HOOK count == 7 (from prompt)', h.hooks.length === 7, `got=${h.hooks.length}`);
check('stub HOOK has text', !!h.hooks[0].text);
check('stub HOOK has language', Array.isArray(h.hooks[0].language));

// Lyrics
const l = await responsesJson({ system: prompts.LYRIC_SYSTEM, user: '{}' });
check('stub LYRIC has title', !!l.title);
check('stub LYRIC has body', !!l.body);
check('stub LYRIC has structure.sections', Array.isArray(l.structure?.sections));
check('stub LYRIC has cleanVersion', !!l.cleanVersion);
check('stub LYRIC has languageMix', !!l.languageMix);

// Brief
const b = await responsesJson({ system: prompts.BRIEF_POLISH_SYSTEM, user: JSON.stringify({ rawIdea: 'test' }) });
check('stub BRIEF has mood', !!b.mood);
check('stub BRIEF has topic', !!b.topic);
check('stub BRIEF has language array', Array.isArray(b.language));

// Taste
const t = await responsesJson({
  system: prompts.TASTE_SYSTEM,
  user: JSON.stringify({ items: [{ id: 'a', text: 'foo', kind: 'hook' }, { id: 'b', text: 'bar', kind: 'hook' }] }),
});
check('stub TASTE returns scores array', Array.isArray(t.scores));
check('stub TASTE scores echo back ids', t.scores[0]?.id === 'a' && t.scores[1]?.id === 'b');
check('stub TASTE has all 10 dimensions', Object.keys(t.scores[0].dimensions).length === 10);
check('stub TASTE overall is 0-10', t.scores[0].overall >= 0 && t.scores[0].overall <= 10);

// Rights
const r = await responsesJson({ system: prompts.RIGHTS_CHECK_SYSTEM, user: '{}' });
check('stub RIGHTS has findings array', Array.isArray(r.findings));
check('stub RIGHTS overallRisk = low', r.overallRisk === 'low');
check('stub RIGHTS okToExport = true', r.okToExport === true);

// Storyboard
const s = await responsesJson({ system: prompts.STORYBOARD_SYSTEM, user: '{}' });
check('stub STORYBOARD has title', !!s.title);
check('stub STORYBOARD has shots', Array.isArray(s.shots) && s.shots.length > 0);
check('stub STORYBOARD shots have prompt+duration', s.shots[0].prompt && typeof s.shots[0].duration_s === 'number');

// scoreItems wrapper
const fakeArtist = { stageName: 'Demo', laneSummary: 'smooth', languages: ['pcm'], vocalTone: [], references: [], forbiddenStyles: [] };
const scored = await scoreItems({ artist: fakeArtist, items: [{ id: 'x1', text: 'fake hook', kind: 'hook' }] });
check('scoreItems wrapper returns 1 score', scored.length === 1);
check('scoreItems echoes id', scored[0].id === 'x1');

// runRightsCheck wrapper (no red flags in stub input)
const rc = await runRightsCheck({ lyricBody: 'safe', hookText: 'safe', references: [], producerNotes: '' });
check('runRightsCheck okToExport = true (clean input)', rc.okToExport === true);

// Heuristic red-flag detection
const rcBad = await runRightsCheck({ lyricBody: 'make it sound like wizkid', hookText: '', references: [], producerNotes: '' });
check('runRightsCheck detects impersonation phrase', rcBad.findings.some((f) => f.type === 'impersonation'), `findings=${JSON.stringify(rcBad.findings)}`);

// canonicalReceiptHash determinism
const hash1 = await canonicalReceiptHash({ foo: 'bar', baz: 1 });
const hash2 = await canonicalReceiptHash({ baz: 1, foo: 'bar' });
check('canonicalReceiptHash sha256 length=64', hash1.length === 64);
check('canonicalReceiptHash deterministic across key order', hash1 === hash2);

console.log(`---\nSTUB_AI: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);

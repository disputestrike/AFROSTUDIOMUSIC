import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const signin = readFileSync(new URL('../app/signin/page.tsx', import.meta.url), 'utf8');
const learning = readFileSync(new URL('../components/LearnMySound.tsx', import.meta.url), 'utf8');
const create = readFileSync(new URL('../app/(app)/create/page.tsx', import.meta.url), 'utf8');

for (const [name, source] of [['signin', signin], ['learning', learning], ['create', create]]) {
  assert.doesNotMatch(source, /(?:Ã|â€|â€”|ðŸ)/, `${name} contains mojibake`);
  assert.doesNotMatch(source, /\p{Extended_Pictographic}/u, `${name} uses emoji text instead of interface icons`);
}

// Authentication preserves the brief as a visible prefill, never as an
// auto-generation instruction. Signup ends with an explicit first choice.
assert.match(signin, /await api\.post\('\/auth\/signup'/);
assert.match(signin, /setAccountReady\(true\)/);
assert.match(signin, /\/listen\?onboarding=sound/);
assert.match(signin, /\/create\?vibe=/);
assert.match(signin, /Nothing runs or spends credits until you confirm/);
assert.doesNotMatch(signin, /produce=1/);

// Sound learning remains optional and fail-closed on versioned rights consent.
assert.match(learning, /if \(!rightsConfirmed \|\| running \|\| items\.length === 0\) return/);
assert.match(learning, /OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION/);
assert.match(learning, /confirmed: true/);
assert.match(learning, /Uploading is optional/);
assert.match(learning, /role="progressbar"/);
assert.match(learning, /function retryFailed\(\)/);
assert.match(learning, /Most tracks take 2-6 minutes each/);

// Creator clicks review expected work before generation. Existing preflight,
// idempotency, sticky resume, and retry-with-confirmation protections remain.
for (const action of ['song', 'lyrics', 'instrumental', 'film']) {
  assert.match(create, new RegExp(`requestRender\\('${action}'\\)`), `${action} must open render review`);
}
assert.match(create, /No work has started yet/);
assert.match(create, /Confirm and start/);
assert.match(create, /\/billing\/preflight/);
assert.match(create, /Idempotency-Key/);
assert.match(create, /\?resume=1/);
assert.match(create, /function retryLastBrief\(\)[\s\S]*setPendingAction\(lastAction\)/);
assert.match(create, /Retrying returns to a confirmation step/);

// Completion and playback make the professional handoff discoverable.
assert.match(create, /Open project and export stems/);
assert.match(create, /Open Catalog for stems and DAW export/);
assert.match(create, /FL Studio, Ableton, Logic/);

console.log('onboarding UX: consent, no-auto-spend, recovery, and DAW handoff contracts pass');

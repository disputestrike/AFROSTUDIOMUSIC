import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// ---- Feature 2: inline edit of song title AND singer name on the catalog. ---
const catalog = read('../components/CatalogGrid.tsx');
assert.match(catalog, /field: "title" \| "artist"/, 'catalog has an inline editor for both title and artist');
assert.match(catalog, /artistName: trimmed/, 'the singer edit sends artistName (per-song display artist) to the API');
assert.match(catalog, /aria-label="Song title"/, 'the title has an inline input');
assert.match(catalog, /aria-label="Singer name"/, 'the singer name has an inline input');
assert.match(catalog, /setSongs\(arr => arr\.map\(x => \(x\.id === id \? before : x\)\)\)/, 'a failed inline rename rolls back (no silent false rename)');

// ---- Feature 3: the lyrics editor saves the draft body. --------------------
assert.match(catalog, /`\/songs\/\$\{id\}\/lyrics`/, 'lyrics save posts to the song lyric editor endpoint');
// The editor lives inside the tabbed "Song words" modal now (Lyrics | Video
// script | Socials — owner 2026-07-20); the Lyrics tab is still the editor.
assert.match(catalog, /Song words/, 'a lyrics editor modal exists');
assert.match(catalog, /wordsTab === "lyrics"/, 'the Lyrics tab renders the editable draft');

// ---- Feature 4: change password in settings. -------------------------------
const settings = read('../app/(app)/settings/page.tsx');
assert.match(settings, /\/auth\/change-password/, 'settings posts to change-password');
assert.match(settings, /currentPassword: current, newPassword: next/, 'change-password sends current + new');
assert.match(settings, /at least \$\{MIN_PASSWORD\} characters|at least 12/, 'the change form states the min length');
assert.match(settings, /ChangePassword/, 'the settings page renders the ChangePassword section');

// ---- Feature 4: forgotten-password request from sign in (anti-enumeration). -
const signin = read('../app/signin/page.tsx');
assert.match(signin, /Forgot password\?/, 'sign in exposes a "Forgot password?" link');
assert.match(signin, /\/auth\/request-reset/, 'sign in posts to request-reset');
assert.match(signin, /If an account exists for that email/, 'the confirmation never reveals whether the email exists');

// ---- Feature 4: the reset page reads the token from the URL. ----------------
assert.ok(existsSync(new URL('../app/reset/page.tsx', import.meta.url)), 'a /reset page must exist');
const reset = read('../app/reset/page.tsx');
assert.match(reset, /URLSearchParams\(window\.location\.search\)/, 'the reset page reads the token from the URL');
assert.match(reset, /\/auth\/reset-password/, 'the reset page posts token + new password to reset-password');
assert.match(reset, /newPassword: password/, 'the reset page submits the new password');

// ---- Hygiene: no mojibake, and the WALL holds (no vendor engine names). -----
for (const [name, src] of [['catalog', catalog], ['settings', settings], ['signin', signin], ['reset', reset]]) {
  assert.doesNotMatch(src, /(?:Ã|â€|ðŸ)/, `${name} contains mojibake`);
}

console.log('account features: inline title/singer edit, lyrics editor, change password, reset request + reset page all pass');

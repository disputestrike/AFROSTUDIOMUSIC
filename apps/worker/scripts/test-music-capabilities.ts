import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateMusicRoute, type MusicRouteCapabilities } from '../../api/src/lib/music-capabilities';

let failures = 0;
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
};

const base: MusicRouteCapabilities = {
  workspaceProvider: null,
  firstParty: false,
  sunoAllowed: false,
  elevenAllowed: false,
  flagship: false,
  advanced: false,
  standard: false,
  sunoAvailable: false,
  elevenAvailable: false,
  replicateAvailable: false,
};

const saved = {
  SONG_ENGINE: process.env.SONG_ENGINE,
  INSTRUMENTAL_ENGINE: process.env.INSTRUMENTAL_ENGINE,
  MUSIC_PROVIDER: process.env.MUSIC_PROVIDER,
};
delete process.env.SONG_ENGINE;
delete process.env.INSTRUMENTAL_ENGINE;
delete process.env.MUSIC_PROVIDER;

try {
  check(!validateMusicRoute(undefined, base).ok, 'Auto fails before charge when no route is connected');
  check(validateMusicRoute(undefined, { ...base, standard: true, replicateAvailable: true }).ok, 'Auto accepts a connected standard route');

  const customerFlagship = validateMusicRoute('suno', { ...base, sunoAvailable: true });
  check(!customerFlagship.ok && customerFlagship.statusCode === 403, 'Customer cannot explicitly select first-party flagship');

  const disconnectedFlagship = validateMusicRoute('suno', { ...base, firstParty: true, sunoAllowed: true });
  check(!disconnectedFlagship.ok && disconnectedFlagship.statusCode === 409, 'First-party flagship selection requires a connection');

  const unapprovedAdvanced = validateMusicRoute('eleven', { ...base, elevenAvailable: true });
  check(!unapprovedAdvanced.ok && unapprovedAdvanced.statusCode === 403, 'Advanced customer route requires commercial approval');

  const disconnectedAdvanced = validateMusicRoute('eleven', { ...base, elevenAllowed: true });
  check(!disconnectedAdvanced.ok && disconnectedAdvanced.statusCode === 409, 'Approved advanced route still requires a connection');

  const selectedButBlocked = validateMusicRoute(undefined, {
    ...base,
    workspaceProvider: 'eleven',
    standard: true,
    replicateAvailable: true,
  });
  check(!selectedButBlocked.ok && selectedButBlocked.statusCode === 403, 'A blocked saved route cannot silently fall through to another engine');

  check(!validateMusicRoute('minimax', base).ok, 'Explicit standard route requires a Replicate connection');
  check(validateMusicRoute('replicate', { ...base, standard: true, replicateAvailable: true }).ok, 'Legacy Replicate full-song selection normalizes to MiniMax');
  check(!validateMusicRoute('stub', { ...base, standard: true }).ok, 'Stub and unknown selections fail closed');

  process.env.MUSIC_PROVIDER = 'replicate';
  check(validateMusicRoute(undefined, { ...base, standard: true, replicateAvailable: true }, false).ok, 'Instrumental env route resolves to the full-length standard engine');
  process.env.SONG_ENGINE = 'stable_audio';
  check(!validateMusicRoute(undefined, { ...base, standard: true }, true).ok, 'Removed vocal env route cannot hide behind another connected engine');

  const createPage = readFileSync(resolve(process.cwd(), '../web/app/(app)/create/page.tsx'), 'utf8');
  check(
    createPage.includes('disabled={!hasMusicRoute}')
      && createPage.includes('lyricsText.trim().length < 20 || !hasMusicRoute'),
    'Create UI disables generation when no music route is connected',
  );
  check(
    createPage.includes('if (!autoProduce || musicRoutes === null) return;')
      && createPage.includes('No music engine is connected.'),
    'Auto-create waits for capabilities and fails before starting without a route',
  );
} finally {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

if (failures) process.exit(1);
console.log('music-capabilities: all route policy contracts green');

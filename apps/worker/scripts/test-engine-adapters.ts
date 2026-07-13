/**
 * Every advertised provider must resolve to a real adapter. Typos, removed
 * providers, and the historical stub must fail closed.
 */
import { defaultInstrumentalEngine, defaultSongEngine, musicAdapter } from '@afrohit/ai';
import { MUSIC_PROVIDERS } from '@afrohit/shared';
import { credentialForEngine, elevenMusicRouteApproved, resolveMusicCredentials, workspaceProviderEngine } from '../src/lib/music-routing';

let failures = 0;
const fail = (message: string) => {
  console.error(`FAIL: ${message}`);
  failures++;
};

const names = [
  'MUSIC_PROVIDER',
  'INSTRUMENTAL_ENGINE',
  'SONG_ENGINE',
  'SUNO_API_KEY',
  'SUNOAPI_KEY',
  'ELEVEN_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVEN_LABS_API_KEY',
  'XI_API_KEY',
  'REPLICATE_API_TOKEN',
  'REPLICATE_TOKEN',
] as const;
const saved = new Map(names.map((name) => [name, process.env[name]]));
for (const name of names) delete process.env[name];

try {
  if (defaultInstrumentalEngine() !== 'unavailable') {
    fail(`no-key instrumental must be unavailable, got '${defaultInstrumentalEngine()}'`);
  }
  if (defaultSongEngine() !== 'unavailable') {
    fail(`no-key song engine must be unavailable, got '${defaultSongEngine()}'`);
  }

  process.env.REPLICATE_API_TOKEN = 'r8_test';
  if (defaultInstrumentalEngine() !== 'minimax') {
    fail(`Replicate full instrumental must use MiniMax, got '${defaultInstrumentalEngine()}'`);
  }
  if (defaultSongEngine() !== 'minimax') {
    fail(`Replicate vocal song must use MiniMax, got '${defaultSongEngine()}'`);
  }
  process.env.MUSIC_PROVIDER = 'replicate';
  if (defaultInstrumentalEngine() !== 'minimax') {
    fail('MUSIC_PROVIDER=replicate incorrectly selected short MusicGen for a full instrumental');
  }
  process.env.SONG_ENGINE = 'replicate';
  if (defaultSongEngine() !== 'minimax') {
    fail('SONG_ENGINE=replicate incorrectly selected short MusicGen for a vocal song');
  }

  delete process.env.MUSIC_PROVIDER;
  delete process.env.SONG_ENGINE;
  delete process.env.REPLICATE_API_TOKEN;
  process.env.ELEVEN_API_KEY = 'xi_test';
  if (defaultInstrumentalEngine() !== 'eleven' || defaultSongEngine() !== 'eleven') {
    fail('Eleven-only configuration did not route both song modes to Eleven');
  }

  for (const provider of MUSIC_PROVIDERS) {
    if (musicAdapter(provider).name !== provider) {
      fail(`advertised provider '${provider}' does not resolve to its real adapter`);
    }
  }
  for (const engine of ['suno', 'eleven', 'minimax', 'ace_step', 'replicate']) {
    if (musicAdapter(engine).name === 'unavailable') fail(`engine '${engine}' has no adapter`);
  }
  for (const removed of ['stub', 'stable_audio', 'mubert', 'beatoven', 'totally-not-a-provider']) {
    if (musicAdapter(removed).name !== 'unavailable') {
      fail(`removed or unknown provider '${removed}' did not fail closed`);
    }
  }

  const workspaceSuno = resolveMusicCredentials('suno', 'workspace_suno', {});
  if (workspaceProviderEngine('suno') !== 'suno' || credentialForEngine('suno', workspaceSuno) !== 'workspace_suno') {
    fail('saved workspace Suno key is not used by the Suno engine');
  }
  const workspaceReplicate = resolveMusicCredentials('replicate', 'workspace_replicate', {});
  if (workspaceProviderEngine('replicate') !== 'minimax' || credentialForEngine('minimax', workspaceReplicate) !== 'workspace_replicate') {
    fail('saved workspace Replicate key is not used by the full-length MiniMax engine');
  }
  if (elevenMusicRouteApproved(false, {}) || !elevenMusicRouteApproved(false, { ELEVEN_MUSIC_CUSTOMER_ROUTE_APPROVED: '1' })) {
    fail('advanced customer route approval is not fail-closed');
  }
} finally {
  for (const name of names) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

if (failures) {
  console.error(`engine-adapters: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`engine-adapters: ${MUSIC_PROVIDERS.length} advertised providers verified; unknown and removed routes fail closed`);

import { elevenCompositionPlan, musicAdapter } from '@afrohit/ai';
import type { MusicGenerationInput } from '@afrohit/ai';

let failures = 0;
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
};

const originalFetch = globalThis.fetch;
const originalVersion = process.env.REPLICATE_MINIMAX_VERSION;
const originalSongVersion = process.env.REPLICATE_SONG_VERSION;
const originalSunoCallback = process.env.SUNO_CALLBACK_URL;
const originalSunoModel = process.env.SUNO_MODEL;
const calls: Array<{ url: string; init?: RequestInit }> = [];
const input: MusicGenerationInput = {
  genre: 'afrobeats',
  bpm: 104,
  keySignature: 'F# minor',
  durationS: 180,
  withStems: false,
  withVocals: true,
  lyrics: '[Verse 1]\nI dey move with the rhythm\n[Chorus]\nPepper kiss, e dey burn slow',
  instruments: ['talking drum', 'highlife guitar'],
  vibePrompt: 'summer confidence. in the vibe/lane of Famous Artist (capture the feel, not a copy)',
};

async function main() {
  try {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(new Uint8Array(2_048), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'song-id': 'song_test' },
      });
    }) as typeof fetch;

    const eleven = await musicAdapter('eleven', 'xi_test').generate(input);
    const vocalCall = calls.at(-1)!;
    const vocalBody = JSON.parse(String(vocalCall.init?.body)) as {
      prompt?: string;
      model_id?: string;
      composition_plan?: { chunks: Array<{ text: string; duration_ms: number; positive_styles: string[]; negative_styles: string[] }> };
    };
    const chunks = vocalBody.composition_plan?.chunks ?? [];
    check(vocalCall.url === 'https://api.elevenlabs.io/v1/music?output_format=mp3_48000_192', 'Eleven uses the documented compose endpoint');
    check((vocalCall.init?.headers as Record<string, string>)['xi-api-key'] === 'xi_test', 'Eleven uses the injected workspace key');
    check(vocalBody.model_id === 'music_v2' && !!vocalBody.composition_plan && !vocalBody.prompt, 'vocal generation uses a Music v2 composition plan');
    check(chunks.reduce((sum, chunk) => sum + chunk.duration_ms, 0) === 180_000, 'composition chunks preserve requested duration');
    check(chunks.every((chunk) => chunk.duration_ms >= 3_000 && chunk.duration_ms <= 120_000), 'every Eleven chunk is within API duration bounds');
    check(chunks.some((chunk) => chunk.text.includes('Pepper kiss, e dey burn slow')), 'the exact hook lyric reaches the composition plan');
    check(chunks[0]?.positive_styles.some((style) => /Afrobeats|West African/i.test(style)) === true, 'Afro genre identity leads the first chunk');
    check(chunks.every((chunk) => chunk.positive_styles.every((style) => !/\b(?:NOT|NO|NEVER)\b/i.test(style))), 'Eleven positive styles contain no negative instructions');
    check(!JSON.stringify(vocalBody).includes('Famous Artist'), 'generated artist-influence clauses are removed from Eleven inputs');
    check(eleven.status === 'succeeded' && eleven.output?.audioBytes?.length === 2_048 && !eleven.output.mainAudioUrl, 'byte response is returned for private worker materialization');

    calls.length = 0;
    await musicAdapter('eleven', 'xi_test').generate({ ...input, withVocals: false, durationS: 75 });
    const instrumentalBody = JSON.parse(String(calls.at(-1)?.init?.body)) as Record<string, unknown>;
    check(instrumentalBody.force_instrumental === true && instrumentalBody.music_length_ms === 75_000, 'Eleven instrumental mode is explicit and full length');
    check(!('composition_plan' in instrumentalBody), 'instrumental mode does not send a vocal composition plan');
    const afroHousePlan = elevenCompositionPlan({ ...input, genre: 'afro_house' });
    const afroHousePositive = afroHousePlan.chunks.flatMap((chunk) => chunk.positive_styles).join(' ');
    const afroHouseNegative = afroHousePlan.chunks.flatMap((chunk) => chunk.negative_styles).join(' ');
    check(/four-on-the-floor/i.test(afroHousePositive), 'Eleven afro-house keeps its defining four-on-the-floor positive');
    check(/non-four-on-the-floor/i.test(afroHouseNegative) && !/generic four-on-the-floor pop/i.test(afroHouseNegative), 'Eleven afro-house forbids losing 4x4 instead of forbidding 4x4');

    calls.length = 0;
    process.env.SUNO_CALLBACK_URL = 'https://api.example.test/webhooks/suno';
    delete process.env.SUNO_MODEL;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('record-info')) {
        return Response.json({
          code: 200,
          data: {
            status: 'SUCCESS',
            response: {
              sunoData: [
                { id: 'one', audioUrl: 'https://audio.example/one.mp3', duration: 181 },
                { id: 'two', audioUrl: 'https://audio.example/two.mp3', duration: 179 },
              ],
            },
          },
        });
      }
      return Response.json({ code: 200, data: { taskId: 'task_test' } });
    }) as typeof fetch;
    const sunoAdapter = musicAdapter('suno', 'suno_test');
    const sunoStarted = await sunoAdapter.generate(input);
    const sunoBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    check(sunoBody.model === 'V5_5' && sunoBody.callBackUrl === process.env.SUNO_CALLBACK_URL, 'gateway uses the current model and configured HTTPS callback');
    check(sunoBody.instrumental === false && String(sunoBody.prompt).includes('Pepper kiss, e dey burn slow'), 'gateway vocal mode sends the exact cleaned lyrics');
    check(String(sunoBody.negativeTags).includes('reggaeton') && sunoBody.styleWeight === 0.8, 'gateway receives explicit Afro exclusions and high style adherence');
    const sunoDone = await sunoAdapter.poll!(sunoStarted.externalId!);
    check(sunoDone.output?.mainAudioUrl === 'https://audio.example/one.mp3' && sunoDone.output.alternates?.[0]?.mainAudioUrl === 'https://audio.example/two.mp3', 'both tracks from one paid gateway request reach worker ranking');
    calls.length = 0;
    await sunoAdapter.generate({ ...input, withVocals: false });
    const sunoInstrumental = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    check(sunoInstrumental.instrumental === true && !('prompt' in sunoInstrumental), 'gateway instrumental mode ignores attached song lyrics');

    calls.length = 0;
    process.env.REPLICATE_MINIMAX_VERSION = 'version_test';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ id: 'pred_test', status: 'succeeded', output: 'https://audio.example/test.mp3' });
    }) as typeof fetch;
    const minimax = await musicAdapter('minimax', 'r8_test').generate({
      ...input,
      withVocals: false,
      durationS: 180,
    });
    const replicateBody = JSON.parse(String(calls.at(-1)?.init?.body)) as { input: Record<string, unknown> };
    check(replicateBody.input.is_instrumental === true, 'MiniMax full instrumental sets is_instrumental=true');
    check(!('lyrics_optimizer' in replicateBody.input) && !('lyrics' in replicateBody.input), 'MiniMax instrumental ignores attached lyrics and cannot invent vocals');
    check(minimax.status === 'succeeded' && minimax.output?.mainAudioUrl === 'https://audio.example/test.mp3', 'MiniMax response remains playable');

    calls.length = 0;
    process.env.REPLICATE_SONG_VERSION = 'song_version_test';
    await musicAdapter('ace_step', 'r8_test').generate({ ...input, withVocals: false });
    const aceBody = JSON.parse(String(calls.at(-1)?.init?.body)) as { input: Record<string, unknown> };
    check(aceBody.input.lyrics === '', 'ACE-Step instrumental mode ignores attached song lyrics');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalVersion === undefined) delete process.env.REPLICATE_MINIMAX_VERSION;
    else process.env.REPLICATE_MINIMAX_VERSION = originalVersion;
    if (originalSongVersion === undefined) delete process.env.REPLICATE_SONG_VERSION;
    else process.env.REPLICATE_SONG_VERSION = originalSongVersion;
    if (originalSunoCallback === undefined) delete process.env.SUNO_CALLBACK_URL;
    else process.env.SUNO_CALLBACK_URL = originalSunoCallback;
    if (originalSunoModel === undefined) delete process.env.SUNO_MODEL;
    else process.env.SUNO_MODEL = originalSunoModel;
  }

  if (failures) process.exit(1);
  console.log('music-provider-contracts: all contracts green');
}

void main();

/**
 * Voice profile + singing voice render adapter.
 *
 * Important: spoken TTS != singing voice. For believable sung vocals we plug
 * a singing-voice provider (ElevenLabs voice + their stylized speech, or a
 * dedicated SVC service). The stub adapter is for dev/local without keys.
 *
 * The consent recording flow lives in the API; this adapter only ingests
 * sample URLs into the provider.
 */
import type {
  ProviderJobResult,
  VoiceProfileSetupInput,
  VoiceProfileSetupOutput,
  VoiceProviderAdapter,
  VoiceRenderInput,
  VoiceRenderOutput,
} from './types';
import { elevenKey } from './music';

function provider(): string {
  return (process.env.VOICE_PROVIDER ?? 'stub').toLowerCase();
}

class ElevenVoiceAdapter implements VoiceProviderAdapter {
  readonly name = 'eleven';

  async createProfile(
    input: VoiceProfileSetupInput
  ): Promise<ProviderJobResult<VoiceProfileSetupOutput>> {
    const key = elevenKey();
    if (!key) return { status: 'failed', error: 'ELEVEN_API_KEY missing' };

    // Fetch each sample URL and forward as multipart upload.
    // (In production the worker likely already has the bytes in S3/MinIO.)
    const form = new FormData();
    form.append('name', input.name);
    if (input.language) form.append('labels', JSON.stringify({ language: input.language }));
    for (const url of input.sampleUrls) {
      const r = await fetch(url);
      if (!r.ok) return { status: 'failed', error: `failed to fetch sample ${url}` };
      const blob = await r.blob();
      form.append('files', blob, `sample-${Math.random().toString(36).slice(2, 8)}.mp3`);
    }
    const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    });
    if (!res.ok) {
      return { status: 'failed', error: `eleven voice add ${res.status}: ${await res.text()}` };
    }
    const data = (await res.json()) as { voice_id: string };
    return {
      status: 'succeeded',
      output: { providerVoiceId: data.voice_id },
      estimatedCostUsd: 0,
    };
  }

  async render(input: VoiceRenderInput): Promise<ProviderJobResult<VoiceRenderOutput>> {
    const key = elevenKey();
    if (!key) return { status: 'failed', error: 'ELEVEN_API_KEY missing' };

    // For singing, we pass styled text. Eleven supports style + use_speaker_boost.
    // For full sung performance you may want a dedicated singing-voice provider.
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.providerVoiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: input.lyricBody,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.85,
            style: 0.7,
            use_speaker_boost: true,
          },
        }),
      }
    );
    if (!res.ok) return { status: 'failed', error: `eleven render ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.byteLength) return { status: 'failed', error: 'eleven render returned no audio' };
    // Return the actual BYTES — the worker uploads them to storage and sets the
    // real URL. (Was a broken "inline:bytes:N" sentinel with no bytes, so the
    // stored vocalRender.url never played.)
    return {
      status: 'succeeded',
      output: {
        audioUrl: '',
        audioBytes: buf,
        durationS: 0,
        format: 'mp3',
      },
      estimatedCostUsd: Math.max(0.05, input.lyricBody.length * 0.00006),
    };
  }
}

class StubVoiceAdapter implements VoiceProviderAdapter {
  readonly name = 'stub';
  async createProfile(
    input: VoiceProfileSetupInput
  ): Promise<ProviderJobResult<VoiceProfileSetupOutput>> {
    return {
      status: 'succeeded',
      output: { providerVoiceId: `stub_${input.voiceProfileId}` },
    };
  }
  async render(): Promise<ProviderJobResult<VoiceRenderOutput>> {
    return {
      status: 'succeeded',
      output: {
        audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        durationS: 30,
        format: 'mp3',
      },
    };
  }
}

export function voiceAdapter(override?: string): VoiceProviderAdapter {
  switch (override ?? provider()) {
    case 'eleven':
      return new ElevenVoiceAdapter();
    default:
      return new StubVoiceAdapter();
  }
}

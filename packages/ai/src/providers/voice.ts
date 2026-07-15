/**
 * Voice profile + spoken preview adapter.
 *
 * Important: spoken TTS != singing voice. ElevenLabs TTS is used only for a
 * speech preview. Sung performance conversion lives in voice-sing.ts.
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
import { safeFetch } from '@afrohit/shared/server-url-safety';
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
      const r = await safeFetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) {
        await r.body?.cancel().catch(() => undefined);
        return { status: 'failed', error: `failed to fetch voice sample (${r.status})` };
      }
      const declared = Number(r.headers.get('content-length') ?? 0);
      if (declared > 50 * 1024 * 1024) {
        await r.body?.cancel().catch(() => undefined);
        return { status: 'failed', error: 'voice sample exceeds 50 MB' };
      }
      const blob = await r.blob();
      if (blob.size > 50 * 1024 * 1024) return { status: 'failed', error: 'voice sample exceeds 50 MB' };
      form.append('files', blob, `sample-${Math.random().toString(36).slice(2, 8)}.mp3`);
    }
    const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { status: 'failed', error: `eleven voice add failed (${res.status})` };
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

    // This is deliberately a spoken preview. Never file it as a sung vocal.
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

class UnavailableVoiceAdapter implements VoiceProviderAdapter {
  readonly name = 'unavailable';
  constructor(private readonly reason: string) {}
  async createProfile(): Promise<ProviderJobResult<VoiceProfileSetupOutput>> {
    return { status: 'failed', error: this.reason };
  }
  async render(): Promise<ProviderJobResult<VoiceRenderOutput>> {
    return { status: 'failed', error: this.reason };
  }
}

export function voiceAdapter(override?: string): VoiceProviderAdapter {
  const selected = (override ?? provider()).toLowerCase();
  switch (selected) {
    case 'eleven':
      return new ElevenVoiceAdapter();
    case 'stub':
      if (process.env.NODE_ENV === 'production' || process.env.ALLOW_STUB_AUDIO !== '1') {
        return new UnavailableVoiceAdapter('stub voice audio is disabled');
      }
      return new StubVoiceAdapter();
    default:
      return new UnavailableVoiceAdapter(`unsupported voice provider: ${selected || 'unconfigured'}`);
  }
}

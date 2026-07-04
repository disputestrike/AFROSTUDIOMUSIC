/**
 * Music generation adapter. Selects backend from env MUSIC_PROVIDER.
 *
 * Production-ready integrations expected:
 *  - eleven       — Eleven Labs Music API
 *  - stable_audio — Stability Stable Audio 3
 *  - mubert       — Mubert API
 *  - beatoven     — Beatoven API
 *  - stub         — synthesized silence / placeholder (dev/local without keys)
 *
 * Every adapter must implement MusicProviderAdapter and return a stable
 * ProviderJobResult so the worker can poll or finalize uniformly.
 */
import type {
  MusicGenerationInput,
  MusicGenerationOutput,
  MusicProviderAdapter,
  ProviderJobResult,
} from './types';

function provider(): string {
  return (process.env.MUSIC_PROVIDER ?? 'stub').toLowerCase();
}

class ElevenMusicAdapter implements MusicProviderAdapter {
  readonly name = 'eleven';
  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const key = process.env.ELEVEN_API_KEY;
    if (!key) {
      return { status: 'failed', error: 'ELEVEN_API_KEY missing' };
    }
    // ElevenLabs Music API — replace endpoint/payload with the exact contract from their docs.
    const body = {
      prompt: this.composePrompt(input),
      duration_seconds: input.durationS,
      with_stems: input.withStems,
    };
    const res = await fetch('https://api.elevenlabs.io/v1/music/generate', {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { status: 'failed', error: `eleven music ${res.status}: ${await res.text()}` };
    }
    const data = (await res.json()) as {
      job_id?: string;
      status?: string;
      audio_url?: string;
      stems?: Array<{ role: string; url: string }>;
    };
    if (data.audio_url) {
      return {
        externalId: data.job_id,
        status: 'succeeded',
        output: {
          mainAudioUrl: data.audio_url,
          stems: data.stems,
          format: 'wav',
          durationS: input.durationS,
          bpm: input.bpm,
          keySignature: input.keySignature,
        },
        estimatedCostUsd: Math.max(0.2, input.durationS * 0.012),
      };
    }
    return {
      externalId: data.job_id,
      status: 'running',
      pollAfterMs: 8_000,
    };
  }
  async poll(externalId: string): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const key = process.env.ELEVEN_API_KEY!;
    const res = await fetch(`https://api.elevenlabs.io/v1/music/jobs/${externalId}`, {
      headers: { 'xi-api-key': key },
    });
    if (!res.ok) return { status: 'failed', error: `poll ${res.status}` };
    const data = (await res.json()) as {
      status: string;
      audio_url?: string;
      stems?: Array<{ role: string; url: string }>;
      duration_s?: number;
    };
    if (data.status === 'succeeded' && data.audio_url) {
      return {
        externalId,
        status: 'succeeded',
        output: {
          mainAudioUrl: data.audio_url,
          stems: data.stems,
          format: 'wav',
          durationS: data.duration_s ?? 0,
        },
      };
    }
    if (data.status === 'failed') return { externalId, status: 'failed', error: 'provider failed' };
    return { externalId, status: 'running', pollAfterMs: 6_000 };
  }
  private composePrompt(input: MusicGenerationInput): string {
    return [
      `${input.genre} instrumental`,
      `${input.bpm} bpm`,
      input.keySignature ? `in ${input.keySignature}` : null,
      input.vibePrompt ?? '',
      input.artistTone?.length ? `tone: ${input.artistTone.join(', ')}` : null,
      'no vocals, leave space for lead vocal',
      input.withStems ? 'export stems' : '',
    ]
      .filter(Boolean)
      .join(', ');
  }
}

class StableAudioAdapter implements MusicProviderAdapter {
  readonly name = 'stable_audio';
  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const key = process.env.STABILITY_API_KEY;
    if (!key) return { status: 'failed', error: 'STABILITY_API_KEY missing' };
    // Replace with current Stability Stable Audio endpoint.
    const res = await fetch('https://api.stability.ai/v2beta/stable-audio/generate', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: `${input.genre} ${input.bpm}bpm ${input.keySignature ?? ''} ${input.vibePrompt ?? ''}`,
        duration: input.durationS,
        output_format: 'wav',
      }),
    });
    if (!res.ok) return { status: 'failed', error: `stable_audio ${res.status}` };
    const data = (await res.json()) as { audio_url?: string; id?: string };
    if (data.audio_url) {
      return {
        externalId: data.id,
        status: 'succeeded',
        output: {
          mainAudioUrl: data.audio_url,
          format: 'wav',
          durationS: input.durationS,
        },
        estimatedCostUsd: 0.04 * input.durationS,
      };
    }
    return { externalId: data.id, status: 'running', pollAfterMs: 8_000 };
  }
}

class MubertAdapter implements MusicProviderAdapter {
  readonly name = 'mubert';
  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const key = process.env.MUBERT_API_KEY;
    if (!key) return { status: 'failed', error: 'MUBERT_API_KEY missing' };
    // See https://mubert.com/api for current contract.
    const res = await fetch('https://api-b2b.mubert.com/v2/RecordTrackTTM', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'RecordTrackTTM',
        params: {
          pat: key,
          duration: input.durationS,
          mode: 'track',
          intensity: 'high',
          prompt: input.vibePrompt ?? `${input.genre} ${input.bpm}bpm`,
        },
      }),
    });
    if (!res.ok) return { status: 'failed', error: `mubert ${res.status}` };
    const data = (await res.json()) as { data?: { tasks?: Array<{ download_link?: string }> } };
    const url = data.data?.tasks?.[0]?.download_link;
    if (url) {
      return {
        status: 'succeeded',
        output: { mainAudioUrl: url, format: 'mp3', durationS: input.durationS },
        estimatedCostUsd: 0.03 * input.durationS,
      };
    }
    return { status: 'running', pollAfterMs: 8_000 };
  }
}

class StubMusicAdapter implements MusicProviderAdapter {
  readonly name = 'stub';
  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    // Dev placeholder — returns a public CC0 example audio for development.
    return {
      status: 'succeeded',
      output: {
        mainAudioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        stems: input.withStems
          ? [
              { role: 'drums', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
              { role: 'bass', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
              { role: 'keys', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
            ]
          : undefined,
        format: 'mp3',
        durationS: input.durationS,
        bpm: input.bpm,
        keySignature: input.keySignature,
      },
      estimatedCostUsd: 0,
    };
  }
}

export function musicAdapter(): MusicProviderAdapter {
  switch (provider()) {
    case 'eleven':
      return new ElevenMusicAdapter();
    case 'stable_audio':
      return new StableAudioAdapter();
    case 'mubert':
      return new MubertAdapter();
    default:
      return new StubMusicAdapter();
  }
}

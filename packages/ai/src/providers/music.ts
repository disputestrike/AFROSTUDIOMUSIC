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

/** Accept common env-var spellings so a naming mismatch can't silently break it. */
export function elevenKey(): string | undefined {
  return (
    process.env.ELEVEN_API_KEY ||
    process.env.ELEVENLABS_API_KEY ||
    process.env.ELEVEN_LABS_API_KEY ||
    process.env.XI_API_KEY ||
    undefined
  );
}

export function replicateToken(): string | undefined {
  return process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_TOKEN || undefined;
}

export function sunoKey(): string | undefined {
  return process.env.SUNO_API_KEY || process.env.SUNOAPI_KEY || undefined;
}

interface SunoGenResp {
  code: number;
  msg?: string;
  data?: { taskId?: string };
}
interface SunoRecordResp {
  code: number;
  msg?: string;
  data?: {
    status?: string;
    errorMessage?: string | null;
    response?: {
      sunoData?: Array<{
        id: string;
        audioUrl?: string;
        streamAudioUrl?: string;
        duration?: number;
        title?: string;
      }>;
    };
  };
}

/**
 * Suno — the catchiest full-production engine (via the sunoapi.org gateway;
 * point SUNO_API_BASE at the official API or another gateway with the same
 * contract if you prefer). We generate INSTRUMENTAL beats (the artist writes
 * the lyrics + brings their own vocal), so customMode + instrumental=true.
 *
 * Activate: MUSIC_PROVIDER=suno + SUNO_API_KEY (optional SUNO_MODEL, default V5).
 * ~$0.06–0.10/generation; stream ~30–40s, full audio ~2–3 min (we poll).
 */
class SunoAdapter implements MusicProviderAdapter {
  readonly name = 'suno';
  private base = (process.env.SUNO_API_BASE ?? 'https://api.sunoapi.org').replace(/\/+$/, '');
  constructor(private apiKey?: string) {}

  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const key = this.apiKey || sunoKey();
    if (!key) return { status: 'failed', error: 'SUNO_API_KEY missing' };
    const body = {
      customMode: true,
      instrumental: true,
      model: process.env.SUNO_MODEL ?? 'V5',
      style: this.composeStyle(input).slice(0, 900),
      title: (input.vibePrompt?.slice(0, 60) || `${input.genre ?? 'Afro'} beat`).slice(0, 80),
      callBackUrl: process.env.SUNO_CALLBACK_URL ?? 'https://afrohitstudio.app/api/suno/callback',
    };
    const res = await fetch(`${this.base}/api/v1/generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { status: 'failed', error: `suno ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const data = (await res.json()) as SunoGenResp;
    if (data.code !== 200 || !data.data?.taskId) {
      return { status: 'failed', error: `suno: ${data.msg ?? 'no taskId'}` };
    }
    return { externalId: data.data.taskId, status: 'running', pollAfterMs: 12_000 };
  }

  async poll(externalId: string): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const key = this.apiKey || sunoKey();
    if (!key) return { status: 'failed', error: 'SUNO_API_KEY missing' };
    const res = await fetch(
      `${this.base}/api/v1/generate/record-info?taskId=${encodeURIComponent(externalId)}`,
      { headers: { authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return { status: 'failed', error: `suno poll ${res.status}` };
    const data = (await res.json()) as SunoRecordResp;
    const st = data.data?.status ?? '';
    const song = data.data?.response?.sunoData?.[0];
    if (st === 'SUCCESS' && song?.audioUrl) {
      return {
        externalId,
        status: 'succeeded',
        output: { mainAudioUrl: song.audioUrl, format: 'mp3', durationS: song.duration ?? 0 },
        estimatedCostUsd: 0.08,
      };
    }
    if (/FAILED|ERROR|SENSITIVE/.test(st)) {
      return { externalId, status: 'failed', error: data.data?.errorMessage ?? st };
    }
    return { externalId, status: 'running', pollAfterMs: 8_000 };
  }

  private composeStyle(input: MusicGenerationInput): string {
    return [
      input.genre ?? 'afrobeats',
      'afro-fusion',
      `${input.bpm} bpm`,
      input.keySignature ? `key ${input.keySignature}` : null,
      input.vibePrompt ?? '',
      input.artistTone?.length ? input.artistTone.join(', ') : null,
      'catchy, modern, punchy drums, warm bass, melodic, instrumental, radio-ready, leave space for a lead vocal',
    ]
      .filter(Boolean)
      .join(', ');
  }
}

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[] | null;
  error?: string | null;
}

/**
 * Replicate — meta/musicgen. Real, original instrumental generation, pay-per-
 * compute (~$0.05–0.20/beat), no subscription. This is the recommended Phase-1
 * "make real sounds" engine: set MUSIC_PROVIDER=replicate + REPLICATE_API_TOKEN.
 * MusicGen reliably renders up to ~30s per call (great for beats/loops) and
 * does not emit separate stems.
 */
class ReplicateMusicGenAdapter implements MusicProviderAdapter {
  readonly name = 'replicate';
  constructor(private apiKey?: string) {}

  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const auth = { authorization: `Bearer ${token}` };

    // meta/musicgen is a community model → use the versioned /predictions
    // endpoint (the /models/{owner}/{name}/predictions path is official-only,
    // hence the 404). Resolve the current version unless one is pinned.
    let version = process.env.REPLICATE_MUSIC_VERSION;
    if (!version) {
      const slug = process.env.REPLICATE_MUSIC_MODEL ?? 'meta/musicgen';
      const mres = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: auth });
      if (!mres.ok) {
        return { status: 'failed', error: `replicate model lookup ${mres.status}: ${(await mres.text()).slice(0, 160)}` };
      }
      const mdata = (await mres.json()) as { latest_version?: { id?: string } };
      version = mdata.latest_version?.id;
      if (!version) return { status: 'failed', error: 'replicate: model has no version' };
    }

    const duration = Math.min(Math.max(Math.round(input.durationS ?? 30), 5), 30);
    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', prefer: 'wait' },
      body: JSON.stringify({
        version,
        input: {
          prompt: this.composePrompt(input),
          duration,
          model_version: 'stereo-large',
          output_format: 'mp3',
          normalization_strategy: 'loudness',
          temperature: 1,
          classifier_free_guidance: 3,
        },
      }),
    });
    if (!res.ok) {
      return { status: 'failed', error: `replicate ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    return this.toResult((await res.json()) as ReplicatePrediction, input);
  }

  async poll(externalId: string): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const res = await fetch(`https://api.replicate.com/v1/predictions/${externalId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { status: 'failed', error: `replicate poll ${res.status}` };
    return this.toResult((await res.json()) as ReplicatePrediction);
  }

  private toResult(
    data: ReplicatePrediction,
    input?: MusicGenerationInput
  ): ProviderJobResult<MusicGenerationOutput> {
    const url = Array.isArray(data.output) ? data.output[data.output.length - 1] : data.output;
    if (data.status === 'succeeded' && url) {
      return {
        externalId: data.id,
        status: 'succeeded',
        output: {
          mainAudioUrl: url,
          format: 'mp3',
          durationS: input?.durationS ?? 30,
          bpm: input?.bpm,
          keySignature: input?.keySignature,
        },
        estimatedCostUsd: 0.1,
      };
    }
    if (data.status === 'failed' || data.status === 'canceled') {
      return { externalId: data.id, status: 'failed', error: data.error ?? 'replicate failed' };
    }
    return { externalId: data.id, status: 'running', pollAfterMs: 5_000 };
  }

  private composePrompt(input: MusicGenerationInput): string {
    return [
      `${input.genre ?? 'afrobeats'} instrumental beat`,
      `${input.bpm} bpm`,
      input.keySignature ? `in ${input.keySignature}` : null,
      input.vibePrompt ?? '',
      input.artistTone?.length ? `mood: ${input.artistTone.join(', ')}` : null,
      'catchy, modern, radio-ready, punchy drums, warm bass, melodic, no vocals, leave space for a lead vocal',
    ]
      .filter(Boolean)
      .join(', ');
  }
}

class ElevenMusicAdapter implements MusicProviderAdapter {
  readonly name = 'eleven';
  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const key = elevenKey();
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
    const key = elevenKey()!;
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

/**
 * ACE-Step (via Replicate) — FULL SONG WITH AI VOCALS from lyrics + style tags.
 * No reference audio needed; runs on the same Replicate key. This is what makes
 * the AI actually sing the song. Model slug pinnable via REPLICATE_SONG_MODEL.
 */
class AceStepSongAdapter implements MusicProviderAdapter {
  readonly name = 'ace_step';
  constructor(private apiKey?: string) {}

  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const auth = { authorization: `Bearer ${token}` };

    let version = process.env.REPLICATE_SONG_VERSION;
    if (!version) {
      const slug = process.env.REPLICATE_SONG_MODEL ?? 'lucataco/ace-step';
      const mres = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: auth });
      if (!mres.ok) {
        return { status: 'failed', error: `replicate song model lookup ${mres.status}: ${(await mres.text()).slice(0, 160)}` };
      }
      const mdata = (await mres.json()) as { latest_version?: { id?: string } };
      version = mdata.latest_version?.id;
      if (!version) return { status: 'failed', error: 'replicate: song model has no version' };
    }

    const duration = Math.min(Math.max(Math.round(input.durationS ?? 120), 30), 240);
    const tags = [
      input.genre ?? 'afrobeats',
      'afro-fusion',
      `${input.bpm} bpm`,
      input.keySignature ? `key ${input.keySignature}` : null,
      input.vibePrompt ?? '',
      input.artistTone?.length ? input.artistTone.join(', ') : null,
      'catchy, melodic vocals, punchy drums, warm bass, radio-ready',
    ]
      .filter(Boolean)
      .join(', ');

    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', prefer: 'wait' },
      body: JSON.stringify({
        version,
        input: { tags, lyrics: input.lyrics ?? '', duration },
      }),
    });
    if (!res.ok) return { status: 'failed', error: `ace_step ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return this.toResult((await res.json()) as ReplicatePrediction, input);
  }

  async poll(externalId: string): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const res = await fetch(`https://api.replicate.com/v1/predictions/${externalId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { status: 'failed', error: `ace_step poll ${res.status}` };
    return this.toResult((await res.json()) as ReplicatePrediction);
  }

  private toResult(
    data: ReplicatePrediction,
    input?: MusicGenerationInput
  ): ProviderJobResult<MusicGenerationOutput> {
    const url = Array.isArray(data.output) ? data.output[data.output.length - 1] : data.output;
    if (data.status === 'succeeded' && url) {
      return {
        externalId: data.id,
        status: 'succeeded',
        output: {
          mainAudioUrl: url,
          format: 'wav',
          durationS: input?.durationS ?? 0,
          bpm: input?.bpm,
          keySignature: input?.keySignature,
        },
        estimatedCostUsd: 0.1,
      };
    }
    if (data.status === 'failed' || data.status === 'canceled') {
      return { externalId: data.id, status: 'failed', error: data.error ?? 'ace_step failed' };
    }
    return { externalId: data.id, status: 'running', pollAfterMs: 5_000 };
  }
}

/**
 * MiniMax Music (via Replicate) — full song WITH vocals from lyrics, no
 * reference track needed. Higher vocal realism than ACE-Step for many styles.
 * Selectable per request (songEngine: 'minimax'); same Replicate key.
 */
class MiniMaxSongAdapter implements MusicProviderAdapter {
  readonly name = 'minimax';
  constructor(private apiKey?: string) {}

  async generate(input: MusicGenerationInput): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const auth = { authorization: `Bearer ${token}` };

    let version = process.env.REPLICATE_MINIMAX_VERSION;
    if (!version) {
      const slug = process.env.REPLICATE_MINIMAX_MODEL ?? 'minimax/music-2.6';
      const mres = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: auth });
      if (!mres.ok) return { status: 'failed', error: `minimax model lookup ${mres.status}: ${(await mres.text()).slice(0, 160)}` };
      version = ((await mres.json()) as { latest_version?: { id?: string } }).latest_version?.id;
      if (!version) return { status: 'failed', error: 'minimax: model has no version' };
    }

    const style = [
      input.genre ?? 'afrobeats',
      `${input.bpm} bpm`,
      input.keySignature ? `key ${input.keySignature}` : null,
      input.vibePrompt ?? '',
      input.artistTone?.length ? input.artistTone.join(', ') : null,
      'catchy, melodic vocals, radio-ready',
    ]
      .filter(Boolean)
      .join(', ');

    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', prefer: 'wait' },
      body: JSON.stringify({
        version,
        input: { lyrics: input.lyrics ?? '', prompt: style, song_description: style },
      }),
    });
    if (!res.ok) return { status: 'failed', error: `minimax ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return this.toResult((await res.json()) as ReplicatePrediction, input);
  }

  async poll(externalId: string): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const res = await fetch(`https://api.replicate.com/v1/predictions/${externalId}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return { status: 'failed', error: `minimax poll ${res.status}` };
    return this.toResult((await res.json()) as ReplicatePrediction);
  }

  private toResult(data: ReplicatePrediction, input?: MusicGenerationInput): ProviderJobResult<MusicGenerationOutput> {
    const url = Array.isArray(data.output) ? data.output[data.output.length - 1] : data.output;
    if (data.status === 'succeeded' && url) {
      return {
        externalId: data.id,
        status: 'succeeded',
        output: { mainAudioUrl: url, format: 'mp3', durationS: input?.durationS ?? 0, bpm: input?.bpm, keySignature: input?.keySignature },
        estimatedCostUsd: 0.12,
      };
    }
    if (data.status === 'failed' || data.status === 'canceled') return { externalId: data.id, status: 'failed', error: data.error ?? 'minimax failed' };
    return { externalId: data.id, status: 'running', pollAfterMs: 5_000 };
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

export function musicAdapter(override?: string, apiKey?: string): MusicProviderAdapter {
  switch (override ?? provider()) {
    case 'minimax':
      return new MiniMaxSongAdapter(apiKey);
    case 'ace_step':
      return new AceStepSongAdapter(apiKey);
    case 'suno':
      return new SunoAdapter(apiKey);
    case 'replicate':
      return new ReplicateMusicGenAdapter(apiKey);
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

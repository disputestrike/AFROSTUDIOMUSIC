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

/**
 * Build the style/prompt token list for a music model.
 *
 * Sound-DNA signature tokens (input.dnaTags) are FRONT-LOADED — models weight
 * by position and truncate, so the genre's identity must lead. The generic
 * "radio-ready" fallback literal is only appended when NO DNA is present; when
 * DNA is present that filler is exactly the homogenizing phrase we drop. This is
 * the core fix for "same-y sound".
 */
export function composeStyleTags(
  input: MusicGenerationInput,
  opts: { fallbackLiteral: string; genreLabel?: string; genreSuffix?: string; keyPrefix?: string; tonePrefix?: string }
): string[] {
  const hasDna = !!input.dnaTags?.length;
  // Humanize the genre enum so the model reads "afro dancehall", not "afro_dancehall".
  const genreLabel = opts.genreLabel ?? (input.genre ?? 'afrobeats').replace(/_/g, ' ');
  const isAfro = /afro|amapiano|highlife|street_pop|gospel/.test(input.genre ?? '');
  // ANTI-REGGAETON SCRUB: the Sound DNA describes the Afrobeats groove with
  // musicology terms that OVERLAP with Latin — "clave", "woodblock/clave",
  // "tresillo". Correct on paper, but a text-to-music model with a weak
  // Afrobeats prior reads "clave + syncopated off-beat + mid-tempo" and renders
  // REGGAETON. Strip those Latin-signifier tokens from what reaches the audio
  // engine (the LLM brief keeps the nuance; the engine gets West-African words).
  const deLatin = (t: string): string =>
    isAfro
      ? t.replace(/\bwoodblock\s*\/\s*clave\b/gi, 'shekere')
         .replace(/\b(3-2|2-3)[\s-]*clave\b/gi, 'off-beat West-African')
         .replace(/\bclave\b/gi, 'off-beat')
         .replace(/\btresillo\b/gi, 'off-beat')
      : t;
  // ANTI-SOUP: models weight early tokens and truncate late ones, so this order
  // is a BUDGET, not a bag — identity leads (genre+tempo+key), then the DNA +
  // learned tokens, then a CAPPED vibe (an uncapped vibePrompt used to drown the
  // identity), then tone. Near-duplicate tokens are deduped.
  const vibe = deLatin((input.vibePrompt ?? '').trim().slice(0, 160));
  // For Afro genres, LEAD with an unmistakable West-African anchor + an explicit
  // exclusion, both BEFORE the DNA tokens so truncation can never drop them. The
  // anchor instruments (log drum, talking drum, shekere, highlife guitar) have
  // almost no reggaeton overlap — they are the strongest pull away from Latin.
  const genreLine = isAfro
    ? `West African ${genreLabel} — modern Nigerian/Ghanaian Afrobeats, ${input.bpm} bpm${input.keySignature ? `, ${opts.keyPrefix ?? 'key '}${input.keySignature}` : ''}`
    : `${genreLabel}, ${input.bpm} bpm${input.keySignature ? `, ${opts.keyPrefix ?? 'key '}${input.keySignature}` : ''}`;
  const raw = [
    genreLine,
    isAfro ? 'signature sound: log drum, talking drum, shekere and interlocking highlife guitar; straight-4 with a laid-back off-beat kick and busy 16th shaker' : null,
    isAfro ? 'NOT reggaeton, NOT dembow, NOT tresillo/dembow kick, NOT Latin, NOT Spanish, NOT perreo, NOT four-on-the-floor' : null,
    opts.genreSuffix ?? null,
    ...(input.dnaTags ?? []).map(deLatin),
    vibe || null,
    input.artistTone?.length ? `${opts.tonePrefix ?? ''}${input.artistTone.join(', ')}` : null,
    // Afro production feel — the fills/rolls that make Afro records lift. Only
    // for Afro-family genres; on pop/rock/EDM it just wastes prompt budget.
    isAfro ? 'Afro drum rolls, tom fills and percussion buildups leading into every section — a fill announces each new verse, the bridge and every hook' : null,
    hasDna ? null : opts.fallbackLiteral,
  ].filter(Boolean) as string[];
  // Case-insensitive dedupe on token prefixes — kills "energetic"×3 repeats.
  const seen = new Set<string>();
  const out: string[] = [];
  let budget = 0;
  for (const t of raw) {
    const k = t.toLowerCase().slice(0, 24);
    if (seen.has(k)) continue;
    seen.add(k);
    if (budget + t.length + 2 > 700) break; // identity budget before adapter caps
    out.push(t);
    budget += t.length + 2;
  }
  return out;
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
    // P0 FIX: this used to hardcode instrumental:true and NEVER send the words, so
    // every Suno-routed SUNG take came back with zero vocals ("it doesn't sing").
    // When we have lyrics, tell Suno to SING them: instrumental:false + prompt=the
    // lyrics (sanitized the same way MiniMax needs — section tags + singable ad-libs
    // kept, stage directions stripped so Suno doesn't sing "drum roll").
    const wantsVocals = !!input.lyrics?.trim();
    const body = {
      customMode: true,
      instrumental: !wantsVocals,
      ...(wantsVocals ? { prompt: cleanLyricsForMinimax(input.lyrics!).slice(0, 3000) } : {}),
      model: process.env.SUNO_MODEL ?? 'V5',
      style: this.composeStyle(input).slice(0, 900),
      title: (input.vibePrompt?.slice(0, 60) || `${input.genre ?? 'Afro'} ${wantsVocals ? 'song' : 'beat'}`).slice(0, 80),
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
    // No hardcoded genre — honor the SELECTED genre + its Sound DNA. Lyric-aware
    // fallback: when Suno is SINGING, ask for a strong lead vocal, not "instrumental".
    const wantsVocals = !!input.lyrics?.trim();
    return composeStyleTags(input, {
      fallbackLiteral: wantsVocals
        ? 'catchy, modern, punchy drums, warm bass, melodic, strong emotive lead vocal, radio-ready'
        : 'catchy, modern, punchy drums, warm bass, melodic, instrumental, radio-ready, leave space for a lead vocal',
    }).join(', ');
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
    return composeStyleTags(input, {
      genreLabel: `${input.genre ?? 'afrobeats'} instrumental beat`,
      keyPrefix: 'in ',
      tonePrefix: 'mood: ',
      fallbackLiteral:
        'catchy, modern, radio-ready, punchy drums, warm bass, melodic, no vocals, leave space for a lead vocal',
    }).join(', ');
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
    // No hardcoded genre — honor the SELECTED genre + its Sound DNA.
    const tags = composeStyleTags(input, {
      fallbackLiteral: 'catchy, melodic vocals, punchy drums, warm bass, radio-ready',
    }).join(', ');

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
 * Format a lyric for MiniMax music-2.6, which SINGS the lyrics field literally.
 *
 * Our vocal arranger writes an ACE-Step "performance script": the lyric peppered
 * with inline STAGE DIRECTIONS — "(drum roll — build up)", "(enter late, lean
 * behind the beat)", "(soft, hazy)", "(breath)". ACE-Step reads those as cues;
 * MiniMax would SING them as words ("drum roll", "soft hazy") — the exact kind of
 * garbage that reads as "fake". So for MiniMax we KEEP the [Section] tags and the
 * short, genuinely-singable ad-libs (a tight whitelist of interjections MiniMax
 * renders as backing) and DROP everything else in parentheses. Clean lead lines +
 * structure is MiniMax's sweet spot; it arranges its own natural phrasing. A
 * length cap on whole lines keeps us under the model's lyric limit.
 */
const MINIMAX_SINGABLE =
  /^(?:ooh|oh|eh|ah|mmm|hmm|yeah|ya|hey|heh|woah|whoa|na|la|da|yee+|uh|chai|oya|ehen|omo+|baby|shout|gang|come on|let'?s go|gbedu|jeje|ehn)(?:[\s,!'-]+(?:ooh|oh|eh|ah|mmm|hmm|yeah|ya|hey|woah|whoa|na|la|da|yee+|uh|baby))*!?$/i;
// MiniMax music-2.6 officially accepts 1–3500 lyric chars (Replicate schema);
// 3400 leaves margin. The old 2400 cap was 1100 chars of song left on the table.
// MiniMax's OFFICIAL structure tags (Replicate schema) — anything else in
// brackets is an invented header the engine may SING as words ("drum fill").
const ENGINE_SECTION_TAGS =
  /^(intro|verse|pre[- ]?chorus|chorus|interlude|bridge|outro|post[- ]?chorus|transition|break|hook|build[- ]?up|inst|solo|refrain|drop)(\s*\d+)?$/i;
// Production cues our arranger/writers historically emitted as fake headers.
const PRODUCTION_CUE = /(drum|fill|roll|percussion|riser|instrumental|beat[- ]?switch|ad[- ]?lib)/i;
export function cleanLyricsForMinimax(raw: string, maxChars = 3400): string {
  const cleaned = raw
    .split('\n')
    .map((line) => {
      // RENDER-TIME header law (heals OLD stored drafts on every re-sing):
      // official section tags pass; [Drum Fill]-class cues become [Break] (the
      // intent — a transition — survives); any other invented header is dropped.
      const header = line.trim().match(/^\[([^\]]{1,40})\]$/);
      if (header) {
        const inner = header[1]!.trim();
        if (ENGINE_SECTION_TAGS.test(inner)) return line.trim();
        return PRODUCTION_CUE.test(inner) ? '[Break]' : '';
      }
      return line
        // Keep only whitelisted singable parentheticals; drop stage directions.
        .replace(/\(([^)]*)\)/g, (_m, inner: string) =>
          MINIMAX_SINGABLE.test(inner.trim()) ? `(${inner.trim()})` : ''
        )
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    })
    // Collapse the blank-line runs the drops leave behind.
    .filter((l, i, arr) => !(l.trim() === '' && (arr[i - 1]?.trim() ?? '') === ''))
    .join('\n')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  // Over budget: before touching the tail, drop INTERIOR repeats of identical
  // sections (a hook sung 4× keeps its first and last outing). Plain tail-trim
  // silently deleted OUTROS and final hooks — "it didn't sing all of it".
  const parts = cleaned.split(/(?=^\[[^\]\n]+\]\s*$)/m);
  const normBody = (p: string) =>
    p.replace(/^\[[^\]\n]+\]\s*$/m, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const occurrences = new Map<string, number[]>();
  parts.forEach((p, i) => {
    const k = normBody(p);
    if (k) occurrences.set(k, [...(occurrences.get(k) ?? []), i]);
  });
  const interior = [...occurrences.values()]
    .filter((idx) => idx.length >= 3)
    .flatMap((idx) => idx.slice(1, -1))
    .sort((a, b) => b - a);
  const total = () => parts.reduce((n, p) => n + p.length, 0);
  for (const i of interior) {
    if (total() <= maxChars) break;
    parts[i] = '';
  }
  const dropped = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  if (dropped.length <= maxChars) return dropped;
  // Last resort: trim to whole lines so we never cut a word (or a [Section]).
  let acc = '';
  for (const l of dropped.split('\n')) {
    if ((acc ? acc.length + 1 : 0) + l.length > maxChars) break;
    acc += (acc ? '\n' : '') + l;
  }
  return acc;
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

    const style = composeStyleTags(input, {
      fallbackLiteral: 'catchy, melodic vocals, radio-ready',
    }).join(', ');

    // music-2.6 contract: `prompt` = style/mood description (required),
    // `lyrics` = the words (required for vocals unless lyrics_optimizer),
    // `is_instrumental`/`lyrics_optimizer` default false. Unknown fields 422, so
    // send only valid keys. We sing our lyrics; if none, let the model write them.
    const hasLyrics = !!input.lyrics?.trim();
    const modelInput: Record<string, unknown> = { prompt: style };
    if (hasLyrics) modelInput.lyrics = cleanLyricsForMinimax(input.lyrics!);
    else modelInput.lyrics_optimizer = true;

    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', prefer: 'wait' },
      body: JSON.stringify({ version, input: modelInput }),
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
  // fal was REMOVED ENTIRELY (owner directive 2026-07-11) — every render runs
  // on the exact provider configuration the owner's ear approved. If a cheaper
  // route is ever reconsidered, it re-enters ONLY through a measured bake-off
  // (git history has the deleted adapter).
  switch (override ?? provider()) {
    // Reference-conditioned renders (Adjust): no conditioning engine is
    // configured — renders run UNCONDITIONED on the standard engine (the
    // worker logs this honestly; steering still rides the brief).
    case 'minimax_ref':
      return new MiniMaxSongAdapter(apiKey);
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

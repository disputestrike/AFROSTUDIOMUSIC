/**
 * Provider adapter contracts. Each provider returns a job descriptor —
 * synchronous result OR a polling handle the worker can chase to completion.
 *
 * Status flow: queued -> running -> succeeded | failed.
 */

export interface ProviderJobResult<T = unknown> {
  externalId?: string;
  status: "queued" | "running" | "succeeded" | "failed";
  output?: T;
  error?: string;
  estimatedCostUsd?: number;
  pollAfterMs?: number;
}

export interface MusicGenerationInput {
  genre: string;
  /** Secondary genres to FUSE into the primary (e.g. amapiano × afrobeats). The
   *  primary owns the groove/tempo; each fusion genre injects its signature. */
  fusionGenres?: string[];
  bpm: number;
  keySignature?: string;
  durationS: number;
  vibePrompt?: string;
  withStems: boolean;
  artistTone?: string[];
  languages?: string[];
  // Full song WITH AI vocals: pass the lyrics + set withVocals. Routes to a
  // vocals-capable model (ACE-Step default; 'minimax' selectable) instead of
  // the instrumental beat model.
  lyrics?: string;
  withVocals?: boolean;
  songEngine?: string; // 'suno' | 'eleven' | 'minimax' | 'ace_step'
  /**
   * Best-of-N: render this many candidates in parallel, QC each, keep the best
   * (the take with the most life — dynamics/punch, no clipping). Default from
   * BEST_OF_N env (2). The model-independent quality lever.
   */
  candidates?: number;
  /**
   * Sound-DNA signature tokens for THIS genre, ordered most-distinctive first.
   * Adapters front-load these ahead of genre/bpm and drop the generic
   * "radio-ready" filler when present — so the genre's identity leads the
   * style prompt instead of homogenizing filler. See packages/ai/sound-dna.
   */
  dnaTags?: string[];
  /**
   * A3-2 — REFERENCE-AUDIO ADJUST: when set, the render is CONDITIONED on this
   * audio (the user's existing take goes IN as sound, not just tags) via a
   * reference-matching model. Repairs build from the record's own groove/tempo/
   * key instead of re-rolling from text.
   */
  referenceAudioUrl?: string;
  /**
   * Explicit instrument picks for THIS song (owner directive 2026-07-12:
   * "specify the instrument before pushing to the music engine"). Emitted as a
   * high-priority `instrumentation:` line in the style prompt. Text engines are
   * steered, never guaranteed — the own engine is where instrument choice is
   * exact (it assembles per-role loops).
   */
  instruments?: string[];
}

export interface MusicGenerationOutput {
  /** Provider-hosted audio when the provider returns a URL. */
  mainAudioUrl?: string;
  /** Raw audio for synchronous providers. The worker uploads this privately
   * before measuring or persisting the candidate. */
  audioBytes?: Buffer;
  /** Extra tracks returned by the same paid provider request. The worker ranks
   * every one instead of discarding already-generated alternatives. */
  alternates?: MusicGenerationOutput[];
  stems?: Array<{ role: string; url: string }>;
  format: "wav" | "mp3" | "flac";
  durationS: number;
  bpm?: number;
  keySignature?: string;
}

export interface MusicProviderAdapter {
  readonly name: string;
  generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>>;
  poll?(externalId: string): Promise<ProviderJobResult<MusicGenerationOutput>>;
}

export interface VoiceProfileSetupInput {
  voiceProfileId: string;
  name: string;
  sampleUrls: string[];
  language?: string;
  consentRecordingUrl?: string;
}

export interface VoiceProfileSetupOutput {
  providerVoiceId: string;
}

export interface VoiceRenderInput {
  providerVoiceId: string;
  lyricBody: string;
  language?: string;
  bpm?: number;
  pitchCorrection?: { strength: number; retune: number };
  effects?: Record<string, unknown>;
  role: "lead" | "double" | "ad-lib" | "harmony";
  /**
   * Melody spec from the Melody Lab. TTS providers ignore it; a
   * singing-voice-conversion provider consumes it to produce sung vocals.
   */
  melody?: Record<string, unknown>;
}

export interface VoiceRenderOutput {
  audioUrl: string;
  /** Raw rendered audio, when the adapter has bytes but no hosted URL. The worker
   *  uploads these to storage and replaces audioUrl. The adapter runs in-process
   *  so a Buffer crosses fine. (Was a broken "inline:bytes:N" sentinel with no
   *  bytes attached — the stored URL never played.) */
  audioBytes?: Buffer;
  durationS: number;
  format: "wav" | "mp3";
}

export interface VoiceProviderAdapter {
  readonly name: string;
  createProfile(
    input: VoiceProfileSetupInput
  ): Promise<ProviderJobResult<VoiceProfileSetupOutput>>;
  render(
    input: VoiceRenderInput
  ): Promise<ProviderJobResult<VoiceRenderOutput>>;
  poll?(externalId: string): Promise<ProviderJobResult<VoiceRenderOutput>>;
}

export interface VideoShotInput {
  prompt: string;
  durationS: number;
  motion?: string;
  lighting?: string;
  aspectRatio: "9:16" | "1:1" | "16:9";
  negativePrompt?: string;
}

export interface VideoRenderOutput {
  videoUrl?: string;
  videoBytes?: Uint8Array;
  durationS: number;
  format: "mp4";
}

export interface VideoProviderAdapter {
  readonly name: string;
  renderShot(
    input: VideoShotInput
  ): Promise<ProviderJobResult<VideoRenderOutput>>;
  poll?(
    externalId: string,
    input?: VideoShotInput
  ): Promise<ProviderJobResult<VideoRenderOutput>>;
}

export interface ImageInput {
  prompt: string;
  size: "1024x1024" | "1024x1792" | "1792x1024";
  quality: "low" | "medium" | "high";
}

export interface ImageOutput {
  /** Present when the provider returns a fetchable URL (dall-e-*, stub). */
  imageUrl?: string;
  /** Present when the provider returns raw base64 (gpt-image-1). */
  imageBase64?: string;
  width: number;
  height: number;
}

export interface ImageProviderAdapter {
  readonly name: string;
  generate(input: ImageInput): Promise<ProviderJobResult<ImageOutput>>;
}

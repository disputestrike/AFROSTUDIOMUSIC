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
  /** ENGINE-REPORTED percent complete (parsed from provider logs), 0–100.
   *  Only ever set from a real engine signal — the UI meter law forbids a
   *  fabricated number, so absent means "show honest indeterminate motion". */
  progressPct?: number;
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
  /**
   * ARTIST/PRODUCTION LANE reference (owner directive 2026-07-21: "feel like
   * Dre → feel like Dre"). FIRST-CLASS so composeStyleTags can FRONT-LOAD it as
   * its own token (production feel: tempo / groove / instrument palette /
   * energy) that survives the char cap, instead of burying it at the tail of a
   * 160-char vibe where it was routinely truncated away. STYLE steering only —
   * never a voice clone, never a named artifact. The Eleven policy scrub strips
   * it before it reaches ElevenLabs (artist-imitation policy).
   */
  influence?: string;
  /**
   * MOOD / EMOTIONAL TONE ("luxury", "melancholic", "triumphant"). ENGINE-
   * AGNOSTIC: composeStyleTags front-loads it as its own `mood:` token so the
   * SELECTED engine (MiniMax default, or Suno / ACE-Step / Eleven) carries the
   * mood in the STYLE PROMPT — parity with the own engine, which already threads
   * mood through its melody prompt. Before this the request mood reached a
   * provider only indirectly (coloured into the Sound-DNA brief); now it is a
   * first-class style lever on every engine. Shares one home with influence
   * (packages/shared reference-steering: moodStyleToken / moodMelodyPhrase).
   */
  mood?: string;
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
  /**
   * MELODY TONE-CONTOUR DIRECTIVE (African-singing wave): a compact, RELATIVE
   * rise/level/fall directive derived from the composed MelodyScore
   * (melodyContourDirective) — ACE-Step can't take a note list, so this threads
   * the topline's SHAPE + register hints into the style/tags prompt for vocal
   * renders. The worker sets it when a score is in scope; adapters append it to
   * the style prompt only (never the lyric field). Absent on instrumental renders.
   */
  melodyContour?: string;
  /**
   * VERBATIM FORGE MODE (SOUNDWAVE1 fix 1): when 'verbatim', adapters send the
   * caller's vibePrompt IN FULL as the prompt body, prefixed only by a minimal
   * identity line (genre, bpm, key when present). No genre anchor/signature
   * block, no engineTags, no dnaTags, no fallbackLiteral, no 160-char slice —
   * the isolated-loop forge writes its own prompt and the engine must receive
   * it intact (the full-band pipeline was drowning "solo shaker only" prompts
   * and every forge rendered a full mix). Full-song renders leave this unset.
   */
  promptMode?: 'verbatim';
}

export type StemAudioFormat = "wav" | "mp3" | "flac";
export type StemAudioContentType = "audio/wav" | "audio/mpeg" | "audio/flac";

/** A provider stem with enough media metadata to persist it honestly. The worker
 * still sniffs the downloaded bytes before storage because provider URLs and
 * response labels are not authoritative. */
export interface StemAudioOutput {
  role: string;
  url: string;
  format: StemAudioFormat;
  contentType: StemAudioContentType;
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
  stems?: StemAudioOutput[];
  format: StemAudioFormat;
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
  /**
   * KEYFRAME (image-to-video): a fetchable URL for the shot's first frame —
   * e.g. a likeness keyframe generated from the artist's own trained model.
   * Adapters whose model cannot condition on an image MUST fail closed when
   * this is set (capabilities.imageToVideo === false), never silently drop it.
   */
  keyframeUrl?: string;
}

export interface VideoRenderOutput {
  videoUrl?: string;
  videoBytes?: Uint8Array;
  durationS: number;
  format: "mp4";
}

/** Honest per-adapter capability flags — what the backing model actually does. */
export interface VideoEngineCapabilities {
  textToVideo: boolean;
  imageToVideo: boolean;
}

export interface VideoProviderAdapter {
  readonly name: string;
  /** Absent = legacy adapter (veo/sora/stub): text-to-video only. */
  readonly capabilities?: VideoEngineCapabilities;
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

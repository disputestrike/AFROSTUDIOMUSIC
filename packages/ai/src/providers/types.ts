/**
 * Provider adapter contracts. Each provider returns a job descriptor —
 * synchronous result OR a polling handle the worker can chase to completion.
 *
 * Status flow: queued -> running -> succeeded | failed.
 */

export interface ProviderJobResult<T = unknown> {
  externalId?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  output?: T;
  error?: string;
  estimatedCostUsd?: number;
  pollAfterMs?: number;
}

export interface MusicGenerationInput {
  genre: string;
  bpm: number;
  keySignature?: string;
  durationS: number;
  vibePrompt?: string;
  withStems: boolean;
  artistTone?: string[];
  languages?: string[];
  // Full song WITH AI vocals: pass the lyrics + set withVocals. Routes to a
  // vocals-capable model (ACE-Step) instead of the instrumental beat model.
  lyrics?: string;
  withVocals?: boolean;
}

export interface MusicGenerationOutput {
  mainAudioUrl: string;
  stems?: Array<{ role: string; url: string }>;
  format: 'wav' | 'mp3' | 'flac';
  durationS: number;
  bpm?: number;
  keySignature?: string;
}

export interface MusicProviderAdapter {
  readonly name: string;
  generate(input: MusicGenerationInput): Promise<ProviderJobResult<MusicGenerationOutput>>;
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
  role: 'lead' | 'double' | 'ad-lib' | 'harmony';
  /**
   * Melody spec from the Melody Lab. TTS providers ignore it; a
   * singing-voice-conversion provider consumes it to produce sung vocals.
   */
  melody?: Record<string, unknown>;
}

export interface VoiceRenderOutput {
  audioUrl: string;
  durationS: number;
  format: 'wav' | 'mp3';
}

export interface VoiceProviderAdapter {
  readonly name: string;
  createProfile(input: VoiceProfileSetupInput): Promise<ProviderJobResult<VoiceProfileSetupOutput>>;
  render(input: VoiceRenderInput): Promise<ProviderJobResult<VoiceRenderOutput>>;
  poll?(externalId: string): Promise<ProviderJobResult<VoiceRenderOutput>>;
}

export interface VideoShotInput {
  prompt: string;
  durationS: number;
  motion?: string;
  lighting?: string;
  aspectRatio: '9:16' | '1:1' | '16:9';
  negativePrompt?: string;
}

export interface VideoRenderOutput {
  videoUrl: string;
  durationS: number;
  format: 'mp4';
}

export interface VideoProviderAdapter {
  readonly name: string;
  renderShot(input: VideoShotInput): Promise<ProviderJobResult<VideoRenderOutput>>;
  poll?(externalId: string): Promise<ProviderJobResult<VideoRenderOutput>>;
}

export interface ImageInput {
  prompt: string;
  size: '1024x1024' | '1024x1792' | '1792x1024';
  quality: 'low' | 'medium' | 'high';
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

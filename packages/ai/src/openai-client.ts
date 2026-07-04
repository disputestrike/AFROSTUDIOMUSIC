import OpenAI from 'openai';

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required. Set it in your .env');
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

export const MODELS = {
  text: process.env.OPENAI_TEXT_MODEL ?? 'gpt-5.5',
  draft: process.env.OPENAI_DRAFT_MODEL ?? 'gpt-5.4-mini',
  transcribe: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe',
  tts: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
  image: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2',
  embedding: 'text-embedding-3-small',
} as const;

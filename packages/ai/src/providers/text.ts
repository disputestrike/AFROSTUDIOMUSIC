/**
 * Text provider — wraps OpenAI Responses API with JSON-mode helpers.
 * Used for hooks, lyrics, taste scoring, brief polishing, rights checks,
 * storyboards, and the studio-chat orchestrator.
 *
 * STUB_AI=1 switches everything to deterministic canned data. This is the
 * escape hatch used by the integration test suite — exercises the whole
 * pipeline without burning OpenAI credits or needing a real key.
 */
import { getOpenAI, MODELS } from '../openai-client';

// Read at call time, not module-load time — STUB_AI may be set by the caller
// before invoking but after importing.
function isStub(): boolean {
  return process.env.STUB_AI === '1';
}

interface ResponsesJsonOptions {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * GPT-5.x / o-series are REASONING models with two hard behavioral differences
 * (confirmed on OpenAI docs, 2026-07): they 400-reject `temperature`, and their
 * invisible reasoning tokens bill as OUTPUT and count against
 * max_completion_tokens — a tight cap can starve the visible answer to empty
 * (same trap Fable's thinking tokens taught us). So: drop temperature, send
 * reasoning_effort (GPT-5.6 accepts none/low/medium/high/xhigh/max, defaults
 * medium), and add cap headroom for the thinking.
 */
function isReasoningModel(model: string): boolean {
  return /^(gpt-[5-9]|o\d)/i.test(model);
}

function reasoningParams(maxOutputTokens: number): Record<string, unknown> {
  return {
    reasoning_effort: process.env.OPENAI_REASONING_EFFORT ?? 'medium',
    max_completion_tokens: maxOutputTokens + Number(process.env.OPENAI_REASONING_HEADROOM ?? 12_000),
  };
}

// $/M-token rates for the cost estimate (economics card). Estimates only —
// billing truth lives in the OpenAI console. Order matters: longest prefix first.
const OPENAI_RATES: Array<[RegExp, { inPerM: number; outPerM: number }]> = [
  [/^gpt-5\.6-terra/i, { inPerM: 2.5, outPerM: 15 }],
  [/^gpt-5\.6-luna/i, { inPerM: 1, outPerM: 6 }],
  [/^gpt-5\.6/i, { inPerM: 5, outPerM: 30 }], // sol + bare "gpt-5.6" alias
  [/^gpt-4o-mini/i, { inPerM: 0.15, outPerM: 0.6 }],
  [/^gpt-4o/i, { inPerM: 2.5, outPerM: 10 }],
];

/** Real token usage of the last OpenAI call — mirrors lastCerebrasUsage. */
export let lastOpenAiUsage: { inTok: number; outTok: number; estCostUsd: number } | null = null;

function trackOpenAiUsage(model: string, usage?: { prompt_tokens?: number; completion_tokens?: number } | null): void {
  const inTok = usage?.prompt_tokens ?? 0;
  const outTok = usage?.completion_tokens ?? 0; // includes reasoning tokens on GPT-5.x
  const rate = OPENAI_RATES.find(([re]) => re.test(model))?.[1] ?? { inPerM: 5, outPerM: 30 };
  lastOpenAiUsage = { inTok, outTok, estCostUsd: (inTok * rate.inPerM + outTok * rate.outPerM) / 1_000_000 };
}

/**
 * Call the Chat Completions API with JSON mode. The SDK is forward-compatible
 * with Responses for our usage, and JSON mode is widely supported.
 */
export async function responsesJson<T>(opts: ResponsesJsonOptions): Promise<T> {
  if (isStub()) return stubResponse<T>(opts);
  const client = getOpenAI();
  const model = opts.model ?? MODELS.draft;
  const res = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    ...(isReasoningModel(model)
      ? reasoningParams(opts.maxOutputTokens ?? 2_000)
      : {
          temperature: opts.temperature ?? 0.8,
          // Newer OpenAI models require max_completion_tokens (max_tokens is rejected).
          max_completion_tokens: opts.maxOutputTokens ?? 2_000,
        }),
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  } as never);
  trackOpenAiUsage(model, res.usage);
  const content = res.choices[0]?.message?.content ?? '{}';
  return JSON.parse(content) as T;
}

/** Health check for the OpenAI fallback brain — mirrors anthropicPing. */
export async function openaiPing(): Promise<{ ok: boolean; model: string; error?: string }> {
  const model = MODELS.draft;
  if (!process.env.OPENAI_API_KEY) return { ok: false, model, error: 'no OPENAI_API_KEY' };
  try {
    await responsesJson<{ ok: boolean }>({ system: 'Reply with JSON {"ok":true} only.', user: 'ping', maxOutputTokens: 20, temperature: 0 });
    return { ok: true, model };
  } catch (e) {
    return { ok: false, model, error: (e as Error).message.slice(0, 300) };
  }
}

/**
 * Tool-calling helper used by the studio-chat orchestrator.
 * Returns either a content message or a list of tool calls to execute.
 */
export type ChatToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export interface ChatTurn {
  text?: string;
  toolCalls?: ChatToolCall[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export async function chatWithTools(opts: {
  messages: ChatMessage[];
  tools: ReadonlyArray<{
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  model?: string;
  temperature?: number;
}): Promise<ChatTurn> {
  if (isStub()) return stubChat(opts.messages);
  const client = getOpenAI();
  const model = opts.model ?? MODELS.text;
  const res = await client.chat.completions.create({
    ...(isReasoningModel(model)
      ? { reasoning_effort: process.env.OPENAI_REASONING_EFFORT ?? 'medium' }
      : { temperature: opts.temperature ?? 0.5 }),
    model,
    tools: opts.tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    messages: opts.messages,
  } as never);
  const choice = res.choices[0]!.message;
  if (choice.tool_calls && choice.tool_calls.length > 0) {
    return {
      text: choice.content ?? undefined,
      toolCalls: choice.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      })),
    };
  }
  return { text: choice.content ?? '' };
}

// ===========================================================================
// STUB_AI canned responses — keyed off a marker in the system prompt.
// Every shape here matches what the real model would emit for the same prompt,
// per the JSON contract documented in packages/ai/src/prompts/*.ts.
// ===========================================================================

function stubResponse<T>(opts: ResponsesJsonOptions): Promise<T> {
  const s = opts.system;
  if (s.includes('Afro-fusion hook writer')) return Promise.resolve(stubHooks(opts.user) as unknown as T);
  if (s.includes('Afrobeats/Afro-fusion lyricist')) return Promise.resolve(stubLyrics() as unknown as T);
  if (s.includes('A&R (taste engine)')) return Promise.resolve(stubTaste(opts.user) as unknown as T);
  if (s.includes('producer interpreting a rough song idea')) return Promise.resolve(stubBrief() as unknown as T);
  if (s.includes('music rights reviewer')) return Promise.resolve(stubRights() as unknown as T);
  if (s.includes('music-video director')) return Promise.resolve(stubStoryboard() as unknown as T);
  if (s.includes('melody architect')) return Promise.resolve(stubMelody() as unknown as T);
  // Generic fallback so unknown prompts don't blow up tests.
  return Promise.resolve({} as T);
}

function stubHooks(userJson: string): { hooks: Array<Record<string, unknown>> } {
  let count = 5;
  try {
    const u = JSON.parse(userJson) as { task?: string };
    const m = /generate (\d+) hooks/.exec(u.task ?? '');
    if (m) count = Math.min(50, Math.max(1, Number(m[1])));
  } catch {}
  const hooks = Array.from({ length: count }, (_, i) => ({
    text: `Omo see as you sweet for my eye (line ${i + 1})\nShey you go let me love you tonight?`,
    language: ['pcm', 'yo'],
    bpm: 103,
    syllablePattern: '8-7',
    melodyNotes: 'descending 5-note motif',
    callResponse: i % 2 === 0,
  }));
  return { hooks };
}

function stubLyrics() {
  return {
    title: 'Sweet Like Pawpaw',
    body: '[Hook]\nOmo see as you sweet for my eye\nShey you go let me love you tonight?\n\n[Verse 1]\nFrom Surulere to Lekki I dey find you\nNo one body match you, na you be the only one\n\n[Hook]\nOmo see as you sweet for my eye\nShey you go let me love you tonight?\n\n[Verse 2]\nWhen you smile my heart they pound like talking drum\nMake we dance till the morning sun\n\n[Bridge]\nForever and always, na you be my queen\n\n[Outro]\nOmo, omo, eh',
    structure: {
      sections: [
        { name: 'hook', lines: ['Omo see as you sweet for my eye', 'Shey you go let me love you tonight?'] },
        { name: 'verse', lines: ['From Surulere to Lekki I dey find you', 'No one body match you'] },
        { name: 'hook', lines: ['Omo see as you sweet for my eye', 'Shey you go let me love you tonight?'] },
        { name: 'verse', lines: ['When you smile my heart they pound like talking drum'] },
        { name: 'bridge', lines: ['Forever and always, na you be my queen'] },
        { name: 'outro', lines: ['Omo, omo, eh'] },
      ],
    },
    cleanVersion: 'Same lyric without explicit content (stub).',
    explicit: false,
    languageMix: { pcm: 0.7, yo: 0.2, en: 0.1 },
    needsNativeReview: [],
  };
}

function stubTaste(userJson: string): { scores: Array<Record<string, unknown>> } {
  let items: Array<{ id: string; text: string; kind: string }> = [];
  try {
    const u = JSON.parse(userJson) as { items?: Array<{ id: string; text: string; kind: string }> };
    items = u.items ?? [];
  } catch {}
  const scores = items.map((it, i) => ({
    id: it.id,
    dimensions: {
      hookMemorability: 7.5 + (i % 3) * 0.4,
      firstEightSeconds: 7.2,
      chorusSimplicity: 8.1,
      languageAuthenticity: 7.9,
      danceability: 8.3,
      replayValue: 7.6,
      uniqueness: 7.0 + (i % 5) * 0.3,
      emotionalClarity: 7.8,
      tikTokLoopQuality: 7.5,
      platformFit: 7.7,
    },
    overall: 7.5 + (i % 7) * 0.2,
    similarityRisk: 0.1,
    tooAiRisk: 0.15,
    notes: 'Stub score — strong pocket, clean lane.',
  }));
  return { scores };
}

function stubBrief() {
  return {
    mood: 'romantic, danceable',
    topic: 'Falling for a Lagos girl who carries the room',
    language: ['pcm', 'yo'],
    audience: 'club + romantic',
    bpm: 103,
    references: [{ name: 'Wizkid', lane: 'smooth/pocket' }],
    notes: 'Hook lands before second 8. Simple, repeatable.',
  };
}

function stubRights() {
  return {
    findings: [],
    overallRisk: 'low' as const,
    okToExport: true,
  };
}

function stubStoryboard() {
  return {
    title: 'Lagos Golden Hour',
    shots: [
      { index: 0, prompt: 'Young man walking through Surulere street, golden hour', duration_s: 3, motion: 'slow push-in', lighting: 'golden hour', subjects: ['young Nigerian man, smile'], negativePrompt: 'no logos, no other artists' },
      { index: 1, prompt: 'Woman in colorful agbada dancing in living room', duration_s: 4, motion: 'orbit', lighting: 'warm interior', subjects: ['Nigerian woman dancing'], negativePrompt: 'no logos' },
      { index: 2, prompt: 'Close-up of hands clapping in rhythm', duration_s: 3, motion: 'static', lighting: 'natural', subjects: ['hands'], negativePrompt: 'no text' },
      { index: 3, prompt: 'Wide rooftop dance shot, Lagos skyline behind', duration_s: 5, motion: 'whip-pan', lighting: 'sunset', subjects: ['group dancing'], negativePrompt: 'no logos' },
    ],
  };
}

function stubMelody() {
  return {
    key: 'A minor',
    bpm: 103,
    range: { low: 'A3', high: 'E5' },
    sections: [
      {
        name: 'hook',
        phrases: [
          {
            lyricLine: 'Omo see as you sweet for my eye',
            startBeat: 0.5,
            notes: [
              { syllable: 'O-', pitch: 'C4', startBeat: 0.5, durationBeats: 0.5 },
              { syllable: 'mo', pitch: 'E4', startBeat: 1.0, durationBeats: 1.0 },
              { syllable: 'see', pitch: 'D4', startBeat: 2.0, durationBeats: 0.5 },
            ],
          },
        ],
      },
    ],
    styleNotes: 'laid-back pocket, adlib space after hook lines (stub)',
  };
}

function stubChat(messages: ChatMessage[]): ChatTurn {
  // For Studio Chat tests we just echo back a friendly summary.
  const last = messages[messages.length - 1];
  const userText = last?.content ?? '';
  return {
    text: `[STUB_AI] I heard: "${userText.slice(0, 80)}…". In stub mode I won't issue tool calls — set STUB_AI=0 with a real OPENAI_API_KEY for live orchestration.`,
  };
}

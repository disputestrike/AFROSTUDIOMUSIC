/**
 * CHAT USER MESSAGES — §1.11 THE WALL, applied to the studio-chat surface.
 *
 * Every string the chat can show a user passes through here:
 *   - raw tool/stream errors become ONE plain human sentence (plus an optional
 *     scrubbed `details` string for a collapsed support expander),
 *   - assistant prose gets vendor/model names replaced with engine-class
 *     language, and env-var names collapsed to "a studio credential".
 *
 * Pure functions, no I/O — unit-tested by apps/api/scripts/test-chat-error-humanizer.ts.
 */
import { redactSensitiveText } from './redact';

export interface HumanChatError {
  /** One plain sentence, safe to render verbatim to the artist. */
  text: string;
  /** Whether a one-tap retry affordance makes sense for this failure. */
  canRetry: boolean;
  /** Scrubbed + redacted raw error for a collapsed "details" expander. */
  details?: string;
}

// Order matters: env-var names first (so ANTHROPIC_API_KEY never survives as
// "the studio brain_API_KEY"), then vendors, then model families.
const VENDOR_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:API_KEY|API_TOKEN|APIKEY|SECRET|TOKEN|KEY)\b/g, 'a studio credential'],
  [/\bsuno(?:api)?\b/gi, 'the flagship engine'],
  [/\b(?:minimax(?:[_-]ref)?|ace[_-]?step|musicgen|replicate|udio)\b/gi, 'the standard engine'],
  [/\beleven[ _-]?labs\b/gi, 'the standard engine'],
  [/\bdall[- ]?e(?:-\d+)?\b/gi, 'the art engine'],
  [/\b(?:anthropic(?:-chat)?|claude|openai|gpt-[\w.-]+|cerebras)\b/gi, 'the studio brain'],
  [/\baudd\b/gi, 'the rights scanner'],
  [/\btavily\b/gi, 'the research service'],
];

/** Replace vendor/model/env-var names with engine-class language (THE WALL). */
export function scrubVendorNames(text: string): string {
  let out = String(text ?? '');
  for (const [pattern, replacement] of VENDOR_REPLACEMENTS) out = out.replace(pattern, replacement);
  // Collapse doubled class phrases a multi-vendor error can produce.
  return out.replace(/\b(the (?:flagship|standard) engine|the studio brain)(\s+\1)+/gi, '$1');
}

/** Exact-code table. Keys are the FIRST token of the machine error string. */
const CODE_MAP: Record<string, { text: string; canRetry: boolean }> = {
  insufficient_credits: { text: "You're out of credits for that step — top up in Billing to keep going.", canRetry: false },
  rate_limited: { text: 'The studio is busy right now — give it a moment and try again.', canRetry: true },
  operation_in_progress: { text: "I'm still working on your last request — give it a few seconds.", canRetry: false },
  idempotency_key_conflict: { text: "I'm still working on your last request — give it a few seconds.", canRetry: false },
  operation_failed: { text: "That one didn't go through — try again.", canRetry: true },
  operation_canceled: { text: 'That request was canceled — send it again if you still want it.', canRetry: true },
  trends_unavailable: { text: "I couldn't reach the charts right now — try again in a bit.", canRetry: true },
  no_lyrics: { text: 'Write the lyrics first, then I can make the full song.', canRetry: false },
  no_hookids: { text: "I couldn't find those hooks — generate a fresh set and pick again.", canRetry: false },
  no_hooks: { text: "I couldn't find those hooks — generate a fresh set and pick again.", canRetry: false },
  hook_not_found: { text: "I couldn't find that hook — pick one from the list again.", canRetry: false },
  hooks_generation_empty: { text: 'The writing take came back empty — try again.', canRetry: true },
  hook_scoring_empty: { text: 'The scoring take came back empty — try again.', canRetry: true },
  lyric_qa_blocked: { text: "That lyric didn't pass quality review — ask me to rewrite it.", canRetry: true },
  lyrics_too_short: { text: "Paste the full lyric (at least a verse and a hook) so there's real craft to study.", canRetry: false },
  no_project_in_thread: { text: "Tell me what you want to make and I'll set the session up.", canRetry: false },
  not_release_ready: { text: "That song isn't release-ready yet — finish the release checklist first.", canRetry: false },
  master_source_not_certified: { text: 'Approve the current audio first, then I can master it.', canRetry: false },
  master_source_lineage_unresolved: { text: 'Approve the current audio first, then I can master it.', canRetry: false },
  no_song: { text: "I couldn't find a track for that — make or pick a song first.", canRetry: false },
  no_song_to_clip: { text: "I couldn't find a track for that — make or pick a song first.", canRetry: false },
  no_audio_to_separate: { text: "That song has no rendered audio yet — render it first, then I can split it.", canRetry: false },
  song_not_found: { text: "I couldn't find that song — open it from your catalog and try again.", canRetry: false },
  invalid_video_shot_selection: { text: "That shot doesn't exist in the storyboard — pick one that's listed.", canRetry: false },
  invalid_storyboard_output: { text: 'The storyboard take came back broken — try again.', canRetry: true },
  material_bed_incomplete: { text: 'The material shelf is missing pieces for that genre — ask me to forge them first.', canRetry: true },
  unsupported_exact_instruments: { text: "Our own engine can't guarantee those exact instruments — drop them or use a standard engine.", canRetry: false },
  'a&r_unavailable': { text: "The hit scout isn't connected right now — an owner can enable it in Settings.", canRetry: false },
  nothing_to_set: { text: 'There was nothing to save there — give me the splits you want.', canRetry: false },
  not_found: { text: "I couldn't find that anymore — it may have been deleted.", canRetry: false },
  unauthorized: { text: 'Your session expired — sign in again.', canRetry: false },
  forbidden: { text: "You don't have access to that.", canRetry: false },
  internal_error: { text: 'The studio hit a server hiccup — try again in a moment.', canRetry: true },
  service_unavailable: { text: 'The studio is restarting — try again in a minute.', canRetry: true },
};

type RawErrorInput =
  | string
  | Error
  | { error?: unknown; message?: unknown; hint?: unknown; note?: unknown; retryInS?: unknown }
  | null
  | undefined;

/**
 * Map ANY raw chat failure (tool error object, thrown Error, SSE error payload,
 * HTTP error text) to one human sentence + retryability. Never returns
 * internals in `text`; `details` is scrubbed + redacted for a support expander.
 */
export function humanizeChatError(raw: RawErrorInput): HumanChatError {
  const obj = raw !== null && typeof raw === 'object' && !(raw instanceof Error) ? (raw as Record<string, unknown>) : {};
  const errorField = typeof obj.error === 'string' ? obj.error : '';
  const messageField = [obj.message, obj.hint, obj.note].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  const rawText =
    typeof raw === 'string'
      ? raw
      : raw instanceof Error
        ? raw.message
        : [errorField, messageField].filter(Boolean).join(' — ');

  const finish = (text: string, canRetry: boolean): HumanChatError => {
    const details = rawText ? redactSensitiveText(scrubVendorNames(rawText), 240) : undefined;
    return { text, canRetry, ...(details && details !== text ? { details } : {}) };
  };

  // Exact machine code (first token of the error string, e.g. "lyric_qa_blocked (…)").
  const code = (errorField || rawText).trim().split(/[\s(:—,]/, 1)[0]?.toLowerCase() ?? '';
  if (code.startsWith('unknown_tool')) return finish("That action isn't available right now.", false);
  const known = CODE_MAP[code];
  if (known) {
    if (code === 'rate_limited' && typeof obj.retryInS === 'number' && obj.retryInS > 0) {
      return finish(`The studio is busy right now — try again in about ${Math.ceil(obj.retryInS)}s.`, true);
    }
    return finish(known.text, known.canRetry);
  }

  // Pattern classes for anything thrown rather than returned.
  const haystack = rawText.toLowerCase();
  if (/timed?\s?out|timeout|abort/i.test(haystack)) return finish('That took too long, so I stopped it — try again.', true);
  if (/rate.?limit|\b429\b|too many requests/i.test(haystack)) return finish(CODE_MAP.rate_limited!.text, true);
  if (/unreachable|failed to fetch|fetch failed|network|econn|enotfound|socket/i.test(haystack)) {
    return finish('The studio could not be reached — check your connection and try again.', true);
  }
  if (/\b(5\d\d)\b|internal server error|service unavailable/i.test(haystack)) {
    return finish('The studio hit a server hiccup — try again in a moment.', true);
  }
  if (/anthropic|openai|claude|gpt-|cerebras/i.test(rawText)) {
    return finish('The studio brain had a hiccup on that one — try again.', true);
  }
  // A tool that shipped its own human message (already class-language by law):
  // scrub it as a backstop and show it as-is.
  if (messageField) return finish(scrubVendorNames(messageField), false);
  if (!rawText) return { text: 'Something went wrong with that step — try again.', canRetry: true };
  return finish('Something went wrong with that step — try again.', true);
}

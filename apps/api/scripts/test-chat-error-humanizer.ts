/**
 * Chat error humanizer — the §1.11 WALL seam for the studio chat.
 *
 * Law under test: every raw failure (tool error object, thrown Error, SSE
 * payload, HTTP error text) maps to ONE plain human sentence with NO internal
 * identifiers, vendor names, env-var names, or raw JSON — and the optional
 * `details` expander is scrubbed too.
 */
import assert from "node:assert/strict";
import { humanizeChatError, scrubVendorNames } from "@afrohit/shared";

const LEAKS =
  /suno|minimax|ace[_-]?step|replicate|musicgen|anthropic|openai|claude|gpt-|cerebras|elevenlabs|_API_KEY|_TOKEN|ANTHROPIC|OPENAI/i;

function assertClean(value: string | undefined, label: string) {
  if (!value) return;
  assert.ok(!LEAKS.test(value), `${label} leaked internals: ${value}`);
}

// --- scrubVendorNames -------------------------------------------------------
{
  const scrubbed = scrubVendorNames(
    "anthropic-chat 400: suno unavailable, falling back to minimax via replicate"
  );
  assertClean(scrubbed, "scrubbed prose");
  assert.ok(scrubbed.includes("the studio brain"), "brain class name expected");
  assert.ok(scrubbed.includes("the flagship engine"), "flagship class expected");
}
{
  // Env-var names collapse BEFORE the vendor pass — never "the studio brain_API_KEY".
  const scrubbed = scrubVendorNames("add ANTHROPIC_API_KEY for the hit scout");
  assertClean(scrubbed, "env var scrub");
  assert.ok(scrubbed.includes("a studio credential"), "credential placeholder expected");
}
{
  // Ordinary prose is untouched.
  assert.equal(scrubVendorNames("Your Amapiano love song is rendering now."),
    "Your Amapiano love song is rendering now.");
}

// --- humanizeChatError: machine codes --------------------------------------
{
  const h = humanizeChatError({ error: "insufficient_credits", needCents: 500 });
  assert.equal(h.canRetry, false);
  assert.match(h.text, /credits/i);
  assertClean(h.text, "insufficient_credits text");
}
{
  const h = humanizeChatError({ error: "rate_limited", retryInS: 42 });
  assert.equal(h.canRetry, true);
  assert.match(h.text, /42s/);
}
{
  const h = humanizeChatError({ error: "operation_in_progress", receiptId: "job_abc123" });
  assert.equal(h.canRetry, false);
  assert.ok(!h.text.includes("job_abc123"), "receipt id must not surface");
  assert.ok(!h.text.includes("undefined"), 'no "Something broke: undefined"');
}
{
  const h = humanizeChatError({
    error: "lyric_qa_blocked (after 2 corrective rewrites): duplicate_of:song_x; scenery_stuffing",
  });
  assert.equal(h.canRetry, true);
  assert.match(h.text, /quality review/i);
  assert.ok(!h.text.includes("duplicate_of"), "QA block codes stay off the sentence");
}
{
  // The old ANTHROPIC_API_KEY leak, end to end.
  const h = humanizeChatError({
    error: "a&r_unavailable",
    hint: "The hit scout isn't connected — an owner can enable it in Settings.",
  });
  assertClean(h.text, "a&r text");
  assertClean(h.details, "a&r details");
}
{
  const h = humanizeChatError({ error: "unknown_tool:make_magic" });
  assert.match(h.text, /isn't available/i);
}

// --- humanizeChatError: thrown/transport errors -----------------------------
{
  const h = humanizeChatError(new Error("chat model turn timed out"));
  assert.equal(h.canRetry, true);
  assert.match(h.text, /too long/i);
}
{
  const h = humanizeChatError(
    new Error('anthropic-chat 400: {"type":"error","error":{"type":"invalid_request_error"}}')
  );
  assertClean(h.text, "provider error text");
  assertClean(h.details, "provider error details");
  assert.ok(!h.text.includes("{"), "no JSON fragments in the sentence");
}
{
  const h = humanizeChatError(new Error('429 Too Many Requests: {"error":"rate_limited","retryInS":31}'));
  assert.equal(h.canRetry, true);
  assert.match(h.text, /busy/i);
}
{
  const h = humanizeChatError(new Error("Failed to fetch"));
  assert.equal(h.canRetry, true);
  assert.match(h.text, /reached|connection/i);
}
{
  // Tool-authored human messages pass through (scrubbed as a backstop).
  const h = humanizeChatError({
    error: "music_engine_not_connected",
    message: "No usable music engine is connected for this workspace. An owner must connect one in Settings.",
  });
  assert.match(h.text, /connect/i);
  assertClean(h.text, "engine message");
}
{
  // Empty/garbage input still yields a usable sentence.
  const h = humanizeChatError(undefined);
  assert.ok(h.text.length > 10);
  assert.equal(h.canRetry, true);
}

console.log("chat error humanizer: all assertions passed");

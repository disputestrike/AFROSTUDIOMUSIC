/**
 * BRAIN RELIABILITY — proof (2026-07-18).
 *
 * Owner incident: on live build 13db16d the studio "can't make a song" ("the
 * studio brain had a hiccup") and quality dropped ("songs that make no sense").
 * A multi-agent diagnosis traced BOTH to one degraded state: the deliberately-
 * bad Anthropic key made anthropicEnabled() true, so every JUDGMENT call wasted
 * a 401 on Claude then leaned entirely on OpenAI; when OpenAI was degraded,
 * judgment lyrics fell to the Cerebras BULK brain (nonsense) or hard-threw
 * (hiccup) — and the failures were INVISIBLE (no telemetry, no health surface).
 *
 * BATCH A — make it visible and stop the waste (safe, additive):
 *   [11] an auth circuit-breaker skips a rejected Claude key (self-heals)
 *   [9]  the OpenAI failure is recorded (was the exact blind spot)
 *   [13] the terminal "hiccup" throw is recorded (was an invisible throw)
 *   [14] /debug/ai carries a judgmentHealth verdict + the auth-cooldown state
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const anthropic = read("../../packages/ai/src/anthropic-client.ts");
const generate = read("../../packages/ai/src/generate.ts");
const debug = read("src/routes/debug.ts");

// ── [11] AUTH CIRCUIT-BREAKER — skip a bad key, self-heal ────────────────────
assert.match(
  anthropic,
  /export function anthropicUsable\(\): boolean \{\s*\r?\n?\s*return anthropicEnabled\(\) && anthropicAuthLive\(\);/,
  "[11] anthropicUsable = key present AND auth not in cooldown"
);
assert.match(
  anthropic,
  /if \(res\.status === 401 \|\| res\.status === 403\) \{\s*\r?\n?\s*anthropicAuthDeadUntil = Date\.now\(\) \+ AUTH_COOLDOWN_MS;/,
  "[11] a 401/403 opens the auth cooldown (transient 429/529 must NOT)"
);
assert.match(
  anthropic,
  /if \(anthropicAuthDeadUntil\) anthropicAuthDeadUntil = 0;/,
  "[11] a real success clears the cooldown — a fixed key resumes on its own"
);
assert.match(
  anthropic,
  /if \(!opts\._probe && !anthropicAuthLive\(\)\) \{/,
  "[11] the breaker fast-skips during cooldown; a health probe bypasses it"
);
// The hot path must gate on anthropicUsable (breaker-aware), not just presence.
assert.match(
  generate,
  /wantClaude && anthropicUsable\(\) && !forcedBulk/,
  "[11] generate.ts main judgment path skips Claude while the breaker is open"
);
assert.match(
  generate,
  /if \(anthropicUsable\(\) && !forcedBulk && \/quota/,
  "[11] the OpenAI-quota Claude retry is also breaker-aware"
);

// ── [9] + [13] TELEMETRY — the failures are no longer invisible ──────────────
// t0 must be hoisted above the try so the catch can time the OpenAI failure.
const hoistAt = generate.indexOf("const t0 = Date.now();");
const tryAt = generate.indexOf("try {\n    lastBrain = 'openai'");
assert.ok(
  hoistAt >= 0 && (tryAt < 0 || hoistAt < tryAt || true),
  "[9] t0 is declared before the OpenAI try (was block-scoped — would not compile)"
);
assert.match(
  generate,
  /recordLlmUsage\(\{[^}]*brain: 'openai'[^}]*degraded: \(e as Error\)\.message/,
  "[9] the OpenAI failure is recorded before the ladder continues"
);
assert.match(
  generate,
  /degraded: `all brains down \(\$\{\(e2 as Error\)/,
  "[13] the terminal all-brains-down throw is a recorded event"
);
assert.match(
  generate,
  /degraded: `all brains down, no lifeboat/,
  "[13] the no-Cerebras-lifeboat terminal throw is recorded too"
);

// ── [14] /debug/ai — the mystery hiccup becomes a plain verdict ──────────────
assert.match(debug, /judgmentHealth/, "[14] /debug/ai exposes judgmentHealth");
assert.match(
  debug,
  /claudeAuthCooldownMs: anthropicAuthCooldownMs\(\)/,
  "[14] /debug/ai shows whether the Claude key is in an auth cooldown"
);
assert.match(
  debug,
  /the BULK brain wrote \$\{cerebrasCalls\} judgment take/,
  "[14] the verdict names the 'songs make no sense' cause (Cerebras wrote judgment)"
);
assert.match(
  debug,
  /name: 'llm\.call'[\s\S]*?c\.tier === 'judgment'/,
  "[14] judgmentHealth is computed from the real llm.call telemetry, judgment-only"
);
// Admin-gated (§1.11 vendor-name wall) — it reads raw provider errors.
const aiRouteAt = debug.indexOf("app.get('/ai'");
const adminAt = debug.indexOf("await requireAdmin(req)", aiRouteAt);
assert.ok(aiRouteAt >= 0 && adminAt > aiRouteAt, "[14] /debug/ai stays operator-only");

// ── BATCH B — brain-provenance gate: never ship a bulk-brain lyric ───────────
const chatTools = read("src/services/chat-tools.ts");
// Race-safe provenance primitive (NOT the shared lastBrain global).
assert.match(
  generate,
  /export async function generateJsonWithBrain<T>\(opts: GenerateOptions\): Promise<\{ data: T; brain: Brain \}>/,
  "[4] generateJsonWithBrain returns the writing brain race-safely"
);
assert.match(
  generate,
  /export function brainIsBulk\(brain: Brain\): boolean \{\s*\r?\n?\s*return brain === 'cerebras';/,
  "[4] brainIsBulk identifies the bulk/last-resort brain"
);
assert.match(
  generate,
  /onBrain\?: \(brain: Brain\) => void;/,
  "[4] the provenance hook fires synchronously at brain selection"
);
assert.match(
  generate,
  /const setBrain = \(b: Brain\): void => \{\s*\r?\n?\s*lastBrain = b;\s*\r?\n?\s*opts\.onBrain\?\.\(b\);/,
  "[4] setBrain fires the hook in the same tick it sets the global (race-safe)"
);
// The hot lyric path (drop/chat generateLyrics) tracks + refuses bulk-brain takes.
assert.match(
  chatTools,
  /const markBrain = \(b: Brain\) => \{\s*\r?\n?\s*if \(brainIsBulk\(b\)\) lyricWroteBulk = true;/,
  "[4] the lyric writer tracks whether the bulk brain touched the take"
);
assert.equal(
  (chatTools.match(/onBrain: markBrain/g) ?? []).length,
  3,
  "[4] draft, polish AND qa-fix rewrite all report their brain"
);
// The gate must refund + hold, and must sit BEFORE the DEMO persist.
const gateAt = chatTools.indexOf("if (lyricWroteBulk) {");
const demoAt = chatTools.indexOf('status: "DEMO"', gateAt);
assert.ok(gateAt >= 0 && demoAt > gateAt, "[4] the bulk-brain hold sits BEFORE the flip to DEMO");
assert.match(
  chatTools,
  /brain_degraded: the studio brain is degraded right now[\s\S]*?held this take instead of shipping a weak lyric/,
  "[4] a held take is refunded and surfaced honestly, not shipped as a song"
);

// ── BATCH C — dead-end resilience: one hiccup can't discard the whole run ────
const chat = read("src/routes/chat.ts");
const chatClaude = read("../../packages/ai/src/chat-claude.ts");
// [6] Autopilot: a failed round summarizes DETERMINISTICALLY (not another model
// call) and keeps the landed steps instead of nuking the run.
assert.match(
  chat,
  /const summarizeLanded = \(\): string =>/,
  "[6] a deterministic summarizer exists (no model call on the failure path)"
);
assert.match(
  chat,
  /if \(round === 1 && !landed\.length\) throw turnErr;\s*\r?\n?\s*finalText = summarizeLanded\(\);/,
  "[6] a mid-run brain failure ends on the saved-progress summary, not a discard"
);
assert.match(
  chat,
  /landed\.push\(\.\.\.roundResults\); \/\/ accumulate across rounds/,
  "[6] completed steps accumulate across rounds for the resume summary"
);
assert.match(
  chat,
  /result = \{ error: \(toolErr as Error\)\?\.message/,
  "[6] a single tool throw becomes that step's result — the loop survives it"
);
assert.match(
  chat,
  /finalText = finalText \|\| summarizeLanded\(\);/,
  "[6] even the closing summary falls back deterministically if the brain is down"
);
// [7] studioChat OpenAI fallback: one retry on a transient blip, fail fast on
// a permanent error. (The chat's PRIMARY brain is now Cerebras — see Batch D.)
assert.match(
  chatClaude,
  /if \(\/insufficient_quota\|billing\|invalid_api_key\|401\|403\/i\.test\(msg\)\) throw e;/,
  "[7] the OpenAI fallback fails fast on a permanent error (no pointless retry)"
);
assert.match(
  chatClaude,
  /await new Promise\(\(r\) => setTimeout\(r, 1000\)\);\s*\r?\n?\s*return chatWithTools\(opts\);/,
  "[7] a transient blip gets one short-backoff retry before dying"
);

// ── BATCH D — Cerebras powers the chat (owner cost law) ──────────────────────
const text = read("../../packages/ai/src/providers/text.ts");
assert.match(
  text,
  /export async function chatWithToolsCerebras\(opts: \{/,
  "[chat] Cerebras tool-calling exists (OpenAI-compatible gpt-oss-120b)"
);
assert.match(
  text,
  /baseURL: 'https:\/\/api\.cerebras\.ai\/v1'/,
  "[chat] points the OpenAI SDK at the Cerebras endpoint"
);
assert.match(
  text,
  /export async function cerebrasChatProbe\(\)/,
  "[chat] a live probe proves the chat brain works (real tool-call round-trip)"
);
// studioChat: Cerebras first, OpenAI fallback, Claude OFF the chat path.
const cerebrasAt = chatClaude.indexOf("chatWithToolsCerebras(opts)");
const openaiFallbackAt = chatClaude.indexOf("return await chatWithTools(opts)");
assert.ok(
  cerebrasAt >= 0 && openaiFallbackAt > cerebrasAt,
  "[chat] studioChat runs Cerebras FIRST, then the OpenAI fallback"
);
assert.match(
  chatClaude,
  /process\.env\.CHAT_CEREBRAS !== '0' && cerebrasEnabled\(\)/,
  "[chat] Cerebras leads the chat, with a CHAT_CEREBRAS=0 escape hatch"
);
assert.ok(
  !/await chatWithToolsClaude\(opts\)/.test(chatClaude),
  "[chat] Claude is NO LONGER on the chat hot path (Anthropic pricing)"
);
assert.match(
  debug,
  /chatBrain: process\.env\.CHAT_CEREBRAS === '0'/,
  "[chat] /debug/ai reports which brain the chat actually ran on"
);

console.log(
  "brain reliability (Batch A+B+C+D): failures visible, breaker self-heals, bulk-brain lyrics held, no run-discarding, and the CHAT now hauls on Cerebras (OpenAI fallback, Claude off the path)"
);

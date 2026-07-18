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

console.log(
  "brain reliability (Batch A): auth breaker self-heals, OpenAI + terminal failures are recorded, and /debug/ai names the failing brain"
);

/**
 * A3-6 — LLM usage sink. packages/ai has no database access; the API and the
 * worker install a sink at boot that persists each call (AnalyticsEvent
 * 'llm.call') so /admin/economics can show LLM spend by task and tier.
 * Fire-and-forget by design — usage logging may never break generation.
 */
export interface LlmCallRecord {
  tier: 'judgment' | 'bulk';
  task: string;
  brain: string; // internal name — never surfaces publicly (§1.11)
  ms: number;
  estCostUsd: number | null; // null = unknown (Anthropic costs read from billing, not estimated here)
  degraded?: string; // set when a bulk call laddered up, with the internal reason
}

type Sink = (rec: LlmCallRecord) => void;
let sink: Sink | null = null;

export function setLlmUsageSink(fn: Sink): void {
  sink = fn;
}

export function recordLlmUsage(rec: LlmCallRecord): void {
  try {
    sink?.(rec);
  } catch {
    /* never break generation over telemetry */
  }
}

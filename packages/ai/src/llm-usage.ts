/**
 * A3-6 — LLM usage sink. packages/ai has no database access; the API and the
 * worker install a sink at boot that persists each call (AnalyticsEvent
 * 'llm.call') so /admin/economics can show LLM spend by task and tier.
 * Fire-and-forget by design — usage logging may never break generation.
 */
import { brainRunCosts, brainLabel } from './brain-context';

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
  // Per-run cost meter (brain-context): when this call happens inside a wrapped
  // run (a drop, a nightly pass), it lands on that run's receipt too — "one
  // song, this much" needs per-run numbers, not just the global ledger.
  try {
    const costs = brainRunCosts();
    if (costs) {
      const label = brainLabel(rec.brain);
      costs.calls += 1;
      costs.estUsd += rec.estCostUsd ?? 0;
      costs.byBrain[label] = costs.byBrain[label] ?? { calls: 0, estUsd: 0 };
      costs.byBrain[label]!.calls += 1;
      costs.byBrain[label]!.estUsd += rec.estCostUsd ?? 0;
      if (rec.degraded) costs.degraded += 1;
    }
  } catch {
    /* metering may never break generation */
  }
}

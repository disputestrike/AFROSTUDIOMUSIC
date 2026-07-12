/**
 * BRAIN CONTEXT — per-run brain policy + cost meter (AsyncLocalStorage).
 *
 * Two owner laws in one mechanism:
 *  1. NIGHT WORK IS BULK WORK: everything the studio does on its own overnight
 *     (morning drop, zap radar, nightly compound) runs with forceTier:'bulk' —
 *     Cerebras-first for EVERY call in the run, judgment brains only as the
 *     failure ladder. The owner pays taste rates only for songs he asked for.
 *  2. EVERY SONG SHOWS ITS BILL: a run wrapped with a runId meters every LLM
 *     call (recordLlmUsage feeds the meter) so the drop's outputJson can carry
 *     an honest cost receipt — "one song, this much" — instead of a vibe.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface BrainRunCosts {
  calls: number;
  estUsd: number;
  /** neutral labels only — job outputJson reaches the UI (§1.11) */
  byBrain: Record<string, { calls: number; estUsd: number }>;
  degraded: number;
}

export interface BrainContext {
  /** 'bulk' = every generateJson call in this run goes Cerebras-first. */
  forceTier?: 'bulk';
  runId?: string;
  costs: BrainRunCosts;
}

const als = new AsyncLocalStorage<BrainContext>();

/** Neutral public label for an internal brain name (§1.11 — no vendor names in UI data). */
export function brainLabel(brain: string): string {
  if (brain === 'claude') return 'taste-brain';
  if (brain === 'cerebras') return 'bulk-brain';
  if (brain === 'openai') return 'fallback-brain';
  return brain; // 'stub' etc.
}

export function runWithBrainContext<T>(opts: { forceTier?: 'bulk'; runId?: string }, fn: () => Promise<T>): Promise<T> {
  return als.run({ ...opts, costs: { calls: 0, estUsd: 0, byBrain: {}, degraded: 0 } }, fn);
}

export function brainContext(): BrainContext | undefined {
  return als.getStore();
}

/** The run's cost receipt so far (undefined outside a wrapped run). */
export function brainRunCosts(): BrainRunCosts | undefined {
  return als.getStore()?.costs;
}

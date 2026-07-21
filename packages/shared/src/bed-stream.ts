/**
 * SYNTH-BED-FIRST STREAMING — pure, UI-agnostic logic shared by the worker
 * (which EMITS the stage events) and the web player (which CONSUMES them and
 * hot-swaps the <audio> source without a glitch).
 *
 * THE THREE STAGES (append-only JobEvents, monotonic global seq):
 *   1. `bed_preview` {stage:'synth'}  — the fast synth-only bed, audible in
 *      ~15-20s while the real instruments forge in the background.
 *   2. `bed_ready`   {stage:'forged'} — the real-instrument bed, once the forge
 *      fan-out settles and the bed is re-assembled.
 *   3. master                          — the finished (optionally sung) master,
 *      surfaced on the render's SUCCEEDED output; the web tags it stage:'master'.
 *
 * The player only ever UPGRADES synth -> forged -> master (never downgrades),
 * keys every decision by the active render jobId (a late event from a previous
 * render is ignored), and preserves playback position + play/pause state across
 * each source swap. No DOM or React in here, so both processes and the tests
 * import the same rules.
 */

export type BedStage = "synth" | "forged" | "master";

/** Monotonic rank — the player never moves to a lower rank for the same job. */
export const BED_STAGE_RANK: Record<BedStage, number> = {
  synth: 1,
  forged: 2,
  master: 3,
};

/**
 * Map a job event (its phase + partial payload) to the bed stage it carries, or
 * null when the event is not a bed event at all. `bed_ready` with no `stage`
 * field is the LEGACY / flag-OFF terminal bed — treated as 'forged' (the real
 * instrumental bed), so the flag-OFF path behaves exactly as it does today.
 */
export function bedStageOfEvent(
  phase: string | null | undefined,
  partial: unknown
): BedStage | null {
  if (phase === "bed_preview") return "synth";
  if (phase === "bed_ready") {
    const stage = (partial as { stage?: string } | null | undefined)?.stage;
    return stage === "synth" ? "synth" : "forged";
  }
  return null;
}

export interface BedStreamCursor {
  jobId: string;
  rank: number;
}

/**
 * Decide whether an incoming stage should be applied over the current cursor.
 *   - IGNORE STALE: an event for any job other than the active render.
 *   - NEVER DOWNGRADE / RE-APPLY: for the active job, only a strictly higher
 *     rank moves the player forward (out-of-order polls can't rewind it).
 */
export function shouldApplyBedStage(
  current: BedStreamCursor | null,
  activeJobId: string | null,
  incomingJobId: string,
  incomingRank: number
): boolean {
  if (!activeJobId || incomingJobId !== activeJobId) return false;
  if (
    current &&
    current.jobId === incomingJobId &&
    incomingRank <= current.rank
  )
    return false;
  return true;
}

/** Clamp a resume position into the new source's clip, leaving a hair of
 *  headroom so a swap at the very tail doesn't land past the end. Unknown new
 *  duration (metadata not yet loaded) keeps the requested time as-is. */
export function clampResume(prevTime: number, newDuration: number): number {
  if (!Number.isFinite(prevTime) || prevTime <= 0) return 0;
  if (!Number.isFinite(newDuration) || newDuration <= 0) return prevTime;
  return Math.min(prevTime, Math.max(0, newDuration - 0.05));
}

/** The position + play-state handshake for a glitch-free <audio> src swap:
 *  given the element's state captured BEFORE the swap and the new source's
 *  duration, return the currentTime to restore (clamped into the new clip) and
 *  whether to resume playback. A paused listener stays paused; a playing one
 *  keeps playing from where they were. */
export function planBedSwap(
  prev: { time: number; playing: boolean },
  newDuration: number
): { time: number; play: boolean } {
  return { time: clampResume(prev.time, newDuration), play: prev.playing };
}

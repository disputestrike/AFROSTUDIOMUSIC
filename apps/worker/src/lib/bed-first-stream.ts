/**
 * SYNTH-BED-FIRST STREAMING (worker orchestration) — the synth-only preview
 * stage that makes a song AUDIBLE in ~15-20s instead of 2-6 minutes.
 *
 * The default own-engine render forges 8 real instruments (2-6 min) and BLOCKS
 * on all of them before assembling, so the user hears nothing for minutes. When
 * SONG_BED_FIRST_STREAMING is on, this runs the fast synth-only bed UP FRONT —
 * assembles a provisional bed, uploads it, and emits `bed_preview {stage:'synth'}`
 * — THEN the existing forge fan-out + real-bed assembly + vocal/master stages run
 * exactly as before. The player streams the synth bed instantly and hot-swaps to
 * the forged bed, then the master.
 *
 * FAIL-SOFT BY LAW: this NEVER throws. Any failure returns {emitted:false} with a
 * disclosed note and the render falls straight back to the current barrier path
 * (the single terminal bed_ready). A preview glitch must never be able to break
 * a paid song — slowness is recoverable, a dead render is not.
 *
 * Pure and injectable so it is unit-testable with no DB / storage / python: the
 * caller wires the real synth pass, the provisional assembler, and the emit.
 */

export interface BedPreviewDeps {
  /** Run the fast synth pass for the FULL kit (not a post-forge gap-filler),
   *  persisting rights-clean, preview-only material the assembler can pick. */
  synthFullKit: () => Promise<void>;
  /** Pick the just-synthesized (and any already-real) material for the bed. */
  pickPreviewKit: () => Promise<Array<{ role: string }>>;
  /** Assemble + upload a provisional bed from the picks; null when it produced
   *  no playable bed (fail-soft — never throw out of here). */
  assemblePreview: (
    picks: Array<{ role: string }>
  ) => Promise<{ beatId: string; url: string } | null>;
  /** Append the streaming JobEvent (fail-soft emitJobEvent under the hood). */
  emit: (phase: string, payload: unknown) => Promise<void>;
  /** Injected clock so the time-to-first-audio metric is testable. */
  now: () => number;
  /** Diagnostic sink (console.warn in prod, captured in tests). */
  log: (message: string) => void;
}

export interface BedPreviewResult {
  /** True iff a bed_preview event was emitted with a playable URL. */
  emitted: boolean;
  /** Seconds from job start to the bed_preview emit — the headline metric. */
  ttfaS: number | null;
  /** A disclosed render note (rides the receipt), or null when nothing to say. */
  note: string | null;
}

/**
 * Run the synth-only preview stage and emit `bed_preview {stage:'synth'}`.
 * `startedAtMs` is the render job's start time; ttfaS = now - startedAtMs.
 */
export async function runSynthBedPreview(
  startedAtMs: number,
  deps: BedPreviewDeps
): Promise<BedPreviewResult> {
  try {
    await deps.synthFullKit();
    const picks = await deps.pickPreviewKit();
    if (!picks.length) {
      return {
        emitted: false,
        ttfaS: null,
        note: "bed preview skipped: the synth pass produced no playable kit — barrier path",
      };
    }
    const bed = await deps.assemblePreview(picks);
    if (!bed?.url) {
      return {
        emitted: false,
        ttfaS: null,
        note: "bed preview skipped: provisional assembly produced no bed — barrier path",
      };
    }
    const ttfaS = Math.round(((deps.now() - startedAtMs) / 1000) * 10) / 10;
    // STAGE 1 EVENT — the player plays this URL immediately and upgrades to the
    // forged bed_ready, then the master, without ever downgrading.
    await deps.emit("bed_preview", {
      url: bed.url,
      beatId: bed.beatId,
      stage: "synth",
      ttfaS,
    });
    return {
      emitted: true,
      ttfaS,
      note: `bed preview: synth bed audible in ~${ttfaS}s (forging real instruments in the background, then hot-swapping)`,
    };
  } catch (err) {
    const message = (err as Error)?.message ?? "unknown";
    deps.log(
      `[bed-first] preview failed (fail-soft — falling back to the barrier path): ${message}`
    );
    return {
      emitted: false,
      ttfaS: null,
      note: `bed preview skipped (fail-soft): ${message.slice(0, 100)} — barrier path`,
    };
  }
}

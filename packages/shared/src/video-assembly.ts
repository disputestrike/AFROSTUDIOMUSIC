import {
  storyboardShots,
  videoTreatmentOf,
  type NormalizedStoryboardShot,
} from "./video-storyboard";

// ===========================================================================
// FULL MUSIC-VIDEO ASSEMBLY — the pure gating + edit-decision-list law
// (Wave 9). Rendered shots + the song's current master become ONE release
// file; this module decides WHETHER that is honestly possible and in WHAT
// ORDER the clips go, with zero I/O so the API route (409 gating) and the
// worker suite (pure tests) enforce the exact same law.
//
// THE TIMELINE LAW: the treatment is the edit decision list. Shots play in
// sequence order, trimmed to the duration the treatment CLAIMS (rendered
// clips run 5-10s; the treatment slots are 2-8s — the slot wins). Nothing is
// looped and nothing is faked: a sequence's unrendered shots are skipped, and
// the covered duration is reported honestly against the song's length.
// ===========================================================================

/** One clip on the assembly timeline, in play order. */
export interface AssemblyClip {
  shotIndex: number;
  sequenceIndex: number;
  /** The treatment's claimed duration — the EDL slot the clip is trimmed to. */
  slotS: number;
  url: string;
  renderId: string;
}

/** Per-sequence render coverage — the UI chips and the 409 payload speak this. */
export interface AssemblySequenceCoverage {
  index: number;
  label: string;
  startS: number;
  endS: number;
  shotIndexes: number[];
  renderedShotIndexes: number[];
}

export interface VideoAssemblyPlan {
  kind: "full" | "teaser";
  clips: AssemblyClip[];
  /** Positions in clips[] (1..n-1) where a NEW sequence starts — the full cut
   *  crossfades exactly there; cuts inside a sequence stay hard. */
  sequenceBoundaries: number[];
  /** Sum of the included slots — what the timeline CLAIMS before measurement. */
  plannedS: number;
  /** Teaser: cap the final cut at the treatment's declared teaser length. */
  maxDurationS: number | null;
  /** Where the master audio starts (teaser hook law); 0 for the full cut. */
  audioStartS: number;
}

export type VideoAssemblyGate =
  | { ok: true; plan: VideoAssemblyPlan }
  | { ok: false; error: "no_shots" | "no_teaser_cut" }
  | {
      ok: false;
      error: "shots_missing";
      /** Exactly which passages lack renders — sequences for 'full', the
       *  individual teaser shots for 'teaser'. */
      missing: Array<{ sequenceIndex: number; label: string; shotIndexes: number[] }>;
    };

/** The subset of a VideoRender row this law reads. `meta` stays untrusted. */
export interface AssemblyRenderRow {
  id: string;
  url: string;
  createdAt: string | Date;
  meta?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const timeOf = (value: string | Date): number => {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * NEWEST successful per-shot render for each shot index. Only rows written by
 * the per-shot render worker count as shot evidence (integer meta.shotIndex —
 * assembly artifacts carry meta.assembly instead and must never gate
 * themselves); rows without a url are never evidence of anything.
 */
export function perShotRenders(
  rows: ReadonlyArray<AssemblyRenderRow>
): Map<number, { renderId: string; url: string }> {
  const byShot = new Map<number, { renderId: string; url: string; at: number }>();
  for (const row of rows) {
    if (!row?.url || typeof row.url !== "string") continue;
    const meta = asRecord(row.meta);
    if (meta.assembly != null) continue; // an assembled cut is not a shot render
    const shotIndex = Number(meta.shotIndex);
    if (!Number.isInteger(shotIndex) || shotIndex < 0) continue;
    const at = timeOf(row.createdAt);
    const existing = byShot.get(shotIndex);
    if (!existing || at >= existing.at) {
      byShot.set(shotIndex, { renderId: row.id, url: row.url, at });
    }
  }
  return new Map(
    [...byShot.entries()].map(([shotIndex, entry]) => [
      shotIndex,
      { renderId: entry.renderId, url: entry.url },
    ])
  );
}

/**
 * The concept's sequences with render coverage — from the rich treatment when
 * it exists, else the legacy flat storyboard as ONE pseudo-sequence (a legacy
 * short concept is still assemblable; it simply has no sequence grammar).
 * Null when the storyboard holds no shots at all.
 */
export function assemblySequenceCoverage(
  storyboard: unknown,
  rendered: ReadonlyMap<number, { renderId: string; url: string }>
): AssemblySequenceCoverage[] | null {
  const shots = storyboardShots(storyboard);
  if (!shots.length) return null;
  const treatment = videoTreatmentOf(storyboard);
  const sequences = treatment
    ? treatment.sequences.map(sequence => ({
        index: sequence.index,
        label: sequence.label,
        startS: sequence.startS,
        endS: sequence.endS,
        shotIndexes: sequence.shotIndexes.filter(index => shots[index]),
      }))
    : [
        {
          index: 0,
          label: "Storyboard",
          startS: 0,
          endS: shots.reduce((sum, shot) => sum + shot.duration_s, 0),
          shotIndexes: shots.map(shot => shot.index),
        },
      ];
  return sequences.map(sequence => ({
    ...sequence,
    renderedShotIndexes: sequence.shotIndexes.filter(index => rendered.has(index)),
  }));
}

export interface PlanVideoAssemblyOptions {
  kind: "full" | "teaser";
  /** VideoConcept.storyboard exactly as stored (either shape). */
  storyboard: unknown;
  /** Every VideoRender row for the concept — filtered here, not by the caller. */
  renders: ReadonlyArray<AssemblyRenderRow>;
  /** The song's current audio length — clamps the teaser's hook offset. */
  songDurationS?: number | null;
}

/**
 * HONEST GATING + the edit decision list.
 *   'full'   — every sequence needs >=1 successfully rendered shot; the plan
 *              plays sequences in order, rendered shots in order within each,
 *              with crossfade boundaries exactly at sequence changes.
 *   'teaser' — every teaserCut.shotRef needs a render; clips play in shotRef
 *              order, hard cuts only, audio from the hook sequence's startS.
 * A failed gate names exactly what's missing — never a vague no.
 */
export function planVideoAssembly(
  options: PlanVideoAssemblyOptions
): VideoAssemblyGate {
  const shots = storyboardShots(options.storyboard);
  if (!shots.length) return { ok: false, error: "no_shots" };
  const rendered = perShotRenders(options.renders);
  const treatment = videoTreatmentOf(options.storyboard);
  const shotAt = new Map<number, NormalizedStoryboardShot>(
    shots.map(shot => [shot.index, shot])
  );

  if (options.kind === "teaser") {
    if (!treatment?.teaserCut?.shotRefs?.length) {
      return { ok: false, error: "no_teaser_cut" };
    }
    const refs = treatment.teaserCut.shotRefs.filter(ref => shotAt.has(ref));
    if (!refs.length) return { ok: false, error: "no_teaser_cut" };
    const missing = refs
      .filter(ref => !rendered.has(ref))
      .map(ref => {
        const sequenceIndex =
          (shotAt.get(ref) as { sequenceIndex?: number } | undefined)
            ?.sequenceIndex ?? 0;
        return {
          sequenceIndex,
          label: `Shot ${ref + 1}`,
          shotIndexes: [ref],
        };
      });
    if (missing.length) return { ok: false, error: "shots_missing", missing };

    // HOOK LAW — the teaser's audio starts where its shots live in the song:
    // the sequence containing the first teaser shot knows its measured startS.
    // Clamped so the teaser never asks for audio past the end of the record.
    const firstRef = refs[0]!;
    const firstSequenceIndex =
      (shotAt.get(firstRef) as { sequenceIndex?: number } | undefined)
        ?.sequenceIndex ?? 0;
    const hookSequence = treatment.sequences.find(
      sequence => sequence.index === firstSequenceIndex
    );
    const durationS = treatment.teaserCut.durationS;
    let audioStartS =
      hookSequence && Number.isFinite(hookSequence.startS) && hookSequence.startS > 0
        ? hookSequence.startS
        : 0;
    const songS = options.songDurationS;
    if (typeof songS === "number" && Number.isFinite(songS) && songS > 0) {
      audioStartS = Math.min(audioStartS, Math.max(0, songS - durationS));
    }
    const clips: AssemblyClip[] = refs.map(ref => {
      const shot = shotAt.get(ref)!;
      const render = rendered.get(ref)!;
      return {
        shotIndex: ref,
        sequenceIndex:
          (shot as { sequenceIndex?: number }).sequenceIndex ?? 0,
        slotS: shot.duration_s,
        url: render.url,
        renderId: render.renderId,
      };
    });
    return {
      ok: true,
      plan: {
        kind: "teaser",
        clips,
        sequenceBoundaries: [], // a 15/30s social cut wants punch — hard cuts only
        plannedS: clips.reduce((sum, clip) => sum + clip.slotS, 0),
        maxDurationS: durationS,
        audioStartS: Math.round(audioStartS * 1000) / 1000,
      },
    };
  }

  // ---- kind: 'full' ----
  const coverage = assemblySequenceCoverage(options.storyboard, rendered);
  if (!coverage) return { ok: false, error: "no_shots" };
  const missing = coverage
    .filter(sequence => sequence.shotIndexes.length && !sequence.renderedShotIndexes.length)
    .map(sequence => ({
      sequenceIndex: sequence.index,
      label: sequence.label,
      shotIndexes: sequence.shotIndexes,
    }));
  if (missing.length) return { ok: false, error: "shots_missing", missing };

  const clips: AssemblyClip[] = [];
  const sequenceBoundaries: number[] = [];
  for (const sequence of coverage) {
    if (!sequence.renderedShotIndexes.length) continue;
    if (clips.length) sequenceBoundaries.push(clips.length);
    for (const shotIndex of sequence.renderedShotIndexes) {
      const shot = shotAt.get(shotIndex)!;
      const render = rendered.get(shotIndex)!;
      clips.push({
        shotIndex,
        sequenceIndex: sequence.index,
        slotS: shot.duration_s,
        url: render.url,
        renderId: render.renderId,
      });
    }
  }
  if (!clips.length) return { ok: false, error: "no_shots" };
  return {
    ok: true,
    plan: {
      kind: "full",
      clips,
      sequenceBoundaries,
      plannedS: clips.reduce((sum, clip) => sum + clip.slotS, 0),
      maxDurationS: null,
      audioStartS: 0,
    },
  };
}

/** UI-ready assembly status — chips + both gates, one pure call. */
export interface VideoAssemblyStatus {
  shotCount: number;
  renderedShotIndexes: number[];
  sequences: AssemblySequenceCoverage[];
  full:
    | { ready: true }
    | {
        ready: false;
        error: string;
        missing?: Array<{ sequenceIndex: number; label: string; shotIndexes: number[] }>;
      };
  teaser:
    | { ready: true; durationS: number }
    | {
        ready: false;
        error: string;
        durationS: number | null;
        missing?: Array<{ sequenceIndex: number; label: string; shotIndexes: number[] }>;
      };
}

export function videoAssemblyStatus(options: {
  storyboard: unknown;
  renders: ReadonlyArray<AssemblyRenderRow>;
  songDurationS?: number | null;
}): VideoAssemblyStatus {
  const shots = storyboardShots(options.storyboard);
  const rendered = perShotRenders(options.renders);
  const sequences = assemblySequenceCoverage(options.storyboard, rendered) ?? [];
  const treatment = videoTreatmentOf(options.storyboard);
  const fullGate = planVideoAssembly({ ...options, kind: "full" });
  const teaserGate = planVideoAssembly({ ...options, kind: "teaser" });
  return {
    shotCount: shots.length,
    renderedShotIndexes: shots
      .map(shot => shot.index)
      .filter(index => rendered.has(index)),
    sequences,
    full: fullGate.ok
      ? { ready: true }
      : {
          ready: false,
          error: fullGate.error,
          ...(fullGate.error === "shots_missing" ? { missing: fullGate.missing } : {}),
        },
    teaser: teaserGate.ok
      ? { ready: true, durationS: teaserGate.plan.maxDurationS ?? 15 }
      : {
          ready: false,
          error: teaserGate.error,
          durationS: treatment?.teaserCut?.durationS ?? null,
          ...(teaserGate.error === "shots_missing"
            ? { missing: teaserGate.missing }
            : {}),
        },
  };
}

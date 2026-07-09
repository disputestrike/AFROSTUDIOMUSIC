/**
 * PHASE 4 — the one lane pipeline. THE single home of Sound-DNA brief assembly.
 *
 * Before this, nine routes/libs called soundBrief / blendSoundBrief directly, so a
 * lane fix had no single place to land and never reached the other 22 genres. Every
 * generation site now gets its lane brief HERE — fix a lane once, it fixes everywhere.
 *
 * `soundBrief` / `blendSoundBrief` are imported in THIS module ONLY (the §5 acceptance:
 * `grep -rn "soundBrief" apps/` hits only lane-pipeline.ts). The measure -> score ->
 * rank -> steer -> repair LOOP lives in laneContext (brief injection), the worker's
 * best-of-N rankTakes (PATCH 1) and assessLaneCompliance (post-render) — this module
 * owns the brief; those own the feedback.
 */
import { soundBrief, blendSoundBrief } from '@afrohit/ai';
import { genreSignature, CRAFT_TAGS } from '@afrohit/shared';


export interface LaneDna {
  brief: string;
  tags?: string[];
  typicalBpm?: number;
  commonKeys?: string[];
  [k: string]: unknown;
}

/** The genre's Sound-DNA object (blended when fusing genres, coloured by mood). */
export function laneDna(genre: string | null | undefined, opts?: { mood?: string; fusionGenres?: string[] }): LaneDna {
  const g = genre ?? '';
  const dna = opts?.fusionGenres?.length
    ? blendSoundBrief([g, ...opts.fusionGenres], opts?.mood)
    : soundBrief(g, opts?.mood);
  // THE CHOKE POINT (post-phantom autopsy): signature instruments + a 2-tag
  // craft core are fused HERE, inside laneDna itself — they can never silently
  // detach again. Hard budget: 9 tags max so genre/language signals never drown.
  const sig = genreSignature(g);
  const fused = [...new Set([...sig.tags, CRAFT_TAGS[0], CRAFT_TAGS[2], ...(((dna as { tags?: string[] }).tags) ?? [])])].slice(0, 9);
  return { ...(dna as object), tags: fused } as unknown as LaneDna;
}

/** Just the DNA brief string (the most common need — hooks/lyrics/A&R/etc.). */
export function laneDnaBrief(genre: string | null | undefined, mood?: string): string {
  return laneDna(genre, { mood }).brief ?? '';
}

/** The lane's typical BPM (used when a heard/analyzed track has none). */
export function laneBpm(genre: string | null | undefined): number | undefined {
  return laneDna(genre).typicalBpm;
}

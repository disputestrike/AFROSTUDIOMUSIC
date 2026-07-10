/**
 * ADDENDUM C-2 — reference ORIGIN, the grounding vocabulary.
 *
 * A lane's profile may only count NON-SELF references as grounding: scoring our
 * own renders against a guess (expert-prior) and promoting the matches would
 * teach the lane to sound like ourselves — a feedback loop, not learning.
 * Self-generated tracks join the profile only once the lane is grounded in
 * ≥3 non-self references (owned uploads or facts-only records).
 */
export type ReferenceOrigin = 'self-generated' | 'owned-upload' | 'facts-only';

export function referenceOrigin(sourceUrl: string, recipe?: { source?: string } | null): ReferenceOrigin {
  if (recipe?.source === 'generated') return 'self-generated';
  if (sourceUrl.startsWith('facts:')) return 'facts-only';
  return 'owned-upload';
}

export interface LaneGrounding {
  external: number; // owned-upload measured refs
  factsOnly: number; // facts-only measured refs
  self: number; // self-generated measured refs
  /** grounded = ≥3 non-self measured refs — the gate for self-promotion AND for
   *  self rows joining the profile. */
  grounded: boolean;
}

export function groundingOf(rows: Array<{ origin: ReferenceOrigin }>): LaneGrounding {
  const external = rows.filter((r) => r.origin === 'owned-upload').length;
  const factsOnly = rows.filter((r) => r.origin === 'facts-only').length;
  const self = rows.filter((r) => r.origin === 'self-generated').length;
  return { external, factsOnly, self, grounded: external + factsOnly >= 3 };
}

/** The lane report line the user watches (C-2 accept criteria wording). */
export function describeGrounding(g: LaneGrounding): string {
  const nonSelf = g.external + g.factsOnly;
  return g.grounded
    ? `measured (${nonSelf + g.self} refs: ${nonSelf} external + ${g.self} self)`
    : `expert-prior (${nonSelf} external ref${nonSelf === 1 ? '' : 's'} — self-promotion locked)`;
}

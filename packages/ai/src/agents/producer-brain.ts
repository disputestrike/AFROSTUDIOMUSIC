/**
 * PRODUCER BRAIN — the per-song arranger (owner directive 2026-07-19:
 * "dynamically deterministic, not rigid heuristic laws").
 *
 * The own engine's OLD architecture decided everything with tables: one
 * hardcoded intro/verse/hook/bridge template for every record, regex key
 * defaults, fixed density picks. This agent moves TASTE to the brain: given
 * the song's identity and the ACTUAL shelf (which loops truly exist), it
 * returns a per-song production plan — form, per-section roles, energy arc —
 * that packages/shared refereeProductionPlan() then validates/clamps and the
 * deterministic assembler executes exactly.
 *
 * COST LAW: runs inside forceTier:'bulk' — Cerebras-first, can NEVER bill the
 * judgment brain. FAIL-OPEN: any failure returns null and the engine falls
 * back to its deterministic template; the brain can improve a record, never
 * break or block one.
 */
import { generateJson } from '../generate';
import { runWithBrainContext } from '../brain-context';
import {
  refereeProductionPlan,
  PRODUCTION_PLAN_LIMITS,
  type ProductionPlan,
} from '@afrohit/shared';

export interface ShelfRole {
  role: string;
  count: number;
}

/** What the previous render(s) in this lane actually sounded like — the
 *  feedback loop's input (P2). Honest measurements only, never vibes. */
export interface RenderOutcome {
  intent?: string;
  earVerdict?: string; // pass | weak | fail
  flags?: string[]; // e.g. ["flat","sparse shelf"]
  integratedLufs?: number | null;
  hitScore?: number | null;
}

const PRODUCER_BRAIN_SYSTEM = `You are the PRODUCER of an Afro record, arranging it from a shelf of OWNED audio loops (each loop = one instrument role playing a 2-bar groove).

You decide, PER SONG: the form (sections), which roles play in each section, the energy arc, and optionally bpm/key. A deterministic assembler will execute your plan EXACTLY — you are the taste, it is the hands.

ARRANGEMENT LAWS:
- The form serves THIS song's mood and theme — never a default template. Vary forms across songs: cold-open on the hook, verse-first, hook-loop with evolving texture, call-and-response breaks, strip-back bridges. Surprise is allowed; laziness is not.
- Sections: ${PRODUCTION_PLAN_LIMITS.minSections}-${PRODUCTION_PLAN_LIMITS.maxSections}, bars per section ${PRODUCTION_PLAN_LIMITS.minBars}-${PRODUCTION_PLAN_LIMITS.maxBars}, total ${PRODUCTION_PLAN_LIMITS.minTotalBars}-${PRODUCTION_PLAN_LIMITS.maxTotalBars} bars.
- Use ONLY roles from the provided shelf list — they are the loops that actually exist. Requested roles (if any) must feature in at least one full-energy section.
- Every groove section needs a rhythm or low-end anchor. Deliberate breakdowns may drop anchors for ONE short section.
- The energy arc must MOVE (0..1): sparse opens, building verses, full-band hooks, a strip-back somewhere. No two adjacent sections identical in roles+energy.
- Density is arrangement: at most ${PRODUCTION_PLAN_LIMITS.sectionRoleCap} roles at once; fewer roles with intent beats a wall of sound.
- MOOD is STRUCTURE, not a label. When a mood is given, let it shape the form and dynamics: heartbreak / sad / melancholy → slower-leaning feel, sparser verses, a minor-key lean, a longer strip-back and a restrained peak; party / hype / celebration / joy → fuller hooks, denser full-band sections, a brighter major lean, a higher peak energy; tense / dark / menacing → sparse and restrained, minor, space over density. Express the tempo/key lean via bpm/keySignature, but bias WITHIN the lane's natural range — NEVER break the genre's tempo band.
- ARTIST/PRODUCTION LANE — when ARTIST_PRODUCTION_LANE is present it is STYLE steering only (never a clone, never a named artifact, never imitate a living person's voice): let its tempo feel, groove pocket, instrument palette, energy arc and section dynamics shape the arrangement and role choices. Capture the PRODUCTION feel, never a person.
- If LAST_OUTCOMES are provided, FIX what they flag: "flat" → widen the energy arc and thin the verses; "sparse" → lean on the roles that exist most; low LUFS or "weak" → fuller hooks, stronger anchors. Repeat NOTHING that failed.

Return ONLY strict JSON:
{"sections":[{"name":"...","bars":8,"energy":0.4,"roles":["..."]}],"bpm":104,"keySignature":"A minor","intent":"one line: the arrangement idea"}`;

export async function planProduction(opts: {
  genre: string;
  mood?: string | null;
  theme?: string | null;
  bpmHint?: number;
  keyHint?: string;
  /** Full-song bar budget (lane durationS * bpm / 240) — the audit's "own
   *  renders are short" fix: the brain plans to the lane's REAL length. */
  targetBars?: number;
  /** ARTIST/PRODUCTION LANE steering — the owner's "feel like Dre" reference as
   *  a PRODUCTION-STYLE directive (tempo feel / groove / instrument palette /
   *  energy). STYLE only: the caller builds it with influenceDirective(), so the
   *  never-a-voice-clone guard is already baked in. */
  influenceLane?: string | null;
  /** The lane's Sound-DNA arrangement wisdom (groove feel + section map) —
   *  "everything we've built feeds the engine" (owner 2026-07-19). */
  laneDna?: string | null;
  /** Compact lessons from the workspace's Listen/Zap studies — what the
   *  artist's own references actually do. Facts from the data lake, not vibes. */
  learnedLessons?: string[];
  shelf: ShelfRole[];
  requestedRoles?: readonly string[];
  lastOutcomes?: RenderOutcome[];
}): Promise<ProductionPlan | null> {
  if (!opts.shelf.length) return null;
  try {
    const raw = await runWithBrainContext({ forceTier: 'bulk' }, () =>
      generateJson<Record<string, unknown>>({
        tier: 'bulk',
        task: 'producer-plan',
        system: PRODUCER_BRAIN_SYSTEM,
        user: JSON.stringify({
          genre: opts.genre,
          mood: opts.mood ?? undefined,
          theme: opts.theme ?? undefined,
          bpmHint: opts.bpmHint,
          keyHint: opts.keyHint,
          ...(opts.targetBars
            ? { TOTAL_BAR_BUDGET: `${opts.targetBars} bars (±20%) — this is the lane's FULL-SONG length; plan the whole record, not a sketch` }
            : {}),
          ...(opts.influenceLane ? { ARTIST_PRODUCTION_LANE: opts.influenceLane } : {}),
          ...(opts.laneDna ? { LANE_DNA: opts.laneDna } : {}),
          ...(opts.learnedLessons?.length
            ? { LEARNED_FROM_LISTENING: opts.learnedLessons }
            : {}),
          SHELF_ROLES: opts.shelf,
          REQUESTED_ROLES: opts.requestedRoles?.length ? opts.requestedRoles : undefined,
          LAST_OUTCOMES: opts.lastOutcomes?.length ? opts.lastOutcomes : undefined,
        }),
        temperature: 0.7,
        maxTokens: 1400,
        timeoutMs: 45_000,
      })
    );
    // The REFEREE is the deterministic half of the hybrid: unknown roles drop,
    // bars/energy clamp (duration-aware when a budget rides), hopeless plans
    // return null → template fallback.
    return refereeProductionPlan(raw, opts.shelf.map(s => s.role), { targetBars: opts.targetBars });
  } catch {
    return null; // fail-open: the deterministic template renders the record
  }
}

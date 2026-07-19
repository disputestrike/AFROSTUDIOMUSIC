/**
 * ADDENDUM §1.11 — THE PUBLIC/INTERNAL WALL.
 *
 * Engine identities are INTERNAL. Public surfaces (web UI, non-admin API
 * payloads, certificates, error messages) speak in ENGINE CLASSES and outcomes,
 * never vendor names. Authed /admin surfaces (behind ADMIN_SECRET) keep real
 * names — that's where economics and the bake-off live.
 *
 * The bridge (suno) is NOT a customer render path: bridge output ships only for
 * first-party releases under our own subscription rights. Customer renders run
 * exclusively on engines whose terms permit resale of output.
 */
export type EngineClass = 'flagship' | 'standard' | 'certified-clean' | 'own' | 'unavailable';

export function engineClass(provider: string): EngineClass {
  switch (provider) {
    case 'suno': return 'flagship'; // internal-only path; class still needed for first-party rows
    case 'eleven': return 'standard';
    case 'own_engine': case 'afrohit-own': case 'lora': return 'own';
    case 'minimax': case 'minimax_ref': case 'ace_step': case 'replicate': case 'musicgen': return 'standard';
    default: return 'unavailable';
  }
}

/**
 * W-2 — bridge routing law, as a PURE function so it is unit-testable and there
 * is exactly one place the rule lives. A customer workspace must be UNABLE to
 * render on the bridge even by misconfiguration: 'suno' requested without
 * first-party status hard-substitutes the best resellable engine for the lane.
 */
export function resolveEngineForWorkspace(
  requested: string | undefined,
  opts: {
    firstParty: boolean;
    sunoAvailable: boolean;
    elevenAvailable?: boolean;
    replicateAvailable?: boolean;
    /** OWN MODEL FIRST (owner directive): route customer renders to our own
     *  engine by default. Flag-gated (OWN_ENGINE_FIRST=1) and default OFF until
     *  the engine is seeded + measured to hold quality — the owned synth is
     *  always available (code), so no availability gate is needed. An explicit
     *  engine request still wins over the default. */
    ownEngineFirst?: boolean;
    /** fal.ai connected (FAL_KEY) — makes the open ACE-Step the default singer
     *  (owner order 2026-07-19, superseding the fal removal of 2026-07-11). */
    falAvailable?: boolean;
  }
): { engine: string; wallSubstituted: boolean; unavailableReason?: string } {
  const replicateAvailable = opts.replicateAvailable ?? false;
  const falAvailable = opts.falAvailable ?? !!process.env.FAL_KEY;
  const ownEngineFirst = opts.ownEngineFirst ?? process.env.OWN_ENGINE_FIRST === '1';
  // THE PROVEN ENGINE LEADS. The Jul-13 rewrite hardcoded eleven above
  // minimax while the deploy was frozen, so the preference shipped untested —
  // first live contact (2026-07-16) was a plan-locked 402 on an account whose
  // key was only ever provisioned for VOICE features, dead-ending every take
  // while the engine that sang the owner's entire catalog sat ready. Per this
  // file's own doctrine ("quality rankings belong to the measured bake-off,
  // not hardcoded vendor claims"): minimax holds the standard route until a
  // bake-off measures otherwise; eleven remains an explicit pick.
  // OWN MODEL FIRST when the flag is on — our own engine is the default customer
  // render path (still resellable + rights-clean by construction). Falls through
  // to the rented engines only when own-first is off.
  // BAKE-OFF VERDICT (owner's ear, 2026-07-19 evening — supersedes the same
  // morning's fal-default order): tuned ACE-Step passed the lyric gate but the
  // owner judged the sound "terrible — no beats, no drums, scattered", so
  // minimax holds the default singer again. ACE-Step remains available for
  // explicit picks (dual-route below) and as the last-resort default when no
  // replicate/eleven route exists. SONG_ENGINE / explicit requests still win.
  const bestResellable = ownEngineFirst
    ? 'own_engine'
    : replicateAvailable
      ? 'minimax'
      : opts.elevenAvailable
        ? 'eleven'
        : falAvailable
          ? 'ace_step'
          : 'unavailable';
  const normalizedRequested = requested === 'replicate' ? 'minimax' : requested;
  const wanted = normalizedRequested && normalizedRequested !== 'auto'
    ? normalizedRequested
    : opts.sunoAvailable && opts.firstParty
      ? 'suno'
      : bestResellable;
  if (wanted === 'suno' && !opts.firstParty) {
    return bestResellable === 'unavailable'
      ? { engine: 'unavailable', wallSubstituted: true, unavailableReason: 'no customer-safe music engine is configured' }
      : { engine: bestResellable, wallSubstituted: true };
  }
  if (wanted === 'suno' && !opts.sunoAvailable) {
    return { engine: 'unavailable', wallSubstituted: false, unavailableReason: 'the selected flagship engine is not connected' };
  }
  if (wanted === 'eleven' && !opts.elevenAvailable) {
    return { engine: 'unavailable', wallSubstituted: false, unavailableReason: 'the selected standard engine is not connected' };
  }
  // ace_step is dual-route (fal OR replicate) — either connection satisfies it.
  if (wanted === 'ace_step' && !replicateAvailable && !falAvailable) {
    return { engine: 'unavailable', wallSubstituted: false, unavailableReason: 'the selected standard engine is not connected' };
  }
  if (['minimax', 'minimax_ref', 'replicate'].includes(wanted) && !replicateAvailable) {
    return { engine: 'unavailable', wallSubstituted: false, unavailableReason: 'the selected standard engine is not connected' };
  }
  return { engine: wanted, wallSubstituted: false };
}

/**
 * First-party = our own releases. Internal single-owner mode is first-party by
 * definition (the sole workspace IS the operator); once real auth lands, only
 * workspaces listed in FIRST_PARTY_WORKSPACE_IDS keep bridge access.
 */
export function isFirstPartyWorkspace(workspaceId: string, env: Record<string, string | undefined> = process.env): boolean {
  if ((env.AUTH_MODE ?? 'internal') === 'internal') return true;
  return (env.FIRST_PARTY_WORKSPACE_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(workspaceId);
}

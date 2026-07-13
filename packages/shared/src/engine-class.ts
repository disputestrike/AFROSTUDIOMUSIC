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
  }
): { engine: string; wallSubstituted: boolean; unavailableReason?: string } {
  const replicateAvailable = opts.replicateAvailable ?? false;
  const bestResellable = opts.elevenAvailable
    ? 'eleven'
    : replicateAvailable
      ? 'minimax'
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
  if (['minimax', 'ace_step', 'minimax_ref', 'replicate'].includes(wanted) && !replicateAvailable) {
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

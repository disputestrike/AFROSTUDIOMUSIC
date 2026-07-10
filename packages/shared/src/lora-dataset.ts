/**
 * ADDENDUM W-5 — LoRA DATASET PROVENANCE, as an executable check.
 *
 * The dataset builder (Appendix A pipeline) MUST validate every track through
 * this function. Third-party-engine output — especially bridge-origin — is
 * rejected pending legal sign-off (generator ToS commonly restrict using
 * outputs to train models, even where output rights were assigned). This keeps
 * "rights-clean weights" literally true.
 */
export type DatasetTrackOrigin = 'own-master' | 'licensed-catalog' | 'live-session';

const ALLOWED: ReadonlySet<string> = new Set(['own-master', 'licensed-catalog', 'live-session']);

export function validateDatasetTrack(row: { id: string; origin?: string | null }): { ok: boolean; reason?: string } {
  const origin = (row.origin ?? '').trim();
  if (!origin) {
    return { ok: false, reason: `track ${row.id}: MANIFEST row has no origin — every track must declare own-master | licensed-catalog | live-session` };
  }
  if (!ALLOWED.has(origin)) {
    return {
      ok: false,
      reason: `track ${row.id}: origin '${origin}' rejected — third-party-engine output (bridge included) cannot train our weights pending legal sign-off`,
    };
  }
  return { ok: true };
}

/** Validate a whole manifest; the build FAILS with every reason printed. */
export function validateDatasetManifest(rows: Array<{ id: string; origin?: string | null }>): { ok: boolean; rejected: string[] } {
  const rejected = rows.map(validateDatasetTrack).filter((r) => !r.ok).map((r) => r.reason!);
  return { ok: rejected.length === 0, rejected };
}

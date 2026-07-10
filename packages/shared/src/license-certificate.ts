/**
 * ADDENDUM W-3 — LICENSE CERTIFICATES.
 *
 * Certificate payload = license class + terms reference + date + workspace +
 * song + the commercial grant OF THE CLASS. No vendor names, ever (§1.11) —
 * certificates cite a terms reference id, never a backend vendor. Only
 * certified-clean (and 'own') renders are certifiable; 'standard' renders get a
 * pass-through terms statement, never a certificate; bridge ('flagship')
 * renders are NEVER certifiable for customers (W-2 makes them impossible, this
 * asserts it anyway). Never invent indemnity — pass through engine terms.
 */
import type { EngineClass } from './engine-class';

export interface LicenseCertificate {
  certificateId: string;
  songId: string;
  workspaceId: string;
  licenseClass: 'certified-clean' | 'own';
  /** Internal terms-registry id (e.g. 'terms:certified-clean:v1') — resolves to
   *  the actual engine terms in internal docs, never named publicly. */
  termsRef: string;
  issuedAt: string;
  commercialGrant: string;
}

const CLASS_TERMS: Record<string, { termsRef: string; commercialGrant: string }> = {
  'certified-clean': {
    termsRef: 'terms:certified-clean:v1',
    commercialGrant:
      'Commercial use permitted per the engine class terms referenced above (licensed-catalog trained). This certificate passes through those terms; it does not add indemnity.',
  },
  own: {
    termsRef: 'terms:own:v1',
    commercialGrant: 'Rendered on studio-owned composition weights and owned material. Full commercial use.',
  },
};

export function buildLicenseCertificate(opts: {
  songId: string;
  workspaceId: string;
  engineClass: EngineClass;
  issuedAt: string; // caller supplies the timestamp (deterministic/testable)
  certificateId: string;
}): { ok: true; certificate: LicenseCertificate } | { ok: false; reason: string } {
  if (opts.engineClass === 'flagship') {
    return { ok: false, reason: 'bridge renders are never certifiable for customers (first-party releases only)' };
  }
  if (opts.engineClass === 'standard') {
    return { ok: false, reason: 'standard renders carry pass-through terms (terms:standard:v1), not a certificate' };
  }
  const terms = CLASS_TERMS[opts.engineClass];
  if (!terms) return { ok: false, reason: `unknown engine class '${opts.engineClass}'` };
  return {
    ok: true,
    certificate: {
      certificateId: opts.certificateId,
      songId: opts.songId,
      workspaceId: opts.workspaceId,
      licenseClass: opts.engineClass,
      termsRef: terms.termsRef,
      issuedAt: opts.issuedAt,
      commercialGrant: terms.commercialGrant,
    },
  };
}

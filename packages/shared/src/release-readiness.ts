export interface ReleaseReadinessCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CertifiedReleaseAsset {
  approved: boolean;
  qualityState: string;
  contentHash?: string | null;
  verified: boolean;
}

export interface ReleaseReadinessInput {
  audio?: (CertifiedReleaseAsset & { kind: 'master' | 'mix' }) | null;
  cover?: (CertifiedReleaseAsset & { width?: number | null; height?: number | null }) | null;
  lyric?: { present: boolean; approved: boolean; contentHash?: string | null } | null;
  splits: { total: number; count: number; attested: boolean };
  rights: {
    present: boolean;
    hashValid: boolean;
    current: boolean;
    okToExport: boolean;
    risk?: string | null;
  };
  nativeReview: { required: boolean; attested: boolean; languages: string[] };
  hitScore?: number | null;
  hitTarget?: number;
}

function certified(asset: CertifiedReleaseAsset | null | undefined): boolean {
  return !!asset
    && asset.approved
    && asset.qualityState === 'passed'
    && asset.verified
    && /^[a-f0-9]{64}$/i.test(asset.contentHash ?? '');
}

/** The fail-closed release checklist shared by API status and export workers. */
export function evaluateReleaseReadiness(input: ReleaseReadinessInput): {
  ready: boolean;
  checks: ReleaseReadinessCheck[];
} {
  const checks: ReleaseReadinessCheck[] = [];
  checks.push({
    name: 'Certified master or mix',
    ok: certified(input.audio),
    detail: !input.audio
      ? 'missing'
      : certified(input.audio)
        ? input.audio.kind + ' verified'
        : input.audio.kind + ' is not approved, hashed, and QC-passed',
  });

  const coverSquare = !!input.cover
    && Number(input.cover.width ?? 0) >= 1000
    && input.cover.width === input.cover.height;
  checks.push({
    name: 'Approved cover art',
    ok: certified(input.cover) && coverSquare,
    detail: !input.cover
      ? 'missing'
      : certified(input.cover) && coverSquare
        ? String(input.cover.width) + 'x' + String(input.cover.height) + ' source; package renders 3000x3000 RGB JPG'
        : 'needs approval, image QC, and a square source of at least 1000x1000',
  });

  const lyricOk = !!input.lyric?.present
    && input.lyric.approved
    && /^[a-f0-9]{64}$/i.test(input.lyric.contentHash ?? '');
  checks.push({
    name: 'Approved lyrics',
    ok: lyricOk,
    detail: lyricOk ? 'approved and hashed' : 'missing, unapproved, or unhashed',
  });

  const splitTotalOk = input.splits.count > 0 && Math.abs(input.splits.total - 100) < 0.01;
  checks.push({
    name: 'Accepted split-sheet totals 100%',
    ok: splitTotalOk && input.splits.attested,
    detail: String(input.splits.total) + '%' + (input.splits.attested ? ' accepted' : ' not accepted'),
  });

  const rightsOk = input.rights.present
    && input.rights.hashValid
    && input.rights.current
    && input.rights.okToExport
    && input.rights.risk !== 'high'
    && input.rights.risk !== 'unknown';
  checks.push({
    name: 'Current rights receipt',
    ok: rightsOk,
    detail: rightsOk
      ? (input.rights.risk ?? 'clear') + ' risk; receipt hash verified'
      : 'missing, stale, tampered, unavailable, or not cleared',
  });

  checks.push({
    name: 'Native-language review',
    ok: !input.nativeReview.required || input.nativeReview.attested,
    detail: input.nativeReview.required
      ? input.nativeReview.attested
        ? 'attested for ' + input.nativeReview.languages.join(', ')
        : 'required for ' + input.nativeReview.languages.join(', ')
      : 'not required',
  });

  if (input.hitTarget != null) {
    const score = input.hitScore ?? 0;
    checks.push({
      name: 'Will it hit? score >= ' + String(input.hitTarget),
      ok: input.hitScore != null && score >= input.hitTarget,
      detail: input.hitScore == null ? 'not measured' : String(score) + '/100',
    });
  }

  return { ready: checks.every((check) => check.ok), checks };
}

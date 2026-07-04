/**
 * Distribution seam. Turning a green-lit release into "live on the platforms"
 * requires a distributor ACCOUNT + API access (a business step, not just code).
 * This is the seam: wire your partner's upload API here and set DISTRIBUTOR +
 * its key. Recommended sequence for Afrobeats: Audiomack (Afro-first discovery)
 * → Boomplay → an aggregator (DistroKid/TuneCore/Believe) for Spotify/Apple.
 *
 * DO NOT build your own DSP delivery — one infringing/undisclosed-AI track can
 * ban the whole account. Go through a partner.
 */
export interface DistributeRelease {
  title: string;
  artist: string;
  genre?: string | null;
  isrc?: string | null;
  upc?: string | null;
  audioUrl: string | null;
  coverUrl?: string | null;
}

export interface DistributeResult {
  status: 'submitted' | 'not_configured' | 'failed';
  provider: string;
  message: string;
  externalId?: string;
}

export async function distributeRelease(rel: DistributeRelease): Promise<DistributeResult> {
  const provider = (process.env.DISTRIBUTOR ?? '').toLowerCase();
  const key = process.env.AUDIOMACK_API_KEY || process.env.DISTRIBUTOR_API_KEY;

  if (!provider || !key) {
    return {
      status: 'not_configured',
      provider: provider || 'none',
      message:
        'Distribution needs a distributor account + API keys. Recommended: Audiomack first (Afro-first), then Boomplay, then an aggregator (DistroKid/TuneCore/Believe) for Spotify/Apple. Set DISTRIBUTOR + its API key to go live — your release bundle (audio, cover, ISRC/UPC, split-sheet, AI-disclosure) is already in the shape distributors need.',
    };
  }
  if (!rel.audioUrl) {
    return { status: 'failed', provider, message: 'No master/mix to distribute.' };
  }

  // Partner upload API integration drops in here once your distributor account
  // is approved and you have their contract.
  return {
    status: 'not_configured',
    provider,
    message: `The ${provider} adapter is stubbed — plug the partner upload call in here once your distributor account is live.`,
  };
}

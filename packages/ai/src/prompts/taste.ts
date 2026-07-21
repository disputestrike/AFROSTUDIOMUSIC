import type { ArtistDna } from '@afrohit/shared';

export const TASTE_SYSTEM = `You are the A&R (taste engine) for AfroHits Studio.
Score the supplied items on these dimensions (0-10, higher is better):
- hookMemorability — how singable/repeatable
- firstEightSeconds — does it land fast
- chorusSimplicity — could a child sing it back
- languageAuthenticity — is the language mix natural, not faked
- danceability — body-moving energy
- replayValue — would you replay it
- uniqueness — does it have a fingerprint
- emotionalClarity — one clear feeling
- tikTokLoopQuality — does it loop well for short-form
- platformFit — radio/club/playlist/TikTok readiness

Also estimate these risks (0-1, higher is worse):
- similarityRisk — feels too close to a known song
- tooAiRisk — generic, AI-flavored, soulless

Then compute an overall score (0-10) using the average of the positive dimensions, minus 2 × similarityRisk, minus 1.5 × tooAiRisk, clamped to [0, 10].

Output ONLY JSON:
{
  "scores": [
    {
      "id": "string — echo back",
      "dimensions": { "hookMemorability": 8.4, ... all 10 dims ... },
      "overall": 8.1,
      "similarityRisk": 0.1,
      "tooAiRisk": 0.2,
      "notes": "one-sentence reason"
    }
  ]
}`;

export function tasteUserPrompt(opts: {
  artist: ArtistDna;
  items: Array<{ id: string; text: string; kind: 'hook' | 'lyric' | 'snippet' }>;
}): string {
  return JSON.stringify({
    task: 'score these items as an Afro-fusion A&R',
    artist_dna: {
      lane: opts.artist.laneSummary,
      languages: opts.artist.languages,
      forbiddenStyles: opts.artist.forbiddenStyles,
    },
    items: opts.items,
  });
}

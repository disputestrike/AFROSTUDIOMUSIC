import type { ArtistDna, Brief } from '@afrohit/shared';

/**
 * A&R Director — Claude's role in the multi-model pipeline.
 * GPT writes for breadth; Claude judges and refines for taste + authenticity.
 * This is the convergent, quality-gating half of the secret sauce.
 */
export const AR_DIRECTOR_SYSTEM = `You are a world-class Afrobeats / Afro-fusion A&R director and topline editor — think the ear behind Wizkid, Rema, Tems records. You are RUTHLESS about taste and cultural authenticity.

You receive DRAFT hooks from a fast writer, plus the artist's DNA and their taste history. Your job:
1. CUT clichés and generic filler HARD. Kill Western pop shorthand ("baby girl", "shawty") AND the overused Afrobeats fillers: "we dey shine", "no be lie", "I dey glow", "shine like a star", "no dulling", "we dey rise", "party don start", "make we jam", "hustle hard", "we dey vibe", bare "vibe/vibes/energy". If a draft leans on these, REWRITE it fresh and specific or drop it. Demand distinct ideas — no near-duplicate hooks.
2. VERIFY the Yoruba / Igbo / Hausa / Pidgin is REAL and idiomatic — not fake or machine-translated. If a line's heritage language is wrong or uncertain, either fix it or set needsNativeReview true.
3. REWRITE weak hooks so they land harder in the first 8 seconds, sing easier, and loop for short-form. Keep the ones that are already strong.
4. LEARN from taste history: pull toward what the artist APPROVED, away from what they REJECTED.
5. SCORE each hook 0-10 on overall hit potential, and RANK them best-first.
6. Give a one-line A&R reason for each score (what works / what you changed).

Be honest — most drafts are 5-7s; reserve 8+ for genuinely special. Return the FULL set, refined and ranked.

Output ONLY JSON (no prose, no markdown):
{
  "hooks": [
    { "text": "refined hook (1-4 lines)", "language": ["pcm","yo"], "score": 8.2,
      "reason": "why it scores / what you fixed", "needsNativeReview": false }
  ]
}`;

export function arDirectorUserPrompt(opts: {
  artist: ArtistDna;
  brief?: Brief;
  drafts: string[];
  tasteMemory?: { approvedExamples: string[]; rejectedExamples: string[] };
  trends?: string;
  /** Genre Sound-DNA brief — judge hooks for lane/pocket accuracy, not just catchiness. */
  soundDna?: string;
}): string {
  return JSON.stringify({
    task: 'critique, refine, score and rank these draft hooks as the A&R director',
    GENRE_SOUND_DNA: opts.soundDna || undefined,
    TRENDING_NOW: opts.trends || undefined,
    artist: {
      stageName: opts.artist.stageName,
      lane: opts.artist.laneSummary,
      languages: opts.artist.languages,
      tone: opts.artist.vocalTone,
      bannedPhrases: [...(opts.artist.cornyBanned ?? []), ...(opts.artist.forbiddenStyles ?? [])],
      approvedSlang: opts.artist.slang ?? [],
    },
    brief: opts.brief ?? {},
    taste_memory: opts.tasteMemory
      ? {
          artist_APPROVED_these_pull_toward: opts.tasteMemory.approvedExamples,
          artist_REJECTED_these_avoid: opts.tasteMemory.rejectedExamples,
        }
      : undefined,
    draft_hooks: opts.drafts,
  });
}

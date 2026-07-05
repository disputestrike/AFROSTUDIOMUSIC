/**
 * Prompts for the Hook Lab.
 *
 * Design principles we encode into the system prompt:
 *  - Hooks must land before second 8.
 *  - 1-2 simple, repeatable phrases.
 *  - Call-and-response is a bonus.
 *  - Language blend per artist DNA. NO fake Yoruba/Igbo/Hausa/Pidgin.
 *  - Reference *lanes*, never clone artists.
 *  - Reject the artist's banned/corny list.
 *  - Output strict JSON for downstream parsing.
 */

import type { ArtistDna, Brief } from '@afrohit/shared';

export const HOOK_SYSTEM = `You are an Afro-fusion hook writer for artists in West Africa and the diaspora.
You write hooks that are:
- simple and repeatable (a child should be able to sing them after one play)
- emotionally clear (one feeling per hook)
- punchy in the first 8 seconds
- danceable, often with call-and-response
- linguistically authentic to the requested language mix (Yoruba, Igbo, Hausa, Nigerian Pidgin, English)
You reference *style lanes* (e.g. "smooth/pocket like Wizkid lane") but you NEVER copy melodies, lyrics, or signature phrases of other artists.
You never use cliché Western pop shorthand ("baby girl", "shawty", "lit fr") unless explicitly approved.
You never fake a language you do not know — if uncertain in Yoruba/Igbo/Hausa, you mark the line "needs native review" rather than guess.

FRESHNESS IS NON-NEGOTIABLE (this is what separates a hit from generic AI filler):
- Every hook must be DISTINCT — a different image, angle, or story. Never write many variations of the same idea.
- BAN these overused Afrobeats fillers (unless the artist explicitly asks): "we dey shine", "no be lie", "I dey glow", "shine like a star", "shine bright", "no dulling", "we dey rise", "party don start", "make we jam", "hustle hard", "to the moon", "we dey vibe", and bare "vibe / vibes / energy" as a payoff.
- Prefer concrete, sensory, specific images and real Nigerian street detail (places, food, slang, moments) over generic affirmations.
- Write like a top-tier songwriter, not a caption generator. Surprise, specificity, and a real emotional turn beat repetition.
- If TRENDING_NOW context is provided, make the hooks feel current to it (the sounds, slang, and themes popping right now) — capture the wave WITHOUT copying anyone's lyrics.

You output ONLY valid JSON in this shape:
{
  "hooks": [
    {
      "text": "string — 1-4 lines of hook",
      "language": ["pcm","yo"],
      "bpm": 103,
      "syllablePattern": "string optional",
      "melodyNotes": "string optional — e.g. 'descending 5-note motif'",
      "callResponse": true
    }
  ]
}
No prose. No markdown. JSON only.`;

export function hookUserPrompt(opts: {
  artist: ArtistDna;
  brief?: Brief;
  count: number;
  exclude?: string[];
  /** Taste-memory feedback loop: real examples the artist approved/rejected. */
  tasteMemory?: { approvedExamples: string[]; rejectedExamples: string[] };
  /** Live trend digest (Tavily) so hooks feel current to what's popping now. */
  trends?: string;
  /** Genre Sound-DNA brief so hooks fit the lane's pocket/arrangement. */
  soundDna?: string;
}): string {
  const { artist, brief, count, exclude, tasteMemory, trends, soundDna } = opts;
  const refs = artist.references?.map((r) => `${r.name} lane (${r.lane})`).join(', ') ?? 'none';
  const banned = [...(artist.cornyBanned ?? []), ...(artist.forbiddenStyles ?? [])];
  return JSON.stringify({
    task: `generate ${count} hooks`,
    artist: {
      stageName: artist.stageName,
      tone: artist.vocalTone,
      languages: artist.languages,
      lane: artist.laneSummary,
      references_only_for_lane_NOT_clone: refs,
      bannedPhrases: banned,
      approvedSlang: artist.slang ?? [],
    },
    brief: brief ?? {},
    exclude_text_starting_with: exclude ?? [],
    GENRE_SOUND_DNA: soundDna || undefined,
    TRENDING_NOW: trends || undefined,
    banned_overused_cliches: [
      'we dey shine', 'no be lie', 'I dey glow', 'shine like a star', 'shine bright',
      'no dulling', 'we dey rise', 'party don start', 'make we jam', 'hustle hard',
      'to the moon', 'we dey vibe', 'my vibe', 'like a star',
    ],
    taste_memory: tasteMemory
      ? {
          hooks_the_artist_APPROVED_write_more_like_these: tasteMemory.approvedExamples,
          hooks_the_artist_REJECTED_never_write_like_these: tasteMemory.rejectedExamples,
        }
      : undefined,
    rules: [
      'Land the hook before second 8 of the chorus.',
      'Use the requested language mix proportionally.',
      'No imitations of other artists. Lanes only.',
      'Mark uncertain Yoruba/Igbo/Hausa with "needs_native_review": true.',
      'Each hook must be 1-4 lines max.',
      'Learn from taste_memory: converge on approved patterns, avoid rejected ones.',
      'EVERY hook must be DISTINCT — different image/angle/story. No near-duplicates.',
      'Do NOT use any phrase in banned_overused_cliches. Write fresh, specific, sensory lines.',
      'If TRENDING_NOW is present, reflect the current wave (sound/slang/themes) without copying anyone.',
      'If GENRE_SOUND_DNA is present, make hooks that sit in that pocket/arrangement and cadence — phrasing, rhythm, and imagery must fit the lane, not generic pop.',
    ],
  });
}

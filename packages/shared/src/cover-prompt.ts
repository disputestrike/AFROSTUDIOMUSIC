/**
 * AI SONG-COVER PROMPT (identity wave, 2026-07-20).
 *
 * Builds a PHOTOREALISTIC cover-art prompt from facts the song already owns —
 * title, genre, mood — and NOTHING that could resolve to a real person.
 *
 * THE LIKENESS LAW (same doctrine as the video storyboard + own-face
 * likeness pipeline): no real-person likeness, ever. Celebrity/artist names
 * are STRIPPED from the title text before it reaches the prompt, "in the
 * style of X" framings are removed wholesale, and the prompt itself pins
 * "no real person's likeness, no celebrity lookalike". Pure and shared so
 * the API route and the tests exercise the exact same law.
 */

/**
 * Known-name blocklist. Deliberately biased toward the artists an Afrobeats
 * catalog will actually name-drop plus global A-listers. This is a tripwire,
 * not a census — the generic "in the style of …" strip below catches the
 * long tail regardless of who is named.
 */
const CELEBRITY_NAMES = [
  // Afrobeats / African
  "wizkid", "davido", "burna boy", "tems", "asake", "rema", "ayra starr",
  "tiwa savage", "olamide", "omah lay", "fireboy dml", "fireboy", "ckay",
  "kizz daniel", "yemi alade", "flavour", "phyno", "zlatan", "naira marley",
  "adekunle gold", "joeboy", "ruger", "bnxn", "seyi vibez", "shallipopi",
  "tyla", "black coffee", "master kg", "focalistic", "uncle waffles",
  "diamond platnumz", "sarkodie", "black sherif", "stonebwoy", "shatta wale",
  "fela kuti", "fela", "king sunny ade", "2baba", "2face", "p-square", "psquare",
  // Global
  "beyonce", "beyoncé", "rihanna", "drake", "jay-z", "jay z", "kanye west",
  "kanye", "kendrick lamar", "taylor swift", "ariana grande", "billie eilish",
  "justin bieber", "the weeknd", "chris brown", "nicki minaj", "cardi b",
  "doja cat", "sza", "usher", "michael jackson", "bob marley", "ed sheeran",
  "dua lipa", "bad bunny", "travis scott", "future", "21 savage", "j balvin",
  "shakira", "adele", "bruno mars", "post malone", "snoop dogg", "eminem",
  "lil wayne", "megan thee stallion", "summer walker", "victony", "lojay",
] as const;

const STYLE_OF_PATTERN =
  /\b(?:in|after)\s+the\s+style\s+of\s+[^,.;:!?]+|\bstyle\s+of\s+[A-Z][^,.;:!?]*|\b(?:like|ft\.?|feat\.?|featuring|x)\s+[A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,2}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip celebrity names + "style of / featuring X" framings from free text.
 * Returns the cleaned text and the list of removals so callers (and tests)
 * can PROVE what was dropped instead of trusting that something was.
 */
export function stripCelebrityReferences(text: string): {
  cleaned: string;
  stripped: string[];
} {
  const stripped: string[] = [];
  let cleaned = text;

  for (const name of CELEBRITY_NAMES) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
    if (pattern.test(cleaned)) {
      stripped.push(name);
      cleaned = cleaned.replace(pattern, " ");
    }
  }
  // Kill whole "in the style of …", "feat. X", "like Wizkid" framings — the
  // long tail no blocklist can enumerate. Capitalized-name heuristic only, so
  // ordinary lyrics ("like fire") survive.
  cleaned = cleaned.replace(STYLE_OF_PATTERN, match => {
    stripped.push(match.trim());
    return " ";
  });

  cleaned = cleaned.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  return { cleaned, stripped };
}

const GENRE_SCENES: Record<string, string> = {
  afrobeats:
    "golden-hour Lagos rooftop, warm haze, string lights, silhouetted dancers",
  afro_fusion:
    "neon-washed night market, wet asphalt reflections, cinematic depth of field",
  amapiano:
    "late-night lounge, amber club light through smoke, log-drum speaker stacks",
  afro_dancehall:
    "beachside sound-system party at dusk, palm silhouettes, festival strobes",
  gospel:
    "sunrise over an open-air choir stage, light rays through morning mist",
  afro_rnb:
    "moody indigo studio interior, rain-streaked window, soft tungsten glow",
  street_pop:
    "danfo-yellow street corner at night, sodium lamps, motion-blurred crowd",
  hip_hop:
    "underground car-park cypher, hard single-source light, chain-link shadows",
};

export type CoverPromptInput = {
  title: string;
  genre: string;
  mood?: string | null;
};

export type CoverPromptResult = {
  /** The full provider-ready prompt. */
  prompt: string;
  /** Names/framings removed from the inputs — provenance for the receipt. */
  stripped: string[];
};

/**
 * The prompt itself. Photorealistic by construction; identity-safe by
 * construction (inputs stripped, negatives pinned, faceless staging).
 */
export function buildPhotorealisticCoverPrompt(
  input: CoverPromptInput
): CoverPromptResult {
  const title = stripCelebrityReferences(input.title ?? "");
  const mood = stripCelebrityReferences(input.mood ?? "");
  const genreKey = (input.genre ?? "").toLowerCase().trim();
  const scene = GENRE_SCENES[genreKey] ?? GENRE_SCENES.afrobeats!;
  const genreLabel = genreKey.replace(/_/g, " ") || "afrobeats";

  const parts = [
    `Photorealistic album cover photograph for a ${genreLabel} record` +
      (title.cleaned ? ` titled "${title.cleaned.slice(0, 80)}"` : ""),
    mood.cleaned ? `mood: ${mood.cleaned.slice(0, 120)}` : null,
    scene,
    "shot on a full-frame camera, 50mm lens, shallow depth of field, natural skin tones, rich color grade, square 1:1 composition",
    // THE LIKENESS LAW — pinned into every prompt, not left to the caller.
    "any people appear anonymous: turned away, silhouetted, or out of focus",
    "no real person's likeness, no celebrity lookalike, no recognizable face of any real artist",
    "no text, no lettering, no watermark, no logo",
  ].filter(Boolean);

  return {
    prompt: parts.join(". ") + ".",
    stripped: [...title.stripped, ...mood.stripped],
  };
}

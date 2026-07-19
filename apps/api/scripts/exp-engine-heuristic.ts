/**
 * READ-ONLY EXPERIMENT — the music engine's decision path, run on the REAL
 * production functions (no reimplementation). Mirrors the GOVSURE RFP head-to-
 * head: characterize where the rigid table-lookup engine matches vs. collapses,
 * on the input surface users ACTUALLY use (chat box / free text / pasted vibe),
 * and capture exactly what the black-box render model is handed.
 *
 * This file is the HEURISTIC runner (today's engine). Its JSON output is scored
 * against ground truth and against an LLM "reader" in the companion workflow.
 * Nothing here is committed to the engine; it only READS the production code.
 */
import { genreSignature } from '../../../packages/shared/src/genre-signatures';
import { getGenreKit, synthKitFor } from '../../../packages/shared/src/genre-kits';
import { getSoundDNA, soundBrief } from '../../../packages/ai/src/sound-dna/index';
import { composeStyleTags } from '../../../packages/ai/src/providers/music';
import { GENRES } from '../../../packages/shared/src/constants';

// The fallback literal the LIVE MiniMax path uses when identity collapses
// (music.ts composeStyleTags call site, withVocals branch).
const FALLBACK_LITERAL = 'catchy, melodic vocals, radio-ready';

type Req = {
  id: string;
  /** What the user TYPES in chat / paste — the real input surface. */
  userText: string;
  /** The genre STRING the engine most plausibly receives from that input
   *  (there is no free-text→enum normalizer, so the chat LLM emits a word). */
  genreString: string;
  mood?: string;
  explicitBpm?: number;
  fusion?: string[];
  /** Objective ground truth for scoring. */
  truth: { canonicalGenre: string; note: string };
};

// Corpus — realistic chat-box requests, incl. the known breakers and task #36.
const CORPUS: Req[] = [
  { id: 'D1-wedeyride', userText: 'make me a lo-fi joint about riding through the city late at night, chilled and moody', genreString: 'lo-fi', mood: 'moody', truth: { canonicalGenre: 'lofi', note: 'canonical key is "lofi" — "lo-fi" misses' } },
  { id: 'D2-amapiano-cap', userText: 'I want an Amapiano groove, soulful and spacious', genreString: 'Amapiano', mood: 'soulful', truth: { canonicalGenre: 'amapiano', note: 'capitalization miss' } },
  { id: 'D3-drill-aggr', userText: 'hard aggressive UK drill, menacing, for the streets', genreString: 'UK drill', mood: 'aggressive', truth: { canonicalGenre: 'drill', note: '"UK drill" alias' } },
  { id: 'D4-drill-chill', userText: 'chilled, reflective drill — same energy but sad and introspective', genreString: 'drill', mood: 'chill sad', truth: { canonicalGenre: 'drill', note: 'mood contrast vs D3 (same genre)' } },
  { id: 'D5-usrap', userText: 'a US rap / hip hop track, boom bap, confident', genreString: 'hip hop', mood: 'confident', truth: { canonicalGenre: 'hip_hop', note: 'task #36: label US rap as rap, NOT forced Afro; "hip hop" misses "hip_hop"' } },
  { id: 'D6-afrornb', userText: 'smooth afro r&b, intimate and romantic', genreString: 'afro r&b', mood: 'romantic', truth: { canonicalGenre: 'afro_rnb', note: 'natural spelling miss' } },
  { id: 'D7-afrohouse', userText: 'four-on-the-floor afro house, hypnotic and tribal', genreString: 'afro house', mood: 'hypnotic', truth: { canonicalGenre: 'afro_house', note: 'space-vs-underscore miss' } },
  { id: 'D8-fusion', userText: 'blend amapiano with drill — log drum bounce but dark and menacing', genreString: 'amapiano', mood: 'dark', fusion: ['drill'], truth: { canonicalGenre: 'amapiano', note: 'fusion intent from free text' } },
  { id: 'D9-explicit', userText: 'afrobeats at exactly 120 bpm, upbeat and joyful', genreString: 'afrobeats', mood: 'joyful', explicitBpm: 120, truth: { canonicalGenre: 'afrobeats', note: 'explicit bpm=120 must be honored (table says 104)' } },
  { id: 'D10-canonical', userText: 'afrobeats, warm and melodic', genreString: 'afrobeats', mood: 'warm', truth: { canonicalGenre: 'afrobeats', note: 'BEST CASE: canonical string, heuristic should nail it' } },
  { id: 'D11-vibeonly', userText: 'something for a rainy Sunday, warm keys, head-nodding, no genre in mind', genreString: 'something', mood: 'warm', truth: { canonicalGenre: '(reader must infer: lofi/afro_soul/rnb)', note: 'no genre stated — pure vibe' } },
  { id: 'D12-gospel', userText: 'joyful African praise song, organ, call and response, celebratory', genreString: 'praise song', mood: 'joyful celebratory', truth: { canonicalGenre: 'praise', note: '"praise song" vs "praise"' } },
];

const results = CORPUS.map((r) => {
  const g = r.genreString;
  const sig = genreSignature(g);
  const dna = getSoundDNA(g);
  const kit = getGenreKit(g);
  const canonicalDna = getSoundDNA(r.truth.canonicalGenre);
  const canonicalKit = getGenreKit(r.truth.canonicalGenre);

  // what own-engine.ts:410-411 actually computes
  const renderBpm = r.explicitBpm ?? sig.bpm;
  const renderKey = dna?.commonKeys?.[0] ?? 'A minor';
  const resolved = !!kit || !!dna; // did the string hit a real table?

  // dnaTags (mood enters here per musicTags) — this is where "mood" lives
  const brief = soundBrief(g, r.mood);

  // THE PROMPT THE BLACK BOX (MiniMax/Suno) ACTUALLY SEES
  const input: any = {
    genre: g,
    bpm: renderBpm,
    keySignature: renderKey,
    dnaTags: brief.tags ?? [],
    vibePrompt: r.mood ?? '',
    lyrics: 'la la la',
    fusionGenres: r.fusion ?? [],
  };
  const modelPrompt = composeStyleTags(input, { fallbackLiteral: FALLBACK_LITERAL }).join(', ');
  // collapse signal: the identity fell through to the generic literal
  const identityCollapsed = modelPrompt.includes(FALLBACK_LITERAL) && !dna && !kit;

  // MOOD INERTNESS PROBE — same genre, opposite moods, does anything but the
  // trailing "X mood" token change?
  const briefAggr = soundBrief(g, 'aggressive');
  const briefChill = soundBrief(g, 'chill');
  const moodMovedTags =
    JSON.stringify((briefAggr.tags ?? []).filter((t) => !/mood$/.test(t))) !==
    JSON.stringify((briefChill.tags ?? []).filter((t) => !/mood$/.test(t)));
  const moodMovedBpm = false; // bpm never reads mood in this engine (genreSignature has no mood arg)

  return {
    id: r.id,
    userText: r.userText,
    genreStringReceived: g,
    truth: r.truth,
    heuristic: {
      resolved,
      collapsedToGeneric: !resolved,
      renderBpm,
      renderKey,
      kitResolved: !!kit,
      dnaResolved: !!dna,
      synthKit: synthKitFor(g),
      canonicalWouldResolve: !!canonicalKit || !!canonicalDna,
      explicitBpmHonored: r.explicitBpm ? renderBpm === r.explicitBpm : null,
      moodMovedRecipe: moodMovedTags || moodMovedBpm,
      identityCollapsedInModelPrompt: identityCollapsed,
      modelPromptFirst160: modelPrompt.slice(0, 160),
      modelPromptLen: modelPrompt.length,
    },
  };
});

// ── scorecard ────────────────────────────────────────────────────────────────
const n = results.length;
const resolvedCount = results.filter((r) => r.heuristic.resolved).length;
const collapsedButCanonicalWould = results.filter(
  (r) => !r.heuristic.resolved && r.heuristic.canonicalWouldResolve
).length;
const identityLost = results.filter((r) => r.heuristic.identityCollapsedInModelPrompt).length;
const moodInert = results.filter((r) => !r.heuristic.moodMovedRecipe).length;

console.log(JSON.stringify({ results, scorecard: {
  corpusSize: n,
  genreResolved: `${resolvedCount}/${n}`,
  collapsedYetCanonicalWouldHaveResolved: collapsedButCanonicalWould,
  identityLostInModelPrompt: `${identityLost}/${n}`,
  moodInert_recipeUnchangedByMood: `${moodInert}/${n}`,
  canonicalGenreCount: GENRES.length,
} }, null, 2));

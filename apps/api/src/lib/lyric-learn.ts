import { prisma } from '@afrohit/db';
import { generateJson, prompts } from '@afrohit/ai';
import { GENRES } from '@afrohit/shared';

/**
 * LEARN FROM A LYRIC — the data-lake teacher.
 *
 * Benjamin's intent: bring ANY lyrics and the studio LEARNS what makes them
 * work — the flow, the hook mechanics, the structure, the code-switching, the
 * repetition engine — into the library, so every future hook/lyric writes
 * BETTER. This is study, not theft:
 *
 *  LEGAL DOCTRINE (permanent): we store the CRAFT — patterns, structure,
 *  prosody, technique — which are uncopyrightable facts (Feist v. Rural).
 *  We NEVER store the lyrics themselves; stripVerbatim() hard-enforces that
 *  no 6+-word run of the source text survives into the lake.
 */

export interface LyricCraft {
  craftTitle: string;
  genre: string;
  mode: string;
  languages: string[];
  themes: string[];
  structure: string[];
  hookMechanics: string;
  flow: string;
  repetitionEngine: string;
  codeSwitching: string;
  imageryPalette: string;
  adLibStyle: string;
  craftLessons: string[];
}

/**
 * Kill any 6+-word contiguous run of the source that leaked into an output
 * string. Source and output MUST be normalized identically (punctuation →
 * space, re-split, drop empties) — an asymmetry here let em-dashes and
 * hyphenated words smuggle verbatim lines past the guard (found in review).
 */
const normalizeWords = (s: string): string[] =>
  s.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, ' ').split(/\s+/).filter(Boolean);

function stripVerbatim(source: string, text: string): string {
  const words = normalizeWords(source);
  if (words.length < 6) return text;
  const runs = new Set<string>();
  for (let i = 0; i + 6 <= words.length; i++) runs.add(words.slice(i, i + 6).join(' '));
  const lowered = normalizeWords(text);
  for (let i = 0; i + 6 <= lowered.length; i++) {
    if (runs.has(lowered.slice(i, i + 6).join(' '))) return '[patterns only — verbatim removed]';
  }
  return text;
}

function scrub<T>(source: string, value: T): T {
  if (typeof value === 'string') return stripVerbatim(source, value) as T;
  if (Array.isArray(value)) return value.map((v) => scrub(source, v)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrub(source, v)])) as T;
  }
  return value;
}

/**
 * Stable dedupe key for a lyric — the same lyrics studied twice must not
 * create a second lake row (or a second uncharged Claude call).
 */
export function lyricLearnKey(raw: string): string {
  const s = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 0n;
  for (let i = 0; i < s.length; i++) h = (h * 131n + BigInt(s.charCodeAt(i))) % 0xffffffffffffffn;
  return `lyric:learned:${h.toString(36)}`;
}

/** The lake row for these exact lyrics, if they were already studied. */
export async function findLearnedLyric(
  workspaceId: string,
  raw: string
): Promise<{ id: string; recipe: unknown; title: string | null } | null> {
  return prisma.soundReference.findFirst({
    where: { workspaceId, sourceUrl: lyricLearnKey(raw) },
    select: { id: true, recipe: true, title: true },
  });
}

/**
 * Deconstruct raw lyrics into a craft recipe and shelve it in the data lake
 * (SoundReference, sourceUrl 'lyric:learned'). Returns the learned craft +
 * the reference id. Throws only if the model produces nothing usable.
 */
export async function learnLyricCraft(opts: {
  workspaceId: string;
  raw: string;
  genreHint?: string | null;
}): Promise<{ referenceId: string; craft: LyricCraft; alreadyLearned?: boolean }> {
  // Same lyrics twice → same lesson: return the existing row, no second call.
  const existing = await findLearnedLyric(opts.workspaceId, opts.raw);
  if (existing) {
    return { referenceId: existing.id, craft: existing.recipe as unknown as LyricCraft, alreadyLearned: true };
  }
  const modes = prompts.lyricModes().map((m) => `${m.id}: ${m.whenToUse}`).join('\n');
  const out = await generateJson<LyricCraft>({
    tier: 'bulk',
    task: 'lyric-craft-learn',
    system:
      'You are a master songwriting analyst building a CRAFT LIBRARY. Study the lyrics and extract ONLY the craft — techniques, patterns, structure. ' +
      'HARD RULE: never quote, reproduce, or closely paraphrase ANY line; describe every technique abstractly (e.g. "3-syllable chant repeated 4x with call-response echo", never the words themselves). ' +
      // MOST IMPORTANT fields FIRST (craftLessons especially) so they always
      // survive even if the response is cut short.
      'Return strict JSON with these keys IN THIS ORDER: ' +
      'craftTitle (a descriptive name for this STYLE, e.g. "praise-chant devotion with pidgin call-response", never the song title), ' +
      `mode (best-fit lyric success-mode id, one of:\n${modes}\n), ` +
      'craftLessons (4-5 SPECIFIC transferable one-line lessons a writer can APPLY to a brand-new song — this is the most important field, be concrete: what makes the hook stick, how the repetition works, how languages split the work, what imagery field to draw from), ' +
      'hookMechanics (HOW the hook works: syllable shape, repetition count, call-response, melodic contour — abstract, no words), ' +
      'imageryPalette (the FIELD the images come from, e.g. "street hustle + divine favor + luxury markers", never specific lines), ' +
      'codeSwitching (which languages carry which jobs — e.g. emotional lines vs chant vs flex — abstract), ' +
      'repetitionEngine (what repeats at what scale: word/phrase/line/section, and why it compounds), ' +
      'flow (cadence/rhyme density/pocket: where syllables land, line lengths, breath points), ' +
      'adLibStyle (density, placement, vowel shapes), ' +
      `genre (EXACTLY one of: ${GENRES.join(', ')}), ` +
      'languages (ISO-ish codes present, e.g. en/pcm/yo/ig/ha), themes (3-6 short tags), ' +
      'structure (section flow in order, e.g. ["intro-chant","verse","pre-hook","hook","post-hook"]). Return only JSON.',
    user: opts.raw.slice(0, 6000),
    temperature: 0.3,
    maxTokens: 2000,
  });

  // Doctrine enforcement — nothing verbatim reaches the lake — and shape
  // coercion so a sloppy model response can never crash a consumer.
  const scrubbed = scrub(opts.raw, out);
  const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
  const arr = (v: unknown, max = 8) => (Array.isArray(v) ? v.map((x) => str(x, 160)).filter(Boolean).slice(0, max) : []);
  const craft: LyricCraft = {
    craftTitle: str(scrubbed.craftTitle, 140) || 'learned lyric craft',
    genre: str(scrubbed.genre, 40),
    mode: str(scrubbed.mode, 60) || 'experiential_testimony',
    languages: arr(scrubbed.languages),
    themes: arr(scrubbed.themes),
    structure: arr(scrubbed.structure, 12),
    hookMechanics: str(scrubbed.hookMechanics),
    flow: str(scrubbed.flow),
    repetitionEngine: str(scrubbed.repetitionEngine),
    codeSwitching: str(scrubbed.codeSwitching),
    imageryPalette: str(scrubbed.imageryPalette),
    adLibStyle: str(scrubbed.adLibStyle),
    craftLessons: arr(scrubbed.craftLessons, 5),
  };
  // NEVER leave the lessons blank (the visible payoff + what feeds generation).
  // If the model didn't fill them, derive concrete lessons from the craft it DID
  // extract, so the card and the "outdo this" bridge always have something real.
  if (!craft.craftLessons.length) {
    craft.craftLessons = [
      craft.hookMechanics && `Build the hook like this: ${craft.hookMechanics}`,
      craft.repetitionEngine && `Repetition engine: ${craft.repetitionEngine}`,
      craft.codeSwitching && `Split the languages: ${craft.codeSwitching}`,
      craft.imageryPalette && `Draw imagery from: ${craft.imageryPalette}`,
      craft.flow && `Flow/pocket: ${craft.flow}`,
    ]
      .filter((x): x is string => !!x)
      .map((s) => s.slice(0, 160))
      .slice(0, 5);
  }
  const genre = (GENRES as readonly string[]).includes(craft.genre)
    ? craft.genre
    : opts.genreHint && (GENRES as readonly string[]).includes(opts.genreHint)
      ? opts.genreHint
      : 'afrobeats';
  craft.genre = genre;
  if (!craft.craftLessons.length && !craft.hookMechanics) throw new Error('lyric study produced nothing usable — try a longer lyric');

  const summary =
    `LYRIC CRAFT (${craft.mode}): hook — ${craft.hookMechanics}. Flow — ${craft.flow}. ` +
    `Repetition — ${craft.repetitionEngine}. Code-switch — ${craft.codeSwitching}. ` +
    `Imagery field — ${craft.imageryPalette}. Lessons: ${(craft.craftLessons ?? []).join(' | ')}`;

  const ref = await prisma.soundReference.create({
    data: {
      workspaceId: opts.workspaceId,
      genre,
      sourceUrl: lyricLearnKey(opts.raw),
      title: craft.craftTitle,
      summary: summary.slice(0, 2000),
      recipe: { source: 'lyric', ...craft } as never,
      analysisState: 'inferred',
      rightsBasis: 'user-attested',
    },
  });
  return { referenceId: ref.id, craft };
}

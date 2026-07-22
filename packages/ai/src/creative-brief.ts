/**
 * CREATIVE-DIRECTOR LAYER — the "Music Creation Operating System" that runs
 * BEFORE any lyric / theme / concept generation and SETS THE LANE.
 *
 * THE OWNER'S PROBLEM (2026-07-21): "Say 'rap like Drake' and the AI sings about
 * Lagos. Say 'luxury' and it writes romance instead of wealth. It thinks
 * everything is Nigerian music." The BEAT layer already learned this (the deAfro
 * scrub + hip_hop=American recipe in providers/music.ts). This is the WORDS
 * layer: the lyric/concept/hook writers still default to Afro/Nigerian and
 * misread the brief.
 *
 * THE FIX separates FOUR dimensions the writers currently collapse into
 * "Nigerian":
 *   - LANGUAGE controls the WORDS ONLY (an African language legitimately pulls
 *     African context; English does NOT).
 *   - GENRE sets the world/themes (Afrobeats/amapiano/highlife are African;
 *     hip_hop/trap/drill are American/global unless the language says otherwise).
 *   - REGION / CULTURE (Lagos, Pidgin, talking drums, jollof, ethnic identity)
 *     is injected ONLY when the language/genre/influence licenses it, or it is
 *     explicitly requested — NEVER by default, NEVER because a user "usually
 *     likes Afro".
 *   - ARTIST REFERENCE ("like Drake") steers the LANE (structure, flow, feel,
 *     themes, audience) — an ORIGINAL song in that lane, never a clone, never a
 *     different culture injected (voice-clone is separately forbidden; see
 *     reference-steering.ts).
 *
 * MEMORY / PREFERENCE IS CONTEXT, NOT COMMAND: the explicit brief in front of us
 * (genre + language + influence + mood) OVERRIDES any learned "this user likes
 * Nigerian music" default. That is the "context contamination" fix.
 *
 * Pure + deterministic (no LLM, no I/O) so a gate can MEASURE it. Reuses the
 * genre canon (canonicalizeGenre), the never-clone guard (reference-steering)
 * and detectAfricanLanguage — never a second source of truth.
 */
import {
  LANGUAGES,
  canonicalizeGenre,
  foldGenre,
  INFLUENCE_NEVER_CLONE_GUARD,
  influenceDirective,
} from '@afrohit/shared';
import { detectAfricanLanguage } from './african-g2p';

/** Does the WORDS lane come from an African language, plain English, or another
 *  world (French/Portuguese/Spanish/Caribbean/Arabic)? Only an African language
 *  licenses African context by itself. */
export type LanguageMode = 'african-language' | 'english' | 'other';

/** The genre "theme world" a song is written into — each has its OWN theme
 *  vocabulary, so "luxury" means wealth for a rapper and a shared getaway for an
 *  R&B singer, not one flattened default. */
export type GenreFamily =
  | 'rap' // American / global hip-hop, trap, drill
  | 'afro-rap' // Naija/Afro rap & street-pop — African context IS licensed
  | 'afrobeats' // afrobeats / amapiano / highlife / continental Afro-pop
  | 'rnb' // R&B, soul, afro-R&B (relationship-first)
  | 'gospel' // faith / worship / praise
  | 'reggae' // reggae / dancehall (Caribbean)
  | 'latin' // reggaeton / latin pop
  | 'pop' // global pop
  | 'country' // American country
  | 'rock' // rock / alternative
  | 'electronic' // house / EDM
  | 'soul-jazz' // jazz / funk / blues
  | 'lofi'; // lo-fi / chill

/** The explicit lane the writers must follow. This is the object every
 *  downstream prompt (concept, lyric, hook, vocal) reads FIRST. */
export interface CreativeDirectorBrief {
  /** Canonical genre when known, else the folded raw genre. */
  genre: string;
  /** Human-readable genre label ("hip hop", "afro r&b"). */
  genreLabel: string;
  family: GenreFamily;
  languageMode: LanguageMode;
  /** The primary language code driving the words ('en', 'pcm', 'yo', …). */
  primaryLanguage: string;
  primaryLanguageName: string;
  /** Where this record lives culturally ("American / global hip-hop", "West
   *  African", "Latin"). */
  region: string;
  audience: string;
  mood: string | null;
  /** THE decision: may the song reach for African region/culture at all? */
  africanContextLicensed: boolean;
  /** One line stating WHY the licensing decision went the way it did. */
  licensingReason: string;
  /** Themes the writers SHOULD draw from — the genre's own vocabulary, with the
   *  right "luxury" reading folded in when the mood asks for it. */
  includeThemes: string[];
  /** Elements the writers must NOT include unless the brief lists them —
   *  the "what am I NOT being asked to make" self-check, made explicit. Empty
   *  when African context is licensed (the Afrobeats/African-language path). */
  forbiddenElements: string[];
  /** The artist reference, if any (lane steering only, never a clone). */
  influence?: string;
  /** The ready-to-inject instruction block for a generation prompt. */
  directive: string;
}

// ---------------------------------------------------------------------------
// LANGUAGE — the words lane. Only an African language licenses African context.
// ---------------------------------------------------------------------------

/** African-language codes (2- and 3-letter forms + a few plain names). An
 *  African language in the words legitimately pulls West/East/Southern African
 *  context — this is the ONE lane where the culture is implied by the language
 *  itself. Colonial/global languages (English, French, Portuguese) and Latin /
 *  Caribbean / Arabic lanes are deliberately NOT here. */
const AFRICAN_LANG_CODES = new Set<string>([
  'yo', 'yor', 'yoruba',
  'ig', 'ibo', 'igbo',
  'ha', 'hausa',
  'pcm', 'pidgin', 'naija',
  'sw', 'swa', 'swahili',
  'zu', 'zulu',
  'xh', 'xhosa',
  'twi', 'aka', 'akan',
  'st', 'sesotho', 'sotho',
  'tn', 'setswana', 'tswana',
  'tsotsitaal',
  'ln', 'lingala',
  'wo', 'wolof',
  'bm', 'bambara',
  'nouchi',
  'am', 'amharic',
  'kriolu',
  'ef', 'efik', 'edo', 'tiv',
]);
const ENGLISH_CODES = new Set<string>(['en', 'eng', 'english']);

function normLang(code?: string | null): string {
  return (code ?? '').trim().toLowerCase();
}

function classifyLanguageMode(code: string): LanguageMode {
  if (ENGLISH_CODES.has(code)) return 'english';
  if (AFRICAN_LANG_CODES.has(code)) return 'african-language';
  return 'other';
}

/** Coarse cultural region for an African language, so a Pidgin rap reads
 *  "West African" and a Swahili song reads "East African" rather than a blanket
 *  "Nigerian". */
function africanLanguageRegion(code: string): string {
  if (['sw', 'swa', 'swahili', 'am', 'amharic'].includes(code)) return 'East African';
  if (['zu', 'zulu', 'xh', 'xhosa', 'st', 'sesotho', 'sotho', 'tn', 'setswana', 'tswana', 'tsotsitaal'].includes(code))
    return 'Southern African';
  if (['ln', 'lingala'].includes(code)) return 'Central African';
  return 'West African';
}

function languageName(code: string): string {
  const direct = (LANGUAGES as Record<string, string>)[code];
  if (direct) return direct;
  const map: Record<string, string> = {
    yor: 'Yoruba', yoruba: 'Yoruba', ibo: 'Igbo', igbo: 'Igbo', hausa: 'Hausa',
    pidgin: 'Nigerian Pidgin', naija: 'Nigerian Pidgin', swa: 'Swahili', swahili: 'Swahili',
    zulu: 'isiZulu', xhosa: 'isiXhosa', aka: 'Twi', akan: 'Twi', sesotho: 'Sesotho',
    sotho: 'Sesotho', setswana: 'Setswana', tswana: 'Setswana', lingala: 'Lingala',
    wolof: 'Wolof', bambara: 'Bambara', amharic: 'Amharic', eng: 'English', english: 'English',
  };
  return map[code] ?? (code ? code.toUpperCase() : 'English');
}

// ---------------------------------------------------------------------------
// GENRE — the theme world. Afro genres carry African context inherently.
// ---------------------------------------------------------------------------

/** Canonical genres whose WORLD is African — the culture is inherent, so the
 *  Afro/Pidgin/talking-drum vocabulary belongs here by right. Kept in step with
 *  the beat layer's afroIdentity() list (providers/music.ts). Faith genres
 *  (gospel/worship/praise/spiritual) are deliberately NOT here — their context
 *  is set by the language, not the genre (an English gospel song is American
 *  gospel; afro_gospel is the African one). */
const AFRICAN_GENRES = new Set<string>([
  'afrobeats', 'afro_fusion', 'amapiano', 'afro_dancehall', 'street_pop', 'afro_rnb',
  'afro_gospel', 'afro_pop', 'afro_soul', 'afro_hip_hop', 'highlife', 'alte', 'gqom',
  'kwaito', 'afro_house', 'bongo_flava', 'azonto', 'coupe_decale', 'ndombolo', 'soukous',
  'fuji', 'juju', 'apala',
]);

function isAfricanGenre(canonical: string, folded: string): boolean {
  if (AFRICAN_GENRES.has(canonical)) return true;
  // Defensive: any afro-/naija- prefixed genre we don't have a table for.
  return /^(afro|naija)/.test(folded);
}

function genreFamily(canonical: string): GenreFamily {
  if (['afro_hip_hop', 'street_pop'].includes(canonical)) return 'afro-rap';
  if (['hip_hop', 'trap', 'drill'].includes(canonical)) return 'rap';
  if (['rnb', 'afro_rnb', 'soul', 'afro_soul'].includes(canonical)) return 'rnb';
  if (['gospel', 'afro_gospel', 'worship', 'praise', 'spiritual'].includes(canonical)) return 'gospel';
  if (['reggae', 'dancehall'].includes(canonical)) return 'reggae';
  if (['reggaeton', 'latin_pop'].includes(canonical)) return 'latin';
  if (['country'].includes(canonical)) return 'country';
  if (['rock'].includes(canonical)) return 'rock';
  if (['house', 'edm'].includes(canonical)) return 'electronic';
  if (['jazz', 'funk', 'blues'].includes(canonical)) return 'soul-jazz';
  if (['lofi'].includes(canonical)) return 'lofi';
  if (['pop'].includes(canonical)) return 'pop';
  if (
    [
      'afrobeats', 'afro_fusion', 'amapiano', 'afro_dancehall', 'afro_pop', 'alte',
      'gqom', 'kwaito', 'afro_house', 'bongo_flava', 'azonto', 'coupe_decale',
      'ndombolo', 'soukous', 'highlife', 'fuji', 'juju', 'apala',
    ].includes(canonical)
  )
    return 'afrobeats';
  return 'pop'; // unknown genre → broad global pop themes
}

/** Per-family theme vocabulary + the family's own reading of "luxury". This is
 *  the fix for "say luxury and it writes romance": for a rapper luxury is the
 *  measurable win, for an R&B singer it is intimacy, for a gospel song it is
 *  God's provision. */
const FAMILY_THEMES: Record<GenreFamily, { region: string; audience: string; themes: string[]; luxury: string[] }> = {
  rap: {
    region: 'American / global hip-hop',
    audience: 'hip-hop and rap listeners in the US and worldwide',
    themes: [
      'ambition and the come-up from nothing',
      'wealth — money earned, cars, watches, real estate',
      'business moves, investments and ownership',
      'status, respect and success',
      'loyalty and betrayal in the inner circle',
      'outworking the doubters',
      'the streets and survival',
      'legacy and generational wealth',
    ],
    luxury: [
      'wealth — the count, not the flex for its own sake',
      'cars, designer watches and jewelry earned',
      'real estate and property',
      'business ownership and investments',
      'generational wealth and legacy',
      'loyalty inside the circle',
      'the come-up from struggle to the top',
    ],
  },
  'afro-rap': {
    region: 'African street / diaspora rap',
    audience: 'Afro / Naija rap and street audiences',
    themes: [
      'the hustle and the come-up',
      'street respect and survival',
      'money and enjoyment',
      'loyalty to the ones who were there',
      'faith and gratitude inside the grind',
      'city life and the block',
      'flexing a hard-won win',
    ],
    luxury: [
      'big-man money and provision',
      'cars and the good life earned on the come-up',
      'taking care of family and the gang',
      'the flex that says the struggle paid off',
    ],
  },
  afrobeats: {
    region: 'African (Afro-diaspora)',
    audience: 'the Afro / diaspora dancefloor and streaming audience',
    themes: [
      'enjoyment and the good life',
      'love, desire and chemistry',
      'dancing and the dancefloor',
      'self-confidence and swagger',
      'gratitude, faith and blessings',
      'money, success and provision',
      'city nights and celebration',
    ],
    luxury: [
      'big-man success and provision',
      'champagne and the good life',
      'cars, watches and the flex',
      'taking care of your people',
    ],
  },
  rnb: {
    region: 'global R&B',
    audience: 'R&B and late-night listeners',
    themes: [
      'love, relationships and intimacy',
      'desire and attraction',
      'devotion and commitment',
      'longing and distance',
      'heartbreak and making up',
      'vulnerability and honesty',
      'late nights and closeness',
    ],
    luxury: [
      'quiet luxury shared with someone',
      'a getaway for two',
      'slow evenings and fine details',
      'being taken care of, and taking care of them',
    ],
  },
  gospel: {
    region: 'gospel / faith',
    audience: 'the church and gospel audience',
    themes: [
      'faith and trust in God',
      'gratitude and testimony',
      'praise and worship',
      'grace and mercy',
      'deliverance and breakthrough',
      'hope carried through hardship',
    ],
    luxury: [
      'God as the true provider',
      'blessings and favour',
      'gratitude for abundance over material flex',
    ],
  },
  reggae: {
    region: 'Caribbean',
    audience: 'reggae and Caribbean audiences',
    themes: [
      'consciousness and truth',
      'roots and identity',
      'one love and unity',
      'standing firm against pressure',
      'the riddim and the dance',
      'love and devotion',
    ],
    luxury: [
      'living good and free',
      'riches of the spirit over material things',
      'the good life earned honestly',
    ],
  },
  latin: {
    region: 'Latin',
    audience: 'Latin / reggaeton audiences',
    themes: [
      'desire and attraction',
      'dancing all night (perreo)',
      'romance and passion',
      'heartbreak and moving on',
      'the party and the heat',
      'confidence and flex',
    ],
    luxury: [
      'the luxe lifestyle',
      'cars, yachts and nights out',
      'success and the flex',
    ],
  },
  pop: {
    region: 'global pop',
    audience: 'a broad global pop audience',
    themes: [
      'love and heartbreak',
      'self-empowerment and confidence',
      'youth and feeling alive',
      'freedom and escape',
      'friendship and belonging',
    ],
    luxury: [
      'the glamorous life',
      'living your best life',
      'aspirational shine',
    ],
  },
  country: {
    region: 'American country',
    audience: 'country and heartland listeners',
    themes: [
      'home and small-town life',
      'love and heartbreak',
      'family and roots',
      'faith and hard work',
      'the open road',
      'nostalgia',
    ],
    luxury: [
      'the simple good life',
      'land, a home and an honest living',
      'earned comfort',
    ],
  },
  rock: {
    region: 'rock / alternative',
    audience: 'rock and alternative listeners',
    themes: [
      'rebellion and defiance',
      'freedom and escape',
      'love and longing',
      'angst and catharsis',
      'energy and release',
    ],
    luxury: [
      'excess and the rockstar life',
      'the high life on the road',
    ],
  },
  electronic: {
    region: 'global dance / electronic',
    audience: 'club and festival crowds',
    themes: [
      'euphoria and release',
      'the dancefloor and the night',
      'love found on the floor',
      'freedom and letting go',
      'the build and the drop',
    ],
    luxury: [
      'the VIP night',
      'the glamorous party',
      'living for the moment',
    ],
  },
  'soul-jazz': {
    region: 'soul / jazz',
    audience: 'soul and jazz listeners',
    themes: [
      'love and heartache',
      'groove and feeling',
      'hard times and resilience',
      'late nights and longing',
      'joy and release',
    ],
    luxury: [
      'smooth living',
      'fine nights out',
      'earned ease',
    ],
  },
  lofi: {
    region: 'lo-fi / chill',
    audience: 'lo-fi / study-and-chill listeners',
    themes: [
      'calm and introspection',
      'nostalgia and memory',
      'quiet study nights',
      'solitude and reflection',
      'a rainy-day mood',
    ],
    luxury: [
      'simple comforts',
      'slow mornings',
      'quiet ease',
    ],
  },
};

// ---------------------------------------------------------------------------
// INFLUENCE / EXPLICIT REQUEST — the other two ways African context is licensed.
// ---------------------------------------------------------------------------

/** Markers that mean the influence or the free-text brief is ASKING for African
 *  context (so "make it Afrobeats-flavored" or "like Burna" licenses it, while
 *  "like Drake" does not). */
const AFRO_CONTEXT_MARKERS =
  /\b(afro|afrobeat|afrobeats|amapiano|naija|nigeria|nigerian|lagos|ghana|ghanaian|highlife|pidgin|yoruba|igbo|hausa|swahili|azonto|soukous|ndombolo|coupe|fuji|juju|alte|gqom|kwaito|zanku|shaku|gbedu)\b/i;

/** A small, conservative set of Afro/diaspora artist names — a reference to one
 *  of these licenses African context; a reference to a non-African artist
 *  (Drake, Kendrick, The Weeknd) does not. */
const AFRO_ARTISTS = new Set<string>([
  'burna boy', 'burna', 'wizkid', 'davido', 'rema', 'asake', 'tems', 'fireboy',
  'fireboy dml', 'omah lay', 'ckay', 'mr eazi', 'tiwa savage', 'tiwa', 'olamide',
  'fela', 'fela kuti', 'ayra starr', 'ruger', 'joeboy', 'kizz daniel', 'zinoleesky',
  'seyi vibez', 'blaqbonez', 'shallipopi', 'victony', 'adekunle gold', 'simi',
  'patoranking', 'teni', 'yemi alade', 'flavour', 'phyno', 'zlatan', 'naira marley',
  'diamond platnumz', 'sarkodie', 'stonebwoy', 'shatta wale', 'black sherif',
]);

function influenceLicensesAfrican(influence?: string | null): boolean {
  const raw = (influence ?? '').trim().toLowerCase();
  if (!raw) return false;
  if (AFRO_CONTEXT_MARKERS.test(raw)) return true;
  // Match against the artist list (allow "like burna boy", "in the lane of Asake").
  for (const a of AFRO_ARTISTS) if (raw.includes(a)) return true;
  return false;
}

const LUXURY_CUES = /\b(luxur\w*|lavish|opulen\w*|rich(es)?|wealth\w*|flex\w*|money|expensive|designer|drip|balling|baller|high[- ]?life|champagne|billionaire|millionaire)\b/i;

// ---------------------------------------------------------------------------
// The builder.
// ---------------------------------------------------------------------------

export interface CreativeBriefInput {
  genre: string;
  /** Primary language code, OR use `languages` (primary first). */
  language?: string | null;
  languages?: string[] | null;
  /** Artist reference — "like Drake", "in the lane of Asake". Lane steering only. */
  influence?: string | null;
  mood?: string | null;
  /** Free-text brief / theme — scanned for an EXPLICIT African-context request
   *  and for luxury cues. Never used to force Afro by default. */
  themeText?: string | null;
  /** A LEARNED preference / house default ("this artist usually makes Afro").
   *  Recorded for transparency but it CANNOT license African context — the
   *  explicit brief in front of us wins (the context-contamination fix). */
  learnedPreference?: string | null;
}

/**
 * Build the explicit creative-director brief from {genre, language, influence,
 * mood}. This is the layer that stops every song from defaulting to Nigerian.
 */
export function buildCreativeDirectorBrief(input: CreativeBriefInput): CreativeDirectorBrief {
  const folded = foldGenre(input.genre);
  const canonical = canonicalizeGenre(input.genre) ?? folded;
  const genreLabel = (canonical || 'pop').replace(/_/g, ' ');
  const family = genreFamily(canonical);
  const familyDef = FAMILY_THEMES[family];

  const primaryLanguage = normLang(input.languages?.[0] ?? input.language ?? '');
  // Language mode: from the selected code when present. When no language was
  // given, fall back to detectAfricanLanguage over the free-text brief, else
  // infer from the genre (an African genre implies an African-language words
  // lane; everything else defaults to English).
  let languageMode: LanguageMode;
  if (primaryLanguage) {
    languageMode = classifyLanguageMode(primaryLanguage);
  } else if (input.themeText && detectAfricanLanguage(input.themeText)) {
    languageMode = 'african-language';
  } else {
    languageMode = isAfricanGenre(canonical, folded) ? 'african-language' : 'english';
  }

  const africanGenre = isAfricanGenre(canonical, folded);
  const influenceAfro = influenceLicensesAfrican(input.influence);
  const themeAfro = !!input.themeText && AFRO_CONTEXT_MARKERS.test(input.themeText);

  // THE DECISION — African region/culture is licensed iff the genre's world is
  // African, OR the words are in an African language, OR the influence / brief
  // explicitly asks for it. A learned "this user likes Afro" preference is
  // NEVER a licenser (context, not command).
  const africanContextLicensed = africanGenre || languageMode === 'african-language' || influenceAfro || themeAfro;

  const licensingReason = africanContextLicensed
    ? [
        africanGenre ? `${genreLabel} is an African genre` : null,
        languageMode === 'african-language'
          ? `the words are in ${languageName(primaryLanguage) || 'an African language'}`
          : null,
        influenceAfro ? `the reference "${input.influence?.trim()}" is an African/diaspora lane` : null,
        themeAfro ? 'the brief explicitly asks for African context' : null,
      ]
        .filter(Boolean)
        .join('; ')
    : `neither the genre (${genreLabel}), the language (${languageName(primaryLanguage) || 'English'}), the reference nor the brief asks for African context`;

  // REGION — when African context is licensed, reflect the real African region
  // (from the language when we have one, else "African"); otherwise the genre's
  // own region. This is what keeps a Pidgin rap "West African" and an English
  // rap "American / global", never a blanket "Nigerian".
  let region: string;
  if (africanContextLicensed) {
    region =
      languageMode === 'african-language'
        ? africanLanguageRegion(primaryLanguage)
        : africanGenre
          ? familyDef.region
          : 'African';
  } else {
    region = familyDef.region;
  }

  const audience = familyDef.audience;
  const mood = input.mood?.trim() || null;

  // THEMES — the genre's own vocabulary, with the family's LUXURY reading folded
  // in first when the mood/brief signals luxury (so "luxury" + rap = wealth, not
  // romance).
  const luxuryAsked = LUXURY_CUES.test(`${mood ?? ''} ${input.themeText ?? ''}`);
  // When luxury is asked, the family's luxury reading LEADS; append only the
  // base themes whose lead word the luxury list doesn't already cover, so the
  // menu doesn't repeat "wealth …" twice.
  const leadWord = (t: string) => t.toLowerCase().split(/[\s,—-]+/, 1)[0] ?? '';
  const includeThemes = luxuryAsked
    ? (() => {
        const covered = new Set(familyDef.luxury.map(leadWord));
        return [...familyDef.luxury, ...familyDef.themes.filter((t) => !covered.has(leadWord(t)))];
      })()
    : [...familyDef.themes];

  // FORBIDDEN — the "what am I NOT being asked to make" self-check, made
  // explicit. Populated ONLY when African context is NOT licensed. This is what
  // stops the English/rap/pop lanes from defaulting to Lagos/Pidgin/talking
  // drums; when the Afrobeats/African-language path licenses the culture, the
  // list is empty and nothing is blocked.
  const forbiddenElements = africanContextLicensed
    ? []
    : [
        'Lagos, Nigeria, or any African city or country as the setting',
        'Pidgin, Yoruba, Igbo, Hausa, Swahili or other African-language words and slang',
        'Afrobeats / amapiano / African-percussion imagery (log drum, talking drum, shekere, gbedu)',
        'African instruments (talking drum, shekere, kalimba, djembe, agogo)',
        'jollof, suya, danfo, agbada, pepper soup and other African foods/objects as the subject',
        'tribal, ethnic or village identity',
      ];

  const brief: CreativeDirectorBrief = {
    genre: canonical || 'pop',
    genreLabel,
    family,
    languageMode,
    primaryLanguage: primaryLanguage || 'en',
    primaryLanguageName: languageName(primaryLanguage),
    region,
    audience,
    mood,
    africanContextLicensed,
    licensingReason,
    includeThemes,
    forbiddenElements,
    influence: input.influence?.trim() || undefined,
    directive: '', // filled below (needs the assembled fields)
  };
  brief.directive = creativeDirectionBlock(brief, {
    luxuryAsked,
    learnedPreference: input.learnedPreference?.trim() || null,
  });
  return brief;
}

/**
 * The ready-to-inject instruction block. Every downstream prompt reads this
 * FIRST — it sets the lane, lists the themes to write toward, spells out the
 * forbidden elements (or confirms the culture is licensed), carries the
 * artist-reference lane steering WITH the never-clone guard, and states plainly
 * that this brief overrides any learned preference.
 */
export function creativeDirectionBlock(
  brief: CreativeDirectorBrief,
  opts: { luxuryAsked?: boolean; learnedPreference?: string | null } = {},
): string {
  const lines: string[] = [];
  lines.push(
    'CREATIVE DIRECTION (read this before writing a single word — it sets the lane and overrides any house default):',
  );
  lines.push(
    `- Lane: ${brief.genreLabel} in ${brief.primaryLanguageName}, for ${brief.audience}${
      brief.mood ? `, ${brief.mood} in mood` : ''
    }.`,
  );
  lines.push(`- Write about: ${brief.includeThemes.join('; ')}.`);

  if (brief.family === 'rap' || brief.family === 'afro-rap') {
    lines.push(
      '- Luxury here means the measurable win — wealth, cars, watches, real estate, business, investments, loyalty and the come-up from struggle. NOT romance, NOT sensuality, NOT fashion for its own sake.',
    );
  }

  if (brief.influence) {
    lines.push(
      `- Reference lane "${brief.influence}": ${influenceDirective(brief.influence)}. Study the LANE — song-building, flow, emotional approach, production feel, themes, audience — and write an ORIGINAL song in it. Do NOT clone a line, do NOT inject a different culture, and (${INFLUENCE_NEVER_CLONE_GUARD}).`,
    );
  }

  if (brief.forbiddenElements.length) {
    lines.push(
      `- This is NOT an African/Nigerian record. Do NOT reach for (unless the themes above already call for it): ${brief.forbiddenElements.join(
        '; ',
      )}. English words = an English-language song in the genre's own world, not English pop in African costume.`,
    );
  } else {
    lines.push(
      `- African context IS licensed here (${brief.licensingReason}). Pidgin / Yoruba / Igbo / Swahili, the streets, the culture and the local detail belong in this song wherever they carry real feeling — this is the path the writers already know; keep it.`,
    );
  }

  lines.push(
    `- The brief above is the LAW for THIS song. It beats any learned habit or past preference${
      opts.learnedPreference ? ` (including the noted "${opts.learnedPreference}")` : ' (even "this artist usually makes Nigerian / Afro music")'
    } — follow the genre, language and reference in front of you, never the house style.`,
  );

  return lines.join('\n');
}

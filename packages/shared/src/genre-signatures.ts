/**
 * THE GENRE SIGNATURE LIBRARY — what every style MUST have, encoded once,
 * enforced everywhere. Benjamin's instruction verbatim: "every song style has
 * this, this, this... country sounds this way and typically uses this;
 * Afrobeats has drum fills here and there — do it for EVERY category, don't
 * wait for me."
 *
 * Consumed by:
 *  - lane-pipeline (api): `tags` are FRONT-LOADED into every engine brief
 *  - own-engine (worker): `melodyPrompt` steers the conditioned melody layer
 *  - ensureSignatureKits (worker): `kitRoles` is what the shelf must hold
 *  - planFills callers (worker): `fillBars` is the lane's fill cadence
 *  - test-genre-signatures: proves total coverage — no lane ships unspecified
 */

export interface GenreSignature {
  /** The lane's natural tempo — Create auto-sets this on genre pick; fusions blend. */
  bpm: number;
  /** Default language suggestion for the lane (user's touch always wins). */
  languages: string[];
  /** Signature instruments/textures, MOST defining first — engines weight early tags hardest. */
  tags: string[];
  /** Melody-layer brief for the own engine (always ends with "no drums" — the groove owns the drums). */
  melodyPrompt: string;
  /** Which synth roles the genre's owned kit must hold (subset of the synthesizable set). */
  kitRoles: Array<'log_drum' | 'percussion' | 'bass' | 'chords' | 'fill'>;
  /** Fill cadence in bars — "you always hear them" tuned per lane. */
  fillBars: 8 | 16 | 32;
}

const FULL: GenreSignature['kitRoles'] = ['log_drum', 'percussion', 'bass', 'chords', 'fill'];
const CORE: GenreSignature['kitRoles'] = ['percussion', 'bass', 'chords', 'fill'];

export const GENRE_SIGNATURES: Record<string, GenreSignature> = {
  afrobeats: { bpm: 104, languages: ['pcm', 'en'], tags: ['syncopated afrobeats percussion and shakers', 'warm keys and melodic guitar licks', 'rounded melodic bassline', 'talking-drum accents'], melodyPrompt: 'warm keys and sweet melodic guitar licks riding the afrobeats groove, call-and-response phrasing, no drums', kitRoles: FULL, fillBars: 16 },
  afro_fusion: { bpm: 100, languages: ['pcm', 'en'], tags: ['afro-fusion groove', 'lush keys and guitar textures', 'melodic gliding bass'], melodyPrompt: 'lush keys and airy guitar textures blending afro groove with r&b color, no drums', kitRoles: FULL, fillBars: 16 },
  amapiano: { bpm: 112, languages: ['zu', 'en'], tags: ['jazzy sustained piano chords', 'soulful amapiano keys', 'log drum bassline', 'airy shakers'], melodyPrompt: 'soulful jazzy amapiano piano chords, warm rhodes and sustained keys locking to the log-drum groove, no drums', kitRoles: FULL, fillBars: 16 },
  afro_dancehall: { bpm: 100, languages: ['pcm', 'en', 'patois'], tags: ['dancehall bounce percussion', 'synth plucks and horn stabs', 'deep rolling bass'], melodyPrompt: 'bright synth plucks and horn-stab melodies over the dancehall bounce, no drums', kitRoles: FULL, fillBars: 16 },
  street_pop: { bpm: 102, languages: ['pcm', 'yo', 'en'], tags: ['naija street chant energy', 'log-drum-styled bass bounce', 'sparse gritty keys'], melodyPrompt: 'sparse gritty keys and chantable synth hooks with street energy, no drums', kitRoles: FULL, fillBars: 16 },
  afro_rnb: { bpm: 92, languages: ['en', 'pcm'], tags: ['lush rhodes and pads', 'soft afro percussion', 'smooth sub bass'], melodyPrompt: 'lush rhodes chords and soft pads, intimate r&b voicings over the afro pocket, no drums', kitRoles: CORE, fillBars: 32 },
  gospel: { bpm: 100, languages: ['en', 'yo'], tags: ['rich gospel piano and organ', 'choir pad swells', 'walking gospel bass'], melodyPrompt: 'rich gospel piano and Hammond organ, worshipful extended voicings and choir-like swells, no drums', kitRoles: CORE, fillBars: 16 },
  afro_gospel: { bpm: 105, languages: ['en', 'pcm', 'yo'], tags: ['gospel keys and organ over afro groove', 'praise-break percussion energy'], melodyPrompt: 'uplifting gospel keys and organ swells riding an afro praise groove, no drums', kitRoles: FULL, fillBars: 16 },
  afro_pop: { bpm: 102, languages: ['pcm', 'en'], tags: ['bright afro-pop keys', 'clean guitar hooks', 'bouncy melodic bass'], melodyPrompt: 'bright keys and clean guitar hooks, sunny afro-pop melodies, no drums', kitRoles: FULL, fillBars: 16 },
  hip_hop: { bpm: 92, languages: ['en'], tags: ['rap vocals, confident rhythmic flow', '808 sub bass', 'crisp hat rolls', 'sparse dark keys or strings'], melodyPrompt: 'sparse dark piano or string motif with space for the vocal, boom-bap-to-modern color, no drums', kitRoles: CORE, fillBars: 8 },
  highlife: { bpm: 112, languages: ['twi', 'pcm', 'en'], tags: ['interlocking highlife guitar lines', 'horn section color', 'lilting percussion'], melodyPrompt: 'sweet interlocking highlife guitar lines and gentle horn melodies, no drums', kitRoles: CORE, fillBars: 16 },
  reggae: { bpm: 78, languages: ['patois', 'en'], tags: ['offbeat skank guitar and organ', 'one-drop feel', 'deep round bass'], melodyPrompt: 'offbeat skank organ and guitar chops with a warm melodic bassline feel, no drums', kitRoles: CORE, fillBars: 16 },
  pop: { bpm: 116, languages: ['en'], tags: ['bright modern pop synths and keys', 'four-chord harmonic bed', 'punchy melodic bass'], melodyPrompt: 'bright modern synths and piano, big four-chord pop bed with a hooky top line, no drums', kitRoles: CORE, fillBars: 16 },
  rnb: { bpm: 88, languages: ['en'], tags: ['electric piano and silky pads', 'smooth sub bass', 'gentle percussion'], melodyPrompt: 'silky electric piano and pads, smooth contemporary r&b voicings, no drums', kitRoles: CORE, fillBars: 32 },
  dancehall: { bpm: 102, languages: ['patois', 'en'], tags: ['dembow riddim bounce', 'minor-key synth plucks', 'deep riddim bass'], melodyPrompt: 'minor-key synth plucks and riddim melodies over the dembow bounce, no drums', kitRoles: CORE, fillBars: 16 },
  drill: { bpm: 142, languages: ['en'], tags: ['rap vocals, confident rhythmic flow', 'sliding 808 bass', 'dark bell and string motif', 'skittering hat slides'], melodyPrompt: 'dark bells and tense string motif, uk/ny drill mood, minor and menacing, no drums', kitRoles: CORE, fillBars: 8 },
  trap: { bpm: 140, languages: ['en'], tags: ['rap vocals, confident rhythmic flow', 'gliding 808 sub', 'triplet hi-hat rolls', 'eerie bell or pluck lead'], melodyPrompt: 'eerie bells and plucks with wide space, modern trap color, no drums', kitRoles: CORE, fillBars: 8 },
  house: { bpm: 124, languages: ['en'], tags: ['four-on-the-floor pulse', 'classic house piano stabs', 'warm organ bass'], melodyPrompt: 'classic house piano stabs and warm organ chords, uplifting and hypnotic, no drums', kitRoles: CORE, fillBars: 16 },
  edm: { bpm: 128, languages: ['en'], tags: ['supersaw lead stacks', 'sidechained pads', 'riser energy into drops'], melodyPrompt: 'euphoric supersaw leads and sidechained pads building toward the drop, no drums', kitRoles: CORE, fillBars: 8 },
  reggaeton: { bpm: 96, languages: ['es'], tags: ['dembow drive', 'latin pluck melodia', 'deep round perreo bass'], melodyPrompt: 'catchy latin plucks and melodia lines over the dembow drive, no drums', kitRoles: CORE, fillBars: 16 },
  latin_pop: { bpm: 100, languages: ['es', 'en'], tags: ['nylon guitar and bright keys', 'latin percussion color', 'melodic pop bass'], melodyPrompt: 'nylon-string guitar and bright keys with a romantic latin-pop top line, no drums', kitRoles: CORE, fillBars: 16 },
  country: { bpm: 100, languages: ['en'], tags: ['acoustic guitar strum bed', 'fiddle and pedal-steel color', 'live-feel drums and walking bass'], melodyPrompt: 'acoustic guitar strumming with fiddle and pedal-steel color, heartfelt nashville melody, no drums', kitRoles: CORE, fillBars: 32 },
  rock: { bpm: 120, languages: ['en'], tags: ['driving distorted guitars', 'live drum kit energy', 'gritty root-note bass'], melodyPrompt: 'driving electric guitar riffs and power-chord bed with a soaring lead line, no drums', kitRoles: CORE, fillBars: 32 },
  soul: { bpm: 96, languages: ['en'], tags: ['warm rhodes and organ', 'horn section stabs', 'live pocket groove'], melodyPrompt: 'warm rhodes and organ with horn-section stabs, classic soul voicings, no drums', kitRoles: CORE, fillBars: 16 },
};

export function genreSignature(genre?: string | null): GenreSignature {
  return (
    GENRE_SIGNATURES[genre ?? ''] ?? {
      bpm: 106,
      languages: ['en'],
      tags: ['tasteful sustained keys', 'melodic bassline'],
      melodyPrompt: 'tasteful sustained keys and lead lines locking to the groove, no drums',
      kitRoles: CORE,
      fillBars: 16,
    }
  );
}

/** CRAFT LAW — creative complexity demanded of EVERY render, every lane. Tags
 *  the engines weight + the brief line the writers obey. "Weak/simple" is a
 *  construction failure, not taste. */
export const CRAFT_TAGS = [
  'dynamic arrangement with switch-ups every 8 bars',
  'call-and-response between lead and backing vocals',
  'countermelody answering under the hook',
  'bridge flips the energy (strip-back or lift)',
  'instrumental answer-phrases between vocal lines',
] as const;

export const CRAFT_BRIEF =
  'CRAFT LAW: the record must EVOLVE — no section repeats its texture unchanged. Verse 2 differs from verse 1 (new counterline, added layer, or strip-back). The hook gets a countermelody answer. The bridge flips the energy. Ad-libs converse with the lead, never just echo it.';

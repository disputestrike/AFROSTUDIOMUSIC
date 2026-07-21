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

import { genreLookupKey } from './genre-canon';

export interface GenreSignature {
  /** The lane's natural tempo — Create auto-sets this on genre pick; fusions blend. */
  bpm: number;
  /** Target full-song length (s) — measured vs Suno: length was our #1 gap. */
  durationS: number;
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
  afrobeats: { durationS: 185, bpm: 104, languages: ['pcm', 'en'], tags: ['syncopated afrobeats percussion and shakers', 'warm keys and melodic guitar licks', 'rounded melodic bassline', 'talking-drum accents'], melodyPrompt: 'warm keys and sweet melodic guitar licks riding the afrobeats groove, call-and-response phrasing, no drums', kitRoles: FULL, fillBars: 16 },
  afro_fusion: { durationS: 180, bpm: 100, languages: ['pcm', 'en'], tags: ['afro-fusion groove', 'lush keys and guitar textures', 'melodic gliding bass'], melodyPrompt: 'lush keys and airy guitar textures blending afro groove with r&b color, no drums', kitRoles: FULL, fillBars: 16 },
  amapiano: { durationS: 200, bpm: 112, languages: ['zu', 'en'], tags: ['booming log drum sub-bass, deep and prominent', 'jazzy sustained piano chords', 'soulful amapiano keys', 'airy shakers'], melodyPrompt: 'soulful jazzy amapiano piano chords, warm rhodes and sustained keys locking to the log-drum groove, no drums', kitRoles: FULL, fillBars: 16 },
  afro_dancehall: { durationS: 175, bpm: 100, languages: ['pcm', 'en', 'patois'], tags: ['dancehall bounce percussion', 'synth plucks and horn stabs', 'deep rolling bass'], melodyPrompt: 'bright synth plucks and horn-stab melodies over the dancehall bounce, no drums', kitRoles: FULL, fillBars: 16 },
  street_pop: { durationS: 180, bpm: 102, languages: ['pcm', 'yo', 'en'], tags: ['naija street chant energy', 'log-drum-styled bass bounce', 'sparse gritty keys'], melodyPrompt: 'sparse gritty keys and chantable synth hooks with street energy, no drums', kitRoles: FULL, fillBars: 16 },
  afro_rnb: { durationS: 190, bpm: 92, languages: ['en', 'pcm'], tags: ['lush rhodes and pads', 'soft afro percussion', 'smooth sub bass'], melodyPrompt: 'lush rhodes chords and soft pads, intimate r&b voicings over the afro pocket, no drums', kitRoles: CORE, fillBars: 32 },
  gospel: { durationS: 210, bpm: 100, languages: ['en', 'yo'], tags: ['rich gospel piano and organ', 'choir pad swells', 'walking gospel bass'], melodyPrompt: 'rich gospel piano and Hammond organ, worshipful extended voicings and choir-like swells, no drums', kitRoles: CORE, fillBars: 16 },
  worship: { durationS: 240, bpm: 72, languages: ['en', 'yo'], tags: ['flowing worship piano arpeggios', 'gospel organ swells', 'warm choir pads', 'soft late-entering drums'], melodyPrompt: 'flowing worship piano arpeggios with gospel organ swells and warm choir pads, reverent and building, no drums', kitRoles: CORE, fillBars: 32 },
  praise: { durationS: 220, bpm: 122, languages: ['en', 'yo', 'pcm'], tags: ['joyful african praise groove', 'gospel organ stabs and runs', 'shekere sixteenths and congas', 'clap-driven backbeat with call-and-response'], melodyPrompt: 'bright major-key gospel organ runs and piano stabs over a joyful praise groove, call-and-response phrasing, no drums', kitRoles: FULL, fillBars: 8 },
  spiritual: { durationS: 230, bpm: 78, languages: ['en', 'yo', 'sw'], tags: ['hypnotic kalimba pattern', 'earthy udu and soft shaker pulse', 'deep warm sub drone', 'hums and chant textures'], melodyPrompt: 'hypnotic cyclical kalimba and mbira patterns over long warm pads, meditative and sacred, no drums', kitRoles: CORE, fillBars: 32 },
  afro_gospel: { durationS: 195, bpm: 105, languages: ['en', 'pcm', 'yo'], tags: ['gospel keys and organ over afro groove', 'praise-break percussion energy'], melodyPrompt: 'uplifting gospel keys and organ swells riding an afro praise groove, no drums', kitRoles: FULL, fillBars: 16 },
  afro_pop: { durationS: 180, bpm: 102, languages: ['pcm', 'en'], tags: ['bright afro-pop keys', 'clean guitar hooks', 'bouncy melodic bass'], melodyPrompt: 'bright keys and clean guitar hooks, sunny afro-pop melodies, no drums', kitRoles: FULL, fillBars: 16 },
  hip_hop: { durationS: 170, bpm: 92, languages: ['en'], tags: ['rap vocals, confident rhythmic flow', '808 sub bass', 'crisp hat rolls', 'sparse dark keys or strings'], melodyPrompt: 'sparse dark piano or string motif with space for the vocal, boom-bap-to-modern color, no drums', kitRoles: CORE, fillBars: 8 },
  afro_hip_hop: { durationS: 180, bpm: 104, languages: ['pcm', 'yo', 'en'], tags: ['naija sing-rap, code-switched pidgin bars', 'log-drum bounce and swung shaker 16ths', 'bright highlife guitar hook', 'warm gliding 808 bass'], melodyPrompt: 'bright clean highlife-style guitar licks and sparse afro keys riding a log-drum-and-shaker groove, room for the rap, no drums', kitRoles: FULL, fillBars: 16 },
  highlife: { durationS: 190, bpm: 112, languages: ['twi', 'pcm', 'en'], tags: ['interlocking highlife guitar lines', 'horn section color', 'lilting percussion'], melodyPrompt: 'sweet interlocking highlife guitar lines and gentle horn melodies, no drums', kitRoles: CORE, fillBars: 16 },
  reggae: { durationS: 195, bpm: 78, languages: ['patois', 'en'], tags: ['offbeat skank guitar and organ', 'one-drop feel', 'deep round bass'], melodyPrompt: 'offbeat skank organ and guitar chops with a warm melodic bassline feel, no drums', kitRoles: CORE, fillBars: 16 },
  pop: { durationS: 180, bpm: 116, languages: ['en'], tags: ['bright modern pop synths and keys', 'four-chord harmonic bed', 'punchy melodic bass'], melodyPrompt: 'bright modern synths and piano, big four-chord pop bed with a hooky top line, no drums', kitRoles: CORE, fillBars: 16 },
  rnb: { durationS: 195, bpm: 88, languages: ['en'], tags: ['electric piano and silky pads', 'smooth sub bass', 'gentle percussion'], melodyPrompt: 'silky electric piano and pads, smooth contemporary r&b voicings, no drums', kitRoles: CORE, fillBars: 32 },
  dancehall: { durationS: 175, bpm: 102, languages: ['patois', 'en'], tags: ['dembow riddim bounce', 'minor-key synth plucks', 'deep riddim bass'], melodyPrompt: 'minor-key synth plucks and riddim melodies over the dembow bounce, no drums', kitRoles: CORE, fillBars: 16 },
  drill: { durationS: 150, bpm: 142, languages: ['en'], tags: ['rap vocals, confident rhythmic flow', 'sliding 808 bass', 'dark bell and string motif', 'skittering hat slides'], melodyPrompt: 'dark bells and tense string motif, uk/ny drill mood, minor and menacing, no drums', kitRoles: CORE, fillBars: 8 },
  trap: { durationS: 160, bpm: 140, languages: ['en'], tags: ['rap vocals, confident rhythmic flow', 'gliding 808 sub', 'triplet hi-hat rolls', 'eerie bell or pluck lead'], melodyPrompt: 'eerie bells and plucks with wide space, modern trap color, no drums', kitRoles: CORE, fillBars: 8 },
  house: { durationS: 200, bpm: 124, languages: ['en'], tags: ['four-on-the-floor pulse', 'classic house piano stabs', 'warm organ bass'], melodyPrompt: 'classic house piano stabs and warm organ chords, uplifting and hypnotic, no drums', kitRoles: CORE, fillBars: 16 },
  edm: { durationS: 185, bpm: 128, languages: ['en'], tags: ['supersaw lead stacks', 'sidechained pads', 'riser energy into drops'], melodyPrompt: 'euphoric supersaw leads and sidechained pads building toward the drop, no drums', kitRoles: CORE, fillBars: 8 },
  reggaeton: { durationS: 175, bpm: 96, languages: ['es'], tags: ['dembow drive', 'latin pluck melodia', 'deep round perreo bass'], melodyPrompt: 'catchy latin plucks and melodia lines over the dembow drive, no drums', kitRoles: CORE, fillBars: 16 },
  latin_pop: { durationS: 180, bpm: 100, languages: ['es', 'en'], tags: ['nylon guitar and bright keys', 'latin percussion color', 'melodic pop bass'], melodyPrompt: 'nylon-string guitar and bright keys with a romantic latin-pop top line, no drums', kitRoles: CORE, fillBars: 16 },
  country: { durationS: 200, bpm: 100, languages: ['en'], tags: ['acoustic guitar strum bed', 'fiddle and pedal-steel color', 'live-feel drums and walking bass'], melodyPrompt: 'acoustic guitar strumming with fiddle and pedal-steel color, heartfelt nashville melody, no drums', kitRoles: CORE, fillBars: 32 },
  rock: { durationS: 195, bpm: 120, languages: ['en'], tags: ['driving distorted guitars', 'live drum kit energy', 'gritty root-note bass'], melodyPrompt: 'driving electric guitar riffs and power-chord bed with a soaring lead line, no drums', kitRoles: CORE, fillBars: 32 },
  soul: { durationS: 190, bpm: 96, languages: ['en'], tags: ['warm rhodes and organ', 'horn section stabs', 'live pocket groove'], melodyPrompt: 'warm rhodes and organ with horn-section stabs, classic soul voicings, no drums', kitRoles: CORE, fillBars: 16 },
  afro_soul: { durationS: 200, bpm: 90, languages: ['en', 'pcm'], tags: ['warm rhodes over afro percussion', 'soulful guitar licks', 'smooth deep bass'], melodyPrompt: 'warm rhodes chords and soulful guitar licks over a gentle afro pocket, no drums', kitRoles: CORE, fillBars: 32 },
  alte: { durationS: 185, bpm: 96, languages: ['pcm', 'en'], tags: ['dreamy alté guitars and washed synths', 'laid-back off-kilter groove', 'moody warm bass'], melodyPrompt: 'dreamy washed guitars and hazy synths with an off-kilter alté cool, no drums', kitRoles: CORE, fillBars: 16 },
  gqom: { durationS: 200, bpm: 124, languages: ['zu', 'en'], tags: ['dark broken gqom drums', 'hypnotic minimal chant stabs', 'heavy rolling toms'], melodyPrompt: 'dark minimal synth stabs and hypnotic vocal-chant textures, brooding and spacious, no drums', kitRoles: FULL, fillBars: 8 },
  kwaito: { durationS: 210, bpm: 105, languages: ['zu', 'tsotsitaal', 'en'], tags: ['slowed house groove', 'chunky mid-tempo bassline', 'chant-along vocals'], melodyPrompt: 'warm slowed-house keys and chunky synth lines, laid-back township bounce, no drums', kitRoles: FULL, fillBars: 16 },
  afro_house: { durationS: 220, bpm: 122, languages: ['zu', 'en'], tags: ['four-on-the-floor deep house kick', 'tribal african percussion', 'hypnotic synth stabs'], melodyPrompt: 'hypnotic deep-house synth stabs and warm chords over a tribal pulse, no drums', kitRoles: FULL, fillBars: 16 },
  bongo_flava: { durationS: 195, bpm: 100, languages: ['sw', 'en'], tags: ['swahili bongo flava bounce', 'sweet melodic keys and guitar', 'round warm bass'], melodyPrompt: 'sweet East-African keys and melodic guitar over a bongo flava bounce, no drums', kitRoles: CORE, fillBars: 16 },
  azonto: { durationS: 180, bpm: 126, languages: ['twi', 'pcm', 'en'], tags: ['bouncy azonto drums', 'playful synth stabs', 'ghanaian dance energy'], melodyPrompt: 'playful bright synth stabs and highlife-tinged lines with azonto dance energy, no drums', kitRoles: FULL, fillBars: 8 },
  coupe_decale: { durationS: 200, bpm: 128, languages: ['fr', 'nouchi'], tags: ['driving coupé-décalé percussion', 'sparkling guitar loops', 'ivorian club energy'], melodyPrompt: 'sparkling looping guitars and bright synths with ivorian club drive, no drums', kitRoles: FULL, fillBars: 8 },
  ndombolo: { durationS: 210, bpm: 132, languages: ['ln', 'fr'], tags: ['fast ndombolo seben guitars', 'driving congolese drums', 'call-and-response chants'], melodyPrompt: 'fast interlocking seben guitars, joyful and virtuosic congolese lines, no drums', kitRoles: FULL, fillBars: 8 },
  soukous: { durationS: 210, bpm: 120, languages: ['ln', 'fr'], tags: ['sweet soukous lead guitar', 'rumba-rooted groove', 'bubbling bass runs'], melodyPrompt: 'sweet singing soukous lead guitar over a rumba-rooted lilt, no drums', kitRoles: CORE, fillBars: 16 },
  fuji: { durationS: 200, bpm: 110, languages: ['yo'], tags: ['dense yoruba percussion ensemble', 'talking drum conversations', 'call-and-response chants'], melodyPrompt: 'sparse melodic color over a dense yoruba percussion conversation, chant-led, no drums', kitRoles: FULL, fillBars: 8 },
  juju: { durationS: 220, bpm: 104, languages: ['yo', 'en'], tags: ['interlocking jùjú guitars', 'talking drum lead', 'gentle praise-song sway'], melodyPrompt: 'interlocking jùjú guitars and gentle keys with a praise-song sway, no drums', kitRoles: CORE, fillBars: 16 },
  apala: { durationS: 195, bpm: 96, languages: ['yo'], tags: ['rootsy apala percussion', 'sakara drums and agidigbo', 'deep yoruba chant melodies'], melodyPrompt: 'sparse rootsy melodic lines over deep yoruba apala percussion, chant-led, no drums', kitRoles: FULL, fillBars: 16 },
  jazz: { durationS: 220, bpm: 110, languages: ['en'], tags: ['swinging jazz piano comping', 'upright walking bass', 'brushed drum feel'], melodyPrompt: 'swinging jazz piano comping and horn melodies over a walking bass feel, no drums', kitRoles: CORE, fillBars: 32 },
  funk: { durationS: 195, bpm: 104, languages: ['en'], tags: ['tight funk guitar chops', 'slap bass groove', 'punchy horn stabs'], melodyPrompt: 'tight funky guitar chops and punchy horn stabs over a slap-bass pocket, no drums', kitRoles: CORE, fillBars: 16 },
  blues: { durationS: 210, bpm: 84, languages: ['en'], tags: ['gritty blues guitar licks', '12-bar shuffle feel', 'warm organ bed'], melodyPrompt: 'gritty expressive blues guitar licks and warm organ over a 12-bar shuffle, no drums', kitRoles: CORE, fillBars: 32 },
  lofi: { durationS: 180, bpm: 82, languages: ['en'], tags: ['dusty lo-fi keys', 'vinyl crackle warmth', 'mellow head-nod bass'], melodyPrompt: 'dusty mellow lo-fi keys and soft melodic fragments with vinyl warmth, no drums', kitRoles: CORE, fillBars: 32 },
};

export function genreSignature(genre?: string | null): GenreSignature {
  // CANONICALIZE FIRST (audit quick-win 2026-07-19): 'Amapiano'/'UK drill'/
  // 'lo-fi' used to miss and render at the generic 106bpm — the measured 4/12.
  return (
    GENRE_SIGNATURES[genre ?? ''] ??
    GENRE_SIGNATURES[genreLookupKey(genre)] ?? {
      bpm: 106,
      durationS: 180,
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
  'full 6-section architecture (intro, verse, hook, verse 2, bridge, final hook) with switch-ups every 8 bars',
  'call-and-response between lead and backing vocals',
  'countermelody answering under the hook',
  'bridge flips the energy (strip-back or lift)',
  'instrumental answer-phrases between vocal lines',
] as const;

export const CRAFT_BRIEF =
  'CRAFT LAW: the record must EVOLVE — no section repeats its texture unchanged. Verse 2 differs from verse 1 (new counterline, added layer, or strip-back). The hook gets a countermelody answer. The bridge flips the energy. Ad-libs converse with the lead, never just echo it.';

/**
 * Afro Sound DNA — the seed reference library.
 *
 * Per-genre production recipes: BPM/key tendencies, chord-loop patterns,
 * bar-by-bar arrangement, instrumentation, groove/pocket, vocal ad-lib culture,
 * signature elements, reference-artist LANES, and mix traits.
 *
 * LEGAL: this is FACTS + ANALYSIS (uncopyrightable per Feist v. Rural), authored
 * from music-theory knowledge — NOT copied audio, lyrics, or verbatim prose.
 * It captures the LANE so the AI can direct a hosted music model with depth,
 * without cloning any specific song. Do not paste copyrighted text here.
 *
 * Generated seed (Phase 1). Edit freely — Benjamin's ear is the final gate.
 */
export interface ChordMove { roman: string; description: string; whereUsed?: string }
export interface ArrangementMove { section: string; bars: string; whatHappens: string }
export interface Instrumentation { core: string[]; signature: string[]; percussion: string[]; bass: string; keys?: string; guitar?: string }
export interface Groove { feel: string; swing?: string; syncopation?: string; pocketNotes: string }
export interface VocalStyle { delivery: string; adLibs: string[]; harmonyApproach: string; languageMix?: string }
export interface MixTraits { lowEnd: string; drums: string; vocals: string; space: string; loudness?: string }

export interface SoundDNA {
  genre: string;
  displayName: string;
  bpmRange: [number, number];
  typicalBpm: number;
  commonKeys: string[];
  modalFlavor?: string;
  chordProgressions: ChordMove[];
  arrangement: ArrangementMove[];
  instrumentation: Instrumentation;
  groove: Groove;
  vocalStyle: VocalStyle;
  signatureElements: string[];
  referenceArtists: string[];
  mixTraits: MixTraits;
  productionPromptSnippet: string;
  freshnessGuardrails: string;
  sources: string[];
}

// Keyed by genre string (Afro seed genres). Global genres live in global-genres.ts
// and are merged in index.ts, so this stays Record<string> not Record<Genre>.
export const SOUND_DNA: Record<string, SoundDNA> = {
  "afrobeats": {
    "genre": "afrobeats",
    "displayName": "Afrobeats",
    "bpmRange": [
      100,
      118
    ],
    "typicalBpm": 107,
    "commonKeys": [
      "B minor",
      "F# minor",
      "C# minor",
      "A minor",
      "E minor",
      "G major",
      "C major",
      "A Dorian",
      "E Mixolydian"
    ],
    "chordProgressions": [
      {
        "roman": "i–VI–III–VII",
        "description": "The default modern Afrobeats loop in natural minor (Aeolian). Warm, cyclical, never fully resolves — loops for the whole song. Backbone of countless Wizkid/Omah Lay-type records.",
        "whereUsed": "Whole-song 2-bar or 4-bar loop; verse and chorus share it"
      },
      {
        "roman": "i–VII–VI–VII",
        "description": "Melancholic 'Afro-soul' cycle. The recurring VII gives forward pull without a hard cadence; pairs with wistful vocal melodies.",
        "whereUsed": "Emotional / mid-tempo records; verses and pre-chorus"
      },
      {
        "roman": "ii–V–i",
        "description": "Jazz/highlife-inherited turnaround in minor, often voiced with 7ths and 9ths on electric piano or nylon guitar. Adds sophistication on the last bar of a loop.",
        "whereUsed": "Turnaround on bar 4 or 8; bridge lift"
      },
      {
        "roman": "I–IV–I–V",
        "description": "Bright highlife-rooted major cycle (Mixolydian-leaning, often with a flat-VII passing). The 'sunny' Ghana/West-African palm-wine feel.",
        "whereUsed": "Uptempo, celebratory records; guitar-led hooks"
      },
      {
        "roman": "i–iv–VII–III",
        "description": "Slightly darker minor cycle that leans toward relative major on III for the hook, giving a lift into the chorus.",
        "whereUsed": "Pre-chorus into chorus moduleach perceived lift"
      },
      {
        "roman": "vi–IV–I–V",
        "description": "Pop-crossover major loop used on radio/global-facing singles; more Western but kept Afrobeats by the groove and instrumentation.",
        "whereUsed": "Crossover / international singles; chorus"
      }
    ],
    "arrangement": [
      {
        "section": "Intro",
        "bars": "0–8",
        "whatHappens": "Establish the chord loop with one signature melodic element (log-drum-adjacent bass synth, muted plucks, or nylon guitar) plus shaker and a single percussion hit. Often a vocal chant, ad-lib, or producer tag ('Sarz who knows you?' style) sits on top. Drums either absent or just shaker+kick to build anticipation."
      },
      {
        "section": "Verse 1",
        "bars": "8–24",
        "whatHappens": "Full pocket engages: syncopated kick, rimshot/clap on the backbeat feel, shaker 16ths, and the 3-2 clave-driven percussion. Bass locks with kick in call-and-response. Lead vocal enters relaxed, conversational, sitting behind the beat. Space is kept deliberately open."
      },
      {
        "section": "Pre-chorus / Lift",
        "bars": "24–32",
        "whatHappens": "Add a countermelody (guitar highlife line or synth), rising vocal melody, extra percussion fill (talking drum roll or conga run). Sometimes a 1-bar drum drop right before the hook."
      },
      {
        "section": "Chorus / Hook",
        "bars": "32–48",
        "whatHappens": "Fullest arrangement: layered vocal harmonies/gang chant, brightest melodic hook, all percussion active, bass at its most melodic. The hook is repetitive and singable — often a short phrase repeated. Ad-libs answer the lead."
      },
      {
        "section": "Post-chorus / Groove break",
        "bars": "48–56",
        "whatHappens": "Instrumental groove section or vocal chant loop — dancers' pocket. Strip to drums + bass + one hook riff so the rhythm breathes; ad-libs float."
      },
      {
        "section": "Verse 2",
        "bars": "56–72",
        "whatHappens": "Same bed as verse 1 with a subtle new element (an added synth, doubled vocal, or filtered percussion) to keep motion. Lyrics develop; delivery can get more melodic."
      },
      {
        "section": "Chorus (repeat)",
        "bars": "72–88",
        "whatHappens": "Hook returns, often with added harmony stacks or an extra ad-lib layer and a small production flourish (riser, extra tom fill)."
      },
      {
        "section": "Bridge / Breakdown",
        "bars": "88–96",
        "whatHappens": "Optional: drop drums or shift to half the elements, feature a guitar solo, a spoken ad-lib, or a key/melody variation. Rebuild percussion back in over 2–4 bars."
      },
      {
        "section": "Final chorus + Outro",
        "bars": "96–120",
        "whatHappens": "Biggest chorus, all layers, then gradual strip-down — elements fall away leaving shaker, one riff, and ad-libs to fade. Outro often loops the groove for DJs/dancefloor."
      }
    ],
    "instrumentation": {
      "core": [
        "Syncopated electronic kick (punchy, tuned)",
        "Rimshot / tight snare on the pocket accents",
        "Clap layer",
        "Shaker (busy 16th-note motor)",
        "Melodic bass synth (often 808-adjacent but more melodic, or a plucky sub)",
        "Electric piano / Rhodes-style keys",
        "Plucked synth or marimba/kalimba-style melody",
        "Pads (warm, wide)"
      ],
      "signature": [
        "The Afrobeats 'pocket' — laid-back, off-beat kick + shaker interplay built on a 3-2 / 2-3 clave feel",
        "Talking drum (dundun) fills and answer phrases",
        "Highlife-style clean electric/nylon guitar lines (bright, interlocking, palm-wine influence)",
        "Log-drum-style bass timbre borrowed from amapiano on the slower/'afro-piano' hybrid records (adjacent, not on every Afrobeats track)",
        "Kalimba / marimba / balafon melodic ornaments",
        "Bright plucky lead synth ('Afro-pluck')",
        "Gang-vocal chants and crowd/party ad-libs"
      ],
      "percussion": [
        "Shekere",
        "Congas",
        "Bongos",
        "Talking drum (dundun / gan gan)",
        "Woodblock / clave",
        "Agogo bell",
        "Tambourine",
        "Shaker (primary)"
      ],
      "bass": "Melodic and central — moves in call-and-response with the kick rather than sitting static. Rounded sub with a short, plucky attack; often follows the root motion of the chord loop with tasteful passing notes. On afro-piano hybrids it takes the amapiano log-drum timbre (bouncy, pitched, gliding). Keep it warm, not distorted; leave room for the kick.",
      "keys": "Electric piano / Rhodes-style chords voiced with 7ths, 9ths and add-ons (highlife/jazz inheritance), soft mallet or bell synths for melodic top-lines, warm analog-style pads for width and glue.",
      "guitar": "Clean, bright single-coil or nylon tone. Interlocking highlife/juju lines — short, syncopated, melodic riffs that answer the vocal rather than strum. Often doubled/panned for a shimmering interlocked feel; lots of space between notes."
    },
    "groove": {
      "feel": "Mid-tempo, danceable, deeply pocketed and laid-back — the groove is the main character. Built on a 3-2 (or 2-3) clave logic in 4/4, with the kick placed off the strict downbeat so the beat 'floats'. Emphasis on space and bounce, never busy or four-on-the-floor.",
      "pocketNotes": "Vocals and melodies sit slightly BEHIND the beat (relaxed, dragging feel) while the shaker drives 16ths on top. Kick and bass answer each other in call-and-response, leaving gaps for the percussion to speak. Nothing is rigidly quantized — micro-timing looseness is essential to the vibe.",
      "swing": "Light-to-moderate swing (roughly 8–18%) on shakers, hats and percussion; drums quantized loose rather than dead-on. Too much swing tips toward amapiano/dancehall — keep it subtle.",
      "syncopation": "High. Off-beat kicks, syncopated percussion, and clave-driven accents are the identity. Melodic and bass lines lean into the 'and' of beats. Downbeats are often left open so the groove breathes."
    },
    "vocalStyle": {
      "delivery": "Melodic, relaxed and conversational — a blend of singing and melodic-rap ('sing-rap'). Sits laid-back behind the pocket. Frequent use of Pidgin English, Yoruba/Igbo/Twi phrases mixed with English. Tone is warm, intimate, often auto-tuned lightly for sheen (not robotic). Hooks are simple, repetitive and instantly singable.",
      "adLibs": [
        "Producer tags at the top (e.g. genre-defining producer drops)",
        "'Eh eh' / 'yeah yeah' fillers",
        "'Baby' / 'jare' / 'oh' vocal punctuations",
        "Crowd/gang chants on the hook",
        "Call-and-response answer phrases panned around the lead",
        "Percussive mouth sounds and whistles",
        "Ohh / ahh melodic runs between lines"
      ],
      "harmonyApproach": "Stacked thirds and octave doubles on hooks; loose gang-vocal unisons for the 'party' feel rather than tight barbershop harmony. Lead double-tracked and widened; ad-libs panned hard left/right to frame the center vocal.",
      "languageMix": "English + Nigerian Pidgin as the spine, seasoned with Yoruba, Igbo, Twi (Ghana) or other West African languages; occasional Jamaican Patois inflection from the dancehall lineage."
    },
    "signatureElements": [
      "The Afrobeats 'pocket': off-beat syncopated kick + busy shaker built on a 3-2/2-3 clave feel",
      "Melodic call-and-response bass that dances with the kick rather than droning",
      "Talking drum (dundun) and shekere fills answering the vocal",
      "Highlife/juju interlocking clean guitar riffs (palm-wine lineage)",
      "Vocals sung slightly behind the beat with Pidgin/Yoruba/English code-switching",
      "Repetitive, chant-able hooks with gang vocals and hard-panned ad-libs",
      "Producer tags and vocal ad-lib culture",
      "Cyclical 2–4 bar chord loops (often i–VI–III–VII) that never fully resolve",
      "Bright plucky 'Afro-pluck' lead synths, kalimba/marimba/balafon ornaments",
      "Warm, wide, uncluttered mix that leaves space for the groove to breathe"
    ],
    "referenceArtists": [
      "Wizkid",
      "Burna Boy",
      "Davido",
      "Rema",
      "Ayra Starr",
      "Tems",
      "Omah Lay",
      "Asake",
      "Fireboy DML",
      "Joeboy",
      "Tiwa Savage",
      "Mr Eazi",
      "CKay",
      "Stonebwoy (Ghana)",
      "Sarkodie (Ghana)",
      "Sarz (producer)",
      "P.Priime (producer)",
      "Kel-P (producer)",
      "London (Ghana/UK producer)"
    ],
    "mixTraits": {
      "lowEnd": "Warm, rounded and controlled — kick and bass share the low end via call-and-response placement rather than stacking, so both stay clean. Sub is present but not overpowering; low-mids kept tidy so percussion cuts through. Not a bass-crushing loudness-war master — musicality over sheer weight.",
      "drums": "Punchy but not overbearing kick, crisp rimshot/clap, and a forward, present shaker that drives the top end. Percussion (shekere, congas, talking drum) sits mid-forward with light room/plate reverb for organic feel. Micro-loose timing preserved, not gridded to death.",
      "vocals": "Front-and-center, intimate and slightly bright. Lead double-tracked and widened; light auto-tune for sheen. Ad-libs and harmonies panned wide to frame the center. Tasteful plate/short reverb and slap delay for space without washing out the pocket.",
      "space": "Wide stereo image from panned guitars, ad-libs and percussion. Deliberately uncluttered — arrangements leave gaps so the groove breathes. Reverbs are moderate (not cavernous); the mix feels warm, sunny and airy rather than dense.",
      "loudness": "Competitive streaming loudness (~ -9 to -7 LUFS integrated for singles) but prioritizes groove clarity and dynamics over brickwall smashing; transients on kick and percussion are preserved."
    },
    "productionPromptSnippet": "Afrobeats, 100–118 BPM (sweet spot ~107). Minor/Mixolydian, cyclical 2–4 bar loop (e.g. i–VI–III–VII) that never resolves. Groove is king: laid-back off-beat syncopated kick + busy 16th shaker on a 3-2 clave feel, light swing, loose timing. Melodic bass in call-and-response with the kick. Layer talking drum, shekere, congas; interlocking bright highlife guitar; Rhodes/EP with 7th/9th chords; kalimba/marimba plucks; warm wide pads. Vocals relaxed and slightly behind the beat, Pidgin/Yoruba/English mix, light autotune, chant-able repetitive hook, gang vocals and hard-panned ad-libs. Mix warm, wide, uncluttered — space over density; clean shared low end.",
    "freshnessGuardrails": "Capture the LANE, never a specific record. Use the STYLE traits — the 3-2 clave pocket, off-beat kick + shaker interplay, call-and-response melodic bass, highlife guitar interlocks, cyclical non-resolving minor loops, Pidgin/Yoruba code-switched vocals, gang chants and ad-lib culture, warm uncluttered mix. Do NOT reproduce any existing song's melody, topline, lyric, hook phrase, chord voicing sequence, or recognizable riff. Reference artists are directional touchstones for the SOUND only — never imitate a named artist's voice, cadence, or catalog. Generate ORIGINAL chord loops, melodies, drum patterns and lyrics. If a generated element resembles a known song, discard and regenerate. Authenticity comes from correct groove, instrumentation and pocket — not from copying.",
    "modalFlavor": "Predominantly natural minor (Aeolian) for the modern emotional/'Afro-soul' sound, with a strong Mixolydian and major-highlife streak on brighter, celebratory records (raised 3rd with a flat-7 passing feel). Dorian appears where a slightly brighter minor is wanted (raised 6th). Melodies favor pentatonic and call-and-response phrasing inherited from West African folk/highlife; chords often colored with 7ths, 9ths and add-ons from the highlife/jazz lineage.",
    "sources": [
      "Producer domain expertise (musicology)",
      "Public genre reference material (Wikipedia: Afrobeats / Afrobeat)",
      "Publicly available music-production education blogs (RouteNote, Soundtrap, BPMcalc and similar)",
      "General music-theory public knowledge"
    ]
  },
  "afro_fusion": {
    "genre": "afro_fusion",
    "displayName": "Afro-fusion",
    "bpmRange": [
      100,
      118
    ],
    "typicalBpm": 107,
    "commonKeys": [
      "B minor",
      "F# minor",
      "A minor",
      "E minor",
      "C# minor",
      "G major",
      "D major",
      "A major"
    ],
    "chordProgressions": [
      {
        "roman": "i - VII - VI - VII",
        "description": "Aeolian/natural-minor loop with the flat-VII pulling back to i - the workhorse melancholy-but-danceable Afro-fusion vamp; stays on a 2- or 4-bar cycle the whole song.",
        "whereUsed": "Verse and pre/hook beds; Wizkid/Rema-style mid-tempo cuts"
      },
      {
        "roman": "i - VII - i - VI (Dorian)",
        "description": "Dorian minor (raised 6th coloring the VI/IV) gives the bright-yet-minor 'ethnic' lilt over a marimba/kalimba or plucked-guitar line; harmony stays static while melody explores the mode.",
        "whereUsed": "Highlife-leaning and amapiano-tinged sections"
      },
      {
        "roman": "I - V - vi - IV",
        "description": "Major pop axis borrowed for radio-crossover, love-song Afro-pop; kept warm and simple, rarely more than four chords.",
        "whereUsed": "Crossover hooks, Davido-style anthemic choruses"
      },
      {
        "roman": "I - ii - V - IV (Mixolydian tilt)",
        "description": "1-2-5-4 loop that producers cite as the classic Afrobeats vamp; the ii and IV keep it buoyant and non-resolving so the groove never 'lands'.",
        "whereUsed": "Uptempo party/dance records"
      },
      {
        "roman": "vi - IV - I - V",
        "description": "Same axis rotated to start on the relative minor for a moodier entry that opens up into major on the hook.",
        "whereUsed": "Intro/verse into a major chorus lift"
      }
    ],
    "arrangement": [
      {
        "section": "Intro",
        "bars": "4-8",
        "whatHappens": "Establish the loop with 1-2 melodic elements only: log drum or plucked guitar/marimba plus a wide pad. Shaker or hi-hat pattern enters to set the pocket. Often an artist ad-lib tag or producer tag ('Mmm', name-drop) lands here. No full drums yet - space is the point."
      },
      {
        "section": "Verse 1",
        "bars": "8-16",
        "whatHappens": "Full pocket drops in: syncopated kick, rim/snare on the back-half, shekere/shaker glue, light percussion (congas, talking drum accents). Bass locks tight with the kick. Lead vocal is conversational, riding the offbeats; leaves gaps for percussion to breathe."
      },
      {
        "section": "Pre-hook / Build",
        "bars": "4-8",
        "whatHappens": "Slight lift - add a countermelody (whistle, flute, synth pluck), rising vocal ad-libs, maybe a percussion fill or a one-bar drum drop right before the hook to create tension."
      },
      {
        "section": "Hook / Chorus",
        "bars": "8-16",
        "whatHappens": "Widest, most melodic point. Layered/doubled lead vocal with harmony stacks and call-and-response ad-libs, pads open up, log drum or 808 at fullest. This is the earworm - simple, repeated, chant-like phrasing designed to be sung back."
      },
      {
        "section": "Verse 2",
        "bars": "8-16",
        "whatHappens": "Return to the pocket, often with one new element added versus verse 1 (extra percussion layer, a guest artist, a bassline variation) to keep the repetitive loop fresh."
      },
      {
        "section": "Hook (repeat)",
        "bars": "8-16",
        "whatHappens": "Same hook, sometimes with extra ad-lib stacks or a stripped 'a cappella + percussion' bar for dynamic contrast."
      },
      {
        "section": "Bridge / Dance break",
        "bars": "4-8",
        "whatHappens": "Optional log-drum or percussion-forward instrumental break for dancing (amapiano influence), or a half-time/reggae-dancehall switch-up. Vocals reduce to ad-libs and chants."
      },
      {
        "section": "Outro",
        "bars": "4-8",
        "whatHappens": "Loop thins back to the intro elements - pad, plucks, fading ad-libs and shaker. Fade or clean stop on the log drum. Whole track typically 2:30-3:30, built on one hypnotic repeating cycle rather than dramatic key changes."
      }
    ],
    "instrumentation": {
      "core": [
        "Syncopated kick drum (soft, rounded)",
        "Rim-click / crisp snare on the back-beat",
        "Shekere and layered shakers (the rhythmic glue)",
        "Warm sub-bass or 808 locked to the kick",
        "Wide, lush synth pads / airy chord stabs",
        "Plucked electric or highlife-style clean guitar",
        "Lead vocal (sung-rapped)"
      ],
      "signature": [
        "Log drum (deep pitched percussive 'thud' bass - amapiano DNA)",
        "Highlife-style interlocking clean guitar lines (bright, palm-muted, call-and-response)",
        "Talking drum accents and fills",
        "Marimba / kalimba / mbira melodic plucks for modal color",
        "Wide, reverb-washed pads that open on the hook",
        "Whistle, flute or ocarina countermelody hooks"
      ],
      "percussion": [
        "Shekere",
        "Shakers (velocity-varied)",
        "Congas",
        "Talking drum",
        "Udu",
        "Woodblock / rim",
        "Bell / agogo patterns",
        "Claps and finger-snaps on the hook"
      ],
      "bass": "Rounded sub-bass, live-feel bass guitar, or 808 - always tightly interlocked with the syncopated kick and (when present) side-chained or rhythmically pocketed against the log drum so the two low-end elements alternate rather than clash in the 20-100Hz range.",
      "keys": "Electric piano (Rhodes/EP), soft synth chord stabs, and wide pads; harmony usually 3-4 chords held simply while rhythm and vocal carry the movement.",
      "guitar": "Clean, bright highlife/juju-derived electric guitar playing short repeating interlocking riffs and call-and-response fills; occasional nylon/acoustic for warmth. Rarely distorted."
    },
    "groove": {
      "feel": "Danceable mid-tempo pocket built on West African polyrhythm - a laid-back, swung, 'in-the-cut' feel that sits slightly behind the grid. Space and restraint over density; the groove breathes.",
      "pocketNotes": "The kick is syncopated (rarely four-on-the-floor), landing on offbeats and leaving holes that shakers and percussion fill. Snare/rim hits the back-half of the bar. Everything interlocks call-and-response style; no single instrument plays busy - the polyrhythm emerges from many sparse parts stacked.",
      "swing": "Light-to-moderate swing/shuffle (roughly 8-18% on the shaker and hi-hat grid) to give the loop a rolling, human, non-mechanical bounce.",
      "syncopation": "Heavy syncopation and cross-rhythm - kick and bass emphasize the 'and' of beats, shakers accent downbeats hard and soften upbeats via alternating MIDI velocities, and layered percussion creates 3-against-2 / 6/8-over-4/4 polyrhythmic tension characteristic of the shaku-shaku and amapiano lineages."
    },
    "vocalStyle": {
      "delivery": "Fluid sung-rap that slides between melodic singing, hip-hop cadence, R&B runs and dancehall/patois inflection - often mid-phrase. Relaxed, in-the-pocket, conversational on verses; chant-like and anthemic on hooks. Melisma and pitch-sliding are common. Heavy use of pidgin English, Yoruba/Igbo, and local slang mixed with English.",
      "adLibs": [
        "Name/producer tags (e.g. artist signature drop at the top)",
        "Melodic 'eh-eh', 'yeah yeah', 'oh-oh' fills",
        "Hyped call-outs ('gbedu', 'weh', 'ehen')",
        "Whistles and vocal percussion",
        "Doubled/echoed last words of a line",
        "Adlib stacks layered under the hook for width"
      ],
      "harmonyApproach": "Lead doubled and stacked in 3rds/octaves on the hook; loose, gang-vocal call-and-response backgrounds rather than tight choral arrangements; ad-libs panned wide to frame the dry, centered lead.",
      "languageMix": "Pidgin English + English + indigenous languages (Yoruba, Igbo, sometimes Twi/Zulu/Amapiano-slang), code-switching freely within a single line."
    },
    "signatureElements": [
      "Log-drum bassline (amapiano fusion) that alternates with the kick instead of clashing",
      "One hypnotic, repeating chord/melody loop carried the entire song - repetition over key changes",
      "Interlocking sparse percussion (shekere + shakers + talking drum) that leaves space",
      "Highlife/juju clean-guitar call-and-response riffs",
      "Modal color (Dorian/Aeolian/Mixolydian) from marimba, kalimba or plucked synth",
      "Sung-rap vocal that fluidly blends singing, rap, R&B and dancehall",
      "Chant-able, simple, endlessly repeated hook",
      "Wide reverb-washed pads that open up on the chorus",
      "Multilingual code-switching (pidgin + English + indigenous language)",
      "Producer/artist vocal tag at the intro"
    ],
    "referenceArtists": [
      "Burna Boy",
      "Wizkid",
      "Davido",
      "Rema",
      "Asake",
      "Ayra Starr",
      "Tems",
      "Fireboy DML",
      "Omah Lay",
      "Tiwa Savage",
      "Adekunle Gold",
      "CKay",
      "BNXN",
      "Oxlade"
    ],
    "mixTraits": {
      "lowEnd": "The defining technical challenge: kick and bass/808/log-drum share the 20-100Hz sub range, so they must be pocketed rhythmically and/or side-chained so only one occupies the sub at a time. Deep, rounded, punchy low end - felt more than heard - with a clean, non-muddy sub.",
      "drums": "Punchy but not loud-slammed; drums leave space rather than filling every 16th. Shakers/hats mixed as the rhythmic glue with velocity-driven dynamics; transients crisp; percussion panned across the stereo field for width and polyrhythmic clarity.",
      "vocals": "Vocal is the undeniable focal point - lead sits forward, dry-ish and centered, with surgical EQ to cut through the dense percussion. Ad-libs and harmonies pushed wide and slightly back to frame the lead. Tasteful pitch-correction, plate/room reverb and slap/ping-pong delay throws.",
      "space": "Expansive, spacious and clear despite many parts - achieved through arrangement restraint and wide stereo placement of pads and percussion, not wall-of-sound density. Airy top end, warm mids.",
      "loudness": "Modern-loud and radio/streaming-competitive but retaining transient punch and low-end weight; not brick-walled to the point of losing the groove's dynamics."
    },
    "productionPromptSnippet": "Afro-fusion, 100-118 BPM (sweet spot ~105-110), minor-key (B/F#/A minor) with Dorian/Aeolian modal color. Hypnotic 3-4 chord loop (i-VII-VI-VII) held the whole track. Syncopated soft kick leaving space, rim/snare on the back-beat, velocity-swung shakers + shekere as glue, talking-drum accents, congas. Deep log-drum/808 bass pocketed against the kick (never clashing). Warm Rhodes, wide reverb-washed pads opening on the hook, bright highlife clean-guitar call-and-response, marimba/kalimba plucks. Fluid sung-rap vocal - singing into rap into R&B/dancehall - multilingual (pidgin + English + Yoruba), chant-able repeated hook, wide ad-lib stacks. Vocal forward and dry-centered; deep clean sub; spacious, uncluttered mix.",
    "freshnessGuardrails": "Capture the LANE, never a specific record. Generate original chord loops, melodies, toplines, lyrics and log-drum/percussion patterns from scratch - do not reproduce the hook, melody, cadence, lyric, or instrumental riff of any named reference song or artist. Reference artists (Burna Boy, Wizkid, Rema, Asake, etc.) are factual style anchors ONLY, never templates to imitate; do not mimic a specific artist's voice, timbre, catchphrase, or signature tag. Use the genre's grammar (modal minor loop, interlocking sparse polyrhythm, log-drum-vs-kick low end, sung-rap multilingual delivery, chant hook) as a framework, then invent fresh material within it. No sampling or interpolation of existing tracks. Vary BPM, key, progression and instrumentation each generation to avoid converging on a single 'sound-alike' output.",
    "modalFlavor": "Predominantly minor-key with modal coloring: Aeolian (natural minor) for the melancholy-danceable staple, Dorian (raised 6th) for the bright-lilting highlife/amapiano feel, and Mixolydian (flat-7) for uptempo party cuts. Major keys appear on crossover Afro-pop love songs. Harmony stays static and simple (3-4 chords) while the vocal and melodic plucks explore the mode across the held loop - movement comes from rhythm and melody, not chord changes.",
    "sources": [
      "Musicological domain knowledge (genre theory, African rhythm/polyrhythm, harmony)",
      "Publicly documented genre conventions (BPM ranges, instrumentation, modal tendencies)",
      "Production-education material (chord-progression and mixing guides)",
      "General music-press coverage of the Afrobeats/Afro-fusion/amapiano lineage (artist style descriptions as factual reference)"
    ]
  },
  "amapiano": {
    "genre": "amapiano",
    "displayName": "Amapiano",
    "bpmRange": [
      108,
      118
    ],
    "typicalBpm": 112,
    "commonKeys": [
      "A minor",
      "C minor",
      "F minor",
      "G minor",
      "D minor",
      "Bb major",
      "F major",
      "Eb major"
    ],
    "modalFlavor": "Predominantly natural minor (Aeolian) and Dorian, with heavy use of jazz extended harmony over the mode. Dorian's raised 6th gives the \"hopeful/soulful\" lift heard in private-school piano. Major-key tracks lean toward Ionian with maj7/add9 color. The harmony is defined less by the mode itself than by lush 7th/9th/11th voicings borrowed from deep house and jazz — the chords float and cycle rather than resolve strongly, creating the hypnotic, loop-based feel.",
    "chordProgressions": [
      {
        "roman": "ii7 – V7 – Imaj7",
        "description": "Jazz 2-5-1 core; the harmonic backbone of private-school amapiano. Voiced as min9 → dom7(b9/13) → maj9 on Rhodes/electric piano. E.g. in Bb: Cmin9 – F7(b9) – Bbmaj9.",
        "whereUsed": "Main loop of melodic/private-school tracks; piano intros and breakdowns"
      },
      {
        "roman": "i9 – VImaj7 – III maj7 – VII7",
        "description": "Cyclical minor vamp with modal color, little functional resolution — floats and repeats. Natural-minor territory. E.g. in A minor: Amin9 – Fmaj7 – Cmaj7 – G.",
        "whereUsed": "Groove-driven, log-drum sections; the loop that carries most of the song"
      },
      {
        "roman": "i – VI – III – VII (4-chord Aeolian loop)",
        "description": "Simple pop-adjacent minor loop dressed with 9ths/add9 extensions; the most common 'anthem' progression across mainstream amapiano.",
        "whereUsed": "Whole-song loop in vocal/commercial hits and log-drum bangers"
      },
      {
        "roman": "i – iv – v (Dorian/Aeolian mix)",
        "description": "Darker, sparser vamp for sgija/barcadi and log-drum-forward tracks; minimal chord movement, lets the drum and bass drive.",
        "whereUsed": "Stripped log-drum sections, dance/DJ-tool cuts"
      },
      {
        "roman": "Imaj7 – vi9 – ii9 – V13",
        "description": "Major-key soulful turnaround with rich upper extensions; brighter, gospel/soulful-house flavor.",
        "whereUsed": "Uplifting private-school and soulful vocal tracks"
      }
    ],
    "arrangement": [
      {
        "section": "Intro / Atmosphere",
        "bars": "1-16",
        "whatHappens": "Wide airy pad or Rhodes chord loop establishes key; soft filtered percussion, a lone shaker or hat starts building. No log drum yet. Often a spoken vocal tag/producer signature or a filtered vocal chop drifts in. Slow, patient build (amapiano intros are long)."
      },
      {
        "section": "Piano/Melody Statement",
        "bars": "17-32",
        "whatHappens": "Jazzy piano/Rhodes progression comes fully in; shakers and rim/clicks lock a shuffled groove; light kick pattern (not 4-on-floor). Bass hints or muted log-drum notes tease. Tension pad swells."
      },
      {
        "section": "First Log-Drum Drop",
        "bars": "33-48",
        "whatHappens": "The log drum enters — the payoff. Syncopated, bouncing log-drum bassline drives the pocket; full shaker/hat roll, congas/bongos, snare/clap on the backbeat. Groove is now complete and hypnotic. Main vocal hook or lead melody sits on top."
      },
      {
        "section": "Vocal Verse / Groove",
        "bars": "49-64",
        "whatHappens": "Vocals (or lead) carry; log drum may thin slightly for space, percussion keeps rolling. Ad-libs and call-and-response fills answer the lead. Subtle harmonic variation on the loop."
      },
      {
        "section": "Breakdown / Reset",
        "bars": "65-80",
        "whatHappens": "Log drum drops out or filters away; back to pads, piano, and vocals. Reverb-drenched, spacious. Tension rebuilds with a snare roll, rising shaker, or filter sweep. A vocal or spoken cue signals the return."
      },
      {
        "section": "Main Log-Drum Section (peak)",
        "bars": "81-112",
        "whatHappens": "Biggest, fullest log-drum drop — the dancefloor peak. All percussion, biggest bass bounce, full vocal hook and layered ad-libs. Extended (amapiano loves long peak sections for DJ use). Small mutes/re-entries keep it alive."
      },
      {
        "section": "Outro",
        "bars": "113-128",
        "whatHappens": "Elements strip away progressively (log drum, then percussion), leaving pads/piano and vocal tails to fade — DJ-friendly beatless-ish tail for mixing out."
      }
    ],
    "instrumentation": {
      "core": [
        "Log drum (signature hybrid percussive bass — the genre's defining sound)",
        "Jazzy piano / Rhodes / electric piano (extended 7th-9th-11th voicings)",
        "Wide, airy atmospheric pads (deep-house lineage)",
        "Continuous shaker loop",
        "Rolling hi-hats (shuffled, off-grid)",
        "Kick (syncopated, NOT strict 4-on-the-floor)",
        "Snare / clap on the backbeat",
        "Sub bass (supports or is fused with the log drum)"
      ],
      "signature": [
        "Log drum bassline — a tuned, punchy, pitched bass-percussion hybrid between an 808, kick, synth bass and marimba/log; melodic and rhythmic at once, the single most identifying element",
        "Wide reverberant pads that swell and breathe",
        "Vocal chops and spoken producer tags/signatures",
        "Whistle/vocal 'log-drum-answer' phrases and grunts ('yano' ad-libs)",
        "Piano 'session' feel — improvised, jazzy, live-sounding keys"
      ],
      "percussion": [
        "Shakers (continuous, the rhythmic glue)",
        "Congas / bongos",
        "Rimshots / clicks / woodblocks",
        "Cabasa / guiro",
        "Toms and percussion fills for transitions",
        "Vocal percussion / breath hits"
      ],
      "bass": "The log drum IS the bass in most amapiano — a pitched, gliding, heavily-shaped percussive tone (soft-clipped for drive, often with pitch slides/portamento between notes). A cleaner sub layer may reinforce the low end underneath. In private-school/soulful cuts, a rounder deep-house sub-bass or Rhodes-doubled bassline may take a softer role.",
      "keys": "Rhodes / electric piano and grand piano are central — voiced with lush maj7, min9, add9, 11 and 13 extensions, played loose and jazzy ('piano session' aesthetic). Warm analog-style synth keys and bells add color.",
      "guitar": "Occasional — soft muted/clean electric guitar licks or Afro/highlife-tinged plucks appear in some crossover and Afro-fusion amapiano, but guitar is NOT a defining or required element (unlike highlife/afrobeats)."
    },
    "groove": {
      "feel": "Shuffled, syncopated, laid-back mid-tempo bounce — NOT four-on-the-floor. A rolling, hypnotic forward motion carried by the shaker loop with the log drum bouncing in the pocket. Relaxed but insistently danceable; deep-house patience at a slower, groovier tempo.",
      "pocketNotes": "The log drum sits slightly BEHIND the grid (roughly 8-12% swing / late) to create pocket and bounce without losing lock. The continuous shaker never stops — it fills every gap between log-drum hits and drives momentum. Kick avoids landing on every quarter; it works around the log drum. Space and negative space matter — the groove breathes.",
      "swing": "Moderate to heavy swing (typically ~55-62% swing on the 16ths / hats and log drum); triplet/shuffle feel is characteristic. Straighter on some sgija/barcadi cuts.",
      "syncopation": "High. Off-beat log-drum accents, syncopated kick placement, and answer-and-call percussion. The log-drum bassline itself is highly syncopated, often anticipating or lagging the downbeat, which is what creates the signature 'skip'."
    },
    "vocalStyle": {
      "delivery": "Ranges from soulful, melodic sung hooks (private-school and soulful amapiano) to conversational, rap/kwaito-style chant and street toasting (sgija/barcadi, 'yano' bangers). Often relaxed, cool, half-sung/half-spoken. Call-and-response between lead and crowd/ad-libs is central. Many tracks are largely instrumental with sparse vocal chops and tags rather than full topline.",
      "adLibs": [
        "Spoken producer/DJ tags and signatures (e.g. name-drops, 'to the world', 'Scorpion Kings'-style crew tags)",
        "Grunts, breaths and rhythmic 'yano' vocalizations",
        "Whistles and vocal phrases that answer the log drum",
        "Crowd chants and hype call-outs",
        "Short vocal chops re-pitched into the harmony",
        "Ohh / eyy / woo interjections filling percussion gaps"
      ],
      "harmonyApproach": "Loose stacked harmonies and doubled hook lines; soulful/gospel-influenced backing vocals in melodic cuts; unison group chants in dancefloor cuts. Vocals often sit inside the mix, treated as another textural/rhythmic layer rather than always front-and-center.",
      "languageMix": "Predominantly South African languages — isiZulu, isiXhosa, Sesotho, Setswana — mixed with English and township slang (tsotsitaal). Code-switching within a single line is common and authentic."
    },
    "signatureElements": [
      "The log drum bassline — pitched, syncopated, soft-clipped percussive bass that is the non-negotiable identity of the genre",
      "Continuous, unbroken shaker loop as rhythmic glue",
      "Jazzy extended-chord Rhodes/piano voicings (min9, maj7, add9, 11, 13) played 'piano-session' loose",
      "Wide, airy, reverberant deep-house pads",
      "Shuffled, non-4-on-the-floor syncopated groove with the log drum behind the grid",
      "Long patient intros and extended log-drum peak sections (DJ-friendly, dancefloor-built)",
      "Log-drum drop-outs and re-entries as the main arrangement device (breakdown then bigger drop)",
      "Spoken producer tags, grunts, whistles and 'yano' ad-libs answering the drum",
      "Deep pitch-slide/portamento on the log-drum notes"
    ],
    "referenceArtists": [
      "Kabza De Small",
      "DJ Maphorisa",
      "Vigro Deep",
      "Focalistic",
      "DBN Gogo",
      "Kelvin Momo",
      "Mellow & Sleazy",
      "De Mthuda",
      "MFR Souls",
      "Daliwonga",
      "Young Stunna",
      "Uncle Waffles",
      "Musa Keys",
      "Tyler ICU",
      "Nkosazana Daughter",
      "Sha Sha",
      "Major League DJz"
    ],
    "mixTraits": {
      "lowEnd": "Log-drum-centric low end — the log drum owns the sub and low-mids. Soft-clipping/saturation adds drive and audible bounce; sidechain or careful gain-staging keeps the kick and log drum from masking each other. Deep, round, but rhythmic rather than a constant sub-wall. Mono-tight below ~120 Hz.",
      "drums": "Punchy but not harsh; log drum forward and up-front, shakers/hats bright and present (they carry energy), claps/snares with a slap and short room. Percussion panned wide for a rolling stereo groove. Swing/humanize keeps it off-grid.",
      "vocals": "Often tucked slightly into the bed rather than radio-loud; smooth, warm, with plenty of reverb/delay throwback tails. Ad-libs and chops panned and drenched in space. In melodic/private-school cuts vocals are more forward and polished.",
      "space": "Big, airy, three-dimensional — generous reverb and delay on pads, keys, vocals and percussion fills. Wide stereo image on pads/percussion; deep sense of room. The mix breathes and leaves negative space for the groove.",
      "loudness": "Moderate, groove-first loudness — not brickwalled EDM levels. Dynamics preserved so the log-drum bounce and drop/re-entry contrast land. Warm, slightly analog/lo-fi-tinged tone in many cuts."
    },
    "productionPromptSnippet": "South African Amapiano, 112 BPM, minor key (Aeolian/Dorian) with lush jazzy Rhodes/piano voicings (min9, maj7, add9, 11, 13) in a floating ii-V-I or i-VI-III-VII loop. Signature: a deep, pitched, soft-clipped LOG DRUM bassline — syncopated, bouncing, sitting behind the grid — as the core. Continuous unbroken shaker, shuffled off-grid hats, congas, backbeat clap; NOT four-on-the-floor. Wide airy reverberant deep-house pads. Long patient intro, then a log-drum DROP; breakdown then bigger peak. Relaxed soulful or chant/kwaito vocals in isiZulu/English with spoken tags, grunts, whistles and ad-libs answering the drum. Warm, spacious, groove-first mix; log-drum owns the low end.",
    "freshnessGuardrails": "Capture the LANE, never a specific record. Generate original chord loops, log-drum rhythms, melodies and lyrics from scratch — do not reproduce the topline, bassline, or hook of any named track or artist. Reference artists (Kabza De Small, Vigro Deep, etc.) are factual style anchors ONLY, never templates to copy; do not imitate a specific artist's signature phrases, tags, or a recognizable song. Keep the DEFINING traits (log-drum bounce, shuffled groove, jazzy extended voicings, airy pads, ~112 BPM, long-intro/drop structure, township-language vocals) while freely varying the actual notes, progression order, drum pattern, arrangement length, and lyric content. No sampling or interpolation of existing releases. Aim for authentic-genre-feel + original-composition.",
    "sources": [
      "Musicological domain knowledge of Amapiano (South African house lineage: deep house, kwaito, bacardi/barcadi house, jazz, gqom)",
      "Public genre-education and production articles (e.g. Splice, EDMProd, Roland, RouteNote, Orphiq) confirming BPM range, log-drum definition, groove and chord conventions",
      "General knowledge of the genre's artists and sub-styles (private school, sgija/barcadi) as widely documented public reference points"
    ]
  },
  "afro_dancehall": {
    "genre": "afro_dancehall",
    "displayName": "Afro-Dancehall",
    "bpmRange": [
      92,
      110
    ],
    "typicalBpm": 102,
    "commonKeys": [
      "A minor",
      "C major",
      "F# minor",
      "G minor",
      "D minor",
      "B minor",
      "E minor"
    ],
    "modalFlavor": "Predominantly natural minor (Aeolian) for the moody, sub-bass-driven riddims, with a strong secondary lane of major-key \"sunny\" dancehall (Ionian) for feel-good party cuts. Vocal melodies lean pentatonic (minor pentatonic over minor riddims, major pentatonic over bright ones) with frequent bluesy b3/b7 inflections carried over from reggae. Occasional Dorian color (raised 6th over a minor tonic) on organ/skank stabs gives the \"yard\" warmth. Harmony is deliberately static: many riddims sit on a single vamp or two-chord loop so the groove and voice, not chord motion, drive the record.",
    "chordProgressions": [
      {
        "roman": "i - VI - VII",
        "description": "The workhorse minor-key dancehall loop. Dark, cyclical, endlessly repeatable under toasting. e.g. Am - F - G. The VII (major) resolving back to i gives that rolling, unresolved dancehall pull.",
        "whereUsed": "Main riddim vamp for moody / gyal-tune records; loops through verse and chorus unchanged"
      },
      {
        "roman": "i - VII - VI - VII",
        "description": "Rocking two-and-a-half-bar feel; keeps the ear moving without ever resolving to a bright chord. Classic 'rub-a-dub' derived motion. e.g. Am - G - F - G.",
        "whereUsed": "Verse groove; the constant VII avoids a tonic landing so the vocal carries the tension"
      },
      {
        "roman": "I - V - vi - IV",
        "description": "Bright, radio-friendly major loop for feel-good Afro-dancehall crossover hits (the pop-dancehall pocket). e.g. C - G - Am - F.",
        "whereUsed": "Chorus / hook of major-key party anthems and Afrobeats-leaning dancehall"
      },
      {
        "roman": "i - iv",
        "description": "Two-chord minimalist riddim vamp, often just organ skank alternating tonic and subdominant minor. Maximum space for the voice. e.g. Am - Dm.",
        "whereUsed": "Sparse sound-system riddims where bass and drum carry the record"
      },
      {
        "roman": "I - IV",
        "description": "Major two-chord skank vamp; the classic reggae/dancehall bounce, chords stabbed only on the offbeats. e.g. G - C.",
        "whereUsed": "Upful, sing-along dancehall; organ bubble and guitar skank trade the two chords"
      }
    ],
    "arrangement": [
      {
        "section": "Intro / Riddim drop",
        "bars": "4-8",
        "whatHappens": "Riddim states itself: drum groove + sub-bass line + offbeat skank stab enter, often stripped (drop the kick for the first bar or two then let it land). Sometimes a producer tag/DJ drop or a filtered vocal chop. Establishes the loop the whole record rides."
      },
      {
        "section": "Verse 1",
        "bars": "8-16",
        "whatHappens": "Lead vocal enters in singjay/toasting mode over the full riddim. Arrangement stays sparse - drums, sub, skank, maybe a single melodic ostinato. Space is deliberate; the voice is the lead instrument. Percussion (shaker, rimshot) may build across the last 2 bars."
      },
      {
        "section": "Pre / Build",
        "bars": "2-4",
        "whatHappens": "Optional short lift: pull the kick and sub, let the vocal and a snare/hat roll or riser build tension into the hook. Often a spoken ad-lib call ('pull up!', 'sen' it') marks the transition."
      },
      {
        "section": "Hook / Chorus",
        "bars": "8",
        "whatHappens": "Fullest section. Catchy sung/chanted hook, doubled and harmonized, ad-libs stacked in the gaps. Add a countermelody (guitar highlife-style line, marimba/xylophone, or brass stab). Sub-bass most prominent here. This is the loop-defining, repeat-worthy core."
      },
      {
        "section": "Verse 2",
        "bars": "8-16",
        "whatHappens": "Return to sparse riddim; new lyric, often a guest deejay or a switch to harder patois toasting. May introduce a new percussion layer or subtle melodic variation to keep motion."
      },
      {
        "section": "Hook / Chorus 2",
        "bars": "8",
        "whatHappens": "Repeat hook, sometimes with an added octave-up vocal or extra harmony stack and denser ad-libs."
      },
      {
        "section": "Bridge / Deejay break",
        "bars": "4-8",
        "whatHappens": "Optional: drop to bass + drums only for a raw 'rub-a-dub' toasting section, a dubbed-out delay throw, or a percussion breakdown before the final hook. Dub sirens / horn stabs common."
      },
      {
        "section": "Final hook + Outro",
        "bars": "8-12",
        "whatHappens": "Last chorus, maximum ad-libs and vocal call-and-response, then strip back to the riddim loop and let it ride out (or hard-cut on a dub delay tail). Total track typically 2:45-3:30."
      }
    ],
    "instrumentation": {
      "core": [
        "Punchy 808/drum-machine kick placed with dancehall spacing (not four-on-floor)",
        "Tight electronic snare / rimshot cross-stick and layered clap",
        "Offbeat hi-hats and open-hat accents on the 'and'",
        "Deep, round sub-bass / synth bass as the melodic-rhythmic anchor",
        "Offbeat skank stab - clavinet, muted electric guitar, or synth organ chord on the upbeats",
        "Bubble organ (staccato reggae/dancehall organ pattern)"
      ],
      "signature": [
        "The offbeat skank stab (guitar or organ chord on beats 2 & 4 / the 'and') - the single most identifying element",
        "Reggae/dancehall organ 'bubble' pattern weaving between the kick",
        "Heavy, melodic sub-bass riddim that the whole track is named and built around",
        "Dub-style delay/reverb throws on snares and vocal tails",
        "Air-horn / dub-siren FX and gunshot/laser one-shots as punctuation",
        "West-African melodic overlay - highlife-style clean guitar line, marimba/xylophone or kalimba - that marks it as AFRO-dancehall rather than pure Jamaican"
      ],
      "percussion": [
        "Shaker / shekere driving 16ths",
        "Timbale and tom rolls as fills",
        "Conga / bongo hand-drum accents",
        "Rimshot and cross-stick",
        "Occasional talking-drum or log-drum-adjacent low percussion pulled from the Afrobeats side",
        "Clap/snap layers reinforcing the backbeat"
      ],
      "bass": "Deep, rounded, prominent sub-bass is the heart of the riddim - often a sine/808-style synth bass with a memorable, syncopated melodic line that locks tightly to the kick. Bass frequently rests on the offbeats or plays a walking/rolling figure, leaving the downbeat space. It carries as much melodic identity as the vocal; the riddim is effectively named after this bassline.",
      "keys": "Reggae/dancehall organ doing the staccato 'bubble', plus offbeat clavinet/piano skank stabs. Warm electric-piano pads occasional. Keys provide rhythm and harmony via short stabs, almost never sustained pads-as-lead.",
      "guitar": "Clean, muted electric guitar playing the offbeat skank (short upstroke chops on the upbeats) is the classic reggae inheritance. On the Afro side, add a bright, single-note highlife/palm-wine-style guitar line - clean tone, syncopated, weaving a melodic hook. Minimal distortion; space and rhythm over density."
    },
    "groove": {
      "feel": "Riddim-first, spacious 4/4 with a heavy backbeat emphasis and strong offbeat weighting. The kick sits in dancehall spacing (not four-on-the-floor) leaving the '1' breathing room; the snare/rim anchors 2 and 4; the skank and hats push everything onto the upbeats. The result rolls and bounces rather than drives - built for winding/whining dance movement and sound-system space. Afrobeats DNA adds a slightly looser, more percussive pocket than strict Jamaican dancehall.",
      "pocketNotes": "SPACE is the instrument. Keep arrangements minimal so the sub-bass and voice dominate; resist filling every gap. Lock bass to kick, put the skank dead on the offbeat, and let the shaker drive the subdivisions. The magic is the tension between the on-beat kick/snare and the off-beat skank/bass. Slightly ahead-of-the-beat hats and slightly laid-back snare give the human bounce.",
      "swing": "Light to moderate swing (roughly 8-15% on 16ths); enough to bounce, never straight-machine stiff and never full triplet shuffle. The shaker and hats carry most of the swing feel.",
      "syncopation": "High. Sub-bass and vocal phrasing are heavily syncopated around the downbeat; skank and organ live entirely on the offbeats. Percussion layers add cross-rhythms (Afro polyrhythm) against the steady backbeat, but the core stays danceable and repetitive, never busy for its own sake."
    },
    "vocalStyle": {
      "delivery": "Singjay - the signature dancehall blend of half-sung melody and half-chanted toasting/deejaying. Ranges from smooth melodic hooks to rapid rhythmic patois toasting on verses. Rhythmic, percussive phrasing that locks to the riddim; the voice functions as another percussion-melody instrument. Confident, chest-forward, often nasal-bright on the highs and soulful/gravelly on the lows for contrast. Call-and-response and crowd-directed phrasing ('sen it', 'pull up', 'wine fi mi') are structural, not decorative.",
      "adLibs": [
        "Bram!",
        "Pull up! / Pull up selecta!",
        "Sen' it!",
        "Brrrap / brraaa (gun-finger vocal)",
        "Yow!",
        "Zeen / seen",
        "Wine (fi mi) / whine",
        "Big up!",
        "Skibidibop / bing-bing percussive scats",
        "Wooii! / oii!",
        "Blessup / more life",
        "Ay!"
      ],
      "harmonyApproach": "Hooks are stacked and doubled - lead plus a unison double and a third/sixth harmony, often with an octave-up layer for lift on the final chorus. Verses usually stay single-tracked and dry for intimacy and clarity of the patois. Ad-libs are panned wide and thrown into every gap, sometimes drenched in delay. Backing chants/gang vocals used for the biggest sing-along hooks.",
      "languageMix": "Core delivery is Jamaican Patois and/or Nigerian Pidgin English, mixed with plain English for chorus accessibility, plus occasional Yoruba/Igbo or local-language phrases and place-name shout-outs. Code-switching between patois toasting on verses and cleaner English/pidgin on hooks is characteristic and marks the Afro-Caribbean fusion."
    },
    "signatureElements": [
      "Offbeat skank stab (guitar/organ chord on the upbeats) - the defining sonic fingerprint",
      "Deep melodic sub-bass riddim that the track is built around and effectively named after",
      "Reggae/dancehall organ 'bubble' pattern",
      "Dub delay/reverb throws on snare hits and vocal tails",
      "Air-horn, dub-siren and gun-finger 'brrrap' vocal punctuation",
      "Singjay vocal - half-sung, half-toasted, in patois/pidgin",
      "Sparse, space-forward arrangement built for sound-system and dancing",
      "West-African melodic overlay (highlife guitar line / marimba / kalimba) layered onto the Caribbean riddim - the AFRO in Afro-dancehall",
      "Call-and-response, crowd-directed ad-libs ('pull up', 'wine', 'sen it')",
      "Static one-to-two-chord vamp letting groove and voice lead over harmony"
    ],
    "referenceArtists": [
      "Patoranking",
      "Timaya",
      "Burna Boy (dancehall-leaning cuts)",
      "Runtown",
      "Cynthia Morgan",
      "Stonebwoy (Ghana)",
      "Shatta Wale (Ghana)",
      "Popcaan",
      "Konshens",
      "Charly Black",
      "Sean Paul",
      "Vybz Kartel"
    ],
    "mixTraits": {
      "lowEnd": "Sub-bass is the star - deep, rounded, loud and clean, sidechained or carved so it never clashes with the kick. Both kick and sub occupy the low end but are EQ-slotted (kick punch ~60-100Hz, sub weight ~40-60Hz) so both are felt. Low end is the loudest, most present element - tuned for club/sound-system playback.",
      "drums": "Punchy and up-front but not wall-to-wall; snare/rim is crisp and often heavily compressed for slap, hats bright and airy on the offbeats. Drums leave gaps - the groove is defined as much by silence as by hits. Transient-forward, minimal room on the kick.",
      "vocals": "Lead vocal sits clear and forward, present-boosted for the patois to cut. Verses relatively dry and intimate; hooks widened with doubles/harmonies. Liberal use of dub-style delay throws (1/4 and 1/8 dotted feedback) and reverb tails on ad-libs and phrase ends for that sound-system echo. Autotune light-to-moderate as a texture, not a crutch.",
      "space": "Deliberately spacious and dub-influenced - reverb and delay create depth and 'throws' rather than dense layering. Wide stereo on skank, hats, ad-libs and percussion; mono-locked kick, sub and lead vocal down the center. Contrast between dry punch (drums/vocal) and wet ambience (throws/tails) is a defining trait.",
      "loudness": "Loud, club-ready master with strong low-end weight and controlled transients; punchy but retaining the dynamic 'bounce' of the groove rather than being brick-walled flat. Energy comes from arrangement and low-end impact, not just level."
    },
    "productionPromptSnippet": "Afro-dancehall, 92-110 BPM (sit ~102), 4/4, minor-key riddim (Aeolian, e.g. Am) or bright major for party cuts. Riddim-first and spacious: deep melodic sub-bass locked to a dancehall-spaced kick, crisp compressed rim/snare on 2 & 4, offbeat hi-hats, shekere driving 16ths, light swing. Signature offbeat skank stab (muted guitar or organ) on the upbeats + reggae organ 'bubble'. Layer a bright West-African highlife guitar line or marimba/kalimba for the Afro flavor. Static 1-2 chord vamp (i-VI-VII or I-IV). Vocals: singjay - half-sung, half-toasted in Patois/Pidgin, stacked harmonized hook, wide ad-libs ('pull up', 'brrrap', 'wine') with dub delay throws. Loud club low-end, dub reverb/delay space, gaps left open for the voice.",
    "freshnessGuardrails": "Capture the LANE, never a specific record. Do: build an ORIGINAL sub-bass riddim line and your own melodic skank/organ pattern; write fresh hooks and toasting phrases; use the genre's stock ad-lib vocabulary ('pull up', 'brrrap', 'wine') and structural devices, which are shared idiom, not any one song. Don't: reproduce a recognizable existing bassline, topline, hook melody, or lyric from any named reference artist or track; don't clone a specific famous riddim (riddims are named, reused instrumentals - avoid recreating an identifiable one). Vary chord vamp choice, key, tempo within range, and the specific Afro melodic instrument (highlife guitar vs marimba vs kalimba) between generations to stay distinct. Reference artists are directional touchstones for FEEL and instrumentation only - match the genre's groove, pocket, and sonic palette, not the melodic or lyrical content of their catalog.",
    "sources": [
      "Musicological domain knowledge of dancehall, reggae and Afrobeats production",
      "Public genre-education and music-production references (BPM/tempo guides, dancehall/reggae production articles)",
      "Publicly documented artist and genre background (encyclopedic and music-press coverage of Afro-dancehall)"
    ]
  },
  "street_pop": {
    "genre": "street_pop",
    "displayName": "Street-Pop (Afro / Lagos Street)",
    "bpmRange": [
      100,
      126
    ],
    "typicalBpm": 115,
    "commonKeys": [
      "A minor",
      "E minor",
      "B minor",
      "F# minor",
      "C# minor",
      "G minor",
      "D minor"
    ],
    "chordProgressions": [
      {
        "roman": "i - VI - III - VII",
        "description": "The core Lagos-street minor loop (e.g. Am-F-C-G). Warm, gospel-adjacent, endlessly loopable under chant vocals; the harmonic bed of the log-drum/omopiano-tinged wave.",
        "whereUsed": "Verse + hook bed on Asake-style and modern street-pop records; the default 4-bar keys loop."
      },
      {
        "roman": "i - VII - VI - VII",
        "description": "Darker, more hypnotic Aeolian rock (Am-G-F-G). Fewer chord changes = more space for percussion and the vocal to drive; classic Zanku/shaku energy.",
        "whereUsed": "Dance-craze street-hop and Marlian-lane bangers where the beat, not harmony, carries."
      },
      {
        "roman": "i - iv - VII - III",
        "description": "Fuji/highlife-inflected minor turnaround (Am-Dm-G-C) that leans on the flat-VII for a churchy lift; supports call-and-response choir stacks.",
        "whereUsed": "Bridge/pre-hook lifts and choir-anchored records with a spiritual/communal feel."
      },
      {
        "roman": "I - IV - V (major, highlife lean)",
        "description": "Bright major turnaround borrowed from highlife/juju when a record wants a celebratory, palm-wine feel rather than street menace.",
        "whereUsed": "Feel-good crossover street-pop and lighter party cuts."
      },
      {
        "roman": "i (static, one-chord vamp)",
        "description": "Single-chord modal vamp with all movement in the bassline and percussion; maximizes negative space for lamba ad-libs and the shaker to breathe.",
        "whereUsed": "Hardest, most percussion-forward street bangers and drops."
      }
    ],
    "arrangement": [
      {
        "section": "Intro / Producer tag",
        "bars": "1-4",
        "whatHappens": "Signature producer tag drops first (culturally mandatory - e.g. a spoken/vocal-chopped tag), then log drum or kick + shaker establish the pocket. Often a lone chant or ad-lib teases the hook."
      },
      {
        "section": "Verse 1",
        "bars": "5-20",
        "whatHappens": "Percussive, half-sung/half-rapped vocal in Lagos street Yoruba/Pidgin over a stripped groove: kick, shaker (shaker 101), rimshot/clap, log drum or 808 bass. Sparse keys; heavy negative space for lamba ad-libs (gunshot/glass-break FX, 'eh!', 'ah!')."
      },
      {
        "section": "Pre-hook / Lift",
        "bars": "21-24",
        "whatHappens": "Percussion opens up, a choir/backing stack or synth pad swells, filtered build or drum roll signals the hook. Bass may drop out for one bar of tension."
      },
      {
        "section": "Hook / Chorus",
        "bars": "25-40",
        "whatHappens": "Full groove: log drum + 808 slide, layered choir/gang chants doubling the lead, call-and-response, catchy singalong lamba phrase repeated. This is the dance-craze moment - the most memorable, most-looped section."
      },
      {
        "section": "Verse 2",
        "bars": "41-56",
        "whatHappens": "Same bed as V1 but with added percussion layers (congas, extra hats, whistle/talking-drum stabs) and denser ad-libs; may bring a feature verse."
      },
      {
        "section": "Hook (repeat)",
        "bars": "57-72",
        "whatHappens": "Hook returns, fuller - stacked harmonies, extra choir, ad-lib runs on top. Small variation or key rise sometimes added."
      },
      {
        "section": "Bridge / Breakdown",
        "bars": "73-80",
        "whatHappens": "Percussion breakdown or choir-only a cappella moment; the pocket strips to shaker + claps + vocal to reset energy before the final lift."
      },
      {
        "section": "Outro",
        "bars": "81-88",
        "whatHappens": "Final hook or extended chant vamp; instruments peel away leaving shaker/percussion and ad-libs, often ending on the producer tag or a spoken sign-off."
      }
    ],
    "instrumentation": {
      "core": [
        "Punchy kick (four-on-floor-adjacent or syncopated street pattern)",
        "Log drum (Amapiano/omopiano-style pitched bass drum) OR 808 sub with pitch slides",
        "Shaker (bright, driving 'shaker 101' 16th-note pulse - the signature engine)",
        "Rimshot / clap / snare backbeat",
        "Simple piano or synth-keys chord loop (4-bar minor vamp)"
      ],
      "signature": [
        "Log drum / omopiano pitched-bass slides",
        "Layered real choir / gang vocal chants (call-and-response)",
        "Lamba street-life SFX: gunshot, glass-break, sirens, cash-register",
        "Talking drum / gangan or fuji-style percussion accents",
        "Producer voice tag as an intro hook",
        "Whistle blasts and vocal-chop stabs"
      ],
      "percussion": [
        "Shaker (16th-note driver)",
        "Congas / bongos",
        "Talking drum (gangan)",
        "Sakara/apala-derived hand percussion (fuji lineage, now often electronic)",
        "Rimshots, claps, finger snaps",
        "Shekere / caxixi rattles",
        "Tom fills (pangolo/wobe lineage) for builds"
      ],
      "bass": "Either a pitched log drum functioning as melodic bass (Amapiano-fused wave) or a hard 808 sub with portamento slides (Zanku/street-hop wave). Bass is rhythmic and hooky, not just a root drone - it often carries the groove's countermelody.",
      "keys": "Simple, repetitive piano or synth-pad chord loop - warm, slightly gospel/highlife voicing, low in the mix under the vocal. Rarely busy; leaves room for percussion.",
      "guitar": "Occasional highlife/juju-style clean guitar arpeggios or single-note lines in lighter, palm-wine-leaning records; not present in the hardest percussion-driven cuts."
    },
    "groove": {
      "feel": "High-energy, forward-leaning dance pocket built for legwork/zanku and shaku-shaku movement. Constant 16th-note shaker pulse drives the groove; the kick and log-drum/808 lock into a bouncy, slightly ahead-of-the-beat feel.",
      "pocketNotes": "Percussion-first: the beat carries the record, harmony is secondary. Lots of deliberate negative space in verses so the vocal and lamba ad-libs punch through. The log drum or 808 lands on syncopated off-beats to create the signature bounce. Danceability is the design goal - if it doesn't move the body it fails.",
      "swing": "Light-to-moderate swing on hats/shakers (roughly 8-16% depending on the record); straighter and harder on Zanku-lineage cuts, looser and more triplet-tinged where Amapiano/fuji influence is strong.",
      "syncopation": "Heavy. Yoruba/African polyrhythm underpins everything - talking-drum and conga accents cut across the kick, and the log drum/808 syncopates against the four-on-floor pulse. Call-and-response vocal phrasing adds another rhythmic layer."
    },
    "vocalStyle": {
      "delivery": "Percussive, chant-forward, half-sung/half-rapped - closer to fuji declamation than smooth R&B. The voice is used as a rhythm instrument: raw, gritty, confident, often talk-singing and declaring rather than crooning. Delivered in Lagos street Yoruba, Nigerian Pidgin and lamba (street slang), heavy on proverbs, boasts and storytelling.",
      "adLibs": [
        "eh!",
        "ah!",
        "yeah yeah yeah",
        "gbedu",
        "omo",
        "ah-ah",
        "Mr Money / signature name-drops",
        "whistle imitations",
        "gunshot/glass-break vocalized FX",
        "choir 'oh-oh-oh' swells",
        "sharp inhales and grunts as percussion"
      ],
      "harmonyApproach": "Layered call-and-response between lead and a real (not synth) choir/gang stack. Hooks are doubled and thickened with 3rd/5th harmonies and octave gang vocals for a communal, spiritual, singalong feel. Verses stay mostly monophonic to preserve punch; harmonies bloom on the hook.",
      "languageMix": "Predominantly Lagos street Yoruba + Nigerian Pidgin, peppered with English catchphrases and lamba slang; occasional Igbo/Hausa flavor. Deliberately not 'proper' Yoruba - it's the raw neighborhood dialect of Mushin, Bariga, Oshodi, Ajegunle."
    },
    "signatureElements": [
      "The driving 'shaker 101' 16th-note shaker as the groove's engine",
      "Log drum / omopiano pitched bass fused with Amapiano (the modern wave)",
      "Or hard sliding 808 for the Zanku/street-hop wave",
      "Real layered choir + gang chants (call-and-response, communal)",
      "Fuji-derived percussive vocal delivery and Yoruba proverbs",
      "Lamba street SFX (gunshots, glass, sirens) as texture",
      "Producer voice-tag as the intro hook",
      "A built-in dance craze / catchphrase designed to go viral",
      "Talking drum (gangan) and conga polyrhythmic accents",
      "Deep negative space in verses for ad-lib punch"
    ],
    "referenceArtists": [
      "Asake",
      "Zlatan",
      "Naira Marley",
      "Olamide",
      "Bella Shmurda",
      "Zinoleesky",
      "Small Doctor",
      "Seyi Vibez",
      "Mohbad",
      "Slimcase",
      "Idowest",
      "Mr Real",
      "Portable"
    ],
    "mixTraits": {
      "lowEnd": "Big, punchy and hooky - log drum or 808 sub is prominent and often functions as a lead-bass melody. Kick and sub carefully carved so both hit hard without masking; the low end must translate on phone speakers and club systems alike.",
      "drums": "Percussion is loud and up-front - shaker and claps sit bright and forward, drums are the star. Punchy transients, minimal reverb on the core kit to keep it tight and danceable.",
      "vocals": "Lead vocal sits present and slightly gritty (not over-polished); light autotune/pitch correction as a stylistic texture rather than a mask. Choir/gang stacks are wide and lush behind the lead. Ad-libs panned and thrown around the stereo field.",
      "space": "Dry, tight and punchy overall with selective wide reverb/delay on choir swells and ad-libs. Wide stereo on chants and percussion accents; center-focused kick, sub and lead.",
      "loudness": "Loud, radio/streaming-hot masters (roughly -8 to -6 LUFS integrated) with aggressive but musical limiting; energy and impact prioritized over dynamic range."
    },
    "productionPromptSnippet": "Lagos street-pop: 100-126 BPM (aim ~115), minor key (Am/Em/Bm), 4-bar loop i-VI-III-VII or static one-chord vamp. Percussion-first pocket - driving 16th-note shaker, punchy syncopated kick, and either an Amapiano/omopiano LOG DRUM as melodic bass or a hard sliding 808. Talking drum, congas, claps add polyrhythm. Warm gospel-tinged piano loop low in mix. Percussive half-sung/half-rapped vocal in Lagos street Yoruba + Pidgin, fuji-style chant delivery, gritty confident, light autotune. Layered REAL choir gang chants, call-and-response hook, singalong lamba catchphrase built for a dance craze. Lamba SFX (gunshot, glass, whistle). Deep negative space in verses. Loud punchy dry mix, big hooky sub, bright forward percussion.",
    "freshnessGuardrails": "Capture the LANE, never a specific record. Do: build an original minor loop and a fresh log-drum/808 bass melody; write a NEW lamba catchphrase and dance-craze hook in your own street-Yoruba/Pidgin phrasing; use the shaker-driven pocket, call-and-response choir, fuji-percussive delivery and negative-space arrangement as structural DNA. Don't: reuse any known melody, top-line, chant, ad-lib phrase, producer tag, or lyric from Asake, Zlatan, Naira Marley, Olamide or any named artist; don't clone a specific song's exact chord rhythm, drum fill signature or hook cadence. The genre = its groove template, instrumentation and vocal culture - not any one artist's fingerprint. Aim for a record that could sit ON the playlist without echoing anything already ON it.",
    "modalFlavor": "Predominantly Aeolian (natural minor) - the flat-VI, flat-III and flat-VII give the warm, slightly melancholic-yet-danceable street feel. Fuji/highlife lineage occasionally injects Mixolydian brightness (major with flat-VII) on celebratory cuts. Melodies are pentatonic-leaning with Yoruba call-and-response phrasing; ornamentation and micro-bends come from the fuji/apala vocal tradition rather than Western scale runs.",
    "sources": [
      "Genre musicology and public music journalism (DJ Mag street-hop longread, artist biographies, album reviews)",
      "Publicly documented production knowledge (BPM guides, Afrobeats/Amapiano production writeups)",
      "General cultural/historical knowledge of Lagos street music (galala, konto, shaku-shaku, zanku, fuji lineage)"
    ]
  },
  "afro_rnb": {
    "genre": "afro_rnb",
    "displayName": "Afro-R&B",
    "bpmRange": [
      80,
      108
    ],
    "typicalBpm": 98,
    "commonKeys": [
      "A minor",
      "B minor",
      "C# minor",
      "F# minor",
      "E minor",
      "G major",
      "C major",
      "D minor"
    ],
    "chordProgressions": [
      {
        "roman": "i - VII - VI - VII",
        "description": "Aeolian minor loop that never fully resolves; the sustained VII keeps it hovering and emotive. Chords voiced as min9 / add-color rather than plain triads. The Afro-R&B workhorse for moody, mid-tempo cuts.",
        "whereUsed": "Verses and full-song loops in melancholic/late-night records"
      },
      {
        "roman": "i - iv - VII - III",
        "description": "Minor loop with a lift into the relative major (III) for a brief brightening; iv often played as min7 or min9. Gives the 'bittersweet' Afro-R&B feel.",
        "whereUsed": "Pre-chorus / chorus of emotive ballads and love songs"
      },
      {
        "roman": "ii7 - V7 - Imaj7 - vi7",
        "description": "R&B / neo-soul turnaround borrowed straight from the soul tradition; extended 7th/9th voicings, smooth voice-leading on Rhodes or nylon guitar. Adds sophistication to Afropop-leaning cuts.",
        "whereUsed": "Bridges and jazzier, more polished tracks"
      },
      {
        "roman": "Imaj7 - iii7 - vi7 - IVmaj7",
        "description": "Bright major-key gospel-soul loop; all chords carry 7ths/9ths. Warm, uplifting Afro-R&B in the mid-tempo pocket.",
        "whereUsed": "Feel-good singles and radio-facing hooks"
      },
      {
        "roman": "i - VI - III - VII",
        "description": "Andalusian-adjacent descending minor loop; strong, singable and slightly dramatic. Common when the record wants momentum without going full Afrobeats.",
        "whereUsed": "Uptempo Afro-R&B / crossover choruses"
      },
      {
        "roman": "vi7 - ii7 - V7 - Imaj7",
        "description": "Full ii-V-I with a minor pickup; deepest neo-soul harmony in the lane, often with tritone subs or a bVII passing chord. Used sparingly for a 'grown & sexy' texture.",
        "whereUsed": "Slow jams, outros, and jazz-tinged interludes"
      }
    ],
    "arrangement": [
      {
        "section": "Intro",
        "bars": "1-8",
        "whatHappens": "Atmospheric open: wide reverbed pad or filtered Rhodes/nylon-guitar arpeggio establishes the harmonic loop. Often a lone vocal ad-lib, hummed melody, or pitched-down vocal chop floats over sub-bass swells. Percussion held back or filtered; sets the emotional mood before the pocket lands."
      },
      {
        "section": "Verse 1",
        "bars": "9-24",
        "whatHappens": "Full pocket drops in: syncopated afrobeats/R&B kick pattern, laid-back shaker/rimshot groove, plucky sub-bass locking with the kick. Lead vocal enters conversational and breathy, sitting slightly behind the beat. Sparse arrangement leaves space; light guitar licks or Rhodes stabs answer vocal phrases."
      },
      {
        "section": "Pre-Chorus",
        "bars": "25-32",
        "whatHappens": "Harmonic lift (move to iv or III), rising vocal melody, stacked background 'oohs' fade in. Percussion adds a fill or open hat; energy tightens to set up the hook."
      },
      {
        "section": "Chorus / Hook",
        "bars": "33-48",
        "whatHappens": "Fullest arrangement: layered lead + tight harmony stack, catchy repeated melodic hook, brighter pad and possibly a log-drum or heavier 808 sub for weight. Ad-libs ('yeah', 'mmm', 'eh') fill the gaps. The clave/pocket is at its most infectious here."
      },
      {
        "section": "Verse 2",
        "bars": "49-64",
        "whatHappens": "Return to sparser texture but with one added element (extra perc layer, counter-melody, or a guest verse). Vocal delivery more rhythmic/confident. Occasional pitched vocal chop or guitar answer keeps interest."
      },
      {
        "section": "Chorus / Hook",
        "bars": "65-80",
        "whatHappens": "Hook repeats, now with extra ad-lib runs and denser harmony stacks; sometimes a beat-switch feel or added percussion break for lift."
      },
      {
        "section": "Bridge / Breakdown",
        "bars": "81-96",
        "whatHappens": "Strip back to Rhodes/guitar + vocal for an intimate moment, or shift to a jazzier turnaround (ii-V-I). Space for a melismatic vocal run, spoken-word, or key emotional line. Builds tension before final hook."
      },
      {
        "section": "Final Chorus + Outro",
        "bars": "97-120",
        "whatHappens": "Last hook with maximum ad-libs, improvised vocal runs, and full harmony. Outro loops the progression while elements filter out one by one, ending on a lingering pad, vocal tag, or the guitar/Rhodes motif from the intro for a cyclical close."
      }
    ],
    "instrumentation": {
      "core": [
        "Syncopated afrobeats/R&B kick (round, punchy, not four-on-the-floor)",
        "Rubbery sub-bass or muted 808 locked to the kick",
        "Shaker and rimshot/cross-stick groove",
        "Electric piano (Fender Rhodes / Wurlitzer) or lush warm pads",
        "Nylon-string or clean electric guitar licks (highlife-adjacent)",
        "Lead vocal with stacked background harmonies",
        "Keep the arrangement uncluttered - Afro-R&B breathes; space between elements matters as much as the parts"
      ],
      "signature": [
        "Warm Rhodes chords with 7th/9th extensions",
        "Nylon/clean guitar answering the vocal (call-and-response)",
        "Wide, airy reverb-washed synth pads",
        "Pitched vocal chops and reversed vocal textures (alte influence)",
        "Laid-back 'behind-the-beat' pocket with subtle swing",
        "Breathy, close-mic'd lead vocal as the emotional centerpiece"
      ],
      "percussion": [
        "Shaker (steady 8th/16th feel, the groove's pulse)",
        "Rimshot / cross-stick backbeat",
        "Congas and bongos (syncopated fills)",
        "Talking drum or log drum accents (log drum on more amapiano-leaning cuts)",
        "Claps / finger snaps layered on the backbeat",
        "Woodblock, cowbell, or shekere for polyrhythmic color"
      ],
      "bass": "Rounded, melodic sub-bass or muted 808 that plays a rhythmic, syncopated line locking tightly with the kick; carries the groove and often outlines the chord roots with occasional slides/glides.",
      "keys": "Fender Rhodes / Wurlitzer electric piano playing extended jazz/neo-soul voicings (min9, maj7, add9); occasional warm analog synth or organ. Chords are the harmonic bed, voiced smoothly with careful voice-leading.",
      "guitar": "Nylon-string (Spanish/classical) or clean single-coil electric playing sparse highlife-flavored licks, palm-muted plucks, and chordal answers to the vocal; often drenched in light reverb/delay for a spacious feel."
    },
    "groove": {
      "feel": "Mid-tempo, laid-back and sensual; a hypnotic loop-based pocket that sits comfortably 'in the cut'. Emotionally warm rather than aggressive - the groove seduces rather than drives.",
      "pocketNotes": "Lead vocals and melodic elements sit slightly BEHIND the beat for a relaxed, dragging feel, while the shaker/percussion keeps a tight forward pulse - the tension between the two creates the signature Afro-R&B pocket. The kick is round and syncopated (never a rigid four-on-the-floor); the bass locks to it. Leave air between hits; do not overfill the grid.",
      "swing": "Subtle swing of roughly 8-16% on hats/shakers; enough to loosen the 16ths and give a human, rolling feel without going full triplet-shuffle.",
      "syncopation": "Rooted in a 3-2 (or 2-3) clave feel underpinning the drum programming. Percussion and bass are heavily syncopated and polyrhythmic (congas, rimshots, shakers interlocking), while vocals and chords float more legato on top - the polyrhythm lives in the drums, the smoothness lives in the melody and harmony."
    },
    "vocalStyle": {
      "delivery": "Breathy, intimate, close-mic'd and soulful. Melisma and vocal runs borrowed from R&B/gospel, delivered with a relaxed, conversational phrasing that sits behind the beat. Emotive and vulnerable; texture and tone often matter more than lyrical density. Ranges from smoky/husky lower-register (Tems lane) to bright agile Afropop belting (Ayra Starr lane). Pidgin English, Yoruba/Igbo phrases, and English blend naturally.",
      "adLibs": [
        "yeah / yeah yeah",
        "mmm / mmmh",
        "eh / ehen",
        "oh / ohh",
        "baby",
        "come on",
        "woah",
        "la la la / hummed melodies",
        "pidgin interjections (e.g. 'omo', 'chai', 'abeg')"
      ],
      "harmonyApproach": "Dense stacked background harmonies (3-5 parts) using R&B/gospel-style close voicings and thirds/sixths; self-harmonized doubles panned wide. Hooks often carry a full harmony stack while verses stay mostly single-tracked with occasional doubles. Ad-lib layers improvised freely around the lead in the gaps.",
      "languageMix": "Primarily English and Nigerian Pidgin, seasoned with Yoruba, Igbo, or other local-language phrases and slang; code-switching mid-line is idiomatic and expected."
    },
    "signatureElements": [
      "Warm Rhodes/Wurlitzer chords with jazz/neo-soul 7th and 9th extensions",
      "Nylon or clean guitar licks in call-and-response with the vocal (highlife DNA)",
      "Laid-back pocket where vocals drag behind a tight percussion pulse",
      "Breathy, intimate lead vocal as the emotional focal point",
      "Dense stacked R&B/gospel harmony on hooks + free improvised ad-libs",
      "3-2 clave-rooted syncopated percussion (shakers, congas, rimshots, talking drum)",
      "Rubbery syncopated sub-bass / muted 808 locked to a round kick",
      "Wide reverb-washed pads and pitched/reversed vocal chops (alte texture)",
      "Code-switching lyrics: English + Pidgin + Yoruba/Igbo",
      "Spacious, uncluttered arrangement that lets the groove breathe"
    ],
    "referenceArtists": [
      "Tems",
      "Wizkid",
      "Ayra Starr",
      "Fireboy DML",
      "Joeboy",
      "Amaarae",
      "Oxlade",
      "Ladipoe",
      "Simi",
      "Bloody Civilian",
      "Nonso Amadi",
      "Odunsi (The Engine)",
      "Lojay",
      "Buju / BNXN"
    ],
    "mixTraits": {
      "lowEnd": "Warm, controlled, round low end. Sub-bass/808 and kick share the bottom via sidechain or a narrow notch on the bass where the kick hits (~50-70Hz) so both punch cleanly. Bottom is present and smooth, not overloaded - this lane favors musicality over trap-style booming sub.",
      "drums": "Punchy but not harsh; kick sits round and forward, shakers/hats bright and airy up top with light saturation. Percussion panned wide for a 3D polyrhythmic bed. Transients tamed slightly for a smooth, cohesive groove rather than aggressive attack.",
      "vocals": "Lead vocal upfront, warm and intimate with gentle de-essing; light-to-moderate compression to keep the breathy dynamics. Lush plate/hall reverb and slap/1-8th delay throwing tails into the gaps. Harmony stacks tucked under and panned wide; ad-libs bounce between the sides for width.",
      "space": "Wide, deep and atmospheric. Generous reverb and delay create a spacious, late-night ambience; heavy use of stereo width on pads, guitar and harmonies. Center reserved for lead vocal, kick and bass. Air and negative space are deliberate mix elements.",
      "loudness": "Musical, dynamic master - moderate loudness (streaming-friendly, roughly -9 to -8 LUFS integrated) that preserves the breathy dynamics and groove feel rather than a brick-walled, maximally-crushed master. Prioritizes warmth and vocal clarity."
    },
    "productionPromptSnippet": "Afro-R&B: mid-tempo 90-105 BPM, minor-key emotive loops (i-VII-VI or i-iv-VII-III) with neo-soul 7th/9th voicings. Warm Fender Rhodes chords, nylon/clean guitar licks answering the vocal (highlife DNA), wide reverb-washed pads, pitched vocal chops. Laid-back pocket: breathy intimate lead vocal drags behind a tight 3-2 clave percussion pulse (shakers, congas, rimshots, talking drum) with subtle swing. Rubbery syncopated sub-bass locked to a round, non-four-on-the-floor kick. Dense stacked R&B/gospel harmonies on the hook, free improvised ad-libs (yeah, mmm, eh) in the gaps. Lyrics code-switch English + Pidgin + Yoruba. Spacious, uncluttered, warm, sensual, late-night. Wide stereo, dynamic musical master - not brick-walled.",
    "freshnessGuardrails": "Capture the LANE, never a specific song. Generate ORIGINAL melodies, chord voicings, lyrics and hooks from scratch - do not reproduce, quote, or closely paraphrase any existing artist's topline, lyric, or signature riff. The reference artists (Tems, Wizkid, Ayra Starr, etc.) define the sonic territory only; treat them as a compass, not a template - do not imitate an identifiable voice, ad-lib signature, or catchphrase belonging to any one artist. Use the genre conventions (pocket, instrumentation, harmony, structure) as raw ingredients and recombine them freshly: vary the progression order, invent new melodic contours, and write new lyrics. Aim for 'unmistakably Afro-R&B, unmistakably new'. Avoid cliche filler; earn the emotion through fresh melody and space rather than copying what already exists.",
    "modalFlavor": "Predominantly Aeolian (natural minor) for the emotive, hovering feel, with frequent borrowing from Dorian (raised 6th) for a smoother, jazzier lift. Major-key cuts lean Ionian with strong gospel/mixolydian flavor (bVII borrowing). Extended tertian harmony (7ths, 9ths, 11ths) colors nearly every chord regardless of mode.",
    "sources": [
      "General musicological knowledge (public-domain music theory: modes, clave, extended harmony)",
      "Publicly available genre-education/journalism (Wikipedia, GRAMMY.com, NPR, Rolling Stone, Spotify Newsroom)",
      "Public production-education blogs and BPM/tempo references",
      "No copyrighted song audio, stems, or lyrics were copied or referenced"
    ]
  },
  "gospel": {
    "genre": "gospel",
    "displayName": "Afro-Gospel",
    "bpmRange": [
      100,
      125
    ],
    "typicalBpm": 112,
    "commonKeys": [
      "C major",
      "D major",
      "E major",
      "F major",
      "G major",
      "A major",
      "Bb major",
      "Eb major",
      "Ab major",
      "E minor / A minor (worshipful sections)"
    ],
    "chordProgressions": [
      {
        "roman": "I - IV - V - I",
        "description": "The praise-chorus backbone. Bright, congregational, resolves hard to the tonic. The default engine of up-tempo praise sections.",
        "whereUsed": "Fast praise choruses, congregational hooks, shout choruses"
      },
      {
        "roman": "I - vi - IV - V",
        "description": "Warm, uplifting doo-wop-derived loop common in mid-tempo Afro-gospel and highlife-flavored praise.",
        "whereUsed": "Verses and pre-chorus lifts, highlife-guitar sections"
      },
      {
        "roman": "ii - V - I",
        "description": "Core gospel jazz cadence. Often extended with dominant 7ths, 9ths and 13ths for the 'gospel chord language' color.",
        "whereUsed": "Turnarounds, worship transitions, organ/piano fills"
      },
      {
        "roman": "I - iii - IV - V (with IV/V passing)",
        "description": "Adds the iii for a soulful step; passing chords and secondary dominants (V/ii, V/V) thread between changes.",
        "whereUsed": "Worship ballads, spontaneous-worship pads under exhortation"
      },
      {
        "roman": "vi - IV - I - V",
        "description": "Emotive, reflective loop for slow worship; opens on the relative minor for tenderness before lifting.",
        "whereUsed": "Slow worship / spontaneous worship, intimate verses"
      },
      {
        "roman": "I - I/3 - IV - iv - I (with #IV°7 passing)",
        "description": "Gospel reharmonization move: walk-up bass through the third, borrowed minor iv (backdoor color) and diminished passing chords for that church-organ richness.",
        "whereUsed": "Choir vamps, extended tags, climactic worship swells"
      },
      {
        "roman": "IV - V - vi (deceptive) then IV - V - I",
        "description": "Deceptive resolution used to delay the payoff during vamp cycles before the true resolution and key modulation.",
        "whereUsed": "Vamp build-ups just before a whole/half-step key lift"
      }
    ],
    "arrangement": [
      {
        "section": "Intro",
        "bars": "4-8",
        "whatHappens": "Sparse entry: solo Hammond organ swell, piano vamp, or lone highlife guitar arpeggio. Often a spoken invitation ('Lift your hands', 'Are you ready to praise?') or a lone lead-vocal pickup. Sets key and tempo; may feature a trumpet/horn fanfare motif."
      },
      {
        "section": "Verse 1",
        "bars": "8-16",
        "whatHappens": "Lead vocal enters over half-band groove. Bass and kick establish the pocket, tambourine/shekere on offbeats, guitar plays clean interlocking highlife line. Testimony/scripture-driven lyric, English mixed with Pidgin/local language."
      },
      {
        "section": "Pre-chorus / Lift",
        "bars": "4-8",
        "whatHappens": "Drums open up (ride/toms fill), choir enters in pads or oohs, dynamic and harmonic tension builds toward the hook. Snare/clap intensifies, bass walks up."
      },
      {
        "section": "Chorus (Praise Hook)",
        "bars": "8-16",
        "whatHappens": "Full band + choir. Call-and-response between lead and choir, congregational sing-along melody. Horns/synth stabs punch the offbeats, log-drum or bass bounces. Highest energy, designed to be memorized instantly."
      },
      {
        "section": "Verse 2 / Instrumental break",
        "bars": "8-16",
        "whatHappens": "Second lyrical verse or an instrumental groove break spotlighting guitar, keys or a trumpet line (Nathaniel-Bassey style). Ad-libs begin peppering the gaps."
      },
      {
        "section": "Chorus (repeat)",
        "bars": "8-16",
        "whatHappens": "Hook returns, doubled choir stacks, heavier ad-libs and vocal runs from the lead. Percussion layers thicken (agogo, congas, talking drum accents)."
      },
      {
        "section": "Bridge / Spontaneous Worship",
        "bars": "8-32",
        "whatHappens": "Tempo may soften or the groove drops to pads; the leader shifts into spontaneous/prophetic singing and exhortation over sustained IV-V-I or vi-IV-I-V. Congregational chant or one repeated declarative line. This is the emotional core of Afro-gospel."
      },
      {
        "section": "Vamp / Tag + Key Modulation",
        "bars": "8-24",
        "whatHappens": "Extended vamp on a short loop (often 2-4 bars). One phrase repeated and built; choir and instruments swell. A rising key modulation (up a half or whole step) injects fresh lift. Free ad-libs, runs, shouts and 'Hallelujah/Amen' exchanges peak here."
      },
      {
        "section": "Outro",
        "bars": "4-8",
        "whatHappens": "Either a hard congregational final hit on the tonic, a slow decrescendo into organ pad and spoken benediction, or an open-ended fade under continued spontaneous worship."
      }
    ],
    "instrumentation": {
      "core": [
        "Live/programmed drum kit (kick, snare, tight hats, ride, toms)",
        "Electric bass (round, melodic, walking in gospel passages)",
        "Grand/electric piano (gospel vamping, both-hands block chords)",
        "Hammond B3 organ (swells, drawbar leslie, worship pads)",
        "Highlife-style clean electric guitar (interlocking single-note lines)",
        "Lead worship vocal + full backing choir (SATB stacks)"
      ],
      "signature": [
        "Highlife interlocking guitar lines (bright, palm-muted, call-and-response with vocal)",
        "Hammond organ swells and gospel drawbar chords under worship exhortation",
        "Trumpet / horn-section fanfares and stabs (Nathaniel-Bassey trumpet signature)",
        "Gospel piano vamping with passing chords, tremolo and runs",
        "Antiphonal lead-vs-choir call-and-response stacks",
        "Talking drum (gangan/dundun) pitch-bend accents and shekere shuffle"
      ],
      "percussion": [
        "Tambourine (steady offbeat drive)",
        "Shekere / shakere (shaker shuffle)",
        "Agogo bells (interlocking bell pattern)",
        "Congas / bongos",
        "Talking drum (gangan/dundun) for Yoruba juju flavor",
        "Handclaps and congregational stomps"
      ],
      "bass": "Electric bass sits round and warm, locks with the kick on the one but stays melodic - walking runs and slides into gospel changes, bouncy syncopated pocket in up-tempo praise, sustained root-fifth support under worship. When amapiano-tinged (Afropiano gospel), a rolling log-drum bassline replaces the electric bass in the low end.",
      "keys": "Piano and Hammond organ are the harmonic engine. Piano does two-handed gospel vamping (block chords, tremolos, chromatic passing chords, fast right-hand runs); organ provides sustained drawbar pads, leslie swells and gospel cadences. Synth pads and bright plucks/stabs appear in modern Afrobeats/amapiano-leaning productions.",
      "guitar": "Clean, bright highlife/juju electric guitar plays interlocking single-note and arpeggiated lines that converse with the vocal (call-and-response). Compressed, spring-reverbed, palm-muted picking; rarely power chords. A second rhythm guitar may comp light offbeat skank."
    },
    "groove": {
      "feel": "Buoyant, danceable and forward-leaning in praise; broad, swelling and rubato-tolerant in worship. Two dominant feels coexist: (1) a straight/lightly-swung 4/4 Afrobeats-highlife pocket for up-tempo praise, and (2) a 12/8 or triplet 'shuffle' compound feel for classic African praise and choruses. Pentecostal sets move fluidly between driving praise and slow soaring worship within one medley.",
      "pocketNotes": "Kick anchors the one and drives the bounce; snare/clap and tambourine ride the backbeat and offbeats; the shekere/hats keep a continuous shuffling subdivision. The band breathes with the worship leader - accelerandos into shout choruses, sudden drops for spontaneous worship, and long crescendos over vamps. Percussion is interlocking, not busy; space is left for congregational voice.",
      "swing": "Light swing in Afrobeats-leaning tracks (~54-58%); pronounced triplet swing in 12/8 compound praise and worship. Straight-16th feel in amapiano/Afropiano-gospel crossovers.",
      "syncopation": "Moderate to high - offbeat percussion, syncopated bass bounce and anticipated vocal phrasing. Highlife guitar and horn stabs land on the ands; choir responses answer on the offbeats against the lead's downbeat calls."
    },
    "vocalStyle": {
      "delivery": "Powerful, chest-forward, emotionally committed lead singing with heavy melisma and gospel runs; ranges from intimate conversational worship to full-throated declarative praise and belting at climaxes. Backed by rich SATB choir stacks. Delivery is testimonial and worshipful - the singer is ministering, not just performing - with spontaneous/prophetic spoken and sung exhortation over vamps.",
      "adLibs": [
        "Hallelujah!",
        "Amen!",
        "Yeah / Yes Lord",
        "Thank You Jesus",
        "Somebody shout hallelujah",
        "Ah-ah-ah / oh-oh melismatic runs",
        "Hmmm (worshipful hum)",
        "Lift Him up / Lift your hands",
        "Glory!",
        "We worship You",
        "Mo dupe / Modupe (Yoruba: I give thanks)",
        "Ese (thank you)",
        "Baba (Father)"
      ],
      "harmonyApproach": "Dense gospel choir harmony - SATB block stacks, parallel thirds/sixths on the lead line, tight jazz-gospel voicings with added 9ths and passing tones. Antiphonal call-and-response: lead sings the call, choir/congregation echoes the response. Backing vocals swell in pads under worship and punch rhythmic answers in praise.",
      "languageMix": "Code-switching between English, Nigerian Pidgin, and indigenous languages (Yoruba, Igbo, Efik, plus Zulu/Xhosa in Southern-African-leaning tracks). Praise poetry and names/attributes of God (e.g. Yoruba oriki-style adoration) woven into hooks and vamps."
    },
    "signatureElements": [
      "Praise-to-worship medley structure: fluid movement from driving praise into slow soaring worship within one piece",
      "Extended vamps - one phrase repeated and built over many bars to a spiritual crest",
      "Rising key modulation (half or whole step up) to inject fresh energy in later sections",
      "Antiphonal lead-vs-choir/congregation call-and-response",
      "Spontaneous / prophetic worship: unscripted sung and spoken exhortation over sustained pads",
      "Highlife interlocking guitar lines conversing with the vocal",
      "Trumpet/horn fanfares (Nathaniel-Bassey trumpet signature)",
      "Gospel chord language - extended 7/9/13 voicings, borrowed iv, diminished passing chords, ii-V-I turnarounds",
      "12/8 / triplet compound feel alongside the straight Afrobeats-highlife 4/4",
      "Interlocking African percussion: talking drum, shekere, agogo, tambourine",
      "Multilingual code-switching and indigenous praise-poetry / names of God",
      "Congregational sing-along hooks engineered for instant memorization"
    ],
    "referenceArtists": [
      "Nathaniel Bassey",
      "Sinach",
      "Mercy Chinwo",
      "Dunsin Oyekan",
      "Frank Edwards",
      "Moses Bliss",
      "Victoria Orenze",
      "Tim Godfrey",
      "Ada Ehi",
      "Judikay",
      "Nathaniel Bassey's Hallelujah Challenge collective",
      "Sonnie Badu",
      "Joe Mettle",
      "Minister GUC",
      "Lawrence Oyor"
    ],
    "mixTraits": {
      "lowEnd": "Warm, rounded and controlled low end - electric bass and kick are full but not sub-heavy in traditional praise; in Afropiano-gospel crossovers a deeper log-drum sub anchors the mix. Bass and kick sidechain-glued for a breathing pocket.",
      "drums": "Punchy but organic - live-kit realism with tight, present snare/clap on the backbeat, crisp shuffling hats/shekere, and layered hand percussion panned for width. Drums are energetic yet leave headroom for vocals.",
      "vocals": "Lead vocal sits forward, intimate and present with tasteful plate/hall reverb and slap delay for the 'live sanctuary' sense; choir stacks are wide and lush, glued with bus compression and reverb to sit behind the lead. Ad-libs panned and thrown into delay throws.",
      "space": "Big, reverberant 'live in church/auditorium' ambience - generous hall reverb on choir, organ and horns to evoke a sanctuary. Highlife guitar and percussion spread wide across the stereo field; keys and pads fill the mids.",
      "loudness": "Moderately loud, dynamic-preserving master - loud enough for radio/streaming but retains crescendo dynamics so vamps and modulations still feel like they lift. Not brick-walled; worship sections stay open and breathing."
    },
    "productionPromptSnippet": "Afro-gospel praise & worship, 100-125 BPM (feel ~112). Bright 4/4 highlife-Afrobeats pocket that can shift to 12/8 triplet feel. Live drum kit, round melodic electric bass, gospel piano vamping, Hammond B3 organ swells, interlocking highlife electric guitar, trumpet/horn fanfares. Interlocking African percussion: tambourine, shekere, agogo, talking drum. Powerful lead worship vocal with melisma and runs, full SATB choir call-and-response, code-switching English/Pidgin/Yoruba. Gospel chords (ii-V-I, extended 7/9/13, borrowed iv, diminished passing). Build from praise into slow spontaneous worship; extended vamps, rising key modulation, spoken exhortation. Warm bass, wide lush choir, live-sanctuary reverb, dynamic non-brickwalled master.",
    "freshnessGuardrails": "Capture the LANE, never a specific song. Generate original melodies, lyrics and chord voicings - do not reproduce the toplines, hooks or lyric phrases of Way Maker, Olowogbogboro, Excess Love, Fragrance to Fire, Wonder or any known worship record. Borrow only genre-level conventions: the praise-to-worship arc, call-and-response, extended vamps, rising modulation, gospel chord language, highlife guitar, trumpet fanfares and multilingual praise. Vary tempo, key, progression order and lyric imagery each time. Use generic worship/testimony themes and names/attributes of God in the public devotional tradition, not any artist's signature catchphrase or melody. Reference artists are directional touchstones for authenticity only - never targets to imitate. Aim for the feel of a fresh, unheard Afro-gospel record.",
    "modalFlavor": "Predominantly major/Ionian and bright - Mixolydian inflections from highlife and dominant-7th gospel chords. Worship sections lean into Aeolian/natural-minor and Dorian color via the relative minor and borrowed iv. Gospel reharmonization adds chromatic passing tones, secondary dominants and diminished chords rather than true modal centricity.",
    "sources": [
      "Producer/musicologist domain expertise (Afro-gospel, highlife, gospel harmony practice)",
      "Publicly documented genre conventions (encyclopedic and music-database genre descriptions)",
      "Web search on Afro-gospel / African gospel / gospel-amapiano BPM, structure and instrumentation",
      "General knowledge of widely-known reference artists as factual touchstones (names only)"
    ]
  },
  "afro_pop": {
    "genre": "afro_pop",
    "displayName": "Afro-pop (Afrobeats-lineage pop)",
    "bpmRange": [
      98,
      118
    ],
    "typicalBpm": 107,
    "commonKeys": [
      "B minor",
      "A minor",
      "F# minor",
      "G minor",
      "C# minor",
      "E minor",
      "D minor",
      "G major",
      "C major"
    ],
    "modalFlavor": "Predominantly natural minor (Aeolian) with a strong Dorian tilt — the raised 6th over a minor tonic is a signature Afro-pop color, borrowed from highlife/palm-wine guitar. Major-key tracks lean bright and Ionian but often flirt with the Mixolydian b7 in guitar riffs. Melodies are largely pentatonic/hexatonic (West African pentatonic feel), sitting on the minor pentatonic or major pentatonic even over full triads, which gives the vocal its floating, non-functional lilt. Harmony is loop-based and non-cadential: the same 2- or 4-chord cell repeats through verse and chorus rather than resolving V-I.",
    "chordProgressions": [
      {
        "roman": "i - VI - III - VII",
        "description": "The workhorse minor Afro-pop loop (e.g. Bm-G-D-A). Emotional, anthemic, endlessly repeatable; carries both verse and hook without change.",
        "whereUsed": "Full-song loop; most common in mid-tempo emotional cuts"
      },
      {
        "roman": "i - VII - VI - VII",
        "description": "Descending, hypnotic modal cell (Bm-A-G-A) that never fully resolves — very Dorian/Aeolian, keeps forward motion and a slightly melancholic sway.",
        "whereUsed": "Verse-and-chorus loop for groove-driven, danceable records"
      },
      {
        "roman": "i - iv - VII - III (or i - iv - v)",
        "description": "Warmer, gospel-tinged minor motion with a subdominant pull; the minor v (not major V) keeps it modal rather than classical.",
        "whereUsed": "Bridges, R&B-leaning Afro-pop, soulful pre-choruses"
      },
      {
        "roman": "I - V - vi - IV",
        "description": "Bright major-key pop cell (e.g. G-D-Em-C) used for feel-good, radio-crossover Afro-pop; often the guitar plays a Mixolydian b7 lick over the I.",
        "whereUsed": "Uptempo commercial/crossover records, summer singles"
      },
      {
        "roman": "ii - V - I (borrowed, jazzy)",
        "description": "Occasional highlife/palm-wine inheritance — a brief ii-V color inside an otherwise loop-based song, adding sophistication in the turnaround.",
        "whereUsed": "Guitar interludes, turnarounds, highlife-flavored sections"
      }
    ],
    "arrangement": [
      {
        "section": "Intro",
        "bars": "4-8",
        "whatHappens": "Establish the loop with one or two signature elements only — often the log/talking-drum or shaker groove plus a lone guitar plink or a pad. A spoken tag, producer ID, or vocal ad-lib ('yeah', laughter, artist catchphrase) frequently opens the record. Sparse, sets the pocket."
      },
      {
        "section": "Verse 1",
        "bars": "8-16",
        "whatHappens": "Full drum groove locks in (kick + rimshot/clap + shaker + light conga/talking-drum fills). Sub-bass enters riding the chord roots with syncopated slides. Vocal is conversational, laid-back behind the beat; melody stays in the low-mid register. Chord loop unchanged from intro."
      },
      {
        "section": "Pre-chorus / Lift",
        "bars": "4-8",
        "whatHappens": "Optional. Slight arrangement thinning or a percussion build (add tom fills, open the hats, drop the bass for a bar) to signal the hook. Vocal rises in register; harmonies start stacking."
      },
      {
        "section": "Chorus / Hook",
        "bars": "8-16",
        "whatHappens": "The catchiest, most repeated melodic cell — often the same chord loop as the verse (Afro-pop rarely changes harmony for the chorus; energy comes from vocal, layering, and ad-libs). Stacked vocal harmonies, gang/response vocals, brighter synth or guitar counter-melody, fuller percussion. Ad-libs fill every gap."
      },
      {
        "section": "Post-chorus / Groove break",
        "bars": "4-8",
        "whatHappens": "Instrumental restatement of the hook melody on lead synth/guitar/marimba, or a percussion-forward dance break. This is the 'body-mover' section; vocal drops to ad-libs and chants."
      },
      {
        "section": "Verse 2",
        "bars": "8-16",
        "whatHappens": "Same bed as verse 1, sometimes with one added texture (extra percussion layer, counter-guitar) to keep it fresh. May feature a guest/second vocalist."
      },
      {
        "section": "Bridge / Breakdown",
        "bars": "4-8",
        "whatHappens": "Optional harmonic or dynamic shift: strip to vocal + pad + shaker, or introduce the i-iv-VII borrowed motion. Reverb-drenched, spacious moment before the final lift."
      },
      {
        "section": "Final chorus + Outro",
        "bars": "8-16",
        "whatHappens": "Biggest version of the hook — max vocal stacks, all percussion, ad-lib call-and-response. Outro often loops the groove down with the guitar/log-drum motif and a fading vocal tag or producer signature."
      }
    ],
    "instrumentation": {
      "core": [
        "Programmed/electronic kick (round, punchy, not sub-heavy 808 boom)",
        "Rimshot or tight clap on the backbeat-adjacent hits",
        "Shaker / shekere driving continuous 16th subdivisions",
        "Warm rubbery sub-bass (sine/analog) with syncopated slides",
        "Bright plucky synth lead (pluck/marimba/kalimba-style)",
        "Clean highlife-style electric guitar (single-note, palm-wine picking)",
        "Airy pad or Rhodes/electric piano cushion"
      ],
      "signature": [
        "Highlife/palm-wine clean guitar lines (single-note, syncopated, Mixolydian b7 licks)",
        "Talking drum (dundun) inflections and fills for authentic West African voice",
        "Log-drum-style bass melodies (amapiano cross-pollination on slower cuts)",
        "Kalimba / marimba / mbira plucks as melodic sparkle",
        "Shekere and open shaker as the perpetual-motion timekeeper",
        "Vocal chops and the artist's spoken producer/artist tag"
      ],
      "percussion": [
        "Shaker / shekere (constant 16ths, the heartbeat of the pocket)",
        "Talking drum (dundun) fills and pitched inflections",
        "Congas / bongos (syncopated, lightly played under the machine drums)",
        "Rimshot / cross-stick backbeat",
        "Claps and finger-snaps layered on 2 and 4-adjacent hits",
        "Woodblock / cowbell / agogo bell accents",
        "Tom fills for section transitions"
      ],
      "bass": "Warm, rounded sub-bass — sine or filtered analog, NOT a distorted 808. Plays syncopated root-and-fifth patterns with characteristic pitch slides/glides into notes, locking tightly with the kick and leaving space on the downbeats so the groove breathes. Melodic and bouncy rather than droning; occasionally doubles a log-drum melody on amapiano-adjacent tracks.",
      "guitar": "Clean, bright electric guitar in the highlife/palm-wine tradition — single-note or two-note syncopated riffs high on the neck, with light chorus/reverb, often outlining the pentatonic and dropping a Mixolydian b7. Acts as a hooky counter-melody, not strummed chords.",
      "keys": "Rhodes/electric piano or soft synth pads for harmonic cushion; bright piano stabs and plucky synth arps for melodic hooks. Chords voiced with added 9ths and inversions for color, kept sparse to leave pocket space."
    },
    "groove": {
      "feel": "Mid-tempo, buoyant, danceable 4/4 with a distinctly African polyrhythmic pocket — laid-back and rolling rather than driving. The 'body-mover' bounce comes from continuous 16th-note shaker motion against a kick/rimshot pattern that deliberately leaves space on the downbeats.",
      "swing": "Light-to-moderate swing/shuffle on the 16ths (roughly 54-60% on hi-hats/shakers) — enough to lilt, never a hard triplet shuffle. The groove sits just behind the grid for a relaxed, human sway.",
      "syncopation": "Heavy off-beat emphasis and cross-rhythm — the 3-2 / 2-3 clave-adjacent feel underpins accents. Kick and bass syncopate around the '&' and 'a' subdivisions; talking drum and congas layer contrasting cycles to create polyrhythm. Space is as important as hits.",
      "pocketNotes": "Vocals and lead melodies sit slightly behind the beat (laid-back), while shaker/percussion ride dead-on to hold the pulse. The kick avoids a rigid four-on-the-floor — it plays a syncopated pattern that opens holes for the bass to slide into. Retain a live, hand-percussion feel by keeping micro-timing loose and layering real shekere/conga under the programmed drums."
    },
    "vocalStyle": {
      "delivery": "Conversational, melodic, and effortlessly cool — sung more than rapped, sitting relaxed behind the beat. Ranges from smooth mid-register croon (Wizkid-lane) to gritty baritone-with-attitude (Burna-lane) to breathy, emotive alto (Tems/Ayra-lane). Tasteful Auto-Tune is idiomatic, used as a stylistic sheen not a crutch. Melisma and pentatonic runs inherited from fuji/gospel appear on sustained notes and hook tails.",
      "adLibs": [
        "Eh / eh-eh / yeah",
        "Ah-ah / oh-oh (melodic vocable runs)",
        "Producer/artist tag drop at the intro",
        "Percussive vocables and gbedu chants",
        "Call-and-response gang shouts on the hook",
        "Laughter, 'you know', 'baby', spoken asides",
        "Ay! / Woo! energy punctuations",
        "Whistle / falsetto flip-ups at phrase ends"
      ],
      "harmonyApproach": "Dense stacked harmonies on the hook — thirds and fifths plus unison doubles for thickness, often with a high airy falsetto layer floating on top. Verses are typically single-lead with sparse ad-lib doubles; choruses bloom into 3-6 stacked parts. Call-and-response between lead and a harmonized 'crowd' vocal is a genre hallmark.",
      "languageMix": "Fluid code-switching between Nigerian Pidgin, English, and indigenous languages (Yoruba, Igbo) — sometimes within a single line. Pidgin carries the hook's catchiness and emotional directness; the mix signals authenticity and locality without needing full comprehension to land."
    },
    "signatureElements": [
      "Highlife/palm-wine clean guitar riffs as the melodic signature",
      "Talking drum (dundun) pitched fills for authentic West African voice",
      "Perpetual shaker/shekere 16th-note motion driving the pocket",
      "Warm rubbery sub-bass with syncopated pitch slides (space on downbeats)",
      "Loop-based 2-4 chord harmony that never resolves (i-VI-III-VII feel)",
      "Pentatonic/Dorian melodies floating over minor triads",
      "Laid-back vocal delivery with tasteful Auto-Tune and dense hook harmonies",
      "Pidgin/Yoruba/English code-switching and call-and-response ad-libs",
      "Syncopated kick that leaves holes for the bass to slide into",
      "Kalimba/marimba plucks and bright synth arps for sparkle",
      "Amapiano cross-pollination on slower cuts (log-drum bass melodies)"
    ],
    "referenceArtists": [
      "Wizkid",
      "Burna Boy",
      "Davido",
      "Tems",
      "Rema",
      "Ayra Starr",
      "Asake",
      "Omah Lay",
      "Fireboy DML",
      "CKay",
      "Tiwa Savage",
      "Yemi Alade",
      "Mr Eazi",
      "Joeboy",
      "P-Square",
      "2Baba (2Face Idibia)",
      "Sarkodie",
      "Stonebwoy",
      "Amaarae",
      "BNXN"
    ],
    "mixTraits": {
      "lowEnd": "Warm, rounded, and controlled — the sub-bass is felt not overpowering, sidechained gently to the kick so both breathe. Low end leaves deliberate space on downbeats; no wall-of-808 saturation. High-pass everything above the bass/kick to keep the low end clean and the groove nimble.",
      "drums": "Punchy but not compressed to death — kick is tight and round, shakers/percussion are crisp and slightly forward to sell the pocket. Percussion is panned wide (shakers, congas, talking drum spread across the stereo field) for an enveloping, live-band feel. Transients kept lively; groove stays bouncy, not squashed.",
      "vocals": "Upfront, intimate, and polished — lead vocal sits above the beat with tasteful Auto-Tune, gentle compression, and a bright presence lift. De-essed and clean. Hook stacks glued together and spread wide. Ad-libs panned and delayed for a conversational, surrounding effect.",
      "space": "Spacious and dimensional — generous but tasteful reverb and slap/ping-pong delays create depth without mud. Producers use volume automation and reverb throws for movement. The mix breathes: elements come and go, and silence/space is treated as an instrument.",
      "loudness": "Radio-loud and streaming-optimized (roughly -8 to -10 LUFS integrated) but retaining groove dynamics — the bounce is preserved rather than crushed. Bright, glossy top-end sheen for a modern, expensive sound."
    },
    "productionPromptSnippet": "Afro-pop, 100-115 BPM, minor key (Dorian/Aeolian tilt), loop-based i-VI-III-VII harmony that never resolves. Buoyant syncopated 4/4 pocket: round punchy kick leaving space on downbeats, rimshot backbeat, perpetual shaker/shekere 16ths with light swing, talking drum and conga fills panned wide. Warm rubbery sub-bass with pitch slides, locked to kick. Clean highlife/palm-wine electric guitar riffs, kalimba/marimba plucks, airy pads, bright plucky synth hooks. Laid-back conversational lead vocal (tasteful Auto-Tune) behind the beat, code-switching Pidgin/English/Yoruba, dense stacked hook harmonies, call-and-response ad-libs (eh-eh, yeah, gang shouts). Spacious modern mix, bright top, warm controlled low end, vocals upfront.",
    "freshnessGuardrails": "Capture the LANE, never a specific record. Generate ORIGINAL melodies, chord voicings, lyrics, and top-lines from scratch — the recipe defines idiom (loop-based minor harmony, highlife guitar, shaker pocket, code-switched vocals), not any existing hook. Do NOT reproduce a recognizable melody, lyric, riff, or vocal cadence from any named reference artist's catalog; artists are directional touchstones for TIMBRE and DELIVERY only. Vary the specific chord loop, guitar motif, tempo within range, and ad-lib set each time so outputs are distinct from one another. No sampling, interpolation, or 'in the style of [song]'. Keep Pidgin/indigenous-language use as flavor and cadence, invented fresh — never lifted verbatim from a known track. If a generated phrase feels closely familiar to an existing hit, discard and regenerate.",
    "sources": [
      "Producer/musicologist domain knowledge (Afrobeats/Afro-pop genre conventions)",
      "Public music-theory and BPM references (general, non-copyrighted facts)",
      "General knowledge of West African music traditions (highlife, fuji, palm-wine, amapiano)"
    ]
  },
  "hip_hop": {
    "genre": "hip_hop",
    "displayName": "Afro / Naija Hip-Hop",
    "bpmRange": [
      95,
      140
    ],
    "typicalBpm": 105,
    "commonKeys": [
      "A minor",
      "C minor",
      "F minor",
      "G minor",
      "D minor",
      "E minor",
      "B minor",
      "F# minor"
    ],
    "chordProgressions": [
      {
        "roman": "i - VI - III - VII",
        "description": "The workhorse natural-minor loop of the lane (Aeolian). Warm, singable, endlessly loopable under both rapped verses and sung hooks. In A minor: Am - F - C - G.",
        "whereUsed": "Melodic Afro-rap hooks, Afroswing choruses, most sung-rap fusion records"
      },
      {
        "roman": "i - VII - VI - VII",
        "description": "Darker, more hypnotic minor loop that never fully resolves; keeps tension under aggressive verses. Steel Banglez-style 'dark chords'. In A minor: Am - G - F - G.",
        "whereUsed": "Afro-drill and harder Naija rap verses, moody trap-influenced cuts"
      },
      {
        "roman": "i - iv - VI - v",
        "description": "Adds the minor iv and minor v for a bluesy, highlife-tinged melancholy; less common but signature of soulful street-rap ballads.",
        "whereUsed": "Introspective storytelling records, hustle/struggle narratives"
      },
      {
        "roman": "I - IV - V - I (major, highlife feel)",
        "description": "Bright major highlife-derived cadence for celebratory, feel-good anthems; often voiced on palm-wine-style clean guitar. In C: C - F - G - C.",
        "whereUsed": "Party/celebration hooks, highlife-fusion rap, 'gbedu' anthems"
      },
      {
        "roman": "i - VI - VII - i (with a bVII pivot)",
        "description": "Two-bar vamp that leans on the flat-VII for a modal, non-Western pull; underpins the trance-like repetition Afro records ride on.",
        "whereUsed": "Hypnotic hook loops, amapiano-tinged Afro-rap, extended dance outros"
      }
    ],
    "arrangement": [
      {
        "section": "Intro",
        "bars": "4-8",
        "whatHappens": "Sparse cold open: a single filtered element (log-drum or 808 slide, a clean highlife guitar riff, or a producer tag). Often a lone ad-lib or spoken street phrase in Pidgin. No full drums yet; establishes key and the melodic motif."
      },
      {
        "section": "Hook / Chorus (first)",
        "bars": "8",
        "whatHappens": "Many Afro-rap records lead with the hook, not the verse. Full groove drops in: shaku/dembow-leaning kick pattern, snare/rim on beat 3, shakers, 808 sub. Melodic Auto-tuned vocal or gang-vocal chant. This is the earworm anchor."
      },
      {
        "section": "Verse 1",
        "bars": "16",
        "whatHappens": "Drums thin slightly (pull a percussion layer or drop the topline synth) to spotlight the rap. Flow rides the syncopated pocket in Pidgin/Yoruba/Igbo/English. Ad-libs answer the ends of bars. 808 stays warm and melodic, not just sub-thump."
      },
      {
        "section": "Hook / Chorus",
        "bars": "8",
        "whatHappens": "Full arrangement returns; add a counter-melody or vocal harmony stack on the repeat to lift energy. Percussion busiest here."
      },
      {
        "section": "Verse 2",
        "bars": "16",
        "whatHappens": "Second rap verse, often a feature or a flow/tempo switch. Introduce a new element (talking-drum fill, extra pluck line) so it doesn't feel static."
      },
      {
        "section": "Bridge / Pre-hook or Dance break",
        "bars": "8",
        "whatHappens": "Percussion-forward breakdown: drums and shakers carry it, harmony strips to a vamp, call-and-response chant or crowd-style gang vocals. Built for the dance floor and DJ transitions."
      },
      {
        "section": "Final Hook (double)",
        "bars": "16",
        "whatHappens": "Hook repeated twice with maximum stacking: ad-libs, harmonies, extra percussion. Highest energy point."
      },
      {
        "section": "Outro",
        "bars": "4-8",
        "whatHappens": "Strip back to the intro element(s) plus lingering ad-libs; let the groove ride out or filter down. Often ends on the loop rather than a hard resolve, DJ-friendly."
      }
    ],
    "instrumentation": {
      "core": [
        "Punchy Afro kick with a syncopated, off-grid placement (not four-on-the-floor)",
        "Snare or rimshot landing on beat 3 (the Afrobeats/Afroswing signature backbeat)",
        "Layered shakers and rattles driving the 8th/16th groove",
        "Warm, melodic 808 sub-bass (glides and slides, doubling as bassline)",
        "Trap-derived hi-hat rolls and triplet fills (from the hip-hop side)",
        "Clean highlife/palm-wine electric guitar licks (bright, untreated, syncopated)"
      ],
      "signature": [
        "Log drum (synthesized wooden slit-drum bass-percussion hybrid, amapiano-imported for the modern Afro sound)",
        "Talking-drum (dundun) fills and pitch-bending accents",
        "Shaku-shaku pocket feel and shekere/agogo bell layers",
        "Highlife guitar riff as a recurring hook motif",
        "Wide, airy pad or marimba/mallet pluck for the 'shimmer' between hits",
        "Producer voice tag / DJ tag as an identity stamp"
      ],
      "percussion": [
        "Shekere (beaded gourd shaker)",
        "Agogo / cowbell",
        "Congas and bongos",
        "Talking drum (dundun / gangan)",
        "Djembe accents",
        "Claps and finger-snaps layered with the snare",
        "Rimshots and cross-sticks"
      ],
      "bass": "The 808 IS the bass and much of the melody. It glides between root notes of the loop, sits warm and rounded (not distorted like US trap), and locks to the kick's syncopation. Occasionally doubled or replaced by a live-feel fingered bass or a log-drum for the low-mid punch.",
      "keys": "Simple minor-key piano or e-piano voicing the loop; sometimes amapiano-style broken piano chords or a lush Rhodes pad. Keys stay supportive, rarely busy.",
      "guitar": "Clean, bright highlife/juju-derived electric guitar is the melodic signature: syncopated single-note licks and arpeggios high on the neck, often the main hook riff. Occasionally acoustic for softer records. Never heavily distorted."
    },
    "groove": {
      "feel": "Mid-tempo, danceable, deeply syncopated 4/4 with a rolling, buoyant bounce. The pulse is felt in the percussion and 808 interplay rather than a driving downbeat. Body-moving, never rigid.",
      "pocketNotes": "The kick sits OFF the strict grid, syncopated against the snare/rim on beat 3. Shakers and hats subdivide the beat to create forward propulsion. The 808 answers the kick in a call-and-response low-end conversation. The rap flow floats slightly behind or across the beat (laid-back pocket), leaving space that ad-libs and percussion fills answer. Space is as important as density: Afro grooves breathe.",
      "swing": "Light-to-moderate swing/shuffle on the hats and shakers (roughly 8-16% swing). Not straight-quantized; the human lilt and slight push-pull is essential to the authenticity. Afroswing specifically rides a three-note recurring pattern within the 4/4.",
      "syncopation": "High. Polyrhythmic layering of shakers, log drum, talking drum and 808 creates cross-rhythms over the 4/4. Accents fall between the beats; the snare-on-3 backbeat is the anchor everything else syncopates around."
    },
    "vocalStyle": {
      "delivery": "Fluid blend of rapping and melodic sing-rap, often with light-to-moderate Auto-tune. Flows are conversational and charismatic, riding the pocket in a laid-back, behind-the-beat way. Code-switches freely between Nigerian Pidgin, English, Yoruba, Igbo (and sometimes patois/UK slang for the Afroswing diaspora variant). Hook-first, earworm-driven writing: the melodic chant hook is the star, verses serve it.",
      "adLibs": [
        "Eh!",
        "Ah-ah!",
        "Yeah yeah yeah",
        "Gbedu!",
        "Skrr / skidibop",
        "Wehdone",
        "Oya!",
        "Ehen!",
        "Producer name-drop tag",
        "Grunts, breaths and 'huh!' punctuating bar-ends"
      ],
      "harmonyApproach": "Stacked vocal harmonies and octave doubles on hooks; call-and-response and gang/crowd vocals for chants and bridges. Lead double-tracked and panned for width. Ad-libs answer the lead in the gaps rather than overlapping.",
      "languageMix": "Nigerian Pidgin as the connective glue, threaded with English and indigenous languages (Yoruba per Olamide lineage, Igbo per Phyno/Odumodublvck lineage). Diaspora/Afroswing variant adds UK street slang and Jamaican patois. Content: hustle, ambition, street storytelling, romance, faith, celebration, identity."
    },
    "signatureElements": [
      "Snare/rimshot on beat 3 as the Afro backbeat anchor",
      "Off-grid syncopated Afro kick (not four-on-the-floor)",
      "Warm gliding 808 that doubles as both bass and melody",
      "Log drum (amapiano-imported) for the modern low-end",
      "Bright clean highlife guitar lick as the recurring hook motif",
      "Layered organic percussion: shekere, shaker, talking drum, agogo, congas",
      "Hook-first arrangement with call-and-response gang vocals",
      "Code-switched delivery (Pidgin + Yoruba/Igbo + English) with Auto-tuned sing-rap",
      "Producer/DJ voice tag as identity stamp",
      "Loop-and-breathe structure with space between hits, DJ-friendly non-resolving outros",
      "Light shuffle/swing on hats and shakers for human lilt"
    ],
    "referenceArtists": [
      "Olamide",
      "Phyno",
      "Odumodublvck",
      "Blaqbonez",
      "Ladipoe",
      "Zlatan",
      "Reminisce",
      "M.I Abaga",
      "Falz",
      "Show Dem Camp",
      "Black Sherif (Ghana)",
      "Sarkodie (Ghana)",
      "J Hus (UK Afroswing)",
      "NSG (UK Afroswing)",
      "Rema"
    ],
    "mixTraits": {
      "lowEnd": "808/sub-forward and warm, not clinical. The 808 is rounded and musical (glides, note-length shaping) rather than a distorted US-trap boom. Kick and 808 are carved so they lock without masking; the low end should knock on club systems but stay tuneful.",
      "drums": "Punchy but not over-compressed; percussion layers kept lively and organic-sounding with a light natural swing. Shakers and hats bright and forward in the high end. Snare-on-3 sits crisp and present. Groove reads as human, not gridded-to-death.",
      "vocals": "Lead vocal up-front and intimate with light Auto-tune, de-essed and bright. Hook stacks and harmonies widened with panning and doubles. Ad-libs mixed lower and panned to answer the lead. Vocals sit ON TOP of the beat, clearly the focus.",
      "space": "Moderate reverb/delay on hooks and ad-libs for depth and 'largeness', verses drier and closer for intimacy. Stereo width comes from panned percussion, guitar licks and backing-vocal stacks; the low end stays mono and centered.",
      "loudness": "Loud, radio/streaming-competitive master with strong perceived level, but preserving the groove's punch and dynamic bounce, over-limiting kills the essential swing and feel."
    },
    "productionPromptSnippet": "Afro/Naija hip-hop: mid-tempo 95-115 BPM (up to 140 for Afro-drill/trap), 4/4, minor key (Aeolian, e.g. A/C/F minor), loop i-VI-III-VII. Off-grid syncopated Afro kick, snare/rimshot on beat 3, layered shekere/shaker/talking-drum percussion with light swing. Warm gliding 808 as bass AND melody; log drum low-end; bright clean highlife guitar lick as the hook motif; airy pads/mallets. Hook-first arrangement, call-and-response gang vocals. Delivery: charismatic sing-rap with light Auto-tune, code-switching Pidgin/Yoruba/Igbo/English, laid-back behind-the-beat pocket, ad-libs answering bar-ends. Mix: sub-forward warm low end, punchy organic drums, vocals up-front, space that breathes. Danceable, buoyant, human groove.",
    "freshnessGuardrails": "Capture the LANE, never a specific song. Use the archetypal minor loops (i-VI-III-VII etc.) and the snare-on-3 / off-grid-kick pocket as a FEEL, not a transcription of any released beat. Generate original melodies, hook phrases, guitar riffs and 808 lines from scratch, do not reproduce any recognizable topline, riff, drum-fill signature, or lyric from real records. Reference artists (Olamide, Phyno, J Hus, etc.) are factual style anchors ONLY: emulate the genre conventions they exemplify, never their specific melodies, cadences, catchphrases, ad-libs, or vocal timbre. Do not clone any artist's voice or use their names/tags in output. Vary BPM, key, instrumentation choices and arrangement details per track so no two outputs feel like the same beat. Aim for 'unmistakably this genre, unmistakably new'.",
    "sources": [
      "Genre musicology and public music-theory knowledge",
      "Publicly documented genre conventions (Wikipedia: Afrobeats, Afroswing, Afro trap; List of Nigerian rappers)",
      "Music-production/BPM reference guides (bpmcalc, RouteNote, Melodigging genre profiles)",
      "Editorial/journalistic coverage of the Nigerian rap scene (The Native, Culture Custodian, TurnTable Charts)",
      "Producer interviews referenced in genre documentation (e.g. Steel Banglez on Afroswing chord/snare conventions)"
    ]
  },
  "highlife": {
    "genre": "highlife",
    "displayName": "Highlife",
    "bpmRange": [
      100,
      140
    ],
    "typicalBpm": 120,
    "commonKeys": [
      "C major",
      "G major",
      "D major",
      "A major",
      "E major",
      "F major"
    ],
    "chordProgressions": [
      {
        "roman": "I – IV – V – I",
        "description": "The bedrock diatonic highlife cadence. Bright, resolved, church/brass-band-derived. The default loop for classic dance highlife and horn-led numbers.",
        "whereUsed": "Verses and horn-riff sections in classic E.T. Mensah-era big-band highlife and most guitar-band tunes."
      },
      {
        "roman": "I – I7 – IV – #IVdim – I – V7 – I",
        "description": "The Yaa Amponsah cycle — the foundational palm-wine guitar-band progression, treated like Ghana's 12-bar blues. The I7 pulls to IV; the passing diminished adds the signature palm-wine lift.",
        "whereUsed": "The core cyclical loop of guitar-band / palm-wine highlife (Nana Ampadu, Kwame Asare lineage). Repeats under call-and-response vocals."
      },
      {
        "roman": "I – vi – ii – V – I",
        "description": "Jazz-inflected turnaround showing highlife's swing/dance-band roots. Smooth, circular, keeps the groove rotating for extended vamps.",
        "whereUsed": "Turnarounds and instrumental vamps, especially in Nigerian Igbo highlife (Osadebe, Celestine Ukwu) with long meditative cycles."
      },
      {
        "roman": "I – IV – ii – V",
        "description": "Softer subdominant-to-supertonic motion for a mellow, rolling feel. Common when the guitar carries the whole harmony in a cyclical two-finger figure.",
        "whereUsed": "Palm-wine and slower Igbo highlife grooves; extended guitar solo sections."
      },
      {
        "roman": "IV – V – I – vi",
        "description": "Uplifting plagal-into-tonic loop with a minor-vi warmth; a modern highlife / hiplife-leaning progression that loops indefinitely.",
        "whereUsed": "Contemporary highlife and highlife-pop hybrids; hook/chorus loops."
      }
    ],
    "arrangement": [
      {
        "section": "Intro",
        "bars": "4-8",
        "whatHappens": "Solo two-finger palm-wine guitar states the cyclical figure, or a lone horn/organ line establishes the key. Bell/clave timeline (frikyiwa or claves) enters to lock the pulse. No vocals yet."
      },
      {
        "section": "Groove Establishment",
        "bars": "4-8",
        "whatHappens": "Bass walks in with root-fifth-approach motion, congas + kit lay the offbeat swing, rhythm guitar settles into the arpeggiated loop. The 'pocket' is set before anything sings."
      },
      {
        "section": "Verse 1",
        "bars": "8-16",
        "whatHappens": "Lead vocal enters relaxed and conversational over the guitar cycle; horns rest or play sparse pads. Diatonic I–IV–V or Yaa Amponsah loop underneath. Storytelling, proverb-laden lyrics."
      },
      {
        "section": "Horn Response / Refrain",
        "bars": "4-8",
        "whatHappens": "Tight brass section (trumpet + sax/trombone) answers the vocal with bright unison stabs and call-and-response riffs. This is highlife's signature dialogue between voice and horns."
      },
      {
        "section": "Verse 2 / Call-and-Response",
        "bars": "8-16",
        "whatHappens": "Lead trades with a chorus of backing voices (group response). Guitar embellishes with melodic runs between chord changes. Percussion intensifies subtly."
      },
      {
        "section": "Guitar / Horn Solo Break",
        "bars": "8-16",
        "whatHappens": "Instrumental spotlight — lead guitar plays melodic single-note runs over the cycle, or the horn section takes an ensemble solo. Rhythm section keeps the danceable pocket steady; often the peak dance moment."
      },
      {
        "section": "Chorus / Hook Vamp",
        "bars": "8-16",
        "whatHappens": "Full ensemble, everyone in: horns riffing, guitars interlocking, group vocals on the singable hook. Highest energy and density."
      },
      {
        "section": "Outro Vamp / Fade",
        "bars": "8+",
        "whatHappens": "The loop rides out with ad-libs, percussion fills, and horn punctuations — often an extended repeat that fades or ends on a clean I chord with a horn tag."
      }
    ],
    "instrumentation": {
      "core": [
        "Electric or acoustic 'palm-wine' guitar (two-finger arpeggiated, interlocking)",
        "Bass guitar (melodic, root-fifth walking lines)",
        "Drum kit (jazz/swing-derived, ride and rimshot forward)",
        "Congas and hand percussion",
        "Bell / clave timeline (frikyiwa, claves, agogô)"
      ],
      "signature": [
        "Interlocking two-finger palm-wine guitar cycles (Yaa Amponsah style)",
        "Tight bright horn section — trumpets + saxophone/trombone in call-and-response",
        "Bell/clave timeline as the rhythmic anchor",
        "Jazzy diatonic seventh chords voiced on guitar and keys"
      ],
      "percussion": [
        "Congas",
        "Frikyiwa (Ghanaian castanet/bell)",
        "Claves / agogô bell",
        "Shaker / maracas",
        "Cowbell",
        "Woodblock"
      ],
      "bass": "Electric bass playing melodic, singing lines — walking root-to-fifth motion with tasteful passing tones, locking to the offbeat rather than sitting on the downbeat; warm and round, never distorted.",
      "guitar": "The heart of highlife: clean-toned two-finger fingerpicked arpeggios forming cyclical, interlocking riffs. Second guitar often adds a countermelody. Bright, trebly, palm-wine timbre; melodic runs bridge chord changes. Spanish/Latin-tinged voicings from the genre's dance-band heritage.",
      "keys": "Optional — piano or Hammond/combo organ comping jazzy diatonic seventh voicings, or a bright electric-piano/highlife-organ line doubling horn riffs; supportive, never dominant."
    },
    "groove": {
      "feel": "Upbeat, buoyant 4/4 (some older palm-wine material in lilting 12/8) with a relaxed forward-leaning bounce — celebratory but never rushed. A swung, dance-floor 'roll' rather than a stiff grid.",
      "pocketNotes": "The whole ensemble locks to a bell/clave timeline; emphasis lands on the offbeats, giving highlife its signature lilt and 'skip.' The pocket is loose and human — musicians breathe with each other. Bass and guitar interlock rather than double, leaving air in the groove. Tempo sits comfortably mid (110-125 BPM) so it stays danceable and conversational.",
      "swing": "Light-to-moderate swing/shuffle inherited from jazz and dance-band roots; eighth notes lean rather than sit perfectly straight, especially in the ride cymbal and guitar picking.",
      "syncopation": "Heavy but tasteful — guitar arpeggios and horn stabs accent the 'and' of beats, the bell pattern subdivides against the pulse (clave feel), and vocals frequently enter off the downbeat. Syncopation creates momentum, not chaos."
    },
    "vocalStyle": {
      "delivery": "Warm, melodic, mid-range and conversational — more storytelling than belting. Smooth, relaxed phrasing that rides the groove. Often sung in local languages (Twi, Ga, Fante, Igbo, Yoruba) or English/Pidgin. Rooted in proverbs, moral lessons, praise, love, and social commentary. Elder, wise, communal tone.",
      "adLibs": [
        "Spoken/sung proverbs and dedications",
        "Call phrases answered by the group ('eh!', 'yee!')",
        "Gentle melodic hums and 'oohs' filling the cycle",
        "Praise-name shout-outs and crowd-warming exhortations",
        "Encouraging asides to the band during solos"
      ],
      "harmonyApproach": "Group call-and-response is central — a lead voice states a line, a chorus answers in warm parallel harmony (thirds and sixths). Backing vocals sing sweet, church/dance-band-influenced diatonic harmonies. Unison-into-harmony swells on hooks.",
      "languageMix": "Predominantly an African language (Twi/Ga/Fante for Ghanaian highlife; Igbo/Yoruba for Nigerian highlife) often blended with English or Pidgin phrases; code-switching within a song is common."
    },
    "signatureElements": [
      "Interlocking two-finger palm-wine guitar arpeggios (Yaa Amponsah cyclical figure)",
      "Bright, tight horn-section call-and-response (trumpet + sax/trombone stabs)",
      "Bell/clave timeline (frikyiwa, agogô, claves) as the rhythmic backbone",
      "Melodic singing bass lines that dialogue with the guitar",
      "Jazzy diatonic I–IV–V and vi–ii–V harmony with seventh chords",
      "Lead-and-chorus call-and-response vocals with proverb-rich lyrics",
      "Buoyant offbeat-emphasized swing that stays danceable and warm",
      "Live-band, organic, room-recorded ensemble feel"
    ],
    "referenceArtists": [
      "E.T. Mensah",
      "Nana Ampadu & The African Brothers Band",
      "Osita Osadebe",
      "Celestine Ukwu",
      "Amakye Dede",
      "Daddy Lumba",
      "Rex Lawson",
      "Prince Nico Mbarga",
      "A.B. Crentsil",
      "Pat Thomas",
      "Ebo Taylor",
      "Gyedu-Blay Ambolley"
    ],
    "mixTraits": {
      "lowEnd": "Warm, round, and tuneful — bass is present and melodic but not sub-heavy or modern-club-loud. Natural, uncompressed low end that supports rather than dominates; kick is soft and jazzy, not punchy EDM-style.",
      "drums": "Live-kit balance with the ride cymbal and congas forward in the image; snare/rimshot crisp but not gated. Percussion (bell, congas, shaker) sits airy and panned for width. Organic room ambience, minimal sample replacement.",
      "vocals": "Lead vocal warm and upfront but sitting inside the band, not hyper-compressed on top of it; light plate/spring reverb. Group harmonies blended slightly behind the lead for a communal, live-ensemble feel.",
      "space": "Open, natural stereo image evoking a live band in a room or hall — real reverb tails, instruments panned across the field (guitars and horns given their own space). Vintage/analog warmth; avoids sterile, over-quantized modern polish.",
      "loudness": "Moderate, dynamic loudness that preserves the band's natural push-and-pull — musical dynamics between verse and chorus retained rather than brick-walled."
    },
    "productionPromptSnippet": "Authentic West African Highlife: buoyant swung 4/4 at ~115-125 BPM in a bright major key (C/G/D). Interlocking two-finger palm-wine electric guitar arpeggios (Yaa Amponsah cyclical style) with clean trebly tone; melodic singing bass; jazzy diatonic I–IV–V and vi–ii–V harmony with seventh chords. Tight, bright horn section (trumpet + sax) trading call-and-response stabs with the vocal. Bell/clave timeline, congas and shaker driving an offbeat lilt. Warm lead-and-chorus call-and-response vocals, proverb-rich, relaxed and conversational. Live-band organic feel, natural room reverb, vintage analog warmth, dynamic and danceable — celebratory, not brick-walled.",
    "freshnessGuardrails": "Capture the LANE, never a specific song. Reproduce the STYLE — two-finger palm-wine guitar cycles, horn call-and-response, bell/clave timeline, jazzy diatonic harmony, offbeat swing, communal vocals — but generate original melodies, riffs, chord voicing choices, and lyrics. Do NOT quote or closely paraphrase the actual Yaa Amponsah melody, the E.T. Mensah / Sweet Mother hooks, or any recognizable topline from the reference artists. Reference artists are directional touchstones for feel and instrumentation only, never templates to copy. Vary the key, tempo within range, arrangement order, and horn/guitar phrasing so the output is a fresh composition in the highlife tradition, not a soundalike of any existing record.",
    "modalFlavor": "Predominantly major/Ionian and strongly diatonic — highlife's harmony comes from Western brass-band, church, and jazz dance-band influences rather than modal African scales. Occasional secondary dominants (I7 pulling to IV in the Yaa Amponsah cycle) and passing diminished chords add color. Minor keys appear in more melancholic Igbo highlife but the genre's default emotional palette is bright, warm, and resolved.",
    "sources": [
      "General musicological knowledge of West African popular music (public-domain genre facts)",
      "Publicly available reference material (encyclopedic/educational articles on Highlife, palm-wine guitar, and Yaa Amponsah style)",
      "Established music-theory conventions (diatonic harmony, roman-numeral analysis)"
    ]
  },
  "reggae": {
    "genre": "reggae",
    "displayName": "Reggae / Afro-Reggae",
    "bpmRange": [
      60,
      100
    ],
    "typicalBpm": 75,
    "commonKeys": [
      "A minor",
      "E minor",
      "D minor",
      "G minor",
      "C major",
      "G major",
      "A major",
      "D major"
    ],
    "chordProgressions": [
      {
        "roman": "i - iv",
        "description": "The core roots-reggae move: just two minor chords looping forever (e.g. Am - Dm). 'Two chords and infinite groove.' Space and repetition carry it, not harmonic motion.",
        "whereUsed": "Roots verses and full-song vamps; the default Bob Marley / Burning Spear engine"
      },
      {
        "roman": "i - VI - VII",
        "description": "Minor natural-mode lift (e.g. Am - F - G). Adds a rising, hopeful/defiant swell without leaving the minor tonal center. Very common in African-reggae anthems.",
        "whereUsed": "Choruses and uplifting bridges (Lucky Dube / Alpha Blondy anthemic sections)"
      },
      {
        "roman": "i - iv - V7 - i",
        "description": "Harmonic-minor cadence with a dominant 7 pulling home (e.g. Am - Dm - E7 - Am). The V7 gives strong resolution and a slightly Ethiopian/Nyabinghi color.",
        "whereUsed": "Turnarounds and end-of-phrase resolutions in roots and rockers tunes"
      },
      {
        "roman": "I - IV",
        "description": "Major-key two-chord skank (e.g. C - F or G - C). Sunnier, lovers-rock and pop-reggae feel; still driven by offbeat chops, not changes.",
        "whereUsed": "Lovers rock, pop-reggae and much of Afrobeats-tinged reggae crossover"
      },
      {
        "roman": "I - V - vi - IV",
        "description": "Pop axis progression reharmonized with skank rhythm; used when reggae meets mainstream Afropop/lovers hooks.",
        "whereUsed": "Modern Afro-reggae crossover choruses and radio hooks"
      },
      {
        "roman": "i - VII - VI - VII",
        "description": "Descending/oscillating minor loop (Andalusian-adjacent), gives a hypnotic, chant-like meditative pull.",
        "whereUsed": "Dub sections, meditative Nyabinghi-flavored passages, extended outros"
      }
    ],
    "arrangement": [
      {
        "section": "Intro / Dub Head",
        "bars": "4-8",
        "whatHappens": "Bass and drum 'riddim' establishes first, often solo. Skank guitar/organ enters on the offbeat; a delay-throw or filtered stab signals the top. Melodica or lone guitar lick can state the theme. Space is the feature."
      },
      {
        "section": "Verse 1",
        "bars": "8-16",
        "whatHappens": "Full riddim locked in: one-drop kick+snare on beat 3, bass carries the melody, guitar/organ skank on the 'and' of every beat, organ bubble underneath. Vocal enters conversational and low-register, leaving room."
      },
      {
        "section": "Pre / Rise",
        "bars": "2-4",
        "whatHappens": "Drums shift toward rockers/steppers or add a snare roll/tom fill; harmony lifts (i-VI-VII). Backing 'ooh' harmonies swell to telegraph the chorus."
      },
      {
        "section": "Chorus / Hook",
        "bars": "8",
        "whatHappens": "Fullest arrangement: group/gang harmonies, horn line (bone/trumpet/sax stabs), possibly steppers four-on-the-floor kick for drive. The most singable, repeated message lands here (call-and-response friendly)."
      },
      {
        "section": "Verse 2",
        "bars": "8-16",
        "whatHappens": "Back to one-drop restraint. Add an extra percussion layer (shaker, bongo, or African talking-drum/conga in Afro-reggae) or a countermelody guitar to keep it evolving."
      },
      {
        "section": "Bridge / Middle-8 or Dub Break",
        "bars": "4-8",
        "whatHappens": "Often a dub-style breakdown: drop instruments out to bass+drum, drench a snare or vocal in spring-reverb and tape-delay throws, sirens/filters. Or a horn/guitar/melodica solo over the riddim."
      },
      {
        "section": "Final Chorus",
        "bars": "8-16",
        "whatHappens": "Chorus repeats with maximum energy; ad-libs, toasting/DJ chatter, and vocal riffing pile on top. Horns double the hook."
      },
      {
        "section": "Outro / Fade",
        "bars": "8-16+",
        "whatHappens": "Riddim vamps and fades, or collapses into dub: echo tails, disappearing skank, bass and drum last elements standing. Ad-libs and 'Jah' / 'rasta' interjections scatter over the fade."
      }
    ],
    "instrumentation": {
      "core": [
        "Electric bass (round, deep, melodic - the lead instrument)",
        "Drum kit playing one-drop / rockers / steppers",
        "Rhythm guitar 'skank' (short muted offbeat chops)",
        "Hammond/combo organ 'bubble' (shuffled 16th-ish offbeat comping)",
        "Piano skank (staccato offbeat chords)"
      ],
      "signature": [
        "The offbeat guitar skank on the 'and' of beats (the single most identifying sound)",
        "Melodic, dub-heavy fingered electric bass as the tune's main melodic voice",
        "Organ bubble under the skank",
        "Spring reverb + tape/analog delay throws (dub signature)",
        "Horn section stabs and lines (trombone, trumpet, tenor sax)",
        "Melodica lead lines (Augustus Pablo lineage)"
      ],
      "percussion": [
        "Shaker / cabasa",
        "Bongos and congas",
        "Timbales / rimshot cross-stick (the one-drop snare is often a cross-stick 'click')",
        "Nyabinghi hand drums (bass, funde, repeater) for roots/spiritual color",
        "Afro-reggae additions: talking drum, djembe, shekere, agogo bells, highlife-style percussion"
      ],
      "bass": "Fingered electric bass, low and rounded with treble rolled off; plays a repeating melodic riff (the 'riddim' hook) that often rests on beat 1 or syncopates around it, leaving space. Bass and kick lock as one unit.",
      "guitar": "Two roles: (1) the skank - very short, palm-dampened chords struck on the offbeats through a clean amp, often with slight spring reverb; (2) occasional single-note melodic licks or a second 'stroke' guitar doubling the organ. In Afro-reggae, highlife/juju-style clean lead guitar lines weave over the riddim (Majek Fashek lineage).",
      "keys": "Organ handles the 'bubble' (a rolling offbeat pattern alternating hands, sitting between skank and bass); piano plays hard staccato offbeat stabs. Clavinet or Rhodes appears in more modern/lovers productions. Synth pads and sub-bass reinforcement in modern Afro-reggae."
    },
    "groove": {
      "feel": "Laid-back, spacious, and hypnotic - built on emphasizing the OFFBEAT (the 'and') while drums drop the expected downbeat. The whole feel floats behind the beat; nothing rushes. In Afro-reggae the pocket picks up African percussion polyrhythm without losing the reggae suspension.",
      "pocketNotes": "The defining tension: guitar/organ skank on the offbeats vs. bass+kick anchoring around beat 1/beat 3. In ONE-DROP the kick and snare hit together on beat 3 and beat 1 is deliberately empty ('dropped') - this is the signature and the most authentic default. ROCKERS puts kick on 1 & 3 (steadier). STEPPERS puts kick on every beat (driving, militant, common in African-reggae anthems for energy). Keep everything relaxed and slightly behind - the groove needs air to breathe; overplaying kills it.",
      "swing": "Often a subtle triplet/shuffle underpinning, especially in the organ bubble and hi-hats (light swing feel). Roots can be near-straight; the organ bubble supplies the internal shuffle. Not heavily swung - a gentle lilt, not a hard shuffle.",
      "syncopation": "High and purposeful: bass riffs syncopate and leave rests; skank lands only off the beat; percussion (shaker, bongo) fills the internal 8ths/16ths. Afro-reggae layers additional cross-rhythms (talking drum, agogo, highlife guitar) for polyrhythmic depth."
    },
    "vocalStyle": {
      "delivery": "Conscious, message-driven, and melodic. Roots delivery is soulful, slightly nasal/chesty, sitting relaxed in the pocket - often mid-low register in verses, opening up in choruses. Themes: unity, justice, Jah/spirituality, resistance, love (lovers rock). Frequent call-and-response and gang/group harmonies. Toasting/DJ-style rhythmic chanting (the deejay/chatting tradition) appears as a distinct mode or over dubs. Afro-reggae delivery adds African vocal warmth, wider language mix, and highlife/Afropop melodic phrasing.",
      "adLibs": [
        "Jah!",
        "Rastafari",
        "Yeah-yah",
        "Oh Jah know",
        "Selassie I",
        "Rise up",
        "One love",
        "Whoa-oh-oh (melodic)",
        "Skengeh / riddim chatter",
        "Yow / Bredren",
        "Blessings",
        "Iyah"
      ],
      "harmonyApproach": "Rich group harmonies in thirds and sixths on hooks (Wailers/I-Threes three-part backing tradition); call-and-response between lead and chorus. Sustained 'ooh/aah' pads under verses. In Afro-reggae, harmonies often thicken into larger communal choir stacks.",
      "languageMix": "English and Jamaican Patois at the roots core. Afro-reggae mixes in Yoruba, Pidgin, French, Twi, Swahili, Zulu and local tongues - often code-switching within a song. Chant-like calls to action are common across all languages."
    },
    "signatureElements": [
      "Offbeat guitar/organ SKANK on the 'and' of each beat - the #1 identifier",
      "One-drop drum pattern: kick+snare together on beat 3, beat 1 left empty",
      "Deep, round, melodic fingered bass as the lead melodic instrument (bass IS the hook)",
      "Organ 'bubble' rolling between skank and bass",
      "Dub techniques: spring reverb, tape/analog delay throws, sudden drop-outs, siren FX",
      "Horn-section stabs and unison lines (trombone/trumpet/sax)",
      "Melodica lead melodies (Augustus Pablo tradition)",
      "Space and repetition over harmonic complexity (2-3 chords)",
      "Afro-reggae layer: talking drum, shekere, agogo, djembe + highlife/juju clean guitar lines",
      "Conscious/spiritual (Rasta) lyrical stance and gang/call-response harmonies"
    ],
    "referenceArtists": [
      "Bob Marley & The Wailers",
      "Peter Tosh",
      "Burning Spear",
      "Toots & the Maytals",
      "Jimmy Cliff",
      "Gregory Isaacs",
      "Dennis Brown",
      "Augustus Pablo",
      "King Tubby",
      "Lee Scratch Perry",
      "Steel Pulse",
      "Alpha Blondy",
      "Lucky Dube",
      "Majek Fashek",
      "Tiken Jah Fakoly",
      "Rocky Dawuni",
      "Chronixx",
      "Protoje",
      "Damian Marley"
    ],
    "mixTraits": {
      "lowEnd": "Bass-forward and warm - the low end dominates. Bass is round with highs rolled off; kick and bass are glued into one weight. Sub energy is prominent but controlled; not scooped like modern EDM - it's a full, woody low-mid warmth.",
      "drums": "Drums sit natural and roomy, not hyper-compressed. Snare/cross-stick has a distinctive tuned 'click' or 'tock'; often treated with spring reverb or a short delay in dub sections. Hi-hats light and airy. One-drop leaves the beat-1 hole audible - do not fill it.",
      "vocals": "Vocal sits in the pocket, intimate and slightly warm, not overly bright. Plate/spring reverb and slap or tape delay throws on line-ends. Harmonies blended just behind the lead. Toasting/deejay vocals can be drier and upfront.",
      "space": "Space is an instrument. Vintage/analog aesthetic: spring reverb, tape delay/echo, moments where everything drops to bass+drum (the dub 'version' ethos). Wide but organic stereo image - skank and percussion panned to open the field.",
      "loudness": "Moderate, dynamic, and organic rather than brickwalled - the groove needs breathing room. Analog warmth and gentle saturation over aggressive limiting. Afro-reggae crossovers may push a touch louder/brighter for modern radio but should keep the low-end warmth and offbeat air."
    },
    "productionPromptSnippet": "Authentic reggae / Afro-reggae, ~70-85 BPM, minor-leaning (Am/Em) with a 2-chord i-iv skank loop. Deep round melodic electric bass leads; ONE-DROP drums (kick+snare on beat 3, beat 1 empty). Offbeat guitar skank + organ bubble define the groove - relaxed, spacious, behind the beat. Layer horn stabs, melodica, shaker/bongo. Afro-reggae adds talking drum, shekere, agogo, highlife-style clean guitar and Yoruba/Pidgin/Patois vocals. Conscious message, gang call-and-response harmonies, occasional toasting. Dub touches: spring reverb, tape-delay throws, drop-outs. Warm analog low-end, dynamic (not brickwalled). Space is an instrument.",
    "modalFlavor": "Predominantly natural minor (Aeolian) for roots and conscious material, with frequent harmonic-minor color when a V7 dominant pulls back to the i (giving a slightly Ethiopian/Nyabinghi flavor). Major keys (Ionian) dominate lovers rock and pop/Afropop-crossover reggae. The mode matters far less than the rhythm - reggae is defined by groove and offbeat placement, not scale complexity. Melodies stay pentatonic-adjacent and singable; Afro-reggae folds in local African melodic/highlife inflections over the same modal base.",
    "freshnessGuardrails": "Capture the LANE, never a specific song. Generate ORIGINAL bass riddims, chord loops, and melodies - the offbeat skank, one-drop feel, and dub aesthetic are genre conventions, not copyrightable hooks, so lean into them freely, but do not reproduce any recognizable existing bassline, topline, lyric, or riddim (e.g. never recreate 'One Love', 'Get Up Stand Up', or any named riddim like Sleng Teng). Reference artists are stylistic compass points ONLY - do not imitate a named artist's voice, phrasing, or signature licks. Keep Rasta/spiritual and social-justice themes generic and universal, not lifted lines. For Afro-reggae, invent fresh percussion patterns and language blends rather than copying a known arrangement. Aim for 'unmistakably reggae, obviously new.'",
    "sources": [
      "Musicological domain knowledge (genre theory, rhythm, arrangement)",
      "Public music-education references on reggae rhythm and chord theory",
      "Publicly documented artist/genre history (Wikipedia, NPR, Afropop, Splice, Guitar World)",
      "General reggae/dub production practice"
    ]
  }
};

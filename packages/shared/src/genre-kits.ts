/**
 * GENRE KITS — producer-grade, per-genre material palettes (42 genres).
 *
 * Designed by a 42-agent producer panel, each kit grounded in how that genre is
 * ACTUALLY built, then validated against the MaterialRole taxonomy. This ends
 * the "one amapiano-flavored kit for all of Africa" problem: every lane declares
 * its own required / optional / signature roles, forbiddenTraits (what would make
 * it the WRONG genre), groove, section arrangement, fill cadence, mix priorities,
 * quality checks (what the ear must confirm), and engineTags (front-loaded,
 * genre-accurate tokens for the render engine). This is the material contract the
 * synth, the arranger, the engine brief and the verifier all read from.
 */
import { jobOf, familyOf, isMaterialRole, type MaterialRole } from './material-roles';

export interface GenreKit {
  genre: string;
  displayName: string;
  origin: string;
  bpmLo: number;
  bpmHi: number;
  typicalBpm: number;
  swing: 'straight' | 'light' | 'moderate' | 'heavy' | 'triplet';
  /** true only for genres whose kick genuinely hits every beat (house/EDM/gqom/afro_house). */
  fourOnFloor: boolean;
  requiredRoles: MaterialRole[];
  optionalRoles: MaterialRole[];
  /** The 2-5 roles that make THIS genre unmistakable — the ear must confirm these. */
  signatureRoles: MaterialRole[];
  /** Grooves/sounds that would make it the WRONG genre (e.g. "log_drum bassline" for afrobeats). */
  forbiddenTraits: string[];
  grooveRules: string;
  sectionMap: Array<{ section: string; materials: MaterialRole[] }>;
  fillCadenceBars: number;
  mixPriorities: MaterialRole[];
  qualityChecks: string[];
  /** 6-10 front-loaded, genre-accurate tags for the text-to-music engine. */
  engineTags: string[];
}

export const GENRE_KITS: Record<string, GenreKit> = {
  "afro_dancehall": {
    "genre": "afro_dancehall",
    "displayName": "Afro-Dancehall",
    "origin": "West African (Nigeria/Ghana) x Jamaican dancehall fusion, popularized mid-2010s by artists like Patoranking, Timaya, Cynthia Morgan and Nigerian-Jamaican collabs (Konshens, Busy Signal). It welds a digital dancehall riddim to afrobeats percussion and pidgin/patois vocals.",
    "bpmLo": 96,
    "bpmHi": 110,
    "typicalBpm": 104,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "rimshot",
      "closed_hat",
      "shaker",
      "sub_bass",
      "reggae_skank",
      "lead_vocal",
      "adlib"
    ],
    "optionalRoles": [
      "kick_808",
      "club_kick",
      "snare",
      "clap",
      "open_hat",
      "ride",
      "crash",
      "tom_fill",
      "snare_roll",
      "drum_roll",
      "talking_drum",
      "shekere",
      "conga",
      "bongo",
      "cowbell",
      "agogo",
      "cabasa",
      "woodblock",
      "timbales",
      "guiro",
      "bass_808",
      "sliding_808",
      "synth_bass",
      "reese_bass",
      "organ",
      "piano",
      "synth_pad",
      "guitar_chords",
      "highlife_guitar",
      "synth_lead",
      "synth_pluck",
      "bell_lead",
      "brass_section",
      "trumpet",
      "sax",
      "vocal_chop",
      "double",
      "harmony_vocal",
      "chant",
      "choir",
      "crowd_chant",
      "call_response",
      "hype_vocal",
      "spoken_word",
      "humming",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "siren",
      "beat_stop",
      "drop_fx",
      "transition_fx",
      "crowd_noise",
      "club_ambience",
      "vinyl_noise"
    ],
    "signatureRoles": [
      "reggae_skank",
      "rimshot",
      "sub_bass",
      "talking_drum",
      "siren"
    ],
    "forbiddenTraits": [
      "four-on-the-floor kick (that reads house / afro-house / amapiano, not dancehall)",
      "log_drum bassline (amapiano signature — wrong genre)",
      "reggaeton dembow / tresillo 3-3-2 boom-ch snare pattern (that is reggaeton, not dancehall)",
      "trap hi-hat rolls driving the main groove (afro-trap)",
      "amapiano soft_kick + shaker with a slow jazzy patient build",
      "straight un-syncopated afropop kick with no off-beat skank upstroke",
      "EDM 120+ BPM build-and-drop structure",
      "gqom dark broken-4/4 hypnotic techno percussion",
      "triplet-swung amapiano/shuffle pocket"
    ],
    "grooveRules": "Built on a digital dancehall riddim, NOT four-on-the-floor. The kick anchors beat 1 and adds one syncopated push (typically the '&' of 2 or a pickup into 3), while a sharp rimshot or cross-stick lands the backbeat squarely on beat 3, giving the half-time 'boom... ba' bounce. The defining harmonic move is the off-beat skank: a short staccato chord stab (reggae_skank on muted guitar or synth/organ) on every off-beat — the 'and' of 1,2,3,4 — this upstroke is what makes the ear read dancehall rather than plain afrobeats. A shaker runs continuous, lightly-swung 16ths and a shekere or talking_drum lays West-African accent syncopation on top, supplying the 'afro' half of the fusion. Bass is deep, round and melodic: a repeating riddim figure on sub_bass/808 that locks to the kick and often slides between root notes. Pocket is laid-back, a hair behind the beat, with light 16th swing; space and repetition matter more than density — the riddim loops and the vocal carries the arc. Vocals ride in pidgin/patois with heavy call-response, chant and gun-finger adlibs; dancehall sirens and 'pull-up' FX punctuate transitions.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "siren",
          "reggae_skank",
          "rimshot",
          "shaker",
          "vinyl_noise",
          "sub_bass",
          "adlib"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "rimshot",
          "closed_hat",
          "shaker",
          "sub_bass",
          "reggae_skank",
          "talking_drum",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "rimshot",
          "closed_hat",
          "open_hat",
          "shaker",
          "shekere",
          "sub_bass",
          "reggae_skank",
          "riser",
          "snare_roll",
          "crowd_chant",
          "lead_vocal"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "bass_808",
          "rimshot",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "shaker",
          "shekere",
          "talking_drum",
          "sub_bass",
          "reggae_skank",
          "organ",
          "synth_lead",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "siren",
          "crowd_chant"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "rimshot",
          "closed_hat",
          "shaker",
          "cowbell",
          "sub_bass",
          "reggae_skank",
          "synth_pluck",
          "bell_lead",
          "lead_vocal",
          "call_response",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "reggae_skank",
          "organ",
          "sub_bass",
          "reese_bass",
          "shaker",
          "choir",
          "humming",
          "lead_vocal",
          "beat_stop",
          "downlifter",
          "siren"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "kick",
          "bass_808",
          "rimshot",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "crash",
          "shaker",
          "shekere",
          "talking_drum",
          "sub_bass",
          "reggae_skank",
          "organ",
          "synth_lead",
          "brass_section",
          "trumpet",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "hype_vocal",
          "siren",
          "crowd_chant",
          "impact"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "reggae_skank",
          "rimshot",
          "sub_bass",
          "shaker",
          "siren",
          "adlib",
          "club_ambience",
          "vinyl_noise"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "kick"
    ],
    "qualityChecks": [
      "off-beat skank chord (reggae_skank) lands on every 'and' — the audible dancehall upstroke",
      "backbeat rimshot/snare on beat 3 with a half-time feel — NOT a steady 4/4 club pulse",
      "kick is syncopated (beat 1 + one push), never four-on-the-floor",
      "deep round sub/808 bass locked to the kick, playing a melodic repeating riddim figure",
      "continuous shaker 16th motion with shekere or talking_drum afro accents on top",
      "pidgin/patois vocal delivery with chant, call_response and gun-finger adlibs",
      "dancehall siren / pull-up FX present at section transitions",
      "tempo sits 96-110 BPM with light 16th swing",
      "contains NO log_drum, NO dembow tresillo, NO four-on-the-floor kick"
    ],
    "engineTags": [
      "afro dancehall",
      "dancehall riddim",
      "off-beat guitar skank",
      "afrobeats percussion",
      "deep syncopated 808 bass",
      "talking drum accents",
      "patois pidgin vocal",
      "half-time rimshot backbeat",
      "shaker 16ths",
      "caribbean west-african fusion"
    ]
  },
  "afro_fusion": {
    "genre": "afro_fusion",
    "displayName": "Afro-Fusion",
    "origin": "West Africa (Nigeria/Ghana) — Burna Boy-led modern blend of Afrobeats and 1970s Afrobeat with dancehall/reggae, R&B/soul and traditional African percussion. Broader, more live/organic and genre-blended than pop Afrobeats.",
    "bpmLo": 95,
    "bpmHi": 118,
    "typicalBpm": 105,
    "swing": "moderate",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "snare",
      "clap",
      "closed_hat",
      "shaker",
      "conga",
      "bass_guitar",
      "rhodes",
      "lead_vocal",
      "adlib"
    ],
    "optionalRoles": [
      "kick_808",
      "bass_808",
      "sub_bass",
      "synth_bass",
      "rimshot",
      "snap",
      "open_hat",
      "ride",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "dundun",
      "djembe",
      "agogo",
      "cowbell",
      "bongo",
      "cabasa",
      "woodblock",
      "kalimba",
      "balafon",
      "marimba",
      "kora",
      "mbira",
      "piano",
      "organ",
      "hammond",
      "gospel_organ",
      "synth_pad",
      "warm_pad",
      "string_pad",
      "choir_pad",
      "guitar_chords",
      "highlife_guitar",
      "palmwine_guitar",
      "reggae_skank",
      "lead_guitar",
      "clean_guitar_riff",
      "sax",
      "trumpet",
      "trombone",
      "flute",
      "pan_flute",
      "strings_line",
      "violin_line",
      "synth_lead",
      "synth_pluck",
      "bell_lead",
      "vocal_chop",
      "double",
      "harmony_vocal",
      "chant",
      "choir",
      "gospel_choir",
      "call_response",
      "crowd_chant",
      "humming",
      "vocal_pad",
      "hype_vocal",
      "spoken_word",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "vinyl_noise",
      "crowd_noise",
      "street_ambience",
      "transition_fx",
      "beat_stop",
      "drop_fx"
    ],
    "signatureRoles": [
      "talking_drum",
      "brass_section",
      "shekere",
      "bass_guitar",
      "adlib"
    ],
    "forbiddenTraits": [
      "log_drum-led bassline (that is amapiano, not afro-fusion)",
      "four-on-the-floor kick (that pushes it into afro-house/kwaito/house)",
      "reggaeton dembow pattern",
      "gqom dark broken minimal 4/4",
      "trap hi-hat rolls dominating the whole groove",
      "EDM big-room drop and build",
      "rigidly quantized grid with no swing or human pocket",
      "sparse/patient amapiano arrangement",
      "distorted rock/metal guitars",
      "straight 8th pop-rock feel"
    ],
    "grooveRules": "Mid-tempo, laid-back and slightly behind-the-beat. The kick is syncopated — it deliberately avoids four-on-the-floor, leaving space and pushing the 'and' counts while locking with a melodic bass_guitar that slides, rests and grooves in a reggae/dub-inflected line (the bass often carries the hook). Snare/clap — frequently a rimshot — anchor a relaxed backbeat on 2 and 4. A shaker/shekere drives continuous swung 16ths: this is the rhythmic engine and must roll with a moderate swing, never sit dead-straight. Congas and talking_drum trade call-and-response phrases that pull against the grid for a hand-played, human feel, carrying a subtle triplet lilt inherited from dancehall/reggae. Brass/horns punch short stabs on accents (Afrobeat DNA). Everything breathes around the vocal — the pocket is spacious, swung and organic, not gridded.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "shekere",
          "shaker",
          "conga",
          "rhodes",
          "highlife_guitar",
          "talking_drum",
          "adlib",
          "vinyl_noise"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "shaker",
          "conga",
          "bass_guitar",
          "rhodes",
          "highlife_guitar",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "shaker",
          "open_hat",
          "tom_fill",
          "bass_guitar",
          "brass_section",
          "riser",
          "crowd_chant",
          "lead_vocal",
          "double"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "shekere",
          "conga",
          "talking_drum",
          "bass_guitar",
          "brass_section",
          "rhodes",
          "highlife_guitar",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "call_response",
          "crash"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "shaker",
          "talking_drum",
          "bass_guitar",
          "rhodes",
          "lead_vocal",
          "adlib",
          "spoken_word"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "shekere",
          "conga",
          "kalimba",
          "kora",
          "gospel_organ",
          "warm_pad",
          "vocal_pad",
          "humming",
          "bass_guitar",
          "lead_vocal",
          "harmony_vocal",
          "downlifter"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "open_hat",
          "shekere",
          "conga",
          "talking_drum",
          "dundun",
          "bass_guitar",
          "brass_section",
          "sax",
          "rhodes",
          "highlife_guitar",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "gospel_choir",
          "adlib",
          "crowd_chant",
          "crash",
          "impact"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "shekere",
          "shaker",
          "conga",
          "talking_drum",
          "bass_guitar",
          "rhodes",
          "adlib",
          "humming",
          "vinyl_noise"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "kick",
      "bass_guitar"
    ],
    "qualityChecks": [
      "continuous swung shaker/shekere 16th motion present (rolling, not straight, not absent)",
      "syncopated kick that does NOT play four-on-the-floor",
      "melodic bass_guitar line with slides and movement, interlocking with the kick (not a static sub drone)",
      "relaxed backbeat snare/clap or rimshot on 2 and 4",
      "vocal ad-libs and chant/call-response layers audible around the lead",
      "at least one live-feel African percussion audible (talking_drum, conga or shekere)",
      "warm soulful harmony (rhodes/keys or clean highlife guitar), not EDM synths",
      "laid-back human pocket with light triplet lilt — no log_drum, no four-on-floor, no trap-roll domination"
    ],
    "engineTags": [
      "afro-fusion",
      "afrobeats",
      "syncopated afro groove",
      "melodic bass guitar hook",
      "shekere shaker 16ths",
      "talking drum percussion",
      "afrobeat brass stabs",
      "reggae-dancehall inflected",
      "soulful rhodes keys",
      "laid-back swung pocket"
    ]
  },
  "afro_gospel": {
    "genre": "afro_gospel",
    "displayName": "Afro Gospel",
    "origin": "West Africa (Nigeria & Ghana) — contemporary African gospel that fuses Afrobeats/highlife praise grooves with worship-band gospel choir, organ and pads. Reference artists: Sinach, Nathaniel Bassey, Mercy Chinwo, Moses Bliss, Judikay, Ada Ehi, Frank Edwards, Tim Godfrey, Dunsin Oyekan, Victoria Orenze, Joe Mettle & Sonnie Badu (Ghana). Distinct from US 12/8 black gospel and from amapiano/afro-trap.",
    "bpmLo": 84,
    "bpmHi": 126,
    "typicalBpm": 112,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "snare",
      "clap",
      "shaker",
      "closed_hat",
      "bass_guitar",
      "piano",
      "gospel_organ",
      "highlife_guitar",
      "lead_vocal",
      "gospel_choir",
      "adlib"
    ],
    "optionalRoles": [
      "soft_kick",
      "live_kick",
      "rimshot",
      "snap",
      "open_hat",
      "ride",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "dundun",
      "djembe",
      "conga",
      "bongo",
      "agogo",
      "cowbell",
      "cabasa",
      "shekere",
      "woodblock",
      "udu",
      "kalimba",
      "balafon",
      "sub_bass",
      "synth_bass",
      "organ_bass",
      "rhodes",
      "wurlitzer",
      "hammond",
      "organ",
      "warm_pad",
      "choir_pad",
      "string_pad",
      "synth_pad",
      "guitar_chords",
      "palmwine_guitar",
      "clean_guitar_riff",
      "lead_guitar",
      "sax",
      "trumpet",
      "trombone",
      "brass_section",
      "strings_line",
      "flute",
      "synth_lead",
      "double",
      "harmony_vocal",
      "chant",
      "choir",
      "crowd_chant",
      "call_response",
      "humming",
      "vocal_pad",
      "spoken_word",
      "hype_vocal",
      "riser",
      "impact",
      "reverse_cymbal",
      "sweep",
      "crowd_noise",
      "transition_fx",
      "beat_stop"
    ],
    "signatureRoles": [
      "gospel_choir",
      "talking_drum",
      "gospel_organ",
      "shekere",
      "highlife_guitar"
    ],
    "forbiddenTraits": [
      "amapiano log_drum-led bassline (wrong genre — that is amapiano, not afro gospel)",
      "four-on-the-floor house/EDM kick",
      "reggaeton/dembow pattern",
      "trap 808 slides as the primary bass with wall-to-wall hi-hat rolls (that is afro-trap/drill)",
      "US 12/8 swung gospel shuffle with walk-up gospel piano as the ONLY groove and no African percussion (that is American black gospel)",
      "dark minimal broken gqom 4/4",
      "heavy mumble/autotune trap adlibs replacing worship adlibs",
      "distorted 808 as the harmonic foundation instead of melodic bass guitar",
      "no shaker/shekere 16th percolation (loses the Afro feel entirely)",
      "secular club/party lyrical content instead of praise & worship"
    ],
    "grooveRules": "West-African 4/4 built on an Afrobeats/highlife pocket — NOT swung American 12/8 gospel. The kick is syncopated and leaves space (it breathes: dun–dun k'dun rather than every downbeat), snare/rimshot answers on the backbeat with layered handclaps stacked in the praise sections. A shaker plus shekere run continuous, lightly-swung 16th-note motion — that percolation is the engine of the whole feel. Talking drum, congas and dundun play call-and-response answers that weave around the lead vocal. Bass guitar is melodic and syncopated: it walks and slides around the root in highlife/palmwine phrases and locks to the kick rather than sitting on a static 808. Piano and gospel organ carry rich 7th/9th/sus worship voicings; the organ swells with Hammond/leslie shimmer on every lift. Clean highlife guitar plays interlocking single-note riffs high in the mix. The gospel choir stacks full SATB harmony and enters on the hook and bridge, with the leader trading call-and-response with choir and crowd. Worship bridges drop to a half-time feel (pads, piano, soft kick, humming) then rebuild dynamically into the biggest final praise chorus. Turnarounds every 4 bars, percussion/talking-drum fills every 8.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "warm_pad",
          "piano",
          "gospel_organ",
          "shaker",
          "vocal_pad",
          "talking_drum",
          "riser"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "soft_kick",
          "kick",
          "bass_guitar",
          "shaker",
          "closed_hat",
          "piano",
          "gospel_organ",
          "highlife_guitar",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "shekere",
          "talking_drum",
          "bass_guitar",
          "piano",
          "gospel_organ",
          "harmony_vocal",
          "tom_fill",
          "riser"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "shekere",
          "shaker",
          "closed_hat",
          "open_hat",
          "talking_drum",
          "conga",
          "bass_guitar",
          "piano",
          "gospel_organ",
          "highlife_guitar",
          "brass_section",
          "lead_vocal",
          "gospel_choir",
          "adlib",
          "call_response",
          "crash"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "snare",
          "rimshot",
          "bass_guitar",
          "shaker",
          "closed_hat",
          "piano",
          "rhodes",
          "highlife_guitar",
          "lead_vocal",
          "double",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "warm_pad",
          "choir_pad",
          "gospel_organ",
          "piano",
          "soft_kick",
          "shekere",
          "bass_guitar",
          "lead_vocal",
          "gospel_choir",
          "humming",
          "crowd_chant",
          "reverse_cymbal",
          "riser"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "shekere",
          "shaker",
          "open_hat",
          "talking_drum",
          "dundun",
          "conga",
          "agogo",
          "bass_guitar",
          "piano",
          "gospel_organ",
          "hammond",
          "highlife_guitar",
          "brass_section",
          "strings_line",
          "lead_vocal",
          "gospel_choir",
          "adlib",
          "call_response",
          "hype_vocal",
          "impact",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "gospel_organ",
          "piano",
          "warm_pad",
          "shaker",
          "talking_drum",
          "lead_vocal",
          "gospel_choir",
          "humming",
          "crowd_noise"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "kick",
      "bass_guitar",
      "highlife_guitar"
    ],
    "qualityChecks": [
      "continuous lightly-swung shaker/shekere 16th motion is audible throughout",
      "talking_drum plays call-and-response phrases answering the vocal",
      "gospel_choir enters with stacked SATB harmony on the hook and bridge",
      "gospel_organ / Hammond swells sit under the worship and lift sections",
      "bass_guitar is melodic and syncopated (walking/sliding), NOT a static 808",
      "kick pocket is syncopated and breathes — NOT four-on-the-floor",
      "handclaps double the backbeat in the praise/hook sections",
      "clean highlife guitar plays interlocking single-note riffs high in the mix",
      "worship bridge drops to half-time (pads + piano + humming) then rebuilds",
      "lead + choir trade call-and-response with worship/praise lyrical content"
    ],
    "engineTags": [
      "afro gospel",
      "afrobeats gospel praise",
      "african worship",
      "nigerian gospel choir",
      "highlife groove",
      "talking drum percussion",
      "shekere shaker 16ths",
      "worship organ and pads",
      "live band gospel",
      "call and response choir"
    ]
  },
  "afro_house": {
    "genre": "afro_house",
    "displayName": "Afro House",
    "origin": "South African deep-house lineage (Johannesburg/Durban/Soweto) fused with Chicago/deep house, carried globally by Black Coffee, Culoe De Song, Da Capo, Themba, and the &ME/Keinemusik axis. Built on four-on-the-floor house architecture dressed in Zulu/Xhosa chant and pan-African percussion. Distinct from amapiano (log-drum-led, soft-kick, non-4x4) and afrobeats (syncopated West-African kick-snare).",
    "bpmLo": 118,
    "bpmHi": 126,
    "typicalBpm": 122,
    "swing": "light",
    "fourOnFloor": true,
    "requiredRoles": [
      "club_kick",
      "closed_hat",
      "open_hat",
      "clap",
      "shaker",
      "conga",
      "shekere",
      "sub_bass",
      "warm_pad",
      "marimba",
      "chant"
    ],
    "optionalRoles": [
      "kick",
      "rimshot",
      "crash",
      "snare_roll",
      "drum_roll",
      "djembe",
      "talking_drum",
      "bongo",
      "agogo",
      "cowbell",
      "woodblock",
      "claves",
      "udu",
      "cabasa",
      "dundun",
      "bata",
      "kora",
      "kalimba",
      "mbira",
      "balafon",
      "vibraphone",
      "xylophone",
      "chimes",
      "gong",
      "synth_bass",
      "pluck_bass",
      "moog_bass",
      "organ_bass",
      "rhodes",
      "piano",
      "house_piano_stab",
      "organ",
      "hammond",
      "gospel_organ",
      "synth_pad",
      "choir_pad",
      "string_pad",
      "synth_pluck",
      "bell_lead",
      "mallet_lead",
      "vocal_chop",
      "flute",
      "pan_flute",
      "sax",
      "synth_lead",
      "strings_line",
      "lead_vocal",
      "call_response",
      "choir",
      "crowd_chant",
      "gospel_choir",
      "adlib",
      "spoken_word",
      "humming",
      "vocal_pad",
      "harmony_vocal",
      "double",
      "riser",
      "downlifter",
      "sweep",
      "impact",
      "reverse_cymbal",
      "transition_fx",
      "club_ambience",
      "crowd_noise",
      "nature_ambience",
      "vinyl_noise",
      "beat_stop"
    ],
    "signatureRoles": [
      "club_kick",
      "conga",
      "shaker",
      "marimba",
      "chant"
    ],
    "forbiddenTraits": [
      "log_drum-led bounce paired with a soft amapiano kick (that is amapiano, not afro house)",
      "halftime or any non-four-on-the-floor kick pattern",
      "sliding_808, trap hi-hat rolls, or drill hat slides",
      "syncopated West-African afrobeats kick+snare pattern",
      "reggaeton/dembow groove",
      "interlocking highlife guitars or live-band highlife feel",
      "reggae skank",
      "tempo under ~115 BPM with laid-back amapiano swing",
      "EDM big-room supersaw / festival drop lead",
      "gqom broken 4/4 that drops the kick"
    ],
    "grooveRules": "A steady four-on-the-floor club kick anchors every quarter and never breaks pattern; the open hat sits on the offbeat '&' (the classic house pulse) over continuous 16th closed hats. Clap and/or rimshot mark the 2 and 4 backbeat. The genre's identity lives in LAYERED, live-feel African percussion: congas roll tumbao-style syncopations, shaker and shekere drive unbroken 16th motion, and djembe/talking_drum trade call-and-response fills. Bass is deep, warm and rolls on the offbeats, locking tightly to the kick — it is a house bassline, never a log-drum bounce. Feel is predominantly straight with only light humanized swing on the percussion layer. Energy is built by ADDING and subtracting percussion and atmosphere across 8- and 16-bar phrases, not by altering the kick. A marimba/kalimba ostinato and tribal chant ride on top of the warm pad bed.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "shaker",
          "conga",
          "shekere",
          "warm_pad",
          "club_ambience",
          "vinyl_noise",
          "riser"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "clap",
          "shaker",
          "conga",
          "shekere",
          "djembe",
          "sub_bass",
          "warm_pad",
          "rhodes",
          "marimba",
          "chant"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "club_kick",
          "shaker",
          "conga",
          "snare_roll",
          "drum_roll",
          "riser",
          "sweep",
          "transition_fx",
          "warm_pad",
          "chant"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "clap",
          "rimshot",
          "crash",
          "shaker",
          "conga",
          "shekere",
          "djembe",
          "talking_drum",
          "agogo",
          "sub_bass",
          "warm_pad",
          "house_piano_stab",
          "marimba",
          "kalimba",
          "bell_lead",
          "chant",
          "call_response",
          "choir",
          "impact",
          "club_ambience"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "conga",
          "shaker",
          "warm_pad",
          "choir_pad",
          "rhodes",
          "marimba",
          "chant",
          "spoken_word",
          "nature_ambience",
          "downlifter"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "clap",
          "shaker",
          "conga",
          "shekere",
          "djembe",
          "talking_drum",
          "sub_bass",
          "warm_pad",
          "marimba",
          "synth_pluck",
          "chant",
          "call_response"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "clap",
          "rimshot",
          "crash",
          "shaker",
          "conga",
          "shekere",
          "djembe",
          "talking_drum",
          "agogo",
          "cowbell",
          "sub_bass",
          "warm_pad",
          "house_piano_stab",
          "marimba",
          "kalimba",
          "bell_lead",
          "chant",
          "call_response",
          "choir",
          "gospel_choir",
          "adlib",
          "impact",
          "crowd_noise"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "shaker",
          "conga",
          "shekere",
          "warm_pad",
          "club_ambience",
          "vinyl_noise",
          "downlifter"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "club_kick",
      "sub_bass"
    ],
    "qualityChecks": [
      "Kick hits four-on-the-floor on every quarter with no gaps (not halftime, not amapiano soft-kick)",
      "Open hat lands on the offbeat '&' between kicks — classic house pulse",
      "Continuous 16th shaker/shekere motion audible for the full track",
      "Layered, humanized (non-quantized) congas and djembe with syncopated call-and-response",
      "Deep warm bass rolling on the offbeats and locked to the kick — NOT a log-drum bounce",
      "Tribal chant or call-and-response vocal present",
      "Marimba and/or kalimba melodic ostinato present",
      "Warm atmospheric pad bed sits under the whole groove",
      "Tempo lands 118-126 BPM",
      "No trap/drill hats, no sliding 808, no highlife guitar interlock"
    ],
    "engineTags": [
      "afro house",
      "four-on-the-floor deep house",
      "tribal african percussion",
      "rolling congas shaker shekere",
      "marimba kalimba melody",
      "tribal chant call-and-response",
      "warm atmospheric pads",
      "deep rolling offbeat bass",
      "122 bpm",
      "organic live-feel percussion"
    ]
  },
  "afro_pop": {
    "genre": "afro_pop",
    "displayName": "Afro-Pop",
    "origin": "West Africa (Nigeria & Ghana) — the polished, radio/chart-facing, melody-first pop wing of afrobeats. Cleaner and more song-structured than street afrobeats, more percussive and up-tempo than afro-R&B; think the crossover-pop lineage of Mr Eazi, Joeboy, Kizz Daniel, Tekno, Simi, Adekunle Gold and pop-leaning Wizkid/Ayra Starr cuts.",
    "bpmLo": 98,
    "bpmHi": 112,
    "typicalBpm": 104,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "snare",
      "clap",
      "closed_hat",
      "open_hat",
      "shaker",
      "synth_bass",
      "piano",
      "synth_pluck",
      "lead_vocal",
      "adlib"
    ],
    "optionalRoles": [
      "soft_kick",
      "live_kick",
      "rimshot",
      "snap",
      "crash",
      "tom_fill",
      "snare_roll",
      "talking_drum",
      "conga",
      "bongo",
      "cabasa",
      "agogo",
      "shekere",
      "kalimba",
      "marimba",
      "glockenspiel",
      "bass_guitar",
      "pluck_bass",
      "rhodes",
      "wurlitzer",
      "warm_pad",
      "synth_pad",
      "string_pad",
      "guitar_chords",
      "palmwine_guitar",
      "clean_guitar_riff",
      "lead_guitar",
      "sax",
      "trumpet",
      "brass_section",
      "bell_lead",
      "mallet_lead",
      "flute",
      "strings_line",
      "vocal_chop",
      "double",
      "harmony_vocal",
      "chant",
      "call_response",
      "gospel_choir",
      "crowd_chant",
      "humming",
      "hype_vocal",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "vinyl_noise",
      "transition_fx",
      "beat_stop",
      "drop_fx",
      "street_ambience"
    ],
    "signatureRoles": [
      "shekere",
      "open_hat",
      "highlife_guitar",
      "synth_pluck",
      "adlib"
    ],
    "forbiddenTraits": [
      "log_drum-led bassline or melody (that is amapiano, not afro-pop)",
      "rigid four-on-the-floor house/EDM kick on every quarter",
      "reggaeton dembow (boom-ch / boom-chick) pattern",
      "trap or drill hi-hat rolls / triplet 808 skitters as the rhythmic backbone",
      "sliding 808 sub as the lead low end (pulls it toward afro-trap / street-pop)",
      "dark, minimal, hypnotic broken 4/4 (gqom)",
      "slow ballad tempo below ~90 BPM or a half-time feel",
      "patient jazzy amapiano-style build with soft_kick and no topline hook",
      "long Fela-style live-band afrobeat jam with horns soloing over one vamp",
      "heavy triplet shuffle or kwaito mid-tempo house groove",
      "lo-fi, muddy or aggressively distorted percussion — afro-pop is clean, bright and radio-polished"
    ],
    "grooveRules": "Song-first, not groove-first: the entire arrangement serves a bright, singable topline hook. The kick is SYNCOPATED — never a straight four-on-the-floor — anchored on beat 1 then pushing the '&' and the 'a' for the classic afrobeats bounce, leaving deliberate air on the downbeats. Clap/snare answer as a backbeat on 2 and 4, with rim ghosting the gaps. A continuous shaker (and shekere) runs unbroken 16ths for forward propulsion while an offbeat OPEN HAT sits on the '&' to give the West African lilt. The bass is melodic and bouncy — it locks to the kick but walks with the chords and the vocal, rounder and more tuneful than street afrobeats' sparser low end. Congas/bongos/talking-drum drop syncopated fills into the pockets. Light swing (~54-56%) keeps it human and laid-back without becoming a hard shuffle. Bright, glossy, radio-pop mix with space carved out for the lead vocal and its adlibs. Mid-tempo and danceable throughout — it never drops to half-time, never turns dark or minimal, and never leans on a log drum.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "synth_pluck",
          "shaker",
          "warm_pad",
          "highlife_guitar",
          "humming",
          "vinyl_noise",
          "riser"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "closed_hat",
          "open_hat",
          "shaker",
          "rimshot",
          "synth_bass",
          "piano",
          "highlife_guitar",
          "lead_vocal",
          "adlib",
          "warm_pad"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "clap",
          "closed_hat",
          "shaker",
          "synth_bass",
          "piano",
          "string_pad",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "snare_roll",
          "riser"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "shaker",
          "shekere",
          "conga",
          "talking_drum",
          "synth_bass",
          "piano",
          "synth_pluck",
          "highlife_guitar",
          "string_pad",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "call_response",
          "crash"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "closed_hat",
          "open_hat",
          "shaker",
          "rimshot",
          "bongo",
          "synth_bass",
          "piano",
          "marimba",
          "highlife_guitar",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "rhodes",
          "sax",
          "highlife_guitar",
          "synth_bass",
          "shaker",
          "chant",
          "call_response",
          "lead_vocal",
          "beat_stop",
          "impact",
          "riser"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "shaker",
          "shekere",
          "conga",
          "talking_drum",
          "synth_bass",
          "piano",
          "synth_pluck",
          "highlife_guitar",
          "string_pad",
          "brass_section",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "gospel_choir",
          "adlib",
          "crowd_chant",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "synth_pluck",
          "shaker",
          "highlife_guitar",
          "warm_pad",
          "synth_bass",
          "lead_vocal",
          "adlib",
          "humming",
          "vinyl_noise"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "kick",
      "snare",
      "clap",
      "synth_bass",
      "shaker",
      "shekere",
      "open_hat",
      "synth_pluck",
      "adlib",
      "harmony_vocal",
      "piano",
      "highlife_guitar",
      "warm_pad",
      "string_pad"
    ],
    "qualityChecks": [
      "kick is syncopated, NOT four-on-the-floor — audible air on the downbeats with bounce on the & and a",
      "continuous shaker/shekere 16th motion runs under the whole track",
      "offbeat open hi-hat lands on the '&' (the afrobeats lilt)",
      "backbeat clap/snare on 2 and 4",
      "a bright, singable topline hook (plucky synth/marimba or vocal) is the dominant melodic element",
      "melodic, bouncing bass that moves with the chords — not a static 808 drone",
      "vocal adlibs layered around the lead",
      "NO log_drum anywhere (its presence would make it amapiano)",
      "clean, bright, polished pop mix — not dark, minimal or lo-fi",
      "tempo sits ~98-112 BPM, mid-tempo and danceable, never half-time",
      "light swing feel — human, not hard-quantized and not a heavy triplet shuffle"
    ],
    "engineTags": [
      "afropop",
      "Nigerian afro-pop",
      "syncopated afrobeats kick",
      "shekere and shaker 16ths",
      "offbeat open hi-hat",
      "bright plucky marimba topline",
      "melodic bouncing bass",
      "highlife guitar licks",
      "catchy radio hook with adlibs",
      "clean polished mix 104bpm"
    ]
  },
  "afro_rnb": {
    "genre": "afro_rnb",
    "displayName": "Afro R&B (Afro-Fusion Soul)",
    "origin": "West African (Nigeria/Ghana) contemporary R&B fusion — the smooth, sensual, harmony-rich sibling of afrobeats. Emerges from the Lagos alté/Afro-fusion scene and the \"Made in Lagos\" era: Wizkid, Tems, Wande Coal, Oxlade (\"KU LO SA\"), BNXN, Victony, Ayra Starr, Amaarae. It marries US/UK R&B and neo-soul harmony, autotune-melisma vocals and dense vocal layering with the laid-back, swung percussion pocket of afrobeats — slower, airier and more chord-rich than dancefloor afrobeats.",
    "bpmLo": 85,
    "bpmHi": 110,
    "typicalBpm": 100,
    "swing": "moderate",
    "fourOnFloor": false,
    "requiredRoles": [
      "soft_kick",
      "rimshot",
      "clap",
      "shaker",
      "closed_hat",
      "synth_bass",
      "rhodes",
      "warm_pad",
      "lead_vocal",
      "harmony_vocal",
      "double",
      "adlib"
    ],
    "optionalRoles": [
      "kick_808",
      "bass_808",
      "sliding_808",
      "sub_bass",
      "bass_guitar",
      "fretless_bass",
      "open_hat",
      "snap",
      "ride",
      "snare_roll",
      "conga",
      "bongo",
      "shekere",
      "talking_drum",
      "udu",
      "cabasa",
      "kalimba",
      "agogo",
      "woodblock",
      "piano",
      "wurlitzer",
      "organ",
      "gospel_organ",
      "choir_pad",
      "string_pad",
      "guitar_chords",
      "highlife_guitar",
      "palmwine_guitar",
      "clean_guitar_riff",
      "lead_guitar",
      "sax",
      "trumpet",
      "flute",
      "synth_pluck",
      "bell_lead",
      "vocal_chop",
      "mallet_lead",
      "vibraphone",
      "marimba",
      "glockenspiel",
      "kora",
      "mbira",
      "choir",
      "gospel_choir",
      "humming",
      "vocal_pad",
      "spoken_word",
      "call_response",
      "chant",
      "hype_vocal",
      "vinyl_noise",
      "tape_hiss",
      "riser",
      "reverse_cymbal",
      "sweep",
      "downlifter",
      "impact",
      "transition_fx",
      "nature_ambience"
    ],
    "signatureRoles": [
      "soft_kick",
      "shaker",
      "rhodes",
      "lead_vocal",
      "harmony_vocal"
    ],
    "forbiddenTraits": [
      "log_drum-led groove (that is amapiano, not afro r&b)",
      "four-on-the-floor kick (house / kwaito / afro-house)",
      "reggaeton dembow pattern",
      "aggressive trap/drill hi-hat rolls carrying the main identity",
      "uptempo >115 BPM dancefloor / afrobeats-street energy",
      "gqom dark broken 4/4",
      "distorted rock guitars or hard EDM synth drops",
      "wall-to-wall crowd chants replacing an intimate solo lead vocal",
      "robotic hard-quantized grid that kills the behind-the-beat pocket",
      "loud busy arrangement that buries the vocal instead of framing it"
    ],
    "grooveRules": "Mid-tempo and unhurried — the whole kit sits a hair behind the beat (~10-20ms late) for a sensual, laid-back pocket; nothing is hard-quantized. The kick plays a syncopated afrobeats figure with space (a rounded \"boom … b-boom\", not on every beat and never a four-on-the-floor pulse), soft and sub-heavy rather than punchy. The backbeat is carried by a tight rimshot and/or soft clap using afrobeats placement (as much on the 'and' of 3 as on straight 2 & 4). A swung, triplet-leaning shaker runs continuous 16ths as the engine of motion, with sparse ghosted closed hats around it and light congas/bongos or a talking-drum accent for color. Bass is melodic and round (synth_bass or a soft tuned/gliding 808) — it locks to the kick but glides between chord tones with portamento and leaves the downbeat breathing. Harmony is pure R&B/neo-soul: warm Rhodes and pads voicing extended jazz chords (min7, maj9, add9, 11ths), held and airy. Everything serves the voice: a melisma-rich lead with autotune-as-texture, stacked 3rd/5th harmonies, doubles and answering ad-libs (call-and-response). Density stays low; dynamics come from the vocal arrangement, not from piling on drums, and vinyl/tape warmth glues the whole bed.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "rhodes",
          "warm_pad",
          "vinyl_noise",
          "vocal_pad",
          "humming",
          "shaker"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "soft_kick",
          "shaker",
          "closed_hat",
          "synth_bass",
          "rhodes",
          "warm_pad",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "soft_kick",
          "shaker",
          "closed_hat",
          "clap",
          "rimshot",
          "synth_bass",
          "rhodes",
          "warm_pad",
          "string_pad",
          "lead_vocal",
          "harmony_vocal",
          "riser"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "soft_kick",
          "rimshot",
          "clap",
          "shaker",
          "closed_hat",
          "open_hat",
          "conga",
          "synth_bass",
          "sliding_808",
          "rhodes",
          "warm_pad",
          "bell_lead",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "soft_kick",
          "shaker",
          "closed_hat",
          "synth_bass",
          "rhodes",
          "talking_drum",
          "clean_guitar_riff",
          "lead_vocal",
          "adlib",
          "call_response"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "rhodes",
          "piano",
          "warm_pad",
          "sub_bass",
          "gospel_choir",
          "harmony_vocal",
          "humming",
          "lead_vocal",
          "reverse_cymbal"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "soft_kick",
          "rimshot",
          "clap",
          "shaker",
          "closed_hat",
          "open_hat",
          "conga",
          "bongo",
          "synth_bass",
          "sliding_808",
          "rhodes",
          "warm_pad",
          "string_pad",
          "bell_lead",
          "sax",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "gospel_choir"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "rhodes",
          "warm_pad",
          "vocal_pad",
          "humming",
          "lead_vocal",
          "vinyl_noise"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [],
    "qualityChecks": [
      "tempo sits mid-tempo (~85-108) with a half-time sensual feel, NOT uptempo dancefloor",
      "kick is syncopated with space and clearly NOT four-on-the-floor",
      "continuous swung/triplet-leaning 16th shaker drives the groove",
      "kick is soft, rounded and behind-the-beat, not a punchy trap or house thump",
      "Rhodes/electric-piano voicing extended jazz chords (7ths/9ths) is audible",
      "lead vocal shows melisma + autotune texture with stacked harmonies and answering ad-libs",
      "bass is melodic and glides between chord tones, leaving the downbeat open",
      "no log drum, no dembow, no house four-on-floor present",
      "lo-fi warmth (vinyl crackle / tape hiss) audible under the bed",
      "overall arrangement is spacious, intimate and vocal-led rather than dense"
    ],
    "engineTags": [
      "afro r&b",
      "afro-fusion soul",
      "smooth sensual mid-tempo 95-105 bpm",
      "laid-back syncopated afro groove, no four-on-floor",
      "swung 16th shaker with soft afro percussion",
      "warm rhodes neo-soul 7th/9th chords",
      "stacked soulful harmonies and answering ad-libs",
      "autotune-melisma lead vocal",
      "round gliding sub/808 bass",
      "vinyl tape lo-fi warmth"
    ]
  },
  "afro_soul": {
    "genre": "afro_soul",
    "displayName": "Afro-Soul",
    "origin": "Pan-African fusion of American soul / neo-soul / R&B songwriting with African instrumentation and rhythm — rooted in Nigeria, South Africa, Ghana and Kenya. Lineage: Asa, Nneka, Somi (West Africa); Lira, Simphiwe Dana, Zonke, Msaki, Ami Faku, Zoe Modiga, Berita, Bongeziwe Mabandla (Southern Africa); soul-leaning crossover cuts from Tems, Adekunle Gold, Bien/Sauti Sol, Lloyiso. Emotive, live-band, story-driven — soul harmony over an African percussion warmth.",
    "bpmLo": 68,
    "bpmHi": 100,
    "typicalBpm": 84,
    "swing": "moderate",
    "fourOnFloor": false,
    "requiredRoles": [
      "lead_vocal",
      "harmony_vocal",
      "bass_guitar",
      "rhodes",
      "live_kick",
      "snare",
      "closed_hat",
      "shaker",
      "conga"
    ],
    "optionalRoles": [
      "adlib",
      "double",
      "chant",
      "choir",
      "gospel_choir",
      "call_response",
      "humming",
      "vocal_pad",
      "soft_kick",
      "rimshot",
      "clap",
      "snap",
      "brushes",
      "open_hat",
      "ride",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "djembe",
      "udu",
      "shekere",
      "talking_drum",
      "dundun",
      "agogo",
      "cowbell",
      "bongo",
      "cabasa",
      "cajon",
      "kalimba",
      "mbira",
      "balafon",
      "kora",
      "triangle",
      "woodblock",
      "claves",
      "piano",
      "upright_piano",
      "wurlitzer",
      "clavinet",
      "organ",
      "hammond",
      "gospel_organ",
      "warm_pad",
      "string_pad",
      "choir_pad",
      "guitar_chords",
      "highlife_guitar",
      "palmwine_guitar",
      "fretless_bass",
      "upright_bass",
      "synth_bass",
      "sub_bass",
      "lead_guitar",
      "clean_guitar_riff",
      "sax",
      "trumpet",
      "trombone",
      "brass_section",
      "flute",
      "violin_line",
      "strings_line",
      "marimba",
      "vibraphone",
      "glockenspiel",
      "vocal_chop",
      "spoken_word",
      "vinyl_noise",
      "tape_hiss",
      "reverse_cymbal",
      "riser",
      "sweep",
      "nature_ambience",
      "crowd_noise",
      "club_ambience"
    ],
    "signatureRoles": [
      "rhodes",
      "conga",
      "harmony_vocal",
      "shaker",
      "adlib"
    ],
    "forbiddenTraits": [
      "log_drum (that is amapiano, not afro-soul)",
      "four-on-the-floor kick (that is afro-house / soulful house / kwaito)",
      "sliding_808 / heavy trap 808 sub that swallows the warm finger bass",
      "reggaeton / dembow groove",
      "amapiano soft-kick + patient log-drum build",
      "gqom dark broken 4/4 percussion",
      "aggressive EDM drop, big riser-into-drop structure",
      "drill hat slides / trap_hat_roll driving the beat",
      "rigidly quantized, robotic gridded drums (kills the live human pocket)",
      "heavy hyperpop autotune replacing the raw emotive lead vocal",
      "dubstep wobble / hard synth bass leads",
      "wall-of-synth EDM production with no acoustic/organic elements"
    ],
    "grooveRules": "Backbeat genre: snare (or soft rimshot) lands firmly on beats 2 and 4, the whole band sitting slightly BEHIND the beat for a relaxed, breathing pocket. Kick is syncopated and sparse — it anchors downbeats and pushes a couple of off-beat 'and' hits, never a steady four-on-the-floor pulse. Hats and shaker run swung 16ths (moderate laid-back swing, humanized, not gridded) that give the forward motion. Snare carries ghost notes between backbeats. Congas / djembe play interlocking open-slap patterns off the beat, threading through the kick-snare skeleton rather than doubling it. Bass guitar is the harmonic anchor: it locks to the kick on the '1' but walks melodically through the chord changes with fingered, round tone and tasteful slides/hammer-ons. Rhodes/piano comps lush extended chords (7ths, 9ths, 11ths) with space. Everything is dynamic and vocal-led — instruments open up in the hook and duck out under the lead vocal in verses. Feel is live-band and emotive, not sequenced.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "rhodes",
          "shaker",
          "humming",
          "warm_pad",
          "tape_hiss",
          "vinyl_noise",
          "palmwine_guitar"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "live_kick",
          "snare",
          "closed_hat",
          "shaker",
          "conga",
          "bass_guitar",
          "rhodes",
          "rimshot"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "live_kick",
          "snare",
          "closed_hat",
          "shaker",
          "conga",
          "clap",
          "bass_guitar",
          "rhodes",
          "organ",
          "string_pad",
          "snare_roll"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "adlib",
          "live_kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "shaker",
          "shekere",
          "conga",
          "bass_guitar",
          "rhodes",
          "piano",
          "gospel_organ",
          "strings_line",
          "brass_section"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "adlib",
          "live_kick",
          "snare",
          "closed_hat",
          "shaker",
          "conga",
          "bongo",
          "bass_guitar",
          "rhodes",
          "clean_guitar_riff",
          "clavinet"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "call_response",
          "rhodes",
          "gospel_organ",
          "warm_pad",
          "bass_guitar",
          "conga",
          "clap",
          "gospel_choir"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "gospel_choir",
          "adlib",
          "live_kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "crash",
          "shaker",
          "shekere",
          "conga",
          "talking_drum",
          "bass_guitar",
          "rhodes",
          "piano",
          "gospel_organ",
          "strings_line",
          "brass_section"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "lead_vocal",
          "adlib",
          "humming",
          "rhodes",
          "palmwine_guitar",
          "shaker",
          "conga",
          "warm_pad",
          "vinyl_noise",
          "nature_ambience"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "live_kick",
      "bass_guitar",
      "brass_section"
    ],
    "qualityChecks": [
      "lead vocal is emotive and upfront with soulful runs/melisma, sitting loudest in the mix",
      "warm Rhodes (or Wurlitzer) electric piano audible in the harmony bed with extended jazzy chords",
      "drums are live/organic with backbeat on 2 & 4 — NOT four-on-the-floor",
      "African hand percussion present and audible (conga/djembe plus shaker) threading off-beat",
      "warm, round, melodic finger-played bass guitar — no trap 808 sub dominating",
      "pocket is laid-back and swung (behind the beat), humanized not rigidly quantized",
      "stacked vocal harmonies open up in the hook, gospel choir in the final hook",
      "tempo sits in the 68-100 range, mid-tempo",
      "no log drum and no sliding 808 anywhere",
      "analog warmth present (vinyl/tape texture, live room feel)"
    ],
    "engineTags": [
      "afro-soul",
      "soulful african fusion",
      "warm rhodes electric piano",
      "live organic drums backbeat groove",
      "african hand percussion congas shaker",
      "melodic warm bass guitar",
      "emotive lead vocal gospel harmonies",
      "mid-tempo laid-back swung pocket",
      "neo-soul extended chords",
      "vinyl-warm analog production"
    ]
  },
  "afrobeats": {
    "genre": "afrobeats",
    "displayName": "Afrobeats",
    "origin": "West Africa — Nigeria & Ghana (Lagos/Accra); contemporary Afropop descended from highlife, juju, fuji, R&B and dancehall. Not Fela's 1970s Afrobeat.",
    "bpmLo": 100,
    "bpmHi": 118,
    "typicalBpm": 107,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "clap",
      "snare",
      "rimshot",
      "closed_hat",
      "shaker",
      "shekere",
      "bass_guitar",
      "lead_vocal",
      "adlib"
    ],
    "optionalRoles": [
      "kick_808",
      "soft_kick",
      "club_kick",
      "live_kick",
      "snap",
      "open_hat",
      "ride",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "drum_roll",
      "trap_hat_roll",
      "dundun",
      "sakara",
      "bata",
      "djembe",
      "ashiko",
      "udu",
      "agogo",
      "cowbell",
      "conga",
      "bongo",
      "cabasa",
      "maraca",
      "woodblock",
      "claves",
      "kalimba",
      "balafon",
      "kora",
      "ngoni",
      "timbales",
      "triangle",
      "marimba",
      "glockenspiel",
      "xylophone",
      "vibraphone",
      "sub_bass",
      "bass_808",
      "sliding_808",
      "fretless_bass",
      "upright_bass",
      "synth_bass",
      "moog_bass",
      "pluck_bass",
      "organ_bass",
      "slap_bass",
      "piano",
      "upright_piano",
      "rhodes",
      "wurlitzer",
      "clavinet",
      "organ",
      "hammond",
      "gospel_organ",
      "synth_pad",
      "warm_pad",
      "choir_pad",
      "string_pad",
      "guitar_chords",
      "palmwine_guitar",
      "reggae_skank",
      "lead_guitar",
      "clean_guitar_riff",
      "flute",
      "piccolo",
      "pan_flute",
      "sax",
      "trumpet",
      "trombone",
      "brass_section",
      "violin_line",
      "strings_line",
      "synth_lead",
      "synth_pluck",
      "bell_lead",
      "mallet_lead",
      "vocal_chop",
      "double",
      "harmony_vocal",
      "chant",
      "choir",
      "gospel_choir",
      "crowd_chant",
      "humming",
      "vocal_pad",
      "spoken_word",
      "hype_vocal",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "vinyl_noise",
      "tape_hiss",
      "crowd_noise",
      "club_ambience",
      "street_ambience",
      "transition_fx",
      "beat_stop",
      "drop_fx",
      "siren"
    ],
    "signatureRoles": [
      "shekere",
      "talking_drum",
      "highlife_guitar",
      "bass_guitar",
      "call_response"
    ],
    "forbiddenTraits": [
      "log_drum bass melody (that is amapiano, not afrobeats)",
      "four-on-the-floor kick on every beat (house / EDM / amapiano)",
      "reggaeton or dembow boom-ch-boom-chick riddim",
      "heavy triplet-shuffled amapiano piano stabs / house_piano_stab",
      "sliding 808 as the primary bass (afro-trap / trap territory)",
      "drill hat slides or drill sliding-808 groove",
      "dark broken gqom 4/4 percussion",
      "trap hi-hat rolls dominating the groove",
      "rigid dead-straight quantization with no percussion bounce",
      "extended Fela-style Afrobeat horn-jam structure (a different genre)"
    ],
    "grooveRules": "Afrobeats rides a syncopated, rolling pocket — NOT four-on-the-floor. The kick anchors beat 1 then pushes off-grid (commonly the 'and' of 2 into beat 3), giving the signature 'gidi-gidi' bounce; it deliberately leaves most downbeats open. The backbeat (clap / rimshot / snare) usually lands on beat 3 as a half-bar accent, sometimes doubling on 2 and 4. Shekere and shaker carry unbroken 16th-note motion with a light swing, accenting offbeats to drive the roll forward. Talking drum, conga and bongo trade syncopated call-and-response licks in the gaps between kicks, especially across 4-bar turnarounds. The bass is melodic and bouncy — a bass_guitar or round synth_bass that moves with the chord changes and locks to the kick, never a static 808 sub drone. Clean highlife-style guitar or bright plucks/marimba interlock over the bassline. Everything is played slightly loose and human: the swing lives in timing and percussion feel, not a shuffle grid. Vocals lead, dense with adlibs. Tempo 100–118, typical ~107.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "shekere",
          "shaker",
          "talking_drum",
          "synth_pluck",
          "highlife_guitar",
          "warm_pad",
          "adlib",
          "chant",
          "vinyl_noise"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "closed_hat",
          "rimshot",
          "clap",
          "shaker",
          "shekere",
          "conga",
          "bass_guitar",
          "highlife_guitar",
          "synth_pluck",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "closed_hat",
          "open_hat",
          "clap",
          "shaker",
          "shekere",
          "talking_drum",
          "snare_roll",
          "bass_guitar",
          "warm_pad",
          "harmony_vocal",
          "riser",
          "transition_fx",
          "beat_stop"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "clap",
          "snare",
          "closed_hat",
          "open_hat",
          "shaker",
          "shekere",
          "conga",
          "bongo",
          "talking_drum",
          "bass_guitar",
          "synth_pluck",
          "highlife_guitar",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "call_response",
          "crash"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "closed_hat",
          "rimshot",
          "shaker",
          "shekere",
          "talking_drum",
          "bongo",
          "bass_guitar",
          "synth_bass",
          "rhodes",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "soft_kick",
          "shaker",
          "shekere",
          "rhodes",
          "piano",
          "warm_pad",
          "highlife_guitar",
          "harmony_vocal",
          "humming",
          "choir",
          "downlifter",
          "beat_stop"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "kick",
          "clap",
          "snare",
          "closed_hat",
          "open_hat",
          "shaker",
          "shekere",
          "conga",
          "bongo",
          "talking_drum",
          "agogo",
          "bass_guitar",
          "synth_pluck",
          "highlife_guitar",
          "brass_section",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "call_response",
          "gospel_choir",
          "crowd_chant",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "shekere",
          "shaker",
          "talking_drum",
          "synth_pluck",
          "highlife_guitar",
          "adlib",
          "chant",
          "vinyl_noise",
          "beat_stop"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [
      "lead_vocal",
      "kick",
      "bass_guitar",
      "clap",
      "snare",
      "shekere",
      "shaker",
      "adlib",
      "talking_drum",
      "conga",
      "highlife_guitar",
      "synth_pluck",
      "rhodes",
      "warm_pad"
    ],
    "qualityChecks": [
      "kick is syncopated and does NOT hit four-on-the-floor",
      "shekere/shaker keeps continuous 16th-note motion with a light bounce",
      "backbeat clap or rimshot lands as an offbeat accent (often beat 3)",
      "talking_drum or conga/bongo audible in fills and 4-bar turnarounds",
      "bass is melodic and bouncy, tracking the chords, not a static 808 drone",
      "tempo sits 100-118 BPM",
      "vocal-forward mix with layered adlibs and call-and-response",
      "NO amapiano log_drum present",
      "NO house/EDM four-on-the-floor kick",
      "NO reggaeton dembow pattern"
    ],
    "engineTags": [
      "afrobeats",
      "afropop",
      "nigerian afrobeats",
      "syncopated afro groove",
      "shekere shaker 16ths",
      "talking drum percussion",
      "melodic bassline",
      "highlife guitar",
      "call-and-response adlibs",
      "107 bpm afro bounce"
    ]
  },
  "alte": {
    "genre": "alte",
    "displayName": "Alté",
    "origin": "Nigeria (Lagos) — West African \"alternative\" / afro-fusion movement, emerged mid-2010s (Odunsi The Engine, Cruel Santino, Lady Donli, Amaarae, Tay Iwar, DRB Lasgidi). A subculture-driven, genre-fluid offshoot of afrobeats fused with alt-R&B, neo-soul, indie, funk, psychedelia and lo-fi.",
    "bpmLo": 85,
    "bpmHi": 118,
    "typicalBpm": 102,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "soft_kick",
      "closed_hat",
      "shaker",
      "clap",
      "rimshot",
      "bass_guitar",
      "synth_bass",
      "rhodes",
      "guitar_chords",
      "warm_pad",
      "lead_vocal",
      "double",
      "harmony_vocal",
      "adlib",
      "vinyl_noise"
    ],
    "optionalRoles": [
      "kick",
      "kick_808",
      "sliding_808",
      "bass_808",
      "sub_bass",
      "moog_bass",
      "fretless_bass",
      "pluck_bass",
      "snap",
      "open_hat",
      "ride",
      "crash",
      "snare",
      "trap_hat_roll",
      "shekere",
      "talking_drum",
      "conga",
      "bongo",
      "agogo",
      "cowbell",
      "woodblock",
      "kalimba",
      "wurlitzer",
      "organ",
      "piano",
      "synth_pad",
      "choir_pad",
      "string_pad",
      "palmwine_guitar",
      "highlife_guitar",
      "clean_guitar_riff",
      "lead_guitar",
      "synth_lead",
      "synth_pluck",
      "bell_lead",
      "sax",
      "trumpet",
      "flute",
      "vocal_chop",
      "humming",
      "vocal_pad",
      "call_response",
      "spoken_word",
      "chant",
      "choir",
      "tape_hiss",
      "reverse_cymbal",
      "riser",
      "sweep",
      "downlifter",
      "transition_fx",
      "beat_stop",
      "nature_ambience",
      "street_ambience",
      "crowd_noise",
      "impact"
    ],
    "signatureRoles": [
      "rhodes",
      "guitar_chords",
      "harmony_vocal",
      "vinyl_noise",
      "bass_guitar"
    ],
    "forbiddenTraits": [
      "log_drum-led groove (that is amapiano, not alté)",
      "four-on-the-floor house/kwaito/afrohouse kick",
      "aggressive commercial afrobeats 'banger' energy or big Afropop pop-drop",
      "reggaeton dembow pattern",
      "gqom dark broken 4/4 percussion",
      "hard trap/drill 808-plus-hi-hat-roll as the entire identity",
      "loud, dry, brick-walled over-quantized radio-pop mix (alté is hazy, wet, spacious)",
      "EDM build-and-drop dynamics",
      "amapiano-style patient log-drum build with soft kick + shaker as the core engine"
    ],
    "grooveRules": "The pocket is afro-derived but pulled apart and spacious — a syncopated soft kick with a ghosted rim/snap/clap backbeat, never four-on-the-floor and never log-drum-led. A shaker and crisp closed hats run a loose 16th-note motion that sits slightly behind the grid, giving the hazy, laid-back, almost intoxicated feel that defines alté; drums are understated and lightly humanized rather than slamming. Trap-flavoured hat rolls or a sliding 808 may surface on a switch or verse2 but never dominate. The bass is the melodic anchor — a warm bass_guitar or synth_bass that locks to the kick on downbeats yet roams with neo-soul/funk phrasing. Harmony is carried by Rhodes/Wurlitzer and reverb-and-chorus-drenched clean guitar; the whole mix is bathed in reverb and delay for a wide, dreamy, lo-fi haze, with vinyl crackle and tape hiss printed into the bed. Vocals are soft, breathy and conversational (light auto-tune, pidgin/English code-switching), stacked into lush harmonies on hooks. Arrangements breathe — sparse verses, half-time or fuller hooks, and frequent beat-switches, interludes or ambient/field-recording passages instead of mechanical EDM builds.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "warm_pad",
          "rhodes",
          "guitar_chords",
          "vinyl_noise",
          "tape_hiss",
          "humming",
          "street_ambience"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "soft_kick",
          "rimshot",
          "closed_hat",
          "shaker",
          "bass_guitar",
          "rhodes",
          "guitar_chords",
          "lead_vocal",
          "adlib",
          "vinyl_noise"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "soft_kick",
          "closed_hat",
          "open_hat",
          "clap",
          "shaker",
          "bass_guitar",
          "rhodes",
          "warm_pad",
          "lead_vocal",
          "harmony_vocal",
          "vocal_pad",
          "riser",
          "sweep"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "soft_kick",
          "clap",
          "closed_hat",
          "open_hat",
          "shaker",
          "shekere",
          "bass_guitar",
          "synth_bass",
          "rhodes",
          "warm_pad",
          "clean_guitar_riff",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "vocal_chop"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "soft_kick",
          "rimshot",
          "snap",
          "closed_hat",
          "trap_hat_roll",
          "shaker",
          "kalimba",
          "synth_bass",
          "conga",
          "talking_drum",
          "lead_vocal",
          "adlib",
          "vinyl_noise"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "rhodes",
          "wurlitzer",
          "sax",
          "synth_lead",
          "warm_pad",
          "spoken_word",
          "humming",
          "reverse_cymbal",
          "beat_stop",
          "nature_ambience",
          "bass_guitar"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "kick",
          "soft_kick",
          "clap",
          "closed_hat",
          "open_hat",
          "shaker",
          "shekere",
          "conga",
          "bass_guitar",
          "synth_bass",
          "rhodes",
          "warm_pad",
          "clean_guitar_riff",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "vocal_chop",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "warm_pad",
          "rhodes",
          "guitar_chords",
          "humming",
          "vocal_pad",
          "vinyl_noise",
          "tape_hiss",
          "nature_ambience"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "soft_kick"
    ],
    "qualityChecks": [
      "lead vocal sits on top — breathy, laid-back, with long reverb and delay tails",
      "audible lo-fi bed: vinyl crackle and/or tape hiss printed under the mix",
      "syncopated afro pocket — NOT four-on-the-floor and NOT log-drum-led",
      "loose, slightly-behind-the-beat human feel, not tightly quantized",
      "melodic prominent bassline (bass_guitar/synth_bass), not merely a sub-808",
      "Rhodes/Wurlitzer or reverb-drenched clean guitar carrying the harmony",
      "continuous shaker / closed-hat 16th-note motion driving the groove",
      "stacked lush vocal harmonies in the hook",
      "wide, wet, reverb-heavy mix (not dry, loud or brick-walled)",
      "a beat-switch, interlude or ambient/field-recording section is present"
    ],
    "engineTags": [
      "alté",
      "Nigerian alternative",
      "afro-fusion",
      "lo-fi R&B",
      "dreamy neo-soul",
      "hazy psychedelic",
      "reverb-drenched",
      "laid-back mid-tempo",
      "moody atmospheric",
      "Lagos underground"
    ]
  },
  "amapiano": {
    "genre": "amapiano",
    "displayName": "Amapiano",
    "origin": "South Africa (Gauteng townships — Pretoria, Johannesburg, Soweto/Alexandra), emerged mid-2010s as a fusion of deep house, kwaito, jazz and lounge. Log-drum-led variant crossed over from gqom around 2019.",
    "bpmLo": 108,
    "bpmHi": 118,
    "typicalBpm": 112,
    "swing": "moderate",
    "fourOnFloor": false,
    "requiredRoles": [
      "soft_kick",
      "log_drum",
      "shaker",
      "rimshot",
      "clap",
      "piano",
      "warm_pad",
      "vocal_chop"
    ],
    "optionalRoles": [
      "sub_bass",
      "rhodes",
      "wurlitzer",
      "house_piano_stab",
      "organ",
      "gospel_organ",
      "synth_pad",
      "string_pad",
      "choir_pad",
      "marimba",
      "vibraphone",
      "kalimba",
      "mbira",
      "sax",
      "flute",
      "pan_flute",
      "bell_lead",
      "synth_pluck",
      "cabasa",
      "woodblock",
      "cowbell",
      "conga",
      "bongo",
      "snap",
      "closed_hat",
      "open_hat",
      "ride",
      "crash",
      "snare_roll",
      "drum_roll",
      "adlib",
      "chant",
      "call_response",
      "harmony_vocal",
      "spoken_word",
      "crowd_chant",
      "gospel_choir",
      "choir",
      "humming",
      "vocal_pad",
      "riser",
      "sweep",
      "impact",
      "reverse_cymbal",
      "vinyl_noise",
      "tape_hiss",
      "club_ambience",
      "crowd_noise",
      "transition_fx",
      "beat_stop",
      "drop_fx"
    ],
    "signatureRoles": [
      "log_drum",
      "soft_kick",
      "shaker",
      "vocal_chop",
      "rhodes"
    ],
    "forbiddenTraits": [
      "Pounding hard four-on-the-floor house/EDM kick as the driver (that reads house or gqom, not amapiano)",
      "Nigerian afrobeats groove: syncopated kick+snare with talking_drum or shekere-led 16ths",
      "Trap/afrobeats bass_808 or sliding_808 as the main bass instead of the log_drum",
      "Reggaeton dembow pattern",
      "Fast tempo above ~120 BPM",
      "Big-room EDM drops or aggressive supersaw/reese leads",
      "Dark, minimal, aggressive gqom energy stripped of jazzy warmth",
      "Highlife interlocking clean electric guitars",
      "Drill/trap hi-hat rolls and slides as the rhythmic engine",
      "Instant drop with no patient, filtered build"
    ],
    "grooveRules": "The pocket is carried by the log_drum, NOT the kick. A soft, round, deep kick anchors a relaxed pulse in a broken/sparse pattern (never a pounding 4-on-the-floor house kick), while the pitched log_drum plays the real hook of the track: a syncopated, gliding, bouncing sub-bass melody that lands in the gaps around the kick and defines the low end. A continuous shaker runs busy swung 16ths for forward motion; rimshot and/or clap answer on the backbeat (2 and 4) with a laid-back, dragged, shuffled feel. Everything breathes with space and moderate swing — the groove is patient, hypnotic and conversational, built on call-and-response between log_drum, percussion and vocal chops. Jazzy piano/rhodes stabs and warm pads float on top without crowding the low-end conversation. Energy is built by ADDING and filtering layers over many bars, not by dropping a wall of sound.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "warm_pad",
          "piano",
          "shaker",
          "vinyl_noise",
          "vocal_chop",
          "riser"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "soft_kick",
          "log_drum",
          "shaker",
          "rimshot",
          "clap",
          "piano",
          "warm_pad",
          "lead_vocal"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "shaker",
          "snare_roll",
          "drum_roll",
          "riser",
          "sweep",
          "warm_pad",
          "vocal_chop",
          "beat_stop",
          "impact"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "soft_kick",
          "log_drum",
          "shaker",
          "rimshot",
          "clap",
          "piano",
          "rhodes",
          "warm_pad",
          "vocal_chop",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "soft_kick",
          "log_drum",
          "shaker",
          "rimshot",
          "piano",
          "sax",
          "lead_vocal",
          "call_response"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "rhodes",
          "piano",
          "warm_pad",
          "sax",
          "chant",
          "call_response",
          "log_drum",
          "shaker",
          "vinyl_noise"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "soft_kick",
          "log_drum",
          "shaker",
          "rimshot",
          "clap",
          "piano",
          "rhodes",
          "warm_pad",
          "vocal_chop",
          "adlib",
          "gospel_choir",
          "crowd_chant",
          "cowbell"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "log_drum",
          "shaker",
          "warm_pad",
          "piano",
          "vocal_chop",
          "vinyl_noise",
          "sweep"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "soft_kick"
    ],
    "qualityChecks": [
      "log_drum present as a pitched, gliding, bouncing sub-bass bassline",
      "soft, round, deep kick — NOT a hard pounding 4-on-the-floor house kick",
      "continuous shaker running busy swung 16th-note motion",
      "rimshot and/or clap answering on the backbeat with a laid-back shuffle",
      "jazzy, soulful piano or rhodes chords/stabs sitting on top",
      "warm pad bed floating under the groove",
      "tempo sits 108-118 BPM (mid-tempo, not fast)",
      "moderate swing/shuffle — groove is not straight or robotic",
      "patient extended build with space, no instant EDM drop",
      "no talking_drum / shekere afrobeats signature and no trap 808 bass"
    ],
    "engineTags": [
      "amapiano",
      "log drum bassline",
      "South African deep house",
      "soft deep kick",
      "jazzy piano rhodes",
      "swung shaker percussion",
      "warm soulful pads",
      "vocal chops chant",
      "112 bpm mid-tempo",
      "patient hypnotic groove"
    ]
  },
  "apala": {
    "genre": "apala",
    "displayName": "Àpàlà (Yoruba percussion praise)",
    "origin": "Nigeria — Yoruba Muslim communities of the Ijebu/Ibadan/Ogun belt, late 1930s–1940s. Grew out of àjíṣárì/wéré, the Ramadan pre-dawn wake-up singing, into a secular praise/proverb form. Defining masters: Haruna Ishola (the king of apala) and Ayinla Omowura (Egunmola); a direct ancestor of fuji.",
    "bpmLo": 96,
    "bpmHi": 132,
    "typicalBpm": 112,
    "swing": "triplet",
    "fourOnFloor": false,
    "requiredRoles": [
      "talking_drum",
      "dundun",
      "shekere",
      "agogo",
      "mbira",
      "lead_vocal",
      "call_response"
    ,
      "bass_guitar"
    ],
    "optionalRoles": [
      "sakara",
      "bata",
      "kalimba",
      "claves",
      "shaker",
      "harmony_vocal",
      "chant",
      "adlib",
      "crowd_chant",
      "spoken_word",
      "humming",
      "crowd_noise",
      "vinyl_noise",
      "tape_hiss"
    ],
    "signatureRoles": [
      "talking_drum",
      "mbira",
      "shekere",
      "agogo",
      "call_response"
    ],
    "forbiddenTraits": [
      "drum kit (kick/snare/hi-hats/ride) of any kind — apala is hand/stick percussion only",
      "four-on-the-floor pulse",
      "808s, sub_bass, synth_bass, sliding_808 or amapiano log_drum (would be afrobeats/amapiano)",
      "electric or highlife_guitar / palmwine_guitar / reggae_skank — guitars turn it into juju or highlife",
      "piano, organ, rhodes, synth_pad or any chord-comping keyboard (apala has no chordal harmony instrument)",
      "brass_section / sax lead (that is Afrobeat/juju, not apala)",
      "goje one-string-fiddle led melody (that is sakara music, its cousin)",
      "fast, dense sakara-and-dundun fuji breakdowns with NO agidigbo (that is fuji)",
      "EDM riser/drop/build-up structure or DJ FX as the arrangement spine",
      "auto-tuned trap/afropop lead, English-language pop hook",
      "reggaeton dembow or straight quantized grid timing"
    ],
    "grooveRules": "Cyclic, swung 12/8 (triplet-lilt) groove built entirely by hand. The agogo bell states a fixed repeating timeline that every part locks to; the shekere marks a steady rattling pulse that pushes the off-beats. The agidigbo — a large bass thumb-piano, mapped here to mbira — plucks a looping low ostinato that is BOTH the bassline AND the only harmonic anchor: there is no chord instrument. Supporting dundun drums interlock a mid-register pattern while the lead iyaalu talking_drum 'speaks' — it bends pitch to imitate Yoruba speech, answers the cantor in the gaps between lines, and cues every turnaround with a rolling fill. Vocals are strict call-and-response: a lead cantor delivers praise, oríkì, proverbs and Islamic-tinged narration, and a chorus answers each phrase. Energy rises through drum density, talking-drum activity and vocal fervor — never through EDM builds or drops. Timing is elastic and human (push-pull), never grid-quantized; the pocket is relaxed, mid-paced and rolling.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "agogo",
          "shekere",
          "mbira",
          "talking_drum",
          "vinyl_noise"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "mbira",
          "shekere",
          "agogo",
          "dundun",
          "talking_drum",
          "call_response"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "call_response",
          "talking_drum",
          "dundun",
          "shekere",
          "agogo",
          "mbira",
          "adlib"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "call_response",
          "harmony_vocal",
          "talking_drum",
          "dundun",
          "shekere",
          "agogo",
          "mbira",
          "adlib",
          "crowd_chant"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "talking_drum",
          "agogo",
          "shekere",
          "mbira",
          "spoken_word",
          "chant"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "mbira",
          "shekere",
          "agogo",
          "dundun",
          "talking_drum",
          "call_response",
          "adlib",
          "sakara"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "lead_vocal",
          "call_response",
          "harmony_vocal",
          "talking_drum",
          "dundun",
          "sakara",
          "bata",
          "shekere",
          "agogo",
          "mbira",
          "adlib",
          "crowd_chant"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "agogo",
          "shekere",
          "mbira",
          "talking_drum",
          "lead_vocal",
          "vinyl_noise"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [
      "lead_vocal",
      "talking_drum",
      "call_response",
      "agogo",
      "shekere",
      "mbira",
      "dundun",
      "adlib"
    ],
    "qualityChecks": [
      "lead iyaalu talking_drum audibly bends pitch to 'speak', answering the singer in the gaps between vocal lines",
      "true call-and-response: lead cantor line, chorus answers, repeating",
      "fixed agogo bell timeline runs continuously through every section",
      "shekere gourd rattle keeps steady swung/triplet 16th-style motion",
      "agidigbo-style plucked thumb-piano (mbira) bass ostinato is the low end — NOT a bass guitar, synth or 808",
      "Yoruba-language vocal delivery with praise/proverb cadence",
      "no drum kit, no guitars, no keyboards, no chordal harmony instrument anywhere",
      "swung 12/8 triplet feel, mid-tempo, cyclical — no EDM build or drop",
      "acoustic live-ensemble sound with loose human timing",
      "energy grows via added percussion (sakara/bata) and vocal intensity, not filter sweeps"
    ],
    "engineTags": [
      "apala",
      "yoruba apala",
      "talking drum lead",
      "agidigbo thumb-piano bass",
      "shekere and agogo bell",
      "call-and-response praise vocals",
      "acoustic percussion ensemble",
      "12/8 triplet swing",
      "nigerian traditional roots",
      "haruna ishola style"
    ]
  },
  "azonto": {
    "genre": "azonto",
    "displayName": "Azonto (Ghanaian Dance / Hiplife)",
    "origin": "Ghana — Accra; Ga/Akan roots. Emerged ~2011-2013 out of hiplife and the azonto dance craze, its programmed groove derived from the traditional Ga kpanlogo bell/conga rhythm. Distinct from Nigerian afrobeats, from South African amapiano/kwaito, and from Ghanaian highlife.",
    "bpmLo": 124,
    "bpmHi": 140,
    "typicalBpm": 130,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "clap",
      "snare",
      "closed_hat",
      "cowbell",
      "agogo",
      "conga",
      "shaker",
      "synth_bass",
      "synth_lead",
      "lead_vocal",
      "chant",
      "call_response"
    ],
    "optionalRoles": [
      "club_kick",
      "kick_808",
      "bass_808",
      "rimshot",
      "snap",
      "open_hat",
      "ride",
      "crash",
      "snare_roll",
      "drum_roll",
      "talking_drum",
      "shekere",
      "woodblock",
      "claves",
      "bongo",
      "timbales",
      "balafon",
      "marimba",
      "xylophone",
      "glockenspiel",
      "sub_bass",
      "pluck_bass",
      "synth_pad",
      "warm_pad",
      "house_piano_stab",
      "organ",
      "highlife_guitar",
      "guitar_chords",
      "piano",
      "synth_pluck",
      "brass_section",
      "trumpet",
      "bell_lead",
      "mallet_lead",
      "flute",
      "adlib",
      "double",
      "harmony_vocal",
      "crowd_chant",
      "hype_vocal",
      "spoken_word",
      "riser",
      "impact",
      "reverse_cymbal",
      "sweep",
      "siren",
      "beat_stop",
      "drop_fx",
      "transition_fx",
      "crowd_noise",
      "club_ambience",
      "downlifter"
    ],
    "signatureRoles": [
      "cowbell",
      "agogo",
      "conga",
      "synth_bass",
      "call_response"
    ],
    "forbiddenTraits": [
      "log_drum-led groove (that is amapiano)",
      "four-on-the-floor house/kwaito/afro-house kick",
      "reggaeton/dembow boom-ch-boom-chick pattern",
      "slow 100-108 BPM afrobeats pocket",
      "amapiano soft_kick + patient jazzy piano build",
      "gqom dark broken minimalism",
      "trap 808 glides / drill hat-rolls as the main groove",
      "purely acoustic live-band highlife with no programmed percussion",
      "absent or buried cowbell/agogo bell",
      "straight rock/pop backbeat with no African bell-and-conga interlock",
      "moody down-tempo R&B vibe"
    ],
    "grooveRules": "Fast, tightly-programmed 4/4 with a hard BOUNCE — NOT four-on-the-floor. The engine is the interlocking bell pair: a steady driving cowbell under a higher agogo playing the Ga kpanlogo bell figure, with congas trading an offbeat interlocking pattern. The kick is syncopated (roughly beat 1, the 'a' of 2, and a push just before 3), deliberately leaving holes that a plucky, short, gliding synth bass fills locked to the kick. Clap/snare mark the backbeat (2 & 4) plus extra syncopated ghost claps that create the signature 'toffie' skip. Closed hat or shaker run continuous 16ths for forward drive; open hats accent the offbeat. Feel is straight-16th — the danceable gallop comes from syncopated placement, not swung timing (quantized but funky). Melodies are short, bright, repetitive synth/marimba/brass riffs that leave holes for vocal chants. Arrangements breathe around dance breaks: beat-stops and siren/air-horn stabs cue the crowd, then the full groove slams back in.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "cowbell",
          "agogo",
          "shaker",
          "conga",
          "closed_hat",
          "chant",
          "hype_vocal",
          "siren",
          "riser"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "clap",
          "snare",
          "closed_hat",
          "cowbell",
          "agogo",
          "conga",
          "shaker",
          "synth_bass",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "clap",
          "closed_hat",
          "open_hat",
          "cowbell",
          "agogo",
          "shaker",
          "synth_bass",
          "snare_roll",
          "riser",
          "house_piano_stab",
          "chant",
          "call_response"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "clap",
          "snare",
          "closed_hat",
          "open_hat",
          "cowbell",
          "agogo",
          "conga",
          "shaker",
          "synth_bass",
          "synth_lead",
          "brass_section",
          "house_piano_stab",
          "lead_vocal",
          "chant",
          "call_response",
          "adlib",
          "crowd_chant",
          "crash"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "clap",
          "snare",
          "closed_hat",
          "cowbell",
          "agogo",
          "conga",
          "shaker",
          "talking_drum",
          "synth_bass",
          "marimba",
          "synth_pluck",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "beat_stop",
          "conga",
          "cowbell",
          "agogo",
          "shaker",
          "talking_drum",
          "clap",
          "chant",
          "call_response",
          "crowd_chant",
          "siren",
          "drop_fx",
          "riser"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "kick",
          "clap",
          "snare",
          "closed_hat",
          "open_hat",
          "cowbell",
          "agogo",
          "conga",
          "shaker",
          "synth_bass",
          "synth_lead",
          "brass_section",
          "house_piano_stab",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "chant",
          "call_response",
          "crowd_chant",
          "adlib",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "cowbell",
          "agogo",
          "conga",
          "shaker",
          "closed_hat",
          "chant",
          "hype_vocal",
          "siren",
          "club_ambience",
          "downlifter"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [
      "clap",
      "kick",
      "cowbell",
      "snare",
      "agogo",
      "synth_bass",
      "conga"
    ],
    "qualityChecks": [
      "syncopated kick pattern (NOT four-on-the-floor)",
      "driving cowbell present and prominent",
      "agogo bell playing the kpanlogo-derived figure",
      "offbeat clap/snare backbeat with syncopated ghost-clap skip",
      "bouncy plucky synth bass locked into the kick's holes",
      "continuous 16th-note shaker or closed-hat motion",
      "interlocking conga pattern audible",
      "bright short repetitive synth/marimba/brass riff hook",
      "call-and-response gang/crowd chant (azonto-style)",
      "tempo sits ~125-138 BPM",
      "at least one dance-break device (beat_stop and/or siren/air-horn)",
      "electronic/programmed production feel, not live-band"
    ],
    "engineTags": [
      "azonto",
      "Ghanaian dance hiplife",
      "syncopated cowbell-and-agogo groove",
      "bouncy plucky synth bass",
      "kpanlogo conga pattern",
      "call-and-response azonto chant",
      "bright synth lead hook",
      "uptempo 130 BPM not four-on-the-floor",
      "electronic FL-Studio afro dance production",
      "brass stabs and dancehall siren accents"
    ]
  },
  "blues": {
    "genre": "blues",
    "displayName": "Blues (Electric 12-Bar Shuffle)",
    "origin": "African-American Deep South. Born from work songs, field hollers and spirituals in the Mississippi Delta (acoustic/slide/vocal, 1900s-1930s), then electrified and band-ified into Chicago electric blues (amplified harp + guitar + rhythm section), Texas guitar blues, piano boogie-woogie/barrelhouse, and jump/West Coast horn blues. Built on the 12-bar I-IV-V form, dominant-7th tonality, blue notes and call-and-response.",
    "bpmLo": 60,
    "bpmHi": 160,
    "typicalBpm": 100,
    "swing": "triplet",
    "fourOnFloor": false,
    "requiredRoles": [
      "lead_vocal",
      "lead_guitar",
      "guitar_chords",
      "bass_guitar",
      "kick",
      "snare",
      "closed_hat"
    ],
    "optionalRoles": [
      "harmonica",
      "piano",
      "upright_piano",
      "hammond",
      "organ",
      "wurlitzer",
      "ride",
      "open_hat",
      "rimshot",
      "brushes",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "upright_bass",
      "sax",
      "trumpet",
      "trombone",
      "brass_section",
      "adlib",
      "harmony_vocal",
      "double",
      "call_response",
      "humming",
      "vinyl_noise",
      "tape_hiss",
      "crowd_noise",
      "club_ambience",
      "beat_stop"
    ],
    "signatureRoles": [
      "lead_guitar",
      "harmonica",
      "piano",
      "hammond"
    ],
    "forbiddenTraits": [
      "four-on-the-floor kick",
      "808s / sliding sub-bass / trap hi-hat rolls / drum-machine claps",
      "straight-quantized 16th groove with no swing (kills the shuffle)",
      "autotuned pitch-perfect pop vocals",
      "EDM risers, drops, sweeps, sirens",
      "log drum / amapiano / afrobeats percussion",
      "reggaeton dembow or reggae skank",
      "smooth-jazz major-7th reharmonization or diatonic pop chord loops",
      "dense synth pads and glossy modern pop production",
      "rapping / hip-hop flows",
      "brickwalled hyper-compressed master with no dynamics"
    ],
    "grooveRules": "Pocket is a triplet shuffle, never straight time: the hi-hat (or ride) plays the long-short shuffle (first + third note of each beat's triplet), the snare cracks the BACKBEAT hard on 2 and 4, and the kick anchors beat 1 and locks with the bass. Bass either WALKS in quarter notes outlining the I-IV-V or rides a boogie-woogie shuffle figure fused to the kick. Rhythm guitar comps dominant-7th/9th chords with a shuffle chunk, often the two-note boogie riff (root-5, root-6). Everything breathes on the triplet grid, humanized and slightly relaxed behind the beat, NOT quantized-tight. Harmony is the 12-bar I-IV-V (also 8-bar and 16-bar) with a turnaround in bars 11-12; dominant-7th tonality and blue notes throughout, NOT diatonic pop or major-7th smooth-jazz. Lead guitar and harmonica speak in call-and-response, filling the gaps at the ends of the vocal's AAB lyric phrases. Slow blues shifts to a 12/8 feel with triplets on every beat and expressive, near-rubato phrasing; stop-time breaks (band stabs, soloist answers into the silence) punctuate. Dynamics build across a chorus and reset each turnaround — organic live-band ebb and flow, not a static loop.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "lead_guitar",
          "guitar_chords",
          "bass_guitar",
          "kick",
          "snare",
          "closed_hat",
          "piano",
          "vinyl_noise",
          "tape_hiss"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "guitar_chords",
          "bass_guitar",
          "kick",
          "snare",
          "closed_hat",
          "piano",
          "lead_guitar",
          "harmonica",
          "call_response",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "guitar_chords",
          "bass_guitar",
          "kick",
          "snare",
          "hammond",
          "piano",
          "tom_fill",
          "snare_roll",
          "crash",
          "beat_stop"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "lead_guitar",
          "harmonica",
          "guitar_chords",
          "bass_guitar",
          "kick",
          "snare",
          "ride",
          "open_hat",
          "hammond",
          "piano",
          "harmony_vocal",
          "crash",
          "adlib"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "guitar_chords",
          "bass_guitar",
          "kick",
          "rimshot",
          "closed_hat",
          "piano",
          "harmonica",
          "call_response"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "lead_vocal",
          "lead_guitar",
          "hammond",
          "bass_guitar",
          "kick",
          "snare",
          "brushes",
          "harmonica",
          "beat_stop"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "lead_vocal",
          "lead_guitar",
          "harmonica",
          "guitar_chords",
          "bass_guitar",
          "kick",
          "snare",
          "ride",
          "open_hat",
          "hammond",
          "piano",
          "harmony_vocal",
          "double",
          "brass_section",
          "crash",
          "tom_fill",
          "adlib"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "lead_vocal",
          "lead_guitar",
          "guitar_chords",
          "bass_guitar",
          "kick",
          "snare",
          "piano",
          "crash",
          "vinyl_noise"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [],
    "qualityChecks": [
      "triplet shuffle audible — swung hi-hat/ride, not straight subdivisions",
      "snare backbeat locked on 2 and 4",
      "12-bar I-IV-V movement with a turnaround at each chorus end",
      "dominant-7th/9th tonality and blue notes (no major-7th smooth-jazz gloss)",
      "electric lead guitar with string bends + vibrato in the pentatonic/blues scale",
      "call-and-response: lead guitar or harmonica fills the gaps between vocal lines",
      "walking or boogie shuffle bass locked to the kick",
      "at least one classic blues voice present (harmonica or barrelhouse piano)",
      "warm, dynamic, live-band tone — no quantized-tight or autotuned artifacts, minimal FX",
      "stop-time break and/or turnaround ending lick detectable"
    ],
    "engineTags": [
      "blues",
      "12-bar shuffle blues",
      "electric blues",
      "bending lead guitar",
      "blues harmonica",
      "barrelhouse piano",
      "walking bass",
      "backbeat shuffle drums",
      "Chicago electric blues",
      "vintage live-band tone"
    ]
  },
  "bongo_flava": {
    "genre": "bongo_flava",
    "displayName": "Bongo Flava",
    "origin": "Tanzania (Dar es Salaam) — East African Swahili Afropop born in the 1990s from a fusion of American hip-hop/R&B, Jamaican reggae-dancehall, and local taarab (Swahili-coast orchestral) + muziki wa dansi. Modernized in the 2010s-2020s into a melodic, vocal-forward, Afrobeats-adjacent pop sound (WCB Wasafi / Diamond Platnumz, Harmonize, Rayvanny, Zuchu, Mbosso, Jux, Marioo). Defining marker: sung in Kiswahili.",
    "bpmLo": 92,
    "bpmHi": 118,
    "typicalBpm": 105,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "lead_vocal",
      "kick",
      "snare",
      "clap",
      "closed_hat",
      "shaker",
      "synth_bass",
      "piano",
      "synth_pluck",
      "adlib"
    ],
    "optionalRoles": [
      "rimshot",
      "snap",
      "open_hat",
      "ride",
      "crash",
      "kick_808",
      "soft_kick",
      "bass_808",
      "sub_bass",
      "sliding_808",
      "log_drum",
      "conga",
      "bongo",
      "cowbell",
      "agogo",
      "cabasa",
      "maraca",
      "kalimba",
      "mbira",
      "balafon",
      "rhodes",
      "wurlitzer",
      "organ",
      "gospel_organ",
      "synth_pad",
      "warm_pad",
      "string_pad",
      "choir_pad",
      "guitar_chords",
      "highlife_guitar",
      "palmwine_guitar",
      "lead_guitar",
      "clean_guitar_riff",
      "accordion",
      "oud",
      "sitar",
      "sax",
      "trumpet",
      "trombone",
      "brass_section",
      "flute",
      "violin_line",
      "strings_line",
      "bell_lead",
      "mallet_lead",
      "marimba",
      "vocal_chop",
      "double",
      "harmony_vocal",
      "chant",
      "choir",
      "gospel_choir",
      "crowd_chant",
      "call_response",
      "humming",
      "vocal_pad",
      "hype_vocal",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "vinyl_noise",
      "transition_fx",
      "beat_stop",
      "drop_fx",
      "crowd_noise",
      "club_ambience",
      "tom_fill",
      "snare_roll",
      "drum_roll"
    ],
    "signatureRoles": [
      "lead_vocal",
      "synth_pluck",
      "marimba",
      "shaker",
      "strings_line"
    ],
    "forbiddenTraits": [
      "four-on-the-floor house/amapiano kick as the core groove",
      "log-drum-LED arrangement (that is amapiano, not Bongo Flava — log drum may only appear as light flavor)",
      "reggaeton dembow as the backbone",
      "dark trap/drill 808s with no melodic African groove",
      "English-only rap/singing with no Swahili lead vocal",
      "West African highlife/juju talking-drum-led feel (that is Nigerian afrobeats)",
      "frantic 180+ BPM singeli tempo",
      "gqom-style broken dark 4/4",
      "EDM big-room drops",
      "straight, robotic un-swung hats with no East African lilt",
      "aggressive maximalist mix that buries the vocal"
    ],
    "grooveRules": "Mid-tempo, laid-back, and unapologetically vocal-forward. The kick is syncopated Afropop — NEVER four-on-the-floor — typically a downbeat hit plus a syncopated push near the 'and' of 2, leaving pocket for the singer. The backbeat lands on rimshot/clap/snare (beats 2 and 4, or beat 3 in a half-time feel). A continuous shaker and closed hats run lightly swung 16ths, supplying the East African lilt, while congas/bongos add syncopated accents that trade call-and-response with the vocal. Bass is MELODIC and mobile — a synth or 808 bassline that walks with the chord changes, not a static droned 808. Harmony is smooth (rhodes/piano, warm pad) and every part leaves air. The Swahili lead vocal and its adlibs are the loudest, most important element; bright synth pluck, marimba, and taarab-flavored strings/oud/accordion answer the vocal in the gaps rather than crowding it.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "warm_pad",
          "string_pad",
          "synth_pluck",
          "marimba",
          "shaker",
          "adlib",
          "vinyl_noise"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "closed_hat",
          "rimshot",
          "shaker",
          "synth_bass",
          "rhodes",
          "piano",
          "synth_pluck",
          "lead_vocal"
        ]
      },
      {
        "section": "pre_hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "shaker",
          "synth_bass",
          "piano",
          "strings_line",
          "harmony_vocal",
          "riser"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "crash",
          "shaker",
          "conga",
          "synth_bass",
          "synth_pluck",
          "marimba",
          "brass_section",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "closed_hat",
          "rimshot",
          "shaker",
          "conga",
          "synth_bass",
          "highlife_guitar",
          "sax",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "rhodes",
          "warm_pad",
          "strings_line",
          "accordion",
          "oud",
          "shaker",
          "call_response",
          "humming",
          "lead_vocal"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "crash",
          "ride",
          "shaker",
          "conga",
          "cowbell",
          "synth_bass",
          "synth_pluck",
          "marimba",
          "brass_section",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "gospel_choir",
          "crowd_chant"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "synth_pluck",
          "marimba",
          "shaker",
          "warm_pad",
          "adlib",
          "chant",
          "vinyl_noise"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "kick",
      "synth_bass"
    ],
    "qualityChecks": [
      "lead vocal is in Kiswahili with melodic R&B/taarab-tinged phrasing and sits on top of the mix",
      "hats and shaker are lightly SWUNG 16ths, not straight or robotic",
      "kick is syncopated Afropop — audibly NOT four-on-the-floor",
      "bassline is melodic and moving, not a static 808 drone",
      "a bright plucky synth lead hook is present and answers the vocal",
      "marimba/mallet or taarab strings/oud/accordion color is audible somewhere",
      "mid-tempo pocket around 100-108 BPM with laid-back, spacious feel",
      "hook stacks vocals (double + harmony + adlibs) noticeably fuller than verses",
      "congas/bongos provide syncopated call-and-response accents",
      "vocal-forward mix that leaves air — never maximalist wall-of-sound"
    ],
    "engineTags": [
      "bongo flava",
      "Tanzanian Afropop",
      "Swahili melodic vocal",
      "mid-tempo swung Afrobeats groove",
      "shaker and conga percussion",
      "melodic synth bass",
      "bright synth pluck hook",
      "marimba melody",
      "taarab-influenced strings",
      "smooth romantic R&B Afropop"
    ]
  },
  "classical": {
    "genre": "classical",
    "displayName": "Classical (Orchestral / Chamber)",
    "origin": "Western art-music tradition of Europe — Baroque, Classical and Romantic eras (c. 1600–1900); concert-hall symphony orchestra, string quartet/chamber ensemble, solo piano and sacred choral settings. Conductor-led, fully acoustic, notated (not loop/grid) music.",
    "bpmLo": 50,
    "bpmHi": 180,
    "typicalBpm": 100,
    "swing": "straight",
    "fourOnFloor": false,
    "requiredRoles": [
      "strings_line",
      "violin_line",
      "upright_bass",
      "flute",
      "brass_section",
      "timpani"
    ],
    "optionalRoles": [
      "piano",
      "harpsichord",
      "organ",
      "string_pad",
      "piccolo",
      "trumpet",
      "trombone",
      "glockenspiel",
      "tubular_bells",
      "chimes",
      "gong",
      "crash",
      "triangle",
      "marimba",
      "snare_roll",
      "drum_roll",
      "choir",
      "lead_vocal",
      "harmony_vocal",
      "humming"
    ],
    "signatureRoles": [
      "strings_line",
      "violin_line",
      "timpani",
      "brass_section",
      "flute"
    ],
    "forbiddenTraits": [
      "drum-kit backbeat or four-on-the-floor kick",
      "808 / sub_bass / synth_bass / log_drum low end",
      "trap hat rolls, drill hat slides, quantized loop groove",
      "vinyl_noise, risers, downlifters, drops or any EDM/DJ FX",
      "gospel_organ, gospel_choir, house_piano_stab, reggae_skank",
      "electric/distorted guitar, autotuned lead vocal, vocal_chop",
      "rigid click-track timing with no rubato or dynamic swell",
      "flat brick-walled loudness (kills the crescendo/decrescendo identity)"
    ],
    "grooveRules": "No drum kit and no fixed backbeat — pulse is carried by the whole ensemble under a conductor. Time is elastic: rubato, accelerando and ritardando bend the tempo for phrasing, so the render must NOT sit on a rigid quantized grid. Metric feel comes from bowing patterns, articulation (staccato vs legato) and harmonic rhythm, not from percussion. Timpani and low strings (upright/double bass) anchor structural downbeats, cadences and pedal points; timpani and cymbal rolls swell into climaxes. Dynamics are the real groove engine — long crescendo/decrescendo arcs plus terraced (Baroque) or graduated (Romantic) dynamics drive momentum. Melody is handed between sections (strings → woodwinds → brass) in call-and-answer counterpoint over independent moving inner voices. Phrases are 4- or 8-bar antecedent/consequent units resolving on authentic/half cadences.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "violin_line",
          "strings_line",
          "flute"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "strings_line",
          "violin_line",
          "upright_bass",
          "flute",
          "piano"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "strings_line",
          "brass_section",
          "timpani",
          "snare_roll",
          "piccolo",
          "upright_bass"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "strings_line",
          "violin_line",
          "brass_section",
          "trumpet",
          "trombone",
          "timpani",
          "flute",
          "piccolo",
          "crash",
          "glockenspiel"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "strings_line",
          "violin_line",
          "upright_bass",
          "harpsichord",
          "flute"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "strings_line",
          "brass_section",
          "timpani",
          "organ",
          "tubular_bells",
          "drum_roll"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "strings_line",
          "violin_line",
          "brass_section",
          "trumpet",
          "trombone",
          "timpani",
          "crash",
          "gong",
          "flute",
          "piccolo",
          "glockenspiel",
          "chimes",
          "choir"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "strings_line",
          "violin_line",
          "upright_bass",
          "timpani",
          "gong"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [],
    "qualityChecks": [
      "real acoustic orchestral timbres — no synth pads or electronic bass",
      "audible crescendo/decrescendo dynamic swells, not flat loudness",
      "rubato / elastic tempo, not a rigid quantized grid",
      "no drum-kit backbeat and no four-on-the-floor",
      "timpani present, with rolls swelling into cadences/climaxes",
      "natural concert-hall reverb and depth",
      "legato bowed strings with expressive vibrato on the violin lead",
      "full-tutti brass-and-strings climax at the hook",
      "layered counterpoint / independent moving inner voices",
      "cymbal (crash) and/or gong marking the grand restatement"
    ],
    "engineTags": [
      "classical orchestral",
      "symphonic strings",
      "solo violin lead",
      "timpani and brass",
      "woodwind ensemble",
      "concert hall reverb",
      "rubato dynamic swells",
      "acoustic no drum machine",
      "romantic era cinematic",
      "counterpoint"
    ]
  },
  "country": {
    "genre": "country",
    "displayName": "Country (Nashville / Roots)",
    "origin": "United States — Southern US and Appalachia, with Nashville, Tennessee as the commercial center. Rooted in Appalachian/Anglo-Celtic folk balladry, Delta blues, honky-tonk, Western swing, and bluegrass; the modern radio form fuses these with rock and pop production.",
    "bpmLo": 65,
    "bpmHi": 150,
    "typicalBpm": 108,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "live_kick",
      "snare",
      "closed_hat",
      "guitar_chords",
      "bass_guitar",
      "lead_vocal"
    ],
    "optionalRoles": [
      "upright_bass",
      "upright_piano",
      "piano",
      "organ",
      "hammond",
      "brushes",
      "rimshot",
      "ride",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "mandolin",
      "harmonica",
      "lead_guitar",
      "accordion",
      "string_pad",
      "strings_line",
      "double",
      "adlib",
      "shaker",
      "clap",
      "crowd_chant",
      "nature_ambience"
    ],
    "signatureRoles": [
      "pedal_steel",
      "fiddle",
      "banjo",
      "clean_guitar_riff",
      "harmony_vocal"
    ],
    "forbiddenTraits": [
      "bass_808 / sliding_808 sub-bass (turns it trap/country-trap)",
      "trap_hat_roll or drill_hat_slide 32nd-note hi-hats",
      "log_drum or amapiano percussion",
      "four-on-the-floor club/dance kick",
      "reggaeton dembow groove",
      "heavy vocal-chop or autotuned melisma as the lead",
      "talking_drum / shekere / afrobeats percussion",
      "reese_bass or EDM synth bass",
      "synth_lead as the primary melodic hook",
      "rigidly quantized machine-grid feel with no human push-pull"
    ],
    "grooveRules": "Backbeat-driven, never four-on-the-floor. Kick anchors beat 1 (often adding the '&' of 2), snare or cross-stick rimshot cracks hard on beats 2 and 4. Verses pull back to cross-stick or brushes for intimacy; the chorus opens up to a full ringing snare backbeat. The 'train beat' — steady driving eighth-notes on the snare (brushes or sticks) over a boom-chick pulse — is the signature up-tempo groove. Bass alternates root-fifth in a two-beat/cut-time feel on traditional cuts, or locks tight to the kick on modern radio cuts. An acoustic guitar strums an even eighth-note bed that IS the rhythmic engine of the track. Pedal steel and fiddle answer the vocal in the gaps (call-and-response fills) and swell as a pad — they support the lyric, never bury it. Timing is human with a light shuffle and gentle push-pull; sections breathe dynamically, laying back under verses and lifting into the chorus.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "guitar_chords",
          "pedal_steel",
          "clean_guitar_riff",
          "bass_guitar",
          "nature_ambience"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "guitar_chords",
          "bass_guitar",
          "live_kick",
          "rimshot",
          "closed_hat",
          "pedal_steel"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "guitar_chords",
          "bass_guitar",
          "live_kick",
          "snare",
          "closed_hat",
          "fiddle",
          "snare_roll"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "double",
          "guitar_chords",
          "clean_guitar_riff",
          "bass_guitar",
          "live_kick",
          "snare",
          "closed_hat",
          "crash",
          "pedal_steel",
          "fiddle"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "guitar_chords",
          "bass_guitar",
          "live_kick",
          "snare",
          "closed_hat",
          "banjo",
          "mandolin",
          "pedal_steel"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "lead_guitar",
          "fiddle",
          "pedal_steel",
          "harmony_vocal",
          "organ",
          "bass_guitar",
          "live_kick",
          "tom_fill"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "double",
          "crowd_chant",
          "guitar_chords",
          "clean_guitar_riff",
          "lead_guitar",
          "bass_guitar",
          "live_kick",
          "snare",
          "ride",
          "crash",
          "pedal_steel",
          "fiddle",
          "tom_fill"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "lead_vocal",
          "guitar_chords",
          "pedal_steel",
          "bass_guitar",
          "nature_ambience"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "snare",
      "guitar_chords",
      "bass_guitar",
      "live_kick",
      "harmony_vocal",
      "clean_guitar_riff",
      "pedal_steel",
      "fiddle",
      "closed_hat"
    ],
    "qualityChecks": [
      "pedal_steel audible with volume-pedal swells and glissando bends",
      "live-drum backbeat with snare on 2 & 4 — NOT four-on-the-floor",
      "acoustic guitar strum present as the rhythmic bed",
      "twangy clean electric (Telecaster) fills and licks",
      "fiddle and/or banjo present in the arrangement",
      "tight vocal harmonies in thirds/sixths stacked on the hook",
      "bass is bass_guitar/upright in a root-fifth or kick-locked pocket, no 808 sub",
      "lyric-forward, intelligible storytelling lead vocal with minimal autotune",
      "light shuffle / human timing, not rigidly quantized",
      "no trap hats, no 808s, no dance four-on-the-floor"
    ],
    "engineTags": [
      "country",
      "nashville country",
      "pedal steel",
      "fiddle",
      "acoustic guitar",
      "telecaster twang",
      "live drums backbeat",
      "vocal harmonies",
      "banjo",
      "storytelling vocal"
    ]
  },
  "coupe_decale": {
    "genre": "coupe_decale",
    "displayName": "Coupé-Décalé",
    "origin": "Côte d'Ivoire / Ivorian diaspora in Paris, early-to-mid 2000s (Douk Saga & the Jet Set, DJ Arafat, Molare, later Serge Beynaud, DJ Mix, Debordo). A DJ/animateur-driven, drum-machine electronic reworking of Congolese soukous/ndombolo — faster, looped and hype-led. Nouchi slang: 'couper' (swindle) + 'décaler' (dodge/shift).",
    "bpmLo": 118,
    "bpmHi": 140,
    "typicalBpm": 128,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "snare",
      "clap",
      "closed_hat",
      "tom_fill",
      "conga",
      "cowbell",
      "shaker",
      "synth_bass",
      "lead_guitar",
      "lead_vocal",
      "hype_vocal",
      "chant",
      "crowd_chant"
    ],
    "optionalRoles": [
      "club_kick",
      "rimshot",
      "snap",
      "open_hat",
      "ride",
      "crash",
      "tom",
      "snare_roll",
      "drum_roll",
      "bongo",
      "agogo",
      "shekere",
      "cabasa",
      "woodblock",
      "claves",
      "timbales",
      "guiro",
      "sub_bass",
      "bass_guitar",
      "synth_pad",
      "organ",
      "house_piano_stab",
      "clean_guitar_riff",
      "synth_lead",
      "synth_pluck",
      "brass_section",
      "trumpet",
      "sax",
      "bell_lead",
      "double",
      "harmony_vocal",
      "call_response",
      "adlib",
      "spoken_word",
      "choir",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "crowd_noise",
      "club_ambience",
      "street_ambience",
      "beat_stop",
      "drop_fx",
      "transition_fx",
      "siren"
    ],
    "signatureRoles": [
      "tom_fill",
      "lead_guitar",
      "hype_vocal",
      "chant",
      "cowbell"
    ],
    "forbiddenTraits": [
      "log_drum or amapiano soft-kick + patient build (that is amapiano)",
      "metronomic four-on-the-floor house/afro-house kick with no syncopation",
      "sliding 808 bass, trap hi-hat rolls, or drill hat slides",
      "reggaeton dembow pattern",
      "talking_drum-led Nigerian afrobeats groove",
      "slow, laid-back or half-time tempo",
      "live highlife-only interlocking clean-guitar band feel with no DJ/animateur hype",
      "gospel/soul balladry or lush pads carrying the track as the lead element",
      "sparse minimal hypnotic gqom darkness"
    ],
    "grooveRules": "Fast, relentless, celebratory dance pocket (118-140, typ. ~128) inherited from Congolese ndombolo/soukous — NOT house and NOT afrobeats. The kick is driving but syncopated: double-kick figures and offbeat placement (the literal 'décalé' shift), never a metronomic four-on-the-floor. Snare/rim and handclaps mark the backbeat and offbeats. A cowbell or agogo ostinato plus constant 16th-note shaker/cabasa keep forward motion, while congas and bongos fill the syncopation. The melodic engine is the bright single-note 'sebene' lead guitar looping fast, arpeggiated soukous licks. Sections are punctuated by cascading tom-roll fills and beat-stops that snap back into the groove. Riding on top is the animateur/hypeman: boucan shouts, dance-command chants, name-drops and crowd call-and-response — the vocal functions as much like percussion as melody. Bass is a punchy synth locked tight to the kick. Sixteenth-note percussion carries a light shuffle push; everything is loud, hot and non-stop.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "siren",
          "club_ambience",
          "crowd_noise",
          "cowbell",
          "shaker",
          "closed_hat",
          "spoken_word",
          "kick"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "shaker",
          "conga",
          "cowbell",
          "synth_bass",
          "lead_vocal",
          "clean_guitar_riff",
          "tom_fill"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "snare_roll",
          "drum_roll",
          "riser",
          "tom_fill",
          "cowbell",
          "crowd_chant",
          "hype_vocal",
          "synth_bass",
          "shaker"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "open_hat",
          "closed_hat",
          "cowbell",
          "conga",
          "bongo",
          "tom_fill",
          "synth_bass",
          "lead_guitar",
          "synth_lead",
          "chant",
          "crowd_chant",
          "hype_vocal",
          "adlib",
          "call_response",
          "lead_vocal",
          "impact",
          "siren",
          "crash"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "beat_stop",
          "tom_fill",
          "drum_roll",
          "lead_guitar",
          "cowbell",
          "conga",
          "timbales",
          "agogo",
          "hype_vocal",
          "crowd_chant",
          "call_response",
          "synth_bass",
          "drop_fx"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "shaker",
          "conga",
          "cowbell",
          "synth_bass",
          "lead_vocal",
          "adlib",
          "clean_guitar_riff",
          "synth_lead",
          "tom_fill"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "open_hat",
          "closed_hat",
          "cowbell",
          "conga",
          "bongo",
          "agogo",
          "tom_fill",
          "synth_bass",
          "lead_guitar",
          "synth_lead",
          "brass_section",
          "chant",
          "crowd_chant",
          "hype_vocal",
          "adlib",
          "call_response",
          "double",
          "lead_vocal",
          "crash",
          "impact",
          "siren"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "cowbell",
          "shaker",
          "closed_hat",
          "siren",
          "crowd_noise",
          "club_ambience",
          "spoken_word",
          "hype_vocal",
          "kick"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [
      "kick"
    ],
    "qualityChecks": [
      "cascading tom-roll fills present at section transitions",
      "bright single-note sebene/soukous lead-guitar line audible",
      "animateur hype vocals + dance-command chants + crowd call-and-response present",
      "cowbell or agogo ostinato driving the groove",
      "constant 16th-note shaker/cabasa motion",
      "syncopated double-kick groove, NOT metronomic four-on-the-floor",
      "punchy synth bass locked to the kick",
      "at least one beat-stop / sebene break that drops back into the groove",
      "DJ siren accents present",
      "high-energy tempo 118-140 bpm, no half-time drops"
    ],
    "engineTags": [
      "coupe-decale",
      "Ivorian dance music",
      "soukous ndombolo derived",
      "fast syncopated percussion groove",
      "cascading tom-roll fills",
      "sebene bright lead guitar",
      "animateur hype chants & crowd call-response",
      "driving cowbell congas & shaker",
      "punchy synth bass",
      "club party energy 128bpm"
    ]
  },
  "dancehall": {
    "genre": "dancehall",
    "displayName": "Dancehall",
    "origin": "Jamaica — Kingston sound-system culture, late 1970s/early 80s, evolved out of reggae; went fully digital with King Jammy's 1985 \"Sleng Teng\" riddim, birthing ragga/digital dancehall. Built on shared instrumental \"riddims\" that many deejays voice over.",
    "bpmLo": 85,
    "bpmHi": 110,
    "typicalBpm": 96,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "rimshot",
      "clap",
      "closed_hat",
      "open_hat",
      "sub_bass",
      "synth_bass",
      "organ",
      "reggae_skank",
      "lead_vocal",
      "adlib"
    ],
    "optionalRoles": [
      "kick_808",
      "bass_808",
      "snare",
      "snap",
      "ride",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "drum_roll",
      "cowbell",
      "shaker",
      "timbales",
      "woodblock",
      "conga",
      "bongo",
      "guiro",
      "piano",
      "clavinet",
      "rhodes",
      "wurlitzer",
      "synth_pad",
      "hammond",
      "guitar_chords",
      "synth_lead",
      "synth_pluck",
      "bell_lead",
      "vocal_chop",
      "brass_section",
      "trumpet",
      "trombone",
      "sax",
      "double",
      "harmony_vocal",
      "chant",
      "crowd_chant",
      "call_response",
      "hype_vocal",
      "spoken_word",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "crowd_noise",
      "club_ambience",
      "street_ambience",
      "transition_fx",
      "beat_stop",
      "drop_fx",
      "vinyl_noise"
    ],
    "signatureRoles": [
      "synth_bass",
      "reggae_skank",
      "rimshot",
      "adlib",
      "siren"
    ],
    "forbiddenTraits": [
      "dembow/reggaeton tresillo pattern (boom-ch-boom-chick) — that's reggaeton, not dancehall",
      "four-on-the-floor kick (house/EDM/reggaeton)",
      "roots-reggae one-drop-ONLY sleepy live-band feel with no digital riddim bass",
      "afrobeats shekere/log-drum 16th-driven groove",
      "amapiano log_drum bassline",
      "trap hi-hat rolls as the main rhythmic driver (trap, not classic dancehall)",
      "EDM build-and-drop synth structure",
      "tempos above ~115 BPM or a rushed pop feel",
      "wall-to-wall dense arrangement with no dub space",
      "clean pop-radio vocal with no patois deejay/singjay delivery or adlibs"
    ],
    "grooveRules": "Half-time feel at ~90-100 BPM, NOT four-on-the-floor and NOT the reggaeton dembow tresillo. The KICK anchors beats 1 and 3 (often with a syncopated push — a boom on 1, a pickup into the 3), while a rimshot/cross-stick plus handclap land the backbeat on 2 and 4. The engine of the whole track is a short, LOOPING melodic synth bassline (the \"riddim\") that repeats every 1-2 bars and is the song's identity — Sleng Teng lineage. Between the kicks, an offbeat \"bubble\" fills every \"&\": an organ double-chop or reggae skank stab on the upbeats. Hi-hats add tight offbeat 8th/16th accents. Keep it DUB-SPARSE — leave air so bass and voice breathe; drop elements out and pull them back in. On top, a deejay toasts/chats (or a singjay rides) in Jamaican patois, punctuated by adlibs and air-horn/gunshot stabs. The selector's \"pull-up\" rewind is a structural device, not a mistake.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "spoken_word",
          "siren",
          "synth_bass",
          "organ",
          "reggae_skank",
          "closed_hat",
          "crowd_noise",
          "club_ambience"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "rimshot",
          "clap",
          "closed_hat",
          "open_hat",
          "sub_bass",
          "synth_bass",
          "organ",
          "reggae_skank",
          "shaker",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "snare_roll",
          "riser",
          "clap",
          "synth_bass",
          "reggae_skank",
          "crowd_chant",
          "adlib",
          "siren"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "rimshot",
          "clap",
          "closed_hat",
          "open_hat",
          "crash",
          "sub_bass",
          "synth_bass",
          "organ",
          "reggae_skank",
          "cowbell",
          "brass_section",
          "synth_lead",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "crowd_chant"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "rimshot",
          "clap",
          "closed_hat",
          "sub_bass",
          "synth_bass",
          "reggae_skank",
          "organ",
          "timbales",
          "woodblock",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "beat_stop",
          "siren",
          "synth_bass",
          "reggae_skank",
          "organ",
          "crowd_chant",
          "call_response",
          "snare_roll",
          "adlib"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "kick",
          "rimshot",
          "clap",
          "closed_hat",
          "open_hat",
          "crash",
          "tom_fill",
          "sub_bass",
          "synth_bass",
          "organ",
          "reggae_skank",
          "cowbell",
          "brass_section",
          "synth_lead",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "hype_vocal",
          "crowd_chant",
          "siren"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "synth_bass",
          "organ",
          "reggae_skank",
          "siren",
          "spoken_word",
          "beat_stop",
          "crowd_noise",
          "adlib"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "kick"
    ],
    "qualityChecks": [
      "tempo sits ~90-100 BPM with a half-time feel, NOT four-on-the-floor",
      "a short looping melodic synth/sub bassline (the riddim) repeats and clearly drives the track",
      "offbeat organ/skank 'bubble' audible on every &",
      "rimshot/cross-stick + handclap backbeat present (not a big rock/trap backbeat)",
      "lead vocal delivers as a deejay toast/chat or singjay in Jamaican patois with adlibs",
      "air-horn/siren stab and a 'pull-up' beat-stop rewind occur, with dancehall crowd/session ambience",
      "arrangement leaves dub space — elements drop out and return, not wall-to-wall",
      "no dembow tresillo, no four-on-the-floor kick, no trap-hat-roll lead"
    ],
    "engineTags": [
      "dancehall",
      "jamaican riddim",
      "digital dancehall ragga",
      "deejay toasting patois",
      "syncopated half-time groove",
      "melodic synth bassline",
      "offbeat organ bubble skank",
      "rimshot handclap backbeat",
      "air-horn pull-up FX",
      "90-100 bpm sound system"
    ]
  },
  "drill": {
    "genre": "drill",
    "displayName": "Drill",
    "origin": "Chicago-born (early 2010s — Chief Keef, Young Chop, Lil Durk; dark trap-derived, menacing, sparse), redefined by UK/London drill (~2015 — 67, Headie One, AXL Beats, M1OnTheBeat, 808Melo: the sliding/gliding 808 and skippy syncopated drums), then broken globally by Brooklyn/New York drill (~2019 — Pop Smoke, Fivio Foreign, produced largely by the same UK beatmakers).",
    "bpmLo": 138,
    "bpmHi": 146,
    "typicalBpm": 140,
    "swing": "straight",
    "fourOnFloor": false,
    "requiredRoles": [
      "sliding_808",
      "kick",
      "snare",
      "clap",
      "rimshot",
      "closed_hat",
      "open_hat",
      "trap_hat_roll",
      "crash",
      "bell_lead",
      "lead_vocal",
      "adlib"
    ],
    "optionalRoles": [
      "bass_808",
      "sub_bass",
      "kick_808",
      "ride",
      "snap",
      "snare_roll",
      "drum_roll",
      "drill_hat_slide",
      "tom_fill",
      "piano",
      "synth_pluck",
      "glockenspiel",
      "strings_line",
      "string_pad",
      "violin_line",
      "flute",
      "pan_flute",
      "synth_lead",
      "organ",
      "choir",
      "choir_pad",
      "synth_pad",
      "warm_pad",
      "vocal_chop",
      "double",
      "harmony_vocal",
      "chant",
      "crowd_chant",
      "hype_vocal",
      "spoken_word",
      "vocal_pad",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "siren",
      "beat_stop",
      "transition_fx",
      "drop_fx",
      "vinyl_noise",
      "street_ambience"
    ],
    "signatureRoles": [
      "sliding_808",
      "trap_hat_roll",
      "rimshot",
      "bell_lead",
      "drill_hat_slide"
    ],
    "forbiddenTraits": [
      "four-on-the-floor kick (that is house / EDM / amapiano, never drill)",
      "static non-gliding 808 as the only bass — loses the drill slide and reduces to generic trap",
      "log drum or amapiano soft-kick groove",
      "swung / laid-back boom-bap MPC pocket",
      "bright major-key, happy or uplifting melodies",
      "live highlife/afrobeats guitars, shekere or talking-drum grooves",
      "reggaeton / dembow rhythm",
      "reggae off-beat skank",
      "lush, warm, busy arrangement (drill is cold, sparse, spacious)",
      "backbeat snare on 2 AND 4 — drill's crack sits on beat 3 (half-time)"
    ],
    "grooveRules": "Half-time feel at ~140 BPM: the snare/clap lands on beat 3 (NOT on 2 and 4), giving the slow-menace-with-busy-hats signature. The kick is syncopated and NEVER four-on-the-floor — it pairs with the sliding 808 in short bouncing clusters (e.g. kick on 1, then a kick+808 push on the 'a' of 2 into beat 3). The sliding_808 is both the melodic AND rhythmic anchor: it glides (portamento) between notes of a dark minor / harmonic-minor scale, tracing the vocal contour rather than sitting static — the glide IS the genre. Hi-hats run 8th/16th patterns with frequent triplet rolls (trap_hat_roll) and skippy, slightly off-grid stutters, plus occasional pitched hat slides (drill_hat_slide). Rimshots and ghost snares fill the gaps between backbeats. Arrangement stays sparse, dark and quantized — space and the 808 glide carry the groove; there is no boom-bap swing.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "bell_lead",
          "siren",
          "street_ambience",
          "vinyl_noise",
          "spoken_word",
          "riser",
          "closed_hat",
          "rimshot",
          "crash"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "sliding_808",
          "kick",
          "snare",
          "clap",
          "rimshot",
          "closed_hat",
          "open_hat",
          "trap_hat_roll",
          "drill_hat_slide",
          "bell_lead",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "sliding_808",
          "kick",
          "closed_hat",
          "trap_hat_roll",
          "snare_roll",
          "drum_roll",
          "riser",
          "sweep",
          "bell_lead",
          "lead_vocal",
          "double",
          "adlib",
          "crash"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "sliding_808",
          "kick",
          "snare",
          "clap",
          "rimshot",
          "closed_hat",
          "open_hat",
          "trap_hat_roll",
          "crash",
          "bell_lead",
          "strings_line",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "crowd_chant"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "beat_stop",
          "impact",
          "sliding_808",
          "kick",
          "snare",
          "clap",
          "rimshot",
          "closed_hat",
          "open_hat",
          "trap_hat_roll",
          "synth_pluck",
          "piano",
          "lead_vocal",
          "adlib",
          "drill_hat_slide"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "beat_stop",
          "choir_pad",
          "organ",
          "sliding_808",
          "bell_lead",
          "siren",
          "spoken_word",
          "reverse_cymbal",
          "downlifter",
          "street_ambience",
          "riser"
        ]
      },
      {
        "section": "final hook",
        "materials": [
          "sliding_808",
          "kick",
          "snare",
          "clap",
          "rimshot",
          "closed_hat",
          "open_hat",
          "trap_hat_roll",
          "crash",
          "impact",
          "bell_lead",
          "strings_line",
          "violin_line",
          "choir",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "crowd_chant",
          "hype_vocal"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "bell_lead",
          "sliding_808",
          "adlib",
          "spoken_word",
          "siren",
          "street_ambience",
          "vinyl_noise",
          "downlifter"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [
      "lead_vocal",
      "kick",
      "adlib"
    ],
    "qualityChecks": [
      "sliding_808 present — pitch-gliding portamento bass, not a static 808",
      "snare/clap on beat 3 (half-time backbeat), NOT on 2 and 4",
      "kick is syncopated — NO four-on-the-floor",
      "triplet hi-hat rolls (trap_hat_roll) clearly audible",
      "dark minor / harmonic-minor tonality — menacing, zero major-key brightness",
      "rimshot / ghost-snare bounce inside the pattern",
      "808 glide locks to the kick and traces a melodic minor contour",
      "sparse, cold, spacious arrangement (not lush or busy)",
      "tempo 138–146 with a half-time feel",
      "hard rap delivery with adlibs present",
      "grid tight/quantized — no laid-back boom-bap swing"
    ],
    "engineTags": [
      "drill",
      "sliding 808 bass",
      "dark menacing minor",
      "UK / Brooklyn drill",
      "140 BPM half-time",
      "triplet hi-hat rolls",
      "syncopated trap drums no four-on-floor",
      "cinematic dark bells and strings",
      "hard street rap",
      "sparse ominous beat"
    ]
  },
  "edm": {
    "genre": "edm",
    "displayName": "EDM (Festival / Big-Room Mainstage)",
    "origin": "Western electronic dance music in its festival/big-room form, crystallized in the late-2000s–2010s European and North American festival circuit (Sweden, Netherlands, US). Descends from house, trance and electro house; codified by Swedish House Mafia, Avicii, Hardwell, Martin Garrix, Zedd and Calvin Harris. Defined by the four-on-the-floor grid, the sidechain pump, and the build-up → drop architecture built for main-stage sound systems.",
    "bpmLo": 124,
    "bpmHi": 132,
    "typicalBpm": 128,
    "swing": "straight",
    "fourOnFloor": true,
    "requiredRoles": [
      "club_kick",
      "closed_hat",
      "open_hat",
      "clap",
      "crash",
      "snare_roll",
      "sub_bass",
      "synth_bass",
      "synth_pad",
      "synth_lead",
      "riser",
      "impact",
      "sweep"
    ],
    "optionalRoles": [
      "kick",
      "snare",
      "drum_roll",
      "reverse_cymbal",
      "reese_bass",
      "moog_bass",
      "pluck_bass",
      "piano",
      "house_piano_stab",
      "warm_pad",
      "string_pad",
      "choir_pad",
      "synth_pluck",
      "bell_lead",
      "vocal_chop",
      "lead_vocal",
      "vocal_pad",
      "crowd_chant",
      "adlib",
      "downlifter",
      "beat_stop",
      "drop_fx",
      "siren",
      "transition_fx",
      "crowd_noise",
      "club_ambience"
    ],
    "signatureRoles": [
      "club_kick",
      "synth_lead",
      "riser",
      "impact",
      "snare_roll"
    ],
    "forbiddenTraits": [
      "swung or shuffled groove (EDM is machine-tight, zero swing)",
      "any kick pattern that is NOT four-on-the-floor",
      "log_drum (that is amapiano)",
      "sliding_808 / trap_hat_roll / drill_hat_slide as the core groove (that is trap/drill/hip-hop)",
      "half-time trap or dubstep drop feel under a straight tempo",
      "talking_drum or shekere-led African percussion (that is afrobeats)",
      "reggae_skank or dembow/reggaeton bounce",
      "live-band/organic feel — brushes, upright_bass, loose human timing",
      "acoustic-guitar singer-songwriter framing",
      "bass_808 as the low-end foundation instead of a sidechained sub/synth bass"
    ],
    "grooveRules": "Grid-locked, fully quantized, zero swing. Club_kick lands on every quarter (four-on-the-floor), the anchor of the entire record. Clap/snare backbeat on 2 and 4. The signature offbeat open_hat sits on every \"and\" between kicks (the house \"ts\" that opens up as the kick closes it); closed_hat runs 16ths or offbeats underneath. The low end is defined by heavy SIDECHAIN: sub_bass and synth_bass are ducked hard to the kick so the whole mix visibly pumps/breathes on every beat — pads and leads are often pumped too for the washing effect. Energy is architected entirely around the BUILD → DROP. Breakdowns/verses strip to pad + vocal + pluck with no kick. The pre-hook is an 8–16 bar build: an accelerating snare_roll, a rising white-noise riser, an upward filter/pitch sweep, rising crowd_noise, kick pulled out in the final bars, then a beat_stop / silence gap. The drop hits on beat 1 with an impact + crash, the club_kick and sub slam back in, and a detuned supersaw synth_lead carries the hook. The drop is the loudest, most maximal moment; contrast between sparse breakdown and huge drop is the whole point.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "club_kick",
          "closed_hat",
          "sweep",
          "warm_pad",
          "club_ambience",
          "crowd_noise"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "synth_pad",
          "piano",
          "lead_vocal",
          "synth_pluck",
          "sub_bass"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "snare_roll",
          "riser",
          "sweep",
          "reverse_cymbal",
          "synth_pad",
          "lead_vocal",
          "crowd_noise",
          "beat_stop"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "impact",
          "crash",
          "club_kick",
          "sub_bass",
          "synth_bass",
          "synth_lead",
          "synth_pluck",
          "synth_pad",
          "clap",
          "open_hat",
          "closed_hat"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "synth_pad",
          "vocal_chop",
          "bell_lead",
          "piano",
          "warm_pad",
          "downlifter",
          "riser"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "warm_pad",
          "downlifter",
          "club_ambience"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "club_kick",
      "synth_lead",
      "sub_bass",
      "clap",
      "synth_pad",
      "open_hat",
      "closed_hat",
      "synth_pluck",
      "vocal_chop",
      "riser",
      "impact",
      "crowd_noise"
    ],
    "qualityChecks": [
      "four-on-the-floor club_kick on every quarter at ~128 BPM",
      "audible sidechain pump — bass and pads ducking on each kick",
      "offbeat open_hat sitting between the kicks",
      "build-up with an accelerating snare_roll and a rising white-noise riser into the drop",
      "beat_stop / silence gap immediately before the drop",
      "impact + crash landing on beat 1 of the drop",
      "detuned supersaw synth_lead carrying the drop hook",
      "straight, quantized, zero-swing grid throughout",
      "clear dynamic contrast: sparse breakdown/verse vs. maximal, loud drop"
    ],
    "engineTags": [
      "big room EDM",
      "festival mainstage",
      "four-on-the-floor 128bpm",
      "supersaw drop lead",
      "sidechain pump",
      "white-noise riser build-up",
      "snare-roll build",
      "impact crash drop",
      "progressive house"
    ]
  },
  "fuji": {
    "genre": "fuji",
    "displayName": "Fuji",
    "origin": "Nigeria — Yoruba Muslim popular music of the Southwest (Lagos/Ibadan). Evolved from ajisari/were, the pre-dawn Ramadan wake-up singing used to rouse fasters. Named and pioneered by Alhaji Sikiru Ayinde Barrister (and rival Ayinla Kollington), modernized by KWAM 1 (Wasiu Ayinde/K1 De Ultimate), Adewale Ayuba, Pasuma and Saheed Osupa. Fundamentally a percussion-and-voice tradition, distinct from guitar-led juju/highlife.",
    "bpmLo": 95,
    "bpmHi": 140,
    "typicalBpm": 120,
    "swing": "triplet",
    "fourOnFloor": false,
    "requiredRoles": [
      "talking_drum",
      "sakara",
      "shekere",
      "agogo",
      "lead_vocal",
      "call_response",
      "chant",
      "adlib"
    ,
      "bass_guitar"
    ],
    "optionalRoles": [
      "dundun",
      "bata",
      "conga",
      "bongo",
      "djembe",
      "udu",
      "cowbell",
      "woodblock",
      "claves",
      "kalimba",
      "mbira",
      "pluck_bass",
      "upright_bass",
      "bass_guitar",
      "organ",
      "harmony_vocal",
      "choir",
      "crowd_chant",
      "spoken_word",
      "hype_vocal",
      "humming",
      "tom",
      "tom_fill",
      "rimshot",
      "drum_roll",
      "crowd_noise",
      "street_ambience",
      "beat_stop",
      "transition_fx"
    ],
    "signatureRoles": [
      "talking_drum",
      "sakara",
      "shekere",
      "agogo",
      "call_response"
    ],
    "forbiddenTraits": [
      "log_drum (that is amapiano, not fuji)",
      "bass_808 / sliding_808 / sub_bass as the bassline (turns it into afrobeats/trap)",
      "four-on-the-floor house/kwaito/gqom kick",
      "reggaeton dembow pattern",
      "interlocking clean electric highlife_guitar as the lead engine (that is juju/highlife)",
      "Western backbeat snare on 2 & 4 driving the groove (pop/afrobeats)",
      "lush piano/rhodes chord-progression harmony (afrobeats/RnB/amapiano)",
      "EDM synth risers, pads and drops as core material",
      "straight-quantized 16ths with no triplet/compound swing",
      "auto-tuned melodic afropop hook singing replacing praise-singing and call-response",
      "trap hi-hat rolls as the hat engine"
    ],
    "grooveRules": "Percussion-and-voice music, NOT a chord-instrument genre — harmony is essentially static/drone and ALL movement comes from interlocking Yoruba drums plus vocal melody. Feel is compound 12/8 (triplet/shuffle), never straight. The agogo bell states a fixed repeating timeline that the whole ensemble locks to; the sakara frame-drum lays the steady rolling base pattern that gives the genre its name-adjacent identity; the shekere (sekere) washes the triplet/16th subdivisions with beaded-gourd rattle. The talking drum (gangan / iya ilu / dundun) is a LEAD voice, not a fill instrument — it bends pitch to literally 'talk,' trading phrases with and answering the singer. Form is driven by call-and-response: the lead Fuji master delivers Islamic/Yoruba praise-singing (oriki) with heavy Arabic-derived melisma, and the chorus answers on the response line. Density, rhythmic conversation and tempo lifts carry the song across a medley — not chord changes. The bass function (traditionally the agidigbo lamellophone bass-box; modern bands a plucked or upright bass) plays a repetitive rhythmic ostinato locked to the sakara, providing pulse rather than harmonic motion. Live-party energy, crowd shout-outs and spraying-money ambience are part of the sound.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "talking_drum",
          "agogo",
          "lead_vocal",
          "crowd_noise"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "sakara",
          "shekere",
          "agogo",
          "talking_drum",
          "lead_vocal",
          "call_response"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "sakara",
          "shekere",
          "agogo",
          "talking_drum",
          "conga",
          "chant",
          "adlib",
          "lead_vocal"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "sakara",
          "shekere",
          "agogo",
          "talking_drum",
          "bata",
          "call_response",
          "chant",
          "adlib",
          "hype_vocal",
          "lead_vocal"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "talking_drum",
          "agogo",
          "shekere",
          "drum_roll",
          "spoken_word",
          "crowd_chant"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "sakara",
          "shekere",
          "agogo",
          "talking_drum",
          "pluck_bass",
          "lead_vocal",
          "call_response",
          "adlib"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "sakara",
          "shekere",
          "agogo",
          "talking_drum",
          "bata",
          "conga",
          "call_response",
          "chant",
          "choir",
          "adlib",
          "hype_vocal",
          "crowd_chant",
          "lead_vocal"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "talking_drum",
          "agogo",
          "sakara",
          "lead_vocal",
          "crowd_noise"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [
      "lead_vocal",
      "talking_drum",
      "call_response",
      "sakara",
      "shekere",
      "agogo",
      "conga",
      "pluck_bass",
      "crowd_noise"
    ],
    "qualityChecks": [
      "talking_drum present and pitch-bending/gliding to answer the vocal (not just a fill)",
      "sakara frame-drum steady rolling base pattern audible throughout",
      "shekere gourd shaker filling triplet/16th subdivisions",
      "agogo bell timeline locked and clearly audible",
      "compound 12/8 triplet swing, NOT straight-quantized",
      "call-and-response between lead vocal and chorus",
      "Yoruba/Islamic melismatic praise-singing lead",
      "static/drone harmony — no chord-progression movement",
      "NO 808 sub-bass, NO four-on-floor kick, NO log_drum",
      "live party/crowd ambience present"
    ],
    "engineTags": [
      "fuji",
      "yoruba percussion",
      "talking drum",
      "sakara frame drum",
      "shekere",
      "call and response vocals",
      "islamic praise singing",
      "12/8 polyrhythm",
      "nigerian traditional",
      "percussion-led"
    ]
  },
  "funk": {
    "genre": "funk",
    "displayName": "Funk",
    "origin": "African-American, USA — mid-1960s to late-1970s. Codified by James Brown (\"the One\"), Sly & the Family Stone (Larry Graham slap), The Meters (New Orleans pocket), Parliament-Funkadelic / Bootsy Collins (Moog + P-Funk), Tower of Power (horns + Garibaldi drums), Kool & the Gang, Ohio Players, Stevie Wonder (clavinet).",
    "bpmLo": 88,
    "bpmHi": 120,
    "typicalBpm": 104,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "live_kick",
      "snare",
      "closed_hat",
      "open_hat",
      "bass_guitar",
      "slap_bass",
      "guitar_chords",
      "clavinet",
      "brass_section",
      "conga",
      "lead_vocal"
    ],
    "optionalRoles": [
      "kick",
      "rimshot",
      "clap",
      "ride",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "drum_roll",
      "bongo",
      "cowbell",
      "cabasa",
      "shaker",
      "agogo",
      "timbales",
      "guiro",
      "triangle",
      "vibraphone",
      "marimba",
      "moog_bass",
      "synth_bass",
      "fretless_bass",
      "rhodes",
      "wurlitzer",
      "hammond",
      "organ",
      "piano",
      "synth_pad",
      "sax",
      "trumpet",
      "trombone",
      "clean_guitar_riff",
      "lead_guitar",
      "synth_lead",
      "strings_line",
      "violin_line",
      "harmony_vocal",
      "double",
      "adlib",
      "chant",
      "call_response",
      "hype_vocal",
      "crowd_chant",
      "spoken_word",
      "beat_stop",
      "vinyl_noise",
      "tape_hiss",
      "crowd_noise",
      "reverse_cymbal",
      "transition_fx",
      "impact",
      "riser"
    ],
    "signatureRoles": [
      "slap_bass",
      "clavinet",
      "guitar_chords",
      "brass_section",
      "call_response"
    ],
    "forbiddenTraits": [
      "four-on-the-floor kick — that is disco/house; funk kicks are SYNCOPATED and resolve to THE ONE",
      "808 kick, kick_808, sub_bass or sliding_808 — trap/hip-hop timbres that destroy the live-band feel",
      "log_drum (amapiano) or soft_kick amapiano groove",
      "trap_hat_roll / drill_hat_slide hi-hat gimmicks",
      "reese_bass or heavy EDM/wobble synth bass",
      "dembow / reggaeton pattern",
      "quantized gridlocked drums with no snare ghost-notes and no human lay-back — funk MUST breathe in the pocket",
      "sustained pad-style horns instead of short, punchy, syncopated stabs",
      "gqom broken 4/4 or generic straight rock backbeat with no 16th-note syncopation",
      "over-clean modern pop mix with no interlocking live-band friction"
    ],
    "grooveRules": "Everything serves THE ONE: the downbeat of bar 1 is the hardest accent in the phrase and the whole groove tenses toward it and releases on it. Drums lay a syncopated kick against a firm backbeat snare on 2 and 4, with quiet snare ghost-notes filling the 16ths between hits and a busy 16th-note hi-hat driving the pocket; the kit is tight and dry and sits slightly BEHIND the beat, never rushing. Bass is a lead voice, not a follower — slapped/popped or fingered 16th riffs that lock airtight to the kick and define the harmonic rhythm; the bass and kick move as one interlocked unit. Rhythm guitar plays muted 16th \"chicken-scratch\" chanks and wah stabs pushed onto the off-beats; clavinet comps percussively in the gaps the guitar leaves. The horn section punches SHORT syncopated stabs and answers the vocal, then gets out of the way. Every part is a one- or two-bar riff repeated hypnotically; the funk lives in the friction between the syncopated parts and in the SILENCE between the notes. 16ths carry a subtle human swing, not a triplet shuffle. Use stop-time breaks: cut the whole band dead on a hit, leave a bar of space, then slam back in on the One.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "live_kick",
          "closed_hat",
          "snare",
          "slap_bass",
          "guitar_chords",
          "hype_vocal",
          "cowbell",
          "vinyl_noise",
          "tape_hiss"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "live_kick",
          "snare",
          "closed_hat",
          "open_hat",
          "rimshot",
          "conga",
          "cowbell",
          "bass_guitar",
          "guitar_chords",
          "clavinet",
          "rhodes",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "live_kick",
          "snare",
          "closed_hat",
          "open_hat",
          "tom_fill",
          "slap_bass",
          "guitar_chords",
          "clavinet",
          "brass_section",
          "harmony_vocal",
          "riser",
          "reverse_cymbal",
          "crash"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "live_kick",
          "snare",
          "closed_hat",
          "open_hat",
          "crash",
          "clap",
          "conga",
          "cowbell",
          "cabasa",
          "slap_bass",
          "guitar_chords",
          "clavinet",
          "hammond",
          "brass_section",
          "lead_vocal",
          "call_response",
          "chant",
          "harmony_vocal"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "live_kick",
          "snare",
          "closed_hat",
          "open_hat",
          "conga",
          "bongo",
          "cowbell",
          "slap_bass",
          "moog_bass",
          "guitar_chords",
          "clavinet",
          "wurlitzer",
          "clean_guitar_riff",
          "lead_vocal",
          "double",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "beat_stop",
          "live_kick",
          "snare",
          "closed_hat",
          "slap_bass",
          "sax",
          "lead_guitar",
          "synth_lead",
          "hammond",
          "conga",
          "spoken_word",
          "adlib",
          "crowd_noise"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "live_kick",
          "snare",
          "closed_hat",
          "open_hat",
          "crash",
          "clap",
          "conga",
          "cowbell",
          "cabasa",
          "tom_fill",
          "slap_bass",
          "moog_bass",
          "guitar_chords",
          "clavinet",
          "hammond",
          "brass_section",
          "synth_lead",
          "lead_vocal",
          "call_response",
          "chant",
          "harmony_vocal",
          "adlib"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "live_kick",
          "snare",
          "closed_hat",
          "conga",
          "cowbell",
          "slap_bass",
          "guitar_chords",
          "clavinet",
          "brass_section",
          "chant",
          "adlib",
          "crowd_noise",
          "vinyl_noise"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [
      "lead_vocal"
    ],
    "qualityChecks": [
      "THE ONE is audible — a hard accented downbeat at the top of every phrase that the groove resolves to",
      "kick pattern is SYNCOPATED, not four-on-the-floor",
      "backbeat snare lands on 2 and 4 with audible ghost-notes filling between",
      "busy 16th-note hi-hat pocket with subtle human swing, not gridlocked",
      "prominent slap/popped or syncopated bass riff locked tightly to the kick",
      "muted 16th chicken-scratch rhythm guitar and/or percussive clavinet present",
      "horn hits are SHORT, punchy and syncopated — not sustained pads",
      "call-and-response and gang-chant vocals with James-Brown-style grunts/adlibs",
      "at least one stop-time / beat_stop breakdown that slams back in on the One",
      "dry, tight, analog live-band sound — zero 808s, no log drum, no trap hats"
    ],
    "engineTags": [
      "funk",
      "classic 70s funk",
      "slap bass groove",
      "syncopated pocket drums with ghost notes",
      "on the one downbeat accent",
      "clavinet and wah chicken-scratch guitar",
      "punchy horn section stabs",
      "call and response gang vocals",
      "conga and cowbell percussion",
      "live analog band not four-on-the-floor"
    ]
  },
  "gospel": {
    "genre": "gospel",
    "displayName": "Gospel",
    "origin": "African-American church tradition of the U.S. South and urban North: born from spirituals, ring shouts, blues and jazz, codified by Thomas A. Dorsey (\"father of gospel\"), carried by the Black Church, mass choirs (Hawkins, Cleveland, Hezekiah Walker), quartets, and later contemporary/urban gospel (Kirk Franklin, Fred Hammond, Richard Smallwood) and praise & worship (Tasha Cobbs, Travis Greene). The Hammond B3, the mass choir, and the melismatic soloist are its DNA.",
    "bpmLo": 68,
    "bpmHi": 140,
    "typicalBpm": 84,
    "swing": "moderate",
    "fourOnFloor": false,
    "requiredRoles": [
      "live_kick",
      "snare",
      "closed_hat",
      "ride",
      "crash",
      "clap",
      "bass_guitar",
      "piano",
      "gospel_organ",
      "lead_vocal",
      "gospel_choir"
    ],
    "optionalRoles": [
      "soft_kick",
      "rimshot",
      "open_hat",
      "tom",
      "tom_fill",
      "snare_roll",
      "drum_roll",
      "brushes",
      "shaker",
      "conga",
      "upright_piano",
      "rhodes",
      "wurlitzer",
      "clavinet",
      "organ",
      "hammond",
      "warm_pad",
      "choir_pad",
      "string_pad",
      "synth_pad",
      "guitar_chords",
      "clean_guitar_riff",
      "lead_guitar",
      "strings_line",
      "violin_line",
      "brass_section",
      "sax",
      "trumpet",
      "trombone",
      "timpani",
      "double",
      "harmony_vocal",
      "adlib",
      "choir",
      "call_response",
      "humming",
      "vocal_pad",
      "chant",
      "crowd_chant",
      "riser",
      "impact",
      "reverse_cymbal",
      "transition_fx",
      "beat_stop",
      "crowd_noise"
    ],
    "signatureRoles": [
      "gospel_organ",
      "gospel_choir",
      "piano",
      "lead_vocal",
      "call_response"
    ],
    "forbiddenTraits": [
      "four_on_the_floor kick (house/EDM — gospel is backbeat, not on-every-beat kick)",
      "808 sub/sliding_808 trap bass driving the track (that is trap/gospel-trap crossover, not core gospel)",
      "log_drum (amapiano)",
      "reggaeton/dembow groove",
      "talking_drum or shekere-led afrobeats pocket",
      "reggae_skank offbeat",
      "rigidly quantized robotic drums with no fills or human push-pull",
      "no swing / metronomic straight grid throughout",
      "distorted metal or heavy rock lead guitar",
      "EDM synth_lead drops and risers as the main hook",
      "lo-fi vinyl hip-hop aesthetic",
      "monotone single-voice hook with no choir or harmony stack"
    ],
    "grooveRules": "The pocket is backbeat-driven, NOT four-on-the-floor: snare + hand claps (+ a jingling tambourine) land hard on beats 2 and 4 while the live kick plays a syncopated, breathing pattern that locks with an active bass guitar. Time is carried on a ride cymbal or shuffled hats with a moderate swing; ballads sit in a 12/8 triplet feel (gospel 6/8) where every beat divides into three. The Hammond B3 (gospel_organ) is the spine — sustained SATB-voiced chords, swells, and glissando smears with the Leslie speaker slowing for tender passages and spinning up to fast for intensity. The acoustic piano interlocks with the organ, busy and bluesy, full of passing chords, tritone subs, chromatic walk-ups and right-hand runs. Everything serves dynamics: strip the intro to keys, build the verse, lift the pre-hook, explode the hook with full choir. Call-and-response is constant — the soloist throws a line, the choir answers. The bridge often drops to a held \"hold\" (beat_stop) then re-enters bigger; the last chorus modulates up a half or whole step (the gospel \"lift\") and the drummer fills over the turnaround. Uptempo praise can break into \"shout music\" — a fast double-time swung shuffle with a walking bass, driving ride, and organ chops. Fills and crashes mark every section change; the feel is human, pushed, and celebratory, never grid-locked.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "gospel_organ",
          "piano",
          "warm_pad",
          "humming",
          "vocal_pad",
          "crowd_noise"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "piano",
          "gospel_organ",
          "bass_guitar",
          "live_kick",
          "closed_hat",
          "ride",
          "clap",
          "lead_vocal"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "piano",
          "gospel_organ",
          "bass_guitar",
          "live_kick",
          "snare",
          "ride",
          "clap",
          "shaker",
          "snare_roll",
          "harmony_vocal",
          "lead_vocal",
          "riser",
          "transition_fx"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "live_kick",
          "snare",
          "ride",
          "open_hat",
          "clap",
          "crash",
          "bass_guitar",
          "piano",
          "gospel_organ",
          "gospel_choir",
          "call_response",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "piano",
          "gospel_organ",
          "rhodes",
          "clavinet",
          "bass_guitar",
          "live_kick",
          "closed_hat",
          "ride",
          "clap",
          "lead_vocal",
          "call_response",
          "harmony_vocal"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "gospel_organ",
          "piano",
          "gospel_choir",
          "bass_guitar",
          "live_kick",
          "snare",
          "drum_roll",
          "tom_fill",
          "crash",
          "brass_section",
          "strings_line",
          "timpani",
          "lead_vocal",
          "adlib",
          "beat_stop",
          "impact",
          "crowd_chant"
        ]
      },
      {
        "section": "final hook",
        "materials": [
          "live_kick",
          "snare",
          "ride",
          "open_hat",
          "clap",
          "crash",
          "tom_fill",
          "bass_guitar",
          "piano",
          "gospel_organ",
          "gospel_choir",
          "brass_section",
          "strings_line",
          "lead_vocal",
          "adlib",
          "call_response",
          "crowd_noise"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "gospel_organ",
          "piano",
          "gospel_choir",
          "bass_guitar",
          "ride",
          "clap",
          "lead_vocal",
          "adlib",
          "vocal_pad",
          "crowd_noise"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "gospel_choir",
      "piano",
      "gospel_organ",
      "bass_guitar",
      "live_kick"
    ],
    "qualityChecks": [
      "Hammond B3 organ present with audible Leslie rotary whirl/swell (gospel_organ), not a flat pad",
      "Mass gospel choir SATB harmony stacks on the hook, not a single doubled voice",
      "Backbeat on beats 2 and 4 from snare + hand claps (+ tambourine jingle)",
      "NOT four-on-the-floor and NOT 808-led — kick is syncopated, bass is a live/electric bass guitar",
      "Busy gospel piano with passing chords, chromatic runs and right-hand fills interlocking with the organ",
      "Call-and-response between lead vocal and choir",
      "Melismatic lead vocal runs and ad-libs",
      "Live, human drum feel with fills/crashes into every section change",
      "Moderate swing (or 12/8 triplet feel on ballads) — not a rigid straight grid",
      "A key modulation 'lift' at the final chorus"
    ],
    "engineTags": [
      "gospel",
      "gospel choir",
      "hammond b3 organ leslie",
      "gospel piano runs",
      "live drums backbeat handclaps tambourine",
      "soulful melismatic lead vocal",
      "call and response",
      "walking bass guitar",
      "praise worship church",
      "key change modulation"
    ]
  },
  "gqom": {
    "genre": "gqom",
    "displayName": "Gqom",
    "origin": "South Africa — Durban (eThekwini), KwaZulu-Natal; underground Zulu electronic sound that emerged in the early 2010s (Rudeboyz, DJ Lag, Citizen Boy, Griffit Vigo, Distruction Boyz, Babes Wodumo).",
    "bpmLo": 120,
    "bpmHi": 130,
    "typicalBpm": 124,
    "swing": "straight",
    "fourOnFloor": false,
    "requiredRoles": [
      "club_kick",
      "kick_808",
      "tom",
      "tom_fill",
      "clap",
      "shaker",
      "closed_hat",
      "sub_bass",
      "chant",
      "siren"
    ],
    "optionalRoles": [
      "kick",
      "snare",
      "rimshot",
      "open_hat",
      "crash",
      "snare_roll",
      "drum_roll",
      "conga",
      "shekere",
      "cowbell",
      "agogo",
      "surdo",
      "woodblock",
      "synth_bass",
      "reese_bass",
      "bass_808",
      "synth_pad",
      "string_pad",
      "organ",
      "house_piano_stab",
      "synth_lead",
      "synth_pluck",
      "vocal_chop",
      "bell_lead",
      "crowd_chant",
      "call_response",
      "adlib",
      "hype_vocal",
      "spoken_word",
      "lead_vocal",
      "riser",
      "downlifter",
      "impact",
      "sweep",
      "reverse_cymbal",
      "beat_stop",
      "drop_fx",
      "club_ambience",
      "crowd_noise",
      "transition_fx"
    ],
    "signatureRoles": [
      "club_kick",
      "tom_fill",
      "siren",
      "chant",
      "sub_bass"
    ],
    "forbiddenTraits": [
      "log_drum bassline or amapiano-style plucky bass melody (wrong genre — that is amapiano)",
      "four-on-the-floor kick landing on every quarter beat (house/kwaito/EDM — gqom's kick is broken)",
      "swung/shuffled triplet amapiano groove; gqom's grid is straight with broken kick placement",
      "jazzy piano/rhodes chord progressions or warm patient build",
      "bright, happy, major-key pop production; gqom is dark, raw and minimal",
      "West African afrobeats/highlife feel — talking_drum, highlife_guitar, shekere-led 16th afrobeat syncopation",
      "reggaeton dembow pattern",
      "dense lush harmony or frequent chord changes (gqom is near-static, hypnotic, one-drone dark)",
      "clean polished live-band organic instrumentation"
    ],
    "grooveRules": "4/4 time but explicitly BROKEN — never four-on-the-floor. The club_kick/kick_808 is booming and slightly distorted, placed in a lurching, syncopated tribal pattern (a common shape: a hit on beat 1, then a cluster shoving the '&' of 2 and beat 3, with deliberate holes) so the groove rolls and stumbles instead of pulsing evenly. Rolling toms (tom/tom_fill) are the melodic-rhythmic engine, tumbling in tribal 8th/16th figures that answer the kick and fill the space. Shaker and closed_hat drive steady 16ths for propulsion; claps/rimshots snap the off-beats. Sub_bass sits fused directly under the kick as one weighted low-end body — the kick often IS the bass. Harmony is minimal and dark: a single sustained pad/drone or a sparse stab, not chord changes. The record is hypnotic, spacious and repetitive — 2-4 bar loops recycled, tension built by stripping the kick then slamming it back (beat_stop → re-entry), with a siren/whistle and a Zulu chant as the recognizable hooks. Grid is straight; the swing comes from placement, not shuffle.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "club_kick",
          "shaker",
          "siren",
          "club_ambience",
          "chant"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "club_kick",
          "kick_808",
          "tom",
          "shaker",
          "closed_hat",
          "clap",
          "sub_bass",
          "chant"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "club_kick",
          "drum_roll",
          "snare_roll",
          "riser",
          "sweep",
          "crowd_chant"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "club_kick",
          "kick_808",
          "tom",
          "tom_fill",
          "sub_bass",
          "shaker",
          "closed_hat",
          "clap",
          "siren",
          "chant",
          "synth_lead"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "club_kick",
          "kick_808",
          "tom",
          "shaker",
          "clap",
          "sub_bass",
          "call_response",
          "synth_pluck"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "beat_stop",
          "chant",
          "synth_pad",
          "tom_fill",
          "impact",
          "crowd_noise"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "club_kick",
          "kick_808",
          "tom",
          "tom_fill",
          "sub_bass",
          "shaker",
          "open_hat",
          "clap",
          "crash",
          "siren",
          "chant",
          "crowd_chant",
          "synth_lead"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "club_kick",
          "shaker",
          "siren",
          "club_ambience"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "sub_bass"
    ],
    "qualityChecks": [
      "Kick pattern is BROKEN — no kick on every downbeat; an audible syncopated lurch, not a steady 4-on-floor pulse",
      "Booming, slightly distorted kick dominates the low end",
      "Rolling tribal toms / tom_fills present and prominent as a rhythmic hook",
      "Deep sub_bass fused directly under the kick",
      "Gqom siren/whistle audible as a recurring hook",
      "Zulu-style vocal chant or call-and-response present",
      "Shaker / closed_hat driving steady 16ths",
      "At least one beat_stop breakdown then kick re-entry (drop)",
      "Minimal, dark, hypnotic, repetitive loop — few or no chord changes",
      "Tempo sits 120-130 BPM",
      "NO amapiano log_drum groove and NO four-on-the-floor kick"
    ],
    "engineTags": [
      "gqom",
      "broken 4/4 not four-on-the-floor",
      "booming distorted kick",
      "rolling tribal toms",
      "dark hypnotic minimal",
      "gqom siren whistle",
      "sub bass low end",
      "zulu vocal chant",
      "durban south africa",
      "124 bpm"
    ]
  },
  "highlife": {
    "genre": "highlife",
    "displayName": "Highlife",
    "origin": "Ghana — coastal Fante/Ga brass bands and palmwine guitar (early 20th c.); matured as guitar-band and dance-band highlife, and flourished in Eastern Nigeria as Igbo highlife (Osadebe, Oliver De Coque, Celestine Ukwu; Ghana's E.T. Mensah, Nana Ampadu).",
    "bpmLo": 96,
    "bpmHi": 132,
    "typicalBpm": 116,
    "swing": "moderate",
    "fourOnFloor": false,
    "requiredRoles": [
      "highlife_guitar",
      "clean_guitar_riff",
      "bass_guitar",
      "live_kick",
      "snare",
      "closed_hat",
      "conga",
      "bongo",
      "agogo",
      "shaker",
      "lead_vocal",
      "call_response"
    ],
    "optionalRoles": [
      "palmwine_guitar",
      "lead_guitar",
      "rimshot",
      "ride",
      "open_hat",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "maraca",
      "claves",
      "woodblock",
      "cowbell",
      "guiro",
      "organ",
      "hammond",
      "rhodes",
      "piano",
      "warm_pad",
      "string_pad",
      "trumpet",
      "trombone",
      "sax",
      "brass_section",
      "flute",
      "harmony_vocal",
      "double",
      "adlib",
      "choir",
      "crowd_chant",
      "chant",
      "humming",
      "upright_bass",
      "crowd_noise",
      "street_ambience",
      "tape_hiss",
      "vinyl_noise",
      "transition_fx"
    ],
    "signatureRoles": [
      "highlife_guitar",
      "clean_guitar_riff",
      "agogo",
      "conga",
      "brass_section"
    ],
    "forbiddenTraits": [
      "log_drum (amapiano signature)",
      "808/sub-bass or sliding_808 carrying the low end (afrobeats/trap/drill)",
      "four-on-the-floor club kick (house/kwaito/gqom/amapiano)",
      "trap_hat_roll or drill_hat_slide",
      "reese_bass or a repeating EDM synth_bass ostinato",
      "reggaeton/dembow groove",
      "reggae_skank as the core rhythm engine",
      "talking_drum-led juju/fuji feel dominating the track",
      "static one-note bass ostinato (highlife bass must be melodic/walking)",
      "house_piano_stab or four-on-floor gospel/house-organ feel",
      "dark minimal broken 4/4 (gqom)",
      "EDM riser-build-drop structure with drop_fx",
      "heavy auto-tuned trap adlibs"
    ],
    "grooveRules": "Time is kept by the agogo/gong-gong (ogene) bell playing the standard West African bell timeline, NOT by a four-on-the-floor kick. Two or more bright, clean-toned electric guitars INTERLOCK: one plays a repeating arpeggiated riff (frequently in parallel 3rds/6ths), the other comps and answers in the gaps, producing a continuous rolling filigree that never stops. The live drum kit sits relaxed and swung — ride or closed hats keep steady 8ths, the backbeat lands as a rimshot/cross-stick or a light snare with ghost notes, and the kick is syncopated and sparse (never a thumping 4/4). Congas and bongos fill the syncopated pockets around the bell. The bass guitar is MELODIC and mobile: walking, root–5th-with-passing-tone lines that follow the harmony and often shadow the guitar figure — never a static one-note ostinato. Brass (trumpet/trombone/sax) punctuates phrase-ends and answers the vocal in call-and-response, while the chorus answers the lead singer. Harmony is warm, diatonic and major-key, looping cyclic I–IV–V / II–V turnarounds. The pocket is danceable, sitting slightly on top but unhurried, in a swaying two-step lilt.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "highlife_guitar",
          "clean_guitar_riff",
          "agogo",
          "shaker",
          "conga",
          "bass_guitar",
          "closed_hat"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "live_kick",
          "snare",
          "rimshot",
          "closed_hat",
          "ride",
          "highlife_guitar",
          "clean_guitar_riff",
          "bass_guitar",
          "conga",
          "bongo",
          "agogo",
          "shaker",
          "organ",
          "lead_vocal"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "live_kick",
          "snare",
          "snare_roll",
          "tom_fill",
          "crash",
          "highlife_guitar",
          "clean_guitar_riff",
          "bass_guitar",
          "conga",
          "bongo",
          "agogo",
          "brass_section",
          "trumpet",
          "harmony_vocal",
          "transition_fx"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "live_kick",
          "snare",
          "ride",
          "open_hat",
          "highlife_guitar",
          "clean_guitar_riff",
          "lead_guitar",
          "bass_guitar",
          "conga",
          "bongo",
          "agogo",
          "cowbell",
          "shaker",
          "brass_section",
          "trumpet",
          "trombone",
          "sax",
          "lead_vocal",
          "call_response",
          "choir",
          "double",
          "adlib"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "live_kick",
          "snare",
          "rimshot",
          "closed_hat",
          "highlife_guitar",
          "clean_guitar_riff",
          "lead_guitar",
          "bass_guitar",
          "conga",
          "bongo",
          "agogo",
          "shaker",
          "rhodes",
          "organ",
          "lead_vocal",
          "harmony_vocal"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "live_kick",
          "rimshot",
          "conga",
          "bongo",
          "agogo",
          "woodblock",
          "clean_guitar_riff",
          "lead_guitar",
          "bass_guitar",
          "organ",
          "sax",
          "brass_section",
          "tom_fill",
          "crowd_chant"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "live_kick",
          "snare",
          "ride",
          "open_hat",
          "crash",
          "tom_fill",
          "highlife_guitar",
          "clean_guitar_riff",
          "lead_guitar",
          "bass_guitar",
          "conga",
          "bongo",
          "agogo",
          "cowbell",
          "shaker",
          "brass_section",
          "trumpet",
          "trombone",
          "sax",
          "lead_vocal",
          "call_response",
          "choir",
          "crowd_chant",
          "double",
          "adlib"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "highlife_guitar",
          "clean_guitar_riff",
          "agogo",
          "conga",
          "bongo",
          "shaker",
          "bass_guitar",
          "brass_section",
          "organ",
          "adlib",
          "crowd_noise"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "brass_section"
    ],
    "qualityChecks": [
      "Two or more clean, bright electric guitars audibly INTERLOCK (not one strummed chord track)",
      "Agogo/gong-gong bell timeline repeats throughout and defines the pulse",
      "Bass guitar plays melodic/walking lines, NOT a static 808 or synth ostinato",
      "Congas + bongos provide syncopated hand-percussion audible in the gaps",
      "Brass section (trumpet/trombone/sax) punctuates phrase-ends and answers vocals",
      "Groove is relaxed and swung, NOT four-on-the-floor",
      "No 808 sub-bass, no log_drum, no trap/drill hi-hat rolls",
      "Call-and-response between lead vocal and chorus/brass",
      "Organic live-band drum kit with ride/hats + rimshot or snare backbeat",
      "Warm, major-key diatonic harmony cycling on I–IV–V turnarounds"
    ],
    "engineTags": [
      "highlife",
      "interlocking clean electric guitars",
      "West African live band",
      "agogo bell timeline",
      "congas and bongos",
      "brass section stabs",
      "melodic walking bass guitar",
      "palmwine guitar feel",
      "call-and-response vocals",
      "relaxed swung 4/4"
    ]
  },
  "hip_hop": {
    "genre": "hip_hop",
    "displayName": "Hip Hop (Boom Bap Core)",
    "origin": "USA — the Bronx, New York City (1970s block parties, breakbeats); the sampled \"boom bap\" template codified on the NYC/East Coast in the late 1980s–1990s (DJ-and-MC, MPC/SP-1200 chopped soul & jazz loops).",
    "bpmLo": 80,
    "bpmHi": 100,
    "typicalBpm": 90,
    "swing": "moderate",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "snare",
      "closed_hat",
      "sub_bass",
      "rhodes",
      "lead_vocal",
      "adlib",
      "vinyl_noise"
    ],
    "optionalRoles": [
      "kick_808",
      "bass_808",
      "clap",
      "snap",
      "rimshot",
      "open_hat",
      "ride",
      "snare_roll",
      "drum_roll",
      "piano",
      "upright_piano",
      "wurlitzer",
      "organ",
      "hammond",
      "vibraphone",
      "marimba",
      "glockenspiel",
      "string_pad",
      "warm_pad",
      "synth_pad",
      "sax",
      "trumpet",
      "brass_section",
      "flute",
      "upright_bass",
      "bass_guitar",
      "synth_bass",
      "clean_guitar_riff",
      "conga",
      "bongo",
      "shaker",
      "double",
      "harmony_vocal",
      "hype_vocal",
      "chant",
      "spoken_word",
      "choir",
      "vocal_chop",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "tape_hiss",
      "crowd_noise",
      "beat_stop",
      "transition_fx"
    ],
    "signatureRoles": [
      "closed_hat",
      "snare",
      "rhodes",
      "vinyl_noise",
      "lead_vocal"
    ],
    "forbiddenTraits": [
      "four-on-the-floor kick (turns it house/disco/EDM)",
      "log_drum bassline (that is amapiano)",
      "shekere/talking_drum 16th-note afrobeats groove",
      "reggaeton/dembow tresillo pattern",
      "constant triplet or 32nd trap hi-hat rolls as the DEFINING groove (that is trap)",
      "drill sliding_808 glides + drill hat slides (that is drill)",
      "EDM supersaw build-and-drop structure",
      "highlife interlocking clean guitars / live-band world feel",
      "fully straight un-swung quantized drums with no behind-the-beat pocket",
      "fast DnB/footwork/jungle tempos (150+ BPM)"
    ],
    "grooveRules": "Head-nod backbeat, NOT four-on-the-floor. The kick anchors beat 1 and drops one or two syncopated 'ghost' kicks around the 2-and and beat 3, leaving deliberate space. The snare (or rimshot/clap) cracks hard and dry on beats 2 and 4 as the backbeat. Closed hats run 8ths/16ths with pronounced MPC swing (~54–62%), landing a few ticks late so the kit sits behind the beat — the laid-back pocket. Open hat accents the off-beat 'and'. Harmony is a chopped, looped 2–4 bar soul/jazz sample (Rhodes/piano/strings/horns) that the drums are cut to; chords loop rather than progress. Sub/808 bass follows the kick and sample root, mono and simple. Arrangement stays sparse to leave a pocket for the rap; energy comes from muting/adding layers and filter opens. Dusty, compressed, vinyl-textured — slight looseness and crackle are the aesthetic.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "vinyl_noise",
          "tape_hiss",
          "rhodes",
          "closed_hat",
          "spoken_word"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "snare",
          "closed_hat",
          "open_hat",
          "sub_bass",
          "rhodes",
          "lead_vocal",
          "adlib",
          "vinyl_noise"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "snare",
          "snare_roll",
          "closed_hat",
          "sub_bass",
          "rhodes",
          "lead_vocal",
          "riser",
          "vinyl_noise"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "sub_bass",
          "piano",
          "rhodes",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "hype_vocal",
          "adlib",
          "vinyl_noise"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "snare",
          "closed_hat",
          "open_hat",
          "sub_bass",
          "rhodes",
          "vibraphone",
          "lead_vocal",
          "adlib",
          "vinyl_noise"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "rhodes",
          "piano",
          "sub_bass",
          "sax",
          "beat_stop",
          "vinyl_noise",
          "spoken_word"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "sub_bass",
          "piano",
          "rhodes",
          "string_pad",
          "brass_section",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "hype_vocal",
          "adlib",
          "crowd_noise",
          "vinyl_noise"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "rhodes",
          "closed_hat",
          "vinyl_noise",
          "tape_hiss",
          "adlib",
          "beat_stop"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "kick"
    ],
    "qualityChecks": [
      "closed_hat is audibly SWUNG (MPC swing ~54–62%), not straight-quantized",
      "snare/clap lands hard on beats 2 and 4 (backbeat), not on every quarter",
      "kick is syncopated around beat 1 with ghost hits, NOT four-on-the-floor",
      "sub/808 bass is mono and locked to the kick",
      "vinyl crackle / lo-fi tape texture is present under the loop",
      "harmony reads as a chopped, looped soul/jazz sample (rhodes/piano) rather than a fast chord progression",
      "rap lead vocal with call-and-response adlibs is present",
      "head-nod tempo ~85–95 BPM with a half-time feel",
      "NO log_drum, NO four-on-floor, NO constant trap triplet hat rolls"
    ],
    "engineTags": [
      "boom bap hip hop",
      "swung MPC drum break",
      "hard snare backbeat",
      "chopped soul/jazz sample loop",
      "sub 808 bass",
      "vinyl crackle lo-fi",
      "90 BPM head-nod groove",
      "rap lead vocal with adlibs",
      "dusty jazzy rhodes chops",
      "east coast hip hop"
    ]
  },
  "house": {
    "genre": "house",
    "displayName": "House",
    "origin": "Chicago, USA (early-to-mid 1980s) — grew out of disco/garage, pioneered by DJs like Frankie Knuckles at The Warehouse and producers like Jesse Saunders/Marshall Jefferson; four-on-the-floor electronic dance music built for the club.",
    "bpmLo": 118,
    "bpmHi": 128,
    "typicalBpm": 124,
    "swing": "light",
    "fourOnFloor": true,
    "requiredRoles": [
      "club_kick",
      "closed_hat",
      "open_hat",
      "clap",
      "synth_bass",
      "house_piano_stab",
      "shaker"
    ],
    "optionalRoles": [
      "kick",
      "soft_kick",
      "rimshot",
      "snap",
      "ride",
      "crash",
      "tom",
      "snare_roll",
      "drum_roll",
      "sub_bass",
      "moog_bass",
      "pluck_bass",
      "organ_bass",
      "rhodes",
      "wurlitzer",
      "organ",
      "hammond",
      "gospel_organ",
      "piano",
      "warm_pad",
      "synth_pad",
      "choir_pad",
      "string_pad",
      "synth_lead",
      "synth_pluck",
      "bell_lead",
      "vocal_chop",
      "sax",
      "trumpet",
      "brass_section",
      "strings_line",
      "lead_vocal",
      "double",
      "harmony_vocal",
      "adlib",
      "chant",
      "choir",
      "gospel_choir",
      "vocal_pad",
      "humming",
      "call_response",
      "conga",
      "bongo",
      "cowbell",
      "cabasa",
      "maraca",
      "timbales",
      "guiro",
      "woodblock",
      "cajon",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "vinyl_noise",
      "crowd_noise",
      "club_ambience",
      "transition_fx",
      "beat_stop",
      "drop_fx",
      "siren"
    ],
    "signatureRoles": [
      "club_kick",
      "open_hat",
      "house_piano_stab",
      "organ",
      "vocal_chop"
    ],
    "forbiddenTraits": [
      "log_drum (that is amapiano, not house)",
      "sliding_808 / 808 sub glides (trap/afrobeats)",
      "talking_drum or dundun (afrobeats/highlife)",
      "trap hi-hat triplet rolls or drill hat slides",
      "half-time / trap feel",
      "any groove that abandons the four-on-the-floor kick (broken/syncopated kick = gqom, breaks, jungle)",
      "dembow / reggaeton bounce",
      "heavy triplet swing (that pushes it toward UK garage/2-step)",
      "tempo below 115 (hip-hop/downtempo) or above 132 (techno/trance)",
      "cold, minimal, piano-less texture (that is techno, not house — house keeps disco warmth, soul and stabs)"
    ],
    "grooveRules": "Kick lands on all four downbeats (four-on-the-floor) as the metronomic anchor — one solid, tight club kick per beat. The defining signature is the open hi-hat sounding on every offbeat: the 'ts' that sits exactly between the kicks, on the 'and' of each beat. Closed hats run continuous 16ths underneath for forward drive. Clap (and/or a tight snare/rimshot) hits the backbeat on 2 and 4. The bassline is syncopated and rolling, filling the gaps between kicks — offbeat 8ths or a 16th-note groove — and is ducked/sidechained under the kick so the low end pumps and breathes. Piano and organ chords are played as short, punchy, syncopated stabs, frequently landing just off the grid to inject bounce. A subtle shuffle/swing (~8-16%) on the hats, shaker and stabs gives the pocket its human, disco-derived groove. Arrangement moves in clean 8- and 16-bar phrases with long DJ-mixable heads and tails.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "shaker",
          "vinyl_noise",
          "club_ambience"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "clap",
          "synth_bass",
          "shaker",
          "rhodes",
          "vinyl_noise"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "club_kick",
          "closed_hat",
          "clap",
          "snare_roll",
          "synth_bass",
          "riser",
          "sweep",
          "reverse_cymbal"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "club_kick",
          "clap",
          "open_hat",
          "closed_hat",
          "synth_bass",
          "house_piano_stab",
          "organ",
          "warm_pad",
          "lead_vocal",
          "shaker",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "rhodes",
          "warm_pad",
          "choir_pad",
          "lead_vocal",
          "vocal_pad",
          "vinyl_noise",
          "riser",
          "reverse_cymbal",
          "downlifter"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "clap",
          "synth_bass",
          "organ",
          "conga",
          "shaker",
          "lead_vocal",
          "vocal_chop"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "club_kick",
          "clap",
          "open_hat",
          "closed_hat",
          "synth_bass",
          "house_piano_stab",
          "organ",
          "warm_pad",
          "lead_vocal",
          "harmony_vocal",
          "adlib",
          "shaker",
          "conga",
          "cowbell",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "club_kick",
          "closed_hat",
          "open_hat",
          "shaker",
          "synth_bass",
          "vinyl_noise",
          "club_ambience"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "open_hat",
      "closed_hat"
    ],
    "qualityChecks": [
      "kick on every quarter-note — true four-on-the-floor, one per beat",
      "open hi-hat clearly on the offbeats (the 'and' between kicks)",
      "clap/snare backbeat on beats 2 and 4",
      "tempo sits 118-128 BPM, four-on-the-floor throughout",
      "syncopated house piano or organ stabs are audible",
      "rolling/offbeat bassline filling the gaps, ducked under the kick",
      "audible sidechain pump on pads/bass under the kick",
      "continuous 16th closed-hat motion with subtle shuffle/swing",
      "a breakdown/bridge where drums drop out then punch back in",
      "no 808 glides, no log drum, no trap/triplet hats"
    ],
    "engineTags": [
      "house",
      "four-on-the-floor",
      "offbeat open hi-hats",
      "house piano stabs",
      "deep house",
      "soulful house",
      "rolling synth bassline",
      "sidechain pump",
      "124 bpm",
      "chicago house"
    ]
  },
  "jazz": {
    "genre": "jazz",
    "displayName": "Jazz (Straight-Ahead / Acoustic Combo)",
    "origin": "African American, United States — New Orleans then New York/Kansas City, early-to-mid 20th century (swing, bebop, hard bop, cool)",
    "bpmLo": 60,
    "bpmHi": 240,
    "typicalBpm": 130,
    "swing": "heavy",
    "fourOnFloor": false,
    "requiredRoles": [
      "ride",
      "upright_bass",
      "piano",
      "brushes",
      "kick",
      "snare",
      "closed_hat"
    ],
    "optionalRoles": [
      "sax",
      "trumpet",
      "trombone",
      "brass_section",
      "vibraphone",
      "guitar_chords",
      "lead_guitar",
      "rhodes",
      "wurlitzer",
      "organ",
      "hammond",
      "flute",
      "upright_piano",
      "open_hat",
      "crash",
      "rimshot",
      "tom",
      "tom_fill",
      "snare_roll",
      "drum_roll",
      "lead_vocal",
      "harmony_vocal",
      "humming",
      "adlib",
      "string_pad",
      "strings_line",
      "conga",
      "bongo",
      "cabasa",
      "bass_guitar",
      "fretless_bass",
      "synth_pad",
      "club_ambience",
      "crowd_noise",
      "vinyl_noise",
      "tape_hiss"
    ],
    "signatureRoles": [
      "ride",
      "upright_bass",
      "brushes",
      "piano",
      "sax"
    ],
    "forbiddenTraits": [
      "four-on-the-floor accented dance kick (house/disco)",
      "808 sub-bass, bass_808, sliding_808 or any hip-hop/trap low end",
      "trap_hat_roll, drill_hat_slide or gridded programmed hats",
      "log_drum, talking_drum, shekere or afro/amapiano percussion beds",
      "reggae_skank or reggaeton dembow",
      "straight, hard-quantized eighth notes with zero swing",
      "hammered rock/funk backbeat snare on 2 and 4 as the loudest element",
      "distorted electric power-chord guitar or reese_bass",
      "autotuned pop lead vocal or vocal_chop as the hook",
      "EDM synth_lead / risers-and-drops arrangement logic",
      "over-compressed, loop-tight drum machine feel with no dynamics or room"
    ],
    "grooveRules": "The ride cymbal is the master clock: it plays the swung 'spang-a-lang' pattern (ding, ding-da-ding) built on a triplet subdivision — never straight eighths. The hi-hat closes with the foot on beats 2 and 4 (the audible 'chick'), locking the backbeat without a rock snare hit. The upright bass walks in steady quarter notes, one note per beat, outlining the chord changes with chromatic and diatonic approach tones into each new bar. The kick is 'feathered' — played softly on all four beats so it is felt, not heard, and is NOT a dance thump; it also drops occasional 'bombs' with the left hand comping. Piano (and/or guitar) comps: syncopated, conversational rootless 7th/9th/13th and altered voicings that answer the soloist rather than sit on the beat. Snare and left hand add ghosted comping accents and phrase setups. Brushes swirl and tap on ballads and medium tempos; drummers switch to sticks for intensity. Everything breathes: rubato intros, dynamic crescendo across solo choruses, elastic time over a rock-solid ride+bass pulse. Solos are improvised with human phrasing, vibrato, and call-and-response; trading fours/eights between horns and drums is standard.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "piano",
          "upright_bass",
          "brushes",
          "ride",
          "club_ambience"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "sax",
          "piano",
          "upright_bass",
          "ride",
          "brushes",
          "closed_hat",
          "kick",
          "snare"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "ride",
          "open_hat",
          "upright_bass",
          "piano",
          "snare",
          "tom_fill",
          "trumpet",
          "brass_section"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "sax",
          "trumpet",
          "trombone",
          "brass_section",
          "piano",
          "upright_bass",
          "ride",
          "closed_hat",
          "snare",
          "kick",
          "crash"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "sax",
          "piano",
          "vibraphone",
          "upright_bass",
          "ride",
          "snare",
          "kick",
          "closed_hat",
          "open_hat"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "upright_bass",
          "tom",
          "tom_fill",
          "snare",
          "drum_roll",
          "ride",
          "crash",
          "piano",
          "trombone"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "sax",
          "trumpet",
          "trombone",
          "brass_section",
          "piano",
          "upright_bass",
          "ride",
          "snare",
          "kick",
          "crash",
          "open_hat"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "piano",
          "upright_bass",
          "ride",
          "crash",
          "brushes",
          "sax"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [],
    "qualityChecks": [
      "ride cymbal plays a swung, triplet-based spang-a-lang pattern (not straight eighths)",
      "hi-hat foot 'chick' audible on beats 2 and 4",
      "walking upright bass: quarter-note lines, woody acoustic tone, chromatic approach notes",
      "clear swing/triplet feel throughout, not gridded or straight",
      "piano/guitar comping is syncopated and conversational, not sustained on-beat pads",
      "feathered/quiet kick with NO 808 and no four-on-the-floor thump",
      "acoustic double bass dominates the low end, not synth or electric bass",
      "horn front line with improvised, human phrasing and vibrato",
      "brushes present on ballad/medium sections",
      "extended jazz harmony audible (7ths, 9ths, 11ths, 13ths, altered chords)",
      "natural dynamics and live room ambience; intensity builds across choruses",
      "form reads as head-solos-head / AABA, not pop verse-chorus"
    ],
    "engineTags": [
      "jazz",
      "straight-ahead swing",
      "acoustic jazz combo",
      "walking upright bass",
      "ride cymbal spang-a-lang",
      "brushes and cymbals",
      "comping piano",
      "saxophone / trumpet front line",
      "bebop / hard bop",
      "live small-room recording"
    ]
  },
  "juju": {
    "genre": "juju",
    "displayName": "Jùjú — Yoruba Guitar-Band Music",
    "origin": "Southwestern Nigeria (Yoruba), Lagos guitar-band tradition. Roots in 1920s–30s palm-wine music (Tunde King); electrified and internationally defined 1960s–80s by King Sunny Adé (talking-drum-and-pedal-steel juju) and Chief Commander Ebenezer Obey (miliki). Praise-song (oríkì) celebration music for owambe parties.",
    "bpmLo": 100,
    "bpmHi": 132,
    "typicalBpm": 118,
    "swing": "moderate",
    "fourOnFloor": false,
    "requiredRoles": [
      "talking_drum",
      "shekere",
      "agogo",
      "conga",
      "maraca",
      "live_kick",
      "snare",
      "rimshot",
      "closed_hat",
      "bass_guitar",
      "palmwine_guitar",
      "highlife_guitar",
      "lead_guitar",
      "pedal_steel",
      "lead_vocal",
      "call_response",
      "harmony_vocal",
      "chant"
    ],
    "optionalRoles": [
      "dundun",
      "mbira",
      "bongo",
      "cowbell",
      "gong",
      "cabasa",
      "claves",
      "woodblock",
      "ride",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "drum_roll",
      "clean_guitar_riff",
      "guitar_chords",
      "organ",
      "hammond",
      "synth_pad",
      "adlib",
      "double",
      "gospel_choir",
      "choir",
      "crowd_chant",
      "spoken_word",
      "humming",
      "vocal_pad",
      "crowd_noise",
      "street_ambience",
      "club_ambience"
    ],
    "signatureRoles": [
      "talking_drum",
      "pedal_steel",
      "palmwine_guitar",
      "call_response",
      "shekere"
    ],
    "forbiddenTraits": [
      "four-on-the-floor dance kick (turns it into afro-house/kwaito)",
      "amapiano log_drum or soft_kick shuffle",
      "808/sub_bass/sliding_808 and trap hi-hat rolls (anachronistic modern afrobeats/trap)",
      "drill hat slides, dembow or reggaeton grooves",
      "dominant funk horn/brass section (that is Fela-style Afrobeat or dance-band highlife, not juju)",
      "all-percussion with NO guitars (that is fuji or apala)",
      "a single strummed acoustic guitar with no interlocking second guitar",
      "EDM risers, drops, sidechain pumping or synth-lead builds",
      "gqom-style dark minimal broken 4/4",
      "auto-tuned solo pop vocal with no call-and-response chorus",
      "absent or non-'talking' talking drum"
    ],
    "grooveRules": "4/4 at a rolling mid-tempo with a moderate triplet-shuffle lilt inherited from Yoruba 12/8 bell patterns — NEVER four-on-the-floor. The agogo/gong bell holds a fixed clave-like timeline; shekere and maracas lay continuous rolling 8th/triplet motion; conga and the live kit play a relaxed syncopated backbeat (rimshot/ride-led, snare on 2 and 4, kick offbeat and sparse, not on every pulse). The lead talking drum (gángan/dùndún) is in near-constant conversation — pitch-bending 'speech' phrases that answer the cantor and cue turnarounds. Two or more clean, jangly electric guitars INTERLOCK: a repeating palm-wine/highlife ostinato riff plus a second guitar answering in offset call-and-response, a tenor guitar comping chords, while lead guitar and Hawaiian pedal steel float gliding melodic answers over the top. Bass guitar plays a melodic, semi-walking rolling line locked to the bell (never an 808). Vocals are praise-singing call-and-response: a lead cantor calls, a tight harmony chorus responds, over long hypnotic cyclic vamps that evolve by LAYERING rather than dropping. Energy rises by adding percussion, chorus and pedal steel and by intensifying talking-drum rolls — not by EDM risers or drops.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "agogo",
          "shekere",
          "maraca",
          "talking_drum",
          "palmwine_guitar",
          "bass_guitar",
          "rimshot"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "palmwine_guitar",
          "highlife_guitar",
          "talking_drum",
          "shekere",
          "agogo",
          "maraca",
          "conga",
          "bass_guitar",
          "live_kick",
          "ride",
          "rimshot",
          "closed_hat"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "call_response",
          "palmwine_guitar",
          "highlife_guitar",
          "lead_guitar",
          "pedal_steel",
          "talking_drum",
          "dundun",
          "shekere",
          "agogo",
          "conga",
          "bass_guitar",
          "live_kick",
          "snare",
          "drum_roll"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "call_response",
          "harmony_vocal",
          "adlib",
          "palmwine_guitar",
          "highlife_guitar",
          "lead_guitar",
          "pedal_steel",
          "talking_drum",
          "dundun",
          "shekere",
          "agogo",
          "maraca",
          "conga",
          "bass_guitar",
          "live_kick",
          "snare",
          "ride",
          "crash"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "spoken_word",
          "chant",
          "highlife_guitar",
          "clean_guitar_riff",
          "talking_drum",
          "shekere",
          "agogo",
          "conga",
          "mbira",
          "bass_guitar",
          "live_kick",
          "rimshot",
          "closed_hat"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "lead_guitar",
          "pedal_steel",
          "talking_drum",
          "dundun",
          "call_response",
          "chant",
          "shekere",
          "agogo",
          "conga",
          "bongo",
          "bass_guitar",
          "live_kick",
          "ride",
          "tom_fill"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "lead_vocal",
          "call_response",
          "harmony_vocal",
          "gospel_choir",
          "crowd_chant",
          "adlib",
          "double",
          "palmwine_guitar",
          "highlife_guitar",
          "lead_guitar",
          "pedal_steel",
          "talking_drum",
          "dundun",
          "shekere",
          "agogo",
          "maraca",
          "conga",
          "cowbell",
          "bass_guitar",
          "live_kick",
          "snare",
          "ride",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "talking_drum",
          "shekere",
          "agogo",
          "conga",
          "palmwine_guitar",
          "bass_guitar",
          "chant",
          "crowd_noise",
          "club_ambience"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [],
    "qualityChecks": [
      "talking_drum present and audibly 'talking' — pitch-bending conversational phrases answering the vocal",
      "two or more interlocking clean electric guitars in offset call-and-response (not one strummed guitar)",
      "Hawaiian pedal_steel gliding melodic answers audible",
      "Yoruba-style call-and-response between a lead cantor and a harmony chorus",
      "continuous shekere/maraca rolling triplet-shuffle timeline",
      "fixed agogo/gong bell clave-like timeline underneath",
      "melodic electric bass_guitar locked to the bell — NOT an 808",
      "no four-on-the-floor kick; syncopated live-kit backbeat led by rimshot/ride",
      "hypnotic long cyclic vamp that builds by layering, with no EDM drop",
      "mid-tempo ~110–125 bpm rolling groove, no trap/drill hats"
    ],
    "engineTags": [
      "juju",
      "yoruba juju guitar band",
      "talking drum (dundun/gangan)",
      "interlocking palm-wine electric guitars",
      "hawaiian pedal steel guitar",
      "call-and-response praise vocals",
      "shekere and agogo percussion timeline",
      "rolling mid-tempo afro shuffle",
      "king sunny ade / ebenezer obey style",
      "live band, no 808s or four-on-floor"
    ]
  },
  "kwaito": {
    "genre": "kwaito",
    "displayName": "Kwaito",
    "origin": "South Africa — Johannesburg/Soweto townships, early-to-mid 1990s. House music slowed to a township pocket, with tsotsitaal (township slang) chant vocals. Forerunner of amapiano; distinct from house, gqom, and afrobeats.",
    "bpmLo": 100,
    "bpmHi": 115,
    "typicalBpm": 108,
    "swing": "light",
    "fourOnFloor": true,
    "requiredRoles": [
      "kick",
      "clap",
      "closed_hat",
      "open_hat",
      "shaker",
      "synth_bass",
      "organ",
      "lead_vocal",
      "chant",
      "spoken_word"
    ],
    "optionalRoles": [
      "club_kick",
      "snare",
      "rimshot",
      "snap",
      "crash",
      "snare_roll",
      "ride",
      "cowbell",
      "conga",
      "woodblock",
      "agogo",
      "shekere",
      "marimba",
      "organ_bass",
      "sub_bass",
      "moog_bass",
      "house_piano_stab",
      "piano",
      "rhodes",
      "hammond",
      "synth_pad",
      "warm_pad",
      "string_pad",
      "synth_lead",
      "synth_pluck",
      "bell_lead",
      "mallet_lead",
      "brass_section",
      "sax",
      "vocal_chop",
      "adlib",
      "hype_vocal",
      "double",
      "harmony_vocal",
      "vinyl_noise",
      "tape_hiss",
      "crowd_noise",
      "club_ambience",
      "street_ambience",
      "siren",
      "sweep",
      "reverse_cymbal",
      "riser",
      "impact",
      "beat_stop",
      "transition_fx"
    ],
    "signatureRoles": [
      "synth_bass",
      "open_hat",
      "crowd_chant",
      "call_response",
      "spoken_word"
    ],
    "forbiddenTraits": [
      "log_drum or any log-drum-led groove (that is amapiano, which post-dates kwaito)",
      "sliding_808 / bass_808 and trap hi-hat rolls (trap/afrobeats)",
      "full-tempo 124-128 BPM driving house four-on-the-floor with EDM energy",
      "dark broken/syncopated 4/4 with minimal hypnotic percussion (gqom)",
      "West African syncopated kick+snare with shekere-led afrobeats pocket",
      "reggaeton/dembow rhythm",
      "jazzy patient amapiano piano builds and long log-drum drops",
      "interlocking clean highlife guitars / live-band highlife feel",
      "EDM supersaw leads, festival risers, big builds-and-drops",
      "double-time / fast trap hats or drill hat slides"
    ],
    "grooveRules": "Slowed house at ~104-110 BPM. Keep a four-on-the-floor kick, but heavy, warm and laid-back — never the driving 124+ push of club house. The engine is a DEEP, repetitive looping bassline (organ bass or analog synth) grooving in a 1-2 bar cell locked to the kick; it carries the melody and sits loud and forward. Clap (and/or snare) hits the 2 and 4 backbeat. The open hi-hat plays the classic house off-beat — the 'and' of each beat — while closed hats and shaker keep loose 16th motion with a light shuffle. Harmony is minimal and hypnotic: one or two chords looping as organ or house-piano stabs, with NO travelling chord progression. Vocals are the hook — half-spoken, half-shouted township slang (tsotsitaal/isicamtho), sitting laid-back behind the beat, answered by gang call-and-response crowd chants. Arrange by subtracting and adding layers over long 8-bar loops, not by EDM builds and drops. Space, repetition and the bass ARE the record. Occasional siren stabs, vinyl crackle and club/crowd ambience place it in the township jam.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "kick",
          "synth_bass",
          "shaker",
          "closed_hat",
          "vinyl_noise",
          "club_ambience",
          "chant",
          "siren"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "synth_bass",
          "clap",
          "closed_hat",
          "open_hat",
          "shaker",
          "organ",
          "spoken_word",
          "lead_vocal"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "synth_bass",
          "clap",
          "closed_hat",
          "open_hat",
          "shaker",
          "organ",
          "house_piano_stab",
          "call_response",
          "snare_roll",
          "riser"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "synth_bass",
          "clap",
          "open_hat",
          "closed_hat",
          "shaker",
          "organ",
          "house_piano_stab",
          "crowd_chant",
          "lead_vocal",
          "adlib",
          "brass_section",
          "crash"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "synth_bass",
          "clap",
          "closed_hat",
          "shaker",
          "organ",
          "spoken_word",
          "siren",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "synth_bass",
          "beat_stop",
          "warm_pad",
          "organ",
          "call_response",
          "crowd_noise",
          "sweep",
          "reverse_cymbal"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "kick",
          "synth_bass",
          "clap",
          "open_hat",
          "closed_hat",
          "shaker",
          "organ",
          "house_piano_stab",
          "crowd_chant",
          "lead_vocal",
          "double",
          "adlib",
          "hype_vocal",
          "brass_section",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "synth_bass",
          "shaker",
          "closed_hat",
          "chant",
          "vinyl_noise",
          "club_ambience"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [],
    "qualityChecks": [
      "four-on-the-floor kick present at a slow 100-115 BPM, laid-back (NOT 124+ house tempo, NOT broken)",
      "deep repetitive looping bassline is the dominant melodic element and sits loud",
      "open hi-hat on the off-beats (house upbeat 'tss')",
      "clap and/or snare backbeat on beats 2 and 4",
      "closed-hat / shaker 16th motion with a light shuffle",
      "call-and-response gang crowd chant in the hook",
      "half-spoken / shouted township-slang lead vocal sitting behind the beat",
      "minimal 1-2 chord hypnotic harmony via organ or house-piano stabs, no progression",
      "NO log drum and NO 808 slides present (would flip it to amapiano/afrobeats)"
    ],
    "engineTags": [
      "kwaito",
      "1990s South African township house",
      "slowed four-on-the-floor groove",
      "deep looping organ/synth bassline",
      "off-beat house open-hat",
      "gang call-and-response chant",
      "spoken township-slang vocals",
      "organ & house-piano stabs",
      "hypnotic minimal loop",
      "laid-back mid-tempo bass-heavy"
    ]
  },
  "latin_pop": {
    "genre": "latin_pop",
    "displayName": "Latin Pop",
    "origin": "Pan-Latin American / U.S. Latin crossover (Miami-Colombia-Mexico axis) — the radio-facing blend of pop songcraft with tropical, reggaeton, and Latin-guitar DNA. Descends from 80s/90s baladas and Gloria Estefan/Miami Sound Machine, modernized by Shakira, Enrique Iglesias, Luis Fonsi, J Balvin/Maluma crossovers, Camila Cabello, and Kali Uchis.",
    "bpmLo": 88,
    "bpmHi": 108,
    "typicalBpm": 96,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "lead_vocal",
      "double",
      "harmony_vocal",
      "kick",
      "snare",
      "clap",
      "closed_hat",
      "bass_guitar",
      "piano",
      "guitar_chords",
      "shaker",
      "conga"
    ],
    "optionalRoles": [
      "synth_bass",
      "rhodes",
      "synth_pad",
      "warm_pad",
      "string_pad",
      "strings_line",
      "trumpet",
      "brass_section",
      "accordion",
      "adlib",
      "vocal_chop",
      "timbales",
      "bongo",
      "cowbell",
      "guiro",
      "cabasa",
      "maraca",
      "rimshot",
      "open_hat",
      "crash",
      "reverse_cymbal",
      "riser",
      "downlifter",
      "impact",
      "trap_hat_roll",
      "lead_guitar",
      "synth_pluck",
      "bell_lead",
      "choir",
      "call_response"
    ],
    "signatureRoles": [
      "clean_guitar_riff",
      "conga",
      "shaker",
      "bass_guitar",
      "lead_vocal"
    ],
    "forbiddenTraits": [
      "true four-on-the-floor house/EDM kick on every beat (that turns it into Latin house/dance-pop, not latin pop)",
      "amapiano log_drum or gqom broken-4/4 dark percussion",
      "reggaeton dembow used as the RELENTLESS non-stop backbone at full intensity (a light dembow-flavored hook is fine as a crossover flavor, but if the boom-ch-boom-chick never lets up it becomes reggaeton, not latin pop)",
      "trap 808-glide sub as the primary bass with sparse hi-hat triplet-roll beat (that is Latin trap)",
      "banda/mariachi tuba+brass oom-pah as the core (that is regional mexican)",
      "heavy metal/rock-band distorted power chords as the harmonic core",
      "aggressive drill hat slides and dark minor-only 140+ bpm feel",
      "boom-bap swung hip-hop drums with vinyl-crackle lo-fi as the identity",
      "salsa clave montuno piano at full-tilt tempo (that is salsa, latin pop only borrows the flavor)"
    ],
    "grooveRules": "Pocket is pop-forward but tropical-inflected. Kick is NOT four-on-the-floor: it plays a syncopated tumbao-adjacent pattern — typically beat 1, the 'and' of 2, and beat 3 (with pickups), leaving space for percussion. Snare/clap lands firmly on 2 and 4 (backbeat) — this is the pop anchor that separates it from reggaeton (which puts the accent on the 'a' of beats). Shaker or cabasa runs steady 16ths giving forward propulsion; congas play an open-tone tumbao countering the kick. A light dembow/tropical flavor can color the hook (kick doubling toward a boom-ch feel) but it never overrides the 2-and-4 backbone. Swing is light (55-58%) — enough Latin bounce to feel human, not stiff EDM grid, not heavy triplet shuffle. Bass locks to the kick with syncopated, melodic, root-fifth-and-passing-note motion (bass_guitar or synth_bass), often anticipating the downbeat (the classic Latin bass anticipation/'ponche'). Nylon/clean electric guitar plays bright arpeggiated or muted-strum riffs high in the arrangement — the signature earworm hook. Harmony is diatonic major-key pop with occasional minor-key emotive verses; chord loops of 4 bars (i-VI-III-VII or I-V-vi-IV). Everything serves the vocal.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "clean_guitar_riff",
          "shaker",
          "piano",
          "vocal_chop",
          "riser"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "clean_guitar_riff",
          "bass_guitar",
          "closed_hat",
          "shaker",
          "kick",
          "conga",
          "rhodes"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "double",
          "clean_guitar_riff",
          "bass_guitar",
          "closed_hat",
          "shaker",
          "kick",
          "conga",
          "bongo",
          "adlib",
          "piano"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "piano",
          "string_pad",
          "riser",
          "snare_roll",
          "shaker",
          "bass_guitar",
          "downlifter"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "double",
          "harmony_vocal",
          "clean_guitar_riff",
          "bass_guitar",
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "conga",
          "timbales",
          "shaker",
          "piano",
          "strings_line",
          "trumpet",
          "crash",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "piano",
          "warm_pad",
          "guitar_chords",
          "accordion",
          "conga",
          "call_response",
          "reverse_cymbal",
          "impact"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "lead_vocal",
          "double",
          "harmony_vocal",
          "choir",
          "clean_guitar_riff",
          "bass_guitar",
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "conga",
          "timbales",
          "cowbell",
          "shaker",
          "guiro",
          "piano",
          "strings_line",
          "brass_section",
          "crash",
          "adlib"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "lead_vocal",
          "clean_guitar_riff",
          "shaker",
          "conga",
          "piano",
          "vocal_chop"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "clean_guitar_riff",
      "bass_guitar",
      "kick",
      "conga"
    ],
    "qualityChecks": [
      "lead vocal is the loudest, upfront and intimate with doubles on the hook",
      "snare or clap clearly on beats 2 and 4 (backbeat present — NOT reggaeton off-accent)",
      "kick is syncopated, NOT four-on-the-floor",
      "bright nylon/clean guitar riff audible as a recurring melodic hook",
      "steady 16th shaker or cabasa motion present",
      "conga open-tone tumbao layer under the groove",
      "melodic syncopated bass locking to the kick with anticipation",
      "major-key pop harmony, singable and diatonic",
      "tempo sits ~88-108 bpm with light Latin swing, not stiff grid",
      "tropical percussion color (timbales/bongo/cowbell) blooms in the full hook"
    ],
    "engineTags": [
      "latin pop",
      "nylon-string guitar hook",
      "tropical percussion congas",
      "syncopated bass groove",
      "backbeat clap on 2 and 4",
      "polished radio pop production",
      "spanish-language crossover vocal",
      "shaker 16ths",
      "warm major-key",
      "Miami-Colombia sound"
    ]
  },
  "lofi": {
    "genre": "lofi",
    "displayName": "Lo-Fi Hip-Hop",
    "origin": "Instrumental hip-hop lineage — J Dilla, Nujabes and Madlib — evolved into modern chillhop / \"study beats\" (Lofi Girl, Chillhop Records, Idealism/Jinsang). Jazzy, tape-degraded, boom-bap-derived, made for relaxing and studying.",
    "bpmLo": 70,
    "bpmHi": 90,
    "typicalBpm": 82,
    "swing": "moderate",
    "fourOnFloor": false,
    "requiredRoles": [
      "soft_kick",
      "snare",
      "closed_hat",
      "sub_bass",
      "rhodes",
      "vinyl_noise",
      "tape_hiss"
    ],
    "optionalRoles": [
      "kick",
      "rimshot",
      "clap",
      "snap",
      "open_hat",
      "ride",
      "brushes",
      "crash",
      "tom",
      "tom_fill",
      "shaker",
      "kalimba",
      "cajon",
      "woodblock",
      "triangle",
      "vibraphone",
      "marimba",
      "glockenspiel",
      "chimes",
      "upright_bass",
      "bass_guitar",
      "fretless_bass",
      "synth_bass",
      "moog_bass",
      "upright_piano",
      "wurlitzer",
      "piano",
      "guitar_chords",
      "organ",
      "warm_pad",
      "string_pad",
      "synth_pad",
      "sax",
      "trumpet",
      "flute",
      "clean_guitar_riff",
      "lead_guitar",
      "vocal_chop",
      "bell_lead",
      "mallet_lead",
      "synth_pluck",
      "humming",
      "vocal_pad",
      "spoken_word",
      "lead_vocal",
      "harmony_vocal",
      "double",
      "nature_ambience",
      "street_ambience",
      "reverse_cymbal",
      "sweep"
    ],
    "signatureRoles": [
      "vinyl_noise",
      "rhodes",
      "soft_kick",
      "upright_bass",
      "tape_hiss"
    ],
    "forbiddenTraits": [
      "four-on-the-floor kick pattern (house tell)",
      "gliding / sliding 808 sub-bass (trap tell)",
      "triplet trap hi-hat rolls and machine-gun stutter hats",
      "drill hat slides",
      "loud punchy club / EDM kick — the lofi kick must stay soft, round and filtered",
      "bright hi-fi brickwalled master with no dusty tape/vinyl character",
      "EDM risers, build-ups, big impacts or dramatic drops",
      "log drum (amapiano signature)",
      "dead-quantized on-grid drums with zero swing (kills the 'drunk' pocket)",
      "distorted rock guitars or bright supersaw synth stacks",
      "fast, energetic tempo (>95 BPM) or high-energy dynamics"
    ],
    "grooveRules": "Half-time boom-bap pocket at ~70-90 BPM. Soft, filtered kick on beat 1 (often with a syncopated push just before the backbeat); snare or cross-stick rimshot on beat 3 for the lazy half-time backbeat (2-and-4 for a straighter cut). Hats swing hard and sit slightly ahead while the snare drags a hair behind the grid — the J Dilla \"drunk\"/off-grid feel; NEVER dead-quantized. Humanize velocity and micro-timing, sprinkle ghost snares and hat variations. Bass is round and soft, locked to the kick — walking upright lines in jazzier cuts, held sub notes in mellow ones. Rhodes / felt-piano comps extended jazz chords (maj7, min9, dominant13) with loose human timing. Vinyl crackle and tape hiss run CONTINUOUSLY as a bed under the whole track; highs are rolled off / low-passed for the muffled \"heard through the wall\" haze. Arrangement is sparse and loop-based — few elements at once, lots of air, subtle 8-bar turnarounds; dynamics stay gentle and constant with no dramatic builds or drops.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "vinyl_noise",
          "tape_hiss",
          "nature_ambience",
          "rhodes",
          "warm_pad",
          "spoken_word"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "vinyl_noise",
          "tape_hiss",
          "soft_kick",
          "closed_hat",
          "rimshot",
          "sub_bass",
          "rhodes"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "vinyl_noise",
          "tape_hiss",
          "soft_kick",
          "snare",
          "closed_hat",
          "open_hat",
          "sub_bass",
          "rhodes",
          "warm_pad",
          "flute"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "vinyl_noise",
          "tape_hiss",
          "soft_kick",
          "snare",
          "closed_hat",
          "open_hat",
          "upright_bass",
          "rhodes",
          "warm_pad",
          "sax",
          "vibraphone"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "vinyl_noise",
          "tape_hiss",
          "soft_kick",
          "closed_hat",
          "brushes",
          "rimshot",
          "upright_bass",
          "upright_piano",
          "kalimba"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "vinyl_noise",
          "tape_hiss",
          "nature_ambience",
          "rhodes",
          "fretless_bass",
          "flute",
          "chimes"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "vinyl_noise",
          "tape_hiss",
          "soft_kick",
          "snare",
          "closed_hat",
          "open_hat",
          "upright_bass",
          "rhodes",
          "warm_pad",
          "sax",
          "vibraphone",
          "shaker",
          "humming"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "vinyl_noise",
          "tape_hiss",
          "nature_ambience",
          "rhodes",
          "warm_pad",
          "spoken_word"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [],
    "qualityChecks": [
      "continuous vinyl crackle AND tape hiss audible across the ENTIRE track, not just the intro",
      "kick is soft/round/filtered — no punchy club kick, no four-on-the-floor",
      "drums swing off-grid ('drunk', behind-the-beat) — not dead-quantized",
      "warm detuned Rhodes or felt/upright piano voicing extended jazz chords (7ths/9ths/13ths)",
      "round mellow bass (upright or soft sub) locked to the kick — no gliding 808",
      "relaxed half-time feel at ~70-90 BPM",
      "highs rolled off / low-pass 'muffled' character — not a bright brickwalled master",
      "sparse, loopy, spacious arrangement — never busy or high-energy",
      "characteristic color present: rain/cafe ambience, kalimba/vibraphone tone, or chopped-vocal/spoken sample"
    ],
    "engineTags": [
      "dusty lofi hip-hop beat, vinyl crackle and tape hiss",
      "warm detuned Rhodes and felt-piano jazz chords",
      "soft filtered boom-bap kick, swung off-grid 'drunk' drums",
      "round mellow upright and sub bass",
      "relaxed half-time groove around 80 bpm",
      "smoky muted sax, soft flute and chopped-vocal melodies",
      "low-pass filtered, hazy, mellow study-beats mood",
      "sparse loop-based arrangement with rain/cafe ambience"
    ]
  },
  "ndombolo": {
    "genre": "ndombolo",
    "displayName": "Ndombolo",
    "origin": "Democratic Republic of Congo / Congo-Brazzaville (Kinshasa & Brazzaville) — 1990s dance evolution of Congolese soukous/rumba; Koffi Olomidé, Wenge Musica, Werrason, JB Mpiana, Extra Musica, Awilo Longomba",
    "bpmLo": 108,
    "bpmHi": 140,
    "typicalBpm": 125,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "lead_guitar",
      "clean_guitar_riff",
      "highlife_guitar",
      "bass_guitar",
      "kick",
      "snare",
      "closed_hat",
      "open_hat",
      "cowbell",
      "conga",
      "lead_vocal",
      "harmony_vocal",
      "adlib",
      "chant"
    ],
    "optionalRoles": [
      "rimshot",
      "tom",
      "tom_fill",
      "ride",
      "crash",
      "shaker",
      "bongo",
      "clap",
      "rhodes",
      "organ",
      "brass_section",
      "sax",
      "trumpet",
      "synth_pad",
      "call_response",
      "double",
      "crowd_chant",
      "hype_vocal",
      "spoken_word",
      "snare_roll",
      "drum_roll",
      "reverse_cymbal",
      "crowd_noise"
    ],
    "signatureRoles": [
      "lead_guitar",
      "clean_guitar_riff",
      "cowbell",
      "adlib",
      "chant"
    ],
    "forbiddenTraits": [
      "log_drum (amapiano signature — wrong genre)",
      "808 sub-bass / sliding 808 / trap sub (this is live finger-style electric bass, never 808)",
      "four-on-the-floor house/EDM kick",
      "reggaeton dembow pattern",
      "trap hi-hat rolls and triplet hats as the core groove",
      "amapiano soft_kick + shaker patience",
      "afrobeats shekere-16ths-led pocket or talking_drum as centerpiece",
      "gqom dark broken minimal 4/4",
      "heavily quantized/gridded programmed drums replacing live kit feel",
      "dubstep/EDM drops and risers as the structural climax instead of the sebene",
      "distorted rock/metal guitar tone (Congolese leads are clean, bright, trebly single-coil)"
    ],
    "grooveRules": "Fast, buoyant 4/4 dance pocket driven by interlocking clean electric guitars, NOT by the drum machine. The heart is the multi-guitar architecture: a high, bright, trebly LEAD (sebene) guitar loops a hypnotic 2-4 bar riff (often in parallel thirds/sixths), a mi-solo mid-register guitar answers, and a rhythm/highlife guitar chops steady arpeggiated chords — all three interlock like gears. Bass is LIVE finger-style electric, melodic and busy, walking and syncopating with the kick rather than sitting on the root; it pushes the dance. Drums: a propulsive snare on 2 and 4 with rolling ghost-note and off-beat fills, hi-hats running steady 8ths/16ths that open on the up, kick syncopated to lock with the bass. Cowbell and/or rimshot ride an insistent off-beat clave-like pulse that defines ndombolo's hip-driving swing. Light swing/push on the guitars and hats gives the roll; keep it human, not gridded. The track is built to erupt into the SEBENE — the extended instrumental dance climax where the lead guitar riff loops, the atalaku shouts animation/cris and dance-move calls (call-and-response chants, crowd hype), the cowbell and snare drive hardest, and everything locks into a hypnotic circular groove for the crowd to dance. Verses (the rumba/song part) are more relaxed and melodic; the sebene is the release and the whole point.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "clean_guitar_riff",
          "highlife_guitar",
          "bass_guitar",
          "closed_hat",
          "rimshot",
          "lead_vocal"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "highlife_guitar",
          "clean_guitar_riff",
          "bass_guitar",
          "kick",
          "snare",
          "closed_hat",
          "conga",
          "rhodes"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "call_response",
          "highlife_guitar",
          "clean_guitar_riff",
          "bass_guitar",
          "kick",
          "snare",
          "closed_hat",
          "open_hat",
          "cowbell",
          "conga",
          "snare_roll"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "double",
          "chant",
          "lead_guitar",
          "clean_guitar_riff",
          "highlife_guitar",
          "bass_guitar",
          "kick",
          "snare",
          "closed_hat",
          "open_hat",
          "cowbell",
          "conga",
          "crash",
          "brass_section"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "lead_guitar",
          "clean_guitar_riff",
          "highlife_guitar",
          "bass_guitar",
          "kick",
          "snare",
          "closed_hat",
          "open_hat",
          "cowbell",
          "conga",
          "adlib",
          "chant",
          "call_response",
          "crowd_chant",
          "hype_vocal",
          "spoken_word",
          "tom_fill",
          "crowd_noise"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "highlife_guitar",
          "clean_guitar_riff",
          "bass_guitar",
          "kick",
          "snare",
          "closed_hat",
          "cowbell",
          "conga",
          "organ"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "lead_guitar",
          "clean_guitar_riff",
          "bass_guitar",
          "cowbell",
          "conga",
          "adlib",
          "chant",
          "crowd_chant",
          "closed_hat"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_guitar",
      "lead_vocal",
      "bass_guitar",
      "snare",
      "clean_guitar_riff",
      "cowbell",
      "harmony_vocal",
      "closed_hat",
      "conga",
      "highlife_guitar",
      "adlib",
      "brass_section",
      "open_hat",
      "rhodes"
    ],
    "qualityChecks": [
      "bright trebly clean LEAD guitar looping a hypnotic sebene riff (single-coil tone, no distortion)",
      "at least two INTERLOCKING clean guitars (lead/mi-solo + rhythm) playing distinct interlocking parts, often in parallel thirds",
      "LIVE melodic finger-style electric bass that walks and syncopates — NOT an 808 or a static root",
      "insistent cowbell and/or rimshot off-beat pulse driving the hip groove",
      "snare on 2 and 4 with rolling ghost fills, fast running hi-hats (no trap hat rolls)",
      "an extended SEBENE dance section where the guitar riff loops and shouted atalaku animation/call-response chants drive the crowd",
      "tempo in the ~115-140 fast dance range",
      "no log_drum, no 808 sub, no four-on-the-floor house kick"
    ],
    "engineTags": [
      "ndombolo",
      "congolese soukous",
      "sebene lead guitar",
      "interlocking clean guitars",
      "live melodic bass",
      "cowbell dance groove",
      "atalaku animation chant",
      "kinshasa rumba",
      "fast african dance",
      "call and response"
    ]
  },
  "pop": {
    "genre": "pop",
    "displayName": "Pop (Modern Radio / Dance-Pop)",
    "origin": "Western mainstream pop — US/UK radio tradition shaped heavily by the Swedish Cheiron / Max Martin hit-making school (Britney, Backstreet, Katy Perry, The Weeknd, Dua Lipa, Ariana Grande, Taylor Swift's pop era, Olivia Rodrigo). Lineage runs 1980s synth-pop and new-jack backbeat → 2000s teen-pop → 2010s–present electropop / dance-pop. It is producer-programmed, vocal-first, and built around a single unforgettable hook.",
    "bpmLo": 90,
    "bpmHi": 132,
    "typicalBpm": 116,
    "swing": "straight",
    "fourOnFloor": false,
    "requiredRoles": [
      "lead_vocal",
      "double",
      "kick",
      "clap",
      "closed_hat",
      "snare",
      "synth_bass",
      "synth_pad",
      "piano"
    ],
    "optionalRoles": [
      "snap",
      "open_hat",
      "crash",
      "rimshot",
      "snare_roll",
      "tom_fill",
      "club_kick",
      "sub_bass",
      "bass_808",
      "bass_guitar",
      "pluck_bass",
      "moog_bass",
      "rhodes",
      "wurlitzer",
      "warm_pad",
      "string_pad",
      "choir_pad",
      "guitar_chords",
      "house_piano_stab",
      "synth_lead",
      "bell_lead",
      "strings_line",
      "violin_line",
      "clean_guitar_riff",
      "lead_guitar",
      "sax",
      "glockenspiel",
      "chimes",
      "marimba",
      "mallet_lead",
      "harmony_vocal",
      "adlib",
      "chant",
      "crowd_chant",
      "choir",
      "vocal_pad",
      "humming",
      "shaker",
      "cabasa",
      "triangle",
      "riser",
      "impact",
      "downlifter",
      "reverse_cymbal",
      "sweep",
      "transition_fx",
      "beat_stop",
      "drop_fx",
      "crowd_noise",
      "flute"
    ],
    "signatureRoles": [
      "lead_vocal",
      "clap",
      "double",
      "synth_pluck",
      "vocal_chop"
    ],
    "forbiddenTraits": [
      "log_drum or amapiano-style patient log-drum groove (that is amapiano)",
      "sliding 808 glides or rapid trap_hat_roll / hi-hat triplet rolls as the core groove (that is trap/drill)",
      "dembow reggaeton pattern with siren stabs (that is reggaeton/dancehall)",
      "offbeat reggae_skank guitar on the upbeats (that is reggae)",
      "highlife_guitar / talking_drum / shekere-led syncopation (that is afrobeats/highlife)",
      "gospel_organ + gospel_choir call_response as the harmonic core (that is gospel)",
      "brushes or upright/swung triplet shuffle jazz feel",
      "wall of distorted lead_guitar as the primary texture with vocals buried (that is rock/metal)",
      "loose, unquantized live-band swing — pop stays tight to the grid",
      "long DJ-style intro/breakdown with no vocal focus (that reads as pure house/EDM)"
    ],
    "grooveRules": "The pop pocket is tight, quantized, and straight-16th — machine-precise, never loose. The defining move is the BACKBEAT: a layered clap/snap (often 2-3 stacked claps plus a finger-snap and a body-tap) lands hard on beats 2 and 4, usually reinforced by a snare. The kick is punchy and clean (acoustic-modeled, not an 808 boom), anchoring beat 1 with a syncopated pickup into the bar — it is NOT four-on-the-floor by default (that would tip into house/EDM); the four-on-the-floor kick only appears in the dance-pop variant. Closed hats run steady 8ths or busy 16ths for forward motion, with an open_hat accent on the upbeat before the backbeat. Bass is a big, clean synth_bass or sub locked exactly to the kick and lightly sidechain-ducked under it for the classic pop pump. Harmony is a simple, bright, diatonic 4-chord loop (piano and/or pads) that never distracts from the vocal. Everything serves the topline: the lead vocal always sits on top, tuned and polished, doubled and harmony-stacked in the hook so the chorus is audibly thicker than the verse. Arrangement is dynamic and contrast-driven — strip the verse, lift and filter-open the pre-hook, then slam the full hook. A signature pre-hook beat_stop / drum drop-out plus a riser sets up the chorus downbeat, which is marked by a crash + impact. A post-chorus instrumental or vocal-chop hook frequently follows. Feel is straight; at most a very light 16th swing.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "synth_pad",
          "piano",
          "vocal_chop",
          "closed_hat",
          "riser"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "kick",
          "snap",
          "closed_hat",
          "synth_bass",
          "piano",
          "synth_pad"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "double",
          "kick",
          "snare_roll",
          "riser",
          "sweep",
          "synth_pad",
          "beat_stop"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "kick",
          "clap",
          "snare",
          "closed_hat",
          "open_hat",
          "crash",
          "impact",
          "synth_bass",
          "synth_pad",
          "piano",
          "synth_pluck",
          "glockenspiel"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "kick",
          "clap",
          "closed_hat",
          "synth_bass",
          "piano",
          "shaker",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "vocal_pad",
          "piano",
          "synth_pad",
          "string_pad",
          "humming",
          "snare_roll",
          "riser"
        ]
      },
      {
        "section": "final hook",
        "materials": [
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "crowd_chant",
          "choir",
          "kick",
          "clap",
          "snare",
          "open_hat",
          "crash",
          "impact",
          "synth_bass",
          "sub_bass",
          "piano",
          "synth_pad",
          "synth_pluck",
          "glockenspiel",
          "string_pad"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "lead_vocal",
          "humming",
          "piano",
          "synth_pad",
          "vocal_chop",
          "downlifter"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "kick"
    ],
    "qualityChecks": [
      "Lead vocal is the single loudest, most-forward element and sounds tuned/polished",
      "Hard layered clap/snap backbeat clearly on beats 2 and 4",
      "Hook is audibly thicker than the verse — doubles + harmony stacks kick in on the chorus",
      "Clear dynamic arc: stripped verse → lifted/filtered pre-hook → full hook",
      "Riser sweep + crash/impact land exactly on the hook downbeat",
      "A beat_stop / drum drop-out breakdown precedes at least one chorus",
      "Bright synth-pluck or piano topline hook (often a post-chorus instrumental hook)",
      "Bass is big, clean and locked to the kick with a subtle sidechain pump",
      "Groove is tight straight-16th, quantized, with no swing shuffle",
      "Chorus is not four-on-the-floor kick-led unless explicitly dance-pop"
    ],
    "engineTags": [
      "pop",
      "modern radio pop",
      "vocal-forward polished production",
      "layered stacked harmonies",
      "punchy clap-snap backbeat",
      "bright synth-pluck hooks",
      "big anthemic catchy chorus",
      "dance-pop",
      "sidechained clean synth bass"
    ]
  },
  "reggae": {
    "genre": "reggae",
    "displayName": "Reggae (Roots / One-Drop)",
    "origin": "Jamaica, late 1960s — evolved out of ska and rocksteady; carries the roots/dub soundsystem lineage (studio-band riddims, Kingston)",
    "bpmLo": 60,
    "bpmHi": 92,
    "typicalBpm": 75,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "snare",
      "closed_hat",
      "bass_guitar",
      "reggae_skank",
      "organ",
      "lead_vocal"
    ],
    "optionalRoles": [
      "rimshot",
      "open_hat",
      "ride",
      "crash",
      "tom",
      "tom_fill",
      "snare_roll",
      "drum_roll",
      "cowbell",
      "conga",
      "bongo",
      "shaker",
      "maraca",
      "guiro",
      "woodblock",
      "claves",
      "timbales",
      "piano",
      "rhodes",
      "wurlitzer",
      "clavinet",
      "hammond",
      "guitar_chords",
      "clean_guitar_riff",
      "lead_guitar",
      "sax",
      "trumpet",
      "trombone",
      "brass_section",
      "harmonica",
      "flute",
      "harmony_vocal",
      "double",
      "adlib",
      "chant",
      "choir",
      "call_response",
      "crowd_chant",
      "spoken_word",
      "hype_vocal",
      "humming",
      "vocal_pad",
      "tape_hiss",
      "vinyl_noise",
      "reverse_cymbal",
      "transition_fx",
      "beat_stop",
      "drop_fx",
      "crowd_noise"
    ],
    "signatureRoles": [
      "reggae_skank",
      "organ",
      "bass_guitar",
      "rimshot",
      "siren"
    ],
    "forbiddenTraits": [
      "four-on-the-floor house/disco kick (roots reggae leaves beat 1 empty)",
      "trap hi-hat rolls or triplet stutter hats",
      "sliding 808 / bass_808 sub (reggae uses live round bass_guitar, not 808)",
      "reggaeton dembow pattern (boom-ch-boom-chick) — that is reggaeton, not reggae",
      "on-beat downbeat guitar/piano chords instead of the offbeat skank",
      "distorted rock/metal guitars or supersaw EDM leads",
      "tempo above ~95 BPM (drifts into ska or fast dancehall)",
      "straight pop/rock backbeat driven by a kick on beat 1",
      "amapiano log_drum or gqom broken 4/4",
      "rigidly gridded, mechanical feel with no laid-back behind-the-beat pocket"
    ],
    "grooveRules": "One-drop is the law: beat 1 is EMPTY (no kick), and the kick lands together with a cracking rim-shot/snare on beat 3 of the 4/4 bar, giving the signature dropped, half-time feel. Hi-hat keeps steady straight 8ths, occasionally opening on an offbeat. Guitar and a second keyboard play the SKANK — short, muted, staccato chords struck ONLY on the offbeats (the '&' of every beat / upstrokes), never on the downbeat: the 'chik' on the up. The organ plays the 'bubble' — a galloping right-hand offbeat/16th chord percolation that fills the gaps between skanks. Bass is the melodic lead of the low end: deep, round, palm-muted flatwounds, syncopated with deliberate rests, locking to the drum and frequently leaving beat 1 open. Everything sits behind the beat — relaxed, spacious, less-is-more. Variations: 'rockers' and 'steppers' put a kick on all four beats for a driving push, but the default and most identifiable groove is the one-drop. Dub sections strip to bass+drums drenched in spring reverb and tape echo, dropping other parts in and out.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "kick",
          "closed_hat",
          "rimshot",
          "bass_guitar",
          "reggae_skank",
          "organ",
          "siren",
          "tape_hiss"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "snare",
          "closed_hat",
          "bass_guitar",
          "reggae_skank",
          "organ",
          "shaker",
          "lead_vocal",
          "harmony_vocal"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "snare",
          "closed_hat",
          "open_hat",
          "bass_guitar",
          "reggae_skank",
          "organ",
          "conga",
          "brass_section",
          "adlib",
          "lead_vocal",
          "snare_roll"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "snare",
          "closed_hat",
          "open_hat",
          "bass_guitar",
          "reggae_skank",
          "organ",
          "piano",
          "brass_section",
          "lead_vocal",
          "harmony_vocal",
          "double",
          "adlib",
          "shaker",
          "cowbell",
          "crash"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "snare",
          "closed_hat",
          "bass_guitar",
          "reggae_skank",
          "organ",
          "shaker",
          "conga",
          "clean_guitar_riff",
          "lead_vocal",
          "call_response"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "kick",
          "snare",
          "bass_guitar",
          "siren",
          "reverse_cymbal",
          "tape_hiss",
          "transition_fx",
          "sax",
          "spoken_word",
          "beat_stop"
        ]
      },
      {
        "section": "hook_final",
        "materials": [
          "kick",
          "snare",
          "closed_hat",
          "open_hat",
          "bass_guitar",
          "reggae_skank",
          "organ",
          "piano",
          "brass_section",
          "lead_vocal",
          "harmony_vocal",
          "double",
          "adlib",
          "crowd_chant",
          "shaker",
          "cowbell",
          "conga",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "kick",
          "snare",
          "bass_guitar",
          "reggae_skank",
          "organ",
          "siren",
          "tape_hiss",
          "adlib",
          "transition_fx"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal"
    ],
    "qualityChecks": [
      "beat 1 has NO kick; kick and snare/rim land together on beat 3 (audible one-drop)",
      "offbeat skank chops present on every upbeat (guitar/keys 'chik' on the &), never on the downbeat",
      "organ 'bubble' audible — galloping offbeat/16th percolation between the skanks",
      "bass is deep, round, melodic and sits loud/forward in the mix",
      "cross-stick or rim-shot backbeat crack on beat 3 (roots feel)",
      "tempo lands in the 60-92 range with a laid-back, behind-the-beat pocket",
      "spring-reverb / tape-echo dub character on snare and vocals",
      "no four-on-the-floor kick, no trap hats, no dembow, no sliding 808",
      "horns (when present) play tight unison stabs/lines"
    ],
    "engineTags": [
      "reggae",
      "one drop groove",
      "offbeat guitar skank",
      "organ bubble",
      "deep melodic reggae bass",
      "roots reggae",
      "dub echo and spring reverb",
      "live jamaican band",
      "horn section stabs",
      "laid-back 70-80 bpm"
    ]
  },
  "reggaeton": {
    "genre": "reggaeton",
    "displayName": "Reggaeton (Dembow / Perreo)",
    "origin": "Puerto Rico / Panama — Latin urbano. Built on Jamaican dancehall's \"Dem Bow\" riddim (Shabba Ranks, 1990) and Panamanian reggae en español, then codified in 1990s–2000s San Juan (Daddy Yankee, Tego Calderon, Wisin & Yandel, DJ Playero/Luny Tunes) and modernized by Bad Bunny, J Balvin, Karol G.",
    "bpmLo": 85,
    "bpmHi": 100,
    "typicalBpm": 94,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "rimshot",
      "clap",
      "closed_hat",
      "bass_808",
      "synth_pluck",
      "lead_vocal"
    ],
    "optionalRoles": [
      "snare",
      "snap",
      "open_hat",
      "crash",
      "snare_roll",
      "tom_fill",
      "sub_bass",
      "synth_bass",
      "reese_bass",
      "pluck_bass",
      "piano",
      "rhodes",
      "synth_pad",
      "warm_pad",
      "string_pad",
      "choir_pad",
      "synth_lead",
      "bell_lead",
      "marimba",
      "vocal_chop",
      "timbales",
      "conga",
      "bongo",
      "cowbell",
      "guiro",
      "shaker",
      "maraca",
      "cabasa",
      "reggae_skank",
      "trumpet",
      "brass_section",
      "double",
      "harmony_vocal",
      "adlib",
      "chant",
      "crowd_chant",
      "call_response",
      "spoken_word",
      "hype_vocal",
      "riser",
      "downlifter",
      "impact",
      "sweep",
      "siren",
      "vinyl_noise",
      "beat_stop",
      "drop_fx",
      "transition_fx",
      "club_ambience"
    ],
    "signatureRoles": [
      "rimshot",
      "clap",
      "closed_hat",
      "bass_808",
      "guiro"
    ],
    "forbiddenTraits": [
      "four-on-the-floor kick (house/EDM/kwaito) — the reggaeton kick is the syncopated dembow, never a steady 4/4 thump",
      "amapiano log_drum bassline or patient jazzy amapiano build",
      "afrobeats shekere-driven West African groove or talking_drum lead",
      "trap hi-hat rolls / triplet stutter machine-gun hats as the PRIMARY groove with no dembow (Latin trap is a cousin, not reggaeton)",
      "straight rock/pop backbeat with snare only on 2 and 4 and no tresillo syncopation",
      "tempos above ~105 or EDM big-room supersaw drops",
      "boom-bap/jazz swing, or reggae one-drop at slow 70s roots tempo without the dembow drive",
      "guitar-band, country, or folk instrumentation as the core",
      "absence of the dembow riddim (kick + rim/clap 'boom-ch-boom-chick')",
      "steady quarter-note house piano four-on-floor pulse"
    ],
    "grooveRules": "The engine is the DEMBOW — a fixed, unchanging riddim looped every bar, felt at ~90–96 BPM (often programmed double-time near 180). The kick is syncopated, NOT four-on-the-floor: it anchors beat 1 plus a pickup that leans into the tresillo (3+3+2) feel. The backbeat 'crack' is a rimshot/tim layered with a clap (sometimes a snare too) answering the offbeat pickup — the classic 'boom-ch-boom-CHICK.' Closed hats run steady 16ths for forward drive with occasional open-hat accents on the '&'. The 808/sub bass tracks the kick and frequently plays a tresillo/dembow ostinato, welding the low end together. The kit is tightly quantized with only a light laid-back push on the rim — the hypnotic perreo bounce comes from the pattern never changing, not from live fills. Melodic content is a short minor-key loop (dark synth pluck, piano stab, marimba or bell) repeated hypnotically, usually 2–4 chords. Latin percussion (güiro scrape, timbales, congas, cowbell) colors fuller sections. Energy is controlled by adding/removing layers and momentary drum drop-outs, never by changing tempo. Vocals sit forward, Spanish-language, with dense adlib stacks.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "synth_pluck",
          "vinyl_noise",
          "siren",
          "spoken_word",
          "rimshot",
          "closed_hat",
          "riser"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "rimshot",
          "clap",
          "closed_hat",
          "bass_808",
          "synth_pluck",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "rimshot",
          "clap",
          "closed_hat",
          "open_hat",
          "snare_roll",
          "bass_808",
          "synth_pluck",
          "lead_vocal",
          "harmony_vocal",
          "riser",
          "beat_stop"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "rimshot",
          "clap",
          "closed_hat",
          "open_hat",
          "bass_808",
          "synth_pluck",
          "synth_lead",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "guiro",
          "timbales",
          "crash",
          "siren"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "rimshot",
          "clap",
          "closed_hat",
          "bass_808",
          "synth_pluck",
          "lead_vocal",
          "adlib",
          "conga",
          "bongo"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "warm_pad",
          "piano",
          "vocal_pad",
          "lead_vocal",
          "vinyl_noise",
          "downlifter",
          "impact",
          "beat_stop"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "kick",
          "rimshot",
          "clap",
          "closed_hat",
          "open_hat",
          "bass_808",
          "synth_pluck",
          "synth_lead",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "crowd_chant",
          "guiro",
          "timbales",
          "cowbell",
          "crash",
          "siren",
          "drop_fx"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "synth_pluck",
          "vocal_pad",
          "spoken_word",
          "vinyl_noise",
          "club_ambience",
          "beat_stop"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "bass_808",
      "kick",
      "clap",
      "rimshot",
      "closed_hat",
      "synth_pluck",
      "adlib",
      "harmony_vocal",
      "guiro",
      "timbales",
      "synth_pad",
      "siren",
      "club_ambience"
    ],
    "qualityChecks": [
      "dembow riddim present — syncopated kick + rim/clap 'boom-ch-boom-chick' backbeat, NOT four-on-the-floor",
      "steady 16th-note closed hats driving the groove",
      "tresillo (3+3+2) syncopation in the kick and/or 808 bass",
      "deep 808/sub bass locked to the kick",
      "felt tempo 90–96 BPM",
      "rimshot/tim 'tick' audible on the backbeat, layered with clap",
      "short repeating minor-key melodic loop (pluck/piano/bell)",
      "vocal-forward delivery with dense adlibs (Spanish urbano phrasing)",
      "Latin percussion color (güiro scrape / timbales / congas) in fuller sections",
      "hypnotic unchanging loop — energy shifts via layer adds/drops and drum drop-outs, not tempo"
    ],
    "engineTags": [
      "reggaeton",
      "dembow riddim",
      "perreo",
      "808 sub-bass",
      "syncopated kick + rim/clap",
      "16th-note closed hats",
      "Latin urbano",
      "minor-key synth pluck",
      "guiro/timbales percussion",
      "94 BPM"
    ]
  },
  "rnb": {
    "genre": "rnb",
    "displayName": "R&B (Contemporary & Neo-Soul)",
    "origin": "African American, United States. Rooted in 1940s–60s rhythm & blues and soul; codified as \"contemporary R&B\" in the 1980s–90s (Babyface, Jam & Lewis, Jodeci, Mary J. Blige), deepened by 2000s neo-soul (D'Angelo, Erykah Badu, Musiq Soulchild), and reshaped by 2010s+ alternative/trap-influenced R&B (The Weeknd, PARTYNEXTDOOR, Bryson Tiller, SZA, H.E.R.).",
    "bpmLo": 60,
    "bpmHi": 105,
    "typicalBpm": 80,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "soft_kick",
      "snare",
      "clap",
      "closed_hat",
      "sub_bass",
      "rhodes",
      "warm_pad",
      "lead_vocal",
      "double",
      "harmony_vocal",
      "adlib"
    ],
    "optionalRoles": [
      "kick",
      "kick_808",
      "rimshot",
      "snap",
      "open_hat",
      "ride",
      "crash",
      "snare_roll",
      "drum_roll",
      "brushes",
      "trap_hat_roll",
      "tom_fill",
      "bass_808",
      "sliding_808",
      "bass_guitar",
      "fretless_bass",
      "synth_bass",
      "moog_bass",
      "reese_bass",
      "piano",
      "wurlitzer",
      "clavinet",
      "organ",
      "gospel_organ",
      "hammond",
      "synth_pad",
      "choir_pad",
      "string_pad",
      "guitar_chords",
      "clean_guitar_riff",
      "lead_guitar",
      "sax",
      "trumpet",
      "brass_section",
      "strings_line",
      "violin_line",
      "synth_lead",
      "synth_pluck",
      "bell_lead",
      "vocal_chop",
      "flute",
      "vibraphone",
      "glockenspiel",
      "choir",
      "gospel_choir",
      "humming",
      "vocal_pad",
      "call_response",
      "chant",
      "spoken_word",
      "shaker",
      "conga",
      "bongo",
      "vinyl_noise",
      "tape_hiss",
      "riser",
      "reverse_cymbal",
      "downlifter",
      "sweep",
      "impact",
      "transition_fx",
      "beat_stop"
    ],
    "signatureRoles": [
      "rhodes",
      "harmony_vocal",
      "adlib",
      "snap",
      "warm_pad"
    ],
    "forbiddenTraits": [
      "four-on-the-floor kick (house/disco/EDM)",
      "club_kick driving every quarter note",
      "log_drum (that is amapiano, not R&B)",
      "reggaeton/dembow boom-ch-boom-chick groove",
      "afrobeats shekere/talking_drum 16th layers",
      "gqom dark broken 4/4",
      "aggressive distorted rock/metal guitars",
      "fast up-tempo energy above ~110 BPM as the main feel",
      "EDM festival drops and huge risers used as the focal point",
      "robotic hard-quantized pocket with no human laid-back feel",
      "shouty rap-forward delivery replacing sung melody",
      "punk/hardcore intensity"
    ],
    "grooveRules": "Backbeat-driven and vocal-led. Snare/clap/rimshot land firmly on beats 2 and 4 — never four-on-the-floor. The kick is soft and syncopated: it anchors beat 1 with a few pushed or ghosted pickups (the \"and\" of 2, the \"and\" of 3), leaving space rather than driving. Hi-hats ride laid-back straight 8ths or 16ths, often with a touch of shuffle; contemporary/alt-R&B adds tasteful trap-style hat rolls into transitions but keeps them sparse and behind the beat. Neo-soul pockets sit noticeably behind the click (D'Angelo \"drunk\"/lazy feel) with snare ghost notes and finger-snaps; polished contemporary R&B tightens this but still keeps human microtiming. Sub/808 or bass guitar is round and legato, tracing chord roots and the vocal phrasing, sliding between notes. Half-time feel is common at slower tempos. Above all: space, dynamics and the lead vocal matter more than density — the arrangement breathes and drops out under the voice.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "rhodes",
          "warm_pad",
          "vinyl_noise",
          "vocal_pad",
          "humming",
          "soft_kick"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "soft_kick",
          "snap",
          "clap",
          "closed_hat",
          "sub_bass",
          "rhodes",
          "warm_pad",
          "lead_vocal",
          "double"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "soft_kick",
          "clap",
          "closed_hat",
          "open_hat",
          "sub_bass",
          "rhodes",
          "warm_pad",
          "string_pad",
          "harmony_vocal",
          "snare_roll",
          "riser",
          "lead_vocal"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "soft_kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "sub_bass",
          "bass_808",
          "rhodes",
          "warm_pad",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "soft_kick",
          "snap",
          "closed_hat",
          "trap_hat_roll",
          "sub_bass",
          "rhodes",
          "warm_pad",
          "lead_vocal",
          "double",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "rhodes",
          "piano",
          "choir_pad",
          "gospel_choir",
          "string_pad",
          "lead_vocal",
          "harmony_vocal",
          "humming",
          "reverse_cymbal"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "sub_bass",
          "bass_808",
          "rhodes",
          "warm_pad",
          "strings_line",
          "gospel_choir",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "rhodes",
          "warm_pad",
          "vocal_pad",
          "humming",
          "adlib",
          "vinyl_noise",
          "tape_hiss"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "sub_bass",
      "soft_kick",
      "snare",
      "clap",
      "harmony_vocal",
      "adlib",
      "rhodes",
      "closed_hat",
      "warm_pad",
      "string_pad",
      "vinyl_noise"
    ],
    "qualityChecks": [
      "lead_vocal sits on top, intimate and present, clearly the focal element",
      "backbeat on beats 2 and 4 via snap/clap/snare — NOT four-on-the-floor",
      "rhodes or electric-piano chords form the audible harmonic bed",
      "stacked harmony_vocal audible under/around the lead in the hook",
      "adlibs answering and echoing the lead vocal",
      "round warm sub/808 or bass-guitar low end, legato with slides",
      "laid-back behind-the-beat pocket with audible space between hits",
      "warm_pad atmosphere sustaining under the track",
      "tempo lands 60–105 BPM with a half-time feel, never fast/driving",
      "hi-hats are laid-back 8th/16th; at most tasteful trap rolls, never a busy EDM/afrobeats layer"
    ],
    "engineTags": [
      "rnb",
      "contemporary rnb",
      "smooth rnb",
      "neo-soul",
      "rhodes electric piano",
      "laid-back backbeat",
      "808 sub bass",
      "stacked vocal harmonies",
      "sultry lead vocal",
      "warm atmospheric pads"
    ]
  },
  "rock": {
    "genre": "rock",
    "displayName": "Rock",
    "origin": "United States / United Kingdom, mid-1950s-60s — evolved from blues, rhythm & blues, country and rock 'n' roll into a guitar-bass-drums-vocal band format",
    "bpmLo": 88,
    "bpmHi": 168,
    "typicalBpm": 124,
    "swing": "straight",
    "fourOnFloor": false,
    "requiredRoles": [
      "live_kick",
      "snare",
      "closed_hat",
      "open_hat",
      "ride",
      "crash",
      "tom_fill",
      "bass_guitar",
      "guitar_chords",
      "lead_guitar",
      "lead_vocal"
    ],
    "optionalRoles": [
      "kick",
      "rimshot",
      "clap",
      "tom",
      "snare_roll",
      "drum_roll",
      "brushes",
      "clean_guitar_riff",
      "cowbell",
      "conga",
      "shaker",
      "slap_bass",
      "upright_bass",
      "synth_bass",
      "organ_bass",
      "organ",
      "hammond",
      "gospel_organ",
      "piano",
      "upright_piano",
      "rhodes",
      "wurlitzer",
      "clavinet",
      "synth_pad",
      "warm_pad",
      "string_pad",
      "choir_pad",
      "harmonica",
      "sax",
      "brass_section",
      "strings_line",
      "violin_line",
      "pedal_steel",
      "mandolin",
      "banjo",
      "fiddle",
      "synth_lead",
      "double",
      "harmony_vocal",
      "adlib",
      "chant",
      "choir",
      "gospel_choir",
      "crowd_chant",
      "call_response",
      "hype_vocal",
      "spoken_word",
      "humming",
      "vocal_pad",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "crowd_noise",
      "transition_fx",
      "beat_stop",
      "drop_fx",
      "tape_hiss",
      "vinyl_noise"
    ],
    "signatureRoles": [
      "guitar_chords",
      "lead_guitar",
      "snare",
      "bass_guitar",
      "live_kick"
    ],
    "forbiddenTraits": [
      "four-on-the-floor house/disco kick as the main groove",
      "808 sub-bass or sliding 808s",
      "trap hi-hat rolls / triplet hat stutters",
      "log_drum or amapiano/afrobeats percussion beds",
      "reggae one-drop skank as the core groove",
      "reggaeton dembow pattern",
      "programmed/quantized drum-machine feel replacing a live kit",
      "synth_lead as the primary hook (synthwave/EDM)",
      "heavy autotune or rap-sung lead vocal",
      "vocal chops as the lead melody"
    ],
    "grooveRules": "Backbeat-driven and human, never grid-locked. The snare cracks hard on beats 2 and 4 — the backbeat that defines rock — while the kick anchors beat 1 and throws syncopated pushes on the '&' of 2 and 3 to lock with the palm-muted rhythm guitar. Hi-hats drive steady straight eighths (sixteenths in busier passages), opening on the up-beat for lift; the ride swaps in for the hats to add weight in choruses and heavier sections. Crashes accent the downbeat of every new section. Bass guitar shadows the kick's root motion to glue the low end, and the distorted rhythm guitar (power chords / palm mutes) is welded to the kick pattern. The lead guitar answers vocal phrases and takes the solo in the bridge. Dynamics are the whole engine: verses pull back (cleaner or tighter guitar, closed hats), the pre-chorus loads tension (toms, open hats, snare/drum roll, riser), and the chorus explodes into full distortion, crash-ride wash and doubled vocals. Keep a live, slightly-ahead human push and let cymbals ring — never quantize to a perfect grid. Tom fills and snare rolls telegraph every transition at the 4- and 8-bar phrase ends.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "clean_guitar_riff",
          "lead_guitar",
          "live_kick",
          "closed_hat",
          "bass_guitar",
          "crash",
          "tom_fill",
          "crowd_noise"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "clean_guitar_riff",
          "guitar_chords",
          "bass_guitar",
          "live_kick",
          "snare",
          "closed_hat",
          "organ"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "double",
          "harmony_vocal",
          "guitar_chords",
          "bass_guitar",
          "live_kick",
          "snare",
          "open_hat",
          "ride",
          "tom",
          "snare_roll",
          "drum_roll",
          "riser"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "double",
          "harmony_vocal",
          "guitar_chords",
          "lead_guitar",
          "bass_guitar",
          "live_kick",
          "snare",
          "crash",
          "ride",
          "open_hat",
          "tom_fill",
          "string_pad",
          "crowd_chant",
          "impact"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "guitar_chords",
          "clean_guitar_riff",
          "bass_guitar",
          "live_kick",
          "snare",
          "closed_hat",
          "organ",
          "cowbell"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "lead_guitar",
          "bass_guitar",
          "live_kick",
          "snare",
          "ride",
          "tom_fill",
          "harmony_vocal",
          "choir",
          "organ",
          "beat_stop"
        ]
      },
      {
        "section": "final hook",
        "materials": [
          "lead_vocal",
          "double",
          "harmony_vocal",
          "choir",
          "guitar_chords",
          "lead_guitar",
          "bass_guitar",
          "live_kick",
          "snare",
          "crash",
          "ride",
          "open_hat",
          "tom_fill",
          "string_pad",
          "crowd_chant",
          "impact"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "clean_guitar_riff",
          "lead_guitar",
          "guitar_chords",
          "bass_guitar",
          "live_kick",
          "crash",
          "ride",
          "crowd_noise",
          "tape_hiss"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [
      "lead_vocal",
      "snare",
      "guitar_chords",
      "live_kick",
      "bass_guitar",
      "lead_guitar",
      "double",
      "harmony_vocal",
      "closed_hat",
      "ride",
      "crash",
      "organ",
      "string_pad",
      "crowd_noise"
    ],
    "qualityChecks": [
      "distorted power-chord rhythm guitar present",
      "snare backbeat lands on beats 2 and 4",
      "live acoustic drum kit sound (not programmed / no 808)",
      "electric bass guitar locking with the kick",
      "lead guitar riff or solo present (bridge solo)",
      "cymbal crash on each section downbeat",
      "audible dynamic lift verse -> chorus (guitars open up)",
      "human, slightly-loose timing feel (not perfectly quantized)",
      "doubled / harmony vocals in the chorus",
      "no 808, trap-hat, log-drum or dembow elements"
    ],
    "engineTags": [
      "rock",
      "electric guitar-driven",
      "distorted power chords",
      "live drum kit backbeat",
      "electric bass guitar",
      "lead guitar solo",
      "anthemic chorus",
      "raw band energy",
      "straight-eighth drive"
    ]
  },
  "soukous": {
    "genre": "soukous",
    "displayName": "Soukous (Congolese Rumba / Sebene)",
    "origin": "Democratic Republic of Congo & Congo-Brazzaville (Central Africa). Grew out of Congolese rumba — itself built on Cuban son/rumba records imported in the 1940s–50s — then accelerated in the 1970s–90s into the fast, guitar-led dance form (sebene / kwassa kwassa / later ndombolo). Lineage: Franco/TPOK Jazz and Grand Kalle (rumba), Zaiko Langa Langa (cavacha + youth soukous), Kanda Bongo Man, Diblo Dibala, Pepe Kalle, Papa Wemba, Koffi Olomide.",
    "bpmLo": 120,
    "bpmHi": 168,
    "typicalBpm": 148,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "lead_guitar",
      "highlife_guitar",
      "clean_guitar_riff",
      "bass_guitar",
      "kick",
      "snare",
      "rimshot",
      "closed_hat",
      "snare_roll",
      "conga",
      "lead_vocal",
      "harmony_vocal",
      "call_response",
      "adlib"
    ],
    "optionalRoles": [
      "live_kick",
      "open_hat",
      "ride",
      "crash",
      "tom",
      "tom_fill",
      "cowbell",
      "agogo",
      "maraca",
      "shaker",
      "claves",
      "woodblock",
      "bongo",
      "timbales",
      "guiro",
      "sax",
      "trumpet",
      "trombone",
      "brass_section",
      "organ",
      "rhodes",
      "guitar_chords",
      "double",
      "chant",
      "crowd_chant",
      "hype_vocal",
      "choir",
      "humming",
      "spoken_word",
      "crowd_noise"
    ],
    "signatureRoles": [
      "lead_guitar",
      "highlife_guitar",
      "snare",
      "bass_guitar",
      "call_response"
    ],
    "forbiddenTraits": [
      "log_drum (that is amapiano, wrong region and wrong groove)",
      "808 / sliding_808 / bass_808 / sub_bass as the low end (bass must be a live melodic electric bass_guitar)",
      "four-on-the-floor house/kwaito kick",
      "trap or drill hi-hat rolls / triplet hat programming",
      "reggaeton or dembow bounce",
      "West-African talking_drum / dundun / sakara / shekere as the lead percussion (that is afrobeats/highlife-Nigeria territory)",
      "distorted, overdriven or crunchy rock guitar tone (soukous guitars are clean, bright, trebly and single-note)",
      "a single strummed acoustic/palmwine guitar carrying the song (soukous needs multiple interlocking clean electric guitars)",
      "sparse, minimal, spacey arrangement (soukous is dense, busy and virtuosic)",
      "heavily auto-tuned / EDM-drop / synth-lead led production",
      "stiff hyper-quantized grid feel with no live-band lilt",
      "slow ballad tempo with no sebene climax"
    ],
    "grooveRules": "The engine is the CAVACHA: a continuous, fast rolling snare — much of it played on the rim/rimshot as a shuffling roll — locked to busy driving hi-hats. It is rolling forward motion, NOT a four-on-the-floor kick; the kick sits underneath playing syncopated accents, never on every beat. Over that, guitars interlock in three tiers: a rhythm guitar (highlife_guitar) cycles a bright, clean, repeating arpeggiated/chordal figure; a mi-solo (clean_guitar_riff) weaves a middle counter-line a step behind it; and the solo/lead guitar (lead_guitar) fires fast, clean, high-register single-note cascades — this is what explodes in the sebene. The electric bass_guitar is melodic and constantly moving, answering the guitars and vocals rather than just holding roots. Congas plus cowbell/agogo and maracas carry the Latin-derived layer inherited from Congolese rumba, with an underlying clave feel. Vocals are sweet, tightly interlocked 2–3 part Lingala harmonies with heavy call-and-response; an animateur/atalaku drives the sebene with shouted adlibs and dance chants. Every part is cyclic and interlocking — a lattice of short repeating loops — and the arrangement grows from a smoother, sung rumba opening into an extended, guitar-and-percussion-led dance sebene.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "highlife_guitar",
          "guitar_chords",
          "bass_guitar",
          "conga",
          "maraca",
          "closed_hat",
          "humming",
          "lead_vocal"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "highlife_guitar",
          "bass_guitar",
          "kick",
          "snare",
          "rimshot",
          "closed_hat",
          "conga"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "clean_guitar_riff",
          "highlife_guitar",
          "bass_guitar",
          "snare",
          "snare_roll",
          "open_hat",
          "cowbell",
          "conga"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "double",
          "lead_guitar",
          "highlife_guitar",
          "clean_guitar_riff",
          "bass_guitar",
          "kick",
          "snare",
          "rimshot",
          "closed_hat",
          "open_hat",
          "crash",
          "conga",
          "cowbell"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "lead_guitar",
          "clean_guitar_riff",
          "highlife_guitar",
          "bass_guitar",
          "snare",
          "closed_hat",
          "rimshot",
          "snare_roll",
          "conga",
          "cowbell",
          "maraca",
          "tom_fill",
          "adlib",
          "chant",
          "call_response",
          "crowd_chant"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "highlife_guitar",
          "clean_guitar_riff",
          "bass_guitar",
          "kick",
          "snare",
          "rimshot",
          "closed_hat",
          "conga"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "double",
          "lead_guitar",
          "highlife_guitar",
          "clean_guitar_riff",
          "bass_guitar",
          "kick",
          "snare",
          "closed_hat",
          "open_hat",
          "crash",
          "conga",
          "cowbell",
          "brass_section",
          "adlib",
          "call_response",
          "crowd_chant"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "lead_guitar",
          "highlife_guitar",
          "bass_guitar",
          "conga",
          "cowbell",
          "closed_hat",
          "adlib"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [
      "lead_guitar",
      "lead_vocal",
      "harmony_vocal",
      "bass_guitar",
      "snare",
      "highlife_guitar",
      "clean_guitar_riff",
      "conga",
      "closed_hat",
      "kick",
      "cowbell",
      "adlib",
      "brass_section"
    ],
    "qualityChecks": [
      "Fast, bright, CLEAN single-note lead guitar cascades are present (the sebene) — not distorted, not chordal strumming",
      "At least two interlocking clean electric guitars audible at once (rhythm + mi-solo/lead), not one guitar",
      "Rolling cavacha snare/rim + busy hi-hat motion drives the groove; NO four-on-the-floor kick",
      "Low end is a melodic, moving electric bass_guitar — no 808/sub-bass synth low end",
      "Congas (and a bell/maraca layer) present, giving the rumba-Latin percussion feel",
      "Sweet 2–3 part interlocked vocal harmonies plus call-and-response animateur adlibs/chants",
      "A clear build from a sung rumba-style opening into an extended instrumental sebene climax",
      "Tempo lands roughly 130–160 BPM with a live-band lilt, not machine-stiff",
      "No log_drum, no trap/drill hats, no talking_drum-led afrobeats percussion"
    ],
    "engineTags": [
      "soukous",
      "congolese rumba",
      "fast sebene lead guitar",
      "cavacha rolling snare groove",
      "interlocking clean electric guitars",
      "melodic electric bass",
      "lingala vocal harmonies",
      "congas cowbell percussion",
      "call-and-response animateur",
      "kwassa kwassa dance band"
    ]
  },
  "soul": {
    "genre": "soul",
    "displayName": "Soul",
    "origin": "African-American, USA (1960s–70s): Motown (Detroit), Stax/Memphis & Muscle Shoals (Southern soul), Atlantic, and Philadelphia soul — a live-band fusion of gospel, R&B and pop. Voice-led, horn-and-organ driven, played by tight rhythm sections (Funk Brothers, Booker T. & the M.G.'s, MFSB).",
    "bpmLo": 60,
    "bpmHi": 130,
    "typicalBpm": 100,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "live_kick",
      "snare",
      "closed_hat",
      "bass_guitar",
      "rhodes",
      "hammond",
      "brass_section",
      "lead_vocal",
      "harmony_vocal"
    ],
    "optionalRoles": [
      "piano",
      "upright_piano",
      "wurlitzer",
      "clavinet",
      "organ",
      "gospel_organ",
      "guitar_chords",
      "clean_guitar_riff",
      "lead_guitar",
      "strings_line",
      "string_pad",
      "violin_line",
      "sax",
      "trumpet",
      "trombone",
      "vibraphone",
      "glockenspiel",
      "chimes",
      "conga",
      "bongo",
      "shaker",
      "cabasa",
      "clap",
      "snap",
      "rimshot",
      "ride",
      "open_hat",
      "crash",
      "tom_fill",
      "snare_roll",
      "drum_roll",
      "upright_bass",
      "gospel_choir",
      "choir",
      "adlib",
      "double",
      "humming",
      "vocal_pad",
      "chant",
      "spoken_word",
      "vinyl_noise",
      "tape_hiss",
      "reverse_cymbal",
      "sweep"
    ],
    "signatureRoles": [
      "bass_guitar",
      "hammond",
      "brass_section",
      "call_response",
      "rhodes"
    ],
    "forbiddenTraits": [
      "log_drum (amapiano signature)",
      "bass_808 / sliding_808 / static sub_bass as the bassline — kills the live melodic bass",
      "trap_hat_roll / drill_hat_slide / hi-hat triplet rolls",
      "four-on-the-floor disco/house kick (soul is backbeat, not on-the-floor)",
      "reggaeton dembow",
      "talking_drum, shekere 16ths, or amapiano/afrobeats percussion patterns",
      "supersaw/EDM synth leads, EDM drops, riser-as-hook",
      "vocal_chop or heavy autotune used as the lead line",
      "rigidly quantized, gridlocked timing — soul must breathe and lay back",
      "distorted metal/rock guitars, downtuned riffs"
    ],
    "grooveRules": "Backbeat-driven, NOT four-on-the-floor: the snare cracks hard on beats 2 and 4 (often reinforced by a handclap/tambourine-style accent on the backbeat) while the live kick plays a syncopated, conversational pattern that interlocks with a melodic electric bass (Jamerson / Duck Dunn school). The bass MOVES — walking, sliding and answering the vocal rather than holding a static root. The whole pocket sits slightly behind the beat (laid-back Southern-soul feel) with light, human swing; nothing is gridlocked. Rhodes/Wurlitzer and piano comp warm chords while a Hammond organ lays sustained pads and answers with gospel drawbar runs. A horn section (sax/trumpet/trombone) punctuates with tight unison stabs on off-beats and rising swells into sections. Backing vocals operate in gospel call-and-response and stacked thirds/sixths behind the lead, with ad-libs and melisma. Slow ballads shift to a 12/8 triplet 'church' feel. Dynamics grow verse to hook, and the final chorus commonly modulates up a step or semitone — the classic soul key-change lift.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "rhodes",
          "hammond",
          "bass_guitar",
          "live_kick",
          "closed_hat",
          "humming"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "lead_vocal",
          "live_kick",
          "snare",
          "closed_hat",
          "bass_guitar",
          "rhodes",
          "clean_guitar_riff",
          "hammond"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "live_kick",
          "snare",
          "closed_hat",
          "bass_guitar",
          "rhodes",
          "hammond",
          "brass_section",
          "clap",
          "snare_roll"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "lead_vocal",
          "harmony_vocal",
          "call_response",
          "adlib",
          "brass_section",
          "hammond",
          "rhodes",
          "bass_guitar",
          "live_kick",
          "snare",
          "closed_hat",
          "open_hat",
          "clap",
          "strings_line",
          "crash"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "lead_vocal",
          "live_kick",
          "snare",
          "closed_hat",
          "bass_guitar",
          "rhodes",
          "clavinet",
          "guitar_chords",
          "hammond",
          "harmony_vocal"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "sax",
          "hammond",
          "gospel_choir",
          "adlib",
          "bass_guitar",
          "live_kick",
          "snare",
          "rhodes",
          "brass_section"
        ]
      },
      {
        "section": "final-hook",
        "materials": [
          "lead_vocal",
          "gospel_choir",
          "call_response",
          "adlib",
          "brass_section",
          "strings_line",
          "hammond",
          "rhodes",
          "bass_guitar",
          "live_kick",
          "snare",
          "closed_hat",
          "open_hat",
          "clap",
          "tom_fill",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "adlib",
          "call_response",
          "hammond",
          "bass_guitar",
          "live_kick",
          "snare",
          "closed_hat",
          "brass_section",
          "vinyl_noise"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "snare",
      "bass_guitar",
      "live_kick",
      "brass_section",
      "harmony_vocal",
      "hammond",
      "rhodes",
      "closed_hat",
      "strings_line",
      "shaker",
      "vinyl_noise"
    ],
    "qualityChecks": [
      "snare backbeat squarely on 2 and 4 with live/acoustic kit timbre — no 808 or trap kit",
      "melodic, moving electric bass_guitar line that walks and answers the vocal, not a static sub/808 root",
      "Hammond/tonewheel organ audible with drawbar and gospel-run character",
      "horn section stabs and swells present (sax/trumpet/trombone unisons)",
      "gospel call-and-response or stacked harmony backing vocals behind the lead",
      "warm Rhodes/Wurlitzer or piano comping in the harmony bed",
      "laid-back, human pocket — timing sits slightly behind the beat, not gridlocked",
      "no log_drum, no trap hi-hat rolls, no four-on-the-floor house kick",
      "final-chorus lift / key-change modulation on the last hook"
    ],
    "engineTags": [
      "soul",
      "vintage soul",
      "Motown Stax",
      "live band soul",
      "horn section stabs",
      "Hammond organ",
      "gospel call-and-response",
      "melodic electric bass",
      "warm analog",
      "backbeat groove"
    ]
  },
  "street_pop": {
    "genre": "street_pop",
    "displayName": "Street-Pop (Nigerian Street-Hop / Zanku)",
    "origin": "Lagos, Nigeria — the raw street-level offshoot of afrobeats that erupted from Agege/Shitta out of the Shaku Shaku and Zanku (Zlatan, Naira Marley/Marlian) dance movements circa 2017–2019, later widened by Asake's amapiano-fused street-gospel and artists like Portable, Seyi Vibez, Mohbad and Bella Shmurda. Fast, rowdy, chant-driven, log-drum-and-shaker-heavy pidgin party music grown from Ajegunle galala/konto roots.",
    "bpmLo": 100,
    "bpmHi": 118,
    "typicalBpm": 107,
    "swing": "moderate",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "snare",
      "clap",
      "shaker",
      "closed_hat",
      "open_hat",
      "rimshot",
      "log_drum",
      "synth_bass",
      "lead_vocal",
      "adlib",
      "chant"
    ],
    "optionalRoles": [
      "bass_808",
      "sliding_808",
      "soft_kick",
      "conga",
      "bongo",
      "talking_drum",
      "shekere",
      "agogo",
      "cowbell",
      "woodblock",
      "piano",
      "rhodes",
      "organ",
      "gospel_organ",
      "synth_pad",
      "warm_pad",
      "highlife_guitar",
      "guitar_chords",
      "synth_pluck",
      "bell_lead",
      "synth_lead",
      "flute",
      "sax",
      "brass_section",
      "vocal_chop",
      "double",
      "harmony_vocal",
      "call_response",
      "crowd_chant",
      "gospel_choir",
      "hype_vocal",
      "spoken_word",
      "snare_roll",
      "crash",
      "vinyl_noise",
      "siren",
      "street_ambience",
      "crowd_noise",
      "riser",
      "impact",
      "beat_stop",
      "transition_fx"
    ],
    "signatureRoles": [
      "log_drum",
      "shaker",
      "chant",
      "adlib",
      "rimshot"
    ],
    "forbiddenTraits": [
      "four-on-the-floor house/amapiano-jazz-lounge kick pattern (street-pop is rowdier and more syncopated than pure amapiano)",
      "clean polished R&B/alte crooning as the lead delivery — street-pop is chant/rap-sung pidgin, rough and rowdy",
      "US trap triplet hi-hat rolls dominating the groove (occasional, not the engine)",
      "reggaeton dembTo/dembow boom-ch-boom-chick pattern",
      "slow 70–95 BPM amapiano patience — street-pop pushes harder and faster",
      "EDM supersaw drops or festival builds",
      "drill sliding 808 as the central bass identity (drill hats/slides belong to drill, not street-pop)",
      "lush orchestral/cinematic strings as the lead texture",
      "over-quantized sterile pop grid with no human shaker swing",
      "Jamaican dancehall riddim one-drop skank as the backbone"
    ],
    "grooveRules": "Mid-tempo (100–118, usually ~105–110) in 4/4 with a rowdy, danceable street bounce, NOT four-on-the-floor. The kick is syncopated: a downbeat anchor plus pushed/ghosted hits that dodge the snare, leaving space for the log_drum to answer. The snare/clap lands hard on beat 2 and 4 (backbeat) — often a rimshot doubling or replacing the snare for that dry Zanku crack. The engine of the pocket is the shaker/shekere running busy 16th-note swung motion (moderate swing, ~55–58%) sitting slightly ahead — this is the constant that makes bodies move. The log_drum plays a melodic, percussive bass-melody counter-line (amapiano DNA absorbed into street-pop), bouncing between the kick hits rather than locking to them. Bass is either a rounded synth_bass/808 following the vocal cadence or the log_drum IS the bass. Rimshot, woodblock, agogo and cowbell add call-and-response accents. Everything breathes around the vocal: the beat frequently drops out (beat_stop) so a chant or adlib carries a bar, then slams back. Percussion is layered and interlocking (afrobeats heritage) but grittier and more repetitive/hypnotic than mainstream afropop — a 2-bar loop that hammers. Adlibs (gbas gbos, \"ay\", pauses, gang chants) are rhythmic instruments, not garnish.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "chant",
          "shaker",
          "vinyl_noise",
          "street_ambience",
          "log_drum",
          "adlib",
          "rimshot"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "rimshot",
          "shaker",
          "closed_hat",
          "log_drum",
          "synth_bass",
          "lead_vocal",
          "adlib",
          "woodblock"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "clap",
          "shaker",
          "open_hat",
          "log_drum",
          "synth_bass",
          "lead_vocal",
          "call_response",
          "snare_roll",
          "riser"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "shaker",
          "shekere",
          "closed_hat",
          "open_hat",
          "log_drum",
          "synth_bass",
          "chant",
          "lead_vocal",
          "double",
          "adlib",
          "crowd_chant",
          "agogo",
          "cowbell",
          "piano"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "rimshot",
          "shaker",
          "closed_hat",
          "log_drum",
          "synth_bass",
          "lead_vocal",
          "adlib",
          "conga",
          "talking_drum",
          "beat_stop"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "chant",
          "gospel_organ",
          "shaker",
          "log_drum",
          "call_response",
          "adlib",
          "gospel_choir",
          "beat_stop",
          "impact"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "kick",
          "snare",
          "clap",
          "shaker",
          "shekere",
          "closed_hat",
          "open_hat",
          "log_drum",
          "synth_bass",
          "chant",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "crowd_chant",
          "agogo",
          "cowbell",
          "piano",
          "brass_section",
          "crash"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "chant",
          "adlib",
          "shaker",
          "log_drum",
          "street_ambience",
          "vinyl_noise",
          "spoken_word"
        ]
      }
    ],
    "fillCadenceBars": 4,
    "mixPriorities": [
      "lead_vocal",
      "shaker",
      "log_drum",
      "kick",
      "synth_bass"
    ],
    "qualityChecks": [
      "log_drum present as a melodic percussive bass counter-line (bouncing, not locked to kick)",
      "busy swung 16th shaker/shekere motion audible as the groove engine",
      "kick is syncopated NOT four-on-the-floor",
      "hard backbeat snare/clap on 2 and 4, often a dry rimshot crack",
      "moderate swing (~55-58%) — not a stiff straight grid",
      "chant + rhythmic pidgin adlibs functioning as percussion (gang-vocal feel)",
      "at least one beat_stop / drop-out where a chant or adlib carries a bar",
      "tempo sits ~100-118 BPM (street bounce, not slow amapiano patience)",
      "gritty rowdy street energy, not clean polished R&B/alte croon",
      "interlocking secondary percussion (rimshot/woodblock/agogo/conga) call-and-response accents"
    ],
    "engineTags": [
      "Nigerian street-pop",
      "Zanku street-hop",
      "log drum bounce",
      "swung shaker 16ths",
      "gang chant adlibs",
      "syncopated kick backbeat",
      "Lagos street afrobeats",
      "pidgin rowdy party",
      "rimshot crack",
      "amapiano-fused street"
    ]
  },
  "trap": {
    "genre": "trap",
    "displayName": "Trap",
    "origin": "Southern United States — Atlanta, Georgia (late 1990s–2000s). Pioneered by Shawty Redd, DJ Toomp and Lex Luger, then codified by Metro Boomin, Zaytoven, Southside/808 Mafia and TM88. Named for the \"trap\" (drug-dealing house); built on booming 808 sub-bass, half-time drums and stuttered hi-hat rolls.",
    "bpmLo": 130,
    "bpmHi": 170,
    "typicalBpm": 140,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": [
      "kick",
      "bass_808",
      "sliding_808",
      "snare",
      "clap",
      "closed_hat",
      "open_hat",
      "trap_hat_roll",
      "snare_roll",
      "lead_vocal",
      "adlib"
    ],
    "optionalRoles": [
      "kick_808",
      "rimshot",
      "snap",
      "ride",
      "crash",
      "tom_fill",
      "drum_roll",
      "sub_bass",
      "synth_bass",
      "piano",
      "synth_pad",
      "warm_pad",
      "choir_pad",
      "string_pad",
      "bell_lead",
      "synth_pluck",
      "synth_lead",
      "flute",
      "mallet_lead",
      "vocal_chop",
      "strings_line",
      "violin_line",
      "glockenspiel",
      "vibraphone",
      "double",
      "harmony_vocal",
      "hype_vocal",
      "chant",
      "vocal_pad",
      "riser",
      "downlifter",
      "impact",
      "reverse_cymbal",
      "sweep",
      "vinyl_noise",
      "siren",
      "beat_stop",
      "drop_fx",
      "transition_fx"
    ],
    "signatureRoles": [
      "bass_808",
      "sliding_808",
      "trap_hat_roll",
      "adlib",
      "snare_roll"
    ],
    "forbiddenTraits": [
      "four-on-the-floor kick (house/EDM/amapiano — trap kick is syncopated and half-time)",
      "log_drum bassline (that is amapiano, not trap)",
      "drill_hat_slide / gliding drill hi-hats and drill's syncopated skippy kick (that is UK/Brooklyn drill)",
      "dembow / reggaeton bounce",
      "shekere or talking_drum-led syncopation with melodic bass_guitar (that is afrobeats)",
      "interlocking highlife_guitar live-band groove",
      "whole-groove triplet swing or shuffle (base grid stays straight; only the hats ratchet)",
      "bright major-key upbeat topline (trap is dark/minor and ominous)",
      "acoustic live drum kit or brushes",
      "real bass guitar / upright walking bass as the low end (the 808 must be the sub)",
      "full-tempo boom-bap backbeat (trap is half-time, snare on beat 3)"
    ],
    "grooveRules": "Half-time feel is the law: notate ~140 BPM but the pocket reads ~70. The snare or clap lands on beat 3 of the bar (the backbeat) — never four-on-the-floor. The kick is syncopated and tuned/locked to the 808; the 808 IS the bassline, sustaining and gliding (portamento) between the root notes of a dark minor melody, saturated/distorted so it translates on phone speakers. Hi-hats run straight 16ths as the base but are ornamented with the signature stuttered rolls — bursts of 1/32, 1/16-triplets and accelerating ratchets with pitch and velocity variation; open hats accent the off-beats. Arrangement is sparse and spacious: a short looping motif (bell, pluck or flute) over 808 and drums, leaving room for the lead vocal and adlibs. Snare rolls (16th→32nd acceleration) build tension over the last 1–2 bars into drops and hooks, usually preceded by a beat-stop. Everything is grid-locked and quantized; groove comes from the 808 glide and hat programming, not from swung timing.",
    "sectionMap": [
      {
        "section": "intro",
        "materials": [
          "bell_lead",
          "synth_pluck",
          "synth_pad",
          "vinyl_noise",
          "riser",
          "closed_hat"
        ]
      },
      {
        "section": "verse",
        "materials": [
          "kick",
          "bass_808",
          "sliding_808",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "trap_hat_roll",
          "bell_lead",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "pre-hook",
        "materials": [
          "kick",
          "bass_808",
          "snare_roll",
          "trap_hat_roll",
          "riser",
          "lead_vocal",
          "adlib",
          "impact",
          "beat_stop"
        ]
      },
      {
        "section": "hook",
        "materials": [
          "kick",
          "kick_808",
          "bass_808",
          "sliding_808",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "trap_hat_roll",
          "crash",
          "bell_lead",
          "synth_lead",
          "lead_vocal",
          "double",
          "adlib",
          "hype_vocal"
        ]
      },
      {
        "section": "verse2",
        "materials": [
          "kick",
          "bass_808",
          "sliding_808",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "trap_hat_roll",
          "bell_lead",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "bridge",
        "materials": [
          "synth_pad",
          "choir_pad",
          "bell_lead",
          "sliding_808",
          "snare_roll",
          "transition_fx",
          "downlifter",
          "lead_vocal",
          "adlib"
        ]
      },
      {
        "section": "final_hook",
        "materials": [
          "kick",
          "kick_808",
          "bass_808",
          "sliding_808",
          "snare",
          "clap",
          "closed_hat",
          "open_hat",
          "trap_hat_roll",
          "crash",
          "bell_lead",
          "synth_lead",
          "lead_vocal",
          "double",
          "harmony_vocal",
          "adlib",
          "hype_vocal",
          "impact"
        ]
      },
      {
        "section": "outro",
        "materials": [
          "bell_lead",
          "synth_pad",
          "vinyl_noise",
          "sliding_808",
          "closed_hat",
          "adlib"
        ]
      }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": [
      "lead_vocal",
      "kick"
    ],
    "qualityChecks": [
      "808 sub-bass is present and audibly glides/slides (portamento) between notes",
      "half-time backbeat: snare/clap on beat 3, NOT four-on-the-floor",
      "stuttered hi-hat rolls (triplet/32nd ratchets) clearly audible over straight 16th hats",
      "kick is syncopated and tuned/locked to the 808",
      "dark, minor/ominous tonality",
      "sparse arrangement with obvious space around vocal",
      "adlibs layered/panned around the lead vocal",
      "snare roll build with a beat-stop before the hook drop",
      "no live acoustic drums, no real bass guitar low end",
      "notated tempo ~130–160 with a ~65–80 half-time feel"
    ],
    "engineTags": [
      "trap",
      "sliding 808 sub-bass",
      "triplet hi-hat rolls",
      "half-time trap drums",
      "dark minor melody",
      "atlanta hip-hop",
      "rap adlibs",
      "sparse hard-hitting beat",
      "autotune rap vocal"
    ]
  },
  "worship": {
    "genre": "worship",
    "displayName": "Worship (Contemporary/African)",
    "origin": "Church worship — contemporary Christian and African gospel worship: slow, reverent, building from intimacy to a lifted congregation.",
    "bpmLo": 62, "bpmHi": 82, "typicalBpm": 72,
    "swing": "straight",
    "fourOnFloor": false,
    "requiredRoles": ["piano", "gospel_organ", "warm_pad", "choir_pad", "soft_kick", "snare", "closed_hat", "bass_guitar", "lead_vocal", "choir"],
    "optionalRoles": ["rhodes", "string_pad", "strings_line", "clean_guitar_riff", "lead_guitar", "shaker", "tom", "crash", "sub_bass", "humming", "call_response", "harmony_vocal", "riser", "reverse_cymbal", "violin_line", "flute"],
    "signatureRoles": ["piano", "gospel_organ", "choir_pad", "warm_pad"],
    "forbiddenTraits": [
      "club four-on-the-floor kick (this is worship, not house)",
      "log drum bassline (amapiano)",
      "trap hi-hat rolls or sliding 808s",
      "dembow/reggaeton bounce",
      "party chant energy over the reverent build",
      "dense busy percussion drowning the vocal space"
    ],
    "grooveRules": "Slow and spacious (62-82 BPM), straight feel. The PIANO leads — flowing arpeggios and open voicings; gospel organ swells under it. Drums enter LATE and soft (rim/soft kick, gentle hats), building only as the song lifts. Bass is long, warm and rooted. Huge space for the lead vocal and choir — the mix breathes; nothing competes with the voice. Dynamics tell the story: intimate verse, swelling pre, LIFTED chorus with full choir, then a stripped tag.",
    "sectionMap": [
      { "section": "intro", "materials": ["piano", "warm_pad"] },
      { "section": "verse", "materials": ["piano", "warm_pad", "bass_guitar", "soft_kick", "closed_hat"] },
      { "section": "pre-hook", "materials": ["piano", "gospel_organ", "warm_pad", "bass_guitar", "snare", "riser"] },
      { "section": "hook", "materials": ["piano", "gospel_organ", "choir_pad", "string_pad", "bass_guitar", "soft_kick", "snare", "closed_hat", "crash"] },
      { "section": "bridge", "materials": ["piano", "choir_pad", "humming"] },
      { "section": "final-hook", "materials": ["piano", "gospel_organ", "choir_pad", "string_pad", "strings_line", "bass_guitar", "soft_kick", "snare", "closed_hat", "crash", "call_response"] },
      { "section": "outro", "materials": ["piano", "warm_pad", "humming"] }
    ],
    "fillCadenceBars": 16,
    "mixPriorities": ["lead_vocal", "piano", "choir", "gospel_organ", "bass_guitar", "soft_kick", "warm_pad", "string_pad", "closed_hat"],
    "qualityChecks": [
      "tempo sits 62-82 BPM, straight feel",
      "piano is the lead instrument (arpeggios/open voicings audible)",
      "gospel organ swells present under the lift",
      "drums soft and late-entering — never a club kick",
      "big vocal space — nothing masks 2-4kHz",
      "dynamic build: intimate verse to lifted chorus",
      "NO log drum, NO trap hats, NO dembow"
    ],
    "engineTags": ["worship", "contemporary gospel worship", "72 bpm slow build", "flowing piano arpeggios", "gospel organ swells", "warm choir pads", "soft late-entering drums", "reverent and lifted", "huge vocal space"]
  },
  "praise": {
    "genre": "praise",
    "displayName": "Praise (African Praise-Break)",
    "origin": "African church praise — the fast, joyful, danceable half of gospel: Nigerian/Ghanaian praise medleys and praise-break energy.",
    "bpmLo": 112, "bpmHi": 132, "typicalBpm": 122,
    "swing": "light",
    "fourOnFloor": false,
    "requiredRoles": ["kick", "snare", "clap", "closed_hat", "shekere", "conga", "bass_guitar", "piano", "gospel_organ", "lead_vocal", "call_response"],
    "optionalRoles": ["talking_drum", "cowbell", "agogo", "shaker", "open_hat", "tom_fill", "drum_roll", "highlife_guitar", "clean_guitar_riff", "brass_section", "trumpet", "sax", "choir", "gospel_choir", "crowd_chant", "chant", "crash", "sub_bass"],
    "signatureRoles": ["gospel_organ", "shekere", "call_response", "clap"],
    "forbiddenTraits": [
      "log drum bassline (amapiano, not praise)",
      "dembow/reggaeton pattern",
      "trap half-time feel or sliding 808s",
      "dark minor moodiness (praise is JOY — major and bright)",
      "slow worship tempo (that is the worship lane)"
    ],
    "grooveRules": "Fast and JOYFUL (112-132 BPM), light swing. Driving syncopated kick with claps + snare on the backbeat, shekere running bright 16ths, congas and talking drum answering in the gaps. Gospel organ stabs and runs lead the harmony with bright major-key piano; bass walks and bounces. Call-and-response everywhere — leader calls, congregation answers. Praise-break lifts: drum rolls into every chorus, brass punches on the peaks. It must make a congregation DANCE.",
    "sectionMap": [
      { "section": "intro", "materials": ["gospel_organ", "shekere", "clap", "call_response"] },
      { "section": "verse", "materials": ["kick", "snare", "clap", "closed_hat", "shekere", "conga", "bass_guitar", "piano"] },
      { "section": "pre-hook", "materials": ["kick", "snare", "clap", "closed_hat", "shekere", "conga", "bass_guitar", "gospel_organ", "drum_roll"] },
      { "section": "hook", "materials": ["kick", "snare", "clap", "closed_hat", "open_hat", "shekere", "conga", "talking_drum", "bass_guitar", "piano", "gospel_organ", "brass_section", "call_response", "crash"] },
      { "section": "bridge", "materials": ["gospel_organ", "clap", "shekere", "call_response", "crowd_chant"] },
      { "section": "final-hook", "materials": ["kick", "snare", "clap", "closed_hat", "open_hat", "shekere", "conga", "talking_drum", "cowbell", "bass_guitar", "piano", "gospel_organ", "brass_section", "gospel_choir", "call_response", "crowd_chant", "crash"] },
      { "section": "outro", "materials": ["gospel_organ", "clap", "shekere", "crowd_chant"] }
    ],
    "fillCadenceBars": 8,
    "mixPriorities": ["lead_vocal", "kick", "bass_guitar", "clap", "snare", "gospel_organ", "shekere", "call_response", "conga", "piano", "brass_section"],
    "qualityChecks": [
      "tempo sits 112-132 BPM with light swing",
      "gospel organ stabs/runs clearly present",
      "shekere/shaker 16th motion drives throughout",
      "claps + backbeat land strong",
      "call-and-response between lead and answer vocals",
      "bright MAJOR-key joy — never dark or moody",
      "drum roll lifts into every chorus",
      "NO log drum, NO dembow, NO trap half-time"
    ],
    "engineTags": ["african praise", "nigerian gospel praise", "122 bpm joyful dance", "gospel organ stabs", "shekere 16ths and congas", "clap-driven backbeat", "call and response vocals", "praise-break drum rolls", "bright major key celebration"]
  }
};

export function getGenreKit(genre?: string | null): GenreKit | undefined {
  return genre ? GENRE_KITS[genre] : undefined;
}

/** Every genre that has a full producer-grade kit. */
export const GENRE_KIT_KEYS: string[] = Object.keys(GENRE_KITS);

/**
 * The SYNTH PRIMITIVE roles to forge for a genre — the single source of truth
 * shared by the synth bridge AND the owned-engine kit selection (they used to
 * disagree: genreSignature.kitRoles forced log_drum on afrobeats while kitRolesFor
 * asked for drums/talking_drum the synth couldn't make). Derived from the genre's
 * kit and mapped to what the synth + assembler understand: drums, percussion,
 * bass, chords, log_drum (only for log-drum genres), fill.
 */
export function synthKitFor(genre?: string | null): string[] {
  const kit = getGenreKit(genre);
  const roles = new Set<MaterialRole>([...(kit?.requiredRoles ?? []), ...(kit?.signatureRoles ?? [])]);
  const has = (...rs: MaterialRole[]) => rs.some((r) => roles.has(r));
  const out: string[] = [];
  if (has('kick', 'kick_808', 'soft_kick', 'club_kick', 'live_kick', 'snare', 'rimshot', 'clap')) out.push('drums');
  if (has('shaker', 'shekere', 'cabasa', 'maraca', 'conga', 'bongo', 'closed_hat', 'talking_drum', 'djembe')) out.push('percussion');
  if (roles.has('log_drum')) out.push('log_drum');
  if (has('bass_guitar', 'synth_bass', 'sub_bass', 'bass_808', 'sliding_808', 'moog_bass', 'reese_bass', 'upright_bass', 'organ_bass', 'pluck_bass')) out.push('bass');
  if (has('piano', 'rhodes', 'wurlitzer', 'organ', 'hammond', 'gospel_organ', 'guitar_chords', 'highlife_guitar', 'house_piano_stab', 'synth_pad', 'warm_pad')) out.push('chords');
  out.push('fill');
  return out.length > 1 ? [...new Set(out)] : ['drums', 'bass', 'chords', 'percussion', 'fill'];
}

// Roles never forged as material: real lead performances belong to the artist/
// engine, not the shelf. (Textural chants/hums/chops ARE forgeable.)
const UNFORGEABLE = new Set(['lead_vocal', 'double', 'harmony_vocal', 'adlib', 'call_response', 'spoken_word', 'hype_vocal', 'vocal_pad']);

/**
 * The genre's FORGE KIT (Executive-Summary spec) — the rich, prioritized role
 * list the shelf should hold, derived from the genre's kit definition, never a
 * hand-maintained list. Signature roles lead (talking drum, shekere, log drum,
 * highlife guitar…), then required roles rhythm-first (the layering law wants
 * 3-5 concurrent percussion), capped so a kit forge stays affordable — the cap
 * can never drop a signature. Every kit carries a section fill.
 */
export function forgeKitFor(genre: string, cap = 12): string[] {
  const kit = getGenreKit(genre);
  if (!kit) {
    const base = /drill|trap|hip_hop/.test(genre) ? ['drums', 'bass', 'chords'] : ['drums', 'percussion', 'bass', 'chords'];
    return [...base, 'fill'];
  }
  const ordered: string[] = [];
  const push = (r: string) => {
    if (!ordered.includes(r) && !UNFORGEABLE.has(r) && isMaterialRole(r)) ordered.push(r);
  };
  for (const r of kit.signatureRoles) push(r);
  const famRank: Record<string, number> = { drumkit: 0, african_perc: 0, global_perc: 0, bass: 1, harmony: 2, melody: 3, mallets: 3, vocals: 4, fx: 5 };
  const req = [...kit.requiredRoles].filter((r) => isMaterialRole(r)).sort((a, b) => (famRank[familyOf(a as MaterialRole)] ?? 9) - (famRank[familyOf(b as MaterialRole)] ?? 9));
  for (const r of req) push(r);
  return [...ordered.slice(0, cap), 'fill'];
}

/**
 * Completeness check for a kit — a real record needs all core musical jobs
 * covered. Returns the list of jobs the kit is MISSING (empty = complete).
 * Used by the suite gate so no genre ships a thin, jobless palette.
 */
export function kitCoverageGaps(kit: GenreKit): string[] {
  const jobs = new Set<string>();
  for (const r of [...kit.requiredRoles, ...kit.signatureRoles]) jobs.add(jobOf(r));
  const gaps: string[] = [];
  if (!jobs.has('rhythm')) gaps.push('rhythm');
  if (!jobs.has('low_end')) gaps.push('low_end');
  // Pitched "top line" content — genres differ in whether it's harmony (piano/
  // pads), melody (bells/plucks/horns) or vocal-led (rap). Any one satisfies it.
  if (!jobs.has('harmony') && !jobs.has('melody') && !jobs.has('vocal')) gaps.push('pitched_content');
  return gaps;
}

/**
 * Does a rendered/detected role set satisfy THIS genre's signature? The ear's
 * verification hook: a genre's signatureRoles must be present for the take to be
 * genuinely in-lane (e.g. amapiano MUST have log_drum + piano; highlife MUST
 * have highlife_guitar). Returns the missing signature roles (empty = passes).
 */
export function missingSignatures(genre: string, detected: readonly MaterialRole[]): MaterialRole[] {
  const kit = GENRE_KITS[genre];
  if (!kit) return [];
  const have = new Set<string>(detected);
  return kit.signatureRoles.filter((r) => !have.has(r));
}

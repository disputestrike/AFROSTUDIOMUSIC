/**
 * GLOBAL genres — full Sound DNA + current-trends enrichment for non-Afro genres,
 * so the studio is all-genre, not Afro-only. Authored as uncopyrightable FACTS +
 * music-theory analysis (artists as style lanes; no lyrics/audio). Auto-generated
 * by the author-global-genre-dna workflow; merged into the DNA lookups in index.ts.
 */
import type { SoundDNA } from './recipes';
import type { GenreEnrichment } from './enrichment';

export const GLOBAL_SOUND_DNA: Record<string, SoundDNA> = {
  "pop": {
    "genre": "pop",
    "displayName": "Pop (Global Contemporary 2026)",
    "bpmRange": [
      95,
      135
    ],
    "typicalBpm": 120,
    "commonKeys": [
      "C",
      "G",
      "D",
      "A",
      "E",
      "F",
      "Bb"
    ],
    "chordProgressions": [
      {
        "roman": "I-V-vi-IV",
        "description": "Axis progression. Most prevalent structure (300+ charting songs). Creates emotional journey: stability → lift → melancholy → resolution. Example: C-G-Am-F. Works across ballads to upbeat hooks."
      },
      {
        "roman": "I-vi-IV-V",
        "description": "Doo-wop changes. Classic 1950s DNA still dominant in 2026. Creates question-answer dynamic. Example: C-Am-F-G. Familiar, emotionally engaging throughout."
      },
      {
        "roman": "vi-IV-I-V",
        "description": "Pop-punk progression. Starts on minor vi for immediate emotional weight. Example: Am-F-C-G. Effective for longing, introspection, contrast."
      },
      {
        "roman": "I-IV-V",
        "description": "Classic blues-root three-chord. Minimalist backbone. Example: C-F-G. Simplicity = endless variation. Foundation for modern songwriting."
      },
      {
        "roman": "I-♭VII-IV-I",
        "description": "Mixolydian pop. Flattened seventh = rock edge without full minor embrace. Example: C-B♭-F-C. Distinctive flavor, rhythmic drive."
      }
    ],
    "arrangement": [
      {
        "section": "Intro",
        "bars": "4-8",
        "whatHappens": "Synth pad or minimal guitar + sparse percussion. Establish groove pocket immediately. Avoid dense layering; let space invite. Often a loop or short phrase that repeats into the verse hook."
      },
      {
        "section": "Verse 1",
        "bars": "16-24",
        "whatHappens": "Vocal dry/intimate on lead, layered ad-libs underneath (reverb-washed, low in mix). 808 or deep kick + hi-hat swing. Bass follows chord root with pocket syncopation. Synth pad holds harmonic bed. Energy ~60-70% of max."
      },
      {
        "section": "Pre-Chorus",
        "bars": "4-8",
        "whatHappens": "Add second vocal layer (harmony or doubled ad-lib). Kick pattern shifts—adds energy bump. Snare/clap steps in or intensifies. Bass walks up or holds final chord tension. Builds anticipation."
      },
      {
        "section": "Chorus",
        "bars": "16-24",
        "whatHappens": "Full instrumentation: lead vocal broad/anthemic. Vocal doubles + harmonies fill stereo width. Kick punches on 1 & 3, snare on 2 & 4 (straight or swing). Bass synth + electric bass layer for thickness. Synth stabs or melodic lead line punctuates hook. Full energy."
      },
      {
        "section": "Verse 2",
        "bars": "16-24",
        "whatHappens": "Vocal texture shift: maybe more ad-lib drops or lower register. Strip back one layer from chorus (remove one vocal double or synth layer). Maintain groove; groove = the glue, not the fill. Bass same as V1, maybe with rhythmic variation."
      },
      {
        "section": "Bridge / Pre-Final Chorus",
        "bars": "8-12",
        "whatHappens": "Unexpected key shift (+2 semitones is common), or sudden silence + isolated vocal + minimal bass. Break the pattern to reset energy. Could be a talk-box effect, reversed vocal, or stripped-down vocal + single synth drone. Ad-libs intensify here. Builds final explosion."
      },
      {
        "section": "Final Chorus",
        "bars": "24-32",
        "whatHappens": "Extended or double-length chorus. Add extra vocal layer, stacked ad-libs, fuller percussion (add cymbals/ride). Synth melody intertwines with vocal. Kick might have 16th-note hi-hat roll underneath for climax texture."
      },
      {
        "section": "Outro",
        "bars": "4-12",
        "whatHappens": "Fade or loop final chorus hook. Last 1-2 bars could strip to just vocal + one synth layer or pad. Vocal ad-lib/riff over final chord. Fade to silence or abrupt cut (TikTok-friendly clip endpoint)."
      }
    ],
    "instrumentation": {
      "core": [
        "Vocal (lead, doubles, harmonies)",
        "Kick / 808 bass drum",
        "Snare / Clap",
        "Hi-hat (closed or swing)",
        "Synth pad (harmonic bed)",
        "Melodic synth lead or arpeggiated synth line"
      ],
      "signature": [
        "Vocal ad-lib layers (reverb-washed, subconscious atmosphere)",
        "Deep bass synth + slight electric bass layer (thickness)",
        "Vocal chop or talk-box effect (hook punctuation)",
        "Reversed vocal or filtered vocal layer (bridge texture)"
      ],
      "guitar": "Optional; when used, clean electric or acoustic with light reverb. Often a rhythmic strumming pad rather than lead. Rarely distorted in mainstream pop.",
      "keys": "Synth pad (Ott-style ambient, lush reverb, low-pass filtered for warmth). Arpeggiated synth (often 1/16th or 1/8th note rhythm). Occasional Fender Rhodes or warm EP for organic texture.",
      "bass": "808 sub-bass synth for low-end thump (fundamental). Shallow synth bass for groove pocket (follows chord root, syncopated 16ths or triplets). Optional light electric bass layer (+6dB) for analog warmth. Pocket syncopation is KEY.",
      "percussion": [
        "Kick (deep 808, punchy or tight depending on energy)",
        "Snare (tight, occasionally layered with clap for thickness)",
        "Hi-hat (closed, swing or straight; 1/8th or 1/16th subdivisions)",
        "Shaker / maraca (sparse, in verses; builds in chorus)",
        "Cowbell or metallic percussion (TikTok-era energy punctuation)",
        "Vocal percussion (tongue pops, lip clicks, beatboxing as ad-libs)",
        "Occasional crash or ride (bridge, final chorus)"
      ]
    },
    "groove": {
      "feel": "Pocket-driven rather than metronomic. Kick sits slightly behind the beat (lazy); snare 2 & 4 (backbeat). Hi-hat swing (shuffle feel at 120 BPM = ~55-70% swing). Not rigid—groove lives in the spacing, not the grid.",
      "pocketNotes": "Swing the hi-hat. Let kick drift 10-20ms behind beat 1 (lazy pocket). Snare punches exactly on beat 2 & 4 (anchor). Bass syncopation: play the pocket, not the downbeat every time. Space = groove.",
      "swing": "Light swing (55-70% triplet feel). Pronounced in hi-hats and 16th-note patterns. Not dance-oriented (no hard 4-on-the-floor); subtle, human-feel sway.",
      "syncopation": "Frequent 16th-note subdivisions in hi-hats and bass. Snare syncopation rare (keeps groove anchored). Ad-libs + vocal doubles add rhythmic texture without syncopated hits. Anticipations on lead vocal common (sing ahead of the beat for urgency)."
    },
    "vocalStyle": {
      "delivery": "Conversational intimacy in verses (lower dynamics, close-mic'd feel). Chorus: anthemic breadth, full resonance, confidence. No belting unless emotional climax. Tone: neutral-to-warm (avoid excessive vibrato unless R&B-influenced). Attitude: relatability over perfection.",
      "adLibs": [
        "Breathy vocal textures (whispered ad-libs behind lead)",
        "Vocal chops (short syllables, rhythmic punctuation)",
        "Melodic riffs (follow the synth line, create call-and-response)",
        "Doubles / harmonies (third or fifth above lead, slightly detuned -10 to +10 cents for chorus width)",
        "Runs / melismas (on final syllable of hook, but not excessive)",
        "Signature ad-lib phrase (artist branding, usually 2-4 syllables, repeated multiple times)",
        "Reversed or vocoder-processed ad-lib layer (behind lead for subconscious texture)"
      ],
      "harmonyApproach": "Stacked thirds (I-vi leads to tight harmonies). Chorus doubles in octave + fifth or third above lead. Background vocals in sus4 or maj7 for lush texture. Ad-libs often move independently from lead (counter-melody), creating rhythmic conversation. Reverb + delay on harmonies; lead stays dry.",
      "languageMix": "English-dominant in charts. Code-switching common (English verse, Spanish/French/Patois ad-lib in chorus or bridge). Multilingual flow adapts to rhythm and syllable count. Global artists blend 2-3 languages for cross-market appeal."
    },
    "signatureElements": [
      "Reverb-washed ad-lib layers (subconscious energy, low in mix but omnipresent)",
      "Vocal chop or rhythmic vocal texture (TikTok-era hook punctuation)",
      "Synth pad with lush reverb (emotional foundation, never forward)",
      "Pocket-driven groove (lazy kick, tight snare, swung hi-hats)",
      "Minimal production in verses (space = intimacy), full production in chorus (layered vocals + synths)",
      "Signature vocal ad-lib or catchphrase (repeat 3+ times for branding)",
      "Bridge energy shift (key change, silence, vocal texture change)",
      "Snappy transitions (0.5-1 bar of buildup into new section; no drag)",
      "TikTok-friendly clip endpoint (outro fades or ends on hook repetition, ideally 30-45 sec into song)"
    ],
    "referenceArtists": [
      "PinkPantheress (hyperpop-pop hybrid, tight vocals, ethereal ad-libs)",
      "Zara Larsson (anthemic pop, strong vocal delivery, global appeal)",
      "Slayyyter (synth-heavy, electronic textures, squelchy bass)",
      "Olivia Dean (soulful R&B-pop blend, warm production, vintage vibes)",
      "RAYE (UK pop, cinematic production, introspective lyrics)",
      "Sienna Spiro (classic pop structure, emotional depth)",
      "Dua Lipa (dance-pop precision, production clarity, hook design)",
      "The Weeknd (synth-driven atmosphere, vocal layering, cinematic scope)"
    ],
    "mixTraits": {
      "lowEnd": "808 sub-bass sits at -20dB to -16dB in headroom (not crushed). Gentle high-pass filter on mid-range synths (~250 Hz) to keep bass definition. Electric bass layer (+6dB from sub) for analog warmth; sits above sub at ~100-150 Hz. Kick punch at 2-5 kHz, depth at 60-80 Hz. No bass clipping; dynamics preserved.",
      "drums": "Kick: tight, punchy, slightly lazy in pocket (10-20ms drift from grid). Snare: bright, tight, sits at exact beat 2 & 4. Hi-hat: swung, airy (not paper-thin), crisp attack. Compression: light touch (ratio 2:1, threshold -15dB from loudest), preserve transients. Kick gets subtle saturation (add harmonics, not distortion).",
      "vocals": "Loudness: -5.5 to -6.5 LUFS short-term (based on 2025 top tracks). Dynamic range: 4.5-6.0 DR (transients preserved, not squashed). Loudness used as feel tool, not absolute target. Two-stage compression on master bus (gentle, gentle)—never one aggressive limiter. Preserve movement; no brick-wall limiting.",
      "space": "Reverb: two instances (small room 1-1.5s on doubles, large hall 2.5-3.5s on ad-libs). Delay: 1/4 or 1/8 on lead vocal (minimal, 5-15% wet), more pronounced on ad-libs. Width: stereo reverb on doubles; mono ad-libs in center or panned low. Dry lead in center preserves intimacy; reverb-heavy elements create 3D depth around it."
    },
    "productionPromptSnippet": "Pocket-driven contemporary pop with lush synth pads, reverb-washed ad-lib layers, and intimate vocal delivery. 120 BPM, swung groove, minimal verse production that explodes into layered chorus. Signature ad-lib branding. Mix for clarity and 3D depth, not loudness chasing.",
    "freshnessGuardrails": "Avoid: overused four-on-the-floor (use pocket swing instead). Reject pure synthwave or retro-80s (blend analog warmth into modern tone). No gratuitous vocal effects (avoid talk-box, autotune abuse—use sparingly as texture, not style). Prevent: generic chord progression without harmonic movement (add one twist to the I-V-vi-IV). Shun: TikTok algorithm chasing without hook substance (clip must contain actual musical idea, not just trend). Enforce: global language accessibility (English-first, multilingual flavor). Skip: overly produced vocals (conversational intimacy is the asset).",
    "sources": [
      "https://www.billboard.com/lists/best-songs-2026-so-far/",
      "https://blog.landr.com/music-trends/",
      "https://www.epidemicsound.com/blog/music-trends-2026/",
      "https://elements.envato.com/learn/music-trends",
      "https://bpmcalc.com/genres/pop/",
      "https://www.masteringthemix.com/blogs/learn/mastering-trends-for-2026",
      "https://powersof10.com/pop-chord-progressions/",
      "https://www.hooktheory.com/theorytab/popular-chord-progressions",
      "https://thevocalmarket.com/blogs/how-to/how-to-mix-vocals-for-streaming-lufs-loudness-2026"
    ]
  },
  "rnb": {
    "genre": "rnb",
    "displayName": "Contemporary R&B (Alt R&B / Neo-Soul Lane)",
    "bpmRange": [
      65,
      95
    ],
    "typicalBpm": 80,
    "commonKeys": [
      "F",
      "Bb",
      "Eb",
      "D",
      "A",
      "G"
    ],
    "chordProgressions": [
      {
        "roman": "I–vi–ii–V",
        "description": "Classic R&B foundation: establishes warmth, evokes ballads and intimate moments. Extended with 7ths/9ths (Fmaj7–Dmin7–Gmin7–C9) for harmonic depth."
      },
      {
        "roman": "ii–V–I",
        "description": "Jazz-influenced turnaround: smooth voice leading (Gmin7–C13–Fmaj9). Creates lush transitional movements between sections."
      },
      {
        "roman": "I–IV–V",
        "description": "Soulful simplicity with pop accessibility: grounded, modern R&B with pop influence (Fmaj7–Bbmaj7–C7sus4)."
      },
      {
        "roman": "vi–IV–I–V",
        "description": "Minor-to-major emotional arc: introspective verses to triumphant chorus (Dmin–Bbmaj7–Fmaj9–C7)."
      }
    ],
    "arrangement": [
      {
        "section": "Intro (0:00–0:15)",
        "bars": "4 bars",
        "whatHappens": "Atmospheric pad + Rhodes key stabs, sparse kick on backbeat, ambient reverb tail. Establishes mood and pocket without rushing entry."
      },
      {
        "section": "Verse 1 (0:15–0:45)",
        "bars": "8 bars",
        "whatHappens": "Vocal-forward: lead vocal + single harmony layer. Minimal percussion: 808 kick, hats with swing quantization. Bass walks/grooves below vocal. Extended chord voicings (7ths, 9ths). Syncopation, space between phrases."
      },
      {
        "section": "Pre-Chorus (0:45–0:55)",
        "bars": "4 bars",
        "whatHappens": "Build tension: additional harmony doubles, sidechained strings/pads swell, kick pattern tightens. Keys introduce movement. Ad-lib overlay starts."
      },
      {
        "section": "Chorus (0:55–1:15)",
        "bars": "8 bars",
        "whatHappens": "Full arrangement unlock: layered vocals (main + harmonies + ad-libs), punchy 808 kicks, snare/clap on 2 & 4, syncopated hi-hats, lush pad swell, bass locks into pocket. Emotional climax."
      },
      {
        "section": "Verse 2 (1:15–1:45)",
        "bars": "8 bars",
        "whatHappens": "Texture variation: lead vocal, one new harmony layer, light strings/pad underneath. Kick pattern switches—maybe triplet feel. Pocket remains tight but less dense than chorus. Ad-lib flourish near end."
      },
      {
        "section": "Bridge (1:45–2:00)",
        "bars": "4 bars",
        "whatHappens": "Stripped-back or contrasting moment: reverby vocal run, sparse bass, minimalist keys, maybe synth stab accents. Surprise chord shift or instrumental solo break. Builds re-entry."
      },
      {
        "section": "Final Chorus + Outro (2:00–2:30)",
        "bars": "8–12 bars",
        "whatHappens": "Vocal layering peaks—doubles, ad-libs, runs. Extended production: swelling pad, kick 808 locks solid, syncopated percussion detail, fade with reverb tail on last vocal note."
      }
    ],
    "instrumentation": {
      "core": [
        "Lead Vocal",
        "Vocal Harmonies / Layers",
        "808 Bass / Sub-bass",
        "Rhodes / Wurlitzer Keys",
        "Atmospheric Pad / Synth"
      ],
      "signature": [
        "Warm Keys (Rhodes, Wurlitzer)",
        "Extended-chord Pad / Ambient Texture",
        "Syncopated Kick Pattern (808 / Trap-inflected)"
      ],
      "percussion": [
        "808 Kick (punchy, present in mix)",
        "Snare / Clap (on 2 & 4, occasionally syncopated)",
        "Hi-hat (swing quantized, swishy texture)",
        "Ride Cymbal or Shaker (laid-back pocket feel)",
        "Optional: Afro Percussion / Drum Roll Accent (pre-section lift)"
      ],
      "bass": "Electric Bass (warm, sidechain-friendly): grooves/walks below vocal line, locks into pocket with kick. Rhodes bass notes provide harmonic foundation; sub-bass sits 40–80 Hz for club/headphone translation.",
      "guitar": "Optional clean electric or jazz-fusion style nylon; if used, play sparse, fingerpicked or comped voicings (maj7, min7 colors). Texture only."
    },
    "groove": {
      "feel": "Pocket-locked, conversational swing: mid-tempo laid-back pocket with syncopation and space. NOT grid-aligned; human timing + deliberate rests create intimacy.",
      "pocketNotes": "The pocket matters more than the grid. Kick hits slightly behind the beat. Snare/clap sits loose on 2 & 4. Hi-hats swing (triplet feel, 60–70% humanization). Bass locks kick, leaves space for vocal breath.",
      "swing": "Triplet-based swing quantization (not straight 16ths). Hats push into backbeat. Kick-snare interaction creates a conversational bounce, not mechanical perfection.",
      "syncopation": "Vocal phrasing drives syncopation: melodies sit between beat partitions. Kick pattern shifts per section (verse offbeats → chorus solid backbeat). Bass mirrors vocal rhythm on hook, locks 4 on the floor elsewhere."
    },
    "vocalStyle": {
      "delivery": "Intimate, conversational verses (close-mic'd, minimal processing in hook). Powerful, open choruses (reverb/delay added). Mix of chest voice (richness) + controlled falsetto/head voice (air, vulnerability). Warm tone, smooth register transitions.",
      "adLibs": [
        "Yeah / Mmm / Oh (spontaneous color)",
        "Vocal runs / riffs (pentatonic-based, synth-like fluidity)",
        "Doubles / harmonies (echo-chamber texture on hook)",
        "Breathiness / grit (texture layer, not dominant)",
        "Call-and-response pockets (sub-vocal trading)"
      ],
      "harmonyApproach": "Stacked 3rds and 4ths below lead (classic R&B blend). Occasional 5th doublings. Harmonies sit in pocket with lead, not overshadow. May include open-voiced pads (wide spacing) for atmospheric chorus lift."
    },
    "signatureElements": [
      "Extended-chord voicings (maj7, min7, 9ths, 11ths) creating sophisticated harmonic bed",
      "Sidechain compression: keys/pads duck to vocal; kick drives mix",
      "Layered, conversational vocal textures: main + harmony + ad-lib triple threat",
      "Syncopated, human-timed pocket: swing quantization, intentional space",
      "Warm, mid-forward keys (Rhodes 7ths, Wurlitzer texture) as production anchor",
      "808 / trap-inflected low end meeting neo-soul live instrumentation",
      "Intimate vocal chain (minimal reverb verses → lush chorus processing)",
      "Afrobeats-inspired drum rolls or accent percussion (bridge/section lift)"
    ],
    "referenceArtists": [
      "SZA (PBR&B, ethereal, chillwave-touched alternative R&B lane)",
      "The Weeknd (dark, atmospheric, synth-forward R&B production)",
      "Victoria Monet (modern R&B accessibility + soulful depth)",
      "Frank Ocean (introspective, minimal alt-R&B experimentation)",
      "Cleo Sol (UK neo-soul, organic live instrumentation)",
      "Liv.e / GENA (groovy, jazz-infused neo-soul honesty)",
      "Lianne la Havas (sophisticated neo-soul, live keys/strings)"
    ],
    "mixTraits": {
      "lowEnd": "Tight, controlled 808 / sub-bass (40–80 Hz sidechain-friendly to vocal). Bass guitar sits 60–150 Hz. Kick punches 1–3 kHz for presence. No muddiness: high-pass filter vocal chain at 80 Hz+.",
      "drums": "Kick sits behind beat (70–80% of grid), snare locked but swung. Hats swing-quantized, live-sounding, never robotic. Peak -6 LUFS short-term in choruses (modern loudness standard for streaming). Kick-snare play drives groove, not just timekeeper.",
      "vocals": "Lead vocal front-center, intimate verses (-3 dB reverb), powerful choruses (+8 dB plate reverb, 1.5–2 sec decay). Harmonies pan L/R or center-stacked. Ad-libs in space (high reverb, slight delay). De-esser on sibilants to preserve warmth.",
      "space": "Atmospheric pad/synth underneath everything: dark, rich, reverb-soaked (3–4 sec decay, small-room impulse). Vocal runs / ad-libs sit in big hall. Verses: intimate, close-field; Chorus: wide, lush. Avoid wall-of-sound; leave 2–3 dB headroom for movement."
    },
    "productionPromptSnippet": "Mid-tempo R&B groove: warm Rhodes 7ths + layered vocal harmonies over syncopated 808 pocket + lush atmospheric pad. Intimate verses, powerful chorus. Swing quantized, pocket-locked, conversational feel. Neo-soul + alt R&B lane.",
    "freshnessGuardrails": "Avoid: grid-locked robotic percussion, over-compressed vocal chain, lo-fi trap clichés, 2024-dated hyperpop mashups. DO: keep pocket human-timed, extend chords (7ths+), lean into live-key texture, preserve vocal intimacy. Update: 2026 leans neo-soul organic + alt-R&B experimental, less trap-trap, more jazz-informed harmony.",
    "sources": [
      "https://orphiq.com/resources/bpm-tempo-guide",
      "https://output.com/blog/rnb-type-beat",
      "https://bpmcalc.com/genres/rnb/",
      "https://www.soundverse.ai/blog/article/how-to-make-an-rb-song-1318",
      "https://thebluesproject.co/2026/04/30-rnb-artists-to-watch-2026/",
      "https://www.masterclass.com/articles/neo-soul-music-guide",
      "https://emastered.com/blog/r-n-b-chord-progressions",
      "https://chordmap.io/rnb-chord-progressions",
      "https://www.masteringthemix.com/blogs/learn/rends-in-hip-hop-r-b-music-production-in-2024",
      "https://www.waves.com/tips-for-mixing-r-b-vocal-adlibs",
      "https://kentamplinvocalacademy.com/how-to-sing/vocal-style/rnb-female/",
      "https://buffer.com/resources/trending-songs-tiktok/",
      "https://open.spotify.com/playlist/2qSiBYsFWMv2tBNWKAMCZQ"
    ]
  },
  "dancehall": {
    "genre": "dancehall",
    "displayName": "Dancehall (Jamaican)",
    "bpmRange": [
      80,
      105
    ],
    "typicalBpm": 92,
    "commonKeys": [
      "E",
      "A",
      "D",
      "G",
      "B"
    ],
    "chordProgressions": [
      {
        "roman": "I - V - vi - IV",
        "description": "Foundation riddim: major to relative minor creates uplifting yet introspective tension, perfect for building energy across 8-bar loops without predictability"
      },
      {
        "roman": "IV - I - V - I",
        "description": "Classic bashment lift: plagal motion IV→I creates locked-in pocket feel, common in modern viral tracks and short-form content"
      },
      {
        "roman": "vi - IV - I - V",
        "description": "Minor-to-major rise: starts melancholic, brightens into release; signature for emotional introspection (singjay ballads) before explosive chorus"
      },
      {
        "roman": "I - IV - vi - ii",
        "description": "Deep riddim minor: darkened version adds wobble-bass compatibility; foundation for trap-dancehall fusions and Afrobeats cross-pollination"
      }
    ],
    "arrangement": [
      {
        "section": "Intro (0-8 bars)",
        "bars": "0-8",
        "whatHappens": "Riddim vamp: synth pad or organ stab (reverb-heavy) introduces key, sparse 808/kick with crisp snare on beat 3 (one-drop). Stereo hi-hats rolling light. Reserved volume; no bass yet."
      },
      {
        "section": "Build (8-16 bars)",
        "bars": "8-16",
        "whatHappens": "Deep sine-wave bass or reese enters with LFO wobble (0.5-2 Hz), tuned sub-bass below 60 Hz. One-drop snare locks harder. Tonal percussion (timbales, cowbell) adds organic swing. Kinetic energy building."
      },
      {
        "section": "Verse 1 (16-32 bars)",
        "bars": "16-32",
        "whatHappens": "Lead vocal (toasting/singjay) rides riddim with staccato bursts and elongated vowels. Call-and-response layers build texture. Bass wobbling, kicks on 1 and 3. MC + rhythm focus. Ad-libs puncture mix (bing-bing scats, patois interjections)."
      },
      {
        "section": "Chorus/Hook (32-40 bars)",
        "bars": "32-40",
        "whatHappens": "Catchy vocal melody (singjay or sung hook) center stage, repeating 2-4 bar motif. Bass may simplify or deepen. Snare roll or crisp fills on bar 39-40. Reverb and delay on vocal for depth."
      },
      {
        "section": "Verse 2 (40-56 bars)",
        "bars": "40-56",
        "whatHappens": "Similar to Verse 1 with vocal layering and harmony ad-libs underneath. Bass pattern may shift (syncopation, pitch-bend automation). Percussion builds subtle intensity via cymbal crashes or ride embellishments on off-beat."
      },
      {
        "section": "Bridge/Switch (56-64 bars)",
        "bars": "56-64",
        "whatHappens": "Riddim may strip (snare + sparse bass wobble) or shift key/bass patch for 4-8 bars, creating tension-release. Vocal ad-libs intensify, often unaccompanied or layered stereo. Hi-hats open slightly. Anticipation for final chorus builds."
      },
      {
        "section": "Final Chorus (64-72 bars)",
        "bars": "64-72",
        "whatHappens": "Full energy return: bass + all percussion locked tight. Hook vocal louder, more distorted/EQ'd for punch. Backing harmony vocal often enters for thickness. Cymbals and fills emphasize groove."
      },
      {
        "section": "Outro/Dub (72-end, 80-96 bars total)",
        "bars": "72-end",
        "whatHappens": "Riddim dub-out: vocals fade to isolated phrases/ad-libs, bass wobbles with echo/reverb tail. Kick may swing to half-time pocket or loop syncopated fill. Slow fade or sudden cut (TikTok style); if full length, 8-16 bar dub decay with reverb wash."
      }
    ],
    "instrumentation": {
      "core": [
        "808/909 kick drum (sub-focused, synth or heavily processed sample)",
        "One-drop snare (crisp, sharp clap, always hits beat 3)",
        "Sine-wave bass or reese bass (sub-bass, LFO wobble/automated pitch)",
        "Synth pad or organ (intro stabs, background harmonic anchor)",
        "Lead vocal (toasting/singjay/sing-rap hybrid)"
      ],
      "signature": [
        "Timbales or cowbell (organic swing, off-beat stabs)",
        "Rolling hi-hats (tight, mostly closed, crisp articulation)",
        "Synth lead or melody layer (often glide-enabled for horn-like sweeps)",
        "Delay/reverb on vocal and pad (space, depth, Caribbean vibe)"
      ],
      "percussion": [
        "Shaker or crisp percussion rolls (ride cymbal substitute)",
        "Wood block or tone-bent kick fills (syncopation)",
        "Crash cymbal (transitions, section ends)",
        "Snare fill rolls (bar 39-40, 63-64 transitions)",
        "Optional: clave or friction drum (Afrobeats fusion only)"
      ],
      "bass": "Tuned 808 or sine-wave reese with LFO wobble (0.5-2 Hz), sub-bass locked to song key, often runs parallel syncopation fills against one-drop kick pattern",
      "keys": "Organ (Rhodes or B3 vibe) or synth pad; rides as stabs rather than sustained chords, maintaining pocket-space for vocal dominance; modern tracks add string synth layers for emotional depth"
    },
    "groove": {
      "feel": "One-drop pocket with syncopated riding: kick REMOVED from beat 3 (kick on 1, silence on 2, snare lock on 3, kick on 4), creating floating, hypnotic lift. Wobbling bass and vocal do heavy lifting, riding the 'dead space' of riddim. Tension between locked snare and syncopated fills creates kinetic, dance-driving momentum.",
      "pocketNotes": "Swing hi-hat roll by 3-5% for Caribbean sway; let bass pitch-bend slightly on downbeat of new 4-bar sections for continuity; one-drop snare must sit EXACTLY on 3, no anticipation. Timbale stabs should float just behind grid for organic feel. Vocal rides pocket with micro-timing variation—never perfectly quantized—for 'alive' energy.",
      "swing": "Off-beat emphasis: hi-hats and timbales swing against grid; bass and vocal slides create glide between note onsets rather than step-time precision. This 'floating' pocket—sitting just behind or ahead of grid—is signature to Jamaican riddim culture and separates dancehall from trap or house.",
      "syncopation": "One-drop defines it: syncopated snare (beat 3 only) plus kick patterns that avoid simple quarter-note predictability. Bass often runs 16th-note syncopation or automated pitch slides. Fills on transitions use stacked 32nd-note hi-hat rolls. Vocal ad-libs punch on off-beat or late in measure, rarely landing on downbeats after intro."
    },
    "vocalStyle": {
      "delivery": "Toasting and singjay hybrid: rapid-fire, rhythmic chanting (toasting roots) blended with sung melodic phrases (singjay evolution). Delivery is percussive—vowels elongated for effect, consonants sharp and staccato to cut through riddim. Patois is native and non-performative; flows naturally within English or pure Jamaican Patois. Attitude is conversational yet commanding—MCs are storytellers and hype-men simultaneously.",
      "harmonyApproach": "Minimal sustained harmony; instead, call-and-response layering where primary vocal line is echoed or answered by secondary layer (often vocoded or heavily reverb'd). Ad-lib layers underneath main vocal add texture without competing for space. Harmonies often a fifth or octave below, creating depth without melody competition. Modern tracks add string pads or synth harmonies behind lead for emotional lift, especially in choruses.",
      "adLibs": [
        "Bing-bing (percussive scat, often double-tracked)",
        "Yo, hey, uh, boom (rhythmic interjections, hype calls)",
        "Patois exclamations: Mi cyan do it, skrrrrt (onomatopoeia for energy)",
        "Vocal trill or roll (rapid repeated note on single vowel)",
        "Echoed phrase or reversed vocal stab (production-based ad-lib)",
        "Ghosted harmony (barely audible second voice, layered calls)"
      ],
      "languageMix": "Jamaican Patois primary with English code-switching (especially in hooks/choruses for radio/global accessibility). Patois phonetics drive delivery rhythm—words like 'mi,' 'ting,' 'seh,' 'wah' land on pocket spots. Newer tracks (2025-26) blend Patois with Afrobeats Pidgin (esp. in collabs with Nigerian/West African artists) or Gen-Z slang for TikTok virality."
    },
    "signatureElements": [
      "One-drop snare on beat 3 (ESSENTIAL—defines riddim)",
      "Wobbling 808/sine-wave bass with LFO automation below 60 Hz",
      "Reverb-heavy synth or organ intro stabs",
      "Vocal ad-libs puncturing mix (scats, patois interjections)",
      "Syncopated hi-hat rolls with Caribbean swing",
      "Timbales or cowbell for organic warmth against synthetic bass",
      "Call-and-response vocal layering (toasting antiphony)",
      "Pitch-bent fills and slides (bass, synth lead) on section transitions",
      "Dub-out or vocal echo decay in outro"
    ],
    "referenceArtists": [
      "Sean Paul (singjay precision, Afrobeats crossover lane)",
      "Vybz Kartel (pure toasting, riddim mastery, modern trap-dancehall fusion)",
      "Shenseea (female energy, viral TikTok choreography lane, uplifting hooks)",
      "Chronic Law (conscious lyricism plus melodic hooks)",
      "Skilllibeng (trap-infused riddim, experimental synth work)",
      "Spice (dancehall femininity, party energy, reggae roots respect)",
      "Popcaan (reggae-fusion, laid-back pocket, crossover appeal)",
      "Masicka (lyrical depth, riddim-riding mastery)",
      "Rihanna (global Dancehall ambassador, Afrobeats-Dancehall bridge)",
      "Afrobeats production lane: Burna Boy, Wizkid (riddim+synth fusion examples)"
    ],
    "mixTraits": {
      "lowEnd": "Sub-bass (below 60 Hz) isolated and EQ'd separately from kick-thump (200–600 Hz); use high-pass filter to remove mud. Wobbling sine wave or reese sits at -12 to -8 dB, never competing with vocal. Bass automation breathes—volume swells on certain 4-bar sections. Parallel compression on sub-bass layer for mobile speaker translation (TikTok critical).",
      "drums": "Kick is punchy but controlled (no excessive distortion); tuned to song key for sub-melodic integration. Snare is bright, dry, sits forward (0–2 dB above vocal bus). Hi-hats tight, slightly left-leaning in stereo, with natural swing (not metronomic). Percussion (timbales, cowbell) adds richness but stays -6 dB below snare. One-drop is LOCKED—no timing deviation.",
      "vocals": "Lead vocal sits at 0 dB reference, centered or slightly left. Vocal doubles/harmonies are -4 to -8 dB, often panned (right or wide stereo) for space. Ad-lib layers are -6 to -12 dB depending on urgency. Reverb on vocal (plate or hall) is moderate (2–4 sec decay), never muddy. Light de-esser prevents sibilance on S sounds; compression (2:1 ratio, -3 to -6 dB reduction) keeps vocal from vanishing on beat's hardest hits.",
      "space": "Reverb on synth/pad (1.5–3 sec, dark/warm) contrasts with short/tight reverb on drums (0.2–0.5 sec, maintains punch). Delay on vocal in chorus (300–500 ms, one repeat) adds dimension without slapback muddiness. Panning: kick centered, hi-hats light L/R, timbales hard L or R for organic feel. Automation on reverb decay swells on transitions (bar 63–64) for build-to-peak drama. Bus-level compression (light, slow attack 30–50 ms, 1.5:1 ratio) glues track together without flattening pocket dynamics. Loudness target: LUFS -14 to -11 for streaming (Spotify/Apple Music) and -16 LUFS for TikTok/YouTube shorts."
    },
    "productionPromptSnippet": "Jamaican riddim with one-drop snare, wobbling 808 bass, staccato toasting vocals riding the pocket, patois ad-libs, organic timbales, reverb-drenched synths, TikTok-viral short-form energy",
    "freshnessGuardrails": "Avoid robotic quantization on drums and vocal; human timing swing is non-negotiable. Don't over-saturate bass—sub clarity is essential for mobile playback. Ensure one-drop snare is ALWAYS on beat 3; no variations break riddim authenticity. Patois pronunciation must be accurate or neutral (not mocked). Afrobeats fusion should add percussion/synth color only; never dilute one-drop or vocal-centric pocket. TikTok conformity matters: 15–45 sec hooks must hit hard by bar 16–24. Don't layer 50+ tracks; clarity over density. Synth layers should enhance emotional narrative (intro mystery, chorus lift), not clutter.",
    "sources": [
      "https://blog.soundtrap.com/how-to-make-dancehall-beats/",
      "https://www.futureproducers.com/forums/threads/what-tempo-do-you-use-for-reggae-bashment.396117/",
      "https://bpmcalc.com/genres/reggae/",
      "https://artistrack.com/afrobeats-global-fusion-trends-2026/",
      "https://soundcy.com/article/how-to-make-riddim-sounds",
      "https://wtmhstudio.com/dancehall-drum-kits-advanced-packs-riddim/",
      "https://grokipedia.com/page/Toasting_(Jamaican_music)",
      "https://jamaicanpatwah.com/b/the-language-of-dancehall-jamaican-patois",
      "https://grokipedia.com/page/Singjay",
      "https://open.spotify.com/playlist/4ZguEZAxrmOuG2IxqIWuaw"
    ]
  },
  "drill": {
    "genre": "drill",
    "displayName": "Drill (UK/NY)",
    "bpmRange": [
      140,
      150
    ],
    "typicalBpm": 142,
    "commonKeys": [
      "A minor",
      "C minor",
      "D minor",
      "G minor",
      "E minor"
    ],
    "chordProgressions": [
      {
        "roman": "i-VII",
        "description": "Am to G (classic dark minor movement, creates forward momentum without resolution)"
      },
      {
        "roman": "i-bVI",
        "description": "Am to F (eerie descending bass line, NYC minimal harmonic approach)"
      },
      {
        "roman": "i-v",
        "description": "Cm to Gm (diminished tension, UK orchestral flavor with string support)"
      },
      {
        "roman": "i-iv-VII-vi",
        "description": "Cm-Fm-Bb-Am (four-chord arc, rare in drill but effective for subgenre hybrids)"
      },
      {
        "roman": "i (with sus4 tension)",
        "description": "Am/sus4 (single-chord drone with orchestral textures, UK signature eerie mood)"
      }
    ],
    "arrangement": [
      {
        "section": "Intro (0:00-0:08)",
        "bars": "1-2",
        "whatHappens": "Sparse 808 glide establishing root, ambient strings/pads fade in, hi-hats dry and syncopated, minimal percussion. Establishes menace without overstatement."
      },
      {
        "section": "Build/Verse Setup (0:08-0:16)",
        "bars": "3-4",
        "whatHappens": "Snare hits land (typically on 2 and 4 with swing), 808 begins sliding between chord roots, hi-hat intensifies with triplet+1/16th blend, bass thickens sub-presence."
      },
      {
        "section": "Verse 1 (0:16-0:48)",
        "bars": "5-16",
        "whatHappens": "Full 808 bass pattern established (sliding on root notes, 1/8th glide timing), syncopated hi-hats carry momentum, strings or pitched pad holds harmony, snare tight and locked. Vocal enters: punchy, dry lead with clear pocket, ad-libs layered underneath in reverb."
      },
      {
        "section": "Pre-Hook/Build (0:48-0:56)",
        "bars": "17-18",
        "whatHappens": "Ad-libs intensify, vocal doubles punch mid-range, 808 becomes more aggressive (faster slides or filter sweep), hi-hat rolls accelerate into triplet clusters."
      },
      {
        "section": "Hook (0:56-1:12)",
        "bars": "19-22",
        "whatHappens": "Vocal switches to melodic, hook melody is simple and hypnotic (2-4 note range), 808 hits root notes harder, strings swell, ad-libs echo behind in stereo width. Hooks in drill are often single-note or two-note melodic phrases."
      },
      {
        "section": "Verse 2 (1:12-1:44)",
        "bars": "23-34",
        "whatHappens": "Same drum pocket, 808 bass pattern mirrors Verse 1, vocal delivery shifts slightly (higher energy, different phrase length), ad-libs respond to vocal cadences, snare swing tightens pocket."
      },
      {
        "section": "Bridge/Switch-Up (1:44-1:52)",
        "bars": "35-36",
        "whatHappens": "Drums drop (often just 808 and sparse hi-hat), vocal gets more aggressive or uses call-and-response with ad-lib double, harmonic tension builds (sus4 or diminished feel intensifies), snare may delay or stutter."
      },
      {
        "section": "Final Hook/Outro (1:52-2:00)",
        "bars": "37-40",
        "whatHappens": "Hook repeats with added layers (vocal harmony, reverb tail), 808 may add pitched variation, hi-hats wind down or cut abruptly, strings fade to single sustained note or silence, vocal ad-lib trails into reverb wash (signature drill outro fade)."
      }
    ],
    "instrumentation": {
      "core": [
        "808 Bass (pitched, sliding)",
        "Snare (tight, swing feel)",
        "Kick (sub-driven, often pushed back)",
        "Hi-Hats (syncopated, blended timing)"
      ],
      "signature": [
        "String Pads (UK orchestral)",
        "Pitched Piano or Bells (melodic outline)",
        "Dark Synth Stabs (sparse, atmospheric)"
      ],
      "keys": "Pitched piano or bell-tone synth; carries single-note melodic harmony outline rather than block chords",
      "guitar": "Rare in core drill; occasionally plucked strings (sampled library, not live acoustic)",
      "bass": "808 sub-bass (modulated pitch between chord roots, distorted glides, 1/8th note automation); acts as primary harmonic anchor",
      "percussion": [
        "High-hat layers (straight 1/16th + triplet grouping)",
        "Snare (tight shell, crisp attack, often layered with rim click)",
        "Percussion rolls (rapid hi-hat or shaker bursts before drops)",
        "Optional: 909 clap for added presence"
      ]
    },
    "groove": {
      "feel": "Half-time swagger with locked sub-bass. Kick sits behind snare (swung, 2 and 4 emphasis). Hi-hat pocket is tight, almost mechanical, contrasted against swung snare.",
      "syncopation": "Drill blends straight 1/16th note hi-hats with triplet 1/16th subdivisions in the same pattern, creating a skittering, restless energy. Snare hits on 2 and 4 with minor swing (10-15ms behind grid). 808 glides land on beat 1 and often the 'and' of beat 2, creating forward momentum.",
      "swing": "Snare swing (10-20ms), minimal kick swing to maintain sub-bass lock. Hi-hat timing shifts microscopically between straight and triplet subdivisions within each bar, creating urgency.",
      "pocketNotes": "The pocket is tight and claustrophobic by design—sub-bass sits immovable at 808 Hz, snare rides just behind the beat, hi-hats skitter ahead in bursts. This tension between laid-back sub and urgent hi-hats is the groove's signature. Vocals sit on top of the pocket, never ahead of it."
    },
    "vocalStyle": {
      "delivery": "Punchy, aggressive, deadpan. Vocals sit dry and upfront in mix; minimal reverb on lead vocal (often 0-5% pre-delay reverb for clarity). Cadence is rhythmic and percussive; phrasing follows the 808 root glides. UK drill favors London accent and street vernacular; NY drill uses Brooklyn/Bronx cadence with emphasis on power and dominance themes.",
      "adLibs": [
        "Ad-lib doubles layered behind lead vocal (call-and-response texture)",
        "Pitched vocal 'yeah' or 'uh' drops on beat anticipation",
        "Reverb-heavy ad-lib tails (contrast to dry lead)",
        "Doubled or tripled final words of punchlines for emphasis",
        "Breath and mouth clicks left in to add texture (intentional grit)"
      ],
      "harmonyApproach": "Minimal harmonic stacking. Vocals outline the chord progression via melodic line (matching 808 root or single note). Ad-libs may add countermelodies (a 3rd or 5th above lead), but hooks typically lock to unison with the 808 or strings. No rich vocal harmonies; emphasis is on rhythmic layering and call-and-response.",
      "languageMix": "UK drill: London slang, local references, street narrative. NY drill: Tri-state vernacular, gang-culture themes, luxury/power motifs. Both use heavy percussion-mimicking phonetics (spit consonants, 't' and 'k' sounds)."
    },
    "signatureElements": [
      "808 pitch slides (gliding between chord roots; 1/8th note timing standard)",
      "Syncopated hi-hat stutters (blend of 1/16th straight + triplet groupings)",
      "Dark orchestral strings or pads (UK signature, eerie harmonic support)",
      "Tight, swing-emphasized snare (2 and 4 locked to pocket)",
      "Single-note melodic outline (piano or pitched synth, not block chords)",
      "Dry lead vocal with reverb-heavy ad-lib contrast",
      "Minor key (almost exclusive; suspended or diminished voicings for tension)",
      "Minimal stereo width on drums (tight pocket); wide reverb tails on ad-libs",
      "140-150 BPM felt as half-time (perceived 70-75 BPM swagger)"
    ],
    "referenceArtists": [
      "Headie One (UK dark minimalism lane)",
      "Abra Cadabra (UK melodic + orchestral texture lane)",
      "Pop Smoke (NY sparse 808 + pitch-slide foundation lane)",
      "Fivio Foreign (NY aggressive delivery + street authenticity lane)",
      "Digga D (UK production sophistication, string arrangements lane)",
      "Central Cee (UK-US fusion, melodic hooks lane)",
      "Minikeyyy (UK emerging subgenre blends lane)",
      "Bnxn/Buju (UK-Afro drill crossover, rhythmic innovation lane)"
    ],
    "mixTraits": {
      "lowEnd": "Sub-bass locked at 808 Hz, isolated on its own track. Heavy distortion on 808 (2-4dB added harmonics via saturation). Kick sits behind 808 (110-200 Hz), never louder. Total low-end headroom strictly managed (-12 LUFS to -6 LUFS in sub region to avoid clipping on Bluetooth/phone speakers).",
      "drums": "Snare: 3-4 kHz punch + 10 kHz sheen, slight parallel compression for glue. Hi-hat: bright, 12-16 kHz emphasis, tight reverb (8-12ms pre-delay). Kick: sub-dominant, sidechain-compressed to 808 glide (so they don't mask each other). All drums sit in mono or narrow stereo (drums centered, ambience wider).",
      "vocals": "Lead vocal: completely dry or minimal reverb (45% tail), boosted 2-4 kHz for punch, -1 to -3 dB from mix ceiling. Doubled/ad-lib vocals: reverb-heavy (20-40% pre-delay, 2-3s tail), panned left/right for width, 2-6 dB lower than lead. Compression: light on lead (2:1 ratio), heavier on ad-libs (4:1) to control dynamics and punch ad-libs into pocket.",
      "space": "Lead vocal dry and upfront. Ad-libs use wide reverb (50-100ms pre-delay) and slight delay (200-300ms) to push them back. Strings/pads: smooth reverb (hall-style, 2-3s tail, very subtle send -15 dB). Overall mix width: stereo image focused center (drums + bass + lead vocal), ambience and effects pushed to sides. This creates claustrophobic intensity with moments of spatial release."
    },
    "productionPromptSnippet": "Dark, menacing drill beat. A minor key. 142 BPM. Gliding 808 bass locked to root notes with 1/8th note automation. Syncopated hi-hats blending straight 1/16ths with triplet subdivisions for skittering energy. Tight snare on 2 and 4 with swing. Orchestral strings or dark pads outline eerie harmony. Dry, punchy lead vocal with reverb-heavy ad-lib doubles underneath for call-and-response texture. Minimal chord movement; tension sustained via suspended voicings and minor-key drones. Sub-bass isolated and distorted for presence. Build into hook with intensified ad-libs and filter sweep on 808.",
    "freshnessGuardrails": "Drill is a high-velocity, rapidly-evolving subgenre. Avoid: dated string sample banks (post-2024 orchestral libraries only), overused melodic loops (check TikTok for saturation), generic trap 808 slides (drill 808 must have unique pitch contour + distortion character). DO refresh: ad-lib phonetic textures (contemporary slang, regional accent authenticity), 808 filter automation (LPF sweeps, resonance peaks), hi-hat micro-timing (shift triplet ratios for fresh pocket feel). Drill 2026 trend: melodic drill subgenre growth (minor-key melodies over traditional drum pocket), ambient/spacious drill (wider reverb, slower 808 glides), afro-drill crossover (afrobeat percussion layers + drill 808 foundation). Keep production sharp and modern; dated string pads instantly age the track.",
    "sources": [
      "https://orphiq.com/resources/drill-chords",
      "https://wavgrind.com/blogs/music-production/how-to-produce-drill-beats",
      "https://www.soundverse.ai/blog/article/how-to-make-drill-beats-0205",
      "https://blog.landr.com/drill-chords/",
      "https://g3n.ro/blog/uk-drill-vs-new-york-drill/",
      "https://vocalpresets.com/blog/best-drill-vocal-presets-2026",
      "https://www.cedarsoundstudios.com/blogs/news/how-to-mix-your-vocals-for-drill",
      "https://www.masterclass.com/articles/drill-music-guide"
    ]
  },
  "trap": {
    "genre": "trap",
    "displayName": "Trap (Atlanta Melodic & Hard)",
    "typicalBpm": 145,
    "bpmRange": [
      130,
      170
    ],
    "commonKeys": [
      "F# minor",
      "C minor",
      "D minor",
      "Bb minor",
      "G minor"
    ],
    "chordProgressions": [
      {
        "roman": "i - VI - v - iv",
        "description": "Dark-to-lift motion; F#m to A to C#m to Bm creates tension-release cycle with mixture of minor/major. Foundational melodic trap.",
        "whereUsed": "Main 8-16 bar loop, verses, builds"
      },
      {
        "roman": "i - VI - V - i",
        "description": "Hard trap: minor tonic, major VI (brightness), major V (drama), resolve down. Fm to Db to C to Fm (Waka Flocka school). High contrast.",
        "whereUsed": "Aggressive 4-bar hooks, drop sections, ad-lib moments"
      },
      {
        "roman": "i - iv - v",
        "description": "All-minor stacking: creates trapped, claustrophobic vibe. Dm to Gm to Am. Minimal but dense with bass movement.",
        "whereUsed": "Intro layers, loop repeats, build tension into drop"
      },
      {
        "roman": "vi - IV - I - V",
        "description": "Relative major borrowed chords for crossover/melodic trap. Am to F to C to G. Airy, radio-friendly, Travis Scott territory.",
        "whereUsed": "Chorus/hook space, atmospheric sections, vocal-friendly passages"
      }
    ],
    "arrangement": [
      {
        "section": "Intro (0-8s)",
        "bars": "2-4",
        "whatHappens": "Producer tag, atmospheric pad, or 808 bass hit on 1-2. Minimal drums. Establish key & mood instantly. No hi-hats yet."
      },
      {
        "section": "Build (8-24s)",
        "bars": "4-8",
        "whatHappens": "Add textured hi-hat rolls (16th/32nd triplets), kick pattern enters (on 1 + off-beat hits). 808 doubles bass. Keys layer in under bass. Swelling rather than jump."
      },
      {
        "section": "First Drop / Verse (24-56s)",
        "bars": "8-16",
        "whatHappens": "Full snare pattern (on 2 & 4), kick under 808 slide, hi-hat automation ramps, clap/snare rolls on bar 7-8 to tease next section. Main loop locked."
      },
      {
        "section": "Switch / Pre-Hook (56-72s)",
        "bars": "4",
        "whatHappens": "Drums strip back to kicks + open hats, melodic or vocal space, chord change or add reverb/delay. Quick compression sidechain pull."
      },
      {
        "section": "Hook / Chorus (72-96s)",
        "bars": "8",
        "whatHappens": "Groove tightens, melodic motif repeats (keys/pad), lighter 808, tight snare, ad-lib layering space, vocal upfront. High-frequency air."
      },
      {
        "section": "Verse 2 (96-144s)",
        "bars": "12-16",
        "whatHappens": "Reintroduce full drum kit, raise hi-hat velocity, add percussion floats (shakers, woodblocks), 808 pitch-bend slides, bass stabs between vocal phrases."
      },
      {
        "section": "Final Build / Bridge (144-160s)",
        "bars": "4-8",
        "whatHappens": "Strip vocals, kick on quarter notes, 808 on half-notes, hi-hats in triplet bursts. Tension plateau. Add risers or white-noise sweeps."
      },
      {
        "section": "Final Drop / Outro (160-180s)",
        "bars": "4-8",
        "whatHappens": "Massive kick + 808 sync, snare on 2/4, hi-hat fills, possible pitch-down or sidechain pumping for finality. Fade or hard stop."
      }
    ],
    "instrumentation": {
      "core": [
        "808 bass (pitched/slide)",
        "Kick drum",
        "Snare",
        "Clap",
        "Hi-hat (closed + open)",
        "Melodic keys (piano/Rhodes/strings)"
      ],
      "signature": [
        "TR-808 kick + sub 808",
        "Pitched 808 slides (half/full octave)",
        "Tight 16th-note hi-hat rolls",
        "Off-beat open hat hits"
      ],
      "percussion": [
        "Shaker (hi-pass filtered)",
        "Woodblock (2-4kHz)",
        "Cowbell (sparse)",
        "Clap stabs (layers: tight + washy)",
        "Snare rolls (fill sections)"
      ],
      "bass": "Sub-focused 808 with attack <5ms, sustain 200-600ms, pitch bend for lifts. Filter automation to thin during vocal moments. Double with 70Hz sine wave for club translation.",
      "guitar": "Sparse: fingerpicked lead or strummed pad underneath loop (Rhodes/electric guitar, heavily reverbed). Not lead instrument.",
      "keys": "Pad (airy, lush, 2-4 second decay), low-end stab (locked to bass root), arpeggiated melody fill (triplet hi-hat tempo). Spacious, not dense."
    },
    "groove": {
      "feel": "Pocket-trap: swung hi-hats and delayed kicks create float, not rigidity. Kick slightly behind grid, snare sits on 2/4 but opens hi-hat hits on 1 + 3 offbeat for bounce.",
      "swing": "6-12% swing on hi-hats (especially 16th rolls); kick swing optional (3-8%). Avoid metronomic grid; humanize with velocity layers.",
      "syncopation": "Kick hits: on 1, syncopated hits on beat 1.5, 2.5 (half-time feel). Snare locked 2/4, but layered claps offset +30-50ms for attack thickening. Hi-hat automation ramps for acceleration.",
      "pocketNotes": "The pocket lives in the space BEFORE the kick and AFTER the snare. Kick behind grid, snare on top of grid. Hi-hats push forward (rushing) on fills, fall back on loop sections. This creates perceived bounce without changing BPM."
    },
    "vocalStyle": {
      "delivery": "Conversational + melodic: raspy edge over smooth melodic runs (slight auto-tune with vibrato). Trap vocal sits 6-8dB above beat at peak, pulls back between phrases. Ad-libs over drums, not under.",
      "adLibs": [
        "Riser glottal hits (\"yeah\", \"turn up\")",
        "Layered doubles (2-3 octaves apart) on hooks",
        "Breath/whisper moments (intimacy)",
        "Melodic ad-lib fills in drum breaks",
        "Syncopated repeats over snare rolls"
      ],
      "harmonyApproach": "Vocals ride the i or VI chord, doubled high and low for thickness. Minimal harmony during verses, major harmony layers on chorus. Reverb tail on ad-libs (0.5-1.2s) for dream-trap effect.",
      "languageMix": "US English (Atlanta dialect: dropped g's, melodic phrasing). Bilingual trap mixes English + Spanish flows; code-switch on hook."
    },
    "signatureElements": [
      "808 slide pitch bend (half to full octave drop) on kick hit",
      "Hi-hat rolls at 1/16 or 1/32 triplet sub-divisions",
      "Snare on 2/4, layered with 2-3 clap velocities",
      "Sidechain compression (kick/808 ducks everything 5-8dB)",
      "Melodic motif in first 8 seconds (hooks retention)",
      "Reverb throws on vocal ad-libs (0-100% wet reverb 100-200ms pre-delay)",
      "Filter sweep on pads (automate cutoff during builds)",
      "Pitched 808 stabs between vocal phrases",
      "Open hi-hat sustain into next kick (0.1-0.3s overlap)"
    ],
    "referenceArtists": [
      "Travis Scott (melodic layering, production space)",
      "Metro Boomin (808 motion, hi-hat precision)",
      "Southside (dark harmonic approach, PlugTrap)",
      "London On Da Track (melodic 808 bends, crossover appeal)",
      "DJ Carnage (hard trap edge, collision sounds)",
      "Mike Dean (post-production polish, sidechain texture)"
    ],
    "mixTraits": {
      "lowEnd": "Sub-bass: 30-80Hz energy locked to kick. Fundamental 808 sits 80-150Hz. Mid-bass (200-400Hz) tight and punchy, not boomy. Sidechain kick/808 ducker on bass bus -5dB at kick transient.",
      "drums": "Kick: bright attack (0.5-2kHz sheen), punchy sustain (2-4 bar decay). Snare: tight top end (5-10kHz), crisp transient, 80-100ms reverb. Hi-hats: 8-16kHz presence peak, avoid muddiness. Claps layered with 2-3 variations.",
      "vocals": "Lead vocal: warm mid-range (2-3kHz), slight de-esser (8-12kHz), -3dB sidechain to beat. Ad-libs: bright, airy, send 40-60% to reverb bus. Doubles: center panned, -1 to -2dB below lead, tight compression.",
      "space": "Main reverb: 1.2-1.5s decay, 100-200ms pre-delay, send automation (vocals up, kick/snare minimal). Parallel compression on 2-bus: 4:1, -8dB makeup gain, 10ms attack. Loud master: -3 to -6 LUFS (streaming competitive). Stereo width: pad in L/R 40-60%, tight drums center, vocal center-left (-3dB)."
    },
    "productionPromptSnippet": "Dark minor-key 808 trap with tight hi-hat rolls, sidechain bounce, melodic pads, and conversational raspy vocals layered with ad-libs; 145 BPM, polished but aggressive.",
    "freshnessGuardrails": "Keep 808 motion (slides/filters) active every 4-8 bars. Avoid static chord loops beyond 16 bars without drum or melodic switch. Refresh drum patterns (hi-hat velocity curve, kick timing) every 32 bars to combat listener fatigue in short-form. Ensure melodic hook or producer tag hits within 8 seconds for TikTok/Reels retention.",
    "sources": [
      "https://houseoftracks.com/faq/what-is-the-typical-tempo-range-for-trap-music",
      "https://producerfury.com/resources/trap-bpm-guide",
      "https://lukemounthillbeats.com/music-production/how-to-choose-beat-tempo-and-key/",
      "https://splice.com/blog/what-is-trap-music/",
      "https://beatstorapon.com/charts/subgenre/trap",
      "https://emastered.com/blog/trap-chord-progressions",
      "https://unison.audio/trap-chord-progressions/",
      "https://buffer.com/resources/trending-songs-tiktok/",
      "https://emastered.com/blog/best-trap-drum-kits",
      "https://cymatics.fm/blogs/production/trap-samplepack-808-samples"
    ]
  },
  "house": {
    "genre": "house",
    "displayName": "House",
    "bpmRange": [
      115,
      130
    ],
    "typicalBpm": 123,
    "commonKeys": [
      "A",
      "E",
      "G",
      "C",
      "F",
      "D"
    ],
    "modalFlavor": "Mixolydian dominant with aeolian undertones; deep house favors minor 7th and 9th extensions for soulful color",
    "chordProgressions": [
      {
        "roman": "i-VII-VI-VII",
        "description": "Afro house signature—minor-modal loop with flattened 7th creating hypnotic, grounded tension; typically 2–4 bars per chord",
        "whereUsed": "Intro, main loop, extended breakdowns; staple of melodic afro and deep house"
      },
      {
        "roman": "I-vi-IV-V",
        "description": "Classic house pop crossover; warm major tonic grounding with vi submediant pull; lifts energy before peak",
        "whereUsed": "Chorus, build section, radio-friendly house"
      },
      {
        "roman": "vi-IV-I-V",
        "description": "Intimate soul-house progression; vi minor start feels introspective, IV lift adds warmth, repeated 4+ bars",
        "whereUsed": "Vocal-driven verses, emotional builds, soulful deep house"
      },
      {
        "roman": "i-i-VII-VII",
        "description": "Minimalist afro groove; stacked suspended chords creating rhythmic anchor rather than harmonic motion",
        "whereUsed": "Percussion-heavy intro/outro, groove beds in afro house"
      }
    ],
    "arrangement": [
      {
        "section": "Intro (0–32 bars)",
        "bars": "0–16: Drum machine foundation (TR-808/909 four-on-floor kick, off-beat hats, light shaker); 16–32: Add filtered bass and first chord loop (i or iv), minimal hi-pass filtering on melodic elements",
        "whatHappens": "Establish pocket and key; listeners recognize the lane within 8 bars; layering is sparse, focus on texture"
      },
      {
        "section": "Build A (32–64 bars)",
        "bars": "32–48: Introduce pad/keys playing chord progression (vi-IV or i-VII); add synth countermelody or clavinet stab every 4 bars; 48–64: Second synth layer, deeper bass movement, snare/clap pattern locks in",
        "whatHappens": "Energy climb without dropping; drums stay consistent, harmonic depth grows; hint at 1–2 hook synths but don't fully deploy"
      },
      {
        "section": "Verse/Vibe (64–96 bars)",
        "bars": "64–80: Vocal enters (if present) over locked groove; chord loop repeats 2–4 bars per shift; 80–96: Strip back to half drums or delay-heavy sparse moment, vocal holds over loop, organic percussion (cowbell, shaker, wood block) adds swing pocket",
        "whatHappens": "Lyrical or atmospheric focal point; groove locks tight; room for improvisation/ad-lib; panning effects on vocals or reverb tails"
      },
      {
        "section": "Pre-Drop (96–112 bars)",
        "bars": "96–104: Hats rise (8th or 16th note rhythms), bass gets dirtier, remove one synth layer to build anticipation; 104–112: White noise swell or reverb crash, drums hit final 4-bar buildup, anticipation peaks",
        "whatHappens": "Peak tension; everything tightens rhythmically; hi-pass and lo-pass filters sweep; crowd/listener expects climax"
      },
      {
        "section": "Drop/Peak (112–144 bars)",
        "bars": "112–128: All drums and bass hit together; full synth palette (hook, strings, pads) active; main groove locked; 128–144: First drop repeat or variation; bass riff might invert, snare moves to new pocket, add filtered percussion layer",
        "whatHappens": "Maximum energy and impact; all elements fused; dancefloor moment; typically sustains 16–32 bars before next movement"
      },
      {
        "section": "Breakdown (144–176 bars)",
        "bars": "144–160: Strip to bass, one synth, sparse drums (break beat or off-beat hi-hats); minimal, spacious; 160–176: Organic layer (strings, vocal loop, pad swell) emerges; low-end groove still locked",
        "whatHappens": "Respite before next build; listeners catch breath; remix-style reduction; DJ/listener can remix or mashup here"
      },
      {
        "section": "Build B (176–208 bars)",
        "bars": "176–192: Synth riff evolves, chords shift (might modulate up half-step or explore vi); add new percussion layer (snap, cowbell polyrhythm); 192–208: Bass gets more assertive, reverb tails multiply, tension rises",
        "whatHappens": "Second wave energy; variation on intro energy; prevents repetition fatigue; feels fresh but recognizable"
      },
      {
        "section": "Final Drop (208–240 bars)",
        "bars": "208–224: Drop similar to first but with added synth textures, bass variation, or vocal stab frequency shift; 224–240: Sustain at peak, repeating 4–8 bar loop for dancefloor duration",
        "whatHappens": "Triumph and satisfaction; longest sustained peak; designed for extended DJ mix or radio play; bass and drums unwavering"
      },
      {
        "section": "Outro (240–256+ bars)",
        "bars": "240–252: Remove synth layers one-by-one; bass remains, kick softens to half-time or filtered out; hi-hats fade; 252+: Final vocal stab or pad reverb tail; pad resolves, drums disappear into silence or fade",
        "whatHappens": "Graceful exit; DJ can loop or transition; listener reflects on groove; typically 8–16 bars; room for DJ scratching or FX"
      }
    ],
    "instrumentation": {
      "core": [
        "Kick drum (TR-808, TR-909, or 4/4 boom—essential, locked on 1–2–3–4)",
        "Hi-hat (off-beat, eighth or sixteenth note swing; often sidechain-compressed)",
        "Deep sub-bass (80–120 Hz anchor, often sidechained to kick)",
        "Synth pad or strings (soulful, warm 7th/9th chords; filter sweeps)",
        "Clavinet or electric piano riff (punctuates every 4–8 bars, adds swing)"
      ],
      "signature": [
        "Filtered synth stab (pluck/string tone, played on offbeats for pocket)",
        "Filtered bassline riff (playing a 2–4 bar melodic phrase alongside sub)",
        "Atmospheric reverb tail or delay (on vocals, synth, or percussion)"
      ],
      "percussion": [
        "Shaker or ride cymbal (groove-locking hi-frequency pulse)",
        "Clap or tight snare (beats 2 and 4, sometimes syncopated)",
        "Cowbell or wood block (polyrhythmic accent, especially afro house)",
        "Conga or bongo (optional, used in afro and soulful lanes)",
        "Snap or finger click (played low in the mix for swing)",
        "Clave pattern (subtle, often hi-hat or electronic sim in chicago/deep house)"
      ],
      "bass": "Dual-layer: sub-bass (sidechain-pumping 808/sine, 40–80 Hz) locked to kick; melodic bass riff (100–250 Hz, synth or reese bass, 2–4 bar phrase playing intervals or motion against root)",
      "guitar": "Optional; typically electric nylon-string guitar (wet reverb, strummed or fingerpicked soulful chords) or clean Stratocaster riff (jazz-house crossover); panned left/right for stereo depth; not core to house but common in soulful/jazz-house lanes",
      "keys": "Warm, breathy pad (Fender Rhodes, Wurlitzer, vintage moog pad sound); plays chord progression slowly, often 1 note per bar; clavinet or electric piano for rhythmic stabs; occasional 9th or 13th extended voicings for soulfulness"
    },
    "groove": {
      "feel": "Hypnotic, pocket-locked, groove-forward. House builds from repetition and incremental layering, not chord changes. The pocket is the message; the groove breathes with human swing despite electronic drums.",
      "pocketNotes": "Kick is 100% on beat one, but hi-hat rides 8th or 16th note swing (8–12% ahead on off-beats creates walk-forward energy). Bass riff locks tight to kick on downbeat, then sits slightly behind the beat (ghost-groove pocket) for funk. Clap/snare on 2 and 4 sits dead center or just behind beat. Cowbell or woodblock accent often plays syncopated cross-rhythms (triplet pushes, 16th-note flourishes) against the 4/4 grid—this is the afro-house signature.",
      "swing": "Subtle but essential; 8–15% swing on hi-hats and light percussion keeps the groove alive and prevents robotic feel. Swing tightens toward peak (reduces to 5%) and loosens in breakdowns (15–20%).",
      "syncopation": "Snare backbeat (2, 4) is straight; hi-hat and shaker live in swung 8th or 16th space. Bass riff often plays syncopated intervals (off-beat stabs, triplet pickups into downbeat). Claps sometimes stacked on 2.5, 3.5 for ghost-snare depth. Vocal rhythms and ad-libs sit behind beat (laid-back, soulful—never tight front)."
    },
    "vocalStyle": {
      "delivery": "Conversational, soulful, warm. Vocals sit low in the mix (not lead), playing groove role. Delivery is late to the beat (50–100ms behind), creating intimacy and laid-back vibe. Not belted or aggressive; breathy, sometimes whispered, often double-tracked with light harmonies. Rap/spoken elements are rhythmic, percussive, riding the pocket. House vocals are about *feeling* the groove, not showing off range.",
      "adLibs": [
        "Vocal chops (hi-pass filtered, 2–4 bars repeating loop, often on chord change)",
        "Talk-box or vocoder riff (over drop, rhythmic vocalized phrase)",
        "Ad-lib runs (short 1–2 second vocal flourishes on breakdown, landing just after snare)",
        "Hummed or breathed pads (underneath chords, wordless soulfulness)",
        "Call-and-response (single phrase repeated by backing vocal, community feel)",
        "Whispered reverb-drenched hook (repeated 4x, then stripped for impact)"
      ],
      "harmonyApproach": "Tight, supporting; vocals harmonize over minor 7th or 9th chords (not over root). Second vocal enters at 50% volume, 50–100ms late, creating lush doubling. Gospel-influenced thirds and sixths common in soulful house. No major 3rds in harmony over minor i chords; stick to minor intervals (3rds, 5ths, 7ths) for cohesion. Backup vocals often pad the frequency (200–600 Hz), letting lead shine in presence."
    },
    "signatureElements": [
      "Sidechained kick-to-sub bass pump (visual heartbeat)",
      "Off-beat hi-hat swing locked to 8th or 16th note grid, creating forward pocket",
      "Synth-pad or strings playing sustained 7th/9th chords (soulful, never major)",
      "Filtered bassline riff (melodic motion independent of kick)",
      "Vocal stab or clavinet punctuation every 4 bars (keeps pocket tight)",
      "Cowbell or wood-block polyrhythmic counter-rhythm (especially afro house)",
      "Reverb tail/delay on vocal or synth, creating space and mystique",
      "White-noise swell or filter sweep in pre-drop (anticipation signal)",
      "Sparse breakdown (kick + bass + one synth layer) for respite and remix potential",
      "Clave pattern (subtle, often hidden in hi-hat or electronic simulation)"
    ],
    "referenceArtists": [
      "Solomun (melodic-house architect, Pacha residency; style lane: layered, introspective, warm)",
      "Peggy Gou (crossover sensibility, soulful pop-house; style lane: accessible, groove-locked, uplifting)",
      "Honey Dijon (Chicago-Berlin bridge, technical deep house; style lane: classic house roots + fashion-forward production)",
      "MK (Marc Kinchen, veteran house producer, remix master; style lane: peak-time energy, radio-friendly soulfulness)",
      "Fleur Shore (rising UK talent, tech-house sophistication; style lane: tight percussion, hypnotic builds)",
      "ESSEL (emotional deep house, progressive builds; style lane: cinematic, breakbeat-inflected)",
      "Mondigo (folk-electronic hybrid, singer-producer; style lane: organic instrumentation, narrative-driven)",
      "Dennis Ferrer (NYC house legacy, soulful grooves; style lane: gritty, real drums, jazz-influenced)",
      "Black Coffee (South African deep house pioneer; style lane: afro-influenced, organic percussion, DJ-centric)",
      "Carl Cox (veteran techno-house bridge; style lane: peak-time festival energy, tribal rhythms)"
    ],
    "mixTraits": {
      "lowEnd": "Sub-bass locked to kick via sidechain; sits at 40–80 Hz, -6 dB sidechain depth (kick pulls bass down 6 dB, recovers in 50–100ms). Melodic bass riff lives at 100–250 Hz, never competing with sub. Room at 300–600 Hz for warmth but not muddiness. High-pass filter everything above kick and sub.",
      "drums": "Kick is present and punchy (attack 0–5ms, sustain 80–120ms); no tail bleed into low-mid. Hi-hat is bright, sidechain-compressed to kick (light, 2–3 dB reduction) so it breathes. Snare/clap sits at 200 Hz (body) + 4–6 kHz (crack); never washed in reverb. Percussion (cowbell, shaker) panned left/right stereo, 40% level to kick, lightly compressed.",
      "vocals": "Vocals sit at -6 to -3 dB relative to kick; never louder. Lead vocal 200 Hz (warmth) + 3–5 kHz (clarity) boosted lightly; hi-pass filter at 80 Hz. Reverb on vocal (1.2–2.5 second decay, early reflections tight) creates space without lag. Double-track harmonies at -9 dB, panned 30% left/right. Ad-lib vocal chops heavily filtered (8 kHz hi-pass) and reverb-drenched (50% wet, 100% feedback). Sidechain vocal reverb tail to kick (reverb pumps with kick).",
      "space": "Master reverb (plate or hall, 1.5–2.0 second decay) on synth pads, clavinet stabs, and vocal tails (30% send). Delay on lead vocal (1/4 or 1/8 note tempo sync, 25% feedback, medium depth) for tail interaction. Chorus/phaser on filtered synth layers (1 octave spread, subtle modulation) for width. Stereo imaging: kick/bass center, hi-hat 30% left/right, vocals 10–15% L/R, pads 50% L/R. Master EQ: slight cut at 250 Hz (boxing), slight boost at 100 Hz (warmth) and 6 kHz (clarity).",
      "loudness": "Target LUFS: -6 to -4 LUFS (club playback); -5.5 to -3.5 LUFS (streaming). Peak limiting at -1 dB to prevent clipping; soft-knee ratio 4:1. Compression on master (ratio 2:1, attack 20ms, release 150ms) to control dynamics without flatness. No parallel compression (sidebands); let groove breathe. Mixing at -18 dBFS headroom standard."
    },
    "productionPromptSnippet": "Warm, pocket-locked house groove with hypnotic drum-machine foundation (TR-808/909 four-on-four kick, swung hi-hats), deep sidechain-pumped sub-bass, soulful synth pads playing minor 7th/9th chords, filtered melodic bass riff, breathy laid-back vocals doubled and early-reverb drenched, cowbell and woodblock polyrhythms (afro-house signature), clavinet or electric-piano stabs locking pocket every four bars, white-noise swell anticipation, sparse breakdown moments for DJ remixing; climax in peak-time drop with all elements fused; aim for 120–126 BPM, minimal 4/4 beat with groove-forward ethos not chord-driven architecture.",
    "freshnessGuardrails": "Avoid: Overuse of 808 tail (causes muddiness, keep sidechained tight); overstretched reverb on vocals (creates soup instead of space, set decay 1.5–2s max); major 3rd in chord voicings over minor-key tracks (breaks soulful mood, stay in 7ths/9ths/suspensions); static chord loop without melodic bass motion (boring, always add riff or inversion cycle); vocals too loud or bright (kills intimacy, sit low and late-to-beat); absence of polyrhythmic elements in afro variants (loss of cultural signature, include cowbell/clave). Do include: Sidechain pump on every drop; swung hi-hat + locked kick interplay; at least one filtered synth sweep or build; vocal double-track harmony; minimal breakdown moment; bass riff independent of kick rhythm.",
    "sources": [
      "https://playhousesound.com/the-best-bpm-for-afro-house/",
      "https://www.samplesoundmusic.com/blogs/news/the-ultimate-guide-to-afro-house-production-in-2025-tips-tricks-and-techniques",
      "https://www.zipdj.com/blog/house-music-bpm",
      "https://medium.com/@solosazesahora/why-house-music-will-be-the-defining-sound-of-2026-60634d3641b5",
      "https://andysowards.com/blog/2026/guide-to-edm-subgenres-in-2026-house-techno-dubstep-more/",
      "https://www.stereofox.com/articles/fastest-rising-electronic-music-genres/",
      "https://reposternetwork.com/blog/house-music-subgenres-guide-2026",
      "https://www.edmsauce.com/2026/03/27/top-edm-subgenres-dominating-2026-and-the-best-tracks-in-each/",
      "https://djmag.com/features/dj-mags-artists-watch-2026"
    ]
  },
  "edm": {
    "genre": "edm",
    "displayName": "Electronic Dance Music (Festival / Electro / Future Bass)",
    "bpmRange": [
      110,
      180
    ],
    "typicalBpm": 128,
    "commonKeys": [
      "C minor",
      "A minor",
      "D minor",
      "F# minor",
      "Eb major",
      "G major"
    ],
    "chordProgressions": [
      {
        "roman": "i-III-VII-VI",
        "description": "Minor key euphoria: cycles through relative major chords (e.g., C#m-E-B-A). Creates pure lift and emotional release. Avicii staple.",
        "whereUsed": "Future bass, progressive house, melodic techno breakdowns"
      },
      {
        "roman": "iii-vi-IV-V",
        "description": "Tension loop that avoids home chord; hovering feel keeps forward momentum without resolution.",
        "whereUsed": "Tech house, hard techno builds, peak-time energy sustain"
      },
      {
        "roman": "IV-I-vi-V",
        "description": "Starts on the subdominant; pushes emotionally forward rather than settling. Opens space for emotional journey.",
        "whereUsed": "Melodic techno, progressive house, afro house"
      },
      {
        "roman": "I-V-vi-IV",
        "description": "The festival anthem: classical pop progression adapted for electronic drop moments. Familiar, massive impact.",
        "whereUsed": "Mainstage festival tracks, future bass, electro house"
      },
      {
        "roman": "i-i (one-chord vamp with texture)",
        "description": "Minimal harmonic anchor; lead riff, buildup sequence, and drum architecture carry the narrative. Raw power.",
        "whereUsed": "Hard techno, drum & bass, industrial-edge festival breaks"
      }
    ],
    "arrangement": [
      {
        "section": "Intro (0-16 bars)",
        "bars": "Bars 1-8: Single synth pad or atmospheric texture; breakbeat sample, or reversed vocal snippet. Bars 9-16: Kick drum enters, sub-bass introduced quietly, filter slowly opening.",
        "whatHappens": "Establish BPM and key; create mystery and intrigue before energy explodes."
      },
      {
        "section": "Build 1 (16-32 bars)",
        "bars": "Bars 17-24: Snare/clap layering in. Bars 25-28: Risers, drum fills intensify. Bars 29-32: Breakdown on drop precipice.",
        "whatHappens": "Ramp tension systematically; each 4-8 bars adds a new percussive or harmonic layer."
      },
      {
        "section": "Drop 1 (32-48 bars)",
        "bars": "Bars 32-36: IMPACT - massive kick + sidechained supersaw, harmonically aligned. Bars 37-40: Bass locks into groove. Bars 41-44: Hihats, shaker, percussion. Bars 45-48: Variation.",
        "whatHappens": "Peak release of energy. Kick and bass in sync, driving 4-on-the-floor."
      },
      {
        "section": "Mid-Section / Breakdown (48-80 bars)",
        "bars": "Bars 48-56: Strip to minimal. Bars 57-64: New melodic hook or filter-modulated lead. Bars 65-72: Sparse percussion. Bars 73-80: Rebuild tension.",
        "whatHappens": "Reprieve from drop; reset emotional narrative. Prepare for second build."
      },
      {
        "section": "Build 2 (80-104 bars)",
        "bars": "Bars 80-88: Aggressive risers and drum fills. Bars 89-96: Layers return, pitched up or with added harmonics. Bars 97-104: Final tension peak.",
        "whatHappens": "Second anticipation wave. Often more intense than Build 1."
      },
      {
        "section": "Drop 2 (104-120 bars)",
        "bars": "Bars 104-112: New harmonic variation or vocal melody over kick/bass. Bars 113-120: Variation or sustained groove.",
        "whatHappens": "Climax energy; second drop often more euphoric than first."
      },
      {
        "section": "Outro / Breakdown (120+ bars)",
        "bars": "Bars 120-128: Strip progressively. Bars 129-136: Pad or atmospheric outro. Final 4-8 bars: Singular signature sound decays.",
        "whatHappens": "Cool-down and emotional landing. Sets up DJ transition."
      }
    ],
    "instrumentation": {
      "core": [
        "Four-on-the-floor kick drum (808, analog, or designed kick)",
        "Sub-bass + top-bass (dual-layer bass architecture)",
        "Lead supersaw or wavetable synth (melodic anchor)",
        "Atmospheric pad or pad stack (emotional depth)",
        "Vocal sample or loop (cultural/emotional texture)"
      ],
      "signature": [
        "Risers (white-noise sweeps, synth pitch ramps)",
        "Sidechain compression (glue + pump feel)",
        "Filter modulation (LFO-driven movement)",
        "Reverb/delay tails (space and depth)"
      ],
      "percussion": [
        "Kick drum (tight, punchy, tuned to key)",
        "Snare or clap (layered, 2-3 samples deep)",
        "Hi-hats (open/closed, shuffle emphasis)",
        "Shaker or hi-hat variations (micro-feel)",
        "Pitched percussion (ethnic drums, afro elements)",
        "Breakbeats (drum & bass, speed garage phases)"
      ],
      "bass": "Dual-layer bass: sub-bass (sine, sub-80 Hz, warmth) + top-bass (sawtooth/square, 80-400 Hz, definition). Sidechained to kick for groove clarity.",
      "keys": "Soft pad (atmospheric), synth strings (lift), vintage organ (tech house), Fender Rhodes (melodic techno), pluck synth (texture), bass synth (harmonic anchor)"
    },
    "groove": {
      "feel": "Propulsive 4-on-the-floor pulse with micro-timing shuffle. Pocket sits locked to grid with intentional ghost-note hi-hat deviations creating human breathe.",
      "pocketNotes": "Kick + bass locked. Snare just behind beat (ghost-note pocket). Hi-hats dance around grid on shuffle. Clap cracks with attack clarity.",
      "swing": "EDM swing minimal (3-8%). Shuffle emphasis on 16th-note hihats. Afro house exception: explicit shuffle pocket (15-25% swing).",
      "syncopation": "Driven by layered percussion. Snare on 2 & 4, hihats syncopate 16th-note subdivisions. Lead synth syncopates against drum grid."
    },
    "vocalStyle": {
      "delivery": "Future bass: silky, melodic, layered with harmonies. Afro house: conversational, soulful, percussive. Tech house: sparse, processed. Hard techno: raw power or instrumental. Emotion over lyrics.",
      "adLibs": [
        "Vocal chops (stuttered/glitchy FX)",
        "Melodic runs (riffs over chord changes)",
        "Atmospheric sighs/breaths (vulnerability texture)",
        "Filtered vocal sweeps (modulation effect)",
        "Vocal percussion (clicks, tongue rolls, beatboxing)",
        "Call-and-response with synth lead",
        "Doubled/tripled voices (harmony layering)",
        "Reverb-tailed vocal tails (extending sustain)"
      ],
      "harmonyApproach": "Diatonic stacking (thirds, fifths). Future bass: 7th/9th/13th chords. Afro house: pentatonic ad-lib runs. Hard techno: percussive, rhythmic vocal texture.",
      "languageMix": "English dominant; Spanish/Afrobeats in afro house. Multilingual TikTok hooks. Often phonetic vocal texture."
    },
    "signatureElements": [
      "Supersized sub-bass drop (tactile, visceral low-end)",
      "Filter LFO sweep (opening/closing energy)",
      "Sidechain pump (kick modulating melodic layers)",
      "Risers preceding drops",
      "Vocal chops/stabs (sampled, layered for rhythm)",
      "Breakbeat or drum-fill variation (structural signal)",
      "Supersaw synth (5-voice unison with detune)",
      "Pitched percussion (tuned to key, harmonic richness)",
      "Reverb decay tails (extends beyond beat grid)",
      "Filtered or vocoded vocals (human + machine synthesis)"
    ],
    "referenceArtists": [
      "Avicii (euphoric progressivism, harmonic depth)",
      "Calvin Harris (tech house groove precision)",
      "Martin Garrix (big room festival architecture)",
      "Swedish House Mafia (anthem progression mastery)",
      "Deadmau5 (progressive tech house, technical production)",
      "Disclosure (future bass sensibility, vocal integration)",
      "Kaytranada (afro-influenced groove, sample curation)",
      "Amelie Lens (hard techno intensity, emotional sophistication)",
      "Dixon (melodic techno cinematic builds)",
      "Black Coffee (afro house soulfulness, percussive depth)"
    ],
    "mixTraits": {
      "lowEnd": "Sub-bass 30-60 Hz (felt not heard). Top-bass 100-300 Hz (punchy). Kick 80-120 Hz sweet spot. Gain-staging prevents mud.",
      "drums": "Kick: tight, <50ms attack, fast release. Snare: 2-4 dB hotter, transient shaping for crack. Hi-hats: compressed, -12 to -8 dB from kick.",
      "vocals": "Plate reverb 1.5-2.5s. Ad-libs slightly compressed (4:1, fast attack). Layered panned L/R +/-15-20%. Lead vocal centered with stereo pad.",
      "space": "Global reverb return -15 to -12 dB. Delay on ad-libs (dotted 8th, 350-450ms, -20 dB). Stereo width +/-8-12 dB panning."
    },
    "productionPromptSnippet": "Driving 4-on-the-floor kick with massive sidechain; layered sub-bass + top-bass; euphoric or intense supersaw/wavetable synth; atmospheric pad bed; filtered vocal samples or ad-libs; builds with risers and drum fills; drops coordinated kick-bass-lead impact; minimal chords, maximal texture and groove.",
    "freshnessGuardrails": "Avoid: thin kick, murky bass (freq clash), static chord loops, unprocessed vocals, drops without filter/sidechain, breakdowns losing groove, reverb washing rhythm. Verify: sub-bass locked to kick, vocal delivery matches arc, BPM in subgenre range, 1-2 new production elements per section.",
    "modalFlavor": "Minor key dominance (C#m, A minor, D minor) for melancholic/euphoric contrast. Relative major chords create shifts. Afro house: pentatonic modal color. Hard techno: minimal harmonic anchors. Progressive house: modal interchange.",
    "sources": [
      "https://www.zipdj.com/blog/edm-bpm",
      "https://vibesdj.io/dj-tools/edm-genre-chart",
      "https://www.edmsauce.com/2026/03/27/top-edm-subgenres-dominating-2026-and-the-best-tracks-in-each/",
      "https://www.soundverse.ai/blog/article/how-to-produce-edm-music-0832",
      "https://futureproofmusicschool.com/blog/unlocking-the-secrets-of-edm-chord-progressions",
      "https://emastered.com/blog/edm-chord-progressions",
      "https://lockah.net/basic-music-theory-for-electronic-music-producers/",
      "https://www.edmsauce.com/2026/03/27/most-viral-tiktok-edm-electronic-tracks-of-2026-so-far/"
    ]
  },
  "reggaeton": {
    "genre": "reggaeton",
    "displayName": "Reggaeton (Latin Urbano)",
    "bpmRange": [
      85,
      100
    ],
    "typicalBpm": 92,
    "commonKeys": [
      "A",
      "E",
      "D",
      "G",
      "B"
    ],
    "chordProgressions": [
      {
        "roman": "I–V–vi–IV",
        "description": "Uplifting perreo anchor; roots-forward and hook-friendly. Drives dancefloor energy.",
        "whereUsed": "Chorus, high-energy sections, festival versions"
      },
      {
        "roman": "vi–IV–I–V",
        "description": "Darker, introspective minor-key flow; moody reggaeton trap hybrid for TikTok/urban contexts.",
        "whereUsed": "Verses, emotional build-ups, street/regional variations"
      },
      {
        "roman": "IV–I–V–I",
        "description": "Trap-influenced loop; modern Mexican reggaeton (chugg subgenre) staple.",
        "whereUsed": "Beat switch, remix drops, plugg-fusion moments"
      },
      {
        "roman": "I–vi–IV–V",
        "description": "Melodically rich pop-fusion; contemporary chart reggaeton (Bad Bunny influence).",
        "whereUsed": "Radio-friendly hooks, streaming optimization"
      }
    ],
    "arrangement": [
      {
        "section": "Intro (0–8 bars)",
        "bars": "8",
        "whatHappens": "Sparse: minimal 808 sub-bass, dembow kick skeleton (1 + and of 2), hi-hat texture. Builds tension for drop. Optional: ambient pad or vocal chop."
      },
      {
        "section": "Verse 1 (8–24 bars)",
        "bars": "16",
        "whatHappens": "Full dembow pattern + rolling 808 bass, congas/timbales for pocket. Light synth pluck or delayed vocal reverb. Rapper/singer enters with storytelling or flex flow. Snare on 3 + clap on offbeats."
      },
      {
        "section": "Pre-Chorus (24–32 bars)",
        "bars": "8",
        "whatHappens": "Energy climbs: add bright hi-hat roll, stacked vocal harmonies, synth riff rises. Kick stays locked to dembow. Builds anticipation."
      },
      {
        "section": "Chorus (32–48 bars)",
        "bars": "16",
        "whatHappens": "Peak energy. Full instrumental: dembow + fat 808 (side-chained to kick for pump), congas doubled, shakers/cowbells fore. Hook is infectious, rhythmically locked. May double vocal or layer ad-lib (perreo chants, 'Dale!', breath clicks)."
      },
      {
        "section": "Verse 2 (48–64 bars)",
        "bars": "16",
        "whatHappens": "Same skeleton as Verse 1, but may include beat variation (trap snare roll, delay effect, low-pass filter sweep). Second rapper or new melodic idea. Maintain groove pocket."
      },
      {
        "section": "Bridge (64–72 bars)",
        "bars": "8",
        "whatHappens": "Sudden texture shift (optional): sub-bass drop, hi-hat cut, vocal acapella moment, or half-time feel. Resets listener for final chorus push."
      },
      {
        "section": "Final Chorus (72–88 bars)",
        "bars": "16",
        "whatHappens": "Identical or expanded Chorus with extra vocal layers, added percussion (timbale cascade), possible ad-lib flourish (freestyle ad-lib)."
      },
      {
        "section": "Outro (88–104 bars)",
        "bars": "16",
        "whatHappens": "Dembow strips back to intro skeleton. Vocal chop/vocal tag repeats (perreo chant, artist signature phrase). 808 fades. Last 2 bars minimal—kick + click, vocal echo out."
      }
    ],
    "instrumentation": {
      "core": [
        "dembow kick pattern (programmed, 808-based)",
        "snare/clap (bright, punchy)",
        "hi-hats (tight, syncopated)",
        "sub-bass (rolling, side-chained 808)"
      ],
      "signature": [
        "congas (looped, layered)",
        "timbales (accents, pocket groove)",
        "cowbell/shaker (rhythmic texture)",
        "reverse cymbal or whoosh (build tension)"
      ],
      "percussion": [
        "congas (main pocket lock, 'and' of 2)",
        "timbales (accents, cascading fills)",
        "cowbell (rhythmic texture, bright 800–1200Hz)",
        "shaker (bright, top-end shimmer)",
        "bongos (occasional, side pocket)",
        "agogo bells (occasional, festive moments)",
        "triangle or shaker rolls (build texture)"
      ],
      "bass": "Synthesized 808 or trap kit sub-bass; warm, sub-20Hz emphasis. Locked to dembow kick. Side-chain compression for pump-and-release feel. Often filtered up/down for variety.",
      "guitar": "Minimal. Optional: delay-drenched electric stab on offbeat (e.g., on the 'and' of beat 2); common in reggaeton trap hybrid. Rarely strummed—percussive texture only.",
      "keys": "Bright synth pluck, pad, or electric piano stab. Often de-tuned or slightly off for grit. May double melody in chorus. Typical: bright mid-range presence (2–5kHz). Often a quick percussive stab rather than sustained chord."
    },
    "groove": {
      "feel": "Laid-back bounce with relentless forward energy. Syncopated pocket on the offbeat ('and' of 2 and full 3). Perreo-ready: designed for grinding, hip sway, and body lock.",
      "swing": "Slight (approx. 51–52% swing on 16th-note hi-hats); not straight, not heavy swing—urban pocket feel.",
      "syncopation": "High. Dembow's 3+3+2 tresillo cross-rhythm creates intentional 'lag' vs. straight beat. Snare intentionally behind grid for human touch; typically –15ms to –30ms. Kick may sit just ahead of 1 for aggression.",
      "pocketNotes": "The 'pull' is everything: hi-hats and snare slightly late, kick slightly early. This creates a tension that drives dancers. Pocket sits between straight and swung. Congas lock into the 'and' of 2 for pocket lock. Bass note entry is often delayed by 1–2 ticks post-grid for groove glue."
    },
    "vocalStyle": {
      "delivery": "Conversational, rhythmically syncopated rap-sing hybrid. Flow often sits between melody and spoken word. Common: syllabic staccato on beat with rhythmic breath accents. Ad-lib culture is peak.",
      "adLibs": [
        "'Dale!' (Let's go!)",
        "'Perrea!' (Grind!)",
        "breath clicks/percussive mouth sounds",
        "vocal chops (looped single words)",
        "ad-hoc freestyle ad-lib ('Uh!', 'Yah!', elongated vowels)",
        "perreo chant call-response",
        "vocal tag signature (artist catch-phrase)"
      ],
      "harmonyApproach": "Simple, singable major or minor thirds/sixths. Often single-note hooks doubled at octave for radio clarity. Layered vocal stacks on chorus (up to 3–4 layers) for density. Minimal counter-melody—focus is rhythmic pocket and hook catchiness.",
      "languageMix": "Spanish primary. Code-switching to English (particularly in modern 2025+ chart reggaeton) for international reach. Mix ratio ~70% Spanish, 30% English or bilingual phrasing. Occasional untranslated regional dialect or slang for authenticity."
    },
    "signatureElements": [
      "Dembow kick (1 + and of 2, skip 3, land on 'and' of 4 + 1) syncopated foundation",
      "Rolling 808 sub-bass with side-chain pump to kick",
      "Snare/clap on beat 3 + additional offbeat snare hits for drive",
      "Congas/timbales pocket lock on 'and' of 2 (percussive glue)",
      "Hi-hat syncopation creating shuffle feel without being fully swung",
      "Vocal hook that sits on or just after dembow's off-kick (rhythmic lock)",
      "Ad-lib culture: breath clicks, chants, freestyle ad-libbing over beat",
      "Side-chain compression on full mix to dembow kick for dance-floor pump"
    ],
    "referenceArtists": [
      "Bad Bunny (melodic pop-reggaeton lane)",
      "Rauw Alejandro (trap-reggaeton fusion)",
      "J Balvin (cross-genre, global mainstream)",
      "Arcángel (perreo traditionalist)",
      "Yng Lvcas (Mexican reggaeton/chugg)",
      "Jhay Cortez (reggaeton-R&B lane)",
      "Feid (trap-reggaeton emotional depth)",
      "Maluma (reggaeton-pop accessibility)"
    ],
    "mixTraits": {
      "lowEnd": "Aggressive sub-presence (80–200Hz boosted +3–6dB). 808 is heart of mix. Kick punchy but not overcompressed; dynamic range preserved for impact. Low-end glue via sidechain, not EQ blending.",
      "drums": "Tight, digital, punchy. Dembow kick is analog-modeled 808 or trap kit kick (short attack, ~50–80ms decay). Snare bright (4–8kHz presence peak) with minimal reverb. Hi-hats slightly behind beat (groove), not natural-sounding but rhythmically intentional.",
      "vocals": "Forward, present. Lead vocal sits ~–6dB to –3dB relative to beat. Minimal reverb (100–200ms room). Ad-libs often drier or with short slapback delay (60–120ms) for rhythmic separation. Doubled hook for radio clarity.",
      "space": "Dry overall. Modern reggaeton: minimal reverb (–2–6dB room, 0.5–1.5s decay). Delay used sparingly for builds or transitions (slapback, dotted-eighth). Subtle chorus on synth plucks. No lush ambient pad fill; focus is rhythmic foreground.",
      "loudness": "Hot. Target LUFS: –5 to –4 LUFS (club/streaming optimized). Peaking, not compressed to death; dynamic range ~3–5dB. Club systems reward top-end clarity and sub-bass punch. Mastered for 85dB club playback and headphone punch."
    },
    "productionPromptSnippet": "Reggaeton dembow 92 BPM: syncopated 808 kick, rolling sub-bass with sidechain pump, tight snare on 3, congas pocket-locked. Vocal hook rides the offbeat. Perreo energy with trap grit. Ad-lib culture, Spanish-English mix.",
    "freshnessGuardrails": "Dembow must be recognizable but not retro; 2025+ production: trap snare rolls, plugg-inspired synth choices, melodic richness (avoid lo-fi trap triteness). Avoid: over-reverb, slow BPM (must stay 85+), hi-hats too straight, vocals too clean/processed. Preserve ad-lib culture and perreo DNA.",
    "sources": [
      "https://www.accio.com/business/most-popular-reggaeton-artists-2025-trend",
      "https://orphiq.com/resources/what-is-reggaeton",
      "https://www.billboard.com/lists/latin-music-trends-2025-predictions/",
      "https://www.soundverse.ai/blog/article/what-music-genres-are-popular-right-now-0348",
      "https://www.drumloopai.com/reggaeton/common-patterns-used-in-reggaeton-beats/",
      "https://www.melodigging.com/genre/perreo",
      "https://en.wikipedia.org/wiki/Dembow_beat",
      "https://writeseen.com/blog/reggaeton-beat",
      "https://soundation.com/make-music/music-genres/how-to-make-reggaeton-beat"
    ]
  },
  "country": {
    "genre": "country",
    "displayName": "Country (Modern Pop-Country & Contemporary)",
    "bpmRange": [
      90,
      130
    ],
    "typicalBpm": 110,
    "commonKeys": [
      "G",
      "D",
      "A",
      "E",
      "C",
      "F"
    ],
    "chordProgressions": [
      {
        "roman": "I–IV–V",
        "description": "The foundational three-chord backbone of country. G–C–D (or D–G–A). Creates authentic country feel, universally recognizable. Dominant 7th on V (D7) strengthens resolution back to I."
      },
      {
        "roman": "I–V–vi–IV",
        "description": "Modern country expansion: G–D–Em–C. Contemporary four-chord standard; emotional, storytelling-ready. Adds emotional minor tones without leaving major key. Ubiquitous in 2025–2026 charting tracks."
      },
      {
        "roman": "i–bIII–bVII–i",
        "description": "Murder ballad / heartbreak minor progression: Cm–Eb–Bb–Cm (or transposed). Haunting, melancholic, used in Dolly Parton's 'Jolene.' Powers emotional country ballads and dark storytelling."
      },
      {
        "roman": "i–iv–v",
        "description": "Minor key country: Am–Dm–Em. Darker, introspective minor-key approach. Less common than major key, but essential for vulnerable/tragic country narrative."
      },
      {
        "roman": "IV–I–V–I",
        "description": "Nashville turnaround; creates energy climb from the IV into resolution. Used in chorus builds and hook sections for impact."
      }
    ],
    "arrangement": [
      {
        "section": "Intro",
        "bars": "0–8",
        "whatHappens": "Clean acoustic guitar (fingerstyle or strummed), sparse percussion (light kick, maybe hi-hat ride), minimal low-end. Sets intimate, storytelling mood. Some tracks open with a talk-sung line (Jelly Roll, Morgan Wallen style). Builds gentle sense of place (rural, front-porch, small-town imagery)."
      },
      {
        "section": "Verse 1",
        "bars": "8–24",
        "whatHappens": "Lead vocal enters mid-register, conversational delivery over I–IV–V chord loop. Acoustic rhythm guitar carries groove, kick on 1 and 3 (light pocket), snare on 2 and 4. Bass plays root notes or simple walking line, sits lower-mid. No synth yet; pure organic foundation. Vocal is single-tracked, dry or light reverb for clarity."
      },
      {
        "section": "Pre-Chorus",
        "bars": "24–28",
        "whatHappens": "Build energy: kick doubles to 1-and-3 with ghost-kick feel, snare intensifies, acoustic rhythm picks up texture (maybe added electric guitar or mandolin). Vocal rises in register, moves toward IV–I turn. Anticipation for chorus drop."
      },
      {
        "section": "Chorus",
        "bars": "28–44",
        "whatHappens": "Full production hit: kick locks on straight eighths, punchy snare, tight hi-hat. Vocal layers triple or quadruple—lead vocal front-center, doubled and tripled slightly detuned copies for width, harmonies underneath (3rds or 5ths to main melody). Synth pad enters (warm, organic, not harsh) or steel guitar (if more traditional). Bass locks to kick. Lyric hook repeats over I or I–V–vi–IV progression. Explosive, emotionally grounded moment."
      },
      {
        "section": "Verse 2",
        "bars": "44–60",
        "whatHappens": "Similar to Verse 1 but slightly fuller—added electric guitar riff or mandolin counter-melody. Vocal may add ad-libs (grunts, bent phrases, call-outs). Kick stays light, snare pops on 2. Narrative deepens. Vocal layers are still mostly single-tracked but with one subtle double for warmth."
      },
      {
        "section": "Pre-Chorus 2",
        "bars": "60–64",
        "whatHappens": "Same energy climb as Pre-Chorus 1, but may add a third layer of rhythm guitar or subtle strings (pedal steel bends or violin). Vocal pitch rises higher. Hi-hat accelerates or adds swing feel."
      },
      {
        "section": "Chorus 2",
        "bars": "64–80",
        "whatHappens": "Full hit again. Vocal stacks heavier. Synth/steel guitar more prominent. Bass sits locked to kick. Snare may have extra layer (ghost note complexity). Kick pattern may add 16th-note ghost kicks for pocket richness. Chorus is the emotional peak; every element is saturated but never muddy."
      },
      {
        "section": "Bridge",
        "bars": "80–96",
        "whatHappens": "Stripped or surprising choice: either minimal (just vocal + one guitar) or textural shift (switch to higher key, add strings, use reverb-drenched vocal effect, or small tempo dip). Builds suspense. Ad-libs intensify (vocal runs, bent notes, growls). Kick may disappear momentarily, snare on 2 only. Listeners lean in to hear the vocal story. Energy build into final chorus."
      },
      {
        "section": "Final Chorus",
        "bars": "96–112",
        "whatHappens": "Maximum vocal layering (5–6 stacked takes, some AI-doubled for polish). Kick and snare tight, locked together. Pad or steel guitar is lush. Bass sits deep. Potential for a final lyric variation or extended note to emphasize the hook's emotional center. Everything is burnished but still organic, not over-produced."
      },
      {
        "section": "Outro",
        "bars": "112–120",
        "whatHappens": "Either: (A) fade vocal over chord loop (I–IV–V repeating) with kicks/snare fading, acoustic guitar lingering, or (B) sharp cutoff. Some modern tracks end with a talk-sung line, laugh, or spoken word over minimal beat. Fades out or holds final chord. Leaves listener with emotional resonance, not bombast."
      }
    ],
    "instrumentation": {
      "core": [
        "Lead vocal (center, conversational storytelling tone)",
        "Acoustic guitar (fingerstyle, strummed, or rhythm foundation)",
        "Electric guitar (riffs, counter-melodies, subtle distortion or clean tone)",
        "Bass (root-note focus, sits underneath kicks)"
      ],
      "signature": [
        "Pedal steel guitar (bends, atmospheric slides; 'crying' country sound)",
        "Banjo (bright, percussive; pop-country or trap-country edge)",
        "Mandolin (bright, tight rhythmic fills; bluegrass country influence)"
      ],
      "percussion": [
        "Kick drum (tight, focused, sits with bass; not boomy)",
        "Snare (dry, punchy, ghost notes for pocket)",
        "Hi-hat (closed stick, ride, or shuffle swing on 16ths)",
        "Shaker or tambourine (light pocket texture)",
        "Tom rolls (rare but effective for section breaks or afro-trap country hybrid)"
      ],
      "bass": "Electric bass, sits in lower-mid; plays root-note anchor or walking line. Tight pocket with kick. No slap unless genre-hybrid (trap-country). Deep but never boomy; EQ'd to sit around 60–100 Hz fundamental."
    },
    "groove": {
      "feel": "Pocket-centric, human-imperfect. Kick and snare sit slightly behind or on the pocket, never quantized perfectly. Shuffle or swing feel on hi-hat (light swing, not jazz). Straight eighth-note kick in modern pop-country; ghost-kick ghost notes for pocket richness. Footstep-walking intimacy in verses; explosive lock in chorus.",
      "pocketNotes": "Lay the kick slightly behind the beat for a 'dragging' feel that contrasts with bright vocal. Snare sits on 2 and 4, slightly pushed forward; this creates tension with the laid-back kick. Hi-hat and shaker have microscopic swing (6–10 ms swing). The pocket feels 'lived-in' and loose, not metronomic. This is core to modern country's success vs. sterile pop.",
      "swing": "Light swing on hi-hat (6–12% swing depth), rare but effective on kick ghost notes. Straight-ahead main kick on downbeats (no swing). Verse shuffles softer than chorus shuffles. Swing brings warmth without sounding dated.",
      "syncopation": "Vocal phrasing sits off-beat or crosses bar lines; not always landing on downbeat. Snare may anticipate beat 3 or land on the 'and' of 4. Electric guitar riffs use syncopated sixteenth notes. Kick pattern uses ghost notes between main beats. Syncopation = tension = forward motion, prevents predictability."
    },
    "vocalStyle": {
      "delivery": "Conversational, intimate, lower-register foundation in verses (sit in speaker's chest voice, not head voice). Modern country vocalists (Luke Combs, Morgan Wallen, Jelly Roll) speak-sing verses with laid-back phrasing. Chorus rises into belt register or melodic hook—controlled, not strained. Breathiness and vocal fry on ad-libs (small catches of breath, bent notes, growls). Raspy or whiskey-soaked tone is stylistic plus, not a flaw.",
      "adLibs": [
        "Vocal runs and bent notes (especially on final chorus, 5th and 6th scale degrees bent down)",
        "Grunts, 'yeah' calls, and conversational interjections ('come on', 'baby')",
        "Whispered or falsetto repeats of hook lines",
        "Laugh or spoken-word ad-libs mid-chorus or in outro",
        "High register squeaks or cracks (perceived as authentic, emotional)"
      ],
      "harmonyApproach": "Backing vocals (often female or higher male voice) sit in 3rds above lead or 5ths below. Doubles of lead vocal are detuned by 5–10 cents for richness (not noticeable separately, but creates thick sound). Stacked backing vocals (4–8 layers) create 'choir' texture under lead. AI-generated or blended AI + human backing vocals are now industry standard for polish. Harmonies are consonant (no dissonance), sitting diatonically in the key.",
      "languageMix": "English dominant; may include Southern or rural slang (informal speech patterns). Spanish or bilingual elements rare but emerging in pop-country crossovers (e.g., country-reggaeton hybrids). Ad-libs often use regional dialect (Texas drawl, Appalachian twang) as vocal texture marker."
    },
    "signatureElements": [
      "Storytelling narrative in lyrics (specific place, character, moment—not abstract)",
      "Conversational, talk-sung verse delivery (intimacy)",
      "Pedal steel guitar bends and 'crying' sound (emotional marker)",
      "Thick vocal stacks (3–8 layers) in chorus for emotional impact",
      "Acoustic guitar foundation (organic anchor vs. synth-first approach)",
      "Pocket-conscious groove (slightly behind beat, not quantized)",
      "Four-chord emotional progression (I–V–vi–IV) as modern default",
      "Hook-centric song structure (12–16 bar hook line, repeated for catchiness)",
      "Mix clarity: lead vocal always legible, space around instruments (not cluttered)",
      "Banjo, mandolin, or pedal steel as genre-marker instrument (signals 'country' instantly)"
    ],
    "referenceArtists": [
      "Luke Combs (conversational delivery, pocket groove, modern production)",
      "Morgan Wallen (raspy tone, complex song structures, country-rap fusion)",
      "Jelly Roll (redemption narrative, gritty vocal texture, trap-country production)",
      "Zach Bryan (acoustic minimalism, emotional intensity, 'gravel' subgenre pioneer)",
      "Ella Langley (pop-country crossover, TikTok virality, contemporary storytelling)",
      "Chris Stapleton (soulful rasp, minor-key ballads, timeless country authenticity)",
      "Jason Aldean (rock-country hybrid, drum-machine energy, radio-friendly hooks)",
      "Shaboozey (country-rap production, modern urban-country blend)"
    ],
    "mixTraits": {
      "lowEnd": "Kick sits at 40–80 Hz (resonance), bass 60–120 Hz (fundamental). Deep but controlled, never boomy. Kick and bass locked together in the pocket, creating unified low-end 'anchor' for vocal to sit on top. Kick has slight 'thump' (200 Hz boost for impact). No sub-bass frequency bloat.",
      "drums": "Kick and snare are the drivers. Kick is tight and focused (not a bouncy dance kick), sits slightly behind beat for pocket feel. Snare is dry and punchy (600 Hz–2 kHz brightness), with ghost notes adding pocket texture. Hi-hat is closed-mic, bright but not harsh (8–12 kHz peak). Cymbals are room-mic'd for space, not dried out.",
      "vocals": "Lead vocal is center, 3–6 dB above instrumental mix. Doubled and tripled in chorus for thickness and width (pan slightly L and R, subtle EQ differences per layer). Backing vocals sit 6–12 dB below lead, creating clear hierarchy. Vocal EQ: bright presence peak at 4–5 kHz (intelligibility), proximity boost at 80–100 Hz (warmth in chest register), slight de-esser on 'S' sounds (no sibilance harshness). Light reverb on lead (0.5–1.5 sec decay, 12–25% wet), bigger reverb on backgrounds (1.5–2.5 sec, 15–35% wet, creating 'space').",
      "space": "Room ambience or plate reverb on drums (subtle, 15–25% wet) creates 'live' feel vs. stereo. Vocals and guitars have separate reverb spaces (vocals more lush, guitars drier). No over-reverb (common mistake); keep intelligibility. Delay on vocal ad-libs (50–250 ms repeats, 1–2 repeats) for rhythmic interest. Panning: acoustic guitar L, electric guitar R, keeping stereo width without image collapse. Lead vocal and kick dead center for focus."
    },
    "productionPromptSnippet": "Intimate yet radio-ready: conversational lead vocal over pocket-conscious groove, thick vocal stacks in chorus, acoustic + electric guitar foundation, pedal steel or banjo for country color, tight kick + snare locked in the pockets, modern country storytelling with organic warmth, slight grit and rasp in vocal tone, AI-polished backing vocals for thickness, no over-production—clarity over loudness.",
    "freshnessGuardrails": "Stay conversational and specific in narrative (no abstract emotions, always 'a moment' or 'a place'); keep acoustic guitar or mandolin in the mix (signals country authenticity vs. pure synth-pop); vocal must retain conversational delivery even in full chorus—avoid operatic runs; drum kick must sit with bass in pocket, never quantized to grid; avoid clichéd metaphors (love-is-war, heart-is-a-battlefield); ensure vocal stacks don't oversaturate (clarity dies); trap-country crossovers must retain melodic hook over drums (not rapping over 808s alone); if using pedal steel or banjo, make sure they're intentional texture, not decorative.",
    "sources": [
      "https://songbpm.com/@country-music",
      "https://soundplate.com/typical-bpm-by-genre-chart/",
      "https://chosic.com/bpm-by-genre-list/",
      "https://festival2025.com/unveiling-the-sounds-of-2025-exploring-new-country-music-trends/",
      "https://music24.com/blog/emerging-music-trends-guide-2026-industry-pros/",
      "https://blog.landr.com/music-trends/",
      "https://mixingmonster.com/popular-music-genres/",
      "https://en.wikipedia.org/wiki/List_of_Billboard_number-one_country_songs_of_2026",
      "https://www.billboard.com/lists/best-songs-2026-so-far/",
      "https://www.superprof.com/blog/country-rap-guide/",
      "https://newsroom.spotify.com/2025-12-03/wrapped-music-trends/",
      "https://www.guitarlobby.com/country-chord-progressions/",
      "https://powersof10.com/country-chord-progressions-2026-guide-for-guitar-piano/",
      "https://chordly.com/tools/chord-progressions/country",
      "https://blog.landr.com/vocal-layering/",
      "https://emastered.com/blog/vocal-layering",
      "https://blog.native-instruments.com/vocal-layering/"
    ]
  },
  "rock": {
    "genre": "rock",
    "displayName": "Modern Rock / Alt-Rock / Pop-Rock",
    "bpmRange": [
      115,
      135
    ],
    "typicalBpm": 125,
    "commonKeys": [
      "E",
      "A",
      "D",
      "G",
      "E minor",
      "A minor",
      "D minor"
    ],
    "chordProgressions": [
      {
        "roman": "I-V-vi-IV",
        "description": "The modern rock workhorse: ascendant, anthemic, drives upward momentum. Electric, singable, emotionally open. Use for verses and pre-choruses to build tension."
      },
      {
        "roman": "I-bVII-IV",
        "description": "Borrowed minor (modal interchange): darker, edgier, street-level credibility. Classic E-D-A in power chord form. Foundation of alt-rock attitude."
      },
      {
        "roman": "vi-IV-I-V",
        "description": "Melancholic entry into major: late-song lift, vocal-forward. Restless, introspective opening that resolves skyward. Common in rock ballads and build-ups."
      },
      {
        "roman": "I-IV-V",
        "description": "Primal rock trinity: maximum accessibility, driving, celebratory. Backbone of pop-rock hooks and anthems. Often voiced with power chords."
      },
      {
        "roman": "i-bVI-bIII-bVII",
        "description": "Full modal shift into natural minor parallel: doom-touched, immersive, texture-led. Shoegaze and darker alt-rock signature. Creates tonal suspension."
      }
    ],
    "arrangement": [
      {
        "section": "Intro",
        "bars": "8-16",
        "whatHappens": "Signature guitar riff or lead motif establishes mood. Drums enter late (bar 5-8) with minimal kick; builds to full pattern. Reverb-drenched, effects-heavy. Sets emotional temperature."
      },
      {
        "section": "Verse 1",
        "bars": "16-32",
        "whatHappens": "Rhythm guitar locked in power chords or clean arpeggios (key-dependent). Vocals intimate, dry-ish mix, near-field energy. Bass shadows root, occasional syncopation. Drums pocket tight, ride cymbal or hi-hat driving pulse. Minimal keys/texture."
      },
      {
        "section": "Pre-Chorus",
        "bars": "8-12",
        "whatHappens": "Dynamic lift: vocal layers thicken, rhythm guitars double, drums open up (toms, kick pattern shifts). Progression ascends (I-V-vi-IV typical). Anticipation builds. Guitar effects increase (reverb, delay swell). Tension spike."
      },
      {
        "section": "Chorus",
        "bars": "8-16",
        "whatHappens": "Climax: full instrumentation, vocal harmonies (doubles, thirds, or octaves), wide stereo spread. Power chords or open voicings. Kick anchors groove. Reverb opens space. Ad-lib shouts or wails punctuate chorus end. Maximum emotional release."
      },
      {
        "section": "Verse 2",
        "bars": "16-32",
        "whatHappens": "Lyrical storytelling continues; production slightly stripped vs. verse 1 (guitar texture variation, fewer effects). Sets up second pre-chorus contrast. Groove stays locked. Vocal delivery more conversational or confessional."
      },
      {
        "section": "Bridge",
        "bars": "8-16",
        "whatHappens": "Production overhaul: tempo break, stripped guitars, vocal double-tracked (intimate moment), or instrumental guitar solo takes lead (wailing, bending, feedback texture). Dynamic fork in energy. Builds toward final chorus."
      },
      {
        "section": "Final Chorus x2",
        "bars": "16-32",
        "whatHappens": "Repetition with variation: second chorus may double vocals, add keys (pads or stabs), deepen bass line. Third chorus (if used) explodes with overdrive guitar, layered ad-libs, maximum texture. Drums may push tempo slightly."
      },
      {
        "section": "Outro",
        "bars": "8-24",
        "whatHappens": "Fade or hard stop. Often guitar-led (riff reprise, extended solo, or feedback decay). Drums simplify, kick + snare staying pocket. May loop chorus hook with vocal ad-libs over stripped rhythm. Reverb tails out."
      }
    ],
    "instrumentation": {
      "core": [
        "Electric Guitar (rhythm + lead)",
        "Bass",
        "Drums",
        "Lead Vocals"
      ],
      "signature": [
        "Power chords (drop D tuning common)",
        "Open-string lead riffs",
        "Distortion/fuzz/overdrive effects"
      ],
      "keys": "Keyboards (synth pads, stabs, occasional leads) — rare in verse, frequent in chorus/bridge for texture",
      "guitar": "Dual-guitar tones common: clean for verse, distorted for chorus. Feedback, reverb delays, and modulation effects (chorus, flanger, phaser) define texture lanes.",
      "bass": "Plays root + occasional chromatic passing tones. Locks with kick. May syncopate in pre-chorus or bridge for dynamic surprise.",
      "percussion": [
        "Kick drum (driven, punchy, pocket-focused)",
        "Snare (high transient, tight)",
        "Hi-hat or ride (swing feel, opening during build)",
        "Toms (accent pre-chorus/bridge)",
        "Crash cymbals (chorus hits, intensity markers)"
      ]
    },
    "groove": {
      "feel": "Pocket-tight, quarter-note driven. Groove lives in the push/pull between kick and snare — not ahead, not behind, locked into the pocket.",
      "swing": "Modern rock is straight-eighths based, but ride cymbals and hi-hats often add subtle shuffle or swing feel (5-15% push), especially in verses.",
      "syncopation": "Kick syncopates around snare backbeat (2, 4). Guitars and bass may push syncopated rhythms in pre-chorus. Ad-libs and vocal accents sit slightly ahead of beat, creating tension.",
      "pocketNotes": "The groove is in the SPACE, not the notes. Sit just behind the kick in the verse; tighten into the beat during chorus. Drums drive the pocket, guitars fill color. Kick and snare are the heartbeat—everything else flows around them."
    },
    "vocalStyle": {
      "delivery": "Conversational + climactic. Verses: intimate, near-field, confessional tone. Chorus: explosive, layered, emotional peak. Vocal bends, slides, and sustained notes on key lyrical hooks. Grit/rasp on ad-libs.",
      "harmonyApproach": "Doubles (octave or unison), thirds, and full-voice harmonies in chorus. Layers build during final chorus. Backing vocals stay supportive, not lead. Vocal stacks create width and power.",
      "adLibs": [
        "Raw shouts ('Yeah!', 'Oh!', 'Come on!')",
        "Wails and sustained cries at emotional peaks",
        "Quick, punchy interjections between lyrical lines",
        "Whispered/breathy ad-libs over soft sections",
        "Layered vocal grunts/exhales over loud sections",
        "Background 'oohs' and 'aahs' in harmonies"
      ],
      "languageMix": "Primarily English; occasional phrasal ad-libs in non-English (Spanish 'olé', French 'allez') for texture, especially in TikTok-driven tracks."
    },
    "signatureElements": [
      "Power chord riff (distorted, high-gain guitar tone)",
      "Bending lead guitar in hook moment (E-D-A or similar I-bVII-IV shapes)",
      "Reverb-drenched intro riff establishing guitar identity",
      "Kick-snare pocket serving as emotional anchor",
      "Chorus vocal layers (doubles + harmonies) creating wall of sound",
      "Dynamic shrink-expand: stripped verse → layered chorus (production contrast)",
      "Ad-lib shout or wail punctuating chorus end or bridge climax",
      "Feedback/noise as textural element (intro, bridge, outro)",
      "Crash cymbal hits on major emotional markers (chorus drop, bridge resolve)",
      "Bass guitar mirroring kick syncopation (locking groove)"
    ],
    "referenceArtists": [
      "The Killers (anthemic pop-rock hooks, synth-driven alternative)",
      "Coldplay (atmospheric texture, modal openness, climactic builds)",
      "Arctic Monkeys (angular rhythms, distorted lead tone, swagger)",
      "Muse (dynamic range, layered synths, vocal theatricality)",
      "Turnstile (modern punk-rock energy, tight grooves, raw delivery)",
      "Sleep Token (progressive texture, emotional depth, production sophistication)",
      "Deftones (nu-metal influence, ethereal textures, low-end punch)",
      "The 1975 (synth-pop-rock fusion, groove-centric production)",
      "Royal Blood (minimalist heavy rock, two-piece power)",
      "Foo Fighters (anthemic drive, vocal gravitas, dynamic builds)"
    ],
    "mixTraits": {
      "lowEnd": "Kick locked with bass, 40-60 Hz weight. Bass guitar sits 80-200 Hz, tight and punchy. Sub-bass used sparingly (intro, chorus hits only). Overall low-end is presence-heavy, not boomy.",
      "drums": "Kick and snare are primary anchors, high transient (attack-focused). Toms add texture in pre-chorus/bridge. Hi-hat cutting through (5-8 kHz). Crash cymbals bright, wide stereo (10-12 kHz). Drum compression is moderate—tight pocket, but not pumping.",
      "vocals": "Lead vocal sits center, upfront (0-1 dB relative mix). Doubles and harmonies panned (L/R, 20-40%), creating width. Reverb send moderate (short-to-medium decay, pre-delay 10-30ms). Vocal ad-libs may sit slightly lower or higher for dynamic interest. EQ: presence peak 3-5 kHz, reduce mud below 200 Hz.",
      "space": "Moderate-to-wide reverb (plate or spring in intro/bridge; shorter room verb in verse). Delay effects on lead guitar (dotted eighth, quarter-note repeats). Stereo width increases from verse → chorus. Intro and outro use maximum reverb tail; mid-song stays tighter for groove lock.",
      "loudness": "LUFS target -6 to -4 (radio-ready, streaming optimized). Peak dynamic range: 12-18 dB swing. Chorus hits hardest; verse sits 4-6 dB lower. Mastering chain includes gentle multiband compression to keep low-end tight during loud moments."
    },
    "productionPromptSnippet": "Modern rock with tight grooves, power-chord riffs, layered vocal harmonies, and dynamic builds from intimate verses to explosive choruses—think attitude-driven alternative with arena-scale production and short-form viral energy.",
    "freshnessGuardrails": "Avoid overwrought synths or trap-style drums (they dilute rock identity). Keep drums live-sounding, pocket-focused. Guitar tones must have character (distortion type, amp modeling, effects stack matters). Vocal delivery needs raw humanity—auto-tune kills rock's credibility. Ad-libs should feel spontaneous, not grid-locked. Avoid 4-on-the-floor in main groove (that's dance/electronic). Rock is about the POCKET, not the pattern count.",
    "sources": [
      "https://substreammagazine.com/2026/03/why-rock-music-is-trending-again-in-2026/",
      "https://www.soundverse.ai/blog/article/how-rock-music-made-a-comeback-in-2025-2026-2328",
      "https://www.billboard.com/pro/radio-songs-chart-five-year-trends-chartcipher/",
      "https://www.chosic.com/bpm-by-genre-list/",
      "https://orphiq.com/resources/bpm-tempo-guide",
      "https://emastered.com/blog/rock-chord-progressions",
      "https://blog.native-instruments.com/rock-chord-progressions/",
      "https://chordly.com/tools/chord-progressions/rock",
      "https://www.masterclass.com/articles/alternative-rock-guide"
    ]
  },
  "soul": {
    "genre": "soul",
    "displayName": "Soul (Classic & Neo-Soul)",
    "bpmRange": [
      75,
      105
    ],
    "typicalBpm": 90,
    "commonKeys": [
      "F",
      "Eb",
      "Bb",
      "G",
      "D",
      "A"
    ],
    "chordProgressions": [
      {
        "roman": "I-vi-IV-V",
        "description": "Classic soul/R&B foundation: warm major I, emotional vi minor descent, IV lift for hope, V tension-resolve"
      },
      {
        "roman": "ii-V-I",
        "description": "Jazz-soul turnaround: sophisticated ii minor, V7 dominant with extensions, I resolution with warmth"
      },
      {
        "roman": "I-IV-I-V",
        "description": "Gospel-soul call-and-response: repetitive, hypnotic, space for vocal riffing and ad-lib runs"
      },
      {
        "roman": "vi-IV-I-V",
        "description": "Melancholic soul intro: begins in emotional minor relative, resolves to major—vulnerable opening, confident payoff"
      },
      {
        "roman": "I-VI-III-VII (borrowed chords)",
        "description": "Modern neo-soul chromatic movement: major I, borrowed VI (blues-tinged), III movement, VII tension for atmospheric depth"
      }
    ],
    "arrangement": [
      {
        "section": "Intro (0-8 bars)",
        "bars": "4-8 bars",
        "whatHappens": "Solo keys or strings establishing harmonic pocket. Minimal drums: just kick/bass rhythm. Sets intimate, reverent mood. Space dominates. Think: Fender Rhodes with legato reverb or muted strings sustaining the i-IV movement."
      },
      {
        "section": "Verse 1 (8-24 bars)",
        "bars": "16 bars",
        "whatHappens": "Vocal enters close-mic'd, intimate. Drums stay sparse—kick on 1/3, hi-hat shuffle on 16ths. Bass locked with kick, half-note pocket. Keys/pad underneath holding harmonic floor. Ad-lib space left open. Guitar or subtle strings texture only."
      },
      {
        "section": "Pre-Chorus (24-32 bars)",
        "bars": "8 bars",
        "whatHappens": "Energy builds: drums layer snare backbeat (2/4), hi-hat tightens. Vocal melody rises, hint of doubled harmony. Bass walks or syncopates. Keys swell. Anticipation peaks—brief 1-bar drum break or cymbal crash into chorus."
      },
      {
        "section": "Chorus (32-48 bars)",
        "bars": "16 bars",
        "whatHappens": "Full arrangement fires. Drums punchy, kick/snare pocket tight. Bass hooks with synth bass layer or sampled 808 glide. Strings/horns or synth stabs on beat 1. Vocal doubles/harmonies thick, ad-libs flying. Major emotional payoff. Loop-able groove."
      },
      {
        "section": "Verse 2 (48-64 bars)",
        "bars": "16 bars",
        "whatHappens": "Sparse reset: drums pull back to ghost notes, kick/bass pocket only. Fresh vocal melody (or different lyrical angle). Keys sparse, maybe guitar lick punctuates 4-bar phrases. Rebuilds tension for 2nd chorus."
      },
      {
        "section": "Bridge (64-80 bars)",
        "bars": "16 bars",
        "whatHappens": "Modulation or textural shift: key change up semitone or harmonic suspension (IV-I loop extended). Vocal showcases runs, melismas, ad-lib power. Drums might drop to kick/hi-hat only or switch to swung 16ths. Synth pad evolves. Peak emotional moment."
      },
      {
        "section": "Final Chorus (80-96 bars)",
        "bars": "16-24 bars",
        "whatHappens": "Full arrangement, added synth texture or string swell. Vocal full power, harmonies lush. Drums may add snare roll or hi-hat trill into final chorus. Bass locked with kick, possibly an octave-jump synth bass line."
      },
      {
        "section": "Outro (96-104 bars)",
        "bars": "8+ bars",
        "whatHappens": "Fade or hard stop: strip back to intro pocket (keys + reverb, minimal drums). Vocal ad-libs/hums over held I chord. Drums ghost-note shuffle fades. Keys sustain and decay. Final 2-bar hit on I chord, cut to silence or long decay."
      }
    ],
    "instrumentation": {
      "core": [
        "Lead Vocal",
        "Drums",
        "Bass",
        "Keys"
      ],
      "signature": [
        "Fender Rhodes (often laid-back, mid-range focus)",
        "Live Strings (lush, sustained pads or stabs)",
        "Analog Synth Pad (warm, tape-saturated)",
        "Sampled/Recorded Horns (trumpet, trombone, saxophone)"
      ],
      "percussion": [
        "Kick drum (tight, sub-focused, 40-80Hz punch)",
        "Snare (crisp, 2-4 kHz presence, ghost notes common)",
        "Hi-hat (crisp 16th shuffle or swung 8ths, 8-12kHz sizzle)",
        "Clap or rim-shot (crack and snap for pocket)",
        "Shaker (warm, vinyl-textured, open high-mids)",
        "Congas or hand-percussion (texture on half-time fills)"
      ],
      "bass": "Warm upright or sampled bass line (sub-locked with kick, 50-100Hz body); often synth bass or 808 glide layered for modern soul (smooth sidechaining to kick; deep pocket below 100Hz, mids at 200-400Hz for definition)",
      "guitar": "Funk rhythm strums (tight, rhythmic, often muted or chicken-picked), jazz chord voicings, or slide guitar for texture; kept spacious, never masking vocals"
    },
    "groove": {
      "feel": "Pocket-first, half-time swagger: kick and bass locked tight, hi-hat shuffle rides atop 16th grid or swung 8ths; snare lands on 2/4 with ghost-note ghost patterns between. Sits behind the beat (50-100ms lag typical) for laid-back, conversational intimacy.",
      "swing": "16th-note triplet micro-swing on hi-hat (push 16ths slightly early), kick/bass sit just *under* the beat. Syncopation in bass line (syncopated 16ths or triplet subdivisions) keeps groove alive without rushing.",
      "syncopation": "Bass syncopates on off-beats or triplets; snare backbeat with kick-before-snare (kick jumps 16th early on beat 2); hi-hat variation (some 16ths tight, some swung). Ad-lib vocal lines sit over unchanging harmonic pocket, creating rhythmic tension.",
      "pocketNotes": "Sit back 50-80ms from grid. Kick/bass always locked. Snare ghost notes break monotony—flutter between beats 2 and 3. Vocal sits slightly ahead of beat 1 for urgency, then lags into pocket. Swing is feel, not mathematical—ears rule. Space is a note; silence sells the melody."
    },
    "vocalStyle": {
      "delivery": "Close-mic'd, intimate, breathy—vocal sits *in front* of the mix (vocal-centric). Conversational tone, as if singing to one listener. Vibrato controlled, melismas on key words (emotional peaks). Ad-lib space abundant. Breathy consonants (s, sh) present for humanity. Doubles/harmonies lush on chorus, sparse on verses.",
      "adLibs": [
        "Long, descending melisma runs (3-5 notes, chromatic slides)",
        "Single-note hold with vibrato swell (3-4 sec sustain)",
        "Call-response patterns with own harmony (e.g., vocal call, harmonic echo)",
        "Breath/sigh before phrases for intimacy",
        "Riff trades with instrumental (key solo responds to vocal phrase)",
        "Gospel-soul shouts or 'yeah' punctuation on beat 4",
        "Wordless hums, scats, or vocal percussion fills"
      ],
      "harmonyApproach": "Stacked thirds and sixths for warmth (parallel 3rds common). Gospel-soul: full triadic stacks on choruses. Jazz-soul: suspended 9ths, added 4ths for sophistication. Minor-third intervals for melancholy, major-third for brightness. Harmonies double lead on hook, sparse on verses. Voice leading smooth (avoid jumps >5ths).",
      "languageMix": "Lead in primary language (English, or native tongue), ad-libs and shouts may shift. Occasional wordless vocalizations (hums, scats). Lyrical content: intimate, emotional, relational (love, heartbreak, self-reflection, social themes). No rap delivery; sung melody always."
    },
    "signatureElements": [
      "Warm, vinyl-textured bass (tape saturation, slight compression)",
      "Fender Rhodes or Moog synth sustain under verses, texture-heavy",
      "Sparse, ghost-note-heavy drums that sit *in* the pocket, not on top",
      "Vocal-centric mix (vocal is the star; everything else is frame)",
      "Lush string/horn stabs or pads, never too busy",
      "Minor 7th and 9th chords (never too bright, always sophisticated)",
      "Reverb/delay on vocals (50-150ms, warm plate or spring); never clinical",
      "Bass line syncopation and micro-rhythmic push (triplets, 16th-note syncopation)",
      "Gospel or jazz influence in harmonic movement (borrowed chords, ii-V turnarounds)",
      "Silence/space as a compositional tool (breaks between sections, room for air)"
    ],
    "referenceArtists": [
      "Alicia Keys (jazz-soul piano pocket, vocal intimacy)",
      "Anderson .Paak (hip-hop-soul fusion, rhythmic sophistication, live drums)",
      "Jhené Aiko (neo-soul vulnerability, ethereal vocal layering)",
      "D'Angelo (classic soul instrumental depth, loop-based arrangements)",
      "Erykah Badu (genre-defining neo-soul, live arrangement, vocal ad-lib mastery)",
      "Silk Sonic/Bruno Mars (retro-soul production, analog warmth, pocket mastery)",
      "Raphael Saadiq (production-forward soul, live instrumentation)",
      "SZA (contemporary neo-soul, minimalist production, vocal texture)",
      "Robert Glasper (jazz-soul fusion, piano-centric, modern harmonic language)",
      "Musiq Soulchild (classic neo-soul groove, understated production elegance)"
    ],
    "mixTraits": {
      "lowEnd": "Sub-bass (30-80Hz) locked with kick, warm and present but not boomy. 100-200Hz bass fundamental sits warm and full-bodied. Slight high-pass on most instruments (keys at 80Hz+, guitar at 150Hz+) keeps low-end clean. Avoid clutter below 100Hz.",
      "drums": "Kick punchy in 40-80Hz region (attack + body), snare crisp at 2-5kHz (presence peak), ghost notes audible but not dominant. Hi-hat sizzle at 8-12kHz, tight and disciplined. Drums sit *in* the mix, not on top—about -6 to -3dB from vocal peak. Room/ambience minimal; tight, controlled sound.",
      "vocals": "Lead vocal +3 to +6dB above mix floor (vocal-forward). Doubles at -3 to -6dB, harmonies at -6 to -12dB. Reverb 150-350ms (plate or spring, dark), send level -12 to -15dB (audible but not drowning). Slight delay (50-100ms, 1-2 repeats) for width. Compression ratio 2:1-4:1 (smooth, never aggressive). No EQ scoops; enhance presence at 2-4kHz if needed.",
      "space": "Mixes feel open and airy despite full arrangements. Keys/pads sit in back, strings/horns punch specific moments. Reverb is warm, never cheap. Stereo width moderate (not overcooked); lead vocal center-anchored. Background vocals may pan slightly. Synth pads subtle, never masking lead. Overall: warm, intimate, living-room-ready (headphones friendly, translates to small speakers without clipping)."
    },
    "productionPromptSnippet": "Warm soul groove, laid-back pocket, Fender Rhodes lush, intimate close-mic'd vocal with ad-libs, ghost-note drums, syncopated bass, string/horn moments, minor 7th sophistication, vinyl texture throughout, breathy and human.",
    "freshnessGuardrails": "Honor pocket-first (groove is law). Avoid over-processing or pristine digital cleanliness; embrace tape warmth, slight saturation. Keep vocal front-and-center; all instruments serve the story. Syncopation keeps energy without rushing beat. Silence is not empty—it's intentional. Don't let modern production gloss overwhelm soul authenticity: human imperfection + pocket pocket pocket.",
    "sources": [
      "https://thebluesproject.co/2020/08/21-neo-soul-artists-to-watch/",
      "https://www.okayplayer.com/earthy-electric-eternal-the-rise-of-neo-soul/1417577",
      "https://dlksoul.com/modern-soul-music-evolving-sounds-and-new-directions/",
      "https://dlksoul.com/the-distinctive-elements-of-trap-soul-a-deep-dive-into-the-genres-unique-sound/",
      "https://stealifysounds.com/blogs/news/redefining-neo-soul-cutting-edge-soulful-music-production-techniques",
      "https://www.goldminemag.com/columns/the-tone-of-soul/four-more-modern-soul-must-haves-for-2026-so-far/",
      "https://www.masterclass.com/articles/soul-music-guide"
    ]
  }
};

export const GLOBAL_ENRICHMENT: Record<string, GenreEnrichment> = {
  "pop": {
    "genre": "pop",
    "trendingProductionMoves": [
      "Reverb-heavy ad-lib layers (subconscious atmosphere, low-level reverb trails)",
      "Vocal chop + rhythmic vocal texture (TikTok hook punctuation, not melodic)",
      "Key shift up 2 semitones in bridge (energy reset, expected surprise)",
      "Minimal verse → maximal chorus (dynamic contrast, not constant density)",
      "Swung hi-hat groove with lazy kick pocket (human feel, not grid-locked)",
      "Synth pad as emotional foundation (lush reverb, never upfront)",
      "Doubled vocal layers panned hard L/R in chorus (width, but not diffuse)",
      "Filtered or reversed vocal ad-lib for bridge texture (one dramatic change)",
      "Silence or sudden strip-down before final chorus (reset, then explosion)",
      "LUFS mastering for streaming feel (–5.5 to –6.5 LUFS short-term, not brick-wall)",
      "Two-stage gentle compression on master (preserve dynamics, avoid squashing)",
      "Organic layering (mix analog bass warmth with digital synth depth)"
    ],
    "currentSubgenres": [
      "Dance-pop (hyperpop/electro-pop blend, 124-130 BPM)",
      "R&B-pop fusion (soulful, warm production, vintage analog warmth)",
      "Cinematic pop (orchestral textures, emotional depth, 90-120 BPM ballads)",
      "Trap-pop (rhythmic 808s with melodic pop sensibility, 90-100 BPM perceived)",
      "Hyperpop-adjacent (experimental production, chopped vocals, Gen-Z branding)",
      "Latin-trap pop (reggaeton rhythm + pop melody, 92-100 BPM)",
      "UK garage-pop (funky breakbeats, tight production, 140+ BPM feel slowed via pocket)"
    ],
    "whatMakesItHitNow": [
      "Hook repeatability: 15-30 second clip from intro or chorus must be earworm-ready for TikTok (short-form dominance)",
      "Vocal personality: conversational intimacy + signature ad-lib (relatability is the currency)",
      "Genre-blending DNA: pop DNA that flexes R&B, dancehall, or electronic without losing pop accessibility",
      "Cinematic production (lush, layered, emotionally present—'cinematic' in 25% of production requests)",
      "Global language code-switching (multilingual ad-libs, cross-market appeal)",
      "Emotional authenticity over perfection (stripped verses, human groove, imperfect vocal takes valued)",
      "Trend-agnostic hook (timeless melodic + rhythmic structure, not trend-dependent)",
      "Pocket groove over metronomic precision (lazy kick, swung hats = human feel)",
      "Hybrid production (analog warmth + digital clarity, not pure synth or pure organic)",
      "TikTok virality baked in (clip-friendly endpoint, 30-45 sec hook climax, easy to dance/lip-sync to)"
    ],
    "currentReferenceLanes": [
      "PinkPantheress: hyperpop precision meeting pop hooks (ethereal, Gen-Z experimental)",
      "Olivia Dean: R&B-influenced warmth + modern pop clarity (soulful authenticity lane)",
      "Zara Larsson: anthemic pop radio accessibility + global appeal (mainstream lane)",
      "RAYE: UK production sophistication + cinematic depth (artistic credibility lane)",
      "Slayyyter: synth-heavy electronic textures + pop melody (avant-garde pop lane)",
      "The Weeknd: cinematic scope, synth-driven atmosphere, vocal layering mastery (production innovation lane)",
      "Dua Lipa: dance-pop precision + hook architecture (radio-friendly energy lane)"
    ],
    "freshTokens": [
      "pocket-lazy-kick",
      "reverb-washed-ad-libs",
      "vocal-chop-punctuation",
      "swung-hi-hat-feel",
      "cinematic-pad-bed",
      "multilingual-ad-lib",
      "bridge-key-shift",
      "TikTok-clip-ready",
      "doubled-vocal-width",
      "gentle-master-compression"
    ],
    "bpmDriftNote": "120 BPM is the safe center for pop; 124-130 BPM for dance-pop energy; 90-100 BPM for emotional ballads (perceived BPM drops if groove is lazy/pocketed). High-energy trap-pop can sit at 140+ BPM but FEEL like 70 via kick placement (not perceived as tempo). TikTok-viral clips favor 115-125 BPM for dancing/lip-sync pacing.",
    "confidence": "high",
    "sources": [
      "https://www.billboard.com/lists/best-songs-2026-so-far/",
      "https://blog.landr.com/music-trends/",
      "https://www.epidemicsound.com/blog/music-trends-2026/",
      "https://elements.envato.com/learn/music-trends",
      "https://bpmcalc.com/genres/pop/",
      "https://www.masteringthemix.com/blogs/learn/mastering-trends-for-2026"
    ],
    "researchedAt": "2026-07-05"
  },
  "rnb": {
    "genre": "rnb",
    "trendingProductionMoves": [
      "Live instrumentation + trap-influenced drums: organic keys (Rhodes, Wurlitzer) paired with syncopated 808 pocket, bridging neo-soul + alt R&B",
      "Sidechain compression: pads/keys duck to vocal, kick drives dynamic shape. Creates modern clarity without sacrificing lushness",
      "Vocal layering as production anchor: lead + harmony + ad-lib triple threat replaces synth leads; voice IS the instrument",
      "Jazz-informed extended chords (maj7, 9ths, 11ths) replacing pop-simple I–IV–V; adds sophistication for streaming algorithm editorial picks",
      "Human-timed, swing-quantized percussion: pocket-locked grooves (NOT grid-perfect) signal authenticity + contemporary R&B credibility",
      "Afrobeats percussion accent (drum roll, shaker swell) pre-chorus/bridge: signals global sound, TikTok-native virality hook",
      "Minimalist verses (vocal-forward, sparse kicks) → wall-of-sound chorus: dynamic production arc for short-form clip wins",
      "Synth pads with 3–4 sec decay (dark, small-room reverb): creates emotional 'space' without sounding dated or lo-fi"
    ],
    "currentSubgenres": [
      "Alternative R&B (PBR&B, ethereal chillwave-touched, SZA + Frank Ocean lane)",
      "Neo-Soul (live instrumentation, sophisticated harmony, UK artists Cleo Sol / Lianne la Havas)",
      "Dark R&B / Trap-R&B Hybrid (synth-forward, The Weeknd production aesthetic)",
      "Bedroom R&B (intimate, reverb-heavy, viral TikTok shorts lane)",
      "Afrobeats-R&B Fusion (drums from Afrobeats, R&B vocal + harmony texture)",
      "Jazz-Influenced Contemporary R&B (extended chords, groovy pocket, GENA / Liv.e lane)"
    ],
    "whatMakesItHitNow": [
      "TikTok 15–30 sec hook: minimal verses with powerful, singable chorus; vocal runs as TikTok clip bait",
      "Soulful vocal delivery + modern production: warm intimacy (neo-soul cred) + 808/synth polish (contemporary credibility)",
      "Pocket-locked, conversational groove: NOT mechanical; swing-quantized percussion signals human artistry + authenticity (Gen-Z credibility)",
      "Layered harmony textures: vocal stacking (main + 2nd + ad-lib) mimics band feel, reads as 'lush + expensive production' on small speakers",
      "Extended-chord sophistication: maj7/9ths land well on lo-fi earbuds, stream sorting, editorial playlists (music-theory credibility)",
      "Narrative vocal ad-libs: 'Yeah,' riffs, runs serve as TikTok reaction element (users duet/respond), organic virality",
      "Afrobeats percussion touch: drum roll, shaker swell → signals global, Gen-Z multi-genre listening (avoids 'too R&B' pigeonholing)",
      "Intimate verse / powerful chorus contrast: mobile-first listening (headphones in transit), emotional journey in 3 min"
    ],
    "currentReferenceLanes": [
      "SZA lane: ethereal, PBR&B, chillwave + R&B fusion, experimental texture (2025-2026 chart dominance)",
      "Neo-Soul Live Lane: Cleo Sol, Lianne la Havas, GENA; organic keys, sophisticated harmony, indie-credibility aesthetic",
      "The Weeknd Dark R&B: synth-forward, atmospheric, moody production, cinematic reverb chains",
      "Frank Ocean Introspective Alt-R&B: minimal arrangements, unexpected chord shifts, production as storytelling",
      "Victoria Monet Contemporary Soulfulness: accessible melody + modern production, chart-competitive R&B pop-R&B bridge",
      "TikTok Viral Bedroom R&B: intimate, reverb-heavy, short-form hook-focused, authenticity-first"
    ],
    "freshTokens": [
      "Swing-quantized pocket, never grid",
      "Jazz 7ths + 9ths, no basic triads",
      "Vocal triple-layer: lead + harmony + ad-lib",
      "808 sub + Rhodes warmth (neo-soul+trap)",
      "Intimate verses, lush chorus arc",
      "Afrobeats drum roll accent (lift)",
      "Sidechain keys to vocal, human timed",
      "Dark pad reverb, 3–4 sec decay",
      "Conversational phrasing, breath space",
      "Plate reverb chorus, de-essed lead"
    ],
    "bpmDriftNote": "Classic R&B range 65–95 BPM; 2026 uptempo hybrid tracks (alt R&B / trap-R&B) may sit 100–120 BPM at half-time feel (perceived 50–60 BPM pocket). Ballads drop to 50–65 BPM. Default 80 BPM is sweet spot for streaming algorithm (not too slow = maintains energy, not too fast = preserves intimacy).",
    "confidence": "high",
    "sources": [
      "https://orphiq.com/resources/bpm-tempo-guide",
      "https://output.com/blog/rnb-type-beat",
      "https://bpmcalc.com/genres/rnb/",
      "https://www.soundverse.ai/blog/article/how-to-make-an-rb-song-1318",
      "https://thebluesproject.co/2026/04/30-rnb-artists-to-watch-2026/",
      "https://www.masterclass.com/articles/neo-soul-music-guide"
    ],
    "researchedAt": "2026-07-05"
  },
  "dancehall": {
    "genre": "dancehall",
    "trendingProductionMoves": [
      "Amapiano log-drum layered under one-drop kick for dual-rhythm hypnosis (South African influence dominating 2025-26)",
      "Trap-inflected 808 replacing traditional sine-wave bass on modern riddims (Skilllibeng, newer producers)",
      "Vocoder/heavy autotune on hook vocals (Gen-Z TikTok acceptance, departure from organic toasting)",
      "Sub-60 Hz bass automation with sidechain pumping tied to hi-hat roll for perceived pocket depth",
      "Pitched vocals or reversed vocal stabs as rhythmic percussion element (production-as-instrument trend)",
      "Afrobeats cross-percussion: clave, friction drum, talking drum layered under timbales (Rihanna/Popcaan collabs)",
      "Synth wobble replacing pure sine-wave bass on 50% of new releases (gen-next production, easier sound design)",
      "Short-form TikTok hooks compressed into 12–16 bars with drop at bar 8 (algorithm optimization)"
    ],
    "currentSubgenres": [
      "Afrobeats-Dancehall (dominant cross-genre as of 2026, led by Rihanna, Popcaan, Sean Paul collabs)",
      "Trap-Dancehall (808s replacing wobble bass, faster hi-hat rolls, Skilllibeng/new wave)",
      "Singjay Ballad (emotional, minor-key riddims with orchestral strings, slower 80–85 BPM)",
      "Bashment Riddim (hard-hitting one-drop, pure toasting, festival/sound-system culture)",
      "UK Afrobashment (London-based fusion: grime swing plus dancehall pocket plus drill energy)",
      "Amapiano-Dancehall (South African log-drum meets Jamaican riddim, viral on TikTok 2025-2026)",
      "Reggaeton-Dancehall (dembow syncopation bleeding into riddim, Latin cross-pollination, niche but growing)"
    ],
    "whatMakesItHitNow": [
      "Viral TikTok choreography tied to track release (Shenseea Dance Challenge 2026 model—dance drives streaming)",
      "Afrobeats collaborations with A-list Nigerian/UK artists (cultural dominance of Afro-diaspora sound)",
      "Emotional vulnerability in minor-key verse, explosive chorus energy (Gen-Z emotional honesty vs pure hype)",
      "Female-led vocal lines (Shenseea, Spice, Rihanna lane breaking male-dominated toasting tradition)",
      "Short-form hook format (15–45 sec) built for YouTube Shorts/TikTok reels, not radio-friendly full-length",
      "Patois authenticity with global accessibility (code-switching to English on hook for non-Caribbean streams)",
      "Production cleanliness and phone-speaker clarity (sub-bass clarity critical; low-end mudiness kills viral spread)",
      "Nostalgic riddim reinterpretation (taking classic 1990s-2000s riddims, re-layering with modern production)"
    ],
    "currentReferenceLanes": [
      "Viral Hype Lane: Chronic Law, Valiant, Skippa (energy, club-readiness, TikTok catchiness)",
      "Conscious Lyricism Lane: Masicka, Chronixx (depth, sociopolitical commentary, roots reverence)",
      "Crossover Mainstream: Rihanna, Sean Paul, Popcaan (Dancehall-Afrobeats fusion, global streaming optimization)",
      "Experimental/Producer-Forward: Skilllibeng, Rvssian (trap-riddim hybrids, synth innovation, genre-blending)",
      "Female Power Lane: Shenseea, Spice (party energy, choreography, female agency, breaking into male-heavy genre)",
      "UK Afrobashment: Wizkid x Jamaican producers (grime-meets-riddim, diaspora sounds)",
      "Roots-Conscious: Protoje, Jah9 (reggae-dancehall bridge, conscious lyricism, acoustic-hybrid)"
    ],
    "freshTokens": [
      "one-drop locked, wobble-bass breathing",
      "toasting-meets-TikTok hook formula",
      "patois authenticity + Afrobeats percussion layer",
      "short-form viral choreography-ready",
      "amapiano log-drum under riddim drop",
      "singjay emotional verse, explosive chorus shift",
      "trap-808 replacing sine-wave bass",
      "sub-bass sidechain pumped to hi-hat roll",
      "vocal-ad-lib as rhythmic percussion",
      "Afro-diaspora sound = cultural currency 2026"
    ],
    "bpmDriftNote": "Classic dancehall holds 80–100 BPM tight; modern trap-influenced cuts hover 100–110 BPM (faster hi-hats, more syncopation). Afrobeats collabs often sit 88–95 BPM as compromise. TikTok short-form content doesn't care about BPM precision—choreography energy matters more. Singjay ballads drop to 75–85 BPM for emotional space. No drift upward expected in 2026; if anything, a return to <92 BPM 'classic riddim' is emerging as counter-trend to trap-saturation.",
    "confidence": "high",
    "sources": [
      "https://blog.soundtrap.com/how-to-make-dancehall-beats/",
      "https://www.futureproducers.com/forums/threads/what-tempo-do-you-use-for-reggae-bashment.396117/",
      "https://bpmcalc.com/genres/reggae/",
      "https://artistrack.com/afrobeats-global-fusion-trends-2026/",
      "https://soundcy.com/article/how-to-make-riddim-sounds",
      "https://wtmhstudio.com/dancehall-drum-kits-advanced-packs-riddim/"
    ],
    "researchedAt": "2026-07-05"
  },
  "drill": {
    "genre": "drill",
    "trendingProductionMoves": [
      "Melodic drill: adding 8-16 bar melodic breakdowns before hooks (minor-key flute or horn leads over minimal drums)",
      "Filter automation on 808: LPF sweep creating breathing effect (opens during drops, closes during verses)",
      "Vocal layering density: 3-5 vocal layers in ad-lib sections (call-and-response multiplication for TikTok viral clips)",
      "Ambient drill subgenre: reverb-heavy strings (3-4s decay), slowed 808 glides (1/4 note instead of 1/8th), spacious hi-hat rolls",
      "Afro-drill fusion: layering afrobeat drum patterns (talking drum, cowbell) under drill 808 foundation; Nigerian + UK production blend",
      "AI-powered sound kits: drill producers packaging genre-specific 808 slides, hi-hat loops, and orchestral texture packs as revenue streams (post-2025 phenomenon)",
      "Snippet-driven production: 9-16 bar hook loops optimized for TikTok/YouTube Shorts vertical clips (viral production constraint driving beat structure)"
    ],
    "currentSubgenres": [
      "UK Drill: orchestral strings, eerie minor-key melodies, London accent, emphasis on street narrative and struggle themes",
      "NY Drill (Brooklyn): sparse minimal 808s, simpler harmonic structure, Brooklyn accent, power/luxury/gang-rivalry themes",
      "Melodic Drill: minor-key melodic leads (flute, horn), slower 808 glides, emotional arc over hard production",
      "Ambient/Spacious Drill: reverb-heavy strings, 50-80ms pre-delay, slowed 808 pitch glides (felt slower), meditative tension",
      "Afro-Drill: afrobeat percussion layers (hi-life snares, talking drums, cowbell) fused with drill 808 and dark strings, Nigerian + UK production aesthetic",
      "Melodic Trap-Drill Hybrid: drill pocket (140-150 BPM, syncopated hi-hats) with trap hi-hat rolls and softer melodic flow (cross-genre appeal)"
    ],
    "whatMakesItHitNow": [
      "Viral hook structure: 8-bar loop repeatable on TikTok (hook lock, minimal lyrical complexity, infectious ad-lib call-and-response)",
      "TikTok/YouTube Shorts optimization: drill beats are short-form native (9:16 vertical clips, 15-60s duration). Hooks drop by 0:08-0:16. Winner patterns: 4-bar intro, 8-bar hook, repeat with ad-lib variation.",
      "Authentic street voice + production sophistication: winners blend gritty vernacular delivery with intricate production (orchestral strings + 808 slides) — credibility meets polish",
      "Ad-lib culture as hype mechanism: layered vocal doubles and reverb-heavy ad-libs create energy without lyrical repetition. Ad-libs ARE the hook texture on many 2026 charting tracks.",
      "Regional authenticity: UK drill (London accent, local reference specificity) and NY drill (Tri-state cadence, power themes) retain regional lane loyalty while TikTok trends pull toward crossover (Central Cee, Afro-drill hybrids gaining global traction)",
      "Production freshness: 2026 winners use non-obvious string samples, unique 808 pitch contours, and micro-adjusted hi-hat timing. Generic drill sample packs are disqualifiers.",
      "Minor-key emotional intensity: drill's harmonic tension (minor keys, suspended voicings) taps into dark-mode aesthetic popular in short-form (TikTok aesthetic = dark, intense, quick payoff)"
    ],
    "currentReferenceLanes": [
      "Headie One: UK dark minimalism (orchestral restraint, eerie tension)",
      "Pop Smoke: NY foundational 808-slide pioneer (sparse, heavy sub-bass presence)",
      "Digga D: UK sophisticated production (complex string arrangements, emotional depth)",
      "Fivio Foreign: NY aggressive street authenticity (power delivery, minimal production)",
      "Central Cee: UK-US crossover fusion (melodic hooks, bilingual appeal)",
      "Bnxn/Buju: UK-Afro hybrid (rhythmic innovation, percussion texture blending)",
      "Minikeyyy: UK emerging subgenre explorer (melodic drill, atmospheric production)"
    ],
    "freshTokens": [
      "gliding 808 with filter breath",
      "syncopated hi-hat skitter",
      "orchestral eerie pads",
      "tight snare pocket",
      "dry punchy vocal + reverb ad-libs",
      "single-note melodic outline",
      "call-and-response vocal doubles",
      "minor-key harmonic tension",
      "afrobeat percussion layer",
      "snippet-loop viral hook"
    ],
    "bpmDriftNote": "Drill BPM has remained stable at 140-150 (particularly 142-145 for UK, 145-150 for NY) since 2015 without major drift. The perceived tempo is half-time due to tight pocket and sub-bass dominance. Melodic drill subgenre occasionally sits 5-10 BPM lower (135-140) for emotional space, but core lane stays anchored. No drift expected 2026-2027.",
    "confidence": "high",
    "sources": [
      "https://orphiq.com/resources/drill-chords",
      "https://wavgrind.com/blogs/music-production/how-to-produce-drill-beats",
      "https://www.soundverse.ai/blog/article/how-to-make-drill-beats-0205",
      "https://blog.landr.com/drill-chords/",
      "https://g3n.ro/blog/uk-drill-vs-new-york-drill/",
      "https://vocalpresets.com/blog/best-drill-vocal-presets-2026"
    ],
    "researchedAt": "2026-07-05"
  },
  "trap": {
    "genre": "trap",
    "trendingProductionMoves": [
      "Sidechain pumping on entire mix (not just 808), creates hypnotic wash",
      "Reverse hi-hat decay (sound plays backward), morphs into forward hit",
      "808 granular synthesis / wavetable modulation (not just pitch bend)",
      "Vocal chop layers stacked atonal-ish below lead for texture",
      "Sub-bass (20-60Hz) decoupled from kick, adds rumble without clutter",
      "Filter automation on snare (high-pass sweep 500Hz→5kHz during builds)",
      "Pitched vocal ad-libs harmonized algorithmically (Soundtoys Decapitator-style)",
      "Delay repeat on last beat of bar, creates ghosting / dub effect",
      "Mid-side compression: wide percussion, tight kick/808 center"
    ],
    "currentSubgenres": [
      "Melodic trap (airy, crossover-friendly, major-chord borrowed)",
      "Hard trap (dark, aggressive, locked to i-iv-v, Memphis-influenced)",
      "Plugg/PlugTrap (wonky samples, pitched percussion, sub-100 BPM halftime)",
      "Rage trap (mosh-pit energy, distorted sub, punk attitude)",
      "Cloud rap (ethereal pads, ambient 808, introspective)",
      "Trap soul (soulful chords, smooth 808, R&B vocal delivery)",
      "Afro-trap (Afrobeats percussion over trap 808, polyrhythmic)",
      "Latin trap (Spanish vocal flow, reggaeton snare swing, cumbia drums)"
    ],
    "whatMakesItHitNow": [
      "Sub-10 second hook lock: producer tag, 808 slide, or vocal motif immediately",
      "TikTok/Reels format: hard cut at bar 8-12 for scroll-thumb engagement",
      "Sidechain pumping under vocals for hypnotic, app-like feel",
      "Crossover appeal: melodic major-chord moments + hard 808 contrast",
      "Ad-lib layering depth (3-5 layers on hook) for repeat-listen value",
      "Bright high-end air (8-16kHz) cuts through phone speakers + earbuds",
      "Pitched 808 movement (bends, filter automation) prevents ear-fatigue",
      "Vocal vulnerability + mic-close intimacy (whisper ad-libs, breath)",
      "Visual + audio sync potential: drum fills land on beat drops for edit cuts"
    ],
    "currentReferenceLanes": [
      "Travis Scott aesthetic: polished, layered, cinematic, genre-blur",
      "Metro Boomin precision: locked groove, minimal-maximal detail, timeless",
      "SoundCloud/Plugg experimentalism: pitched drums, sample chops, DIY edge",
      "Melodic crossover (Post Malone / Juice WRLD school): emotional, lo-fi hybrid",
      "UK drill-trap fusion: grime snare patterns over trap 808, regional bleed",
      "Rage trap (Playboi Carti / Rage Beat School): distorted, chaotic, punk spirit"
    ],
    "freshTokens": [
      "sidechain-wash-hypnotic",
      "pitched-808-motion",
      "hi-hat-triplet-rolls",
      "melodic-pads-dark-minor",
      "vocal-layering-ad-lib-depth",
      "filter-sweep-automation",
      "reverse-hi-hat-texture",
      "808-granular-morph",
      "sub-bass-decoupled",
      "mid-side-stereo-width"
    ],
    "bpmDriftNote": "Standard 140-150 BPM perceived as aging (2025+). Producers edge to 135-140 (heavier feel) or 155-165 (lean, modern). Detroit trap trends faster (160-175), West Coast melodic slower (125-135). TikTok dominates 145-150 for algorithm retention (optimal swipe-speed cadence).",
    "confidence": "high",
    "sources": [
      "https://houseoftracks.com/faq/what-is-the-typical-tempo-range-for-trap-music",
      "https://producerfury.com/resources/trap-bpm-guide",
      "https://lukemounthillbeats.com/music-production/how-to-choose-beat-tempo-and-key/",
      "https://splice.com/blog/what-is-trap-music/",
      "https://beatstorapon.com/charts/subgenre/trap",
      "https://emastered.com/blog/trap-chord-progressions"
    ],
    "researchedAt": "2026-07-05"
  },
  "house": {
    "genre": "house",
    "trendingProductionMoves": [
      "Hyperpop/Alt-House vocal chopping and AI-voice effects blended into melodic house (early-2026 Splice trend)",
      "Breakbeat-influenced drum fills layered under four-on-floor (speed garage × house hybrid, 778% growth on Splice 2025)",
      "Modulation shifts (half-step up in second drop, common in melodic-house crossovers)",
      "Organic percussion (live congas, bongos, rain sticks) atop electronic 808/909 (afro-house signature, 70% of new house releases)",
      "Vocal rap/spoken-word over soulful house grooves (tech-house×rap crossover viral on TikTok, 2026)",
      "Filter sweeps with LFO modulation (hi-pass on pad at every chord change, creates fluidity without reverb bloat)",
      "Dual-bass approach: pure sub-bass + distorted/filtered mid-bass riff (modern depth, separation)",
      "Reverb-drenched vocal chops looped as part of main groove (not just effect, but melodic element)",
      "Ambient intro/outro paired with peak-time drop (juxtaposition, common in festival-oriented house)",
      "Sidechain to snare instead of kick in breakdowns (creates polyrhythmic pump, fresh energy)"
    ],
    "currentSubgenres": [
      "Afro House (griot-rooted, organic percussion, polyrhythmic clave influence; 778% growth in 2025, now ~70% of house downloads)",
      "Deep House / Soulful House (7th/9th chords, introspective, laid-back; evergreen, still tops Beatport weekly)",
      "Tech House (minimalist groove, hypnotic builds, DJ-centric; popular for peak-time club sets)",
      "Melodic House (lush synths, 75% growth in 2025, 3.2M downloads on Splice; chart-friendly)",
      "Progressive House (evolving arrangements, longer intros/outros, festival-dominant)",
      "Jazz House / Blue House (swing hi-hats, live horn samples, jazz voicings; emerging niche)",
      "UK Garage / Speed Garage (breakbeat-influenced, 625% growth in 2025, hybrid with house)",
      "Vocal Tech House / Rap House (spoken or rap vocal layers over house groove; viral TikTok trend)"
    ],
    "whatMakesItHitNow": [
      "Groove-first ideology: rhythm and pocket trump chord novelty (listeners repeat-listen for feel, not harmony)",
      "Accessibility + underground credibility: TikTok clips (15–30 sec) of hook/groove drive chart placement; full track sustains 6+ mins for DJ sets",
      "Organic + electronic balance: live percussion/guitar over electronic drums (authenticity signals in 2026)",
      "Global hybridity: multilingual vocals, cultural percussion samples (afro, latin, middle-eastern), non-Western harmonic sensibilities welcome",
      "Sidechain visual metaphor: heartbeat pump on drop = physiological response, TikTok-native danceability",
      "Minimal but expansive: fewer elements but richer each; one synth pad over 32 bars vs. muddy stack of 10 sounds",
      "Vocal authenticity: breathy, imperfect, late-to-beat (anti-pop-perfection); listeners connect with realness over technical prowess",
      "Sub-bass punch: clear, felt sub (80–120 Hz) signals club/arena quality (even streaming listeners expect tactile bass)",
      "Breakdown moments: every 4–5 min a sparse, DJ-friendly reduction (enables remix culture, live mashups)",
      "Chart-crossover potential: house no longer confined to Beatport; now co-tops Spotify, Apple Music alongside pop/hip-hop"
    ],
    "currentReferenceLanes": [
      "Solomun-style melodic introspection: layered pads, filter sweeps, minimal drums, peak-time euphoria",
      "Honey Dijon-style Chicago classicism: gritty filtered synth, deep vocals, real-house heritage, fashion-forward production",
      "Peggy Gou-style pop-house crossover: accessible groove, bright synths, uplifting energy, radio-friendly but club-credible",
      "Black Coffee-style afro-house: organic percussion, griot-rooted harmonic sensibility, DJ-centric arrangement, Pan-African pride",
      "Dennis Ferrer-style NYC deep: gritty clavinet, live drums, jazz influences, late-night intimate groove",
      "Carl Cox-style peak-time tribal: driving four-on-floor, ethnic percussion samples, festival euphoria, high-energy builds"
    ],
    "freshTokens": [
      "pocket-locked groove",
      "hypnotic 4/4 foundation",
      "soulful minor 7th chords",
      "sidechained sub-bass pump",
      "swung hi-hat swing",
      "cowbell polyrhythm (afro)",
      "breathy laid-back vocal",
      "filtered bassline riff",
      "clavinet stab punctuation",
      "reverb-drenched vocal chop loop"
    ],
    "bpmDriftNote": "House remains anchored at 120–126 BPM; rare excursions to 115 or 130+ signal crossover (house-techno bridge). TikTok clips often loop shortest rhythmic unit (~30 sec) regardless of full track length; full-track BPM consistency essential for streaming/DJ playback. Afro house leans toward 120–122 BPM for soulful restraint; peak-time tech-house reaches 124–126 for dancefloor drive.",
    "confidence": "high",
    "sources": [
      "https://playhousesound.com/the-best-bpm-for-afro-house/",
      "https://www.samplesoundmusic.com/blogs/news/the-ultimate-guide-to-afro-house-production-in-2025-tips-tricks-and-techniques",
      "https://www.zipdj.com/blog/house-music-bpm",
      "https://medium.com/@solosazesahora/why-house-music-will-be-the-defining-sound-of-2026-60634d3641b5",
      "https://andysowards.com/blog/2026/guide-to-edm-subgenres-in-2026-house-techno-dubstep-more/",
      "https://www.stereofox.com/articles/fastest-rising-electronic-music-genres/"
    ],
    "researchedAt": "2026-07-05"
  },
  "edm": {
    "genre": "edm",
    "trendingProductionMoves": [
      "Forensic micro-timing work: shuffle transient shaping, bass texture sculpting (sub/top separation for definition)",
      "Hybrid genre blending: EDM anchors + afrobeats, K-pop features, psych-rock remixes for dancefloor",
      "AI-assisted prototyping: text-to-music seeds refined in DAWs for rapid iteration",
      "Emotional sophistication in hard genres: hard techno + melodic depth (Afterlife aesthetic)",
      "Short-form viral mechanics: 15-30s hooks for TikTok/Reels before full release",
      "Vocal processing as synth: vocoders, stutters, filtered ad-libs as texture not traditional line",
      "Breakbeat legitimacy: drum & bass on US mainstage (formerly underground), influencing architectures",
      "Modulation tricks: key shifts, modal interchange, borrowed chords for surprise",
      "Organic percussion: afro drum rolls, shakers, cowbells integrated into kick-bass grid"
    ],
    "currentSubgenres": [
      "Tech House (126-134 BPM): Groove-first, forensic production detail",
      "Melodic Techno/House (122-130 BPM): Cinematic builds, Afterlife aesthetic, emotional depth",
      "Hard Techno (148-165 BPM): Industrial kicks, raw power, emotional guidance",
      "Afro House (118-126 BPM): 778% growth; organic percussion, soulful vocals",
      "Drum & Bass (170-180 BPM): Liquid to neuro, US mainstage achievement",
      "Progressive House Revival: Gradual builds, melodic layering, atmosphere",
      "Future Bass (100-140 BPM): Emotional chords, melodic drops, pop songwriting",
      "Speed Garage (125-145 BPM): 625% growth; UK garage flips, breakbeats",
      "Trance: Euphoric builds, epic breakdowns, cinematic arrangement",
      "Christian EDM: Festival-quality production, worship aesthetic"
    ],
    "whatMakesItHitNow": [
      "TikTok virality: 15-30s hooks for loop/re-share before full track",
      "Cross-cultural melody: multilingual hooks, code-switching ad-libs, global appeal",
      "Emotional authenticity: vulnerability in drops (minor key, pads, intimate vocals)",
      "Breakbeat credibility: drum & bass legitimizes EDM for Gen Z",
      "Micro-community ecosystems: independent festivals, communities, producer networks",
      "AI-assisted remixing: sample flips democratize producer entry",
      "Genre fluidity: artists switch tech house, afro, melodic techno in same year",
      "Vocal vulnerability: whispered ad-libs + hard drops create impact contrast"
    ],
    "currentReferenceLanes": [
      "Melodic-euphoric (Avicii): minor-key progressions, emotional pads, orchestration",
      "Tech-precision (Calvin Harris): groove-forward, clarity, tight kick/bass",
      "Big-room festival (Martin Garrix / SHM): anthem progressions, massive drops",
      "Atmospheric-progressive (Dixon): slower builds, filter mod, minimal-maximal detail",
      "Afro-soulful (Black Coffee / Kaytranada): percussive richness, vocals, roots",
      "Hard-emotional (Amelie Lens): intensity + vulnerability, industrial + harmony",
      "Future-pop (Disclosure): pop songwriting + electronic, vocal-first",
      "Breakbeat-sophisticated (Calibre, High Contrast): drum & bass with melody"
    ],
    "freshTokens": [
      "sidechain-pump-glue",
      "sub-bass-top-bass-separation",
      "euphoric-minor-key-shift",
      "filter-lfo-sweep-energy",
      "vocal-chop-percussion-layer",
      "micro-shuffle-pocket-groove",
      "breakbeat-legitimacy-moment",
      "short-form-hook-viral-engine",
      "afro-percussion-organic-texture",
      "hard-techno-emotional-guidance"
    ],
    "bpmDriftNote": "Festival EDM spans 110-180 BPM across subgenres in single weekends. Tech house 126-134 (club-to-festival sweet spot). Afro house lower 118-126 (groove emphasis). Hard techno 148-165. Drum & bass 170-180. Average 128 BPM stable; micro movement sustains independent subgenre BPM cultures.",
    "confidence": "high",
    "sources": [
      "https://www.zipdj.com/blog/edm-bpm",
      "https://vibesdj.io/dj-tools/edm-genre-chart",
      "https://www.edmsauce.com/2026/03/27/top-edm-subgenres-dominating-2026-and-the-best-tracks-in-each/",
      "https://www.soundverse.ai/blog/article/how-to-produce-edm-music-0832",
      "https://futureproofmusicschool.com/blog/unlocking-the-secrets-of-edm-chord-progressions",
      "https://emastered.com/blog/edm-chord-progressions"
    ],
    "researchedAt": "2026-07-05"
  },
  "reggaeton": {
    "genre": "reggaeton",
    "trendingProductionMoves": [
      "Mexican Reggaeton (chugg): trap snare rolls + plugg-synth choices + dembow core (81% YoY streaming growth)",
      "Trap-reggaeton hybrid: half-time 808 drops, jersey club hi-hat rolls mid-verse, melancholic chord stacks",
      "Balkan/club influence: aggressive dembow with Balkan dance percussion accent (2026 viral trend: 'Lupita' model)",
      "Melodic richness layer: pop-reggaeton chord progressions (I–vi–IV–V), reducing pure dembow monotony",
      "AI/plugg-style synth textures: glitchy, de-tuned lead plucks, post-production vocal chops",
      "Shorter-form content: 16–32 bar drops for TikTok/Reels, aggressive hook placement at bar 8–12"
    ],
    "currentSubgenres": [
      "Reggaeton trap (Bad Bunny, Rauw, Feid influence)",
      "Mexican reggaeton/chugg (Yng Lvcas, regional LA/Mexico growing fast)",
      "Reggaeton chileno (corte chilenero fusion, top Latine subgenre on Spotify US)",
      "Reggaeton-R&B (Jhay Cortez, softer perreo)",
      "Reggaeton-pop (mainstream chart: J Balvin, Maluma crossover)",
      "Perreo traditionalist (Arcángel, street reggaeton, slower builds)"
    ],
    "whatMakesItHitNow": [
      "TikTok dance virality: hook placement at 0–16 bars, perreo-friendly rhythm for 15-second choreography",
      "Bad Bunny's 20B streams 2025: melodic reggaeton + trap production. Hybrid sound is chart gold.",
      "Short-form attention: aggressive energy at top (no 8-bar build). Drop at 0:08–0:12.",
      "International crossover: English-Spanish code-switch, reggaeton + Balkan/club percussion (2026 viral trend)",
      "Emotional depth: trap-reggaeton is replacing pure party reggaeton; introspective lyrics over perreo beat",
      "Subgenre fusion: plugg + reggaeton, Jersey club + reggaeton, R&B + reggaeton (genre eclecticism wins)"
    ],
    "currentReferenceLanes": [
      "Bad Bunny: melodic reggaeton + trap production (chart benchmark)",
      "Rauw Alejandro: reggaeton-trap with emotional depth + R&B inflection",
      "Yng Lvcas: Mexican reggaeton chugg pioneer (plugg + dembow)",
      "Feid: trap-reggaeton with introspective, moody atmospheric production",
      "Arcángel: perreo traditionalist + street credibility (regional influence)",
      "J Balvin: reggaeton-pop mainstream crossover lane",
      "Jhay Cortez: reggaeton-R&B soft perreo pocket",
      "Maluma: reggaeton-pop global accessibility (crossover lane)"
    ],
    "freshTokens": [
      "dembow + trap snare roll",
      "plugg-synth reggaeton",
      "perreo ad-lib sidechain",
      "reggaeton-Balkan percussion blend",
      "Mexican chugg (plugg + dembow)",
      "melodic reggaeton pop-fusion",
      "reggaeton-R&B pocket",
      "sub-bass pump-and-lock",
      "vocal ad-lib freestyle moment",
      "trap-reggaeton hybrid drop"
    ],
    "bpmDriftNote": "Reggaeton core is locked 85–100 BPM (typical 92). Trap-reggaeton hybrids occasionally dip to 80–85 for half-time drama, then snap back. Mexican chugg stays strict 90–98 for plugg-synth clarity. Avoid drift; grid lock is perreo essential.",
    "confidence": "high",
    "sources": [
      "https://www.accio.com/business/most-popular-reggaeton-artists-2025-trend",
      "https://orphiq.com/resources/what-is-reggaeton",
      "https://www.billboard.com/lists/latin-music-trends-2025-predictions/",
      "https://www.soundverse.ai/blog/article/what-music-genres-are-popular-right-now-0348",
      "https://www.drumloopai.com/reggaeton/common-patterns-used-in-reggaeton-beats/",
      "https://www.melodigging.com/genre/perreo"
    ],
    "researchedAt": "2026-07-05"
  },
  "country": {
    "genre": "country",
    "trendingProductionMoves": [
      "Vocal stacking (5–8 AI-blended layers) for emotional thickness vs. single lead-vocal style",
      "Trap-country production hybrid: 808 bass + hi-hat rolls over banjo/acoustic guitar",
      "Talk-sung or spoken-word intro (Jelly Roll, Morgan Wallen style) for narrative immediacy",
      "Pedal steel or banjo as signature texture; signals 'country' in first 2 seconds",
      "Pocket-off-grid kick (laid-back ghost notes vs. quantized) for human feel",
      "Pop-country crossovers: country vocal over pop-synth production (blurs genre lines, reaches TikTok)",
      "AI backing vocals + human lead vocal blend for polished 'band' sound without session singers",
      "Minimal intro/outro with maximum chorus production (dynamic range for impact)",
      "Vocal ad-libs as equal texture: grunts, breaths, bends are mixed audibly, not hidden",
      "String pads (orchestral, not country-specific) layered under chorus for cinematic scope"
    ],
    "currentSubgenres": [
      "Pop-Country: mainstream radio-friendly, synth-forward, wide appeal (Ella Langley, Luke Combs)",
      "Trap-Country: hip-hop drums (808, hi-hat rolls) + country vocals/instrumentation (Jelly Roll, Shaboozey)",
      "Gravel Country: heavier acoustic sound, big drums, darker storytelling (Zach Bryan, Jason Isbell influence)",
      "Country-Rap: rap lyrics over country instrumentation, verses rap/chorus sung (hybrid lane)",
      "Outlaw Country: gritty, raw vocal, minimal production, narrative-heavy (Chris Stapleton lineage)",
      "Bro-Country/Hick-Hop: truck/beer/rural imagery, energetic drums, party ethos (Jason Aldean, Hardy)"
    ],
    "whatMakesItHitNow": [
      "TikTok hook virality: 8–16 bar pre-chorus or chorus sits alone, repeatable, singable",
      "Authentic, specific storytelling (not generic love/heartbreak; 'that specific night in Texas')",
      "Vocal rawness/imperfection (rasp, breath, slight cracks are features, not flaws)",
      "Cross-genre appeal: country that plays on hip-hop radio (Morgan Wallen, Jelly Roll blend)",
      "Emotional narrative arc: redemption, vulnerability, growth within 3–4 minutes",
      "Production clarity: every element audible, not muddy (vs. classic country's warmth-over-clarity)",
      "Conversational delivery: feels like spoken story, not sung performance (intimacy)",
      "Short-form platforms: 15–60 sec hook clips that loop and drive streams (TikTok, Instagram Reels)",
      "Blended vocal textures: female harmony on chorus, male rap bridge (genre-blur appeal)"
    ],
    "currentReferenceLanes": [
      "Luke Combs lane: accessible, melodic, pocket-groove, radio-friendly, production clarity",
      "Morgan Wallen lane: gritty vocal, complex song structure, trap-country fusion, youthful fanbase",
      "Zach Bryan lane: acoustic minimalism, emotional intensity, 'gravel' aesthetic, Gen-Z appeal",
      "Jelly Roll lane: redemption narrative, street-credible hip-hop blend, vulnerable storytelling",
      "Chris Stapleton lane: soulful rasp, ballad-centric, timeless authenticity, no trends",
      "Pop-Country lane: synth-forward, radio-friendly hooks, broad demographic appeal (Ella Langley)"
    ],
    "freshTokens": [
      "Pocket-off-grid kick (laid-back ghost notes, human feel)",
      "Vocal stack density (5–8 layers, AI-blended backing vocals)",
      "Talk-sung intro (narrative immediacy, Jelly Roll style)",
      "Trap-country drum hybrid (808 + hi-hat rolls + country vocals)",
      "Conversational delivery (story-first, not performance-first)",
      "Banjo/pedal steel texture (genre-marker, signals 'country' instantly)",
      "TikTok hook virality (8–16 bar isolated pre-chorus/chorus repeat)",
      "Raw vocal ad-libs (grunts, breaths, bent notes, cracks as features)",
      "Thematic specificity (place, moment, character, not abstract emotion)",
      "AI vocal polish + human warmth blend (studio polish + bedroom authenticity)"
    ],
    "bpmDriftNote": "Modern country sits between 90–130 BPM, with 110–120 BPM as the sweet spot for radio and streaming. Slower ballads (90–95 BPM) retain storytelling intimacy; uptempo tracks (120–130 BPM) drive TikTok virality and danceability. Trap-country hybrids often sit 95–110 BPM with hi-hat rolls at 16th-note pace (sounding faster despite low main tempo). BPM choice signals mood: slow = vulnerability, mid = conversational, fast = party/energy. 2025–2026 shows no drift toward faster tempos (unlike EDM/pop); country tempo remains stable, emotional-narrative-driven.",
    "confidence": "high",
    "sources": [
      "https://songbpm.com/@country-music",
      "https://soundplate.com/typical-bpm-by-genre-chart/",
      "https://chosic.com/bpm-by-genre-list/",
      "https://festival2025.com/unveiling-the-sounds-of-2025-exploring-new-country-music-trends/",
      "https://music24.com/blog/emerging-music-trends-guide-2026-industry-pros/",
      "https://blog.landr.com/music-trends/"
    ],
    "researchedAt": "2026-07-05"
  },
  "rock": {
    "genre": "rock",
    "trendingProductionMoves": [
      "TikTok-optimized 15-30s riff intros (viral hook real estate)",
      "Vocal layering in final chorus (3+ harmonies creating wall-of-sound)",
      "Synth pad underlay in verses (texture without diluting rock identity)",
      "Drop-tuned bass (Drop D, Drop C) for heavier low-end aggression",
      "Feedback/noise gate swells as textural punctuation (bridge/outro)",
      "Mid-side stereo expansion in chorus for perceived width without lost punch",
      "Sidechain compression on vocal delays (creates rhythm separation)",
      "Reverse reverb on ad-libs and vocal shouts (modern, attention-grabbing)",
      "Lo-fi guitar tone in verse (high-pass filtered, intimate) vs. Hi-fi chorus (full bandwidth)",
      "Tempo micro-pushes in build sections (imperceptible +2-5 BPM acceleration)"
    ],
    "currentSubgenres": [
      "Pop-Rock (Killers/Coldplay lane): Anthemic, synth-integrated, radio-friendly",
      "Alt-Rock / Indie Rock (Arctic Monkeys, Turnstile lane): Experimental tone, groove-centric, guitar-forward",
      "Nu-Metal Revival (Deftones, Limp Bizkit resurgence): Heavy, textural, emotional depth, TikTok-driven",
      "Progressive Alternative (Muse, Sleep Token lane): Dynamic range, modal complexity, production sophistication",
      "Garage Rock / Post-Punk (rawer, DIY aesthetic): Tight grooves, minimal production, human error kept in",
      "Shoegaze-influenced Alt (walls of reverb, ethereal vocals over distorted guitars)"
    ],
    "whatMakesItHitNow": [
      "TikTok virality driven by explosive riff/hook in first 3 seconds (short-form video algorithm)",
      "Emotional authenticity over technical perfection (gen-Z craves human rawness, not polish)",
      "Live festival culture resurgence (rock posted 24% of radio songs by end 2025, up from 10% in 2021)",
      "Gen-Z embrace of 'vintage' rock acts (Deftones, Korn bigger than ever; nostalgia + algorithm push)",
      "Streaming playlist placement (alternative/indie playlists are high-traffic, discovery-heavy)",
      "Cross-genre fusion (rock + synth-pop production, rock + trap drums is less successful)",
      "Vocal authenticity (ad-libs sound unguarded, not pitched-corrected to death)",
      "Groove-over-notes ethos (pocket tightness and swagger matter more than harmonic complexity)"
    ],
    "currentReferenceLanes": [
      "Anthemic Pop-Rock (Coldplay, The Killers): Synth-integrated, emotional accessibility, radio-ready",
      "Groove-Centric Alt (Arctic Monkeys, Turnstile): Swagger, tight pockets, guitar character",
      "Progressive/Textural Alt (Muse, Sleep Token): Synth sophistication, dynamic range, production depth",
      "Heavy Texture Rock (Deftones, modern Tool): Reverb-drenched, emotional weight, low-end focus",
      "DIY/Garage Rock (raw, minimal production, authenticity-first)",
      "Shoegaze Revival (ethereal vocals buried in guitar texture)"
    ],
    "freshTokens": [
      "Riff-first songwriting (hook is guitar, not lyric)",
      "Pocket over precision (swing feel, human timing feel)",
      "Wall-of-vocals chorus (layered delivery, harmonic depth)",
      "Texture-led production (effects chain defines vibe)",
      "Feedback as instrument (noise = character, not flaw)",
      "Raw ad-lib delivery (spontaneity > auto-tune)",
      "Dynamic shrink-expand (stripped verse, layered chorus contrast)",
      "Distorted bass lock (kick + bass as one entity)",
      "Reverb-drenched intro (establishes mood, guitar-led mystery)",
      "Viral riff architecture (30-sec clip potential, memorable hook)"
    ],
    "bpmDriftNote": "Modern rock sits 115-135 BPM steadily. TikTok-viral tracks sometimes sit 125-128 (sweet spot for short-form video pacing). Nu-metal and heavier subgenres push 135-145. Ballads and build-oriented songs may start slower (100-110) then shift up in chorus—tempo shift itself is a production feature.",
    "confidence": "high",
    "sources": [
      "https://substreammagazine.com/2026/03/why-rock-music-is-trending-again-in-2026/",
      "https://www.soundverse.ai/blog/article/how-rock-music-made-a-comeback-in-2025-2026-2328",
      "https://www.billboard.com/pro/radio-songs-chart-five-year-trends-chartcipher/",
      "https://www.chosic.com/bpm-by-genre-list/",
      "https://orphiq.com/resources/bpm-tempo-guide",
      "https://emastered.com/blog/rock-chord-progressions"
    ],
    "researchedAt": "2026-07-05"
  },
  "soul": {
    "genre": "soul",
    "trendingProductionMoves": [
      "Trap-soul hybrid drums: half-time kick patterns with hi-hat micro-rolls (push slightly ahead of beat for bounce)",
      "808 glide bass layers underneath organic upright bass (sidechained to kick for warmth without mud)",
      "Sampled/vinyl-textured strings or horns (dusty, warm, never pristine)",
      "Analog tape saturation on all channels (subtle compression, harmonic warmth, slight distortion)",
      "Spatial audio and binaural vocal panning for intimate intimacy (especially on neo-soul records)",
      "Minimal hi-fi percussion: kick/snare/hi-hat only, everything else removed for *space*",
      "Looped organic arrangements (live instrumentation recorded and subtly looped for hypnotic groove)",
      "Jazz-chord voicing layers (ii-V-I progressions, extended 9ths/11ths) with minimalist melody",
      "Breathy, conversational ad-lib sections with instrumental dropouts (vocal sits over silence briefly)",
      "Lo-fi reverb and plate delay on vocals for 'bedroom soul' aesthetic even in high-production tracks"
    ],
    "currentSubgenres": [
      "Neo-Soul: Modern soul with hip-hop sensibilities, jazz harmony, live instrumentation (Alicia Keys, Jhené Aiko, Robert Glasper lane)",
      "Trap-Soul: Half-time drums, 808 bass, intimate vocals, minor-key introspection (Bryson Tiller, SZA influence)",
      "Bedroom Soul: Lo-fi, intimate, minimal production, bedroom-recorded aesthetic (SZA's softer tracks, R&B bedroom pop crossover)",
      "Gospel-Soul: Classic soul infused with gospel ad-libs, call-response, spiritual emotional core (persisting as evergreen sub-lane)",
      "Retro-Soul: Analog warmth, 70s-inspired production (Silk Sonic's full Motown revival, Bruno Mars collaborations)",
      "Jazz-Soul: Improvisation-forward, complex harmony, live band feel (Robert Glasper, Kamasi Washington influence seeping into soul proper)",
      "Sample-Soul: Chopped soul samples, beat-making focus, hip-hop DNA (production-first, Dilla influence persistent)",
      "Alt-Soul: Experimental, genre-blending (not quite R&B, not quite indie, very 2026)"
    ],
    "whatMakesItHitNow": [
      "Authenticity > perfection: Imperfect, human vocals + warm tape (not Auto-Tuned). TikTok soars for vulnerable ad-lib snippets.",
      "Pocket-obsessed production: Drums sit *in* the groove, not on top. Viral clips are groovy, not flashy.",
      "Vocalist as entire genre identity: One voice carries the song (no rap features, solo spotlight). YouTube Shorts + TikTok: vocal-centric clips get reposts.",
      "Minimalist arrangements: 4 instruments max in verse (vocal, keys, bass, drums). Chorus adds layers. Clarity wins.",
      "Short-form loop-ability: Chorus hooks under 20 seconds, groovy enough for TikTok 15-30 sec clips without context.",
      "Jazz harmony in pop melody: Sophisticated 9th/11th chords feel fresh + timeless (Coldplay-soul crossover energy, Gen Z sophisticated taste).",
      "Emotional directness: Lyrics and vocal delivery speak to late-20s/30s audiences (relationships, self-work, social awareness) without preaching.",
      "Collaborations within soul/jazz (not rap crossovers): Soul + indie pop, soul + rock textures (not soul + trap; that's trap-soul, different lane).",
      "Analog + digital blend: Tape warmth + spatial audio = 'premium' feel (audiophile appeal + TikTok discovery).",
      "Throwback production with modern songwriting: 2010s D'Angelo vibe production meets 2026 vulnerability narrative."
    ],
    "currentReferenceLanes": [
      "Alicia Keys (piano-soul sophistication, live instrumentation, vocal mastery)",
      "Anderson .Paak (neo-soul beatmaker, drumming virtuosity, hip-hop-soul fusion)",
      "SZA (contemporary vulnerable neo-soul, atmospheric production, TikTok virality)",
      "Silk Sonic/Bruno Mars (retro-soul revival, funk-soul pocket, analog production obsession)",
      "Jhené Aiko (ethereal neo-soul, layered vocals, minimalist production)",
      "Robert Glasper (jazz-soul piano sophistication, improvisation-centric)",
      "Erykah Badu (genre-defining neo-soul, live arrangement authority, ad-lib culture)",
      "Musiq Soulchild (understated groove mastery, classic neo-soul template)"
    ],
    "freshTokens": [
      "pocket-locked soul groove",
      "analog warmth, spatial intimacy",
      "ghost-note pocket discipline",
      "minor 7th sophisticated harmony",
      "close-mic vulnerable vocal delivery",
      "tape-saturated bass + 808 glide layer",
      "breathy ad-lib ad-infinitum",
      "gospel-soul call-and-response DNA",
      "minimalist, spacious arrangement",
      "vinyl-textured strings/horn stabs"
    ],
    "bpmDriftNote": "Neo-soul anchored 85-93 BPM (2025 trend data shows 81-93 range common). Classic soul 75-100 BPM. Trap-soul drops to 75-85 half-time. Production feels slower when pocket is deep; perceived BPM is often 5-10 BPM lower than click due to behind-the-beat phrasing. Match vibe over metronomic precision.",
    "confidence": "high",
    "sources": [
      "https://thebluesproject.co/2020/08/21-neo-soul-artists-to-watch/",
      "https://www.okayplayer.com/earthy-electric-eternal-the-rise-of-neo-soul/1417577",
      "https://dlksoul.com/modern-soul-music-evolving-sounds-and-new-directions/",
      "https://dlksoul.com/the-distinctive-elements-of-trap-soul-a-deep-dive-into-the-genres-unique-sound/",
      "https://stealifysounds.com/blogs/news/redefining-neo-soul-cutting-edge-soulful-music-production-techniques",
      "https://www.goldminemag.com/columns/the-tone-of-soul/four-more-modern-soul-must-haves-for-2026-so-far/"
    ],
    "researchedAt": "2026-07-05"
  }
};

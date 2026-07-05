/**
 * Genre ENRICHMENT — current (2026) production trends + hit / short-form patterns
 * per genre, web-researched as uncopyrightable FACTS (facts/patterns/analysis;
 * artists named only as STYLE LANES; NO verbatim lyrics or audio). This is the
 * "what's working NOW" layer, merged into the Sound DNA at projection time so
 * generation reflects what is charting today. Refresh via the
 * genre-enrichment-research workflow (see docs/STRATEGY.md). Auto-generated.
 */
export interface GenreEnrichment {
  genre: string;
  trendingProductionMoves: string[];
  currentSubgenres: string[];
  whatMakesItHitNow: string[];
  currentReferenceLanes: string[];
  freshTokens: string[];
  bpmDriftNote: string;
  confidence: string;
  sources: string[];
  researchedAt: string;
}

export const GENRE_ENRICHMENT: Record<string, GenreEnrichment> = {
  "afrobeats": {
    "genre": "Afrobeats (Nigerian/Ghanaian)",
    "trendingProductionMoves": [
      "Sparse drum arrangements with minimal synth (replacing dense loops)",
      "Off-beat syncopated kick placement on 1, 2.5, 4 (not four-on-floor)",
      "Log drum bass integration from Amapiano (deep woody thud at 50Hz-70Hz)",
      "Sidechain compression: kick ducks log drum for frequency clarity",
      "Rimshots/claves over traditional snares (organic, acoustic texture)",
      "Mid-tempo atmospheric production (105-115 BPM sweet spot) over loud club bangers",
      "Sparse shaker patterns on off-beats with tight transients",
      "Plate reverb on vocals (0.8-1.2s decay, intimate space)",
      "High-pass filter surgical EQ at 200Hz+ for melodic elements",
      "Log drum saturation: thermal saturation + multi-stage distortion for warmth"
    ],
    "currentSubgenres": [
      "Afrohouse",
      "Amapiano (South African influence)",
      "Afropiano (Afrobeats-Amapiano fusion)",
      "AfroTronica",
      "AfroWave",
      "NeoBeat",
      "Afro-Fusion with UK Drill elements",
      "Francophone Afro-pop"
    ],
    "whatMakesItHitNow": [
      "10-20 second danceable beat or catchy lyric snippet (TikTok first spark)",
      "Simple, repeatable choreography (not complex — invites creator remixes)",
      "Emotional resonance + vulnerability over flexing (love/heartbreak/mental health themes)",
      "Viral bridge + catchy hook + danceable outro (strategic 3-part structure)",
      "Emotional authenticity in storytelling (A&R gate: human narrative before algorithmic polish)",
      "Song length 2:57-3:00 (streaming-native with replay durability)",
      "TikTok hook window: 1.5-3 seconds (algorithm decision point must resolve by second 3)",
      "Cross-market utility: works in Lagos clubs, London diaspora sets, algorithmic playlists, wedding edits",
      "Clean, minimal vocal production (fuller body 200-400Hz, bright presence range)",
      "Creator-participation design (same sound, different faces/emotions triggers algorithmic push)"
    ],
    "currentReferenceLanes": [
      "Sarz — percussion-driven beats + futuristic synths defining Afrobeats architecture",
      "Pheelz — melodic commercial appeal, TikTok-friendly hits bridging local/global",
      "Shizzi — international platinum placements on US/UK projects",
      "DJ Maphorisa — Amapiano-to-house-to-Afrobeats crossover pipeline",
      "GuiltyBeatz — festival-ready production (Beyoncé Lion King: The Gift co-producer)",
      "Rexxie — street culture beats into mainstream streaming/radio",
      "Tempoe — Gen-Z viral production optimized for short-form chart dominance",
      "Kel-P — Afrobeats/R&B/pop cross-continental collabs with signature vibes",
      "Don Jazzy — catalog licensing to global labels, artist development focus",
      "Juls — Highlife-inspired Afrobeats bridging Ghana-UK festival circuits"
    ],
    "freshTokens": [
      "sparse kick + log-drum sidechain",
      "rimshot clave + off-beat hi-hat bounce",
      "warm vocal plate reverb 1-second decay",
      "minimal synth with surgical 200Hz EQ",
      "mid-tempo 105BPM atmospheric (not club loud)",
      "emotional bridge: 10-20s TikTok clip focal point",
      "log drum saturation + thermal warmth",
      "syncopated snare/rimshot layered percussion",
      "tight low-end notch filter 50-70Hz",
      "streamed-durable 3-minute song length"
    ],
    "bpmDriftNote": "Core 95-115 BPM range stable; Afropiano/Amapiano-leaning tracks push toward 112-122 BPM. Mid-tempo (105 BPM) now outperforms faster club variants on streaming (opposite of 2023-2024 trend toward 120+ accelerated kicks).",
    "confidence": "high",
    "sources": [
      "https://www.soundverse.ai/blog/article/afrobeat-electronic-music-700-growth-analysis-0002",
      "https://www.naijascene.com/2026/02/afrobeats-is-evolving-again-nigerian.html",
      "https://shore.africa/2025/08/23/10-african-music-producers-driving-afrobeats-and-global-music-trends/",
      "https://artistrack.com/fusing-amapiano-afrobeats-production-guide/",
      "https://blog.owodaily.com/how-afrobeats-artists-blow-up-on-tiktok/",
      "https://www.opus.pro/blog/tiktok-hooks-that-go-viral-2026"
    ],
    "researchedAt": "2026-07-05"
  },
  "afro_fusion": {
    "genre": "Afro-fusion",
    "trendingProductionMoves": [
      "Syncopated kick drum on 1, 2.5, 4 (off-grid from four-on-the-floor house)",
      "Log-drum bass: hybrid kick-808-synth blend with pitch glide, tuned to song root note",
      "16-step grid with swing 52-73% on shakers/percussion for humanization, zero rigidity",
      "Sidechain ducking: bass volume drops millisecond before kick hits, creates pocket/bounce",
      "Layered snare/rimshot, claves avoiding raw drums—wooden percussive texture",
      "Rhodes piano chords over log-drum, deep rolling bassline 118-126 BPM (Afro-house)",
      "Synthetic brass layered over Afrobeat percussion (Ghana production move)",
      "Modular synth textures over local folklore roots (Nigeria experimentalist trend)",
      "Sparse 2-bar intro, minimal production build, hook lands fast",
      "Velocity humanization: ghost notes on hi-hats, soft upbeats, accented downbeats"
    ],
    "currentSubgenres": [
      "Amapiano: 108-115 BPM, jazz piano runs, log-drum bass, sustained dance-marathon feel",
      "Afro-house: 118-126 BPM, deep rolling bass, organic vocals, live percussion, soulful vibe",
      "Afro-Dancehall: Afrobeats + R&B + Dancehall (Kel-P signature blend)",
      "AfroTronica: organic African drums + glitchy electronic/EDM, stripped-back/moody",
      "Afro-Latino: Yoruba + Spanish vocals, reggaeton-Afrobeats bridge",
      "Kuduro: 130-150 BPM, heavy electronic instrumentation, Angola-rooted",
      "UK Garage/Speed Garage: 130-140 BPM, syncopated percussion, 2-step rhythm, 625% growth 2025",
      "Lekompo & Bacardi House: South African township sound, export-ready (2026 emergence)",
      "Krio Fusion: Sierra Leone positioning, community-rooted yet engineered for wide circulation",
      "Afropiano (Naija-Amapiano): fusion of South African amapiano + Nigerian Afrobeats"
    ],
    "whatMakesItHitNow": [
      "Hook lands within 8 seconds: immediate melodic recognition + producer ID (Sarz, Pheelz, Kel-P identifiable in first bar)",
      "2-3 line hooks max (>4 lines = flat melody); most important lyric line first",
      "Viral video length sweet spot: 7-15 seconds for maximum TikTok/Reels virality, though 60-90 sec now gets algorithmic boost",
      "Loop moment mid-track (Amapiano dance challenge repeatable section)",
      "First 8 seconds: hook + bass pocket must lock instantly; zero intro bloat",
      "Multi-track retention over short-burst virality: songs with emotional durability outperform",
      "Energetic beat progression + smooth transitions (song structure clarity for dance remixes)",
      "Authentic cultural grounding (feels human, tradition-rooted) vs. over-produced",
      "Layered richness (orchestral texture illusion, live-performance-ready)",
      "Rhodes/jazz chords + percussive bounce (sets apart from generic EDM)"
    ],
    "currentReferenceLanes": [
      "Sarz: unpredictable melodies + crisp intricate percussion, defines modern Afrobeats fabric",
      "Pheelz: multi-instrumentalist (drums/piano/guitar), street-hop to Fuji-pop versatility, transcended to artist",
      "Kel-P: orchestral layering + Afro-Dancehall fusion, future-focused (productions years ahead)",
      "Burna Boy: Afrobeats + reggae + dancehall, stadium-scale production ambition",
      "Wizkid: melodic swagger + percussive bounce, global crossover standard-setter",
      "Asake: Afrobeats + Amapiano + Fuji-inspired, orchestral elements, rising global force",
      "Ayra Starr: pop-leaning Afrobeats, Gen-Z global appeal, fashion-forward sonic identity",
      "Caiiro: progressive house + South African percussion, Tomorrowland Afro-house stage headliner 2026",
      "Thakzin: articulates Afro-house/amapiano/Gqom connection across traditions",
      "Tyla: R&B + South African sounds blend"
    ],
    "freshTokens": [
      "off-grid syncopated kick + log-drum glide",
      "sidechain bounce with wooden rimshot texture",
      "sparse 2-bar intro, hook-first structure",
      "Rhodes over log-drum, 110-115 BPM amapiano",
      "organic percussion + synth brass layering",
      "ghost-note humanization, zero grid rigidity",
      "emotional durability > viral spike, multi-listen retention",
      "orchestral texture from digital composition",
      "Afro-Dancehall fusion: Afrobeats + R&B + Dancehall",
      "modular synth + folklore roots (experimental)"
    ],
    "bpmDriftNote": "",
    "confidence": "high",
    "sources": [
      "https://beatstorapon.com/blog/afrobeats-production-guide-rhythm-chords-mixing/",
      "https://www.soundverse.ai/blog/article/afrobeat-electronic-music-700-growth-analysis-0002",
      "https://artistrack.com/afrobeats-global-fusion-trends-2026/",
      "https://www.edmsauce.com/2026/03/27/rising-subgenres-exploding-in-2026-uk-garage-afro-house-melodic-techno-more/",
      "https://www.inspiredbybeatz.com/en/amapiano-production-how-the-log-drum-sound-is-created/",
      "https://buffer.com/resources/trending-songs-tiktok/"
    ],
    "researchedAt": "2026-07-05"
  },
  "amapiano": {
    "genre": "Amapiano",
    "trendingProductionMoves": [
      "Log drum as synth-bass hybrid (kick + 808 + plucked bass layered): tuned to track key with glide-based punch rather than volume",
      "Sparse four-on-the-floor kick + continuous sixteenth-note shaker loop (54-58% swing applied uniformly across drums & bass)",
      "Ghost notes and off-grid timing variations (barely audible offbeats) preventing rigid, programmed feel",
      "Deep, soft kick (not punchy); conga patterns hitting on 2, '&' of 2, '&' of 3-4 with velocity drops",
      "Sidechain compression carving space for log drum bass; low-pass filter transitions between sections",
      "Rhodes/electric piano with jazz 7th/9th/11th chords; synth pads sustaining hypnotic effect underneath",
      "3-step kick pattern (three kicks per bar departing from four-on-the-floor convention) as creative restlessness marker",
      "Bird whistles and foley elements (percussive texture) grabbing attention in intros/breaks",
      "Minor key progressions (A minor, G minor, C# minor) with simple 4-bar minor 7th/9th chord loops",
      "Vocal chops layered over instrumental groove; sidechain-ducked bassline on vocal hits"
    ],
    "currentSubgenres": [
      "Private School Amapiano (Soulful Amapiano): mellow log drums, shaker emphasis, progressive chord sequences; softer, jazz-rooted, lounge vibe rather than dancefloor-heavy",
      "3-Step Amapiano: three-kick-per-bar pattern departing from four-on-the-floor, signaling genre's creative restlessness",
      "Gqom 2.0: slowed-down gqom fused with amapiano, afrohouse, and afrotech elements",
      "Amapiano x UK Funky hybrid: 118-125 BPM blends, breakbeat rhythm blended with log drum",
      "Amapiano x Speed Garage: future garage atmospheric production with amapiano 2-step kicks",
      "Afro-House (overlapping): 778% download growth 2024-2025; piano-based but more percussive, faster variant"
    ],
    "whatMakesItHitNow": [
      "First 8 seconds: filtered intro revealing log drum glide + shaker loop (14-15 second hook window before chorus)",
      "Infectious vocal chop or catchiest rhythm accessible within 15 seconds; structure allows TikTok isolation of verse/chorus/bridge segments",
      "3-5 minute track length optimizing short-form capture: intro (30 sec–1 min), build-up (1–2 min), drop (2–3 min), breakdown, second drop with variations",
      "Dance-ready bounce from swing + ghost notes (not rigid grid timing); syncopated congas on offbeats",
      "Hypnotic loop moment (2–4 bar loop repeating with subtle evolution): shaker + log drum + pad + one melodic element",
      "Soulful minor-key chord progression (particularly 2-5-1 turnarounds, minor 7th chords) evoking emotional resonance",
      "Peak energy drop 2-2.5 minutes in with full layer stacking (kick + shakers + bass + piano + pad + vocal)",
      "TikTok dance-challenge alignment: structured breakdown sections allowing choreography insertion points"
    ],
    "currentReferenceLanes": [
      "Kabza De Small: foundational architect, 'human touch' piano insistence, label PianoHub defining the sound",
      "Kelvin Momo: private-school/soulful strain master, described as 'healing' and 'smooth,' most-streamed SA artist 2026",
      "Tyler ICU: rolling log-drum polish, festival-ready global anthems, precision production",
      "DJ Maphorisa: consistent collaborator, genre-spanning amapiano collaborations shaping 2026 landscape",
      "Tyla: mainstream crossover (Grammy winner 'Water'), translating log drums to Top 40, global introduction vector",
      "TxC (Tumelo & Cee): underground raw log-drum energy, quiet but most-streamed underground duo"
    ],
    "freshTokens": [
      "log-drum glide-punch (tuned to key, not volume-driven)",
      "shaker-locked 54-58% swing (both drums & bass)",
      "ghost-note offbeat micro-timing",
      "private-school minor 7th chord loops",
      "3-step kick (departure from four-on-the-floor)",
      "sidechain-ducked bass under vocal chop",
      "low-pass filter section transition",
      "conga-on-2 syncopation",
      "hypnotic 2-4 bar loop evolution",
      "108-115 BPM soulful groove"
    ],
    "bpmDriftNote": "108-115 BPM range stable as core, no drift; soulful variants trend lower (105-110 BPM), club/festival variants trend higher (112-115 BPM). Speed garage crossovers push 118-125 BPM but retain log-drum identity. 3-step patterns signal tempo flexibility rather than drift.",
    "confidence": "high",
    "sources": [
      "https://www.inspiredbybeatz.com/en/amapiano-production-how-the-log-drum-sound-is-created/",
      "https://articles.roland.com/production-hacks-creating-amapiano-tracks/",
      "https://create.routenote.com/blog/beatmakers-guide-how-to-make-an-amapiano-beat/",
      "https://www.edmsauce.com/2026/03/27/rising-subgenres-exploding-in-2026-uk-garage-afro-house-melodic-techno-more/",
      "https://www.wigwagafrica.com/posts/wigwag-best-amapiano-artists-2026---ranked",
      "https://www.vicknickvideopool.com/post/amapiano-in-2026-how-djs-are-running-the-dancefloor-with-piano-log-vibes"
    ],
    "researchedAt": "2026-07-05"
  },
  "afro_dancehall": {
    "genre": "Afro-Dancehall",
    "trendingProductionMoves": [
      "Log-drum amapiano bassline (deep, sliding between 808 and plucked bass) replacing traditional kicks",
      "Syncopated kick placement on beats 1, 2.5, 4 with snare/rimshot on 1.75, 3.5",
      "Surgical sidechain: fast-release compressor on log drum triggered by kick for clarity without loss",
      "EQ carving: narrow notch filter on log drum at 50-70Hz to prevent collision with kick",
      "Swing humanization (52% subtle, 64-73% pronounced shuffle) applied to shakers, hats, percussion",
      "Crowd choir effect: 8-16 vocal takes panned, formant-shifted, reverb-washed for stadium simulation",
      "Wooden rimshots and claves replacing snare drums for organic texture",
      "Layered log drum (sine wave + percussive transient) processed with thermal saturation + multi-stage distortion",
      "Hi-hat velocity alternation on 16-step grid maintaining hyper-active forward motion",
      "High-pass filters on melodic percussion at 200Hz to eliminate low-end mud",
      "Kick/bass conversation through selective muting and filtering rather than adding new instruments",
      "Talking drums + syncopated shakers blended with amapiano percussion"
    ],
    "currentSubgenres": [
      "Afropiano (Afrobeats + Amapiano fusion)",
      "Traphall (trap-heavy dancehall)",
      "Afro House (118-126 BPM, organic instrumentation)",
      "Afro-Rave (high-energy club)",
      "AfroTronica (organic drums + glitchy electronics)",
      "Afro-Latino (Spanish + Yoruba bilingual",
      "Afro-Swing (Dancehall variant, kicks on 1 and 2.75)"
    ],
    "whatMakesItHitNow": [
      "Hook in first 3 seconds to stop scroll (TikTok algorithm prioritizes 3-second retention)",
      "Repeatable 8-count dance loop embedded in beat structure",
      "Catchy, lip-syncable lyric or chant in opening 2-3 seconds",
      "Emotional peak or synth moment at 8-15 seconds for clip virality",
      "Song length 2:30-3:15 optimal for TikTok loop-backs and streaming retention",
      "Melodic simplicity with infectious rhythm (not chord complexity)",
      "Call-and-response or chant structure for community participation",
      "Dance-challenge choreography possibility built into beat pocket",
      "Short-form clip logic: unusual drums, emotional synths, or haunting vocals outperform chart-formula bangers",
      "Sparse 2-bar intro into immediate hook drop",
      "Minimalist verses (soft guitar, gentle synths) contrasting explosive chorus",
      "Steady long-tail momentum beats louder viral spike alone"
    ],
    "currentReferenceLanes": [
      "Wizkid (precision production, West African percussion bounce, global crossover appeal)",
      "Burna Boy (orchestral density within modern frameworks, album depth)",
      "Ayra Starr (versatile energy modulation, sultry-to-explosive dynamic range)",
      "Asake (massive choir arrangements, frantic orchestration)",
      "Tyla (Grammy-winning production clarity, South African Amapiano-Afrobeats fusion)",
      "Uncle Waffles (Afro House pioneer, organic instrumentation emphasis)",
      "Kabza De Small (log-drum mastery, rolling grooves, pan-African collaborations)",
      "Skippa (trap-heavy flow, wavy production, next-gen Kingston sound)",
      "Ayetian (Haitian influences + hardcore dancehall, lyrical heavyweight)",
      "Shenseea (dominant female voice, global collaborations)"
    ],
    "freshTokens": [
      "syncopated kick bounce 1-2.5-4",
      "log drum glide bass with sidechain duck",
      "wooden rimshot organic texture",
      "crowd choir 8-16 vocal layers",
      "3-second hook stop-scroll first seconds",
      "8-count dance loop pocket",
      "sparse 2-bar intro drop",
      "thermal saturation log warmth",
      "swing 64-73% pronounced shuffle",
      "high-pass 200Hz melodic clean"
    ],
    "bpmDriftNote": "Afro-Dancehall maintaining classic 98-105 BPM range; Afro House at 118-126 BPM; Amapiano at 108-116 BPM. No significant acceleration trend vs. traditional rangeas seen in hard house/techno. Experimental tracks using 80-120 BPM range depending on subgenre intent (romantic vs. street energy).",
    "confidence": "high",
    "sources": [
      "https://notjustok.com/article/best-afrobeats-songs-2025/",
      "https://www.caribbeanemagazine.com/single-post/dancehall-artistes-to-watch-in-2026",
      "https://www.edmsauce.com/2026/03/27/rising-subgenres-exploding-in-2026-uk-garage-afro-house-melodic-techno-more/",
      "https://blog.owodaily.com/how-afrobeats-artists-blow-up-on-tiktok/",
      "https://beatstorapon.com/blog/afrobeats-production-guide-rhythm-chords-mixing/",
      "https://artistrack.com/fusing-amapiano-afrobeats-production-guide/"
    ],
    "researchedAt": "2026-07-05"
  },
  "afro_pop": {
    "genre": "Afropop",
    "trendingProductionMoves": [
      "Sparse hi-hat & shaker loops with off-grid timing + punch percussive bounce",
      "Log-drum bass (hybrid kick/808/synth blend tuned to track key, 50-70Hz notch for kick clarity)",
      "Sidechain-compressed sine-wave basslines rolling under log drum",
      "Minimal 2-4 element drum kits: tuned kick, snare, open hat on offbeat, continuous shaker",
      "Vocal-choir doubles at 3:1-5:1 ratio (thin vs. R&B thick), subtle hard-tuning 0.2-0.5s plate reverb (30-70ms pre-delay)",
      "Ad-lib layers with dotted-eighth delay tied to groove",
      "Short intro (2-4 bars) → hook entrance (8-16 bars max) for algorithm engagement",
      "Chant-outro / call-response vocal on final hook (dance-challenge bait)",
      "Glide/pitch-bend on 808 bass paired with static kick for movement",
      "Stereo shaker panning 70L/70R + center hi-hat for pocket depth"
    ],
    "currentSubgenres": [
      "Amapiano (108-115 BPM, log-drum deep-house fusion, jazz piano stabs)",
      "Afro House (118-126 BPM, tribal percussion + deep house, rolling basslines)",
      "Afro-Drill (bouncy skippy flows, melodic hooks over trap beats)",
      "Afro-Trap (trap snare rolls + Afro percussion, 90-110 BPM)",
      "Superfuji (traditional Fuji vocals + modern club energy, street-inspired)"
    ],
    "whatMakesItHitNow": [
      "Catchy vocal hook (2-5 seconds) lands within first 8 bars — exact hook placement critical for TikTok algorithm",
      "Loop-friendly structure: hook repeats seamlessly 3+ times for user clip exports",
      "Soft, warm vocal tone (3-5 kHz presence boost, 0.7-1.2s reverb decay) vs. robotic tuning",
      "Off-grid shaker swing + human-feel percussion (velocity variations, ghost notes)",
      "Song length 2:30-3:10 (optimized for streaming algorithmic rotation + short-form clip extraction)",
      "Intro-less or 4-bar intro max: straight to hook for streaming skip-resistance",
      "Chant outro (4-8 bars) with ad-lib layering encourages dance choreography/remixing on TikTok",
      "Bassline movement (gliding log drum) + static kick = tension-release groove",
      "Sparse arrangement allowing vocal breathing room (fewer than 6 layers in mix)",
      "Hybrid sub-bass (log drum 30-80Hz + filtered bass 80-150Hz) for phone speaker + club translation"
    ],
    "currentReferenceLanes": [
      "Burna Boy — reggae-dancehall-Afrobeats fusion, warm vocal tone, layered production",
      "Rema — melodic Afrobeats polish, subtle pitch correction, sparse arrangement clarity",
      "Asake — street-energy Fuji-Afrobeats blend, rhythmic vocal bounce, punchy drums",
      "Wizkid — smooth Caribbean-Afropop vibe, vocal placement intimacy, minimalist groove",
      "Tems — expressive warm vocals, plate reverb signature, tight restraint on ad-libs",
      "Ayra Starr — pop-leaning Afrobeats, accessible melodic hooks, Gen-Z global appeal",
      "Black Coffee (Afro House style lane) — deep soulful pads, rolling basslines, organic percussion",
      "Caiiro — progressive Afro House, tribal rhythms, melodic piano stabs",
      "Dlala Thukzin — amapiano innovation, 3-step experimentation, boundary-pushing arrangements"
    ],
    "freshTokens": [
      "log-drum glide + offbeat hat swing",
      "plate reverb vocal + dotted-delay ad-lib",
      "tribal shaker pocket 70L/70R stereo",
      "tuned kick + sidechain bass roll",
      "chant outro call-response hook loop",
      "sparse 2-4 drum kit + warm top-end",
      "short intro 2-4 bars into hook landing",
      "hybrid low-end (808 + piano bass synth)",
      "human-tight pitch correction 0.2-0.5s",
      "bouncy snare + ghost-note percussion layer"
    ],
    "bpmDriftNote": "",
    "confidence": "high",
    "sources": [
      "https://nigeriamag.com/the-new-wave-of-afrobeats-producers-taking-over-2025/",
      "https://www.edmsauce.com/2026/03/27/rising-subgenres-exploding-in-2026-uk-garage-afro-house-melodic-techno-more/",
      "https://artistrack.com/fusing-amapiano-afrobeats-production-guide/",
      "https://www.inspiredbybeatz.com/en/amapiano-production-how-the-log-drum-sound-is-created/",
      "https://www.beatportal.com/articles/647491-step-by-step-guide-to-creating-an-afro-house-track-keinemusik-black-coffee-caiiro-alex-wann-style",
      "https://www.okayafrica.com/the-best-amapiano-songs-of-2026-so-far/1433886"
    ],
    "researchedAt": "2026-07-05"
  },
  "afro_rnb": {
    "genre": "Afro-R&B / Alté",
    "trendingProductionMoves": [
      "Log-drum hybrid bassline (kick + 808 + synth-bass layered, pitch-glided to key, 108-126 BPM)",
      "Polyrhythmic drum programming with off-grid placement and ghost notes (congas, djembes, talking drums)",
      "Sidechain compression for kick-bass separation without extreme ducking",
      "Warm evolving pads with slow attack/LFO modulation + percussive plucked synths",
      "3-step kick patterns (3 kicks per measure vs. 4-on-floor) in amapiano variations",
      "Vocal chops and indigenous slang layered as rhythmic/melodic elements",
      "Field recordings and ambient textures blended with electronic production",
      "UK garage-influenced offset bass vs. kick creating perpetual forward momentum (130-140 BPM hybrid)",
      "Jazz-influenced piano runs and melodic improvisation over afrobeats/amapiano frameworks"
    ],
    "currentSubgenres": [
      "Afro House (118-126 BPM, organic live percussion + melodic piano)",
      "Amapiano (108-116 BPM, log-drum foundation + jazz piano chords)",
      "Afropiano / Naija-Amapiano (fusion of amapiano + afrobeats)",
      "UK Garage x Afro-Soul (130-140 BPM, deep rolling basslines + soulful vocal chops)",
      "Alté (alternative nigerian R&B/pop, indigenous lyricism + bounce-heavy rhythms)",
      "3-Step Amapiano (three-kick-per-bar breakaway variation)",
      "Neo-soul + Afro-influences (jazz elements, folk textures, contemporary R&B sensibility)"
    ],
    "whatMakesItHitNow": [
      "Catchy, repeatable hook within first 8-15 seconds (iconic phrase or 'bam-bam-bam' percussive cue)",
      "Distinctive vocal delivery or ad-lib that begs emoji/text-overlay responses",
      "5-7 second clip virality window on TikTok with clear choreography cue or pose moment",
      "Song length flexibility: full-track depth + short 15-30 second hook extract that loops naturally",
      "Bouncy, hypnotic rhythmic elements (log drum pulse, syncopated percussion, off-grid snares) that make movement feel effortless",
      "Emotional storytelling with vulnerability (vulnerability > grandeur on indie alté tracks)",
      "Familiar percussive 'instant recognition' moment within 3 seconds for algorithm pickup"
    ],
    "currentReferenceLanes": [
      "Asake (afrobeats mainstream fusion)",
      "Shaba (Johannesburg sultry R&B + neo-soul)",
      "Yugoszn (self-produced emotional R&B blends)",
      "Odeal (afrobeats + R&B contemporary map)",
      "Lekan (rhythm-first afro-influenced vocals)",
      "Deela (alté dreamy nostalgia + bounce)",
      "Mavo (alté indigenous slang + eccentric lyricism)",
      "Sèwà (afrobeat + soul + jazz + folk fusion)",
      "TØDI OJ (introspective afropop + emotion)",
      "Una Rams (soul + jazz + afro alternative r&b)"
    ],
    "freshTokens": [
      "log-drum glide-bass, 108-116 BPM hypnotic pulse",
      "off-grid ghost notes, polyrhythmic congas over tight kick",
      "warm pads + plucked synth layers, organic field textures",
      "vocal chops as rhythmic anchor, indigenous slang ad-libs",
      "3-step kick break variation, jazz piano melodic fills",
      "sidechain groove without ducking, perpetual forward momentum",
      "first-8-second hook cue, vulnerability-led alternative r&b",
      "amapiano x afrobeats fusion, 5-7 second clip format"
    ],
    "bpmDriftNote": "Afro-R&B/Alté spans 108-140 BPM: amapiano (108-116), afro house (118-126), UK garage fusions (130-140). No universal drift; subgenres maintain distinct tempo identities. Log-drum grooves stay mid-tempo (108-126) for sustained dance marathons; UK garage hybrids push higher for club peak-time energy.",
    "confidence": "high",
    "sources": [
      "https://www.samplesoundmusic.com/blogs/news/the-ultimate-guide-to-afro-house-production-in-2025-tips-tricks-and-techniques",
      "https://blog.landr.com/music-trends/",
      "https://www.edmsauce.com/2026/03/27/rising-subgenres-exploding-in-2026-uk-garage-afro-house-melodic-techno-more/",
      "https://www.soundverse.ai/blog/article/afrobeat-electronic-music-700-growth-analysis-0002",
      "https://afrocritik.com/10-rising-african-alte-artistes-to-watch-in-2025/",
      "https://www.inspiredbybeatz.com/en/amapiano-production-how-the-log-drum-sound-is-created/"
    ],
    "researchedAt": "2026-07-05"
  },
  "gospel": {
    "genre": "Afro-gospel / Contemporary Gospel",
    "trendingProductionMoves": [
      "Log drum as foundation (hybrid kick-808-synth-bass, tuned to track root key, glide/slide between notes)",
      "Continuous sixteenth-note shaker loops for hypnotic forward momentum",
      "Four-on-the-floor kick pattern at 110-115 BPM (Amapiano sweet spot)",
      "Jazz harmonic extensions (7th, 9th, 11th chords) over Afropop rhythms",
      "Rhodes/electric piano layered with trap 808s and Afro percussion",
      "Sparse, intentional arrangement in first 4 bars; reserve dense production for hook payoff",
      "Conga/clave rhythms following traditional patterns on offbeats",
      "Trap snares (tight, high-ratio compression) mixed with live hand-clapped percussion"
    ],
    "currentSubgenres": [
      "Amapiano Gospel (108-115 BPM, log-drum synth-bass hybrid, shaker loops)",
      "Afrobeats Gospel (Afrobeat rhythms + gospel lyrics, R&B/pop fusion)",
      "Gospel Hip-Hop/Trap (trap snares, 808s, rap verses over worship messaging)",
      "Highlife Gospel (traditional Highlife progressions, jazz 7th chords, soul influences)",
      "Contemporary Worship/Trap-Worship (minimal percussive loops, atmospheric pads, emotional intensity)"
    ],
    "whatMakesItHitNow": [
      "Killer hook in first 0.5-2 seconds (63% of high-CTR videos hook within 3 seconds; 1.7 second average mobile decision point)",
      "Catchiest 15-30 second segment uploaded as loopable original sound",
      "Hypnotic, repetitive phrase anchoring chorus for dance/challenge loops",
      "Production value of hook matters more than what follows (audio-first algorithm)",
      "30-60 second worship refrain for instant resonance and clip reuse",
      "Call-and-response vocal structure (traditional gospel + modern production)",
      "Song completion rate threshold now 70% (up from 50% in 2024); Q2 2026 update prioritizes 3-second retention over total watch time",
      "Upbeat tempo (110-115 BPM), never slow/solemn ballad pacing",
      "Female vocal lead with ad-libs/harmonies (production shift toward women in 2025-2026)"
    ],
    "currentReferenceLanes": [
      "Limoblaze (Afrobeats-gospel fusion, Tidal Rising Artist to Watch, MOBO award winner; moves away from hymn-based toward faith-themed R&B/pop)",
      "Greatman Takit (Afrobeat rhythms + bold gospel messaging, youth-culture focus, identity/confidence themes)",
      "Bidemi Olaoba (Highlife + Fuji + Tungba fusion, live band arrangements, street-smart vocals)",
      "Victor Thompson (African rhythms crossing continents, crossover appeal)",
      "Gaise Baba (The Culture Architect—unapologetic gospel, Yoruba language/proverbs, Afrofusion blending)",
      "Moses Bliss (pop-leaning production, mainstream commercial edge)",
      "Anendlessocean (angelic vocals, introspective writing, soulful spiritual depth)"
    ],
    "freshTokens": [
      "Log-drum synth glide at 112 BPM, shaker-saturated momentum",
      "Afrobeats x faith messaging, youth cultural bridge",
      "Jazz 7th + clave percussion, hypnotic loop texture",
      "Sparse 4-bar intro → hook explosion at 0:06-0:15",
      "Trap snare crispness layered with hand claps, 808 low-end anchor",
      "Call-and-response female + male vocal weave",
      "Rhodes piano over synth 808, contemporary worship soul",
      "Amapiano log-drum gospel, digitized but tuned to key"
    ],
    "bpmDriftNote": "Amapiano gospel holds tight to 108-115 BPM (sweet spot 112-115); Afrobeats gospel adapts to 96-120 range. Traditional gospel ballads still exist but are not going viral—contemporary lane requires energetic, forward-moving tempos. No drift observed; tempo constraints are stable in 2025-2026.",
    "confidence": "high",
    "sources": [
      "https://www.inspiredbybeatz.com/en/amapiano-production-how-the-log-drum-sound-is-created/",
      "https://articles.roland.com/production-hacks-creating-amapiano-tracks/",
      "https://www.conbersa.ai/learn/best-tiktok-hooks",
      "https://buffer.com/resources/trending-songs-tiktok/",
      "https://www.darkroomagency.com/observatory/how-tiktok%E2%80%99s-algorithm-works-in-2026-and-15-tactics-to-go-viral",
      "https://www.hfpmusiccity.com/post/christian-music-industry-trends-to-watch-out-for-in-2026"
    ],
    "researchedAt": "2026-07-05"
  },
  "highlife": {
    "genre": "Highlife (Ghana/Nigeria)",
    "trendingProductionMoves": [
      "Layered synths with spacey digital-brass overlays over guitar foundations",
      "Crisp hi-hats with triplet rolls and trap-influenced skip patterns",
      "Deep-bass architecture: clean sine sub + gritty mid-bass (filtered lows to prevent mud)",
      "Sidechain compression on kick to punch through dense synth layers",
      "Snap snares on beats 2/4, often stacked for texture and character",
      "Synth pads + string-like textures replacing traditional horn sections",
      "Afrobeat percussion layered with electronic drum synthesis (hybrid acoustic-digital)",
      "Jazz-influenced chord progressions blended with Amapiano deep-house drums"
    ],
    "currentSubgenres": [
      "Banku: Ghanaian highlife bounce + Nigerian chord progressions + reggae/R&B/hip-hop",
      "Amapiano-Highlife fusion: deep-house drums + jazz piano + traditional guitar + spacey synths",
      "AfroTronica: Afrobeat percussion + electronic sound design for club/global markets",
      "NeoBeat: synth-forward evolution of Afrobeats with minimal organic instrumentation",
      "Afro-Adura: spirituality-focused lyrics over modern electronic-hybrid production"
    ],
    "whatMakesItHitNow": [
      "First 2-5 seconds establish identity: bold vocal claim or striking recognition (TikTok viral law)",
      "Hook recurrence every 30-45 seconds (streaming algorithm optimization for replay)",
      "High-frequency single drops over deep conceptual exploration (quantity over depth for visibility)",
      "Introspective, emotionally confessional vocal delivery (per AratheJay/Rcee model)",
      "Cross-cultural collaborative appeal: Western artists co-opting Highlife producers as status",
      "Tempo sweet spot 95-115 BPM (deep-house adjacent, club-ready, rhythmically lean)",
      "Loop-moments at 8-bar intervals with synth-drop or bass-dive to trigger engagement",
      "Song length 2:45-3:15 optimal for playlist rotation and TikTok clip repurposing"
    ],
    "currentReferenceLanes": [
      "Kofi Kinaata: traditional Highlife purity with TGMA recognition; OTWoode production model",
      "Rcee: Gen-Z Highlife modernism (Afrobeats-blend debut 'How Did We Get Here')",
      "AratheJay: introspective Afrobeats-Highlife storytelling (album 'The Odyssey')",
      "Andre Vibez: pan-African producer (Afropop/trap/R&B/Highlife synthesis; Ayra Starr/Rema co-pilot)",
      "Fameye: collaborative Highlife across subgenres (TGMA Best Artiste 2026)",
      "Mr. Eazi: Banku pioneer (study for Highlife-Afrobeats-reggae-hip-hop blend logic)"
    ],
    "freshTokens": [
      "Synth-layered Highlife with triplet hi-hat rolls",
      "Deep-house bass + tribal percussion hybrid",
      "Spacey digital-brass over finger-picked guitar",
      "Banku bounce: Afrobeats chords on Highlife swing",
      "Amapiano-Highlife: jazz-piano with modern drums",
      "Sub-bass + mid-bass grit with sidechain punch",
      "Crisp-snare-layered backbeat pocket",
      "Trap-hi-hats over West-African percussion"
    ],
    "bpmDriftNote": "Classic Highlife 110-140 BPM; modern production drifting toward 95-115 BPM (deep-house/Amapiano range). Club-oriented variants retain 115-125 BPM sweet spot. Slower tempos increasing market share as algorithmic playlists favor sustained moods over dancefloor energy.",
    "confidence": "medium",
    "sources": [
      "https://www.pulse.com.gh/story/10-ghanaian-artists-set-to-dominate-the-music-scene-in-2026-2026012016570259246",
      "https://guardian.ng/saturday-magazine/weekend-beats/afrobeats-amapiano-genres-making-africa-sing/",
      "https://www.soundverse.ai/blog/article/afrobeat-electronic-music-700-growth-analysis-0002",
      "https://ynaija.com/the-definitive-guide-to-afrobeats-in-2026/",
      "https://www.masterclass.com/articles/highlife-music-guide",
      "https://www.okayafrica.com/discover-rcee-is-a-ghanaian-artist-rethinking-highlife-and-pop/1430096"
    ],
    "researchedAt": "2026-07-05"
  },
  "hip_hop": {
    "genre": "Hip-hop / Afro-drill",
    "trendingProductionMoves": [
      "Log drum as bass foundation (110-115 BPM amapiano pocket) with sidechain compression ducks allowing kick transient cut-through",
      "Sparse, minor-key melodic architecture (D minor, A minor, G minor) using cold pianos, eerie synth pads, reverb-heavy strings with long reverb tails",
      "Afro percussion integration: West African rhythms (Azonto bounce) layered over UK drill half-time hi-hat stutters (triplet patterns at 140-145 BPM)",
      "808 pitch-slides with distortion creating dark tension; EQ'd to remove muddiness, paired with sharp but not-piercing hi-hat sequences",
      "Off-beat snares on third beat of measure, skippy hi-hat syncopation with varied velocities creating restless, syncopated motion",
      "Hook-first songwriting: compelling moment in first 0-3 seconds for short-form clips, strong hooks locked within 15-30 seconds"
    ],
    "currentSubgenres": [
      "Afro-drill (Ghanaian Asakaa movement expanding pan-Africa and diaspora): UK/Chicago drill 808 slides + booming sub-bass with African groove, minor-key melodies in Twi/Yoruba/Pidgin flows",
      "Amapiano-Afrobeats fusion (Nepopiano luxury variant): log-drum bass at 110-115 BPM sidechain-ducked, melodic movement in sub frequencies via layered sine-wave sub + percussive transient",
      "Afro-Latino (Afrobeats × Reggaeton): Wizkid/Rauw Alejandro cross-language trading verses, club-ready in Lagos or beach-party ready in Puerto Rico",
      "AfroTronica: organic African drums meeting glitchy EDM textures, high-octane electronic frameworks with tribal rhythmic roots",
      "Fuji-Afrobeats (Asake signature): massive choirs + frantic violins over Afrobeats bounce, melodic richness within drill-adjacent production"
    ],
    "whatMakesItHitNow": [
      "0-3 second hook window: immediate vocal or melodic hook moment designed for TikTok/Reels clip virality; songs that lose here lose the algorithm entirely",
      "First 10 seconds determines playlist continuation: compelling beat drop, loop moment, or dance-friendly rhythm in opening seconds determines full-track engagement",
      "Song length 29 seconds shorter than 2018 average: focus on strong, repeatable 15-30 second hook with minimal intro padding",
      "Syncopated rhythm lock: off-beat snares + skippy hi-hats create hypnotic, TikTok-friendly loop moments that invite choreography or lip-sync repetition",
      "Log-drum soulful bounce at mid-tempo: mid-tempo sway (110 BPM amapiano pocket) feels 'alive' and human, bridges danceability with atmospheric grounding",
      "Call-and-response hooks in local languages (Yoruba, Twi, Pidgin): regional authenticity + street narrative framing increases TikTok regional penetration and global recognition"
    ],
    "currentReferenceLanes": [
      "Asake (Fuji-infused Afrobeats with massive production scale, vocal layering, rhythmic complexity)",
      "Ayra Starr (high-fashion polish, soulful bounce, luxury lifestyle aesthetic merged with accessible pop)",
      "BNXN (melodic vocals bridging Afrobeats and Afro-fusion, strong production partnership with Sarz)",
      "ODUMODUBLVCK (raw hip-hop grit with Afrobeats bounce, heavy Nigerian street language and unapologetic delivery)",
      "Sarz (producer lane: polished Afrobeats production, amapiano-fusion orchestration, global crossover mixing)",
      "Ivorian Doll, Bobby Tootact (Afro-drill vanguard: establishing regional language and flow authenticity within drill structures)"
    ],
    "freshTokens": [
      "Log-drum sidechain ducks with tight hi-hat stutter",
      "Cold piano minor-key over gliding 808 pitch-slide",
      "Sparse reverb-tail synth pad in D minor",
      "Off-beat snare on measure three with Azonto bounce",
      "Hook-first 0-3 second viral window design",
      "Amapiano 110-115 BPM pocket with Afrobeats melody",
      "Hypnotic log-drum melodic sub-bass movement",
      "Regional Yoruba/Twi call-and-response hook frame",
      "30-second strong-hook loop for TikTok repetition",
      "Sidechain notch-filter kick separation at 50-70Hz"
    ],
    "bpmDriftNote": "Afro-drill classic: 130-150 BPM. 2026 drift toward dual-tempo production: drill stems at 140-145 BPM layered under amapiano-fusion log drums at 110-115 BPM (sidechain-controlled). TikTok preference skews toward mid-tempo 110 BPM for 'soulful bounce' over frenetic energy, though hi-hat stuttering still triggers viral engagement at the classic 140+ range.",
    "confidence": "high",
    "sources": [
      "https://blog.beatpass.ca/hip-hop-production-trends-2026/",
      "https://www.soundverse.ai/blog/article/how-to-make-drill-beats-0205",
      "https://artistrack.com/afrobeats-global-fusion-trends-2026/",
      "https://artistrack.com/fusing-amapiano-afrobeats-production-guide/",
      "https://substreammagazine.com/2026/02/how-social-media-short-videos-are-changing-music-discovery/",
      "https://www.soundverse.ai/blog/article/afrobeat-electronic-music-700-growth-analysis-0002"
    ],
    "researchedAt": "2026-07-05"
  },
  "reggae": {
    "genre": "Reggae / Roots",
    "trendingProductionMoves": [
      "One-drop drum foundation (missing downbeat, kick lands on beat 3 of each 4) + steady-pocket steppers variation with 8th-note kick pattern",
      "Sparse, minimal drum fills—restraint over density; space between elements as primary groove driver",
      "Off-beat guitar skank on 2 & 4 upstrokes (muted, percussive, top 3-4 strings for clarity without bass bleed)",
      "Bass: selective note placement behind the pulse, strategic downbeat rests; 60-100 Hz warmth boost + 500 Hz mid cut to avoid masking guitar",
      "Dancehall fusion: bouncy high-tempo drum with crisp, low-slung synths + infectious bassline (Hill & Gully Riddim model)",
      "Dub textures: tape delay, reverb throws, echo effects to create spatial depth and drop elements in/out",
      "Live brass + tight band arrangements (Chronixx 2026 model); reconnection to live instrumentation vs. pure digital",
      "Conscious lyricism + introspective production: jazz influences, soul chords, minimal EDM-style filler",
      "AI riddim production emerging but still niche—Jammify 2025 offers tempo/key-matched digital riddim templates"
    ],
    "currentSubgenres": [
      "Roots Reggae: conscious, Rastafarian lyricism, one-drop grooves, 70-80 BPM anchor; spiritual/message-driven",
      "Dancehall: 80-105 BPM, DJ/toaster-focused, streetwise energy, high-energy party rotation, TikTok-viral loop moments",
      "Lovers Rock: 75-95 BPM, romantic British-Jamaican lane, warm chords, smooth vocal swing, soulful intimacy",
      "Reggae Fusion: hip-hop + R&B + Afrobeats blends, trap textures, global cross-genre mashups",
      "Dub: 65-75 BPM, atmospheric studio-craft, King Tubby/Lee Perry legacy, echo/reverb-driven spacing",
      "Conscious Reggae Revival: Chronixx/Protoje/Koffee-led wave; blends hip-hop flow + jazz textures + roots messaging; 2025-2026 cultural reset"
    ],
    "whatMakesItHitNow": [
      "First 2-3 seconds hook placement—audio signal weight critical on TikTok cold-audience distribution, visual motion + text backup",
      "Singalong melodic accessibility wrapped in conscious/uplifting messaging (not preachy, relatable daily life themes)",
      "Versatile riddim canvas: same instrumental base carries multiple artist voices + toasts without fatigue",
      "Layered vocal textures: ad-libs + harmony doubles + one consistent lead voice + call-response dynamic",
      "TikTok loop moment: 30-45 second hook-chorus portion repeatable, dancefloor-ready or intimate-vibes-friendly",
      "Song length: 3-minute format standard (fits TikTok Sounds library + radio trim), extended versions for streaming",
      "Gender-forward lineup shift: Shenseea, Lila Iké, Jada Kingdom, Stalk Ashley breaking male-dominated space + bringing softer-edge production",
      "Emotional authenticity: grief/resilience/faith/loyalty themes over generic party flex; personal + communal simultaneously"
    ],
    "currentReferenceLanes": [
      "Chronixx: old-school vibes + modern twist, energetic brass-backed live feel, conscious roots fusion",
      "Protoje: hip-hop flow + reggae heritage, genre-blending production (jazz, soul, rock layers), introspective lyricism",
      "Koffee: smooth voice + positive lyrics, accessible reggae-pop crossover, TikTok-native virality (Toast model)",
      "Shenseea: dancehall-reggae duality, confident delivery, soft production on lovers-rock tracks, gender-forward lane leader",
      "Lila Iké: conscious, soulful, jazz-reggae textures, vulnerable songwriting, global streaming appeal",
      "Conkarah: playlist-friendly reggae-pop blend, bright welcoming energy, lover's rock + soul fusion"
    ],
    "freshTokens": [
      "Tight brass section + sparse kick (one-drop pocket)",
      "Conscious flip—faith-rooted or street-diary lyricism",
      "Dancehall-reggae fusion, 85-95 BPM bounce",
      "Lovers rock smooth vocal + minimal chords",
      "Dub tape-delay spatial throwback",
      "Multi-artist riddim canvas (same beat, different voices)",
      "Afrobeats-reggae diaspora crossover",
      "Minimal production (space = groove)"
    ],
    "bpmDriftNote": "Classic reggae 60-90 BPM range holding firm for roots; dancehall pushing 80-105 BPM; lovers rock 75-95 BPM stable. No drift observed 2025-2026—genre boundaries staying defined, fusion subgenres creating the cross-tempo energy, not drift within core lanes.",
    "confidence": "medium",
    "sources": [
      "https://www.reggaehour.com/2026/05/roots-revival-how-reggae-reclaimed-its.html",
      "https://reggaetownmusic.com/reggae-music-industry-trends-driving-growth-in-2026/",
      "https://www.drumloopai.com/blog/drum-reggae-beat/",
      "https://www.grammy.com/news/10-modern-reggae-artists-to-know-lila-ike-iotosh-mortimer-videos/",
      "https://www.much.com/danceall-reggae-fusion-trend-taking-over-the-music-scene/",
      "https://bpmcalc.com/genres/reggae/"
    ],
    "researchedAt": "2026-07-05"
  },
  "street_pop": {
    "genre": "Street-pop / Zanku / Nigerian street",
    "trendingProductionMoves": [
      "Log-drum hybrid bass (50Hz-70Hz notch + surgical sidechain on kick for clarity)",
      "Amapiano-Fuji fusion with fast-release sidechain ducking for layered low-end",
      "Continuous shaker/hi-hat sixteenth-note loops (rolling groove from bar 1)",
      "Layered talk-drum + synthesized percussion over log drums",
      "High-pass filter at 200Hz on melodic percussion to eliminate mud",
      "Sparse 2-3 bar intro leading into hypnotic repetitive loop",
      "Narrow notch filtering on log drum where kick lands (surgical EQ)",
      "Polyphonic rapid drumming patterns (Fuji-inflected rhythmic complexity)",
      "Transient preservation on sampled beats (DAW warp + snap retention)"
    ],
    "currentSubgenres": [
      "Afropiano (Afrobeats + Amapiano hybrid)",
      "Fujipiano (Fuji + Amapiano fusion)",
      "Afro-Fuji Fusion (Fuji storytelling + contemporary electronic production)",
      "Afro-Adura (Afro-Trenches: street-conscious lyrics + uplifting spiritual messaging)",
      "Street-Hop (Hip-hop grit + Afrobeats bounce + Nigerian street vernacular)",
      "Cruise Beats (electronic-heavy, frenetic production, sparse lyrics, dance-oriented)",
      "Mara Beats (emerging underground sound pushing street culture forward)"
    ],
    "whatMakesItHitNow": [
      "Hook in first 15-30 seconds (critical threshold for algorithm boost)",
      "Repeatable 10-15 second clip format (dance challenge / meme template compatibility)",
      "Emotional specificity paired with on-screen context (golden-hour aesthetic, dramatic reveals)",
      "Simple, accessible choreography or lip-sync (anyone can join in on TikTok)",
      "3-3.5 minute total song length (streaming-era compression)",
      "8-bar hooks with 12-16 bar verses (balance for algorithmic play)",
      "Hypnotic loop moments (4-8 bar motif repetition for short-form capture)",
      "Culturally specific street vernacular + humor (Yoruba inflection, relatable hustle narrative)",
      "Catchy one-liner / repeatable chorus phrase for 0-8 second clip extraction"
    ],
    "currentReferenceLanes": [
      "Asake: Amapiano + Fuji cadence + hip-hop swagger with street-wrought poetry",
      "Shallipopi: Lo-Fi textures + club-ready energy + Benin dialect integration",
      "Seyi Vibez: Fuji-inspired interludes + street energy + trap influence",
      "Balloranking: Street-pop traditionalist, gritty authenticity",
      "ODUMODUBLVCK: Hip-hop grit + Afrobeats bounce + heavy Nigerian street influence",
      "Islambo: Hypnotic Afrofusion + catchy hustle-oriented puns + street sensibility",
      "Zaylevelten: Street energy + trap influence + experimental sound direction"
    ],
    "freshTokens": [
      "Log-drum + hi-hat sixteenth roll, hypnotic 108-115 BPM pocket",
      "Surgical EQ: kick + log-drum notch at 50-70Hz, shaker loop propulsion",
      "Fuji polyphonic drums over amapiano synths, transient-preserved snap",
      "Street-Fuji fusion: talk-drum layering, Yoruba-inflected cadence",
      "Hook-first architecture: 15-30s viral clip, 8-bar loop extraction",
      "Sparse intro → hypnotic 2-bar log-drum motif → street-vernacular verse",
      "Afrofusion with hi-pass 200Hz melodic synths, duck-compressed bass",
      "Street-pop Zanku: amapiano log + Fuji rhythm call-response structure",
      "TikTok-native 10-15s repeatable chorus, meme-template choreography ready",
      "Gritty street authenticity + contemporary electronic production blend"
    ],
    "bpmDriftNote": "Amapiano-fusion pocket has tightened to 108-115 BPM (down from earlier 120+ street-pop variants). Trap/Cruise elements push toward 140-150 BPM range but remain niche; mainstream street-pop favors slower, hypnotic pocket. No significant drift from established 110 BPM Amapiano standard — stability vs genre maturity.",
    "confidence": "medium",
    "sources": [
      "https://afrocritik.com/10-artistes-expanding-the-soundscape-of-street-pop-in-nigeria-today/",
      "https://www.urbangist.com.ng/the-ultimate-guide-to-nigerian-music-in-2026/",
      "https://artistrack.com/fusing-amapiano-afrobeats-production-guide/",
      "https://www.vicknickvideopool.com/post/amapiano-in-2026-how-djs-are-running-the-dancefloor-with-piano-log-vibes",
      "https://beatstorapon.com/charts/subgenre/afrobeats",
      "https://medium.com/@abiola.oderinde.hunter/the-afro-fuji-fusion-the-future-of-nigerian-music-6491fc3c5734"
    ],
    "researchedAt": "2026-07-05"
  }
};

/** Enrichment for a genre (undefined if none researched yet). */
export function getEnrichment(genre?: string | null): GenreEnrichment | undefined {
  if (!genre) return undefined;
  return GENRE_ENRICHMENT[genre];
}

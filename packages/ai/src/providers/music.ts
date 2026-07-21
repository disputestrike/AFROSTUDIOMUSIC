/**
 * Music generation adapter. Selects backend from env MUSIC_PROVIDER.
 *
 * Wired engines:
 *  - minimax / ace_step / replicate via Replicate
 *  - Eleven Music v2 via its synchronous compose endpoint
 *  - Suno-compatible gateway for first-party releases only
 * Unknown, removed, or unconfigured providers fail closed.
 *
 * Every adapter must implement MusicProviderAdapter and return a stable
 * ProviderJobResult so the worker can poll or finalize uniformly.
 */
import type {
  MusicGenerationInput,
  MusicGenerationOutput,
  MusicProviderAdapter,
  ProviderJobResult,
} from './types';
import {
  parseMusicAdapterRouteTable,
  resolveMusicAdapterRoute,
  type MusicAdapterResolution,
  type RouteLane,
} from '../music-license';
import { getGenreKit } from '@afrohit/shared';
import { detectAfricanLanguage, annotateLyricsForSinging } from '../african-g2p';

function provider(): string {
  return (process.env.MUSIC_PROVIDER ?? 'unavailable').toLowerCase();
}

/**
 * PER-GENRE SWING / MICRO-TIMING TOKEN (African-singing wave item 3).
 *
 * recipes.ts describes each lane's groove.swing as free text ("~55-62% swing",
 * "light-to-moderate"); a text-to-music model can't read that, so it defaults to
 * a stiff Western 4/4. This turns the prose into a MEASURED, front-loadable
 * pocket token per genre so the engine is pulled onto the correct African feel:
 * amapiano's triplet log-drum bounce, afrobeats' swung-16th shakers, highlife's
 * straight-but-lilting push, gospel's back-heavy pocket. Returns null for lanes
 * where a swing directive would be wrong (straight-grid gqom keeps its own note)
 * or unknown/non-African genres — those are left untouched, matching the
 * afroIdentity philosophy. Ratios are the measured centres of each lane's range.
 */
const SWING_POCKET: Record<string, string> = {
  amapiano: 'groove: ~60% triplet swing, log-drum bounces just BEHIND the grid — never stiff four-on-the-floor',
  afropiano: 'groove: ~60% triplet swing, log-drum bounces just BEHIND the grid — never stiff four-on-the-floor',
  afrobeats: 'groove: swung 16th-note shakers ~56%, laid-back offbeat kick pocket, lead sits a hair behind the beat — NOT rigid 4/4',
  afro_fusion: 'groove: swung 16th shakers ~56%, syncopated kick leaves holes, loose in-the-pocket bounce — NOT stiff 4/4',
  afro_pop: 'groove: lightly swung 16th shakers ~55%, offbeat kick pocket — radio-clean but never metronomic 4/4',
  street_pop: 'groove: hard-swung street 16ths ~57%, rowdy offbeat Zanku pocket — not a stiff grid',
  afro_hip_hop: 'groove: swung 16th shaker ~56% with a log-drum bounce, syncopated Afro kick and snare on beat 3, a rap flow riding the pocket — NOT a stiff US boom-bap grid, NOT four-on-the-floor',
  afro_dancehall: 'groove: swung dancehall bounce ~56%, offbeat skank on the "and", bass behind the grid',
  afro_rnb: 'groove: swung 16th shakers ~55%, relaxed behind-the-beat R&B pocket — not quantized',
  afro_soul: 'groove: live-feel back-swung pocket ~56%, the drummer leans late — organic, not gridded',
  highlife: 'groove: straight-but-lilting highlife push (~52% gentle swing), interlocking guitars breathe — flowing, not four-square',
  afro_gospel: 'groove: back-heavy gospel pocket, snare/clap lean LATE, shekere 16ths swung ~55%',
  gospel: 'groove: back-heavy gospel pocket, snare/clap lean LATE behind the grid — not a stiff straight groove',
  praise: 'groove: joyful back-heavy praise pocket, handclaps and shekere swung ~55%, danceable — not stiff',
  worship: 'groove: gentle back-leaning worship feel, unhurried rhythm section just behind the beat',
  bongo_flava: 'groove: swung coastal 16ths ~55%, conga-and-shaker pocket — East African bounce, not rigid 4/4',
  afro_house: 'groove: four-on-the-floor afro-house drive with rolling swung congas ~54%, hypnotic — not mechanical',
  kwaito: 'groove: slowed township four-on-the-floor, offbeat open-hat, relaxed swagger just off the grid',
  gqom: 'groove: straight broken-grid gqom pulse, hard offbeat kick placement — syncopated but no swing lilt',
};

/** Front-loadable swing/pocket token for a genre, or null to leave it untouched. */
export function swingPocketToken(genre: string | undefined): string | null {
  const key = (genre ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return SWING_POCKET[key] ?? null;
}

/**
 * Build the style/prompt token list for a music model.
 *
 * Sound-DNA signature tokens (input.dnaTags) are FRONT-LOADED — models weight
 * by position and truncate, so the genre's identity must lead. The generic
 * "radio-ready" fallback literal is only appended when NO DNA is present; when
 * DNA is present that filler is exactly the homogenizing phrase we drop. This is
 * the core fix for "same-y sound".
 */
/**
 * Per-genre Afro identity — the correct origin + signature for each Afro lane, so
 * the audio engine is anchored to THIS genre, not a blanket "Afrobeats".
 *
 * MATCH ON EXACT GENRE KEYS, never loose substrings: the old regexes
 * (/dancehall/, /rnb|r&b|soul/) also fired for the GLOBAL genres 'dancehall',
 * 'rnb' and 'soul' — forcing pure Jamaican dancehall and American R&B/Soul into
 * an Afro lane. That is the inverse of the amapiano bug. Returns null for every
 * non-African genre so it is left completely untouched. African-American
 * gospel, Jamaican reggae and US hip-hop are intentionally global here; their
 * African counterparts have explicit lanes such as afro_gospel and praise.
 */
function afroIdentity(genre: string): { anchor: string; signature: string } | null {
  switch (genre.toLowerCase()) {
    case 'amapiano':
    case 'afropiano':
      return {
        anchor: 'South African amapiano',
        signature: 'signature sound: deep booming log-drum sub-bass, jazzy sustained piano and soulful Rhodes, airy shakers, percussive vocal chops; spacious swung groove — NOT four-on-the-floor house, NOT Nigerian Afrobeats',
      };
    case 'afro_house':
      return {
        anchor: 'South African afro house',
        signature: 'signature sound: FOUR-ON-THE-FLOOR deep-house kick, rolling congas, shakers and shekere, marimba or kalimba motifs, hypnotic synth stabs, warm bass and African chant vocals — NOT a log-drum-led amapiano bounce',
      };
    case 'afro_dancehall': // NOT global 'dancehall'
      return {
        anchor: 'Afro-dancehall',
        signature: 'signature sound: Jamaican dancehall riddim bounce under African percussion, deep rolling bass, synth plucks and horn stabs',
      };
    case 'afro_rnb': // NOT global 'rnb'
      return {
        anchor: 'West African Afro-R&B',
        signature: 'signature sound: lush Rhodes and warm pads, soft syncopated kick, swung 16th-note shaker and hand percussion, smooth bass and intimate layered R&B vocals — airy and chord-rich, NOT log-drum-led',
      };
    case 'afro_soul': // NOT global 'soul'
      return {
        anchor: 'Pan-African Afro-soul',
        signature: 'signature sound: warm Rhodes, organic live backbeat drums, congas and shakers, fingered live bass, guitar chords and rich harmony vocals — emotive live-band soul with African percussion, NOT trap or house',
      };
    case 'highlife':
      return {
        anchor: 'Highlife (Ghana / Nigeria)',
        signature: 'signature sound: interlocking clean highlife guitars, live bass, congas and lilting percussion, warm horn/brass section, live-band feel — NOT a log drum, NOT amapiano',
      };
    case 'afro_gospel':
      return {
        anchor: 'West African Afro-gospel',
        signature: 'signature sound: rich gospel piano and Hammond organ, full choir and call-response vocals, talking drum, shekere and highlife guitar over a Nigerian or Ghanaian praise groove — NOT US-only 12/8 gospel',
      };
    case 'afro_fusion':
      return {
        anchor: 'West African Afro-fusion',
        signature: 'signature sound: syncopated Afrobeats percussion with talking drum and shekere, melodic live bass, highlife guitar, organic brass and a deliberate blend of reggae, dancehall, R&B or soul — broader and more live than pop Afrobeats',
      };
    case 'afro_pop':
      return {
        anchor: 'West African Afropop',
        signature: 'signature sound: polished melody-first song structure, syncopated Afrobeats kick, shekere and shaker 16ths, offbeat open hat, bright highlife guitar, synth pluck and chant adlibs — radio-pop clarity without a log-drum-led groove',
      };
    case 'street_pop':
      return {
        anchor: 'Lagos Nigerian street-pop',
        signature: 'signature sound: rowdy syncopated street-hop drums, log-drum bounce used as street flavor, swung shaker 16ths, gang chants, rough pidgin rap-singing and call-response adlibs — energetic Zanku street pocket, NOT lounge amapiano or US trap',
      };
    case 'afro_hip_hop': // Naija rap / Afro-rap — NOT American 'hip_hop'
      return {
        anchor: 'Afro/Naija hip-hop (Naija rap)',
        signature: 'signature sound: log-drum bounce and swung shaker 16ths under a syncopated Afro kick with the snare on beat 3, bright clean highlife guitar hook, warm gliding 808 bass, and code-switched Pidgin/Yoruba/Igbo/English sing-rap with call-response adlibs — Afrobeats-percussion rap, NOT American boom-bap/trap and NOT plain afropop',
      };
    case 'afrobeats':
      return {
        anchor: 'West African Afrobeats (Nigerian/Ghanaian)',
        signature: 'signature sound: syncopated Afro kick and snare, shekere or shaker 16ths, talking drum and congas, melodic bass, interlocking highlife guitar and warm keys, vocal chants and adlibs — laid-back offbeat kick, NOT four-on-the-floor, NOT amapiano log-drum-led',
      };
    case 'alte':
      return {
        anchor: 'Nigerian alté',
        signature: 'signature sound: dreamy lo-fi Afro-fusion with Rhodes, hazy guitar chords, live bass, vinyl texture and intimate layered alt-R&B vocals — Lagos alternative mood, restrained percussion, NOT a commercial Afrobeats banger',
      };
    case 'gqom':
      return {
        anchor: 'Durban South African gqom',
        signature: 'signature sound: dark minimal straight-grid percussion, booming distorted BROKEN kick placement, rolling tribal toms, sparse sub-bass, sirens and Zulu chant energy — NOT four-on-the-floor house, NOT swung amapiano, NO log-drum melody',
      };
    case 'kwaito':
      return {
        anchor: 'Soweto South African kwaito',
        signature: 'signature sound: slowed 1990s township-house FOUR-ON-THE-FLOOR groove, deep looping synth or organ bass, offbeat open hat, sparse chords and tsotsitaal spoken crowd chants — relaxed swagger, NO amapiano log drum',
      };
    case 'bongo_flava':
      return {
        anchor: 'Tanzanian Bongo Flava',
        signature: 'signature sound: vocal-forward Swahili Afropop, melodic sung lead, swung shaker and conga pocket, bright synth pluck or marimba, coastal strings and warm bass — East African pop, NOT log-drum-led amapiano',
      };
    case 'azonto':
      return {
        anchor: 'Accra Ghanaian azonto',
        signature: 'signature sound: bouncy kpanlogo-derived cowbell, agogo and conga syncopation, plucky synth bass, clipped electronic drums and playful call-response dance chants — Ghanaian hiplife pocket, NOT Nigerian Afrobeats or South African house',
      };
    case 'coupe_decale':
      return {
        anchor: 'Ivorian coupé-décalé',
        signature: 'signature sound: fast relentless syncopated dance percussion, bright looping sebene guitar, cowbell and shaker drive, cascading tom rolls, beat stops and Nouchi animateur hype chants — NOT metronomic house',
      };
    case 'ndombolo':
      return {
        anchor: 'Congolese ndombolo',
        signature: 'signature sound: fast sebene climax with multiple interlocking clean electric guitars, busy live fingered bass, rolling snare and cowbell pulse, atalaku dance calls and crowd chants — the guitars drive the groove, NEVER 808 or house',
      };
    case 'soukous':
      return {
        anchor: 'Congolese soukous',
        signature: 'signature sound: bright fast sebene lead guitar, interlocking clean electric guitar lines, cavacha rolling-snare groove, melodic live bass and call-response vocals — dense circular guitar-band motion, NEVER synthetic 808 low end',
      };
    case 'fuji':
      return {
        anchor: 'Yoruba Nigerian fuji',
        signature: 'signature sound: percussion-and-voice ensemble led by talking drum, sakara frame drum, shekere and agogo, dense accelerating polyrhythm, praise-singing and call-response — NO guitar-led harmony, NO electronic bass, NO drum-kit backbeat',
      };
    case 'juju':
      return {
        anchor: 'Yoruba Nigerian juju',
        signature: 'signature sound: interlocking palm-wine electric guitars, talking drum lead, Hawaiian pedal steel, shekere and agogo with oríkì praise call-response — warm extended live-band owambe groove, NOT all-percussion fuji',
      };
    case 'apala':
      return {
        anchor: 'Yoruba Nigerian apala',
        signature: 'signature sound: talking-drum-led vocal music with agidigbo thumb-piano bass, shekere and agogo, speech-rhythm praise and group response — hand and stick percussion only, NO drum kit, guitars, chordal keys or electronic bass',
      };
    case 'worship':
      return {
        anchor: 'Contemporary African gospel worship',
        signature: 'signature sound: reverent slow build from flowing piano and warm pads into Hammond organ swells, live drums, choir and congregational call-response — spacious prayerful dynamics, NOT a club groove',
      };
    case 'praise':
      return {
        anchor: 'Nigerian and Ghanaian church praise',
        signature: 'signature sound: fast joyful live praise groove with gospel-organ stabs, shekere 16ths, congas, handclaps, talking-drum fills and exuberant choir call-response — danceable church energy, NOT amapiano or trap',
      };
    case 'spiritual':
      return {
        anchor: 'Meditative African spiritual music',
        signature: 'signature sound: hypnotic kalimba or mbira cycle, earthy udu clay-pot pulse, soft hand percussion, deep warm drone, humming and ancestral call-response chants — breathing healing space, NOT pop, trap or club music',
      };
    default:
      return null; // every non-Afro genre — untouched
  }
}

/**
 * ANTI-AFRO-LEAK (rapfix) — the mirror of the deLatin scrub. Afro Sound-DNA
 * carries signature-instrument tokens (log drum, talking drum, shekere,
 * shaku-shaku, highlife guitar, agogo, gbedu…). A single such token bleeding
 * into a NON-Afro lane's engine prompt was enough to turn "Hip-hop / Rap" into
 * Naija sing-rap (the #1 product bug). For any lane afroIdentity() does NOT
 * recognise, a DNA tag that carries an afro-signature token is dropped before it
 * reaches the engine, so a mislabeled token can never contaminate a rap / pop /
 * rock / country render. Data-driven — extend the list to cover new afro
 * instruments. NEVER runs for a real Afro lane: those NEED these tokens.
 */
const AFRO_SIGNATURE_TOKENS = [
  'log drum', 'log_drum', 'logdrum', 'log-drum',
  'talking drum', 'talking-drum', 'talking_drum', 'dundun', 'gangan', 'gan gan', 'gan-gan',
  'shekere', 'shaku-shaku', 'shaku shaku', 'shakushaku',
  'highlife',
  'agogo', 'gbedu', 'sakara', 'bata', 'agidigbo', 'ogene', 'ekwe', 'igba', 'kpanlogo', 'fontomfrom',
  'kalimba', 'mbira', 'balafon', 'kora', 'ngoni', 'udu', 'djembe',
  'palm-wine', 'palmwine',
];
/** Drop a DNA tag entirely when it carries an afro-signature token (non-Afro
 *  lanes only). Returns '' so the caller's filter(Boolean) removes it. */
function stripAfroSignatureTag(tag: string): string {
  const low = tag.toLowerCase();
  return AFRO_SIGNATURE_TOKENS.some((tok) => low.includes(tok)) ? '' : tag;
}

export function composeStyleTags(
  input: MusicGenerationInput,
  opts: { fallbackLiteral: string; genreLabel?: string; genreSuffix?: string; keyPrefix?: string; tonePrefix?: string }
): string[] {
  const hasDna = !!input.dnaTags?.length;
  // Humanize the genre enum so the model reads "afro dancehall", not "afro_dancehall".
  const genreLabel = opts.genreLabel ?? (input.genre ?? 'afrobeats').replace(/_/g, ' ');
  // VERBATIM FORGE MODE (SOUNDWAVE1 fix 1): the isolated-loop forge writes its
  // own prompt ("solo shaker groove … shaker only, no other instruments") and
  // it must reach the engine INTACT. The full-band pipeline below truncated it
  // to 160 chars and buried it behind the genre anchor + signature + engineTags
  // inside a 700-char budget — on Afro lanes the forge text was dropped
  // ENTIRELY, so every "isolated loop" rendered as a full mix. In verbatim mode
  // the prompt is a minimal identity prefix (genre, bpm, key when present) plus
  // the caller's vibePrompt IN FULL: no anchor, no signature, no engineTags, no
  // dnaTags, no fallbackLiteral, no slice, no budget — so isolation clauses,
  // the key, and variant directions ("variation B — a DIFFERENT pattern")
  // survive to the engine.
  if (input.promptMode === 'verbatim') {
    const prefix = `${genreLabel}, ${input.bpm} bpm${input.keySignature ? `, ${opts.keyPrefix ?? 'key '}${input.keySignature}` : ''}`;
    const verbatim = (input.vibePrompt ?? '').trim();
    return verbatim ? [prefix, verbatim] : [prefix];
  }
  // ONE membership test: a genre is Afro iff afroIdentity recognises it. This
  // keeps the anchor, the anti-Latin scrub and the exclusion perfectly in sync —
  // the old separate isAfro regex disagreed with afroIdentity, so a genre could
  // get an Afro anchor without the scrub (or vice-versa).
  const afro = afroIdentity(input.genre ?? '');
  const isAfro = afro != null;
  // ANTI-REGGAETON SCRUB: the Sound DNA describes the Afrobeats groove with
  // musicology terms that OVERLAP with Latin — "clave", "woodblock/clave",
  // "tresillo". Correct on paper, but a text-to-music model with a weak
  // Afrobeats prior reads "clave + syncopated off-beat + mid-tempo" and renders
  // REGGAETON. Strip those Latin-signifier tokens from what reaches the audio
  // engine (the LLM brief keeps the nuance; the engine gets African terms that
  // do not mislabel Southern, Eastern or Central African lanes as West African).
  const deLatin = (t: string): string =>
    isAfro
      ? t.replace(/\bwoodblock\s*\/\s*clave\b/gi, 'shekere')
         .replace(/\b(3-2|2-3)[\s-]*clave\b/gi, 'syncopated African off-beat')
         .replace(/\bclave\b/gi, 'off-beat')
         .replace(/\btresillo\b/gi, 'off-beat')
      : t;
  // ANTI-AFRO-LEAK SCRUB (rapfix): the mirror of deLatin. For lanes afroIdentity()
  // does NOT recognise (rap/pop/rock/…), drop any DNA tag carrying an afro-
  // signature token (log/talking drum, shekere, shaku-shaku, highlife, agogo…) so
  // a single mislabeled token can never contaminate the render. No-op for real
  // Afro lanes — they need these tokens.
  const deAfro = (t: string): string => (isAfro ? t : stripAfroSignatureTag(t));
  // ANTI-SOUP: models weight early tokens and truncate late ones, so this order
  // is a BUDGET, not a bag — identity leads (genre+tempo+key), then the DNA +
  // learned tokens, then a CAPPED vibe (an uncapped vibePrompt used to drown the
  // identity), then tone. Near-duplicate tokens are deduped.
  const vibe = deLatin((input.vibePrompt ?? '').trim().slice(0, 160));
  // For Afro genres, LEAD with the CORRECT per-genre identity anchor + signature
  // instruments, both BEFORE the DNA tokens so truncation can't drop them. This
  // used to blanket-label EVERY Afro genre "Nigerian/Ghanaian Afrobeats" — which
  // is WRONG for amapiano (South African), afro-dancehall (Jamaican-rooted) and
  // afro-R&B. Each lane now gets its own origin + kit; the anchor instruments
  // (log drum / piano / dancehall bounce) also pull hard away from reggaeton.
  const genreLine = afro
    ? `${afro.anchor} — ${genreLabel}, ${input.bpm} bpm${input.keySignature ? `, ${opts.keyPrefix ?? 'key '}${input.keySignature}` : ''}`
    : `${genreLabel}, ${input.bpm} bpm${input.keySignature ? `, ${opts.keyPrefix ?? 'key '}${input.keySignature}` : ''}`;
  // Producer-panel engineTags for THIS exact genre — accurate, front-loaded
  // tokens (e.g. amapiano: "log drum", "jazzy piano"; afrobeats: "shekere 16ths",
  // "talking drum"). These are the genre's real fingerprint; they lead so the
  // engine renders the correct lane instead of leaning on generic DNA tokens.
  const kit = getGenreKit(input.genre);
  // FUSION (audit PARTIAL: fusionGenres never reached the audio). The primary
  // owns groove/tempo; each fusion genre injects its identity anchor + a few
  // signature engine tags so "amapiano × afrobeats" actually blends in the render.
  const fusionTokens = (input.fusionGenres ?? [])
    .filter((g) => g && g !== input.genre)
    .slice(0, 2)
    .flatMap((g) => {
      const fi = afroIdentity(g);
      const fk = getGenreKit(g);
      return [
        `fused with ${fi?.anchor ?? g.replace(/_/g, ' ')}`,
        ...(fk ? fk.engineTags.slice(0, 3).map(deLatin) : []),
      ];
    });
  // EXPLICIT INSTRUMENT PICKS (owner directive): when the artist named the
  // instruments, they lead — right after the identity anchor, BEFORE the kit
  // tags, so truncation can never drop them. Steering, not a guarantee (text
  // engines are black boxes); the own engine honors picks exactly.
  const instrumentation = input.instruments?.length
    ? `instrumentation: ${input.instruments.slice(0, 8).map((i) => deLatin(i.trim())).filter(Boolean).join(', ')} — feature these instruments prominently`
    : null;
  // SWING / MICRO-TIMING (item 3): front-load the measured per-genre pocket token
  // so the engine is pulled off a stiff Western 4/4 onto the correct African feel.
  const swingToken = swingPocketToken(input.genre);
  // MELODY TONE-CONTOUR (item 2): the composed-score projection the worker threads
  // for vocal renders — a relative rise/level/fall directive, style prompt only.
  const melodyContour = (input.melodyContour ?? '').trim() || null;
  // AFRICAN TONE-PRESERVING G2P (item 1): when the lyrics are in a tonal/African
  // language, append the tone/stress directive to the STYLE tags — NEVER to the
  // lyric field (VERBATIM LAW). Detection is diacritic/wordlist based; absent
  // lyrics or a non-African language add nothing.
  const g2pLang = input.lyrics ? detectAfricanLanguage(input.lyrics) : null;
  const toneNotes = g2pLang ? annotateLyricsForSinging(input.lyrics!, g2pLang).toneNotes : null;
  // ORDER = truncation BUDGET (models weight early, drop late): identity + the
  // measured pocket lead, then the artist's explicit picks (kept at index <= 2 so
  // the instrumentation test's truncation-proof guarantee holds), then the two
  // SINGER directives (contour + tone), THEN the genre signature prose. On a
  // heavily-annotated vocal render the long signature may fall off the 700-char
  // budget — acceptable: genreLine's anchor + kit.engineTags still carry the
  // lane, and holding lexical TONE matters more than the prose for a sung take.
  const raw = [
    genreLine,
    swingToken,
    instrumentation,
    melodyContour,
    toneNotes,
    afro ? afro.signature : null,
    ...fusionTokens,
    // Every African lane rejects the specific reggaeton failure mode. Avoid a
    // blanket "NOT Latin" direction: Congolese rumba/soukous has a real historical
    // dialogue with Cuban music, while still being categorically not reggaeton.
    isAfro ? 'NOT reggaeton, NOT dembow, NOT tresillo/dembow kick, NOT perreo' : null,
    ...(kit ? kit.engineTags.slice(0, 8).map(deLatin) : []),
    opts.genreSuffix ?? null,
    ...(input.dnaTags ?? []).map(deLatin).map(deAfro),
    vibe || null,
    input.artistTone?.length ? `${opts.tonePrefix ?? ''}${input.artistTone.join(', ')}` : null,
    // Keep transitions genre-authentic. A blanket tom-fill instruction is wrong
    // for apala (no drum kit), spiritual music and several guitar-led traditions.
    isAfro && kit ? `${genreLabel} transition fills at section changes, preserving its defining groove and instrumentation` : null,
    hasDna ? null : opts.fallbackLiteral,
  ].filter(Boolean) as string[];
  // Case-insensitive dedupe on token prefixes — kills "energetic"×3 repeats.
  const seen = new Set<string>();
  const out: string[] = [];
  let budget = 0;
  for (const t of raw) {
    const k = t.toLowerCase().slice(0, 24);
    if (seen.has(k)) continue;
    seen.add(k);
    if (budget + t.length + 2 > 700) break; // identity budget before adapter caps
    out.push(t);
    budget += t.length + 2;
  }
  return out;
}

/** Accept common env-var spellings so a naming mismatch can't silently break it. */
export function elevenKey(): string | undefined {
  return (
    process.env.ELEVEN_API_KEY ||
    process.env.ELEVENLABS_API_KEY ||
    process.env.ELEVEN_LABS_API_KEY ||
    process.env.XI_API_KEY ||
    undefined
  );
}

export function replicateToken(): string | undefined {
  return process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_TOKEN || undefined;
}

export function sunoKey(): string | undefined {
  return process.env.SUNO_API_KEY || process.env.SUNOAPI_KEY || undefined;
}

interface SunoGenResp {
  code: number;
  msg?: string;
  data?: { taskId?: string };
}
interface SunoRecordResp {
  code: number;
  msg?: string;
  data?: {
    status?: string;
    errorMessage?: string | null;
    response?: {
      sunoData?: Array<{
        id: string;
        audioUrl?: string;
        streamAudioUrl?: string;
        duration?: number;
        title?: string;
      }>;
    };
  };
}

/** Suno-compatible gateway adapter for approved first-party release routes. */
class SunoAdapter implements MusicProviderAdapter {
  readonly name = 'suno';
  private base = (process.env.SUNO_API_BASE ?? 'https://api.sunoapi.org').replace(/\/+$/, '');
  constructor(private apiKey?: string) {}

  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const key = this.apiKey || sunoKey();
    if (!key) return { status: 'failed', error: 'SUNO_API_KEY missing' };
    const callbackUrl = process.env.SUNO_CALLBACK_URL;
    if (!callbackUrl || !/^https:\/\//i.test(callbackUrl)) {
      return { status: 'failed', error: 'SUNO_CALLBACK_URL must be a public HTTPS callback' };
    }
    // `withVocals` is authoritative. Instrumental rerenders often still carry the
    // song's lyrics as metadata; inferring from that field would make them sing.
    const cleanedLyrics = input.lyrics ? cleanLyricsForMinimax(input.lyrics, 3_000) : '';
    const wantsVocals = !!input.withVocals;
    if (wantsVocals && !cleanedLyrics) {
      return { status: 'failed', error: 'vocal generation requires singable lyrics' };
    }
    const vocalDirection = [...(input.dnaTags ?? []), ...(input.artistTone ?? [])].join(' ');
    const ensembleVocal = /duet|group|choir/i.test(vocalDirection);
    const vocalGender = /\bfemale\b/i.test(vocalDirection) && !ensembleVocal
      ? 'f'
      : /\bmale\b/i.test(vocalDirection) && !ensembleVocal
        ? 'm'
        : undefined;
    const afro = afroIdentity(input.genre ?? '');
    const body = {
      customMode: true,
      instrumental: !wantsVocals,
      ...(wantsVocals ? { prompt: cleanedLyrics } : {}),
      model: process.env.SUNO_MODEL ?? 'V5_5',
      style: this.composeStyle(input).slice(0, 900),
      title: (input.vibePrompt?.slice(0, 60) || `${input.genre ?? 'Afro'} ${wantsVocals ? 'song' : 'beat'}`).slice(0, 80),
      callBackUrl: callbackUrl,
      ...(afro ? { negativeTags: 'reggaeton, dembow, Latin pop, perreo' } : {}),
      ...(vocalGender ? { vocalGender } : {}),
      styleWeight: 0.8,
      weirdnessConstraint: 0.35,
      audioWeight: 0.7,
    };
    const res = await fetch(`${this.base}/api/v1/generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { status: 'failed', error: `suno ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const data = (await res.json()) as SunoGenResp;
    if (data.code !== 200 || !data.data?.taskId) {
      return { status: 'failed', error: `suno: ${data.msg ?? 'no taskId'}` };
    }
    return { externalId: data.data.taskId, status: 'running', pollAfterMs: 12_000 };
  }

  async poll(externalId: string): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const key = this.apiKey || sunoKey();
    if (!key) return { status: 'failed', error: 'SUNO_API_KEY missing' };
    const res = await fetch(
      `${this.base}/api/v1/generate/record-info?taskId=${encodeURIComponent(externalId)}`,
      { headers: { authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return { status: 'failed', error: `suno poll ${res.status}` };
    const data = (await res.json()) as SunoRecordResp;
    const st = data.data?.status ?? '';
    const songs = (data.data?.response?.sunoData ?? []).filter((candidate) => !!candidate.audioUrl);
    const song = songs[0];
    if (st === 'SUCCESS' && song?.audioUrl) {
      return {
        externalId,
        status: 'succeeded',
        output: {
          mainAudioUrl: song.audioUrl,
          format: 'mp3',
          durationS: song.duration ?? 0,
          alternates: songs.slice(1).map((candidate) => ({
            mainAudioUrl: candidate.audioUrl!,
            format: 'mp3' as const,
            durationS: candidate.duration ?? 0,
          })),
        },
        estimatedCostUsd: 0.08,
      };
    }
    if (/FAILED|ERROR|SENSITIVE/.test(st)) {
      return { externalId, status: 'failed', error: data.data?.errorMessage ?? st };
    }
    return { externalId, status: 'running', pollAfterMs: 8_000 };
  }

  private composeStyle(input: MusicGenerationInput): string {
    // No hardcoded genre — honor the SELECTED genre + its Sound DNA. Lyric-aware
    // fallback: when Suno is SINGING, ask for a strong lead vocal, not "instrumental".
    const wantsVocals = !!input.lyrics?.trim();
    return composeStyleTags(input, {
      fallbackLiteral: wantsVocals
        ? 'catchy, modern, punchy drums, warm bass, melodic, strong emotive lead vocal, radio-ready'
        : 'catchy, modern, punchy drums, warm bass, melodic, instrumental, radio-ready, leave space for a lead vocal',
    }).join(', ');
  }
}

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[] | null;
  error?: string | null;
}

/**
 * FORGE MODEL-VERSION MEMO (songspeed perf). meta/musicgen's version id is the
 * SAME for every forge in a render, but each forge builds a FRESH adapter and
 * re-ran the /models lookup — up to 8 lookups (~0.2-0.5s each) on a fresh-lane
 * song's forge fan-out. Cache the RESOLVED version per model slug so N forges do
 * ONE lookup, not N. Fail-soft: ONLY a successful resolve caches, so a failed
 * lookup never poisons the cache (the next forge retries cleanly). Pinning
 * REPLICATE_MUSIC_VERSION skips the lookup ENTIRELY (operator errand) — this memo
 * only helps when the version is unset.
 */
const musicVersionCache = new Map<string, string>();

/** Test-only: reset the forge model-version memo between cases. */
export function __resetMusicVersionCache(): void {
  musicVersionCache.clear();
}

/** Resolve (and memoize) a Replicate model's latest version id. Never throws the
 *  cache into a bad state: a failed resolve returns an error and caches nothing. */
async function resolveMusicGenVersion(
  auth: { authorization: string },
  slug: string
): Promise<{ version?: string; error?: string }> {
  const cached = musicVersionCache.get(slug);
  if (cached) return { version: cached };
  const mres = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: auth });
  if (!mres.ok) {
    return { error: `replicate model lookup ${mres.status}: ${(await mres.text()).slice(0, 160)}` };
  }
  const mdata = (await mres.json()) as { latest_version?: { id?: string } };
  const version = mdata.latest_version?.id;
  if (!version) return { error: 'replicate: model has no version' };
  musicVersionCache.set(slug, version); // only successful resolves cache
  return { version };
}

/**
 * FORGE PREWARM (songspeed perf) — fire-and-forget at worker boot. Resolves +
 * caches the forge model version BEFORE the first real forge, so a fresh-lane
 * song's forge fan-out skips the per-forge /models lookup (already memoized
 * above). FREE and safe: a single metadata GET, never a paid prediction, and
 * fully fail-soft — any error is swallowed and the normal per-forge resolve still
 * runs. A no-op when REPLICATE_MUSIC_VERSION is pinned (nothing to look up) or no
 * Replicate token is reachable. The Replicate container's own scale-to-zero cold
 * start is infra latency the operator removes by pinning REPLICATE_MUSIC_VERSION.
 */
export async function prewarmForgeModel(): Promise<void> {
  try {
    if (process.env.REPLICATE_MUSIC_VERSION) return; // pinned: no lookup to warm
    const token = replicateToken();
    if (!token) return;
    const slug = process.env.REPLICATE_MUSIC_MODEL ?? 'meta/musicgen';
    await resolveMusicGenVersion({ authorization: `Bearer ${token}` }, slug);
  } catch {
    /* prewarm is best-effort — it must never block or fail worker boot */
  }
}

/**
 * Replicate MusicGen adapter for explicitly requested short instrumental loops.
 * Full-length songs and instrumentals use the MiniMax route on the same account.
 */
class ReplicateMusicGenAdapter implements MusicProviderAdapter {
  readonly name = 'replicate';
  constructor(private apiKey?: string) {}

  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const auth = { authorization: `Bearer ${token}` };

    // meta/musicgen is a community model → use the versioned /predictions
    // endpoint (the /models/{owner}/{name}/predictions path is official-only,
    // hence the 404). Resolve the current version unless one is pinned — the
    // resolve is MEMOIZED per slug (resolveMusicGenVersion), so a fresh-lane
    // song's 8-forge fan-out pays the lookup ONCE, not 8×.
    let version = process.env.REPLICATE_MUSIC_VERSION;
    if (!version) {
      const slug = process.env.REPLICATE_MUSIC_MODEL ?? 'meta/musicgen';
      const resolved = await resolveMusicGenVersion(auth, slug);
      if (resolved.error) return { status: 'failed', error: resolved.error };
      version = resolved.version;
    }

    const duration = Math.min(Math.max(Math.round(input.durationS ?? 30), 5), 30);
    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', prefer: 'wait' },
      body: JSON.stringify({
        version,
        input: {
          prompt: this.composePrompt(input),
          duration,
          model_version: 'stereo-large',
          output_format: 'mp3',
          normalization_strategy: 'loudness',
          temperature: 1,
          classifier_free_guidance: 3,
        },
      }),
    });
    if (!res.ok) {
      return { status: 'failed', error: `replicate ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    return this.toResult((await res.json()) as ReplicatePrediction, input);
  }

  async poll(externalId: string): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const res = await fetch(`https://api.replicate.com/v1/predictions/${externalId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { status: 'failed', error: `replicate poll ${res.status}` };
    return this.toResult((await res.json()) as ReplicatePrediction);
  }

  private toResult(
    data: ReplicatePrediction,
    input?: MusicGenerationInput
  ): ProviderJobResult<MusicGenerationOutput> {
    const url = Array.isArray(data.output) ? data.output[data.output.length - 1] : data.output;
    if (data.status === 'succeeded' && url) {
      return {
        externalId: data.id,
        status: 'succeeded',
        output: {
          mainAudioUrl: url,
          format: 'mp3',
          durationS: input?.durationS ?? 30,
          bpm: input?.bpm,
          keySignature: input?.keySignature,
        },
        estimatedCostUsd: 0.1,
      };
    }
    if (data.status === 'failed' || data.status === 'canceled') {
      return { externalId: data.id, status: 'failed', error: data.error ?? 'replicate failed' };
    }
    return { externalId: data.id, status: 'running', pollAfterMs: 5_000 };
  }

  private composePrompt(input: MusicGenerationInput): string {
    return composeStyleTags(input, {
      genreLabel: `${input.genre ?? 'afrobeats'} instrumental beat`,
      keyPrefix: 'in ',
      tonePrefix: 'mood: ',
      fallbackLiteral:
        'catchy, modern, radio-ready, punchy drums, warm bass, melodic, no vocals, leave space for a lead vocal',
    }).join(', ');
  }
}

interface ElevenCompositionChunk {
  text: string;
  duration_ms: number;
  positive_styles: string[];
  negative_styles: string[];
  context_adherence: 'high';
}

function elevenPolicySafeInput(input: MusicGenerationInput): MusicGenerationInput {
  const vibePrompt = input.vibePrompt
    ?.split(/\n|\.\s+/)
    .filter((part) => !/\b(?:in the vibe\/lane of|in the (?:style|vibe|lane) of|inspired by|sounds? like|similar to)\b/i.test(part))
    .join('. ')
    .trim();
  return { ...input, vibePrompt: vibePrompt || undefined };
}

function elevenPositiveStyle(style: string): string {
  return style
    .replace(/(?:^|\s+)(?:—\s*)?(?:NOT|NO|NEVER)\b.*$/i, '')
    .replace(/[\s,;:—-]+$/, '')
    .trim();
}

function lyricSections(raw: string, durationMs: number): Array<{ text: string; durationMs: number }> {
  const cleaned = cleanLyricsForMinimax(raw, 4_000);
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of cleaned.split('\n')) {
    if (/^\[[^\]]+\]$/.test(line.trim()) && current.length) {
      sections.push(current.join('\n').trim());
      current = [];
    }
    if (line.trim() || current.length) current.push(line);
  }
  if (current.length) sections.push(current.join('\n').trim());
  if (!sections.length) sections.push('[Song]\n' + cleaned);

  const targetMs = Math.min(600_000, Math.max(3_000, durationMs));
  const maxChunks = Math.min(30, Math.max(1, Math.floor(targetMs / 3_000)));
  while (sections.length > maxChunks) {
    const tail = sections.pop()!;
    sections[sections.length - 1] = `${sections[sections.length - 1]}\n${tail}`;
  }
  const requiredChunks = Math.ceil(targetMs / 120_000);
  while (sections.length < requiredChunks) sections.push('[Instrumental Break]');
  const base = Math.floor(targetMs / sections.length);
  let remainder = targetMs - base * sections.length;
  return sections.map((text) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { text, durationMs: Math.min(120_000, Math.max(3_000, base + extra)) };
  });
}

/** Build the documented Eleven Music v2 chunk plan. Exported for contract tests. */
export function elevenCompositionPlan(input: MusicGenerationInput): { chunks: ElevenCompositionChunk[] } {
  const safeInput = elevenPolicySafeInput(input);
  const baseStyles = composeStyleTags(safeInput, {
    fallbackLiteral: 'memorable melody, expressive lead vocal, polished commercial production',
  }).map(elevenPositiveStyle).filter(Boolean).slice(0, 14);
  const afro = afroIdentity(input.genre ?? '');
  const kit = getGenreKit(input.genre);
  const negative = [
    ...(afro ? ['reggaeton', 'dembow', 'perreo'] : []),
    ...(kit?.forbiddenTraits.slice(0, 8) ?? []),
    'muddy mix',
    'unintelligible lead vocal',
  ].slice(0, 12);
  const chunks = lyricSections(input.lyrics ?? '', Math.round(input.durationS * 1_000)).map(
    ({ text, durationMs }, index) => {
      const section = text.match(/^\[([^\]]+)\]/)?.[1]?.toLowerCase() ?? '';
      const performance = /chorus|hook|refrain/.test(section)
        ? ['memorable hook melody', 'layered backing vocals', 'full arrangement']
        : /bridge|break|interlude/.test(section)
          ? ['clear arrangement contrast', 'musical transition']
          : ['natural lead vocal phrasing', 'rhythmic pocket'];
      return {
        text,
        duration_ms: durationMs,
        positive_styles: [...(index === 0 ? baseStyles : baseStyles.slice(0, 8)), ...performance].slice(0, 50),
        negative_styles: negative,
        context_adherence: 'high' as const,
      };
    }
  );
  return { chunks };
}

class ElevenMusicAdapter implements MusicProviderAdapter {
  readonly name = 'eleven';
  constructor(private apiKey?: string) {}

  async generate(input: MusicGenerationInput): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const key = this.apiKey || elevenKey();
    if (!key) return { status: 'failed', error: 'ELEVEN_API_KEY missing' };
    const cleanedLyrics = input.lyrics ? cleanLyricsForMinimax(input.lyrics, 4_000) : '';
    const wantsVocals = !!input.withVocals;
    if (wantsVocals && !cleanedLyrics) {
      return { status: 'failed', error: 'vocal generation requires singable lyrics' };
    }
    const durationMs = Math.min(600_000, Math.max(3_000, Math.round(input.durationS * 1_000)));
    const body = wantsVocals
      ? {
          composition_plan: elevenCompositionPlan(input),
          model_id: process.env.ELEVEN_MUSIC_MODEL ?? 'music_v2',
          sign_with_c2pa: true,
        }
      : {
          prompt: this.composeInstrumentalPrompt(input).slice(0, 4_100),
          music_length_ms: durationMs,
          model_id: process.env.ELEVEN_MUSIC_MODEL ?? 'music_v2',
          force_instrumental: true,
          sign_with_c2pa: true,
        };
    const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_48000_192', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { status: 'failed', error: `eleven music ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const audioBytes = Buffer.from(await res.arrayBuffer());
    if (audioBytes.length < 1_024) {
      return { status: 'failed', error: 'eleven music returned an empty audio file' };
    }
    return {
      externalId: res.headers.get('song-id') ?? undefined,
      status: 'succeeded',
      output: {
        audioBytes,
        format: 'mp3',
        durationS: input.durationS,
        bpm: input.bpm,
        keySignature: input.keySignature,
      },
    };
  }

  private composeInstrumentalPrompt(input: MusicGenerationInput): string {
    return composeStyleTags(elevenPolicySafeInput(input), {
      genreLabel: `${input.genre ?? 'afrobeats'} instrumental`,
      fallbackLiteral: 'memorable melody, polished commercial production',
    }).concat('instrumental only, no vocals, no spoken words').join(', ');
  }
}

/**
 * ACE-Step (via Replicate) — FULL SONG WITH AI VOCALS from lyrics + style tags.
 * No reference audio needed; runs on the same Replicate key. This is what makes
 * the AI actually sing the song. Model slug pinnable via REPLICATE_SONG_MODEL.
 */
class AceStepSongAdapter implements MusicProviderAdapter {
  readonly name = 'ace_step';
  constructor(private apiKey?: string) {}

  async generate(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    // FAL ROUTE FIRST (owner 2026-07-19: "ALREADY HAVE FAL — CHECK"): fal.ai
    // serves the same open ACE-Step at ~$0.036/3-min song vs ~$0.10 on
    // Replicate, on the owner's EXISTING fal credits. Verified API (fal-ai/
    // ace-step): inputs {tags, lyrics, duration}, queue pattern, output
    // data.audio.url. Falls back to the Replicate route when FAL_KEY is unset.
    if (process.env.FAL_KEY) return this.generateViaFal(input);
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const auth = { authorization: `Bearer ${token}` };

    let version = process.env.REPLICATE_SONG_VERSION;
    if (!version) {
      const slug = process.env.REPLICATE_SONG_MODEL ?? 'lucataco/ace-step';
      const mres = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: auth });
      if (!mres.ok) {
        return { status: 'failed', error: `replicate song model lookup ${mres.status}: ${(await mres.text()).slice(0, 160)}` };
      }
      const mdata = (await mres.json()) as { latest_version?: { id?: string } };
      version = mdata.latest_version?.id;
      if (!version) return { status: 'failed', error: 'replicate: song model has no version' };
    }

    const duration = Math.min(Math.max(Math.round(input.durationS ?? 120), 30), 240);
    // No hardcoded genre — honor the SELECTED genre + its Sound DNA.
    const tags = composeStyleTags(input, {
      fallbackLiteral: 'catchy, melodic vocals, punchy drums, warm bass, radio-ready',
    }).join(', ');

    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', prefer: 'wait' },
      body: JSON.stringify({
        version,
        // Clean the lyrics the SAME way MiniMax does — ACE-Step got the RAW
        // enriched performance script and SANG the stage directions ("enter late",
        // "soft hazy", "Pre-Hook") as words. Strip them; keep singable ad-libs.
        input: { tags, lyrics: input.withVocals && input.lyrics ? cleanLyricsForMinimax(input.lyrics) : '', duration },
      }),
    });
    if (!res.ok) return { status: 'failed', error: `ace_step ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return this.toResult((await res.json()) as ReplicatePrediction, input);
  }

  async poll(externalId: string): Promise<ProviderJobResult<MusicGenerationOutput>> {
    if (externalId.startsWith('fal:')) return this.pollFal(externalId.slice(4));
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const res = await fetch(`https://api.replicate.com/v1/predictions/${externalId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { status: 'failed', error: `ace_step poll ${res.status}` };
    return this.toResult((await res.json()) as ReplicatePrediction);
  }

  /** fal.ai queue route — same open ACE-Step weights, the owner's fal credits. */
  private async generateViaFal(
    input: MusicGenerationInput
  ): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const duration = Math.min(Math.max(Math.round(input.durationS ?? 120), 30), 240);
    const tags = composeStyleTags(input, {
      fallbackLiteral: 'catchy, melodic vocals, punchy drums, warm bass, radio-ready',
    }).join(', ');
    // LYRIC-FIDELITY TUNING (first live fal-default drop, 2026-07-19: the take
    // failed the alignment gate on all five checks and the paying user got a
    // refund instead of a song). fal's own schema defaults lyric_guidance_scale
    // to 1.5 (range 0-10) and number_of_steps to 27 (range 3-60) — too weak to
    // hold Pidgin/English lyrics. Raised defaults, env-tunable for the bake-off.
    const clampEnv = (name: string, def: number, lo: number, hi: number) => {
      const raw = Number(process.env[name]);
      return Math.min(hi, Math.max(lo, Number.isFinite(raw) ? raw : def));
    };
    const res = await fetch('https://queue.fal.run/fal-ai/ace-step', {
      method: 'POST',
      headers: { authorization: `Key ${process.env.FAL_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        tags,
        // Same lyric hygiene as every singer: strip stage directions, keep
        // singable ad-libs. '[inst]' is fal-ACE's instrumental switch.
        lyrics: input.withVocals && input.lyrics ? cleanLyricsForMinimax(input.lyrics) : '[inst]',
        duration,
        number_of_steps: clampEnv('ACE_STEP_STEPS', 40, 3, 60),
        lyric_guidance_scale: clampEnv('ACE_STEP_LYRIC_GUIDANCE', 4, 0, 10),
      }),
    });
    if (!res.ok) {
      return { status: 'failed', error: `ace_step(fal) ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const data = (await res.json()) as { request_id?: string };
    if (!data.request_id) return { status: 'failed', error: 'ace_step(fal): no request_id' };
    return { externalId: `fal:${data.request_id}`, status: 'running', pollAfterMs: 5_000 };
  }

  private async pollFal(requestId: string): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const auth = { authorization: `Key ${process.env.FAL_KEY}` };
    const statusRes = await fetch(
      `https://queue.fal.run/fal-ai/ace-step/requests/${requestId}/status`,
      { headers: auth }
    );
    if (!statusRes.ok) return { status: 'failed', error: `ace_step(fal) status ${statusRes.status}` };
    const status = (await statusRes.json()) as { status?: string; error?: string };
    if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') {
      return { externalId: `fal:${requestId}`, status: 'running', pollAfterMs: 5_000 };
    }
    if (status.status !== 'COMPLETED') {
      return { externalId: `fal:${requestId}`, status: 'failed', error: status.error ?? `ace_step(fal) ${status.status ?? 'unknown'}` };
    }
    const res = await fetch(`https://queue.fal.run/fal-ai/ace-step/requests/${requestId}`, { headers: auth });
    if (!res.ok) return { status: 'failed', error: `ace_step(fal) result ${res.status}` };
    const body = (await res.json()) as { audio?: { url?: string } };
    const url = body.audio?.url;
    if (!url) return { externalId: `fal:${requestId}`, status: 'failed', error: 'ace_step(fal): completed without audio url' };
    return {
      externalId: `fal:${requestId}`,
      status: 'succeeded',
      output: { mainAudioUrl: url, format: 'wav', durationS: 0 },
      // ~$0.0002/audio-second on fal — a 3-min song ≈ $0.036 (vs $0.10 Replicate).
      estimatedCostUsd: 0.04,
    };
  }

  private toResult(
    data: ReplicatePrediction,
    input?: MusicGenerationInput
  ): ProviderJobResult<MusicGenerationOutput> {
    const url = Array.isArray(data.output) ? data.output[data.output.length - 1] : data.output;
    if (data.status === 'succeeded' && url) {
      return {
        externalId: data.id,
        status: 'succeeded',
        output: {
          mainAudioUrl: url,
          format: 'wav',
          durationS: input?.durationS ?? 0,
          bpm: input?.bpm,
          keySignature: input?.keySignature,
        },
        estimatedCostUsd: 0.1,
      };
    }
    if (data.status === 'failed' || data.status === 'canceled') {
      return { externalId: data.id, status: 'failed', error: data.error ?? 'ace_step failed' };
    }
    return { externalId: data.id, status: 'running', pollAfterMs: 5_000 };
  }
}

/**
 * Format a lyric for MiniMax music-2.6, which SINGS the lyrics field literally.
 *
 * Our vocal arranger writes an ACE-Step "performance script": the lyric peppered
 * with inline STAGE DIRECTIONS — "(drum roll — build up)", "(enter late, lean
 * behind the beat)", "(soft, hazy)", "(breath)". ACE-Step reads those as cues;
 * MiniMax would SING them as words ("drum roll", "soft hazy") — the exact kind of
 * garbage that reads as "fake". So for MiniMax we KEEP the [Section] tags and the
 * short, genuinely-singable ad-libs (a tight whitelist of interjections MiniMax
 * renders as backing) and DROP everything else in parentheses. Clean lead lines +
 * structure is MiniMax's sweet spot; it arranges its own natural phrasing. A
 * length cap on whole lines keeps us under the model's lyric limit.
 */
const MINIMAX_SINGABLE =
  /^(?:ooh|oh|eh|ah|mmm|hmm|yeah|ya|hey|heh|woah|whoa|na|la|da|yee+|uh|chai|oya|ehen|omo+|baby|shout|gang|come on|let'?s go|gbedu|jeje|ehn)(?:[\s,!'-]+(?:ooh|oh|eh|ah|mmm|hmm|yeah|ya|hey|woah|whoa|na|la|da|yee+|uh|baby))*!?$/i;
// Short call-and-RESPONSE backing phrases the arranger plants — MiniMax renders
// these as backing vocals (the "alive" layer). Kept alongside the single-word
// interjections above; still tight so stage directions never sneak through.
const MINIMAX_CALL_RESPONSE =
  /^(?:na so|tell (?:them|dem)|shout it|shout out|one time|to the world|oya now|sing it|say it|we dey|we move|no be lie|for real|come on|let'?s go|big vibe|as e dey hot|no dulling)!?$/i;
// MiniMax music-2.6 officially accepts 1–3500 lyric chars (Replicate schema);
// 3400 leaves margin. The old 2400 cap was 1100 chars of song left on the table.
// MiniMax's OFFICIAL structure tags (Replicate schema) — anything else in
// brackets is an invented header the engine may SING as words ("drum fill").
const ENGINE_SECTION_TAGS =
  /^(intro|verse|pre[- ]?chorus|chorus|interlude|bridge|outro|post[- ]?chorus|transition|break|hook|build[- ]?up|inst|solo|refrain|drop)(\s*\d+)?$/i;
// Production cues our arranger/writers historically emitted as fake headers.
const PRODUCTION_CUE = /(drum|fill|roll|percussion|riser|instrumental|beat[- ]?switch|ad[- ]?lib)/i;
// SINGING-BRAIN COMPAT: the sung form notates backing melisma as stretched
// vocables — "(oooh)", "(ohhh)", "(o-o-oh)". The literal whitelist above only
// knows the base forms, so those held vowels were silently DELETED before the
// engine (a melisma the scorecard counted would never be performed). Fold the
// stretch notation back to the base vocable for the TEST only — the ORIGINAL
// stretched text is what ships, because the engines respond to it.
const foldStretch = (t: string) =>
  t
    .replace(/([aeiouy])(?:-\1)+/gi, '$1') // o-o-oh → ooh, e-eh → eh
    .replace(/([a-z])\1{2,}/gi, '$1'); // oooh → oh, ohhh → oh, heyyy → hey
export function cleanLyricsForMinimax(raw: string, maxChars = 3400): string {
  const cleaned = raw
    .split('\n')
    .map((line) => {
      // RENDER-TIME header law (heals OLD stored drafts on every re-sing):
      // official section tags pass; [Drum Fill]-class cues become [Break] (the
      // intent — a transition — survives); any other invented header is dropped.
      const header = line.trim().match(/^\[([^\]]{1,40})\]$/);
      if (header) {
        const inner = header[1]!.trim();
        // Pre-hook IS a pre-chorus in MiniMax's vocabulary — keep the section
        // BOUNDARY in a tag the engine renders instead of dropping the header and
        // silently merging the pre-hook lyrics into the previous verse.
        if (/^pre[- ]?hook$/i.test(inner)) return '[Pre-Chorus]';
        if (ENGINE_SECTION_TAGS.test(inner)) return line.trim();
        return PRODUCTION_CUE.test(inner) ? '[Break]' : '';
      }
      return line
        // Keep whitelisted singable interjections AND short call-and-response
        // backing phrases; drop everything else in parens (stage directions).
        // Stretched melisma forms of a whitelisted vocable pass too (tested
        // FOLDED, shipped AS WRITTEN — the stretch is the performance).
        .replace(/\(([^)]*)\)/g, (_m, inner: string) => {
          const t = inner.trim();
          const folded = foldStretch(t);
          const keep =
            MINIMAX_SINGABLE.test(t) || MINIMAX_CALL_RESPONSE.test(t) ||
            MINIMAX_SINGABLE.test(folded) || MINIMAX_CALL_RESPONSE.test(folded);
          return keep ? `(${t})` : '';
        })
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    })
    // Collapse the blank-line runs the drops leave behind.
    .filter((l, i, arr) => !(l.trim() === '' && (arr[i - 1]?.trim() ?? '') === ''))
    .join('\n')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  // Over budget: before touching the tail, drop INTERIOR repeats of identical
  // sections (a hook sung 4× keeps its first and last outing). Plain tail-trim
  // silently deleted OUTROS and final hooks — "it didn't sing all of it".
  const parts = cleaned.split(/(?=^\[[^\]\n]+\]\s*$)/m);
  const normBody = (p: string) =>
    p.replace(/^\[[^\]\n]+\]\s*$/m, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const occurrences = new Map<string, number[]>();
  parts.forEach((p, i) => {
    const k = normBody(p);
    if (k) occurrences.set(k, [...(occurrences.get(k) ?? []), i]);
  });
  const interior = [...occurrences.values()]
    .filter((idx) => idx.length >= 3)
    .flatMap((idx) => idx.slice(1, -1))
    .sort((a, b) => b - a);
  const total = () => parts.reduce((n, p) => n + p.length, 0);
  for (const i of interior) {
    if (total() <= maxChars) break;
    parts[i] = '';
  }
  const dropped = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  if (dropped.length <= maxChars) return dropped;
  // Last resort: trim to whole lines so we never cut a word (or a [Section]).
  let acc = '';
  for (const l of dropped.split('\n')) {
    if ((acc ? acc.length + 1 : 0) + l.length > maxChars) break;
    acc += (acc ? '\n' : '') + l;
  }
  return acc;
}

/**
 * MiniMax Music (via Replicate) — full song WITH vocals from lyrics, no
 * reference track needed. Selectable per request (songEngine: 'minimax') on the
 * configured Replicate account.
 */
class MiniMaxSongAdapter implements MusicProviderAdapter {
  readonly name = 'minimax';
  constructor(private apiKey?: string) {}

  async generate(input: MusicGenerationInput): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const auth = { authorization: `Bearer ${token}` };

    let version = process.env.REPLICATE_MINIMAX_VERSION;
    if (!version) {
      const slug = process.env.REPLICATE_MINIMAX_MODEL ?? 'minimax/music-2.6';
      const mres = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: auth });
      if (!mres.ok) return { status: 'failed', error: `minimax model lookup ${mres.status}: ${(await mres.text()).slice(0, 160)}` };
      version = ((await mres.json()) as { latest_version?: { id?: string } }).latest_version?.id;
      if (!version) return { status: 'failed', error: 'minimax: model has no version' };
    }

    const style = composeStyleTags(input, {
      fallbackLiteral: 'catchy, melodic vocals, radio-ready',
    }).join(', ');

    // music-2.6 contract: `prompt` = style/mood description (required),
    // `lyrics` = the words (required for vocals unless lyrics_optimizer),
    // `is_instrumental`/`lyrics_optimizer` default false. Unknown fields 422, so
    // send only valid keys. `withVocals` controls the mode even when a beat request
    // still carries lyrics from its parent song.
    const wantsVocals = !!input.withVocals;
    const cleanedLyrics = input.lyrics ? cleanLyricsForMinimax(input.lyrics) : '';
    const modelInput: Record<string, unknown> = { prompt: style };
    if (!wantsVocals) modelInput.is_instrumental = true;
    else if (cleanedLyrics) modelInput.lyrics = cleanedLyrics;
    else return { status: 'failed', error: 'vocal generation requires singable lyrics' };

    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', prefer: 'wait' },
      body: JSON.stringify({ version, input: modelInput }),
    });
    if (!res.ok) return { status: 'failed', error: `minimax ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return this.toResult((await res.json()) as ReplicatePrediction, input);
  }

  async poll(externalId: string): Promise<ProviderJobResult<MusicGenerationOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: 'failed', error: 'REPLICATE_API_TOKEN missing' };
    const res = await fetch(`https://api.replicate.com/v1/predictions/${externalId}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return { status: 'failed', error: `minimax poll ${res.status}` };
    return this.toResult((await res.json()) as ReplicatePrediction);
  }

  private toResult(data: ReplicatePrediction, input?: MusicGenerationInput): ProviderJobResult<MusicGenerationOutput> {
    const url = Array.isArray(data.output) ? data.output[data.output.length - 1] : data.output;
    if (data.status === 'succeeded' && url) {
      return {
        externalId: data.id,
        status: 'succeeded',
        output: { mainAudioUrl: url, format: 'mp3', durationS: input?.durationS ?? 0, bpm: input?.bpm, keySignature: input?.keySignature },
        estimatedCostUsd: 0.12,
      };
    }
    if (data.status === 'failed' || data.status === 'canceled') return { externalId: data.id, status: 'failed', error: data.error ?? 'minimax failed' };
    return { externalId: data.id, status: 'running', pollAfterMs: 5_000 };
  }
}

/** One source of truth for the configured vocal-song route. */
export function defaultSongEngine(): string {
  if (process.env.SONG_ENGINE) {
    const configured = process.env.SONG_ENGINE.toLowerCase();
    return configured === 'replicate' ? 'minimax' : configured;
  }
  // BAKE-OFF VERDICT (owner's ear, 2026-07-19 evening — supersedes the same
  // morning's ace_step-default order): the tuned ACE-Step take passed the
  // LYRIC gate (64%) but the owner judged the production "terrible — no beats,
  // no drums, scattered". Per this codebase's own doctrine the measured
  // bake-off decides, and the owner's listen IS the bake-off: minimax holds
  // the default singer again. ACE-Step stays fully wired (explicit Standard B
  // pick + the fal route) for the next tuning round; SONG_ENGINE env remains
  // the override lever either way.
  if (replicateToken()) return 'minimax';
  if (sunoKey()) return 'suno';
  if (elevenKey()) return 'eleven';
  if (process.env.FAL_KEY) return 'ace_step';
  return 'unavailable';
}

/** One source of truth for a full-length instrumental route. */
export function defaultInstrumentalEngine(): string {
  const configured = process.env.INSTRUMENTAL_ENGINE ?? process.env.MUSIC_PROVIDER;
  if (configured) {
    const normalized = configured.toLowerCase();
    return normalized === 'replicate' ? 'minimax' : normalized;
  }
  if (elevenKey()) return 'eleven';
  if (replicateToken()) return 'minimax';
  if (sunoKey()) return 'suno';
  return 'unavailable';
}

class UnavailableMusicAdapter implements MusicProviderAdapter {
  readonly name = 'unavailable';
  constructor(private requested?: string) {}

  async generate(): Promise<ProviderJobResult<MusicGenerationOutput>> {
    return {
      status: 'failed',
      error: this.requested
        ? `music provider '${this.requested}' is unsupported or not configured`
        : 'no music provider is configured',
    };
  }
}

/**
 * ISOLATED-LOOP FORGE ROUTING (SOUNDCORE item 2) — resolve the adapter for
 * forging a SINGLE-INSTRUMENT loop, which is NOT the same problem as rendering a
 * full song. A workspace SONG engine (minimax/ace_step/suno) renders full MIXES;
 * an isolated 'solo shekere' forge then fails the role-purity gate for role-bleed
 * and only the synth stand-in survives — the owner's "not our instruments". This
 * routes the forge to MusicGen (Replicate), which is loop-capable and honors the
 * requested duration, so a solo voice actually lands and passes purity.
 *
 * WHO PAYS (cost guard preserved): MusicGen is a PAID Replicate call. Prefer the
 * WORKSPACE's own Replicate key when their song engine already runs on Replicate
 * (minimax/replicate) — their bill, unchanged. Otherwise the operator's house
 * token (the same deliberate forge spend the caller's connected-engine/opt-in
 * gate already authorized). No Replicate route at all → fall back to the song
 * adapter (old behavior: a full-mix forge, honestly) so nothing regresses.
 *
 * The forge's verbatim prompt + key + 429 backoff live in the caller (material.ts)
 * and are unchanged — this only swaps WHICH engine renders the loop.
 */
export function forgeLoopAdapter(input: {
  songProvider?: string | null;
  workspaceKey?: string;
}): { adapter: MusicProviderAdapter; route: string } {
  const provider = (input.songProvider ?? "").toLowerCase();
  const replicateFamily =
    provider === "replicate" || provider === "minimax" || provider === "minimax_ref";
  if (replicateFamily && input.workspaceKey) {
    return {
      adapter: new ReplicateMusicGenAdapter(input.workspaceKey),
      route: "musicgen-workspace-key",
    };
  }
  if (replicateToken()) {
    return { adapter: new ReplicateMusicGenAdapter(), route: "musicgen-house-token" };
  }
  return {
    adapter: musicAdapter(input.songProvider ?? undefined, input.workspaceKey),
    route: "song-provider-fallback",
  };
}

/**
 * PER-GENRE/LANGUAGE TRAINED-ADAPTER ROUTING (trainlegal item 5) — resolve
 * which fine-tuned adapter should back a render for a given genre/language,
 * with base fallback. Pure over the raw SystemSetting value so the worker's
 * one DB read stays in the worker.
 *
 * LICENSE LAW rides the resolver: a 'production' query can only ever receive
 * a production-lane, commercially-licensed adapter (resolveMusicAdapterRoute
 * enforces it); dev-lane experiments are invisible to paying renders.
 */
export function resolveTrainedAdapterForRender(input: {
  /** Raw JSON from MUSIC_ADAPTER_ROUTE_SETTING_KEY (or null/undefined). */
  routeTableRaw?: string | null;
  genre?: string | null;
  language?: string | null;
  lane?: RouteLane;
  /** The single active base pointer (already lane-gated by the caller). */
  baseModelRef?: string | null;
}): MusicAdapterResolution {
  const table = parseMusicAdapterRouteTable(input.routeTableRaw);
  return resolveMusicAdapterRoute(table, {
    genre: input.genre,
    language: input.language,
    lane: input.lane ?? 'production',
    baseModelRef: input.baseModelRef ?? null,
  });
}

export function musicAdapter(override?: string, apiKey?: string): MusicProviderAdapter {
  // fal was REMOVED ENTIRELY (owner directive 2026-07-11) — every render runs
  // on the exact provider configuration the owner's ear approved. If a cheaper
  // route is ever reconsidered, it re-enters ONLY through a measured bake-off
  // (git history has the deleted adapter).
  const requested = (override ?? provider()).toLowerCase();
  switch (requested) {
    // Reference-conditioned renders (Adjust): no conditioning engine is
    // configured — renders run UNCONDITIONED on the standard engine (the
    // worker logs this honestly; steering still rides the brief).
    case 'minimax_ref':
      return new MiniMaxSongAdapter(apiKey);
    case 'minimax':
      return new MiniMaxSongAdapter(apiKey);
    case 'ace_step':
      return new AceStepSongAdapter(apiKey);
    case 'suno':
      return new SunoAdapter(apiKey);
    case 'replicate':
      return new ReplicateMusicGenAdapter(apiKey);
    case 'eleven':
      return new ElevenMusicAdapter(apiKey);
    case 'stub':
      return new UnavailableMusicAdapter('stub');
    case 'unavailable':
      return new UnavailableMusicAdapter();
    default:
      return new UnavailableMusicAdapter(requested);
  }
}

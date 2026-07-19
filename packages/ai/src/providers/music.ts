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
import { getGenreKit } from '@afrohit/shared';

function provider(): string {
  return (process.env.MUSIC_PROVIDER ?? 'unavailable').toLowerCase();
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

export function composeStyleTags(
  input: MusicGenerationInput,
  opts: { fallbackLiteral: string; genreLabel?: string; genreSuffix?: string; keyPrefix?: string; tonePrefix?: string }
): string[] {
  const hasDna = !!input.dnaTags?.length;
  // Humanize the genre enum so the model reads "afro dancehall", not "afro_dancehall".
  const genreLabel = opts.genreLabel ?? (input.genre ?? 'afrobeats').replace(/_/g, ' ');
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
  const raw = [
    genreLine,
    afro ? afro.signature : null,
    instrumentation,
    ...fusionTokens,
    // Every African lane rejects the specific reggaeton failure mode. Avoid a
    // blanket "NOT Latin" direction: Congolese rumba/soukous has a real historical
    // dialogue with Cuban music, while still being categorically not reggaeton.
    isAfro ? 'NOT reggaeton, NOT dembow, NOT tresillo/dembow kick, NOT perreo' : null,
    ...(kit ? kit.engineTags.slice(0, 8).map(deLatin) : []),
    opts.genreSuffix ?? null,
    ...(input.dnaTags ?? []).map(deLatin),
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
    // hence the 404). Resolve the current version unless one is pinned.
    let version = process.env.REPLICATE_MUSIC_VERSION;
    if (!version) {
      const slug = process.env.REPLICATE_MUSIC_MODEL ?? 'meta/musicgen';
      const mres = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: auth });
      if (!mres.ok) {
        return { status: 'failed', error: `replicate model lookup ${mres.status}: ${(await mres.text()).slice(0, 160)}` };
      }
      const mdata = (await mres.json()) as { latest_version?: { id?: string } };
      version = mdata.latest_version?.id;
      if (!version) return { status: 'failed', error: 'replicate: model has no version' };
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
    const res = await fetch('https://queue.fal.run/fal-ai/ace-step', {
      method: 'POST',
      headers: { authorization: `Key ${process.env.FAL_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        tags,
        // Same lyric hygiene as every singer: strip stage directions, keep
        // singable ad-libs. '[inst]' is fal-ACE's instrumental switch.
        lyrics: input.withVocals && input.lyrics ? cleanLyricsForMinimax(input.lyrics) : '[inst]',
        duration,
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
  if (sunoKey()) return 'suno';
  if (elevenKey()) return 'eleven';
  if (replicateToken()) return 'minimax';
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

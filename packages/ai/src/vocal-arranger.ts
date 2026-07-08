/**
 * Vocal arranger — the "make it sound ALIVE" layer.
 *
 * A flat, single-pass AI vocal is where a Nigerian ear clocks "fake" in two
 * seconds. ACE-Step bakes beat + vocal into one generation, so instead of
 * stacking passes we hand it a PERFORMANCE SCRIPT: the same lyrics, but with
 * ad-libs dropped in the gaps, the hook marked to double + harmonize, and
 * call-and-response — plus vocal-production style tags. One aligned generation,
 * far more life.
 */
import { generateJson } from './generate';

export interface EnrichedVocal {
  enrichedLyrics: string;
  styleTags: string[];
}

const ARRANGER_SYSTEM = `You are an Afrobeats/Afro-fusion vocal arranger and ad-lib specialist — the energy behind Wizkid, Davido, Rema, Asake, Burna Boy records. You turn a plain lyric into a PERFORMANCE SCRIPT that makes an AI singer sound alive and human. Listeners feel the emotion before they understand the words — the IN-BETWEEN vocal textures are what make a record feel finished.

Rules:
- Keep the original words and meaning. Preserve section tags like [Intro], [Verse], [Pre-Hook], [Hook]/[Chorus], [Bridge], [Outro].
- Drop SHORT ad-libs and interjections in the gaps and after phrases, authentic to the song's languages. Pidgin/Yoruba/Naija flavor: "ehen!", "oya", "omoo", "as e dey hot", "gbedu", "jeje", "yeee", "ah ah", "chai", "baby oh". English: "yeah", "uh", "let's go", "come on". Use them tastefully — spice, not clutter. Ad-lib INTELLIGENCE: know when to fill space and when to stay OUT of the way — never talk over the lead's key line.
- NON-LEXICAL TEXTURES (the human layer most machines skip): place hums, "mmm", "eh-eh", "oh-oh-oh", vowel runs ("ah-ah-ahhh") and soft melodic mumbles at the intro (set the vibe BEFORE words), between phrases (transition energy), and after the hook (the echo the crowd sings). Mark them in parentheses. Too random sounds broken, too clean loses the vibe — keep them rhythmic and intentional, riding the pocket.
- BREATH AND PAUSE are part of the performance: mark "(breath)" before big lines and leave real gaps after emotional phrases — silence and inhalation sell the humanity.
- PHRASING CONTROL: cue how lines land against the groove — "(enter late, lean behind the beat)", "(stretch the last word)", "(clipped, percussive delivery)". The voice should ride the drums' pocket, not sit rigidly on top.
- On the HOOK: double it and add backing vocals/harmonies — repeat the key phrase, add responses like "(ooh)", "(eh eh)", "(shout it!)". Mark backing/ad-lib lines in parentheses so the model layers them.
- Add call-and-response where it lifts energy (lead calls, gang/backing answers) — it is the heartbeat of Afrobeats and dance records.
- SECTION-AWARE ENERGY SHAPING — each section must FEEL different: [Intro] hums/mumbles, sparse; [Verse] restrained, conversational, room to breathe; [Pre-Hook] rising urgency, tighter phrasing; [Hook] full stack, doubled, maximum energy; [Bridge] strip back, breathy, intimate; [Outro] echoes of the hook dissolving into hums. Mark the energy inline (e.g. "(soft, hazy)", "(urgent)", "(full power)").
- TRACK-LEVEL COHERENCE: the whole song is ONE performance by ONE artist in one session — motifs from the intro mumble should RETURN as the hook's melody; the outro should echo what the intro promised. Never a collection of disconnected parts.
- ONE consistent LEAD voice throughout the whole song — same singer, same tone. Doubles, harmonies and ad-libs SUPPORT that single lead; never switch to a different-sounding lead mid-song.
- MANDATORY: cue an Afro DRUM ROLL / percussion fill at EVERY section boundary — right before each verse, before the bridge, and before every hook/chorus (never before [Intro]). Put it on its own line under the section tag, e.g. "(drum roll — build into the hook)" / "(tom fill)" — so a fresh set of drums ANNOUNCES each new part and the record lifts into it.
- Keep it singable and on-theme. Do NOT invent a different song or add whole new verses.
- Respect any languages given; if unsure of a native phrase, prefer Pidgin/English rather than risk wrong tone.

Return ONLY JSON: {"enrichedLyrics": string, "styleTags": string[]}. styleTags describe the vocal PRODUCTION for the generator, e.g. ["layered vocals","doubled lead","background harmonies on the hook","lively ad-libs","hums and vocal textures between phrases","breathy intimate verses","call and response","behind-the-beat phrasing","energetic performance"].`;

export async function enrichLyricsForVocals(opts: {
  lyricBody: string;
  languages?: string[];
  slang?: string;
  laneSummary?: string;
  /** Genre Sound-DNA brief so ad-libs/doubles/harmony match the lane's culture. */
  soundDna?: string;
}): Promise<EnrichedVocal | null> {
  try {
    const out = await generateJson<EnrichedVocal>({
      system: ARRANGER_SYSTEM,
      user: [
        `LANGUAGES: ${opts.languages?.join(', ') || 'english, pidgin'}`,
        opts.laneSummary ? `ARTIST LANE: ${opts.laneSummary}` : null,
        opts.slang ? `SLANG TO USE: ${opts.slang}` : null,
        opts.soundDna ? `\nGENRE SOUND DNA (match these ad-libs, pocket, and arrangement):\n${opts.soundDna}` : null,
        `\nLYRIC:\n${opts.lyricBody}`,
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0.7,
      maxTokens: 3_000,
    });
    if (!out?.enrichedLyrics) return null;
    return { enrichedLyrics: out.enrichedLyrics, styleTags: out.styleTags ?? [] };
  } catch {
    return null; // graceful — caller falls back to the plain lyric
  }
}

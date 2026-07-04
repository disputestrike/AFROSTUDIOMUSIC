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
import { responsesJson } from './providers/text';

export interface EnrichedVocal {
  enrichedLyrics: string;
  styleTags: string[];
}

const ARRANGER_SYSTEM = `You are an Afrobeats/Afro-fusion vocal arranger and ad-lib specialist — the energy behind Wizkid, Davido, Rema, Asake, Burna Boy records. You turn a plain lyric into a PERFORMANCE SCRIPT that makes an AI singer sound alive and human.

Rules:
- Keep the original words and meaning. Preserve section tags like [Intro], [Verse], [Pre-Hook], [Hook]/[Chorus], [Bridge], [Outro].
- Drop SHORT ad-libs and interjections in the gaps and after phrases, authentic to the song's languages. Pidgin/Yoruba/Naija flavor: "ehen!", "oya", "omoo", "as e dey hot", "gbedu", "jeje", "yeee", "ah ah", "chai", "baby oh". English: "yeah", "uh", "let's go", "come on". Use them tastefully — spice, not clutter.
- On the HOOK: double it and add backing vocals/harmonies — repeat the key phrase, add responses like "(ooh)", "(eh eh)", "(shout it!)". Mark backing/ad-lib lines in parentheses so the model layers them.
- Add call-and-response where it lifts energy.
- Keep it singable and on-theme. Do NOT invent a different song or add whole new verses.
- Respect any languages given; if unsure of a native phrase, prefer Pidgin/English rather than risk wrong tone.

Return ONLY JSON: {"enrichedLyrics": string, "styleTags": string[]}. styleTags describe the vocal PRODUCTION for the generator, e.g. ["layered vocals","doubled lead","background harmonies on the hook","lively ad-libs","call and response","energetic performance"].`;

export async function enrichLyricsForVocals(opts: {
  lyricBody: string;
  languages?: string[];
  slang?: string;
  laneSummary?: string;
}): Promise<EnrichedVocal | null> {
  try {
    const out = await responsesJson<EnrichedVocal>({
      system: ARRANGER_SYSTEM,
      user: [
        `LANGUAGES: ${opts.languages?.join(', ') || 'english, pidgin'}`,
        opts.laneSummary ? `ARTIST LANE: ${opts.laneSummary}` : null,
        opts.slang ? `SLANG TO USE: ${opts.slang}` : null,
        `\nLYRIC:\n${opts.lyricBody}`,
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0.7,
      maxOutputTokens: 3_000,
    });
    if (!out?.enrichedLyrics) return null;
    return { enrichedLyrics: out.enrichedLyrics, styleTags: out.styleTags ?? [] };
  } catch {
    return null; // graceful — caller falls back to the plain lyric
  }
}

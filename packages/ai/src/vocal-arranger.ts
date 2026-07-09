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
- HARD BAN — production words NEVER appear in the lyric text, not even in parentheses (singer engines SING parentheticals): "log drum", "shaker", "shekere", "808", "amapiano", "BPM", "percussion", "drum roll", "tom fill", "bassline", "the drop", "hi-hat", "snare". The GENRE_SOUND_DNA/context inputs describe the BEAT ONLY — never quote their words. Section lift is expressed through VOCAL energy cues only ("(rise)", "(full power)", "(strip back)"); the drums announce sections via styleTags — ALWAYS include "drum fill into every hook and section change" in styleTags instead of writing it in the lyric.
- Keep it singable and on-theme. Do NOT invent a different song or add whole new verses.
- NATURALNESS LAW (the AI tells are: perfect pitch, breathless long phrases, identical doubles, robotic echo ad-libs — kill them all): write HUMAN SOUNDS as sung text, phoneticized inline — a breath before a big line as "hhh—", an exhale "whoo!", a soft laugh "ehe", a strain " agh" — NEVER meta-words like "(breath)" or "(laughs)" (engines sing those). No phrase runs longer than a real lung: break lines so a singer could breathe. Place ONE intentional imperfection per song (a cracked/strained note moment, a spoken half-line, a trailing mumble) — perfection is the tell. Doubles/harmonies vary their words or timing slightly; ad-libs CONVERSE ("na so!", "tell them!") and never robot-echo the lead.
- LANGUAGE IS A HARD CONTRACT: keep every line in ITS ORIGINAL LANGUAGE — never translate, never drift. Ad-libs/textures must come from the SONG'S OWN languages: isiZulu/isiXhosa/SA township: "yebo!", "haibo", "eish", "hhayi bo", "woza", "sho", "aweh", "eita", "sharp sharp"; Swahili: "eeh", "twende", "sawa"; Lingala: "eh mama", "malamu"; Wolof: "waaw", "dégg naa"; Kreyòl: "anmwey", "cheri"; Patois: "yow", "big up". Naija flavor ONLY when pcm/yo/ig/ha are among the song's languages. If unsure of a native phrase, use a NON-LEXICAL texture (hum, "eh-eh", vowel run) — NEVER substitute Pidgin or English for a native line.

Return ONLY JSON: {"enrichedLyrics": string, "styleTags": string[]}. styleTags describe the vocal PRODUCTION for the generator, e.g. ["layered vocals","doubled lead","background harmonies on the hook","lively ad-libs","hums and vocal textures between phrases","breathy intimate verses","call and response","behind-the-beat phrasing","energetic performance"].`;

const JARGON = /(log[\s-]?drums?|shakers?|shekere|808s?|\bbpm\b|drum\s?(?:rolls?|fills?)|tom\s?fills?|percussion|hi-?hats?|snares?|bass\s?line|four[\s-]on[\s-]the[\s-]floor|\bthe\s+drop\b)/gi;
// In the RAP FAMILY, 808 / snare / hi-hat / bassline / the drop are CULTURE, not
// leaks — the full ban was punching holes in bars mid-flow. Rap gets a minimal
// scrub (engine-cue phrases only); every other lane keeps the full protection.
const RAP_FAMILY = new Set(['hip_hop', 'trap', 'drill']);
const JARGON_RAP = /(log[\s-]?drums?|drum\s?(?:rolls?|fills?)|tom\s?fills?)/gi;

/** Belt-and-braces: strip production vocabulary from SUNG text. Bracketed
 *  [Section] headers are preserved; any parenthetical containing jargon is
 *  removed whole (engines sing parentheticals); bare jargon words are excised. */
export function scrubProductionJargon(body: string, genre?: string): string {
  const RX = RAP_FAMILY.has(genre ?? '') ? JARGON_RAP : JARGON;
  return body
    .split('\n')
    .map((line) => {
      if (/^\s*\[[^\]]+\]\s*$/.test(line)) return line; // section header — engine cue, allowed
      let out = line.replace(/\(([^)]*)\)/g, (m, inner) => (RX.test(inner) ? '' : m));
      RX.lastIndex = 0;
      out = out.replace(RX, '').replace(/\s{2,}/g, ' ').replace(/\(\s*\)/g, '').trimEnd();
      RX.lastIndex = 0;
      return out;
    })
    .filter((l, i, arr) => !(l.trim() === '' && (arr[i - 1] ?? '').trim() === ''))
    .join('\n');
}

export async function enrichLyricsForVocals(opts: {
  genre?: string;
  lyricBody: string;
  languages?: string[];
  slang?: string;
  laneSummary?: string;
  /** Genre Sound-DNA brief so ad-libs/doubles/harmony match the lane's culture. */
  soundDna?: string;
}): Promise<EnrichedVocal | null> {
  try {
    const RAP_GENRES = new Set(['hip_hop', 'trap', 'drill']);
    const isRap = RAP_GENRES.has(opts.genre ?? '');
    const rapLaw = isRap
      ? `\nRAP DELIVERY LAW — this is ${opts.genre}: VERSES ARE RAPPED, not sung — rhythmic spoken flow, bars with internal rhyme and punchlines, a cadence switch between verse halves. The HOOK may sing or chant. Ad-libs punctuate the bars ("uh", "yeah", "talk!"). Melodic delivery on verses is a HARD FAIL.`
      : '';
    const out0 = await generateJson<EnrichedVocal>({
      system: ARRANGER_SYSTEM + rapLaw,
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
    const out: EnrichedVocal | null = out0
      ? { ...out0, enrichedLyrics: scrubProductionJargon(out0.enrichedLyrics ?? '', opts.genre), styleTags: [...new Set([...(out0.styleTags ?? []), 'drum fill into every hook and section change', 'natural breaths and human imperfections', 'relaxed human timing, slightly behind the beat', 'raw vocal feel, minimal pitch correction', ...(isRap ? ['rap delivery, rhythmic flow on verses'] : [])])] }
      : out0;
    if (!out?.enrichedLyrics) return null;
    return { enrichedLyrics: out.enrichedLyrics, styleTags: out.styleTags ?? [] };
  } catch {
    return null; // graceful — caller falls back to the plain lyric
  }
}

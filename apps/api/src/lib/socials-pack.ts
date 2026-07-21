/**
 * SOCIALS PACK (owner, 2026-07-20): "on every song … SOCIALS, like another tab
 * next to the lyrics. When I click it, I see what I can copy right away and
 * use for my social media. Use Cerebras for the heavy lifting."
 *
 * BULK BRAIN ONLY — this is caption/gloss work, exactly the class the A3-5
 * tiering law routes to Cerebras. It deliberately does NOT go through
 * generateJson's failure ladder: laddering up would bill the paid brains for
 * throwaway promo copy (the GOVSURE cost-leak lesson). Cerebras down/missing =
 * an honest "try again" error, never a silent Claude bill. No user credits are
 * charged either — a bulk call is effectively $0; it is cost-logged like every
 * other bulk task so /admin/economics still sees it.
 *
 * VERBATIM LAW: the prompt may only quote lyric lines EXACTLY as written —
 * the artist's words are never rewritten into fake lyrics.
 */
import {
  cerebrasEnabled,
  cerebrasJson,
  lastCerebrasUsage,
  recordLlmUsage,
  detectAfricanLanguage,
} from '@afrohit/ai';

export interface SocialsPack {
  /** 2-3 sentences: what this song is about — paste-anywhere. */
  story: string;
  /** Exactly 3 caption variants: hype, heartfelt, minimal. Each short. */
  captions: string[];
  /** 8-12 relevant tags as ONE paste-ready line ("#tag #tag …"). */
  hashtags: string;
  /** One-line teaser for reels/shorts. */
  hook: string;
  /** Language the pack was written in (matches the lyric's language). */
  language: string;
  generatedAt: string;
}

export interface SocialsPackInput {
  title: string;
  artist: string;
  genre: string;
  mood?: string | null;
  topic?: string | null;
  /** The song's lyric body, or null for an instrumental. */
  lyrics?: string | null;
  /** Catalog kind: song | instrumental | film_sound. */
  kind?: string;
}

/** Thrown when the bulk brain cannot produce a pack — the route turns this
 *  into a graceful 503 "try again". NEVER falls through to a paid brain. */
export class SocialsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocialsUnavailableError';
  }
}

const LANG_NAME: Record<string, string> = {
  yor: 'Yoruba',
  ibo: 'Igbo',
  swa: 'Swahili',
  aka: 'Twi',
};

const clampLine = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, max) : '';

/** Coerce whatever tag shape the model returned into one paste-ready line of
 *  8-12 #tags. A pack that cannot reach 3 tags is not a pack — fail honestly. */
function hashtagLine(raw: unknown): string {
  const parts = (Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/\s+/))
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .map((t) => t.replace(/[^\p{L}\p{N}#_]/gu, ''))
    .filter((t) => t.length > 1);
  return [...new Set(parts)].slice(0, 12).join(' ');
}

/**
 * Build the pack from the song's REAL materials via the BULK Cerebras tier.
 * STUB_AI=1 returns a deterministic pack (test law — no network, no keys).
 */
export async function generateSocialsPack(input: SocialsPackInput): Promise<SocialsPack> {
  const instrumental = !input.lyrics?.trim();
  const lang = instrumental ? null : detectAfricanLanguage(input.lyrics!);
  const langName = lang ? LANG_NAME[lang] ?? 'English' : 'English';

  if (process.env.STUB_AI === '1') {
    // Deterministic test shape — same coercion path as the real call.
    return finishPack(
      {
        story: `"${input.title}" is a ${input.genre.replace(/_/g, ' ')} record by ${input.artist} about holding on to joy. It was made to move a room.`,
        captions: [
          `NEW HEAT from ${input.artist} — "${input.title}" is out of the studio and it KNOCKS. Run it up!`,
          `Some songs you make; some songs make you. "${input.title}" is the second kind.`,
          `${input.title} — ${input.artist}.`,
        ],
        hashtags: ['#afrobeats', '#newmusic', '#afrohit', '#naijamusic', '#viral', '#explore', '#fyp', '#africanmusic'],
        hook: `POV: the first 10 seconds of "${input.title}" hit and the whole room stops.`,
      },
      langName,
    );
  }

  // BULK OR NOTHING: no Cerebras on this service = no pack. The route says
  // "try again" — the paid brains are never touched for promo copy.
  if (!cerebrasEnabled()) {
    throw new SocialsUnavailableError('the bulk brain is not configured on this service');
  }

  const lyricBlock = instrumental
    ? `THE SONG IS AN INSTRUMENTAL (no lyrics) — write about its mood and energy instead.`
    : `LYRICS (the artist's exact words — if you quote a line, quote it VERBATIM, character for character; NEVER paraphrase or invent lyric lines):\n${input.lyrics!.slice(0, 4000)}`;

  const system = `You write short, copy-paste-ready social media promo for a song. Return JSON only:
{"story": "2-3 sentences saying what the song is about and why it sticks — paste-anywhere, no hashtags",
 "captions": ["HYPE variant", "HEARTFELT variant", "MINIMAL variant"],  // each under 220 characters, at most 1-2 emoji each
 "hashtags": ["#tag", ...],  // 8-12 relevant tags, lowercase, no spaces
 "hook": "one line a creator says over the first seconds of a reel/short"}
Write in ${langName === 'English' ? 'English' : `the same ${langName}/English blend the lyrics use`}. Be specific to THIS song — never generic filler. No fake claims (no chart positions, no streaming numbers).`;

  const user = [
    `TITLE: ${input.title}`,
    `ARTIST: ${input.artist}`,
    `GENRE: ${input.genre.replace(/_/g, ' ')}`,
    input.mood ? `MOOD: ${input.mood}` : null,
    input.topic ? `TOPIC: ${input.topic}` : null,
    input.kind && input.kind !== 'song' ? `KIND: ${input.kind}` : null,
    '',
    lyricBlock,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');

  const t0 = Date.now();
  let raw: { story?: unknown; captions?: unknown; hashtags?: unknown; hook?: unknown };
  try {
    raw = await cerebrasJson({ system, user, maxTokens: 900 });
    recordLlmUsage({
      tier: 'bulk',
      task: 'socials-pack',
      brain: 'cerebras',
      ms: Date.now() - t0,
      estCostUsd: lastCerebrasUsage?.estCostUsd ?? null,
    });
  } catch (err) {
    // Every key failed (rotation already ran inside cerebrasJson). Log the
    // degradation and surface an honest retry — no ladder, no paid brain.
    recordLlmUsage({
      tier: 'bulk',
      task: 'socials-pack',
      brain: 'cerebras',
      ms: Date.now() - t0,
      estCostUsd: null,
      degraded: (err as Error).message.slice(0, 160),
    });
    throw new SocialsUnavailableError((err as Error).message.slice(0, 160));
  }
  return finishPack(raw, langName);
}

/** Coerce + validate the model's shape. A pack missing its core pieces is
 *  refused (grounding law: refuse > fabricate), never padded with filler. */
function finishPack(
  raw: { story?: unknown; captions?: unknown; hashtags?: unknown; hook?: unknown },
  language: string,
): SocialsPack {
  const story = clampLine(raw.story, 600);
  const captions = (Array.isArray(raw.captions) ? raw.captions : [])
    .map((c) => clampLine(c, 220))
    .filter(Boolean)
    .slice(0, 3);
  const hashtags = hashtagLine(raw.hashtags);
  const hook = clampLine(raw.hook, 200);
  if (!story || captions.length < 3 || hashtags.split(' ').length < 3 || !hook) {
    throw new SocialsUnavailableError('the bulk brain returned an incomplete pack');
  }
  return { story, captions, hashtags, hook, language, generatedAt: new Date().toISOString() };
}

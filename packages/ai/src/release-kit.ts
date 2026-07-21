/**
 * RELEASE KIT (owner, 2026-07-21): "today the Socials tab makes me click
 * Generate, and the hashtags don't show until I do — we did not see it." WRONG.
 * The kit must generate ITSELF the moment a song finishes, so when the owner
 * opens the song everything is already there — no clicking.
 *
 * This module is the ONE tested unit both callers share:
 *   - the WORKER completion hook (song render finished -> processReleaseKit ->
 *     writeReleaseKit) fills the kit with NO user action, and
 *   - the API "Regenerate" button (POST /songs/:id/socials/generate ->
 *     writeReleaseKit force) refreshes it on demand.
 * It lives in @afrohit/ai (not apps/*) so the worker, the API, and the unit test
 * all import the exact same generator + writer. writeReleaseKit takes an
 * INJECTED db (structural type) so it never imports @afrohit/db — the package
 * stays decoupled and the test can drive it with a fake prisma.
 *
 * BULK BRAIN ONLY — the same A3-5 tiering law the socials pack followed. Every
 * string is copy/gloss work, so it goes through cerebrasJson (Cerebras key
 * rotation) and DELIBERATELY NOT through generateJson's failure ladder: laddering
 * up would bill the paid brains for throwaway promo copy (the GOVSURE cost-leak
 * lesson). Cerebras down/missing => an honest "unavailable" status, never a
 * silent Claude bill. No user credits are charged; a bulk call is ~$0 and is
 * cost-logged like every other bulk task so /admin/economics still sees it.
 *
 * VERBATIM LAW: the prompt may only quote lyric lines EXACTLY as written — the
 * artist's words are never rewritten into fake lyrics, no fake chart/stream
 * numbers, no unrelated trending hashtags.
 *
 * HUMANIZATION STANDARD: every generated string is held to the humanization
 * skill — no generic openers, no corporate filler, specific to THIS song, a
 * point of view, natural rhythm. The prompt bakes those rules in; the coercion
 * below refuses an incomplete kit rather than padding it with machine filler.
 */
import { cerebrasEnabled, cerebrasJson, lastCerebrasUsage } from './cerebras-client';
import { recordLlmUsage } from './llm-usage';
import { detectAfricanLanguage } from './african-g2p';

// ---- The kit shape --------------------------------------------------------

/** A caption tagged with the platform it is shaped for AND its emotional style.
 *  youtube = the long, description-style post (2-3 short paragraphs); tiktok +
 *  instagram are short and punchy (<=220). */
export interface KitCaption {
  platform: 'youtube' | 'tiktok' | 'instagram';
  style: 'hype' | 'heartfelt' | 'minimal';
  text: string;
}

/** Hashtags in THREE explicit tiers (viral rule: tiered, never stuffed, never an
 *  unrelated trend). tier3 may be EMPTY — matched-trend-only means only tags that
 *  genuinely fit this song; an empty tier3 is correct, not a failure. `line` is a
 *  curated 3-5 tag paste-ready string drawn across the tiers. */
export interface KitHashtags {
  tier1: string[]; // genre (#Afrobeats, #AfricanMusic)
  tier2: string[]; // audience (#NewMusic, #IndependentArtist)
  tier3: string[]; // matched-trend only (may be empty)
  line: string; // ready-to-paste, 3-5 usable tags
}

/** One dated-relative posting-calendar entry ("day 0: YouTube — post the video"). */
export interface KitCalendarEntry {
  day: number; // relative days from release (0 = release day)
  channel: string; // YouTube | TikTok | Instagram Reels | ...
  action: string; // what to post, in one line
}

export interface ReleaseKit {
  /** 2-3 sentences: what this song is about — paste-anywhere. */
  story: string;
  /** Per-platform captions (the YT long one + a TikTok + an IG), each carrying
   *  one of the 3 styles hype/heartfelt/minimal. */
  captions: KitCaption[];
  /** 3-tier hashtags, grouped + a ready-to-paste line. */
  hashtags: KitHashtags;
  /** One-line teaser for reels/shorts. */
  hook: string;
  /** 10 YouTube titles — curiosity, never clickbait. */
  titles: string[];
  /** 1 YouTube video description. */
  description: string;
  /** Short artist bio (2-3 sentences). */
  artistBio: string;
  /** 5-7 dated-relative posting entries ("post when the audience is active"). */
  releaseCalendar: KitCalendarEntry[];
  /** A pinned comment to seed the thread. */
  pinnedComment: string;
  /** One genuine question to spark discussion (not "smash like"). */
  engagementQuestion: string;
  /** Language the kit was written in (matches the lyric's language). */
  language: string;
  generatedAt: string;
  /** Kit format version — lets the UI/readers reason about older stored packs. */
  kind: 'release-kit';
}

export interface ReleaseKitInput {
  title: string;
  artist: string;
  genre: string;
  mood?: string | null;
  topic?: string | null;
  /** The song's lyric body, or null for an instrumental. */
  lyrics?: string | null;
  /** Catalog kind: song | instrumental | film_sound. */
  kind?: string;
  /** True once a music video exists — nudges the calendar to lead with it. */
  hasVideo?: boolean;
}

/** Thrown when the bulk brain cannot produce a complete kit — callers turn this
 *  into a graceful "unavailable" status. NEVER falls through to a paid brain. */
export class ReleaseKitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseKitUnavailableError';
  }
}

const LANG_NAME: Record<string, string> = {
  yor: 'Yoruba',
  ibo: 'Igbo',
  swa: 'Swahili',
  aka: 'Twi',
};

const clampLine = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.trim().replace(/[ \t]+/g, ' ').slice(0, max) : '';

// A caption/description keeps its paragraph breaks; only runs of blank space
// collapse. (The YouTube caption is 2-3 short paragraphs.)
const clampBlock = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, max) : '';

/** Coerce whatever tag shape the model returned into clean #tags — deduped,
 *  stripped of punctuation, one tier at a time. */
function tagList(raw: unknown, max: number): string[] {
  const parts = (Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[\s,]+/))
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .map((t) => t.replace(/[^\p{L}\p{N}#_]/gu, ''))
    .filter((t) => t.length > 1);
  return [...new Set(parts)].slice(0, max);
}

/**
 * Build the FULL kit from the song's REAL materials via the BULK Cerebras tier.
 * STUB_AI=1 returns a deterministic kit (test law — no network, no keys).
 */
export async function generateReleaseKit(input: ReleaseKitInput): Promise<ReleaseKit> {
  const instrumental = !input.lyrics?.trim();
  const lang = instrumental ? null : detectAfricanLanguage(input.lyrics!);
  const langName = lang ? (LANG_NAME[lang] ?? 'English') : 'English';
  const genre = input.genre.replace(/_/g, ' ');

  if (process.env.STUB_AI === '1') {
    // Deterministic test shape — same coercion path as the real call.
    return finishKit(stubRaw(input, genre), langName);
  }

  // BULK OR NOTHING: no Cerebras on this service = no kit. Callers say "try
  // again" — the paid brains are never touched for promo copy.
  if (!cerebrasEnabled()) {
    throw new ReleaseKitUnavailableError('the bulk brain is not configured on this service');
  }

  const lyricBlock = instrumental
    ? `THE SONG IS AN INSTRUMENTAL (no lyrics) — write about its mood and energy instead.`
    : `LYRICS (the artist's exact words — if you quote a line, quote it VERBATIM, character for character; NEVER paraphrase or invent lyric lines):\n${input.lyrics!.slice(0, 4000)}`;

  const system = `You write the full copy-paste RELEASE KIT for a song by an independent African artist. Return JSON ONLY, exactly this shape:
{
 "story": "2-3 sentences on what the song is about and why it sticks — paste-anywhere, no hashtags",
 "captions": {
   "youtube": "the long post: 2-3 SHORT paragraphs, warm and specific, the description-style caption",
   "tiktok": "one short punchy line (<=200 chars) that makes someone stop scrolling",
   "instagram": "one short clean caption (<=200 chars), a little more aesthetic"
 },
 "hashtags": {
   "tier1_genre": ["#Afrobeats", "..."],          // 2-4 GENRE tags for this exact sound
   "tier2_audience": ["#NewMusic", "..."],         // 2-4 AUDIENCE tags (independent-artist, new-music)
   "tier3_trend": []                                // ONLY tags that GENUINELY fit this song; [] if none. NEVER an unrelated trending tag
 },
 "hook": "one line a creator says over the first seconds of a reel/short",
 "titles": ["10 YouTube titles"],                   // curiosity, NOT clickbait, no ALL CAPS shouting, no fake numbers
 "description": "one YouTube video description — a few lines, natural, no keyword stuffing",
 "artistBio": "2-3 sentence artist bio built from the artist name + genre + this song",
 "releaseCalendar": [ {"day":0,"channel":"YouTube","action":"..."} ],  // 5-7 entries, day 0..6, post when the audience is active, sensible not spammy
 "pinnedComment": "a pinned comment that seeds the thread — human, specific",
 "engagementQuestion": "ONE genuine question that sparks real replies (never 'smash like and subscribe')"
}
Write in ${langName === 'English' ? 'English' : `the same ${langName}/English blend the lyrics use`}.
HUMANIZATION (hard rules): be specific to THIS song — no generic openers ("In a world where…"), no filler ("vibes", "energy", "must-listen") unless a concrete detail backs it, take a point of view, vary the rhythm, and write like a real person who made this record — never like a template. No fake claims: no chart positions, no streaming numbers, no "#1", no invented collaborators.${input.hasVideo ? ' A music video for this song already exists — the calendar should lead with it on day 0.' : ''}`;

  const user = [
    `TITLE: ${input.title}`,
    `ARTIST: ${input.artist}`,
    `GENRE: ${genre}`,
    input.mood ? `MOOD: ${input.mood}` : null,
    input.topic ? `TOPIC: ${input.topic}` : null,
    input.kind && input.kind !== 'song' ? `KIND: ${input.kind}` : null,
    '',
    lyricBlock,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');

  const t0 = Date.now();
  let raw: RawKit;
  try {
    raw = await cerebrasJson<RawKit>({ system, user, maxTokens: 1900 });
    recordLlmUsage({
      tier: 'bulk',
      task: 'release-kit',
      brain: 'cerebras',
      ms: Date.now() - t0,
      estCostUsd: lastCerebrasUsage?.estCostUsd ?? null,
    });
  } catch (err) {
    // Every key failed (rotation already ran inside cerebrasJson). Log the
    // degradation and surface an honest retry — no ladder, no paid brain.
    recordLlmUsage({
      tier: 'bulk',
      task: 'release-kit',
      brain: 'cerebras',
      ms: Date.now() - t0,
      estCostUsd: null,
      degraded: (err as Error).message.slice(0, 160),
    });
    throw new ReleaseKitUnavailableError((err as Error).message.slice(0, 160));
  }
  return finishKit(raw, langName);
}

// ---- Coercion + validation ------------------------------------------------

interface RawKit {
  story?: unknown;
  captions?: { youtube?: unknown; tiktok?: unknown; instagram?: unknown } | unknown;
  hashtags?: { tier1_genre?: unknown; tier2_audience?: unknown; tier3_trend?: unknown } | unknown;
  hook?: unknown;
  titles?: unknown;
  description?: unknown;
  artistBio?: unknown;
  releaseCalendar?: unknown;
  pinnedComment?: unknown;
  engagementQuestion?: unknown;
}

/** A kit missing its core pieces is REFUSED (grounding law: refuse > fabricate),
 *  never padded with filler. tier3 (matched-trend) is allowed to be empty. */
function finishKit(raw: RawKit, language: string): ReleaseKit {
  const cap = (raw.captions ?? {}) as { youtube?: unknown; tiktok?: unknown; instagram?: unknown };
  const captions: KitCaption[] = ([
    { platform: 'youtube', style: 'heartfelt', text: clampBlock(cap.youtube, 900) },
    { platform: 'tiktok', style: 'hype', text: clampLine(cap.tiktok, 220) },
    { platform: 'instagram', style: 'minimal', text: clampLine(cap.instagram, 220) },
  ] as KitCaption[]).filter((c) => c.text.length > 0);

  const hraw = (raw.hashtags ?? {}) as { tier1_genre?: unknown; tier2_audience?: unknown; tier3_trend?: unknown };
  const tier1 = tagList(hraw.tier1_genre, 4);
  const tier2 = tagList(hraw.tier2_audience, 4);
  const tier3 = tagList(hraw.tier3_trend, 3);
  // The paste-ready line: 3-5 usable tags across the tiers, never stuffed.
  const line = [...tier1.slice(0, 2), ...tier2.slice(0, 2), ...tier3.slice(0, 1)].slice(0, 5).join(' ');
  const hashtags: KitHashtags = { tier1, tier2, tier3, line };

  const titles = (Array.isArray(raw.titles) ? raw.titles : [])
    .map((t) => clampLine(t, 100))
    .filter(Boolean)
    .slice(0, 10);

  const releaseCalendar: KitCalendarEntry[] = (Array.isArray(raw.releaseCalendar) ? raw.releaseCalendar : [])
    .map((e) => {
      const row = (e ?? {}) as { day?: unknown; channel?: unknown; action?: unknown };
      const day = Number(row.day);
      return {
        day: Number.isFinite(day) ? Math.max(0, Math.min(30, Math.round(day))) : 0,
        channel: clampLine(row.channel, 40),
        action: clampLine(row.action, 200),
      };
    })
    .filter((e) => e.channel && e.action)
    .slice(0, 7);

  const story = clampLine(raw.story, 600);
  const hook = clampLine(raw.hook, 200);
  const description = clampBlock(raw.description, 1200);
  const artistBio = clampLine(raw.artistBio, 500);
  const pinnedComment = clampLine(raw.pinnedComment, 400);
  const engagementQuestion = clampLine(raw.engagementQuestion, 300);

  // REFUSE > FABRICATE: a kit missing any of its load-bearing pieces is not a
  // kit. tier3 (matched-trend) is intentionally exempt — empty is correct there.
  if (
    !story ||
    captions.length < 3 ||
    tier1.length < 1 ||
    tier2.length < 1 ||
    !line ||
    !hook ||
    titles.length < 8 ||
    !description ||
    !artistBio ||
    releaseCalendar.length < 4 ||
    !pinnedComment ||
    !engagementQuestion
  ) {
    throw new ReleaseKitUnavailableError('the bulk brain returned an incomplete kit');
  }

  return {
    story,
    captions,
    hashtags,
    hook,
    titles,
    description,
    artistBio,
    releaseCalendar,
    pinnedComment,
    engagementQuestion,
    language,
    generatedAt: new Date().toISOString(),
    kind: 'release-kit',
  };
}

/** Deterministic STUB kit — exercises the SAME coercion path as the real call,
 *  so tests assert the real shape without a network or keys. */
function stubRaw(input: ReleaseKitInput, genre: string): RawKit {
  const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  const genreTag = `#${titleCase(genre).replace(/\s+/g, '')}`;
  return {
    story: `"${input.title}" is a ${genre} record by ${input.artist} about holding on to joy when the week has been long. It was built to move a room, not to sit in the background.`,
    captions: {
      youtube: `${input.artist} just dropped "${input.title}".\n\nIt started as one line hummed on the walk home and grew into this — a ${genre} record with room to breathe.\n\nWatch it, turn it up, tell me where you're playing it from.`,
      tiktok: `the first 10 seconds of "${input.title}" and the whole room goes quiet`,
      instagram: `"${input.title}" — out now. Made for late drives and long weekends.`,
    },
    hashtags: {
      tier1_genre: [genreTag, '#AfricanMusic', '#Afrobeats'],
      tier2_audience: ['#NewMusic', '#IndependentArtist', '#NewMusicFriday'],
      tier3_trend: [],
    },
    hook: `POV: "${input.title}" comes on and nobody sits down`,
    titles: [
      `${input.artist} — ${input.title} (Official Audio)`,
      `${input.title} — the song I almost didn't release`,
      `I made "${input.title}" in one night. Here it is.`,
      `${input.artist} · ${input.title} — turn it up`,
      `"${input.title}" — ${genre} that hits different`,
      `The story behind ${input.title}`,
      `${input.title} — ${input.artist} (Visualizer)`,
      `Why "${input.title}" almost didn't make the cut`,
      `${input.title} — first listen`,
      `${input.artist} — ${input.title} | new ${genre}`,
    ],
    description: `"${input.title}" by ${input.artist}. A new ${genre} record.\n\nStream it, save it, and let me know what it makes you feel. More coming soon.`,
    artistBio: `${input.artist} is an independent ${genre} artist writing songs that sound like the walk home after a good night. "${input.title}" is the latest.`,
    releaseCalendar: [
      { day: 0, channel: 'YouTube', action: `Post "${input.title}"${input.hasVideo ? ' — the music video' : ' (audio + cover)'}. Pin the comment.` },
      { day: 1, channel: 'TikTok', action: 'Post the strongest 15s hook clip, captions burned in.' },
      { day: 2, channel: 'Instagram Reels', action: 'Post a second angle of the hook; add the story to your feed caption.' },
      { day: 4, channel: 'TikTok', action: 'Post a behind-the-song clip — how the line came to you.' },
      { day: 6, channel: 'Instagram', action: 'Share the best comment as a story and ask the engagement question.' },
    ],
    pinnedComment: `Made "${input.title}" for anyone who needed it this week. Where are you listening from?`,
    engagementQuestion: `Which line stayed with you after the first listen?`,
  };
}

// ---- The injectable-db writer (shared by worker + API + test) --------------

/** The one kit-lifecycle status the UI reads. */
export type ReleaseKitStatus = 'pending' | 'ready' | 'unavailable';

/** Minimal structural view of the rows writeReleaseKit needs — so it never
 *  imports @afrohit/db and a fake prisma can drive it in tests. */
export interface ReleaseKitDb {
  song: {
    findFirst(args: unknown): Promise<ReleaseKitSongRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  songBrief: {
    findFirst(args: unknown): Promise<{ mood?: string | null; topic?: string | null } | null>;
  };
}

export interface ReleaseKitSongRow {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  displayArtist?: string | null;
  kind?: string | null;
  socialsJson?: unknown;
  socialsUpdatedAt?: Date | null;
  releaseKitStatus?: string | null;
  project?: { genre?: string | null; artist?: { stageName?: string | null } | null } | null;
  lyric?: { title?: string | null; body?: string | null } | null;
}

export interface WriteReleaseKitOptions {
  songId: string;
  /** When set, the song must belong to this workspace or the write is refused
   *  (workspace-scope law). Omit only from a trusted worker path that already
   *  resolved the workspace. */
  workspaceId?: string;
  /** Regenerate even if a fresh kit already exists (the Regenerate button). */
  force?: boolean;
  /** A music video exists — refresh so the calendar leads with it. */
  hasVideo?: boolean;
  /** How fresh a stored kit must be to skip regeneration (ms). Default 6h. */
  freshMs?: number;
  /** Optional logger for the fail-soft path (never throws). */
  log?: (msg: string, err?: unknown) => void;
}

export interface WriteReleaseKitResult {
  status: ReleaseKitStatus | 'skipped' | 'not_found';
  kit?: ReleaseKit;
  updatedAt?: Date;
}

const DEFAULT_FRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Load the song's own materials, build the kit, and STORE it — the exact unit
 * the worker completion hook runs (so the kit lands with NO user action) and the
 * API Regenerate button runs (force). Idempotent: a fresh kit is left alone
 * unless `force`. FAIL-SOFT: a bulk-brain outage sets releaseKitStatus
 * 'unavailable' and returns — it NEVER throws, so a song render is never failed
 * by a kit problem.
 */
export async function writeReleaseKit(
  db: ReleaseKitDb,
  opts: WriteReleaseKitOptions
): Promise<WriteReleaseKitResult> {
  const song = (await db.song.findFirst({
    where: {
      id: opts.songId,
      ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
      deletedAt: null,
    },
    include: {
      project: { select: { genre: true, artist: { select: { stageName: true } } } },
      lyric: true,
    },
  })) as ReleaseKitSongRow | null;

  if (!song) return { status: 'not_found' };

  // IDEMPOTENT — a completion hook that fires twice (retry, or master after a
  // re-sing) must not re-bill the bulk brain when a fresh, ready kit exists.
  const freshMs = opts.freshMs ?? DEFAULT_FRESH_MS;
  const existingIsKit =
    !!song.socialsJson &&
    typeof song.socialsJson === 'object' &&
    (song.socialsJson as { kind?: string }).kind === 'release-kit';
  const existingFresh =
    existingIsKit &&
    song.releaseKitStatus === 'ready' &&
    !!song.socialsUpdatedAt &&
    Date.now() - new Date(song.socialsUpdatedAt).getTime() < freshMs;
  if (existingFresh && !opts.force) {
    return { status: 'skipped', kit: song.socialsJson as ReleaseKit };
  }

  const brief = await db.songBrief.findFirst({
    where: { projectId: song.projectId },
    orderBy: { createdAt: 'desc' },
    select: { mood: true, topic: true },
  });

  const artist = song.displayArtist || song.project?.artist?.stageName || 'the artist';
  const genre = song.project?.genre || 'afrobeats';

  try {
    const kit = await generateReleaseKit({
      title: song.lyric?.title || song.title,
      artist,
      genre,
      mood: brief?.mood ?? null,
      topic: brief?.topic ?? null,
      lyrics: song.lyric?.body ?? null,
      kind: song.kind ?? 'song',
      hasVideo: opts.hasVideo,
    });
    const updatedAt = new Date();
    await db.song.update({
      where: { id: song.id },
      data: { socialsJson: kit as never, socialsUpdatedAt: updatedAt, releaseKitStatus: 'ready' },
    });
    return { status: 'ready', kit, updatedAt };
  } catch (err) {
    // FAIL-SOFT: never throw out of here. Mark the kit unavailable so the tab can
    // say "try again", and leave every other column (the render) untouched.
    opts.log?.('release kit generation failed', err);
    await db.song
      .update({ where: { id: song.id }, data: { releaseKitStatus: 'unavailable' } })
      .catch(() => undefined);
    return { status: 'unavailable' };
  }
}

/** Type guard the API/UI use to tell a full kit from a legacy socials pack. */
export function isReleaseKit(value: unknown): value is ReleaseKit {
  return !!value && typeof value === 'object' && (value as { kind?: string }).kind === 'release-kit';
}

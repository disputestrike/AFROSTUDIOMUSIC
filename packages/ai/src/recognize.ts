/**
 * ZAP — song recognition (the "real Shazam" layer).
 *
 * Fingerprint-identify a song from a short audio clip (mic capture or upload) via
 * AudD (audd.io — a proper music-recognition API), returning the title/artist +
 * a LICENSED 30s preview + platform links. This is IDENTIFICATION + metadata, not
 * ripping: we never download or store the commercial recording. The learn step
 * (see routes/zap.ts) extracts uncopyrightable CRAFT from the identified metadata,
 * never the audio — the streaming-host guard on /analyze already blocks ingesting
 * the recording itself.
 *
 * Activate: set AUDD_API_TOKEN (audd.io). Without it, Zap degrades gracefully.
 */
import { generateJson } from './generate';

export interface SongCraft {
  genre: string;
  craft: string[];
  vibe: string;
  whatToLearn: string;
}

/**
 * Extract the UNCOPYRIGHTABLE CRAFT of an identified/charting song from its
 * METADATA ONLY (never its lyrics or recording) — production techniques, groove,
 * arrangement, hook mechanics, what makes this LANE/era work. The artist is a
 * LANE reference, never to clone. Shared by the Zap button (routes/zap.ts) and the
 * autonomous Zap Radar cron so both learn identically. Returns null on failure.
 */
export async function extractSongCraft(song: {
  title: string;
  artist?: string;
  genre?: string;
  releaseDate?: string;
}): Promise<SongCraft | null> {
  const out = await generateJson<SongCraft>({
    system:
      `You are an A&R / producer studying the CRAFT of records. From a song's METADATA ONLY (title, artist, genre, era — NEVER its lyrics or recording), extract the UNCOPYRIGHTABLE craft worth studying: production techniques, groove/pocket, arrangement moves, hook mechanics, energy, what makes this LANE and era of record work. The artist is a LANE REFERENCE ONLY — never to clone, copy melodies/lyrics, or name in any output. Return facts a producer would study to make THEIR OWN fresh record better, not the song itself. Strict JSON only.`,
    user:
      `Song: "${song.title}" by ${song.artist ?? 'unknown'}${song.genre ? ` (${song.genre})` : ''}${song.releaseDate ? `, released ${song.releaseDate}` : ''}.\n` +
      `Return JSON: { "genre": normalized genre, "craft": [4-6 uncopyrightable production/writing techniques of this lane], "vibe": one line, "whatToLearn": one line on what to apply to OUR songs in this lane }.`,
    temperature: 0.6,
    maxTokens: 900,
  }).catch(() => null);
  return out?.craft?.length ? out : null;
}

/** Chart items arrive as "N. Title — Artist (genre)". Pull out title + artist.
 * Shared by the Zap Radar cron (worker) and the manual radar endpoint (api). */
export function parseTrendSong(sourceTitle: string): { title: string; artist?: string } | null {
  const s = sourceTitle.replace(/^\s*\d+[.)]\s*/, '').trim();
  const parts = s.split(/\s+[—–-]\s+/);
  const title = (parts[0] || '').trim();
  const artist = parts[1] ? parts[1].replace(/\s*\([^)]*\)\s*$/, '').trim() : undefined;
  if (!title || title.length < 2) return null;
  return { title: title.slice(0, 160), artist: artist ? artist.slice(0, 120) : undefined };
}

export interface SongMatch {
  title: string;
  artist: string;
  album?: string;
  releaseDate?: string;
  genre?: string;
  isrc?: string;
  /** A licensed 30s preview (Apple/Spotify/Deezer) — safe to play, never stored. */
  previewUrl?: string;
  links: { song?: string; spotify?: string; apple?: string; deezer?: string };
}

export function auddToken(): string | undefined {
  return process.env.AUDD_API_TOKEN || process.env.AUDD_TOKEN || undefined;
}

interface AuddResp {
  status: string;
  error?: { error_message?: string };
  result?: {
    artist?: string;
    title?: string;
    album?: string;
    release_date?: string;
    song_link?: string;
    apple_music?: { url?: string; genreNames?: string[]; previews?: Array<{ url?: string }> };
    spotify?: { preview_url?: string; external_urls?: { spotify?: string }; external_ids?: { isrc?: string } };
    deezer?: { link?: string; preview?: string };
  } | null;
}

/**
 * Identify a song from a PUBLIC audio URL (the artist's uploaded/captured clip on
 * our own storage). Returns the match (or null = no match), or a clear error.
 */
export async function recognizeSong(opts: {
  url: string;
  apiKey?: string;
}): Promise<{ ok: true; match: SongMatch | null } | { ok: false; error: string; hint?: string }> {
  const token = opts.apiKey || auddToken();
  if (!token) {
    return {
      ok: false,
      error: 'recognition_not_configured',
      hint: 'Zap needs a music-recognition key — set AUDD_API_TOKEN (from audd.io) on the API + worker.',
    };
  }
  const body = new URLSearchParams({ api_token: token, url: opts.url, return: 'apple_music,spotify,deezer' });
  let data: AuddResp;
  try {
    const res = await fetch('https://api.audd.io/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return { ok: false, error: `recognition_provider_${res.status}` };
    data = (await res.json()) as AuddResp;
  } catch (err) {
    return { ok: false, error: `recognition_failed: ${(err as Error)?.message ?? 'network'}` };
  }
  if (data.status !== 'success') {
    return { ok: false, error: data.error?.error_message ?? 'recognition_failed' };
  }
  const r = data.result;
  if (!r || !r.title) return { ok: true, match: null }; // clean "no match" — heard nothing recognizable
  const apple = r.apple_music;
  const spotify = r.spotify;
  const deezer = r.deezer;
  const match: SongMatch = {
    title: r.title,
    artist: r.artist ?? 'Unknown',
    album: r.album || undefined,
    releaseDate: r.release_date || undefined,
    genre: apple?.genreNames?.find((g) => g && g.toLowerCase() !== 'music') || undefined,
    isrc: spotify?.external_ids?.isrc || undefined,
    previewUrl: apple?.previews?.[0]?.url || spotify?.preview_url || deezer?.preview || undefined,
    links: {
      song: r.song_link || undefined,
      spotify: spotify?.external_urls?.spotify || undefined,
      apple: apple?.url || undefined,
      deezer: deezer?.link || undefined,
    },
  };
  return { ok: true, match };
}

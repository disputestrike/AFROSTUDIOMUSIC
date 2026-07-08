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

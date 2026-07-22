import { prisma } from "@afrohit/db";
import { transcribeAudio } from "@afrohit/ai";
import { downloadToBuffer } from "./storage";

/**
 * LYRICS-ON-IMPORT (owner 2026-07-22). A bring-your-own / imported song arrives
 * with NO lyric, so the video director has no words to anchor scenes and B-roll
 * to — that is why "Lead Me" got gibberish "app-mockup" shots instead of the
 * "blue tick / left on read" story. When a mastered song still has no lyric,
 * transcribe its audio into a LyricDraft so the treatment (which reads
 * song.lyric) can ground every scene in the real words.
 *
 * Contract:
 *  - BEST-EFFORT: transcription failure (no ASR key, an instrumental, a mumble)
 *    leaves the song lyric-less exactly as before — it NEVER fails the master.
 *  - ONLY when missing: a song that already has a lyric (every AI-written song)
 *    is left untouched, so we never clobber real words with a machine transcript.
 *  - RIGHTS-CLEAN: the user uploaded their own recording; transcribing their own
 *    performance into their own catalog is theirs to do.
 *  - artistAuthored:true — their words are law; the will-it-blow / make-it-bigger
 *    gates may SCORE this lyric but must never rewrite it.
 */
export async function maybeTranscribeImportedLyric(opts: {
  songId: string;
  /** The finished (mastered) audio URL to transcribe. */
  audioUrl: string;
}): Promise<{ created: boolean; reason?: string }> {
  try {
    const song = await prisma.song.findUnique({
      where: { id: opts.songId },
      select: { id: true, projectId: true, lyricId: true, title: true },
    });
    if (!song) return { created: false, reason: "song_not_found" };
    if (song.lyricId) return { created: false, reason: "already_has_lyric" };

    // OpenAI Whisper transcribes from BYTES; Replicate from a URL. Supply both so
    // whichever provider is configured runs. A mastered mp3 is small — cheap.
    let bytes: Uint8Array | undefined;
    if (process.env.OPENAI_API_KEY) {
      bytes = await downloadToBuffer(opts.audioUrl, { maxBytes: 64 * 1024 * 1024 }).catch(
        () => undefined
      );
    }
    const transcription = await transcribeAudio({
      url: opts.audioUrl,
      bytes,
      filename: "import.mp3",
    });
    const body = transcription?.text?.trim();
    // A couple of words is not a lyric (an instrumental transcribes to noise or
    // near-nothing). Require enough text to be a real lyric before we file it.
    if (!body || body.length < 12) return { created: false, reason: "no_usable_transcript" };

    const lyric = await prisma.lyricDraft.create({
      data: {
        projectId: song.projectId,
        songId: song.id,
        ...(song.title ? { title: song.title } : {}),
        body,
        artistAuthored: true,
      },
    });
    await prisma.song.update({ where: { id: song.id }, data: { lyricId: lyric.id } });
    return { created: true };
  } catch (err) {
    return { created: false, reason: (err as Error).message?.slice(0, 120) };
  }
}

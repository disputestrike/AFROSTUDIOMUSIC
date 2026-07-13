/**
 * SING-CONVERT — run the trained voice over an existing track (voice queue).
 *
 * Calls singWithVoice (@afrohit/ai — zsxkib/realistic-voice-cloning): the model
 * separates the input's vocal, converts it with the artist's trained RVC model,
 * and remixes it over the instrumental. HONEST: the voice sings whatever the
 * INPUT sings — RVC converts a performance, it does not invent one; melody +
 * timing come from the input vocal (or the melody guide the artist hums).
 *
 * The result is re-hosted to our bucket; when the source was a song, it's filed
 * as a VocalRender (role 'lead', approved) AND a Mix row — so the sung version
 * becomes the song's freshest playable/downloadable audio in the catalog.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSecret, prisma } from '@afrohit/db';
import { singWithVoice, type SingPitchChange, type SingTuning } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { downloadToBuffer, resolveAssetForProvider, uploadBytes } from '../lib/storage';
import { probeDurationS } from '../lib/ffmpeg';

interface SingConvertPayload {
  jobId: string;
  workspaceId: string;
  voiceProfileId: string;
  /** Trained RVC model file URL (resolved by the API from the VoiceProfile). */
  modelUrl: string;
  /** The performance to convert — full song or bare vocal. */
  songInputUrl: string;
  pitchChange?: SingPitchChange;
  tuning?: SingTuning;
  songId?: string;
  projectId?: string;
}

export async function processSingConvert(p: SingConvertPayload) {
  await markRunning(p.jobId);
  const dir = await mkdtemp(join(tmpdir(), 'sing-'));
  try {
    // Workspace-pasted Replicate key (Settings → Music engine) overrides env —
    // same lookup pattern as the music/stems processors.
    const ws = await prisma.workspace.findUnique({
      where: { id: p.workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const replicateApiKey = ws?.musicProvider === 'replicate' ? openSecret(ws.musicApiKey) : undefined;
    const { url, predictionId } = await singWithVoice({
      songInputUrl: await resolveAssetForProvider(p.songInputUrl),
      modelUrl: await resolveAssetForProvider(p.modelUrl),
      pitchChange: p.pitchChange,
      tuning: p.tuning,
      apiKey: replicateApiKey,
    });

    // Re-host — Replicate output URLs expire; ours don't.
    const bytes = await downloadToBuffer(url);
    const storedUrl = await uploadBytes({
      workspaceId: p.workspaceId,
      kind: 'vocals',
      bytes,
      contentType: 'audio/wav',
      ext: 'wav',
    });
    const localPath = join(dir, 'out.wav');
    await writeFile(localPath, bytes);
    const durationS = await probeDurationS(localPath); // 0 = unknown, never fatal

    if (p.songId && p.projectId) {
      await prisma.vocalRender.create({
        data: {
          projectId: p.projectId,
          songId: p.songId,
          voiceProfileId: p.voiceProfileId,
          role: 'lead',
          url: storedUrl,
          duration: durationS || undefined,
          approved: true,
          meta: {
            ownVoiceSing: true,
            pitchChange: p.pitchChange ?? 'no-change',
            // HONESTY: this file is the FULL remixed song (converted vocal over
            // the input's instrumental), and the performance is the input's —
            // the trained voice sang what the input sang.
            fullRemix: true,
            convertedFromInput: true,
          } as never,
        },
      });
      // A Mix row makes it the song's freshest playable audio (master → mix →
      // beat recency rule) — playable + downloadable from the catalog.
      await prisma.mix.create({
        data: {
          projectId: p.projectId,
          songId: p.songId,
          preset: 'own-voice',
          url: storedUrl,
          approved: true,
          notes: 'Own voice sing — trained voice converted over the existing performance (RVC).',
        },
      });
    }

    // Cost estimate: T4-class GPU for a few minutes (~$0.000225/s) — honest
    // ballpark until Replicate reports real run costs.
    await markSucceeded(
      p.jobId,
      { url: storedUrl, durationS, predictionId, pitchChange: p.pitchChange ?? 'no-change', filedToSong: !!(p.songId && p.projectId) },
      0.15
    );
  } catch (err) {
    await markFailed(p.jobId, err);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

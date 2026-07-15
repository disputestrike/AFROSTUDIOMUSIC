import { openSecret, prisma } from '@afrohit/db';
import { materializeStemAudio, separateStemsRouted } from '../lib/demucs-local';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer, uploadBytes } from '../lib/storage';
import { encodeMp3320, ffmpegAvailable, loudnessMatchToSource, measureAudioQuality, transformAudio } from '../lib/ffmpeg';
import { inspectMaterialAudio } from '../lib/material-inspection';

interface StemsPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  /** Absent on auto-harvest jobs (they're beat-scoped, no song attached). */
  songId?: string;
  beatId?: string;
  /** 'instrumental' | 'acapella' = TRUE INSTRUMENTAL path (finished song minus
   *  voice, loudness-matched); 'full' | 'stems' = harvest/remix four-way split. */
  mode?: 'instrumental' | 'acapella' | 'full' | 'stems';
  /** Override the audio to separate (e.g. a specific VERSION's master URL) — defaults to the freshest audio. */
  sourceUrl?: string;
  /** The API route vouches this audio is the ARTIST'S OWN (finished-song upload/
   *  import bridge). Beat-less harvests carry provenance HERE — there is no beat
   *  row whose uploaded/imported flags could prove it. */
  owned?: boolean;
}

/**
 * Stem separation, two distinct jobs behind one queue name:
 *
 *  - TRUE INSTRUMENTAL / ACAPELLA ('instrumental' | 'acapella'): the owner's law
 *    — "take out the voice and keep EVERYTHING else, same quality". Separates
 *    the FINISHED song (freshest master → mix → beat: exactly what the user
 *    hears, never the raw pre-vocal beat), prefers local htdemucs (lossless WAV
 *    out; the paid path re-encodes), loudness-matches both halves back to the
 *    source's measured LUFS, and ships WAV + true-320k mp3 with honest labels.
 *  - HARVEST / REMIX ('full' | 'stems'): four-way split re-hosted as Stem rows +
 *    MaterialAssets so the mixer can remix and the arranger can reuse. Unchanged.
 */
export async function processStems(p: StemsPayload) {
  await markRunning(p.jobId);
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: p.workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const replicateApiKey = ws?.musicProvider === 'replicate' ? openSecret(ws.musicApiKey) : undefined;
    // A FINISHED-SONG harvest (the mixes /upload bridge, /import kind=song) has
    // NO beat row — the record lives as a Mix. The split still runs off the
    // payload's sourceUrl; only the beat-attached Stem rows get skipped below.
    const beat = p.beatId
      ? await prisma.beatAsset.findFirstOrThrow({ where: { id: p.beatId } })
      : await prisma.beatAsset.findFirst({ where: { songId: p.songId }, orderBy: { createdAt: 'desc' } });

    const mode = p.mode ?? 'instrumental';
    if (mode === 'instrumental' || mode === 'acapella') {
      // Stem rows are beat-scoped — this path cannot run without one. Fail with
      // the real reason, never a silent no-op.
      if (!beat) throw new Error('instrumental/acapella needs a beat row to attach stems to — none found for this song');
      await processTrueInstrumental(p, beat, replicateApiKey, mode);
      return;
    }

    // ---- HARVEST / REMIX PATH ('full' | 'stems') — behavior preserved ----
    // Separate the requested version's audio when given (per-version instrumental),
    // else the beat. Result stems still attach to the beat row for download/remix.
    // A3-4: user-facing stems stay on the fast paid path by default; DEMUCS_MODE=local forces local.
    const sepSource = p.sourceUrl || beat?.url;
    if (!sepSource) throw new Error('nothing to separate — no sourceUrl in the payload and no beat on this song');
    const result = await separateStemsRouted({ audioUrl: sepSource, apiKey: replicateApiKey, mode: 'full', purpose: 'user', workspaceId: p.workspaceId });
    if (!result.stems.length) throw new Error('stem separation returned no audio');

    // Sniff and re-host sequentially so four lossless stems cannot all occupy
    // worker memory at once. The byte signature, not the provider label, decides
    // extension, MIME, and the Stem.format value.
    const ingested: Awaited<ReturnType<typeof materializeStemAudio>>[] = [];
    try {
      for (const stem of result.stems) {
        ingested.push(await materializeStemAudio({ workspaceId: p.workspaceId, stem }));
      }
    } catch (error) {
      await Promise.allSettled(ingested.map((stem) => deleteObjectByUrl(stem.url)));
      throw error;
    } finally {
      await Promise.allSettled(result.stems.map((stem) => deleteObjectByUrl(stem.url)));
    }
    const roles = ingested.map((s) => s.role);
    // Replace any prior separated stems of the same roles so re-runs don't pile up.
    // Beat-less (finished-song) harvests skip this — Stem rows need a beat FK; the
    // MaterialAsset filing below is the whole point of that harvest.
    if (beat) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.stem.deleteMany({ where: { beatId: beat.id, role: { in: roles } } });
          await Promise.all(
            ingested.map((s) =>
              tx.stem.create({ data: { beatId: beat.id, role: s.role, url: s.url, format: s.format } }),
            ),
          );
        });
      } catch (error) {
        await Promise.allSettled(ingested.map((stem) => deleteObjectByUrl(stem.url)));
        throw error;
      }
    }

    // MATERIAL HARVEST: the artist's own non-vocal stems join the material
    // library — real, owned audio the arranger can place into future beats.
    const project = await prisma.project.findUnique({ where: { id: p.projectId }, select: { genre: true } });
    // A stripped full INSTRUMENTAL is filed under its own 'instrumental' role (was
    // 'other', which orphaned it) so the Instrumental Library can find + reuse it.
    const ROLE_MAP: Record<string, string> = { drums: 'drums', bass: 'bass', instrumental: 'instrumental' };
    // TRUE PROVENANCE (audit DANGEROUS): only a beat the ARTIST uploaded/imported
    // yields rights-clean 'artist_stem' material. Stems split from a PROVIDER
    // render (Suno/MiniMax/etc.) are 'provider_stem' — never mislabel a
    // third-party generation as the artist's own owned material. Beat-less
    // finished-song harvests carry the route's vouch in p.owned instead.
    const beatMetaP = (beat?.meta ?? {}) as { uploaded?: boolean; imported?: boolean };
    const isOwned = p.owned === true || beatMetaP.uploaded === true || beatMetaP.imported === true || beat?.provider === 'upload' || beat?.provider === 'import';
    const stemSource = isOwned ? 'artist_stem' : 'provider_stem';
    const retainedMaterialUrls = new Set<string>();
    for (const stem of ingested.filter((item) => item.role !== 'vocals')) {
      try {
        const role = ROLE_MAP[stem.role];
        if (!role) {
          console.warn(`[stems] ${stem.role} is a mixed stem, not evidence of a specific instrument role; kept for remix only`);
          continue;
        }
        const bytes = await downloadToBuffer(stem.url);
        const inspection = await inspectMaterialAudio({
          bytes,
          url: stem.url,
          role,
          roleEvidence: 'stem-separated',
          deep: beat?.bpm == null || beat?.keySignature == null,
        });
        if (inspection.readiness !== 'ready') {
          console.warn(`[stems] ${role} kept as a stem but not admitted to material shelf: ${inspection.reasons.join(', ') || 'unmeasured'}`);
          continue;
        }
        const duplicate = await prisma.materialAsset.findFirst({
          where: { workspaceId: p.workspaceId, contentHash: inspection.contentHash },
          select: { id: true, role: true },
        });
        if (duplicate) {
          if (duplicate.role !== role) {
            console.warn(`[stems] duplicate audio ${duplicate.id} already filed as ${duplicate.role}; refusing ${role} relabel`);
          }
          continue;
        }
        await prisma.materialAsset.create({
          data: {
            workspaceId: p.workspaceId,
            kind: 'stem',
            role,
            genre: project?.genre ?? null,
            bpm: beat?.bpm ?? inspection.detectedBpm ?? null,
            keySignature: beat?.keySignature ?? inspection.detectedKey ?? null,
            durationS: beat?.duration ?? inspection.qc?.durationS ?? null,
            url: stem.url,
            source: stemSource,
            readiness: inspection.readiness,
            qualityState: inspection.qualityState,
            roleEvidence: 'stem-separated',
            rightsBasis: isOwned ? 'user-attested' : 'provider-generated',
            contentHash: inspection.contentHash,
            verifiedAt: inspection.verifiedAt,
            meta: {
              fromBeatId: beat?.id ?? null,
              fromSongId: p.songId,
              fromSourceUrl: p.sourceUrl ?? beat?.url ?? null,
              stemRole: stem.role,
              provider: beat?.provider ?? null,
              owned: isOwned,
              qc: inspection.qc,
              rightsBasis: isOwned ? 'user-attested' : 'provider-generated',
            } as never,
          },
        });
        retainedMaterialUrls.add(stem.url);
      } catch (err) {
        console.warn('[stems] material harvest failed:', (err as Error)?.message);
      }
    }

    // Beat-less harvests have no Stem rows. Keep only objects admitted as
    // materials; delete vocals, mixed-other, failed-QC, and duplicate uploads.
    if (!beat) {
      await Promise.all(
        ingested
          .filter((stem) => !retainedMaterialUrls.has(stem.url))
          .map((stem) => deleteObjectByUrl(stem.url).catch(() => {})),
      );
    }

    await markSucceeded(p.jobId, {
      beatId: beat?.id ?? null,
      stems: ingested.length,
      instrumental: ingested.some((s) => s.role === 'instrumental'),
      roles,
    });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}

type BeatRow = { id: string; url: string; createdAt: Date; bpm: number | null; keySignature: string | null; duration: number | null; provider: string; meta: unknown };

/**
 * TRUE INSTRUMENTAL / ACAPELLA — separate what the user actually HEARS.
 *   source = explicit override → freshest master → mix → beat (mirror of the
 *   catalog's freshestAudioUrl; the raw pre-vocal beat is only the last resort).
 * Both halves come back loudness-matched to the source's own integrated LUFS,
 * uploaded as WAV (Stem rows) + true 320k mp3 (Song.instrumentalUrl/acapellaUrl).
 */
async function processTrueInstrumental(p: StemsPayload, beat: BeatRow, apiKey: string | undefined, mode: 'instrumental' | 'acapella') {
  if (!p.songId) throw new Error('instrumental/acapella jobs are song-scoped — payload has no songId');
  if (!(await ffmpegAvailable())) {
    throw new Error('ffmpeg binary not found on worker host — install ffmpeg (Railway nixpacks includes it)');
  }

  // (a) The source is what the user HEARS: newest of master → mix → beat.
  const [master, mix] = await Promise.all([
    prisma.master.findFirst({ where: { songId: p.songId }, orderBy: { createdAt: 'desc' }, select: { url: true, createdAt: true } }),
    prisma.mix.findFirst({ where: { songId: p.songId }, orderBy: { createdAt: 'desc' }, select: { url: true, createdAt: true } }),
  ]);
  const cands = [master, mix, beat].filter(Boolean) as Array<{ url: string; createdAt: Date }>;
  cands.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const sourceUrl = p.sourceUrl || cands[0]!.url;

  // (b) Measure the source's integrated loudness — the match target. A null read
  // (undecodable/silent) skips the match honestly rather than inventing a level.
  const sourceQc = await measureAudioQuality(sourceUrl).catch(() => null);
  const sourceLufs = sourceQc?.integratedLufs ?? null;

  // (c) Separate — local htdemucs first (lossless WAV out), paid path as fallback.
  const result = await separateStemsRouted({ audioUrl: sourceUrl, apiKey, mode: 'instrumental', purpose: 'user', workspaceId: p.workspaceId, preferLocal: true });
  const instrumentalRaw = result.instrumentalUrl ?? result.stems.find((s) => s.role === 'instrumental')?.url;
  const vocalsRaw = result.stems.find((s) => s.role === 'vocals')?.url;
  if (!instrumentalRaw) throw new Error(`stem separation did not return an instrumental (got: ${result.stems.map((s) => s.role).join(', ') || 'nothing'})`);
  if (mode === 'acapella' && !vocalsRaw) throw new Error('stem separation did not return a vocals stem');

  // (d) Loudness-match each half to the source and ship WAV + true 320k mp3.
  const renderPair = async (rawUrl: string) => {
    const bytes = await downloadToBuffer(rawUrl);
    // No measurable source loudness → still normalize the container to WAV
    // (anull transform), just without a fabricated loudness target.
    const wav = sourceLufs !== null ? await loudnessMatchToSource(bytes, sourceLufs) : await transformAudio(bytes, {});
    const mp3 = await encodeMp3320(wav);
    const [wavUrl, mp3Url] = await Promise.all([
      uploadBytes({ workspaceId: p.workspaceId, kind: 'stems', bytes: wav, contentType: 'audio/wav', ext: 'wav' }),
      uploadBytes({ workspaceId: p.workspaceId, kind: 'stems', bytes: mp3, contentType: 'audio/mpeg', ext: 'mp3' }),
    ]);
    return { wavUrl, mp3Url };
  };
  const instrumental = await renderPair(instrumentalRaw);
  const vocals = vocalsRaw ? await renderPair(vocalsRaw) : null;

  // Certify what shipped: measure the matched instrumental, not the intent.
  const matchedQc = await measureAudioQuality(instrumental.wavUrl).catch(() => null);
  const matchedLufs = matchedQc?.integratedLufs ?? null;

  // (e) Persist: Stem rows carry the WAV with its REAL format (the old path
  // stamped ext:'mp3' on whatever came back — the mislabel this rewrite kills).
  const roles = ['instrumental', ...(vocals ? ['vocals'] : [])];
  await prisma.stem.deleteMany({ where: { beatId: beat.id, role: { in: roles } } });
  await prisma.$transaction([
    prisma.stem.create({ data: { beatId: beat.id, role: 'instrumental', url: instrumental.wavUrl, format: 'wav' } }),
    ...(vocals ? [prisma.stem.create({ data: { beatId: beat.id, role: 'vocals', url: vocals.wavUrl, format: 'wav' } })] : []),
  ]);

  const song = await prisma.song.findUnique({ where: { id: p.songId }, select: { title: true, lyric: { select: { title: true } } } });
  await prisma.song.update({
    where: { id: p.songId },
    data: {
      instrumentalUrl: instrumental.mp3Url,
      acapellaUrl: vocals?.mp3Url ?? null,
      instrumentalMeta: {
        sourceUrl,
        sourceLufs,
        matchedLufs,
        engine: result.engine ?? 'unknown',
        format: 'wav+mp3',
        at: new Date().toISOString(),
      } as never,
    },
  });

  // File the instrumental in the material library too — same provenance law as
  // the harvest path (a provider render never masquerades as owned material).
  const project = await prisma.project.findUnique({ where: { id: p.projectId }, select: { genre: true } });
  const beatMeta = (beat.meta ?? {}) as { uploaded?: boolean; imported?: boolean };
  const owned = beatMeta.uploaded === true || beatMeta.imported === true || beat.provider === 'upload' || beat.provider === 'import';
  try {
    const instrumentalBytes = await downloadToBuffer(instrumental.wavUrl);
    const inspection = await inspectMaterialAudio({
      bytes: instrumentalBytes,
      url: instrumental.wavUrl,
      role: 'instrumental',
      roleEvidence: 'stem-separated',
      deep: beat.bpm == null || beat.keySignature == null,
    });
    if (inspection.readiness === 'ready') {
      const duplicate = await prisma.materialAsset.findFirst({
        where: { workspaceId: p.workspaceId, contentHash: inspection.contentHash },
        select: { id: true },
      });
      if (!duplicate) {
        await prisma.materialAsset.create({
          data: {
            workspaceId: p.workspaceId,
            kind: 'stem',
            role: 'instrumental',
            genre: project?.genre ?? null,
            bpm: beat.bpm ?? inspection.detectedBpm ?? null,
            keySignature: beat.keySignature ?? inspection.detectedKey ?? null,
            durationS: beat.duration ?? inspection.qc?.durationS ?? null,
            url: instrumental.wavUrl,
            source: owned ? 'artist_stem' : 'provider_stem',
            readiness: inspection.readiness,
            qualityState: inspection.qualityState,
            roleEvidence: 'stem-separated',
            rightsBasis: owned ? 'user-attested' : 'provider-generated',
            contentHash: inspection.contentHash,
            verifiedAt: inspection.verifiedAt,
            meta: {
              fromSongId: p.songId,
              fromSongTitle: song?.lyric?.title || song?.title,
              fromSourceUrl: sourceUrl,
              matchedLufs,
              format: 'wav',
              qc: inspection.qc,
              rightsBasis: owned ? 'user-attested' : 'provider-generated',
            } as never,
          },
        });
      }
    } else {
      console.warn(`[stems] instrumental not admitted to reusable shelf: ${inspection.reasons.join(', ') || 'unmeasured'}`);
    }
  } catch (err) {
    console.warn('[stems] instrumental material filing failed:', (err as Error)?.message);
  }

  await markSucceeded(p.jobId, {
    beatId: beat.id,
    mode,
    sourceUrl,
    sourceLufs,
    matchedLufs,
    engine: result.engine ?? 'unknown',
    instrumentalUrl: instrumental.mp3Url,
    acapellaUrl: vocals?.mp3Url ?? null,
    stems: roles.length,
    instrumental: true,
    roles,
  });
}

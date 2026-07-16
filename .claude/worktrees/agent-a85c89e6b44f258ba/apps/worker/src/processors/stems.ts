import { openSecret, prisma } from "@afrohit/db";
import { materializeStemAudio, separateStemsRouted } from "../lib/demucs-local";
import { markFailed, markRunning, markSucceeded } from "../lib/jobs";
import { deleteObjectByUrl, downloadToBuffer } from "../lib/storage";
import {
  encodeMp3320,
  ffmpegAvailable,
  loudnessMatchToSource,
  measureAudioQuality,
  transformAudio,
} from "../lib/ffmpeg";
import {
  certifyAudioBytes,
  type CertifiedAudio,
} from "../lib/certified-assets";
import { deleteUnreferencedAssetRefs } from "./asset-cleanup";
import { inspectMaterialAudio } from "../lib/material-inspection";

interface StemsPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  /** Absent on auto-harvest jobs (they're beat-scoped, no song attached). */
  songId?: string;
  beatId?: string;
  /** 'instrumental' | 'acapella' = TRUE INSTRUMENTAL path (finished song minus
   *  voice, loudness-matched); 'full' | 'stems' = harvest/remix four-way split. */
  mode?: "instrumental" | "acapella" | "full" | "stems";
  /** Override the audio to separate (e.g. a specific VERSION's master URL) — defaults to the freshest audio. */
  sourceUrl?: string;
  /** The API route vouches this audio is the ARTIST'S OWN (finished-song upload/
   *  import bridge). Beat-less harvests carry provenance HERE — there is no beat
   *  row whose uploaded/imported flags could prove it. */
  owned?: boolean;
  /** SELF-FEEDING LIBRARY (music.ts promotion gate): this audio is a song the
   *  STUDIO ITSELF created and promoted — not an artist upload, not a raw
   *  provider render being mislabeled. Harvested stems file as source
   *  'self_stem' / rightsBasis 'self-generated'. LEGAL BOUNDARY: only the
   *  worker's own render path sets this flag on its own masters; external
   *  audio never carries it. */
  selfHarvest?: boolean;
}

type CertifiedStem = Awaited<ReturnType<typeof materializeStemAudio>> & {
  certification: CertifiedAudio;
};
type StemUrlRow = { url: string };

export function audioCertificationReceipt(audio: CertifiedAudio) {
  return {
    url: audio.url,
    contentHash: audio.contentHash,
    qualityState: audio.qualityState,
    verifiedAt: audio.verifiedAt.toISOString(),
    durationS: audio.qc.durationS,
    qc: audio.qc,
  };
}

async function retireSupersededAudio(
  workspaceId: string,
  refs: string[]
): Promise<void> {
  if (!refs.length) return;
  try {
    await deleteUnreferencedAssetRefs(workspaceId, refs);
  } catch (error) {
    console.warn(
      "[stems] superseded audio retained for cleanup:",
      (error as Error)?.message
    );
  }
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
    const replicateApiKey =
      ws?.musicProvider === "replicate"
        ? openSecret(ws.musicApiKey)
        : undefined;
    // A FINISHED-SONG harvest (the mixes /upload bridge, /import kind=song) has
    // NO beat row — the record lives as a Mix. The split still runs off the
    // payload's sourceUrl; only the beat-attached Stem rows get skipped below.
    const beat = p.beatId
      ? await prisma.beatAsset.findFirstOrThrow({
          where: {
            id: p.beatId,
            projectId: p.projectId,
            project: { workspaceId: p.workspaceId },
            ...(p.songId ? { songId: p.songId } : {}),
          },
        })
      : p.songId
        ? await prisma.beatAsset.findFirst({
            where: {
              songId: p.songId,
              projectId: p.projectId,
              project: { workspaceId: p.workspaceId },
            },
            orderBy: { createdAt: "desc" },
          })
        : null;

    const mode = p.mode ?? "instrumental";
    if (mode === "instrumental" || mode === "acapella") {
      // Stem rows are beat-scoped — this path cannot run without one. Fail with
      // the real reason, never a silent no-op.
      if (!beat)
        throw new Error(
          "instrumental/acapella needs a beat row to attach stems to — none found for this song"
        );
      await processTrueInstrumental(p, beat, replicateApiKey, mode);
      return;
    }

    // ---- HARVEST / REMIX PATH ('full' | 'stems') — behavior preserved ----
    // Separate the requested version's audio when given (per-version instrumental),
    // else the beat. Result stems still attach to the beat row for download/remix.
    // A3-4: user-facing stems stay on the fast paid path by default; DEMUCS_MODE=local forces local.
    const sepSource = p.sourceUrl?.trim() || beat?.url;
    if (!sepSource)
      throw new Error(
        "nothing to separate: no exact sourceUrl or selected beat audio"
      );
    const sourceLineage = {
      version: "stem-source-v1",
      jobId: p.jobId,
      sourceUrl: sepSource,
      sourceBeatId: beat?.id ?? null,
      requestedBeatId: p.beatId ?? null,
      explicitSourceUrl: Boolean(p.sourceUrl),
    };
    const result = await separateStemsRouted({
      audioUrl: sepSource,
      apiKey: replicateApiKey,
      mode: "full",
      purpose: "user",
      workspaceId: p.workspaceId,
    });
    if (!result.stems.length)
      throw new Error("stem separation returned no audio");

    // Every persisted stem is byte-certified after container sniffing. A weak,
    // failed, or unmeasured output aborts the complete job before row replacement.
    const ingested: CertifiedStem[] = [];
    try {
      for (const stem of result.stems) {
        let materialized: Awaited<
          ReturnType<typeof materializeStemAudio>
        > | null = null;
        try {
          materialized = await materializeStemAudio({
            workspaceId: p.workspaceId,
            stem,
          });
          const bytes = await downloadToBuffer(materialized.url);
          const certification = await certifyAudioBytes({
            workspaceId: p.workspaceId,
            kind: "stems",
            bytes,
            contentType: materialized.contentType,
            ext: materialized.format,
          });
          ingested.push({
            ...materialized,
            url: certification.url,
            certification,
          });
        } finally {
          if (materialized)
            await deleteObjectByUrl(materialized.url).catch(() => undefined);
        }
      }
    } catch (error) {
      await Promise.allSettled(
        ingested.map(stem => deleteObjectByUrl(stem.url))
      );
      throw error;
    } finally {
      await Promise.allSettled(
        result.stems.map(stem => deleteObjectByUrl(stem.url))
      );
    }
    const roles = ingested.map(stem => stem.role);
    let supersededStemRefs: string[] = [];

    // Delete + create + certification-lineage receipt is one database commit.
    // Old objects are retired only after that commit and only when unreferenced.
    if (beat) {
      const oldStems = (await prisma.stem.findMany({
        where: { beatId: beat.id, role: { in: roles } },
        select: { url: true },
      })) as StemUrlRow[];
      try {
        await prisma.$transaction([
          prisma.stem.deleteMany({
            where: { beatId: beat.id, role: { in: roles } },
          }),
          ...ingested.map(stem =>
            prisma.stem.create({
              data: {
                beatId: beat.id,
                role: stem.role,
                url: stem.url,
                format: stem.format,
                duration: stem.certification.qc.durationS,
              },
            })
          ),
          prisma.beatAsset.update({
            where: { id: beat.id },
            data: {
              meta: {
                ...((beat.meta ?? {}) as Record<string, unknown>),
                stemCertification: {
                  sourceLineage,
                  engine: result.engine ?? "unknown",
                  at: new Date().toISOString(),
                  stems: ingested.map(stem => ({
                    role: stem.role,
                    format: stem.format,
                    ...audioCertificationReceipt(stem.certification),
                  })),
                },
              } as never,
            },
          }),
        ]);
        supersededStemRefs = oldStems.map(stem => stem.url);
      } catch (error) {
        await Promise.allSettled(
          ingested.map(stem => deleteObjectByUrl(stem.url))
        );
        throw error;
      }
    }
    // MATERIAL HARVEST: the artist's own non-vocal stems join the material
    // library — real, owned audio the arranger can place into future beats.
    const project = await prisma.project.findUnique({
      where: { id: p.projectId },
      select: { genre: true },
    });
    // A stripped full INSTRUMENTAL is filed under its own 'instrumental' role (was
    // 'other', which orphaned it) so the Instrumental Library can find + reuse it.
    const ROLE_MAP: Record<string, string> = {
      drums: "drums",
      bass: "bass",
      instrumental: "instrumental",
    };
    // TRUE PROVENANCE (audit DANGEROUS): only a beat the ARTIST uploaded/imported
    // yields rights-clean 'artist_stem' material. Stems split from a PROVIDER
    // render (Suno/MiniMax/etc.) are 'provider_stem' — never mislabel a
    // third-party generation as the artist's own owned material. Beat-less
    // finished-song harvests carry the route's vouch in p.owned instead.
    const beatMetaP = (beat?.meta ?? {}) as {
      uploaded?: boolean;
      imported?: boolean;
    };
    const isOwned =
      p.owned === true ||
      beatMetaP.uploaded === true ||
      beatMetaP.imported === true ||
      beat?.provider === "upload" ||
      beat?.provider === "import";
    // 'self_stem' = the studio harvesting ITS OWN promoted song (see
    // StemsPayload.selfHarvest) — honest third provenance, never a relabel of
    // artist uploads (artist_stem) or raw provider renders (provider_stem).
    const stemSource = p.selfHarvest
      ? "self_stem"
      : isOwned
        ? "artist_stem"
        : "provider_stem";
    const stemRightsBasis = p.selfHarvest
      ? "self-generated"
      : isOwned
        ? "user-attested"
        : "provider-generated";
    const retainedMaterialUrls = new Set<string>();
    for (const stem of ingested.filter(item => item.role !== "vocals")) {
      try {
        const role = ROLE_MAP[stem.role];
        if (!role) {
          console.warn(
            `[stems] ${stem.role} is a mixed stem, not evidence of a specific instrument role; kept for remix only`
          );
          continue;
        }
        const bytes = await downloadToBuffer(stem.url);
        const inspection = await inspectMaterialAudio({
          bytes,
          url: stem.url,
          role,
          roleEvidence: "stem-separated",
          deep: beat?.bpm == null || beat?.keySignature == null,
        });
        if (inspection.readiness !== "ready") {
          console.warn(
            `[stems] ${role} kept as a stem but not admitted to material shelf: ${inspection.reasons.join(", ") || "unmeasured"}`
          );
          continue;
        }
        const duplicate = await prisma.materialAsset.findFirst({
          where: {
            workspaceId: p.workspaceId,
            contentHash: inspection.contentHash,
          },
          select: { id: true, role: true },
        });
        if (duplicate) {
          if (duplicate.role !== role) {
            console.warn(
              `[stems] duplicate audio ${duplicate.id} already filed as ${duplicate.role}; refusing ${role} relabel`
            );
          }
          continue;
        }
        await prisma.materialAsset.create({
          data: {
            workspaceId: p.workspaceId,
            kind: "stem",
            role,
            genre: project?.genre ?? null,
            bpm: beat?.bpm ?? inspection.detectedBpm ?? null,
            keySignature: beat?.keySignature ?? inspection.detectedKey ?? null,
            durationS: stem.certification.qc.durationS,
            url: stem.url,
            source: stemSource,
            readiness: inspection.readiness,
            qualityState: stem.certification.qualityState,
            roleEvidence: "stem-separated",
            rightsBasis: stemRightsBasis,
            contentHash: stem.certification.contentHash,
            verifiedAt: stem.certification.verifiedAt,
            meta: {
              fromBeatId: beat?.id ?? null,
              fromSongId: p.songId,
              fromSourceUrl: sepSource,
              stemRole: stem.role,
              provider: beat?.provider ?? null,
              owned: isOwned,
              ...(p.selfHarvest ? { selfHarvest: true } : {}),
              qc: inspection.qc,
              rightsBasis: stemRightsBasis,
              sourceLineage,
              certification: audioCertificationReceipt(stem.certification),
            } as never,
          },
        });
        retainedMaterialUrls.add(stem.url);
      } catch (err) {
        console.warn(
          "[stems] material harvest failed:",
          (err as Error)?.message
        );
      }
    }

    // Beat-less harvests have no Stem rows. Keep only objects admitted as
    // materials; delete vocals, mixed-other, failed-QC, and duplicate uploads.
    if (!beat) {
      await Promise.all(
        ingested
          .filter(stem => !retainedMaterialUrls.has(stem.url))
          .map(stem => deleteObjectByUrl(stem.url).catch(() => {}))
      );
    }

    await retireSupersededAudio(p.workspaceId, supersededStemRefs);
    await markSucceeded(p.jobId, {
      beatId: beat?.id ?? null,
      sourceLineage,
      stems: ingested.length,
      instrumental: ingested.some(stem => stem.role === "instrumental"),
      roles,
      certifications: ingested.map(stem => ({
        role: stem.role,
        format: stem.format,
        ...audioCertificationReceipt(stem.certification),
      })),
    });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}

type BeatRow = {
  id: string;
  url: string;
  createdAt: Date;
  bpm: number | null;
  keySignature: string | null;
  duration: number | null;
  provider: string;
  meta: unknown;
};

/**
 * TRUE INSTRUMENTAL / ACAPELLA — separate what the user actually HEARS.
 *   source = explicit override → freshest master → mix → beat (mirror of the
 *   catalog's freshestAudioUrl; the raw pre-vocal beat is only the last resort).
 * Both halves come back loudness-matched to the source's own integrated LUFS,
 * uploaded as WAV (Stem rows) + true 320k mp3 (Song.instrumentalUrl/acapellaUrl).
 */
async function processTrueInstrumental(
  p: StemsPayload,
  beat: BeatRow,
  apiKey: string | undefined,
  mode: "instrumental" | "acapella"
) {
  if (!p.songId)
    throw new Error(
      "instrumental/acapella jobs are song-scoped: payload has no songId"
    );
  if (!(await ffmpegAvailable())) {
    throw new Error(
      "ffmpeg binary not found on worker host: install ffmpeg before serving stem jobs"
    );
  }

  const [master, mix] = await Promise.all([
    prisma.master.findFirst({
      where: { songId: p.songId, projectId: p.projectId },
      orderBy: { createdAt: "desc" },
      select: { url: true, createdAt: true },
    }),
    prisma.mix.findFirst({
      where: { songId: p.songId, projectId: p.projectId },
      orderBy: { createdAt: "desc" },
      select: { url: true, createdAt: true },
    }),
  ]);
  const candidates = [master, mix, beat].filter(Boolean) as Array<{
    url: string;
    createdAt: Date;
  }>;
  candidates.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const sourceUrl = p.sourceUrl?.trim() || candidates[0]?.url;
  if (!sourceUrl)
    throw new Error("instrumental/acapella source lineage is missing");
  const sourceLineage = {
    version: "stem-source-v1",
    jobId: p.jobId,
    sourceUrl,
    sourceBeatId: beat.id,
    requestedBeatId: p.beatId ?? null,
    explicitSourceUrl: Boolean(p.sourceUrl),
  };

  const sourceQc = await measureAudioQuality(sourceUrl).catch(() => null);
  const sourceLufs = sourceQc?.integratedLufs ?? null;
  const result = await separateStemsRouted({
    audioUrl: sourceUrl,
    apiKey,
    mode: "instrumental",
    purpose: "user",
    workspaceId: p.workspaceId,
    preferLocal: true,
  });
  const instrumentalRaw =
    result.instrumentalUrl ??
    result.stems.find(stem => stem.role === "instrumental")?.url;
  const vocalsRaw = result.stems.find(stem => stem.role === "vocals")?.url;
  if (!instrumentalRaw) {
    throw new Error(
      `stem separation did not return an instrumental (got: ${result.stems.map(stem => stem.role).join(", ") || "nothing"})`
    );
  }
  if (!vocalsRaw) {
    throw new Error(
      "stem separation must return both instrumental and acapella outputs"
    );
  }

  const newUrls: string[] = [];
  const renderCertifiedPair = async (rawUrl: string) => {
    const bytes = await downloadToBuffer(rawUrl);
    const wavBytes =
      sourceLufs !== null
        ? await loudnessMatchToSource(bytes, sourceLufs)
        : await transformAudio(bytes, {});
    const mp3Bytes = await encodeMp3320(wavBytes);
    const wav = await certifyAudioBytes({
      workspaceId: p.workspaceId,
      kind: "stems",
      bytes: wavBytes,
      contentType: "audio/wav",
      ext: "wav",
    });
    newUrls.push(wav.url);
    const mp3 = await certifyAudioBytes({
      workspaceId: p.workspaceId,
      kind: "stems",
      bytes: mp3Bytes,
      contentType: "audio/mpeg",
      ext: "mp3",
    });
    newUrls.push(mp3.url);
    return { wav, mp3 };
  };

  let instrumental: Awaited<ReturnType<typeof renderCertifiedPair>>;
  let vocals: Awaited<ReturnType<typeof renderCertifiedPair>>;
  try {
    instrumental = await renderCertifiedPair(instrumentalRaw);
    vocals = await renderCertifiedPair(vocalsRaw);
  } catch (error) {
    await Promise.allSettled(newUrls.map(url => deleteObjectByUrl(url)));
    throw error;
  } finally {
    const rawUrls = [
      ...new Set([
        instrumentalRaw,
        vocalsRaw,
        ...result.stems.map(stem => stem.url),
      ]),
    ];
    await Promise.allSettled(rawUrls.map(url => deleteObjectByUrl(url)));
  }

  const matchedLufs = instrumental.wav.qc.integratedLufs;
  const acapellaLufs = vocals.wav.qc.integratedLufs;
  const roles = ["instrumental", "vocals"];
  const oldStems = (await prisma.stem.findMany({
    where: { beatId: beat.id, role: { in: roles } },
    select: { url: true },
  })) as StemUrlRow[];
  const song = await prisma.song.findFirstOrThrow({
    where: { id: p.songId, projectId: p.projectId, workspaceId: p.workspaceId },
    select: {
      title: true,
      instrumentalUrl: true,
      acapellaUrl: true,
      instrumentalMeta: true,
      lyric: { select: { title: true } },
    },
  });
  const certification = {
    instrumental: {
      wav: audioCertificationReceipt(instrumental.wav),
      mp3: audioCertificationReceipt(instrumental.mp3),
    },
    acapella: {
      wav: audioCertificationReceipt(vocals.wav),
      mp3: audioCertificationReceipt(vocals.mp3),
    },
  };

  try {
    await prisma.$transaction([
      prisma.stem.deleteMany({
        where: { beatId: beat.id, role: { in: roles } },
      }),
      prisma.stem.create({
        data: {
          beatId: beat.id,
          role: "instrumental",
          url: instrumental.wav.url,
          format: "wav",
          duration: instrumental.wav.qc.durationS,
        },
      }),
      prisma.stem.create({
        data: {
          beatId: beat.id,
          role: "vocals",
          url: vocals.wav.url,
          format: "wav",
          duration: vocals.wav.qc.durationS,
        },
      }),
      prisma.song.update({
        where: { id: p.songId },
        data: {
          instrumentalUrl: instrumental.mp3.url,
          acapellaUrl: vocals.mp3.url,
          instrumentalMeta: {
            ...((song.instrumentalMeta ?? {}) as Record<string, unknown>),
            sourceLineage,
            sourceLufs,
            matchedLufs,
            acapellaLufs,
            engine: result.engine ?? "unknown",
            format: "wav+mp3",
            certification,
            at: new Date().toISOString(),
          } as never,
        },
      }),
      prisma.beatAsset.update({
        where: { id: beat.id },
        data: {
          meta: {
            ...((beat.meta ?? {}) as Record<string, unknown>),
            stemCertification: {
              sourceLineage,
              engine: result.engine ?? "unknown",
              certification,
              at: new Date().toISOString(),
            },
          } as never,
        },
      }),
    ]);
  } catch (error) {
    await Promise.allSettled(newUrls.map(url => deleteObjectByUrl(url)));
    throw error;
  }

  const project = await prisma.project.findUnique({
    where: { id: p.projectId },
    select: { genre: true },
  });
  const beatMeta = (beat.meta ?? {}) as {
    uploaded?: boolean;
    imported?: boolean;
  };
  const owned =
    p.owned === true ||
    beatMeta.uploaded === true ||
    beatMeta.imported === true ||
    beat.provider === "upload" ||
    beat.provider === "import";
  try {
    const instrumentalBytes = await downloadToBuffer(instrumental.wav.url);
    const inspection = await inspectMaterialAudio({
      bytes: instrumentalBytes,
      url: instrumental.wav.url,
      role: "instrumental",
      roleEvidence: "stem-separated",
      deep: beat.bpm == null || beat.keySignature == null,
    });
    if (inspection.readiness === "ready") {
      const duplicate = await prisma.materialAsset.findFirst({
        where: {
          workspaceId: p.workspaceId,
          contentHash: instrumental.wav.contentHash,
        },
        select: { id: true },
      });
      if (!duplicate) {
        await prisma.materialAsset.create({
          data: {
            workspaceId: p.workspaceId,
            kind: "stem",
            role: "instrumental",
            genre: project?.genre ?? null,
            bpm: beat.bpm ?? inspection.detectedBpm ?? null,
            keySignature: beat.keySignature ?? inspection.detectedKey ?? null,
            durationS: instrumental.wav.qc.durationS,
            url: instrumental.wav.url,
            source: owned ? "artist_stem" : "provider_stem",
            readiness: inspection.readiness,
            qualityState: instrumental.wav.qualityState,
            roleEvidence: "stem-separated",
            rightsBasis: owned ? "user-attested" : "provider-generated",
            contentHash: instrumental.wav.contentHash,
            verifiedAt: instrumental.wav.verifiedAt,
            meta: {
              fromSongId: p.songId,
              fromSongTitle: song.lyric?.title || song.title,
              fromSourceUrl: sourceUrl,
              sourceLineage,
              matchedLufs,
              format: "wav",
              qc: instrumental.wav.qc,
              certification: audioCertificationReceipt(instrumental.wav),
              rightsBasis: owned ? "user-attested" : "provider-generated",
            } as never,
          },
        });
      }
    } else {
      console.warn(
        `[stems] instrumental not admitted to reusable shelf: ${inspection.reasons.join(", ") || "unmeasured"}`
      );
    }
  } catch (error) {
    console.warn(
      "[stems] instrumental material filing failed:",
      (error as Error)?.message
    );
  }

  await retireSupersededAudio(p.workspaceId, [
    ...oldStems.map(stem => stem.url),
    song.instrumentalUrl ?? "",
    song.acapellaUrl ?? "",
  ]);
  await markSucceeded(p.jobId, {
    beatId: beat.id,
    mode,
    sourceLineage,
    sourceLufs,
    matchedLufs,
    acapellaLufs,
    engine: result.engine ?? "unknown",
    instrumentalUrl: instrumental.mp3.url,
    acapellaUrl: vocals.mp3.url,
    stems: roles.length,
    instrumental: true,
    roles,
    certification,
  });
}

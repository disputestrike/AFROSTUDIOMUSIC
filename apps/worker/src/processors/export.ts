import { prisma } from '@afrohit/db';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';

interface ExportPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  receiptId?: string;
}

/**
 * Bundles a song into a release kit:
 *   - MP3 (web/social)
 *   - WAV (distributor)
 *   - Stems (per-role)
 *   - Cover art
 *   - Lyrics (plain text + clean variant)
 *   - Video (latest approved render)
 *   - rights-receipt.json with hash
 *
 * For MVP this writes an Export row referencing the latest assets.
 * Next pass: zip into a single artifact + upload to /releases/{songId}.zip
 * via FFmpeg + archiver.
 */
export async function processExport(p: ExportPayload) {
  await markRunning(p.jobId);
  try {
    const song = await prisma.song.findFirstOrThrow({
      where: { id: p.songId, workspaceId: p.workspaceId },
      include: { lyric: true },
    });
    const master = await prisma.master.findFirst({
      where: { songId: song.id, approved: true },
      orderBy: { createdAt: 'desc' },
    });
    const mix = await prisma.mix.findFirst({
      where: { songId: song.id, approved: true },
      orderBy: { createdAt: 'desc' },
    });
    const beat = await prisma.beatAsset.findFirst({
      where: { songId: song.id },
      include: { stems: true },
      orderBy: { createdAt: 'desc' },
    });
    const vocal = await prisma.vocalRender.findFirst({
      where: { songId: song.id, approved: true },
      orderBy: { createdAt: 'desc' },
    });
    const cover = await prisma.imageAsset.findFirst({
      where: { projectId: song.projectId, kind: 'cover', approved: true },
      orderBy: { createdAt: 'desc' },
    });
    const video = await prisma.videoRender.findFirst({
      where: { projectId: song.projectId, approved: true },
      orderBy: { createdAt: 'desc' },
    });
    const receipt = p.receiptId
      ? await prisma.rightsReceipt.findFirst({ where: { id: p.receiptId, songId: song.id } })
      : await prisma.rightsReceipt.findFirst({
          where: { songId: song.id },
          orderBy: { createdAt: 'desc' },
        });

    // RIGHTS + GREEN-LIGHT GATE (audit DANGEROUS): never export a song that
    // hasn't passed the green-light gate, and never export when the rights review
    // said not-clear. The old code stamped RELEASED with no such check.
    if (!song.releaseReady) {
      await markFailed(p.jobId, 'export_blocked: song has not passed the green-light gate (rights/split-sheet/coverage). Run the release check first.');
      return;
    }
    const rightsVerdict = (receipt?.prompts ?? {}) as { rightsCheck?: { okToExport?: boolean; overallRisk?: string } };
    if (!receipt || rightsVerdict.rightsCheck?.okToExport !== true || rightsVerdict.rightsCheck.overallRisk === 'high') {
      await markFailed(p.jobId, 'export_blocked: rights review is not clear (okToExport=false / high risk). Resolve the flagged rights issues first.');
      return;
    }

    // Provenance + AI disclosure — what DSPs (Spotify/Apple/Audiomack) and PROs
    // require, and the proof behind the "we never rip" position: which models
    // made what, plus an attestation that no third-party audio was copied.
    const beatMeta = (beat?.meta ?? {}) as { uploaded?: boolean; imported?: boolean };
    const vocalMeta = (vocal?.meta ?? {}) as { uploaded?: boolean };
    const provenance = {
      aiAssisted: true,
      disclosure: 'GenAI-assisted, human-directed and edited.',
      beat: beat
        ? { provider: beat.provider, source: beatMeta.uploaded ? 'artist_upload' : beatMeta.imported ? 'rights_cleared_import' : 'ai_generated' }
        : null,
      vocal: vocal
        ? { provider: (vocal as { provider?: string }).provider ?? (vocalMeta.uploaded ? 'artist' : 'ai_generated'), source: vocalMeta.uploaded ? 'artist_performance' : 'ai_generated' }
        : null,
      lyrics: 'AI-assisted, human-edited',
      noCopyAttestation:
        'No third-party audio was copied, ripped, or sampled without clearance. Beats/vocals are original generations or artist-provided.',
      generatedAt: new Date().toISOString(),
    };

    const bundle = {
      mp3: master?.url ?? mix?.url ?? null,
      wav: master?.url ?? null,
      stems: beat?.stems.map((s: { role: string; url: string }) => ({ role: s.role, url: s.url })) ?? [],
      coverArt: cover?.url ?? null,
      lyrics: song.lyric?.body ?? null,
      cleanLyrics: song.lyric?.cleanVersion ?? null,
      video: video?.url ?? null,
      receiptHash: receipt?.hash ?? null,
      receiptId: receipt?.id ?? null,
      provenance,
      isrc: song.isrc ?? null,
      upc: song.upc ?? null,
      splitSheet: song.splitSheet ?? null,
      releaseReady: song.releaseReady,
    };

    const exp = await prisma.export.create({
      data: {
        projectId: song.projectId,
        songId: song.id,
        bundle: bundle as never,
        receiptId: receipt?.id,
      },
    });

    // EXPORTED, not RELEASED: a bundle was built + is downloadable. RELEASED is
    // reserved for a confirmed distributor submission (distributeRelease → Release row).
    await prisma.song.update({ where: { id: song.id }, data: { status: 'EXPORTED' } });

    await markSucceeded(p.jobId, { exportId: exp.id, bundle });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}

/**
 * SOCIAL PUBLISH PROCESSOR (Phase 5, Part B) — fan a released song out to the
 * artist's connected platforms through the ONE aggregator.
 *
 * generate-once/cut-many: it posts the music video (or the visualizer when there
 * is no video) plus a few of the already-cut vertical clips, with the release
 * kit's caption + tiered hashtags, scheduled from the release calendar. No new
 * render, no provider spend beyond the aggregator.
 *
 * HONESTY LAW (the ViralForge "coded but never run" trap): `resolveSocialAdapter`
 * returns null unless DISTRIBUTION_ENABLED is on AND a real AYRSHARE_API_KEY is
 * present. A null adapter means the job records NOTHING and publishes NOTHING —
 * never a fake "published". A real HTTP publish fires only through the adapter,
 * only with the key. FAIL-SOFT: this never throws; one platform failing never
 * aborts the rest, and its honest verdict is recorded on the SocialPost row.
 */
import pino from "pino";
import { prisma } from "@afrohit/db";
import {
  buildSocialPosts,
  publishReleaseToSocials,
  type ReleaseKitLike,
  type SocialMediaItem,
} from "@afrohit/shared";

import { resolveAssetForProvider } from "../lib/storage";
import { resolveSocialAdapter } from "../lib/social-distribution";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

export const SOCIAL_QUEUE = "social";
export const SOCIAL_JOB = "social-publish";

export interface SocialPublishJobPayload {
  songId: string;
  workspaceId: string;
  releaseId?: string | null;
  /** distribute (owner pressed Distribute) — logs only. */
  reason?: string;
}

/** Presign a private storage ref for the aggregator; drop anything that can't be
 *  resolved rather than hand a broken URL to a platform. */
async function publicMediaUrl(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  try {
    return await resolveAssetForProvider(ref, 3600);
  } catch (err) {
    log.warn({ err }, "social-publish: could not presign a media asset (skipped)");
    return null;
  }
}

export async function processSocialPublish(
  p: SocialPublishJobPayload
): Promise<void> {
  try {
    const adapter = resolveSocialAdapter(process.env);
    if (!adapter) {
      // NOT CONFIGURED — the honesty gate. Publish nothing, record nothing.
      log.warn(
        { songId: p.songId, reason: p.reason },
        "social-publish: distribution not configured (flag/key absent) — nothing published (honest no-op)"
      );
      return;
    }

    const song = await prisma.song.findFirst({
      where: { id: p.songId, workspaceId: p.workspaceId },
      select: {
        id: true,
        title: true,
        status: true,
        releaseReady: true,
        socialsJson: true,
        posterUrl: true,
      },
    });
    if (!song) {
      log.warn({ songId: p.songId }, "social-publish: song missing — skipped");
      return;
    }
    if (song.status !== "RELEASED" || !song.releaseReady) {
      log.warn(
        { songId: p.songId, status: song.status },
        "social-publish: song not released — nothing published"
      );
      return;
    }

    const accounts = await prisma.connectedAccount.findMany({
      where: { workspaceId: p.workspaceId, status: "connected" },
      select: { platform: true, status: true, externalRef: true, displayName: true },
    });
    if (!accounts.length) {
      log.warn({ songId: p.songId }, "social-publish: no connected accounts — nothing published");
      return;
    }

    // Gather the already-rendered media — the ONE master music video, a few
    // vertical clips, and the visualizer as the video-less fallback.
    const [musicVideo, clips, visualizer] = await Promise.all([
      prisma.videoRender.findFirst({
        where: {
          provider: "assembler",
          concept: { songId: song.id },
          meta: { path: ["assembly", "kind"], equals: "full" },
        },
        orderBy: { createdAt: "desc" },
        select: { url: true },
      }),
      prisma.songClip.findMany({
        where: { songId: song.id },
        orderBy: [{ durationS: "asc" }, { createdAt: "asc" }],
        take: 3,
        select: { url: true, durationS: true },
      }),
      prisma.songVisual.findFirst({
        where: { songId: song.id, kind: "visualizer" },
        orderBy: { createdAt: "desc" },
        select: { url: true },
      }),
    ]);

    const media: SocialMediaItem[] = [];
    const musicVideoUrl = await publicMediaUrl(musicVideo?.url);
    if (musicVideoUrl) media.push({ kind: "music_video", url: musicVideoUrl });
    if (!musicVideoUrl) {
      const visualizerUrl = await publicMediaUrl(visualizer?.url);
      if (visualizerUrl) media.push({ kind: "visualizer", url: visualizerUrl });
    }
    for (const clip of clips) {
      const clipUrl = await publicMediaUrl(clip.url);
      if (clipUrl) media.push({ kind: "clip", url: clipUrl, durationS: clip.durationS });
    }

    // The BRANDED POSTER (cover + big "AFRO" mark) — the pinned pointer wins; a
    // legacy song with no pinned poster falls back to its poster-marked
    // thumbnail. Presigned like every other asset; null → no poster attached.
    let posterRef = song.posterUrl ?? null;
    if (!posterRef) {
      const posterVisual = await prisma.songVisual.findFirst({
        where: { songId: song.id, kind: "thumbnail", meta: { path: ["poster"], equals: true } },
        orderBy: { createdAt: "desc" },
        select: { url: true },
      });
      posterRef = posterVisual?.url ?? null;
    }
    const posterUrl = await publicMediaUrl(posterRef);

    const releaseUrl = process.env.WEB_URL
      ? `${process.env.WEB_URL.split(",")[0]}/r/${song.id}`
      : null;

    const posts = buildSocialPosts({
      accounts,
      kit: (song.socialsJson ?? null) as ReleaseKitLike | null,
      media,
      title: song.title,
      releaseUrl,
      posterUrl,
    });
    const results = await publishReleaseToSocials({ posts, adapter });

    // HONEST receipt — one SocialPost per attempted post, carrying the
    // aggregator's own verdict.
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]!;
      const result = results[i];
      const status = result?.ok
        ? result.scheduled
          ? "scheduled"
          : "published"
        : "failed";
      await prisma.socialPost
        .create({
          data: {
            workspaceId: p.workspaceId,
            songId: song.id,
            releaseId: p.releaseId ?? null,
            platform: post.platform,
            status,
            externalPostId: result?.externalPostId ?? null,
            caption: post.caption.slice(0, 2000),
            mediaKind: post.mediaKind,
            scheduledAt: post.scheduledAt ? new Date(post.scheduledAt) : null,
            error: result?.ok ? null : (result?.error ?? "publish_failed"),
            meta: {
              provider: adapter.provider,
              mediaCount: post.mediaUrls.length,
              hasPoster: !!post.posterUrl,
              hashtags: post.hashtags,
            } as never,
          },
        })
        .catch(err =>
          log.warn({ err, platform: post.platform }, "social-publish: could not record a SocialPost")
        );
    }

    log.info(
      {
        songId: song.id,
        provider: adapter.provider,
        platforms: posts.length,
        published: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
      },
      "social-publish finished (real aggregator publish)"
    );
  } catch (err) {
    // FAIL-SOFT: never throw. A distribution problem must not crash the lane.
    log.warn({ err, songId: p.songId }, "social-publish failed (fail-soft)");
  }
}

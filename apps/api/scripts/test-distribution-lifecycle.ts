import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { prisma } from "@afrohit/db";
import {
  distributionSignature,
  sanitizeDistributionChannels,
} from "../src/lib/distribution";
import webhooks from "../src/routes/webhooks";

type StatusEvent = {
  schemaVersion: 1;
  event: "release.status";
  eventId: string;
  externalId: string;
  status: "accepted" | "live" | "failed" | "cancelled";
  occurredAt: string;
  channels?: Record<string, string>;
};

async function main() {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
  const ids = {
    workspace: "ws_distribution_" + suffix,
    artist: "artist_distribution_" + suffix,
    project: "project_distribution_" + suffix,
    song: "song_distribution_" + suffix,
    release: "release_distribution_" + suffix,
    external: "partner_distribution_" + suffix,
  };
  const secret = "distribution-integration-secret-at-least-32-bytes";
  const priorSecret = process.env.DISTRIBUTOR_WEBHOOK_SECRET;
  process.env.DISTRIBUTOR_WEBHOOK_SECRET = secret;

  const app = Fastify({ logger: false });
  await app.register(webhooks, { prefix: "/webhooks" });
  await app.ready();

  const send = async (event: StatusEvent, timestamp?: string) => {
    const body = JSON.stringify(event);
    const signedAt = timestamp ?? Math.floor(Date.now() / 1000).toString();
    return app.inject({
      method: "POST",
      url: "/webhooks/distributor",
      payload: body,
      headers: {
        "content-type": "application/json",
        "x-afrohit-timestamp": signedAt,
        "x-afrohit-signature": distributionSignature(
          secret,
          signedAt,
          Buffer.from(body)
        ),
      },
    });
  };

  try {
    await prisma.workspace.create({
      data: {
        id: ids.workspace,
        name: "Distribution Integration",
        slug: "distribution-" + suffix,
      },
    });
    await prisma.artist.create({
      data: {
        id: ids.artist,
        workspaceId: ids.workspace,
        name: "Distribution Artist",
        stageName: "Distribution Artist",
      },
    });
    await prisma.project.create({
      data: {
        id: ids.project,
        workspaceId: ids.workspace,
        artistId: ids.artist,
        title: "Distribution Project",
        genre: "afrobeats",
      },
    });
    await prisma.song.create({
      data: {
        id: ids.song,
        workspaceId: ids.workspace,
        projectId: ids.project,
        title: "Distribution Song",
        status: "EXPORTED",
        releaseReady: true,
      },
    });
    await prisma.release.create({
      data: {
        id: ids.release,
        workspaceId: ids.workspace,
        artistId: ids.artist,
        songId: ids.song,
        externalId: ids.external,
        distributor: "contract-partner",
        status: "submitted",
        submittedAt: new Date(),
      },
    });

    const occurredAt = new Date().toISOString();
    const accepted: StatusEvent = {
      schemaVersion: 1,
      event: "release.status",
      eventId: "accepted_" + suffix,
      externalId: ids.external,
      status: "accepted",
      occurredAt,
    };
    const acceptedResponse = await send(accepted);
    assert.equal(acceptedResponse.statusCode, 200);
    assert.equal(acceptedResponse.json().applied, true);

    const acceptedState = await prisma.release.findUniqueOrThrow({
      where: { id: ids.release },
      include: { song: true },
    });
    assert.equal(acceptedState.status, "accepted");
    assert.equal(acceptedState.song.status, "EXPORTED");

    const duplicate = await send(accepted);
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.json().idempotent, true);
    assert.equal(
      await prisma.distributionEvent.count({
        where: { eventId: accepted.eventId },
      }),
      1
    );

    const conflict = await send({ ...accepted, status: "cancelled" });
    assert.equal(conflict.statusCode, 409);

    const stale: StatusEvent = {
      ...accepted,
      eventId: "stale_" + suffix,
    };
    const staleResponse = await send(
      stale,
      (Math.floor(Date.now() / 1000) - 301).toString()
    );
    assert.equal(staleResponse.statusCode, 401);

    const failedBeforeLive: StatusEvent = {
      ...accepted,
      eventId: "failed_before_live_" + suffix,
      status: "failed",
      occurredAt: new Date(new Date(occurredAt).getTime() + 2_000).toISOString(),
    };
    const failedBeforeLiveResponse = await send(failedBeforeLive);
    assert.equal(failedBeforeLiveResponse.statusCode, 200);
    assert.equal(failedBeforeLiveResponse.json().applied, true);

    const delayedAccepted: StatusEvent = {
      ...accepted,
      eventId: "delayed_accepted_" + suffix,
      occurredAt: new Date(new Date(occurredAt).getTime() + 1_000).toISOString(),
    };
    const delayedAcceptedResponse = await send(delayedAccepted);
    assert.equal(delayedAcceptedResponse.statusCode, 200);
    assert.equal(delayedAcceptedResponse.json().applied, false);

    const failedState = await prisma.release.findUniqueOrThrow({
      where: { id: ids.release },
    });
    assert.equal(failedState.status, "failed");
    assert.equal(
      failedState.distributionStatusAt?.toISOString(),
      failedBeforeLive.occurredAt
    );

    const live: StatusEvent = {
      schemaVersion: 1,
      event: "release.status",
      eventId: "live_" + suffix,
      externalId: ids.external,
      status: "live",
      occurredAt: new Date(new Date(occurredAt).getTime() + 3_000).toISOString(),
      channels: {
        spotify: "https://open.spotify.com/track/contract",
        unsafe: "http://example.com/not-live-proof",
      },
    };
    const liveResponse = await send(live);
    assert.equal(liveResponse.statusCode, 200);
    assert.equal(liveResponse.json().applied, true);

    const liveState = await prisma.release.findUniqueOrThrow({
      where: { id: ids.release },
      include: { song: true },
    });
    assert.equal(liveState.status, "live");
    assert.equal(liveState.song.status, "RELEASED");
    assert.ok(liveState.liveAt);
    assert.ok(liveState.releaseDate);
    assert.equal(liveState.distributionStatusAt?.toISOString(), live.occurredAt);
    assert.deepEqual(liveState.channels, {
      spotify: "https://open.spotify.com/track/contract",
    });
    assert.deepEqual(
      sanitizeDistributionChannels(live.channels),
      liveState.channels
    );

    const failedAfterLive: StatusEvent = {
      ...live,
      eventId: "failed_" + suffix,
      status: "failed",
      channels: undefined,
    };
    const failedResponse = await send(failedAfterLive);
    assert.equal(failedResponse.statusCode, 200);
    assert.equal(failedResponse.json().applied, false);

    const protectedState = await prisma.release.findUniqueOrThrow({
      where: { id: ids.release },
      include: { song: true },
    });
    assert.equal(protectedState.status, "live");
    assert.equal(protectedState.song.status, "RELEASED");

    console.log("Distribution lifecycle database integration passed.");
  } finally {
    await prisma.workspace
      .delete({ where: { id: ids.workspace } })
      .catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
    if (priorSecret === undefined) delete process.env.DISTRIBUTOR_WEBHOOK_SECRET;
    else process.env.DISTRIBUTOR_WEBHOOK_SECRET = priorSecret;
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

import { Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { prisma, Prisma, refundWorkspaceCharge } from "@afrohit/db";
import { dropBatchSchema, redactSensitiveText } from "@afrohit/shared";
import { isInternalMode } from "../middleware/auth";
import { QUEUES } from "./queue";
import { runDropPipeline } from "../routes/drop";
import {
  finishAutoMaterialBeat,
  type FinishAutoMaterialPayload,
} from "./material-auto";
import { runArReadAfterRender } from "./ar-read";

type DropOrchestrationPayload = {
  jobId: string;
  workspaceId: string;
  userId: string;
  projectId: string;
  input: unknown;
  albumId?: string;
};
const REFUND_OUTBOX_MARKER = "refund_pending:";
const TERMINAL_JOB_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);

function isTerminalJobStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

function isFinalAttempt(job: {
  attemptsMade: number;
  opts: { attempts?: number };
}): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

function refundRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt) || 1);
  return Math.min(15 * 60_000, 5_000 * 2 ** Math.min(safeAttempt, 8));
}

async function recordOrchestrationFailure(
  app: FastifyInstance,
  args: {
    jobId: string;
    workspaceId: string;
    error: unknown;
    finalAttempt: boolean;
    fallbackMessage: string;
  }
): Promise<void> {
  const failedAt = new Date();
  const message = redactSensitiveText(
    (args.error as Error)?.message ?? args.fallbackMessage,
    500
  );
  const failed = await prisma.$transaction(async tx => {
    const updated = await tx.providerJob.update({
      where: { id: args.jobId },
      data: {
        status: args.finalAttempt ? "FAILED" : "QUEUED",
        startedAt: args.finalAttempt ? undefined : null,
        finishedAt: args.finalAttempt ? failedAt : null,
        errorJson: { message } as never,
      },
      select: { chargeLedgerId: true },
    });
    if (args.finalAttempt && updated.chargeLedgerId) {
      await tx.jobOutbox.updateMany({
        where: { providerJobId: args.jobId },
        data: {
          status: "FAILED",
          nextAttemptAt: failedAt,
          lastError: `${REFUND_OUTBOX_MARKER}scheduled`,
        },
      });
    }
    return updated;
  });

  if (!args.finalAttempt || !failed.chargeLedgerId) return;

  try {
    await refundWorkspaceCharge(prisma, {
      workspaceId: args.workspaceId,
      chargeId: failed.chargeLedgerId,
      internalMode: isInternalMode(),
      refTable: "ProviderJob",
      refId: args.jobId,
    });
    await prisma.jobOutbox.updateMany({
      where: {
        providerJobId: args.jobId,
        lastError: { startsWith: REFUND_OUTBOX_MARKER },
      },
      data: { status: "DISPATCHED", lastError: null },
    });
  } catch (refundError) {
    try {
      const row = await prisma.jobOutbox.findUnique({
        where: { providerJobId: args.jobId },
        select: { attempts: true },
      });
      if (row) {
        await prisma.jobOutbox.updateMany({
          where: {
            providerJobId: args.jobId,
            lastError: { startsWith: REFUND_OUTBOX_MARKER },
          },
          data: {
            status: "FAILED",
            attempts: { increment: 1 },
            nextAttemptAt: new Date(
              Date.now() + refundRetryDelayMs(row.attempts + 1)
            ),
            lastError: `${REFUND_OUTBOX_MARKER}${redactSensitiveText(
              (refundError as Error)?.message ?? refundError,
              400
            )}`,
          },
        });
      }
    } catch (persistenceError) {
      app.log.error(
        { err: persistenceError, jobId: args.jobId },
        "durable orchestration refund retry update failed"
      );
    }
    app.log.error(
      { err: refundError, jobId: args.jobId },
      "orchestration refund deferred for durable retry"
    );
  }
}


export async function startOrchestrationWorker(
  app: FastifyInstance
): Promise<void> {
  const connection = app.redis.duplicate();
  let lastConnectionErrorAt = 0;
  const reportConnectionError = (error: Error) => {
    const now = Date.now();
    if (now - lastConnectionErrorAt < 30_000) return;
    lastConnectionErrorAt = now;
    app.log.warn(
      { err: error },
      "orchestration worker unavailable; durable jobs remain queued while Redis reconnects"
    );
  };
  connection.on("error", reportConnectionError);

  const worker = new Worker(
    QUEUES.orchestration,
    async bullJob => {
      if (bullJob.name === "ar-read-after-render") {
        const data = bullJob.data as {
          jobId: string;
          workspaceId: string;
          items: Array<{ songId: string; jobId: string }>;
        };
        const owned = await prisma.providerJob.findFirst({
          where: {
            id: data.jobId,
            workspaceId: data.workspaceId,
            kind: "ar-orchestration",
          },
          select: { id: true, status: true },
        });
        if (!owned)
          throw new Error("A&R orchestration job missing or outside workspace");
        if (isTerminalJobStatus(owned.status)) return;
        await prisma.providerJob.update({
          where: { id: data.jobId },
          data: {
            status: "RUNNING",
            startedAt: new Date(),
            finishedAt: null,
            errorJson: Prisma.DbNull,
          },
        });
        try {
          const result = await runArReadAfterRender(
            app,
            data.workspaceId,
            data.jobId,
            data.items
          );
          await prisma.providerJob.update({
            where: { id: data.jobId },
            data: {
              status: "SUCCEEDED",
              finishedAt: new Date(),
              outputJson: result as never,
            },
          });
        } catch (error) {
          await recordOrchestrationFailure(app, {
            jobId: data.jobId,
            workspaceId: data.workspaceId,
            error,
            finalAttempt: isFinalAttempt(bullJob),
            fallbackMessage: "A&R orchestration failed",
          });
          throw error;
        }
        return;
      }

      if (bullJob.name === "finish-auto-material") {
        const data = bullJob.data as FinishAutoMaterialPayload;
        const owned = await prisma.providerJob.findFirst({
          where: {
            id: data.jobId,
            workspaceId: data.workspaceId,
            kind: "material-orchestration",
          },
          select: { id: true, status: true, chargeLedgerId: true },
        });
        if (!owned)
          throw new Error(
            "material orchestration job missing or outside workspace"
          );
        if (isTerminalJobStatus(owned.status)) return;
        await prisma.providerJob.update({
          where: { id: data.jobId },
          data: {
            status: "RUNNING",
            startedAt: new Date(),
            finishedAt: null,
            errorJson: Prisma.DbNull,
          },
        });
        try {
          const result = await finishAutoMaterialBeat(app, data);
          await prisma.providerJob.update({
            where: { id: data.jobId },
            data: {
              status: "SUCCEEDED",
              finishedAt: new Date(),
              outputJson: result as never,
            },
          });
        } catch (error) {
          await recordOrchestrationFailure(app, {
            jobId: data.jobId,
            workspaceId: data.workspaceId,
            error,
            finalAttempt: isFinalAttempt(bullJob),
            fallbackMessage: "material orchestration failed",
          });
          throw error;
        }
        return;
      }

      if (bullJob.name !== "run-drop")
        throw new Error(`unknown orchestration job: ${bullJob.name}`);
      const data = bullJob.data as DropOrchestrationPayload;
      const input = dropBatchSchema.parse(data.input);
      const owned = await prisma.providerJob.findFirst({
        where: {
          id: data.jobId,
          workspaceId: data.workspaceId,
          projectId: data.projectId,
          kind: "drop",
        },
        select: { id: true, status: true },
      });
      if (!owned) throw new Error("drop job missing or outside workspace");
      if (isTerminalJobStatus(owned.status)) return;

      await prisma.providerJob.update({
        where: { id: data.jobId },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          finishedAt: null,
          errorJson: Prisma.DbNull,
        },
      });

      try {
        const result = await runDropPipeline(
          app,
          {
            app,
            workspaceId: data.workspaceId,
            userId: data.userId,
            projectId: data.projectId,
          },
          input,
          data.jobId
        );
        if (data.albumId) {
          const album = await prisma.album.findFirst({
            where: { id: data.albumId, workspaceId: data.workspaceId },
            select: { id: true },
          });
          if (!album) throw new Error("drop album missing or outside workspace");
          const songId = result.playableOutputs[0]?.songId;
          if (!songId)
            throw new Error("album drop completed without a playable song");
          const attached = await prisma.song.updateMany({
            where: {
              id: songId,
              workspaceId: data.workspaceId,
              projectId: data.projectId,
            },
            data: { albumId: album.id },
          });
          if (attached.count !== 1)
            throw new Error("album drop song missing or outside workspace/project");
        }
        await prisma.providerJob.update({
          where: { id: data.jobId },
          data: {
            status: "SUCCEEDED",
            finishedAt: new Date(),
            outputJson: {
              ...result,
              ...(data.albumId ? { albumId: data.albumId } : {}),
            } as never,
          },
        });
      } catch (error) {
        await recordOrchestrationFailure(app, {
          jobId: data.jobId,
          workspaceId: data.workspaceId,
          error,
          finalAttempt: isFinalAttempt(bullJob),
          fallbackMessage: "drop pipeline failed",
        });
        throw error;
      }
    },
    {
      connection,
      concurrency: Math.max(
        1,
        Math.min(4, Number(process.env.ORCHESTRATION_CONCURRENCY ?? 1) || 1)
      ),
      lockDuration: 20 * 60_000,
      stalledInterval: 60_000,
      maxStalledCount: 2,
    }
  );

  worker.on("failed", (job, error) => {
    app.log.error(
      { err: error, bullJobId: job?.id, providerJobId: job?.data?.jobId },
      "orchestration attempt failed"
    );
  });

  worker.on("error", reportConnectionError);

  // Redis loss must not prevent the API from binding its health and read routes.
  // BullMQ keeps reconnecting, while PostgreSQL outbox rows preserve every job.
  void worker
    .waitUntilReady()
    .then(() => app.log.info("orchestration worker connected"))
    .catch(error =>
      app.log.warn(
        { err: error },
        "orchestration worker readiness check failed"
      )
    );

  app.addHook("onClose", async () => {
    await worker.close(true).catch(error => {
      app.log.warn({ err: error }, "orchestration worker forced close failed");
    });
    connection.disconnect();
  });
}

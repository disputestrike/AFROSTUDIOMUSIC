/**
 * Studio Chat — the command center.
 *
 * The user types in natural language. The model orchestrates the labs by
 * calling internal tools, each of which dispatches to one of the existing
 * service methods (briefs, hooks, lyrics, beats, vocals, mixes, images,
 * videos, taste, rights, exports).
 *
 * We persist:
 *   - the user/assistant turn pair,
 *   - every tool call + its result (so the timeline is auditable),
 *   - artifact refs (e.g. [{kind:'hook', id:'...'}]).
 *
 * Streaming: the route streams text deltas to the web app via SSE.
 */
import type { FastifyInstance } from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@afrohit/db';
import { chatMessageInputSchema, humanizeChatError, scrubVendorNames } from '@afrohit/shared';
import { prompts, studioChat, transcribeAudio } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { workspaceThrottle } from '../lib/workspace-throttle';
import { runChatTool } from '../services/chat-tools';

/** Per-workspace chat throttle (audit 2026-07-17). Env-tunable; autopilot is
 *  far more expensive per request, so it gets a tighter budget. */
const CHAT_PER_MIN = Math.max(1, Number(process.env.CHAT_PER_MIN ?? 30) || 30);
const CHAT_AUTOPILOT_PER_MIN = Math.max(
  1,
  Number(process.env.CHAT_AUTOPILOT_PER_MIN ?? 6) || 6
);
import { dataLakeSummary } from '../lib/data-lake';
import { scopedRequestKey } from '../lib/queued-job';
import { operationErrorBody, runIdempotentOperation } from '../lib/idempotent-operation';

/**
 * Per-request generation guard. The model can emit several tool calls in one turn
 * (and autopilot loops many rounds); with no cap, "make me a song" fans out into
 * many render jobs — the "1 song → 20 songs" bug. One user message =
 * at most ONE new song, one hook batch, one cover, one storyboard, one drop, etc.
 * run_drop is the explicit batch path and is already capped internally.
 */
const GEN_LIMIT_PER_REQUEST: Record<string, number> = {
  create_beat_job: 1,
  generate_hooks: 1,
  run_drop: 1,
  generate_cover_art: 1,
  generate_video_storyboard: 1,
  render_video: 1,
  render_demo_vocal: 1,
  create_release_kit: 1,
};
function makeGenGuard() {
  const used: Record<string, number> = {};
  return (name: string): { allowed: true } | { allowed: false; reason: string } => {
    const cap = GEN_LIMIT_PER_REQUEST[name];
    if (cap == null) return { allowed: true };
    used[name] = (used[name] ?? 0) + 1;
    if (used[name] > cap) {
      return {
        allowed: false,
        reason: `skipped_duplicate: "${name}" already ran once this request (limit ${cap} — one song per request). Do NOT call it again; tell the user it's queued, or ask what they want to change.`,
      };
    }
    return { allowed: true };
  };
}

/**
 * RELIABILITY: a hung model call must never hang the whole turn. The Claude
 * path has its own 90s abort, but the fallback path had none — a stalled
 * upstream left the SSE open with zero events and the user staring at a dead
 * spinner ("sometimes it just doesn't want to work"). 120s is far above any
 * healthy turn; on breach we throw an honest timeout the error mapper turns
 * into "took too long — try again".
 */
const CHAT_TURN_TIMEOUT_MS = 120_000;
async function modelTurnWithTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('chat model turn timed out')), CHAT_TURN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Every chat needs a project to operate on. If the thread doesn't have one
 * (e.g. the user opened /studio and typed "make me a song" from scratch),
 * lazily create a default artist + project and attach it to the thread. This
 * makes "make me a song" work with zero setup.
 */
/** TENANT ISOLATION (audit 2026-07-17): a caller-supplied projectId is honored
 *  ONLY when it belongs to THIS workspace. A foreign or unknown id becomes
 *  null (the thread then binds to the workspace's own default project), so
 *  chat context and tools can never read or write another tenant's project. */
async function ownedProjectId(
  workspaceId: string,
  projectId: string | null | undefined
): Promise<string | null> {
  if (!projectId) return null;
  const owned = await prisma.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true },
  });
  return owned?.id ?? null;
}

async function ensureThreadProject(
  workspaceId: string,
  thread: { id: string; projectId: string | null }
): Promise<string> {
  if (thread.projectId) return thread.projectId;
  let artist = await prisma.artist.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
  if (!artist) {
    artist = await prisma.artist.create({
      data: {
        workspaceId,
        name: 'My Artist',
        stageName: 'My Artist',
        vocalTone: ['smooth'],
        languages: ['pcm', 'yo', 'en'],
        laneSummary: 'Afro-fusion, hooks lead. Edit your Artist DNA in Settings for sharper results.',
      },
    });
  }
  const project = await prisma.project.create({
    data: { workspaceId, artistId: artist.id, title: 'Studio Session', genre: 'afro_fusion', bpm: 103 },
  });
  await prisma.chatThread.update({ where: { id: thread.id }, data: { projectId: project.id } });
  thread.projectId = project.id;
  return project.id;
}

/**
 * Convert stored chat history into VALID OpenAI messages.
 * Tool-role rows are dropped — OpenAI requires each 'tool' message to follow an
 * assistant message carrying matching tool_calls, which we don't replay. The
 * assistant summaries + WORKSPACE_CONTEXT carry state forward, so dropping them
 * is safe and fixes the "role 'tool' must be a response to tool_calls" 400.
 */
function toModelMessages(
  history: Array<{ role: string; content: string }>
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content ?? '').trim().length > 0)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

/**
 * Current artifacts (with IDs) so the model can act across turns — score,
 * approve, write lyrics from an earlier hook. Since we no longer replay tool
 * messages, THIS is how the model knows the real IDs to pass to tools.
 */
async function projectStateForChat(projectId: string) {
  const [hooks, lyric, song] = await Promise.all([
    prisma.hookCandidate.findMany({
      where: { projectId },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: 25,
      select: { id: true, text: true, score: true, approved: true },
    }),
    prisma.lyricDraft.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, approved: true },
    }),
    prisma.song.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true },
    }),
  ]);
  return {
    hooks: hooks.map((h: { id: string; text: string; score: number | null; approved: boolean }) => ({ id: h.id, text: h.text, score: h.score, approved: h.approved })),
    latestLyric: lyric,
    latestSong: song,
  };
}

export default async function chat(app: FastifyInstance) {
  /**
   * VOICE INPUT (mic) — server-side transcription so it works on EVERY browser,
   * not just Chrome's Web Speech API (Firefox has none, so the mic used to
   * vanish there). The client records with MediaRecorder and posts the clip as
   * base64; we transcribe with OpenAI (the brain's provider) and hand back text
   * the user can edit before sending. Owner: "we can use OpenAI for the mic."
   */
  app.post(
    '/transcribe',
    {
      // A short voice command as base64 is ~a few hundred KB; give real headroom
      // without allowing a huge upload.
      bodyLimit: 12 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['audio'],
          properties: {
            audio: { type: 'string', minLength: 16, maxLength: 16_000_000 },
            mime: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      const { audio, mime } = req.body as { audio: string; mime?: string };
      // Accept a raw base64 string or a data: URL.
      const b64 = audio.includes(',') ? audio.slice(audio.indexOf(',') + 1) : audio;
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(Buffer.from(b64, 'base64'));
      } catch {
        return reply.code(400).send({ error: 'invalid_audio' });
      }
      if (!bytes.byteLength) return reply.code(400).send({ error: 'empty_audio' });
      const ext = /ogg/i.test(mime ?? '') ? 'ogg' : /mp4|m4a|aac/i.test(mime ?? '') ? 'm4a' : /wav/i.test(mime ?? '') ? 'wav' : 'webm';
      const result = await transcribeAudio({ bytes, filename: `voice.${ext}` }).catch(() => null);
      if (!result?.text) {
        // Honest: the brain's transcription is unavailable/failed — say so plainly.
        return reply.code(503).send({ error: 'transcription_unavailable', message: 'Could not hear that one — type it, or try again.' });
      }
      return { text: result.text };
    }
  );

  /** List threads for the current workspace. */
  app.get('/threads', async (req) => {
    const { workspaceId, userId } = requireAuth(req);
    return prisma.chatThread.findMany({
      where: { workspaceId, userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  });

  /** Read a thread with all messages. */
  app.get<{ Params: { threadId: string } }>('/threads/:threadId', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.chatThread.findFirstOrThrow({
      where: { id: req.params.threadId, workspaceId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  });

  /** Delete a chat session. */
  app.delete<{ Params: { threadId: string } }>('/threads/:threadId', async (req, reply) => {
    const { workspaceId, userId } = requireAuth(req);
    await prisma.chatThread.deleteMany({ where: { id: req.params.threadId, workspaceId, userId } });
    reply.code(204);
    return null;
  });

  /**
   * Send a message. Synchronous JSON response — for streaming, see `/threads/:id/stream`.
   * Returns the assistant turn plus any tool calls executed.
   */
  app.post(
    '/messages',
    { schema: { body: chatMessageInputSchema } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = requireAuth(req);
      const body = chatMessageInputSchema.parse(req.body);
      // PER-WORKSPACE THROTTLE (audit 2026-07-17): chat drives uncharged LLM
      // spend; the per-IP global limit doesn't bound one workspace behind a
      // proxy pool. Autopilot (up to 14 model rounds) is throttled harder.
      const chatGate = await workspaceThrottle(app, {
        workspaceId,
        action: body.autopilot ? 'chat-autopilot' : 'chat',
        max: body.autopilot ? CHAT_AUTOPILOT_PER_MIN : CHAT_PER_MIN,
        windowS: 60,
      });
      if (!chatGate.ok) {
        return reply.code(429).send({ error: 'rate_limited', retryInS: chatGate.retryInS });
      }
      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'chat-message');

      const operation = await runIdempotentOperation({
        workspaceId,
        kind: 'chat-message',
        provider: 'text',
        idempotencyKey,
        inputJson: { userId, body },
        execute: async () => {
      const thread = body.threadId
        ? await prisma.chatThread.findFirstOrThrow({
            where: { id: body.threadId, workspaceId, userId },
          })
        : await prisma.chatThread.create({
            // TENANT ISOLATION (audit 2026-07-17, CONFIRMED cross-tenant IDOR):
            // a caller-supplied projectId must belong to THIS workspace, or the
            // chat context + tools would read/write another tenant's project.
            data: {
              workspaceId,
              userId,
              projectId: await ownedProjectId(workspaceId, body.projectId),
              title: body.content.slice(0, 60),
            },
          });

      // Persist user message
      await prisma.chatMessage.create({
        data: { threadId: thread.id, role: 'user', content: body.content },
      });
      const requestOperationKey = `chat-request:${workspaceId}:${idempotencyKey}`;

      // Guarantee the thread has a project so every tool has context.
      const projectId = await ensureThreadProject(workspaceId, thread);

      const project = await prisma.project.findFirst({
        where: { id: projectId, workspaceId },
        include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } },
      });
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { creditsCents: true, plan: true },
      });
      const recentArtifacts = await prisma.providerJob.findMany({
        where: { projectId },
        take: 8,
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, status: true, outputJson: true },
      });
      const state = await projectStateForChat(projectId);

      // Build conversation history.
      const history = await prisma.chatMessage.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'asc' },
        take: 40,
      });

      const systemContext = JSON.stringify({
        workspace: { creditsCents: workspace.creditsCents, plan: workspace.plan },
        artistDna: project?.artist
          ? {
              stageName: project.artist.stageName,
              lane: project.artist.laneSummary,
              languages: project.artist.languages,
              vocalTone: project.artist.vocalTone,
            }
          : null,
        currentProject: project ? { id: project.id, title: project.title, genre: project.genre, bpm: project.bpm } : null,
        currentBrief: project?.briefs[0] ?? null,
        // Real IDs so you can score/approve/write-from earlier artifacts across turns.
        hooks: state.hooks,
        latestLyric: state.latestLyric,
        latestSong: state.latestSong,
        recentArtifacts,
        // The DATA LAKE — everything the artist has TRAINED the studio on
        // (heard songs, lyric craft, trends, self-training). Workspace-wide, so
        // even a brand-new project's chat knows what's been learned. This is why
        // the chat must NEVER say "nothing has been learned".
        dataLake: await dataLakeSummary(workspaceId),
      });

      const turn = await modelTurnWithTimeout(studioChat({
        tools: prompts.STUDIO_CHAT_TOOLS as never,
        messages: [
          { role: 'system', content: prompts.STUDIO_CHAT_SYSTEM },
          { role: 'system', content: `WORKSPACE_CONTEXT=${systemContext}` },
          ...toModelMessages(history),
        ],
        temperature: 0.5,
      }));

      const toolResults: Array<{ name: string; arguments: unknown; output: unknown }> = [];

      if (turn.toolCalls?.length) {
        const guard = makeGenGuard();
        for (const [callIndex, call] of turn.toolCalls.entries()) {
          const gate = guard(call.name);
          const result = gate.allowed
            ? await runChatTool({
                workspaceId,
                userId,
                projectId,
                app,
                operationKey: `${requestOperationKey}:${callIndex}`,
                name: call.name,
                args: call.arguments,
              })
            : { skipped: true, reason: gate.reason };
          await prisma.chatMessage.create({
            data: {
              threadId: thread.id,
              role: 'tool',
              toolName: call.name,
              toolInput: call.arguments as never,
              toolOutput: result as never,
              content: JSON.stringify({ name: call.name, result }).slice(0, 4_000),
            },
          });
          toolResults.push({ name: call.name, arguments: call.arguments, output: result });
        }

        // Second model turn — let it summarize the tool results for the user.
        const finalTurn = await modelTurnWithTimeout(studioChat({
          tools: prompts.STUDIO_CHAT_TOOLS as never,
          messages: [
            { role: 'system', content: prompts.STUDIO_CHAT_SYSTEM },
            { role: 'system', content: `WORKSPACE_CONTEXT=${systemContext}` },
            ...toModelMessages(history),
            { role: 'assistant', content: turn.text ?? '' },
            {
              role: 'system',
              content: `TOOL_RESULTS=${JSON.stringify(toolResults).slice(0, 12_000)}`,
            },
            { role: 'user', content: 'One short line for the artist: what landed and the single next move. No ids, no JSON.' },
          ],
          temperature: 0.5,
        }));

        // §1.11 THE WALL: the persisted + returned prose is a user surface.
        const finalAssistant = scrubVendorNames(finalTurn.text ?? '');
        await prisma.chatMessage.create({
          data: {
            threadId: thread.id,
            role: 'assistant',
            content: finalAssistant,
            artifactRefs: artifactsFromTools(toolResults) as never,
          },
        });

        await prisma.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
        return {
          threadId: thread.id,
          assistant: finalAssistant,
          toolCalls: toolResults,
        };
      }

      const plainAssistant = scrubVendorNames(turn.text ?? '');
      await prisma.chatMessage.create({
        data: { threadId: thread.id, role: 'assistant', content: plainAssistant },
      });
      await prisma.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });

      return { threadId: thread.id, assistant: plainAssistant, toolCalls: [] };
        },
      });
      if (operation.state !== 'completed') {
        const failure = operationErrorBody(operation);
        return reply.code(failure.statusCode).send(failure.body);
      }
      return reply.code(200).send(operation.value);
    }
  );

  /**
   * Streaming variant — Server-Sent Events. Emits stage-by-stage progress so
   * the UI shows life during 10-30s tool chains instead of a dead spinner.
   *
   * Event shapes (each `data:` line is one JSON object):
   *   {type:"thread", threadId}
   *   {type:"stage", stage:"thinking"}
   *   {type:"tool_start", name}
   *   {type:"tool_result", name, output}
   *   {type:"assistant", text}
   *   {type:"done"}
   *   {type:"error", message}
   */
  app.post(
    '/messages/stream',
    { schema: { body: chatMessageInputSchema } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = requireAuth(req);
      const body = chatMessageInputSchema.parse(req.body);
      // PER-WORKSPACE THROTTLE — same law as /messages (the stream path is
      // where autopilot's rounds actually spend).
      const streamGate = await workspaceThrottle(app, {
        workspaceId,
        action: body.autopilot ? 'chat-autopilot' : 'chat',
        max: body.autopilot ? CHAT_AUTOPILOT_PER_MIN : CHAT_PER_MIN,
        windowS: 60,
      });
      if (!streamGate.ok) {
        return reply.code(429).send({ error: 'rate_limited', retryInS: streamGate.retryInS });
      }
      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'chat-message-stream');

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': (process.env.WEB_URL ?? 'http://localhost:3000').split(',')[0]!,
        'access-control-allow-credentials': 'true',
      });
      // Safe send: a non-serializable payload or a disconnected client must never
      // crash the loop — the work (queued jobs) continues server-side regardless.
      reply.raw.on('error', () => {/* client went away — keep processing */});
      const send = (data: unknown) => {
        try {
          let body: string;
          try {
            body = JSON.stringify(data);
          } catch {
            body = JSON.stringify({ type: 'tool_result', note: 'result_not_serializable' });
          }
          if (!reply.raw.writableEnded) reply.raw.write(`data: ${body}\n\n`);
        } catch {
          /* socket dead — swallow; finally{} ends the stream */
        }
      };
      // HEARTBEAT — model turns and long tool chains can be quiet for a minute+;
      // idle proxies kill silent SSE connections and the client watchdog needs
      // proof of life. Honest by design: a ping only says "still connected",
      // never progress that isn't happening.
      const heartbeat = setInterval(() => send({ type: 'ping' }), 15_000);

      try {
        const operation = await runIdempotentOperation({
          workspaceId,
          kind: 'chat-message-stream',
          provider: 'text',
          idempotencyKey,
          inputJson: { userId, body },
          execute: async () => {
        const thread = body.threadId
          ? await prisma.chatThread.findFirstOrThrow({
              where: { id: body.threadId, workspaceId, userId },
            })
          : await prisma.chatThread.create({
              data: {
                workspaceId,
                userId,
                projectId: await ownedProjectId(workspaceId, body.projectId),
                title: body.content.slice(0, 60),
              },
            });
        send({ type: 'thread', threadId: thread.id });

        await prisma.chatMessage.create({
          data: { threadId: thread.id, role: 'user', content: body.content },
        });
        const requestOperationKey = `chat-stream:${workspaceId}:${idempotencyKey}`;

        // Guarantee the thread has a project so every tool has context.
        const projectId = await ensureThreadProject(workspaceId, thread);

        const project = await prisma.project.findFirst({
          where: { id: projectId, workspaceId },
          include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } },
        });
        const workspace = await prisma.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
          select: { creditsCents: true, plan: true },
        });
        const history = await prisma.chatMessage.findMany({
          where: { threadId: thread.id },
          orderBy: { createdAt: 'asc' },
          take: 40,
        });
        const state = await projectStateForChat(projectId);
        const systemContext = JSON.stringify({
          workspace: { creditsCents: workspace.creditsCents, plan: workspace.plan },
          artistDna: project?.artist
            ? {
                stageName: project.artist.stageName,
                lane: project.artist.laneSummary,
                languages: project.artist.languages,
                vocalTone: project.artist.vocalTone,
              }
            : null,
          currentProject: project
            ? { id: project.id, title: project.title, genre: project.genre, bpm: project.bpm }
            : null,
          currentBrief: project?.briefs[0] ?? null,
          // Real IDs so you can score/approve/write-from earlier artifacts across turns.
          hooks: state.hooks,
          latestLyric: state.latestLyric,
          latestSong: state.latestSong,
          // The DATA LAKE — workspace-wide learnings (see /messages above).
          dataLake: await dataLakeSummary(workspaceId),
        });
        const autopilot = body.autopilot === true;
        const baseMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: prompts.STUDIO_CHAT_SYSTEM },
          ...(autopilot ? [{ role: 'system' as const, content: prompts.STUDIO_AUTOPILOT_DIRECTIVE }] : []),
          { role: 'system', content: `WORKSPACE_CONTEXT=${systemContext}` },
          ...toModelMessages(history),
        ];

        // Agent loop. Manual = 1 tool round then a summary. Autopilot = keep
        // looping (feeding each step's results back) until the model stops
        // calling tools or we hit the safety cap.
        const convo = [...baseMessages];
        const maxRounds = autopilot ? 14 : 1;
        // One guard for the WHOLE request so autopilot's 14 rounds still produce
        // exactly one song/cover/storyboard — not one per round.
        const guard = makeGenGuard();
        let finalText = '';
        // RESILIENCE (diagnosis 2026-07-18): a single failed round or tool used
        // to throw out of the whole loop and DISCARD every completed step — the
        // owner pressed "Continue", one brain hiccup hit, and all prior work
        // vanished behind "the studio brain had a hiccup". Track what actually
        // landed so a mid-run failure can end with a DETERMINISTIC summary
        // (never another model call — that would throw again when the brain is
        // down) and the saved progress a re-press resumes from.
        const landed: Array<{ name: string; output: unknown }> = [];
        const summarizeLanded = (): string => {
          const done = landed.filter(
            (s) =>
              s.output &&
              typeof s.output === 'object' &&
              !(s.output as { error?: unknown }).error &&
              !(s.output as { skipped?: unknown }).skipped
          );
          return done.length
            ? `The studio brain went quiet mid-run, but your progress is saved (${done.length} step${done.length === 1 ? '' : 's'} done). Press Continue to pick up from here.`
            : 'The studio brain went quiet before anything landed — try again in a moment.';
        };
        for (let round = 1; round <= maxRounds; round++) {
          send({ type: 'stage', stage: autopilot ? `producing (step ${round})` : 'thinking' });
          let turn;
          try {
            turn = await modelTurnWithTimeout(studioChat({
              tools: prompts.STUDIO_CHAT_TOOLS as never,
              messages: convo,
              temperature: 0.5,
            }));
          } catch (turnErr) {
            // Round 1 with nothing landed IS a real failure — surface it. A later
            // round means work is saved; end cleanly on a deterministic summary
            // instead of nuking the whole run.
            if (round === 1 && !landed.length) throw turnErr;
            finalText = summarizeLanded();
            break;
          }

          if (!turn.toolCalls?.length) {
            finalText = turn.text ?? '';
            break; // model answered / asked — done
          }

          const roundResults: Array<{ name: string; output: unknown }> = [];
          for (const [callIndex, call] of turn.toolCalls.entries()) {
            send({ type: 'tool_start', name: call.name });
            const gate = guard(call.name);
            // A single tool throwing must NOT abort the whole autopilot — record
            // the error as this step's result and feed it back so the model can
            // adapt or move on. The step's own refund/rollback already ran inside
            // the tool; here we just keep the loop alive.
            let result: unknown;
            try {
              result = gate.allowed
                ? await runChatTool({ workspaceId, userId, projectId, app, operationKey: `${requestOperationKey}:${round}:${callIndex}`, name: call.name, args: call.arguments })
                : { skipped: true, reason: gate.reason };
            } catch (toolErr) {
              result = { error: (toolErr as Error)?.message?.slice(0, 200) ?? 'tool failed' };
            }
            send({ type: 'tool_result', name: call.name, output: result });
            await prisma.chatMessage.create({
              data: {
                threadId: thread.id,
                role: 'tool',
                toolName: call.name,
                toolInput: call.arguments as never,
                toolOutput: result as never,
                content: JSON.stringify({ name: call.name, result }).slice(0, 4_000),
              },
            });
            roundResults.push({ name: call.name, output: result });
          }
          landed.push(...roundResults); // accumulate across rounds for the resume summary

          // Feed results back as text (valid OpenAI format — no orphan tool roles).
          convo.push({ role: 'assistant', content: turn.text || '(working)' });
          convo.push({
            role: 'user',
            content:
              `TOOL_RESULTS=${JSON.stringify(roundResults).slice(0, 12_000)}\n\n` +
              (autopilot
                ? 'Continue AUTOPILOT — do the next pipeline step now without asking. Use the real IDs from these results. When the release is bundled, give one final summary and stop.'
                : 'One short line for the artist: what landed and the single next move. No ids, no JSON.'),
          });

          if (!autopilot || round === maxRounds) {
            send({ type: 'stage', stage: 'summarizing' });
            // The closing summary is the LAST place a brain hiccup could still
            // nuke a fully-completed run. If it throws, fall back to the
            // deterministic summary instead of losing everything that landed.
            try {
              const fin = await modelTurnWithTimeout(studioChat({ tools: prompts.STUDIO_CHAT_TOOLS as never, messages: convo, temperature: 0.5 }));
              finalText = fin.text ?? finalText;
            } catch {
              finalText = finalText || summarizeLanded();
            }
            break;
          }
        }

        // §1.11 THE WALL: assistant prose is a user surface — engine-class
        // language only, and the scrubbed copy is what persists.
        finalText = scrubVendorNames(finalText);
        await prisma.chatMessage.create({ data: { threadId: thread.id, role: 'assistant', content: finalText } });
        send({ type: 'assistant', text: finalText });

        await prisma.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
        return { threadId: thread.id, assistant: finalText };
          },
        });
        if (operation.state !== 'completed') {
          // Humanized: the raw body ({error:'operation_in_progress',receiptId})
          // used to reach the transcript as "Something broke: undefined".
          const human = humanizeChatError(operationErrorBody(operation).body);
          send({ type: 'error', message: human.text, canRetry: human.canRetry, ...(human.details ? { details: human.details } : {}) });
        } else if (operation.replayed) {
          send({ type: 'thread', threadId: operation.value.threadId, replayed: true });
          send({ type: 'assistant', text: operation.value.assistant, replayed: true });
        }
        send({ type: 'done' });
      } catch (err) {
        req.log.error({ err }, 'chat stream failed');
        // Raw exception text (provider names, response bodies) never reaches
        // the user — one plain sentence + a scrubbed details string.
        const human = humanizeChatError(err as Error);
        send({ type: 'error', message: human.text, canRetry: human.canRetry, ...(human.details ? { details: human.details } : {}) });
      } finally {
        clearInterval(heartbeat);
        reply.raw.end();
      }
    }
  );
}

function artifactsFromTools(
  toolResults: Array<{ name: string; arguments: unknown; output: unknown }>
): Array<{ kind: string; id: string }> {
  const refs: Array<{ kind: string; id: string }> = [];
  for (const tr of toolResults) {
    const out = tr.output as Record<string, unknown> | null | undefined;
    if (!out || typeof out !== 'object') continue;
    if (Array.isArray((out as { hooks?: Array<{ id: string }> }).hooks)) {
      for (const h of (out as { hooks: Array<{ id: string }> }).hooks) refs.push({ kind: 'hook', id: h.id });
    }
    if ((out as { lyric?: { id: string } }).lyric?.id) refs.push({ kind: 'lyric', id: (out as { lyric: { id: string } }).lyric.id });
    if ((out as { jobId?: string }).jobId) refs.push({ kind: 'job', id: (out as { jobId: string }).jobId });
    if ((out as { concept?: { id: string } }).concept?.id)
      refs.push({ kind: 'video_concept', id: (out as { concept: { id: string } }).concept.id });
  }
  return refs;
}

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
import { chatMessageInputSchema } from '@afrohit/shared';
import { prompts, chatWithTools } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { runChatTool } from '../services/chat-tools';

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
 * Every chat needs a project to operate on. If the thread doesn't have one
 * (e.g. the user opened /studio and typed "make me a song" from scratch),
 * lazily create a default artist + project and attach it to the thread. This
 * makes "make me a song" work with zero setup.
 */
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
    hooks: hooks.map((h) => ({ id: h.id, text: h.text, score: h.score, approved: h.approved })),
    latestLyric: lyric,
    latestSong: song,
  };
}

export default async function chat(app: FastifyInstance) {
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

      const thread = body.threadId
        ? await prisma.chatThread.findFirstOrThrow({
            where: { id: body.threadId, workspaceId, userId },
          })
        : await prisma.chatThread.create({
            data: { workspaceId, userId, projectId: body.projectId ?? null, title: body.content.slice(0, 60) },
          });

      // Persist user message
      await prisma.chatMessage.create({
        data: { threadId: thread.id, role: 'user', content: body.content },
      });

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
      });

      const turn = await chatWithTools({
        tools: prompts.STUDIO_CHAT_TOOLS as never,
        messages: [
          { role: 'system', content: prompts.STUDIO_CHAT_SYSTEM },
          { role: 'system', content: `WORKSPACE_CONTEXT=${systemContext}` },
          ...toModelMessages(history),
        ],
        temperature: 0.5,
      });

      const toolResults: Array<{ name: string; arguments: unknown; output: unknown }> = [];

      if (turn.toolCalls?.length) {
        const guard = makeGenGuard();
        for (const call of turn.toolCalls) {
          const gate = guard(call.name);
          const result = gate.allowed
            ? await runChatTool({
                workspaceId,
                userId,
                projectId,
                app,
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
        const finalTurn = await chatWithTools({
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
            { role: 'user', content: 'Summarize and propose the next step.' },
          ],
          temperature: 0.5,
        });

        await prisma.chatMessage.create({
          data: {
            threadId: thread.id,
            role: 'assistant',
            content: finalTurn.text ?? '',
            artifactRefs: artifactsFromTools(toolResults) as never,
          },
        });

        await prisma.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
        reply.code(200);
        return {
          threadId: thread.id,
          assistant: finalTurn.text ?? '',
          toolCalls: toolResults,
        };
      }

      await prisma.chatMessage.create({
        data: { threadId: thread.id, role: 'assistant', content: turn.text ?? '' },
      });
      await prisma.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });

      return { threadId: thread.id, assistant: turn.text ?? '', toolCalls: [] };
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

      try {
        const thread = body.threadId
          ? await prisma.chatThread.findFirstOrThrow({
              where: { id: body.threadId, workspaceId, userId },
            })
          : await prisma.chatThread.create({
              data: { workspaceId, userId, projectId: body.projectId ?? null, title: body.content.slice(0, 60) },
            });
        send({ type: 'thread', threadId: thread.id });

        await prisma.chatMessage.create({
          data: { threadId: thread.id, role: 'user', content: body.content },
        });

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
        for (let round = 1; round <= maxRounds; round++) {
          send({ type: 'stage', stage: autopilot ? `producing (step ${round})` : 'thinking' });
          const turn = await chatWithTools({
            tools: prompts.STUDIO_CHAT_TOOLS as never,
            messages: convo,
            temperature: 0.5,
          });

          if (!turn.toolCalls?.length) {
            finalText = turn.text ?? '';
            break; // model answered / asked — done
          }

          const roundResults: Array<{ name: string; output: unknown }> = [];
          for (const call of turn.toolCalls) {
            send({ type: 'tool_start', name: call.name });
            const gate = guard(call.name);
            const result = gate.allowed
              ? await runChatTool({ workspaceId, userId, projectId, app, name: call.name, args: call.arguments })
              : { skipped: true, reason: gate.reason };
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

          // Feed results back as text (valid OpenAI format — no orphan tool roles).
          convo.push({ role: 'assistant', content: turn.text || '(working)' });
          convo.push({
            role: 'user',
            content:
              `TOOL_RESULTS=${JSON.stringify(roundResults).slice(0, 12_000)}\n\n` +
              (autopilot
                ? 'Continue AUTOPILOT — do the next pipeline step now without asking. Use the real IDs from these results. When the release is bundled, give one final summary and stop.'
                : 'Summarize what you did and propose the next step.'),
          });

          if (!autopilot || round === maxRounds) {
            send({ type: 'stage', stage: 'summarizing' });
            const fin = await chatWithTools({ tools: prompts.STUDIO_CHAT_TOOLS as never, messages: convo, temperature: 0.5 });
            finalText = fin.text ?? finalText;
            break;
          }
        }

        await prisma.chatMessage.create({ data: { threadId: thread.id, role: 'assistant', content: finalText } });
        send({ type: 'assistant', text: finalText });

        await prisma.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
        send({ type: 'done' });
      } catch (err) {
        req.log.error({ err }, 'chat stream failed');
        send({ type: 'error', message: String((err as Error)?.message ?? err) });
      } finally {
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

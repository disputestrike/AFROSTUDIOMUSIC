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

      const project = thread.projectId
        ? await prisma.project.findFirst({
            where: { id: thread.projectId, workspaceId },
            include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } },
          })
        : null;
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { creditsCents: true, plan: true },
      });
      const recentArtifacts = thread.projectId
        ? await prisma.providerJob.findMany({
            where: { projectId: thread.projectId },
            take: 8,
            orderBy: { createdAt: 'desc' },
            select: { id: true, kind: true, status: true, outputJson: true },
          })
        : [];

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
        recentArtifacts,
      });

      const turn = await chatWithTools({
        tools: prompts.STUDIO_CHAT_TOOLS as never,
        messages: [
          { role: 'system', content: prompts.STUDIO_CHAT_SYSTEM },
          { role: 'system', content: `WORKSPACE_CONTEXT=${systemContext}` },
          ...history.map((m) => ({
            role: (m.role === 'tool' ? 'tool' : m.role) as 'user' | 'assistant' | 'tool',
            content: m.content,
          })),
        ],
        temperature: 0.5,
      });

      const toolResults: Array<{ name: string; arguments: unknown; output: unknown }> = [];

      if (turn.toolCalls?.length) {
        for (const call of turn.toolCalls) {
          const result = await runChatTool({
            workspaceId,
            userId,
            projectId: thread.projectId ?? null,
            app,
            name: call.name,
            args: call.arguments,
          });
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
            ...history.map((m) => ({
              role: (m.role === 'tool' ? 'tool' : m.role) as 'user' | 'assistant' | 'tool',
              content: m.content,
            })),
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
      const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

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

        const project = thread.projectId
          ? await prisma.project.findFirst({
              where: { id: thread.projectId, workspaceId },
              include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } },
            })
          : null;
        const workspace = await prisma.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
          select: { creditsCents: true, plan: true },
        });
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
          currentProject: project
            ? { id: project.id, title: project.title, genre: project.genre, bpm: project.bpm }
            : null,
          currentBrief: project?.briefs[0] ?? null,
        });
        const baseMessages = [
          { role: 'system' as const, content: prompts.STUDIO_CHAT_SYSTEM },
          { role: 'system' as const, content: `WORKSPACE_CONTEXT=${systemContext}` },
          ...history.map((m) => ({
            role: (m.role === 'tool' ? 'tool' : m.role) as 'user' | 'assistant' | 'tool',
            content: m.content,
          })),
        ];

        send({ type: 'stage', stage: 'thinking' });
        const turn = await chatWithTools({
          tools: prompts.STUDIO_CHAT_TOOLS as never,
          messages: baseMessages,
          temperature: 0.5,
        });

        const toolResults: Array<{ name: string; arguments: unknown; output: unknown }> = [];
        if (turn.toolCalls?.length) {
          for (const call of turn.toolCalls) {
            send({ type: 'tool_start', name: call.name });
            const result = await runChatTool({
              workspaceId,
              userId,
              projectId: thread.projectId ?? null,
              app,
              name: call.name,
              args: call.arguments,
            });
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
            toolResults.push({ name: call.name, arguments: call.arguments, output: result });
          }
          send({ type: 'stage', stage: 'summarizing' });
          const finalTurn = await chatWithTools({
            tools: prompts.STUDIO_CHAT_TOOLS as never,
            messages: [
              ...baseMessages,
              { role: 'assistant', content: turn.text ?? '' },
              { role: 'system', content: `TOOL_RESULTS=${JSON.stringify(toolResults).slice(0, 12_000)}` },
              { role: 'user', content: 'Summarize and propose the next step.' },
            ],
            temperature: 0.5,
          });
          await prisma.chatMessage.create({
            data: { threadId: thread.id, role: 'assistant', content: finalTurn.text ?? '' },
          });
          send({ type: 'assistant', text: finalTurn.text ?? '' });
        } else {
          await prisma.chatMessage.create({
            data: { threadId: thread.id, role: 'assistant', content: turn.text ?? '' },
          });
          send({ type: 'assistant', text: turn.text ?? '' });
        }

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

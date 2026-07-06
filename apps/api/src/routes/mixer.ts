import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { mixerRenderSchema, mixerAiSchema, type MixerTrack } from '@afrohit/shared';
import { responsesJson } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

type TrackDefaults = Omit<MixerTrack, 'id' | 'kind' | 'label'>;
const DEFAULTS: TrackDefaults = {
  gainDb: 0,
  pan: 0,
  mute: false,
  solo: false,
  eq: { low: 0, mid: 0, high: 0 },
  comp: { on: false, threshold: -18, ratio: 3 },
  reverb: 0,
};

async function resolveSong(workspaceId: string, projectId: string, songId?: string) {
  if (songId) {
    return prisma.song.findFirstOrThrow({ where: { id: songId, projectId, workspaceId } });
  }
  return prisma.song.findFirst({
    where: { projectId, workspaceId },
    orderBy: { createdAt: 'desc' },
  });
}

async function loadTracks(projectId: string, songId: string) {
  const [beats, vocals, lastConsole] = await Promise.all([
    // Only approved assets belong on the console (mix/master/export gate on approved).
    prisma.beatAsset.findMany({ where: { songId, projectId, approved: true }, orderBy: { createdAt: 'asc' } }),
    prisma.vocalRender.findMany({ where: { songId, projectId, approved: true }, orderBy: { createdAt: 'asc' } }),
    prisma.mix.findFirst({
      where: { songId, projectId, preset: 'console' },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const saved = new Map<string, Partial<MixerTrack>>();
  if (Array.isArray(lastConsole?.settings)) {
    for (const s of lastConsole!.settings as Array<Partial<MixerTrack>>) {
      if (s?.id) saved.set(s.id, s);
    }
  }

  const rows: Array<MixerTrack & { url: string }> = [];
  for (const b of beats) {
    const meta = (b.meta ?? {}) as { instrumental?: boolean; title?: string | null };
    rows.push({
      id: b.id,
      kind: 'beat',
      label: meta.instrumental ? 'Instrumental' : meta.title || 'Beat',
      url: b.url,
      ...DEFAULTS,
      ...saved.get(b.id),
    });
  }
  for (const v of vocals) {
    rows.push({
      id: v.id,
      kind: 'vocal',
      label: v.role ? `Vocal · ${v.role}` : 'Vocal',
      url: v.url,
      ...DEFAULTS,
      ...saved.get(v.id),
    });
  }
  return rows;
}

export default async function mixer(app: FastifyInstance) {
  // Load the console: tracks (beat + vocals) with any saved channel settings.
  app.get<{ Params: { projectId: string }; Querystring: { songId?: string } }>(
    '/',
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      const song = await resolveSong(workspaceId, req.params.projectId, req.query.songId);
      if (!song) return { songId: null, tracks: [], message: 'No song yet — generate or upload one first.' };
      const tracks = await loadTracks(req.params.projectId, song.id);
      reply.header('cache-control', 'no-store');
      return { songId: song.id, songTitle: song.title, tracks };
    }
  );

  // Render the mix from the console settings.
  app.post<{ Params: { projectId: string } }>(
    '/render',
    { schema: { body: mixerRenderSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = mixerRenderSchema.parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

      // Match each posted track to a real asset to get its authentic url.
      const [beats, vocals] = await Promise.all([
        prisma.beatAsset.findMany({ where: { songId: input.songId, projectId: project.id } }),
        prisma.vocalRender.findMany({ where: { songId: input.songId, projectId: project.id } }),
      ]);
      const urlById = new Map<string, string>();
      beats.forEach((b) => urlById.set(b.id, b.url));
      vocals.forEach((v) => urlById.set(v.id, v.url));

      const settings = input.tracks
        .filter((t) => urlById.has(t.id))
        .map((t) => ({ ...t, url: urlById.get(t.id)! }));
      if (settings.length === 0) {
        return reply.code(400).send({ error: 'no_matching_tracks' });
      }

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'mix_preset',
        refTable: 'Song',
        refId: input.songId,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'mix',
          provider: 'internal',
          status: 'QUEUED',
          inputJson: { songId: input.songId, preset: 'console' } as never,
        },
      });
      await enqueue({
        queue: app.queues.mix,
        name: 'create-mix',
        payload: {
          jobId: job.id,
          workspaceId,
          projectId: project.id,
          songId: input.songId,
          preset: 'console',
          settings,
        },
      });

      reply.code(202);
      return { jobId: job.id };
    }
  );

  // AI mix: let the model propose a full set of channel settings.
  app.post<{ Params: { projectId: string } }>(
    '/ai',
    { schema: { body: mixerAiSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = mixerAiSchema.parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
        include: { artist: true },
      });
      const tracks = await loadTracks(project.id, input.songId);
      if (tracks.length === 0) return reply.code(400).send({ error: 'no_tracks' });

      const trackList = tracks.map((t) => `- id=${t.id} kind=${t.kind} label="${t.label}"`).join('\n');
      const proposed = await responsesJson<{ tracks: Array<Partial<MixerTrack> & { id: string }> }>({
        system:
          'You are a mixing engineer for Afrobeats / Afro-fusion. Return ONLY JSON. For each track give a channel strip: gainDb (-24..12), pan (-1..1), mute, solo, eq{low,mid,high in dB -12..12 @110Hz/1.5kHz/8kHz}, comp{on,threshold dB,ratio}, reverb (0..1). Beats sit slightly back and wide; lead vocals forward, centred, present, light compression + a touch of reverb; doubles panned, harmonies wider and lower. Be tasteful, not extreme.',
        user: `Song: ${project.title}. Goal: ${input.goal ?? 'radio-ready, vocal-forward Afro-fusion'}.\nTracks:\n${trackList}\nReturn {"tracks":[{"id":...,"gainDb":...,"pan":...,"mute":false,"solo":false,"eq":{"low":..,"mid":..,"high":..},"comp":{"on":..,"threshold":..,"ratio":..},"reverb":..}]}`,
        temperature: 0.4,
        maxOutputTokens: 2_000,
      });

      // Merge AI values onto defaults, keyed by id (ignore unknown ids).
      const byId = new Map(proposed?.tracks?.map((t) => [t.id, t]) ?? []);
      const merged = tracks.map((t) => ({ ...t, ...(byId.get(t.id) ?? {}), id: t.id, kind: t.kind, label: t.label, url: undefined }));
      return { songId: input.songId, tracks: merged };
    }
  );
}

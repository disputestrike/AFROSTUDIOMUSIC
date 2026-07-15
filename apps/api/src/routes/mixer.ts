import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { mixerAiSchema, mixerRenderSchema, selectDefaultSessionAssets, type MixerTrack } from '@afrohit/shared';
import { responsesJson } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';

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
  if (songId) return prisma.song.findFirstOrThrow({ where: { id: songId, projectId, workspaceId } });
  return prisma.song.findFirst({ where: { projectId, workspaceId }, orderBy: { createdAt: 'desc' } });
}

const mixableVocalWhere = {
  approved: true,
  assetKind: 'isolated_vocal',
  qualityState: 'passed',
  contentHash: { not: null },
  verifiedAt: { not: null },
} as const;

const mixableBeatWhere = {
  approved: true,
  assetKind: 'instrumental',
  qualityState: 'passed',
  contentHash: { not: null },
  verifiedAt: { not: null },
} as const;

type BeatRow = { id: string; createdAt: Date; meta: unknown };
type VocalRow = {
  id: string;
  createdAt: Date;
  role: string;
  approved: boolean;
  assetKind: string;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: Date | null;
};

async function loadTracks(projectId: string, songId: string): Promise<MixerTrack[]> {
  const [allBeats, allVocals, lastConsole] = await Promise.all([
    prisma.beatAsset.findMany({
      where: { songId, projectId, ...mixableBeatWhere },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.vocalRender.findMany({
      where: { songId, projectId, ...mixableVocalWhere },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.mix.findFirst({
      where: { songId, projectId, preset: 'console', approved: true, qualityState: 'passed' },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const { beats, vocals } = selectDefaultSessionAssets(
    allBeats as BeatRow[],
    allVocals as VocalRow[],
  );
  const saved = new Map<string, Partial<MixerTrack>>();
  if (Array.isArray(lastConsole?.settings)) {
    for (const setting of lastConsole.settings as Array<Partial<MixerTrack>>) {
      if (setting?.id) saved.set(setting.id, setting);
    }
  }

  const rows: MixerTrack[] = [];
  for (const beat of beats) {
    const meta = (beat.meta ?? {}) as { instrumental?: boolean; title?: string | null };
    rows.push({
      ...DEFAULTS,
      ...saved.get(beat.id),
      id: beat.id,
      kind: 'beat',
      label: meta.instrumental ? 'Instrumental' : meta.title || 'Beat',
    });
  }
  for (const vocal of vocals) {
    rows.push({
      ...DEFAULTS,
      ...saved.get(vocal.id),
      id: vocal.id,
      kind: 'vocal',
      label: vocal.role ? `Vocal - ${vocal.role}` : 'Vocal',
    });
  }
  return rows;
}

export default async function mixer(app: FastifyInstance) {
  app.get<{ Params: { projectId: string }; Querystring: { songId?: string } }>('/', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
    const song = await resolveSong(workspaceId, req.params.projectId, req.query.songId);
    if (!song) return { songId: null, tracks: [], message: 'No song yet - generate or upload one first.' };
    const tracks = await loadTracks(req.params.projectId, song.id);
    reply.header('cache-control', 'no-store');
    return { songId: song.id, songTitle: song.title, tracks };
  });

  app.post<{ Params: { projectId: string } }>(
    '/render',
    { schema: { body: mixerRenderSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = mixerRenderSchema.parse(req.body);
      const project = await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      await prisma.song.findFirstOrThrow({ where: { id: input.songId, projectId: project.id, workspaceId } });
      const ids = [...new Set(input.tracks.map((track) => track.id))];
      const [beats, vocals] = await Promise.all([
        prisma.beatAsset.findMany({
          where: { id: { in: ids }, songId: input.songId, projectId: project.id, ...mixableBeatWhere },
          select: { id: true },
        }),
        prisma.vocalRender.findMany({
          where: { id: { in: ids }, songId: input.songId, projectId: project.id, ...mixableVocalWhere },
          select: { id: true },
        }),
      ]);
      const kindById = new Map<string, 'beat' | 'vocal'>([
        ...beats.map((beat: { id: string }) => [beat.id, 'beat'] as const),
        ...vocals.map((vocal: { id: string }) => [vocal.id, 'vocal'] as const),
      ]);
      const invalidIds = ids.filter((id) => !kindById.has(id));
      if (invalidIds.length) {
        return reply.code(400).send({ error: 'unapproved_or_invalid_tracks', invalidIds });
      }
      const settings = input.tracks.map(({ label: _label, ...track }) => ({
        ...track,
        kind: kindById.get(track.id)!,
      }));

      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'mixer-console');
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'mix_preset',
        refTable: 'Song',
        refId: input.songId,
        idempotencyKey,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.mix,
        jobName: 'create-mix',
        workspaceId,
        projectId: project.id,
        kind: 'mix',
        provider: 'internal',
        inputJson: { songId: input.songId, preset: 'console', trackIds: ids },
        charge,
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          projectId: project.id,
          songId: input.songId,
          preset: 'console',
          settings,
        }),
      });
      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    },
  );

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
      await prisma.song.findFirstOrThrow({ where: { id: input.songId, projectId: project.id, workspaceId } });
      const tracks = await loadTracks(project.id, input.songId);
      if (!tracks.length) return reply.code(400).send({ error: 'no_verified_tracks' });
      const trackList = tracks.map((track) => `- id=${track.id} kind=${track.kind} label="${track.label}"`).join('\n');
      const proposed = await responsesJson<{ tracks: Array<Partial<MixerTrack> & { id: string }> }>({
        system: 'You are a mixing engineer for Afrobeats and Afro-fusion. Return only JSON. For each track give gainDb (-24..12), pan (-1..1), mute, solo, eq {low,mid,high from -12..12 dB}, comp {on,threshold from -40..0,ratio from 1..20}, and reverb (0..1). Keep the verified lead centered and forward, the instrumental below it, and support vocals lower and wider. Avoid extreme values.',
        user: `Song: ${project.title}. Goal: ${input.goal ?? 'radio-ready, vocal-forward Afro-fusion'}.\nTracks:\n${trackList}\nReturn {"tracks":[{"id":"...","gainDb":0,"pan":0,"mute":false,"solo":false,"eq":{"low":0,"mid":0,"high":0},"comp":{"on":true,"threshold":-18,"ratio":3},"reverb":0.1}]}`,
        temperature: 0.4,
        maxOutputTokens: 2_000,
      });
      const byId = new Map(proposed?.tracks?.map((track) => [track.id, track]) ?? []);
      const merged = tracks.map((track) => ({
        ...track,
        ...(byId.get(track.id) ?? {}),
        id: track.id,
        kind: track.kind,
        label: track.label,
      }));
      return { songId: input.songId, tracks: merged };
    },
  );
}

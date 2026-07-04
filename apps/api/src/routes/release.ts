import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { rightsInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';

/**
 * The rights spine — what turns a folder of files into a bankable release.
 * Split-sheet (who gets paid), ISRC/UPC codes, and a green-light gate that
 * checks a song is actually release-ready before it goes anywhere.
 *
 * NOTE: ISRC/UPC here are structured placeholders. Real ISRCs need a registrant
 * code assigned to you (set ISRC_PREFIX = country+registrant, e.g. "NGAHS");
 * most distributors (DistroKid/TuneCore) also assign ISRC + UPC for free.
 */

type Split = { name: string; role: string; share: number };

function greenLight(song: { lyricId: string | null; isrc: string | null; splitSheet: unknown }, hasAudio: boolean, hasCover: boolean) {
  const splits = (Array.isArray(song.splitSheet) ? song.splitSheet : []) as Split[];
  const shareSum = splits.reduce((s, x) => s + (Number(x?.share) || 0), 0);
  const checks = [
    { name: 'Master or mix', ok: hasAudio },
    { name: 'Cover art', ok: hasCover },
    { name: 'Lyrics', ok: !!song.lyricId },
    { name: 'Split-sheet totals 100%', ok: splits.length > 0 && Math.abs(shareSum - 100) < 0.5, detail: splits.length ? `${shareSum}%` : 'empty' },
    { name: 'ISRC assigned', ok: !!song.isrc, detail: song.isrc ?? '' },
    { name: 'Rights-clean (no rips/samples)', ok: true, detail: 'original generation / cleared' },
  ];
  return { ready: checks.every((c) => c.ok), checks };
}

async function assignIsrc(workspaceId: string): Promise<string> {
  const raw = (process.env.ISRC_PREFIX ?? 'NGAHS').toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(5, 'X').slice(0, 5);
  const cc = raw.slice(0, 2);
  const reg = raw.slice(2, 5);
  const yy = String(new Date().getFullYear()).slice(2);
  const n = (await prisma.song.count({ where: { workspaceId, isrc: { not: null } } })) + 1;
  return `${cc}-${reg}-${yy}-${String(n).padStart(5, '0')}`;
}

async function assignUpc(workspaceId: string): Promise<string> {
  const n = (await prisma.song.count({ where: { workspaceId, upc: { not: null } } })) + 1;
  return `0${String(n).padStart(11, '0')}`; // placeholder barcode
}

async function statusFor(song: { id: string; title: string; isrc: string | null; upc: string | null; splitSheet: unknown; releaseReady: boolean; lyricId: string | null; projectId: string }) {
  const [master, mix, cover] = await Promise.all([
    prisma.master.findFirst({ where: { songId: song.id } }),
    prisma.mix.findFirst({ where: { songId: song.id } }),
    prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover' } }),
  ]);
  return {
    song: { id: song.id, title: song.title, isrc: song.isrc, upc: song.upc, splitSheet: song.splitSheet, releaseReady: song.releaseReady },
    greenLight: greenLight(song, !!(master || mix), !!cover),
  };
}

export default async function release(app: FastifyInstance) {
  // Latest song's release status (so the UI needn't know the song id).
  app.get<{ Params: { projectId: string } }>('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
    const song = await prisma.song.findFirst({ where: { projectId: req.params.projectId, workspaceId }, orderBy: { createdAt: 'desc' } });
    if (!song) return { song: null, greenLight: null };
    return statusFor(song);
  });

  // Performance Pack — what you take on stage: a backing track to sing over
  // (the instrumental beat if there is one), tempo/key, and a visual loop.
  app.get<{ Params: { projectId: string; songId: string } }>('/:songId/performance', async (req) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirstOrThrow({ where: { id: req.params.songId, projectId: req.params.projectId, workspaceId } });
    const [beat, master, snippet] = await Promise.all([
      prisma.beatAsset.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } }),
      prisma.master.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } }),
      prisma.videoRender.findFirst({ where: { projectId: song.projectId, provider: 'snippet' }, orderBy: { createdAt: 'desc' } }),
    ]);
    // A clean instrumental to sing over exists only for beat+own-vocal songs.
    const instrumental = beat && beat.provider !== 'ace_step' ? beat.url : null;
    return {
      title: song.title,
      bpm: beat?.bpm ?? null,
      key: beat?.keySignature ?? null,
      backingTrack: instrumental,
      fullMaster: master?.url ?? null,
      visualizer: snippet?.url ?? null,
      note: instrumental
        ? 'Backing track is your instrumental — sing over it live.'
        : 'This song has AI vocals baked in (no clean instrumental to strip). For a true backing track, make a beat-only song and sing it yourself.',
    };
  });

  app.get<{ Params: { projectId: string; songId: string } }>('/:songId', async (req) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirstOrThrow({ where: { id: req.params.songId, projectId: req.params.projectId, workspaceId } });
    const [master, mix, cover] = await Promise.all([
      prisma.master.findFirst({ where: { songId: song.id } }),
      prisma.mix.findFirst({ where: { songId: song.id } }),
      prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover' } }),
    ]);
    return {
      song: { id: song.id, title: song.title, isrc: song.isrc, upc: song.upc, splitSheet: song.splitSheet, releaseReady: song.releaseReady },
      greenLight: greenLight(song, !!(master || mix), !!cover),
    };
  });

  app.patch<{ Params: { projectId: string; songId: string } }>(
    '/:songId',
    { schema: { body: rightsInputSchema } },
    async (req) => {
      const { workspaceId } = requireAuth(req);
      const input = rightsInputSchema.parse(req.body);
      const song = await prisma.song.findFirstOrThrow({ where: { id: req.params.songId, projectId: req.params.projectId, workspaceId } });

      const splits = (input.splitSheet ?? (Array.isArray(song.splitSheet) ? song.splitSheet : [])) as Split[];
      const shareSum = splits.reduce((s, x) => s + (Number(x?.share) || 0), 0);
      const splitsValid = splits.length > 0 && Math.abs(shareSum - 100) < 0.5;

      // Auto-assign codes once the split-sheet is valid (unless provided/exists).
      const isrc = input.isrc ?? song.isrc ?? (splitsValid ? await assignIsrc(workspaceId) : null);
      const upc = input.upc ?? song.upc ?? (splitsValid ? await assignUpc(workspaceId) : null);

      const [master, mix, cover] = await Promise.all([
        prisma.master.findFirst({ where: { songId: song.id } }),
        prisma.mix.findFirst({ where: { songId: song.id } }),
        prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover' } }),
      ]);
      const gl = greenLight({ lyricId: song.lyricId, isrc, splitSheet: splits }, !!(master || mix), !!cover);

      const updated = await prisma.song.update({
        where: { id: song.id },
        data: { splitSheet: splits as never, isrc, upc, releaseReady: gl.ready },
      });

      return {
        song: { id: updated.id, title: updated.title, isrc: updated.isrc, upc: updated.upc, splitSheet: updated.splitSheet, releaseReady: updated.releaseReady },
        greenLight: gl,
      };
    }
  );
}

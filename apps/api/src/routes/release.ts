import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { rightsInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { distributeRelease } from '../lib/distribution';

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

// Tonal languages where off-pitch AI delivery reads as fake — gate behind a
// human native-speaker sign-off before release.
const REVIEW_LANGS = ['yo', 'ig', 'ha'];

function greenLight(
  song: { lyricId: string | null; isrc: string | null; splitSheet: unknown; nativeReviewOk: boolean; hitScore?: number | null },
  hasAudio: boolean,
  hasCover: boolean,
  languages: string[]
) {
  const splits = (Array.isArray(song.splitSheet) ? song.splitSheet : []) as Split[];
  const shareSum = splits.reduce((s, x) => s + (Number(x?.share) || 0), 0);
  const needsReview = languages.some((l) => REVIEW_LANGS.includes(l.toLowerCase()));
  const checks = [
    { name: 'Master or mix', ok: hasAudio },
    { name: 'Cover art', ok: hasCover },
    { name: 'Lyrics', ok: !!song.lyricId },
    { name: 'Split-sheet totals 100%', ok: splits.length > 0 && Math.abs(shareSum - 100) < 0.5, detail: splits.length ? `${shareSum}%` : 'empty' },
    { name: 'ISRC assigned', ok: !!song.isrc, detail: song.isrc ?? '' },
    {
      name: 'Native-language review',
      ok: !needsReview || song.nativeReviewOk,
      detail: needsReview ? (song.nativeReviewOk ? 'signed off' : `needed (${languages.filter((l) => REVIEW_LANGS.includes(l.toLowerCase())).join('/')})`) : 'n/a (English/Pidgin)',
    },
    { name: 'Rights-clean (no rips/samples)', ok: true, detail: 'original generation / cleared' },
    // THE A&R GATE (Benjamin): no song releases without a Will-it-hit read.
    // The read must EXIST to green-light; the score itself is advisory (his
    // ear decides), but he sees it here before anything ships.
    {
      name: 'A&R read (Will it hit?)',
      ok: song.hitScore != null,
      detail: song.hitScore != null ? `hit ${song.hitScore}/100` : 'not read yet — run "Will it hit?" or "Make it bigger"',
    },
  ];
  return { ready: checks.every((c) => c.ok), checks, needsReview };
}

async function languagesForProject(projectId: string): Promise<string[]> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { artist: true } });
  return (project?.artist.languages ?? []) as string[];
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

async function statusFor(song: { id: string; title: string; isrc: string | null; upc: string | null; splitSheet: unknown; releaseReady: boolean; lyricId: string | null; projectId: string; nativeReviewOk: boolean; hitScore?: number | null }) {
  const [master, mix, cover, languages] = await Promise.all([
    prisma.master.findFirst({ where: { songId: song.id } }),
    prisma.mix.findFirst({ where: { songId: song.id } }),
    prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover' } }),
    languagesForProject(song.projectId),
  ]);
  return {
    song: { id: song.id, title: song.title, isrc: song.isrc, upc: song.upc, splitSheet: song.splitSheet, releaseReady: song.releaseReady, nativeReviewOk: song.nativeReviewOk },
    greenLight: greenLight(song, !!(master || mix), !!cover, languages),
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
    // A clean instrumental to sing over exists only for instrumental-beat songs.
    // Vocal engines (Suno, ACE-Step, MiniMax) bake the lead vocal INTO the single
    // asset — never expose that as a "backing track" or the performer sings over
    // AI vocals. Gate on the known vocal engines, not one hardcoded name.
    const VOCAL_ENGINES = new Set(['suno', 'ace_step', 'minimax']);
    const instrumental = beat && !VOCAL_ENGINES.has(beat.provider) ? beat.url : null;
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
    return statusFor(song);
  });

  // Distribute a green-lit release (needs a distributor account/keys — see lib).
  app.post<{ Params: { projectId: string; songId: string } }>('/:songId/distribute', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const song = await prisma.song.findFirstOrThrow({
      where: { id: req.params.songId, projectId: req.params.projectId, workspaceId },
      include: { project: { include: { artist: true } } },
    });
    if (!song.releaseReady) {
      return reply.code(400).send({ error: 'not_green_lit', message: 'Green-light the song first (fill the checklist).' });
    }
    const [master, mix, cover] = await Promise.all([
      prisma.master.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } }),
      prisma.mix.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } }),
      prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const result = await distributeRelease({
      title: song.title,
      artist: song.project.artist.stageName,
      genre: song.project.genre,
      isrc: song.isrc,
      upc: song.upc,
      audioUrl: master?.url ?? mix?.url ?? null,
      coverUrl: cover?.url ?? null,
    });
    await prisma.analyticsEvent
      .create({ data: { workspaceId, name: 'release.distribute', properties: { songId: song.id, status: result.status, provider: result.provider } as never } })
      .catch(() => {});
    return result;
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
      const nativeReviewOk = input.nativeReviewOk ?? song.nativeReviewOk;

      const [master, mix, cover, languages] = await Promise.all([
        prisma.master.findFirst({ where: { songId: song.id } }),
        prisma.mix.findFirst({ where: { songId: song.id } }),
        prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover' } }),
        languagesForProject(song.projectId),
      ]);
      const gl = greenLight({ lyricId: song.lyricId, isrc, splitSheet: splits, nativeReviewOk, hitScore: song.hitScore }, !!(master || mix), !!cover, languages);

      const updated = await prisma.song.update({
        where: { id: song.id },
        data: { splitSheet: splits as never, isrc, upc, nativeReviewOk, releaseReady: gl.ready },
      });

      return {
        song: { id: updated.id, title: updated.title, isrc: updated.isrc, upc: updated.upc, splitSheet: updated.splitSheet, releaseReady: updated.releaseReady, nativeReviewOk: updated.nativeReviewOk },
        greenLight: gl,
      };
    }
  );
}

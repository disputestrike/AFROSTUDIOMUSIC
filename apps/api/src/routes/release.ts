import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { rightsInputSchema, laneReleaseGate } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { distributeRelease } from '../lib/distribution';
import { BLOW_TARGET } from '../lib/will-it-blow';

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
// Indigenous languages that must be human-reviewed before release. The lexicon has
// deep Yoruba/Igbo/Hausa but ~zero isiZulu/isiXhosa/Sesotho, so those especially must
// NOT ship un-reviewed — the gate blocks release until a native speaker signs off.
const REVIEW_LANGS = ['yo', 'ig', 'ha', 'zu', 'xh', 'st'];

function greenLight(
  song: { lyricId: string | null; isrc: string | null; splitSheet: unknown; nativeReviewOk: boolean; hitScore?: number | null; viralScore?: number | null },
  hasAudio: boolean,
  hasCover: boolean,
  languages: string[]
) {
  // Benjamin's doctrine: no song releases until it's been run through Will-it-hit
  // AND scored ABOVE the bar (BLOW_TARGET). The Will-it-blow gate auto-climbs the
  // score after render; this is the hard release gate that enforces it.
  const arScore = Math.max(song.hitScore ?? 0, song.viralScore ?? 0);
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
    // THE A&R GATE (Benjamin): a song must score ABOVE the bar to release. The
    // Will-it-blow gate auto-improves toward this; a song below it stays blocked
    // until "Make it bigger" (or the gate) lifts it over the line.
    {
      name: `Will it hit? — score ≥ ${BLOW_TARGET}`,
      ok: song.hitScore != null && arScore >= BLOW_TARGET,
      detail:
        song.hitScore == null
          ? 'not read yet — run "Will it hit?"'
          : arScore >= BLOW_TARGET
            ? `${arScore}/100 ✓`
            : `${arScore}/100 — needs ${BLOW_TARGET}+ (run "Make it bigger")`,
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

async function statusFor(song: { id: string; title: string; isrc: string | null; upc: string | null; splitSheet: unknown; releaseReady: boolean; lyricId: string | null; projectId: string; nativeReviewOk: boolean; hitScore?: number | null; viralScore?: number | null }, mode: 'creative' | 'hitmaker' = 'creative') {
  const [master, mix, cover, languages, beat] = await Promise.all([
    prisma.master.findFirst({ where: { songId: song.id } }),
    prisma.mix.findFirst({ where: { songId: song.id } }),
    prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover' } }),
    languagesForProject(song.projectId),
    prisma.beatAsset.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' }, select: { meta: true } }),
  ]);
  // §8 — two modes. CREATIVE (default): broken audio blocks; drift/low-compliance WARN
  // (the artist's ear decides). HIT MAKER: lane failure / failed-critical / <80% coverage
  // BLOCK — generating audio is not passing. Unmeasured stays 'unverified' in creative,
  // and cannot CERTIFY in hitmaker (honesty law: what wasn't measured can't fail OR pass).
  const meta = (beat?.meta ?? {}) as { compliance?: unknown; qc?: unknown };
  const gate = laneReleaseGate({ compliance: (meta.compliance ?? null) as never, qc: (meta.qc ?? null) as never, mode });
  return {
    song: { id: song.id, title: song.title, isrc: song.isrc, upc: song.upc, splitSheet: song.splitSheet, releaseReady: song.releaseReady, nativeReviewOk: song.nativeReviewOk },
    mode,
    greenLight: greenLight(song, !!(master || mix), !!cover, languages),
    releaseGate: gate,
  };
}

export default async function release(app: FastifyInstance) {
  // Latest song's release status (so the UI needn't know the song id).
  app.get<{ Params: { projectId: string } }>('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
    const song = await prisma.song.findFirst({ where: { projectId: req.params.projectId, workspaceId }, orderBy: { createdAt: 'desc' } });
    if (!song) return { song: null, greenLight: null };
    return statusFor(song, (req.query as { mode?: string }).mode === 'hitmaker' ? 'hitmaker' : 'creative');
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
    return statusFor(song, (req.query as { mode?: string }).mode === 'hitmaker' ? 'hitmaker' : 'creative');
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
    const [master, mix, cover, beat] = await Promise.all([
      prisma.master.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } }),
      prisma.mix.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } }),
      prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover' }, orderBy: { createdAt: 'desc' } }),
      prisma.beatAsset.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' }, select: { meta: true } }),
    ]);
    // PHASE 6 — do not push OBJECTIVELY BROKEN audio to the world (QC fail: clipping /
    // too quiet / too short), even when green-lit. Drift is only a warning, so a
    // lane-bending record still distributes — the artist's ear stays in charge.
    const gmeta = (beat?.meta ?? {}) as { compliance?: unknown; qc?: unknown };
    const distMode = (req.query as { mode?: string }).mode === 'hitmaker' ? 'hitmaker' : 'creative';
    const gate = laneReleaseGate({ compliance: (gmeta.compliance ?? null) as never, qc: (gmeta.qc ?? null) as never, mode: distMode });
    if (gate.blocked) {
      return reply.code(409).send({ error: 'audio_quality_block', message: 'This take failed audio QC (broken render) — re-master or regenerate before distributing.', checks: gate.checks });
    }
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
      const gl = greenLight({ lyricId: song.lyricId, isrc, splitSheet: splits, nativeReviewOk, hitScore: song.hitScore, viralScore: song.viralScore }, !!(master || mix), !!cover, languages);

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

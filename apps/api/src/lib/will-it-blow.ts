/**
 * WILL-IT-BLOW GATE — Benjamin's doctrine, finally automatic.
 *
 * "Run EVERYTHING through Will-it-hit before release. If it won't blow, master it
 * / do the things to make it blow — automatically, before I ever see it."
 *
 * Until now the studio only SCORED each song (advisory) and left "Make it bigger"
 * as a manual button. This gate closes the loop: after a song renders it is scored,
 * and if the score is below the bar it AUTOMATICALLY applies the A&R engine's own
 * recommendations (rewrite the lyric executing every toMakeItBigger note + fix the
 * risks → re-sing → auto-master → re-score), up to MAX_PASSES — and it KEEPS THE
 * BEST-SCORING VERSION, so a re-sing can never ship something WORSE than what we had.
 *
 * Honest scope: predictHit reads the song's WRITING (title/hook/lyrics/genre/trends
 * + whether it's mastered), not the raw audio, so this loop strengthens the song's
 * commercial WRITING. Sonic quality is the engine + mastering (handled separately).
 * It cannot GUARANTEE a hit — it applies the A&R's concrete fixes and keeps the best.
 *
 * Cost-aware + detached: only below-bar songs spend a pass; each pass respects the
 * daily credit cap (a failed charge stops the loop cleanly); nothing blocks the
 * drop response. Tunables: WILL_IT_BLOW_TARGET (default 70, the 0-100 bar),
 * WILL_IT_BLOW_MAX_PASSES (default 1, max 3; set 0 to score-only like before).
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { generateJson, prompts, soundBrief, enrichLyricsForVocals, type HitPrediction } from '@afrohit/ai';
import { learnedReferenceBrief } from './learned';
import { arReadSong } from './ar-read';
import { enqueue } from './queue';

const TARGET = Number(process.env.WILL_IT_BLOW_TARGET ?? 70);
// DEFAULT SCORE-ONLY (0 passes). The auto-improve re-sing doubles render volume,
// and on the owner's burst-limited Replicate account that flooded the queue and
// left songs stuck 20-30 min. So by default the gate SCORES every song (the
// Will-it-hit read every song asked for) but does NOT auto-re-sing. Turn the
// auto-improve back on with WILL_IT_BLOW_MAX_PASSES=1 once there's render capacity
// (a Suno key or a higher Replicate tier). "Make it bigger" is still manual anytime.
const MAX_PASSES = Math.max(0, Math.min(Number(process.env.WILL_IT_BLOW_MAX_PASSES ?? 0), 3));

/** The bar: the BETTER of hit vs viral clears TARGET (a strong viral moment counts). */
const bestOf = (hit?: number | null, viral?: number | null) => Math.max(hit ?? 0, viral ?? 0);
const blows = (hit?: number | null, viral?: number | null) => bestOf(hit, viral) >= TARGET;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitForJob(jobId: string, maxTicks = 90): Promise<boolean> {
  for (let t = 0; t < maxTicks; t++) {
    await sleep(10_000);
    const j = await prisma.providerJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!j || j.status === 'FAILED') return false;
    if (j.status === 'SUCCEEDED') return true;
  }
  return false;
}

export interface ImproveResult {
  jobId: string;
  whatChanged: string[];
}
const IMPROVE_ERRORS = ['song_not_found', 'no_lyrics', 'a&r_unavailable', 'insufficient_credits', 'rewrite_failed'] as const;
export type ImproveError = (typeof IMPROVE_ERRORS)[number];

/**
 * ONE improvement pass, shared by the manual "Make it bigger" button and the
 * automatic gate: Claude rewrites the lyric executing every A&R note, then
 * re-sings with the same engine (auto-masters + re-scores when it lands).
 * Returns the render jobId, or an error string (no lyric / out of credits / …).
 */
export async function improveSongOnce(
  app: FastifyInstance,
  workspaceId: string,
  songId: string,
  opts?: { delayMs?: number }
): Promise<ImproveResult | { error: ImproveError }> {
  const song = await prisma.song.findFirst({
    where: { id: songId, workspaceId },
    include: { project: { include: { artist: true } }, lyric: true, beats: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!song) return { error: 'song_not_found' };
  if (!song.lyric?.body) return { error: 'no_lyrics' };

  // The notes to implement — the stored read, or a fresh one right now.
  let read = song.hitRead as { toMakeItBigger?: string[]; risks?: string[] } | null;
  if (!read?.toMakeItBigger?.length) {
    read = await arReadSong(app, workspaceId, songId);
    if (!read) return { error: 'a&r_unavailable' };
  }

  const lyricCharge = await app.chargeCredits({ workspaceId, key: 'lyrics_full', refTable: 'Song', refId: songId });
  if (!lyricCharge.ok) return { error: 'insufficient_credits' };

  const genre = song.project.genre;
  const rewritten = await generateJson<{ title: string; body: string; whatChanged: string[] }>({
    system: prompts.LYRIC_SYSTEM,
    user:
      `REWRITE this song implementing the A&R notes — a NEW, BIGGER version, not a patch. Keep the song's identity (same story, mood, language mix) but execute EVERY note.\n\n` +
      `CURRENT LYRIC:\n${song.lyric.body.slice(0, 4000)}\n\n` +
      `A&R NOTES TO IMPLEMENT:\n${(read.toMakeItBigger ?? []).map((n) => `- ${n}`).join('\n')}\n\n` +
      `RISKS TO FIX:\n${(read.risks ?? []).map((n) => `- ${n}`).join('\n')}\n\n` +
      [soundBrief(genre).brief, prompts.hitCraftBrief('lyric')].filter(Boolean).join('\n\n') +
      `\n\nReturn strict JSON: title, body (the full rewritten lyric), whatChanged (3-5 one-line notes on what you executed).`,
    temperature: 0.8,
    maxTokens: 4000,
  });
  if (!rewritten?.body) return { error: 'rewrite_failed' };

  await prisma.lyricDraft.update({
    where: { id: song.lyric.id },
    data: { title: rewritten.title || song.lyric.title, body: rewritten.body, approved: true },
  });
  await prisma.song.update({
    where: { id: song.id },
    data: { versionLabel: 'bigger (A&R notes applied)', hitScore: null, viralScore: null },
  });

  // Re-sing with the rewritten lyric; the worker auto-masters, then we re-score.
  const dna = soundBrief(genre);
  const learned = await learnedReferenceBrief(workspaceId, genre);
  let lyricsForSong = rewritten.body;
  let styleHints: string[] = [];
  const enriched = await enrichLyricsForVocals({
    lyricBody: rewritten.body,
    languages: song.project.artist.languages,
    laneSummary: song.project.artist.laneSummary ?? undefined,
    soundDna: [dna.brief, learned].filter(Boolean).join('\n\n'),
  });
  if (enriched) {
    lyricsForSong = enriched.enrichedLyrics;
    styleHints = enriched.styleTags;
  }
  const prev = song.beats[0]?.provider ?? '';
  const songEngine = ['suno', 'minimax', 'ace_step'].includes(prev) ? (prev as 'suno' | 'ace_step' | 'minimax') : undefined;
  const renderCharge = await app.chargeCredits({ workspaceId, key: 'full_song_demo', refTable: 'Song', refId: songId });
  if (!renderCharge.ok) return { error: 'insufficient_credits' };
  const job = await prisma.providerJob.create({
    data: { workspaceId, projectId: song.projectId, kind: 'music', provider: songEngine ?? 'suno', status: 'QUEUED', inputJson: { makeItBigger: true, songId } as never },
  });
  await enqueue({
    queue: app.queues.music,
    name: 'generate-music',
    // The automatic gate passes a small delay so its background re-sings queue
    // BEHIND fresh user-initiated renders — the quality loop must never make
    // someone waiting on the Create page sit longer. The manual button omits it.
    ...(opts?.delayMs ? { delayMs: opts.delayMs } : {}),
    payload: {
      jobId: job.id, workspaceId, projectId: song.projectId, songId,
      input: {
        genre, bpm: song.project.bpm ?? 103, withVocals: true, withStems: false, songEngine,
        lyrics: lyricsForSong,
        artistTone: song.project.artist.vocalTone, languages: song.project.artist.languages,
        dnaTags: [...(dna.tags ?? []), ...styleHints.slice(0, 3)],
      },
    },
  });
  return { jobId: job.id, whatChanged: rewritten.whatChanged ?? [] };
}

/** Snapshot the current release audio (freshest master) + lyric, so we can
 * RESTORE it if a later re-sing scores worse — the "keep the best" guarantee. */
async function snapshot(songId: string) {
  const [master, lyric] = await Promise.all([
    prisma.master.findFirst({ where: { songId }, orderBy: { createdAt: 'desc' }, select: { url: true, loudness: true, preset: true } }),
    prisma.lyricDraft.findFirst({ where: { songId }, orderBy: { createdAt: 'desc' }, select: { id: true, body: true, title: true } }),
  ]);
  return { master, lyric };
}

/**
 * Promote the best version back to being the RELEASE audio WITHOUT re-rendering
 * or re-mastering (no dulling): a newer Master row pointing at the best master's
 * URL becomes the freshest, which is what the catalog/release serve. Also restore
 * the best lyric and stored score. Called only when a pass REGRESSED.
 */
async function restoreBest(songId: string, best: Awaited<ReturnType<typeof snapshot>>, bestPred: HitPrediction) {
  const song = await prisma.song.findUnique({ where: { id: songId }, select: { projectId: true } });
  if (song && best.master?.url) {
    const mix = await prisma.mix.create({
      data: { projectId: song.projectId, songId, preset: 'source', url: best.master.url, notes: 'Restored best take (will-it-blow gate)', approved: true },
    });
    await prisma.master.create({
      data: { projectId: song.projectId, songId, mixId: mix.id, preset: best.master.preset, url: best.master.url, loudness: best.master.loudness, approved: true },
    }).catch(() => {});
  }
  if (best.lyric?.body) {
    await prisma.lyricDraft.update({ where: { id: best.lyric.id }, data: { body: best.lyric.body, title: best.lyric.title ?? undefined } }).catch(() => {});
  }
  await prisma.song.update({
    where: { id: songId },
    data: { hitScore: bestPred.hitScore, viralScore: bestPred.viralScore, hitRead: bestPred as never },
  }).catch(() => {});
}

/** Stamp the gate outcome onto the stored read so the catalog/release can show
 * "blows / still needs work" and how many passes it took. */
async function stampOutcome(songId: string, bestScore: number, passes: number, willBlow: boolean) {
  const song = await prisma.song.findUnique({ where: { id: songId }, select: { hitRead: true } });
  const read = (song?.hitRead ?? {}) as Record<string, unknown>;
  await prisma.song.update({
    where: { id: songId },
    data: { hitRead: { ...read, willBlow, blowPasses: passes, bestScore } as never },
  }).catch(() => {});
}

async function runGateForSong(app: FastifyInstance, workspaceId: string, songId: string, renderJobId: string) {
  try {
    if (!(await waitForJob(renderJobId))) return; // the initial render must land first
    let pred = await arReadSong(app, workspaceId, songId);
    if (!pred) return;
    let bestScore = bestOf(pred.hitScore, pred.viralScore);
    let bestPred = pred;
    let best = await snapshot(songId);

    let passes = 0;
    while (!blows(pred.hitScore, pred.viralScore) && passes < MAX_PASSES) {
      passes++;
      // 45s delay: the gate's re-sing yields to any fresh user render in the queue.
      const imp = await improveSongOnce(app, workspaceId, songId, { delayMs: 45_000 });
      if ('error' in imp) break; // out of credits / no lyric / A&R down → keep best, stop cleanly
      if (!(await waitForJob(imp.jobId))) break; // re-sing failed → keep best
      const p2 = await arReadSong(app, workspaceId, songId);
      if (!p2) break;
      const s2 = bestOf(p2.hitScore, p2.viralScore);
      if (s2 > bestScore) {
        bestScore = s2;
        bestPred = p2;
        best = await snapshot(songId);
        pred = p2;
      } else {
        // The re-sing scored WORSE — restore the best version and stop.
        await restoreBest(songId, best, bestPred);
        break;
      }
    }
    await stampOutcome(songId, bestScore, passes, blows(bestPred.hitScore, bestPred.viralScore));
  } catch (err) {
    app.log?.warn?.({ err, songId }, 'will-it-blow gate failed (song still usable)');
  }
}

/**
 * Run the Will-it-blow gate over every rendered song of a drop. Detached — each
 * song waits for its render, scores, auto-improves if below the bar, and keeps the
 * best. Never throws. Set WILL_IT_BLOW_MAX_PASSES=0 to revert to score-only.
 */
export async function willItBlowGate(
  app: FastifyInstance,
  workspaceId: string,
  items: Array<{ songId?: string; jobId?: string }>
): Promise<void> {
  await Promise.allSettled(
    items.filter((d) => d.songId && d.jobId).map((d) => runGateForSong(app, workspaceId, d.songId!, d.jobId!))
  );
}

/**
 * WILL-IT-BLOW GATE — Benjamin's doctrine: no song ships until it's been run
 * through Will-it-hit and pushed ABOVE the bar (75). Every produced song is scored;
 * if it's under 75 the studio automatically applies the A&R's own recommendations
 * and climbs the score, then re-sings the winning version — and release is BLOCKED
 * until it clears 75.
 *
 * RENDER-LIGHT by design (the earlier version re-sang on every pass and flooded the
 * owner's burst-limited Replicate queue). Key insight: predictHit scores the song's
 * WRITING (title/hook/lyrics/genre/trends + whether it's mastered), NOT the raw
 * audio — so we climb the score with CHEAP lyric rewrites (Claude only, no render),
 * keep the best, and re-sing exactly ONCE at the end to make the audio match. So a
 * song that reaches 75 costs ONE extra render, not three or four. The final re-sing
 * is delayed so it never jumps ahead of a fresh user render, and the gate walks the
 * drop's songs SEQUENTIALLY so it can't burst the queue.
 *
 * Honest scope: it strengthens the commercial WRITING (hook/lyric/structure) and
 * confirms the mastered result. It can't guarantee a chart hit; a song that can't
 * reach 75 even after the rewrites is left as-is and flagged "needs work" — and it
 * won't green-light for release.
 *
 * Tunables: WILL_IT_BLOW_TARGET (default 75), WILL_IT_BLOW_MAX_PASSES (cheap rewrite
 * attempts, default 3, max 6; set 0 to score-only).
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import {
  generateJson,
  prompts,
  enrichLyricsForVocals,
  predictHit,
  researchTrends,
  type HitPrediction,
} from '@afrohit/ai';
import { genreSignature } from '@afrohit/shared';
import { learnedReferenceBrief } from './learned';
import { laneContext } from './lane-context';
import { laneDna, laneDnaBrief } from './lane-pipeline';
import { arReadSong } from './ar-read';
import { enqueue } from './queue';
import { snapshotLyricVersion } from './lyric-versions';
import { languageVocalTag } from '../services/chat-tools';

// Benjamin's call: the release bar is 90 ("it needs to be perfect"). NOTE: on the
// current MiniMax engine, writing-driven scores top out ~65-70 (the A&R itself says
// PRODUCTION POLISH is the cap), so at 90 almost nothing green-lights until there's
// Suno-level audio — which is the honest signal. Tunable via WILL_IT_BLOW_TARGET.
export const BLOW_TARGET = Number(process.env.WILL_IT_BLOW_TARGET ?? 90);
// COST LAW (2026-07-10): with the bar at 90, virtually every song used to burn
// ALL rewrite passes (each = a big judgment-brain rewrite + re-score). Default
// is ONE pass — raise WILL_IT_BLOW_MAX_PASSES deliberately, with a budget.
const MAX_REWRITES = Math.max(0, Math.min(Number(process.env.WILL_IT_BLOW_MAX_PASSES ?? 1), 6));

/** The bar: the BETTER of hit vs viral clears TARGET (a strong viral moment counts). */
const bestOf = (h?: number | null, v?: number | null) => Math.max(h ?? 0, v ?? 0);
const blows = (h?: number | null, v?: number | null) => bestOf(h, v) >= BLOW_TARGET;

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

type FullSong = NonNullable<Awaited<ReturnType<typeof loadSong>>>;
function loadSong(workspaceId: string, songId: string) {
  return prisma.song.findFirst({
    where: { id: songId, workspaceId },
    include: {
      project: { include: { artist: true } },
      lyric: true,
      beats: { orderBy: { createdAt: 'desc' }, take: 1 },
      hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

/** Rewrite the lyric implementing the A&R notes — returns the new lyric TEXT only.
 * Does NOT persist or render. Cheap: one Claude call. */
async function rewriteLyric(
  genre: string,
  currentBody: string,
  read: { toMakeItBigger?: string[]; risks?: string[] }
): Promise<{ title: string; body: string; whatChanged: string[] } | null> {
  // PASS 1 — rewrite implementing the A&R notes (bigger, not a patch).
  const out = await generateJson<{ title: string; body: string; whatChanged: string[] }>({
    system: prompts.LYRIC_SYSTEM,
    user:
      `REWRITE this song implementing the A&R notes — a NEW, BIGGER version, not a patch. Keep the song's identity (same story, mood, language mix) but execute EVERY note.\n\n` +
      `CURRENT LYRIC:\n${currentBody.slice(0, 4000)}\n\n` +
      `A&R NOTES TO IMPLEMENT:\n${(read.toMakeItBigger ?? []).map((n) => `- ${n}`).join('\n')}\n\n` +
      `RISKS TO FIX:\n${(read.risks ?? []).map((n) => `- ${n}`).join('\n')}\n\n` +
      [laneDnaBrief(genre), prompts.hitCraftBrief('lyric')].filter(Boolean).join('\n\n') +
      `\n\nReturn strict JSON: title, body (the full rewritten lyric), whatChanged (3-5 one-line notes on what you executed).`,
    temperature: 0.8,
    maxTokens: 4000,
  });
  if (!out?.body) return null;
  // PASS 2 — the SAME critic-polish the create path runs (HIT-ENGINE laws + the
  // FINAL HUMAN SONGWRITER AUDIT). This is what was missing: redeem/rewrite did a
  // single pass and couldn't lift a song to the bar. Now it critiques + rewrites
  // like the create flow. Skippable via WRITER_TWO_PASS=0.
  if (process.env.WRITER_TWO_PASS !== '0') {
    const polished = await generateJson<{ title: string; body: string; whatChanged?: string[] }>({
      system: prompts.LYRIC_POLISH_SYSTEM,
      user: prompts.lyricPolishPrompt({ draftTitle: out.title, draftBody: out.body, genre }),
      temperature: 0.7,
      maxTokens: 4500,
      timeoutMs: 90_000,
    }).catch(() => null);
    if (polished?.body && polished.body.length > 200) {
      return { title: polished.title || out.title, body: polished.body, whatChanged: [...(out.whatChanged ?? []).slice(0, 3), ...(polished.whatChanged ?? []).slice(0, 3)] };
    }
  }
  return out;
}

/** Score a HYPOTHETICAL lyric without persisting or rendering — predictHit on the
 * variant, using the song's existing master so productionPolish is realistic. This
 * is how we climb the score cheaply before spending a single render. */
async function scoreVariant(
  app: FastifyInstance,
  workspaceId: string,
  song: FullSong,
  lyricBody: string,
  hasMaster: boolean
): Promise<HitPrediction | null> {
  const charge = await app.chargeCredits({ workspaceId, key: 'hit_predict', refTable: 'Song', refId: song.id });
  if (!charge.ok) return null;
  const genre = song.project.genre;
  const trends = (await researchTrends({ genre }).catch(() => null))?.digest;
  return predictHit({
    title: song.lyric?.title || song.title,
    genre,
    bpm: song.project.bpm ?? undefined,
    hook: song.hooks[0]?.text ?? undefined,
    lyrics: lyricBody,
    soundDna: laneDnaBrief(genre),
    trends,
    hasMaster,
    languages: song.project.artist.languages,
  }).catch(() => null);
}

/** Persist a lyric and re-sing it (one render). Delayed so the background gate's
 * render never jumps ahead of a fresh user render. Returns the render jobId. */
async function resing(
  app: FastifyInstance,
  workspaceId: string,
  song: FullSong,
  title: string,
  body: string,
  opts?: { delayMs?: number }
): Promise<string | null> {
  if (!song.lyric) return null;
  // Preserve the CURRENT lyric before overwriting it — the artist must always be
  // able to revert to the original (sometimes it's the better take).
  await snapshotLyricVersion(song.lyric.id, 'before make-it-bigger');
  await prisma.lyricDraft.update({ where: { id: song.lyric.id }, data: { title: title || song.lyric.title, body, approved: true } });
  await prisma.song.update({ where: { id: song.id }, data: { versionLabel: 'bigger (A&R notes applied)', hitScore: null, viralScore: null } });
  const charge = await app.chargeCredits({ workspaceId, key: 'full_song_demo', refTable: 'Song', refId: song.id });
  if (!charge.ok) return null;
  const genre = song.project.genre;
  const dna = laneDna(genre);
  const learned = await learnedReferenceBrief(workspaceId, genre);
  // PHASE 4 loop — re-sing is a regen; inject the stored repair steering so the
  // bigger take is pushed back in-lane (the whole point of make-it-bigger + the gate).
  const lane = await laneContext(workspaceId, genre, song.id);
  const laneSteer = lane.repair
    ? lane.repair.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()).slice(0, 3)
    : [];
  let lyricsForSong = body;
  let styleHints: string[] = [];
  const enriched = await enrichLyricsForVocals({
      genre: song.project.genre,
    lyricBody: body,
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
  const job = await prisma.providerJob.create({
    data: { workspaceId, projectId: song.projectId, kind: 'music', provider: songEngine ?? 'suno', status: 'QUEUED', inputJson: { makeItBigger: true, songId: song.id } as never },
  });
  await enqueue({
    queue: app.queues.music,
    name: 'generate-music',
    ...(opts?.delayMs ? { delayMs: opts.delayMs } : {}),
    payload: {
      jobId: job.id, workspaceId, projectId: song.projectId, songId: song.id,
      input: {
        genre, bpm: song.project.bpm ?? 103, withVocals: true, withStems: false, songEngine,
        // The improved take must stay FULL LENGTH — match the take it replaces,
        // genre standard otherwise. With no durationS, an ACE-Step fallback
        // rendered 120s and the gate SHORTENED the shipped song.
        durationS: song.beats[0]?.duration && song.beats[0].duration > 30 ? Math.round(song.beats[0].duration) : genreSignature(genre).durationS,
        lyrics: lyricsForSong,
        artistTone: song.project.artist.vocalTone, languages: song.project.artist.languages,
        dnaTags: [languageVocalTag(song.project.artist.languages), ...(dna.tags ?? []), ...styleHints.slice(0, 3), ...laneSteer],
      },
    },
  });
  return job.id;
}

export interface ImproveResult {
  jobId: string;
  whatChanged: string[];
}
export type ImproveError = 'song_not_found' | 'no_lyrics' | 'a&r_unavailable' | 'insufficient_credits' | 'rewrite_failed' | 'artist_authored';

/** Manual "Make it bigger": ONE rewrite + immediate re-sing (auto-masters +
 * re-scores when it lands). Shares the rewrite/re-sing pieces with the gate. */
export async function improveSongOnce(
  app: FastifyInstance,
  workspaceId: string,
  songId: string,
  opts?: { delayMs?: number }
): Promise<ImproveResult | { error: ImproveError }> {
  const song = await loadSong(workspaceId, songId);
  if (!song) return { error: 'song_not_found' };
  if (!song.lyric?.body) return { error: 'no_lyrics' };
  // THE ARTIST'S WORDS ARE LAW: a from-lyrics/mumble-authored draft is never
  // rewritten by the machine — not by Make-it-bigger, not by the gate. Score
  // it, advise, stop. (Root cause of "it doesn't follow my lyrics".)
  if ((song.lyric as { artistAuthored?: boolean }).artistAuthored) return { error: 'artist_authored' };
  let read = song.hitRead as { toMakeItBigger?: string[]; risks?: string[] } | null;
  if (!read?.toMakeItBigger?.length) {
    read = await arReadSong(app, workspaceId, songId);
    if (!read) return { error: 'a&r_unavailable' };
  }
  const lyricCharge = await app.chargeCredits({ workspaceId, key: 'lyrics_full', refTable: 'Song', refId: songId });
  if (!lyricCharge.ok) return { error: 'insufficient_credits' };
  const rw = await rewriteLyric(song.project.genre, song.lyric.body, read);
  if (!rw) return { error: 'rewrite_failed' };
  const jobId = await resing(app, workspaceId, song, rw.title, rw.body, opts);
  if (!jobId) return { error: 'insufficient_credits' };
  return { jobId, whatChanged: rw.whatChanged ?? [] };
}

/** Stamp the gate outcome so the catalog/release show "blows / needs work". */
async function stamp(songId: string, bestScore: number, passes: number, willBlow: boolean) {
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
    const pred0 = await arReadSong(app, workspaceId, songId);
    if (!pred0) return;
    const initialScore = bestOf(pred0.hitScore, pred0.viralScore);
    let bestScore = initialScore;

    // Score-only (gate disabled) or already blows → just record and stop.
    if (MAX_REWRITES === 0 || blows(pred0.hitScore, pred0.viralScore)) {
      await stamp(songId, bestScore, 0, blows(pred0.hitScore, pred0.viralScore));
      return;
    }

    const song = await loadSong(workspaceId, songId);
    // ARTIST-AUTHORED LYRICS ARE LAW: the gate scores them and STOPS — it never
    // climbs by rewriting the artist's own words.
    if (song?.lyric && (song.lyric as { artistAuthored?: boolean }).artistAuthored) {
      console.log(`[gate] ${songId}: artist-authored lyric — score-only, no rewrites (${bestScore}/100)`);
      await stamp(songId, bestScore, 0, blows(pred0.hitScore, pred0.viralScore));
      return;
    }
    if (!song?.lyric?.body) {
      await stamp(songId, bestScore, 0, false);
      return;
    }
    // CHEAP CLIMB: rewrite the lyric + score the variant (no render) until it clears
    // the bar or we run out of attempts. Keep the best-scoring lyric.
    let bestLyric = { title: song.lyric.title ?? '', body: song.lyric.body };
    let read: { toMakeItBigger?: string[]; risks?: string[] } = pred0;
    let rewrites = 0;
    while (bestScore < BLOW_TARGET && rewrites < MAX_REWRITES) {
      rewrites++;
      const rw = await rewriteLyric(song.project.genre, bestLyric.body, read);
      if (!rw) break;
      const sc = await scoreVariant(app, workspaceId, song, rw.body, true);
      if (!sc) break; // out of credits / A&R down → stop cleanly, keep best so far
      const s = bestOf(sc.hitScore, sc.viralScore);
      if (s > bestScore) {
        bestScore = s;
        bestLyric = { title: rw.title, body: rw.body };
        read = sc;
      }
    }

    // Spend the ONE render when the winning lyric clears the bar OR improves the
    // score meaningfully (>= +4) — apply real gains toward 75, but don't burn a
    // render on a rewrite that barely moved. One delayed, low-priority re-sing.
    let finalPred: HitPrediction | null = pred0;
    const worthRendering =
      bestLyric.body !== song.lyric.body && (bestScore >= BLOW_TARGET || bestScore >= initialScore + 4);
    if (worthRendering) {
      const jobId = await resing(app, workspaceId, song, bestLyric.title, bestLyric.body, { delayMs: 60_000 });
      if (jobId && (await waitForJob(jobId, 120))) {
        finalPred = (await arReadSong(app, workspaceId, songId)) ?? finalPred;
        bestScore = bestOf(finalPred?.hitScore, finalPred?.viralScore);
      }
    }
    await stamp(songId, bestScore, rewrites, bestScore >= BLOW_TARGET);
  } catch (err) {
    app.log?.warn?.({ err, songId }, 'will-it-blow gate failed (song still usable)');
  }
}

/**
 * Run the Will-it-blow gate over every rendered song of a drop. SEQUENTIAL so its
 * background renders can never burst the queue. Detached — never throws. Set
 * WILL_IT_BLOW_MAX_PASSES=0 to score-only.
 */
export async function willItBlowGate(
  app: FastifyInstance,
  workspaceId: string,
  items: Array<{ songId?: string; jobId?: string }>
): Promise<void> {
  for (const d of items) {
    if (d.songId && d.jobId) {
      await runGateForSong(app, workspaceId, d.songId, d.jobId).catch(() => {});
    }
  }
}

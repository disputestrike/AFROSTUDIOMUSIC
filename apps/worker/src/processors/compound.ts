/**
 * COMPOUND — turn what the lake ALREADY HOLDS into fuel. Three jobs:
 *
 *  measure-backfill  — every owned reference and rendered beat that predates the
 *                      ear gets measured, so "94 songs / 24 approved" stop being
 *                      dead weight and start feeding lane profiles.
 *  mine-lexicon      — walk owned-upload transcripts (recipe.raw), harvest
 *                      African-language vocabulary into the word bank, tagged
 *                      mined + needs_native_review. Generated songs are EXCLUDED
 *                      as sources — the bank learns from real records, never from
 *                      the machine's own inventions.
 *  nightly-compound  — runs both on a budget, every night. The app gets smarter
 *                      while Benjamin sleeps (roadmap #3, now real).
 */
import { prisma } from '@afrohit/db';
import { generateJson, tavilySearchRaw, lastBrain } from '@afrohit/ai';
import { LANGUAGES, GENRES, genreSignature, scoreLaneCompliance, planRepairs, promotionEligible, type MeasuredAnalysis } from '@afrohit/shared';
import { enqueueJob } from '../lib/enqueue';
import { assessLaneCompliance, loadLaneProfile, laneGrounding } from '../lib/lane-assess';
import { measureAudio, dspAvailable } from '../lib/dsp';
import { processSynthMaterial } from './synth-material';

// 'zap:' rows are METADATA-learned lanes (no audio behind the sourceUrl) — the
// measure-backfill was retrying them forever and wasting its whole batch.
// 'facts:' rows get their deep pass at creation and their audio is purged after
// — and they must NEVER be lyric-mined (someone else's record).
const skipSource = (u: string) => u.startsWith('lyric:') || u.startsWith('trend:') || u.startsWith('zap:') || u.startsWith('facts:');

/** Enqueue deep-measure for owned references missing a measured read; inline
 *  lane-assess for rendered beats missing one. Bounded per run — never a stampede. */
export async function processMeasureBackfill(opts?: { refLimit?: number; beatLimit?: number }): Promise<void> {
  const refLimit = opts?.refLimit ?? 10;
  const beatLimit = opts?.beatLimit ?? 4;
  try {
    const refs = await prisma.soundReference.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { id: true, workspaceId: true, sourceUrl: true, recipe: true },
    });
    let queued = 0;
    for (const r of refs) {
      if (queued >= refLimit) break;
      if (skipSource(r.sourceUrl)) continue;
      const rec = (r.recipe ?? {}) as { measured?: { engineOk?: boolean }; deepMeasured?: boolean };
      if (rec.measured?.engineOk && rec.deepMeasured) continue;
      if (rec.measured?.engineOk && process.env.DSP_STEMS === '0') continue; // nothing to add
      await enqueueJob('music', 'deep-measure', { referenceId: r.id, url: r.sourceUrl, workspaceId: r.workspaceId });
      queued++;
    }

    // Beats rendered before the ear went live — measure them so bestOf/compliance
    // history exists for Adjust-Song and the profiles.
    const beats = await prisma.beatAsset.findMany({
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: { id: true, url: true, meta: true, project: { select: { workspaceId: true, genre: true } } },
    });
    let assessed = 0;
    for (const b of beats) {
      if (assessed >= beatLimit) break;
      const meta = (b.meta ?? {}) as { measured?: { engineOk?: boolean } };
      if (meta.measured?.engineOk) continue;
      if (!b.url || !b.project?.genre) continue;
      await assessLaneCompliance({ workspaceId: b.project.workspaceId, genre: b.project.genre, beatId: b.id, audioUrl: b.url });
      assessed++;
    }
    console.log(`[backfill] deep-measure queued=${queued}, beats assessed=${assessed}`);
  } catch (err) {
    console.warn('[backfill] failed (non-fatal):', (err as Error)?.message);
  }
}

/**
 * ADDENDUM C-3 — RE-FILE THE MISFILED HISTORY. Before the Listen-page genre
 * picker, every session filed under hardcoded 'afrobeats' — the user's amapiano
 * training landed in the wrong lake, starving amapiano's grounding and possibly
 * polluting the afrobeats profile. This pass compares each heard/uploaded
 * reference's FILED lane against the ear's own read across ALL lanes and queues
 * RE-FILE PROPOSALS — it never silently moves anything (§1.5: the user's ear
 * outranks the machine; approvals happen on the admin page). Idempotent: rows
 * carry recipe.refile = { status, checkedAt, ... }; 'unverifiable' rows are
 * re-checked when a measured read appears later (measure-backfill fills them).
 */
export async function processRefileReferences(opts?: { limit?: number }): Promise<void> {
  const limit = opts?.limit ?? 25;
  try {
    const rows = await prisma.soundReference.findMany({
      where: { NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }, { sourceUrl: { startsWith: 'zap:' } }, { sourceUrl: { startsWith: 'facts:' } }] },
      orderBy: { createdAt: 'asc' }, // oldest first — the misfiled era predates the picker
      take: 400,
      select: { id: true, workspaceId: true, genre: true, sourceUrl: true, recipe: true },
    });
    type Refile = { status: 'proposed' | 'approved' | 'rejected' | 'confirmed' | 'unverifiable'; checkedAt: string; proposedLane?: string; filedLane?: string | null; detectedScore?: number; filedScore?: number | null; reason?: string };
    const candidates = rows.filter((r) => {
      const rec = (r.recipe ?? {}) as { source?: string; refile?: Refile; measured?: { engineOk?: boolean } };
      if (rec.source === 'generated') return false; // self rows aren't picker-misfiled
      const st = rec.refile?.status;
      if (!st) return true;
      // Re-check unverifiable rows once a measured read exists; leave decided rows alone.
      return st === 'unverifiable' && !!rec.measured?.engineOk;
    }).slice(0, limit);
    if (!candidates.length) { console.log('[refile] nothing to scan — history fully checked'); return; }

    // Build every lane's profile ONCE per workspace (expert priors classify
    // ungrounded lanes — method-tagged, correct for detection on day one).
    const profileCache = new Map<string, Awaited<ReturnType<typeof loadLaneProfile>>>();
    const profileFor = async (wsId: string, genre: string) => {
      const k = `${wsId}:${genre}`;
      if (!profileCache.has(k)) profileCache.set(k, await loadLaneProfile(wsId, genre));
      return profileCache.get(k) ?? null;
    };

    let proposed = 0, confirmed = 0, unverifiable = 0;
    for (const r of candidates) {
      const rec = (r.recipe ?? {}) as Record<string, unknown> & { measured?: MeasuredAnalysis & { engineOk?: boolean }; refile?: Refile };
      const stamp = async (refile: Refile) => prisma.soundReference.update({ where: { id: r.id }, data: { recipe: { ...rec, refile } as never } }).catch(() => undefined);
      const measured = rec.measured;
      if (!measured?.engineOk) {
        await stamp({ status: 'unverifiable', checkedAt: new Date().toISOString(), filedLane: r.genre, reason: 'no measured read yet — left as filed (measure-backfill will fill it; re-checked then)' });
        unverifiable++;
        continue;
      }
      // Score against ALL lanes → detected distribution.
      let best: { lane: string; score: number } | null = null;
      let filedScore: number | null = null;
      for (const g of GENRES) {
        const profile = await profileFor(r.workspaceId, g);
        if (!profile) continue;
        try {
          const s = scoreLaneCompliance(measured as MeasuredAnalysis, profile);
          if (!best || s.overall > best.score) best = { lane: g, score: s.overall };
          if (g === (r.genre ?? '')) filedScore = s.overall;
        } catch { /* lane unscorable for this read — skip */ }
      }
      // The doc's margin rule: clear detection AND clear misfit → propose.
      if (best && best.lane !== (r.genre ?? '') && best.score >= 60 && (filedScore ?? 0) <= 35) {
        await stamp({ status: 'proposed', checkedAt: new Date().toISOString(), proposedLane: best.lane, filedLane: r.genre, detectedScore: best.score, filedScore });
        proposed++;
      } else {
        await stamp({ status: 'confirmed', checkedAt: new Date().toISOString(), filedLane: r.genre, detectedScore: best?.score, filedScore });
        confirmed++;
      }
    }
    console.log(`[refile] ledger: scanned=${candidates.length} proposed=${proposed} confirmed=${confirmed} unverifiable=${unverifiable} (approve on /admin — nothing moves without your ear)`);
  } catch (err) {
    console.warn('[refile] failed (non-fatal):', (err as Error)?.message);
  }
}

/**
 * WO-4 LISTEN-BACK — the studio listens to every song it has ever made.
 * Walks generated songs that have audio but no measured lane read; measures the
 * CURRENT artifact (master > mix > beat, freshest first), scores it against the
 * lane, persists Song.laneScore/measuredAnalysis/laneGaps. Batch-bounded; runs
 * over the whole back catalog once, then nightly keeps up. The gap dashboard
 * (GET /lanes/gap-map) reads what this writes.
 */
export async function processListenBack(opts?: { limit?: number }): Promise<void> {
  const limit = opts?.limit ?? 8;
  try {
    if (!(await dspAvailable())) { console.log('[listen-back] DSP unavailable — skipped'); return; }
    const songs = await prisma.song.findMany({
      where: { laneScore: null, OR: [{ masters: { some: {} } }, { mixes: { some: {} } }, { beats: { some: {} } }] },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, workspaceId: true,
        project: { select: { genre: true } },
        masters: { orderBy: { createdAt: 'desc' }, take: 1, select: { url: true, createdAt: true } },
        mixes: { orderBy: { createdAt: 'desc' }, take: 1, select: { url: true, createdAt: true } },
        beats: { orderBy: { createdAt: 'desc' }, take: 1, select: { url: true, createdAt: true } },
      },
    });
    if (!songs.length) { console.log('[listen-back] back catalog fully listened'); return; }
    let done = 0;
    for (const s of songs) {
      try {
        // The CURRENT audio = freshest of master/mix/beat (a re-sing or re-master
        // becomes the thing we listen to, same rule as the catalog player).
        const cands = [s.masters[0], s.mixes[0], s.beats[0]].filter((x): x is { url: string; createdAt: Date } => !!x?.url);
        cands.sort((a, b) => +b.createdAt - +a.createdAt);
        const url = cands[0]?.url;
        const genre = s.project?.genre;
        if (!url || !genre) continue;
        const profile = await loadLaneProfile(s.workspaceId, genre);
        const analysis = await measureAudio(url);
        if (!analysis.engineOk) {
          // Honest unknown: record that we listened and the ear was blind.
          await prisma.song.update({ where: { id: s.id }, data: { laneGaps: { unmeasured: true, reason: 'ear unavailable for this artifact', measuredAt: new Date().toISOString() } as never } });
          continue;
        }
        if (!profile) {
          await prisma.song.update({ where: { id: s.id }, data: { measuredAnalysis: analysis as never, laneGaps: { unmeasured: true, reason: `no lane profile for ${genre} yet`, measuredAt: new Date().toISOString() } as never } });
          done++;
          continue;
        }
        const score = scoreLaneCompliance(analysis, profile);
        const plan = planRepairs(score);
        await prisma.song.update({
          where: { id: s.id },
          data: {
            laneScore: score.overall,
            measuredAnalysis: analysis as never,
            laneGaps: { coverage: score.coverage, failedCritical: score.failedCritical, topGaps: (plan.repairs ?? []).slice(0, 5), drift: score.drift, assessedGenre: genre, measuredAt: new Date().toISOString() } as never,
          },
        });
        done++;
      } catch (err) {
        console.warn(`[listen-back] song ${s.id} failed:`, (err as Error)?.message);
      }
    }
    console.log(`[listen-back] listened to ${done}/${songs.length} songs this run`);

    // C-3 KNOCK-ON — RETROACTIVE PROMOTION: once a lane becomes grounded (e.g.
    // re-filed uploads reclaimed its refs), previously-measured self-generated
    // takes that already pass the promotion law enter the reference lake with
    // ZERO re-rendering. Same law as render-time (promotionEligible), bounded.
    try {
      const promoteMin = Number(process.env.LANE_PROMOTE_MIN ?? 70);
      // laneScore is only ever written alongside measuredAnalysis (WO-4), so the
      // score filter alone guarantees a measured take.
      const eligible = await prisma.song.findMany({
        where: { laneScore: { gte: promoteMin } },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: {
          id: true, workspaceId: true, laneScore: true, laneGaps: true, measuredAnalysis: true, title: true,
          project: { select: { genre: true } },
          masters: { orderBy: { createdAt: 'desc' }, take: 1, select: { url: true } },
          beats: { orderBy: { createdAt: 'desc' }, take: 1, select: { url: true } },
        },
      });
      const groundingCache = new Map<string, Awaited<ReturnType<typeof laneGrounding>>>();
      let promoted = 0;
      for (const s of eligible) {
        if (promoted >= 3) break; // bounded — the lake compounds, it doesn't flood
        const genre = s.project?.genre;
        const url = s.masters[0]?.url ?? s.beats[0]?.url;
        if (!genre || !url) continue;
        const gaps = (s.laneGaps ?? {}) as { coverage?: number };
        const gk = `${s.workspaceId}:${genre}`;
        if (!groundingCache.has(gk)) groundingCache.set(gk, await laneGrounding(s.workspaceId, genre));
        const grounding = groundingCache.get(gk)!;
        if (!promotionEligible({ laneScore: s.laneScore, coverage: gaps.coverage, grounded: grounding.grounded, min: promoteMin })) continue;
        const exists = await prisma.soundReference.count({ where: { workspaceId: s.workspaceId, sourceUrl: url } });
        if (exists) continue; // idempotent — already in the lake
        await prisma.soundReference.create({
          data: {
            workspaceId: s.workspaceId,
            genre,
            sourceUrl: url,
            title: `generated · ${genre} · retro-promoted`,
            recipe: { source: 'generated', retroPromoted: true, laneScore: s.laneScore, measured: s.measuredAnalysis } as never,
            summary: `Retro-promoted ${genre} take (lane ${s.laneScore}/100) — passed the promotion law after the lane became grounded.`,
          },
        }).catch(() => undefined);
        promoted++;
        console.log(`[listen-back] retro-promoted "${s.title}" into the ${genre} lake (lane ${s.laneScore}/100)`);
      }
      if (promoted) console.log(`[listen-back] retro-promotion: ${promoted} previously-measured take(s) entered the lake — zero re-rendering`);
    } catch (err) {
      console.warn('[listen-back] retro-promotion failed (non-fatal):', (err as Error)?.message);
    }
  } catch (err) {
    console.warn('[listen-back] failed (non-fatal):', (err as Error)?.message);
  }
}

/**
 * LEARN-BACKFILL — the artist's OWN finished songs that entered the studio
 * before the upload door learned (Suno-bridge returns / uploaded masters were
 * mastered + scored but never analyzed into the lake). Finds every 'uploaded'
 * mix with no SoundReference and queues a real analyze for it — bounded and
 * staggered (Replicate BURST-1) so it never floods the queue. His songs, his
 * training: this is exactly the audio the lake exists for.
 */
export async function processLearnBackfill(opts?: { limit?: number }): Promise<void> {
  const limit = opts?.limit ?? 5;
  try {
    const uploads = await prisma.mix.findMany({
      where: { preset: 'uploaded' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, url: true, projectId: true, project: { select: { workspaceId: true } } },
    });
    if (!uploads.length) { console.log('[learn-backfill] no uploaded songs found'); return; }
    const urls = uploads.map((u) => u.url);
    const known = await prisma.soundReference.findMany({
      where: { OR: [{ sourceUrl: { in: urls } }, { sourceUrl: { in: urls.map((u) => `facts:${u}`) } }] },
      select: { sourceUrl: true },
    });
    const learned = new Set(known.map((k) => k.sourceUrl.replace(/^facts:/, '')));
    let queued = 0;
    for (const u of uploads) {
      if (queued >= limit) break;
      if (!u.url || learned.has(u.url) || !u.project?.workspaceId) continue;
      const job = await prisma.providerJob.create({
        data: { workspaceId: u.project.workspaceId, projectId: u.projectId, kind: 'analyze', provider: 'replicate', status: 'QUEUED', inputJson: { url: u.url, source: 'learn-backfill' } as never },
      });
      await enqueueJob('music', 'analyze-audio', { jobId: job.id, workspaceId: u.project.workspaceId, projectId: u.projectId, url: u.url }, { delayMs: queued * 30_000 });
      queued++;
    }
    console.log(`[learn-backfill] queued=${queued} of ${uploads.length} uploaded songs (${learned.size} already learned)`);
  } catch (err) {
    console.warn('[learn-backfill] failed (non-fatal):', (err as Error)?.message);
  }
}

const MINE_LANGS = ['yo', 'ig', 'ha', 'pcm', 'twi', 'sw', 'zu', 'xh', 'st', 'tn', 'tsotsitaal', 'ln', 'wo', 'bm', 'nouchi', 'ar', 'ht', 'kriolu', 'am', 'patois', 'es'] as const;
const MINE_CATS = ['love', 'street', 'party', 'faith', 'slang', 'adlib', 'proverb', 'dance'] as const;

/** Harvest vocabulary from OWNED upload transcripts into the global word bank. */
export async function processMineLexicon(opts?: { refLimit?: number }): Promise<void> {
  const refLimit = opts?.refLimit ?? 4;
  try {
    const refs = await prisma.soundReference.findMany({
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { id: true, sourceUrl: true, recipe: true },
    });
    const candidates = refs.filter((r) => {
      if (skipSource(r.sourceUrl)) return false;
      const rec = (r.recipe ?? {}) as { raw?: string; source?: string; lexMinedAt?: string };
      return !!rec.raw && rec.source !== 'generated' && !rec.lexMinedAt;
    }).slice(0, refLimit);
    if (!candidates.length) { console.log('[mine-lexicon] nothing new to mine'); return; }

    // Existing bank (global) — never re-insert what we already have.
    const existing = await prisma.lexiconEntry.findMany({ where: { workspaceId: null }, select: { term: true, language: true } });
    const have = new Set(existing.map((e) => `${e.term.toLowerCase()}|${e.language}`));

    let inserted = 0;
    for (const r of candidates) {
      const rec = (r.recipe ?? {}) as Record<string, unknown> & { raw?: string };
      const tokens = [...new Set((rec.raw ?? '').toLowerCase().match(/[\p{L}'][\p{L}'-]{2,}/gu) ?? [])].slice(0, 160);
      if (tokens.length < 8) {
        await prisma.soundReference.update({ where: { id: r.id }, data: { recipe: { ...rec, lexMinedAt: new Date().toISOString() } as never } });
        continue;
      }
      // The classifier keeps ONLY terms it is confident belong to the target
      // languages — everything English/uncertain is dropped, honesty over volume.
      const out = await generateJson<{ entries: Array<{ term: string; language: string; category: string; meaning: string }> }>({
        tier: 'bulk',
        task: 'lexicon-mine',
        system:
          `You are a careful African-languages lexicographer. From a raw song transcript's word list, extract ONLY words/short phrases you are CONFIDENT belong to one of: ${MINE_LANGS.join(', ')} (tsotsitaal = SA township slang). Exclude English, names, and anything uncertain. Category must be one of: ${MINE_CATS.join(', ')}. Give a short plain-English meaning. Return {"entries":[{"term","language","category","meaning"}]} — empty array if nothing qualifies.`,
        user: tokens.join(' '),
        maxTokens: 1200,
      }).catch(() => ({ entries: [] as Array<{ term: string; language: string; category: string; meaning: string }> }));
      // A3-5 guard (c): African-language content drafted on the bulk tier is
      // QUARANTINED until an Anthropic verification pass clears it — never seeded.
      const minedBulk = lastBrain === 'cerebras';

      for (const e of out.entries ?? []) {
        const term = (e.term ?? '').trim().toLowerCase();
        const lang = (e.language ?? '').trim();
        if (!term || term.length > 40 || !(MINE_LANGS as readonly string[]).includes(lang)) continue;
        const key = `${term}|${lang}`;
        if (have.has(key)) continue;
        have.add(key);
        await prisma.lexiconEntry.create({
          data: {
            workspaceId: null,
            term,
            language: lang,
            category: (MINE_CATS as readonly string[]).includes(e.category) ? e.category : 'slang',
            register: 'casual',
            meaning: (e.meaning ?? '').slice(0, 300) || null,
            source: 'learned',
            tags: minedBulk ? ['mined', 'needs_native_review', 'bulk_unverified'] : ['mined', 'needs_native_review'],
          },
        }).catch(() => undefined);
        inserted++;
      }
      await prisma.soundReference.update({ where: { id: r.id }, data: { recipe: { ...rec, lexMinedAt: new Date().toISOString() } as never } });
    }
    console.log(`[mine-lexicon] refs=${candidates.length} terms inserted=${inserted} (all needs_native_review)`);
  } catch (err) {
    console.warn('[mine-lexicon] failed (non-fatal):', (err as Error)?.message);
  }
}

const REGION_HINT: Record<string, string> = {
  yo: 'Nigeria', ig: 'Nigeria', ha: 'Nigeria', pcm: 'Nigeria', twi: 'Ghana', sw: 'Kenya Tanzania East Africa',
  zu: 'South Africa', xh: 'South Africa', st: 'Lesotho South Africa', tn: 'Botswana South Africa',
  tsotsitaal: 'South Africa township', ln: 'Congo DRC Kinshasa', wo: 'Senegal Dakar', bm: 'Mali Bamako',
  nouchi: "Cote d'Ivoire Abidjan",
  ar: 'Egypt Morocco Maghreb mahraganat rai', ht: 'Haiti kompa', kriolu: 'Cape Verde funana',
  am: 'Ethiopia Addis', patois: 'Jamaica dancehall', es: 'Latin reggaeton',
};

/** DYNAMIC LEXICON RESEARCH — the rich bank, built the honest way: Tavily finds
 *  glossaries/phrasebooks/slang articles per (language x category); Claude
 *  extracts terms with PARAPHRASED meanings and writes ORIGINAL example lines
 *  (never copying source text); everything lands source:'research' +
 *  needs_native_review. Rotation covers every slot; throughput via
 *  LEXICON_RESEARCH_QUERIES per run. Facts about a language are minable;
 *  a dictionary's prose is not — we take the words, never the wording. */
export async function processLexiconResearch(opts?: { queries?: number }): Promise<void> {
  const perRun = Math.max(1, Math.min(20, opts?.queries ?? (parseInt(process.env.LEXICON_RESEARCH_QUERIES ?? '6', 10) || 6)));
  try {
    const slots: Array<{ lang: string; cat: string }> = [];
    for (const lang of MINE_LANGS) for (const cat of MINE_CATS) slots.push({ lang, cat });
    // rotate deterministically so every slot gets covered across runs
    const start = (Math.floor(Date.now() / 3_600_000)) % slots.length;
    const picked = Array.from({ length: perRun }, (_v, i) => slots[(start + i) % slots.length]!);

    const existing = await prisma.lexiconEntry.findMany({ where: { workspaceId: null }, select: { term: true, language: true } });
    const have = new Set(existing.map((e) => `${e.term.toLowerCase()}|${e.language}`));
    let inserted = 0;
    for (const { lang, cat } of picked) {
      const name = (LANGUAGES as Record<string, string>)[lang] ?? lang;
      const q = `${name} language ${cat === 'slang' ? 'slang dictionary' : cat + ' words phrases'} english meaning ${REGION_HINT[lang] ?? ''}`;
      const results = await tavilySearchRaw(q, 5);
      console.log(`[lexicon-research] ${lang}:${cat} results=${results.length}`);
      if (!results.length) continue;
      const corpus = results.map((r) => `${r.title}\n${r.content}`).join('\n---\n').slice(0, 6000);
      const out = await generateJson<{ entries: Array<{ term: string; meaning: string; example?: string; register?: string }> }>({
        tier: 'bulk',
        task: 'lexicon-research',
        system:
          `You are a careful ${name} lexicographer. From the research notes, extract up to 35 REAL ${name} words/short phrases fitting the theme "${cat}" that you are CONFIDENT are correct. For each: paraphrase the meaning in your OWN plain English (never copy the source wording) and write ONE short ORIGINAL example line (never quote the source, never a real lyric). register in [casual|chant|poetic|sacred|flex]. Skip anything uncertain, offensive-without-context, or not actually ${name}. Return {"entries":[...]}; empty if nothing qualifies.`,
        user: corpus,
        maxTokens: 1800,
      }).catch(() => ({ entries: [] as Array<{ term: string; meaning: string; example?: string; register?: string }> }));
      const researchedBulk = lastBrain === 'cerebras';
      for (const e of out.entries ?? []) {
        const term = (e.term ?? '').trim().toLowerCase();
        if (!term || term.length > 48) continue;
        const key = `${term}|${lang}`;
        if (have.has(key)) continue;
        have.add(key);
        await prisma.lexiconEntry.create({
          data: {
            workspaceId: null, term, language: lang, category: cat,
            register: e.register ?? 'casual',
            meaning: (e.meaning ?? '').slice(0, 300) || null,
            example: (e.example ?? '').slice(0, 200) || null,
            source: 'research',
            tags: researchedBulk ? ['researched', 'needs_native_review', 'bulk_unverified'] : ['researched', 'needs_native_review'],
          },
        }).catch(() => undefined);
        inserted++;
      }
    }
    console.log(`[lexicon-research] slots=${picked.map((s2) => s2.lang + ':' + s2.cat).join(',')} inserted=${inserted}`);
  } catch (err) {
    console.warn('[lexicon-research] failed (non-fatal):', (err as Error)?.message);
  }
}

/** THE FREE FIREHOSE — Wiktionary category harvest. Every term is a REAL word
 *  (community-verified lemma list), fetched from the public MediaWiki API — no
 *  scraping library, no fabrication. Terms land unglossed; the gloss pass below
 *  adds paraphrased meanings in batches. This is the honest road to a very large
 *  bank: authenticity first, volume as a knob (WIKTIONARY_PER_LANG). */
const WIKI_CATEGORY: Record<string, string> = {
  yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa', sw: 'Swahili', zu: 'Zulu', xh: 'Xhosa', st: 'Sotho', tn: 'Tswana',
  ln: 'Lingala', wo: 'Wolof', bm: 'Bambara', twi: 'Twi', pcm: 'Nigerian_Pidgin', ht: 'Haitian_Creole',
  kriolu: 'Kabuverdianu', am: 'Amharic', ar: 'Egyptian_Arabic', patois: 'Jamaican_Creole',
};

export async function processWiktionaryHarvest(opts?: { langs?: string[]; perLang?: number; all?: boolean }): Promise<void> {
  const burst = !!opts?.all;
  const perLang = Math.max(50, Math.min(5000, opts?.perLang ?? (parseInt(process.env[burst ? 'WIKTIONARY_BURST_PER_LANG' : 'WIKTIONARY_PER_LANG'] ?? (burst ? '1500' : '400'), 10) || (burst ? 1500 : 400))));
  const all = opts?.langs ?? Object.keys(WIKI_CATEGORY);
  // rotate 3 languages per run so every language gets covered across runs
  const start = Math.floor(Date.now() / 3_600_000) % all.length;
  const langs = burst ? all : (opts?.langs ?? Array.from({ length: 3 }, (_v, i) => all[(start + i) % all.length]!));
  try {
    const existing = await prisma.lexiconEntry.findMany({ where: { workspaceId: null }, select: { term: true, language: true } });
    const have = new Set(existing.map((e) => `${e.term.toLowerCase()}|${e.language}`));
    let inserted = 0;
    for (const lang of langs) {
      const cat = WIKI_CATEGORY[lang];
      if (!cat) continue;
      let cont: string | undefined;
      let got = 0;
      while (got < perLang) {
        const url = `https://en.wiktionary.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:${cat}_lemmas&cmlimit=500&cmtype=page&format=json${cont ? `&cmcontinue=${encodeURIComponent(cont)}` : ''}`;
        const res = await fetch(url, { headers: { 'user-agent': 'AfroHitStudio/1.0 (lexicon research)' } }).catch(() => null);
        if (!res?.ok) break;
        const data = (await res.json().catch(() => null)) as { continue?: { cmcontinue?: string }; query?: { categorymembers?: Array<{ title?: string }> } } | null;
        const members = data?.query?.categorymembers ?? [];
        if (!members.length) break;
        for (const m2 of members) {
          if (got >= perLang) break;
          const term = (m2.title ?? '').trim().toLowerCase();
          if (!term || term.length > 48 || term.includes(':') || /\d/.test(term)) continue;
          const key = `${term}|${lang}`;
          if (have.has(key)) continue;
          have.add(key);
          await prisma.lexiconEntry.create({
            data: { workspaceId: null, term, language: lang, category: 'general', register: 'casual', meaning: null, example: null, source: 'wiktionary', tags: ['wiktionary', 'needs_native_review', 'unglossed'] },
          }).catch(() => undefined);
          inserted++; got++;
        }
        cont = data?.continue?.cmcontinue;
        if (!cont) break;
        await new Promise((r) => setTimeout(r, 350)); // polite to the API
      }
      console.log(`[wiktionary] ${lang}: +${got}`);
    }
    console.log(`[wiktionary] total inserted=${inserted} (unglossed — gloss pass enriches nightly)`);
  } catch (err) {
    console.warn('[wiktionary] failed (non-fatal):', (err as Error)?.message);
  }
}

/** Gloss pass — paraphrased meanings for unglossed harvested terms, in batches. */
export async function processGlossPass(opts?: { limit?: number }): Promise<void> {
  const limit = Math.max(10, Math.min(200, opts?.limit ?? (parseInt(process.env.LEXICON_GLOSS_PER_RUN ?? '80', 10) || 80)));
  try {
    const rows = await prisma.lexiconEntry.findMany({ where: { workspaceId: null, tags: { has: 'unglossed' } }, take: limit, orderBy: { createdAt: 'asc' } });
    if (!rows.length) { console.log('[gloss] nothing unglossed'); return; }
    const byLang = new Map<string, typeof rows>();
    for (const r of rows) { const a = byLang.get(r.language) ?? []; a.push(r); byLang.set(r.language, a); }
    let done = 0;
    for (const [lang, entriesAll] of byLang) {
      // token math that fits: <=22 terms per call (0/80 last night = truncation)
      for (let ci = 0; ci < entriesAll.length; ci += 22) {
        const entries = entriesAll.slice(ci, ci + 22);
      const name = (LANGUAGES as Record<string, string>)[lang] ?? lang;
      const out = await generateJson<{ glosses: Array<{ term: string; meaning: string; category?: string; register?: string }> }>({
        tier: 'bulk',
        task: 'lexicon-gloss',
        system: `You are a ${name} lexicographer. For each REAL ${name} term below, give a short plain-English meaning IN YOUR OWN WORDS, a category from [${MINE_CATS.join('|')}|general], and register [casual|chant|poetic|sacred|flex]. If you don't confidently know a term, OMIT it. Return {"glosses":[...]}.`,
        user: entries.map((e) => e.term).join('\n'),
        maxTokens: 1400,
      }).catch(() => ({ glosses: [] as Array<{ term: string; meaning: string; category?: string; register?: string }> }));
      const map = new Map(out.glosses?.map((g) => [g.term.toLowerCase(), g] as const) ?? []);
      if (!map.size) console.log(`[gloss] ${lang}: model returned 0 for a ${entries.length}-term batch`);
      for (const e of entries) {
        const g = map.get(e.term.toLowerCase());
        if (!g?.meaning) continue;
        await prisma.lexiconEntry.update({
          where: { id: e.id },
          data: { meaning: g.meaning.slice(0, 300), category: g.category && g.category !== 'general' ? g.category : e.category, register: g.register ?? e.register, tags: [...e.tags.filter((t) => t !== 'unglossed'), ...(lastBrain === 'cerebras' && !e.tags.includes('bulk_unverified') ? ['bulk_unverified'] : [])] },
        }).catch(() => undefined);
        done++;
      }
      }
    }
    console.log(`[gloss] glossed=${done}/${rows.length}`);
  } catch (err) {
    console.warn('[gloss] failed (non-fatal):', (err as Error)?.message);
  }
}

/** Every genre in active use keeps a full SIGNATURE KIT on the shelf — including
 *  the FILL, whose absence silently disabled fill overlays on every rendered
 *  song ("no drum fills anywhere" — Benjamin). Synth-forged, owned, seconds. */
export async function ensureSignatureKits(): Promise<void> {
  try {
    const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' }, take: 40, select: { workspaceId: true, genre: true } });
    const seen = new Set<string>();
    for (const pr of projects) {
      if (!pr.genre) continue;
      const key = `${pr.workspaceId}|${pr.genre}`;
      if (seen.has(key) || seen.size >= 6) continue;
      seen.add(key);
      const have = new Set((await prisma.materialAsset.findMany({ where: { workspaceId: pr.workspaceId, genre: pr.genre }, select: { role: true } })).map((m) => m.role));
      const missing = genreSignature(pr.genre).kitRoles.filter((r) => !have.has(r));
      if (missing.length) {
        console.log(`[kits] ${pr.genre}: forging ${missing.join('+')}`);
        await processSynthMaterial({ workspaceId: pr.workspaceId, genre: pr.genre, roles: missing });
      }
    }
  } catch (err) { console.warn('[kits] failed (non-fatal):', (err as Error)?.message); }
}

/** REPORT CARD — the system tests its own output nightly and tells on itself:
 *  per genre, average identity compliance of recent takes vs the lane profile,
 *  worst dimensions named. No human ear required to FIND the gaps. */
export async function processReportCard(): Promise<void> {
  try {
    const beats = await prisma.beatAsset.findMany({ orderBy: { createdAt: 'desc' }, take: 60, select: { meta: true, project: { select: { genre: true } } } });
    const byGenre = new Map<string, Array<Record<string, unknown>>>();
    for (const b of beats) {
      const g = b.project?.genre; const meta = (b.meta ?? {}) as { compliance?: { overall?: number; dimensions?: Array<{ key: string; score: number; identity?: boolean }> } };
      if (!g || !meta.compliance?.dimensions) continue;
      const a = byGenre.get(g) ?? []; a.push(meta.compliance as never); byGenre.set(g, a);
    }
    for (const [g, rows] of byGenre) {
      const avg = Math.round(rows.reduce((x, r) => x + Number((r as { overall?: number }).overall ?? 0), 0) / rows.length);
      const worst = new Map<string, number>();
      for (const r of rows) for (const d of ((r as { dimensions?: Array<{ key: string; score: number; identity?: boolean }> }).dimensions ?? []))
        if (d.identity && d.score < 60) worst.set(d.key, (worst.get(d.key) ?? 0) + 1);
      const gaps = [...worst.entries()].sort((a2, b2) => b2[1] - a2[1]).slice(0, 3).map(([k, n]) => `${k}(x${n})`).join(', ');
      console.log(`[report-card] ${g}: avg ${avg}/100 over ${rows.length} takes${gaps ? ` — recurring identity gaps: ${gaps}` : ' — no recurring identity gaps'}`);
    }
    if (!byGenre.size) console.log('[report-card] no scored takes yet');
  } catch (err) { console.warn('[report-card] failed (non-fatal):', (err as Error)?.message); }
}

/**
 * A3-5 guard (c) — VERIFY THE QUARANTINE. African-language lexicon rows drafted
 * on the bulk tier carry 'bulk_unverified' and never reach the word palette.
 * This nightly pass re-verifies them on the JUDGMENT brain (Anthropic): correct
 * rows are cleared into service; wrong rows are DELETED — never seeded.
 */
export async function processVerifyLexicon(opts?: { limit?: number }): Promise<void> {
  const limit = opts?.limit ?? 30;
  try {
    const rows = await prisma.lexiconEntry.findMany({
      where: { tags: { has: 'bulk_unverified' } },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
    if (!rows.length) { console.log('[verify-lexicon] quarantine empty'); return; }
    const byLang = new Map<string, typeof rows>();
    for (const r of rows) byLang.set(r.language, [...(byLang.get(r.language) ?? []), r]);
    let cleared = 0, deleted = 0;
    for (const [lang, entries] of byLang) {
      const name = (LANGUAGES as Record<string, string>)[lang] ?? lang;
      const out = await generateJson<{ verdicts: Array<{ term: string; correct: boolean }> }>({
        tier: 'judgment', // NEVER bulk — this pass exists to check the bulk tier's language work
        task: 'lexicon-verify',
        system: `You are a native-level ${name} reviewer. For each term+meaning pair, answer whether the term is REAL ${name} and the meaning is correct. Be strict: uncertain = incorrect. Return {"verdicts":[{"term","correct"}]}.`,
        user: entries.map((e) => `${e.term} = ${e.meaning ?? '(no meaning)'}`).join('\n'),
        maxTokens: 1200,
      }).catch(() => null);
      if (!out) continue; // judgment brain unavailable — quarantine stays quarantined
      const verdict = new Map(out.verdicts?.map((v) => [v.term.toLowerCase(), v.correct] as const) ?? []);
      for (const e of entries) {
        const ok = verdict.get(e.term.toLowerCase());
        if (ok === true) {
          await prisma.lexiconEntry.update({ where: { id: e.id }, data: { tags: e.tags.filter((t) => t !== 'bulk_unverified') } }).catch(() => undefined);
          cleared++;
        } else if (ok === false) {
          await prisma.lexiconEntry.delete({ where: { id: e.id } }).catch(() => undefined);
          deleted++;
        } // omitted by the model = stays quarantined for the next pass
      }
    }
    console.log(`[verify-lexicon] cleared=${cleared} deleted=${deleted} (judgment brain; quarantined rows never reach the palette)`);
  } catch (err) {
    console.warn('[verify-lexicon] failed (non-fatal):', (err as Error)?.message);
  }
}

/** Roadmap #3 — the nightly compounding job. Cost-capped by the batch limits. */
export async function processNightlyCompound(): Promise<void> {
  console.log('[nightly-compound] start');
  await ensureSignatureKits();
  await processReportCard();
  await processLearnBackfill({ limit: 5 });
  await processRefileReferences({ limit: 25 });
  await processListenBack({ limit: 8 });
  await processMeasureBackfill({ refLimit: 10, beatLimit: 4 });
  await processMineLexicon({ refLimit: 4 });
  await processLexiconResearch({ queries: 6 });
  await processWiktionaryHarvest();
  await processGlossPass();
  await processVerifyLexicon({ limit: 30 });
  console.log('[nightly-compound] done');
}

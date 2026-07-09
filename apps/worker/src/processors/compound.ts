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
import { generateJson, tavilySearchRaw } from '@afrohit/ai';
import { LANGUAGES } from '@afrohit/shared';
import { enqueueJob } from '../lib/enqueue';
import { assessLaneCompliance } from '../lib/lane-assess';

const skipSource = (u: string) => u.startsWith('lyric:') || u.startsWith('trend:');

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

const MINE_LANGS = ['yo', 'ig', 'ha', 'pcm', 'twi', 'sw', 'zu', 'xh', 'st', 'tn', 'tsotsitaal', 'ln', 'wo', 'bm', 'nouchi'] as const;
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
        system:
          `You are a careful African-languages lexicographer. From a raw song transcript's word list, extract ONLY words/short phrases you are CONFIDENT belong to one of: ${MINE_LANGS.join(', ')} (tsotsitaal = SA township slang). Exclude English, names, and anything uncertain. Category must be one of: ${MINE_CATS.join(', ')}. Give a short plain-English meaning. Return {"entries":[{"term","language","category","meaning"}]} — empty array if nothing qualifies.`,
        user: tokens.join(' '),
        maxTokens: 1200,
      }).catch(() => ({ entries: [] as Array<{ term: string; language: string; category: string; meaning: string }> }));

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
            tags: ['mined', 'needs_native_review'],
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
};

/** DYNAMIC LEXICON RESEARCH — the rich bank, built the honest way: Tavily finds
 *  glossaries/phrasebooks/slang articles per (language x category); Claude
 *  extracts terms with PARAPHRASED meanings and writes ORIGINAL example lines
 *  (never copying source text); everything lands source:'research' +
 *  needs_native_review. Rotation covers every slot; throughput via
 *  LEXICON_RESEARCH_QUERIES per run. Facts about a language are minable;
 *  a dictionary's prose is not — we take the words, never the wording. */
export async function processLexiconResearch(opts?: { queries?: number }): Promise<void> {
  const perRun = Math.max(1, Math.min(20, opts?.queries ?? parseInt(process.env.LEXICON_RESEARCH_QUERIES ?? '6', 10) || 6));
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
      const results = await tavilySearchRaw(`${name} ${REGION_HINT[lang] ?? ''} ${cat} words phrases slang meanings glossary`, 4);
      if (!results.length) continue;
      const corpus = results.map((r) => `${r.title}\n${r.content}`).join('\n---\n').slice(0, 6000);
      const out = await generateJson<{ entries: Array<{ term: string; meaning: string; example?: string; register?: string }> }>({
        system:
          `You are a careful ${name} lexicographer. From the research notes, extract up to 35 REAL ${name} words/short phrases fitting the theme "${cat}" that you are CONFIDENT are correct. For each: paraphrase the meaning in your OWN plain English (never copy the source wording) and write ONE short ORIGINAL example line (never quote the source, never a real lyric). register in [casual|chant|poetic|sacred|flex]. Skip anything uncertain, offensive-without-context, or not actually ${name}. Return {"entries":[...]}; empty if nothing qualifies.`,
        user: corpus,
        maxTokens: 1800,
      }).catch(() => ({ entries: [] as Array<{ term: string; meaning: string; example?: string; register?: string }> }));
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
            tags: ['researched', 'needs_native_review'],
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

/** Roadmap #3 — the nightly compounding job. Cost-capped by the batch limits. */
export async function processNightlyCompound(): Promise<void> {
  console.log('[nightly-compound] start');
  await processMeasureBackfill({ refLimit: 10, beatLimit: 4 });
  await processMineLexicon({ refLimit: 4 });
  await processLexiconResearch({ queries: 6 });
  console.log('[nightly-compound] done');
}

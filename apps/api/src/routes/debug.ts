import type { FastifyInstance } from 'fastify';
import { anthropicPing, tavilyKey, braveKey, tavilyPing, researchTrends, soundBrief, prompts, joinBriefs, claudeRaw } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { freshnessBrief, learnedReferenceBrief, learnedLyricCraftBrief } from '../lib/learned';
import { lexiconPalette } from '../lib/lexicon';
import { fuseSoundDna } from '../lib/fuse';

/**
 * AI wiring diagnostics — which providers the API service can actually reach.
 * Surfaces the real error the generation path swallows.
 */
export default async function debug(app: FastifyInstance) {
  app.get('/ai', async () => {
    const [anthropic, tavily, trend] = await Promise.all([
      anthropicPing(),
      tavilyPing(),
      researchTrends({ genre: 'afrobeats' }),
    ]);
    return {
      openaiKey: !!process.env.OPENAI_API_KEY,
      anthropic,
      tavily: { configured: !!tavilyKey(), ...tavily },
      braveConfigured: !!braveKey(),
      trends: trend ? { ok: true, source: trend.source, sample: trend.digest.slice(0, 120) } : { ok: false },
      musicProvider: process.env.MUSIC_PROVIDER ?? '(unset)',
    };
  });

  /**
   * GENERATION CONTEXT — the PROOF that the whole data lake is fused into every
   * song. Assembles the EXACT `soundDna` block the hook/lyric writers receive
   * for a given genre/mood/languages, broken into its parts so you can SEE the
   * word palette, freshness rules, learned references, studied craft, and genre
   * DNA all stitched together. Read-only, no LLM call, no charge.
   *
   *   GET /debug/generation-context?genre=afrobeats&mood=love&languages=pcm,en
   */
  // RAW lyric diagnostic — what Claude ACTUALLY returns for a lyric, unparsed.
  app.get<{ Querystring: { genre?: string } }>('/lyric-raw', async (req) => {
    const genre = req.query.genre || 'afrobeats';
    const user = prompts.lyricUserPrompt({
      artist: { stageName: 'Test', laneSummary: 'afro', languages: ['pcm', 'en'], vocalTone: ['smooth'] } as never,
      brief: { mood: 'love' } as never,
      hookText: 'Under Lagos light, your smile dey my mind',
      cleanVersion: true,
      soundDna: (soundBrief(genre).brief ?? '').slice(0, 1500),
    });
    const r1 = await claudeRaw({ system: prompts.LYRIC_SYSTEM, user, maxTokens: 4500 });
    return { attempt: r1 };
  });

  app.get<{ Querystring: { genre?: string; mood?: string; languages?: string } }>('/generation-context', async (req) => {
    const { workspaceId } = requireAuth(req);
    const genre = req.query.genre || 'afrobeats';
    const mood = req.query.mood || 'love';
    const languages = (req.query.languages || 'pcm,en').split(',').map((s) => s.trim()).filter(Boolean);

    const [palette, freshness, learnedRef, learnedCraft] = await Promise.all([
      lexiconPalette({ workspaceId, languages, mood, rotate: 1 }),
      freshnessBrief(workspaceId),
      learnedReferenceBrief(workspaceId, genre),
      learnedLyricCraftBrief(workspaceId, genre),
    ]);
    const dna = soundBrief(genre).brief;
    const hitCraft = prompts.hitCraftBrief('hook', mood);

    // The SAME assembly the hooks route uses (order + cap), so this is exactly
    // what the model sees.
    // SAME order the hooks route uses: freshness → palette → DNA → learned → craft.
    const parts = [
      { name: 'freshnessBrief (banned-repeats + African storytelling)', text: freshness },
      { name: 'wordPalette (from the Word Bank)', text: palette },
      { name: 'soundDNA (genre production recipe)', text: dna },
      { name: 'learnedReferenceBrief (your heard/uploaded songs)', text: learnedRef },
      { name: 'learnedLyricCraftBrief (lyrics you studied)', text: learnedCraft },
      { name: 'hitCraftBrief (proven hit modes)', text: hitCraft },
    ];
    const assembled = fuseSoundDna({ freshness, palette, dna, learnedRef, learnedCraft, hitCraft });

    return {
      inputs: { genre, mood, languages },
      // What ACTUALLY reaches the model (post-cap), and how big it is.
      assembledSoundDna: assembled,
      assembledLength: assembled.length,
      // Each source, present-or-empty + its length, so you can see the fusion.
      parts: parts.map((p) => ({ source: p.name, present: !!p.text, chars: (p.text ?? '').length, preview: (p.text ?? '').slice(0, 200) })),
      wired: {
        wordBankInPrompt: !!palette && assembled.includes(palette.slice(0, 40)),
        freshnessInPrompt: !!freshness && assembled.includes(freshness.slice(0, 40)),
        soundDnaInPrompt: !!dna && assembled.includes(dna.slice(0, 40)),
        note: 'wordBankInPrompt=true confirms the Word Bank terms are inside the exact text sent to the writer, not just displayed on a page.',
      },
    };
  });
}

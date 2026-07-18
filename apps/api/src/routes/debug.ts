import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { anthropicPing, openaiPing, tavilyKey, braveKey, tavilyPing, researchTrends, prompts, claudeRaw, getLastStudioChatClaudeError, cerebrasHealth, anthropicAuthCooldownMs } from '@afrohit/ai';
import { isFirstPartyWorkspace, recommendEngine } from '@afrohit/shared';
import { laneDnaBrief } from '../lib/lane-pipeline';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from './admin';
import { freshnessBrief, learnedReferenceBrief, learnedLyricCraftBrief } from '../lib/learned';
import { lexiconPalette } from '../lib/lexicon';
import { fuseSoundDna } from '../lib/fuse';

/**
 * AI wiring diagnostics — which providers the API service can actually reach.
 * Surfaces the real error the generation path swallows.
 */
export default async function debug(app: FastifyInstance) {
  app.get('/ai', async (req) => {
    await requireAdmin(req); // §1.11 THE WALL: vendor names + key status are INTERNAL
    const { workspaceId } = requireAuth(req);
    const [anthropic, openai, tavily, trend, cerebras] = await Promise.all([
      anthropicPing(),
      openaiPing(),
      tavilyPing(),
      researchTrends({ genre: 'afrobeats' }),
      cerebrasHealth(), // owner: verify ALL keys work + the right model
    ]);
    // The brain is DOWN when neither text model can be reached — every LLM feature
    // (lyrics, hooks, A&R, reference analysis, Zap craft-learning) fails or goes
    // hollow. Surface it loudly so a credit top-up is the obvious fix, not a bug hunt.
    const brainOk = anthropic.ok || openai.ok;

    // JUDGMENT-BRAIN HEALTH (diagnosis 2026-07-18): the live pings above say
    // "can I reach a brain RIGHT NOW"; this says "what actually happened to the
    // JUDGMENT calls (lyrics/hooks/A&R) over the last 24h" — the number that
    // explains "songs make no sense" (Cerebras wrote them) and "brain hiccup"
    // (every brain failed). Turns a mystery into "OpenAI: 92% fail (quota)".
    const judgmentHealth = await (async () => {
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const rows = await prisma.analyticsEvent.findMany({
          where: { name: 'llm.call', createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          take: 2000,
          select: { properties: true },
        });
        type Call = { tier?: string; brain?: string; degraded?: string };
        const judged = rows
          .map((r: { properties: unknown }) => (r.properties ?? {}) as Call)
          .filter((c: Call) => c.tier === 'judgment');
        const byBrain: Record<string, { calls: number; fails: number; lastDegraded: string | null }> = {};
        for (const c of judged) {
          const b = c.brain || 'unknown';
          const e = (byBrain[b] ??= { calls: 0, fails: 0, lastDegraded: null });
          e.calls++;
          if (c.degraded) { e.fails++; if (!e.lastDegraded) e.lastDegraded = c.degraded.slice(0, 160); }
        }
        const brains = Object.fromEntries(
          Object.entries(byBrain).map(([b, s]) => [b, { ...s, failRate: s.calls ? +(s.fails / s.calls).toFixed(2) : 0 }])
        );
        // Plain-language verdict for the operator.
        const cerebrasCalls = byBrain.cerebras?.calls ?? 0;
        const openai = byBrain.openai;
        const openaiFailRate = openai && openai.calls ? openai.fails / openai.calls : 0;
        let verdict = 'judgment brains healthy';
        if (!judged.length) verdict = 'no judgment calls in 24h (nothing to assess)';
        else if (cerebrasCalls > 0) verdict = `DEGRADED — the BULK brain wrote ${cerebrasCalls} judgment take(s) (this is the "songs make no sense" cause). Fix the paid brains: ${openai?.lastDegraded ?? byBrain.claude?.lastDegraded ?? 'see brains below'}`;
        else if (openaiFailRate >= 0.5) verdict = `OpenAI failing ${Math.round(openaiFailRate * 100)}% of judgment calls (${openai?.lastDegraded ?? 'unknown'}) — top up OpenAI billing or restore a working Claude key`;
        return { window: '24h', judgmentCalls: judged.length, brains, verdict };
      } catch (e) {
        return { error: (e as Error).message.slice(0, 120) };
      }
    })();

    return {
      brainOk,
      // Is the Claude key in an auth cooldown (bad/rejected key) — ms remaining,
      // 0 = live. Non-zero means the studio is running OpenAI-only right now.
      claudeAuthCooldownMs: anthropicAuthCooldownMs(),
      judgmentHealth,
      brainStatus: brainOk
        ? `OK via ${anthropic.ok ? 'Claude' : 'OpenAI'}`
        : 'DOWN — both Claude and OpenAI unreachable (usually exhausted credits). Top up Anthropic and/or OpenAI; lyrics/hooks/A&R/analysis/Zap-learn will fail until then.',
      anthropic,
      openai,
      // The BULK brain (Cerebras): every key pinged with the real model. allOk:false
      // means a key is dead/rate-limited — the leak-safe ladder covers it, but fix
      // the key so bulk work never has to fall back.
      cerebras,
      // THE CHAT BRAIN: the studio chat connects to the BRAIN — Claude first,
      // OpenAI fallback (Cerebras is hauling only, never the chat). claudeAuth
      // in cooldown => it's running on OpenAI right now, by design.
      chatBrain: anthropic.ok ? 'claude' : openai.ok ? 'openai (claude down — by design on the bad key)' : 'DOWN',
      // Why the last chat turn fell off Claude (null = it didn't) — a swallowed
      // billing 400 here used to read as "the chat is weak".
      lastChatClaudeError: getLastStudioChatClaudeError(),
      audd: { configured: !!process.env.AUDD_API_TOKEN }, // Zap song ID needs this
      eleven: { configured: !!process.env.ELEVENLABS_API_KEY }, // voice clone + ElevenLabs Music engine
      tavily: { configured: !!tavilyKey(), ...tavily },
      braveConfigured: !!braveKey(),
      trends: trend ? { ok: true, source: trend.source, sample: trend.digest.slice(0, 120) } : { ok: false },
      musicProvider: process.env.MUSIC_PROVIDER ?? '(unset)',
      engineRoute: recommendEngine('afrobeats', {
        firstParty: isFirstPartyWorkspace(workspaceId),
        sunoAvailable: !!(process.env.SUNO_API_KEY || process.env.SUNOAPI_KEY),
        elevenAvailable: !!(process.env.ELEVEN_API_KEY || process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || process.env.XI_API_KEY),
        replicateAvailable: !!(process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_TOKEN),
      }),
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
    await requireAdmin(req); // §1.11 THE WALL
    const genre = req.query.genre || 'afrobeats';
    const user = prompts.lyricUserPrompt({
      artist: { stageName: 'Test', laneSummary: 'afro', languages: ['pcm', 'en'], vocalTone: ['smooth'] } as never,
      brief: { mood: 'love' } as never,
      hookText: 'Under Lagos light, your smile dey my mind',
      cleanVersion: true,
      soundDna: laneDnaBrief(genre).slice(0, 1500),
    });
    const r1 = await claudeRaw({ system: prompts.LYRIC_SYSTEM, user, maxTokens: 4500 });
    return { attempt: r1 };
  });

  app.get<{ Querystring: { genre?: string; mood?: string; languages?: string } }>('/generation-context', async (req) => {
    await requireAdmin(req); // §1.11 THE WALL
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
    const dna = laneDnaBrief(genre);
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

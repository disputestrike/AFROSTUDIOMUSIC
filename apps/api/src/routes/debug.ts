import type { FastifyInstance } from 'fastify';
import { anthropicPing, tavilyKey, braveKey, tavilyPing, researchTrends } from '@afrohit/ai';

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
      // Which source actually answers (tavily → brave → free news_rss)
      trends: trend ? { ok: true, source: trend.source, sample: trend.digest.slice(0, 120) } : { ok: false },
      musicProvider: process.env.MUSIC_PROVIDER ?? '(unset)',
    };
  });
}

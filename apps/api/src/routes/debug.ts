import type { FastifyInstance } from 'fastify';
import { anthropicPing, tavilyKey, researchTrends } from '@afrohit/ai';

/**
 * AI wiring diagnostics — which providers the API service can actually reach.
 * Surfaces the real error the generation path swallows.
 */
export default async function debug(app: FastifyInstance) {
  app.get('/ai', async () => {
    const anthropic = await anthropicPing();
    let tavily: { configured: boolean; ok: boolean; error?: string } = {
      configured: !!tavilyKey(),
      ok: false,
    };
    if (tavilyKey()) {
      try {
        const t = await researchTrends({ genre: 'afrobeats' });
        tavily = { configured: true, ok: !!t?.digest };
      } catch (e) {
        tavily = { configured: true, ok: false, error: (e as Error).message.slice(0, 200) };
      }
    }
    return {
      openaiKey: !!process.env.OPENAI_API_KEY,
      anthropic,
      tavily,
      musicProvider: process.env.MUSIC_PROVIDER ?? '(unset)',
    };
  });
}

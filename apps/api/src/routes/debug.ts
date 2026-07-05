import type { FastifyInstance } from 'fastify';
import { anthropicPing, tavilyKey, tavilyPing } from '@afrohit/ai';

/**
 * AI wiring diagnostics — which providers the API service can actually reach.
 * Surfaces the real error the generation path swallows.
 */
export default async function debug(app: FastifyInstance) {
  app.get('/ai', async () => {
    const [anthropic, tavily] = await Promise.all([anthropicPing(), tavilyPing()]);
    return {
      openaiKey: !!process.env.OPENAI_API_KEY,
      anthropic,
      tavily: { configured: !!tavilyKey(), ...tavily },
      musicProvider: process.env.MUSIC_PROVIDER ?? '(unset)',
    };
  });
}

/**
 * Tavily — live web research. This is a real differentiator: the studio can
 * ground a song in what's ACTUALLY trending right now (fresh web data), which a
 * plain LLM (no browsing) can't do. Feeds the brief + A&R.
 *
 * Graceful: returns null if no key is set, or a stub in STUB_AI mode.
 */

export function tavilyKey(): string | undefined {
  return process.env.TAVILY_API_KEY || process.env.TAVILY_KEY || undefined;
}

export interface TrendResult {
  digest: string;
  sources: Array<{ title: string; url: string }>;
}

/**
 * Research what's currently trending for a genre/region. Returns a short digest
 * plus sources, or null if unavailable (caller proceeds without trends).
 */
export async function researchTrends(opts: {
  genre?: string;
  region?: string;
  query?: string;
}): Promise<TrendResult | null> {
  const region = opts.region ?? 'Nigeria & diaspora';
  const genre = opts.genre?.replace('_', ' ') ?? 'Afrobeats';
  const query =
    opts.query ??
    `What ${genre} songs, sounds, and themes are trending right now in ${region}? What are listeners and TikTok gravitating to this month?`;

  if (process.env.STUB_AI === '1') {
    return {
      digest:
        `[stub trends] ${genre} right now leans on log-drum amapiano bounce, mid-tempo 100-110 bpm, ` +
        `romantic + street themes, short chantable hooks that loop for TikTok, and Pidgin/Yoruba code-switching.`,
      sources: [
        { title: 'Trending Afrobeats (stub)', url: 'https://example.com/trends' },
      ],
    };
  }

  const key = tavilyKey();
  if (!key) return null;
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        max_results: 6,
        include_answer: true,
        topic: 'news',
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      answer?: string;
      results?: Array<{ title: string; url: string; content?: string }>;
    };
    const sources = (data.results ?? []).slice(0, 6).map((r) => ({ title: r.title, url: r.url }));
    const digest =
      data.answer ??
      sources.map((s) => `• ${s.title}`).join('\n') ??
      '';
    if (!digest) return null;
    return { digest, sources };
  } catch {
    return null;
  }
}

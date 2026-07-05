/**
 * Live trend research — grounds a song in what's ACTUALLY popping now (fresh web
 * data a plain LLM can't see). Feeds the hook writer + A&R director.
 *
 * Multi-source with graceful fallback so it's never hard-locked to one API:
 *   1. Tavily        (best digests; needs TAVILY_API_KEY; paid quota)
 *   2. Brave Search  (clean, generous free tier; needs BRAVE_API_KEY)
 *   3. Google News RSS (FREE, no key, no rate limit — always-on fallback)
 * First source that returns something wins. Returns null only if all fail.
 */

export function tavilyKey(): string | undefined {
  return process.env.TAVILY_API_KEY || process.env.TAVILY_KEY || undefined;
}
export function braveKey(): string | undefined {
  return process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY || undefined;
}

export interface TrendResult {
  digest: string;
  sources: Array<{ title: string; url: string }>;
  source: 'tavily' | 'brave' | 'news_rss' | 'stub';
}

/** Diagnostic: raw Tavily call surfacing the real status/error. */
export async function tavilyPing(): Promise<{ ok: boolean; status?: number; error?: string }> {
  const key = tavilyKey();
  if (!key) return { ok: false, error: 'no TAVILY_API_KEY' };
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: 'afrobeats trending now', max_results: 3, include_answer: true }),
    });
    if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 250) };
    return { ok: true, status: 200 };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

async function tryTavily(query: string): Promise<TrendResult | null> {
  const key = tavilyKey();
  if (!key) return null;
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ api_key: key, query, search_depth: 'basic', max_results: 6, include_answer: true }),
    });
    if (!res.ok) return null; // e.g. 432 plan limit → fall through to the next source
    const data = (await res.json()) as { answer?: string; results?: Array<{ title: string; url: string }> };
    const sources = (data.results ?? []).slice(0, 6).map((r) => ({ title: r.title, url: r.url }));
    const digest = data.answer || sources.map((s) => `• ${s.title}`).join('\n');
    return digest ? { digest, sources, source: 'tavily' } : null;
  } catch {
    return null;
  }
}

async function tryBrave(query: string): Promise<TrendResult | null> {
  const key = braveKey();
  if (!key) return null;
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`, {
      headers: { accept: 'application/json', 'x-subscription-token': key },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description?: string }> } };
    const results = data.web?.results ?? [];
    const sources = results.slice(0, 6).map((r) => ({ title: r.title, url: r.url }));
    const digest = results
      .slice(0, 6)
      .map((r) => `• ${r.title}${r.description ? ` — ${r.description}` : ''}`)
      .join('\n');
    return digest ? { digest, sources, source: 'brave' } : null;
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** FREE, no key, no rate limit: parse Google News RSS headlines for the genre. */
async function tryNewsRss(genre: string, region: string): Promise<TrendResult | null> {
  try {
    const q = encodeURIComponent(`${genre} trending song ${region}`);
    const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-NG&gl=NG&ceid=NG:en`, {
      headers: { 'user-agent': 'Mozilla/5.0 AfroHitStudio' },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8);
    const sources = items
      .map((m) => {
        const title = decodeEntities(/<title>([\s\S]*?)<\/title>/.exec(m[1]!)?.[1] ?? '');
        const url = decodeEntities(/<link>([\s\S]*?)<\/link>/.exec(m[1]!)?.[1] ?? '');
        return { title, url };
      })
      .filter((s) => s.title);
    if (!sources.length) return null;
    const digest = `Currently in the news / trending for ${genre} (${region}):\n` + sources.map((s) => `• ${s.title}`).join('\n');
    return { digest, sources: sources.slice(0, 6), source: 'news_rss' };
  } catch {
    return null;
  }
}

/**
 * Research what's currently trending. Tries Tavily → Brave → free Google News
 * RSS. Returns the first that works, or null if everything is unavailable.
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
      sources: [{ title: 'Trending Afrobeats (stub)', url: 'https://example.com/trends' }],
      source: 'stub',
    };
  }

  return (await tryTavily(query)) ?? (await tryBrave(query)) ?? (await tryNewsRss(genre, region));
}

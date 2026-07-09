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
export function youtubeKey(): string | undefined {
  return process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || undefined;
}

export interface TrendResult {
  digest: string;
  sources: Array<{ title: string; url: string }>;
  source: 'youtube' | 'apple_charts' | 'tavily' | 'brave' | 'news_rss' | 'stub';
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

/**
 * LEGAL "pull from YouTube": the official YouTube Data API returns METADATA only
 * (titles, artists/channels, view counts) — never audio. We use it to learn WHAT
 * is charting in the genre right now (this year + last), so new songs ride the
 * current wave. This is NOT ripping: no stream, no audio, no download — just the
 * public facts of what's hot, which are not copyrightable. Set YOUTUBE_API_KEY.
 */
async function tryYouTube(genre: string, region: string): Promise<TrendResult | null> {
  const key = youtubeKey();
  if (!key) return null;
  try {
    // Top by views, published in the last ~18 months = this year + last year's hits.
    const since = new Date();
    since.setMonth(since.getMonth() - 18);
    const q = encodeURIComponent(`${genre} ${region} hit song`);
    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10` +
      `&order=viewCount&maxResults=12&regionCode=NG&relevanceLanguage=en&publishedAfter=${since.toISOString()}&q=${q}&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return null; // quota/key issue → fall through to the next source
    const data = (await res.json()) as {
      items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }>;
    };
    const items = (data.items ?? []).filter((i) => i.snippet?.title);
    if (!items.length) return null;
    const sources = items.slice(0, 8).map((i) => ({
      title: decodeEntities(i.snippet!.title!) + (i.snippet!.channelTitle ? ` — ${i.snippet!.channelTitle}` : ''),
      url: i.id?.videoId ? `https://youtu.be/${i.id.videoId}` : 'https://youtube.com',
    }));
    const digest =
      `Top ${genre} charting on YouTube right now (${region}) — the current wave to ride (titles/artists as reference, NEVER to copy):\n` +
      sources.map((s) => `• ${s.title}`).join('\n');
    return { digest, sources: sources.slice(0, 6), source: 'youtube' };
  } catch {
    return null;
  }
}

/**
 * FREE + KEYLESS + LEGAL: Apple's public marketing RSS returns the actual
 * most-played chart per country as plain JSON (titles/artists only — facts,
 * never audio). Nigeria's chart for the Afro family, US otherwise. This is the
 * always-on chart source that works even when every paid key is capped.
 */
async function tryAppleCharts(genre: string, region: string): Promise<TrendResult | null> {
  try {
    const afro = /afro|amapiano|highlife|street|gospel|juju|fuji|alte|bongo/i.test(genre) || /nigeria|africa/i.test(region);
    const cc = afro ? 'ng' : 'us';
    const res = await fetch(`https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/25/songs.json`, {
      headers: { 'user-agent': 'Mozilla/5.0 AfroHitStudio' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { feed?: { results?: Array<{ name?: string; artistName?: string; url?: string; genres?: Array<{ name?: string }> }> } };
    const rows = (data.feed?.results ?? []).filter((r) => r.name);
    if (!rows.length) return null;
    const sources = rows.slice(0, 15).map((r) => ({
      title: `${r.name}${r.artistName ? ` — ${r.artistName}` : ''}${r.genres?.[0]?.name ? ` (${r.genres[0].name})` : ''}`,
      url: r.url || 'https://music.apple.com',
    }));
    const digest =
      `Most-played songs on Apple Music ${cc.toUpperCase()} RIGHT NOW (what listeners actually play — study the wave, never copy):\n` +
      sources.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
    return { digest, sources: sources.slice(0, 8), source: 'apple_charts' };
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

  // YouTube first (most genre-specific + current: the actual charting tracks).
  // Apple's keyless country chart (real most-played facts, survives every
  // quota cap) comes next — EXCEPT when the caller asked a specific question:
  // a country top-25 can't answer a custom query, so web digests go first then.
  if (opts.query) {
    return (
      (await tryYouTube(genre, region)) ??
      (await tryTavily(query)) ??
      (await tryBrave(query)) ??
      (await tryAppleCharts(genre, region)) ??
      (await tryNewsRss(genre, region))
    );
  }
  return (
    (await tryYouTube(genre, region)) ??
    (await tryAppleCharts(genre, region)) ??
    (await tryTavily(query)) ??
    (await tryBrave(query)) ??
    (await tryNewsRss(genre, region))
  );
}

/** Generic Tavily search → [{title,url,content}]. Empty (never throws) without a key. */
export async function tavilySearchRaw(query: string, maxResults = 4): Promise<Array<{ title: string; url: string; content: string }>> {
  const key = tavilyKey();
  if (!key) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, search_depth: 'basic', max_results: maxResults, include_answer: false }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.results ?? []).map((r) => ({ title: r.title ?? '', url: r.url ?? '', content: (r.content ?? '').slice(0, 2500) }));
  } catch { return []; }
}

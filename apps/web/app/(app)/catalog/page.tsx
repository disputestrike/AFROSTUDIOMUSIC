import { apiServer } from '@/lib/api-server';
import CatalogGrid, { type SongRow } from '@/components/CatalogGrid';

export default async function CatalogPage() {
  // null = the API call FAILED (distinct from an empty catalog) — never show a
  // false "No songs yet" when the songs simply couldn't be loaded.
  // 401 is NOT an outage: an expired session sent the owner chasing server
  // bugs for hours behind a red "API isn't reachable" banner. Say the true
  // thing and give the one-click way out.
  let songs: SongRow[] | null = null;
  try {
    songs = await apiServer<SongRow[]>('/songs');
  } catch {
    songs = null;
  }

  // CLIENT-LOAD FALLBACK (the real architecture fix, owner outage 2026-07-23):
  // the session cookie is set on the API domain, which the browser NEVER sends
  // to the web domain — so this server render can't authenticate and 401s,
  // which we were showing as "the studio API isn't reachable". The BROWSER can
  // authenticate (cross-site cookie, SameSite=None), so when the server render
  // comes back empty-handed we hand off and let the grid fetch it client-side.
  const ssrFailed = songs === null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-4xl">Catalog</h1>
      <p className="mt-2 text-sm text-slate-400">Every song you&apos;ve started — newest first. Hover a card to delete.</p>
      <CatalogGrid initial={songs ?? []} loadOnMount={ssrFailed} />
    </div>
  );
}

import { apiServer } from '@/lib/api-server';
import CatalogGrid, { type SongRow } from '@/components/CatalogGrid';

export default async function CatalogPage() {
  // null = the API call FAILED (distinct from an empty catalog) — never show a
  // false "No songs yet" when the songs simply couldn't be loaded.
  // 401 is NOT an outage: an expired session sent the owner chasing server
  // bugs for hours behind a red "API isn't reachable" banner. Say the true
  // thing and give the one-click way out.
  let songs: SongRow[] | null = null;
  let expired = false;
  try {
    songs = await apiServer<SongRow[]>('/songs');
  } catch (err) {
    if ((err as { status?: number })?.status === 401) expired = true;
  }

  if (expired) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="font-display text-4xl">Catalog</h1>
        <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-8 text-center">
          <p className="text-sm text-amber-200">
            Your session expired — your music is all still here. Sign in again to see it.
          </p>
          <a
            href="/signin"
            className="mt-4 inline-block rounded-full bg-brand-gradient px-5 py-2 text-sm font-medium text-ink"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-4xl">Catalog</h1>
      <p className="mt-2 text-sm text-slate-400">Every song you&apos;ve started — newest first. Hover a card to delete.</p>
      {songs === null ? (
        <div className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center text-sm text-red-300">
          Couldn&apos;t load your songs — the studio API isn&apos;t reachable right now. Your music is safe; refresh in a moment.
        </div>
      ) : (
        <CatalogGrid initial={songs} />
      )}
    </div>
  );
}

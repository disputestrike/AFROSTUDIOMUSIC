import { apiServer } from '@/lib/api-server';
import CatalogGrid, { type SongRow } from '@/components/CatalogGrid';

export default async function CatalogPage() {
  // null = the API call FAILED (distinct from an empty catalog) — never show a
  // false "No songs yet" when the songs simply couldn't be loaded.
  const songs = await apiServer<SongRow[]>('/songs').catch(() => null);

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

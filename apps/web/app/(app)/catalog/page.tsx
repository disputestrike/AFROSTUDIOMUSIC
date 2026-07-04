import { apiServer } from '@/lib/api-server';
import CatalogGrid, { type SongRow } from '@/components/CatalogGrid';

export default async function CatalogPage() {
  const songs = await apiServer<SongRow[]>('/songs').catch(() => [] as SongRow[]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-4xl">Catalog</h1>
      <p className="mt-2 text-sm text-slate-400">Every song you&apos;ve started — newest first. Hover a card to delete.</p>
      <CatalogGrid initial={songs} />
    </div>
  );
}

import { apiServer } from '@/lib/api-server';

interface Release {
  id: string;
  title: string;
  artist: string;
  genre: string;
  coverUrl: string | null;
  streamUrl: string | null;
  snippetUrl: string | null;
  isrc: string | null;
  releaseReady: boolean;
}

export const dynamic = 'force-dynamic';

/**
 * Public pre-save / smart-link release page — the catch-page a snippet drives
 * traffic to. No app shell, no login. This is where attention converts.
 */
export default async function PublicReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let r: Release | null = null;
  try {
    r = await apiServer<Release>(`/public/song/${id}`);
  } catch {
    r = null;
  }

  if (!r) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="font-display text-3xl">Not found</div>
        <p className="mt-2 text-sm text-slate-400">This release link isn’t live yet.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-14">
      <div className="rounded-3xl glass p-6 text-center shadow-card">
        {r.coverUrl ? (
          <img src={r.coverUrl} alt={r.title} className="mx-auto aspect-square w-full max-w-sm rounded-2xl border border-white/10 object-cover shadow-glow" />
        ) : (
          <div className="mx-auto flex aspect-square w-full max-w-sm items-center justify-center rounded-2xl bg-brand-gradient text-ink">
            <span className="font-display text-4xl">{r.title.slice(0, 1)}</span>
          </div>
        )}
        <h1 className="mt-5 font-display text-4xl leading-tight">{r.title}</h1>
        <div className="mt-1 text-sm text-slate-400">{r.artist} · {r.genre}</div>

        {r.streamUrl ? (
          <audio controls className="mt-5 w-full" src={r.streamUrl} />
        ) : (
          <div className="mt-5 rounded-full border border-white/10 px-4 py-2 text-sm text-slate-400">Dropping soon</div>
        )}

        {r.snippetUrl && (
          <a href={r.snippetUrl} className="mt-4 inline-block text-xs text-afrobrand-300 hover:text-afrobrand-200">
            ▶ Watch the clip
          </a>
        )}

        <div className="mt-6 border-t border-white/10 pt-4 text-[11px] text-slate-500">
          {r.isrc && <div>ISRC {r.isrc}</div>}
          <div className="mt-1">Made with AfroHits Studio · GenAI-assisted, human-directed</div>
        </div>
      </div>
    </main>
  );
}

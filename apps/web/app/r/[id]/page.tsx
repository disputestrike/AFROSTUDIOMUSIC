import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { apiServer } from '@/lib/api-server';
import { ReleasePlayer } from '@/components/release/ReleasePlayer';
import { PrimaryVisual } from '@/components/release/PrimaryVisual';

interface ReleaseClip {
  id: string;
  url: string;
  durationS: number;
  aspect: string;
  kind: string;
  captionText: string | null;
}

interface Release {
  id: string;
  title: string;
  artist: string;
  genre: string;
  coverUrl: string | null;
  /** The branded before-play still (cover + big "AFRO" mark) — the OG/Twitter
   *  image and the video's poster. Falls back to the cover server-side. */
  posterUrl: string | null;
  audioUrl: string | null;
  musicVideoUrl: string | null;
  visualizerUrl: string | null;
  lyricVideoUrl: string | null;
  clips: ReleaseClip[];
  lyrics: string | null;
  story: string | null;
  hook: string | null;
  isrc: string | null;
}

export const dynamic = 'force-dynamic';

// One fetch per request, shared by generateMetadata and the page render — the
// link preview and the page always describe the same release.
const getRelease = cache(async (id: string): Promise<Release | null> => {
  try {
    return await apiServer<Release>(`/public/song/${id}/release`);
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = await getRelease(id);
  if (!r) return { title: 'AfroHits — release', robots: { index: false } };

  const title = `${r.title} — ${r.artist}`;
  const description = r.story ?? `${r.title} by ${r.artist}. Listen and watch the full ${r.genre} release.`;
  // The branded poster is the link-preview image so a shared release always
  // previews with the "AFRO" brand mark (VEVO-style), not a bare cover. It is a
  // 16:9 still, ideal for the large-image card; it falls back to the cover.
  const ogImage = r.posterUrl ?? r.coverUrl;
  const images = ogImage ? [{ url: ogImage, width: 1280, height: 720, alt: `${r.title} — AfroHits` }] : [];

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images,
      type: 'music.song',
      siteName: 'AfroHits Studio',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImage ? [ogImage] : [],
    },
  };
}

export default async function PublicReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getRelease(id);

  if (!r) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <Link href="/" className="mb-8 font-display text-lg tracking-tight text-slate-300">
          <span className="text-gradient">AFROHITS</span> STUDIO
        </Link>
        <div className="font-display text-3xl">Not here</div>
        <p className="mt-2 text-sm text-slate-400">This release link isn’t live yet.</p>
        <Link href="/" className="mt-6 rounded-full bg-afrobrand-500 px-5 py-2 text-sm font-medium text-ink hover:bg-afrobrand-400">
          Explore AfroHits
        </Link>
      </main>
    );
  }

  const primaryVisual = r.musicVideoUrl ?? r.visualizerUrl;
  const primaryLabel = r.musicVideoUrl ? 'Music video' : 'Visualizer';
  // The branded poster stands in before any video plays (the video's thumbnail),
  // exactly like a VEVO still in a feed; falls back to the cover.
  const videoPoster = r.posterUrl ?? r.coverUrl;

  return (
    <main className="mx-auto max-w-2xl px-5 pb-24 pt-6 sm:px-6">
      {/* Brand mark — small, top */}
      <div className="flex items-center justify-between">
        <Link href="/" className="font-display text-lg tracking-tight text-slate-200">
          <span className="text-gradient">AFROHITS</span> STUDIO
        </Link>
        <span className="font-grotesk text-[10px] uppercase tracking-[0.3em] text-slate-500">Release</span>
      </div>

      {/* Hero — cover is the play button */}
      <section className="mt-6">
        <ReleasePlayer audioUrl={r.audioUrl} coverUrl={r.coverUrl} title={r.title} />
        <h1 className="mt-6 font-display text-4xl uppercase leading-[0.95] tracking-tight sm:text-5xl">{r.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
          <span className="text-slate-200">{r.artist}</span>
          <span aria-hidden>·</span>
          <span>{r.genre}</span>
        </div>
      </section>

      {/* What this song is about */}
      {r.story && (
        <section className="mt-8">
          <p className="text-[15px] leading-relaxed text-slate-300">{r.story}</p>
          {r.hook && <p className="mt-3 font-grotesk text-sm italic text-afrobrand-300">“{r.hook}”</p>}
        </section>
      )}

      {/* Primary visual — music video, else visualizer */}
      {primaryVisual && (
        <section className="mt-10">
          <PrimaryVisual src={primaryVisual} poster={videoPoster} label={primaryLabel} />
        </section>
      )}

      {/* Watch strip — the short clips + lyric video */}
      {(r.clips.length > 0 || r.lyricVideoUrl) && (
        <section className="mt-12">
          <h2 className="font-display text-2xl uppercase tracking-tight">Watch</h2>
          <div className="mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none]">
            {r.lyricVideoUrl && (
              <figure className="w-40 flex-shrink-0 snap-start sm:w-44">
                <video
                  src={r.lyricVideoUrl}
                  poster={videoPoster ?? undefined}
                  controls
                  playsInline
                  preload="none"
                  className="aspect-[9/16] w-full rounded-2xl border border-white/10 bg-black object-cover"
                />
                <figcaption className="mt-2 text-xs text-slate-400">Lyric video</figcaption>
              </figure>
            )}
            {r.clips.map((clip) => (
              <figure key={clip.id} className="w-40 flex-shrink-0 snap-start sm:w-44">
                <video
                  src={clip.url}
                  poster={videoPoster ?? undefined}
                  controls
                  playsInline
                  preload="none"
                  className="aspect-[9/16] w-full rounded-2xl border border-white/10 bg-black object-cover"
                />
                <figcaption className="mt-2 truncate text-xs text-slate-400" title={clip.captionText ?? undefined}>
                  {clip.captionText ?? `${Math.round(clip.durationS)}s clip`}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* Lyrics — verbatim */}
      {r.lyrics && (
        <section className="mt-12">
          <h2 className="font-display text-2xl uppercase tracking-tight">Lyrics</h2>
          <div className="mt-4 whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-slate-300">{r.lyrics}</div>
        </section>
      )}

      {/* Footer — drive the next creator in */}
      <footer className="mt-16 border-t border-white/10 pt-8 text-center">
        <p className="font-grotesk text-xs uppercase tracking-[0.2em] text-slate-500">Made in AfroHits Studio</p>
        <Link
          href="/signin?mode=signup"
          className="mt-4 inline-block rounded-full bg-afrobrand-500 px-6 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-afrobrand-400"
        >
          Make your own record
        </Link>
        {r.isrc && <div className="mt-6 font-grotesk text-[11px] text-slate-600">ISRC {r.isrc}</div>}
      </footer>
    </main>
  );
}

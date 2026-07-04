'use client';

/**
 * Turn a finished song into a vertical 9:16 clip for TikTok/Reels/Shorts —
 * the artifact that actually spreads. Cover + animated waveform + the hook
 * burned in. Download it, post it.
 */

import { useState } from 'react';
import { useApi } from '@/lib/api';

export function SnippetMaker({ projectId }: { projectId: string }) {
  const api = useApi();
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setUrl(null);
    setStatus('Cutting your clip…');
    try {
      const { jobId } = await api.post<{ jobId: string }>(`/projects/${projectId}/snippet`, {});
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const job = await api.get<{ status: string; outputJson?: { url?: string }; errorJson?: unknown }>(`/jobs/${jobId}`);
        if (job.status === 'SUCCEEDED' && job.outputJson?.url) {
          setUrl(job.outputJson.url);
          setStatus('Done — download it and post 🔥');
          return;
        }
        if (job.status === 'FAILED') {
          setStatus(`Couldn’t make the clip: ${JSON.stringify(job.errorJson ?? '').slice(0, 160)}`);
          return;
        }
      }
      setStatus('Still rendering — check back shortly.');
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl">🎬 Make a clip that spreads</h2>
      <p className="mt-1 text-sm text-slate-400">
        Turn your finished song into a vertical 9:16 clip for TikTok / Reels / Shorts — cover + waveform + the hook on screen. Post it and let it blow.
      </p>
      <div className="mt-4 rounded-2xl glass p-4">
        <button
          onClick={() => void make()}
          disabled={busy}
          className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
        >
          {busy ? 'Rendering…' : 'Make 9:16 clip'}
        </button>
        {status && <div className="mt-3 text-xs text-slate-400">{status}</div>}
        {url && (
          <div className="mt-4 flex flex-col gap-2">
            <video controls playsInline src={url} className="max-h-[520px] w-auto self-start rounded-xl border border-white/10" />
            <a href={url} download className="w-fit text-xs text-afrobrand-300 hover:text-afrobrand-200">
              ⬇ Download clip
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

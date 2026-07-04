import Link from 'next/link';
import { apiServer } from '@/lib/api-server';
import { StudioUpload } from '@/components/StudioUpload';
import { Mixer } from '@/components/Mixer';
import { ReferenceListen } from '@/components/ReferenceListen';
import { SnippetMaker } from '@/components/SnippetMaker';
import { DropMachine } from '@/components/DropMachine';
import { ReleaseReadiness } from '@/components/ReleaseReadiness';

interface Project {
  id: string;
  title: string;
  genre: string;
  bpm: number | null;
  artist: { stageName: string; languages: string[]; vocalTone: string[] };
  briefs: Array<{ id: string; mood: string | null; topic: string | null; bpm: number | null; language: string[] }>;
  hooks: Array<{ id: string; text: string; score: number | null; approved: boolean }>;
  lyrics: Array<{ id: string; title: string | null; approved: boolean }>;
  beats: Array<{ id: string; url: string; bpm: number | null }>;
  vocalRenders: Array<{ id: string; url: string; role: string }>;
  mixes: Array<{ id: string; preset: string; url: string }>;
  masters: Array<{ id: string; preset: string; url: string }>;
  imageAssets: Array<{ id: string; kind: string; url: string }>;
  videoConcepts: Array<{ id: string; title: string }>;
  approvals: Array<{ id: string; gate: string; decision: string; createdAt: string }>;
}

const GATES = ['brief', 'hook', 'lyrics', 'beat', 'voice', 'mix', 'rights', 'release'];

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await apiServer<Project>(`/projects/${id}`);

  const gateState = Object.fromEntries(
    GATES.map((g) => {
      const last = p.approvals.find((a) => a.gate === g);
      return [g, last?.decision ?? 'pending'];
    })
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-5xl">{p.title}</h1>
          <div className="mt-1 text-sm text-slate-400">
            {p.artist.stageName} · {p.genre} · {p.bpm ? `${p.bpm} bpm` : 'no BPM'}
          </div>
        </div>
        <Link
          href={`/studio?project=${p.id}`}
          className="rounded-full bg-afrobrand-500 px-4 py-2 text-sm font-medium text-ink hover:bg-afrobrand-400"
        >
          Open in Studio Chat
        </Link>
      </div>

      <Pipeline gateState={gateState} />

      <StudioUpload projectId={p.id} />

      <ReferenceListen projectId={p.id} />

      <Mixer projectId={p.id} />

      <DropMachine projectId={p.id} />

      <SnippetMaker projectId={p.id} />

      <ReleaseReadiness projectId={p.id} />

      <Section title="Latest brief">
        {p.briefs[0] ? (
          <div className="grid gap-2 text-sm text-slate-300">
            <div><span className="text-slate-500">Mood:</span> {p.briefs[0].mood ?? '—'}</div>
            <div><span className="text-slate-500">Topic:</span> {p.briefs[0].topic ?? '—'}</div>
            <div><span className="text-slate-500">Languages:</span> {p.briefs[0].language.join(', ') || '—'}</div>
            <div><span className="text-slate-500">BPM:</span> {p.briefs[0].bpm ?? '—'}</div>
          </div>
        ) : (
          <Empty hint="Use Studio Chat: 'polish this brief: ...'." />
        )}
      </Section>

      <Section title={`Hooks (${p.hooks.length})`}>
        <ul className="grid gap-2 md:grid-cols-2">
          {p.hooks.slice(0, 10).map((h) => (
            <li key={h.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="whitespace-pre-wrap text-sm">{h.text}</div>
              <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                <span>score {h.score?.toFixed(1) ?? '—'}</span>
                {h.approved && <span className="text-emerald-400">approved</span>}
              </div>
            </li>
          ))}
        </ul>
        {p.hooks.length === 0 && <Empty hint="In chat: 'give me 25 hooks'." />}
      </Section>

      <Section title="Lyrics">
        {p.lyrics.length ? (
          <ul className="space-y-2 text-sm text-slate-200">
            {p.lyrics.map((l) => (
              <li key={l.id} className="rounded border border-slate-800 p-2">
                {l.title ?? 'Untitled'} {l.approved && <span className="text-emerald-400">· approved</span>}
              </li>
            ))}
          </ul>
        ) : (
          <Empty hint="Approve a hook first, then 'write the lyrics'." />
        )}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Beats" small>
          {p.beats.length ? p.beats.map((b) => <AudioRow key={b.id} url={b.url} label={`Beat · ${b.bpm ?? '?'} bpm`} />) : <Empty hint="Approve lyrics, then create a beat." />}
        </Section>
        <Section title="Vocals" small>
          {p.vocalRenders.length ? p.vocalRenders.map((v) => <AudioRow key={v.id} url={v.url} label={v.role} />) : <Empty hint="Need a Voice Profile and approved lyrics." />}
        </Section>
        <Section title="Mixes" small>
          {p.mixes.length ? p.mixes.map((m) => <AudioRow key={m.id} url={m.url} label={`Mix · ${m.preset}`} />) : <Empty hint="Create a mix once vocals are approved." />}
        </Section>
        <Section title="Masters" small>
          {p.masters.length ? p.masters.map((m) => <AudioRow key={m.id} url={m.url} label={`Master · ${m.preset}`} />) : <Empty />}
        </Section>
        <Section title="Cover art" small>
          {p.imageAssets.length ? (
            <div className="grid grid-cols-3 gap-2">
              {p.imageAssets.map((i) => (
                <img key={i.id} src={i.url} alt="" className="aspect-square w-full rounded-lg border border-slate-800 object-cover" />
              ))}
            </div>
          ) : <Empty hint="Generate cover art from chat." />}
        </Section>
        <Section title="Video concepts" small>
          {p.videoConcepts.length ? (
            <ul className="space-y-1 text-sm">
              {p.videoConcepts.map((v) => <li key={v.id}>{v.title}</li>)}
            </ul>
          ) : <Empty hint="Build a 15-sec storyboard from chat before paying for a render." />}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, small, children }: { title: string; small?: boolean; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className={small ? 'font-display text-xl' : 'font-display text-2xl'}>{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ hint }: { hint?: string }) {
  return <div className="rounded border border-dashed border-slate-800 p-3 text-xs text-slate-500">{hint ?? 'Nothing yet.'}</div>;
}

function AudioRow({ url, label }: { url: string; label: string }) {
  return (
    <div className="mb-2 rounded border border-slate-800 bg-slate-900/40 p-2">
      <div className="mb-1 text-xs text-slate-400">{label}</div>
      <audio controls className="w-full" src={url} />
    </div>
  );
}

function Pipeline({ gateState }: { gateState: Record<string, string> }) {
  return (
    <div className="mt-8 flex flex-wrap gap-2 text-xs">
      {GATES.map((g) => {
        const s = gateState[g];
        const cls = s === 'approved' ? 'bg-emerald-500/15 text-emerald-300' : s === 'rejected' ? 'bg-red-500/15 text-red-300' : s === 'changes_requested' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800 text-slate-400';
        return (
          <span key={g} className={`rounded-full px-3 py-1 ${cls}`}>
            {g}
          </span>
        );
      })}
    </div>
  );
}

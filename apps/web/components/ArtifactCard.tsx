'use client';

import { CheckCircle2, ListMusic, FileText, Image as ImageIcon, Film, ShieldCheck, Clock } from 'lucide-react';

interface Props {
  toolName: string;
  output: unknown;
}

/**
 * Renders the right card for each chat tool's return shape. We deliberately
 * keep this minimal in MVP — every artifact has an obvious next-action button
 * the user can hit.
 */
export function ArtifactCard({ toolName, output }: Props) {
  const o = output as Record<string, unknown>;
  if (!o) return null;
  if ((o as { pending?: boolean }).pending) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Clock className="h-4 w-4 animate-pulse text-afrobrand-400" /> running…
      </div>
    );
  }
  if ((o as { error?: string }).error) {
    return <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-red-300">{String((o as { error: string }).error)}</div>;
  }

  switch (toolName) {
    case 'generate_hooks':
      return <HookList hooks={(o as { hooks: Array<{ id: string; text: string }> }).hooks ?? []} />;
    case 'score_hooks':
      return <ScoresList scores={(o as { scores: Array<{ id: string; overall: number; notes?: string }> }).scores ?? []} />;
    case 'generate_lyrics':
      return <LyricSummary lyric={(o as { lyric: { id: string; title: string } }).lyric} />;
    case 'polish_brief':
      return <BriefSummary brief={(o as { polished: Record<string, unknown> }).polished} />;
    case 'create_beat_job':
    case 'render_demo_vocal':
    case 'generate_cover_art':
    case 'render_video':
    case 'create_release_kit':
      return <JobPending jobId={String((o as { jobId: string }).jobId)} kind={toolName} />;
    case 'generate_video_storyboard':
      return <Storyboard concept={(o as { concept: { id: string; title: string; shots: unknown[] } }).concept} />;
    case 'approve_hook':
      return <ApprovedHook hookId={String((o as { hookId: string }).hookId)} songId={String((o as { songId: string }).songId)} />;
    case 'run_rights_check':
      return <RightsResult o={o as never} />;
    case 'request_approval':
      return <ApprovalRequest gate={String((o as { gate: string }).gate)} note={String((o as { note?: string }).note ?? '')} />;
    default:
      return (
        <pre className="overflow-x-auto rounded-xl bg-black/40 p-3 text-xs text-slate-300">
          {JSON.stringify(o, null, 2)}
        </pre>
      );
  }
}

function HookList({ hooks }: { hooks: Array<{ id: string; text: string }> }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-medium text-slate-200">
        <ListMusic className="h-4 w-4 text-afrobrand-400" /> {hooks.length} hooks
      </div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {hooks.map((h, i) => (
          <li key={h.id} className="flex gap-2 rounded-lg border border-slate-800 bg-black/30 p-2.5 text-slate-100">
            <span className="mt-0.5 select-none text-xs font-semibold text-afrobrand-400">{i + 1}.</span>
            <span className="whitespace-pre-wrap text-sm leading-snug">{h.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ScoresList({ scores }: { scores: Array<{ id: string; overall: number; notes?: string }> }) {
  const sorted = [...scores].sort((a, b) => b.overall - a.overall);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-slate-300">A&R scores</div>
      <ul className="space-y-1.5">
        {sorted.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-black/30 p-2 text-xs">
            <span className="select-none text-slate-500">{i + 1}.</span>
            <span className="w-10 text-right font-semibold text-afrobrand-400">{s.overall.toFixed(1)}</span>
            <span className="text-slate-300">{s.notes ?? '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LyricSummary({ lyric }: { lyric: { id: string; title: string } }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-200">
      <FileText className="h-4 w-4 text-afrobrand-400" />
      Lyric ready: <span className="font-medium">{lyric.title}</span>
    </div>
  );
}

function BriefSummary({ brief }: { brief: Record<string, unknown> }) {
  const b = brief as {
    mood?: string; topic?: string; language?: string[]; audience?: string;
    bpm?: number; references?: Array<{ name: string; lane: string }>; notes?: string;
  };
  const row = (label: string, value?: React.ReactNode) =>
    value ? (
      <div className="flex gap-2">
        <span className="w-20 shrink-0 text-slate-500">{label}</span>
        <span className="text-slate-200">{value}</span>
      </div>
    ) : null;
  return (
    <div className="space-y-1 text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium text-slate-200">
        <FileText className="h-4 w-4 text-afrobrand-400" /> Song brief
      </div>
      {row('Mood', b.mood)}
      {row('Topic', b.topic)}
      {row('Language', b.language?.join(', '))}
      {row('Audience', b.audience)}
      {row('BPM', b.bpm)}
      {row('Lane', b.references?.map((r) => `${r.name} (${r.lane})`).join(', '))}
      {row('Notes', b.notes)}
    </div>
  );
}

function Storyboard({ concept }: { concept: { id: string; title: string; shots: unknown[] } }) {
  return (
    <div className="text-sm text-slate-200">
      <div className="flex items-center gap-2"><Film className="h-4 w-4 text-afrobrand-400" /> Storyboard: <span className="font-medium">{concept.title}</span></div>
      <div className="mt-1 text-xs text-slate-400">{concept.shots.length} shots — review before rendering (renders cost credits).</div>
    </div>
  );
}

const JOB_LABEL: Record<string, string> = {
  create_beat_job: 'Making the beat',
  render_demo_vocal: 'Rendering your vocal',
  generate_cover_art: 'Painting the cover art',
  render_video: 'Rendering the video',
  create_release_kit: 'Bundling the release',
};

function JobPending({ jobId: _jobId, kind }: { jobId: string; kind: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-300">
      <Clock className="h-4 w-4 animate-pulse text-afrobrand-400" />
      {JOB_LABEL[kind] ?? 'Working'}… <span className="text-xs text-slate-500">(this runs in the background)</span>
    </div>
  );
}

function ApprovedHook({ songId: _songId }: { hookId: string; songId: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-emerald-300">
      <CheckCircle2 className="h-4 w-4" /> Hook approved — song started
    </div>
  );
}

function RightsResult({ o }: { o: { receiptId: string; check: { overallRisk: string; okToExport: boolean } } }) {
  const ok = o.check.okToExport;
  return (
    <div className={`flex items-center gap-2 text-sm ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>
      <ShieldCheck className="h-4 w-4" /> Rights check: {o.check.overallRisk.toUpperCase()} risk · {ok ? 'cleared to release' : 'needs review'}
    </div>
  );
}

function ApprovalRequest({ gate, note }: { gate: string; note: string }) {
  return (
    <div className="text-sm text-amber-200">
      Approval requested at gate <span className="font-mono">{gate}</span>
      {note && <span className="text-slate-300"> — {note}</span>}
    </div>
  );
}

// Re-export for the chat to render image-like artifacts when we add streaming.
export { ImageIcon };

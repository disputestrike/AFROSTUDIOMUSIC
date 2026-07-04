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
      <div className="mb-2 flex items-center gap-2 text-slate-300"><ListMusic className="h-4 w-4" /> {hooks.length} hooks</div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {hooks.map((h) => (
          <li key={h.id} className="rounded-lg border border-slate-800 bg-black/30 p-2 text-slate-200">
            <div className="line-clamp-3 whitespace-pre-wrap text-sm">{h.text}</div>
            <div className="mt-1 font-mono text-[10px] text-slate-500">{h.id}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoresList({ scores }: { scores: Array<{ id: string; overall: number; notes?: string }> }) {
  const sorted = [...scores].sort((a, b) => b.overall - a.overall);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-slate-300">A&R scores</div>
      <ul className="space-y-1.5">
        {sorted.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-black/30 p-2 text-xs">
            <span className="w-12 text-right font-mono text-afrobrand-400">{s.overall.toFixed(1)}</span>
            <span className="text-slate-300">{s.notes ?? '—'}</span>
            <span className="ml-auto font-mono text-[10px] text-slate-500">{s.id.slice(-6)}</span>
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
      <span className="font-mono text-[10px] text-slate-500">{lyric.id}</span>
    </div>
  );
}

function BriefSummary({ brief }: { brief: Record<string, unknown> }) {
  return (
    <pre className="rounded-lg bg-black/40 p-3 text-xs text-slate-200">
      {JSON.stringify(brief, null, 2)}
    </pre>
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

function JobPending({ jobId, kind }: { jobId: string; kind: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-300">
      <Clock className="h-4 w-4 text-afrobrand-400 animate-pulse" />
      Queued <span className="text-slate-500">({kind})</span>
      <span className="ml-auto font-mono text-[10px] text-slate-500">{jobId}</span>
    </div>
  );
}

function ApprovedHook({ hookId, songId }: { hookId: string; songId: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-emerald-300">
      <CheckCircle2 className="h-4 w-4" /> Hook approved → song {songId.slice(-6)}
    </div>
  );
}

function RightsResult({ o }: { o: { receiptId: string; check: { overallRisk: string; okToExport: boolean } } }) {
  const ok = o.check.okToExport;
  return (
    <div className={`flex items-center gap-2 text-sm ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>
      <ShieldCheck className="h-4 w-4" /> Rights: {o.check.overallRisk.toUpperCase()} · receipt {o.receiptId.slice(-6)} · {ok ? 'ok to export' : 'review needed'}
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

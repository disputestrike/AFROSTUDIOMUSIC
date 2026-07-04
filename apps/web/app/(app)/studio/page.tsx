import StudioChat from '@/components/StudioChat';

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <div className="grid h-[calc(100vh-49px)] grid-cols-[1fr_360px]">
      <StudioChat projectId={project} />
      <aside className="border-l border-slate-800 bg-slate-950/40">
        <div className="px-5 py-4 text-sm font-medium uppercase tracking-widest text-slate-400">
          Artifacts
        </div>
        <div id="artifact-pane" className="px-5 pb-6 text-sm text-slate-300">
          As you and the model work, hooks, lyrics, beats, vocals, art, and video renders show up here for approval.
        </div>
      </aside>
    </div>
  );
}

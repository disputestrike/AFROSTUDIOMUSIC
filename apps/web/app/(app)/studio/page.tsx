import StudioChat from '@/components/StudioChat';

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <div className="h-[calc(100vh-49px)]">
      <StudioChat projectId={project} />
    </div>
  );
}

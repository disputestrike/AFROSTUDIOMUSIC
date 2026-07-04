import StudioChat from '@/components/StudioChat';

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <div className="h-full">
      <StudioChat projectId={project} />
    </div>
  );
}

import Link from 'next/link';
import { apiServer } from '@/lib/api-server';
import ProjectsList, { type ProjectRow } from '@/components/ProjectsList';
import { OperatorGate } from '@/components/OperatorGate';

// TENANT SURFACE ISOLATION (Wave 8a): the RAW projects list is operator
// plumbing — consumers reach their work through Catalog and the Studio flows.
// Project DETAIL pages (/projects/[id], /projects/new) stay shared: consumer
// flows navigate there. The gate is presentation; /projects data stays
// workspace-scoped server-side either way.
export default async function ProjectsPage() {
  // null = fetch FAILED — show an honest error, never a false "no projects".
  const projects = await apiServer<ProjectRow[]>('/projects').catch(() => null);

  return (
    <OperatorGate>
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">Projects</h1>
        <Link
          href="/projects/new"
          className="rounded-full bg-afrobrand-500 px-4 py-2 text-sm font-medium text-ink hover:bg-afrobrand-400"
        >
          New project
        </Link>
      </div>
      {projects === null ? (
        <div className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center text-sm text-red-300">
          Couldn&apos;t load projects — the studio API isn&apos;t reachable right now. Refresh in a moment.
        </div>
      ) : (
        <ProjectsList initial={projects} />
      )}
    </div>
    </OperatorGate>
  );
}

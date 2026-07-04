import { apiServer } from '@/lib/api-server';

interface Job {
  id: string;
  kind: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  provider: string;
  createdAt: string;
}

export default async function CatalogPage() {
  const jobs = await apiServer<Job[]>('/jobs').catch(() => [] as Job[]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-display text-4xl">Catalog & Jobs</h1>
      <p className="mt-2 text-sm text-slate-400">Everything you and the studio have generated.</p>

      <table className="mt-6 w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-widest text-slate-400">
          <tr><th className="py-2">Kind</th><th>Provider</th><th>Status</th><th>Created</th></tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-t border-slate-800">
              <td className="py-2">{j.kind}</td>
              <td>{j.provider}</td>
              <td>
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  j.status === 'SUCCEEDED' ? 'bg-emerald-500/15 text-emerald-300' :
                  j.status === 'FAILED' ? 'bg-red-500/15 text-red-300' :
                  j.status === 'RUNNING' ? 'bg-afrobrand-500/15 text-afrobrand-300' :
                  'bg-slate-800 text-slate-400'
                }`}>{j.status}</span>
              </td>
              <td>{new Date(j.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {jobs.length === 0 && <div className="mt-4 text-sm text-slate-500">No jobs yet.</div>}
    </div>
  );
}

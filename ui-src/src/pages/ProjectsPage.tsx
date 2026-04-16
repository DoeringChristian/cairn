import { Link } from "react-router-dom";
import { useProjects } from "../api/hooks";
import { formatRelative } from "../lib/format";

export default function ProjectsPage() {
  const q = useProjects();
  if (q.isLoading) return <p className="text-fg-muted">Loading…</p>;
  if (q.isError) return <p className="text-status-failed">Failed to load projects: {String(q.error)}</p>;
  const projects = q.data?.projects ?? [];
  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <p className="text-sm text-fg-muted">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </p>
      </div>
      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {projects.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-border bg-bg-elevated p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    to={`/p/${p.id}`}
                    className="mono flex min-h-[44px] flex-1 items-center text-accent hover:underline"
                  >
                    {p.id}
                  </Link>
                  {p.active_run_count > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-status-running">
                      <span className="inline-block h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-status-running" />
                      {p.active_run_count} active
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <span>last run: {formatRelative(p.last_run_at)}</span>
                  <span className="num">total: {p.run_count}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Last run</th>
                  <th className="px-4 py-2">Total</th>
                  <th className="px-4 py-2">Active</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-t border-border-subtle hover:bg-bg-elevated">
                    <td className="px-4 py-2">
                      <Link to={`/p/${p.id}`} className="mono text-accent hover:underline">
                        {p.id}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-fg-muted">{formatRelative(p.last_run_at)}</td>
                    <td className="px-4 py-2 num">{p.run_count}</td>
                    <td className="px-4 py-2 num">
                      {p.active_run_count > 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-status-running">
                          <span className="inline-block h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-status-running" />
                          {p.active_run_count}
                        </span>
                      ) : (
                        <span className="text-fg-subtle">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-8 text-center">
      <p className="text-fg-muted">No runs yet.</p>
      <pre className="mono mt-4 overflow-auto rounded bg-bg p-3 text-left text-xs text-fg-subtle">
        {`import cairn
with cairn.Run(project="demo", task="smoke", repo="./.cairn") as run:
    run.track(0.5, name="loss", step=0)`}
      </pre>
    </div>
  );
}

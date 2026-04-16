import { Link, NavLink, useParams } from "react-router-dom";
import { useRuns } from "../api/hooks";
import { formatDuration, formatRelative } from "../lib/format";
import RunStatusBadge from "../components/RunStatusBadge";
import { ProjectProvider } from "../lib/project-context";

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useRuns({ project: projectId, limit: 200 });

  if (!projectId) return null;
  if (q.isLoading) return <p className="text-fg-muted">Loading…</p>;
  if (q.isError) return <p className="text-status-failed">Error: {String(q.error)}</p>;
  const runs = q.data?.runs ?? [];

  return (
    <ProjectProvider value={projectId}>
    <div>
      <nav className="mb-4 flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
        <Link to="/" className="hover:text-fg">Projects</Link>
        <span>›</span>
        <span className="mono text-fg">{projectId}</span>
      </nav>
      <nav className="mb-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border">
        <NavLink
          to={`/p/${projectId}`}
          end
          className={({ isActive }) =>
            [
              "border-b-2 px-3 py-2 text-sm transition-colors",
              isActive
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            ].join(" ")
          }
        >
          Workspace
        </NavLink>
        <NavLink
          to={`/p/${projectId}/runs`}
          className={({ isActive }) =>
            [
              "border-b-2 px-3 py-2 text-sm transition-colors",
              isActive
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            ].join(" ")
          }
        >
          Runs table
        </NavLink>
        <NavLink
          to={`/p/${projectId}/compare`}
          className={({ isActive }) =>
            [
              "border-b-2 px-3 py-2 text-sm transition-colors",
              isActive
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            ].join(" ")
          }
        >
          Compare
        </NavLink>
      </nav>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="mono text-xl font-semibold">{projectId}</h1>
        <p className="text-sm text-fg-muted">{runs.length} run(s)</p>
      </div>
      {runs.length === 0 ? (
        <p className="text-fg-muted">No runs in this project yet.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {runs.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-border bg-bg-elevated p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    to={`/p/${projectId}/r/${r.id}`}
                    className="mono flex min-h-[44px] items-center text-accent hover:underline"
                  >
                    {r.display_name ?? r.id}
                  </Link>
                  <RunStatusBadge status={r.status} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <span className="mono">task: {r.task_id.split("/")[1]}</span>
                  <span>started: {formatRelative(r.created_at)}</span>
                  <span className="mono num">
                    dur: {formatDuration(r.created_at, r.ended_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-4 py-2">Run</th>
                  <th className="px-4 py-2">Task</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Started</th>
                  <th className="px-4 py-2">Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-border-subtle hover:bg-bg-elevated">
                    <td className="px-4 py-2">
                      <Link
                        to={`/p/${projectId}/r/${r.id}`}
                        className="mono text-accent hover:underline"
                      >
                        {r.display_name ?? r.id}
                      </Link>
                      {r.display_name ? (
                        <span className="mono ml-2 text-xs text-fg-subtle">{r.id}</span>
                      ) : null}
                    </td>
                    <td className="mono px-4 py-2 text-fg-muted">{r.task_id.split("/")[1]}</td>
                    <td className="px-4 py-2">
                      <RunStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2 text-fg-muted">{formatRelative(r.created_at)}</td>
                    <td className="mono px-4 py-2 num text-fg-muted">
                      {formatDuration(r.created_at, r.ended_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
    </ProjectProvider>
  );
}

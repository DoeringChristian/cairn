import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { useRun } from "../api/hooks";
import RunStatusBadge from "../components/RunStatusBadge";
import { formatDuration, formatRelative } from "../lib/format";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "metrics", label: "Metrics & Media" },
  { id: "logs", label: "Logs" },
  { id: "source", label: "Source" },
  { id: "env", label: "Environment" },
];

export default function RunDetailPage() {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const q = useRun(runId!);

  if (q.isLoading) return <p className="text-fg-muted">Loading…</p>;
  if (q.isError) return <p className="text-status-failed">Error: {String(q.error)}</p>;
  if (!q.data) return null;
  const run = q.data.run;

  return (
    <div>
      <nav className="mb-3 flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
        <Link to="/" className="hover:text-fg">Projects</Link>
        <span>›</span>
        <Link to={`/p/${projectId}`} className="mono hover:text-fg">{projectId}</Link>
        <span>›</span>
        <span className="mono text-fg">{run.id}</span>
      </nav>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="mono text-xl font-semibold">
          {run.display_name ?? run.id}
        </h1>
        <RunStatusBadge status={run.status} />
        {run.display_name ? (
          <span className="mono text-xs text-fg-subtle">{run.id}</span>
        ) : null}
        <span className="ml-auto text-xs text-fg-muted">
          Started {formatRelative(run.created_at)} · Duration{" "}
          <span className="mono num">{formatDuration(run.created_at, run.ended_at)}</span>
        </span>
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={t.id}
            end={t.id === "overview"}
            className={({ isActive }) =>
              [
                "border-b-2 px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              ].join(" ")
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ run, params: q.data.params }} />
    </div>
  );
}

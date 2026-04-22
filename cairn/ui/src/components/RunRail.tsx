import { Link } from "react-router-dom";
import type { Run } from "../api/types";
import type { WorkspaceVisibility } from "../lib/workspace-visibility";
import { formatRelative } from "../lib/format";
import RunStatusBadge from "./RunStatusBadge";

interface Props {
  runs: Run[];
  visibility: WorkspaceVisibility;
  onToggle: (runId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  colors: Map<string, string>;
}

export default function RunRail({
  runs,
  visibility,
  onToggle,
  onShowAll,
  onHideAll,
  colors,
}: Props) {
  const visibleCount = runs.filter(
    (r) => !visibility.hiddenRunIds.has(r.id),
  ).length;

  return (
    <aside className="hidden w-56 shrink-0 md:flex md:flex-col">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Runs{" "}
          <span className="font-normal">
            ({visibleCount}/{runs.length})
          </span>
        </h2>
        <span className="flex gap-1">
          <button
            type="button"
            onClick={onShowAll}
            className="rounded px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            all
          </button>
          <button
            type="button"
            onClick={onHideAll}
            className="rounded px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            none
          </button>
        </span>
      </header>

      <ul className="max-h-[calc(100vh-12rem)] space-y-1 overflow-y-auto">
        {runs.map((r) => {
          const checked = !visibility.hiddenRunIds.has(r.id);
          const color = colors.get(r.id) ?? "#656d76";
          return (
            <li
              key={r.id}
              className="flex items-start gap-1.5 rounded px-1.5 py-1 hover:bg-bg-hover"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(r.id)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-2"
                style={{
                  accentColor: color,
                  borderColor: checked ? color : undefined,
                }}
                aria-label={`Toggle visibility for ${r.display_name ?? r.id}`}
              />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/p/${r.project_id}/r/${r.id}`}
                  className="mono block truncate text-xs text-accent hover:underline"
                  title={r.id}
                >
                  {r.display_name ?? r.id}
                </Link>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <RunStatusBadge status={r.status} />
                  <span className="text-[10px] text-fg-subtle" title={r.created_at}>
                    {(() => {
                      try {
                        const d = new Date(r.created_at);
                        return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
                      } catch { return formatRelative(r.created_at); }
                    })()}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

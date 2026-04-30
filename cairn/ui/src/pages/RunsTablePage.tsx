import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useRuns } from "../api/hooks";
import type { Run, RunStatus } from "../api/types";
import RunStatusBadge from "../components/RunStatusBadge";
import { formatDuration, formatRelative, safeJsonParse } from "../lib/format";
import { addCardToComparison, createComparison, useTemplates, type ComparisonTemplate } from "../lib/comparisons";
import { saveCardSettings } from "../lib/card-settings";
import { api } from "../api/client";
import { setRunMetadata } from "../lib/run-label";
import SettingsPopover from "../components/SettingsPopover";

type SortColumn =
  | "name"
  | "status"
  | "created_at"
  | "duration"
  | "tags";
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

const STATUS_OPTIONS: Array<{ value: "all" | RunStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "running" },
  { value: "completed", label: "completed" },
  { value: "failed", label: "failed" },
  { value: "killed", label: "killed" },
];

function durationSeconds(run: Run): number {
  const start = new Date(run.created_at).getTime();
  const end = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();
  return Math.max(0, end - start);
}

function compareRuns(a: Run, b: Run, col: SortColumn): number {
  switch (col) {
    case "name": {
      const an = (a.display_name ?? a.id).toLowerCase();
      const bn = (b.display_name ?? b.id).toLowerCase();
      return an.localeCompare(bn);
    }
    case "status":
      return a.status.localeCompare(b.status);
    case "created_at":
      return (
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    case "duration":
      return durationSeconds(a) - durationSeconds(b);
    case "tags": {
      const at = (safeJsonParse<string[]>(a.tags) ?? []).join(",");
      const bt = (safeJsonParse<string[]>(b.tags) ?? []).join(",");
      return at.localeCompare(bt);
    }
  }
}

export default function RunsTablePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const q = useRuns({ project: projectId, limit: 200 });

  const [statusFilter, setStatusFilter] = useState<"all" | RunStatus>("all");
  const [search, setSearch] = useState<string>("");
  const [sort, setSort] = useState<SortState>({
    column: "created_at",
    direction: "desc",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);
  const templateBtnRef = useRef<HTMLButtonElement | null>(null);
  const { templates } = useTemplates(projectId ?? "");

  const runs = useMemo(() => q.data?.runs ?? [], [q.data]);

  // Populate run label cache for formatting across the app.
  useMemo(() => { if (runs.length > 0) setRunMetadata(runs); }, [runs]);

  const { regex: searchRegex, error: searchError } = useMemo(() => {
    const raw = search.trim();
    if (!raw) return { regex: null, error: null };
    try {
      return { regex: new RegExp(raw, "i"), error: null };
    } catch {
      return { regex: null, error: "invalid regex" };
    }
  }, [search]);

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (searchRegex) {
        const tags = (safeJsonParse<string[]>(r.tags) ?? []).join(" ");
        const hay = `${r.display_name ?? ""} ${r.id} ${r.status} ${tags}`;
        if (!searchRegex.test(hay)) return false;
      }
      return true;
    });
  }, [runs, statusFilter, searchRegex]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const cmp = compareRuns(a, b, sort.column);
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sort]);

  if (!projectId) return null;
  if (q.isLoading) return <p className="text-fg-muted">Loading…</p>;
  if (q.isError)
    return <p className="text-status-failed">Error: {String(q.error)}</p>;

  const toggleSort = (column: SortColumn) => {
    setSort((prev) =>
      prev.column === column
        ? {
            column,
            direction: prev.direction === "asc" ? "desc" : "asc",
          }
        : { column, direction: column === "created_at" ? "desc" : "asc" },
    );
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(sorted.map((r) => r.id)));
  };
  const selectNone = () => setSelected(new Set());

  const allVisibleSelected =
    sorted.length > 0 && sorted.every((r) => selected.has(r.id));
  const someVisibleSelected = sorted.some((r) => selected.has(r.id));

  const onHeaderCheckbox = () => {
    if (allVisibleSelected) selectNone();
    else selectAllVisible();
  };

  const selectedCount = selected.size;

  const onCompare = async () => {
    // Create a comparison pre-populated with cards: one card per unique
    // metric across ALL selected runs (union, not intersection).
    const selectedIds = Array.from(selected);
    const now = new Date();
    const label = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
    const cmp = createComparison(projectId, `Comparison ${label}`);

    // Fetch sequences for each selected run.
    const seqResults = await Promise.all(
      selectedIds.map((rid) => api.sequences(rid)),
    );

    // Union metrics by (name, object_type) → one card per unique metric.
    const cardMap = new Map<
      string,
      {
        name: string;
        object_type: string;
        series: Array<{ runId: string; name: string; context_hash: string }>;
      }
    >();
    seqResults.forEach((result, idx) => {
      const runId = selectedIds[idx]!;
      for (const seq of result.sequences) {
        const key = `${seq.name}::${seq.object_type}`;
        const existing = cardMap.get(key);
        if (existing) {
          // Only add one entry per run per metric (skip duplicate contexts).
          if (!existing.series.some((s) => s.runId === runId && s.name === seq.name)) {
            existing.series.push({
              runId,
              name: seq.name,
              context_hash: seq.context_hash,
            });
          }
        } else {
          cardMap.set(key, {
            name: seq.name,
            object_type: seq.object_type,
            series: [
              { runId, name: seq.name, context_hash: seq.context_hash },
            ],
          });
        }
      }
    });

    // Add each card to the comparison.
    for (const card of cardMap.values()) {
      addCardToComparison(projectId, cmp.id, {
        type: card.object_type as "scalar",
        series: card.series,
      });
    }

    navigate(`/p/${projectId}/compare?c=${encodeURIComponent(cmp.id)}`);
  };

  const onApplyTemplate = useCallback(async (template: ComparisonTemplate) => {
    if (!projectId) return;
    setTemplatePopoverOpen(false);
    const selectedIds = Array.from(selected);
    const cmp = createComparison(projectId, template.name);

    // Fetch sequences for selected runs.
    const seqResults = await Promise.all(
      selectedIds.map((rid) => api.sequences(rid)),
    );

    // Build a map of metric name → available sequences across runs.
    const seqMap = new Map<string, Array<{ runId: string; name: string; context_hash: string }>>();
    seqResults.forEach((result, idx) => {
      const runId = selectedIds[idx]!;
      for (const seq of result.sequences) {
        const existing = seqMap.get(seq.name);
        if (existing) {
          if (!existing.some((s) => s.runId === runId)) {
            existing.push({ runId, name: seq.name, context_hash: seq.context_hash });
          }
        } else {
          seqMap.set(seq.name, [{ runId, name: seq.name, context_hash: seq.context_hash }]);
        }
      }
    });

    // For each template card, match against available sequences.
    for (const tc of template.cards) {
      const matching = seqMap.get(tc.metricName);
      if (!matching || matching.length === 0) continue;
      addCardToComparison(projectId, cmp.id, {
        type: tc.type,
        series: matching,
      });
      // Restore saved settings from template.
      if (tc.settings) {
        // Re-read the comparison to get the card's new ID.
        const { loadComparisons } = await import("../lib/comparisons");
        const updated = loadComparisons(projectId).find((c) => c.id === cmp.id);
        const newCard = updated?.cards[updated.cards.length - 1];
        if (newCard) {
          saveCardSettings(
            { runId: `compare:${cmp.id}`, metricName: newCard.id, contextHash: "" },
            tc.settings,
          );
        }
      }
    }

    navigate(`/p/${projectId}/compare?c=${encodeURIComponent(cmp.id)}`);
  }, [projectId, selected, navigate]);

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="mono text-xl font-semibold">{projectId} / runs</h1>
        <p className="text-sm text-fg-muted">
          {sorted.length} of {runs.length} run(s)
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-fg-muted">
          Status
          <select
            className="input py-1 text-xs"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | RunStatus)
            }
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-fg-muted">
          Search
          <input
            className={`input py-1 text-xs${searchError ? " border-status-failed" : ""}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="regex"
            title={searchError ?? "Search by name, id, status, or tags (regex)"}
          />
        </label>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={selectAllVisible}
            disabled={sorted.length === 0}
          >
            Select all
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={selectNone}
            disabled={selectedCount === 0}
          >
            Select none
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={() => {
              if (!projectId) return;
              const cmp = createComparison(projectId, "New comparison");
              navigate(`/p/${projectId}/compare?c=${cmp.id}`);
            }}
          >
            New comparison
          </button>
        </div>
      </div>

      <div
        className={`mb-3 flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm transition-opacity ${selectedCount > 0 ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        aria-hidden={selectedCount === 0}
      >
        <span className="text-fg">
          {selectedCount} run{selectedCount === 1 ? "" : "s"} selected
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={selectNone}
          >
            Clear
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={onCompare}
            disabled={selectedCount === 0}
          >
            Compare {selectedCount} run{selectedCount === 1 ? "" : "s"}
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={() => {
              if (!projectId) return;
              const cmp = createComparison(projectId, "New comparison", Array.from(selected));
              navigate(`/p/${projectId}/compare?c=${cmp.id}`);
            }}
            disabled={selectedCount === 0}
          >
            Empty comparison
          </button>
          {templates.length > 0 && (
            <button
              ref={templateBtnRef}
              type="button"
              className="btn px-2 py-1 text-xs"
              onClick={() => setTemplatePopoverOpen((v) => !v)}
              disabled={selectedCount === 0}
            >
              From template
            </button>
          )}
        </div>
      </div>
      <SettingsPopover
        open={templatePopoverOpen}
        onClose={() => setTemplatePopoverOpen(false)}
        anchorRef={templateBtnRef}
        title="Apply template"
      >
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onApplyTemplate(t)}
              className="text-left text-xs text-fg-muted hover:bg-bg-hover rounded px-2 py-1.5 border border-border-subtle"
            >
              <div className="truncate">{t.name}</div>
              <div className="text-[10px] text-fg-subtle">{t.cards.length} card(s)</div>
            </button>
          ))}
        </div>
      </SettingsPopover>

      {sorted.length === 0 ? (
        <p className="text-fg-muted">No runs match the filters.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {sorted.map((r) => {
              const tags = safeJsonParse<string[]>(r.tags) ?? [];
              const isSelected = selected.has(r.id);
              return (
                <li
                  key={r.id}
                  className={`rounded-lg border border-border bg-bg-elevated p-3 ${
                    isSelected ? "border-accent/50 bg-accent/5" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label={`select run ${r.display_name ?? r.id}`}
                        checked={isSelected}
                        onChange={() => toggleRow(r.id)}
                      />
                    </label>
                    <Link
                      to={`/p/${projectId}/r/${r.id}`}
                      className="mono min-h-[44px] flex-1 truncate text-accent hover:underline"
                    >
                      {r.display_name ?? r.id}
                    </Link>
                    <RunStatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                    <span>{(() => {
                      try {
                        const d = new Date(r.created_at);
                        return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
                      } catch { return formatRelative(r.created_at); }
                    })()}</span>
                    <span className="mono num">
                      dur: {formatDuration(r.created_at, r.ended_at)}
                    </span>
                  </div>
                  {tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {tags.map((t) => (
                        <span
                          key={t}
                          className="mono inline-flex items-center rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-fg-muted"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-hidden rounded-lg border border-border md:block">
            <table className="w-full text-sm">
            <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="select all visible rows"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          !allVisibleSelected && someVisibleSelected;
                    }}
                    onChange={onHeaderCheckbox}
                  />
                </th>
                <SortableTh
                  label="Name"
                  column="name"
                  sort={sort}
                  onClick={toggleSort}
                />
                <SortableTh
                  label="Status"
                  column="status"
                  sort={sort}
                  onClick={toggleSort}
                />
                <SortableTh
                  label="Created"
                  column="created_at"
                  sort={sort}
                  onClick={toggleSort}
                />
                <SortableTh
                  label="Duration"
                  column="duration"
                  sort={sort}
                  onClick={toggleSort}
                  numeric
                />
                <SortableTh
                  label="Tags"
                  column="tags"
                  sort={sort}
                  onClick={toggleSort}
                />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const tags = safeJsonParse<string[]>(r.tags) ?? [];
                const isSelected = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className={`border-t border-border-subtle hover:bg-bg-elevated ${
                      isSelected ? "bg-accent/5" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`select run ${r.display_name ?? r.id}`}
                        checked={isSelected}
                        onChange={() => toggleRow(r.id)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/p/${projectId}/r/${r.id}`}
                        className="mono text-accent hover:underline"
                      >
                        {r.display_name ?? r.id}
                      </Link>
                      {r.display_name ? (
                        <span className="mono ml-2 text-xs text-fg-subtle">
                          {r.id}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <RunStatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {(() => {
                        try {
                          const d = new Date(r.created_at);
                          return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
                        } catch { return formatRelative(r.created_at); }
                      })()}
                    </td>
                    <td className="mono num px-3 py-2 text-fg-muted">
                      {formatDuration(r.created_at, r.ended_at)}
                    </td>
                    <td className="px-3 py-2">
                      {tags.length === 0 ? (
                        <span className="text-xs text-fg-subtle">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {tags.map((t) => (
                            <span
                              key={t}
                              className="mono inline-flex items-center rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-fg-muted"
                            >
                              {t}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}

function SortableTh({
  label,
  column,
  sort,
  onClick,
  numeric = false,
}: {
  label: string;
  column: SortColumn;
  sort: SortState;
  onClick: (c: SortColumn) => void;
  numeric?: boolean;
}) {
  const active = sort.column === column;
  const arrow = active ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
  return (
    <th
      className={`cursor-pointer select-none px-3 py-2 hover:text-fg ${
        numeric ? "mono" : ""
      }`}
      onClick={() => onClick(column)}
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      {label}
      <span className="text-fg">{arrow}</span>
    </th>
  );
}

import { useCallback, useMemo, useRef, useState } from "react";
import { useInfiniteScroll } from "../lib/use-infinite-scroll";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useInfiniteRuns, useSetTags } from "../api/hooks";
import { qk } from "../api/query-keys";
import type { Run, RunStatus } from "../api/types";
import RunStatusBadge from "../components/RunStatusBadge";
import { formatDuration, formatRelative, safeJsonParse } from "../lib/format";
import { addCardsToComparison, createComparison, useTemplates, type ComparisonTemplate } from "../lib/comparisons";
import { saveCardSettings } from "../lib/card-settings";
import { api } from "../api/client";
import { setRunMetadata } from "../lib/run-label";
import SettingsPopover from "../components/SettingsPopover";
import BulkTagEditor from "../components/BulkTagEditor";
import ImportRunsDialog from "../components/ImportRunsDialog";
import CopyId from "../components/CopyId";
import TagInput from "../components/TagInput";
import { useWindowScrollRestore } from "../lib/use-scroll-restore";
import { useProjectTags } from "../lib/use-project-tags";

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
  { value: "archived", label: "archived" },
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
  const qc = useQueryClient();
  const q = useInfiniteRuns({ project: projectId });

  const [statusFilter, setStatusFilter] = useState<"all" | RunStatus>("all");
  const [search, setSearch] = useState<string>("");
  const [sort, setSort] = useState<SortState>({
    column: "created_at",
    direction: "desc",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);
  const templateBtnRef = useRef<HTMLButtonElement | null>(null);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const tagBtnRef = useRef<HTMLButtonElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [showLatestOnly, setShowLatestOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { templates } = useTemplates(projectId ?? "");
  const [addingTagFor, setAddingTagFor] = useState<string | null>(null);
  const [newTagValue, setNewTagValue] = useState("");

  const runs = useMemo(() => {
    const all = q.data?.pages.flatMap((p) => p.runs) ?? [];
    // Deduplicate: pages can overlap when new runs are inserted between fetches.
    const seen = new Set<string>();
    return all.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [q.data]);
  const serverTotal = q.data?.pages[0]?.total ?? 0;

  // Latest run per display_name — for highlighting and filtering.
  const { latestByName, latestIds } = useMemo(() => {
    const byName = new Map<string, { id: string; created_at: string }>();
    const counts = new Map<string, number>();
    for (const r of runs) {
      const name = r.display_name ?? r.id;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const existing = byName.get(name);
      if (!existing || r.created_at > existing.created_at) {
        byName.set(name, { id: r.id, created_at: r.created_at });
      }
    }
    const highlight = new Set<string>();
    const all = new Set<string>();
    for (const [name, best] of byName) {
      all.add(best.id);
      if ((counts.get(name) ?? 0) > 1) highlight.add(best.id);
    }
    return { latestByName: highlight, latestIds: all };
  }, [runs]);

  // Auto-load next page when sentinel enters viewport.
  const sentinelRef = useInfiniteScroll({
    hasNextPage: q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    fetchNextPage: q.fetchNextPage,
  });
  const allTags = useProjectTags(runs);

  const onStartAddTag = useCallback((runId: string) => {
    setAddingTagFor(runId);
    setNewTagValue("");
  }, []);

  const onCancelAddTag = useCallback(() => {
    setAddingTagFor(null);
    setNewTagValue("");
  }, []);

  const onBulkDelete = useCallback(async () => {
    if (!confirm(`Delete ${selected.size} run(s)? This cannot be undone.`)) return;
    await Promise.all([...selected].map((id) => api.deleteRun(id)));
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: qk.runsInfinite() });
  }, [selected, qc]);

  const onBulkArchive = useCallback(async () => {
    await Promise.all([...selected].map((id) => api.archiveRun(id)));
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: qk.runsInfinite() });
  }, [selected, qc]);

  const onBulkUnarchive = useCallback(async () => {
    await Promise.all([...selected].map((id) => api.unarchiveRun(id)));
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: qk.runsInfinite() });
  }, [selected, qc]);

  const onArchiveOldVersions = useCallback(async () => {
    const groups = new Map<string, Run[]>();
    for (const r of runs) {
      if (r.status === "archived") continue;
      const name = r.display_name ?? r.id;
      const arr = groups.get(name) ?? [];
      arr.push(r);
      groups.set(name, arr);
    }
    const toArchive: string[] = [];
    for (const [, group] of groups) {
      if (group.length <= 1) continue;
      group.sort((a, b) => b.created_at.localeCompare(a.created_at));
      for (let i = 1; i < group.length; i++) toArchive.push(group[i]!.id);
    }
    if (toArchive.length === 0) { alert("No old versions to archive."); return; }
    if (!confirm(`Archive ${toArchive.length} old run(s)?`)) return;
    await Promise.all(toArchive.map((id) => api.archiveRun(id)));
    qc.invalidateQueries({ queryKey: qk.runsInfinite() });
  }, [runs, qc]);

  const onDeleteOldVersions = useCallback(async () => {
    const groups = new Map<string, Run[]>();
    for (const r of runs) {
      if (r.status === "archived") continue;
      const name = r.display_name ?? r.id;
      const arr = groups.get(name) ?? [];
      arr.push(r);
      groups.set(name, arr);
    }
    const toDelete: string[] = [];
    for (const [, group] of groups) {
      if (group.length <= 1) continue;
      group.sort((a, b) => b.created_at.localeCompare(a.created_at));
      for (let i = 1; i < group.length; i++) toDelete.push(group[i]!.id);
    }
    if (toDelete.length === 0) { alert("No old versions to delete."); return; }
    if (!confirm(`Delete ${toDelete.length} old run(s)? This cannot be undone.`)) return;
    await Promise.all(toDelete.map((id) => api.deleteRun(id)));
    qc.invalidateQueries({ queryKey: qk.runsInfinite() });
  }, [runs, qc]);

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
      if (showLatestOnly && !latestIds.has(r.id)) return false;
      // Hide archived runs by default; only show when explicitly filtered.
      if (statusFilter === "all" && r.status === "archived") return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (searchRegex) {
        const tags = (safeJsonParse<string[]>(r.tags) ?? []).join(" ");
        const hay = `${r.display_name ?? ""} ${r.id} ${r.status} ${tags}`;
        if (!searchRegex.test(hay)) return false;
      }
      return true;
    });
  }, [runs, statusFilter, searchRegex, showLatestOnly, latestIds]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const cmp = compareRuns(a, b, sort.column);
      if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
      // Stable tiebreaker: run ID is unique and immutable.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return arr;
  }, [filtered, sort]);

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

  const lastSelectedId = useRef<string | null>(null);

  // Build a stable ID→index lookup, recomputed only when sorted changes.
  const sortedIdToIdx = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < sorted.length; i++) map.set(sorted[i]!.id, i);
    return map;
  }, [sorted]);

  const toggleRow = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey && lastSelectedId.current !== null) {
        const lastIdx = sortedIdToIdx.get(lastSelectedId.current);
        const curIdx = sortedIdToIdx.get(id);
        if (lastIdx != null && curIdx != null) {
          const lo = Math.min(lastIdx, curIdx);
          const hi = Math.max(lastIdx, curIdx);
          setSelected((prev) => {
            const next = new Set(prev);
            for (let i = lo; i <= hi; i++) next.add(sorted[i]!.id);
            return next;
          });
          lastSelectedId.current = id;
          return;
        }
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastSelectedId.current = id;
    },
    [sorted, sortedIdToIdx],
  );

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

  const onExport = useCallback(async () => {
    if (selected.size === 0) return;
    setExporting(true);
    try {
      const blob = await api.exportRuns(Array.from(selected));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cairn_export_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err}`);
    } finally {
      setExporting(false);
    }
  }, [selected]);

  const onCompare = async () => {
    // Create a comparison pre-populated with cards: one card per unique
    // metric across ALL selected runs (union, not intersection).
    const selectedIds = Array.from(selected);
    const now = new Date();
    const label = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
    const cmp = createComparison(projectId!, `Comparison ${label}`);

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

    // Add all cards in one batch (avoids race condition creating multiple
    // server-side comparisons). Skip system metrics.
    addCardsToComparison(
      projectId!,
      cmp.id,
      Array.from(cardMap.values())
        .filter((card) => !card.name.startsWith("system."))
        .map((card) => ({ type: card.object_type as "scalar", series: card.series })),
    );

    navigate(`/p/${projectId}/compare?c=${encodeURIComponent(cmp.id)}`);
  };

  const onApplyTemplate = useCallback(async (template: ComparisonTemplate) => {
    if (!projectId) return;
    setTemplatePopoverOpen(false);
    const selectedIds = Array.from(selected);
    const cmp = createComparison(projectId!, template.name);

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

    // Collect all matched template cards, then add in one batch.
    const matched = template.cards
      .filter((tc) => !tc.metricName.startsWith("system."))
      .map((tc) => ({ tc, series: seqMap.get(tc.metricName) }))
      .filter((m): m is { tc: typeof template.cards[number]; series: NonNullable<typeof m.series> } => !!m.series?.length);

    addCardsToComparison(
      projectId!,
      cmp.id,
      matched.map((m) => ({ type: m.tc.type, series: m.series })),
    );

    // Restore saved settings from template.
    const { loadComparisons } = await import("../lib/comparisons");
    const updated = loadComparisons(projectId).find((c) => c.id === cmp.id);
    if (updated) {
      const baseIdx = updated.cards.length - matched.length;
      matched.forEach((m, i) => {
        if (m.tc.settings) {
          const card = updated.cards[baseIdx + i];
          if (card) {
            saveCardSettings(
              { runId: `compare:${cmp.id}`, metricName: card.id, contextHash: "" },
              m.tc.settings,
            );
          }
        }
      });
    }

    navigate(`/p/${projectId}/compare?c=${encodeURIComponent(cmp.id)}`);
  }, [projectId, selected, navigate]);

  useWindowScrollRestore(
    `runs:${projectId ?? ""}`,
    !q.isLoading && !!q.data,
  );

  if (!projectId) return null;
  if (q.isLoading) return <p className="text-fg-muted">Loading…</p>;
  if (q.isError)
    return <p className="text-status-failed">Error: {String(q.error)}</p>;

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="mono text-xl font-semibold">{projectId} / runs</h1>
        <p className="text-sm text-fg-muted">
          {sorted.length} of {serverTotal} run{serverTotal === 1 ? "" : "s"}
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
        <label className="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer select-none">
          <input type="checkbox" checked={showLatestOnly} onChange={(e) => setShowLatestOnly(e.target.checked)} className="accent-accent" />
          Latest only
        </label>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn px-2 py-1 text-xs" onClick={onArchiveOldVersions}>Archive old</button>
          <button type="button" className="btn px-2 py-1 text-xs text-status-failed" onClick={onDeleteOldVersions}>Delete old</button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={() => {
              if (!projectId) return;
              const cmp = createComparison(projectId!, "New comparison");
              navigate(`/p/${projectId}/compare?c=${cmp.id}`);
            }}
          >
            New comparison
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={() => setImportOpen(true)}
          >
            Import
          </button>
        </div>
      </div>

      <div
        className={`sticky top-[41px] z-20 mb-3 flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 backdrop-blur-sm px-3 py-2 text-sm transition-opacity ${selectedCount > 0 ? "opacity-100" : "opacity-0 pointer-events-none"}`}
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
            ref={tagBtnRef}
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={() => setTagPopoverOpen((v) => !v)}
            disabled={selectedCount === 0}
          >
            Tag
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
              const cmp = createComparison(projectId!, "New comparison", Array.from(selected));
              navigate(`/p/${projectId}/compare?c=${cmp.id}`);
            }}
            disabled={selectedCount === 0}
          >
            Empty comparison
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={onExport}
            disabled={selectedCount === 0 || exporting}
          >
            {exporting ? "Exporting..." : "Export"}
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={onBulkArchive}
            disabled={selectedCount === 0}
          >
            Archive
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={onBulkUnarchive}
            disabled={selectedCount === 0}
          >
            Unarchive
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs text-status-failed"
            onClick={onBulkDelete}
            disabled={selectedCount === 0}
          >
            Delete
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
      <BulkTagEditor
        open={tagPopoverOpen}
        onClose={() => setTagPopoverOpen(false)}
        anchorRef={tagBtnRef}
        selectedRunIds={selected}
        runs={runs}
      />

      {sorted.length === 0 ? (
        <p className="text-fg-muted">No runs match the filters.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {sorted.map((r) => {
              const isSelected = selected.has(r.id);
              return (
                <li
                  key={r.id}
                  className={`rounded-lg border border-border bg-bg-elevated p-3 ${
                    isSelected ? "border-accent/50 bg-accent/5" : ""
                  } ${latestByName.has(r.id) ? "border-l-2 border-l-accent" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label={`select run ${r.display_name ?? r.id}`}
                        checked={isSelected}
                        onChange={(e) => toggleRow(r.id, (e.nativeEvent as MouseEvent).shiftKey ?? false)}
                      />
                    </div>
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
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <RunTagCell
                      run={r}
                      variant="mobile"
                      allTags={allTags}
                      addingTagFor={addingTagFor}
                      onStartAdd={onStartAddTag}
                      onCancelAdd={onCancelAddTag}
                      newTagValue={newTagValue}
                      setNewTagValue={setNewTagValue}
                    />
                  </div>
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
                const isSelected = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className={`border-t border-border-subtle hover:bg-bg-elevated ${
                      isSelected ? "bg-accent/5" : ""
                    } ${latestByName.has(r.id) ? "border-l-2 border-l-accent" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`select run ${r.display_name ?? r.id}`}
                        checked={isSelected}
                        onChange={(e) => toggleRow(r.id, (e.nativeEvent as MouseEvent).shiftKey ?? false)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/p/${projectId}/r/${r.id}`}
                        className="mono text-accent hover:underline"
                      >
                        {r.display_name ?? r.id}
                      </Link>
                      <CopyId id={r.id} className="ml-2 text-xs" />
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
                      <span className="flex flex-wrap items-center gap-1">
                        <RunTagCell
                          run={r}
                          variant="desktop"
                          allTags={allTags}
                          addingTagFor={addingTagFor}
                          onStartAdd={onStartAddTag}
                          onCancelAdd={onCancelAddTag}
                          newTagValue={newTagValue}
                          setNewTagValue={setNewTagValue}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}
      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-1" />
      {q.isFetchingNextPage && (
        <p className="py-4 text-center text-sm text-fg-muted">Loading more runs...</p>
      )}
      <ImportRunsDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

// Per-row tag editing. Each instance owns a `useSetTags` mutation scoped to
// its own run, so tag edits invalidate that run's detail cache in addition
// to the runs list/infinite queries (unlike the old inline-in-parent version,
// which only invalidated the infinite list).
function RunTagCell({
  run,
  variant,
  allTags,
  addingTagFor,
  onStartAdd,
  onCancelAdd,
  newTagValue,
  setNewTagValue,
}: {
  run: Run;
  variant: "mobile" | "desktop";
  allTags: string[];
  addingTagFor: string | null;
  onStartAdd: (runId: string) => void;
  onCancelAdd: () => void;
  newTagValue: string;
  setNewTagValue: (v: string) => void;
}) {
  const setTags = useSetTags(run.id);
  const tags = safeJsonParse<string[]>(run.tags) ?? [];

  const removeTag = (tag: string) => {
    setTags.mutate(tags.filter((t) => t !== tag));
  };

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    setTags.mutate([...tags, trimmed], { onSuccess: onCancelAdd });
  };

  const removeBtnClass =
    variant === "desktop"
      ? "text-fg-subtle hover:text-status-failed opacity-0 group-hover/tag:opacity-100 transition-opacity -mr-0.5"
      : "text-fg-subtle hover:text-status-failed -mr-0.5";

  const onRemoveClick = (e: React.MouseEvent, tag: string) => {
    if (variant === "desktop") e.stopPropagation();
    removeTag(tag);
  };
  const onAddClick = (e: React.MouseEvent) => {
    if (variant === "desktop") e.stopPropagation();
    onStartAdd(run.id);
  };

  return (
    <>
      {tags.map((t) => (
        <span
          key={t}
          className="group/tag mono inline-flex items-center gap-0.5 rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-fg-muted"
        >
          {t}
          <button
            type="button"
            className={removeBtnClass}
            onClick={(e) => onRemoveClick(e, t)}
            title={variant === "desktop" ? `Remove tag "${t}"` : undefined}
          >
            {"×"}
          </button>
        </span>
      ))}
      {addingTagFor === run.id ? (
        <TagInput
          className="w-20"
          value={newTagValue}
          onChange={setNewTagValue}
          onCommit={addTag}
          onCancel={onCancelAdd}
          suggestions={allTags}
          exclude={tags}
          autoFocus
          placeholder="tag..."
        />
      ) : (
        <button
          type="button"
          className="inline-flex items-center justify-center rounded border border-dashed border-border-subtle px-1 py-0.5 text-xs text-fg-subtle hover:text-fg hover:border-border"
          onClick={onAddClick}
          title="Add tag"
        >
          +
        </button>
      )}
    </>
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

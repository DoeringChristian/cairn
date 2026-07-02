/**
 * Parallel Coordinates card for hyperparameter comparison.
 *
 * Each column is a parameter key or scalar metric (final value).
 * Each polyline is a run. Lines are colored by the rightmost column's value.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import {
  ParallelCoords,
  type ParallelColumn,
  type ParallelRow,
} from "../lib/cairn-plot";
import { useCardSettings } from "../lib/card-settings";
import { downloadCsv, exportChartFromContainer, safeName } from "../lib/download";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import CardShell from "./CardShell";
import SettingsSection from "./settings/SettingsSection";
import RunSelectionPanel from "./RunSelectionPanel";
import { buildRunInfoMap, type BaseCardSettings } from "./card-kit";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface ParallelSettings extends BaseCardSettings {
  columns: ParallelColumn[];
}

const DEFAULT_SETTINGS: ParallelSettings = {
  version: 1,
  columns: [],
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string; contextHash: string };
  onRemove?: () => void;
}

export default function ParallelCoordsCard({
  runIds,
  settingsKey,
  onRemove,
}: Props) {
  useRunMetadataVersion();

  const [settings, updateSettings] = useCardSettings(
    settingsKey,
    DEFAULT_SETTINGS,
  );
  const [expanded, setExpanded] = useState(false);

  // Fetch run details (params) for all runs
  const runQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: qk.run(rid),
      queryFn: () => api.run(rid),
      staleTime: 30_000,
    })),
  });

  // Fetch final scalar values for metric columns
  const metricColumns = useMemo(
    () => settings.columns.filter((c) => c.source === "metric"),
    [settings.columns],
  );

  const metricQueries = useQueries({
    queries: runIds.flatMap((rid) =>
      metricColumns.map((col) => ({
        queryKey: qk.sequence(rid, col.key, ""),
        queryFn: () => api.sequence(rid, col.key, { maxPoints: 1000 }),
        staleTime: 30_000,
      })),
    ),
  });

  // Build data: per-run values for each column
  const { rowData, columnDomains } = useMemo(() => {
    const cols = settings.columns;
    if (cols.length === 0) return { rowData: [], columnDomains: [] as Array<{ min: number; max: number; isNumeric: boolean }> };

    const runParams = new Map<string, Map<string, string>>();
    runQueries.forEach((q, idx) => {
      const rid = runIds[idx];
      if (!rid || !q.data) return;
      const pmap = new Map<string, string>();
      for (const p of q.data.params ?? []) {
        pmap.set(p.key, p.value);
      }
      runParams.set(rid, pmap);
    });

    const runMetrics = new Map<string, Map<string, number>>();
    let mIdx = 0;
    for (const rid of runIds) {
      const mmap = runMetrics.get(rid) ?? new Map<string, number>();
      for (const col of metricColumns) {
        const q = metricQueries[mIdx];
        if (q?.data?.points?.length) {
          const pts = q.data.points;
          const last = pts[pts.length - 1];
          if (last?.scalar_value != null) {
            mmap.set(col.key, last.scalar_value);
          }
        }
        mIdx++;
      }
      runMetrics.set(rid, mmap);
    }

    const rows: ParallelRow[] = [];
    for (const rid of runIds) {
      const pmap = runParams.get(rid);
      const mmap = runMetrics.get(rid);
      const values: Array<number | null> = [];
      const raw: Array<string | null> = [];
      for (const col of cols) {
        if (col.source === "param") {
          const v = pmap?.get(col.key) ?? null;
          raw.push(v);
          if (v == null) { values.push(null); continue; }
          const n = Number(v);
          values.push(Number.isFinite(n) ? n : null);
        } else {
          const v = mmap?.get(col.key) ?? null;
          raw.push(v != null ? String(v) : null);
          values.push(v);
        }
      }
      rows.push({ id: rid, values, raw, label: shortRunLabel(rid, runIds) });
    }

    const domains = cols.map((_, ci) => {
      let min = Infinity;
      let max = -Infinity;
      let isNumeric = true;
      for (const row of rows) {
        const v = row.values[ci];
        if (v == null) { if (row.raw[ci] != null) isNumeric = false; continue; }
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (!Number.isFinite(min)) { min = 0; max = 1; }
      if (min === max) { min -= 0.5; max += 0.5; }
      return { min, max, isNumeric };
    });

    return { rowData: rows, columnDomains: domains };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.columns,
    runIds,
    runQueries.map((q) => q.dataUpdatedAt).join("|"),
    metricQueries.map((q) => q.dataUpdatedAt).join("|"),
  ]);

  // Available columns for the picker
  const availableParams = useMemo(() => {
    const keys = new Set<string>();
    for (const q of runQueries) {
      for (const p of q.data?.params ?? []) keys.add(p.key);
    }
    return Array.from(keys).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const seqQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: qk.sequences(rid),
      queryFn: () => api.sequences(rid),
      staleTime: 30_000,
    })),
  });

  const availableMetrics = useMemo(() => {
    const names = new Set<string>();
    for (const q of seqQueries) {
      for (const seq of q.data?.sequences ?? []) {
        if (seq.object_type === "scalar") names.add(seq.name);
      }
    }
    return Array.from(names).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seqQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const selectedKeys = useMemo(
    () => new Set(settings.columns.map((c) => `${c.source}:${c.key}`)),
    [settings.columns],
  );

  const addColumn = useCallback(
    (key: string, source: "param" | "metric") => {
      updateSettings({ columns: [...settings.columns, { key, source }] });
    },
    [settings.columns, updateSettings],
  );

  const removeColumn = useCallback(
    (idx: number) => {
      const next = settings.columns.filter((_, i) => i !== idx);
      updateSettings({ columns: next });
    },
    [settings.columns, updateSettings],
  );

  const moveColumn = useCallback(
    (from: number, to: number) => {
      const cols = [...settings.columns];
      const [item] = cols.splice(from, 1);
      cols.splice(to, 0, item!);
      updateSettings({ columns: cols });
    },
    [settings.columns, updateSettings],
  );

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const toggleColumnFlag = useCallback(
    (idx: number, flag: "log" | "invert") => {
      const cols = settings.columns.map((c, i) =>
        i === idx ? { ...c, [flag]: !c[flag] } : c,
      );
      updateSettings({ columns: cols });
    },
    [settings.columns, updateSettings],
  );

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();

  const runInfoMap = useMemo(
    () => buildRunInfoMap(runIds, runQueries),
    [runIds, runQueries],
  );

  // ---------------------------------------------------------------------------
  // Settings panel
  // ---------------------------------------------------------------------------
  const settingsPanel = (
    <>
      <SettingsSection title="Columns" first />
      <div className="flex flex-col gap-1 mb-2">
        {settings.columns.map((col, i) => (
          <div
            key={`${col.source}:${col.key}:${i}`}
            onDragOver={(e) => {
              if (dragIdx == null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropIdx !== i) setDropIdx(i);
            }}
            onDragLeave={() => { if (dropIdx === i) setDropIdx(null); }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdx != null && dragIdx !== i) moveColumn(dragIdx, i);
              setDragIdx(null);
              setDropIdx(null);
            }}
            className={`mono flex items-center justify-between gap-1 rounded border px-2 py-1 text-xs text-fg-muted${
              dragIdx === i ? " opacity-50 border-accent" : dropIdx === i ? " border-accent bg-accent/5" : " border-border-subtle bg-bg"
            }`}
          >
            <span className="flex items-center gap-1.5 truncate">
              <span
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                  const row = (e.target as HTMLElement).closest(".mono") as HTMLElement | null;
                  if (row) e.dataTransfer.setDragImage(row, 20, 14);
                  setDragIdx(i);
                  setDropIdx(null);
                }}
                onDragEnd={() => { setDragIdx(null); setDropIdx(null); }}
                className="cursor-grab active:cursor-grabbing select-none text-fg-subtle hover:text-fg"
                title="Drag to reorder"
              >
                <i className="fa-solid fa-grip-vertical" aria-hidden="true" />
              </span>
              <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${col.source === "param" ? "bg-accent/10 text-accent" : "bg-green-100 text-green-700"}`}>
                {col.source === "param" ? "P" : "M"}
              </span>
              {col.key}
              {i === settings.columns.length - 1 && (
                <span className="text-[9px] text-fg-subtle">(color)</span>
              )}
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => toggleColumnFlag(i, "log")}
                className={`rounded px-1 py-0.5 text-[9px] ${col.log ? "bg-accent/20 text-accent" : "text-fg-subtle hover:text-fg"}`}
                title="Toggle log scale"
              >
                log
              </button>
              <button
                type="button"
                onClick={() => toggleColumnFlag(i, "invert")}
                className={`rounded px-1 py-0.5 text-[9px] ${col.invert ? "bg-accent/20 text-accent" : "text-fg-subtle hover:text-fg"}`}
                title="Invert axis"
              >
                {"↕"}
              </button>
              <button type="button" onClick={() => removeColumn(i)} className="text-fg-subtle hover:text-fg" title="Remove">{"×"}</button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-fg-subtle mb-2">
        The rightmost column determines line color.
      </p>

      <SettingsSection title="Add Column" />
      <UnifiedColumnPicker
        params={availableParams}
        metrics={availableMetrics}
        selected={selectedKeys}
        onAdd={addColumn}
      />
    </>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const cardRef = useRef<HTMLDivElement>(null);

  const noColumns = settings.columns.length === 0;

  const plotProps = {
    columns: settings.columns,
    rows: rowData,
    columnDomains,
    selectedIds,
    onClick: (id: string) => toggle(id),
  };

  const selectionPanel = !hasSelectionProvider && (
    <RunSelectionPanel
      selectedRunIds={selectedArray}
      allRunIds={runIds}
      onClear={clear}
      runInfo={runInfoMap}
      label="Parallel coords selection"
    />
  );

  return (
    <CardShell
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title="Parallel Coordinates"
      subtitle={`${runIds.length} runs · ${settings.columns.length} columns`}
      defaultHeight={350}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const headers = ["run_id", ...settings.columns.map((c) => c.key)];
        const rows: (string | number)[][] = rowData.map((row) => {
          return [row.id, ...row.raw.map((v) => v ?? "")];
        });
        downloadCsv(headers, rows, safeName(settings.title ?? "parallel_coords") + ".csv");
      }}
      onScreenshot={() => { if (cardRef.current) exportChartFromContainer(cardRef.current, safeName(settings.title ?? "parallel_coords"), "svg"); }}
      selectionPanel={selectionPanel}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={
        <div className="flex flex-col h-[calc(100vh-12rem)]">
          {noColumns ? (
            <div className="flex items-center justify-center flex-1 text-sm text-fg-muted">
              Add columns in settings to build the parallel coordinates plot.
            </div>
          ) : (
            <ParallelCoords {...plotProps} className="flex-1 min-h-0" />
          )}
        </div>
      }
    >
      <>
        {noColumns ? (
          <div className="flex items-center justify-center flex-1 min-h-0 text-sm text-fg-muted">
            Add columns in settings to build the parallel coordinates plot.
          </div>
        ) : (
          <ParallelCoords {...plotProps} className="rounded bg-bg flex-1 min-h-0" />
        )}
      </>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// UnifiedColumnPicker — params and metrics in one filterable list
// ---------------------------------------------------------------------------

function UnifiedColumnPicker({
  params,
  metrics,
  selected,
  onAdd,
}: {
  params: string[];
  metrics: string[];
  selected: Set<string>;
  onAdd: (key: string, source: "param" | "metric") => void;
}) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();

  const items = useMemo(() => {
    const all: Array<{ key: string; source: "param" | "metric"; label: string }> = [];
    for (const k of params) all.push({ key: k, source: "param", label: k });
    for (const k of metrics) all.push({ key: k, source: "metric", label: k });
    return q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all;
  }, [params, metrics, q]);

  return (
    <div>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter params & metrics..."
        className="input w-full mb-1 text-xs"
      />
      <div className="max-h-40 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-2 py-1 text-[10px] text-fg-subtle">No items</div>
        ) : (
          items.map((item) => {
            const added = selected.has(`${item.source}:${item.key}`);
            return (
              <button
                key={`${item.source}:${item.key}`}
                type="button"
                onClick={() => onAdd(item.key, item.source)}
                className={`mono flex w-full items-center gap-1.5 truncate px-2 py-1 text-left text-xs hover:bg-bg-hover ${
                  added ? "text-fg-subtle" : "text-fg-muted hover:text-fg"
                }`}
              >
                <span className={`shrink-0 rounded px-1 py-0.5 text-[8px] leading-tight ${item.source === "param" ? "bg-accent/10 text-accent" : "bg-green-100 text-green-700"}`}>
                  {item.source === "param" ? "P" : "M"}
                </span>
                {item.label}
                {added && <span className="text-[9px] ml-auto">(added)</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

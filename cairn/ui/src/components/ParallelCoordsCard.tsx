/**
 * Parallel Coordinates card for hyperparameter comparison.
 *
 * Each column is a parameter key or scalar metric (final value).
 * Each polyline is a run. Lines are colored by the rightmost column's value.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Run } from "../api/types";
import { useCardSettings } from "../lib/card-settings";
import CardHeader from "./CardHeader";
import CardDetailModal from "./CardDetailModal";
import CardResizeHandle from "./CardResizeHandle";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface ParallelSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  height?: number;
  fullWidth?: boolean;
  /** Column definitions: each is either a param key or a scalar metric name. */
  columns: Array<{ key: string; source: "param" | "metric"; log?: boolean; invert?: boolean }>;
}

const DEFAULT_SETTINGS: ParallelSettings = {
  version: 1,
  columns: [],
};

// ---------------------------------------------------------------------------
// Color scale — viridis-like
// ---------------------------------------------------------------------------

function viridis(t: number): string {
  // Simple 3-stop: dark purple → teal → yellow
  t = Math.max(0, Math.min(1, t));
  const r = Math.round(68 + t * (253 - 68));
  const g = Math.round(1 + t * (231 - 1));
  const b = Math.round(84 + (t < 0.5 ? t * 2 * (158 - 84) : (158 + (t - 0.5) * 2 * (37 - 158))));
  return `rgb(${r},${g},${b})`;
}

function shortRunId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  /** All run IDs to show. */
  runIds: string[];
  /** Run display info (id → display_name, color). */
  runs?: Run[];
  /** Settings key override. */
  settingsKey: { runId: string; metricName: string; contextHash: string };
  /** Card index for unique keying. */
  onRemove?: () => void;
}

export default function ParallelCoordsCard({
  runIds,
  runs,
  settingsKey,
  onRemove,
}: Props) {
  const [settings, updateSettings] = useCardSettings(
    settingsKey,
    DEFAULT_SETTINGS,
  );
  const [expanded, setExpanded] = useState(false);

  // Fetch run details (params) for all runs
  const runQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: ["run", rid],
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
        queryKey: ["sequence", rid, col.key, ""],
        queryFn: () => api.sequence(rid, col.key, { maxPoints: 1000 }),
        staleTime: 30_000,
      })),
    ),
  });

  // Build data: per-run values for each column
  const { rowData, columnDomains } = useMemo(() => {
    const cols = settings.columns;
    if (cols.length === 0) return { rowData: [], columnDomains: [] as Array<{ min: number; max: number; isNumeric: boolean }> };

    // Per-run param maps
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

    // Per-run metric final values
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

    // Build rows
    type Row = { runId: string; values: Array<number | null>; raw: Array<string | null> };
    const rows: Row[] = [];
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
      rows.push({ runId: rid, values, raw });
    }

    // Compute domains per column
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

  // Fetch sequences list for metric column options
  const seqQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: ["sequences", rid],
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

  // Drag-to-reorder state
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const toggleColumnFlag = useCallback(
    (idx: number, flag: "log" | "invert") => {
      const cols = settings.columns.map((c, i) =>
        i === idx ? { ...c, [flag]: !c[flag] } : c,
      );
      updateSettings({ columns: cols });
    },
    [settings.columns, updateSettings],
  );

  // Hover state for tooltip
  const [hoveredRun, setHoveredRun] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // ---------------------------------------------------------------------------
  // SVG rendering
  // ---------------------------------------------------------------------------
  const renderPlot = (width: number, height: number) => {
    const cols = settings.columns;
    if (cols.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-fg-muted">
          Add columns in settings to build the parallel coordinates plot.
        </div>
      );
    }

    const pad = { top: 30, bottom: 20, left: 60, right: 60 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) return null;

    const colX = cols.map((_, i) => pad.left + (cols.length === 1 ? plotW / 2 : (i / (cols.length - 1)) * plotW));

    // Normalize value to [0,1] within column domain, applying log/invert
    const normalize = (ci: number, v: number | null): number | null => {
      if (v == null) return null;
      const col = cols[ci]!;
      const d = columnDomains[ci]!;
      let val = v;
      let min = d.min;
      let max = d.max;
      if (col.log) {
        // Shift to positive range before log if needed
        const offset = min > 0 ? 0 : 1 - min;
        val = Math.log10(val + offset);
        min = Math.log10(min + offset);
        max = Math.log10(max + offset);
      }
      let t = (max - min) === 0 ? 0.5 : (val - min) / (max - min);
      if (col.invert) t = 1 - t;
      return t;
    };

    // Color by rightmost column
    const colorColIdx = cols.length - 1;
    const colorDomain = columnDomains[colorColIdx];

    return (
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="select-none"
        onMouseLeave={() => { setHoveredRun(null); setTooltipPos(null); }}
      >
        {/* Column axes */}
        {cols.map((col, ci) => {
          const x = colX[ci]!;
          const d = columnDomains[ci]!;
          return (
            <g key={ci}>
              <line x1={x} y1={pad.top} x2={x} y2={pad.top + plotH} stroke="#d0d7de" strokeWidth={1} />
              <text x={x} y={pad.top - 8} textAnchor="middle" className="text-[10px] fill-fg-muted" style={{ fontSize: 10 }}>
                {col.key}
              </text>
              <text x={x} y={pad.top + plotH + 14} textAnchor="middle" className="mono text-[9px] fill-fg-subtle" style={{ fontSize: 9 }}>
                {d.min.toPrecision(3)}
              </text>
              <text x={x} y={pad.top - 1} textAnchor="middle" className="mono text-[9px] fill-fg-subtle" style={{ fontSize: 9 }}>
                {d.max.toPrecision(3)}
              </text>
            </g>
          );
        })}

        {/* Polylines — dim non-hovered when hovering */}
        {rowData.map((row) => {
          const points: Array<{ x: number; y: number }> = [];
          for (let ci = 0; ci < cols.length; ci++) {
            const t = normalize(ci, row.values[ci]);
            if (t == null) continue;
            points.push({ x: colX[ci]!, y: pad.top + plotH - t * plotH });
          }
          if (points.length < 2) return null;

          const colorT = colorDomain ? normalize(colorColIdx, row.values[colorColIdx]) : null;
          const color = colorT != null ? viridis(colorT) : "#656d76";
          const isHovered = hoveredRun === row.runId;
          const isDimmed = hoveredRun != null && !isHovered;

          const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

          return (
            <g
              key={row.runId}
              className="cursor-pointer"
              onMouseEnter={(e) => {
                setHoveredRun(row.runId);
                const svg = svgRef.current;
                if (svg) {
                  const rect = svg.getBoundingClientRect();
                  setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }
              }}
              onMouseMove={(e) => {
                const svg = svgRef.current;
                if (svg) {
                  const rect = svg.getBoundingClientRect();
                  setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }
              }}
              onMouseLeave={() => { setHoveredRun(null); setTooltipPos(null); }}
            >
              {/* Wider invisible hit area */}
              <path d={d} fill="none" stroke="transparent" strokeWidth={8} />
              <path d={d} fill="none" stroke={color} strokeWidth={isHovered ? 3 : 1.5} strokeOpacity={isDimmed ? 0.15 : 0.8} />
              {points.map((p, pi) => (
                <circle key={pi} cx={p.x} cy={p.y} r={isHovered ? 4 : 3} fill={color} stroke="white" strokeWidth={1} opacity={isDimmed ? 0.2 : 1} />
              ))}
            </g>
          );
        })}

        {/* Color legend for rightmost column */}
        {colorDomain && (
          <g>
            <defs>
              <linearGradient id="pc-color-grad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={viridis(0)} />
                <stop offset="50%" stopColor={viridis(0.5)} />
                <stop offset="100%" stopColor={viridis(1)} />
              </linearGradient>
            </defs>
            <rect x={width - 18} y={pad.top} width={10} height={plotH} fill="url(#pc-color-grad)" rx={2} />
          </g>
        )}

        {/* Tooltip */}
        {hoveredRun && tooltipPos && (() => {
          const row = rowData.find((r) => r.runId === hoveredRun);
          if (!row) return null;
          const run = runs?.find((r) => r.id === hoveredRun);
          const label = run?.display_name ?? shortRunId(hoveredRun);
          return (
            <foreignObject x={tooltipPos.x + 12} y={tooltipPos.y - 10} width={200} height={200} style={{ overflow: "visible", pointerEvents: "none" }}>
              <div className="rounded border border-border bg-bg-elevated shadow-lg p-2 text-xs w-fit max-w-[200px]" style={{ pointerEvents: "none" }}>
                <div className="font-semibold mono mb-1 truncate">{label}</div>
                {cols.map((col, ci) => (
                  <div key={ci} className="flex justify-between gap-2">
                    <span className="text-fg-muted truncate">{col.key}</span>
                    <span className="mono shrink-0">{row.raw[ci] ?? "—"}</span>
                  </div>
                ))}
              </div>
            </foreignObject>
          );
        })()}
      </svg>
    );
  };

  // ---------------------------------------------------------------------------
  // Settings panel
  // ---------------------------------------------------------------------------
  const settingsPanel = (
    <>
      <h4 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        Columns
      </h4>
      <div className="flex flex-col gap-1 mb-2">
        {settings.columns.map((col, i) => (
          <div
            key={`${col.source}:${col.key}:${i}`}
            draggable
            onDragStart={(e) => {
              setDragIdx(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdx != null && dragIdx !== i) {
                moveColumn(dragIdx, i);
              }
              setDragIdx(null);
            }}
            onDragEnd={() => setDragIdx(null)}
            className={`mono flex items-center justify-between gap-1 rounded border border-border-subtle bg-bg px-2 py-1 text-xs text-fg-muted cursor-grab${dragIdx === i ? " opacity-50" : ""}`}
          >
            <span className="flex items-center gap-1.5 truncate">
              <span className="text-fg-subtle select-none">{"\u2261"}</span>
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
                {"\u2195"}
              </button>
              <button type="button" onClick={() => removeColumn(i)} className="text-fg-subtle hover:text-fg" title="Remove">{"\u00D7"}</button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-fg-subtle mb-2">
        The rightmost column determines line color.
      </p>

      <h4 className="text-xs uppercase tracking-wide text-fg-muted mt-3 mb-2">
        Add Column
      </h4>
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className="card p-4 flex flex-col"
      style={{
        height: settings.collapsed ? undefined : (settings.height ?? undefined),
        position: "relative",
        gridColumn: settings.fullWidth ? "1 / -1" : undefined,
      }}
    >
      <CardHeader
        title={settings.title ?? "Parallel Coordinates"}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={`${runIds.length} runs · ${settings.columns.length} columns`}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
      >
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Remove"
            title="Remove"
          >
            {"\u2212"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
          aria-label="Settings"
          title="Settings"
        >
          {"\u2699"}
        </button>
      </CardHeader>

      {!settings.collapsed && (
        <>
          <div
            ref={containerRef}
            className={`flex-1 min-h-0 rounded bg-bg${settings.height ? "" : " h-64"}`}
          >
            {size.w > 0 && size.h > 0 && renderPlot(size.w, size.h)}
          </div>

          <CardDetailModal
            open={expanded}
            onClose={() => setExpanded(false)}
            title={settings.title ?? "Parallel Coordinates"}
            settingsContent={settingsPanel}
          >
            <div className="h-[calc(100vh-12rem)]">
              {renderPlot(900, 500)}
            </div>
          </CardDetailModal>
        </>
      )}

      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        fullWidth={settings.fullWidth ?? false}
        onFullWidthToggle={() => updateSettings({ fullWidth: !settings.fullWidth })}
      />
    </div>
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

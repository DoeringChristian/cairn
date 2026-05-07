/**
 * Scatter Plot card — X/Y axes and color mapped to params or scalar metrics.
 * Each dot is a run, positioned by X and Y values, colored by a third axis.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Run } from "../api/types";
import { useCardSettings, resolveCardHeight, toggleColSpanPatch } from "../lib/card-settings";
import { exportChartFromContainer, safeName } from "../lib/download";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import CardHeader from "./CardHeader";
import CardDetailModal from "./CardDetailModal";
import CardResizeHandle from "./CardResizeHandle";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface AxisDef {
  key: string;
  source: "param" | "metric";
}

interface ScatterSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  height?: number;
  height1?: number;
  height2?: number;
  colSpan?: number;
  xAxis: AxisDef | null;
  yAxis: AxisDef | null;
  colorAxis: AxisDef | null;
}

const DEFAULT_SETTINGS: ScatterSettings = {
  version: 1,
  xAxis: null,
  yAxis: null,
  colorAxis: null,
};

function viridis(t: number): string {
  t = Math.max(0, Math.min(1, t));
  const r = Math.round(68 + t * (253 - 68));
  const g = Math.round(1 + t * (231 - 1));
  const b = Math.round(84 + (t < 0.5 ? t * 2 * (158 - 84) : (158 + (t - 0.5) * 2 * (37 - 158))));
  return `rgb(${r},${g},${b})`;
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  runIds: string[];
  runs?: Run[];
  settingsKey: { runId: string; metricName: string; contextHash: string };
  onRemove?: () => void;
}

export default function ScatterPlotCard({
  runIds,
  runs,
  settingsKey,
  onRemove,
}: Props) {
  useRunMetadataVersion();

  const [settings, updateSettings] = useCardSettings(settingsKey, DEFAULT_SETTINGS);
  const [expanded, setExpanded] = useState(false);

  // Fetch run details (params)
  const runQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: ["run", rid],
      queryFn: () => api.run(rid),
      staleTime: 30_000,
    })),
  });

  // Collect all axes that need metric fetches
  const metricAxes = useMemo(() => {
    const axes: AxisDef[] = [];
    const seen = new Set<string>();
    for (const a of [settings.xAxis, settings.yAxis, settings.colorAxis]) {
      if (a && a.source === "metric" && !seen.has(a.key)) {
        axes.push(a);
        seen.add(a.key);
      }
    }
    return axes;
  }, [settings.xAxis, settings.yAxis, settings.colorAxis]);

  const metricQueries = useQueries({
    queries: runIds.flatMap((rid) =>
      metricAxes.map((ax) => ({
        queryKey: ["sequence", rid, ax.key, ""],
        queryFn: () => api.sequence(rid, ax.key, { maxPoints: 1000 }),
        staleTime: 30_000,
      })),
    ),
  });

  // Build scatter data
  const { points: scatterPoints, xDomain, yDomain, colorDomain } = useMemo(() => {
    const resolve = (rid: string, axis: AxisDef | null): number | null => {
      if (!axis) return null;
      if (axis.source === "param") {
        const rq = runQueries[runIds.indexOf(rid)];
        const params = rq?.data?.params ?? [];
        const p = params.find((pp) => pp.key === axis.key);
        if (!p) return null;
        const n = Number(p.value);
        return Number.isFinite(n) ? n : null;
      }
      // metric: find in metricQueries
      const axIdx = metricAxes.findIndex((a) => a.key === axis.key);
      if (axIdx < 0) return null;
      const qIdx = runIds.indexOf(rid) * metricAxes.length + axIdx;
      const mq = metricQueries[qIdx];
      const pts = mq?.data?.points;
      if (!pts?.length) return null;
      return pts[pts.length - 1]?.scalar_value ?? null;
    };

    type Pt = { runId: string; x: number; y: number; color: number | null };
    const pts: Pt[] = [];
    for (const rid of runIds) {
      const x = resolve(rid, settings.xAxis);
      const y = resolve(rid, settings.yAxis);
      if (x == null || y == null) continue;
      const c = resolve(rid, settings.colorAxis);
      pts.push({ runId: rid, x, y, color: c });
    }

    const xMin = pts.length ? Math.min(...pts.map((p) => p.x)) : 0;
    const xMax = pts.length ? Math.max(...pts.map((p) => p.x)) : 1;
    const yMin = pts.length ? Math.min(...pts.map((p) => p.y)) : 0;
    const yMax = pts.length ? Math.max(...pts.map((p) => p.y)) : 1;
    const cVals = pts.map((p) => p.color).filter((v): v is number => v != null);
    const cMin = cVals.length ? Math.min(...cVals) : 0;
    const cMax = cVals.length ? Math.max(...cVals) : 1;

    return {
      points: pts,
      xDomain: { min: xMin === xMax ? xMin - 0.5 : xMin, max: xMin === xMax ? xMax + 0.5 : xMax },
      yDomain: { min: yMin === yMax ? yMin - 0.5 : yMin, max: yMin === yMax ? yMax + 0.5 : yMax },
      colorDomain: { min: cMin === cMax ? cMin - 0.5 : cMin, max: cMin === cMax ? cMax + 0.5 : cMax },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.xAxis, settings.yAxis, settings.colorAxis,
    runIds,
    metricAxes,
    runQueries.map((q) => q.dataUpdatedAt).join("|"),
    metricQueries.map((q) => q.dataUpdatedAt).join("|"),
  ]);

  // Available options
  const availableParams = useMemo(() => {
    const keys = new Set<string>();
    for (const q of runQueries) for (const p of q.data?.params ?? []) keys.add(p.key);
    return Array.from(keys).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const seqQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: ["sequences", rid],
      queryFn: () => api.sequences(rid),
      staleTime: 30_000,
    })),
  });

  const availableMetrics = useMemo(() => {
    const names = new Set<string>();
    for (const q of seqQueries) for (const seq of q.data?.sequences ?? []) {
      if (seq.object_type === "scalar") names.add(seq.name);
    }
    return Array.from(names).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seqQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const [hoveredPt, setHoveredPt] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // ---------------------------------------------------------------------------
  // SVG rendering
  // ---------------------------------------------------------------------------
  const renderPlot = (width: number, height: number) => {
    if (!settings.xAxis || !settings.yAxis) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-fg-muted">
          Select X and Y axes in settings to create the scatter plot.
        </div>
      );
    }

    const pad = { top: 20, bottom: 40, left: 55, right: 30 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) return null;

    const toX = (v: number) => pad.left + ((v - xDomain.min) / (xDomain.max - xDomain.min)) * plotW;
    const toY = (v: number) => pad.top + plotH - ((v - yDomain.min) / (yDomain.max - yDomain.min)) * plotH;

    return (
      <svg ref={svgRef} width={width} height={height} className="select-none" onMouseLeave={() => { setHoveredPt(null); setTooltipPos(null); }}>
        {/* Grid */}
        <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="none" stroke="#d0d7de" />

        {/* Axis labels */}
        <text x={pad.left + plotW / 2} y={height - 4} textAnchor="middle" className="text-[10px] fill-fg-muted" style={{ fontSize: 10 }}>
          {settings.xAxis.key}
        </text>
        <text x={12} y={pad.top + plotH / 2} textAnchor="middle" className="text-[10px] fill-fg-muted" style={{ fontSize: 10 }} transform={`rotate(-90, 12, ${pad.top + plotH / 2})`}>
          {settings.yAxis.key}
        </text>

        {/* Axis ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const xv = xDomain.min + t * (xDomain.max - xDomain.min);
          const yv = yDomain.min + t * (yDomain.max - yDomain.min);
          return (
            <g key={t}>
              <text x={toX(xv)} y={pad.top + plotH + 14} textAnchor="middle" className="mono text-[8px] fill-fg-subtle" style={{ fontSize: 8 }}>{xv.toPrecision(3)}</text>
              <text x={pad.left - 4} y={toY(yv) + 3} textAnchor="end" className="mono text-[8px] fill-fg-subtle" style={{ fontSize: 8 }}>{yv.toPrecision(3)}</text>
            </g>
          );
        })}

        {/* Points */}
        {scatterPoints.map((pt) => {
          const cx = toX(pt.x);
          const cy = toY(pt.y);
          let color = "#0969da";
          if (settings.colorAxis && pt.color != null) {
            const t = (pt.color - colorDomain.min) / (colorDomain.max - colorDomain.min);
            color = viridis(t);
          }
          const isHovered = hoveredPt === pt.runId;
          return (
            <circle
              key={pt.runId}
              cx={cx}
              cy={cy}
              r={isHovered ? 7 : 5}
              fill={color}
              stroke={isHovered ? "#1f2328" : "white"}
              strokeWidth={isHovered ? 2 : 1.5}
              className="cursor-pointer"
              onMouseEnter={(e) => {
                setHoveredPt(pt.runId);
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
              onMouseLeave={() => { setHoveredPt(null); setTooltipPos(null); }}
            />
          );
        })}

        {/* Tooltip */}
        {hoveredPt && tooltipPos && (() => {
          const pt = scatterPoints.find((p) => p.runId === hoveredPt);
          if (!pt) return null;
          const run = runs?.find((r) => r.id === pt.runId);
          const label = run?.display_name ?? shortRunLabel(pt.runId);
          return (
            <foreignObject x={tooltipPos.x + 12} y={tooltipPos.y - 10} width={220} height={200} style={{ overflow: "visible", pointerEvents: "none" }}>
              <div className="rounded border border-border bg-bg-elevated shadow-lg p-2 text-xs w-fit max-w-[220px]" style={{ pointerEvents: "none" }}>
                <div className="font-semibold mono mb-1 truncate">{label}</div>
                <div className="flex justify-between gap-2"><span className="text-fg-muted">{settings.xAxis!.key}</span><span className="mono">{pt.x.toPrecision(4)}</span></div>
                <div className="flex justify-between gap-2"><span className="text-fg-muted">{settings.yAxis!.key}</span><span className="mono">{pt.y.toPrecision(4)}</span></div>
                {settings.colorAxis && <div className="flex justify-between gap-2"><span className="text-fg-muted">{settings.colorAxis.key}</span><span className="mono">{pt.color?.toPrecision(4) ?? "—"}</span></div>}
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
  const axisOptions = useMemo(() => {
    const opts: Array<{ key: string; source: "param" | "metric"; label: string }> = [];
    for (const k of availableParams) opts.push({ key: k, source: "param", label: `[P] ${k}` });
    for (const k of availableMetrics) opts.push({ key: k, source: "metric", label: `[M] ${k}` });
    return opts;
  }, [availableParams, availableMetrics]);

  const AxisSelect = ({ label, value, onChange }: { label: string; value: AxisDef | null; onChange: (v: AxisDef | null) => void }) => (
    <div className="mb-2">
      <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">{label}</label>
      <select
        value={value ? `${value.source}:${value.key}` : ""}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) { onChange(null); return; }
          const [source, ...rest] = v.split(":");
          onChange({ key: rest.join(":"), source: source as "param" | "metric" });
        }}
        className="input w-full text-xs"
      >
        <option value="">— none —</option>
        {axisOptions.map((o) => (
          <option key={`${o.source}:${o.key}`} value={`${o.source}:${o.key}`}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  const settingsPanel = (
    <>
      <AxisSelect label="X Axis" value={settings.xAxis} onChange={(v) => updateSettings({ xAxis: v })} />
      <AxisSelect label="Y Axis" value={settings.yAxis} onChange={(v) => updateSettings({ yAxis: v })} />
      <AxisSelect label="Color" value={settings.colorAxis} onChange={(v) => updateSettings({ colorAxis: v })} />
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
      for (const entry of entries) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={cardRef}
      className="card p-4 flex flex-col"
      style={{
        height: resolveCardHeight(settings, 350),
        position: "relative",
        gridColumn: (settings.colSpan ?? 1) > 1 ? `span ${settings.colSpan}` : undefined,
      }}
    >
      <CardHeader
        title={settings.title ?? "Scatter Plot"}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={`${scatterPoints.length} points`}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onSettings={() => setExpanded(true)}
        onToggleFullWidth={() => updateSettings(toggleColSpanPatch(settings, cardRef.current) as Partial<ScatterSettings>)}
        isFullWidth={(settings.colSpan ?? 1) > 1}
        onRemove={onRemove}
        onDownload={() => { if (cardRef.current) exportChartFromContainer(cardRef.current, safeName(settings.title ?? "scatter_plot"), "svg"); }}
      >
      </CardHeader>

      {!settings.collapsed && (
        <>
          <div ref={containerRef} className="rounded bg-bg flex-1 min-h-0">
            {size.w > 0 && size.h > 0 && renderPlot(size.w, size.h)}
          </div>

          <CardDetailModal
            open={expanded}
            onClose={() => setExpanded(false)}
            title={settings.title ?? "Scatter Plot"}
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
        colSpan={settings.colSpan ?? 1}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p as Partial<ScatterSettings>)}
      />
    </div>
  );
}

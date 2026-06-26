import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import type { Run } from "../api/types";
import { useCardSettings, resolveCardHeight } from "../lib/card-settings";
import { SERIES_COLORS, viridis } from "../lib/colors";
import { downloadCsv, exportChartFromContainer, safeName } from "../lib/download";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { useRunSelection } from "../lib/use-run-selection";
import CardHeader from "./CardHeader";
import CardDetailModal from "./CardDetailModal";
import CardResizeHandle from "./CardResizeHandle";
import RunSelectionPanel from "./RunSelectionPanel";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface AxisDef {
  key: string;
  source: "param" | "metric";
}

type ParetoDirection = "min-min" | "min-max" | "max-min" | "max-max";

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
  xLog?: boolean;
  yLog?: boolean;
  showPareto?: boolean;
  paretoDirection?: ParetoDirection;
}

const DEFAULT_SETTINGS: ScatterSettings = {
  version: 1,
  xAxis: null,
  yAxis: null,
  colorAxis: null,
};

// ---------------------------------------------------------------------------
// Pareto front computation
// ---------------------------------------------------------------------------
type ScatterPt = { runId: string; x: number; y: number; color: number | null };

function computeParetoFront(points: ScatterPt[], direction: ParetoDirection): ScatterPt[] {
  if (points.length === 0) return [];
  const minX = direction.startsWith("min");
  const minY = direction.endsWith("min");

  const sorted = [...points].sort((a, b) => {
    const cmp = minX ? a.x - b.x : b.x - a.x;
    return cmp !== 0 ? cmp : (minY ? a.y - b.y : b.y - a.y);
  });

  const front: ScatterPt[] = [];
  let bestY = minY ? Infinity : -Infinity;
  for (const pt of sorted) {
    const dominated = minY ? pt.y > bestY : pt.y < bestY;
    if (!dominated) {
      front.push(pt);
      bestY = pt.y;
    }
  }
  return front;
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
      queryKey: qk.run(rid),
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
        queryKey: qk.sequence(rid, ax.key, ""),
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
      const axIdx = metricAxes.findIndex((a) => a.key === axis.key);
      if (axIdx < 0) return null;
      const qIdx = runIds.indexOf(rid) * metricAxes.length + axIdx;
      const mq = metricQueries[qIdx];
      const pts = mq?.data?.points;
      if (!pts?.length) return null;
      return pts[pts.length - 1]?.scalar_value ?? null;
    };

    const pts: ScatterPt[] = [];
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
      queryKey: qk.sequences(rid),
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
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; containerW?: number; containerH?: number } | null>(null);
  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const runInfoMap = useMemo(() => {
    const m = new Map<string, { displayName?: string; projectId?: string }>();
    runIds.forEach((rid, i) => {
      const d = runQueries[i]?.data;
      if (d) m.set(rid, { displayName: d.run.display_name || undefined, projectId: d.run.project_id });
    });
    return m;
  }, [runIds, runQueries]);

  // Pareto front
  const paretoFront = useMemo(() => {
    if (!settings.showPareto) return [];
    return computeParetoFront(scatterPoints, settings.paretoDirection ?? "min-min");
  }, [scatterPoints, settings.showPareto, settings.paretoDirection]);

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

    const hasColorbar = !!settings.colorAxis;
    const pad = { top: 20, bottom: 40, left: 55, right: hasColorbar ? 70 : 30 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) return null;

    const logX = (v: number) => Math.log10(Math.max(v, 1e-10));
    const logY = (v: number) => Math.log10(Math.max(v, 1e-10));

    const xMin = settings.xLog ? logX(xDomain.min) : xDomain.min;
    const xMax = settings.xLog ? logX(xDomain.max) : xDomain.max;
    const yMin = settings.yLog ? logY(yDomain.min) : yDomain.min;
    const yMax = settings.yLog ? logY(yDomain.max) : yDomain.max;

    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    const toX = (v: number) => {
      const mapped = settings.xLog ? logX(v) : v;
      return pad.left + ((mapped - xMin) / xRange) * plotW;
    };
    const toY = (v: number) => {
      const mapped = settings.yLog ? logY(v) : v;
      return pad.top + plotH - ((mapped - yMin) / yRange) * plotH;
    };

    // Build Pareto step-line path
    let paretoPath = "";
    if (settings.showPareto && paretoFront.length >= 2) {
      const dir = settings.paretoDirection ?? "min-min";
      const sorted = [...paretoFront].sort((a, b) => a.x - b.x);
      const parts: string[] = [`M${toX(sorted[0].x)},${toY(sorted[0].y)}`];
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (dir.endsWith("min")) {
          parts.push(`L${toX(curr.x)},${toY(prev.y)}`);
        } else {
          parts.push(`L${toX(prev.x)},${toY(curr.y)}`);
        }
        parts.push(`L${toX(curr.x)},${toY(curr.y)}`);
      }
      paretoPath = parts.join(" ");
    }

    const paretoSet = new Set(paretoFront.map((p) => p.runId));

    return (
      <svg ref={svgRef} width={width} height={height} className="select-none" onMouseLeave={() => { setHoveredPt(null); setTooltipPos(null); }}>
        {/* Grid */}
        <rect
          x={pad.left} y={pad.top} width={plotW} height={plotH}
          fill="transparent" stroke="#d0d7de"
          onClick={clear}
          className="cursor-default"
        />

        {/* Axis labels */}
        <text x={pad.left + plotW / 2} y={height - 4} textAnchor="middle" className="text-[10px] fill-fg-muted" style={{ fontSize: 10 }}>
          {settings.xAxis.key}
        </text>
        <text x={12} y={pad.top + plotH / 2} textAnchor="middle" className="text-[10px] fill-fg-muted" style={{ fontSize: 10 }} transform={`rotate(-90, 12, ${pad.top + plotH / 2})`}>
          {settings.yAxis.key}
        </text>

        {/* Axis ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const xTickLog = xMin + t * xRange;
          const yTickLog = yMin + t * yRange;
          const xLabel = settings.xLog ? Math.pow(10, xTickLog).toPrecision(3) : (xDomain.min + t * (xDomain.max - xDomain.min)).toPrecision(3);
          const yLabel = settings.yLog ? Math.pow(10, yTickLog).toPrecision(3) : (yDomain.min + t * (yDomain.max - yDomain.min)).toPrecision(3);
          const xPixel = pad.left + t * plotW;
          const yPixel = pad.top + plotH - t * plotH;
          return (
            <g key={t}>
              <text x={xPixel} y={pad.top + plotH + 14} textAnchor="middle" className="mono text-[8px] fill-fg-subtle" style={{ fontSize: 8 }}>{xLabel}</text>
              <text x={pad.left - 4} y={yPixel + 3} textAnchor="end" className="mono text-[8px] fill-fg-subtle" style={{ fontSize: 8 }}>{yLabel}</text>
            </g>
          );
        })}

        {/* Pareto front */}
        {paretoPath && (
          <path
            d={paretoPath}
            fill="none"
            stroke="var(--color-accent, #0969da)"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            opacity={0.7}
          />
        )}

        {/* Points */}
        {scatterPoints.map((pt, i) => {
          const cx = toX(pt.x);
          const cy = toY(pt.y);
          let color: string;
          if (settings.colorAxis && pt.color != null) {
            const t = (pt.color - colorDomain.min) / (colorDomain.max - colorDomain.min);
            color = viridis(t);
          } else {
            color = SERIES_COLORS[i % SERIES_COLORS.length];
          }
          const isHovered = hoveredPt === pt.runId;
          const isSelected = selectedIds.has(pt.runId);
          const isOnPareto = paretoSet.has(pt.runId);
          return (
            <circle
              key={pt.runId}
              cx={cx}
              cy={cy}
              r={isHovered ? 7 : isOnPareto && settings.showPareto ? 6 : 5}
              fill={color}
              stroke={isSelected ? "var(--color-accent, #0969da)" : isHovered ? "#1f2328" : "white"}
              strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.5}
              className="cursor-pointer"
              onClick={() => toggle(pt.runId)}
              onMouseEnter={(e) => {
                setHoveredPt(pt.runId);
                const container = (e.currentTarget as SVGElement).closest('[data-scatter-container]') as HTMLElement | null;
                if (container) {
                  const rect = container.getBoundingClientRect();
                  setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top, containerW: rect.width, containerH: rect.height });
                }
              }}
              onMouseMove={(e) => {
                const container = (e.currentTarget as SVGElement).closest('[data-scatter-container]') as HTMLElement | null;
                if (container) {
                  const rect = container.getBoundingClientRect();
                  setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top, containerW: rect.width, containerH: rect.height });
                }
              }}
              onMouseLeave={() => { setHoveredPt(null); setTooltipPos(null); }}
            />
          );
        })}

        {/* Colorbar */}
        {hasColorbar && (() => {
          const barX = width - pad.right + 10;
          const barW = 12;
          const gradId = "scatter-colorbar-grad";
          const cMid = (colorDomain.min + colorDomain.max) / 2;
          return (
            <>
              <defs>
                <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor={viridis(0)} />
                  <stop offset="50%" stopColor={viridis(0.5)} />
                  <stop offset="100%" stopColor={viridis(1)} />
                </linearGradient>
              </defs>
              <rect x={barX} y={pad.top} width={barW} height={plotH} fill={`url(#${gradId})`} stroke="#d0d7de" />
              <text x={barX + barW + 4} y={pad.top + plotH + 3} textAnchor="start" className="mono text-[8px] fill-fg-subtle" style={{ fontSize: 8 }}>{colorDomain.min.toPrecision(3)}</text>
              <text x={barX + barW + 4} y={pad.top + plotH / 2 + 3} textAnchor="start" className="mono text-[8px] fill-fg-subtle" style={{ fontSize: 8 }}>{cMid.toPrecision(3)}</text>
              <text x={barX + barW + 4} y={pad.top + 3} textAnchor="start" className="mono text-[8px] fill-fg-subtle" style={{ fontSize: 8 }}>{colorDomain.max.toPrecision(3)}</text>
              <text
                x={barX + barW + 18}
                y={pad.top + plotH / 2}
                textAnchor="middle"
                className="text-[9px] fill-fg-muted"
                style={{ fontSize: 9 }}
                transform={`rotate(90, ${barX + barW + 18}, ${pad.top + plotH / 2})`}
              >
                {settings.colorAxis!.key}
              </text>
            </>
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
        <option value="">-- none --</option>
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
      <div className="mt-2 flex flex-col gap-1">
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <input type="checkbox" checked={!!settings.xLog} onChange={(e) => updateSettings({ xLog: e.target.checked })} />
          X log scale
        </label>
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <input type="checkbox" checked={!!settings.yLog} onChange={(e) => updateSettings({ yLog: e.target.checked })} />
          Y log scale
        </label>
      </div>
      <div className="mt-3 border-t border-border-subtle pt-3">
        <Toggle
          label="Pareto front"
          checked={!!settings.showPareto}
          onChange={(v) => updateSettings({ showPareto: v })}
        />
        {settings.showPareto && (
          <Select<ParetoDirection>
            label="Direction"
            value={settings.paretoDirection ?? "min-min"}
            onChange={(v) => updateSettings({ paretoDirection: v })}
            options={[
              { value: "min-min", label: "Min X, Min Y" },
              { value: "min-max", label: "Min X, Max Y" },
              { value: "max-min", label: "Max X, Min Y" },
              { value: "max-max", label: "Max X, Max Y" },
            ]}
          />
        )}
      </div>
    </>
  );

  // ---------------------------------------------------------------------------
  // Render helpers
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

  const renderTooltip = () => {
    if (!hoveredPt || !tooltipPos) return null;
    const pt = scatterPoints.find((p) => p.runId === hoveredPt);
    if (!pt) return null;
    const label = shortRunLabel(pt.runId, runIds);
    const cW = tooltipPos.containerW ?? 0;
    const cH = tooltipPos.containerH ?? 0;
    const flipX = tooltipPos.x + 234 > cW;
    const flipY = tooltipPos.y > cH - 100;
    return (
      <div
        className="pointer-events-none absolute z-50 rounded border border-border bg-bg-elevated shadow-lg p-2 text-xs w-fit max-w-[220px]"
        style={{
          left: flipX ? Math.max(4, tooltipPos.x - 224) : tooltipPos.x + 14,
          top: flipY ? tooltipPos.y - 80 : tooltipPos.y - 8,
        }}
      >
        <div className="font-semibold mono mb-1 truncate">{label}</div>
        <div className="flex justify-between gap-2"><span className="text-fg-muted">{settings.xAxis!.key}</span><span className="mono">{pt.x.toPrecision(4)}</span></div>
        <div className="flex justify-between gap-2"><span className="text-fg-muted">{settings.yAxis!.key}</span><span className="mono">{pt.y.toPrecision(4)}</span></div>
        {settings.colorAxis && <div className="flex justify-between gap-2"><span className="text-fg-muted">{settings.colorAxis.key}</span><span className="mono">{pt.color?.toPrecision(4) ?? "--"}</span></div>}
      </div>
    );
  };

  return (
    <div
      ref={cardRef}
      className="card p-4 flex flex-col"
      style={{
        height: resolveCardHeight(settings, 350),
        position: "relative",
        gridColumn: `span ${settings.colSpan ?? 3}`,
      }}
    >
      <CardHeader
        title={settings.title ?? "Scatter Plot"}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={`${scatterPoints.length} points`}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onSettings={() => setExpanded(true)}
        onRemove={onRemove}
        onDownload={() => {
          const headers = ["run_id", settings.xAxis?.key ?? "x", settings.yAxis?.key ?? "y"];
          if (settings.colorAxis) headers.push(settings.colorAxis.key);
          const rows: (string | number)[][] = scatterPoints.map((pt) => {
            const row: (string | number)[] = [pt.runId, pt.x, pt.y];
            if (settings.colorAxis) row.push(pt.color ?? "");
            return row;
          });
          downloadCsv(headers, rows, safeName(settings.title ?? "scatter_plot") + ".csv");
        }}
        onScreenshot={() => { if (cardRef.current) exportChartFromContainer(cardRef.current, safeName(settings.title ?? "scatter_plot"), "svg"); }}
      >
      </CardHeader>

      {!settings.collapsed && (
        <>
          <div ref={containerRef} data-scatter-container className="relative rounded bg-bg flex-1 min-h-0">
            {size.w > 0 && size.h > 0 && renderPlot(size.w, size.h)}
            {renderTooltip()}
          </div>
          <RunSelectionPanel
            selectedRunIds={selectedArray}
            allRunIds={runIds}
            onClear={clear}
            runInfo={runInfoMap}
            renderExtra={(rid) => {
              const pt = scatterPoints.find(p => p.runId === rid);
              return pt ? (
                <>
                  <span className="ml-2 text-fg-subtle">{settings.xAxis?.key}: {pt.x.toPrecision(4)}</span>
                  <span className="ml-2 text-fg-subtle">{settings.yAxis?.key}: {pt.y.toPrecision(4)}</span>
                </>
              ) : null;
            }}
            label="Scatter selection"
          />

          <CardDetailModal
            open={expanded}
            onClose={() => setExpanded(false)}
            title={settings.title ?? "Scatter Plot"}
            settingsContent={settingsPanel}
          >
            <div data-scatter-container className="relative h-[calc(100vh-12rem)] flex flex-col">
              {renderPlot(900, 500)}
              {renderTooltip()}
              <RunSelectionPanel
                selectedRunIds={selectedArray}
                allRunIds={runIds}
                onClear={clear}
                runInfo={runInfoMap}
                renderExtra={(rid) => {
                  const pt = scatterPoints.find(p => p.runId === rid);
                  return pt ? (
                    <>
                      <span className="ml-2 text-fg-subtle">{settings.xAxis?.key}: {pt.x.toPrecision(4)}</span>
                      <span className="ml-2 text-fg-subtle">{settings.yAxis?.key}: {pt.y.toPrecision(4)}</span>
                    </>
                  ) : null;
                }}
                label="Scatter selection"
              />
            </div>
          </CardDetailModal>
        </>
      )}

      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 3}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p as Partial<ScatterSettings>)}
      />
    </div>
  );
}

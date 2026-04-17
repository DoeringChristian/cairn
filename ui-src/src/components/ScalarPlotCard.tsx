import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  CartesianGrid,
  Customized,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
  type ComparisonSeriesRef,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import type {
  SequenceMeta,
  SequencePoint,
  SequenceResponse,
} from "../api/types";
import SeriesChip, { CAIRN_SERIES_MIME, type SeriesRef } from "./SeriesChip";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SettingsPopover from "./SettingsPopover";
import MetricChips from "./settings/MetricChips";
import NumberInput from "./settings/NumberInput";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import { formatRelative } from "../lib/format";

// -----------------------------------------------------------------------------
// Settings shape
// -----------------------------------------------------------------------------

type AxisSource = "step" | "relative_time" | "wall_time";
type AxisScale = "linear" | "log";

interface PromotedSeriesConfig {
  min: number;
  max: number;
}

interface ScalarSettings {
  version: 1;
  title?: string;
  height?: number;
  /**
   * Series to render. `runId` is optional; when absent, the card's top-level
   * `runId` prop is used as the fallback. Cross-run overlays (comparisons)
   * set `runId` on each entry so different series can target different runs.
   */
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  xAxis: AxisSource;
  xScale: AxisScale;
  yScale: AxisScale;
  xRange: [number | null, number | null];
  yRange: [number | null, number | null];
  smoothing: number;
  outlierPct: [number, number];
  showLegend: boolean;
  tooltip: { showContext: boolean; showWallTime: boolean };
  promotedSeries: Record<string, PromotedSeriesConfig>;
  viewport: {
    xMin: number | null;
    xMax: number | null;
    yMin: number | null;
    yMax: number | null;
  };
}

const DEFAULT_SCALAR_SETTINGS = (seed: {
  name: string;
  context_hash: string;
}): ScalarSettings => ({
  version: 1,
  metrics: [seed],
  xAxis: "step",
  xScale: "linear",
  yScale: "linear",
  xRange: [null, null],
  yRange: [null, null],
  smoothing: 0,
  outlierPct: [0, 100],
  showLegend: true,
  tooltip: { showContext: true, showWallTime: true },
  promotedSeries: {},
  viewport: { xMin: null, xMax: null, yMin: null, yMax: null },
});

// -----------------------------------------------------------------------------
// Palette & helpers
// -----------------------------------------------------------------------------

const SERIES_COLORS = [
  "#539bf5",
  "#d29922",
  "#3fb950",
  "#f85149",
  "#c678dd",
  "#56d4dd",
];

function seriesKey(m: {
  runId?: string;
  name: string;
  context_hash: string;
}): string {
  return `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
}

function shortRunId(id: string): string {
  return id.length > 6 ? id.slice(0, 6) : id;
}

function seriesLabel(
  name: string,
  contextHash: string,
  runId: string | undefined,
  includeRun: boolean,
): string {
  const parts: string[] = [name];
  if (includeRun && runId) parts.push(shortRunId(runId));
  if (contextHash) parts.push(contextHash.slice(0, 6));
  return parts.join(" · ");
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (p <= 0) return sorted[0]!;
  if (p >= 100) return sorted[sorted.length - 1]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function defaultsEqual(a: ScalarSettings, b: ScalarSettings): boolean {
  // Intentionally compares the working settings object to the per-card defaults
  // to decide whether to show the "reset all" icon.
  return JSON.stringify(a) === JSON.stringify(b);
}

function viewportIsAuto(v: ScalarSettings["viewport"]): boolean {
  return (
    v.xMin === null && v.xMax === null && v.yMin === null && v.yMax === null
  );
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

interface Props {
  /** Fallback run for series entries that don't carry their own `runId`. */
  runId: string;
  /** Seed metric (within this card's default runId). */
  metric: SequenceMeta;
  /** Merge multiple series (e.g. all contexts of the same metric) onto one plot. */
  extraContexts?: SequenceMeta[];
  /** Cross-run series to overlay (used by comparison pages). */
  extraSeries?: ComparisonSeriesRef[];
  /** If provided, render a "−" remove button in the header. */
  onRemove?: () => void;
  /**
   * Override the storage key used for per-card settings. Used by the
   * comparison view so that a comparison's scalar card has settings
   * independent from the per-run workspace view of the same metric.
   */
  settingsKeyOverride?: CardSettingsKey;
}

// Chart margins; used both by Recharts and by our wheel/drag px→data math.
const CHART_MARGIN = { top: 4, right: 8, left: 0, bottom: 4 } as const;

export default function ScalarPlotCard({
  runId,
  metric,
  extraContexts = [],
  extraSeries = [],
  onRemove,
  settingsKeyOverride,
}: Props) {
  const seedMetric = useMemo(
    () => ({ name: metric.name, context_hash: metric.context_hash }),
    [metric.name, metric.context_hash],
  );

  const defaults = useMemo<ScalarSettings>(() => {
    const all: Array<{
      runId?: string;
      name: string;
      context_hash: string;
    }> = [
      seedMetric,
      ...(extraContexts ?? []).map((e) => ({
        name: e.name,
        context_hash: e.context_hash,
      })),
      ...(extraSeries ?? []).map((s) => ({
        runId: s.runId,
        name: s.name,
        context_hash: s.context_hash,
      })),
    ];
    const seen = new Set<string>();
    const unique = all.filter((m) => {
      const k = seriesKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { ...DEFAULT_SCALAR_SETTINGS(seedMetric), metrics: unique };
  }, [seedMetric, extraContexts, extraSeries]);

  const settingsKey = useMemo<CardSettingsKey>(
    () =>
      settingsKeyOverride ?? {
        runId,
        metricName: metric.name,
        contextHash: metric.context_hash,
      },
    [settingsKeyOverride, runId, metric.name, metric.context_hash],
  );

  const [settings, updateSettings, resetSettings] = useCardSettings(
    settingsKey,
    defaults,
  );

  // -------------------------------------------------------------------------
  // Run meta — needed for `relative_time` x-axis anchor.
  //
  // With multi-run overlays we need the creation time of every distinct run
  // that contributes a series, not just the card's default run.
  // -------------------------------------------------------------------------
  const uniqueRunIds = useMemo(() => {
    const set = new Set<string>([runId]);
    for (const m of settings.metrics) set.add(m.runId ?? runId);
    return Array.from(set);
  }, [runId, settings.metrics]);

  const runQueries = useQueries({
    queries: uniqueRunIds.map((rid) => ({
      queryKey: ["run", rid],
      queryFn: () => api.run(rid),
      staleTime: 5_000,
    })),
  });

  const runCreatedAtByRunId = useMemo(() => {
    const map = new Map<string, number>();
    uniqueRunIds.forEach((rid, i) => {
      const raw = runQueries[i]?.data?.run.created_at;
      if (!raw) return;
      const t = new Date(raw).getTime();
      if (Number.isFinite(t)) map.set(rid, t);
    });
    return map;
  }, [uniqueRunIds, runQueries]);

  // -------------------------------------------------------------------------
  // Data fetch — one query per (runId, metric) series, variable length.
  // -------------------------------------------------------------------------
  const queries = useQueries({
    queries: settings.metrics.map((m) => {
      const rid = m.runId ?? runId;
      return {
        queryKey: ["sequence", rid, m.name, m.context_hash],
        queryFn: () =>
          api.sequence(rid, m.name, {
            context: m.context_hash || undefined,
            maxPoints: 2000,
          }),
        refetchInterval: 2_000,
        staleTime: 2_000,
      };
    }),
  });

  // -------------------------------------------------------------------------
  // Build series + merged data, applying x-axis source, smoothing, outliers.
  // -------------------------------------------------------------------------
  type Series = {
    key: string;
    label: string;
    color: string;
    points: Array<{ x: number; y: number; wall_time: string; context: string | null }>;
  };

  const multipleRuns = useMemo(() => {
    const seen = new Set<string>();
    for (const m of settings.metrics) seen.add(m.runId ?? runId);
    return seen.size > 1;
  }, [settings.metrics, runId]);

  const { series, data, isLoading } = useMemo(() => {
    const anyLoading = queries.some((q) => q.isLoading);

    const built: Series[] = settings.metrics.map((m, idx) => {
      const key = seriesKey(m);
      const resp = queries[idx]?.data as SequenceResponse | undefined;
      const raw: SequencePoint[] = resp?.points ?? [];
      const rid = m.runId ?? runId;

      // Map to (x, y) based on the current x-axis source.
      const mapped: Array<{
        x: number;
        y: number;
        wall_time: string;
        context: string | null;
      }> = [];
      for (const p of raw) {
        if (p.scalar_value == null) continue;
        let x: number;
        if (settings.xAxis === "step") {
          x = p.step;
        } else if (settings.xAxis === "wall_time") {
          const t = new Date(p.wall_time).getTime();
          if (!Number.isFinite(t)) continue;
          x = t;
        } else {
          // relative_time — use this series' run creation time as anchor.
          const anchor = runCreatedAtByRunId.get(rid) ?? null;
          if (anchor == null) continue;
          const t = new Date(p.wall_time).getTime();
          if (!Number.isFinite(t)) continue;
          x = (t - anchor) / 1000;
        }
        mapped.push({
          x,
          y: p.scalar_value,
          wall_time: p.wall_time,
          context: p.context,
        });
      }
      mapped.sort((a, b) => a.x - b.x);

      // Smoothing (EMA) — lower alpha = less smoothing. Spec uses α as the
      // weight on the *previous* value, so: y[i] = α·prev + (1−α)·raw[i].
      if (settings.smoothing > 0 && mapped.length > 0) {
        const alpha = settings.smoothing;
        let prev = mapped[0]!.y;
        for (let i = 0; i < mapped.length; i++) {
          const cur = mapped[i]!.y;
          const sm = alpha * prev + (1 - alpha) * cur;
          mapped[i] = { ...mapped[i]!, y: sm };
          prev = sm;
        }
      }

      // Outlier clamp by percentile over this series' y values.
      let filtered = mapped;
      const [pLo, pHi] = settings.outlierPct;
      if ((pLo > 0 || pHi < 100) && mapped.length > 1) {
        const ys = mapped.map((p) => p.y).slice().sort((a, b) => a - b);
        const yLo = percentile(ys, pLo);
        const yHi = percentile(ys, pHi);
        filtered = mapped.filter((p) => p.y >= yLo && p.y <= yHi);
      }

      return {
        key,
        label: seriesLabel(m.name, m.context_hash, rid, multipleRuns),
        color: SERIES_COLORS[idx % SERIES_COLORS.length]!,
        points: filtered,
      };
    });

    // Merge into a single row-per-x dataset. Missing series at a given x → null
    // (Recharts' connectNulls keeps the line continuous).
    type Row = { x: number } & Record<string, number | null | string>;
    const byX = new Map<number, Row>();
    for (const s of built) {
      for (const p of s.points) {
        const row = byX.get(p.x) ?? ({ x: p.x } as Row);
        row[s.key] = p.y;
        // Stash raw metadata for the tooltip; overwrite with latest per series.
        row[`${s.key}__wall`] = p.wall_time;
        if (p.context != null) row[`${s.key}__ctx`] = p.context;
        byX.set(p.x, row);
      }
    }
    const rows = Array.from(byX.values()).sort((a, b) => a.x - b.x);

    return { series: built, data: rows, isLoading: anyLoading };
    // queries is new object every render; depend on stable bits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.metrics,
    settings.xAxis,
    settings.smoothing,
    settings.outlierPct[0],
    settings.outlierPct[1],
    multipleRuns,
    runId,
    runCreatedAtByRunId,
    // react-query data identity changes on refetch which is what we want:
    queries.map((q) => q.dataUpdatedAt).join("|"),
  ]);

  // -------------------------------------------------------------------------
  // Domain resolution — axis ranges + viewport take precedence over auto.
  // -------------------------------------------------------------------------
  type DomainTuple = [number | string, number | string];

  const resolveAxisDomain = (
    rangeLo: number | null,
    rangeHi: number | null,
    vpLo: number | null,
    vpHi: number | null,
    scale: AxisScale,
  ): DomainTuple => {
    // Viewport (from zoom/pan) wins over `xRange`/`yRange` hard limits which
    // win over auto. In log scale, auto becomes "auto" which lets d3 pick a
    // safe positive domain.
    const lo = vpLo ?? rangeLo;
    const hi = vpHi ?? rangeHi;
    const autoLo: number | string = scale === "log" ? "auto" : "dataMin";
    const autoHi: number | string = scale === "log" ? "auto" : "dataMax";
    return [lo ?? autoLo, hi ?? autoHi];
  };

  const xDomain = resolveAxisDomain(
    settings.xRange[0],
    settings.xRange[1],
    settings.viewport.xMin,
    settings.viewport.xMax,
    settings.xScale,
  );
  const yDomain = resolveAxisDomain(
    settings.yRange[0],
    settings.yRange[1],
    settings.viewport.yMin,
    settings.viewport.yMax,
    settings.yScale,
  );

  // For pan/zoom we need numeric domain endpoints. Fall back to data extents
  // when the axis is auto.
  const dataXs = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.x < lo) lo = p.x;
        if (p.x > hi) hi = p.x;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1] as const;
    if (lo === hi) return [lo - 0.5, hi + 0.5] as const;
    return [lo, hi] as const;
  }, [series]);

  const dataYs = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      // Exclude promoted series — they render on their own axis.
      if (settings.promotedSeries[s.key]) continue;
      for (const p of s.points) {
        if (p.y < lo) lo = p.y;
        if (p.y > hi) hi = p.y;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1] as const;
    if (lo === hi) return [lo - 0.5, hi + 0.5] as const;
    return [lo, hi] as const;
  }, [series, settings.promotedSeries]);

  const effectiveX: [number, number] = [
    typeof xDomain[0] === "number" ? xDomain[0] : dataXs[0],
    typeof xDomain[1] === "number" ? xDomain[1] : dataXs[1],
  ];
  const effectiveY: [number, number] = [
    typeof yDomain[0] === "number" ? yDomain[0] : dataYs[0],
    typeof yDomain[1] === "number" ? yDomain[1] : dataYs[1],
  ];

  // -------------------------------------------------------------------------
  // Promoted right-axis drag-to-pan.
  //
  // Approach: we inject transparent SVG `<rect>` strips via Recharts'
  // `<Customized>` component. Each promoted series gets one strip positioned
  // flush against the right edge of the plot area, offset horizontally by its
  // index so that strips don't stack (they'd steal each other's pointer
  // events). Strips receive pointerdown/move/up; we convert pixel deltas into
  // data-unit shifts and update `promotedSeries[key] = { min, max }`.
  //
  // Why overlay instead of DOM-sniffing the rendered axis <g>? Recharts does
  // not reliably tag axis groups with `data-yaxis-id`, and attaching to the
  // ticks region is brittle across versions. The overlay is layout-aware
  // (Customized receives the chart's `offset`) and survives re-renders.
  // -------------------------------------------------------------------------
  const promotedKeysOrdered = useMemo(
    () => series.map((s) => s.key).filter((k) => settings.promotedSeries[k]),
    [series, settings.promotedSeries],
  );

  type RightAxisDragMode = "pan" | "scale";

  const rightAxisDragRef = useRef<{
    key: string;
    pointerId: number;
    mode: RightAxisDragMode;
    startY: number;
    startMin: number;
    startMax: number;
    axisHeightPx: number;
    axisTopPx: number;
    /** For "scale": data value under the cursor at pointerdown (fixed point). */
    anchorData: number;
  } | null>(null);

  // We close over `updateSettings` and current `promotedSeries` lazily via a
  // ref so the SVG rect handlers always see fresh values.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const promotedAxisStripWidth = 14; // px clickable gutter per promoted axis

  const onAxisStripPointerDown = useCallback(
    (
      key: string,
      e: React.PointerEvent<SVGRectElement>,
      axisHeightPx: number,
      axisTopPx: number,
    ) => {
      const cfg = settingsRef.current.promotedSeries[key];
      if (!cfg) return;
      e.stopPropagation();
      // Prevent text selection during axis drag (tick labels etc.).
      e.preventDefault();
      // Capture the pointer on the CHART CONTAINER (not the <rect>) so that
      // pointermove/pointerup keep firing even after the cursor leaves the
      // tiny axis strip. The <rect> is inside Recharts' <Customized> and
      // gets recreated on every re-render, which would kill capture if it
      // were on the <rect>.
      chartBoxRef.current?.setPointerCapture(e.pointerId);
      // Convert cursor Y (viewport px) to data coordinate using the axis rect.
      // Recharts renders axes with y growing upward, so a cursor near axisTopPx
      // maps to `max`, and near (axisTopPx + axisHeightPx) maps to `min`.
      const rect = (e.currentTarget as SVGRectElement)
        .ownerSVGElement?.getBoundingClientRect();
      const svgTop = rect?.top ?? 0;
      const localY = e.clientY - svgTop; // y within the chart SVG
      const fracFromTop = Math.max(
        0,
        Math.min(1, (localY - axisTopPx) / Math.max(1, axisHeightPx)),
      );
      const anchorData = cfg.max - fracFromTop * (cfg.max - cfg.min);
      rightAxisDragRef.current = {
        key,
        pointerId: e.pointerId,
        mode: e.shiftKey ? "scale" : "pan",
        startY: e.clientY,
        startMin: cfg.min,
        startMax: cfg.max,
        axisHeightPx,
        axisTopPx,
        anchorData,
      };
    },
    [],
  );

  // Note: axis-strip pointermove/pointerup are handled by onChartPointerMove
  // and onChartPointerUp on the stable container div, not on the <rect> itself.
  // This ensures the drag survives Recharts re-renders that destroy/recreate
  // the SVG <rect> elements.

  // -------------------------------------------------------------------------
  // Plot-area wheel-zoom + drag-pan.
  //
  // We attach native (non-passive) listeners to the chart container <div> so
  // `e.preventDefault()` in wheel actually inhibits page scroll. Pointer
  // handlers are React synthetic — pan uses pointer capture on the container.
  // -------------------------------------------------------------------------
  const chartBoxRef = useRef<HTMLDivElement | null>(null);

  const effectiveRef = useRef({ x: effectiveX, y: effectiveY });
  effectiveRef.current = { x: effectiveX, y: effectiveY };

  // Wheel: alt+wheel zooms both X and Y around cursor's data coords. Plain
  // wheel (no alt) is passed through so the page scrolls normally.
  useEffect(() => {
    const el = chartBoxRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Only alt+wheel triggers zoom; otherwise let the page scroll.
      if (!e.altKey) return;
      const rect = el.getBoundingClientRect();
      const plotLeft = rect.left + CHART_MARGIN.left + 46; // YAxis width ≈ 46
      const plotRight =
        rect.right - CHART_MARGIN.right -
        promotedKeysOrdered.length * promotedAxisStripWidth;
      const plotTop = rect.top + CHART_MARGIN.top;
      const plotBottom = rect.bottom - CHART_MARGIN.bottom - 20; // XAxis height
      if (
        e.clientX < plotLeft ||
        e.clientX > plotRight ||
        e.clientY < plotTop ||
        e.clientY > plotBottom
      ) {
        return; // outside plot body — don't hijack scroll
      }
      e.preventDefault();

      const factor = e.deltaY < 0 ? 1 / 1.1 : 1.1; // wheel up → zoom in
      const { x, y } = effectiveRef.current;
      const fx = (e.clientX - plotLeft) / Math.max(1, plotRight - plotLeft);
      const fy = (plotBottom - e.clientY) / Math.max(1, plotBottom - plotTop);
      const ax = x[0] + fx * (x[1] - x[0]);
      const ay = y[0] + fy * (y[1] - y[0]);
      const newXMin = ax - (ax - x[0]) * factor;
      const newXMax = ax + (x[1] - ax) * factor;
      const newYMin = ay - (ay - y[0]) * factor;
      const newYMax = ay + (y[1] - ay) * factor;
      updateSettings({
        viewport: {
          xMin: newXMin,
          xMax: newXMax,
          yMin: newYMin,
          yMax: newYMax,
        },
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [updateSettings, promotedKeysOrdered.length]);

  // Plot-body gesture: either "pan" (Alt held at pointerdown) or "select"
  // (rubber-band zoom, no modifier). Mode is latched at pointerdown.
  type PlotDragMode = "pan" | "select";

  const plotDragRef = useRef<{
    pointerId: number;
    mode: PlotDragMode;
    startClientX: number;
    startClientY: number;
    /** Plot-rect in client (viewport) coords, cached at pointerdown. */
    plotLeft: number;
    plotTop: number;
    plotW: number;
    plotH: number;
    startXDomain: [number, number];
    startYDomain: [number, number];
  } | null>(null);

  // Rubber-band selection rect (local coords relative to chartBoxRef).
  const [selection, setSelection] = useState<
    { x0: number; y0: number; x1: number; y1: number } | null
  >(null);

  // Track alt-key state so we can flip the cursor between crosshair (select)
  // and move (pan). Listeners are on window so modifier changes reach us even
  // when focus is elsewhere.
  const [altDown, setAltDown] = useState(false);
  const [dropHighlight, setDropHighlight] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltDown(false);
    };
    const onBlur = () => setAltDown(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const onChartPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = chartBoxRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const plotLeft = rect.left + CHART_MARGIN.left + 46;
      const plotRight =
        rect.right - CHART_MARGIN.right -
        promotedKeysOrdered.length * promotedAxisStripWidth;
      const plotTop = rect.top + CHART_MARGIN.top;
      const plotBottom = rect.bottom - CHART_MARGIN.bottom - 20;
      if (
        e.clientX < plotLeft ||
        e.clientX > plotRight ||
        e.clientY < plotTop ||
        e.clientY > plotBottom
      ) {
        return; // keep right-axis drag reachable & don't steal legend clicks
      }
      // Only left mouse button (or primary touch/pen).
      if (e.button !== 0) return;
      // Prevent text selection while dragging (axis labels, legend text, etc.).
      e.preventDefault();
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      const mode: PlotDragMode = e.altKey ? "pan" : "select";
      plotDragRef.current = {
        pointerId: e.pointerId,
        mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        plotLeft,
        plotTop,
        plotW: Math.max(1, plotRight - plotLeft),
        plotH: Math.max(1, plotBottom - plotTop),
        startXDomain: effectiveRef.current.x,
        startYDomain: effectiveRef.current.y,
      };
      if (mode === "select") {
        // Local-rect coords (relative to chartBoxRef) for the overlay div.
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        setSelection({ x0: localX, y0: localY, x1: localX, y1: localY });
      }
    },
    [promotedKeysOrdered.length],
  );

  const onChartPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Handle axis-strip drags (right-side promoted axis pan/scale).
      // These are initiated by pointerdown on the SVG <rect> but tracked
      // here on the stable container div so the drag survives re-renders.
      const ax = rightAxisDragRef.current;
      if (ax && ax.pointerId === e.pointerId) {
        const dyPx = e.clientY - ax.startY;
        if (ax.mode === "pan") {
          const range = ax.startMax - ax.startMin;
          const dyData = (dyPx / Math.max(1, ax.axisHeightPx)) * range;
          updateSettings({
            promotedSeries: {
              ...settingsRef.current.promotedSeries,
              [ax.key]: { min: ax.startMin + dyData, max: ax.startMax + dyData },
            },
          });
        } else {
          const factor = Math.exp(dyPx / Math.max(1, ax.axisHeightPx));
          const newMin = ax.anchorData - (ax.anchorData - ax.startMin) * factor;
          const newMax = ax.anchorData + (ax.startMax - ax.anchorData) * factor;
          if (Number.isFinite(newMin) && Number.isFinite(newMax) && newMax > newMin) {
            updateSettings({
              promotedSeries: {
                ...settingsRef.current.promotedSeries,
                [ax.key]: { min: newMin, max: newMax },
              },
            });
          }
        }
        return;
      }

      // Handle plot-body drags (box-zoom or pan).
      const s = plotDragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      if (s.mode === "pan") {
        const dxPx = e.clientX - s.startClientX;
        const dyPx = e.clientY - s.startClientY;
        const [x0, x1] = s.startXDomain;
        const [y0, y1] = s.startYDomain;
        const dxData = (dxPx / s.plotW) * (x1 - x0);
        const dyData = (dyPx / s.plotH) * (y1 - y0);
        updateSettings({
          viewport: {
            xMin: x0 - dxData,
            xMax: x1 - dxData,
            // pixel y grows downward; axis y grows upward → add dyData to shift up
            yMin: y0 + dyData,
            yMax: y1 + dyData,
          },
        });
        return;
      }
      // select: update rubber-band rect.
      const el = chartBoxRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      setSelection((prev) =>
        prev === null ? prev : { ...prev, x1: localX, y1: localY },
      );
    },
    [updateSettings],
  );

  const onChartPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // End axis-strip drag if active.
      const ax = rightAxisDragRef.current;
      if (ax && ax.pointerId === e.pointerId) {
        rightAxisDragRef.current = null;
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        return;
      }

      // End plot-body drag.
      const s = plotDragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      // Finalize based on latched mode.
      if (s.mode === "select") {
        const wPx = Math.abs(e.clientX - s.startClientX);
        const hPx = Math.abs(e.clientY - s.startClientY);
        if (wPx >= 6 && hPx >= 6) {
          // Convert the two client-space corners to data coords using the same
          // linear map the wheel handler uses.
          const x0c = Math.min(s.startClientX, e.clientX);
          const x1c = Math.max(s.startClientX, e.clientX);
          const y0c = Math.min(s.startClientY, e.clientY);
          const y1c = Math.max(s.startClientY, e.clientY);
          const fxLo = (x0c - s.plotLeft) / s.plotW;
          const fxHi = (x1c - s.plotLeft) / s.plotW;
          // Pixel Y grows downward; plot bottom = low data, top = high data.
          const plotBottom = s.plotTop + s.plotH;
          const fyLo = (plotBottom - y1c) / s.plotH;
          const fyHi = (plotBottom - y0c) / s.plotH;
          const [xa, xb] = s.startXDomain;
          const [ya, yb] = s.startYDomain;
          const xMinNew = xa + fxLo * (xb - xa);
          const xMaxNew = xa + fxHi * (xb - xa);
          const yMinNew = ya + fyLo * (yb - ya);
          const yMaxNew = ya + fyHi * (yb - ya);
          if (
            Number.isFinite(xMinNew) &&
            Number.isFinite(xMaxNew) &&
            Number.isFinite(yMinNew) &&
            Number.isFinite(yMaxNew) &&
            xMaxNew > xMinNew &&
            yMaxNew > yMinNew
          ) {
            updateSettings({
              viewport: {
                xMin: xMinNew,
                xMax: xMaxNew,
                yMin: yMinNew,
                yMax: yMaxNew,
              },
            });
          }
        }
        setSelection(null);
      }
      plotDragRef.current = null;
    },
    [updateSettings],
  );

  // -------------------------------------------------------------------------
  // Viewport state flags.
  // -------------------------------------------------------------------------
  const viewportModified = !viewportIsAuto(settings.viewport);
  const anySettingModified = !defaultsEqual(settings, defaults);

  // -------------------------------------------------------------------------
  // Toggle promote / demote for a series.
  // -------------------------------------------------------------------------
  const togglePromote = useCallback(
    (key: string) => {
      const existing = settingsRef.current.promotedSeries[key];
      if (existing) {
        const next = { ...settingsRef.current.promotedSeries };
        delete next[key];
        updateSettings({ promotedSeries: next });
        return;
      }
      // Seed the promoted-axis domain with the series' current data range.
      const s = series.find((x) => x.key === key);
      if (!s || s.points.length === 0) {
        updateSettings({
          promotedSeries: {
            ...settingsRef.current.promotedSeries,
            [key]: { min: 0, max: 1 },
          },
        });
        return;
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of s.points) {
        if (p.y < lo) lo = p.y;
        if (p.y > hi) hi = p.y;
      }
      if (lo === hi) {
        lo -= 0.5;
        hi += 0.5;
      }
      updateSettings({
        promotedSeries: {
          ...settingsRef.current.promotedSeries,
          [key]: { min: lo, max: hi },
        },
      });
    },
    [series, updateSettings],
  );

  // -------------------------------------------------------------------------
  // Header quick-toggle buttons + settings anchor.
  // -------------------------------------------------------------------------
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // "Add to comparison" popover state.
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const projectId = useProjectId();
  const { comparisons, refresh: refreshComparisons } =
    useComparisons(projectId ?? "");
  const [addConfirmation, setAddConfirmation] = useState<string | null>(null);
  const addConfirmationTimer = useRef<number | null>(null);
  const [newCmpName, setNewCmpName] = useState("");

  const currentSeriesRefs = useCallback((): ComparisonSeriesRef[] => {
    return settingsRef.current.metrics.map((m) => ({
      runId: m.runId ?? runId,
      name: m.name,
      context_hash: m.context_hash,
    }));
  }, [runId]);

  const addToExistingComparison = useCallback(
    (comparisonId: string, label: string) => {
      if (!projectId) return;
      addCardToComparison(projectId, comparisonId, {
        type: "scalar",
        series: currentSeriesRefs(),
      });
      refreshComparisons();
      if (addConfirmationTimer.current != null) {
        window.clearTimeout(addConfirmationTimer.current);
      }
      setAddConfirmation(`Added to ${label}`);
      addConfirmationTimer.current = window.setTimeout(() => {
        setAddConfirmation(null);
        setAddOpen(false);
      }, 1500);
    },
    [projectId, currentSeriesRefs, refreshComparisons],
  );

  const createAndAdd = useCallback(() => {
    if (!projectId) return;
    const name = newCmpName.trim() || "New comparison";
    const cmp = createComparison(projectId, name);
    addCardToComparison(projectId, cmp.id, {
      type: "scalar",
      series: currentSeriesRefs(),
    });
    refreshComparisons();
    setNewCmpName("");
    if (addConfirmationTimer.current != null) {
      window.clearTimeout(addConfirmationTimer.current);
    }
    setAddConfirmation(`Added to ${name}`);
    addConfirmationTimer.current = window.setTimeout(() => {
      setAddConfirmation(null);
      setAddOpen(false);
    }, 1500);
  }, [projectId, newCmpName, currentSeriesRefs, refreshComparisons]);

  useEffect(() => {
    return () => {
      if (addConfirmationTimer.current != null) {
        window.clearTimeout(addConfirmationTimer.current);
      }
    };
  }, []);

  const flipYScale = () =>
    updateSettings({ yScale: settings.yScale === "log" ? "linear" : "log" });

  const resetViewport = () =>
    updateSettings({
      viewport: { xMin: null, xMax: null, yMin: null, yMax: null },
    });

  const subtitle = `${series.length} ${series.length === 1 ? "series" : "series"}${
    settings.metrics.length > 0 && queries[0]?.data
      ? ` · ${queries[0].data.points.length} pts`
      : ""
  }`;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div
      className={`card p-4${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{ minHeight: settings.height ?? undefined, position: "relative" }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(CAIRN_SERIES_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes(CAIRN_SERIES_MIME)) return;
        setDropHighlight(true);
      }}
      onDragLeave={(e) => {
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) return;
        setDropHighlight(false);
      }}
      onDrop={(e) => {
        setDropHighlight(false);
        const raw = e.dataTransfer.getData(CAIRN_SERIES_MIME);
        if (!raw) return;
        e.preventDefault();
        try {
          const dropped: SeriesRef = JSON.parse(raw);
          const existing = settingsRef.current.metrics;
          const key = `${dropped.runId ?? ""}::${dropped.name}::${dropped.context_hash}`;
          const alreadyHas = existing.some(
            (m) => `${m.runId ?? ""}::${m.name}::${m.context_hash}` === key,
          );
          if (!alreadyHas) {
            updateSettings({
              metrics: [
                ...existing,
                {
                  runId: dropped.runId,
                  name: dropped.name,
                  context_hash: dropped.context_hash,
                },
              ],
            });
          }
        } catch {
          /* malformed payload, ignore */
        }
      }}
    >
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
      >
        {settings.smoothing > 0 && (
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="h-5 inline-flex items-center justify-center rounded px-1.5 text-[10px] text-accent hover:bg-bg-hover"
            title="Smoothing active — click to open settings"
          >
            α={settings.smoothing.toFixed(2)}
          </button>
        )}
        <button
          type="button"
          onClick={flipYScale}
          className={`h-5 inline-flex items-center justify-center rounded px-1.5 text-[10px] hover:bg-bg-hover ${
            settings.yScale === "log"
              ? "text-accent"
              : "text-fg-muted hover:text-fg"
          }`}
          title={
            settings.yScale === "log" ? "Y: log (click for linear)" : "Y: linear (click for log)"
          }
        >
          {settings.yScale === "log" ? "lin" : "log"}
        </button>
        {viewportModified && (
          <button
            type="button"
            onClick={resetViewport}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Reset view"
            title="Reset view (zoom/pan)"
          >
            {"\u21BA"}
          </button>
        )}
        {anySettingModified && (
          <button
            type="button"
            onClick={() => resetSettings()}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Reset all settings"
            title="Reset all settings"
          >
            {"\u27F2"}
          </button>
        )}
        {projectId && (
          <button
            ref={addBtnRef}
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Add to comparison"
            aria-haspopup="dialog"
            aria-expanded={addOpen}
            title="Add to comparison"
          >
            {"\u002B"}
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Remove from comparison"
            title="Remove from comparison"
          >
            {"\u2212"}
          </button>
        )}
        <button
          ref={settingsBtnRef}
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
          aria-label="Plot settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          title="Plot settings"
        >
          {"\u2699"}
        </button>
      </CardHeader>

      {isLoading && data.length === 0 ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : (
        <div
          ref={chartBoxRef}
          className="h-48 relative"
          style={{
            touchAction: "none",
            cursor: altDown ? "move" : "crosshair",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
          aria-label="Scalar plot. Drag to box-zoom. Alt+drag to pan. Alt+wheel to zoom. Drag the right axis to pan; Shift+drag to rescale."
          onPointerDown={onChartPointerDown}
          onPointerMove={onChartPointerMove}
          onPointerUp={onChartPointerUp}
          onPointerCancel={onChartPointerUp}
          onLostPointerCapture={() => {
            plotDragRef.current = null;
            rightAxisDragRef.current = null;
            setSelection(null);
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={CHART_MARGIN}>
              <CartesianGrid stroke="#30363d" strokeDasharray="2 4" />
              <XAxis
                dataKey="x"
                type="number"
                scale={settings.xScale === "log" ? "log" : "linear"}
                domain={xDomain as [number | string, number | string]}
                allowDataOverflow
                stroke="#8b949e"
                fontSize={11}
                tickFormatter={(v: number) => formatXTick(v, settings.xAxis)}
              />
              <YAxis
                yAxisId="__left__"
                scale={settings.yScale === "log" ? "log" : "linear"}
                domain={yDomain as [number | string, number | string]}
                allowDataOverflow
                stroke="#8b949e"
                fontSize={11}
                width={46}
              />
              {promotedKeysOrdered.map((key, i) => {
                const s = series.find((x) => x.key === key);
                const color = s?.color ?? "#8b949e";
                const cfg = settings.promotedSeries[key]!;
                return (
                  <YAxis
                    key={key}
                    yAxisId={key}
                    orientation="right"
                    scale="linear"
                    domain={[cfg.min, cfg.max]}
                    allowDataOverflow
                    stroke={color}
                    tick={{ fill: color }}
                    fontSize={11}
                    width={40}
                    // Offset stacked right axes so they don't overlap.
                    // Recharts renders them in `xAxisId` order; our strips use
                    // the same order so clicks line up.
                    mirror={i > 0 ? true : false}
                  />
                );
              })}
              <Tooltip
                content={
                  <CustomTooltip
                    seriesByKey={Object.fromEntries(series.map((s) => [s.key, s]))}
                    xAxis={settings.xAxis}
                    showContext={settings.tooltip.showContext}
                    showWallTime={settings.tooltip.showWallTime}
                  />
                }
                contentStyle={{
                  background: "#13171c",
                  border: "1px solid #30363d",
                  fontSize: 12,
                }}
                labelStyle={{ color: "#8b949e" }}
              />
              {settings.showLegend && series.length > 0 && (
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  content={
                    <CustomLegend
                      series={series}
                      promoted={settings.promotedSeries}
                      onToggle={togglePromote}
                    />
                  }
                />
              )}
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  name={s.label}
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                  yAxisId={settings.promotedSeries[s.key] ? s.key : "__left__"}
                />
              ))}
              {/* Transparent overlay strips for drag-to-pan on promoted axes. */}
              <Customized
                component={
                  ((props: unknown) => {
                    const p = props as {
                      offset?: {
                        top?: number;
                        left?: number;
                        width?: number;
                        height?: number;
                        right?: number;
                      };
                    };
                    const o = p.offset;
                    if (!o || o.width == null || o.height == null) return null;
                    if (promotedKeysOrdered.length === 0) return null;
                    const top = o.top ?? 0;
                    const height = o.height;
                    // Right edge of plot area in Recharts' local SVG coords.
                    const plotRight = (o.left ?? 0) + o.width;
                    return (
                      <g>
                        {promotedKeysOrdered.map((key, i) => {
                          const s = series.find((x) => x.key === key);
                          const color = s?.color ?? "#8b949e";
                          const x = plotRight + i * promotedAxisStripWidth;
                          return (
                            <rect
                              key={key}
                              x={x}
                              y={top}
                              width={promotedAxisStripWidth}
                              height={height}
                              fill={color}
                              opacity={0.001}
                              style={{
                                cursor: "ns-resize",
                                touchAction: "none",
                              }}
                              onPointerDown={(e) =>
                                onAxisStripPointerDown(key, e, height, top)
                              }
                            />
                          );
                        })}
                      </g>
                    );
                  }) as unknown as React.FunctionComponent
                }
              />
            </LineChart>
          </ResponsiveContainer>
          {selection && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: Math.min(selection.x0, selection.x1),
                top: Math.min(selection.y0, selection.y1),
                width: Math.abs(selection.x1 - selection.x0),
                height: Math.abs(selection.y1 - selection.y0),
                border: "1px solid #539bf5",
                background: "rgba(83, 155, 245, 0.12)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      )}

      {/* Series chip strip — shows each plotted series as a draggable chip */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {series.map((s, idx) => {
          const ref: SeriesRef = {
            runId: settings.metrics[idx]?.runId,
            name: settings.metrics[idx]?.name ?? "",
            context_hash: settings.metrics[idx]?.context_hash ?? "",
          };
          return (
            <SeriesChip
              key={s.key}
              series={ref}
              color={s.color}
              label={s.label}
              runId={runId}
              onRemove={
                settings.metrics.length > 1
                  ? () => {
                      const next = settings.metrics.filter(
                        (_, i) => i !== idx,
                      );
                      updateSettings({ metrics: next });
                    }
                  : undefined
              }
            />
          );
        })}
      </div>

      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        anchorRef={settingsBtnRef}
        title="Scalar plot"
      >
        <h4 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Content
        </h4>
        {multipleRuns ? (
          <div className="flex flex-col gap-1 mb-2">
            {settings.metrics.map((m) => {
              const rid = m.runId ?? runId;
              const key = seriesKey(m);
              return (
                <div
                  key={key}
                  className="mono flex items-center justify-between gap-2 rounded border border-border-subtle bg-bg px-2 py-1 text-xs text-fg-muted"
                >
                  <span className="truncate">
                    {m.name}
                    {m.context_hash ? ` · ${m.context_hash.slice(0, 6)}` : ""}
                    {` · ${shortRunId(rid)}`}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    className="text-fg-subtle hover:text-fg"
                    onClick={() =>
                      updateSettings({
                        metrics: settings.metrics.filter(
                          (x) => seriesKey(x) !== key,
                        ),
                      })
                    }
                  >
                    {"\u00D7"}
                  </button>
                </div>
              );
            })}
            <p className="text-[10px] text-fg-subtle">
              Multi-run overlay — use the Runs list or the comparison page to
              add series from other runs.
            </p>
          </div>
        ) : (
          <MetricChips
            runId={runId}
            value={settings.metrics.map((m) => ({
              name: m.name,
              context_hash: m.context_hash,
            }))}
            onChange={(v) =>
              updateSettings({
                metrics: v.map((m) => ({
                  name: m.name,
                  context_hash: m.context_hash,
                })),
              })
            }
          />
        )}

        <h4 className="text-xs uppercase tracking-wide text-fg-muted mt-4 mb-2">
          Axes
        </h4>
        <Select
          label="X axis"
          value={settings.xAxis}
          onChange={(v) => updateSettings({ xAxis: v })}
          options={[
            { value: "step", label: "Step" },
            { value: "relative_time", label: "Relative time (s)" },
            { value: "wall_time", label: "Wall time" },
          ]}
        />
        <Select
          label="X scale"
          value={settings.xScale}
          onChange={(v) => updateSettings({ xScale: v })}
          options={[
            { value: "linear", label: "Linear" },
            { value: "log", label: "Log" },
          ]}
        />
        <Select
          label="Y scale"
          value={settings.yScale}
          onChange={(v) => updateSettings({ yScale: v })}
          options={[
            { value: "linear", label: "Linear" },
            { value: "log", label: "Log" },
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="X min"
            value={settings.viewport.xMin ?? settings.xRange[0]}
            onChange={(v) =>
              updateSettings({ xRange: [v, settings.xRange[1]] })
            }
          />
          <NumberInput
            label="X max"
            value={settings.viewport.xMax ?? settings.xRange[1]}
            onChange={(v) =>
              updateSettings({ xRange: [settings.xRange[0], v] })
            }
          />
          <NumberInput
            label="Y min"
            value={settings.viewport.yMin ?? settings.yRange[0]}
            onChange={(v) =>
              updateSettings({ yRange: [v, settings.yRange[1]] })
            }
          />
          <NumberInput
            label="Y max"
            value={settings.viewport.yMax ?? settings.yRange[1]}
            onChange={(v) =>
              updateSettings({ yRange: [settings.yRange[0], v] })
            }
          />
        </div>

        <h4 className="text-xs uppercase tracking-wide text-fg-muted mt-4 mb-2">
          Smoothing
        </h4>
        <Slider
          label="EMA α"
          value={settings.smoothing}
          onChange={(v) => updateSettings({ smoothing: v })}
          min={0}
          max={0.99}
          step={0.01}
          format={(v) => v.toFixed(2)}
          description="exponential moving average over each series"
        />

        <h4 className="text-xs uppercase tracking-wide text-fg-muted mt-4 mb-2">
          Outliers
        </h4>
        <Slider
          label="Low percentile"
          value={settings.outlierPct[0]}
          onChange={(v) =>
            updateSettings({ outlierPct: [v, settings.outlierPct[1]] })
          }
          min={0}
          max={100}
          step={0.5}
          format={(v) => `${v.toFixed(1)}%`}
        />
        <Slider
          label="High percentile"
          value={settings.outlierPct[1]}
          onChange={(v) =>
            updateSettings({ outlierPct: [settings.outlierPct[0], v] })
          }
          min={0}
          max={100}
          step={0.5}
          format={(v) => `${v.toFixed(1)}%`}
        />
        <p className="text-xs text-fg-subtle">Set [0, 100] to disable.</p>

        <h4 className="text-xs uppercase tracking-wide text-fg-muted mt-4 mb-2">
          Display
        </h4>
        <Toggle
          label="Show legend"
          checked={settings.showLegend}
          onChange={(v) => updateSettings({ showLegend: v })}
        />
        <Toggle
          label="Tooltip: context"
          checked={settings.tooltip.showContext}
          onChange={(v) =>
            updateSettings({
              tooltip: { ...settings.tooltip, showContext: v },
            })
          }
        />
        <Toggle
          label="Tooltip: wall time"
          checked={settings.tooltip.showWallTime}
          onChange={(v) =>
            updateSettings({
              tooltip: { ...settings.tooltip, showWallTime: v },
            })
          }
        />

        <button
          type="button"
          className="btn w-full mt-2"
          onClick={() => {
            resetSettings();
            setSettingsOpen(false);
          }}
        >
          Reset to defaults
        </button>
      </SettingsPopover>

      <SettingsPopover
        open={addOpen && projectId != null}
        onClose={() => {
          setAddOpen(false);
          setAddConfirmation(null);
        }}
        anchorRef={addBtnRef}
        title="Add to comparison"
      >
        {addConfirmation ? (
          <p className="text-xs text-accent">{addConfirmation}</p>
        ) : (
          <>
            {comparisons.length === 0 ? (
              <p className="text-xs text-fg-subtle mb-2">
                No comparisons yet.
              </p>
            ) : (
              <div className="flex flex-col gap-1 mb-2 max-h-48 overflow-y-auto">
                {comparisons.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addToExistingComparison(c.id, c.name)}
                    className="text-left text-xs text-fg-muted hover:bg-bg-hover rounded px-2 py-1.5 border border-border-subtle"
                  >
                    <div className="truncate">{c.name}</div>
                    <div className="text-[10px] text-fg-subtle">
                      {c.cards.length} card(s) · {formatRelative(c.createdAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-border-subtle pt-2 mt-1">
              <label className="text-[10px] uppercase tracking-wide text-fg-muted block mb-1">
                Create new comparison
              </label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newCmpName}
                  onChange={(e) => setNewCmpName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createAndAdd();
                    }
                  }}
                  placeholder="Name"
                  className="input flex-1 text-xs"
                />
                <button
                  type="button"
                  onClick={createAndAdd}
                  className="btn text-xs px-2"
                >
                  Create
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="btn w-full mt-2 text-xs"
            >
              Cancel
            </button>
          </>
        )}
      </SettingsPopover>
      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Custom legend: color swatch + label + ↕ promote toggle.
// -----------------------------------------------------------------------------

interface LegendSeries {
  key: string;
  label: string;
  color: string;
}

interface CustomLegendProps {
  series: LegendSeries[];
  promoted: Record<string, PromotedSeriesConfig>;
  onToggle: (key: string) => void;
}

function CustomLegend({ series, promoted, onToggle }: CustomLegendProps) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
      {series.map((s) => {
        const isPromoted = !!promoted[s.key];
        return (
          <li
            key={s.key}
            className="inline-flex items-center gap-1 text-[11px] text-fg-muted"
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 10,
                height: 2,
                background: s.color,
                marginRight: 2,
              }}
            />
            <span>{s.label}</span>
            <button
              type="button"
              onClick={() => onToggle(s.key)}
              className={`ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-xs hover:bg-bg-hover ${
                isPromoted ? "text-accent" : "text-fg-muted"
              }`}
              title={
                isPromoted ? "Demote (single Y axis)" : "Promote to own Y axis"
              }
            >
              {"\u2195"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// -----------------------------------------------------------------------------
// Custom tooltip.
// -----------------------------------------------------------------------------

interface TooltipPayloadEntry {
  dataKey?: string | number;
  name?: string | number;
  color?: string;
  value?: number | string | Array<number | string>;
  payload?: Record<string, unknown>;
}

interface CustomTooltipProps {
  active?: boolean;
  label?: number | string;
  payload?: TooltipPayloadEntry[];
  seriesByKey: Record<string, LegendSeries>;
  xAxis: AxisSource;
  showContext: boolean;
  showWallTime: boolean;
}

function CustomTooltip({
  active,
  label,
  payload,
  seriesByKey,
  xAxis,
  showContext,
  showWallTime,
}: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const style: CSSProperties = {
    background: "#13171c",
    border: "1px solid #30363d",
    padding: "6px 8px",
    fontSize: 12,
    color: "#e6edf3",
    minWidth: 140,
  };
  const labelNum = typeof label === "number" ? label : Number(label);
  return (
    <div style={style}>
      <div style={{ color: "#8b949e", marginBottom: 4 }}>
        {formatXTick(labelNum, xAxis)}
      </div>
      {payload.map((entry, i) => {
        const key = String(entry.dataKey ?? "");
        const meta = seriesByKey[key];
        const val = entry.value;
        const rawCtx =
          (entry.payload?.[`${key}__ctx`] as string | undefined) ?? null;
        const rawWall =
          (entry.payload?.[`${key}__wall`] as string | undefined) ?? null;
        return (
          <div key={`${key}-${i}`} style={{ lineHeight: 1.4 }}>
            <div style={{ color: meta?.color ?? entry.color ?? "#8b949e" }}>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {meta?.label ?? entry.name ?? key}
              </span>
              <span style={{ color: "#e6edf3", marginLeft: 8 }}>
                {typeof val === "number" ? formatNum(val) : String(val ?? "")}
              </span>
            </div>
            {showContext && rawCtx && (
              <div style={{ color: "#6e7681", fontSize: 11 }}>{rawCtx}</div>
            )}
            {showWallTime && rawWall && (
              <div style={{ color: "#6e7681", fontSize: 11 }}>{rawWall}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Formatting utilities.
// -----------------------------------------------------------------------------

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000 || abs < 1e-3) return n.toExponential(3);
  return Number(n.toPrecision(5)).toString();
}

function formatXTick(v: number, axis: AxisSource): string {
  if (!Number.isFinite(v)) return String(v);
  if (axis === "step") {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
  if (axis === "relative_time") {
    if (v < 60) return `${v.toFixed(1)}s`;
    if (v < 3600) return `${(v / 60).toFixed(1)}m`;
    return `${(v / 3600).toFixed(2)}h`;
  }
  // wall_time: epoch ms
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleTimeString();
}

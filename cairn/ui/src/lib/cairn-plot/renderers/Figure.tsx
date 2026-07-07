import { useCallback, useEffect, useMemo, useRef } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
// @ts-expect-error - plotly.js-dist-min has no bundled types, but is runtime-compatible with the factory.
import Plotly from "plotly.js-dist-min";
import type { PlotlyFigureLike } from "../types";

const Plot = createPlotlyComponent(Plotly);

// Bug B: react-plotly.js's <Plot> already wraps its internal Plotly.react
// call in a promise chain (see react-plotly.js/factory.js `updatePlotly`)
// and forwards any rejection to `onError` — but WITHOUT an `onError` prop it
// silently swallows the error instead of surfacing it. A degenerate axis
// (single point / all-equal values / log axis with non-positive data) or a
// relayout on a zero-size container can make Plotly's internal scale
// computation throw ("Something went wrong with axis scaling"); wiring
// `onError` on every <Plot> here turns that from a silent no-op (or, for a
// manual `Plotly.relayout` reset-view call, a genuinely uncaught promise
// rejection) into a handled, logged warning so a bad step never crashes the
// card.
function onPlotlyError(err: unknown) {
  console.warn("Figure: plotly render error (recovered)", err);
}

export type HoverMode = "closest" | "x unified" | "y unified" | "none";
export type DragMode = "zoom" | "pan" | "select" | "lasso" | "none";

export interface FigureInteractionSettings {
  displayModeBar: boolean;
  scrollZoom: boolean;
  hoverMode: HoverMode;
  dragMode: DragMode;
  showLegend: boolean;
}

// ---------------------------------------------------------------------------
// Shared view state synced across comparison panes.
// Captures axis ranges (2D) and camera (3D) from Plotly relayout events.
// ---------------------------------------------------------------------------

export type SharedView = Record<string, unknown>;

/** Extract axis ranges + scene camera from a Plotly relayout event object. */
export function extractViewState(relayoutData: Record<string, unknown>): SharedView | null {
  const view: SharedView = {};
  let any = false;
  for (const [k, v] of Object.entries(relayoutData)) {
    // 2D axis ranges: xaxis.range[0], yaxis.range[1], xaxis.autorange, etc.
    if (/^[xy]axis\d*\./.test(k)) {
      view[k] = v;
      any = true;
    }
    // 3D scene camera: both dot-path (scene.camera.eye.x) and nested object (scene)
    if (/^scene\d*\.camera/.test(k)) {
      view[k] = v;
      any = true;
    }
    // 3D scene as a nested object (Plotly sometimes sends {scene: {camera: {...}}})
    if (/^scene\d*$/.test(k) && v && typeof v === "object") {
      view[k] = v;
      any = true;
    }
    // Mapbox/geo: mapbox.center, mapbox.zoom, geo.projection, etc.
    if (/^(mapbox|geo)\d*\./.test(k)) {
      view[k] = v;
      any = true;
    }
  }
  return any ? view : null;
}

/** Deep merge b into a (returns new object). */
export function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const result = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) {
      result[k] = deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/** Merge shared view overrides into a Plotly layout object. */
export function applyViewOverrides(
  layout: Record<string, unknown>,
  overrides: SharedView,
): Record<string, unknown> {
  const result = { ...layout };
  for (const [k, v] of Object.entries(overrides)) {
    // If the value is an object and key has no dots (e.g. "scene" with nested camera),
    // deep-merge it into the layout.
    if (!k.includes(".") && !k.includes("[") && v && typeof v === "object" && !Array.isArray(v)) {
      result[k] = deepMerge((result[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
      continue;
    }
    // Plotly relayout keys are dot-separated paths like "xaxis.range[0]"
    const bracketMatch = k.match(/^(.+)\[(\d+)]$/);
    if (bracketMatch) {
      const [, path, idx] = bracketMatch;
      const parts = path!.split(".");
      let obj: Record<string, unknown> = result;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]!;
        if (i === parts.length - 1) {
          if (!Array.isArray(obj[p])) obj[p] = [];
          (obj[p] as unknown[])[Number(idx)] = v;
        } else {
          if (obj[p] == null || typeof obj[p] !== "object") obj[p] = {};
          obj = obj[p] as Record<string, unknown>;
        }
      }
    } else {
      const parts = k.split(".");
      let obj: Record<string, unknown> = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]!;
        if (obj[p] == null || typeof obj[p] !== "object") obj[p] = {};
        obj = obj[p] as Record<string, unknown>;
      }
      obj[parts[parts.length - 1]!] = v;
    }
  }
  return result;
}

const DARK_LAYOUT: Record<string, unknown> = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { color: "#1f2328" },
  autosize: true,
};

export interface FigureProps {
  figure: PlotlyFigureLike;
  settings: FigureInteractionSettings;
  viewOverrides?: SharedView;
  onRelayout?: (v: SharedView) => void;
  revision?: number;
  style?: React.CSSProperties;
  className?: string;
  /**
   * Attach a live `plotly_relayouting` DOM listener (fires continuously
   * during 3D camera drag) in addition to the end-of-interaction
   * `onRelayout` prop — used by comparison panes for real-time cross-pane
   * sync. Off by default (matches the pre-extraction behavior, where only
   * the multi-pane `FigurePane` had this listener).
   */
  enableLiveRelayout?: boolean;
}

/**
 * Pure Plotly figure renderer — data via props only. Owns all direct
 * react-plotly.js/Plotly usage (the single `<Plot>` call site consolidates
 * what were previously three duplicated call sites in
 * `FigureInteractiveCard.tsx`).
 */
export default function Figure({
  figure,
  settings,
  viewOverrides,
  onRelayout,
  revision,
  style,
  className,
  enableLiveRelayout,
}: FigureProps) {
  const baseLayout = useMemo(() => {
    const base = (figure.layout ?? {}) as Record<string, unknown>;
    const layout: Record<string, unknown> = {
      ...base,
      ...DARK_LAYOUT,
      font: { ...((base.font as object) ?? {}), ...(DARK_LAYOUT.font as object) },
      hovermode: settings.hoverMode === "none" ? false : settings.hoverMode,
      dragmode: settings.dragMode === "none" ? false : settings.dragMode,
      showlegend: settings.showLegend,
    };
    // Remove fixed dimensions so Plotly uses container size with autosize
    delete layout.width;
    delete layout.height;
    return layout;
  }, [figure.layout, settings.hoverMode, settings.dragMode, settings.showLegend]);

  // Apply shared view overrides (synced zoom/pan/camera from other panes).
  const mergedLayout = useMemo(
    () => (viewOverrides && Object.keys(viewOverrides).length > 0
      ? applyViewOverrides(baseLayout, viewOverrides)
      : baseLayout),
    [baseLayout, viewOverrides],
  );

  const handleRelayout = useCallback(
    (e: Readonly<Plotly.PlotRelayoutEvent>) => {
      if (!onRelayout) return;
      const view = extractViewState(e as unknown as Record<string, unknown>);
      if (view) onRelayout(view);
    },
    [onRelayout],
  );

  // Attach plotly_relayouting for real-time sync during 3D drag rotation
  // (comparison panes only — see `enableLiveRelayout` doc above).
  const plotContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enableLiveRelayout || !onRelayout) return;
    const el = plotContainerRef.current?.querySelector(".js-plotly-plot") as Plotly.PlotlyHTMLElement | null;
    if (!el?.on) return;
    const handler = (e: Plotly.PlotRelayoutEvent) => {
      const view = extractViewState(e as unknown as Record<string, unknown>);
      if (view) onRelayout(view);
    };
    el.on("plotly_relayouting", handler);
    return () => el.removeAllListeners?.("plotly_relayouting");
  });

  const plotlyConfig = useMemo(
    () => ({
      displayModeBar: settings.displayModeBar,
      scrollZoom: settings.scrollZoom,
      responsive: true,
    }),
    [settings.displayModeBar, settings.scrollZoom],
  );

  return (
    <div ref={plotContainerRef} className={className ?? "rounded bg-bg h-full"} style={style}>
      <Plot
        data={(figure.data ?? []) as Plotly.Data[]}
        layout={mergedLayout as Partial<Plotly.Layout>}
        config={plotlyConfig}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
        onRelayout={handleRelayout}
        revision={revision}
        onError={onPlotlyError}
      />
    </div>
  );
}

/**
 * Tiny standalone-render helpers shared by BOTH the core renderer wrappers
 * (`plot-renderers.tsx`) and the Plotly `figure` addon wrapper
 * (`plot-figure-renderer.tsx`).
 *
 * It is deliberately dependency-light (React + a `<style>` string only): the
 * figure addon imports `ChartBox` from here, and pulling in `plot-renderers`
 * would drag the 2D renderers (recharts et al.) into the addon IIFE, defeating
 * the "addon = Plotly + Figure ONLY" goal. Keep this module free of any
 * renderer imports.
 */
import React from "react";

export const DEFAULT_CHART_HEIGHT = 400;

/**
 * G1 cell-sizing seam. When a `GridNode` sets `rowHeights`, its cells are given
 * an explicit `height:100%` and the grid publishes `fill=true` through this
 * context; a `ChartBox` inside such a cell then fills the cell (`height:100%`)
 * instead of its standalone 400px default. Defined HERE (not in plot-node.tsx)
 * so `plot-standalone-helpers` stays renderer-import-free and ChartBox reads a
 * single flag with no extra dependency. Default `false` → behaviour-identical
 * to pre-G1 standalone pages.
 */
export const ChartFillContext = React.createContext<boolean>(false);

/**
 * Wrap a container-filling chart renderer in a default-height box so it has
 * something to measure on a bare standalone page. The pure chart renderers
 * size themselves to their parent (their root has no intrinsic height — in the
 * app a card supplies a fixed-height flex cell), so we force the direct child
 * to fill this box (renderer-agnostic; works whether or not a renderer forwards
 * `className`). Height is overridable via `props.height` (px); when the
 * enclosing grid cell is `fill`, the box fills the cell (`height:100%`).
 */
export function ChartBox({
  height,
  children,
}: {
  height?: number;
  children: React.ReactNode;
}) {
  const fill = React.useContext(ChartFillContext);
  return (
    <div
      className="cairn-plot-chartbox"
      style={{
        height: height ?? (fill ? "100%" : DEFAULT_CHART_HEIGHT),
        width: "100%",
      }}
    >
      <style>{".cairn-plot-chartbox > * { height: 100%; width: 100%; }"}</style>
      {children}
    </div>
  );
}

# cairn-plot Standard-2D → Plotly Modebar Parity — Design Plan

Base = `ff45ba3f`. Renderers: ScalarPlot (Recharts), Scatter, Bar, Histogram, Heatmap, ParallelCoords.
Directive (user): "for all standard plots, match Plotly's feature extent." Design first, then implement in supervised disjoint slices. Q11 (per-axis drag) + Q12 (snap-to-home) fold in.

## Parity matrix (definition of done)
Feature groups × renderers — ✅ done / ▶ implement / N/A:
1. Drag modes (box/pan/select/lasso): box ✅ all; pan ▶ first-class; select ▶; lasso ▶ (Scatter/Scalar/Heatmap; N/A 1-D Bar/Histogram). PC → §10 brushing.
2. Per-axis drag (Q11): ▶ all rectangular; N/A PC.
3. Modebar <PlotToolbar>: ▶ full (charts); ▶ reduced (PC: reset-brush/reorder/autorange/download).
4. Hover: tooltips ✅ partial; ▶ unified x/y crosshair + spikelines + closest-vs-compare.
5. Legend toggle/isolate: ▶ ScalarPlot + grouped Bar; N/A single-series/colorbar.
6. Reset/snap-to-home (Q12): dblclick ✅; ▶ snap + button.
7. Export PNG (client-side): ▶ all (Heatmap = canvas+SVG composite).
8. Selection emit (box/lasso → ids): ▶ Scatter primary (dimming ✅ exists), others optional.
9. Axis log/linear toggle / autorange / fixed-range: log ✅ exists; ▶ toggle buttons.
10. PC brushing + axis reorder: ▶ PC primary idiom.

## Architecture
- `controls/types.ts`: `PlotController` interface (dragMode/hoverMode/spikelines/isModified + setDragMode/setHoverMode/toggleSpikelines/zoomIn/zoomOut/autoscale/reset/toPNG + optional setAxisScale/selection) + `ControllerCapabilities` (superset of ChartCapabilities). Extends useChartViewport actions 1:1.
- Widen `ChartDragMode` → "box"|"pan"|"select"|"lasso" (toolbar "zoom"→"box" at adapter). State machine: persistent mode + transient modifier override (Alt-drag always pans). Wheel handler UNTOUCHED (Alt-gate preserved).
- `viewport/use-chart-selection.ts`: box/lasso hit-test over renderer-supplied points → onSelectionChange(ids); hook returns lassoPath.
- `primitives/Crosshair.tsx` + `hooks/use-plot-hover.ts`: spikelines + unified tooltip for SVG renderers. ScalarPlot converges via Recharts <Customized> horizontal spike (x-unified is native).
- `primitives/PlotLegend.tsx` + `hooks/use-series-visibility.ts`: click-toggle, dblclick-isolate.
- Q11 gutter hit-test in useChartViewport: xgutter/ygutter zones, outer 15% = end-zoom, center = pan, dblclick-axis = autorange that axis. ScalarPlot generalizes promoted-strip drag.
- Q12 snapToHome(domain,home,SNAP_FRAC) pure fn in chart-viewport-math.ts, wired in commit/endDrag.
- `primitives/PlotToolbar.tsx`: hover-reveal modebar, capability-gated groups (drag modes / zoom± / autoscale+reset / hover+spikelines / axis log-linear / download / PC clear-brush). Sole prop: controller. `controls/ToolbarConfig.ts`.
- `toPNG()`: download.ts — SVG renderers reuse exportChartFromContainer (refactor to return Blob); Heatmap NEW exportCanvasWithSvgOverlay (canvas + rasterized overlay svg).
- Controller adapters: use-chart-controller.ts (SVG), scalar/use-scalar-controller.ts, parallel/use-parallel-controller.ts.
- PC: renderers/parallel/use-pc-brush.ts — per-axis range brush (dim inactive rows, emit ids) + axis reorder (drag title, controlled columnOrder? + onColumnOrderChange, default internal).

## Sliced plan (disjoint, serialization-aware)
Hotspots that MUST serialize: (a) use-chart-viewport.ts + chart-viewport-math.ts; (b) PlotToolbar.tsx + controls/types.ts; (c) use-plot-gestures.ts (Scalar only).
- S0 Foundation (SERIAL FIRST): controller types + widen ChartDragMode + adapter skeleton, no behavior change. [hotspot a]
- S1 Toolbar + wire SVG charts (zoom/pan/zoom±/autoscale/reset). [creates hotspot b]
- S2 Per-axis drag Q11. [hotspot a]
- S3 Snap-to-home Q12. [hotspot a, after S2]
- S4 Shared hover/crosshair + spikelines/hover-mode.
- S5 Selection box/lasso + Scatter dim-emit. [hotspot a, after S2/S3]
- S6 Interactive legend (Scalar + Bar). [disjoint]
- S7 ScalarPlot reconciliation (first-class dragMode, real select/lasso, hover spike, toolbar, toPNG, gutter drag). [hotspot c; needs S1/S4/S6]
- S8 PC brushing + reorder. [PC file]
- S9 Axis log/linear toggle. [after S1]
- S10 toPNG unification + Heatmap composite. [download.ts]
- S11 Card convergence (CardHeader adopts controller) — later, not parity-blocking.
Waves: W1=S0. W2=S1+S6. W3=(S2→S3→S5 chained on hotspot a) ∥ S4 ∥ S8 ∥ S10. W4=S7,S9. W5=S11.
Serialization rule: only ONE in-flight branch touches hotspot a at a time; S1 owns PlotToolbar creation, S4/S9 append groups after S1.

## Risks
- Alt-wheel-gate: every slice leaves `if(!e.altKey)return` untouched; regression-check "plain scroll=page scroll, Alt+wheel=zoom" each slice.
- dragMode vs modifier: modifier always wins → pan (even in select/lasso base).
- Q11 gutter test must run BEFORE plot-rect early-return; don't steal ScalarPlot's right-side promoted strips (left/bottom bands only).
- ScalarPlot select currently = zoom (use-plot-gestures:286); S7 splits box(zoom) vs select(emit).
- Heatmap toPNG must composite canvas+overlay svg (same-origin, toDataURL safe).
- Bundle guard: new primitives pure React/SVG, core stays 0-plotly/0-three.

See task-notification transcript for full cited version (path:line grounding).

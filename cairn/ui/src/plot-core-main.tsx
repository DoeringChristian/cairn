/**
 * The OFFLINE **core** inline-bundle entry (O2 bundle-split) — compiled by
 * `vite.plot-core.config.ts` into the self-contained `dist/plot-inline/
 * core.iife.js` that EVERY Python-emitted plot carries. It contains the
 * bootstrap + the 2D/image/table renderers ONLY: NO Plotly, NO three.js.
 *
 * Two jobs beyond installing the bootstrap + seeding the core renderers:
 *
 *  1. Expose core's React runtime on `window` so a self-contained **addon**
 *     IIFE (the `figure` addon today; a three.js 3D addon in Phase D) can
 *     REUSE it instead of bundling a second React copy. This is not just a
 *     size win — it is REQUIRED for correctness: an addon renderer is mounted
 *     and reconciled by CORE's React (via `mountOne`'s `createRoot`), so if the
 *     addon's `useState`/`useEffect` came from a DIFFERENT React copy their
 *     dispatcher would be null at render time → "Invalid hook call". The addon
 *     builds mark `react` + `react/jsx-runtime` as external mapped to these
 *     globals (see `vite.plot-figure.config.ts`).
 *  2. Expose `window.__cairnPlotRegisterRenderer` (done inside
 *     `installCairnPlotBootstrap`) so addons register by name at runtime.
 *
 * The globals are set BEFORE any addon can run (Python emits the addon
 * `<script>` after this core `<script>`, and IIFE execution is synchronous).
 */
import React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import { installCairnPlotBootstrap } from "./plot-bootstrap";
import { registerCoreRenderers } from "./plot-renderers";
import "./lib/cairn-plot/styles/plot.css";

declare global {
  interface Window {
    /** Core's React module — addon IIFEs externalize `react` to this. */
    __cairnPlotReact?: typeof React;
    /** Core's `react/jsx-runtime` — addon IIFEs externalize the JSX runtime here. */
    __cairnPlotJsxRuntime?: typeof JsxRuntime;
  }
}

window.__cairnPlotReact = React;
window.__cairnPlotJsxRuntime = JsxRuntime;

installCairnPlotBootstrap();
registerCoreRenderers();

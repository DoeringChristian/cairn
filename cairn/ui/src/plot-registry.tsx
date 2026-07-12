/**
 * The cairn-plot **runtime renderer registry** (O2 bundle-split).
 *
 * Before O2 the standalone bundle used a single static `RENDERER_MAP` that
 * folded EVERY renderer — including the ~4.8M Plotly `Figure` — into one file.
 * O2 splits the offline bundle into a small **core** IIFE (bootstrap + the 2D
 * + image + table renderers, NO Plotly/three.js) that every plot carries, plus
 * optional **addon** IIFEs (the Plotly `figure` addon today; a three.js 3D
 * addon in Phase D) emitted ONLY when a page actually needs them.
 *
 * The seam between them is this registry. It is a plain module singleton:
 *
 *   - the **core** entry populates it with the always-present renderers and
 *     exposes `window.__cairnPlotRegisterRenderer` so addon IIFEs — which run
 *     AFTER core and cannot `import` from it (each is a self-contained IIFE) —
 *     can add their renderer at runtime by name;
 *   - an **addon** entry (e.g. `figure`) calls that window hook once (guarded
 *     by its own `window.__cairnPlot<Name>Loaded` flag) to register itself.
 *
 * GENERIC BY DESIGN: `registerRenderer(name, component)` is renderer-agnostic —
 * Phase D's 3D addon registers `pointcloud`/`mesh`/`volume`/`boxes` the SAME
 * way, no figure-special-casing here or in the bootstrap. Add an addon = build
 * one more self-contained IIFE that calls the window hook; nothing else changes.
 *
 * `onRegister` lets a mounted `PlotApp` that resolved a descriptor whose
 * renderer is not YET registered (addon `<script>` still parsing) subscribe and
 * re-render the instant the renderer arrives, instead of throwing "unknown
 * renderer" — the bootstrap uses this for the bounded wait-for-registration.
 */
import type { ComponentType } from "react";

const registry: Record<string, ComponentType<any>> = {};
const listeners = new Set<() => void>();

/** Register (or replace) the renderer for `name`, notifying any waiters. */
export function registerRenderer(name: string, component: ComponentType<any>): void {
  registry[name] = component;
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      /* a waiter's failure must never break registration */
    }
  }
}

/** The renderer for `name`, or `undefined` if no bundle has registered it. */
export function getRenderer(name: string): ComponentType<any> | undefined {
  return registry[name];
}

/**
 * Subscribe to registrations; returns an unsubscribe fn. Fires on EVERY
 * `registerRenderer`, so callers re-check `getRenderer(name)` for the specific
 * renderer they await.
 */
export function onRegister(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

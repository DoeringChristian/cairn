/**
 * The OFFLINE **three.js 3D addon** inline-bundle entry (O2 bundle-split, G3) —
 * compiled by `vite.plot-three.config.ts` into the self-contained
 * `dist/plot-inline/three.iife.js`. Python emits it (include-once, guarded by
 * `window.__cairnPlotThreeLoaded`) ONLY for a 3D element (pointcloud/mesh/
 * volume/boxes3d), so a 2D/table/image plot never carries three.js.
 *
 * It bundles `three` (~600K) + the 3D standalone adapters, then registers them
 * into the already-installed core bootstrap via
 * `window.__cairnPlotRegisterRenderer(name, …)`. `react` + `react/jsx-runtime`
 * are EXTERNAL and mapped to core's `window.__cairnPlotReact` /
 * `__cairnPlotJsxRuntime`, so the addon reuses core's single React copy
 * (required for hooks — see `plot-core-main.tsx` / the figure addon). This is
 * the SAME generic addon shape as `plot-figure-addon.tsx`.
 *
 * G3a wires ONE renderer: `pointcloud`. `mesh`/`volume`/`boxes3d` land in G3b
 * (add their standalone adapters + register them here); until then those names
 * are unregistered and a mesh/volume/boxes leaf shows the core "renderer not
 * available" wait state rather than mis-rendering.
 */
import { PointCloudStandalone } from "./plot-three-renderers";

if (!window.__cairnPlotThreeLoaded) {
  if (typeof window.__cairnPlotRegisterRenderer === "function") {
    window.__cairnPlotRegisterRenderer("pointcloud", PointCloudStandalone);
    window.__cairnPlotThreeLoaded = true;
  } else {
    // Core must run first (Python emits it before this addon). If it somehow
    // hasn't, fail loud in the console rather than silently no-op.
    console.error(
      "cairn-plot three addon: core bundle not installed " +
        "(window.__cairnPlotRegisterRenderer missing) — 3D plots will not render.",
    );
  }
}

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * O2 bundle-split — the OFFLINE **three.js 3D addon** inline bundle (G3).
 *
 * Builds a self-contained IIFE from `src/plot-three-addon.tsx` carrying `three`
 * (~600K) + the 3D standalone adapters (G3a: `PointCloudStandalone`), which
 * register themselves into the already-installed core bootstrap via
 * `window.__cairnPlotRegisterRenderer("pointcloud", …)`. Python emits it
 * (include-once, guard `window.__cairnPlotThreeLoaded`) ONLY for a 3D element
 * (pointcloud/mesh/volume/boxes3d), so 2D/table/image plots never carry three.
 *
 * REACT REUSE (correctness, not just size): `react` + `react/jsx-runtime` are
 * EXTERNAL, mapped to core's `window.__cairnPlotReact` / `__cairnPlotJsxRuntime`
 * globals — a second React copy would break hooks ("Invalid hook call"). three
 * itself is bundled IN, so it lives ONLY in this addon, never in core. This is
 * the SAME generic addon shape as `vite.plot-figure.config.ts`.
 *
 * Output: `dist/plot-inline/three.iife.js`. Runs AFTER the figure build (which
 * cleans `dist/plot-inline` with `emptyOutDir:true`) and BEFORE the core build
 * (which writes `core.iife.js` + `style.css` last) — so `emptyOutDir:false`
 * here, or it would wipe `figure.iife.js`. See package.json `build:plot-inline`.
 */
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: "./dist/plot-inline",
    emptyOutDir: false,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/plot-three-addon.tsx"),
      formats: ["iife"],
      name: "__cairnPlotThreeAddon",
      fileName: () => "three.iife.js",
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime"],
      output: {
        inlineDynamicImports: true,
        globals: {
          react: "__cairnPlotReact",
          "react/jsx-runtime": "__cairnPlotJsxRuntime",
        },
      },
    },
  },
});

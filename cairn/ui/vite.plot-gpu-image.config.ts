import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Task 6 (WebGPU engine, Sub-project 1) — the OFFLINE **gpu-image addon**
 * inline bundle. Builds a self-contained IIFE from `src/plot-gpu-image-addon.tsx`
 * carrying the WebGPU/WebGL2 RHI (`lib/cairn-plot/engine/**`) + `GpuImagePane`,
 * which registers itself into the already-installed core bootstrap via
 * `window.__cairnPlotRegisterRenderer("image"/"imagehdr", …)` — GATED behind a
 * capability check (see `plot-gpu-image-addon.tsx`'s doc comment), unlike the
 * figure/three addons which register unconditionally.
 *
 * BUNDLE-GUARD INVARIANT (Task 6 gate): the engine (`renderImage`,
 * `getSharedDevice`, the WGSL/GLSL shader sources, `GpuImagePane`) must be
 * reachable ONLY from this addon chunk, never from `core.iife.js` — core's
 * `plot-renderers.tsx` continues to import the legacy CPU `ImagePane`/
 * `HdrImagePane` only. This config's job is exactly what
 * `vite.plot-three.config.ts`'s does for `three`: keep a heavy/optional
 * dependency OUT of the always-loaded core chunk.
 *
 * REACT REUSE: `react`/`react/jsx-runtime` are EXTERNAL, mapped to core's
 * `window.__cairnPlotReact`/`__cairnPlotJsxRuntime` globals — same generic
 * addon shape as the figure/three configs (required for hooks to work when
 * core's React mounts this addon's component).
 *
 * Output: `dist/plot-inline/gpu-image.iife.js`. Runs alongside the
 * figure/three addon builds (all `emptyOutDir:false`, BEFORE core, which
 * writes `core.iife.js`/`style.css` last) — see package.json
 * `build:plot-inline`.
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
      entry: resolve(__dirname, "src/plot-gpu-image-addon.tsx"),
      formats: ["iife"],
      name: "__cairnPlotGpuImageAddon",
      fileName: () => "gpu-image.iife.js",
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

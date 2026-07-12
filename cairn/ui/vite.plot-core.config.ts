import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * O2 bundle-split — the OFFLINE **core** inline bundle.
 *
 * Builds a SINGLE self-contained IIFE from `src/plot-core-main.tsx`:
 * bootstrap + the 2D/image/table renderers, plus the `__cairnPlotRegisterRenderer`
 * seam and core's React exposed on `window` for addons to reuse. It carries NO
 * Plotly and NO three.js — those ship as separate addon IIFEs
 * (`vite.plot-figure.config.ts`; Phase D 3D) emitted only when a page needs
 * them. This is what EVERY Python-emitted plot carries, so a scalar/table/image
 * page is now ~600KB-class instead of the old ~5.2MB single bundle.
 *
 *  - `inlineDynamicImports: true` — fold every chunk into ONE file, so there
 *    are no sibling `import "/assets/…"` requests that would 404 on a
 *    `file://` / no-server page;
 *  - `format: "iife"` — a classic script with zero import/export the Python
 *    emitter inlines inside a `<script>` guarded by
 *    `window.__cairnPlotBundleLoaded` (include-once);
 *  - `cssCodeSplit: false` — one CSS file (the design tokens the renderers
 *    need) the emitter inlines as a `<style>`.
 *
 * Output: `dist/plot-inline/core.iife.js` + `style.css`.
 *
 * CSS FILENAME (O2 minor): vite 5.4 in lib mode IGNORES `build.lib.cssFileName`
 * and always emits `style.css` (cssCodeSplit:false). We set `cssFileName:
 * "style"` so that EVEN a future vite that HONORS the option still emits
 * `style.css` — the exact name `cairn/sdk/_plot_bundle.py` (`_INLINE_CSS`)
 * reads. No latent trap where an upgrade silently renames the CSS.
 *
 * BUILD ORDER: this config runs LAST (with `emptyOutDir: false`) AFTER the
 * figure build (FIRST, `emptyOutDir: true`, cleans `dist/plot-inline`) and the
 * three.js addon build (`emptyOutDir: false`). That way core's `style.css` +
 * `core.iife.js` are the FINAL writes — so even if an addon build ever emitted
 * a `style.css`, core's design-token CSS overwrites it — while the addon
 * `figure.iife.js`/`three.iife.js` from the earlier builds survive. See
 * package.json `build:plot-inline`.
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
      entry: resolve(__dirname, "src/plot-core-main.tsx"),
      formats: ["iife"],
      name: "__cairnPlotCoreBundle",
      fileName: () => "core.iife.js",
      cssFileName: "style",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});

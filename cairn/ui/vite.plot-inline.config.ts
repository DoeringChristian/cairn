import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Phase C (cairn-plot Python library): build a SINGLE self-contained IIFE from
 * the same `plot-main.tsx` entry (→ `plot-bootstrap`), for the offline LOCAL
 * default. Unlike the code-split `plot.html` build (main `vite.config.ts`),
 * this:
 *  - `inlineDynamicImports: true` — folds every dynamic chunk (incl. the lazy
 *    Plotly `Figure` renderer) into ONE file, so there are NO sibling `import
 *    "/assets/…"` requests that would 404 on a `file://` / no-server page;
 *  - `format: "iife"` — a classic script with zero import/export, so the
 *    Python emitter can inline it inside a `<script>` guarded by
 *    `window.__cairnPlotBundleLoaded` (include-once);
 *  - `cssCodeSplit: false` — one CSS file (the design tokens `bg-bg`/`text-fg`
 *    the renderers need) the emitter inlines as a `<style>`.
 *
 * Output: `dist/plot-inline/plot-inline.iife.js` + `plot-inline.css`. Committed
 * (pip installs can't build) and read by `cairn/sdk/_plot_bundle.py`.
 *
 * TRADE-OFF (design spec O2): Plotly (~4.8M) is NOT lazy here — it is folded
 * into the one offline file. The include-once guard means it is parsed once per
 * page; the code-split `link` mode (server `/plot`) is the lean companion when
 * a repo endpoint is reachable.
 */
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: "./dist/plot-inline",
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/plot-main.tsx"),
      formats: ["iife"],
      name: "__cairnPlotInlineBundle",
      fileName: () => "plot-inline.iife.js",
      cssFileName: "plot-inline",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});

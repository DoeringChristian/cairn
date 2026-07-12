import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * O2 bundle-split — the OFFLINE **figure addon** inline bundle.
 *
 * Builds a self-contained IIFE from `src/plot-figure-addon.tsx` carrying
 * Plotly (`plotly.js-dist-min`, ~4.8M) + the `FigureStandalone` adapter, which
 * registers itself into the already-installed core bootstrap via
 * `window.__cairnPlotRegisterRenderer("figure", …)`. Python emits it
 * (include-once, guard `window.__cairnPlotFigureLoaded`) ONLY for a `figure`
 * element, so scalar/table/image plots never carry Plotly.
 *
 * REACT REUSE (correctness, not just size): `react` + `react/jsx-runtime` are
 * marked EXTERNAL and mapped to the globals core exposes
 * (`window.__cairnPlotReact` / `__cairnPlotJsxRuntime`). A self-contained addon
 * with its OWN React copy would break hooks — core's React renders this
 * component (via `mountOne`'s `createRoot`), so a second React's dispatcher
 * would be null → "Invalid hook call". Reusing core's React is REQUIRED, not
 * optional. react-plotly.js only `require`s `react` + `prop-types` (verified —
 * no `react-dom`), so those two externals suffice; Plotly + prop-types are
 * bundled in.
 *
 *  - `inlineDynamicImports: true` — ONE file, no `/assets` sibling requests;
 *  - `format: "iife"` — classic script Python inlines in a guarded `<script>`;
 *  - the addon graph imports NO CSS (Plotly injects its styles at runtime), so
 *    this build emits `figure.iife.js` and no stylesheet — nothing to clobber
 *    core's `style.css`.
 *
 * Output: `dist/plot-inline/figure.iife.js`. Runs FIRST with `emptyOutDir:
 * true` (cleans `dist/plot-inline`); the core build follows and adds
 * `core.iife.js` + `style.css` without wiping this file (see package.json).
 *
 * GENERIC: Phase D's three.js 3D addon is the SAME shape — a sibling config
 * that externalizes React to core's globals and registers its renderers.
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
      entry: resolve(__dirname, "src/plot-figure-addon.tsx"),
      formats: ["iife"],
      name: "__cairnPlotFigureAddon",
      fileName: () => "figure.iife.js",
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

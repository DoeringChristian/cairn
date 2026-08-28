import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The cairn-plot renderer library is vendored as a git submodule at
// vendor/cairn-plot; the app consumes its TS source (ui/src) via the
// `@cairn-plot` resolves to the supported public browser API. The temporary
// `@cairn-plot/*` compatibility alias remains while legacy cards are migrated
// away from renderer-internal imports.
// forces its react/three/recharts/plotly imports to resolve from THIS app's
// single node_modules (the submodule ships no node_modules here), so there is
// exactly one copy of each — no duplicate-react "invalid hook call" hazard.
// (`.pathname` keeps the config free of any node: builtin import.)
const cairnPlotSrc = decodeURIComponent(
  new URL("../../vendor/cairn-plot/ui/src/", import.meta.url).pathname,
);
const cairnPlotPublic = `${cairnPlotSrc}public/index.ts`;
const repoRoot = decodeURIComponent(new URL("../../", import.meta.url).pathname);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@cairn-plot$/, replacement: cairnPlotPublic },
      { find: /^@cairn-plot\//, replacement: cairnPlotSrc },
    ],
    dedupe: [
      "react",
      "react-dom",
      "three",
      "recharts",
      "plotly.js-dist-min",
      "react-plotly.js",
    ],
  },
  build: {
    outDir: "./dist",
    emptyOutDir: true,
    // Keep the output small and easy to inspect.
    sourcemap: false,
    // Avoid hashed asset names collisions that trip the StaticFiles mount.
    // (Vite hashes by default; that's fine — we ship the generated index.html.)
    rollupOptions: {
      // Three HTML entries: the SPA (index.html → main.tsx), the standalone
      // WS-EMBED card (embed.html → embed-main.tsx, served at /embed/card),
      // and the standalone cairn-plot renderer (plot.html → plot-main.tsx,
      // served at /plot). All emit into dist/ with a shared /assets chunk
      // graph so React + cairn-plot dedup across entries.
      // Relative to the vite project root (this dir); resolved by vite.
      input: {
        main: "index.html",
        embed: "embed.html",
        plot: "plot.html",
      },
    },
  },
  server: {
    port: 5173,
    // Allow the dev server to read the vendored cairn-plot submodule source
    // (outside the vite root, which is this dir).
    fs: { allow: [repoRoot] },
    // `npm run dev` proxies /api to the cairn backend. Set CAIRN_API_URL
    // env var to override (e.g. http://localhost:4300 for `cairn server`).
    // Default: 4301 which is `cairn ui`'s port.
    proxy: {
      "/api": "http://localhost:4301",
    },
  },
});

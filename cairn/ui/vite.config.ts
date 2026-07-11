import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
    // `npm run dev` proxies /api to the cairn backend. Set CAIRN_API_URL
    // env var to override (e.g. http://localhost:4300 for `cairn server`).
    // Default: 4301 which is `cairn ui`'s port.
    proxy: {
      "/api": "http://localhost:4301",
    },
  },
});

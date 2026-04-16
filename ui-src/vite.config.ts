import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../cairn/ui/dist",
    emptyOutDir: true,
    // Keep the output small and easy to inspect.
    sourcemap: false,
    // Avoid hashed asset names collisions that trip the StaticFiles mount.
    // (Vite hashes by default; that's fine — we ship the generated index.html.)
  },
  server: {
    port: 5173,
    // `npm run dev` proxies /api to the local tracking server so the dev
    // experience matches production (browser always sees /api/*).
    proxy: {
      "/api": "http://localhost:4300",
    },
  },
});

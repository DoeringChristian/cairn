import type { Config } from "tailwindcss";
// The semantic plot palette (bg/fg/border/accent + `mono` font) lives in the
// cairn-plot library preset (now the vendored standalone repo, git submodule at
// vendor/cairn-plot); the app merges its own app-only theme (the `status.*` run
// colors) on top. Loaded outside vite, so a real relative path (not the
// `@cairn-plot` alias).
import cairnPlotPreset from "../../vendor/cairn-plot/ui/src/public/tailwind-preset";

export default {
  presets: [cairnPlotPreset],
  // Scan the app source AND the vendored cairn-plot renderer source so Tailwind
  // keeps the utility classes the renderers use (otherwise they'd be purged).
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../vendor/cairn-plot/ui/src/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        status: {
          running: "#bf8700",
          completed: "#1a7f37",
          failed: "#cf222e",
          killed: "#8b949e",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

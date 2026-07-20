import type { Config } from "tailwindcss";
// The semantic plot palette (bg/fg/border/accent + `mono` font) lives in the
// cairn-plot library preset so the library is self-contained for extraction;
// the app merges its own app-only theme (the `status.*` run colors) on top.
import cairnPlotPreset from "./src/lib/cairn-plot/tailwind-preset";

export default {
  presets: [cairnPlotPreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
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

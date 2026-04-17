import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // Semantic light-first palette.
        bg: {
          DEFAULT: "#ffffff",
          elevated: "#f6f8fa",
          hover: "#ebedf0",
        },
        fg: {
          DEFAULT: "#1f2328",
          muted: "#656d76",
          subtle: "#8b949e",
        },
        border: {
          DEFAULT: "#d0d7de",
          subtle: "#e8ebef",
        },
        accent: {
          DEFAULT: "#0969da",
          hover: "#0550ae",
        },
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

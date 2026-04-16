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
        // Semantic dark-first palette. Light variants used via `dark:` inversion.
        bg: {
          DEFAULT: "#0b0d10",
          elevated: "#13171c",
          hover: "#1a2028",
        },
        fg: {
          DEFAULT: "#e6edf3",
          muted: "#8b949e",
          subtle: "#6e7681",
        },
        border: {
          DEFAULT: "#30363d",
          subtle: "#21262d",
        },
        accent: {
          DEFAULT: "#539bf5",
          hover: "#4184e4",
        },
        status: {
          running: "#d29922",
          completed: "#3fb950",
          failed: "#f85149",
          killed: "#8b949e",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

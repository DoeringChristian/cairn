import type { Config } from "tailwindcss";

/**
 * Self-contained Tailwind preset for the cairn-plot library.
 *
 * The plot renderers use a fixed set of *semantic* utility classes
 * (`bg-bg`, `bg-bg-elevated`, `text-fg`, `text-fg-muted`, `border-border`,
 * `border-accent`, `font-mono`, …). Historically those class names resolved
 * only through the APP's `tailwind.config.ts`, coupling the library to app
 * config. This preset owns that palette + the `mono` font stack so BOTH the
 * app config and any standalone (post-extraction) plot build can produce the
 * exact same utilities by simply listing this preset — no duplicated theme.
 *
 * Only the tokens the library itself renders against live here. App-only
 * theme (e.g. the `status.*` run colors) stays in the app config's own
 * `theme.extend`, which Tailwind deep-merges on top of this preset.
 *
 * The literal hex values are byte-identical to the pre-preset app config so
 * the compiled utilities are unchanged.
 */
export default {
  content: [],
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
      },
    },
  },
} satisfies Config;

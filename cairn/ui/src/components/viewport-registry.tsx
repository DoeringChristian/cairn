import { parseOverlay } from "@cairn-plot/lib/cairn-plot";

// `parseOverlay` lives in cairn-plot (`viewport/parse-overlay.ts`) so the
// standalone plot bundle's LOCAL image provider shares the ONE parser. This
// re-export keeps the remaining importers working while the media shell
// (`VisualContentCard`) is dissolved into per-kind cards; it goes away with
// the shell.
export { parseOverlay };

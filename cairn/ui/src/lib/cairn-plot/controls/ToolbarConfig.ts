/**
 * `controls/ToolbarConfig.ts` — optional, per-mount configuration for the
 * cairn-plot `<PlotToolbar>` (S1). Lets a card/host enable-disable the toolbar,
 * hide individual buttons, and choose corner + reveal behavior without touching
 * the controller. All fields optional; the toolbar supplies defaults.
 */
export interface ToolbarConfig {
  /** Master switch. Default: on. */
  enabled?: boolean;
  /** Per-button overrides keyed by button id (e.g. "zoom", "pan", "reset").
   *  Omitted buttons follow capability-gating. */
  buttons?: Partial<Record<string, boolean>>;
  /** Which corner of the plot to anchor the modebar. Default: "top-right". */
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  /** "hover" reveals on pointer-over (Plotly default); "always" pins it. */
  visibility?: "hover" | "always";
}

/**
 * `controls/ToolbarConfig.ts` — optional, per-mount configuration for the
 * cairn-plot `<PlotToolbar>` (S1). Lets a card/host enable-disable the toolbar,
 * hide individual buttons, and choose corner + reveal behavior without touching
 * the controller. All fields optional; the toolbar supplies defaults.
 */
/**
 * A host-supplied extra button (not tied to a controller capability). Rendered
 * at the LEADING edge of the toolbar so a renderer/method can inject its own
 * controls (e.g. the image pane's pixel-value notation toggle). Either a short
 * text `label` (e.g. "0–255") or an inline-SVG `icon` (an ICON_PATHS key).
 */
export interface ToolbarButtonSpec {
  /** Stable identity (React key). */
  id: string;
  /** Short text label — rendered when `icon` is absent. */
  label?: string;
  /** Inline-SVG icon name (ICON_PATHS key) — rendered when `label` is absent. */
  icon?: string;
  /** Tooltip / aria-label. */
  title: string;
  /** Highlighted (pressed) state. */
  active?: boolean;
  /** Greyed + non-interactive. */
  disabled?: boolean;
  onClick(): void;
}

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
  /** Extra host-supplied buttons rendered at the LEADING (left) edge, before
   *  the standard capability groups and separated by a divider. Because the
   *  toolbar anchors by a corner, leading buttons that appear/disappear never
   *  shift the standard buttons under the cursor. */
  leadingButtons?: ToolbarButtonSpec[];
}

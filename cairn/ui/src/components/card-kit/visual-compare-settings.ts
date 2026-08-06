import type { MediaCompareSettings } from "@cairn-plot/lib/cairn-plot/media-compare";
import type { BaseCardSettings } from "./base-settings";
import type { SeriesRef } from "./use-card-series";

/**
 * The persisted settings shape shared by every `VisualContentCard`
 * instantiation, regardless of `object_type`. The renderer-owned compare/
 * reference/rendering fields live in the lib `MediaCompareSettings`; this
 * intersects them with the app-typed fields (`SeriesRef` metric list, external
 * baseline tag, per-pane widths) and the `BaseCardSettings` persistence
 * envelope. Field names + defaults are UNCHANGED from the pre-extraction type
 * (persisted-settings compatibility for existing image cards is the WS-VC3
 * acceptance bar).
 */
export interface VisualCompareSettings extends BaseCardSettings, MediaCompareSettings {
  metrics: SeriesRef[];
  externalBaseline?: SeriesRef;
  paneWidths?: number[];

  // Host-controlled image/HDR pane props (docs/API.md "Host-controlled panes").
  // With the cairn-plot pane toolbar hidden (`toolbar={false}`), cairn's own
  // settings menu drives these; each rides straight through `ImageViewportPane`
  // → `CompositeMediaPane` to the backend as a controlled prop, and persists in
  // card settings via the existing `useCardSettings` flow.
  /** Tone-map operator (unified 5-op set: linear · srgb · gamma · reinhard ·
   *  aces). Unset ⇒ the pane surface default (sRGB on SDR / Linear+managed PEAK
   *  on HDR). */
  tonemap?: "linear" | "srgb" | "gamma" | "reinhard" | "aces";
  /** PEAK ceiling `P` (HDR mode, ×SDR white; 1..16). Unset ⇒ pane default. */
  peak?: number;
  /** Gamma-operator exponent γ (used only when `tonemap === "gamma"`) — DISTINCT
   *  from `gamma` (the CSS-filter brightness knob) so the two never double-apply. */
  tonemapGamma?: number;
  /** Pixel-value TEV overlay notation (`0-255` int vs `0-1` decimal). */
  pixelValueNotation?: "decimal" | "int";
  /** Persisted engine diff KERNEL selection (`flip` / `flip_ldr` / `ssim` or a
   *  pointwise id) — seeds `GpuComparePane`'s kernel via `diffKernel`. */
  diffKernel?: string;
}

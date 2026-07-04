import type {
  Colormap,
  DiffMode,
  ImageOverlaySettings,
  Interpolation,
} from "../../lib/cairn-plot";
import type { MediaCompareModeKind } from "../../lib/cairn-plot";
import type { BaseCardSettings } from "./base-settings";
import type { SeriesRef } from "./use-card-series";

/**
 * The persisted settings shape shared by every `VisualContentCard`
 * instantiation, regardless of `object_type`. This is `ImageGalleryCard`'s
 * `ImageSettings` interface, hoisted so VisualContentCard can be generic
 * over `TSettings extends VisualCompareSettings` — field names and defaults
 * are UNCHANGED (persisted-settings compatibility for existing image cards
 * is the WS-VC3 acceptance bar).
 *
 * Every field here is either genuinely type-agnostic (metrics, compare mode,
 * reference, step slider, view state) or capability-gated per module
 * (post-processing / overlay / colormap fields — `postProcessing`/`overlays`
 * false for a future type simply means that module's card UI never reads or
 * writes them). A module's own `TSettings` is this type, optionally
 * intersected with type-specific fields (point size, isovalue, …) via its
 * own settings interface — none exist yet (image adds nothing on top).
 */
export interface VisualCompareSettings extends BaseCardSettings {
  metrics: SeriesRef[];
  paneWidths?: number[];

  // Post-processing (capability: postProcessing) -------------------------
  brightness: number;
  contrast: number;
  gamma: number;
  exposure: number;
  offset: number;
  flipSign: boolean;

  // View state (image2d today; camera3d variants land in VC4) ------------
  zoom: number;
  pan: { x: number; y: number };

  // Reference / compare -----------------------------------------------
  baselineIndex?: number;
  externalBaseline?: SeriesRef;
  /** The single exclusive media-compare mode. When unset, derived from the
   *  legacy fields below via `migrateLegacyMode` on every read. */
  mode?: MediaCompareModeKind;
  /** Legacy exclusive-mode axis #1 (kept for rollback; also doubles as the
   *  "diff" mode's sub-mode selector: signed/absolute/squared/relative*). */
  diffMode: "none" | DiffMode;
  referenceMode?: "global" | "per-run";
  perRunBaselineStep?: number;
  /** Legacy exclusive-mode axis #2 (kept for rollback). */
  compareMode?: "side-by-side" | "split" | "blend";
  splitPosition?: number;
  blendAlpha?: number;
  splitSynced?: boolean;

  // Rendering (capability-gated) -----------------------------------------
  interpolation?: Interpolation;
  colormap?: Colormap;
  showAxes?: boolean;
  overlay?: ImageOverlaySettings;

  // Step slider / layout ---------------------------------------------------
  sliderStep?: number;
  imageColumns?: 1 | 2;
  missingImageMode?: "nothing" | "last_available";
  xAxis?: "step" | "relative_time" | "wall_time";
}

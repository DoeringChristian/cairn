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
}

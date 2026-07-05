// ---------------------------------------------------------------------------
// media-compare — the unified visual-media comparison core.
//
// See spec-visual-compare.md. This module is consumed by ImageGalleryCard
// (WS-VC1) today and will be consumed by the 3D cards (WS-VC2) once they
// adopt image-space comparison + native modes. Card-specific data-fetching
// (the react-query half of reference resolution) lives in
// components/card-kit/use-media-reference.ts, layered on top of the pure
// functions exported here.
// ---------------------------------------------------------------------------

export {
  type MediaCompareModeKind,
  type MediaCompareMode,
  MEDIA_COMPARE_MODE_KINDS,
  isCoreCompareMode,
  type SplitConfig,
  type BlendConfig,
  type DiffConfig,
} from "./mode";

export {
  type StepArtifactPoint,
  type MissingArtifactMode,
  resolveArtifactAtStep,
  resolveGlobalPositionalReference,
  type ReferenceSource,
  type ReferenceSelection,
} from "./reference";

export {
  buildProcessingFilterList,
  useGammaFilter,
  GammaFilterSvg,
} from "./post-processing";

export {
  MediaComparePane,
  type MediaComparePaneProps,
  CompositeMediaPane,
  type CompositeMediaPaneProps,
  CrossTypeCompositeMediaPane,
} from "./compositor";

export {
  migrateLegacyMode,
  type LegacyModeInputs,
  LEGACY_MODE_MIGRATION_TABLE,
  assertLegacyModeMigrationTable,
} from "./migrate-legacy-mode";

export { alignFrameSourcesForDiff, type RasterAlignmentResult } from "./cross-type-align";

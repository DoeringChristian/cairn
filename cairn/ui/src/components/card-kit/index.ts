// Sizing convention: card renderers derive their size from
// `useContainerSize` (cairn-plot/hooks/use-container-size, ResizeObserver-
// backed) or from controlled width/height props/settings threaded down from
// CardShell — never from `window` resize listeners or a one-shot measurement
// taken once at mount. CardShell/CardResizeHandle own the outer card box
// (including the per-type minimums in ./card-min-sizes); content below that
// should react continuously to its own box, not assume a size that was true
// only when it first rendered.

export type { BaseCardSettings } from "./base-settings";
export { useCardSeries } from "./use-card-series";
export { useIframeAutoHeight } from "./use-iframe-auto-height";
export type { IframeAutoHeightOptions } from "./use-iframe-auto-height";
export { resolveAtStep } from "./resolve-at-step";
export { useStepSlider } from "./use-step-slider";
export { useRunInfo, buildRunInfoMap } from "./use-run-info";
export { default as MultiPaneGrid } from "./MultiPaneGrid";
export { useMediaReference } from "./use-media-reference";
export type { MediaReferenceTag, UseMediaReferenceArgs, UseMediaReferenceResult } from "./use-media-reference";
export { useReferenceDrop } from "./use-reference-drop";
export type { UseReferenceDropOpts, UseReferenceDropResult } from "./use-reference-drop";
export { PropertySelector } from "./PropertySelector";
export type { PropertySelectorProps } from "./PropertySelector";
export { useOffscreenSnapshot } from "./use-offscreen-snapshot";
export type { UseOffscreenSnapshotResult } from "./use-offscreen-snapshot";
export { useCompareReferenceMeta } from "./use-compare-reference-meta";
export { OffscreenComparePanes, frameSourceToUrl } from "./OffscreenComparePanes";
export type { OffscreenComparePanesProps, ComparePaneSource } from "./OffscreenComparePanes";
export { CrossTypeForeignFrame, hasForeignFrameBridge } from "./cross-type-frame";
export type { ForeignFrameProps } from "./cross-type-frame";
export { CompareSettingsPanel } from "./CompareSettingsPanel";
export type { CompareSettingsPanelProps } from "./CompareSettingsPanel";
export type { VisualCompareSettings } from "./visual-compare-settings";

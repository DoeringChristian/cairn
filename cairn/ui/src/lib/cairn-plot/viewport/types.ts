import type { ColormapName, DiffMode } from "../types";
import type { MediaCompareModeKind } from "../media-compare/mode";

// ---------------------------------------------------------------------------
// Viewport — the pluggable-rendering contract behind VisualContentCard.
//
// See docs/superpowers/specs/2026-07-04-visual-content-card.md §2.2. This is
// the FOUNDATION (WS-VC3): the interface is defined precisely here and
// implemented ONCE today (ImageViewport, ../image-viewport.tsx). WS-VC4 wraps
// the four 3D viewers (Mesh/PointCloud/Boxes/Volume) against this exact
// contract; WS-VC5 switches the 3D cards onto VisualContentCard; WS-VC6 adds
// cross-type compare. Nothing here should need to change shape for VC4 to
// plug in — only new concrete instantiations are added.
//
// This module (types.ts) is pure/app-agnostic: no react-query, no api/*
// imports — matching the existing cairn-plot boundary (see
// media-compare/reference.ts's header comment). The concrete `useData`
// implementation for a given object_type MAY need app-layer data (react-query
// hooks, the api client) and therefore is composed into the full
// `ViewportModule` object at the app layer (components/viewport-registry.tsx),
// not inside cairn-plot — exactly the same split already used for
// media-compare/reference.ts (pure, here) vs
// components/card-kit/use-media-reference.ts (react-query, app layer).
// ---------------------------------------------------------------------------

/**
 * Type-agnostic frame the compositor consumes for side/split/blend/diff
 * compositing (and, in WS-VC6, cross-type compare). The image path yields
 * `{kind:"url"}` today (an artifact URL — zero-copy, no snapshot needed); the
 * 3D path (WS-VC4/5) will yield `{kind:"canvas"}` (live/offscreen WebGL
 * canvas) or `{kind:"dataUrl"}` (a PNG snapshot, the current
 * `use-offscreen-snapshot.ts` bridge). Exactly one variant is ever produced
 * per frame.
 *
 * NOT YET CONSUMED in WS-VC3 — `onFrame` exists on `ViewportPaneProps` so the
 * shape is load-bearing for VC4, but ImageViewport's Pane does not need to
 * call it (the image card's screenshot/compositing already works directly
 * off artifact URLs and does not go through this bridge — see
 * VisualContentCard's `handleScreenshot`, unchanged from ImageGalleryCard).
 */
export type FrameSource =
  | { kind: "url"; url: string }
  | { kind: "canvas"; canvas: HTMLCanvasElement }
  | { kind: "dataUrl"; dataUrl: string };

/**
 * Common view-state: a discriminated union, NOT one concrete type (2D affine
 * zoom/pan and a 3D camera pose are structurally different — D5 in the
 * design doc). Only the *pattern* (immutable value + full-replace callback)
 * is shared; `camera-sync.ts`'s echo-guarded bus generalizes independently of
 * this type.
 */
export type ViewState =
  | { kind: "image2d"; zoom: number; pan: { x: number; y: number } }
  | {
      kind: "camera3d";
      position: [number, number, number];
      target: [number, number, number];
      zoom: number;
    };

/** A card-native (non-compositor) compare mode — e.g. a 3D geometry diff.
 *  Rendered by the card via `ViewportModule.nativeDiff`, NOT the shared
 *  image-space compositor. `enabledFor` gates on preconditions (e.g.
 *  topology match); when false, the mode is shown disabled with
 *  `disabledReason`. `[]` for image (no native modes). */
export interface NativeModeSpec<M extends string = string> {
  mode: M;
  label: string;
  enabledFor(content: unknown, reference: unknown): boolean;
  disabledReason?: string;
}

/**
 * What a viewport module can do — VisualContentCard reads this to decide
 * which chrome to render (mode selector entries, post-processing panel,
 * overlay panel, colorbar, "Sync 3D views" toggle, reset-view semantics,
 * cross-type eligibility) and how to budget WebGL contexts / pane count.
 * Every field is read-only data, not behavior — the card is the single
 * place that interprets it.
 */
export interface ViewportCapabilities<M extends string = never> {
  /** Which of the five core (compositor-driven) modes this type supports.
   *  Image: all five. A hypothetical type with no baseline concept at all
   *  could omit "diff", etc. — VC3 always passes all five for image. */
  coreModes: readonly MediaCompareModeKind[];
  /** Card-native modes (3D geometry diffs) appended to the same selector.
   *  `[]` for image. */
  nativeModes: readonly NativeModeSpec<M>[];
  /** Whether this type has a step axis at all (image: true — every type in
   *  practice does today, but kept explicit for a future stepless type). */
  hasSteps: boolean;
  /** Brightness/contrast/gamma/exposure/offset/flip-sign panel + CSS/SVG
   *  filter pipeline. Image: true. 3D: false (no per-pixel post-processing
   *  of a live render today). */
  postProcessing: boolean;
  /** Bounding-box / segmentation-mask overlay panel. Image: true. 3D: false. */
  overlays: boolean;
  /** Colorbar legend. "always" (Volume, per the design doc), "conditional"
   *  (image: only when a false-color colormap is active; most 3D), "never". */
  colorbar: "always" | "conditional" | "never";
  /** "Sync 3D views" camera-lockstep toggle. Image: false. */
  cameraSync: boolean;
  /** Whether "reset view" gates on `viewModified` (image: zoom/pan tracked,
   *  "tracked") or is always enabled regardless of state (3D: "always" per
   *  the design doc's analysis of the 3D cards' hardcoded `viewModified`). */
  resetView: "tracked" | "always";
  /** Whether this type PARTICIPATES in cross-type compare (WS-VC6) at all —
   *  `true` for every type today (image + all four 3D types). This alone
   *  doesn't mean any two types can compare against each other: the actual
   *  pairing gate is `canCrossTypeCompare` (`viewport/cross-type.ts`), which
   *  additionally requires one side to be "image" (see that module's doc
   *  comment for the shipped-scope rationale). `VisualContentCard` checks
   *  BOTH this flag and `canCrossTypeCompare` before offering a cross-type
   *  reference (the `ExternalBaselinePicker` filter) or rendering one. */
  crossTypeCompare: boolean;
  /** Live WebGL contexts consumed per rendered pane (steady-state, not
   *  counting a transient compare-mode doubling). Image: 0 (diff uses one
   *  process-wide singleton GL context, shared and never disposed — see
   *  image/webgl-diff.ts — so an image pane does not own a context itself).
   *  3D: 1 per live viewer. */
  webglContextsPerPane: number;
  /** Upper bound on simultaneously rendered panes the card should enforce.
   *  Image: effectively unbounded today (no cap) — VC3 keeps this
   *  unenforced/large; 3D (VC4/5) will set 4 (MAX_PANES parity). */
  maxPanes: number;
  /** Label chrome — uniform across every type by construction (the card
   *  owns the bottom-left draggable chip; 3D inherits it "for free" in VC5).
   *  Kept on the descriptor (rather than hardcoded in the card) so a future
   *  type can, in principle, opt out — no type does today. */
  label: { placement: "bottom-left"; draggable: true };
  /** Forces the download filename's extension, bypassing the MIME→ext table
   *  in `lib/download.ts` (`artifactFilename`'s `extOverride`). Every 3D
   *  type's on-disk artifact is `application/octet-stream` (mime-agnostic),
   *  which the MIME table can only resolve to a generic `.bin` — each type
   *  declares its actual on-disk format here instead (pointcloud: `.npy`).
   *  `undefined` (image's case) keeps the existing MIME-derived naming
   *  (`.png`/`.jpg`/...). */
  downloadExtension?: string;
}

/** The identity of one series/pane, independent of what it renders (image
 *  URL vs 3D blob) — the shape already used by `useMediaReference` /
 *  `useReferenceDrop` (mirrors `card-kit/use-card-series`'s `SeriesRef`). */
export interface ViewportSeriesRef {
  runId?: string;
  name: string;
  context_hash: string;
}

/**
 * Arguments to `ViewportModule.useData`. Deliberately NOT "refetch this
 * type's series from scratch" — that machinery (useCardSeries, useStepSlider,
 * useMediaReference, resolveArtifactAtStep) is already shared and stays
 * card-owned per the design doc's appendix ("reference family... unchanged
 * (bound by card)"; "step slider... unchanged"). `useData` instead turns an
 * ALREADY-RESOLVED per-pane artifact hash into type-specific render-ready
 * data: image turns a hash into an artifact URL (`api.artifactUrl`, no
 * network fetch); 3D (VC4) turns a hash into a fetched+parsed npz/npy blob
 * (the ex-`use*Blob` hook). Index-aligned with the card's pane list.
 */
export interface ViewportDataArgs {
  /** Resolved foreground artifact hash per pane (null = nothing resolved at
   *  the current step for that pane). */
  hashes: (string | null)[];
  /** Resolved reference/baseline artifact hash per pane (perPaneHash(i) from
   *  `useMediaReference`), or null when no reference applies. */
  referenceHashes: (string | null)[];
  /** Raw `artifact_metadata` JSON string of the foreground point resolved
   *  for each pane, if any — the generic side-channel a type-specific
   *  `useData` may parse into render data (image: bbox/seg-mask overlays via
   *  `parseOverlay`). `undefined`/`null` entries mean "no metadata for this
   *  pane"; a type that has no use for it simply ignores this field. */
  metadata?: (string | null | undefined)[];
  /** Raw `artifact_metadata` JSON string of the RESOLVED REFERENCE point per
   *  pane (index-aligned with `referenceHashes`), when known — added in
   *  WS-VC4 for 3D types whose reference blob needs its own metadata (point
   *  count/channels/bounds) to render or diff against the foreground, unlike
   *  image which never reads metadata for its reference. `undefined` (the
   *  default) means "not resolved by the card"; a type that has no use for
   *  it (image) simply ignores this field. */
  referenceMetadata?: (string | null | undefined)[];
}

/** Result of `ViewportModule.useData` — `items`/`referenceItems` are
 *  index-aligned with the `hashes`/`referenceHashes` passed in.
 *  `isLoading` covers only the type-specific resolution step itself (e.g.
 *  the npz fetch); the card's own series-loading state (`anyLoading` from
 *  the sequence queries) is tracked separately and unaffected. */
export interface ViewportDataResult<TData> {
  items: (TData | null)[];
  referenceItems: (TData | null)[];
  isLoading: boolean;
}

/**
 * Props for `ViewportModule.Pane` — renders ONE viewport (one pane). This
 * formalizes the existing de-facto contract (ImagePane props ∪ Scene3D's
 * `onFrame`): the card resolves data/reference/mode/settings for a pane and
 * hands them to the module; the module owns everything about how that one
 * pane is drawn (compositing side/split/blend/diff, or — VC4 — orbit
 * controls + the live/offscreen WebGL canvas).
 */
export interface ViewportPaneProps<TData, TView extends ViewState, TSettings> {
  /** This pane's own resolved content (null while unresolved/loading). */
  data: TData | null;
  /** This pane's resolved baseline/reference content, if any. */
  reference?: TData | null;
  settings: TSettings;
  view: TView;
  onViewChange: (v: TView) => void;
  /** The active core mode (drives compositor dispatch: normal/side/split/
   *  blend/diff — mirrors `CompositeMediaPaneProps.mode`). `reference == null`
   *  always forces "normal" behavior regardless of `mode` (same rule as
   *  `CompositeMediaPane` today) — the module, not the card, applies that
   *  fallback, so the card can pass the user's selected mode unconditionally. */
  mode: MediaCompareModeKind;
  /** Diff sub-mode — always a concrete `DiffMode` (the resolved submode,
   *  e.g. "absolute"), used only when the effective mode is "diff". */
  diffMode: DiffMode;
  /** A card-native (non-compositor) mode name, when `mode` doesn't apply —
   *  reserved for VC4's geometry diffs; unused by ImageViewport. */
  nativeMode?: string;
  /** mode: "split" — clip-path drag-handle position, 0..1. */
  splitPosition?: number;
  onSplitPositionChange?: (p: number) => void;
  /** mode: "blend" — foreground opacity, 0..1. */
  blendAlpha?: number;
  /** Emit a compositor-consumable frame after each render — the bridge for
   *  cross-type/screenshot compositing (WS-VC6). Not called by ImageViewport
   *  in VC3 (see `FrameSource`'s doc comment). */
  onFrame?: (f: FrameSource) => void;
  /** Report this pane's native content size (image: natural pixel
   *  dimensions) — feeds the card's auto-height aspect-ratio layout. Added
   *  in VC3 (not in the original draft) because ImageGalleryCard's
   *  `onNaturalSize` must be preserved for pixel-identical behavior; a
   *  future type without a meaningful "natural size" simply never calls it. */
  onNaturalSize?: (w: number, h: number) => void;
  label: string;
  /** True when this pane's own content IS the resolved reference (renders
   *  the "REF" badge / is excluded from being diffed against itself) —
   *  mirrors `CompositeMediaPaneProps.isReferencePane`. */
  isBaseline?: boolean;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** True when the pane should fill its container (vs. a fixed aspect) —
   *  reserved for grid-layout variance across viewport types; ImageViewport
   *  always fills (matches today's behavior). */
  fill?: boolean;
  /** Live camera-sync group id ("Sync 3D views"), resolved ONCE per card
   *  (never per pane — see `lib/camera-sync.ts`'s `useCameraSync` doc
   *  comment) and threaded to every pane so orbit/zoom/pan mirrors across
   *  this card's OWN panes only — scoped per card instance, NOT shared with
   *  any other 3D card on the page (see `useCameraSync`'s doc comment; fixed
   *  in the "per-card sync group, not app-wide" pass). `null` = sync off or
   *  `capabilities.cameraSync` is false; ImageViewport ignores this (image
   *  has no camera). Added in WS-VC4. */
  cameraSyncGroupId?: string | null;
  /** WS-VC6: the resolved reference belongs to a DIFFERENT `object_type` than
   *  this viewport (cross-type compare — image<->3D). `reference` is always
   *  `null` in this case (a foreign type's data cannot be shaped as this
   *  module's own `TData`); the card instead supplies an already-rendered
   *  raster here — a plain image URL (foreign type "image") or a
   *  pre-snapshotted 3D render (foreign 3D type, rendered offscreen by the
   *  card via that type's own module — see `components/card-kit/
   *  cross-type-frame.tsx`). `undefined`/`null` = no cross-type reference for
   *  this pane (the normal same-type `reference` field applies, if any); the
   *  module then falls back to its native reference handling unchanged.
   *  Only meaningful for the image-space compositor modes (side/split/blend/
   *  diff) — native (geometry) `nativeModes` never receive this and stay
   *  same-type by construction (their `enabledFor` sees a `null` `reference`
   *  item, so they self-disable). */
  crossTypeReferenceUrl?: string | null;
  /** WS-VC6: when true AND `mode === "diff"`, the module should route the
   *  pixel-diff through the resample/letterbox alignment step
   *  (`media-compare/cross-type-align.ts`, via `CrossTypeCompositeMediaPane`)
   *  instead of feeding `crossTypeReferenceUrl` straight into the ordinary
   *  diff pipeline — the two rasters are cross-type and may have unrelated
   *  pixel dimensions/aspect, so a naive top-left crop (today's same-type
   *  `computeDiff` behavior) would not be spatially meaningful. Always
   *  `false`/`undefined` outside cross-type compare. */
  crossTypeAlignForDiff?: boolean;
  /**
   * Card-level UNIFIED value/colormap domain (WS-VCP fix 4) — computed ONCE
   * per card by `ViewportModule.activeColorbar` across every pane's
   * foreground+reference items, and threaded to EVERY pane so per-pane
   * coloring is synchronized instead of each pane autoscaling from its own
   * item's data (mismatched ranges across a comparison's panes was the
   * bug). `null`/absent = no unified domain applies right now (e.g. solid
   * coloring, or the type doesn't implement `activeColorbar`) — the Pane
   * falls back to its own per-item autoscale in that case. Ignored by
   * ImageViewport (image's false-color colorbar is `settings.colormap`-
   * driven, a separate mechanism, unaffected by this).
   */
  colorRange?: [number, number] | null;
}

/**
 * A Viewport module — a plain registration record (composition, not class
 * inheritance: the card *is* the shared base; modules plug in). `object_type`
 * selects the module via a small registry (`components/viewport-registry.tsx`);
 * `CardRenderer` no longer branches per type beyond that lookup.
 */
export interface ViewportModule<
  TData,
  TView extends ViewState,
  TSettings,
  M extends string = never,
> {
  objectType: string;
  capabilities: ViewportCapabilities<M>;
  /** Turn resolved per-pane artifact hashes into render-ready data — see
   *  `ViewportDataArgs`'s doc comment. May be backed by react-query
   *  internally (3D's npz fetch); image's implementation is a pure
   *  synchronous mapping and is composed at the app layer (see
   *  `components/viewport-registry.tsx`) because it calls `api.artifactUrl`,
   *  keeping this types module itself free of an `api/*` import. */
  useData(args: ViewportDataArgs): ViewportDataResult<TData>;
  /** Type-specific settings defaults, excluding `metrics` (assembled by the
   *  card via `useCardSeries`) and the `BaseCardSettings` fields (assembled
   *  by the card's settings persistence). */
  defaultSettings(): Omit<TSettings, "metrics" | "version">;
  /**
   * Optional per-module settings READ MIGRATION (WS-VC4): normalizes a
   * legacy persisted field name/shape into this module's current shape, on
   * every read — non-destructive (returns a new object; never rewrites
   * storage), exactly mirroring how `migrateLegacyMode` derives image's
   * `effectiveMode` from its own legacy fields without mutating settings.
   * Runs ONCE, in `VisualContentCard`, before the settings object is used
   * for anything else. Absent (undefined, image's case) = identity — no
   * legacy shape to migrate. A 3D module whose pre-VisualContentCard card
   * persisted its exclusive compare mode under its own field name (e.g.
   * pointcloud's old `compareMode`) implements this to fold that value into
   * the shared `mode`/`nativeMode` fields so old cards keep loading. */
  migrateSettings?(settings: TSettings): TSettings;
  /**
   * Optional imperative "reset view" (WS-VC4): when present, the card calls
   * THIS instead of `updateSettings(viewToSettingsPatch(defaultView()))` —
   * for 3D, view state is not settings-roundtripped (the camera pose lives
   * only in the live `OrbitControls`/`use-scene3d` instance), so resetting
   * it means reaching into the card's own DOM subtree and calling each
   * live viewer's imperative fit/reset (`resetScene3DViews`), not persisting
   * a value. Absent (undefined, image's case) = the settings-based reset.
   */
  onResetView?(container: HTMLElement | null): void;
  /**
   * View state (zoom/pan or camera pose) is PERSISTED — it lives inside
   * `TSettings`, not as separate card state (image: `settings.zoom`/`pan`,
   * unchanged keys, required so existing persisted image-card settings keep
   * loading identically). Since the card is generic over `TSettings`, it
   * cannot assume which fields hold the view — these two functions are the
   * module-owned bridge: `viewFromSettings` reads `TView` out of `TSettings`;
   * `viewToSettingsPatch` turns a view-state change back into a settings
   * patch to persist. The card never touches `TView`'s shape directly.
   */
  viewFromSettings(settings: TSettings): TView;
  viewToSettingsPatch(view: TView): Partial<TSettings>;
  /** The "reset view" target (image: zoom 1, pan {0,0}; 3D: the fitted
   *  default camera) — the card persists `viewToSettingsPatch(defaultView())`
   *  when the user clicks reset. */
  defaultView(): TView;
  /** Renders ONE viewport. `ImageViewportPane` wraps the existing
   *  `CompositeMediaPane`/`ImagePane` path verbatim. */
  Pane: React.ComponentType<ViewportPaneProps<TData, TView, TSettings>>;
  /** Per-type controls injected into the shared settings panel (point size,
   *  isovalue, wireframe, …). Absent (undefined) when a type has no extra
   *  controls beyond the shared panel — ImageViewport has none today (every
   *  image control is capability-gated shared UI, not a per-type addition),
   *  so it omits this rather than registering a no-op component. */
  SettingsControls?: React.ComponentType<{
    settings: TSettings;
    update: (p: Partial<TSettings>) => void;
    meta: unknown;
  }>;
  /** Geometry-space diff renderer (VC4's `three/diff.ts`), if any. Absent
   *  for image. */
  nativeDiff?: { render: React.ComponentType<ViewportPaneProps<TData, TView, TSettings>> };
  /**
   * Computes the SINGLE card-level colorbar (WS-VCP fix 4): given every
   * currently-resolved pane's foreground+reference items (index-aligned,
   * mirroring `ViewportDataResult`), the persisted settings, and the
   * effective mode/native-mode, returns the colormap + UNIFIED `[min,max]`
   * domain the card should render as its ONE `<Colorbar>` — or `null` when
   * no colorbar applies right now (e.g. solid coloring with no active
   * value/vertex-color mode). VisualContentCard calls this ONCE per render
   * (never per-Pane), renders the result as the sole colorbar, and threads
   * its range back into every Pane via `colorRange` so cross-pane coloring
   * stays synchronized. Absent (image's case) = no card-level colorbar
   * from this mechanism — image keeps its own independent
   * `settings.colormap`-driven false-color colorbar, unaffected.
   */
  activeColorbar?(args: {
    items: (TData | null)[];
    referenceItems: (TData | null)[];
    settings: TSettings;
    mode: MediaCompareModeKind;
    nativeMode?: string;
  }): { colormap: ColormapName; min: number; max: number } | null;
}

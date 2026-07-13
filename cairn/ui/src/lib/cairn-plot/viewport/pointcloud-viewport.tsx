import PointCloudViewer, {
  type PointCloudBackground,
  type PointCloudBounds,
  type PointCloudChannels,
  type PointColorMode,
  type PointSizeMode,
  extractPositions,
} from "../renderers/PointCloudViewer";
import { usePairedSideBySideSync, type Scene3DCameraMode, type Scene3DSyncOptions } from "../three/use-scene3d";
import {
  computeDelta,
  computeDisplacementMagnitude,
  diffColorsForDomain,
  diffDomain,
  unionDiffDomain,
  type DiffColormap,
} from "../three/diff";
import {
  resolveActiveProperty,
  type PropertyMap,
  type PropertyMeta,
} from "../three/properties";
import { LabelChip } from "../primitives";
import type { ColormapName } from "../types";
import type { MediaCompareModeKind } from "../media-compare/mode";
import type { ViewportCapabilities, ViewportPaneProps, ViewState } from "./types";

// ---------------------------------------------------------------------------
// PointCloudViewport — the pointcloud object_type's PURE Viewport pieces
// (WS-VC4, first 3D instantiation of the Viewport contract — see
// docs/superpowers/specs/2026-07-04-visual-content-card.md §2.2 and
// image-viewport.tsx for the reference pattern this mirrors).
//
// Wraps the EXISTING point-cloud rendering (`PointCloudViewer`, built on
// `useScene3D`) — no rendering or diff math is rewritten here, only adapted
// to the Viewport Pane/nativeDiff contract. Three pieces are exported:
//
//   - `PointCloudSingleView`   — mode "normal": one live viewer.
//   - `PointCloudSideBySideView` — mode "side": reference | foreground,
//     two live viewers (mirrors `CompositeMediaPane`'s "side" branch, which
//     renders two `ImagePane`s the same way for the image type).
//   - `PointCloudNativeDiffPane` — the card-native geometry diffs
//     (diff-property/diff-position), moved verbatim from the pre-refactor
//     `PointCloudCard`'s `PointCloudComparePane` native branch. This is
//     `ViewportModule.nativeDiff.render` — rendered by the card INSTEAD of
//     `Pane` when a native mode is selected (Decision D6: native diffs are
//     card-rendered, not run through the image-space compositor).
//
// mode "split"/"blend"/"diff" (the three CORE compositor modes that need
// pixel-space compositing) are NOT implemented here: they need
// `OffscreenComparePanes` (snapshot -> the shared `CompositeMediaPane`),
// which lives in `components/card-kit/` (app layer, since the broader
// card-kit boundary keeps every React-Query-adjacent 3D-compare wiring
// there even where a given file happens not to import react-query itself).
// The actual `ViewportModule.Pane` registered for pointcloud therefore lives
// at the app layer (`components/PointCloudVisualCard.tsx`): it dispatches
// "normal"/"side" to the two pure components below and "split"/"blend"/
// "diff" to `OffscreenComparePanes`, exactly mirroring the pre-refactor
// `PointCloudComparePane`'s own three-way dispatch (see that file's history
// for the original, now-superseded shape).
// ---------------------------------------------------------------------------

/** Point-cloud metadata (`artifact_metadata` JSON), parsed at the app layer
 *  and passed through untouched — same shape the pre-refactor `PointCloudCard`
 *  used (`PointCloudMeta`), just relocated. */
export interface PointCloudMeta {
  n_points: number;
  channels: PointCloudChannels;
  bounds: PointCloudBounds;
  original_count: number;
  downsampled?: boolean;
  value_range?: { min: number; max: number; mean: number };
  properties?: PropertyMeta[];
}

/** PointCloudViewport's `TData`: one pane's resolved blob + its metadata,
 *  bundled together (mirrors `ImageViewportItem` bundling url+overlay from
 *  the same artifact/step). */
export interface PointCloudViewportItem {
  arrays: { data: Float32Array; properties: PropertyMap };
  meta: PointCloudMeta;
}

/** PointCloudViewport's `TView` — reserved `camera3d` shape (see
 *  `viewport/types.ts`'s `ViewState`). Not prop-driven today: the camera
 *  pose lives entirely in the live `OrbitControls`/`useScene3D` instance
 *  (matching the pre-refactor cards' "always-on reset, no tracked
 *  zoom/pan" model — `capabilities.resetView: "always"`), so
 *  `viewFromSettings`/`viewToSettingsPatch` are inert stubs (see the app
 *  layer's module assembly) rather than a real settings roundtrip. */
export type PointCloudViewState = Extract<ViewState, { kind: "camera3d" }>;

/** Card-native compare kinds this type appends to the shared core five —
 *  see `NativeModeSpec`. */
export type PointCloudNativeMode = "diff-property" | "diff-position";

/**
 * PointCloudViewport's `TSettings` requirement — the NARROW subset of the
 * full app-layer settings shape this file's pure components actually read.
 * Declared narrowly (rather than importing `VisualCompareSettings`, an
 * app-layer type, into cairn-plot) so this file stays app-agnostic, exactly
 * like `ImageViewportSettings` — the app layer's wider settings type
 * (`VisualCompareSettings & {...}`) structurally satisfies this. Fields the
 * shared card already threads as their OWN `ViewportPaneProps` (mode,
 * diffMode, splitPosition, blendAlpha, cameraSyncGroupId, nativeMode) are
 * NOT duplicated here.
 */
export interface PointCloudViewportSettings {
  pointSize: number;
  /** Screen (constant-pixel, default) vs world (perspective-attenuated) point
   *  sizing. `undefined` (old persisted cards) = "screen". */
  pointSizeMode?: PointSizeMode;
  colorMode: PointColorMode;
  background: PointCloudBackground;
  /** Selected named property (Property selector); undefined = first available. */
  property?: string;
  /** Native-diff (diff-property/diff-position) color mapping — separate
   *  from image's `colormap` (false-color post-processing, unused here:
   *  `capabilities.postProcessing` is false for pointcloud). */
  diffColormap?: DiffColormap;
  /** Persisted "Show axes" setting (WS-3DR2) — colored XYZ origin lines +
   *  grid, sized off the fitted bounds. `undefined` (old persisted cards) =
   *  off, matching pre-WS-3DR2 rendering. */
  showAxes?: boolean;
  /** Persisted "Show planes" setting (#69 S2) — XY/YZ/XZ reference planes. */
  showPlanes?: boolean;
  /** Persisted camera orientation mode (#69 S1). `undefined` = "orbital". */
  cameraMode?: Scene3DCameraMode;
}

interface PointCloudViewConfig {
  pointSize: number;
  pointSizeMode: PointSizeMode;
  colorMode: PointColorMode;
  background: PointCloudBackground;
  property: string | null;
  showAxes: boolean;
  showPlanes: boolean;
  cameraMode: Scene3DCameraMode;
}

function resolveViewConfig(settings: PointCloudViewportSettings): PointCloudViewConfig {
  return {
    pointSize: settings.pointSize,
    pointSizeMode: settings.pointSizeMode ?? "screen",
    colorMode: settings.colorMode,
    background: settings.background,
    property: settings.property ?? null,
    showAxes: settings.showAxes ?? false,
    showPlanes: settings.showPlanes ?? false,
    cameraMode: settings.cameraMode ?? "orbital",
  };
}

/** mode "normal" — one live viewer, moved verbatim from the pre-refactor
 *  `PointCloudCard`'s `PointCloudBody` (rendering only; the loading/error
 *  states are handled by the card via `data == null`, matching how
 *  `ImageViewportPane` receives already-resolved data). */
export function PointCloudSingleView({
  item,
  view,
  sync,
  label,
  isDraggable,
  onDragStart,
  onFrame,
}: {
  item: PointCloudViewportItem | null;
  view: PointCloudViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onFrame?: (canvas: HTMLCanvasElement) => void;
}) {
  if (!item) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted">
        no point cloud logged yet
      </div>
    );
  }
  const { arrays, meta } = item;
  return (
    <div className="relative flex h-full w-full overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1">
        <PointCloudViewer
          data={arrays.data}
          channels={meta.channels}
          nPoints={meta.n_points}
          bounds={meta.bounds}
          colorMode={view.colorMode}
          pointSize={view.pointSize}
          pointSizeMode={view.pointSizeMode}
          background={view.background}
          showAxes={view.showAxes}
          showPlanes={view.showPlanes}
          cameraMode={view.cameraMode}
          sync={sync}
          onFrame={onFrame}
        />
      </div>
      <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
    </div>
  );
}

/** mode "side" — reference (left) | foreground (right), two live viewers
 *  sharing the same `sync` group so orbiting one moves both when "Sync 3D
 *  views" is on. Mirrors `CompositeMediaPane`'s "side" branch (two
 *  `ImagePane`s) for the pointcloud type — falls back to the single view
 *  when no reference has resolved yet. */
export function PointCloudSideBySideView({
  item,
  reference,
  view,
  sync,
  label,
  isDraggable,
  onDragStart,
}: {
  item: PointCloudViewportItem | null;
  reference: PointCloudViewportItem | null;
  view: PointCloudViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  // WS-VCP fix 3 — see MeshSideBySideView's identical comment: the ref+run
  // pair always mirrors each other, independent of the card-level toggle.
  const pairedSync = usePairedSideBySideSync(sync);
  if (!reference) {
    return (
      <PointCloudSingleView
        item={item}
        view={view}
        sync={sync}
        label={label}
        isDraggable={isDraggable}
        onDragStart={onDragStart}
      />
    );
  }
  return (
    <div className="flex h-full w-full gap-0.5">
      <div className="relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg">
        <PointCloudViewer
          data={reference.arrays.data}
          channels={reference.meta.channels}
          nPoints={reference.meta.n_points}
          bounds={reference.meta.bounds}
          colorMode={view.colorMode}
          pointSize={view.pointSize}
          pointSizeMode={view.pointSizeMode}
          background={view.background}
          showAxes={view.showAxes}
          showPlanes={view.showPlanes}
          cameraMode={view.cameraMode}
          sync={pairedSync}
        />
        <LabelChip label="REF" />
      </div>
      <div className="relative flex-1 min-w-0 overflow-hidden rounded bg-bg">
        {item ? (
          <PointCloudViewer
            data={item.arrays.data}
            channels={item.meta.channels}
            nPoints={item.meta.n_points}
            bounds={item.meta.bounds}
            colorMode={view.colorMode}
            pointSize={view.pointSize}
            pointSizeMode={view.pointSizeMode}
            background={view.background}
            showAxes={view.showAxes}
          showPlanes={view.showPlanes}
          cameraMode={view.cameraMode}
            sync={pairedSync}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">
            no point cloud logged yet
          </div>
        )}
        <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
      </div>
    </div>
  );
}

/**
 * `ViewportModule.nativeDiff.render` — the two card-native geometry diffs
 * (diff-property/diff-position), moved verbatim (math + topology-mismatch
 * messaging) from the pre-refactor `PointCloudCard`'s `PointCloudComparePane`
 * native branch. Fully pure (no offscreen-snapshot bridge needed: unlike
 * split/blend/diff, a native diff colors ONE live viewer directly via
 * `overrideColors`, it never composites two rendered frames).
 */
export function PointCloudNativeDiffPane({
  data,
  reference,
  settings,
  nativeMode,
  cameraSyncGroupId,
  label,
  isDraggable,
  onDragStart,
  colorRange,
}: ViewportPaneProps<PointCloudViewportItem, PointCloudViewState, PointCloudViewportSettings>) {
  const sync: Scene3DSyncOptions | null = cameraSyncGroupId ? { groupId: cameraSyncGroupId } : null;
  const view = resolveViewConfig(settings);

  if (!data || !reference) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse">
        loading…
      </div>
    );
  }

  const topologyOk = data.meta.n_points === reference.meta.n_points;
  if (!topologyOk) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        Point-count mismatch: {data.meta.n_points.toLocaleString()} vs{" "}
        {reference.meta.n_points.toLocaleString()} points — native diff modes need the same point
        count (index-corresponding).
      </div>
    );
  }

  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";
  let deltaValues: Float32Array | null = null;
  if (nativeMode === "diff-position") {
    const posA = extractPositions(data.arrays.data, data.meta.channels, data.meta.n_points);
    const posB = extractPositions(reference.arrays.data, reference.meta.channels, reference.meta.n_points);
    deltaValues = computeDisplacementMagnitude(posA, posB, data.meta.n_points);
  } else {
    const activeA = resolveActiveProperty(data.arrays.properties, view.property, data.meta.properties ?? null);
    const activeB = resolveActiveProperty(
      reference.arrays.properties,
      view.property,
      reference.meta.properties ?? null,
    );
    if (activeA.values && activeB.values) {
      deltaValues = computeDelta(activeA.values, activeB.values, data.meta.n_points);
    }
  }

  if (!deltaValues) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        No property values logged on this cloud to diff — pick a property, or use "Diff: position"
        instead.
      </div>
    );
  }

  // WS-VCP fix 4: color against the card-level UNIFIED diff domain when
  // supplied, else fall back to this pane's own autoscaled domain.
  const domain = colorRange ?? diffDomain(deltaValues, diffColormap);
  const colors = diffColorsForDomain(deltaValues, data.meta.n_points, domain, diffColormap);

  return (
    <div className="relative flex h-full w-full overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1">
        <PointCloudViewer
          data={data.arrays.data}
          channels={data.meta.channels}
          nPoints={data.meta.n_points}
          bounds={data.meta.bounds}
          colorMode={view.colorMode}
          pointSize={view.pointSize}
          pointSizeMode={view.pointSizeMode}
          background={view.background}
          showAxes={view.showAxes}
          showPlanes={view.showPlanes}
          cameraMode={view.cameraMode}
          sync={sync}
          overrideColors={colors}
        />
      </div>
      <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
    </div>
  );
}

function topologyMatches(content: unknown, reference: unknown): boolean {
  const a = content as PointCloudViewportItem | null;
  const b = reference as PointCloudViewportItem | null;
  if (!a || !b) return false;
  return a.meta.n_points === b.meta.n_points;
}

/**
 * `ViewportModule.activeColorbar` (WS-VCP fix 4) — pointcloud has no direct
 * scalar/"values" color mode today (`PointColorMode` is auto/rgb/category/
 * height — none consume the property selector for coloring, only the two
 * native diffs do), so the card-level colorbar only ever applies under a
 * native diff mode: unions every valid pane's diff domain
 * (`unionDiffDomain`). `null` (no colorbar) outside a native diff mode, or
 * when nothing currently has a resolvable diff domain (e.g. every pair
 * point-count-mismatched).
 */
export function pointCloudActiveColorbar(args: {
  items: (PointCloudViewportItem | null)[];
  referenceItems: (PointCloudViewportItem | null)[];
  settings: PointCloudViewportSettings;
  mode: MediaCompareModeKind;
  nativeMode?: string;
}): { colormap: ColormapName; min: number; max: number } | null {
  const { items, referenceItems, settings, nativeMode } = args;
  if (nativeMode !== "diff-property" && nativeMode !== "diff-position") return null;
  const property = settings.property ?? null;
  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";
  const domains: [number, number][] = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const b = referenceItems[i];
    if (!a || !b || a.meta.n_points !== b.meta.n_points) continue;
    let delta: Float32Array | null = null;
    if (nativeMode === "diff-position") {
      const posA = extractPositions(a.arrays.data, a.meta.channels, a.meta.n_points);
      const posB = extractPositions(b.arrays.data, b.meta.channels, b.meta.n_points);
      delta = computeDisplacementMagnitude(posA, posB, a.meta.n_points);
    } else {
      const activeA = resolveActiveProperty(a.arrays.properties, property, a.meta.properties ?? null);
      const activeB = resolveActiveProperty(b.arrays.properties, property, b.meta.properties ?? null);
      if (activeA.values && activeB.values) delta = computeDelta(activeA.values, activeB.values, a.meta.n_points);
    }
    if (delta) domains.push(diffDomain(delta, diffColormap));
  }
  const union = unionDiffDomain(domains, diffColormap);
  return union ? { colormap: diffColormap, min: union[0], max: union[1] } : null;
}

/**
 * PointCloudViewport's capability descriptor. All five core modes (via the
 * app-layer Pane's split/blend/diff -> `OffscreenComparePanes` bridge, same
 * as every 3D type), plus the two native geometry diffs. No post-processing/
 * overlays (no per-pixel pipeline on a live 3D render); camera sync on;
 * always-on reset (no tracked "modified" signal, matching the pre-refactor
 * cards); `colorbar: "never"` for the SHARED false-color mechanism (that
 * mechanism is `settings.colormap`-driven and image-specific — pointcloud
 * has no false-color post-processing knob) — the card renders ONE colorbar
 * via `pointCloudActiveColorbar` (WS-VCP fix 4) instead. `maxPanes: 4` +
 * `webglContextsPerPane: 1` preserve the pre-refactor `MAX_PANES` WebGL
 * budget mitigation.
 */
export const pointCloudViewportCapabilities: ViewportCapabilities<PointCloudNativeMode> = {
  coreModes: ["normal", "side", "split", "blend", "diff"],
  nativeModes: [
    {
      mode: "diff-property",
      label: "Diff: property (native)",
      enabledFor: topologyMatches,
      disabledReason: "Native diff modes need the same point count — disabled for this pair",
    },
    {
      mode: "diff-position",
      label: "Diff: position (native)",
      enabledFor: topologyMatches,
      disabledReason: "Native diff modes need the same point count — disabled for this pair",
    },
  ],
  hasSteps: true,
  postProcessing: false,
  overlays: false,
  colorbar: "never",
  cameraSync: true,
  resetView: "always",
  crossTypeCompare: true,
  webglContextsPerPane: 1,
  maxPanes: 4,
  label: { placement: "bottom-left", draggable: true },
  // Pointcloud artifacts are on-disk `.npy` tensors (mime `application/
  // octet-stream`, which the shared MIME table can only resolve to a
  // generic `.bin`) — matches the old PointCloudCard's `extOverride: ".npy"`.
  downloadExtension: ".npy",
};

import { useState } from "react";
import BoxesViewer, {
  resolveBoxesColorMode,
  type BoxesBackground,
  type BoxesColorMode,
} from "../three/BoxesViewer";
import { usePairedSideBySideSync, type Scene3DCameraMode, type Scene3DSyncOptions } from "../three/use-scene3d";
import { computeDelta, diffColorsForDomain, diffDomain, unionDiffDomain, type DiffColormap } from "../three/diff";
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
// BoxesViewport — the boxes3d object_type's PURE Viewport pieces (WS-VC5,
// mirrors mesh-viewport.tsx / pointcloud-viewport.tsx). Wraps the EXISTING
// `BoxesViewer` (built on `useScene3D`) — no rendering or diff math is
// rewritten, only adapted to the Viewport Pane/nativeDiff contract:
//
//   - `BoxesSingleView`     — mode "normal": one live viewer (with the
//     depth/value filters + "n of N boxes" readout from the old BoxesBody).
//   - `BoxesSideBySideView` — mode "side": reference | foreground.
//   - `BoxesNativeDiffPane` — the card-native diff-property mode, verbatim
//     from the pre-refactor `BoxesCard`'s `BoxesComparePane` native branch.
//
// split/blend/diff (compositor modes) live in the app-layer Pane
// (components/BoxesVisualCard.tsx) via OffscreenComparePanes.
// ---------------------------------------------------------------------------

/** Boxes3D metadata (`artifact_metadata` JSON) — same shape the pre-refactor
 *  `BoxesCard` used (`Boxes3DMeta`), relocated. */
export interface Boxes3DMeta {
  n_boxes: number;
  max_depth: number;
  kind: "boxes" | "octree" | "bvh";
  bounds: { min: [number, number, number]; max: [number, number, number] };
  value_range?: { min: number; max: number; mean: number };
  properties?: PropertyMeta[];
  size_bytes: number;
}

/** BoxesViewport's `TData`: one pane's parsed arrays + its metadata. */
export interface BoxesViewportItem {
  arrays: {
    mins: Float32Array;
    maxs: Float32Array;
    depth: Float32Array;
    properties: PropertyMap;
  };
  meta: Boxes3DMeta;
}

/** BoxesViewport's `TView` — reserved `camera3d` shape (not prop-driven; the
 *  camera pose lives in the live OrbitControls/useScene3D instance). */
export type BoxesViewState = Extract<ViewState, { kind: "camera3d" }>;

/** Card-native compare kinds this type appends to the shared core five. */
export type BoxesNativeMode = "diff-property";

/** BoxesViewport's `TSettings` requirement — the narrow subset this file's
 *  pure components read (mirrors MeshViewportSettings). */
export interface BoxesViewportSettings {
  colorMode: BoxesColorMode;
  background: BoxesBackground;
  depthMin?: number;
  depthMax?: number;
  valueFilterEnabled?: boolean;
  valueMin?: number;
  valueMax?: number;
  property?: string;
  diffColormap?: DiffColormap;
  /** Persisted "Show axes" setting (WS-3DR2). */
  showAxes?: boolean;
  /** Persisted "Show planes" setting (#69 S2) — XY/YZ/XZ reference planes. */
  showPlanes?: boolean;
  /** Persisted camera orientation mode (#69 S1). `undefined` = "orbital". */
  cameraMode?: Scene3DCameraMode;
}

interface BoxesViewConfig {
  colorMode: BoxesColorMode;
  background: BoxesBackground;
  depthMin?: number;
  depthMax?: number;
  valueFilterEnabled?: boolean;
  valueMin?: number;
  valueMax?: number;
  property: string | null;
  showAxes: boolean;
  showPlanes: boolean;
  cameraMode: Scene3DCameraMode;
}

export function resolveBoxesViewConfig(settings: BoxesViewportSettings): BoxesViewConfig {
  return {
    colorMode: settings.colorMode,
    background: settings.background,
    depthMin: settings.depthMin,
    depthMax: settings.depthMax,
    valueFilterEnabled: settings.valueFilterEnabled,
    valueMin: settings.valueMin,
    valueMax: settings.valueMax,
    property: settings.property ?? null,
    showAxes: settings.showAxes ?? false,
    showPlanes: settings.showPlanes ?? false,
    cameraMode: settings.cameraMode ?? "orbital",
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** mode "normal" — one live viewer, moved verbatim from the pre-refactor
 *  `BoxesCard`'s `BoxesBody` (depth/value filter, colorbar, visible-count
 *  readout). */
export function BoxesSingleView({
  item,
  view,
  sync,
  label,
  isDraggable,
  onDragStart,
  onFrame,
  colorRange,
}: {
  item: BoxesViewportItem | null;
  view: BoxesViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onFrame?: (canvas: HTMLCanvasElement) => void;
  /** Card-level unified color domain (WS-VCP fix 4) — overrides the "value"
   *  mode's property range or the "depth" mode's max-depth normalization
   *  (whichever is active) so coloring matches the card's single colorbar.
   *  Never affects the depth/value FILTER range, which stays per-item. */
  colorRange?: [number, number] | null;
}) {
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  if (!item) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted">
        no boxes logged yet
      </div>
    );
  }

  const { arrays, meta } = item;
  const active = resolveActiveProperty(arrays.properties, view.property, meta.properties ?? null);
  const hasValues = !!active.values && !!active.range;
  const maxDepth = meta.max_depth;
  const depthMin = clamp(view.depthMin ?? 0, 0, maxDepth);
  const depthMax = clamp(view.depthMax ?? maxDepth, depthMin, maxDepth);
  const valueThreshold: [number, number] | null =
    hasValues && view.valueFilterEnabled && active.range
      ? [
          clamp(view.valueMin ?? active.range[0], active.range[0], active.range[1]),
          clamp(view.valueMax ?? active.range[1], active.range[0], active.range[1]),
        ]
      : null;

  const effectiveColorMode = resolveBoxesColorMode(view.colorMode, hasValues);
  const valueRangeForColor = effectiveColorMode === "value" ? (colorRange ?? active.range) : active.range;
  const maxDepthForColor = effectiveColorMode === "depth" && colorRange ? colorRange[1] : maxDepth;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded bg-bg">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="min-w-0 flex-1">
          <BoxesViewer
            mins={arrays.mins}
            maxs={arrays.maxs}
            depth={arrays.depth}
            values={active.values}
            nBoxes={meta.n_boxes}
            bounds={meta.bounds}
            maxDepth={maxDepthForColor}
            valueRange={valueRangeForColor}
            colorMode={view.colorMode}
            depthRange={[depthMin, depthMax]}
            valueThreshold={valueThreshold}
            background={view.background}
            showAxes={view.showAxes}
          showPlanes={view.showPlanes}
          cameraMode={view.cameraMode}
            sync={sync}
            onVisibleCount={(visible) => setVisibleCount(visible)}
            onFrame={onFrame}
          />
        </div>
      </div>
      {/* Pinned top-left (not bottom-left) so it never collides with the
          bottom-left draggable `LabelChip` — see mesh-viewport.tsx's
          identical fix for the shared rationale. */}
      <div className="pointer-events-none absolute left-1 top-1 z-10 mono rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-subtle backdrop-blur-sm">
        {`${(visibleCount ?? meta.n_boxes).toLocaleString()} of ${meta.n_boxes.toLocaleString()} boxes · ${meta.kind}`}
      </div>
      <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
    </div>
  );
}

/** mode "side" — reference | foreground, two live viewers sharing `sync`. */
export function BoxesSideBySideView({
  item,
  reference,
  view,
  sync,
  label,
  isDraggable,
  onDragStart,
  colorRange,
}: {
  item: BoxesViewportItem | null;
  reference: BoxesViewportItem | null;
  view: BoxesViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** See `BoxesSingleView`'s identical doc comment (WS-VCP fix 4) — threaded
   *  to BOTH the ref and run viewer below so they color identically. */
  colorRange?: [number, number] | null;
}) {
  // WS-VCP fix 3 — see MeshSideBySideView's identical comment: the ref+run
  // pair always mirrors each other, independent of the card-level toggle.
  const pairedSync = usePairedSideBySideSync(sync);
  if (!reference) {
    return (
      <BoxesSingleView
        item={item}
        view={view}
        sync={sync}
        label={label}
        isDraggable={isDraggable}
        onDragStart={onDragStart}
        colorRange={colorRange}
      />
    );
  }
  const refActive = resolveActiveProperty(
    reference.arrays.properties,
    view.property,
    reference.meta.properties ?? null,
  );
  const refHasValues = !!refActive.values && !!refActive.range;
  const refEffectiveColorMode = resolveBoxesColorMode(view.colorMode, refHasValues);
  const refValueRangeForColor = refEffectiveColorMode === "value" ? (colorRange ?? refActive.range) : refActive.range;
  const refMaxDepthForColor = refEffectiveColorMode === "depth" && colorRange ? colorRange[1] : reference.meta.max_depth;
  return (
    <div className="flex h-full w-full gap-0.5">
      <div className="relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg">
        <BoxesViewer
          mins={reference.arrays.mins}
          maxs={reference.arrays.maxs}
          depth={reference.arrays.depth}
          values={refActive.values}
          nBoxes={reference.meta.n_boxes}
          bounds={reference.meta.bounds}
          maxDepth={refMaxDepthForColor}
          valueRange={refValueRangeForColor}
          colorMode={view.colorMode}
          depthRange={[0, reference.meta.max_depth]}
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
          <BoxesSingleView
            item={item}
            view={view}
            sync={pairedSync}
            label={label}
            isDraggable={isDraggable}
            onDragStart={onDragStart}
            colorRange={colorRange}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">
            no boxes logged yet
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * `ViewportModule.nativeDiff.render` — the card-native diff-property mode,
 * moved verbatim (math + topology gating) from the pre-refactor `BoxesCard`'s
 * `BoxesComparePane` native branch. Requires same box count AND matching
 * per-box depth (index correspondence).
 */
export function BoxesNativeDiffPane({
  data,
  reference,
  settings,
  cameraSyncGroupId,
  label,
  isDraggable,
  onDragStart,
  colorRange,
}: ViewportPaneProps<BoxesViewportItem, BoxesViewState, BoxesViewportSettings>) {
  const sync: Scene3DSyncOptions | null = cameraSyncGroupId ? { groupId: cameraSyncGroupId } : null;
  const view = resolveBoxesViewConfig(settings);

  if (!data || !reference) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse">
        loading…
      </div>
    );
  }

  const primaryDepth = data.arrays.depth;
  const referenceDepth = reference.arrays.depth;
  const topologyOk =
    data.meta.n_boxes === reference.meta.n_boxes &&
    primaryDepth.length === referenceDepth.length &&
    Array.from(primaryDepth).every((d, i) => d === referenceDepth[i]);
  if (!topologyOk) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        Topology mismatch: {data.meta.n_boxes.toLocaleString()} vs{" "}
        {reference.meta.n_boxes.toLocaleString()} boxes (or differing per-box depth) — native diff
        needs matched box count + depth.
      </div>
    );
  }

  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";
  const activeA = resolveActiveProperty(data.arrays.properties, view.property, data.meta.properties ?? null);
  const activeB = resolveActiveProperty(
    reference.arrays.properties,
    view.property,
    reference.meta.properties ?? null,
  );

  if (!activeA.values || !activeB.values) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        No property values logged on these boxes to diff — pick a property with values on both series.
      </div>
    );
  }

  const deltaValues = computeDelta(activeA.values, activeB.values, data.meta.n_boxes);
  // WS-VCP fix 4: color against the card-level UNIFIED diff domain when
  // supplied, else fall back to this pane's own autoscaled domain.
  const domain = colorRange ?? diffDomain(deltaValues, diffColormap);
  const colors = diffColorsForDomain(deltaValues, data.meta.n_boxes, domain, diffColormap);

  return (
    <div className="relative flex h-full w-full overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1">
        <BoxesViewer
          mins={data.arrays.mins}
          maxs={data.arrays.maxs}
          depth={data.arrays.depth}
          nBoxes={data.meta.n_boxes}
          bounds={data.meta.bounds}
          maxDepth={data.meta.max_depth}
          colorMode="value"
          depthRange={[0, data.meta.max_depth]}
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
  const a = content as BoxesViewportItem | null;
  const b = reference as BoxesViewportItem | null;
  if (!a || !b) return false;
  if (a.meta.n_boxes !== b.meta.n_boxes) return false;
  if (a.arrays.depth.length !== b.arrays.depth.length) return false;
  return Array.from(a.arrays.depth).every((d, i) => d === b.arrays.depth[i]);
}

/**
 * `ViewportModule.activeColorbar` (WS-VCP fix 4) — the SINGLE card-level
 * colorbar for boxes: under the native diff-property mode, unions every
 * valid pane's diff domain; otherwise mirrors `BoxesSingleView`'s per-item
 * `effectiveColorMode` fallback (colorMode "value" without any values present
 * anywhere falls back to a depth-based domain) at the CARD level — "value"
 * unions the active property's range across every item that actually has
 * values; "depth" unions `max_depth` across every item; "solid" (or no
 * items at all) is `null` (no colorbar).
 */
export function boxesActiveColorbar(args: {
  items: (BoxesViewportItem | null)[];
  referenceItems: (BoxesViewportItem | null)[];
  settings: BoxesViewportSettings;
  mode: MediaCompareModeKind;
  nativeMode?: string;
}): { colormap: ColormapName; min: number; max: number } | null {
  const { items, referenceItems, settings, nativeMode } = args;
  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";

  if (nativeMode === "diff-property") {
    const property = settings.property ?? null;
    const domains: [number, number][] = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const b = referenceItems[i];
      if (!a || !b) continue;
      if (a.meta.n_boxes !== b.meta.n_boxes || a.arrays.depth.length !== b.arrays.depth.length) continue;
      const activeA = resolveActiveProperty(a.arrays.properties, property, a.meta.properties ?? null);
      const activeB = resolveActiveProperty(b.arrays.properties, property, b.meta.properties ?? null);
      if (!activeA.values || !activeB.values) continue;
      const delta = computeDelta(activeA.values, activeB.values, a.meta.n_boxes);
      domains.push(diffDomain(delta, diffColormap));
    }
    const union = unionDiffDomain(domains, diffColormap);
    return union ? { colormap: diffColormap, min: union[0], max: union[1] } : null;
  }

  const all = [...items, ...referenceItems];
  if (settings.colorMode === "solid") return null;
  const property = settings.property ?? null;
  let anyHasValues = false;
  let lo = Infinity;
  let hi = -Infinity;
  for (const it of all) {
    if (!it) continue;
    const active = resolveActiveProperty(it.arrays.properties, property, it.meta.properties ?? null);
    if (active.values && active.range) {
      anyHasValues = true;
      lo = Math.min(lo, active.range[0]);
      hi = Math.max(hi, active.range[1]);
    }
  }
  if (settings.colorMode === "value" && anyHasValues) {
    return { colormap: "viridis", min: lo, max: hi };
  }
  // "depth" (or "value" with nothing to color by, matching the per-pane
  // fallback) — domain is [0, max_depth] unioned across every item.
  let maxDepth = 0;
  for (const it of all) {
    if (it) maxDepth = Math.max(maxDepth, it.meta.max_depth);
  }
  if (all.every((it) => !it)) return null;
  return { colormap: "viridis", min: 0, max: Math.max(maxDepth, 1) };
}

/**
 * BoxesViewport's capability descriptor — mirrors `meshViewportCapabilities`
 * (all five core modes via the app-layer Pane's OffscreenComparePanes bridge,
 * plus the one native diff-property mode; no post-processing/overlays; camera
 * sync on; always-on reset; the card renders ONE colorbar via
 * `boxesActiveColorbar` (WS-VCP fix 4); `maxPanes: 4` +
 * `webglContextsPerPane: 1` WebGL budget parity).
 */
export const boxesViewportCapabilities: ViewportCapabilities<BoxesNativeMode> = {
  coreModes: ["normal", "side", "split", "blend", "diff"],
  nativeModes: [
    {
      mode: "diff-property",
      label: "Diff: property (native)",
      enabledFor: topologyMatches,
      disabledReason: "Native diff needs the same box count (+ matching depth) — disabled for this pair",
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
  // Boxes3D artifacts are on-disk `.npz` blobs (mime `application/
  // octet-stream`) — matches the old BoxesCard's `artifactFilename(...,
  // ".npz")` call.
  downloadExtension: ".npz",
};

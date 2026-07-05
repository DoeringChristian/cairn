import { useState } from "react";
import BoxesViewer, {
  type BoxesBackground,
  type BoxesColorMode,
} from "../three/BoxesViewer";
import type { Scene3DSyncOptions } from "../three/use-scene3d";
import { computeDelta, diffColors, type DiffColormap } from "../three/diff";
import {
  resolveActiveProperty,
  type PropertyMap,
  type PropertyMeta,
} from "../three/properties";
import { Colorbar, LabelChip } from "../primitives";
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
}: {
  item: BoxesViewportItem | null;
  view: BoxesViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onFrame?: (canvas: HTMLCanvasElement) => void;
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

  const effectiveColorMode = view.colorMode === "value" && !hasValues ? "depth" : view.colorMode;
  const showColorbar = effectiveColorMode !== "solid";
  const colorbarDomain: [number, number] =
    effectiveColorMode === "value" && active.range ? active.range : [0, Math.max(maxDepth, 1)];

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
            maxDepth={maxDepth}
            valueRange={active.range}
            colorMode={view.colorMode}
            depthRange={[depthMin, depthMax]}
            valueThreshold={valueThreshold}
            background={view.background}
            sync={sync}
            onVisibleCount={(visible) => setVisibleCount(visible)}
            onFrame={onFrame}
          />
        </div>
        {showColorbar && (
          <Colorbar colormap="viridis" min={colorbarDomain[0]} max={colorbarDomain[1]} />
        )}
      </div>
      <div className="mono px-1 py-0.5 text-[10px] text-fg-subtle">
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
}: {
  item: BoxesViewportItem | null;
  reference: BoxesViewportItem | null;
  view: BoxesViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  if (!reference) {
    return (
      <BoxesSingleView
        item={item}
        view={view}
        sync={sync}
        label={label}
        isDraggable={isDraggable}
        onDragStart={onDragStart}
      />
    );
  }
  const refActive = resolveActiveProperty(
    reference.arrays.properties,
    view.property,
    reference.meta.properties ?? null,
  );
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
          maxDepth={reference.meta.max_depth}
          valueRange={refActive.range}
          colorMode={view.colorMode}
          depthRange={[0, reference.meta.max_depth]}
          background={view.background}
          sync={sync}
        />
        <LabelChip label="REF" />
      </div>
      <div className="relative flex-1 min-w-0 overflow-hidden rounded bg-bg">
        {item ? (
          <BoxesSingleView
            item={item}
            view={view}
            sync={sync}
            label={label}
            isDraggable={isDraggable}
            onDragStart={onDragStart}
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
  const { colors, domain } = diffColors(deltaValues, data.meta.n_boxes, diffColormap);

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
          sync={sync}
          overrideColors={colors}
        />
      </div>
      <Colorbar colormap={diffColormap} min={domain[0]} max={domain[1]} />
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
 * BoxesViewport's capability descriptor — mirrors `meshViewportCapabilities`
 * (all five core modes via the app-layer Pane's OffscreenComparePanes bridge,
 * plus the one native diff-property mode; no post-processing/overlays; camera
 * sync on; always-on reset; contextual colorbar rendered by the Pane;
 * `maxPanes: 4` + `webglContextsPerPane: 1` WebGL budget parity).
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
  crossTypeCompare: false,
  webglContextsPerPane: 1,
  maxPanes: 4,
  label: { placement: "bottom-left", draggable: true },
  // Boxes3D artifacts are on-disk `.npz` blobs (mime `application/
  // octet-stream`) — matches the old BoxesCard's `artifactFilename(...,
  // ".npz")` call.
  downloadExtension: ".npz",
};

import MeshViewer, {
  resolveMeshColorMode,
  type MeshBackground,
  type MeshColorMode,
  type MeshShading,
} from "../three/MeshViewer";
import type { Scene3DSyncOptions } from "../three/use-scene3d";
import {
  computeDelta,
  computeDisplacementMagnitude,
  diffColors,
  type DiffColormap,
} from "../three/diff";
import {
  resolveActiveProperty,
  type PropertyMap,
  type PropertyMeta,
} from "../three/properties";
import { Colorbar, LabelChip } from "../primitives";
import type { ViewportCapabilities, ViewportPaneProps, ViewState } from "./types";

// ---------------------------------------------------------------------------
// MeshViewport — the mesh object_type's PURE Viewport pieces (WS-VC5, mirrors
// pointcloud-viewport.tsx exactly — see that file's header comment and
// docs/superpowers/specs/2026-07-04-visual-content-card.md §2.2). Wraps the
// EXISTING mesh rendering (`MeshViewer`, built on `useScene3D`) — no
// rendering or diff math is rewritten here, only adapted to the Viewport
// Pane/nativeDiff contract. Three pieces are exported:
//
//   - `MeshSingleView`     — mode "normal": one live viewer.
//   - `MeshSideBySideView` — mode "side": reference | foreground, two live
//     viewers (mirrors PointCloudSideBySideView).
//   - `MeshNativeDiffPane` — the card-native geometry diffs
//     (diff-property/diff-geometry), moved verbatim from the pre-refactor
//     `MeshCard`'s `MeshComparePane` native branch.
//
// mode "split"/"blend"/"diff" are NOT implemented here: they need
// `OffscreenComparePanes` (app layer) — the real `ViewportModule.Pane` for
// mesh lives at `components/MeshVisualCard.tsx`, exactly mirroring
// `PointCloudVisualCard.tsx`'s three-way dispatch.
// ---------------------------------------------------------------------------

/** Mesh metadata (`artifact_metadata` JSON), parsed at the app layer and
 *  passed through untouched — same shape the pre-refactor `MeshCard` used
 *  (`MeshMeta`), just relocated. */
export interface MeshMeta {
  n_vertices: number;
  n_faces: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  has_colors: boolean;
  has_normals: boolean;
  value_range?: { min: number; max: number; mean: number };
  properties?: PropertyMeta[];
  size_bytes: number;
}

/** MeshViewport's `TData`: one pane's resolved blob + its metadata. */
export interface MeshViewportItem {
  arrays: {
    positions: Float32Array;
    faces: Uint32Array;
    properties: PropertyMap;
    colors: Float32Array | null;
    normals: Float32Array | null;
  };
  meta: MeshMeta;
}

/** MeshViewport's `TView` — reserved `camera3d` shape (see `viewport/types.ts`'s
 *  `ViewState`); not prop-driven (the camera pose lives entirely in the live
 *  `OrbitControls`/`useScene3D` instance — `capabilities.resetView: "always"`). */
export type MeshViewState = Extract<ViewState, { kind: "camera3d" }>;

/** Card-native compare kinds this type appends to the shared core five. */
export type MeshNativeMode = "diff-property" | "diff-geometry";

/** MeshViewport's `TSettings` requirement — the narrow subset this file's
 *  pure components actually read (mirrors `PointCloudViewportSettings`). */
export interface MeshViewportSettings {
  colorMode: MeshColorMode;
  shading: MeshShading;
  wireframe: boolean;
  doubleSided: boolean;
  background: MeshBackground;
  property?: string;
  diffColormap?: DiffColormap;
}

interface MeshViewConfig {
  colorMode: MeshColorMode;
  shading: MeshShading;
  wireframe: boolean;
  doubleSided: boolean;
  background: MeshBackground;
  property: string | null;
}

function resolveViewConfig(settings: MeshViewportSettings): MeshViewConfig {
  return {
    colorMode: settings.colorMode,
    shading: settings.shading,
    wireframe: settings.wireframe,
    doubleSided: settings.doubleSided,
    background: settings.background,
    property: settings.property ?? null,
  };
}

/** mode "normal" — one live viewer, moved verbatim from the pre-refactor
 *  `MeshCard`'s `MeshBody` (rendering only; loading/error states are handled
 *  by the card via `data == null`). */
export function MeshSingleView({
  item,
  view,
  sync,
  label,
  isDraggable,
  onDragStart,
  onFrame,
}: {
  item: MeshViewportItem | null;
  view: MeshViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onFrame?: (canvas: HTMLCanvasElement) => void;
}) {
  if (!item) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted">
        no mesh logged yet
      </div>
    );
  }
  const { arrays, meta } = item;
  const active = resolveActiveProperty(arrays.properties, view.property, meta.properties ?? null);
  const resolvedMode = resolveMeshColorMode(view.colorMode, !!arrays.colors, !!active.values);
  return (
    <div className="relative flex h-full w-full overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1">
        <MeshViewer
          positions={arrays.positions}
          faces={arrays.faces}
          nVertices={meta.n_vertices}
          nFaces={meta.n_faces}
          values={active.values}
          valueRange={active.range}
          colors={arrays.colors}
          normals={arrays.normals}
          bounds={meta.bounds}
          colorMode={view.colorMode}
          shading={view.shading}
          wireframe={view.wireframe}
          doubleSided={view.doubleSided}
          background={view.background}
          sync={sync}
          onFrame={onFrame}
        />
      </div>
      {resolvedMode === "values" && active.range && (
        <Colorbar colormap="viridis" min={active.range[0]} max={active.range[1]} />
      )}
      <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
    </div>
  );
}

/** mode "side" — reference (left) | foreground (right), two live viewers
 *  sharing the same `sync` group. Mirrors `PointCloudSideBySideView`. */
export function MeshSideBySideView({
  item,
  reference,
  view,
  sync,
  label,
  isDraggable,
  onDragStart,
}: {
  item: MeshViewportItem | null;
  reference: MeshViewportItem | null;
  view: MeshViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  if (!reference) {
    return (
      <MeshSingleView
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
        <MeshViewer
          positions={reference.arrays.positions}
          faces={reference.arrays.faces}
          nVertices={reference.meta.n_vertices}
          nFaces={reference.meta.n_faces}
          values={refActive.values}
          valueRange={refActive.range}
          colors={reference.arrays.colors}
          normals={reference.arrays.normals}
          bounds={reference.meta.bounds}
          colorMode={view.colorMode}
          shading={view.shading}
          wireframe={view.wireframe}
          doubleSided={view.doubleSided}
          background={view.background}
          sync={sync}
        />
        <LabelChip label="REF" />
      </div>
      <div className="relative flex-1 min-w-0 overflow-hidden rounded bg-bg">
        {item ? (() => {
          const active = resolveActiveProperty(item.arrays.properties, view.property, item.meta.properties ?? null);
          return (
            <MeshViewer
              positions={item.arrays.positions}
              faces={item.arrays.faces}
              nVertices={item.meta.n_vertices}
              nFaces={item.meta.n_faces}
              values={active.values}
              valueRange={active.range}
              colors={item.arrays.colors}
              normals={item.arrays.normals}
              bounds={item.meta.bounds}
              colorMode={view.colorMode}
              shading={view.shading}
              wireframe={view.wireframe}
              doubleSided={view.doubleSided}
              background={view.background}
              sync={sync}
            />
          );
        })() : (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">
            no mesh logged yet
          </div>
        )}
        <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
      </div>
    </div>
  );
}

/**
 * `ViewportModule.nativeDiff.render` — the two card-native geometry diffs
 * (diff-property/diff-geometry), moved verbatim (math + topology-mismatch
 * messaging) from the pre-refactor `MeshCard`'s `MeshComparePane` native
 * branch.
 */
export function MeshNativeDiffPane({
  data,
  reference,
  settings,
  nativeMode,
  cameraSyncGroupId,
  label,
  isDraggable,
  onDragStart,
}: ViewportPaneProps<MeshViewportItem, MeshViewState, MeshViewportSettings>) {
  const sync: Scene3DSyncOptions | null = cameraSyncGroupId ? { groupId: cameraSyncGroupId } : null;
  const view = resolveViewConfig(settings);

  if (!data || !reference) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse">
        loading…
      </div>
    );
  }

  const topologyOk =
    data.meta.n_vertices === reference.meta.n_vertices && data.meta.n_faces === reference.meta.n_faces;
  if (!topologyOk) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        Topology mismatch: {data.meta.n_vertices.toLocaleString()} vs{" "}
        {reference.meta.n_vertices.toLocaleString()} vertices,{" "}
        {data.meta.n_faces.toLocaleString()} vs {reference.meta.n_faces.toLocaleString()} faces — native
        diff modes need matching mesh topology (same vertex/face counts).
      </div>
    );
  }

  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";
  let deltaValues: Float32Array | null = null;
  if (nativeMode === "diff-geometry") {
    deltaValues = computeDisplacementMagnitude(
      data.arrays.positions,
      reference.arrays.positions,
      data.meta.n_vertices,
    );
  } else {
    const activeA = resolveActiveProperty(data.arrays.properties, view.property, data.meta.properties ?? null);
    const activeB = resolveActiveProperty(
      reference.arrays.properties,
      view.property,
      reference.meta.properties ?? null,
    );
    if (activeA.values && activeB.values) {
      deltaValues = computeDelta(activeA.values, activeB.values, data.meta.n_vertices);
    }
  }

  if (!deltaValues) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        No property values logged on this mesh to diff — pick a property, or use "Diff: geometry" instead.
      </div>
    );
  }

  const { colors, domain } = diffColors(deltaValues, data.meta.n_vertices, diffColormap);

  return (
    <div className="relative flex h-full w-full overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1">
        <MeshViewer
          positions={data.arrays.positions}
          faces={data.arrays.faces}
          nVertices={data.meta.n_vertices}
          nFaces={data.meta.n_faces}
          colors={colors}
          colorMode="vertex-colors"
          normals={data.arrays.normals}
          bounds={data.meta.bounds}
          shading={view.shading}
          wireframe={view.wireframe}
          doubleSided={view.doubleSided}
          background={view.background}
          sync={sync}
        />
      </div>
      <Colorbar colormap={diffColormap} min={domain[0]} max={domain[1]} />
      <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
    </div>
  );
}

function topologyMatches(content: unknown, reference: unknown): boolean {
  const a = content as MeshViewportItem | null;
  const b = reference as MeshViewportItem | null;
  if (!a || !b) return false;
  return a.meta.n_vertices === b.meta.n_vertices && a.meta.n_faces === b.meta.n_faces;
}

/**
 * MeshViewport's capability descriptor — mirrors
 * `pointCloudViewportCapabilities` exactly (all five core modes via the
 * app-layer Pane's split/blend/diff -> `OffscreenComparePanes` bridge, plus
 * the two native geometry diffs; no post-processing/overlays; camera sync
 * on; always-on reset; `colorbar: "never"` for the shared false-color
 * mechanism — the Pane renders its own contextual "values" colorbar
 * directly; `maxPanes: 4` + `webglContextsPerPane: 1` preserve the
 * pre-refactor `MAX_PANES` WebGL budget mitigation).
 */
export const meshViewportCapabilities: ViewportCapabilities<MeshNativeMode> = {
  coreModes: ["normal", "side", "split", "blend", "diff"],
  nativeModes: [
    {
      mode: "diff-property",
      label: "Diff: property (native)",
      enabledFor: topologyMatches,
      disabledReason: "Native diff modes need matching mesh topology (same vertex/face counts) — disabled for this pair",
    },
    {
      mode: "diff-geometry",
      label: "Diff: geometry (native)",
      enabledFor: topologyMatches,
      disabledReason: "Native diff modes need matching mesh topology (same vertex/face counts) — disabled for this pair",
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
  // Mesh artifacts are on-disk `.npz` blobs (mime `application/octet-stream`,
  // which the shared MIME table can only resolve to a generic `.bin`) —
  // matches the old MeshCard's `artifactFilename(..., ".npz")` call.
  downloadExtension: ".npz",
};

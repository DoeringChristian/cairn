import MeshViewer, {
  resolveMeshColorMode,
  type MeshBackground,
  type MeshColorMode,
  type MeshShading,
} from "../three/MeshViewer";
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
  has_face_colors?: boolean;
  /** 3 (RGB) or 4 (RGBA); present only when `has_face_colors`. */
  face_color_channels?: number;
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
    faceColors: Float32Array | null;
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
  /** Persisted "Show axes" setting (WS-3DR2) — colored XYZ origin lines +
   *  grid, sized off the fitted bounds. `undefined` (old persisted cards) =
   *  off, matching pre-WS-3DR2 rendering. */
  showAxes?: boolean;
  /** Persisted "Show planes" setting (#69 S2) — XY/YZ/XZ reference planes. */
  showPlanes?: boolean;
  /** Persisted camera orientation mode (#69 S1). `undefined` = "orbital". */
  cameraMode?: Scene3DCameraMode;
}

interface MeshViewConfig {
  colorMode: MeshColorMode;
  shading: MeshShading;
  wireframe: boolean;
  doubleSided: boolean;
  background: MeshBackground;
  property: string | null;
  showAxes: boolean;
  showPlanes: boolean;
  cameraMode: Scene3DCameraMode;
}

function resolveViewConfig(settings: MeshViewportSettings): MeshViewConfig {
  return {
    colorMode: settings.colorMode,
    shading: settings.shading,
    wireframe: settings.wireframe,
    doubleSided: settings.doubleSided,
    background: settings.background,
    property: settings.property ?? null,
    showAxes: settings.showAxes ?? false,
    showPlanes: settings.showPlanes ?? false,
    cameraMode: settings.cameraMode ?? "orbital",
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
  colorRange,
}: {
  item: MeshViewportItem | null;
  view: MeshViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onFrame?: (canvas: HTMLCanvasElement) => void;
  /** Card-level unified value range (WS-VCP fix 4) — overrides this item's
   *  own autoscaled `active.range` when the "values" color mode is active,
   *  so coloring matches the card's single colorbar. `null`/absent = fall
   *  back to per-item autoscale (e.g. no card-level colorbar applies). */
  colorRange?: [number, number] | null;
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
  const resolvedMode = resolveMeshColorMode(
    view.colorMode,
    !!arrays.colors,
    !!active.values,
    !!arrays.faceColors,
  );
  const valueRange = resolvedMode === "values" ? (colorRange ?? active.range) : active.range;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded bg-bg">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="min-w-0 flex-1">
          <MeshViewer
            positions={arrays.positions}
            faces={arrays.faces}
            nVertices={meta.n_vertices}
            nFaces={meta.n_faces}
            values={active.values}
            valueRange={valueRange}
            colors={arrays.colors}
            faceColors={arrays.faceColors}
            normals={arrays.normals}
            bounds={meta.bounds}
            colorMode={view.colorMode}
            shading={view.shading}
            wireframe={view.wireframe}
            doubleSided={view.doubleSided}
            background={view.background}
            showAxes={view.showAxes}
          showPlanes={view.showPlanes}
          cameraMode={view.cameraMode}
            sync={sync}
            onFrame={onFrame}
          />
        </div>
      </div>
      {/* Per-pane metadata caption (restored — dropped when WS-VC5 migrated
          off the bespoke MeshCard; boxes3d kept its equivalent
          ("N of M boxes · kind") through the migration, mesh's/volume's
          didn't). Mirrors the pre-VC5 MeshCard.tsx caption verbatim
          (vertex/face counts + the active property name, when any).
          Pinned top-left (not bottom-left, `absolute`/`pointer-events-none`
          like `LabelChip`) so it never collides with the bottom-left
          draggable `LabelChip` — both used to sit in that same corner. */}
      <div className="pointer-events-none absolute left-1 top-1 z-10 mono rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-subtle backdrop-blur-sm">
        {`${meta.n_vertices.toLocaleString()} verts · ${meta.n_faces.toLocaleString()} faces`}
        {active.name ? ` · ${active.name}` : ""}
      </div>
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
  colorRange,
}: {
  item: MeshViewportItem | null;
  reference: MeshViewportItem | null;
  view: MeshViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** See `MeshSingleView`'s identical doc comment (WS-VCP fix 4) — threaded
   *  to BOTH the ref and run viewer below so they color identically. */
  colorRange?: [number, number] | null;
}) {
  // WS-VCP fix 3: the ref+run pair below must ALWAYS mirror each other's
  // orbit/zoom/pan, even when the card-level "Sync 3D views" toggle is off
  // (`sync` null) — only cross-pair/cross-card linking is gated by that
  // toggle. `pairedSync` is `sync` unchanged when non-null (so the pair
  // still joins the wider group), else a per-mount fallback group shared
  // by just this pane's two viewers.
  const pairedSync = usePairedSideBySideSync(sync);
  if (!reference) {
    return (
      <MeshSingleView
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
  const refResolvedMode = resolveMeshColorMode(
    view.colorMode,
    !!reference.arrays.colors,
    !!refActive.values,
    !!reference.arrays.faceColors,
  );
  const refValueRange = refResolvedMode === "values" ? (colorRange ?? refActive.range) : refActive.range;
  return (
    <div className="flex h-full w-full gap-0.5">
      <div className="relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg">
        <MeshViewer
          positions={reference.arrays.positions}
          faces={reference.arrays.faces}
          nVertices={reference.meta.n_vertices}
          nFaces={reference.meta.n_faces}
          values={refActive.values}
          valueRange={refValueRange}
          colors={reference.arrays.colors}
          faceColors={reference.arrays.faceColors}
          normals={reference.arrays.normals}
          bounds={reference.meta.bounds}
          colorMode={view.colorMode}
          shading={view.shading}
          wireframe={view.wireframe}
          doubleSided={view.doubleSided}
          background={view.background}
          showAxes={view.showAxes}
          showPlanes={view.showPlanes}
          cameraMode={view.cameraMode}
          sync={pairedSync}
        />
        <LabelChip label="REF" />
      </div>
      <div className="relative flex-1 min-w-0 overflow-hidden rounded bg-bg">
        {item ? (() => {
          const active = resolveActiveProperty(item.arrays.properties, view.property, item.meta.properties ?? null);
          const resolvedMode = resolveMeshColorMode(
            view.colorMode,
            !!item.arrays.colors,
            !!active.values,
            !!item.arrays.faceColors,
          );
          const valueRange = resolvedMode === "values" ? (colorRange ?? active.range) : active.range;
          return (
            <MeshViewer
              positions={item.arrays.positions}
              faces={item.arrays.faces}
              nVertices={item.meta.n_vertices}
              nFaces={item.meta.n_faces}
              values={active.values}
              valueRange={valueRange}
              colors={item.arrays.colors}
              faceColors={item.arrays.faceColors}
              normals={item.arrays.normals}
              bounds={item.meta.bounds}
              colorMode={view.colorMode}
              shading={view.shading}
              wireframe={view.wireframe}
              doubleSided={view.doubleSided}
              background={view.background}
              showAxes={view.showAxes}
          showPlanes={view.showPlanes}
          cameraMode={view.cameraMode}
              sync={pairedSync}
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
  colorRange,
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

  // WS-VCP fix 4: color against the card-level UNIFIED diff domain when
  // supplied (every diff pane on the card then shares one scale), else fall
  // back to this pane's own autoscaled domain.
  const domain = colorRange ?? diffDomain(deltaValues, diffColormap);
  const colors = diffColorsForDomain(deltaValues, data.meta.n_vertices, domain, diffColormap);

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
          showAxes={view.showAxes}
          showPlanes={view.showPlanes}
          cameraMode={view.cameraMode}
          sync={sync}
        />
      </div>
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
 * `ViewportModule.activeColorbar` (WS-VCP fix 4) — the SINGLE card-level
 * colorbar for mesh: under a native diff mode, unions every valid pane's
 * diff domain (`unionDiffDomain`); otherwise, when "values" coloring is
 * selected, unions the active property's range across every foreground +
 * reference item currently resolved. `null` (no colorbar) for "solid"/
 * "vertex-colors" coloring, or when nothing currently has a resolvable
 * domain (e.g. every pair topology-mismatched, or no property values
 * logged).
 */
export function meshActiveColorbar(args: {
  items: (MeshViewportItem | null)[];
  referenceItems: (MeshViewportItem | null)[];
  settings: MeshViewportSettings;
  mode: MediaCompareModeKind;
  nativeMode?: string;
}): { colormap: ColormapName; min: number; max: number } | null {
  const { items, referenceItems, settings, nativeMode } = args;
  const property = settings.property ?? null;
  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";

  if (nativeMode === "diff-property" || nativeMode === "diff-geometry") {
    const domains: [number, number][] = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const b = referenceItems[i];
      if (!a || !b) continue;
      if (a.meta.n_vertices !== b.meta.n_vertices || a.meta.n_faces !== b.meta.n_faces) continue;
      let delta: Float32Array | null = null;
      if (nativeMode === "diff-geometry") {
        delta = computeDisplacementMagnitude(a.arrays.positions, b.arrays.positions, a.meta.n_vertices);
      } else {
        const activeA = resolveActiveProperty(a.arrays.properties, property, a.meta.properties ?? null);
        const activeB = resolveActiveProperty(b.arrays.properties, property, b.meta.properties ?? null);
        if (activeA.values && activeB.values) delta = computeDelta(activeA.values, activeB.values, a.meta.n_vertices);
      }
      if (delta) domains.push(diffDomain(delta, diffColormap));
    }
    const union = unionDiffDomain(domains, diffColormap);
    return union ? { colormap: diffColormap, min: union[0], max: union[1] } : null;
  }

  if (settings.colorMode !== "values") return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const it of [...items, ...referenceItems]) {
    if (!it) continue;
    const active = resolveActiveProperty(it.arrays.properties, property, it.meta.properties ?? null);
    if (active.values && active.range) {
      lo = Math.min(lo, active.range[0]);
      hi = Math.max(hi, active.range[1]);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { colormap: "viridis", min: lo, max: hi };
}

/**
 * MeshViewport's capability descriptor — mirrors
 * `pointCloudViewportCapabilities` exactly (all five core modes via the
 * app-layer Pane's split/blend/diff -> `OffscreenComparePanes` bridge, plus
 * the two native geometry diffs; no post-processing/overlays; camera sync
 * on; always-on reset; `colorbar: "never"` for the shared false-color
 * mechanism — the card renders ONE colorbar via `meshActiveColorbar`
 * (WS-VCP fix 4) instead; `maxPanes: 4` + `webglContextsPerPane: 1` preserve the
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
  crossTypeCompare: true,
  webglContextsPerPane: 1,
  maxPanes: 4,
  label: { placement: "bottom-left", draggable: true },
  // Mesh artifacts are on-disk `.npz` blobs (mime `application/octet-stream`,
  // which the shared MIME table can only resolve to a generic `.bin`) —
  // matches the old MeshCard's `artifactFilename(..., ".npz")` call.
  downloadExtension: ".npz",
};

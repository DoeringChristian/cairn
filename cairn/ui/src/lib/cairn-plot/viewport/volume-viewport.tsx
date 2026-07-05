import VolumeViewer, {
  type VolumeBackground,
  type VolumeQuality,
  type VolumeRenderMode,
} from "../three/VolumeViewer";
import type { Scene3DSyncOptions } from "../three/use-scene3d";
import { absArray, computeDelta, diffDomain, type DiffColormap } from "../three/diff";
import type { PropertyMeta } from "../three/properties";
import { Colorbar, LabelChip } from "../primitives";
import type { ColormapName } from "../types";
import type { ViewportCapabilities, ViewportPaneProps, ViewState } from "./types";

// ---------------------------------------------------------------------------
// VolumeViewport — the volume object_type's PURE Viewport pieces (WS-VC5,
// mirrors mesh/pointcloud/boxes). Wraps the EXISTING `VolumeViewer` (the
// WebGL2 raymarch shader, built on `useScene3D`) — no rendering or diff math
// is rewritten, only adapted to the Viewport Pane/nativeDiff contract:
//
//   - `VolumeSingleView`     — mode "normal": one live raymarched viewer +
//     always-on Colorbar (spec §1.2: Volume's colorbar is "always").
//   - `VolumeSideBySideView` — mode "side": reference | foreground.
//   - `VolumeNativeDiffPane` — the card-native diff-value mode (a signed
//     per-voxel diff volume raymarched through the SAME shader), verbatim
//     from the pre-refactor `VolumeCard`'s `VolumeComparePane` native branch.
//
// split/blend/diff live in the app-layer Pane (components/VolumeVisualCard.tsx)
// via OffscreenComparePanes.
// ---------------------------------------------------------------------------

/** Volume metadata (`artifact_metadata` JSON) — same shape the pre-refactor
 *  `VolumeCard` used (`VolumeMeta`), relocated. */
export interface VolumeMeta {
  shape: [number, number, number]; // [D, H, W]
  dtype: string;
  vmin: number;
  vmax: number;
  mean: number;
  spacing: [number, number, number];
  origin: [number, number, number];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  properties?: PropertyMeta[];
  size_bytes: number;
}

/** VolumeViewport's `TData`: one pane's flat float32 grid + its metadata. */
export interface VolumeViewportItem {
  arrays: { data: Float32Array };
  meta: VolumeMeta;
}

/** VolumeViewport's `TView` — reserved `camera3d` shape (not prop-driven). */
export type VolumeViewState = Extract<ViewState, { kind: "camera3d" }>;

/** Card-native compare kinds this type appends to the shared core five. */
export type VolumeNativeMode = "diff-value";

/** VolumeViewport's `TSettings` requirement — the narrow subset this file's
 *  pure components read. */
export interface VolumeViewportSettings {
  /** Raymarch render mode. Named `renderMode` (NOT `mode`) so the app-layer
   *  `VolumeFullSettings` — whose `mode` is the shared compare mode
   *  (MediaCompareModeKind) owned by VisualContentCard — structurally
   *  satisfies this interface without a field collision. */
  renderMode: VolumeRenderMode;
  isovalue: number;
  colormap: ColormapName;
  steps: VolumeQuality;
  clipMin: [number, number, number];
  clipMax: [number, number, number];
  background: VolumeBackground;
  diffColormap?: DiffColormap;
}

interface VolumeViewConfig {
  mode: VolumeRenderMode;
  isovalue: number;
  colormap: ColormapName;
  steps: VolumeQuality;
  clipMin: [number, number, number];
  clipMax: [number, number, number];
  background: VolumeBackground;
}

export function resolveVolumeViewConfig(settings: VolumeViewportSettings): VolumeViewConfig {
  return {
    mode: settings.renderMode,
    isovalue: settings.isovalue,
    colormap: settings.colormap,
    steps: settings.steps,
    clipMin: settings.clipMin,
    clipMax: settings.clipMax,
    background: settings.background,
  };
}

/** mode "normal" — one live raymarched viewer + always-on colorbar, moved
 *  verbatim from the pre-refactor `VolumeCard`'s `VolumeBody`. */
export function VolumeSingleView({
  item,
  view,
  sync,
  label,
  isDraggable,
  onDragStart,
  onFrame,
}: {
  item: VolumeViewportItem | null;
  view: VolumeViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onFrame?: (canvas: HTMLCanvasElement) => void;
}) {
  if (!item) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted">
        no volume logged yet
      </div>
    );
  }
  const { arrays, meta } = item;
  return (
    <div className="relative flex h-full w-full overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1 overflow-hidden rounded bg-bg">
        <VolumeViewer
          data={arrays.data}
          shape={meta.shape}
          spacing={meta.spacing}
          origin={meta.origin}
          vmin={meta.vmin}
          vmax={meta.vmax}
          mode={view.mode}
          isovalue={view.isovalue}
          colormap={view.colormap}
          steps={view.steps}
          clip={{ min: view.clipMin, max: view.clipMax }}
          background={view.background}
          sync={sync}
          onFrame={onFrame}
        />
      </div>
      <Colorbar colormap={view.colormap} min={meta.vmin} max={meta.vmax} />
      <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
    </div>
  );
}

/** mode "side" — reference | foreground, two live viewers sharing `sync`. */
export function VolumeSideBySideView({
  item,
  reference,
  view,
  sync,
  label,
  isDraggable,
  onDragStart,
}: {
  item: VolumeViewportItem | null;
  reference: VolumeViewportItem | null;
  view: VolumeViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  if (!reference) {
    return (
      <VolumeSingleView
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
        <VolumeViewer
          data={reference.arrays.data}
          shape={reference.meta.shape}
          spacing={reference.meta.spacing}
          origin={reference.meta.origin}
          vmin={reference.meta.vmin}
          vmax={reference.meta.vmax}
          mode={view.mode}
          isovalue={view.isovalue}
          colormap={view.colormap}
          steps={view.steps}
          clip={{ min: view.clipMin, max: view.clipMax }}
          background={view.background}
          sync={sync}
        />
        <LabelChip label="REF" />
      </div>
      <div className="relative flex-1 min-w-0 overflow-hidden rounded bg-bg">
        {item ? (
          <VolumeSingleView
            item={item}
            view={view}
            sync={sync}
            label={label}
            isDraggable={isDraggable}
            onDragStart={onDragStart}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">
            no volume logged yet
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * `ViewportModule.nativeDiff.render` — the card-native diff-value mode, moved
 * verbatim (math + shape gating) from the pre-refactor `VolumeCard`'s
 * `VolumeComparePane` native branch. Requires the same voxel grid shape.
 */
export function VolumeNativeDiffPane({
  data,
  reference,
  settings,
  cameraSyncGroupId,
  label,
  isDraggable,
  onDragStart,
}: ViewportPaneProps<VolumeViewportItem, VolumeViewState, VolumeViewportSettings>) {
  const sync: Scene3DSyncOptions | null = cameraSyncGroupId ? { groupId: cameraSyncGroupId } : null;
  const view = resolveVolumeViewConfig(settings);

  if (!data || !reference) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse">
        loading…
      </div>
    );
  }

  const topologyOk =
    data.meta.shape[0] === reference.meta.shape[0] &&
    data.meta.shape[1] === reference.meta.shape[1] &&
    data.meta.shape[2] === reference.meta.shape[2];
  if (!topologyOk) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        Shape mismatch: {data.meta.shape.join("×")} vs {reference.meta.shape.join("×")} — native
        diff needs matching voxel grid shape.
      </div>
    );
  }

  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";
  const n = data.meta.shape[0] * data.meta.shape[1] * data.meta.shape[2];
  const delta = computeDelta(data.arrays.data, reference.arrays.data, n);
  const domain = diffDomain(delta, diffColormap);
  const diffData = diffColormap === "viridis" ? absArray(delta) : delta;

  return (
    <div className="relative flex h-full w-full overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1 overflow-hidden rounded bg-bg">
        <VolumeViewer
          data={diffData}
          shape={data.meta.shape}
          spacing={data.meta.spacing}
          origin={data.meta.origin}
          vmin={domain[0]}
          vmax={domain[1]}
          mode={view.mode}
          isovalue={view.isovalue}
          colormap={diffColormap as ColormapName}
          steps={view.steps}
          clip={{ min: view.clipMin, max: view.clipMax }}
          background={view.background}
          sync={sync}
        />
      </div>
      <Colorbar colormap={diffColormap} min={domain[0]} max={domain[1]} />
      <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
    </div>
  );
}

function shapeMatches(content: unknown, reference: unknown): boolean {
  const a = content as VolumeViewportItem | null;
  const b = reference as VolumeViewportItem | null;
  if (!a || !b) return false;
  return (
    a.meta.shape[0] === b.meta.shape[0] &&
    a.meta.shape[1] === b.meta.shape[1] &&
    a.meta.shape[2] === b.meta.shape[2]
  );
}

/**
 * VolumeViewport's capability descriptor — mirrors the other 3D types, with
 * `colorbar: "always"` (spec §1.2: Volume's colorbar is always shown; the
 * Pane renders it directly). One native diff-value mode (matching voxel grid
 * shape). `maxPanes: 4` + `webglContextsPerPane: 1` WebGL budget parity.
 */
export const volumeViewportCapabilities: ViewportCapabilities<VolumeNativeMode> = {
  coreModes: ["normal", "side", "split", "blend", "diff"],
  nativeModes: [
    {
      mode: "diff-value",
      label: "Diff: value (native)",
      enabledFor: shapeMatches,
      disabledReason: "Native diff needs the same voxel grid shape — disabled for this pair",
    },
  ],
  hasSteps: true,
  postProcessing: false,
  overlays: false,
  colorbar: "always",
  cameraSync: true,
  resetView: "always",
  crossTypeCompare: true,
  webglContextsPerPane: 1,
  maxPanes: 4,
  label: { placement: "bottom-left", draggable: true },
  // Volume artifacts are on-disk `.npz` blobs (mime `application/
  // octet-stream`) — matches the old VolumeCard's `artifactFilename(...,
  // ".npz")` call.
  downloadExtension: ".npz",
};

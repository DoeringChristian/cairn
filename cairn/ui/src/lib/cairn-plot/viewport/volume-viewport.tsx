import VolumeViewer, {
  type VolumeBackground,
  type VolumeQuality,
  type VolumeRenderMode,
} from "../three/VolumeViewer";
import { usePairedSideBySideSync, type Scene3DCameraMode, type Scene3DSyncOptions } from "../three/use-scene3d";
import { absArray, computeDelta, diffDomain, unionDiffDomain, type DiffColormap } from "../three/diff";
import type { PropertyMeta } from "../three/properties";
import { LabelChip } from "../primitives";
import type { ColormapName } from "../types";
import type { MediaCompareModeKind } from "../media-compare/mode";
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
  /** Persisted "Show axes" setting (WS-3DR2). */
  showAxes?: boolean;
  /** Persisted "Show planes" setting (#69 S2) — XY/YZ/XZ reference planes. */
  showPlanes?: boolean;
  /** Persisted camera orientation mode (#69 S1). `undefined` = "orbital". */
  cameraMode?: Scene3DCameraMode;
}

interface VolumeViewConfig {
  mode: VolumeRenderMode;
  isovalue: number;
  colormap: ColormapName;
  steps: VolumeQuality;
  clipMin: [number, number, number];
  clipMax: [number, number, number];
  background: VolumeBackground;
  showAxes: boolean;
  showPlanes: boolean;
  cameraMode: Scene3DCameraMode;
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
    showAxes: settings.showAxes ?? false,
    showPlanes: settings.showPlanes ?? false,
    cameraMode: settings.cameraMode ?? "orbital",
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
  colorRange,
}: {
  item: VolumeViewportItem | null;
  view: VolumeViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onFrame?: (canvas: HTMLCanvasElement) => void;
  /** Card-level unified value range (WS-VCP fix 4) — overrides this item's
   *  own `meta.vmin`/`vmax` so every pane's raymarch normalizes against the
   *  SAME domain (matching the card's single always-on colorbar) instead of
   *  each item's own data range. `null`/absent = fall back to this item's
   *  own `vmin`/`vmax` (e.g. only one pane resolved so far). */
  colorRange?: [number, number] | null;
}) {
  if (!item) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted">
        no volume logged yet
      </div>
    );
  }
  const { arrays, meta } = item;
  const [vmin, vmax] = colorRange ?? [meta.vmin, meta.vmax];
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded bg-bg">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden rounded bg-bg">
          <VolumeViewer
            data={arrays.data}
            shape={meta.shape}
            spacing={meta.spacing}
            origin={meta.origin}
            vmin={vmin}
            vmax={vmax}
            mode={view.mode}
            isovalue={view.isovalue}
            colormap={view.colormap}
            steps={view.steps}
            clip={{ min: view.clipMin, max: view.clipMax }}
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
          off the bespoke VolumeCard; boxes3d kept its equivalent through the
          migration, mesh's/volume's didn't). Mirrors the pre-VC5
          VolumeCard.tsx caption verbatim (voxel shape + this pane's OWN
          blob's data range — not the card-unified `colorRange`, so the
          caption always reflects what's actually in this artifact).
          Pinned top-left (not bottom-left) so it never collides with the
          bottom-left draggable `LabelChip` — see mesh-viewport.tsx's
          identical fix for the shared rationale. */}
      <div className="pointer-events-none absolute left-1 top-1 z-10 mono rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-subtle backdrop-blur-sm">
        {`${meta.shape.join("×")} · vmin ${meta.vmin.toFixed(3)} · vmax ${meta.vmax.toFixed(3)}`}
      </div>
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
  colorRange,
}: {
  item: VolumeViewportItem | null;
  reference: VolumeViewportItem | null;
  view: VolumeViewConfig;
  sync: Scene3DSyncOptions | null;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** See `VolumeSingleView`'s identical doc comment (WS-VCP fix 4) — threaded
   *  to BOTH the ref and run viewer below so they raymarch against the SAME
   *  normalized domain. */
  colorRange?: [number, number] | null;
}) {
  // WS-VCP fix 3 — see MeshSideBySideView's identical comment: the ref+run
  // pair always mirrors each other, independent of the card-level toggle.
  const pairedSync = usePairedSideBySideSync(sync);
  if (!reference) {
    return (
      <VolumeSingleView
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
  const [refVmin, refVmax] = colorRange ?? [reference.meta.vmin, reference.meta.vmax];
  return (
    <div className="flex h-full w-full gap-0.5">
      <div className="relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg">
        <VolumeViewer
          data={reference.arrays.data}
          shape={reference.meta.shape}
          spacing={reference.meta.spacing}
          origin={reference.meta.origin}
          vmin={refVmin}
          vmax={refVmax}
          mode={view.mode}
          isovalue={view.isovalue}
          colormap={view.colormap}
          steps={view.steps}
          clip={{ min: view.clipMin, max: view.clipMax }}
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
          <VolumeSingleView
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
  colorRange,
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
  // WS-VCP fix 4: normalize against the card-level UNIFIED diff domain when
  // supplied, else fall back to this pane's own autoscaled domain. Unlike
  // mesh/pointcloud/boxes (precomputed per-element RGB), the raymarch shader
  // itself normalizes by `vmin`/`vmax` — no separate recolor step needed.
  const domain = colorRange ?? diffDomain(delta, diffColormap);
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
 * `ViewportModule.activeColorbar` (WS-VCP fix 4) — the SINGLE card-level
 * colorbar for volume: under the native diff-value mode, unions every valid
 * pane's diff domain (`unionDiffDomain`) with `settings.diffColormap`;
 * otherwise (volume's colorbar is unconditionally "always" — spec §1.2)
 * unions `meta.vmin`/`vmax` across every foreground + reference item
 * currently resolved, with the single card-wide `settings.colormap`. `null`
 * only when NOTHING has resolved yet (no items at all).
 */
export function volumeActiveColorbar(args: {
  items: (VolumeViewportItem | null)[];
  referenceItems: (VolumeViewportItem | null)[];
  settings: VolumeViewportSettings;
  mode: MediaCompareModeKind;
  nativeMode?: string;
}): { colormap: ColormapName; min: number; max: number } | null {
  const { items, referenceItems, settings, nativeMode } = args;

  if (nativeMode === "diff-value") {
    const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";
    const domains: [number, number][] = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const b = referenceItems[i];
      if (!a || !b) continue;
      if (a.meta.shape[0] !== b.meta.shape[0] || a.meta.shape[1] !== b.meta.shape[1] || a.meta.shape[2] !== b.meta.shape[2]) continue;
      const n = a.meta.shape[0] * a.meta.shape[1] * a.meta.shape[2];
      const delta = computeDelta(a.arrays.data, b.arrays.data, n);
      domains.push(diffDomain(delta, diffColormap));
    }
    const union = unionDiffDomain(domains, diffColormap);
    return union ? { colormap: diffColormap, min: union[0], max: union[1] } : null;
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const it of [...items, ...referenceItems]) {
    if (!it) continue;
    lo = Math.min(lo, it.meta.vmin);
    hi = Math.max(hi, it.meta.vmax);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { colormap: settings.colormap, min: lo, max: hi };
}

/**
 * VolumeViewport's capability descriptor — mirrors the other 3D types.
 * `colorbar: "never"` here means the SAME thing it means for mesh/pointcloud/
 * boxes: "never" for the SHARED `settings.colormap`-driven false-color
 * mechanism (that select/colorbar pair is image-specific plumbing — see
 * VisualContentCard's `headerActions`/footer). Volume's colorbar is
 * unconditionally "always" in the actual UI (spec §1.2), but that's now
 * `volumeActiveColorbar` (WS-VCP fix 4), a wholly separate mechanism — NOT
 * gated by this field. (Before fix 4, this WAS "always", which — because
 * `VolumeFullSettings.colormap` structurally reuses `VisualCompareSettings`'
 * `colormap` field name for volume's OWN raymarch colormap — accidentally
 * ALSO lit up the image-only false-color `<select>`/`<Colorbar>` for volume
 * cards: a real "extra card-level colorbar" bug, now fixed by decoupling the
 * two mechanisms entirely.) One native diff-value mode (matching voxel grid
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
  colorbar: "never",
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

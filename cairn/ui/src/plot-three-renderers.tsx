/**
 * The three.js 3D standalone adapters — the renderers the **three addon**
 * (`plot-three-addon.tsx` → `three.iife.js`) carries. It wires FOUR:
 * `PointCloudStandalone` (G3a) + `MeshStandalone` / `VolumeStandalone` /
 * `BoxesStandalone` (G3b). Each STATICALLY imports its pure `*SingleView`
 * (and thus its viewer + `three`, ~600K shared), so this module is a sole
 * three.js entry point and three lives ONLY in the addon bundle — never in
 * core.
 *
 * `ChartBox` comes from `plot-standalone-helpers` (dependency-light) rather than
 * `plot-renderers`, so importing this module does NOT drag the 2D renderers into
 * the addon bundle — same discipline as `plot-figure-renderer.tsx`.
 *
 * Each pure `*SingleView` (offline-safe: only ResizeObserver/rAF/WebGL2, no app
 * deps) receives an already-resolved `{arrays, meta}` item from the descriptor's
 * `npz` DataSpec (`resolveDataProps` → `p.item`), supplies a default standalone
 * view config, and mounts. `sync={null}` — a standalone plot has no camera-sync
 * group. The default view configs mirror the app cards' `default*Settings()`
 * (resolved through each viewport's `resolve*ViewConfig`), with any field
 * overridable via the descriptor's `props`.
 */
import { PointCloudSingleView } from "./lib/cairn-plot/viewport/pointcloud-viewport";
import { MeshSingleView } from "./lib/cairn-plot/viewport/mesh-viewport";
import { VolumeSingleView } from "./lib/cairn-plot/viewport/volume-viewport";
import { BoxesSingleView } from "./lib/cairn-plot/viewport/boxes-viewport";
import { ChartBox } from "./plot-standalone-helpers";

type P = Record<string, any>;

/** The standalone default view config for a point cloud. `colorMode:"auto"`
 *  lets the viewer pick rgb / category / height from the channels; the point
 *  size and dark background match the app card's sensible defaults. Any field
 *  is overridable via the descriptor's `props`. */
const DEFAULT_POINTCLOUD_VIEW = {
  pointSize: 0.02,
  colorMode: "auto" as const,
  background: "dark" as const,
  property: null,
  showAxes: false,
  showPlanes: false,
  cameraMode: "orbital" as const,
};

export function PointCloudStandalone(p: P) {
  const { height, item, ...rest } = p;
  const view = {
    ...DEFAULT_POINTCLOUD_VIEW,
    ...(typeof rest.pointSize === "number" ? { pointSize: rest.pointSize } : {}),
    ...(rest.colorMode ? { colorMode: rest.colorMode } : {}),
    ...(rest.background ? { background: rest.background } : {}),
    ...(rest.property !== undefined ? { property: rest.property } : {}),
    ...(rest.showAxes !== undefined ? { showAxes: rest.showAxes } : {}),
    ...(rest.showPlanes !== undefined ? { showPlanes: rest.showPlanes } : {}),
    ...(rest.cameraMode ? { cameraMode: rest.cameraMode } : {}),
  };
  return (
    <ChartBox height={height}>
      <PointCloudSingleView
        item={item ?? null}
        view={view}
        sync={null}
        label={rest.label ?? ""}
      />
    </ChartBox>
  );
}

/** The standalone default view config for a mesh — mirrors the app card's
 *  `defaultMeshSettings()` (solid/smooth/dark, no wireframe, double-sided).
 *  `property:null` lets the viewer auto-pick the first available scalar when
 *  `colorMode:"values"`; any field is overridable via the descriptor's
 *  `props`. */
const DEFAULT_MESH_VIEW = {
  colorMode: "solid" as const,
  shading: "smooth" as const,
  wireframe: false,
  doubleSided: true,
  background: "dark" as const,
  property: null as string | null,
  showAxes: false,
  showPlanes: false,
  cameraMode: "orbital" as const,
};

export function MeshStandalone(p: P) {
  const { height, item, ...rest } = p;
  const view = {
    ...DEFAULT_MESH_VIEW,
    ...(rest.colorMode ? { colorMode: rest.colorMode } : {}),
    ...(rest.shading ? { shading: rest.shading } : {}),
    ...(rest.wireframe !== undefined ? { wireframe: rest.wireframe } : {}),
    ...(rest.doubleSided !== undefined ? { doubleSided: rest.doubleSided } : {}),
    ...(rest.background ? { background: rest.background } : {}),
    ...(rest.property !== undefined ? { property: rest.property } : {}),
    ...(rest.showAxes !== undefined ? { showAxes: rest.showAxes } : {}),
    ...(rest.showPlanes !== undefined ? { showPlanes: rest.showPlanes } : {}),
    ...(rest.cameraMode ? { cameraMode: rest.cameraMode } : {}),
  };
  return (
    <ChartBox height={height}>
      <MeshSingleView
        item={item ?? null}
        view={view}
        sync={null}
        label={rest.label ?? ""}
      />
    </ChartBox>
  );
}

/** The standalone default view config for a volume — mirrors the app card's
 *  `defaultVolumeSettings()` (MIP raymarch, viridis, 128 steps, no clip, dark
 *  background). Any field is overridable via the descriptor's `props`. Note
 *  the config field is `mode` (the render mode), NOT the compare mode. */
const DEFAULT_VOLUME_VIEW = {
  mode: "mip" as const,
  isovalue: 0.5,
  colormap: "viridis" as const,
  steps: 128 as const,
  clipMin: [0, 0, 0] as [number, number, number],
  clipMax: [1, 1, 1] as [number, number, number],
  background: "dark" as const,
  showAxes: false,
  showPlanes: false,
  cameraMode: "orbital" as const,
};

export function VolumeStandalone(p: P) {
  const { height, item, ...rest } = p;
  const view = {
    ...DEFAULT_VOLUME_VIEW,
    ...(rest.mode ? { mode: rest.mode } : {}),
    ...(typeof rest.isovalue === "number" ? { isovalue: rest.isovalue } : {}),
    ...(rest.colormap ? { colormap: rest.colormap } : {}),
    ...(rest.steps ? { steps: rest.steps } : {}),
    ...(rest.clipMin ? { clipMin: rest.clipMin } : {}),
    ...(rest.clipMax ? { clipMax: rest.clipMax } : {}),
    ...(rest.background ? { background: rest.background } : {}),
    ...(rest.showAxes !== undefined ? { showAxes: rest.showAxes } : {}),
    ...(rest.showPlanes !== undefined ? { showPlanes: rest.showPlanes } : {}),
    ...(rest.cameraMode ? { cameraMode: rest.cameraMode } : {}),
  };
  return (
    <ChartBox height={height}>
      <VolumeSingleView
        item={item ?? null}
        view={view}
        sync={null}
        label={rest.label ?? ""}
      />
    </ChartBox>
  );
}

/** The standalone default view config for boxes — mirrors the app card's
 *  `defaultBoxesSettings()` (depth coloring, dark background). `property:null`
 *  auto-picks the first scalar in "value" mode; any field is overridable via
 *  the descriptor's `props`. */
const DEFAULT_BOXES_VIEW = {
  colorMode: "depth" as const,
  background: "dark" as const,
  property: null as string | null,
  showAxes: false,
  showPlanes: false,
  cameraMode: "orbital" as const,
};

export function BoxesStandalone(p: P) {
  const { height, item, ...rest } = p;
  const view = {
    ...DEFAULT_BOXES_VIEW,
    ...(rest.colorMode ? { colorMode: rest.colorMode } : {}),
    ...(rest.background ? { background: rest.background } : {}),
    ...(rest.property !== undefined ? { property: rest.property } : {}),
    ...(rest.showAxes !== undefined ? { showAxes: rest.showAxes } : {}),
    ...(rest.showPlanes !== undefined ? { showPlanes: rest.showPlanes } : {}),
    ...(rest.cameraMode ? { cameraMode: rest.cameraMode } : {}),
    ...(typeof rest.depthMin === "number" ? { depthMin: rest.depthMin } : {}),
    ...(typeof rest.depthMax === "number" ? { depthMax: rest.depthMax } : {}),
  };
  return (
    <ChartBox height={height}>
      <BoxesSingleView
        item={item ?? null}
        view={view}
        sync={null}
        label={rest.label ?? ""}
      />
    </ChartBox>
  );
}

export default PointCloudStandalone;

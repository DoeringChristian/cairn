/**
 * The three.js 3D standalone adapters — the renderers the **three addon**
 * (`plot-three-addon.tsx` → `three.iife.js`) carries. G3a wires ONE:
 * `PointCloudStandalone`. It STATICALLY imports `PointCloudSingleView` (and thus
 * `PointCloudViewer` + `three`, ~600K), so this module is a sole three.js entry
 * point and three lives ONLY in the addon bundle — never in core.
 *
 * `ChartBox` comes from `plot-standalone-helpers` (dependency-light) rather than
 * `plot-renderers`, so importing this module does NOT drag the 2D renderers into
 * the addon bundle — same discipline as `plot-figure-renderer.tsx`.
 *
 * The pure `PointCloudSingleView` (offline-safe: only ResizeObserver/rAF/WebGL2,
 * no app deps) receives an already-resolved `{arrays, meta}` item from the
 * descriptor's `npz` DataSpec (`resolveDataProps` → `p.item`), supplies a
 * default standalone view config, and mounts. `sync={null}` — a standalone plot
 * has no camera-sync group.
 *
 * G3b registers `mesh`/`volume`/`boxes3d` the same way (their own standalone
 * adapters, same addon bundle).
 */
import { PointCloudSingleView } from "./lib/cairn-plot/viewport/pointcloud-viewport";
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

export default PointCloudStandalone;

import {
  CrossTypeForeignFrame as LibCrossTypeForeignFrame,
  hasForeignFrameBridge as libHasForeignFrameBridge,
  type ForeignFrameLoaders,
  type ForeignFrameProps,
} from "@cairn-plot/lib/cairn-plot/media-compare";
import type { FrameSource } from "@cairn-plot/lib/cairn-plot/viewport/types";

// App binding for the lib WS-VC6 cross-type bridge: supplies the concrete
// per-type loader registry (which lazy `*VisualCard` chunk renders a
// mesh/pointcloud/boxes3d/volume reference off-screen) to the renderer-
// agnostic lib component. cairn-plot owns the contract + lifecycle; the app
// owns only these chunk paths. See `@cairn-plot/lib/cairn-plot/media-compare/
// cross-type-frame.ts`.

const FOREIGN_FRAME_LOADERS: ForeignFrameLoaders = {
  mesh: () => import("../MeshVisualCard").then((m) => m.MeshForeignFrame),
  pointcloud: () => import("../PointCloudVisualCard").then((m) => m.PointCloudForeignFrame),
  boxes3d: () => import("../BoxesVisualCard").then((m) => m.BoxesForeignFrame),
  volume: () => import("../VolumeVisualCard").then((m) => m.VolumeForeignFrame),
};

export type { ForeignFrameProps };

/** Whether `objectType` has a registered offscreen-render bridge (the four 3D
 *  types). App wrapper over the lib check, bound to the app registry. */
export function hasForeignFrameBridge(objectType: string): boolean {
  return libHasForeignFrameBridge(objectType, FOREIGN_FRAME_LOADERS);
}

export function CrossTypeForeignFrame(props: {
  objectType: string;
  hash: string;
  metadata: string | null | undefined;
  onFrame: (f: FrameSource) => void;
}) {
  return <LibCrossTypeForeignFrame {...props} loaders={FOREIGN_FRAME_LOADERS} />;
}

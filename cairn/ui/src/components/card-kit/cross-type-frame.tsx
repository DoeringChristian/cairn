import { lazy, Suspense, useMemo } from "react";
import type { ComponentType } from "react";
import type { FrameSource } from "@cairn-plot/lib/cairn-plot/viewport/types";

// ---------------------------------------------------------------------------
// WS-VC6 cross-type bridge — the "foreign 3D type" half of image<->3D
// compare.
//
// When an IMAGE card's resolved reference is a 3D type (mesh/pointcloud/
// boxes3d/volume), there is no existing machinery to turn that hash into a
// raster: unlike an image reference (trivially `api.artifactUrl(hash)`, no
// rendering needed), a 3D reference must be actually RENDERED by that type's
// own viewer to produce pixels. `VisualContentCard` (the image card
// instance) has no idea how to construct a MeshViewer/PointCloudViewer/etc
// itself — that knowledge lives in each type's own `*VisualCard.tsx` (the
// existing lazy-chunk boundary for `three`).
//
// This registry dynamically imports the SAME lazy chunk each type's card
// already uses (so a foreign 3D reference costs nothing until cross-type
// compare actually needs one, keeping `three` lazy for every card that
// doesn't touch this path) and reuses each type's exported `*ForeignFrame`
// component — a small hidden-render + single-snapshot bridge co-located next
// to that type's own blob-fetch code (so it shares the parse/query-cache
// logic, not a duplicate).
//
// NOT used for the reverse direction (a 3D card referencing an image): an
// image reference is already just a URL (`api.artifactUrl`), no bridge
// needed — see VisualContentCard's `crossTypeReferenceUrl` computation.
// ---------------------------------------------------------------------------

export interface ForeignFrameProps {
  hash: string;
  metadata: string | null | undefined;
  onFrame: (f: FrameSource) => void;
}

type ForeignFrameLoader = () => Promise<ComponentType<ForeignFrameProps>>;

const FOREIGN_FRAME_LOADERS: Record<string, ForeignFrameLoader> = {
  mesh: () => import("../MeshVisualCard").then((m) => m.MeshForeignFrame),
  pointcloud: () => import("../PointCloudVisualCard").then((m) => m.PointCloudForeignFrame),
  boxes3d: () => import("../BoxesVisualCard").then((m) => m.BoxesForeignFrame),
  volume: () => import("../VolumeVisualCard").then((m) => m.VolumeForeignFrame),
};

/** Whether `objectType` has a registered offscreen-render bridge (the four
 *  3D types). `false` for "image" (never needs this bridge) and any
 *  non-visual type (never reachable — `canCrossTypeCompare` already gates
 *  those out before this component is ever mounted). */
export function hasForeignFrameBridge(objectType: string): boolean {
  return objectType in FOREIGN_FRAME_LOADERS;
}

/**
 * Renders a foreign 3D type's ONE resolved (hash, metadata) hidden, off
 * -screen, purely to capture a single offscreen snapshot via `onFrame` — the
 * bridge an IMAGE card's cross-type compare uses to get a comparable raster
 * out of a mesh/pointcloud/boxes3d/volume reference. Renders nothing visible
 * (the caller positions this off-screen, matching `OffscreenComparePanes`'
 * own hidden-viewer convention) and nothing at all while the chunk is still
 * loading (no flash of placeholder content — the parent card already shows
 * "normal" mode gracefully until `onFrame` first fires, exactly like any
 * other not-yet-resolved reference).
 */
export function CrossTypeForeignFrame({
  objectType,
  hash,
  metadata,
  onFrame,
}: {
  objectType: string;
  hash: string;
  metadata: string | null | undefined;
  onFrame: (f: FrameSource) => void;
}) {
  const Foreign = useMemo(() => {
    const loader = FOREIGN_FRAME_LOADERS[objectType];
    return loader ? lazy(() => loader().then((C) => ({ default: C }))) : null;
  }, [objectType]);

  if (!Foreign) return null;
  return (
    <Suspense fallback={null}>
      <Foreign hash={hash} metadata={metadata} onFrame={onFrame} />
    </Suspense>
  );
}

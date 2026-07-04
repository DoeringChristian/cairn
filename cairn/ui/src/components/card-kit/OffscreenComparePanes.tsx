import { useId } from "react";
import type { Scene3DSyncOptions } from "../../lib/cairn-plot/three/use-scene3d";
import { CompositeMediaPane, type MediaCompareModeKind } from "../../lib/cairn-plot/media-compare";
import type { Colormap, DiffMode } from "../../lib/cairn-plot/types";
import { useOffscreenSnapshot } from "./use-offscreen-snapshot";

export interface OffscreenComparePanesProps {
  /** One of the core "one-pane" media-compare kinds (split/blend/diff) —
   *  "normal"/"side" don't need offscreen compositing (see the card-level
   *  caller: "normal" renders the primary viewer directly, "side" renders
   *  both viewers directly, neither goes through this component). */
  mode: Extract<MediaCompareModeKind, "split" | "blend" | "diff">;
  /** Renders the PRIMARY series' (hidden) viewer — must forward `onFrame`
   *  and `sync` to the underlying `use-scene3d`-based viewer unchanged. */
  renderPrimary: (onFrame: (canvas: HTMLCanvasElement) => void, sync: Scene3DSyncOptions) => React.ReactNode;
  /** Renders the REFERENCE series' (hidden) viewer, same contract. */
  renderReference: (onFrame: (canvas: HTMLCanvasElement) => void, sync: Scene3DSyncOptions) => React.ReactNode;
  diffSubmode: DiffMode;
  colormap: Colormap;
  splitPosition: number;
  onSplitPositionChange: (p: number) => void;
  blendAlpha: number;
  primaryLabel: string;
}

/**
 * Renders TWO hidden 3D viewers sharing a private live camera-sync group
 * (identical camera, per spec-visual-compare.md WS-VC2 §B), snapshots each
 * one's canvas to a data URL (`useOffscreenSnapshot`), and feeds those into
 * the SAME `CompositeMediaPane` an image card uses — this is the ONE
 * compositor (split/blend/pixel-diff), reused rather than forked, with
 * rendered-3D-canvas data URLs standing in for the artifact image URLs an
 * image card would fetch. Shared by every 3D card's 2-series compare
 * feature (mesh/pointcloud/boxes3d/volume) — not a per-card copy.
 *
 * The two source viewers are visually hidden (fixed off-screen position)
 * but still mounted at a real pixel size, since a WebGL canvas needs actual
 * dimensions to render into; only the composited `<img>`-based pane is
 * visible to the user.
 */
export function OffscreenComparePanes({
  mode,
  renderPrimary,
  renderReference,
  diffSubmode,
  colormap,
  splitPosition,
  onSplitPositionChange,
  blendAlpha,
  primaryLabel,
}: OffscreenComparePanesProps) {
  // A private sync group, unrelated to the page-wide "Sync 3D views" group —
  // the two mirror viewers must always share one camera while compare mode
  // is active, independent of whether the card's own panes join page sync.
  const groupId = useId();
  const sync: Scene3DSyncOptions = { groupId: `compare3d-${groupId}` };

  const primary = useOffscreenSnapshot();
  const reference = useOffscreenSnapshot();

  return (
    <div className="relative h-full w-full">
      <div
        aria-hidden
        style={{ position: "absolute", left: -99999, top: 0, width: 640, height: 480 }}
      >
        {renderPrimary(primary.onFrame, sync)}
      </div>
      <div
        aria-hidden
        style={{ position: "absolute", left: -99999, top: 0, width: 640, height: 480 }}
      >
        {renderReference(reference.onFrame, sync)}
      </div>
      <CompositeMediaPane
        mode={mode}
        imageUrl={primary.dataUrl}
        baselineUrl={reference.dataUrl}
        diffSubmode={diffSubmode}
        colormap={colormap}
        interpolation="auto"
        zoom={1}
        pan={{ x: 0, y: 0 }}
        splitPosition={splitPosition}
        blendAlpha={blendAlpha}
        onSplitPositionChange={onSplitPositionChange}
        label={primaryLabel}
      />
    </div>
  );
}

export default OffscreenComparePanes;

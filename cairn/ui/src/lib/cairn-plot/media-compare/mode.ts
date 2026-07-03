import type { Colormap, DiffMode } from "../types";

// ---------------------------------------------------------------------------
// The unified visual-media comparison mode.
//
// Every visual-media card (image today; mesh/pointcloud/boxes3d/volume in
// WS-VC2) picks ONE of these five core modes — never a combination. This is
// the "exclusive mode" contract from spec-visual-compare.md: split+diff (or
// side+diff, etc.) are no longer independently combinable axes. A previously
// "diff-colored side-by-side" configuration now IS the "diff" mode.
// ---------------------------------------------------------------------------

/** The five core modes, shared by every media-compare card. */
export type MediaCompareModeKind = "normal" | "side" | "split" | "blend" | "diff";

export const MEDIA_COMPARE_MODE_KINDS: readonly MediaCompareModeKind[] = [
  "normal",
  "side",
  "split",
  "blend",
  "diff",
];

export function isCoreCompareMode(mode: string): mode is MediaCompareModeKind {
  return (MEDIA_COMPARE_MODE_KINDS as readonly string[]).includes(mode);
}

/**
 * Extension point for card-specific (WS-VC2) modes.
 *
 * 3D cards append NATIVE modes to the same conceptual enum instead of
 * forking a parallel one: union your own string-literal mode names with
 * the five core kinds via the `TExtra` parameter, e.g.
 *
 *   type MeshCompareMode = MediaCompareMode<"diff-property" | "diff-geometry">;
 *   type PointCloudCompareMode = MediaCompareMode<"diff-property" | "diff-position" | "density">;
 *
 * The shared compositor (`compositor.tsx`) only knows how to render the five
 * core kinds (normal/side/split/blend/diff — image-space, works on any
 * rendered canvas per spec). Card-native kinds are NOT run through the
 * compositor; the card renders them itself (e.g. a per-vertex delta pass)
 * and is responsible for disabling them when preconditions fail (mismatched
 * topology, etc.) per spec-visual-compare.md WS-VC2. Do not add new members
 * to `MediaCompareModeKind` for a single card's native modes — extend here.
 */
export type MediaCompareMode<TExtra extends string = never> = MediaCompareModeKind | TExtra;

// ---------------------------------------------------------------------------
// Per-mode config types.
// ---------------------------------------------------------------------------

/** mode: "split" — clip-path position of the drag handle, 0..1. */
export interface SplitConfig {
  position: number;
}

/** mode: "blend" — foreground (prediction) opacity, 0..1. */
export interface BlendConfig {
  alpha: number;
}

/**
 * mode: "diff" — the existing pixel-diff sub-modes (signed/absolute/squared/
 * relative_*) plus false-color mapping. Delegates to cairn-plot's existing
 * image/diff.ts pipeline — this type only carries the *selection*, not the
 * diff math itself (one implementation, see image/diff.ts + webgl-diff.ts).
 */
export interface DiffConfig {
  submode: DiffMode;
  colormap: Colormap;
}

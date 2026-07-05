// ---------------------------------------------------------------------------
// WS-VC6 cross-type compare gate.
//
// Per the design doc (§2.4, §5 risk #1) side/split/blend cross-type is
// "essentially free" (the compositor layers any two FrameSources), while
// pixel `diff` needs an explicit alignment step and is gated behind an
// opt-in (see `crossTypeAlignForDiff` on `ViewportPaneProps` and the
// `crossTypeDiffOptIn` setting).
//
// SHIPPED SCOPE (this pass): cross-type rendering is wired for IMAGE <-> any
// 3D type, in EITHER role (an image card comparing against a 3D reference,
// or a 3D card comparing against an image reference) — this is the literal
// ask ("compare images and 3D viewports pixel-wise"). Two DIFFERENT 3D types
// (e.g. mesh vs volume) are declared in the same visual-type set below (so
// the descriptor shape doesn't need to change for a future pass) but
// `canCrossTypeCompare` deliberately excludes that combination: no offscreen
// bridge exists yet for "render type A's viewer to feed type B's compare",
// only for "render any 3D type's viewer to feed an IMAGE card's compare" (see
// `components/card-kit/cross-type-frame.tsx`). Extending to 3D<->3D-different
// is a follow-up, not a partially-working gate.
// ---------------------------------------------------------------------------

/** object_types that produce a FrameSource (image-space raster) at all —
 *  the universe cross-type compare could ever apply to. */
export const CROSS_TYPE_VISUAL_OBJECT_TYPES = new Set<string>([
  "image",
  "mesh",
  "pointcloud",
  "boxes3d",
  "volume",
]);

/**
 * Whether `a` (this card's own object_type) may compare cross-type against a
 * candidate reference of object_type `b` for the image-space modes
 * (side/split/blend/diff). Symmetric. See the module doc comment for the
 * shipped-scope rationale (image <-> 3D only, either role).
 */
export function canCrossTypeCompare(a: string, b: string): boolean {
  if (a === b) return false;
  if (!CROSS_TYPE_VISUAL_OBJECT_TYPES.has(a) || !CROSS_TYPE_VISUAL_OBJECT_TYPES.has(b)) return false;
  return a === "image" || b === "image";
}

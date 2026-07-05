/**
 * Shared per-element delta + colormap module for ALL 3D viewers/cards
 * (spec-visual-compare.md WS-VC2 quality bar #3: "one new shared module for
 * per-element (vertex/point/box/voxel) deltas + colormap application. The
 * three [four] 3D viewers may NOT each implement their own delta/colormap
 * loop.").
 *
 * This module only prepares SCALAR delta arrays + a color domain; it does
 * not re-implement colormap LUT application — that's `valuesToColors`
 * (`./value-colors.ts`), already shared by every viewer. The two diff
 * colormaps used by every 3D type's native diff modes both already exist as
 * ordinary named colormaps (`colormaps/lut.ts`):
 *
 * - "red-green": a DIVERGING colormap (red -> white -> green) — used with a
 *   domain symmetric around zero (`[-maxAbs, maxAbs]`) so zero maps to the
 *   neutral white midpoint, i.e. signed diff coloring.
 * - "viridis": a sequential colormap — used with a `[0, maxAbs]` domain over
 *   the delta's MAGNITUDE, i.e. "how different", not which direction.
 */

import { valuesToColors } from "./value-colors";
import type { ColormapName } from "../types";

/** The two native-diff-mode colormaps every 3D type's diff modes offer. */
export type DiffColormap = Extract<ColormapName, "red-green" | "viridis">;

/** Per-element signed delta `a[i] - b[i]`, length `n` (stride 1). */
export function computeDelta(a: ArrayLike<number>, b: ArrayLike<number>, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (a[i] ?? 0) - (b[i] ?? 0);
  return out;
}

/**
 * Per-element Euclidean displacement magnitude between two `(n*3)`
 * position buffers — shared by mesh `diff-geometry` (per-vertex) and
 * pointcloud `diff-position` (per-point).
 */
export function computeDisplacementMagnitude(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  n: number,
): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dx = (a[i * 3] ?? 0) - (b[i * 3] ?? 0);
    const dy = (a[i * 3 + 1] ?? 0) - (b[i * 3 + 1] ?? 0);
    const dz = (a[i * 3 + 2] ?? 0) - (b[i * 3 + 2] ?? 0);
    out[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return out;
}

function maxAbs(values: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < values.length; i++) {
    const v = Math.abs(values[i] ?? 0);
    if (v > m) m = v;
  }
  return m || 1e-6;
}

/**
 * Domain for a diff array under the given colormap: symmetric around zero
 * (`[-maxAbs, maxAbs]`) for "red-green" (signed, zero=neutral), or
 * `[0, maxAbs]` for "viridis" (magnitude).
 */
export function diffDomain(values: ArrayLike<number>, colormap: DiffColormap): [number, number] {
  const m = maxAbs(values);
  return colormap === "red-green" ? [-m, m] : [0, m];
}

/** Elementwise `|values[i]|` — used to feed the "viridis" (magnitude)
 *  colormap a non-negative array before domain-mapping (a SIGNED delta's
 *  negative half must not clamp to the LUT's zero end). Exported so a card
 *  can apply the same magnitude transform directly to a raymarched scalar
 *  field (volume's `diff-value`, which colors through its own shader LUT
 *  rather than `diffColors`' precomputed RGB path). */
export function absArray(values: Float32Array): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.abs(values[i]!);
  return out;
}

export interface DiffColorsResult {
  colors: Float32Array;
  domain: [number, number];
}

/**
 * The ONE entry point every 3D viewer/card uses to turn a raw per-element
 * delta array into render-ready colors + a Colorbar domain — no per-viewer
 * delta/colormap loop. `values` is always the SIGNED delta (e.g. from
 * `computeDelta`) or a magnitude (e.g. from `computeDisplacementMagnitude`,
 * already non-negative). For "viridis" (magnitude), a signed input is
 * absolute-valued first so its negative half doesn't clamp to the LUT's
 * zero end; for "red-green" (signed, zero=neutral) the raw signed values
 * are used as-is against the symmetric domain.
 */
export function diffColors(
  values: Float32Array,
  nElements: number,
  colormap: DiffColormap,
): DiffColorsResult {
  const domain = diffDomain(values, colormap);
  return { colors: diffColorsForDomain(values, nElements, domain, colormap), domain };
}

/**
 * Same colormap-application step as `diffColors`, but against an EXTERNALLY
 * supplied domain instead of autoscaling from `values` — the WS-VCP fix 4
 * hook a card-native diff pane uses once a card-level UNIFIED diff domain
 * (`unionDiffDomain`, below) has been computed across every pane, so every
 * pane's diff recolors against the SAME domain rather than each pane's own.
 */
export function diffColorsForDomain(
  values: Float32Array,
  nElements: number,
  domain: [number, number],
  colormap: DiffColormap,
): Float32Array {
  const magnitudeSafe = colormap === "viridis" ? absArray(values) : values;
  return valuesToColors(magnitudeSafe, nElements, domain, colormap);
}

/**
 * Unions per-pane diff domains (each from `diffDomain`) into ONE card-level
 * domain — the "value-only" analogue of `diffDomain` for the multi-pane
 * case: "red-green" (signed, symmetric) takes the largest `maxAbs` across
 * every pane; "viridis" (magnitude, `[0, maxAbs]`) takes the largest `hi`.
 * `null` when `domains` is empty (no pane currently has a valid diff to
 * contribute — e.g. every pair is topology-mismatched).
 */
export function unionDiffDomain(
  domains: readonly [number, number][],
  colormap: DiffColormap,
): [number, number] | null {
  if (domains.length === 0) return null;
  if (colormap === "red-green") {
    const m = Math.max(...domains.map(([lo, hi]) => Math.max(Math.abs(lo), Math.abs(hi))));
    return [-m, m];
  }
  const hi = Math.max(...domains.map(([, h]) => h));
  return [0, hi];
}

// ---------------------------------------------------------------------------
// Import-time self-check (this repo has no TS test runner — see VC1's
// `assertLegacyModeMigrationTable` for the precedent of "fail loud at import
// time" as the unit-style coverage for pure modules like this one).
// ---------------------------------------------------------------------------

function assertDiffMathInvariants(): void {
  const a = [1, 2, 3];
  const b = [1, 0, 6];
  const delta = computeDelta(a, b, 3);
  if (delta[0] !== 0 || delta[1] !== 2 || delta[2] !== -3) {
    throw new Error("diff.ts: computeDelta invariant violated");
  }
  const posA = [0, 0, 0, 3, 4, 0];
  const posB = [0, 0, 0, 0, 0, 0];
  const mag = computeDisplacementMagnitude(posA, posB, 2);
  if (mag[0] !== 0 || Math.abs(mag[1] - 5) > 1e-6) {
    throw new Error("diff.ts: computeDisplacementMagnitude invariant violated");
  }
  const [rgLo, rgHi] = diffDomain(delta, "red-green");
  if (rgLo !== -3 || rgHi !== 3) {
    throw new Error("diff.ts: red-green domain must be symmetric around zero");
  }
  const [vLo, vHi] = diffDomain(delta, "viridis");
  if (vLo !== 0 || vHi !== 3) {
    throw new Error("diff.ts: viridis domain must be [0, maxAbs]");
  }
  const { colors, domain } = diffColors(delta, 3, "red-green");
  if (colors.length !== 9 || domain[0] !== -3 || domain[1] !== 3) {
    throw new Error("diff.ts: diffColors invariant violated");
  }
  // Zero must map to the diverging colormap's neutral (white) midpoint.
  const zeroColors = diffColors(new Float32Array([0]), 1, "red-green").colors;
  if (Math.abs(zeroColors[0]! - 1) > 0.02 || Math.abs(zeroColors[1]! - 1) > 0.02 || Math.abs(zeroColors[2]! - 1) > 0.02) {
    throw new Error("diff.ts: red-green zero must map to white (neutral)");
  }
  // Sign-clamp regression guard: under "viridis" (a [0, maxAbs] MAGNITUDE
  // domain) a SIGNED delta must be absolute-valued first, so +v and -v color
  // IDENTICALLY (equal magnitude) and both differ from 0. Without the
  // absArray() step in diffColors, -3 would clamp to the LUT's zero end and
  // read the SAME as 0 — the exact bug this workstream fixed.
  const signed = diffColors(new Float32Array([-3, 0, 3]), 3, "viridis").colors;
  const negEqPos =
    Math.abs(signed[0]! - signed[6]!) < 1e-6 &&
    Math.abs(signed[1]! - signed[7]!) < 1e-6 &&
    Math.abs(signed[2]! - signed[8]!) < 1e-6;
  const negDiffersFromZero =
    Math.abs(signed[0]! - signed[3]!) > 1e-3 ||
    Math.abs(signed[1]! - signed[4]!) > 1e-3 ||
    Math.abs(signed[2]! - signed[5]!) > 1e-3;
  if (!negEqPos || !negDiffersFromZero) {
    throw new Error(
      "diff.ts: viridis magnitude must color ±v identically and distinctly from 0 (sign-clamp regression)",
    );
  }
}

assertDiffMathInvariants();

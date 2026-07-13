import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useScene3D, type Scene3DCameraMode, type Scene3DSyncOptions } from "./use-scene3d";
import { Scene3DCanvas } from "./Scene3DCanvas";
import { valuesToColors } from "./value-colors";

export type BoxesColorMode = "depth" | "value" | "solid";
export type BoxesBackground = "dark" | "light";

export interface BoxesViewerBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface BoxesViewerProps {
  /** Flat `(nBoxes * 3)` box minima. */
  mins: ArrayLike<number>;
  /** Flat `(nBoxes * 3)` box maxima. */
  maxs: ArrayLike<number>;
  /** Per-box depth level, `(nBoxes,)`. */
  depth: ArrayLike<number>;
  /** Optional per-box scalar value, `(nBoxes,)`. */
  values?: ArrayLike<number> | null;
  nBoxes: number;
  /** Overall bounds across every box (used for camera fit — independent of filters). */
  bounds: BoxesViewerBounds;
  /** Overall max depth across every box (used for the depth color LUT domain). */
  maxDepth: number;
  /** `[min, max]` domain for value coloring, when `values` is present. */
  valueRange?: [number, number] | null;
  colorMode: BoxesColorMode;
  /** Inclusive `[min, max]` depth filter. Boxes outside are omitted from the geometry. */
  depthRange: [number, number];
  /** Optional inclusive `[min, max]` value filter (only applied when `values` is present). */
  valueThreshold?: [number, number] | null;
  background: BoxesBackground;
  className?: string;
  /**
   * Opt-in live camera sync group — see `lib/camera-sync.ts` for how cards
   * resolve a group id. `null`/absent disables sync.
   */
  sync?: Scene3DSyncOptions | null;
  /** Called after every geometry rebuild with the filtered/total box counts. */
  onVisibleCount?: (visible: number, total: number) => void;
  /** Forwarded to `useScene3D` — see its docstring (image-space compare snapshots). */
  onFrame?: (canvas: HTMLCanvasElement) => void;
  /** Forwarded to `useScene3D` — persisted "Show axes" setting (WS-3DR2). */
  showAxes?: boolean;
  /** Forwarded to `useScene3D` — reference planes (#69 S2). */
  showPlanes?: boolean;
  /** Forwarded to `useScene3D` — camera orientation mode (#69 S1). */
  cameraMode?: Scene3DCameraMode;
  /**
   * Precomputed per-box RGB (`(nBoxes*3)`, 0..1), indexed like `depth`/
   * `values` (i.e. BEFORE the depth/value filter), bypassing `colorMode`
   * entirely when present. Used by the card's native `diff-property`
   * comparison mode (colors from the shared `three/diff.ts` module).
   */
  overrideColors?: Float32Array | null;
}

const BG_COLORS: Record<BoxesBackground, number> = {
  dark: 0x0d1117,
  light: 0xf6f8fa,
};

/** Solid-mode line color (0..1 rgb) — a neutral accent, theme-independent. */
const SOLID_COLOR: [number, number, number] = [0.36, 0.66, 0.96];

// 12 edges of a unit cube as pairs of corner indices (0..7).
const CUBE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** Resolves the requested color mode against whether `values` is actually present. */
export function resolveBoxesColorMode(
  mode: BoxesColorMode,
  hasValues: boolean,
): BoxesColorMode {
  return mode === "value" && !hasValues ? "depth" : mode;
}

/** Per-box RGB (one triple per box, `(nBoxes*3)`), before replication onto vertices. */
function computeBoxColors(
  nBoxes: number,
  depth: ArrayLike<number>,
  values: ArrayLike<number> | null | undefined,
  maxDepth: number,
  valueRange: [number, number] | null | undefined,
  mode: BoxesColorMode,
): Float32Array {
  if (mode === "value" && values) {
    return valuesToColors(values, nBoxes, valueRange ?? [0, 1], "viridis");
  }
  if (mode === "depth") {
    return valuesToColors(depth, nBoxes, [0, Math.max(maxDepth, 1e-6)], "viridis");
  }
  const out = new Float32Array(nBoxes * 3);
  for (let i = 0; i < nBoxes; i++) {
    out[i * 3] = SOLID_COLOR[0];
    out[i * 3 + 1] = SOLID_COLOR[1];
    out[i * 3 + 2] = SOLID_COLOR[2];
  }
  return out;
}

/** Indices of boxes passing the depth/value filters, in original order. */
function filterBoxes(
  nBoxes: number,
  depth: ArrayLike<number>,
  values: ArrayLike<number> | null | undefined,
  depthRange: [number, number],
  valueThreshold: [number, number] | null | undefined,
): number[] {
  const [dLo, dHi] = depthRange;
  const visible: number[] = [];
  for (let i = 0; i < nBoxes; i++) {
    const d = depth[i] ?? 0;
    if (d < dLo || d > dHi) continue;
    if (valueThreshold && values) {
      const v = values[i] ?? 0;
      if (v < valueThreshold[0] || v > valueThreshold[1]) continue;
    }
    visible.push(i);
  }
  return visible;
}

/** Builds ONE merged LineSegments position/color buffer — 12 edges per visible box. */
function buildGeometry(
  mins: ArrayLike<number>,
  maxs: ArrayLike<number>,
  visible: number[],
  boxColors: Float32Array,
): { positions: Float32Array; colors: Float32Array } {
  const vertsPerBox = CUBE_EDGES.length * 2; // 24
  const positions = new Float32Array(visible.length * vertsPerBox * 3);
  const colors = new Float32Array(visible.length * vertsPerBox * 3);
  const corner = new Float32Array(8 * 3);
  let p = 0;
  let c = 0;
  for (const i of visible) {
    const mnx = mins[i * 3]!, mny = mins[i * 3 + 1]!, mnz = mins[i * 3 + 2]!;
    const mxx = maxs[i * 3]!, mxy = maxs[i * 3 + 1]!, mxz = maxs[i * 3 + 2]!;
    corner[0] = mnx; corner[1] = mny; corner[2] = mnz;
    corner[3] = mxx; corner[4] = mny; corner[5] = mnz;
    corner[6] = mxx; corner[7] = mxy; corner[8] = mnz;
    corner[9] = mnx; corner[10] = mxy; corner[11] = mnz;
    corner[12] = mnx; corner[13] = mny; corner[14] = mxz;
    corner[15] = mxx; corner[16] = mny; corner[17] = mxz;
    corner[18] = mxx; corner[19] = mxy; corner[20] = mxz;
    corner[21] = mnx; corner[22] = mxy; corner[23] = mxz;

    const cr = boxColors[i * 3]!, cg = boxColors[i * 3 + 1]!, cb = boxColors[i * 3 + 2]!;
    for (const [a, b] of CUBE_EDGES) {
      positions[p++] = corner[a * 3]!;
      positions[p++] = corner[a * 3 + 1]!;
      positions[p++] = corner[a * 3 + 2]!;
      positions[p++] = corner[b * 3]!;
      positions[p++] = corner[b * 3 + 1]!;
      positions[p++] = corner[b * 3 + 2]!;
      colors[c++] = cr; colors[c++] = cg; colors[c++] = cb;
      colors[c++] = cr; colors[c++] = cg; colors[c++] = cb;
    }
  }
  return { positions, colors };
}

/**
 * Self-contained three.js box-hierarchy (octree/BVH) viewer, built on the
 * shared `useScene3D` lifecycle (resize, on-demand render, dblclick-refit,
 * background, disposal, optional camera sync). Renders every visible box as
 * ONE merged `LineSegments` geometry (12 edges/box) — depth-range and
 * value-threshold filters rebuild that single geometry rather than
 * toggling per-box visibility, which keeps large box sets cheap under
 * on-demand rendering. No external React hooks required (`sync` is opt-in
 * and works standalone).
 */
export default function BoxesViewer({
  mins,
  maxs,
  depth,
  values,
  nBoxes,
  bounds,
  maxDepth,
  valueRange,
  colorMode,
  depthRange,
  valueThreshold,
  background,
  className,
  sync = null,
  onVisibleCount,
  onFrame,
  showAxes = false,
  showPlanes = false,
  cameraMode = "orbital",
  overrideColors = null,
}: BoxesViewerProps) {
  const handle = useScene3D({
    background: BG_COLORS[background],
    sync,
    showAxes,
    showPlanes,
    cameraMode,
    onFrame,
  });
  const { requestRender, fitToBounds, refs } = handle;

  const lineRef = useRef<THREE.LineSegments | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.LineBasicMaterial | null>(null);

  const effectiveColorMode = resolveBoxesColorMode(colorMode, !!values);

  // ── Geometry rebuild: new data, filter change, or color-mode change ────
  useEffect(() => {
    const scene = refs.scene.current;
    if (!scene) return;

    const visible = filterBoxes(nBoxes, depth, values, depthRange, valueThreshold ?? null);
    const boxColors =
      overrideColors ??
      computeBoxColors(nBoxes, depth, values, maxDepth, valueRange, effectiveColorMode);
    const { positions, colors } = buildGeometry(mins, maxs, visible, boxColors);

    if (lineRef.current) {
      scene.remove(lineRef.current);
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({ vertexColors: true });
    const line = new THREE.LineSegments(geometry, material);
    scene.add(line);
    geometryRef.current = geometry;
    materialRef.current = material;
    lineRef.current = line;

    requestRender();
    onVisibleCount?.(visible.length, nBoxes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mins,
    maxs,
    depth,
    values,
    nBoxes,
    depthRange[0],
    depthRange[1],
    valueThreshold?.[0],
    valueThreshold?.[1],
    effectiveColorMode,
    maxDepth,
    valueRange?.[0],
    valueRange?.[1],
    overrideColors,
  ]);

  // ── Fit camera only when the underlying dataset changes, not on filter/
  // color-mode changes (those shouldn't move the camera out from under the
  // user while they're inspecting a subset) ──────────────────────────────
  useEffect(() => {
    fitToBounds(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mins, maxs, nBoxes]);

  // ── Dispose this viewer's own geometry/material on unmount ─────────────
  useEffect(() => {
    return () => {
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
    };
  }, []);

  return <Scene3DCanvas handle={handle} className={className} />;
}

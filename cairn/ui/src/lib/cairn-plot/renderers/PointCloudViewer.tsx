import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useScene3D, type Scene3DCameraMode, type Scene3DSyncOptions } from "../three/use-scene3d";
import { Scene3DCanvas } from "../three/Scene3DCanvas";
import { valuesToColors, categoriesToColors, packRgbColors } from "../three/value-colors";

export type PointCloudChannels = "xyz" | "xyzc" | "xyzrgb";
export type PointColorMode = "auto" | "rgb" | "category" | "height";
export type PointCloudBackground = "dark" | "light";
/**
 * How `pointSize` is interpreted / how points scale with camera distance:
 *
 *  - `"screen"` (default) → constant IMAGE-space size: points stay the same
 *    on-screen size regardless of camera distance (`sizeAttenuation:false`).
 *    `pointSize` is in PIXELS.
 *  - `"world"` → perspective attenuation: points shrink with distance like
 *    real geometry (`sizeAttenuation:true`). `pointSize` is in WORLD units.
 *
 * `sizeAttenuation` is baked into three's PointsMaterial shader program, so
 * flipping this mode requires recreating the material (see the size effect).
 */
export type PointSizeMode = "screen" | "world";

export interface PointCloudBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface PointCloudViewerProps {
  /** Flat `(nPoints * channelCount)` float32 data. */
  data: Float32Array;
  channels: PointCloudChannels;
  nPoints: number;
  bounds: PointCloudBounds;
  colorMode: PointColorMode;
  /** Point size — PIXELS when `pointSizeMode` is `"screen"` (default), WORLD
   *  units when `"world"`. */
  pointSize: number;
  /** Screen-space (constant-pixel, default) vs world-space (perspective
   *  attenuation) point sizing. See `PointSizeMode`. */
  pointSizeMode?: PointSizeMode;
  background: PointCloudBackground;
  className?: string;
  /**
   * Opt-in live camera sync group: viewers sharing a `groupId` mirror each
   * other's orbit/zoom/pan in real time. `null`/absent (default) disables
   * sync — see `lib/camera-sync.ts` for how cards resolve a group id.
   */
  sync?: Scene3DSyncOptions | null;
  /** Forwarded to `useScene3D` — see its docstring (image-space compare snapshots). */
  onFrame?: (canvas: HTMLCanvasElement) => void;
  /** Forwarded to `useScene3D` — persisted "Show axes" setting (WS-3DR2). */
  showAxes?: boolean;
  /** Forwarded to `useScene3D` — reference planes (#69 S2). */
  showPlanes?: boolean;
  /** Forwarded to `useScene3D` — camera orientation mode (#69 S1). */
  cameraMode?: Scene3DCameraMode;
  /**
   * Precomputed per-point RGB (`(nPoints*3)`, 0..1), bypassing `colorMode`
   * entirely when present. Used by the card's native `diff-property`/
   * `diff-position` comparison modes (colors from the shared
   * `three/diff.ts` module) — the viewer itself has no diff/colormap logic
   * of its own (spec-visual-compare.md quality bar #3).
   */
  overrideColors?: Float32Array | null;
}

/** Element stride per channel layout — exported so cards can extract raw
 *  xyz positions themselves (e.g. the `diff-position` native comparison
 *  mode's displacement magnitude) without duplicating this layout table. */
export const CHANNEL_STRIDE: Record<PointCloudChannels, number> = {
  xyz: 3,
  xyzc: 4,
  xyzrgb: 6,
};

const BG_COLORS: Record<PointCloudBackground, number> = {
  dark: 0x0d1117,
  light: 0xf6f8fa,
};

/** Resolve the requested color mode against the channels actually available. */
export function resolveColorMode(
  mode: PointColorMode,
  channels: PointCloudChannels,
): "rgb" | "category" | "height" {
  if (mode === "rgb") return channels === "xyzrgb" ? "rgb" : channels === "xyzc" ? "category" : "height";
  if (mode === "category") return channels === "xyzc" ? "category" : channels === "xyzrgb" ? "rgb" : "height";
  if (mode === "height") return "height";
  // auto
  if (channels === "xyzrgb") return "rgb";
  if (channels === "xyzc") return "category";
  return "height";
}

export function extractPositions(data: Float32Array, channels: PointCloudChannels, nPoints: number): Float32Array {
  const stride = CHANNEL_STRIDE[channels];
  if (stride === 3) return data.subarray(0, nPoints * 3);
  const out = new Float32Array(nPoints * 3);
  for (let i = 0; i < nPoints; i++) {
    out[i * 3] = data[i * stride]!;
    out[i * 3 + 1] = data[i * stride + 1]!;
    out[i * 3 + 2] = data[i * stride + 2]!;
  }
  return out;
}

function computeColors(
  data: Float32Array,
  channels: PointCloudChannels,
  nPoints: number,
  bounds: PointCloudBounds,
  mode: PointColorMode,
): Float32Array {
  const stride = CHANNEL_STRIDE[channels];
  const effective = resolveColorMode(mode, channels);

  if (effective === "rgb") {
    return packRgbColors(data, nPoints, stride, 3);
  }

  if (effective === "category") {
    return categoriesToColors(data, nPoints, { stride, offset: 3 });
  }

  // height → viridis over z
  return valuesToColors(data, nPoints, [bounds.min[2], bounds.max[2]], "viridis", {
    stride,
    offset: 2,
  });
}

/**
 * Self-contained three.js point-cloud viewer, built on the shared
 * `useScene3D` lifecycle (resize, on-demand render, dblclick-refit,
 * background, disposal, optional camera sync). Owns only its own geometry
 * and material — several comparison panes stay cheap since rendering is
 * on-demand, not a permanent rAF loop. No external React hooks required
 * (`sync` is opt-in and works standalone).
 */
export default function PointCloudViewer({
  data,
  channels,
  nPoints,
  bounds,
  colorMode,
  pointSize,
  pointSizeMode = "screen",
  background,
  className,
  sync = null,
  onFrame,
  showAxes = false,
  showPlanes = false,
  cameraMode = "orbital",
  overrideColors = null,
}: PointCloudViewerProps) {
  const handle = useScene3D({
    background: BG_COLORS[background],
    sync,
    showAxes,
    showPlanes,
    cameraMode,
    onFrame,
  });
  const { requestRender, fitToBounds, refs } = handle;

  const pointsRef = useRef<THREE.Points | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.PointsMaterial | null>(null);

  const positions = useMemo(
    () => extractPositions(data, channels, nPoints),
    [data, channels, nPoints],
  );

  // ── Geometry (new cloud) + fit ─────────────────────────────────────────
  useEffect(() => {
    const scene = refs.scene.current;
    if (!scene) return;

    // Remove & dispose any previous cloud.
    if (pointsRef.current) {
      scene.remove(pointsRef.current);
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const colors = overrideColors ?? computeColors(data, channels, nPoints, bounds, colorMode);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: pointSize,
      // `false` (screen mode) → constant-pixel size; `true` (world mode) →
      // perspective attenuation. Baked into the shader, so a mode flip later
      // recreates the material (see the size/mode effect).
      sizeAttenuation: pointSizeMode === "world",
      vertexColors: true,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);
    geometryRef.current = geometry;
    materialRef.current = material;
    pointsRef.current = points;

    fitToBounds(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, data, channels, nPoints]);

  // ── Recolor (mode/overrideColors change, no refit) ─────────────────────
  useEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    const colors = overrideColors ?? computeColors(data, channels, nPoints, bounds, colorMode);
    const attr = geometry.getAttribute("color") as THREE.BufferAttribute;
    attr.copyArray(colors);
    attr.needsUpdate = true;
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, overrideColors]);

  // ── Point size + size mode ─────────────────────────────────────────────
  // A plain `.size` update covers pointSize changes, but `sizeAttenuation`
  // (screen↔world) is compiled into three's PointsMaterial shader, so a mode
  // flip needs a FRESH material — recreate it, swap it onto the Points, and
  // dispose the old one (mirrors the geometry effect's material lifecycle).
  useEffect(() => {
    const points = pointsRef.current;
    const material = materialRef.current;
    if (!points || !material) return;
    const wantAttenuation = pointSizeMode === "world";
    if (material.sizeAttenuation !== wantAttenuation) {
      const next = new THREE.PointsMaterial({
        size: pointSize,
        sizeAttenuation: wantAttenuation,
        vertexColors: true,
      });
      points.material = next;
      material.dispose();
      materialRef.current = next;
    } else {
      material.size = pointSize;
      material.needsUpdate = true;
    }
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointSize, pointSizeMode]);

  // ── Dispose this viewer's own geometry/material on unmount (the renderer
  // / controls / WebGL context lifecycle is owned by useScene3D) ─────────
  useEffect(() => {
    return () => {
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
    };
  }, []);

  return <Scene3DCanvas handle={handle} className={className} />;
}

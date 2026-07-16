import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useScene3D, type Scene3DCameraMode, type Scene3DSyncOptions } from "../three/use-scene3d";
import { Scene3DCanvas } from "../three/Scene3DCanvas";
import { valuesToColors, packRgbColors } from "../three/value-colors";

export type MeshColorMode = "solid" | "vertex-colors" | "face-colors" | "values";
export type MeshShading = "flat" | "smooth";
export type MeshBackground = "dark" | "light";

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface MeshViewerProps {
  /** Flat `(nVertices * 3)` float32 vertex positions. */
  positions: Float32Array;
  /** Flat `(nFaces * 3)` triangle vertex indices. */
  faces: Uint32Array;
  nVertices: number;
  nFaces: number;
  /** Optional flat `(nVertices)` per-vertex scalar, used by color mode "values". */
  values?: Float32Array | null;
  /** Domain for the "values" color mode; falls back to the data's own min/max. */
  valueRange?: [number, number] | null;
  /** Optional flat `(nVertices * 3)` per-vertex RGB (0-1), used by "vertex-colors". */
  colors?: Float32Array | null;
  /** Optional flat `(nFaces * 3)` or `(nFaces * 4)` per-FACE RGB(A) (0-1), used
   *  by "face-colors". Channel count is inferred as `length / nFaces`. */
  faceColors?: Float32Array | null;
  /** Optional flat `(nVertices * 3)` per-vertex normals; computed (smooth) when absent. */
  normals?: Float32Array | null;
  bounds: MeshBounds;
  colorMode: MeshColorMode;
  shading: MeshShading;
  wireframe: boolean;
  doubleSided: boolean;
  background: MeshBackground;
  className?: string;
  /** Opt-in live camera sync group — see `lib/camera-sync.ts`. */
  sync?: Scene3DSyncOptions | null;
  /** Forwarded to `useScene3D` — see its docstring (image-space compare snapshots). */
  onFrame?: (canvas: HTMLCanvasElement) => void;
  /** Forwarded to `useScene3D` — persisted "Show axes" setting (WS-3DR2). */
  showAxes?: boolean;
  /** Forwarded to `useScene3D` — reference planes (#69 S2). */
  showPlanes?: boolean;
  /** Forwarded to `useScene3D` — camera orientation mode (#69 S1). */
  cameraMode?: Scene3DCameraMode;
}

const BG_COLORS: Record<MeshBackground, number> = {
  dark: 0x0d1117,
  light: 0xf6f8fa,
};

const SOLID_COLOR = 0x6ea8ff;
const WIREFRAME_COLOR = 0x000000;

/** Resolve the requested color mode against the attributes actually available.
 *  Precedence when a requested mode's data is absent: face-colors → vertex
 *  colors → values → solid (mirrors the Python-side default selection). */
export function resolveMeshColorMode(
  mode: MeshColorMode,
  hasColors: boolean,
  hasValues: boolean,
  hasFaceColors = false,
): MeshColorMode {
  if (mode === "face-colors" && !hasFaceColors)
    return hasColors ? "vertex-colors" : hasValues ? "values" : "solid";
  if (mode === "vertex-colors" && !hasColors) return hasValues ? "values" : "solid";
  if (mode === "values" && !hasValues) return hasColors ? "vertex-colors" : "solid";
  return mode;
}

/**
 * Expand an indexed mesh to a NON-INDEXED geometry for per-face coloring: each
 * triangle gets 3 unique vertices (no sharing) that all carry that face's
 * color, so every face renders one flat, un-interpolated color. Returns the
 * expanded flat `(nFaces*3*3)` positions, the matching `(nFaces*3*channels)`
 * color buffer, and the inferred channel count (3 = RGB, 4 = RGBA). Winding is
 * preserved (vertices emitted in each face's own index order), so
 * `computeVertexNormals` yields correct outward flat normals.
 */
export function expandFaceColors(
  positions: Float32Array,
  faces: Uint32Array,
  nFaces: number,
  faceColors: Float32Array,
): { outPositions: Float32Array; outColors: Float32Array; channels: number } {
  const channels = nFaces > 0 ? faceColors.length / nFaces : 3;
  const ch = channels === 4 ? 4 : 3;
  const outPositions = new Float32Array(nFaces * 9);
  const outColors = new Float32Array(nFaces * 3 * ch);
  for (let f = 0; f < nFaces; f++) {
    const cr = faceColors[f * ch]!;
    const cg = faceColors[f * ch + 1]!;
    const cb = faceColors[f * ch + 2]!;
    const ca = ch === 4 ? faceColors[f * ch + 3]! : 1;
    for (let k = 0; k < 3; k++) {
      const vi = faces[f * 3 + k]!;
      const po = (f * 3 + k) * 3;
      outPositions[po] = positions[vi * 3]!;
      outPositions[po + 1] = positions[vi * 3 + 1]!;
      outPositions[po + 2] = positions[vi * 3 + 2]!;
      const co = (f * 3 + k) * ch;
      outColors[co] = cr;
      outColors[co + 1] = cg;
      outColors[co + 2] = cb;
      if (ch === 4) outColors[co + 3] = ca;
    }
  }
  return { outPositions, outColors, channels: ch };
}

function dataRange(values: Float32Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  return [min, max];
}

/** Compute the vertex "color" attribute for the resolved mode, or `null` for "solid". */
function computeVertexColors(
  mode: MeshColorMode,
  nVertices: number,
  values: Float32Array | null | undefined,
  valueRange: [number, number] | null | undefined,
  colors: Float32Array | null | undefined,
): Float32Array | null {
  if (mode === "vertex-colors" && colors) {
    return packRgbColors(colors, nVertices, 3, 0);
  }
  if (mode === "values" && values) {
    const domain = valueRange ?? dataRange(values);
    return valuesToColors(values, nVertices, domain, "viridis");
  }
  return null;
}

/**
 * Self-contained three.js indexed-mesh viewer, built on the shared
 * `useScene3D` lifecycle (resize, on-demand render, dblclick-refit,
 * background, disposal, optional camera sync). Owns its own geometry,
 * material, lights, and an optional wireframe overlay (a sibling
 * `LineSegments`, not `material.wireframe` — so face fill stays visible
 * underneath the overlay).
 */
export default function MeshViewer({
  positions,
  faces,
  nVertices,
  nFaces,
  values = null,
  valueRange = null,
  colors = null,
  faceColors = null,
  normals = null,
  bounds,
  colorMode,
  shading,
  wireframe,
  doubleSided,
  background,
  className,
  sync = null,
  onFrame,
  showAxes = false,
  showPlanes = false,
  cameraMode = "orbital",
}: MeshViewerProps) {
  const handle = useScene3D({
    background: BG_COLORS[background],
    sync,
    showAxes,
    showPlanes,
    cameraMode,
    onFrame,
  });
  const { requestRender, fitToBounds, refs } = handle;

  const meshRef = useRef<THREE.Mesh | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const wireRef = useRef<THREE.LineSegments | null>(null);
  const wireGeometryRef = useRef<THREE.WireframeGeometry | null>(null);
  const wireMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const lightsRef = useRef<THREE.Light[]>([]);

  const resolvedMode = useMemo(
    () => resolveMeshColorMode(colorMode, !!colors, !!values, !!faceColors),
    [colorMode, colors, values, faceColors],
  );
  // Per-face coloring needs a non-indexed geometry (see `expandFaceColors`),
  // so it is a geometry-REBUILD trigger, not a cheap recolor.
  const useFaceColors = resolvedMode === "face-colors" && !!faceColors;

  // ── Lights (added once; content lifecycle is owned by this renderer, not
  // the shared scene hook) ────────────────────────────────────────────────
  useEffect(() => {
    const scene = refs.scene.current;
    if (!scene) return;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 1.1);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(1, 1.6, 1.2);
    scene.add(hemi, dir);
    lightsRef.current = [hemi, dir];
    requestRender();
    return () => {
      scene.remove(hemi, dir);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Geometry (new mesh) + fit ────────────────────────────────────────────
  useEffect(() => {
    const scene = refs.scene.current;
    if (!scene) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
    }
    if (wireRef.current) {
      scene.remove(wireRef.current);
      wireGeometryRef.current?.dispose();
      wireMaterialRef.current?.dispose();
    }

    const material = new THREE.MeshStandardMaterial({
      color: SOLID_COLOR,
      roughness: 0.85,
      metalness: 0.0,
      flatShading: shading === "flat",
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    const geometry = new THREE.BufferGeometry();
    if (useFaceColors && faceColors) {
      // Per-face path: expand each indexed triangle to 3 unique verts that
      // share the face color, and derive flat normals from the expanded
      // (unwelded) positions. Any supplied per-vertex `normals` do not apply
      // to a non-indexed geometry and are intentionally ignored here.
      const { outPositions, outColors, channels } = expandFaceColors(
        positions,
        faces,
        nFaces,
        faceColors,
      );
      geometry.setAttribute("position", new THREE.BufferAttribute(outPositions, 3));
      geometry.computeVertexNormals();
      geometry.setAttribute("color", new THREE.BufferAttribute(outColors, channels));
      material.vertexColors = true;
      if (channels === 4) material.transparent = true;
    } else {
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(faces, 1));
      if (normals && normals.length === nVertices * 3) {
        geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      } else {
        geometry.computeVertexNormals();
      }
      const vertexColors = computeVertexColors(resolvedMode, nVertices, values, valueRange, colors);
      if (vertexColors) {
        geometry.setAttribute("color", new THREE.BufferAttribute(vertexColors, 3));
        material.vertexColors = true;
      }
    }

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    geometryRef.current = geometry;
    materialRef.current = material;
    meshRef.current = mesh;

    const wireGeometry = new THREE.WireframeGeometry(geometry);
    const wireMaterial = new THREE.LineBasicMaterial({
      color: WIREFRAME_COLOR,
      transparent: true,
      opacity: 0.35,
    });
    const wire = new THREE.LineSegments(wireGeometry, wireMaterial);
    wire.visible = wireframe;
    scene.add(wire);
    wireGeometryRef.current = wireGeometry;
    wireMaterialRef.current = wireMaterial;
    wireRef.current = wire;

    fitToBounds(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, faces, nVertices, nFaces, normals, useFaceColors, faceColors]);

  // ── Recolor (mode/values/colors change, no rebuild/refit) ───────────────
  useEffect(() => {
    const geometry = geometryRef.current;
    const material = materialRef.current;
    if (!geometry || !material) return;
    // Per-face coloring is baked into the non-indexed geometry at build time
    // (the geometry effect rebuilds when `useFaceColors` flips), so there is
    // nothing to recolor in place here.
    if (useFaceColors) return;
    const vertexColors = computeVertexColors(resolvedMode, nVertices, values, valueRange, colors);
    if (vertexColors) {
      let attr = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
      if (!attr || attr.count !== nVertices) {
        attr = new THREE.BufferAttribute(vertexColors, 3);
        geometry.setAttribute("color", attr);
      } else {
        attr.copyArray(vertexColors);
        attr.needsUpdate = true;
      }
      material.vertexColors = true;
    } else {
      material.vertexColors = false;
      material.color.setHex(SOLID_COLOR);
    }
    material.needsUpdate = true;
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedMode, values, valueRange, colors, nVertices, useFaceColors]);

  // ── Shading (flat/smooth) ────────────────────────────────────────────────
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.flatShading = shading === "flat";
    material.needsUpdate = true;
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shading]);

  // ── Double-sided ──────────────────────────────────────────────────────────
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    material.needsUpdate = true;
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doubleSided]);

  // ── Wireframe overlay visibility ─────────────────────────────────────────
  useEffect(() => {
    const wire = wireRef.current;
    if (!wire) return;
    wire.visible = wireframe;
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wireframe]);

  // ── Dispose this viewer's own geometry/material/lights on unmount ───────
  useEffect(() => {
    return () => {
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
      wireGeometryRef.current?.dispose();
      wireMaterialRef.current?.dispose();
    };
  }, []);

  return <Scene3DCanvas handle={handle} className={className} />;
}

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useContainerSize } from "../hooks/use-container-size";
import { getColormapLUT } from "../colormaps";
import { SERIES_COLORS } from "../types";

export type PointCloudChannels = "xyz" | "xyzc" | "xyzrgb";
export type PointColorMode = "auto" | "rgb" | "category" | "height";
export type PointCloudBackground = "dark" | "light";

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
  /** Point size in pixels. */
  pointSize: number;
  background: PointCloudBackground;
  className?: string;
}

const CHANNEL_STRIDE: Record<PointCloudChannels, number> = {
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

function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function extractPositions(data: Float32Array, channels: PointCloudChannels, nPoints: number): Float32Array {
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
  const colors = new Float32Array(nPoints * 3);
  const effective = resolveColorMode(mode, channels);

  if (effective === "rgb") {
    for (let i = 0; i < nPoints; i++) {
      colors[i * 3] = data[i * stride + 3]!;
      colors[i * 3 + 1] = data[i * stride + 4]!;
      colors[i * 3 + 2] = data[i * stride + 5]!;
    }
    return colors;
  }

  if (effective === "category") {
    const palette = SERIES_COLORS.map(hexToRgb01);
    for (let i = 0; i < nPoints; i++) {
      const cat = Math.max(0, Math.round(data[i * stride + 3]!));
      const [r, g, b] = palette[cat % palette.length]!;
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    return colors;
  }

  // height → viridis over z
  const lut = getColormapLUT("viridis");
  const zMin = bounds.min[2];
  const zMax = bounds.max[2];
  const span = zMax - zMin || 1;
  for (let i = 0; i < nPoints; i++) {
    const z = data[i * stride + 2]!;
    const t = Math.max(0, Math.min(1, (z - zMin) / span));
    const idx = Math.min(255, Math.max(0, Math.round(t * 255)));
    colors[i * 3] = lut[idx * 3]! / 255;
    colors[i * 3 + 1] = lut[idx * 3 + 1]! / 255;
    colors[i * 3 + 2] = lut[idx * 3 + 2]! / 255;
  }
  return colors;
}

/**
 * Self-contained three.js point-cloud viewer. Owns its resize (ResizeObserver
 * via useContainerSize), orbit/zoom/pan (three's OrbitControls, which binds to
 * the canvas internally), and renders on demand (no permanent rAF loop, so
 * several comparison panes stay cheap). Disposes geometry, material, controls
 * and the WebGL context on unmount. No external React hooks required.
 */
export default function PointCloudViewer({
  data,
  channels,
  nPoints,
  bounds,
  colorMode,
  pointSize,
  background,
  className,
}: PointCloudViewerProps) {
  const { ref: containerRef, size } = useContainerSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.PointsMaterial | null>(null);

  const positions = useMemo(
    () => extractPositions(data, channels, nPoints),
    [data, channels, nPoints],
  );

  // ── Fit camera to the cloud bounds ─────────────────────────────────────
  const fitToBounds = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const min = new THREE.Vector3(...bounds.min);
    const max = new THREE.Vector3(...bounds.max);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(max.clone().sub(min).length() * 0.5, 1e-3);
    const fov = (camera.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.15;
    camera.near = Math.max(dist / 1000, 1e-4);
    camera.far = dist * 10 + radius * 10;
    camera.up.set(0, 1, 0);
    camera.position
      .copy(center)
      .add(new THREE.Vector3(1, 0.75, 1).normalize().multiplyScalar(dist));
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    renderOnce();
  };

  const renderOnce = () => {
    const r = rendererRef.current;
    const s = sceneRef.current;
    const c = cameraRef.current;
    if (r && s && c) r.render(s, c);
  };

  // ── Mount: renderer + scene + camera + controls (once) ─────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.addEventListener("change", renderOnce);
    controlsRef.current = controls;

    const onDblClick = () => fitToBounds();
    canvas.addEventListener("dblclick", onDblClick);

    return () => {
      canvas.removeEventListener("dblclick", onDblClick);
      controls.removeEventListener("change", renderOnce);
      controls.dispose();
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      pointsRef.current = null;
      geometryRef.current = null;
      materialRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Background ─────────────────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setClearColor(BG_COLORS[background], 1);
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background]);

  // ── Resize ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera || size.w === 0 || size.h === 0) return;
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  // ── Geometry (new cloud) + fit ─────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove & dispose any previous cloud.
    if (pointsRef.current) {
      scene.remove(pointsRef.current);
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const colors = computeColors(data, channels, nPoints, bounds, colorMode);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: pointSize,
      sizeAttenuation: false,
      vertexColors: true,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);
    geometryRef.current = geometry;
    materialRef.current = material;
    pointsRef.current = points;

    fitToBounds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, data, channels, nPoints]);

  // ── Recolor (mode change, no refit) ────────────────────────────────────
  useEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    const colors = computeColors(data, channels, nPoints, bounds, colorMode);
    const attr = geometry.getAttribute("color") as THREE.BufferAttribute;
    attr.copyArray(colors);
    attr.needsUpdate = true;
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode]);

  // ── Point size ─────────────────────────────────────────────────────────
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.size = pointSize;
    material.needsUpdate = true;
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointSize]);

  return (
    <div ref={containerRef} className={className ?? "relative h-full w-full"}>
      <canvas ref={canvasRef} className="block h-full w-full rounded" />
    </div>
  );
}

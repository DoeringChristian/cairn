import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useScene3D, type Scene3DBounds, type Scene3DCameraMode, type Scene3DSyncOptions } from "./use-scene3d";
import { Scene3DCanvas } from "./Scene3DCanvas";
import { getColormapLUT } from "../colormaps";
import type { ColormapName } from "../types";

export type VolumeRenderMode = "mip" | "iso";
export type VolumeBackground = "dark" | "light";
export type VolumeQuality = 64 | 128 | 256;

export interface VolumeClip {
  /** Per-axis clip minimum, normalized [0,1] in *texture* space — axis order
   * is (x, y, z) = (W, H, D), i.e. matches the box mesh's local axes, NOT
   * the data's [D,H,W] shape order. See the module docstring below. */
  min: [number, number, number];
  max: [number, number, number];
}

export interface VolumeViewerProps {
  /** Flat `D*H*W` float32 data, row-major (numpy C-order: W fastest). */
  data: Float32Array;
  /** `[D, H, W]` — same order as the `cairn.Volume`/handler metadata. */
  shape: [number, number, number];
  /** Physical spacing per `[D, H, W]` axis. Default handled by the caller. */
  spacing: [number, number, number];
  /** Physical origin per `[D, H, W]` axis. Default handled by the caller. */
  origin: [number, number, number];
  /** Value domain used to normalize the density texture and the colormap LUT. */
  vmin: number;
  vmax: number;
  mode: VolumeRenderMode;
  /** Isosurface threshold, normalized to `[0,1]` as a fraction of `[vmin,vmax]`. */
  isovalue: number;
  colormap: ColormapName;
  /** Raymarch step count (quality/perf tradeoff). */
  steps: VolumeQuality;
  clip: VolumeClip;
  background: VolumeBackground;
  className?: string;
  /** Opt-in live camera sync — see `use-scene3d.ts` / `lib/camera-sync.ts`. */
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

const BG_COLORS: Record<VolumeBackground, number> = {
  dark: 0x0d1117,
  light: 0xf6f8fa,
};

// Raymarch loop upper bound baked into the shader (GLSL `for` loops need a
// compile-time-constant bound; the `steps` uniform drives a runtime `break`
// inside it — see FRAGMENT_SHADER). Must be >= the largest quality setting.
const MAX_MARCH_STEPS = 256;

// ── WebGL2 feature detection (computed once per session, not per render) ──
// three.js (^0.185) requires WebGL2 unconditionally; on a browser/GPU
// without it, `useScene3D`'s `new THREE.WebGLRenderer(...)` would throw
// inside an effect. We probe with a throwaway canvas *before* ever mounting
// the scene, and release the probe context immediately via the
// `WEBGL_lose_context` extension so we don't hold two live contexts around
// (module budget is meant to be "1 context/pane", not 2).
let _webgl2Support: boolean | null = null;
function supportsWebGL2(): boolean {
  if (_webgl2Support !== null) return _webgl2Support;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (gl) {
      const ext = gl.getExtension("WEBGL_lose_context") as { loseContext: () => void } | null;
      ext?.loseContext();
    }
    _webgl2Support = !!gl;
  } catch {
    _webgl2Support = false;
  }
  return _webgl2Support;
}

function VolumeUnavailablePlaceholder({ className }: { className?: string }) {
  return (
    <div className={className ?? "relative h-full w-full"}>
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center">
        <div className="text-sm font-semibold text-fg">WebGL2 unavailable</div>
        <div className="text-xs text-fg-muted">
          Volume rendering needs WebGL2 (raymarched 3D textures), which this
          browser or GPU doesn&apos;t support.
        </div>
      </div>
    </div>
  );
}

/**
 * Normalizes the flat float32 volume into a `Uint8Array` over `[vmin,vmax]`.
 *
 * Texture format choice: `RedFormat` + `UnsignedByteType` (an `R8` 3D
 * texture) rather than a float texture. WebGL2 guarantees `R8` textures are
 * filterable with `LinearFilter` on every implementation; `R32F` (float)
 * textures are *not* linear-filterable without the optional
 * `OES_texture_float_linear` extension, which is not universally available.
 * Since the raymarcher relies on trilinear-filtered samples (both for a
 * smooth MIP/ISO surface and for the central-difference gradient used in
 * ISO shading), byte-normalized textures are the robust choice — this
 * matches three.js's own `webgl2_materials_texture3d` example, which also
 * uploads `Uint8Array` density data. 256 levels is ample resolution for a
 * transfer function driven by a user-adjustable isovalue slider.
 */
function toUint8Density(data: Float32Array, vmin: number, vmax: number): Uint8Array {
  const span = vmax - vmin || 1;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const t = (data[i]! - vmin) / span;
    out[i] = Math.max(0, Math.min(255, Math.round(t * 255)));
  }
  return out;
}

/** Builds a 256x1 RGBA `DataTexture` transfer-function LUT from a colormap. */
function buildLutTexture(colormap: ColormapName): THREE.DataTexture {
  const lut = getColormapLUT(colormap); // Uint8Array(256*3), RGB
  const rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    rgba[i * 4] = lut[i * 3]!;
    rgba[i * 4 + 1] = lut[i * 3 + 1]!;
    rgba[i * 4 + 2] = lut[i * 3 + 2]!;
    rgba[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(rgba, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Vertex shader: a unit `BoxGeometry(1,1,1)` (local space `[-0.5,0.5]^3`).
 * Computes the camera's ray origin/direction *in the box's local space* (so
 * the fragment shader can ray-box-intersect against a fixed unit cube
 * regardless of the mesh's world transform/scale) and passes them as
 * varyings. `RawShaderMaterial` + `glslVersion: THREE.GLSL3` means nothing
 * is auto-injected — three.js still auto-*populates* the values of any
 * uniform whose name matches a built-in (`modelMatrix`, `modelViewMatrix`,
 * `projectionMatrix`, `cameraPosition`) every frame, we just have to
 * declare them ourselves.
 */
const VERTEX_SHADER = `precision highp float;

in vec3 position;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

out vec3 vOrigin;
out vec3 vDirection;

void main() {
  // Camera position transformed into this mesh's local (object) space.
  vOrigin = ( inverse( modelMatrix ) * vec4( cameraPosition, 1.0 ) ).xyz;
  vDirection = position - vOrigin;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/**
 * Fragment shader: raymarches the unit box in local space, sampling a 3D
 * density texture per step. Two modes:
 *
 * - MIP (uMode==0): tracks the maximum density along the ray; final color =
 *   colormap(maxDensity). Standard maximum-intensity projection.
 * - ISO (uMode==1): finds the first front-to-back crossing of `uIsovalue`,
 *   refines it with a linear interpolation between the straddling samples,
 *   and shades it with a fixed-direction lambert term computed from the
 *   local density gradient (central differences). Note the gradient of a
 *   *density* field points from low density (outside) to high density
 *   (inside) — the outward surface normal is the *negated*, normalized
 *   gradient (unlike an SDF, where the gradient itself is already outward).
 *
 * Per-axis box clipping (uClipMin/uClipMax, normalized `[0,1]` in texture
 * space) doubles as slicing: any sample outside the clip box is treated as
 * zero density, so it contributes to neither MIP's max nor ISO's crossing
 * search — carving a visible cut into the volume.
 */
const FRAGMENT_SHADER = `precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${MAX_MARCH_STEPS}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${MAX_MARCH_STEPS};
const vec3 BOX_MIN = vec3( -0.5 );
const vec3 BOX_MAX = vec3( 0.5 );

// Ray/box intersection (slab method) against the local unit box.
vec2 hitBox( vec3 orig, vec3 dir ) {
  vec3 invDir = 1.0 / dir;
  vec3 t0s = ( BOX_MIN - orig ) * invDir;
  vec3 t1s = ( BOX_MAX - orig ) * invDir;
  vec3 tsmaller = min( t0s, t1s );
  vec3 tbigger  = max( t0s, t1s );
  float t0 = max( tsmaller.x, max( tsmaller.y, tsmaller.z ) );
  float t1 = min( tbigger.x, min( tbigger.y, tbigger.z ) );
  return vec2( t0, t1 );
}

// Local-space position [-0.5,0.5]^3 -> texture coordinate [0,1]^3.
vec3 toTexCoord( vec3 localPos ) { return localPos + 0.5; }

bool inClip( vec3 uv ) {
  return all( greaterThanEqual( uv, uClipMin ) ) && all( lessThanEqual( uv, uClipMax ) );
}

// Density at a texture coordinate, zero outside the clip box (slicing).
float sampleDensity( vec3 uv ) {
  if ( !inClip( uv ) ) return 0.0;
  return texture( uData, uv ).r;
}

vec3 computeGradient( vec3 uv ) {
  float dx = sampleDensity( uv + vec3( uTexelSize.x, 0.0, 0.0 ) ) - sampleDensity( uv - vec3( uTexelSize.x, 0.0, 0.0 ) );
  float dy = sampleDensity( uv + vec3( 0.0, uTexelSize.y, 0.0 ) ) - sampleDensity( uv - vec3( 0.0, uTexelSize.y, 0.0 ) );
  float dz = sampleDensity( uv + vec3( 0.0, 0.0, uTexelSize.z ) ) - sampleDensity( uv - vec3( 0.0, 0.0, uTexelSize.z ) );
  return vec3( dx, dy, dz );
}

void main() {
  vec3 rayDir = normalize( vDirection );
  vec2 bounds = hitBox( vOrigin, rayDir );
  if ( bounds.x > bounds.y ) discard; // ray misses the box entirely

  float t0 = max( bounds.x, 0.0 ); // camera may be inside the box
  float t1 = bounds.y;
  if ( t1 <= t0 ) discard;

  float steps = clamp( uSteps, 1.0, float( MAX_STEPS ) );
  float dt = ( t1 - t0 ) / steps;

  if ( uMode == 0 ) {
    // ---- MIP: maximum-intensity projection ----
    float maxDensity = 0.0;
    float t = t0;
    for ( int i = 0; i < MAX_STEPS; i++ ) {
      if ( float( i ) >= steps ) break;
      vec3 uv = toTexCoord( vOrigin + rayDir * t );
      maxDensity = max( maxDensity, sampleDensity( uv ) );
      t += dt;
    }
    if ( maxDensity <= 0.001 ) discard; // ray hit nothing (or was clipped away)
    outColor = vec4( texture( uLUT, vec2( maxDensity, 0.5 ) ).rgb, 1.0 );
  } else {
    // ---- ISO: first-hit isosurface, gradient-shaded ----
    float prevD = sampleDensity( toTexCoord( vOrigin + rayDir * t0 ) );
    float t = t0 + dt;
    bool hit = false;
    vec3 hitUv = vec3( 0.0 );
    for ( int i = 1; i < MAX_STEPS; i++ ) {
      if ( float( i ) >= steps ) break;
      vec3 uv = toTexCoord( vOrigin + rayDir * t );
      float d = sampleDensity( uv );
      if ( prevD < uIsovalue && d >= uIsovalue ) {
        // Sub-step refinement: linearly interpolate the crossing point
        // between the previous and current samples.
        float denom = max( d - prevD, 1e-6 );
        float frac = ( uIsovalue - prevD ) / denom;
        hitUv = toTexCoord( vOrigin + rayDir * ( t - dt + dt * frac ) );
        hit = true;
        break;
      }
      prevD = d;
      t += dt;
    }
    if ( !hit ) discard;
    vec3 grad = computeGradient( hitUv );
    // Outward normal = -gradient (see function docstring above).
    vec3 normal = length( grad ) > 1e-6 ? -normalize( grad ) : vec3( 0.0, 0.0, 1.0 );
    vec3 lightDir = normalize( vec3( 0.4, 0.6, 0.7 ) );
    float diffuse = max( dot( normal, lightDir ), 0.0 );
    float shade = 0.35 + 0.65 * diffuse; // ambient floor + lambert term
    vec3 base = texture( uLUT, vec2( uIsovalue, 0.5 ) ).rgb;
    outColor = vec4( base * shade, 1.0 );
  }
}
`;

interface Uniforms {
  uData: { value: THREE.Data3DTexture };
  uLUT: { value: THREE.DataTexture };
  uMode: { value: number };
  uSteps: { value: number };
  uIsovalue: { value: number };
  uClipMin: { value: THREE.Vector3 };
  uClipMax: { value: THREE.Vector3 };
  uTexelSize: { value: THREE.Vector3 };
}

/**
 * Maps `[D,H,W]` shape/spacing/origin (the array/metadata axis order) onto
 * the box mesh's local `(x,y,z)` axes, which correspond to `(W,H,D)` — the
 * texture's `(width,height,depth)` — since the flat volume data is
 * row-major with `W` fastest-varying (`Data3DTexture(data, W, H, D)`).
 * Returns the mesh's world-space scale/position and the equivalent
 * `Scene3DBounds` (also in `(x,y,z)` order) for `fitToBounds`.
 */
function computeWorldPlacement(
  shape: [number, number, number],
  spacing: [number, number, number],
  origin: [number, number, number],
): { scale: [number, number, number]; position: [number, number, number]; bounds: Scene3DBounds } {
  const [d, h, w] = shape;
  const sizeX = w * spacing[2];
  const sizeY = h * spacing[1];
  const sizeZ = d * spacing[0];
  const minX = origin[2];
  const minY = origin[1];
  const minZ = origin[0];
  return {
    scale: [sizeX, sizeY, sizeZ],
    position: [minX + sizeX / 2, minY + sizeY / 2, minZ + sizeZ / 2],
    bounds: { min: [minX, minY, minZ], max: [minX + sizeX, minY + sizeY, minZ + sizeZ] },
  };
}

function VolumeViewerInner({
  data,
  shape,
  spacing,
  origin,
  vmin,
  vmax,
  mode,
  isovalue,
  colormap,
  steps,
  clip,
  background,
  className,
  sync = null,
  onFrame,
  showAxes = false,
  showPlanes = false,
  cameraMode = "orbital",
}: VolumeViewerProps) {
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
  const geometryRef = useRef<THREE.BoxGeometry | null>(null);
  const materialRef = useRef<THREE.RawShaderMaterial | null>(null);
  const dataTextureRef = useRef<THREE.Data3DTexture | null>(null);
  const lutTextureRef = useRef<THREE.DataTexture | null>(null);

  // ── Rebuild everything when the volume itself changes (data/shape/
  // spacing/origin/vmin/vmax). Textures are the heavy resource here (a
  // D*H*W byte buffer per volume/step) so this disposes aggressively —
  // every previous texture/geometry/material is torn down before the new
  // one is created, not just on unmount. ──────────────────────────────────
  useEffect(() => {
    const scene = refs.scene.current;
    if (!scene) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
      dataTextureRef.current?.dispose();
      lutTextureRef.current?.dispose();
    }

    const [d, h, w] = shape;
    const density = toUint8Density(data, vmin, vmax);
    const dataTexture = new THREE.Data3DTexture(density, w, h, d);
    dataTexture.format = THREE.RedFormat;
    dataTexture.type = THREE.UnsignedByteType;
    dataTexture.minFilter = THREE.LinearFilter;
    dataTexture.magFilter = THREE.LinearFilter;
    dataTexture.wrapR = THREE.ClampToEdgeWrapping;
    dataTexture.wrapS = THREE.ClampToEdgeWrapping;
    dataTexture.wrapT = THREE.ClampToEdgeWrapping;
    dataTexture.needsUpdate = true;

    const lutTexture = buildLutTexture(colormap);

    const uniforms: Uniforms = {
      uData: { value: dataTexture },
      uLUT: { value: lutTexture },
      uMode: { value: mode === "mip" ? 0 : 1 },
      uSteps: { value: steps },
      uIsovalue: { value: isovalue },
      uClipMin: { value: new THREE.Vector3(...clip.min) },
      uClipMax: { value: new THREE.Vector3(...clip.max) },
      uTexelSize: { value: new THREE.Vector3(1 / w, 1 / h, 1 / d) },
    };

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
      // Render back faces: guarantees a fragment is produced whether the
      // camera is outside the box (usual case) or has orbited inside it
      // (front faces would otherwise be behind the camera / culled).
      side: THREE.BackSide,
      transparent: false,
    });

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    const { scale, position, bounds } = computeWorldPlacement(shape, spacing, origin);
    mesh.scale.set(...scale);
    mesh.position.set(...position);

    scene.add(mesh);
    meshRef.current = mesh;
    geometryRef.current = geometry;
    materialRef.current = material;
    dataTextureRef.current = dataTexture;
    lutTextureRef.current = lutTexture;

    fitToBounds(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, shape, spacing, origin, vmin, vmax]);

  // ── Colormap (LUT texture swap, no rebuild of the volume itself) ───────
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    lutTextureRef.current?.dispose();
    const lutTexture = buildLutTexture(colormap);
    lutTextureRef.current = lutTexture;
    (material.uniforms as unknown as Uniforms).uLUT.value = lutTexture;
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colormap]);

  // ── Cheap uniform updates: mode/isovalue/steps/clip (no rebuild) ───────
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    const u = material.uniforms as unknown as Uniforms;
    u.uMode.value = mode === "mip" ? 0 : 1;
    u.uSteps.value = steps;
    u.uIsovalue.value = isovalue;
    u.uClipMin.value.set(...clip.min);
    u.uClipMax.value.set(...clip.max);
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isovalue, steps, clip]);

  // ── Dispose this viewer's own geometry/material/textures on unmount ────
  useEffect(() => {
    return () => {
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
      dataTextureRef.current?.dispose();
      lutTextureRef.current?.dispose();
    };
  }, []);

  return <Scene3DCanvas handle={handle} className={className} />;
}

/**
 * Self-contained WebGL2 raymarched volume viewer, built on the shared
 * `useScene3D` lifecycle. Feature-detects WebGL2 once per session (three.js
 * itself requires it — see `supportsWebGL2`) and renders an explanatory
 * placeholder instead of crashing when it's unavailable.
 */
export default function VolumeViewer(props: VolumeViewerProps) {
  if (!supportsWebGL2()) {
    return <VolumeUnavailablePlaceholder className={props.className} />;
  }
  return <VolumeViewerInner {...props} />;
}

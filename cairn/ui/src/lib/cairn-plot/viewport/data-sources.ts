/**
 * The data-source seam for `ViewportModule.useData` implementations.
 *
 * `ViewportModule.useData` turns an already-resolved artifact hash into
 * render-ready `TData` (see `types.ts`'s doc comments). Today the ONLY
 * concrete implementations are app-side (`components/viewport-registry.tsx`'s
 * `useImageData`, `components/PointCloudVisualCard.tsx`'s `usePointCloudData`)
 * and both resolve a hash via the app's `api.artifactUrl` — a dependency
 * cairn-plot itself must NOT import (it would pull the app's API client into
 * a library that's meant to also ship as a standalone Python-emitted bundle,
 * see the cairn-plot design spec's "data-sources" section).
 *
 * This file extracts the PURE hash -> TData mapping cores, parameterized by
 * a small `DataSource` interface, so the app and a future plot bundle share
 * the exact same logic:
 *  - the app passes an ENDPOINT `DataSource` wrapping its own
 *    `api.artifactUrl` (`createEndpointDataSource`, this file's only
 *    implementation today);
 *  - a future plot bundle (Phase B) passes either the SAME kind of ENDPOINT
 *    source (pointed at an absolute server URL) or a LOCAL source that reads
 *    content-addressed blobs baked into the page (a page-level
 *    `window.__cairnPlotStore`, see the design spec's §5) — `DataSource` is
 *    the seam either implementation plugs into; no local provider is wired
 *    up yet (that's Phase B — this file only adds the interface + today's
 *    endpoint impl).
 *
 * BEHAVIOR-PRESERVING: `resolveImageViewportItems`/`fetchPointCloudArrays`
 * are the same logic that lived inline in `viewport-registry.tsx` /
 * `PointCloudVisualCard.tsx`, just parameterized over `source` instead of
 * calling `api.artifactUrl` directly.
 */

import type { ImageOverlayData } from "../types";
import type { ImageViewportItem } from "./image-viewport";
import type { ViewportDataArgs, ViewportDataResult } from "./types";
import { parseNpy, parseNpz } from "../transforms";
import type { PropertyMap } from "../three/properties";
import { extractProperties } from "../three/properties";

/**
 * Resolves a content-addressed artifact hash to fetchable data. Two shapes
 * are needed across today's viewport types:
 *  - `artifactUrl`: hash -> URL (image just needs a URL — no fetch by the
 *    renderer itself, an `<img src>` does the fetching; also usable as a
 *    generic fetch() target);
 *  - `bytes`: hash -> raw bytes (binary parsers — npy/npz — need the actual
 *    payload). Async uniformly: the ENDPOINT implementation fetches over the
 *    network; a future LOCAL implementation resolves synchronously in
 *    practice but still returns a `Promise` so call sites don't branch on
 *    the source kind.
 */
export interface DataSource {
  artifactUrl(hash: string): string;
  bytes(hash: string): Promise<ArrayBuffer>;
}

/**
 * The ENDPOINT `DataSource` — wraps an `artifactUrl` formatter (the app's
 * `api.artifactUrl`, or an absolute `${server}/api/artifacts/${hash}`
 * builder for the future plot-bundle ENDPOINT mode) and derives `bytes`
 * from it via a plain `fetch()`. This is the app's default (and, today,
 * only) `DataSource` — behavior-identical to the pre-extraction inline
 * `api.artifactUrl(...)` / `fetch(api.artifactUrl(...))` call sites.
 */
export function createEndpointDataSource(artifactUrl: (hash: string) => string): DataSource {
  return {
    artifactUrl,
    async bytes(hash: string): Promise<ArrayBuffer> {
      const res = await fetch(artifactUrl(hash));
      if (!res.ok) {
        throw new Error(`failed to fetch artifact ${hash} (${res.status})`);
      }
      return res.arrayBuffer();
    },
  };
}

// ---------------------------------------------------------------------------
// image — pure, synchronous hash -> ImageViewportItem mapping (no network:
// `DataSource.artifactUrl` is a plain string formatter). Mirrors
// `viewport-registry.tsx`'s pre-extraction `useImageData` body exactly;
// `parseOverlay` is passed in rather than imported here since it's app-owned
// (`viewport-registry.tsx`, reused by `VisualContentCard.tsx`) and has no
// dependency of its own on `api.artifactUrl` that needs extracting.
// ---------------------------------------------------------------------------
export function resolveImageViewportItems(
  args: Pick<ViewportDataArgs, "hashes" | "referenceHashes" | "metadata">,
  source: DataSource,
  parseOverlay: (raw: string | null | undefined) => ImageOverlayData | null,
): ViewportDataResult<ImageViewportItem> {
  const { hashes, referenceHashes, metadata } = args;
  return {
    items: hashes.map((h, i) =>
      h ? { url: source.artifactUrl(h), overlay: parseOverlay(metadata?.[i]) } : null,
    ),
    referenceItems: referenceHashes.map((h) => (h ? { url: source.artifactUrl(h) } : null)),
    isLoading: false,
  };
}

// ---------------------------------------------------------------------------
// pointcloud — fetch + parse a single point-cloud artifact. Mirrors
// `PointCloudVisualCard.tsx`'s pre-extraction `fetchPointCloudArrays`
// exactly, just resolving bytes via `source.bytes` instead of
// `fetch(api.artifactUrl(hash))` directly. React-query wiring (caching,
// `isLoading`) stays card-owned (`usePointCloudBlobs`/`usePointCloudData`) —
// this is only the pure fetch+parse core.
// ---------------------------------------------------------------------------
export interface PointCloudArrays {
  data: Float32Array;
  properties: PropertyMap;
}

function looksLikeNpz(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 2) return false;
  const view = new Uint8Array(buf, 0, 2);
  return view[0] === 0x50 && view[1] === 0x4b; // "PK\x03\x04"
}

export async function fetchPointCloudArrays(
  hash: string,
  source: DataSource,
): Promise<PointCloudArrays> {
  const buf = await source.bytes(hash);
  if (looksLikeNpz(buf)) {
    const npz = await parseNpz(buf);
    if (!npz.points) throw new Error("point cloud npz missing 'points'");
    return { data: Float32Array.from(npz.points.data), properties: extractProperties(npz) };
  }
  const parsed = parseNpy(buf);
  // The shared parser returns Float64Array for uniform downstream math;
  // three.js BufferAttributes require Float32Array, so narrow once here.
  return { data: Float32Array.from(parsed.data), properties: {} };
}

// ---------------------------------------------------------------------------
// mesh — fetch + parse a single mesh artifact (G3b). Mirrors
// `MeshVisualCard.tsx`'s pre-extraction `fetchMeshArrays` exactly, just
// resolving bytes via `source.bytes` instead of
// `fetch(api.artifactUrl(hash))` directly. Meshes are always `.npz`
// (positions + faces + optional colors/normals/values), so no `.npy`
// content-sniff branch is needed. React-query wiring stays card-owned; this
// is only the pure fetch+parse core, also driven by the LOCAL plot bundle.
// ---------------------------------------------------------------------------
export interface MeshArrays {
  positions: Float32Array;
  faces: Uint32Array;
  properties: PropertyMap;
  colors: Float32Array | null;
  /** Flat per-FACE RGB(A) (0-1), `(nFaces * 3)` or `(nFaces * 4)`; drives the
   *  viewer's "face-colors" mode. `null` when the blob has no `face_colors`. */
  faceColors: Float32Array | null;
  normals: Float32Array | null;
}

export async function fetchMeshArrays(hash: string, source: DataSource): Promise<MeshArrays> {
  const npz = await parseNpz(await source.bytes(hash));
  if (!npz.positions || !npz.faces) {
    throw new Error("mesh blob missing positions/faces");
  }
  return {
    positions: Float32Array.from(npz.positions.data),
    faces: Uint32Array.from(npz.faces.data),
    properties: extractProperties(npz),
    colors: npz.colors ? Float32Array.from(npz.colors.data) : null,
    faceColors: npz.face_colors ? Float32Array.from(npz.face_colors.data) : null,
    normals: npz.normals ? Float32Array.from(npz.normals.data) : null,
  };
}

// ---------------------------------------------------------------------------
// volume — fetch + parse a single volume artifact (G3b). Mirrors
// `VolumeVisualCard.tsx`'s pre-extraction `fetchVolumeArray` exactly. Returns
// the raw scalar grid as a Float32Array (three.js Data3DTexture needs f32);
// shape/vmin/vmax/spacing/origin/bounds live in the inline `meta`.
// ---------------------------------------------------------------------------
export async function fetchVolumeArray(hash: string, source: DataSource): Promise<Float32Array> {
  const npz = await parseNpz(await source.bytes(hash));
  if (!npz.data) throw new Error("volume artifact is missing its 'data' array");
  // The shared parser returns Float64Array for uniform downstream math;
  // three.js Data3DTexture needs Float32Array, so narrow once here.
  return Float32Array.from(npz.data.data);
}

// ---------------------------------------------------------------------------
// boxes3d — fetch + parse a single boxes artifact (G3b). Mirrors
// `BoxesVisualCard.tsx`'s pre-extraction `fetchBoxesArrays` exactly.
// ---------------------------------------------------------------------------
export interface BoxesArrays {
  mins: Float32Array;
  maxs: Float32Array;
  depth: Float32Array;
  properties: PropertyMap;
}

export async function fetchBoxesArrays(hash: string, source: DataSource): Promise<BoxesArrays> {
  const npz = await parseNpz(await source.bytes(hash));
  if (!npz.mins || !npz.maxs || !npz.depth) {
    throw new Error("boxes blob missing mins/maxs/depth");
  }
  return {
    mins: Float32Array.from(npz.mins.data),
    maxs: Float32Array.from(npz.maxs.data),
    depth: Float32Array.from(npz.depth.data),
    properties: extractProperties(npz),
  };
}

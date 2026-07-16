/**
 * GpuImagePane — the first LIVE on-screen WebGPU (RHI) image renderer (Task 6
 * of the WebGPU engine, Sub-project 1). Wraps `engine/image-engine.ts`'s
 * `renderImage()` (Task 5) + `engine/pool.ts`'s many-panes resource pool
 * behind the SAME prop shapes `ImagePane`/`HdrImagePane` already use, so the
 * registry (`plot-registry.tsx`) can swap it in for the `"image"`/`"imagehdr"`
 * renderer keys as a drop-in replacement (Task 8's job — NOT done here; see
 * `plot-gpu-image-addon.tsx`).
 *
 * ## Two prop shapes, one component
 * `GpuImagePaneProps = HdrGpuImagePaneProps | SdrGpuImagePaneProps` — presence
 * of `hdr` selects the HDR-float path (mirrors `HdrImagePane`'s contract
 * exactly); its absence selects the SDR `imageUrl` path (mirrors
 * `ImagePane`'s contract). Both retain the CPU source buffer the TEV overlay
 * (`PixelValueOverlay`) reads, exactly like the two CPU panes do.
 *
 * ## SCOPE (documented gaps — see Task 6 report for the full rationale)
 * `Task 7 adds compare/metrics` per the brief, so the SDR path here handles
 * the PLAIN single-image case only:
 *   - `colormap` false-colors CPU-side via the exact same `applyColormap`
 *     ImagePane uses (byte-identical source pixels), then the GPU pass is a
 *     PURE PASSTHROUGH blit (`operator:"linear", gamma:1, exposureEV:0`) —
 *     the already sRGB-encoded 8-bit bytes go in and come out unchanged
 *     (linear-clamp is a no-op on [0,1]; gamma:1 makes output-encode an
 *     identity `pow(x,1)`), so this is pixel-for-pixel what `<img>`/a plain
 *     `<canvas>` already show — only the FINAL blit + zoom/pan moved to the
 *     GPU (`uvRect`), matching the brief's ask.
 *   - `diffMode !== "none"` / `baselineUrl` (baseline-compare) and
 *     `processing`'s CSS-filter fields (brightness/contrast/offset/flipSign)
 *     are ACCEPTED (prop-compatible) but NOT rendered specially — the plain
 *     `imageUrl` alone is shown. Real compare lives in Task 7; this pane is
 *     not wired into any live page yet (registered behind a capability flag,
 *     `plot-gpu-image-addon.tsx`, not emitted by Python), so the gap has no
 *     production surface today.
 *
 * The HDR path is FULL parity with `HdrImagePane`: exposure/tonemap/gamma are
 * genuinely applied by the GPU shader (not a CPU pass), which is the whole
 * point of Task 6 — see the browser harness's readback-vs-`tonemap.ts`
 * assertion.
 *
 * ## Render triggers (on demand, NOT per animation frame)
 * One `useEffect` re-uploads the source texture only when the DECODED pixels
 * change (`hdr` identity / `imageUrl`+`colormap`); a second re-renders
 * whenever viewport (zoom/pan → `uvRect`), `exposure`, `tonemap`/`operator`,
 * or `gamma` change, or the container resizes (object-contain fit depends on
 * the live box). `engine/pool.ts`'s `acquirePane`/`releasePane` own the
 * GPU-resource lifecycle (shared WebGPU device / per-pane WebGL2 device, LRU
 * park/restore, the live-swapchain cap).
 *
 * ## Zoom/pan -> uvRect
 * `useImageViewport` (unchanged — same Alt-gated wheel-zoom-to-cursor +
 * pointer-drag pan, same `Viewport` shape) still owns the CSS-px zoom/pan
 * STATE; `viewportToUvRect` converts it into the source-space `[x,y,w,h]`
 * window `renderImage` samples, using the same object-contain fit math
 * `PixelValueOverlay` already computes from the pane's live rect — GPU-side
 * pan/zoom instead of a CSS transform, per the brief.
 *
 * ## Double-click reset (Q17 — user request)
 * Double-clicking the pane resets the viewport to `{zoom:1, pan:{x:0,y:0}}`
 * via `onViewportChange`, consistent with the 2D charts' double-click-reset.
 * Compare-view double-click-reset is Task 7's job (`CompositeMediaPane`).
 *
 * ## Off-screen park/restore
 * An `IntersectionObserver` on the pane container calls the pool handle's
 * `park()`/`restore()` as the pane leaves/enters the viewport, proactively
 * freeing GPU memory (and, on WebGL2, the scarce per-pane GL context)
 * instead of waiting for LRU cap pressure from other panes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Colormap,
  DiffMode,
  ImageOverlayData,
  ImageOverlaySettings,
  ImageProcessing,
  Interpolation,
} from "../types";
import { applyColormap, DIVERGING_COLORMAPS } from "../colormaps";
import { loadImageData, getCachedImageData, setCachedImageData } from "../image";
import PixelAxes from "../primitives/PixelAxes";
import LabelChip from "../primitives/LabelChip";
import ImageOverlay from "./ImageOverlay";
import PixelValueOverlay, {
  CHANNEL_COLORS,
  PixelNotationToggle,
  formatChannelValue,
  type PixelSample,
  type PixelValueNotation,
} from "../primitives/PixelValueOverlay";
import { useImageViewport, type Viewport as ImageViewport } from "../hooks/use-image-viewport";
import { acquirePane, releasePane, type PaneHandle, type SourceUpload } from "../engine/pool";
import type { ImageOperator, ImageParams } from "../engine/image-engine";

// ---------------------------------------------------------------------------
// HDR data contract — mirrors `HdrImagePane.tsx`'s `HdrData` exactly (kept
// as a separate local type so this file has no import-cycle onto
// HdrImagePane; the SHAPE is identical, and callers already producing one
// (via `parseNpy`) satisfy the other with no adapter).
// ---------------------------------------------------------------------------
export interface HdrData {
  data: Float64Array | Float32Array;
  shape: number[];
  dtype: string;
}

export interface HdrGpuImagePaneProps {
  hdr: HdrData;
  tonemap?: string;
  exposure?: number;
  gamma?: number;
  showAxes?: boolean;
  label?: string;
  interpolation?: Interpolation;
  zoom?: number;
  pan?: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;
  pixelValueNotation?: PixelValueNotation;
}

export interface SdrGpuImagePaneProps {
  imageUrl: string | null;
  baselineUrl?: string | null;
  isBaseline?: boolean;
  diffMode?: "none" | DiffMode;
  interpolation?: Interpolation;
  colormap?: Colormap;
  showAxes?: boolean;
  processing?: ImageProcessing;
  zoom?: number;
  pan?: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;
  onNaturalSize?: (w: number, h: number) => void;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  className?: string;
  overlay?: ImageOverlayData;
  overlaySettings?: ImageOverlaySettings;
  pixelValueNotation?: PixelValueNotation;
}

export type GpuImagePaneProps = HdrGpuImagePaneProps | SdrGpuImagePaneProps;

function isHdrProps(p: GpuImagePaneProps): p is HdrGpuImagePaneProps {
  return "hdr" in p && p.hdr != null;
}

const OPERATORS: readonly ImageOperator[] = ["linear", "srgb", "reinhard", "aces"];
function toOperator(name: string | undefined): ImageOperator {
  return (name && (OPERATORS as readonly string[]).includes(name) ? name : "srgb") as ImageOperator;
}

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

function shapeDims(shape: number[]): { h: number; w: number; c: number } {
  if (shape.length === 2) return { h: shape[0]!, w: shape[1]!, c: 1 };
  if (shape.length === 3) return { h: shape[0]!, w: shape[1]!, c: shape[2]! };
  throw new Error(`GpuImagePane: unsupported HDR shape [${shape.join(",")}] (want [H,W] or [H,W,C]).`);
}

/** Expand the raw float HDR buffer into an RGBA `Float32Array` upload — NO
 *  exposure/tonemap/encode here (that's the GPU shader's job); mirrors
 *  `HdrImagePane`'s `tonemapToImageData` per-pixel channel extraction. */
function hdrToRGBAFloat32(hdr: HdrData): SourceUpload {
  const { h, w, c } = shapeDims(hdr.shape);
  const src = hdr.data;
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const base = i * c;
    let r: number;
    let g: number;
    let b: number;
    let a = 1;
    if (c === 1) {
      r = g = b = finite(src[base]!);
    } else if (c === 3) {
      r = finite(src[base]!);
      g = finite(src[base + 1]!);
      b = finite(src[base + 2]!);
    } else {
      r = finite(src[base]!);
      g = finite(src[base + 1]!);
      b = finite(src[base + 2]!);
      a = finite(src[base + 3]!);
    }
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
  return { data: out, width: w, height: h, format: "rgba32float" };
}

/**
 * Converts the CSS-px `{zoom,pan}` viewport (owned by `useImageViewport`,
 * same coordinate system as the CSS-transform legacy panes used) into the
 * source-space `[0,1]` `uv` window `renderImage` samples, so a fixed-size
 * (natural-dims) GPU canvas reproduces the same crop the legacy CSS
 * `translate(pan) scale(zoom)` transform on an object-contain-fitted element
 * would have shown. See this file's module doc for the derivation.
 */
export function viewportToUvRect(
  viewport: ImageViewport,
  paneBox: { width: number; height: number },
  naturalW: number,
  naturalH: number,
): { x: number; y: number; w: number; h: number } {
  if (naturalW <= 0 || naturalH <= 0 || paneBox.width <= 0 || paneBox.height <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const scale = Math.min(paneBox.width / naturalW, paneBox.height / naturalH);
  const dispW = naturalW * scale;
  const dispH = naturalH * scale;
  const imgLeft = (paneBox.width - dispW) / 2;
  const imgTop = (paneBox.height - dispH) / 2;
  const z = Math.max(viewport.zoom, 1e-6);
  const w = 1 / z;
  const h = 1 / z;
  const x = (imgLeft * (1 - z) - viewport.pan.x) / (dispW * z);
  const y = (imgTop * (1 - z) - viewport.pan.y) / (dispH * z);
  return { x, y, w, h };
}

const HOME_VIEWPORT: ImageViewport = { zoom: 1, pan: { x: 0, y: 0 } };

export default function GpuImagePane(props: GpuImagePaneProps) {
  const hdrMode = isHdrProps(props);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const imgWrapperRef = useRef<HTMLDivElement | null>(null);
  const paneHandleRef = useRef<PaneHandle | null>(null);

  const [paneReady, setPaneReady] = useState(false);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
  const [uploadVersion, setUploadVersion] = useState(0);
  const [containerTick, setContainerTick] = useState(0);

  // TEV overlay source buffers (retained CPU pixels, mirrors ImagePane's
  // valueDataRef / HdrImagePane's `hdr.data`).
  const hdrDataRef = useRef<HdrData | null>(null);
  const sdrImageDataRef = useRef<ImageData | null>(null);
  const [pixelDataVersion, setPixelDataVersion] = useState(0);
  const [notation, setNotation] = useState<PixelValueNotation>(props.pixelValueNotation ?? "decimal");
  const [overlayActive, setOverlayActive] = useState(false);

  const zoom = props.zoom ?? 1;
  const pan = props.pan ?? { x: 0, y: 0 };
  const onViewportChange = props.onViewportChange;
  const sdrColormap = hdrMode ? "none" : ((props as SdrGpuImagePaneProps).colormap ?? "none");

  // -----------------------------------------------------------------------
  // Acquire/release the pool handle for this canvas.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    acquirePane(canvas).then((handle) => {
      if (cancelled) {
        releasePane(handle);
        return;
      }
      paneHandleRef.current = handle;
      setPaneReady(true);
    });
    return () => {
      cancelled = true;
      if (paneHandleRef.current) {
        releasePane(paneHandleRef.current);
        paneHandleRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Viewport interaction (Alt-gated wheel zoom-to-cursor + pointer pan) —
  // REUSED verbatim from the CPU panes; only the CONSUMPTION (uvRect instead
  // of a CSS transform) differs.
  // -----------------------------------------------------------------------
  const { containerProps: viewportProps } = useImageViewport({
    containerRef: paneRef,
    zoom,
    pan,
    onViewportChange,
  });

  const resetViewport = useCallback(() => {
    onViewportChange?.(HOME_VIEWPORT);
  }, [onViewportChange]);

  // Redraw the TEV overlay / re-run the render pass when the container's own
  // box changes (object-contain fit depends on the live rect).
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // -----------------------------------------------------------------------
  // Off-screen park/restore.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const handle = paneHandleRef.current;
        if (!handle) return;
        if (entry.isIntersecting) {
          if (handle.isParked) {
            handle.restore();
            setContainerTick((t) => t + 1); // force a re-render pass
          }
        } else {
          handle.park();
        }
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // -----------------------------------------------------------------------
  // HDR mode: decode/retain source, upload on identity change.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!hdrMode || !paneReady) return;
    const hdr = (props as HdrGpuImagePaneProps).hdr;
    hdrDataRef.current = hdr;
    const upload = hdrToRGBAFloat32(hdr);
    paneHandleRef.current?.setSource(upload);
    setNaturalDims((prev) =>
      prev && prev.w === upload.width && prev.h === upload.height ? prev : { w: upload.width, h: upload.height },
    );
    setPixelDataVersion((v) => v + 1);
    setUploadVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hdrMode, paneReady, hdrMode ? (props as HdrGpuImagePaneProps).hdr : null]);

  // -----------------------------------------------------------------------
  // SDR mode: decode `imageUrl` (+ optional CPU colormap false-color, exact
  // parity with ImagePane), retain for the overlay, upload on change.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (hdrMode || !paneReady) return;
    const p = props as SdrGpuImagePaneProps;
    const imageUrl = p.imageUrl;
    const colormap = p.colormap ?? "none";
    if (!imageUrl) {
      sdrImageDataRef.current = null;
      setNaturalDims(null);
      setPixelDataVersion((v) => v + 1);
      return;
    }
    let cancelled = false;
    loadImageData(imageUrl).then((raw) => {
      if (cancelled || !raw) return;
      let display = raw;
      if (colormap !== "none") {
        const cacheKey = `gpu::${imageUrl}::${colormap}`;
        const cached = getCachedImageData(cacheKey);
        if (cached) {
          display = cached;
        } else {
          const cmapMode = DIVERGING_COLORMAPS.has(colormap) ? "positive" : "linear";
          display = applyColormap(raw, colormap as Exclude<Colormap, "none">, cmapMode);
          setCachedImageData(cacheKey, display);
        }
      }
      sdrImageDataRef.current = raw; // TEV overlay reads the RAW source, like ImagePane.
      const upload: SourceUpload = {
        data: display.data,
        width: display.width,
        height: display.height,
        format: "rgba8unorm",
      };
      paneHandleRef.current?.setSource(upload);
      setNaturalDims((prev) =>
        prev && prev.w === display.width && prev.h === display.height
          ? prev
          : { w: display.width, h: display.height },
      );
      p.onNaturalSize?.(display.width, display.height);
      setPixelDataVersion((v) => v + 1);
      setUploadVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hdrMode, paneReady, hdrMode ? null : (props as SdrGpuImagePaneProps).imageUrl, hdrMode ? null : (props as SdrGpuImagePaneProps).colormap]);

  // -----------------------------------------------------------------------
  // Render pass — on demand: mount (via uploadVersion bump above) +
  // viewport/exposure/operator/gamma/container-resize change. NOT per frame.
  // -----------------------------------------------------------------------
  const exposure = hdrMode ? ((props as HdrGpuImagePaneProps).exposure ?? 0) : 0;
  const tonemapName = hdrMode ? (props as HdrGpuImagePaneProps).tonemap : undefined;
  const gamma = hdrMode ? (props as HdrGpuImagePaneProps).gamma : undefined;

  useEffect(() => {
    const handle = paneHandleRef.current;
    if (!handle || !paneReady || !naturalDims) return;
    const paneEl = paneRef.current;
    const box = paneEl ? paneEl.getBoundingClientRect() : { width: naturalDims.w, height: naturalDims.h };
    const uv = viewportToUvRect({ zoom, pan }, box, naturalDims.w, naturalDims.h);
    const params: ImageParams = hdrMode
      ? { exposureEV: exposure, operator: toOperator(tonemapName), gamma, isScalar: false, hdrOut: false, uv }
      : { exposureEV: 0, operator: "linear", gamma: 1, isScalar: false, hdrOut: false, uv };
    handle.render(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneReady, naturalDims, uploadVersion, zoom, pan.x, pan.y, exposure, tonemapName, gamma, containerTick, hdrMode]);

  // -----------------------------------------------------------------------
  // TEV per-pixel value overlay sampler.
  // -----------------------------------------------------------------------
  const samplePixel = useCallback(
    (px: number, py: number, notationArg: PixelValueNotation): PixelSample | null => {
      if (hdrMode) {
        const hdr = hdrDataRef.current;
        const dims = naturalDims;
        if (!hdr || !dims || px < 0 || py < 0 || px >= dims.w || py >= dims.h) return null;
        const c = hdr.shape.length === 2 ? 1 : (hdr.shape[2] ?? 1);
        const base = (py * dims.w + px) * c;
        const src = hdr.data;
        // Luminance approximated at 0.5 (mid-grey) — matches HdrImagePane's
        // fallback when no CPU-tonemapped buffer is retained (GPU-rendered).
        const luminance = 0.5;
        if (c === 1) {
          return { lines: [formatChannelValue(src[base] ?? 0, "unit", notationArg)], luminance };
        }
        return {
          lines: [
            formatChannelValue(src[base] ?? 0, "unit", notationArg),
            formatChannelValue(src[base + 1] ?? 0, "unit", notationArg),
            formatChannelValue(src[base + 2] ?? 0, "unit", notationArg),
          ],
          luminance,
          colors: [CHANNEL_COLORS[0], CHANNEL_COLORS[1], CHANNEL_COLORS[2]],
        };
      }
      const vd = sdrImageDataRef.current;
      if (!vd || px < 0 || py < 0 || px >= vd.width || py >= vd.height) return null;
      const i = (py * vd.width + px) * 4;
      const r = vd.data[i]!;
      const g = vd.data[i + 1]!;
      const b = vd.data[i + 2]!;
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const single = sdrColormap !== "none" || (r === g && g === b);
      if (single) {
        return { lines: [formatChannelValue(r, "uint8", notationArg)], luminance };
      }
      return {
        lines: [
          formatChannelValue(r, "uint8", notationArg),
          formatChannelValue(g, "uint8", notationArg),
          formatChannelValue(b, "uint8", notationArg),
        ],
        luminance,
        colors: [CHANNEL_COLORS[0], CHANNEL_COLORS[1], CHANNEL_COLORS[2]],
      };
    },
    [hdrMode, naturalDims, sdrColormap],
  );

  // -----------------------------------------------------------------------
  // Render.
  // -----------------------------------------------------------------------
  const showAxes = props.showAxes ?? false;
  const label = hdrMode ? ((props as HdrGpuImagePaneProps).label ?? "") : (props as SdrGpuImagePaneProps).label;
  const interpolation = props.interpolation ?? "auto";
  const imgRendering = interpolation === "auto" ? undefined : interpolation;
  const overlay = hdrMode ? undefined : (props as SdrGpuImagePaneProps).overlay;
  const overlaySettings = hdrMode ? undefined : (props as SdrGpuImagePaneProps).overlaySettings;
  const isDraggable = hdrMode ? false : ((props as SdrGpuImagePaneProps).isDraggable ?? false);
  const onDragStart = hdrMode ? undefined : (props as SdrGpuImagePaneProps).onDragStart;

  return (
    <div className="relative flex flex-col h-full" data-gpu-image-pane data-gpu-backend-ready={paneReady}>
      <div
        ref={paneRef}
        className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard"
        style={{ padding: showAxes && naturalDims ? "16px 4px 4px 28px" : "4px", ...viewportProps.style }}
        onPointerDown={viewportProps.onPointerDown}
        onPointerMove={viewportProps.onPointerMove}
        onPointerUp={viewportProps.onPointerUp}
        onPointerCancel={viewportProps.onPointerCancel}
        onDoubleClick={resetViewport}
        data-gpu-image-viewport
      >
        <div ref={imgWrapperRef} className="relative w-full h-full">
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain block"
            style={{ imageRendering: imgRendering }}
            data-gpu-image-canvas
          />
          {showAxes && naturalDims && (
            <PixelAxes
              naturalWidth={naturalDims.w}
              naturalHeight={naturalDims.h}
              zoom={zoom}
              containerRef={imgWrapperRef}
            />
          )}
          {overlay &&
            overlaySettings?.enabled &&
            naturalDims &&
            ((overlay.boxes?.length ?? 0) > 0 || (overlay.masks?.length ?? 0) > 0) && (
              <ImageOverlay
                data={overlay}
                settings={overlaySettings}
                naturalWidth={naturalDims.w}
                naturalHeight={naturalDims.h}
              />
            )}
        </div>
        {naturalDims && (
          <PixelValueOverlay
            imageElRef={canvasRef}
            naturalWidth={naturalDims.w}
            naturalHeight={naturalDims.h}
            zoom={zoom}
            pan={pan}
            sample={samplePixel}
            notation={notation}
            version={pixelDataVersion}
            onActiveChange={setOverlayActive}
          />
        )}
        {overlayActive && <PixelNotationToggle notation={notation} onChange={setNotation} />}
      </div>
      {label ? <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} /> : null}
    </div>
  );
}

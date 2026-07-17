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
 * GPU-resource lifecycle (the shared WebGPU device, LRU park/restore, the
 * live-swapchain cap).
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
 * freeing GPU memory instead of waiting for LRU cap pressure from other
 * panes. It also reports
 * every transition to `handle.setVisible()` so `engine/pool.ts`'s LRU can
 * prefer evicting an OFF-SCREEN pane over an on-screen one when the cap is
 * hit by pane count alone (more visible panes than `MAX_LIVE_SWAPCHAINS` — a
 * gallery bigger than the cap). A pane the LRU parks that way stays fully
 * on-screen-looking (its canvas keeps showing its last frame) until it's
 * next asked to render, at which point `PaneHandle.render()` transparently
 * restores it first (see `engine/pool.ts`'s module doc) — so a viewport zoom/
 * pan, an exposure/operator change, or the double-click reset on a
 * cap-parked-but-visible pane always paints a live, correct frame.
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
  PIXEL_VALUE_MIN_SCREEN_PX,
  PixelNotationToggle,
  formatChannelValue,
  type PixelSample,
  type PixelValueNotation,
} from "../primitives/PixelValueOverlay";
import { useImageViewport, type Viewport as ImageViewport } from "../hooks/use-image-viewport";
import { useDevicePixelRatio } from "../hooks/use-device-pixel-ratio";
import { acquirePane, releasePane, type PaneHandle, type SourceUpload } from "../engine/pool";
import { getSharedDevice } from "../engine/device";
import type { ImageOperator, ImageParams } from "../engine/image-engine";
// C1 fix (whole-branch review) — the LEGACY CPU panes, used as the fallback
// when the engine fails to activate/render (see `engineFailed` state below).
// Safe to import here: this file only ever ships inside the gpu-image ADDON
// bundle (`vite.plot-gpu-image.config.ts`), never `core.iife.js` — the
// core-bundle guard is about core staying free of the ENGINE, not about the
// addon avoiding a duplicate copy of these already-tiny CPU renderers.
import ImagePane from "./ImagePane";
import HdrImagePane from "./HdrImagePane";

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

/**
 * The formalized prop CONTRACT shared between the two interchangeable
 * image-pane implementations this codebase ships: the LEGACY CPU/2D-canvas
 * pane (`ImagePane`/`HdrImagePane`) and this WebGPU engine pane
 * (`GpuImagePane`). `plot-renderers.tsx`'s `resolveImageRenderer` is the
 * capability-gated seam that picks ONE implementation per mount — the
 * WebGPU-or-legacy-CPU-pane fallback boundary (see
 * `docs/superpowers/specs/2026-07-16-webgpu-engine-design.md`) — and both
 * sides accept this same shape (`ImagePaneProps`/`HdrImagePaneProps` are the
 * legacy panes' own required-field-stricter version of the same two prop
 * shapes), so the swap is prop-compatible. Exported as a TYPE ONLY — core
 * files (`plot-renderers.tsx`) import just this type, never a value, from
 * this file, so the bundle guard (core stays free of the engine's runtime
 * code) holds even though core reasons about the contract's shape.
 */
export type ImageRenderProps = GpuImagePaneProps;

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

/**
 * Screen pixels covered by ONE source texel, for the CURRENTLY-DISPLAYED
 * `rawUv` window — the exact same object-contain-fit formula
 * `PixelValueOverlay.tsx`'s `draw()` uses for its own `scale` (`min(box.width
 * / visibleW, box.height / visibleH)`, `visibleW/H = rawUv.w/h *
 * naturalW/H`), so `GpuImagePane`'s nearest/linear filter switch (Q20) stays
 * in EXACT lockstep with `PixelValueOverlay`'s `PIXEL_VALUE_MIN_SCREEN_PX`
 * active-state threshold — both flip at the same zoom level. `box` must be
 * the DISPLAYED element's rect (the canvas, same as `PixelValueOverlay`'s
 * `imageElRef`), not the outer padded pane container.
 */
export function screenPxPerTexel(
  rawUv: { w: number; h: number },
  box: { width: number; height: number },
  naturalW: number,
  naturalH: number,
): number {
  const visibleW = rawUv.w * naturalW;
  const visibleH = rawUv.h * naturalH;
  if (visibleW <= 0 || visibleH <= 0 || box.width <= 0 || box.height <= 0) return 0;
  return Math.min(box.width / visibleW, box.height / visibleH);
}

/**
 * Q22 fix — the object-contain LETTERBOXED display size (CSS px) of the
 * image within `containerBox` (the un-transformed, un-zoomed fit box —
 * SAME formula `viewportToUvRect`/`PixelAxes`/`ImageOverlay` already use for
 * their own object-contain math, extracted here so `GpuImagePane` and
 * `GpuComparePane` size their CANVAS'S OWN on-screen box to it explicitly,
 * instead of relying on CSS `object-fit:contain` inferring the aspect ratio
 * from the canvas's backing-store dimensions (`canvas.width/height`) — that
 * inference is exactly the trick this fix removes: the backing store must
 * now track the DISPLAY resolution (`* devicePixelRatio`), not the source
 * image's, so it can no longer double as the "natural size" CSS reads for
 * `object-fit`. Returns `{width:0, height:0}` when either box has no
 * measurable size yet (caller keeps the CSS 100%-of-parent fallback then).
 */
export function computeCanvasDisplaySize(
  containerBox: { width: number; height: number },
  naturalW: number,
  naturalH: number,
): { width: number; height: number } {
  if (containerBox.width <= 0 || containerBox.height <= 0 || naturalW <= 0 || naturalH <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(containerBox.width / naturalW, containerBox.height / naturalH);
  return { width: naturalW * scale, height: naturalH * scale };
}

const HOME_VIEWPORT: ImageViewport = { zoom: 1, pan: { x: 0, y: 0 } };

export default function GpuImagePane(props: GpuImagePaneProps) {
  const hdrMode = isHdrProps(props);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const imgWrapperRef = useRef<HTMLDivElement | null>(null);
  const paneHandleRef = useRef<PaneHandle | null>(null);
  // True once the acquire effect below has resolved a real HDR (rgba16float/
  // display-p3/extended-tonemap) surface for this pane — see `useHdr`'s
  // computation just below. Read by the render effect to decide `hdrOut`
  // (skip the SDR encode) so the two stay in lockstep with the surface the
  // pool actually configured; a ref (not state) because it must be settled
  // BEFORE the render effect's first pass and never itself needs to trigger
  // a re-render (paneReady already does that once acquisition resolves).
  const useHdrRef = useRef(false);

  // C1 fix (whole-branch review): true once the engine has definitively
  // failed to activate or render this pane (a non-context-lost hard failure
  // — `engine/pool.ts`'s `handle.render()` returned `false`, or an
  // unexpected throw was caught below). Once set, this component permanently
  // renders the LEGACY CPU pane (`ImagePane`/`HdrImagePane`) instead of the
  // GPU canvas — see the bailout branch near the bottom of this component's
  // render body. A pane never blanks: either the GPU canvas paints, or the
  // legacy pane does.
  const [engineFailed, setEngineFailed] = useState(false);
  const [paneReady, setPaneReady] = useState(false);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
  const [uploadVersion, setUploadVersion] = useState(0);
  const [containerTick, setContainerTick] = useState(0);
  // The DISPLAYED uv window, for `PixelValueOverlay`'s
  // `sourceWindow` — see that prop's doc for why the GPU pane must supply
  // this explicitly (its canvas CSS box doesn't grow with zoom the way the
  // legacy CSS-transform panes' <img>/<canvas> does).
  const [overlayWindow, setOverlayWindow] = useState({ x: 0, y: 0, w: 1, h: 1 });

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
  // Q22 fix: the canvas backing store / WebGPU surface are sized to
  // `displayCssSize * dpr` (see the render-pass effect below) — this must
  // re-fire that sizing whenever `devicePixelRatio` itself changes (moving
  // the window to a different-DPI display, an OS/browser zoom change), not
  // just on container resize.
  const dpr = useDevicePixelRatio();

  // -----------------------------------------------------------------------
  // Acquire/release the pool handle for this canvas.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    // HDR-out gate: requires (1) the WebGPU device reporting `capabilities.hdr`,
    // (2) the OS/display actually reporting extended dynamic range (an HDR surface
    // on a plain SDR panel just re-clips at the OS compositor, so there's no
    // point paying for it), and (3) this pane rendering the FLOAT `HdrData`
    // path (`hdrMode`, i.e. the `imagehdr` prop shape) — plain 8-bit
    // `imageUrl` images have no values >1.0 to preserve, so they stay SDR
    // unconditionally. `hdrMode` is read from the closure (stable for a
    // given pane instance — the two prop shapes never swap mid-life, per
    // this file's module doc) rather than a dep, matching this effect's
    // existing run-once-on-mount contract.
    getSharedDevice()
      .then((device) => {
        if (cancelled) return;
        const hasHighDynamicRangeDisplay =
          typeof matchMedia !== "undefined" && matchMedia("(dynamic-range: high)").matches;
        const useHdr = device.capabilities.hdr && hasHighDynamicRangeDisplay && hdrMode;
        useHdrRef.current = useHdr;
        acquirePane(canvas, { hdr: useHdr })
          .then((handle) => {
            if (cancelled) {
              releasePane(handle);
              return;
            }
            paneHandleRef.current = handle;
            setPaneReady(true);
          })
          .catch((err) => {
            // C1 fix (whole-branch review): defense-in-depth — `acquirePane`
            // is not expected to reject in practice (the hard GPU-init
            // failures this fix targets surface later, from `handle.render()`
            // — see the render effect below), but a promise rejection here
            // would otherwise be an unhandled rejection that leaves the pane
            // permanently blank. Fall back to the legacy pane instead.
            if (cancelled) return;
            // eslint-disable-next-line no-console
            console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane", err);
            setEngineFailed(true);
          });
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane", err);
        setEngineFailed(true);
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
        handle.setVisible(entry.isIntersecting);
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
      // Q22 fix: drop the explicit letterboxed CSS size the render-pass
      // effect set — with no image, fall back to the `w-full h-full` class
      // default (the render-pass effect's early-return on `!naturalDims`
      // means it won't otherwise reset this).
      if (canvasRef.current) {
        canvasRef.current.style.width = "";
        canvasRef.current.style.height = "";
      }
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
    const rawUv = viewportToUvRect({ zoom, pan }, box, naturalDims.w, naturalDims.h);
    setOverlayWindow((prev) =>
      prev.x === rawUv.x && prev.y === rawUv.y && prev.w === rawUv.w && prev.h === rawUv.h ? prev : rawUv,
    );

    // Q22 fix: size the CANVAS ITSELF (its CSS box) to the object-contain
    // LETTERBOXED display size within `imgWrapperRef` (the padding-free
    // content box object-contain used to fit against — SAME box
    // `PixelAxes`/`ImageOverlay` already measure for their own letterbox
    // math), then size the backing store / WebGPU surface to that CSS size
    // times `devicePixelRatio` (`handle.resize()`) — NOT the source image's
    // resolution. This canvas box does NOT grow with zoom (only the sampled
    // `uv` crop shrinks — see `viewportToUvRect`'s doc comment), so this only
    // needs to run on container-resize / natural-dims / dpr changes, exactly
    // this effect's existing triggers.
    const wrapEl = imgWrapperRef.current;
    const wrapBox = wrapEl ? wrapEl.getBoundingClientRect() : box;
    const disp = computeCanvasDisplaySize(wrapBox, naturalDims.w, naturalDims.h);
    const canvasEl = canvasRef.current;
    if (disp.width > 0 && disp.height > 0 && canvasEl) {
      const cssW = Math.round(disp.width);
      const cssH = Math.round(disp.height);
      const cssWidthPx = `${cssW}px`;
      const cssHeightPx = `${cssH}px`;
      if (canvasEl.style.width !== cssWidthPx) canvasEl.style.width = cssWidthPx;
      if (canvasEl.style.height !== cssHeightPx) canvasEl.style.height = cssHeightPx;
      handle.resize(cssW * dpr, cssH * dpr);
    }

    // Q20: nearest once a source texel is >= PIXEL_VALUE_MIN_SCREEN_PX on
    // screen (the SAME threshold that makes PixelValueOverlay start drawing
    // per-pixel numbers), linear below it — see `screenPxPerTexel`'s doc
    // comment for why the CANVAS's own (now display-resolution, Q22) box —
    // not `box`/paneEl, which includes padding — is used here. Uses the
    // just-computed `disp` (CSS px) directly rather than re-reading
    // `getBoundingClientRect()` (a forced layout) since it's already exactly
    // that value once the resize above has applied.
    const canvasBox = disp.width > 0 ? disp : canvasEl ? canvasEl.getBoundingClientRect() : box;
    const filter: "nearest" | "linear" =
      screenPxPerTexel(rawUv, canvasBox, naturalDims.w, naturalDims.h) >= PIXEL_VALUE_MIN_SCREEN_PX
        ? "nearest"
        : "linear";
    const uv = rawUv;
    // On the true-HDR-out path, the user-selected `tonemap` operator is
    // BYPASSED in favor of `"extended"` (a pure identity — see
    // `image/tonemap.ts`'s doc comment on that entry): with a real HDR
    // surface (`hdrOut:true` -> `rgba16float` + `toneMapping:'extended'`,
    // `engine/webgpu/surface.ts`'s `configureHDRSurface`) there is nothing
    // to compress — Chrome's extended tone-mapping mode expects raw
    // scene-linear values and maps them to the panel's actual peak
    // brightness itself. `gamma`/`tonemapName` remain irrelevant here too
    // (the shader's output-encode stage, which is the only place they're
    // read, is skipped whenever `hdrOut` is set).
    const params: ImageParams = hdrMode
      ? {
          exposureEV: exposure,
          operator: useHdrRef.current ? "extended" : toOperator(tonemapName),
          gamma,
          isScalar: false,
          hdrOut: useHdrRef.current,
          uv,
          filter,
        }
      : { exposureEV: 0, operator: "linear", gamma: 1, isScalar: false, hdrOut: false, uv, filter };
    // C1 fix (whole-branch review): `handle.render()` is called SYNCHRONOUSLY
    // in this effect, so an uncaught throw here would unmount this pane's
    // whole subtree in React 18. `engine/pool.ts`'s `attemptRender` already
    // converts its own non-context-lost hard failures into a `false` return
    // rather than throwing (see that function's doc) — the try/catch below
    // is belt-and-suspenders for anything unforeseen that still throws.
    // Either path sets `engineFailed`, which makes this component render the
    // LEGACY CPU pane instead (see the bailout branch below) — a pane never
    // blanks.
    try {
      const ok = handle.render(params);
      if (!ok) setEngineFailed(true);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane", err);
      setEngineFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneReady, naturalDims, uploadVersion, zoom, pan.x, pan.y, exposure, tonemapName, gamma, containerTick, hdrMode, dpr]);

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

  // C1 fix (whole-branch review) — engine bailout: the GPU pane self-heals to
  // the LEGACY CPU pane on any activation/render hard failure, using the
  // SAME props (`HdrGpuImagePaneProps`/`SdrGpuImagePaneProps` mirror
  // `HdrImagePaneProps`/`ImagePaneProps` exactly — see this file's module
  // doc), so the image still renders — never a blank card. Placed after
  // every hook above runs unconditionally (rules-of-hooks) but before this
  // component paints its own GPU canvas.
  if (engineFailed) {
    return hdrMode ? (
      <HdrImagePane
        hdr={(props as HdrGpuImagePaneProps).hdr}
        tonemap={(props as HdrGpuImagePaneProps).tonemap}
        exposure={(props as HdrGpuImagePaneProps).exposure}
        gamma={(props as HdrGpuImagePaneProps).gamma}
        showAxes={showAxes}
        label={label}
        interpolation={interpolation}
        zoom={props.zoom}
        pan={props.pan}
        onViewportChange={onViewportChange}
        pixelValueNotation={props.pixelValueNotation}
      />
    ) : (
      <ImagePane
        imageUrl={(props as SdrGpuImagePaneProps).imageUrl}
        baselineUrl={(props as SdrGpuImagePaneProps).baselineUrl ?? null}
        isBaseline={(props as SdrGpuImagePaneProps).isBaseline}
        diffMode={(props as SdrGpuImagePaneProps).diffMode ?? "none"}
        interpolation={interpolation}
        colormap={sdrColormap}
        showAxes={showAxes}
        processing={(props as SdrGpuImagePaneProps).processing}
        zoom={props.zoom}
        pan={props.pan}
        onViewportChange={onViewportChange}
        onNaturalSize={(props as SdrGpuImagePaneProps).onNaturalSize}
        label={label}
        isDraggable={isDraggable}
        onDragStart={onDragStart}
        className={(props as SdrGpuImagePaneProps).className}
        overlay={overlay}
        overlaySettings={overlaySettings}
        pixelValueNotation={props.pixelValueNotation}
      />
    );
  }

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
        <div ref={imgWrapperRef} className="relative w-full h-full flex items-center justify-center">
          {/*
            Q22 fix: the canvas no longer relies on `object-fit:contain`
            inferring the letterbox from its backing-store aspect ratio (the
            backing store is now sized to the DISPLAY resolution, not the
            source image's — see the render-pass effect above) — its CSS
            box is instead set EXPLICITLY (inline `style.width/height`, in
            the same effect) to the object-contain-equivalent letterboxed
            size, and this flex-centered wrapper positions it exactly where
            `object-contain` used to. `w-full h-full` here is only the
            pre-first-measurement fallback (before that effect has run).
          */}
          <canvas
            ref={canvasRef}
            className="w-full h-full block"
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
            sourceWindow={overlayWindow}
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

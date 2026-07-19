/**
 * GpuImagePane — the WebGPU image BACKEND: one of two interchangeable image
 * backends (see `CpuImagePane.tsx` for the CPU/2D-canvas other); both accept
 * the shared `ImageBackendProps` union (`renderers/image-backend.ts`) and are
 * chosen upstream by the render mode (`resolveRenderMode` — cpu | gpu | auto).
 *
 * Historically: the first LIVE on-screen WebGPU (RHI) image renderer (Task 6
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
 * Compare/metrics are handled by the separate engine-backed `GpuComparePane`
 * (`media-compare/GpuComparePane.tsx`), so the SDR path here handles the
 * PLAIN single-image case only:
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
 *     `imageUrl` alone is shown. Real compare lives in `GpuComparePane`; this
 *     pane is not wired into any live page yet (registered behind a capability flag,
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
 * Compare-view double-click-reset is `CompositeMediaPane`'s job.
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Colormap } from "../types";
import { applyColormap, DIVERGING_COLORMAPS } from "../colormaps";
import { loadImageData, getCachedImageData, setCachedImageData } from "../image";
import PixelAxes from "../primitives/PixelAxes";
import LabelChip from "../primitives/LabelChip";
import ImageOverlay from "./ImageOverlay";
import PixelValueOverlay, {
  CHANNEL_COLORS,
  PIXEL_VALUE_MIN_SCREEN_PX,
  formatChannelValue,
  type PixelSample,
  type PixelValueNotation,
} from "../primitives/PixelValueOverlay";
import { useImageViewport, type Viewport as ImageViewport } from "../hooks/use-image-viewport";
import { useDevicePixelRatio } from "../hooks/use-device-pixel-ratio";
import { acquirePane, releasePane, type PaneHandle, type SourceUpload } from "../engine/pool";
import { getSharedDevice } from "../engine/device";
import type { ImageOperator, ImageParams } from "../engine/image-engine";
// C1 fix (whole-branch review) — the CPU image BACKEND, used as the fallback
// when the engine fails to activate/render (see `engineFailed` state below).
// Safe to import here: this file only ever ships inside the gpu-image ADDON
// bundle (`vite.plot-gpu-image.config.ts`), never `core.iife.js` — the
// core-bundle guard is about core staying free of the ENGINE, not about the
// addon avoiding a duplicate copy of the already-tiny CPU renderer.
import CpuImagePane from "./CpuImagePane";
import PlotToolbar from "../primitives/PlotToolbar";
import {
  useImageController,
  IMAGE_TOOLBAR_CONFIG,
  notationToolbarButton,
} from "./use-image-controller";
import {
  isHdrProps,
  shapeDims,
  finite,
  type HdrData,
  type HdrGpuImagePaneProps,
  type SdrGpuImagePaneProps,
  type ImageBackend,
  type ImageBackendProps,
} from "./image-backend";

// The shared backend prop contract now lives in `renderers/image-backend.ts`
// (ONE place both interchangeable backends import it from). Re-exported here
// under the historical names so existing importers keep working.
export type { HdrData, HdrGpuImagePaneProps, SdrGpuImagePaneProps };

export type GpuImagePaneProps = ImageBackendProps;

/**
 * The formalized prop CONTRACT shared between the two interchangeable image
 * BACKENDS this codebase ships: the CPU/2D-canvas backend (`CpuImagePane`)
 * and this WebGPU engine backend (`GpuImagePane`).
 * `plot-renderers.tsx`'s `resolveImageRenderer(mode)` is the render-mode seam
 * that picks ONE backend per mount — the WebGPU-or-CPU fallback boundary (see
 * `docs/superpowers/specs/2026-07-16-webgpu-engine-design.md`) — and both
 * sides accept this same shape, so the swap is prop-compatible. Kept as a
 * TYPE-only alias of `image-backend.ts`'s `ImageBackendProps` for existing
 * importers; new code should import from `image-backend.ts` directly.
 */
export type ImageRenderProps = GpuImagePaneProps;

const OPERATORS: readonly ImageOperator[] = ["linear", "srgb", "reinhard", "aces"];
function toOperator(name: string | undefined): ImageOperator {
  return (name && (OPERATORS as readonly string[]).includes(name) ? name : "srgb") as ImageOperator;
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
 * Converts the CSS-px `{zoom,pan}` viewport (owned by `useImageViewport`)
 * into the source-space `uv` window `renderImage` samples — for a render
 * target that spans the FULL PANE/canvas (Q24 fix). `paneBox` here MUST be
 * the same box the canvas's own CSS size is measured against (the render
 * effect below uses `imgWrapperRef`'s rect for both) — see this function's
 * derivation below for why a mismatch there breaks the mapping.
 *
 * ## Model: the canvas IS the viewport; the image is a quad placed inside it
 * Q22 (a prior fix) shrank the GPU canvas's own CSS box to the object-contain
 * LETTERBOXED sub-rect of the image, to fix upscaling blur (the backing store
 * now tracks display resolution, not source resolution — a good fix, kept).
 * But that made the canvas element itself the size of the image's home rect,
 * which then CONFINED zoom/pan to the image's own aspect box: zooming in
 * only ever cropped tighter within that fixed small rect, so the checkerboard
 * margins around it were permanently dead space that could never fill in
 * (Q24), and the split/compare shader's screen-space `uv.x` (spanning the
 * SMALL canvas) no longer matched the separator/pointer math (still expressed
 * as a fraction of the full pane) — Q23. Fix: the canvas backing store always
 * covers the FULL pane (see the render-pass effect below); THIS function
 * places the image as a quad inside that full-canvas viewport instead —
 * at `zoom:1, pan:{0,0}` the quad sits at its object-contain "home" rect
 * (letterboxed, centered, checkerboard in the margins via Q18's existing
 * OOB -> transparent path); `zoom`/`pan` then transform the WHOLE viewport
 * (`translate(pan) scale(zoom)`, origin `(0,0)` of the pane — the SAME
 * convention `useImageViewport`'s wheel-zoom-to-cursor math already assumes,
 * since `cx = clientX - paneRect.left` there is measured against that same
 * origin), so the user can zoom toward / pan into the checkerboard margins
 * exactly like a standard image viewer (TEV) — never confined to the image's
 * own aspect box, and no explicit pan/zoom clamp is needed: whatever the
 * quad doesn't cover is genuinely-empty canvas, and Q18 already renders that
 * as transparent (checkerboard shows through).
 *
 * ## Derivation
 * Home fit: `scale = min(paneBox.w/naturalW, paneBox.h/naturalH)`,
 * `dispW/dispH` = the letterboxed on-screen size, `imgLeft/imgTop` = its
 * centered offset within `paneBox`. A canvas-space fragment at `shaderUV`
 * (spanning `[0,1]` across the FULL pane) must sample source-uv
 * `-imgLeft/dispW` at `shaderUV=0` and `(paneBox.w-imgLeft)/dispW` at
 * `shaderUV=1` when at rest — i.e. `uvRect.x = -imgLeft/dispW`,
 * `uvRect.w = paneBox.w/dispW` (>=1 whenever the image is letterboxed on that
 * axis: the SAME "sample past `[0,1]`" mechanism Q18 already uses for
 * zoom<1). Composing that with the `translate(pan) scale(zoom)`-on-the-
 * whole-viewport transform (origin `(0,0)`) gives `w = paneBox.w/(z*dispW)`,
 * `x = -imgLeft/dispW - pan.x/(z*dispW)`.
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
  const w = paneBox.width / (z * dispW);
  const h = paneBox.height / (z * dispH);
  const x = -imgLeft / dispW - viewport.pan.x / (z * dispW);
  const y = -imgTop / dispH - viewport.pan.y / (z * dispH);
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
    // Q29: adaptive max-zoom — zoom until one source texel fills the viewport.
    naturalWidth: naturalDims?.w,
    naturalHeight: naturalDims?.h,
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
      // Q24 fix: no explicit inline CSS size to drop anymore — the canvas is
      // always `w-full h-full` of `imgWrapperRef` (see the JSX below); only
      // its device-pixel backing store is set imperatively, and the
      // render-pass effect's early-return on `!naturalDims` simply leaves
      // that backing store at whatever it last was, which is harmless (no
      // source to render into it).
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

  // The render pass, extracted into a stable callback so the screenshot path
  // (`useImageController`'s `toPNG`) can force a fresh, SYNCHRONOUS repaint
  // before reading the WebGPU canvas back (see that hook's module doc). The
  // effect below simply invokes it on the same dep set as before.
  const renderPass = useCallback(() => {
    const handle = paneHandleRef.current;
    if (!handle || !paneReady || !naturalDims) return;
    const paneEl = paneRef.current;
    // Q24 fix: `viewportToUvRect`'s `paneBox` and the canvas's own CSS/
    // backing-store size below now BOTH key off `imgWrapperRef` (the
    // padding-free content box `PixelAxes`/`ImageOverlay` already measure
    // for their own letterbox math) — previously the uv math used `paneEl`'s
    // box (WITH padding, whenever `showAxes` is on) while the canvas was
    // sized against `wrapEl` (WITHOUT padding), a second coordinate-space
    // mismatch on top of the canvas-vs-pane one below.
    const wrapEl = imgWrapperRef.current;
    const wrapBox = wrapEl
      ? wrapEl.getBoundingClientRect()
      : paneEl
        ? paneEl.getBoundingClientRect()
        : { width: naturalDims.w, height: naturalDims.h };
    const rawUv = viewportToUvRect({ zoom, pan }, wrapBox, naturalDims.w, naturalDims.h);
    setOverlayWindow((prev) =>
      prev.x === rawUv.x && prev.y === rawUv.y && prev.w === rawUv.w && prev.h === rawUv.h ? prev : rawUv,
    );

    // Q24 fix: size the canvas's backing store / WebGPU surface to the FULL
    // content box (`wrapBox`) x `devicePixelRatio` — NOT a computed
    // letterboxed sub-rect (Q22's approach, which confined zoom/pan to the
    // image's own aspect box, leaving dead canvas space at any zoom — see
    // `viewportToUvRect`'s doc comment for the matching uv-math fix). The
    // canvas's CSS LAYOUT box is just `w-full h-full` of `imgWrapperRef`
    // (the JSX below) — no inline style needed — so it already equals
    // `wrapBox`; only the DEVICE-PIXEL backing store needs computing here
    // (Q22's crispness fix, preserved). Letterboxing at rest, and
    // checkerboard in any genuinely-empty region at any zoom, is now
    // entirely the shader's job (Q18's existing OOB -> transparent path).
    if (wrapBox.width > 0 && wrapBox.height > 0) {
      handle.resize(Math.round(wrapBox.width * dpr), Math.round(wrapBox.height * dpr));
    }

    // Q20: nearest once a source texel is >= PIXEL_VALUE_MIN_SCREEN_PX on
    // screen (the SAME threshold that makes PixelValueOverlay start drawing
    // per-pixel numbers), linear below it — see `screenPxPerTexel`'s doc
    // comment. Uses `wrapBox` directly — the canvas's own box now matches it
    // exactly (Q24), so no separate measurement/fallback is needed.
    const filter: "nearest" | "linear" =
      screenPxPerTexel(rawUv, wrapBox, naturalDims.w, naturalDims.h) >= PIXEL_VALUE_MIN_SCREEN_PX
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
  }, [paneReady, naturalDims, zoom, pan.x, pan.y, exposure, tonemapName, gamma, hdrMode, dpr]);

  useEffect(() => {
    renderPass();
  }, [renderPass, uploadVersion, containerTick]);

  // -----------------------------------------------------------------------
  // PlotToolbar controller (zoom/pan/reset/screenshot) — the image pane's
  // adapter onto the renderer-agnostic PlotController facade the modebar
  // drives. `requestRender` is `renderPass` so the screenshot forces a fresh
  // WebGPU frame before reading the canvas back (see the hook's module doc).
  // -----------------------------------------------------------------------
  const controller = useImageController({
    rootRef: paneRef,
    canvasRef,
    zoom,
    pan,
    onViewportChange,
    naturalWidth: naturalDims?.w,
    naturalHeight: naturalDims?.h,
    requestRender: renderPass,
  });

  // Toolbar config: while the pixel-value overlay is active, expose the
  // notation toggle ("0–255"/"0–1") as a LEADING toolbar button (replacing the
  // old free-floating chip). Leftmost so it never shifts the standard buttons.
  const toolbarConfig = useMemo(
    () => ({
      ...IMAGE_TOOLBAR_CONFIG,
      leadingButtons: overlayActive
        ? [notationToolbarButton(notation, setNotation)]
        : [],
    }),
    [overlayActive, notation],
  );

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

  // C1 fix (whole-branch review) — engine bailout: the GPU backend self-heals
  // to the CPU backend (`CpuImagePane`) on any activation/render hard
  // failure. Both backends accept the SAME `ImageBackendProps` union (see
  // `renderers/image-backend.ts`), so the props forward verbatim and the
  // image still renders — never a blank card. Placed after every hook above
  // runs unconditionally (rules-of-hooks) but before this component paints
  // its own GPU canvas.
  if (engineFailed) {
    return hdrMode ? (
      <CpuImagePane {...(props as HdrGpuImagePaneProps)} />
    ) : (
      <CpuImagePane {...(props as SdrGpuImagePaneProps)} />
    );
  }

  return (
    <div className="group relative flex flex-col h-full" data-gpu-image-pane data-gpu-backend-ready={paneReady}>
      <PlotToolbar controller={controller} config={toolbarConfig} />
      <div
        ref={paneRef}
        className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded"
        style={{ padding: showAxes && naturalDims ? "16px 4px 4px 28px" : 0, ...viewportProps.style }}
        onPointerDown={viewportProps.onPointerDown}
        onPointerMove={viewportProps.onPointerMove}
        onPointerUp={viewportProps.onPointerUp}
        onPointerCancel={viewportProps.onPointerCancel}
        onDoubleClick={resetViewport}
        data-gpu-image-viewport
      >
        <div
          ref={imgWrapperRef}
          className="relative w-full h-full flex items-center justify-center cairn-checkerboard"
        >
          {/*
            Q24 fix: the canvas is the FULL viewport — `w-full h-full` of
            this wrapper, always (no inline CSS size override, no
            object-fit) — its device-pixel backing store tracks this box's
            measured CSS size x devicePixelRatio (the render-pass effect
            above; Q22's crispness fix, preserved). The image is placed
            inside this full-canvas viewport as a quad by `viewportToUvRect`
            (letterboxed at rest, filling/pannable at any zoom — see that
            function's doc comment); Q18's OOB -> transparent shader path
            paints checkerboard (this wrapper itself now carries
            `cairn-checkerboard` — Q26 fix: it used to live on `paneRef`,
            which fills the PADDED pane including the axis-label gutter,
            producing a permanent checkerboard RING at the pane edge that no
            zoom could ever cover, since zoom only affects the canvas inside
            that padding. Moving the class onto this padding-free wrapper —
            and dropping `paneRef`'s padding to 0 whenever `showAxes` is off,
            so the wrapper spans the full pane edge-to-edge — confines the
            checkerboard to exactly the canvas's own box, so it now appears
            ONLY where the image quad genuinely doesn't cover the canvas
            (letterbox margins / under-zoomed pan), never as a fixed border)
            wherever the quad doesn't cover the canvas.
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
      </div>
      {label ? <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} /> : null}
    </div>
  );
}

// Compile-time contract check: GpuImagePane implements the shared backend
// interface (`renderers/image-backend.ts`) — interchangeable with CpuImagePane.
const _backendCheck: ImageBackend = GpuImagePane;
void _backendCheck;

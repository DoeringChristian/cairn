/**
 * GpuComparePane — the engine-backed split/blend/diff compare pane (Task 7 of
 * the WebGPU engine, Sub-project 1). Replaces `MediaComparePane`'s CPU
 * compositing (CSS clip-path split + opacity blend) and `ImagePane`'s
 * `image/webgl-diff.ts` diff path with ONE `engine/image-engine.ts`
 * `renderCompare()` GPU pass sampling two source textures (reference/texA +
 * foreground/texB — texA is the shader's "A" role: left side / alpha=0
 * endpoint / diff `a` operand, matching legacy semantics), plus
 * `computeMetrics()` for the MSE/PSNR/MAE readout.
 *
 * ## Gating (mirrors GpuImagePane / plot-gpu-image-addon)
 * Like `renderers/GpuImagePane.tsx`, this pane is NOT wired into any live page
 * by default — `CompositeMediaPane` only routes to it when
 * `window.__cairnPlotUseGpuImage === true` (Task 8 flips this on once the
 * engine panes are the default). When unset/false, the legacy CPU
 * `MediaComparePane`/`ImagePane` path stays in place, so production behavior
 * is unchanged. If a GPU backend can't init the pane self-heals to a blank
 * canvas (the CPU fallback is chosen at the `CompositeMediaPane` layer, not
 * here).
 *
 * ## Device/surface lifecycle (self-contained, NOT the pool)
 * `engine/pool.ts` manages ONE source texture per pane; a compare pane needs
 * TWO plus a render target, so this component owns its device/surface/textures
 * directly (a compare view is singular/few, not gallery-scale, so it doesn't
 * need the pool's LRU park/restore). It resolves `getSharedDevice()` (the one
 * shared WebGPU device — it backs many canvases, so this pane uses it
 * directly rather than creating its own). Everything is torn down on unmount.
 *
 * ## What it reproduces from the CPU compositor
 *   - split: a full-height, gapless divider (`splitPosition * 100%`) driving
 *     the `split` uniform; double-clicking the divider resets it to 0.5.
 *   - blend: the `alpha` uniform.
 *   - diff: `diffSubmode` + colormap (same "signed"/"positive" cmap-mode
 *     selection `ImagePane` uses, same `colormaps/lut.ts` LUT).
 *   - per-side TEV `PixelValueOverlay`s (split-clipped), same as
 *     `MediaComparePane`.
 *   - a metrics chip (MSE/PSNR/MAE via `computeMetrics`).
 *   - Q17: double-clicking the pane BACKGROUND resets the shared viewport to
 *     `{zoom:1, pan:{x:0,y:0}}` (both panes, via `onViewportChange`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Colormap, DiffMode, Interpolation } from "../types";
import { getSharedDevice } from "../engine/device";
import { forceEngineFailRequested } from "../engine/test-hooks";
import {
  renderCompare,
  computeMetrics,
  type CompareParams,
  type CompareMode,
  type CompareDiffSubmode,
  type DiffMetrics,
} from "../engine/image-engine";
import type { Device, Surface, Texture } from "../engine/types";
import { getColormapLUT } from "../colormaps";
import { loadImageData } from "../image";
import { useImageViewport, type Viewport as ImageViewport } from "../hooks/use-image-viewport";
import { useDevicePixelRatio } from "../hooks/use-device-pixel-ratio";
import { screenPxPerTexel, viewportToUvRect } from "../renderers/GpuImagePane";
import PixelValueOverlay, {
  CHANNEL_COLORS,
  PIXEL_VALUE_MIN_SCREEN_PX,
  formatChannelValue,
  type PixelSample,
  type PixelValueNotation,
} from "../primitives/PixelValueOverlay";
// C1 fix (whole-branch review) — the LEGACY compare panes, used as the
// fallback when the engine fails to activate/render (see `engineFailed`
// state below). Safe to import here: this file only ever ships inside the
// gpu-image ADDON bundle (`vite.plot-gpu-image.config.ts`), never
// `core.iife.js` — the core-bundle guard is about core staying free of the
// ENGINE, not about the addon avoiding a duplicate copy of these already-tiny
// CPU renderers. The diff fallback self-heals to `CpuImagePane` (the unified
// CPU image backend — same `ImageBackendProps` contract as `GpuImagePane`,
// see `renderers/image-backend.ts`). `MediaComparePane` is imported as a
// VALUE from `./compositor` — that file only imports THIS file's
// `GpuComparePaneProps` as a TYPE (`import type`), which TS/esbuild fully
// erase, so this is not a runtime import cycle.
import CpuImagePane from "../renderers/CpuImagePane";
import { MediaComparePane } from "./compositor";
import PlotToolbar from "../primitives/PlotToolbar";
import {
  useImageController,
  IMAGE_TOOLBAR_CONFIG,
  notationToolbarButton,
} from "../renderers/use-image-controller";

export interface GpuComparePaneProps {
  imageUrl: string | null;
  baselineUrl: string | null;
  /** split | blend | diff (the three engine-composited modes). */
  mode: CompareMode;
  splitPosition: number;
  blendAlpha: number;
  onSplitPositionChange?: (p: number) => void;

  /** diff submode + colormap (used only in `mode:"diff"`). */
  diffSubmode?: DiffMode;
  colormap?: Colormap;

  zoom: number;
  pan: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;

  interpolation?: Interpolation;
  label?: string;
  pixelValueNotation?: PixelValueNotation;
}

const HOME_VIEWPORT: ImageViewport = { zoom: 1, pan: { x: 0, y: 0 } };

/** Uint8 256x3 LUT -> Float32 256x4 (RGBA, [0,1]) for `CompareParams.diffColormap`. */
function floatLutFor(colormap: Exclude<Colormap, "none">): Float32Array {
  const bytes = getColormapLUT(colormap);
  const out = new Float32Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    out[i * 4 + 0] = bytes[i * 3 + 0]! / 255;
    out[i * 4 + 1] = bytes[i * 3 + 1]! / 255;
    out[i * 4 + 2] = bytes[i * 3 + 2]! / 255;
    out[i * 4 + 3] = 1;
  }
  return out;
}

interface GpuResources {
  device: Device;
  surface: Surface | null;
  texA: Texture | null;
  texB: Texture | null;
}

export default function GpuComparePane({
  imageUrl,
  baselineUrl,
  mode,
  splitPosition,
  blendAlpha,
  onSplitPositionChange,
  diffSubmode,
  colormap = "none",
  zoom,
  pan,
  onViewportChange,
  interpolation = "auto",
  label = "",
  pixelValueNotation = "decimal",
}: GpuComparePaneProps) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resRef = useRef<GpuResources | null>(null);

  // C1 fix (whole-branch review): true once the engine has definitively
  // failed to activate or render this compare pane (a hard GPU-init/render
  // failure). Once set, this component permanently renders the LEGACY
  // compare pane (`MediaComparePane` for split/blend, `CpuImagePane` for diff)
  // instead of the GPU canvas — see the bailout branch near the bottom of
  // this component's render body. A pane never blanks.
  const [engineFailed, setEngineFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [uploadVersion, setUploadVersion] = useState(0);
  const [containerTick, setContainerTick] = useState(0);
  const [metrics, setMetrics] = useState<DiffMetrics | null>(null);
  const [notation, setNotation] = useState<PixelValueNotation>(pixelValueNotation);
  const [overlayActive, setOverlayActive] = useState(false);
  // The DISPLAYED uv window, for `PixelValueOverlay`'s
  // `sourceWindow` — same reasoning as `GpuImagePane`'s `overlayWindow`.
  const [overlayWindow, setOverlayWindow] = useState({ x: 0, y: 0, w: 1, h: 1 });

  // TEV per-side source pixels (raw ImageData), like MediaComparePane.
  const fgDataRef = useRef<ImageData | null>(null);
  const refDataRef = useRef<ImageData | null>(null);
  const [pixelDataVersion, setPixelDataVersion] = useState(0);

  // Q22 fix: same as `GpuImagePane` — the canvas backing store / surface
  // track the on-screen display resolution x dpr, not the source images'.
  const dpr = useDevicePixelRatio();

  // ---- device/surface acquisition (once) --------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    // C1 fix (whole-branch review): this file is self-contained (module doc:
    // "NOT the pool") — unlike `renderers/GpuImagePane.tsx`, there is no
    // `engine/pool.ts` to catch a hard GPU-init failure here.
    // `device.createSurface()` can throw under real GPU-context exhaustion or
    // driver failure, and this used to run with NO try/catch at all.
    // `?forceEngineFail` (test-only, `./test-hooks`, matches the same hook
    // `engine/pool.ts` reads) deterministically triggers this same failure
    // path.
    getSharedDevice()
      .then((device) => {
        if (cancelled) return;
        try {
          if (forceEngineFailRequested()) {
            throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");
          }
          const surface = device.createSurface(canvas, { hdr: false });
          resRef.current = { device, surface, texA: null, texB: null };
          setReady(true);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane", err);
          setEngineFailed(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane", err);
        setEngineFailed(true);
      });
    return () => {
      cancelled = true;
      const r = resRef.current;
      if (r) {
        r.texA?.destroy();
        r.texB?.destroy();
        // `r.device` is the page-wide SHARED device (see module doc) — never
        // destroy it here, just stop using it for this canvas.
        resRef.current = null;
      }
    };
  }, []);

  // ---- container resize -> re-render ------------------------------------
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- load both images -> upload as rgba8unorm textures ----------------
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const r = resRef.current;
    if (!r) return;

    async function loadOne(url: string | null): Promise<ImageData | null> {
      if (!url) return null;
      return loadImageData(url);
    }

    Promise.all([loadOne(imageUrl), loadOne(baselineUrl)]).then(([fg, ref]) => {
      if (cancelled || !resRef.current) return;
      const res = resRef.current;
      fgDataRef.current = fg;
      refDataRef.current = ref;

      res.texA?.destroy();
      res.texB?.destroy();
      res.texA = null;
      res.texB = null;

      // Foreground drives the canvas natural dims. Reference falls back to the
      // foreground (single-source display) when absent so renderCompare always
      // has two bindings.
      const primary = fg ?? ref;
      if (!primary) {
        setDims(null);
        setPixelDataVersion((v) => v + 1);
        // Q24 fix: no explicit inline CSS size to drop — the canvas is
        // always `w-full h-full` of its wrapper (see `GpuImagePane`'s
        // identical reasoning for the `imageUrl:null` case).
        return;
      }
      const uploadTex = (d: ImageData): Texture => {
        const t = res.device.createTexture(d.width, d.height, "rgba8unorm");
        t.write(d.data);
        return t;
      };
      // texA = reference/baseline (the shader's "A" role: left side / alpha=0
      // endpoint / diff `a` operand — matches legacy `compositor.tsx`'s
      // left-clipped reference pane, `ImagePane.tsx`'s blend alpha=0 side, and
      // `image/webgl-diff.ts`'s `computeDiffChannel(base.*, other.*, ...)`
      // where `base` = baselineUrl). texB = foreground/comparison ("B": right
      // side / alpha=1 / diff `b`).
      res.texA = uploadTex(ref ?? primary);
      res.texB = uploadTex(fg ?? primary);

      // Q22 fix: canvas backing-store / surface sizing is driven by the
      // render-pass effect below (display resolution x dpr), NOT the source
      // images' own resolution — no `canvas.width/height`/`surface.configure`
      // here.
      setDims({ w: primary.width, h: primary.height });
      setPixelDataVersion((v) => v + 1);
      setUploadVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, imageUrl, baselineUrl]);

  // ---- diff colormap params ---------------------------------------------
  const diffCmapMode = useMemo<"linear" | "signed" | "positive">(() => {
    const isSigned = ((diffSubmode as string) ?? "").includes("signed");
    return isSigned ? "signed" : "positive";
  }, [diffSubmode]);
  const diffColormap = useMemo<Float32Array | undefined>(
    () => (colormap !== "none" ? floatLutFor(colormap as Exclude<Colormap, "none">) : undefined),
    [colormap],
  );

  // ---- render pass -------------------------------------------------------
  // Extracted into a stable callback so the screenshot path
  // (`useImageController`'s `toPNG`) can force a fresh, SYNCHRONOUS repaint
  // before reading the WebGPU canvas back (see that hook's module doc). The
  // effect below invokes it on the same dep set as before.
  const renderPass = useCallback(() => {
    const r = resRef.current;
    if (!ready || !r || !r.surface || !r.texA || !r.texB || !dims) return;
    const paneEl = paneRef.current;
    const box = paneEl ? paneEl.getBoundingClientRect() : { width: dims.w, height: dims.h };
    const rawUv = viewportToUvRect({ zoom, pan }, box, dims.w, dims.h);
    setOverlayWindow((prev) =>
      prev.x === rawUv.x && prev.y === rawUv.y && prev.w === rawUv.w && prev.h === rawUv.h ? prev : rawUv,
    );

    // Q24 fix: size the canvas's backing store / surface to the FULL pane
    // box (`box` — padding is 0 for this pane, so it's already the
    // padding-free content box) x `devicePixelRatio` — NOT a computed
    // letterboxed sub-rect (Q22's approach, which confined zoom/pan to the
    // image's own aspect box, leaving dead canvas space at any zoom, AND
    // desynced the SPLIT divider — positioned as a percentage of this SAME
    // `box`/wrapper — from the shader's `split` uniform, since the render
    // target no longer spanned the divider's own reference frame; see
    // `viewportToUvRect`'s doc comment for the matching uv-math fix — Q23).
    // The canvas's CSS LAYOUT box is just `w-full h-full` of its wrapper (no
    // inline style needed), so it already equals `box`.
    const canvasEl = canvasRef.current;
    if (box.width > 0 && box.height > 0 && canvasEl && r.surface) {
      const backingW = Math.max(1, Math.round(box.width * dpr));
      const backingH = Math.max(1, Math.round(box.height * dpr));
      if (canvasEl.width !== backingW || canvasEl.height !== backingH) {
        canvasEl.width = backingW;
        canvasEl.height = backingH;
        r.surface.configure(backingW, backingH);
      }
    }

    // Q20: same nearest/linear threshold GpuImagePane uses — see
    // `screenPxPerTexel`'s doc comment. Uses `box` directly — the canvas's
    // own box now matches it exactly (Q24), so no separate measurement is
    // needed.
    const filter: "nearest" | "linear" =
      screenPxPerTexel(rawUv, box, dims.w, dims.h) >= PIXEL_VALUE_MIN_SCREEN_PX ? "nearest" : "linear";
    const uv = rawUv;
    const params: CompareParams = {
      exposureEV: 0,
      operator: "linear",
      gamma: 1,
      isScalar: false,
      hdrOut: false,
      uv,
      filter,
      mode,
      split: splitPosition,
      alpha: blendAlpha,
      diffSubmode: (diffSubmode as CompareDiffSubmode) ?? "absolute",
      diffCmapMode,
      diffColormap: mode === "diff" ? diffColormap : undefined,
    };
    // C1 fix (whole-branch review): `renderCompare()` is called
    // SYNCHRONOUSLY in this effect with NO try/catch at all previously — an
    // uncaught throw here would unmount this pane's whole subtree in React
    // 18. Catch and fall back to the legacy compare pane instead (see the
    // bailout branch near the bottom of this component's render body) — a
    // pane never blanks.
    try {
      renderCompare(r.device, r.surface, r.texA, r.texB, params);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane", err);
      setEngineFailed(true);
    }
  }, [
    ready,
    dims,
    zoom,
    pan.x,
    pan.y,
    mode,
    splitPosition,
    blendAlpha,
    diffSubmode,
    diffCmapMode,
    diffColormap,
    dpr,
  ]);

  useEffect(() => {
    renderPass();
  }, [renderPass, uploadVersion, containerTick]);

  // ---- metrics (recomputed on source change) ----------------------------
  useEffect(() => {
    const r = resRef.current;
    if (!ready || !r || !r.texA || !r.texB || !baselineUrl) {
      setMetrics(null);
      return;
    }
    let cancelled = false;
    computeMetrics(r.device, r.texA, r.texB).then((m) => {
      if (!cancelled) setMetrics(m);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, uploadVersion, baselineUrl]);

  // ---- TEV samplers ------------------------------------------------------
  const makeSampler =
    (dataRef: React.RefObject<ImageData | null>) =>
    (px: number, py: number, notationArg: PixelValueNotation): PixelSample | null => {
      const d = dataRef.current;
      if (!d || px < 0 || py < 0 || px >= d.width || py >= d.height) return null;
      const i = (py * d.width + px) * 4;
      const r = d.data[i]!;
      const g = d.data[i + 1]!;
      const b = d.data[i + 2]!;
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (r === g && g === b) return { lines: [formatChannelValue(r, "uint8", notationArg)], luminance };
      return {
        lines: [
          formatChannelValue(r, "uint8", notationArg),
          formatChannelValue(g, "uint8", notationArg),
          formatChannelValue(b, "uint8", notationArg),
        ],
        luminance,
        colors: [CHANNEL_COLORS[0], CHANNEL_COLORS[1], CHANNEL_COLORS[2]],
      };
    };
  const sampleFg = useMemo(() => makeSampler(fgDataRef), []);
  const sampleRef = useMemo(() => makeSampler(refDataRef), []);

  const { containerProps: viewportProps } = useImageViewport({
    containerRef: paneRef,
    zoom,
    pan,
    onViewportChange,
    // Q29: adaptive max-zoom — zoom until one source texel fills the viewport.
    naturalWidth: dims?.w,
    naturalHeight: dims?.h,
  });

  const resetViewport = useCallback(() => onViewportChange?.(HOME_VIEWPORT), [onViewportChange]);
  const imgRendering = interpolation === "auto" ? undefined : interpolation;

  // PlotToolbar controller (zoom/pan/reset/screenshot) for the composite
  // compare view — one modebar zoom/pan/reset/screenshots the whole split/
  // blend/diff composite. `requestRender` is `renderPass` so the screenshot
  // forces a fresh WebGPU frame before reading the canvas back.
  const controller = useImageController({
    rootRef: paneRef,
    canvasRef,
    zoom,
    pan,
    onViewportChange,
    naturalWidth: dims?.w,
    naturalHeight: dims?.h,
    requestRender: renderPass,
  });

  // Toolbar config: top-right (default) with the pixel-value notation toggle as
  // a LEADING button while the overlay is active (replaces the old floating
  // chip). The diff metrics chip sits just BELOW this toolbar (see render).
  const toolbarConfig = useMemo(
    () => ({
      ...IMAGE_TOOLBAR_CONFIG,
      leadingButtons: overlayActive
        ? [notationToolbarButton(notation, setNotation)]
        : [],
    }),
    [overlayActive, notation],
  );

  // C1 fix (whole-branch review) — engine bailout: on any activation/render
  // hard failure, self-heal to the LEGACY compare pane using the SAME props
  // this component already received — `mode:"diff"` mirrors
  // `compositor.tsx`'s own "normal"|"diff" branch (`ImagePane` with
  // `diffMode`), `mode:"split"|"blend"` mirrors its split/blend branch
  // (`MediaComparePane`) — so the image still renders — never a blank card.
  // Placed after every hook above runs unconditionally (rules-of-hooks) but
  // before this component paints its own GPU canvas.
  if (engineFailed) {
    if (mode === "diff") {
      return (
        <CpuImagePane
          imageUrl={imageUrl}
          baselineUrl={baselineUrl}
          diffMode={diffSubmode ?? "signed"}
          interpolation={interpolation}
          colormap={colormap}
          showAxes={false}
          zoom={zoom}
          pan={pan}
          onViewportChange={onViewportChange}
          label={label}
          pixelValueNotation={pixelValueNotation}
        />
      );
    }
    return (
      <MediaComparePane
        imageUrl={imageUrl}
        baselineUrl={baselineUrl}
        mode={mode}
        splitPosition={splitPosition}
        blendAlpha={blendAlpha}
        onSplitPositionChange={onSplitPositionChange}
        zoom={zoom}
        pan={pan}
        onViewportChange={onViewportChange}
        interpolation={interpolation}
        label={label}
        pixelValueNotation={pixelValueNotation}
      />
    );
  }

  return (
    <div className="group relative flex flex-col h-full" data-gpu-compare-pane data-gpu-compare-ready={ready}>
      {/* Top-right toolbar (default). The diff metrics chip is anchored just
          below it (see below); the REF chip stays top-left and the label
          bottom-right. */}
      <PlotToolbar controller={controller} config={toolbarConfig} />
      <div
        ref={paneRef}
        className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard"
        style={{ padding: 0, ...viewportProps.style }}
        onPointerDown={viewportProps.onPointerDown}
        onPointerMove={viewportProps.onPointerMove}
        onPointerUp={viewportProps.onPointerUp}
        onPointerCancel={viewportProps.onPointerCancel}
        onDoubleClick={resetViewport}
        data-gpu-compare-viewport
      >
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Q23/Q24 fix: the canvas is the FULL viewport — `w-full h-full`
              of this wrapper, always (no inline CSS size, no object-fit) —
              its device-pixel backing store tracks this box's measured CSS
              size x devicePixelRatio (the render-pass effect above; Q22's
              crispness fix, preserved). The image quads are placed inside
              this full-canvas viewport by `viewportToUvRect` (letterboxed at
              rest, filling/pannable at any zoom). Crucially, the split
              divider below is ALSO positioned as a percentage of THIS SAME
              wrapper's full width — since the canvas (and hence the
              shader's screen-space `uv.x` the `split` uniform is compared
              against) now spans exactly that same box, the divider and the
              rendered A|B boundary are guaranteed to agree at any zoom/pane
              aspect, by construction (Q23) — no separate coordinate
              conversion needed here. */}
          <canvas
            ref={canvasRef}
            className="w-full h-full block"
            style={{ imageRendering: imgRendering }}
            data-gpu-compare-canvas
          />
          {/* Full-height, gapless split divider — drives the `split` uniform. */}
          {mode === "split" && (
            <div
              className="absolute top-0 bottom-0 z-20 flex items-center"
              style={{ left: `${splitPosition * 100}%`, transform: "translateX(-50%)", cursor: "col-resize" }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onSplitPositionChange?.(0.5);
              }}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                const container = ev.currentTarget.parentElement!;
                const rect = container.getBoundingClientRect();
                const onMoveEvt = (me: PointerEvent) => {
                  onSplitPositionChange?.(Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width)));
                };
                const onUpEvt = () => {
                  window.removeEventListener("pointermove", onMoveEvt);
                  window.removeEventListener("pointerup", onUpEvt);
                };
                window.addEventListener("pointermove", onMoveEvt);
                window.addEventListener("pointerup", onUpEvt);
              }}
            >
              <div className="w-1 h-full bg-accent/80 rounded-full" />
            </div>
          )}
        </div>

        {/* Per-side TEV overlays. split -> each side clipped at the divider,
            LEFT (x<split) = reference, RIGHT (x>=split) = foreground —
            matching the corrected texA(=reference)/texB(=foreground) binding
            and legacy `compositor.tsx`'s left-clipped-reference /
            right-clipped-foreground panes; blend/diff -> single foreground
            overlay (also matches legacy). */}
        {mode === "split" ? (
          <>
            {baselineUrl && dims && (
              <div
                className="absolute inset-0 overflow-hidden pointer-events-none"
                style={{ clipPath: `inset(0 ${(1 - splitPosition) * 100}% 0 0)` }}
              >
                <PixelValueOverlay
                  imageElRef={canvasRef}
                  naturalWidth={dims.w}
                  naturalHeight={dims.h}
                  zoom={zoom}
                  pan={pan}
                  sourceWindow={overlayWindow}
                  sample={sampleRef}
                  notation={notation}
                  version={pixelDataVersion}
                />
              </div>
            )}
            {baselineUrl && dims && (
              <div
                className="absolute inset-0 overflow-hidden pointer-events-none"
                style={{ clipPath: `inset(0 0 0 ${splitPosition * 100}%)` }}
              >
                <PixelValueOverlay
                  imageElRef={canvasRef}
                  naturalWidth={dims.w}
                  naturalHeight={dims.h}
                  zoom={zoom}
                  pan={pan}
                  sourceWindow={overlayWindow}
                  sample={sampleFg}
                  notation={notation}
                  version={pixelDataVersion}
                  onActiveChange={setOverlayActive}
                />
              </div>
            )}
          </>
        ) : (
          dims && (
            <PixelValueOverlay
              imageElRef={canvasRef}
              naturalWidth={dims.w}
              naturalHeight={dims.h}
              zoom={zoom}
              pan={pan}
              sourceWindow={overlayWindow}
              sample={sampleFg}
              notation={notation}
              version={pixelDataVersion}
              onActiveChange={setOverlayActive}
            />
          )
        )}
      </div>

      <span className="absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm">
        REF
      </span>
      {label ? (
        <span className="absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm">
          {label}
        </span>
      ) : null}
      {metrics && (
        <span
          // The diff metrics sit just BELOW the top-right toolbar (hover-
          // revealed, ~28px tall anchored at top:6px), right-aligned to tuck
          // under it. The notation toggle now lives INSIDE the toolbar (a
          // leading button), so there's no longer a separate chip to dodge.
          className="absolute right-1.5 top-9 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono"
          data-gpu-compare-metrics
        >
          MSE {metrics.mse.toExponential(2)} · PSNR {Number.isFinite(metrics.psnr) ? metrics.psnr.toFixed(1) : "∞"} dB · MAE{" "}
          {metrics.mae.toExponential(2)}
        </span>
      )}
    </div>
  );
}

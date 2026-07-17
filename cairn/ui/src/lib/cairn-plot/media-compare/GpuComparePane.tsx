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
 * need the pool's LRU park/restore). It resolves `getSharedDevice()` for the
 * backend, then — for WebGL2 (one-context-per-canvas, see
 * `engine/webgl2/device.ts`) — creates a dedicated `createWebGL2Device()`
 * bound to its own canvas; for WebGPU it uses the shared device directly (one
 * device backs many canvases). Everything is torn down on unmount.
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
import { createWebGL2Device } from "../engine/webgl2/device";
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
import { viewportToUvRect } from "../renderers/GpuImagePane";
import PixelValueOverlay, {
  CHANNEL_COLORS,
  PixelNotationToggle,
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
// CPU renderers. `MediaComparePane` is imported as a VALUE from `./compositor`
// — that file only imports THIS file's `GpuComparePaneProps` as a TYPE
// (`import type`), which TS/esbuild fully erase, so this is not a runtime
// import cycle.
import ImagePane from "../renderers/ImagePane";
import { MediaComparePane } from "./compositor";

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
  ownsDevice: boolean; // WebGL2 dedicated device -> destroy on teardown
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
  // failed to activate or render this compare pane (a non-context-lost hard
  // failure, e.g. WebGL2 `getContext` returning `null` under live-context
  // exhaustion). Once set, this component permanently renders the LEGACY
  // compare pane (`MediaComparePane` for split/blend, `ImagePane` for diff)
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
  // The DISPLAYED (pre-backend-flip) uv window, for `PixelValueOverlay`'s
  // `sourceWindow` — same reasoning as `GpuImagePane`'s `overlayWindow`.
  const [overlayWindow, setOverlayWindow] = useState({ x: 0, y: 0, w: 1, h: 1 });

  // TEV per-side source pixels (raw ImageData), like MediaComparePane.
  const fgDataRef = useRef<ImageData | null>(null);
  const refDataRef = useRef<ImageData | null>(null);
  const [pixelDataVersion, setPixelDataVersion] = useState(0);

  // ---- device/surface acquisition (once) --------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    // C1 fix (whole-branch review): this file is self-contained (module doc:
    // "NOT the pool") — unlike `renderers/GpuImagePane.tsx`, there is no
    // `engine/pool.ts` to catch a hard GPU-init failure here.
    // `device.createSurface()` can throw the SAME way `engine/pool.ts`'s
    // `activateEntry` can (most realistically WebGL2's `getContext`
    // returning `null` under live-context exhaustion), and this used to run
    // with NO try/catch at all. `?forceEngineFail` (test-only, `./test-hooks`,
    // matches the same hook `engine/pool.ts` reads) deterministically
    // triggers this same failure path.
    getSharedDevice()
      .then((shared) => {
        if (cancelled) return;
        try {
          if (forceEngineFailRequested()) {
            throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");
          }
          const ownsDevice = shared.backend === "webgl2";
          const device = ownsDevice ? createWebGL2Device() : shared;
          const surface = device.createSurface(canvas, { hdr: false });
          resRef.current = { device, ownsDevice, surface, texA: null, texB: null };
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
        if (r.ownsDevice) r.device.destroy();
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

      const canvas = canvasRef.current!;
      canvas.width = primary.width;
      canvas.height = primary.height;
      res.surface?.configure(primary.width, primary.height);

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
  useEffect(() => {
    const r = resRef.current;
    if (!ready || !r || !r.surface || !r.texA || !r.texB || !dims) return;
    const paneEl = paneRef.current;
    const box = paneEl ? paneEl.getBoundingClientRect() : { width: dims.w, height: dims.h };
    const rawUv = viewportToUvRect({ zoom, pan }, box, dims.w, dims.h);
    setOverlayWindow((prev) =>
      prev.x === rawUv.x && prev.y === rawUv.y && prev.w === rawUv.w && prev.h === rawUv.h ? prev : rawUv,
    );
    let uv = rawUv;
    // WebGL2 display Y-flip correction — identical to GpuImagePane's.
    if (r.device.backend === "webgl2") {
      uv = { x: uv.x, y: uv.y + uv.h, w: uv.w, h: -uv.h };
    }
    const params: CompareParams = {
      exposureEV: 0,
      operator: "linear",
      gamma: 1,
      isScalar: false,
      hdrOut: false,
      uv,
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
    uploadVersion,
    zoom,
    pan.x,
    pan.y,
    mode,
    splitPosition,
    blendAlpha,
    diffSubmode,
    diffCmapMode,
    diffColormap,
    containerTick,
  ]);

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
  });

  const resetViewport = useCallback(() => onViewportChange?.(HOME_VIEWPORT), [onViewportChange]);
  const imgRendering = interpolation === "auto" ? undefined : interpolation;

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
        <ImagePane
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
    <div className="relative flex flex-col h-full" data-gpu-compare-pane data-gpu-compare-ready={ready}>
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
        <div className="relative w-full h-full">
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain block"
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
        {overlayActive && <PixelNotationToggle notation={notation} onChange={setNotation} />}
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
          // Task 8 fix: the TEV notation toggle (`PixelNotationToggle`, shared
          // primitive) also anchors `top-1 right-1` — when BOTH are visible
          // (zoomed in far enough for per-pixel numbers, AND a baseline is
          // present) they overlapped. Drop the chip below the toggle's row
          // whenever the overlay is active; both stay `top-1` otherwise so
          // outside a zoomed state the chip keeps its usual corner spot.
          className={`absolute right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${overlayActive ? "top-8" : "top-1"}`}
          data-gpu-compare-metrics
        >
          MSE {metrics.mse.toExponential(2)} · PSNR {Number.isFinite(metrics.psnr) ? metrics.psnr.toFixed(1) : "∞"} dB · MAE{" "}
          {metrics.mae.toExponential(2)}
        </span>
      )}
    </div>
  );
}

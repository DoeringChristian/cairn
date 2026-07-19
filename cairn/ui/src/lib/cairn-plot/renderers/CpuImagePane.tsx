/**
 * CpuImagePane — the CPU (2D-canvas) image backend. One of TWO interchangeable
 * image backends (see `GpuImagePane.tsx` for the WebGPU one): both accept the
 * SAME `ImageBackendProps` union (`renderers/image-backend.ts`) and are chosen
 * upstream by the user-settable render mode (`resolveRenderMode` — cpu | gpu |
 * auto), so the rest of the app is backend-agnostic.
 *
 * ## One component, two prop shapes (mirrors `GpuImagePane` exactly)
 * `isHdrProps(props)` (presence of `hdr`) selects the branch:
 *   - SDR (`imageUrl` shape) — the former `ImagePane`'s FULL path, ported
 *     verbatim: `<img>` display with `processing` CSS/SVG filters
 *     (gamma/offset/flipSign via `useGammaFilter`), CPU `applyColormap`
 *     false-color canvas, and the legacy `baselineUrl`/`diffMode` pixel-diff
 *     pipeline (`computeDiff`/`webglRenderDiffToCanvas`).
 *   - HDR (`hdr` float shape) — the former `HdrImagePane`'s
 *     tonemap-to-canvas path: `tonemapToImageData(hdr, tonemap, exposure,
 *     gamma)` per-pixel → `putImageData`.
 * ASYMMETRY (unchanged from before the unification): the HDR branch has no
 * colormap / compare-diff / `processing` — those props only exist on the SDR
 * shape (`SdrGpuImagePaneProps`), exactly as the two separate panes had it.
 *
 * ## Shared plumbing — written ONCE (`CpuPaneShell`)
 * Both branches render through one shell that owns: `useImageViewport`
 * zoom/pan (modifier-gated wheel zoom-to-cursor + drag pan, CSS
 * `translate(pan) scale(zoom)` transform), object-contain canvas letterbox
 * fit, the TEV `PixelValueOverlay` mount + notation state, double-click
 * viewport reset, and the `PlotToolbar` + `useImageController` wiring
 * (identical treatment to `GpuImagePane`, including the notation leading
 * button, so the two backends look the same).
 *
 * ## `toolbar` (shim compatibility)
 * The legacy `ImagePane.tsx`/`HdrImagePane.tsx` shims forward here with
 * `toolbar={false}`, preserving the exact pre-unification chrome for app-card
 * consumers (`media-compare/compositor.tsx` etc.): no `PlotToolbar`, the
 * free-floating `PixelNotationToggle` chip instead of the toolbar's leading
 * button. Backend-seam mounts (`resolveImageRenderer` / `GpuImagePane`'s C1
 * fallback) use the default `toolbar={true}`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Colormap, DiffMode } from "../types";
import { useGammaFilter, GammaFilterSvg } from "../media-compare/post-processing";
import ImageOverlay from "./ImageOverlay";
import {
  computeDiff,
  loadImageData,
  webglRenderDiffToCanvas,
  getRenderMode,
  getCachedImageData,
  setCachedImageData,
} from "../image";
import { applyColormap, getColormapLUT, DIVERGING_COLORMAPS } from "../colormaps";
import {
  getTonemapOperator,
  applyExposure,
  outputEncode,
  type RgbTriple,
} from "../image/tonemap";
import PixelAxes from "../primitives/PixelAxes";
import LabelChip from "../primitives/LabelChip";
import PixelValueOverlay, {
  CHANNEL_COLORS,
  PixelNotationToggle,
  formatChannelValue,
  type PixelSample,
  type PixelSampler,
  type PixelValueNotation,
} from "../primitives/PixelValueOverlay";
import { useImageViewport, type Viewport as ImageViewport } from "../hooks/use-image-viewport";
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
} from "./image-backend";
import type { ImageProcessing } from "../types";

const DEFAULT_PROCESSING: ImageProcessing = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  exposure: 0,
  offset: 0,
  flipSign: false,
};

const HOME_VIEWPORT: ImageViewport = { zoom: 1, pan: { x: 0, y: 0 } };

// ---------------------------------------------------------------------------
// HDR tone-map (moved verbatim from HdrImagePane.tsx; re-exported there).
// ---------------------------------------------------------------------------

/**
 * Tone-map the float HDR buffer into an 8-bit RGBA `ImageData`. Pure — no DOM
 * beyond the `ImageData` allocation. Exposure → operator → output-encode per
 * pixel, exactly the pipeline documented in `tonemap.ts`.
 */
export function tonemapToImageData(
  hdr: HdrData,
  tonemap: string,
  exposure: number,
  gamma?: number,
): ImageData {
  const { h, w, c } = shapeDims(hdr.shape);
  const src = hdr.data;
  const op = getTonemapOperator(tonemap);
  const out = new Uint8ClampedArray(w * h * 4);

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
      // c === 4 (rgba); alpha passes through the encode as a plain [0,1] value.
      r = finite(src[base]!);
      g = finite(src[base + 1]!);
      b = finite(src[base + 2]!);
      a = finite(src[base + 3]!);
    }

    // 1) exposure in scene-linear, 2) tone-map HDR→[0,1], 3) output-encode.
    const lit: RgbTriple = [
      applyExposure(r, exposure),
      applyExposure(g, exposure),
      applyExposure(b, exposure),
    ];
    const [tr, tg, tb] = op(lit);
    const o = i * 4;
    out[o] = 255 * outputEncode(tr, gamma);
    out[o + 1] = 255 * outputEncode(tg, gamma);
    out[o + 2] = 255 * outputEncode(tb, gamma);
    // Alpha is a coverage value, not light — clamp to [0,1], no tone-map.
    out[o + 3] = 255 * (a < 0 ? 0 : a > 1 ? 1 : a);
  }
  return new ImageData(out, w, h);
}

// ---------------------------------------------------------------------------
// CpuPaneShell — the SHARED plumbing, written once for both branches:
// viewport interaction + CSS-transform zoom/pan, letterbox container,
// double-click reset, PixelValueOverlay + notation state, PlotToolbar +
// useImageController (mirroring GpuImagePane's toolbar wiring exactly).
// ---------------------------------------------------------------------------

interface CpuPaneShellProps {
  zoom: number;
  pan: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;
  showAxes: boolean;
  naturalDims: { w: number; h: number } | null;
  label: string;
  /** SDR always shows the chip (legacy ImagePane parity); HDR only when the
   *  label is non-empty (legacy HdrImagePane parity). */
  showLabelChip: boolean;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** PlotToolbar on (backend mode) vs. legacy chrome (floating notation chip). */
  toolbar: boolean;
  notationSeed: PixelValueNotation;
  sample: PixelSampler;
  pixelDataVersion: number;
  /** The displayed <img>/<canvas> — the PixelValueOverlay geometry source. */
  displayElRef: React.RefObject<HTMLElement | null>;
  /** The displayed <canvas> (when the display IS a canvas) — the preferred
   *  `canvasToPng` screenshot target. Null/absent → `plotToPng(root)`. */
  exportCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
  /** Gates the PixelValueOverlay (legacy: `imageUrl && naturalDims`). */
  hasPixelSource: boolean;
  /** Rendered before the pane box (the SDR branch's `GammaFilterSvg`). */
  header?: React.ReactNode;
  /** Rendered inside the transformed wrapper, after PixelAxes (`ImageOverlay`). */
  overlayNode?: React.ReactNode;
  children: React.ReactNode;
}

function CpuPaneShell({
  zoom,
  pan,
  onViewportChange,
  showAxes,
  naturalDims,
  label,
  showLabelChip,
  isDraggable = false,
  onDragStart,
  toolbar,
  notationSeed,
  sample,
  pixelDataVersion,
  displayElRef,
  exportCanvasRef,
  hasPixelSource,
  header,
  overlayNode,
  children,
}: CpuPaneShellProps) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const imgWrapperRef = useRef<HTMLDivElement | null>(null);

  // Notation is owned locally (seeded from the prop) so the pane is
  // self-contained; the toggle shows only while the overlay is active.
  const [notation, setNotation] = useState<PixelValueNotation>(notationSeed);
  const [overlayActive, setOverlayActive] = useState(false);

  // CSS transform (computed locally from zoom + pan) — the CPU backend zooms
  // by physically growing the wrapper, unlike the GPU backend's uvRect crop.
  const transformStr = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

  const { containerProps: viewportProps } = useImageViewport({
    containerRef: paneRef,
    zoom,
    pan,
    onViewportChange,
    // Q29: adaptive max-zoom — zoom until one source texel fills the viewport
    // (same cap the GPU backend and the toolbar's +/- buttons use).
    naturalWidth: naturalDims?.w,
    naturalHeight: naturalDims?.h,
  });

  // Double-click reset (Q17) — same gesture as GpuImagePane / the 2D charts.
  const resetViewport = useCallback(() => {
    onViewportChange?.(HOME_VIEWPORT);
  }, [onViewportChange]);

  // PlotToolbar controller (zoom/pan/reset/screenshot) — same adapter
  // GpuImagePane uses. The hooks run unconditionally (rules-of-hooks); only
  // the toolbar's RENDER is gated on `toolbar`.
  const controller = useImageController({
    rootRef: paneRef,
    canvasRef: exportCanvasRef,
    zoom,
    pan,
    onViewportChange,
    naturalWidth: naturalDims?.w,
    naturalHeight: naturalDims?.h,
  });

  const toolbarConfig = useMemo(
    () => ({
      ...IMAGE_TOOLBAR_CONFIG,
      leadingButtons: overlayActive
        ? [notationToolbarButton(notation, setNotation)]
        : [],
    }),
    [overlayActive, notation],
  );

  return (
    <div
      className={`relative flex flex-col h-full${toolbar ? " group" : ""}`}
      data-cpu-image-pane
    >
      {header}
      {toolbar && <PlotToolbar controller={controller} config={toolbarConfig} />}
      <div
        ref={paneRef}
        className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard"
        style={{
          padding: showAxes && naturalDims ? "16px 4px 4px 28px" : "4px",
          ...viewportProps.style,
        }}
        onPointerDown={viewportProps.onPointerDown}
        onPointerMove={viewportProps.onPointerMove}
        onPointerUp={viewportProps.onPointerUp}
        onPointerCancel={viewportProps.onPointerCancel}
        onDoubleClick={resetViewport}
        data-cpu-image-viewport
      >
        <div
          ref={imgWrapperRef}
          className="relative w-full h-full"
          style={{ transform: transformStr, transformOrigin: "0 0" }}
        >
          {children}
          {showAxes && naturalDims && (
            <PixelAxes
              naturalWidth={naturalDims.w}
              naturalHeight={naturalDims.h}
              zoom={zoom}
              containerRef={imgWrapperRef}
            />
          )}
          {overlayNode}
        </div>
        {hasPixelSource && naturalDims && (
          <PixelValueOverlay
            imageElRef={displayElRef}
            naturalWidth={naturalDims.w}
            naturalHeight={naturalDims.h}
            zoom={zoom}
            pan={pan}
            sample={sample}
            notation={notation}
            version={pixelDataVersion}
            onActiveChange={setOverlayActive}
          />
        )}
        {!toolbar && overlayActive && (
          <PixelNotationToggle notation={notation} onChange={setNotation} />
        )}
      </div>
      {showLabelChip && (
        <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SDR branch — the former ImagePane body (decode/colormap/diff effects ported
// verbatim), rendering its display element through the shared shell.
// ---------------------------------------------------------------------------

function CpuSdrImagePane(props: SdrGpuImagePaneProps & { toolbar?: boolean }) {
  const {
    imageUrl,
    baselineUrl = null,
    isBaseline = false,
    diffMode = "none",
    interpolation = "auto",
    colormap = "none",
    showAxes = false,
    processing = DEFAULT_PROCESSING,
    zoom: zoomProp = 1,
    pan: panProp = { x: 0, y: 0 },
    onViewportChange,
    onNaturalSize,
    label,
    isDraggable = false,
    onDragStart,
    overlay,
    overlaySettings,
    pixelValueNotation = "decimal",
    toolbar = true,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const falseColorRef = useRef<HTMLCanvasElement | null>(null);

  // -----------------------------------------------------------------------
  // TEV-style per-pixel value overlay — source buffers.
  //   valueDataRef: RAW source pixels (the numbers we print).
  //   dispDataRef:  the pixels actually SHOWN (for auto-contrast luminance).
  // The displayed element (img|canvas) is tracked via `displayElRef` so the
  // overlay can read its live on-screen rect (post zoom/pan).
  // -----------------------------------------------------------------------
  const displayElRef = useRef<HTMLElement | null>(null);
  const valueDataRef = useRef<ImageData | null>(null);
  const dispDataRef = useRef<ImageData | null>(null);
  const [pixelDataVersion, setPixelDataVersion] = useState(0);
  const bumpPixelData = useCallback(() => setPixelDataVersion((v) => v + 1), []);

  // Screenshot target: the displayed element when it IS a canvas (diff /
  // false-color paths); the plain-<img> path has no canvas, so `toPNG` falls
  // back to `plotToPng(root)` there (which requires a canvas/svg — see the
  // module doc's shim note; the toolbar only shows in backend mode anyway).
  const exportCanvasRef = useMemo(
    () => ({
      get current(): HTMLCanvasElement | null {
        const el = displayElRef.current;
        return el instanceof HTMLCanvasElement ? el : null;
      },
    }),
    [],
  );

  // Callback refs that also record the currently-displayed element (only one
  // of img/canvas/falseColor is mounted at a time) for the overlay's geometry.
  const setCanvasEl = useCallback((el: HTMLCanvasElement | null) => {
    canvasRef.current = el;
    if (el) displayElRef.current = el;
  }, []);
  const setFalseColorEl = useCallback((el: HTMLCanvasElement | null) => {
    falseColorRef.current = el;
    if (el) displayElRef.current = el;
  }, []);
  const setImgEl = useCallback((el: HTMLImageElement | null) => {
    if (el) displayElRef.current = el;
  }, []);
  const [diffReady, setDiffReady] = useState(false);
  const [falseColorReady, setFalseColorReady] = useState(false);
  const [naturalDims, setNaturalDims] = useState<{
    w: number;
    h: number;
  } | null>(null);

  // -----------------------------------------------------------------------
  // SVG gamma filter + CSS filter string (shared helper)
  // -----------------------------------------------------------------------
  const { flipSign } = processing;
  const { gammaFilterId, filterStr, gamma, offset } = useGammaFilter(processing);

  // -----------------------------------------------------------------------
  // Diff / false-color rendering
  // -----------------------------------------------------------------------
  const showDiff =
    !isBaseline &&
    diffMode !== "none" &&
    baselineUrl != null &&
    imageUrl != null;

  const isDiffActive = diffMode !== "none" && baselineUrl != null;
  const useFalseColor =
    colormap !== "none" &&
    !showDiff &&
    !(isBaseline && isDiffActive) &&
    imageUrl != null;

  useEffect(() => {
    if (!useFalseColor || !imageUrl) {
      setFalseColorReady(false);
      return;
    }
    let cancelled = false;
    setFalseColorReady(false);

    const cacheKey = `${imageUrl}::${colormap}`;
    const cached = getCachedImageData(cacheKey);
    if (cached) {
      const fc = falseColorRef.current;
      if (fc) {
        fc.width = cached.width;
        fc.height = cached.height;
        const fctx = fc.getContext("2d");
        if (fctx) fctx.putImageData(cached, 0, 0);
        dispDataRef.current = cached;
        bumpPixelData();
        setNaturalDims({ w: cached.width, h: cached.height });
        onNaturalSize?.(cached.width, cached.height);
        setFalseColorReady(true);
      }
      return;
    }

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const src = ctx.getImageData(0, 0, c.width, c.height);
      const cmapMode = DIVERGING_COLORMAPS.has(colormap) ? "positive" : "linear";
      const mapped = applyColormap(
        src,
        colormap as Exclude<Colormap, "none">,
        cmapMode,
      );
      setCachedImageData(cacheKey, mapped);
      const fc = falseColorRef.current;
      if (!fc || cancelled) return;
      fc.width = mapped.width;
      fc.height = mapped.height;
      const fctx = fc.getContext("2d");
      if (fctx) fctx.putImageData(mapped, 0, 0);
      dispDataRef.current = mapped;
      bumpPixelData();
      setNaturalDims({ w: mapped.width, h: mapped.height });
      onNaturalSize?.(mapped.width, mapped.height);
      setFalseColorReady(true);
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useFalseColor, imageUrl, colormap]);

  const updateDims = useCallback((w: number, h: number) => {
    setNaturalDims((prev) =>
      prev && prev.w === w && prev.h === h ? prev : { w, h },
    );
    onNaturalSize?.(w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decode the RAW source image once per url so the pixel-value overlay can
  // read true pixel values (independent of the display mode). In plain/diff
  // modes the shown pixels equal the source, so luminance reads from it too;
  // the colormap effect overrides `dispDataRef` with the mapped pixels.
  useEffect(() => {
    if (!imageUrl) {
      valueDataRef.current = null;
      dispDataRef.current = null;
      bumpPixelData();
      return;
    }
    let cancelled = false;
    loadImageData(imageUrl).then((d) => {
      if (cancelled) return;
      valueDataRef.current = d;
      if (colormap === "none") dispDataRef.current = d;
      bumpPixelData();
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, colormap, bumpPixelData]);

  const samplePixel = useCallback(
    (px: number, py: number, notation: PixelValueNotation): PixelSample | null => {
      const vd = valueDataRef.current;
      if (!vd || px < 0 || py < 0 || px >= vd.width || py >= vd.height) return null;
      const i = (py * vd.width + px) * 4;
      const r = vd.data[i]!;
      const g = vd.data[i + 1]!;
      const b = vd.data[i + 2]!;
      // Luminance from the DISPLAYED pixels when available (colormap-mapped),
      // else from the raw source (plain path shows the source unchanged).
      const dd = dispDataRef.current;
      let lr = r, lg = g, lb = b;
      if (dd && dd.width === vd.width && dd.height === vd.height) {
        const j = (py * dd.width + px) * 4;
        lr = dd.data[j]!;
        lg = dd.data[j + 1]!;
        lb = dd.data[j + 2]!;
      }
      const luminance = (0.299 * lr + 0.587 * lg + 0.114 * lb) / 255;
      const single = colormap !== "none" || (r === g && g === b);
      if (single) {
        return { lines: [formatChannelValue(r, "uint8", notation)], luminance };
      }
      // Multi-channel: tint each digit line by its channel (R/G/B).
      return {
        lines: [
          formatChannelValue(r, "uint8", notation),
          formatChannelValue(g, "uint8", notation),
          formatChannelValue(b, "uint8", notation),
        ],
        luminance,
        colors: [CHANNEL_COLORS[0], CHANNEL_COLORS[1], CHANNEL_COLORS[2]],
      };
    },
    [colormap],
  );

  useEffect(() => {
    if (!showDiff) {
      setDiffReady(false);
      return;
    }
    let cancelled = false;

    const renderMode = getRenderMode();
    const useGPU = renderMode === "gpu" || renderMode === "auto";

    const cacheKey = `${baselineUrl}::${imageUrl}::${diffMode}::${colormap}`;
    if (renderMode !== "gpu") {
      const cached = getCachedImageData(cacheKey);
      if (cached) {
        const canvas = canvasRef.current;
        if (canvas) {
          if (
            canvas.width !== cached.width ||
            canvas.height !== cached.height
          ) {
            canvas.width = cached.width;
            canvas.height = cached.height;
          }
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.putImageData(cached, 0, 0);
          updateDims(cached.width, cached.height);
          setDiffReady(true);
        }
        return;
      }
    }

    (async () => {
      const [baseData, otherData] = await Promise.all([
        loadImageData(baselineUrl!),
        loadImageData(imageUrl!),
      ]);
      if (cancelled) return;
      if (!baseData || !otherData) return;

      const isSigned = (diffMode as string).includes("signed");
      const cmapMode: "linear" | "signed" | "positive" = isSigned
        ? "signed"
        : "positive";
      const gpuLut =
        colormap !== "none"
          ? getColormapLUT(colormap as Exclude<Colormap, "none">)
          : null;
      const gpuOpts = {
        diffMode: diffMode as DiffMode,
        colormap: gpuLut,
        cmapMode,
      };

      if (useGPU) {
        try {
          const canvas = canvasRef.current;
          if (canvas) {
            const dims = webglRenderDiffToCanvas(
              baseData,
              otherData,
              gpuOpts,
              canvas,
            );
            if (dims) {
              if (cancelled) return;
              updateDims(dims.width, dims.height);
              setDiffReady(true);
              return;
            }
          }
        } catch (err) {
          console.warn("[cairn] WebGL 2 diff error:", err);
        }
      }

      if (renderMode === "gpu") {
        console.error(
          "[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'",
        );
        return;
      }
      let diffData = computeDiff(
        baseData,
        otherData,
        diffMode as DiffMode,
      );
      if (colormap !== "none") {
        diffData = applyColormap(
          diffData,
          colormap as Exclude<Colormap, "none">,
          cmapMode,
        );
      }
      setCachedImageData(cacheKey, diffData);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      if (
        canvas.width !== diffData.width ||
        canvas.height !== diffData.height
      ) {
        canvas.width = diffData.width;
        canvas.height = diffData.height;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.putImageData(diffData, 0, 0);
      updateDims(diffData.width, diffData.height);
      setDiffReady(true);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineUrl, imageUrl, diffMode, showDiff, colormap, onNaturalSize]);

  // -----------------------------------------------------------------------
  // Render (display-element branch verbatim from ImagePane; frame = shell)
  // -----------------------------------------------------------------------
  const imgRendering =
    interpolation === "auto" ? undefined : interpolation;
  const invertStyle = flipSign ? { filter: "invert(1)" } : {};

  const overlayNode =
    overlay &&
    overlaySettings?.enabled &&
    naturalDims &&
    imageUrl &&
    ((overlay.boxes?.length ?? 0) > 0 ||
      (overlay.masks?.length ?? 0) > 0) ? (
      <ImageOverlay
        data={overlay}
        settings={overlaySettings}
        naturalWidth={naturalDims.w}
        naturalHeight={naturalDims.h}
      />
    ) : undefined;

  return (
    <CpuPaneShell
      zoom={zoomProp}
      pan={panProp}
      onViewportChange={onViewportChange}
      showAxes={showAxes}
      naturalDims={naturalDims}
      label={label}
      showLabelChip
      isDraggable={isDraggable}
      onDragStart={onDragStart}
      toolbar={toolbar}
      notationSeed={pixelValueNotation}
      sample={samplePixel}
      pixelDataVersion={pixelDataVersion}
      displayElRef={displayElRef}
      exportCanvasRef={exportCanvasRef}
      hasPixelSource={!!imageUrl}
      header={
        <GammaFilterSvg id={gammaFilterId} gamma={gamma} offset={offset} />
      }
      overlayNode={overlayNode}
    >
      {!imageUrl ? (
        <span className="text-xs text-fg-muted">no image</span>
      ) : showDiff ? (
        <>
          {!diffReady && (
            <span className="text-xs text-fg-muted motion-safe:animate-pulse">
              computing diff...
            </span>
          )}
          <canvas
            ref={setCanvasEl}
            className="w-full h-full object-contain block"
            style={{
              display: diffReady ? "block" : "none",
              imageRendering: imgRendering,
              ...invertStyle,
            }}
          />
        </>
      ) : useFalseColor ? (
        <>
          {!falseColorReady && (
            <span className="text-xs text-fg-muted motion-safe:animate-pulse">
              applying colormap...
            </span>
          )}
          <canvas
            ref={setFalseColorEl}
            className="w-full h-full object-contain block"
            style={{
              display: falseColorReady ? "block" : "none",
              imageRendering: imgRendering,
              ...invertStyle,
            }}
          />
        </>
      ) : (
        <img
          ref={setImgEl}
          src={imageUrl}
          alt={label}
          className="w-full h-full object-contain block"
          draggable={false}
          style={{
            filter: filterStr,
            imageRendering: imgRendering,
          }}
          onLoad={(e) => {
            const img = e.currentTarget;
            setNaturalDims({
              w: img.naturalWidth,
              h: img.naturalHeight,
            });
            onNaturalSize?.(img.naturalWidth, img.naturalHeight);
          }}
        />
      )}
    </CpuPaneShell>
  );
}

// ---------------------------------------------------------------------------
// HDR branch — the former HdrImagePane body (single CPU tone-map pass ported
// verbatim), rendering its canvas through the shared shell. No colormap /
// compare-diff / processing here — asymmetric by design (see module doc).
// ---------------------------------------------------------------------------

function CpuHdrImagePane(props: HdrGpuImagePaneProps & { toolbar?: boolean }) {
  const {
    hdr,
    tonemap = "srgb",
    exposure = 0,
    gamma,
    showAxes = false,
    label = "",
    interpolation = "auto",
    zoom = 1,
    pan = { x: 0, y: 0 },
    onViewportChange,
    pixelValueNotation = "decimal",
    toolbar = true,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // Retained tone-mapped pixels — used for the overlay's auto-contrast.
  const dispDataRef = useRef<ImageData | null>(null);
  const [pixelDataVersion, setPixelDataVersion] = useState(0);

  // Single CPU tone-map pass; reruns on data / tonemap / exposure / gamma.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let imageData: ImageData;
    try {
      imageData = tonemapToImageData(hdr, tonemap, exposure, gamma);
    } catch (err) {
      console.error("[cairn] HDR tone-map error:", err);
      return;
    }
    if (canvas.width !== imageData.width || canvas.height !== imageData.height) {
      canvas.width = imageData.width;
      canvas.height = imageData.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(imageData, 0, 0);
    dispDataRef.current = imageData;
    setPixelDataVersion((v) => v + 1);
    setDims((prev) =>
      prev && prev.w === imageData.width && prev.h === imageData.height
        ? prev
        : { w: imageData.width, h: imageData.height },
    );
  }, [hdr, tonemap, exposure, gamma]);

  // TEV-style per-pixel value overlay: reads the RAW float samples so the
  // numbers are the true scene values (not the tone-mapped display pixels).
  const samplePixel = useCallback(
    (px: number, py: number, notation: PixelValueNotation): PixelSample | null => {
      const d = dims;
      if (!d || px < 0 || py < 0 || px >= d.w || py >= d.h) return null;
      const c = hdr.shape.length === 2 ? 1 : (hdr.shape[2] ?? 1);
      const base = (py * d.w + px) * c;
      const src = hdr.data;
      const disp = dispDataRef.current;
      let luminance = 0.5;
      if (disp && disp.width === d.w && disp.height === d.h) {
        const j = (py * d.w + px) * 4;
        luminance =
          (0.299 * disp.data[j]! +
            0.587 * disp.data[j + 1]! +
            0.114 * disp.data[j + 2]!) /
          255;
      }
      if (c === 1) {
        return {
          lines: [formatChannelValue(src[base] ?? 0, "unit", notation)],
          luminance,
        };
      }
      // Multi-channel HDR: tint each float line by its channel (R/G/B).
      return {
        lines: [
          formatChannelValue(src[base] ?? 0, "unit", notation),
          formatChannelValue(src[base + 1] ?? 0, "unit", notation),
          formatChannelValue(src[base + 2] ?? 0, "unit", notation),
        ],
        luminance,
        colors: [CHANNEL_COLORS[0], CHANNEL_COLORS[1], CHANNEL_COLORS[2]],
      };
    },
    [hdr, dims],
  );

  const imgRendering = interpolation === "auto" ? undefined : interpolation;

  return (
    <CpuPaneShell
      zoom={zoom}
      pan={pan}
      onViewportChange={onViewportChange}
      showAxes={showAxes}
      naturalDims={dims}
      label={label}
      showLabelChip={!!label}
      toolbar={toolbar}
      notationSeed={pixelValueNotation}
      sample={samplePixel}
      pixelDataVersion={pixelDataVersion}
      displayElRef={canvasRef}
      exportCanvasRef={canvasRef}
      hasPixelSource
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain block"
        style={{ imageRendering: imgRendering }}
      />
    </CpuPaneShell>
  );
}

// ---------------------------------------------------------------------------
// Public component.
// ---------------------------------------------------------------------------

/** `ImageBackendProps` plus the shim-only chrome flag (see module doc). */
export type CpuImagePaneProps =
  | (HdrGpuImagePaneProps & { toolbar?: boolean })
  | (SdrGpuImagePaneProps & { toolbar?: boolean });

/**
 * One of the two interchangeable image backends (the CPU/2D-canvas one — see
 * `GpuImagePane` for the WebGPU other); both accept `ImageBackendProps` and
 * are assignable to `ImageBackend`.
 */
export default function CpuImagePane(props: CpuImagePaneProps): JSX.Element {
  return isHdrProps(props) ? (
    <CpuHdrImagePane {...props} />
  ) : (
    <CpuSdrImagePane {...props} />
  );
}

// Compile-time contract check: CpuImagePane implements the shared backend
// interface (accepts the plain `ImageBackendProps` union — `toolbar` is
// optional, so the plain union is assignable to `CpuImagePaneProps`).
const _backendCheck: ImageBackend = CpuImagePane;
void _backendCheck;

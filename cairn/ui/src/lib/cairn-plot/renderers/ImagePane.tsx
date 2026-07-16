import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Colormap,
  DiffMode,
  ImageProcessing,
  Interpolation,
  ImageOverlayData,
  ImageOverlaySettings,
} from "../types";
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
import PixelAxes from "../primitives/PixelAxes";
import LabelChip from "../primitives/LabelChip";
import PixelValueOverlay, {
  CHANNEL_COLORS,
  type PixelSample,
} from "../primitives/PixelValueOverlay";
import { useImageViewport, type Viewport as ImageViewport } from "../hooks/use-image-viewport";

const DEFAULT_PROCESSING: ImageProcessing = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  exposure: 0,
  offset: 0,
  flipSign: false,
};

export interface ImagePaneProps {
  imageUrl: string | null;
  baselineUrl: string | null;
  isBaseline?: boolean;
  diffMode: "none" | DiffMode;
  interpolation: Interpolation;
  colormap: Colormap;
  showAxes: boolean;

  processing?: ImageProcessing;

  zoom?: number;
  pan?: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;

  onNaturalSize?: (w: number, h: number) => void;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  className?: string;

  /** Optional bounding-box / segmentation-mask annotations for this image. */
  overlay?: ImageOverlayData;
  overlaySettings?: ImageOverlaySettings;
}

export default function ImagePane({
  imageUrl,
  baselineUrl,
  isBaseline = false,
  diffMode,
  interpolation,
  colormap,
  showAxes,
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
}: ImagePaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const falseColorRef = useRef<HTMLCanvasElement | null>(null);
  const imgWrapperRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);

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
  // CSS transform (computed locally from zoom + pan)
  // -----------------------------------------------------------------------
  const transformStr = `translate(${panProp.x}px, ${panProp.y}px) scale(${zoomProp})`;

  // -----------------------------------------------------------------------
  // Viewport interaction (modifier-gated wheel zoom-to-cursor + pointer pan)
  // -----------------------------------------------------------------------
  const { containerProps: viewportProps } = useImageViewport({
    containerRef: paneRef,
    zoom: zoomProp,
    pan: panProp,
    onViewportChange,
  });

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
    (px: number, py: number): PixelSample | null => {
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
      if (single) return { lines: [String(r)], luminance };
      // Multi-channel: tint each digit line by its channel (R/G/B).
      return {
        lines: [String(r), String(g), String(b)],
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
  // Render
  // -----------------------------------------------------------------------
  const imgRendering =
    interpolation === "auto" ? undefined : interpolation;
  const invertStyle = flipSign ? { filter: "invert(1)" } : {};

  return (
    <div className="relative flex flex-col h-full">
      {/* SVG gamma filter — scoped to this component via unique ID */}
      <GammaFilterSvg id={gammaFilterId} gamma={gamma} offset={offset} />

      <div
        ref={paneRef}
        className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard"
        style={{
          padding:
            showAxes && naturalDims ? "16px 4px 4px 28px" : "4px",
          ...viewportProps.style,
        }}
        onPointerDown={viewportProps.onPointerDown}
        onPointerMove={viewportProps.onPointerMove}
        onPointerUp={viewportProps.onPointerUp}
        onPointerCancel={viewportProps.onPointerCancel}
      >
        <div
          ref={imgWrapperRef}
          className="relative w-full h-full"
          style={{ transform: transformStr, transformOrigin: "0 0" }}
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
          {showAxes && naturalDims && (
            <PixelAxes
              naturalWidth={naturalDims.w}
              naturalHeight={naturalDims.h}
              zoom={zoomProp}
              containerRef={imgWrapperRef}
            />
          )}
          {overlay &&
            overlaySettings?.enabled &&
            naturalDims &&
            imageUrl &&
            ((overlay.boxes?.length ?? 0) > 0 ||
              (overlay.masks?.length ?? 0) > 0) && (
              <ImageOverlay
                data={overlay}
                settings={overlaySettings}
                naturalWidth={naturalDims.w}
                naturalHeight={naturalDims.h}
              />
            )}
        </div>
        {imageUrl && naturalDims && (
          <PixelValueOverlay
            imageElRef={displayElRef}
            naturalWidth={naturalDims.w}
            naturalHeight={naturalDims.h}
            zoom={zoomProp}
            pan={panProp}
            sample={samplePixel}
            version={pixelDataVersion}
          />
        )}
      </div>
      <LabelChip label={label} isDraggable={isDraggable} onDragStart={onDragStart} />
    </div>
  );
}

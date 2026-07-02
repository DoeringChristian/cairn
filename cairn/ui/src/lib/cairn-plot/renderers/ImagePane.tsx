import { useCallback, useEffect, useRef, useState } from "react";
import type { Colormap, DiffMode, Interpolation } from "../types";
import { useGammaFilter, GammaFilterSvg } from "./gamma-filter";
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
import { useImageViewport } from "../hooks/use-image-viewport";

export interface ImageProcessingProps {
  brightness: number;
  contrast: number;
  gamma: number;
  exposure: number;
  offset: number;
  flipSign: boolean;
}

const DEFAULT_PROCESSING: ImageProcessingProps = {
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

  processing?: ImageProcessingProps;

  zoom?: number;
  pan?: { x: number; y: number };
  onViewportChange?: (patch: {
    zoom?: number;
    pan?: { x: number; y: number };
  }) => void;

  onNaturalSize?: (w: number, h: number) => void;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  className?: string;
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
}: ImagePaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const falseColorRef = useRef<HTMLCanvasElement | null>(null);
  const imgWrapperRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
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
    // Pane's public prop is patch-style; the hook emits full-replace
    // ({ zoom, pan }), which is a valid patch — pass it through directly.
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
        className="flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard"
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
                ref={canvasRef}
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
                ref={falseColorRef}
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
        </div>
      </div>
      <span
        className={`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${isDraggable ? " cairn-drag-grip" : ""}`}
        draggable={isDraggable}
        onDragStart={onDragStart}
        style={{ cursor: isDraggable ? "grab" : undefined }}
      >
        {isDraggable && (
          <i
            className="fa-solid fa-grip-vertical text-[8px] opacity-50"
            aria-hidden="true"
          />
        )}
        {label}
      </span>
    </div>
  );
}

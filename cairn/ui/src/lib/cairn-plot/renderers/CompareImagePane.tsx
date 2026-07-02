import { useRef, useState } from "react";
import type {
  CompareMode,
  ImageProcessing,
  Interpolation,
  ImageOverlayData,
  ImageOverlaySettings,
} from "../types";
import { useImageViewport, type Viewport as ImageViewport } from "../hooks/use-image-viewport";
import { useGammaFilter, GammaFilterSvg } from "./gamma-filter";
import ImageOverlay from "./ImageOverlay";

const DEFAULT_PROCESSING: ImageProcessing = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  exposure: 0,
  offset: 0,
  flipSign: false,
};

export interface CompareImagePaneProps {
  imageUrl: string | null;
  baselineUrl: string | null;
  /** split | blend — side-by-side is handled by two plain ImagePanes. */
  mode: Exclude<CompareMode, "side-by-side">;
  splitPosition: number;
  blendAlpha: number;
  onSplitPositionChange?: (p: number) => void;

  zoom: number;
  pan: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;

  processing?: ImageProcessing;
  interpolation?: Interpolation;

  label?: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;

  /** Overlay annotations — applied to the FOREGROUND (prediction) image only. */
  overlay?: ImageOverlayData;
  overlaySettings?: ImageOverlaySettings;
}

/**
 * Compare pane that stacks two images (prediction over baseline/reference) and
 * blends them via either a draggable split (clipPath) or an opacity blend.
 * Self-contained: zoom/pan interaction runs through `useImageViewport`; the
 * gamma filter comes from the shared `useGammaFilter` helper.
 */
export default function CompareImagePane({
  imageUrl,
  baselineUrl,
  mode,
  splitPosition,
  blendAlpha,
  onSplitPositionChange,
  zoom,
  pan,
  onViewportChange,
  processing = DEFAULT_PROCESSING,
  interpolation = "auto",
  label = "",
  isDraggable = false,
  onDragStart,
  overlay,
  overlaySettings,
}: CompareImagePaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);

  const showOverlay =
    !!overlay &&
    !!overlaySettings?.enabled &&
    !!naturalDims &&
    !!imageUrl &&
    ((overlay.boxes?.length ?? 0) > 0 || (overlay.masks?.length ?? 0) > 0);

  const { gammaFilterId, filterStr, gamma, offset } = useGammaFilter(processing);
  const transformStr = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  const imgRendering = interpolation === "auto" ? undefined : interpolation;

  const { containerProps: viewportProps, modifierActive } = useImageViewport({
    containerRef: paneRef,
    zoom,
    pan,
    onViewportChange,
  });

  return (
    <div className="relative flex flex-col h-full">
      <GammaFilterSvg id={gammaFilterId} gamma={gamma} offset={offset} />

      <div
        ref={paneRef}
        className="flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard"
        style={{ padding: "4px", ...viewportProps.style }}
        onPointerDown={viewportProps.onPointerDown}
        onPointerMove={viewportProps.onPointerMove}
        onPointerUp={viewportProps.onPointerUp}
        onPointerCancel={viewportProps.onPointerCancel}
      >
        <div className="relative w-full h-full">
          <div className="relative w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
            <img
              src={imageUrl ?? undefined}
              alt="pred"
              className="w-full h-full object-contain block"
              draggable={false}
              style={{
                filter: filterStr,
                imageRendering: imgRendering,
                ...(mode === "blend" ? { opacity: blendAlpha } : {}),
              }}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
              }}
            />
            {showOverlay && (
              <ImageOverlay
                data={overlay!}
                settings={overlaySettings!}
                naturalWidth={naturalDims!.w}
                naturalHeight={naturalDims!.h}
              />
            )}
          </div>
          <div
            className="absolute inset-0 overflow-hidden"
            style={mode === "split" ? { clipPath: `inset(0 ${(1 - splitPosition) * 100}% 0 0)` } : undefined}
          >
            <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
              <img
                src={baselineUrl ?? undefined}
                alt="ref"
                className="w-full h-full object-contain block"
                draggable={false}
                style={{
                  filter: filterStr,
                  imageRendering: imgRendering,
                  ...(mode === "blend" ? { opacity: 1 - blendAlpha } : {}),
                }}
              />
            </div>
          </div>
          {mode === "split" && (
            <div
              className="absolute top-0 bottom-0 z-20 flex items-center"
              style={{ left: `${splitPosition * 100}%`, transform: "translateX(-50%)", cursor: "col-resize" }}
              onDoubleClick={() => onSplitPositionChange?.(0.5)}
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
      </div>
      <span className="absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm">
        REF
      </span>
      <span
        className={`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${isDraggable && !modifierActive ? " cairn-drag-grip" : ""}`}
        draggable={isDraggable && !modifierActive}
        onDragStart={onDragStart}
        style={{ cursor: isDraggable && !modifierActive ? "grab" : undefined }}
      >
        <i className="fa-solid fa-grip-vertical text-[8px] opacity-50" />
        {label}
      </span>
    </div>
  );
}

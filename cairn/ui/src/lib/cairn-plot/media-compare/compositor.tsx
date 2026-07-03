import { useRef, useState } from "react";
import type {
  Colormap,
  DiffMode,
  ImageOverlayData,
  ImageOverlaySettings,
  ImageProcessing,
  Interpolation,
} from "../types";
import { useImageViewport, type Viewport as ImageViewport } from "../hooks/use-image-viewport";
import { useGammaFilter, GammaFilterSvg } from "./post-processing";
import ImageOverlay from "../renderers/ImageOverlay";
import ImagePane from "../renderers/ImagePane";
import type { MediaCompareModeKind } from "./mode";

const DEFAULT_PROCESSING: ImageProcessing = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  exposure: 0,
  offset: 0,
  flipSign: false,
};

// ---------------------------------------------------------------------------
// MediaComparePane — the split/blend compositor.
//
// Absorbed from renderers/CompareImagePane.tsx verbatim (mechanics
// unchanged: clip-path drag handle for split, opacity cross-fade for blend).
// This is now the ONE split/blend implementation; CompareImagePane.tsx is
// deleted (spec-visual-compare.md quality bar #2).
// ---------------------------------------------------------------------------

export interface MediaComparePaneProps {
  imageUrl: string | null;
  baselineUrl: string | null;
  mode: Extract<MediaCompareModeKind, "split" | "blend">;
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
export function MediaComparePane({
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
}: MediaComparePaneProps) {
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

// ---------------------------------------------------------------------------
// CompositeMediaPane — the single compositor entry point.
//
// Given a foreground (prediction) source and a reference (baseline) source,
// renders whichever of the five core modes is active: normal (single pane,
// reference tracked but not shown) | side (two plain panes) | split/blend
// (MediaComparePane above) | diff (delegates to ImagePane's existing
// pixel-diff pipeline — cairn-plot/image/diff.ts + webgl-diff.ts, NOT
// duplicated here). This is what ImageGalleryCard's per-pane rendering now
// calls instead of its own renderSideBySidePane/renderOverlayPane/plain
// switch (spec-visual-compare.md quality bar #2 — one compositor, written
// once).
//
// `baselineUrl == null` always forces "normal" regardless of `mode` — a mode
// selection with no resolved reference has nothing to compare against. The
// caller decides *whether* a reference resolves for this pane (including
// card-specific nuances like "hide split/blend against a content-addressed
// duplicate of itself") and passes `baselineUrl: null` to opt a pane out.
// ---------------------------------------------------------------------------

export interface CompositeMediaPaneProps {
  mode: MediaCompareModeKind;
  imageUrl: string | null;
  baselineUrl: string | null;
  /** True when this pane's own image IS the resolved reference series
   *  (the "series-same-step" baseline pane rendered alongside its peers). */
  isReferencePane?: boolean;

  /** Used only when the effective mode is "diff". */
  diffSubmode: DiffMode;
  colormap: Colormap;
  interpolation: Interpolation;
  showAxes?: boolean;
  processing?: ImageProcessing;

  zoom: number;
  pan: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;

  /** Used only when the effective mode is "split" | "blend". */
  splitPosition?: number;
  blendAlpha?: number;
  onSplitPositionChange?: (p: number) => void;

  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onNaturalSize?: (w: number, h: number) => void;

  overlay?: ImageOverlayData;
  overlaySettings?: ImageOverlaySettings;
}

export function CompositeMediaPane({
  mode,
  imageUrl,
  baselineUrl,
  isReferencePane,
  diffSubmode,
  colormap,
  interpolation,
  showAxes,
  processing,
  zoom,
  pan,
  onViewportChange,
  splitPosition,
  blendAlpha,
  onSplitPositionChange,
  label,
  isDraggable,
  onDragStart,
  onNaturalSize,
  overlay,
  overlaySettings,
}: CompositeMediaPaneProps) {
  const effectiveMode: MediaCompareModeKind = baselineUrl == null ? "normal" : mode;

  if (effectiveMode === "side") {
    return (
      <div className="flex gap-0.5 h-full">
        <div className="relative flex-1 min-w-0 overflow-hidden border border-accent/20 rounded">
          <ImagePane
            imageUrl={baselineUrl}
            baselineUrl={null}
            isBaseline
            diffMode="none"
            interpolation={interpolation}
            colormap="none"
            showAxes={false}
            processing={processing}
            zoom={zoom}
            pan={pan}
            onViewportChange={onViewportChange}
            label="REF"
          />
        </div>
        <div className="relative flex-1 min-w-0 overflow-hidden">
          <ImagePane
            imageUrl={imageUrl}
            baselineUrl={baselineUrl}
            isBaseline={false}
            diffMode="none"
            interpolation={interpolation}
            colormap={colormap}
            showAxes={showAxes ?? false}
            processing={processing}
            zoom={zoom}
            pan={pan}
            onViewportChange={onViewportChange}
            isDraggable={isDraggable}
            onDragStart={onDragStart}
            onNaturalSize={onNaturalSize}
            label={label}
            overlay={overlay}
            overlaySettings={overlaySettings}
          />
        </div>
      </div>
    );
  }

  if (effectiveMode === "split" || effectiveMode === "blend") {
    return (
      <MediaComparePane
        imageUrl={imageUrl}
        baselineUrl={baselineUrl}
        mode={effectiveMode}
        splitPosition={splitPosition ?? 0.5}
        blendAlpha={blendAlpha ?? 0.5}
        onSplitPositionChange={onSplitPositionChange}
        zoom={zoom}
        pan={pan}
        onViewportChange={onViewportChange}
        processing={processing}
        interpolation={interpolation}
        label={label}
        isDraggable={isDraggable}
        onDragStart={onDragStart}
        overlay={overlay}
        overlaySettings={overlaySettings}
      />
    );
  }

  // "normal" | "diff" — one pane; ImagePane already owns the pixel-diff
  // pipeline (cache, GPU/CPU dispatch) and the false-color path, so "diff"
  // is simply passing its diffMode through, not a separate implementation.
  return (
    <ImagePane
      imageUrl={imageUrl}
      baselineUrl={baselineUrl}
      isBaseline={isReferencePane}
      diffMode={effectiveMode === "diff" ? diffSubmode : "none"}
      interpolation={interpolation}
      colormap={colormap}
      showAxes={showAxes ?? false}
      processing={processing}
      zoom={zoom}
      pan={pan}
      onViewportChange={onViewportChange}
      isDraggable={isDraggable}
      onDragStart={onDragStart}
      onNaturalSize={onNaturalSize}
      label={label}
      overlay={overlay}
      overlaySettings={overlaySettings}
    />
  );
}

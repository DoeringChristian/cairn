import { useEffect, useMemo, useRef, useState } from "react";
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
import PixelValueOverlay, {
  CHANNEL_COLORS,
  PixelNotationToggle,
  formatChannelValue,
  type PixelSample,
  type PixelValueNotation,
} from "../primitives/PixelValueOverlay";
import { loadImageData } from "../image";
import type { MediaCompareModeKind } from "./mode";
import { alignFrameSourcesForDiff } from "./cross-type-align";
import type { GpuComparePaneProps } from "./GpuComparePane";
import { resolveRenderMode } from "../renderers/image-backend";

declare global {
  interface Window {
    /** Opt-in flag (same one `plot-gpu-image-addon.tsx` gates `GpuImagePane`
     *  on): `true` routes split/blend/diff through the engine. */
    __cairnPlotUseGpuImage?: boolean;
    /**
     * The engine-backed compare pane, injected at RUNTIME by the lazy
     * gpu-image addon (`plot-gpu-image-addon.tsx`) — NOT a static import, so
     * `core` stays free of the WebGPU engine (the bundle guard: core
     * carries no `engine/*`; it ships in the addon IIFE). `compositor.tsx` is
     * reachable from `core`, so this indirection is REQUIRED: a static
     * `import GpuComparePane` here would pull `renderCompare`/`computeMetrics`
     * and the WebGPU device into `core.iife.js`.
     */
    __cairnPlotGpuComparePane?: (props: GpuComparePaneProps) => JSX.Element | null;
  }
}

/**
 * Dispatched by `plot-gpu-image-addon.tsx` once its capability check
 * resolves and it has set `__cairnPlotGpuComparePane`/`__cairnPlotUseGpuImage`
 * (Task 8). Name duplicated (not imported) — `compositor.tsx` is a CORE file
 * an addon may depend on, never the reverse.
 */
const GPU_IMAGE_READY_EVENT = "cairn-plot:gpu-image-ready";

/**
 * Resolve the runtime-injected engine compare pane, but only when the opt-in
 * flag is set AND the gpu-image addon has registered it. Unset/false (or addon
 * absent) keeps the legacy CPU `MediaComparePane` / `ImagePane` diff path —
 * the Task 8 brief's required fallback (either the addon never loaded, the
 * host opted out, or `getSharedDevice()` found WebGPU unavailable). The
 * compare-pane counterpart to `plot-renderers.tsx`'s `resolveImageRenderer`
 * — same capability-gated seam, same WebGPU-or-legacy-CPU-pane fallback
 * boundary (see `docs/superpowers/specs/2026-07-16-webgpu-engine-design.md`).
 */
function resolveGpuComparePane(): ((props: GpuComparePaneProps) => JSX.Element | null) | null {
  if (typeof window === "undefined") return null;
  // Honor the user-settable render mode (cpu | gpu | auto — same seam as
  // `resolveImageRenderer`): "cpu" forces the legacy CPU compare path; "gpu"
  // forces the engine pane when registered (outranking the opt-in flag, like
  // the image seam — unavailable falls through to CPU); "auto" keeps the
  // flag-gated default.
  const mode = resolveRenderMode();
  if (mode === "cpu") return null;
  if (mode === "gpu") return window.__cairnPlotGpuComparePane ?? null;
  if (window.__cairnPlotUseGpuImage !== true) return null;
  return window.__cairnPlotGpuComparePane ?? null;
}

/**
 * The addon's `getSharedDevice()` capability check is async and can resolve
 * AFTER `CompositeMediaPane`'s first paint, so a pane that mounted before
 * then would otherwise render on the legacy path forever (nothing else
 * re-renders it). This hook forces one re-render the instant the addon
 * finishes, so the engine pane picks up as soon as it's available.
 */
function useGpuCompareReadyTick(): void {
  const [, bump] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || window.__cairnPlotGpuComparePane) return;
    const onReady = () => bump((n) => n + 1);
    window.addEventListener(GPU_IMAGE_READY_EVENT, onReady);
    return () => window.removeEventListener(GPU_IMAGE_READY_EVENT, onReady);
  }, []);
}

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

  /** Initial notation for the pixel-value overlay (user-toggleable in-pane). */
  pixelValueNotation?: PixelValueNotation;
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
  pixelValueNotation = "decimal",
}: MediaComparePaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
  const [refDims, setRefDims] = useState<{ w: number; h: number } | null>(null);
  const [notation, setNotation] = useState<PixelValueNotation>(pixelValueNotation);
  const [overlayActive, setOverlayActive] = useState(false);

  // TEV-style per-pixel value overlay. The split/blend compositor draws raw
  // <img>s (not ImagePane), so it carries its own overlay so pixel values still
  // appear when you zoom in far enough here too. In SPLIT mode BOTH sources are
  // sampled: the reference (left of the divider) and the foreground/comparison
  // (right of the divider), each clipped to its own side and re-read live as the
  // divider moves.
  const fgImgRef = useRef<HTMLImageElement | null>(null);
  const refImgRef = useRef<HTMLImageElement | null>(null);
  const fgDataRef = useRef<ImageData | null>(null);
  const refDataRef = useRef<ImageData | null>(null);
  const [pixelDataVersion, setPixelDataVersion] = useState(0);
  useEffect(() => {
    if (!imageUrl) {
      fgDataRef.current = null;
      setPixelDataVersion((v) => v + 1);
      return;
    }
    let cancelled = false;
    loadImageData(imageUrl).then((d) => {
      if (cancelled) return;
      fgDataRef.current = d;
      setPixelDataVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);
  useEffect(() => {
    if (!baselineUrl) {
      refDataRef.current = null;
      setPixelDataVersion((v) => v + 1);
      return;
    }
    let cancelled = false;
    loadImageData(baselineUrl).then((d) => {
      if (cancelled) return;
      refDataRef.current = d;
      setPixelDataVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [baselineUrl]);

  // One sampler factory over an ImageData ref — identical formatting/tinting for
  // the foreground and the reference source.
  const makeSampler =
    (dataRef: React.RefObject<ImageData | null>) =>
    (px: number, py: number, notation: PixelValueNotation): PixelSample | null => {
      const d = dataRef.current;
      if (!d || px < 0 || py < 0 || px >= d.width || py >= d.height) return null;
      const i = (py * d.width + px) * 4;
      const r = d.data[i]!;
      const g = d.data[i + 1]!;
      const b = d.data[i + 2]!;
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (r === g && g === b) {
        return { lines: [formatChannelValue(r, "uint8", notation)], luminance };
      }
      return {
        lines: [
          formatChannelValue(r, "uint8", notation),
          formatChannelValue(g, "uint8", notation),
          formatChannelValue(b, "uint8", notation),
        ],
        luminance,
        colors: [CHANNEL_COLORS[0], CHANNEL_COLORS[1], CHANNEL_COLORS[2]],
      };
    };
  const sampleFg = useMemo(() => makeSampler(fgDataRef), []);
  const sampleRef = useMemo(() => makeSampler(refDataRef), []);

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
        // No padding: the reference (left) side must fill exactly [0..split]
        // edge-to-edge (no checkerboard seam), the full-height divider must
        // reach the top/bottom edges, and the divider-drag math maps the
        // pointer across the FULL pane width so splitPosition stays exact.
        className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard"
        style={{ padding: 0, ...viewportProps.style }}
        onPointerDown={viewportProps.onPointerDown}
        onPointerMove={viewportProps.onPointerMove}
        onPointerUp={viewportProps.onPointerUp}
        onPointerCancel={viewportProps.onPointerCancel}
      >
        <div className="relative w-full h-full">
          <div className="relative w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
            <img
              ref={fgImgRef}
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
                ref={refImgRef}
                src={baselineUrl ?? undefined}
                alt="ref"
                className="w-full h-full object-contain block"
                draggable={false}
                style={{
                  filter: filterStr,
                  imageRendering: imgRendering,
                  ...(mode === "blend" ? { opacity: 1 - blendAlpha } : {}),
                }}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setRefDims({ w: img.naturalWidth, h: img.naturalHeight });
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
        {/* Per-pixel value overlay. In SPLIT mode each side samples its OWN
            source, clipped at the divider so the numbers under the divider
            always match the image actually shown there; the clip is driven by
            `splitPosition`, so it re-reveals per side live as the divider moves.
            Blend/normal show a single foreground overlay. */}
        {mode === "split" ? (
          <>
            {baselineUrl && refDims && (
              <div
                className="absolute inset-0 overflow-hidden pointer-events-none"
                style={{ clipPath: `inset(0 ${(1 - splitPosition) * 100}% 0 0)` }}
              >
                <PixelValueOverlay
                  imageElRef={refImgRef}
                  naturalWidth={refDims.w}
                  naturalHeight={refDims.h}
                  zoom={zoom}
                  pan={pan}
                  sample={sampleRef}
                  notation={notation}
                  version={pixelDataVersion}
                />
              </div>
            )}
            {imageUrl && naturalDims && (
              <div
                className="absolute inset-0 overflow-hidden pointer-events-none"
                style={{ clipPath: `inset(0 0 0 ${splitPosition * 100}%)` }}
              >
                <PixelValueOverlay
                  imageElRef={fgImgRef}
                  naturalWidth={naturalDims.w}
                  naturalHeight={naturalDims.h}
                  zoom={zoom}
                  pan={pan}
                  sample={sampleFg}
                  notation={notation}
                  version={pixelDataVersion}
                  onActiveChange={setOverlayActive}
                />
              </div>
            )}
          </>
        ) : (
          imageUrl &&
          naturalDims && (
            <PixelValueOverlay
              imageElRef={fgImgRef}
              naturalWidth={naturalDims.w}
              naturalHeight={naturalDims.h}
              zoom={zoom}
              pan={pan}
              sample={sampleFg}
              notation={notation}
              version={pixelDataVersion}
              onActiveChange={setOverlayActive}
            />
          )
        )}
        {overlayActive && (
          <PixelNotationToggle notation={notation} onChange={setNotation} />
        )}
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

  /** Initial notation for the pixel-value overlay (user-toggleable in-pane). */
  pixelValueNotation?: PixelValueNotation;
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
  pixelValueNotation,
}: CompositeMediaPaneProps) {
  const effectiveMode: MediaCompareModeKind = baselineUrl == null ? "normal" : mode;
  useGpuCompareReadyTick();
  const GpuCompare = resolveGpuComparePane();

  // Engine-backed split/blend/diff (opt-in — see `resolveGpuComparePane`). One
  // `renderCompare` GPU pass replaces the CPU clip-path split / opacity blend /
  // webgl-diff path, plus a `computeMetrics` MSE/PSNR/MAE readout. Q17
  // double-click-resets the shared viewport inside GpuComparePane.
  if (
    GpuCompare &&
    baselineUrl != null &&
    (effectiveMode === "split" || effectiveMode === "blend" || effectiveMode === "diff")
  ) {
    return (
      <GpuCompare
        imageUrl={imageUrl}
        baselineUrl={baselineUrl}
        mode={effectiveMode}
        splitPosition={splitPosition ?? 0.5}
        blendAlpha={blendAlpha ?? 0.5}
        onSplitPositionChange={onSplitPositionChange}
        diffSubmode={diffSubmode}
        colormap={colormap}
        zoom={zoom}
        pan={pan}
        onViewportChange={onViewportChange}
        interpolation={interpolation}
        label={label}
        pixelValueNotation={pixelValueNotation}
      />
    );
  }

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
            pixelValueNotation={pixelValueNotation}
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
            pixelValueNotation={pixelValueNotation}
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
        pixelValueNotation={pixelValueNotation}
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
      pixelValueNotation={pixelValueNotation}
    />
  );
}

// ---------------------------------------------------------------------------
// CrossTypeCompositeMediaPane — a thin wrapper around `CompositeMediaPane`
// (NOT a second compare path) for WS-VC6's cross-type `diff`.
//
// Every other mode (normal/side/split/blend) works on the raw `imageUrl`/
// `baselineUrl` unchanged — CSS `object-fit: contain` already handles
// mismatched aspect visually. `diff` does per-pixel math, so when
// `alignForDiff` is set (only ever true for a cross-type pane — see
// VisualContentCard's wiring) this pre-resamples both frames onto one common
// raster via `cross-type-align.ts` before calling `CompositeMediaPane`,
// which then runs its EXISTING `image/diff.ts` pipeline unmodified (the two
// aligned frames are already equal-size, so `computeDiff`'s own
// `min(width,height)` crop becomes a no-op). While alignment is still
// pending (first mount) it falls back to the raw urls, same as today.
// ---------------------------------------------------------------------------
export function CrossTypeCompositeMediaPane(
  props: CompositeMediaPaneProps & { alignForDiff?: boolean },
) {
  const { alignForDiff, mode, imageUrl, baselineUrl, ...rest } = props;
  const shouldAlign = !!alignForDiff && mode === "diff" && !!imageUrl && !!baselineUrl;
  const [aligned, setAligned] = useState<{ a: string; b: string } | null>(null);

  useEffect(() => {
    if (!shouldAlign) {
      setAligned(null);
      return;
    }
    let cancelled = false;
    alignFrameSourcesForDiff({ kind: "url", url: imageUrl! }, { kind: "url", url: baselineUrl! }).then(
      (result) => {
        if (!cancelled && result) setAligned({ a: result.primaryUrl, b: result.referenceUrl });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAlign, imageUrl, baselineUrl]);

  const useAligned = shouldAlign && aligned;
  return (
    <CompositeMediaPane
      {...rest}
      mode={mode}
      imageUrl={useAligned ? aligned!.a : imageUrl}
      baselineUrl={useAligned ? aligned!.b : baselineUrl}
    />
  );
}

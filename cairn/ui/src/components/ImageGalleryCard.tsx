import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { useSequence, useSequences } from "../api/hooks";
import type { SequenceMeta, SequencePoint } from "../api/types";
import { useCardSettings, resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import { useSeriesDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import {  } from "../lib/format";
import { downloadArtifact, artifactFilename, exportImagesAsComposite, safeName } from "../lib/download";
import { computeDiff, loadImageData, type DiffMode } from "../lib/image-diff";
import { webglRenderDiffToCanvas } from "../lib/webgl-diff";
import { getRenderMode } from "../lib/render-mode";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { SERIES_COLORS } from "../lib/colors";
import CardDetailModal from "./CardDetailModal";
import AddToComparisonButton from "./AddToComparisonButton";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SeriesChip , { CAIRN_SERIES_MIME, type SeriesRef } from "./SeriesChip";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import StepSlider, { type XAxisMode } from "./StepSlider";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
}

type Interpolation = "auto" | "pixelated" | "crisp-edges";
type Colormap = "none" | "viridis" | "red-green" | "red-blue";

// ---------------------------------------------------------------------------
// In-memory ImageData cache (diff + false-color computations)
// ---------------------------------------------------------------------------

const IMAGE_DATA_CACHE_MAX = 50;
const imageDataCache = new Map<string, ImageData>();

function getCachedImageData(key: string): ImageData | undefined {
  return imageDataCache.get(key);
}

function setCachedImageData(key: string, data: ImageData): void {
  if (imageDataCache.size >= IMAGE_DATA_CACHE_MAX) {
    // Evict oldest entry (first key in insertion order)
    const firstKey = imageDataCache.keys().next().value;
    if (firstKey !== undefined) imageDataCache.delete(firstKey);
  }
  imageDataCache.set(key, data);
}

// ---------------------------------------------------------------------------
// Colormap LUT generation
// ---------------------------------------------------------------------------

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function buildLUT(stops: Array<[number, number, number]>): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const seg = t * (stops.length - 1);
    const lo = Math.floor(seg);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = seg - lo;
    const [r, g, b] = lerp3(stops[lo]!, stops[hi]!, f);
    lut[i * 3] = Math.round(r);
    lut[i * 3 + 1] = Math.round(g);
    lut[i * 3 + 2] = Math.round(b);
  }
  return lut;
}

const COLORMAP_STOPS: Record<Exclude<Colormap, "none">, Array<[number, number, number]>> = {
  viridis:     [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
  "red-green": [[215,25,28],[255,255,255],[26,150,65]],   // diverging: red → white → green
  "red-blue":  [[215,25,28],[255,255,255],[44,123,182]],   // diverging: red → white → blue
};

const colormapLUTs = new Map<string, Uint8Array>();
function getColormapLUT(name: Exclude<Colormap, "none">): Uint8Array {
  let lut = colormapLUTs.get(name);
  if (!lut) {
    lut = buildLUT(COLORMAP_STOPS[name]);
    colormapLUTs.set(name, lut);
  }
  return lut;
}

/**
 * Apply a colormap LUT to an ImageData.
 * @param center — the pixel value that should map to the LUT midpoint (index 128).
 *   For signed diffs, center=128 (default). For absolute/squared, center=0.
 */
/**
 * Apply a colormap LUT to an ImageData.
 *
 * `mode` controls how pixel values map to the LUT:
 * - "linear": 0→LUT[0], 255→LUT[255]. Use for raw images and non-signed diffs.
 * - "signed": 0→LUT[0], 128→LUT[128], 255→LUT[255]. Same as linear, but
 *   semantically the midpoint (128) represents zero diff. Use for signed diffs
 *   where the diff computation already maps zero to 128.
 * - "positive": 0→LUT[128], 255→LUT[255]. Use for absolute/squared diffs
 *   where 0 = no diff (should map to colormap center/white in diverging maps).
 */
function applyColormap(src: ImageData, cmap: Exclude<Colormap, "none">, mode: "linear" | "signed" | "positive" = "linear"): ImageData {
  const lut = getColormapLUT(cmap);
  const out = new ImageData(src.width, src.height);
  const sd = src.data;
  const od = out.data;
  for (let i = 0; i < sd.length; i += 4) {
    const avg = (sd[i]! + sd[i + 1]! + sd[i + 2]!) / 3;
    let idx: number;
    if (mode === "positive") {
      // Map [0,255] → [128,255] so 0 = LUT midpoint (white in diverging)
      idx = Math.round(128 + (avg / 255) * 127);
    } else {
      // Linear: direct mapping. For signed diffs, 128 is already the midpoint.
      idx = Math.round(avg);
    }
    idx = Math.max(0, Math.min(255, idx));
    od[i] = lut[idx * 3]!;
    od[i + 1] = lut[idx * 3 + 1]!;
    od[i + 2] = lut[idx * 3 + 2]!;
    od[i + 3] = sd[i + 3]!;
  }
  return out;
}

interface ImageSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  brightness: number;
  contrast: number;
  gamma: number;
  zoom: number;
  pan: { x: number; y: number };
  baselineIndex?: number;
  /** External baseline from a different metric tag. Overrides baselineIndex when set. */
  externalBaseline?: { runId?: string; name: string; context_hash: string };
  diffMode: "none" | DiffMode;
  interpolation: Interpolation;
  colormap: Colormap;
  showAxes: boolean;
  sliderStep?: number;
  height?: number;
  height1?: number;
  height2?: number;
  /** Number of columns for multi-image layout (1 or 2). */
  imageColumns?: 1 | 2;
  colSpan?: number;
  /** What to show when a run has no image at the current step. */
  missingImageMode?: "nothing" | "last_available";
  /** X-axis display mode for the step slider. */
  xAxis?: "step" | "relative_time" | "wall_time";
  /** Reference mode: global (one ref for all) or per-run (each pane has own ref). */
  referenceMode?: "global" | "per-run";
  /** For per-run mode: which step to use as each run's own baseline. */
  perRunBaselineStep?: number;
  /** Compare mode: side-by-side (default), split slider, or alpha blend. */
  compareMode?: "side-by-side" | "split" | "blend";
  /** Split position 0-1, default 0.5. */
  splitPosition?: number;
  /** Blend alpha 0-1, default 0.5. */
  blendAlpha?: number;
  /** Whether split/blend position is synced across all panes (default true). */
  splitSynced?: boolean;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;

function defaultImageSettings(seed: {
  name: string;
  context_hash: string;
}): ImageSettings {
  return {
    version: 1,
    metrics: [{ name: seed.name, context_hash: seed.context_hash }],
    brightness: 0,
    contrast: 0,
    gamma: 1,
    zoom: 1,
    pan: { x: 0, y: 0 },
    diffMode: "none",
    interpolation: "auto",
    colormap: "none",
    showAxes: false,
  };
}




function seriesLabel(
  m: { runId?: string; name: string; context_hash: string },
  fallbackRunId: string,
  multiRun: boolean,
  siblingRunIds?: string[],
): string {
  if (multiRun) {
    // Multi-run: show only run name+timestamp (tag shown once in card header)
    return shortRunLabel(m.runId ?? fallbackRunId, siblingRunIds);
  }
  // Single-run: show metric name
  const parts: string[] = [m.name];
  if (m.context_hash) parts.push(m.context_hash.slice(0, 6));
  return parts.join(" \u00b7 ");
}

function seriesKey(m: {
  runId?: string;
  name: string;
  context_hash: string;
}): string {
  return `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
}

/**
 * Resolve the artifact hash for a given global step number.
 * Uses a step→point map for O(1) lookup, with optional fallback to the
 * closest prior step that has an image.
 */
function resolveArtifact(
  stepMap: Map<number, SequencePoint>,
  targetStep: number,
  sortedSteps: number[],
  mode?: "nothing" | "last_available",
): { hash: string | undefined; fallbackStep: number | null } {
  const exact = stepMap.get(targetStep);
  if (exact?.artifact_hash) return { hash: exact.artifact_hash, fallbackStep: null };
  if (mode === "nothing") return { hash: undefined, fallbackStep: null };
  // Default ("last_available"): find closest step ≤ targetStep with an image.
  for (let i = sortedSteps.length - 1; i >= 0; i--) {
    if (sortedSteps[i]! > targetStep) continue;
    const pt = stepMap.get(sortedSteps[i]!);
    if (pt?.artifact_hash) {
      return { hash: pt.artifact_hash, fallbackStep: pt.step };
    }
  }
  return { hash: undefined, fallbackStep: null };
}

// ---------------------------------------------------------------------------
// PixelAxes — lightweight SVG overlay showing pixel coordinates.
// ---------------------------------------------------------------------------

function PixelAxes({
  naturalWidth,
  naturalHeight,
  zoom = 1,
  containerRef,
}: {
  naturalWidth: number;
  naturalHeight: number;
  zoom?: number;
  /** Ref to the container that holds the image with object-contain */
  containerRef?: React.RefObject<HTMLElement | null>;
}) {
  const tickInterval = (dim: number) => {
    if (dim <= 32) return 4;
    if (dim <= 128) return 16;
    if (dim <= 512) return 64;
    if (dim <= 2048) return 256;
    return 512;
  };

  const xInterval = tickInterval(naturalWidth);
  const yInterval = tickInterval(naturalHeight);

  const xTicks: number[] = [];
  for (let x = 0; x <= naturalWidth; x += xInterval) xTicks.push(x);

  const yTicks: number[] = [];
  for (let y = 0; y <= naturalHeight; y += yInterval) yTicks.push(y);

  const counterScale = 1 / zoom;
  const fontSize = 8 * counterScale;
  const topOffset = -12 * counterScale;
  const leftOffset = -2 * counterScale;

  // Compute rendered image bounds within the object-contain container
  const el = containerRef?.current;
  let imgLeft = 0, imgTop = 0, imgW = 0, imgH = 0;
  if (el) {
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const scaleX = cw / naturalWidth;
    const scaleY = ch / naturalHeight;
    const scale = Math.min(scaleX, scaleY);
    imgW = naturalWidth * scale;
    imgH = naturalHeight * scale;
    imgLeft = (cw - imgW) / 2;
    imgTop = (ch - imgH) / 2;
  }

  // Use computed bounds if available, else fall back to percentage
  const useBounds = el && imgW > 0;

  return (
    <>
      {/* Top axis */}
      <div className="absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none" style={{ top: useBounds ? imgTop : 0, transform: `translateY(${topOffset}px)`, fontSize }}>
        {xTicks.map((x) => (
          <span key={x} className="mono" style={{
            position: "absolute",
            left: useBounds ? imgLeft + (x / naturalWidth) * imgW : `${(x / naturalWidth) * 100}%`,
            transform: "translateX(-50%)",
          }}>{x}</span>
        ))}
      </div>
      {/* Left axis */}
      <div className="absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none" style={{ left: useBounds ? imgLeft : 0, transform: `translateX(${leftOffset}px)`, fontSize }}>
        {yTicks.map((y) => (
          <span key={y} className="mono" style={{
            position: "absolute",
            top: useBounds ? imgTop + (y / naturalHeight) * imgH : `${(y / naturalHeight) * 100}%`,
            transform: "translate(-100%, -50%)",
            paddingRight: `${3 * counterScale}px`,
          }}>{y}</span>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Colorbar — vertical gradient showing the active colormap
// ---------------------------------------------------------------------------

function Colorbar({ colormap: cmap, isDiff }: { colormap: Exclude<Colormap, "none">; isDiff?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const lut = getColormapLUT(cmap);
    c.width = 1;
    c.height = 256;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(1, 256);
    for (let i = 0; i < 256; i++) {
      const li = (255 - i) * 3;
      const pi = i * 4;
      img.data[pi] = lut[li]!;
      img.data[pi + 1] = lut[li + 1]!;
      img.data[pi + 2] = lut[li + 2]!;
      img.data[pi + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [cmap]);

  const ticks = isDiff
    ? [
        { pos: 0, label: "1.0" },
        { pos: 25, label: "0.5" },
        { pos: 50, label: "0.0" },
        { pos: 75, label: "\u22120.5" },
        { pos: 100, label: "\u22121.0" },
      ]
    : [
        { pos: 0, label: "255" },
        { pos: 25, label: "192" },
        { pos: 50, label: "128" },
        { pos: 75, label: "64" },
        { pos: 100, label: "0" },
      ];

  return (
    <div className="flex shrink-0 pl-1 w-14 py-1" style={{ height: "100%" }}>
      <canvas
        ref={canvasRef}
        className="rounded-sm shrink-0"
        style={{ imageRendering: "auto", width: 10, height: "100%" }}
      />
      <div className="relative flex-1 ml-0.5" style={{ height: "100%" }}>
        {ticks.map((t, i) => (
          <span
            key={t.pos}
            className="mono absolute text-[7px] text-fg-muted leading-none whitespace-nowrap"
            style={{
              top: `${t.pos}%`,
              // First and last ticks: align to edge instead of centering
              transform: i === 0 ? "none" : i === ticks.length - 1 ? "translateY(-100%)" : "translateY(-50%)",
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImagePane — renders a single image or canvas diff inside a split pane.
// ---------------------------------------------------------------------------

interface ImagePaneProps {
  metricEntry: { runId?: string; name: string; context_hash: string };
  paneIndex: number;
  artifactHash: string | undefined;
  baselineHash: string | undefined;
  /** True when this pane IS the global baseline (legacy ★ promotion). */
  isBaseline?: boolean;
  diffMode: ImageSettings["diffMode"];
  interpolation: Interpolation;
  colormap: Colormap;
  showAxes: boolean;
  zoom: number;
  transformStr: string;
  filterStr: string;
  onNaturalSize?: (w: number, h: number) => void;
  label: string;
}

function ImagePane({
  artifactHash,
  baselineHash,
  isBaseline = false,
  diffMode,
  interpolation,
  colormap,
  showAxes,
  zoom: zoomLevel,
  transformStr,
  filterStr,
  onNaturalSize,
  label,
}: ImagePaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const falseColorRef = useRef<HTMLCanvasElement | null>(null);
  const imgWrapperRef = useRef<HTMLDivElement | null>(null);
  const [diffReady, setDiffReady] = useState(false);
  const [falseColorReady, setFalseColorReady] = useState(false);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);

  const showDiff =
    !isBaseline &&
    diffMode !== "none" &&
    baselineHash != null &&
    artifactHash != null;

  // Don't show false color when diff is active (colormap applied in diff pipeline)
  // When diff is active, the baseline pane shows raw (no colormap) so the user
  // sees the actual reference. Non-baseline panes show the diff with colormap
  // (handled in showDiff path). When no diff, all panes get colormap.
  const isDiffActive = diffMode !== "none" && baselineHash != null;
  const useFalseColor = colormap !== "none" && !showDiff && !(isBaseline && isDiffActive) && artifactHash != null;

  // False color rendering
  useEffect(() => {
    if (!useFalseColor || !artifactHash) { setFalseColorReady(false); return; }
    let cancelled = false;
    setFalseColorReady(false);

    const cacheKey = `${artifactHash}::${colormap}`;
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
      const mapped = applyColormap(src, colormap as Exclude<Colormap, "none">);
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
    img.src = api.artifactUrl(artifactHash);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useFalseColor, artifactHash, colormap]);


  // Helper: update dims only if changed (avoids layout thrash)
  const updateDims = useCallback((w: number, h: number) => {
    setNaturalDims((prev) => (prev && prev.w === w && prev.h === h) ? prev : { w, h });
    onNaturalSize?.(w, h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showDiff) {
      setDiffReady(false);
      return;
    }
    let cancelled = false;
    // Don't reset diffReady — keep showing the old frame while computing new one.
    // Only reset when diff mode itself changes (not just the step).

    const renderMode = getRenderMode();
    const useGPU = renderMode === "gpu" || renderMode === "auto";

    // CPU cache: check first (instant)
    const cacheKey = `${baselineHash}::${artifactHash}::${diffMode}::${colormap}`;
    if (renderMode !== "gpu") {
      const cached = getCachedImageData(cacheKey);
      if (cached) {
        const canvas = canvasRef.current;
        if (canvas) {
          if (canvas.width !== cached.width || canvas.height !== cached.height) {
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
        loadImageData(api.artifactUrl(baselineHash!)),
        loadImageData(api.artifactUrl(artifactHash!)),
      ]);
      if (cancelled) return;
      if (!baseData || !otherData) return;

      const isSigned = (diffMode as string).includes("signed");
      const cmapMode: "linear" | "signed" | "positive" = isSigned ? "signed" : "positive";
      const gpuLut = colormap !== "none" ? getColormapLUT(colormap as Exclude<Colormap, "none">) : null;
      const gpuOpts = { diffMode: diffMode as DiffMode, colormap: gpuLut, cmapMode };

      // GPU path: WebGL 2 direct render (synchronous after image load)
      if (useGPU) {
        try {
          const canvas = canvasRef.current;
          if (canvas) {
            const dims = webglRenderDiffToCanvas(baseData, otherData, gpuOpts, canvas);
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

      // CPU fallback
      if (renderMode === "gpu") {
        console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");
        return;
      }
      let diffData = computeDiff(baseData, otherData, diffMode as DiffMode);
      if (colormap !== "none") {
        diffData = applyColormap(diffData, colormap as Exclude<Colormap, "none">, cmapMode);
      }
      setCachedImageData(cacheKey, diffData);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      if (canvas.width !== diffData.width || canvas.height !== diffData.height) {
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
  }, [baselineHash, artifactHash, diffMode, showDiff, colormap, onNaturalSize]);

  return (
    <div className="relative flex flex-col h-full">
      {/* Image / diff canvas */}
      <div className="flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard" data-cairn-zoom-pane style={{ padding: showAxes && naturalDims ? "16px 4px 4px 28px" : "4px" }}>
        <div ref={imgWrapperRef} data-cairn-img-wrapper className="relative w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
          {!artifactHash ? (
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
                style={{ display: diffReady ? "block" : "none", imageRendering: interpolation === "auto" ? undefined : interpolation }}
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
                style={{ display: falseColorReady ? "block" : "none", imageRendering: interpolation === "auto" ? undefined : interpolation }}
              />
            </>
          ) : (
            <img
              src={api.artifactUrl(artifactHash)}
              alt={label}
              className="w-full h-full object-contain block"
              draggable={false}
              style={{ filter: filterStr, imageRendering: interpolation === "auto" ? undefined : interpolation }}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
                onNaturalSize?.(img.naturalWidth, img.naturalHeight);
              }}
            />
          )}
          {showAxes && naturalDims && (
            <PixelAxes naturalWidth={naturalDims.w} naturalHeight={naturalDims.h} zoom={zoomLevel} containerRef={imgWrapperRef} />
          )}
        </div>
      </div>
      {/* Label overlay */}
      <span className="absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm">
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageGalleryCard
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ExternalBaselinePicker — dropdown to select a reference image from another tag
// ---------------------------------------------------------------------------

function ExternalBaselinePicker({
  runId,
  currentMetricName,
  selected,
  onSelect,
  availableRunIds,
}: {
  runId: string;
  currentMetricName: string;
  selected?: string;
  onSelect: (name: string, contextHash: string, selectedRunId: string) => void;
  /** All distinct run IDs from the card's effective metrics. */
  availableRunIds: string[];
}) {
  const multiRun = availableRunIds.length > 1;
  const [pickedRunId, setPickedRunId] = useState<string>(runId);
  const activeRunId = multiRun ? pickedRunId : runId;

  const { data } = useSequences(activeRunId);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const imageMetrics = useMemo(() => {
    const seqs = data?.sequences ?? [];
    return seqs
      .filter((s) => s.object_type === "image" && s.name !== currentMetricName)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, currentMetricName]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? imageMetrics.filter((m) => m.name.toLowerCase().includes(q)) : imageMetrics;
  }, [imageMetrics, filter]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (dropRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const runLabel = (id: string) => shortRunLabel(id, availableRunIds);

  return (
    <div className="relative mt-1">
      {multiRun && (
        <div className="mb-1">
          <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-0.5">Run</label>
          <select
            value={pickedRunId}
            onChange={(e) => setPickedRunId(e.target.value)}
            className="input w-full text-xs"
          >
            {availableRunIds.map((rid) => (
              <option key={rid} value={rid}>{runLabel(rid)}</option>
            ))}
          </select>
        </div>
      )}
      <button
        ref={btnRef}
        type="button"
        onClick={() => { setOpen((v) => !v); setFilter(""); }}
        className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg"
      >
        <span aria-hidden="true">+</span> Reference tag
      </button>
      {open && (
        <div ref={dropRef} className="absolute left-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-lg">
          <div className="border-b border-border-subtle p-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter image tags..."
              className="input w-full text-xs"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-fg-subtle">No other image tags</div>
            ) : (
              filtered.map((m) => (
                <button
                  key={`${m.name}::${m.context_hash}`}
                  type="button"
                  onClick={() => { onSelect(m.name, m.context_hash, activeRunId); setOpen(false); }}
                  className={`mono block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-bg-hover ${
                    selected === m.name ? "text-accent" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {m.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ImageGalleryCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove }: Props) {
  useRunMetadataVersion();

  const extraSeriesKey = useMemo(
    () => (extraSeries ?? []).map((s) => `${s.runId}::${s.name}::${s.context_hash}`).sort().join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify((extraSeries ?? []).map((s) => [s.runId, s.name, s.context_hash]).sort())],
  );

  const defaults = useMemo(
    () => {
      const base = defaultImageSettings({
        name: metric.name,
        context_hash: metric.context_hash,
      });
      const all: Array<{ runId?: string; name: string; context_hash: string }> = [
        { name: metric.name, context_hash: metric.context_hash },
        ...(extraSeries ?? []).map((s) => ({
          runId: s.runId,
          name: s.name,
          context_hash: s.context_hash,
        })),
      ];
      const seen = new Set<string>();
      const unique = all.filter((m) => {
        const k = seriesKey(m);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return { ...base, metrics: unique };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metric.name, metric.context_hash, extraSeriesKey],
  );

  const settingsKey = useMemo(
    () => settingsKeyOverride ?? {
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    },
    [settingsKeyOverride, runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings, resetSettings] = useCardSettings(
    settingsKey,
    defaults,
  );

  const effectiveMetrics = useMemo(() => {
    if (!controlledSeries) return settings.metrics;
    const all: Array<{ runId?: string; name: string; context_hash: string }> = [
      { name: metric.name, context_hash: metric.context_hash },
      ...(extraSeries ?? []).map((s) => ({
        runId: s.runId,
        name: s.name,
        context_hash: s.context_hash,
      })),
    ];
    const seen = new Set<string>();
    return all.filter((m) => {
      const k = seriesKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSeries, settings.metrics, metric.name, metric.context_hash, extraSeriesKey]);

  // -----------------------------------------------------------------------
  // Multi-series fetch
  // -----------------------------------------------------------------------
  const queries = useQueries({
    queries: effectiveMetrics.map((m) => ({
      queryKey: qk.sequence(m.runId ?? runId, m.name, m.context_hash),
      queryFn: () =>
        api.sequence(m.runId ?? runId, m.name, {
          context: m.context_hash || undefined,
          maxPoints: 500,
        }),
      refetchInterval: 2000,
    })),
  });

  // Per-series points that have artifacts + step→point maps.
  const { perSeriesPoints, perSeriesStepMap, globalSteps, globalStepPoints } = useMemo(() => {
    const psp = queries.map((q) =>
      (q.data?.points ?? []).filter((p: SequencePoint) => p.artifact_hash),
    );
    const maps = psp.map((pts) => {
      const m = new Map<number, SequencePoint>();
      for (const p of pts) m.set(p.step, p);
      return m;
    });
    // Union of all step numbers across all series, sorted.
    // Also collect wall_time from the first series that has it at each step.
    const stepMap = new Map<number, string | undefined>();
    for (const pts of psp) for (const p of pts) {
      if (!stepMap.has(p.step)) stepMap.set(p.step, p.wall_time ?? undefined);
    }
    const steps = Array.from(stepMap.keys()).sort((a, b) => a - b);
    const stepPts = steps.map((s) => ({ step: s, wall_time: stepMap.get(s) ?? null }));
    return { perSeriesPoints: psp, perSeriesStepMap: maps, globalSteps: steps, globalStepPoints: stepPts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((q) => q.dataUpdatedAt).join("|")]);

  // Shared step slider — indexes into globalSteps
  const [idx, setIdx] = useState(settings.sliderStep ?? 0);
  const handleSliderChange = (newIdx: number) => {
    setIdx(newIdx);
    updateSettings({ sliderStep: newIdx });
  };
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, globalSteps.length - 1));
  const currentStep = globalSteps[safeIdx] ?? 0;

  const isMulti = effectiveMetrics.length > 1 || settings.externalBaseline != null;

  const multipleRuns = useMemo(() => {
    const seen = new Set<string>();
    for (const m of effectiveMetrics) seen.add(m.runId ?? runId);
    return seen.size > 1;
  }, [effectiveMetrics, runId]);

  const availableRunIds = useMemo(() => {
    const seen = new Set<string>();
    for (const m of effectiveMetrics) seen.add(m.runId ?? runId);
    return Array.from(seen);
  }, [effectiveMetrics, runId]);

  // -----------------------------------------------------------------------
  // Settings refs for non-passive handlers
  // -----------------------------------------------------------------------
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const metricsRef = useRef(effectiveMetrics);
  metricsRef.current = effectiveMetrics;

  const { highlight: dropHighlight, dropProps } = useSeriesDrop({
    metricsRef,
    onMetricsChange: useCallback(
      (next) => updateSettings({ metrics: next }),
      [updateSettings],
    ),
  });

  const [expanded, setExpanded] = useState(false);

  const compSeries = useMemo(
    () => effectiveMetrics.map((m) => ({
      runId: m.runId ?? runId,
      name: m.name,
      context_hash: m.context_hash,
    })),
    [runId, effectiveMetrics],
  );


  // -----------------------------------------------------------------------
  // SVG gamma filter
  // -----------------------------------------------------------------------
  const rawId = useId();
  const gammaFilterId = `cairn-gamma-${rawId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const filterStr = [
    `url(#${gammaFilterId})`,
    `brightness(${1 + settings.brightness})`,
    `contrast(${1 + settings.contrast})`,
  ].join(" ");

  const transformStr = `translate(${settings.pan.x}px, ${settings.pan.y}px) scale(${settings.zoom})`;

  // -----------------------------------------------------------------------
  // Single-image zoom/pan (disabled in multi-pane)
  // -----------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);

  // Modifier key tracking — zoom/pan while Alt, Ctrl, or Meta is held.
  const [altDown, setAltDown] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt" || e.key === "Control" || e.key === "Meta") setAltDown(e.type === "keydown");
    };
    const onBlur = () => setAltDown(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  const altDownRef = useRef(altDown);
  altDownRef.current = altDown;

  // Stable wheel handler.
  //
  // Zoom math: with transformOrigin "0 0", screen position of element
  // point p = p * zoom + pan. To keep the point under the cursor fixed
  // after a zoom change: newPan = cx - ((cx - pan) / zoom) * newZoom.
  //
  // cx/cy MUST be relative to the pane that holds the transform, not the
  // outer grid container. We find the pane by looking for the nearest
  // ancestor with [data-cairn-zoom-pane] — this is the direct parent of
  // the transform div and represents the viewport for that image.
  wheelHandlerRef.current = (e: WheelEvent) => {
    if (!altDownRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const s = settingsRef.current;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoom * factor));
    if (s.zoom === nextZoom) return;

    // Find the zoom pane the cursor is over.
    const target = e.target as HTMLElement;
    const paneEl = target.closest("[data-cairn-zoom-pane]") as HTMLElement | null;
    const refEl = paneEl ?? containerRef.current;
    if (refEl) {
      const rect = refEl.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const newPanX = cx - ((cx - s.pan.x) / s.zoom) * nextZoom;
      const newPanY = cy - ((cy - s.pan.y) / s.zoom) * nextZoom;
      updateSettings({ zoom: nextZoom, pan: { x: newPanX, y: newPanY } });
    } else {
      updateSettings({ zoom: nextZoom });
    }
  };

  const roRef = useRef<ResizeObserver | null>(null);

  // Track the previous size so we can keep the visible center stable on resize.
  const lastSizeRef = useRef<{ w: number; h: number } | null>(null);

  // Callback ref: attach wheel listener + ResizeObserver when element mounts
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (containerRef.current) {
      containerRef.current.removeEventListener("wheel", (containerRef.current as any).__cairnWheel);
      roRef.current?.disconnect();
    }
    containerRef.current = el;
    lastSizeRef.current = null;
    if (el) {
      const handler = (e: WheelEvent) => wheelHandlerRef.current?.(e);
      (el as any).__cairnWheel = handler;
      el.addEventListener("wheel", handler, { passive: false });
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const newW = entry.contentRect.width;
          const newH = entry.contentRect.height;
          setContainerWidth(newW);

          // Re-center pan so the visible midpoint stays put on resize/colSpan change.
          const prev = lastSizeRef.current;
          const s = settingsRef.current;
          const isZoomed = s.zoom !== 1 || s.pan.x !== 0 || s.pan.y !== 0;
          if (prev && isZoomed && (prev.w !== newW || prev.h !== newH)) {
            // element-space coord of the OLD viewport center:
            //   cxElem = (oldCenter - oldPan) / zoom
            const cxElem = (prev.w / 2 - s.pan.x) / s.zoom;
            const cyElem = (prev.h / 2 - s.pan.y) / s.zoom;
            // pan to put that same element point at the NEW center
            const newPanX = newW / 2 - cxElem * s.zoom;
            const newPanY = newH / 2 - cyElem * s.zoom;
            updateSettings({ pan: { x: newPanX, y: newPanY } });
          }
          lastSizeRef.current = { w: newW, h: newH };
        }
      });
      ro.observe(el);
      roRef.current = ro;
      const rect = el.getBoundingClientRect();
      setContainerWidth(rect.width);
      lastSizeRef.current = { w: rect.width, h: rect.height };
    }
  }, [updateSettings]);

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!altDownRef.current) return;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        panX: settingsRef.current.pan.x,
        panY: settingsRef.current.pan.y,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      updateSettings({ pan: { x: s.panX + dx, y: s.panY + dy } });
    },
    [updateSettings],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragStateRef.current = null;
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Drop target
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------
  const canPan = altDown;


  // Drop handler: accept a dragged chip as external baseline reference
  const [refDropHighlight, setRefDropHighlight] = useState(false);
  const onRefDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(CAIRN_SERIES_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "link";
      setRefDropHighlight(true);
    }
  }, []);
  const onRefDragLeave = useCallback(() => setRefDropHighlight(false), []);
  const onRefDrop = useCallback((e: React.DragEvent) => {
    setRefDropHighlight(false);
    const raw = e.dataTransfer.getData(CAIRN_SERIES_MIME);
    if (!raw) return;
    e.stopPropagation();
    try {
      const ref = JSON.parse(raw) as { runId: string; name: string; context_hash: string };
      // First drag → default to per-run reference mode (each run uses its
      // own copy of the dragged tag). Don't override an explicit user choice.
      const firstTime = settings.externalBaseline == null && settings.referenceMode == null;
      updateSettings({
        externalBaseline: { runId: ref.runId, name: ref.name, context_hash: ref.context_hash },
        baselineIndex: undefined,
        ...(firstTime ? { referenceMode: "per-run" as const } : {}),
      });
    } catch { /* ignore */ }
  }, [updateSettings, settings.externalBaseline, settings.referenceMode]);
  const [singleNaturalDims, setSingleNaturalDims] = useState<{ w: number; h: number } | null>(null);
  // Single-image: resolve for the first series at current global step
  const firstResolved = useMemo(() => {
    const stepMap = perSeriesStepMap[0] ?? new Map();
    const steps = perSeriesPoints[0]?.map((p) => p.step) ?? [];
    return resolveArtifact(stepMap, currentStep, steps, settings.missingImageMode);
  }, [perSeriesStepMap, perSeriesPoints, currentStep, settings.missingImageMode]);

  const singleFCRef = useRef<HTMLCanvasElement | null>(null);
  const [singleFCReady, setSingleFCReady] = useState(false);
  const singleArtifactHash = useMemo(() => {
    return firstResolved.hash ?? null;
  }, [firstResolved]);
  const singleUseFalseColor = (settings.colormap ?? "none") !== "none" && !isMulti && singleArtifactHash != null;

  useEffect(() => {
    if (!singleUseFalseColor || !singleArtifactHash) { setSingleFCReady(false); return; }
    let cancelled = false;
    setSingleFCReady(false);

    const cacheKey = `${singleArtifactHash}::${settings.colormap}`;
    const cached = getCachedImageData(cacheKey);
    if (cached) {
      const fc = singleFCRef.current;
      if (fc) {
        fc.width = cached.width;
        fc.height = cached.height;
        const fctx = fc.getContext("2d");
        if (fctx) fctx.putImageData(cached, 0, 0);
        setSingleNaturalDims({ w: cached.width, h: cached.height });
        setSingleFCReady(true);
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
      const mapped = applyColormap(src, (settings.colormap ?? "viridis") as Exclude<Colormap, "none">);
      setCachedImageData(cacheKey, mapped);
      const fc = singleFCRef.current;
      if (!fc || cancelled) return;
      fc.width = mapped.width;
      fc.height = mapped.height;
      const fctx = fc.getContext("2d");
      if (fctx) fctx.putImageData(mapped, 0, 0);
      setSingleNaturalDims({ w: mapped.width, h: mapped.height });
      setSingleFCReady(true);
    };
    img.src = api.artifactUrl(singleArtifactHash);
    return () => { cancelled = true; };
  }, [singleUseFalseColor, singleArtifactHash, settings.colormap]);

  // Track image natural aspect ratio (h/w) from first loaded image
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const onImageNaturalSize = useCallback((w: number, h: number) => {
    setImageAspect((prev) => prev ?? h / w);
  }, []);

  // Track container width for auto-height calculation
  const [containerWidth, setContainerWidth] = useState(0);

  // Compute viewport height from container width + image aspect ratio
  // so the viewport matches the image proportions
  const autoHeight = useMemo((): string | undefined => {
    if (resolveCardHeight(settings, undefined) != null) return undefined; // user-set height
    if (!imageAspect || containerWidth <= 0) return "20rem"; // before image loads
    const n = effectiveMetrics.length;
    // How many columns will SplitPane use? It wraps at minPaneWidth=200
    const cols = Math.min(n, Math.max(1, Math.floor(containerWidth / 200)));
    const rows = Math.ceil(n / cols);
    const paneWidth = containerWidth / cols;
    // Height per row = pane width * image aspect + pane header (24px)
    const rowHeight = paneWidth * imageAspect + 24;
    // Clamp: at least 120px, at most 500px per row
    const clampedRow = Math.max(120, Math.min(500, rowHeight));
    return `${Math.round(rows * clampedRow)}px`;
  }, [settings.height, settings.height1, settings.height2, settings.colSpan, imageAspect, containerWidth, effectiveMetrics.length]);

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : `${metric.count} pts`;

  const anyLoading = queries.some((q) => q.isLoading);

  // External baseline: fetch image from a different metric tag
  const extBase = settings.externalBaseline;
  const extBaseRid = extBase?.runId ?? runId;
  const extBaseName = extBase?.name ?? "";
  const extBaseCtx = extBase?.context_hash ?? "";
  const refMode = settings.referenceMode ?? "global";

  // Global mode: one shared reference series fetched from extBase.runId.
  const extBaseQuery = useSequence(extBaseRid, extBaseName, {
    context: extBaseCtx || undefined,
    maxPoints: 500,
  });
  const extBasePoints = useMemo(() => {
    if (!extBase || !extBaseQuery.data) return [];
    return (extBaseQuery.data.points ?? []).filter((p: SequencePoint) => p.artifact_hash);
  }, [extBase, extBaseQuery.data]);

  // Per-run mode: fetch the reference series (extBase.name) from EACH run
  // in the comparison. Each pane gets its own run's copy of the ref tag.
  const perRunRefQueries = useQueries({
    queries: extBase && refMode === "per-run"
      ? effectiveMetrics.map((m) => ({
          queryKey: qk.refSeries(m.runId ?? runId, extBase.name, extBase.context_hash),
          queryFn: () => api.sequence(m.runId ?? runId, extBase.name, {
            context: extBase.context_hash || undefined,
            maxPoints: 500,
          }),
          refetchInterval: 2000,
        }))
      : [],
  });

  // Baseline hash for diff — external baseline takes priority (global mode).
  const baselineIdx = settings.baselineIndex;
  const baselineHash = extBase && refMode === "global"
    ? extBasePoints[Math.min(safeIdx, Math.max(0, extBasePoints.length - 1))]?.artifact_hash ?? undefined
    : baselineIdx != null
      ? resolveArtifact(
          perSeriesStepMap[baselineIdx] ?? new Map(),
          currentStep,
          perSeriesPoints[baselineIdx]?.map((p) => p.step) ?? [],
          settings.missingImageMode,
        ).hash
      : undefined;

  // Per-run baseline: each pane uses its own run's copy of the reference
  // tag at the current step.
  const perPaneBaselineHash = useMemo(() => {
    if (refMode !== "per-run" || !extBase) return null;
    return effectiveMetrics.map((_, paneIdx) => {
      const points: SequencePoint[] = (perRunRefQueries[paneIdx]?.data?.points ?? [])
        .filter((p: SequencePoint) => p.artifact_hash);
      if (points.length === 0) return undefined;
      const stepMap = new Map<number, SequencePoint>();
      for (const p of points) stepMap.set(p.step, p);
      const seriesSteps = points.map((p) => p.step);
      return resolveArtifact(stepMap, currentStep, seriesSteps, settings.missingImageMode).hash;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refMode, extBase, effectiveMetrics, perRunRefQueries.map((q) => q.dataUpdatedAt).join("|"), currentStep, settings.missingImageMode]);

  // Whether any baseline is active (for diff dropdown visibility).
  const hasBaseline = baselineIdx != null || extBase != null;

  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={cardRef}
      className={`card p-4 flex flex-col${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        position: "relative",
        height: settings.collapsed ? undefined : resolveCardHeight(settings, undefined),
        gridColumn: `span ${settings.colSpan ?? 3}`,
      }}
      {...dropProps}
    >
      {/* SVG gamma filter */}
      <svg
        aria-hidden="true"
        style={{ position: "absolute", width: 0, height: 0 }}
      >
        <filter id={gammaFilterId} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR
              type="gamma"
              amplitude={1}
              exponent={1 / settings.gamma}
              offset={0}
            />
            <feFuncG
              type="gamma"
              amplitude={1}
              exponent={1 / settings.gamma}
              offset={0}
            />
            <feFuncB
              type="gamma"
              amplitude={1}
              exponent={1 / settings.gamma}
              offset={0}
            />
          </feComponentTransfer>
        </filter>
      </svg>

      <CardHeader
        title={settings.title ?? metric.name}
        subtitle={subtitle}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onSettings={() => setExpanded(true)}
        onRemove={onRemove}
        onDownload={firstResolved.hash ? () => downloadArtifact(api.artifactUrl(firstResolved.hash!), artifactFilename(metric.name, currentStep, "image/png")) : undefined}
        onScreenshot={isMulti
          ? () => { if (containerRef.current) exportImagesAsComposite(containerRef.current, safeName(metric.name) + `_step${currentStep}`, settings.imageColumns ?? 2); }
          : firstResolved.hash ? () => { if (containerRef.current) exportImagesAsComposite(containerRef.current, safeName(metric.name) + `_step${currentStep}`, 1); } : undefined}
        addToComparisonSlot={<AddToComparisonButton cardType="image" series={compSeries} />}
      >
        {(settings.zoom !== 1 || settings.pan.x !== 0 || settings.pan.y !== 0) && (
          <button
            type="button"
            onClick={() => updateSettings({ zoom: 1, pan: { x: 0, y: 0 } })}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Reset zoom and pan"
            title="Reset zoom and pan"
          >
            {"\u2302"}
          </button>
        )}
        {/* Diff mode dropdown — only when a baseline is set */}
        {hasBaseline && (
          <select
            value={settings.diffMode}
            onChange={(e) => updateSettings({ diffMode: e.target.value as ImageSettings["diffMode"] })}
            className={`h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer ${settings.diffMode !== "none" ? "text-accent" : "text-fg-muted hover:text-fg"}`}
            title="Diff mode"
          >
            <option value="none">diff: off</option>
            <option value="absolute">absolute</option>
            <option value="signed">signed</option>
            <option value="squared">squared</option>
            <option value="relative_absolute">rel. absolute</option>
            <option value="relative_signed">rel. signed</option>
            <option value="relative_squared">rel. squared</option>
          </select>
        )}
        {/* Colormap dropdown */}
        <select
          value={settings.colormap ?? "none"}
          onChange={(e) => updateSettings({ colormap: e.target.value as Colormap })}
          className={`h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer ${(settings.colormap ?? "none") !== "none" ? "text-accent" : "text-fg-muted hover:text-fg"}`}
          title="False color map"
        >
          <option value="none">color: off</option>
          <option value="viridis">viridis</option>
          <option value="red-green">red-green</option>
          <option value="red-blue">red-blue</option>
        </select>
      </CardHeader>

      {!settings.collapsed && (<>
      {anyLoading && globalSteps.length === 0 ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : globalSteps.length > 0 ? (
        <>
          <div
            ref={setContainerRef}
            className={`relative min-h-0 flex flex-col overflow-hidden${resolveCardHeight(settings, undefined) != null ? " flex-1" : ""}${refDropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
            style={{
              height: resolveCardHeight(settings, undefined) == null ? autoHeight : undefined,
              cursor: canPan ? "move" : "default",
              touchAction: canPan ? "none" : undefined,
            }}
            onDragOver={onRefDragOver}
            onDragLeave={onRefDragLeave}
            onDrop={onRefDrop}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
          <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {isMulti ? (
            /* ---------- Multi-pane grid layout ---------- */
            <div
              className="grid gap-1 flex-1 min-h-0 overflow-auto"
              style={{
                gridTemplateColumns: `repeat(${settings.imageColumns ?? 2}, 1fr)`,
                /* rows auto-size to content */
              }}
            >
              {effectiveMetrics.map((m, paneIdx) => {
                // Skip metrics that match the external baseline — shown as separate ref pane (global mode only)
                if (refMode === "global" && settings.externalBaseline && m.name === settings.externalBaseline.name && (m.runId ?? runId) === (settings.externalBaseline.runId ?? runId)) return null;
                const stepMap = perSeriesStepMap[paneIdx] ?? new Map();
                const seriesSteps = perSeriesPoints[paneIdx]?.map((p) => p.step) ?? [];
                const { hash, fallbackStep } = resolveArtifact(stepMap, currentStep, seriesSteps, settings.missingImageMode);
                const label = seriesLabel(m, runId, multipleRuns, availableRunIds)
                  + (fallbackStep != null ? ` (step ${fallbackStep})` : "");
                // Per-pane baseline: per-run mode uses each pane's own ref step
                const paneBaseline = refMode === "per-run"
                  ? perPaneBaselineHash?.[paneIdx]
                  : baselineHash;
                const compareMode = settings.compareMode ?? "side-by-side";
                const splitPos = settings.splitPosition ?? 0.5;
                const blendAlpha = settings.blendAlpha ?? 0.5;
                // Show ref+pred inline when:
                //   - per-run mode (each pane shows its own ref + pred), OR
                //   - split/blend overlay (the ref overlays the pred), OR
                //   - diff mode is active.
                // Global + side-by-side renders the ref as a separate pane
                // outside this loop (at the bottom), so we skip inline there.
                const showInlineRef = paneBaseline && hash && paneBaseline !== hash &&
                  (refMode === "per-run" || settings.diffMode !== "none" || compareMode !== "side-by-side");
                return (
                  <div key={seriesKey(m)} className="relative overflow-hidden" style={undefined}>
                    {showInlineRef ? (
                      /* ---------- Inline ref+pred ---------- */
                      /* When diff is active, always show ref + ImagePane (which computes diff) */
                      settings.diffMode !== "none" ? (
                        <div className="flex gap-0.5 h-full cairn-checkerboard">
                          <div className="relative flex-1 min-w-0 overflow-hidden border border-accent/20 rounded" data-cairn-zoom-pane>
                            <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
                              <img
                                src={api.artifactUrl(paneBaseline)}
                                alt="ref"
                                className="w-full h-full object-contain"
                                draggable={false}
                                style={{
                                  filter: filterStr,
                                  imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation,
                                }}
                              />
                            </div>
                            <span className="absolute top-0.5 left-0.5 z-10 rounded bg-accent/20 px-1 py-0.5 text-[9px] text-accent backdrop-blur-sm">
                              REF
                            </span>
                          </div>
                          <div className="relative flex-1 min-w-0 overflow-hidden" data-cairn-zoom-pane>
                            <ImagePane
                              metricEntry={m}
                              paneIndex={paneIdx}
                              artifactHash={hash}
                              baselineHash={paneBaseline}
                              isBaseline={false}
                              diffMode={settings.diffMode}
                              interpolation={settings.interpolation ?? "auto"}
                              colormap={settings.colormap ?? "none"}
                              showAxes={settings.showAxes ?? false}
                              zoom={settings.zoom}
                              transformStr={transformStr}
                              filterStr={filterStr}
                              onNaturalSize={onImageNaturalSize}
                              label={label}
                            />
                          </div>
                        </div>
                      ) : compareMode === "side-by-side" ? (
                        /* No diff, side-by-side: ref and pred shown as a grouped pair */
                        <div className="flex gap-0.5 h-full cairn-checkerboard">
                          <div className="relative flex-1 min-w-0 overflow-hidden border border-accent/20 rounded" data-cairn-zoom-pane>
                            <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
                              <img
                                src={api.artifactUrl(paneBaseline)}
                                alt="ref"
                                className="w-full h-full object-contain"
                                draggable={false}
                                style={{
                                  filter: filterStr,
                                  imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation,
                                }}
                              />
                            </div>
                            <span className="absolute top-0.5 left-0.5 z-10 rounded bg-accent/20 px-1 py-0.5 text-[9px] text-accent backdrop-blur-sm">
                              REF
                            </span>
                          </div>
                          <div className="relative flex-1 min-w-0 overflow-hidden" data-cairn-zoom-pane>
                            <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
                              <img
                                src={api.artifactUrl(hash)}
                                alt="pred"
                                className="w-full h-full object-contain"
                                draggable={false}
                                style={{
                                  filter: filterStr,
                                  imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation,
                                }}
                              />
                            </div>
                            <span className="absolute bottom-0.5 left-0.5 z-10 rounded bg-bg/80 px-1 py-0.5 text-[9px] text-fg-muted backdrop-blur-sm">
                              {label}
                            </span>
                          </div>
                        </div>
                      ) : (
                        /* Split / blend overlay */
                        <div className="relative w-full overflow-hidden cairn-checkerboard" data-cairn-zoom-pane style={{ aspectRatio: "1 / 1", minHeight: 80 }}>
                          {/* Prediction layer — full viewport */}
                          <div className="absolute inset-0 overflow-hidden" data-cairn-img-wrapper>
                            <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
                              <img
                                src={api.artifactUrl(hash)}
                                alt="pred"
                                className="w-full h-full object-contain"
                                draggable={false}
                                style={{
                                  filter: filterStr,
                                  imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation,
                                  ...(compareMode === "blend" ? { opacity: blendAlpha } : {}),
                                }}
                              />
                            </div>
                          </div>
                          {/* Reference layer — clipped at screen level (outside transform) */}
                          <div
                            className="absolute inset-0 overflow-hidden"
                            style={compareMode === "split"
                              ? { clipPath: `inset(0 ${(1 - splitPos) * 100}% 0 0)` }
                              : undefined}
                          >
                            <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
                              <img
                                src={api.artifactUrl(paneBaseline!)}
                                alt="ref"
                                className="w-full h-full object-contain"
                                draggable={false}
                                style={{
                                  filter: filterStr,
                                  imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation,
                                  ...(compareMode === "blend" ? { opacity: 1 - blendAlpha } : {}),
                                }}
                              />
                            </div>
                          </div>
                          {/* Draggable split handle */}
                          {compareMode === "split" && (
                            <div
                              className="absolute top-0 bottom-0 z-20 flex items-center"
                              style={{ left: `${splitPos * 100}%`, transform: "translateX(-50%)", cursor: "col-resize" }}
                              onPointerDown={(ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                const container = ev.currentTarget.parentElement!;
                                const rect = container.getBoundingClientRect();
                                const onMove = (me: PointerEvent) => {
                                  const pos = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
                                  updateSettings({ splitPosition: pos });
                                };
                                const onUp = () => {
                                  window.removeEventListener("pointermove", onMove);
                                  window.removeEventListener("pointerup", onUp);
                                };
                                window.addEventListener("pointermove", onMove);
                                window.addEventListener("pointerup", onUp);
                              }}
                            >
                              <div className="w-1 h-full bg-accent/80 rounded-full" />
                            </div>
                          )}
                          <span className="absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm">
                            {label}
                          </span>
                          <span className="absolute top-1 right-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm">
                            REF
                          </span>
                        </div>
                      )
                    ) : (
                      /* ---------- Normal ImagePane (no inline ref) ---------- */
                      <ImagePane
                        metricEntry={m}
                        paneIndex={paneIdx}
                        artifactHash={hash}
                        baselineHash={paneBaseline}
                        isBaseline={refMode === "global" && baselineIdx === paneIdx}
                        diffMode={settings.diffMode}
                        interpolation={settings.interpolation ?? "auto"}
                        colormap={settings.colormap ?? "none"}
                        showAxes={settings.showAxes ?? false}
                        zoom={settings.zoom}
                        transformStr={transformStr}
                        filterStr={filterStr}
                        onNaturalSize={onImageNaturalSize}
                        label={label}
                      />
                    )}
                  </div>
                );
              })}
              {/* External baseline reference pane — hidden in split/blend/per-run modes (ref shown inline) */}
              {(settings.compareMode ?? "side-by-side") === "side-by-side" && refMode === "global" && settings.externalBaseline && extBasePoints.length > 0 && (() => {
                const refPt = extBasePoints[Math.min(safeIdx, extBasePoints.length - 1)];
                const refHash = refPt?.artifact_hash ?? undefined;
                return (
                  <div className="relative overflow-hidden" style={undefined}>
                    <ImagePane
                      metricEntry={{ runId: settings.externalBaseline!.runId, name: settings.externalBaseline!.name, context_hash: settings.externalBaseline!.context_hash }}
                      paneIndex={-1}
                      artifactHash={refHash}
                      baselineHash={undefined}
                      isBaseline={true}
                      diffMode="none"
                      interpolation={settings.interpolation ?? "auto"}
                      colormap={"none"}
                      showAxes={settings.showAxes ?? false}
                      zoom={settings.zoom}
                      transformStr={transformStr}
                      filterStr={filterStr}
                      label={`ref: ${settings.externalBaseline!.name}`}
                    />
                  </div>
                );
              })()}
            </div>
          ) : (
            /* ---------- Single-image layout (original) ---------- */
            <div
              className="relative flex flex-1 min-h-0 justify-center items-center rounded cairn-checkerboard" data-cairn-zoom-pane
              style={{
                overflow: "hidden",
                padding: settings.showAxes && singleNaturalDims ? "16px 4px 4px 28px" : "8px",
              }}
            >
              <div
                data-cairn-img-wrapper className="relative w-full h-full"
                style={{ transform: transformStr, transformOrigin: "0 0" }}
              >
              {firstResolved.hash ? (
                singleUseFalseColor ? (
                  <>
                    {!singleFCReady && <span className="text-xs text-fg-muted motion-safe:animate-pulse">applying colormap...</span>}
                    <canvas
                      ref={singleFCRef}
                      className="w-full h-full object-contain block"
                      style={{
                        display: singleFCReady ? "block" : "none",
                        imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation,
                      }}
                    />
                  </>
                ) : (
                  <img
                    src={api.artifactUrl(firstResolved.hash!)}
                    alt={`${metric.name} @ step ${currentStep}`}
                    className="w-full h-full object-contain block"
                    draggable={false}
                    style={{
                      filter: filterStr,
                      imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation,
                    }}
                    onLoad={(e) => {
                      const imgEl = e.currentTarget;
                      setSingleNaturalDims({ w: imgEl.naturalWidth, h: imgEl.naturalHeight });
                      onImageNaturalSize(imgEl.naturalWidth, imgEl.naturalHeight);
                    }}
                  />
                )
              ) : (
                <span className="text-sm text-fg-muted">no image</span>
              )}
              {settings.showAxes && singleNaturalDims && (
                <PixelAxes naturalWidth={singleNaturalDims.w} naturalHeight={singleNaturalDims.h} zoom={settings.zoom} />
              )}
              </div>
            </div>
          )}
          </div>
          {/* Colorbar — flex sibling to image area */}
          {(settings.colormap ?? "none") !== "none" && (
            <Colorbar colormap={settings.colormap as Exclude<Colormap, "none">} isDiff={settings.diffMode !== "none" && (settings.baselineIndex != null || settings.externalBaseline != null)} />
          )}
          </div>
          </div>

          {/* Compare toolbar — reference mode, split/blend controls */}
          {isMulti && hasBaseline && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
              {/* Compare mode buttons */}
              {(["side-by-side", "split", "blend"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => updateSettings({ compareMode: mode })}
                  className={`rounded px-1.5 py-0.5 ${(settings.compareMode ?? "side-by-side") === mode ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-bg-hover hover:text-fg"}`}
                >
                  {mode === "side-by-side" ? "side" : mode}
                </button>
              ))}
              {/* Split position slider */}
              {(settings.compareMode ?? "side-by-side") === "split" && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.splitPosition ?? 0.5}
                  onChange={(e) => updateSettings({ splitPosition: Number(e.target.value) })}
                  className="w-24 accent-accent"
                  title="Split position"
                />
              )}
              {/* Blend alpha slider */}
              {(settings.compareMode ?? "side-by-side") === "blend" && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.blendAlpha ?? 0.5}
                  onChange={(e) => updateSettings({ blendAlpha: Number(e.target.value) })}
                  className="w-24 accent-accent"
                  title="Blend alpha"
                />
              )}
            </div>
          )}

          {/* Shared step slider */}
          <StepSlider
            points={globalStepPoints}
            currentIndex={safeIdx}
            onChange={handleSliderChange}
            xAxis={settings.xAxis}
            onXAxisChange={(m) => updateSettings({ xAxis: m })}
            className="mt-3"
          />
        </>
      ) : (
        <div className="text-sm text-fg-muted">no image logged yet</div>
      )}

      {/* Series chip strip */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {controlledSeries ? (
          /* Tag-level draggable chips in workspace/comparison mode */
          (() => {
            const seen = new Set<string>();
            const tags: Array<{ name: string; color: string; firstIdx: number }> = [];
            for (let i = 0; i < effectiveMetrics.length; i++) {
              const m = effectiveMetrics[i]!;
              if (seen.has(m.name)) continue;
              seen.add(m.name);
              tags.push({ name: m.name, color: SERIES_COLORS[tags.length % SERIES_COLORS.length]!, firstIdx: i });
            }
            return tags.map((tag) => {
              const m = effectiveMetrics[tag.firstIdx]!;
              const ref: SeriesRef = { runId: m.runId, name: m.name, context_hash: m.context_hash };
              return (
                <SeriesChip
                  key={tag.name}
                  series={ref}
                  color={tag.color}
                  label={tag.name}
                  runId={runId}
                  onRemove={
                    tags.length > 1
                      ? () => {
                          const next = effectiveMetrics.filter((x) => x.name !== tag.name);
                          updateSettings({ metrics: next, baselineIndex: undefined, paneWidths: undefined });
                        }
                      : undefined
                  }
                />
              );
            });
          })()
        ) : (
          effectiveMetrics.map((m, i) => {
            const ref: SeriesRef = {
              runId: m.runId,
              name: m.name,
              context_hash: m.context_hash,
            };
            return (
              <SeriesChip
                key={seriesKey(m)}
                series={ref}
                color={SERIES_COLORS[i % SERIES_COLORS.length]!}
                label={seriesLabel(m, runId, multipleRuns, availableRunIds)}
                runId={runId}
                onRemove={
                  effectiveMetrics.length > 1
                    ? () => {
                        const next = effectiveMetrics.filter(
                          (_, idx2) => idx2 !== i,
                        );
                        let newBaseline = settings.baselineIndex;
                        if (newBaseline != null) {
                          if (newBaseline === i) newBaseline = undefined;
                          else if (newBaseline > i) newBaseline -= 1;
                        }
                        updateSettings({
                          metrics: next,
                          baselineIndex: newBaseline,
                          paneWidths: undefined,
                        });
                      }
                    : undefined
                }
              />
            );
          })
        )}
      </div>

      </>)}

      {(() => {
        const settingsPanel = (
          <>
            <h4 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
              Image
            </h4>
            <Slider
              label="Brightness"
              value={settings.brightness}
              onChange={(v) => updateSettings({ brightness: v })}
              min={-1}
              max={1}
              step={0.01}
              format={(v) => v.toFixed(2)}
            />
            <Slider
              label="Contrast"
              value={settings.contrast}
              onChange={(v) => updateSettings({ contrast: v })}
              min={-1}
              max={1}
              step={0.01}
              format={(v) => v.toFixed(2)}
            />
            <Slider
              label="Gamma"
              value={settings.gamma}
              onChange={(v) => updateSettings({ gamma: v })}
              min={0.1}
              max={3}
              step={0.01}
              format={(v) => v.toFixed(2)}
              description="1 = no change; <1 brightens shadows, >1 darkens"
            />
            <Select<Interpolation>
              label="Interpolation"
              value={settings.interpolation ?? "auto"}
              onChange={(v) => updateSettings({ interpolation: v })}
              options={[
                { value: "auto", label: "Smooth (bilinear)" },
                { value: "pixelated", label: "Nearest (pixelated)" },
                { value: "crisp-edges", label: "Crisp edges" },
              ]}
            />
            <Select<Colormap>
              label="False color"
              value={settings.colormap ?? "none"}
              onChange={(v) => updateSettings({ colormap: v })}
              options={[
                { value: "none", label: "None (original)" },
                { value: "viridis", label: "Viridis" },
                { value: "red-green", label: "Red \u2013 Green (\u00B1)" },
                { value: "red-blue", label: "Red \u2013 Blue (\u00B1)" },
              ]}
            />
            <Select<"nothing" | "last_available">
              label="Missing image"
              value={settings.missingImageMode ?? "last_available"}
              onChange={(v) => updateSettings({ missingImageMode: v })}
              options={[
                { value: "nothing", label: "Show nothing" },
                { value: "last_available", label: "Show last available" },
              ]}
            />
            <Toggle
              label="Pixel axes"
              checked={settings.showAxes ?? false}
              onChange={(v) => updateSettings({ showAxes: v })}
              description="Show pixel coordinate ticks along edges"
            />
            <h4 className="text-xs uppercase tracking-wide text-fg-muted mt-3 mb-2">
              Diff
            </h4>
            <Select
              label="Diff mode"
              value={settings.diffMode}
              onChange={(v) => updateSettings({ diffMode: v })}
              options={[
                { value: "none" as const, label: "None" },
                { value: "signed" as const, label: "Signed Error" },
                { value: "absolute" as const, label: "Absolute Error" },
                { value: "squared" as const, label: "Squared Error" },
                { value: "relative_signed" as const, label: "Relative Signed" },
                { value: "relative_absolute" as const, label: "Relative Absolute" },
                { value: "relative_squared" as const, label: "Relative Squared" },
              ]}
            />
            {isMulti && extBase && (
              <Select<"global" | "per-run">
                label="Reference mode"
                value={settings.referenceMode ?? "global"}
                onChange={(v) => updateSettings({ referenceMode: v })}
                options={[
                  { value: "per-run", label: "Per-run (each run uses its own copy of the ref tag)" },
                  { value: "global", label: "Global (same ref for all runs)" },
                ]}
              />
            )}
            <div className="mt-2">
              <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">
                Reference source
              </label>
              {settings.externalBaseline ? (
                <div className="flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
                  <span className="mono truncate flex-1">{settings.externalBaseline.name}{settings.externalBaseline.runId && settings.externalBaseline.runId !== runId ? ` · ${shortRunLabel(settings.externalBaseline.runId)}` : ""}</span>
                  <button
                    type="button"
                    onClick={() => updateSettings({ externalBaseline: undefined, baselineIndex: undefined, diffMode: settings.diffMode === "none" ? "none" : settings.diffMode })}
                    className="text-fg-subtle hover:text-fg shrink-0"
                    title="Remove external reference"
                  >{"\u00D7"}</button>
                </div>
              ) : (
                <p className="text-[10px] text-fg-subtle mb-1">
                  Drag a series chip onto the card, or select a tag below.
                </p>
              )}
              <ExternalBaselinePicker
                runId={runId}
                currentMetricName={metric.name}
                selected={settings.externalBaseline?.name}
                availableRunIds={availableRunIds}
                onSelect={(name, ctx, selectedRunId) => {
                  updateSettings({
                    externalBaseline: { runId: selectedRunId, name, context_hash: ctx },
                    baselineIndex: undefined,
                    diffMode: settings.diffMode === "none" ? "absolute" : settings.diffMode,
                  });
                }}
              />
            </div>
          </>
        );
        return (
          <CardDetailModal
            open={expanded}
            onClose={() => setExpanded(false)}
            title={settings.title ?? metric.name}
            settingsContent={settingsPanel}
          >
            <div
              ref={(el) => {
                if (!el) return;
                if (!(el as any).__cairnModalWheel) {
                  const handler = (e: WheelEvent) => wheelHandlerRef.current?.(e);
                  el.addEventListener("wheel", handler, { passive: false });
                  (el as any).__cairnModalWheel = true;
                }
              }}
              className="h-[calc(100vh-12rem)] flex flex-col"
              style={{ cursor: canPan ? "move" : "default", touchAction: canPan ? "none" : undefined }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {isMulti ? (
                <div
                  className="grid gap-1 flex-1 min-h-0 overflow-auto"
                  style={{
                    gridTemplateColumns: `repeat(${settings.imageColumns ?? 2}, 1fr)`,
                    /* rows auto-size to content */
                  }}
                >
                  {effectiveMetrics.map((m, paneIdx) => {
                    if (refMode === "global" && settings.externalBaseline && m.name === settings.externalBaseline.name && (m.runId ?? runId) === (settings.externalBaseline.runId ?? runId)) return null;
                    const mStepMap = perSeriesStepMap[paneIdx] ?? new Map();
                    const mSeriesSteps = perSeriesPoints[paneIdx]?.map((p) => p.step) ?? [];
                    const { hash: mHash, fallbackStep: mFallback } = resolveArtifact(mStepMap, currentStep, mSeriesSteps, settings.missingImageMode);
                    const mLabel = seriesLabel(m, runId, multipleRuns, availableRunIds)
                      + (mFallback != null ? ` (step ${mFallback})` : "");
                    const mPaneBaseline = refMode === "per-run"
                      ? perPaneBaselineHash?.[paneIdx]
                      : baselineHash;
                    const mCompareMode = settings.compareMode ?? "side-by-side";
                    const mSplitPos = settings.splitPosition ?? 0.5;
                    const mBlendAlpha = settings.blendAlpha ?? 0.5;
                    const mShowInlineRef = mPaneBaseline && mHash && mPaneBaseline !== mHash &&
                      (refMode === "per-run" || settings.diffMode !== "none" || mCompareMode !== "side-by-side");
                    return (
                      <div key={seriesKey(m)} className="relative overflow-hidden" style={undefined}>
                        {mShowInlineRef ? (
                          settings.diffMode !== "none" ? (
                            /* Diff active: REF + ImagePane with diff computation */
                            <div className="flex gap-0.5 h-full cairn-checkerboard">
                              <div className="relative flex-1 min-w-0 overflow-hidden border border-accent/20 rounded" data-cairn-zoom-pane>
                                <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
                                  <img src={api.artifactUrl(mPaneBaseline)} alt="ref" className="w-full h-full object-contain" draggable={false}
                                    style={{ filter: filterStr, imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation }} />
                                </div>
                                <span className="absolute top-0.5 left-0.5 z-10 rounded bg-accent/20 px-1 py-0.5 text-[9px] text-accent backdrop-blur-sm">REF</span>
                              </div>
                              <div className="relative flex-1 min-w-0 overflow-hidden" data-cairn-zoom-pane>
                                <ImagePane
                                  metricEntry={m}
                                  paneIndex={paneIdx}
                                  artifactHash={mHash}
                                  baselineHash={mPaneBaseline}
                                  isBaseline={false}
                                  diffMode={settings.diffMode}
                                  interpolation={settings.interpolation ?? "auto"}
                                  colormap={settings.colormap ?? "none"}
                                  showAxes={settings.showAxes ?? false}
                                  zoom={settings.zoom}
                                  transformStr={transformStr}
                                  filterStr={filterStr}
                                  onNaturalSize={onImageNaturalSize}
                                  label={mLabel}
                                />
                              </div>
                            </div>
                          ) : mCompareMode === "side-by-side" ? (
                            /* No diff, side-by-side: raw img pair */
                            <div className="flex gap-0.5 h-full cairn-checkerboard">
                              <div className="relative flex-1 min-w-0 overflow-hidden border border-accent/20 rounded" data-cairn-zoom-pane>
                                <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
                                  <img src={api.artifactUrl(mPaneBaseline)} alt="ref" className="w-full h-full object-contain" draggable={false}
                                    style={{ filter: filterStr, imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation }} />
                                </div>
                                <span className="absolute top-0.5 left-0.5 z-10 rounded bg-accent/20 px-1 py-0.5 text-[9px] text-accent backdrop-blur-sm">REF</span>
                              </div>
                              <div className="relative flex-1 min-w-0 overflow-hidden" data-cairn-zoom-pane>
                                <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
                                  <img src={api.artifactUrl(mHash)} alt="pred" className="w-full h-full object-contain" draggable={false}
                                    style={{ filter: filterStr, imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation }} />
                                </div>
                                <span className="absolute bottom-0.5 left-0.5 z-10 rounded bg-bg/80 px-1 py-0.5 text-[9px] text-fg-muted backdrop-blur-sm">{mLabel}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="relative w-full overflow-hidden cairn-checkerboard" data-cairn-zoom-pane style={{ aspectRatio: "1 / 1", minHeight: 80 }}>
                              {/* Prediction layer */}
                              <div className="absolute inset-0 overflow-hidden" data-cairn-img-wrapper>
                                <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
                                  <img src={api.artifactUrl(mHash)} alt="pred" className="w-full h-full object-contain" draggable={false}
                                    style={{ filter: filterStr, imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation, ...(mCompareMode === "blend" ? { opacity: mBlendAlpha } : {}) }} />
                                </div>
                              </div>
                              {/* Reference layer — clipped at screen level */}
                              <div className="absolute inset-0 overflow-hidden"
                                style={mCompareMode === "split" ? { clipPath: `inset(0 ${(1 - mSplitPos) * 100}% 0 0)` } : undefined}>
                                <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
                                  <img src={api.artifactUrl(mPaneBaseline!)} alt="ref" className="w-full h-full object-contain" draggable={false}
                                    style={{ filter: filterStr, imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation, ...(mCompareMode === "blend" ? { opacity: 1 - mBlendAlpha } : {}) }} />
                                </div>
                              </div>
                              {mCompareMode === "split" && (
                                <div className="absolute top-0 bottom-0 z-20 flex items-center"
                                  style={{ left: `${mSplitPos * 100}%`, transform: "translateX(-50%)", cursor: "col-resize" }}
                                  onPointerDown={(ev) => {
                                    ev.stopPropagation(); ev.preventDefault();
                                    const ctr = ev.currentTarget.parentElement!;
                                    const r = ctr.getBoundingClientRect();
                                    const onMv = (me: PointerEvent) => { updateSettings({ splitPosition: Math.max(0, Math.min(1, (me.clientX - r.left) / r.width)) }); };
                                    const onUp2 = () => { window.removeEventListener("pointermove", onMv); window.removeEventListener("pointerup", onUp2); };
                                    window.addEventListener("pointermove", onMv); window.addEventListener("pointerup", onUp2);
                                  }}>
                                  <div className="w-1 h-full bg-accent/80 rounded-full" />
                                </div>
                              )}
                              <span className="absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm">{mLabel}</span>
                              <span className="absolute top-1 right-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm">REF</span>
                            </div>
                          )
                        ) : (
                          <ImagePane
                            metricEntry={m}
                            paneIndex={paneIdx}
                            artifactHash={mHash}
                            baselineHash={mPaneBaseline}
                            isBaseline={refMode === "global" && baselineIdx === paneIdx}
                            diffMode={settings.diffMode}
                            interpolation={settings.interpolation ?? "auto"}
                            colormap={settings.colormap ?? "none"}
                            showAxes={settings.showAxes ?? false}
                            zoom={settings.zoom}
                            transformStr={transformStr}
                            filterStr={filterStr}
                            onNaturalSize={onImageNaturalSize}
                            label={mLabel}
                          />
                        )}
                      </div>
                    );
                  })}
                  {(settings.compareMode ?? "side-by-side") === "side-by-side" && refMode === "global" && settings.externalBaseline && extBasePoints.length > 0 && (() => {
                    const refPt = extBasePoints[Math.min(safeIdx, extBasePoints.length - 1)];
                    const refHash = refPt?.artifact_hash ?? undefined;
                    return (
                      <div className="relative overflow-hidden" style={undefined}>
                        <ImagePane
                          metricEntry={{ runId: settings.externalBaseline!.runId, name: settings.externalBaseline!.name, context_hash: settings.externalBaseline!.context_hash }}
                          paneIndex={-1}
                          artifactHash={refHash}
                          baselineHash={undefined}
                          isBaseline={true}
                          diffMode="none"
                          interpolation={settings.interpolation ?? "auto"}
                          colormap={"none"}
                          showAxes={settings.showAxes ?? false}
                          zoom={settings.zoom}
                          transformStr={transformStr}
                          filterStr={filterStr}
                          label={`ref: ${settings.externalBaseline!.name}`}
                        />
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div
                  className="relative flex flex-1 min-h-0 justify-center items-center rounded cairn-checkerboard" data-cairn-zoom-pane
                  style={{
                    overflow: "hidden",
                    padding: settings.showAxes && singleNaturalDims ? "16px 4px 4px 28px" : "8px",
                  }}
                >
                  <div
                    className="relative w-full h-full"
                    style={{ transform: transformStr, transformOrigin: "0 0" }}
                  >
                    {firstResolved.hash ? (
                      <img
                        src={api.artifactUrl(firstResolved.hash!)}
                        alt={`${metric.name} @ step ${currentStep}`}
                        className="w-full h-full object-contain block"
                        draggable={false}
                        style={{
                          filter: filterStr,
                          imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation,
                        }}
                      />
                    ) : (
                      <span className="text-sm text-fg-muted">no image</span>
                    )}
                    {settings.showAxes && singleNaturalDims && (
                      <PixelAxes naturalWidth={singleNaturalDims.w} naturalHeight={singleNaturalDims.h} zoom={settings.zoom} />
                    )}
                  </div>
                </div>
              )}
              <StepSlider
                points={globalStepPoints}
                currentIndex={safeIdx}
                onChange={handleSliderChange}
                xAxis={settings.xAxis}
                onXAxisChange={(m) => updateSettings({ xAxis: m })}
                className="mt-3"
              />
            </div>
          </CardDetailModal>
        );
      })()}

      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 3}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p as Partial<typeof settings>)}
      />
    </div>
  );
}

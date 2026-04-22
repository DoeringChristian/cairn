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
import { useSequence, useSequences } from "../api/hooks";
import type { SequenceMeta, SequencePoint } from "../api/types";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import { useSeriesDrop } from "../lib/use-series-drop";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
  type ComparisonSeriesRef,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import { formatRelative } from "../lib/format";
import { computeDiff, loadImageData, type DiffMode } from "../lib/image-diff";
import { gpuComputeDiff } from "../lib/gpu-diff";
import { getRenderMode } from "../lib/render-mode";
import CardDetailModal from "./CardDetailModal";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SeriesChip , { CAIRN_SERIES_MIME, type SeriesRef } from "./SeriesChip";
import SettingsPopover from "./SettingsPopover";
import SplitPane from "./SplitPane";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";

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
  /** Fixed viewport size per pane. When set, panes arrange in a grid. */
  viewportSize?: { w: number; h: number };
  colSpan?: number;
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

function isModified(s: ImageSettings): boolean {
  return (
    s.brightness !== 0 ||
    s.contrast !== 0 ||
    s.gamma !== 1 ||
    s.zoom !== 1 ||
    s.pan.x !== 0 ||
    s.pan.y !== 0 ||
    s.diffMode !== "none" ||
    (s.interpolation ?? "auto") !== "auto" ||
    s.baselineIndex != null ||
    s.title != null ||
    s.height != null
  );
}

// Palette (same as ScalarPlotCard)
const SERIES_COLORS = [
  "#0969da",
  "#d29922",
  "#3fb950",
  "#f85149",
  "#c678dd",
  "#56d4dd",
];

function shortRunId(id: string): string {
  return id.length > 6 ? id.slice(0, 6) : id;
}

function seriesLabel(
  m: { runId?: string; name: string; context_hash: string },
  fallbackRunId: string,
  multiRun: boolean,
): string {
  const parts: string[] = [m.name];
  if (multiRun && (m.runId ?? fallbackRunId))
    parts.push(shortRunId(m.runId ?? fallbackRunId));
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
  isBaseline: boolean;
  diffMode: ImageSettings["diffMode"];
  interpolation: Interpolation;
  colormap: Colormap;
  showAxes: boolean;
  zoom: number;
  transformStr: string;
  filterStr: string;
  onSetBaseline: () => void;
  onNaturalSize?: (w: number, h: number) => void;
  label: string;
}

function ImagePane({
  artifactHash,
  baselineHash,
  isBaseline,
  diffMode,
  interpolation,
  colormap,
  showAxes,
  zoom: zoomLevel,
  transformStr,
  filterStr,
  onSetBaseline,
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


  useEffect(() => {
    if (!showDiff) {
      setDiffReady(false);
      return;
    }
    let cancelled = false;
    setDiffReady(false);

    const renderMode = getRenderMode();
    const useGPU = renderMode === "gpu" || renderMode === "auto";
    const useCPU = renderMode === "cpu" || renderMode === "auto";

    // CPU cache: only check in CPU or auto mode
    const cacheKey = `${baselineHash}::${artifactHash}::${diffMode}::${colormap}`;
    if (useCPU) {
      const cached = getCachedImageData(cacheKey);
      if (cached) {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = cached.width;
          canvas.height = cached.height;
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.putImageData(cached, 0, 0);
          setNaturalDims({ w: cached.width, h: cached.height });
          onNaturalSize?.(cached.width, cached.height);
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

      let diffData: ImageData | null = null;
      const isSigned = (diffMode as string).includes("signed");
      const cmapMode: "linear" | "signed" | "positive" = isSigned ? "signed" : "positive";

      // GPU path: fast, no need to cache result (GPU recomputes quickly)
      if (useGPU) {
        const gpuLut = colormap !== "none" ? getColormapLUT(colormap as Exclude<Colormap, "none">) : null;
        try {
          diffData = await gpuComputeDiff(baseData, otherData, {
            diffMode: diffMode as DiffMode,
            colormap: gpuLut,
            cmapMode,
          });
        } catch {
          // GPU failed — fall through to CPU if auto mode
        }
      }

      // CPU fallback (or forced CPU mode)
      if (!diffData) {
        if (!useCPU && renderMode === "gpu") {
          // GPU was forced but failed
          console.warn("WebGPU diff failed and render mode is 'gpu' — no fallback");
          return;
        }
        diffData = computeDiff(baseData, otherData, diffMode as DiffMode);
        if (colormap !== "none") {
          diffData = applyColormap(diffData, colormap as Exclude<Colormap, "none">, cmapMode);
        }
      }

      // Only cache CPU results (GPU recomputes fast, no need to waste memory)
      if (renderMode !== "gpu") setCachedImageData(cacheKey, diffData);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = diffData.width;
      canvas.height = diffData.height;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.putImageData(diffData, 0, 0);
      setNaturalDims({ w: diffData.width, h: diffData.height });
      onNaturalSize?.(diffData.width, diffData.height);
      setDiffReady(true);
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineHash, artifactHash, diffMode, showDiff, colormap, onNaturalSize]);

  return (
    <div className="flex flex-col h-full">
      {/* Pane header */}
      <div className="flex items-center gap-1 px-1 py-0.5 text-[10px] text-fg-muted">
        <button
          type="button"
          onClick={onSetBaseline}
          className={`inline-flex items-center justify-center h-4 w-4 rounded text-xs hover:bg-bg-hover ${
            isBaseline ? "text-accent" : "text-fg-subtle"
          }`}
          title={isBaseline ? "Baseline" : "Set as baseline"}
          aria-label={isBaseline ? "Baseline" : "Set as baseline"}
        >
          {"\u2605"}
        </button>
        <span className="truncate">{label}</span>
      </div>

      {/* Image / diff canvas */}
      <div className="flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard" style={{ padding: showAxes && naturalDims ? "16px 4px 4px 28px" : "4px" }}>
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
  runDisplayNames,
}: {
  runId: string;
  currentMetricName: string;
  selected?: string;
  onSelect: (name: string, contextHash: string, selectedRunId: string) => void;
  /** All distinct run IDs from the card's effective metrics. */
  availableRunIds: string[];
  /** Optional map from runId to display name. */
  runDisplayNames?: Map<string, string>;
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

  const runLabel = (id: string) => runDisplayNames?.get(id) ?? shortRunId(id);

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
      queryKey: ["sequence", m.runId ?? runId, m.name, m.context_hash],
      queryFn: () =>
        api.sequence(m.runId ?? runId, m.name, {
          context: m.context_hash || undefined,
          maxPoints: 500,
        }),
      refetchInterval: 2000,
    })),
  });

  // Per-series points that have artifacts.
  const perSeriesPoints = useMemo(
    () =>
      queries.map((q) =>
        (q.data?.points ?? []).filter(
          (p: SequencePoint) => p.artifact_hash,
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries.map((q) => q.dataUpdatedAt).join("|")],
  );

  // Shared step slider
  const maxLen = Math.max(...perSeriesPoints.map((pts) => pts.length), 0);
  const [idx, setIdx] = useState(settings.sliderStep ?? 0);
  const handleSliderChange = (newIdx: number) => {
    setIdx(newIdx);
    updateSettings({ sliderStep: newIdx });
  };
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, maxLen - 1));

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

  // "Add to comparison" popover state.
  const projectId = useProjectId();
  const { comparisons, refresh: refreshComparisons } =
    useComparisons(projectId ?? "");
  const addCompBtnRef = useRef<HTMLButtonElement | null>(null);
  const [addCompOpen, setAddCompOpen] = useState(false);
  const [addCompConfirm, setAddCompConfirm] = useState<string | null>(null);
  const addCompTimer = useRef<number | null>(null);
  const [newCompName, setNewCompName] = useState("");

  const addToComp = useCallback(
    (comparisonId: string, compName: string) => {
      if (!projectId) return;
      addCardToComparison(projectId, comparisonId, {
        type: "image",
        series: effectiveMetrics.map((m) => ({
          runId: m.runId ?? runId,
          name: m.name,
          context_hash: m.context_hash,
        })),
      });
      refreshComparisons();
      if (addCompTimer.current != null)
        window.clearTimeout(addCompTimer.current);
      setAddCompConfirm(`Added to ${compName}`);
      addCompTimer.current = window.setTimeout(() => {
        setAddCompConfirm(null);
        setAddCompOpen(false);
      }, 1500);
    },
    [projectId, runId, effectiveMetrics, refreshComparisons],
  );

  const createAndAdd = useCallback(() => {
    if (!projectId) return;
    const name = newCompName.trim() || "New comparison";
    const cmp = createComparison(projectId, name);
    addToComp(cmp.id, cmp.name);
    setNewCompName("");
  }, [projectId, newCompName, addToComp]);

  useEffect(() => {
    return () => {
      if (addCompTimer.current != null)
        window.clearTimeout(addCompTimer.current);
    };
  }, []);

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

  // Alt key tracking — zoom/pan only while Alt is held (consistent with scalar plots).
  const [altDown, setAltDown] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltDown(e.type === "keydown");
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

  // Stable wheel handler
  wheelHandlerRef.current = (e: WheelEvent) => {
    if (!altDownRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const s = settingsRef.current;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoom * factor));
    if (s.zoom === nextZoom) return;
    // Zoom toward cursor with transformOrigin "0 0":
    // Use the wrapper's PARENT rect (untransformed) for cursor position.
    const target = e.target as HTMLElement;
    const wrapper = target.closest("[data-cairn-img-wrapper]") as HTMLElement | null;
    const parent = wrapper?.parentElement;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      const cx = e.clientX - parentRect.left;
      const cy = e.clientY - parentRect.top;
      // With origin "0 0": screenPos = elemPos * zoom + pan
      // Element point under cursor: (cx - pan) / zoom
      // Keep that point at same screen position after zoom change:
      const newPanX = cx - ((cx - s.pan.x) / s.zoom) * nextZoom;
      const newPanY = cy - ((cy - s.pan.y) / s.zoom) * nextZoom;
      updateSettings({ zoom: nextZoom, pan: { x: newPanX, y: newPanY } });
    } else {
      updateSettings({ zoom: nextZoom });
    }
  };

  const roRef = useRef<ResizeObserver | null>(null);

  // Callback ref: attach wheel listener + ResizeObserver when element mounts
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (containerRef.current) {
      containerRef.current.removeEventListener("wheel", (containerRef.current as any).__cairnWheel);
      roRef.current?.disconnect();
    }
    containerRef.current = el;
    if (el) {
      const handler = (e: WheelEvent) => wheelHandlerRef.current?.(e);
      (el as any).__cairnWheel = handler;
      el.addEventListener("wheel", handler, { passive: false });
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) setContainerWidth(entry.contentRect.width);
      });
      ro.observe(el);
      roRef.current = ro;
      setContainerWidth(el.getBoundingClientRect().width);
    }
  }, []);

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!altDownRef.current) return; // Only pan with Alt held
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
  const modified = isModified(settings);

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
    e.stopPropagation(); // Prevent useSeriesDrop on outer card from also adding the metric
    try {
      const ref = JSON.parse(raw) as { runId: string; name: string; context_hash: string };
      updateSettings({
        externalBaseline: { runId: ref.runId, name: ref.name, context_hash: ref.context_hash },
        baselineIndex: undefined,
        diffMode: settings.diffMode === "none" ? "absolute" : settings.diffMode,
      });
    } catch { /* ignore */ }
  }, [updateSettings, settings.diffMode]);
  const [singleNaturalDims, setSingleNaturalDims] = useState<{ w: number; h: number } | null>(null);
  const singleFCRef = useRef<HTMLCanvasElement | null>(null);
  const [singleFCReady, setSingleFCReady] = useState(false);
  const singleArtifactHash = useMemo(() => {
    const pts = perSeriesPoints[0] ?? [];
    const safeI = Math.min(Math.max(0, idx), Math.max(0, pts.length - 1));
    return pts[safeI]?.artifact_hash ?? null;
  }, [perSeriesPoints, idx]);
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
    if (settings.height != null) return undefined; // user-set height
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
  }, [settings.height, imageAspect, containerWidth, effectiveMetrics.length]);

  // First series' points for subtitle
  const firstPoints = perSeriesPoints[0] ?? [];
  const firstCurrent = firstPoints[safeIdx];

  const subtitle =
    maxLen > 0
      ? `step ${firstCurrent?.step ?? "\u2014"} of ${maxLen}`
      : `${metric.count} pts`;

  const anyLoading = queries.some((q) => q.isLoading);

  // External baseline: fetch image from a different metric tag
  const extBase = settings.externalBaseline;
  const extBaseRid = extBase?.runId ?? runId;
  const extBaseName = extBase?.name ?? "";
  const extBaseCtx = extBase?.context_hash ?? "";
  const extBaseQuery = useSequence(extBaseRid, extBaseName, {
    context: extBaseCtx || undefined,
    maxPoints: 500,
  });
  const extBasePoints = useMemo(() => {
    if (!extBase || !extBaseQuery.data) return [];
    return (extBaseQuery.data.points ?? []).filter((p: SequencePoint) => p.artifact_hash);
  }, [extBase, extBaseQuery.data]);

  // Baseline hash for diff — external baseline takes priority
  const baselineIdx = settings.baselineIndex;
  const baselineHash = extBase
    ? extBasePoints[Math.min(safeIdx, Math.max(0, extBasePoints.length - 1))]?.artifact_hash ?? undefined
    : baselineIdx != null
      ? perSeriesPoints[baselineIdx]?.[safeIdx]?.artifact_hash ?? undefined
      : undefined;

  return (
    <div
      className={`card p-4 flex flex-col${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        position: "relative",
        height: settings.collapsed ? undefined : (settings.height ?? undefined),
        gridColumn: (settings.colSpan ?? 1) > 1 ? `span ${settings.colSpan}` : undefined,
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
        {modified && (
          <button
            type="button"
            onClick={() => resetSettings()}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Reset all image settings"
            title="Reset all image settings"
          >
            {"\u21BA"}
          </button>
        )}
        {projectId && (
          <button
            ref={addCompBtnRef}
            type="button"
            onClick={() => setAddCompOpen((v) => !v)}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Add to comparison"
            aria-haspopup="dialog"
            aria-expanded={addCompOpen}
            title="Add to comparison"
          >
            {"\u002B"}
          </button>
        )}
      </CardHeader>

      {!settings.collapsed && (<>
      {anyLoading && maxLen === 0 ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : maxLen > 0 ? (
        <>
          <div
            ref={setContainerRef}
            className={`relative min-h-0 flex flex-col overflow-hidden${settings.height != null ? " flex-1" : ""}${refDropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
            style={{
              height: settings.height == null ? autoHeight : undefined,
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
                gridTemplateColumns: settings.viewportSize
                  ? `repeat(auto-fill, ${settings.viewportSize.w}px)`
                  : `repeat(auto-fill, minmax(200px, 1fr))`,
                gridAutoRows: settings.viewportSize ? `${settings.viewportSize.h}px` : undefined,
              }}
            >
              {effectiveMetrics.map((m, paneIdx) => {
                // Skip metrics that match the external baseline — shown as separate ref pane
                if (settings.externalBaseline && m.name === settings.externalBaseline.name && (m.runId ?? runId) === (settings.externalBaseline.runId ?? runId)) return null;
                const pts = perSeriesPoints[paneIdx] ?? [];
                const pCurrent = pts[safeIdx];
                const hash = pCurrent?.artifact_hash ?? undefined;
                return (
                  <div key={seriesKey(m)} className="relative overflow-hidden" style={settings.viewportSize ? { width: settings.viewportSize.w, height: settings.viewportSize.h } : undefined}>
                    <ImagePane
                      metricEntry={m}
                      paneIndex={paneIdx}
                      artifactHash={hash}
                      baselineHash={baselineHash}
                      isBaseline={baselineIdx === paneIdx}
                      diffMode={settings.diffMode}
                      interpolation={settings.interpolation ?? "auto"}
                      colormap={settings.colormap ?? "none"}
                      showAxes={settings.showAxes ?? false}
                      zoom={settings.zoom}
                      transformStr={transformStr}
                      filterStr={filterStr}
                      onNaturalSize={onImageNaturalSize}
                      onSetBaseline={() => {
                        const isUnsetting = settings.baselineIndex === paneIdx;
                        updateSettings({
                          baselineIndex: isUnsetting ? undefined : paneIdx,
                          diffMode: isUnsetting
                            ? "none"
                            : settings.diffMode === "none"
                              ? "absolute"
                              : settings.diffMode,
                        });
                      }}
                      label={seriesLabel(m, runId, multipleRuns)}
                    />
                    {/* Viewport resize handle on first pane */}
                    {paneIdx === 0 && (
                      <div
                        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end text-fg-muted hover:text-fg z-10"
                        style={{ touchAction: "none" }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                          const startX = e.clientX;
                          const startY = e.clientY;
                          const pEl = e.currentTarget.parentElement!;
                          const startW = settings.viewportSize?.w ?? pEl.getBoundingClientRect().width;
                          const startH = settings.viewportSize?.h ?? pEl.getBoundingClientRect().height;
                          const onMove = (ev: PointerEvent) => {
                            const w = Math.max(80, Math.round(startW + (ev.clientX - startX)));
                            const h = Math.max(80, Math.round(startH + (ev.clientY - startY)));
                            updateSettings({ viewportSize: { w, h } });
                          };
                          const onUp = () => {
                            window.removeEventListener("pointermove", onMove);
                            window.removeEventListener("pointerup", onUp);
                          };
                          window.addEventListener("pointermove", onMove);
                          window.addEventListener("pointerup", onUp);
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none"><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5"/><line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" strokeWidth="1.5"/></svg>
                      </div>
                    )}
                  </div>
                );
              })}
              {/* External baseline reference pane */}
              {settings.externalBaseline && extBasePoints.length > 0 && (() => {
                const refPt = extBasePoints[Math.min(safeIdx, extBasePoints.length - 1)];
                const refHash = refPt?.artifact_hash ?? undefined;
                return (
                  <div className="relative overflow-hidden" style={settings.viewportSize ? { width: settings.viewportSize.w, height: settings.viewportSize.h } : undefined}>
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
                      onSetBaseline={() => updateSettings({ externalBaseline: undefined })}
                      label={`ref: ${settings.externalBaseline!.name}`}
                    />
                  </div>
                );
              })()}
            </div>
          ) : (
            /* ---------- Single-image layout (original) ---------- */
            <div
              className="relative flex flex-1 min-h-0 justify-center items-center rounded cairn-checkerboard"
              style={{
                overflow: "hidden",
                padding: settings.showAxes && singleNaturalDims ? "16px 4px 4px 28px" : "8px",
              }}
            >
              <div
                data-cairn-img-wrapper className="relative w-full h-full"
                style={{ transform: transformStr, transformOrigin: "0 0" }}
              >
              {firstCurrent?.artifact_hash ? (
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
                    src={api.artifactUrl(firstCurrent.artifact_hash)}
                    alt={`${metric.name} @ step ${firstCurrent.step}`}
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

          {/* Shared step slider */}
          {maxLen > 1 && (
            <input
              type="range"
              min={0}
              max={maxLen - 1}
              value={safeIdx}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
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
                label={seriesLabel(m, runId, multipleRuns)}
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

      {/* Add to comparison popover */}
      <SettingsPopover
        open={addCompOpen && projectId != null}
        onClose={() => {
          setAddCompOpen(false);
          setAddCompConfirm(null);
        }}
        anchorRef={addCompBtnRef}
        title="Add to comparison"
      >
        {addCompConfirm ? (
          <p className="text-xs text-accent">{addCompConfirm}</p>
        ) : (
          <>
            {comparisons.length === 0 ? (
              <p className="text-xs text-fg-subtle mb-2">
                No comparisons yet.
              </p>
            ) : (
              <div className="flex flex-col gap-1 mb-2 max-h-48 overflow-y-auto">
                {comparisons.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addToComp(c.id, c.name)}
                    className="text-left text-xs text-fg-muted hover:bg-bg-hover rounded px-2 py-1.5 border border-border-subtle"
                  >
                    <div className="truncate">{c.name}</div>
                    <div className="text-[10px] text-fg-subtle">
                      {c.cards.length} card(s) ·{" "}
                      {formatRelative(c.createdAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-border-subtle pt-2 mt-1">
              <label className="text-[10px] uppercase tracking-wide text-fg-muted block mb-1">
                Create new comparison
              </label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newCompName}
                  onChange={(e) => setNewCompName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createAndAdd();
                    }
                  }}
                  placeholder="Name"
                  className="input flex-1 text-xs"
                />
                <button
                  type="button"
                  onClick={createAndAdd}
                  className="btn text-xs px-2"
                >
                  Create
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAddCompOpen(false)}
              className="btn w-full mt-2 text-xs"
            >
              Cancel
            </button>
          </>
        )}
      </SettingsPopover>
      </>)}

      {(() => {
        const settingsPanel = (
          <>
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
            <Slider
              label="Zoom"
              value={settings.zoom}
              onChange={(v) => updateSettings({ zoom: v })}
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              format={(v) => `${v.toFixed(2)}x`}
              description="Alt+scroll to zoom; Alt+drag to pan."
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
            <Toggle
              label="Pixel axes"
              checked={settings.showAxes ?? false}
              onChange={(v) => updateSettings({ showAxes: v })}
              description="Show pixel coordinate ticks along edges"
            />
            <h4 className="text-xs uppercase tracking-wide text-fg-muted mt-4 mb-2">
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
            <div className="mt-2">
              <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">
                Reference source
              </label>
              {settings.externalBaseline ? (
                <div className="flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
                  <span className="mono truncate flex-1">{settings.externalBaseline.name}{settings.externalBaseline.runId && settings.externalBaseline.runId !== runId ? ` · ${shortRunId(settings.externalBaseline.runId)}` : ""}</span>
                  <button
                    type="button"
                    onClick={() => updateSettings({ externalBaseline: undefined, baselineIndex: undefined, diffMode: settings.diffMode === "none" ? "none" : settings.diffMode })}
                    className="text-fg-subtle hover:text-fg shrink-0"
                    title="Remove external reference"
                  >{"\u00D7"}</button>
                </div>
              ) : (
                <p className="text-[10px] text-fg-subtle mb-1">
                  {isMulti ? "Click \u2605 on a pane, or select a tag below." : "Select a tag below."}
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
            <button
              type="button"
              className="btn w-full mt-2"
              onClick={() => {
                resetSettings();
                setExpanded(false);
              }}
            >
              Reset to defaults
            </button>
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
                <SplitPane
                  widths={
                    settings.paneWidths ??
                    Array(effectiveMetrics.length).fill(
                      1 / effectiveMetrics.length,
                    )
                  }
                  onWidthsChange={(w) => updateSettings({ paneWidths: w })}
                >
                  {effectiveMetrics.map((m, paneIdx) => {
                    const pts = perSeriesPoints[paneIdx] ?? [];
                    const pCurrent = pts[safeIdx];
                    const hash = pCurrent?.artifact_hash ?? undefined;
                    return (
                      <ImagePane
                        key={seriesKey(m)}
                        metricEntry={m}
                        paneIndex={paneIdx}
                        artifactHash={hash}
                        baselineHash={baselineHash}
                        isBaseline={baselineIdx === paneIdx}
                        diffMode={settings.diffMode}
                        interpolation={settings.interpolation ?? "auto"}
                        colormap={settings.colormap ?? "none"}
                        showAxes={settings.showAxes ?? false}
                        zoom={settings.zoom}
                        transformStr={transformStr}
                        filterStr={filterStr}
                        onNaturalSize={onImageNaturalSize}
                        onSetBaseline={() => {
                          const isUnsetting = settings.baselineIndex === paneIdx;
                          updateSettings({
                            baselineIndex: isUnsetting ? undefined : paneIdx,
                            diffMode: isUnsetting
                              ? "none"
                              : settings.diffMode === "none"
                                ? "absolute"
                                : settings.diffMode,
                          });
                        }}
                        label={seriesLabel(m, runId, multipleRuns)}
                      />
                    );
                  })}
                </SplitPane>
              ) : (
                <div
                  className="relative flex flex-1 min-h-0 justify-center items-center rounded cairn-checkerboard"
                  style={{
                    overflow: "hidden",
                    padding: settings.showAxes && singleNaturalDims ? "16px 4px 4px 28px" : "8px",
                  }}
                >
                  <div
                    className="relative w-full h-full"
                    style={{ transform: transformStr, transformOrigin: "0 0" }}
                  >
                    {firstCurrent?.artifact_hash ? (
                      <img
                        src={api.artifactUrl(firstCurrent.artifact_hash)}
                        alt={`${metric.name} @ step ${firstCurrent.step}`}
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
              {maxLen > 1 && (
                <input
                  type="range"
                  min={0}
                  max={maxLen - 1}
                  value={safeIdx}
                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                  className="mt-3 w-full accent-accent"
                />
              )}
            </div>
          </CardDetailModal>
        );
      })()}

      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 1}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
      />
    </div>
  );
}

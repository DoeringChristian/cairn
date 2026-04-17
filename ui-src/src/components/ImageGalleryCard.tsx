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
import type { SequenceMeta, SequencePoint } from "../api/types";
import { useCardSettings } from "../lib/card-settings";
import { useSeriesDrop } from "../lib/use-series-drop";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import { formatRelative } from "../lib/format";
import { computeDiff, loadImageData, type DiffMode } from "../lib/image-diff";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SeriesChip , { type SeriesRef } from "./SeriesChip";
import SettingsPopover from "./SettingsPopover";
import SplitPane from "./SplitPane";
import Select from "./settings/Select";
import Slider from "./settings/Slider";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface Props {
  runId: string;
  metric: SequenceMeta;
}

interface ImageSettings {
  version: 1;
  title?: string;
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  brightness: number;
  contrast: number;
  gamma: number;
  zoom: number;
  pan: { x: number; y: number };
  baselineIndex?: number;
  diffMode: "none" | DiffMode;
  height?: number;
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
    s.baselineIndex != null ||
    s.title != null ||
    s.height != null
  );
}

// Palette (same as ScalarPlotCard)
const SERIES_COLORS = [
  "#539bf5",
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
// ImagePane — renders a single image or canvas diff inside a split pane.
// ---------------------------------------------------------------------------

interface ImagePaneProps {
  metricEntry: { runId?: string; name: string; context_hash: string };
  paneIndex: number;
  artifactHash: string | undefined;
  baselineHash: string | undefined;
  isBaseline: boolean;
  diffMode: ImageSettings["diffMode"];
  filterStr: string;
  onSetBaseline: () => void;
  label: string;
}

function ImagePane({
  artifactHash,
  baselineHash,
  isBaseline,
  diffMode,
  filterStr,
  onSetBaseline,
  label,
}: ImagePaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Track whether a diff has been successfully rendered to the canvas.
  const [diffReady, setDiffReady] = useState(false);

  const showDiff =
    !isBaseline &&
    diffMode !== "none" &&
    baselineHash != null &&
    artifactHash != null &&
    baselineHash !== artifactHash;

  useEffect(() => {
    if (!showDiff) {
      setDiffReady(false);
      return;
    }
    let cancelled = false;
    setDiffReady(false);

    (async () => {
      const [baseData, otherData] = await Promise.all([
        loadImageData(api.artifactUrl(baselineHash!)),
        loadImageData(api.artifactUrl(artifactHash!)),
      ]);
      if (cancelled) return;
      if (!baseData || !otherData) return;
      const diffData = computeDiff(
        baseData,
        otherData,
        diffMode as DiffMode,
      );
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = diffData.width;
      canvas.height = diffData.height;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.putImageData(diffData, 0, 0);
      setDiffReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [baselineHash, artifactHash, diffMode, showDiff]);

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
      <div className="flex-1 flex items-center justify-center overflow-hidden rounded bg-bg p-1">
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
              className="max-h-full max-w-full object-contain"
              style={{ display: diffReady ? "block" : "none" }}
            />
          </>
        ) : (
          <img
            src={api.artifactUrl(artifactHash)}
            alt={label}
            className="max-h-full max-w-full object-contain"
            draggable={false}
            style={{ filter: filterStr }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageGalleryCard
// ---------------------------------------------------------------------------

export default function ImageGalleryCard({ runId, metric }: Props) {
  const defaults = useMemo(
    () =>
      defaultImageSettings({
        name: metric.name,
        context_hash: metric.context_hash,
      }),
    [metric.name, metric.context_hash],
  );

  const settingsKey = useMemo(
    () => ({
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    }),
    [runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings, resetSettings] = useCardSettings(
    settingsKey,
    defaults,
  );

  // -----------------------------------------------------------------------
  // Multi-series fetch
  // -----------------------------------------------------------------------
  const queries = useQueries({
    queries: settings.metrics.map((m) => ({
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
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, maxLen - 1));

  const isMulti = settings.metrics.length > 1;

  const multipleRuns = useMemo(() => {
    const seen = new Set<string>();
    for (const m of settings.metrics) seen.add(m.runId ?? runId);
    return seen.size > 1;
  }, [settings.metrics, runId]);

  // -----------------------------------------------------------------------
  // Settings refs for non-passive handlers
  // -----------------------------------------------------------------------
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const metricsRef = useRef(settings.metrics);
  metricsRef.current = settings.metrics;

  const { highlight: dropHighlight, dropProps } = useSeriesDrop({
    metricsRef,
    onMetricsChange: useCallback(
      (next) => updateSettings({ metrics: next }),
      [updateSettings],
    ),
  });

  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        series: settings.metrics.map((m) => ({
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
    [projectId, runId, settings.metrics, refreshComparisons],
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el || isMulti) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const cur = settingsRef.current.zoom;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur * factor));
      updateSettings({ zoom: nextZoom });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
    };
  }, [updateSettings, isMulti]);

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isMulti) return;
      if (settingsRef.current.zoom <= 1) return;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        panX: settingsRef.current.pan.x,
        panY: settingsRef.current.pan.y,
      };
    },
    [isMulti],
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
  const canPan = !isMulti && settings.zoom > 1;
  const modified = isModified(settings);

  // First series' points for subtitle
  const firstPoints = perSeriesPoints[0] ?? [];
  const firstCurrent = firstPoints[safeIdx];

  const subtitle =
    maxLen > 0
      ? `step ${firstCurrent?.step ?? "\u2014"} of ${maxLen}`
      : `${metric.count} pts`;

  const anyLoading = queries.some((q) => q.isLoading);

  // Baseline hash for diff
  const baselineIdx = settings.baselineIndex;
  const baselineHash =
    baselineIdx != null
      ? perSeriesPoints[baselineIdx]?.[safeIdx]?.artifact_hash ?? undefined
      : undefined;

  return (
    <div
      className={`card p-4${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        position: "relative",
        minHeight: settings.height ?? undefined,
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
      >
        {modified && (
          <button
            type="button"
            onClick={() => resetSettings()}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Reset image settings"
            title="Reset image settings"
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
        <button
          ref={settingsBtnRef}
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
          aria-label="Image settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          title="Image settings"
        >
          {"\u2699"}
        </button>
      </CardHeader>

      {anyLoading && maxLen === 0 ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : maxLen > 0 ? (
        <>
          {isMulti ? (
            /* ---------- Multi-pane layout ---------- */
            <SplitPane
              widths={
                settings.paneWidths ??
                Array(settings.metrics.length).fill(
                  1 / settings.metrics.length,
                )
              }
              onWidthsChange={(w) => updateSettings({ paneWidths: w })}
            >
              {settings.metrics.map((m, paneIdx) => {
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
                    filterStr={filterStr}
                    onSetBaseline={() => {
                      const isUnsetting = settings.baselineIndex === paneIdx;
                      updateSettings({
                        baselineIndex: isUnsetting ? undefined : paneIdx,
                        // Auto-enable diff when setting baseline for the first time.
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
            /* ---------- Single-image layout (original) ---------- */
            <div
              ref={containerRef}
              className="flex justify-center rounded bg-bg p-2"
              style={{
                overflow: "hidden",
                cursor: canPan ? "move" : "default",
                touchAction: canPan ? "none" : undefined,
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {firstCurrent?.artifact_hash ? (
                <img
                  src={api.artifactUrl(firstCurrent.artifact_hash)}
                  alt={`${metric.name} @ step ${firstCurrent.step}`}
                  className="max-h-64 object-contain"
                  draggable={false}
                  style={{
                    filter: filterStr,
                    transform: transformStr,
                    transformOrigin: "center center",
                  }}
                />
              ) : (
                <span className="text-sm text-fg-muted">no image</span>
              )}
            </div>
          )}

          {/* Shared step slider */}
          {maxLen > 1 && (
            <input
              type="range"
              min={0}
              max={maxLen - 1}
              value={safeIdx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
        </>
      ) : (
        <div className="text-sm text-fg-muted">no image logged yet</div>
      )}

      {/* Series chip strip */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {settings.metrics.map((m, i) => {
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
                settings.metrics.length > 1
                  ? () => {
                      const next = settings.metrics.filter(
                        (_, idx2) => idx2 !== i,
                      );
                      // Adjust baselineIndex
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
        })}
      </div>

      {/* Settings popover */}
      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        anchorRef={settingsBtnRef}
        title="Image"
      >
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

        {!isMulti && (
          <Slider
            label="Zoom"
            value={settings.zoom}
            onChange={(v) => updateSettings({ zoom: v })}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            format={(v) => `${v.toFixed(2)}x`}
            description="Scroll on the image to zoom; drag to pan when zoomed in."
          />
        )}

        {isMulti && (
          <p className="text-xs text-fg-subtle mt-2">
            Zoom/pan available in single-image mode.
          </p>
        )}

        {isMulti && (
          <>
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
          </>
        )}

        <button
          type="button"
          className="btn w-full mt-2"
          onClick={() => {
            resetSettings();
            setSettingsOpen(false);
          }}
        >
          Reset to defaults
        </button>
      </SettingsPopover>

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

      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
      />
    </div>
  );
}

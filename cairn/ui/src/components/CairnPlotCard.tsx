import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  comparisonOperationSettingsPatch,
  mountPlot,
  type DataSpec,
  type MountedPlot,
  type PlotNode,
  type PlotSession,
  type PlotSpec,
} from "@cairn-plot";

import type { SequenceMeta, SequencePoint } from "../api/types";
import { useSequencesForRuns } from "../api/hooks";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { cairnPlotDataSource } from "../lib/cairn-plot";
import CardShell from "./CardShell";
import type { BaseCardSettings } from "./card-kit";
import { seriesLabel } from "./card-kit/series-identity";
import { useRunInfo } from "./card-kit/use-run-info";
import { resolveAtStep } from "./card-kit/resolve-at-step";
import { useStepSlider } from "./card-kit/use-step-slider";
import StepSlider from "./StepSlider";
import { ExternalBaselinePicker } from "./card-kit/ExternalBaselinePicker";
import { plotCardPolicy } from "./card-kit/plot-card-policy";
import NumberInput from "./settings/NumberInput";
import Select from "./settings/Select";
import SettingsSection from "./settings/SettingsSection";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

type GridColumns = "auto" | "1" | "2" | "3" | "4";
type PlotSettingValues = Record<string, unknown>;

interface PlotCardSettings extends BaseCardSettings {
  version: 1;
  gridColumns: GridColumns;
  syncGrid: boolean;
  showLabels: boolean;
  /** Index into the union of logged artifact steps. */
  sliderStep?: number;
  /** Card content selected as this card's comparison/reference operand. */
  comparisonMetric?: ComparisonSeriesRef;
  /** Comparison presentation/kernel. `split` is a presentation-only operation. */
  comparisonOperation?: string;
  /** @deprecated Migrated into comparisonOperation; retained for saved cards. */
  comparisonPresentation?: "split" | "diff";
  /** One shared reference, or the selected tag resolved separately per run. */
  referenceMode?: "global" | "per-run";
  /** Optional fixed reference step; absent means follow the foreground iteration. */
  referenceStep?: number;
  /** Uniform pane settings persisted through cairn-plot's public session API. */
  plotSettings?: PlotSettingValues;
}

const DEFAULT_SETTINGS: PlotCardSettings = {
  version: 1,
  colSpan: 3,
  gridColumns: "auto",
  syncGrid: true,
  showLabels: true,
};

const SERIES_COLORS = ["#60a5fa", "#f59e0b", "#34d399", "#f472b6", "#a78bfa", "#fb7185"];
const DISPLAY_OPTIONS = [
  ["linear", "Linear"], ["srgb", "sRGB"], ["gamma", "Gamma"],
  ["reinhard", "Reinhard"], ["aces", "ACES"], ["normal", "Normal map"],
  ["turbo", "Turbo"], ["plasma", "Plasma"], ["magma", "Magma"],
  ["red-green", "Red–Green"], ["red-blue", "Red–Blue"],
].map(([value, label]) => ({ value: value!, label: label! }));
const COMPARE_OPTIONS = [
  ["split", "Split"], ["absolute", "Absolute error"], ["signed", "Signed error"],
  ["squared", "Squared error"], ["relative_absolute", "Relative absolute"],
  ["relative_signed", "Relative signed"], ["relative_squared", "Relative squared"],
  ["flip", "FLIP"], ["ssim", "SSIM"],
].map(([value, label]) => ({ value: value!, label: label! }));

function latestArtifact(points: readonly SequencePoint[]): SequencePoint | undefined {
  for (let index = points.length - 1; index >= 0; index--) {
    if (points[index]?.artifact_hash) return points[index];
  }
  return undefined;
}

function artifactFormat(mime: string | null | undefined): string | undefined {
  const value = mime?.toLowerCase() ?? "";
  if (value.includes("openexr") || value.endsWith("/exr")) return "exr";
  if (value.includes("numpy") || value.includes("npy")) return "npy";
  return undefined;
}

function metadata(point: SequencePoint): Record<string, string | number | boolean | null> {
  if (!point.artifact_metadata) return {};
  try {
    const value = JSON.parse(point.artifact_metadata) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, string | number | boolean | null>
      : {};
  } catch {
    return {};
  }
}

function visualData(type: string, point: SequencePoint): DataSpec | null {
  const hash = point.artifact_hash;
  if (!hash) return null;
  if (type === "image") {
    return {
      kind: "image",
      hash,
      metadata: point.artifact_metadata,
      format: artifactFormat(point.artifact_mime),
    };
  }
  if (type === "pointcloud" || type === "mesh" || type === "volume" || type === "boxes3d") {
    return { kind: "npz", hash, objectType: type, meta: metadata(point) };
  }
  return null;
}

function firstCellSettings(session: PlotSession): PlotSettingValues {
  const firstLeaf = Object.entries(session.cells).find(([id]) => id.startsWith("cell:"));
  return firstLeaf?.[1].settings as PlotSettingValues | undefined ?? {};
}

function initialSession(spec: PlotSpec, settings: PlotSettingValues): PlotSession {
  const session: PlotSession = { cells: {}, grids: {} };
  const visit = (node: PlotNode, path: string): void => {
    if (node.kind !== "grid") {
      session.cells[`cell:${path}`] = { settings: { ...settings } };
      return;
    }
    session.grids[`grid:${path}`] = {
      layout: node.initialLayout ?? "grid",
      activeSlot: 0,
    };
    if (node.children.length > 0) session.cells[`stack:${path}`] = { settings: { ...settings } };
    node.children.forEach((child, index) => visit(child, `${path}/${index}`));
  };
  visit(spec.root, "root");
  return session;
}

/**
 * React adapter over cairn-plot's supported imperative host. Its private React
 * root is updated only when the authored spec changes, not whenever CardShell
 * reports a new size. This keeps expensive image/3D surfaces alive while a
 * resize drag directly updates the card's dimensions.
 */
const StablePlotHost = memo(function StablePlotHost({
  spec,
  initial,
  className,
  onMount,
  onSessionChange,
}: {
  spec: PlotSpec;
  initial?: PlotSession;
  className: string;
  onMount: (plot: MountedPlot | null) => void;
  onSessionChange: (session: PlotSession) => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<MountedPlot | null>(null);
  const initialSpecRef = useRef(spec);
  const initialSessionRef = useRef(initial);
  const onMountRef = useRef(onMount);
  const onSessionChangeRef = useRef(onSessionChange);
  onMountRef.current = onMount;
  onSessionChangeRef.current = onSessionChange;

  useLayoutEffect(() => {
    if (!elementRef.current) return;
    const plot = mountPlot(elementRef.current, {
      spec: initialSpecRef.current,
      dataSource: cairnPlotDataSource,
      className: "cairn-card-plot-host h-full min-h-0 min-w-0 overflow-hidden p-1",
      autoHeight: false,
      initialSession: initialSessionRef.current,
      onSessionChange: (session) => onSessionChangeRef.current(session),
    });
    plotRef.current = plot;
    onMountRef.current(plot);
    return () => {
      onMountRef.current(null);
      plotRef.current = null;
      plot.destroy();
    };
  }, []);

  // Author changes must reach the nested cairn-plot root before the browser's
  // next paint. A passive effect adds a full extra frame to every hot iteration
  // swap even when all decoded sources and error textures are resident.
  useLayoutEffect(() => {
    plotRef.current?.update({ spec });
  }, [spec]);

  return <div ref={elementRef} className={className} />;
});

function numberSetting(settings: PlotSettingValues, key: string, fallback: number): number {
  return typeof settings[key] === "number" ? settings[key] as number : fallback;
}

function applySettingsPatch(settings: PlotSettingValues, patch: PlotSettingValues): PlotSettingValues {
  const next = { ...settings };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

export default function CairnPlotCard({
  runId,
  metric,
  extraSeries = [],
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<MountedPlot | null>(null);
  const latestSessionRef = useRef<PlotSession | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsKey = useMemo<CardSettingsKey>(() => settingsKeyOverride ?? ({
    runId,
    metricName: metric.name,
    contextHash: metric.context_hash,
  }), [settingsKeyOverride, runId, metric.name, metric.context_hash]);
  const cardPolicy = useMemo(() => plotCardPolicy(metric.object_type), [metric.object_type]);
  const defaultSettings = useMemo<PlotCardSettings>(() => ({
    ...DEFAULT_SETTINGS,
    colSpan: cardPolicy.colSpan,
  }), [cardPolicy]);
  const [settings, updateSettings] = useCardSettings(settingsKey, defaultSettings);
  // Accept the short-lived same-run shape written by the first selector build.
  const comparisonMetric = useMemo(() => settings.comparisonMetric
    ? { ...settings.comparisonMetric, runId: settings.comparisonMetric.runId || runId }
    : undefined,
  [runId, settings.comparisonMetric?.runId, settings.comparisonMetric?.name, settings.comparisonMetric?.context_hash]);
  const [livePlotSettings, setLivePlotSettings] = useState<PlotSettingValues>(settings.plotSettings ?? {});
  const livePlotSettingsRef = useRef(livePlotSettings);
  livePlotSettingsRef.current = livePlotSettings;
  const persistedPlotSettingsRef = useRef(settings.plotSettings ?? {});

  const schedulePlotSettingsPersist = useCallback((next: PlotSettingValues) => {
    persistedPlotSettingsRef.current = next;
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      updateSettings({ plotSettings: next });
    }, 200);
  }, [updateSettings]);

  useEffect(() => () => {
    if (persistTimerRef.current == null) return;
    window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = null;
    // Do not lose the tail of a slider drag when navigation/unmount happens
    // inside the debounce window. The card updater still enforces read-only
    // report mode and emits the normal settings-change notification.
    updateSettings({ plotSettings: persistedPlotSettingsRef.current });
  }, [updateSettings]);

  const series = useMemo(() => [
    { runId, name: metric.name, context_hash: metric.context_hash },
    ...extraSeries.map((item) => ({
      runId: item.runId,
      name: item.name,
      context_hash: item.context_hash,
    })),
  ], [runId, metric.name, metric.context_hash, extraSeries]);
  const bindings = useMemo(() => series.map((item) => ({
    runId: item.runId,
    name: item.name,
    contextHash: item.context_hash,
  })), [series]);
  const runIds = useMemo(() => [...new Set(series.map((item) => item.runId))], [series]);
  useRunInfo(runIds);
  const labels = useMemo(() => {
    const multiRun = runIds.length > 1;
    return series.map((item) => seriesLabel(item, runId, multiRun, runIds));
  }, [series, runId, runIds]);
  const availableRunIds = useMemo(() => [...new Set([
    runId,
    ...extraSeries.map((item) => item.runId),
  ])], [runId, extraSeries]);
  const selectedCompareOperation = settings.comparisonPresentation === "split"
    ? "split"
    : settings.comparisonOperation ?? "absolute";
  const referenceMode = settings.referenceMode ?? "global";
  const referenceBindings = useMemo(() => {
    if (metric.object_type !== "image" || !comparisonMetric) return [];
    if (referenceMode === "global") {
      return [{
        runId: comparisonMetric.runId,
        name: comparisonMetric.name,
        contextHash: comparisonMetric.context_hash,
      }];
    }
    return series.map((item) => ({
      runId: item.runId,
      name: comparisonMetric.name,
      contextHash: comparisonMetric.context_hash,
    }));
  }, [metric.object_type, comparisonMetric, referenceMode, series]);
  const allBindings = useMemo(() => [...bindings, ...referenceBindings], [bindings, referenceBindings]);
  const allQueries = useSequencesForRuns(allBindings);
  const queries = allQueries.slice(0, bindings.length);
  const referenceQueries = allQueries.slice(bindings.length);
  // `useQueries` returns a fresh result array each render. Key the authored spec
  // only on actual query changes so exposure/pan/session updates do not call
  // mountPlot.update() and rebuild plot topology.
  const queryDataKey = allQueries.map((query) => `${query.dataUpdatedAt}:${query.isLoading ? 1 : 0}`).join("|");
  const { artifactPoints, referenceArtifactPoints, globalStepPoints } = useMemo(() => {
    const points = queries.map((query) =>
      (query.data?.points ?? []).filter((point) => point.artifact_hash),
    );
    const references = referenceQueries.map((query) =>
      (query.data?.points ?? []).filter((point) => point.artifact_hash),
    );
    const byStep = new Map<number, string | null>();
    for (const seriesPoints of points) {
      for (const point of seriesPoints) {
        if (!byStep.has(point.step)) byStep.set(point.step, point.wall_time ?? null);
      }
    }
    return {
      artifactPoints: points,
      referenceArtifactPoints: references,
      globalStepPoints: [...byStep.entries()]
        .sort(([a], [b]) => a - b)
        .map(([step, wall_time]) => ({ step, wall_time })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDataKey]);
  const { safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints: artifactPoints,
    persistedIdx: settings.sliderStep,
    updateSettings,
  });

  const spec = useMemo<PlotSpec | null>(() => {
    if (allQueries.some((query) => query.isLoading)) return null;
    if (metric.object_type === "scalar") {
      const scalarSeries = queries.map((query, index) => ({
        key: `${bindings[index]?.runId}:${bindings[index]?.name}:${bindings[index]?.contextHash}`,
        label: labels[index] ?? `series ${index + 1}`,
        color: SERIES_COLORS[index % SERIES_COLORS.length]!,
        points: (query.data?.points ?? [])
          .filter((point) => point.scalar_value != null)
          .map((point) => ({
            x: point.step,
            y: point.scalar_value!,
            wallTime: point.wall_time,
            context: point.context,
          })),
      }));
      return {
        root: {
          kind: "grid",
          children: [{
            kind: "plot",
            type: "scalar",
            data: { kind: "inline", props: { series: scalarSeries, xAxis: "step", showLegend: scalarSeries.length > 1 } },
          }],
          cols: 1,
          rowHeights: ["minmax(0, 1fr)"],
          gap: "0.75rem",
          switchable: false,
        },
      };
    }

    const children = queries.flatMap<PlotNode>((query, index) => {
      const point = metric.object_type === "image"
        ? resolveAtStep(artifactPoints[index] ?? [], currentStep)
        : latestArtifact(query.data?.points ?? []);
      if (!point) return [];
      const data = visualData(metric.object_type, point);
      if (!data) return [];

      if (metric.object_type === "image" && comparisonMetric) {
        // A global reference is one exact selected series, tracked positionally
        // through its own iteration sequence. Per-run mode resolves the selected
        // tag independently in every foreground pane's run at the current step.
        const referencePoints = referenceMode === "global"
          ? referenceArtifactPoints[0] ?? []
          : referenceArtifactPoints[index] ?? [];
        const referenceTargetStep = settings.referenceStep ?? currentStep;
        const referencePoint = settings.referenceStep != null
          ? resolveAtStep(referencePoints, referenceTargetStep)
          : referenceMode === "global"
            ? referencePoints[Math.min(safeIdx, Math.max(0, referencePoints.length - 1))]
            : resolveAtStep(referencePoints, referenceTargetStep);
        const referenceData = referencePoint ? visualData("image", referencePoint) : null;
        const isGlobalReferencePane = referenceMode === "global" &&
          series[index]?.runId === comparisonMetric.runId &&
          series[index]?.name === comparisonMetric.name &&
          series[index]?.context_hash === comparisonMetric.context_hash;
        if (isGlobalReferencePane) return [];
        if (!referenceData) return [];
        return [{
          kind: "compare",
          type: "image",
          presentation: selectedCompareOperation === "split" ? "split" : "difference",
          operands: [referenceData, data],
          strategy: "reference",
          referenceIndex: 0,
          settings: { "compare.operation": selectedCompareOperation },
          props: {
            labelA: referenceMode === "global"
              ? comparisonMetric.name
              : `${comparisonMetric.name} · reference`,
            labelB: labels[index] ?? metric.name,
          },
        }];
      }

      const props = {
        ...(settings.showLabels ? { label: labels[index] ?? metric.name } : {}),
        ...(metric.object_type === "image" ? { holdPreviousWhileLoading: true } : {}),
      };
      return [{
        kind: "plot",
        type: metric.object_type,
        data,
        ...(Object.keys(props).length > 0 ? { props } : {}),
      }];
    });
    if (children.length === 0) return null;
    const configuredColumns = settings.gridColumns === "auto"
      ? Math.ceil(Math.sqrt(children.length))
      : Number(settings.gridColumns);
    const columns = Math.max(1, Math.min(configuredColumns, children.length));
    const rows = Math.ceil(children.length / columns);
    return {
      root: {
        kind: "grid",
        children,
        cols: columns,
        rowHeights: Array.from({ length: rows }, () => "minmax(0, 1fr)"),
        gap: "0.75rem",
        switchable: false,
        shared: { sync: { settings: settings.syncGrid } },
      },
    };
    // `queries` is intentionally represented by `queryDataKey`: depending on
    // its unstable array identity would update the expensive host on every
    // settings-panel slider event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindings, labels, metric.name, metric.object_type, queryDataKey, artifactPoints, referenceArtifactPoints, currentStep, safeIdx, settings.gridColumns, settings.showLabels, settings.syncGrid, settings.referenceStep, comparisonMetric, referenceMode, selectedCompareOperation, series]);

  const handleSessionChange = useCallback((session: PlotSession) => {
    latestSessionRef.current = session;
    const next = firstCellSettings(session);
    if (JSON.stringify(next) !== JSON.stringify(livePlotSettingsRef.current)) {
      livePlotSettingsRef.current = next;
      setLivePlotSettings(next);
    }
    if (JSON.stringify(next) !== JSON.stringify(persistedPlotSettingsRef.current)) {
      schedulePlotSettingsPersist(next);
    }
  }, [schedulePlotSettingsPersist]);

  const patchPlotSettings = useCallback((patch: PlotSettingValues) => {
    const next = applySettingsPatch(livePlotSettingsRef.current, patch);
    livePlotSettingsRef.current = next;
    setLivePlotSettings(next);
    // This public fast path patches live cells directly. It deliberately avoids
    // cloning, parsing, pruning, and restoring the entire plot session for every
    // exposure/split slider animation frame.
    plotRef.current?.patchSettings(patch);
    schedulePlotSettingsPersist(next);
  }, [schedulePlotSettingsPersist]);

  const changeCompareOperation = useCallback((comparisonOperation: string) => {
    // The authored node changes comparison topology, while the live settings
    // patch updates the already-mounted PlotCell. Node defaults are seeds only
    // and deliberately do not overwrite interactive session state on updates.
    updateSettings({ comparisonOperation, comparisonPresentation: undefined });
    const live = livePlotSettingsRef.current;
    patchPlotSettings(comparisonOperationSettingsPatch({
      previousOperation: typeof live["compare.operation"] === "string"
        ? live["compare.operation"]
        : selectedCompareOperation,
      nextOperation: comparisonOperation,
      currentEncoding: typeof live["image.encoding"] === "string"
        ? live["image.encoding"]
        : undefined,
      flipMode: live["compare.flipMode"] === "hdr" ? "hdr" : "sdr",
    }));
  }, [patchPlotSettings, selectedCompareOperation, updateSettings]);

  const plot = spec ? (
    <StablePlotHost
      spec={spec}
      initial={latestSessionRef.current ?? (
        settings.plotSettings && Object.keys(settings.plotSettings).length > 0
          ? initialSession(spec, settings.plotSettings)
          : undefined
      )}
      className="h-full min-h-0 min-w-0 overflow-hidden"
      onMount={(mounted) => { plotRef.current = mounted; }}
      onSessionChange={handleSessionChange}
    />
  ) : <div className="p-4 text-sm text-fg-muted">Loading…</div>;

  const imageSettings = metric.object_type === "image" && (
    <SettingsSection title="Image display">
      <Select<string>
        label="Encoding"
        value={String(livePlotSettings["image.encoding"] ?? "srgb")}
        onChange={(value) => patchPlotSettings({ "image.encoding": value })}
        options={DISPLAY_OPTIONS}
      />
      <Slider
        label="Exposure"
        value={numberSetting(livePlotSettings, "image.exposureEV", 0)}
        onChange={(value) => patchPlotSettings({ "image.exposureEV": value })}
        min={-10}
        max={10}
        step={0.01}
        format={(value) => `${value.toFixed(2)} EV`}
      />
      <Slider
        label="Offset"
        value={numberSetting(livePlotSettings, "image.offset", 0)}
        onChange={(value) => patchPlotSettings({ "image.offset": value })}
        min={-1}
        max={1}
        step={0.001}
        format={(value) => value.toFixed(3)}
      />
      {livePlotSettings["image.encoding"] === "gamma" && (
        <Slider
          label="Gamma"
          value={numberSetting(livePlotSettings, "image.tonemapGamma", 2.2)}
          onChange={(value) => patchPlotSettings({ "image.tonemapGamma": value })}
          min={0.1}
          max={5}
          step={0.05}
          format={(value) => value.toFixed(2)}
        />
      )}
      <Slider
        label="Peak (HDR ceiling)"
        value={numberSetting(livePlotSettings, "image.peak", 16)}
        onChange={(value) => patchPlotSettings({ "image.peak": value })}
        min={1}
        max={16}
        step={0.5}
        format={(value) => `${value.toFixed(1)}×`}
      />
      <Select<string>
        label="Channel reduction"
        value={String(livePlotSettings["image.reduce"] ?? "mean")}
        onChange={(value) => patchPlotSettings({ "image.reduce": value })}
        options={[{ value: "mean", label: "Mean" }, { value: "luminance", label: "Luminance" }]}
      />
      <NumberInput
        label="Range minimum"
        value={(livePlotSettings["image.colorRange"] as { min?: number } | null)?.min ?? null}
        onChange={(min) => patchPlotSettings({
          "image.colorRange": min == null ? null : {
            min,
            max: (livePlotSettings["image.colorRange"] as { max?: number } | null)?.max ?? 1,
          },
        })}
      />
      <NumberInput
        label="Range maximum"
        value={(livePlotSettings["image.colorRange"] as { max?: number } | null)?.max ?? null}
        onChange={(max) => patchPlotSettings({
          "image.colorRange": max == null ? null : {
            min: (livePlotSettings["image.colorRange"] as { min?: number } | null)?.min ?? 0,
            max,
          },
        })}
      />
      <Toggle
        label="Information panel"
        checked={livePlotSettings["panel.info"] === true}
        onChange={(value) => patchPlotSettings({ "panel.info": value })}
      />
      <button
        type="button"
        className="mt-2 w-full rounded border border-border px-2 py-1 text-xs hover:bg-bg-hover"
        onClick={() => patchPlotSettings({ "image.view": { zoom: 1, pan: { x: 0, y: 0 } } })}
      >
        Reset image view
      </button>
      {livePlotSettings["image.channelSelect"] != null && (
        <button
          type="button"
          className="mt-2 w-full rounded border border-border px-2 py-1 text-xs hover:bg-bg-hover"
          onClick={() => patchPlotSettings({ "image.channelSelect": null })}
        >
          Reset channel selection
        </button>
      )}
    </SettingsSection>
  );

  const comparisonPicker = metric.object_type === "image" && (
    <SettingsSection title="Compare with" first>
      <p className="mb-1 text-xs text-fg-muted">
        Choose a reference image tag. Every image pane in this card is compared against the global reference or its run-local copy.
      </p>
      {comparisonMetric && (
        <div className="mb-2 flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
          <span className="mono min-w-0 flex-1 truncate">
            {comparisonMetric.name}
            {comparisonMetric.runId !== runId
              ? ` · ${comparisonMetric.runId.slice(0, 8)}`
              : ""}
          </span>
          <button
            type="button"
            onClick={() => updateSettings({ comparisonMetric: undefined })}
            className="shrink-0 text-fg-subtle hover:text-fg"
            aria-label="Remove comparison reference"
          >
            ×
          </button>
        </div>
      )}
      <ExternalBaselinePicker
        runId={runId}
        objectType={metric.object_type}
        currentMetricName={metric.name}
        selected={comparisonMetric?.name}
        availableRunIds={availableRunIds}
        onSelect={(name, context_hash, selectedRunId) => {
          updateSettings({
            comparisonMetric: { runId: selectedRunId, name, context_hash },
            comparisonPresentation: undefined,
            comparisonOperation: selectedCompareOperation,
          });
          changeCompareOperation(selectedCompareOperation);
        }}
      />
    </SettingsSection>
  );

  const compareOperation = selectedCompareOperation;
  const comparisonPresentation = compareOperation === "split" ? "split" : "diff";
  const compareSettings = metric.object_type === "image" && settings.comparisonMetric && (
    <SettingsSection title="Comparison">
      {availableRunIds.length > 1 && (
        <Select<"global" | "per-run">
          label="Reference mode"
          value={referenceMode}
          onChange={(referenceMode) => updateSettings({ referenceMode })}
          options={[
            { value: "per-run", label: "Per-run reference tag" },
            { value: "global", label: "One global reference" },
          ]}
          description="Per-run resolves the selected tag separately in each pane's run. Global uses the exact selected run and tag for every pane."
        />
      )}
      <Select<string>
        label="Diff mode"
        value={compareOperation}
        onChange={changeCompareOperation}
        options={COMPARE_OPTIONS}
      />
      {comparisonPresentation === "diff" && compareOperation === "flip" && (
        <Select<"hdr" | "sdr">
          label="FLIP evaluation"
          value={livePlotSettings["compare.flipMode"] === "hdr" ? "hdr" : "sdr"}
          onChange={(value) => patchPlotSettings({ "compare.flipMode": value })}
          options={[{ value: "hdr", label: "HDR-FLIP" }, { value: "sdr", label: "SDR-FLIP" }]}
        />
      )}
      {comparisonPresentation === "split" && (
        <Slider
          label="Split position"
          value={numberSetting(livePlotSettings, "compare.split", 0.5)}
          onChange={(value) => patchPlotSettings({ "compare.split": value })}
          min={0}
          max={1}
          step={0.01}
          format={(value) => `${Math.round(value * 100)}%`}
        />
      )}
      <Toggle
        label="Pin reference step"
        checked={settings.referenceStep != null}
        onChange={(pinned) => updateSettings({ referenceStep: pinned ? currentStep : undefined })}
        description="Off follows the foreground iteration; on keeps the reference fixed."
      />
      {settings.referenceStep != null && (
        <Slider
          label="Reference step"
          value={settings.referenceStep}
          onChange={(referenceStep) => updateSettings({ referenceStep: Math.round(referenceStep) })}
          min={globalStepPoints[0]?.step ?? 0}
          max={globalStepPoints[globalStepPoints.length - 1]?.step ?? 1}
          step={1}
          format={(value) => Math.round(value).toString()}
        />
      )}
    </SettingsSection>
  );

  const sceneSettings = (metric.object_type === "pointcloud" || metric.object_type === "mesh" || metric.object_type === "boxes3d" || metric.object_type === "volume") && (
    <SettingsSection title="3D view">
      <button
        type="button"
        className="w-full rounded border border-border px-2 py-1 text-xs hover:bg-bg-hover"
        onClick={() => patchPlotSettings({ "scene3d.camera": undefined })}
      >
        Reset camera
      </button>
    </SettingsSection>
  );

  const settingsPanel = (
    <>
      {comparisonPicker}
      <SettingsSection title="Grid" first={!comparisonPicker}>
        <Select<GridColumns>
          label="Columns"
          value={settings.gridColumns}
          onChange={(gridColumns) => updateSettings({ gridColumns })}
          options={[
            { value: "auto", label: "Automatic" }, { value: "1", label: "1 column" },
            { value: "2", label: "2 columns" }, { value: "3", label: "3 columns" },
            { value: "4", label: "4 columns" },
          ]}
        />
        <Toggle
          label="Synchronize panes"
          description="Keep zoom, display controls, channels, and other pane settings together."
          checked={settings.syncGrid}
          onChange={(syncGrid) => updateSettings({ syncGrid })}
        />
        <Toggle label="Show pane labels" checked={settings.showLabels} onChange={(showLabels) => updateSettings({ showLabels })} />
      </SettingsSection>
      {imageSettings}
      {compareSettings}
      {sceneSettings}
    </>
  );

  const iterationSlider = metric.object_type === "image" ? (
    <StepSlider
      points={globalStepPoints}
      currentIndex={safeIdx}
      onChange={onSliderChange}
      immediate
      className="shrink-0 px-1 pb-1 pt-2"
    />
  ) : null;
  const plotContent = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{plot}</div>
      {iterationSlider}
    </div>
  );

  return (
    <CardShell
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      cardKind={metric.object_type}
      defaultHeight={cardPolicy.defaultHeight}
      onRemove={onRemove}
      onSettings={() => setSettingsOpen(true)}
      settingsPanel={settingsPanel}
      modalContent={settingsOpen ? plotContent : null}
      modalOpen={settingsOpen}
      onModalClose={() => setSettingsOpen(false)}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <div className="mt-2 min-h-0 min-w-0 flex-1 overflow-hidden">
        {settingsOpen ? null : plotContent}
      </div>
    </CardShell>
  );
}

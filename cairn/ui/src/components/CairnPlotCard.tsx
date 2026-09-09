import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  comparisonOperationSettingsPatch,
  mountPlot,
  recommendedImageEncoding,
  type MountedPlot,
  type PlotNode,
  type PlotSession,
  type PlotSpec,
} from "@cairn-plot";

import type { SequenceMeta } from "../api/types";
import { useSequencesForRuns } from "../api/hooks";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { cairnPlotDataSource } from "../lib/cairn-plot";
import CardShell from "./CardShell";
import type { BaseCardSettings } from "./card-kit";
import { seriesLabel } from "./card-kit/series-identity";
import { useRunInfo } from "./card-kit/use-run-info";
import { buildPlotSpec } from "./card-kit/build-plot-spec";
import { useStepSlider } from "./card-kit/use-step-slider";
import { useOverlaySlot } from "./card-kit/use-overlay-slot";
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
  /** One-shot migration marker for operation-aware encoding defaults. */
  encodingDefaultsVersion?: 1 | 2;
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
  ["flip", "FLIP"], ["flip-hdr", "HDR-FLIP"], ["ssim", "SSIM"],
].map(([value, label]) => ({ value: value!, label: label! }));

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
  const settingsSlot = useOverlaySlot(settingsOpen);
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
  const selectedCompareOperation = settings.comparisonPresentation === "split"
    ? "split"
    : settings.comparisonOperation ?? "absolute";
  const referenceBindings = useMemo(() => {
    if (metric.object_type !== "image" || !comparisonMetric) return [];
    // References are always local to each foreground run. The selected tag
    // identifies content, never one globally privileged run.
    return series.map((item) => ({
      runId: item.runId,
      name: comparisonMetric.name,
      contextHash: comparisonMetric.context_hash,
    }));
  }, [metric.object_type, comparisonMetric, series]);
  const allBindings = useMemo(() => [...bindings, ...referenceBindings], [bindings, referenceBindings]);
  const allQueries = useSequencesForRuns(allBindings);
  const queries = allQueries.slice(0, bindings.length);
  const referenceQueries = allQueries.slice(bindings.length);
  // `useQueries` returns a fresh result array each render. Key the authored spec
  // only on actual query changes so exposure/pan/session updates do not call
  // mountPlot.update() and rebuild plot topology.
  const queryDataKey = allQueries.map((query) => `${query.dataUpdatedAt}:${query.isLoading ? 1 : 0}`).join("|");
  const { seriesPoints, artifactPoints, referenceArtifactPoints, globalStepPoints } = useMemo(() => {
    const all = queries.map((query) => query.data?.points ?? []);
    const points = all.map((seriesPoints) =>
      seriesPoints.filter((point) => point.artifact_hash),
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
      seriesPoints: all,
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

  // H5: the host must stay mounted while some sequences still load. The spec is
  // built from whatever runs already have data; on an image card a run without
  // data holds its cell with an unavailable pane, on other card types it stays
  // out of the grid until it arrives. Only a card where nothing has arrived at
  // all renders the loading placeholder (which does unmount the host).
  const anyLoading = allQueries.some((query) => query.isLoading);
  const spec = useMemo<PlotSpec | null>(() => buildPlotSpec({
    objectType: metric.object_type,
    metricName: metric.name,
    bindings,
    labels,
    seriesPoints,
    artifactPoints,
    referenceArtifactPoints,
    anyLoading,
    currentStep,
    referenceStep: settings.referenceStep,
    comparison: comparisonMetric
      ? { name: comparisonMetric.name, contextHash: comparisonMetric.context_hash }
      : null,
    compareOperation: selectedCompareOperation,
    gridColumns: settings.gridColumns,
    syncGrid: settings.syncGrid,
    showLabels: settings.showLabels,
    seriesColors: SERIES_COLORS,
  }),
  // `queries` is intentionally represented by `queryDataKey`: depending on
  // its unstable array identity would update the expensive host on every
  // settings-panel slider event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [bindings, labels, metric.name, metric.object_type, queryDataKey, seriesPoints, artifactPoints, referenceArtifactPoints, anyLoading, currentStep, settings.gridColumns, settings.showLabels, settings.syncGrid, settings.referenceStep, comparisonMetric, selectedCompareOperation]);

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

  const encodingMigrationAppliedRef = useRef(false);
  useEffect(() => {
    if (encodingMigrationAppliedRef.current || settings.encodingDefaultsVersion === 2) return;
    encodingMigrationAppliedRef.current = true;
    const live = livePlotSettingsRef.current;
    const savedOperation = typeof live["compare.operation"] === "string"
      ? live["compare.operation"]
      : selectedCompareOperation;
    // `compare.flipMode` was retired when HDR-FLIP became its own registry
    // operation (`flip-hdr`), so the key is gone from `PlotSettings` and must
    // be read (and dropped) through an untyped view of the saved cell.
    const legacyFlipMode = (live as Record<string, unknown>)["compare.flipMode"];
    const migratesHdrFlip = legacyFlipMode === "hdr" && savedOperation === "flip";
    const operation = migratesHdrFlip ? "flip-hdr" : savedOperation;
    const currentEncoding = typeof live["image.encoding"] === "string"
      ? live["image.encoding"]
      : undefined;
    const migratedEncoding = operation !== "split" && currentEncoding === "srgb"
      ? recommendedImageEncoding({ operation })
      : currentEncoding;
    const migratedPlotSettings: PlotSettingValues = { ...live };
    if (migratedEncoding !== currentEncoding) {
      migratedPlotSettings["image.encoding"] = migratedEncoding;
    }
    if (migratesHdrFlip) {
      migratedPlotSettings["compare.operation"] = "flip-hdr";
    }
    delete (migratedPlotSettings as Record<string, unknown>)["compare.flipMode"];
    updateSettings({
      encodingDefaultsVersion: 2,
      plotSettings: migratedPlotSettings,
      ...(migratesHdrFlip ? { comparisonOperation: "flip-hdr" } : {}),
    });
    if (migratedEncoding !== currentEncoding) {
      patchPlotSettings({ "image.encoding": migratedEncoding });
    }
    if (migratesHdrFlip) {
      patchPlotSettings({ "compare.operation": "flip-hdr" });
    }
  }, [patchPlotSettings, selectedCompareOperation, settings.encodingDefaultsVersion, updateSettings]);

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
        Choose a reference image tag. Each image pane uses that tag from its own run.
      </p>
      {comparisonMetric && (
        <div className="mb-2 flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
          <span className="mono min-w-0 flex-1 truncate">
            {comparisonMetric.name}
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
        onSelect={(name, context_hash) => {
          updateSettings({
            comparisonMetric: { runId, name, context_hash },
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
      <Select<string>
        label="Diff mode"
        value={compareOperation}
        onChange={changeCompareOperation}
        options={COMPARE_OPTIONS}
      />
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
      modalContent={<div ref={settingsSlot.slotRef} className="h-full w-full" />}
      modalOpen={settingsOpen}
      onModalClose={() => setSettingsOpen(false)}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      {/* H4: one stable tree position for the plot host. Opening the settings
          panel only re-styles this box into the modal's reserved slot, so the
          mounted cairn-plot root — and every pane's decoded image — survives. */}
      <div
        className={settingsOpen
          ? "min-h-0 min-w-0 overflow-hidden"
          : "mt-2 min-h-0 min-w-0 flex-1 overflow-hidden"}
        style={settingsSlot.style}
      >
        {plotContent}
      </div>
    </CardShell>
  );
}

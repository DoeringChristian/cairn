import { useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { type CardSettingsKey } from "../lib/card-settings";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { seriesKey } from "../lib/series-utils";
import type { SequenceMeta, SequenceResponse } from "../api/types";
import {
  useCardSeries,
  useStepSlider,
  resolveAtStep,
  useRunInfo,
  MultiPaneGrid,
  PropertySelector,
  useTwoSeriesCompare,
  useCompareReferenceMeta,
  OffscreenComparePanes,
  CompareSettingsPanel,
  type BaseCardSettings,
} from "./card-kit";
import {
  Colorbar,
  isCoreCompareMode,
  type MediaCompareMode,
  type DiffMode,
  type Colormap,
} from "../lib/cairn-plot";
import PointCloudViewer, {
  type PointCloudChannels,
  type PointColorMode,
  type PointCloudBackground,
  extractPositions,
} from "../lib/cairn-plot/renderers/PointCloudViewer";
import { resetScene3DViews, type Scene3DSyncOptions } from "../lib/cairn-plot/three/use-scene3d";
import { parseNpy } from "../lib/cairn-plot/transforms/parse-npy";
import { parseNpz } from "../lib/cairn-plot/transforms/parse-npz";
import {
  extractProperties,
  resolveActiveProperty,
  propertyNames,
  type PropertyMap,
  type PropertyMeta,
} from "../lib/cairn-plot/three/properties";
import { diffColors, computeDelta, computeDisplacementMagnitude, type DiffColormap } from "../lib/cairn-plot/three/diff";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import { useCameraSync } from "../lib/camera-sync";
import RunSelectionPanel from "./RunSelectionPanel";
import StepSlider from "./StepSlider";

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface PointCloudMeta {
  n_points: number;
  channels: PointCloudChannels;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  original_count: number;
  downsampled?: boolean;
  value_range?: { min: number; max: number; mean: number };
  properties?: PropertyMeta[];
}

/** Extension point usage: pointcloud's two native modes, appended via
 *  `MediaCompareMode<TExtra>` — see spec-visual-compare.md / ws-VC1-report.md. */
type PointCloudCompareMode = MediaCompareMode<"diff-property" | "diff-position">;

interface PointCloudSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
  pointSize: number;
  colorMode: PointColorMode;
  background: PointCloudBackground;
  /**
   * Live camera sync across this card's panes and any other sync-enabled 3D
   * card on the page. Optional/absent = false (unchanged default behavior)
   * — see `lib/camera-sync.ts`.
   */
  syncViews?: boolean;
  /** Selected named property (Property selector); undefined = first available. */
  property?: string;
  /** 2-series compare mode (spec-visual-compare.md WS-VC2). Absent/"side" =
   *  today's default multi-pane grid, UNCHANGED. */
  compareMode?: PointCloudCompareMode;
  diffColormap?: DiffColormap;
  diffSubmode?: DiffMode;
  splitPosition?: number;
  blendAlpha?: number;
  refFixedStep?: number;
}

const DEFAULT_SETTINGS = (seed: { name: string; context_hash: string }): PointCloudSettings => ({
  version: 1,
  metrics: [seed],
  pointSize: 2.5,
  colorMode: "auto",
  background: "dark",
});

const MAX_PANES = 4;

const COLOR_MODE_OPTIONS: Array<{ value: PointColorMode; label: string }> = [
  { value: "auto", label: "Auto (rgb → category → height)" },
  { value: "rgb", label: "RGB" },
  { value: "category", label: "Category" },
  { value: "height", label: "Height (viridis)" },
];

const BACKGROUND_OPTIONS: Array<{ value: PointCloudBackground; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

// Point cloud's native per-type compare kinds (core kinds + shared
// diff-colormap/submode/slider controls live in CompareSettingsPanel).
const NATIVE_COMPARE_MODES: Array<{ value: PointCloudCompareMode; label: string }> = [
  { value: "diff-property", label: "Diff: property (native)" },
  { value: "diff-position", label: "Diff: position (native)" },
];

function looksLikeNpz(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 2) return false;
  const view = new Uint8Array(buf, 0, 2);
  return view[0] === 0x50 && view[1] === 0x4b; // "PK\x03\x04"
}

interface PointCloudArrays {
  /** Flat `(nPoints * channelCount)` float32 data. */
  data: Float32Array;
  properties: PropertyMap;
}

/** Fetch + parse the point-cloud blob for a given artifact hash — plain
 *  `.npy` (no named properties) or `.npz` (named properties present),
 *  content-sniffed (see `cairn/sdk/handlers/pointcloud.py::deserialize`). */
function usePointCloudBlob(hash: string | undefined) {
  return useQuery({
    queryKey: ["pointcloud-blob", hash],
    enabled: !!hash,
    staleTime: Infinity,
    queryFn: async (): Promise<PointCloudArrays> => {
      const res = await fetch(api.artifactUrl(hash!));
      if (!res.ok) throw new Error(`failed to fetch point cloud (${res.status})`);
      const buf = await res.arrayBuffer();
      if (looksLikeNpz(buf)) {
        const npz = await parseNpz(buf);
        if (!npz.points) throw new Error("point cloud npz missing 'points'");
        return {
          data: Float32Array.from(npz.points.data),
          properties: extractProperties(npz),
        };
      }
      const parsed = parseNpy(buf);
      // The shared parser returns Float64Array for uniform downstream math;
      // three.js BufferAttributes require Float32Array, so narrow once here.
      return { data: Float32Array.from(parsed.data), properties: {} };
    },
  });
}

interface ViewConfig {
  pointSize: number;
  colorMode: PointColorMode;
  background: PointCloudBackground;
  /** Resolved live camera-sync group, or `null` when sync is off for this card. */
  sync: Scene3DSyncOptions | null;
  property: string | null;
}

/** Renders a single resolved point-cloud point (blob + metadata). */
function PointCloudBody({
  hash,
  meta,
  view,
  fill,
}: {
  hash: string | undefined;
  meta: PointCloudMeta | null | undefined;
  view: ViewConfig;
  /** Fill the card's resizable body (single/normal-compare view) instead of
   * the multi-pane grid's fixed, independently-scrollable pane height. See
   * spec-3DR — one `fill` switch shared by all four 3D card `*Body`s rather
   * than forking the wrapper per caller. */
  fill?: boolean;
}) {
  const blob = usePointCloudBlob(hash);

  if (!hash) {
    return <div className="text-sm text-fg-muted">no point cloud logged yet</div>;
  }
  if (blob.isLoading) {
    return <div className={fill ? "flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover" : "h-64 motion-safe:animate-pulse rounded bg-bg-hover"} />;
  }
  if (blob.isError || !blob.data || !meta) {
    return <div className="text-sm text-fg-muted">failed to load point cloud</div>;
  }

  const nPoints = meta.n_points;
  const active = resolveActiveProperty(blob.data.properties, view.property, meta.properties ?? null);
  return (
    <div className={fill ? "flex flex-1 min-h-0 flex-col" : "flex flex-col"}>
      <div className={fill ? "flex flex-1 min-h-0 overflow-hidden rounded bg-bg" : "flex h-64 overflow-hidden rounded bg-bg"}>
        <div className="min-w-0 flex-1">
          <PointCloudViewer
            data={blob.data.data}
            channels={meta.channels}
            nPoints={nPoints}
            bounds={meta.bounds}
            colorMode={view.colorMode}
            pointSize={view.pointSize}
            background={view.background}
            sync={view.sync}
          />
        </div>
        {active.range && active.values && (
          <Colorbar colormap="viridis" min={active.range[0]} max={active.range[1]} />
        )}
      </div>
      <div className="mono mt-1 text-xs text-fg-subtle">
        {`${nPoints.toLocaleString()} pts · ${meta.channels}`}
        {meta.downsampled
          ? ` · downsampled from ${meta.original_count.toLocaleString()}`
          : ""}
        {" · double-click to re-fit"}
      </div>
    </div>
  );
}

/** A pane in the multi-run grid: fetches its own sequence + blob at the step. */
function PointCloudPane({
  runId,
  m,
  targetStep,
  view,
}: {
  runId: string;
  m: { runId?: string; name: string; context_hash: string };
  targetStep: number;
  view: ViewConfig;
}) {
  const rid = m.runId ?? runId;
  const q = useSequence(rid, m.name, {
    context: m.context_hash || undefined,
    maxPoints: 500,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const current = useMemo(
    () => resolveAtStep(points, targetStep) ?? points[0],
    [points, targetStep],
  );
  const meta = useMemo(
    () => safeJsonParse<PointCloudMeta>(current?.artifact_metadata),
    [current],
  );

  if (q.isLoading) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  return (
    <div className="rounded bg-bg p-2">
      <PointCloudBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} />
    </div>
  );
}

/** 2-series compare panel — see MeshCard's `MeshComparePanel` for the full
 *  pattern writeup (identical mechanics, pointcloud-specific diff math). */
function PointCloudComparePanel({
  runId,
  primaryMetric,
  referenceMetric,
  currentStep,
  view,
  settings,
  updateSettings,
}: {
  runId: string;
  primaryMetric: { runId?: string; name: string; context_hash: string };
  referenceMetric: { runId?: string; name: string; context_hash: string };
  currentStep: number;
  view: ViewConfig;
  settings: PointCloudSettings;
  updateSettings: (patch: Partial<PointCloudSettings>) => void;
}) {
  const primaryQ = useSequence(primaryMetric.runId ?? runId, primaryMetric.name, {
    context: primaryMetric.context_hash || undefined,
    maxPoints: 500,
  });
  const referenceQ = useSequence(referenceMetric.runId ?? runId, referenceMetric.name, {
    context: referenceMetric.context_hash || undefined,
    maxPoints: 500,
  });
  const primaryPoints = useMemo(() => (primaryQ.data?.points ?? []).filter((p) => p.artifact_hash), [primaryQ.data]);
  const referencePoints = useMemo(() => (referenceQ.data?.points ?? []).filter((p) => p.artifact_hash), [referenceQ.data]);

  const { primaryHash, referenceHash } = useTwoSeriesCompare({
    primaryPoints,
    referencePoints,
    currentStep,
    refFixedStep: settings.refFixedStep,
  });

  const primaryPoint = useMemo(() => primaryPoints.find((p) => p.artifact_hash === primaryHash), [primaryPoints, primaryHash]);
  const referencePoint = useMemo(() => referencePoints.find((p) => p.artifact_hash === referenceHash), [referencePoints, referenceHash]);
  const primaryMeta = useMemo(() => safeJsonParse<PointCloudMeta>(primaryPoint?.artifact_metadata), [primaryPoint]);
  const referenceMeta = useMemo(() => safeJsonParse<PointCloudMeta>(referencePoint?.artifact_metadata), [referencePoint]);

  const primaryBlob = usePointCloudBlob(primaryHash);
  const referenceBlob = usePointCloudBlob(referenceHash);

  const mode: PointCloudCompareMode = settings.compareMode ?? "side";

  if (mode === "normal") {
    return <PointCloudBody hash={primaryHash} meta={primaryMeta} view={view} fill />;
  }

  if (!primaryBlob.data || !referenceBlob.data || !primaryMeta || !referenceMeta) {
    return <div className="flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }

  if (isCoreCompareMode(mode) && (mode === "split" || mode === "blend" || mode === "diff")) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden rounded bg-bg">
        <OffscreenComparePanes
          mode={mode}
          renderPrimary={(onFrame, sync) => (
            <PointCloudViewer
              data={primaryBlob.data!.data}
              channels={primaryMeta.channels}
              nPoints={primaryMeta.n_points}
              bounds={primaryMeta.bounds}
              colorMode={view.colorMode}
              pointSize={view.pointSize}
              background={view.background}
              sync={sync}
              onFrame={onFrame}
            />
          )}
          renderReference={(onFrame, sync) => (
            <PointCloudViewer
              data={referenceBlob.data!.data}
              channels={referenceMeta.channels}
              nPoints={referenceMeta.n_points}
              bounds={referenceMeta.bounds}
              colorMode={view.colorMode}
              pointSize={view.pointSize}
              background={view.background}
              sync={sync}
              onFrame={onFrame}
            />
          )}
          diffSubmode={settings.diffSubmode ?? "signed"}
          colormap={(settings.diffColormap ?? "viridis") as Colormap}
          splitPosition={settings.splitPosition ?? 0.5}
          onSplitPositionChange={(p) => updateSettings({ splitPosition: p })}
          blendAlpha={settings.blendAlpha ?? 0.5}
          primaryLabel={primaryMetric.name}
        />
      </div>
    );
  }

  // Native modes: diff-property | diff-position — same point COUNT required
  // (index-corresponding, per spec-3dx-superseded §C — no nearest-neighbor
  // matching).
  const topologyOk = primaryMeta.n_points === referenceMeta.n_points;
  if (!topologyOk) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        Point-count mismatch: {primaryMeta.n_points.toLocaleString()} vs{" "}
        {referenceMeta.n_points.toLocaleString()} points — native diff modes need the same point
        count (index-corresponding).
      </div>
    );
  }

  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";
  let deltaValues: Float32Array | null = null;
  if (mode === "diff-position") {
    const posA = extractPositions(primaryBlob.data.data, primaryMeta.channels, primaryMeta.n_points);
    const posB = extractPositions(referenceBlob.data.data, referenceMeta.channels, referenceMeta.n_points);
    deltaValues = computeDisplacementMagnitude(posA, posB, primaryMeta.n_points);
  } else {
    const activeA = resolveActiveProperty(primaryBlob.data.properties, view.property, primaryMeta.properties ?? null);
    const activeB = resolveActiveProperty(referenceBlob.data.properties, view.property, referenceMeta.properties ?? null);
    if (activeA.values && activeB.values) {
      deltaValues = computeDelta(activeA.values, activeB.values, primaryMeta.n_points);
    }
  }

  if (!deltaValues) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        No property values logged on this cloud to diff — pick a property, or use "Diff: position" instead.
      </div>
    );
  }

  const { colors, domain } = diffColors(deltaValues, primaryMeta.n_points, diffColormap);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1">
        <PointCloudViewer
          data={primaryBlob.data.data}
          channels={primaryMeta.channels}
          nPoints={primaryMeta.n_points}
          bounds={primaryMeta.bounds}
          colorMode={view.colorMode}
          pointSize={view.pointSize}
          background={view.background}
          sync={view.sync}
          overrideColors={colors}
        />
      </div>
      <Colorbar colormap={diffColormap} min={domain[0]} max={domain[1]} />
    </div>
  );
}

export default function PointCloudCard({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<PointCloudSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      makeDefaults: (seed, metrics) => ({
        ...DEFAULT_SETTINGS(seed),
        metrics,
      }),
    });

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  // Resolved once per card so every pane (single or multi) shares the same
  // sync group; `null` when the toggle is off.
  const cameraGroupId = useCameraSync(!!settings.syncViews);

  const view: ViewConfig = {
    pointSize: settings.pointSize,
    colorMode: settings.colorMode,
    background: settings.background,
    sync: cameraGroupId ? { groupId: cameraGroupId } : null,
    property: settings.property ?? null,
  };

  // Single-metric path: fetch points for the step slider.
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 500,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  // Multi-metric: fetch all sequences to determine max step count.
  const multiQueries = useQueries({
    queries:
      effectiveMetrics.length > 1
        ? effectiveMetrics.map((m) => {
            const rid = m.runId ?? runId;
            return {
              queryKey: qk.sequence(rid, m.name, m.context_hash),
              queryFn: () =>
                api.sequence(rid, m.name, {
                  context: m.context_hash || undefined,
                  maxPoints: 500,
                }),
              refetchInterval: 2_000,
              staleTime: 2_000,
            };
          })
        : [],
  });

  const seriesPoints = useMemo(() => {
    const arr: Array<Array<{ step: number }>> = [points];
    if (effectiveMetrics.length > 1) {
      for (const mq of multiQueries) {
        const pts = (mq.data as SequenceResponse | undefined)?.points ?? [];
        arr.push(pts.filter((p) => p.artifact_hash));
      }
    }
    return arr;
  }, [effectiveMetrics.length, points, multiQueries]);

  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings,
  });

  const current = useMemo(() => {
    const exact = points.find((p) => p.step === currentStep && p.artifact_hash);
    if (exact) return exact;
    let best: (typeof points)[number] | undefined;
    for (const p of points) {
      if (p.step <= currentStep && p.artifact_hash) best = p;
      else if (p.step > currentStep) break;
    }
    return best;
  }, [points, currentStep]);

  const meta = useMemo(
    () => safeJsonParse<PointCloudMeta>(current?.artifact_metadata),
    [current],
  );

  const topBlob = usePointCloudBlob(current?.artifact_hash ?? undefined);
  const propertyOptions = useMemo(() => propertyNames(topBlob.data?.properties), [topBlob.data]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );

  const runMetaVersion = useRunMetadataVersion();

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();
  const { runInfoMap } = useRunInfo(allRunIds);

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : meta
        ? `${meta.n_points.toLocaleString()} pts · ${meta.channels}`
        : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
  const isCompareEligible = effectiveMetrics.length === 2;
  const cardRef = useRef<HTMLDivElement>(null);

  // Cap panes (each is its own WebGL context).
  const shownMetrics = useMemo(
    () => effectiveMetrics.slice(0, MAX_PANES),
    [effectiveMetrics],
  );
  const paneKeys = useMemo(() => shownMetrics.map(seriesKey), [shownMetrics]);
  const paneLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) {
      for (const m of shownMetrics) {
        map.set(seriesKey(m), shortRunLabel(m.runId ?? runId, allRunIds));
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multipleRuns, shownMetrics, allRunIds, runId, runMetaVersion]);

  const referenceMetaForCompare = useCompareReferenceMeta<PointCloudMeta>(
    isCompareEligible ? (multiQueries[1]?.data as SequenceResponse | undefined) : undefined,
    settings.refFixedStep,
    currentStep,
  );
  const compareTopologyOk = !!meta && !!referenceMetaForCompare && meta.n_points === referenceMetaForCompare.n_points;

  const renderSingle = () => {
    if (q.isLoading) {
      return <div className="flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    return (
      <>
        <PointCloudBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} fill />
        <StepSlider
          points={points}
          currentIndex={safeIdx}
          onChange={onSliderChange}
          xAxis={settings.xAxis}
          onXAxisChange={(m) => updateSettings({ xAxis: m })}
          className="mt-3"
        />
      </>
    );
  };

  const renderMulti = (inModal: boolean) => (
    <>
      {effectiveMetrics.length > MAX_PANES && (
        <div className="mono mb-2 text-xs text-fg-subtle">
          {`showing ${MAX_PANES} of ${effectiveMetrics.length}`}
        </div>
      )}
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={paneLabels}
        inModal={inModal}
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => updateSettings({ paneWidths: w })}
        renderPane={(key, i) => {
          const m = shownMetrics[i]!;
          return (
            <PointCloudPane
              key={key}
              runId={runId}
              m={m}
              targetStep={currentStep}
              view={view}
            />
          );
        }}
      />
      <StepSlider
        points={points}
        currentIndex={safeIdx}
        onChange={onSliderChange}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => updateSettings({ xAxis: m })}
        className="mt-3"
      />
      <SeriesChipStrip
        metrics={effectiveMetrics}
        controlledSeries={controlledSeries}
        runId={runId}
        allRunIds={allRunIds}
        onMetricsChange={(next) => updateSettings({ metrics: next })}
        onClick={multipleRuns ? toggle : undefined}
        selectedIds={selectedIds}
      />
    </>
  );

  const renderCompare = () => (
    <>
      <PointCloudComparePanel
        runId={runId}
        primaryMetric={shownMetrics[0]!}
        referenceMetric={shownMetrics[1]!}
        currentStep={currentStep}
        view={view}
        settings={settings}
        updateSettings={updateSettings}
      />
      <StepSlider
        points={points}
        currentIndex={safeIdx}
        onChange={onSliderChange}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => updateSettings({ xAxis: m })}
        className="mt-3"
      />
      <SeriesChipStrip
        metrics={effectiveMetrics}
        controlledSeries={controlledSeries}
        runId={runId}
        allRunIds={allRunIds}
        onMetricsChange={(next) => updateSettings({ metrics: next })}
        onClick={multipleRuns ? toggle : undefined}
        selectedIds={selectedIds}
      />
    </>
  );

  const usingCompareMode = isCompareEligible && !!settings.compareMode && settings.compareMode !== "side";

  const renderContent = (inModal: boolean) => {
    if (!isMulti) return renderSingle();
    if (usingCompareMode) return renderCompare();
    return renderMulti(inModal);
  };

  const selectionPanel = !hasSelectionProvider && (
    <RunSelectionPanel
      selectedRunIds={selectedArray}
      allRunIds={allRunIds}
      onClear={clear}
      runInfo={runInfoMap}
      label="Point cloud selection"
    />
  );

  return (
    <CardShell cardKind="pointcloud"
      defaultHeight={380}
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={
        current?.artifact_hash
          ? () =>
              downloadArtifact(
                api.artifactUrl(current.artifact_hash!),
                artifactFilename(metric.name, current.step, current.artifact_mime, ".npy"),
              )
          : undefined
      }
      addToComparisonSlot={<AddToComparisonButton cardType="pointcloud" series={compSeries} />}
      // 3D cards have no cheap "has the camera moved" signal (orbit controls
      // fire continuously), so the reset button is always shown rather than
      // gated on a tracked modified flag — dblclick-to-refit already behaves
      // this way (always available), and this just surfaces it in the header.
      onResetView={() => resetScene3DViews(cardRef.current)}
      viewModified
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      selectionPanel={selectionPanel}
      settingsPanel={
        <>
          <Slider
            label="Point size"
            value={settings.pointSize}
            onChange={(v) => updateSettings({ pointSize: v })}
            min={0.5}
            max={8}
            step={0.5}
            format={(v) => v.toFixed(1)}
            description="Point radius in pixels"
          />
          <Select
            label="Color mode"
            value={settings.colorMode}
            onChange={(v) => updateSettings({ colorMode: v })}
            options={COLOR_MODE_OPTIONS}
            description="Falls back to an available channel when the chosen one is absent"
          />
          <PropertySelector
            properties={propertyOptions}
            value={settings.property ?? null}
            onChange={(p) => updateSettings({ property: p })}
          />
          <Select
            label="Background"
            value={settings.background}
            onChange={(v) => updateSettings({ background: v })}
            options={BACKGROUND_OPTIONS}
          />
          <Toggle
            label="Sync 3D views"
            checked={!!settings.syncViews}
            onChange={(v) => updateSettings({ syncViews: v })}
            description="Share orbit/zoom/pan live with this card's other panes and any other sync-enabled 3D card on this page"
          />
          {isCompareEligible && (
            <CompareSettingsPanel<PointCloudCompareMode>
              mode={(settings.compareMode ?? "side") as PointCloudCompareMode}
              onModeChange={(v) => updateSettings({ compareMode: v })}
              nativeModes={NATIVE_COMPARE_MODES}
              topologyOk={compareTopologyOk}
              topologyHint="Native diff modes need the same point count — disabled for this pair"
              diffColormap={settings.diffColormap ?? "viridis"}
              onDiffColormapChange={(v) => updateSettings({ diffColormap: v })}
              diffSubmode={settings.diffSubmode ?? "signed"}
              onDiffSubmodeChange={(v) => updateSettings({ diffSubmode: v })}
              splitPosition={settings.splitPosition ?? 0.5}
              onSplitPositionChange={(v) => updateSettings({ splitPosition: v })}
              blendAlpha={settings.blendAlpha ?? 0.5}
              onBlendAlphaChange={(v) => updateSettings({ blendAlpha: v })}
              refFixedStep={settings.refFixedStep}
              onRefFixedStepChange={(v) => updateSettings({ refFixedStep: v })}
              currentStep={currentStep}
              maxStep={Math.max(...globalSteps, 1)}
            />
          )}
        </>
      }
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex flex-col h-full">{renderContent(true)}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>{renderContent(false)}</>
    </CardShell>
  );
}

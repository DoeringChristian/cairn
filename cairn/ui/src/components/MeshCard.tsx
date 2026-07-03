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
  type BaseCardSettings,
} from "./card-kit";
import { parseNpz, Colorbar } from "../lib/cairn-plot";
import MeshViewer, {
  resolveMeshColorMode,
  type MeshColorMode,
  type MeshShading,
  type MeshBackground,
} from "../lib/cairn-plot/three/MeshViewer";
import type { Scene3DSyncOptions } from "../lib/cairn-plot/three/use-scene3d";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import Select from "./settings/Select";
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

interface MeshMeta {
  n_vertices: number;
  n_faces: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  has_colors: boolean;
  has_normals: boolean;
  value_range?: { min: number; max: number; mean: number };
  size_bytes: number;
}

interface MeshSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
  colorMode: MeshColorMode;
  shading: MeshShading;
  wireframe: boolean;
  doubleSided: boolean;
  background: MeshBackground;
  /**
   * Live camera sync across this card's panes and any other sync-enabled 3D
   * card on the page. Optional/absent = false — see `lib/camera-sync.ts`.
   */
  syncViews?: boolean;
}

const DEFAULT_SETTINGS = (seed: { name: string; context_hash: string }): MeshSettings => ({
  version: 1,
  metrics: [seed],
  colorMode: "solid",
  shading: "smooth",
  wireframe: false,
  doubleSided: false,
  background: "dark",
});

const MAX_PANES = 4;

const COLOR_MODE_OPTIONS: Array<{ value: MeshColorMode; label: string }> = [
  { value: "solid", label: "Solid" },
  { value: "vertex-colors", label: "Vertex colors" },
  { value: "values", label: "Values (viridis)" },
];

const SHADING_OPTIONS: Array<{ value: MeshShading; label: string }> = [
  { value: "smooth", label: "Smooth" },
  { value: "flat", label: "Flat" },
];

const BACKGROUND_OPTIONS: Array<{ value: MeshBackground; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

interface MeshArrays {
  positions: Float32Array;
  faces: Uint32Array;
  values: Float32Array | null;
  colors: Float32Array | null;
  normals: Float32Array | null;
}

/** Fetch + parse the .npz mesh blob for a given artifact hash. */
function useMeshBlob(hash: string | undefined) {
  return useQuery({
    queryKey: ["mesh-npz", hash],
    enabled: !!hash,
    staleTime: Infinity,
    queryFn: async (): Promise<MeshArrays> => {
      const res = await fetch(api.artifactUrl(hash!));
      if (!res.ok) throw new Error(`failed to fetch mesh (${res.status})`);
      const npz = await parseNpz(await res.arrayBuffer());
      if (!npz.positions || !npz.faces) {
        throw new Error("mesh blob missing positions/faces");
      }
      return {
        positions: Float32Array.from(npz.positions.data),
        faces: Uint32Array.from(npz.faces.data),
        values: npz.values ? Float32Array.from(npz.values.data) : null,
        colors: npz.colors ? Float32Array.from(npz.colors.data) : null,
        normals: npz.normals ? Float32Array.from(npz.normals.data) : null,
      };
    },
  });
}

interface ViewConfig {
  colorMode: MeshColorMode;
  shading: MeshShading;
  wireframe: boolean;
  doubleSided: boolean;
  background: MeshBackground;
  /** Resolved live camera-sync group, or `null` when sync is off for this card. */
  sync: Scene3DSyncOptions | null;
}

/** Renders a single resolved mesh point (blob + metadata). */
function MeshBody({
  hash,
  meta,
  view,
}: {
  hash: string | undefined;
  meta: MeshMeta | null | undefined;
  view: ViewConfig;
}) {
  const blob = useMeshBlob(hash);

  if (!hash) {
    return <div className="text-sm text-fg-muted">no mesh logged yet</div>;
  }
  if (blob.isLoading) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (blob.isError || !blob.data || !meta) {
    return <div className="text-sm text-fg-muted">failed to load mesh</div>;
  }

  const nVertices = meta.n_vertices ?? blob.data.positions.length / 3;
  const nFaces = meta.n_faces ?? blob.data.faces.length / 3;
  const resolvedMode = resolveMeshColorMode(view.colorMode, !!blob.data.colors, !!blob.data.values);

  return (
    <div className="flex flex-col">
      <div className="flex h-64 overflow-hidden rounded bg-bg">
        <div className="min-w-0 flex-1">
          <MeshViewer
            positions={blob.data.positions}
            faces={blob.data.faces}
            nVertices={nVertices}
            nFaces={nFaces}
            values={blob.data.values}
            valueRange={meta.value_range ? [meta.value_range.min, meta.value_range.max] : null}
            colors={blob.data.colors}
            normals={blob.data.normals}
            bounds={meta.bounds}
            colorMode={view.colorMode}
            shading={view.shading}
            wireframe={view.wireframe}
            doubleSided={view.doubleSided}
            background={view.background}
            sync={view.sync}
          />
        </div>
        {resolvedMode === "values" && meta.value_range && (
          <Colorbar colormap="viridis" min={meta.value_range.min} max={meta.value_range.max} />
        )}
      </div>
      <div className="mono mt-1 text-xs text-fg-subtle">
        {`${nVertices.toLocaleString()} verts · ${nFaces.toLocaleString()} faces`}
        {" · double-click to re-fit"}
      </div>
    </div>
  );
}

/** A pane in the multi-run grid: fetches its own sequence + blob at the step. */
function MeshPane({
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
    () => safeJsonParse<MeshMeta>(current?.artifact_metadata),
    [current],
  );

  if (q.isLoading) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  return (
    <div className="rounded bg-bg p-2">
      <MeshBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} />
    </div>
  );
}

export default function MeshCard({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<MeshSettings>({
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
    colorMode: settings.colorMode,
    shading: settings.shading,
    wireframe: settings.wireframe,
    doubleSided: settings.doubleSided,
    background: settings.background,
    sync: cameraGroupId ? { groupId: cameraGroupId } : null,
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
    () => safeJsonParse<MeshMeta>(current?.artifact_metadata),
    [current],
  );

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
        ? `${meta.n_vertices.toLocaleString()} verts · ${meta.n_faces.toLocaleString()} faces`
        : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
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

  const renderSingle = () => {
    if (q.isLoading) {
      return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    return (
      <>
        <MeshBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} />
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
            <MeshPane
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

  const renderContent = (inModal: boolean) =>
    isMulti ? renderMulti(inModal) : renderSingle();

  const selectionPanel = !hasSelectionProvider && (
    <RunSelectionPanel
      selectedRunIds={selectedArray}
      allRunIds={allRunIds}
      onClear={clear}
      runInfo={runInfoMap}
      label="Mesh selection"
    />
  );

  return (
    <CardShell
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
                artifactFilename(metric.name, current.step, current.artifact_mime, ".npz"),
              )
          : undefined
      }
      addToComparisonSlot={<AddToComparisonButton cardType="mesh" series={compSeries} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      selectionPanel={selectionPanel}
      settingsPanel={
        <>
          <Select
            label="Color mode"
            value={settings.colorMode}
            onChange={(v) => updateSettings({ colorMode: v })}
            options={COLOR_MODE_OPTIONS}
            description="Falls back to an available attribute when the chosen one is absent"
          />
          <Select
            label="Shading"
            value={settings.shading}
            onChange={(v) => updateSettings({ shading: v })}
            options={SHADING_OPTIONS}
          />
          <Toggle
            label="Wireframe overlay"
            checked={settings.wireframe}
            onChange={(v) => updateSettings({ wireframe: v })}
            description="Draw triangle edges on top of the filled surface"
          />
          <Toggle
            label="Double-sided"
            checked={settings.doubleSided}
            onChange={(v) => updateSettings({ doubleSided: v })}
            description="Render backfaces (useful for open/non-manifold meshes)"
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

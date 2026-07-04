import { useCallback, useMemo, useRef, useState } from "react";
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
import type { SequenceMeta, SequencePoint, SequenceResponse } from "../api/types";
import {
  useCardSeries,
  useStepSlider,
  resolveAtStep,
  useRunInfo,
  MultiPaneGrid,
  PropertySelector,
  useMediaReference,
  useReferenceDrop,
  useCompareReferenceMeta,
  OffscreenComparePanes,
  CompareSettingsPanel,
  type BaseCardSettings,
} from "./card-kit";
// Deep-import from cairn-plot/three/ (NOT the main cairn-plot barrel) so
// three.js + the raymarch shader stay isolated to this lazy card chunk.
import VolumeViewer, {
  type VolumeRenderMode,
  type VolumeQuality,
  type VolumeBackground,
} from "../lib/cairn-plot/three/VolumeViewer";
import { parseNpz } from "../lib/cairn-plot/transforms/parse-npz";
import {
  Colorbar,
  isCoreCompareMode,
  resolveArtifactAtStep,
  type ColormapName,
  type MediaCompareMode,
  type DiffMode,
  type Colormap,
} from "../lib/cairn-plot";
import { resetScene3DViews, type Scene3DSyncOptions } from "../lib/cairn-plot/three/use-scene3d";
import type { PropertyMeta } from "../lib/cairn-plot/three/properties";
import { computeDelta, diffDomain, absArray, type DiffColormap } from "../lib/cairn-plot/three/diff";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import type { SeriesRef } from "./SeriesChip";
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

interface VolumeMeta {
  shape: [number, number, number]; // [D, H, W]
  dtype: string;
  vmin: number;
  vmax: number;
  mean: number;
  spacing: [number, number, number];
  origin: [number, number, number];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  properties?: PropertyMeta[];
  size_bytes: number;
}

/** Extension point usage: volume's one native mode ("diff-value" — a
 *  signed per-voxel diff volume, raymarched through the SAME shader as
 *  every other volume render), appended via `MediaCompareMode<TExtra>`. */
type VolumeCompareMode = MediaCompareMode<"diff-value">;

interface VolumeSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
  mode: VolumeRenderMode;
  /** Isosurface threshold, normalized [0,1] as a fraction of [vmin,vmax]. */
  isovalue: number;
  colormap: ColormapName;
  steps: VolumeQuality;
  /** Per-axis clip box, normalized [0,1] in texture space (x=W,y=H,z=D). */
  clipMin: [number, number, number];
  clipMax: [number, number, number];
  background: VolumeBackground;
  /**
   * Live camera sync across this card's panes and any other sync-enabled 3D
   * card on the page. Optional/absent = false — see `lib/camera-sync.ts`.
   */
  syncViews?: boolean;
  /** Volume has a single implicit scalar field — kept for API consistency
   *  with the other 3 types' Property selector (always a no-op here, see
   *  `cairn/sdk/handlers/volume.py`'s `properties` metadata note). */
  property?: string;
  compareMode?: VolumeCompareMode;
  diffColormap?: DiffColormap;
  diffSubmode?: DiffMode;
  splitPosition?: number;
  blendAlpha?: number;
  /** Pins the default (no external reference) series[1] baseline to one
   *  step instead of tracking the primary's current step 1:1 — ignored
   *  once `externalBaseline` is set. */
  refFixedStep?: number;
  /** A reference dragged in from elsewhere — see MeshSettings'
   *  `externalBaseline` for the full writeup (identical mechanics). */
  externalBaseline?: { runId?: string; name: string; context_hash: string };
  /** "per-run" (drag a series chip) vs "global" (drag a viewport). */
  referenceMode?: "global" | "per-run";
}

const DEFAULT_SETTINGS = (seed: { name: string; context_hash: string }): VolumeSettings => ({
  version: 1,
  metrics: [seed],
  mode: "mip",
  isovalue: 0.5,
  colormap: "viridis",
  steps: 128,
  clipMin: [0, 0, 0],
  clipMax: [1, 1, 1],
  background: "dark",
});

const MAX_PANES = 4;

const MODE_OPTIONS: Array<{ value: VolumeRenderMode; label: string }> = [
  { value: "mip", label: "MIP (max-intensity projection)" },
  { value: "iso", label: "Isosurface" },
];

const COLORMAP_OPTIONS: Array<{ value: ColormapName; label: string }> = [
  { value: "viridis", label: "Viridis" },
  { value: "red-blue", label: "Red–Blue" },
  { value: "red-green", label: "Red–Green" },
];

const QUALITY_OPTIONS: Array<{ value: "64" | "128" | "256"; label: string }> = [
  { value: "64", label: "64 steps (fast)" },
  { value: "128", label: "128 steps" },
  { value: "256", label: "256 steps (fine)" },
];

const BACKGROUND_OPTIONS: Array<{ value: VolumeBackground; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

// Volume's one native per-type compare kind (core kinds + shared
// diff-colormap/submode/slider controls live in CompareSettingsPanel).
const NATIVE_COMPARE_MODES: Array<{ value: VolumeCompareMode; label: string }> = [
  { value: "diff-value", label: "Diff: value (native)" },
];

/** Fetch + parse the .npz volume blob (member "data") for a given artifact hash. */
function useVolumeBlob(hash: string | undefined) {
  return useQuery({
    queryKey: ["volume-npz", hash],
    enabled: !!hash,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(api.artifactUrl(hash!));
      if (!res.ok) throw new Error(`failed to fetch volume (${res.status})`);
      const npz = await parseNpz(await res.arrayBuffer());
      if (!npz.data) throw new Error("volume artifact is missing its 'data' array");
      // The shared parser returns Float64Array for uniform downstream math;
      // three.js Data3DTexture needs Float32Array, so narrow once here.
      return Float32Array.from(npz.data.data);
    },
  });
}

interface ViewConfig {
  mode: VolumeRenderMode;
  isovalue: number;
  colormap: ColormapName;
  steps: VolumeQuality;
  clipMin: [number, number, number];
  clipMax: [number, number, number];
  background: VolumeBackground;
  /** Resolved live camera-sync group, or `null` when sync is off for this card. */
  sync: Scene3DSyncOptions | null;
}

/** Renders a single resolved volume (blob + metadata). */
function VolumeBody({
  hash,
  meta,
  view,
}: {
  hash: string | undefined;
  meta: VolumeMeta | null | undefined;
  view: ViewConfig;
}) {
  const blob = useVolumeBlob(hash);

  if (!hash) {
    return <div className="text-sm text-fg-muted">no volume logged yet</div>;
  }
  if (blob.isLoading) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (blob.isError || !blob.data || !meta) {
    return <div className="text-sm text-fg-muted">failed to load volume</div>;
  }

  return (
    <div className="flex flex-col">
      <div className="flex h-64">
        <div className="min-w-0 flex-1 overflow-hidden rounded bg-bg">
          <VolumeViewer
            data={blob.data}
            shape={meta.shape}
            spacing={meta.spacing}
            origin={meta.origin}
            vmin={meta.vmin}
            vmax={meta.vmax}
            mode={view.mode}
            isovalue={view.isovalue}
            colormap={view.colormap}
            steps={view.steps}
            clip={{ min: view.clipMin, max: view.clipMax }}
            background={view.background}
            sync={view.sync}
          />
        </div>
        <Colorbar colormap={view.colormap} min={meta.vmin} max={meta.vmax} />
      </div>
      <div className="mono mt-1 text-xs text-fg-subtle">
        {`${meta.shape.join("×")} · vmin ${meta.vmin.toFixed(3)} · vmax ${meta.vmax.toFixed(3)}`}
        {" · double-click to re-fit"}
      </div>
    </div>
  );
}

/** A pane in the multi-run grid: fetches its own sequence + blob at the step. */
function VolumePane({
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
    () => safeJsonParse<VolumeMeta>(current?.artifact_metadata),
    [current],
  );

  if (q.isLoading) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  return (
    <div className="rounded bg-bg p-2">
      <VolumeBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} />
    </div>
  );
}

/** ONE non-baseline pane's comparison — see MeshCard's `MeshComparePane`
 *  for the full pattern writeup (identical mechanics, volume-specific diff
 *  math: the signed voxel delta is raymarched through the SAME
 *  `VolumeViewer` shader, not a bespoke diff renderer). `primaryHash`/
 *  `primaryMeta` are resolved by the orchestrator (`VolumeComparePanel`,
 *  below). */
function VolumeComparePane({
  runId,
  primaryHash,
  primaryMeta,
  referenceTag,
  referenceHash,
  mode,
  view,
  settings,
  updateSettings,
  paneLabel,
}: {
  runId: string;
  primaryHash: string | undefined;
  primaryMeta: VolumeMeta | null | undefined;
  referenceTag: { runId?: string; name: string; context_hash: string };
  referenceHash: string | undefined;
  mode: VolumeCompareMode;
  view: ViewConfig;
  settings: VolumeSettings;
  updateSettings: (patch: Partial<VolumeSettings>) => void;
  paneLabel: string;
}) {
  const referenceQ = useSequence(referenceTag.runId ?? runId, referenceTag.name, {
    context: referenceTag.context_hash || undefined,
    maxPoints: 500,
  });
  const referencePoint = useMemo(
    () => (referenceQ.data?.points ?? []).find((p) => p.artifact_hash === referenceHash),
    [referenceQ.data, referenceHash],
  );
  const referenceMeta = useMemo(() => safeJsonParse<VolumeMeta>(referencePoint?.artifact_metadata), [referencePoint]);

  const primaryBlob = useVolumeBlob(primaryHash);
  const referenceBlob = useVolumeBlob(referenceHash);

  if (mode === "normal") {
    return <VolumeBody hash={primaryHash} meta={primaryMeta} view={view} />;
  }

  if (!primaryBlob.data || !referenceBlob.data || !primaryMeta || !referenceMeta) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }

  if (isCoreCompareMode(mode) && (mode === "split" || mode === "blend" || mode === "diff")) {
    return (
      <div className="h-64 overflow-hidden rounded bg-bg">
        <OffscreenComparePanes
          mode={mode}
          renderPrimary={(onFrame, sync) => (
            <VolumeViewer
              data={primaryBlob.data!}
              shape={primaryMeta.shape}
              spacing={primaryMeta.spacing}
              origin={primaryMeta.origin}
              vmin={primaryMeta.vmin}
              vmax={primaryMeta.vmax}
              mode={view.mode}
              isovalue={view.isovalue}
              colormap={view.colormap}
              steps={view.steps}
              clip={{ min: view.clipMin, max: view.clipMax }}
              background={view.background}
              sync={sync}
              onFrame={onFrame}
            />
          )}
          renderReference={(onFrame, sync) => (
            <VolumeViewer
              data={referenceBlob.data!}
              shape={referenceMeta.shape}
              spacing={referenceMeta.spacing}
              origin={referenceMeta.origin}
              vmin={referenceMeta.vmin}
              vmax={referenceMeta.vmax}
              mode={view.mode}
              isovalue={view.isovalue}
              colormap={view.colormap}
              steps={view.steps}
              clip={{ min: view.clipMin, max: view.clipMax }}
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
          primaryLabel={paneLabel}
        />
      </div>
    );
  }

  // Native mode: diff-value — same voxel SHAPE required (elementwise diff).
  const topologyOk =
    primaryMeta.shape[0] === referenceMeta.shape[0] &&
    primaryMeta.shape[1] === referenceMeta.shape[1] &&
    primaryMeta.shape[2] === referenceMeta.shape[2];
  if (!topologyOk) {
    return (
      <div className="flex h-64 items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        Shape mismatch: {primaryMeta.shape.join("×")} vs {referenceMeta.shape.join("×")} — native
        diff needs matching voxel grid shape.
      </div>
    );
  }

  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";
  const n = primaryMeta.shape[0] * primaryMeta.shape[1] * primaryMeta.shape[2];
  const delta = computeDelta(primaryBlob.data, referenceBlob.data, n);
  const domain = diffDomain(delta, diffColormap);
  const diffData = diffColormap === "viridis" ? absArray(delta) : delta;

  return (
    <div className="flex h-64 overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1 overflow-hidden rounded bg-bg">
        <VolumeViewer
          data={diffData}
          shape={primaryMeta.shape}
          spacing={primaryMeta.spacing}
          origin={primaryMeta.origin}
          vmin={domain[0]}
          vmax={domain[1]}
          mode={view.mode}
          isovalue={view.isovalue}
          colormap={diffColormap}
          steps={view.steps}
          clip={{ min: view.clipMin, max: view.clipMax }}
          background={view.background}
          sync={view.sync}
        />
      </div>
      <Colorbar colormap={diffColormap} min={domain[0]} max={domain[1]} />
    </div>
  );
}

/** N-run compare orchestrator — see MeshCard's `MeshComparePanel` for the
 *  full pattern writeup (identical mechanics, volume-specific pane). */
function VolumeComparePanel({
  runId,
  panes,
  paneKeys,
  paneLabels,
  perSeriesStepMap,
  perSeriesPoints,
  currentStep,
  safeIdx,
  view,
  settings,
  updateSettings,
  inModal,
}: {
  runId: string;
  panes: Array<{ runId?: string; name: string; context_hash: string }>;
  paneKeys: string[];
  paneLabels: Map<string, string>;
  perSeriesStepMap: Map<number, SequencePoint>[];
  perSeriesPoints: SequencePoint[][];
  currentStep: number;
  safeIdx: number;
  view: ViewConfig;
  settings: VolumeSettings;
  updateSettings: (patch: Partial<VolumeSettings>) => void;
  inModal: boolean;
}) {
  const extBase = settings.externalBaseline;
  const refMode = settings.referenceMode ?? "global";
  const hasExternalRef = extBase != null;

  const { perPaneHash } = useMediaReference({
    runId,
    perSeriesStepMap,
    perSeriesPoints,
    seriesBaselineIndex: hasExternalRef ? undefined : (panes.length >= 2 ? 1 : undefined),
    seriesBaselineFixedStep: settings.refFixedStep,
    external: extBase,
    externalScope: refMode,
    panes,
    currentStep,
    safeIdx,
  });

  const comparedIdx = panes
    .map((_, idx) => idx)
    .filter((idx) => {
      if (hasExternalRef && refMode === "global" && extBase &&
          panes[idx]!.name === extBase.name && (panes[idx]!.runId ?? runId) === (extBase.runId ?? runId)) {
        return false;
      }
      if (!hasExternalRef && idx === 1) return false;
      return true;
    });

  const mode: VolumeCompareMode = settings.compareMode ?? "side";
  const comparePaneKeys = comparedIdx.map((idx) => paneKeys[idx]!);
  const dragTags = new Map(
    comparedIdx.map((idx) => [
      paneKeys[idx]!,
      { runId: panes[idx]!.runId ?? runId, name: panes[idx]!.name, context_hash: panes[idx]!.context_hash },
    ]),
  );

  return (
    <MultiPaneGrid
      paneKeys={comparePaneKeys}
      labels={paneLabels}
      inModal={inModal}
      onPaneWidthsChange={() => { /* compare-pane widths not persisted (equal split) */ }}
      dragTags={dragTags}
      renderPane={(_key, i) => {
        const idx = comparedIdx[i]!;
        const primaryStepMap = perSeriesStepMap[idx] ?? new Map();
        const primarySteps = (perSeriesPoints[idx] ?? []).map((p) => p.step);
        const { hash: primaryHash } = resolveArtifactAtStep(primaryStepMap, currentStep, primarySteps);
        const primaryPoint = (perSeriesPoints[idx] ?? []).find((p) => p.artifact_hash === primaryHash);
        const primaryMeta = safeJsonParse<VolumeMeta>(primaryPoint?.artifact_metadata);
        const referenceHash = perPaneHash(idx);
        const referenceTag = hasExternalRef
          ? (refMode === "per-run"
              ? { runId: panes[idx]!.runId ?? runId, name: extBase!.name, context_hash: extBase!.context_hash }
              : { runId: extBase!.runId ?? runId, name: extBase!.name, context_hash: extBase!.context_hash })
          : { runId: panes[1]!.runId ?? runId, name: panes[1]!.name, context_hash: panes[1]!.context_hash };
        return (
          <VolumeComparePane
            key={paneKeys[idx]}
            runId={runId}
            primaryHash={primaryHash}
            primaryMeta={primaryMeta}
            referenceTag={referenceTag}
            referenceHash={referenceHash}
            mode={mode}
            view={view}
            settings={settings}
            updateSettings={updateSettings}
            paneLabel={panes[idx]!.name}
          />
        );
      }}
    />
  );
}

export default function VolumeCard({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<VolumeSettings>({
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

  // Reference drop target — see MeshCard's identical wiring for the full
  // writeup. Dropping a series chip -> per-run; dropping a viewport label
  // -> global. Always lands on "diff".
  const applyReference = useCallback((ref: SeriesRef, mode: "global" | "per-run") => {
    updateSettings({
      externalBaseline: { runId: ref.runId, name: ref.name, context_hash: ref.context_hash },
      referenceMode: mode,
      compareMode: "diff",
    });
  }, [updateSettings]);
  const { highlight: refDropHighlight, dropProps: refDropProps } = useReferenceDrop({
    onSeriesDrop: (ref) => applyReference(ref, "per-run"),
    onViewportDrop: (ref) => applyReference(ref, "global"),
  });

  // Resolved once per card so every pane (single or multi) shares the same
  // sync group; `null` when the toggle is off.
  const cameraGroupId = useCameraSync(!!settings.syncViews);

  const view: ViewConfig = {
    mode: settings.mode,
    isovalue: settings.isovalue,
    colormap: settings.colormap,
    steps: settings.steps,
    clipMin: settings.clipMin,
    clipMax: settings.clipMax,
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

  // Per-series full points/step-maps, index-aligned with `effectiveMetrics`/
  // `shownMetrics` — see MeshCard's identical derivation for the writeup.
  const perSeriesPoints = useMemo<SequencePoint[][]>(() => {
    if (effectiveMetrics.length <= 1) return [points];
    return multiQueries.map((mq) =>
      ((mq.data as SequenceResponse | undefined)?.points ?? []).filter((p) => p.artifact_hash),
    );
  }, [effectiveMetrics.length, points, multiQueries]);
  const perSeriesStepMap = useMemo(
    () =>
      perSeriesPoints.map((pts) => {
        const m = new Map<number, SequencePoint>();
        for (const p of pts) m.set(p.step, p);
        return m;
      }),
    [perSeriesPoints],
  );

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
    () => safeJsonParse<VolumeMeta>(current?.artifact_metadata),
    [current],
  );

  // Volume always carries exactly one implicit "value" property (see
  // `cairn/sdk/handlers/volume.py`) — this resolves to a 1-element list, so
  // the shared `PropertySelector` (shown only when >1 property) renders
  // nothing, same as every other single-property artifact.
  const propertyOptions = useMemo(() => (meta?.properties ?? []).map((p) => p.name), [meta]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );

  const runMetaVersion = useRunMetadataVersion();

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();
  const { runInfoMap } = useRunInfo(allRunIds);

  const subtitle = meta
    ? `${meta.shape.join("×")} · spacing [${meta.spacing.map((s) => s.toFixed(2)).join(", ")}]`
    : `${metric.count} step${metric.count !== 1 ? "s" : ""}`;

  const hasExternalRef = settings.externalBaseline != null;
  const isMulti = effectiveMetrics.length > 1 || hasExternalRef;
  const isCompareEligible = hasExternalRef || effectiveMetrics.length >= 2;
  const cardRef = useRef<HTMLDivElement>(null);

  // Cap panes (each is its own WebGL context + a heavy 3D texture).
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

  // "Viewport label" drag source for every labelled pane — see MeshCard's
  // identical derivation for the writeup.
  const paneDragTags = useMemo(() => {
    const map = new Map<string, SeriesRef>();
    for (const m of shownMetrics) {
      const key = seriesKey(m);
      if (paneLabels.has(key)) {
        map.set(key, { runId: m.runId ?? runId, name: m.name, context_hash: m.context_hash });
      }
    }
    return map;
  }, [shownMetrics, paneLabels, runId]);

  const referenceMetaForCompare = useCompareReferenceMeta<VolumeMeta>(
    !hasExternalRef && isCompareEligible ? (multiQueries[1]?.data as SequenceResponse | undefined) : undefined,
    settings.refFixedStep,
    currentStep,
  );
  const compareTopologyOk =
    hasExternalRef ||
    (!!meta &&
      !!referenceMetaForCompare &&
      meta.shape[0] === referenceMetaForCompare.shape[0] &&
      meta.shape[1] === referenceMetaForCompare.shape[1] &&
      meta.shape[2] === referenceMetaForCompare.shape[2]);

  const renderSingle = () => {
    if (q.isLoading) {
      return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    return (
      <>
        <VolumeBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} />
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
        dragTags={paneDragTags}
        renderPane={(key, i) => {
          const m = shownMetrics[i]!;
          return (
            <VolumePane
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

  const renderCompare = (inModal: boolean) => (
    <>
      <VolumeComparePanel
        runId={runId}
        panes={shownMetrics}
        paneKeys={paneKeys}
        paneLabels={paneLabels}
        perSeriesStepMap={perSeriesStepMap}
        perSeriesPoints={perSeriesPoints}
        currentStep={currentStep}
        safeIdx={safeIdx}
        view={view}
        settings={settings}
        updateSettings={updateSettings}
        inModal={inModal}
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
    if (usingCompareMode) return renderCompare(inModal);
    return renderMulti(inModal);
  };

  const selectionPanel = !hasSelectionProvider && (
    <RunSelectionPanel
      selectedRunIds={selectedArray}
      allRunIds={allRunIds}
      onClear={clear}
      runInfo={runInfoMap}
      label="Volume selection"
    />
  );

  // Clip-axis updates: min never exceeds max and vice versa (clamped inline
  // rather than via a dedicated dual-range slider component, since none
  // exists in this codebase yet — see spec's "6 sliders" alternative).
  const setClipMin = (axis: 0 | 1 | 2, v: number) => {
    const next: [number, number, number] = [...settings.clipMin];
    next[axis] = Math.min(v, settings.clipMax[axis]);
    updateSettings({ clipMin: next });
  };
  const setClipMax = (axis: 0 | 1 | 2, v: number) => {
    const next: [number, number, number] = [...settings.clipMax];
    next[axis] = Math.max(v, settings.clipMin[axis]);
    updateSettings({ clipMax: next });
  };

  return (
    <CardShell cardKind="volume"
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
      addToComparisonSlot={<AddToComparisonButton cardType="volume" series={compSeries} />}
      // Always-on: see PointCloudCard/MeshCard — 3D cards have no cheap
      // "camera moved" signal, so reset-view is always shown.
      onResetView={() => resetScene3DViews(cardRef.current)}
      viewModified
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      selectionPanel={selectionPanel}
      settingsPanel={
        <>
          <Select
            label="Render mode"
            value={settings.mode}
            onChange={(v) => updateSettings({ mode: v })}
            options={MODE_OPTIONS}
          />
          {settings.mode === "iso" && (
            <Slider
              label="Isovalue"
              value={settings.isovalue}
              onChange={(v) => updateSettings({ isovalue: v })}
              min={0}
              max={1}
              step={0.01}
              format={(v) => v.toFixed(2)}
              description="Fraction of the [vmin, vmax] value range"
            />
          )}
          <Select
            label="Colormap"
            value={settings.colormap}
            onChange={(v) => updateSettings({ colormap: v })}
            options={COLORMAP_OPTIONS}
          />
          <PropertySelector
            properties={propertyOptions}
            value={settings.property ?? null}
            onChange={(p) => updateSettings({ property: p })}
          />
          <Select
            label="Quality"
            value={String(settings.steps) as "64" | "128" | "256"}
            onChange={(v) => updateSettings({ steps: Number(v) as VolumeQuality })}
            options={QUALITY_OPTIONS}
            description="Raymarch step count — higher is finer but slower"
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
          <div className="mt-2 border-t border-border-subtle pt-2">
            <div className="mb-1 text-xs font-semibold text-fg-muted">
              Clip box (slices the volume; axes follow the box's local X/Y/Z —
              width/height/depth of the [D,H,W] array)
            </div>
            <Slider label="Clip X min" value={settings.clipMin[0]} onChange={(v) => setClipMin(0, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
            <Slider label="Clip X max" value={settings.clipMax[0]} onChange={(v) => setClipMax(0, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
            <Slider label="Clip Y min" value={settings.clipMin[1]} onChange={(v) => setClipMin(1, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
            <Slider label="Clip Y max" value={settings.clipMax[1]} onChange={(v) => setClipMax(1, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
            <Slider label="Clip Z min" value={settings.clipMin[2]} onChange={(v) => setClipMin(2, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
            <Slider label="Clip Z max" value={settings.clipMax[2]} onChange={(v) => setClipMax(2, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
          </div>
          {isCompareEligible && (
            <CompareSettingsPanel<VolumeCompareMode>
              mode={(settings.compareMode ?? "side") as VolumeCompareMode}
              onModeChange={(v) => updateSettings({ compareMode: v })}
              nativeModes={NATIVE_COMPARE_MODES}
              topologyOk={compareTopologyOk}
              topologyHint="Native diff needs the same voxel grid shape — disabled for this pair"
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
          {isMulti && hasExternalRef && (
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
                <span className="mono truncate flex-1">
                  {settings.externalBaseline.name}
                  {settings.externalBaseline.runId && settings.externalBaseline.runId !== runId
                    ? ` · ${shortRunLabel(settings.externalBaseline.runId, allRunIds)}`
                    : ""}
                </span>
                <button
                  type="button"
                  onClick={() => updateSettings({ externalBaseline: undefined })}
                  className="text-fg-subtle hover:text-fg shrink-0"
                  title="Remove external reference"
                >{"×"}</button>
              </div>
            ) : (
              <p className="text-[10px] text-fg-subtle mb-1">
                Drag a series chip onto the card (per-run), or drag a pane's viewport label onto it (global).
              </p>
            )}
          </div>
        </>
      }
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={
        <div
          className={`flex flex-col h-full${refDropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
          onDragOver={refDropProps.onDragOver}
          onDragLeave={refDropProps.onDragLeave}
          onDrop={refDropProps.onDrop}
        >
          {renderContent(true)}
        </div>
      }
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <div
        className={refDropHighlight ? "outline outline-2 outline-accent -outline-offset-2" : undefined}
        onDragOver={refDropProps.onDragOver}
        onDragLeave={refDropProps.onDragLeave}
        onDrop={refDropProps.onDrop}
      >
        {renderContent(false)}
      </div>
    </CardShell>
  );
}

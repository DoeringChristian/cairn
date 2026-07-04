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
import {
  parseNpz,
  Colorbar,
  isCoreCompareMode,
  resolveArtifactAtStep,
  type MediaCompareMode,
  type DiffMode,
  type Colormap,
} from "../lib/cairn-plot";
import BoxesViewer, {
  type BoxesColorMode,
  type BoxesBackground,
} from "../lib/cairn-plot/three/BoxesViewer";
import { resetScene3DViews, type Scene3DSyncOptions } from "../lib/cairn-plot/three/use-scene3d";
import {
  extractProperties,
  resolveActiveProperty,
  propertyNames,
  type PropertyMeta,
} from "../lib/cairn-plot/three/properties";
import { diffColors, computeDelta, type DiffColormap } from "../lib/cairn-plot/three/diff";
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

interface Boxes3DMeta {
  n_boxes: number;
  max_depth: number;
  kind: "boxes" | "octree" | "bvh";
  bounds: { min: [number, number, number]; max: [number, number, number] };
  value_range?: { min: number; max: number; mean: number };
  properties?: PropertyMeta[];
  size_bytes: number;
}

/** Extension point usage: boxes3d's one native mode, appended via
 *  `MediaCompareMode<TExtra>` (spec-visual-compare.md / ws-VC1-report.md). */
type BoxesCompareMode = MediaCompareMode<"diff-property">;

interface Boxes3DSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
  colorMode: BoxesColorMode;
  background: BoxesBackground;
  depthMin?: number;
  depthMax?: number;
  valueFilterEnabled?: boolean;
  valueMin?: number;
  valueMax?: number;
  /** See PointCloudCard's syncViews — shared live camera-sync toggle. */
  syncViews?: boolean;
  /** Selected named property (Property selector); undefined = first available. */
  property?: string;
  /** 2-series compare mode. Absent/"side" = today's default multi-pane
   *  grid, UNCHANGED. */
  compareMode?: BoxesCompareMode;
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

const DEFAULT_SETTINGS = (seed: { name: string; context_hash: string }): Boxes3DSettings => ({
  version: 1,
  metrics: [seed],
  colorMode: "depth",
  background: "dark",
});

const MAX_PANES = 4;

const COLOR_MODE_OPTIONS: Array<{ value: BoxesColorMode; label: string }> = [
  { value: "depth", label: "Depth" },
  { value: "value", label: "Value (falls back to depth if absent)" },
  { value: "solid", label: "Solid" },
];

const BACKGROUND_OPTIONS: Array<{ value: BoxesBackground; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

// Boxes3D's one native per-type compare kind (core kinds + shared
// diff-colormap/submode/slider controls live in CompareSettingsPanel).
const NATIVE_COMPARE_MODES: Array<{ value: BoxesCompareMode; label: string }> = [
  { value: "diff-property", label: "Diff: property (native)" },
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Fetch + parse the .npz box-hierarchy blob for a given artifact hash. */
function useBoxesBlob(hash: string | undefined) {
  return useQuery({
    queryKey: ["boxes3d-npz", hash],
    enabled: !!hash,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(api.artifactUrl(hash!));
      if (!res.ok) throw new Error(`failed to fetch boxes3d (${res.status})`);
      return parseNpz(await res.arrayBuffer());
    },
  });
}

interface ViewConfig {
  colorMode: BoxesColorMode;
  background: BoxesBackground;
  depthMin?: number;
  depthMax?: number;
  valueFilterEnabled?: boolean;
  valueMin?: number;
  valueMax?: number;
  /** Resolved live camera-sync group, or `null` when sync is off for this card. */
  sync: Scene3DSyncOptions | null;
  property: string | null;
}

/** Renders a single resolved box hierarchy (blob + metadata). */
function BoxesBody({
  hash,
  meta,
  view,
}: {
  hash: string | undefined;
  meta: Boxes3DMeta | null | undefined;
  view: ViewConfig;
}) {
  const blob = useBoxesBlob(hash);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  if (!hash) {
    return <div className="text-sm text-fg-muted">no boxes logged yet</div>;
  }
  if (blob.isLoading) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  const npz = blob.data;
  const mins = npz?.mins?.data;
  const maxs = npz?.maxs?.data;
  const depth = npz?.depth?.data;
  if (blob.isError || !npz || !meta || !mins || !maxs || !depth) {
    return <div className="text-sm text-fg-muted">failed to load boxes</div>;
  }

  const properties = extractProperties(npz);
  const active = resolveActiveProperty(properties, view.property, meta.properties ?? null);
  const hasValues = !!active.values && !!active.range;
  const maxDepth = meta.max_depth;
  const depthMin = clamp(view.depthMin ?? 0, 0, maxDepth);
  const depthMax = clamp(view.depthMax ?? maxDepth, depthMin, maxDepth);
  const valueThreshold: [number, number] | null =
    hasValues && view.valueFilterEnabled && active.range
      ? [
          clamp(view.valueMin ?? active.range[0], active.range[0], active.range[1]),
          clamp(view.valueMax ?? active.range[1], active.range[0], active.range[1]),
        ]
      : null;

  const effectiveColorMode = view.colorMode === "value" && !hasValues ? "depth" : view.colorMode;
  const showColorbar = effectiveColorMode !== "solid";
  const colorbarDomain: [number, number] =
    effectiveColorMode === "value" && active.range ? active.range : [0, Math.max(maxDepth, 1)];

  return (
    <div className="flex flex-col">
      <div className="flex h-64 overflow-hidden rounded bg-bg">
        <div className="min-w-0 flex-1">
          <BoxesViewer
            mins={mins}
            maxs={maxs}
            depth={depth}
            values={active.values}
            nBoxes={meta.n_boxes}
            bounds={meta.bounds}
            maxDepth={maxDepth}
            valueRange={active.range}
            colorMode={view.colorMode}
            depthRange={[depthMin, depthMax]}
            valueThreshold={valueThreshold}
            background={view.background}
            sync={view.sync}
            onVisibleCount={(visible) => setVisibleCount(visible)}
          />
        </div>
        {showColorbar && (
          <Colorbar
            colormap="viridis"
            min={colorbarDomain[0]}
            max={colorbarDomain[1]}
          />
        )}
      </div>
      <div className="mono mt-1 text-xs text-fg-subtle">
        {`${(visibleCount ?? meta.n_boxes).toLocaleString()} of ${meta.n_boxes.toLocaleString()} boxes · ${meta.kind}`}
        {" · double-click to re-fit"}
      </div>
    </div>
  );
}

/** A pane in the multi-run grid: fetches its own sequence + blob at the step. */
function BoxesPane({
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
    () => safeJsonParse<Boxes3DMeta>(current?.artifact_metadata),
    [current],
  );

  if (q.isLoading) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  return (
    <div className="rounded bg-bg p-2">
      <BoxesBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} />
    </div>
  );
}

/** ONE non-baseline pane's comparison — see MeshCard's `MeshComparePane`
 *  for the full pattern writeup (identical mechanics, boxes3d-specific
 *  diff math). `primaryHash`/`primaryMeta` are resolved by the
 *  orchestrator (`BoxesComparePanel`, below). */
function BoxesComparePane({
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
  primaryMeta: Boxes3DMeta | null | undefined;
  referenceTag: { runId?: string; name: string; context_hash: string };
  referenceHash: string | undefined;
  mode: BoxesCompareMode;
  view: ViewConfig;
  settings: Boxes3DSettings;
  updateSettings: (patch: Partial<Boxes3DSettings>) => void;
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
  const referenceMeta = useMemo(() => safeJsonParse<Boxes3DMeta>(referencePoint?.artifact_metadata), [referencePoint]);

  const primaryBlob = useBoxesBlob(primaryHash);
  const referenceBlob = useBoxesBlob(referenceHash);

  if (mode === "normal") {
    return <BoxesBody hash={primaryHash} meta={primaryMeta} view={view} />;
  }

  if (!primaryBlob.data || !referenceBlob.data || !primaryMeta || !referenceMeta) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  const primaryMins = primaryBlob.data.mins?.data;
  const primaryMaxs = primaryBlob.data.maxs?.data;
  const primaryDepth = primaryBlob.data.depth?.data;
  const referenceDepth = referenceBlob.data.depth?.data;
  if (!primaryMins || !primaryMaxs || !primaryDepth || !referenceDepth) {
    return <div className="text-sm text-fg-muted">failed to load boxes</div>;
  }

  if (isCoreCompareMode(mode) && (mode === "split" || mode === "blend" || mode === "diff")) {
    return (
      <div className="h-64 overflow-hidden rounded bg-bg">
        <OffscreenComparePanes
          mode={mode}
          renderPrimary={(onFrame, sync) => {
            const props = extractProperties(primaryBlob.data!);
            const active = resolveActiveProperty(props, view.property, primaryMeta.properties ?? null);
            return (
              <BoxesViewer
                mins={primaryMins}
                maxs={primaryMaxs}
                depth={primaryDepth}
                values={active.values}
                nBoxes={primaryMeta.n_boxes}
                bounds={primaryMeta.bounds}
                maxDepth={primaryMeta.max_depth}
                valueRange={active.range}
                colorMode={view.colorMode}
                depthRange={[0, primaryMeta.max_depth]}
                background={view.background}
                sync={sync}
                onFrame={onFrame}
              />
            );
          }}
          renderReference={(onFrame, sync) => {
            const refMins = referenceBlob.data!.mins?.data;
            const refMaxs = referenceBlob.data!.maxs?.data;
            const props = extractProperties(referenceBlob.data!);
            const active = resolveActiveProperty(props, view.property, referenceMeta.properties ?? null);
            return (
              <BoxesViewer
                mins={refMins!}
                maxs={refMaxs!}
                depth={referenceDepth}
                values={active.values}
                nBoxes={referenceMeta.n_boxes}
                bounds={referenceMeta.bounds}
                maxDepth={referenceMeta.max_depth}
                valueRange={active.range}
                colorMode={view.colorMode}
                depthRange={[0, referenceMeta.max_depth]}
                background={view.background}
                sync={sync}
                onFrame={onFrame}
              />
            );
          }}
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

  // Native mode: diff-property — same n_boxes AND matching depth per box
  // (index correspondence) required.
  const topologyOk =
    primaryMeta.n_boxes === referenceMeta.n_boxes &&
    primaryDepth.length === referenceDepth.length &&
    Array.from(primaryDepth).every((d, i) => d === referenceDepth[i]);
  if (!topologyOk) {
    return (
      <div className="flex h-64 items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        Topology mismatch: {primaryMeta.n_boxes.toLocaleString()} vs{" "}
        {referenceMeta.n_boxes.toLocaleString()} boxes (or differing per-box depth) — native diff
        needs matched box count + depth.
      </div>
    );
  }

  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";
  const primaryProps = extractProperties(primaryBlob.data);
  const referenceProps = extractProperties(referenceBlob.data);
  const activeA = resolveActiveProperty(primaryProps, view.property, primaryMeta.properties ?? null);
  const activeB = resolveActiveProperty(referenceProps, view.property, referenceMeta.properties ?? null);

  if (!activeA.values || !activeB.values) {
    return (
      <div className="flex h-64 items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        No property values logged on these boxes to diff — pick a property with values on both series.
      </div>
    );
  }

  const deltaValues = computeDelta(activeA.values, activeB.values, primaryMeta.n_boxes);
  const { colors, domain } = diffColors(deltaValues, primaryMeta.n_boxes, diffColormap);

  return (
    <div className="flex h-64 overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1">
        <BoxesViewer
          mins={primaryMins}
          maxs={primaryMaxs}
          depth={primaryDepth}
          nBoxes={primaryMeta.n_boxes}
          bounds={primaryMeta.bounds}
          maxDepth={primaryMeta.max_depth}
          colorMode="value"
          depthRange={[0, primaryMeta.max_depth]}
          background={view.background}
          sync={view.sync}
          overrideColors={colors}
        />
      </div>
      <Colorbar colormap={diffColormap} min={domain[0]} max={domain[1]} />
    </div>
  );
}

/** N-run compare orchestrator — see MeshCard's `MeshComparePanel` for the
 *  full pattern writeup (identical mechanics, boxes3d-specific pane). */
function BoxesComparePanel({
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
  settings: Boxes3DSettings;
  updateSettings: (patch: Partial<Boxes3DSettings>) => void;
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

  const mode: BoxesCompareMode = settings.compareMode ?? "side";
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
        const primaryMeta = safeJsonParse<Boxes3DMeta>(primaryPoint?.artifact_metadata);
        const referenceHash = perPaneHash(idx);
        const referenceTag = hasExternalRef
          ? (refMode === "per-run"
              ? { runId: panes[idx]!.runId ?? runId, name: extBase!.name, context_hash: extBase!.context_hash }
              : { runId: extBase!.runId ?? runId, name: extBase!.name, context_hash: extBase!.context_hash })
          : { runId: panes[1]!.runId ?? runId, name: panes[1]!.name, context_hash: panes[1]!.context_hash };
        return (
          <BoxesComparePane
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

export default function BoxesCard({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<Boxes3DSettings>({
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
    colorMode: settings.colorMode,
    background: settings.background,
    depthMin: settings.depthMin,
    depthMax: settings.depthMax,
    valueFilterEnabled: settings.valueFilterEnabled,
    valueMin: settings.valueMin,
    valueMax: settings.valueMax,
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
    () => safeJsonParse<Boxes3DMeta>(current?.artifact_metadata),
    [current],
  );

  const topBlob = useBoxesBlob(current?.artifact_hash ?? undefined);
  const propertyOptions = useMemo(
    () => propertyNames(topBlob.data ? extractProperties(topBlob.data) : null),
    [topBlob.data],
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

  const metaSubtitle = meta
    ? `${meta.kind} · ${meta.n_boxes.toLocaleString()} boxes · max depth ${meta.max_depth}`
    : null;
  const subtitle =
    globalSteps.length > 0
      ? metaSubtitle
        ? `${metaSubtitle} · step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
        : `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : (metaSubtitle ?? `${metric.count} pts`);

  const hasExternalRef = settings.externalBaseline != null;
  const isMulti = effectiveMetrics.length > 1 || hasExternalRef;
  const isCompareEligible = hasExternalRef || effectiveMetrics.length >= 2;
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

  // Cheap proxy check for the Select's disabled state (n_boxes only — the
  // exact per-box depth-array comparison happens once both blobs are
  // loaded, inside BoxesComparePane, before actually rendering the mode).
  // When a reference was DRAGGED IN (external), assume OK — the render
  // path is authoritative (same disclosed pattern, now also covering the
  // external-reference case).
  const referenceMetaForCompare = useCompareReferenceMeta<Boxes3DMeta>(
    !hasExternalRef && isCompareEligible ? (multiQueries[1]?.data as SequenceResponse | undefined) : undefined,
    settings.refFixedStep,
    currentStep,
  );
  const compareTopologyOk =
    hasExternalRef ||
    (!!meta && !!referenceMetaForCompare && meta.n_boxes === referenceMetaForCompare.n_boxes);

  const renderSingle = () => {
    if (q.isLoading) {
      return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    return (
      <>
        <BoxesBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} />
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
            <BoxesPane
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
      <BoxesComparePanel
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
      label="Boxes selection"
    />
  );

  const depthCap = Math.max(meta?.max_depth ?? 8, 1);
  const curDepthMin = settings.depthMin ?? 0;
  const curDepthMax = settings.depthMax ?? depthCap;
  const canFilterByValue = !!meta?.value_range;
  const valLo = meta?.value_range?.min ?? 0;
  const valHi = meta?.value_range?.max ?? 1;
  const valStep = (valHi - valLo) / 100 || 0.01;
  const curValMin = settings.valueMin ?? valLo;
  const curValMax = settings.valueMax ?? valHi;

  return (
    <CardShell cardKind="boxes3d"
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
      addToComparisonSlot={<AddToComparisonButton cardType="boxes3d" series={compSeries} />}
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
            label="Color mode"
            value={settings.colorMode}
            onChange={(v) => updateSettings({ colorMode: v })}
            options={COLOR_MODE_OPTIONS}
            description="Depth uses a LUT over 0..max depth; Value needs per-box values logged"
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
          <Slider
            label="Depth min"
            value={curDepthMin}
            onChange={(v) => updateSettings({ depthMin: Math.min(v, curDepthMax) })}
            min={0}
            max={depthCap}
            step={1}
            format={(v) => v.toFixed(0)}
          />
          <Slider
            label="Depth max"
            value={curDepthMax}
            onChange={(v) => updateSettings({ depthMax: Math.max(v, curDepthMin) })}
            min={0}
            max={depthCap}
            step={1}
            format={(v) => v.toFixed(0)}
            description="Rebuilds the box geometry live; shows 'n of N boxes' below the view"
          />
          {canFilterByValue && (
            <>
              <Toggle
                label="Filter by value"
                checked={!!settings.valueFilterEnabled}
                onChange={(v) => updateSettings({ valueFilterEnabled: v })}
              />
              {settings.valueFilterEnabled && (
                <>
                  <Slider
                    label="Value min"
                    value={curValMin}
                    onChange={(v) => updateSettings({ valueMin: Math.min(v, curValMax) })}
                    min={valLo}
                    max={valHi}
                    step={valStep}
                    format={(v) => v.toFixed(2)}
                  />
                  <Slider
                    label="Value max"
                    value={curValMax}
                    onChange={(v) => updateSettings({ valueMax: Math.max(v, curValMin) })}
                    min={valLo}
                    max={valHi}
                    step={valStep}
                    format={(v) => v.toFixed(2)}
                  />
                </>
              )}
            </>
          )}
          <Toggle
            label="Sync 3D views"
            checked={!!settings.syncViews}
            onChange={(v) => updateSettings({ syncViews: v })}
            description="Share orbit/zoom/pan live with this card's other panes and any other sync-enabled 3D card on this page"
          />
          {isCompareEligible && (
            <CompareSettingsPanel<BoxesCompareMode>
              mode={(settings.compareMode ?? "side") as BoxesCompareMode}
              onModeChange={(v) => updateSettings({ compareMode: v })}
              nativeModes={NATIVE_COMPARE_MODES}
              topologyOk={compareTopologyOk}
              topologyHint="Native diff needs the same box count (+ matching depth) — disabled for this pair"
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
                  onClick={() => updateSettings({ externalBaseline: undefined, referenceMode: undefined })}
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

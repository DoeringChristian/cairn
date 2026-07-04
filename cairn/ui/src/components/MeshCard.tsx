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
import MeshViewer, {
  resolveMeshColorMode,
  type MeshColorMode,
  type MeshShading,
  type MeshBackground,
} from "../lib/cairn-plot/three/MeshViewer";
import { resetScene3DViews, type Scene3DSyncOptions } from "../lib/cairn-plot/three/use-scene3d";
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
import type { SeriesRef } from "./SeriesChip";
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
  properties?: PropertyMeta[];
  size_bytes: number;
}

// Extension point usage (spec-visual-compare.md): mesh appends two NATIVE
// modes to the shared media-compare enum via `MediaCompareMode<TExtra>` —
// no parallel enum. The core kinds (normal/side/split/blend/diff) are the
// image-space modes (§B); the native kinds are per-type (§C).
type MeshCompareMode = MediaCompareMode<"diff-property" | "diff-geometry">;

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
  /** Selected named property (Property selector); undefined = first available. */
  property?: string;
  /**
   * 2-series compare mode (spec-visual-compare.md WS-VC2). Absent/"side" =
   * today's default multi-pane grid, UNCHANGED — this is purely additive.
   */
  compareMode?: MeshCompareMode;
  diffColormap?: DiffColormap;
  diffSubmode?: DiffMode;
  splitPosition?: number;
  blendAlpha?: number;
  /** Pins the default (no external reference) series[1] baseline to one
   *  step instead of tracking the primary's current step 1:1 ("fixed-step"
   *  reference semantics — ignored once `externalBaseline` is set). */
  refFixedStep?: number;
  /**
   * A reference dragged in from elsewhere (another view's series chip, or a
   * viewport pane) — see `card-kit/use-reference-drop.ts`. Same shape/
   * semantics as the image card's `externalBaseline`. Set, every currently
   * loaded series (`metrics`, N-capable) is compared against it instead of
   * the legacy series[0]-vs-series[1] default.
   */
  externalBaseline?: { runId?: string; name: string; context_hash: string };
  /** "per-run": each pane resolves its own copy of `externalBaseline`'s tag
   *  name (dragging a SERIES CHIP — "the label from another view").
   *  "global": one shared reference image for every pane (dragging a
   *  VIEWPORT). Mirrors the image card's `referenceMode` 1:1. */
  referenceMode?: "global" | "per-run";
}

const DEFAULT_SETTINGS = (seed: { name: string; context_hash: string }): MeshSettings => ({
  version: 1,
  metrics: [seed],
  colorMode: "solid",
  shading: "smooth",
  wireframe: false,
  doubleSided: true,
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

// Mesh's native per-type compare kinds (appended after the shared core
// kinds by CompareSettingsPanel). Only the per-type native modes live here;
// the core kinds + all diff-colormap/submode/slider controls are shared.
const NATIVE_COMPARE_MODES: Array<{ value: MeshCompareMode; label: string }> = [
  { value: "diff-property", label: "Diff: property (native)" },
  { value: "diff-geometry", label: "Diff: geometry (native)" },
];

interface MeshArrays {
  positions: Float32Array;
  faces: Uint32Array;
  properties: PropertyMap;
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
        properties: extractProperties(npz),
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
  /** Selected property name (Property selector); `null` picks the first available. */
  property: string | null;
}

/** Renders a single resolved mesh point (blob + metadata). */
function MeshBody({
  hash,
  meta,
  view,
  fill,
}: {
  hash: string | undefined;
  meta: MeshMeta | null | undefined;
  view: ViewConfig;
  /** Fill the card's resizable body (single/normal-compare view) instead of
   * the multi-pane grid's fixed, independently-scrollable pane height. See
   * spec-3DR — one `fill` switch shared by all four 3D card `*Body`s rather
   * than forking the wrapper per caller. */
  fill?: boolean;
}) {
  const blob = useMeshBlob(hash);

  if (!hash) {
    return <div className="text-sm text-fg-muted">no mesh logged yet</div>;
  }
  if (blob.isLoading) {
    return <div className={fill ? "flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover" : "h-64 motion-safe:animate-pulse rounded bg-bg-hover"} />;
  }
  if (blob.isError || !blob.data || !meta) {
    return <div className="text-sm text-fg-muted">failed to load mesh</div>;
  }

  const nVertices = meta.n_vertices ?? blob.data.positions.length / 3;
  const nFaces = meta.n_faces ?? blob.data.faces.length / 3;
  const active = resolveActiveProperty(blob.data.properties, view.property, meta.properties ?? null);
  const resolvedMode = resolveMeshColorMode(view.colorMode, !!blob.data.colors, !!active.values);

  return (
    <div className={fill ? "flex flex-1 min-h-0 flex-col" : "flex flex-col"}>
      <div className={fill ? "flex flex-1 min-h-0 overflow-hidden rounded bg-bg" : "flex h-64 overflow-hidden rounded bg-bg"}>
        <div className="min-w-0 flex-1">
          <MeshViewer
            positions={blob.data.positions}
            faces={blob.data.faces}
            nVertices={nVertices}
            nFaces={nFaces}
            values={active.values}
            valueRange={active.range}
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
        {resolvedMode === "values" && active.range && (
          <Colorbar colormap="viridis" min={active.range[0]} max={active.range[1]} />
        )}
      </div>
      <div className="mono mt-1 text-xs text-fg-subtle">
        {`${nVertices.toLocaleString()} verts · ${nFaces.toLocaleString()} faces`}
        {active.name ? ` · ${active.name}` : ""}
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

/**
 * Renders ONE non-baseline pane's comparison against the resolved
 * reference — image-space core modes (normal/split/blend/diff; "side" is
 * handled by the caller's own `MultiPaneGrid`, unchanged) plus mesh's
 * native diff-property/diff-geometry modes. `primaryHash`/`primaryMeta` are
 * resolved by the orchestrator (`MeshComparePanel`, below) from data the
 * card already fetched for every pane; only the REFERENCE series' own
 * points are fetched here (it may be a dragged-in series the card isn't
 * otherwise displaying), purely to look up metadata for the hash
 * `useMediaReference` already resolved — no second step-matching
 * implementation (card-kit/use-media-reference.ts is the ONE reference
 * resolution family). split/blend/pixel-diff reuse `OffscreenComparePanes`,
 * which itself reuses the SAME `CompositeMediaPane` compositor the image
 * card uses — no per-card compositor fork.
 */
function MeshComparePane({
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
  primaryMeta: MeshMeta | null | undefined;
  referenceTag: { runId?: string; name: string; context_hash: string };
  referenceHash: string | undefined;
  mode: MeshCompareMode;
  view: ViewConfig;
  settings: MeshSettings;
  updateSettings: (patch: Partial<MeshSettings>) => void;
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
  const referenceMeta = useMemo(() => safeJsonParse<MeshMeta>(referencePoint?.artifact_metadata), [referencePoint]);

  const primaryBlob = useMeshBlob(primaryHash);
  const referenceBlob = useMeshBlob(referenceHash);

  if (mode === "normal") {
    // Rendered inside MultiPaneGrid's `relative overflow-hidden` cell (not a
    // flex container), so `fill`'s flex-1/min-h-0 chain has no ancestor to
    // resolve against — anchor with `absolute inset-0` instead (matches the
    // grid cell's own `relative` positioning context).
    return (
      <div className="absolute inset-0 flex flex-col">
        <MeshBody hash={primaryHash} meta={primaryMeta} view={view} fill />
      </div>
    );
  }

  if (!primaryBlob.data || !referenceBlob.data || !primaryMeta || !referenceMeta) {
    return <div className="absolute inset-0 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }

  if (isCoreCompareMode(mode) && (mode === "split" || mode === "blend" || mode === "diff")) {
    return (
      <div className="absolute inset-0 flex overflow-hidden rounded bg-bg">
        <OffscreenComparePanes
          mode={mode}
          renderPrimary={(onFrame, sync) => {
            const active = resolveActiveProperty(primaryBlob.data!.properties, view.property, primaryMeta.properties ?? null);
            return (
              <MeshViewer
                positions={primaryBlob.data!.positions}
                faces={primaryBlob.data!.faces}
                nVertices={primaryMeta.n_vertices}
                nFaces={primaryMeta.n_faces}
                values={active.values}
                valueRange={active.range}
                colors={primaryBlob.data!.colors}
                normals={primaryBlob.data!.normals}
                bounds={primaryMeta.bounds}
                colorMode={view.colorMode}
                shading={view.shading}
                wireframe={view.wireframe}
                doubleSided={view.doubleSided}
                background={view.background}
                sync={sync}
                onFrame={onFrame}
              />
            );
          }}
          renderReference={(onFrame, sync) => {
            const active = resolveActiveProperty(referenceBlob.data!.properties, view.property, referenceMeta.properties ?? null);
            return (
              <MeshViewer
                positions={referenceBlob.data!.positions}
                faces={referenceBlob.data!.faces}
                nVertices={referenceMeta.n_vertices}
                nFaces={referenceMeta.n_faces}
                values={active.values}
                valueRange={active.range}
                colors={referenceBlob.data!.colors}
                normals={referenceBlob.data!.normals}
                bounds={referenceMeta.bounds}
                colorMode={view.colorMode}
                shading={view.shading}
                wireframe={view.wireframe}
                doubleSided={view.doubleSided}
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

  // Native modes: diff-property | diff-geometry — same-topology required.
  const topologyOk =
    primaryMeta.n_vertices === referenceMeta.n_vertices && primaryMeta.n_faces === referenceMeta.n_faces;
  if (!topologyOk) {
    return (
      <div className="absolute inset-0 flex items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        Topology mismatch: {primaryMeta.n_vertices.toLocaleString()} vs{" "}
        {referenceMeta.n_vertices.toLocaleString()} vertices,{" "}
        {primaryMeta.n_faces.toLocaleString()} vs {referenceMeta.n_faces.toLocaleString()} faces — native diff
        modes need matching mesh topology (same vertex/face counts).
      </div>
    );
  }

  const diffColormap: DiffColormap = settings.diffColormap ?? "viridis";
  let deltaValues: Float32Array | null = null;
  if (mode === "diff-geometry") {
    deltaValues = computeDisplacementMagnitude(
      primaryBlob.data.positions,
      referenceBlob.data.positions,
      primaryMeta.n_vertices,
    );
  } else {
    const activeA = resolveActiveProperty(primaryBlob.data.properties, view.property, primaryMeta.properties ?? null);
    const activeB = resolveActiveProperty(referenceBlob.data.properties, view.property, referenceMeta.properties ?? null);
    if (activeA.values && activeB.values) {
      deltaValues = computeDelta(activeA.values, activeB.values, primaryMeta.n_vertices);
    }
  }

  if (!deltaValues) {
    return (
      <div className="absolute inset-0 flex items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted">
        No property values logged on this mesh to diff — pick a property, or use "Diff: geometry" instead.
      </div>
    );
  }

  const { colors, domain } = diffColors(deltaValues, primaryMeta.n_vertices, diffColormap);

  return (
    <div className="absolute inset-0 flex overflow-hidden rounded bg-bg">
      <div className="min-w-0 flex-1">
        <MeshViewer
          positions={primaryBlob.data.positions}
          faces={primaryBlob.data.faces}
          nVertices={primaryMeta.n_vertices}
          nFaces={primaryMeta.n_faces}
          colors={colors}
          colorMode="vertex-colors"
          normals={primaryBlob.data.normals}
          bounds={primaryMeta.bounds}
          shading={view.shading}
          wireframe={view.wireframe}
          doubleSided={view.doubleSided}
          background={view.background}
          sync={view.sync}
        />
      </div>
      <Colorbar colormap={diffColormap} min={domain[0]} max={domain[1]} />
    </div>
  );
}

/**
 * Orchestrates the N-run compare feature: resolves every non-baseline
 * pane's reference hash through the SAME reference family the image card
 * uses (`useMediaReference` — per-iteration "series-same-step" default,
 * "fixed-step" pin, or a dragged-in "external" per-run/global reference —
 * see card-kit/use-media-reference.ts + spec-visual-compare.md), then
 * renders one `MeshComparePane` per surviving pane through the SAME
 * `MultiPaneGrid` layout "side" mode uses. Replaces the old bespoke
 * a-vs-b-only `useTwoSeriesCompare` (series[0] vs series[1] hardcoded).
 */
function MeshComparePanel({
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
  settings: MeshSettings;
  updateSettings: (patch: Partial<MeshSettings>) => void;
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

  // The baseline pane itself isn't shown as a compared pane a second time —
  // mirrors ImageGalleryCard's identical skip (only for an explicit
  // "global" external reference; the default series[1] baseline is always
  // excluded since it IS panes[1]).
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

  const mode: MeshCompareMode = settings.compareMode ?? "side";
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
        const primaryMeta = safeJsonParse<MeshMeta>(primaryPoint?.artifact_metadata);
        const referenceHash = perPaneHash(idx);
        const referenceTag = hasExternalRef
          ? (refMode === "per-run"
              ? { runId: panes[idx]!.runId ?? runId, name: extBase!.name, context_hash: extBase!.context_hash }
              : { runId: extBase!.runId ?? runId, name: extBase!.name, context_hash: extBase!.context_hash })
          : { runId: panes[1]!.runId ?? runId, name: panes[1]!.name, context_hash: panes[1]!.context_hash };
        return (
          <MeshComparePane
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

  // Reference drop target — the SAME `card-kit/use-reference-drop.ts`
  // mechanic the image card uses. Dropping a SERIES CHIP ("the label from
  // another view") initiates a PER-RUN reference; dropping a VIEWPORT
  // label (this card's own pane, another 3D card's pane, or an image pane)
  // initiates a GLOBAL reference. Always lands on "diff", mirroring the
  // image card's drop behavior.
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
    shading: settings.shading,
    wireframe: settings.wireframe,
    doubleSided: settings.doubleSided,
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

  // Per-series full points/step-maps, index-aligned with `effectiveMetrics`/
  // `shownMetrics` (unlike `seriesPoints` above, which prepends `points` a
  // second time just to feed the step-slider's union-of-steps computation).
  // Reused for BOTH "side" mode (already-fetched, no new query) and the N-
  // run compare orchestrator's reference resolution (`useMediaReference`).
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
    () => safeJsonParse<MeshMeta>(current?.artifact_metadata),
    [current],
  );

  // Property options for the settings-panel selector — piggybacks the same
  // cache key `MeshBody`/`MeshPane` already populate for `current`, so this
  // is a free cache read, not a second fetch.
  const topBlob = useMeshBlob(current?.artifact_hash ?? undefined);
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
        ? `${meta.n_vertices.toLocaleString()} verts · ${meta.n_faces.toLocaleString()} faces`
        : `${metric.count} pts`;

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

  // "Viewport label" drag source for every labelled pane (MultiPaneGrid's
  // badge) — the SAME `CAIRN_IMAGE_MIME` payload an image pane drags,
  // consumed by `useReferenceDrop`'s viewport-drop path (-> global
  // reference) on any other card's drop target.
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

  // Topology-match check for the compare-mode selector's native-mode
  // disabling (reuses the already-fetched multi-run sequence data via the
  // shared useCompareReferenceMeta — no extra fetch just to grey out an
  // option). Only the equality predicate is mesh-specific. When a reference
  // was DRAGGED IN (external), this is a cheap proxy (assume OK — matches
  // BoxesCard's already-disclosed pattern): the render path
  // (`MeshComparePane`) always does the full, authoritative check and shows
  // the mismatch reason text if wrong.
  const referenceMetaForCompare = useCompareReferenceMeta<MeshMeta>(
    !hasExternalRef && isCompareEligible ? (multiQueries[1]?.data as SequenceResponse | undefined) : undefined,
    settings.refFixedStep,
    currentStep,
  );
  const compareTopologyOk =
    hasExternalRef ||
    (!!meta &&
      !!referenceMetaForCompare &&
      meta.n_vertices === referenceMetaForCompare.n_vertices &&
      meta.n_faces === referenceMetaForCompare.n_faces);

  const renderSingle = () => {
    if (q.isLoading) {
      return <div className="flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    return (
      <>
        <MeshBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} fill />
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

  const renderCompare = (inModal: boolean) => (
    <>
      <MeshComparePanel
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
      {inModal ? null : null}
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
      label="Mesh selection"
    />
  );

  return (
    <CardShell cardKind="mesh"
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
                artifactFilename(metric.name, current.step, current.artifact_mime, ".npz"),
              )
          : undefined
      }
      addToComparisonSlot={<AddToComparisonButton cardType="mesh" series={compSeries} />}
      // Always-on: 3D cards have no cheap "camera moved" signal (orbit
      // controls fire continuously), so reset-view is always shown, matching
      // the always-available dblclick-to-refit it now shares an implementation with.
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
            description="Falls back to an available attribute when the chosen one is absent"
          />
          <PropertySelector
            properties={propertyOptions}
            value={settings.property ?? null}
            onChange={(p) => updateSettings({ property: p })}
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
          {isCompareEligible && (
            <CompareSettingsPanel<MeshCompareMode>
              mode={(settings.compareMode ?? "side") as MeshCompareMode}
              onModeChange={(v) => updateSettings({ compareMode: v })}
              nativeModes={NATIVE_COMPARE_MODES}
              topologyOk={compareTopologyOk}
              topologyHint="Native diff modes need matching mesh topology (same vertex/face counts) — disabled for this pair"
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
        className={`flex flex-1 min-h-0 flex-col${refDropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
        onDragOver={refDropProps.onDragOver}
        onDragLeave={refDropProps.onDragLeave}
        onDrop={refDropProps.onDrop}
      >
        {renderContent(false)}
      </div>
    </CardShell>
  );
}

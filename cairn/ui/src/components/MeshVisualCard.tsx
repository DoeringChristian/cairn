import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import type { SequenceMeta } from "../api/types";
import type { CardSettingsKey } from "../lib/card-settings";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { safeJsonParse } from "../lib/format";
import {
  parseNpz,
  isCoreCompareMode,
  type MediaCompareModeKind,
  type DiffMode,
  type Colormap,
  type ViewportDataArgs,
  type ViewportDataResult,
  type ViewportModule,
  type ViewState,
} from "../lib/cairn-plot";
import MeshViewer, {
  resolveMeshColorMode,
  type MeshColorMode,
  type MeshShading,
  type MeshBackground,
} from "../lib/cairn-plot/three/MeshViewer";
import {
  MeshSingleView,
  MeshSideBySideView,
  MeshNativeDiffPane,
  meshViewportCapabilities,
  meshActiveColorbar,
  type MeshMeta,
  type MeshViewportItem,
  type MeshViewState,
  type MeshNativeMode,
} from "../lib/cairn-plot/viewport/mesh-viewport";
import type { PropertyMap } from "../lib/cairn-plot/three/properties";
import { extractProperties, propertyNames, resolveActiveProperty } from "../lib/cairn-plot/three/properties";
import type { DiffColormap } from "../lib/cairn-plot/three/diff";
import { resetScene3DViews, type Scene3DSyncOptions } from "../lib/cairn-plot/three/use-scene3d";
import type { ViewportPaneProps } from "../lib/cairn-plot/viewport/types";
import { OffscreenComparePanes, PropertySelector, useOffscreenSnapshot, type VisualCompareSettings } from "./card-kit";
import type { ForeignFrameProps } from "./card-kit/cross-type-frame";
import Select from "./settings/Select";
import Toggle from "./settings/Toggle";
import VisualContentCard from "./VisualContentCard";

// ---------------------------------------------------------------------------
// MeshVisualCard — the mesh object_type's APP-LAYER Viewport assembly + the
// lazy-loading boundary (WS-VC5). Mirrors `PointCloudVisualCard.tsx` exactly
// (see that file's header comment for the split rationale: pure pieces in
// `cairn-plot/viewport/mesh-viewport.tsx`, app-layer `useData`/`Pane`
// assembly + the lazy chunk boundary here, replacing the deleted
// `MeshCard.tsx`).
// ---------------------------------------------------------------------------

interface MeshArrays {
  positions: Float32Array;
  faces: Uint32Array;
  properties: PropertyMap;
  colors: Float32Array | null;
  normals: Float32Array | null;
}

async function fetchMeshArrays(hash: string): Promise<MeshArrays> {
  const res = await fetch(api.artifactUrl(hash));
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
}

function useMeshBlobs(hashes: (string | null)[]) {
  return useQueries({
    queries: hashes.map((h) => ({
      queryKey: ["mesh-npz", h],
      enabled: !!h,
      staleTime: Infinity,
      queryFn: () => fetchMeshArrays(h!),
    })),
  });
}

function useMeshData(args: ViewportDataArgs): ViewportDataResult<MeshViewportItem> {
  const { hashes, referenceHashes, metadata, referenceMetadata } = args;
  const fg = useMeshBlobs(hashes);
  const ref = useMeshBlobs(referenceHashes);

  return useMemo(() => {
    const items = hashes.map((h, i) => {
      if (!h) return null;
      const blob = fg[i]?.data;
      const meta = safeJsonParse<MeshMeta>(metadata?.[i]);
      if (!blob || !meta) return null;
      return { arrays: blob, meta };
    });
    const referenceItems = referenceHashes.map((h, i) => {
      if (!h) return null;
      const blob = ref[i]?.data;
      const meta = safeJsonParse<MeshMeta>(referenceMetadata?.[i]);
      if (!blob || !meta) return null;
      return { arrays: blob, meta };
    });
    const isLoading = fg.some((q) => q.isLoading) || ref.some((q) => q.isLoading);
    return { items, referenceItems, isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hashes.join("|"),
    referenceHashes.join("|"),
    (metadata ?? []).join("|"),
    (referenceMetadata ?? []).join("|"),
    fg.map((q) => q.dataUpdatedAt).join("|"),
    ref.map((q) => q.dataUpdatedAt).join("|"),
  ]);
}

// ---------------------------------------------------------------------------
// MeshForeignFrame — WS-VC6 cross-type bridge: renders ONE mesh hash's
// viewer hidden (default view — solid/smooth/dark, no per-card settings to
// borrow, since the REQUESTING card is a different object_type) purely to
// capture a single offscreen snapshot for another card's cross-type
// compare. Dynamically imported (via `cross-type-frame-registry.tsx`) only
// when an IMAGE card's resolved reference is this type, so `three`/
// `MeshViewer` stay out of every other card's bundle exactly like
// `MeshVisualCard`'s own lazy boundary.
// ---------------------------------------------------------------------------
export function MeshForeignFrame({ hash, metadata, onFrame }: ForeignFrameProps) {
  const [blob] = useMeshBlobs([hash]);
  const meta = safeJsonParse<MeshMeta>(metadata);
  const snap = useOffscreenSnapshot();

  useEffect(() => {
    if (snap.dataUrl) onFrame({ kind: "dataUrl", dataUrl: snap.dataUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.dataUrl]);

  if (!blob?.data || !meta) return null;
  const active = resolveActiveProperty(blob.data.properties, null, meta.properties ?? null);
  return (
    <MeshViewer
      positions={blob.data.positions}
      faces={blob.data.faces}
      nVertices={meta.n_vertices}
      nFaces={meta.n_faces}
      values={active.values}
      valueRange={active.range}
      colors={blob.data.colors}
      normals={blob.data.normals}
      bounds={meta.bounds}
      colorMode="solid"
      shading="smooth"
      wireframe={false}
      doubleSided
      background="dark"
      onFrame={snap.onFrame}
    />
  );
}

// ---------------------------------------------------------------------------
// Settings — VisualCompareSettings (shared) intersected with mesh's own
// fields. `compareMode`/`diffSubmode` are the OLD (pre-VisualContentCard)
// mesh card's field names for what's now `mode`/`nativeMode`/`diffMode` —
// kept OUT of this type and read only through `migrateMeshSettings`'s
// one-time unsafe-cast read, mirroring `migratePointCloudSettings`.
// ---------------------------------------------------------------------------

export interface MeshFullSettings extends VisualCompareSettings {
  colorMode: MeshColorMode;
  shading: MeshShading;
  wireframe: boolean;
  doubleSided: boolean;
  background: MeshBackground;
  property?: string;
  diffColormap?: DiffColormap;
  /** Persisted "Show axes" setting (WS-3DR2). */
  showAxes?: boolean;
}

function defaultMeshSettings(): Omit<MeshFullSettings, "metrics" | "version"> {
  return {
    colorMode: "solid",
    shading: "smooth",
    wireframe: false,
    doubleSided: true,
    background: "dark",
    showAxes: false,
    // 3D views linked by default (WS-VCP fix 1) — `useCardSettings` merges
    // this under any persisted value, so a card that already has an explicit
    // `syncViews` (on OR off) keeps it; only brand-new/never-toggled cards
    // pick up this default.
    syncViews: true,
    // Inert placeholders — see defaultPointCloudSettings' identical comment.
    brightness: 0,
    contrast: 0,
    gamma: 1,
    exposure: 0,
    offset: 0,
    flipSign: false,
    zoom: 1,
    pan: { x: 0, y: 0 },
    diffMode: "none",
  };
}

const LEGACY_CORE_MODES = new Set<string>(["normal", "side", "split", "blend", "diff"]);

/**
 * Read migration for old mesh cards' persisted settings: folds the
 * pre-VisualContentCard `compareMode` field into the shared `mode`/
 * `nativeMode` fields, and `diffSubmode` into the shared `diffMode`.
 * Non-destructive, mirrors `migratePointCloudSettings`.
 */
function migrateMeshSettings(settings: MeshFullSettings): MeshFullSettings {
  const raw = settings as unknown as Record<string, unknown>;
  let next = settings;
  if (next.mode == null && next.nativeMode == null && typeof raw.compareMode === "string") {
    const legacy = raw.compareMode;
    if (legacy === "diff-property" || legacy === "diff-geometry") {
      next = { ...next, nativeMode: legacy };
    } else if (LEGACY_CORE_MODES.has(legacy)) {
      next = { ...next, mode: legacy as MediaCompareModeKind };
    }
  }
  if (next.diffMode === "none" && typeof raw.diffSubmode === "string") {
    next = { ...next, diffMode: raw.diffSubmode as DiffMode };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Pane — the REAL `ViewportModule.Pane`. Dispatches "normal"/"side" to the
// pure cairn-plot components and "split"/"blend"/"diff" to
// `OffscreenComparePanes`, mirroring `PointCloudViewportPane` verbatim (same
// viewer wiring, same `sync`/`onFrame` contract).
// ---------------------------------------------------------------------------

function MeshViewportPane(
  props: ViewportPaneProps<MeshViewportItem, MeshViewState, MeshFullSettings>,
) {
  const {
    data,
    reference,
    settings,
    mode,
    diffMode,
    cameraSyncGroupId,
    label,
    isBaseline,
    isDraggable,
    onDragStart,
    splitPosition,
    onSplitPositionChange,
    blendAlpha,
    crossTypeReferenceUrl,
    crossTypeAlignForDiff,
    colorRange,
  } = props;
  const sync: Scene3DSyncOptions | null = cameraSyncGroupId ? { groupId: cameraSyncGroupId } : null;
  const view = {
    colorMode: settings.colorMode,
    shading: settings.shading,
    wireframe: settings.wireframe,
    doubleSided: settings.doubleSided,
    background: settings.background,
    property: settings.property ?? null,
    showAxes: settings.showAxes ?? false,
  };
  const hasCrossTypeRef = crossTypeReferenceUrl != null;
  const effectiveMode: MediaCompareModeKind = reference == null && !hasCrossTypeRef ? "normal" : mode;

  // Renders THIS pane's own (foreground) mesh live — shared by the same-type
  // split/blend/diff branch below AND the WS-VC6 cross-type branch (a
  // foreign-type reference has no MeshSideBySideView/OffscreenComparePanes
  // same-type counterpart, so cross-type always routes "side" too through
  // the generalized OffscreenComparePanes).
  const renderMeshLive = (cb: (canvas: HTMLCanvasElement) => void, syncOpts: Scene3DSyncOptions) => {
    const active = resolveActiveProperty(data!.arrays.properties, view.property, data!.meta.properties ?? null);
    const resolvedMode = resolveMeshColorMode(view.colorMode, !!data!.arrays.colors, !!active.values);
    const valueRange = resolvedMode === "values" ? (colorRange ?? active.range) : active.range;
    return (
      <MeshViewer
        positions={data!.arrays.positions}
        faces={data!.arrays.faces}
        nVertices={data!.meta.n_vertices}
        nFaces={data!.meta.n_faces}
        values={active.values}
        valueRange={valueRange}
        colors={data!.arrays.colors}
        normals={data!.arrays.normals}
        bounds={data!.meta.bounds}
        colorMode={view.colorMode}
        shading={view.shading}
        wireframe={view.wireframe}
        doubleSided={view.doubleSided}
        background={view.background}
        showAxes={view.showAxes}
        sync={syncOpts}
        onFrame={cb}
      />
    );
  };

  if (hasCrossTypeRef && effectiveMode !== "normal") {
    if (!data) {
      return (
        <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse">
          loading…
        </div>
      );
    }
    return (
      <OffscreenComparePanes
        mode={effectiveMode as Extract<MediaCompareModeKind, "side" | "split" | "blend" | "diff">}
        primary={{ kind: "live", render: renderMeshLive }}
        reference={{ kind: "frame", frameSource: { kind: "url", url: crossTypeReferenceUrl! } }}
        diffSubmode={diffMode}
        colormap={(settings.diffColormap ?? "viridis") as Colormap}
        splitPosition={splitPosition ?? 0.5}
        onSplitPositionChange={onSplitPositionChange ?? (() => {})}
        blendAlpha={blendAlpha ?? 0.5}
        primaryLabel={label}
        alignForDiff={crossTypeAlignForDiff}
      />
    );
  }

  if (effectiveMode === "side") {
    return (
      <MeshSideBySideView
        item={data}
        reference={reference ?? null}
        view={view}
        sync={sync}
        label={label}
        isDraggable={isDraggable}
        onDragStart={onDragStart}
        colorRange={colorRange}
      />
    );
  }

  if (isCoreCompareMode(effectiveMode) && (effectiveMode === "split" || effectiveMode === "blend" || effectiveMode === "diff")) {
    if (!data || !reference) {
      return (
        <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse">
          loading…
        </div>
      );
    }
    return (
      <OffscreenComparePanes
        mode={effectiveMode}
        primary={{ kind: "live", render: renderMeshLive }}
        reference={{
          kind: "live",
          render: (cb, syncOpts) => {
            const active = resolveActiveProperty(reference.arrays.properties, view.property, reference.meta.properties ?? null);
            const resolvedMode = resolveMeshColorMode(view.colorMode, !!reference.arrays.colors, !!active.values);
            const valueRange = resolvedMode === "values" ? (colorRange ?? active.range) : active.range;
            return (
              <MeshViewer
                positions={reference.arrays.positions}
                faces={reference.arrays.faces}
                nVertices={reference.meta.n_vertices}
                nFaces={reference.meta.n_faces}
                values={active.values}
                valueRange={valueRange}
                colors={reference.arrays.colors}
                normals={reference.arrays.normals}
                bounds={reference.meta.bounds}
                colorMode={view.colorMode}
                shading={view.shading}
                wireframe={view.wireframe}
                doubleSided={view.doubleSided}
                background={view.background}
                showAxes={view.showAxes}
                sync={syncOpts}
                onFrame={cb}
              />
            );
          },
        }}
        diffSubmode={diffMode}
        colormap={(settings.diffColormap ?? "viridis") as Colormap}
        splitPosition={splitPosition ?? 0.5}
        onSplitPositionChange={onSplitPositionChange ?? (() => {})}
        blendAlpha={blendAlpha ?? 0.5}
        primaryLabel={label}
      />
    );
  }

  void isBaseline;
  return (
    <MeshSingleView
      item={data}
      view={view}
      sync={sync}
      label={label}
      isDraggable={isDraggable}
      onDragStart={onDragStart}
      colorRange={colorRange}
    />
  );
}

// ---------------------------------------------------------------------------
// SettingsControls — per-type controls injected into the shared settings
// panel. "Sync 3D views" is NOT here — rendered centrally by
// VisualContentCard (see PointCloudSettingsControls' identical comment).
// ---------------------------------------------------------------------------

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

function MeshSettingsControls({
  settings,
  update,
  meta,
}: {
  settings: MeshFullSettings;
  update: (p: Partial<MeshFullSettings>) => void;
  meta: unknown;
}) {
  const item = meta as MeshViewportItem | null;
  const propertyOptions = propertyNames(item?.arrays.properties);
  return (
    <>
      <Select
        label="Color mode"
        value={settings.colorMode}
        onChange={(v) => update({ colorMode: v })}
        options={COLOR_MODE_OPTIONS}
        description="Falls back to an available attribute when the chosen one is absent"
      />
      <PropertySelector
        properties={propertyOptions}
        value={settings.property ?? null}
        onChange={(p) => update({ property: p })}
      />
      <Select
        label="Shading"
        value={settings.shading}
        onChange={(v) => update({ shading: v })}
        options={SHADING_OPTIONS}
      />
      <Toggle
        label="Wireframe overlay"
        checked={settings.wireframe}
        onChange={(v) => update({ wireframe: v })}
        description="Draw triangle edges on top of the filled surface"
      />
      <Toggle
        label="Double-sided"
        checked={settings.doubleSided}
        onChange={(v) => update({ doubleSided: v })}
        description="Render backfaces (useful for open/non-manifold meshes)"
      />
      <Select
        label="Background"
        value={settings.background}
        onChange={(v) => update({ background: v })}
        options={BACKGROUND_OPTIONS}
      />
      <Toggle
        label="Show axes"
        checked={!!settings.showAxes}
        onChange={(v) => update({ showAxes: v })}
        description="Colored XYZ origin lines + grid, sized to the fitted view"
      />
      {/* "Diff colormap" (red-green/viridis) now lives in the shared
          Compare section (VisualContentCard.tsx, WS-MFIX Bug 2) — rendering
          it here too would duplicate the control in the same settings
          panel. */}
    </>
  );
}

// ---------------------------------------------------------------------------
// Module assembly + the lazy-loaded card component.
// ---------------------------------------------------------------------------

const DEFAULT_VIEW: MeshViewState = {
  kind: "camera3d",
  position: [0, 0, 5],
  target: [0, 0, 0],
  zoom: 1,
};

export const meshViewportModule: ViewportModule<
  MeshViewportItem,
  MeshViewState,
  MeshFullSettings,
  MeshNativeMode
> = {
  objectType: "mesh",
  capabilities: meshViewportCapabilities,
  useData: useMeshData,
  defaultSettings: defaultMeshSettings,
  migrateSettings: migrateMeshSettings,
  viewFromSettings: () => DEFAULT_VIEW,
  viewToSettingsPatch: () => ({}),
  defaultView: () => DEFAULT_VIEW,
  onResetView: (container) => resetScene3DViews(container),
  activeColorbar: meshActiveColorbar,
  Pane: MeshViewportPane,
  SettingsControls: MeshSettingsControls,
  nativeDiff: { render: MeshNativeDiffPane },
};

interface MeshVisualCardProps {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

/**
 * The lazy-loading boundary for mesh (WS-VC5): `CardRenderer.tsx` dynamically
 * imports THIS file instead of the deleted `MeshCard.tsx`, so `three`/
 * `MeshViewer` stay out of every other card's bundle exactly as before.
 */
export default function MeshVisualCard(props: MeshVisualCardProps) {
  return (
    <VisualContentCard
      {...props}
      viewport={meshViewportModule as unknown as ViewportModule<unknown, ViewState, VisualCompareSettings>}
    />
  );
}

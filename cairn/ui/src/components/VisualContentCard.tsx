import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { useSequences } from "../api/hooks";
import type { SequenceMeta, SequencePoint } from "../api/types";
import { resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import { cardMinSize } from "./card-kit/card-min-sizes";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { downloadArtifact, exportImagesAsComposite, safeName, type CompositePane } from "../lib/download";
import { useCardSeries, useStepSlider, useRunInfo, useMediaReference, useReferenceDrop, type VisualCompareSettings } from "./card-kit";
import {
  type DiffMode,
  type Colormap,
  type ImageOverlaySettings,
  type MediaCompareModeKind,
  type ViewportModule,
  type ViewState,
  DIVERGING_COLORMAPS,
  DEFAULT_OVERLAY_SETTINGS,
  getColormapLUT,
  overlayClassColor,
  resolveArtifactAtStep,
  migrateLegacyMode,
  isCoreCompareMode,
  Colorbar,
  ColormapSwatch,
  useContainerSize,
} from "../lib/cairn-plot";
import { parseOverlay } from "./viewport-registry";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { useCameraSync } from "../lib/camera-sync";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import { startViewportDrag, type SeriesRef } from "./SeriesChip";
import SeriesChipStrip from "./SeriesChipStrip";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import RunSelectionPanel from "./RunSelectionPanel";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import SettingsSection from "./settings/SettingsSection";
import StepSlider from "./StepSlider";
import { artifactFilename } from "../lib/download";

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
  autoOpenSettings?: boolean;
  /** The only thing that varies per object_type — supplies data resolution,
   *  the per-viewport Pane, and the capability descriptor that gates which
   *  chrome this card renders. Chosen by `object_type` in the viewport
   *  registry (see components/viewport-registry.tsx) and injected by
   *  CardRenderer. Everything else on this card is type-agnostic. */
  viewport: ViewportModule<unknown, ViewState, VisualCompareSettings>;
}

/** The persisted settings shape — hoisted to
 *  `card-kit/visual-compare-settings.ts` (`VisualCompareSettings`) so the card
 *  can be generic across viewport types. Field names/defaults unchanged from
 *  the pre-refactor `ImageSettings` (persisted-settings compatibility). */
type ImageSettings = VisualCompareSettings;

function seriesLabel(
  m: { runId?: string; name: string; context_hash: string },
  fallbackRunId: string,
  multiRun: boolean,
  siblingRunIds?: string[],
): string {
  if (multiRun) {
    return shortRunLabel(m.runId ?? fallbackRunId, siblingRunIds);
  }
  const parts: string[] = [m.name];
  if (m.context_hash) parts.push(m.context_hash.slice(0, 6));
  return parts.join(" · ");
}

function seriesKey(m: {
  runId?: string;
  name: string;
  context_hash: string;
}): string {
  return `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
}

const MEDIA_COMPARE_MODE_LABELS: Record<MediaCompareModeKind, string> = {
  normal: "normal",
  side: "side",
  split: "split",
  blend: "blend",
  diff: "diff",
};

// ---------------------------------------------------------------------------
// ExternalBaselinePicker
// ---------------------------------------------------------------------------

function ExternalBaselinePicker({
  runId,
  objectType,
  currentMetricName,
  selected,
  onSelect,
  availableRunIds,
}: {
  runId: string;
  objectType: string;
  currentMetricName: string;
  selected?: string;
  onSelect: (name: string, contextHash: string, selectedRunId: string) => void;
  availableRunIds: string[];
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
      .filter((s) => s.object_type === objectType && s.name !== currentMetricName)
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

  const runLabel = (id: string) => shortRunLabel(id, availableRunIds);

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

// ---------------------------------------------------------------------------
// ImageGalleryCard
// ---------------------------------------------------------------------------

export default function VisualContentCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove, autoOpenSettings, viewport }: Props) {
  useRunMetadataVersion();

  const caps = viewport.capabilities;
  // The card's own minimum height — passed to every resolveCardHeight read so
  // the inner content agrees with CardShell's outer-box clamp (one clamp
  // source). Per-type via the viewport's object_type.
  const MIN_HEIGHT = cardMinSize(viewport.objectType).minHeight;

  const {
    settings: rawSettings,
    updateSettings,
    effectiveMetrics,
    allRunIds: availableRunIds,
    multipleRuns,
  } = useCardSeries<ImageSettings>({
    runId,
    metric,
    extraSeries,
    controlledSeries,
    settingsKeyOverride,
    makeDefaults: (_seed, metrics) => ({
      version: 1,
      metrics,
      ...viewport.defaultSettings(),
    }),
  });

  // Per-module settings read migration (WS-VC4) — see `ViewportModule.
  // migrateSettings`'s doc comment. Non-destructive (never rewrites
  // storage); absent for image (identity), so this is a no-op there.
  const settings = viewport.migrateSettings ? viewport.migrateSettings(rawSettings) : rawSettings;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // The unified exclusive mode — `settings.mode` is authoritative once
  // present; otherwise derived from the legacy {diffMode, compareMode,
  // referenceMode} combo (spec-visual-compare.md: settings migration on
  // read, one table-driven utility — see media-compare/migrate-legacy-mode.ts).
  const effectiveMode: MediaCompareModeKind =
    settings.mode ??
    migrateLegacyMode({
      diffMode: settings.diffMode,
      compareMode: settings.compareMode,
      referenceMode: settings.referenceMode,
    });

  // The active CARD-NATIVE mode (WS-VC4 — e.g. a 3D geometry diff), when one
  // of `capabilities.nativeModes` is selected in place of a core mode. `[]`
  // for image, so this is always undefined there.
  const activeNativeMode: string | undefined = settings.nativeMode ?? undefined;

  const setMode = useCallback((mode: MediaCompareModeKind) => {
    const updates: Partial<ImageSettings> = { mode, nativeMode: undefined };
    if (mode === "diff" && settingsRef.current.diffMode === "none") {
      updates.diffMode = "absolute";
    }
    updateSettings(updates);
  }, [updateSettings]);

  const setNativeMode = useCallback((nativeMode: string) => {
    updateSettings({ nativeMode });
  }, [updateSettings]);

  // -----------------------------------------------------------------------
  // Multi-series fetch
  // -----------------------------------------------------------------------
  const queries = useQueries({
    queries: effectiveMetrics.map((m) => ({
      queryKey: qk.sequence(m.runId ?? runId, m.name, m.context_hash),
      queryFn: () =>
        api.sequence(m.runId ?? runId, m.name, {
          context: m.context_hash || undefined,
          maxPoints: 500,
        }),
      refetchInterval: 2000,
    })),
  });

  const { perSeriesPoints, perSeriesStepMap, globalStepPoints } = useMemo(() => {
    const psp = queries.map((q) =>
      (q.data?.points ?? []).filter((p: SequencePoint) => p.artifact_hash),
    );
    const maps = psp.map((pts) => {
      const m = new Map<number, SequencePoint>();
      for (const p of pts) m.set(p.step, p);
      return m;
    });
    const stepMap = new Map<number, string | undefined>();
    for (const pts of psp) for (const p of pts) {
      if (!stepMap.has(p.step)) stepMap.set(p.step, p.wall_time ?? undefined);
    }
    const steps = Array.from(stepMap.keys()).sort((a, b) => a - b);
    const stepPts = steps.map((s) => ({ step: s, wall_time: stepMap.get(s) ?? null }));
    return { perSeriesPoints: psp, perSeriesStepMap: maps, globalStepPoints: stepPts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((q) => q.dataUpdatedAt).join("|")]);

  // Step-slider machinery is shared; artifact resolution stays specialized
  // (resolveArtifactAtStep honors missingImageMode / per-series step maps).
  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints: perSeriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings,
  });

  const isMulti = effectiveMetrics.length > 1 || settings.externalBaseline != null;

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();

  const { runInfoMap } = useRunInfo(availableRunIds);

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => effectiveMetrics.map((m) => ({
      runId: m.runId ?? runId,
      name: m.name,
      context_hash: m.context_hash,
    })),
    [runId, effectiveMetrics],
  );

  // -----------------------------------------------------------------------
  // View state — persisted inside settings; the module owns which fields
  // hold it (image: zoom/pan) via viewFromSettings/viewToSettingsPatch, so
  // the card never assumes 2D-vs-3D view shape (D5 in the design doc).
  // -----------------------------------------------------------------------
  const view = viewport.viewFromSettings(settings);
  const onPaneViewChange = useCallback(
    (v: ViewState) => updateSettings(viewport.viewToSettingsPatch(v)),
    [updateSettings, viewport],
  );

  // -----------------------------------------------------------------------
  // Per-pane foreground resolution (hash + metadata at the current step),
  // index-aligned with effectiveMetrics. The reference/data resolution that
  // depends on perPaneHash is assembled below, after useMediaReference.
  // -----------------------------------------------------------------------
  const paneResolved = useMemo(
    () => effectiveMetrics.map((_, i) => {
      const stepMap = perSeriesStepMap[i] ?? new Map();
      const steps = perSeriesPoints[i]?.map((p) => p.step) ?? [];
      return resolveArtifactAtStep(stepMap, currentStep, steps, settings.missingImageMode);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMetrics, perSeriesStepMap, perSeriesPoints, currentStep, settings.missingImageMode],
  );

  const paneMetadata = useMemo(
    () => effectiveMetrics.map((_, i) => {
      const { hash, fallbackStep } = paneResolved[i] ?? { hash: undefined, fallbackStep: null };
      if (!hash) return null;
      const stepMap = perSeriesStepMap[i] ?? new Map();
      const step = fallbackStep ?? currentStep;
      return stepMap.get(step)?.artifact_metadata ?? null;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMetrics, perSeriesStepMap, paneResolved, currentStep],
  );

  // -----------------------------------------------------------------------
  // Container size (for auto-height) + image aspect
  // -----------------------------------------------------------------------
  const { ref: containerSizeRef, size: containerSize } = useContainerSize<HTMLDivElement>();
  const containerWidth = containerSize.w;

  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const onImageNaturalSize = useCallback((w: number, h: number) => {
    setImageAspect((prev) => prev ?? h / w);
  }, []);

  // -----------------------------------------------------------------------
  // Drop target for baseline references — the ONE shared drag/drop-to-
  // compare mechanic (card-kit/use-reference-drop.ts), also used by every
  // 3D card. Dropping a reference always lands on "diff" — the exclusive-
  // mode equivalent of the pre-refactor behavior (auto-enable diff coloring
  // on drop; see spec-visual-compare.md's "map combinable states to diff").
  // -----------------------------------------------------------------------
  const applyReference = useCallback((ref: SeriesRef, mode: "global" | "per-run") => {
    updateSettings({
      externalBaseline: { runId: ref.runId, name: ref.name, context_hash: ref.context_hash },
      baselineIndex: undefined,
      referenceMode: mode,
      diffMode: settingsRef.current.diffMode === "none" ? "absolute" : settingsRef.current.diffMode,
      mode: "diff",
    });
  }, [updateSettings]);
  const { highlight: refDropHighlight, dropProps: refDropProps } = useReferenceDrop({
    onSeriesDrop: (ref) => applyReference(ref, "per-run"),
    onViewportDrop: (ref) => applyReference(ref, "global"),
  });
  const { onDragOver: onRefDragOver, onDragLeave: onRefDragLeave, onDrop: onRefDrop } = refDropProps;

  const onImageDragStart = useCallback((e: React.DragEvent, m: { runId?: string; name: string; context_hash: string }) => {
    startViewportDrag(e, { runId: m.runId ?? runId, name: m.name, context_hash: m.context_hash }, m.name);
  }, [runId]);

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------
  const firstResolved = useMemo(() => {
    const stepMap = perSeriesStepMap[0] ?? new Map();
    const steps = perSeriesPoints[0]?.map((p) => p.step) ?? [];
    return resolveArtifactAtStep(stepMap, currentStep, steps, settings.missingImageMode);
  }, [perSeriesStepMap, perSeriesPoints, currentStep, settings.missingImageMode]);

  // The pane-0 point actually resolved (for its `artifact_mime` — the
  // download filename's extension source; WS-VC4 generalizes this off the
  // real resolved mime instead of assuming "image/png", so a non-image
  // type's own artifact mime (e.g. pointcloud's npy/npz) downloads with the
  // right extension. Falls back to "image/png" only when no mime is known
  // at all, matching the pre-refactor image card's hardcoded default.
  const firstPoint = useMemo(() => {
    const step = firstResolved.fallbackStep ?? currentStep;
    return perSeriesStepMap[0]?.get(step) ?? null;
  }, [perSeriesStepMap, firstResolved.fallbackStep, currentStep]);
  const downloadMime = firstPoint?.artifact_mime ?? "image/png";

  // -----------------------------------------------------------------------
  // Overlays (bounding boxes + segmentation masks)
  // -----------------------------------------------------------------------
  const ovl: ImageOverlaySettings = useMemo(
    () => ({ ...DEFAULT_OVERLAY_SETTINGS, ...(settings.overlay ?? {}) }),
    [settings.overlay],
  );

  // Overlay data for the foreground image currently shown in each pane —
  // parsed from each pane's resolved metadata via the ONE shared parser
  // (viewport-registry's parseOverlay, also used by the image viewport's
  // useData). Used here only for the settings-panel class aggregation; the
  // panes themselves get overlays via `viewData` below.
  const paneOverlays = useMemo(
    () => paneMetadata.map((md) => parseOverlay(md)),
    [paneMetadata],
  );

  const { hasOverlay, overlayClasses } = useMemo(() => {
    const classes = new Map<number, string>();
    let any = false;
    for (const ov of paneOverlays) {
      if (!ov) continue;
      if ((ov.boxes?.length ?? 0) > 0 || (ov.masks?.length ?? 0) > 0) any = true;
      for (const b of ov.boxes ?? []) {
        if (!classes.has(b.class_id)) {
          classes.set(b.class_id, b.label ?? ov.class_labels?.[String(b.class_id)] ?? `#${b.class_id}`);
        }
      }
      for (const [k, v] of Object.entries(ov.class_labels ?? {})) {
        const id = Number(k);
        if (id !== 0 && !classes.has(id)) classes.set(id, v);
      }
      for (const m of ov.masks ?? []) {
        for (const [k, v] of Object.entries(m.class_labels ?? {})) {
          const id = Number(k);
          if (id !== 0 && !classes.has(id)) classes.set(id, v);
        }
      }
    }
    return {
      hasOverlay: any,
      overlayClasses: [...classes.entries()].sort((a, b) => a[0] - b[0]),
    };
  }, [paneOverlays]);

  const updateOverlay = useCallback(
    (changes: Partial<ImageOverlaySettings>) => {
      updateSettings({ overlay: { ...ovl, ...changes } });
    },
    [ovl, updateSettings],
  );

  const toggleOverlayClass = useCallback(
    (classId: number) => {
      const hidden = new Set(ovl.hiddenClasses);
      if (hidden.has(classId)) hidden.delete(classId);
      else hidden.add(classId);
      updateOverlay({ hiddenClasses: [...hidden] });
    },
    [ovl.hiddenClasses, updateOverlay],
  );

  const autoHeight = useMemo((): string | undefined => {
    if (resolveCardHeight(settings, undefined, MIN_HEIGHT) != null) return undefined;
    if (!imageAspect || containerWidth <= 0) return "20rem";
    const n = effectiveMetrics.length;
    const cols = Math.min(n, Math.max(1, Math.floor(containerWidth / 200)));
    const rows = Math.ceil(n / cols);
    const paneWidth = containerWidth / cols;
    const rowHeight = paneWidth * imageAspect + 24;
    const clampedRow = Math.max(120, Math.min(500, rowHeight));
    return `${Math.round(rows * clampedRow)}px`;
  }, [settings.height, settings.height1, settings.height2, settings.colSpan, imageAspect, containerWidth, effectiveMetrics.length]);

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : `${metric.count} pts`;

  const anyLoading = queries.some((q) => q.isLoading);

  // External baseline
  const extBase = settings.externalBaseline;
  const refMode = settings.referenceMode ?? "global";

  const setReferenceMode = useCallback((mode: "global" | "per-run") => {
    updateSettings({ referenceMode: mode });
  }, [updateSettings]);

  // Reference resolution — the one hook/function family (see
  // card-kit/use-media-reference.ts + lib/cairn-plot/media-compare/reference.ts).
  const { globalHash: baselineHash, perPaneHash, externalPoints, perRunPoints } = useMediaReference({
    runId,
    perSeriesStepMap,
    perSeriesPoints,
    seriesBaselineIndex: settings.baselineIndex,
    seriesBaselineFixedStep: settings.refFixedStep,
    external: extBase,
    externalScope: refMode,
    panes: effectiveMetrics,
    currentStep,
    safeIdx,
    missingImageMode: settings.missingImageMode,
  });
  // `baselineHash` is exposed by the hook (the "global" resolution) for
  // parity with the pre-refactor API; per-pane rendering below always goes
  // through `perPaneHash`, which already encodes the global/per-run
  // dispatch, so this alias only documents the shape — silence unused-var.
  void baselineHash;

  const baselineIdx = settings.baselineIndex;
  const hasBaseline = baselineIdx != null || extBase != null;

  // -----------------------------------------------------------------------
  // Per-pane reference resolution (with the split/blend dedup rule) fed into
  // the module's data hook, which turns resolved hashes into render-ready
  // items (image: {url, overlay}). Index-aligned with effectiveMetrics.
  // -----------------------------------------------------------------------
  const isOverlayMode = effectiveMode === "split" || effectiveMode === "blend";
  const paneHashArr = paneResolved.map((r) => r?.hash ?? null);
  const paneRefHashArr = effectiveMetrics.map((_, i) => {
    const hash = paneResolved[i]?.hash;
    const paneBaseline = perPaneHash(i);
    // Split/blend are explicit user choices — honor them whenever a
    // reference resolves, even when the content-addressed store deduped a
    // byte-identical prediction and reference to the same artifact hash.
    // Other modes keep the inequality so their fallback is unchanged.
    const hasRef = !!(paneBaseline && hash && (isOverlayMode || paneBaseline !== hash));
    return hasRef ? paneBaseline! : null;
  });

  // The resolved reference's OWN metadata per pane (WS-VC4) — a 3D module's
  // reference blob needs its own point-count/channels/bounds to render or
  // diff against the foreground (image never reads this; `useImageData`
  // ignores `referenceMetadata`). Looked up from whichever source
  // `useMediaReference` actually resolved the hash from: the external
  // reference's own points (global scope), its per-run points, or — the
  // "series-same-step" baseline — the card's own `perSeriesPoints`.
  const paneReferenceMetadata = useMemo(
    () => effectiveMetrics.map((_, i) => {
      const refHash = paneRefHashArr[i];
      if (!refHash) return null;
      if (extBase) {
        const pts = refMode === "per-run" ? perRunPoints(i) : externalPoints;
        return pts.find((p) => p.artifact_hash === refHash)?.artifact_metadata ?? null;
      }
      if (settings.baselineIndex != null) {
        const pts = perSeriesPoints[settings.baselineIndex] ?? [];
        return pts.find((p) => p.artifact_hash === refHash)?.artifact_metadata ?? null;
      }
      return null;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMetrics, paneRefHashArr, extBase, refMode, externalPoints, perRunPoints, perSeriesPoints, settings.baselineIndex],
  );
  // Cap simultaneously-rendered panes per the descriptor (WS-VC4 — D9 in the
  // design doc: "preserve per-type maxPanes... card enforces"). Image's
  // `caps.maxPanes` is +Infinity (unenforced), so `shownMetrics` is always
  // `=== effectiveMetrics` there — this is a total no-op for the image path.
  // 3D types cap at 4 (MAX_PANES parity, WebGL budget). Only the RENDERED/
  // FETCHED pane set is capped; series management (SeriesChipStrip, the
  // step slider's step range) still spans every `effectiveMetrics` entry,
  // matching the pre-refactor 3D cards (fetch-all, render-capped).
  const shownMetrics = useMemo(
    () => (Number.isFinite(caps.maxPanes) ? effectiveMetrics.slice(0, caps.maxPanes) : effectiveMetrics),
    [effectiveMetrics, caps.maxPanes],
  );

  const viewData = viewport.useData({
    hashes: paneHashArr.slice(0, shownMetrics.length),
    referenceHashes: paneRefHashArr.slice(0, shownMetrics.length),
    metadata: paneMetadata.slice(0, shownMetrics.length),
    referenceMetadata: paneReferenceMetadata.slice(0, shownMetrics.length),
  });

  // Settings handed to each Pane: identical to persisted settings, but with
  // the overlay pre-merged against DEFAULT_OVERLAY_SETTINGS (the pre-refactor
  // panes received `ovl`, not the raw `settings.overlay`).
  const paneSettings = useMemo(
    () => ({ ...settings, overlay: ovl }),
    [settings, ovl],
  );

  const Pane = viewport.Pane;

  // Live camera-sync group (WS-VC4, capability: `cameraSync`) — resolved
  // ONCE per card (never per pane, see `lib/camera-sync.ts`'s doc comment)
  // and threaded to every pane below. `caps.cameraSync` is false for image,
  // so `enabled` is always false there and this returns `null` — inert.
  const cameraSyncGroupId = useCameraSync(caps.cameraSync && !!settings.syncViews);

  // The selected native (card-rendered, non-compositor) mode, if any is both
  // chosen AND currently enabled (`enabledFor`, evaluated against the first
  // pane's resolved content/reference as a representative pair — mirrors the
  // pre-refactor 3D cards' single topology check rather than a per-pane one).
  // `caps.nativeModes` is `[]` for image, so this is always undefined there.
  const activeNativeSpec = activeNativeMode
    ? caps.nativeModes.find((nm) => nm.mode === activeNativeMode)
    : undefined;
  const nativeEnabled =
    !!activeNativeSpec && activeNativeSpec.enabledFor(viewData.items[0] ?? null, viewData.referenceItems[0] ?? null);
  const useNativeRender = nativeEnabled && !!viewport.nativeDiff;
  const RenderPane = useNativeRender ? viewport.nativeDiff!.render : Pane;

  const cardRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------
  // Multi-pane grid
  // -----------------------------------------------------------------------
  const renderMultiPaneGrid = () => {
    const splitPos = settings.splitPosition ?? 0.5;
    const blendAlpha = settings.blendAlpha ?? 0.5;
    const diffSubmode: DiffMode = settings.diffMode === "none" ? "absolute" : settings.diffMode;

    return (
      <div
        className="grid gap-1 flex-1 min-h-0 overflow-auto"
        style={{ gridTemplateColumns: `repeat(${settings.imageColumns ?? 2}, 1fr)` }}
      >
        {shownMetrics.length < effectiveMetrics.length && (
          <div className="col-span-full mono text-xs text-fg-subtle">
            {`showing ${shownMetrics.length} of ${effectiveMetrics.length}`}
          </div>
        )}
        {shownMetrics.map((m, paneIdx) => {
          if (refMode === "global" && settings.externalBaseline && m.name === settings.externalBaseline.name && (m.runId ?? runId) === (settings.externalBaseline.runId ?? runId)) return null;
          const fallbackStep = paneResolved[paneIdx]?.fallbackStep ?? null;
          const label = seriesLabel(m, runId, multipleRuns, availableRunIds)
            + (fallbackStep != null ? ` (step ${fallbackStep})` : "");

          return (
            <div key={seriesKey(m)} className="relative overflow-hidden">
              <RenderPane
                data={viewData.items[paneIdx] ?? null}
                reference={viewData.referenceItems[paneIdx] ?? null}
                settings={paneSettings}
                view={view}
                onViewChange={onPaneViewChange}
                mode={effectiveMode}
                diffMode={diffSubmode}
                nativeMode={activeNativeMode}
                cameraSyncGroupId={cameraSyncGroupId}
                isBaseline={refMode === "global" && baselineIdx === paneIdx}
                splitPosition={splitPos}
                blendAlpha={blendAlpha}
                onSplitPositionChange={(pos) => updateSettings({ splitPosition: pos })}
                label={label}
                isDraggable
                onDragStart={(e) => onImageDragStart(e, m)}
                onNaturalSize={onImageNaturalSize}
              />
            </div>
          );
        })}
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Single view — one pane, no reference (mode "normal").
  // -----------------------------------------------------------------------
  const renderSingleImageView = () => (
    <Pane
      data={viewData.items[0] ?? null}
      reference={null}
      settings={paneSettings}
      view={view}
      onViewChange={onPaneViewChange}
      mode="normal"
      diffMode="absolute"
      cameraSyncGroupId={cameraSyncGroupId}
      isDraggable
      onDragStart={(e) => onImageDragStart(e, effectiveMetrics[0]!)}
      onNaturalSize={onImageNaturalSize}
      label={metric.name}
    />
  );

  const renderImageContent = () => isMulti ? renderMultiPaneGrid() : renderSingleImageView();

  const handleScreenshot = () => {
    const panes: CompositePane[] = [];
    const cmap = settings.colormap ?? "none";

    if (isMulti) {
      for (let pi = 0; pi < effectiveMetrics.length; pi++) {
        const m = effectiveMetrics[pi]!;
        const stepMap = perSeriesStepMap[pi] ?? new Map();
        const steps = perSeriesPoints[pi]?.map((p) => p.step) ?? [];
        const { hash } = resolveArtifactAtStep(stepMap, currentStep, steps, settings.missingImageMode);
        const label = seriesLabel(m, runId, multipleRuns, availableRunIds);

        const paneBaseline = perPaneHash(pi);
        if (paneBaseline && hash && paneBaseline !== hash) {
          panes.push({ url: api.artifactUrl(paneBaseline), label: `${label} (REF)`, groupWithNext: true, skipColormap: true });
          panes.push({ url: hash ? api.artifactUrl(hash) : undefined, label });
        } else if (hash) {
          panes.push({ url: api.artifactUrl(hash), label });
        }
      }
    } else {
      if (firstResolved.hash) {
        panes.push({ url: api.artifactUrl(firstResolved.hash), label: metric.name });
      }
    }

    const colorbar = cmap !== "none"
      ? { lut: getColormapLUT(cmap as Exclude<Colormap, "none">), name: cmap, diverging: DIVERGING_COLORMAPS.has(cmap) }
      : undefined;

    exportImagesAsComposite(
      panes,
      safeName(metric.name) + `_step${currentStep}`,
      isMulti ? (settings.imageColumns ?? 2) : 1,
      colorbar,
    );
  };

  // Reset-view gating: "tracked" (image — enabled only when zoom/pan moved)
  // vs "always" (3D, VC5). `imageViewModified` reads the image2d view fields.
  const imageViewModified = settings.zoom !== 1 || settings.pan.x !== 0 || settings.pan.y !== 0;
  const viewModified = caps.resetView === "tracked" ? imageViewModified : true;
  // `viewport.onResetView` (WS-VC4) is the imperative alternative for types
  // whose view isn't settings-roundtripped (3D — see its doc comment);
  // absent (image) falls back to the original settings-based reset.
  const resetImageView = () =>
    viewport.onResetView
      ? viewport.onResetView(cardRef.current)
      : updateSettings(viewport.viewToSettingsPatch(viewport.defaultView()));

  // The mode selector iterates the descriptor's core modes (+ native modes,
  // gated by their `enabledFor`) instead of a hardcoded enum — so a viewport
  // type declaring fewer/native modes gets the right selector for free.
  // `caps.nativeModes` is `[]` for image, so `modeSelectorEntries` there is
  // exactly `coreModeEntries` (byte-identical selector).
  const coreModeEntries = caps.coreModes;
  const modeSelectorEntries: Array<{ value: string; label: string; disabled: boolean; title?: string }> = [
    ...coreModeEntries.map((m) => ({ value: m as string, label: MEDIA_COMPARE_MODE_LABELS[m], disabled: false, title: undefined })),
    ...caps.nativeModes.map((nm) => {
      const enabled = nm.enabledFor(viewData.items[0] ?? null, viewData.referenceItems[0] ?? null);
      return { value: nm.mode as string, label: nm.label, disabled: !enabled, title: enabled ? undefined : nm.disabledReason };
    }),
  ];
  const selectedModeValue: string = activeNativeMode ?? effectiveMode;
  const handleModeSelect = useCallback((value: string) => {
    if (isCoreCompareMode(value)) setMode(value);
    else setNativeMode(value);
  }, [setMode, setNativeMode]);

  // Mode/diff-submode selection lives in exactly ONE place: the bottom
  // pill row rendered below the media (see the `isMulti && hasBaseline`
  // block further down). Pre-WS-VCP, the header ALSO rendered a compact
  // <select> for both the compare mode and the diff sub-mode — true
  // duplication (both visible at once, unconditionally, whenever a
  // baseline was set). Header now keeps only genuinely header-level
  // actions (reset-view/download/screenshot/settings/add-to-comparison,
  // wired via CardShell props) plus the false-color colormap picker below
  // (a distinct control, not a compare-mode selector).
  const headerActions = (
    <>
      {caps.colorbar !== "never" && (
        <select
          value={settings.colormap ?? "none"}
          onChange={(e) => updateSettings({ colormap: e.target.value as Colormap })}
          className={`h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer ${(settings.colormap ?? "none") !== "none" ? "text-accent" : "text-fg-muted hover:text-fg"}`}
          title="False color map"
        >
          <option value="none">color: off</option>
          <option value="viridis">viridis</option>
          <option value="red-green">red-green</option>
          <option value="red-blue">red-blue</option>
        </select>
      )}
    </>
  );

  const settingsPanel = (
    <>
      {caps.postProcessing && (
      <>
      <SettingsSection title="Image" first />
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
        label="Exposure"
        value={settings.exposure}
        onChange={(v) => updateSettings({ exposure: v })}
        min={-3}
        max={3}
        step={0.01}
        format={(v) => v.toFixed(2)}
        description="EV stops: 0 = none, +1 = 2× brighter"
      />
      <Slider
        label="Offset"
        value={settings.offset}
        onChange={(v) => updateSettings({ offset: v })}
        min={-0.5}
        max={0.5}
        step={0.001}
        format={(v) => v.toFixed(3)}
        description="Uniform shift added after gamma"
      />
      <Toggle
        label="Flip sign"
        checked={settings.flipSign}
        onChange={(v) => updateSettings({ flipSign: v })}
        description="Invert / negate pixel values"
      />
      <Select<"auto" | "pixelated" | "crisp-edges">
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
        description={DIVERGING_COLORMAPS.has(settings.colormap ?? "none") ? "Diverging: 0 = center (white)" : undefined}
        value={settings.colormap ?? "none"}
        onChange={(v) => updateSettings({ colormap: v })}
        options={[
          { value: "none", label: "None (original)" },
          { value: "viridis", label: "Viridis" },
          { value: "red-green", label: "Red – Green (±)" },
          { value: "red-blue", label: "Red – Blue (±)" },
        ]}
      />
      {(settings.colormap ?? "none") !== "none" && (
        <ColormapSwatch colormap={settings.colormap as Exclude<Colormap, "none">} />
      )}
      <Select<"nothing" | "last_available">
        label="Missing image"
        value={settings.missingImageMode ?? "last_available"}
        onChange={(v) => updateSettings({ missingImageMode: v })}
        options={[
          { value: "nothing", label: "Show nothing" },
          { value: "last_available", label: "Show last available" },
        ]}
      />
      <Toggle
        label="Pixel axes"
        checked={settings.showAxes ?? false}
        onChange={(v) => updateSettings({ showAxes: v })}
        description="Show pixel coordinate ticks along edges"
      />
      </>
      )}
      {caps.overlays && hasOverlay && (
        <>
          <SettingsSection title="Overlays" />
          <Toggle
            label="Show overlays"
            checked={ovl.enabled}
            onChange={(v) => updateOverlay({ enabled: v })}
            description="Bounding boxes + segmentation masks (foreground image in split/blend)"
          />
          {ovl.enabled && (
            <>
              <Toggle
                label="Bounding boxes"
                checked={ovl.showBoxes}
                onChange={(v) => updateOverlay({ showBoxes: v })}
              />
              <Toggle
                label="Segmentation masks"
                checked={ovl.showMasks}
                onChange={(v) => updateOverlay({ showMasks: v })}
              />
              <Slider
                label="Score threshold"
                value={ovl.scoreThreshold}
                onChange={(v) => updateOverlay({ scoreThreshold: v })}
                min={0}
                max={1}
                step={0.01}
                format={(v) => v.toFixed(2)}
                description="Hide boxes scoring below this value"
              />
              <Slider
                label="Mask opacity"
                value={ovl.maskOpacity}
                onChange={(v) => updateOverlay({ maskOpacity: v })}
                min={0}
                max={1}
                step={0.01}
                format={(v) => v.toFixed(2)}
              />
              {overlayClasses.length > 0 && (
                <div className="mt-2">
                  <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">
                    Classes
                  </label>
                  <div className="flex flex-col gap-1">
                    {overlayClasses.map(([classId, name]) => {
                      const visible = !ovl.hiddenClasses.includes(classId);
                      return (
                        <button
                          key={classId}
                          type="button"
                          onClick={() => toggleOverlayClass(classId)}
                          className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs text-left hover:bg-bg-hover ${visible ? "text-fg" : "text-fg-subtle line-through"}`}
                        >
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-sm"
                            style={{
                              backgroundColor: overlayClassColor(classId),
                              opacity: visible ? 1 : 0.3,
                            }}
                          />
                          <span className="mono truncate flex-1">{name}</span>
                          <span className="text-[10px] text-fg-subtle">
                            {visible ? "shown" : "hidden"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
      {caps.cameraSync && (
        <Toggle
          label="Sync 3D views"
          checked={!!settings.syncViews}
          onChange={(v) => updateSettings({ syncViews: v })}
          description="Share orbit/zoom/pan live with this card's other panes and any other sync-enabled 3D card on this page"
        />
      )}
      {viewport.SettingsControls && (
        <viewport.SettingsControls settings={settings} update={updateSettings} meta={viewData.items[0] ?? null} />
      )}
      <SettingsSection title="Compare" />
      <Select<string>
        label="Mode"
        value={selectedModeValue}
        onChange={(v) => handleModeSelect(v)}
        options={modeSelectorEntries}
      />
      {effectiveMode === "diff" && !activeNativeMode && (
        <Select
          label="Diff sub-mode"
          value={settings.diffMode === "none" ? "absolute" : settings.diffMode}
          onChange={(v) => updateSettings({ diffMode: v })}
          options={[
            { value: "signed" as const, label: "Signed Error" },
            { value: "absolute" as const, label: "Absolute Error" },
            { value: "squared" as const, label: "Squared Error" },
            { value: "relative_signed" as const, label: "Relative Signed" },
            { value: "relative_absolute" as const, label: "Relative Absolute" },
            { value: "relative_squared" as const, label: "Relative Squared" },
          ]}
        />
      )}
      {isMulti && extBase && (
        <Select<"global" | "per-run">
          label="Reference mode"
          value={settings.referenceMode ?? "global"}
          onChange={(v) => setReferenceMode(v)}
          options={[
            { value: "per-run", label: "Per-run (each run uses its own copy of the ref tag)" },
            { value: "global", label: "Global (same ref for all runs)" },
          ]}
        />
      )}
      {/* Fixed-step reference control (VC5): the per-run-vs-global reference
          resolution already reads `settings.refFixedStep` (seriesBaselineFixedStep
          above), but the new unified panel lacked the UI the old bespoke
          CompareSettingsPanel exposed. Shown whenever a compare mode is active
          and there is a step axis — reachable for ALL visual cards (image +
          4 3D). Off = per-iteration (the reference tracks the same step as the
          primary series); On = pin the reference to one fixed step. Ignored
          once an external baseline is set. */}
      {(effectiveMode !== "normal" || activeNativeMode != null) && caps.hasSteps && (
        <>
          <Toggle
            label="Pin reference to a fixed step"
            checked={settings.refFixedStep != null}
            onChange={(v) => updateSettings({ refFixedStep: v ? currentStep : undefined })}
            description="Off = per-iteration (reference tracks the same step as the primary series)"
          />
          {settings.refFixedStep != null && (
            <Slider
              label="Reference step"
              value={settings.refFixedStep}
              onChange={(v) => updateSettings({ refFixedStep: Math.round(v) })}
              min={0}
              max={Math.max(...globalSteps, settings.refFixedStep, 1)}
              step={1}
              format={(v) => v.toFixed(0)}
            />
          )}
        </>
      )}
      <div className="mt-2">
        <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">
          Reference source
        </label>
        {settings.externalBaseline ? (
          <div className="flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
            <span className="mono truncate flex-1">{settings.externalBaseline.name}{settings.externalBaseline.runId && settings.externalBaseline.runId !== runId ? ` · ${shortRunLabel(settings.externalBaseline.runId)}` : ""}</span>
            <button
              type="button"
              onClick={() => updateSettings({ externalBaseline: undefined, baselineIndex: undefined, referenceMode: undefined })}
              className="text-fg-subtle hover:text-fg shrink-0"
              title="Remove external reference"
            >{"×"}</button>
          </div>
        ) : (
          <p className="text-[10px] text-fg-subtle mb-1">
            Drag a series chip onto the card, or select a tag below.
          </p>
        )}
        <ExternalBaselinePicker
          runId={runId}
          objectType={viewport.objectType}
          currentMetricName={metric.name}
          selected={settings.externalBaseline?.name}
          availableRunIds={availableRunIds}
          onSelect={(name, ctx, selectedRunId) => {
            updateSettings({
              externalBaseline: { runId: selectedRunId, name, context_hash: ctx },
              baselineIndex: undefined,
              diffMode: settings.diffMode === "none" ? "absolute" : settings.diffMode,
              mode: "diff",
            });
          }}
        />
      </div>
    </>
  );

  const modalContent = (
    <div className="h-[calc(100vh-12rem)] flex flex-col">
      {renderImageContent()}
      {caps.hasSteps && (
        <StepSlider
          points={globalStepPoints}
          currentIndex={safeIdx}
          onChange={onSliderChange}
          xAxis={settings.xAxis}
          onXAxisChange={(m) => updateSettings({ xAxis: m })}
          className="mt-3"
        />
      )}
      {!hasSelectionProvider && (
        <RunSelectionPanel
          selectedRunIds={selectedArray}
          allRunIds={availableRunIds}
          onClear={clear}
          runInfo={runInfoMap}
          label="Image selection"
        />
      )}
    </div>
  );

  return (
    <CardShell cardKind={viewport.objectType}
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={firstResolved.hash ? () => downloadArtifact(api.artifactUrl(firstResolved.hash!), artifactFilename(metric.name, currentStep, downloadMime, caps.downloadExtension)) : undefined}
      onScreenshot={caps.postProcessing ? handleScreenshot : undefined}
      addToComparisonSlot={<AddToComparisonButton cardType={viewport.objectType} series={compSeries} />}
      onResetView={resetImageView}
      viewModified={viewModified}
      headerActions={headerActions}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={settingsPanel}
      modalContent={modalContent}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>
      {anyLoading && globalSteps.length === 0 ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : globalSteps.length > 0 ? (
        <>
          <div
            ref={containerSizeRef}
            className={`relative min-h-0 flex flex-col overflow-hidden${resolveCardHeight(settings, undefined, MIN_HEIGHT) != null ? " flex-1" : ""}${refDropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
            style={{
              height: resolveCardHeight(settings, undefined, MIN_HEIGHT) == null ? autoHeight : undefined,
            }}
            onDragOver={onRefDragOver}
            onDragLeave={onRefDragLeave}
            onDrop={onRefDrop}
          >
          <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {renderImageContent()}
          </div>
          {caps.colorbar !== "never" && (settings.colormap ?? "none") !== "none" && (
            <Colorbar colormap={settings.colormap as Exclude<Colormap, "none">} isDiff={effectiveMode === "diff"} />
          )}
          </div>
          </div>

          {isMulti && hasBaseline && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
              {modeSelectorEntries.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  disabled={m.disabled}
                  title={m.title}
                  onClick={() => handleModeSelect(m.value)}
                  className={`rounded px-1.5 py-0.5 ${selectedModeValue === m.value ? "bg-accent/15 text-accent" : m.disabled ? "text-fg-subtle/50 cursor-not-allowed" : "text-fg-muted hover:bg-bg-hover hover:text-fg"}`}
                >
                  {m.label}
                </button>
              ))}
              {effectiveMode === "split" && !activeNativeMode && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.splitPosition ?? 0.5}
                  onChange={(e) => updateSettings({ splitPosition: Number(e.target.value) })}
                  className="w-24 accent-accent"
                  title="Split position"
                />
              )}
              {effectiveMode === "blend" && !activeNativeMode && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.blendAlpha ?? 0.5}
                  onChange={(e) => updateSettings({ blendAlpha: Number(e.target.value) })}
                  className="w-24 accent-accent"
                  title="Blend alpha"
                />
              )}
              {effectiveMode === "diff" && !activeNativeMode && (
                <select
                  value={settings.diffMode === "none" ? "absolute" : settings.diffMode}
                  onChange={(e) => updateSettings({ diffMode: e.target.value as ImageSettings["diffMode"] })}
                  className="h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer text-accent"
                  title="Diff sub-mode"
                >
                  <option value="absolute">absolute</option>
                  <option value="signed">signed</option>
                  <option value="squared">squared</option>
                  <option value="relative_absolute">rel. absolute</option>
                  <option value="relative_signed">rel. signed</option>
                  <option value="relative_squared">rel. squared</option>
                </select>
              )}
            </div>
          )}

          {caps.hasSteps && (
            <StepSlider
              points={globalStepPoints}
              currentIndex={safeIdx}
              onChange={onSliderChange}
              xAxis={settings.xAxis}
              onXAxisChange={(m) => updateSettings({ xAxis: m })}
              className="mt-3"
            />
          )}
        </>
      ) : (
        <div className="text-sm text-fg-muted">no image logged yet</div>
      )}

      <SeriesChipStrip
        metrics={effectiveMetrics}
        controlledSeries={controlledSeries}
        runId={runId}
        allRunIds={availableRunIds}
        onMetricsChange={(next) => updateSettings({ metrics: next, baselineIndex: undefined, paneWidths: undefined })}
        labelFn={seriesLabel}
        onClick={multipleRuns ? toggle : undefined}
        selectedIds={selectedIds}
      />

      {!hasSelectionProvider && (
        <RunSelectionPanel
          selectedRunIds={selectedArray}
          allRunIds={availableRunIds}
          onClear={clear}
          runInfo={runInfoMap}
          label="Image selection"
        />
      )}
      </>
    </CardShell>
  );
}

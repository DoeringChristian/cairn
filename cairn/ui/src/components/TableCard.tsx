import { useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { safeJsonParse } from "../lib/format";
import { downloadCsv, safeName } from "../lib/download";
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
import type { SeriesRef } from "./card-kit/use-card-series";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import NumberInput from "./settings/NumberInput";
import Toggle from "./settings/Toggle";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import RunSelectionPanel from "./RunSelectionPanel";
import StepSlider from "./StepSlider";
import {
  computeTableDiff,
  type CellComparison,
  type DiffTable,
} from "@cairn-plot/lib/cairn-plot/table-diff";
import {
  Table as ControlledTableGrid,
  type TableData,
} from "@cairn-plot/lib/cairn-plot/renderers";
import type { TableViewState } from "@cairn-plot/lib/cairn-plot/renderers/Table";

// Out of scope for v1 (noted per spec): media-in-cells, cross-table joins,
// derived columns. The grid is intentionally hand-rolled — no grid dependency.

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

/** Metadata attached to each logged table (no blob fetch needed). */
interface TableMeta {
  n_rows: number;
  n_cols: number;
  columns: string[];
  truncated: boolean;
  original_n_rows?: number;
}

interface TableSettings extends BaseCardSettings {
  metrics: SeriesRef[];
  paneWidths?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
  /** Rows shown per page in the client-side pager. */
  rowsPerPage: number;
  /** Column names hidden by the visibility toggles. */
  hiddenColumns: string[];
  /**
   * Show red/green diff colors on numeric cells vs the other compared runs.
   * Optional — defaults (computed at render time, not persisted until the
   * user touches the toggle) to ON when exactly 2 runs are compared.
   */
  diffMode?: boolean;
  /** Flip which direction (higher/lower) renders green vs red. */
  invertDiffColors?: boolean;
}

function TableGrid(
  props: Omit<React.ComponentProps<typeof ControlledTableGrid>, "state" | "onStateChange">,
) {
  const [state, setState] = useState<TableViewState>({ sort: null, filter: "", page: 0 });
  return <ControlledTableGrid {...props} state={state} onStateChange={setState} />;
}

const DEFAULT_ROWS_PER_PAGE = 100;

const DEFAULT_TABLE_SETTINGS = (seed: {
  name: string;
  context_hash: string;
}): TableSettings => ({
  version: 1,
  metrics: [seed],
  rowsPerPage: DEFAULT_ROWS_PER_PAGE,
  hiddenColumns: [],
});

// ---------------------------------------------------------------------------
// Blob fetching — parse the JSON table lazily, cached by artifact hash.
// ---------------------------------------------------------------------------
function useTableBlob(hash?: string | null) {
  return useQuery<TableData>({
    queryKey: ["table-blob", hash],
    enabled: !!hash,
    staleTime: Infinity,
    queryFn: async () => {
      const r = await fetch(api.artifactUrl(hash!));
      if (!r.ok) throw new Error(`fetch failed (${r.status})`);
      return (await r.json()) as TableData;
    },
  });
}

/**
 * Same query key/fn as `useTableBlob`, fanned out over N hashes — used at
 * the TableCard level to compute the cross-pane diff. Shares the react-query
 * cache with each pane's own `useTableBlob` call (identical query keys), so
 * this does not cause duplicate network fetches.
 */
function useTableBlobs(hashes: Array<string | null | undefined>) {
  return useQueries({
    queries: hashes.map((hash) => ({
      queryKey: ["table-blob", hash],
      enabled: !!hash,
      staleTime: Infinity,
      queryFn: async () => {
        const r = await fetch(api.artifactUrl(hash!));
        if (!r.ok) throw new Error(`fetch failed (${r.status})`);
        return (await r.json()) as TableData;
      },
    })),
  });
}

/** CSV-friendly cell (string | number) for downloadCsv. */
function csvCell(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

// ---------------------------------------------------------------------------
// One table pane (seed pane in single view; one per run in multi view).
// ---------------------------------------------------------------------------
function TablePane({
  runId,
  m,
  targetStep,
  rowsPerPage,
  hiddenColumns,
  diffStatuses,
  invertDiff,
}: {
  runId: string;
  m: SeriesRef;
  targetStep: number;
  rowsPerPage: number;
  hiddenColumns: string[];
  diffStatuses?: CellComparison[][];
  invertDiff?: boolean;
}) {
  const rid = m.runId ?? runId;
  const q = useSequence(rid, m.name, {
    context: m.context_hash || undefined,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const current = useMemo(
    () => resolveAtStep(points, targetStep) ?? points[0],
    [points, targetStep],
  );
  const blob = useTableBlob(current?.artifact_hash);

  if (q.isLoading || blob.isLoading) {
    return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (!current?.artifact_hash) {
    return <div className="text-sm text-fg-muted">no table logged yet</div>;
  }
  if (blob.isError || !blob.data) {
    return <div className="text-sm text-fg-muted">failed to load table</div>;
  }
  return (
    <TableGrid
      table={blob.data}
      rowsPerPage={rowsPerPage}
      hiddenColumns={hiddenColumns}
      diffStatuses={diffStatuses}
      invertDiff={invertDiff}
    />
  );
}

export default function TableCard({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<TableSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      makeDefaults: (seed, metrics) => ({
        ...DEFAULT_TABLE_SETTINGS(seed),
        metrics,
      }),
    });

  const { highlight: dropHighlight, dropProps } = useCardDrop(
    effectiveMetrics,
    updateSettings,
  );

  // Seed sequence (drives the step slider + column list + CSV + subtitle).
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  // Multi-metric: fetch all sequences to size the step slider (like Audio).
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

  const current = useMemo(
    () => resolveAtStep(points, currentStep) ?? points[0],
    [points, currentStep],
  );
  const meta = useMemo(
    () => safeJsonParse<TableMeta>(current?.artifact_metadata),
    [current],
  );
  const seedBlob = useTableBlob(current?.artifact_hash);

  // Column names for visibility toggles + CSV, from the seed table (falls
  // back to metadata column names before the blob loads).
  const allColumnNames = useMemo<string[]>(() => {
    if (seedBlob.data?.columns) return seedBlob.data.columns.map((c) => c.name);
    return meta?.columns ?? [];
  }, [seedBlob.data, meta]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const cardRef = useRef<HTMLDivElement>(null);
  const runMetaVersion = useRunMetadataVersion();

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();
  const { runInfoMap } = useRunInfo(allRunIds);

  const subtitle = useMemo(() => {
    const dims = meta ? `${meta.n_rows}×${meta.n_cols}` : `${metric.count} pts`;
    if (globalSteps.length > 0) {
      return `${dims} · step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`;
    }
    return dims;
  }, [meta, metric.count, globalSteps.length, currentStep, safeIdx]);

  const isMulti = effectiveMetrics.length > 1;

  // ---------------------------------------------------------------------
  // Cross-pane diff (multi-run comparison only). Reuses `multiQueries`
  // (already fetched for the step slider) to resolve each pane's current
  // artifact hash, fetches those blobs (cache-shared with each TablePane's
  // own fetch), and computes per-pane/row/column diff status.
  // ---------------------------------------------------------------------
  const diffMode = settings.diffMode ?? effectiveMetrics.length === 2;
  const invertDiffColors = settings.invertDiffColors ?? false;
  const diffEnabled = isMulti && diffMode;

  const panePointsList = useMemo(() => {
    if (!isMulti) return [];
    return multiQueries.map((mq) =>
      ((mq.data as SequenceResponse | undefined)?.points ?? []).filter((p) => p.artifact_hash),
    );
  }, [isMulti, multiQueries]);

  const paneCurrentHashes = useMemo(
    () =>
      panePointsList.map((pts) => (resolveAtStep(pts, currentStep) ?? pts[0])?.artifact_hash),
    [panePointsList, currentStep],
  );

  const paneBlobQueries = useTableBlobs(diffEnabled ? paneCurrentHashes : []);

  const paneDiffStatuses = useMemo<Array<CellComparison[][] | undefined>>(() => {
    if (!diffEnabled) return [];
    const entries = paneBlobQueries
      .map((q, i) => ({ i, data: q.data }))
      .filter((e): e is { i: number; data: TableData } => !!e.data);
    if (entries.length < 2) return [];
    const diffTables: DiffTable[] = entries.map((e) => e.data);
    const result = computeTableDiff(diffTables);
    const byPane: Array<CellComparison[][] | undefined> = new Array(paneBlobQueries.length).fill(
      undefined,
    );
    entries.forEach((e, idx) => {
      byPane[e.i] = result[idx];
    });
    return byPane;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffEnabled, paneBlobQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const downloadCurrentCsv = () => {
    const table = seedBlob.data;
    if (!table) return;
    const headers = table.columns.map((c) => c.name);
    const rows = table.data.map((row) => row.map(csvCell));
    downloadCsv(headers, rows, `${safeName(metric.name)}_step${current?.step ?? 0}.csv`);
  };

  const paneKeys = useMemo(() => effectiveMetrics.map(seriesKey), [effectiveMetrics]);
  const paneLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) {
      for (const m of effectiveMetrics) {
        map.set(seriesKey(m), shortRunLabel(m.runId ?? runId, allRunIds));
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multipleRuns, effectiveMetrics, allRunIds, runId, runMetaVersion]);

  const renderSingle = () => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash) {
      return <div className="text-sm text-fg-muted">no table logged yet</div>;
    }
    if (seedBlob.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (seedBlob.isError || !seedBlob.data) {
      return <div className="text-sm text-fg-muted">failed to load table</div>;
    }
    return (
      <>
        <TableGrid
          table={seedBlob.data}
          rowsPerPage={settings.rowsPerPage}
          hiddenColumns={settings.hiddenColumns}
        />
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
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={paneLabels}
        inModal={inModal}
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => updateSettings({ paneWidths: w })}
        renderPane={(key, i) => {
          const m = effectiveMetrics[i]!;
          return (
            <TablePane
              key={key}
              runId={runId}
              m={m}
              targetStep={currentStep}
              rowsPerPage={settings.rowsPerPage}
              hiddenColumns={settings.hiddenColumns}
              diffStatuses={paneDiffStatuses[i]}
              invertDiff={invertDiffColors}
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
      label="Table selection"
    />
  );

  const settingsPanel = (
    <>
      <NumberInput
        label="Rows per page"
        value={settings.rowsPerPage}
        onChange={(v) => updateSettings({ rowsPerPage: v ?? DEFAULT_ROWS_PER_PAGE })}
        min={1}
        step={10}
        placeholder="100"
        description="Client-side pagination size."
      />
      {isMulti && (
        <div className="py-1">
          <div className="mb-1 text-sm text-fg">Diff</div>
          <Toggle
            label="Diff colors"
            checked={diffMode}
            onChange={(v) => updateSettings({ diffMode: v })}
            description="Highlight numeric cells red/green vs the other compared runs. Defaults on for 2-run comparisons."
          />
          <Toggle
            label="Invert colors"
            checked={invertDiffColors}
            onChange={(v) => updateSettings({ invertDiffColors: v })}
            description="Flip which direction is green vs red (e.g. for lower-is-better metrics)."
          />
        </div>
      )}
      {allColumnNames.length > 0 && (
        <div className="py-1">
          <div className="mb-1 text-sm text-fg">Columns</div>
          <div className="flex flex-col gap-1">
            {allColumnNames.map((name) => (
              <Toggle
                key={name}
                label={name}
                checked={!settings.hiddenColumns.includes(name)}
                onChange={(visible) => {
                  const set = new Set(settings.hiddenColumns);
                  if (visible) set.delete(name);
                  else set.add(name);
                  updateSettings({ hiddenColumns: Array.from(set) });
                }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );

  return (
    <CardShell cardKind="table"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={320}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={seedBlob.data ? downloadCurrentCsv : undefined}
      addToComparisonSlot={<AddToComparisonButton cardType="table" series={compSeries} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      selectionPanel={selectionPanel}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex h-full flex-col">{renderContent(true)}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>{renderContent(false)}</>
    </CardShell>
  );
}

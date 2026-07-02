import { useEffect, useMemo, useRef, useState } from "react";
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

type ColumnType = "number" | "string" | "bool" | "other";

interface TableColumn {
  name: string;
  type: ColumnType;
}

interface TableData {
  columns: TableColumn[];
  data: unknown[][];
  truncated?: boolean;
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

/** Render a cell value; numbers get mono alignment via the caller. */
function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** CSV-friendly cell (string | number) for downloadCsv. */
function csvCell(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

// ---------------------------------------------------------------------------
// Hand-rolled grid: sortable, filterable, paginated. Self-contained state.
// ---------------------------------------------------------------------------
function TableGrid({
  table,
  rowsPerPage,
  hiddenColumns,
}: {
  table: TableData;
  rowsPerPage: number;
  hiddenColumns: string[];
}) {
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);

  const columns = table.columns ?? [];
  const rows = table.data ?? [];

  const visibleCols = useMemo(
    () => columns.map((_, i) => i).filter((i) => !hiddenColumns.includes(columns[i]!.name)),
    [columns, hiddenColumns],
  );

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      visibleCols.some((c) => formatCell(row[c]).toLowerCase().includes(needle)),
    );
  }, [rows, filter, visibleCols]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const { col, dir } = sort;
    const numeric = columns[col]?.type === "number";
    const factor = dir === "asc" ? 1 : -1;
    const copy = filtered.slice();
    copy.sort((ra, rb) => {
      const a = ra[col];
      const b = rb[col];
      // Nulls always sort last regardless of direction.
      const aNull = a === null || a === undefined;
      const bNull = b === null || b === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (numeric) {
        return (Number(a) - Number(b)) * factor;
      }
      return formatCell(a).localeCompare(formatCell(b), undefined, {
        sensitivity: "base",
        numeric: true,
      }) * factor;
    });
    return copy;
  }, [filtered, sort, columns]);

  const perPage = Math.max(1, rowsPerPage);
  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
  // Clamp page when the underlying data shrinks (filter/sort/step change).
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => sorted.slice(safePage * perPage, safePage * perPage + perPage),
    [sorted, safePage, perPage],
  );

  const toggleSort = (col: number) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null; // third click clears sort
    });
  };

  if (columns.length === 0) {
    return <div className="text-sm text-fg-muted">empty table</div>;
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <input
          className="input flex-1"
          type="text"
          placeholder="Filter rows…"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        />
        <span className="mono shrink-0 text-xs text-fg-subtle">
          {sorted.length}
          {sorted.length !== rows.length ? `/${rows.length}` : ""} rows
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-bg-elevated">
            <tr>
              {visibleCols.map((c) => {
                const col = columns[c]!;
                const active = sort?.col === c;
                const arrow = active ? (sort!.dir === "asc" ? " ▲" : " ▼") : "";
                return (
                  <th
                    key={c}
                    onClick={() => toggleSort(c)}
                    title={col.name}
                    className="cursor-pointer select-none whitespace-nowrap border-b border-border px-2 py-1 text-left font-semibold text-fg-muted hover:text-fg"
                  >
                    <span className="mono">{col.name}</span>
                    <span className="text-accent">{arrow}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, ri) => (
              <tr key={ri} className="odd:bg-bg even:bg-bg-hover/40">
                {visibleCols.map((c) => {
                  const numeric = columns[c]?.type === "number";
                  const text = formatCell(row[c]);
                  return (
                    <td
                      key={c}
                      title={text}
                      className={`max-w-[16rem] truncate border-b border-border px-2 py-1 text-fg ${
                        numeric ? "mono text-right" : ""
                      }`}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleCols.length}
                  className="px-2 py-3 text-center text-fg-muted"
                >
                  no matching rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {table.truncated && (
        <div className="mono mt-1 text-[10px] text-fg-subtle">
          table truncated to first 10,000 rows at log time
        </div>
      )}

      {pageCount > 1 && (
        <div className="mono mt-2 flex items-center justify-center gap-3 text-xs text-fg-muted">
          <button
            type="button"
            className="rounded px-2 py-0.5 hover:bg-bg-hover disabled:opacity-40"
            disabled={safePage <= 0}
            onClick={() => setPage(safePage - 1)}
          >
            {"← prev"}
          </button>
          <span>
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="rounded px-2 py-0.5 hover:bg-bg-hover disabled:opacity-40"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            {"next →"}
          </button>
        </div>
      )}
    </div>
  );
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
}: {
  runId: string;
  m: SeriesRef;
  targetStep: number;
  rowsPerPage: number;
  hiddenColumns: string[];
}) {
  const rid = m.runId ?? runId;
  const q = useSequence(rid, m.name, {
    context: m.context_hash || undefined,
    maxPoints: 200,
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
    <TableGrid table={blob.data} rowsPerPage={rowsPerPage} hiddenColumns={hiddenColumns} />
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
    maxPoints: 200,
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
                  maxPoints: 200,
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
    <CardShell
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

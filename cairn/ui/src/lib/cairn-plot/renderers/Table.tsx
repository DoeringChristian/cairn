import { useEffect, useMemo, useState } from "react";
import { diffCellClassName, type CellComparison } from "../table-diff";

export type ColumnType = "number" | "string" | "bool" | "other";

export interface TableColumn {
  name: string;
  type: ColumnType;
}

export interface TableData {
  columns: TableColumn[];
  data: unknown[][];
  truncated?: boolean;
}

export interface TableProps {
  table: TableData;
  rowsPerPage: number;
  hiddenColumns: string[];
  /** [rowIdx][colIdx] status, same row/col order as `table`. Optional — no diff coloring when omitted. */
  diffStatuses?: CellComparison[][];
  invertDiff?: boolean;
  className?: string;
}

/** Render a cell value; numbers get mono alignment via the caller. */
function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

// ---------------------------------------------------------------------------
// Hand-rolled grid: sortable, filterable, paginated. Self-contained state.
// ---------------------------------------------------------------------------
export default function Table({
  table,
  rowsPerPage,
  hiddenColumns,
  diffStatuses,
  invertDiff = false,
}: TableProps) {
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);

  const columns = table.columns ?? [];
  const rows = table.data ?? [];

  const visibleCols = useMemo(
    () => columns.map((_, i) => i).filter((i) => !hiddenColumns.includes(columns[i]!.name)),
    [columns, hiddenColumns],
  );

  // Track ORIGINAL row indices through filter/sort/page so diff colors
  // (keyed by original row index) stay attached to the correct row
  // regardless of visual position.
  const rowIdxs = useMemo(() => rows.map((_, i) => i), [rows]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rowIdxs;
    return rowIdxs.filter((i) =>
      visibleCols.some((c) => formatCell(rows[i]![c]).toLowerCase().includes(needle)),
    );
  }, [rowIdxs, rows, filter, visibleCols]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const { col, dir } = sort;
    const numeric = columns[col]?.type === "number";
    const factor = dir === "asc" ? 1 : -1;
    const copy = filtered.slice();
    copy.sort((ia, ib) => {
      const a = rows[ia]![col];
      const b = rows[ib]![col];
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
  }, [filtered, sort, columns, rows]);

  // ── Shared column model ────────────────────────────────────────────────
  // `table-layout: fixed` + an explicit <colgroup> give the <th> and every
  // <td> in a column ONE width, so the sticky header can never drift out of
  // alignment with the scrolled body and columns don't jitter as pages/filters
  // change the visible content. Widths are content-HINTED (proportional to the
  // widest value seen ACROSS THE WHOLE dataset, not just the current page — so
  // they're stable across pagination), each clamped to a sane char range, then
  // normalized to percentages of the table width.
  const colWidths = useMemo(() => {
    const MIN_CH = 6;
    const MAX_CH = 40;
    const SAMPLE = Math.min(rows.length, 500); // cap the scan for wide datasets
    const hints = visibleCols.map((c) => {
      // +2 leaves room for the sort arrow appended to the header.
      let w = columns[c]!.name.length + 2;
      for (let r = 0; r < SAMPLE; r++) {
        const len = formatCell(rows[r]![c]).length;
        if (len > w) w = len;
      }
      return Math.min(MAX_CH, Math.max(MIN_CH, w));
    });
    const total = hints.reduce((a, b) => a + b, 0) || 1;
    return hints.map((w) => (w / total) * 100);
  }, [visibleCols, columns, rows]);

  const perPage = Math.max(1, rowsPerPage);
  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
  // Clamp page when the underlying data shrinks (filter/sort/step change).
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);
  const safePage = Math.min(page, pageCount - 1);
  const pageRowIdxs = useMemo(
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

      {/* `scrollbar-gutter: stable` reserves the vertical-scrollbar gutter
          whether or not a scrollbar is showing, so the sticky header and the
          body stay aligned (and don't reflow) when the scrollbar appears on
          scroll or between pages — this matters on platforms with classic,
          space-taking scrollbars (Windows/Linux, macOS "always show"). */}
      <div
        className="flex-1 min-h-0 overflow-auto rounded border border-border"
        style={{ scrollbarGutter: "stable" }}
      >
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            {visibleCols.map((c, i) => (
              <col key={c} style={{ width: `${colWidths[i]}%` }} />
            ))}
          </colgroup>
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
                    className="cursor-pointer select-none border-b border-border px-2 py-1 text-left font-semibold text-fg-muted hover:text-fg"
                  >
                    {/* flex row: name truncates within the fixed column width,
                        the sort arrow never gets clipped off. */}
                    <span className="flex items-center">
                      <span className="mono truncate">{col.name}</span>
                      <span className="shrink-0 text-accent">{arrow}</span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRowIdxs.map((ri) => {
              const row = rows[ri]!;
              return (
                <tr key={ri} className="odd:bg-bg even:bg-bg-hover/40">
                  {visibleCols.map((c) => {
                    const numeric = columns[c]?.type === "number";
                    const text = formatCell(row[c]);
                    const status = diffStatuses?.[ri]?.[c];
                    const diffCls = status ? diffCellClassName(status, invertDiff) : "";
                    // Diff class is background-only (see table-diff.ts), so
                    // the default text color always applies regardless of
                    // diff status — no more mutual exclusivity needed.
                    return (
                      <td
                        key={c}
                        title={text}
                        className={`truncate border-b border-border px-2 py-1 text-fg ${
                          numeric ? "mono text-right" : ""
                        } ${diffCls}`}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {pageRowIdxs.length === 0 && (
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

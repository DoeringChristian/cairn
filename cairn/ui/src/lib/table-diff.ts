/**
 * Shared tabular-diff core.
 *
 * Pure, framework-free functions used by both TableCard (comparison panes)
 * and ComparisonOverviewTab (params/metrics summary tables) to classify
 * numeric data and compute per-cell red/green comparison status against
 * OTHER runs' aligned values. Kept dependency-free and side-effect-free so
 * it's easy to reason about / unit-test by reading.
 *
 * Two layers:
 *  1. Generic 1-D primitives (`toNumeric`, `isNumericSeries`,
 *     `computeCellStatuses`, `diffCellClassName`) — operate on a single
 *     "aligned group" of values (one per run/table) regardless of whether
 *     that group represents a column-across-tables (TableCard) or a
 *     row-across-runs (ComparisonOverviewTab's params/metrics tables).
 *  2. `computeTableDiff` — TableCard-specific row/column alignment across N
 *     whole tables (same shape as the `table` handler's JSON blob), built on
 *     top of the layer-1 primitives.
 */

// ---------------------------------------------------------------------------
// Layer 1: generic numeric classification + per-position comparison.
// ---------------------------------------------------------------------------

/** Per-cell comparison status relative to the OTHER aligned values. */
export type CellComparison = "higher" | "lower" | "equal" | "missing";

/**
 * Parse a cell value into a finite number, or `null` if it isn't numeric.
 * Booleans are deliberately NOT treated as numeric (per spec: "integer or
 * float data" — `correct: true/false` columns should never get diff colors).
 * Numeric-looking strings (e.g. a param value `"0.001"`) DO count, since
 * ComparisonOverviewTab's params are always strings even when the underlying
 * value is a number.
 */
export function toNumeric(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * A series (column-across-tables or row-across-runs) is "numeric" for diff
 * purposes when every non-null value parses as a finite number AND at least
 * one value is present. Tolerates nulls/missing entries; an all-null series
 * is NOT numeric (nothing to classify).
 */
export function isNumericSeries(values: unknown[]): boolean {
  let sawValue = false;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    sawValue = true;
    if (toNumeric(v) === null) return false;
  }
  return sawValue;
}

/**
 * Given the aligned numeric values for one group (one entry per run/table,
 * `null` for a missing cell), classify each position relative to the
 * others:
 *  - "higher": strictly greater than every other present value in the group
 *  - "lower": strictly less than every other present value in the group
 *  - "equal": present, but neither the strict max nor min (covers ties, a
 *    "middle" value among 3+ runs, and the case where there's nothing to
 *    compare against — fewer than 2 present values)
 *  - "missing": the cell itself has no value
 */
export function computeCellStatuses(values: Array<number | null>): CellComparison[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) {
    return values.map((v) => (v === null ? "missing" : "equal"));
  }
  const max = Math.max(...present);
  const min = Math.min(...present);
  if (max === min) {
    return values.map((v) => (v === null ? "missing" : "equal"));
  }
  return values.map((v) => {
    if (v === null) return "missing";
    if (v === max) return "higher";
    if (v === min) return "lower";
    return "equal";
  });
}

/**
 * Tailwind classes for a cell given its comparison status. Green = higher,
 * red = lower by default (matches git-diff-style coloring already used
 * elsewhere in the app, see ComparisonSourceTab.tsx's added/removed lines).
 * `invert` flips which direction renders green vs red — useful for
 * lower-is-better metrics like loss (higher is NOT always better).
 * "equal"/"missing" render with no extra classes (neutral, non-numeric, and
 * single-run cells all fall through to the caller's default styling).
 *
 * Background-only: this intentionally does NOT touch text color. The signal
 * is carried entirely by the tint, so cells keep their normal foreground
 * (text-fg / text-fg-muted, whatever the caller's non-diffed cells use) —
 * callers should apply their default text-color class unconditionally and
 * layer this class on top, rather than treating the two as mutually
 * exclusive. Opacity is bumped a notch from the original (900/20 with
 * colored text) to 900/30 so the tint stays clearly visible now that text
 * color no longer helps carry the signal.
 */
export function diffCellClassName(status: CellComparison, invert = false): string {
  if (status === "equal" || status === "missing") return "";
  const isHigher = status === "higher";
  const showGreen = invert ? !isHigher : isHigher;
  return showGreen ? "bg-green-900/30" : "bg-red-900/30";
}

// ---------------------------------------------------------------------------
// Layer 2: whole-table alignment (TableCard comparison panes).
// ---------------------------------------------------------------------------

export interface DiffColumn {
  name: string;
}

export interface DiffTable {
  columns: DiffColumn[];
  data: unknown[][];
}

/** [tableIdx][rowIdx][colIdx] -> status, indices match the input table's own row/column order. */
export type TableDiffResult = CellComparison[][][];

/** Column names that read as an id/key column when they're the FIRST column. */
const ID_LIKE_NAME = /^(id|key|.*_id)$/i;

/**
 * Row alignment key for one table: if all tables share the same id-like
 * first column name, rows are aligned by that column's value; otherwise
 * rows are aligned by position (row index).
 */
function detectKeyColumn(tables: DiffTable[]): number | null {
  if (tables.length < 2) return null;
  const firstNames = tables.map((t) => t.columns[0]?.name);
  if (firstNames.some((n) => !n)) return null;
  if (!firstNames.every((n) => n === firstNames[0])) return null;
  if (!ID_LIKE_NAME.test(firstNames[0]!)) return null;
  return 0;
}

function rowGroupKey(row: unknown[], keyCol: number | null, rowIdx: number): string {
  if (keyCol === null) return `#${rowIdx}`;
  const v = row[keyCol];
  return v === null || v === undefined ? `#null-${rowIdx}` : `id:${String(v)}`;
}

/**
 * Compute per-cell diff status across N tables. Tables need not share
 * identical column order (matched by name) or row counts — rows are grouped
 * by the detected key column (or by index when none exists), and only
 * columns present in a given table get a status for that table. Columns are
 * classified numeric using values pooled from every table that has them.
 *
 * Single-table input (or empty input) returns an all-"equal" result of the
 * same shape — callers should simply not invoke this for single-run cards
 * rather than rely on that behavior, but it's a safe no-op either way.
 */
export function computeTableDiff(tables: DiffTable[]): TableDiffResult {
  const result: TableDiffResult = tables.map((t) =>
    t.data.map((row) => row.map(() => "equal" as CellComparison)),
  );
  if (tables.length < 2) return result;

  const keyCol = detectKeyColumn(tables);

  // Group (tableIdx, rowIdx) pairs by aligned row key.
  const groups = new Map<string, Array<{ tableIdx: number; rowIdx: number }>>();
  tables.forEach((t, tableIdx) => {
    t.data.forEach((row, rowIdx) => {
      const k = rowGroupKey(row, keyCol, rowIdx);
      let g = groups.get(k);
      if (!g) {
        g = [];
        groups.set(k, g);
      }
      g.push({ tableIdx, rowIdx });
    });
  });

  // Numeric classification per column name, pooling values from all tables.
  const colNames = Array.from(new Set(tables.flatMap((t) => t.columns.map((c) => c.name))));
  const numericByName = new Map<string, boolean>();
  for (const name of colNames) {
    const pooled: unknown[] = [];
    for (const t of tables) {
      const idx = t.columns.findIndex((c) => c.name === name);
      if (idx === -1) continue;
      for (const row of t.data) pooled.push(row[idx]);
    }
    numericByName.set(name, isNumericSeries(pooled));
  }

  for (const name of colNames) {
    if (!numericByName.get(name)) continue;
    for (const members of groups.values()) {
      const located = members
        .map((m) => ({ m, ci: tables[m.tableIdx]!.columns.findIndex((c) => c.name === name) }))
        .filter((x) => x.ci !== -1);
      if (located.length === 0) continue;
      const values = located.map((x) => toNumeric(tables[x.m.tableIdx]!.data[x.m.rowIdx]![x.ci]));
      const statuses = computeCellStatuses(values);
      located.forEach((x, i) => {
        result[x.m.tableIdx]![x.m.rowIdx]![x.ci] = statuses[i]!;
      });
    }
  }

  return result;
}

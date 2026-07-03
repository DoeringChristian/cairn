/**
 * Modal for adding a new card to the current view.
 *
 * Shows all available metrics across the provided runs, grouped by type.
 * The user picks a metric → a card is created for it.
 *
 * In workspace/comparison mode, multiple runs may be provided; each run
 * that has the selected metric gets added as a series in the card.
 */

import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { useModalBehavior } from "../lib/use-modal-behavior";
import { isMultiRunCardType, type ComparisonSeriesRef, type MultiRunCardType } from "../lib/comparisons";
import { shortRunLabel } from "../lib/run-label";
const TYPE_LABELS: Record<string, string> = {
  scalar: "Scalars",
  image: "Images",
  figure: "Figures",
  audio: "Audio",
  video: "Video",
  histogram: "Histograms",
  tensor: "Tensors",
  text: "Text",
  table: "Tables",
  html: "HTML",
  markdown: "Markdown",
  pointcloud: "Point Clouds",
  artifact: "Artifacts",
  plugin: "Plugins",
  parallel: "Parallel Coords",
  scatter: "Scatter Plot",
  bar: "Bar Chart",
  tile: "Scalar Tiles",
};

const TYPE_ORDER = ["scalar", "image", "figure", "audio", "video", "histogram", "tensor", "text", "table", "html", "markdown", "pointcloud", "artifact", "plugin", "parallel", "scatter", "bar", "tile"];

/** One entry per run that has this metric. */
type SelectionRuns = Array<{ runId: string; context_hash: string }>;

/**
 * Result of a user picking an entry in the modal. Mirrors CardDescriptor's
 * discriminant: `series` for a real per-metric card, `multi-run` for the
 * parallel/scatter cards that span the comparison's runs.
 *
 * `manual-series` is the "custom overlay" escape hatch: an explicit list of
 * (run, metric) pairs picked one at a time via checkboxes, rather than one
 * metric name applied across every run — the two can carry *different*
 * metric names (e.g. run-a's `loss` overlaid with run-b's `accuracy`).
 * `ComparisonCard.series` already supports this shape end to end (each
 * entry carries its own name); this is purely a UI affordance to build one.
 */
export type AddCardSelection =
  | { kind: "series"; name: string; object_type: string; runs: SelectionRuns }
  | { kind: "multi-run"; cardType: MultiRunCardType; name: string; runs: SelectionRuns }
  | { kind: "manual-series"; object_type: string; series: ComparisonSeriesRef[] };

/** Internal grouping entry (also drives the type tabs). */
interface MetricEntry {
  name: string;
  object_type: string;
  runs: SelectionRuns;
}

/** Map a picked grouping entry to a typed selection. */
function toSelection(m: MetricEntry): AddCardSelection {
  if (isMultiRunCardType(m.object_type)) {
    return { kind: "multi-run", cardType: m.object_type, name: m.name, runs: m.runs };
  }
  return { kind: "series", name: m.name, object_type: m.object_type, runs: m.runs };
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Run IDs to scan for available metrics. */
  runIds: string[];
  /** Called when the user selects a metric. */
  onAdd: (selection: AddCardSelection) => void;
}

export default function AddCardModal({
  open,
  onClose,
  runIds,
  onAdd,
}: Props) {
  const [filter, setFilter] = useState("");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  // "Custom overlay" picker: build a scalar card from arbitrary (run, metric)
  // checkboxes instead of one metric name applied across every run.
  const [manualPickerOpen, setManualPickerOpen] = useState(false);
  const [manualSelected, setManualSelected] = useState<Set<string>>(new Set());

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setFilter("");
      setSelectedType(null);
      setManualPickerOpen(false);
      setManualSelected(new Set());
    }
  }, [open]);

  useModalBehavior(open, onClose);

  // Fetch sequences for all runs
  const seqQueries = useQueries({
    queries: open
      ? runIds.map((rid) => ({
          queryKey: qk.sequences(rid),
          queryFn: () => api.sequences(rid),
          staleTime: 10_000,
        }))
      : [],
  });

  // Build union of metrics across all runs
  const { grouped, allTypes } = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        object_type: string;
        runs: Array<{ runId: string; context_hash: string }>;
      }
    >();

    seqQueries.forEach((q, idx) => {
      const runId = runIds[idx];
      if (!runId || !q.data) return;
      for (const seq of q.data.sequences) {
        const key = `${seq.name}::${seq.object_type}`;
        const existing = map.get(key);
        if (existing) {
          if (!existing.runs.some((r) => r.runId === runId)) {
            existing.runs.push({ runId, context_hash: seq.context_hash });
          }
        } else {
          map.set(key, {
            name: seq.name,
            object_type: seq.object_type,
            runs: [{ runId, context_hash: seq.context_hash }],
          });
        }
      }
    });

    // Group by type
    const byType = new Map<string, typeof map extends Map<string, infer V> ? V[] : never>();
    for (const entry of map.values()) {
      const arr = byType.get(entry.object_type) ?? [];
      arr.push(entry);
      byType.set(entry.object_type, arr);
    }

    // Sort entries within each type
    for (const arr of byType.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Always show the workspace-level (multi-run) card types as options — they
    // aren't real object_types, so they never appear from the sequence scan.
    const multiRunDefaults: Array<{ type: string; name: string }> = [
      { type: "parallel", name: "Parallel Coordinates" },
      { type: "scatter", name: "Scatter Plot" },
      { type: "bar", name: "Bar Chart" },
      { type: "tile", name: "Scalar Tile" },
    ];
    for (const { type, name } of multiRunDefaults) {
      if (!byType.has(type)) {
        byType.set(type, [{
          name,
          object_type: type,
          runs: runIds.map((rid) => ({ runId: rid, context_hash: "" })),
        }]);
      }
    }

    const types = TYPE_ORDER.filter((t) => byType.has(t));
    // Add any unknown types
    for (const t of byType.keys()) {
      if (!types.includes(t)) types.push(t);
    }

    return { grouped: byType, allTypes: types };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, seqQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const activeType = selectedType ?? allTypes[0] ?? null;
  const metrics = activeType ? (grouped.get(activeType) ?? []) : [];
  const q = filter.trim().toLowerCase();
  const filtered = q ? metrics.filter((m) => m.name.toLowerCase().includes(q)) : metrics;

  const anyLoading = seqQueries.some((sq) => sq.isLoading);

  // Flatten the scalar metric groups into one (run, metric) combo per
  // checkbox — the custom-overlay picker's unit of selection.
  const scalarEntries = grouped.get("scalar") ?? [];
  const scalarCombos = useMemo(() => {
    const combos: Array<{
      key: string;
      runId: string;
      name: string;
      context_hash: string;
      label: string;
    }> = [];
    for (const entry of scalarEntries) {
      for (const r of entry.runs) {
        combos.push({
          key: `${r.runId}::${entry.name}::${r.context_hash}`,
          runId: r.runId,
          name: entry.name,
          context_hash: r.context_hash,
          label: `${shortRunLabel(r.runId, runIds)} · ${entry.name}`,
        });
      }
    }
    combos.sort((a, b) => a.label.localeCompare(b.label));
    return combos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scalarEntries, runIds]);
  const filteredScalarCombos = q
    ? scalarCombos.filter((c) => c.label.toLowerCase().includes(q))
    : scalarCombos;

  const toggleManualCombo = (key: string) => {
    setManualSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAddManual = () => {
    const series: ComparisonSeriesRef[] = scalarCombos
      .filter((c) => manualSelected.has(c.key))
      .map((c) => ({ runId: c.runId, name: c.name, context_hash: c.context_hash }));
    if (series.length === 0) return;
    onAdd({ kind: "manual-series", object_type: "scalar", series });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 flex flex-col m-8 mx-auto w-full max-w-2xl rounded-lg border border-border bg-bg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Add Card</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg text-lg"
            aria-label="Close"
          >
            {"\u00D7"}
          </button>
        </div>

        {/* Type tabs */}
        <div className="flex gap-1 border-b border-border px-4 py-2 overflow-x-auto">
          {allTypes.map((type) => {
            const count = grouped.get(type)?.length ?? 0;
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setSelectedType(type);
                  setManualPickerOpen(false);
                }}
                className={`shrink-0 rounded px-3 py-1 text-xs font-medium transition-colors ${
                  activeType === type
                    ? "bg-accent text-white"
                    : "text-fg-muted hover:bg-bg-hover hover:text-fg"
                }`}
              >
                {TYPE_LABELS[type] ?? type} ({count})
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={manualPickerOpen ? "Filter run · metric..." : "Filter metrics..."}
            className="input w-full"
            autoFocus
          />
          {activeType === "scalar" && (
            <button
              type="button"
              onClick={() => setManualPickerOpen((v) => !v)}
              className={`shrink-0 rounded px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                manualPickerOpen
                  ? "bg-accent text-white"
                  : "border border-border-subtle text-fg-muted hover:bg-bg-hover hover:text-fg"
              }`}
            >
              {manualPickerOpen ? "Back to metrics" : "Build custom overlay…"}
            </button>
          )}
        </div>

        {manualPickerOpen ? (
          <>
            {/* Custom overlay picker: arbitrary (run, metric) checkboxes —
                unlike the metric list above, entries may have different
                names (e.g. run-a's loss overlaid with run-b's accuracy). */}
            <p className="px-4 pt-2 text-xs text-fg-muted">
              Pick any combination of run × scalar metric — names don't need to match.
            </p>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
              {anyLoading && scalarCombos.length === 0 ? (
                <div className="p-4 text-sm text-fg-muted">Loading metrics...</div>
              ) : filteredScalarCombos.length === 0 ? (
                <div className="p-4 text-sm text-fg-muted">
                  {q ? "No matching run/metric combinations." : "No scalar metrics available."}
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {filteredScalarCombos.map((c) => (
                    <label
                      key={c.key}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-fg hover:bg-bg-hover cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={manualSelected.has(c.key)}
                        onChange={() => toggleManualCombo(c.key)}
                      />
                      <span className="mono truncate">{c.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <span className="text-xs text-fg-muted">
                {manualSelected.size} series selected
              </span>
              <button
                type="button"
                onClick={handleAddManual}
                disabled={manualSelected.size === 0}
                className="btn text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                + Add overlay card
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {anyLoading && metrics.length === 0 ? (
              <div className="p-4 text-sm text-fg-muted">Loading metrics...</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-sm text-fg-muted">
                {q ? "No matching metrics." : "No metrics of this type."}
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {filtered.map((m, i) => (
                    <button
                      key={`${m.name}::${m.object_type}::${i}`}
                      type="button"
                      onClick={() => {
                        onAdd(toSelection(m));
                        onClose();
                      }}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-fg hover:bg-bg-hover transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mono truncate">{m.name}</div>
                        <div className="text-xs text-fg-muted mt-0.5">
                          {m.runs.length} run{m.runs.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <span className="ml-2 shrink-0 text-xs text-accent">+ Add</span>
                    </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

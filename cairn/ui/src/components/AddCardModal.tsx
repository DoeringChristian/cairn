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
const TYPE_LABELS: Record<string, string> = {
  scalar: "Scalars",
  image: "Images",
  figure: "Figures",
  audio: "Audio",
  video: "Video",
  histogram: "Histograms",
  text: "Text",
  parallel: "Parallel Coords",
  scatter: "Scatter Plot",
};

const TYPE_ORDER = ["scalar", "image", "figure", "audio", "video", "histogram", "text", "parallel", "scatter"];

export interface AddCardSelection {
  name: string;
  object_type: string;
  /** One entry per run that has this metric. */
  runs: Array<{ runId: string; context_hash: string }>;
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

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setFilter("");
      setSelectedType(null);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Fetch sequences for all runs
  const seqQueries = useQueries({
    queries: open
      ? runIds.map((rid) => ({
          queryKey: ["sequences", rid],
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

    // Always show "parallel" and "scatter" as options
    if (!byType.has("parallel")) {
      byType.set("parallel", [{
        name: "Parallel Coordinates",
        object_type: "parallel",
        runs: runIds.map((rid) => ({ runId: rid, context_hash: "" })),
      }]);
    }
    if (!byType.has("scatter")) {
      byType.set("scatter", [{
        name: "Scatter Plot",
        object_type: "scatter",
        runs: runIds.map((rid) => ({ runId: rid, context_hash: "" })),
      }]);
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
                onClick={() => setSelectedType(type)}
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
        <div className="border-b border-border px-4 py-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter metrics..."
            className="input w-full"
            autoFocus
          />
        </div>

        {/* Metric list */}
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
                      onAdd(m);
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
      </div>
    </div>
  );
}

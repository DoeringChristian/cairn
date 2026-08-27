import { useEffect, useMemo, useRef, useState } from "react";
import { useSequences } from "../../api/hooks";
import { shortRunLabel } from "../../lib/run-label";

/**
 * The "+ Reference tag" dropdown every per-kind media card renders in its
 * settings panel: pick another series (same `object_type` ONLY — cross-type
 * references were dropped with the media-shell dissolution) as the compare
 * baseline. In a multi-run card a run selector scopes the tag list, and the
 * CURRENT metric from another run is a valid pick (it makes that run the
 * shared cross-run baseline); in a single-run card the current metric is
 * excluded (self-reference).
 */
export function ExternalBaselinePicker({
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

  const candidateMetrics = useMemo(() => {
    const seqs = data?.sequences ?? [];
    return seqs
      .filter((s) =>
        // A DIFFERENT metric is always a candidate reference. The SAME metric
        // is ALSO valid in a multi-run card: picking "<this metric> from run
        // X" makes run X the shared cross-run baseline every pane diffs/
        // splits against. Kept excluded in single-run cards, where it would
        // be a self-reference.
        (s.name !== currentMetricName || multiRun)
        && s.object_type === objectType)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, currentMetricName, objectType, multiRun]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? candidateMetrics.filter((m) => m.name.toLowerCase().includes(q)) : candidateMetrics;
  }, [candidateMetrics, filter]);

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
              placeholder="Filter tags..."
              className="input w-full text-xs"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-fg-subtle">No other {objectType} tags</div>
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
                  {multiRun && m.name === currentMetricName ? ` · ${runLabel(activeRunId)}` : ""}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Dropdown picker for adding metric tags to a card in workspace/comparison mode.
 * Fetches available metrics from all provided run IDs, filtered by object type.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import { useClickOutside } from "../../lib/use-click-outside";

interface Props {
  /** Run IDs to scan for available metrics. */
  runIds: string[];
  /** Filter by object type (e.g. "scalar", "image"). */
  objectType: string;
  /** Currently selected tag names. */
  selectedTags: string[];
  /** Called when the user picks a tag. Returns tag name + all runs that have it. */
  onAdd: (tagName: string, runs: Array<{ runId: string; context_hash: string }>) => void;
}

export default function TagPicker({
  runIds,
  objectType,
  selectedTags,
  onAdd,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const seqQueries = useQueries({
    queries: open
      ? runIds.map((rid) => ({
          queryKey: qk.sequences(rid),
          queryFn: () => api.sequences(rid),
          staleTime: 10_000,
        }))
      : [],
  });

  // Map tag name → runs that have it
  const tagRunMap = useMemo(() => {
    const map = new Map<string, Array<{ runId: string; context_hash: string }>>();
    seqQueries.forEach((q, idx) => {
      const rid = runIds[idx];
      if (!rid || !q.data) return;
      for (const seq of q.data.sequences) {
        if (seq.object_type !== objectType) continue;
        const arr = map.get(seq.name) ?? [];
        if (!arr.some((r) => r.runId === rid)) {
          arr.push({ runId: rid, context_hash: seq.context_hash });
        }
        map.set(seq.name, arr);
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectType, runIds, seqQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const available = useMemo(() => {
    const selected = new Set(selectedTags);
    let arr = Array.from(tagRunMap.keys()).filter((n) => !selected.has(n)).sort();
    const q = filter.trim().toLowerCase();
    if (q) arr = arr.filter((n) => n.toLowerCase().includes(q));
    return arr;
  }, [tagRunMap, selectedTags, filter]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const excludeRefs = useMemo(() => [btnRef], []);
  useClickOutside(dropdownRef, () => setOpen(false), open, excludeRefs);

  return (
    <div className="relative mt-1">
      <button
        ref={btnRef}
        type="button"
        onClick={() => { setOpen((v) => !v); setFilter(""); }}
        className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg"
      >
        <span aria-hidden="true">+</span> Add tag
      </button>
      {open && (
        <div
          ref={dropdownRef}
          className="absolute left-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-lg"
        >
          <div className="border-b border-border-subtle p-2">
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter metrics..."
              className="input w-full"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {available.length === 0 ? (
              <div className="px-3 py-2 text-xs text-fg-subtle">
                {seqQueries.some((q) => q.isLoading) ? "Loading..." : "No matching metrics"}
              </div>
            ) : (
              available.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onAdd(name, tagRunMap.get(name) ?? []);
                    setFilter("");
                  }}
                  className="mono block w-full truncate px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
                >
                  {name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

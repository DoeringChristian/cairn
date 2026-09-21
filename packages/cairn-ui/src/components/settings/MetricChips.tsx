import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSequences } from "../../api/hooks";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import { useClickOutside } from "../../lib/use-click-outside";
import type { SequenceMeta } from "../../api/types";

export interface ChipValue {
  name: string;
  context_hash: string;
}

interface Props {
  /** Single run ID (classic single-run mode). */
  runId: string;
  /** Multiple run IDs for workspace/comparison mode. When set, fetches from all runs. */
  runIds?: string[];
  value: ChipValue[];
  onChange: (next: ChipValue[]) => void;
  /** Called when adding a tag in multi-run mode, with the runs that have it. */
  onAddTag?: (tagName: string, runs: Array<{ runId: string; context_hash: string }>) => void;
  /** Filter available metrics; default: scalar only. Pass "any" to include all types. */
  objectType?: string | "scalar" | "any";
  /** When true, chips show only tag names (no context hash) and dedup by name. */
  tagMode?: boolean;
}

function chipKey(c: ChipValue): string {
  return `${c.name}::${c.context_hash}`;
}

function chipLabel(name: string, contextHash: string, tagMode: boolean): string {
  if (tagMode) return name;
  if (contextHash && contextHash.length > 0) {
    return `${name} ${contextHash.slice(0, 6)}`;
  }
  return name;
}

export default function MetricChips({
  runId,
  runIds,
  value,
  onChange,
  onAddTag,
  objectType = "scalar",
  tagMode = false,
}: Props) {
  // Single-run fetch (used when runIds is not provided)
  const singleQ = useSequences(runIds ? "" : runId);

  // Multi-run fetch
  const multiQueries = useQueries({
    queries: (runIds ?? []).map((rid) => ({
      queryKey: qk.sequences(rid),
      queryFn: () => api.sequences(rid),
      staleTime: 10_000,
    })),
  });

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // In tag mode, selected keys are just tag names
  const selectedKeys = useMemo(() => {
    if (tagMode) {
      return new Set(value.map((c) => c.name));
    }
    return new Set(value.map(chipKey));
  }, [value, tagMode]);

  // Display chips: in tag mode, deduplicate by name
  const displayChips = useMemo(() => {
    if (!tagMode) return value;
    const seen = new Set<string>();
    return value.filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });
  }, [value, tagMode]);

  // Map tag name → runs (for multi-run mode)
  const tagRunMap = useMemo(() => {
    if (!runIds) return null;
    const map = new Map<string, Array<{ runId: string; context_hash: string }>>();
    multiQueries.forEach((q, idx) => {
      const rid = runIds[idx];
      if (!rid || !q.data) return;
      for (const seq of q.data.sequences) {
        if (objectType !== "any" && seq.object_type !== objectType) continue;
        const arr = map.get(seq.name) ?? [];
        if (!arr.some((r) => r.runId === rid)) {
          arr.push({ runId: rid, context_hash: seq.context_hash });
        }
        map.set(seq.name, arr);
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, objectType, multiQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const availableMetrics = useMemo(() => {
    if (runIds && tagRunMap) {
      // Multi-run: show unique tag names not already selected
      let arr = Array.from(tagRunMap.keys())
        .filter((n) => !selectedKeys.has(n))
        .sort();
      const q = filter.trim().toLowerCase();
      if (q) arr = arr.filter((n) => n.toLowerCase().includes(q));
      return arr.map((name) => ({ name, context_hash: "" }));
    }
    // Single-run mode
    const sequences: SequenceMeta[] = singleQ.data?.sequences ?? [];
    const byType =
      objectType === "any"
        ? sequences
        : sequences.filter((s) => s.object_type === objectType);
    const notSelected = byType.filter((s) => {
      const key = tagMode ? s.name : chipKey({ name: s.name, context_hash: s.context_hash });
      return !selectedKeys.has(key);
    });
    // Deduplicate by name in tag mode
    let result = notSelected;
    if (tagMode) {
      const seen = new Set<string>();
      result = notSelected.filter((s) => {
        if (seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
      });
    }
    const q = filter.trim().toLowerCase();
    if (!q) return result.map((s) => ({ name: s.name, context_hash: s.context_hash }));
    return result
      .filter((s) => s.name.toLowerCase().includes(q))
      .map((s) => ({ name: s.name, context_hash: s.context_hash }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, tagRunMap, singleQ.data, objectType, selectedKeys, filter, tagMode]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  const excludeRefs = useMemo(() => [addButtonRef], []);
  useClickOutside(dropdownRef, () => setOpen(false), open, excludeRefs);

  const removeChip = (chip: ChipValue) => {
    if (tagMode) {
      onChange(value.filter((c) => c.name !== chip.name));
    } else {
      onChange(value.filter((c) => chipKey(c) !== chipKey(chip)));
    }
  };

  const addChip = (chip: ChipValue) => {
    if (runIds && onAddTag && tagRunMap) {
      // Multi-run: delegate to parent with run info
      const runs = tagRunMap.get(chip.name) ?? [];
      onAddTag(chip.name, runs);
    } else {
      if (selectedKeys.has(tagMode ? chip.name : chipKey(chip))) return;
      onChange([...value, chip]);
    }
    setFilter("");
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {displayChips.map((chip) => (
          <span
            key={tagMode ? chip.name : chipKey(chip)}
            className="mono inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted"
          >
            <span>{chipLabel(chip.name, chip.context_hash, tagMode)}</span>
            <button
              type="button"
              onClick={() => removeChip(chip)}
              aria-label={`Remove ${chip.name}`}
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg"
            >
              <span aria-hidden="true" className="text-sm leading-none">×</span>
            </button>
          </span>
        ))}
        <button
          ref={addButtonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Add metric"
          aria-expanded={open}
          className="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-bg text-xs text-fg-muted hover:border-accent hover:text-fg"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
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
              placeholder="Filter metrics…"
              className="input"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {availableMetrics.length === 0 ? (
              <div className="px-3 py-2 text-xs text-fg-subtle">
                {(runIds ? multiQueries : [singleQ]).some((q) => q.isLoading)
                  ? "Loading…"
                  : "no matching metrics"}
              </div>
            ) : (
              availableMetrics.map((m) => (
                <button
                  key={tagMode ? m.name : `${m.name}::${m.context_hash}`}
                  type="button"
                  onClick={() => addChip(m)}
                  className="mono block w-full truncate px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
                >
                  {chipLabel(m.name, m.context_hash, tagMode)}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

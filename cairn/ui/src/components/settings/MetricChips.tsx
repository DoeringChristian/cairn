import { useEffect, useMemo, useRef, useState } from "react";
import { useSequences } from "../../api/hooks";
import type { SequenceMeta } from "../../api/types";

export interface ChipValue {
  name: string;
  context_hash: string;
}

interface Props {
  runId: string;
  value: ChipValue[];
  onChange: (next: ChipValue[]) => void;
  /** Filter available metrics; default: scalar only. Pass "any" to include all types. */
  objectType?: string | "scalar" | "any";
}

function chipKey(c: ChipValue): string {
  return `${c.name}::${c.context_hash}`;
}

function chipLabel(name: string, contextHash: string): string {
  if (contextHash && contextHash.length > 0) {
    return `${name} ${contextHash.slice(0, 6)}`;
  }
  return name;
}

export default function MetricChips({
  runId,
  value,
  onChange,
  objectType = "scalar",
}: Props) {
  const { data } = useSequences(runId);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedKeys = useMemo(
    () => new Set(value.map(chipKey)),
    [value],
  );

  const availableMetrics = useMemo<SequenceMeta[]>(() => {
    const sequences: SequenceMeta[] = data?.sequences ?? [];
    const byType =
      objectType === "any"
        ? sequences
        : sequences.filter((s) => s.object_type === objectType);
    const notSelected = byType.filter(
      (s) => !selectedKeys.has(chipKey({ name: s.name, context_hash: s.context_hash })),
    );
    const q = filter.trim().toLowerCase();
    if (!q) return notSelected;
    return notSelected.filter((s) => s.name.toLowerCase().includes(q));
  }, [data, objectType, selectedKeys, filter]);

  // Focus the filter input when the dropdown opens.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (dropdownRef.current?.contains(target)) return;
      if (addButtonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const removeChip = (chip: ChipValue) => {
    onChange(value.filter((c) => chipKey(c) !== chipKey(chip)));
  };

  const addChip = (chip: ChipValue) => {
    if (selectedKeys.has(chipKey(chip))) return;
    onChange([...value, chip]);
    setFilter("");
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((chip) => (
          <span
            key={chipKey(chip)}
            className="mono inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted"
          >
            <span>{chipLabel(chip.name, chip.context_hash)}</span>
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
                no matching metrics
              </div>
            ) : (
              availableMetrics.map((m) => (
                <button
                  key={`${m.name}::${m.context_hash}`}
                  type="button"
                  onClick={() =>
                    addChip({ name: m.name, context_hash: m.context_hash })
                  }
                  className="mono block w-full truncate px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
                >
                  {chipLabel(m.name, m.context_hash)}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

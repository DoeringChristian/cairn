import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Run } from "../api/types";
import { safeJsonParse } from "../lib/format";
import { useProjectTags } from "../lib/use-project-tags";
import SettingsPopover from "./SettingsPopover";
import TagInput from "./TagInput";

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  selectedRunIds: Set<string>;
  runs: Run[];
}

export default function BulkTagEditor({ open, onClose, anchorRef, selectedRunIds, runs }: Props) {
  const qc = useQueryClient();
  const [newTag, setNewTag] = useState("");
  const [busy, setBusy] = useState(false);

  // Build tag → set of run IDs that have it.
  const tagMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of runs) {
      if (!selectedRunIds.has(r.id)) continue;
      const tags = safeJsonParse<string[]>(r.tags) ?? [];
      for (const t of tags) {
        let s = map.get(t);
        if (!s) { s = new Set(); map.set(t, s); }
        s.add(r.id);
      }
    }
    return map;
  }, [runs, selectedRunIds]);

  const allTags = useMemo(() => [...tagMap.keys()].sort(), [tagMap]);
  const allProjectTags = useProjectTags(runs);
  const totalSelected = selectedRunIds.size;

  const updateTags = useCallback(async (
    runId: string,
    updater: (prev: string[]) => string[],
  ) => {
    const run = runs.find((r) => r.id === runId);
    const prev = safeJsonParse<string[]>(run?.tags ?? null) ?? [];
    const next = updater(prev);
    await api.setTags(runId, next);
  }, [runs]);

  const addTagValue = useCallback(async (value: string) => {
    const tag = value.trim();
    if (!tag) return;
    setBusy(true);
    try {
      const promises = [];
      for (const runId of selectedRunIds) {
        const existing = tagMap.get(tag);
        if (existing?.has(runId)) continue;
        promises.push(updateTags(runId, (prev) => [...prev, tag]));
      }
      await Promise.all(promises);
      setNewTag("");
      qc.invalidateQueries({ queryKey: ["runs"] });
    } finally {
      setBusy(false);
    }
  }, [selectedRunIds, tagMap, updateTags, qc]);

  const addTag = useCallback(() => addTagValue(newTag), [newTag, addTagValue]);

  const removeTag = useCallback(async (tag: string) => {
    setBusy(true);
    try {
      const runIds = tagMap.get(tag);
      if (!runIds) return;
      await Promise.all(
        [...runIds].map((runId) =>
          updateTags(runId, (prev) => prev.filter((t) => t !== tag)),
        ),
      );
      qc.invalidateQueries({ queryKey: ["runs"] });
    } finally {
      setBusy(false);
    }
  }, [tagMap, updateTags, qc]);

  return (
    <SettingsPopover open={open} onClose={onClose} anchorRef={anchorRef} title="Bulk tag editor">
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">
          <TagInput
            className="flex-1"
            value={newTag}
            onChange={setNewTag}
            onCommit={(tag) => addTagValue(tag)}
            onCancel={() => setNewTag("")}
            suggestions={allProjectTags}
            exclude={allTags}
            placeholder="New tag..."
            disabled={busy}
          />
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={addTag}
            disabled={busy || !newTag.trim()}
          >
            Add
          </button>
        </div>

        {allTags.length > 0 ? (
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {allTags.map((tag) => {
              const count = tagMap.get(tag)?.size ?? 0;
              const partial = count < totalSelected;
              return (
                <div
                  key={tag}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1 border border-border-subtle text-xs"
                >
                  <span className="mono truncate flex-1">{tag}</span>
                  {partial && (
                    <span className="text-[10px] text-fg-subtle shrink-0">
                      {count}/{totalSelected}
                    </span>
                  )}
                  <button
                    type="button"
                    className="text-fg-muted hover:text-status-failed shrink-0"
                    onClick={() => removeTag(tag)}
                    disabled={busy}
                    title={`Remove "${tag}" from ${count} run(s)`}
                  >
                    {"\u00D7"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">No tags on selected runs.</p>
        )}
      </div>
    </SettingsPopover>
  );
}

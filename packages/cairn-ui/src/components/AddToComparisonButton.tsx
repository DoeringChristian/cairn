/**
 * "Add to comparison" button + popover, extracted from the per-card pattern.
 *
 * Renders: a "+" button, a SettingsPopover listing existing comparisons +
 * a "create new" form, and a brief confirmation message on success.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
  type ComparisonSeriesRef,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import { formatRelative } from "../lib/format";
import SettingsPopover from "./SettingsPopover";

interface Props {
  /** Card object type, e.g. "scalar", "image", "audio", etc. */
  cardType: string;
  /** Series refs to add when the user picks a comparison. */
  series: ComparisonSeriesRef[];
}

export default function AddToComparisonButton({ cardType, series }: Props) {
  const projectId = useProjectId();
  const { comparisons, refresh: refreshComparisons } =
    useComparisons(projectId ?? "");

  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);
  const [newName, setNewName] = useState("");

  // Clean up timer on unmount.
  useEffect(() => {
    return () => {
      if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current);
    };
  }, []);

  const addToComp = useCallback(
    (comparisonId: string, compName: string) => {
      if (!projectId) return;
      addCardToComparison(projectId, comparisonId, {
        type: cardType as "scalar",
        series,
      });
      refreshComparisons();
      if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current);
      setConfirm(`Added to ${compName}`);
      confirmTimer.current = window.setTimeout(() => {
        setConfirm(null);
        setOpen(false);
      }, 1500);
    },
    [projectId, cardType, series, refreshComparisons],
  );

  const createAndAdd = useCallback(() => {
    if (!projectId) return;
    const name = newName.trim() || "New comparison";
    const cmp = createComparison(projectId, name);
    addToComp(cmp.id, cmp.name);
    setNewName("");
  }, [projectId, newName, addToComp]);

  if (!projectId) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
        aria-label="Add to comparison"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Add to comparison"
      >
        {"\u002B"}
      </button>
      <SettingsPopover
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirm(null);
        }}
        anchorRef={btnRef}
        title="Add to comparison"
      >
        {confirm ? (
          <p className="text-xs text-accent">{confirm}</p>
        ) : (
          <>
            {comparisons.length === 0 ? (
              <p className="text-xs text-fg-subtle mb-2">No comparisons yet.</p>
            ) : (
              <div className="flex flex-col gap-1 mb-2 max-h-48 overflow-y-auto">
                {comparisons.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addToComp(c.id, c.name)}
                    className="text-left text-xs text-fg-muted hover:bg-bg-hover rounded px-2 py-1.5 border border-border-subtle"
                  >
                    <div className="truncate">{c.name}</div>
                    <div className="text-[10px] text-fg-subtle">
                      {c.cards.length} card(s) · {formatRelative(c.createdAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-border-subtle pt-2 mt-1">
              <label className="text-[10px] uppercase tracking-wide text-fg-muted block mb-1">
                Create new comparison
              </label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createAndAdd();
                    }
                  }}
                  placeholder="Name"
                  className="input flex-1 text-xs"
                />
                <button type="button" onClick={createAndAdd} className="btn text-xs px-2">
                  Create
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn w-full mt-2 text-xs"
            >
              Cancel
            </button>
          </>
        )}
      </SettingsPopover>
    </>
  );
}

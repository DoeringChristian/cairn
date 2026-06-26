import { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface RunSelectionValue {
  selectedIds: Set<string>;
  selectedArray: string[];
  toggle: (runId: string) => void;
  clear: () => void;
}

export const RunSelectionContext = createContext<RunSelectionValue | null>(null);

export function useRunSelectionState(): RunSelectionValue {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((runId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const selectedArray = useMemo(() => [...selectedIds], [selectedIds]);

  return { selectedIds, selectedArray, toggle, clear };
}

export function useRunSelection(): RunSelectionValue {
  const ctx = useContext(RunSelectionContext);
  const local = useRunSelectionState();
  return ctx ?? local;
}

export function useRunSelectionHasProvider(): boolean {
  return useContext(RunSelectionContext) !== null;
}

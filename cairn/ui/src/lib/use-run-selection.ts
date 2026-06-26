import { useCallback, useMemo, useState } from "react";

export function useRunSelection() {
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

  return { selectedIds, selectedArray, toggle, clear } as const;
}

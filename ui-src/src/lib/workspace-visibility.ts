import { useCallback, useMemo, useState } from "react";

export interface WorkspaceVisibility {
  hiddenRunIds: Set<string>;
}

function storageKey(projectId: string): string {
  return `cairn:workspace-visibility:${projectId}`;
}

function loadHidden(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    // ignore
  }
  return new Set();
}

function saveHidden(projectId: string, hidden: Set<string>): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(Array.from(hidden)));
  } catch {
    // ignore
  }
}

export function useWorkspaceVisibility(
  projectId: string,
  allRunIds: string[],
): {
  visibility: WorkspaceVisibility;
  isVisible: (runId: string) => boolean;
  toggle: (runId: string) => void;
  showAll: () => void;
  hideAll: () => void;
} {
  const [hiddenRunIds, setHiddenRunIds] = useState<Set<string>>(() =>
    loadHidden(projectId),
  );

  const visibility = useMemo<WorkspaceVisibility>(
    () => ({ hiddenRunIds }),
    [hiddenRunIds],
  );

  const isVisible = useCallback(
    (runId: string) => !hiddenRunIds.has(runId),
    [hiddenRunIds],
  );

  const toggle = useCallback(
    (runId: string) => {
      setHiddenRunIds((prev) => {
        const next = new Set(prev);
        if (next.has(runId)) {
          next.delete(runId);
        } else {
          next.add(runId);
        }
        saveHidden(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  const showAll = useCallback(() => {
    const next = new Set<string>();
    saveHidden(projectId, next);
    setHiddenRunIds(next);
  }, [projectId]);

  const hideAll = useCallback(() => {
    const next = new Set(allRunIds);
    saveHidden(projectId, next);
    setHiddenRunIds(next);
  }, [projectId, allRunIds]);

  return { visibility, isVisible, toggle, showAll, hideAll };
}

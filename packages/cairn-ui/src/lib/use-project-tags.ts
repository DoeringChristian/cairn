import { useMemo } from "react";
import type { Run } from "../api/types";
import { safeJsonParse } from "./format";

/** Extract unique sorted tags from a list of runs. */
export function useProjectTags(runs: Run[]): string[] {
  return useMemo(() => {
    const tags = new Set<string>();
    for (const r of runs) {
      for (const t of safeJsonParse<string[]>(r.tags) ?? []) tags.add(t);
    }
    return Array.from(tags).sort();
  }, [runs]);
}

/**
 * React context for the ambient project id.
 *
 * Several leaf components (most notably `ScalarPlotCard`) need the current
 * project id to interact with project-scoped storage (e.g. comparisons).
 * Rather than thread `projectId` through every intermediate (`CardGrid`,
 * `DraggableCard`, …) we hoist it to a context that page components supply.
 */

import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";

const ProjectIdContext = createContext<string | null>(null);

export function ProjectProvider({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return createElement(ProjectIdContext.Provider, { value }, children);
}

/**
 * Read the ambient project id. Returns `null` when rendered outside a
 * `ProjectProvider` (e.g. the projects index page); callers that *require* a
 * project id should check for null and gracefully degrade.
 */
export function useProjectId(): string | null {
  return useContext(ProjectIdContext);
}

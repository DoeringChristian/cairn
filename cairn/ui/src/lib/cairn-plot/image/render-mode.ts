/**
 * localStorage key for the persisted image render-mode preference.
 *
 * Duplicated (byte-identical) from the app's central key registry
 * (`cairn/ui/src/lib/storage.ts` → `storageKeys.renderMode`) so this library
 * stays self-contained and does not reach into app code. The app registry
 * remains the documentation source of truth for the full `cairn:*` keyspace;
 * this single constant is the only key the plot library itself owns/touches.
 */
const RENDER_MODE_STORAGE_KEY = "cairn:render-mode";

export type RenderMode = "auto" | "gpu" | "cpu";

export function getRenderMode(): RenderMode {
  try {
    const stored = localStorage.getItem(RENDER_MODE_STORAGE_KEY);
    if (stored === "gpu" || stored === "cpu" || stored === "auto")
      return stored;
  } catch {
    /* ignore */
  }
  return "auto";
}

export function setRenderMode(mode: RenderMode): void {
  try {
    localStorage.setItem(RENDER_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

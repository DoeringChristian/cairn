import { storageKeys } from "../../storage";

export type RenderMode = "auto" | "gpu" | "cpu";

export function getRenderMode(): RenderMode {
  try {
    const stored = localStorage.getItem(storageKeys.renderMode);
    if (stored === "gpu" || stored === "cpu" || stored === "auto")
      return stored;
  } catch {
    /* ignore */
  }
  return "auto";
}

export function setRenderMode(mode: RenderMode): void {
  try {
    localStorage.setItem(storageKeys.renderMode, mode);
  } catch {
    /* ignore */
  }
}

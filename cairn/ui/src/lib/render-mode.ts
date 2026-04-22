/**
 * Render mode setting: controls whether image diff/colormap uses WebGPU or CPU.
 *
 * - "auto": Use WebGPU if available, fall back to CPU
 * - "gpu": Force WebGPU (error if unavailable)
 * - "cpu": Force CPU (skip WebGPU even if available)
 *
 * Stored in localStorage as `cairn:render-mode`.
 */

export type RenderMode = "auto" | "gpu" | "cpu";

const STORAGE_KEY = "cairn:render-mode";

export function getRenderMode(): RenderMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "gpu" || stored === "cpu" || stored === "auto") return stored;
  } catch { /* ignore */ }
  return "auto";
}

export function setRenderMode(mode: RenderMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* ignore */ }
}

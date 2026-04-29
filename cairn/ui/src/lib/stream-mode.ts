/**
 * Stream mode setting: controls how server/window plugins stream frames.
 *
 * - "auto": Try WebRTC, fall back to JPEG-over-WebSocket
 * - "webrtc": Force WebRTC (shows error if it fails)
 * - "jpeg": Force JPEG-over-WebSocket (skip WebRTC)
 *
 * Stored in localStorage as `cairn:stream-mode`.
 */

export type StreamMode = "auto" | "webrtc" | "jpeg";

const STORAGE_KEY = "cairn:stream-mode";

export function getStreamMode(): StreamMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "webrtc" || stored === "jpeg" || stored === "auto") return stored;
  } catch { /* ignore */ }
  return "auto";
}

export function setStreamMode(mode: StreamMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* ignore */ }
}

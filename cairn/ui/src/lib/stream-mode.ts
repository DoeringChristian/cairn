/**
 * Stream mode setting: controls how server/window plugins stream frames.
 *
 * - "auto": Try WebRTC, fall back to JPEG-over-WebSocket
 * - "webrtc": Force WebRTC (shows error if it fails)
 * - "jpeg": Force JPEG-over-WebSocket (skip WebRTC)
 *
 * Stored in localStorage as `cairn:stream-mode`.
 */

import { storageKeys } from "./storage";

export type StreamMode = "auto" | "webrtc" | "jpeg";

export function getStreamMode(): StreamMode {
  try {
    const stored = localStorage.getItem(storageKeys.streamMode);
    if (stored === "webrtc" || stored === "jpeg" || stored === "auto") return stored;
  } catch { /* ignore */ }
  return "auto";
}

export function setStreamMode(mode: StreamMode): void {
  try {
    localStorage.setItem(storageKeys.streamMode, mode);
  } catch { /* ignore */ }
}

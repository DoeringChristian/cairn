/**
 * `image/decoders/exr-worker.ts` — the Web Worker entry that runs the
 * vendored EXR decoder OFF the main thread. Imported by the dispatcher
 * (`exr-decode.ts`) via Vite's `?worker&inline` so the whole worker module
 * graph (this file + `exr-full.ts` + `vendor/exr-loader.js` + `fflate`) is
 * embedded as a self-contained inline blob — no separate asset, no CDN.
 *
 * Protocol (one job per message; the dispatcher correlates by `id`):
 *   ← { id, buffer: ArrayBuffer }                      (buffer transferred in)
 *   → { id, ok: true, data, width, height, channels }  (data transferred out)
 *   → { id, ok: false, error: string }
 */
import { decodeExrBuffer } from "./exr-full.ts";

/** Inbound decode request. */
export interface ExrWorkerRequest {
  id: number;
  buffer: ArrayBuffer;
}

/** Outbound decode reply. */
export type ExrWorkerResponse =
  | {
      id: number;
      ok: true;
      data: ArrayBuffer;
      width: number;
      height: number;
      channels: number;
    }
  | { id: number; ok: false; error: string };

// Minimal dedicated-worker surface (the app tsconfig uses the DOM lib, not
// WebWorker, so `self` types as `Window`; narrow it locally).
interface WorkerScope {
  postMessage(message: ExrWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ExrWorkerRequest>) => void,
  ): void;
}
const ctx = self as unknown as WorkerScope;

ctx.addEventListener("message", (event) => {
  const { id, buffer } = event.data;
  try {
    const decoded = decodeExrBuffer(buffer);
    const out = decoded.data.buffer as ArrayBuffer;
    ctx.postMessage(
      {
        id,
        ok: true,
        data: out,
        width: decoded.width,
        height: decoded.height,
        channels: decoded.channels,
      },
      [out], // zero-copy transfer of the decoded float buffer
    );
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

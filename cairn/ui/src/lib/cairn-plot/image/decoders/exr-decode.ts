/**
 * `image/decoders/exr-decode.ts` — the EXR entry the decoder registry mounts.
 * Moves the (potentially slow) EXR decode OFF the main thread and layers a
 * clean fallback chain:
 *
 *   1. a PERSISTENT Web Worker running the full vendored decoder
 *      (`exr-worker.ts` → `exr-full.ts`), the normal browser path — all
 *      compressions (PIZ/PXR24/B44/DWA/…), result returned as a transferable;
 *   2. if `Worker` is unavailable or the worker path fails to spin up, the SAME
 *      full decoder on the MAIN thread (also the `node:test` path);
 *   3. if the full decoder throws, the original pure-TS reader (`exr.ts`,
 *      NONE/ZIP/ZIPS) as a last-ditch net.
 *
 * Unsupported-by-everything variants surface the full decoder's explicit error.
 *
 * One worker is reused across decodes; jobs are correlated by id through a
 * pending map, each guarded by a timeout, with errors propagated back to the
 * awaiting promise.
 */
import type { DecodedImage, ImageSource } from "../decoders.ts";
import { decodeExrBuffer, decodeExrFull } from "./exr-full.ts";
import { decodeExr as decodeExrPure } from "./exr.ts";
import type { ExrWorkerRequest, ExrWorkerResponse } from "./exr-worker.ts";

// A decode should never hang the queue; cap it generously (large DWA/PIZ frames
// can take a while, but not this long).
const DECODE_TIMEOUT_MS = 30_000;

type F32Image = Extract<DecodedImage, { kind: "f32" }>;

interface PendingJob {
  resolve: (img: F32Image) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, PendingJob>();
let nextId = 1;
let workerPromise: Promise<Worker> | null = null;

/** True when this runtime can host a browser Web Worker (false under node). */
function canUseWorker(): boolean {
  return typeof Worker === "function";
}

function rejectAllPending(err: Error): void {
  for (const [, job] of pending) {
    clearTimeout(job.timer);
    job.reject(err);
  }
  pending.clear();
}

/** Tear down the current worker so the next decode respawns a fresh one. */
function resetWorker(err: Error): void {
  rejectAllPending(err);
  const wp = workerPromise;
  workerPromise = null;
  if (wp) wp.then((w) => w.terminate()).catch(() => {});
}

function onWorkerMessage(event: MessageEvent<ExrWorkerResponse>): void {
  const msg = event.data;
  const job = pending.get(msg.id);
  if (!job) return;
  pending.delete(msg.id);
  clearTimeout(job.timer);
  if (msg.ok) {
    job.resolve({
      kind: "f32",
      data: new Float32Array(msg.data),
      width: msg.width,
      height: msg.height,
      channels: msg.channels,
    });
  } else {
    job.reject(new Error(msg.error));
  }
}

/** Lazily create (once) the persistent inline-blob worker. */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      // Vite `?worker&inline`: the worker + its whole module graph ship as a
      // self-contained inline blob (no separate file / CDN). Dynamic import so
      // the blob is only realized on the first EXR decode.
      const mod = await import("./exr-worker.ts?worker&inline");
      const worker = new mod.default();
      worker.addEventListener("message", onWorkerMessage as EventListener);
      worker.addEventListener("error", () => {
        resetWorker(new Error("cairn-plot decodeImage: EXR decode worker crashed"));
      });
      return worker;
    })();
    // If construction itself rejects, clear so we can retry / fall back.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** Decode via the persistent worker, transferring a copy of the bytes in. */
async function decodeViaWorker(bytes: ArrayBuffer): Promise<F32Image> {
  const worker = await getWorker();
  const id = nextId++;
  // Copy so we never detach the caller's ArrayBuffer by transferring it.
  const buffer = bytes.slice(0);
  return new Promise<F32Image>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resetWorker(new Error("cairn-plot decodeImage: EXR decode timed out"));
    }, DECODE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    const req: ExrWorkerRequest = { id, buffer };
    worker.postMessage(req, [buffer]);
  });
}

/** Full decode: worker when possible, else the same decoder on the main thread. */
async function decodeFull(src: ImageSource): Promise<DecodedImage> {
  const bytes = src.bytes!;
  if (canUseWorker()) {
    try {
      return await decodeViaWorker(bytes);
    } catch {
      // Worker path unavailable/broken → retry synchronously on the main thread
      // (also yields the real, informative error for a genuinely bad file).
      return decodeExrBuffer(bytes);
    }
  }
  return decodeExrFull(src);
}

/**
 * Registry entry: decode an EXR source. Tries the full worker-backed decoder,
 * then the pure-TS reader as a fallback; the full decoder's error wins when both
 * fail (it covers the most variants, so its message is the most informative).
 */
export async function decodeExr(src: ImageSource): Promise<DecodedImage> {
  if (!src.bytes) {
    throw new Error(
      "cairn-plot decodeImage: the exr decoder needs raw bytes (src.bytes), got only a url",
    );
  }
  try {
    return await decodeFull(src);
  } catch (fullErr) {
    try {
      return await decodeExrPure(src);
    } catch {
      throw fullErr instanceof Error ? fullErr : new Error(String(fullErr));
    }
  }
}

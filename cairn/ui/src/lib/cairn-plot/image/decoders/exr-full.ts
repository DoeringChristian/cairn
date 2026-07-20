/**
 * `image/decoders/exr-full.ts` — the FULL-coverage EXR decode, adapting the
 * vendored three.js `EXRLoader` (see `vendor/PROVENANCE.md`) to cairn-plot's
 * canonical {@link DecodedImage}. This is the real decode logic; it runs both
 * inside the Web Worker (`exr-worker.ts`, the normal browser path) and directly
 * on the main thread (fallback + `node:test`).
 *
 * SUPPORTED (superset of the pure-TS reader in `exr.ts`): NONE, RLE, ZIP(S),
 * PIZ, PXR24, B44/B44A, DWAA/DWAB compression; single-part scanline, tiled,
 * multi-part and deep; HALF/FLOAT (and UINT via the loader) channels.
 *
 * TWO adaptations vs. three's texture-oriented output:
 *  1. three stores pixels BOTTOM-to-TOP (OpenGL texture convention). Our
 *     `DecodedImage` (and the pure reader) is TOP-to-BOTTOM row-major, so rows
 *     are vertically FLIPPED here.
 *  2. three (with `RGBAFormat`) always emits 4 interleaved channels. We compact
 *     to the pure-reader channel contract: RGB (no A) → 3, RGBA → 4,
 *     luminance/single → 1. Luminance-chroma (Y/RY/BY) is converted to RGB by
 *     the loader and emitted as 3.
 */
import type { DecodedImage, ImageSource } from "../decoders.ts";
import { EXRLoader, type ExrLoaderChannel } from "./vendor/exr-loader.js";

// three.js numeric constants (mirrored in `vendor/three-shim.js`).
const FLOAT_TYPE = 1015;
const RGBA_FORMAT = 1023;

/** Decide the canonical output channel count + which RGBA slots to keep. */
function planChannels(channels: ExrLoaderChannel[]): {
  outChannels: number;
  /** RGBA source slots (0..3) to copy into output components, in order. */
  slots: number[];
} {
  const names = new Set(channels.map((c) => c.name));
  const has = (n: string) => names.has(n);

  // Luminance-chroma: the loader converts Y/RY/BY → RGB in slots 0,1,2.
  if (has("Y") && has("RY") && has("BY")) {
    return { outChannels: 3, slots: [0, 1, 2] };
  }
  if (has("R") && has("G") && has("B")) {
    return has("A")
      ? { outChannels: 4, slots: [0, 1, 2, 3] }
      : { outChannels: 3, slots: [0, 1, 2] };
  }
  // Single luminance channel: the loader expands Y into slots 0,1,2 (+alpha);
  // slot 0 carries the value.
  return { outChannels: 1, slots: [0] };
}

/**
 * Decode EXR bytes into the canonical f32 payload, via the vendored loader.
 * Synchronous decode wrapped in a promise so it slots into the async decoder
 * registry (and can be awaited identically on the worker and main-thread paths).
 */
export function decodeExrBuffer(buffer: ArrayBuffer): Extract<DecodedImage, { kind: "f32" }> {
  const loader = new EXRLoader();
  loader.type = FLOAT_TYPE; // emit Float32Array directly (no half output LUT)
  loader.outputFormat = RGBA_FORMAT; // robust 4-channel path; we compact below

  const res = loader.parse(buffer);
  const src = res.data;
  if (!(src instanceof Float32Array)) {
    // Should never happen with FLOAT_TYPE; guard so downstream sees f32 only.
    throw new Error("cairn-plot decodeImage: EXR decoder returned non-float data");
  }

  const width = res.width;
  const height = res.height;
  const { outChannels, slots } = planChannels(res.header.channels);

  const out = new Float32Array(width * height * outChannels);
  // Vertical flip (three is bottom-to-top) + channel compaction, one pass.
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width; // three's row for output row y
    const dstRow = y * width;
    for (let x = 0; x < width; x++) {
      const s = (srcRow + x) * 4;
      const d = (dstRow + x) * outChannels;
      for (let c = 0; c < outChannels; c++) {
        out[d + c] = src[s + slots[c]!]!;
      }
    }
  }

  return { kind: "f32", data: out, width, height, channels: outChannels };
}

/** {@link ImageSource} entry point for the full decoder (needs raw bytes). */
export function decodeExrFull(src: ImageSource): Promise<DecodedImage> {
  if (!src.bytes) {
    return Promise.reject(
      new Error(
        "cairn-plot decodeImage: the exr decoder needs raw bytes (src.bytes), got only a url",
      ),
    );
  }
  return Promise.resolve(decodeExrBuffer(src.bytes));
}

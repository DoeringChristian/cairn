/**
 * Minimal `.npz` reader — a `.npz` is a ZIP archive whose members are `.npy`
 * files. `numpy.savez` writes STORED (uncompressed) members; `savez_compressed`
 * writes DEFLATE members. We support both: STORED members are sliced directly,
 * DEFLATE members are inflated via the browser's `DecompressionStream`
 * ("deflate-raw"). No third-party zip/inflate dependency.
 *
 * We locate members through the ZIP central directory (always authoritative for
 * sizes and offsets, unlike streaming local headers that may defer sizes to a
 * data descriptor).
 */

import { parseNpy, type NpyArray } from "./parse-npy";

const EOCD_SIG = 0x06054b50; // PK\x05\x06
const CDH_SIG = 0x02014b50; // PK\x01\x02

/** Parse an `.npz` buffer into a map of member name (without `.npy`) → array. */
export async function parseNpz(
  buffer: ArrayBuffer,
): Promise<Record<string, NpyArray>> {
  const view = new DataView(buffer);
  const eocd = findEocd(view);
  const cdOffset = view.getUint32(eocd + 16, true);
  const total = view.getUint16(eocd + 10, true);

  const out: Record<string, NpyArray> = {};
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (view.getUint32(p, true) !== CDH_SIG) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder("latin1").decode(
      new Uint8Array(buffer, p + 46, nameLen),
    );

    // Local header: data starts after its own (possibly different) name/extra.
    const lhNameLen = view.getUint16(localOffset + 26, true);
    const lhExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const compressed = new Uint8Array(buffer, dataStart, compSize);

    let npyBytes: Uint8Array;
    if (method === 0) {
      npyBytes = compressed;
    } else if (method === 8) {
      npyBytes = await inflateRaw(compressed);
    } else {
      throw new Error(`parseNpz: unsupported compression method ${method}`);
    }

    const key = name.replace(/\.npy$/i, "");
    // Copy into a standalone buffer so parseNpy can build aligned typed views.
    const copy = npyBytes.slice();
    out[key] = parseNpy(
      copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
    );

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function findEocd(view: DataView): number {
  // Scan backwards for the End Of Central Directory signature (no zip comment
  // in numpy's output, but tolerate a small one just in case).
  const len = view.byteLength;
  const minPos = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error("parseNpz: end-of-central-directory not found");
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer so the Blob part is well-typed regardless of
  // the source view's backing buffer.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([ab]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

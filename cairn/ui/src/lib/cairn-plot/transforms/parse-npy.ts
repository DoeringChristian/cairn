// Minimal .npy (NumPy array) parser for the browser.
//
// Supports NumPy format v1.0/v2.0 headers with little-endian float32 (`<f4`)
// and float64 (`<f8`) C-ordered data — the layout the SDK point-cloud/tensor
// handlers write via `np.save(..., dtype=float32)`.
//
// NOTE: duplicated in feature/histogram-tensor, dedupe at merge
// (identical path `cairn-plot/transforms/parse-npy.ts`).

export interface NpyArray {
  /** Array dimensions, e.g. `[n, 6]`. */
  shape: number[];
  /** NumPy dtype descriptor, e.g. `"<f4"`. */
  dtype: string;
  /** Whether the raw data is Fortran (column-major) ordered. */
  fortranOrder: boolean;
  /** Flat data as float32 (float64 sources are down-converted). */
  data: Float32Array;
}

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

function parseHeaderDict(header: string): {
  descr: string;
  fortranOrder: boolean;
  shape: number[];
} {
  const descrMatch = header.match(/'descr'\s*:\s*'([^']+)'/);
  const fortranMatch = header.match(/'fortran_order'\s*:\s*(True|False)/);
  const shapeMatch = header.match(/'shape'\s*:\s*\(([^)]*)\)/);
  if (!descrMatch || !fortranMatch || !shapeMatch) {
    throw new Error("parseNpy: malformed header dict");
  }
  const shape = shapeMatch[1]!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number.parseInt(s, 10));
  return {
    descr: descrMatch[1]!,
    fortranOrder: fortranMatch[1] === "True",
    shape,
  };
}

export function parseNpy(buffer: ArrayBuffer): NpyArray {
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) {
      throw new Error("parseNpy: not a .npy file (bad magic)");
    }
  }
  const major = bytes[6];
  const view = new DataView(buffer);

  // v1.0: 2-byte header length; v2.0+: 4-byte header length.
  let headerLen: number;
  let dataStart: number;
  if (major === 1) {
    headerLen = view.getUint16(8, true);
    dataStart = 10 + headerLen;
  } else {
    headerLen = view.getUint32(8, true);
    dataStart = 12 + headerLen;
  }

  const headerBytes = bytes.subarray(dataStart - headerLen, dataStart);
  const header = new TextDecoder("latin1").decode(headerBytes);
  const { descr, fortranOrder, shape } = parseHeaderDict(header);

  const count = shape.reduce((a, b) => a * b, shape.length ? 1 : 0);
  let data: Float32Array;
  if (descr === "<f4" || descr === "|f4" || descr === "=f4") {
    // Copy into an aligned buffer (dataStart may be unaligned for f4).
    data = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      data[i] = view.getFloat32(dataStart + i * 4, true);
    }
  } else if (descr === "<f8" || descr === "|f8" || descr === "=f8") {
    data = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      data[i] = view.getFloat64(dataStart + i * 8, true);
    }
  } else {
    throw new Error(`parseNpy: unsupported dtype '${descr}' (only <f4/<f8)`);
  }

  return { shape, dtype: descr, fortranOrder, data };
}

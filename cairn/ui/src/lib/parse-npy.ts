/**
 * Minimal `.npy` (NumPy array) reader for the browser.
 *
 * Supports NPY format v1.0/v2.0/v3.0 headers and the common numeric dtypes
 * produced by `numpy.save` (float32/64, (u)int8/16/32/64, bool). Values are
 * always returned as a `Float64Array` for uniform downstream math — int64/
 * uint64 are narrowed through `Number()` (fine for the counts/indices we plot;
 * values beyond 2^53 lose precision, which never happens for histogram counts
 * or the tensors we render). Big-endian arrays fall back to a per-element
 * `DataView` decode.
 *
 * Data payload of NPY is always aligned to 64 bytes (the header is padded so
 * `magic + version + headerlen + header` is a multiple of 64), so we can build
 * typed-array views directly over the buffer without copying in the fast path.
 */

export interface NpyArray {
  /** Raw numpy descr string, e.g. `<f8`, `<i8`, `|u1`. */
  dtype: string;
  /** Array shape; `[]` for a 0-d scalar. */
  shape: number[];
  /** True when stored column-major (numpy `fortran_order`). */
  fortranOrder: boolean;
  /** Flattened values in stored order, coerced to Float64. */
  data: Float64Array;
}

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

export function parseNpy(buffer: ArrayBuffer): NpyArray {
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error("parseNpy: not a .npy file");
  }
  const view = new DataView(buffer);
  const major = bytes[6]!;
  let headerLen: number;
  let headerStart: number;
  if (major <= 1) {
    headerLen = view.getUint16(8, true);
    headerStart = 10;
  } else {
    headerLen = view.getUint32(8, true);
    headerStart = 12;
  }
  const header = new TextDecoder("latin1").decode(
    new Uint8Array(buffer, headerStart, headerLen),
  );

  const descrMatch = /'descr'\s*:\s*'([^']+)'/.exec(header);
  const shapeMatch = /'shape'\s*:\s*\(([^)]*)\)/.exec(header);
  if (!descrMatch || !shapeMatch) {
    throw new Error("parseNpy: could not parse header");
  }
  const descr = descrMatch[1]!;
  const fortranOrder = /'fortran_order'\s*:\s*True/.test(header);
  const shape = shapeMatch[1]!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);
  const count = shape.reduce((a, b) => a * b, 1);
  const dataOffset = headerStart + headerLen;

  const data = decodeData(buffer, dataOffset, descr, count);
  return { dtype: descr, shape, fortranOrder, data };
}

function toF64(arr: ArrayLike<number>): Float64Array {
  return arr instanceof Float64Array ? arr : Float64Array.from(arr);
}

function decodeData(
  buffer: ArrayBuffer,
  offset: number,
  descr: string,
  count: number,
): Float64Array {
  const byteOrder = descr[0]!; // '<' '>' '|' '='
  const kind = descr[1]!; // 'f' 'i' 'u' 'b'
  const itemsize = parseInt(descr.slice(2) || "1", 10);
  const littleEndian = byteOrder !== ">";

  if (littleEndian) {
    switch (kind + itemsize) {
      case "f8":
        return toF64(new Float64Array(buffer, offset, count));
      case "f4":
        return toF64(new Float32Array(buffer, offset, count));
      case "i4":
        return toF64(new Int32Array(buffer, offset, count));
      case "i2":
        return toF64(new Int16Array(buffer, offset, count));
      case "i1":
        return toF64(new Int8Array(buffer, offset, count));
      case "u4":
        return toF64(new Uint32Array(buffer, offset, count));
      case "u2":
        return toF64(new Uint16Array(buffer, offset, count));
      case "u1":
      case "b1":
        return toF64(new Uint8Array(buffer, offset, count));
      case "i8":
        return Float64Array.from(
          new BigInt64Array(buffer, offset, count),
          (v) => Number(v),
        );
      case "u8":
        return Float64Array.from(
          new BigUint64Array(buffer, offset, count),
          (v) => Number(v),
        );
    }
  }

  // Slow path: big-endian or an unusual itemsize — decode element by element.
  const view = new DataView(buffer, offset);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * itemsize;
    if (kind === "f" && itemsize === 8) out[i] = view.getFloat64(p, littleEndian);
    else if (kind === "f" && itemsize === 4) out[i] = view.getFloat32(p, littleEndian);
    else if (kind === "i" && itemsize === 4) out[i] = view.getInt32(p, littleEndian);
    else if (kind === "i" && itemsize === 2) out[i] = view.getInt16(p, littleEndian);
    else if (kind === "i" && itemsize === 1) out[i] = view.getInt8(p);
    else if (kind === "u" && itemsize === 4) out[i] = view.getUint32(p, littleEndian);
    else if (kind === "u" && itemsize === 2) out[i] = view.getUint16(p, littleEndian);
    else if ((kind === "u" || kind === "b") && itemsize === 1) out[i] = view.getUint8(p);
    else if (kind === "i" && itemsize === 8)
      out[i] = Number(view.getBigInt64(p, littleEndian));
    else if (kind === "u" && itemsize === 8)
      out[i] = Number(view.getBigUint64(p, littleEndian));
    else throw new Error(`parseNpy: unsupported dtype '${descr}'`);
  }
  return out;
}

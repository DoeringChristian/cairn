/**
 * `image/decoders/exr.ts` — a minimal, dependency-free browser reader for the
 * COMMON OpenEXR case, plugged into the decoder registry (`../decoders.ts`) in
 * place of the throwing stub.
 *
 * SUPPORTED: single-part SCANLINE images; `HALF`/`FLOAT` (and, incidentally,
 * `UINT`) channels; compression `NONE`, `ZIP` (16-line blocks) and `ZIPS`
 * (1-line blocks — both zlib via the native `DecompressionStream('deflate')`);
 * `R`/`G`/`B`(/`A`) → RGB(A), luminance `Y` (or any single channel) → 1;
 * INCREASING_Y and DECREASING_Y line order.
 *
 * EXPLICITLY UNSUPPORTED (clear `unsupported EXR variant: …` errors): tiled,
 * multi-part and deep images; RLE/PIZ/PXR24/B44/B44A/DWAA/DWAB compression;
 * layered/dotted channel names or channel sets that are neither RGB(A) nor a
 * single channel.
 *
 * Output is the canonical float payload the HDR image path consumes:
 * `{ kind:"f32", data:Float32Array, width, height, channels }` (RGB→3, RGBA→4,
 * Y/single→1), row-major, top-to-bottom, channels interleaved in R,G,B,A order.
 *
 * See `docs/superpowers/specs/2026-07-19-client-image-decoders.md` for the full
 * layout notes (esp. the ZIP predictor+interleave post-filter).
 */
import type { DecodedImage, ImageSource } from "../decoders.ts";

// EXR version-field flag bits that gate support (little-endian int32; the low
// byte is the version number, the upper bits are flags).
const TILED_FLAG = 0x0200;
const NON_IMAGE_FLAG = 0x0800; // deep data
const MULTI_PART_FLAG = 0x1000;

// Pixel types (chlist `pixelType`). Plain consts (not a TS `enum`) so the module
// stays "erasable" under Node's `--experimental-strip-types` test runner.
type PixelType = number;
const PT_UINT: PixelType = 0;
const PT_HALF: PixelType = 1;
const PT_FLOAT: PixelType = 2;

// Compression ids.
type Compression = number;
const C_NONE: Compression = 0;
const C_ZIPS: Compression = 2;
const C_ZIP: Compression = 3;

const COMPRESSION_NAME: Record<number, string> = {
  0: "NONE",
  1: "RLE",
  2: "ZIPS",
  3: "ZIP",
  4: "PIZ",
  5: "PXR24",
  6: "B44",
  7: "B44A",
  8: "DWAA",
  9: "DWAB",
};

interface ExrChannel {
  name: string;
  pixelType: PixelType;
  size: number; // bytes per sample
}

function unsupported(what: string): never {
  throw new Error(`cairn-plot decodeImage: unsupported EXR variant: ${what}`);
}

function bail(msg: string): never {
  throw new Error(`cairn-plot decodeImage: malformed EXR — ${msg}`);
}

/** A tiny little-endian cursor over the file bytes. */
class Reader {
  readonly dv: DataView;
  readonly bytes: Uint8Array;
  pos = 0;
  constructor(buf: ArrayBuffer) {
    this.dv = new DataView(buf);
    this.bytes = new Uint8Array(buf);
  }
  u8(): number {
    return this.bytes[this.pos++]!;
  }
  i32(): number {
    const v = this.dv.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u32(): number {
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** uint64 as a JS number (offsets fit comfortably under 2^53). */
  u64(): number {
    const lo = this.dv.getUint32(this.pos, true);
    const hi = this.dv.getUint32(this.pos + 4, true);
    this.pos += 8;
    return hi * 0x1_0000_0000 + lo;
  }
  /** Read a NUL-terminated string (max length guards against runaway parses). */
  str(max = 1024): string {
    let s = "";
    for (let i = 0; i < max; i++) {
      const c = this.bytes[this.pos++];
      if (c === undefined) bail("unexpected end of file while reading a string");
      if (c === 0) return s;
      s += String.fromCharCode(c);
    }
    bail("unterminated string (name too long?)");
  }
  skip(n: number): void {
    this.pos += n;
  }
}

/** IEEE-754 half (16-bit) → f32. Exact for every half value. */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) {
    if (mant === 0) return sign * 0;
    // subnormal: mant * 2^-24
    return sign * mant * 2 ** -24;
  }
  if (exp === 31) {
    return mant === 0 ? sign * Infinity : NaN;
  }
  // normal: 2^(exp-15) * (1 + mant/1024)
  return sign * 2 ** (exp - 15) * (1 + mant / 1024);
}

/** Inflate a zlib (RFC-1950) buffer via the native `DecompressionStream`. */
async function zlibInflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new Error(
      "cairn-plot decodeImage: EXR ZIP/ZIPS needs DecompressionStream (unavailable in this runtime)",
    );
  }
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Undo OpenEXR's ZIP post-filter IN PLACE over the whole inflated block buffer:
 * first the byte-wise predictor (running sum, -128 bias), then the even/odd
 * interleave (first half → even output positions, second half → odd). Returns a
 * NEW buffer holding the reconstructed natural layout.
 */
function undoZipFilter(buf: Uint8Array): Uint8Array {
  const n = buf.length;
  // 1. Undo predictor.
  for (let t = 1; t < n; t++) {
    buf[t] = (buf[t - 1]! + buf[t]! - 128) & 0xff;
  }
  // 2. Undo interleave.
  const out = new Uint8Array(n);
  const half = (n + 1) >> 1;
  let i1 = 0;
  let i2 = half;
  let s = 0;
  while (s < n) {
    out[s++] = buf[i1++]!;
    if (s < n) out[s++] = buf[i2++]!;
  }
  return out;
}

function sampleSize(pixelType: PixelType): number {
  switch (pixelType) {
    case PT_HALF:
      return 2;
    case PT_FLOAT:
    case PT_UINT:
      return 4;
    default:
      return unsupported(`pixel type ${pixelType}`);
  }
}

/** Lines packed into one scanline block, by compression. */
function linesPerBlock(compression: Compression): number {
  return compression === C_ZIP ? 16 : 1; // NONE/RLE/ZIPS → 1
}

interface ExrHeader {
  channels: ExrChannel[]; // sorted by name (as stored)
  compression: Compression;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

function parseHeader(r: Reader): ExrHeader {
  let channels: ExrChannel[] | null = null;
  let compression: Compression | null = null;
  let dataWindow: [number, number, number, number] | null = null;

  for (;;) {
    const name = r.str();
    if (name === "") break; // empty name terminates the header
    r.str(); // attribute type (unused — we dispatch on name)
    const size = r.i32();
    const end = r.pos + size;
    if (name === "channels") {
      channels = parseChannelList(r, end);
    } else if (name === "compression") {
      compression = r.u8() as Compression;
    } else if (name === "dataWindow") {
      dataWindow = [r.i32(), r.i32(), r.i32(), r.i32()];
    }
    // Every other attribute (displayWindow, lineOrder, pixelAspectRatio, …) is
    // read past by size — `lineOrder` need not be honored (each block carries
    // its own y coordinate, so scanlines are placed by coordinate).
    r.pos = end;
  }

  if (!channels) bail("missing 'channels' attribute");
  if (compression === null) bail("missing 'compression' attribute");
  if (!dataWindow) bail("missing 'dataWindow' attribute");
  return {
    channels,
    compression,
    xMin: dataWindow[0],
    yMin: dataWindow[1],
    xMax: dataWindow[2],
    yMax: dataWindow[3],
  };
}

function parseChannelList(r: Reader, end: number): ExrChannel[] {
  const chans: ExrChannel[] = [];
  for (;;) {
    if (r.pos >= end) bail("channel list ran past attribute bounds");
    const name = r.str();
    if (name === "") break; // empty name terminates the chlist
    const pixelType = r.i32() as PixelType;
    r.skip(4); // pLinear:uint8 + 3 reserved bytes
    r.i32(); // xSampling
    r.i32(); // ySampling
    chans.push({ name, pixelType, size: sampleSize(pixelType) });
  }
  // The file stores channels sorted by name; re-sort defensively so our block
  // layout math matches the on-disk order regardless.
  chans.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return chans;
}

/**
 * Decide the output layout from the channel names. RGB(A) → 3/4 in R,G,B,A
 * order; luminance `Y` (or any single channel) → 1. Returns, for each SORTED
 * input channel, the output component index it writes to (`-1` = ignored — but
 * we never ignore; unrecognized multi-channel sets are rejected instead).
 */
function planOutput(channels: ExrChannel[]): {
  outChannels: number;
  compFor: number[];
} {
  const names = channels.map((c) => c.name);
  const has = (n: string) => names.includes(n);

  let order: string[];
  if (has("R") && has("G") && has("B")) {
    order = has("A") ? ["R", "G", "B", "A"] : ["R", "G", "B"];
  } else if (has("Y") && channels.length === 1) {
    order = ["Y"];
  } else if (channels.length === 1) {
    order = [names[0]!]; // a single arbitrary channel → grayscale
  } else {
    return unsupported(`channel layout [${names.join(", ")}] (expected RGB(A) or single Y)`);
  }

  // If we chose RGB(A) but there are EXTRA channels beyond the mapped set,
  // reject rather than silently dropping them (keeps behavior predictable).
  const mapped = new Set(order);
  for (const n of names) {
    if (!mapped.has(n)) {
      return unsupported(`channel layout [${names.join(", ")}] (unmapped channel "${n}")`);
    }
  }

  const compFor = channels.map((c) => order.indexOf(c.name));
  return { outChannels: order.length, compFor };
}

/** Read one sample of `pixelType` at byte offset `off` in `dv`. */
function readSample(dv: DataView, off: number, pixelType: PixelType): number {
  switch (pixelType) {
    case PT_HALF:
      return halfToFloat(dv.getUint16(off, true));
    case PT_FLOAT:
      return dv.getFloat32(off, true);
    case PT_UINT:
      return dv.getUint32(off, true);
    default:
      return unsupported(`pixel type ${pixelType}`);
  }
}

/** Decode an EXR from raw bytes into the canonical f32 payload. */
export async function decodeExr(src: ImageSource): Promise<DecodedImage> {
  if (!src.bytes) {
    throw new Error(
      "cairn-plot decodeImage: the exr decoder needs raw bytes (src.bytes), got only a url",
    );
  }
  const r = new Reader(src.bytes);

  // Magic + version.
  if (r.u32() !== 20000630) bail("bad magic number");
  const version = r.i32();
  if (version & TILED_FLAG) unsupported("tiled");
  if (version & MULTI_PART_FLAG) unsupported("multi-part");
  if (version & NON_IMAGE_FLAG) unsupported("deep");

  const hdr = parseHeader(r);
  if (
    hdr.compression !== C_NONE &&
    hdr.compression !== C_ZIP &&
    hdr.compression !== C_ZIPS
  ) {
    unsupported(`${COMPRESSION_NAME[hdr.compression] ?? hdr.compression} compression`);
  }

  const width = hdr.xMax - hdr.xMin + 1;
  const height = hdr.yMax - hdr.yMin + 1;
  if (width <= 0 || height <= 0) bail(`non-positive image size ${width}x${height}`);

  const { outChannels, compFor } = planOutput(hdr.channels);
  const bytesPerScanline = width * hdr.channels.reduce((a, c) => a + c.size, 0);
  const perBlock = linesPerBlock(hdr.compression);

  // Scanline offset table: ceil(height/perBlock) uint64 file offsets.
  const nBlocks = Math.ceil(height / perBlock);
  const offsets: number[] = new Array(nBlocks);
  for (let i = 0; i < nBlocks; i++) offsets[i] = r.u64();

  const out = new Float32Array(width * height * outChannels);

  for (let b = 0; b < nBlocks; b++) {
    r.pos = offsets[b]!;
    const blockY = r.i32();
    const dataSize = r.i32();
    const scanlines = Math.min(perBlock, hdr.yMax - blockY + 1);
    const uncompressedSize = scanlines * bytesPerScanline;

    let raw: Uint8Array;
    const chunk = r.bytes.subarray(r.pos, r.pos + dataSize);
    if (hdr.compression === C_NONE || dataSize >= uncompressedSize) {
      // Stored raw (NONE, or a block compression didn't shrink).
      raw = chunk;
    } else {
      const inflated = await zlibInflate(chunk);
      raw = undoZipFilter(inflated);
    }
    if (raw.length < uncompressedSize) {
      bail(`block ${b} decoded to ${raw.length} bytes, expected ${uncompressedSize}`);
    }

    // Natural layout: per scanline, then per (sorted) channel, then per pixel.
    const rawDv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < scanlines; i++) {
      const row = blockY + i - hdr.yMin;
      let off = i * bytesPerScanline;
      for (let ci = 0; ci < hdr.channels.length; ci++) {
        const ch = hdr.channels[ci]!;
        const comp = compFor[ci]!;
        const rowBase = (row * width) * outChannels + comp;
        for (let x = 0; x < width; x++) {
          out[rowBase + x * outChannels] = readSample(rawDv, off, ch.pixelType);
          off += ch.size;
        }
      }
    }
  }

  return { kind: "f32", data: out, width, height, channels: outChannels };
}

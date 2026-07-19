/**
 * Unit tests for the minimal browser EXR reader (`exr.ts`). Runs under Node's
 * built-in test runner with TypeScript type-stripping (Node ships
 * `DecompressionStream`/`Blob`/`Response`/`zlib`, so the ZIP path works here):
 *
 *   node --experimental-strip-types --test \
 *     src/lib/cairn-plot/image/decoders/exr.test.ts
 *
 * EXR fixtures are authored BY HAND below (a tiny writer that mirrors the
 * single-part scanline layout), including the ZIP forward filter (interleave →
 * predictor → deflate) built with node's `zlib`, so pixel values round-trip
 * through the reader's inverse (inflate → undo predictor → undo interleave).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { decodeExr, halfToFloat } from "./exr.ts";

// ---------------------------------------------------------------------------
// halfToFloat — direct edge-case coverage (normals, subnormals, ±0, ±inf, nan).
// ---------------------------------------------------------------------------
test("halfToFloat decodes normals, ±0, ±inf, nan and subnormals", () => {
  assert.ok(Object.is(halfToFloat(0x0000), 0)); // +0
  assert.ok(Object.is(halfToFloat(0x8000), -0)); // -0, negatively signed
  assert.equal(halfToFloat(0x3c00), 1.0);
  assert.equal(halfToFloat(0x3800), 0.5);
  assert.equal(halfToFloat(0x4000), 2.0);
  assert.equal(halfToFloat(0xc000), -2.0);
  assert.equal(halfToFloat(0x3555), 0.333251953125); // 1/3 nearest half
  assert.equal(halfToFloat(0x7bff), 65504); // largest normal
  assert.equal(halfToFloat(0x7c00), Infinity);
  assert.equal(halfToFloat(0xfc00), -Infinity);
  assert.ok(Number.isNaN(halfToFloat(0x7e00))); // a quiet NaN
  assert.ok(Number.isNaN(halfToFloat(0xfdff)));
  // subnormals: smallest positive = 2^-24, largest = (1023/1024)*2^-14
  assert.equal(halfToFloat(0x0001), 2 ** -24);
  assert.equal(halfToFloat(0x03ff), (1023 / 1024) * 2 ** -14);
  assert.equal(halfToFloat(0x8001), -(2 ** -24));
});

// ---------------------------------------------------------------------------
// A hand EXR writer for single-part scanline fixtures (NONE / ZIP / ZIPS).
// ---------------------------------------------------------------------------
const HALF = 1;
const FLOAT = 2;

class W {
  buf: number[] = [];
  u8(v: number) {
    this.buf.push(v & 0xff);
  }
  u16(v: number) {
    this.buf.push(v & 0xff, (v >> 8) & 0xff);
  }
  i32(v: number) {
    const d = new DataView(new ArrayBuffer(4));
    d.setInt32(0, v, true);
    for (let i = 0; i < 4; i++) this.buf.push(d.getUint8(i));
  }
  u32(v: number) {
    const d = new DataView(new ArrayBuffer(4));
    d.setUint32(0, v >>> 0, true);
    for (let i = 0; i < 4; i++) this.buf.push(d.getUint8(i));
  }
  f32(v: number) {
    const d = new DataView(new ArrayBuffer(4));
    d.setFloat32(0, v, true);
    for (let i = 0; i < 4; i++) this.buf.push(d.getUint8(i));
  }
  str(s: string) {
    for (let i = 0; i < s.length; i++) this.buf.push(s.charCodeAt(i));
    this.buf.push(0);
  }
  bytes(arr: ArrayLike<number>) {
    for (let i = 0; i < arr.length; i++) this.buf.push(arr[i]! & 0xff);
  }
}

/** f32 → IEEE half bits (exact for the exactly-representable values used here). */
function floatToHalf(val: number): number {
  const d = new DataView(new ArrayBuffer(4));
  d.setFloat32(0, val, true);
  const x = d.getUint32(0, true);
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    return sign | ((mant | 0x800000) >>> (14 - e));
  }
  return sign | (e << 10) | (mant >>> 13);
}

/** Forward ZIP filter (WRITE path): interleave even/odd bytes, then predictor. */
function zipForwardFilter(natural: Uint8Array): Uint8Array {
  const n = natural.length;
  const tmp = new Uint8Array(n);
  const half = (n + 1) >> 1;
  let j1 = 0;
  let j2 = half;
  for (let i = 0; i < n; i++) {
    if ((i & 1) === 0) tmp[j1++] = natural[i]!;
    else tmp[j2++] = natural[i]!;
  }
  let p = tmp[0]!;
  for (let t = 1; t < n; t++) {
    const cur = tmp[t]!;
    tmp[t] = (cur - p + 384) & 0xff;
    p = cur;
  }
  return tmp;
}

interface ChanSpec {
  name: string;
  pixelType: number; // HALF | FLOAT
  values: number[]; // length width*height, f32 values
}
interface ExrOpts {
  width: number;
  height: number;
  channels: ChanSpec[];
  compression?: number; // 0 NONE, 2 ZIPS, 3 ZIP, (others for unsupported tests)
  lineOrder?: number; // 0 increasing, 1 decreasing
  versionFlags?: number; // extra version flag bits (for unsupported tests)
}

function makeExr(opts: ExrOpts): ArrayBuffer {
  const { width, height, compression = 0, lineOrder = 0, versionFlags = 0 } = opts;
  const chans = [...opts.channels].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const perBlock = compression === 3 ? 16 : 1;
  const sizeOf = (pt: number) => (pt === HALF ? 2 : 4);
  const bytesPerScanline = width * chans.reduce((a, c) => a + sizeOf(c.pixelType), 0);

  const h = new W();
  h.bytes([0x76, 0x2f, 0x31, 0x01]); // magic
  h.i32(2 | versionFlags); // version 2 + flags

  const attr = (name: string, type: string, writeValue: (w: W) => void) => {
    h.str(name);
    h.str(type);
    const tmp = new W();
    writeValue(tmp);
    h.i32(tmp.buf.length);
    h.bytes(tmp.buf);
  };
  attr("channels", "chlist", (w) => {
    for (const c of chans) {
      w.str(c.name);
      w.i32(c.pixelType);
      w.u8(0);
      w.u8(0);
      w.u8(0);
      w.u8(0); // pLinear + reserved[3]
      w.i32(1); // xSampling
      w.i32(1); // ySampling
    }
    w.u8(0); // terminator
  });
  attr("compression", "compression", (w) => w.u8(compression));
  attr("dataWindow", "box2i", (w) => {
    w.i32(0);
    w.i32(0);
    w.i32(width - 1);
    w.i32(height - 1);
  });
  attr("displayWindow", "box2i", (w) => {
    w.i32(0);
    w.i32(0);
    w.i32(width - 1);
    w.i32(height - 1);
  });
  attr("lineOrder", "lineOrder", (w) => w.u8(lineOrder));
  h.u8(0); // header terminator

  const blockStarts: number[] = [];
  for (let y = 0; y < height; y += perBlock) blockStarts.push(y);
  if (lineOrder === 1) blockStarts.reverse();

  const nBlocks = blockStarts.length;
  const blocksStart = h.buf.length + nBlocks * 8;

  const blockBuffers: Uint8Array[] = [];
  const offsets: number[] = [];
  let cursor = blocksStart;
  for (const by of blockStarts) {
    const scanlines = Math.min(perBlock, height - by);
    const nat = new W();
    for (let i = 0; i < scanlines; i++) {
      const row = by + i;
      for (const c of chans) {
        for (let x = 0; x < width; x++) {
          const v = c.values[row * width + x]!;
          if (c.pixelType === FLOAT) nat.f32(v);
          else nat.u16(floatToHalf(v));
        }
      }
    }
    const natural = Uint8Array.from(nat.buf);
    let data: Uint8Array;
    if (compression === 0) {
      data = natural;
    } else {
      const comp = new Uint8Array(zlib.deflateSync(Buffer.from(zipForwardFilter(natural))));
      data = comp.length >= natural.length ? natural : comp;
    }
    const blk = new W();
    blk.i32(by);
    blk.i32(data.length);
    blk.bytes(data);
    const bBuf = Uint8Array.from(blk.buf);
    offsets.push(cursor);
    cursor += bBuf.length;
    blockBuffers.push(bBuf);
  }

  const out = new W();
  out.bytes(h.buf);
  for (const off of offsets) {
    out.u32(off); // u64 lo
    out.u32(0); // u64 hi (offsets < 2^32 here)
  }
  for (const b of blockBuffers) out.bytes(b);
  return Uint8Array.from(out.buf).buffer;
}

/** Build a width*height ramp of distinct values (base + index * step). */
function ramp(width: number, height: number, base: number, step: number): number[] {
  return Array.from({ length: width * height }, (_, i) => base + i * step);
}

// ---------------------------------------------------------------------------
// FLOAT channels, NONE compression — exact pixel/layout round-trip.
// ---------------------------------------------------------------------------
test("FLOAT RGB, NONE: exact pixel + channel + row/col layout", async () => {
  const w = 3;
  const h = 2;
  const R = ramp(w, h, 0.0, 1.0); // 0,1,2,3,4,5
  const G = ramp(w, h, 100.0, 1.0);
  const B = ramp(w, h, 1000.0, 1.0);
  const buf = makeExr({
    width: w,
    height: h,
    channels: [
      { name: "R", pixelType: FLOAT, values: R },
      { name: "G", pixelType: FLOAT, values: G },
      { name: "B", pixelType: FLOAT, values: B },
    ],
  });
  const d = await decodeExr({ bytes: buf });
  assert.equal(d.kind, "f32");
  if (d.kind !== "f32") return;
  assert.equal(d.width, 3);
  assert.equal(d.height, 2);
  assert.equal(d.channels, 3);
  for (let i = 0; i < w * h; i++) {
    assert.equal(d.data[i * 3 + 0], R[i]);
    assert.equal(d.data[i * 3 + 1], G[i]);
    assert.equal(d.data[i * 3 + 2], B[i]);
  }
});

// ---------------------------------------------------------------------------
// FLOAT RGBA, ZIPS — exercises inflate + undo(predictor,interleave), + alpha.
// ---------------------------------------------------------------------------
test("FLOAT RGBA, ZIPS: round-trips through the zlib + predictor filter", async () => {
  const w = 8;
  const h = 4;
  // Low-entropy per-row constant values so deflate shrinks → the inflate path
  // is exercised (not the uncompressed fallback).
  const rowVal = (base: number) =>
    Array.from({ length: w * h }, (_, i) => base + Math.floor(i / w));
  const R = rowVal(0);
  const G = rowVal(10);
  const B = rowVal(20);
  const A = Array.from({ length: w * h }, () => 1.0);
  const buf = makeExr({
    width: w,
    height: h,
    compression: 2, // ZIPS
    channels: [
      { name: "R", pixelType: FLOAT, values: R },
      { name: "G", pixelType: FLOAT, values: G },
      { name: "B", pixelType: FLOAT, values: B },
      { name: "A", pixelType: FLOAT, values: A },
    ],
  });
  const d = await decodeExr({ bytes: buf });
  assert.equal(d.kind, "f32");
  if (d.kind !== "f32") return;
  assert.equal(d.channels, 4);
  for (let i = 0; i < w * h; i++) {
    assert.equal(d.data[i * 4 + 0], R[i]);
    assert.equal(d.data[i * 4 + 1], G[i]);
    assert.equal(d.data[i * 4 + 2], B[i]);
    assert.equal(d.data[i * 4 + 3], 1.0);
  }
});

// ---------------------------------------------------------------------------
// HALF RGB, ZIP — multi-line (16/block) + partial last block + HALF decode.
// ---------------------------------------------------------------------------
test("HALF RGB, ZIP: multi-block layout + HALF samples round-trip", async () => {
  const w = 4;
  const h = 20; // 2 ZIP blocks: 16 + 4 scanlines
  // Exactly-representable half values keyed to (row) so layout is verifiable.
  const halfSteps = [0.0, 0.5, 1.0, 1.5]; // per-column, exactly representable
  const chan = (bias: number) =>
    Array.from({ length: w * h }, (_, i) => halfSteps[i % w]! + bias * (Math.floor(i / w) % 2));
  const R = chan(0);
  const G = chan(0.5);
  const B = chan(1.0);
  const buf = makeExr({
    width: w,
    height: h,
    compression: 3, // ZIP
    channels: [
      { name: "R", pixelType: HALF, values: R },
      { name: "G", pixelType: HALF, values: G },
      { name: "B", pixelType: HALF, values: B },
    ],
  });
  const d = await decodeExr({ bytes: buf });
  assert.equal(d.kind, "f32");
  if (d.kind !== "f32") return;
  assert.equal(d.width, 4);
  assert.equal(d.height, 20);
  assert.equal(d.channels, 3);
  for (let i = 0; i < w * h; i++) {
    assert.equal(d.data[i * 3 + 0], R[i]);
    assert.equal(d.data[i * 3 + 1], G[i]);
    assert.equal(d.data[i * 3 + 2], B[i]);
  }
});

// ---------------------------------------------------------------------------
// Luminance-only Y → 1 channel.
// ---------------------------------------------------------------------------
test("single Y channel decodes to channels=1", async () => {
  const w = 2;
  const h = 2;
  const Y = [0.25, 0.5, 0.75, 1.0];
  const buf = makeExr({
    width: w,
    height: h,
    channels: [{ name: "Y", pixelType: FLOAT, values: Y }],
  });
  const d = await decodeExr({ bytes: buf });
  assert.equal(d.kind, "f32");
  if (d.kind !== "f32") return;
  assert.equal(d.channels, 1);
  assert.deepEqual(Array.from(d.data), Y);
});

// ---------------------------------------------------------------------------
// DECREASING_Y line order — blocks arrive high-y first, placed by coordinate.
// ---------------------------------------------------------------------------
test("DECREASING_Y line order places scanlines by coordinate", async () => {
  const w = 2;
  const h = 4;
  const R = ramp(w, h, 0, 1); // row-major 0..7
  const buf = makeExr({
    width: w,
    height: h,
    lineOrder: 1, // decreasing
    channels: [{ name: "Y", pixelType: FLOAT, values: R }],
  });
  const d = await decodeExr({ bytes: buf });
  if (d.kind !== "f32") return assert.fail("expected f32");
  assert.deepEqual(Array.from(d.data), R);
});

// ---------------------------------------------------------------------------
// Unsupported variants → clear errors.
// ---------------------------------------------------------------------------
test("tiled EXR is rejected", async () => {
  const buf = makeExr({
    width: 2,
    height: 2,
    versionFlags: 0x0200, // TILED_FLAG
    channels: [{ name: "Y", pixelType: FLOAT, values: [1, 2, 3, 4] }],
  });
  await assert.rejects(decodeExr({ bytes: buf }), /unsupported EXR variant: tiled/);
});

test("multi-part and deep flags are rejected", async () => {
  const deep = makeExr({
    width: 2,
    height: 2,
    versionFlags: 0x0800,
    channels: [{ name: "Y", pixelType: FLOAT, values: [1, 2, 3, 4] }],
  });
  await assert.rejects(decodeExr({ bytes: deep }), /unsupported EXR variant: deep/);
  const multi = makeExr({
    width: 2,
    height: 2,
    versionFlags: 0x1000,
    channels: [{ name: "Y", pixelType: FLOAT, values: [1, 2, 3, 4] }],
  });
  await assert.rejects(decodeExr({ bytes: multi }), /unsupported EXR variant: multi-part/);
});

test("unsupported compression (PIZ) is rejected", async () => {
  const buf = makeExr({
    width: 2,
    height: 2,
    compression: 4, // PIZ
    channels: [{ name: "Y", pixelType: FLOAT, values: [1, 2, 3, 4] }],
  });
  await assert.rejects(decodeExr({ bytes: buf }), /unsupported EXR variant: PIZ compression/);
});

test("an unmappable channel set is rejected", async () => {
  // Two channels that are neither RGB(A) nor a single luminance channel.
  const buf = makeExr({
    width: 1,
    height: 1,
    channels: [
      { name: "R", pixelType: FLOAT, values: [1] },
      { name: "G", pixelType: FLOAT, values: [2] },
    ],
  });
  await assert.rejects(decodeExr({ bytes: buf }), /unsupported EXR variant: channel layout/);
});

test("decodeExr requires bytes, not a url", async () => {
  await assert.rejects(decodeExr({ url: "https://x/y.exr" }), /needs raw bytes/);
});

/**
 * Tests for the FULL EXR decoder (`exr-full.ts` — the vendored three.js loader
 * adapter). Runs under Node's built-in runner with type-stripping:
 *
 *   node --experimental-strip-types --test \
 *     src/lib/cairn-plot/image/decoders/exr-full.test.ts
 *
 * Two layers:
 *  1. the committed PIZ fixture (`fixtures/rgb-piz-half-64x48.exr`, written by
 *     OpenEXR 3.4) decodes through the REAL route (the user's blocker) — exact
 *     pixel spot-checks + finite/dims;
 *  2. the same single-part-scanline fixtures the pure reader covers
 *     (NONE / ZIP, FLOAT/HALF, RGB/RGBA/Y) round-trip through the new decoder,
 *     which also exercises the vertical flip + channel compaction.
 *
 * The browser Worker wrapper (`exr-worker.ts` / `exr-decode.ts` `?worker&inline`)
 * is NOT exercised here — node has no Web `Worker`; the decode LOGIC below is
 * what the worker runs. The worker instantiation only verifies in-browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { decodeExrBuffer, decodeExrFull } from "./exr-full.ts";

const HALF = 1;
const FLOAT = 2;

// ---------------------------------------------------------------------------
// Hand EXR writer for single-part scanline fixtures (NONE / ZIP), mirroring
// `exr.test.ts` (same forward ZIP filter: interleave → predictor → deflate).
// ---------------------------------------------------------------------------
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
  pixelType: number;
  values: number[]; // width*height, top-to-bottom row-major, f32
}

function makeExr(opts: {
  width: number;
  height: number;
  channels: ChanSpec[];
  compression?: number; // 0 NONE, 3 ZIP
}): ArrayBuffer {
  const { width, height, compression = 0 } = opts;
  const chans = [...opts.channels].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const perBlock = compression === 3 ? 16 : 1;
  const sizeOf = (pt: number) => (pt === HALF ? 2 : 4);
  const bytesPerScanline = width * chans.reduce((a, c) => a + sizeOf(c.pixelType), 0);

  const h = new W();
  h.bytes([0x76, 0x2f, 0x31, 0x01]);
  h.i32(2);
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
      w.u8(0);
      w.i32(1);
      w.i32(1);
    }
    w.u8(0);
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
  attr("lineOrder", "lineOrder", (w) => w.u8(0));
  h.u8(0);

  const blockStarts: number[] = [];
  for (let y = 0; y < height; y += perBlock) blockStarts.push(y);
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
    // u64 little-endian (offsets < 2^32 here)
    const d = new DataView(new ArrayBuffer(8));
    d.setUint32(0, off, true);
    d.setUint32(4, 0, true);
    for (let i = 0; i < 8; i++) out.u8(d.getUint8(i));
  }
  for (const b of blockBuffers) out.bytes(b);
  return Uint8Array.from(out.buf).buffer;
}

function ramp(width: number, height: number, base: number, step: number): number[] {
  return Array.from({ length: width * height }, (_, i) => base + i * step);
}

// ---------------------------------------------------------------------------
// The PIZ fixture — the user's actual blocker, through the real route.
// ---------------------------------------------------------------------------
test("PIZ fixture decodes (dims, channels, exact pixels, all finite)", () => {
  const bytes = readFileSync(new URL("./fixtures/rgb-piz-half-64x48.exr", import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const d = decodeExrBuffer(buffer as ArrayBuffer);

  assert.equal(d.kind, "f32");
  assert.equal(d.width, 64);
  assert.equal(d.height, 48);
  assert.equal(d.channels, 3); // RGB, no alpha

  // Top-to-bottom row-major, RGB interleaved. Ground truth from OpenEXR:
  //   R=(x*0.5)%8, G=(y*0.25)%4, B=((x+y)%16)*0.125
  const px = (x: number, y: number) => {
    const i = (y * 64 + x) * 3;
    return [d.data[i], d.data[i + 1], d.data[i + 2]];
  };
  assert.deepEqual(px(0, 0), [0, 0, 0]);
  assert.deepEqual(px(1, 0), [0.5, 0, 0.125]);
  assert.deepEqual(px(5, 10), [2.5, 2.5, 1.875]);
  assert.deepEqual(px(7, 20), [3.5, 1, 1.375]);

  assert.ok(d.data.every((v) => Number.isFinite(v)), "all samples finite");
});

// ---------------------------------------------------------------------------
// FLOAT RGB, NONE — exact pixel/layout round-trip (+ vertical flip correctness).
// ---------------------------------------------------------------------------
test("FLOAT RGB, NONE: exact top-to-bottom pixel + channel layout", () => {
  const w = 3;
  const h = 2;
  const R = ramp(w, h, 0.0, 1.0);
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
  const d = decodeExrBuffer(buf);
  assert.equal(d.channels, 3);
  assert.equal(d.width, 3);
  assert.equal(d.height, 2);
  for (let i = 0; i < w * h; i++) {
    assert.equal(d.data[i * 3 + 0], R[i]);
    assert.equal(d.data[i * 3 + 1], G[i]);
    assert.equal(d.data[i * 3 + 2], B[i]);
  }
});

// ---------------------------------------------------------------------------
// FLOAT RGBA, ZIP — inflate path + alpha kept (4 channels).
// ---------------------------------------------------------------------------
test("FLOAT RGBA, ZIP: keeps alpha (channels=4) and round-trips values", () => {
  const w = 8;
  const h = 20; // >16 → two ZIP blocks (16 + 4)
  const rowVal = (base: number) =>
    Array.from({ length: w * h }, (_, i) => base + Math.floor(i / w));
  const R = rowVal(0);
  const G = rowVal(10);
  const B = rowVal(20);
  const A = Array.from({ length: w * h }, () => 1.0);
  const buf = makeExr({
    width: w,
    height: h,
    compression: 3,
    channels: [
      { name: "R", pixelType: FLOAT, values: R },
      { name: "G", pixelType: FLOAT, values: G },
      { name: "B", pixelType: FLOAT, values: B },
      { name: "A", pixelType: FLOAT, values: A },
    ],
  });
  const d = decodeExrBuffer(buf);
  assert.equal(d.channels, 4);
  for (let i = 0; i < w * h; i++) {
    assert.equal(d.data[i * 4 + 0], R[i]);
    assert.equal(d.data[i * 4 + 1], G[i]);
    assert.equal(d.data[i * 4 + 2], B[i]);
    assert.equal(d.data[i * 4 + 3], 1.0);
  }
});

// ---------------------------------------------------------------------------
// HALF Y, NONE — single luminance channel → channels=1.
// ---------------------------------------------------------------------------
test("HALF Y, NONE: single channel decodes to channels=1", () => {
  const w = 4;
  const h = 3;
  // Exactly-representable half values.
  const Y = Array.from({ length: w * h }, (_, i) => (i % 8) * 0.5);
  const buf = makeExr({
    width: w,
    height: h,
    channels: [{ name: "Y", pixelType: HALF, values: Y }],
  });
  const d = decodeExrBuffer(buf);
  assert.equal(d.channels, 1);
  assert.deepEqual(Array.from(d.data), Y);
});

// ---------------------------------------------------------------------------
// The ImageSource wrapper requires bytes.
// ---------------------------------------------------------------------------
test("decodeExrFull rejects a url without bytes", async () => {
  await assert.rejects(decodeExrFull({ url: "https://x/y.exr" }), /needs raw bytes/);
});

/**
 * Pure unit tests for the multi-format image DECODER layer. No test runner is
 * configured in this package, so this runs under Node's built-in test runner
 * with TypeScript type-stripping:
 *
 *   node --experimental-strip-types --test \
 *     src/lib/cairn-plot/image/decoders.test.ts
 *
 * Covers the DOM-free surface: the content-type sniffer, the raw `.npy`
 * u8/f32 decode, and registry dispatch (incl. the deferred EXR slot). The
 * browser-native paths (createImageBitmap/canvas) need a DOM, so only their
 * REGISTRY SELECTION is asserted here, never their execution.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sniffFormat,
  sniffMagic,
  getDecoder,
  decodeImage,
  npyArrayToDecoded,
  isRawBufferFormat,
  isBrowserNativeFormat,
  type ImageFormat,
} from "./decoders.ts";
import { parseNpy } from "../transforms/parse-npy.ts";

// ---------------------------------------------------------------------------
// A minimal `.npy` v1.0 encoder for building test buffers.
// ---------------------------------------------------------------------------
function makeNpy(
  descr: string,
  shape: number[],
  values: number[],
): ArrayBuffer {
  const shapeStr =
    shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(", ")})`;
  let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${shapeStr}, }`;
  // Pad so (6 magic + 2 version + 2 headerLen + header) is a multiple of 64,
  // and the header ends with '\n'.
  const preamble = 6 + 2 + 2;
  const total = preamble + header.length + 1; // +1 for the trailing '\n'
  const pad = (64 - (total % 64)) % 64;
  header = header + " ".repeat(pad) + "\n";

  const kind = descr[1];
  const itemsize = parseInt(descr.slice(2), 10);
  const dataBytes = values.length * itemsize;
  const buf = new ArrayBuffer(preamble + header.length + dataBytes);
  const bytes = new Uint8Array(buf);
  const magic = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
  magic.forEach((b, i) => (bytes[i] = b));
  bytes[6] = 1; // major version
  bytes[7] = 0; // minor version
  const dv = new DataView(buf);
  dv.setUint16(8, header.length, true);
  for (let i = 0; i < header.length; i++) bytes[10 + i] = header.charCodeAt(i);

  const dataOffset = preamble + header.length;
  const dataView = new DataView(buf, dataOffset);
  for (let i = 0; i < values.length; i++) {
    const p = i * itemsize;
    if (kind === "f" && itemsize === 4) dataView.setFloat32(p, values[i]!, true);
    else if (kind === "f" && itemsize === 8) dataView.setFloat64(p, values[i]!, true);
    else if ((kind === "u" || kind === "i" || kind === "b") && itemsize === 1)
      dataView.setUint8(p, values[i]!);
    else throw new Error(`makeNpy: unsupported descr ${descr}`);
  }
  return buf;
}

function png4(): ArrayBuffer {
  const buf = new ArrayBuffer(8);
  new Uint8Array(buf).set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buf;
}

// ---------------------------------------------------------------------------
// sniffMagic — magic-byte detection.
// ---------------------------------------------------------------------------
test("sniffMagic detects PNG/JPEG/GIF/EXR/NPY/NPZ", () => {
  assert.equal(sniffMagic(png4()), "png");
  assert.equal(sniffMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer), "jpeg");
  assert.equal(sniffMagic(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).buffer), "gif");
  assert.equal(sniffMagic(new Uint8Array([0x76, 0x2f, 0x31, 0x01]).buffer), "exr");
  assert.equal(sniffMagic(makeNpy("|u1", [2, 2], [1, 2, 3, 4])), "npy");
  assert.equal(sniffMagic(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer), "npz");
});

test("sniffMagic detects RIFF/WEBP and ISO-BMFF/AVIF", () => {
  const webp = new Uint8Array(16);
  webp.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  assert.equal(sniffMagic(webp.buffer), "webp");

  const avif = new Uint8Array(16);
  // bytes 4..: "ftypavif"
  avif.set([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4);
  assert.equal(sniffMagic(avif.buffer), "avif");
});

test("sniffMagic returns unknown for unrecognized bytes", () => {
  assert.equal(sniffMagic(new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer), "unknown");
});

// ---------------------------------------------------------------------------
// sniffFormat — priority: mime > ext > url ext > magic.
// ---------------------------------------------------------------------------
test("sniffFormat: explicit mime wins over everything", () => {
  // PNG magic bytes but an avif mime → mime wins.
  assert.equal(sniffFormat({ mime: "image/avif", bytes: png4() }), "avif");
  assert.equal(sniffFormat({ mime: "image/jpeg" }), "jpeg");
  assert.equal(sniffFormat({ mime: "application/x-npy" }), "npy");
  // mime with parameters is tolerated.
  assert.equal(sniffFormat({ mime: "image/png; charset=binary" }), "png");
});

test("sniffFormat: extension hint when no mime", () => {
  assert.equal(sniffFormat({ ext: "npy" }), "npy");
  assert.equal(sniffFormat({ ext: ".NPZ" }), "npz");
  assert.equal(sniffFormat({ ext: "jpg" }), "jpeg");
  assert.equal(sniffFormat({ ext: "exr" }), "exr");
});

test("sniffFormat: URL extension when no mime/ext", () => {
  assert.equal(sniffFormat({ url: "https://x/y/z.avif" }), "avif");
  assert.equal(sniffFormat({ url: "/a/b.webp?v=2#frag" }), "webp");
  assert.equal(sniffFormat({ url: "https://x/no-ext" }), "unknown");
});

test("sniffFormat: falls back to magic bytes last", () => {
  assert.equal(sniffFormat({ bytes: png4() }), "png");
  assert.equal(sniffFormat({ bytes: makeNpy("<f4", [2, 2], [1, 2, 3, 4]) }), "npy");
  assert.equal(sniffFormat({}), "unknown");
});

// ---------------------------------------------------------------------------
// Format-class predicates.
// ---------------------------------------------------------------------------
test("isRawBufferFormat / isBrowserNativeFormat classify correctly", () => {
  for (const f of ["npy", "npz", "exr", ".npy", "NPZ"]) {
    assert.equal(isRawBufferFormat(f), true, `${f} should be raw-buffer`);
  }
  for (const f of ["png", "jpg", "jpeg", "webp", "avif", "gif"]) {
    assert.equal(isBrowserNativeFormat(f), true, `${f} should be browser-native`);
    assert.equal(isRawBufferFormat(f), false, `${f} should not be raw-buffer`);
  }
  assert.equal(isRawBufferFormat("bogus"), false);
  assert.equal(isBrowserNativeFormat("npy"), false);
});

// ---------------------------------------------------------------------------
// npyArrayToDecoded / decodeImage — raw-buffer decode.
// ---------------------------------------------------------------------------
test("npy uint8 [H,W] decodes to a u8 payload", () => {
  const buf = makeNpy("|u1", [2, 3], [10, 20, 30, 40, 50, 60]);
  const decoded = npyArrayToDecoded(parseNpy(buf));
  assert.equal(decoded.kind, "u8");
  assert.equal(decoded.width, 3);
  assert.equal(decoded.height, 2);
  if (decoded.kind === "u8") {
    assert.ok(decoded.data instanceof Uint8ClampedArray);
    assert.deepEqual(Array.from(decoded.data as Uint8ClampedArray), [10, 20, 30, 40, 50, 60]);
  }
});

test("npy float32 [H,W,C] decodes to an f32 payload with channels", () => {
  const vals = Array.from({ length: 2 * 2 * 3 }, (_, i) => i + 0.5);
  const buf = makeNpy("<f4", [2, 2, 3], vals);
  const decoded = npyArrayToDecoded(parseNpy(buf));
  assert.equal(decoded.kind, "f32");
  if (decoded.kind === "f32") {
    assert.equal(decoded.width, 2);
    assert.equal(decoded.height, 2);
    assert.equal(decoded.channels, 3);
    assert.ok(decoded.data instanceof Float32Array);
    assert.equal(decoded.data.length, 12);
    assert.ok(Math.abs(decoded.data[0]! - 0.5) < 1e-6);
  }
});

test("npy float64 [H,W] decodes to f32 with channels=1", () => {
  const buf = makeNpy("<f8", [1, 4], [1, 2, 3, 4]);
  const decoded = npyArrayToDecoded(parseNpy(buf));
  assert.equal(decoded.kind, "f32");
  if (decoded.kind === "f32") {
    assert.equal(decoded.channels, 1);
    assert.equal(decoded.width, 4);
    assert.equal(decoded.height, 1);
  }
});

test("npyArrayToDecoded rejects a non-2D/3D shape", () => {
  const buf = makeNpy("<f4", [8], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.throws(() => npyArrayToDecoded(parseNpy(buf)), /2D \[H,W\] or 3D/);
});

test("decodeImage dispatches npy bytes to the raw decoder", async () => {
  const buf = makeNpy("|u1", [1, 2], [7, 9]);
  const decoded = await decodeImage({ bytes: buf, ext: "npy" });
  assert.equal(decoded.kind, "u8");
  assert.equal(decoded.width, 2);
});

// ---------------------------------------------------------------------------
// Registry dispatch + the deferred EXR slot.
// ---------------------------------------------------------------------------
test("getDecoder returns a decoder for every known format, null for unknown", () => {
  const known: ImageFormat[] = ["png", "jpeg", "webp", "avif", "gif", "npy", "npz", "exr"];
  for (const f of known) assert.equal(typeof getDecoder(f), "function", `${f} decoder`);
  assert.equal(getDecoder("unknown"), null);
});

test("EXR dispatches to the bundled reader (rejects malformed bytes, not a stub)", async () => {
  const decoder = getDecoder("exr");
  assert.ok(decoder);
  // A truncated EXR (magic only) reaches the real reader and fails parsing —
  // NOT the old "decoder not bundled" stub. Full decode is covered in
  // `decoders/exr.test.ts`.
  await assert.rejects(
    decodeImage({ bytes: new Uint8Array([0x76, 0x2f, 0x31, 0x01]).buffer, ext: "exr" }),
  );
  // The raw decoder also requires bytes, not just a url.
  await assert.rejects(decodeImage({ url: "https://x/y.exr" }), /needs raw bytes/);
});

test("raw decoders require bytes, not just a url", async () => {
  await assert.rejects(decodeImage({ url: "https://x/y.npy" }), /needs raw bytes/);
});

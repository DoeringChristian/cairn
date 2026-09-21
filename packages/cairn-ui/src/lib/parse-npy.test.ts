/**
 * `parseNpy` decode coverage, focused on the float16 path.
 *
 * The SDK saves torch tensors through `np.save` WITHOUT casting
 * (`cairn/sdk/handlers/tensor.py`), so a half-precision tensor lands in the
 * browser as `<f2` (or `>f2` from a big-endian producer) and used to throw
 * "parseNpy: unsupported dtype". There is no `Float16Array` under this
 * tsconfig's ES2020 lib, so the conversion is hand-written and needs a real
 * proof over the interesting bit patterns: zero, normals, the largest finite
 * half, a subnormal, infinity and NaN.
 *
 * Run: `npm run test:unit` (node --experimental-strip-types --test).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { parseNpy } from "./parse-npy.ts";

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];

/**
 * Build a real v1.0 `.npy` buffer: magic + version + u16 header length + a
 * header padded (with spaces, terminated by `\n`) so the DATA starts on a
 * 64-byte boundary — exactly what `numpy.save` emits, and what the reader's
 * aligned fast path relies on.
 */
function npyBuffer(descr: string, payload: Uint8Array, shape: number[]): ArrayBuffer {
  const dict =
    `{'descr': '${descr}', 'fortran_order': False, ` +
    `'shape': (${shape.map((n) => `${n},`).join(" ")}), }`;
  const pad = (64 - ((10 + dict.length + 1) % 64)) % 64;
  const header = `${dict}${" ".repeat(pad)}\n`;
  const bytes = new Uint8Array(10 + header.length + payload.length);
  bytes.set(MAGIC, 0);
  bytes[6] = 1; // major
  bytes[7] = 0; // minor
  new DataView(bytes.buffer).setUint16(8, header.length, true);
  for (let i = 0; i < header.length; i++) bytes[10 + i] = header.charCodeAt(i);
  bytes.set(payload, 10 + header.length);
  return bytes.buffer;
}

/** Raw binary16 bit patterns and the values they must decode to. */
const HALF_BITS = [
  0x0000, // +0
  0x3c00, // 1
  0xc000, // -2
  0x3800, // 0.5
  0x7bff, // 65504 — the largest finite half
  0x0001, // 2^-24 — the smallest positive SUBNORMAL (~5.96e-8)
  0x7c00, // +Infinity
  0x7e00, // NaN
];
const HALF_VALUES = [0, 1, -2, 0.5, 65504, 2 ** -24, Infinity, NaN];

function halfPayload(littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(HALF_BITS.length * 2);
  const view = new DataView(bytes.buffer);
  HALF_BITS.forEach((bits, i) => view.setUint16(i * 2, bits, littleEndian));
  return bytes;
}

/** Every finite expectation here is exactly representable in binary16. */
function assertHalves(actual: Float64Array, label: string): void {
  assert.equal(actual.length, HALF_VALUES.length, `${label}: element count`);
  HALF_VALUES.forEach((want, i) => {
    const got = actual[i]!;
    if (Number.isNaN(want)) {
      assert.ok(Number.isNaN(got), `${label}: index ${i} should be NaN, got ${got}`);
      return;
    }
    if (!Number.isFinite(want)) {
      assert.equal(got, want, `${label}: index ${i}`);
      return;
    }
    const tolerance = Math.abs(want) * 1e-6;
    assert.ok(
      Math.abs(got - want) <= tolerance,
      `${label}: index ${i} want ${want}, got ${got}`,
    );
    assert.equal(got, want, `${label}: index ${i} is exactly representable`);
  });
}

test("parseNpy decodes little-endian float16 through the aligned fast path", () => {
  const array = parseNpy(npyBuffer("<f2", halfPayload(true), [HALF_BITS.length]));
  assert.equal(array.dtype, "<f2");
  assert.deepEqual(array.shape, [HALF_BITS.length]);
  assert.equal(array.fortranOrder, false);
  assertHalves(array.data, "<f2");
});

test("parseNpy decodes big-endian float16 through the per-element slow path", () => {
  const array = parseNpy(npyBuffer(">f2", halfPayload(false), [HALF_BITS.length]));
  assert.equal(array.dtype, ">f2");
  assertHalves(array.data, ">f2");
});

test("parseNpy still decodes the pre-existing dtypes", () => {
  const f4 = new Uint8Array(new Float32Array([1.5, -2.25]).buffer);
  assert.deepEqual(
    Array.from(parseNpy(npyBuffer("<f4", f4, [2])).data),
    [1.5, -2.25],
  );
  const i2 = new Uint8Array(new Int16Array([-7, 9]).buffer);
  assert.deepEqual(Array.from(parseNpy(npyBuffer("<i2", i2, [2])).data), [-7, 9]);
});

test("parseNpy names the dtype AND the supported list on an unsupported dtype", () => {
  const payload = new Uint8Array(2 * 8); // two complex64 values
  assert.throws(
    () => parseNpy(npyBuffer("<c8", payload, [2])),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /unsupported dtype '<c8'/);
      assert.match(message, /supported:/);
      assert.match(message, /f2/);
      assert.match(message, /b1/);
      return true;
    },
  );
});

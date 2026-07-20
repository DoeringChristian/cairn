/**
 * `vendor/three-shim.js` — a tiny, dependency-free stand-in for the handful of
 * `three` exports that the vendored `exr-loader.js` imports, so the EXR decoder
 * ships self-contained inside the cairn-plot bundle WITHOUT pulling `three` (a
 * heavy 3D engine) into the image-decode path.
 *
 * What the loader actually touches at runtime:
 *   - numeric texture-type / format / filter constants (just tags on the output
 *     object — their exact values match three@0.185.1 `src/constants.js`);
 *   - `DataTextureLoader` — only as the base class; `parse(buffer)` (the sole
 *     entry point we call) never uses any base-class behavior, so an empty
 *     constructor suffices;
 *   - `DataUtils.toHalfFloat` — f32→f16 conversion, copied faithfully from
 *     three@0.185.1 `src/extras/DataUtils.js` (Fast Half Float Conversions,
 *     Jeroen van der Zijp). Used internally for B44 log tables etc.; the f32
 *     output path we drive does not depend on it for correctness of RGB values.
 *
 * Provenance/licensing for the copied conversion is recorded in PROVENANCE.md
 * (three.js — MIT).
 */

// --- Texture-type / format / filter constants (three@0.185.1) --------------
export const LinearFilter = 1006;
export const FloatType = 1015;
export const HalfFloatType = 1016;
export const RGBAFormat = 1023;
export const RedFormat = 1028;
export const RGFormat = 1030;
export const LinearSRGBColorSpace = "srgb-linear";

// --- DataTextureLoader base (parse() needs no base behavior) ----------------
export class DataTextureLoader {
  constructor(manager) {
    this.manager = manager;
  }
}

// --- Fast f32 -> f16, faithful copy of three's DataUtils tables -------------
const _buffer = new ArrayBuffer(4);
const _floatView = new Float32Array(_buffer);
const _uint32View = new Uint32Array(_buffer);
const _baseTable = new Uint32Array(512);
const _shiftTable = new Uint32Array(512);

for (let i = 0; i < 256; ++i) {
  const e = i - 127;
  if (e < -27) {
    _baseTable[i] = 0x0000;
    _baseTable[i | 0x100] = 0x8000;
    _shiftTable[i] = 24;
    _shiftTable[i | 0x100] = 24;
  } else if (e < -14) {
    _baseTable[i] = 0x0400 >> (-e - 14);
    _baseTable[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000;
    _shiftTable[i] = -e - 1;
    _shiftTable[i | 0x100] = -e - 1;
  } else if (e <= 15) {
    _baseTable[i] = (e + 15) << 10;
    _baseTable[i | 0x100] = ((e + 15) << 10) | 0x8000;
    _shiftTable[i] = 13;
    _shiftTable[i | 0x100] = 13;
  } else if (e < 128) {
    _baseTable[i] = 0x7c00;
    _baseTable[i | 0x100] = 0xfc00;
    _shiftTable[i] = 24;
    _shiftTable[i | 0x100] = 24;
  } else {
    _baseTable[i] = 0x7c00;
    _baseTable[i | 0x100] = 0xfc00;
    _shiftTable[i] = 13;
    _shiftTable[i | 0x100] = 13;
  }
}

function toHalfFloat(val) {
  if (val > 65504) val = 65504;
  else if (val < -65504) val = -65504;
  _floatView[0] = val;
  const f = _uint32View[0];
  const e = (f >> 23) & 0x1ff;
  return _baseTable[e] + ((f & 0x007fffff) >> _shiftTable[e]);
}

export const DataUtils = { toHalfFloat };

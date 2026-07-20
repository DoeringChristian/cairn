/**
 * Types for the vendored `exr-loader.js` (three.js `EXRLoader`, see
 * PROVENANCE.md). Only the surface the adapter (`../exr-full.ts`) drives is
 * declared; the `.js` itself is not type-checked (no `allowJs`).
 */

/** One input channel as parsed from the EXR header. */
export interface ExrLoaderChannel {
  name: string;
  /** OpenEXR pixelType: 0=UINT, 1=HALF, 2=FLOAT. */
  pixelType: number;
}

/** The parsed EXR header three exposes on its result. */
export interface ExrLoaderHeader {
  channels: ExrLoaderChannel[];
  /** Human-readable compression id, e.g. `"PIZ_COMPRESSION"`. */
  compression: string;
}

/**
 * `parse()` result. With `type = FloatType`, `data` is a `Float32Array`; with
 * `HalfFloatType` it is a `Uint16Array`. With `outputFormat = RGBAFormat` the
 * data is 4-channel interleaved, stored BOTTOM-to-TOP (row 0 = image bottom).
 */
export interface ExrLoaderResult {
  width: number;
  height: number;
  data: Float32Array | Uint16Array;
  header: ExrLoaderHeader;
}

export class EXRLoader {
  constructor(manager?: unknown);
  /** Texture type — `FloatType` (1015) or `HalfFloatType` (1016). */
  type: number;
  /** Output format — `RGBAFormat` (1023), `RGFormat` (1030), `RedFormat` (1028). */
  outputFormat: number;
  /** Part index for multi-part files. */
  part: number;
  parse(buffer: ArrayBuffer): ExrLoaderResult;
}

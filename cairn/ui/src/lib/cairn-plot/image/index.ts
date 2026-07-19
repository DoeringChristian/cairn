export { computeDiff, loadImageData, DIFF_MODE_LABELS, type DiffMode } from "./diff";
export { webglRenderDiffToCanvas, isWebGL2Available, type WebGLDiffOptions } from "./webgl-diff";
export { getRenderMode, setRenderMode, type RenderMode } from "./render-mode";
export { getCachedImageData, setCachedImageData } from "./cache";
export {
  TONEMAP_OPERATORS,
  DEFAULT_TONEMAP,
  getTonemapOperator,
  applyExposure,
  srgbOetf,
  outputEncode,
  type TonemapOperator,
  type RgbTriple,
} from "./tonemap";

// Multi-format image decoder registry (browser-native + raw npy/npz; EXR slot
// deferred). `decodeImage`/`loadImageAny` normalize any url/bytes source into
// the canonical `DecodedImage` the CPU/GPU backends consume — the seam plugged
// in at the DataSpec-resolution call sites (see `plot-descriptor.ts`).
export {
  decodeImage,
  decodeImage as loadImageAny,
  sniffFormat,
  sniffMagic,
  getDecoder,
  npyArrayToDecoded,
  decodedU8ToDataUrl,
  isRawBufferFormat,
  isBrowserNativeFormat,
  type DecodedImage,
  type ImageSource,
  type ImageFormat,
  type ImageDecoder,
} from "./decoders";

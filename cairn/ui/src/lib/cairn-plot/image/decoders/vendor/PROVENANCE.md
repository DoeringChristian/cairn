# Vendored EXR decoder — provenance

This directory vendors a **pure-JS** OpenEXR decoder so cairn-plot can decode all
common EXR compressions (NONE, RLE, ZIP(S), **PIZ**, **PXR24**, **B44/B44A**,
**DWAA/DWAB**; plus tiled / multi-part / deep) with **no runtime npm dependency**
and **no CDN** — everything ships inside the plot bundle. Rationale and the
wasm-vs-JS trade-off are in
`docs/superpowers/specs/2026-07-19-wasm-exr-decoder.md`.

## Sources (all permissive licenses)

### `exr-loader.js`
- Upstream: **three.js** `examples/jsm/loaders/EXRLoader.js`
- Package/version: `three@0.185.1`
- URL: https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/EXRLoader.js
- Upstream file sha256: `1355b32a2ee1226bffd0f96558f3d21e300832813ab70d51ec971025ebc34d5d`
- License: **MIT** (three.js) — see `LICENSE-three.txt`. The file additionally
  preserves the original **BSD-3-Clause** notices from TinyEXR (Syoyo Fujita) and
  OpenEXR / Industrial Light & Magic in its header comment, as required.
- **Modifications (this is the ONLY diff vs. upstream):** the two `import`
  statements were repointed from `'three'` → `'./three-shim.js'` and from
  `'../libs/fflate.module.js'` → `'./fflate.module.js'`, and a short vendoring
  comment was added above them. No decode logic was changed. Verify with:
  `diff <(curl -sL <upstream-url>) exr-loader.js` (expect only the import lines +
  the comment block).

### `fflate.module.js`
- Upstream: **fflate** as bundled by three.js at `examples/jsm/libs/fflate.module.js`
- Package/version: `fflate@0.8.2` (bundled inside `three@0.185.1`)
- URL: https://github.com/mrdoob/three.js/blob/r185/examples/jsm/libs/fflate.module.js
- Upstream file sha256: `209a4412eb48ce609edb4391992a792ffcc3983d30ee7e2b0b89a8c470f3cd8a`
- License: **MIT** (Arjun Barrett) — see `LICENSE-fflate.txt`
  (https://github.com/101arrowz/fflate/blob/master/LICENSE).
- **Modifications:** none (byte-identical copy). Only `unzlibSync` (raw zlib
  inflate) is imported by `exr-loader.js`; the bundler tree-shakes the rest.

### `three-shim.js`
- **Hand-written** (not vendored). A dependency-free stand-in exporting the small
  set of `three` symbols `exr-loader.js` imports: the numeric
  texture-type/format/filter constants (values copied from `three@0.185.1`
  `src/constants.js`), an empty `DataTextureLoader` base class (the `parse()`
  entry point uses no base-class behavior), and a faithful copy of
  `DataUtils.toHalfFloat` (three@0.185.1 `src/extras/DataUtils.js`, "Fast Half
  Float Conversions"). Covered by three.js's MIT license (`LICENSE-three.txt`).

## Fixture

`../fixtures/rgb-piz-half-64x48.exr`
- 64×48, HALF R/G/B channels, **PIZ** compression, single-part scanline.
- sha256: `34c129e82f9076441d3aa72bb7f01165c2f215cdb3a1cdfdb06405c45fc9dd81`
- Generated locally with **OpenEXR 3.4.13** (official PyPI wheel) from a
  deterministic, half-exact ramp: `R=(x*0.5)%8`, `G=(y*0.25)%4`,
  `B=((x+y)%16)*0.125`. Committed so the test suite stays fully offline.

## Upgrading

Bump `three`, re-copy `EXRLoader.js` → `exr-loader.js` and re-apply the two-line
import repoint (or re-run the `diff` check above), re-copy `fflate.module.js`,
update the versions + sha256s here, and re-run `exr-full.test.ts`.

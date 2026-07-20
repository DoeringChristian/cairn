# Full-coverage EXR decoder (PIZ/PXR24/B44/DWA) + off-main-thread decode

Status: implemented (2026-07-19). Supersedes the "minimal EXR reader" scope of
`2026-07-19-client-image-decoders.md` for the compression coverage + threading
axes.

## Problem

`image/decoders/exr.ts` is a dependency-free browser reader that only covers
`NONE`/`ZIP`/`ZIPS`. Real-world EXRs (e.g. the ASWF `Desk.exr` sample) are
**PIZ**-compressed and hit the explicit `unsupported EXR variant: PIZ` error —
the user's blocker. Secondary gaps: `PXR24`, `B44/B44A`, `DWAA/DWAB`.

Second complaint: "images take a long time to de-compress". Decode runs
**synchronously on the main thread** inside `resolveDataProps` (plot-descriptor),
so a large PIZ/DWA decode janks the UI even once coverage exists.

## Toolchain reality (this machine)

- `emcc` and `docker` are **not** installed → building openexr/tinyexr → wasm
  from source is not viable here.
- FreeImage (via imageio) downloads only an **x86_64** `libfreeimage` dylib,
  which will not load on this arm64 host → no PIZ **write** path there.
- The route is therefore either (a) a **prebuilt** wasm vendored from a pinned
  npm/GitHub artifact, or (b) a **pure-JS** decoder vendored with provenance.

## Candidate survey

| Candidate | Route | Decodes | Notes |
|---|---|---|---|
| **three.js `EXRLoader`** (`three/examples/jsm/loaders/EXRLoader.js`) | pure JS | NONE, RLE, ZIP(S), **PIZ**, **PXR24**, **B44/A**, **DWAA/DWAB**, tiled, multi-part, deep | MIT (three) + BSD (Syoyo/tinyexr) + BSD (ILM/OpenEXR); ~86 KB source; battle-tested; depends only on `three` constants/`DataUtils.toHalfFloat` + `fflate.unzlibSync`. |
| tinyexr WASM (`@syoyo/tinyexr`-style) | prebuilt wasm | NONE, RLE, ZIP(S), PIZ, PXR24, B44, ZSTD, HTJ2K | **No DWAA/DWAB** (upstream: not planned). wasm blob + hand-audited glue. |
| `exrs` (Rust → wasm) | prebuilt wasm | NONE, RLE, ZIP(S), PIZ, PXR24, B44 | **No DWA** yet. Larger wasm. |
| `parse-exr` / misc npm | pure JS | mostly NONE/ZIP only | Subsets of three's loader; less complete. |

### Decision: vendor the three.js `EXRLoader` (pure JS)

Rationale (size / license / coverage, honestly weighed vs. wasm):

- **Coverage** is the widest of any option and the ONLY one covering **DWAA/DWAB**
  in addition to PIZ/PXR24/B44 — it satisfies the whole task list, plus tiled /
  multi-part / deep as a bonus.
- **License** is fully permissive (MIT + two BSD-3 notices, all preserved).
- **Auditability**: pure JS the reviewer can read; the vendored file differs from
  upstream `three@0.185.1` by exactly **two import lines** (repointed off `three`
  and off `../libs/fflate` onto local files) — trivially diff-able against a
  pinned upstream. A wasm blob is opaque and un-diffable, and the only prebuilt
  wasm that *would* be self-contained (tinyexr) still lacks DWA.
- **Performance**: pure JS is slower than wasm per-decode, but (a) the dominant
  UX problem is *main-thread blocking*, which the worker fixes regardless of
  wasm-vs-JS, and (b) three's loader is the de-facto browser EXR decoder used at
  scale, so per-decode cost is "adequate". A 64×48 PIZ decodes in ~1 ms locally;
  a multi-MP DWA in the tens–low-hundreds of ms — acceptable **off the main
  thread**. If profiling later shows a hotspot, a tinyexr-wasm PIZ fast-path can
  be slotted behind the same worker seam without touching callers.
- **Toolchain**: needs no emcc/docker — vendorable today.

Dependencies vendored alongside it, self-contained (no runtime npm dep):
- `vendor/exr-loader.js` — three's `EXRLoader.js` (2-line import repoint only).
- `vendor/fflate.module.js` — three's bundled fflate (MIT); only `unzlibSync`
  (raw inflate) is used, and Vite tree-shakes the rest out of the chunk.
- `vendor/three-shim.js` — hand-written stand-in exporting the handful of `three`
  symbols the loader imports: the numeric texture-type/format/filter constants,
  an empty `DataTextureLoader` base (the `parse()` entry never uses base
  behavior), and a faithful copy of `DataUtils.toHalfFloat`.

Provenance + license texts: `vendor/PROVENANCE.md`, `vendor/LICENSE-*.txt`.

## Key decode detail (verified empirically)

three's `EXRLoader.parse()` returns pixel data stored **bottom-to-top** (OpenGL
texture convention: output row 0 = image BOTTOM). Our canonical `DecodedImage`
(and the existing pure reader) is **top-to-bottom** row-major. The adapter
therefore **vertically flips** the rows. Verified against OpenEXR-written ground
truth: the committed PIZ fixture round-trips exactly (R/G/B per-pixel) once
flipped. It also compacts three's forced RGBA output to the pure-reader channel
contract: RGB(no A) → 3, RGBA → 4, single/Y → 1.

## Performance plan (off the main thread)

- Decode runs inside a **Web Worker** built from an **inline** blob (Vite
  `?worker&inline`) — self-contained, no separate asset file, no CDN. The worker
  bundles the vendored decoder + fflate.
- **One persistent worker**, reused across decodes, with a **job queue**
  (message-id correlation), a per-job **timeout**, and error propagation back to
  the caller's promise. The result `Float32Array` is returned as a
  **transferable** (its `ArrayBuffer` is transferred, zero-copy).
- The vendored loader is driven with `type = FloatType`, so it emits a
  `Float32Array` directly — no separate half→float LUT is needed on the output
  path. (three's internal `DataUtils.toHalfFloat` LUT, used only for B44 log
  tables etc., is vendored in the shim.)
- Because the plot bundle is a single IIFE (`inlineDynamicImports: true`), the
  worker's blob bytes live inside the bundle; the worker only *spins up* on the
  first EXR decode. See "Bundle size" concern below.

## Fallback story

`exr-decode.ts` dispatcher, in order:
1. **Worker + full decoder** (all supported compressions) — primary.
2. If `Worker` is unavailable (SSR / non-browser / node tests) → run the full
   decoder on the **main thread** (same code, same coverage).
3. If the full decoder throws (or its module fails to load) → the original
   **pure-TS reader** (`exr.ts`, NONE/ZIP/ZIPS) as a last-ditch net.
4. If both fail → the error is surfaced verbatim (unsupported variants keep an
   explicit message).

## Files

- `image/decoders/vendor/{exr-loader.js,fflate.module.js,three-shim.js,PROVENANCE.md,LICENSE-three.txt,LICENSE-fflate.txt}`
- `image/decoders/exr-full.ts` — vendored-loader adapter → `DecodedImage`
  (flip + channel compaction). Node-testable; the real decode logic.
- `image/decoders/exr-worker.ts` — inline-worker entry wrapping `exr-full`.
- `image/decoders/exr-decode.ts` — dispatcher (worker → main-thread full → pure).
- `image/decoders/exr.ts` — unchanged pure reader, now the fallback.
- `image/decoders.ts` — `exr` registry slot → the dispatcher.
- Fixture: `image/decoders/fixtures/rgb-piz-half-64x48.exr` (5 KB, HALF RGB, PIZ,
  generated locally with OpenEXR 3.4; deterministic half-exact ramp).

## Tests (offline, `node:test` + `--experimental-strip-types`)

- `exr.test.ts` (unchanged) — the pure reader / fallback.
- `exr-full.test.ts` — the full decoder through the **new route**: the committed
  PIZ fixture (dims 64×48, channels 3, exact pixel spot-checks, all finite) plus
  hand-built NONE/ZIP RGB/RGBA/Y fixtures asserting the flip + channel compaction.
- Browser-only (noted, not automated here): the actual `Worker` wrapper and Vite
  `?worker&inline` instantiation — verified via the plot build + a live
  browser check against the ASWF `Desk.exr`.

## Concerns

- **Bundle size**: the decoder + inflate add to the bundle that carries the image
  decode path (IIFE, so bytes are inlined rather than a separate lazy file).
  Reported as a delta at build time. A future refinement could hoist the EXR
  decoder into its own addon IIFE (like the three/figure addons) so scalar/table
  pages don't carry it.
- **Worker + `?worker&inline` under IIFE**: only verifies in a real Vite build /
  browser; node tests exercise the decode logic directly.
- **Single non-standard channel names**: three's loader only recognizes
  R/G/B/A/Y/RY/BY; an exotic single-channel name that the pure reader would treat
  as grayscale falls through to the pure-reader fallback.

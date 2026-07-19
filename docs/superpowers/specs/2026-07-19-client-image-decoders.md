# Client-side image decoding for cairn-plot endpoint/URL mode

_2026-07-19 — feature/client-image-decoders_

## Motivation

Images should be referenceable by **URL to an endpoint** instead of being
embedded (base64) in the self-contained HTML. When the browser holds only a
URL, it must **decode whatever the endpoint serves** — `png`/`jpeg`/`webp`/
`avif` (browser-native), `npy`/`npz` (raw numeric buffers), and `exr`
(HDR float). The decoder **registry** already exists
(`cairn/ui/src/lib/cairn-plot/image/decoders.ts`): a format sniffer
(mime → ext → magic bytes), a browser-native path (`createImageBitmap` →
`ImageData`), a raw npy/npz path, and an **EXR slot that currently throws**
`"EXR decoder not bundled"`.

This wave: (1) replace the EXR stub with a **minimal, dependency-free browser
EXR reader**, and (2) add an additive **`url?`** field to the image `DataSpec`
so `cp.Image(url="https://…/foo.exr")` fetches + sniffs + decodes client-side.

## Decisions

### 1. Minimal browser EXR reader (no WASM, no deps)

New module `cairn/ui/src/lib/cairn-plot/image/decoders/exr.ts`, async, pure TS,
using the browser/Node-native `DecompressionStream('deflate')` for ZIP/ZIPS.
Output is the canonical `{ kind:"f32", data:Float32Array, width, height,
channels }` — RGB→3, RGBA→4, Y/single→1.

#### Supported (common cases)

- **Single-part scanline** images only.
- Pixel types **HALF** (16-bit float) and **FLOAT** (32-bit); UINT is read too
  (cast to f32) since it costs nothing, but is not a target case.
- Compression **NONE**, **ZIP** (16-line blocks), **ZIPS** (1-line blocks).
- Channel-name → output mapping: `R`/`G`/`B`(/`A`) → RGB(A); luminance-only
  `Y` → 1 channel; a single unnamed/other channel → 1 channel.
- `lineOrder` INCREASING_Y **and** DECREASING_Y (each block carries its own `y`,
  so we place scanlines by coordinate and line order is irrelevant).

#### Explicitly OUT (clear `"unsupported EXR variant: <what>"` errors)

- **Tiled**, **multi-part**, **deep** images (detected from the version flags).
- Compression **RLE / PIZ / PXR24 / B44 / B44A / DWAA / DWAB**.
- Layered/dotted channel names (e.g. `diffuse.R`), or a channel set that is
  neither RGB(A) nor a single luminance channel → `"unsupported EXR channel
  layout"`.

### 2. EXR file layout (what the reader parses)

Byte order is **little-endian** throughout.

1. **Magic** `76 2f 31 01` (uint32 `20000630`). — already sniffed by
   `sniffMagic`.
2. **Version** (int32): low byte = version number (1/2); the flag bits gate
   support:
   - `TILED_FLAG   = 0x0200` → tiled (unsupported)
   - `LONG_NAMES_FLAG = 0x0400` → tolerated (only affects name length)
   - `NON_IMAGE_FLAG = 0x0800` → deep (unsupported)
   - `MULTI_PART_FLAG = 0x1000` → multi-part (unsupported)
3. **Header**: a list of attributes, terminated by an **empty name** (a lone
   `0x00`). Each attribute = `name\0` `type\0` `size:int32` `value[size]`.
   Attributes consumed:
   - `channels` (`chlist`): repeated `name\0` `pixelType:int32`
     (0=UINT,1=HALF,2=FLOAT) `pLinear:uint8` `reserved[3]` `xSampling:int32`
     `ySampling:int32`, list terminated by an empty name. The file stores
     channels **sorted by name**; the reader re-sorts defensively.
   - `compression` (`compression`, 1 byte): 0=NONE,1=RLE,2=ZIPS,3=ZIP,4=PIZ,
     5=PXR24,6=B44,7=B44A,8=DWAA,9=DWAB.
   - `dataWindow` (`box2i`, 4×int32): xMin,yMin,xMax,yMax →
     `width = xMax-xMin+1`, `height = yMax-yMin+1`.
   - (`displayWindow`, `lineOrder`, `pixelAspectRatio`, `screenWindow*` are
     read past / ignored; `lineOrder` need not be honored — see below.)
4. **Scanline offset table** (immediately after the header terminator):
   `nBlocks = ceil(height / linesPerBlock)` entries, each a **uint64** file
   offset. `linesPerBlock` = 1 for NONE/RLE/ZIPS, **16 for ZIP**.
5. **Scanline blocks** (seek via the offset table): each block =
   `y:int32` (first scanline, dataWindow coords) `dataSize:int32`
   `data[dataSize]`. Scanlines in a block = `min(linesPerBlock, yMax-y+1)`.
   Uncompressed block size = `scanlines × bytesPerScanline`, where
   `bytesPerScanline = width × Σ sizeof(channel)` and sizeof HALF=2,
   FLOAT=4, UINT=4.
   - **Uncompressed-fallback rule**: OpenEXR stores a block **raw** when
     compression did not shrink it, i.e. the on-disk `dataSize == uncompressed
     size`. On read: `dataSize < uncompressedSize` ⇒ decompress; otherwise the
     bytes are the natural layout already.
   - Within a decompressed/raw block the layout is **per scanline, then per
     channel (sorted), then per pixel**:
     `for i in scanlines: for c in sortedChannels: width × sizeof(c) bytes`.
     Scanline `i` maps to output row `y + i - yMin`.

### 3. EXR ZIP/ZIPS post-filter (the load-bearing detail)

ZIP blocks are **zlib** (RFC-1950, `DecompressionStream('deflate')`), but
inflating is not enough: OpenEXR applies a **predictor + byte-interleave**
*before* deflate, so the reader must undo both, in this exact order, over the
**whole inflated block buffer** (all channels/scanlines concatenated):

**Write path** (for reference): `interleave` → `predictor(delta)` → `deflate`.

**Read path** = `inflate` → **undo predictor** → **undo interleave**:

```
// undo predictor (running byte-wise sum with a -128 bias), t = 1 .. n-1:
buf[t] = (buf[t-1] + buf[t] - 128) & 0xff;

// undo interleave: first half → even output positions, second half → odd,
// half = (n + 1) >> 1:
let i1 = 0, i2 = half, s = 0;
while (s < n) { out[s++] = buf[i1++]; if (s < n) out[s++] = buf[i2++]; }
```

(The forward transform used to build test fixtures is the inverse:
deinterleave even/odd bytes into two halves, then `d = (cur - prev + 384) &
0xff` predictor, then `zlib.deflate`.) Getting the **order** (predictor before
interleave-undo) and the **±128/±256 bias math** right is the whole ballgame;
round-trip is verified in the unit tests.

### 4. HALF → f32

IEEE-754 half (1 sign / 5 exp / 10 mantissa), decoded with exact arithmetic
(every half value is exactly representable in f32):

- `exp==0, mant==0` → ±0.
- `exp==0, mant≠0` → subnormal `(-1)^s · mant · 2^-24`.
- `exp==31, mant==0` → ±Infinity; `mant≠0` → NaN.
- else normal `(-1)^s · 2^(exp-15) · (1 + mant/1024)`.

Denormals, ±Inf and NaN are covered by unit tests.

## Endpoint-URL flow today + the additive `url?` field

### How ENDPOINT mode builds artifact URLs

`plot-descriptor.ts` `resolveDataProps` resolves a `DataSpec` against a
`DataSource` (`cairn/ui/src/lib/cairn-plot/viewport/data-sources.ts`). The
ENDPOINT source is `createEndpointDataSource(artifactUrl)`, where `artifactUrl`
builds `${endpoint}/api/artifacts/${hash}` and `bytes(hash)` = `fetch()` of that
URL → `ArrayBuffer`. The image path already has a **raw-buffer decoder branch**:
when `data.format` names a raw format (`npy`/`npz`) it does
`decodeImage({ bytes: await source.bytes(hash), ext: format })` and shapes the
result — `f32` → `{ hdr: { data, shape, dtype:"<f4" } }`, `u8` →
`{ imageUrl: decodedU8ToDataUrl(...) }`. Browser-native formats keep the
byte-identical `<img src=url>` fast path.

### Existing `url` entry point

There is already a **`DataSpec{kind:"url"}`** (TS + `UrlDataSpec` in
`cairn/sdk/card_spec.py`), produced by `cp.Image("https://…")` (a bare `str`).
It is a **verbatim passthrough**: `imageUrl = src`, no fetch, no decode — the
browser `<img>` decodes it. That works only for browser-native formats; it
**cannot** render an `.exr`/`.npy` URL.

### Decision: additive `url?` on the `image` DataSpec

Add an optional **`url?: string`** to `DataSpec{kind:"image"}` (TS) and
`ImageDataSpec` (pydantic), alongside `hash`. When present, `resolveDataProps`
takes a **decode** path (not the passthrough): `fetch(url)` → `arrayBuffer()` →
`decodeImage({ bytes, url, mime: Content-Type })` (sniff by mime → url-ext →
magic) → `f32` → `hdr` prop shape, `u8` → `imageUrl` data URL — **the same
shaping as the `format?` branch**. This handles exr/npy/etc. at a URL that the
browser cannot `<img>`-decode, while remaining fully additive (absent `url` ⇒
current behavior unchanged).

`cp.Image(url="…")` emits `{ kind:"image", hash:None, url:"…" }`. In **local**
mode the URL is kept verbatim in the descriptor — the emitted HTML references
the endpoint, which is the entire point (no bytes baked in). We keep the
`kind:"url"` passthrough as-is for the plain browser-native `str` case; the new
`url=` kwarg is the decode-capable path.

### CORS (documented, not solved)

A cross-origin `fetch(url)` for bytes is subject to CORS: the serving endpoint
must send `Access-Control-Allow-Origin` for the page's origin, or the fetch is
blocked. This affects the **decode path only** (the `<img>` passthrough is not
CORS-gated for display, though it would be for canvas readback). Same-origin
endpoints (the cairn server serving both the page and `/api/artifacts/…`) are
unaffected. Out of scope to solve here; noted for users pointing at 3rd-party
hosts.

## Server side (report only — OUT of scope)

`cairn/server/routes/artifacts.py` `GET /api/artifacts/{digest}` serves the blob
with `media_type = mime_type`, the MIME stored **at ingest** (`artifacts`
table). So the served `Content-Type` for an `.exr`/`.npy` blob is whatever was
recorded when it was ingested (often `application/octet-stream` for baked
buffers). This is **fine for the client decoder**: `sniffFormat` prioritizes
mime, but falls back to the **URL extension** and then **magic bytes**, so an
`application/octet-stream` (or wrong) content-type still decodes correctly via
`.exr`/`.npy` extension or the magic signature. No server change is required or
made.

## Deferred / not in this wave

- Tiled, multi-part, deep EXR; RLE/PIZ/PXR24/B44/B44A/DWAA/DWAB compression.
- Layered EXR channel names / arbitrary channel sets.
- Solving cross-origin CORS (documented above).
- Server `Content-Type` improvements for `.exr`/`.npy` (client sniffing makes
  them unnecessary).
- No `dist` rebuild in this wave (orchestrator-gated).

# HDR images as OpenEXR end to end, decoded by a worker pool

Status: v1 DRAFT (2026-09-08). Owner: cairn (SDK, server, UI card) and
cairn-plot (decoders). Two implementation plans, one per repo.

## 1. Problem

Since 2026-09-02 (dfaf5e6f) the SDK stores every non-`uint8` image as a raw
`.npy` blob (`application/x-npy`). A 2048×1024 RGB float32 image is 25 MB.
Nothing in the pipeline reduces that: the WAL spills it to disk, the server
reads the whole blob under its single SQLite connection lock, the browser
fetches it, parses it on the main thread, keeps a float32 copy, and uploads an
`rgba32float` texture. A compare page with eight float panes moves 200 MB.

Measured on a render-like 2048×1024 RGB float32 image (smooth signal plus
Monte-Carlo noise), decode through the shipped OpenEXR WASM module (single
thread, node):

| format | bytes | decode |
|---|---|---|
| npy float32 (today) | 25.2 MB | 5 ms |
| EXR half, uncompressed | 12.6 MB | 2 ms |
| EXR half ZIP | 7.8 MB | 34 ms |
| EXR half PIZ | 7.4 MB | 43 ms |
| EXR half DWAA (lossy) | 4.3 MB | 62 ms |
| EXR float ZIP | 23.9 MB | 83 ms |

Python encode with the official `OpenEXR` binding (3.4.15): half PIZ 41 ms,
half ZIP 83 ms, read back 21 ms.

The client already ships the official C++ OpenEXR library (v3.4.9, Emscripten,
`wasm/openexr/build.sh`) behind a Web Worker, but a single persistent worker:
eight decodes run in series, a 30 s timeout on one job tears the worker down
and rejects every other in-flight job, and `.npy` never enters that worker at
all.

User rulings (2026-09-08):

1. HDR images are OpenEXR from `run.track` through the WAL, the artifact
   store, the server and the UI. No `.npy` for images where EXR can carry the
   data.
2. Decoding runs in a pool of workers so that nothing blocks; 40 ms per image
   is acceptable when images decode in parallel.
3. The CPU-backend kernels stay where they are (fallback only).

## 2. Goals and non-goals

Goals:

- `ImageHandler` writes OpenEXR half PIZ for float arrays, `image/x-exr`, and
  keeps exactness where half would lose it (integer dtypes, out-of-range
  values) by writing float channels instead.
- The SDK can read its own artifacts back (`deserialize`).
- cairn-plot decodes EXR and `.npy` in a pool of N workers, each with its own
  OpenEXR WASM instance; the main thread does fetch, cache bookkeeping and GPU
  upload only. A failing or slow job affects only its own worker.
- Deep EXR handles keep working: a handle is pinned to the worker that opened
  it.
- Legacy `application/x-npy` artifacts keep displaying; no migration is
  required to ship.

Non-goals:

- No change to the WAL record format, the `artifacts` schema, or the artifact
  route. They carry the mime string verbatim and already serve ranges.
- No server read-path work here (per-thread connections, streamed reads); that
  is a separate change and still needed.
- No CPU-kernel work; no PNG display proxies; no re-encode of stored blobs
  (a CLI for that can follow).
- No change to the 128 px PNG `preview` thumbnail in metadata.

## 3. SDK: `cairn/sdk/handlers/image.py`

### 3.1 Options and format policy

The caller chooses the container; OpenEXR is the default. Options travel the
way `boxes`/`masks` do today: as keywords on `run.track(...)` or on
`cairn.Image(...)`, merged into `serialize(**kwargs)` (call keywords win).

| keyword | values | default |
|---|---|---|
| `format` | `"exr"`, `"npy"`, `"png"` | `"exr"` |
| `precision` | `"half"`, `"float"`, `"auto"` | `"auto"` |
| `compression` | `"piz"`, `"zip"`, `"zips"`, `"none"`, `"dwaa"`, `"dwab"` | `"piz"` |

```python
run.track(hdr_array, name="render")                       # EXR half PIZ
run.track(depth_u16, name="depth", precision="float")     # EXR float channels
run.track(arr, name="raw", format="npy")                  # raw npy, as before
run.track(cairn.Image(hdr, compression="dwaa"), name="render")
```

`precision` and `compression` apply to `format="exr"` only; passing them with
another format raises `ValueError`. Unknown values raise `ValueError`.

The mime hook must see the options, so the optional handler hook becomes
`mime_type_for(obj, **kwargs)` and `resolve_mime_type(handler, obj, kwargs)`
in `handlers/registry.py`; the call sites in `run.py` pass the options they
gave `serialize` (`track`: merged wrapper+call keywords; `log_artifact`: its
keywords; `_log_versioned_artifact`: none). Handlers without the hook are
unaffected.

`_array_for_storage` is unchanged (torch → numpy, CHW → HWC, contiguous).
A pure function decides the encoding from the array and the options:

```python
@dataclass(frozen=True)
class ImageEncoding:
    container: Literal["exr", "npy", "png"]
    precision: Literal["half", "float"] | None   # exr only
    channels: Literal["Y", "RGB", "RGBA"] | None  # exr only
    compression: str | None                       # exr only
    fallback_reason: str | None                   # set when the default was not honoured

def image_encoding_for(arr: np.ndarray | None, *, format: str | None = None,
                       precision: str = "auto", compression: str = "piz") -> ImageEncoding:
```

`format=None` means "not given" and resolves to `"exr"`; the distinction only
matters for rule 4, where an explicit request fails loudly and the default
falls back.

Rules, in order:

1. `arr is None` (PIL image, figure) or `arr.dtype == np.uint8` → `png`.
   These carry display values, not scene-linear data; an explicit
   `format="exr"` or `"npy"` on them raises `ValueError` rather than storing
   8-bit values as floats.
2. `format="png"` → `png`: the tone-mapped 8-bit image `_to_pil` already
   builds for the preview becomes the artifact.
3. `format="npy"` → `npy`.
4. `format="exr"` (default) with a channel count (`1` for 2-D, else
   `shape[-1]`) not in `{1, 3, 4}`: the client's WASM binding compacts only
   Y / RGB / RGBA layouts, so when `format` was defaulted the encoding is
   `npy` with `fallback_reason="channel-layout"`; when `format="exr"` was
   passed explicitly, `ValueError`.
5. `precision="auto"`: integer or bool dtype → `float` (float32 holds every
   integer up to 2^24; half does not). Float dtype whose finite values all
   satisfy `|v| <= 65504` → `half`, otherwise `float`. NaN and ±Inf are
   representable in half and pass through.
6. `precision="half"` forces half; the handler records `clamped: true` in
   metadata when any finite value exceeded the half range.
7. `float64` inputs are cast to `float32` before the range check; the source
   dtype is recorded in metadata.

### 3.2 Encoding

Non-uint8 arrays go through `OpenEXR.File` (official binding, numpy-native
API, `openexr>=3.3` added to the core dependencies; wheels exist for
cpython 3.10–3.13 on macOS x86_64/arm64, manylinux x86_64/aarch64, musllinux
and Windows):

```python
header = {"compression": COMPRESSION[enc.compression], "type": OpenEXR.scanlineimage}
pixels = arr.astype(np.float16 if enc.precision == "half" else np.float32)
if pixels.ndim == 3 and pixels.shape[-1] == 1:
    pixels = pixels[..., 0]
with tempfile.TemporaryDirectory() as tmp:
    path = os.path.join(tmp, "image.exr")
    OpenEXR.File(header, {enc.channels: pixels}).write(path)
    data = Path(path).read_bytes()
```

The binding writes to a filename only, so the temp file is unavoidable; it is
one extra copy of the compressed bytes (7 MB), not of the raw array.

PIZ is the default: lossless, the smallest lossless option on noisy renders,
and the fastest lossless encode in the measurement above. `COMPRESSION` maps
the six option names to the binding's constants (`dwaa`/`dwab` are lossy and
documented as such in the `Image` docstring).

`mime_type_for` returns:

| container | mime |
|---|---|
| png | `image/png` |
| exr | `image/x-exr` |
| npy | `application/x-npy` |

`image/x-exr` is the string cairn-plot's registry maps to its EXR decoder.

### 3.3 Metadata

`serialize` keeps `width`, `height`, `channels`, `mode`, `preview`, `boxes`,
`masks`, `class_labels`, and adds for every non-PNG artifact:

```json
"hdr": {
  "container": "exr", "precision": "half", "compression": "piz",
  "source_dtype": "float32", "shape": [1024, 2048, 3], "clamped": false,
  "fallback_reason": null
}
```

(`container: "npy"` entries carry `precision: null, compression: null`;
`format="png"` on a float array records `container: "png"` with the tone-map
range used, so the reader knows the values are display-only.)
The `.npy` header used to carry dtype and shape implicitly; EXR does not, so
this block is the record of what was logged.

### 3.4 Reading back

`deserialize` sniffs magic bytes, as today:

- `\x76\x2f\x31\x01` → EXR: write to a temp file, `OpenEXR.File(path)`, return
  the single channel array as stored (`float16` or `float32`, HWC; a `Y`
  channel returns 2-D).
- `\x93NUMPY` → `np.load` (`format="npy"` and the channel-layout fallback).
- otherwise PIL.

### 3.5 Transport, WAL, server

No change. `upload_artifact` receives the mime from `resolve_mime_type`, the
WAL record and the `artifacts.mime_type` column store it verbatim, and
`GET /api/artifacts/{digest}` serves it back as `Content-Type`. The inline WAL
threshold (1 MB) is unchanged; 7 MB images spill to `.artifact.N.bin` files as
25 MB ones did.

## 4. cairn UI card

`CairnPlotCard.tsx` `artifactFormat` matches `openexr` or a `/exr` suffix, so
`image/x-exr` would currently produce `format: undefined` and rely on the
resolver's magic-byte path. It becomes an explicit table:

```ts
const FORMAT_BY_MIME: Record<string, string> = {
  "image/x-exr": "exr", "image/aces": "exr", "application/x-npy": "npy",
};
```

with the existing substring fallbacks kept for older mime spellings.

## 5. cairn-plot: decode worker pool

All new code lives under `ui/src/plots/image/resources/decoders/`, per the
image layout rule in `docs/plot-type-authoring.md`.

### 5.1 Shape

```
decode-pool-core.ts   pure scheduler: no Worker, no DOM; node-testable
decode-pool.ts        browser shell: spawns inline workers, owns the singleton
decode-worker.ts      the worker script (today's exr-worker.ts, plus npy)
exr-decode.ts         thin client of the pool (keeps its exported API)
decoders.ts           decodeNpy routes through the pool
```

`exr-worker.ts` is renamed to `decode-worker.ts`; its request union gains
`{ id; kind: "parseNpy"; buffer: ArrayBuffer }` and the response gains the
npy payload (`Float32Array` or `Uint8ClampedArray` data, `width`, `height`,
`channels`, transferred). The worker keeps one OpenEXR WASM instance
(`loadExrDecoder()` is already a per-realm singleton) and one deep-handle
table.

### 5.2 Scheduler (`decode-pool-core.ts`)

```ts
export interface PoolWorker {
  post(msg: unknown, transfer: Transferable[]): void;
  terminate(): void;
}
export interface PoolOptions {
  size: number;                       // >= 1
  spawn(): PoolWorker;                // shell supplies the inline worker
  timeoutMs: number;                  // per job, default 30_000
  now?(): number;
}
export interface Job<T> {
  make(id: number): unknown;          // request message
  transfer: Transferable[];
  affinity?: number;                  // worker index a deep handle lives in
  signal?: AbortSignal;
}
export class DecodePool {
  run<T>(job: Job<T>): Promise<{ result: T; worker: number }>;
  onMessage(worker: number, msg: { id: number }): void;   // shell wires this
  onWorkerError(worker: number, err: Error): void;
  dispose(): void;
}
```

Rules:

- Workers spawn lazily, up to `size`; a job goes to an idle worker, else to
  the least-loaded one, else it waits. Waiting jobs are served most-recent
  first, matching `decode-queue.ts` (the newest request is what the user is
  looking at).
- `affinity` forces the worker; such jobs never wait on another worker.
- Abort before dispatch removes the job from the queue and rejects with the
  abort reason. Abort after dispatch cannot interrupt WASM: the job completes
  and its result is dropped; the worker is not terminated.
- A job that exceeds `timeoutMs`, or a worker `error` event, terminates that
  worker only, rejects the jobs dispatched to it, respawns it on next use,
  and re-queues nothing (callers retry through the existing decode-retry
  paths). Other workers and their queues are untouched. Deep handles that
  lived in the terminated worker are invalid; `DeepFlattenController` reports
  that as an error on next use and the pane re-opens the source.
- Pool size: `clamp(navigator.hardwareConcurrency - 1, 1, 4)` in the shell;
  a `setDecodePoolSize(n)` export exists for harnesses.

### 5.3 Shell (`decode-pool.ts`)

Spawns `import("./decode-worker.ts?worker&inline")` once and constructs N
instances from the same inlined module, which keeps the single-file
`build:plot-inline` bundle valid. When `Worker` is undefined (node tests), the
pool is bypassed and today's main-thread `decodeExrPreferWasm` / `parseNpy`
paths run, unchanged.

### 5.4 Callers

- `exr-decode.ts`: `decodeFull`, `decodeDeepAware`, and the
  `DeepFlattenController` use `pool.run` with `affinity` set from the
  `{ worker }` returned by `openDeep`. Its public exports and fallback chain
  (worker → main-thread WASM → pure TS) are unchanged.
- `decoders.ts` `decodeNpy`: `await pool.run(parseNpy job)` and build the
  `DecodedImage` from the transferred buffer; the main-thread `parseNpy` call
  remains only for the no-`Worker` case.
- `resolve-data.ts`: no change; it awaits `decodeImage` as before.

### 5.5 Memory

Each worker's WASM heap grows to hold one compressed input plus one decoded
output and never shrinks. With four workers and 2 MP images that is under
200 MB worst case. The deep-handle LRU budget (`set_deep_budget`, currently
never called) stays at its 512 MB default per worker; lowering it is a
follow-up once deep usage on the compare page is measured.

## 6. Testing

cairn:

- `tests/unit/test_handler_image.py`: float32 RGB → `image/x-exr`, EXR magic,
  `hdr.precision == "half"`, round trip through `deserialize` within
  `|Δ| <= 2^-11 · |v|`; `uint16` → precision `float`, exact round trip;
  float values above 65504 → `float`; `precision="half"` on such values →
  `clamped: true`; 2-channel float → `application/x-npy`; grayscale float →
  channel `Y`, 2-D round trip; uint8 and PIL unchanged (`image/png`).
- `tests/unit/test_handler_image.py::test_image_encoding_for` table test of
  the policy function, including: explicit `format="exr"` on a 2-channel
  array raises; defaulted format on the same array → npy with
  `fallback_reason="channel-layout"`; `format="png"` on float → PNG bytes;
  `precision`/`compression` with `format="npy"` raise; `compression="dwaa"`
  round-trips within 2 % relative; call keyword overrides wrapper keyword.
- `tests/unit` for `resolve_mime_type(handler, obj, kwargs)`: format keyword
  changes the mime; handlers without the hook keep `handler.mime_type`.
- Integration: log a float image through `Run.track` with the WAL enabled,
  ingest, assert `artifacts.mime_type == "image/x-exr"` and that
  `GET /api/artifacts/{hash}` returns that `Content-Type` and EXR magic.
- `cairn/ui` unit test for `artifactFormat` (table).

cairn-plot:

- `decode-pool-core.test.ts` (node, fake workers): idle-first then
  least-loaded assignment; most-recent-first queue; affinity never waits on
  another worker; abort-before-dispatch rejects and dequeues; abort-after-
  dispatch drops the result without terminating; timeout terminates one
  worker and leaves the other's jobs pending; error event does the same;
  respawn after termination.
- `decode-pool.browser.ts` harness (self-driving): decode eight distinct EXR
  fixtures concurrently; assert at least two distinct workers reported, wall
  time under the serial sum, and no `longtask` entry over 50 ms attributed
  to the page during decoding (PerformanceObserver).
- `float-compare.browser.ts`: add an EXR × EXR and EXR × npy split/difference
  case using a committed half PIZ fixture.
- `exr-deep-flatten.test.ts`: deep controller affinity through the fake pool.
- Existing decoder tests keep running against the no-`Worker` path.

## 7. Compatibility

- New float artifacts are `image/x-exr`; old `application/x-npy` artifacts
  keep decoding through the same pool. No schema change, no re-encode.
- `format`, `precision`, `compression` are new keywords on `track` and
  `cairn.Image`; every other SDK call is unchanged. `mime_type_for` gains
  `**kwargs`; `resolve_mime_type` gains a `kwargs` argument (internal API).
- Half precision changes stored values for float32 inputs: about three
  significant decimal digits and a 65504 ceiling. The policy above promotes
  to float channels automatically where that would lose integers or range,
  and records what happened in `metadata.hdr`.
- `openexr` becomes a core SDK dependency (about 5 MB of wheels).

## 8. Open questions

None blocking. Follow-ups noted: server read path; deep budget sizing; a
`cairn artifacts reencode` CLI for old `.npy` blobs; moving the 40 ms encode
off the caller's thread in `Transport` if training-loop overhead shows up.

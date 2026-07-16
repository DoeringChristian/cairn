/**
 * METRICS reduction compute shader (WebGPU-only — Task 7 of the WebGPU
 * engine, Sub-project 1). Consumed by `engine/webgpu/device.ts`'s
 * `reduceDiffSumSquaredAbs()`, which `engine/image-engine.ts`'s
 * `computeMetrics()` calls when the shared device exposes it (WebGPU);
 * WebGL2 has no compute pipelines (`types.ts`'s `Device.createComputePipeline`
 * doc), so `computeMetrics()` falls back to `readback()` + a plain CPU loop
 * there instead — see that function's doc comment.
 *
 * ## Two-stage reduction (not a single global atomic)
 * WGSL has no atomic *float* add (only `atomic<i32>`/`atomic<u32>` integer
 * ops), so accumulating one global float sum across every invocation would
 * need a fixed-point integer encoding trick. Instead this shader does the
 * O(width*height) per-pixel work ENTIRELY on the GPU and reduces it down to
 * ONE partial `(sumSq, sumAbs)` pair PER WORKGROUP (a standard shared-memory
 * tree reduction within the workgroup, no atomics needed since each
 * workgroup's own invocations only ever write to their own `lid.x` slot and
 * a single barrier-synchronized combine) — leaving only
 * `ceil(width*height / WORKGROUP_SIZE)` additions for the CPU side
 * (`reduceDiffSumSquaredAbs`, after reading back this shader's small output
 * buffer) to finish. This is the same "block-level reduce, finish on host"
 * pattern real GPU reduction kernels use; the "GPU work" this task cares
 * about (the O(N) per-pixel diffing) never touches the CPU.
 *
 * ## What it computes
 * Per pixel (index `idx = y*width + x`, `idx < dims.count`): `d = texA.rgb -
 * texB.rgb` (via `textureLoad`, matching `image.wgsl.ts`'s texel-fetch
 * convention — no filtering), accumulating `sumSq += dot(d,d)` (sum of
 * squared per-channel diffs, R+G+B) and `sumAbs += abs(d.x)+abs(d.y)+abs(d.z)`
 * (sum of absolute per-channel diffs) into workgroup-shared arrays, then a
 * `stride`-halving barrier loop folds `sqShared`/`absShared` down to index 0,
 * which invocation 0 writes to `partial[workgroup_id.x*2]` /
 * `partial[workgroup_id.x*2+1]`. `dims.width`/`dims.height` are the
 * COMPARISON region (`min(texA, texB)` per axis — see
 * `image-engine.ts`'s `computeMetrics`), which may be smaller than either
 * texture's own dimensions; `textureLoad` coordinates always stay within
 * that (smaller-or-equal) region, so they're always in-bounds for both
 * textures regardless of which is larger.
 *
 * `engine/webgpu/device.ts`'s `reduceDiffSumSquaredAbs` sums the `count`
 * (RGB channel count = `width*height*3`) into `image-engine.ts`'s
 * `metricsFromSums` alongside the CPU-fallback path, so both backends
 * produce byte-for-byte-equivalent-formula `{mse, psnr, mae}` results (only
 * where the O(N) work happens differs).
 */
export const reduceWGSL = `
const WORKGROUP_SIZE: u32 = 256u;

@group(0) @binding(0) var texA: texture_2d<f32>;
@group(0) @binding(1) var texB: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> partial: array<f32>;

struct Dims {
  width: u32,
  height: u32,
  count: u32,
  _pad: u32,
};
@group(0) @binding(3) var<uniform> dims: Dims;

var<workgroup> sqShared: array<f32, 256>;
var<workgroup> absShared: array<f32, 256>;

@compute @workgroup_size(256)
fn cs_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>,
) {
  let idx = gid.x;
  var sq = 0.0;
  var ab = 0.0;
  if (idx < dims.count) {
    let x = i32(idx % dims.width);
    let y = i32(idx / dims.width);
    let a = textureLoad(texA, vec2<i32>(x, y), 0);
    let b = textureLoad(texB, vec2<i32>(x, y), 0);
    let d = a.rgb - b.rgb;
    sq = dot(d, d);
    ab = abs(d.x) + abs(d.y) + abs(d.z);
  }
  sqShared[lid.x] = sq;
  absShared[lid.x] = ab;
  workgroupBarrier();

  var stride = WORKGROUP_SIZE / 2u;
  loop {
    if (stride == 0u) {
      break;
    }
    if (lid.x < stride) {
      sqShared[lid.x] = sqShared[lid.x] + sqShared[lid.x + stride];
      absShared[lid.x] = absShared[lid.x] + absShared[lid.x + stride];
    }
    workgroupBarrier();
    stride = stride / 2u;
  }

  if (lid.x == 0u) {
    partial[wgid.x * 2u] = sqShared[0];
    partial[wgid.x * 2u + 1u] = absShared[0];
  }
}
`;

/**
 * COMPARE render-pass WGSL fragment shader (WebGPU backend only — mirrors
 * `compare.glsl.ts` exactly). Task 7 of the WebGPU engine, Sub-project 1:
 * replaces the CPU/DOM split-slider + CSS-opacity blend + the legacy
 * `image/webgl-diff.ts` raw-WebGL2 diff pass with ONE engine render pass
 * that samples TWO source textures (`texA` = foreground/prediction, `texB`
 * = reference/baseline) and composites them per `mode`. See
 * `engine/image-engine.ts`'s `renderCompare`/`CompareParams` doc comments
 * for the JS-side contract; this file documents the SHADER-level details.
 *
 * ## Per-side pipeline, THEN composite
 * Each source texel goes through the EXACT SAME `exposure -> [scalar LUT] ->
 * tone-map operator -> output-encode` pipeline `image.wgsl.ts` applies (see
 * that file's doc comment — `processSide` below is a verbatim copy of its
 * `fs_main` body, factored into a function so it can run twice), using ONE
 * shared set of `ImageParams` fields for BOTH sides (there is no per-side
 * exposure/operator in this pass). The two fully-processed (encoded, unless
 * `hdrOut`) colors are THEN composited per `mode`:
 *   - `split` (0): `uv.x < split ? colorA : colorB` — `uv.x` is the
 *     DESTINATION-space fragment coordinate (screen-space, [0,1] across the
 *     render target), NOT the source-sampled `srcUV` — the divider position
 *     is a fixed screen-space fraction independent of each side's own
 *     zoom/pan window, matching the CPU compositor's clip-path-on-the-
 *     outer-container behavior (`media-compare/compositor.tsx`'s
 *     `MediaComparePane`).
 *   - `blend` (1): `mix(colorA, colorB, alpha)`.
 *   - `diff` (2): per-channel `diffChannel(colorA, colorB, diffSubmode)`
 *     (ported VERBATIM from `image/webgl-diff.ts`'s `computeDiffChannel`,
 *     which already operates on [0,1]-normalized floats — the SAME six
 *     submodes in the SAME `DIFF_MODE_MAP` order), clamped to [0,1], then
 *     optionally colormapped (see below).
 *
 * ## Diff colormap (reuses the scalar-image LUT texture/convention)
 * When `mode == diff` and `useColormap` is set, the average of the clamped
 * per-channel diff (`(dr+dg+db)/3`) indexes the SAME 256x4 LUT texture
 * `t_bind2` the scalar-image path (`processSide`) reads, via the SAME
 * nearest-texelFetch/round-half-up convention `image.wgsl.ts` establishes
 * (see that file's doc comment) — NOT the legacy `image/webgl-diff.ts`
 * shader's bilinear `texture()` sampling of a separate `Uint8Array` LUT.
 * This is a deliberate simplification (documented in the Task 7 report):
 * reusing the existing nearest-texelFetch LUT machinery (already proven
 * correct by Task 5's harness) avoids adding a second, differently-filtered
 * texture/sampler path to the RHI purely for this one call site; the
 * `diffCmapMode` index-mapping math (`linear`/`signed` -> `avg`,
 * `positive` -> `0.5 + avg*0.5`) is ported verbatim from
 * `image/webgl-diff.ts`'s `CMAP_MODE_MAP` branch.
 *
 * ## Uniform layout (std140-compatible, matches `compare.glsl.ts`)
 * Reuses `image.wgsl.ts`'s "one BindGroupEntry per named uniform" convention
 * (see that file's doc comment for why — the RHI's `WGSL_UNIFORM_TYPE_SIZE`
 * table only knows scalar/vecN/mat4 types). Bindings 0/1/2 are textures
 * (texA, texB, LUT); bindings 3-6 are `vec4<f32>` uniforms:
 *
 *   logical binding 0 (`t_bind0`, texture, native 0*3+0=0):  texA (foreground/prediction)
 *   logical binding 1 (`t_bind1`, texture, native 1*3+0=3):  texB (reference/baseline)
 *   logical binding 2 (`t_bind2`, texture, native 2*3+0=6):  256x1 LUT (scalar-image / diff colormap; 1x1 placeholder when unused)
 *   logical binding 3 (`u_bind3`, native 3*3+2=11): .x=exposureEV .y=operatorId .z=gamma .w=isScalar — IDENTICAL layout to image.wgsl.ts's u_bind2.
 *   logical binding 4 (`u_bind4`, native 4*3+2=14): .xy=uvRect.xy .zw=uvRect.wh — IDENTICAL layout to image.wgsl.ts's u_bind3.
 *   logical binding 5 (`u_bind5`, native 5*3+2=17): .x=modeId(0=split,1=blend,2=diff) .y=split .z=alpha .w=diffSubmodeId(0..5, DIFF_MODE_MAP order)
 *   logical binding 6 (`u_bind6`, native 6*3+2=20): .x=diffCmapModeId(0=linear,1=signed,2=positive) .y=hdrOut .z=useColormap .w=unused(0)
 *   logical binding 7 (`u_bind7: f32`, native 7*3+2=23): filterMode (0=nearest, 1=linear — Q20, IDENTICAL convention to image.wgsl.ts's u_bind5)
 *
 * ## Out-of-bounds -> transparent (Q18) / bilinear filtering (Q20)
 * Both fixes are IDENTICAL to `image.wgsl.ts`'s (see that file's module doc
 * comment for the full rationale) — the SAME `rawSrcUV` [0,1) test (a single
 * check; texA/texB share one `uvRect`/`srcUV`, so there is exactly one
 * "in/out of bounds" decision per fragment, not one per side) gates a
 * transparent `vec4(0.0)` return before either side is sampled, and
 * `sampleBilinearF` (parameterized over WHICH texture, since there are two)
 * replaces `textureLoad` for both `texA`/`texB` when `filterMode==1`. The LUT
 * (`sampleLUT`) is always nearest, unaffected.
 *
 * ## Fullscreen triangle + Y-flip
 * Reuses the exact vertex stage `image.wgsl.ts`/`passthrough.wgsl.ts` use —
 * see those files' doc comments for the WebGPU-vs-WebGL2 Y-flip rationale.
 */
export const compareWGSL = `
struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let xRaw = f32((vertexIndex << 1u) & 2u);
  let yRaw = f32(vertexIndex & 2u);
  var out: VSOut;
  out.uv = vec2<f32>(xRaw, 1.0 - yRaw);
  out.position = vec4<f32>(xRaw * 2.0 - 1.0, yRaw * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

@group(0) @binding(0) var t_bind0: texture_2d<f32>; // texA
@group(0) @binding(3) var t_bind1: texture_2d<f32>; // texB
@group(0) @binding(6) var t_bind2: texture_2d<f32>; // LUT
@group(0) @binding(11) var<uniform> u_bind3: vec4<f32>; // exposureEV, operatorId, gamma, isScalar
@group(0) @binding(14) var<uniform> u_bind4: vec4<f32>; // uvRect.xy, uvRect.wh
@group(0) @binding(17) var<uniform> u_bind5: vec4<f32>; // modeId, split, alpha, diffSubmodeId
@group(0) @binding(20) var<uniform> u_bind6: vec4<f32>; // diffCmapModeId, hdrOut, useColormap, unused
@group(0) @binding(23) var<uniform> u_bind7: f32; // filterMode (0=nearest, 1=linear)

// --- ported verbatim from image/tonemap.ts (see image.wgsl.ts's doc comment) ---

fn srgbOetf(x: f32) -> f32 {
  let v = clamp(x, 0.0, 1.0);
  if (v <= 0.0031308) {
    return 12.92 * v;
  }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn outputEncodeF(x: f32, gamma: f32, hasGamma: bool) -> f32 {
  if (hasGamma) {
    return clamp(pow(clamp(x, 0.0, 1.0), 1.0 / gamma), 0.0, 1.0);
  }
  return srgbOetf(x);
}

fn reinhardCurve(x: f32) -> f32 {
  let v = max(x, 0.0);
  return v / (1.0 + v);
}

fn acesCurve(x: f32) -> f32 {
  let v = max(x, 0.0);
  let num = v * (2.51 * v + 0.03);
  let den = v * (2.43 * v + 0.59) + 0.14;
  return clamp(num / den, 0.0, 1.0);
}

fn applyOperator(rgb: vec3<f32>, operatorId: i32) -> vec3<f32> {
  if (operatorId == 2) {
    return vec3<f32>(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z));
  }
  if (operatorId == 3) {
    return vec3<f32>(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z));
  }
  return clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Nearest-texelFetch LUT lookup, round-half-up index (see image.wgsl.ts's doc
// comment) — shared by the scalar-image path (processSide) and the diff
// colormap path.
fn sampleLUT(valueUnit: f32) -> vec3<f32> {
  let idxF = clamp(valueUnit, 0.0, 1.0) * 255.0;
  let idx = clamp(i32(floor(idxF + 0.5)), 0, 255);
  return textureLoad(t_bind2, vec2<i32>(idx, 0), 0).rgb;
}

// Manual bilinear blend over EITHER source texture (texA or texB — see
// image.wgsl.ts's sampleBilinearF doc comment for the full rationale; this
// is parameterized over which texture since compare.wgsl.ts has two).
fn sampleBilinearOf(tex: texture_2d<f32>, uv: vec2<f32>, dims: vec2<f32>) -> vec4<f32> {
  let texel = uv * dims - vec2<f32>(0.5);
  let base = floor(texel);
  let frac = texel - base;
  let maxX = i32(dims.x) - 1;
  let maxY = i32(dims.y) - 1;
  let x0 = clamp(i32(base.x), 0, maxX);
  let x1 = clamp(i32(base.x) + 1, 0, maxX);
  let y0 = clamp(i32(base.y), 0, maxY);
  let y1 = clamp(i32(base.y) + 1, 0, maxY);
  let c00 = textureLoad(tex, vec2<i32>(x0, y0), 0);
  let c10 = textureLoad(tex, vec2<i32>(x1, y0), 0);
  let c01 = textureLoad(tex, vec2<i32>(x0, y1), 0);
  let c11 = textureLoad(tex, vec2<i32>(x1, y1), 0);
  let top = mix(c00, c10, frac.x);
  let bot = mix(c01, c11, frac.x);
  return mix(top, bot, frac.y);
}

// image.wgsl.ts's fs_main body, factored out so it can run once per side.
fn processSide(sampled: vec4<f32>, exposureEV: f32, operatorId: i32, gamma: f32, isScalar: bool, hdrOut: bool) -> vec3<f32> {
  var rgb = sampled.rgb * exp2(exposureEV);
  if (isScalar) {
    rgb = sampleLUT(rgb.x);
  }
  rgb = applyOperator(rgb, operatorId);
  if (hdrOut) {
    return rgb;
  }
  let hasGamma = gamma > 0.0;
  return vec3<f32>(
    outputEncodeF(rgb.r, gamma, hasGamma),
    outputEncodeF(rgb.g, gamma, hasGamma),
    outputEncodeF(rgb.b, gamma, hasGamma),
  );
}

// Ported verbatim from image/webgl-diff.ts's computeDiffChannel (already
// [0,1]-normalized-float semantics) — mode: 0=signed,1=absolute,2=squared,
// 3=relative_signed,4=relative_absolute,5=relative_squared (DIFF_MODE_MAP order).
fn diffChannel(a: f32, b: f32, mode: i32) -> f32 {
  let diff = a - b;
  let absDiff = abs(diff);
  let denom = max(a, 1.0 / 255.0);
  if (mode == 0) {
    return (diff + 1.0) / 2.0;
  }
  if (mode == 1) {
    return absDiff;
  }
  if (mode == 2) {
    return diff * diff;
  }
  if (mode == 3) {
    return (diff / denom + 1.0) / 2.0;
  }
  if (mode == 4) {
    return absDiff / denom;
  }
  if (mode == 5) {
    return (diff * diff) / (denom * denom);
  }
  return absDiff;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let uv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(0.999999));
  let uvRect = u_bind4;
  // Image-space UV, UNCLAMPED — Q18 (see image.wgsl.ts's doc comment). texA
  // and texB share one uvRect/srcUV, so this is a single in/out-of-bounds
  // decision for the whole fragment.
  let rawSrcUV = uvRect.xy + uv * uvRect.zw;
  if (rawSrcUV.x < 0.0 || rawSrcUV.x >= 1.0 || rawSrcUV.y < 0.0 || rawSrcUV.y >= 1.0) {
    return vec4<f32>(0.0);
  }
  let srcUV = clamp(rawSrcUV, vec2<f32>(0.0), vec2<f32>(0.999999));
  let filterLinear = u_bind7 > 0.5;

  let dimsA = vec2<f32>(textureDimensions(t_bind0));
  var sampledA: vec4<f32>;
  if (filterLinear) {
    sampledA = sampleBilinearOf(t_bind0, srcUV, dimsA);
  } else {
    sampledA = textureLoad(t_bind0, vec2<i32>(srcUV * dimsA), 0);
  }

  let dimsB = vec2<f32>(textureDimensions(t_bind1));
  var sampledB: vec4<f32>;
  if (filterLinear) {
    sampledB = sampleBilinearOf(t_bind1, srcUV, dimsB);
  } else {
    sampledB = textureLoad(t_bind1, vec2<i32>(srcUV * dimsB), 0);
  }

  let exposureEV = u_bind3.x;
  let operatorId = i32(round(u_bind3.y));
  let gamma = u_bind3.z;
  let isScalar = u_bind3.w > 0.5;
  let hdrOut = u_bind6.y > 0.5;

  let colorA = processSide(sampledA, exposureEV, operatorId, gamma, isScalar, hdrOut);
  let colorB = processSide(sampledB, exposureEV, operatorId, gamma, isScalar, hdrOut);

  let modeId = i32(round(u_bind5.x));
  let split = u_bind5.y;
  let alpha = u_bind5.z;
  let diffSubmodeId = i32(round(u_bind5.w));
  let diffCmapModeId = i32(round(u_bind6.x));
  let useColormap = u_bind6.z > 0.5;

  var outColor: vec3<f32>;
  if (modeId == 1) {
    // blend
    outColor = mix(colorA, colorB, alpha);
  } else if (modeId == 2) {
    // diff
    let dr = diffChannel(colorA.r, colorB.r, diffSubmodeId);
    let dg = diffChannel(colorA.g, colorB.g, diffSubmodeId);
    let db = diffChannel(colorA.b, colorB.b, diffSubmodeId);
    let diffRGB = clamp(vec3<f32>(dr, dg, db), vec3<f32>(0.0), vec3<f32>(1.0));
    if (useColormap) {
      let avg = (diffRGB.r + diffRGB.g + diffRGB.b) / 3.0;
      var idx = avg;
      if (diffCmapModeId == 2) {
        idx = 0.5 + avg * 0.5;
      }
      outColor = sampleLUT(idx);
    } else {
      outColor = diffRGB;
    }
  } else {
    // split (default)
    outColor = select(colorB, colorA, uv.x < split);
  }

  return vec4<f32>(outColor, 1.0);
}
`;

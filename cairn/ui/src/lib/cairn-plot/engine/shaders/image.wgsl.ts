/**
 * IMAGE render-pass WGSL fragment shader (the engine's only backend, WebGPU).
 * Turns a float/8-bit source image texture into displayed pixels via
 * `exposure -> [colormap] -> tone-map operator -> output-encode`,
 * bit-for-bit (within 1/255) with the CPU reference in `image/tonemap.ts`.
 * See `engine/image-engine.ts`'s module doc comment for the full pipeline
 * description and `ImageParams` contract; this file only documents the
 * SHADER-level details (uniform layout, operator porting, colormap LUT
 * convention).
 *
 * ## Fullscreen triangle + Y-flip
 * Reuses the exact vertex stage from `passthrough.wgsl.ts` (see that file's
 * doc comment for the Y-flip rationale): `uv.y` is flipped (`1.0 - yRaw`) so
 * `readback()`'s row order matches on-screen top-down expectations for the
 * same input — originally cross-checked pixel-for-pixel against a since-
 * removed WebGL2 backend by the parity test harness
 * (`engine/__tests__/image-pass.browser.ts`), now a same-backend regression
 * check against the CPU `image/tonemap.ts` reference.
 *
 * ## Uniform "block" layout (std140-compatible)
 * The RHI maps each `BindGroupEntry.binding = N` onto ONE named uniform
 * (`u_bindN`), not a literal single packed byte-blob — so the six
 * `ImageParams` fields the task brief describes as "one uniform block" are
 * split across THREE named uniform bindings, each a natural WGSL type
 * already supported by the bind-group builder (`WGSL_UNIFORM_TYPE_SIZE` in
 * `webgpu/device.ts` only knows scalar/vecN/mat4 types, no arrays/structs —
 * reusing exactly the vec4-uniform convention `scalebias.wgsl.ts` already
 * established avoids extending that table). Every field keeps IDENTICAL
 * component order:
 *
 *   logical binding 2 (`u_bind2: vec4<f32>`, native binding 2*3+2=8):
 *     .x = exposureEV        (f32, EV stops)
 *     .y = operator           (f32, rounded to int: 0=linear,1=srgb,2=reinhard,3=aces,4=extended)
 *     .z = gamma               (f32; <=0 means "unset" -> sRGB OETF encode)
 *     .w = isScalar            (f32, 0/1 boolean flag)
 *   logical binding 3 (`u_bind3: vec4<f32>`, native binding 3*3+2=11):
 *     .xy = uvRect.xy (window origin, [0,1] source-space)
 *     .zw = uvRect.wh (window size,   [0,1] source-space)
 *   logical binding 4 (`u_bind4: f32`, native binding 4*3+2=14):
 *     = hdrOut (f32, 0/1 boolean flag)
 *   logical binding 5 (`u_bind5: f32`, native binding 5*3+2=17):
 *     = filterMode (f32, 0=nearest, 1=linear — see "Out-of-bounds..." /
 *       "Source filtering" sections below; Q20)
 *
 * ## Out-of-bounds -> fully transparent (Q18)
 * `uvRect` (`u_bind3`) is the zoom/pan WINDOW in source-space `[0,1]`; when
 * zoomed OUT past the image's native size, `uvRect.zw` exceeds `1-uvRect.xy`
 * and the window's far edge lands outside `[0,1]`. The image-space UV
 * (`rawSrcUV` below, BEFORE any clamping) is tested against `[0,1)` on both
 * axes first: outside it, the fragment returns `vec4(0.0)` (fully
 * transparent, RGBA all-zero) WITHOUT sampling `t_bind0` at all — no
 * clamped-edge smear/repeat. This requires the WebGPU canvas surface to be
 * configured `alphaMode:'premultiplied'` (`engine/webgpu/surface.ts`) so the
 * zero-alpha fragment actually composites as transparent (an `'opaque'`
 * surface would force every pixel's alpha to 1 at present time, hiding this
 * fix) — the caller's checkerboard background (`cairn-checkerboard`, applied
 * to the pane container behind the canvas) then shows through.
 *
 * ## Source filtering: nearest vs. manual bilinear (Q20)
 * `t_bind0`/`t_bind1` are `unfilterable-float`-safe (`textureLoad`, see
 * "Texel fetch..." below) specifically so `rgba32float`/`r32float` HDR
 * sources work without requiring the optional `float32-filterable` WebGPU
 * feature — a REAL `Sampler`+`textureSample` pair (the RHI's
 * `Device.createSampler`) would need that feature for the HDR path, which
 * isn't guaranteed to be available (see `engine/webgpu/device.ts`'s "Texel
 * fetch" doc note), so it is NOT used here. Instead `filterMode` (`u_bind5`)
 * selects between a single nearest `textureLoad` (`filterMode==0`) and a
 * manual bilinear blend of the four neighboring texels (`filterMode==1`,
 * `sampleBilinearF` below), computed entirely from `textureLoad` calls — this
 * works identically for every `TextureFormat` this engine uses and needs no
 * GPU feature beyond what `textureLoad` already requires. `GpuImagePane`
 * drives `filterMode` from the SAME `PIXEL_VALUE_MIN_SCREEN_PX` threshold
 * `PixelValueOverlay` uses (nearest once a source texel is large enough
 * on-screen to show its per-pixel TEV number, linear below that), so the
 * "crisp/blocky pixels" and "pixel-value numbers" visual cues change in
 * lockstep. At exact 1:1 (or any texel-aligned) sampling the bilinear blend's
 * fractional weight is exactly 0, so it degenerates to the SAME value nearest
 * would produce — this is why enabling it by default does not change any of
 * this file's existing byte-exact parity-test cases (all texel-aligned).
 *
 * ## Operator porting (verbatim from `image/tonemap.ts`)
 * `TONEMAP_OPERATORS` order or its keys, and `applyOperator`'s `if` chain,
 * match `image/tonemap.ts`'s object literal order: `linear`(0), `srgb`(1),
 * `reinhard`(2), `aces`(3). `linear` and `srgb` are literally the SAME
 * per-channel `clamp01` in the CPU source (the sRGB OETF lives in the
 * SEPARATE `outputEncode` stage, not the operator) — ported here as the
 * exact same shared clamp. `reinhardCurve`/`acesCurve` port
 * `reinhardCurve`/`acesCurve` from `tonemap.ts` term-for-term (including the
 * `max(x,0)` pre-clamp and, for ACES, the Narkowicz 2015 rational
 * approximation's exact coefficients).
 *
 * ## Output-encode porting (verbatim from `image/tonemap.ts`)
 * `srgbOetf`/`outputEncode` port `srgbOetf`/`outputEncode` term-for-term: the
 * sRGB OETF's `12.92*v` / `1.055*pow(v,1/2.4)-0.055` piecewise split at
 * `0.0031308`, and the `gamma` override only replacing the sRGB path when
 * `gamma > 0` (`hasGamma`, computed from `u_bind2.z` — WGSL/GLSL have no
 * `undefined`, so "unset" is encoded as `gamma <= 0`, matching
 * `image-engine.ts`'s `ImageParams.gamma?: number` -> uniform packing, which
 * writes `0` for an absent/non-positive `gamma`).
 *
 * ## Colormap LUT (scalar-image path)
 * `t_bind1` is a `256x1 rgba32float` texture (or a 1x1 placeholder when
 * `ImageParams.colormap` is absent — see `image-engine.ts`'s
 * `buildColormapTexture`) holding a `256x4` RGBA-float lookup table. When
 * `isScalar` is set, the scalar value is taken from `rgb.x` AFTER exposure
 * is applied (matching the brief's pipeline order: `v*=2^exposureEV; if
 * (isScalar) v.rgb = colormapLUT(v.r)`), clamped to `[0,1]`, scaled to
 * `[0,255]`, rounded via `floor(idxF + 0.5)` (deterministic round-half-UP,
 * matching the CPU/test reference's `Math.round` — NOT the shader-native
 * `round()`, which is round-half-to-EVEN in WGSL and implementation-defined
 * in GLSL, so either could disagree with `Math.round`, and with each other,
 * exactly at `k+0.5` index boundaries), clamped to `[0,255]`, and used as an
 * EXACT integer texel-fetch index (nearest, no interpolation) — this is a
 * new GPU-only pipeline stage (no
 * existing CPU renderer applies a colormap at this point in the pipeline;
 * `colormaps/apply.ts`'s `applyColormap` operates on already-8-bit,
 * already-tone-mapped diff visualizations, a different use case), so its
 * "source of truth" is this shader + the matching JS reference the test
 * harness computes the SAME way, not an existing CPU renderer.
 *
 * ## Texel fetch, not filtered sampling
 * Both `t_bind0` (source image) and `t_bind1` (LUT) are read via
 * `textureLoad` — see `passthrough.wgsl.ts`'s doc comment for why
 * (`unfilterable-float` sample type avoids the `float32-filterable` feature
 * requirement). The LUT is a NEAREST lookup by design (256 discrete entries,
 * no interpolation), so `textureLoad`'s exact-texel semantics are correct
 * for it, not just convenient.
 */
export const imageWGSL = `
struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let xRaw = f32((vertexIndex << 1u) & 2u);
  let yRaw = f32(vertexIndex & 2u);
  var out: VSOut;
  // Y-flip vs the GLSL sibling shader's v_uv — see module doc comment.
  out.uv = vec2<f32>(xRaw, 1.0 - yRaw);
  out.position = vec4<f32>(xRaw * 2.0 - 1.0, yRaw * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

// Logical binding 0 (texture, source image) -> native binding 0*3+0 = 0.
@group(0) @binding(0) var t_bind0: texture_2d<f32>;
// Logical binding 1 (texture, colormap LUT 256x1) -> native binding 1*3+0 = 3.
@group(0) @binding(3) var t_bind1: texture_2d<f32>;
// Logical binding 2 (uniform vec4: exposureEV, operator, gamma, isScalar) -> native binding 2*3+2 = 8.
@group(0) @binding(8) var<uniform> u_bind2: vec4<f32>;
// Logical binding 3 (uniform vec4: uvRect.x, uvRect.y, uvRect.w, uvRect.h) -> native binding 3*3+2 = 11.
@group(0) @binding(11) var<uniform> u_bind3: vec4<f32>;
// Logical binding 4 (uniform f32: hdrOut) -> native binding 4*3+2 = 14.
@group(0) @binding(14) var<uniform> u_bind4: f32;
// Logical binding 5 (uniform f32: filterMode, 0=nearest/1=linear) -> native binding 5*3+2 = 17.
@group(0) @binding(17) var<uniform> u_bind5: f32;

// --- ported verbatim from image/tonemap.ts ---

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

// Manual bilinear blend of the 4 texels surrounding 'uv' (source-space
// [0,1]) — see module doc comment's "Source filtering" section for why this
// is hand-rolled instead of a real Sampler+textureSample. 'uv' is assumed
// already inside [0,1) (the OOB-transparent check runs before this is
// called); neighbor indices are clamped to the texture's own edge (standard
// filter-kernel clamp-to-edge, NOT the Q18 uvRect-window OOB check above).
fn sampleBilinearF(uv: vec2<f32>, dims: vec2<f32>) -> vec4<f32> {
  let texel = uv * dims - vec2<f32>(0.5);
  let base = floor(texel);
  let frac = texel - base;
  let maxX = i32(dims.x) - 1;
  let maxY = i32(dims.y) - 1;
  let x0 = clamp(i32(base.x), 0, maxX);
  let x1 = clamp(i32(base.x) + 1, 0, maxX);
  let y0 = clamp(i32(base.y), 0, maxY);
  let y1 = clamp(i32(base.y) + 1, 0, maxY);
  let c00 = textureLoad(t_bind0, vec2<i32>(x0, y0), 0);
  let c10 = textureLoad(t_bind0, vec2<i32>(x1, y0), 0);
  let c01 = textureLoad(t_bind0, vec2<i32>(x0, y1), 0);
  let c11 = textureLoad(t_bind0, vec2<i32>(x1, y1), 0);
  let top = mix(c00, c10, frac.x);
  let bot = mix(c01, c11, frac.x);
  return mix(top, bot, frac.y);
}

// operatorId: 0=linear, 1=srgb, 2=reinhard, 3=aces, 4=extended (matches
// TONEMAP_OPERATORS key order in image/tonemap.ts). linear/srgb are the SAME
// clamp — the sRGB OETF lives in outputEncodeF, not here. 4 (extended) is a
// pure identity — no compression, no clamp — deliberately preserving values
// above 1.0 for a real HDR (hdrOut) target; see image/tonemap.ts's doc
// comment on the "extended" entry for why.
fn applyOperator(rgb: vec3<f32>, operatorId: i32) -> vec3<f32> {
  if (operatorId == 2) {
    return vec3<f32>(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z));
  }
  if (operatorId == 3) {
    return vec3<f32>(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z));
  }
  if (operatorId == 4) {
    return rgb;
  }
  // 0 (linear) and 1 (srgb), and any unrecognized id, fall back to the clamp.
  return clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let srcDims = vec2<f32>(textureDimensions(t_bind0));
  let uvRect = u_bind3;
  let uv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(0.999999));
  // Image-space UV, UNCLAMPED — Q18: test this against [0,1) before doing
  // anything else. Zoomed-out (uvRect.zw > 1-uvRect.xy) pushes this outside
  // [0,1] on purpose; that region must render fully transparent, not a
  // clamped-edge smear.
  let rawSrcUV = uvRect.xy + uv * uvRect.zw;
  if (rawSrcUV.x < 0.0 || rawSrcUV.x >= 1.0 || rawSrcUV.y < 0.0 || rawSrcUV.y >= 1.0) {
    return vec4<f32>(0.0);
  }
  let srcUV = clamp(rawSrcUV, vec2<f32>(0.0), vec2<f32>(0.999999));

  let filterLinear = u_bind5 > 0.5;
  var sampled: vec4<f32>;
  if (filterLinear) {
    sampled = sampleBilinearF(srcUV, srcDims);
  } else {
    let coord = vec2<i32>(srcUV * srcDims);
    sampled = textureLoad(t_bind0, coord, 0);
  }

  let exposureEV = u_bind2.x;
  let operatorId = i32(round(u_bind2.y));
  let gamma = u_bind2.z;
  let isScalar = u_bind2.w > 0.5;
  let hdrOut = u_bind4 > 0.5;

  // 1) exposure, in scene-linear space: v * 2^EV.
  var rgb = sampled.rgb * exp2(exposureEV);

  // 2) scalar image + colormap LUT (GPU-only pipeline stage; see module doc).
  if (isScalar) {
    let idxF = clamp(rgb.x, 0.0, 1.0) * 255.0;
    // Deterministic round-half-up (matches CPU Math.round for non-negative
    // inputs) — WGSL's round() is round-half-to-EVEN, which disagrees with
    // Math.round (and with GLSL's implementation-defined round()) exactly at
    // k+0.5 boundaries. See image.glsl.ts for the mirrored fix.
    let idx = clamp(i32(floor(idxF + 0.5)), 0, 255);
    let lutColor = textureLoad(t_bind1, vec2<i32>(idx, 0), 0);
    rgb = lutColor.rgb;
  }

  // 3) tone-map operator: HDR [0,inf) -> display-linear [0,1].
  rgb = applyOperator(rgb, operatorId);

  // 4) output-encode (skipped for an HDR-linear target).
  if (hdrOut) {
    return vec4<f32>(rgb, 1.0);
  }
  let hasGamma = gamma > 0.0;
  return vec4<f32>(
    outputEncodeF(rgb.r, gamma, hasGamma),
    outputEncodeF(rgb.g, gamma, hasGamma),
    outputEncodeF(rgb.b, gamma, hasGamma),
    1.0,
  );
}
`;

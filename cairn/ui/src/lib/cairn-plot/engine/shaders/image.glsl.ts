/**
 * IMAGE render-pass GLSL-ES-3.00 shader pair (WebGL2 backend only — mirrors
 * `image.wgsl.ts` exactly, field-for-field/operator-for-operator). See that
 * file's module doc comment for the full pipeline description, the uniform
 * "block" layout (split across `u_bind2`/`u_bind3`/`u_bind4` — WebGL2 has no
 * native bind groups, so `engine/webgl2/device.ts` maps each binding onto a
 * uniform BY NAME, `u_bindN`/`t_bindN`; see that file's module doc comment),
 * the operator-porting notes, and the colormap-LUT convention. This file
 * only documents GLSL-specific details.
 *
 * ## GLSL source convention
 * One string, split on `#pragma vertex` / `#pragma fragment` (see
 * `passthrough.glsl.ts`'s doc comment for the exact convention). Reuses the
 * SAME fullscreen-triangle vertex stage every GLSL shader in this RHI uses
 * (unflipped `v_uv` — the WGSL sibling flips `uv.y` instead; see
 * `passthrough.wgsl.ts`'s doc comment for why this cancels the WebGPU-vs-
 * WebGL2 readback row-order difference).
 *
 * ## Texel fetch (`texelFetch`), not filtered `texture()`
 * Both `t_bind0` (source image) and `t_bind1` (colormap LUT) are read via
 * `texelFetch` (exact integer-coordinate fetch, no filtering) — matches
 * `image.wgsl.ts`'s `textureLoad` semantics exactly, and needs no
 * `OES_texture_float_linear` extension (WebGL2 core supports texel-fetch
 * sampling of `RGBA32F`/`R32F` textures without it; that extension is only
 * needed for LINEAR filtering).
 *
 * ## Out-of-bounds -> transparent (Q18) / manual bilinear filtering (Q20)
 * See `image.wgsl.ts`'s module doc comment ("Out-of-bounds..." / "Source
 * filtering..." sections) — this file mirrors both fixes exactly:
 * `u_bind5` (filterMode) selects nearest `texelFetch` vs a hand-rolled
 * bilinear blend of 4 `texelFetch` samples (`sampleBilinearF`, avoiding
 * `OES_texture_float_linear` entirely, same reasoning as the texel-fetch
 * note above), and the unclamped image-space UV is tested against `[0,1)`
 * before any sampling, discarding to `vec4(0.0)` outside it. The WebGL2
 * canvas context is already `{alpha:true, premultipliedAlpha:false}`
 * (`engine/webgl2/device.ts`), so this needed no context-config change,
 * unlike the WebGPU surface (`engine/webgpu/surface.ts`, was `alphaMode:
 * 'opaque'`).
 */
export const imageGLSL = `#pragma vertex
#version 300 es
// Fullscreen-triangle vertex shader — see passthrough.glsl.ts's doc comment.
out vec2 v_uv;
void main() {
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
#pragma fragment
#version 300 es
precision highp float;
precision highp int;

// Bind-group convention (see engine/webgl2/device.ts doc comment):
//   - Texture entry at binding=0 -> t_bind0 (source image).
//   - Texture entry at binding=1 -> t_bind1 (256x1 colormap LUT, or a 1x1
//     placeholder when ImageParams.colormap is absent).
//   - {uniform} entry at binding=2 -> u_bind2 (vec4: exposureEV, operator,
//     gamma, isScalar) — see image.wgsl.ts's doc comment for field order.
//   - {uniform} entry at binding=3 -> u_bind3 (vec4: uvRect.x, .y, .w, .h).
//   - {uniform} entry at binding=4 -> u_bind4 (float: hdrOut).
//   - {uniform} entry at binding=5 -> u_bind5 (float: filterMode, 0=nearest/1=linear).
uniform sampler2D t_bind0;
uniform sampler2D t_bind1;
uniform vec4 u_bind2;
uniform vec4 u_bind3;
uniform float u_bind4;
uniform float u_bind5;

in vec2 v_uv;
out vec4 fragColor;

// --- ported verbatim from image/tonemap.ts ---

float srgbOetf(float x) {
  float v = clamp(x, 0.0, 1.0);
  if (v <= 0.0031308) {
    return 12.92 * v;
  }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

float outputEncodeF(float x, float gamma, bool hasGamma) {
  if (hasGamma) {
    return clamp(pow(clamp(x, 0.0, 1.0), 1.0 / gamma), 0.0, 1.0);
  }
  return srgbOetf(x);
}

float reinhardCurve(float x) {
  float v = max(x, 0.0);
  return v / (1.0 + v);
}

float acesCurve(float x) {
  float v = max(x, 0.0);
  float num = v * (2.51 * v + 0.03);
  float den = v * (2.43 * v + 0.59) + 0.14;
  return clamp(num / den, 0.0, 1.0);
}

// Manual bilinear blend of the 4 texels surrounding 'uv' — see
// image.wgsl.ts's sampleBilinearF doc comment (same reasoning: avoids
// OES_texture_float_linear / a real sampler entirely).
vec4 sampleBilinearF(vec2 uv, vec2 dims) {
  vec2 texel = uv * dims - vec2(0.5);
  vec2 base = floor(texel);
  vec2 frac = texel - base;
  int maxX = int(dims.x) - 1;
  int maxY = int(dims.y) - 1;
  int x0 = clamp(int(base.x), 0, maxX);
  int x1 = clamp(int(base.x) + 1, 0, maxX);
  int y0 = clamp(int(base.y), 0, maxY);
  int y1 = clamp(int(base.y) + 1, 0, maxY);
  vec4 c00 = texelFetch(t_bind0, ivec2(x0, y0), 0);
  vec4 c10 = texelFetch(t_bind0, ivec2(x1, y0), 0);
  vec4 c01 = texelFetch(t_bind0, ivec2(x0, y1), 0);
  vec4 c11 = texelFetch(t_bind0, ivec2(x1, y1), 0);
  vec4 top = mix(c00, c10, frac.x);
  vec4 bot = mix(c01, c11, frac.x);
  return mix(top, bot, frac.y);
}

// operatorId: 0=linear, 1=srgb, 2=reinhard, 3=aces, 4=extended — matches
// image.wgsl.ts (4=extended is a pure identity, no clamp — see that file's
// doc comment / image/tonemap.ts's "extended" entry).
vec3 applyOperator(vec3 rgb, int operatorId) {
  if (operatorId == 2) {
    return vec3(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z));
  }
  if (operatorId == 3) {
    return vec3(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z));
  }
  if (operatorId == 4) {
    return rgb;
  }
  return clamp(rgb, 0.0, 1.0);
}

void main() {
  vec2 srcDims = vec2(textureSize(t_bind0, 0));
  vec4 uvRect = u_bind3;
  vec2 uv = clamp(v_uv, 0.0, 0.999999);
  // Image-space UV, UNCLAMPED — Q18 (see image.wgsl.ts's doc comment).
  vec2 rawSrcUV = uvRect.xy + uv * uvRect.zw;
  if (rawSrcUV.x < 0.0 || rawSrcUV.x >= 1.0 || rawSrcUV.y < 0.0 || rawSrcUV.y >= 1.0) {
    fragColor = vec4(0.0);
    return;
  }
  vec2 srcUV = clamp(rawSrcUV, 0.0, 0.999999);

  bool filterLinear = u_bind5 > 0.5;
  vec4 sampled;
  if (filterLinear) {
    sampled = sampleBilinearF(srcUV, srcDims);
  } else {
    ivec2 coord = ivec2(srcUV * srcDims);
    sampled = texelFetch(t_bind0, coord, 0);
  }

  float exposureEV = u_bind2.x;
  int operatorId = int(round(u_bind2.y));
  float gamma = u_bind2.z;
  bool isScalar = u_bind2.w > 0.5;
  bool hdrOut = u_bind4 > 0.5;

  // 1) exposure, in scene-linear space: v * 2^EV.
  vec3 rgb = sampled.rgb * exp2(exposureEV);

  // 2) scalar image + colormap LUT (GPU-only pipeline stage; see image.wgsl.ts doc).
  if (isScalar) {
    float idxF = clamp(rgb.x, 0.0, 1.0) * 255.0;
    // Deterministic round-half-up (matches CPU Math.round for non-negative
    // inputs) — GLSL's round() is implementation-defined at k+0.5 boundaries
    // (and can disagree with both Math.round AND WGSL's round-half-to-EVEN).
    // See image.wgsl.ts for the mirrored fix.
    int idx = clamp(int(floor(idxF + 0.5)), 0, 255);
    vec4 lutColor = texelFetch(t_bind1, ivec2(idx, 0), 0);
    rgb = lutColor.rgb;
  }

  // 3) tone-map operator: HDR [0,inf) -> display-linear [0,1].
  rgb = applyOperator(rgb, operatorId);

  // 4) output-encode (skipped for an HDR-linear target).
  if (hdrOut) {
    fragColor = vec4(rgb, 1.0);
    return;
  }
  bool hasGamma = gamma > 0.0;
  fragColor = vec4(
    outputEncodeF(rgb.r, gamma, hasGamma),
    outputEncodeF(rgb.g, gamma, hasGamma),
    outputEncodeF(rgb.b, gamma, hasGamma),
    1.0
  );
}
`;

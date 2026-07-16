/**
 * Passthrough WGSL shader module (WebGPU backend only — mirrors
 * `passthrough.glsl.ts`'s semantics exactly: samples a texture at logical
 * binding 0 and writes it straight to the render target).
 *
 * ## One WGSL module, two entry points
 * Unlike GLSL (which needs the `#pragma vertex` / `#pragma fragment` split —
 * see `passthrough.glsl.ts`), a single WGSL module can host both an
 * `@vertex` and an `@fragment` entry point. `engine/webgpu/device.ts`
 * compiles `shaderWGSL` as ONE `GPUShaderModule` and looks up `vs_main` /
 * `fs_main` by name.
 *
 * ## Fullscreen triangle + the WebGPU-vs-WebGL2 Y-flip
 * The vertex stage derives a fullscreen triangle from `vertex_index` using
 * the SAME bit-trick as the GLSL vertex stage (0/2 per axis from
 * `vertex_index`), so `position` (NDC) is bit-for-bit identical to the GLSL
 * version's `gl_Position`. The interpolated `uv` passed to the fragment
 * stage is DELIBERATELY vertically flipped relative to GLSL's `v_uv`
 * (`uv.y = 1.0 - yRaw` instead of `uv.y = yRaw`). This is not a stylistic
 * choice — it is required for cross-backend pixel parity:
 *
 *   - WebGL2's `readPixels` returns row 0 = the BOTTOM scanline (GL's
 *     window-coordinate origin is bottom-left), and GL's NDC y=-1 maps to
 *     that bottom scanline. With the GLSL vertex stage's un-flipped
 *     `uv.y = yRaw`, texel row 0 (the first row written by `Texture.write`)
 *     lands at NDC y=-1 → readPixels row 0. I.e. readback row i = texel
 *     row i, no flip (this is the invariant `backend-readback.browser.ts`
 *     already relies on for the WebGL2 case).
 *   - WebGPU's `copyTextureToBuffer` returns row 0 = the TOP scanline
 *     (WebGPU's render-target origin is top-left), and WebGPU's NDC y=+1
 *     maps to that top scanline (the OPPOSITE of WebGL2's y=-1→bottom).
 *     Sampling with the UN-flipped `uv.y = yRaw` would therefore put texel
 *     row 0 at NDC y=-1 → WebGPU buffer row (H-1), i.e. a vertical mirror
 *     of the WebGL2 result for the identical input.
 *   - Flipping ONLY the `uv` fed to the fragment stage (not `position`,
 *     which stays geometry-identical so clipping/rasterization are
 *     unaffected) exactly cancels this difference: texel row 0 ends up at
 *     WebGPU buffer row 0 too, matching WebGL2's readback row order for the
 *     same input texture. This is the invariant the backend-readback
 *     harness checks by comparing WebGPU's output to WebGL2's output
 *     pixel-for-pixel.
 *
 * ## Texel fetch, not filtered sampling
 * The fragment stage uses `textureLoad` (an exact texel fetch by integer
 * coordinate), NOT `textureSample`. This sidesteps a WebGPU-specific
 * constraint that GLSL doesn't have: `rgba32float`/`r32float` textures have
 * sample type `unfilterable-float` unless the device requests the optional
 * `float32-filterable` feature, and `textureSample` requires a *filtering*
 * sampler bound to a *filterable* texture — declaring one here would force
 * every caller (WebGL2 has no such restriction) to request that feature.
 * `textureLoad` needs no sampler at all and always works, and for a
 * `renderFullscreen` fullscreen-triangle draw exactly covering an
 * equal-or-differently-sized target, the nearest-texel semantics it gives
 * are exactly what `passthrough`/`scalebias`'s NEAREST-filtered WebGL2
 * counterparts already compute, so results match.
 *
 * `t_bind0`'s binding NUMBER (`@binding(0)`) is not `0` because it collides
 * with a WGSL "logical binding" — see `engine/webgpu/device.ts`'s doc
 * comment for the `logicalBinding*3 + kindOffset` native-binding scheme
 * that lets ONE `BindGroupEntry[]` (keyed by small integer "logical"
 * bindings, matching the WebGL2 backend's `t_bindN`/`u_bindN` convention)
 * drive both backends. Logical binding 0, kind "texture" (offset 0) ->
 * native binding `0*3+0 = 0`.
 */
export const passthroughWGSL = `
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

// Logical binding 0 (texture) -> native binding 0*3+0 = 0 (see device.ts).
@group(0) @binding(0) var t_bind0: texture_2d<f32>;

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let dims = vec2<f32>(textureDimensions(t_bind0));
  let uv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(0.999999));
  let coord = vec2<i32>(uv * dims);
  return textureLoad(t_bind0, coord, 0);
}
`;

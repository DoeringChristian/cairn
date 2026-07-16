/**
 * `scale*sample+bias` WGSL shader module (WebGPU backend only) — mirrors
 * `scalebias.glsl.ts` exactly. See `passthrough.wgsl.ts`'s module doc
 * comment for the shared fullscreen-triangle vertex stage, the WebGPU-vs-
 * WebGL2 `uv.y` flip (reused verbatim here), and why `textureLoad` (not
 * `textureSample`) is used.
 *
 * Exists solely to exercise the two `webgpu/device.ts` bind-group paths the
 * passthrough shader doesn't touch:
 *   - a `Sampler` bind-group entry at logical binding 0 (paired with the
 *     `Texture` entry at the SAME logical binding). This shader never reads
 *     a WGSL `sampler` binding (it uses `textureLoad`, which needs none) —
 *     `device.ts`'s bind-group builder silently drops any `BindGroupEntry`
 *     whose computed native binding isn't declared by the pipeline's shader
 *     (mirroring the WebGL2 backend's "uniform location doesn't exist ->
 *     skip" superset-bind-group behavior). `createSampler()` and the
 *     `Sampler` resource type are still exercised end-to-end by the test
 *     (created, passed through a bind group) even though THIS shader
 *     doesn't sample through it.
 *   - a `{ uniform: ArrayBufferView }` bind-group entry at logical binding 1
 *     (`u_bind1`, a `vec4<f32>` scale) -> native binding `1*3+2 = 5`.
 *
 * `u_bind2` (bias, logical binding 2 -> native binding `2*3+2 = 8`) is
 * intentionally NOT populated by the test's bind group. Unlike GLSL (which
 * zero-initializes never-`gl.uniform*`-assigned uniforms), WGSL/WebGPU
 * requires EVERY binding a shader's auto-derived bind-group layout declares
 * to have a bound resource, or bind-group creation fails validation. To
 * preserve the WebGL2 backend's "unbound uniform defaults to zero"
 * behavior, `device.ts`'s bind-group builder pre-fills every uniform
 * binding the pipeline declares with a zero-filled `GPUBuffer` (WebGPU
 * buffers are zero-initialized on creation) BEFORE applying the caller's
 * explicit entries — so leaving `u_bind2` out of the bind group doubles as
 * a (documented) exercise of that default-zero fill, exactly like the GLSL
 * sibling test.
 */
export const scaleBiasWGSL = `
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

// Logical binding 0 (texture) -> native binding 0*3+0 = 0.
@group(0) @binding(0) var t_bind0: texture_2d<f32>;
// Logical binding 1 (uniform, scale) -> native binding 1*3+2 = 5.
@group(0) @binding(5) var<uniform> u_bind1: vec4<f32>;
// Logical binding 2 (uniform, bias) -> native binding 2*3+2 = 8. Left
// unbound by the test's bind group; device.ts pre-fills it with a
// zero-filled buffer (see module doc comment).
@group(0) @binding(8) var<uniform> u_bind2: vec4<f32>;

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let dims = vec2<f32>(textureDimensions(t_bind0));
  let uv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(0.999999));
  let coord = vec2<i32>(uv * dims);
  let s = textureLoad(t_bind0, coord, 0);
  return s * u_bind1 + u_bind2;
}
`;

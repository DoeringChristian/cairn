/**
 * `scale*sample+bias` GLSL-ES-3.00 shader pair (WebGL2 backend only).
 *
 * Exists solely to exercise the two `webgl2/device.ts` bind-group paths the
 * passthrough shader doesn't touch:
 *   - a `Sampler` bind-group entry (`gl.bindSampler`) paired with a `Texture`
 *     entry at the SAME binding (binding 0 -> `t_bind0`), and
 *   - a `{ uniform: ArrayBufferView }` bind-group entry (`applyUniformEntry`)
 *     at binding 1 -> `u_bind1`, a `vec4` (Float32Array length 4).
 *
 * See `engine/__tests__/backend-readback.browser.ts` (uniform+sampler test
 * case) for the harness that drives this shader end to end.
 *
 * Reuses the exact fullscreen-triangle vertex stage documented in
 * `passthrough.glsl.ts` — every GLSL shader driven through
 * `Device.renderFullscreen` should reuse it verbatim.
 *
 * `u_bind2` (bias) is intentionally NOT populated by the test's bind group —
 * WebGL2 zero-initializes uniforms that are never `gl.uniform*`-assigned, so
 * leaving it unbound doubles as a (documented) exercise of that default.
 */
export const scaleBiasGLSL = `#pragma vertex
#version 300 es
out vec2 v_uv;
void main() {
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
#pragma fragment
#version 300 es
precision highp float;
// Bind-group convention (see engine/webgl2/device.ts doc comment):
//   - Texture entry at binding=0 -> t_bind0, paired with a Sampler entry at
//     the same binding (gl.bindSampler(0, ...)) that overrides its filtering.
//   - {uniform} entry at binding=1 -> u_bind1 (vec4 scale).
//   - u_bind2 (vec4 bias) is left unbound by the test bind group; GLSL
//     uniforms default to zero, so this doubles as coverage of that default.
uniform sampler2D t_bind0;
uniform vec4 u_bind1;
uniform vec4 u_bind2;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec4 s = texture(t_bind0, v_uv);
  fragColor = s * u_bind1 + u_bind2;
}
`;

/**
 * Passthrough GLSL-ES-3.00 shader pair (WebGL2 backend only — the WGSL
 * equivalent is not needed until Task 3's WebGPU backend). Samples
 * `t_bind0` and writes it straight to the render target. Used by:
 *   - `engine/__tests__/backend-readback.browser.ts` (Task 2 readback test)
 *   - any future backend smoke-test that needs the simplest possible pipeline
 *
 * ## GLSL source convention (`Device.createRenderPipeline({ shaderGLSL })`)
 * `shaderGLSL` is ONE string containing BOTH stages (GLSL can't compile a
 * combined vertex+fragment unit the way a single WGSL module can host both
 * `@vertex`/`@fragment` entry points). The WebGL2 backend
 * (`engine/webgl2/device.ts`) splits it on two marker lines:
 *
 *   #pragma vertex
 *   ...vertex shader source (own `#version 300 es`)...
 *   #pragma fragment
 *   ...fragment shader source (own `#version 300 es`)...
 *
 * Everything before `#pragma vertex` is discarded; everything between the two
 * markers is the vertex stage; everything after `#pragma fragment` is the
 * fragment stage. Each stage must start with its own `#version 300 es` line
 * (GLSL requires `#version` to be the first token of a compilation unit).
 *
 * The vertex stage needs no vertex buffer: it derives a fullscreen-triangle
 * from `gl_VertexID` (3 vertices covering the whole clip-space square) and
 * emits an interpolated `v_uv` spanning exactly [0,1]x[0,1] across the
 * viewport. Every GLSL shader driven through `renderFullscreen` should reuse
 * this exact vertex stage.
 */
export const passthroughGLSL = `#pragma vertex
#version 300 es
// Fullscreen-triangle vertex shader — no vertex buffer / VAO attributes
// needed. 3 vertices generated from gl_VertexID cover clip space; v_uv
// interpolates linearly to [0,1]x[0,1] across the visible (viewport) area.
out vec2 v_uv;
void main() {
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
#pragma fragment
#version 300 es
precision highp float;
// Bind-group convention (see engine/webgl2/device.ts doc comment): a Texture
// bind-group entry at binding=N maps to the sampler uniform t_bindN.
uniform sampler2D t_bind0;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  fragColor = texture(t_bind0, v_uv);
}
`;

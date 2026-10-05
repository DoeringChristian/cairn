// Volume viewer: renders the built-in `volume` kind (cairn.Volume) by WebGL2
// ray marching. Its manifest accepts "volume", so a project that has it shows
// every volume card with it (instead of the "not viewable" placeholder).
//
// A cairn.Volume value arrives as {data: {data: Float32Array, shape: [D, H, W]}}
// and its metadata (shape, spacing, vmin, vmax, ...) as `meta`.
//
// Plain WebGL2, no libraries: one full-screen triangle whose fragment shader
// marches a ray through the volume's box, looking values up in a 3D texture
// and colours in a 1-D transfer function texture.
import { onRender, onResize, onView, setView, snapshot } from "cairn:sdk";
import { colormap } from "./colormaps.js";

const canvas = document.createElement("canvas");
canvas.style.cssText = "width:100%;height:100%;touch-action:none;cursor:grab";
document.body.append(canvas);
const gl = canvas.getContext("webgl2");
if (!gl) throw new Error("this viewer needs WebGL2");

const VERTEX = `#version 300 es
out vec2 ndc;
void main() {
  // One triangle covering the screen.
  ndc = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 ndc;
out vec4 outColor;
uniform sampler3D volume;     // values normalized to [0, 1]
uniform sampler2D transfer;   // 256 x 1 colormap
uniform vec3 eye, right, up, forward;
uniform float tanHalfFov, aspect;
uniform vec3 halfSize;        // the box: [-halfSize, halfSize], physical aspect
uniform float density, threshold;
uniform int steps;
uniform int sliceAxis;        // -1: none; 0/1/2: x/y/z
uniform float slicePos;       // where the cut is, 0..1 along that axis
uniform vec3 background;

void main() {
  vec3 dir = normalize(forward + ndc.x * tanHalfFov * aspect * right + ndc.y * tanHalfFov * up);
  // The box, cut by the slice plane: everything below slicePos on its axis is removed.
  vec3 lo = -halfSize, hi = halfSize;
  if (sliceAxis >= 0) lo[sliceAxis] = mix(-halfSize[sliceAxis], halfSize[sliceAxis], slicePos);
  vec3 t0 = (lo - eye) / dir, t1 = (hi - eye) / dir;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tNear = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  if (tNear >= tFar) { outColor = vec4(background, 1.0); return; }

  vec4 acc = vec4(0.0);
  // A ray entering through the cut face shows the cross-section, opaque.
  vec3 entry = eye + dir * tNear;
  if (sliceAxis >= 0 && abs(entry[sliceAxis] - lo[sliceAxis]) < 1e-4) {
    float v = texture(volume, (entry + halfSize) / (2.0 * halfSize)).r;
    outColor = vec4(texture(transfer, vec2(v, 0.5)).rgb, 1.0);
    return;
  }
  // Front-to-back compositing; stops once (nearly) opaque.
  float dt = 2.0 * length(halfSize) / float(steps);
  for (int i = 0; i < 2048; i++) {
    float t = tNear + (float(i) + 0.5) * dt;
    if (i >= steps || t > tFar || acc.a > 0.99) break;
    float v = texture(volume, (eye + dir * t + halfSize) / (2.0 * halfSize)).r;
    if (v <= threshold) continue;
    float alpha = 1.0 - exp(-density * (v - threshold) * dt);
    acc.rgb += (1.0 - acc.a) * alpha * texture(transfer, vec2(v, 0.5)).rgb;
    acc.a += (1.0 - acc.a) * alpha;
  }
  outColor = vec4(acc.rgb + (1.0 - acc.a) * background, 1.0);
}`;

function compile(type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.useProgram(program);
gl.bindVertexArray(gl.createVertexArray());
const u = (name) => gl.getUniformLocation(program, name);

// Textures: unit 0 the volume, unit 1 the transfer function.
const volumeTex = gl.createTexture();
const transferTex = gl.createTexture();
gl.uniform1i(u("volume"), 0);
gl.uniform1i(u("transfer"), 1);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

function uploadVolume({ data, shape }, meta) {
  const [d, h, w] = shape;
  // Normalize to 8 bits with the logged value range (R8 textures filter linearly everywhere).
  let lo = meta.vmin, hi = meta.vmax;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = Infinity; hi = -Infinity;
    for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  const scale = hi > lo ? 255 / (hi - lo) : 0;
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = (data[i] - lo) * scale;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_3D, volumeTex);
  // C order (D, H, W): x runs along W, y along H, z along D.
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, w, h, d, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
  // The box keeps the physical aspect: extent = size x spacing (spacing is [D, H, W] like shape).
  const [sd, sh, sw] = meta.spacing ?? [1, 1, 1];
  const extent = [w * sw, h * sh, d * sd];
  const longest = Math.max(...extent);
  gl.uniform3fv(u("halfSize"), extent.map((e) => (0.5 * e) / longest));
}

function uploadTransfer(name) {
  const rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = colormap(name, i / 255);
    rgba.set([r * 255, g * 255, b * 255, 255], i * 4);
  }
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, transferTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// The camera orbits the box: yaw/pitch in radians, distance in box units.
const HOME = { yaw: 0.6, pitch: 0.35, dist: 2.2 };
let view = { ...HOME };
let size = { width: 1, height: 1, dpr: 1 };
let hasVolume = false;

function draw() {
  const w = Math.max(1, Math.round(size.width * size.dpr));
  const h = Math.max(1, Math.round(size.height * size.dpr));
  if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
  gl.viewport(0, 0, canvas.width, canvas.height);
  if (!hasVolume) return;
  const { yaw, pitch, dist } = view;
  const eye = [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)];
  const forward = eye.map((c) => -c / dist);
  const r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [
    r[1] * forward[2] - r[2] * forward[1],
    r[2] * forward[0] - r[0] * forward[2],
    r[0] * forward[1] - r[1] * forward[0],
  ];
  gl.uniform3fv(u("eye"), eye);
  gl.uniform3fv(u("forward"), forward);
  gl.uniform3fv(u("right"), r);
  gl.uniform3fv(u("up"), up);
  gl.uniform1f(u("tanHalfFov"), Math.tan((35 * Math.PI) / 360));
  gl.uniform1f(u("aspect"), size.width / Math.max(1, size.height));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

onResize((s) => {
  size = s;
  draw();
});

onRender(({ inputs, settings, size: s, theme }) => {
  const input = inputs[0];
  uploadVolume(input.data.data, input.meta);
  uploadTransfer(settings.colormap);
  gl.uniform1f(u("density"), settings.density);
  gl.uniform1f(u("threshold"), settings.threshold);
  gl.uniform1i(u("steps"), settings.steps);
  gl.uniform1i(u("sliceAxis"), ["x", "y", "z"].indexOf(settings.slice));
  gl.uniform1f(u("slicePos"), settings.slicePos);
  const bg = theme.bg.match(/[0-9a-f]{2}/gi)?.slice(0, 3).map((x) => parseInt(x, 16) / 255) ?? [1, 1, 1];
  gl.uniform3fv(u("background"), bg);
  hasVolume = true;
  size = s;
  draw();
});

// Orbit with the mouse; the view is shared with the card's other panes (setView/onView).
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, start: { ...view } };
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = "grabbing";
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const k = 4 / Math.max(1, size.height);
  view = {
    ...view,
    yaw: drag.start.yaw - (e.clientX - drag.x) * k,
    pitch: Math.max(-1.5, Math.min(1.5, drag.start.pitch + (e.clientY - drag.y) * k)),
  };
  draw();
  setView(view);
});
canvas.addEventListener("pointerup", () => {
  drag = null;
  canvas.style.cursor = "grab";
  setView(view, { final: true });
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  view = { ...view, dist: Math.max(0.8, Math.min(8, view.dist * Math.exp(e.deltaY * 0.001))) };
  draw();
  setView(view);
}, { passive: false });
onView((v) => {
  view = v ? { ...HOME, ...v } : { ...HOME };
  draw();
});

// Paused frames and report exports show this picture.
snapshot(() => {
  draw();
  return canvas.toDataURL("image/png");
});

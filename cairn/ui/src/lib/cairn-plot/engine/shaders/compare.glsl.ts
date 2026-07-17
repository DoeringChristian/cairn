/**
 * COMPARE render-pass GLSL-ES-3.00 shader pair (WebGL2 backend only —
 * mirrors `compare.wgsl.ts` exactly, field-for-field/branch-for-branch). See
 * that file's module doc comment for the full pipeline description (per-side
 * `exposure -> [scalar LUT] -> operator -> encode`, THEN composite by mode),
 * the uniform layout, and the diff-colormap simplification note. This file
 * only documents GLSL-specific details.
 *
 * ## GLSL source convention / texel fetch
 * Same `#pragma vertex` / `#pragma fragment` split and unflipped `v_uv`
 * fullscreen-triangle vertex stage as `image.glsl.ts` (see that file's doc
 * comment), and the same `texelFetch` (not filtered `texture()`) reads for
 * `t_bind0`/`t_bind1`/`t_bind2`.
 *
 * ## Out-of-bounds -> transparent (Q18) / bilinear filtering (Q20)
 * Mirrors `compare.wgsl.ts`'s doc comment exactly — one `rawSrcUV` [0,1)
 * test gates a transparent discard before either side is sampled;
 * `u_bind7` (filterMode) selects nearest `texelFetch` vs a manual bilinear
 * blend (`sampleBilinearOf`) for both `texA`/`texB`.
 */
export const compareGLSL = `#pragma vertex
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
precision highp int;

// Bind-group convention (see engine/webgl2/device.ts doc comment) — matches
// compare.wgsl.ts's logical bindings 0-6 by name.
uniform sampler2D t_bind0; // texA
uniform sampler2D t_bind1; // texB
uniform sampler2D t_bind2; // LUT
uniform vec4 u_bind3; // exposureEV, operatorId, gamma, isScalar
uniform vec4 u_bind4; // uvRect.xy, uvRect.wh
uniform vec4 u_bind5; // modeId, split, alpha, diffSubmodeId
uniform vec4 u_bind6; // diffCmapModeId, hdrOut, useColormap, unused
uniform float u_bind7; // filterMode (0=nearest, 1=linear)

in vec2 v_uv;
out vec4 fragColor;

// --- ported verbatim from image/tonemap.ts (see image.glsl.ts's doc comment) ---

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

vec3 applyOperator(vec3 rgb, int operatorId) {
  if (operatorId == 2) {
    return vec3(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z));
  }
  if (operatorId == 3) {
    return vec3(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z));
  }
  return clamp(rgb, 0.0, 1.0);
}

vec3 sampleLUT(float valueUnit) {
  float idxF = clamp(valueUnit, 0.0, 1.0) * 255.0;
  int idx = clamp(int(floor(idxF + 0.5)), 0, 255);
  return texelFetch(t_bind2, ivec2(idx, 0), 0).rgb;
}

// Manual bilinear blend over EITHER source texture (texA or texB) — see
// compare.wgsl.ts's sampleBilinearOf doc comment.
vec4 sampleBilinearOf(sampler2D tex, vec2 uv, vec2 dims) {
  vec2 texel = uv * dims - vec2(0.5);
  vec2 base = floor(texel);
  vec2 frac = texel - base;
  int maxX = int(dims.x) - 1;
  int maxY = int(dims.y) - 1;
  int x0 = clamp(int(base.x), 0, maxX);
  int x1 = clamp(int(base.x) + 1, 0, maxX);
  int y0 = clamp(int(base.y), 0, maxY);
  int y1 = clamp(int(base.y) + 1, 0, maxY);
  vec4 c00 = texelFetch(tex, ivec2(x0, y0), 0);
  vec4 c10 = texelFetch(tex, ivec2(x1, y0), 0);
  vec4 c01 = texelFetch(tex, ivec2(x0, y1), 0);
  vec4 c11 = texelFetch(tex, ivec2(x1, y1), 0);
  vec4 top = mix(c00, c10, frac.x);
  vec4 bot = mix(c01, c11, frac.x);
  return mix(top, bot, frac.y);
}

vec3 processSide(vec4 sampled, float exposureEV, int operatorId, float gamma, bool isScalar, bool hdrOut) {
  vec3 rgb = sampled.rgb * exp2(exposureEV);
  if (isScalar) {
    rgb = sampleLUT(rgb.x);
  }
  rgb = applyOperator(rgb, operatorId);
  if (hdrOut) {
    return rgb;
  }
  bool hasGamma = gamma > 0.0;
  return vec3(
    outputEncodeF(rgb.r, gamma, hasGamma),
    outputEncodeF(rgb.g, gamma, hasGamma),
    outputEncodeF(rgb.b, gamma, hasGamma)
  );
}

// Ported verbatim from image/webgl-diff.ts's computeDiffChannel.
float diffChannel(float a, float b, int mode) {
  float diff = a - b;
  float absDiff = abs(diff);
  float denom = max(a, 1.0 / 255.0);
  if (mode == 0) return (diff + 1.0) / 2.0;
  if (mode == 1) return absDiff;
  if (mode == 2) return diff * diff;
  if (mode == 3) return (diff / denom + 1.0) / 2.0;
  if (mode == 4) return absDiff / denom;
  if (mode == 5) return (diff * diff) / (denom * denom);
  return absDiff;
}

void main() {
  vec2 uv = clamp(v_uv, 0.0, 0.999999);
  vec4 uvRect = u_bind4;
  // Image-space UV, UNCLAMPED — Q18 (see compare.wgsl.ts's doc comment).
  vec2 rawSrcUV = uvRect.xy + uv * uvRect.zw;
  if (rawSrcUV.x < 0.0 || rawSrcUV.x >= 1.0 || rawSrcUV.y < 0.0 || rawSrcUV.y >= 1.0) {
    fragColor = vec4(0.0);
    return;
  }
  vec2 srcUV = clamp(rawSrcUV, 0.0, 0.999999);
  bool filterLinear = u_bind7 > 0.5;

  vec2 dimsA = vec2(textureSize(t_bind0, 0));
  vec4 sampledA;
  if (filterLinear) {
    sampledA = sampleBilinearOf(t_bind0, srcUV, dimsA);
  } else {
    sampledA = texelFetch(t_bind0, ivec2(srcUV * dimsA), 0);
  }

  vec2 dimsB = vec2(textureSize(t_bind1, 0));
  vec4 sampledB;
  if (filterLinear) {
    sampledB = sampleBilinearOf(t_bind1, srcUV, dimsB);
  } else {
    sampledB = texelFetch(t_bind1, ivec2(srcUV * dimsB), 0);
  }

  float exposureEV = u_bind3.x;
  int operatorId = int(round(u_bind3.y));
  float gamma = u_bind3.z;
  bool isScalar = u_bind3.w > 0.5;
  bool hdrOut = u_bind6.y > 0.5;

  vec3 colorA = processSide(sampledA, exposureEV, operatorId, gamma, isScalar, hdrOut);
  vec3 colorB = processSide(sampledB, exposureEV, operatorId, gamma, isScalar, hdrOut);

  int modeId = int(round(u_bind5.x));
  float split = u_bind5.y;
  float alpha = u_bind5.z;
  int diffSubmodeId = int(round(u_bind5.w));
  int diffCmapModeId = int(round(u_bind6.x));
  bool useColormap = u_bind6.z > 0.5;

  vec3 outColor;
  if (modeId == 1) {
    outColor = mix(colorA, colorB, alpha);
  } else if (modeId == 2) {
    float dr = diffChannel(colorA.r, colorB.r, diffSubmodeId);
    float dg = diffChannel(colorA.g, colorB.g, diffSubmodeId);
    float db = diffChannel(colorA.b, colorB.b, diffSubmodeId);
    vec3 diffRGB = clamp(vec3(dr, dg, db), 0.0, 1.0);
    if (useColormap) {
      float avg = (diffRGB.r + diffRGB.g + diffRGB.b) / 3.0;
      float idx = avg;
      if (diffCmapModeId == 2) {
        idx = 0.5 + avg * 0.5;
      }
      outColor = sampleLUT(idx);
    } else {
      outColor = diffRGB;
    }
  } else {
    outColor = uv.x < split ? colorA : colorB;
  }

  fragColor = vec4(outColor, 1.0);
}
`;

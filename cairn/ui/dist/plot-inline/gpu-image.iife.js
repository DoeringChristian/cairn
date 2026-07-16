var Er=Object.defineProperty;var _r=(P,l,fe)=>l in P?Er(P,l,{enumerable:!0,configurable:!0,writable:!0,value:fe}):P[l]=fe;var M=(P,l,fe)=>_r(P,typeof l!="symbol"?l+"":l,fe);(function(P,l){"use strict";function fe(e,t){switch(t){case"rgba8unorm":return{internalFormat:e.RGBA8,format:e.RGBA,type:e.UNSIGNED_BYTE};case"rgba16float":return{internalFormat:e.RGBA16F,format:e.RGBA,type:e.HALF_FLOAT};case"rgba32float":return{internalFormat:e.RGBA32F,format:e.RGBA,type:e.FLOAT};case"r32float":return{internalFormat:e.R32F,format:e.RED,type:e.FLOAT};default:{const r=t;throw new Error(`webgl2 device: unknown TextureFormat ${String(r)}`)}}}function it(e){return e==="rgba16float"||e==="rgba32float"||e==="r32float"}function at(e){const t="#pragma vertex",r="#pragma fragment",n=e.indexOf(t),o=e.indexOf(r);if(n===-1||o===-1||o<n)throw new Error("webgl2 device: shaderGLSL must contain '#pragma vertex' followed by '#pragma fragment' (see engine/shaders/passthrough.glsl.ts)");const a=e.slice(n+t.length,o).trim(),v=e.slice(o+r.length).trim();return{vertex:a,fragment:v}}function Te(e,t,r){const n=e.createShader(t);if(!n)throw new Error("webgl2 device: gl.createShader failed");if(e.shaderSource(n,r),e.compileShader(n),!e.getShaderParameter(n,e.COMPILE_STATUS)){const o=e.getShaderInfoLog(n);e.deleteShader(n);const a=t===e.VERTEX_SHADER?"vertex":"fragment";throw new Error(`webgl2 device: ${a} shader compile failed: ${o}
---source---
${r}`)}return n}function st(e,t,r){const n=Te(e,e.VERTEX_SHADER,t),o=Te(e,e.FRAGMENT_SHADER,r),a=e.createProgram();if(!a)throw new Error("webgl2 device: gl.createProgram failed");if(e.attachShader(a,n),e.attachShader(a,o),e.linkProgram(a),e.deleteShader(n),e.deleteShader(o),!e.getProgramParameter(a,e.LINK_STATUS)){const v=e.getProgramInfoLog(a);throw e.deleteProgram(a),new Error(`webgl2 device: program link failed: ${v}`)}return a}function ct(){const e=document.createElement("canvas");e.width=1,e.height=1;const t=e.getContext("webgl2");if(!t)throw new Error("webgl2 device: WebGL2 is not supported in this browser");const r=!!t.getExtension("EXT_color_buffer_float"),n=t.getExtension("WEBGL_lose_context");return n==null||n.loseContext(),{hdr:!1,compute:!1,float16:r}}class Ce{constructor(t,r,n,o){M(this,"width");M(this,"height");M(this,"format");M(this,"glTexture");M(this,"gl");M(this,"info");M(this,"destroyed",!1);this.gl=t,this.width=r,this.height=n,this.format=o,this.info=fe(t,o);const a=t.createTexture();if(!a)throw new Error("webgl2 device: gl.createTexture failed");this.glTexture=a,t.bindTexture(t.TEXTURE_2D,a),t.texImage2D(t.TEXTURE_2D,0,this.info.internalFormat,r,n,0,this.info.format,this.info.type,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.bindTexture(t.TEXTURE_2D,null)}write(t){if(this.destroyed)throw new Error("webgl2 device: write() on a destroyed texture");const r=this.gl;r.bindTexture(r.TEXTURE_2D,this.glTexture),r.pixelStorei(r.UNPACK_ALIGNMENT,1),r.texSubImage2D(r.TEXTURE_2D,0,0,0,this.width,this.height,this.info.format,this.info.type,t),r.bindTexture(r.TEXTURE_2D,null)}destroy(){this.destroyed||(this.gl.deleteTexture(this.glTexture),this.destroyed=!0)}}class Pe{constructor(t,r){M(this,"_s");M(this,"glSampler");const n=t.createSampler();if(!n)throw new Error("webgl2 device: gl.createSampler failed");this.glSampler=n;const o=(r==null?void 0:r.filter)==="nearest"?t.NEAREST:t.LINEAR;t.samplerParameteri(n,t.TEXTURE_MIN_FILTER,o),t.samplerParameteri(n,t.TEXTURE_MAG_FILTER,o),t.samplerParameteri(n,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.samplerParameteri(n,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this._s=n}}class ut{constructor(t,r){M(this,"_p");M(this,"program");M(this,"targetFormat");this.program=t,this.targetFormat=r,this._p=t}}class dt{constructor(t){M(this,"_b");M(this,"entries");this.entries=t,this._b=t}destroy(){}}class lt{constructor(t){M(this,"canvas");M(this,"hdr",!1);this.canvas=t}configure(t,r){this.canvas.width=t,this.canvas.height=r}getCurrentTextureView(){return null}}function ft(e,t,r,n){const o=e.getUniformLocation(t,`u_bind${r}`);if(!o)return;if(n instanceof Int32Array)switch(n.length){case 1:e.uniform1iv(o,n);return;case 2:e.uniform2iv(o,n);return;case 3:e.uniform3iv(o,n);return;case 4:e.uniform4iv(o,n);return;default:e.uniform1iv(o,n);return}const a=n instanceof Float32Array?n:new Float32Array(n.buffer,n.byteOffset,n.byteLength/4);switch(a.length){case 1:e.uniform1fv(o,a);return;case 2:e.uniform2fv(o,a);return;case 3:e.uniform3fv(o,a);return;case 4:e.uniform4fv(o,a);return;case 16:e.uniformMatrix4fv(o,!1,a);return;default:e.uniform1fv(o,a);return}}const Ae=new WeakSet;function mt(e){Ae.has(e)||(Ae.add(e),e.addEventListener("webglcontextlost",t=>{t.preventDefault()},!1))}function ve(){let e=null,t=null,r=null,n=null;const o=ct();function a(c){r=c.createFramebuffer(),n=c.createVertexArray(),c.getExtension("OES_texture_float_linear"),c.getExtension("EXT_color_buffer_float")}function v(c,h){if(e=c,t=h,mt(h),!c.isContextLost()){a(c);return}r=null,n=null;const b=()=>{h.removeEventListener("webglcontextrestored",b),e===c&&a(c)};h.addEventListener("webglcontextrestored",b,!1)}function f(){if(e)return e;const c=document.createElement("canvas");c.width=1,c.height=1;const h=c.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!h)throw new Error("webgl2 device: WebGL2 is not supported in this browser");return v(h,c),h}function y(c,h){if("canvas"in h)return c.bindFramebuffer(c.FRAMEBUFFER,null),{width:h.canvas.width,height:h.canvas.height,isFloat:!1};const b=h;c.bindFramebuffer(c.FRAMEBUFFER,r),c.framebufferTexture2D(c.FRAMEBUFFER,c.COLOR_ATTACHMENT0,c.TEXTURE_2D,b.glTexture,0);const i=c.checkFramebufferStatus(c.FRAMEBUFFER);if(i!==c.FRAMEBUFFER_COMPLETE)throw new Error(`webgl2 device: framebuffer incomplete for target texture (format=${b.format}, status=0x${i.toString(16)}). Float formats need EXT_color_buffer_float as a render target (capabilities.float16=${o.float16}).`);return{width:b.width,height:b.height,isFloat:it(b.format)}}return{backend:"webgl2",capabilities:o,createTexture(c,h,b){const i=f();return new Ce(i,c,h,b)},createSampler(c){const h=f();return new Pe(h,c)},createRenderPipeline(c){const h=f(),{vertex:b,fragment:i}=at(c.shaderGLSL),S=st(h,b,i);return new ut(S,c.targetFormat)},createComputePipeline:void 0,createBindGroup(c,h){return new dt(h)},createSurface(c,h){var b;if(e&&t&&t!==c)throw new Error("webgl2 device: this device already owns a WebGL2 context bound to a different canvas. WebGL2 has no cross-canvas resource sharing — create one createWebGL2Device() per on-screen canvas (see engine/pool.ts).");if(!e){const i=c.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!i)throw new Error("webgl2 device: WebGL2 is not supported on the given canvas");i.isContextLost()&&((b=i.getExtension("WEBGL_lose_context"))==null||b.restoreContext()),v(i,c)}if("drawingBufferColorSpace"in e)try{e.drawingBufferColorSpace="display-p3"}catch{}return new lt(c)},renderFullscreen(c,h,b){const i=f(),S=h,s=b,{width:u,height:m}=y(i,c);i.viewport(0,0,u,m),i.disable(i.DEPTH_TEST),i.disable(i.BLEND),i.disable(i.CULL_FACE),i.useProgram(S.program),i.bindVertexArray(n);for(const p of s.entries){const g=p.resource;if(g instanceof Ce){i.activeTexture(i.TEXTURE0+p.binding),i.bindTexture(i.TEXTURE_2D,g.glTexture);const w=i.getUniformLocation(S.program,`t_bind${p.binding}`);w&&i.uniform1i(w,p.binding)}else g instanceof Pe?i.bindSampler(p.binding,g.glSampler):ft(i,S.program,p.binding,g.uniform)}i.drawArrays(i.TRIANGLES,0,3),i.bindVertexArray(null),i.bindFramebuffer(i.FRAMEBUFFER,null)},async readback(c){const h=f(),{width:b,height:i,isFloat:S}=y(h,c);if(S){const u=new Float32Array(b*i*4);return h.readPixels(0,0,b,i,h.RGBA,h.FLOAT,u),h.bindFramebuffer(h.FRAMEBUFFER,null),u}const s=new Uint8Array(b*i*4);return h.readPixels(0,0,b,i,h.RGBA,h.UNSIGNED_BYTE,s),h.bindFramebuffer(h.FRAMEBUFFER,null),s},destroy(){if(!e)return;r&&e.deleteFramebuffer(r),n&&e.deleteVertexArray(n);const c=e.getExtension("WEBGL_lose_context");c==null||c.loseContext(),e=null,t=null,r=null,n=null},isContextLost(){return e?e.isContextLost():!1}}}const xe=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function Me(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"opaque",usage:xe}),{hdr:!1,format:r}}function pt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"opaque",usage:xe}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"opaque",usage:xe}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return Me(e,t)}}}const gt=`
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
`;function we(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Ge(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function ht(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let o;return r===0?o=n/1024*Math.pow(2,-14):r===31?o=n?NaN:1/0:o=(1+n/1024)*Math.pow(2,r-15),t?-o:o}const bt={texture:0,sampler:1,uniform:2};function Ee(e,t){return e*3+bt[t]}const vt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function xt(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const o=Number(n[1]),a=n[2]!==void 0,v=n[3].trim();if(a){const f=vt[v];if(f===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${v}" (binding ${o}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(o,{kind:"uniform",sizeBytes:f})}else v==="sampler"||v==="sampler_comparison"?t.set(o,{kind:"sampler"}):t.set(o,{kind:"texture"})}return t}class Ie{constructor(t,r,n,o){M(this,"width");M(this,"height");M(this,"format");M(this,"gpuTexture");M(this,"device");M(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=o,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:we(o),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*Ge(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class Le{constructor(t){M(this,"_s");M(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class wt{constructor(t,r,n,o,a){M(this,"_p");M(this,"gpuPipeline");M(this,"bindings");M(this,"bindGroupLayout");M(this,"variants");M(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=a,this.variants=new Map([[o,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function Et(e,t){const r=[];for(const[n,o]of t)o.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):o.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class _t{constructor(t){M(this,"_c");M(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class yt{constructor(t,r){M(this,"_b");M(this,"gpuBindGroup");M(this,"ownedBuffers");M(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class St{constructor(t,r,n,o){M(this,"canvas");M(this,"hdr");M(this,"format");M(this,"context");M(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=o}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function me(e){return"canvas"in e}async function Rt(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function o(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function a(i){return me(i)?i.getCurrentTextureView():i.gpuTexture.createView()}function v(i){if(me(i))return{width:i.canvas.width,height:i.canvas.height};const S=i;return{width:S.width,height:S.height}}let f=!1;const y=256;let d=null,c=null;function h(){if(!d||!c){const i=t.createShaderModule({code:gt});c=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const S=t.createPipelineLayout({bindGroupLayouts:[c]});d=t.createComputePipeline({layout:S,compute:{module:i,entryPoint:"cs_main"}})}return{pipeline:d,layout:c}}return{backend:"webgpu",capabilities:r,createTexture(i,S,s){return new Ie(t,i,S,s)},createSampler(i){const S=(i==null?void 0:i.filter)==="linear"?"linear":"nearest",s=t.createSampler({magFilter:S,minFilter:S,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new Le(s)},createRenderPipeline(i){const S=t.createShaderModule({code:i.shaderWGSL}),s=xt(i.shaderWGSL),u=we(i.targetFormat),m=Et(t,s),p=t.createPipelineLayout({bindGroupLayouts:[m]}),g=R=>t.createRenderPipeline({layout:p,vertex:{module:S,entryPoint:"vs_main"},fragment:{module:S,entryPoint:"fs_main",targets:[{format:R}]},primitive:{topology:"triangle-list"}}),w=g(u);return new wt(w,s,m,u,g)},createComputePipeline(i){const S=t.createShaderModule({code:i.shaderWGSL}),s=t.createComputePipeline({layout:"auto",compute:{module:S,entryPoint:"cs_main"}});return new _t(s)},createBindGroup(i,S){const s=i,u=new Map,m=[];for(const[g,w]of s.bindings)if(w.kind==="uniform"){const R=t.createBuffer({size:w.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});m.push(R),u.set(g,{binding:g,resource:{buffer:R}})}else w.kind==="sampler"&&u.set(g,{binding:g,resource:o()});for(const g of S){const w=g.resource;if(w instanceof Ie){const R=Ee(g.binding,"texture");s.bindings.has(R)&&u.set(R,{binding:R,resource:w.gpuTexture.createView()})}else if(w instanceof Le){const R=Ee(g.binding,"sampler");s.bindings.has(R)&&u.set(R,{binding:R,resource:w.gpuSampler})}else{const R=Ee(g.binding,"uniform"),O=s.bindings.get(R);if(O&&O.kind==="uniform"){const F=w.uniform,U=t.createBuffer({size:Math.max(O.sizeBytes,F.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(U,0,F.buffer,F.byteOffset,F.byteLength),m.push(U),u.set(R,{binding:R,resource:{buffer:U}})}}}const p=t.createBindGroup({layout:s.bindGroupLayout,entries:Array.from(u.values())});return new yt(p,m)},createSurface(i,S){const s=i.getContext("webgpu");if(!s)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const u=S.hdr&&r.hdr,m=()=>u?pt(s,t):Me(s,t),p=m();return new St(i,s,p,m)},renderFullscreen(i,S,s){const u=S,m=s,p=a(i),{width:g,height:w}=v(i),R=me(i)?i.format:we(i.format),O=u.pipelineFor(R),F=t.createCommandEncoder(),U=F.beginRenderPass({colorAttachments:[{view:p,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});U.setPipeline(O),U.setBindGroup(0,m.gpuBindGroup),U.setViewport(0,0,g,w,0,1),U.draw(3),U.end(),t.queue.submit([F.finish()])},async readback(i){const S=me(i),{width:s,height:u}=v(i),m=S?i.hdr?"rgba16float":"rgba8unorm":i.format,p=S&&i.format==="bgra8unorm",g=S?i.getCurrentGPUTexture():i.gpuTexture,w=Ge(m),R=s*w,O=256,F=Math.ceil(R/O)*O,U=F*u,B=t.createBuffer({size:U,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),k=t.createCommandEncoder();k.copyTextureToBuffer({texture:g},{buffer:B,bytesPerRow:F,rowsPerImage:u},{width:s,height:u,depthOrArrayLayers:1}),t.queue.submit([k.finish()]),await B.mapAsync(GPUMapMode.READ);const G=new Uint8Array(B.getMappedRange()),D=new Uint8Array(R*u);for(let I=0;I<u;I++){const X=I*F,N=I*R;D.set(G.subarray(X,X+R),N)}if(B.unmap(),B.destroy(),m==="rgba8unorm"){if(p)for(let I=0;I<D.length;I+=4){const X=D[I],N=D[I+2];D[I]=N,D[I+2]=X}return D}if(m==="rgba16float"){const I=new Uint16Array(D.buffer,D.byteOffset,D.byteLength/2),X=new Float32Array(I.length);for(let N=0;N<I.length;N++)X[N]=ht(I[N]);return X}return new Float32Array(D.buffer,D.byteOffset,D.byteLength/4)},async reduceDiffSumSquaredAbs(i,S,s,u){const m=i,p=S,g=Math.max(0,s*u),w=Math.max(1,Math.ceil(g/y)),{pipeline:R,layout:O}=h(),F=w*2*4,U=t.createBuffer({size:F,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),B=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(B,0,new Uint32Array([Math.max(1,s),Math.max(1,u),g,0]));const k=t.createBindGroup({layout:O,entries:[{binding:0,resource:m.gpuTexture.createView()},{binding:1,resource:p.gpuTexture.createView()},{binding:2,resource:{buffer:U}},{binding:3,resource:{buffer:B}}]}),G=t.createBuffer({size:F,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),D=t.createCommandEncoder(),I=D.beginComputePass();I.setPipeline(R),I.setBindGroup(0,k),I.dispatchWorkgroups(w),I.end(),D.copyBufferToBuffer(U,0,G,0,F),t.queue.submit([D.finish()]),await G.mapAsync(GPUMapMode.READ);const N=new Float32Array(G.getMappedRange()).slice();G.unmap(),G.destroy(),U.destroy(),B.destroy();let q=0,J=0;for(let Y=0;Y<w;Y++)q+=N[Y*2],J+=N[Y*2+1];return{sumSq:q,sumAbs:J}},destroy(){f||(t.destroy(),f=!0)},isContextLost(){return!1}}}let _e=null;function Tt(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceWebGL2")}catch{return!1}}async function Ct(e){if(!e&&typeof navigator<"u"&&"gpu"in navigator&&!!navigator.gpu)try{return await Rt()}catch{}return ve()}function pe(e){if(!_e){const t=Tt();_e=Ct(t)}return _e}function Pt(e,t,r){return[e[0]+(t[0]-e[0])*r,e[1]+(t[1]-e[1])*r,e[2]+(t[2]-e[2])*r]}function At(e){const t=new Uint8Array(768);for(let r=0;r<256;r++){const o=r/255*(e.length-1),a=Math.floor(o),v=Math.min(a+1,e.length-1),f=o-a,[y,d,c]=Pt(e[a],e[v],f);t[r*3]=Math.round(y),t[r*3+1]=Math.round(d),t[r*3+2]=Math.round(c)}return t}const Ue={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},Mt=new Set(["red-green","red-blue"]),Fe=new Map;function De(e){let t=Fe.get(e);if(!t){const r=Ue[e]??Ue.viridis;t=At(r),Fe.set(e,t)}return t}function Gt(e,t,r="linear"){const n=De(t),o=new ImageData(e.width,e.height),a=e.data,v=o.data;for(let f=0;f<a.length;f+=4){const y=(a[f]+a[f+1]+a[f+2])/3;let d;r==="positive"?d=Math.round(128+y/255*127):d=Math.round(y),d=Math.max(0,Math.min(255,d)),v[f]=n[d*3],v[f+1]=n[d*3+1],v[f+2]=n[d*3+2],v[f+3]=a[f+3]}return o}function Oe(e){const t=new Map;return{get(r){return t.get(r)},set(r,n){if(t.size>=e){const o=t.keys().next().value;o!==void 0&&t.delete(o)}t.set(r,n)}}}const Be=Oe(50);function It(e){return Be.get(e)}function Lt(e,t){Be.set(e,t)}const ke=Oe(100);function Ut(e){return ke.get(e)}function Ft(e,t){ke.set(e,t)}async function Ne(e){const t=Ut(e);return t||new Promise(r=>{const n=new Image;n.onload=()=>{try{const o=document.createElement("canvas");o.width=n.naturalWidth,o.height=n.naturalHeight;const a=o.getContext("2d");if(!a){r(null);return}a.drawImage(n,0,0);const v=a.getImageData(0,0,o.width,o.height);Ft(e,v),r(v)}catch(o){console.warn("[cairn] loadImageData failed:",o),r(null)}},n.onerror=o=>{console.warn("[cairn] loadImageData: image failed to load:",e,o),r(null)},n.src=e})}function Ve(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Dt({naturalWidth:e,naturalHeight:t,zoom:r=1,containerRef:n}){const o=Ve(e),a=Ve(t),v=[];for(let p=0;p<=e;p+=o)v.push(p);const f=[];for(let p=0;p<=t;p+=a)f.push(p);const y=1/r,d=8*y,c=-12*y,h=-2*y,b=n==null?void 0:n.current;let i=0,S=0,s=0,u=0;if(b){const p=b.clientWidth,g=b.clientHeight,w=p/e,R=g/t,O=Math.min(w,R);s=e*O,u=t*O,i=(p-s)/2,S=(g-u)/2}const m=b&&s>0;return P.jsxs(P.Fragment,{children:[P.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:m?S:0,transform:`translateY(${c}px)`,fontSize:d},children:v.map(p=>P.jsx("span",{className:"mono",style:{position:"absolute",left:m?i+p/e*s:`${p/e*100}%`,transform:"translateX(-50%)"},children:p},p))}),P.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:m?i:0,transform:`translateX(${h}px)`,fontSize:d},children:f.map(p=>P.jsx("span",{className:"mono",style:{position:"absolute",top:m?S+p/t*u:`${p/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*y}px`},children:p},p))})]})}function Ot({label:e,isDraggable:t,onDragStart:r}){return P.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:r,style:{cursor:t?"grab":void 0},children:[t&&P.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const ze=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function ye(e){const t=ze.length;return ze[(e%t+t)%t]}function Bt(e){const r=l.useRef(null),[n,o]=l.useState({w:0,h:0}),a=l.useRef(null),v=l.useRef(null);return l.useEffect(()=>{var d;const f=r.current;if(f===v.current||((d=a.current)==null||d.disconnect(),a.current=null,v.current=f,!f))return;const y=new ResizeObserver(c=>{for(const h of c)o({w:h.contentRect.width,h:h.contentRect.height})});a.current=y,y.observe(f)}),l.useEffect(()=>()=>{var f;return(f=a.current)==null?void 0:f.disconnect()},[]),{ref:r,size:n}}function kt(){const[e,t]=l.useState(!1);return l.useEffect(()=>{const r=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!0)},n=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!1)},o=()=>t(!1);return window.addEventListener("keydown",r),window.addEventListener("keyup",n),window.addEventListener("blur",o),()=>{window.removeEventListener("keydown",r),window.removeEventListener("keyup",n),window.removeEventListener("blur",o)}},[]),e}const Nt=.25,Vt=16;function Xe(e){const{containerRef:t,zoom:r,pan:n,onViewportChange:o,minZoom:a=Nt,maxZoom:v=Vt}=e,f=kt(),y=l.useRef(f);y.current=f;const d=l.useRef({zoom:r,pan:n});d.current={zoom:r,pan:n};const c=l.useRef(o);c.current=o,l.useEffect(()=>{const u=t.current;if(!u||!o)return;const m=p=>{var G;if(!y.current)return;p.preventDefault(),p.stopPropagation();const g=p.deltaY<0?1.1:1/1.1,w=d.current,R=Math.max(a,Math.min(v,w.zoom*g));if(w.zoom===R)return;const O=u.getBoundingClientRect(),F=p.clientX-O.left,U=p.clientY-O.top,B=F-(F-w.pan.x)/w.zoom*R,k=U-(U-w.pan.y)/w.zoom*R;(G=c.current)==null||G.call(c,{zoom:R,pan:{x:B,y:k}})};return u.addEventListener("wheel",m,{passive:!1}),()=>u.removeEventListener("wheel",m)},[t,!!o,a,v]);const h=l.useRef(null),b=l.useCallback(u=>{!y.current||!c.current||(u.currentTarget.setPointerCapture(u.pointerId),h.current={pointerId:u.pointerId,startX:u.clientX,startY:u.clientY,panX:d.current.pan.x,panY:d.current.pan.y})},[]),i=l.useCallback(u=>{var w;const m=h.current;if(!m||m.pointerId!==u.pointerId)return;const p=u.clientX-m.startX,g=u.clientY-m.startY;(w=c.current)==null||w.call(c,{zoom:d.current.zoom,pan:{x:m.panX+p,y:m.panY+g}})},[]),S=l.useCallback(u=>{const m=h.current;if(!(!m||m.pointerId!==u.pointerId)){try{u.currentTarget.releasePointerCapture(u.pointerId)}catch{}h.current=null}},[]),s=f&&!!o;return{containerProps:{onPointerDown:b,onPointerMove:i,onPointerUp:S,onPointerCancel:S,style:{cursor:s?"move":void 0,touchAction:s?"none":void 0}},modifierActive:f}}function zt(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function We(e,t,r){return!(r.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function Xt({data:e,settings:t,naturalWidth:r,naturalHeight:n}){const{ref:o,size:a}=Bt(),v=l.useRef(null),f=l.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),y=l.useMemo(()=>{const s=a.w,u=a.h;if(s<=0||u<=0||r<=0||n<=0)return null;const m=Math.min(s/r,u/n),p=r*m,g=n*m;return{left:(s-p)/2,top:(u-g)/2,width:p,height:g}},[a.w,a.h,r,n]),d=e.masks,c=t.showMasks&&!!d&&d.length>0,h=l.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(l.useEffect(()=>{if(!c||!d)return;const s=v.current;if(!s)return;(s.width!==r||s.height!==n)&&(s.width=r,s.height=n);const u=s.getContext("2d");if(!u)return;u.clearRect(0,0,s.width,s.height);let m=!1;const p=u.createImageData(r,n),g=p.data;let w=d.length,R=!1;const O=()=>{m||R&&u.putImageData(p,0,0)},F=document.createElement("canvas");F.width=r,F.height=n;const U=F.getContext("2d",{willReadFrequently:!0});for(const B of d){const k=new Image;k.onload=()=>{if(!m){if(U){U.clearRect(0,0,r,n),U.drawImage(k,0,0,r,n);const G=U.getImageData(0,0,r,n).data;for(let D=0;D<r*n;D++){const I=G[D*4];if(I===0||f.has(I))continue;const[X,N,q]=zt(ye(I));g[D*4]=X,g[D*4+1]=N,g[D*4+2]=q,g[D*4+3]=255,R=!0}}w-=1,w===0&&O()}},k.onerror=()=>{w-=1,w===0&&O()},k.src=`data:image/png;base64,${B.png_b64}`}return()=>{m=!0}},[c,d,r,n,h]),!y)return P.jsx("div",{ref:o,className:"absolute inset-0 pointer-events-none"});const b=e.boxes??[],i=t.showBoxes&&b.length>0,S=e.class_labels??{};return P.jsxs("div",{ref:o,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[c&&P.jsx("canvas",{ref:v,className:"absolute",style:{left:y.left,top:y.top,width:y.width,height:y.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),i&&P.jsx("svg",{className:"absolute",style:{left:y.left,top:y.top,width:y.width,height:y.height,overflow:"visible"},viewBox:`0 0 ${r} ${n}`,preserveAspectRatio:"none",children:b.map((s,u)=>{if(!We(s,t,f))return null;const m=s.domain==="pixel"?1:r,p=s.domain==="pixel"?1:n,g=s.position.minX*m,w=s.position.minY*p,R=(s.position.maxX-s.position.minX)*m,O=(s.position.maxY-s.position.minY)*p;return P.jsx("rect",{x:g,y:w,width:R,height:O,fill:"none",stroke:ye(s.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},u)})}),i&&P.jsx("div",{className:"absolute",style:{left:y.left,top:y.top,width:y.width,height:y.height},children:b.map((s,u)=>{if(!We(s,t,f))return null;const m=s.domain==="pixel"?1/r:1,p=s.domain==="pixel"?1/n:1,g=s.position.minX*m*100,w=s.position.minY*p*100,R=s.label??S[String(s.class_id)]??`#${s.class_id}`,O=s.score!=null?` ${(s.score*100).toFixed(0)}%`:"";return!R&&!O?null:P.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${g}%`,top:`${w}%`,transform:"translateY(-100%)",backgroundColor:ye(s.class_id)},children:P.jsxs("span",{className:"mono",children:[R,O]})},u)})})]})}const Wt=30,te=["#ff5a5a","#39d353","#5b9bff"];function Se(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function $(e,t,r){return t==="uint8"?r==="int"?String(Math.round(e)):Se(e/255):Se(r==="int"?e*255:e)}const $t={x:0,y:0,w:1,h:1};function ge({imageElRef:e,naturalWidth:t,naturalHeight:r,zoom:n,pan:o,sample:a,notation:v="decimal",version:f=0,onActiveChange:y,sourceWindow:d=$t}){const c=l.useRef(null),h=l.useRef(!1),b=l.useRef(y);b.current=y;const i=l.useCallback(s=>{var u;s!==h.current&&(h.current=s,(u=b.current)==null||u.call(b,s))},[]),S=l.useCallback(()=>{var ue;const s=c.current,u=e.current;if(!s)return;const m=window.devicePixelRatio||1,p=s.clientWidth,g=s.clientHeight;if(p===0||g===0)return;s.width!==Math.round(p*m)&&(s.width=Math.round(p*m)),s.height!==Math.round(g*m)&&(s.height=Math.round(g*m));const w=s.getContext("2d");if(!w)return;if(w.setTransform(m,0,0,m,0,0),w.clearRect(0,0,p,g),!u||t<=0||r<=0){i(!1);return}const R=u.getBoundingClientRect(),O=s.getBoundingClientRect();if(R.width===0||R.height===0){i(!1);return}const F=d.x*t,U=d.y*r,B=d.w*t,k=d.h*r;if(B<=0||k<=0){i(!1);return}const G=Math.min(R.width/B,R.height/k);if(G<Wt){i(!1);return}const D=B*G,I=k*G,X=R.left+(R.width-D)/2-O.left,N=R.top+(R.height-I)/2-O.top,q=Math.max(Math.floor(F),Math.floor(F+(0-X)/G)),J=Math.min(Math.ceil(F+B),Math.ceil(F+(p-X)/G)),Y=Math.max(Math.floor(U),Math.floor(U+(0-N)/G)),re=Math.min(Math.ceil(U+k),Math.ceil(U+(g-N)/G));if(J<=q||re<=Y){i(!1);return}i(!0),w.textAlign="center",w.textBaseline="middle",w.lineJoin="round";const ce=G*.14,ae=G-ce*2;for(let H=Y;H<re;H++)for(let K=q;K<J;K++){const Z=a(K,H,v);if(!Z||Z.lines.length===0)continue;const Q=Z.lines.length;let se=1;for(const z of Z.lines)z.length>se&&(se=z.length);const de=ae/(Q*1.15),x=ae/(se*.62)||de,C=Math.min(de,x,24);if(C<6)continue;const T=X+(K-F+.5)*G,E=N+(H-U+.5)*G,_=C*1.15,A=Z.luminance<=.55,L=A?"#ffffff":"#000000";w.font=`${C}px ui-monospace, SFMono-Regular, Menlo, monospace`,w.lineWidth=Math.max(1.4,C*.16),w.strokeStyle=A?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let W=E-Q*_/2+_/2;for(let z=0;z<Z.lines.length;z++){const V=Z.lines[z];w.strokeText(V,T,W),w.fillStyle=((ue=Z.colors)==null?void 0:ue[z])??L,w.fillText(V,T,W),W+=_}}},[e,t,r,a,v,i,d]);return l.useEffect(()=>{S()},[S,n,o.x,o.y,f,v,d]),l.useEffect(()=>{const s=c.current;if(!s)return;const u=new ResizeObserver(()=>S());return u.observe(s),()=>u.disconnect()},[S]),P.jsx("canvas",{ref:c,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function $e({notation:e,onChange:t,className:r=""}){return P.jsx("button",{type:"button",onClick:n=>{n.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:n=>n.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${r}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const qt=`
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
  let srcUV = clamp(uvRect.xy + uv * uvRect.zw, vec2<f32>(0.0), vec2<f32>(0.999999));
  let coord = vec2<i32>(srcUV * srcDims);
  let sampled = textureLoad(t_bind0, coord, 0);

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
`,Yt=`#pragma vertex
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
uniform sampler2D t_bind0;
uniform sampler2D t_bind1;
uniform vec4 u_bind2;
uniform vec4 u_bind3;
uniform float u_bind4;

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
  vec2 srcUV = clamp(uvRect.xy + uv * uvRect.zw, 0.0, 0.999999);
  ivec2 coord = ivec2(srcUV * srcDims);
  vec4 sampled = texelFetch(t_bind0, coord, 0);

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
`,Ht=`
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
  let srcUV = clamp(uvRect.xy + uv * uvRect.zw, vec2<f32>(0.0), vec2<f32>(0.999999));

  let dimsA = vec2<f32>(textureDimensions(t_bind0));
  let coordA = vec2<i32>(srcUV * dimsA);
  let sampledA = textureLoad(t_bind0, coordA, 0);

  let dimsB = vec2<f32>(textureDimensions(t_bind1));
  let coordB = vec2<i32>(srcUV * dimsB);
  let sampledB = textureLoad(t_bind1, coordB, 0);

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
`,Kt=`#pragma vertex
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
  vec2 srcUV = clamp(uvRect.xy + uv * uvRect.zw, 0.0, 0.999999);

  vec2 dimsA = vec2(textureSize(t_bind0, 0));
  ivec2 coordA = ivec2(srcUV * dimsA);
  vec4 sampledA = texelFetch(t_bind0, coordA, 0);

  vec2 dimsB = vec2(textureSize(t_bind1, 0));
  ivec2 coordB = ivec2(srcUV * dimsB);
  vec4 sampledB = texelFetch(t_bind1, coordB, 0);

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
`,Re={linear:0,srgb:1,reinhard:2,aces:3,extended:4},qe=new WeakMap;function Zt(e,t){let r=qe.get(e);r||(r=new Map,qe.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:qt,shaderGLSL:Yt,targetFormat:t}),r.set(t,n)),n}function Ye(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function He(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function jt(e,t,r,n){var i;const o=Ye(t),a=Zt(e,o),v=He(e,n.isScalar?n.colormap:void 0),f=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,y=Re[n.operator]??Re.srgb,d=new Float32Array([n.exposureEV,y,f,n.isScalar?1:0]),c=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),h=new Float32Array([n.hdrOut?1:0]);let b;try{b=e.createBindGroup(a,[{binding:0,resource:r},{binding:1,resource:v},{binding:2,resource:{uniform:d}},{binding:3,resource:{uniform:c}},{binding:4,resource:{uniform:h}}]),e.renderFullscreen(t,a,b)}finally{(i=b==null?void 0:b.destroy)==null||i.call(b),v.destroy()}}const Jt={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Qt={linear:0,signed:1,positive:2},er={split:0,blend:1,diff:2},Ke=new WeakMap;function tr(e,t){let r=Ke.get(e);r||(r=new Map,Ke.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:Ht,shaderGLSL:Kt,targetFormat:t}),r.set(t,n)),n}function rr(e,t,r,n,o){var m;const a=Ye(t),v=tr(e,a),f=o.mode==="diff"&&!!o.diffColormap,y=f?o.diffColormap:void 0,d=He(e,y),c=o.gamma,h=Re[o.operator],b=new Float32Array([o.exposureEV,h,c,0]),i=new Float32Array([o.uv.x,o.uv.y,o.uv.w,o.uv.h]),S=new Float32Array([er[o.mode],o.split,o.alpha,Jt[o.diffSubmode]??0]),s=new Float32Array([Qt[o.diffCmapMode??"linear"]??0,0,f?1:0,0]);let u;try{u=e.createBindGroup(v,[{binding:0,resource:r},{binding:1,resource:n},{binding:2,resource:d},{binding:3,resource:{uniform:b}},{binding:4,resource:{uniform:i}},{binding:5,resource:{uniform:S}},{binding:6,resource:{uniform:s}}]),e.renderFullscreen(t,v,u)}finally{(m=u==null?void 0:u.destroy)==null||m.call(u),d.destroy()}}function Ze(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,o=t/r,a=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:a,mae:o}}async function nr(e,t,r){const n=Math.min(t.width,r.width),o=Math.min(t.height,r.height),a=n*o*3;if(a<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:b,sumAbs:i}=await e.reduceDiffSumSquaredAbs(t,r,n,o);return Ze(b,i,a)}const v=await e.readback(t),f=await e.readback(r),y=v instanceof Uint8Array,d=f instanceof Uint8Array;let c=0,h=0;for(let b=0;b<o;b++)for(let i=0;i<n;i++){const S=(b*t.width+i)*4,s=(b*r.width+i)*4;for(let u=0;u<3;u++){const m=(v[S+u]??0)/(y?255:1),p=(f[s+u]??0)/(d?255:1),g=m-p;c+=g*g,h+=Math.abs(g)}}return Ze(c,h,a)}const or=12,oe=[];function je(e){const t=oe.indexOf(e);t!==-1&&oe.splice(t,1),oe.push(e)}function ir(e){const t=oe.indexOf(e);t!==-1&&oe.splice(t,1)}function he(e){e.parked||(ir(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.device&&e.device!==e.sharedDevice&&e.device.destroy(),e.device=null,e.parked=!0)}function Je(e){for(;oe.length>or;){const t=oe.find(r=>r!==e&&!r.visible)??oe.find(r=>r!==e);if(!t)break;he(t)}}function Qe(e){if(e.disposed)return;if(!e.parked&&e.surface){je(e),Je(e);return}const t=e.sharedDevice.backend==="webgl2"?ve():e.sharedDevice;if(e.device=t,e.surface=t.createSurface(e.canvas,{hdr:e.hdr}),e.source){e.canvas.width=e.source.width,e.canvas.height=e.source.height,e.surface.configure(e.source.width,e.source.height);const r=t.createTexture(e.source.width,e.source.height,e.source.format);r.write(e.source.data),e.srcTexture=r}e.parked=!1,je(e),Je(e)}const ar=30;function et(e,t){if(!(e.disposed||!e.source)&&(Qe(e),!(!e.device||!e.surface||!e.srcTexture))){if(e.device.isContextLost()){tt(e,t);return}try{jt(e.device,e.surface,e.srcTexture,t),e.restoreRetries=0}catch(r){if(e.device.isContextLost()){tt(e,t);return}throw r}}}function tt(e,t){if(!e.disposed){if(e.restoreRetries>=ar){e.restoreRetries=0;return}e.restoreRetries++,he(e),requestAnimationFrame(()=>et(e,t))}}function sr(e){return{canvas:e.canvas,backend:e.sharedDevice.backend,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.device&&e.surface)){e.canvas.width=t.width,e.canvas.height=t.height,e.surface.configure(t.width,t.height),e.srcTexture&&e.srcTexture.destroy();const r=e.device.createTexture(t.width,t.height,t.format);r.write(t.data),e.srcTexture=r}},render(t){et(e,t)},park(){e.disposed||he(e)},restore(){e.disposed||!e.source||Qe(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(he(e),e.source=null,e.disposed=!0)}}}async function cr(e,t){const r=await pe(),n={canvas:e,sharedDevice:r,device:null,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,restoreRetries:0};return sr(n)}function rt(e){e.dispose()}function ur(e){return"hdr"in e&&e.hdr!=null}const dr=["linear","srgb","reinhard","aces"];function lr(e){return e&&dr.includes(e)?e:"srgb"}const ie=e=>Number.isFinite(e)?e:0;function fr(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function mr(e){const{h:t,w:r,c:n}=fr(e.shape),o=e.data,a=new Float32Array(r*t*4);for(let v=0;v<r*t;v++){const f=v*n;let y,d,c,h=1;n===1?y=d=c=ie(o[f]):n===3?(y=ie(o[f]),d=ie(o[f+1]),c=ie(o[f+2])):(y=ie(o[f]),d=ie(o[f+1]),c=ie(o[f+2]),h=ie(o[f+3]));const b=v*4;a[b]=y,a[b+1]=d,a[b+2]=c,a[b+3]=h}return{data:a,width:r,height:t,format:"rgba32float"}}function nt(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const o=Math.min(t.width/r,t.height/n),a=r*o,v=n*o,f=(t.width-a)/2,y=(t.height-v)/2,d=Math.max(e.zoom,1e-6),c=1/d,h=1/d,b=(f*(1-d)-e.pan.x)/(a*d),i=(y*(1-d)-e.pan.y)/(v*d);return{x:b,y:i,w:c,h}}const pr={zoom:1,pan:{x:0,y:0}};function gr(e){var se,de;const t=ur(e),r=l.useRef(null),n=l.useRef(null),o=l.useRef(null),a=l.useRef(null),v=l.useRef(!1),[f,y]=l.useState(!1),[d,c]=l.useState(null),[h,b]=l.useState(0),[i,S]=l.useState(0),[s,u]=l.useState({x:0,y:0,w:1,h:1}),m=l.useRef(null),p=l.useRef(null),[g,w]=l.useState(0),[R,O]=l.useState(e.pixelValueNotation??"decimal"),[F,U]=l.useState(!1),B=e.zoom??1,k=e.pan??{x:0,y:0},G=e.onViewportChange,D=t?"none":e.colormap??"none";l.useEffect(()=>{const x=r.current;if(!x)return;let C=!1;return pe().then(T=>{if(C)return;const E=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,_=T.backend==="webgpu"&&T.capabilities.hdr&&E&&t;v.current=_,cr(x,{hdr:_}).then(A=>{if(C){rt(A);return}a.current=A,y(!0)})}),()=>{C=!0,a.current&&(rt(a.current),a.current=null)}},[]);const{containerProps:I}=Xe({containerRef:n,zoom:B,pan:k,onViewportChange:G}),X=l.useCallback(()=>{G==null||G(pr)},[G]);l.useEffect(()=>{const x=n.current;if(!x)return;const C=new ResizeObserver(()=>S(T=>T+1));return C.observe(x),()=>C.disconnect()},[]),l.useEffect(()=>{const x=n.current;if(!x)return;const C=new IntersectionObserver(T=>{const E=T[0];if(!E)return;const _=a.current;_&&(_.setVisible(E.isIntersecting),E.isIntersecting?_.isParked&&(_.restore(),S(A=>A+1)):_.park())},{threshold:0});return C.observe(x),()=>C.disconnect()},[]),l.useEffect(()=>{var T;if(!t||!f)return;const x=e.hdr;m.current=x;const C=mr(x);(T=a.current)==null||T.setSource(C),c(E=>E&&E.w===C.width&&E.h===C.height?E:{w:C.width,h:C.height}),w(E=>E+1),b(E=>E+1)},[t,f,t?e.hdr:null]),l.useEffect(()=>{if(t||!f)return;const x=e,C=x.imageUrl,T=x.colormap??"none";if(!C){p.current=null,c(null),w(_=>_+1);return}let E=!1;return Ne(C).then(_=>{var W,z;if(E||!_)return;let A=_;if(T!=="none"){const V=`gpu::${C}::${T}`,ee=It(V);if(ee)A=ee;else{const ne=Mt.has(T)?"positive":"linear";A=Gt(_,T,ne),Lt(V,A)}}p.current=_;const L={data:A.data,width:A.width,height:A.height,format:"rgba8unorm"};(W=a.current)==null||W.setSource(L),c(V=>V&&V.w===A.width&&V.h===A.height?V:{w:A.width,h:A.height}),(z=x.onNaturalSize)==null||z.call(x,A.width,A.height),w(V=>V+1),b(V=>V+1)}),()=>{E=!0}},[t,f,t?null:e.imageUrl,t?null:e.colormap]);const N=t?e.exposure??0:0,q=t?e.tonemap:void 0,J=t?e.gamma:void 0;l.useEffect(()=>{const x=a.current;if(!x||!f||!d)return;const C=n.current,T=C?C.getBoundingClientRect():{width:d.w,height:d.h},E=nt({zoom:B,pan:k},T,d.w,d.h);u(L=>L.x===E.x&&L.y===E.y&&L.w===E.w&&L.h===E.h?L:E);let _=E;x.backend==="webgl2"&&(_={x:_.x,y:_.y+_.h,w:_.w,h:-_.h});const A=t?{exposureEV:N,operator:v.current?"extended":lr(q),gamma:J,isScalar:!1,hdrOut:v.current,uv:_}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:_};x.render(A)},[f,d,h,B,k.x,k.y,N,q,J,i,t]);const Y=l.useCallback((x,C,T)=>{if(t){const ee=m.current,ne=d;if(!ee||!ne||x<0||C<0||x>=ne.w||C>=ne.h)return null;const j=ee.shape.length===2?1:ee.shape[2]??1,le=(C*ne.w+x)*j,be=ee.data,ot=.5;return j===1?{lines:[$(be[le]??0,"unit",T)],luminance:ot}:{lines:[$(be[le]??0,"unit",T),$(be[le+1]??0,"unit",T),$(be[le+2]??0,"unit",T)],luminance:ot,colors:[te[0],te[1],te[2]]}}const E=p.current;if(!E||x<0||C<0||x>=E.width||C>=E.height)return null;const _=(C*E.width+x)*4,A=E.data[_],L=E.data[_+1],W=E.data[_+2],z=(.299*A+.587*L+.114*W)/255;return D!=="none"||A===L&&L===W?{lines:[$(A,"uint8",T)],luminance:z}:{lines:[$(A,"uint8",T),$(L,"uint8",T),$(W,"uint8",T)],luminance:z,colors:[te[0],te[1],te[2]]}},[t,d,D]),re=e.showAxes??!1,ce=t?e.label??"":e.label,ae=e.interpolation??"auto",ue=ae==="auto"?void 0:ae,H=t?void 0:e.overlay,K=t?void 0:e.overlaySettings,Z=t?!1:e.isDraggable??!1,Q=t?void 0:e.onDragStart;return P.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":f,children:[P.jsxs("div",{ref:n,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:re&&d?"16px 4px 4px 28px":"4px",...I.style},onPointerDown:I.onPointerDown,onPointerMove:I.onPointerMove,onPointerUp:I.onPointerUp,onPointerCancel:I.onPointerCancel,onDoubleClick:X,"data-gpu-image-viewport":!0,children:[P.jsxs("div",{ref:o,className:"relative w-full h-full",children:[P.jsx("canvas",{ref:r,className:"w-full h-full object-contain block",style:{imageRendering:ue},"data-gpu-image-canvas":!0}),re&&d&&P.jsx(Dt,{naturalWidth:d.w,naturalHeight:d.h,zoom:B,containerRef:o}),H&&(K==null?void 0:K.enabled)&&d&&((((se=H.boxes)==null?void 0:se.length)??0)>0||(((de=H.masks)==null?void 0:de.length)??0)>0)&&P.jsx(Xt,{data:H,settings:K,naturalWidth:d.w,naturalHeight:d.h})]}),d&&P.jsx(ge,{imageElRef:r,naturalWidth:d.w,naturalHeight:d.h,zoom:B,pan:k,sourceWindow:s,sample:Y,notation:R,version:g,onActiveChange:U}),F&&P.jsx($e,{notation:R,onChange:O})]}),ce?P.jsx(Ot,{label:ce,isDraggable:Z,onDragStart:Q}):null]})}const hr={zoom:1,pan:{x:0,y:0}};function br(e){const t=De(e),r=new Float32Array(256*4);for(let n=0;n<256;n++)r[n*4+0]=t[n*3+0]/255,r[n*4+1]=t[n*3+1]/255,r[n*4+2]=t[n*3+2]/255,r[n*4+3]=1;return r}function vr({imageUrl:e,baselineUrl:t,mode:r,splitPosition:n,blendAlpha:o,onSplitPositionChange:a,diffSubmode:v,colormap:f="none",zoom:y,pan:d,onViewportChange:c,interpolation:h="auto",label:b="",pixelValueNotation:i="decimal"}){const S=l.useRef(null),s=l.useRef(null),u=l.useRef(null),[m,p]=l.useState(!1),[g,w]=l.useState(null),[R,O]=l.useState(0),[F,U]=l.useState(0),[B,k]=l.useState(null),[G,D]=l.useState(i),[I,X]=l.useState(!1),[N,q]=l.useState({x:0,y:0,w:1,h:1}),J=l.useRef(null),Y=l.useRef(null),[re,ce]=l.useState(0);l.useEffect(()=>{const x=s.current;if(!x)return;let C=!1;return pe().then(T=>{if(C)return;const E=T.backend==="webgl2",_=E?ve():T,A=_.createSurface(x,{hdr:!1});u.current={device:_,ownsDevice:E,surface:A,texA:null,texB:null},p(!0)}),()=>{var E,_;C=!0;const T=u.current;T&&((E=T.texA)==null||E.destroy(),(_=T.texB)==null||_.destroy(),T.ownsDevice&&T.device.destroy(),u.current=null)}},[]),l.useEffect(()=>{const x=S.current;if(!x)return;const C=new ResizeObserver(()=>U(T=>T+1));return C.observe(x),()=>C.disconnect()},[]),l.useEffect(()=>{if(!m)return;let x=!1;if(!u.current)return;async function T(E){return E?Ne(E):null}return Promise.all([T(e),T(t)]).then(([E,_])=>{var V,ee,ne;if(x||!u.current)return;const A=u.current;J.current=E,Y.current=_,(V=A.texA)==null||V.destroy(),(ee=A.texB)==null||ee.destroy(),A.texA=null,A.texB=null;const L=E??_;if(!L){w(null),ce(j=>j+1);return}const W=j=>{const le=A.device.createTexture(j.width,j.height,"rgba8unorm");return le.write(j.data),le};A.texA=W(_??L),A.texB=W(E??L);const z=s.current;z.width=L.width,z.height=L.height,(ne=A.surface)==null||ne.configure(L.width,L.height),w({w:L.width,h:L.height}),ce(j=>j+1),O(j=>j+1)}),()=>{x=!0}},[m,e,t]);const ae=l.useMemo(()=>(v??"").includes("signed")?"signed":"positive",[v]),ue=l.useMemo(()=>f!=="none"?br(f):void 0,[f]);l.useEffect(()=>{const x=u.current;if(!m||!x||!x.surface||!x.texA||!x.texB||!g)return;const C=S.current,T=C?C.getBoundingClientRect():{width:g.w,height:g.h},E=nt({zoom:y,pan:d},T,g.w,g.h);q(L=>L.x===E.x&&L.y===E.y&&L.w===E.w&&L.h===E.h?L:E);let _=E;x.device.backend==="webgl2"&&(_={x:_.x,y:_.y+_.h,w:_.w,h:-_.h});const A={exposureEV:0,operator:"linear",gamma:1,uv:_,mode:r,split:n,alpha:o,diffSubmode:v??"absolute",diffCmapMode:ae,diffColormap:r==="diff"?ue:void 0};rr(x.device,x.surface,x.texA,x.texB,A)},[m,g,R,y,d.x,d.y,r,n,o,v,ae,ue,F]),l.useEffect(()=>{const x=u.current;if(!m||!x||!x.texA||!x.texB||!t){k(null);return}let C=!1;return nr(x.device,x.texA,x.texB).then(T=>{C||k(T)}),()=>{C=!0}},[m,R,t]);const H=x=>(C,T,E)=>{const _=x.current;if(!_||C<0||T<0||C>=_.width||T>=_.height)return null;const A=(T*_.width+C)*4,L=_.data[A],W=_.data[A+1],z=_.data[A+2],V=(.299*L+.587*W+.114*z)/255;return L===W&&W===z?{lines:[$(L,"uint8",E)],luminance:V}:{lines:[$(L,"uint8",E),$(W,"uint8",E),$(z,"uint8",E)],luminance:V,colors:[te[0],te[1],te[2]]}},K=l.useMemo(()=>H(J),[]),Z=l.useMemo(()=>H(Y),[]),{containerProps:Q}=Xe({containerRef:S,zoom:y,pan:d,onViewportChange:c}),se=l.useCallback(()=>c==null?void 0:c(hr),[c]),de=h==="auto"?void 0:h;return P.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":m,children:[P.jsxs("div",{ref:S,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...Q.style},onPointerDown:Q.onPointerDown,onPointerMove:Q.onPointerMove,onPointerUp:Q.onPointerUp,onPointerCancel:Q.onPointerCancel,onDoubleClick:se,"data-gpu-compare-viewport":!0,children:[P.jsxs("div",{className:"relative w-full h-full",children:[P.jsx("canvas",{ref:s,className:"w-full h-full object-contain block",style:{imageRendering:de},"data-gpu-compare-canvas":!0}),r==="split"&&P.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${n*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:x=>{x.stopPropagation(),a==null||a(.5)},onPointerDown:x=>{x.stopPropagation(),x.preventDefault();const T=x.currentTarget.parentElement.getBoundingClientRect(),E=A=>{a==null||a(Math.max(0,Math.min(1,(A.clientX-T.left)/T.width)))},_=()=>{window.removeEventListener("pointermove",E),window.removeEventListener("pointerup",_)};window.addEventListener("pointermove",E),window.addEventListener("pointerup",_)},children:P.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),r==="split"?P.jsxs(P.Fragment,{children:[t&&g&&P.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-n)*100}% 0 0)`},children:P.jsx(ge,{imageElRef:s,naturalWidth:g.w,naturalHeight:g.h,zoom:y,pan:d,sourceWindow:N,sample:Z,notation:G,version:re})}),t&&g&&P.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${n*100}%)`},children:P.jsx(ge,{imageElRef:s,naturalWidth:g.w,naturalHeight:g.h,zoom:y,pan:d,sourceWindow:N,sample:K,notation:G,version:re,onActiveChange:X})})]}):g&&P.jsx(ge,{imageElRef:s,naturalWidth:g.w,naturalHeight:g.h,zoom:y,pan:d,sourceWindow:N,sample:K,notation:G,version:re,onActiveChange:X}),I&&P.jsx($e,{notation:G,onChange:D})]}),P.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),b?P.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:b}):null,B&&P.jsxs("span",{className:`absolute right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${I?"top-8":"top-1"}`,"data-gpu-compare-metrics":!0,children:["MSE ",B.mse.toExponential(2)," · PSNR ",Number.isFinite(B.psnr)?B.psnr.toFixed(1):"∞"," dB · MAE"," ",B.mae.toExponential(2)]})]})}const xr="cairn-plot:gpu-image-ready";async function wr(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await pe(),window.__cairnPlotGpuImagePane=gr,window.__cairnPlotGpuComparePane=vr,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(xr))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}wr()})(__cairnPlotJsxRuntime,__cairnPlotReact);

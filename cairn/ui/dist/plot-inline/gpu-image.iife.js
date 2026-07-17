var pn=Object.defineProperty;var vn=(d,s,De)=>s in d?pn(d,s,{enumerable:!0,configurable:!0,writable:!0,value:De}):d[s]=De;var k=(d,s,De)=>vn(d,typeof s!="symbol"?s+"":s,De);(function(d,s){"use strict";function De(e,t){switch(t){case"rgba8unorm":return{internalFormat:e.RGBA8,format:e.RGBA,type:e.UNSIGNED_BYTE};case"rgba16float":return{internalFormat:e.RGBA16F,format:e.RGBA,type:e.HALF_FLOAT};case"rgba32float":return{internalFormat:e.RGBA32F,format:e.RGBA,type:e.FLOAT};case"r32float":return{internalFormat:e.R32F,format:e.RED,type:e.FLOAT};default:{const r=t;throw new Error(`webgl2 device: unknown TextureFormat ${String(r)}`)}}}function Nt(e){return e==="rgba16float"||e==="rgba32float"||e==="r32float"}function Xt(e){const t="#pragma vertex",r="#pragma fragment",n=e.indexOf(t),a=e.indexOf(r);if(n===-1||a===-1||a<n)throw new Error("webgl2 device: shaderGLSL must contain '#pragma vertex' followed by '#pragma fragment' (see engine/shaders/passthrough.glsl.ts)");const i=e.slice(n+t.length,a).trim(),g=e.slice(a+r.length).trim();return{vertex:i,fragment:g}}function it(e,t,r){const n=e.createShader(t);if(!n)throw new Error("webgl2 device: gl.createShader failed");if(e.shaderSource(n,r),e.compileShader(n),!e.getShaderParameter(n,e.COMPILE_STATUS)){const a=e.getShaderInfoLog(n);e.deleteShader(n);const i=t===e.VERTEX_SHADER?"vertex":"fragment";throw new Error(`webgl2 device: ${i} shader compile failed: ${a}
---source---
${r}`)}return n}function Wt(e,t,r){const n=it(e,e.VERTEX_SHADER,t),a=it(e,e.FRAGMENT_SHADER,r),i=e.createProgram();if(!i)throw new Error("webgl2 device: gl.createProgram failed");if(e.attachShader(i,n),e.attachShader(i,a),e.linkProgram(i),e.deleteShader(n),e.deleteShader(a),!e.getProgramParameter(i,e.LINK_STATUS)){const g=e.getProgramInfoLog(i);throw e.deleteProgram(i),new Error(`webgl2 device: program link failed: ${g}`)}return i}function $t(){const e=document.createElement("canvas");e.width=1,e.height=1;const t=e.getContext("webgl2");if(!t)throw new Error("webgl2 device: WebGL2 is not supported in this browser");const r=!!t.getExtension("EXT_color_buffer_float"),n=t.getExtension("WEBGL_lose_context");return n==null||n.loseContext(),{hdr:!1,compute:!1,float16:r}}class ot{constructor(t,r,n,a){k(this,"width");k(this,"height");k(this,"format");k(this,"glTexture");k(this,"gl");k(this,"info");k(this,"destroyed",!1);this.gl=t,this.width=r,this.height=n,this.format=a,this.info=De(t,a);const i=t.createTexture();if(!i)throw new Error("webgl2 device: gl.createTexture failed");this.glTexture=i,t.bindTexture(t.TEXTURE_2D,i),t.texImage2D(t.TEXTURE_2D,0,this.info.internalFormat,r,n,0,this.info.format,this.info.type,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.bindTexture(t.TEXTURE_2D,null)}write(t){if(this.destroyed)throw new Error("webgl2 device: write() on a destroyed texture");const r=this.gl;r.bindTexture(r.TEXTURE_2D,this.glTexture),r.pixelStorei(r.UNPACK_ALIGNMENT,1),r.texSubImage2D(r.TEXTURE_2D,0,0,0,this.width,this.height,this.info.format,this.info.type,t),r.bindTexture(r.TEXTURE_2D,null)}destroy(){this.destroyed||(this.gl.deleteTexture(this.glTexture),this.destroyed=!0)}}class st{constructor(t,r){k(this,"_s");k(this,"glSampler");const n=t.createSampler();if(!n)throw new Error("webgl2 device: gl.createSampler failed");this.glSampler=n;const a=(r==null?void 0:r.filter)==="nearest"?t.NEAREST:t.LINEAR;t.samplerParameteri(n,t.TEXTURE_MIN_FILTER,a),t.samplerParameteri(n,t.TEXTURE_MAG_FILTER,a),t.samplerParameteri(n,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.samplerParameteri(n,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this._s=n}}class zt{constructor(t,r){k(this,"_p");k(this,"program");k(this,"targetFormat");this.program=t,this.targetFormat=r,this._p=t}}class Yt{constructor(t){k(this,"_b");k(this,"entries");this.entries=t,this._b=t}destroy(){}}class Ht{constructor(t){k(this,"canvas");k(this,"hdr",!1);this.canvas=t}configure(t,r){this.canvas.width=t,this.canvas.height=r}getCurrentTextureView(){return null}}function qt(e,t,r,n){const a=e.getUniformLocation(t,`u_bind${r}`);if(!a)return;if(n instanceof Int32Array)switch(n.length){case 1:e.uniform1iv(a,n);return;case 2:e.uniform2iv(a,n);return;case 3:e.uniform3iv(a,n);return;case 4:e.uniform4iv(a,n);return;default:e.uniform1iv(a,n);return}const i=n instanceof Float32Array?n:new Float32Array(n.buffer,n.byteOffset,n.byteLength/4);switch(i.length){case 1:e.uniform1fv(a,i);return;case 2:e.uniform2fv(a,i);return;case 3:e.uniform3fv(a,i);return;case 4:e.uniform4fv(a,i);return;case 16:e.uniformMatrix4fv(a,!1,i);return;default:e.uniform1fv(a,i);return}}const ct=new WeakSet;function Kt(e){ct.has(e)||(ct.add(e),e.addEventListener("webglcontextlost",t=>{t.preventDefault()},!1))}function Ve(){let e=null,t=null,r=null,n=null;const a=$t();function i(u){r=u.createFramebuffer(),n=u.createVertexArray(),u.getExtension("OES_texture_float_linear"),u.getExtension("EXT_color_buffer_float")}function g(u,l){if(e=u,t=l,Kt(l),!u.isContextLost()){i(u);return}r=null,n=null;const E=()=>{l.removeEventListener("webglcontextrestored",E),e===u&&i(u)};l.addEventListener("webglcontextrestored",E,!1)}function m(){if(e)return e;const u=document.createElement("canvas");u.width=1,u.height=1;const l=u.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!l)throw new Error("webgl2 device: WebGL2 is not supported in this browser");return g(l,u),l}function w(u,l){if("canvas"in l)return u.bindFramebuffer(u.FRAMEBUFFER,null),{width:l.canvas.width,height:l.canvas.height,isFloat:!1};const E=l;u.bindFramebuffer(u.FRAMEBUFFER,r),u.framebufferTexture2D(u.FRAMEBUFFER,u.COLOR_ATTACHMENT0,u.TEXTURE_2D,E.glTexture,0);const o=u.checkFramebufferStatus(u.FRAMEBUFFER);if(o!==u.FRAMEBUFFER_COMPLETE)throw new Error(`webgl2 device: framebuffer incomplete for target texture (format=${E.format}, status=0x${o.toString(16)}). Float formats need EXT_color_buffer_float as a render target (capabilities.float16=${a.float16}).`);return{width:E.width,height:E.height,isFloat:Nt(E.format)}}return{backend:"webgl2",capabilities:a,createTexture(u,l,E){const o=m();return new ot(o,u,l,E)},createSampler(u){const l=m();return new st(l,u)},createRenderPipeline(u){const l=m(),{vertex:E,fragment:o}=Xt(u.shaderGLSL),v=Wt(l,E,o);return new zt(v,u.targetFormat)},createComputePipeline:void 0,createBindGroup(u,l){return new Yt(l)},createSurface(u,l){var E;if(e&&t&&t!==u)throw new Error("webgl2 device: this device already owns a WebGL2 context bound to a different canvas. WebGL2 has no cross-canvas resource sharing — create one createWebGL2Device() per on-screen canvas (see engine/pool.ts).");if(!e){const o=u.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!o)throw new Error("webgl2 device: WebGL2 is not supported on the given canvas");o.isContextLost()&&((E=o.getExtension("WEBGL_lose_context"))==null||E.restoreContext()),g(o,u)}if("drawingBufferColorSpace"in e)try{e.drawingBufferColorSpace="display-p3"}catch{}return new Ht(u)},renderFullscreen(u,l,E){const o=m(),v=l,c=E,{width:f,height:x}=w(o,u);o.viewport(0,0,f,x),o.disable(o.DEPTH_TEST),o.disable(o.BLEND),o.disable(o.CULL_FACE),o.useProgram(v.program),o.bindVertexArray(n);for(const p of c.entries){const T=p.resource;if(T instanceof ot){o.activeTexture(o.TEXTURE0+p.binding),o.bindTexture(o.TEXTURE_2D,T.glTexture);const y=o.getUniformLocation(v.program,`t_bind${p.binding}`);y&&o.uniform1i(y,p.binding)}else T instanceof st?o.bindSampler(p.binding,T.glSampler):qt(o,v.program,p.binding,T.uniform)}o.drawArrays(o.TRIANGLES,0,3),o.bindVertexArray(null),o.bindFramebuffer(o.FRAMEBUFFER,null)},async readback(u){const l=m(),{width:E,height:o,isFloat:v}=w(l,u);if(v){const f=new Float32Array(E*o*4);return l.readPixels(0,0,E,o,l.RGBA,l.FLOAT,f),l.bindFramebuffer(l.FRAMEBUFFER,null),f}const c=new Uint8Array(E*o*4);return l.readPixels(0,0,E,o,l.RGBA,l.UNSIGNED_BYTE,c),l.bindFramebuffer(l.FRAMEBUFFER,null),c},destroy(){if(!e)return;r&&e.deleteFramebuffer(r),n&&e.deleteVertexArray(n);const u=e.getExtension("WEBGL_lose_context");u==null||u.loseContext(),e=null,t=null,r=null,n=null},isContextLost(){return e?e.isContextLost():!1}}}const Ne=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function lt(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"premultiplied",usage:Ne}),{hdr:!1,format:r}}function jt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:Ne}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:Ne}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return lt(e,t)}}}const Zt=`
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
`;function Xe(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function ut(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Qt(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let a;return r===0?a=n/1024*Math.pow(2,-14):r===31?a=n?NaN:1/0:a=(1+n/1024)*Math.pow(2,r-15),t?-a:a}const Jt={texture:0,sampler:1,uniform:2};function We(e,t){return e*3+Jt[t]}const er={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function tr(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const a=Number(n[1]),i=n[2]!==void 0,g=n[3].trim();if(i){const m=er[g];if(m===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${g}" (binding ${a}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(a,{kind:"uniform",sizeBytes:m})}else g==="sampler"||g==="sampler_comparison"?t.set(a,{kind:"sampler"}):t.set(a,{kind:"texture"})}return t}class dt{constructor(t,r,n,a){k(this,"width");k(this,"height");k(this,"format");k(this,"gpuTexture");k(this,"device");k(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=a,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:Xe(a),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*ut(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class ft{constructor(t){k(this,"_s");k(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class rr{constructor(t,r,n,a,i){k(this,"_p");k(this,"gpuPipeline");k(this,"bindings");k(this,"bindGroupLayout");k(this,"variants");k(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=i,this.variants=new Map([[a,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function nr(e,t){const r=[];for(const[n,a]of t)a.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):a.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class ar{constructor(t){k(this,"_c");k(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class ir{constructor(t,r){k(this,"_b");k(this,"gpuBindGroup");k(this,"ownedBuffers");k(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class or{constructor(t,r,n,a){k(this,"canvas");k(this,"hdr");k(this,"format");k(this,"context");k(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=a}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function Ge(e){return"canvas"in e}async function sr(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function a(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function i(o){return Ge(o)?o.getCurrentTextureView():o.gpuTexture.createView()}function g(o){if(Ge(o))return{width:o.canvas.width,height:o.canvas.height};const v=o;return{width:v.width,height:v.height}}let m=!1;const w=256;let h=null,u=null;function l(){if(!h||!u){const o=t.createShaderModule({code:Zt});u=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const v=t.createPipelineLayout({bindGroupLayouts:[u]});h=t.createComputePipeline({layout:v,compute:{module:o,entryPoint:"cs_main"}})}return{pipeline:h,layout:u}}return{backend:"webgpu",capabilities:r,createTexture(o,v,c){return new dt(t,o,v,c)},createSampler(o){const v=(o==null?void 0:o.filter)==="linear"?"linear":"nearest",c=t.createSampler({magFilter:v,minFilter:v,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new ft(c)},createRenderPipeline(o){const v=t.createShaderModule({code:o.shaderWGSL}),c=tr(o.shaderWGSL),f=Xe(o.targetFormat),x=nr(t,c),p=t.createPipelineLayout({bindGroupLayouts:[x]}),T=S=>t.createRenderPipeline({layout:p,vertex:{module:v,entryPoint:"vs_main"},fragment:{module:v,entryPoint:"fs_main",targets:[{format:S}]},primitive:{topology:"triangle-list"}}),y=T(f);return new rr(y,c,x,f,T)},createComputePipeline(o){const v=t.createShaderModule({code:o.shaderWGSL}),c=t.createComputePipeline({layout:"auto",compute:{module:v,entryPoint:"cs_main"}});return new ar(c)},createBindGroup(o,v){const c=o,f=new Map,x=[];for(const[T,y]of c.bindings)if(y.kind==="uniform"){const S=t.createBuffer({size:y.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});x.push(S),f.set(T,{binding:T,resource:{buffer:S}})}else y.kind==="sampler"&&f.set(T,{binding:T,resource:a()});for(const T of v){const y=T.resource;if(y instanceof dt){const S=We(T.binding,"texture");c.bindings.has(S)&&f.set(S,{binding:S,resource:y.gpuTexture.createView()})}else if(y instanceof ft){const S=We(T.binding,"sampler");c.bindings.has(S)&&f.set(S,{binding:S,resource:y.gpuSampler})}else{const S=We(T.binding,"uniform"),G=c.bindings.get(S);if(G&&G.kind==="uniform"){const F=y.uniform,O=t.createBuffer({size:Math.max(G.sizeBytes,F.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(O,0,F.buffer,F.byteOffset,F.byteLength),x.push(O),f.set(S,{binding:S,resource:{buffer:O}})}}}const p=t.createBindGroup({layout:c.bindGroupLayout,entries:Array.from(f.values())});return new ir(p,x)},createSurface(o,v){const c=o.getContext("webgpu");if(!c)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const f=v.hdr&&r.hdr,x=()=>f?jt(c,t):lt(c,t),p=x();return new or(o,c,p,x)},renderFullscreen(o,v,c){const f=v,x=c,p=i(o),{width:T,height:y}=g(o),S=Ge(o)?o.format:Xe(o.format),G=f.pipelineFor(S),F=t.createCommandEncoder(),O=F.beginRenderPass({colorAttachments:[{view:p,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});O.setPipeline(G),O.setBindGroup(0,x.gpuBindGroup),O.setViewport(0,0,T,y,0,1),O.draw(3),O.end(),t.queue.submit([F.finish()])},async readback(o){const v=Ge(o),{width:c,height:f}=g(o),x=v?o.hdr?"rgba16float":"rgba8unorm":o.format,p=v&&o.format==="bgra8unorm",T=v?o.getCurrentGPUTexture():o.gpuTexture,y=ut(x),S=c*y,G=256,F=Math.ceil(S/G)*G,O=F*f,Y=t.createBuffer({size:O,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),H=t.createCommandEncoder();H.copyTextureToBuffer({texture:T},{buffer:Y,bytesPerRow:F,rowsPerImage:f},{width:c,height:f,depthOrArrayLayers:1}),t.queue.submit([H.finish()]),await Y.mapAsync(GPUMapMode.READ);const C=new Uint8Array(Y.getMappedRange()),A=new Uint8Array(S*f);for(let U=0;U<f;U++){const B=U*F,N=U*S;A.set(C.subarray(B,B+S),N)}if(Y.unmap(),Y.destroy(),x==="rgba8unorm"){if(p)for(let U=0;U<A.length;U+=4){const B=A[U],N=A[U+2];A[U]=N,A[U+2]=B}return A}if(x==="rgba16float"){const U=new Uint16Array(A.buffer,A.byteOffset,A.byteLength/2),B=new Float32Array(U.length);for(let N=0;N<U.length;N++)B[N]=Qt(U[N]);return B}return new Float32Array(A.buffer,A.byteOffset,A.byteLength/4)},async reduceDiffSumSquaredAbs(o,v,c,f){const x=o,p=v,T=Math.max(0,c*f),y=Math.max(1,Math.ceil(T/w)),{pipeline:S,layout:G}=l(),F=y*2*4,O=t.createBuffer({size:F,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),Y=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(Y,0,new Uint32Array([Math.max(1,c),Math.max(1,f),T,0]));const H=t.createBindGroup({layout:G,entries:[{binding:0,resource:x.gpuTexture.createView()},{binding:1,resource:p.gpuTexture.createView()},{binding:2,resource:{buffer:O}},{binding:3,resource:{buffer:Y}}]}),C=t.createBuffer({size:F,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),A=t.createCommandEncoder(),U=A.beginComputePass();U.setPipeline(S),U.setBindGroup(0,H),U.dispatchWorkgroups(y),U.end(),A.copyBufferToBuffer(O,0,C,0,F),t.queue.submit([A.finish()]),await C.mapAsync(GPUMapMode.READ);const N=new Float32Array(C.getMappedRange()).slice();C.unmap(),C.destroy(),O.destroy(),Y.destroy();let te=0,re=0;for(let ee=0;ee<y;ee++)te+=N[ee*2],re+=N[ee*2+1];return{sumSq:te,sumAbs:re}},destroy(){m||(t.destroy(),m=!0)},isContextLost(){return!1}}}let $e=null;function cr(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceWebGL2")}catch{return!1}}async function lr(e){if(!e&&typeof navigator<"u"&&"gpu"in navigator&&!!navigator.gpu)try{return await sr()}catch{}return Ve()}function Oe(e){if(!$e){const t=cr();$e=lr(t)}return $e}function ur(e,t,r){return[e[0]+(t[0]-e[0])*r,e[1]+(t[1]-e[1])*r,e[2]+(t[2]-e[2])*r]}function dr(e){const t=new Uint8Array(768);for(let r=0;r<256;r++){const a=r/255*(e.length-1),i=Math.floor(a),g=Math.min(i+1,e.length-1),m=a-i,[w,h,u]=ur(e[i],e[g],m);t[r*3]=Math.round(w),t[r*3+1]=Math.round(h),t[r*3+2]=Math.round(u)}return t}const mt={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},ht=new Set(["red-green","red-blue"]),gt=new Map;function ze(e){let t=gt.get(e);if(!t){const r=mt[e]??mt.viridis;t=dr(r),gt.set(e,t)}return t}function Ye(e,t,r="linear"){const n=ze(t),a=new ImageData(e.width,e.height),i=e.data,g=a.data;for(let m=0;m<i.length;m+=4){const w=(i[m]+i[m+1]+i[m+2])/3;let h;r==="positive"?h=Math.round(128+w/255*127):h=Math.round(w),h=Math.max(0,Math.min(255,h)),g[m]=n[h*3],g[m+1]=n[h*3+1],g[m+2]=n[h*3+2],g[m+3]=i[m+3]}return a}function pt(e){const t=new Map;return{get(r){return t.get(r)},set(r,n){if(t.size>=e){const a=t.keys().next().value;a!==void 0&&t.delete(a)}t.set(r,n)}}}const vt=pt(50);function He(e){return vt.get(e)}function qe(e,t){vt.set(e,t)}const bt=pt(100);function fr(e){return bt.get(e)}function mr(e,t){bt.set(e,t)}function hr(e,t,r){const n=Math.min(e.width,t.width),a=Math.min(e.height,t.height),i=new ImageData(n,a);for(let g=0;g<a;g++)for(let m=0;m<n;m++){const w=(g*e.width+m)*4,h=(g*t.width+m)*4,u=(g*n+m)*4;for(let l=0;l<3;l++){const E=e.data[w+l],o=t.data[h+l],v=E-o,c=Math.abs(v),f=Math.max(E,1);let x;switch(r){case"signed":x=(v+255)/2;break;case"absolute":x=c;break;case"squared":x=v*v/255;break;case"relative_signed":x=(v/f+1)*127.5;break;case"relative_absolute":x=c/f*255;break;case"relative_squared":x=v*v/(f*f)*255;break}i.data[u+l]=Math.min(255,Math.max(0,Math.round(x)))}i.data[u+3]=255}return i}async function Pe(e){const t=fr(e);return t||new Promise(r=>{const n=new Image;n.onload=()=>{try{const a=document.createElement("canvas");a.width=n.naturalWidth,a.height=n.naturalHeight;const i=a.getContext("2d");if(!i){r(null);return}i.drawImage(n,0,0);const g=i.getImageData(0,0,a.width,a.height);mr(e,g),r(g)}catch(a){console.warn("[cairn] loadImageData failed:",a),r(null)}},n.onerror=a=>{console.warn("[cairn] loadImageData: image failed to load:",e,a),r(null)},n.src=e})}const gr={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},pr={linear:0,signed:1,positive:2},vr=`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,br=`#version 300 es
precision highp float;

uniform sampler2D u_baseline;
uniform sampler2D u_other;
uniform sampler2D u_lut;
uniform int u_diff_mode;
uniform int u_cmap_mode;
uniform bool u_use_colormap;

in vec2 v_uv;
out vec4 fragColor;

float computeDiffChannel(float a, float b, int mode) {
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
  vec4 base = texture(u_baseline, v_uv);
  vec4 other = texture(u_other, v_uv);

  float dr = computeDiffChannel(base.r, other.r, u_diff_mode);
  float dg = computeDiffChannel(base.g, other.g, u_diff_mode);
  float db = computeDiffChannel(base.b, other.b, u_diff_mode);

  vec3 result = clamp(vec3(dr, dg, db), 0.0, 1.0);

  if (u_use_colormap) {
    float avg = (result.r + result.g + result.b) / 3.0;
    float idx;
    if (u_cmap_mode == 2) {
      idx = 0.5 + avg * 0.5;
    } else {
      idx = avg;
    }
    result = texture(u_lut, vec2(clamp(idx, 0.0, 1.0), 0.5)).rgb;
  }

  fragColor = vec4(result, 1.0);
}`;let Ce=null,V=null,pe=null,Be=null;function xr(){if(V)return V;try{if(typeof OffscreenCanvas<"u"?Ce=new OffscreenCanvas(1,1):Ce=document.createElement("canvas"),V=Ce.getContext("webgl2",{preserveDrawingBuffer:!0}),!V)return console.warn("[cairn] WebGL 2 not available"),null;const e=V.createShader(V.VERTEX_SHADER);if(V.shaderSource(e,vr),V.compileShader(e),!V.getShaderParameter(e,V.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",V.getShaderInfoLog(e)),null;const t=V.createShader(V.FRAGMENT_SHADER);if(V.shaderSource(t,br),V.compileShader(t),!V.getShaderParameter(t,V.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",V.getShaderInfoLog(t)),null;if(pe=V.createProgram(),V.attachShader(pe,e),V.attachShader(pe,t),V.linkProgram(pe),!V.getProgramParameter(pe,V.LINK_STATUS))return console.error("[cairn] WebGL program link:",V.getProgramInfoLog(pe)),null;Be=V.createVertexArray(),V.bindVertexArray(Be);const r=V.createBuffer();V.bindBuffer(V.ARRAY_BUFFER,r),V.bufferData(V.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),V.STATIC_DRAW);const n=V.getAttribLocation(pe,"a_pos");return V.enableVertexAttribArray(n),V.vertexAttribPointer(n,2,V.FLOAT,!1,0,0),V.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),V}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function xt(e,t,r){const n=e.createTexture();return e.activeTexture(e.TEXTURE0+r),e.bindTexture(e.TEXTURE_2D,n),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),n}function wr(e,t,r){const n=new Uint8Array(1024);for(let i=0;i<256;i++)n[i*4]=t[i*3],n[i*4+1]=t[i*3+1],n[i*4+2]=t[i*3+2],n[i*4+3]=255;const a=e.createTexture();return e.activeTexture(e.TEXTURE0+r),e.bindTexture(e.TEXTURE_2D,a),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,n),a}function Er(e,t,r,n){const a=xr();if(!a||!pe||!Be||!Ce)return null;const i=Math.min(e.width,t.width),g=Math.min(e.height,t.height);Ce.width=i,Ce.height=g,a.viewport(0,0,i,g);const m=xt(a,e,0),w=xt(a,t,1);let h=null;r.colormap?h=wr(a,r.colormap,2):(h=a.createTexture(),a.activeTexture(a.TEXTURE2),a.bindTexture(a.TEXTURE_2D,h),a.texImage2D(a.TEXTURE_2D,0,a.RGBA8,1,1,0,a.RGBA,a.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),a.useProgram(pe),a.uniform1i(a.getUniformLocation(pe,"u_baseline"),0),a.uniform1i(a.getUniformLocation(pe,"u_other"),1),a.uniform1i(a.getUniformLocation(pe,"u_lut"),2),a.uniform1i(a.getUniformLocation(pe,"u_diff_mode"),gr[r.diffMode]),a.uniform1i(a.getUniformLocation(pe,"u_cmap_mode"),pr[r.cmapMode]??0),a.uniform1i(a.getUniformLocation(pe,"u_use_colormap"),r.colormap?1:0),a.bindVertexArray(Be),a.drawArrays(a.TRIANGLE_STRIP,0,4),a.bindVertexArray(null),n.width=i,n.height=g;const u=n.getContext("2d");return u&&(u.save(),u.scale(1,-1),u.drawImage(Ce,0,0,i,g,0,-g,i,g),u.restore()),a.deleteTexture(m),a.deleteTexture(w),a.deleteTexture(h),{width:i,height:g}}const _r={cardSettings:(e,t,r)=>`cairn:card-settings:${e}:${t}:${r}`,runLayout:e=>`cairn:run-layout:${e}`,collapsedSections:e=>`cairn:collapsed-sections:${e}`,comparisons:e=>`cairn:comparisons:${e}`,comparisonTemplates:e=>`cairn:comparison-templates:${e}`,reportTemplates:e=>`cairn:report-templates:${e}`,streamMode:"cairn:stream-mode",renderMode:"cairn:render-mode",scroll:e=>`cairn:scroll:${e}`,lastComparison:e=>`cairn:last-comparison:${e}`};function yr(){try{const e=localStorage.getItem(_r.renderMode);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const be=e=>e<0?0:e>1?1:e,Ke=e=>{const t=e<0?0:e;return t/(1+t)},je=e=>{const t=e<0?0:e,r=t*(2.51*t+.03),n=t*(2.43*t+.59)+.14;return be(r/n)},wt={linear:([e,t,r])=>[be(e),be(t),be(r)],srgb:([e,t,r])=>[be(e),be(t),be(r)],reinhard:([e,t,r])=>[Ke(e),Ke(t),Ke(r)],aces:([e,t,r])=>[je(e),je(t),je(r)],extended:([e,t,r])=>[e,t,r]},Tr="srgb";function Sr(e){return e&&wt[e]||wt[Tr]}function Ze(e,t){return e*2**t}function Rr(e){const t=be(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function Qe(e,t){return typeof t=="number"&&t>0?be(Math.pow(be(e),1/t)):Rr(e)}function Et(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Je({naturalWidth:e,naturalHeight:t,zoom:r=1,containerRef:n}){const a=Et(e),i=Et(t),g=[];for(let p=0;p<=e;p+=a)g.push(p);const m=[];for(let p=0;p<=t;p+=i)m.push(p);const w=1/r,h=8*w,u=-12*w,l=-2*w,E=n==null?void 0:n.current;let o=0,v=0,c=0,f=0;if(E){const p=E.clientWidth,T=E.clientHeight,y=p/e,S=T/t,G=Math.min(y,S);c=e*G,f=t*G,o=(p-c)/2,v=(T-f)/2}const x=E&&c>0;return d.jsxs(d.Fragment,{children:[d.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:x?v:0,transform:`translateY(${u}px)`,fontSize:h},children:g.map(p=>d.jsx("span",{className:"mono",style:{position:"absolute",left:x?o+p/e*c:`${p/e*100}%`,transform:"translateX(-50%)"},children:p},p))}),d.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:x?o:0,transform:`translateX(${l}px)`,fontSize:h},children:m.map(p=>d.jsx("span",{className:"mono",style:{position:"absolute",top:x?v+p/t*f:`${p/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*w}px`},children:p},p))})]})}function et({label:e,isDraggable:t,onDragStart:r}){return d.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:r,style:{cursor:t?"grab":void 0},children:[t&&d.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const _t=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function tt(e){const t=_t.length;return _t[(e%t+t)%t]}function Pr(e){const r=s.useRef(null),[n,a]=s.useState({w:0,h:0}),i=s.useRef(null),g=s.useRef(null);return s.useEffect(()=>{var h;const m=r.current;if(m===g.current||((h=i.current)==null||h.disconnect(),i.current=null,g.current=m,!m))return;const w=new ResizeObserver(u=>{for(const l of u)a({w:l.contentRect.width,h:l.contentRect.height})});i.current=w,w.observe(m)}),s.useEffect(()=>()=>{var m;return(m=i.current)==null?void 0:m.disconnect()},[]),{ref:r,size:n}}function Cr(){const[e,t]=s.useState(!1);return s.useEffect(()=>{const r=i=>{(i.key==="Alt"||i.key==="Control"||i.key==="Meta")&&t(!0)},n=i=>{(i.key==="Alt"||i.key==="Control"||i.key==="Meta")&&t(!1)},a=()=>t(!1);return window.addEventListener("keydown",r),window.addEventListener("keyup",n),window.addEventListener("blur",a),()=>{window.removeEventListener("keydown",r),window.removeEventListener("keyup",n),window.removeEventListener("blur",a)}},[]),e}const Ar=.25,Dr=16;function Me(e){const{containerRef:t,zoom:r,pan:n,onViewportChange:a,minZoom:i=Ar,maxZoom:g=Dr}=e,m=Cr(),w=s.useRef(m);w.current=m;const h=s.useRef({zoom:r,pan:n});h.current={zoom:r,pan:n};const u=s.useRef(a);u.current=a,s.useEffect(()=>{const f=t.current;if(!f||!a)return;const x=p=>{var C;if(!w.current)return;p.preventDefault(),p.stopPropagation();const T=p.deltaY<0?1.1:1/1.1,y=h.current,S=Math.max(i,Math.min(g,y.zoom*T));if(y.zoom===S)return;const G=f.getBoundingClientRect(),F=p.clientX-G.left,O=p.clientY-G.top,Y=F-(F-y.pan.x)/y.zoom*S,H=O-(O-y.pan.y)/y.zoom*S;(C=u.current)==null||C.call(u,{zoom:S,pan:{x:Y,y:H}})};return f.addEventListener("wheel",x,{passive:!1}),()=>f.removeEventListener("wheel",x)},[t,!!a,i,g]);const l=s.useRef(null),E=s.useCallback(f=>{!w.current||!u.current||(f.currentTarget.setPointerCapture(f.pointerId),l.current={pointerId:f.pointerId,startX:f.clientX,startY:f.clientY,panX:h.current.pan.x,panY:h.current.pan.y})},[]),o=s.useCallback(f=>{var y;const x=l.current;if(!x||x.pointerId!==f.pointerId)return;const p=f.clientX-x.startX,T=f.clientY-x.startY;(y=u.current)==null||y.call(u,{zoom:h.current.zoom,pan:{x:x.panX+p,y:x.panY+T}})},[]),v=s.useCallback(f=>{const x=l.current;if(!(!x||x.pointerId!==f.pointerId)){try{f.currentTarget.releasePointerCapture(f.pointerId)}catch{}l.current=null}},[]),c=m&&!!a;return{containerProps:{onPointerDown:E,onPointerMove:o,onPointerUp:v,onPointerCancel:v,style:{cursor:c?"move":void 0,touchAction:c?"none":void 0}},modifierActive:m}}function Mr(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function yt(e,t,r){return!(r.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function rt({data:e,settings:t,naturalWidth:r,naturalHeight:n}){const{ref:a,size:i}=Pr(),g=s.useRef(null),m=s.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),w=s.useMemo(()=>{const c=i.w,f=i.h;if(c<=0||f<=0||r<=0||n<=0)return null;const x=Math.min(c/r,f/n),p=r*x,T=n*x;return{left:(c-p)/2,top:(f-T)/2,width:p,height:T}},[i.w,i.h,r,n]),h=e.masks,u=t.showMasks&&!!h&&h.length>0,l=s.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(s.useEffect(()=>{if(!u||!h)return;const c=g.current;if(!c)return;(c.width!==r||c.height!==n)&&(c.width=r,c.height=n);const f=c.getContext("2d");if(!f)return;f.clearRect(0,0,c.width,c.height);let x=!1;const p=f.createImageData(r,n),T=p.data;let y=h.length,S=!1;const G=()=>{x||S&&f.putImageData(p,0,0)},F=document.createElement("canvas");F.width=r,F.height=n;const O=F.getContext("2d",{willReadFrequently:!0});for(const Y of h){const H=new Image;H.onload=()=>{if(!x){if(O){O.clearRect(0,0,r,n),O.drawImage(H,0,0,r,n);const C=O.getImageData(0,0,r,n).data;for(let A=0;A<r*n;A++){const U=C[A*4];if(U===0||m.has(U))continue;const[B,N,te]=Mr(tt(U));T[A*4]=B,T[A*4+1]=N,T[A*4+2]=te,T[A*4+3]=255,S=!0}}y-=1,y===0&&G()}},H.onerror=()=>{y-=1,y===0&&G()},H.src=`data:image/png;base64,${Y.png_b64}`}return()=>{x=!0}},[u,h,r,n,l]),!w)return d.jsx("div",{ref:a,className:"absolute inset-0 pointer-events-none"});const E=e.boxes??[],o=t.showBoxes&&E.length>0,v=e.class_labels??{};return d.jsxs("div",{ref:a,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[u&&d.jsx("canvas",{ref:g,className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),o&&d.jsx("svg",{className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height,overflow:"visible"},viewBox:`0 0 ${r} ${n}`,preserveAspectRatio:"none",children:E.map((c,f)=>{if(!yt(c,t,m))return null;const x=c.domain==="pixel"?1:r,p=c.domain==="pixel"?1:n,T=c.position.minX*x,y=c.position.minY*p,S=(c.position.maxX-c.position.minX)*x,G=(c.position.maxY-c.position.minY)*p;return d.jsx("rect",{x:T,y,width:S,height:G,fill:"none",stroke:tt(c.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},f)})}),o&&d.jsx("div",{className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height},children:E.map((c,f)=>{if(!yt(c,t,m))return null;const x=c.domain==="pixel"?1/r:1,p=c.domain==="pixel"?1/n:1,T=c.position.minX*x*100,y=c.position.minY*p*100,S=c.label??v[String(c.class_id)]??`#${c.class_id}`,G=c.score!=null?` ${(c.score*100).toFixed(0)}%`:"";return!S&&!G?null:d.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${T}%`,top:`${y}%`,transform:"translateY(-100%)",backgroundColor:tt(c.class_id)},children:d.jsxs("span",{className:"mono",children:[S,G]})},f)})})]})}const nt=30,se=["#ff5a5a","#39d353","#5b9bff"];function at(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function J(e,t,r){return t==="uint8"?r==="int"?String(Math.round(e)):at(e/255):at(r==="int"?e*255:e)}const Lr={x:0,y:0,w:1,h:1};function we({imageElRef:e,naturalWidth:t,naturalHeight:r,zoom:n,pan:a,sample:i,notation:g="decimal",version:m=0,onActiveChange:w,sourceWindow:h=Lr}){const u=s.useRef(null),l=s.useRef(!1),E=s.useRef(w);E.current=w;const o=s.useCallback(c=>{var f;c!==l.current&&(l.current=c,(f=E.current)==null||f.call(E,c))},[]),v=s.useCallback(()=>{var ie;const c=u.current,f=e.current;if(!c)return;const x=window.devicePixelRatio||1,p=c.clientWidth,T=c.clientHeight;if(p===0||T===0)return;c.width!==Math.round(p*x)&&(c.width=Math.round(p*x)),c.height!==Math.round(T*x)&&(c.height=Math.round(T*x));const y=c.getContext("2d");if(!y)return;if(y.setTransform(x,0,0,x,0,0),y.clearRect(0,0,p,T),!f||t<=0||r<=0){o(!1);return}const S=f.getBoundingClientRect(),G=c.getBoundingClientRect();if(S.width===0||S.height===0){o(!1);return}const F=h.x*t,O=h.y*r,Y=h.w*t,H=h.h*r;if(Y<=0||H<=0){o(!1);return}const C=Math.min(S.width/Y,S.height/H);if(C<nt){o(!1);return}const A=Y*C,U=H*C,B=S.left+(S.width-A)/2-G.left,N=S.top+(S.height-U)/2-G.top,te=Math.max(Math.floor(F),Math.floor(F+(0-B)/C)),re=Math.min(Math.ceil(F+Y),Math.ceil(F+(p-B)/C)),ee=Math.max(Math.floor(O),Math.floor(O+(0-N)/C)),ue=Math.min(Math.ceil(O+H),Math.ceil(O+(T-N)/C));if(re<=te||ue<=ee){o(!1);return}o(!0);const ce=B+(0-F)*C,de=N+(0-O)*C,me=B+(t-F)*C,ne=N+(r-O)*C;y.save(),y.beginPath(),y.rect(ce,de,me-ce,ne-de),y.clip(),y.textAlign="center",y.textBaseline="middle",y.lineJoin="round";const ve=C*.14,he=C-ve*2;for(let fe=ee;fe<ue;fe++)for(let ae=te;ae<re;ae++){if(ae<0||fe<0||ae>=t||fe>=r)continue;const le=i(ae,fe,g);if(!le||le.lines.length===0)continue;const j=le.lines.length;let b=1;for(const L of le.lines)L.length>b&&(b=L.length);const R=he/(j*1.15),P=he/(b*.62)||R,_=Math.min(R,P,24);if(_<6)continue;const D=B+(ae-F+.5)*C,M=N+(fe-O+.5)*C,I=_*1.15,q=le.luminance<=.55,X=q?"#ffffff":"#000000";y.font=`${_}px ui-monospace, SFMono-Regular, Menlo, monospace`,y.lineWidth=Math.max(1.4,_*.16),y.strokeStyle=q?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let Z=M-j*I/2+I/2;for(let L=0;L<le.lines.length;L++){const W=le.lines[L];y.strokeText(W,D,Z),y.fillStyle=((ie=le.colors)==null?void 0:ie[L])??X,y.fillText(W,D,Z),Z+=I}}y.restore()},[e,t,r,i,g,o,h]);return s.useEffect(()=>{v()},[v,n,a.x,a.y,m,g,h]),s.useEffect(()=>{const c=u.current;if(!c)return;const f=new ResizeObserver(()=>v());return f.observe(c),()=>f.disconnect()},[v]),d.jsx("canvas",{ref:u,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Le({notation:e,onChange:t,className:r=""}){return d.jsx("button",{type:"button",onClick:n=>{n.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:n=>n.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${r}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const Ur=`
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
`,Ir=`#pragma vertex
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
`,Fr=`
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
`,Gr=`#pragma vertex
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
`,ke={linear:0,srgb:1,reinhard:2,aces:3,extended:4},Tt=new WeakMap;function Or(e,t){let r=Tt.get(e);r||(r=new Map,Tt.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:Ur,shaderGLSL:Ir,targetFormat:t}),r.set(t,n)),n}function St(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Rt(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function Br(e,t,r,n){var v;const a=St(t),i=Or(e,a),g=Rt(e,n.isScalar?n.colormap:void 0),m=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,w=ke[n.operator]??ke.srgb,h=new Float32Array([n.exposureEV,w,m,n.isScalar?1:0]),u=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),l=new Float32Array([n.hdrOut?1:0]),E=new Float32Array([n.filter==="nearest"?0:1]);let o;try{o=e.createBindGroup(i,[{binding:0,resource:r},{binding:1,resource:g},{binding:2,resource:{uniform:h}},{binding:3,resource:{uniform:u}},{binding:4,resource:{uniform:l}},{binding:5,resource:{uniform:E}}]),e.renderFullscreen(t,i,o)}finally{(v=o==null?void 0:o.destroy)==null||v.call(o),g.destroy()}}const kr={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Vr={linear:0,signed:1,positive:2},Nr={split:0,blend:1,diff:2},Pt=new WeakMap;function Xr(e,t){let r=Pt.get(e);r||(r=new Map,Pt.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:Fr,shaderGLSL:Gr,targetFormat:t}),r.set(t,n)),n}function Wr(e,t,r,n,a){var p;const i=St(t),g=Xr(e,i),m=a.mode==="diff"&&!!a.diffColormap,w=a.isScalar?a.colormap:m?a.diffColormap:void 0,h=Rt(e,w),u=typeof a.gamma=="number"&&a.gamma>0?a.gamma:0,l=ke[a.operator]??ke.srgb,E=new Float32Array([a.exposureEV,l,u,a.isScalar?1:0]),o=new Float32Array([a.uv.x,a.uv.y,a.uv.w,a.uv.h]),v=new Float32Array([Nr[a.mode],a.split,a.alpha,kr[a.diffSubmode]??0]),c=new Float32Array([Vr[a.diffCmapMode??"linear"]??0,a.hdrOut?1:0,m?1:0,0]),f=new Float32Array([a.filter==="nearest"?0:1]);let x;try{x=e.createBindGroup(g,[{binding:0,resource:r},{binding:1,resource:n},{binding:2,resource:h},{binding:3,resource:{uniform:E}},{binding:4,resource:{uniform:o}},{binding:5,resource:{uniform:v}},{binding:6,resource:{uniform:c}},{binding:7,resource:{uniform:f}}]),e.renderFullscreen(t,g,x)}finally{(p=x==null?void 0:x.destroy)==null||p.call(x),h.destroy()}}function Ct(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,a=t/r,i=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:i,mae:a}}async function $r(e,t,r){const n=Math.min(t.width,r.width),a=Math.min(t.height,r.height),i=n*a*3;if(i<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:E,sumAbs:o}=await e.reduceDiffSumSquaredAbs(t,r,n,a);return Ct(E,o,i)}const g=await e.readback(t),m=await e.readback(r),w=g instanceof Uint8Array,h=m instanceof Uint8Array;let u=0,l=0;for(let E=0;E<a;E++)for(let o=0;o<n;o++){const v=(E*t.width+o)*4,c=(E*r.width+o)*4;for(let f=0;f<3;f++){const x=(g[v+f]??0)/(w?255:1),p=(m[c+f]??0)/(h?255:1),T=x-p;u+=T*T,l+=Math.abs(T)}}return Ct(u,l,i)}function At(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const zr=12,ye=[];function Dt(e){const t=ye.indexOf(e);t!==-1&&ye.splice(t,1),ye.push(e)}function Yr(e){const t=ye.indexOf(e);t!==-1&&ye.splice(t,1)}function Ue(e){e.parked||(Yr(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.device&&e.device!==e.sharedDevice&&e.device.destroy(),e.device=null,e.parked=!0)}function Mt(e){for(;ye.length>zr;){const t=ye.find(r=>r!==e&&!r.visible)??ye.find(r=>r!==e);if(!t)break;Ue(t)}}function Lt(e){if(e.disposed)return;if(At())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Dt(e),Mt(e);return}const t=e.sharedDevice.backend==="webgl2"?Ve():e.sharedDevice;if(e.device=t,e.surface=t.createSurface(e.canvas,{hdr:e.hdr}),e.source){e.canvas.width=e.source.width,e.canvas.height=e.source.height,e.surface.configure(e.source.width,e.source.height);const r=t.createTexture(e.source.width,e.source.height,e.source.format);r.write(e.source.data),e.srcTexture=r}e.parked=!1,Dt(e),Mt(e)}const Hr=30;function Ut(e,t){var r;if(e.disposed||!e.source)return!0;try{return Lt(e),!e.device||!e.surface||!e.srcTexture?!1:e.device.isContextLost()?(It(e,t),!0):(Br(e.device,e.surface,e.srcTexture,t),e.restoreRetries=0,!0)}catch(n){return(r=e.device)!=null&&r.isContextLost()?(It(e,t),!0):(console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Ue(e),!1)}}function It(e,t){if(!e.disposed){if(e.restoreRetries>=Hr){e.restoreRetries=0;return}e.restoreRetries++,Ue(e),requestAnimationFrame(()=>Ut(e,t))}}function qr(e){return{canvas:e.canvas,backend:e.sharedDevice.backend,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.device&&e.surface)){e.canvas.width=t.width,e.canvas.height=t.height,e.surface.configure(t.width,t.height),e.srcTexture&&e.srcTexture.destroy();const r=e.device.createTexture(t.width,t.height,t.format);r.write(t.data),e.srcTexture=r}},render(t){return Ut(e,t)},park(){e.disposed||Ue(e)},restore(){e.disposed||!e.source||Lt(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Ue(e),e.source=null,e.disposed=!0)}}}async function Kr(e,t){const r=await Oe(),n={canvas:e,sharedDevice:r,device:null,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,restoreRetries:0};return qr(n)}function Ft(e){e.dispose()}function jr(e,t){const{brightness:r,contrast:n,exposure:a,flipSign:i}=e;return[`url(#${t})`,`brightness(${(1+r)*Math.pow(2,a)})`,`contrast(${1+n})`,...i?["invert(1)"]:[]].join(" ")}function Gt(e){const r=`cairn-gamma-${s.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:n,contrast:a,gamma:i,exposure:g,offset:m,flipSign:w}=e,h=s.useMemo(()=>jr(e,r),[r,n,a,g,w]);return{gammaFilterId:r,filterStr:h,gamma:i,offset:m}}function Ot({id:e,gamma:t,offset:r}){return d.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:d.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:d.jsxs("feComponentTransfer",{children:[d.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:r}),d.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:r}),d.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:r})]})})})}const Zr={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function Bt({imageUrl:e,baselineUrl:t,isBaseline:r=!1,diffMode:n,interpolation:a,colormap:i,showAxes:g,processing:m=Zr,zoom:w=1,pan:h={x:0,y:0},onViewportChange:u,onNaturalSize:l,label:E,isDraggable:o=!1,onDragStart:v,overlay:c,overlaySettings:f,pixelValueNotation:x="decimal"}){var X,Z;const p=s.useRef(null),T=s.useRef(null),y=s.useRef(null),S=s.useRef(null),G=s.useRef(null),F=s.useRef(null),O=s.useRef(null),[Y,H]=s.useState(0),C=s.useCallback(()=>H(L=>L+1),[]),[A,U]=s.useState(x),[B,N]=s.useState(!1),te=s.useCallback(L=>{p.current=L,L&&(G.current=L)},[]),re=s.useCallback(L=>{T.current=L,L&&(G.current=L)},[]),ee=s.useCallback(L=>{L&&(G.current=L)},[]),[ue,ce]=s.useState(!1),[de,me]=s.useState(!1),[ne,ve]=s.useState(null),{flipSign:he}=m,{gammaFilterId:ie,filterStr:fe,gamma:ae,offset:le}=Gt(m),j=`translate(${h.x}px, ${h.y}px) scale(${w})`,{containerProps:b}=Me({containerRef:S,zoom:w,pan:h,onViewportChange:u}),R=!r&&n!=="none"&&t!=null&&e!=null,P=n!=="none"&&t!=null,_=i!=="none"&&!R&&!(r&&P)&&e!=null;s.useEffect(()=>{if(!_||!e){me(!1);return}let L=!1;me(!1);const W=`${e}::${i}`,$=He(W);if($){const z=T.current;if(z){z.width=$.width,z.height=$.height;const Q=z.getContext("2d");Q&&Q.putImageData($,0,0),O.current=$,C(),ve({w:$.width,h:$.height}),l==null||l($.width,$.height),me(!0)}return}const K=new Image;return K.onload=()=>{if(L)return;const z=document.createElement("canvas");z.width=K.naturalWidth,z.height=K.naturalHeight;const Q=z.getContext("2d");if(!Q)return;Q.drawImage(K,0,0);const xe=Q.getImageData(0,0,z.width,z.height),Re=ht.has(i)?"positive":"linear",oe=Ye(xe,i,Re);qe(W,oe);const Ee=T.current;if(!Ee||L)return;Ee.width=oe.width,Ee.height=oe.height;const ge=Ee.getContext("2d");ge&&ge.putImageData(oe,0,0),O.current=oe,C(),ve({w:oe.width,h:oe.height}),l==null||l(oe.width,oe.height),me(!0)},K.src=e,()=>{L=!0}},[_,e,i]);const D=s.useCallback((L,W)=>{ve($=>$&&$.w===L&&$.h===W?$:{w:L,h:W}),l==null||l(L,W)},[]);s.useEffect(()=>{if(!e){F.current=null,O.current=null,C();return}let L=!1;return Pe(e).then(W=>{L||(F.current=W,i==="none"&&(O.current=W),C())}),()=>{L=!0}},[e,i,C]);const M=s.useCallback((L,W,$)=>{const K=F.current;if(!K||L<0||W<0||L>=K.width||W>=K.height)return null;const z=(W*K.width+L)*4,Q=K.data[z],xe=K.data[z+1],Re=K.data[z+2],oe=O.current;let Ee=Q,ge=xe,_e=Re;if(oe&&oe.width===K.width&&oe.height===K.height){const Ae=(W*oe.width+L)*4;Ee=oe.data[Ae],ge=oe.data[Ae+1],_e=oe.data[Ae+2]}const Ie=(.299*Ee+.587*ge+.114*_e)/255;return i!=="none"||Q===xe&&xe===Re?{lines:[J(Q,"uint8",$)],luminance:Ie}:{lines:[J(Q,"uint8",$),J(xe,"uint8",$),J(Re,"uint8",$)],luminance:Ie,colors:[se[0],se[1],se[2]]}},[i]);s.useEffect(()=>{if(!R){ce(!1);return}let L=!1;const W=yr(),$=W==="gpu"||W==="auto",K=`${t}::${e}::${n}::${i}`;if(W!=="gpu"){const z=He(K);if(z){const Q=p.current;if(Q){(Q.width!==z.width||Q.height!==z.height)&&(Q.width=z.width,Q.height=z.height);const xe=Q.getContext("2d");xe&&xe.putImageData(z,0,0),D(z.width,z.height),ce(!0)}return}}return(async()=>{const[z,Q]=await Promise.all([Pe(t),Pe(e)]);if(L||!z||!Q)return;const Re=n.includes("signed")?"signed":"positive",oe=i!=="none"?ze(i):null,Ee={diffMode:n,colormap:oe,cmapMode:Re};if($)try{const Fe=p.current;if(Fe){const Ae=Er(z,Q,Ee,Fe);if(Ae){if(L)return;D(Ae.width,Ae.height),ce(!0);return}}}catch(Fe){console.warn("[cairn] WebGL 2 diff error:",Fe)}if(W==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let ge=hr(z,Q,n);i!=="none"&&(ge=Ye(ge,i,Re)),qe(K,ge);const _e=p.current;if(!_e||L)return;(_e.width!==ge.width||_e.height!==ge.height)&&(_e.width=ge.width,_e.height=ge.height);const Ie=_e.getContext("2d");Ie&&Ie.putImageData(ge,0,0),D(ge.width,ge.height),ce(!0)})(),()=>{L=!0}},[t,e,n,R,i,l]);const I=a==="auto"?void 0:a,q=he?{filter:"invert(1)"}:{};return d.jsxs("div",{className:"relative flex flex-col h-full",children:[d.jsx(Ot,{id:ie,gamma:ae,offset:le}),d.jsxs("div",{ref:S,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:g&&ne?"16px 4px 4px 28px":"4px",...b.style},onPointerDown:b.onPointerDown,onPointerMove:b.onPointerMove,onPointerUp:b.onPointerUp,onPointerCancel:b.onPointerCancel,children:[d.jsxs("div",{ref:y,className:"relative w-full h-full",style:{transform:j,transformOrigin:"0 0"},children:[e?R?d.jsxs(d.Fragment,{children:[!ue&&d.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),d.jsx("canvas",{ref:te,className:"w-full h-full object-contain block",style:{display:ue?"block":"none",imageRendering:I,...q}})]}):_?d.jsxs(d.Fragment,{children:[!de&&d.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),d.jsx("canvas",{ref:re,className:"w-full h-full object-contain block",style:{display:de?"block":"none",imageRendering:I,...q}})]}):d.jsx("img",{ref:ee,src:e,alt:E,className:"w-full h-full object-contain block",draggable:!1,style:{filter:fe,imageRendering:I},onLoad:L=>{const W=L.currentTarget;ve({w:W.naturalWidth,h:W.naturalHeight}),l==null||l(W.naturalWidth,W.naturalHeight)}}):d.jsx("span",{className:"text-xs text-fg-muted",children:"no image"}),g&&ne&&d.jsx(Je,{naturalWidth:ne.w,naturalHeight:ne.h,zoom:w,containerRef:y}),c&&(f==null?void 0:f.enabled)&&ne&&e&&((((X=c.boxes)==null?void 0:X.length)??0)>0||(((Z=c.masks)==null?void 0:Z.length)??0)>0)&&d.jsx(rt,{data:c,settings:f,naturalWidth:ne.w,naturalHeight:ne.h})]}),e&&ne&&d.jsx(we,{imageElRef:G,naturalWidth:ne.w,naturalHeight:ne.h,zoom:w,pan:h,sample:M,notation:A,version:Y,onActiveChange:N}),B&&d.jsx(Le,{notation:A,onChange:U})]}),d.jsx(et,{label:E,isDraggable:o,onDragStart:v})]})}function Qr(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`HdrImagePane: unsupported shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}const Te=e=>Number.isFinite(e)?e:0;function Jr(e,t,r,n){const{h:a,w:i,c:g}=Qr(e.shape),m=e.data,w=Sr(t),h=new Uint8ClampedArray(i*a*4);for(let u=0;u<i*a;u++){const l=u*g;let E,o,v,c=1;g===1?E=o=v=Te(m[l]):g===3?(E=Te(m[l]),o=Te(m[l+1]),v=Te(m[l+2])):(E=Te(m[l]),o=Te(m[l+1]),v=Te(m[l+2]),c=Te(m[l+3]));const f=[Ze(E,r),Ze(o,r),Ze(v,r)],[x,p,T]=w(f),y=u*4;h[y]=255*Qe(x,n),h[y+1]=255*Qe(p,n),h[y+2]=255*Qe(T,n),h[y+3]=255*(c<0?0:c>1?1:c)}return new ImageData(h,i,a)}function en({hdr:e,tonemap:t="srgb",exposure:r=0,gamma:n,showAxes:a=!1,label:i="",interpolation:g="auto",zoom:m=1,pan:w={x:0,y:0},onViewportChange:h,pixelValueNotation:u="decimal"}){const l=s.useRef(null),E=s.useRef(null),o=s.useRef(null),[v,c]=s.useState(null),f=s.useRef(null),[x,p]=s.useState(0),[T,y]=s.useState(u),[S,G]=s.useState(!1);s.useEffect(()=>{const C=l.current;if(!C)return;let A;try{A=Jr(e,t,r,n)}catch(B){console.error("[cairn] HDR tone-map error:",B);return}(C.width!==A.width||C.height!==A.height)&&(C.width=A.width,C.height=A.height);const U=C.getContext("2d");U&&(U.putImageData(A,0,0),f.current=A,p(B=>B+1),c(B=>B&&B.w===A.width&&B.h===A.height?B:{w:A.width,h:A.height}))},[e,t,r,n]);const{containerProps:F}=Me({containerRef:o,zoom:m,pan:w,onViewportChange:h}),O=s.useCallback((C,A,U)=>{const B=v;if(!B||C<0||A<0||C>=B.w||A>=B.h)return null;const N=e.shape.length===2?1:e.shape[2]??1,te=(A*B.w+C)*N,re=e.data,ee=f.current;let ue=.5;if(ee&&ee.width===B.w&&ee.height===B.h){const ce=(A*B.w+C)*4;ue=(.299*ee.data[ce]+.587*ee.data[ce+1]+.114*ee.data[ce+2])/255}return N===1?{lines:[J(re[te]??0,"unit",U)],luminance:ue}:{lines:[J(re[te]??0,"unit",U),J(re[te+1]??0,"unit",U),J(re[te+2]??0,"unit",U)],luminance:ue,colors:[se[0],se[1],se[2]]}},[e,v]),Y=g==="auto"?void 0:g,H=`translate(${w.x}px, ${w.y}px) scale(${m})`;return d.jsxs("div",{className:"relative flex flex-col h-full",children:[d.jsxs("div",{ref:o,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:a&&v?"16px 4px 4px 28px":"4px",...F.style},onPointerDown:F.onPointerDown,onPointerMove:F.onPointerMove,onPointerUp:F.onPointerUp,onPointerCancel:F.onPointerCancel,children:[d.jsxs("div",{ref:E,className:"relative w-full h-full",style:{transform:H,transformOrigin:"0 0"},children:[d.jsx("canvas",{ref:l,className:"w-full h-full object-contain block",style:{imageRendering:Y}}),a&&v&&d.jsx(Je,{naturalWidth:v.w,naturalHeight:v.h,zoom:m,containerRef:E})]}),v&&d.jsx(we,{imageElRef:l,naturalWidth:v.w,naturalHeight:v.h,zoom:m,pan:w,sample:O,notation:T,version:x,onActiveChange:G}),S&&d.jsx(Le,{notation:T,onChange:y})]}),i?d.jsx(et,{label:i}):null]})}function tn(e){return"hdr"in e&&e.hdr!=null}const rn=["linear","srgb","reinhard","aces"];function nn(e){return e&&rn.includes(e)?e:"srgb"}const Se=e=>Number.isFinite(e)?e:0;function an(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function on(e){const{h:t,w:r,c:n}=an(e.shape),a=e.data,i=new Float32Array(r*t*4);for(let g=0;g<r*t;g++){const m=g*n;let w,h,u,l=1;n===1?w=h=u=Se(a[m]):n===3?(w=Se(a[m]),h=Se(a[m+1]),u=Se(a[m+2])):(w=Se(a[m]),h=Se(a[m+1]),u=Se(a[m+2]),l=Se(a[m+3]));const E=g*4;i[E]=w,i[E+1]=h,i[E+2]=u,i[E+3]=l}return{data:i,width:r,height:t,format:"rgba32float"}}function kt(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const a=Math.min(t.width/r,t.height/n),i=r*a,g=n*a,m=(t.width-i)/2,w=(t.height-g)/2,h=Math.max(e.zoom,1e-6),u=1/h,l=1/h,E=(m*(1-h)-e.pan.x)/(i*h),o=(w*(1-h)-e.pan.y)/(g*h);return{x:E,y:o,w:u,h:l}}function Vt(e,t,r,n){const a=e.w*r,i=e.h*n;return a<=0||i<=0||t.width<=0||t.height<=0?0:Math.min(t.width/a,t.height/i)}const sn={zoom:1,pan:{x:0,y:0}};function cn(e){var le,j;const t=tn(e),r=s.useRef(null),n=s.useRef(null),a=s.useRef(null),i=s.useRef(null),g=s.useRef(!1),[m,w]=s.useState(!1),[h,u]=s.useState(!1),[l,E]=s.useState(null),[o,v]=s.useState(0),[c,f]=s.useState(0),[x,p]=s.useState({x:0,y:0,w:1,h:1}),T=s.useRef(null),y=s.useRef(null),[S,G]=s.useState(0),[F,O]=s.useState(e.pixelValueNotation??"decimal"),[Y,H]=s.useState(!1),C=e.zoom??1,A=e.pan??{x:0,y:0},U=e.onViewportChange,B=t?"none":e.colormap??"none";s.useEffect(()=>{const b=r.current;if(!b)return;let R=!1;return Oe().then(P=>{if(R)return;const _=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,D=P.backend==="webgpu"&&P.capabilities.hdr&&_&&t;g.current=D,Kr(b,{hdr:D}).then(M=>{if(R){Ft(M);return}i.current=M,u(!0)}).catch(M=>{R||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",M),w(!0))})}).catch(P=>{R||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",P),w(!0))}),()=>{R=!0,i.current&&(Ft(i.current),i.current=null)}},[]);const{containerProps:N}=Me({containerRef:n,zoom:C,pan:A,onViewportChange:U}),te=s.useCallback(()=>{U==null||U(sn)},[U]);s.useEffect(()=>{const b=n.current;if(!b)return;const R=new ResizeObserver(()=>f(P=>P+1));return R.observe(b),()=>R.disconnect()},[]),s.useEffect(()=>{const b=n.current;if(!b)return;const R=new IntersectionObserver(P=>{const _=P[0];if(!_)return;const D=i.current;D&&(D.setVisible(_.isIntersecting),_.isIntersecting?D.isParked&&(D.restore(),f(M=>M+1)):D.park())},{threshold:0});return R.observe(b),()=>R.disconnect()},[]),s.useEffect(()=>{var P;if(!t||!h)return;const b=e.hdr;T.current=b;const R=on(b);(P=i.current)==null||P.setSource(R),E(_=>_&&_.w===R.width&&_.h===R.height?_:{w:R.width,h:R.height}),G(_=>_+1),v(_=>_+1)},[t,h,t?e.hdr:null]),s.useEffect(()=>{if(t||!h)return;const b=e,R=b.imageUrl,P=b.colormap??"none";if(!R){y.current=null,E(null),G(D=>D+1);return}let _=!1;return Pe(R).then(D=>{var q,X;if(_||!D)return;let M=D;if(P!=="none"){const Z=`gpu::${R}::${P}`,L=He(Z);if(L)M=L;else{const W=ht.has(P)?"positive":"linear";M=Ye(D,P,W),qe(Z,M)}}y.current=D;const I={data:M.data,width:M.width,height:M.height,format:"rgba8unorm"};(q=i.current)==null||q.setSource(I),E(Z=>Z&&Z.w===M.width&&Z.h===M.height?Z:{w:M.width,h:M.height}),(X=b.onNaturalSize)==null||X.call(b,M.width,M.height),G(Z=>Z+1),v(Z=>Z+1)}),()=>{_=!0}},[t,h,t?null:e.imageUrl,t?null:e.colormap]);const re=t?e.exposure??0:0,ee=t?e.tonemap:void 0,ue=t?e.gamma:void 0;s.useEffect(()=>{const b=i.current;if(!b||!h||!l)return;const R=n.current,P=R?R.getBoundingClientRect():{width:l.w,height:l.h},_=kt({zoom:C,pan:A},P,l.w,l.h);p(X=>X.x===_.x&&X.y===_.y&&X.w===_.w&&X.h===_.h?X:_);const D=r.current?r.current.getBoundingClientRect():P,M=Vt(_,D,l.w,l.h)>=nt?"nearest":"linear";let I=_;b.backend==="webgl2"&&(I={x:I.x,y:I.y+I.h,w:I.w,h:-I.h});const q=t?{exposureEV:re,operator:g.current?"extended":nn(ee),gamma:ue,isScalar:!1,hdrOut:g.current,uv:I,filter:M}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:I,filter:M};try{b.render(q)||w(!0)}catch(X){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",X),w(!0)}},[h,l,o,C,A.x,A.y,re,ee,ue,c,t]);const ce=s.useCallback((b,R,P)=>{if(t){const L=T.current,W=l;if(!L||!W||b<0||R<0||b>=W.w||R>=W.h)return null;const $=L.shape.length===2?1:L.shape[2]??1,K=(R*W.w+b)*$,z=L.data,Q=.5;return $===1?{lines:[J(z[K]??0,"unit",P)],luminance:Q}:{lines:[J(z[K]??0,"unit",P),J(z[K+1]??0,"unit",P),J(z[K+2]??0,"unit",P)],luminance:Q,colors:[se[0],se[1],se[2]]}}const _=y.current;if(!_||b<0||R<0||b>=_.width||R>=_.height)return null;const D=(R*_.width+b)*4,M=_.data[D],I=_.data[D+1],q=_.data[D+2],X=(.299*M+.587*I+.114*q)/255;return B!=="none"||M===I&&I===q?{lines:[J(M,"uint8",P)],luminance:X}:{lines:[J(M,"uint8",P),J(I,"uint8",P),J(q,"uint8",P)],luminance:X,colors:[se[0],se[1],se[2]]}},[t,l,B]),de=e.showAxes??!1,me=t?e.label??"":e.label,ne=e.interpolation??"auto",ve=ne==="auto"?void 0:ne,he=t?void 0:e.overlay,ie=t?void 0:e.overlaySettings,fe=t?!1:e.isDraggable??!1,ae=t?void 0:e.onDragStart;return m?t?d.jsx(en,{hdr:e.hdr,tonemap:e.tonemap,exposure:e.exposure,gamma:e.gamma,showAxes:de,label:me,interpolation:ne,zoom:e.zoom,pan:e.pan,onViewportChange:U,pixelValueNotation:e.pixelValueNotation}):d.jsx(Bt,{imageUrl:e.imageUrl,baselineUrl:e.baselineUrl??null,isBaseline:e.isBaseline,diffMode:e.diffMode??"none",interpolation:ne,colormap:B,showAxes:de,processing:e.processing,zoom:e.zoom,pan:e.pan,onViewportChange:U,onNaturalSize:e.onNaturalSize,label:me,isDraggable:fe,onDragStart:ae,className:e.className,overlay:he,overlaySettings:ie,pixelValueNotation:e.pixelValueNotation}):d.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":h,children:[d.jsxs("div",{ref:n,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:de&&l?"16px 4px 4px 28px":"4px",...N.style},onPointerDown:N.onPointerDown,onPointerMove:N.onPointerMove,onPointerUp:N.onPointerUp,onPointerCancel:N.onPointerCancel,onDoubleClick:te,"data-gpu-image-viewport":!0,children:[d.jsxs("div",{ref:a,className:"relative w-full h-full",children:[d.jsx("canvas",{ref:r,className:"w-full h-full object-contain block",style:{imageRendering:ve},"data-gpu-image-canvas":!0}),de&&l&&d.jsx(Je,{naturalWidth:l.w,naturalHeight:l.h,zoom:C,containerRef:a}),he&&(ie==null?void 0:ie.enabled)&&l&&((((le=he.boxes)==null?void 0:le.length)??0)>0||(((j=he.masks)==null?void 0:j.length)??0)>0)&&d.jsx(rt,{data:he,settings:ie,naturalWidth:l.w,naturalHeight:l.h})]}),l&&d.jsx(we,{imageElRef:r,naturalWidth:l.w,naturalHeight:l.h,zoom:C,pan:A,sourceWindow:x,sample:ce,notation:F,version:S,onActiveChange:H}),Y&&d.jsx(Le,{notation:F,onChange:O})]}),me?d.jsx(et,{label:me,isDraggable:fe,onDragStart:ae}):null]})}const ln={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function un({imageUrl:e,baselineUrl:t,mode:r,splitPosition:n,blendAlpha:a,onSplitPositionChange:i,zoom:g,pan:m,onViewportChange:w,processing:h=ln,interpolation:u="auto",label:l="",isDraggable:E=!1,onDragStart:o,overlay:v,overlaySettings:c,pixelValueNotation:f="decimal"}){var ae,le;const x=s.useRef(null),[p,T]=s.useState(null),[y,S]=s.useState(null),[G,F]=s.useState(f),[O,Y]=s.useState(!1),H=s.useRef(null),C=s.useRef(null),A=s.useRef(null),U=s.useRef(null),[B,N]=s.useState(0);s.useEffect(()=>{if(!e){A.current=null,N(b=>b+1);return}let j=!1;return Pe(e).then(b=>{j||(A.current=b,N(R=>R+1))}),()=>{j=!0}},[e]),s.useEffect(()=>{if(!t){U.current=null,N(b=>b+1);return}let j=!1;return Pe(t).then(b=>{j||(U.current=b,N(R=>R+1))}),()=>{j=!0}},[t]);const te=j=>(b,R,P)=>{const _=j.current;if(!_||b<0||R<0||b>=_.width||R>=_.height)return null;const D=(R*_.width+b)*4,M=_.data[D],I=_.data[D+1],q=_.data[D+2],X=(.299*M+.587*I+.114*q)/255;return M===I&&I===q?{lines:[J(M,"uint8",P)],luminance:X}:{lines:[J(M,"uint8",P),J(I,"uint8",P),J(q,"uint8",P)],luminance:X,colors:[se[0],se[1],se[2]]}},re=s.useMemo(()=>te(A),[]),ee=s.useMemo(()=>te(U),[]),ue=!!v&&!!(c!=null&&c.enabled)&&!!p&&!!e&&((((ae=v.boxes)==null?void 0:ae.length)??0)>0||(((le=v.masks)==null?void 0:le.length)??0)>0),{gammaFilterId:ce,filterStr:de,gamma:me,offset:ne}=Gt(h),ve=`translate(${m.x}px, ${m.y}px) scale(${g})`,he=u==="auto"?void 0:u,{containerProps:ie,modifierActive:fe}=Me({containerRef:x,zoom:g,pan:m,onViewportChange:w});return d.jsxs("div",{className:"relative flex flex-col h-full",children:[d.jsx(Ot,{id:ce,gamma:me,offset:ne}),d.jsxs("div",{ref:x,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...ie.style},onPointerDown:ie.onPointerDown,onPointerMove:ie.onPointerMove,onPointerUp:ie.onPointerUp,onPointerCancel:ie.onPointerCancel,children:[d.jsxs("div",{className:"relative w-full h-full",children:[d.jsxs("div",{className:"relative w-full h-full",style:{transform:ve,transformOrigin:"0 0"},children:[d.jsx("img",{ref:H,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:de,imageRendering:he,...r==="blend"?{opacity:a}:{}},onLoad:j=>{const b=j.currentTarget;T({w:b.naturalWidth,h:b.naturalHeight})}}),ue&&d.jsx(rt,{data:v,settings:c,naturalWidth:p.w,naturalHeight:p.h})]}),d.jsx("div",{className:"absolute inset-0 overflow-hidden",style:r==="split"?{clipPath:`inset(0 ${(1-n)*100}% 0 0)`}:void 0,children:d.jsx("div",{className:"w-full h-full",style:{transform:ve,transformOrigin:"0 0"},children:d.jsx("img",{ref:C,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:de,imageRendering:he,...r==="blend"?{opacity:1-a}:{}},onLoad:j=>{const b=j.currentTarget;S({w:b.naturalWidth,h:b.naturalHeight})}})})}),r==="split"&&d.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${n*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>i==null?void 0:i(.5),onPointerDown:j=>{j.stopPropagation(),j.preventDefault();const R=j.currentTarget.parentElement.getBoundingClientRect(),P=D=>{i==null||i(Math.max(0,Math.min(1,(D.clientX-R.left)/R.width)))},_=()=>{window.removeEventListener("pointermove",P),window.removeEventListener("pointerup",_)};window.addEventListener("pointermove",P),window.addEventListener("pointerup",_)},children:d.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),r==="split"?d.jsxs(d.Fragment,{children:[t&&y&&d.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-n)*100}% 0 0)`},children:d.jsx(we,{imageElRef:C,naturalWidth:y.w,naturalHeight:y.h,zoom:g,pan:m,sample:ee,notation:G,version:B})}),e&&p&&d.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${n*100}%)`},children:d.jsx(we,{imageElRef:H,naturalWidth:p.w,naturalHeight:p.h,zoom:g,pan:m,sample:re,notation:G,version:B,onActiveChange:Y})})]}):e&&p&&d.jsx(we,{imageElRef:H,naturalWidth:p.w,naturalHeight:p.h,zoom:g,pan:m,sample:re,notation:G,version:B,onActiveChange:Y}),O&&d.jsx(Le,{notation:G,onChange:F})]}),d.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),d.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${E&&!fe?" cairn-drag-grip":""}`,draggable:E&&!fe,onDragStart:o,style:{cursor:E&&!fe?"grab":void 0},children:[d.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),l]})]})}const dn={zoom:1,pan:{x:0,y:0}};function fn(e){const t=ze(e),r=new Float32Array(256*4);for(let n=0;n<256;n++)r[n*4+0]=t[n*3+0]/255,r[n*4+1]=t[n*3+1]/255,r[n*4+2]=t[n*3+2]/255,r[n*4+3]=1;return r}function mn({imageUrl:e,baselineUrl:t,mode:r,splitPosition:n,blendAlpha:a,onSplitPositionChange:i,diffSubmode:g,colormap:m="none",zoom:w,pan:h,onViewportChange:u,interpolation:l="auto",label:E="",pixelValueNotation:o="decimal"}){const v=s.useRef(null),c=s.useRef(null),f=s.useRef(null),[x,p]=s.useState(!1),[T,y]=s.useState(!1),[S,G]=s.useState(null),[F,O]=s.useState(0),[Y,H]=s.useState(0),[C,A]=s.useState(null),[U,B]=s.useState(o),[N,te]=s.useState(!1),[re,ee]=s.useState({x:0,y:0,w:1,h:1}),ue=s.useRef(null),ce=s.useRef(null),[de,me]=s.useState(0);s.useEffect(()=>{const b=c.current;if(!b)return;let R=!1;return Oe().then(P=>{if(!R)try{if(At())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const _=P.backend==="webgl2",D=_?Ve():P,M=D.createSurface(b,{hdr:!1});f.current={device:D,ownsDevice:_,surface:M,texA:null,texB:null},y(!0)}catch(_){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",_),p(!0)}}).catch(P=>{R||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",P),p(!0))}),()=>{var _,D;R=!0;const P=f.current;P&&((_=P.texA)==null||_.destroy(),(D=P.texB)==null||D.destroy(),P.ownsDevice&&P.device.destroy(),f.current=null)}},[]),s.useEffect(()=>{const b=v.current;if(!b)return;const R=new ResizeObserver(()=>H(P=>P+1));return R.observe(b),()=>R.disconnect()},[]),s.useEffect(()=>{if(!T)return;let b=!1;if(!f.current)return;async function P(_){return _?Pe(_):null}return Promise.all([P(e),P(t)]).then(([_,D])=>{var Z,L,W;if(b||!f.current)return;const M=f.current;ue.current=_,ce.current=D,(Z=M.texA)==null||Z.destroy(),(L=M.texB)==null||L.destroy(),M.texA=null,M.texB=null;const I=_??D;if(!I){G(null),me($=>$+1);return}const q=$=>{const K=M.device.createTexture($.width,$.height,"rgba8unorm");return K.write($.data),K};M.texA=q(D??I),M.texB=q(_??I);const X=c.current;X.width=I.width,X.height=I.height,(W=M.surface)==null||W.configure(I.width,I.height),G({w:I.width,h:I.height}),me($=>$+1),O($=>$+1)}),()=>{b=!0}},[T,e,t]);const ne=s.useMemo(()=>(g??"").includes("signed")?"signed":"positive",[g]),ve=s.useMemo(()=>m!=="none"?fn(m):void 0,[m]);s.useEffect(()=>{const b=f.current;if(!T||!b||!b.surface||!b.texA||!b.texB||!S)return;const R=v.current,P=R?R.getBoundingClientRect():{width:S.w,height:S.h},_=kt({zoom:w,pan:h},P,S.w,S.h);ee(X=>X.x===_.x&&X.y===_.y&&X.w===_.w&&X.h===_.h?X:_);const D=c.current?c.current.getBoundingClientRect():P,M=Vt(_,D,S.w,S.h)>=nt?"nearest":"linear";let I=_;b.device.backend==="webgl2"&&(I={x:I.x,y:I.y+I.h,w:I.w,h:-I.h});const q={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:I,filter:M,mode:r,split:n,alpha:a,diffSubmode:g??"absolute",diffCmapMode:ne,diffColormap:r==="diff"?ve:void 0};try{Wr(b.device,b.surface,b.texA,b.texB,q)}catch(X){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",X),p(!0)}},[T,S,F,w,h.x,h.y,r,n,a,g,ne,ve,Y]),s.useEffect(()=>{const b=f.current;if(!T||!b||!b.texA||!b.texB||!t){A(null);return}let R=!1;return $r(b.device,b.texA,b.texB).then(P=>{R||A(P)}),()=>{R=!0}},[T,F,t]);const he=b=>(R,P,_)=>{const D=b.current;if(!D||R<0||P<0||R>=D.width||P>=D.height)return null;const M=(P*D.width+R)*4,I=D.data[M],q=D.data[M+1],X=D.data[M+2],Z=(.299*I+.587*q+.114*X)/255;return I===q&&q===X?{lines:[J(I,"uint8",_)],luminance:Z}:{lines:[J(I,"uint8",_),J(q,"uint8",_),J(X,"uint8",_)],luminance:Z,colors:[se[0],se[1],se[2]]}},ie=s.useMemo(()=>he(ue),[]),fe=s.useMemo(()=>he(ce),[]),{containerProps:ae}=Me({containerRef:v,zoom:w,pan:h,onViewportChange:u}),le=s.useCallback(()=>u==null?void 0:u(dn),[u]),j=l==="auto"?void 0:l;return x?r==="diff"?d.jsx(Bt,{imageUrl:e,baselineUrl:t,diffMode:g??"signed",interpolation:l,colormap:m,showAxes:!1,zoom:w,pan:h,onViewportChange:u,label:E,pixelValueNotation:o}):d.jsx(un,{imageUrl:e,baselineUrl:t,mode:r,splitPosition:n,blendAlpha:a,onSplitPositionChange:i,zoom:w,pan:h,onViewportChange:u,interpolation:l,label:E,pixelValueNotation:o}):d.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":T,children:[d.jsxs("div",{ref:v,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...ae.style},onPointerDown:ae.onPointerDown,onPointerMove:ae.onPointerMove,onPointerUp:ae.onPointerUp,onPointerCancel:ae.onPointerCancel,onDoubleClick:le,"data-gpu-compare-viewport":!0,children:[d.jsxs("div",{className:"relative w-full h-full",children:[d.jsx("canvas",{ref:c,className:"w-full h-full object-contain block",style:{imageRendering:j},"data-gpu-compare-canvas":!0}),r==="split"&&d.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${n*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:b=>{b.stopPropagation(),i==null||i(.5)},onPointerDown:b=>{b.stopPropagation(),b.preventDefault();const P=b.currentTarget.parentElement.getBoundingClientRect(),_=M=>{i==null||i(Math.max(0,Math.min(1,(M.clientX-P.left)/P.width)))},D=()=>{window.removeEventListener("pointermove",_),window.removeEventListener("pointerup",D)};window.addEventListener("pointermove",_),window.addEventListener("pointerup",D)},children:d.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),r==="split"?d.jsxs(d.Fragment,{children:[t&&S&&d.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-n)*100}% 0 0)`},children:d.jsx(we,{imageElRef:c,naturalWidth:S.w,naturalHeight:S.h,zoom:w,pan:h,sourceWindow:re,sample:fe,notation:U,version:de})}),t&&S&&d.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${n*100}%)`},children:d.jsx(we,{imageElRef:c,naturalWidth:S.w,naturalHeight:S.h,zoom:w,pan:h,sourceWindow:re,sample:ie,notation:U,version:de,onActiveChange:te})})]}):S&&d.jsx(we,{imageElRef:c,naturalWidth:S.w,naturalHeight:S.h,zoom:w,pan:h,sourceWindow:re,sample:ie,notation:U,version:de,onActiveChange:te}),N&&d.jsx(Le,{notation:U,onChange:B})]}),d.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),E?d.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:E}):null,C&&d.jsxs("span",{className:`absolute right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${N?"top-8":"top-1"}`,"data-gpu-compare-metrics":!0,children:["MSE ",C.mse.toExponential(2)," · PSNR ",Number.isFinite(C.psnr)?C.psnr.toFixed(1):"∞"," dB · MAE"," ",C.mae.toExponential(2)]})]})}const hn="cairn-plot:gpu-image-ready";async function gn(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Oe(),window.__cairnPlotGpuImagePane=cn,window.__cairnPlotGpuComparePane=mn,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(hn))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}gn()})(__cairnPlotJsxRuntime,__cairnPlotReact);

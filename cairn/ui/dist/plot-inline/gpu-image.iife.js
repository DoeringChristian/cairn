var nr=Object.defineProperty;var or=(S,w,ee)=>w in S?nr(S,w,{enumerable:!0,configurable:!0,writable:!0,value:ee}):S[w]=ee;var R=(S,w,ee)=>or(S,typeof w!="symbol"?w+"":w,ee);(function(S,w){"use strict";function ee(e,t){switch(t){case"rgba8unorm":return{internalFormat:e.RGBA8,format:e.RGBA,type:e.UNSIGNED_BYTE};case"rgba16float":return{internalFormat:e.RGBA16F,format:e.RGBA,type:e.HALF_FLOAT};case"rgba32float":return{internalFormat:e.RGBA32F,format:e.RGBA,type:e.FLOAT};case"r32float":return{internalFormat:e.R32F,format:e.RED,type:e.FLOAT};default:{const r=t;throw new Error(`webgl2 device: unknown TextureFormat ${String(r)}`)}}}function qe(e){return e==="rgba16float"||e==="rgba32float"||e==="r32float"}function He(e){const t="#pragma vertex",r="#pragma fragment",n=e.indexOf(t),o=e.indexOf(r);if(n===-1||o===-1||o<n)throw new Error("webgl2 device: shaderGLSL must contain '#pragma vertex' followed by '#pragma fragment' (see engine/shaders/passthrough.glsl.ts)");const a=e.slice(n+t.length,o).trim(),p=e.slice(o+r.length).trim();return{vertex:a,fragment:p}}function ve(e,t,r){const n=e.createShader(t);if(!n)throw new Error("webgl2 device: gl.createShader failed");if(e.shaderSource(n,r),e.compileShader(n),!e.getShaderParameter(n,e.COMPILE_STATUS)){const o=e.getShaderInfoLog(n);e.deleteShader(n);const a=t===e.VERTEX_SHADER?"vertex":"fragment";throw new Error(`webgl2 device: ${a} shader compile failed: ${o}
---source---
${r}`)}return n}function Ke(e,t,r){const n=ve(e,e.VERTEX_SHADER,t),o=ve(e,e.FRAGMENT_SHADER,r),a=e.createProgram();if(!a)throw new Error("webgl2 device: gl.createProgram failed");if(e.attachShader(a,n),e.attachShader(a,o),e.linkProgram(a),e.deleteShader(n),e.deleteShader(o),!e.getProgramParameter(a,e.LINK_STATUS)){const p=e.getProgramInfoLog(a);throw e.deleteProgram(a),new Error(`webgl2 device: program link failed: ${p}`)}return a}function Ze(){const e=document.createElement("canvas");e.width=1,e.height=1;const t=e.getContext("webgl2");if(!t)throw new Error("webgl2 device: WebGL2 is not supported in this browser");const r=!!t.getExtension("EXT_color_buffer_float"),n=t.getExtension("WEBGL_lose_context");return n==null||n.loseContext(),{hdr:!1,compute:!1,float16:r}}class we{constructor(t,r,n,o){R(this,"width");R(this,"height");R(this,"format");R(this,"glTexture");R(this,"gl");R(this,"info");R(this,"destroyed",!1);this.gl=t,this.width=r,this.height=n,this.format=o,this.info=ee(t,o);const a=t.createTexture();if(!a)throw new Error("webgl2 device: gl.createTexture failed");this.glTexture=a,t.bindTexture(t.TEXTURE_2D,a),t.texImage2D(t.TEXTURE_2D,0,this.info.internalFormat,r,n,0,this.info.format,this.info.type,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.bindTexture(t.TEXTURE_2D,null)}write(t){if(this.destroyed)throw new Error("webgl2 device: write() on a destroyed texture");const r=this.gl;r.bindTexture(r.TEXTURE_2D,this.glTexture),r.pixelStorei(r.UNPACK_ALIGNMENT,1),r.texSubImage2D(r.TEXTURE_2D,0,0,0,this.width,this.height,this.info.format,this.info.type,t),r.bindTexture(r.TEXTURE_2D,null)}destroy(){this.destroyed||(this.gl.deleteTexture(this.glTexture),this.destroyed=!0)}}class xe{constructor(t,r){R(this,"_s");R(this,"glSampler");const n=t.createSampler();if(!n)throw new Error("webgl2 device: gl.createSampler failed");this.glSampler=n;const o=(r==null?void 0:r.filter)==="nearest"?t.NEAREST:t.LINEAR;t.samplerParameteri(n,t.TEXTURE_MIN_FILTER,o),t.samplerParameteri(n,t.TEXTURE_MAG_FILTER,o),t.samplerParameteri(n,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.samplerParameteri(n,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this._s=n}}class je{constructor(t,r){R(this,"_p");R(this,"program");R(this,"targetFormat");this.program=t,this.targetFormat=r,this._p=t}}class Je{constructor(t){R(this,"_b");R(this,"entries");this.entries=t,this._b=t}destroy(){}}class Qe{constructor(t){R(this,"canvas");R(this,"hdr",!1);this.canvas=t}configure(t,r){this.canvas.width=t,this.canvas.height=r}getCurrentTextureView(){return null}}function et(e,t,r,n){const o=e.getUniformLocation(t,`u_bind${r}`);if(!o)return;if(n instanceof Int32Array)switch(n.length){case 1:e.uniform1iv(o,n);return;case 2:e.uniform2iv(o,n);return;case 3:e.uniform3iv(o,n);return;case 4:e.uniform4iv(o,n);return;default:e.uniform1iv(o,n);return}const a=n instanceof Float32Array?n:new Float32Array(n.buffer,n.byteOffset,n.byteLength/4);switch(a.length){case 1:e.uniform1fv(o,a);return;case 2:e.uniform2fv(o,a);return;case 3:e.uniform3fv(o,a);return;case 4:e.uniform4fv(o,a);return;case 16:e.uniformMatrix4fv(o,!1,a);return;default:e.uniform1fv(o,a);return}}const Ee=new WeakSet;function tt(e){Ee.has(e)||(Ee.add(e),e.addEventListener("webglcontextlost",t=>{t.preventDefault()},!1))}function _e(){let e=null,t=null,r=null,n=null;const o=Ze();function a(c){r=c.createFramebuffer(),n=c.createVertexArray(),c.getExtension("OES_texture_float_linear"),c.getExtension("EXT_color_buffer_float")}function p(c,f){if(e=c,t=f,tt(f),!c.isContextLost()){a(c);return}r=null,n=null;const v=()=>{f.removeEventListener("webglcontextrestored",v),e===c&&a(c)};f.addEventListener("webglcontextrestored",v,!1)}function g(){if(e)return e;const c=document.createElement("canvas");c.width=1,c.height=1;const f=c.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!f)throw new Error("webgl2 device: WebGL2 is not supported in this browser");return p(f,c),f}function d(c,f){if("canvas"in f)return c.bindFramebuffer(c.FRAMEBUFFER,null),{width:f.canvas.width,height:f.canvas.height,isFloat:!1};const v=f;c.bindFramebuffer(c.FRAMEBUFFER,r),c.framebufferTexture2D(c.FRAMEBUFFER,c.COLOR_ATTACHMENT0,c.TEXTURE_2D,v.glTexture,0);const i=c.checkFramebufferStatus(c.FRAMEBUFFER);if(i!==c.FRAMEBUFFER_COMPLETE)throw new Error(`webgl2 device: framebuffer incomplete for target texture (format=${v.format}, status=0x${i.toString(16)}). Float formats need EXT_color_buffer_float as a render target (capabilities.float16=${o.float16}).`);return{width:v.width,height:v.height,isFloat:qe(v.format)}}return{backend:"webgl2",capabilities:o,createTexture(c,f,v){const i=g();return new we(i,c,f,v)},createSampler(c){const f=g();return new xe(f,c)},createRenderPipeline(c){const f=g(),{vertex:v,fragment:i}=He(c.shaderGLSL),h=Ke(f,v,i);return new je(h,c.targetFormat)},createComputePipeline:void 0,createBindGroup(c,f){return new Je(f)},createSurface(c,f){var v;if(e&&t&&t!==c)throw new Error("webgl2 device: this device already owns a WebGL2 context bound to a different canvas. WebGL2 has no cross-canvas resource sharing — create one createWebGL2Device() per on-screen canvas (see engine/pool.ts).");if(!e){const i=c.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!i)throw new Error("webgl2 device: WebGL2 is not supported on the given canvas");i.isContextLost()&&((v=i.getExtension("WEBGL_lose_context"))==null||v.restoreContext()),p(i,c)}if("drawingBufferColorSpace"in e)try{e.drawingBufferColorSpace="display-p3"}catch{}return new Qe(c)},renderFullscreen(c,f,v){const i=g(),h=f,s=v,{width:u,height:m}=d(i,c);i.viewport(0,0,u,m),i.disable(i.DEPTH_TEST),i.disable(i.BLEND),i.disable(i.CULL_FACE),i.useProgram(h.program),i.bindVertexArray(n);for(const l of s.entries){const b=l.resource;if(b instanceof we){i.activeTexture(i.TEXTURE0+l.binding),i.bindTexture(i.TEXTURE_2D,b.glTexture);const E=i.getUniformLocation(h.program,`t_bind${l.binding}`);E&&i.uniform1i(E,l.binding)}else b instanceof xe?i.bindSampler(l.binding,b.glSampler):et(i,h.program,l.binding,b.uniform)}i.drawArrays(i.TRIANGLES,0,3),i.bindVertexArray(null),i.bindFramebuffer(i.FRAMEBUFFER,null)},async readback(c){const f=g(),{width:v,height:i,isFloat:h}=d(f,c);if(h){const u=new Float32Array(v*i*4);return f.readPixels(0,0,v,i,f.RGBA,f.FLOAT,u),f.bindFramebuffer(f.FRAMEBUFFER,null),u}const s=new Uint8Array(v*i*4);return f.readPixels(0,0,v,i,f.RGBA,f.UNSIGNED_BYTE,s),f.bindFramebuffer(f.FRAMEBUFFER,null),s},destroy(){if(!e)return;r&&e.deleteFramebuffer(r),n&&e.deleteVertexArray(n);const c=e.getExtension("WEBGL_lose_context");c==null||c.loseContext(),e=null,t=null,r=null,n=null},isContextLost(){return e?e.isContextLost():!1}}}const fe=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function Te(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"opaque",usage:fe}),{hdr:!1,format:r}}function rt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"opaque",usage:fe}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"opaque",usage:fe}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return Te(e,t)}}}const nt=`
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
`;function he(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Re(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function ot(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let o;return r===0?o=n/1024*Math.pow(2,-14):r===31?o=n?NaN:1/0:o=(1+n/1024)*Math.pow(2,r-15),t?-o:o}const it={texture:0,sampler:1,uniform:2};function ge(e,t){return e*3+it[t]}const at={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function st(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const o=Number(n[1]),a=n[2]!==void 0,p=n[3].trim();if(a){const g=at[p];if(g===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${p}" (binding ${o}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(o,{kind:"uniform",sizeBytes:g})}else p==="sampler"||p==="sampler_comparison"?t.set(o,{kind:"sampler"}):t.set(o,{kind:"texture"})}return t}class ye{constructor(t,r,n,o){R(this,"width");R(this,"height");R(this,"format");R(this,"gpuTexture");R(this,"device");R(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=o,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:he(o),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*Re(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class Se{constructor(t){R(this,"_s");R(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class ct{constructor(t,r,n,o,a){R(this,"_p");R(this,"gpuPipeline");R(this,"bindings");R(this,"bindGroupLayout");R(this,"variants");R(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=a,this.variants=new Map([[o,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function ut(e,t){const r=[];for(const[n,o]of t)o.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):o.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class lt{constructor(t){R(this,"_c");R(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class dt{constructor(t,r){R(this,"_b");R(this,"gpuBindGroup");R(this,"ownedBuffers");R(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class ft{constructor(t,r,n,o){R(this,"canvas");R(this,"hdr");R(this,"format");R(this,"context");R(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=o}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function ae(e){return"canvas"in e}async function ht(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function o(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function a(i){return ae(i)?i.getCurrentTextureView():i.gpuTexture.createView()}function p(i){if(ae(i))return{width:i.canvas.width,height:i.canvas.height};const h=i;return{width:h.width,height:h.height}}let g=!1;const d=256;let x=null,c=null;function f(){if(!x||!c){const i=t.createShaderModule({code:nt});c=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const h=t.createPipelineLayout({bindGroupLayouts:[c]});x=t.createComputePipeline({layout:h,compute:{module:i,entryPoint:"cs_main"}})}return{pipeline:x,layout:c}}return{backend:"webgpu",capabilities:r,createTexture(i,h,s){return new ye(t,i,h,s)},createSampler(i){const h=(i==null?void 0:i.filter)==="linear"?"linear":"nearest",s=t.createSampler({magFilter:h,minFilter:h,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new Se(s)},createRenderPipeline(i){const h=t.createShaderModule({code:i.shaderWGSL}),s=st(i.shaderWGSL),u=he(i.targetFormat),m=ut(t,s),l=t.createPipelineLayout({bindGroupLayouts:[m]}),b=_=>t.createRenderPipeline({layout:l,vertex:{module:h,entryPoint:"vs_main"},fragment:{module:h,entryPoint:"fs_main",targets:[{format:_}]},primitive:{topology:"triangle-list"}}),E=b(u);return new ct(E,s,m,u,b)},createComputePipeline(i){const h=t.createShaderModule({code:i.shaderWGSL}),s=t.createComputePipeline({layout:"auto",compute:{module:h,entryPoint:"cs_main"}});return new lt(s)},createBindGroup(i,h){const s=i,u=new Map,m=[];for(const[b,E]of s.bindings)if(E.kind==="uniform"){const _=t.createBuffer({size:E.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});m.push(_),u.set(b,{binding:b,resource:{buffer:_}})}else E.kind==="sampler"&&u.set(b,{binding:b,resource:o()});for(const b of h){const E=b.resource;if(E instanceof ye){const _=ge(b.binding,"texture");s.bindings.has(_)&&u.set(_,{binding:_,resource:E.gpuTexture.createView()})}else if(E instanceof Se){const _=ge(b.binding,"sampler");s.bindings.has(_)&&u.set(_,{binding:_,resource:E.gpuSampler})}else{const _=ge(b.binding,"uniform"),T=s.bindings.get(_);if(T&&T.kind==="uniform"){const L=E.uniform,P=t.createBuffer({size:Math.max(T.sizeBytes,L.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(P,0,L.buffer,L.byteOffset,L.byteLength),m.push(P),u.set(_,{binding:_,resource:{buffer:P}})}}}const l=t.createBindGroup({layout:s.bindGroupLayout,entries:Array.from(u.values())});return new dt(l,m)},createSurface(i,h){const s=i.getContext("webgpu");if(!s)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const u=h.hdr&&r.hdr,m=()=>u?rt(s,t):Te(s,t),l=m();return new ft(i,s,l,m)},renderFullscreen(i,h,s){const u=h,m=s,l=a(i),{width:b,height:E}=p(i),_=ae(i)?i.format:he(i.format),T=u.pipelineFor(_),L=t.createCommandEncoder(),P=L.beginRenderPass({colorAttachments:[{view:l,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});P.setPipeline(T),P.setBindGroup(0,m.gpuBindGroup),P.setViewport(0,0,b,E,0,1),P.draw(3),P.end(),t.queue.submit([L.finish()])},async readback(i){const h=ae(i),{width:s,height:u}=p(i),m=h?i.hdr?"rgba16float":"rgba8unorm":i.format,l=h&&i.format==="bgra8unorm",b=h?i.getCurrentGPUTexture():i.gpuTexture,E=Re(m),_=s*E,T=256,L=Math.ceil(_/T)*T,P=L*u,I=t.createBuffer({size:P,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),D=t.createCommandEncoder();D.copyTextureToBuffer({texture:b},{buffer:I,bytesPerRow:L,rowsPerImage:u},{width:s,height:u,depthOrArrayLayers:1}),t.queue.submit([D.finish()]),await I.mapAsync(GPUMapMode.READ);const k=new Uint8Array(I.getMappedRange()),C=new Uint8Array(_*u);for(let U=0;U<u;U++){const N=U*L,B=U*_;C.set(k.subarray(N,N+_),B)}if(I.unmap(),I.destroy(),m==="rgba8unorm"){if(l)for(let U=0;U<C.length;U+=4){const N=C[U],B=C[U+2];C[U]=B,C[U+2]=N}return C}if(m==="rgba16float"){const U=new Uint16Array(C.buffer,C.byteOffset,C.byteLength/2),N=new Float32Array(U.length);for(let B=0;B<U.length;B++)N[B]=ot(U[B]);return N}return new Float32Array(C.buffer,C.byteOffset,C.byteLength/4)},async reduceDiffSumSquaredAbs(i,h,s,u){const m=i,l=h,b=Math.max(0,s*u),E=Math.max(1,Math.ceil(b/d)),{pipeline:_,layout:T}=f(),L=E*2*4,P=t.createBuffer({size:L,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),I=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(I,0,new Uint32Array([Math.max(1,s),Math.max(1,u),b,0]));const D=t.createBindGroup({layout:T,entries:[{binding:0,resource:m.gpuTexture.createView()},{binding:1,resource:l.gpuTexture.createView()},{binding:2,resource:{buffer:P}},{binding:3,resource:{buffer:I}}]}),k=t.createBuffer({size:L,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),C=t.createCommandEncoder(),U=C.beginComputePass();U.setPipeline(_),U.setBindGroup(0,D),U.dispatchWorkgroups(E),U.end(),C.copyBufferToBuffer(P,0,k,0,L),t.queue.submit([C.finish()]),await k.mapAsync(GPUMapMode.READ);const B=new Float32Array(k.getMappedRange()).slice();k.unmap(),k.destroy(),P.destroy(),I.destroy();let $=0,Z=0;for(let z=0;z<E;z++)$+=B[z*2],Z+=B[z*2+1];return{sumSq:$,sumAbs:Z}},destroy(){g||(t.destroy(),g=!0)},isContextLost(){return!1}}}let pe=null;function gt(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceWebGL2")}catch{return!1}}async function pt(e){if(!e&&typeof navigator<"u"&&"gpu"in navigator&&!!navigator.gpu)try{return await ht()}catch{}return _e()}function Pe(e){if(!pe){const t=gt();pe=pt(t)}return pe}function mt(e,t,r){return[e[0]+(t[0]-e[0])*r,e[1]+(t[1]-e[1])*r,e[2]+(t[2]-e[2])*r]}function bt(e){const t=new Uint8Array(768);for(let r=0;r<256;r++){const o=r/255*(e.length-1),a=Math.floor(o),p=Math.min(a+1,e.length-1),g=o-a,[d,x,c]=mt(e[a],e[p],g);t[r*3]=Math.round(d),t[r*3+1]=Math.round(x),t[r*3+2]=Math.round(c)}return t}const Ce={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},vt=new Set(["red-green","red-blue"]),Ge=new Map;function wt(e){let t=Ge.get(e);if(!t){const r=Ce[e]??Ce.viridis;t=bt(r),Ge.set(e,t)}return t}function xt(e,t,r="linear"){const n=wt(t),o=new ImageData(e.width,e.height),a=e.data,p=o.data;for(let g=0;g<a.length;g+=4){const d=(a[g]+a[g+1]+a[g+2])/3;let x;r==="positive"?x=Math.round(128+d/255*127):x=Math.round(d),x=Math.max(0,Math.min(255,x)),p[g]=n[x*3],p[g+1]=n[x*3+1],p[g+2]=n[x*3+2],p[g+3]=a[g+3]}return o}function Le(e){const t=new Map;return{get(r){return t.get(r)},set(r,n){if(t.size>=e){const o=t.keys().next().value;o!==void 0&&t.delete(o)}t.set(r,n)}}}const Ue=Le(50);function Et(e){return Ue.get(e)}function _t(e,t){Ue.set(e,t)}const Me=Le(100);function Tt(e){return Me.get(e)}function Rt(e,t){Me.set(e,t)}async function yt(e){const t=Tt(e);return t||new Promise(r=>{const n=new Image;n.onload=()=>{try{const o=document.createElement("canvas");o.width=n.naturalWidth,o.height=n.naturalHeight;const a=o.getContext("2d");if(!a){r(null);return}a.drawImage(n,0,0);const p=a.getImageData(0,0,o.width,o.height);Rt(e,p),r(p)}catch(o){console.warn("[cairn] loadImageData failed:",o),r(null)}},n.onerror=o=>{console.warn("[cairn] loadImageData: image failed to load:",e,o),r(null)},n.src=e})}function Ae(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function St({naturalWidth:e,naturalHeight:t,zoom:r=1,containerRef:n}){const o=Ae(e),a=Ae(t),p=[];for(let l=0;l<=e;l+=o)p.push(l);const g=[];for(let l=0;l<=t;l+=a)g.push(l);const d=1/r,x=8*d,c=-12*d,f=-2*d,v=n==null?void 0:n.current;let i=0,h=0,s=0,u=0;if(v){const l=v.clientWidth,b=v.clientHeight,E=l/e,_=b/t,T=Math.min(E,_);s=e*T,u=t*T,i=(l-s)/2,h=(b-u)/2}const m=v&&s>0;return S.jsxs(S.Fragment,{children:[S.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:m?h:0,transform:`translateY(${c}px)`,fontSize:x},children:p.map(l=>S.jsx("span",{className:"mono",style:{position:"absolute",left:m?i+l/e*s:`${l/e*100}%`,transform:"translateX(-50%)"},children:l},l))}),S.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:m?i:0,transform:`translateX(${f}px)`,fontSize:x},children:g.map(l=>S.jsx("span",{className:"mono",style:{position:"absolute",top:m?h+l/t*u:`${l/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*d}px`},children:l},l))})]})}function Pt({label:e,isDraggable:t,onDragStart:r}){return S.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:r,style:{cursor:t?"grab":void 0},children:[t&&S.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const Fe=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function me(e){const t=Fe.length;return Fe[(e%t+t)%t]}function Ct(e){const r=w.useRef(null),[n,o]=w.useState({w:0,h:0}),a=w.useRef(null),p=w.useRef(null);return w.useEffect(()=>{var x;const g=r.current;if(g===p.current||((x=a.current)==null||x.disconnect(),a.current=null,p.current=g,!g))return;const d=new ResizeObserver(c=>{for(const f of c)o({w:f.contentRect.width,h:f.contentRect.height})});a.current=d,d.observe(g)}),w.useEffect(()=>()=>{var g;return(g=a.current)==null?void 0:g.disconnect()},[]),{ref:r,size:n}}function Gt(){const[e,t]=w.useState(!1);return w.useEffect(()=>{const r=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!0)},n=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!1)},o=()=>t(!1);return window.addEventListener("keydown",r),window.addEventListener("keyup",n),window.addEventListener("blur",o),()=>{window.removeEventListener("keydown",r),window.removeEventListener("keyup",n),window.removeEventListener("blur",o)}},[]),e}const Lt=.25,Ut=16;function Mt(e){const{containerRef:t,zoom:r,pan:n,onViewportChange:o,minZoom:a=Lt,maxZoom:p=Ut}=e,g=Gt(),d=w.useRef(g);d.current=g;const x=w.useRef({zoom:r,pan:n});x.current={zoom:r,pan:n};const c=w.useRef(o);c.current=o,w.useEffect(()=>{const u=t.current;if(!u||!o)return;const m=l=>{var k;if(!d.current)return;l.preventDefault(),l.stopPropagation();const b=l.deltaY<0?1.1:1/1.1,E=x.current,_=Math.max(a,Math.min(p,E.zoom*b));if(E.zoom===_)return;const T=u.getBoundingClientRect(),L=l.clientX-T.left,P=l.clientY-T.top,I=L-(L-E.pan.x)/E.zoom*_,D=P-(P-E.pan.y)/E.zoom*_;(k=c.current)==null||k.call(c,{zoom:_,pan:{x:I,y:D}})};return u.addEventListener("wheel",m,{passive:!1}),()=>u.removeEventListener("wheel",m)},[t,!!o,a,p]);const f=w.useRef(null),v=w.useCallback(u=>{!d.current||!c.current||(u.currentTarget.setPointerCapture(u.pointerId),f.current={pointerId:u.pointerId,startX:u.clientX,startY:u.clientY,panX:x.current.pan.x,panY:x.current.pan.y})},[]),i=w.useCallback(u=>{var E;const m=f.current;if(!m||m.pointerId!==u.pointerId)return;const l=u.clientX-m.startX,b=u.clientY-m.startY;(E=c.current)==null||E.call(c,{zoom:x.current.zoom,pan:{x:m.panX+l,y:m.panY+b}})},[]),h=w.useCallback(u=>{const m=f.current;if(!(!m||m.pointerId!==u.pointerId)){try{u.currentTarget.releasePointerCapture(u.pointerId)}catch{}f.current=null}},[]),s=g&&!!o;return{containerProps:{onPointerDown:v,onPointerMove:i,onPointerUp:h,onPointerCancel:h,style:{cursor:s?"move":void 0,touchAction:s?"none":void 0}},modifierActive:g}}function At(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function De(e,t,r){return!(r.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function Ft({data:e,settings:t,naturalWidth:r,naturalHeight:n}){const{ref:o,size:a}=Ct(),p=w.useRef(null),g=w.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),d=w.useMemo(()=>{const s=a.w,u=a.h;if(s<=0||u<=0||r<=0||n<=0)return null;const m=Math.min(s/r,u/n),l=r*m,b=n*m;return{left:(s-l)/2,top:(u-b)/2,width:l,height:b}},[a.w,a.h,r,n]),x=e.masks,c=t.showMasks&&!!x&&x.length>0,f=w.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(w.useEffect(()=>{if(!c||!x)return;const s=p.current;if(!s)return;(s.width!==r||s.height!==n)&&(s.width=r,s.height=n);const u=s.getContext("2d");if(!u)return;u.clearRect(0,0,s.width,s.height);let m=!1;const l=u.createImageData(r,n),b=l.data;let E=x.length,_=!1;const T=()=>{m||_&&u.putImageData(l,0,0)},L=document.createElement("canvas");L.width=r,L.height=n;const P=L.getContext("2d",{willReadFrequently:!0});for(const I of x){const D=new Image;D.onload=()=>{if(!m){if(P){P.clearRect(0,0,r,n),P.drawImage(D,0,0,r,n);const k=P.getImageData(0,0,r,n).data;for(let C=0;C<r*n;C++){const U=k[C*4];if(U===0||g.has(U))continue;const[N,B,$]=At(me(U));b[C*4]=N,b[C*4+1]=B,b[C*4+2]=$,b[C*4+3]=255,_=!0}}E-=1,E===0&&T()}},D.onerror=()=>{E-=1,E===0&&T()},D.src=`data:image/png;base64,${I.png_b64}`}return()=>{m=!0}},[c,x,r,n,f]),!d)return S.jsx("div",{ref:o,className:"absolute inset-0 pointer-events-none"});const v=e.boxes??[],i=t.showBoxes&&v.length>0,h=e.class_labels??{};return S.jsxs("div",{ref:o,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[c&&S.jsx("canvas",{ref:p,className:"absolute",style:{left:d.left,top:d.top,width:d.width,height:d.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),i&&S.jsx("svg",{className:"absolute",style:{left:d.left,top:d.top,width:d.width,height:d.height,overflow:"visible"},viewBox:`0 0 ${r} ${n}`,preserveAspectRatio:"none",children:v.map((s,u)=>{if(!De(s,t,g))return null;const m=s.domain==="pixel"?1:r,l=s.domain==="pixel"?1:n,b=s.position.minX*m,E=s.position.minY*l,_=(s.position.maxX-s.position.minX)*m,T=(s.position.maxY-s.position.minY)*l;return S.jsx("rect",{x:b,y:E,width:_,height:T,fill:"none",stroke:me(s.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},u)})}),i&&S.jsx("div",{className:"absolute",style:{left:d.left,top:d.top,width:d.width,height:d.height},children:v.map((s,u)=>{if(!De(s,t,g))return null;const m=s.domain==="pixel"?1/r:1,l=s.domain==="pixel"?1/n:1,b=s.position.minX*m*100,E=s.position.minY*l*100,_=s.label??h[String(s.class_id)]??`#${s.class_id}`,T=s.score!=null?` ${(s.score*100).toFixed(0)}%`:"";return!_&&!T?null:S.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${b}%`,top:`${E}%`,transform:"translateY(-100%)",backgroundColor:me(s.class_id)},children:S.jsxs("span",{className:"mono",children:[_,T]})},u)})})]})}const Dt=30,te=["#ff5a5a","#39d353","#5b9bff"];function be(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function q(e,t,r){return t==="uint8"?r==="int"?String(Math.round(e)):be(e/255):be(r==="int"?e*255:e)}function It({imageElRef:e,naturalWidth:t,naturalHeight:r,zoom:n,pan:o,sample:a,notation:p="decimal",version:g=0,onActiveChange:d}){const x=w.useRef(null),c=w.useRef(!1),f=w.useRef(d);f.current=d;const v=w.useCallback(h=>{var s;h!==c.current&&(c.current=h,(s=f.current)==null||s.call(f,h))},[]),i=w.useCallback(()=>{var Z;const h=x.current,s=e.current;if(!h)return;const u=window.devicePixelRatio||1,m=h.clientWidth,l=h.clientHeight;if(m===0||l===0)return;h.width!==Math.round(m*u)&&(h.width=Math.round(m*u)),h.height!==Math.round(l*u)&&(h.height=Math.round(l*u));const b=h.getContext("2d");if(!b)return;if(b.setTransform(u,0,0,u,0,0),b.clearRect(0,0,m,l),!s||t<=0||r<=0){v(!1);return}const E=s.getBoundingClientRect(),_=h.getBoundingClientRect();if(E.width===0||E.height===0){v(!1);return}const T=Math.min(E.width/t,E.height/r);if(T<Dt){v(!1);return}const L=t*T,P=r*T,I=E.left+(E.width-L)/2-_.left,D=E.top+(E.height-P)/2-_.top,k=Math.max(0,Math.floor((0-I)/T)),C=Math.min(t,Math.ceil((m-I)/T)),U=Math.max(0,Math.floor((0-D)/T)),N=Math.min(r,Math.ceil((l-D)/T));if(C<=k||N<=U){v(!1);return}v(!0),b.textAlign="center",b.textBaseline="middle",b.lineJoin="round";const B=T*.14,$=T-B*2;for(let z=U;z<N;z++)for(let re=k;re<C;re++){const X=a(re,z,p);if(!X||X.lines.length===0)continue;const j=X.lines.length;let oe=1;for(const V of X.lines)V.length>oe&&(oe=V.length);const ce=$/(j*1.15),ue=$/(oe*.62)||ce,J=Math.min(ce,ue,24);if(J<6)continue;const G=I+(re+.5)*T,M=D+(z+.5)*T,A=J*1.15,y=X.luminance<=.55,O=y?"#ffffff":"#000000";b.font=`${J}px ui-monospace, SFMono-Regular, Menlo, monospace`,b.lineWidth=Math.max(1.4,J*.16),b.strokeStyle=y?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let F=M-j*A/2+A/2;for(let V=0;V<X.lines.length;V++){const Y=X.lines[V];b.strokeText(Y,G,F),b.fillStyle=((Z=X.colors)==null?void 0:Z[V])??O,b.fillText(Y,G,F),F+=A}}},[e,t,r,a,p,v]);return w.useEffect(()=>{i()},[i,n,o.x,o.y,g,p]),w.useEffect(()=>{const h=x.current;if(!h)return;const s=new ResizeObserver(()=>i());return s.observe(h),()=>s.disconnect()},[i]),S.jsx("canvas",{ref:x,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Ot({notation:e,onChange:t,className:r=""}){return S.jsx("button",{type:"button",onClick:n=>{n.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:n=>n.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${r}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const kt=`
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

// operatorId: 0=linear, 1=srgb, 2=reinhard, 3=aces (matches TONEMAP_OPERATORS
// key order in image/tonemap.ts). linear/srgb are the SAME clamp — the sRGB
// OETF lives in outputEncodeF, not here.
fn applyOperator(rgb: vec3<f32>, operatorId: i32) -> vec3<f32> {
  if (operatorId == 2) {
    return vec3<f32>(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z));
  }
  if (operatorId == 3) {
    return vec3<f32>(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z));
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
`,Bt=`#pragma vertex
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

// operatorId: 0=linear, 1=srgb, 2=reinhard, 3=aces — matches image.wgsl.ts.
vec3 applyOperator(vec3 rgb, int operatorId) {
  if (operatorId == 2) {
    return vec3(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z));
  }
  if (operatorId == 3) {
    return vec3(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z));
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
`,Ie={linear:0,srgb:1,reinhard:2,aces:3},Oe=new WeakMap;function Nt(e,t){let r=Oe.get(e);r||(r=new Map,Oe.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:kt,shaderGLSL:Bt,targetFormat:t}),r.set(t,n)),n}function Vt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Xt(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function zt(e,t,r,n){var i;const o=Vt(t),a=Nt(e,o),p=Xt(e,n.isScalar?n.colormap:void 0),g=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,d=Ie[n.operator]??Ie.srgb,x=new Float32Array([n.exposureEV,d,g,n.isScalar?1:0]),c=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),f=new Float32Array([n.hdrOut?1:0]);let v;try{v=e.createBindGroup(a,[{binding:0,resource:r},{binding:1,resource:p},{binding:2,resource:{uniform:x}},{binding:3,resource:{uniform:c}},{binding:4,resource:{uniform:f}}]),e.renderFullscreen(t,a,v)}finally{(i=v==null?void 0:v.destroy)==null||i.call(v),p.destroy()}}const Wt=12,H=[];function ke(e){const t=H.indexOf(e);t!==-1&&H.splice(t,1),H.push(e)}function $t(e){const t=H.indexOf(e);t!==-1&&H.splice(t,1)}function se(e){e.parked||($t(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.device&&e.device!==e.sharedDevice&&e.device.destroy(),e.device=null,e.parked=!0)}function Be(e){for(;H.length>Wt;){const t=H.find(r=>r!==e&&!r.visible)??H.find(r=>r!==e);if(!t)break;se(t)}}function Ne(e){if(e.disposed)return;if(!e.parked&&e.surface){ke(e),Be(e);return}const t=e.sharedDevice.backend==="webgl2"?_e():e.sharedDevice;if(e.device=t,e.surface=t.createSurface(e.canvas,{hdr:e.hdr}),e.source){e.canvas.width=e.source.width,e.canvas.height=e.source.height,e.surface.configure(e.source.width,e.source.height);const r=t.createTexture(e.source.width,e.source.height,e.source.format);r.write(e.source.data),e.srcTexture=r}e.parked=!1,ke(e),Be(e)}const Yt=30;function Ve(e,t){if(!(e.disposed||!e.source)&&(Ne(e),!(!e.device||!e.surface||!e.srcTexture))){if(e.device.isContextLost()){Xe(e,t);return}try{zt(e.device,e.surface,e.srcTexture,t),e.restoreRetries=0}catch(r){if(e.device.isContextLost()){Xe(e,t);return}throw r}}}function Xe(e,t){if(!e.disposed){if(e.restoreRetries>=Yt){e.restoreRetries=0;return}e.restoreRetries++,se(e),requestAnimationFrame(()=>Ve(e,t))}}function qt(e){return{canvas:e.canvas,backend:e.sharedDevice.backend,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.device&&e.surface)){e.canvas.width=t.width,e.canvas.height=t.height,e.surface.configure(t.width,t.height),e.srcTexture&&e.srcTexture.destroy();const r=e.device.createTexture(t.width,t.height,t.format);r.write(t.data),e.srcTexture=r}},render(t){Ve(e,t)},park(){e.disposed||se(e)},restore(){e.disposed||!e.source||Ne(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(se(e),e.source=null,e.disposed=!0)}}}async function Ht(e,t){const r=await Pe();return qt({canvas:e,sharedDevice:r,device:null,hdr:!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,restoreRetries:0})}function ze(e){e.dispose()}function Kt(e){return"hdr"in e&&e.hdr!=null}const Zt=["linear","srgb","reinhard","aces"];function jt(e){return e&&Zt.includes(e)?e:"srgb"}const K=e=>Number.isFinite(e)?e:0;function Jt(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function Qt(e){const{h:t,w:r,c:n}=Jt(e.shape),o=e.data,a=new Float32Array(r*t*4);for(let p=0;p<r*t;p++){const g=p*n;let d,x,c,f=1;n===1?d=x=c=K(o[g]):n===3?(d=K(o[g]),x=K(o[g+1]),c=K(o[g+2])):(d=K(o[g]),x=K(o[g+1]),c=K(o[g+2]),f=K(o[g+3]));const v=p*4;a[v]=d,a[v+1]=x,a[v+2]=c,a[v+3]=f}return{data:a,width:r,height:t,format:"rgba32float"}}function er(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const o=Math.min(t.width/r,t.height/n),a=r*o,p=n*o,g=(t.width-a)/2,d=(t.height-p)/2,x=Math.max(e.zoom,1e-6),c=1/x,f=1/x,v=(g*(1-x)-e.pan.x)/(a*x),i=(d*(1-x)-e.pan.y)/(p*x);return{x:v,y:i,w:c,h:f}}const tr={zoom:1,pan:{x:0,y:0}};function We(e){var ue,J;const t=Kt(e),r=w.useRef(null),n=w.useRef(null),o=w.useRef(null),a=w.useRef(null),[p,g]=w.useState(!1),[d,x]=w.useState(null),[c,f]=w.useState(0),[v,i]=w.useState(0),h=w.useRef(null),s=w.useRef(null),[u,m]=w.useState(0),[l,b]=w.useState(e.pixelValueNotation??"decimal"),[E,_]=w.useState(!1),T=e.zoom??1,L=e.pan??{x:0,y:0},P=e.onViewportChange,I=t?"none":e.colormap??"none";w.useEffect(()=>{const G=r.current;if(!G)return;let M=!1;return Ht(G).then(A=>{if(M){ze(A);return}a.current=A,g(!0)}),()=>{M=!0,a.current&&(ze(a.current),a.current=null)}},[]);const{containerProps:D}=Mt({containerRef:n,zoom:T,pan:L,onViewportChange:P}),k=w.useCallback(()=>{P==null||P(tr)},[P]);w.useEffect(()=>{const G=n.current;if(!G)return;const M=new ResizeObserver(()=>i(A=>A+1));return M.observe(G),()=>M.disconnect()},[]),w.useEffect(()=>{const G=n.current;if(!G)return;const M=new IntersectionObserver(A=>{const y=A[0];if(!y)return;const O=a.current;O&&(O.setVisible(y.isIntersecting),y.isIntersecting?O.isParked&&(O.restore(),i(F=>F+1)):O.park())},{threshold:0});return M.observe(G),()=>M.disconnect()},[]),w.useEffect(()=>{var A;if(!t||!p)return;const G=e.hdr;h.current=G;const M=Qt(G);(A=a.current)==null||A.setSource(M),x(y=>y&&y.w===M.width&&y.h===M.height?y:{w:M.width,h:M.height}),m(y=>y+1),f(y=>y+1)},[t,p,t?e.hdr:null]),w.useEffect(()=>{if(t||!p)return;const G=e,M=G.imageUrl,A=G.colormap??"none";if(!M){s.current=null,x(null),m(O=>O+1);return}let y=!1;return yt(M).then(O=>{var Y,ie;if(y||!O)return;let F=O;if(A!=="none"){const W=`gpu::${M}::${A}`,Q=Et(W);if(Q)F=Q;else{const ne=vt.has(A)?"positive":"linear";F=xt(O,A,ne),_t(W,F)}}s.current=O;const V={data:F.data,width:F.width,height:F.height,format:"rgba8unorm"};(Y=a.current)==null||Y.setSource(V),x(W=>W&&W.w===F.width&&W.h===F.height?W:{w:F.width,h:F.height}),(ie=G.onNaturalSize)==null||ie.call(G,F.width,F.height),m(W=>W+1),f(W=>W+1)}),()=>{y=!0}},[t,p,t?null:e.imageUrl,t?null:e.colormap]);const C=t?e.exposure??0:0,U=t?e.tonemap:void 0,N=t?e.gamma:void 0;w.useEffect(()=>{const G=a.current;if(!G||!p||!d)return;const M=n.current,A=M?M.getBoundingClientRect():{width:d.w,height:d.h};let y=er({zoom:T,pan:L},A,d.w,d.h);G.backend==="webgl2"&&(y={x:y.x,y:y.y+y.h,w:y.w,h:-y.h});const O=t?{exposureEV:C,operator:jt(U),gamma:N,isScalar:!1,hdrOut:!1,uv:y}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:y};G.render(O)},[p,d,c,T,L.x,L.y,C,U,N,v,t]);const B=w.useCallback((G,M,A)=>{if(t){const Q=h.current,ne=d;if(!Q||!ne||G<0||M<0||G>=ne.w||M>=ne.h)return null;const $e=Q.shape.length===2?1:Q.shape[2]??1,le=(M*ne.w+G)*$e,de=Q.data,Ye=.5;return $e===1?{lines:[q(de[le]??0,"unit",A)],luminance:Ye}:{lines:[q(de[le]??0,"unit",A),q(de[le+1]??0,"unit",A),q(de[le+2]??0,"unit",A)],luminance:Ye,colors:[te[0],te[1],te[2]]}}const y=s.current;if(!y||G<0||M<0||G>=y.width||M>=y.height)return null;const O=(M*y.width+G)*4,F=y.data[O],V=y.data[O+1],Y=y.data[O+2],ie=(.299*F+.587*V+.114*Y)/255;return I!=="none"||F===V&&V===Y?{lines:[q(F,"uint8",A)],luminance:ie}:{lines:[q(F,"uint8",A),q(V,"uint8",A),q(Y,"uint8",A)],luminance:ie,colors:[te[0],te[1],te[2]]}},[t,d,I]),$=e.showAxes??!1,Z=t?e.label??"":e.label,z=e.interpolation??"auto",re=z==="auto"?void 0:z,X=t?void 0:e.overlay,j=t?void 0:e.overlaySettings,oe=t?!1:e.isDraggable??!1,ce=t?void 0:e.onDragStart;return S.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":p,children:[S.jsxs("div",{ref:n,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:$&&d?"16px 4px 4px 28px":"4px",...D.style},onPointerDown:D.onPointerDown,onPointerMove:D.onPointerMove,onPointerUp:D.onPointerUp,onPointerCancel:D.onPointerCancel,onDoubleClick:k,"data-gpu-image-viewport":!0,children:[S.jsxs("div",{ref:o,className:"relative w-full h-full",children:[S.jsx("canvas",{ref:r,className:"w-full h-full object-contain block",style:{imageRendering:re},"data-gpu-image-canvas":!0}),$&&d&&S.jsx(St,{naturalWidth:d.w,naturalHeight:d.h,zoom:T,containerRef:o}),X&&(j==null?void 0:j.enabled)&&d&&((((ue=X.boxes)==null?void 0:ue.length)??0)>0||(((J=X.masks)==null?void 0:J.length)??0)>0)&&S.jsx(Ft,{data:X,settings:j,naturalWidth:d.w,naturalHeight:d.h})]}),d&&S.jsx(It,{imageElRef:r,naturalWidth:d.w,naturalHeight:d.h,zoom:T,pan:L,sample:B,notation:l,version:u,onActiveChange:_}),E&&S.jsx(Ot,{notation:l,onChange:b})]}),Z?S.jsx(Pt,{label:Z,isDraggable:oe,onDragStart:ce}):null]})}async function rr(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}if(typeof window.__cairnPlotRegisterRenderer!="function"){console.error("cairn-plot gpu-image addon: core bundle not installed (window.__cairnPlotRegisterRenderer missing) — staying on legacy panes.");return}try{await Pe(),window.__cairnPlotRegisterRenderer("image",We),window.__cairnPlotRegisterRenderer("imagehdr",We),window.__cairnPlotGpuImageLoaded=!0}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}rr()})(__cairnPlotJsxRuntime,__cairnPlotReact);

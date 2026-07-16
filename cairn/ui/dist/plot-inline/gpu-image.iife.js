var br=Object.defineProperty;var vr=(S,l,ce)=>l in S?br(S,l,{enumerable:!0,configurable:!0,writable:!0,value:ce}):S[l]=ce;var M=(S,l,ce)=>vr(S,typeof l!="symbol"?l+"":l,ce);(function(S,l){"use strict";function ce(e,t){switch(t){case"rgba8unorm":return{internalFormat:e.RGBA8,format:e.RGBA,type:e.UNSIGNED_BYTE};case"rgba16float":return{internalFormat:e.RGBA16F,format:e.RGBA,type:e.HALF_FLOAT};case"rgba32float":return{internalFormat:e.RGBA32F,format:e.RGBA,type:e.FLOAT};case"r32float":return{internalFormat:e.R32F,format:e.RED,type:e.FLOAT};default:{const r=t;throw new Error(`webgl2 device: unknown TextureFormat ${String(r)}`)}}}function rt(e){return e==="rgba16float"||e==="rgba32float"||e==="r32float"}function nt(e){const t="#pragma vertex",r="#pragma fragment",n=e.indexOf(t),o=e.indexOf(r);if(n===-1||o===-1||o<n)throw new Error("webgl2 device: shaderGLSL must contain '#pragma vertex' followed by '#pragma fragment' (see engine/shaders/passthrough.glsl.ts)");const a=e.slice(n+t.length,o).trim(),v=e.slice(o+r.length).trim();return{vertex:a,fragment:v}}function ye(e,t,r){const n=e.createShader(t);if(!n)throw new Error("webgl2 device: gl.createShader failed");if(e.shaderSource(n,r),e.compileShader(n),!e.getShaderParameter(n,e.COMPILE_STATUS)){const o=e.getShaderInfoLog(n);e.deleteShader(n);const a=t===e.VERTEX_SHADER?"vertex":"fragment";throw new Error(`webgl2 device: ${a} shader compile failed: ${o}
---source---
${r}`)}return n}function ot(e,t,r){const n=ye(e,e.VERTEX_SHADER,t),o=ye(e,e.FRAGMENT_SHADER,r),a=e.createProgram();if(!a)throw new Error("webgl2 device: gl.createProgram failed");if(e.attachShader(a,n),e.attachShader(a,o),e.linkProgram(a),e.deleteShader(n),e.deleteShader(o),!e.getProgramParameter(a,e.LINK_STATUS)){const v=e.getProgramInfoLog(a);throw e.deleteProgram(a),new Error(`webgl2 device: program link failed: ${v}`)}return a}function it(){const e=document.createElement("canvas");e.width=1,e.height=1;const t=e.getContext("webgl2");if(!t)throw new Error("webgl2 device: WebGL2 is not supported in this browser");const r=!!t.getExtension("EXT_color_buffer_float"),n=t.getExtension("WEBGL_lose_context");return n==null||n.loseContext(),{hdr:!1,compute:!1,float16:r}}class Se{constructor(t,r,n,o){M(this,"width");M(this,"height");M(this,"format");M(this,"glTexture");M(this,"gl");M(this,"info");M(this,"destroyed",!1);this.gl=t,this.width=r,this.height=n,this.format=o,this.info=ce(t,o);const a=t.createTexture();if(!a)throw new Error("webgl2 device: gl.createTexture failed");this.glTexture=a,t.bindTexture(t.TEXTURE_2D,a),t.texImage2D(t.TEXTURE_2D,0,this.info.internalFormat,r,n,0,this.info.format,this.info.type,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.bindTexture(t.TEXTURE_2D,null)}write(t){if(this.destroyed)throw new Error("webgl2 device: write() on a destroyed texture");const r=this.gl;r.bindTexture(r.TEXTURE_2D,this.glTexture),r.pixelStorei(r.UNPACK_ALIGNMENT,1),r.texSubImage2D(r.TEXTURE_2D,0,0,0,this.width,this.height,this.info.format,this.info.type,t),r.bindTexture(r.TEXTURE_2D,null)}destroy(){this.destroyed||(this.gl.deleteTexture(this.glTexture),this.destroyed=!0)}}class Re{constructor(t,r){M(this,"_s");M(this,"glSampler");const n=t.createSampler();if(!n)throw new Error("webgl2 device: gl.createSampler failed");this.glSampler=n;const o=(r==null?void 0:r.filter)==="nearest"?t.NEAREST:t.LINEAR;t.samplerParameteri(n,t.TEXTURE_MIN_FILTER,o),t.samplerParameteri(n,t.TEXTURE_MAG_FILTER,o),t.samplerParameteri(n,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.samplerParameteri(n,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this._s=n}}class at{constructor(t,r){M(this,"_p");M(this,"program");M(this,"targetFormat");this.program=t,this.targetFormat=r,this._p=t}}class st{constructor(t){M(this,"_b");M(this,"entries");this.entries=t,this._b=t}destroy(){}}class ct{constructor(t){M(this,"canvas");M(this,"hdr",!1);this.canvas=t}configure(t,r){this.canvas.width=t,this.canvas.height=r}getCurrentTextureView(){return null}}function ut(e,t,r,n){const o=e.getUniformLocation(t,`u_bind${r}`);if(!o)return;if(n instanceof Int32Array)switch(n.length){case 1:e.uniform1iv(o,n);return;case 2:e.uniform2iv(o,n);return;case 3:e.uniform3iv(o,n);return;case 4:e.uniform4iv(o,n);return;default:e.uniform1iv(o,n);return}const a=n instanceof Float32Array?n:new Float32Array(n.buffer,n.byteOffset,n.byteLength/4);switch(a.length){case 1:e.uniform1fv(o,a);return;case 2:e.uniform2fv(o,a);return;case 3:e.uniform3fv(o,a);return;case 4:e.uniform4fv(o,a);return;case 16:e.uniformMatrix4fv(o,!1,a);return;default:e.uniform1fv(o,a);return}}const Te=new WeakSet;function lt(e){Te.has(e)||(Te.add(e),e.addEventListener("webglcontextlost",t=>{t.preventDefault()},!1))}function pe(){let e=null,t=null,r=null,n=null;const o=it();function a(c){r=c.createFramebuffer(),n=c.createVertexArray(),c.getExtension("OES_texture_float_linear"),c.getExtension("EXT_color_buffer_float")}function v(c,m){if(e=c,t=m,lt(m),!c.isContextLost()){a(c);return}r=null,n=null;const x=()=>{m.removeEventListener("webglcontextrestored",x),e===c&&a(c)};m.addEventListener("webglcontextrestored",x,!1)}function h(){if(e)return e;const c=document.createElement("canvas");c.width=1,c.height=1;const m=c.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!m)throw new Error("webgl2 device: WebGL2 is not supported in this browser");return v(m,c),m}function f(c,m){if("canvas"in m)return c.bindFramebuffer(c.FRAMEBUFFER,null),{width:m.canvas.width,height:m.canvas.height,isFloat:!1};const x=m;c.bindFramebuffer(c.FRAMEBUFFER,r),c.framebufferTexture2D(c.FRAMEBUFFER,c.COLOR_ATTACHMENT0,c.TEXTURE_2D,x.glTexture,0);const i=c.checkFramebufferStatus(c.FRAMEBUFFER);if(i!==c.FRAMEBUFFER_COMPLETE)throw new Error(`webgl2 device: framebuffer incomplete for target texture (format=${x.format}, status=0x${i.toString(16)}). Float formats need EXT_color_buffer_float as a render target (capabilities.float16=${o.float16}).`);return{width:x.width,height:x.height,isFloat:rt(x.format)}}return{backend:"webgl2",capabilities:o,createTexture(c,m,x){const i=h();return new Se(i,c,m,x)},createSampler(c){const m=h();return new Re(m,c)},createRenderPipeline(c){const m=h(),{vertex:x,fragment:i}=nt(c.shaderGLSL),p=ot(m,x,i);return new at(p,c.targetFormat)},createComputePipeline:void 0,createBindGroup(c,m){return new st(m)},createSurface(c,m){var x;if(e&&t&&t!==c)throw new Error("webgl2 device: this device already owns a WebGL2 context bound to a different canvas. WebGL2 has no cross-canvas resource sharing — create one createWebGL2Device() per on-screen canvas (see engine/pool.ts).");if(!e){const i=c.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!i)throw new Error("webgl2 device: WebGL2 is not supported on the given canvas");i.isContextLost()&&((x=i.getExtension("WEBGL_lose_context"))==null||x.restoreContext()),v(i,c)}if("drawingBufferColorSpace"in e)try{e.drawingBufferColorSpace="display-p3"}catch{}return new ct(c)},renderFullscreen(c,m,x){const i=h(),p=m,s=x,{width:u,height:g}=f(i,c);i.viewport(0,0,u,g),i.disable(i.DEPTH_TEST),i.disable(i.BLEND),i.disable(i.CULL_FACE),i.useProgram(p.program),i.bindVertexArray(n);for(const b of s.entries){const d=b.resource;if(d instanceof Se){i.activeTexture(i.TEXTURE0+b.binding),i.bindTexture(i.TEXTURE_2D,d.glTexture);const y=i.getUniformLocation(p.program,`t_bind${b.binding}`);y&&i.uniform1i(y,b.binding)}else d instanceof Re?i.bindSampler(b.binding,d.glSampler):ut(i,p.program,b.binding,d.uniform)}i.drawArrays(i.TRIANGLES,0,3),i.bindVertexArray(null),i.bindFramebuffer(i.FRAMEBUFFER,null)},async readback(c){const m=h(),{width:x,height:i,isFloat:p}=f(m,c);if(p){const u=new Float32Array(x*i*4);return m.readPixels(0,0,x,i,m.RGBA,m.FLOAT,u),m.bindFramebuffer(m.FRAMEBUFFER,null),u}const s=new Uint8Array(x*i*4);return m.readPixels(0,0,x,i,m.RGBA,m.UNSIGNED_BYTE,s),m.bindFramebuffer(m.FRAMEBUFFER,null),s},destroy(){if(!e)return;r&&e.deleteFramebuffer(r),n&&e.deleteVertexArray(n);const c=e.getExtension("WEBGL_lose_context");c==null||c.loseContext(),e=null,t=null,r=null,n=null},isContextLost(){return e?e.isContextLost():!1}}}const ge=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function Ce(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"opaque",usage:ge}),{hdr:!1,format:r}}function dt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"opaque",usage:ge}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"opaque",usage:ge}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return Ce(e,t)}}}const ft=`
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
`;function he(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Pe(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function mt(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let o;return r===0?o=n/1024*Math.pow(2,-14):r===31?o=n?NaN:1/0:o=(1+n/1024)*Math.pow(2,r-15),t?-o:o}const pt={texture:0,sampler:1,uniform:2};function be(e,t){return e*3+pt[t]}const gt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function ht(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const o=Number(n[1]),a=n[2]!==void 0,v=n[3].trim();if(a){const h=gt[v];if(h===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${v}" (binding ${o}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(o,{kind:"uniform",sizeBytes:h})}else v==="sampler"||v==="sampler_comparison"?t.set(o,{kind:"sampler"}):t.set(o,{kind:"texture"})}return t}class Ae{constructor(t,r,n,o){M(this,"width");M(this,"height");M(this,"format");M(this,"gpuTexture");M(this,"device");M(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=o,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:he(o),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*Pe(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class Me{constructor(t){M(this,"_s");M(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class bt{constructor(t,r,n,o,a){M(this,"_p");M(this,"gpuPipeline");M(this,"bindings");M(this,"bindGroupLayout");M(this,"variants");M(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=a,this.variants=new Map([[o,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function vt(e,t){const r=[];for(const[n,o]of t)o.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):o.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class xt{constructor(t){M(this,"_c");M(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class wt{constructor(t,r){M(this,"_b");M(this,"gpuBindGroup");M(this,"ownedBuffers");M(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class Et{constructor(t,r,n,o){M(this,"canvas");M(this,"hdr");M(this,"format");M(this,"context");M(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=o}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function de(e){return"canvas"in e}async function _t(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function o(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function a(i){return de(i)?i.getCurrentTextureView():i.gpuTexture.createView()}function v(i){if(de(i))return{width:i.canvas.width,height:i.canvas.height};const p=i;return{width:p.width,height:p.height}}let h=!1;const f=256;let w=null,c=null;function m(){if(!w||!c){const i=t.createShaderModule({code:ft});c=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const p=t.createPipelineLayout({bindGroupLayouts:[c]});w=t.createComputePipeline({layout:p,compute:{module:i,entryPoint:"cs_main"}})}return{pipeline:w,layout:c}}return{backend:"webgpu",capabilities:r,createTexture(i,p,s){return new Ae(t,i,p,s)},createSampler(i){const p=(i==null?void 0:i.filter)==="linear"?"linear":"nearest",s=t.createSampler({magFilter:p,minFilter:p,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new Me(s)},createRenderPipeline(i){const p=t.createShaderModule({code:i.shaderWGSL}),s=ht(i.shaderWGSL),u=he(i.targetFormat),g=vt(t,s),b=t.createPipelineLayout({bindGroupLayouts:[g]}),d=T=>t.createRenderPipeline({layout:b,vertex:{module:p,entryPoint:"vs_main"},fragment:{module:p,entryPoint:"fs_main",targets:[{format:T}]},primitive:{topology:"triangle-list"}}),y=d(u);return new bt(y,s,g,u,d)},createComputePipeline(i){const p=t.createShaderModule({code:i.shaderWGSL}),s=t.createComputePipeline({layout:"auto",compute:{module:p,entryPoint:"cs_main"}});return new xt(s)},createBindGroup(i,p){const s=i,u=new Map,g=[];for(const[d,y]of s.bindings)if(y.kind==="uniform"){const T=t.createBuffer({size:y.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});g.push(T),u.set(d,{binding:d,resource:{buffer:T}})}else y.kind==="sampler"&&u.set(d,{binding:d,resource:o()});for(const d of p){const y=d.resource;if(y instanceof Ae){const T=be(d.binding,"texture");s.bindings.has(T)&&u.set(T,{binding:T,resource:y.gpuTexture.createView()})}else if(y instanceof Me){const T=be(d.binding,"sampler");s.bindings.has(T)&&u.set(T,{binding:T,resource:y.gpuSampler})}else{const T=be(d.binding,"uniform"),A=s.bindings.get(T);if(A&&A.kind==="uniform"){const F=y.uniform,G=t.createBuffer({size:Math.max(A.sizeBytes,F.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(G,0,F.buffer,F.byteOffset,F.byteLength),g.push(G),u.set(T,{binding:T,resource:{buffer:G}})}}}const b=t.createBindGroup({layout:s.bindGroupLayout,entries:Array.from(u.values())});return new wt(b,g)},createSurface(i,p){const s=i.getContext("webgpu");if(!s)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const u=p.hdr&&r.hdr,g=()=>u?dt(s,t):Ce(s,t),b=g();return new Et(i,s,b,g)},renderFullscreen(i,p,s){const u=p,g=s,b=a(i),{width:d,height:y}=v(i),T=de(i)?i.format:he(i.format),A=u.pipelineFor(T),F=t.createCommandEncoder(),G=F.beginRenderPass({colorAttachments:[{view:b,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});G.setPipeline(A),G.setBindGroup(0,g.gpuBindGroup),G.setViewport(0,0,d,y,0,1),G.draw(3),G.end(),t.queue.submit([F.finish()])},async readback(i){const p=de(i),{width:s,height:u}=v(i),g=p?i.hdr?"rgba16float":"rgba8unorm":i.format,b=p&&i.format==="bgra8unorm",d=p?i.getCurrentGPUTexture():i.gpuTexture,y=Pe(g),T=s*y,A=256,F=Math.ceil(T/A)*A,G=F*u,O=t.createBuffer({size:G,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),B=t.createCommandEncoder();B.copyTextureToBuffer({texture:d},{buffer:O,bytesPerRow:F,rowsPerImage:u},{width:s,height:u,depthOrArrayLayers:1}),t.queue.submit([B.finish()]),await O.mapAsync(GPUMapMode.READ);const V=new Uint8Array(O.getMappedRange()),L=new Uint8Array(T*u);for(let U=0;U<u;U++){const z=U*F,N=U*T;L.set(V.subarray(z,z+T),N)}if(O.unmap(),O.destroy(),g==="rgba8unorm"){if(b)for(let U=0;U<L.length;U+=4){const z=L[U],N=L[U+2];L[U]=N,L[U+2]=z}return L}if(g==="rgba16float"){const U=new Uint16Array(L.buffer,L.byteOffset,L.byteLength/2),z=new Float32Array(U.length);for(let N=0;N<U.length;N++)z[N]=mt(U[N]);return z}return new Float32Array(L.buffer,L.byteOffset,L.byteLength/4)},async reduceDiffSumSquaredAbs(i,p,s,u){const g=i,b=p,d=Math.max(0,s*u),y=Math.max(1,Math.ceil(d/f)),{pipeline:T,layout:A}=m(),F=y*2*4,G=t.createBuffer({size:F,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),O=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(O,0,new Uint32Array([Math.max(1,s),Math.max(1,u),d,0]));const B=t.createBindGroup({layout:A,entries:[{binding:0,resource:g.gpuTexture.createView()},{binding:1,resource:b.gpuTexture.createView()},{binding:2,resource:{buffer:G}},{binding:3,resource:{buffer:O}}]}),V=t.createBuffer({size:F,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),L=t.createCommandEncoder(),U=L.beginComputePass();U.setPipeline(T),U.setBindGroup(0,B),U.dispatchWorkgroups(y),U.end(),L.copyBufferToBuffer(G,0,V,0,F),t.queue.submit([L.finish()]),await V.mapAsync(GPUMapMode.READ);const N=new Float32Array(V.getMappedRange()).slice();V.unmap(),V.destroy(),G.destroy(),O.destroy();let Y=0,j=0;for(let $=0;$<y;$++)Y+=N[$*2],j+=N[$*2+1];return{sumSq:Y,sumAbs:j}},destroy(){h||(t.destroy(),h=!0)},isContextLost(){return!1}}}let ve=null;function yt(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceWebGL2")}catch{return!1}}async function St(e){if(!e&&typeof navigator<"u"&&"gpu"in navigator&&!!navigator.gpu)try{return await _t()}catch{}return pe()}function xe(e){if(!ve){const t=yt();ve=St(t)}return ve}function Rt(e,t,r){return[e[0]+(t[0]-e[0])*r,e[1]+(t[1]-e[1])*r,e[2]+(t[2]-e[2])*r]}function Tt(e){const t=new Uint8Array(768);for(let r=0;r<256;r++){const o=r/255*(e.length-1),a=Math.floor(o),v=Math.min(a+1,e.length-1),h=o-a,[f,w,c]=Rt(e[a],e[v],h);t[r*3]=Math.round(f),t[r*3+1]=Math.round(w),t[r*3+2]=Math.round(c)}return t}const Ge={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},Ct=new Set(["red-green","red-blue"]),Le=new Map;function Ie(e){let t=Le.get(e);if(!t){const r=Ge[e]??Ge.viridis;t=Tt(r),Le.set(e,t)}return t}function Pt(e,t,r="linear"){const n=Ie(t),o=new ImageData(e.width,e.height),a=e.data,v=o.data;for(let h=0;h<a.length;h+=4){const f=(a[h]+a[h+1]+a[h+2])/3;let w;r==="positive"?w=Math.round(128+f/255*127):w=Math.round(f),w=Math.max(0,Math.min(255,w)),v[h]=n[w*3],v[h+1]=n[w*3+1],v[h+2]=n[w*3+2],v[h+3]=a[h+3]}return o}function Fe(e){const t=new Map;return{get(r){return t.get(r)},set(r,n){if(t.size>=e){const o=t.keys().next().value;o!==void 0&&t.delete(o)}t.set(r,n)}}}const Ue=Fe(50);function At(e){return Ue.get(e)}function Mt(e,t){Ue.set(e,t)}const De=Fe(100);function Gt(e){return De.get(e)}function Lt(e,t){De.set(e,t)}async function Oe(e){const t=Gt(e);return t||new Promise(r=>{const n=new Image;n.onload=()=>{try{const o=document.createElement("canvas");o.width=n.naturalWidth,o.height=n.naturalHeight;const a=o.getContext("2d");if(!a){r(null);return}a.drawImage(n,0,0);const v=a.getImageData(0,0,o.width,o.height);Lt(e,v),r(v)}catch(o){console.warn("[cairn] loadImageData failed:",o),r(null)}},n.onerror=o=>{console.warn("[cairn] loadImageData: image failed to load:",e,o),r(null)},n.src=e})}function Be(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function It({naturalWidth:e,naturalHeight:t,zoom:r=1,containerRef:n}){const o=Be(e),a=Be(t),v=[];for(let b=0;b<=e;b+=o)v.push(b);const h=[];for(let b=0;b<=t;b+=a)h.push(b);const f=1/r,w=8*f,c=-12*f,m=-2*f,x=n==null?void 0:n.current;let i=0,p=0,s=0,u=0;if(x){const b=x.clientWidth,d=x.clientHeight,y=b/e,T=d/t,A=Math.min(y,T);s=e*A,u=t*A,i=(b-s)/2,p=(d-u)/2}const g=x&&s>0;return S.jsxs(S.Fragment,{children:[S.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:g?p:0,transform:`translateY(${c}px)`,fontSize:w},children:v.map(b=>S.jsx("span",{className:"mono",style:{position:"absolute",left:g?i+b/e*s:`${b/e*100}%`,transform:"translateX(-50%)"},children:b},b))}),S.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:g?i:0,transform:`translateX(${m}px)`,fontSize:w},children:h.map(b=>S.jsx("span",{className:"mono",style:{position:"absolute",top:g?p+b/t*u:`${b/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*f}px`},children:b},b))})]})}function Ft({label:e,isDraggable:t,onDragStart:r}){return S.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:r,style:{cursor:t?"grab":void 0},children:[t&&S.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const ke=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function we(e){const t=ke.length;return ke[(e%t+t)%t]}function Ut(e){const r=l.useRef(null),[n,o]=l.useState({w:0,h:0}),a=l.useRef(null),v=l.useRef(null);return l.useEffect(()=>{var w;const h=r.current;if(h===v.current||((w=a.current)==null||w.disconnect(),a.current=null,v.current=h,!h))return;const f=new ResizeObserver(c=>{for(const m of c)o({w:m.contentRect.width,h:m.contentRect.height})});a.current=f,f.observe(h)}),l.useEffect(()=>()=>{var h;return(h=a.current)==null?void 0:h.disconnect()},[]),{ref:r,size:n}}function Dt(){const[e,t]=l.useState(!1);return l.useEffect(()=>{const r=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!0)},n=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!1)},o=()=>t(!1);return window.addEventListener("keydown",r),window.addEventListener("keyup",n),window.addEventListener("blur",o),()=>{window.removeEventListener("keydown",r),window.removeEventListener("keyup",n),window.removeEventListener("blur",o)}},[]),e}const Ot=.25,Bt=16;function Ve(e){const{containerRef:t,zoom:r,pan:n,onViewportChange:o,minZoom:a=Ot,maxZoom:v=Bt}=e,h=Dt(),f=l.useRef(h);f.current=h;const w=l.useRef({zoom:r,pan:n});w.current={zoom:r,pan:n};const c=l.useRef(o);c.current=o,l.useEffect(()=>{const u=t.current;if(!u||!o)return;const g=b=>{var V;if(!f.current)return;b.preventDefault(),b.stopPropagation();const d=b.deltaY<0?1.1:1/1.1,y=w.current,T=Math.max(a,Math.min(v,y.zoom*d));if(y.zoom===T)return;const A=u.getBoundingClientRect(),F=b.clientX-A.left,G=b.clientY-A.top,O=F-(F-y.pan.x)/y.zoom*T,B=G-(G-y.pan.y)/y.zoom*T;(V=c.current)==null||V.call(c,{zoom:T,pan:{x:O,y:B}})};return u.addEventListener("wheel",g,{passive:!1}),()=>u.removeEventListener("wheel",g)},[t,!!o,a,v]);const m=l.useRef(null),x=l.useCallback(u=>{!f.current||!c.current||(u.currentTarget.setPointerCapture(u.pointerId),m.current={pointerId:u.pointerId,startX:u.clientX,startY:u.clientY,panX:w.current.pan.x,panY:w.current.pan.y})},[]),i=l.useCallback(u=>{var y;const g=m.current;if(!g||g.pointerId!==u.pointerId)return;const b=u.clientX-g.startX,d=u.clientY-g.startY;(y=c.current)==null||y.call(c,{zoom:w.current.zoom,pan:{x:g.panX+b,y:g.panY+d}})},[]),p=l.useCallback(u=>{const g=m.current;if(!(!g||g.pointerId!==u.pointerId)){try{u.currentTarget.releasePointerCapture(u.pointerId)}catch{}m.current=null}},[]),s=h&&!!o;return{containerProps:{onPointerDown:x,onPointerMove:i,onPointerUp:p,onPointerCancel:p,style:{cursor:s?"move":void 0,touchAction:s?"none":void 0}},modifierActive:h}}function kt(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function Ne(e,t,r){return!(r.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function Vt({data:e,settings:t,naturalWidth:r,naturalHeight:n}){const{ref:o,size:a}=Ut(),v=l.useRef(null),h=l.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),f=l.useMemo(()=>{const s=a.w,u=a.h;if(s<=0||u<=0||r<=0||n<=0)return null;const g=Math.min(s/r,u/n),b=r*g,d=n*g;return{left:(s-b)/2,top:(u-d)/2,width:b,height:d}},[a.w,a.h,r,n]),w=e.masks,c=t.showMasks&&!!w&&w.length>0,m=l.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(l.useEffect(()=>{if(!c||!w)return;const s=v.current;if(!s)return;(s.width!==r||s.height!==n)&&(s.width=r,s.height=n);const u=s.getContext("2d");if(!u)return;u.clearRect(0,0,s.width,s.height);let g=!1;const b=u.createImageData(r,n),d=b.data;let y=w.length,T=!1;const A=()=>{g||T&&u.putImageData(b,0,0)},F=document.createElement("canvas");F.width=r,F.height=n;const G=F.getContext("2d",{willReadFrequently:!0});for(const O of w){const B=new Image;B.onload=()=>{if(!g){if(G){G.clearRect(0,0,r,n),G.drawImage(B,0,0,r,n);const V=G.getImageData(0,0,r,n).data;for(let L=0;L<r*n;L++){const U=V[L*4];if(U===0||h.has(U))continue;const[z,N,Y]=kt(we(U));d[L*4]=z,d[L*4+1]=N,d[L*4+2]=Y,d[L*4+3]=255,T=!0}}y-=1,y===0&&A()}},B.onerror=()=>{y-=1,y===0&&A()},B.src=`data:image/png;base64,${O.png_b64}`}return()=>{g=!0}},[c,w,r,n,m]),!f)return S.jsx("div",{ref:o,className:"absolute inset-0 pointer-events-none"});const x=e.boxes??[],i=t.showBoxes&&x.length>0,p=e.class_labels??{};return S.jsxs("div",{ref:o,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[c&&S.jsx("canvas",{ref:v,className:"absolute",style:{left:f.left,top:f.top,width:f.width,height:f.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),i&&S.jsx("svg",{className:"absolute",style:{left:f.left,top:f.top,width:f.width,height:f.height,overflow:"visible"},viewBox:`0 0 ${r} ${n}`,preserveAspectRatio:"none",children:x.map((s,u)=>{if(!Ne(s,t,h))return null;const g=s.domain==="pixel"?1:r,b=s.domain==="pixel"?1:n,d=s.position.minX*g,y=s.position.minY*b,T=(s.position.maxX-s.position.minX)*g,A=(s.position.maxY-s.position.minY)*b;return S.jsx("rect",{x:d,y,width:T,height:A,fill:"none",stroke:we(s.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},u)})}),i&&S.jsx("div",{className:"absolute",style:{left:f.left,top:f.top,width:f.width,height:f.height},children:x.map((s,u)=>{if(!Ne(s,t,h))return null;const g=s.domain==="pixel"?1/r:1,b=s.domain==="pixel"?1/n:1,d=s.position.minX*g*100,y=s.position.minY*b*100,T=s.label??p[String(s.class_id)]??`#${s.class_id}`,A=s.score!=null?` ${(s.score*100).toFixed(0)}%`:"";return!T&&!A?null:S.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${d}%`,top:`${y}%`,transform:"translateY(-100%)",backgroundColor:we(s.class_id)},children:S.jsxs("span",{className:"mono",children:[T,A]})},u)})})]})}const Nt=30,ee=["#ff5a5a","#39d353","#5b9bff"];function Ee(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function Z(e,t,r){return t==="uint8"?r==="int"?String(Math.round(e)):Ee(e/255):Ee(r==="int"?e*255:e)}function fe({imageElRef:e,naturalWidth:t,naturalHeight:r,zoom:n,pan:o,sample:a,notation:v="decimal",version:h=0,onActiveChange:f}){const w=l.useRef(null),c=l.useRef(!1),m=l.useRef(f);m.current=f;const x=l.useCallback(p=>{var s;p!==c.current&&(c.current=p,(s=m.current)==null||s.call(m,p))},[]),i=l.useCallback(()=>{var j;const p=w.current,s=e.current;if(!p)return;const u=window.devicePixelRatio||1,g=p.clientWidth,b=p.clientHeight;if(g===0||b===0)return;p.width!==Math.round(g*u)&&(p.width=Math.round(g*u)),p.height!==Math.round(b*u)&&(p.height=Math.round(b*u));const d=p.getContext("2d");if(!d)return;if(d.setTransform(u,0,0,u,0,0),d.clearRect(0,0,g,b),!s||t<=0||r<=0){x(!1);return}const y=s.getBoundingClientRect(),T=p.getBoundingClientRect();if(y.width===0||y.height===0){x(!1);return}const A=Math.min(y.width/t,y.height/r);if(A<Nt){x(!1);return}const F=t*A,G=r*A,O=y.left+(y.width-F)/2-T.left,B=y.top+(y.height-G)/2-T.top,V=Math.max(0,Math.floor((0-O)/A)),L=Math.min(t,Math.ceil((g-O)/A)),U=Math.max(0,Math.floor((0-B)/A)),z=Math.min(r,Math.ceil((b-B)/A));if(L<=V||z<=U){x(!1);return}x(!0),d.textAlign="center",d.textBaseline="middle",d.lineJoin="round";const N=A*.14,Y=A-N*2;for(let $=U;$<z;$++)for(let te=V;te<L;te++){const W=a(te,$,v);if(!W||W.lines.length===0)continue;const J=W.lines.length;let ae=1;for(const D of W.lines)D.length>ae&&(ae=D.length);const ue=Y/(J*1.15),Q=Y/(ae*.62)||ue,re=Math.min(ue,Q,24);if(re<6)continue;const I=O+(te+.5)*A,E=B+($+.5)*A,C=re*1.15,_=W.luminance<=.55,R=_?"#ffffff":"#000000";d.font=`${re}px ui-monospace, SFMono-Regular, Menlo, monospace`,d.lineWidth=Math.max(1.4,re*.16),d.strokeStyle=_?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let P=E-J*C/2+C/2;for(let D=0;D<W.lines.length;D++){const k=W.lines[D];d.strokeText(k,I,P),d.fillStyle=((j=W.colors)==null?void 0:j[D])??R,d.fillText(k,I,P),P+=C}}},[e,t,r,a,v,x]);return l.useEffect(()=>{i()},[i,n,o.x,o.y,h,v]),l.useEffect(()=>{const p=w.current;if(!p)return;const s=new ResizeObserver(()=>i());return s.observe(p),()=>s.disconnect()},[i]),S.jsx("canvas",{ref:w,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function ze({notation:e,onChange:t,className:r=""}){return S.jsx("button",{type:"button",onClick:n=>{n.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:n=>n.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${r}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const zt=`
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
`,Xt=`#pragma vertex
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
`,Wt=`
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
`,$t=`#pragma vertex
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
`,_e={linear:0,srgb:1,reinhard:2,aces:3},Xe=new WeakMap;function qt(e,t){let r=Xe.get(e);r||(r=new Map,Xe.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:zt,shaderGLSL:Xt,targetFormat:t}),r.set(t,n)),n}function We(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function $e(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function Yt(e,t,r,n){var i;const o=We(t),a=qt(e,o),v=$e(e,n.isScalar?n.colormap:void 0),h=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,f=_e[n.operator]??_e.srgb,w=new Float32Array([n.exposureEV,f,h,n.isScalar?1:0]),c=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),m=new Float32Array([n.hdrOut?1:0]);let x;try{x=e.createBindGroup(a,[{binding:0,resource:r},{binding:1,resource:v},{binding:2,resource:{uniform:w}},{binding:3,resource:{uniform:c}},{binding:4,resource:{uniform:m}}]),e.renderFullscreen(t,a,x)}finally{(i=x==null?void 0:x.destroy)==null||i.call(x),v.destroy()}}const Ht={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Kt={linear:0,signed:1,positive:2},Zt={split:0,blend:1,diff:2},qe=new WeakMap;function jt(e,t){let r=qe.get(e);r||(r=new Map,qe.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:Wt,shaderGLSL:$t,targetFormat:t}),r.set(t,n)),n}function Jt(e,t,r,n,o){var g;const a=We(t),v=jt(e,a),h=o.mode==="diff"&&!!o.diffColormap,f=h?o.diffColormap:void 0,w=$e(e,f),c=o.gamma,m=_e[o.operator],x=new Float32Array([o.exposureEV,m,c,0]),i=new Float32Array([o.uv.x,o.uv.y,o.uv.w,o.uv.h]),p=new Float32Array([Zt[o.mode],o.split,o.alpha,Ht[o.diffSubmode]??0]),s=new Float32Array([Kt[o.diffCmapMode??"linear"]??0,0,h?1:0,0]);let u;try{u=e.createBindGroup(v,[{binding:0,resource:r},{binding:1,resource:n},{binding:2,resource:w},{binding:3,resource:{uniform:x}},{binding:4,resource:{uniform:i}},{binding:5,resource:{uniform:p}},{binding:6,resource:{uniform:s}}]),e.renderFullscreen(t,v,u)}finally{(g=u==null?void 0:u.destroy)==null||g.call(u),w.destroy()}}function Ye(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,o=t/r,a=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:a,mae:o}}async function Qt(e,t,r){const n=Math.min(t.width,r.width),o=Math.min(t.height,r.height),a=n*o*3;if(a<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:x,sumAbs:i}=await e.reduceDiffSumSquaredAbs(t,r,n,o);return Ye(x,i,a)}const v=await e.readback(t),h=await e.readback(r),f=v instanceof Uint8Array,w=h instanceof Uint8Array;let c=0,m=0;for(let x=0;x<o;x++)for(let i=0;i<n;i++){const p=(x*t.width+i)*4,s=(x*r.width+i)*4;for(let u=0;u<3;u++){const g=(v[p+u]??0)/(f?255:1),b=(h[s+u]??0)/(w?255:1),d=g-b;c+=d*d,m+=Math.abs(d)}}return Ye(c,m,a)}const er=12,oe=[];function He(e){const t=oe.indexOf(e);t!==-1&&oe.splice(t,1),oe.push(e)}function tr(e){const t=oe.indexOf(e);t!==-1&&oe.splice(t,1)}function me(e){e.parked||(tr(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.device&&e.device!==e.sharedDevice&&e.device.destroy(),e.device=null,e.parked=!0)}function Ke(e){for(;oe.length>er;){const t=oe.find(r=>r!==e&&!r.visible)??oe.find(r=>r!==e);if(!t)break;me(t)}}function Ze(e){if(e.disposed)return;if(!e.parked&&e.surface){He(e),Ke(e);return}const t=e.sharedDevice.backend==="webgl2"?pe():e.sharedDevice;if(e.device=t,e.surface=t.createSurface(e.canvas,{hdr:e.hdr}),e.source){e.canvas.width=e.source.width,e.canvas.height=e.source.height,e.surface.configure(e.source.width,e.source.height);const r=t.createTexture(e.source.width,e.source.height,e.source.format);r.write(e.source.data),e.srcTexture=r}e.parked=!1,He(e),Ke(e)}const rr=30;function je(e,t){if(!(e.disposed||!e.source)&&(Ze(e),!(!e.device||!e.surface||!e.srcTexture))){if(e.device.isContextLost()){Je(e,t);return}try{Yt(e.device,e.surface,e.srcTexture,t),e.restoreRetries=0}catch(r){if(e.device.isContextLost()){Je(e,t);return}throw r}}}function Je(e,t){if(!e.disposed){if(e.restoreRetries>=rr){e.restoreRetries=0;return}e.restoreRetries++,me(e),requestAnimationFrame(()=>je(e,t))}}function nr(e){return{canvas:e.canvas,backend:e.sharedDevice.backend,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.device&&e.surface)){e.canvas.width=t.width,e.canvas.height=t.height,e.surface.configure(t.width,t.height),e.srcTexture&&e.srcTexture.destroy();const r=e.device.createTexture(t.width,t.height,t.format);r.write(t.data),e.srcTexture=r}},render(t){je(e,t)},park(){e.disposed||me(e)},restore(){e.disposed||!e.source||Ze(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(me(e),e.source=null,e.disposed=!0)}}}async function or(e,t){const r=await xe();return nr({canvas:e,sharedDevice:r,device:null,hdr:!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,restoreRetries:0})}function Qe(e){e.dispose()}function ir(e){return"hdr"in e&&e.hdr!=null}const ar=["linear","srgb","reinhard","aces"];function sr(e){return e&&ar.includes(e)?e:"srgb"}const ie=e=>Number.isFinite(e)?e:0;function cr(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function ur(e){const{h:t,w:r,c:n}=cr(e.shape),o=e.data,a=new Float32Array(r*t*4);for(let v=0;v<r*t;v++){const h=v*n;let f,w,c,m=1;n===1?f=w=c=ie(o[h]):n===3?(f=ie(o[h]),w=ie(o[h+1]),c=ie(o[h+2])):(f=ie(o[h]),w=ie(o[h+1]),c=ie(o[h+2]),m=ie(o[h+3]));const x=v*4;a[x]=f,a[x+1]=w,a[x+2]=c,a[x+3]=m}return{data:a,width:r,height:t,format:"rgba32float"}}function et(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const o=Math.min(t.width/r,t.height/n),a=r*o,v=n*o,h=(t.width-a)/2,f=(t.height-v)/2,w=Math.max(e.zoom,1e-6),c=1/w,m=1/w,x=(h*(1-w)-e.pan.x)/(a*w),i=(f*(1-w)-e.pan.y)/(v*w);return{x,y:i,w:c,h:m}}const lr={zoom:1,pan:{x:0,y:0}};function dr(e){var Q,re;const t=ir(e),r=l.useRef(null),n=l.useRef(null),o=l.useRef(null),a=l.useRef(null),[v,h]=l.useState(!1),[f,w]=l.useState(null),[c,m]=l.useState(0),[x,i]=l.useState(0),p=l.useRef(null),s=l.useRef(null),[u,g]=l.useState(0),[b,d]=l.useState(e.pixelValueNotation??"decimal"),[y,T]=l.useState(!1),A=e.zoom??1,F=e.pan??{x:0,y:0},G=e.onViewportChange,O=t?"none":e.colormap??"none";l.useEffect(()=>{const I=r.current;if(!I)return;let E=!1;return or(I).then(C=>{if(E){Qe(C);return}a.current=C,h(!0)}),()=>{E=!0,a.current&&(Qe(a.current),a.current=null)}},[]);const{containerProps:B}=Ve({containerRef:n,zoom:A,pan:F,onViewportChange:G}),V=l.useCallback(()=>{G==null||G(lr)},[G]);l.useEffect(()=>{const I=n.current;if(!I)return;const E=new ResizeObserver(()=>i(C=>C+1));return E.observe(I),()=>E.disconnect()},[]),l.useEffect(()=>{const I=n.current;if(!I)return;const E=new IntersectionObserver(C=>{const _=C[0];if(!_)return;const R=a.current;R&&(R.setVisible(_.isIntersecting),_.isIntersecting?R.isParked&&(R.restore(),i(P=>P+1)):R.park())},{threshold:0});return E.observe(I),()=>E.disconnect()},[]),l.useEffect(()=>{var C;if(!t||!v)return;const I=e.hdr;p.current=I;const E=ur(I);(C=a.current)==null||C.setSource(E),w(_=>_&&_.w===E.width&&_.h===E.height?_:{w:E.width,h:E.height}),g(_=>_+1),m(_=>_+1)},[t,v,t?e.hdr:null]),l.useEffect(()=>{if(t||!v)return;const I=e,E=I.imageUrl,C=I.colormap??"none";if(!E){s.current=null,w(null),g(R=>R+1);return}let _=!1;return Oe(E).then(R=>{var k,H;if(_||!R)return;let P=R;if(C!=="none"){const X=`gpu::${E}::${C}`,K=At(X);if(K)P=K;else{const ne=Ct.has(C)?"positive":"linear";P=Pt(R,C,ne),Mt(X,P)}}s.current=R;const D={data:P.data,width:P.width,height:P.height,format:"rgba8unorm"};(k=a.current)==null||k.setSource(D),w(X=>X&&X.w===P.width&&X.h===P.height?X:{w:P.width,h:P.height}),(H=I.onNaturalSize)==null||H.call(I,P.width,P.height),g(X=>X+1),m(X=>X+1)}),()=>{_=!0}},[t,v,t?null:e.imageUrl,t?null:e.colormap]);const L=t?e.exposure??0:0,U=t?e.tonemap:void 0,z=t?e.gamma:void 0;l.useEffect(()=>{const I=a.current;if(!I||!v||!f)return;const E=n.current,C=E?E.getBoundingClientRect():{width:f.w,height:f.h};let _=et({zoom:A,pan:F},C,f.w,f.h);I.backend==="webgl2"&&(_={x:_.x,y:_.y+_.h,w:_.w,h:-_.h});const R=t?{exposureEV:L,operator:sr(U),gamma:z,isScalar:!1,hdrOut:!1,uv:_}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:_};I.render(R)},[v,f,c,A,F.x,F.y,L,U,z,x,t]);const N=l.useCallback((I,E,C)=>{if(t){const K=p.current,ne=f;if(!K||!ne||I<0||E<0||I>=ne.w||E>=ne.h)return null;const le=K.shape.length===2?1:K.shape[2]??1,q=(E*ne.w+I)*le,se=K.data,tt=.5;return le===1?{lines:[Z(se[q]??0,"unit",C)],luminance:tt}:{lines:[Z(se[q]??0,"unit",C),Z(se[q+1]??0,"unit",C),Z(se[q+2]??0,"unit",C)],luminance:tt,colors:[ee[0],ee[1],ee[2]]}}const _=s.current;if(!_||I<0||E<0||I>=_.width||E>=_.height)return null;const R=(E*_.width+I)*4,P=_.data[R],D=_.data[R+1],k=_.data[R+2],H=(.299*P+.587*D+.114*k)/255;return O!=="none"||P===D&&D===k?{lines:[Z(P,"uint8",C)],luminance:H}:{lines:[Z(P,"uint8",C),Z(D,"uint8",C),Z(k,"uint8",C)],luminance:H,colors:[ee[0],ee[1],ee[2]]}},[t,f,O]),Y=e.showAxes??!1,j=t?e.label??"":e.label,$=e.interpolation??"auto",te=$==="auto"?void 0:$,W=t?void 0:e.overlay,J=t?void 0:e.overlaySettings,ae=t?!1:e.isDraggable??!1,ue=t?void 0:e.onDragStart;return S.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":v,children:[S.jsxs("div",{ref:n,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:Y&&f?"16px 4px 4px 28px":"4px",...B.style},onPointerDown:B.onPointerDown,onPointerMove:B.onPointerMove,onPointerUp:B.onPointerUp,onPointerCancel:B.onPointerCancel,onDoubleClick:V,"data-gpu-image-viewport":!0,children:[S.jsxs("div",{ref:o,className:"relative w-full h-full",children:[S.jsx("canvas",{ref:r,className:"w-full h-full object-contain block",style:{imageRendering:te},"data-gpu-image-canvas":!0}),Y&&f&&S.jsx(It,{naturalWidth:f.w,naturalHeight:f.h,zoom:A,containerRef:o}),W&&(J==null?void 0:J.enabled)&&f&&((((Q=W.boxes)==null?void 0:Q.length)??0)>0||(((re=W.masks)==null?void 0:re.length)??0)>0)&&S.jsx(Vt,{data:W,settings:J,naturalWidth:f.w,naturalHeight:f.h})]}),f&&S.jsx(fe,{imageElRef:r,naturalWidth:f.w,naturalHeight:f.h,zoom:A,pan:F,sample:N,notation:b,version:u,onActiveChange:T}),y&&S.jsx(ze,{notation:b,onChange:d})]}),j?S.jsx(Ft,{label:j,isDraggable:ae,onDragStart:ue}):null]})}const fr={zoom:1,pan:{x:0,y:0}};function mr(e){const t=Ie(e),r=new Float32Array(256*4);for(let n=0;n<256;n++)r[n*4+0]=t[n*3+0]/255,r[n*4+1]=t[n*3+1]/255,r[n*4+2]=t[n*3+2]/255,r[n*4+3]=1;return r}function pr({imageUrl:e,baselineUrl:t,mode:r,splitPosition:n,blendAlpha:o,onSplitPositionChange:a,diffSubmode:v,colormap:h="none",zoom:f,pan:w,onViewportChange:c,interpolation:m="auto",label:x="",pixelValueNotation:i="decimal"}){const p=l.useRef(null),s=l.useRef(null),u=l.useRef(null),[g,b]=l.useState(!1),[d,y]=l.useState(null),[T,A]=l.useState(0),[F,G]=l.useState(0),[O,B]=l.useState(null),[V,L]=l.useState(i),[U,z]=l.useState(!1),N=l.useRef(null),Y=l.useRef(null),[j,$]=l.useState(0);l.useEffect(()=>{const E=s.current;if(!E)return;let C=!1;return xe().then(_=>{if(C)return;const R=_.backend==="webgl2",P=R?pe():_,D=P.createSurface(E,{hdr:!1});u.current={device:P,ownsDevice:R,surface:D,texA:null,texB:null},b(!0)}),()=>{var R,P;C=!0;const _=u.current;_&&((R=_.texA)==null||R.destroy(),(P=_.texB)==null||P.destroy(),_.ownsDevice&&_.device.destroy(),u.current=null)}},[]),l.useEffect(()=>{const E=p.current;if(!E)return;const C=new ResizeObserver(()=>G(_=>_+1));return C.observe(E),()=>C.disconnect()},[]),l.useEffect(()=>{if(!g)return;let E=!1;if(!u.current)return;async function _(R){return R?Oe(R):null}return Promise.all([_(e),_(t)]).then(([R,P])=>{var K,ne,le;if(E||!u.current)return;const D=u.current;N.current=R,Y.current=P,(K=D.texA)==null||K.destroy(),(ne=D.texB)==null||ne.destroy(),D.texA=null,D.texB=null;const k=R??P;if(!k){y(null),$(q=>q+1);return}const H=q=>{const se=D.device.createTexture(q.width,q.height,"rgba8unorm");return se.write(q.data),se};D.texA=H(P??k),D.texB=H(R??k);const X=s.current;X.width=k.width,X.height=k.height,(le=D.surface)==null||le.configure(k.width,k.height),y({w:k.width,h:k.height}),$(q=>q+1),A(q=>q+1)}),()=>{E=!0}},[g,e,t]);const te=l.useMemo(()=>(v??"").includes("signed")?"signed":"positive",[v]),W=l.useMemo(()=>h!=="none"?mr(h):void 0,[h]);l.useEffect(()=>{const E=u.current;if(!g||!E||!E.surface||!E.texA||!E.texB||!d)return;const C=p.current,_=C?C.getBoundingClientRect():{width:d.w,height:d.h};let R=et({zoom:f,pan:w},_,d.w,d.h);E.device.backend==="webgl2"&&(R={x:R.x,y:R.y+R.h,w:R.w,h:-R.h});const P={exposureEV:0,operator:"linear",gamma:1,uv:R,mode:r,split:n,alpha:o,diffSubmode:v??"absolute",diffCmapMode:te,diffColormap:r==="diff"?W:void 0};Jt(E.device,E.surface,E.texA,E.texB,P)},[g,d,T,f,w.x,w.y,r,n,o,v,te,W,F]),l.useEffect(()=>{const E=u.current;if(!g||!E||!E.texA||!E.texB||!t){B(null);return}let C=!1;return Qt(E.device,E.texA,E.texB).then(_=>{C||B(_)}),()=>{C=!0}},[g,T,t]);const J=E=>(C,_,R)=>{const P=E.current;if(!P||C<0||_<0||C>=P.width||_>=P.height)return null;const D=(_*P.width+C)*4,k=P.data[D],H=P.data[D+1],X=P.data[D+2],K=(.299*k+.587*H+.114*X)/255;return k===H&&H===X?{lines:[Z(k,"uint8",R)],luminance:K}:{lines:[Z(k,"uint8",R),Z(H,"uint8",R),Z(X,"uint8",R)],luminance:K,colors:[ee[0],ee[1],ee[2]]}},ae=l.useMemo(()=>J(N),[]),ue=l.useMemo(()=>J(Y),[]),{containerProps:Q}=Ve({containerRef:p,zoom:f,pan:w,onViewportChange:c}),re=l.useCallback(()=>c==null?void 0:c(fr),[c]),I=m==="auto"?void 0:m;return S.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":g,children:[S.jsxs("div",{ref:p,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...Q.style},onPointerDown:Q.onPointerDown,onPointerMove:Q.onPointerMove,onPointerUp:Q.onPointerUp,onPointerCancel:Q.onPointerCancel,onDoubleClick:re,"data-gpu-compare-viewport":!0,children:[S.jsxs("div",{className:"relative w-full h-full",children:[S.jsx("canvas",{ref:s,className:"w-full h-full object-contain block",style:{imageRendering:I},"data-gpu-compare-canvas":!0}),r==="split"&&S.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${n*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:E=>{E.stopPropagation(),a==null||a(.5)},onPointerDown:E=>{E.stopPropagation(),E.preventDefault();const _=E.currentTarget.parentElement.getBoundingClientRect(),R=D=>{a==null||a(Math.max(0,Math.min(1,(D.clientX-_.left)/_.width)))},P=()=>{window.removeEventListener("pointermove",R),window.removeEventListener("pointerup",P)};window.addEventListener("pointermove",R),window.addEventListener("pointerup",P)},children:S.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),r==="split"?S.jsxs(S.Fragment,{children:[t&&d&&S.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-n)*100}% 0 0)`},children:S.jsx(fe,{imageElRef:s,naturalWidth:d.w,naturalHeight:d.h,zoom:f,pan:w,sample:ue,notation:V,version:j})}),t&&d&&S.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${n*100}%)`},children:S.jsx(fe,{imageElRef:s,naturalWidth:d.w,naturalHeight:d.h,zoom:f,pan:w,sample:ae,notation:V,version:j,onActiveChange:z})})]}):d&&S.jsx(fe,{imageElRef:s,naturalWidth:d.w,naturalHeight:d.h,zoom:f,pan:w,sample:ae,notation:V,version:j,onActiveChange:z}),U&&S.jsx(ze,{notation:V,onChange:L})]}),S.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),x?S.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:x}):null,O&&S.jsxs("span",{className:"absolute top-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono","data-gpu-compare-metrics":!0,children:["MSE ",O.mse.toExponential(2)," · PSNR ",Number.isFinite(O.psnr)?O.psnr.toFixed(1):"∞"," dB · MAE"," ",O.mae.toExponential(2)]})]})}const gr="cairn-plot:gpu-image-ready";async function hr(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await xe(),window.__cairnPlotGpuImagePane=dr,window.__cairnPlotGpuComparePane=pr,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(gr))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}hr()})(__cairnPlotJsxRuntime,__cairnPlotReact);

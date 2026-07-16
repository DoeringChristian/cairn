var wr=Object.defineProperty;var Er=(C,l,de)=>l in C?wr(C,l,{enumerable:!0,configurable:!0,writable:!0,value:de}):C[l]=de;var A=(C,l,de)=>Er(C,typeof l!="symbol"?l+"":l,de);(function(C,l){"use strict";function de(e,t){switch(t){case"rgba8unorm":return{internalFormat:e.RGBA8,format:e.RGBA,type:e.UNSIGNED_BYTE};case"rgba16float":return{internalFormat:e.RGBA16F,format:e.RGBA,type:e.HALF_FLOAT};case"rgba32float":return{internalFormat:e.RGBA32F,format:e.RGBA,type:e.FLOAT};case"r32float":return{internalFormat:e.R32F,format:e.RED,type:e.FLOAT};default:{const r=t;throw new Error(`webgl2 device: unknown TextureFormat ${String(r)}`)}}}function ot(e){return e==="rgba16float"||e==="rgba32float"||e==="r32float"}function it(e){const t="#pragma vertex",r="#pragma fragment",n=e.indexOf(t),o=e.indexOf(r);if(n===-1||o===-1||o<n)throw new Error("webgl2 device: shaderGLSL must contain '#pragma vertex' followed by '#pragma fragment' (see engine/shaders/passthrough.glsl.ts)");const a=e.slice(n+t.length,o).trim(),b=e.slice(o+r.length).trim();return{vertex:a,fragment:b}}function Re(e,t,r){const n=e.createShader(t);if(!n)throw new Error("webgl2 device: gl.createShader failed");if(e.shaderSource(n,r),e.compileShader(n),!e.getShaderParameter(n,e.COMPILE_STATUS)){const o=e.getShaderInfoLog(n);e.deleteShader(n);const a=t===e.VERTEX_SHADER?"vertex":"fragment";throw new Error(`webgl2 device: ${a} shader compile failed: ${o}
---source---
${r}`)}return n}function at(e,t,r){const n=Re(e,e.VERTEX_SHADER,t),o=Re(e,e.FRAGMENT_SHADER,r),a=e.createProgram();if(!a)throw new Error("webgl2 device: gl.createProgram failed");if(e.attachShader(a,n),e.attachShader(a,o),e.linkProgram(a),e.deleteShader(n),e.deleteShader(o),!e.getProgramParameter(a,e.LINK_STATUS)){const b=e.getProgramInfoLog(a);throw e.deleteProgram(a),new Error(`webgl2 device: program link failed: ${b}`)}return a}function st(){const e=document.createElement("canvas");e.width=1,e.height=1;const t=e.getContext("webgl2");if(!t)throw new Error("webgl2 device: WebGL2 is not supported in this browser");const r=!!t.getExtension("EXT_color_buffer_float"),n=t.getExtension("WEBGL_lose_context");return n==null||n.loseContext(),{hdr:!1,compute:!1,float16:r}}class Te{constructor(t,r,n,o){A(this,"width");A(this,"height");A(this,"format");A(this,"glTexture");A(this,"gl");A(this,"info");A(this,"destroyed",!1);this.gl=t,this.width=r,this.height=n,this.format=o,this.info=de(t,o);const a=t.createTexture();if(!a)throw new Error("webgl2 device: gl.createTexture failed");this.glTexture=a,t.bindTexture(t.TEXTURE_2D,a),t.texImage2D(t.TEXTURE_2D,0,this.info.internalFormat,r,n,0,this.info.format,this.info.type,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.bindTexture(t.TEXTURE_2D,null)}write(t){if(this.destroyed)throw new Error("webgl2 device: write() on a destroyed texture");const r=this.gl;r.bindTexture(r.TEXTURE_2D,this.glTexture),r.pixelStorei(r.UNPACK_ALIGNMENT,1),r.texSubImage2D(r.TEXTURE_2D,0,0,0,this.width,this.height,this.info.format,this.info.type,t),r.bindTexture(r.TEXTURE_2D,null)}destroy(){this.destroyed||(this.gl.deleteTexture(this.glTexture),this.destroyed=!0)}}class Ce{constructor(t,r){A(this,"_s");A(this,"glSampler");const n=t.createSampler();if(!n)throw new Error("webgl2 device: gl.createSampler failed");this.glSampler=n;const o=(r==null?void 0:r.filter)==="nearest"?t.NEAREST:t.LINEAR;t.samplerParameteri(n,t.TEXTURE_MIN_FILTER,o),t.samplerParameteri(n,t.TEXTURE_MAG_FILTER,o),t.samplerParameteri(n,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.samplerParameteri(n,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this._s=n}}class ct{constructor(t,r){A(this,"_p");A(this,"program");A(this,"targetFormat");this.program=t,this.targetFormat=r,this._p=t}}class ut{constructor(t){A(this,"_b");A(this,"entries");this.entries=t,this._b=t}destroy(){}}class lt{constructor(t){A(this,"canvas");A(this,"hdr",!1);this.canvas=t}configure(t,r){this.canvas.width=t,this.canvas.height=r}getCurrentTextureView(){return null}}function dt(e,t,r,n){const o=e.getUniformLocation(t,`u_bind${r}`);if(!o)return;if(n instanceof Int32Array)switch(n.length){case 1:e.uniform1iv(o,n);return;case 2:e.uniform2iv(o,n);return;case 3:e.uniform3iv(o,n);return;case 4:e.uniform4iv(o,n);return;default:e.uniform1iv(o,n);return}const a=n instanceof Float32Array?n:new Float32Array(n.buffer,n.byteOffset,n.byteLength/4);switch(a.length){case 1:e.uniform1fv(o,a);return;case 2:e.uniform2fv(o,a);return;case 3:e.uniform3fv(o,a);return;case 4:e.uniform4fv(o,a);return;case 16:e.uniformMatrix4fv(o,!1,a);return;default:e.uniform1fv(o,a);return}}const Pe=new WeakSet;function ft(e){Pe.has(e)||(Pe.add(e),e.addEventListener("webglcontextlost",t=>{t.preventDefault()},!1))}function he(){let e=null,t=null,r=null,n=null;const o=st();function a(c){r=c.createFramebuffer(),n=c.createVertexArray(),c.getExtension("OES_texture_float_linear"),c.getExtension("EXT_color_buffer_float")}function b(c,h){if(e=c,t=h,ft(h),!c.isContextLost()){a(c);return}r=null,n=null;const x=()=>{h.removeEventListener("webglcontextrestored",x),e===c&&a(c)};h.addEventListener("webglcontextrestored",x,!1)}function p(){if(e)return e;const c=document.createElement("canvas");c.width=1,c.height=1;const h=c.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!h)throw new Error("webgl2 device: WebGL2 is not supported in this browser");return b(h,c),h}function d(c,h){if("canvas"in h)return c.bindFramebuffer(c.FRAMEBUFFER,null),{width:h.canvas.width,height:h.canvas.height,isFloat:!1};const x=h;c.bindFramebuffer(c.FRAMEBUFFER,r),c.framebufferTexture2D(c.FRAMEBUFFER,c.COLOR_ATTACHMENT0,c.TEXTURE_2D,x.glTexture,0);const i=c.checkFramebufferStatus(c.FRAMEBUFFER);if(i!==c.FRAMEBUFFER_COMPLETE)throw new Error(`webgl2 device: framebuffer incomplete for target texture (format=${x.format}, status=0x${i.toString(16)}). Float formats need EXT_color_buffer_float as a render target (capabilities.float16=${o.float16}).`);return{width:x.width,height:x.height,isFloat:ot(x.format)}}return{backend:"webgl2",capabilities:o,createTexture(c,h,x){const i=p();return new Te(i,c,h,x)},createSampler(c){const h=p();return new Ce(h,c)},createRenderPipeline(c){const h=p(),{vertex:x,fragment:i}=it(c.shaderGLSL),_=at(h,x,i);return new ct(_,c.targetFormat)},createComputePipeline:void 0,createBindGroup(c,h){return new ut(h)},createSurface(c,h){var x;if(e&&t&&t!==c)throw new Error("webgl2 device: this device already owns a WebGL2 context bound to a different canvas. WebGL2 has no cross-canvas resource sharing — create one createWebGL2Device() per on-screen canvas (see engine/pool.ts).");if(!e){const i=c.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!i)throw new Error("webgl2 device: WebGL2 is not supported on the given canvas");i.isContextLost()&&((x=i.getExtension("WEBGL_lose_context"))==null||x.restoreContext()),b(i,c)}if("drawingBufferColorSpace"in e)try{e.drawingBufferColorSpace="display-p3"}catch{}return new lt(c)},renderFullscreen(c,h,x){const i=p(),_=h,s=x,{width:u,height:m}=d(i,c);i.viewport(0,0,u,m),i.disable(i.DEPTH_TEST),i.disable(i.BLEND),i.disable(i.CULL_FACE),i.useProgram(_.program),i.bindVertexArray(n);for(const v of s.entries){const f=v.resource;if(f instanceof Te){i.activeTexture(i.TEXTURE0+v.binding),i.bindTexture(i.TEXTURE_2D,f.glTexture);const E=i.getUniformLocation(_.program,`t_bind${v.binding}`);E&&i.uniform1i(E,v.binding)}else f instanceof Ce?i.bindSampler(v.binding,f.glSampler):dt(i,_.program,v.binding,f.uniform)}i.drawArrays(i.TRIANGLES,0,3),i.bindVertexArray(null),i.bindFramebuffer(i.FRAMEBUFFER,null)},async readback(c){const h=p(),{width:x,height:i,isFloat:_}=d(h,c);if(_){const u=new Float32Array(x*i*4);return h.readPixels(0,0,x,i,h.RGBA,h.FLOAT,u),h.bindFramebuffer(h.FRAMEBUFFER,null),u}const s=new Uint8Array(x*i*4);return h.readPixels(0,0,x,i,h.RGBA,h.UNSIGNED_BYTE,s),h.bindFramebuffer(h.FRAMEBUFFER,null),s},destroy(){if(!e)return;r&&e.deleteFramebuffer(r),n&&e.deleteVertexArray(n);const c=e.getExtension("WEBGL_lose_context");c==null||c.loseContext(),e=null,t=null,r=null,n=null},isContextLost(){return e?e.isContextLost():!1}}}const be=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function Ae(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"opaque",usage:be}),{hdr:!1,format:r}}function mt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"opaque",usage:be}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"opaque",usage:be}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return Ae(e,t)}}}const pt=`
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
`;function ve(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Me(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function gt(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let o;return r===0?o=n/1024*Math.pow(2,-14):r===31?o=n?NaN:1/0:o=(1+n/1024)*Math.pow(2,r-15),t?-o:o}const ht={texture:0,sampler:1,uniform:2};function xe(e,t){return e*3+ht[t]}const bt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function vt(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const o=Number(n[1]),a=n[2]!==void 0,b=n[3].trim();if(a){const p=bt[b];if(p===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${b}" (binding ${o}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(o,{kind:"uniform",sizeBytes:p})}else b==="sampler"||b==="sampler_comparison"?t.set(o,{kind:"sampler"}):t.set(o,{kind:"texture"})}return t}class Ge{constructor(t,r,n,o){A(this,"width");A(this,"height");A(this,"format");A(this,"gpuTexture");A(this,"device");A(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=o,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:ve(o),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*Me(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class Le{constructor(t){A(this,"_s");A(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class xt{constructor(t,r,n,o,a){A(this,"_p");A(this,"gpuPipeline");A(this,"bindings");A(this,"bindGroupLayout");A(this,"variants");A(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=a,this.variants=new Map([[o,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function wt(e,t){const r=[];for(const[n,o]of t)o.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):o.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class Et{constructor(t){A(this,"_c");A(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class _t{constructor(t,r){A(this,"_b");A(this,"gpuBindGroup");A(this,"ownedBuffers");A(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class yt{constructor(t,r,n,o){A(this,"canvas");A(this,"hdr");A(this,"format");A(this,"context");A(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=o}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function me(e){return"canvas"in e}async function St(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function o(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function a(i){return me(i)?i.getCurrentTextureView():i.gpuTexture.createView()}function b(i){if(me(i))return{width:i.canvas.width,height:i.canvas.height};const _=i;return{width:_.width,height:_.height}}let p=!1;const d=256;let g=null,c=null;function h(){if(!g||!c){const i=t.createShaderModule({code:pt});c=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const _=t.createPipelineLayout({bindGroupLayouts:[c]});g=t.createComputePipeline({layout:_,compute:{module:i,entryPoint:"cs_main"}})}return{pipeline:g,layout:c}}return{backend:"webgpu",capabilities:r,createTexture(i,_,s){return new Ge(t,i,_,s)},createSampler(i){const _=(i==null?void 0:i.filter)==="linear"?"linear":"nearest",s=t.createSampler({magFilter:_,minFilter:_,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new Le(s)},createRenderPipeline(i){const _=t.createShaderModule({code:i.shaderWGSL}),s=vt(i.shaderWGSL),u=ve(i.targetFormat),m=wt(t,s),v=t.createPipelineLayout({bindGroupLayouts:[m]}),f=R=>t.createRenderPipeline({layout:v,vertex:{module:_,entryPoint:"vs_main"},fragment:{module:_,entryPoint:"fs_main",targets:[{format:R}]},primitive:{topology:"triangle-list"}}),E=f(u);return new xt(E,s,m,u,f)},createComputePipeline(i){const _=t.createShaderModule({code:i.shaderWGSL}),s=t.createComputePipeline({layout:"auto",compute:{module:_,entryPoint:"cs_main"}});return new Et(s)},createBindGroup(i,_){const s=i,u=new Map,m=[];for(const[f,E]of s.bindings)if(E.kind==="uniform"){const R=t.createBuffer({size:E.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});m.push(R),u.set(f,{binding:f,resource:{buffer:R}})}else E.kind==="sampler"&&u.set(f,{binding:f,resource:o()});for(const f of _){const E=f.resource;if(E instanceof Ge){const R=xe(f.binding,"texture");s.bindings.has(R)&&u.set(R,{binding:R,resource:E.gpuTexture.createView()})}else if(E instanceof Le){const R=xe(f.binding,"sampler");s.bindings.has(R)&&u.set(R,{binding:R,resource:E.gpuSampler})}else{const R=xe(f.binding,"uniform"),D=s.bindings.get(R);if(D&&D.kind==="uniform"){const U=E.uniform,M=t.createBuffer({size:Math.max(D.sizeBytes,U.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(M,0,U.buffer,U.byteOffset,U.byteLength),m.push(M),u.set(R,{binding:R,resource:{buffer:M}})}}}const v=t.createBindGroup({layout:s.bindGroupLayout,entries:Array.from(u.values())});return new _t(v,m)},createSurface(i,_){const s=i.getContext("webgpu");if(!s)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const u=_.hdr&&r.hdr,m=()=>u?mt(s,t):Ae(s,t),v=m();return new yt(i,s,v,m)},renderFullscreen(i,_,s){const u=_,m=s,v=a(i),{width:f,height:E}=b(i),R=me(i)?i.format:ve(i.format),D=u.pipelineFor(R),U=t.createCommandEncoder(),M=U.beginRenderPass({colorAttachments:[{view:v,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});M.setPipeline(D),M.setBindGroup(0,m.gpuBindGroup),M.setViewport(0,0,f,E,0,1),M.draw(3),M.end(),t.queue.submit([U.finish()])},async readback(i){const _=me(i),{width:s,height:u}=b(i),m=_?i.hdr?"rgba16float":"rgba8unorm":i.format,v=_&&i.format==="bgra8unorm",f=_?i.getCurrentGPUTexture():i.gpuTexture,E=Me(m),R=s*E,D=256,U=Math.ceil(R/D)*D,M=U*u,B=t.createBuffer({size:M,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),V=t.createCommandEncoder();V.copyTextureToBuffer({texture:f},{buffer:B,bytesPerRow:U,rowsPerImage:u},{width:s,height:u,depthOrArrayLayers:1}),t.queue.submit([V.finish()]),await B.mapAsync(GPUMapMode.READ);const F=new Uint8Array(B.getMappedRange()),G=new Uint8Array(R*u);for(let O=0;O<u;O++){const X=O*U,z=O*R;G.set(F.subarray(X,X+R),z)}if(B.unmap(),B.destroy(),m==="rgba8unorm"){if(v)for(let O=0;O<G.length;O+=4){const X=G[O],z=G[O+2];G[O]=z,G[O+2]=X}return G}if(m==="rgba16float"){const O=new Uint16Array(G.buffer,G.byteOffset,G.byteLength/2),X=new Float32Array(O.length);for(let z=0;z<O.length;z++)X[z]=gt(O[z]);return X}return new Float32Array(G.buffer,G.byteOffset,G.byteLength/4)},async reduceDiffSumSquaredAbs(i,_,s,u){const m=i,v=_,f=Math.max(0,s*u),E=Math.max(1,Math.ceil(f/d)),{pipeline:R,layout:D}=h(),U=E*2*4,M=t.createBuffer({size:U,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),B=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(B,0,new Uint32Array([Math.max(1,s),Math.max(1,u),f,0]));const V=t.createBindGroup({layout:D,entries:[{binding:0,resource:m.gpuTexture.createView()},{binding:1,resource:v.gpuTexture.createView()},{binding:2,resource:{buffer:M}},{binding:3,resource:{buffer:B}}]}),F=t.createBuffer({size:U,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),G=t.createCommandEncoder(),O=G.beginComputePass();O.setPipeline(R),O.setBindGroup(0,V),O.dispatchWorkgroups(E),O.end(),G.copyBufferToBuffer(M,0,F,0,U),t.queue.submit([G.finish()]),await F.mapAsync(GPUMapMode.READ);const z=new Float32Array(F.getMappedRange()).slice();F.unmap(),F.destroy(),M.destroy(),B.destroy();let K=0,Q=0;for(let Y=0;Y<E;Y++)K+=z[Y*2],Q+=z[Y*2+1];return{sumSq:K,sumAbs:Q}},destroy(){p||(t.destroy(),p=!0)},isContextLost(){return!1}}}let we=null;function Rt(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceWebGL2")}catch{return!1}}async function Tt(e){if(!e&&typeof navigator<"u"&&"gpu"in navigator&&!!navigator.gpu)try{return await St()}catch{}return he()}function Ee(e){if(!we){const t=Rt();we=Tt(t)}return we}function Ct(e,t,r){return[e[0]+(t[0]-e[0])*r,e[1]+(t[1]-e[1])*r,e[2]+(t[2]-e[2])*r]}function Pt(e){const t=new Uint8Array(768);for(let r=0;r<256;r++){const o=r/255*(e.length-1),a=Math.floor(o),b=Math.min(a+1,e.length-1),p=o-a,[d,g,c]=Ct(e[a],e[b],p);t[r*3]=Math.round(d),t[r*3+1]=Math.round(g),t[r*3+2]=Math.round(c)}return t}const Ie={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},At=new Set(["red-green","red-blue"]),Ue=new Map;function Fe(e){let t=Ue.get(e);if(!t){const r=Ie[e]??Ie.viridis;t=Pt(r),Ue.set(e,t)}return t}function Mt(e,t,r="linear"){const n=Fe(t),o=new ImageData(e.width,e.height),a=e.data,b=o.data;for(let p=0;p<a.length;p+=4){const d=(a[p]+a[p+1]+a[p+2])/3;let g;r==="positive"?g=Math.round(128+d/255*127):g=Math.round(d),g=Math.max(0,Math.min(255,g)),b[p]=n[g*3],b[p+1]=n[g*3+1],b[p+2]=n[g*3+2],b[p+3]=a[p+3]}return o}function De(e){const t=new Map;return{get(r){return t.get(r)},set(r,n){if(t.size>=e){const o=t.keys().next().value;o!==void 0&&t.delete(o)}t.set(r,n)}}}const Oe=De(50);function Gt(e){return Oe.get(e)}function Lt(e,t){Oe.set(e,t)}const Be=De(100);function It(e){return Be.get(e)}function Ut(e,t){Be.set(e,t)}async function ke(e){const t=It(e);return t||new Promise(r=>{const n=new Image;n.onload=()=>{try{const o=document.createElement("canvas");o.width=n.naturalWidth,o.height=n.naturalHeight;const a=o.getContext("2d");if(!a){r(null);return}a.drawImage(n,0,0);const b=a.getImageData(0,0,o.width,o.height);Ut(e,b),r(b)}catch(o){console.warn("[cairn] loadImageData failed:",o),r(null)}},n.onerror=o=>{console.warn("[cairn] loadImageData: image failed to load:",e,o),r(null)},n.src=e})}function Ne(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Ft({naturalWidth:e,naturalHeight:t,zoom:r=1,containerRef:n}){const o=Ne(e),a=Ne(t),b=[];for(let v=0;v<=e;v+=o)b.push(v);const p=[];for(let v=0;v<=t;v+=a)p.push(v);const d=1/r,g=8*d,c=-12*d,h=-2*d,x=n==null?void 0:n.current;let i=0,_=0,s=0,u=0;if(x){const v=x.clientWidth,f=x.clientHeight,E=v/e,R=f/t,D=Math.min(E,R);s=e*D,u=t*D,i=(v-s)/2,_=(f-u)/2}const m=x&&s>0;return C.jsxs(C.Fragment,{children:[C.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:m?_:0,transform:`translateY(${c}px)`,fontSize:g},children:b.map(v=>C.jsx("span",{className:"mono",style:{position:"absolute",left:m?i+v/e*s:`${v/e*100}%`,transform:"translateX(-50%)"},children:v},v))}),C.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:m?i:0,transform:`translateX(${h}px)`,fontSize:g},children:p.map(v=>C.jsx("span",{className:"mono",style:{position:"absolute",top:m?_+v/t*u:`${v/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*d}px`},children:v},v))})]})}function Dt({label:e,isDraggable:t,onDragStart:r}){return C.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:r,style:{cursor:t?"grab":void 0},children:[t&&C.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const Ve=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function _e(e){const t=Ve.length;return Ve[(e%t+t)%t]}function Ot(e){const r=l.useRef(null),[n,o]=l.useState({w:0,h:0}),a=l.useRef(null),b=l.useRef(null);return l.useEffect(()=>{var g;const p=r.current;if(p===b.current||((g=a.current)==null||g.disconnect(),a.current=null,b.current=p,!p))return;const d=new ResizeObserver(c=>{for(const h of c)o({w:h.contentRect.width,h:h.contentRect.height})});a.current=d,d.observe(p)}),l.useEffect(()=>()=>{var p;return(p=a.current)==null?void 0:p.disconnect()},[]),{ref:r,size:n}}function Bt(){const[e,t]=l.useState(!1);return l.useEffect(()=>{const r=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!0)},n=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!1)},o=()=>t(!1);return window.addEventListener("keydown",r),window.addEventListener("keyup",n),window.addEventListener("blur",o),()=>{window.removeEventListener("keydown",r),window.removeEventListener("keyup",n),window.removeEventListener("blur",o)}},[]),e}const kt=.25,Nt=16;function ze(e){const{containerRef:t,zoom:r,pan:n,onViewportChange:o,minZoom:a=kt,maxZoom:b=Nt}=e,p=Bt(),d=l.useRef(p);d.current=p;const g=l.useRef({zoom:r,pan:n});g.current={zoom:r,pan:n};const c=l.useRef(o);c.current=o,l.useEffect(()=>{const u=t.current;if(!u||!o)return;const m=v=>{var F;if(!d.current)return;v.preventDefault(),v.stopPropagation();const f=v.deltaY<0?1.1:1/1.1,E=g.current,R=Math.max(a,Math.min(b,E.zoom*f));if(E.zoom===R)return;const D=u.getBoundingClientRect(),U=v.clientX-D.left,M=v.clientY-D.top,B=U-(U-E.pan.x)/E.zoom*R,V=M-(M-E.pan.y)/E.zoom*R;(F=c.current)==null||F.call(c,{zoom:R,pan:{x:B,y:V}})};return u.addEventListener("wheel",m,{passive:!1}),()=>u.removeEventListener("wheel",m)},[t,!!o,a,b]);const h=l.useRef(null),x=l.useCallback(u=>{!d.current||!c.current||(u.currentTarget.setPointerCapture(u.pointerId),h.current={pointerId:u.pointerId,startX:u.clientX,startY:u.clientY,panX:g.current.pan.x,panY:g.current.pan.y})},[]),i=l.useCallback(u=>{var E;const m=h.current;if(!m||m.pointerId!==u.pointerId)return;const v=u.clientX-m.startX,f=u.clientY-m.startY;(E=c.current)==null||E.call(c,{zoom:g.current.zoom,pan:{x:m.panX+v,y:m.panY+f}})},[]),_=l.useCallback(u=>{const m=h.current;if(!(!m||m.pointerId!==u.pointerId)){try{u.currentTarget.releasePointerCapture(u.pointerId)}catch{}h.current=null}},[]),s=p&&!!o;return{containerProps:{onPointerDown:x,onPointerMove:i,onPointerUp:_,onPointerCancel:_,style:{cursor:s?"move":void 0,touchAction:s?"none":void 0}},modifierActive:p}}function Vt(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function Xe(e,t,r){return!(r.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function zt({data:e,settings:t,naturalWidth:r,naturalHeight:n}){const{ref:o,size:a}=Ot(),b=l.useRef(null),p=l.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),d=l.useMemo(()=>{const s=a.w,u=a.h;if(s<=0||u<=0||r<=0||n<=0)return null;const m=Math.min(s/r,u/n),v=r*m,f=n*m;return{left:(s-v)/2,top:(u-f)/2,width:v,height:f}},[a.w,a.h,r,n]),g=e.masks,c=t.showMasks&&!!g&&g.length>0,h=l.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(l.useEffect(()=>{if(!c||!g)return;const s=b.current;if(!s)return;(s.width!==r||s.height!==n)&&(s.width=r,s.height=n);const u=s.getContext("2d");if(!u)return;u.clearRect(0,0,s.width,s.height);let m=!1;const v=u.createImageData(r,n),f=v.data;let E=g.length,R=!1;const D=()=>{m||R&&u.putImageData(v,0,0)},U=document.createElement("canvas");U.width=r,U.height=n;const M=U.getContext("2d",{willReadFrequently:!0});for(const B of g){const V=new Image;V.onload=()=>{if(!m){if(M){M.clearRect(0,0,r,n),M.drawImage(V,0,0,r,n);const F=M.getImageData(0,0,r,n).data;for(let G=0;G<r*n;G++){const O=F[G*4];if(O===0||p.has(O))continue;const[X,z,K]=Vt(_e(O));f[G*4]=X,f[G*4+1]=z,f[G*4+2]=K,f[G*4+3]=255,R=!0}}E-=1,E===0&&D()}},V.onerror=()=>{E-=1,E===0&&D()},V.src=`data:image/png;base64,${B.png_b64}`}return()=>{m=!0}},[c,g,r,n,h]),!d)return C.jsx("div",{ref:o,className:"absolute inset-0 pointer-events-none"});const x=e.boxes??[],i=t.showBoxes&&x.length>0,_=e.class_labels??{};return C.jsxs("div",{ref:o,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[c&&C.jsx("canvas",{ref:b,className:"absolute",style:{left:d.left,top:d.top,width:d.width,height:d.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),i&&C.jsx("svg",{className:"absolute",style:{left:d.left,top:d.top,width:d.width,height:d.height,overflow:"visible"},viewBox:`0 0 ${r} ${n}`,preserveAspectRatio:"none",children:x.map((s,u)=>{if(!Xe(s,t,p))return null;const m=s.domain==="pixel"?1:r,v=s.domain==="pixel"?1:n,f=s.position.minX*m,E=s.position.minY*v,R=(s.position.maxX-s.position.minX)*m,D=(s.position.maxY-s.position.minY)*v;return C.jsx("rect",{x:f,y:E,width:R,height:D,fill:"none",stroke:_e(s.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},u)})}),i&&C.jsx("div",{className:"absolute",style:{left:d.left,top:d.top,width:d.width,height:d.height},children:x.map((s,u)=>{if(!Xe(s,t,p))return null;const m=s.domain==="pixel"?1/r:1,v=s.domain==="pixel"?1/n:1,f=s.position.minX*m*100,E=s.position.minY*v*100,R=s.label??_[String(s.class_id)]??`#${s.class_id}`,D=s.score!=null?` ${(s.score*100).toFixed(0)}%`:"";return!R&&!D?null:C.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${f}%`,top:`${E}%`,transform:"translateY(-100%)",backgroundColor:_e(s.class_id)},children:C.jsxs("span",{className:"mono",children:[R,D]})},u)})})]})}const Xt=30,te=["#ff5a5a","#39d353","#5b9bff"];function ye(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function H(e,t,r){return t==="uint8"?r==="int"?String(Math.round(e)):ye(e/255):ye(r==="int"?e*255:e)}const Wt={x:0,y:0,w:1,h:1};function pe({imageElRef:e,naturalWidth:t,naturalHeight:r,zoom:n,pan:o,sample:a,notation:b="decimal",version:p=0,onActiveChange:d,sourceWindow:g=Wt}){const c=l.useRef(null),h=l.useRef(!1),x=l.useRef(d);x.current=d;const i=l.useCallback(s=>{var u;s!==h.current&&(h.current=s,(u=x.current)==null||u.call(x,s))},[]),_=l.useCallback(()=>{var ee;const s=c.current,u=e.current;if(!s)return;const m=window.devicePixelRatio||1,v=s.clientWidth,f=s.clientHeight;if(v===0||f===0)return;s.width!==Math.round(v*m)&&(s.width=Math.round(v*m)),s.height!==Math.round(f*m)&&(s.height=Math.round(f*m));const E=s.getContext("2d");if(!E)return;if(E.setTransform(m,0,0,m,0,0),E.clearRect(0,0,v,f),!u||t<=0||r<=0){i(!1);return}const R=u.getBoundingClientRect(),D=s.getBoundingClientRect();if(R.width===0||R.height===0){i(!1);return}const U=g.x*t,M=g.y*r,B=g.w*t,V=g.h*r;if(B<=0||V<=0){i(!1);return}const F=Math.min(R.width/B,R.height/V);if(F<Xt){i(!1);return}const G=B*F,O=V*F,X=R.left+(R.width-G)/2-D.left,z=R.top+(R.height-O)/2-D.top,K=Math.max(Math.floor(U),Math.floor(U+(0-X)/F)),Q=Math.min(Math.ceil(U+B),Math.ceil(U+(v-X)/F)),Y=Math.max(Math.floor(M),Math.floor(M+(0-z)/F)),re=Math.min(Math.ceil(M+V),Math.ceil(M+(f-z)/F));if(Q<=K||re<=Y){i(!1);return}i(!0),E.textAlign="center",E.textBaseline="middle",E.lineJoin="round";const ce=F*.14,ue=F-ce*2;for(let Z=Y;Z<re;Z++)for(let ne=K;ne<Q;ne++){const j=a(ne,Z,b);if(!j||j.lines.length===0)continue;const J=j.lines.length;let se=1;for(const N of j.lines)N.length>se&&(se=N.length);const I=ue/(J*1.15),w=ue/(se*.62)||I,P=Math.min(I,w,24);if(P<6)continue;const y=X+(ne-U+.5)*F,S=z+(Z-M+.5)*F,T=P*1.15,L=j.luminance<=.55,k=L?"#ffffff":"#000000";E.font=`${P}px ui-monospace, SFMono-Regular, Menlo, monospace`,E.lineWidth=Math.max(1.4,P*.16),E.strokeStyle=L?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let W=S-J*T/2+T/2;for(let N=0;N<j.lines.length;N++){const $=j.lines[N];E.strokeText($,y,W),E.fillStyle=((ee=j.colors)==null?void 0:ee[N])??k,E.fillText($,y,W),W+=T}}},[e,t,r,a,b,i,g]);return l.useEffect(()=>{_()},[_,n,o.x,o.y,p,b,g]),l.useEffect(()=>{const s=c.current;if(!s)return;const u=new ResizeObserver(()=>_());return u.observe(s),()=>u.disconnect()},[_]),C.jsx("canvas",{ref:c,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function We({notation:e,onChange:t,className:r=""}){return C.jsx("button",{type:"button",onClick:n=>{n.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:n=>n.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${r}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const $t=`
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
`,qt=`#pragma vertex
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
`,Yt=`
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
`,Ht=`#pragma vertex
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
`,Se={linear:0,srgb:1,reinhard:2,aces:3},$e=new WeakMap;function Kt(e,t){let r=$e.get(e);r||(r=new Map,$e.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:$t,shaderGLSL:qt,targetFormat:t}),r.set(t,n)),n}function qe(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Ye(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function Zt(e,t,r,n){var i;const o=qe(t),a=Kt(e,o),b=Ye(e,n.isScalar?n.colormap:void 0),p=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,d=Se[n.operator]??Se.srgb,g=new Float32Array([n.exposureEV,d,p,n.isScalar?1:0]),c=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),h=new Float32Array([n.hdrOut?1:0]);let x;try{x=e.createBindGroup(a,[{binding:0,resource:r},{binding:1,resource:b},{binding:2,resource:{uniform:g}},{binding:3,resource:{uniform:c}},{binding:4,resource:{uniform:h}}]),e.renderFullscreen(t,a,x)}finally{(i=x==null?void 0:x.destroy)==null||i.call(x),b.destroy()}}const jt={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Jt={linear:0,signed:1,positive:2},Qt={split:0,blend:1,diff:2},He=new WeakMap;function er(e,t){let r=He.get(e);r||(r=new Map,He.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:Yt,shaderGLSL:Ht,targetFormat:t}),r.set(t,n)),n}function tr(e,t,r,n,o){var m;const a=qe(t),b=er(e,a),p=o.mode==="diff"&&!!o.diffColormap,d=p?o.diffColormap:void 0,g=Ye(e,d),c=o.gamma,h=Se[o.operator],x=new Float32Array([o.exposureEV,h,c,0]),i=new Float32Array([o.uv.x,o.uv.y,o.uv.w,o.uv.h]),_=new Float32Array([Qt[o.mode],o.split,o.alpha,jt[o.diffSubmode]??0]),s=new Float32Array([Jt[o.diffCmapMode??"linear"]??0,0,p?1:0,0]);let u;try{u=e.createBindGroup(b,[{binding:0,resource:r},{binding:1,resource:n},{binding:2,resource:g},{binding:3,resource:{uniform:x}},{binding:4,resource:{uniform:i}},{binding:5,resource:{uniform:_}},{binding:6,resource:{uniform:s}}]),e.renderFullscreen(t,b,u)}finally{(m=u==null?void 0:u.destroy)==null||m.call(u),g.destroy()}}function Ke(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,o=t/r,a=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:a,mae:o}}async function rr(e,t,r){const n=Math.min(t.width,r.width),o=Math.min(t.height,r.height),a=n*o*3;if(a<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:x,sumAbs:i}=await e.reduceDiffSumSquaredAbs(t,r,n,o);return Ke(x,i,a)}const b=await e.readback(t),p=await e.readback(r),d=b instanceof Uint8Array,g=p instanceof Uint8Array;let c=0,h=0;for(let x=0;x<o;x++)for(let i=0;i<n;i++){const _=(x*t.width+i)*4,s=(x*r.width+i)*4;for(let u=0;u<3;u++){const m=(b[_+u]??0)/(d?255:1),v=(p[s+u]??0)/(g?255:1),f=m-v;c+=f*f,h+=Math.abs(f)}}return Ke(c,h,a)}const nr=12,ie=[];function Ze(e){const t=ie.indexOf(e);t!==-1&&ie.splice(t,1),ie.push(e)}function or(e){const t=ie.indexOf(e);t!==-1&&ie.splice(t,1)}function ge(e){e.parked||(or(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.device&&e.device!==e.sharedDevice&&e.device.destroy(),e.device=null,e.parked=!0)}function je(e){for(;ie.length>nr;){const t=ie.find(r=>r!==e&&!r.visible)??ie.find(r=>r!==e);if(!t)break;ge(t)}}function Je(e){if(e.disposed)return;if(!e.parked&&e.surface){Ze(e),je(e);return}const t=e.sharedDevice.backend==="webgl2"?he():e.sharedDevice;if(e.device=t,e.surface=t.createSurface(e.canvas,{hdr:e.hdr}),e.source){e.canvas.width=e.source.width,e.canvas.height=e.source.height,e.surface.configure(e.source.width,e.source.height);const r=t.createTexture(e.source.width,e.source.height,e.source.format);r.write(e.source.data),e.srcTexture=r}e.parked=!1,Ze(e),je(e)}const ir=30;function Qe(e,t){if(!(e.disposed||!e.source)&&(Je(e),!(!e.device||!e.surface||!e.srcTexture))){if(e.device.isContextLost()){et(e,t);return}try{Zt(e.device,e.surface,e.srcTexture,t),e.restoreRetries=0}catch(r){if(e.device.isContextLost()){et(e,t);return}throw r}}}function et(e,t){if(!e.disposed){if(e.restoreRetries>=ir){e.restoreRetries=0;return}e.restoreRetries++,ge(e),requestAnimationFrame(()=>Qe(e,t))}}function ar(e){return{canvas:e.canvas,backend:e.sharedDevice.backend,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.device&&e.surface)){e.canvas.width=t.width,e.canvas.height=t.height,e.surface.configure(t.width,t.height),e.srcTexture&&e.srcTexture.destroy();const r=e.device.createTexture(t.width,t.height,t.format);r.write(t.data),e.srcTexture=r}},render(t){Qe(e,t)},park(){e.disposed||ge(e)},restore(){e.disposed||!e.source||Je(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(ge(e),e.source=null,e.disposed=!0)}}}async function sr(e,t){const r=await Ee();return ar({canvas:e,sharedDevice:r,device:null,hdr:!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,restoreRetries:0})}function tt(e){e.dispose()}function cr(e){return"hdr"in e&&e.hdr!=null}const ur=["linear","srgb","reinhard","aces"];function lr(e){return e&&ur.includes(e)?e:"srgb"}const ae=e=>Number.isFinite(e)?e:0;function dr(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function fr(e){const{h:t,w:r,c:n}=dr(e.shape),o=e.data,a=new Float32Array(r*t*4);for(let b=0;b<r*t;b++){const p=b*n;let d,g,c,h=1;n===1?d=g=c=ae(o[p]):n===3?(d=ae(o[p]),g=ae(o[p+1]),c=ae(o[p+2])):(d=ae(o[p]),g=ae(o[p+1]),c=ae(o[p+2]),h=ae(o[p+3]));const x=b*4;a[x]=d,a[x+1]=g,a[x+2]=c,a[x+3]=h}return{data:a,width:r,height:t,format:"rgba32float"}}function rt(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const o=Math.min(t.width/r,t.height/n),a=r*o,b=n*o,p=(t.width-a)/2,d=(t.height-b)/2,g=Math.max(e.zoom,1e-6),c=1/g,h=1/g,x=(p*(1-g)-e.pan.x)/(a*g),i=(d*(1-g)-e.pan.y)/(b*g);return{x,y:i,w:c,h}}const mr={zoom:1,pan:{x:0,y:0}};function pr(e){var J,se;const t=cr(e),r=l.useRef(null),n=l.useRef(null),o=l.useRef(null),a=l.useRef(null),[b,p]=l.useState(!1),[d,g]=l.useState(null),[c,h]=l.useState(0),[x,i]=l.useState(0),[_,s]=l.useState({x:0,y:0,w:1,h:1}),u=l.useRef(null),m=l.useRef(null),[v,f]=l.useState(0),[E,R]=l.useState(e.pixelValueNotation??"decimal"),[D,U]=l.useState(!1),M=e.zoom??1,B=e.pan??{x:0,y:0},V=e.onViewportChange,F=t?"none":e.colormap??"none";l.useEffect(()=>{const I=r.current;if(!I)return;let w=!1;return sr(I).then(P=>{if(w){tt(P);return}a.current=P,p(!0)}),()=>{w=!0,a.current&&(tt(a.current),a.current=null)}},[]);const{containerProps:G}=ze({containerRef:n,zoom:M,pan:B,onViewportChange:V}),O=l.useCallback(()=>{V==null||V(mr)},[V]);l.useEffect(()=>{const I=n.current;if(!I)return;const w=new ResizeObserver(()=>i(P=>P+1));return w.observe(I),()=>w.disconnect()},[]),l.useEffect(()=>{const I=n.current;if(!I)return;const w=new IntersectionObserver(P=>{const y=P[0];if(!y)return;const S=a.current;S&&(S.setVisible(y.isIntersecting),y.isIntersecting?S.isParked&&(S.restore(),i(T=>T+1)):S.park())},{threshold:0});return w.observe(I),()=>w.disconnect()},[]),l.useEffect(()=>{var P;if(!t||!b)return;const I=e.hdr;u.current=I;const w=fr(I);(P=a.current)==null||P.setSource(w),g(y=>y&&y.w===w.width&&y.h===w.height?y:{w:w.width,h:w.height}),f(y=>y+1),h(y=>y+1)},[t,b,t?e.hdr:null]),l.useEffect(()=>{if(t||!b)return;const I=e,w=I.imageUrl,P=I.colormap??"none";if(!w){m.current=null,g(null),f(S=>S+1);return}let y=!1;return ke(w).then(S=>{var k,W;if(y||!S)return;let T=S;if(P!=="none"){const N=`gpu::${w}::${P}`,$=Gt(N);if($)T=$;else{const oe=At.has(P)?"positive":"linear";T=Mt(S,P,oe),Lt(N,T)}}m.current=S;const L={data:T.data,width:T.width,height:T.height,format:"rgba8unorm"};(k=a.current)==null||k.setSource(L),g(N=>N&&N.w===T.width&&N.h===T.height?N:{w:T.width,h:T.height}),(W=I.onNaturalSize)==null||W.call(I,T.width,T.height),f(N=>N+1),h(N=>N+1)}),()=>{y=!0}},[t,b,t?null:e.imageUrl,t?null:e.colormap]);const X=t?e.exposure??0:0,z=t?e.tonemap:void 0,K=t?e.gamma:void 0;l.useEffect(()=>{const I=a.current;if(!I||!b||!d)return;const w=n.current,P=w?w.getBoundingClientRect():{width:d.w,height:d.h},y=rt({zoom:M,pan:B},P,d.w,d.h);s(L=>L.x===y.x&&L.y===y.y&&L.w===y.w&&L.h===y.h?L:y);let S=y;I.backend==="webgl2"&&(S={x:S.x,y:S.y+S.h,w:S.w,h:-S.h});const T=t?{exposureEV:X,operator:lr(z),gamma:K,isScalar:!1,hdrOut:!1,uv:S}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:S};I.render(T)},[b,d,c,M,B.x,B.y,X,z,K,x,t]);const Q=l.useCallback((I,w,P)=>{if(t){const $=u.current,oe=d;if(!$||!oe||I<0||w<0||I>=oe.w||w>=oe.h)return null;const fe=$.shape.length===2?1:$.shape[2]??1,q=(w*oe.w+I)*fe,le=$.data,nt=.5;return fe===1?{lines:[H(le[q]??0,"unit",P)],luminance:nt}:{lines:[H(le[q]??0,"unit",P),H(le[q+1]??0,"unit",P),H(le[q+2]??0,"unit",P)],luminance:nt,colors:[te[0],te[1],te[2]]}}const y=m.current;if(!y||I<0||w<0||I>=y.width||w>=y.height)return null;const S=(w*y.width+I)*4,T=y.data[S],L=y.data[S+1],k=y.data[S+2],W=(.299*T+.587*L+.114*k)/255;return F!=="none"||T===L&&L===k?{lines:[H(T,"uint8",P)],luminance:W}:{lines:[H(T,"uint8",P),H(L,"uint8",P),H(k,"uint8",P)],luminance:W,colors:[te[0],te[1],te[2]]}},[t,d,F]),Y=e.showAxes??!1,re=t?e.label??"":e.label,ce=e.interpolation??"auto",ue=ce==="auto"?void 0:ce,ee=t?void 0:e.overlay,Z=t?void 0:e.overlaySettings,ne=t?!1:e.isDraggable??!1,j=t?void 0:e.onDragStart;return C.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":b,children:[C.jsxs("div",{ref:n,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:Y&&d?"16px 4px 4px 28px":"4px",...G.style},onPointerDown:G.onPointerDown,onPointerMove:G.onPointerMove,onPointerUp:G.onPointerUp,onPointerCancel:G.onPointerCancel,onDoubleClick:O,"data-gpu-image-viewport":!0,children:[C.jsxs("div",{ref:o,className:"relative w-full h-full",children:[C.jsx("canvas",{ref:r,className:"w-full h-full object-contain block",style:{imageRendering:ue},"data-gpu-image-canvas":!0}),Y&&d&&C.jsx(Ft,{naturalWidth:d.w,naturalHeight:d.h,zoom:M,containerRef:o}),ee&&(Z==null?void 0:Z.enabled)&&d&&((((J=ee.boxes)==null?void 0:J.length)??0)>0||(((se=ee.masks)==null?void 0:se.length)??0)>0)&&C.jsx(zt,{data:ee,settings:Z,naturalWidth:d.w,naturalHeight:d.h})]}),d&&C.jsx(pe,{imageElRef:r,naturalWidth:d.w,naturalHeight:d.h,zoom:M,pan:B,sourceWindow:_,sample:Q,notation:E,version:v,onActiveChange:U}),D&&C.jsx(We,{notation:E,onChange:R})]}),re?C.jsx(Dt,{label:re,isDraggable:ne,onDragStart:j}):null]})}const gr={zoom:1,pan:{x:0,y:0}};function hr(e){const t=Fe(e),r=new Float32Array(256*4);for(let n=0;n<256;n++)r[n*4+0]=t[n*3+0]/255,r[n*4+1]=t[n*3+1]/255,r[n*4+2]=t[n*3+2]/255,r[n*4+3]=1;return r}function br({imageUrl:e,baselineUrl:t,mode:r,splitPosition:n,blendAlpha:o,onSplitPositionChange:a,diffSubmode:b,colormap:p="none",zoom:d,pan:g,onViewportChange:c,interpolation:h="auto",label:x="",pixelValueNotation:i="decimal"}){const _=l.useRef(null),s=l.useRef(null),u=l.useRef(null),[m,v]=l.useState(!1),[f,E]=l.useState(null),[R,D]=l.useState(0),[U,M]=l.useState(0),[B,V]=l.useState(null),[F,G]=l.useState(i),[O,X]=l.useState(!1),[z,K]=l.useState({x:0,y:0,w:1,h:1}),Q=l.useRef(null),Y=l.useRef(null),[re,ce]=l.useState(0);l.useEffect(()=>{const w=s.current;if(!w)return;let P=!1;return Ee().then(y=>{if(P)return;const S=y.backend==="webgl2",T=S?he():y,L=T.createSurface(w,{hdr:!1});u.current={device:T,ownsDevice:S,surface:L,texA:null,texB:null},v(!0)}),()=>{var S,T;P=!0;const y=u.current;y&&((S=y.texA)==null||S.destroy(),(T=y.texB)==null||T.destroy(),y.ownsDevice&&y.device.destroy(),u.current=null)}},[]),l.useEffect(()=>{const w=_.current;if(!w)return;const P=new ResizeObserver(()=>M(y=>y+1));return P.observe(w),()=>P.disconnect()},[]),l.useEffect(()=>{if(!m)return;let w=!1;if(!u.current)return;async function y(S){return S?ke(S):null}return Promise.all([y(e),y(t)]).then(([S,T])=>{var $,oe,fe;if(w||!u.current)return;const L=u.current;Q.current=S,Y.current=T,($=L.texA)==null||$.destroy(),(oe=L.texB)==null||oe.destroy(),L.texA=null,L.texB=null;const k=S??T;if(!k){E(null),ce(q=>q+1);return}const W=q=>{const le=L.device.createTexture(q.width,q.height,"rgba8unorm");return le.write(q.data),le};L.texA=W(T??k),L.texB=W(S??k);const N=s.current;N.width=k.width,N.height=k.height,(fe=L.surface)==null||fe.configure(k.width,k.height),E({w:k.width,h:k.height}),ce(q=>q+1),D(q=>q+1)}),()=>{w=!0}},[m,e,t]);const ue=l.useMemo(()=>(b??"").includes("signed")?"signed":"positive",[b]),ee=l.useMemo(()=>p!=="none"?hr(p):void 0,[p]);l.useEffect(()=>{const w=u.current;if(!m||!w||!w.surface||!w.texA||!w.texB||!f)return;const P=_.current,y=P?P.getBoundingClientRect():{width:f.w,height:f.h},S=rt({zoom:d,pan:g},y,f.w,f.h);K(k=>k.x===S.x&&k.y===S.y&&k.w===S.w&&k.h===S.h?k:S);let T=S;w.device.backend==="webgl2"&&(T={x:T.x,y:T.y+T.h,w:T.w,h:-T.h});const L={exposureEV:0,operator:"linear",gamma:1,uv:T,mode:r,split:n,alpha:o,diffSubmode:b??"absolute",diffCmapMode:ue,diffColormap:r==="diff"?ee:void 0};tr(w.device,w.surface,w.texA,w.texB,L)},[m,f,R,d,g.x,g.y,r,n,o,b,ue,ee,U]),l.useEffect(()=>{const w=u.current;if(!m||!w||!w.texA||!w.texB||!t){V(null);return}let P=!1;return rr(w.device,w.texA,w.texB).then(y=>{P||V(y)}),()=>{P=!0}},[m,R,t]);const Z=w=>(P,y,S)=>{const T=w.current;if(!T||P<0||y<0||P>=T.width||y>=T.height)return null;const L=(y*T.width+P)*4,k=T.data[L],W=T.data[L+1],N=T.data[L+2],$=(.299*k+.587*W+.114*N)/255;return k===W&&W===N?{lines:[H(k,"uint8",S)],luminance:$}:{lines:[H(k,"uint8",S),H(W,"uint8",S),H(N,"uint8",S)],luminance:$,colors:[te[0],te[1],te[2]]}},ne=l.useMemo(()=>Z(Q),[]),j=l.useMemo(()=>Z(Y),[]),{containerProps:J}=ze({containerRef:_,zoom:d,pan:g,onViewportChange:c}),se=l.useCallback(()=>c==null?void 0:c(gr),[c]),I=h==="auto"?void 0:h;return C.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":m,children:[C.jsxs("div",{ref:_,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...J.style},onPointerDown:J.onPointerDown,onPointerMove:J.onPointerMove,onPointerUp:J.onPointerUp,onPointerCancel:J.onPointerCancel,onDoubleClick:se,"data-gpu-compare-viewport":!0,children:[C.jsxs("div",{className:"relative w-full h-full",children:[C.jsx("canvas",{ref:s,className:"w-full h-full object-contain block",style:{imageRendering:I},"data-gpu-compare-canvas":!0}),r==="split"&&C.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${n*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:w=>{w.stopPropagation(),a==null||a(.5)},onPointerDown:w=>{w.stopPropagation(),w.preventDefault();const y=w.currentTarget.parentElement.getBoundingClientRect(),S=L=>{a==null||a(Math.max(0,Math.min(1,(L.clientX-y.left)/y.width)))},T=()=>{window.removeEventListener("pointermove",S),window.removeEventListener("pointerup",T)};window.addEventListener("pointermove",S),window.addEventListener("pointerup",T)},children:C.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),r==="split"?C.jsxs(C.Fragment,{children:[t&&f&&C.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-n)*100}% 0 0)`},children:C.jsx(pe,{imageElRef:s,naturalWidth:f.w,naturalHeight:f.h,zoom:d,pan:g,sourceWindow:z,sample:j,notation:F,version:re})}),t&&f&&C.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${n*100}%)`},children:C.jsx(pe,{imageElRef:s,naturalWidth:f.w,naturalHeight:f.h,zoom:d,pan:g,sourceWindow:z,sample:ne,notation:F,version:re,onActiveChange:X})})]}):f&&C.jsx(pe,{imageElRef:s,naturalWidth:f.w,naturalHeight:f.h,zoom:d,pan:g,sourceWindow:z,sample:ne,notation:F,version:re,onActiveChange:X}),O&&C.jsx(We,{notation:F,onChange:G})]}),C.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),x?C.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:x}):null,B&&C.jsxs("span",{className:`absolute right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${O?"top-8":"top-1"}`,"data-gpu-compare-metrics":!0,children:["MSE ",B.mse.toExponential(2)," · PSNR ",Number.isFinite(B.psnr)?B.psnr.toFixed(1):"∞"," dB · MAE"," ",B.mae.toExponential(2)]})]})}const vr="cairn-plot:gpu-image-ready";async function xr(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Ee(),window.__cairnPlotGpuImagePane=pr,window.__cairnPlotGpuComparePane=br,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(vr))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}xr()})(__cairnPlotJsxRuntime,__cairnPlotReact);

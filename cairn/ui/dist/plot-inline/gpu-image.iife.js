var gn=Object.defineProperty;var pn=(f,s,De)=>s in f?gn(f,s,{enumerable:!0,configurable:!0,writable:!0,value:De}):f[s]=De;var B=(f,s,De)=>pn(f,typeof s!="symbol"?s+"":s,De);(function(f,s){"use strict";function De(e,t){switch(t){case"rgba8unorm":return{internalFormat:e.RGBA8,format:e.RGBA,type:e.UNSIGNED_BYTE};case"rgba16float":return{internalFormat:e.RGBA16F,format:e.RGBA,type:e.HALF_FLOAT};case"rgba32float":return{internalFormat:e.RGBA32F,format:e.RGBA,type:e.FLOAT};case"r32float":return{internalFormat:e.R32F,format:e.RED,type:e.FLOAT};default:{const r=t;throw new Error(`webgl2 device: unknown TextureFormat ${String(r)}`)}}}function Bt(e){return e==="rgba16float"||e==="rgba32float"||e==="r32float"}function Nt(e){const t="#pragma vertex",r="#pragma fragment",n=e.indexOf(t),o=e.indexOf(r);if(n===-1||o===-1||o<n)throw new Error("webgl2 device: shaderGLSL must contain '#pragma vertex' followed by '#pragma fragment' (see engine/shaders/passthrough.glsl.ts)");const a=e.slice(n+t.length,o).trim(),g=e.slice(o+r.length).trim();return{vertex:a,fragment:g}}function ot(e,t,r){const n=e.createShader(t);if(!n)throw new Error("webgl2 device: gl.createShader failed");if(e.shaderSource(n,r),e.compileShader(n),!e.getShaderParameter(n,e.COMPILE_STATUS)){const o=e.getShaderInfoLog(n);e.deleteShader(n);const a=t===e.VERTEX_SHADER?"vertex":"fragment";throw new Error(`webgl2 device: ${a} shader compile failed: ${o}
---source---
${r}`)}return n}function Vt(e,t,r){const n=ot(e,e.VERTEX_SHADER,t),o=ot(e,e.FRAGMENT_SHADER,r),a=e.createProgram();if(!a)throw new Error("webgl2 device: gl.createProgram failed");if(e.attachShader(a,n),e.attachShader(a,o),e.linkProgram(a),e.deleteShader(n),e.deleteShader(o),!e.getProgramParameter(a,e.LINK_STATUS)){const g=e.getProgramInfoLog(a);throw e.deleteProgram(a),new Error(`webgl2 device: program link failed: ${g}`)}return a}function Xt(){const e=document.createElement("canvas");e.width=1,e.height=1;const t=e.getContext("webgl2");if(!t)throw new Error("webgl2 device: WebGL2 is not supported in this browser");const r=!!t.getExtension("EXT_color_buffer_float"),n=t.getExtension("WEBGL_lose_context");return n==null||n.loseContext(),{hdr:!1,compute:!1,float16:r}}class at{constructor(t,r,n,o){B(this,"width");B(this,"height");B(this,"format");B(this,"glTexture");B(this,"gl");B(this,"info");B(this,"destroyed",!1);this.gl=t,this.width=r,this.height=n,this.format=o,this.info=De(t,o);const a=t.createTexture();if(!a)throw new Error("webgl2 device: gl.createTexture failed");this.glTexture=a,t.bindTexture(t.TEXTURE_2D,a),t.texImage2D(t.TEXTURE_2D,0,this.info.internalFormat,r,n,0,this.info.format,this.info.type,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.bindTexture(t.TEXTURE_2D,null)}write(t){if(this.destroyed)throw new Error("webgl2 device: write() on a destroyed texture");const r=this.gl;r.bindTexture(r.TEXTURE_2D,this.glTexture),r.pixelStorei(r.UNPACK_ALIGNMENT,1),r.texSubImage2D(r.TEXTURE_2D,0,0,0,this.width,this.height,this.info.format,this.info.type,t),r.bindTexture(r.TEXTURE_2D,null)}destroy(){this.destroyed||(this.gl.deleteTexture(this.glTexture),this.destroyed=!0)}}class it{constructor(t,r){B(this,"_s");B(this,"glSampler");const n=t.createSampler();if(!n)throw new Error("webgl2 device: gl.createSampler failed");this.glSampler=n;const o=(r==null?void 0:r.filter)==="nearest"?t.NEAREST:t.LINEAR;t.samplerParameteri(n,t.TEXTURE_MIN_FILTER,o),t.samplerParameteri(n,t.TEXTURE_MAG_FILTER,o),t.samplerParameteri(n,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.samplerParameteri(n,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this._s=n}}class Wt{constructor(t,r){B(this,"_p");B(this,"program");B(this,"targetFormat");this.program=t,this.targetFormat=r,this._p=t}}class $t{constructor(t){B(this,"_b");B(this,"entries");this.entries=t,this._b=t}destroy(){}}class zt{constructor(t){B(this,"canvas");B(this,"hdr",!1);this.canvas=t}configure(t,r){this.canvas.width=t,this.canvas.height=r}getCurrentTextureView(){return null}}function Ht(e,t,r,n){const o=e.getUniformLocation(t,`u_bind${r}`);if(!o)return;if(n instanceof Int32Array)switch(n.length){case 1:e.uniform1iv(o,n);return;case 2:e.uniform2iv(o,n);return;case 3:e.uniform3iv(o,n);return;case 4:e.uniform4iv(o,n);return;default:e.uniform1iv(o,n);return}const a=n instanceof Float32Array?n:new Float32Array(n.buffer,n.byteOffset,n.byteLength/4);switch(a.length){case 1:e.uniform1fv(o,a);return;case 2:e.uniform2fv(o,a);return;case 3:e.uniform3fv(o,a);return;case 4:e.uniform4fv(o,a);return;case 16:e.uniformMatrix4fv(o,!1,a);return;default:e.uniform1fv(o,a);return}}const st=new WeakSet;function qt(e){st.has(e)||(st.add(e),e.addEventListener("webglcontextlost",t=>{t.preventDefault()},!1))}function Be(){let e=null,t=null,r=null,n=null;const o=Xt();function a(l){r=l.createFramebuffer(),n=l.createVertexArray(),l.getExtension("OES_texture_float_linear"),l.getExtension("EXT_color_buffer_float")}function g(l,u){if(e=l,t=u,qt(u),!l.isContextLost()){a(l);return}r=null,n=null;const b=()=>{u.removeEventListener("webglcontextrestored",b),e===l&&a(l)};u.addEventListener("webglcontextrestored",b,!1)}function m(){if(e)return e;const l=document.createElement("canvas");l.width=1,l.height=1;const u=l.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!u)throw new Error("webgl2 device: WebGL2 is not supported in this browser");return g(u,l),u}function w(l,u){if("canvas"in u)return l.bindFramebuffer(l.FRAMEBUFFER,null),{width:u.canvas.width,height:u.canvas.height,isFloat:!1};const b=u;l.bindFramebuffer(l.FRAMEBUFFER,r),l.framebufferTexture2D(l.FRAMEBUFFER,l.COLOR_ATTACHMENT0,l.TEXTURE_2D,b.glTexture,0);const i=l.checkFramebufferStatus(l.FRAMEBUFFER);if(i!==l.FRAMEBUFFER_COMPLETE)throw new Error(`webgl2 device: framebuffer incomplete for target texture (format=${b.format}, status=0x${i.toString(16)}). Float formats need EXT_color_buffer_float as a render target (capabilities.float16=${o.float16}).`);return{width:b.width,height:b.height,isFloat:Bt(b.format)}}return{backend:"webgl2",capabilities:o,createTexture(l,u,b){const i=m();return new at(i,l,u,b)},createSampler(l){const u=m();return new it(u,l)},createRenderPipeline(l){const u=m(),{vertex:b,fragment:i}=Nt(l.shaderGLSL),x=Vt(u,b,i);return new Wt(x,l.targetFormat)},createComputePipeline:void 0,createBindGroup(l,u){return new $t(u)},createSurface(l,u){var b;if(e&&t&&t!==l)throw new Error("webgl2 device: this device already owns a WebGL2 context bound to a different canvas. WebGL2 has no cross-canvas resource sharing — create one createWebGL2Device() per on-screen canvas (see engine/pool.ts).");if(!e){const i=l.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!i)throw new Error("webgl2 device: WebGL2 is not supported on the given canvas");i.isContextLost()&&((b=i.getExtension("WEBGL_lose_context"))==null||b.restoreContext()),g(i,l)}if("drawingBufferColorSpace"in e)try{e.drawingBufferColorSpace="display-p3"}catch{}return new zt(l)},renderFullscreen(l,u,b){const i=m(),x=u,c=b,{width:d,height:E}=w(i,l);i.viewport(0,0,d,E),i.disable(i.DEPTH_TEST),i.disable(i.BLEND),i.disable(i.CULL_FACE),i.useProgram(x.program),i.bindVertexArray(n);for(const p of c.entries){const y=p.resource;if(y instanceof at){i.activeTexture(i.TEXTURE0+p.binding),i.bindTexture(i.TEXTURE_2D,y.glTexture);const T=i.getUniformLocation(x.program,`t_bind${p.binding}`);T&&i.uniform1i(T,p.binding)}else y instanceof it?i.bindSampler(p.binding,y.glSampler):Ht(i,x.program,p.binding,y.uniform)}i.drawArrays(i.TRIANGLES,0,3),i.bindVertexArray(null),i.bindFramebuffer(i.FRAMEBUFFER,null)},async readback(l){const u=m(),{width:b,height:i,isFloat:x}=w(u,l);if(x){const d=new Float32Array(b*i*4);return u.readPixels(0,0,b,i,u.RGBA,u.FLOAT,d),u.bindFramebuffer(u.FRAMEBUFFER,null),d}const c=new Uint8Array(b*i*4);return u.readPixels(0,0,b,i,u.RGBA,u.UNSIGNED_BYTE,c),u.bindFramebuffer(u.FRAMEBUFFER,null),c},destroy(){if(!e)return;r&&e.deleteFramebuffer(r),n&&e.deleteVertexArray(n);const l=e.getExtension("WEBGL_lose_context");l==null||l.loseContext(),e=null,t=null,r=null,n=null},isContextLost(){return e?e.isContextLost():!1}}}const Ne=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function ct(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"opaque",usage:Ne}),{hdr:!1,format:r}}function Yt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"opaque",usage:Ne}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"opaque",usage:Ne}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return ct(e,t)}}}const Kt=`
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
`;function Ve(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function ut(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function jt(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let o;return r===0?o=n/1024*Math.pow(2,-14):r===31?o=n?NaN:1/0:o=(1+n/1024)*Math.pow(2,r-15),t?-o:o}const Zt={texture:0,sampler:1,uniform:2};function Xe(e,t){return e*3+Zt[t]}const Jt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Qt(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const o=Number(n[1]),a=n[2]!==void 0,g=n[3].trim();if(a){const m=Jt[g];if(m===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${g}" (binding ${o}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(o,{kind:"uniform",sizeBytes:m})}else g==="sampler"||g==="sampler_comparison"?t.set(o,{kind:"sampler"}):t.set(o,{kind:"texture"})}return t}class lt{constructor(t,r,n,o){B(this,"width");B(this,"height");B(this,"format");B(this,"gpuTexture");B(this,"device");B(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=o,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:Ve(o),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*ut(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class dt{constructor(t){B(this,"_s");B(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class er{constructor(t,r,n,o,a){B(this,"_p");B(this,"gpuPipeline");B(this,"bindings");B(this,"bindGroupLayout");B(this,"variants");B(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=a,this.variants=new Map([[o,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function tr(e,t){const r=[];for(const[n,o]of t)o.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):o.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class rr{constructor(t){B(this,"_c");B(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class nr{constructor(t,r){B(this,"_b");B(this,"gpuBindGroup");B(this,"ownedBuffers");B(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class or{constructor(t,r,n,o){B(this,"canvas");B(this,"hdr");B(this,"format");B(this,"context");B(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=o}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function Ue(e){return"canvas"in e}async function ar(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function o(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function a(i){return Ue(i)?i.getCurrentTextureView():i.gpuTexture.createView()}function g(i){if(Ue(i))return{width:i.canvas.width,height:i.canvas.height};const x=i;return{width:x.width,height:x.height}}let m=!1;const w=256;let h=null,l=null;function u(){if(!h||!l){const i=t.createShaderModule({code:Kt});l=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const x=t.createPipelineLayout({bindGroupLayouts:[l]});h=t.createComputePipeline({layout:x,compute:{module:i,entryPoint:"cs_main"}})}return{pipeline:h,layout:l}}return{backend:"webgpu",capabilities:r,createTexture(i,x,c){return new lt(t,i,x,c)},createSampler(i){const x=(i==null?void 0:i.filter)==="linear"?"linear":"nearest",c=t.createSampler({magFilter:x,minFilter:x,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new dt(c)},createRenderPipeline(i){const x=t.createShaderModule({code:i.shaderWGSL}),c=Qt(i.shaderWGSL),d=Ve(i.targetFormat),E=tr(t,c),p=t.createPipelineLayout({bindGroupLayouts:[E]}),y=R=>t.createRenderPipeline({layout:p,vertex:{module:x,entryPoint:"vs_main"},fragment:{module:x,entryPoint:"fs_main",targets:[{format:R}]},primitive:{topology:"triangle-list"}}),T=y(d);return new er(T,c,E,d,y)},createComputePipeline(i){const x=t.createShaderModule({code:i.shaderWGSL}),c=t.createComputePipeline({layout:"auto",compute:{module:x,entryPoint:"cs_main"}});return new rr(c)},createBindGroup(i,x){const c=i,d=new Map,E=[];for(const[y,T]of c.bindings)if(T.kind==="uniform"){const R=t.createBuffer({size:T.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});E.push(R),d.set(y,{binding:y,resource:{buffer:R}})}else T.kind==="sampler"&&d.set(y,{binding:y,resource:o()});for(const y of x){const T=y.resource;if(T instanceof lt){const R=Xe(y.binding,"texture");c.bindings.has(R)&&d.set(R,{binding:R,resource:T.gpuTexture.createView()})}else if(T instanceof dt){const R=Xe(y.binding,"sampler");c.bindings.has(R)&&d.set(R,{binding:R,resource:T.gpuSampler})}else{const R=Xe(y.binding,"uniform"),G=c.bindings.get(R);if(G&&G.kind==="uniform"){const F=T.uniform,O=t.createBuffer({size:Math.max(G.sizeBytes,F.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(O,0,F.buffer,F.byteOffset,F.byteLength),E.push(O),d.set(R,{binding:R,resource:{buffer:O}})}}}const p=t.createBindGroup({layout:c.bindGroupLayout,entries:Array.from(d.values())});return new nr(p,E)},createSurface(i,x){const c=i.getContext("webgpu");if(!c)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const d=x.hdr&&r.hdr,E=()=>d?Yt(c,t):ct(c,t),p=E();return new or(i,c,p,E)},renderFullscreen(i,x,c){const d=x,E=c,p=a(i),{width:y,height:T}=g(i),R=Ue(i)?i.format:Ve(i.format),G=d.pipelineFor(R),F=t.createCommandEncoder(),O=F.beginRenderPass({colorAttachments:[{view:p,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});O.setPipeline(G),O.setBindGroup(0,E.gpuBindGroup),O.setViewport(0,0,y,T,0,1),O.draw(3),O.end(),t.queue.submit([F.finish()])},async readback(i){const x=Ue(i),{width:c,height:d}=g(i),E=x?i.hdr?"rgba16float":"rgba8unorm":i.format,p=x&&i.format==="bgra8unorm",y=x?i.getCurrentGPUTexture():i.gpuTexture,T=ut(E),R=c*T,G=256,F=Math.ceil(R/G)*G,O=F*d,z=t.createBuffer({size:O,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),H=t.createCommandEncoder();H.copyTextureToBuffer({texture:y},{buffer:z,bytesPerRow:F,rowsPerImage:d},{width:c,height:d,depthOrArrayLayers:1}),t.queue.submit([H.finish()]),await z.mapAsync(GPUMapMode.READ);const D=new Uint8Array(z.getMappedRange()),A=new Uint8Array(R*d);for(let L=0;L<d;L++){const k=L*F,V=L*R;A.set(D.subarray(k,k+R),V)}if(z.unmap(),z.destroy(),E==="rgba8unorm"){if(p)for(let L=0;L<A.length;L+=4){const k=A[L],V=A[L+2];A[L]=V,A[L+2]=k}return A}if(E==="rgba16float"){const L=new Uint16Array(A.buffer,A.byteOffset,A.byteLength/2),k=new Float32Array(L.length);for(let V=0;V<L.length;V++)k[V]=jt(L[V]);return k}return new Float32Array(A.buffer,A.byteOffset,A.byteLength/4)},async reduceDiffSumSquaredAbs(i,x,c,d){const E=i,p=x,y=Math.max(0,c*d),T=Math.max(1,Math.ceil(y/w)),{pipeline:R,layout:G}=u(),F=T*2*4,O=t.createBuffer({size:F,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),z=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(z,0,new Uint32Array([Math.max(1,c),Math.max(1,d),y,0]));const H=t.createBindGroup({layout:G,entries:[{binding:0,resource:E.gpuTexture.createView()},{binding:1,resource:p.gpuTexture.createView()},{binding:2,resource:{buffer:O}},{binding:3,resource:{buffer:z}}]}),D=t.createBuffer({size:F,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),A=t.createCommandEncoder(),L=A.beginComputePass();L.setPipeline(R),L.setBindGroup(0,H),L.dispatchWorkgroups(T),L.end(),A.copyBufferToBuffer(O,0,D,0,F),t.queue.submit([A.finish()]),await D.mapAsync(GPUMapMode.READ);const V=new Float32Array(D.getMappedRange()).slice();D.unmap(),D.destroy(),O.destroy(),z.destroy();let ee=0,te=0;for(let Q=0;Q<T;Q++)ee+=V[Q*2],te+=V[Q*2+1];return{sumSq:ee,sumAbs:te}},destroy(){m||(t.destroy(),m=!0)},isContextLost(){return!1}}}let We=null;function ir(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceWebGL2")}catch{return!1}}async function sr(e){if(!e&&typeof navigator<"u"&&"gpu"in navigator&&!!navigator.gpu)try{return await ar()}catch{}return Be()}function Oe(e){if(!We){const t=ir();We=sr(t)}return We}function cr(e,t,r){return[e[0]+(t[0]-e[0])*r,e[1]+(t[1]-e[1])*r,e[2]+(t[2]-e[2])*r]}function ur(e){const t=new Uint8Array(768);for(let r=0;r<256;r++){const o=r/255*(e.length-1),a=Math.floor(o),g=Math.min(a+1,e.length-1),m=o-a,[w,h,l]=cr(e[a],e[g],m);t[r*3]=Math.round(w),t[r*3+1]=Math.round(h),t[r*3+2]=Math.round(l)}return t}const ft={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},mt=new Set(["red-green","red-blue"]),ht=new Map;function $e(e){let t=ht.get(e);if(!t){const r=ft[e]??ft.viridis;t=ur(r),ht.set(e,t)}return t}function ze(e,t,r="linear"){const n=$e(t),o=new ImageData(e.width,e.height),a=e.data,g=o.data;for(let m=0;m<a.length;m+=4){const w=(a[m]+a[m+1]+a[m+2])/3;let h;r==="positive"?h=Math.round(128+w/255*127):h=Math.round(w),h=Math.max(0,Math.min(255,h)),g[m]=n[h*3],g[m+1]=n[h*3+1],g[m+2]=n[h*3+2],g[m+3]=a[m+3]}return o}function gt(e){const t=new Map;return{get(r){return t.get(r)},set(r,n){if(t.size>=e){const o=t.keys().next().value;o!==void 0&&t.delete(o)}t.set(r,n)}}}const pt=gt(50);function He(e){return pt.get(e)}function qe(e,t){pt.set(e,t)}const vt=gt(100);function lr(e){return vt.get(e)}function dr(e,t){vt.set(e,t)}function fr(e,t,r){const n=Math.min(e.width,t.width),o=Math.min(e.height,t.height),a=new ImageData(n,o);for(let g=0;g<o;g++)for(let m=0;m<n;m++){const w=(g*e.width+m)*4,h=(g*t.width+m)*4,l=(g*n+m)*4;for(let u=0;u<3;u++){const b=e.data[w+u],i=t.data[h+u],x=b-i,c=Math.abs(x),d=Math.max(b,1);let E;switch(r){case"signed":E=(x+255)/2;break;case"absolute":E=c;break;case"squared":E=x*x/255;break;case"relative_signed":E=(x/d+1)*127.5;break;case"relative_absolute":E=c/d*255;break;case"relative_squared":E=x*x/(d*d)*255;break}a.data[l+u]=Math.min(255,Math.max(0,Math.round(E)))}a.data[l+3]=255}return a}async function Pe(e){const t=lr(e);return t||new Promise(r=>{const n=new Image;n.onload=()=>{try{const o=document.createElement("canvas");o.width=n.naturalWidth,o.height=n.naturalHeight;const a=o.getContext("2d");if(!a){r(null);return}a.drawImage(n,0,0);const g=a.getImageData(0,0,o.width,o.height);dr(e,g),r(g)}catch(o){console.warn("[cairn] loadImageData failed:",o),r(null)}},n.onerror=o=>{console.warn("[cairn] loadImageData: image failed to load:",e,o),r(null)},n.src=e})}const mr={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},hr={linear:0,signed:1,positive:2},gr=`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,pr=`#version 300 es
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
}`;let Ce=null,N=null,ge=null,ke=null;function vr(){if(N)return N;try{if(typeof OffscreenCanvas<"u"?Ce=new OffscreenCanvas(1,1):Ce=document.createElement("canvas"),N=Ce.getContext("webgl2",{preserveDrawingBuffer:!0}),!N)return console.warn("[cairn] WebGL 2 not available"),null;const e=N.createShader(N.VERTEX_SHADER);if(N.shaderSource(e,gr),N.compileShader(e),!N.getShaderParameter(e,N.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",N.getShaderInfoLog(e)),null;const t=N.createShader(N.FRAGMENT_SHADER);if(N.shaderSource(t,pr),N.compileShader(t),!N.getShaderParameter(t,N.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",N.getShaderInfoLog(t)),null;if(ge=N.createProgram(),N.attachShader(ge,e),N.attachShader(ge,t),N.linkProgram(ge),!N.getProgramParameter(ge,N.LINK_STATUS))return console.error("[cairn] WebGL program link:",N.getProgramInfoLog(ge)),null;ke=N.createVertexArray(),N.bindVertexArray(ke);const r=N.createBuffer();N.bindBuffer(N.ARRAY_BUFFER,r),N.bufferData(N.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),N.STATIC_DRAW);const n=N.getAttribLocation(ge,"a_pos");return N.enableVertexAttribArray(n),N.vertexAttribPointer(n,2,N.FLOAT,!1,0,0),N.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),N}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function bt(e,t,r){const n=e.createTexture();return e.activeTexture(e.TEXTURE0+r),e.bindTexture(e.TEXTURE_2D,n),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),n}function br(e,t,r){const n=new Uint8Array(1024);for(let a=0;a<256;a++)n[a*4]=t[a*3],n[a*4+1]=t[a*3+1],n[a*4+2]=t[a*3+2],n[a*4+3]=255;const o=e.createTexture();return e.activeTexture(e.TEXTURE0+r),e.bindTexture(e.TEXTURE_2D,o),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,n),o}function xr(e,t,r,n){const o=vr();if(!o||!ge||!ke||!Ce)return null;const a=Math.min(e.width,t.width),g=Math.min(e.height,t.height);Ce.width=a,Ce.height=g,o.viewport(0,0,a,g);const m=bt(o,e,0),w=bt(o,t,1);let h=null;r.colormap?h=br(o,r.colormap,2):(h=o.createTexture(),o.activeTexture(o.TEXTURE2),o.bindTexture(o.TEXTURE_2D,h),o.texImage2D(o.TEXTURE_2D,0,o.RGBA8,1,1,0,o.RGBA,o.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),o.useProgram(ge),o.uniform1i(o.getUniformLocation(ge,"u_baseline"),0),o.uniform1i(o.getUniformLocation(ge,"u_other"),1),o.uniform1i(o.getUniformLocation(ge,"u_lut"),2),o.uniform1i(o.getUniformLocation(ge,"u_diff_mode"),mr[r.diffMode]),o.uniform1i(o.getUniformLocation(ge,"u_cmap_mode"),hr[r.cmapMode]??0),o.uniform1i(o.getUniformLocation(ge,"u_use_colormap"),r.colormap?1:0),o.bindVertexArray(ke),o.drawArrays(o.TRIANGLE_STRIP,0,4),o.bindVertexArray(null),n.width=a,n.height=g;const l=n.getContext("2d");return l&&(l.save(),l.scale(1,-1),l.drawImage(Ce,0,0,a,g,0,-g,a,g),l.restore()),o.deleteTexture(m),o.deleteTexture(w),o.deleteTexture(h),{width:a,height:g}}const wr={cardSettings:(e,t,r)=>`cairn:card-settings:${e}:${t}:${r}`,runLayout:e=>`cairn:run-layout:${e}`,collapsedSections:e=>`cairn:collapsed-sections:${e}`,comparisons:e=>`cairn:comparisons:${e}`,comparisonTemplates:e=>`cairn:comparison-templates:${e}`,reportTemplates:e=>`cairn:report-templates:${e}`,streamMode:"cairn:stream-mode",renderMode:"cairn:render-mode",scroll:e=>`cairn:scroll:${e}`,lastComparison:e=>`cairn:last-comparison:${e}`};function Er(){try{const e=localStorage.getItem(wr.renderMode);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const be=e=>e<0?0:e>1?1:e,Ye=e=>{const t=e<0?0:e;return t/(1+t)},Ke=e=>{const t=e<0?0:e,r=t*(2.51*t+.03),n=t*(2.43*t+.59)+.14;return be(r/n)},xt={linear:([e,t,r])=>[be(e),be(t),be(r)],srgb:([e,t,r])=>[be(e),be(t),be(r)],reinhard:([e,t,r])=>[Ye(e),Ye(t),Ye(r)],aces:([e,t,r])=>[Ke(e),Ke(t),Ke(r)],extended:([e,t,r])=>[e,t,r]},_r="srgb";function yr(e){return e&&xt[e]||xt[_r]}function je(e,t){return e*2**t}function Tr(e){const t=be(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function Ze(e,t){return typeof t=="number"&&t>0?be(Math.pow(be(e),1/t)):Tr(e)}function wt(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Je({naturalWidth:e,naturalHeight:t,zoom:r=1,containerRef:n}){const o=wt(e),a=wt(t),g=[];for(let p=0;p<=e;p+=o)g.push(p);const m=[];for(let p=0;p<=t;p+=a)m.push(p);const w=1/r,h=8*w,l=-12*w,u=-2*w,b=n==null?void 0:n.current;let i=0,x=0,c=0,d=0;if(b){const p=b.clientWidth,y=b.clientHeight,T=p/e,R=y/t,G=Math.min(T,R);c=e*G,d=t*G,i=(p-c)/2,x=(y-d)/2}const E=b&&c>0;return f.jsxs(f.Fragment,{children:[f.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:E?x:0,transform:`translateY(${l}px)`,fontSize:h},children:g.map(p=>f.jsx("span",{className:"mono",style:{position:"absolute",left:E?i+p/e*c:`${p/e*100}%`,transform:"translateX(-50%)"},children:p},p))}),f.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:E?i:0,transform:`translateX(${u}px)`,fontSize:h},children:m.map(p=>f.jsx("span",{className:"mono",style:{position:"absolute",top:E?x+p/t*d:`${p/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*w}px`},children:p},p))})]})}function Qe({label:e,isDraggable:t,onDragStart:r}){return f.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:r,style:{cursor:t?"grab":void 0},children:[t&&f.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const Et=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function et(e){const t=Et.length;return Et[(e%t+t)%t]}function Rr(e){const r=s.useRef(null),[n,o]=s.useState({w:0,h:0}),a=s.useRef(null),g=s.useRef(null);return s.useEffect(()=>{var h;const m=r.current;if(m===g.current||((h=a.current)==null||h.disconnect(),a.current=null,g.current=m,!m))return;const w=new ResizeObserver(l=>{for(const u of l)o({w:u.contentRect.width,h:u.contentRect.height})});a.current=w,w.observe(m)}),s.useEffect(()=>()=>{var m;return(m=a.current)==null?void 0:m.disconnect()},[]),{ref:r,size:n}}function Sr(){const[e,t]=s.useState(!1);return s.useEffect(()=>{const r=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!0)},n=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!1)},o=()=>t(!1);return window.addEventListener("keydown",r),window.addEventListener("keyup",n),window.addEventListener("blur",o),()=>{window.removeEventListener("keydown",r),window.removeEventListener("keyup",n),window.removeEventListener("blur",o)}},[]),e}const Pr=.25,Cr=16;function Me(e){const{containerRef:t,zoom:r,pan:n,onViewportChange:o,minZoom:a=Pr,maxZoom:g=Cr}=e,m=Sr(),w=s.useRef(m);w.current=m;const h=s.useRef({zoom:r,pan:n});h.current={zoom:r,pan:n};const l=s.useRef(o);l.current=o,s.useEffect(()=>{const d=t.current;if(!d||!o)return;const E=p=>{var D;if(!w.current)return;p.preventDefault(),p.stopPropagation();const y=p.deltaY<0?1.1:1/1.1,T=h.current,R=Math.max(a,Math.min(g,T.zoom*y));if(T.zoom===R)return;const G=d.getBoundingClientRect(),F=p.clientX-G.left,O=p.clientY-G.top,z=F-(F-T.pan.x)/T.zoom*R,H=O-(O-T.pan.y)/T.zoom*R;(D=l.current)==null||D.call(l,{zoom:R,pan:{x:z,y:H}})};return d.addEventListener("wheel",E,{passive:!1}),()=>d.removeEventListener("wheel",E)},[t,!!o,a,g]);const u=s.useRef(null),b=s.useCallback(d=>{!w.current||!l.current||(d.currentTarget.setPointerCapture(d.pointerId),u.current={pointerId:d.pointerId,startX:d.clientX,startY:d.clientY,panX:h.current.pan.x,panY:h.current.pan.y})},[]),i=s.useCallback(d=>{var T;const E=u.current;if(!E||E.pointerId!==d.pointerId)return;const p=d.clientX-E.startX,y=d.clientY-E.startY;(T=l.current)==null||T.call(l,{zoom:h.current.zoom,pan:{x:E.panX+p,y:E.panY+y}})},[]),x=s.useCallback(d=>{const E=u.current;if(!(!E||E.pointerId!==d.pointerId)){try{d.currentTarget.releasePointerCapture(d.pointerId)}catch{}u.current=null}},[]),c=m&&!!o;return{containerProps:{onPointerDown:b,onPointerMove:i,onPointerUp:x,onPointerCancel:x,style:{cursor:c?"move":void 0,touchAction:c?"none":void 0}},modifierActive:m}}function Ar(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function _t(e,t,r){return!(r.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function tt({data:e,settings:t,naturalWidth:r,naturalHeight:n}){const{ref:o,size:a}=Rr(),g=s.useRef(null),m=s.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),w=s.useMemo(()=>{const c=a.w,d=a.h;if(c<=0||d<=0||r<=0||n<=0)return null;const E=Math.min(c/r,d/n),p=r*E,y=n*E;return{left:(c-p)/2,top:(d-y)/2,width:p,height:y}},[a.w,a.h,r,n]),h=e.masks,l=t.showMasks&&!!h&&h.length>0,u=s.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(s.useEffect(()=>{if(!l||!h)return;const c=g.current;if(!c)return;(c.width!==r||c.height!==n)&&(c.width=r,c.height=n);const d=c.getContext("2d");if(!d)return;d.clearRect(0,0,c.width,c.height);let E=!1;const p=d.createImageData(r,n),y=p.data;let T=h.length,R=!1;const G=()=>{E||R&&d.putImageData(p,0,0)},F=document.createElement("canvas");F.width=r,F.height=n;const O=F.getContext("2d",{willReadFrequently:!0});for(const z of h){const H=new Image;H.onload=()=>{if(!E){if(O){O.clearRect(0,0,r,n),O.drawImage(H,0,0,r,n);const D=O.getImageData(0,0,r,n).data;for(let A=0;A<r*n;A++){const L=D[A*4];if(L===0||m.has(L))continue;const[k,V,ee]=Ar(et(L));y[A*4]=k,y[A*4+1]=V,y[A*4+2]=ee,y[A*4+3]=255,R=!0}}T-=1,T===0&&G()}},H.onerror=()=>{T-=1,T===0&&G()},H.src=`data:image/png;base64,${z.png_b64}`}return()=>{E=!0}},[l,h,r,n,u]),!w)return f.jsx("div",{ref:o,className:"absolute inset-0 pointer-events-none"});const b=e.boxes??[],i=t.showBoxes&&b.length>0,x=e.class_labels??{};return f.jsxs("div",{ref:o,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[l&&f.jsx("canvas",{ref:g,className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),i&&f.jsx("svg",{className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height,overflow:"visible"},viewBox:`0 0 ${r} ${n}`,preserveAspectRatio:"none",children:b.map((c,d)=>{if(!_t(c,t,m))return null;const E=c.domain==="pixel"?1:r,p=c.domain==="pixel"?1:n,y=c.position.minX*E,T=c.position.minY*p,R=(c.position.maxX-c.position.minX)*E,G=(c.position.maxY-c.position.minY)*p;return f.jsx("rect",{x:y,y:T,width:R,height:G,fill:"none",stroke:et(c.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},d)})}),i&&f.jsx("div",{className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height},children:b.map((c,d)=>{if(!_t(c,t,m))return null;const E=c.domain==="pixel"?1/r:1,p=c.domain==="pixel"?1/n:1,y=c.position.minX*E*100,T=c.position.minY*p*100,R=c.label??x[String(c.class_id)]??`#${c.class_id}`,G=c.score!=null?` ${(c.score*100).toFixed(0)}%`:"";return!R&&!G?null:f.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${y}%`,top:`${T}%`,transform:"translateY(-100%)",backgroundColor:et(c.class_id)},children:f.jsxs("span",{className:"mono",children:[R,G]})},d)})})]})}const Dr=30,ie=["#ff5a5a","#39d353","#5b9bff"];function rt(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function Z(e,t,r){return t==="uint8"?r==="int"?String(Math.round(e)):rt(e/255):rt(r==="int"?e*255:e)}const Mr={x:0,y:0,w:1,h:1};function we({imageElRef:e,naturalWidth:t,naturalHeight:r,zoom:n,pan:o,sample:a,notation:g="decimal",version:m=0,onActiveChange:w,sourceWindow:h=Mr}){const l=s.useRef(null),u=s.useRef(!1),b=s.useRef(w);b.current=w;const i=s.useCallback(c=>{var d;c!==u.current&&(u.current=c,(d=b.current)==null||d.call(b,c))},[]),x=s.useCallback(()=>{var de;const c=l.current,d=e.current;if(!c)return;const E=window.devicePixelRatio||1,p=c.clientWidth,y=c.clientHeight;if(p===0||y===0)return;c.width!==Math.round(p*E)&&(c.width=Math.round(p*E)),c.height!==Math.round(y*E)&&(c.height=Math.round(y*E));const T=c.getContext("2d");if(!T)return;if(T.setTransform(E,0,0,E,0,0),T.clearRect(0,0,p,y),!d||t<=0||r<=0){i(!1);return}const R=d.getBoundingClientRect(),G=c.getBoundingClientRect();if(R.width===0||R.height===0){i(!1);return}const F=h.x*t,O=h.y*r,z=h.w*t,H=h.h*r;if(z<=0||H<=0){i(!1);return}const D=Math.min(R.width/z,R.height/H);if(D<Dr){i(!1);return}const A=z*D,L=H*D,k=R.left+(R.width-A)/2-G.left,V=R.top+(R.height-L)/2-G.top,ee=Math.max(Math.floor(F),Math.floor(F+(0-k)/D)),te=Math.min(Math.ceil(F+z),Math.ceil(F+(p-k)/D)),Q=Math.max(Math.floor(O),Math.floor(O+(0-V)/D)),ce=Math.min(Math.ceil(O+H),Math.ceil(O+(y-V)/D));if(te<=ee||ce<=Q){i(!1);return}i(!0),T.textAlign="center",T.textBaseline="middle",T.lineJoin="round";const ue=D*.14,le=D-ue*2;for(let K=Q;K<ce;K++)for(let fe=ee;fe<te;fe++){const re=a(fe,K,g);if(!re||re.lines.length===0)continue;const oe=re.lines.length;let pe=1;for(const I of re.lines)I.length>pe&&(pe=I.length);const me=le/(oe*1.15),ve=le/(pe*.62)||me,q=Math.min(me,ve,24);if(q<6)continue;const v=k+(fe-F+.5)*D,P=V+(K-O+.5)*D,C=q*1.15,_=re.luminance<=.55,S=_?"#ffffff":"#000000";T.font=`${q}px ui-monospace, SFMono-Regular, Menlo, monospace`,T.lineWidth=Math.max(1.4,q*.16),T.strokeStyle=_?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let M=P-oe*C/2+C/2;for(let I=0;I<re.lines.length;I++){const J=re.lines[I];T.strokeText(J,v,M),T.fillStyle=((de=re.colors)==null?void 0:de[I])??S,T.fillText(J,v,M),M+=C}}},[e,t,r,a,g,i,h]);return s.useEffect(()=>{x()},[x,n,o.x,o.y,m,g,h]),s.useEffect(()=>{const c=l.current;if(!c)return;const d=new ResizeObserver(()=>x());return d.observe(c),()=>d.disconnect()},[x]),f.jsx("canvas",{ref:l,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Ie({notation:e,onChange:t,className:r=""}){return f.jsx("button",{type:"button",onClick:n=>{n.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:n=>n.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${r}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const Ir=`
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
`,Lr=`#pragma vertex
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
`,Gr=`
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
`,Fr=`#pragma vertex
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
`,nt={linear:0,srgb:1,reinhard:2,aces:3,extended:4},yt=new WeakMap;function Ur(e,t){let r=yt.get(e);r||(r=new Map,yt.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:Ir,shaderGLSL:Lr,targetFormat:t}),r.set(t,n)),n}function Tt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Rt(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function Or(e,t,r,n){var i;const o=Tt(t),a=Ur(e,o),g=Rt(e,n.isScalar?n.colormap:void 0),m=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,w=nt[n.operator]??nt.srgb,h=new Float32Array([n.exposureEV,w,m,n.isScalar?1:0]),l=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),u=new Float32Array([n.hdrOut?1:0]);let b;try{b=e.createBindGroup(a,[{binding:0,resource:r},{binding:1,resource:g},{binding:2,resource:{uniform:h}},{binding:3,resource:{uniform:l}},{binding:4,resource:{uniform:u}}]),e.renderFullscreen(t,a,b)}finally{(i=b==null?void 0:b.destroy)==null||i.call(b),g.destroy()}}const kr={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Br={linear:0,signed:1,positive:2},Nr={split:0,blend:1,diff:2},St=new WeakMap;function Vr(e,t){let r=St.get(e);r||(r=new Map,St.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:Gr,shaderGLSL:Fr,targetFormat:t}),r.set(t,n)),n}function Xr(e,t,r,n,o){var E;const a=Tt(t),g=Vr(e,a),m=o.mode==="diff"&&!!o.diffColormap,w=m?o.diffColormap:void 0,h=Rt(e,w),l=o.gamma,u=nt[o.operator],b=new Float32Array([o.exposureEV,u,l,0]),i=new Float32Array([o.uv.x,o.uv.y,o.uv.w,o.uv.h]),x=new Float32Array([Nr[o.mode],o.split,o.alpha,kr[o.diffSubmode]??0]),c=new Float32Array([Br[o.diffCmapMode??"linear"]??0,0,m?1:0,0]);let d;try{d=e.createBindGroup(g,[{binding:0,resource:r},{binding:1,resource:n},{binding:2,resource:h},{binding:3,resource:{uniform:b}},{binding:4,resource:{uniform:i}},{binding:5,resource:{uniform:x}},{binding:6,resource:{uniform:c}}]),e.renderFullscreen(t,g,d)}finally{(E=d==null?void 0:d.destroy)==null||E.call(d),h.destroy()}}function Pt(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,o=t/r,a=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:a,mae:o}}async function Wr(e,t,r){const n=Math.min(t.width,r.width),o=Math.min(t.height,r.height),a=n*o*3;if(a<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:b,sumAbs:i}=await e.reduceDiffSumSquaredAbs(t,r,n,o);return Pt(b,i,a)}const g=await e.readback(t),m=await e.readback(r),w=g instanceof Uint8Array,h=m instanceof Uint8Array;let l=0,u=0;for(let b=0;b<o;b++)for(let i=0;i<n;i++){const x=(b*t.width+i)*4,c=(b*r.width+i)*4;for(let d=0;d<3;d++){const E=(g[x+d]??0)/(w?255:1),p=(m[c+d]??0)/(h?255:1),y=E-p;l+=y*y,u+=Math.abs(y)}}return Pt(l,u,a)}function Ct(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const $r=12,ye=[];function At(e){const t=ye.indexOf(e);t!==-1&&ye.splice(t,1),ye.push(e)}function zr(e){const t=ye.indexOf(e);t!==-1&&ye.splice(t,1)}function Le(e){e.parked||(zr(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.device&&e.device!==e.sharedDevice&&e.device.destroy(),e.device=null,e.parked=!0)}function Dt(e){for(;ye.length>$r;){const t=ye.find(r=>r!==e&&!r.visible)??ye.find(r=>r!==e);if(!t)break;Le(t)}}function Mt(e){if(e.disposed)return;if(Ct())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){At(e),Dt(e);return}const t=e.sharedDevice.backend==="webgl2"?Be():e.sharedDevice;if(e.device=t,e.surface=t.createSurface(e.canvas,{hdr:e.hdr}),e.source){e.canvas.width=e.source.width,e.canvas.height=e.source.height,e.surface.configure(e.source.width,e.source.height);const r=t.createTexture(e.source.width,e.source.height,e.source.format);r.write(e.source.data),e.srcTexture=r}e.parked=!1,At(e),Dt(e)}const Hr=30;function It(e,t){var r;if(e.disposed||!e.source)return!0;try{return Mt(e),!e.device||!e.surface||!e.srcTexture?!1:e.device.isContextLost()?(Lt(e,t),!0):(Or(e.device,e.surface,e.srcTexture,t),e.restoreRetries=0,!0)}catch(n){return(r=e.device)!=null&&r.isContextLost()?(Lt(e,t),!0):(console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Le(e),!1)}}function Lt(e,t){if(!e.disposed){if(e.restoreRetries>=Hr){e.restoreRetries=0;return}e.restoreRetries++,Le(e),requestAnimationFrame(()=>It(e,t))}}function qr(e){return{canvas:e.canvas,backend:e.sharedDevice.backend,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.device&&e.surface)){e.canvas.width=t.width,e.canvas.height=t.height,e.surface.configure(t.width,t.height),e.srcTexture&&e.srcTexture.destroy();const r=e.device.createTexture(t.width,t.height,t.format);r.write(t.data),e.srcTexture=r}},render(t){return It(e,t)},park(){e.disposed||Le(e)},restore(){e.disposed||!e.source||Mt(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Le(e),e.source=null,e.disposed=!0)}}}async function Yr(e,t){const r=await Oe(),n={canvas:e,sharedDevice:r,device:null,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,restoreRetries:0};return qr(n)}function Gt(e){e.dispose()}function Kr(e,t){const{brightness:r,contrast:n,exposure:o,flipSign:a}=e;return[`url(#${t})`,`brightness(${(1+r)*Math.pow(2,o)})`,`contrast(${1+n})`,...a?["invert(1)"]:[]].join(" ")}function Ft(e){const r=`cairn-gamma-${s.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:n,contrast:o,gamma:a,exposure:g,offset:m,flipSign:w}=e,h=s.useMemo(()=>Kr(e,r),[r,n,o,g,w]);return{gammaFilterId:r,filterStr:h,gamma:a,offset:m}}function Ut({id:e,gamma:t,offset:r}){return f.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:f.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:f.jsxs("feComponentTransfer",{children:[f.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:r}),f.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:r}),f.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:r})]})})})}const jr={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function Ot({imageUrl:e,baselineUrl:t,isBaseline:r=!1,diffMode:n,interpolation:o,colormap:a,showAxes:g,processing:m=jr,zoom:w=1,pan:h={x:0,y:0},onViewportChange:l,onNaturalSize:u,label:b,isDraggable:i=!1,onDragStart:x,overlay:c,overlaySettings:d,pixelValueNotation:E="decimal"}){var se,ne;const p=s.useRef(null),y=s.useRef(null),T=s.useRef(null),R=s.useRef(null),G=s.useRef(null),F=s.useRef(null),O=s.useRef(null),[z,H]=s.useState(0),D=s.useCallback(()=>H(U=>U+1),[]),[A,L]=s.useState(E),[k,V]=s.useState(!1),ee=s.useCallback(U=>{p.current=U,U&&(G.current=U)},[]),te=s.useCallback(U=>{y.current=U,U&&(G.current=U)},[]),Q=s.useCallback(U=>{U&&(G.current=U)},[]),[ce,ue]=s.useState(!1),[le,de]=s.useState(!1),[K,fe]=s.useState(null),{flipSign:re}=m,{gammaFilterId:oe,filterStr:pe,gamma:me,offset:ve}=Ft(m),q=`translate(${h.x}px, ${h.y}px) scale(${w})`,{containerProps:v}=Me({containerRef:R,zoom:w,pan:h,onViewportChange:l}),P=!r&&n!=="none"&&t!=null&&e!=null,C=n!=="none"&&t!=null,_=a!=="none"&&!P&&!(r&&C)&&e!=null;s.useEffect(()=>{if(!_||!e){de(!1);return}let U=!1;de(!1);const X=`${e}::${a}`,W=He(X);if(W){const $=y.current;if($){$.width=W.width,$.height=W.height;const j=$.getContext("2d");j&&j.putImageData(W,0,0),O.current=W,D(),fe({w:W.width,h:W.height}),u==null||u(W.width,W.height),de(!0)}return}const Y=new Image;return Y.onload=()=>{if(U)return;const $=document.createElement("canvas");$.width=Y.naturalWidth,$.height=Y.naturalHeight;const j=$.getContext("2d");if(!j)return;j.drawImage(Y,0,0);const xe=j.getImageData(0,0,$.width,$.height),Se=mt.has(a)?"positive":"linear",ae=ze(xe,a,Se);qe(X,ae);const Ee=y.current;if(!Ee||U)return;Ee.width=ae.width,Ee.height=ae.height;const he=Ee.getContext("2d");he&&he.putImageData(ae,0,0),O.current=ae,D(),fe({w:ae.width,h:ae.height}),u==null||u(ae.width,ae.height),de(!0)},Y.src=e,()=>{U=!0}},[_,e,a]);const S=s.useCallback((U,X)=>{fe(W=>W&&W.w===U&&W.h===X?W:{w:U,h:X}),u==null||u(U,X)},[]);s.useEffect(()=>{if(!e){F.current=null,O.current=null,D();return}let U=!1;return Pe(e).then(X=>{U||(F.current=X,a==="none"&&(O.current=X),D())}),()=>{U=!0}},[e,a,D]);const M=s.useCallback((U,X,W)=>{const Y=F.current;if(!Y||U<0||X<0||U>=Y.width||X>=Y.height)return null;const $=(X*Y.width+U)*4,j=Y.data[$],xe=Y.data[$+1],Se=Y.data[$+2],ae=O.current;let Ee=j,he=xe,_e=Se;if(ae&&ae.width===Y.width&&ae.height===Y.height){const Ae=(X*ae.width+U)*4;Ee=ae.data[Ae],he=ae.data[Ae+1],_e=ae.data[Ae+2]}const Ge=(.299*Ee+.587*he+.114*_e)/255;return a!=="none"||j===xe&&xe===Se?{lines:[Z(j,"uint8",W)],luminance:Ge}:{lines:[Z(j,"uint8",W),Z(xe,"uint8",W),Z(Se,"uint8",W)],luminance:Ge,colors:[ie[0],ie[1],ie[2]]}},[a]);s.useEffect(()=>{if(!P){ue(!1);return}let U=!1;const X=Er(),W=X==="gpu"||X==="auto",Y=`${t}::${e}::${n}::${a}`;if(X!=="gpu"){const $=He(Y);if($){const j=p.current;if(j){(j.width!==$.width||j.height!==$.height)&&(j.width=$.width,j.height=$.height);const xe=j.getContext("2d");xe&&xe.putImageData($,0,0),S($.width,$.height),ue(!0)}return}}return(async()=>{const[$,j]=await Promise.all([Pe(t),Pe(e)]);if(U||!$||!j)return;const Se=n.includes("signed")?"signed":"positive",ae=a!=="none"?$e(a):null,Ee={diffMode:n,colormap:ae,cmapMode:Se};if(W)try{const Fe=p.current;if(Fe){const Ae=xr($,j,Ee,Fe);if(Ae){if(U)return;S(Ae.width,Ae.height),ue(!0);return}}}catch(Fe){console.warn("[cairn] WebGL 2 diff error:",Fe)}if(X==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let he=fr($,j,n);a!=="none"&&(he=ze(he,a,Se)),qe(Y,he);const _e=p.current;if(!_e||U)return;(_e.width!==he.width||_e.height!==he.height)&&(_e.width=he.width,_e.height=he.height);const Ge=_e.getContext("2d");Ge&&Ge.putImageData(he,0,0),S(he.width,he.height),ue(!0)})(),()=>{U=!0}},[t,e,n,P,a,u]);const I=o==="auto"?void 0:o,J=re?{filter:"invert(1)"}:{};return f.jsxs("div",{className:"relative flex flex-col h-full",children:[f.jsx(Ut,{id:oe,gamma:me,offset:ve}),f.jsxs("div",{ref:R,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:g&&K?"16px 4px 4px 28px":"4px",...v.style},onPointerDown:v.onPointerDown,onPointerMove:v.onPointerMove,onPointerUp:v.onPointerUp,onPointerCancel:v.onPointerCancel,children:[f.jsxs("div",{ref:T,className:"relative w-full h-full",style:{transform:q,transformOrigin:"0 0"},children:[e?P?f.jsxs(f.Fragment,{children:[!ce&&f.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),f.jsx("canvas",{ref:ee,className:"w-full h-full object-contain block",style:{display:ce?"block":"none",imageRendering:I,...J}})]}):_?f.jsxs(f.Fragment,{children:[!le&&f.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),f.jsx("canvas",{ref:te,className:"w-full h-full object-contain block",style:{display:le?"block":"none",imageRendering:I,...J}})]}):f.jsx("img",{ref:Q,src:e,alt:b,className:"w-full h-full object-contain block",draggable:!1,style:{filter:pe,imageRendering:I},onLoad:U=>{const X=U.currentTarget;fe({w:X.naturalWidth,h:X.naturalHeight}),u==null||u(X.naturalWidth,X.naturalHeight)}}):f.jsx("span",{className:"text-xs text-fg-muted",children:"no image"}),g&&K&&f.jsx(Je,{naturalWidth:K.w,naturalHeight:K.h,zoom:w,containerRef:T}),c&&(d==null?void 0:d.enabled)&&K&&e&&((((se=c.boxes)==null?void 0:se.length)??0)>0||(((ne=c.masks)==null?void 0:ne.length)??0)>0)&&f.jsx(tt,{data:c,settings:d,naturalWidth:K.w,naturalHeight:K.h})]}),e&&K&&f.jsx(we,{imageElRef:G,naturalWidth:K.w,naturalHeight:K.h,zoom:w,pan:h,sample:M,notation:A,version:z,onActiveChange:V}),k&&f.jsx(Ie,{notation:A,onChange:L})]}),f.jsx(Qe,{label:b,isDraggable:i,onDragStart:x})]})}function Zr(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`HdrImagePane: unsupported shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}const Te=e=>Number.isFinite(e)?e:0;function Jr(e,t,r,n){const{h:o,w:a,c:g}=Zr(e.shape),m=e.data,w=yr(t),h=new Uint8ClampedArray(a*o*4);for(let l=0;l<a*o;l++){const u=l*g;let b,i,x,c=1;g===1?b=i=x=Te(m[u]):g===3?(b=Te(m[u]),i=Te(m[u+1]),x=Te(m[u+2])):(b=Te(m[u]),i=Te(m[u+1]),x=Te(m[u+2]),c=Te(m[u+3]));const d=[je(b,r),je(i,r),je(x,r)],[E,p,y]=w(d),T=l*4;h[T]=255*Ze(E,n),h[T+1]=255*Ze(p,n),h[T+2]=255*Ze(y,n),h[T+3]=255*(c<0?0:c>1?1:c)}return new ImageData(h,a,o)}function Qr({hdr:e,tonemap:t="srgb",exposure:r=0,gamma:n,showAxes:o=!1,label:a="",interpolation:g="auto",zoom:m=1,pan:w={x:0,y:0},onViewportChange:h,pixelValueNotation:l="decimal"}){const u=s.useRef(null),b=s.useRef(null),i=s.useRef(null),[x,c]=s.useState(null),d=s.useRef(null),[E,p]=s.useState(0),[y,T]=s.useState(l),[R,G]=s.useState(!1);s.useEffect(()=>{const D=u.current;if(!D)return;let A;try{A=Jr(e,t,r,n)}catch(k){console.error("[cairn] HDR tone-map error:",k);return}(D.width!==A.width||D.height!==A.height)&&(D.width=A.width,D.height=A.height);const L=D.getContext("2d");L&&(L.putImageData(A,0,0),d.current=A,p(k=>k+1),c(k=>k&&k.w===A.width&&k.h===A.height?k:{w:A.width,h:A.height}))},[e,t,r,n]);const{containerProps:F}=Me({containerRef:i,zoom:m,pan:w,onViewportChange:h}),O=s.useCallback((D,A,L)=>{const k=x;if(!k||D<0||A<0||D>=k.w||A>=k.h)return null;const V=e.shape.length===2?1:e.shape[2]??1,ee=(A*k.w+D)*V,te=e.data,Q=d.current;let ce=.5;if(Q&&Q.width===k.w&&Q.height===k.h){const ue=(A*k.w+D)*4;ce=(.299*Q.data[ue]+.587*Q.data[ue+1]+.114*Q.data[ue+2])/255}return V===1?{lines:[Z(te[ee]??0,"unit",L)],luminance:ce}:{lines:[Z(te[ee]??0,"unit",L),Z(te[ee+1]??0,"unit",L),Z(te[ee+2]??0,"unit",L)],luminance:ce,colors:[ie[0],ie[1],ie[2]]}},[e,x]),z=g==="auto"?void 0:g,H=`translate(${w.x}px, ${w.y}px) scale(${m})`;return f.jsxs("div",{className:"relative flex flex-col h-full",children:[f.jsxs("div",{ref:i,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:o&&x?"16px 4px 4px 28px":"4px",...F.style},onPointerDown:F.onPointerDown,onPointerMove:F.onPointerMove,onPointerUp:F.onPointerUp,onPointerCancel:F.onPointerCancel,children:[f.jsxs("div",{ref:b,className:"relative w-full h-full",style:{transform:H,transformOrigin:"0 0"},children:[f.jsx("canvas",{ref:u,className:"w-full h-full object-contain block",style:{imageRendering:z}}),o&&x&&f.jsx(Je,{naturalWidth:x.w,naturalHeight:x.h,zoom:m,containerRef:b})]}),x&&f.jsx(we,{imageElRef:u,naturalWidth:x.w,naturalHeight:x.h,zoom:m,pan:w,sample:O,notation:y,version:E,onActiveChange:G}),R&&f.jsx(Ie,{notation:y,onChange:T})]}),a?f.jsx(Qe,{label:a}):null]})}function en(e){return"hdr"in e&&e.hdr!=null}const tn=["linear","srgb","reinhard","aces"];function rn(e){return e&&tn.includes(e)?e:"srgb"}const Re=e=>Number.isFinite(e)?e:0;function nn(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function on(e){const{h:t,w:r,c:n}=nn(e.shape),o=e.data,a=new Float32Array(r*t*4);for(let g=0;g<r*t;g++){const m=g*n;let w,h,l,u=1;n===1?w=h=l=Re(o[m]):n===3?(w=Re(o[m]),h=Re(o[m+1]),l=Re(o[m+2])):(w=Re(o[m]),h=Re(o[m+1]),l=Re(o[m+2]),u=Re(o[m+3]));const b=g*4;a[b]=w,a[b+1]=h,a[b+2]=l,a[b+3]=u}return{data:a,width:r,height:t,format:"rgba32float"}}function kt(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const o=Math.min(t.width/r,t.height/n),a=r*o,g=n*o,m=(t.width-a)/2,w=(t.height-g)/2,h=Math.max(e.zoom,1e-6),l=1/h,u=1/h,b=(m*(1-h)-e.pan.x)/(a*h),i=(w*(1-h)-e.pan.y)/(g*h);return{x:b,y:i,w:l,h:u}}const an={zoom:1,pan:{x:0,y:0}};function sn(e){var ve,q;const t=en(e),r=s.useRef(null),n=s.useRef(null),o=s.useRef(null),a=s.useRef(null),g=s.useRef(!1),[m,w]=s.useState(!1),[h,l]=s.useState(!1),[u,b]=s.useState(null),[i,x]=s.useState(0),[c,d]=s.useState(0),[E,p]=s.useState({x:0,y:0,w:1,h:1}),y=s.useRef(null),T=s.useRef(null),[R,G]=s.useState(0),[F,O]=s.useState(e.pixelValueNotation??"decimal"),[z,H]=s.useState(!1),D=e.zoom??1,A=e.pan??{x:0,y:0},L=e.onViewportChange,k=t?"none":e.colormap??"none";s.useEffect(()=>{const v=r.current;if(!v)return;let P=!1;return Oe().then(C=>{if(P)return;const _=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,S=C.backend==="webgpu"&&C.capabilities.hdr&&_&&t;g.current=S,Yr(v,{hdr:S}).then(M=>{if(P){Gt(M);return}a.current=M,l(!0)}).catch(M=>{P||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",M),w(!0))})}).catch(C=>{P||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",C),w(!0))}),()=>{P=!0,a.current&&(Gt(a.current),a.current=null)}},[]);const{containerProps:V}=Me({containerRef:n,zoom:D,pan:A,onViewportChange:L}),ee=s.useCallback(()=>{L==null||L(an)},[L]);s.useEffect(()=>{const v=n.current;if(!v)return;const P=new ResizeObserver(()=>d(C=>C+1));return P.observe(v),()=>P.disconnect()},[]),s.useEffect(()=>{const v=n.current;if(!v)return;const P=new IntersectionObserver(C=>{const _=C[0];if(!_)return;const S=a.current;S&&(S.setVisible(_.isIntersecting),_.isIntersecting?S.isParked&&(S.restore(),d(M=>M+1)):S.park())},{threshold:0});return P.observe(v),()=>P.disconnect()},[]),s.useEffect(()=>{var C;if(!t||!h)return;const v=e.hdr;y.current=v;const P=on(v);(C=a.current)==null||C.setSource(P),b(_=>_&&_.w===P.width&&_.h===P.height?_:{w:P.width,h:P.height}),G(_=>_+1),x(_=>_+1)},[t,h,t?e.hdr:null]),s.useEffect(()=>{if(t||!h)return;const v=e,P=v.imageUrl,C=v.colormap??"none";if(!P){T.current=null,b(null),G(S=>S+1);return}let _=!1;return Pe(P).then(S=>{var J,se;if(_||!S)return;let M=S;if(C!=="none"){const ne=`gpu::${P}::${C}`,U=He(ne);if(U)M=U;else{const X=mt.has(C)?"positive":"linear";M=ze(S,C,X),qe(ne,M)}}T.current=S;const I={data:M.data,width:M.width,height:M.height,format:"rgba8unorm"};(J=a.current)==null||J.setSource(I),b(ne=>ne&&ne.w===M.width&&ne.h===M.height?ne:{w:M.width,h:M.height}),(se=v.onNaturalSize)==null||se.call(v,M.width,M.height),G(ne=>ne+1),x(ne=>ne+1)}),()=>{_=!0}},[t,h,t?null:e.imageUrl,t?null:e.colormap]);const te=t?e.exposure??0:0,Q=t?e.tonemap:void 0,ce=t?e.gamma:void 0;s.useEffect(()=>{const v=a.current;if(!v||!h||!u)return;const P=n.current,C=P?P.getBoundingClientRect():{width:u.w,height:u.h},_=kt({zoom:D,pan:A},C,u.w,u.h);p(I=>I.x===_.x&&I.y===_.y&&I.w===_.w&&I.h===_.h?I:_);let S=_;v.backend==="webgl2"&&(S={x:S.x,y:S.y+S.h,w:S.w,h:-S.h});const M=t?{exposureEV:te,operator:g.current?"extended":rn(Q),gamma:ce,isScalar:!1,hdrOut:g.current,uv:S}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:S};try{v.render(M)||w(!0)}catch(I){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",I),w(!0)}},[h,u,i,D,A.x,A.y,te,Q,ce,c,t]);const ue=s.useCallback((v,P,C)=>{if(t){const U=y.current,X=u;if(!U||!X||v<0||P<0||v>=X.w||P>=X.h)return null;const W=U.shape.length===2?1:U.shape[2]??1,Y=(P*X.w+v)*W,$=U.data,j=.5;return W===1?{lines:[Z($[Y]??0,"unit",C)],luminance:j}:{lines:[Z($[Y]??0,"unit",C),Z($[Y+1]??0,"unit",C),Z($[Y+2]??0,"unit",C)],luminance:j,colors:[ie[0],ie[1],ie[2]]}}const _=T.current;if(!_||v<0||P<0||v>=_.width||P>=_.height)return null;const S=(P*_.width+v)*4,M=_.data[S],I=_.data[S+1],J=_.data[S+2],se=(.299*M+.587*I+.114*J)/255;return k!=="none"||M===I&&I===J?{lines:[Z(M,"uint8",C)],luminance:se}:{lines:[Z(M,"uint8",C),Z(I,"uint8",C),Z(J,"uint8",C)],luminance:se,colors:[ie[0],ie[1],ie[2]]}},[t,u,k]),le=e.showAxes??!1,de=t?e.label??"":e.label,K=e.interpolation??"auto",fe=K==="auto"?void 0:K,re=t?void 0:e.overlay,oe=t?void 0:e.overlaySettings,pe=t?!1:e.isDraggable??!1,me=t?void 0:e.onDragStart;return m?t?f.jsx(Qr,{hdr:e.hdr,tonemap:e.tonemap,exposure:e.exposure,gamma:e.gamma,showAxes:le,label:de,interpolation:K,zoom:e.zoom,pan:e.pan,onViewportChange:L,pixelValueNotation:e.pixelValueNotation}):f.jsx(Ot,{imageUrl:e.imageUrl,baselineUrl:e.baselineUrl??null,isBaseline:e.isBaseline,diffMode:e.diffMode??"none",interpolation:K,colormap:k,showAxes:le,processing:e.processing,zoom:e.zoom,pan:e.pan,onViewportChange:L,onNaturalSize:e.onNaturalSize,label:de,isDraggable:pe,onDragStart:me,className:e.className,overlay:re,overlaySettings:oe,pixelValueNotation:e.pixelValueNotation}):f.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":h,children:[f.jsxs("div",{ref:n,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:le&&u?"16px 4px 4px 28px":"4px",...V.style},onPointerDown:V.onPointerDown,onPointerMove:V.onPointerMove,onPointerUp:V.onPointerUp,onPointerCancel:V.onPointerCancel,onDoubleClick:ee,"data-gpu-image-viewport":!0,children:[f.jsxs("div",{ref:o,className:"relative w-full h-full",children:[f.jsx("canvas",{ref:r,className:"w-full h-full object-contain block",style:{imageRendering:fe},"data-gpu-image-canvas":!0}),le&&u&&f.jsx(Je,{naturalWidth:u.w,naturalHeight:u.h,zoom:D,containerRef:o}),re&&(oe==null?void 0:oe.enabled)&&u&&((((ve=re.boxes)==null?void 0:ve.length)??0)>0||(((q=re.masks)==null?void 0:q.length)??0)>0)&&f.jsx(tt,{data:re,settings:oe,naturalWidth:u.w,naturalHeight:u.h})]}),u&&f.jsx(we,{imageElRef:r,naturalWidth:u.w,naturalHeight:u.h,zoom:D,pan:A,sourceWindow:E,sample:ue,notation:F,version:R,onActiveChange:H}),z&&f.jsx(Ie,{notation:F,onChange:O})]}),de?f.jsx(Qe,{label:de,isDraggable:pe,onDragStart:me}):null]})}const cn={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function un({imageUrl:e,baselineUrl:t,mode:r,splitPosition:n,blendAlpha:o,onSplitPositionChange:a,zoom:g,pan:m,onViewportChange:w,processing:h=cn,interpolation:l="auto",label:u="",isDraggable:b=!1,onDragStart:i,overlay:x,overlaySettings:c,pixelValueNotation:d="decimal"}){var me,ve;const E=s.useRef(null),[p,y]=s.useState(null),[T,R]=s.useState(null),[G,F]=s.useState(d),[O,z]=s.useState(!1),H=s.useRef(null),D=s.useRef(null),A=s.useRef(null),L=s.useRef(null),[k,V]=s.useState(0);s.useEffect(()=>{if(!e){A.current=null,V(v=>v+1);return}let q=!1;return Pe(e).then(v=>{q||(A.current=v,V(P=>P+1))}),()=>{q=!0}},[e]),s.useEffect(()=>{if(!t){L.current=null,V(v=>v+1);return}let q=!1;return Pe(t).then(v=>{q||(L.current=v,V(P=>P+1))}),()=>{q=!0}},[t]);const ee=q=>(v,P,C)=>{const _=q.current;if(!_||v<0||P<0||v>=_.width||P>=_.height)return null;const S=(P*_.width+v)*4,M=_.data[S],I=_.data[S+1],J=_.data[S+2],se=(.299*M+.587*I+.114*J)/255;return M===I&&I===J?{lines:[Z(M,"uint8",C)],luminance:se}:{lines:[Z(M,"uint8",C),Z(I,"uint8",C),Z(J,"uint8",C)],luminance:se,colors:[ie[0],ie[1],ie[2]]}},te=s.useMemo(()=>ee(A),[]),Q=s.useMemo(()=>ee(L),[]),ce=!!x&&!!(c!=null&&c.enabled)&&!!p&&!!e&&((((me=x.boxes)==null?void 0:me.length)??0)>0||(((ve=x.masks)==null?void 0:ve.length)??0)>0),{gammaFilterId:ue,filterStr:le,gamma:de,offset:K}=Ft(h),fe=`translate(${m.x}px, ${m.y}px) scale(${g})`,re=l==="auto"?void 0:l,{containerProps:oe,modifierActive:pe}=Me({containerRef:E,zoom:g,pan:m,onViewportChange:w});return f.jsxs("div",{className:"relative flex flex-col h-full",children:[f.jsx(Ut,{id:ue,gamma:de,offset:K}),f.jsxs("div",{ref:E,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...oe.style},onPointerDown:oe.onPointerDown,onPointerMove:oe.onPointerMove,onPointerUp:oe.onPointerUp,onPointerCancel:oe.onPointerCancel,children:[f.jsxs("div",{className:"relative w-full h-full",children:[f.jsxs("div",{className:"relative w-full h-full",style:{transform:fe,transformOrigin:"0 0"},children:[f.jsx("img",{ref:H,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:le,imageRendering:re,...r==="blend"?{opacity:o}:{}},onLoad:q=>{const v=q.currentTarget;y({w:v.naturalWidth,h:v.naturalHeight})}}),ce&&f.jsx(tt,{data:x,settings:c,naturalWidth:p.w,naturalHeight:p.h})]}),f.jsx("div",{className:"absolute inset-0 overflow-hidden",style:r==="split"?{clipPath:`inset(0 ${(1-n)*100}% 0 0)`}:void 0,children:f.jsx("div",{className:"w-full h-full",style:{transform:fe,transformOrigin:"0 0"},children:f.jsx("img",{ref:D,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:le,imageRendering:re,...r==="blend"?{opacity:1-o}:{}},onLoad:q=>{const v=q.currentTarget;R({w:v.naturalWidth,h:v.naturalHeight})}})})}),r==="split"&&f.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${n*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>a==null?void 0:a(.5),onPointerDown:q=>{q.stopPropagation(),q.preventDefault();const P=q.currentTarget.parentElement.getBoundingClientRect(),C=S=>{a==null||a(Math.max(0,Math.min(1,(S.clientX-P.left)/P.width)))},_=()=>{window.removeEventListener("pointermove",C),window.removeEventListener("pointerup",_)};window.addEventListener("pointermove",C),window.addEventListener("pointerup",_)},children:f.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),r==="split"?f.jsxs(f.Fragment,{children:[t&&T&&f.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-n)*100}% 0 0)`},children:f.jsx(we,{imageElRef:D,naturalWidth:T.w,naturalHeight:T.h,zoom:g,pan:m,sample:Q,notation:G,version:k})}),e&&p&&f.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${n*100}%)`},children:f.jsx(we,{imageElRef:H,naturalWidth:p.w,naturalHeight:p.h,zoom:g,pan:m,sample:te,notation:G,version:k,onActiveChange:z})})]}):e&&p&&f.jsx(we,{imageElRef:H,naturalWidth:p.w,naturalHeight:p.h,zoom:g,pan:m,sample:te,notation:G,version:k,onActiveChange:z}),O&&f.jsx(Ie,{notation:G,onChange:F})]}),f.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),f.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${b&&!pe?" cairn-drag-grip":""}`,draggable:b&&!pe,onDragStart:i,style:{cursor:b&&!pe?"grab":void 0},children:[f.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),u]})]})}const ln={zoom:1,pan:{x:0,y:0}};function dn(e){const t=$e(e),r=new Float32Array(256*4);for(let n=0;n<256;n++)r[n*4+0]=t[n*3+0]/255,r[n*4+1]=t[n*3+1]/255,r[n*4+2]=t[n*3+2]/255,r[n*4+3]=1;return r}function fn({imageUrl:e,baselineUrl:t,mode:r,splitPosition:n,blendAlpha:o,onSplitPositionChange:a,diffSubmode:g,colormap:m="none",zoom:w,pan:h,onViewportChange:l,interpolation:u="auto",label:b="",pixelValueNotation:i="decimal"}){const x=s.useRef(null),c=s.useRef(null),d=s.useRef(null),[E,p]=s.useState(!1),[y,T]=s.useState(!1),[R,G]=s.useState(null),[F,O]=s.useState(0),[z,H]=s.useState(0),[D,A]=s.useState(null),[L,k]=s.useState(i),[V,ee]=s.useState(!1),[te,Q]=s.useState({x:0,y:0,w:1,h:1}),ce=s.useRef(null),ue=s.useRef(null),[le,de]=s.useState(0);s.useEffect(()=>{const v=c.current;if(!v)return;let P=!1;return Oe().then(C=>{if(!P)try{if(Ct())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const _=C.backend==="webgl2",S=_?Be():C,M=S.createSurface(v,{hdr:!1});d.current={device:S,ownsDevice:_,surface:M,texA:null,texB:null},T(!0)}catch(_){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",_),p(!0)}}).catch(C=>{P||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",C),p(!0))}),()=>{var _,S;P=!0;const C=d.current;C&&((_=C.texA)==null||_.destroy(),(S=C.texB)==null||S.destroy(),C.ownsDevice&&C.device.destroy(),d.current=null)}},[]),s.useEffect(()=>{const v=x.current;if(!v)return;const P=new ResizeObserver(()=>H(C=>C+1));return P.observe(v),()=>P.disconnect()},[]),s.useEffect(()=>{if(!y)return;let v=!1;if(!d.current)return;async function C(_){return _?Pe(_):null}return Promise.all([C(e),C(t)]).then(([_,S])=>{var ne,U,X;if(v||!d.current)return;const M=d.current;ce.current=_,ue.current=S,(ne=M.texA)==null||ne.destroy(),(U=M.texB)==null||U.destroy(),M.texA=null,M.texB=null;const I=_??S;if(!I){G(null),de(W=>W+1);return}const J=W=>{const Y=M.device.createTexture(W.width,W.height,"rgba8unorm");return Y.write(W.data),Y};M.texA=J(S??I),M.texB=J(_??I);const se=c.current;se.width=I.width,se.height=I.height,(X=M.surface)==null||X.configure(I.width,I.height),G({w:I.width,h:I.height}),de(W=>W+1),O(W=>W+1)}),()=>{v=!0}},[y,e,t]);const K=s.useMemo(()=>(g??"").includes("signed")?"signed":"positive",[g]),fe=s.useMemo(()=>m!=="none"?dn(m):void 0,[m]);s.useEffect(()=>{const v=d.current;if(!y||!v||!v.surface||!v.texA||!v.texB||!R)return;const P=x.current,C=P?P.getBoundingClientRect():{width:R.w,height:R.h},_=kt({zoom:w,pan:h},C,R.w,R.h);Q(I=>I.x===_.x&&I.y===_.y&&I.w===_.w&&I.h===_.h?I:_);let S=_;v.device.backend==="webgl2"&&(S={x:S.x,y:S.y+S.h,w:S.w,h:-S.h});const M={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:S,mode:r,split:n,alpha:o,diffSubmode:g??"absolute",diffCmapMode:K,diffColormap:r==="diff"?fe:void 0};try{Xr(v.device,v.surface,v.texA,v.texB,M)}catch(I){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",I),p(!0)}},[y,R,F,w,h.x,h.y,r,n,o,g,K,fe,z]),s.useEffect(()=>{const v=d.current;if(!y||!v||!v.texA||!v.texB||!t){A(null);return}let P=!1;return Wr(v.device,v.texA,v.texB).then(C=>{P||A(C)}),()=>{P=!0}},[y,F,t]);const re=v=>(P,C,_)=>{const S=v.current;if(!S||P<0||C<0||P>=S.width||C>=S.height)return null;const M=(C*S.width+P)*4,I=S.data[M],J=S.data[M+1],se=S.data[M+2],ne=(.299*I+.587*J+.114*se)/255;return I===J&&J===se?{lines:[Z(I,"uint8",_)],luminance:ne}:{lines:[Z(I,"uint8",_),Z(J,"uint8",_),Z(se,"uint8",_)],luminance:ne,colors:[ie[0],ie[1],ie[2]]}},oe=s.useMemo(()=>re(ce),[]),pe=s.useMemo(()=>re(ue),[]),{containerProps:me}=Me({containerRef:x,zoom:w,pan:h,onViewportChange:l}),ve=s.useCallback(()=>l==null?void 0:l(ln),[l]),q=u==="auto"?void 0:u;return E?r==="diff"?f.jsx(Ot,{imageUrl:e,baselineUrl:t,diffMode:g??"signed",interpolation:u,colormap:m,showAxes:!1,zoom:w,pan:h,onViewportChange:l,label:b,pixelValueNotation:i}):f.jsx(un,{imageUrl:e,baselineUrl:t,mode:r,splitPosition:n,blendAlpha:o,onSplitPositionChange:a,zoom:w,pan:h,onViewportChange:l,interpolation:u,label:b,pixelValueNotation:i}):f.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":y,children:[f.jsxs("div",{ref:x,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...me.style},onPointerDown:me.onPointerDown,onPointerMove:me.onPointerMove,onPointerUp:me.onPointerUp,onPointerCancel:me.onPointerCancel,onDoubleClick:ve,"data-gpu-compare-viewport":!0,children:[f.jsxs("div",{className:"relative w-full h-full",children:[f.jsx("canvas",{ref:c,className:"w-full h-full object-contain block",style:{imageRendering:q},"data-gpu-compare-canvas":!0}),r==="split"&&f.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${n*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:v=>{v.stopPropagation(),a==null||a(.5)},onPointerDown:v=>{v.stopPropagation(),v.preventDefault();const C=v.currentTarget.parentElement.getBoundingClientRect(),_=M=>{a==null||a(Math.max(0,Math.min(1,(M.clientX-C.left)/C.width)))},S=()=>{window.removeEventListener("pointermove",_),window.removeEventListener("pointerup",S)};window.addEventListener("pointermove",_),window.addEventListener("pointerup",S)},children:f.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),r==="split"?f.jsxs(f.Fragment,{children:[t&&R&&f.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-n)*100}% 0 0)`},children:f.jsx(we,{imageElRef:c,naturalWidth:R.w,naturalHeight:R.h,zoom:w,pan:h,sourceWindow:te,sample:pe,notation:L,version:le})}),t&&R&&f.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${n*100}%)`},children:f.jsx(we,{imageElRef:c,naturalWidth:R.w,naturalHeight:R.h,zoom:w,pan:h,sourceWindow:te,sample:oe,notation:L,version:le,onActiveChange:ee})})]}):R&&f.jsx(we,{imageElRef:c,naturalWidth:R.w,naturalHeight:R.h,zoom:w,pan:h,sourceWindow:te,sample:oe,notation:L,version:le,onActiveChange:ee}),V&&f.jsx(Ie,{notation:L,onChange:k})]}),f.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),b?f.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:b}):null,D&&f.jsxs("span",{className:`absolute right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${V?"top-8":"top-1"}`,"data-gpu-compare-metrics":!0,children:["MSE ",D.mse.toExponential(2)," · PSNR ",Number.isFinite(D.psnr)?D.psnr.toFixed(1):"∞"," dB · MAE"," ",D.mae.toExponential(2)]})]})}const mn="cairn-plot:gpu-image-ready";async function hn(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Oe(),window.__cairnPlotGpuImagePane=sn,window.__cairnPlotGpuComparePane=fn,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(mn))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}hn()})(__cairnPlotJsxRuntime,__cairnPlotReact);

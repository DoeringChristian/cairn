var Xn=Object.defineProperty;var Yn=(e,t,r)=>t in e?Xn(e,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):e[t]=r;var O=(e,t,r)=>Yn(e,typeof t!="symbol"?t+"":t,r);import{$ as Ft,a0 as jn,a1 as Zn,r as d,a2 as Qn,a3 as Ce,a4 as Xr,a5 as Yr,a6 as jr,a7 as Jn,a8 as ea,a9 as ta,aa as ra,ab as Zr,ac as Qr,ad as Jr,ae as ft,j as Q,X as en,af as na,ag as tn,ah as rn,ai as nn,aj as an,ak as sn,al as on,am as cn,an as un,ao as rr,ap as nr,aq as ln,ar as fn,as as aa,at as Mt,au as Be,N as sa,av as ia,aw as oa,ax as ca,ay as ua,az as la,aA as fa,aB as qt,aC as da,d as pa}from"./parse-overlay-BoxLmD9-.js";import{b as ma}from"./compare-mode-menu-DG9F3B3b.js";const ar=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function dn(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"premultiplied",usage:ar}),{hdr:!1,format:r}}function ga(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:ar}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:ar}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return dn(e,t)}}}const ha=`
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
`,xa=`
struct Params { dims: vec4<f32> }; // x=width, y=height, z=zFar, w=zNear

@group(0) @binding(0) var<storage, read> offsets: array<u32>;
@group(0) @binding(1) var<storage, read> colors: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> zs: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  // Single oversized triangle covering the viewport.
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(p[vid], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let w = u32(params.dims.x);
  let h = u32(params.dims.y);
  let x = u32(frag.x);
  let y = u32(frag.y);
  if (x >= w || y >= h) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let idx = y * w + x;
  let start = offsets[idx];
  let end = offsets[idx + 1u];
  let zFar = params.dims.z;
  let zNear = params.dims.w;
  // Front-to-back OVER over the Z WINDOW [zNear, zFar]: skip samples nearer than
  // zNear, break past zFar (samples ascending in Z). acc += (1 - acc.a) * sample.
  var acc = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  for (var s: u32 = start; s < end; s = s + 1u) {
    let z = zs[s];
    if (z < zNear) { continue; }
    if (z > zFar) { break; }
    let c = colors[s];
    let wgt = 1.0 - acc.a;
    acc = acc + wgt * c;
  }
  return acc;
}
`;class ba extends Error{constructor(r){super(r);O(this,"deviceLost",!0);this.name="DeviceLostError"}}async function vr(e,t){try{await e.mapAsync(GPUMapMode.READ)}catch(r){if((r instanceof Error?r.name:"")==="AbortError"){const a=t.info;throw new ba("webgpu readback: buffer map aborted — device lost or destroyed mid-readback"+(a?` (reason=${String(a.reason)}${a.message?`: ${a.message}`:""})`:"")+`: ${r instanceof Error?r.message:String(r)}`)}throw r instanceof Error?r:new Error(String(r))}}function sr(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function pn(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function va(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let a;return r===0?a=n/1024*Math.pow(2,-14):r===31?a=n?NaN:1/0:a=(1+n/1024)*Math.pow(2,r-15),t?-a:a}const ya={texture:0,sampler:1,uniform:2};function Xt(e,t){return e*3+ya[t]}const wa={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Ea(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const a=Number(n[1]),s=n[2]!==void 0,i=n[3].trim();if(s){const o=wa[i];if(o===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${i}" (binding ${a}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(a,{kind:"uniform",sizeBytes:o})}else i==="sampler"||i==="sampler_comparison"?t.set(a,{kind:"sampler"}):t.set(a,{kind:"texture"})}return t}class yr{constructor(t,r,n,a){O(this,"width");O(this,"height");O(this,"format");O(this,"gpuTexture");O(this,"device");O(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=a,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:sr(a),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*pn(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class wr{constructor(t){O(this,"_s");O(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Ra{constructor(t,r,n,a,s){O(this,"_p");O(this,"gpuPipeline");O(this,"bindings");O(this,"bindGroupLayout");O(this,"variants");O(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=s,this.variants=new Map([[a,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function Sa(e,t){const r=[];for(const[n,a]of t)a.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):a.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class _a{constructor(t){O(this,"_c");O(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class Aa{constructor(t,r,n,a,s){O(this,"width");O(this,"height");O(this,"paramsBuffer");O(this,"bindGroup");O(this,"buffers");O(this,"destroyed",!1);this.width=t,this.height=r,this.buffers=n,this.paramsBuffer=a,this.bindGroup=s}destroy(){if(!this.destroyed){for(const t of this.buffers)t.destroy();this.paramsBuffer.destroy(),this.destroyed=!0}}}class Ta{constructor(t,r){O(this,"_b");O(this,"gpuBindGroup");O(this,"ownedBuffers");O(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class Ma{constructor(t,r,n,a){O(this,"canvas");O(this,"hdr");O(this,"format");O(this,"context");O(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=a}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function At(e){return"canvas"in e}async function Pa(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function a(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function s(u){return At(u)?u.getCurrentTextureView():u.gpuTexture.createView()}function i(u){if(At(u))return{width:u.canvas.width,height:u.canvas.height};const x=u;return{width:x.width,height:x.height}}let o=!1;const c={};t.lost.then(u=>{c.info=u},()=>{});let l=null;function f(){var x,y;if(l!==null)return l;let u=!1;try{if(typeof document<"u"){const w=document.createElement("canvas");w.width=1,w.height=1;const R=w.getContext("webgpu");if(R)try{R.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:GPUTextureUsage.RENDER_ATTACHMENT});const C=(x=R.getConfiguration)==null?void 0:x.call(R);u=((y=C==null?void 0:C.toneMapping)==null?void 0:y.mode)==="extended"}catch{u=!1}finally{try{R.unconfigure()}catch{}}}}catch{u=!1}return l=u,u}const p=256;let m=null,b=null;function v(){if(!m||!b){const u=t.createShaderModule({code:ha});b=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const x=t.createPipelineLayout({bindGroupLayouts:[b]});m=t.createComputePipeline({layout:x,compute:{module:u,entryPoint:"cs_main"}})}return{pipeline:m,layout:b}}let _=null,E=null;function L(){if(!_||!E){const u=t.createShaderModule({code:xa});E=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const x=t.createPipelineLayout({bindGroupLayouts:[E]});_=t.createRenderPipeline({layout:x,vertex:{module:u,entryPoint:"vs_main"},fragment:{module:u,entryPoint:"fs_main",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}})}return{pipeline:_,layout:E}}return{backend:"webgpu",capabilities:r,probeExtendedToneMapping:f,createTexture(u,x,y){return new yr(t,u,x,y)},createSampler(u){const x=(u==null?void 0:u.filter)==="linear"?"linear":"nearest",y=t.createSampler({magFilter:x,minFilter:x,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new wr(y)},createRenderPipeline(u){const x=t.createShaderModule({code:u.shaderWGSL}),y=Ea(u.shaderWGSL),w=sr(u.targetFormat),R=Sa(t,y),C=t.createPipelineLayout({bindGroupLayouts:[R]}),U=B=>t.createRenderPipeline({layout:C,vertex:{module:x,entryPoint:"vs_main"},fragment:{module:x,entryPoint:"fs_main",targets:[{format:B}]},primitive:{topology:"triangle-list"}}),D=U(w);return new Ra(D,y,R,w,U)},createComputePipeline(u){const x=t.createShaderModule({code:u.shaderWGSL}),y=t.createComputePipeline({layout:"auto",compute:{module:x,entryPoint:"cs_main"}});return new _a(y)},createBindGroup(u,x){const y=u,w=new Map,R=[];for(const[U,D]of y.bindings)if(D.kind==="uniform"){const B=t.createBuffer({size:D.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});R.push(B),w.set(U,{binding:U,resource:{buffer:B}})}else D.kind==="sampler"&&w.set(U,{binding:U,resource:a()});for(const U of x){const D=U.resource;if(D instanceof yr){const B=Xt(U.binding,"texture");y.bindings.has(B)&&w.set(B,{binding:B,resource:D.gpuTexture.createView()})}else if(D instanceof wr){const B=Xt(U.binding,"sampler");y.bindings.has(B)&&w.set(B,{binding:B,resource:D.gpuSampler})}else{const B=Xt(U.binding,"uniform"),Y=y.bindings.get(B);if(Y&&Y.kind==="uniform"){const F=D.uniform,X=t.createBuffer({size:Math.max(Y.sizeBytes,F.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(X,0,F.buffer,F.byteOffset,F.byteLength),R.push(X),w.set(B,{binding:B,resource:{buffer:X}})}}}const C=t.createBindGroup({layout:y.bindGroupLayout,entries:Array.from(w.values())});return new Ta(C,R)},createSurface(u,x){const y=u.getContext("webgpu");if(!y)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const w=x.hdr&&r.hdr,R=()=>w?ga(y,t):dn(y,t),C=R();return new Ma(u,y,C,R)},renderFullscreen(u,x,y){const w=x,R=y,C=s(u),{width:U,height:D}=i(u),B=At(u)?u.format:sr(u.format),Y=w.pipelineFor(B),F=t.createCommandEncoder(),X=F.beginRenderPass({colorAttachments:[{view:C,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});X.setPipeline(Y),X.setBindGroup(0,R.gpuBindGroup),X.setViewport(0,0,U,D,0,1),X.draw(3),X.end(),t.queue.submit([F.finish()])},createDeepSampleBuffers(u){const{layout:x}=L(),y=B=>{const Y=t.createBuffer({size:B.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(Y,0,B.buffer,B.byteOffset,B.byteLength),Y},w=y(u.offsets),R=y(u.colors),C=y(u.zs),U=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),D=t.createBindGroup({layout:x,entries:[{binding:0,resource:{buffer:w}},{binding:1,resource:{buffer:R}},{binding:2,resource:{buffer:C}},{binding:3,resource:{buffer:U}}]});return new Aa(u.width,u.height,[w,R,C],U,D)},compositeDeep(u,x,y,w){const R=u,C=x,{pipeline:U}=L();t.queue.writeBuffer(R.paramsBuffer,0,new Float32Array([R.width,R.height,w,y]));const D=t.createCommandEncoder(),B=D.beginRenderPass({colorAttachments:[{view:C.gpuTexture.createView(),loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});B.setPipeline(U),B.setBindGroup(0,R.bindGroup),B.setViewport(0,0,C.width,C.height,0,1),B.draw(3),B.end(),t.queue.submit([D.finish()])},async readback(u){const x=At(u),{width:y,height:w}=i(u),R=x?u.hdr?"rgba16float":"rgba8unorm":u.format,C=x&&u.format==="bgra8unorm",U=x?u.getCurrentGPUTexture():u.gpuTexture,D=pn(R),B=y*D,Y=256,F=Math.ceil(B/Y)*Y,X=F*w,ee=t.createBuffer({size:X,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),de=t.createCommandEncoder();de.copyTextureToBuffer({texture:U},{buffer:ee,bytesPerRow:F,rowsPerImage:w},{width:y,height:w,depthOrArrayLayers:1}),t.queue.submit([de.finish()]);try{await vr(ee,c)}catch(H){try{ee.destroy()}catch{}throw H}const J=new Uint8Array(ee.getMappedRange()),Z=new Uint8Array(B*w);for(let H=0;H<w;H++){const te=H*F,re=H*B;Z.set(J.subarray(te,te+B),re)}if(ee.unmap(),ee.destroy(),R==="rgba8unorm"){if(C)for(let H=0;H<Z.length;H+=4){const te=Z[H],re=Z[H+2];Z[H]=re,Z[H+2]=te}return Z}if(R==="rgba16float"){const H=new Uint16Array(Z.buffer,Z.byteOffset,Z.byteLength/2),te=new Float32Array(H.length);for(let re=0;re<H.length;re++)te[re]=va(H[re]);return te}return new Float32Array(Z.buffer,Z.byteOffset,Z.byteLength/4)},async reduceDiffSumSquaredAbs(u,x,y,w){const R=u,C=x,U=Math.max(0,y*w),D=Math.max(1,Math.ceil(U/p)),{pipeline:B,layout:Y}=v(),F=D*2*4,X=t.createBuffer({size:F,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),ee=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(ee,0,new Uint32Array([Math.max(1,y),Math.max(1,w),U,0]));const de=t.createBindGroup({layout:Y,entries:[{binding:0,resource:R.gpuTexture.createView()},{binding:1,resource:C.gpuTexture.createView()},{binding:2,resource:{buffer:X}},{binding:3,resource:{buffer:ee}}]}),J=t.createBuffer({size:F,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),Z=t.createCommandEncoder(),H=Z.beginComputePass();H.setPipeline(B),H.setBindGroup(0,de),H.dispatchWorkgroups(D),H.end(),Z.copyBufferToBuffer(X,0,J,0,F),t.queue.submit([Z.finish()]);try{await vr(J,c)}catch(se){for(const _e of[J,X,ee])try{_e.destroy()}catch{}throw se}const re=new Float32Array(J.getMappedRange()).slice();J.unmap(),J.destroy(),X.destroy(),ee.destroy();let ne=0,ve=0;for(let se=0;se<D;se++)ne+=re[se*2],ve+=re[se*2+1];return{sumSq:ne,sumAbs:ve}},destroy(){o||(t.destroy(),o=!0)},isContextLost(){return!1}}}let Yt=null;async function Da(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return Pa()}function It(){return Yt||(Yt=Da()),Yt}const Ba=`
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
// Logical binding 6 (uniform f32: display OFFSET, TEV convention — added after
// exposure, before colormap/tonemap/encode) -> native binding 6*3+2 = 20.
// Defaults to 0 (the bind-group builder zero-fills any binding the caller omits),
// so an image with no offset renders bit-for-bit as before.
@group(0) @binding(20) var<uniform> u_bind6: f32;
// Logical binding 7 (uniform f32: PEAK white, ×SDR white — for the peak-
// parameterized extended operators extended-reinhard(5)/extended-aces(6)/
// extended-clamp(7)) -> native binding 7*3+2 = 23. Defaults to 0 when the caller
// omits it (zero-filled); the engine
// always writes EXTENDED_TONEMAP_PEAK_DEFAULT (4), and the roll-off curves guard
// peak<=0 anyway.
@group(0) @binding(23) var<uniform> u_bind7: f32;
// Logical binding 8 (uniform f32: srgbDecode, 0/1) -> native binding 8*3+2 = 26.
// When 1, sRGB-DECODE the sampled source to linear light BEFORE exposure (an
// 8-bit sRGB source going through the display-transfer pipeline). Default 0
// (zero-filled when the caller omits it) — the HDR/float path leaves it off, so
// a scene-linear source is untouched and every existing case renders as before.
@group(0) @binding(26) var<uniform> u_bind8: f32;

// --- ported verbatim from image/tonemap.ts ---

fn srgbOetf(x: f32) -> f32 {
  let v = clamp(x, 0.0, 1.0);
  if (v <= 0.0031308) {
    return 12.92 * v;
  }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

// sRGB EOTF (sRGB code -> linear) — the exact inverse of srgbOetf. Mirrors
// image/tonemap.ts's srgbEotf. Used to LINEARIZE an 8-bit sRGB source at the
// front of the pipeline when srgbDecode (u_bind8) is set (SDR display-transfer
// panes), so exposure/offset + the chosen transfer operate on linear light,
// tev-style.
fn srgbEotf(x: f32) -> f32 {
  let v = clamp(x, 0.0, 1.0);
  if (v <= 0.04045) {
    return v / 12.92;
  }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn outputEncodeF(x: f32, gamma: f32, hasGamma: bool) -> f32 {
  if (hasGamma) {
    return clamp(pow(clamp(x, 0.0, 1.0), 1.0 / gamma), 0.0, 1.0);
  }
  return srgbOetf(x);
}

// --- EXTENDED output-encode (HDR-out / extended-surface transfer) — ported
// BYTE-IDENTICALLY from image/tonemap.ts's extendedSrgbOetf / extendedGammaEncode
// / extendedOutputEncode. See that file's doc block for WHY: a float16 canvas in
// "srgb"/"display-p3" (the hdrOut surface) stores TRANSFER-ENCODED (non-linear)
// signals per W3C ColorWeb-CG, so the hdrOut path must ENCODE the display-linear
// light the operator produced, not hand over raw scene-linear values. Same
// piecewise sRGB / power curves as the SDR encoders but UNCLAMPED (values past 1
// survive as extended brightness) and MIRRORED through the origin for negatives
// (sign(x)*f(|x|)). ---

fn extendedSrgbOetf(x: f32) -> f32 {
  let a = abs(x);
  let s = sign(x);
  if (a <= 0.0031308) { return s * 12.92 * a; }
  return s * (1.055 * pow(a, 1.0 / 2.4) - 0.055);
}

fn extendedGammaEncode(x: f32, gamma: f32) -> f32 {
  let a = abs(x);
  let s = sign(x);
  return s * pow(a, 1.0 / gamma);
}

fn extendedOutputEncodeF(x: f32, gamma: f32, hasGamma: bool) -> f32 {
  if (hasGamma) { return extendedGammaEncode(x, gamma); }
  return extendedSrgbOetf(x);
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

// --- HDR-out roll-off operators (peak-parameterized) — ported verbatim from
// image/tonemap.ts's extendedReinhardCurve / extendedAcesCurve. ---

// Extended Reinhard with display peak P: y = x/(1 + x/P) — identity slope at
// 0, asymptote P. Mirrors image/tonemap.ts's extendedReinhardCurve exactly
// (see its doc for why the SDR white-point form x*(1+x/P^2)/(1+x) is wrong
// for extended output: it targets x=P -> 1 and darkens the midrange).
fn extendedReinhardCurve(x: f32, peak: f32) -> f32 {
  let v = max(x, 0.0);
  let p = max(peak, 1e-6);
  return v / (1.0 + v / p);
}

// ACES fit peak-parameterized as the CANONICAL curve scaled to P: y = P*aces(x/P).
// Mirrors image/tonemap.ts's extendedAcesCurve EXACTLY. INVARIANT: at P=1 this
// is 1*aces(x/1) = aces(x) — the SDR ACES operator exactly, so the only
// difference between SDR and extended ACES is the peak P (parity-tested). Keeps
// y→P as x→∞ and monotone. (Replaces the earlier P*aces(x*S/P), S=0.14/0.03,
// which normalized the low-x slope to 1 but broke the P=1 equivalence.)
fn extendedAcesCurve(x: f32, peak: f32) -> f32 {
  let v = max(x, 0.0);
  let p = max(peak, 1e-6);
  return p * acesCurve(v / p);
}

// Extended · Linear (MANAGED) with display peak P: y = min(max(x,0), P) —
// identity below P, hard ceiling at P. Mirrors image/tonemap.ts's
// extendedClampCurve exactly. This is the cross-browser-deterministic sibling of
// operator 4 (extended / raw Linear): 4 hands raw values to the compositor which
// clips at its own headroom estimate; this clips in-shader at the shared P.
fn extendedClampCurve(x: f32, peak: f32) -> f32 {
  let v = max(x, 0.0);
  let p = max(peak, 1e-6);
  return min(v, p);
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

// Colormap LUT lookup, two variants selected by the SAME filter flag (u_bind5)
// that picks nearest/bilinear source sampling — so a colormapped image shares
// ONE interpolation decision with the plain path, never diverging.
//
//  sampleLutNearestF: the crisp per-texel mapping. Round-half-UP index (matches
//    the CPU Math.round reference — WGSL round() is round-half-to-EVEN), exact
//    texel fetch. Used at the pixelated zoom (source sampled nearest), where
//    each source texel is a solid on-screen block anyway.
//  sampleLutLinearF: blends the TWO adjacent LUT entries by the fractional
//    index. Used at moderate zoom (source sampled bilinearly). Without this a
//    bilinearly-interpolated scalar still SNAPS to one of 256 discrete LUT bins,
//    reintroducing stair-step banding whose iso-value contours follow the texel
//    grid — the "sharp corners that should not be there" the plain (non-LUT)
//    path never shows. Interpolating the scalar across texels AND interpolating
//    the LUT across its entries is the intended smooth false-color pipeline.
// At a texel-aligned 8-bit scalar (idxF integer, frac==0) the linear variant
// degenerates to the exact entry, so the two agree wherever the source is
// texel-aligned.
fn sampleLutNearestF(valueUnit: f32) -> vec3<f32> {
  let idxF = clamp(valueUnit, 0.0, 1.0) * 255.0;
  let idx = clamp(i32(floor(idxF + 0.5)), 0, 255);
  return textureLoad(t_bind1, vec2<i32>(idx, 0), 0).rgb;
}

fn sampleLutLinearF(valueUnit: f32) -> vec3<f32> {
  let idxF = clamp(valueUnit, 0.0, 1.0) * 255.0;
  let base = floor(idxF);
  let i0 = clamp(i32(base), 0, 255);
  let i1 = min(i0 + 1, 255);
  let frac = idxF - base;
  let c0 = textureLoad(t_bind1, vec2<i32>(i0, 0), 0).rgb;
  let c1 = textureLoad(t_bind1, vec2<i32>(i1, 0), 0).rgb;
  return mix(c0, c1, frac);
}

// operatorId: 0=linear, 1=srgb, 2=reinhard, 3=aces, 4=extended (Extended·Linear),
// 5=extended-reinhard, 6=extended-aces, 7=extended-clamp (Extended·Linear
// managed), 8=gamma (matches OPERATOR_ID in image-engine.ts / TONEMAP_OPERATORS +
// the extended curves in image/tonemap.ts). linear/srgb/gamma are the SAME clamp
// (the RANGE-MAP) — the display transfer (sRGB OETF, identity, or the gamma power
// curve) lives in outputEncodeF, selected by the gamma uniform the renderer
// packs per operator (see image/tonemap.ts's resolveEncodeGamma). 4 (extended) is a pure identity —
// no compression, no clamp — deliberately preserving values above 1.0 for a real
// HDR (hdrOut) target. 5/6 are the peak-parameterized HDR roll-off operators;
// 7 is the peak-parameterized HARD clamp (managed linear) — all three read
// the peak uniform (see image/tonemap.ts's doc comments).
fn applyOperator(rgb: vec3<f32>, operatorId: i32, peak: f32) -> vec3<f32> {
  if (operatorId == 2) {
    return vec3<f32>(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z));
  }
  if (operatorId == 3) {
    return vec3<f32>(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z));
  }
  if (operatorId == 4) {
    return rgb;
  }
  if (operatorId == 5) {
    return vec3<f32>(extendedReinhardCurve(rgb.x, peak), extendedReinhardCurve(rgb.y, peak), extendedReinhardCurve(rgb.z, peak));
  }
  if (operatorId == 6) {
    return vec3<f32>(extendedAcesCurve(rgb.x, peak), extendedAcesCurve(rgb.y, peak), extendedAcesCurve(rgb.z, peak));
  }
  if (operatorId == 7) {
    return vec3<f32>(extendedClampCurve(rgb.x, peak), extendedClampCurve(rgb.y, peak), extendedClampCurve(rgb.z, peak));
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
  let offset = u_bind6;
  let peak = u_bind7;
  let srgbDecode = u_bind8 > 0.5;

  // 0) [SDR display-transfer path] sRGB-DECODE the sampled 8-bit source to
  //    linear light so exposure/offset + the chosen transfer operate on linear
  //    values (tev-style). Off for the HDR/float path (scene-linear already).
  var src = sampled.rgb;
  if (srgbDecode) {
    src = vec3<f32>(srgbEotf(src.r), srgbEotf(src.g), srgbEotf(src.b));
  }

  // 1) exposure + offset (TEV convention), in scene-linear space:
  //    v * 2^EV + offset. Offset is additive AFTER exposure, BEFORE the
  //    colormap / tone-map / output-encode stages below.
  var rgb = src * exp2(exposureEV) + vec3<f32>(offset);

  // 2) scalar image + colormap LUT (GPU-only pipeline stage; see module doc).
  //    The LUT lookup mirrors the SOURCE filter: bilinear source sampling pairs
  //    with a LINEAR LUT lookup (interpolate the scalar across texels, THEN
  //    interpolate the LUT across its entries — the smooth false-color path),
  //    nearest source sampling pairs with the crisp round-half-up NEAREST index.
  //    Keying both off the one filterLinear flag keeps colormapped rendering
  //    from diverging from the plain path's interpolation at any zoom.
  if (isScalar) {
    if (filterLinear) {
      rgb = sampleLutLinearF(rgb.x);
    } else {
      rgb = sampleLutNearestF(rgb.x);
    }
  }

  // 3) tone-map operator: HDR [0,inf) -> display-linear [0,1] (or [0,peak] for
  //    the extended roll-off operators, which stay HDR-out).
  rgb = applyOperator(rgb, operatorId, peak);

  // 4) output-encode.
  let hasGamma = gamma > 0.0;
  if (hdrOut) {
    // EXTENDED HDR surface (rgba16float, srgb/display-p3): the canvas stores
    // TRANSFER-ENCODED (non-linear) signals per W3C ColorWeb-CG, so ENCODE the
    // display-linear light the operator produced — the extended (unclamped,
    // origin-mirrored) sRGB OETF, or the extended power curve for the Gamma
    // operator (hasGamma). Values above 1 / below 0 survive as extended
    // brightness. See extendedOutputEncodeF + image/tonemap.ts's doc block.
    return vec4<f32>(
      extendedOutputEncodeF(rgb.r, gamma, hasGamma),
      extendedOutputEncodeF(rgb.g, gamma, hasGamma),
      extendedOutputEncodeF(rgb.b, gamma, hasGamma),
      1.0,
    );
  }
  return vec4<f32>(
    outputEncodeF(rgb.r, gamma, hasGamma),
    outputEncodeF(rgb.g, gamma, hasGamma),
    outputEncodeF(rgb.b, gamma, hasGamma),
    1.0,
  );
}
`,be=`
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
`,$e=`
// Manual bilinear blend over a source texture (see image.wgsl.ts's
// sampleBilinearF doc comment for why this is hand-rolled).
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

// Colormap LUT lookup, nearest and linear variants (see image.wgsl.ts's
// sampleLutNearestF/sampleLutLinearF doc). Callers pick the variant with the
// SAME filterMode flag that selects nearest vs. bilinear source sampling, so a
// colormapped result shares one interpolation decision with the plain path:
//  - NEAREST (round-half-up index) at the pixelated zoom — crisp per-texel color.
//  - LINEAR (blend adjacent entries by the fractional index) at moderate zoom —
//    so a bilinearly-interpolated scalar yields a smooth color rather than
//    snapping to one of 256 discrete bins (the per-texel banding / blocky
//    corners bug). At a texel-aligned 8-bit scalar the fraction is 0, so LINEAR
//    degenerates to the exact NEAREST entry.
fn sampleLUT(lut: texture_2d<f32>, valueUnit: f32) -> vec3<f32> {
  let idxF = clamp(valueUnit, 0.0, 1.0) * 255.0;
  let idx = clamp(i32(floor(idxF + 0.5)), 0, 255);
  return textureLoad(lut, vec2<i32>(idx, 0), 0).rgb;
}

fn sampleLUTLinear(lut: texture_2d<f32>, valueUnit: f32) -> vec3<f32> {
  let idxF = clamp(valueUnit, 0.0, 1.0) * 255.0;
  let base = floor(idxF);
  let i0 = clamp(i32(base), 0, 255);
  let i1 = min(i0 + 1, 255);
  let frac = idxF - base;
  let c0 = textureLoad(lut, vec2<i32>(i0, 0), 0).rgb;
  let c1 = textureLoad(lut, vec2<i32>(i1, 0), 0).rgb;
  return mix(c0, c1, frac);
}
`,pt=`
fn mapSample(
  tex: texture_2d<f32>, resultPx: vec2<i32>,
  offX: f32, offY: f32, resW: f32, resH: f32, fitFill: f32,
) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(tex));
  if (fitFill > 0.5) {
    let uv = (vec2<f32>(resultPx) + vec2<f32>(0.5)) / vec2<f32>(resW, resH);
    return sampleBilinearOf(tex, uv, vec2<f32>(dims));
  }
  let off = vec2<i32>(i32(round(offX)), i32(round(offY)));
  let p = clamp(resultPx + off, vec2<i32>(0), dims - vec2<i32>(1));
  return textureLoad(tex, p, 0);
}
`,La=`
fn srgbOetf(x: f32) -> f32 {
  let v = clamp(x, 0.0, 1.0);
  if (v <= 0.0031308) { return 12.92 * v; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

// sRGB EOTF (sRGB code -> linear) — inverse of srgbOetf. LINEARIZES an 8-bit
// sRGB compare side when srgbDecode is set (a u8 source going through the
// display-transfer pipeline), so exposure/offset + the operator act on linear
// light. A float side leaves srgbDecode off (already scene-linear).
fn srgbEotf(x: f32) -> f32 {
  let v = clamp(x, 0.0, 1.0);
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn outputEncodeF(x: f32, gamma: f32, hasGamma: bool) -> f32 {
  if (hasGamma) { return clamp(pow(clamp(x, 0.0, 1.0), 1.0 / gamma), 0.0, 1.0); }
  return srgbOetf(x);
}

// EXTENDED output-encode (HDR-out / extended-surface transfer) — unclamped,
// origin-mirrored sRGB OETF / power curve (values past 1 survive as extended
// brightness). Mirrors image.wgsl.ts's extendedSrgbOetf/extendedGammaEncode/
// extendedOutputEncodeF exactly.
fn extendedSrgbOetf(x: f32) -> f32 {
  let a = abs(x);
  let s = sign(x);
  if (a <= 0.0031308) { return s * 12.92 * a; }
  return s * (1.055 * pow(a, 1.0 / 2.4) - 0.055);
}
fn extendedGammaEncode(x: f32, gamma: f32) -> f32 {
  let a = abs(x);
  let s = sign(x);
  return s * pow(a, 1.0 / gamma);
}
fn extendedOutputEncodeF(x: f32, gamma: f32, hasGamma: bool) -> f32 {
  if (hasGamma) { return extendedGammaEncode(x, gamma); }
  return extendedSrgbOetf(x);
}

fn reinhardCurve(x: f32) -> f32 { let v = max(x, 0.0); return v / (1.0 + v); }
fn acesCurve(x: f32) -> f32 {
  let v = max(x, 0.0);
  let num = v * (2.51 * v + 0.03);
  let den = v * (2.43 * v + 0.59) + 0.14;
  return clamp(num / den, 0.0, 1.0);
}

// Peak-parameterized extended operators (ids 5/6/7) — mirror image.wgsl.ts
// exactly: Reinhard rescaled to asymptote P, ACES canonical-scaled to P, and the
// managed hard clamp at P.
fn extendedReinhardCurve(x: f32, peak: f32) -> f32 { let v = max(x, 0.0); let p = max(peak, 1e-6); return v / (1.0 + v / p); }
fn extendedAcesCurve(x: f32, peak: f32) -> f32 { let v = max(x, 0.0); let p = max(peak, 1e-6); return p * acesCurve(v / p); }
fn extendedClampCurve(x: f32, peak: f32) -> f32 { let v = max(x, 0.0); let p = max(peak, 1e-6); return min(v, p); }

// operatorId: 0=linear, 1=srgb, 2=reinhard, 3=aces, 4=extended (pure identity),
// 5=extended-reinhard, 6=extended-aces, 7=extended-clamp, 8=gamma (clamp; γ in
// the encode). Ids 5/6/7 read the peak uniform. Matches image.wgsl.ts's
// applyOperator + OPERATOR_ID in image-engine.ts.
fn applyOperator(rgb: vec3<f32>, operatorId: i32, peak: f32) -> vec3<f32> {
  if (operatorId == 2) { return vec3<f32>(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z)); }
  if (operatorId == 3) { return vec3<f32>(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z)); }
  if (operatorId == 4) { return rgb; }
  if (operatorId == 5) { return vec3<f32>(extendedReinhardCurve(rgb.x, peak), extendedReinhardCurve(rgb.y, peak), extendedReinhardCurve(rgb.z, peak)); }
  if (operatorId == 6) { return vec3<f32>(extendedAcesCurve(rgb.x, peak), extendedAcesCurve(rgb.y, peak), extendedAcesCurve(rgb.z, peak)); }
  if (operatorId == 7) { return vec3<f32>(extendedClampCurve(rgb.x, peak), extendedClampCurve(rgb.y, peak), extendedClampCurve(rgb.z, peak)); }
  return clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Per-side [sRGB-DECODE] -> exposure+offset -> [scalar LUT] -> operator(peak) ->
// encode. srgbDecode LINEARIZES a u8 side first (a float side passes it 0). The
// lut is only read when isScalar. offset is the TEV display offset (added AFTER
// exposure, BEFORE colormap/tonemap/encode). On hdrOut the EXTENDED (unclamped)
// encode runs so values past P survive to the extended HDR surface.
fn processSide(lut: texture_2d<f32>, sampled: vec4<f32>, exposureEV: f32, offset: f32, operatorId: i32, gamma: f32, isScalar: bool, hdrOut: bool, peak: f32, srgbDecode: bool, filterLinear: bool) -> vec3<f32> {
  var src = sampled.rgb;
  if (srgbDecode) { src = vec3<f32>(srgbEotf(src.r), srgbEotf(src.g), srgbEotf(src.b)); }
  var rgb = src * exp2(exposureEV) + vec3<f32>(offset);
  // LUT lookup mirrors the source filter (see sampleLUT/sampleLUTLinear doc):
  // bilinear source sampling -> linear LUT, nearest -> nearest, so colormapped
  // compare sides interpolate exactly like the plain single-image path.
  if (isScalar) {
    if (filterLinear) { rgb = sampleLUTLinear(lut, rgb.x); }
    else { rgb = sampleLUT(lut, rgb.x); }
  }
  rgb = applyOperator(rgb, operatorId, peak);
  let hasGamma = gamma > 0.0;
  if (hdrOut) {
    return vec3<f32>(extendedOutputEncodeF(rgb.r, gamma, hasGamma), extendedOutputEncodeF(rgb.g, gamma, hasGamma), extendedOutputEncodeF(rgb.b, gamma, hasGamma));
  }
  return vec3<f32>(outputEncodeF(rgb.r, gamma, hasGamma), outputEncodeF(rgb.g, gamma, hasGamma), outputEncodeF(rgb.b, gamma, hasGamma));
}
`,Nt=`
const M_RGB2XYZ = mat3x3<f32>(
  // column-major: WGSL mat3x3 columns are the 3 args; we store rows via transpose usage below.
  vec3<f32>(10135552.0/24577794.0, 2613072.0/12288897.0, 1425312.0/73733382.0),
  vec3<f32>(8788810.0/24577794.0, 8788810.0/12288897.0, 8788810.0/73733382.0),
  vec3<f32>(4435075.0/24577794.0, 887015.0/12288897.0, 70074185.0/73733382.0)
);
// Exact inverse of M_RGB2XYZ (columns), so ycxcz->linrgb round-trips the
// forward transform used in flip-reference.ts.
const M_XYZ2RGB = mat3x3<f32>(
  vec3<f32>(3.241003232976358, -0.9692242522025163, 0.0556394198519754),
  vec3<f32>(-1.537398969488785, 1.875929983695176, -0.2040112061239099),
  vec3<f32>(-0.4986158819963628, 0.04155422634008469, 1.057148977187533)
);
const WHITE_INV = vec3<f32>(1.052156925, 1.0, 0.918357670);
const LAB_DELTA = 6.0 / 29.0;

fn flip_srgb2linear(c: f32) -> f32 {
  if (c <= 0.04045) { return c / 12.92; }
  return pow((c + 0.055) / 1.055, 2.4);
}
// Linear RGB -> YCxCz (no OETF decode). Used by HDR-FLIP (tone-mapped, already
// linear inputs, hdr-flip.ts) and forced-LDR-on-float (linear-clamp input,
// flip.wgsl.ts); matches flip-reference.ts's linrgb2ycxcz.
fn flip_linrgb2ycxcz(lin: vec3<f32>) -> vec3<f32> {
  let xyz = M_RGB2XYZ * lin;
  let n = xyz * WHITE_INV;
  return vec3<f32>(116.0 * n.y - 16.0, 500.0 * (n.x - n.y), 200.0 * (n.y - n.z));
}
fn flip_rgb2ycxcz(srgb: vec3<f32>) -> vec3<f32> {
  let lin = vec3<f32>(flip_srgb2linear(srgb.r), flip_srgb2linear(srgb.g), flip_srgb2linear(srgb.b));
  return flip_linrgb2ycxcz(lin);
}
fn flip_ycxcz2linrgb(yc: vec3<f32>) -> vec3<f32> {
  let yy = (yc.x + 16.0) / 116.0;
  let x = (yy + yc.y / 500.0) / WHITE_INV.x;
  let yN = yy / WHITE_INV.y;
  let z = (yy - yc.z / 200.0) / WHITE_INV.z;
  return M_XYZ2RGB * vec3<f32>(x, yN, z);
}
fn flip_labF(t: f32) -> f32 {
  if (t > LAB_DELTA * LAB_DELTA * LAB_DELTA) { return pow(t, 1.0 / 3.0); }
  return t / (3.0 * LAB_DELTA * LAB_DELTA) + 4.0 / 29.0;
}
fn flip_linrgb2huntlab(rgb: vec3<f32>) -> vec3<f32> {
  let xyz = M_RGB2XYZ * clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
  let n = xyz * WHITE_INV;
  let fx = flip_labF(n.x);
  let fy = flip_labF(n.y);
  let fz = flip_labF(n.z);
  let L = 116.0 * fy - 16.0;
  let a = 500.0 * (fx - fy);
  let b = 200.0 * (fy - fz);
  return vec3<f32>(L, 0.01 * L * a, 0.01 * L * b);
}
fn flip_hyab(l1: vec3<f32>, l2: vec3<f32>) -> f32 {
  let d = l1 - l2;
  return abs(d.x) + sqrt(d.y * d.y + d.z * d.z);
}
`;function mn(e){return`
${be}
${$e}
${La}

@group(0) @binding(0) var texA: texture_2d<f32>;
@group(0) @binding(3) var texB: texture_2d<f32>;
@group(0) @binding(6) var lut: texture_2d<f32>;
@group(0) @binding(11) var<uniform> u_img: vec4<f32>;     // exposureEV, operatorId, gamma, isScalar
@group(0) @binding(14) var<uniform> u_uv: vec4<f32>;      // uvRect.xy, uvRect.wh
@group(0) @binding(17) var<uniform> u_compose: vec4<f32>; // split, alpha, hdrOut, filterMode
@group(0) @binding(20) var<uniform> u_extra: vec4<f32>;   // offset, peak, srgbDecodeA, srgbDecodeB

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let uv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(0.999999));
  let uvRect = u_uv;
  let rawSrcUV = uvRect.xy + uv * uvRect.zw;
  if (rawSrcUV.x < 0.0 || rawSrcUV.x >= 1.0 || rawSrcUV.y < 0.0 || rawSrcUV.y >= 1.0) {
    return vec4<f32>(0.0);
  }
  let srcUV = clamp(rawSrcUV, vec2<f32>(0.0), vec2<f32>(0.999999));
  let filterLinear = u_compose.w > 0.5;

  let dimsA = vec2<f32>(textureDimensions(texA));
  var sampledA: vec4<f32>;
  if (filterLinear) { sampledA = sampleBilinearOf(texA, srcUV, dimsA); }
  else { sampledA = textureLoad(texA, vec2<i32>(srcUV * dimsA), 0); }

  let dimsB = vec2<f32>(textureDimensions(texB));
  var sampledB: vec4<f32>;
  if (filterLinear) { sampledB = sampleBilinearOf(texB, srcUV, dimsB); }
  else { sampledB = textureLoad(texB, vec2<i32>(srcUV * dimsB), 0); }

  let exposureEV = u_img.x;
  let operatorId = i32(round(u_img.y));
  let gamma = u_img.z;
  let isScalar = u_img.w > 0.5;
  let hdrOut = u_compose.z > 0.5;
  let offset = u_extra.x;
  let peak = u_extra.y;
  let srgbDecodeA = u_extra.z > 0.5;
  let srgbDecodeB = u_extra.w > 0.5;

  let colorA = processSide(lut, sampledA, exposureEV, offset, operatorId, gamma, isScalar, hdrOut, peak, srgbDecodeA, filterLinear);
  let colorB = processSide(lut, sampledB, exposureEV, offset, operatorId, gamma, isScalar, hdrOut, peak, srgbDecodeB, filterLinear);

  let split = u_compose.x;
  let alpha = u_compose.y;
  let outColor = ${e};
  return vec4<f32>(outColor, 1.0);
}
`}const Ca=mn("select(colorB, colorA, uv.x < split)"),ka=mn("mix(colorA, colorB, alpha)");function Ga(e){switch(e){case"center":return{v:"center",h:"center"};case"top-right":return{v:"top",h:"right"};case"bottom-left":return{v:"bottom",h:"left"};case"bottom-right":return{v:"bottom",h:"right"};case"top-left":default:return{v:"top",h:"left"}}}function Er(e,t,r){const{v:n,h:a}=Ga(r),s=e.w-t.w,i=e.h-t.h,o=a==="left"?0:a==="right"?s:Math.floor(s/2),c=n==="top"?0:n==="bottom"?i:Math.floor(i/2);return{x:o,y:c}}function mt(e,t,r,n,a="b"){if(n==="fill"){const i=a==="a"?{w:e.w,h:e.h}:{w:t.w,h:t.h};return{fit:n,result:i,offsetA:{x:0,y:0},offsetB:{x:0,y:0}}}const s={w:Math.min(e.w,t.w),h:Math.min(e.h,t.h)};return{fit:n,result:s,offsetA:Er(e,s,r),offsetB:Er(t,s,r)}}function ur(e){return`${e.fit}:${e.result.w}x${e.result.h}:${e.offsetA.x},${e.offsetA.y}:${e.offsetB.x},${e.offsetB.y}`}const Pt={linear:0,srgb:1,reinhard:2,aces:3,extended:4,"extended-reinhard":5,"extended-aces":6,"extended-clamp":7,gamma:8},Rr=new WeakMap;function Oa(e,t){let r=Rr.get(e);r||(r=new Map,Rr.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:Ba,targetFormat:t}),r.set(t,n)),n}function gn(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function hn(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function Ua(e,t,r,n){var L;const a=gn(t),s=Oa(e,a),i=hn(e,n.isScalar?n.colormap:void 0),o=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,c=Pt[n.operator]??Pt.srgb,l=new Float32Array([n.exposureEV,c,o,n.isScalar?1:0]),f=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),p=new Float32Array([n.hdrOut?1:0]),m=new Float32Array([n.filter==="nearest"?0:1]),b=new Float32Array([n.offset??0]),v=new Float32Array([n.peak??Ft]),_=new Float32Array([n.srgbDecode?1:0]);let E;try{E=e.createBindGroup(s,[{binding:0,resource:r},{binding:1,resource:i},{binding:2,resource:{uniform:l}},{binding:3,resource:{uniform:f}},{binding:4,resource:{uniform:p}},{binding:5,resource:{uniform:m}},{binding:6,resource:{uniform:b}},{binding:7,resource:{uniform:v}},{binding:8,resource:{uniform:_}}]),e.renderFullscreen(t,s,E)}finally{(L=E==null?void 0:E.destroy)==null||L.call(E),i.destroy()}}const Sr=new WeakMap;function Fa(e,t,r){let n=Sr.get(e);n||(n=new Map,Sr.set(e,n));const a=`${t}:${r}`;let s=n.get(a);return s||(s=e.createRenderPipeline({shaderWGSL:t==="split"?Ca:ka,targetFormat:r}),n.set(a,s)),s}function Ia(e,t,r,n,a){var _;if(a.mode==="diff")throw new Error("renderCompose: mode 'diff' is handled by the diff-engine, not renderCompose");const s=gn(t),i=Fa(e,a.mode,s),o=hn(e,a.isScalar?a.colormap:void 0),c=typeof a.gamma=="number"&&a.gamma>0?a.gamma:0,l=Pt[a.operator]??Pt.srgb,f=new Float32Array([a.exposureEV,l,c,a.isScalar?1:0]),p=new Float32Array([a.uv.x,a.uv.y,a.uv.w,a.uv.h]),m=new Float32Array([a.split,a.alpha,a.hdrOut?1:0,a.filter==="nearest"?0:1]),b=new Float32Array([a.offset??0,a.peak??Ft,a.srgbDecodeA?1:0,a.srgbDecodeB?1:0]);let v;try{v=e.createBindGroup(i,[{binding:0,resource:r},{binding:1,resource:n},{binding:2,resource:o},{binding:3,resource:{uniform:f}},{binding:4,resource:{uniform:p}},{binding:5,resource:{uniform:m}},{binding:6,resource:{uniform:b}}]),e.renderFullscreen(t,i,v)}finally{(_=v==null?void 0:v.destroy)==null||_.call(v),o.destroy()}}function _r(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,a=t/r,s=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:s,mae:a}}async function xn(e,t,r,n){const a=n??mt({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),s=a.result.w,i=a.result.h,o=s*i*3;if(o<=0)return{mse:0,psnr:1/0,mae:0};if(a.fit==="crop"&&a.offsetA.x===0&&a.offsetA.y===0&&a.offsetB.x===0&&a.offsetB.y===0&&e.reduceDiffSumSquaredAbs){const{sumSq:u,sumAbs:x}=await e.reduceDiffSumSquaredAbs(t,r,s,i);return _r(u,x,o)}const l=await e.readback(t),f=await e.readback(r),p=l instanceof Uint8Array?255:1,m=f instanceof Uint8Array?255:1,b=Dt(l,t.width,t.height,p,a.offsetA,a.fit==="fill",s,i),v=Dt(f,r.width,r.height,m,a.offsetB,a.fit==="fill",s,i);let _=0,E=0;const L=[0,0,0],h=[0,0,0];for(let u=0;u<i;u++)for(let x=0;x<s;x++){b(x,u,L),v(x,u,h);for(let y=0;y<3;y++){const w=L[y]-h[y];_+=w*w,E+=Math.abs(w)}}return _r(_,E,o)}function Dt(e,t,r,n,a,s,i,o){const c=(p,m,b)=>e[(m*t+p)*4+b]??0;if(!s)return(p,m,b)=>{const v=Math.min(Math.max(p+a.x,0),t-1),_=Math.min(Math.max(m+a.y,0),r-1);b[0]=c(v,_,0)/n,b[1]=c(v,_,1)/n,b[2]=c(v,_,2)/n};const l=t-1,f=r-1;return(p,m,b)=>{const v=(p+.5)/i,_=(m+.5)/o,E=v*t-.5,L=_*r-.5,h=Math.floor(E),u=Math.floor(L),x=E-h,y=L-u,w=Math.min(Math.max(h,0),l),R=Math.min(Math.max(h+1,0),l),C=Math.min(Math.max(u,0),f),U=Math.min(Math.max(u+1,0),f);for(let D=0;D<3;D++){const B=c(w,C,D),Y=c(R,C,D),F=c(w,U,D),X=c(R,U,D),ee=B+(Y-B)*x,de=F+(X-F)*x;b[D]=(ee+(de-ee)*y)/n}}}function bn(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const Na=12,Ge=[];function Ar(e){const t=Ge.indexOf(e);t!==-1&&Ge.splice(t,1),Ge.push(e)}function za(e){const t=Ge.indexOf(e);t!==-1&&Ge.splice(t,1)}function Bt(e){e.parked||(za(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),e.surface=null,e.parked=!0)}function Tr(e){for(;Ge.length>Na;){const t=Ge.find(r=>r!==e&&!r.visible)??Ge.find(r=>r!==e);if(!t)break;Bt(t)}}function vn(e){var a,s,i,o;if(e.disposed)return;if(bn())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Ar(e),Tr(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const r=e.backingWidth||((a=e.source)==null?void 0:a.width)||((s=e.deep)==null?void 0:s.width)||1,n=e.backingHeight||((i=e.source)==null?void 0:i.height)||((o=e.deep)==null?void 0:o.height)||1;if(e.canvas.width=r,e.canvas.height=n,e.surface.configure(r,n),e.deep){const c=t.createTexture(e.deep.width,e.deep.height,"rgba16float");e.srcTexture=c,e.deepBuffers=t.createDeepSampleBuffers(e.deep),t.compositeDeep(e.deepBuffers,c,e.deepZNear,e.deepZFar)}else if(e.source){const c=t.createTexture(e.source.width,e.source.height,e.source.format);c.write(e.source.data),e.srcTexture=c}e.parked=!1,Ar(e),Tr(e)}function Va(e,t){if(e.disposed||!e.source&&!e.deep)return!0;try{return vn(e),!e.surface||!e.srcTexture?!1:(Ua(e.device,e.surface,e.srcTexture,t),!0)}catch(r){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",r),e.parked=!1,Bt(e),!1}}function $a(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,e.deep=null,e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const r=e.device.createTexture(t.width,t.height,t.format);r.write(t.data),e.srcTexture=r}},setDeepSource(t,r,n){if(!e.disposed&&(e.deep=t,e.deepZNear=r,e.deepZFar=n,e.source=null,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy(),e.deepBuffers&&e.deepBuffers.destroy();const a=e.device.createTexture(t.width,t.height,"rgba16float");e.srcTexture=a,e.deepBuffers=e.device.createDeepSampleBuffers(t),e.device.compositeDeep(e.deepBuffers,a,r,n)}},setDeepWindow(t,r){e.disposed||(e.deepZNear=t,e.deepZFar=r,!e.parked&&e.deepBuffers&&e.srcTexture&&e.device.compositeDeep(e.deepBuffers,e.srcTexture,t,r))},resize(t,r){if(e.disposed)return;const n=Math.max(1,Math.round(t)),a=Math.max(1,Math.round(r));e.backingWidth===n&&e.backingHeight===a||(e.backingWidth=n,e.backingHeight=a,!e.parked&&e.surface&&(e.canvas.width=n,e.canvas.height=a,e.surface.configure(n,a)))},render(t){return Va(e,t)},park(){e.disposed||Bt(e)},restore(){e.disposed||!e.source&&!e.deep||vn(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Bt(e),e.source=null,e.deep=null,e.disposed=!0)}}}async function Ha(e,t){const r=await It(),n={canvas:e,device:r,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,deep:null,deepZNear:-1/0,deepZFar:1/0,deepBuffers:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return $a(n)}function Mr(e){e.dispose()}const Pr={"no-webgpu":0,"no-hdr-browser":1,"no-hdr-display":2},Wa="https://github.com/doeringchristian/cairn-plot/blob/main/docs/browser-support.md";function Ka(e,t=!1){const r=e||"";return t?"brave":/firefox/i.test(r)?"firefox":/safari/i.test(r)&&!/chrome|chromium|crios|android/i.test(r)?"safari":/linux/i.test(r)&&/chrome|chromium/i.test(r)?"chromium-linux":"chromium"}function qa(e){const t=e||"";return/mac os x|macintosh/i.test(t)?"macos":/windows/i.test(t)?"windows":"other"}function Xa(e,t){if(e==="no-hdr-display")switch(qa(t.userAgent)){case"macos":return"macOS: EDR engages automatically on HDR-capable displays — confirm your display supports HDR.";case"windows":return"Windows: turn on Settings → System → Display → Use HDR.";default:return"Enable HDR in your display and OS settings."}const r=Ka(t.userAgent,t.isBrave);if(e==="no-hdr-browser")switch(r){case"firefox":return"Firefox has no extended-tone-mapping canvas path at all — true HDR output is impossible until Firefox implements it (fundamental browser limitation).";case"safari":return"Safari's WebGPU HDR canvas tone-mapping is still maturing — update to the latest Safari 26+.";default:return"Chrome/Edge 129+ is required for HDR canvas output (toneMapping: extended) — update your browser."}switch(r){case"firefox":return"Firefox: about:config → dom.webgpu.enabled (HDR output is not available in Firefox at all — browser limitation).";case"safari":return"Safari: Develop → Feature Flags → WebGPU (Safari 26+ has it by default).";case"brave":return"Brave: check Shields fingerprint blocking + brave://flags.";case"chromium-linux":return"Chromium on Linux: enable chrome://flags/#enable-unsafe-webgpu.";case"chromium":default:return"Chrome/Edge: enable chrome://flags/#enable-unsafe-webgpu and hardware acceleration."}}function Ya(e){switch(e){case"no-webgpu":return"GPU renderer unavailable → CPU fallback active; FLIP kernels + HDR compare disabled.";case"no-hdr-browser":return"True HDR output is unsupported by this browser — a fundamental browser limitation, not a cairn-plot bug → HDR images tone-mapped to SDR.";case"no-hdr-display":return"Your display/OS is not in HDR mode → HDR images tone-mapped to SDR."}}function yn(e,t){return`cairn-plot:capnotice:${e}:${t}`}const wn=new Set;function Dr(e){try{if(window.localStorage.getItem(e)==="1")return!0}catch{}try{if(window.sessionStorage.getItem(e)==="1")return!0}catch{}return wn.has(e)}function ja(e){try{window.localStorage.setItem(e,"1");return}catch{}try{window.sessionStorage.setItem(e,"1");return}catch{}wn.add(e)}const Br=new Set;let Lt=null,nt=null;function En(){nt&&nt.parentNode&&nt.parentNode.removeChild(nt),nt=null,Lt=null}function Za(e){const t=yn(e,window.location.pathname),r=Xa(e,{userAgent:navigator.userAgent,isBrave:!!navigator.brave}),n=document.createElement("div");n.setAttribute("role","status"),n.setAttribute("data-cairn-plot-capnotice",e),Object.assign(n.style,{position:"fixed",bottom:"12px",right:"12px",zIndex:"2147483000",maxWidth:"340px",boxSizing:"border-box",padding:"10px 30px 10px 12px",borderRadius:"6px",border:"1px solid var(--color-border, #d0d7de)",background:"rgb(var(--color-bg-elevated-rgb, 246 248 250) / 0.9)",color:"var(--color-fg-muted, #656d76)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",boxShadow:"0 4px 12px rgba(0, 0, 0, 0.18)",font:"12px/1.4 system-ui, sans-serif"});const a=document.createElement("div");a.textContent=Ya(e),Object.assign(a.style,{fontWeight:"600",color:"var(--color-fg, #1f2328)",marginBottom:"4px"});const s=document.createElement("div");s.textContent=r,s.style.marginBottom="4px";const i=document.createElement("a");i.href=Wa,i.target="_blank",i.rel="noopener noreferrer",i.textContent="Learn more",Object.assign(i.style,{color:"var(--color-accent, #0969da)",textDecoration:"none"});const o=document.createElement("button");o.type="button",o.textContent="×",o.setAttribute("aria-label","Dismiss browser capability notice"),o.title="Dismiss",Object.assign(o.style,{position:"absolute",top:"4px",right:"6px",padding:"0 4px",border:"0",background:"transparent",color:"var(--color-fg-subtle, #8b949e)",cursor:"pointer",fontSize:"16px",lineHeight:"1"}),o.addEventListener("click",()=>{ja(t),En()}),n.appendChild(a),n.appendChild(s),n.appendChild(i),n.appendChild(o),document.body.appendChild(n),nt=n,Lt=e}function Rn(e){if(typeof document>"u"||typeof window>"u"||Br.has(e))return;Br.add(e);const t=yn(e,window.location.pathname);if(Dr(t))return;const r=()=>{if(!Dr(t)){if(Lt!==null)if(Pr[e]<Pr[Lt])En();else return;Za(e)}};document.body?r():window.addEventListener("DOMContentLoaded",r,{once:!0})}const Qa={data:new Float32Array(0),shape:[0,0],dtype:"<f4"};function Ja(e){const{h:t,w:r,c:n}=aa(e.shape);if(e.precision==="f16-bits"){const i=e.data,o=new Uint16Array(r*t*4);for(let c=0;c<r*t;c++){const l=c*n,f=c*4;if(n===1){const p=i[l];o[f]=p,o[f+1]=p,o[f+2]=p,o[f+3]=Mt}else o[f]=i[l],o[f+1]=i[l+1],o[f+2]=i[l+2],o[f+3]=n>=4?i[l+3]:Mt}return{data:o,width:r,height:t,format:"rgba16float"}}const a=e.data,s=new Float32Array(r*t*4);for(let i=0;i<r*t;i++){const o=i*n;let c,l,f,p=1;n===1?c=l=f=Be(a[o]):n===3?(c=Be(a[o]),l=Be(a[o+1]),f=Be(a[o+2])):(c=Be(a[o]),l=Be(a[o+1]),f=Be(a[o+2]),p=Be(a[o+3]));const m=i*4;s[m]=c,s[m+1]=l,s[m+2]=f,s[m+3]=p}return{data:s,width:r,height:t,format:"rgba32float"}}function Sn(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const a=Math.min(t.width/r,t.height/n),s=r*a,i=n*a,o=(t.width-s)/2,c=(t.height-i)/2,l=Math.max(e.zoom,1e-6),f=t.width/(l*s),p=t.height/(l*i),m=-o/s-e.pan.x/(l*s),b=-c/i-e.pan.y/(l*i);return{x:m,y:b,w:f,h:p}}function _n(e,t,r,n){const a=e.w*r,s=e.h*n;return a<=0||s<=0||t.width<=0||t.height<=0?0:Math.min(t.width/a,t.height/s)}function es(e){var Je,et,tt;const t=jn(e),r=Zn(t),n=d.useRef(null),a=d.useRef(null),s=d.useRef(null),i=d.useRef(null),o=d.useRef(null),c=r&&!!((Je=t.hdr)!=null&&Je.deep),l=d.useCallback((A,k)=>{var z,T;(z=i.current)==null||z.setDeepWindow(A,k),(T=o.current)==null||T.call(o)},[]),f=Qn(r?t.hdr:Qa,c?l:void 0),p=d.useRef(!1),[m,b]=d.useState(!1),[v,_]=d.useState(!1),[E,L]=d.useState(!1),[h,u]=d.useState(null),[x,y]=d.useState(0),[w,R]=d.useState(0),[C,U]=d.useState({x:0,y:0,w:1,h:1}),D=d.useRef(null),B=d.useRef(null),[Y,F]=d.useState(0),X=t.zoom??1,ee=t.pan??{x:0,y:0},de=t.onViewportChange,J=t.toolbar??!0,Z=r?"none":t.colormap??"none",[H,te,re]=Ce(Z);d.useEffect(()=>{te(Z)},[Z,te]);const ne=r?"none":H,ve=t.tonemap,[se,_e]=d.useState(null);d.useEffect(()=>{_e(null)},[ve]);const He=ln(ve),Oe=se??He,We=se!==null&&se!==He,zt=d.useCallback(()=>_e(null),[]),Ke=t.peak,gt=()=>Ke!=null&&Ke>0?Ke:fn(ve)??Ft,[Ae,at,Ue]=Ce(gt());d.useEffect(()=>{at(gt())},[Ke,ve]);const pe=t.gamma,[Fe,st,ht]=Ce(pe&&pe>0?pe:Xr);d.useEffect(()=>{pe&&pe>0&&st(pe)},[pe,st]);const[ie,qe]=d.useState(0),[ye,Me]=d.useState(0),K=Yr();d.useEffect(()=>{const A=n.current;if(!A)return;let k=!1;return It().then(z=>{var ce;if(k)return;const T=((ce=z.probeExtendedToneMapping)==null?void 0:ce.call(z))??!1,$=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,oe=T&&$&&(r||Z==="none");p.current=oe,b(oe),r&&!oe&&Rn(T?"no-hdr-display":"no-hdr-browser"),Ha(A,{hdr:oe}).then(fe=>{if(k){Mr(fe);return}i.current=fe,L(!0)}).catch(fe=>{k||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",fe),_(!0))})}).catch(z=>{k||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",z),_(!0))}),()=>{k=!0,i.current&&(Mr(i.current),i.current=null)}},[]),d.useEffect(()=>{const A=a.current;if(!A)return;const k=new ResizeObserver(()=>R(z=>z+1));return k.observe(A),()=>k.disconnect()},[]),d.useEffect(()=>{const A=a.current;if(!A)return;const k=new IntersectionObserver(z=>{const T=z[0];if(!T)return;const $=i.current;$&&($.setVisible(T.isIntersecting),T.isIntersecting?$.isParked&&($.restore(),R(I=>I+1)):$.park())},{threshold:0});return k.observe(A),()=>k.disconnect()},[]),d.useEffect(()=>{var z;if(!r||!E||c)return;const A=f.hdr;D.current=A;const k=Ja(A);(z=i.current)==null||z.setSource(k),u(T=>T&&T.w===k.width&&T.h===k.height?T:{w:k.width,h:k.height}),F(T=>T+1),y(T=>T+1)},[r,E,c,r?f.hdr:null]),d.useEffect(()=>{if(!r||!E||!c)return;const A=t.hdr,k=A.deep;D.current=A;let z=!1;return k.getGpuCsr().then(T=>{var $;z||(($=i.current)==null||$.setDeepSource(T,k.zMin,k.zMax),u(I=>I&&I.w===T.width&&I.h===T.height?I:{w:T.width,h:T.height}),F(I=>I+1),y(I=>I+1))}).catch(T=>{z||console.warn("[cairn] deep GPU CSR upload failed:",T)}),()=>{z=!0}},[r,E,c,r?t.hdr.deep:null]),d.useEffect(()=>{if(r||!E)return;const A=t,k=A.imageUrl,z=H;if(!k){B.current=null,u(null),F($=>$+1);return}let T=!1;return jr(k).then($=>{var ce,fe;if(T||!$)return;let I=$;if(z!=="none"){const W=`gpu::${k}::${z}::ev${ie}::off${ye}`,we=Jn(W);if(we)I=we;else{const ze=ea(z);I=ta($,z,ze,ie,ye),ra(W,I)}}B.current=$;const oe={data:I.data,width:I.width,height:I.height,format:"rgba8unorm"};(ce=i.current)==null||ce.setSource(oe),u(W=>W&&W.w===I.width&&W.h===I.height?W:{w:I.width,h:I.height}),(fe=A.onNaturalSize)==null||fe.call(A,I.width,I.height),F(W=>W+1),y(W=>W+1)}),()=>{T=!0}},[r,E,r?null:t.imageUrl,r?null:H,r?0:ie,r?0:ye]);const Ie=t.exposure??0,Xe=t.offset??0,me=!r&&ne==="none",ue=d.useCallback(()=>{const A=i.current;if(!A||!E||!h)return;const k=a.current,z=s.current,T=z?z.getBoundingClientRect():k?k.getBoundingClientRect():{width:h.w,height:h.h},$=Sn({zoom:X,pan:ee},T,h.w,h.h);U(W=>W.x===$.x&&W.y===$.y&&W.w===$.w&&W.h===$.h?W:$),T.width>0&&T.height>0&&A.resize(Math.round(T.width*K),Math.round(T.height*K));const I=_n($,T,h.w,h.h)>=Zr?"nearest":"linear",oe=$,ce=Qr(Oe,p.current?Ae:1,p.current,Fe),fe=r||me?{exposureEV:Ie+ie,offset:Xe+ye,operator:ce.operator,gamma:ce.gamma,isScalar:!1,hdrOut:ce.hdrOut,peak:ce.peak,srgbDecode:!r,uv:oe,filter:I}:{exposureEV:0,offset:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,srgbDecode:!1,uv:oe,filter:I};try{A.render(fe)||_(!0)}catch(W){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",W),_(!0)}},[E,h,X,ee.x,ee.y,Ie,Xe,ie,ye,Oe,Ae,Fe,me,r,ne,K]);o.current=ue,d.useEffect(()=>{ue()},[ue,x,w]);const Ne=d.useCallback((A,k,z)=>{if(r){const W=D.current,we=h;if(!W||!we||A<0||k<0||A>=we.w||k>=we.h)return null;const ze=W.shape.length===2?1:W.shape[2]??1,Pe=(k*we.w+A)*ze,ot=W.data,Ee=W.precision==="f16-bits"?ct=>Jr(ot[ct]??0):ct=>ot[ct]??0,Ve=ze===1?[Ee(Pe)]:[Ee(Pe),Ee(Pe+1),Ee(Pe+2)];return ft(Ve,"unit",z)}const T=B.current;if(!T||A<0||k<0||A>=T.width||k>=T.height)return null;const $=(k*T.width+A)*4,I=T.data[$],oe=T.data[$+1],ce=T.data[$+2];return ft(ne!=="none"||I===oe&&oe===ce?[I]:[I,oe,ce],"uint8",z)},[r,h,ne]),Ye=t.showAxes??!1,je=r?t.label??"":t.label,Ze=t.interpolation??"auto",xt=Ze==="auto"?void 0:Ze,ge=r?void 0:t.overlay,Qe=r?void 0:t.overlaySettings,bt=r?!1:t.isDraggable??!1,it=r?void 0:t.onDragStart;if(v)return Q.jsx(en,{...e});const vt=ge&&(Qe!=null&&Qe.enabled)&&h&&((((et=ge.boxes)==null?void 0:et.length)??0)>0||(((tt=ge.masks)==null?void 0:tt.length)??0)>0)?Q.jsx(na,{data:ge,settings:Qe,naturalWidth:h.w,naturalHeight:h.h}):void 0;return Q.jsx(tn,{paneAttrs:{"data-gpu-image-pane":"","data-gpu-backend-ready":E},viewportAttrs:{"data-gpu-image-viewport":""},toolbar:J,paneRef:a,wrapperRef:s,zoom:X,pan:ee,onViewportChange:de,naturalDims:h,checkerboard:"wrapper",wrapperClassName:"relative w-full h-full flex items-center justify-center",viewportPadding:Ye&&h?"16px 4px 4px 28px":0,surface:Q.jsx("canvas",{ref:n,className:"w-full h-full block",style:{imageRendering:xt},"data-gpu-image-canvas":!0}),showAxes:Ye,overlayNode:vt,overlay:{displayElRef:n,sample:Ne,version:Y,hasSource:!0,sourceWindow:C},notationSeed:t.pixelValueNotation??"decimal",exportCanvasRef:n,requestRender:ue,leadingMenus:r?[rr(Oe,A=>_e(A))]:me?[nr(ne,A=>te(A)),rr(Oe,A=>_e(A))]:[nr(ne,A=>te(A))],displayAdjust:{exposureEV:ie,offset:ye,onExposureChange:qe,onOffsetChange:Me},extraSliders:[...(r||me)&&m?[{id:"peak",label:"PK",title:"Peak white (×SDR white) — the HDR ceiling P every operator clips at (Linear/sRGB/Gamma hard-clip at P; Reinhard/ACES roll off toward P). P=1 reproduces the SDR rendition exactly; double-click to type a value, including 'inf' for the raw browser-clipped extended look.",min:an,max:nn,step:rn,value:Ae,onChange:at,format:A=>Number.isFinite(A)?`${A.toFixed(1)}×`:"∞"}]:[],...(r||me)&&un(Oe)?[{id:"gamma",label:"γ",title:"Display gamma γ for the Gamma transfer — display = clamp(value)^(1/γ), tev-style. Default 2.2 (close to sRGB, not identical). Double-click to type a value.",min:cn,max:on,step:sn,value:Fe,onChange:st,format:A=>A.toFixed(1)}]:[]],depthSliders:f.sliders,regionSelect:c?{rect:f.region,queryLive:f.queryRegionWindow,commit:f.commitRegion,remove:f.removeRegion}:void 0,onReset:()=>{re.reset(),zt(),Ue.reset(),ht.reset(),f.reset()},extraModified:re.isModified||We||Ue.isModified||ht.isModified||f.isModified,label:je,showLabelChip:!!je,isDraggable:bt,onDragStart:it})}const Ct=new Map;function Re(e){if(Ct.has(e.id))throw new Error(`registerDiffKernel: duplicate kernel id "${e.id}"`);Ct.set(e.id,e)}function ke(e){return Ct.get(e)}function ts(){return Array.from(Ct.values())}function An(e,t){return{...e.params??{},...t??{}}}const rs={kind:"pointwise",id:"signed",label:"Signed Error",publicName:"signed",displayRange:"signed",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(a.rgb - b.rgb, 1.0);
}
`},ns={kind:"pointwise",id:"absolute",label:"Absolute Error",publicName:"abs",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(abs(a.rgb - b.rgb), 1.0);
}
`},as={kind:"pointwise",id:"squared",label:"Squared Error",publicName:"square",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let d = a.rgb - b.rgb;
  return vec4<f32>(d * d, 1.0);
}
`},ss={kind:"pointwise",id:"relative_signed",label:"Relative Signed",publicName:"rel_signed",displayRange:"signed",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  return vec4<f32>((a.rgb - b.rgb) / denom, 1.0);
}
`},is={kind:"pointwise",id:"relative_absolute",label:"Relative Absolute",publicName:"rel_abs",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  return vec4<f32>(abs(a.rgb - b.rgb) / denom, 1.0);
}
`},os={kind:"pointwise",id:"relative_squared",label:"Relative Squared",publicName:"rel_square",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  let d = a.rgb - b.rgb;
  return vec4<f32>((d * d) / (denom * denom), 1.0);
}
`},Tn=[[10135552/24577794,8788810/24577794,4435075/24577794],[2613072/12288897,8788810/12288897,887015/12288897],[1425312/73733382,8788810/73733382,70074185/73733382]];us(Tn);const jt=[1.052156925,1,.91835767],cs=.7;function us(e){const[t,r,n]=e[0],[a,s,i]=e[1],[o,c,l]=e[2],f=s*l-i*c,p=-(a*l-i*o),m=a*c-s*o,v=1/(t*f+r*p+n*m);return[[f*v,-(r*l-n*c)*v,(r*i-n*s)*v],[p*v,(t*l-n*o)*v,-(t*i-n*a)*v],[m*v,-(t*c-r*o)*v,(t*s-r*a)*v]]}function ls(e,t,r,n){return[e[0][0]*t+e[0][1]*r+e[0][2]*n,e[1][0]*t+e[1][1]*r+e[1][2]*n,e[2][0]*t+e[2][1]*r+e[2][2]*n]}const Zt=6/29;function Qt(e){return e>Zt**3?Math.cbrt(e):e/(3*Zt*Zt)+4/29}function Lr(e,t,r){const[n,a,s]=ls(Tn,e,t,r),i=Qt(n*jt[0]),o=Qt(a*jt[1]),c=Qt(s*jt[2]),l=116*o-16,f=500*(i-o),p=200*(o-c);return[l,.01*l*f,.01*l*p]}function fs(e,t){const r=e[0]-t[0],n=e[1]-t[1],a=e[2]-t[2];return Math.abs(r)+Math.sqrt(n*n+a*a)}function ds(){const e=Lr(0,1,0),t=Lr(0,0,1);return Math.pow(fs(e,t),cs)}const ps=ds(),Mn=ps,ms=.082;function Pn(e){const t=[1,1,34.1],r=[.0047,.0053,.04],n=[0,0,13.5],a=[1e-5,1e-5,.025],s=Math.max(...r,...a),i=Math.ceil(3*Math.sqrt(s/(2*Math.PI**2))*e),o=1/e,c=Math.PI**2,l=[0,0,0];for(let f=-i;f<=i;f++)for(let p=-i;p<=i;p++){const m=(p*o)**2+(f*o)**2;for(let b=0;b<3;b++)l[b]+=t[b]*Math.sqrt(Math.PI/r[b])*Math.exp(-c*m/r[b])+n[b]*Math.sqrt(Math.PI/a[b])*Math.exp(-c*m/a[b])}return{r:i,deltaX:o,sums:l}}function Dn(e){const t=.5*ms*e,r=Math.ceil(3*t);let n=0,a=0,s=0;for(let i=-r;i<=r;i++)for(let o=-r;o<=r;o++){const c=Math.exp(-(o*o+i*i)/(2*t*t)),l=-o*c,f=(o*o/(t*t)-1)*c;l>0&&(n+=l),f>0?a+=f:s-=f}return{r,sd:t,edgeNorm:n,pointPos:a,pointNeg:s}}const gs=`
${be}
${Nt}
${$e}
${pt}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_map0: vec4<f32>; // offX, offY, fitFill, 0
@group(0) @binding(8) var<uniform> u_map1: vec4<f32>; // resultW, resultH, 0, 0
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.position.xy);
  let s = mapSample(src, px, u_map0.x, u_map0.y, u_map1.x, u_map1.y, u_map0.z);
  return vec4<f32>(flip_rgb2ycxcz(s.rgb), 1.0);
}
`,hs=`
${be}
${Nt}
${$e}
${pt}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_map0: vec4<f32>; // offX, offY, fitFill, 0
@group(0) @binding(8) var<uniform> u_map1: vec4<f32>; // resultW, resultH, 0, 0
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.position.xy);
  let s = mapSample(src, px, u_map0.x, u_map0.y, u_map1.x, u_map1.y, u_map0.z);
  return vec4<f32>(flip_linrgb2ycxcz(clamp(s.rgb, vec3<f32>(0.0), vec3<f32>(1.0))), 1.0);
}
`,kt=`
${be}
${Nt}
@group(0) @binding(0) var ycxcz: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_csf0: vec4<f32>; // deltaX, r, sumA, sumRG
@group(0) @binding(8) var<uniform> u_csf1: vec4<f32>; // sumBY, 0, 0, 0

const A1 = vec3<f32>(1.0, 1.0, 34.1);
const B1 = vec3<f32>(0.0047, 0.0053, 0.04);
const A2 = vec3<f32>(0.0, 0.0, 13.5);
const B2 = vec3<f32>(1e-5, 1e-5, 0.025);
const PI = 3.14159265358979;

@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let dims = vec2<i32>(textureDimensions(ycxcz));
  let px = vec2<i32>(in.position.xy);
  let deltaX = u_csf0.x;
  let r = i32(u_csf0.y);
  let sums = vec3<f32>(u_csf0.z, u_csf0.w, u_csf1.x);
  let pi2 = PI * PI;
  var acc = vec3<f32>(0.0);
  for (var dy = -r; dy <= r; dy = dy + 1) {
    for (var dx = -r; dx <= r; dx = dx + 1) {
      let sx = clamp(px.x + dx, 0, dims.x - 1);
      let sy = clamp(px.y + dy, 0, dims.y - 1);
      let v = textureLoad(ycxcz, vec2<i32>(sx, sy), 0).rgb;
      let z = f32(dx * dx) * deltaX * deltaX + f32(dy * dy) * deltaX * deltaX;
      let w = A1 * sqrt(PI / B1) * exp(-pi2 * z / B1) + A2 * sqrt(PI / B2) * exp(-pi2 * z / B2);
      acc = acc + (w / sums) * v;
    }
  }
  let lin = clamp(flip_ycxcz2linrgb(acc), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(flip_linrgb2huntlab(lin), 1.0);
}
`,Bn=`
${be}
@group(0) @binding(0) var labA: texture_2d<f32>;
@group(0) @binding(3) var labB: texture_2d<f32>;
@group(0) @binding(6) var ycxczA: texture_2d<f32>;
@group(0) @binding(9) var ycxczB: texture_2d<f32>;
@group(0) @binding(14) var<uniform> u0: vec4<f32>; // cmax, sd, rF, edgeNorm
@group(0) @binding(17) var<uniform> u1: vec4<f32>; // pointPos, pointNeg, 0, 0

const QC = 0.7;
const PC = 0.4;
const PT = 0.95;
const QF = 0.5;

fn hyab(l1: vec3<f32>, l2: vec3<f32>) -> f32 {
  let d = l1 - l2;
  return abs(d.x) + sqrt(d.y * d.y + d.z * d.z);
}

@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let dims = vec2<i32>(textureDimensions(labA));
  let px = vec2<i32>(in.position.xy);

  // --- color difference (HyAB, redistributed) ---
  let la = textureLoad(labA, px, 0).rgb;
  let lb = textureLoad(labB, px, 0).rgb;
  let cmax = u0.x;
  let pccmax = PC * cmax;
  let power = pow(hyab(la, lb), QC);
  var deltaEc: f32;
  if (power < pccmax) {
    deltaEc = (PT / pccmax) * power;
  } else {
    deltaEc = PT + ((power - pccmax) / (cmax - pccmax)) * (1.0 - PT);
  }

  // --- feature difference (edge/point on unfiltered achromatic channel) ---
  let sd = u0.y;
  let rF = i32(u0.z);
  let edgeNorm = u0.w;
  let pointPos = u1.x;
  let pointNeg = u1.y;
  var exR = 0.0; var eyR = 0.0; var pxR = 0.0; var pyR = 0.0;
  var exT = 0.0; var eyT = 0.0; var pxT = 0.0; var pyT = 0.0;
  for (var dy = -rF; dy <= rF; dy = dy + 1) {
    for (var dx = -rF; dx <= rF; dx = dx + 1) {
      let sx = clamp(px.x + dx, 0, dims.x - 1);
      let sy = clamp(px.y + dy, 0, dims.y - 1);
      let yr = (textureLoad(ycxczA, vec2<i32>(sx, sy), 0).x + 16.0) / 116.0;
      let yt = (textureLoad(ycxczB, vec2<i32>(sx, sy), 0).x + 16.0) / 116.0;
      let fx = f32(dx); let fy = f32(dy);
      let g = exp(-(fx * fx + fy * fy) / (2.0 * sd * sd));
      // edge (1st deriv), pos/neg symmetric -> single norm
      let ex = (-fx * g) / edgeNorm;
      let ey = (-fy * g) / edgeNorm;
      // point (2nd deriv), pos/neg separate norm
      let pRawX = (fx * fx / (sd * sd) - 1.0) * g;
      let pRawY = (fy * fy / (sd * sd) - 1.0) * g;
      let pxw = select(pRawX / pointNeg, pRawX / pointPos, pRawX > 0.0);
      let pyw = select(pRawY / pointNeg, pRawY / pointPos, pRawY > 0.0);
      exR = exR + ex * yr; eyR = eyR + ey * yr; pxR = pxR + pxw * yr; pyR = pyR + pyw * yr;
      exT = exT + ex * yt; eyT = eyT + ey * yt; pxT = pxT + pxw * yt; pyT = pyT + pyw * yt;
    }
  }
  let edgesR = sqrt(exR * exR + eyR * eyR);
  let edgesT = sqrt(exT * exT + eyT * eyT);
  let pointsR = sqrt(pxR * pxR + pyR * pyR);
  let pointsT = sqrt(pxT * pxT + pyT * pyT);
  let df = max(abs(edgesR - edgesT), abs(pointsR - pointsT));
  let deltaEf = pow((1.0 / sqrt(2.0)) * df, QF);

  let flip = pow(deltaEc, 1.0 - deltaEf);
  return vec4<f32>(flip, flip, flip, 1.0);
}
`;function Se(e,t){return{binding:e,resource:{uniform:new Float32Array(t)}}}function Gt(e,t,r){const n=r.sourceMap,a=n?t==="a"?n.offsetA:n.offsetB:{x:0,y:0},s=n!=null&&n.fill?1:0;return[Se(e,[a.x,a.y,s,0]),Se(e+1,[r.width,r.height,0,0])]}function Ot(e){return[Se(1,[e.deltaX,e.r,e.sums[0],e.sums[1]]),Se(2,[e.sums[2],0,0,0])]}function Ln(e){return[Se(4,[Mn,e.sd,e.r,e.edgeNorm]),Se(5,[e.pointPos,e.pointNeg,0,0])]}function Cn(e,t,r,n,a,s=""){const i=Pn(e),o=Dn(e),c=`ycxczA${s}`,l=`ycxczB${s}`,f=`labA${s}`,p=`labB${s}`,m=`flip${s}`;return{passes:[{name:c,shader:t,inputs:[r],output:c,uniforms:()=>Gt(1,"a",a)},{name:l,shader:t,inputs:[n],output:l,uniforms:()=>Gt(1,"b",a)},{name:f,shader:kt,inputs:[c],output:f,uniforms:()=>Ot(i)},{name:p,shader:kt,inputs:[l],output:p,uniforms:()=>Ot(i)},{name:m,shader:Bn,inputs:[f,p,c,l],output:m,uniforms:()=>Ln(o)}],flipRef:m}}const xs={kind:"multipass",id:"flip",label:"FLIP (perceptual)",publicName:"flip",displayRange:"unit",output:"scalar",params:{ppd:67},buildPasses(e){const t=e.params.ppd??67,{passes:r,flipRef:n}=Cn(t,gs,"srcA","srcB",e);return{passes:r,final:n}}},bs={kind:"multipass",id:"flip-ldr-forced",label:"FLIP (LDR forced)",publicName:"flip_ldr",displayRange:"unit",output:"scalar",params:{ppd:67},buildPasses(e){const t=e.params.ppd??67,{passes:r,flipRef:n}=Cn(t,hs,"srcA","srcB",e);return{passes:r,final:n}}},Cr=`
${be}
${Nt}
${$e}
${pt}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_exp: vec4<f32>; // exposure (c_i), 0, 0, 0
@group(0) @binding(8) var<uniform> u_map0: vec4<f32>; // offX, offY, fitFill, 0
@group(0) @binding(11) var<uniform> u_map1: vec4<f32>; // resultW, resultH, 0, 0

const AK0 = 0.6 * 0.6 * 2.51;
const AK1 = 0.6 * 0.03;
const AK2 = 0.0;
const AK3 = 0.6 * 0.6 * 2.43;
const AK4 = 0.6 * 0.59;
const AK5 = 0.14;

fn aces(x: f32) -> f32 {
  let x2 = x * x;
  let nom = AK0 * x2 + AK1 * x + AK2;
  let denom = AK3 * x2 + AK4 * x + AK5;
  let y = nom / denom;
  return clamp(y, 0.0, 1.0);
}

@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.position.xy);
  let s = mapSample(src, px, u_map0.x, u_map0.y, u_map1.x, u_map1.y, u_map0.z).rgb;
  let scale = exp2(u_exp.x);
  let x = scale * s;
  let tm = vec3<f32>(aces(x.r), aces(x.g), aces(x.b));
  return vec4<f32>(flip_linrgb2ycxcz(tm), 1.0);
}
`,vs=`
${be}
@group(0) @binding(0) var labA: texture_2d<f32>;
@group(0) @binding(3) var labB: texture_2d<f32>;
@group(0) @binding(6) var ycxczA: texture_2d<f32>;
@group(0) @binding(9) var ycxczB: texture_2d<f32>;
@group(0) @binding(12) var prevMax: texture_2d<f32>;
@group(0) @binding(17) var<uniform> u0: vec4<f32>; // cmax, sd, rF, edgeNorm
@group(0) @binding(20) var<uniform> u1: vec4<f32>; // pointPos, pointNeg, 0, 0

const QC = 0.7;
const PC = 0.4;
const PT = 0.95;
const QF = 0.5;

fn hyab(l1: vec3<f32>, l2: vec3<f32>) -> f32 {
  let d = l1 - l2;
  return abs(d.x) + sqrt(d.y * d.y + d.z * d.z);
}

@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let dims = vec2<i32>(textureDimensions(labA));
  let px = vec2<i32>(in.position.xy);

  let la = textureLoad(labA, px, 0).rgb;
  let lb = textureLoad(labB, px, 0).rgb;
  let cmax = u0.x;
  let pccmax = PC * cmax;
  let power = pow(hyab(la, lb), QC);
  var deltaEc: f32;
  if (power < pccmax) {
    deltaEc = (PT / pccmax) * power;
  } else {
    deltaEc = PT + ((power - pccmax) / (cmax - pccmax)) * (1.0 - PT);
  }

  let sd = u0.y;
  let rF = i32(u0.z);
  let edgeNorm = u0.w;
  let pointPos = u1.x;
  let pointNeg = u1.y;
  var exR = 0.0; var eyR = 0.0; var pxR = 0.0; var pyR = 0.0;
  var exT = 0.0; var eyT = 0.0; var pxT = 0.0; var pyT = 0.0;
  for (var dy = -rF; dy <= rF; dy = dy + 1) {
    for (var dx = -rF; dx <= rF; dx = dx + 1) {
      let sx = clamp(px.x + dx, 0, dims.x - 1);
      let sy = clamp(px.y + dy, 0, dims.y - 1);
      let yr = (textureLoad(ycxczA, vec2<i32>(sx, sy), 0).x + 16.0) / 116.0;
      let yt = (textureLoad(ycxczB, vec2<i32>(sx, sy), 0).x + 16.0) / 116.0;
      let fx = f32(dx); let fy = f32(dy);
      let g = exp(-(fx * fx + fy * fy) / (2.0 * sd * sd));
      let ex = (-fx * g) / edgeNorm;
      let ey = (-fy * g) / edgeNorm;
      let pRawX = (fx * fx / (sd * sd) - 1.0) * g;
      let pRawY = (fy * fy / (sd * sd) - 1.0) * g;
      let pxw = select(pRawX / pointNeg, pRawX / pointPos, pRawX > 0.0);
      let pyw = select(pRawY / pointNeg, pRawY / pointPos, pRawY > 0.0);
      exR = exR + ex * yr; eyR = eyR + ey * yr; pxR = pxR + pxw * yr; pyR = pyR + pyw * yr;
      exT = exT + ex * yt; eyT = eyT + ey * yt; pxT = pxT + pxw * yt; pyT = pyT + pyw * yt;
    }
  }
  let edgesR = sqrt(exR * exR + eyR * eyR);
  let edgesT = sqrt(exT * exT + eyT * eyT);
  let pointsR = sqrt(pxR * pxR + pyR * pyR);
  let pointsT = sqrt(pxT * pxT + pyT * pyT);
  let df = max(abs(edgesR - edgesT), abs(pointsR - pointsT));
  let deltaEf = pow((1.0 / sqrt(2.0)) * df, QF);

  let flip = pow(deltaEc, 1.0 - deltaEf);
  let prev = textureLoad(prevMax, px, 0).x;
  let m = max(flip, prev);
  return vec4<f32>(m, m, m, 1.0);
}
`,ys={kind:"multipass",id:"hdr-flip",label:"FLIP (perceptual)",publicName:"flip_hdr",displayRange:"unit",output:"scalar",params:{ppd:67,startExposure:0,stopExposure:4,numExposures:2},buildPasses(e){const t=e.params.ppd??67,r=e.params.startExposure??0,n=e.params.stopExposure??4,a=Math.max(2,Math.round(e.params.numExposures??2)),s=(n-r)/Math.max(a-1,1),i=Pn(t),o=Dn(t),c=[];let l=null;for(let f=0;f<a;f++){const p=r+f*s,m=`_e${f}`,b=`ycxczA${m}`,v=`ycxczB${m}`,_=`labA${m}`,E=`labB${m}`,L=`acc${m}`;c.push({name:b,shader:Cr,inputs:["srcA"],output:b,uniforms:()=>[Se(1,[p,0,0,0]),...Gt(2,"a",e)]},{name:v,shader:Cr,inputs:["srcB"],output:v,uniforms:()=>[Se(1,[p,0,0,0]),...Gt(2,"b",e)]},{name:_,shader:kt,inputs:[b],output:_,uniforms:()=>Ot(i)},{name:E,shader:kt,inputs:[v],output:E,uniforms:()=>Ot(i)}),l===null?c.push({name:L,shader:Bn,inputs:[_,E,b,v],output:L,uniforms:()=>Ln(o)}):c.push({name:L,shader:vs,inputs:[_,E,b,v,l],output:L,uniforms:()=>[Se(5,[Mn,o.sd,o.r,o.edgeNorm]),Se(6,[o.pointPos,o.pointNeg,0,0])]}),l=L}return{passes:c,final:l}}},kn=.01,Gn=.03,Ut=1,ir=1.5,Le=5,Jt=[.2126,.7152,.0722];function er(e){return e<=.04045?e/12.92:Math.pow((e+.055)/1.055,2.4)}function kr(e,t,r){const n=Jt[0]*er(e)+Jt[1]*er(t)+Jt[2]*er(r);return Math.min(1,Math.max(0,n))}function ws(e,t){const r=2*t+1,n=new Float64Array(r);let a=0;for(let s=-t,i=0;s<=t;s++,i++){const o=Math.exp(-.5*s*s/(e*e));n[i]=o,a+=o}for(let s=0;s<r;s++)n[s]=n[s]/a;return n}function Gr(e,t){if(t===1)return 0;const r=2*t;let n=(e%r+r)%r;return n>=t&&(n=r-1-n),n}const On=()=>new Promise(e=>{typeof setTimeout=="function"?setTimeout(e,0):Promise.resolve().then(e)}),or=64;async function lt(e,t,r,n,a,s){const i=new Float64Array(t*r);for(let c=0;c<r;c++){for(let l=0;l<t;l++){let f=0;for(let p=-a,m=0;p<=a;p++,m++)f+=n[m]*e[c*t+Gr(l+p,t)];i[c*t+l]=f}(c+1)%or===0&&await s()}const o=new Float64Array(t*r);for(let c=0;c<r;c++){for(let l=0;l<t;l++){let f=0;for(let p=-a,m=0;p<=a;p++,m++)f+=n[m]*i[Gr(c+p,r)*t+l];o[c*t+l]=f}(c+1)%or===0&&await s()}return o}async function Es(e,t,r,n,a=On){const s=r*n;if(s<=0)return NaN;const i=ws(ir,Le),o=new Float64Array(s),c=new Float64Array(s),l=new Float64Array(s);for(let h=0;h<s;h++)o[h]=e[h]*e[h],c[h]=t[h]*t[h],l[h]=e[h]*t[h];const f=await lt(e,r,n,i,Le,a),p=await lt(t,r,n,i,Le,a),m=await lt(o,r,n,i,Le,a),b=await lt(c,r,n,i,Le,a),v=await lt(l,r,n,i,Le,a),_=(kn*Ut)**2,E=(Gn*Ut)**2;let L=0;for(let h=0;h<s;h++){const u=m[h]-f[h]*f[h],x=b[h]-p[h]*p[h],y=v[h]-f[h]*p[h],w=2*f[h]*p[h]+_,R=2*y+E,C=f[h]*f[h]+p[h]*p[h]+_,U=u+x+E;L+=w*R/(C*U)}return L/s}const Rs=`
fn ssim_srgb2linear(c: f32) -> f32 {
  if (c <= 0.04045) { return c / 12.92; }
  return pow((c + 0.055) / 1.055, 2.4);
}
fn ssim_luma(srgb: vec3<f32>) -> f32 {
  let lin = vec3<f32>(ssim_srgb2linear(srgb.r), ssim_srgb2linear(srgb.g), ssim_srgb2linear(srgb.b));
  return clamp(dot(lin, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
}
`,Un=`
${be}
${Rs}
${$e}
${pt}
@group(0) @binding(0) var srcA: texture_2d<f32>;
@group(0) @binding(3) var srcB: texture_2d<f32>;
@group(0) @binding(8) var<uniform> u_map: vec4<f32>;  // offAx, offAy, offBx, offBy
@group(0) @binding(11) var<uniform> u_res: vec4<f32>; // resultW, resultH, fitFill, 0
fn ssim_moment_luma(in: VSOut) -> vec2<f32> {
  let px = vec2<i32>(in.position.xy);
  let a = mapSample(srcA, px, u_map.x, u_map.y, u_res.x, u_res.y, u_res.z);
  let b = mapSample(srcB, px, u_map.z, u_map.w, u_res.x, u_res.y, u_res.z);
  return vec2<f32>(ssim_luma(a.rgb), ssim_luma(b.rgb));
}
`,Ss=`
${Un}
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let y = ssim_moment_luma(in);
  return vec4<f32>(y.x, y.y, y.x * y.x, y.y * y.y);
}
`,_s=`
${Un}
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let y = ssim_moment_luma(in);
  return vec4<f32>(y.x * y.y, 0.0, 0.0, 0.0);
}
`,Or=`
${be}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_blur: vec4<f32>;

fn ssim_reflect(i: i32, n: i32) -> i32 {
  if (n == 1) { return 0; }
  let period = 2 * n;
  var p = ((i % period) + period) % period;
  if (p >= n) { p = period - 1 - p; }
  return p;
}

@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let dims = vec2<i32>(textureDimensions(src));
  let px = vec2<i32>(in.position.xy);
  let dir = vec2<i32>(i32(round(u_blur.x)), i32(round(u_blur.y)));
  let r = i32(round(u_blur.z));
  let sigma = u_blur.w;
  var acc = vec4<f32>(0.0);
  var wsum = 0.0;
  for (var k = -r; k <= r; k = k + 1) {
    let g = exp(-0.5 * f32(k * k) / (sigma * sigma));
    let sx = ssim_reflect(px.x + dir.x * k, dims.x);
    let sy = ssim_reflect(px.y + dir.y * k, dims.y);
    acc = acc + g * textureLoad(src, vec2<i32>(sx, sy), 0);
    wsum = wsum + g;
  }
  return acc / wsum;
}
`,As=`
${be}
@group(0) @binding(0) var statsA: texture_2d<f32>; // (ux, uy, E[x^2], E[y^2])
@group(0) @binding(3) var statsB: texture_2d<f32>; // (E[xy], .., .., ..)
@group(0) @binding(8) var<uniform> u_c: vec4<f32>; // C1, C2, 0, 0
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.position.xy);
  let s = textureLoad(statsA, px, 0);
  let exy = textureLoad(statsB, px, 0).x;
  let ux = s.x;
  let uy = s.y;
  let vx = s.z - ux * ux;
  let vy = s.w - uy * uy;
  let vxy = exy - ux * uy;
  let c1 = u_c.x;
  let c2 = u_c.y;
  let a1 = 2.0 * ux * uy + c1;
  let a2 = 2.0 * vxy + c2;
  let b1 = ux * ux + uy * uy + c1;
  let b2 = vx + vy + c2;
  let ssim = (a1 * a2) / (b1 * b2);
  let err = 1.0 - ssim;
  return vec4<f32>(err, err, err, 1.0);
}
`;function dt(e,t){return{binding:e,resource:{uniform:new Float32Array(t)}}}function Ur(e){const t=e.sourceMap,r=t?t.offsetA:{x:0,y:0},n=t?t.offsetB:{x:0,y:0},a=t!=null&&t.fill?1:0;return[dt(2,[r.x,r.y,n.x,n.y]),dt(3,[e.width,e.height,a,0])]}function Fr(e,t){const r=`${t}H`,n=`${t}V`;return{passes:[{name:r,shader:Or,inputs:[e],output:r,uniforms:()=>[dt(1,[1,0,Le,ir])]},{name:n,shader:Or,inputs:[r],output:n,uniforms:()=>[dt(1,[0,1,Le,ir])]}],out:n}}const Ts={kind:"multipass",id:"ssim",label:"SSIM (1−SSIM)",publicName:"ssim",displayRange:"unit",output:"scalar",buildPasses(e){const t=(kn*Ut)**2,r=(Gn*Ut)**2,n=Fr("momA","statsA"),a=Fr("momB","statsB");return{passes:[{name:"momA",shader:Ss,inputs:["srcA","srcB"],output:"momA",uniforms:Ur},{name:"momB",shader:_s,inputs:["srcA","srcB"],output:"momB",uniforms:Ur},...n.passes,...a.passes,{name:"ssim",shader:As,inputs:[n.out,a.out],output:"ssim",uniforms:()=>[dt(2,[t,r,0,0])]}],final:"ssim"}}};let Ir=!1;function Ms(){Ir||(Ir=!0,Re(ns),Re(rs),Re(as),Re(is),Re(ss),Re(os),Re(xs),Re(ys),Re(bs),Re(Ts))}Ms();function Fn(){const e=[];for(const r of ts())r.kind==="pointwise"&&e.push({id:r.id,label:r.label});e.push({id:"flip",label:"FLIP (perceptual)"}),e.push({id:"flip_ldr",label:"FLIP (LDR forced)"});const t=ke("ssim");return t&&e.push({id:t.id,label:t.label}),e}function Ps(e,t){return e==="flip"?t?"hdr-flip":"flip":e==="flip_ldr"||e==="flip-ldr-forced"?t?"flip-ldr-forced":"flip":e}const Ds=128,Bs=512*1024*1024;class Ls{constructor(t=Ds,r=Bs){O(this,"map",new Map);O(this,"totalBytes",0);O(this,"maxEntries");O(this,"maxBytes");this.maxEntries=t,this.maxBytes=r}get(t){const r=this.map.get(t);return r&&(this.map.delete(t),this.map.set(t,r)),r}set(t,r){const n=this.map.get(t);n&&(this.totalBytes-=n.bytes,n.texture.destroy(),this.map.delete(t)),this.map.set(t,r),this.totalBytes+=r.bytes,this.evict()}accountReadbackBytes(t,r){let n=!1;for(const a of this.map.values())if(a===t){n=!0;break}n&&(t.bytes+=r,this.totalBytes+=r,this.evict())}evict(){for(;this.map.size>this.maxEntries||this.totalBytes>this.maxBytes;){const t=this.map.keys().next().value;if(t===void 0)break;const r=this.map.get(t);if(this.map.size===1)break;this.map.delete(t),this.totalBytes-=r.bytes,r.texture.destroy()}}clear(){for(const t of this.map.values())t.texture.destroy();this.map.clear(),this.totalBytes=0}get size(){return this.map.size}}const Nr=new WeakMap;function lr(e){let t=Nr.get(e);return t||(t=new Ls,Nr.set(e,t)),t}function Cs(e,t,r){const n=t*r;if(n<=0)return NaN;let a=0;for(let s=0;s<n;s++)a+=e[s*4]??0;return 1-a/n}function zr(e){return e==null||Number.isNaN(e)?"—":e.toFixed(4)}const Vr=new WeakMap;function ks(e,t,r){let n=Vr.get(e);n||(n=new Map,Vr.set(e,n));const a=n.get(t);if(a)return a;const s=r().catch(i=>{throw n.get(t)===s&&n.delete(t),i});return n.set(t,s),s}const $r=new WeakMap;function cr(e,t,r,n){let a=$r.get(e);a||(a=new Map,$r.set(e,a));const s=`${t}::${n}`;let i=a.get(s);return i||(i=e.createRenderPipeline({shaderWGSL:r,targetFormat:n}),a.set(s,i)),i}function Gs(e){return`
${be}
${$e}
${pt}
@group(0) @binding(0) var texA: texture_2d<f32>;
@group(0) @binding(3) var texB: texture_2d<f32>;
@group(0) @binding(8) var<uniform> u_map: vec4<f32>;  // offAx, offAy, offBx, offBy
@group(0) @binding(11) var<uniform> u_res: vec4<f32>; // resultW, resultH, fitFill, 0
${e}
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // px is the RESULT/overlap-grid pixel. Each source is sampled through the
  // align/fit mapping (integer texel offset per source under crop; normalized-uv
  // bilinear rescale under fill) -- see SOURCE_MAP_WGSL / compare-align.ts.
  let px = vec2<i32>(in.position.xy);
  let a = mapSample(texA, px, u_map.x, u_map.y, u_res.x, u_res.y, u_res.z);
  let b = mapSample(texB, px, u_map.z, u_map.w, u_res.x, u_res.y, u_res.z);
  return kernel(a, b);
}
`}const Tt="rgba16float";let In=0;function Os(){return In}function Us(e,t,r,n,a,s){var E,L;const i=ke(n);if(!i)throw new Error(`computeDiff: unknown diff kernel "${n}"`);const o=s??mt({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),c=o.result.w,l=o.result.h,f=o.fit==="fill"?1:0,p=An(i,a);if(In++,i.kind==="pointwise"){const h=e.createTexture(c,l,Tt),u=cr(e,`pw:${i.id}`,Gs(i.source),Tt),x=new Float32Array([o.offsetA.x,o.offsetA.y,o.offsetB.x,o.offsetB.y]),y=new Float32Array([c,l,f,0]);let w;try{w=e.createBindGroup(u,[{binding:0,resource:t},{binding:1,resource:r},{binding:2,resource:{uniform:x}},{binding:3,resource:{uniform:y}}]),e.renderFullscreen(h,u,w)}finally{(E=w==null?void 0:w.destroy)==null||E.call(w)}return h}const m={width:c,height:l,params:p,sourceMap:{fill:o.fit==="fill",offsetA:o.offsetA,offsetB:o.offsetB}},b=i.buildPasses(m),v=new Map([["srcA",t],["srcB",r]]),_=[];try{for(const u of b.passes){const x=e.createTexture(c,l,Tt);_.push(x),v.set(u.output,x);const y=cr(e,`mp:${i.id}:${u.name}`,u.shader,Tt),w=u.inputs.map((C,U)=>{const D=v.get(C);if(!D)throw new Error(`computeDiff: pass "${u.name}" input "${C}" not produced yet`);return{binding:U,resource:D}});u.uniforms&&w.push(...u.uniforms(m));let R;try{R=e.createBindGroup(y,w),e.renderFullscreen(x,y,R)}finally{(L=R==null?void 0:R.destroy)==null||L.call(R)}}const h=v.get(b.final);if(!h)throw new Error(`computeDiff: final ref "${b.final}" not produced`);for(const u of _)u!==h&&u.destroy();return h}catch(h){for(const u of _)u.destroy();throw h}}function Fs(e,t){const r=An(e,t);return Object.keys(r).sort().map(a=>`${a}=${r[a]}`).join(",")}function Is(e,t,r,n,a){const s=ke(r),i=s?Fs(s,n):"",o=a?ur(a):"";return`${e}|${t}|${r}|${i}|${o}`}function Nn(e,t,r,n,a,s,i,o){const c=ke(n);if(!c)throw new Error(`ensureDiff: unknown diff kernel "${n}"`);const l=lr(e),f=o??mt({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),p=Is(s,i,n,a,f),m=l.get(p);if(m)return m;const b=Us(e,t,r,n,a,f),v=f.result.w,_=f.result.h,E={texture:b,width:v,height:_,displayRange:c.displayRange,bytes:v*_*8};return l.set(p,E),E}function Ns(e,t,r){return`${e}|${t}|${r?ur(r):""}`}function zs(e,t,r,n,a,s){return ks(e,Ns(n,a,s),()=>Vs(e,t,r,n,a,s))}async function Vs(e,t,r,n,a,s){try{const i=Nn(e,t,r,"ssim",void 0,n,a,s);return i.ssimMean!==void 0?i.ssimMean:(i.ssimMeanPending||(i.ssimMeanPending=zn(e,i).then(o=>{const c=Cs(o,i.width,i.height);return i.ssimMean=c,c})),await i.ssimMeanPending)}catch{return $s(e,t,r,s)}}async function $s(e,t,r,n){const a=n??mt({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),s=a.result.w,i=a.result.h,o=s*i;if(o<=0)return NaN;const c=await e.readback(t),l=await e.readback(r),f=c instanceof Uint8Array?255:1,p=l instanceof Uint8Array?255:1,m=a.fit==="fill",b=Dt(c,t.width,t.height,f,a.offsetA,m,s,i),v=Dt(l,r.width,r.height,p,a.offsetB,m,s,i),_=new Float64Array(o),E=new Float64Array(o),L=[0,0,0],h=[0,0,0];for(let u=0;u<i;u++){for(let x=0;x<s;x++){b(x,u,L),v(x,u,h);const y=u*s+x;_[y]=kr(L[0],L[1],L[2]),E[y]=kr(h[0],h[1],h[2])}(u+1)%or===0&&await On()}return Es(_,E,s,i)}async function Hs(e,t,r,n,a){return t.scalars?t.scalars:(t.scalarsPending||(t.scalarsPending=xn(e,r,n,a).then(s=>(t.scalars=s,s))),t.scalarsPending)}async function zn(e,t){return t.resultSamples?t.resultSamples:(t.resultSamplesPending||(t.resultSamplesPending=e.readback(t.texture).then(r=>{const n=r instanceof Float32Array?r:Float32Array.from(r);return t.resultSamples=n,lr(e).accountReadbackBytes(t,n.byteLength),n})),t.resultSamplesPending)}function Ws(e){return lr(e).size}const Ks=`
${be}
${$e}
@group(0) @binding(0) var resultTex: texture_2d<f32>;
@group(0) @binding(3) var lut: texture_2d<f32>;
@group(0) @binding(8) var<uniform> u_uv: vec4<f32>;   // uvRect.xy, uvRect.wh
@group(0) @binding(11) var<uniform> u_disp: vec4<f32>; // displayRangeId, cmapModeId, useColormap, filterMode
@group(0) @binding(14) var<uniform> u_expo: vec4<f32>; // exposureEV, offset, 0, 0
@group(0) @binding(17) var<uniform> u_src: vec4<f32>;  // primaryW, primaryH, 0, 0 (source footprint)

@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let uv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(0.999999));
  let uvRect = u_uv;
  let rawSrcUV = uvRect.xy + uv * uvRect.zw;
  if (rawSrcUV.x < 0.0 || rawSrcUV.x >= 1.0 || rawSrcUV.y < 0.0 || rawSrcUV.y >= 1.0) {
    return vec4<f32>(0.0);
  }
  let srcUV = clamp(rawSrcUV, vec2<f32>(0.0), vec2<f32>(0.999999));
  let dims = vec2<f32>(textureDimensions(resultTex));
  // The diff RESULT is min-cropped to min(A,B), TOP-LEFT aligned. The pane's
  // uv-rect and this fragment's srcUV live in the PRIMARY source's normalized
  // space (u_src.xy = the primary/foreground dims that drive the overlay grid
  // and viewport). Map srcUV to a PRIMARY pixel and show the result 1:1 in the
  // crop's top-left; a fragment beyond the crop (primary pixel >= result dims)
  // has NO diff value, so it is transparent -- matching sampleDiff, which
  // returns null there (never a fake zero). For an EQUAL-size pair primaryDims
  // == dims, so this collapses to the identity mapping (unchanged behavior).
  let primaryDims = select(dims, u_src.xy, u_src.x > 0.5);
  let primaryPixel = srcUV * primaryDims;
  if (primaryPixel.x >= dims.x || primaryPixel.y >= dims.y) {
    return vec4<f32>(0.0);
  }
  let filterLinear = u_disp.w > 0.5;
  var raw: vec4<f32>;
  if (filterLinear) {
    raw = sampleBilinearOf(resultTex, primaryPixel / dims, dims);
  } else {
    raw = textureLoad(resultTex, vec2<i32>(primaryPixel), 0);
  }
  let displayRangeId = i32(round(u_disp.x));
  // Exposure/offset adjust the RAW metric value BEFORE the cmap-mode index
  // mapping and LUT — i.e. they change the colormap SENSITIVITY (value * 2^EV +
  // offset), not the final RGB. Display-only: the cached diff RESULT is never
  // touched, so this never triggers a recompute.
  var v = raw.rgb * exp2(u_expo.x) + vec3<f32>(u_expo.y);
  if (displayRangeId == 1 || displayRangeId == 2) {
    v = (v + vec3<f32>(1.0)) * 0.5; // signed / relative -> [0,1] about 0.5
  }
  let disp = clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
  let cmapModeId = i32(round(u_disp.y));
  let useColormap = u_disp.z > 0.5;
  var outColor: vec3<f32>;
  if (useColormap) {
    let avg = (disp.r + disp.g + disp.b) / 3.0;
    var idx = avg;
    if (cmapModeId == 2) { idx = 0.5 + avg * 0.5; } // "positive"
    // Mirror the source filter: when the diff RESULT is sampled bilinearly
    // (moderate zoom), interpolate the LUT too — otherwise the smooth diff
    // magnitude snaps to one of 256 discrete colormap bins, banding the
    // false-color image into blocky per-texel cells (the colormap-interp bug).
    // At the pixelated zoom the nearest fetch keeps crisp per-texel color.
    if (filterLinear) { outColor = sampleLUTLinear(lut, idx); }
    else { outColor = sampleLUT(lut, idx); }
  } else {
    outColor = disp;
  }
  return vec4<f32>(outColor, 1.0);
}
`,qs={unit:0,signed:1,relative:2},Xs={linear:0,signed:1,positive:2};function Ys(e,t){if(t){if(t.length!==256*4)throw new Error(`renderDiffDisplay: colormap must be 256*4 floats, got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function js(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Zs(e,t,r,n,a){var b,v,_;const s=js(t),i=cr(e,"diff-display",Ks,s),o=Ys(e,a.colormap),c=new Float32Array([a.uv.x,a.uv.y,a.uv.w,a.uv.h]),l=new Float32Array([qs[n],Xs[a.cmapMode??"positive"],a.colormap?1:0,a.filter==="nearest"?0:1]),f=new Float32Array([a.exposureEV??0,a.offset??0,0,0]),p=new Float32Array([((b=a.sourceDims)==null?void 0:b.w)??0,((v=a.sourceDims)==null?void 0:v.h)??0,0,0]);let m;try{m=e.createBindGroup(i,[{binding:0,resource:r},{binding:1,resource:o},{binding:2,resource:{uniform:c}},{binding:3,resource:{uniform:l}},{binding:4,resource:{uniform:f}},{binding:5,resource:{uniform:p}}]),e.renderFullscreen(t,i,m)}finally{(_=m==null?void 0:m.destroy)==null||_.call(m),o.destroy()}}const Hr=.6*.6*2.51,Qs=.6*.03,Js=0,Wr=.6*.6*2.43,ei=.6*.59,ti=.14;function Kr(e){const t=(Qs-ei*e)/(Hr-Wr*e),r=(Js-ti*e)/(Hr-Wr*e);return-.5*t+Math.sqrt((.5*t)**2-r)}const ri=.85,ni=.85,qr=11920928955078125e-23,tr=[.2126,.7152,.0722];function ai(e,t,r){const n=t*r;if(r===1){const a=e[n];return[a,a,a]}return[e[n],e[n+1],e[n+2]]}function si(e,t,r,n=3,a={}){const s=t*r,i=Kr(ri),o=Kr(ni),c=new Float64Array(s);let l=0;for(let h=0;h<s;h++){const[u,x,y]=ai(e,h,n),w=u*tr[0]+x*tr[1]+y*tr[2];c[h]=w,w>l&&(l=w)}const f=Float64Array.from(c).sort(),p=s>>1,m=s%2===1?f[p]:f[p-1],b=Math.max(m,qr),v=Math.max(l,qr),_=a.startExposure??Math.log2(i/v),E=a.stopExposure??Math.log2(o/b),L=Math.max(2,Math.ceil(E-_));return{startExposure:_,stopExposure:E,numExposures:L}}function ii(e){const t=pa(e),r=new Float32Array(256*4);for(let n=0;n<256;n++)r[n*4+0]=t[n*3+0]/255,r[n*4+1]=t[n*3+1]/255,r[n*4+2]=t[n*3+2]/255,r[n*4+3]=1;return r}function oi(e){const{width:t,height:r,channels:n}=e,a=t*r;if(e.precision==="f16-bits"){const c=e.data,l=new Uint16Array(a*4);for(let f=0;f<a;f++){const p=f*n,m=f*4;if(n===1){const b=c[p];l[m]=b,l[m+1]=b,l[m+2]=b,l[m+3]=Mt}else l[m]=c[p],l[m+1]=c[p+1],l[m+2]=c[p+2],l[m+3]=n>=4?c[p+3]:Mt}return{data:l,format:"rgba16float"}}const s=e.data,i=new Float32Array(a*4),o=c=>Number.isFinite(c)?c:0;for(let c=0;c<a;c++){const l=c*n;let f,p,m,b=1;n===1?f=p=m=o(s[l]):n===3?(f=o(s[l]),p=o(s[l+1]),m=o(s[l+2])):(f=o(s[l]),p=o(s[l+1]),m=o(s[l+2]),b=o(s[l+3]));const v=c*4;i[v]=f,i[v+1]=p,i[v+2]=m,i[v+3]=b}return{data:i,format:"rgba32float"}}function ci({imageUrl:e,baselineUrl:t,imageFloat:r,baselineFloat:n,mode:a,splitPosition:s,blendAlpha:i,onSplitPositionChange:o,diffSubmode:c,colormap:l="none",align:f="top-left",fit:p="crop",diffKernel:m,onDiffKernelChange:b,onCompareModeChange:v,onRequestSide:_,zoom:E,pan:L,onViewportChange:h,interpolation:u="auto",label:x="",pixelValueNotation:y="decimal",tonemap:w,peak:R,gamma:C,toolbar:U=!0}){var hr;const D=d.useRef(null),B=d.useRef(null),Y=d.useRef(null),F=d.useRef(null),X=d.useRef(null),[ee,de]=d.useState(!1),[J,Z]=d.useState(!1),H=d.useRef(!1),[te,re]=d.useState(!1),[ne,ve]=d.useState(null),[se,_e]=d.useState(null),[He,Oe]=d.useState({a:!1,b:!1}),[We,zt]=d.useState(0),[Ke,gt]=d.useState(0),[Ae,at]=d.useState(null),[Ue,pe]=d.useState(null),[Fe,st]=d.useState({x:0,y:0,w:1,h:1}),ht=m??c??"absolute",[ie,qe,ye]=Ce(ht);d.useEffect(()=>{qe(m??c??"absolute")},[m,c,qe]);const Me=d.useCallback(g=>{qe(g),b==null||b(g)},[b,qe]);d.useEffect(()=>{const g=D.current;if(g)return g.__cairnDiffKernel={current:ie,set:Me},()=>{g&&delete g.__cairnDiffKernel}},[ie,Me]);const[K,Ie,Xe]=Ce(a);d.useEffect(()=>{Ie(a)},[a,Ie]);const me=d.useCallback(g=>{Ie(g),v==null||v(g)},[v,Ie]),[ue,Ne,Ye]=Ce(l);d.useEffect(()=>{Ne(l)},[l,Ne]);const[je,Ze]=d.useState(null);d.useEffect(()=>{Ze(null)},[w]);const xt=ln(w),ge=je??xt,Qe=je!==null&&je!==xt,bt=()=>R!=null&&R>0?R:fn(w)??Ft,[it,vt,Je]=Ce(bt()),[et,tt,A]=Ce(C&&C>0?C:Xr);d.useEffect(()=>{vt(bt())},[R,w]),d.useEffect(()=>{C&&C>0&&tt(C)},[C,tt]);const k=d.useCallback(()=>{me(Xe.default),Ne(Ye.default),Me(ye.default),Ze(null),Je.reset(),A.reset()},[me,Ne,Me,Xe.default,Ye.default,ye.default,Je,A]),z=Xe.isModified||Ye.isModified||ye.isModified||Qe||Je.isModified||A.isModified,[T,$]=d.useState(0),[I,oe]=d.useState(0),ce=d.useMemo(()=>{const P=[ma({mode:K,kernel:ie,kernelOptions:Fn().map(S=>({id:S.id,label:S.label})),onSide:_,onSlide:()=>me("split"),onBlend:()=>me("blend"),onKernel:S=>{me("diff"),Me(S)}})];return K==="diff"?P.push(nr(ue,S=>Ne(S))):P.push(rr(ge,S=>Ze(S))),P},[K,ie,ue,ge,Me,me,_]),fe=d.useRef(null),W=d.useRef(null),we=d.useRef(null),ze=d.useRef(null),[Pe,ot]=d.useState(0),Ee=d.useRef(null),Ve=d.useRef(null),[ct,fr]=d.useState(0),Vt=Yr();d.useEffect(()=>{const g=Y.current;if(!g)return;let P=!1;return It().then(S=>{var M;if(!P)try{if(bn())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const G=((M=S.probeExtendedToneMapping)==null?void 0:M.call(S))??!1,N=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,q=G&&N;H.current=q,re(q);const j=S.createSurface(g,{hdr:q});F.current={device:S,surface:j,texA:null,texB:null},Z(!0)}catch(G){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",G),de(!0)}}).catch(S=>{P||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",S),de(!0))}),()=>{var M,G;P=!0;const S=F.current;S&&((M=S.texA)==null||M.destroy(),(G=S.texB)==null||G.destroy(),F.current=null)}},[]),d.useEffect(()=>{const g=D.current;if(!g)return;const P=new ResizeObserver(()=>gt(S=>S+1));return P.observe(g),()=>P.disconnect()},[]),d.useEffect(()=>{if(!J)return;let g=!1;if(!F.current)return;async function S(M,G){if(G){const q=oi(G);return{width:G.width,height:G.height,imageData:null,make:j=>{const V=j.createTexture(G.width,G.height,q.format);return V.write(q.data),V}}}if(!M)return null;const N=await jr(M);return N?{width:N.width,height:N.height,imageData:N,make:q=>{const j=q.createTexture(N.width,N.height,"rgba8unorm");return j.write(N.data),j}}:null}return Promise.all([S(e,r),S(t,n)]).then(([M,G])=>{var ae,xe;if(g||!F.current)return;const N=F.current;fe.current=(M==null?void 0:M.imageData)??null,W.current=(G==null?void 0:G.imageData)??null,we.current=r??null,ze.current=n??null,(ae=N.texA)==null||ae.destroy(),(xe=N.texB)==null||xe.destroy(),N.texA=null,N.texB=null;const q=M??G;if(!q){ve(null),_e(null),ot(De=>De+1);return}const j=G??q,V=M??q;N.texA=j.make(N.device),N.texB=V.make(N.device),_e({a:{w:j.width,h:j.height},b:{w:V.width,h:V.height}}),Oe({a:j.imageData!=null,b:V.imageData!=null}),ve({w:q.width,h:q.height}),ot(De=>De+1),zt(De=>De+1)}),()=>{g=!0}},[J,e,t,r,n]);const yt=r!=null||n!=null,he=d.useMemo(()=>Ps(ie,yt),[ie,yt]),ut=d.useMemo(()=>{if(!yt)return null;const g=n??r;if(!g)return null;const P=g.precision==="f16-bits"?sa(g.data):g.data;return si(P,g.width,g.height,g.channels)},[yt,n,r]),dr=d.useMemo(()=>{var g;return ia(((g=ke(he))==null?void 0:g.displayRange)??"unit",ue==="none"?null:ue)},[he,ue]),pr=d.useMemo(()=>ue!=="none"?ii(ue):void 0,[ue]),Te=d.useMemo(()=>se?mt(se.a,se.b,f,p,"b"):null,[se,f,p]),Vn=d.useMemo(()=>Te?ur(Te):"none",[Te]),wt=(n==null?void 0:n.contentKey)??t??(r==null?void 0:r.contentKey)??e??"none",Et=(r==null?void 0:r.contentKey)??e??(n==null?void 0:n.contentKey)??t??"none",le=ne,$t=d.useCallback(()=>{const g=F.current;if(!J||!g||!g.surface||!g.texA||!g.texB||!ne)return;const P=le??ne,S=D.current,M=S?S.getBoundingClientRect():{width:P.w,height:P.h},G=Sn({zoom:E,pan:L},M,P.w,P.h);st(V=>V.x===G.x&&V.y===G.y&&V.w===G.w&&V.h===G.h?V:G);const N=Y.current;if(M.width>0&&M.height>0&&N&&g.surface){const V=Math.max(1,Math.round(M.width*Vt)),ae=Math.max(1,Math.round(M.height*Vt));(N.width!==V||N.height!==ae)&&(N.width=V,N.height=ae,g.surface.configure(V,ae))}const q=_n(G,M,P.w,P.h)>=Zr?"nearest":"linear",j=G;try{if(K==="diff"){const V=ke(he)?he:"absolute",ae=V==="hdr-flip"&&ut?{ppd:67,startExposure:ut.startExposure,stopExposure:ut.stopExposure,numExposures:ut.numExposures}:void 0,xe=Nn(g.device,g.texA,g.texB,V,ae,wt,Et,Te??void 0);X.current=xe,Zs(g.device,g.surface,xe.texture,xe.displayRange,{uv:j,cmapMode:dr,colormap:pr,filter:q,sourceDims:P,exposureEV:T,offset:I})}else{const V=Qr(ge,H.current?it:1,H.current,et),ae={exposureEV:T,offset:I,operator:V.operator,gamma:V.gamma,isScalar:!1,hdrOut:V.hdrOut,peak:V.peak,srgbDecodeA:He.a,srgbDecodeB:He.b,uv:j,filter:q,mode:K,split:s,alpha:i};Ia(g.device,g.surface,g.texA,g.texB,ae)}}catch(V){console.warn("cairn-plot: GpuComparePane render failed, falling back to legacy pane",V),de(!0)}},[J,ne,le,Te,E,L.x,L.y,K,s,i,T,I,ge,it,et,He,ie,he,ut,dr,pr,e,t,r,n,wt,Et,Vt]);d.useEffect(()=>{$t()},[$t,We,Ke]);const rt=t!=null||n!=null;d.useEffect(()=>{const g=F.current;if(!J||!g||!g.texA||!g.texB||!rt){at(null);return}let P=!1;const S=g.texA,M=g.texB,G=X.current,N=K==="diff"?Te??void 0:void 0;return(K==="diff"&&G?Hs(g.device,G,S,M,N):xn(g.device,S,M,N)).then(j=>{P||at(j)}),()=>{P=!0}},[J,We,rt,K,ie,Te]),d.useEffect(()=>{const g=F.current;if(!J||!g||!g.texA||!g.texB||!rt){pe(null);return}let P=!1;pe(null);const S=K==="diff"?Te??void 0:void 0;return zs(g.device,g.texA,g.texB,wt,Et,S).then(M=>{P||pe(M)}).catch(()=>{P||pe(null)}),()=>{P=!0}},[J,We,rt,K,Vn,wt,Et]),d.useEffect(()=>{if(K!=="diff"){Ee.current=null,Ve.current=null;return}const g=F.current,P=X.current;if(!J||!g||!P)return;let S=!1;return Ee.current=null,Ve.current=null,fr(M=>M+1),zn(g.device,P).then(M=>{S||(Ee.current=M,Ve.current={w:P.width,h:P.height},fr(G=>G+1))}).catch(()=>{}),()=>{S=!0}},[J,K,he,We,Te]);const mr=(g,P)=>(S,M,G)=>{const N=P.current;if(N){const{data:De,width:xr,height:Kn,channels:br}=N;if(S<0||M<0||S>=xr||M>=Kn)return null;const St=(M*xr+S)*br,_t=N.precision==="f16-bits"?Kt=>Jr(De[Kt]??0):Kt=>De[Kt]??0,qn=br===1?[_t(St)]:[_t(St),_t(St+1),_t(St+2)];return ft(qn,"unit",G)}const q=g.current;if(!q||S<0||M<0||S>=q.width||M>=q.height)return null;const j=(M*q.width+S)*4,V=q.data[j],ae=q.data[j+1],xe=q.data[j+2];return ft(V===ae&&ae===xe?[V]:[V,ae,xe],"uint8",G)},Rt=d.useMemo(()=>mr(fe,we),[]),Ht=d.useMemo(()=>mr(W,ze),[]),Wt=d.useMemo(()=>(g,P,S)=>{var xe;const M=Ee.current,G=Ve.current;if(!M||!G)return null;const{w:N,h:q}=G;if(g<0||P<0||g>=N||P>=q)return null;const j=(P*N+g)*4,ae=(((xe=ke(he))==null?void 0:xe.output)??"per-channel")==="scalar"?[M[j]??0]:[M[j]??0,M[j+1]??0,M[j+2]??0];return ft(ae,"unit",S)},[he]);d.useEffect(()=>{const g=D.current;if(g)return g.__cairnCompareProbe={sampleDiff:(P,S,M="decimal")=>Wt(P,S,M),sampleFg:(P,S,M="decimal")=>Rt(P,S,M),sampleRef:(P,S,M="decimal")=>Ht(P,S,M),get diffSamples(){return Ee.current},get dims(){return le},get primaryDims(){return ne},get diffResultDims(){return Ve.current},get align(){return f},get fit(){return p},get resolvedKernelId(){return he},get compareMode(){return K},computeCount:()=>Os(),cacheSize:()=>F.current?Ws(F.current.device):0,get ssimScalar(){return Ue},get ssimText(){return zr(Ue)},get effectiveTonemap(){return ge},get hdrEngaged(){return te}},()=>{g&&delete g.__cairnCompareProbe}},[Wt,Rt,Ht,ne,le,f,p,he,K,Ue,ge,te]);const $n=u==="auto"?void 0:u;if(ee)return r!=null||n!=null?Q.jsx(oa,{}):K==="diff"?Q.jsx(en,{toolbar:U,source:ca(e),baselineUrl:t,diffMode:((hr=ke(he))==null?void 0:hr.kind)==="pointwise"?he:"absolute",interpolation:u,colormap:ue,showAxes:!1,zoom:E,pan:L,onViewportChange:h,label:x,pixelValueNotation:y}):Q.jsx(ua,{imageUrl:e,baselineUrl:t,mode:K,splitPosition:s,blendAlpha:i,onSplitPositionChange:o,zoom:E,pan:L,onViewportChange:h,interpolation:u,label:x,pixelValueNotation:y});const Hn=Q.jsxs(Q.Fragment,{children:[Q.jsx("canvas",{ref:Y,className:"w-full h-full block",style:{imageRendering:$n},"data-gpu-compare-canvas":!0}),K==="split"&&Q.jsx(da,{splitPosition:s,onChange:o,onReset:()=>o==null?void 0:o(.5)})]}),gr=!!x,Wn=gr?"bottom-7":"bottom-1";return Q.jsx(tn,{paneAttrs:{"data-gpu-compare-pane":"","data-gpu-compare-ready":J},viewportAttrs:{"data-gpu-compare-viewport":""},toolbar:U,paneRef:D,wrapperRef:B,zoom:E,pan:L,onViewportChange:h,naturalDims:le,checkerboard:"pane",wrapperClassName:"relative w-full h-full flex items-center justify-center",viewportPadding:0,surface:Hn,showAxes:!1,notationSeed:y,onReset:k,extraModified:z,exportCanvasRef:Y,requestRender:$t,leadingMenus:ce,displayAdjust:{exposureEV:T,offset:I,onExposureChange:$,onOffsetChange:oe},extraSliders:[...te&&K!=="diff"?[{id:"peak",label:"PK",title:"Peak white (×SDR white) — the HDR ceiling P every operator clips at (Linear/sRGB/Gamma hard-clip at P; Reinhard/ACES roll off toward P). P=1 reproduces the SDR rendition exactly; double-click to type a value, including 'inf' for the raw browser-clipped extended look.",min:an,max:nn,step:rn,value:it,onChange:vt,format:g=>Number.isFinite(g)?`${g.toFixed(1)}×`:"∞"}]:[],...K!=="diff"&&un(ge)?[{id:"gamma",label:"γ",title:"Display gamma γ for the Gamma transfer — display = clamp(value)^(1/γ), tev-style. Default 2.2 (close to sRGB, not identical). Double-click to type a value.",min:cn,max:on,step:sn,value:et,onChange:tt,format:g=>g.toFixed(1)}]:[]],label:"",showLabelChip:!1,overlay:{render:({notation:g,setOverlayActive:P})=>K==="split"?Q.jsxs(Q.Fragment,{children:[rt&&le&&Q.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-s)*100}% 0 0)`},children:Q.jsx(qt,{imageElRef:Y,naturalWidth:le.w,naturalHeight:le.h,zoom:E,pan:L,sourceWindow:Fe,sample:Ht,notation:g,version:Pe})}),rt&&le&&Q.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${s*100}%)`},children:Q.jsx(qt,{imageElRef:Y,naturalWidth:le.w,naturalHeight:le.h,zoom:E,pan:L,sourceWindow:Fe,sample:Rt,notation:g,version:Pe,onActiveChange:P})})]}):le&&Q.jsx(qt,{imageElRef:Y,naturalWidth:le.w,naturalHeight:le.h,zoom:E,pan:L,sourceWindow:Fe,sample:K==="diff"?Wt:Rt,notation:g,version:K==="diff"?ct:Pe,onActiveChange:P})},extraChips:Q.jsxs(Q.Fragment,{children:[K==="split"&&Q.jsx(la,{}),gr?Q.jsx(fa,{label:x,corner:"bottom-right"}):null,Ae&&Q.jsxs("span",{className:`absolute right-1 z-30 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${Wn}`,"data-gpu-compare-metrics":!0,children:["MSE ",Ae.mse.toExponential(2)," · PSNR ",Number.isFinite(Ae.psnr)?Ae.psnr.toFixed(1):"∞"," dB · MAE"," ",Ae.mae.toExponential(2)," · SSIM ",zr(Ue)]})]})})}const ui="cairn-plot:gpu-image-ready";async function li(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await It(),window.__cairnPlotGpuImagePane=es,window.__cairnPlotGpuComparePane=ci,window.__cairnPlotDiffMenuModes=Fn(),window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(ui))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e),Rn("no-webgpu")}}}li();

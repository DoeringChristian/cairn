var Xn=Object.defineProperty;var Yn=(e,t,r)=>t in e?Xn(e,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):e[t]=r;var F=(e,t,r)=>Yn(e,typeof t!="symbol"?t+"":t,r);import{X as Lt,Y as jn,r as d,Z as Zn,$ as Le,a0 as Xr,a1 as Yr,a2 as jr,a3 as Qn,a4 as Jn,a5 as ea,a6 as ta,a7 as Zr,a8 as Qr,a9 as Jr,aa as ft,j as Q,U as tr,ab as ra,ac as en,ad as tn,ae as rn,af as nn,ag as an,ah as sn,ai as on,aj as cn,ak as rr,al as nr,am as un,an as ln,ao as na,ap as At,aq as Ge,M as aa,ar as sa,as as ia,at as oa,au as ca,av as ua,aw as Kt,ax as la,d as fa}from"./parse-overlay-krmoXN04.js";import{b as da}from"./compare-mode-menu-DG9F3B3b.js";const ar=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function fn(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"premultiplied",usage:ar}),{hdr:!1,format:r}}function pa(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:ar}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:ar}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return fn(e,t)}}}const ma=`
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
`,ga=`
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
`;class ha extends Error{constructor(r){super(r);F(this,"deviceLost",!0);this.name="DeviceLostError"}}async function vr(e,t){try{await e.mapAsync(GPUMapMode.READ)}catch(r){if((r instanceof Error?r.name:"")==="AbortError"){const a=t.info;throw new ha("webgpu readback: buffer map aborted — device lost or destroyed mid-readback"+(a?` (reason=${String(a.reason)}${a.message?`: ${a.message}`:""})`:"")+`: ${r instanceof Error?r.message:String(r)}`)}throw r instanceof Error?r:new Error(String(r))}}function sr(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function dn(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function xa(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let a;return r===0?a=n/1024*Math.pow(2,-14):r===31?a=n?NaN:1/0:a=(1+n/1024)*Math.pow(2,r-15),t?-a:a}const ba={texture:0,sampler:1,uniform:2};function qt(e,t){return e*3+ba[t]}const va={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function ya(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const a=Number(n[1]),s=n[2]!==void 0,i=n[3].trim();if(s){const o=va[i];if(o===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${i}" (binding ${a}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(a,{kind:"uniform",sizeBytes:o})}else i==="sampler"||i==="sampler_comparison"?t.set(a,{kind:"sampler"}):t.set(a,{kind:"texture"})}return t}class yr{constructor(t,r,n,a){F(this,"width");F(this,"height");F(this,"format");F(this,"gpuTexture");F(this,"device");F(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=a,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:sr(a),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*dn(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class wr{constructor(t){F(this,"_s");F(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class wa{constructor(t,r,n,a,s){F(this,"_p");F(this,"gpuPipeline");F(this,"bindings");F(this,"bindGroupLayout");F(this,"variants");F(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=s,this.variants=new Map([[a,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function Ea(e,t){const r=[];for(const[n,a]of t)a.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):a.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class Ra{constructor(t){F(this,"_c");F(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class Sa{constructor(t,r,n,a,s){F(this,"width");F(this,"height");F(this,"paramsBuffer");F(this,"bindGroup");F(this,"buffers");F(this,"destroyed",!1);this.width=t,this.height=r,this.buffers=n,this.paramsBuffer=a,this.bindGroup=s}destroy(){if(!this.destroyed){for(const t of this.buffers)t.destroy();this.paramsBuffer.destroy(),this.destroyed=!0}}}class _a{constructor(t,r){F(this,"_b");F(this,"gpuBindGroup");F(this,"ownedBuffers");F(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class Aa{constructor(t,r,n,a){F(this,"canvas");F(this,"hdr");F(this,"format");F(this,"context");F(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=a}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function St(e){return"canvas"in e}async function Ma(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function a(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function s(l){return St(l)?l.getCurrentTextureView():l.gpuTexture.createView()}function i(l){if(St(l))return{width:l.canvas.width,height:l.canvas.height};const h=l;return{width:h.width,height:h.height}}let o=!1;const u={};t.lost.then(l=>{u.info=l},()=>{});let c=null;function f(){var h,w;if(c!==null)return c;let l=!1;try{if(typeof document<"u"){const y=document.createElement("canvas");y.width=1,y.height=1;const S=y.getContext("webgpu");if(S)try{S.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:GPUTextureUsage.RENDER_ATTACHMENT});const G=(h=S.getConfiguration)==null?void 0:h.call(S);l=((w=G==null?void 0:G.toneMapping)==null?void 0:w.mode)==="extended"}catch{l=!1}finally{try{S.unconfigure()}catch{}}}}catch{l=!1}return c=l,l}const g=256;let p=null,x=null;function b(){if(!p||!x){const l=t.createShaderModule({code:ma});x=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const h=t.createPipelineLayout({bindGroupLayouts:[x]});p=t.createComputePipeline({layout:h,compute:{module:l,entryPoint:"cs_main"}})}return{pipeline:p,layout:x}}let R=null,A=null;function E(){if(!R||!A){const l=t.createShaderModule({code:ga});A=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const h=t.createPipelineLayout({bindGroupLayouts:[A]});R=t.createRenderPipeline({layout:h,vertex:{module:l,entryPoint:"vs_main"},fragment:{module:l,entryPoint:"fs_main",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}})}return{pipeline:R,layout:A}}return{backend:"webgpu",capabilities:r,probeExtendedToneMapping:f,createTexture(l,h,w){return new yr(t,l,h,w)},createSampler(l){const h=(l==null?void 0:l.filter)==="linear"?"linear":"nearest",w=t.createSampler({magFilter:h,minFilter:h,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new wr(w)},createRenderPipeline(l){const h=t.createShaderModule({code:l.shaderWGSL}),w=ya(l.shaderWGSL),y=sr(l.targetFormat),S=Ea(t,w),G=t.createPipelineLayout({bindGroupLayouts:[S]}),O=C=>t.createRenderPipeline({layout:G,vertex:{module:h,entryPoint:"vs_main"},fragment:{module:h,entryPoint:"fs_main",targets:[{format:C}]},primitive:{topology:"triangle-list"}}),B=O(y);return new wa(B,w,S,y,O)},createComputePipeline(l){const h=t.createShaderModule({code:l.shaderWGSL}),w=t.createComputePipeline({layout:"auto",compute:{module:h,entryPoint:"cs_main"}});return new Ra(w)},createBindGroup(l,h){const w=l,y=new Map,S=[];for(const[O,B]of w.bindings)if(B.kind==="uniform"){const C=t.createBuffer({size:B.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});S.push(C),y.set(O,{binding:O,resource:{buffer:C}})}else B.kind==="sampler"&&y.set(O,{binding:O,resource:a()});for(const O of h){const B=O.resource;if(B instanceof yr){const C=qt(O.binding,"texture");w.bindings.has(C)&&y.set(C,{binding:C,resource:B.gpuTexture.createView()})}else if(B instanceof wr){const C=qt(O.binding,"sampler");w.bindings.has(C)&&y.set(C,{binding:C,resource:B.gpuSampler})}else{const C=qt(O.binding,"uniform"),K=w.bindings.get(C);if(K&&K.kind==="uniform"){const U=B.uniform,X=t.createBuffer({size:Math.max(K.sizeBytes,U.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(X,0,U.buffer,U.byteOffset,U.byteLength),S.push(X),y.set(C,{binding:C,resource:{buffer:X}})}}}const G=t.createBindGroup({layout:w.bindGroupLayout,entries:Array.from(y.values())});return new _a(G,S)},createSurface(l,h){const w=l.getContext("webgpu");if(!w)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const y=h.hdr&&r.hdr,S=()=>y?pa(w,t):fn(w,t),G=S();return new Aa(l,w,G,S)},renderFullscreen(l,h,w){const y=h,S=w,G=s(l),{width:O,height:B}=i(l),C=St(l)?l.format:sr(l.format),K=y.pipelineFor(C),U=t.createCommandEncoder(),X=U.beginRenderPass({colorAttachments:[{view:G,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});X.setPipeline(K),X.setBindGroup(0,S.gpuBindGroup),X.setViewport(0,0,O,B,0,1),X.draw(3),X.end(),t.queue.submit([U.finish()])},createDeepSampleBuffers(l){const{layout:h}=E(),w=C=>{const K=t.createBuffer({size:C.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(K,0,C.buffer,C.byteOffset,C.byteLength),K},y=w(l.offsets),S=w(l.colors),G=w(l.zs),O=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),B=t.createBindGroup({layout:h,entries:[{binding:0,resource:{buffer:y}},{binding:1,resource:{buffer:S}},{binding:2,resource:{buffer:G}},{binding:3,resource:{buffer:O}}]});return new Sa(l.width,l.height,[y,S,G],O,B)},compositeDeep(l,h,w,y){const S=l,G=h,{pipeline:O}=E();t.queue.writeBuffer(S.paramsBuffer,0,new Float32Array([S.width,S.height,y,w]));const B=t.createCommandEncoder(),C=B.beginRenderPass({colorAttachments:[{view:G.gpuTexture.createView(),loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});C.setPipeline(O),C.setBindGroup(0,S.bindGroup),C.setViewport(0,0,G.width,G.height,0,1),C.draw(3),C.end(),t.queue.submit([B.finish()])},async readback(l){const h=St(l),{width:w,height:y}=i(l),S=h?l.hdr?"rgba16float":"rgba8unorm":l.format,G=h&&l.format==="bgra8unorm",O=h?l.getCurrentGPUTexture():l.gpuTexture,B=dn(S),C=w*B,K=256,U=Math.ceil(C/K)*K,X=U*y,te=t.createBuffer({size:X,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),ue=t.createCommandEncoder();ue.copyTextureToBuffer({texture:O},{buffer:te,bytesPerRow:U,rowsPerImage:y},{width:w,height:y,depthOrArrayLayers:1}),t.queue.submit([ue.finish()]);try{await vr(te,u)}catch(H){try{te.destroy()}catch{}throw H}const j=new Uint8Array(te.getMappedRange()),J=new Uint8Array(C*y);for(let H=0;H<y;H++){const se=H*U,ee=H*C;J.set(j.subarray(se,se+C),ee)}if(te.unmap(),te.destroy(),S==="rgba8unorm"){if(G)for(let H=0;H<J.length;H+=4){const se=J[H],ee=J[H+2];J[H]=ee,J[H+2]=se}return J}if(S==="rgba16float"){const H=new Uint16Array(J.buffer,J.byteOffset,J.byteLength/2),se=new Float32Array(H.length);for(let ee=0;ee<H.length;ee++)se[ee]=xa(H[ee]);return se}return new Float32Array(J.buffer,J.byteOffset,J.byteLength/4)},async reduceDiffSumSquaredAbs(l,h,w,y){const S=l,G=h,O=Math.max(0,w*y),B=Math.max(1,Math.ceil(O/g)),{pipeline:C,layout:K}=b(),U=B*2*4,X=t.createBuffer({size:U,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),te=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(te,0,new Uint32Array([Math.max(1,w),Math.max(1,y),O,0]));const ue=t.createBindGroup({layout:K,entries:[{binding:0,resource:S.gpuTexture.createView()},{binding:1,resource:G.gpuTexture.createView()},{binding:2,resource:{buffer:X}},{binding:3,resource:{buffer:te}}]}),j=t.createBuffer({size:U,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),J=t.createCommandEncoder(),H=J.beginComputePass();H.setPipeline(C),H.setBindGroup(0,ue),H.dispatchWorkgroups(B),H.end(),J.copyBufferToBuffer(X,0,j,0,U),t.queue.submit([J.finish()]);try{await vr(j,u)}catch(ne){for(const Ie of[j,X,te])try{Ie.destroy()}catch{}throw ne}const ee=new Float32Array(j.getMappedRange()).slice();j.unmap(),j.destroy(),X.destroy(),te.destroy();let oe=0,Se=0;for(let ne=0;ne<B;ne++)oe+=ee[ne*2],Se+=ee[ne*2+1];return{sumSq:oe,sumAbs:Se}},destroy(){o||(t.destroy(),o=!0)},isContextLost(){return!1}}}let Xt=null;async function Pa(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return Ma()}function Ft(){return Xt||(Xt=Pa()),Xt}const Ta=`
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
`,ge=`
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
`,qe=`
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

// Nearest-texelFetch LUT lookup, round-half-up index (see image.wgsl.ts).
fn sampleLUT(lut: texture_2d<f32>, valueUnit: f32) -> vec3<f32> {
  let idxF = clamp(valueUnit, 0.0, 1.0) * 255.0;
  let idx = clamp(i32(floor(idxF + 0.5)), 0, 255);
  return textureLoad(lut, vec2<i32>(idx, 0), 0).rgb;
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
`,Da=`
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
fn processSide(lut: texture_2d<f32>, sampled: vec4<f32>, exposureEV: f32, offset: f32, operatorId: i32, gamma: f32, isScalar: bool, hdrOut: bool, peak: f32, srgbDecode: bool) -> vec3<f32> {
  var src = sampled.rgb;
  if (srgbDecode) { src = vec3<f32>(srgbEotf(src.r), srgbEotf(src.g), srgbEotf(src.b)); }
  var rgb = src * exp2(exposureEV) + vec3<f32>(offset);
  if (isScalar) { rgb = sampleLUT(lut, rgb.x); }
  rgb = applyOperator(rgb, operatorId, peak);
  let hasGamma = gamma > 0.0;
  if (hdrOut) {
    return vec3<f32>(extendedOutputEncodeF(rgb.r, gamma, hasGamma), extendedOutputEncodeF(rgb.g, gamma, hasGamma), extendedOutputEncodeF(rgb.b, gamma, hasGamma));
  }
  return vec3<f32>(outputEncodeF(rgb.r, gamma, hasGamma), outputEncodeF(rgb.g, gamma, hasGamma), outputEncodeF(rgb.b, gamma, hasGamma));
}
`,Ut=`
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
`;function pn(e){return`
${ge}
${qe}
${Da}

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

  let colorA = processSide(lut, sampledA, exposureEV, offset, operatorId, gamma, isScalar, hdrOut, peak, srgbDecodeA);
  let colorB = processSide(lut, sampledB, exposureEV, offset, operatorId, gamma, isScalar, hdrOut, peak, srgbDecodeB);

  let split = u_compose.x;
  let alpha = u_compose.y;
  let outColor = ${e};
  return vec4<f32>(outColor, 1.0);
}
`}const Ba=pn("select(colorB, colorA, uv.x < split)"),Ca=pn("mix(colorA, colorB, alpha)");function ka(e){switch(e){case"center":return{v:"center",h:"center"};case"top-right":return{v:"top",h:"right"};case"bottom-left":return{v:"bottom",h:"left"};case"bottom-right":return{v:"bottom",h:"right"};case"top-left":default:return{v:"top",h:"left"}}}function Er(e,t,r){const{v:n,h:a}=ka(r),s=e.w-t.w,i=e.h-t.h,o=a==="left"?0:a==="right"?s:Math.floor(s/2),u=n==="top"?0:n==="bottom"?i:Math.floor(i/2);return{x:o,y:u}}function mt(e,t,r,n,a="b"){if(n==="fill"){const i=a==="a"?{w:e.w,h:e.h}:{w:t.w,h:t.h};return{fit:n,result:i,offsetA:{x:0,y:0},offsetB:{x:0,y:0}}}const s={w:Math.min(e.w,t.w),h:Math.min(e.h,t.h)};return{fit:n,result:s,offsetA:Er(e,s,r),offsetB:Er(t,s,r)}}function ur(e){return`${e.fit}:${e.result.w}x${e.result.h}:${e.offsetA.x},${e.offsetA.y}:${e.offsetB.x},${e.offsetB.y}`}const Mt={linear:0,srgb:1,reinhard:2,aces:3,extended:4,"extended-reinhard":5,"extended-aces":6,"extended-clamp":7,gamma:8},Rr=new WeakMap;function Ga(e,t){let r=Rr.get(e);r||(r=new Map,Rr.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:Ta,targetFormat:t}),r.set(t,n)),n}function mn(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function gn(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function Oa(e,t,r,n){var E;const a=mn(t),s=Ga(e,a),i=gn(e,n.isScalar?n.colormap:void 0),o=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,u=Mt[n.operator]??Mt.srgb,c=new Float32Array([n.exposureEV,u,o,n.isScalar?1:0]),f=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),g=new Float32Array([n.hdrOut?1:0]),p=new Float32Array([n.filter==="nearest"?0:1]),x=new Float32Array([n.offset??0]),b=new Float32Array([n.peak??Lt]),R=new Float32Array([n.srgbDecode?1:0]);let A;try{A=e.createBindGroup(s,[{binding:0,resource:r},{binding:1,resource:i},{binding:2,resource:{uniform:c}},{binding:3,resource:{uniform:f}},{binding:4,resource:{uniform:g}},{binding:5,resource:{uniform:p}},{binding:6,resource:{uniform:x}},{binding:7,resource:{uniform:b}},{binding:8,resource:{uniform:R}}]),e.renderFullscreen(t,s,A)}finally{(E=A==null?void 0:A.destroy)==null||E.call(A),i.destroy()}}const Sr=new WeakMap;function La(e,t,r){let n=Sr.get(e);n||(n=new Map,Sr.set(e,n));const a=`${t}:${r}`;let s=n.get(a);return s||(s=e.createRenderPipeline({shaderWGSL:t==="split"?Ba:Ca,targetFormat:r}),n.set(a,s)),s}function Fa(e,t,r,n,a){var R;if(a.mode==="diff")throw new Error("renderCompose: mode 'diff' is handled by the diff-engine, not renderCompose");const s=mn(t),i=La(e,a.mode,s),o=gn(e,a.isScalar?a.colormap:void 0),u=typeof a.gamma=="number"&&a.gamma>0?a.gamma:0,c=Mt[a.operator]??Mt.srgb,f=new Float32Array([a.exposureEV,c,u,a.isScalar?1:0]),g=new Float32Array([a.uv.x,a.uv.y,a.uv.w,a.uv.h]),p=new Float32Array([a.split,a.alpha,a.hdrOut?1:0,a.filter==="nearest"?0:1]),x=new Float32Array([a.offset??0,a.peak??Lt,a.srgbDecodeA?1:0,a.srgbDecodeB?1:0]);let b;try{b=e.createBindGroup(i,[{binding:0,resource:r},{binding:1,resource:n},{binding:2,resource:o},{binding:3,resource:{uniform:f}},{binding:4,resource:{uniform:g}},{binding:5,resource:{uniform:p}},{binding:6,resource:{uniform:x}}]),e.renderFullscreen(t,i,b)}finally{(R=b==null?void 0:b.destroy)==null||R.call(b),o.destroy()}}function _r(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,a=t/r,s=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:s,mae:a}}async function hn(e,t,r,n){const a=n??mt({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),s=a.result.w,i=a.result.h,o=s*i*3;if(o<=0)return{mse:0,psnr:1/0,mae:0};if(a.fit==="crop"&&a.offsetA.x===0&&a.offsetA.y===0&&a.offsetB.x===0&&a.offsetB.y===0&&e.reduceDiffSumSquaredAbs){const{sumSq:l,sumAbs:h}=await e.reduceDiffSumSquaredAbs(t,r,s,i);return _r(l,h,o)}const c=await e.readback(t),f=await e.readback(r),g=c instanceof Uint8Array?255:1,p=f instanceof Uint8Array?255:1,x=Pt(c,t.width,t.height,g,a.offsetA,a.fit==="fill",s,i),b=Pt(f,r.width,r.height,p,a.offsetB,a.fit==="fill",s,i);let R=0,A=0;const E=[0,0,0],v=[0,0,0];for(let l=0;l<i;l++)for(let h=0;h<s;h++){x(h,l,E),b(h,l,v);for(let w=0;w<3;w++){const y=E[w]-v[w];R+=y*y,A+=Math.abs(y)}}return _r(R,A,o)}function Pt(e,t,r,n,a,s,i,o){const u=(g,p,x)=>e[(p*t+g)*4+x]??0;if(!s)return(g,p,x)=>{const b=Math.min(Math.max(g+a.x,0),t-1),R=Math.min(Math.max(p+a.y,0),r-1);x[0]=u(b,R,0)/n,x[1]=u(b,R,1)/n,x[2]=u(b,R,2)/n};const c=t-1,f=r-1;return(g,p,x)=>{const b=(g+.5)/i,R=(p+.5)/o,A=b*t-.5,E=R*r-.5,v=Math.floor(A),l=Math.floor(E),h=A-v,w=E-l,y=Math.min(Math.max(v,0),c),S=Math.min(Math.max(v+1,0),c),G=Math.min(Math.max(l,0),f),O=Math.min(Math.max(l+1,0),f);for(let B=0;B<3;B++){const C=u(y,G,B),K=u(S,G,B),U=u(y,O,B),X=u(S,O,B),te=C+(K-C)*h,ue=U+(X-U)*h;x[B]=(te+(ue-te)*w)/n}}}function xn(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const Ua=12,Ue=[];function Ar(e){const t=Ue.indexOf(e);t!==-1&&Ue.splice(t,1),Ue.push(e)}function Ia(e){const t=Ue.indexOf(e);t!==-1&&Ue.splice(t,1)}function Tt(e){e.parked||(Ia(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),e.surface=null,e.parked=!0)}function Mr(e){for(;Ue.length>Ua;){const t=Ue.find(r=>r!==e&&!r.visible)??Ue.find(r=>r!==e);if(!t)break;Tt(t)}}function bn(e){var a,s,i,o;if(e.disposed)return;if(xn())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Ar(e),Mr(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const r=e.backingWidth||((a=e.source)==null?void 0:a.width)||((s=e.deep)==null?void 0:s.width)||1,n=e.backingHeight||((i=e.source)==null?void 0:i.height)||((o=e.deep)==null?void 0:o.height)||1;if(e.canvas.width=r,e.canvas.height=n,e.surface.configure(r,n),e.deep){const u=t.createTexture(e.deep.width,e.deep.height,"rgba16float");e.srcTexture=u,e.deepBuffers=t.createDeepSampleBuffers(e.deep),t.compositeDeep(e.deepBuffers,u,e.deepZNear,e.deepZFar)}else if(e.source){const u=t.createTexture(e.source.width,e.source.height,e.source.format);u.write(e.source.data),e.srcTexture=u}e.parked=!1,Ar(e),Mr(e)}function Na(e,t){if(e.disposed||!e.source&&!e.deep)return!0;try{return bn(e),!e.surface||!e.srcTexture?!1:(Oa(e.device,e.surface,e.srcTexture,t),!0)}catch(r){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",r),e.parked=!1,Tt(e),!1}}function za(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,e.deep=null,e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const r=e.device.createTexture(t.width,t.height,t.format);r.write(t.data),e.srcTexture=r}},setDeepSource(t,r,n){if(!e.disposed&&(e.deep=t,e.deepZNear=r,e.deepZFar=n,e.source=null,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy(),e.deepBuffers&&e.deepBuffers.destroy();const a=e.device.createTexture(t.width,t.height,"rgba16float");e.srcTexture=a,e.deepBuffers=e.device.createDeepSampleBuffers(t),e.device.compositeDeep(e.deepBuffers,a,r,n)}},setDeepWindow(t,r){e.disposed||(e.deepZNear=t,e.deepZFar=r,!e.parked&&e.deepBuffers&&e.srcTexture&&e.device.compositeDeep(e.deepBuffers,e.srcTexture,t,r))},resize(t,r){if(e.disposed)return;const n=Math.max(1,Math.round(t)),a=Math.max(1,Math.round(r));e.backingWidth===n&&e.backingHeight===a||(e.backingWidth=n,e.backingHeight=a,!e.parked&&e.surface&&(e.canvas.width=n,e.canvas.height=a,e.surface.configure(n,a)))},render(t){return Na(e,t)},park(){e.disposed||Tt(e)},restore(){e.disposed||!e.source&&!e.deep||bn(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Tt(e),e.source=null,e.deep=null,e.disposed=!0)}}}async function Va(e,t){const r=await Ft(),n={canvas:e,device:r,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,deep:null,deepZNear:-1/0,deepZFar:1/0,deepBuffers:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return za(n)}function Pr(e){e.dispose()}const Tr={"no-webgpu":0,"no-hdr-browser":1,"no-hdr-display":2},$a="https://github.com/doeringchristian/cairn-plot/blob/main/docs/browser-support.md";function Ha(e,t=!1){const r=e||"";return t?"brave":/firefox/i.test(r)?"firefox":/safari/i.test(r)&&!/chrome|chromium|crios|android/i.test(r)?"safari":/linux/i.test(r)&&/chrome|chromium/i.test(r)?"chromium-linux":"chromium"}function Wa(e){const t=e||"";return/mac os x|macintosh/i.test(t)?"macos":/windows/i.test(t)?"windows":"other"}function Ka(e,t){if(e==="no-hdr-display")switch(Wa(t.userAgent)){case"macos":return"macOS: EDR engages automatically on HDR-capable displays — confirm your display supports HDR.";case"windows":return"Windows: turn on Settings → System → Display → Use HDR.";default:return"Enable HDR in your display and OS settings."}const r=Ha(t.userAgent,t.isBrave);if(e==="no-hdr-browser")switch(r){case"firefox":return"Firefox has no extended-tone-mapping canvas path at all — true HDR output is impossible until Firefox implements it (fundamental browser limitation).";case"safari":return"Safari's WebGPU HDR canvas tone-mapping is still maturing — update to the latest Safari 26+.";default:return"Chrome/Edge 129+ is required for HDR canvas output (toneMapping: extended) — update your browser."}switch(r){case"firefox":return"Firefox: about:config → dom.webgpu.enabled (HDR output is not available in Firefox at all — browser limitation).";case"safari":return"Safari: Develop → Feature Flags → WebGPU (Safari 26+ has it by default).";case"brave":return"Brave: check Shields fingerprint blocking + brave://flags.";case"chromium-linux":return"Chromium on Linux: enable chrome://flags/#enable-unsafe-webgpu.";case"chromium":default:return"Chrome/Edge: enable chrome://flags/#enable-unsafe-webgpu and hardware acceleration."}}function qa(e){switch(e){case"no-webgpu":return"GPU renderer unavailable → CPU fallback active; FLIP kernels + HDR compare disabled.";case"no-hdr-browser":return"True HDR output is unsupported by this browser — a fundamental browser limitation, not a cairn-plot bug → HDR images tone-mapped to SDR.";case"no-hdr-display":return"Your display/OS is not in HDR mode → HDR images tone-mapped to SDR."}}function vn(e,t){return`cairn-plot:capnotice:${e}:${t}`}const yn=new Set;function Dr(e){try{if(window.localStorage.getItem(e)==="1")return!0}catch{}try{if(window.sessionStorage.getItem(e)==="1")return!0}catch{}return yn.has(e)}function Xa(e){try{window.localStorage.setItem(e,"1");return}catch{}try{window.sessionStorage.setItem(e,"1");return}catch{}yn.add(e)}const Br=new Set;let Dt=null,rt=null;function wn(){rt&&rt.parentNode&&rt.parentNode.removeChild(rt),rt=null,Dt=null}function Ya(e){const t=vn(e,window.location.pathname),r=Ka(e,{userAgent:navigator.userAgent,isBrave:!!navigator.brave}),n=document.createElement("div");n.setAttribute("role","status"),n.setAttribute("data-cairn-plot-capnotice",e),Object.assign(n.style,{position:"fixed",bottom:"12px",right:"12px",zIndex:"2147483000",maxWidth:"340px",boxSizing:"border-box",padding:"10px 30px 10px 12px",borderRadius:"6px",border:"1px solid var(--color-border, #d0d7de)",background:"rgb(var(--color-bg-elevated-rgb, 246 248 250) / 0.9)",color:"var(--color-fg-muted, #656d76)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",boxShadow:"0 4px 12px rgba(0, 0, 0, 0.18)",font:"12px/1.4 system-ui, sans-serif"});const a=document.createElement("div");a.textContent=qa(e),Object.assign(a.style,{fontWeight:"600",color:"var(--color-fg, #1f2328)",marginBottom:"4px"});const s=document.createElement("div");s.textContent=r,s.style.marginBottom="4px";const i=document.createElement("a");i.href=$a,i.target="_blank",i.rel="noopener noreferrer",i.textContent="Learn more",Object.assign(i.style,{color:"var(--color-accent, #0969da)",textDecoration:"none"});const o=document.createElement("button");o.type="button",o.textContent="×",o.setAttribute("aria-label","Dismiss browser capability notice"),o.title="Dismiss",Object.assign(o.style,{position:"absolute",top:"4px",right:"6px",padding:"0 4px",border:"0",background:"transparent",color:"var(--color-fg-subtle, #8b949e)",cursor:"pointer",fontSize:"16px",lineHeight:"1"}),o.addEventListener("click",()=>{Xa(t),wn()}),n.appendChild(a),n.appendChild(s),n.appendChild(i),n.appendChild(o),document.body.appendChild(n),rt=n,Dt=e}function En(e){if(typeof document>"u"||typeof window>"u"||Br.has(e))return;Br.add(e);const t=vn(e,window.location.pathname);if(Dr(t))return;const r=()=>{if(!Dr(t)){if(Dt!==null)if(Tr[e]<Tr[Dt])wn();else return;Ya(e)}};document.body?r():window.addEventListener("DOMContentLoaded",r,{once:!0})}const ja={data:new Float32Array(0),shape:[0,0],dtype:"<f4"};function Za(e){const{h:t,w:r,c:n}=na(e.shape);if(e.precision==="f16-bits"){const i=e.data,o=new Uint16Array(r*t*4);for(let u=0;u<r*t;u++){const c=u*n,f=u*4;if(n===1){const g=i[c];o[f]=g,o[f+1]=g,o[f+2]=g,o[f+3]=At}else o[f]=i[c],o[f+1]=i[c+1],o[f+2]=i[c+2],o[f+3]=n>=4?i[c+3]:At}return{data:o,width:r,height:t,format:"rgba16float"}}const a=e.data,s=new Float32Array(r*t*4);for(let i=0;i<r*t;i++){const o=i*n;let u,c,f,g=1;n===1?u=c=f=Ge(a[o]):n===3?(u=Ge(a[o]),c=Ge(a[o+1]),f=Ge(a[o+2])):(u=Ge(a[o]),c=Ge(a[o+1]),f=Ge(a[o+2]),g=Ge(a[o+3]));const p=i*4;s[p]=u,s[p+1]=c,s[p+2]=f,s[p+3]=g}return{data:s,width:r,height:t,format:"rgba32float"}}function Rn(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const a=Math.min(t.width/r,t.height/n),s=r*a,i=n*a,o=(t.width-s)/2,u=(t.height-i)/2,c=Math.max(e.zoom,1e-6),f=t.width/(c*s),g=t.height/(c*i),p=-o/s-e.pan.x/(c*s),x=-u/i-e.pan.y/(c*i);return{x:p,y:x,w:f,h:g}}function Sn(e,t,r,n){const a=e.w*r,s=e.h*n;return a<=0||s<=0||t.width<=0||t.height<=0?0:Math.min(t.width/a,t.height/s)}function Qa(e){var ct,Qe,Je;const t=jn(e),r=d.useRef(null),n=d.useRef(null),a=d.useRef(null),s=d.useRef(null),i=d.useRef(null),o=t&&!!((ct=e.hdr)!=null&&ct.deep),u=d.useCallback((M,k)=>{var V,D;(V=s.current)==null||V.setDeepWindow(M,k),(D=i.current)==null||D.call(i)},[]),c=Zn(t?e.hdr:ja,o?u:void 0),f=d.useRef(!1),[g,p]=d.useState(!1),[x,b]=d.useState(!1),[R,A]=d.useState(!1),[E,v]=d.useState(null),[l,h]=d.useState(0),[w,y]=d.useState(0),[S,G]=d.useState({x:0,y:0,w:1,h:1}),O=d.useRef(null),B=d.useRef(null),[C,K]=d.useState(0),U=e.zoom??1,X=e.pan??{x:0,y:0},te=e.onViewportChange,ue=e.toolbar??!0,j=t?"none":e.colormap??"none",[J,H,se]=Le(j);d.useEffect(()=>{H(j)},[j,H]);const ee=t?"none":J,oe=e.tonemap,[Se,ne]=d.useState(null);d.useEffect(()=>{ne(null)},[oe]);const Ie=un(oe),_e=Se??Ie,It=Se!==null&&Se!==Ie,Xe=d.useCallback(()=>ne(null),[]),Ye=e.peak,gt=()=>Ye!=null&&Ye>0?Ye:ln(oe)??Lt,[nt,Te,at]=Le(gt());d.useEffect(()=>{Te(gt())},[Ye,oe]);const le=e.gamma,[De,Ne,ht]=Le(le&&le>0?le:Xr);d.useEffect(()=>{le&&le>0&&Ne(le)},[le,Ne]);const[Be,ve]=d.useState(0),[he,st]=d.useState(0),ye=Yr();d.useEffect(()=>{const M=r.current;if(!M)return;let k=!1;return Ft().then(V=>{var ie;if(k)return;const D=((ie=V.probeExtendedToneMapping)==null?void 0:ie.call(V))??!1,I=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,re=D&&I&&(t||j==="none");f.current=re,p(re),t&&!re&&En(D?"no-hdr-display":"no-hdr-browser"),Va(M,{hdr:re}).then(de=>{if(k){Pr(de);return}s.current=de,A(!0)}).catch(de=>{k||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",de),b(!0))})}).catch(V=>{k||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",V),b(!0))}),()=>{k=!0,s.current&&(Pr(s.current),s.current=null)}},[]),d.useEffect(()=>{const M=n.current;if(!M)return;const k=new ResizeObserver(()=>y(V=>V+1));return k.observe(M),()=>k.disconnect()},[]),d.useEffect(()=>{const M=n.current;if(!M)return;const k=new IntersectionObserver(V=>{const D=V[0];if(!D)return;const I=s.current;I&&(I.setVisible(D.isIntersecting),D.isIntersecting?I.isParked&&(I.restore(),y(z=>z+1)):I.park())},{threshold:0});return k.observe(M),()=>k.disconnect()},[]),d.useEffect(()=>{var V;if(!t||!R||o)return;const M=c.hdr;O.current=M;const k=Za(M);(V=s.current)==null||V.setSource(k),v(D=>D&&D.w===k.width&&D.h===k.height?D:{w:k.width,h:k.height}),K(D=>D+1),h(D=>D+1)},[t,R,o,t?c.hdr:null]),d.useEffect(()=>{if(!t||!R||!o)return;const M=e.hdr,k=M.deep;O.current=M;let V=!1;return k.getGpuCsr().then(D=>{var I;V||((I=s.current)==null||I.setDeepSource(D,k.zMin,k.zMax),v(z=>z&&z.w===D.width&&z.h===D.height?z:{w:D.width,h:D.height}),K(z=>z+1),h(z=>z+1))}).catch(D=>{V||console.warn("[cairn] deep GPU CSR upload failed:",D)}),()=>{V=!0}},[t,R,o,t?e.hdr.deep:null]),d.useEffect(()=>{if(t||!R)return;const M=e,k=M.imageUrl,V=J;if(!k){B.current=null,v(null),K(I=>I+1);return}let D=!1;return jr(k).then(I=>{var ie,de;if(D||!I)return;let z=I;if(V!=="none"){const W=`gpu::${k}::${V}::ev${Be}::off${he}`,we=Qn(W);if(we)z=we;else{const $e=Jn(V);z=ea(I,V,$e,Be,he),ta(W,z)}}B.current=I;const re={data:z.data,width:z.width,height:z.height,format:"rgba8unorm"};(ie=s.current)==null||ie.setSource(re),v(W=>W&&W.w===z.width&&W.h===z.height?W:{w:z.width,h:z.height}),(de=M.onNaturalSize)==null||de.call(M,z.width,z.height),K(W=>W+1),h(W=>W+1)}),()=>{D=!0}},[t,R,t?null:e.imageUrl,t?null:J,t?0:Be,t?0:he]);const Y=e.exposure??0,ze=e.offset??0,Ae=!t&&ee==="none",xe=d.useCallback(()=>{const M=s.current;if(!M||!R||!E)return;const k=n.current,V=a.current,D=V?V.getBoundingClientRect():k?k.getBoundingClientRect():{width:E.w,height:E.h},I=Rn({zoom:U,pan:X},D,E.w,E.h);G(W=>W.x===I.x&&W.y===I.y&&W.w===I.w&&W.h===I.h?W:I),D.width>0&&D.height>0&&M.resize(Math.round(D.width*ye),Math.round(D.height*ye));const z=Sn(I,D,E.w,E.h)>=Zr?"nearest":"linear",re=I,ie=Qr(_e,f.current?nt:1,f.current,De),de=t||Ae?{exposureEV:Y+Be,offset:ze+he,operator:ie.operator,gamma:ie.gamma,isScalar:!1,hdrOut:ie.hdrOut,peak:ie.peak,srgbDecode:!t,uv:re,filter:z}:{exposureEV:0,offset:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,srgbDecode:!1,uv:re,filter:z};try{M.render(de)||b(!0)}catch(W){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",W),b(!0)}},[R,E,U,X.x,X.y,Y,ze,Be,he,_e,nt,De,Ae,t,ee,ye]);i.current=xe,d.useEffect(()=>{xe()},[xe,l,w]);const be=d.useCallback((M,k,V)=>{if(t){const W=O.current,we=E;if(!W||!we||M<0||k<0||M>=we.w||k>=we.h)return null;const $e=W.shape.length===2?1:W.shape[2]??1,He=(k*we.w+M)*$e,et=W.data,We=W.precision==="f16-bits"?Me=>Jr(et[Me]??0):Me=>et[Me]??0,Ke=$e===1?[We(He)]:[We(He),We(He+1),We(He+2)];return ft(Ke,"unit",V)}const D=B.current;if(!D||M<0||k<0||M>=D.width||k>=D.height)return null;const I=(k*D.width+M)*4,z=D.data[I],re=D.data[I+1],ie=D.data[I+2];return ft(ee!=="none"||z===re&&re===ie?[z]:[z,re,ie],"uint8",V)},[t,E,ee]),Ce=e.showAxes??!1,je=t?e.label??"":e.label,Ze=e.interpolation??"auto",it=Ze==="auto"?void 0:Ze,Ve=t?void 0:e.overlay,fe=t?void 0:e.overlaySettings,Nt=t?!1:e.isDraggable??!1,xt=t?void 0:e.onDragStart;if(x)return t?Q.jsx(tr,{...e}):Q.jsx(tr,{...e});const ot=Ve&&(fe!=null&&fe.enabled)&&E&&((((Qe=Ve.boxes)==null?void 0:Qe.length)??0)>0||(((Je=Ve.masks)==null?void 0:Je.length)??0)>0)?Q.jsx(ra,{data:Ve,settings:fe,naturalWidth:E.w,naturalHeight:E.h}):void 0;return Q.jsx(en,{paneAttrs:{"data-gpu-image-pane":"","data-gpu-backend-ready":R},viewportAttrs:{"data-gpu-image-viewport":""},toolbar:ue,paneRef:n,wrapperRef:a,zoom:U,pan:X,onViewportChange:te,naturalDims:E,checkerboard:"wrapper",wrapperClassName:"relative w-full h-full flex items-center justify-center",viewportPadding:Ce&&E?"16px 4px 4px 28px":0,surface:Q.jsx("canvas",{ref:r,className:"w-full h-full block",style:{imageRendering:it},"data-gpu-image-canvas":!0}),showAxes:Ce,overlayNode:ot,overlay:{displayElRef:r,sample:be,version:C,hasSource:!0,sourceWindow:S},notationSeed:e.pixelValueNotation??"decimal",exportCanvasRef:r,requestRender:xe,leadingMenus:t?[rr(_e,M=>ne(M))]:Ae?[nr(ee,M=>H(M)),rr(_e,M=>ne(M))]:[nr(ee,M=>H(M))],displayAdjust:{exposureEV:Be,offset:he,onExposureChange:ve,onOffsetChange:st},extraSliders:[...(t||Ae)&&g?[{id:"peak",label:"PK",title:"Peak white (×SDR white) — the HDR ceiling P every operator clips at (Linear/sRGB/Gamma hard-clip at P; Reinhard/ACES roll off toward P). P=1 reproduces the SDR rendition exactly; double-click to type a value, including 'inf' for the raw browser-clipped extended look.",min:nn,max:rn,step:tn,value:nt,onChange:Te,format:M=>Number.isFinite(M)?`${M.toFixed(1)}×`:"∞"}]:[],...(t||Ae)&&cn(_e)?[{id:"gamma",label:"γ",title:"Display gamma γ for the Gamma transfer — display = clamp(value)^(1/γ), tev-style. Default 2.2 (close to sRGB, not identical). Double-click to type a value.",min:on,max:sn,step:an,value:De,onChange:Ne,format:M=>M.toFixed(1)}]:[]],depthSliders:c.sliders,regionSelect:o?{rect:c.region,queryLive:c.queryRegionWindow,commit:c.commitRegion,remove:c.removeRegion}:void 0,onReset:()=>{se.reset(),Xe(),at.reset(),ht.reset(),c.reset()},extraModified:se.isModified||It||at.isModified||ht.isModified||c.isModified,label:je,showLabelChip:!!je,isDraggable:Nt,onDragStart:xt})}const Bt=new Map;function Ee(e){if(Bt.has(e.id))throw new Error(`registerDiffKernel: duplicate kernel id "${e.id}"`);Bt.set(e.id,e)}function Fe(e){return Bt.get(e)}function Ja(){return Array.from(Bt.values())}function _n(e,t){return{...e.params??{},...t??{}}}const es={kind:"pointwise",id:"signed",label:"Signed Error",publicName:"signed",displayRange:"signed",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(a.rgb - b.rgb, 1.0);
}
`},ts={kind:"pointwise",id:"absolute",label:"Absolute Error",publicName:"abs",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(abs(a.rgb - b.rgb), 1.0);
}
`},rs={kind:"pointwise",id:"squared",label:"Squared Error",publicName:"square",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let d = a.rgb - b.rgb;
  return vec4<f32>(d * d, 1.0);
}
`},ns={kind:"pointwise",id:"relative_signed",label:"Relative Signed",publicName:"rel_signed",displayRange:"signed",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  return vec4<f32>((a.rgb - b.rgb) / denom, 1.0);
}
`},as={kind:"pointwise",id:"relative_absolute",label:"Relative Absolute",publicName:"rel_abs",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  return vec4<f32>(abs(a.rgb - b.rgb) / denom, 1.0);
}
`},ss={kind:"pointwise",id:"relative_squared",label:"Relative Squared",publicName:"rel_square",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  let d = a.rgb - b.rgb;
  return vec4<f32>((d * d) / (denom * denom), 1.0);
}
`},An=[[10135552/24577794,8788810/24577794,4435075/24577794],[2613072/12288897,8788810/12288897,887015/12288897],[1425312/73733382,8788810/73733382,70074185/73733382]];os(An);const Yt=[1.052156925,1,.91835767],is=.7;function os(e){const[t,r,n]=e[0],[a,s,i]=e[1],[o,u,c]=e[2],f=s*c-i*u,g=-(a*c-i*o),p=a*u-s*o,b=1/(t*f+r*g+n*p);return[[f*b,-(r*c-n*u)*b,(r*i-n*s)*b],[g*b,(t*c-n*o)*b,-(t*i-n*a)*b],[p*b,-(t*u-r*o)*b,(t*s-r*a)*b]]}function cs(e,t,r,n){return[e[0][0]*t+e[0][1]*r+e[0][2]*n,e[1][0]*t+e[1][1]*r+e[1][2]*n,e[2][0]*t+e[2][1]*r+e[2][2]*n]}const jt=6/29;function Zt(e){return e>jt**3?Math.cbrt(e):e/(3*jt*jt)+4/29}function Cr(e,t,r){const[n,a,s]=cs(An,e,t,r),i=Zt(n*Yt[0]),o=Zt(a*Yt[1]),u=Zt(s*Yt[2]),c=116*o-16,f=500*(i-o),g=200*(o-u);return[c,.01*c*f,.01*c*g]}function us(e,t){const r=e[0]-t[0],n=e[1]-t[1],a=e[2]-t[2];return Math.abs(r)+Math.sqrt(n*n+a*a)}function ls(){const e=Cr(0,1,0),t=Cr(0,0,1);return Math.pow(us(e,t),is)}const fs=ls(),Mn=fs,ds=.082;function Pn(e){const t=[1,1,34.1],r=[.0047,.0053,.04],n=[0,0,13.5],a=[1e-5,1e-5,.025],s=Math.max(...r,...a),i=Math.ceil(3*Math.sqrt(s/(2*Math.PI**2))*e),o=1/e,u=Math.PI**2,c=[0,0,0];for(let f=-i;f<=i;f++)for(let g=-i;g<=i;g++){const p=(g*o)**2+(f*o)**2;for(let x=0;x<3;x++)c[x]+=t[x]*Math.sqrt(Math.PI/r[x])*Math.exp(-u*p/r[x])+n[x]*Math.sqrt(Math.PI/a[x])*Math.exp(-u*p/a[x])}return{r:i,deltaX:o,sums:c}}function Tn(e){const t=.5*ds*e,r=Math.ceil(3*t);let n=0,a=0,s=0;for(let i=-r;i<=r;i++)for(let o=-r;o<=r;o++){const u=Math.exp(-(o*o+i*i)/(2*t*t)),c=-o*u,f=(o*o/(t*t)-1)*u;c>0&&(n+=c),f>0?a+=f:s-=f}return{r,sd:t,edgeNorm:n,pointPos:a,pointNeg:s}}const ps=`
${ge}
${Ut}
${qe}
${pt}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_map0: vec4<f32>; // offX, offY, fitFill, 0
@group(0) @binding(8) var<uniform> u_map1: vec4<f32>; // resultW, resultH, 0, 0
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.position.xy);
  let s = mapSample(src, px, u_map0.x, u_map0.y, u_map1.x, u_map1.y, u_map0.z);
  return vec4<f32>(flip_rgb2ycxcz(s.rgb), 1.0);
}
`,ms=`
${ge}
${Ut}
${qe}
${pt}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_map0: vec4<f32>; // offX, offY, fitFill, 0
@group(0) @binding(8) var<uniform> u_map1: vec4<f32>; // resultW, resultH, 0, 0
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.position.xy);
  let s = mapSample(src, px, u_map0.x, u_map0.y, u_map1.x, u_map1.y, u_map0.z);
  return vec4<f32>(flip_linrgb2ycxcz(clamp(s.rgb, vec3<f32>(0.0), vec3<f32>(1.0))), 1.0);
}
`,Ct=`
${ge}
${Ut}
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
`,Dn=`
${ge}
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
`;function Re(e,t){return{binding:e,resource:{uniform:new Float32Array(t)}}}function kt(e,t,r){const n=r.sourceMap,a=n?t==="a"?n.offsetA:n.offsetB:{x:0,y:0},s=n!=null&&n.fill?1:0;return[Re(e,[a.x,a.y,s,0]),Re(e+1,[r.width,r.height,0,0])]}function Gt(e){return[Re(1,[e.deltaX,e.r,e.sums[0],e.sums[1]]),Re(2,[e.sums[2],0,0,0])]}function Bn(e){return[Re(4,[Mn,e.sd,e.r,e.edgeNorm]),Re(5,[e.pointPos,e.pointNeg,0,0])]}function Cn(e,t,r,n,a,s=""){const i=Pn(e),o=Tn(e),u=`ycxczA${s}`,c=`ycxczB${s}`,f=`labA${s}`,g=`labB${s}`,p=`flip${s}`;return{passes:[{name:u,shader:t,inputs:[r],output:u,uniforms:()=>kt(1,"a",a)},{name:c,shader:t,inputs:[n],output:c,uniforms:()=>kt(1,"b",a)},{name:f,shader:Ct,inputs:[u],output:f,uniforms:()=>Gt(i)},{name:g,shader:Ct,inputs:[c],output:g,uniforms:()=>Gt(i)},{name:p,shader:Dn,inputs:[f,g,u,c],output:p,uniforms:()=>Bn(o)}],flipRef:p}}const gs={kind:"multipass",id:"flip",label:"FLIP (perceptual)",publicName:"flip",displayRange:"unit",output:"scalar",params:{ppd:67},buildPasses(e){const t=e.params.ppd??67,{passes:r,flipRef:n}=Cn(t,ps,"srcA","srcB",e);return{passes:r,final:n}}},hs={kind:"multipass",id:"flip-ldr-forced",label:"FLIP (LDR forced)",publicName:"flip_ldr",displayRange:"unit",output:"scalar",params:{ppd:67},buildPasses(e){const t=e.params.ppd??67,{passes:r,flipRef:n}=Cn(t,ms,"srcA","srcB",e);return{passes:r,final:n}}},kr=`
${ge}
${Ut}
${qe}
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
`,xs=`
${ge}
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
`,bs={kind:"multipass",id:"hdr-flip",label:"FLIP (perceptual)",publicName:"flip_hdr",displayRange:"unit",output:"scalar",params:{ppd:67,startExposure:0,stopExposure:4,numExposures:2},buildPasses(e){const t=e.params.ppd??67,r=e.params.startExposure??0,n=e.params.stopExposure??4,a=Math.max(2,Math.round(e.params.numExposures??2)),s=(n-r)/Math.max(a-1,1),i=Pn(t),o=Tn(t),u=[];let c=null;for(let f=0;f<a;f++){const g=r+f*s,p=`_e${f}`,x=`ycxczA${p}`,b=`ycxczB${p}`,R=`labA${p}`,A=`labB${p}`,E=`acc${p}`;u.push({name:x,shader:kr,inputs:["srcA"],output:x,uniforms:()=>[Re(1,[g,0,0,0]),...kt(2,"a",e)]},{name:b,shader:kr,inputs:["srcB"],output:b,uniforms:()=>[Re(1,[g,0,0,0]),...kt(2,"b",e)]},{name:R,shader:Ct,inputs:[x],output:R,uniforms:()=>Gt(i)},{name:A,shader:Ct,inputs:[b],output:A,uniforms:()=>Gt(i)}),c===null?u.push({name:E,shader:Dn,inputs:[R,A,x,b],output:E,uniforms:()=>Bn(o)}):u.push({name:E,shader:xs,inputs:[R,A,x,b,c],output:E,uniforms:()=>[Re(5,[Mn,o.sd,o.r,o.edgeNorm]),Re(6,[o.pointPos,o.pointNeg,0,0])]}),c=E}return{passes:u,final:c}}},kn=.01,Gn=.03,Ot=1,ir=1.5,Oe=5,Qt=[.2126,.7152,.0722];function Jt(e){return e<=.04045?e/12.92:Math.pow((e+.055)/1.055,2.4)}function Gr(e,t,r){const n=Qt[0]*Jt(e)+Qt[1]*Jt(t)+Qt[2]*Jt(r);return Math.min(1,Math.max(0,n))}function vs(e,t){const r=2*t+1,n=new Float64Array(r);let a=0;for(let s=-t,i=0;s<=t;s++,i++){const o=Math.exp(-.5*s*s/(e*e));n[i]=o,a+=o}for(let s=0;s<r;s++)n[s]=n[s]/a;return n}function Or(e,t){if(t===1)return 0;const r=2*t;let n=(e%r+r)%r;return n>=t&&(n=r-1-n),n}const On=()=>new Promise(e=>{typeof setTimeout=="function"?setTimeout(e,0):Promise.resolve().then(e)}),or=64;async function lt(e,t,r,n,a,s){const i=new Float64Array(t*r);for(let u=0;u<r;u++){for(let c=0;c<t;c++){let f=0;for(let g=-a,p=0;g<=a;g++,p++)f+=n[p]*e[u*t+Or(c+g,t)];i[u*t+c]=f}(u+1)%or===0&&await s()}const o=new Float64Array(t*r);for(let u=0;u<r;u++){for(let c=0;c<t;c++){let f=0;for(let g=-a,p=0;g<=a;g++,p++)f+=n[p]*i[Or(u+g,r)*t+c];o[u*t+c]=f}(u+1)%or===0&&await s()}return o}async function ys(e,t,r,n,a=On){const s=r*n;if(s<=0)return NaN;const i=vs(ir,Oe),o=new Float64Array(s),u=new Float64Array(s),c=new Float64Array(s);for(let v=0;v<s;v++)o[v]=e[v]*e[v],u[v]=t[v]*t[v],c[v]=e[v]*t[v];const f=await lt(e,r,n,i,Oe,a),g=await lt(t,r,n,i,Oe,a),p=await lt(o,r,n,i,Oe,a),x=await lt(u,r,n,i,Oe,a),b=await lt(c,r,n,i,Oe,a),R=(kn*Ot)**2,A=(Gn*Ot)**2;let E=0;for(let v=0;v<s;v++){const l=p[v]-f[v]*f[v],h=x[v]-g[v]*g[v],w=b[v]-f[v]*g[v],y=2*f[v]*g[v]+R,S=2*w+A,G=f[v]*f[v]+g[v]*g[v]+R,O=l+h+A;E+=y*S/(G*O)}return E/s}const ws=`
fn ssim_srgb2linear(c: f32) -> f32 {
  if (c <= 0.04045) { return c / 12.92; }
  return pow((c + 0.055) / 1.055, 2.4);
}
fn ssim_luma(srgb: vec3<f32>) -> f32 {
  let lin = vec3<f32>(ssim_srgb2linear(srgb.r), ssim_srgb2linear(srgb.g), ssim_srgb2linear(srgb.b));
  return clamp(dot(lin, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
}
`,Ln=`
${ge}
${ws}
${qe}
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
`,Es=`
${Ln}
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let y = ssim_moment_luma(in);
  return vec4<f32>(y.x, y.y, y.x * y.x, y.y * y.y);
}
`,Rs=`
${Ln}
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let y = ssim_moment_luma(in);
  return vec4<f32>(y.x * y.y, 0.0, 0.0, 0.0);
}
`,Lr=`
${ge}
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
`,Ss=`
${ge}
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
`;function dt(e,t){return{binding:e,resource:{uniform:new Float32Array(t)}}}function Fr(e){const t=e.sourceMap,r=t?t.offsetA:{x:0,y:0},n=t?t.offsetB:{x:0,y:0},a=t!=null&&t.fill?1:0;return[dt(2,[r.x,r.y,n.x,n.y]),dt(3,[e.width,e.height,a,0])]}function Ur(e,t){const r=`${t}H`,n=`${t}V`;return{passes:[{name:r,shader:Lr,inputs:[e],output:r,uniforms:()=>[dt(1,[1,0,Oe,ir])]},{name:n,shader:Lr,inputs:[r],output:n,uniforms:()=>[dt(1,[0,1,Oe,ir])]}],out:n}}const _s={kind:"multipass",id:"ssim",label:"SSIM (1−SSIM)",publicName:"ssim",displayRange:"unit",output:"scalar",buildPasses(e){const t=(kn*Ot)**2,r=(Gn*Ot)**2,n=Ur("momA","statsA"),a=Ur("momB","statsB");return{passes:[{name:"momA",shader:Es,inputs:["srcA","srcB"],output:"momA",uniforms:Fr},{name:"momB",shader:Rs,inputs:["srcA","srcB"],output:"momB",uniforms:Fr},...n.passes,...a.passes,{name:"ssim",shader:Ss,inputs:[n.out,a.out],output:"ssim",uniforms:()=>[dt(2,[t,r,0,0])]}],final:"ssim"}}};let Ir=!1;function As(){Ir||(Ir=!0,Ee(ts),Ee(es),Ee(rs),Ee(as),Ee(ns),Ee(ss),Ee(gs),Ee(bs),Ee(hs),Ee(_s))}As();function Fn(){const e=[];for(const r of Ja())r.kind==="pointwise"&&e.push({id:r.id,label:r.label});e.push({id:"flip",label:"FLIP (perceptual)"}),e.push({id:"flip_ldr",label:"FLIP (LDR forced)"});const t=Fe("ssim");return t&&e.push({id:t.id,label:t.label}),e}function Ms(e,t){return e==="flip"?t?"hdr-flip":"flip":e==="flip_ldr"||e==="flip-ldr-forced"?t?"flip-ldr-forced":"flip":e}const Ps=128,Ts=512*1024*1024;class Ds{constructor(t=Ps,r=Ts){F(this,"map",new Map);F(this,"totalBytes",0);F(this,"maxEntries");F(this,"maxBytes");this.maxEntries=t,this.maxBytes=r}get(t){const r=this.map.get(t);return r&&(this.map.delete(t),this.map.set(t,r)),r}set(t,r){const n=this.map.get(t);n&&(this.totalBytes-=n.bytes,n.texture.destroy(),this.map.delete(t)),this.map.set(t,r),this.totalBytes+=r.bytes,this.evict()}accountReadbackBytes(t,r){let n=!1;for(const a of this.map.values())if(a===t){n=!0;break}n&&(t.bytes+=r,this.totalBytes+=r,this.evict())}evict(){for(;this.map.size>this.maxEntries||this.totalBytes>this.maxBytes;){const t=this.map.keys().next().value;if(t===void 0)break;const r=this.map.get(t);if(this.map.size===1)break;this.map.delete(t),this.totalBytes-=r.bytes,r.texture.destroy()}}clear(){for(const t of this.map.values())t.texture.destroy();this.map.clear(),this.totalBytes=0}get size(){return this.map.size}}const Nr=new WeakMap;function lr(e){let t=Nr.get(e);return t||(t=new Ds,Nr.set(e,t)),t}function Bs(e,t,r){const n=t*r;if(n<=0)return NaN;let a=0;for(let s=0;s<n;s++)a+=e[s*4]??0;return 1-a/n}function zr(e){return e==null||Number.isNaN(e)?"—":e.toFixed(4)}const Vr=new WeakMap;function Cs(e,t,r){let n=Vr.get(e);n||(n=new Map,Vr.set(e,n));const a=n.get(t);if(a)return a;const s=r().catch(i=>{throw n.get(t)===s&&n.delete(t),i});return n.set(t,s),s}const $r=new WeakMap;function cr(e,t,r,n){let a=$r.get(e);a||(a=new Map,$r.set(e,a));const s=`${t}::${n}`;let i=a.get(s);return i||(i=e.createRenderPipeline({shaderWGSL:r,targetFormat:n}),a.set(s,i)),i}function ks(e){return`
${ge}
${qe}
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
`}const _t="rgba16float";let Un=0;function Gs(){return Un}function Os(e,t,r,n,a,s){var A,E;const i=Fe(n);if(!i)throw new Error(`computeDiff: unknown diff kernel "${n}"`);const o=s??mt({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),u=o.result.w,c=o.result.h,f=o.fit==="fill"?1:0,g=_n(i,a);if(Un++,i.kind==="pointwise"){const v=e.createTexture(u,c,_t),l=cr(e,`pw:${i.id}`,ks(i.source),_t),h=new Float32Array([o.offsetA.x,o.offsetA.y,o.offsetB.x,o.offsetB.y]),w=new Float32Array([u,c,f,0]);let y;try{y=e.createBindGroup(l,[{binding:0,resource:t},{binding:1,resource:r},{binding:2,resource:{uniform:h}},{binding:3,resource:{uniform:w}}]),e.renderFullscreen(v,l,y)}finally{(A=y==null?void 0:y.destroy)==null||A.call(y)}return v}const p={width:u,height:c,params:g,sourceMap:{fill:o.fit==="fill",offsetA:o.offsetA,offsetB:o.offsetB}},x=i.buildPasses(p),b=new Map([["srcA",t],["srcB",r]]),R=[];try{for(const l of x.passes){const h=e.createTexture(u,c,_t);R.push(h),b.set(l.output,h);const w=cr(e,`mp:${i.id}:${l.name}`,l.shader,_t),y=l.inputs.map((G,O)=>{const B=b.get(G);if(!B)throw new Error(`computeDiff: pass "${l.name}" input "${G}" not produced yet`);return{binding:O,resource:B}});l.uniforms&&y.push(...l.uniforms(p));let S;try{S=e.createBindGroup(w,y),e.renderFullscreen(h,w,S)}finally{(E=S==null?void 0:S.destroy)==null||E.call(S)}}const v=b.get(x.final);if(!v)throw new Error(`computeDiff: final ref "${x.final}" not produced`);for(const l of R)l!==v&&l.destroy();return v}catch(v){for(const l of R)l.destroy();throw v}}function Ls(e,t){const r=_n(e,t);return Object.keys(r).sort().map(a=>`${a}=${r[a]}`).join(",")}function Fs(e,t,r,n,a){const s=Fe(r),i=s?Ls(s,n):"",o=a?ur(a):"";return`${e}|${t}|${r}|${i}|${o}`}function In(e,t,r,n,a,s,i,o){const u=Fe(n);if(!u)throw new Error(`ensureDiff: unknown diff kernel "${n}"`);const c=lr(e),f=o??mt({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),g=Fs(s,i,n,a,f),p=c.get(g);if(p)return p;const x=Os(e,t,r,n,a,f),b=f.result.w,R=f.result.h,A={texture:x,width:b,height:R,displayRange:u.displayRange,bytes:b*R*8};return c.set(g,A),A}function Us(e,t,r){return`${e}|${t}|${r?ur(r):""}`}function Is(e,t,r,n,a,s){return Cs(e,Us(n,a,s),()=>Ns(e,t,r,n,a,s))}async function Ns(e,t,r,n,a,s){try{const i=In(e,t,r,"ssim",void 0,n,a,s);return i.ssimMean!==void 0?i.ssimMean:(i.ssimMeanPending||(i.ssimMeanPending=Nn(e,i).then(o=>{const u=Bs(o,i.width,i.height);return i.ssimMean=u,u})),await i.ssimMeanPending)}catch{return zs(e,t,r,s)}}async function zs(e,t,r,n){const a=n??mt({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),s=a.result.w,i=a.result.h,o=s*i;if(o<=0)return NaN;const u=await e.readback(t),c=await e.readback(r),f=u instanceof Uint8Array?255:1,g=c instanceof Uint8Array?255:1,p=a.fit==="fill",x=Pt(u,t.width,t.height,f,a.offsetA,p,s,i),b=Pt(c,r.width,r.height,g,a.offsetB,p,s,i),R=new Float64Array(o),A=new Float64Array(o),E=[0,0,0],v=[0,0,0];for(let l=0;l<i;l++){for(let h=0;h<s;h++){x(h,l,E),b(h,l,v);const w=l*s+h;R[w]=Gr(E[0],E[1],E[2]),A[w]=Gr(v[0],v[1],v[2])}(l+1)%or===0&&await On()}return ys(R,A,s,i)}async function Vs(e,t,r,n,a){return t.scalars?t.scalars:(t.scalarsPending||(t.scalarsPending=hn(e,r,n,a).then(s=>(t.scalars=s,s))),t.scalarsPending)}async function Nn(e,t){return t.resultSamples?t.resultSamples:(t.resultSamplesPending||(t.resultSamplesPending=e.readback(t.texture).then(r=>{const n=r instanceof Float32Array?r:Float32Array.from(r);return t.resultSamples=n,lr(e).accountReadbackBytes(t,n.byteLength),n})),t.resultSamplesPending)}function $s(e){return lr(e).size}const Hs=`
${ge}
${qe}
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
    outColor = sampleLUT(lut, idx);
  } else {
    outColor = disp;
  }
  return vec4<f32>(outColor, 1.0);
}
`,Ws={unit:0,signed:1,relative:2},Ks={linear:0,signed:1,positive:2};function qs(e,t){if(t){if(t.length!==256*4)throw new Error(`renderDiffDisplay: colormap must be 256*4 floats, got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function Xs(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Ys(e,t,r,n,a){var x,b,R;const s=Xs(t),i=cr(e,"diff-display",Hs,s),o=qs(e,a.colormap),u=new Float32Array([a.uv.x,a.uv.y,a.uv.w,a.uv.h]),c=new Float32Array([Ws[n],Ks[a.cmapMode??"positive"],a.colormap?1:0,a.filter==="nearest"?0:1]),f=new Float32Array([a.exposureEV??0,a.offset??0,0,0]),g=new Float32Array([((x=a.sourceDims)==null?void 0:x.w)??0,((b=a.sourceDims)==null?void 0:b.h)??0,0,0]);let p;try{p=e.createBindGroup(i,[{binding:0,resource:r},{binding:1,resource:o},{binding:2,resource:{uniform:u}},{binding:3,resource:{uniform:c}},{binding:4,resource:{uniform:f}},{binding:5,resource:{uniform:g}}]),e.renderFullscreen(t,i,p)}finally{(R=p==null?void 0:p.destroy)==null||R.call(p),o.destroy()}}const Hr=.6*.6*2.51,js=.6*.03,Zs=0,Wr=.6*.6*2.43,Qs=.6*.59,Js=.14;function Kr(e){const t=(js-Qs*e)/(Hr-Wr*e),r=(Zs-Js*e)/(Hr-Wr*e);return-.5*t+Math.sqrt((.5*t)**2-r)}const ei=.85,ti=.85,qr=11920928955078125e-23,er=[.2126,.7152,.0722];function ri(e,t,r){const n=t*r;if(r===1){const a=e[n];return[a,a,a]}return[e[n],e[n+1],e[n+2]]}function ni(e,t,r,n=3,a={}){const s=t*r,i=Kr(ei),o=Kr(ti),u=new Float64Array(s);let c=0;for(let v=0;v<s;v++){const[l,h,w]=ri(e,v,n),y=l*er[0]+h*er[1]+w*er[2];u[v]=y,y>c&&(c=y)}const f=Float64Array.from(u).sort(),g=s>>1,p=s%2===1?f[g]:f[g-1],x=Math.max(p,qr),b=Math.max(c,qr),R=a.startExposure??Math.log2(i/b),A=a.stopExposure??Math.log2(o/x),E=Math.max(2,Math.ceil(A-R));return{startExposure:R,stopExposure:A,numExposures:E}}function ai(e){const t=fa(e),r=new Float32Array(256*4);for(let n=0;n<256;n++)r[n*4+0]=t[n*3+0]/255,r[n*4+1]=t[n*3+1]/255,r[n*4+2]=t[n*3+2]/255,r[n*4+3]=1;return r}function si(e){const{width:t,height:r,channels:n}=e,a=t*r;if(e.precision==="f16-bits"){const u=e.data,c=new Uint16Array(a*4);for(let f=0;f<a;f++){const g=f*n,p=f*4;if(n===1){const x=u[g];c[p]=x,c[p+1]=x,c[p+2]=x,c[p+3]=At}else c[p]=u[g],c[p+1]=u[g+1],c[p+2]=u[g+2],c[p+3]=n>=4?u[g+3]:At}return{data:c,format:"rgba16float"}}const s=e.data,i=new Float32Array(a*4),o=u=>Number.isFinite(u)?u:0;for(let u=0;u<a;u++){const c=u*n;let f,g,p,x=1;n===1?f=g=p=o(s[c]):n===3?(f=o(s[c]),g=o(s[c+1]),p=o(s[c+2])):(f=o(s[c]),g=o(s[c+1]),p=o(s[c+2]),x=o(s[c+3]));const b=u*4;i[b]=f,i[b+1]=g,i[b+2]=p,i[b+3]=x}return{data:i,format:"rgba32float"}}function ii({imageUrl:e,baselineUrl:t,imageFloat:r,baselineFloat:n,mode:a,splitPosition:s,blendAlpha:i,onSplitPositionChange:o,diffSubmode:u,colormap:c="none",align:f="top-left",fit:g="crop",diffKernel:p,onDiffKernelChange:x,onCompareModeChange:b,onRequestSide:R,zoom:A,pan:E,onViewportChange:v,interpolation:l="auto",label:h="",pixelValueNotation:w="decimal",tonemap:y,peak:S,gamma:G,toolbar:O=!0}){var hr;const B=d.useRef(null),C=d.useRef(null),K=d.useRef(null),U=d.useRef(null),X=d.useRef(null),[te,ue]=d.useState(!1),[j,J]=d.useState(!1),H=d.useRef(!1),[se,ee]=d.useState(!1),[oe,Se]=d.useState(null),[ne,Ie]=d.useState(null),[_e,It]=d.useState({a:!1,b:!1}),[Xe,Ye]=d.useState(0),[gt,nt]=d.useState(0),[Te,at]=d.useState(null),[le,De]=d.useState(null),[Ne,ht]=d.useState({x:0,y:0,w:1,h:1}),Be=p??u??"absolute",[ve,he,st]=Le(Be);d.useEffect(()=>{he(p??u??"absolute")},[p,u,he]);const ye=d.useCallback(m=>{he(m),x==null||x(m)},[x,he]);d.useEffect(()=>{const m=B.current;if(m)return m.__cairnDiffKernel={current:ve,set:ye},()=>{m&&delete m.__cairnDiffKernel}},[ve,ye]);const[Y,ze,Ae]=Le(a);d.useEffect(()=>{ze(a)},[a,ze]);const xe=d.useCallback(m=>{ze(m),b==null||b(m)},[b,ze]),[be,Ce,je]=Le(c);d.useEffect(()=>{Ce(c)},[c,Ce]);const[Ze,it]=d.useState(null);d.useEffect(()=>{it(null)},[y]);const Ve=un(y),fe=Ze??Ve,Nt=Ze!==null&&Ze!==Ve,xt=()=>S!=null&&S>0?S:ln(y)??Lt,[ot,ct,Qe]=Le(xt()),[Je,M,k]=Le(G&&G>0?G:Xr);d.useEffect(()=>{ct(xt())},[S,y]),d.useEffect(()=>{G&&G>0&&M(G)},[G,M]);const V=d.useCallback(()=>{xe(Ae.default),Ce(je.default),ye(st.default),it(null),Qe.reset(),k.reset()},[xe,Ce,ye,Ae.default,je.default,st.default,Qe,k]),D=Ae.isModified||je.isModified||st.isModified||Nt||Qe.isModified||k.isModified,[I,z]=d.useState(0),[re,ie]=d.useState(0),de=d.useMemo(()=>{const T=[da({mode:Y,kernel:ve,kernelOptions:Fn().map(_=>({id:_.id,label:_.label})),onSide:R,onSlide:()=>xe("split"),onBlend:()=>xe("blend"),onKernel:_=>{xe("diff"),ye(_)}})];return Y==="diff"?T.push(nr(be,_=>Ce(_))):T.push(rr(fe,_=>it(_))),T},[Y,ve,be,fe,ye,xe,R]),W=d.useRef(null),we=d.useRef(null),$e=d.useRef(null),He=d.useRef(null),[et,We]=d.useState(0),Ke=d.useRef(null),Me=d.useRef(null),[zn,fr]=d.useState(0),zt=Yr();d.useEffect(()=>{const m=K.current;if(!m)return;let T=!1;return Ft().then(_=>{var P;if(!T)try{if(xn())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const L=((P=_.probeExtendedToneMapping)==null?void 0:P.call(_))??!1,N=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,q=L&&N;H.current=q,ee(q);const Z=_.createSurface(m,{hdr:q});U.current={device:_,surface:Z,texA:null,texB:null},J(!0)}catch(L){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",L),ue(!0)}}).catch(_=>{T||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",_),ue(!0))}),()=>{var P,L;T=!0;const _=U.current;_&&((P=_.texA)==null||P.destroy(),(L=_.texB)==null||L.destroy(),U.current=null)}},[]),d.useEffect(()=>{const m=B.current;if(!m)return;const T=new ResizeObserver(()=>nt(_=>_+1));return T.observe(m),()=>T.disconnect()},[]),d.useEffect(()=>{if(!j)return;let m=!1;if(!U.current)return;async function _(P,L){if(L){const q=si(L);return{width:L.width,height:L.height,imageData:null,make:Z=>{const $=Z.createTexture(L.width,L.height,q.format);return $.write(q.data),$}}}if(!P)return null;const N=await jr(P);return N?{width:N.width,height:N.height,imageData:N,make:q=>{const Z=q.createTexture(N.width,N.height,"rgba8unorm");return Z.write(N.data),Z}}:null}return Promise.all([_(e,r),_(t,n)]).then(([P,L])=>{var ae,me;if(m||!U.current)return;const N=U.current;W.current=(P==null?void 0:P.imageData)??null,we.current=(L==null?void 0:L.imageData)??null,$e.current=r??null,He.current=n??null,(ae=N.texA)==null||ae.destroy(),(me=N.texB)==null||me.destroy(),N.texA=null,N.texB=null;const q=P??L;if(!q){Se(null),Ie(null),We(ke=>ke+1);return}const Z=L??q,$=P??q;N.texA=Z.make(N.device),N.texB=$.make(N.device),Ie({a:{w:Z.width,h:Z.height},b:{w:$.width,h:$.height}}),It({a:Z.imageData!=null,b:$.imageData!=null}),Se({w:q.width,h:q.height}),We(ke=>ke+1),Ye(ke=>ke+1)}),()=>{m=!0}},[j,e,t,r,n]);const bt=r!=null||n!=null,pe=d.useMemo(()=>Ms(ve,bt),[ve,bt]),ut=d.useMemo(()=>{if(!bt)return null;const m=n??r;if(!m)return null;const T=m.precision==="f16-bits"?aa(m.data):m.data;return ni(T,m.width,m.height,m.channels)},[bt,n,r]),dr=d.useMemo(()=>{var m;return sa(((m=Fe(pe))==null?void 0:m.displayRange)??"unit",be==="none"?null:be)},[pe,be]),pr=d.useMemo(()=>be!=="none"?ai(be):void 0,[be]),Pe=d.useMemo(()=>ne?mt(ne.a,ne.b,f,g,"b"):null,[ne,f,g]),Vn=d.useMemo(()=>Pe?ur(Pe):"none",[Pe]),vt=(n==null?void 0:n.contentKey)??t??(r==null?void 0:r.contentKey)??e??"none",yt=(r==null?void 0:r.contentKey)??e??(n==null?void 0:n.contentKey)??t??"none",ce=oe,Vt=d.useCallback(()=>{const m=U.current;if(!j||!m||!m.surface||!m.texA||!m.texB||!oe)return;const T=ce??oe,_=B.current,P=_?_.getBoundingClientRect():{width:T.w,height:T.h},L=Rn({zoom:A,pan:E},P,T.w,T.h);ht($=>$.x===L.x&&$.y===L.y&&$.w===L.w&&$.h===L.h?$:L);const N=K.current;if(P.width>0&&P.height>0&&N&&m.surface){const $=Math.max(1,Math.round(P.width*zt)),ae=Math.max(1,Math.round(P.height*zt));(N.width!==$||N.height!==ae)&&(N.width=$,N.height=ae,m.surface.configure($,ae))}const q=Sn(L,P,T.w,T.h)>=Zr?"nearest":"linear",Z=L;try{if(Y==="diff"){const $=Fe(pe)?pe:"absolute",ae=$==="hdr-flip"&&ut?{ppd:67,startExposure:ut.startExposure,stopExposure:ut.stopExposure,numExposures:ut.numExposures}:void 0,me=In(m.device,m.texA,m.texB,$,ae,vt,yt,Pe??void 0);X.current=me,Ys(m.device,m.surface,me.texture,me.displayRange,{uv:Z,cmapMode:dr,colormap:pr,filter:q,sourceDims:T,exposureEV:I,offset:re})}else{const $=Qr(fe,H.current?ot:1,H.current,Je),ae={exposureEV:I,offset:re,operator:$.operator,gamma:$.gamma,isScalar:!1,hdrOut:$.hdrOut,peak:$.peak,srgbDecodeA:_e.a,srgbDecodeB:_e.b,uv:Z,filter:q,mode:Y,split:s,alpha:i};Fa(m.device,m.surface,m.texA,m.texB,ae)}}catch($){console.warn("cairn-plot: GpuComparePane render failed, falling back to legacy pane",$),ue(!0)}},[j,oe,ce,Pe,A,E.x,E.y,Y,s,i,I,re,fe,ot,Je,_e,ve,pe,ut,dr,pr,e,t,r,n,vt,yt,zt]);d.useEffect(()=>{Vt()},[Vt,Xe,gt]);const tt=t!=null||n!=null;d.useEffect(()=>{const m=U.current;if(!j||!m||!m.texA||!m.texB||!tt){at(null);return}let T=!1;const _=m.texA,P=m.texB,L=X.current,N=Y==="diff"?Pe??void 0:void 0;return(Y==="diff"&&L?Vs(m.device,L,_,P,N):hn(m.device,_,P,N)).then(Z=>{T||at(Z)}),()=>{T=!0}},[j,Xe,tt,Y,ve,Pe]),d.useEffect(()=>{const m=U.current;if(!j||!m||!m.texA||!m.texB||!tt){De(null);return}let T=!1;De(null);const _=Y==="diff"?Pe??void 0:void 0;return Is(m.device,m.texA,m.texB,vt,yt,_).then(P=>{T||De(P)}).catch(()=>{T||De(null)}),()=>{T=!0}},[j,Xe,tt,Y,Vn,vt,yt]),d.useEffect(()=>{if(Y!=="diff"){Ke.current=null,Me.current=null;return}const m=U.current,T=X.current;if(!j||!m||!T)return;let _=!1;return Ke.current=null,Me.current=null,fr(P=>P+1),Nn(m.device,T).then(P=>{_||(Ke.current=P,Me.current={w:T.width,h:T.height},fr(L=>L+1))}).catch(()=>{}),()=>{_=!0}},[j,Y,pe,Xe,Pe]);const mr=(m,T)=>(_,P,L)=>{const N=T.current;if(N){const{data:ke,width:xr,height:Kn,channels:br}=N;if(_<0||P<0||_>=xr||P>=Kn)return null;const Et=(P*xr+_)*br,Rt=N.precision==="f16-bits"?Wt=>Jr(ke[Wt]??0):Wt=>ke[Wt]??0,qn=br===1?[Rt(Et)]:[Rt(Et),Rt(Et+1),Rt(Et+2)];return ft(qn,"unit",L)}const q=m.current;if(!q||_<0||P<0||_>=q.width||P>=q.height)return null;const Z=(P*q.width+_)*4,$=q.data[Z],ae=q.data[Z+1],me=q.data[Z+2];return ft($===ae&&ae===me?[$]:[$,ae,me],"uint8",L)},wt=d.useMemo(()=>mr(W,$e),[]),$t=d.useMemo(()=>mr(we,He),[]),Ht=d.useMemo(()=>(m,T,_)=>{var me;const P=Ke.current,L=Me.current;if(!P||!L)return null;const{w:N,h:q}=L;if(m<0||T<0||m>=N||T>=q)return null;const Z=(T*N+m)*4,ae=(((me=Fe(pe))==null?void 0:me.output)??"per-channel")==="scalar"?[P[Z]??0]:[P[Z]??0,P[Z+1]??0,P[Z+2]??0];return ft(ae,"unit",_)},[pe]);d.useEffect(()=>{const m=B.current;if(m)return m.__cairnCompareProbe={sampleDiff:(T,_,P="decimal")=>Ht(T,_,P),sampleFg:(T,_,P="decimal")=>wt(T,_,P),sampleRef:(T,_,P="decimal")=>$t(T,_,P),get diffSamples(){return Ke.current},get dims(){return ce},get primaryDims(){return oe},get diffResultDims(){return Me.current},get align(){return f},get fit(){return g},get resolvedKernelId(){return pe},get compareMode(){return Y},computeCount:()=>Gs(),cacheSize:()=>U.current?$s(U.current.device):0,get ssimScalar(){return le},get ssimText(){return zr(le)},get effectiveTonemap(){return fe},get hdrEngaged(){return se}},()=>{m&&delete m.__cairnCompareProbe}},[Ht,wt,$t,oe,ce,f,g,pe,Y,le,fe,se]);const $n=l==="auto"?void 0:l;if(te)return r!=null||n!=null?Q.jsx(ia,{}):Y==="diff"?Q.jsx(tr,{toolbar:O,imageUrl:e,baselineUrl:t,diffMode:((hr=Fe(pe))==null?void 0:hr.kind)==="pointwise"?pe:"absolute",interpolation:l,colormap:be,showAxes:!1,zoom:A,pan:E,onViewportChange:v,label:h,pixelValueNotation:w}):Q.jsx(oa,{imageUrl:e,baselineUrl:t,mode:Y,splitPosition:s,blendAlpha:i,onSplitPositionChange:o,zoom:A,pan:E,onViewportChange:v,interpolation:l,label:h,pixelValueNotation:w});const Hn=Q.jsxs(Q.Fragment,{children:[Q.jsx("canvas",{ref:K,className:"w-full h-full block",style:{imageRendering:$n},"data-gpu-compare-canvas":!0}),Y==="split"&&Q.jsx(la,{splitPosition:s,onChange:o,onReset:()=>o==null?void 0:o(.5)})]}),gr=!!h,Wn=gr?"bottom-7":"bottom-1";return Q.jsx(en,{paneAttrs:{"data-gpu-compare-pane":"","data-gpu-compare-ready":j},viewportAttrs:{"data-gpu-compare-viewport":""},toolbar:O,paneRef:B,wrapperRef:C,zoom:A,pan:E,onViewportChange:v,naturalDims:ce,checkerboard:"pane",wrapperClassName:"relative w-full h-full flex items-center justify-center",viewportPadding:0,surface:Hn,showAxes:!1,notationSeed:w,onReset:V,extraModified:D,exportCanvasRef:K,requestRender:Vt,leadingMenus:de,displayAdjust:{exposureEV:I,offset:re,onExposureChange:z,onOffsetChange:ie},extraSliders:[...se&&Y!=="diff"?[{id:"peak",label:"PK",title:"Peak white (×SDR white) — the HDR ceiling P every operator clips at (Linear/sRGB/Gamma hard-clip at P; Reinhard/ACES roll off toward P). P=1 reproduces the SDR rendition exactly; double-click to type a value, including 'inf' for the raw browser-clipped extended look.",min:nn,max:rn,step:tn,value:ot,onChange:ct,format:m=>Number.isFinite(m)?`${m.toFixed(1)}×`:"∞"}]:[],...Y!=="diff"&&cn(fe)?[{id:"gamma",label:"γ",title:"Display gamma γ for the Gamma transfer — display = clamp(value)^(1/γ), tev-style. Default 2.2 (close to sRGB, not identical). Double-click to type a value.",min:on,max:sn,step:an,value:Je,onChange:M,format:m=>m.toFixed(1)}]:[]],label:"",showLabelChip:!1,overlay:{render:({notation:m,setOverlayActive:T})=>Y==="split"?Q.jsxs(Q.Fragment,{children:[tt&&ce&&Q.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-s)*100}% 0 0)`},children:Q.jsx(Kt,{imageElRef:K,naturalWidth:ce.w,naturalHeight:ce.h,zoom:A,pan:E,sourceWindow:Ne,sample:$t,notation:m,version:et})}),tt&&ce&&Q.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${s*100}%)`},children:Q.jsx(Kt,{imageElRef:K,naturalWidth:ce.w,naturalHeight:ce.h,zoom:A,pan:E,sourceWindow:Ne,sample:wt,notation:m,version:et,onActiveChange:T})})]}):ce&&Q.jsx(Kt,{imageElRef:K,naturalWidth:ce.w,naturalHeight:ce.h,zoom:A,pan:E,sourceWindow:Ne,sample:Y==="diff"?Ht:wt,notation:m,version:Y==="diff"?zn:et,onActiveChange:T})},extraChips:Q.jsxs(Q.Fragment,{children:[Y==="split"&&Q.jsx(ca,{}),gr?Q.jsx(ua,{label:h,corner:"bottom-right"}):null,Te&&Q.jsxs("span",{className:`absolute right-1 z-30 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${Wn}`,"data-gpu-compare-metrics":!0,children:["MSE ",Te.mse.toExponential(2)," · PSNR ",Number.isFinite(Te.psnr)?Te.psnr.toFixed(1):"∞"," dB · MAE"," ",Te.mae.toExponential(2)," · SSIM ",zr(le)]})]})})}const oi="cairn-plot:gpu-image-ready";async function ci(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Ft(),window.__cairnPlotGpuImagePane=Qa,window.__cairnPlotGpuComparePane=ii,window.__cairnPlotDiffMenuModes=Fn(),window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(oi))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e),En("no-webgpu")}}}ci();

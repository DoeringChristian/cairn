var gn=Object.defineProperty;var hn=(e,t,r)=>t in e?gn(e,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):e[t]=r;var U=(e,t,r)=>hn(e,typeof t!="symbol"?t+"":t,r);import{a4 as Br,a5 as xn,r as p,a6 as bn,a7 as ze,a8 as vn,a9 as yn,aa as Dr,ab as Cr,ac as wn,ad as Rn,ae as En,af as _n,ag as Lr,ah as Sn,y as Gr,ai as at,j as Z,a1 as zt,aj as An,ak as kr,al as Mn,am as Pn,an as Tn,ao as Bn,ap as Dn,aq as Cn,ar as er,as as Ln,at as $t,au as Gn,av as kn,aw as On,ax as Fn,ay as Un,az as bt,aA as Ge,X as In,aB as Nn,aC as Vn,aD as zn,aE as $n,aF as Wn,aG as Lt,aH as Hn,d as Kn}from"./parse-overlay-wXHWgA_X.js";import{b as qn}from"./compare-mode-menu-DG9F3B3b.js";const Wt=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function Or(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"premultiplied",usage:Wt}),{hdr:!1,format:r}}function Yn(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:Wt}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:Wt}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return Or(e,t)}}}const Xn=`
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
`,jn=`
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
`;class Zn extends Error{constructor(r){super(r);U(this,"deviceLost",!0);this.name="DeviceLostError"}}async function tr(e,t){try{await e.mapAsync(GPUMapMode.READ)}catch(r){if((r instanceof Error?r.name:"")==="AbortError"){const a=t.info;throw new Zn("webgpu readback: buffer map aborted — device lost or destroyed mid-readback"+(a?` (reason=${String(a.reason)}${a.message?`: ${a.message}`:""})`:"")+`: ${r instanceof Error?r.message:String(r)}`)}throw r instanceof Error?r:new Error(String(r))}}function Ht(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Fr(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Qn(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let a;return r===0?a=n/1024*Math.pow(2,-14):r===31?a=n?NaN:1/0:a=(1+n/1024)*Math.pow(2,r-15),t?-a:a}const Jn={texture:0,sampler:1,uniform:2};function Gt(e,t){return e*3+Jn[t]}const ea={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function ta(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const a=Number(n[1]),s=n[2]!==void 0,i=n[3].trim();if(s){const o=ea[i];if(o===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${i}" (binding ${a}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(a,{kind:"uniform",sizeBytes:o})}else i==="sampler"||i==="sampler_comparison"?t.set(a,{kind:"sampler"}):t.set(a,{kind:"texture"})}return t}class rr{constructor(t,r,n,a){U(this,"width");U(this,"height");U(this,"format");U(this,"gpuTexture");U(this,"device");U(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=a,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:Ht(a),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*Fr(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class nr{constructor(t){U(this,"_s");U(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class ra{constructor(t,r,n,a,s){U(this,"_p");U(this,"gpuPipeline");U(this,"bindings");U(this,"bindGroupLayout");U(this,"variants");U(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=s,this.variants=new Map([[a,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function na(e,t){const r=[];for(const[n,a]of t)a.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):a.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class aa{constructor(t){U(this,"_c");U(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class sa{constructor(t,r,n,a,s){U(this,"width");U(this,"height");U(this,"paramsBuffer");U(this,"bindGroup");U(this,"buffers");U(this,"destroyed",!1);this.width=t,this.height=r,this.buffers=n,this.paramsBuffer=a,this.bindGroup=s}destroy(){if(!this.destroyed){for(const t of this.buffers)t.destroy();this.paramsBuffer.destroy(),this.destroyed=!0}}}class ia{constructor(t,r){U(this,"_b");U(this,"gpuBindGroup");U(this,"ownedBuffers");U(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class oa{constructor(t,r,n,a){U(this,"canvas");U(this,"hdr");U(this,"format");U(this,"context");U(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=a}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function ht(e){return"canvas"in e}async function ca(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function a(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function s(l){return ht(l)?l.getCurrentTextureView():l.gpuTexture.createView()}function i(l){if(ht(l))return{width:l.canvas.width,height:l.canvas.height};const h=l;return{width:h.width,height:h.height}}let o=!1;const u={};t.lost.then(l=>{u.info=l},()=>{});let c=null;function f(){var h,w;if(c!==null)return c;let l=!1;try{if(typeof document<"u"){const y=document.createElement("canvas");y.width=1,y.height=1;const M=y.getContext("webgpu");if(M)try{M.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:GPUTextureUsage.RENDER_ATTACHMENT});const k=(h=M.getConfiguration)==null?void 0:h.call(M);l=((w=k==null?void 0:k.toneMapping)==null?void 0:w.mode)==="extended"}catch{l=!1}finally{try{M.unconfigure()}catch{}}}}catch{l=!1}return c=l,l}const m=256;let d=null,x=null;function b(){if(!d||!x){const l=t.createShaderModule({code:Xn});x=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const h=t.createPipelineLayout({bindGroupLayouts:[x]});d=t.createComputePipeline({layout:h,compute:{module:l,entryPoint:"cs_main"}})}return{pipeline:d,layout:x}}let E=null,A=null;function R(){if(!E||!A){const l=t.createShaderModule({code:jn});A=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const h=t.createPipelineLayout({bindGroupLayouts:[A]});E=t.createRenderPipeline({layout:h,vertex:{module:l,entryPoint:"vs_main"},fragment:{module:l,entryPoint:"fs_main",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}})}return{pipeline:E,layout:A}}return{backend:"webgpu",capabilities:r,probeExtendedToneMapping:f,createTexture(l,h,w){return new rr(t,l,h,w)},createSampler(l){const h=(l==null?void 0:l.filter)==="linear"?"linear":"nearest",w=t.createSampler({magFilter:h,minFilter:h,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new nr(w)},createRenderPipeline(l){const h=t.createShaderModule({code:l.shaderWGSL}),w=ta(l.shaderWGSL),y=Ht(l.targetFormat),M=na(t,w),k=t.createPipelineLayout({bindGroupLayouts:[M]}),P=L=>t.createRenderPipeline({layout:k,vertex:{module:h,entryPoint:"vs_main"},fragment:{module:h,entryPoint:"fs_main",targets:[{format:L}]},primitive:{topology:"triangle-list"}}),C=P(y);return new ra(C,w,M,y,P)},createComputePipeline(l){const h=t.createShaderModule({code:l.shaderWGSL}),w=t.createComputePipeline({layout:"auto",compute:{module:h,entryPoint:"cs_main"}});return new aa(w)},createBindGroup(l,h){const w=l,y=new Map,M=[];for(const[P,C]of w.bindings)if(C.kind==="uniform"){const L=t.createBuffer({size:C.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});M.push(L),y.set(P,{binding:P,resource:{buffer:L}})}else C.kind==="sampler"&&y.set(P,{binding:P,resource:a()});for(const P of h){const C=P.resource;if(C instanceof rr){const L=Gt(P.binding,"texture");w.bindings.has(L)&&y.set(L,{binding:L,resource:C.gpuTexture.createView()})}else if(C instanceof nr){const L=Gt(P.binding,"sampler");w.bindings.has(L)&&y.set(L,{binding:L,resource:C.gpuSampler})}else{const L=Gt(P.binding,"uniform"),Q=w.bindings.get(L);if(Q&&Q.kind==="uniform"){const I=C.uniform,Y=t.createBuffer({size:Math.max(Q.sizeBytes,I.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(Y,0,I.buffer,I.byteOffset,I.byteLength),M.push(Y),y.set(L,{binding:L,resource:{buffer:Y}})}}}const k=t.createBindGroup({layout:w.bindGroupLayout,entries:Array.from(y.values())});return new ia(k,M)},createSurface(l,h){const w=l.getContext("webgpu");if(!w)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const y=h.hdr&&r.hdr,M=()=>y?Yn(w,t):Or(w,t),k=M();return new oa(l,w,k,M)},renderFullscreen(l,h,w){const y=h,M=w,k=s(l),{width:P,height:C}=i(l),L=ht(l)?l.format:Ht(l.format),Q=y.pipelineFor(L),I=t.createCommandEncoder(),Y=I.beginRenderPass({colorAttachments:[{view:k,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});Y.setPipeline(Q),Y.setBindGroup(0,M.gpuBindGroup),Y.setViewport(0,0,P,C,0,1),Y.draw(3),Y.end(),t.queue.submit([I.finish()])},createDeepSampleBuffers(l){const{layout:h}=R(),w=L=>{const Q=t.createBuffer({size:L.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(Q,0,L.buffer,L.byteOffset,L.byteLength),Q},y=w(l.offsets),M=w(l.colors),k=w(l.zs),P=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),C=t.createBindGroup({layout:h,entries:[{binding:0,resource:{buffer:y}},{binding:1,resource:{buffer:M}},{binding:2,resource:{buffer:k}},{binding:3,resource:{buffer:P}}]});return new sa(l.width,l.height,[y,M,k],P,C)},compositeDeep(l,h,w,y){const M=l,k=h,{pipeline:P}=R();t.queue.writeBuffer(M.paramsBuffer,0,new Float32Array([M.width,M.height,y,w]));const C=t.createCommandEncoder(),L=C.beginRenderPass({colorAttachments:[{view:k.gpuTexture.createView(),loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});L.setPipeline(P),L.setBindGroup(0,M.bindGroup),L.setViewport(0,0,k.width,k.height,0,1),L.draw(3),L.end(),t.queue.submit([C.finish()])},async readback(l){const h=ht(l),{width:w,height:y}=i(l),M=h?l.hdr?"rgba16float":"rgba8unorm":l.format,k=h&&l.format==="bgra8unorm",P=h?l.getCurrentGPUTexture():l.gpuTexture,C=Fr(M),L=w*C,Q=256,I=Math.ceil(L/Q)*Q,Y=I*y,X=t.createBuffer({size:Y,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),ce=t.createCommandEncoder();ce.copyTextureToBuffer({texture:P},{buffer:X,bytesPerRow:I,rowsPerImage:y},{width:w,height:y,depthOrArrayLayers:1}),t.queue.submit([ce.finish()]);try{await tr(X,u)}catch($){try{X.destroy()}catch{}throw $}const re=new Uint8Array(X.getMappedRange()),j=new Uint8Array(L*y);for(let $=0;$<y;$++){const ne=$*I,ae=$*L;j.set(re.subarray(ne,ne+L),ae)}if(X.unmap(),X.destroy(),M==="rgba8unorm"){if(k)for(let $=0;$<j.length;$+=4){const ne=j[$],ae=j[$+2];j[$]=ae,j[$+2]=ne}return j}if(M==="rgba16float"){const $=new Uint16Array(j.buffer,j.byteOffset,j.byteLength/2),ne=new Float32Array($.length);for(let ae=0;ae<$.length;ae++)ne[ae]=Qn($[ae]);return ne}return new Float32Array(j.buffer,j.byteOffset,j.byteLength/4)},async reduceDiffSumSquaredAbs(l,h,w,y){const M=l,k=h,P=Math.max(0,w*y),C=Math.max(1,Math.ceil(P/m)),{pipeline:L,layout:Q}=b(),I=C*2*4,Y=t.createBuffer({size:I,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),X=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(X,0,new Uint32Array([Math.max(1,w),Math.max(1,y),P,0]));const ce=t.createBindGroup({layout:Q,entries:[{binding:0,resource:M.gpuTexture.createView()},{binding:1,resource:k.gpuTexture.createView()},{binding:2,resource:{buffer:Y}},{binding:3,resource:{buffer:X}}]}),re=t.createBuffer({size:I,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),j=t.createCommandEncoder(),$=j.beginComputePass();$.setPipeline(L),$.setBindGroup(0,ce),$.dispatchWorkgroups(C),$.end(),j.copyBufferToBuffer(Y,0,re,0,I),t.queue.submit([j.finish()]);try{await tr(re,u)}catch(le){for(const he of[re,Y,X])try{he.destroy()}catch{}throw le}const ae=new Float32Array(re.getMappedRange()).slice();re.unmap(),re.destroy(),Y.destroy(),X.destroy();let Me=0,ue=0;for(let le=0;le<C;le++)Me+=ae[le*2],ue+=ae[le*2+1];return{sumSq:Me,sumAbs:ue}},destroy(){o||(t.destroy(),o=!0)},isContextLost(){return!1}}}let kt=null;async function ua(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return ca()}function Mt(){return kt||(kt=ua()),kt}const la=`
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

// Nearest-texelFetch LUT lookup, round-half-up index (see image.wgsl.ts).
fn sampleLUT(lut: texture_2d<f32>, valueUnit: f32) -> vec3<f32> {
  let idxF = clamp(valueUnit, 0.0, 1.0) * 255.0;
  let idx = clamp(i32(floor(idxF + 0.5)), 0, 255);
  return textureLoad(lut, vec2<i32>(idx, 0), 0).rgb;
}
`,it=`
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
`,fa=`
fn srgbOetf(x: f32) -> f32 {
  let v = clamp(x, 0.0, 1.0);
  if (v <= 0.0031308) { return 12.92 * v; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn outputEncodeF(x: f32, gamma: f32, hasGamma: bool) -> f32 {
  if (hasGamma) { return clamp(pow(clamp(x, 0.0, 1.0), 1.0 / gamma), 0.0, 1.0); }
  return srgbOetf(x);
}

fn reinhardCurve(x: f32) -> f32 { let v = max(x, 0.0); return v / (1.0 + v); }
fn acesCurve(x: f32) -> f32 {
  let v = max(x, 0.0);
  let num = v * (2.51 * v + 0.03);
  let den = v * (2.43 * v + 0.59) + 0.14;
  return clamp(num / den, 0.0, 1.0);
}
fn applyOperator(rgb: vec3<f32>, operatorId: i32) -> vec3<f32> {
  if (operatorId == 2) { return vec3<f32>(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z)); }
  if (operatorId == 3) { return vec3<f32>(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z)); }
  return clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Per-side exposure+offset -> [scalar LUT] -> operator -> encode. The lut is
// only read when isScalar. offset is the TEV display offset, added AFTER
// exposure and BEFORE the colormap/tonemap/encode stages (default 0 = identity).
fn processSide(lut: texture_2d<f32>, sampled: vec4<f32>, exposureEV: f32, offset: f32, operatorId: i32, gamma: f32, isScalar: bool, hdrOut: bool) -> vec3<f32> {
  var rgb = sampled.rgb * exp2(exposureEV) + vec3<f32>(offset);
  if (isScalar) { rgb = sampleLUT(lut, rgb.x); }
  rgb = applyOperator(rgb, operatorId);
  if (hdrOut) { return rgb; }
  let hasGamma = gamma > 0.0;
  return vec3<f32>(outputEncodeF(rgb.r, gamma, hasGamma), outputEncodeF(rgb.g, gamma, hasGamma), outputEncodeF(rgb.b, gamma, hasGamma));
}
`,Pt=`
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
`;function Ur(e){return`
${ge}
${$e}
${fa}

@group(0) @binding(0) var texA: texture_2d<f32>;
@group(0) @binding(3) var texB: texture_2d<f32>;
@group(0) @binding(6) var lut: texture_2d<f32>;
@group(0) @binding(11) var<uniform> u_img: vec4<f32>;     // exposureEV, operatorId, gamma, isScalar
@group(0) @binding(14) var<uniform> u_uv: vec4<f32>;      // uvRect.xy, uvRect.wh
@group(0) @binding(17) var<uniform> u_compose: vec4<f32>; // split, alpha, hdrOut, filterMode
@group(0) @binding(20) var<uniform> u_extra: vec4<f32>;   // offset, _, _, _ (TEV display offset; default 0)

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

  let colorA = processSide(lut, sampledA, exposureEV, offset, operatorId, gamma, isScalar, hdrOut);
  let colorB = processSide(lut, sampledB, exposureEV, offset, operatorId, gamma, isScalar, hdrOut);

  let split = u_compose.x;
  let alpha = u_compose.y;
  let outColor = ${e};
  return vec4<f32>(outColor, 1.0);
}
`}const da=Ur("select(colorB, colorA, uv.x < split)"),pa=Ur("mix(colorA, colorB, alpha)");function ma(e){switch(e){case"center":return{v:"center",h:"center"};case"top-right":return{v:"top",h:"right"};case"bottom-left":return{v:"bottom",h:"left"};case"bottom-right":return{v:"bottom",h:"right"};case"top-left":default:return{v:"top",h:"left"}}}function ar(e,t,r){const{v:n,h:a}=ma(r),s=e.w-t.w,i=e.h-t.h,o=a==="left"?0:a==="right"?s:Math.floor(s/2),u=n==="top"?0:n==="bottom"?i:Math.floor(i/2);return{x:o,y:u}}function ot(e,t,r,n,a="b"){if(n==="fill"){const i=a==="a"?{w:e.w,h:e.h}:{w:t.w,h:t.h};return{fit:n,result:i,offsetA:{x:0,y:0},offsetB:{x:0,y:0}}}const s={w:Math.min(e.w,t.w),h:Math.min(e.h,t.h)};return{fit:n,result:s,offsetA:ar(e,s,r),offsetB:ar(t,s,r)}}function jt(e){return`${e.fit}:${e.result.w}x${e.result.h}:${e.offsetA.x},${e.offsetA.y}:${e.offsetB.x},${e.offsetB.y}`}const Kt={linear:0,srgb:1,reinhard:2,aces:3,extended:4,"extended-reinhard":5,"extended-aces":6,"extended-clamp":7,gamma:8},sr=new WeakMap;function ga(e,t){let r=sr.get(e);r||(r=new Map,sr.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:la,targetFormat:t}),r.set(t,n)),n}function Ir(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Nr(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function ha(e,t,r,n){var R;const a=Ir(t),s=ga(e,a),i=Nr(e,n.isScalar?n.colormap:void 0),o=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,u=Kt[n.operator]??Kt.srgb,c=new Float32Array([n.exposureEV,u,o,n.isScalar?1:0]),f=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),m=new Float32Array([n.hdrOut?1:0]),d=new Float32Array([n.filter==="nearest"?0:1]),x=new Float32Array([n.offset??0]),b=new Float32Array([n.peak??Br]),E=new Float32Array([n.srgbDecode?1:0]);let A;try{A=e.createBindGroup(s,[{binding:0,resource:r},{binding:1,resource:i},{binding:2,resource:{uniform:c}},{binding:3,resource:{uniform:f}},{binding:4,resource:{uniform:m}},{binding:5,resource:{uniform:d}},{binding:6,resource:{uniform:x}},{binding:7,resource:{uniform:b}},{binding:8,resource:{uniform:E}}]),e.renderFullscreen(t,s,A)}finally{(R=A==null?void 0:A.destroy)==null||R.call(A),i.destroy()}}const ir=new WeakMap;function xa(e,t,r){let n=ir.get(e);n||(n=new Map,ir.set(e,n));const a=`${t}:${r}`;let s=n.get(a);return s||(s=e.createRenderPipeline({shaderWGSL:t==="split"?da:pa,targetFormat:r}),n.set(a,s)),s}function ba(e,t,r,n,a){var E;if(a.mode==="diff")throw new Error("renderCompose: mode 'diff' is handled by the diff-engine, not renderCompose");const s=Ir(t),i=xa(e,a.mode,s),o=Nr(e,void 0),u=a.gamma,c=Kt[a.operator],f=new Float32Array([a.exposureEV,c,u,0]),m=new Float32Array([a.uv.x,a.uv.y,a.uv.w,a.uv.h]),d=new Float32Array([a.split,a.alpha,0,a.filter==="nearest"?0:1]),x=new Float32Array([a.offset??0,0,0,0]);let b;try{b=e.createBindGroup(i,[{binding:0,resource:r},{binding:1,resource:n},{binding:2,resource:o},{binding:3,resource:{uniform:f}},{binding:4,resource:{uniform:m}},{binding:5,resource:{uniform:d}},{binding:6,resource:{uniform:x}}]),e.renderFullscreen(t,i,b)}finally{(E=b==null?void 0:b.destroy)==null||E.call(b),o.destroy()}}function or(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,a=t/r,s=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:s,mae:a}}async function Vr(e,t,r,n){const a=n??ot({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),s=a.result.w,i=a.result.h,o=s*i*3;if(o<=0)return{mse:0,psnr:1/0,mae:0};if(a.fit==="crop"&&a.offsetA.x===0&&a.offsetA.y===0&&a.offsetB.x===0&&a.offsetB.y===0&&e.reduceDiffSumSquaredAbs){const{sumSq:l,sumAbs:h}=await e.reduceDiffSumSquaredAbs(t,r,s,i);return or(l,h,o)}const c=await e.readback(t),f=await e.readback(r),m=c instanceof Uint8Array?255:1,d=f instanceof Uint8Array?255:1,x=vt(c,t.width,t.height,m,a.offsetA,a.fit==="fill",s,i),b=vt(f,r.width,r.height,d,a.offsetB,a.fit==="fill",s,i);let E=0,A=0;const R=[0,0,0],v=[0,0,0];for(let l=0;l<i;l++)for(let h=0;h<s;h++){x(h,l,R),b(h,l,v);for(let w=0;w<3;w++){const y=R[w]-v[w];E+=y*y,A+=Math.abs(y)}}return or(E,A,o)}function vt(e,t,r,n,a,s,i,o){const u=(m,d,x)=>e[(d*t+m)*4+x]??0;if(!s)return(m,d,x)=>{const b=Math.min(Math.max(m+a.x,0),t-1),E=Math.min(Math.max(d+a.y,0),r-1);x[0]=u(b,E,0)/n,x[1]=u(b,E,1)/n,x[2]=u(b,E,2)/n};const c=t-1,f=r-1;return(m,d,x)=>{const b=(m+.5)/i,E=(d+.5)/o,A=b*t-.5,R=E*r-.5,v=Math.floor(A),l=Math.floor(R),h=A-v,w=R-l,y=Math.min(Math.max(v,0),c),M=Math.min(Math.max(v+1,0),c),k=Math.min(Math.max(l,0),f),P=Math.min(Math.max(l+1,0),f);for(let C=0;C<3;C++){const L=u(y,k,C),Q=u(M,k,C),I=u(y,P,C),Y=u(M,P,C),X=L+(Q-L)*h,ce=I+(Y-I)*h;x[C]=(X+(ce-X)*w)/n}}}function zr(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const va=12,Fe=[];function cr(e){const t=Fe.indexOf(e);t!==-1&&Fe.splice(t,1),Fe.push(e)}function ya(e){const t=Fe.indexOf(e);t!==-1&&Fe.splice(t,1)}function yt(e){e.parked||(ya(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),e.surface=null,e.parked=!0)}function ur(e){for(;Fe.length>va;){const t=Fe.find(r=>r!==e&&!r.visible)??Fe.find(r=>r!==e);if(!t)break;yt(t)}}function $r(e){var a,s,i,o;if(e.disposed)return;if(zr())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){cr(e),ur(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const r=e.backingWidth||((a=e.source)==null?void 0:a.width)||((s=e.deep)==null?void 0:s.width)||1,n=e.backingHeight||((i=e.source)==null?void 0:i.height)||((o=e.deep)==null?void 0:o.height)||1;if(e.canvas.width=r,e.canvas.height=n,e.surface.configure(r,n),e.deep){const u=t.createTexture(e.deep.width,e.deep.height,"rgba16float");e.srcTexture=u,e.deepBuffers=t.createDeepSampleBuffers(e.deep),t.compositeDeep(e.deepBuffers,u,e.deepZNear,e.deepZFar)}else if(e.source){const u=t.createTexture(e.source.width,e.source.height,e.source.format);u.write(e.source.data),e.srcTexture=u}e.parked=!1,cr(e),ur(e)}function wa(e,t){if(e.disposed||!e.source&&!e.deep)return!0;try{return $r(e),!e.surface||!e.srcTexture?!1:(ha(e.device,e.surface,e.srcTexture,t),!0)}catch(r){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",r),e.parked=!1,yt(e),!1}}function Ra(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,e.deep=null,e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const r=e.device.createTexture(t.width,t.height,t.format);r.write(t.data),e.srcTexture=r}},setDeepSource(t,r,n){if(!e.disposed&&(e.deep=t,e.deepZNear=r,e.deepZFar=n,e.source=null,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy(),e.deepBuffers&&e.deepBuffers.destroy();const a=e.device.createTexture(t.width,t.height,"rgba16float");e.srcTexture=a,e.deepBuffers=e.device.createDeepSampleBuffers(t),e.device.compositeDeep(e.deepBuffers,a,r,n)}},setDeepWindow(t,r){e.disposed||(e.deepZNear=t,e.deepZFar=r,!e.parked&&e.deepBuffers&&e.srcTexture&&e.device.compositeDeep(e.deepBuffers,e.srcTexture,t,r))},resize(t,r){if(e.disposed)return;const n=Math.max(1,Math.round(t)),a=Math.max(1,Math.round(r));e.backingWidth===n&&e.backingHeight===a||(e.backingWidth=n,e.backingHeight=a,!e.parked&&e.surface&&(e.canvas.width=n,e.canvas.height=a,e.surface.configure(n,a)))},render(t){return wa(e,t)},park(){e.disposed||yt(e)},restore(){e.disposed||!e.source&&!e.deep||$r(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(yt(e),e.source=null,e.deep=null,e.disposed=!0)}}}async function Ea(e,t){const r=await Mt(),n={canvas:e,device:r,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,deep:null,deepZNear:-1/0,deepZFar:1/0,deepBuffers:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return Ra(n)}function lr(e){e.dispose()}const fr={"no-webgpu":0,"no-hdr-browser":1,"no-hdr-display":2},_a="https://github.com/doeringchristian/cairn-plot/blob/main/docs/browser-support.md";function Sa(e,t=!1){const r=e||"";return t?"brave":/firefox/i.test(r)?"firefox":/safari/i.test(r)&&!/chrome|chromium|crios|android/i.test(r)?"safari":/linux/i.test(r)&&/chrome|chromium/i.test(r)?"chromium-linux":"chromium"}function Aa(e){const t=e||"";return/mac os x|macintosh/i.test(t)?"macos":/windows/i.test(t)?"windows":"other"}function Ma(e,t){if(e==="no-hdr-display")switch(Aa(t.userAgent)){case"macos":return"macOS: EDR engages automatically on HDR-capable displays — confirm your display supports HDR.";case"windows":return"Windows: turn on Settings → System → Display → Use HDR.";default:return"Enable HDR in your display and OS settings."}const r=Sa(t.userAgent,t.isBrave);if(e==="no-hdr-browser")switch(r){case"firefox":return"Firefox has no extended-tone-mapping canvas path at all — true HDR output is impossible until Firefox implements it (fundamental browser limitation).";case"safari":return"Safari's WebGPU HDR canvas tone-mapping is still maturing — update to the latest Safari 26+.";default:return"Chrome/Edge 129+ is required for HDR canvas output (toneMapping: extended) — update your browser."}switch(r){case"firefox":return"Firefox: about:config → dom.webgpu.enabled (HDR output is not available in Firefox at all — browser limitation).";case"safari":return"Safari: Develop → Feature Flags → WebGPU (Safari 26+ has it by default).";case"brave":return"Brave: check Shields fingerprint blocking + brave://flags.";case"chromium-linux":return"Chromium on Linux: enable chrome://flags/#enable-unsafe-webgpu.";case"chromium":default:return"Chrome/Edge: enable chrome://flags/#enable-unsafe-webgpu and hardware acceleration."}}function Pa(e){switch(e){case"no-webgpu":return"GPU renderer unavailable → CPU fallback active; FLIP kernels + HDR compare disabled.";case"no-hdr-browser":return"True HDR output is unsupported by this browser — a fundamental browser limitation, not a cairn-plot bug → HDR images tone-mapped to SDR.";case"no-hdr-display":return"Your display/OS is not in HDR mode → HDR images tone-mapped to SDR."}}function Wr(e,t){return`cairn-plot:capnotice:${e}:${t}`}const Hr=new Set;function dr(e){try{if(window.localStorage.getItem(e)==="1")return!0}catch{}try{if(window.sessionStorage.getItem(e)==="1")return!0}catch{}return Hr.has(e)}function Ta(e){try{window.localStorage.setItem(e,"1");return}catch{}try{window.sessionStorage.setItem(e,"1");return}catch{}Hr.add(e)}const pr=new Set;let wt=null,Xe=null;function Kr(){Xe&&Xe.parentNode&&Xe.parentNode.removeChild(Xe),Xe=null,wt=null}function Ba(e){const t=Wr(e,window.location.pathname),r=Ma(e,{userAgent:navigator.userAgent,isBrave:!!navigator.brave}),n=document.createElement("div");n.setAttribute("role","status"),n.setAttribute("data-cairn-plot-capnotice",e),Object.assign(n.style,{position:"fixed",bottom:"12px",right:"12px",zIndex:"2147483000",maxWidth:"340px",boxSizing:"border-box",padding:"10px 30px 10px 12px",borderRadius:"6px",border:"1px solid var(--color-border, #d0d7de)",background:"rgb(var(--color-bg-elevated-rgb, 246 248 250) / 0.9)",color:"var(--color-fg-muted, #656d76)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",boxShadow:"0 4px 12px rgba(0, 0, 0, 0.18)",font:"12px/1.4 system-ui, sans-serif"});const a=document.createElement("div");a.textContent=Pa(e),Object.assign(a.style,{fontWeight:"600",color:"var(--color-fg, #1f2328)",marginBottom:"4px"});const s=document.createElement("div");s.textContent=r,s.style.marginBottom="4px";const i=document.createElement("a");i.href=_a,i.target="_blank",i.rel="noopener noreferrer",i.textContent="Learn more",Object.assign(i.style,{color:"var(--color-accent, #0969da)",textDecoration:"none"});const o=document.createElement("button");o.type="button",o.textContent="×",o.setAttribute("aria-label","Dismiss browser capability notice"),o.title="Dismiss",Object.assign(o.style,{position:"absolute",top:"4px",right:"6px",padding:"0 4px",border:"0",background:"transparent",color:"var(--color-fg-subtle, #8b949e)",cursor:"pointer",fontSize:"16px",lineHeight:"1"}),o.addEventListener("click",()=>{Ta(t),Kr()}),n.appendChild(a),n.appendChild(s),n.appendChild(i),n.appendChild(o),document.body.appendChild(n),Xe=n,wt=e}function qr(e){if(typeof document>"u"||typeof window>"u"||pr.has(e))return;pr.add(e);const t=Wr(e,window.location.pathname);if(dr(t))return;const r=()=>{if(!dr(t)){if(wt!==null)if(fr[e]<fr[wt])Kr();else return;Ba(e)}};document.body?r():window.addEventListener("DOMContentLoaded",r,{once:!0})}const Da={data:new Float32Array(0),shape:[0,0],dtype:"<f4"};function Ca(e){const{h:t,w:r,c:n}=Un(e.shape);if(e.precision==="f16-bits"){const i=e.data,o=new Uint16Array(r*t*4);for(let u=0;u<r*t;u++){const c=u*n,f=u*4;if(n===1){const m=i[c];o[f]=m,o[f+1]=m,o[f+2]=m,o[f+3]=bt}else o[f]=i[c],o[f+1]=i[c+1],o[f+2]=i[c+2],o[f+3]=n>=4?i[c+3]:bt}return{data:o,width:r,height:t,format:"rgba16float"}}const a=e.data,s=new Float32Array(r*t*4);for(let i=0;i<r*t;i++){const o=i*n;let u,c,f,m=1;n===1?u=c=f=Ge(a[o]):n===3?(u=Ge(a[o]),c=Ge(a[o+1]),f=Ge(a[o+2])):(u=Ge(a[o]),c=Ge(a[o+1]),f=Ge(a[o+2]),m=Ge(a[o+3]));const d=i*4;s[d]=u,s[d+1]=c,s[d+2]=f,s[d+3]=m}return{data:s,width:r,height:t,format:"rgba32float"}}function Yr(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const a=Math.min(t.width/r,t.height/n),s=r*a,i=n*a,o=(t.width-s)/2,u=(t.height-i)/2,c=Math.max(e.zoom,1e-6),f=t.width/(c*s),m=t.height/(c*i),d=-o/s-e.pan.x/(c*s),x=-u/i-e.pan.y/(c*i);return{x:d,y:x,w:f,h:m}}function Xr(e,t,r,n){const a=e.w*r,s=e.h*n;return a<=0||s<=0||t.width<=0||t.height<=0?0:Math.min(t.width/a,t.height/s)}function La(e){var Ve,ie,Be;const t=xn(e),r=p.useRef(null),n=p.useRef(null),a=p.useRef(null),s=p.useRef(null),i=p.useRef(null),o=t&&!!((Ve=e.hdr)!=null&&Ve.deep),u=p.useCallback((_,O)=>{var G,T;(G=s.current)==null||G.setDeepWindow(_,O),(T=i.current)==null||T.call(i)},[]),c=bn(t?e.hdr:Da,o?u:void 0),f=p.useRef(!1),[m,d]=p.useState(!1),[x,b]=p.useState(!1),[E,A]=p.useState(!1),[R,v]=p.useState(null),[l,h]=p.useState(0),[w,y]=p.useState(0),[M,k]=p.useState({x:0,y:0,w:1,h:1}),P=p.useRef(null),C=p.useRef(null),[L,Q]=p.useState(0),I=e.zoom??1,Y=e.pan??{x:0,y:0},X=e.onViewportChange,ce=t?"none":e.colormap??"none",[re,j,$]=ze(ce);p.useEffect(()=>{j(ce)},[ce,j]);const ne=t?"none":re,ae=t?e.tonemap:void 0,[Me,ue]=p.useState(null);p.useEffect(()=>{ue(null)},[ae]);const le=kn(ae),he=Me??le,We=Me!==null&&Me!==le,je=p.useCallback(()=>ue(null),[]),Ze=t?e.peak:void 0,[Qe,ve,Ue]=ze(Ze!=null&&Ze>0?Ze:vn(ae)??Br),xe=e.gamma,[be,H,Ie]=ze(xe&&xe>0?xe:yn);p.useEffect(()=>{xe&&xe>0&&H(xe)},[xe,H]);const He=t?void 0:e.tonemap,Se=(()=>{const _=Fn(He);return _==="gamma"||_==="linear"?_:"srgb"})(),[se,Pe,Ke]=ze(Se);p.useEffect(()=>{Pe(Se)},[He]);const[Ae,Tt]=p.useState(0),[fe,Bt]=p.useState(0),Te=Dr();p.useEffect(()=>{const _=r.current;if(!_)return;let O=!1;return Mt().then(G=>{var q;if(O)return;const T=((q=G.probeExtendedToneMapping)==null?void 0:q.call(G))??!1,N=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,F=T&&N&&t;f.current=F,d(F),t&&!F&&qr(T?"no-hdr-display":"no-hdr-browser"),Ea(_,{hdr:F}).then(te=>{if(O){lr(te);return}s.current=te,A(!0)}).catch(te=>{O||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",te),b(!0))})}).catch(G=>{O||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",G),b(!0))}),()=>{O=!0,s.current&&(lr(s.current),s.current=null)}},[]),p.useEffect(()=>{const _=n.current;if(!_)return;const O=new ResizeObserver(()=>y(G=>G+1));return O.observe(_),()=>O.disconnect()},[]),p.useEffect(()=>{const _=n.current;if(!_)return;const O=new IntersectionObserver(G=>{const T=G[0];if(!T)return;const N=s.current;N&&(N.setVisible(T.isIntersecting),T.isIntersecting?N.isParked&&(N.restore(),y(F=>F+1)):N.park())},{threshold:0});return O.observe(_),()=>O.disconnect()},[]),p.useEffect(()=>{var G;if(!t||!E||o)return;const _=c.hdr;P.current=_;const O=Ca(_);(G=s.current)==null||G.setSource(O),v(T=>T&&T.w===O.width&&T.h===O.height?T:{w:O.width,h:O.height}),Q(T=>T+1),h(T=>T+1)},[t,E,o,t?c.hdr:null]),p.useEffect(()=>{if(!t||!E||!o)return;const _=e.hdr,O=_.deep;P.current=_;let G=!1;return O.getGpuCsr().then(T=>{var N;G||((N=s.current)==null||N.setDeepSource(T,O.zMin,O.zMax),v(F=>F&&F.w===T.width&&F.h===T.height?F:{w:T.width,h:T.height}),Q(F=>F+1),h(F=>F+1))}).catch(T=>{G||console.warn("[cairn] deep GPU CSR upload failed:",T)}),()=>{G=!0}},[t,E,o,t?e.hdr.deep:null]),p.useEffect(()=>{if(t||!E)return;const _=e,O=_.imageUrl,G=re;if(!O){C.current=null,v(null),Q(N=>N+1);return}let T=!1;return Cr(O).then(N=>{var te,de;if(T||!N)return;let F=N;if(G!=="none"){const W=`gpu::${O}::${G}::ev${Ae}::off${fe}`,pe=wn(W);if(pe)F=pe;else{const De=Rn(G);F=En(N,G,De,Ae,fe),_n(W,F)}}C.current=N;const q={data:F.data,width:F.width,height:F.height,format:"rgba8unorm"};(te=s.current)==null||te.setSource(q),v(W=>W&&W.w===F.width&&W.h===F.height?W:{w:F.width,h:F.height}),(de=_.onNaturalSize)==null||de.call(_,F.width,F.height),Q(W=>W+1),h(W=>W+1)}),()=>{T=!0}},[t,E,t?null:e.imageUrl,t?null:re,t?0:Ae,t?0:fe]);const ct=t?e.exposure??0:0,ye=!t&&ne==="none",Ne=p.useCallback(()=>{const _=s.current;if(!_||!E||!R)return;const O=n.current,G=a.current,T=G?G.getBoundingClientRect():O?O.getBoundingClientRect():{width:R.w,height:R.h},N=Yr({zoom:I,pan:Y},T,R.w,R.h);k(W=>W.x===N.x&&W.y===N.y&&W.w===N.w&&W.h===N.h?W:N),T.width>0&&T.height>0&&_.resize(Math.round(T.width*Te),Math.round(T.height*Te));const F=Xr(N,T,R.w,R.h)>=Lr?"nearest":"linear",q=N,te=Sn(he,f.current?Qe:1,f.current,be),de=t?{exposureEV:ct+Ae,offset:fe,operator:te.operator,gamma:te.gamma,isScalar:!1,hdrOut:te.hdrOut,peak:te.peak,uv:q,filter:F}:{exposureEV:ye?Ae:0,offset:ye?fe:0,operator:ye?se:"linear",gamma:ye?On(se,be):1,isScalar:!1,hdrOut:!1,srgbDecode:ye,uv:q,filter:F};try{_.render(de)||b(!0)}catch(W){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",W),b(!0)}},[E,R,I,Y.x,Y.y,ct,Ae,fe,he,Qe,be,se,ye,t,ne,Te]);i.current=Ne,p.useEffect(()=>{Ne()},[Ne,l,w]);const ut=p.useCallback((_,O,G)=>{if(t){const W=P.current,pe=R;if(!W||!pe||_<0||O<0||_>=pe.w||O>=pe.h)return null;const De=W.shape.length===2?1:W.shape[2]??1,Ce=(O*pe.w+_)*De,dt=W.data,Ye=W.precision==="f16-bits"?rt=>Gr(dt[rt]??0):rt=>dt[rt]??0,pt=De===1?[Ye(Ce)]:[Ye(Ce),Ye(Ce+1),Ye(Ce+2)];return at(pt,"unit",G)}const T=C.current;if(!T||_<0||O<0||_>=T.width||O>=T.height)return null;const N=(O*T.width+_)*4,F=T.data[N],q=T.data[N+1],te=T.data[N+2];return at(ne!=="none"||F===q&&q===te?[F]:[F,q,te],"uint8",G)},[t,R,ne]),Je=e.showAxes??!1,et=t?e.label??"":e.label,qe=e.interpolation??"auto",lt=qe==="auto"?void 0:qe,we=t?void 0:e.overlay,Re=t?void 0:e.overlaySettings,Dt=t?!1:e.isDraggable??!1,ft=t?void 0:e.onDragStart;if(x)return t?Z.jsx(zt,{...e}):Z.jsx(zt,{...e});const tt=we&&(Re!=null&&Re.enabled)&&R&&((((ie=we.boxes)==null?void 0:ie.length)??0)>0||(((Be=we.masks)==null?void 0:Be.length)??0)>0)?Z.jsx(An,{data:we,settings:Re,naturalWidth:R.w,naturalHeight:R.h}):void 0;return Z.jsx(kr,{paneAttrs:{"data-gpu-image-pane":"","data-gpu-backend-ready":E},viewportAttrs:{"data-gpu-image-viewport":""},toolbar:!0,paneRef:n,wrapperRef:a,zoom:I,pan:Y,onViewportChange:X,naturalDims:R,checkerboard:"wrapper",wrapperClassName:"relative w-full h-full flex items-center justify-center",viewportPadding:Je&&R?"16px 4px 4px 28px":0,surface:Z.jsx("canvas",{ref:r,className:"w-full h-full block",style:{imageRendering:lt},"data-gpu-image-canvas":!0}),showAxes:Je,overlayNode:tt,overlay:{displayElRef:r,sample:ut,version:L,hasSource:!0,sourceWindow:M},notationSeed:e.pixelValueNotation??"decimal",exportCanvasRef:r,requestRender:Ne,leadingMenus:t?[Ln(he,_=>ue(_))]:ye?[$t(ne,_=>j(_)),Gn(se,_=>Pe(_))]:[$t(ne,_=>j(_))],displayAdjust:{exposureEV:Ae,offset:fe,onExposureChange:Tt,onOffsetChange:Bt},extraSliders:[...t&&m?[{id:"peak",label:"PK",title:"Peak white (×SDR white) — the HDR ceiling P every operator clips at (Linear/sRGB/Gamma hard-clip at P; Reinhard/ACES roll off toward P). P=1 reproduces the SDR rendition exactly; double-click to type a value, including 'inf' for the raw browser-clipped extended look.",min:Tn,max:Pn,step:Mn,value:Qe,onChange:ve,format:_=>Number.isFinite(_)?`${_.toFixed(1)}×`:"∞"}]:[],...(t?er(he):ye&&er(se))?[{id:"gamma",label:"γ",title:"Display gamma γ for the Gamma transfer — display = clamp(value)^(1/γ), tev-style. Default 2.2 (close to sRGB, not identical). Double-click to type a value.",min:Cn,max:Dn,step:Bn,value:be,onChange:H,format:_=>_.toFixed(1)}]:[]],depthSliders:c.sliders,regionSelect:o?{rect:c.region,queryLive:c.queryRegionWindow,commit:c.commitRegion,remove:c.removeRegion}:void 0,onReset:()=>{$.reset(),je(),Ue.reset(),Ie.reset(),Ke.reset(),c.reset()},extraModified:$.isModified||We||Ue.isModified||Ie.isModified||Ke.isModified||c.isModified,label:et,showLabelChip:!!et,isDraggable:Dt,onDragStart:ft})}const Rt=new Map;function Ee(e){if(Rt.has(e.id))throw new Error(`registerDiffKernel: duplicate kernel id "${e.id}"`);Rt.set(e.id,e)}function Oe(e){return Rt.get(e)}function Ga(){return Array.from(Rt.values())}function jr(e,t){return{...e.params??{},...t??{}}}const ka={kind:"pointwise",id:"signed",label:"Signed Error",publicName:"signed",displayRange:"signed",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(a.rgb - b.rgb, 1.0);
}
`},Oa={kind:"pointwise",id:"absolute",label:"Absolute Error",publicName:"abs",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(abs(a.rgb - b.rgb), 1.0);
}
`},Fa={kind:"pointwise",id:"squared",label:"Squared Error",publicName:"square",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let d = a.rgb - b.rgb;
  return vec4<f32>(d * d, 1.0);
}
`},Ua={kind:"pointwise",id:"relative_signed",label:"Relative Signed",publicName:"rel_signed",displayRange:"signed",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  return vec4<f32>((a.rgb - b.rgb) / denom, 1.0);
}
`},Ia={kind:"pointwise",id:"relative_absolute",label:"Relative Absolute",publicName:"rel_abs",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  return vec4<f32>(abs(a.rgb - b.rgb) / denom, 1.0);
}
`},Na={kind:"pointwise",id:"relative_squared",label:"Relative Squared",publicName:"rel_square",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  let d = a.rgb - b.rgb;
  return vec4<f32>((d * d) / (denom * denom), 1.0);
}
`},Zr=[[10135552/24577794,8788810/24577794,4435075/24577794],[2613072/12288897,8788810/12288897,887015/12288897],[1425312/73733382,8788810/73733382,70074185/73733382]];za(Zr);const Ot=[1.052156925,1,.91835767],Va=.7;function za(e){const[t,r,n]=e[0],[a,s,i]=e[1],[o,u,c]=e[2],f=s*c-i*u,m=-(a*c-i*o),d=a*u-s*o,b=1/(t*f+r*m+n*d);return[[f*b,-(r*c-n*u)*b,(r*i-n*s)*b],[m*b,(t*c-n*o)*b,-(t*i-n*a)*b],[d*b,-(t*u-r*o)*b,(t*s-r*a)*b]]}function $a(e,t,r,n){return[e[0][0]*t+e[0][1]*r+e[0][2]*n,e[1][0]*t+e[1][1]*r+e[1][2]*n,e[2][0]*t+e[2][1]*r+e[2][2]*n]}const Ft=6/29;function Ut(e){return e>Ft**3?Math.cbrt(e):e/(3*Ft*Ft)+4/29}function mr(e,t,r){const[n,a,s]=$a(Zr,e,t,r),i=Ut(n*Ot[0]),o=Ut(a*Ot[1]),u=Ut(s*Ot[2]),c=116*o-16,f=500*(i-o),m=200*(o-u);return[c,.01*c*f,.01*c*m]}function Wa(e,t){const r=e[0]-t[0],n=e[1]-t[1],a=e[2]-t[2];return Math.abs(r)+Math.sqrt(n*n+a*a)}function Ha(){const e=mr(0,1,0),t=mr(0,0,1);return Math.pow(Wa(e,t),Va)}const Ka=Ha(),Qr=Ka,qa=.082;function Jr(e){const t=[1,1,34.1],r=[.0047,.0053,.04],n=[0,0,13.5],a=[1e-5,1e-5,.025],s=Math.max(...r,...a),i=Math.ceil(3*Math.sqrt(s/(2*Math.PI**2))*e),o=1/e,u=Math.PI**2,c=[0,0,0];for(let f=-i;f<=i;f++)for(let m=-i;m<=i;m++){const d=(m*o)**2+(f*o)**2;for(let x=0;x<3;x++)c[x]+=t[x]*Math.sqrt(Math.PI/r[x])*Math.exp(-u*d/r[x])+n[x]*Math.sqrt(Math.PI/a[x])*Math.exp(-u*d/a[x])}return{r:i,deltaX:o,sums:c}}function en(e){const t=.5*qa*e,r=Math.ceil(3*t);let n=0,a=0,s=0;for(let i=-r;i<=r;i++)for(let o=-r;o<=r;o++){const u=Math.exp(-(o*o+i*i)/(2*t*t)),c=-o*u,f=(o*o/(t*t)-1)*u;c>0&&(n+=c),f>0?a+=f:s-=f}return{r,sd:t,edgeNorm:n,pointPos:a,pointNeg:s}}const Ya=`
${ge}
${Pt}
${$e}
${it}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_map0: vec4<f32>; // offX, offY, fitFill, 0
@group(0) @binding(8) var<uniform> u_map1: vec4<f32>; // resultW, resultH, 0, 0
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.position.xy);
  let s = mapSample(src, px, u_map0.x, u_map0.y, u_map1.x, u_map1.y, u_map0.z);
  return vec4<f32>(flip_rgb2ycxcz(s.rgb), 1.0);
}
`,Xa=`
${ge}
${Pt}
${$e}
${it}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_map0: vec4<f32>; // offX, offY, fitFill, 0
@group(0) @binding(8) var<uniform> u_map1: vec4<f32>; // resultW, resultH, 0, 0
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.position.xy);
  let s = mapSample(src, px, u_map0.x, u_map0.y, u_map1.x, u_map1.y, u_map0.z);
  return vec4<f32>(flip_linrgb2ycxcz(clamp(s.rgb, vec3<f32>(0.0), vec3<f32>(1.0))), 1.0);
}
`,Et=`
${ge}
${Pt}
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
`,tn=`
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
`;function _e(e,t){return{binding:e,resource:{uniform:new Float32Array(t)}}}function _t(e,t,r){const n=r.sourceMap,a=n?t==="a"?n.offsetA:n.offsetB:{x:0,y:0},s=n!=null&&n.fill?1:0;return[_e(e,[a.x,a.y,s,0]),_e(e+1,[r.width,r.height,0,0])]}function St(e){return[_e(1,[e.deltaX,e.r,e.sums[0],e.sums[1]]),_e(2,[e.sums[2],0,0,0])]}function rn(e){return[_e(4,[Qr,e.sd,e.r,e.edgeNorm]),_e(5,[e.pointPos,e.pointNeg,0,0])]}function nn(e,t,r,n,a,s=""){const i=Jr(e),o=en(e),u=`ycxczA${s}`,c=`ycxczB${s}`,f=`labA${s}`,m=`labB${s}`,d=`flip${s}`;return{passes:[{name:u,shader:t,inputs:[r],output:u,uniforms:()=>_t(1,"a",a)},{name:c,shader:t,inputs:[n],output:c,uniforms:()=>_t(1,"b",a)},{name:f,shader:Et,inputs:[u],output:f,uniforms:()=>St(i)},{name:m,shader:Et,inputs:[c],output:m,uniforms:()=>St(i)},{name:d,shader:tn,inputs:[f,m,u,c],output:d,uniforms:()=>rn(o)}],flipRef:d}}const ja={kind:"multipass",id:"flip",label:"FLIP (perceptual)",publicName:"flip",displayRange:"unit",output:"scalar",params:{ppd:67},buildPasses(e){const t=e.params.ppd??67,{passes:r,flipRef:n}=nn(t,Ya,"srcA","srcB",e);return{passes:r,final:n}}},Za={kind:"multipass",id:"flip-ldr-forced",label:"FLIP (LDR forced)",publicName:"flip_ldr",displayRange:"unit",output:"scalar",params:{ppd:67},buildPasses(e){const t=e.params.ppd??67,{passes:r,flipRef:n}=nn(t,Xa,"srcA","srcB",e);return{passes:r,final:n}}},gr=`
${ge}
${Pt}
${$e}
${it}
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
`,Qa=`
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
`,Ja={kind:"multipass",id:"hdr-flip",label:"FLIP (perceptual)",publicName:"flip_hdr",displayRange:"unit",output:"scalar",params:{ppd:67,startExposure:0,stopExposure:4,numExposures:2},buildPasses(e){const t=e.params.ppd??67,r=e.params.startExposure??0,n=e.params.stopExposure??4,a=Math.max(2,Math.round(e.params.numExposures??2)),s=(n-r)/Math.max(a-1,1),i=Jr(t),o=en(t),u=[];let c=null;for(let f=0;f<a;f++){const m=r+f*s,d=`_e${f}`,x=`ycxczA${d}`,b=`ycxczB${d}`,E=`labA${d}`,A=`labB${d}`,R=`acc${d}`;u.push({name:x,shader:gr,inputs:["srcA"],output:x,uniforms:()=>[_e(1,[m,0,0,0]),..._t(2,"a",e)]},{name:b,shader:gr,inputs:["srcB"],output:b,uniforms:()=>[_e(1,[m,0,0,0]),..._t(2,"b",e)]},{name:E,shader:Et,inputs:[x],output:E,uniforms:()=>St(i)},{name:A,shader:Et,inputs:[b],output:A,uniforms:()=>St(i)}),c===null?u.push({name:R,shader:tn,inputs:[E,A,x,b],output:R,uniforms:()=>rn(o)}):u.push({name:R,shader:Qa,inputs:[E,A,x,b,c],output:R,uniforms:()=>[_e(5,[Qr,o.sd,o.r,o.edgeNorm]),_e(6,[o.pointPos,o.pointNeg,0,0])]}),c=R}return{passes:u,final:c}}},an=.01,sn=.03,At=1,qt=1.5,ke=5,It=[.2126,.7152,.0722];function Nt(e){return e<=.04045?e/12.92:Math.pow((e+.055)/1.055,2.4)}function hr(e,t,r){const n=It[0]*Nt(e)+It[1]*Nt(t)+It[2]*Nt(r);return Math.min(1,Math.max(0,n))}function es(e,t){const r=2*t+1,n=new Float64Array(r);let a=0;for(let s=-t,i=0;s<=t;s++,i++){const o=Math.exp(-.5*s*s/(e*e));n[i]=o,a+=o}for(let s=0;s<r;s++)n[s]=n[s]/a;return n}function xr(e,t){if(t===1)return 0;const r=2*t;let n=(e%r+r)%r;return n>=t&&(n=r-1-n),n}const on=()=>new Promise(e=>{typeof setTimeout=="function"?setTimeout(e,0):Promise.resolve().then(e)}),Yt=64;async function nt(e,t,r,n,a,s){const i=new Float64Array(t*r);for(let u=0;u<r;u++){for(let c=0;c<t;c++){let f=0;for(let m=-a,d=0;m<=a;m++,d++)f+=n[d]*e[u*t+xr(c+m,t)];i[u*t+c]=f}(u+1)%Yt===0&&await s()}const o=new Float64Array(t*r);for(let u=0;u<r;u++){for(let c=0;c<t;c++){let f=0;for(let m=-a,d=0;m<=a;m++,d++)f+=n[d]*i[xr(u+m,r)*t+c];o[u*t+c]=f}(u+1)%Yt===0&&await s()}return o}async function ts(e,t,r,n,a=on){const s=r*n;if(s<=0)return NaN;const i=es(qt,ke),o=new Float64Array(s),u=new Float64Array(s),c=new Float64Array(s);for(let v=0;v<s;v++)o[v]=e[v]*e[v],u[v]=t[v]*t[v],c[v]=e[v]*t[v];const f=await nt(e,r,n,i,ke,a),m=await nt(t,r,n,i,ke,a),d=await nt(o,r,n,i,ke,a),x=await nt(u,r,n,i,ke,a),b=await nt(c,r,n,i,ke,a),E=(an*At)**2,A=(sn*At)**2;let R=0;for(let v=0;v<s;v++){const l=d[v]-f[v]*f[v],h=x[v]-m[v]*m[v],w=b[v]-f[v]*m[v],y=2*f[v]*m[v]+E,M=2*w+A,k=f[v]*f[v]+m[v]*m[v]+E,P=l+h+A;R+=y*M/(k*P)}return R/s}const rs=`
fn ssim_srgb2linear(c: f32) -> f32 {
  if (c <= 0.04045) { return c / 12.92; }
  return pow((c + 0.055) / 1.055, 2.4);
}
fn ssim_luma(srgb: vec3<f32>) -> f32 {
  let lin = vec3<f32>(ssim_srgb2linear(srgb.r), ssim_srgb2linear(srgb.g), ssim_srgb2linear(srgb.b));
  return clamp(dot(lin, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
}
`,cn=`
${ge}
${rs}
${$e}
${it}
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
`,ns=`
${cn}
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let y = ssim_moment_luma(in);
  return vec4<f32>(y.x, y.y, y.x * y.x, y.y * y.y);
}
`,as=`
${cn}
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let y = ssim_moment_luma(in);
  return vec4<f32>(y.x * y.y, 0.0, 0.0, 0.0);
}
`,br=`
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
`,ss=`
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
`;function st(e,t){return{binding:e,resource:{uniform:new Float32Array(t)}}}function vr(e){const t=e.sourceMap,r=t?t.offsetA:{x:0,y:0},n=t?t.offsetB:{x:0,y:0},a=t!=null&&t.fill?1:0;return[st(2,[r.x,r.y,n.x,n.y]),st(3,[e.width,e.height,a,0])]}function yr(e,t){const r=`${t}H`,n=`${t}V`;return{passes:[{name:r,shader:br,inputs:[e],output:r,uniforms:()=>[st(1,[1,0,ke,qt])]},{name:n,shader:br,inputs:[r],output:n,uniforms:()=>[st(1,[0,1,ke,qt])]}],out:n}}const is={kind:"multipass",id:"ssim",label:"SSIM (1−SSIM)",publicName:"ssim",displayRange:"unit",output:"scalar",buildPasses(e){const t=(an*At)**2,r=(sn*At)**2,n=yr("momA","statsA"),a=yr("momB","statsB");return{passes:[{name:"momA",shader:ns,inputs:["srcA","srcB"],output:"momA",uniforms:vr},{name:"momB",shader:as,inputs:["srcA","srcB"],output:"momB",uniforms:vr},...n.passes,...a.passes,{name:"ssim",shader:ss,inputs:[n.out,a.out],output:"ssim",uniforms:()=>[st(2,[t,r,0,0])]}],final:"ssim"}}};let wr=!1;function os(){wr||(wr=!0,Ee(Oa),Ee(ka),Ee(Fa),Ee(Ia),Ee(Ua),Ee(Na),Ee(ja),Ee(Ja),Ee(Za),Ee(is))}os();function un(){const e=[];for(const r of Ga())r.kind==="pointwise"&&e.push({id:r.id,label:r.label});e.push({id:"flip",label:"FLIP (perceptual)"}),e.push({id:"flip_ldr",label:"FLIP (LDR forced)"});const t=Oe("ssim");return t&&e.push({id:t.id,label:t.label}),e}function cs(e,t){return e==="flip"?t?"hdr-flip":"flip":e==="flip_ldr"||e==="flip-ldr-forced"?t?"flip-ldr-forced":"flip":e}function us(e,t,r){const n=t*r;if(n<=0)return NaN;let a=0;for(let s=0;s<n;s++)a+=e[s*4]??0;return 1-a/n}function Rr(e){return e==null||Number.isNaN(e)?"—":e.toFixed(4)}const Er=new WeakMap;function ls(e,t,r){let n=Er.get(e);n||(n=new Map,Er.set(e,n));const a=n.get(t);if(a)return a;const s=r().catch(i=>{throw n.get(t)===s&&n.delete(t),i});return n.set(t,s),s}const _r=new WeakMap;function Xt(e,t,r,n){let a=_r.get(e);a||(a=new Map,_r.set(e,a));const s=`${t}::${n}`;let i=a.get(s);return i||(i=e.createRenderPipeline({shaderWGSL:r,targetFormat:n}),a.set(s,i)),i}function fs(e){return`
${ge}
${$e}
${it}
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
`}const xt="rgba16float";function ds(e,t,r,n,a,s){var A,R;const i=Oe(n);if(!i)throw new Error(`computeDiff: unknown diff kernel "${n}"`);const o=s??ot({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),u=o.result.w,c=o.result.h,f=o.fit==="fill"?1:0,m=jr(i,a);if(i.kind==="pointwise"){const v=e.createTexture(u,c,xt),l=Xt(e,`pw:${i.id}`,fs(i.source),xt),h=new Float32Array([o.offsetA.x,o.offsetA.y,o.offsetB.x,o.offsetB.y]),w=new Float32Array([u,c,f,0]);let y;try{y=e.createBindGroup(l,[{binding:0,resource:t},{binding:1,resource:r},{binding:2,resource:{uniform:h}},{binding:3,resource:{uniform:w}}]),e.renderFullscreen(v,l,y)}finally{(A=y==null?void 0:y.destroy)==null||A.call(y)}return v}const d={width:u,height:c,params:m,sourceMap:{fill:o.fit==="fill",offsetA:o.offsetA,offsetB:o.offsetB}},x=i.buildPasses(d),b=new Map([["srcA",t],["srcB",r]]),E=[];try{for(const l of x.passes){const h=e.createTexture(u,c,xt);E.push(h),b.set(l.output,h);const w=Xt(e,`mp:${i.id}:${l.name}`,l.shader,xt),y=l.inputs.map((k,P)=>{const C=b.get(k);if(!C)throw new Error(`computeDiff: pass "${l.name}" input "${k}" not produced yet`);return{binding:P,resource:C}});l.uniforms&&y.push(...l.uniforms(d));let M;try{M=e.createBindGroup(w,y),e.renderFullscreen(h,w,M)}finally{(R=M==null?void 0:M.destroy)==null||R.call(M)}}const v=b.get(x.final);if(!v)throw new Error(`computeDiff: final ref "${x.final}" not produced`);for(const l of E)l!==v&&l.destroy();return v}catch(v){for(const l of E)l.destroy();throw v}}const ps=8,ms=256*1024*1024;class gs{constructor(t=ps,r=ms){U(this,"map",new Map);U(this,"totalBytes",0);U(this,"maxEntries");U(this,"maxBytes");this.maxEntries=t,this.maxBytes=r}get(t){const r=this.map.get(t);return r&&(this.map.delete(t),this.map.set(t,r)),r}set(t,r){const n=this.map.get(t);n&&(this.totalBytes-=n.bytes,n.texture.destroy(),this.map.delete(t)),this.map.set(t,r),this.totalBytes+=r.bytes,this.evict()}accountReadbackBytes(t,r){let n=!1;for(const a of this.map.values())if(a===t){n=!0;break}n&&(t.bytes+=r,this.totalBytes+=r,this.evict())}evict(){for(;this.map.size>this.maxEntries||this.totalBytes>this.maxBytes;){const t=this.map.keys().next().value;if(t===void 0)break;const r=this.map.get(t);if(this.map.size===1)break;this.map.delete(t),this.totalBytes-=r.bytes,r.texture.destroy()}}clear(){for(const t of this.map.values())t.texture.destroy();this.map.clear(),this.totalBytes=0}get size(){return this.map.size}}const Sr=new WeakMap;function ln(e){let t=Sr.get(e);return t||(t=new gs,Sr.set(e,t)),t}function hs(e,t){const r=jr(e,t);return Object.keys(r).sort().map(a=>`${a}=${r[a]}`).join(",")}function xs(e,t,r,n,a){const s=Oe(r),i=s?hs(s,n):"",o=a?jt(a):"";return`${e}|${t}|${r}|${i}|${o}`}function fn(e,t,r,n,a,s,i,o){const u=Oe(n);if(!u)throw new Error(`ensureDiff: unknown diff kernel "${n}"`);const c=ln(e),f=o??ot({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),m=xs(s,i,n,a,f),d=c.get(m);if(d)return d;const x=ds(e,t,r,n,a,f),b=f.result.w,E=f.result.h,A={texture:x,width:b,height:E,displayRange:u.displayRange,bytes:b*E*8};return c.set(m,A),A}function bs(e,t,r){return`${e}|${t}|${r?jt(r):""}`}function vs(e,t,r,n,a,s){return ls(e,bs(n,a,s),()=>ys(e,t,r,n,a,s))}async function ys(e,t,r,n,a,s){try{const i=fn(e,t,r,"ssim",void 0,n,a,s);return i.ssimMean!==void 0?i.ssimMean:(i.ssimMeanPending||(i.ssimMeanPending=dn(e,i).then(o=>{const u=us(o,i.width,i.height);return i.ssimMean=u,u})),await i.ssimMeanPending)}catch{return ws(e,t,r,s)}}async function ws(e,t,r,n){const a=n??ot({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),s=a.result.w,i=a.result.h,o=s*i;if(o<=0)return NaN;const u=await e.readback(t),c=await e.readback(r),f=u instanceof Uint8Array?255:1,m=c instanceof Uint8Array?255:1,d=a.fit==="fill",x=vt(u,t.width,t.height,f,a.offsetA,d,s,i),b=vt(c,r.width,r.height,m,a.offsetB,d,s,i),E=new Float64Array(o),A=new Float64Array(o),R=[0,0,0],v=[0,0,0];for(let l=0;l<i;l++){for(let h=0;h<s;h++){x(h,l,R),b(h,l,v);const w=l*s+h;E[w]=hr(R[0],R[1],R[2]),A[w]=hr(v[0],v[1],v[2])}(l+1)%Yt===0&&await on()}return ts(E,A,s,i)}async function Rs(e,t,r,n,a){return t.scalars?t.scalars:(t.scalarsPending||(t.scalarsPending=Vr(e,r,n,a).then(s=>(t.scalars=s,s))),t.scalarsPending)}async function dn(e,t){return t.resultSamples?t.resultSamples:(t.resultSamplesPending||(t.resultSamplesPending=e.readback(t.texture).then(r=>{const n=r instanceof Float32Array?r:Float32Array.from(r);return t.resultSamples=n,ln(e).accountReadbackBytes(t,n.byteLength),n})),t.resultSamplesPending)}const Es=`
${ge}
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
    outColor = sampleLUT(lut, idx);
  } else {
    outColor = disp;
  }
  return vec4<f32>(outColor, 1.0);
}
`,_s={unit:0,signed:1,relative:2},Ss={linear:0,signed:1,positive:2};function As(e,t){if(t){if(t.length!==256*4)throw new Error(`renderDiffDisplay: colormap must be 256*4 floats, got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function Ms(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Ps(e,t,r,n,a){var x,b,E;const s=Ms(t),i=Xt(e,"diff-display",Es,s),o=As(e,a.colormap),u=new Float32Array([a.uv.x,a.uv.y,a.uv.w,a.uv.h]),c=new Float32Array([_s[n],Ss[a.cmapMode??"positive"],a.colormap?1:0,a.filter==="nearest"?0:1]),f=new Float32Array([a.exposureEV??0,a.offset??0,0,0]),m=new Float32Array([((x=a.sourceDims)==null?void 0:x.w)??0,((b=a.sourceDims)==null?void 0:b.h)??0,0,0]);let d;try{d=e.createBindGroup(i,[{binding:0,resource:r},{binding:1,resource:o},{binding:2,resource:{uniform:u}},{binding:3,resource:{uniform:c}},{binding:4,resource:{uniform:f}},{binding:5,resource:{uniform:m}}]),e.renderFullscreen(t,i,d)}finally{(E=d==null?void 0:d.destroy)==null||E.call(d),o.destroy()}}const Ar=.6*.6*2.51,Ts=.6*.03,Bs=0,Mr=.6*.6*2.43,Ds=.6*.59,Cs=.14;function Pr(e){const t=(Ts-Ds*e)/(Ar-Mr*e),r=(Bs-Cs*e)/(Ar-Mr*e);return-.5*t+Math.sqrt((.5*t)**2-r)}const Ls=.85,Gs=.85,Tr=11920928955078125e-23,Vt=[.2126,.7152,.0722];function ks(e,t,r){const n=t*r;if(r===1){const a=e[n];return[a,a,a]}return[e[n],e[n+1],e[n+2]]}function Os(e,t,r,n=3,a={}){const s=t*r,i=Pr(Ls),o=Pr(Gs),u=new Float64Array(s);let c=0;for(let v=0;v<s;v++){const[l,h,w]=ks(e,v,n),y=l*Vt[0]+h*Vt[1]+w*Vt[2];u[v]=y,y>c&&(c=y)}const f=Float64Array.from(u).sort(),m=s>>1,d=s%2===1?f[m]:f[m-1],x=Math.max(d,Tr),b=Math.max(c,Tr),E=a.startExposure??Math.log2(i/b),A=a.stopExposure??Math.log2(o/x),R=Math.max(2,Math.ceil(A-E));return{startExposure:E,stopExposure:A,numExposures:R}}function Fs(e){const t=Kn(e),r=new Float32Array(256*4);for(let n=0;n<256;n++)r[n*4+0]=t[n*3+0]/255,r[n*4+1]=t[n*3+1]/255,r[n*4+2]=t[n*3+2]/255,r[n*4+3]=1;return r}function Us(e){const{width:t,height:r,channels:n}=e,a=t*r;if(e.precision==="f16-bits"){const u=e.data,c=new Uint16Array(a*4);for(let f=0;f<a;f++){const m=f*n,d=f*4;if(n===1){const x=u[m];c[d]=x,c[d+1]=x,c[d+2]=x,c[d+3]=bt}else c[d]=u[m],c[d+1]=u[m+1],c[d+2]=u[m+2],c[d+3]=n>=4?u[m+3]:bt}return{data:c,format:"rgba16float"}}const s=e.data,i=new Float32Array(a*4),o=u=>Number.isFinite(u)?u:0;for(let u=0;u<a;u++){const c=u*n;let f,m,d,x=1;n===1?f=m=d=o(s[c]):n===3?(f=o(s[c]),m=o(s[c+1]),d=o(s[c+2])):(f=o(s[c]),m=o(s[c+1]),d=o(s[c+2]),x=o(s[c+3]));const b=u*4;i[b]=f,i[b+1]=m,i[b+2]=d,i[b+3]=x}return{data:i,format:"rgba32float"}}function Is({imageUrl:e,baselineUrl:t,imageFloat:r,baselineFloat:n,mode:a,splitPosition:s,blendAlpha:i,onSplitPositionChange:o,diffSubmode:u,colormap:c="none",align:f="top-left",fit:m="crop",diffKernel:d,onDiffKernelChange:x,onCompareModeChange:b,onRequestSide:E,zoom:A,pan:R,onViewportChange:v,interpolation:l="auto",label:h="",pixelValueNotation:w="decimal"}){var Zt;const y=p.useRef(null),M=p.useRef(null),k=p.useRef(null),P=p.useRef(null),C=p.useRef(null),[L,Q]=p.useState(!1),[I,Y]=p.useState(!1),[X,ce]=p.useState(null),[re,j]=p.useState(null),[$,ne]=p.useState(0),[ae,Me]=p.useState(0),[ue,le]=p.useState(null),[he,We]=p.useState(null),[je,Ze]=p.useState({x:0,y:0,w:1,h:1}),Qe=d??u??"absolute",[ve,Ue,xe]=ze(Qe);p.useEffect(()=>{Ue(d??u??"absolute")},[d,u,Ue]);const be=p.useCallback(g=>{Ue(g),x==null||x(g)},[x,Ue]);p.useEffect(()=>{const g=y.current;if(g)return g.__cairnDiffKernel={current:ve,set:be},()=>{g&&delete g.__cairnDiffKernel}},[ve,be]);const[H,Ie,He]=ze(a);p.useEffect(()=>{Ie(a)},[a,Ie]);const Se=p.useCallback(g=>{Ie(g),b==null||b(g)},[b,Ie]),[se,Pe,Ke]=ze(c);p.useEffect(()=>{Pe(c)},[c,Pe]);const Ae=p.useCallback(()=>{Se(He.default),Pe(Ke.default),be(xe.default)},[Se,Pe,be,He.default,Ke.default,xe.default]),Tt=He.isModified||Ke.isModified||xe.isModified,[fe,Bt]=p.useState(0),[Te,ct]=p.useState(0),ye=p.useMemo(()=>{const B=[qn({mode:H,kernel:ve,kernelOptions:un().map(D=>({id:D.id,label:D.label})),onSide:E,onSlide:()=>Se("split"),onBlend:()=>Se("blend"),onKernel:D=>{Se("diff"),be(D)}})];return H==="diff"&&B.push($t(se,D=>Pe(D))),B},[H,ve,se,be,Se,E]),Ne=p.useRef(null),ut=p.useRef(null),Je=p.useRef(null),et=p.useRef(null),[qe,lt]=p.useState(0),we=p.useRef(null),Re=p.useRef(null),[Dt,ft]=p.useState(0),tt=Dr();p.useEffect(()=>{const g=k.current;if(!g)return;let B=!1;return Mt().then(D=>{if(!B)try{if(zr())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const S=D.createSurface(g,{hdr:!1});P.current={device:D,surface:S,texA:null,texB:null},Y(!0)}catch(S){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",S),Q(!0)}}).catch(D=>{B||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",D),Q(!0))}),()=>{var S,V;B=!0;const D=P.current;D&&((S=D.texA)==null||S.destroy(),(V=D.texB)==null||V.destroy(),P.current=null)}},[]),p.useEffect(()=>{const g=y.current;if(!g)return;const B=new ResizeObserver(()=>Me(D=>D+1));return B.observe(g),()=>B.disconnect()},[]),p.useEffect(()=>{if(!I)return;let g=!1;if(!P.current)return;async function D(S,V){if(V){const J=Us(V);return{width:V.width,height:V.height,imageData:null,make:ee=>{const K=ee.createTexture(V.width,V.height,J.format);return K.write(J.data),K}}}if(!S)return null;const z=await Cr(S);return z?{width:z.width,height:z.height,imageData:z,make:J=>{const ee=J.createTexture(z.width,z.height,"rgba8unorm");return ee.write(z.data),ee}}:null}return Promise.all([D(e,r),D(t,n)]).then(([S,V])=>{var oe,me;if(g||!P.current)return;const z=P.current;Ne.current=(S==null?void 0:S.imageData)??null,ut.current=(V==null?void 0:V.imageData)??null,Je.current=r??null,et.current=n??null,(oe=z.texA)==null||oe.destroy(),(me=z.texB)==null||me.destroy(),z.texA=null,z.texB=null;const J=S??V;if(!J){ce(null),j(null),lt(Le=>Le+1);return}const ee=V??J,K=S??J;z.texA=ee.make(z.device),z.texB=K.make(z.device),j({a:{w:ee.width,h:ee.height},b:{w:K.width,h:K.height}}),ce({w:J.width,h:J.height}),lt(Le=>Le+1),ne(Le=>Le+1)}),()=>{g=!0}},[I,e,t,r,n]);const Ve=r!=null||n!=null,ie=p.useMemo(()=>cs(ve,Ve),[ve,Ve]),Be=p.useMemo(()=>{if(!Ve)return null;const g=n??r;if(!g)return null;const B=g.precision==="f16-bits"?In(g.data):g.data;return Os(B,g.width,g.height,g.channels)},[Ve,n,r]),_=p.useMemo(()=>{var g;return Nn(((g=Oe(ie))==null?void 0:g.displayRange)??"unit",se==="none"?null:se)},[ie,se]),O=p.useMemo(()=>se!=="none"?Fs(se):void 0,[se]),G=p.useMemo(()=>re?ot(re.a,re.b,f,m,"b"):null,[re,f,m]),T=p.useMemo(()=>G?jt(G):"none",[G]),N=(n==null?void 0:n.contentKey)??t??(r==null?void 0:r.contentKey)??e??"none",F=(r==null?void 0:r.contentKey)??e??(n==null?void 0:n.contentKey)??t??"none",q=p.useMemo(()=>X?H==="diff"&&G?G.result:X:null,[H,G,X]),te=p.useCallback(()=>{const g=P.current;if(!I||!g||!g.surface||!g.texA||!g.texB||!X)return;const B=q??X,D=y.current,S=D?D.getBoundingClientRect():{width:B.w,height:B.h},V=Yr({zoom:A,pan:R},S,B.w,B.h);Ze(K=>K.x===V.x&&K.y===V.y&&K.w===V.w&&K.h===V.h?K:V);const z=k.current;if(S.width>0&&S.height>0&&z&&g.surface){const K=Math.max(1,Math.round(S.width*tt)),oe=Math.max(1,Math.round(S.height*tt));(z.width!==K||z.height!==oe)&&(z.width=K,z.height=oe,g.surface.configure(K,oe))}const J=Xr(V,S,B.w,B.h)>=Lr?"nearest":"linear",ee=V;try{if(H==="diff"){const K=Oe(ie)?ie:"absolute",oe=K==="hdr-flip"&&Be?{ppd:67,startExposure:Be.startExposure,stopExposure:Be.stopExposure,numExposures:Be.numExposures}:void 0,me=fn(g.device,g.texA,g.texB,K,oe,N,F,G??void 0);C.current=me,Ps(g.device,g.surface,me.texture,me.displayRange,{uv:ee,cmapMode:_,colormap:O,filter:J,exposureEV:fe,offset:Te})}else{const K={exposureEV:fe,offset:Te,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:ee,filter:J,mode:H,split:s,alpha:i};ba(g.device,g.surface,g.texA,g.texB,K)}}catch(K){console.warn("cairn-plot: GpuComparePane render failed, falling back to legacy pane",K),Q(!0)}},[I,X,q,G,A,R.x,R.y,H,s,i,fe,Te,ve,ie,Be,_,O,e,t,r,n,N,F,tt]);p.useEffect(()=>{te()},[te,$,ae]);const de=t!=null||n!=null;p.useEffect(()=>{const g=P.current;if(!I||!g||!g.texA||!g.texB||!de){le(null);return}let B=!1;const D=g.texA,S=g.texB,V=C.current,z=H==="diff"?G??void 0:void 0;return(H==="diff"&&V?Rs(g.device,V,D,S,z):Vr(g.device,D,S,z)).then(ee=>{B||le(ee)}),()=>{B=!0}},[I,$,de,H,ve,G]),p.useEffect(()=>{const g=P.current;if(!I||!g||!g.texA||!g.texB||!de){We(null);return}let B=!1;We(null);const D=H==="diff"?G??void 0:void 0;return vs(g.device,g.texA,g.texB,N,F,D).then(S=>{B||We(S)}).catch(()=>{B||We(null)}),()=>{B=!0}},[I,$,de,H,T,N,F]),p.useEffect(()=>{if(H!=="diff"){we.current=null,Re.current=null;return}const g=P.current,B=C.current;if(!I||!g||!B)return;let D=!1;return we.current=null,Re.current=null,ft(S=>S+1),dn(g.device,B).then(S=>{D||(we.current=S,Re.current={w:B.width,h:B.height},ft(V=>V+1))}).catch(()=>{}),()=>{D=!0}},[I,H,ie,$,G]);const W=(g,B)=>(D,S,V)=>{const z=B.current;if(z){const{data:Le,width:Qt,height:pn,channels:Jt}=z;if(D<0||S<0||D>=Qt||S>=pn)return null;const mt=(S*Qt+D)*Jt,gt=z.precision==="f16-bits"?Ct=>Gr(Le[Ct]??0):Ct=>Le[Ct]??0,mn=Jt===1?[gt(mt)]:[gt(mt),gt(mt+1),gt(mt+2)];return at(mn,"unit",V)}const J=g.current;if(!J||D<0||S<0||D>=J.width||S>=J.height)return null;const ee=(S*J.width+D)*4,K=J.data[ee],oe=J.data[ee+1],me=J.data[ee+2];return at(K===oe&&oe===me?[K]:[K,oe,me],"uint8",V)},pe=p.useMemo(()=>W(Ne,Je),[]),De=p.useMemo(()=>W(ut,et),[]),Ce=p.useMemo(()=>(g,B,D)=>{var me;const S=we.current,V=Re.current;if(!S||!V)return null;const{w:z,h:J}=V;if(g<0||B<0||g>=z||B>=J)return null;const ee=(B*z+g)*4,oe=(((me=Oe(ie))==null?void 0:me.output)??"per-channel")==="scalar"?[S[ee]??0]:[S[ee]??0,S[ee+1]??0,S[ee+2]??0];return at(oe,"unit",D)},[ie]);p.useEffect(()=>{const g=y.current;if(g)return g.__cairnCompareProbe={sampleDiff:(B,D,S="decimal")=>Ce(B,D,S),sampleFg:(B,D,S="decimal")=>pe(B,D,S),sampleRef:(B,D,S="decimal")=>De(B,D,S),get diffSamples(){return we.current},get dims(){return q},get primaryDims(){return X},get diffResultDims(){return Re.current},get align(){return f},get fit(){return m},get resolvedKernelId(){return ie},get compareMode(){return H},get ssimScalar(){return he},get ssimText(){return Rr(he)}},()=>{g&&delete g.__cairnCompareProbe}},[Ce,pe,De,X,q,f,m,ie,H,he]);const dt=l==="auto"?void 0:l;if(L)return r!=null||n!=null?Z.jsx(Vn,{}):H==="diff"?Z.jsx(zt,{imageUrl:e,baselineUrl:t,diffMode:((Zt=Oe(ie))==null?void 0:Zt.kind)==="pointwise"?ie:"absolute",interpolation:l,colormap:se,showAxes:!1,zoom:A,pan:R,onViewportChange:v,label:h,pixelValueNotation:w}):Z.jsx(zn,{imageUrl:e,baselineUrl:t,mode:H,splitPosition:s,blendAlpha:i,onSplitPositionChange:o,zoom:A,pan:R,onViewportChange:v,interpolation:l,label:h,pixelValueNotation:w});const Ye=Z.jsxs(Z.Fragment,{children:[Z.jsx("canvas",{ref:k,className:"w-full h-full block",style:{imageRendering:dt},"data-gpu-compare-canvas":!0}),H==="split"&&Z.jsx(Hn,{splitPosition:s,onChange:o,onReset:()=>o==null?void 0:o(.5)})]}),pt=!!h,rt=pt?"bottom-7":"bottom-1";return Z.jsx(kr,{paneAttrs:{"data-gpu-compare-pane":"","data-gpu-compare-ready":I},viewportAttrs:{"data-gpu-compare-viewport":""},toolbar:!0,paneRef:y,wrapperRef:M,zoom:A,pan:R,onViewportChange:v,naturalDims:q,checkerboard:"pane",wrapperClassName:"relative w-full h-full flex items-center justify-center",viewportPadding:0,surface:Ye,showAxes:!1,notationSeed:w,onReset:Ae,extraModified:Tt,exportCanvasRef:k,requestRender:te,leadingMenus:ye,displayAdjust:{exposureEV:fe,offset:Te,onExposureChange:Bt,onOffsetChange:ct},label:"",showLabelChip:!1,overlay:{render:({notation:g,setOverlayActive:B})=>H==="split"?Z.jsxs(Z.Fragment,{children:[de&&q&&Z.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-s)*100}% 0 0)`},children:Z.jsx(Lt,{imageElRef:k,naturalWidth:q.w,naturalHeight:q.h,zoom:A,pan:R,sourceWindow:je,sample:De,notation:g,version:qe})}),de&&q&&Z.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${s*100}%)`},children:Z.jsx(Lt,{imageElRef:k,naturalWidth:q.w,naturalHeight:q.h,zoom:A,pan:R,sourceWindow:je,sample:pe,notation:g,version:qe,onActiveChange:B})})]}):q&&Z.jsx(Lt,{imageElRef:k,naturalWidth:q.w,naturalHeight:q.h,zoom:A,pan:R,sourceWindow:je,sample:H==="diff"?Ce:pe,notation:g,version:H==="diff"?Dt:qe,onActiveChange:B})},extraChips:Z.jsxs(Z.Fragment,{children:[H==="split"&&Z.jsx($n,{}),pt?Z.jsx(Wn,{label:h,corner:"bottom-right"}):null,ue&&Z.jsxs("span",{className:`absolute right-1 z-30 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${rt}`,"data-gpu-compare-metrics":!0,children:["MSE ",ue.mse.toExponential(2)," · PSNR ",Number.isFinite(ue.psnr)?ue.psnr.toFixed(1):"∞"," dB · MAE"," ",ue.mae.toExponential(2)," · SSIM ",Rr(he)]})]})})}const Ns="cairn-plot:gpu-image-ready";async function Vs(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Mt(),window.__cairnPlotGpuImagePane=La,window.__cairnPlotGpuComparePane=Is,window.__cairnPlotDiffMenuModes=un(),window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(Ns))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e),qr("no-webgpu")}}}Vs();

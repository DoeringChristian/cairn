var ua=Object.defineProperty;var la=(e,t,r)=>t in e?ua(e,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):e[t]=r;var N=(e,t,r)=>la(e,typeof t!="symbol"?t+"":t,r);import{E as Xt,a1 as fa,a2 as da,r as f,a3 as pa,a4 as qe,a5 as cn,a6 as un,a7 as ln,a8 as fn,a9 as ma,aa as ga,ab as ha,ac as xa,ad as dn,ae as pn,af as mn,ag as Et,j as Q,Z as gn,ah as ba,ai as hn,aj as xn,ak as bn,al as vn,am as yn,an as wn,ao as En,ap as Rn,aq as mr,ar as gr,as as Sn,at as _n,au as va,av as Ft,aw as He,Q as ya,ax as wa,ay as Ea,az as Ra,aA as Sa,aB as _a,aC as Aa,aD as Ta,aE as sr,aF as Ma,d as Pa}from"./parse-overlay-DINDim2m.js";const hr=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function An(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"premultiplied",usage:hr}),{hdr:!1,format:r}}function Da(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:hr}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:hr}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return An(e,t)}}}const ka=`
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
`,Ba=`
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
`;class Ca extends Error{constructor(r){super(r);N(this,"deviceLost",!0);this.name="DeviceLostError"}}async function Br(e,t){try{await e.mapAsync(GPUMapMode.READ)}catch(r){if((r instanceof Error?r.name:"")==="AbortError"){const a=t.info;throw new Ca("webgpu readback: buffer map aborted — device lost or destroyed mid-readback"+(a?` (reason=${String(a.reason)}${a.message?`: ${a.message}`:""})`:"")+`: ${r instanceof Error?r.message:String(r)}`)}throw r instanceof Error?r:new Error(String(r))}}function xr(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Tn(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function La(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let a;return r===0?a=n/1024*Math.pow(2,-14):r===31?a=n?NaN:1/0:a=(1+n/1024)*Math.pow(2,r-15),t?-a:a}const Ga={texture:0,sampler:1,uniform:2};function or(e,t){return e*3+Ga[t]}const Oa={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Ua(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const a=Number(n[1]),s=n[2]!==void 0,o=n[3].trim();if(s){const i=Oa[o];if(i===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${o}" (binding ${a}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(a,{kind:"uniform",sizeBytes:i})}else o==="sampler"||o==="sampler_comparison"?t.set(a,{kind:"sampler"}):t.set(a,{kind:"texture"})}return t}class Cr{constructor(t,r,n,a){N(this,"width");N(this,"height");N(this,"format");N(this,"gpuTexture");N(this,"device");N(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=a,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:xr(a),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*Tn(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class Lr{constructor(t){N(this,"_s");N(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Fa{constructor(t,r,n,a,s){N(this,"_p");N(this,"gpuPipeline");N(this,"bindings");N(this,"bindGroupLayout");N(this,"variants");N(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=s,this.variants=new Map([[a,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function Ia(e,t){const r=[];for(const[n,a]of t)a.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):a.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class Na{constructor(t){N(this,"_c");N(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class za{constructor(t,r,n,a,s){N(this,"width");N(this,"height");N(this,"paramsBuffer");N(this,"bindGroup");N(this,"buffers");N(this,"destroyed",!1);this.width=t,this.height=r,this.buffers=n,this.paramsBuffer=a,this.bindGroup=s}destroy(){if(!this.destroyed){for(const t of this.buffers)t.destroy();this.paramsBuffer.destroy(),this.destroyed=!0}}}class Va{constructor(t,r){N(this,"_b");N(this,"gpuBindGroup");N(this,"ownedBuffers");N(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class $a{constructor(t,r,n,a){N(this,"canvas");N(this,"hdr");N(this,"format");N(this,"context");N(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=a}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function Ot(e){return"canvas"in e}async function Wa(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function a(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function s(l){return Ot(l)?l.getCurrentTextureView():l.gpuTexture.createView()}function o(l){if(Ot(l))return{width:l.canvas.width,height:l.canvas.height};const b=l;return{width:b.width,height:b.height}}let i=!1;const u={};t.lost.then(l=>{u.info=l},()=>{});let d=null;function p(){var b,w;if(d!==null)return d;let l=!1;try{if(typeof document<"u"){const E=document.createElement("canvas");E.width=1,E.height=1;const A=E.getContext("webgpu");if(A)try{A.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:GPUTextureUsage.RENDER_ATTACHMENT});const G=(b=A.getConfiguration)==null?void 0:b.call(A);l=((w=G==null?void 0:G.toneMapping)==null?void 0:w.mode)==="extended"}catch{l=!1}finally{try{A.unconfigure()}catch{}}}}catch{l=!1}return d=l,l}const g=256;let m=null,v=null;function y(){if(!m||!v){const l=t.createShaderModule({code:ka});v=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const b=t.createPipelineLayout({bindGroupLayouts:[v]});m=t.createComputePipeline({layout:b,compute:{module:l,entryPoint:"cs_main"}})}return{pipeline:m,layout:v}}let M=null,R=null;function B(){if(!M||!R){const l=t.createShaderModule({code:Ba});R=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const b=t.createPipelineLayout({bindGroupLayouts:[R]});M=t.createRenderPipeline({layout:b,vertex:{module:l,entryPoint:"vs_main"},fragment:{module:l,entryPoint:"fs_main",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}})}return{pipeline:M,layout:R}}return{backend:"webgpu",capabilities:r,probeExtendedToneMapping:p,createTexture(l,b,w){return new Cr(t,l,b,w)},createSampler(l){const b=(l==null?void 0:l.filter)==="linear"?"linear":"nearest",w=t.createSampler({magFilter:b,minFilter:b,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new Lr(w)},createRenderPipeline(l){const b=t.createShaderModule({code:l.shaderWGSL}),w=Ua(l.shaderWGSL),E=xr(l.targetFormat),A=Ia(t,w),G=t.createPipelineLayout({bindGroupLayouts:[A]}),z=k=>t.createRenderPipeline({layout:G,vertex:{module:b,entryPoint:"vs_main"},fragment:{module:b,entryPoint:"fs_main",targets:[{format:k}]},primitive:{topology:"triangle-list"}}),C=z(E);return new Fa(C,w,A,E,z)},createComputePipeline(l){const b=t.createShaderModule({code:l.shaderWGSL}),w=t.createComputePipeline({layout:"auto",compute:{module:b,entryPoint:"cs_main"}});return new Na(w)},createBindGroup(l,b){const w=l,E=new Map,A=[];for(const[z,C]of w.bindings)if(C.kind==="uniform"){const k=t.createBuffer({size:C.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});A.push(k),E.set(z,{binding:z,resource:{buffer:k}})}else C.kind==="sampler"&&E.set(z,{binding:z,resource:a()});for(const z of b){const C=z.resource;if(C instanceof Cr){const k=or(z.binding,"texture");w.bindings.has(k)&&E.set(k,{binding:k,resource:C.gpuTexture.createView()})}else if(C instanceof Lr){const k=or(z.binding,"sampler");w.bindings.has(k)&&E.set(k,{binding:k,resource:C.gpuSampler})}else{const k=or(z.binding,"uniform"),J=w.bindings.get(k);if(J&&J.kind==="uniform"){const Z=C.uniform,H=t.createBuffer({size:Math.max(J.sizeBytes,Z.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(H,0,Z.buffer,Z.byteOffset,Z.byteLength),A.push(H),E.set(k,{binding:k,resource:{buffer:H}})}}}const G=t.createBindGroup({layout:w.bindGroupLayout,entries:Array.from(E.values())});return new Va(G,A)},createSurface(l,b){const w=l.getContext("webgpu");if(!w)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const E=b.hdr&&r.hdr,A=()=>E?Da(w,t):An(w,t),G=A();return new $a(l,w,G,A)},renderFullscreen(l,b,w){const E=b,A=w,G=s(l),{width:z,height:C}=o(l),k=Ot(l)?l.format:xr(l.format),J=E.pipelineFor(k),Z=t.createCommandEncoder(),H=Z.beginRenderPass({colorAttachments:[{view:G,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});H.setPipeline(J),H.setBindGroup(0,A.gpuBindGroup),H.setViewport(0,0,z,C,0,1),H.draw(3),H.end(),t.queue.submit([Z.finish()])},createDeepSampleBuffers(l){const{layout:b}=B(),w=k=>{const J=t.createBuffer({size:k.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(J,0,k.buffer,k.byteOffset,k.byteLength),J},E=w(l.offsets),A=w(l.colors),G=w(l.zs),z=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),C=t.createBindGroup({layout:b,entries:[{binding:0,resource:{buffer:E}},{binding:1,resource:{buffer:A}},{binding:2,resource:{buffer:G}},{binding:3,resource:{buffer:z}}]});return new za(l.width,l.height,[E,A,G],z,C)},compositeDeep(l,b,w,E){const A=l,G=b,{pipeline:z}=B();t.queue.writeBuffer(A.paramsBuffer,0,new Float32Array([A.width,A.height,E,w]));const C=t.createCommandEncoder(),k=C.beginRenderPass({colorAttachments:[{view:G.gpuTexture.createView(),loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});k.setPipeline(z),k.setBindGroup(0,A.bindGroup),k.setViewport(0,0,G.width,G.height,0,1),k.draw(3),k.end(),t.queue.submit([C.finish()])},async readback(l){const b=Ot(l),{width:w,height:E}=o(l),A=b?l.hdr?"rgba16float":"rgba8unorm":l.format,G=b&&l.format==="bgra8unorm",z=b?l.getCurrentGPUTexture():l.gpuTexture,C=Tn(A),k=w*C,J=256,Z=Math.ceil(k/J)*J,H=Z*E,W=t.createBuffer({size:H,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),de=t.createCommandEncoder();de.copyTextureToBuffer({texture:z},{buffer:W,bytesPerRow:Z,rowsPerImage:E},{width:w,height:E,depthOrArrayLayers:1}),t.queue.submit([de.finish()]);try{await Br(W,u)}catch(F){try{W.destroy()}catch{}throw F}const pe=new Uint8Array(W.getMappedRange()),j=new Uint8Array(k*E);for(let F=0;F<E;F++){const se=F*Z,ne=F*k;j.set(pe.subarray(se,se+k),ne)}if(W.unmap(),W.destroy(),A==="rgba8unorm"){if(G)for(let F=0;F<j.length;F+=4){const se=j[F],ne=j[F+2];j[F]=ne,j[F+2]=se}return j}if(A==="rgba16float"){const F=new Uint16Array(j.buffer,j.byteOffset,j.byteLength/2),se=new Float32Array(F.length);for(let ne=0;ne<F.length;ne++)se[ne]=La(F[ne]);return se}return new Float32Array(j.buffer,j.byteOffset,j.byteLength/4)},async reduceDiffSumSquaredAbs(l,b,w,E){const A=l,G=b,z=Math.max(0,w*E),C=Math.max(1,Math.ceil(z/g)),{pipeline:k,layout:J}=y(),Z=C*2*4,H=t.createBuffer({size:Z,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),W=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(W,0,new Uint32Array([Math.max(1,w),Math.max(1,E),z,0]));const de=t.createBindGroup({layout:J,entries:[{binding:0,resource:A.gpuTexture.createView()},{binding:1,resource:G.gpuTexture.createView()},{binding:2,resource:{buffer:H}},{binding:3,resource:{buffer:W}}]}),pe=t.createBuffer({size:Z,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),j=t.createCommandEncoder(),F=j.beginComputePass();F.setPipeline(k),F.setBindGroup(0,de),F.dispatchWorkgroups(C),F.end(),j.copyBufferToBuffer(H,0,pe,0,Z),t.queue.submit([j.finish()]);try{await Br(pe,u)}catch(oe){for(const we of[pe,H,W])try{we.destroy()}catch{}throw oe}const ne=new Float32Array(pe.getMappedRange()).slice();pe.unmap(),pe.destroy(),H.destroy(),W.destroy();let ce=0,Be=0;for(let oe=0;oe<C;oe++)ce+=ne[oe*2],Be+=ne[oe*2+1];return{sumSq:ce,sumAbs:Be}},destroy(){i||(t.destroy(),i=!0)},isContextLost(){return!1}}}let ir=null;async function Ha(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return Wa()}function Yt(){return ir||(ir=Ha()),ir}const Ka=`
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
`,xe=`
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
`,rt=`
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
`,St=`
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
`,qa=`
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
`,jt=`
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
`;function Mn(e){return`
${xe}
${rt}
${qa}

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
`}const Xa=Mn("select(colorB, colorA, uv.x < split)"),Ya=Mn("mix(colorA, colorB, alpha)");function ja(e){switch(e){case"center":return{v:"center",h:"center"};case"top-right":return{v:"top",h:"right"};case"bottom-left":return{v:"bottom",h:"left"};case"bottom-right":return{v:"bottom",h:"right"};case"top-left":default:return{v:"top",h:"left"}}}function Gr(e,t,r){const{v:n,h:a}=ja(r),s=e.w-t.w,o=e.h-t.h,i=a==="left"?0:a==="right"?s:Math.floor(s/2),u=n==="top"?0:n==="bottom"?o:Math.floor(o/2);return{x:i,y:u}}function _t(e,t,r,n,a="b"){if(n==="fill"){const o=a==="a"?{w:e.w,h:e.h}:{w:t.w,h:t.h};return{fit:n,result:o,offsetA:{x:0,y:0},offsetB:{x:0,y:0}}}const s={w:Math.min(e.w,t.w),h:Math.min(e.h,t.h)};return{fit:n,result:s,offsetA:Gr(e,s,r),offsetB:Gr(t,s,r)}}function wr(e){return`${e.fit}:${e.result.w}x${e.result.h}:${e.offsetA.x},${e.offsetA.y}:${e.offsetB.x},${e.offsetB.y}`}const It={linear:0,srgb:1,reinhard:2,aces:3,extended:4,"extended-reinhard":5,"extended-aces":6,"extended-clamp":7,gamma:8},Or=new WeakMap;function Za(e,t){let r=Or.get(e);r||(r=new Map,Or.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:Ka,targetFormat:t}),r.set(t,n)),n}function Pn(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Dn(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function Qa(e,t,r,n){var B;const a=Pn(t),s=Za(e,a),o=Dn(e,n.isScalar?n.colormap:void 0),i=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,u=It[n.operator]??It.srgb,d=new Float32Array([n.exposureEV,u,i,n.isScalar?1:0]),p=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),g=new Float32Array([n.hdrOut?1:0]),m=new Float32Array([n.filter==="nearest"?0:1]),v=new Float32Array([n.offset??0]),y=new Float32Array([n.peak??Xt]),M=new Float32Array([n.srgbDecode?1:0]);let R;try{R=e.createBindGroup(s,[{binding:0,resource:r},{binding:1,resource:o},{binding:2,resource:{uniform:d}},{binding:3,resource:{uniform:p}},{binding:4,resource:{uniform:g}},{binding:5,resource:{uniform:m}},{binding:6,resource:{uniform:v}},{binding:7,resource:{uniform:y}},{binding:8,resource:{uniform:M}}]),e.renderFullscreen(t,s,R)}finally{(B=R==null?void 0:R.destroy)==null||B.call(R),o.destroy()}}const Ur=new WeakMap;function Ja(e,t,r){let n=Ur.get(e);n||(n=new Map,Ur.set(e,n));const a=`${t}:${r}`;let s=n.get(a);return s||(s=e.createRenderPipeline({shaderWGSL:t==="split"?Xa:Ya,targetFormat:r}),n.set(a,s)),s}function es(e,t,r,n,a){var M;if(a.mode==="diff")throw new Error("renderCompose: mode 'diff' is handled by the diff-engine, not renderCompose");const s=Pn(t),o=Ja(e,a.mode,s),i=Dn(e,a.isScalar?a.colormap:void 0),u=typeof a.gamma=="number"&&a.gamma>0?a.gamma:0,d=It[a.operator]??It.srgb,p=new Float32Array([a.exposureEV,d,u,a.isScalar?1:0]),g=new Float32Array([a.uv.x,a.uv.y,a.uv.w,a.uv.h]),m=new Float32Array([a.split,a.alpha,a.hdrOut?1:0,a.filter==="nearest"?0:1]),v=new Float32Array([a.offset??0,a.peak??Xt,a.srgbDecodeA?1:0,a.srgbDecodeB?1:0]);let y;try{y=e.createBindGroup(o,[{binding:0,resource:r},{binding:1,resource:n},{binding:2,resource:i},{binding:3,resource:{uniform:p}},{binding:4,resource:{uniform:g}},{binding:5,resource:{uniform:m}},{binding:6,resource:{uniform:v}}]),e.renderFullscreen(t,o,y)}finally{(M=y==null?void 0:y.destroy)==null||M.call(y),i.destroy()}}function Fr(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,a=t/r,s=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:s,mae:a}}async function kn(e,t,r,n){const a=n??_t({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),s=a.result.w,o=a.result.h,i=s*o*3;if(i<=0)return{mse:0,psnr:1/0,mae:0};if(a.fit==="crop"&&a.offsetA.x===0&&a.offsetA.y===0&&a.offsetB.x===0&&a.offsetB.y===0&&e.reduceDiffSumSquaredAbs){const{sumSq:l,sumAbs:b}=await e.reduceDiffSumSquaredAbs(t,r,s,o);return Fr(l,b,i)}const d=await e.readback(t),p=await e.readback(r),g=d instanceof Uint8Array?255:1,m=p instanceof Uint8Array?255:1,v=Nt(d,t.width,t.height,g,a.offsetA,a.fit==="fill",s,o),y=Nt(p,r.width,r.height,m,a.offsetB,a.fit==="fill",s,o);let M=0,R=0;const B=[0,0,0],x=[0,0,0];for(let l=0;l<o;l++)for(let b=0;b<s;b++){v(b,l,B),y(b,l,x);for(let w=0;w<3;w++){const E=B[w]-x[w];M+=E*E,R+=Math.abs(E)}}return Fr(M,R,i)}function Nt(e,t,r,n,a,s,o,i){const u=(g,m,v)=>e[(m*t+g)*4+v]??0;if(!s)return(g,m,v)=>{const y=Math.min(Math.max(g+a.x,0),t-1),M=Math.min(Math.max(m+a.y,0),r-1);v[0]=u(y,M,0)/n,v[1]=u(y,M,1)/n,v[2]=u(y,M,2)/n};const d=t-1,p=r-1;return(g,m,v)=>{const y=(g+.5)/o,M=(m+.5)/i,R=y*t-.5,B=M*r-.5,x=Math.floor(R),l=Math.floor(B),b=R-x,w=B-l,E=Math.min(Math.max(x,0),d),A=Math.min(Math.max(x+1,0),d),G=Math.min(Math.max(l,0),p),z=Math.min(Math.max(l+1,0),p);for(let C=0;C<3;C++){const k=u(E,G,C),J=u(A,G,C),Z=u(E,z,C),H=u(A,z,C),W=k+(J-k)*b,de=Z+(H-Z)*b;v[C]=(W+(de-W)*w)/n}}}function Bn(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const ts=12,Ye=[];function Ir(e){const t=Ye.indexOf(e);t!==-1&&Ye.splice(t,1),Ye.push(e)}function rs(e){const t=Ye.indexOf(e);t!==-1&&Ye.splice(t,1)}function zt(e){e.parked||(rs(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),e.surface=null,e.parked=!0)}function Nr(e){for(;Ye.length>ts;){const t=Ye.find(r=>r!==e&&!r.visible)??Ye.find(r=>r!==e);if(!t)break;zt(t)}}function Cn(e){var a,s,o,i;if(e.disposed)return;if(Bn())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Ir(e),Nr(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const r=e.backingWidth||((a=e.source)==null?void 0:a.width)||((s=e.deep)==null?void 0:s.width)||1,n=e.backingHeight||((o=e.source)==null?void 0:o.height)||((i=e.deep)==null?void 0:i.height)||1;if(e.canvas.width=r,e.canvas.height=n,e.surface.configure(r,n),e.deep){const u=t.createTexture(e.deep.width,e.deep.height,"rgba16float");e.srcTexture=u,e.deepBuffers=t.createDeepSampleBuffers(e.deep),t.compositeDeep(e.deepBuffers,u,e.deepZNear,e.deepZFar)}else if(e.source){const u=t.createTexture(e.source.width,e.source.height,e.source.format);u.write(e.source.data),e.srcTexture=u}e.parked=!1,Ir(e),Nr(e)}function ns(e,t){if(e.disposed||!e.source&&!e.deep)return!0;try{return Cn(e),!e.surface||!e.srcTexture?!1:(Qa(e.device,e.surface,e.srcTexture,t),!0)}catch(r){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",r),e.parked=!1,zt(e),!1}}function as(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,e.deep=null,e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const r=e.device.createTexture(t.width,t.height,t.format);r.write(t.data),e.srcTexture=r}},setDeepSource(t,r,n){if(!e.disposed&&(e.deep=t,e.deepZNear=r,e.deepZFar=n,e.source=null,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy(),e.deepBuffers&&e.deepBuffers.destroy();const a=e.device.createTexture(t.width,t.height,"rgba16float");e.srcTexture=a,e.deepBuffers=e.device.createDeepSampleBuffers(t),e.device.compositeDeep(e.deepBuffers,a,r,n)}},setDeepWindow(t,r){e.disposed||(e.deepZNear=t,e.deepZFar=r,!e.parked&&e.deepBuffers&&e.srcTexture&&e.device.compositeDeep(e.deepBuffers,e.srcTexture,t,r))},resize(t,r){if(e.disposed)return;const n=Math.max(1,Math.round(t)),a=Math.max(1,Math.round(r));e.backingWidth===n&&e.backingHeight===a||(e.backingWidth=n,e.backingHeight=a,!e.parked&&e.surface&&(e.canvas.width=n,e.canvas.height=a,e.surface.configure(n,a)))},render(t){return ns(e,t)},park(){e.disposed||zt(e)},restore(){e.disposed||!e.source&&!e.deep||Cn(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(zt(e),e.source=null,e.deep=null,e.disposed=!0)}}}async function ss(e,t){const r=await Yt(),n={canvas:e,device:r,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,deep:null,deepZNear:-1/0,deepZFar:1/0,deepBuffers:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return as(n)}function zr(e){e.dispose()}const Vr={"no-webgpu":0,"no-hdr-browser":1,"no-hdr-display":2},os="https://github.com/doeringchristian/cairn-plot/blob/main/docs/browser-support.md";function is(e,t=!1){const r=e||"";return t?"brave":/firefox/i.test(r)?"firefox":/safari/i.test(r)&&!/chrome|chromium|crios|android/i.test(r)?"safari":/linux/i.test(r)&&/chrome|chromium/i.test(r)?"chromium-linux":"chromium"}function cs(e){const t=e||"";return/mac os x|macintosh/i.test(t)?"macos":/windows/i.test(t)?"windows":"other"}function us(e,t){if(e==="no-hdr-display")switch(cs(t.userAgent)){case"macos":return"macOS: EDR engages automatically on HDR-capable displays — confirm your display supports HDR.";case"windows":return"Windows: turn on Settings → System → Display → Use HDR.";default:return"Enable HDR in your display and OS settings."}const r=is(t.userAgent,t.isBrave);if(e==="no-hdr-browser")switch(r){case"firefox":return"Firefox has no extended-tone-mapping canvas path at all — true HDR output is impossible until Firefox implements it (fundamental browser limitation).";case"safari":return"Safari's WebGPU HDR canvas tone-mapping is still maturing — update to the latest Safari 26+.";default:return"Chrome/Edge 129+ is required for HDR canvas output (toneMapping: extended) — update your browser."}switch(r){case"firefox":return"Firefox: about:config → dom.webgpu.enabled (HDR output is not available in Firefox at all — browser limitation).";case"safari":return"Safari: Develop → Feature Flags → WebGPU (Safari 26+ has it by default).";case"brave":return"Brave: check Shields fingerprint blocking + brave://flags.";case"chromium-linux":return"Chromium on Linux: enable chrome://flags/#enable-unsafe-webgpu.";case"chromium":default:return"Chrome/Edge: enable chrome://flags/#enable-unsafe-webgpu and hardware acceleration."}}function ls(e){switch(e){case"no-webgpu":return"GPU renderer unavailable → CPU fallback active; FLIP kernels + HDR compare disabled.";case"no-hdr-browser":return"True HDR output is unsupported by this browser — a fundamental browser limitation, not a cairn-plot bug → HDR images tone-mapped to SDR.";case"no-hdr-display":return"Your display/OS is not in HDR mode → HDR images tone-mapped to SDR."}}function Ln(e,t){return`cairn-plot:capnotice:${e}:${t}`}const Gn=new Set;function $r(e){try{if(window.localStorage.getItem(e)==="1")return!0}catch{}try{if(window.sessionStorage.getItem(e)==="1")return!0}catch{}return Gn.has(e)}function fs(e){try{window.localStorage.setItem(e,"1");return}catch{}try{window.sessionStorage.setItem(e,"1");return}catch{}Gn.add(e)}const Wr=new Set;let Vt=null,ut=null;function On(){ut&&ut.parentNode&&ut.parentNode.removeChild(ut),ut=null,Vt=null}function ds(e){const t=Ln(e,window.location.pathname),r=us(e,{userAgent:navigator.userAgent,isBrave:!!navigator.brave}),n=document.createElement("div");n.setAttribute("role","status"),n.setAttribute("data-cairn-plot-capnotice",e),Object.assign(n.style,{position:"fixed",bottom:"12px",right:"12px",zIndex:"2147483000",maxWidth:"340px",boxSizing:"border-box",padding:"10px 30px 10px 12px",borderRadius:"6px",border:"1px solid var(--color-border, #d0d7de)",background:"rgb(var(--color-bg-elevated-rgb, 246 248 250) / 0.9)",color:"var(--color-fg-muted, #656d76)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",boxShadow:"0 4px 12px rgba(0, 0, 0, 0.18)",font:"12px/1.4 system-ui, sans-serif"});const a=document.createElement("div");a.textContent=ls(e),Object.assign(a.style,{fontWeight:"600",color:"var(--color-fg, #1f2328)",marginBottom:"4px"});const s=document.createElement("div");s.textContent=r,s.style.marginBottom="4px";const o=document.createElement("a");o.href=os,o.target="_blank",o.rel="noopener noreferrer",o.textContent="Learn more",Object.assign(o.style,{color:"var(--color-accent, #0969da)",textDecoration:"none"});const i=document.createElement("button");i.type="button",i.textContent="×",i.setAttribute("aria-label","Dismiss browser capability notice"),i.title="Dismiss",Object.assign(i.style,{position:"absolute",top:"4px",right:"6px",padding:"0 4px",border:"0",background:"transparent",color:"var(--color-fg-subtle, #8b949e)",cursor:"pointer",fontSize:"16px",lineHeight:"1"}),i.addEventListener("click",()=>{fs(t),On()}),n.appendChild(a),n.appendChild(s),n.appendChild(o),n.appendChild(i),document.body.appendChild(n),ut=n,Vt=e}function Un(e){if(typeof document>"u"||typeof window>"u"||Wr.has(e))return;Wr.add(e);const t=Ln(e,window.location.pathname);if($r(t))return;const r=()=>{if(!$r(t)){if(Vt!==null)if(Vr[e]<Vr[Vt])On();else return;ds(e)}};document.body?r():window.addEventListener("DOMContentLoaded",r,{once:!0})}const ps={data:new Float32Array(0),shape:[0,0],dtype:"<f4"};function ms(e){const{h:t,w:r,c:n}=va(e.shape);if(e.precision==="f16-bits"){const o=e.data,i=new Uint16Array(r*t*4);for(let u=0;u<r*t;u++){const d=u*n,p=u*4;if(n===1){const g=o[d];i[p]=g,i[p+1]=g,i[p+2]=g,i[p+3]=Ft}else i[p]=o[d],i[p+1]=o[d+1],i[p+2]=o[d+2],i[p+3]=n>=4?o[d+3]:Ft}return{data:i,width:r,height:t,format:"rgba16float"}}const a=e.data,s=new Float32Array(r*t*4);for(let o=0;o<r*t;o++){const i=o*n;let u,d,p,g=1;n===1?u=d=p=He(a[i]):n===3?(u=He(a[i]),d=He(a[i+1]),p=He(a[i+2])):(u=He(a[i]),d=He(a[i+1]),p=He(a[i+2]),g=He(a[i+3]));const m=o*4;s[m]=u,s[m+1]=d,s[m+2]=p,s[m+3]=g}return{data:s,width:r,height:t,format:"rgba32float"}}function Fn(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const a=Math.min(t.width/r,t.height/n),s=r*a,o=n*a,i=(t.width-s)/2,u=(t.height-o)/2,d=Math.max(e.zoom,1e-6),p=t.width/(d*s),g=t.height/(d*o),m=-i/s-e.pan.x/(d*s),v=-u/o-e.pan.y/(d*o);return{x:m,y:v,w:p,h:g}}function In(e,t,r,n){const a=e.w*r,s=e.h*n;return a<=0||s<=0||t.width<=0||t.height<=0?0:Math.min(t.width/a,t.height/s)}function gs(e){var mt,ye,gt;const t=fa(e),r=da(t),n=f.useRef(null),a=f.useRef(null),s=f.useRef(null),o=f.useRef(null),i=f.useRef(null),u=r&&!!((mt=t.hdr)!=null&&mt.deep),d=f.useCallback((h,U)=>{var D,P;(D=o.current)==null||D.setDeepWindow(h,U),(P=i.current)==null||P.call(i)},[]),p=pa(r?t.hdr:ps,u?d:void 0),g=f.useRef(!1),[m,v]=f.useState(!1),[y,M]=f.useState(!1),[R,B]=f.useState(!1),[x,l]=f.useState(null),[b,w]=f.useState(0),[E,A]=f.useState(0),[G,z]=f.useState({x:0,y:0,w:1,h:1}),C=f.useRef(null),k=f.useRef(null),[J,Z]=f.useState(0),H=t.zoom??1,W=t.pan??{x:0,y:0},de=t.onViewportChange,pe=t.toolbar??!0,j=r?"none":t.colormap??"none",[F,se,ne]=qe(j);f.useEffect(()=>{se(j)},[j,se]);const ce=r?"none":F,Be=t.tonemap,[oe,we]=f.useState(null);f.useEffect(()=>{we(null)},[Be]);const ee=Sn(Be),Ee=oe??ee,lt=oe!==null&&oe!==ee,Zt=f.useCallback(()=>we(null),[]),Ce=t.peak,At=()=>Ce!=null&&Ce>0?Ce:_n(Be)??Xt,[je,Ze,Ne]=qe(At());f.useEffect(()=>{Ze(At())},[Ce,Be]);const Re=t.gamma,[Se,be,Le]=qe(Re&&Re>0?Re:cn);f.useEffect(()=>{Re&&Re>0&&be(Re)},[Re,be]);const[_e,Tt]=f.useState(0),[te,Qe]=f.useState(0),ft=f.useCallback(h=>{h.colormap!==void 0&&se(h.colormap),h.tonemap!==void 0&&we(h.tonemap),h.tonemapGamma!==void 0&&be(h.tonemapGamma),h.peak!==void 0&&Ze(h.peak),h.exposureEV!==void 0&&Tt(h.exposureEV),h.offset!==void 0&&Qe(h.offset)},[se,we,be,Ze]),Ae=f.useCallback(()=>({colormap:ce,tonemap:Ee,tonemapGamma:Se,peak:je,exposureEV:_e,offset:te}),[ce,Ee,Se,je,_e,te]),O=un(t.settingsSyncGroupId,!!t.syncIsAnchor,Ae,ft),Je=f.useCallback(h=>{se(h),O({colormap:h})},[se,O]),nt=f.useCallback(h=>{we(h),O({tonemap:h})},[O]),ze=f.useCallback(h=>{Tt(h),O({exposureEV:h})},[O]),ue=f.useCallback(h=>{Qe(h),O({offset:h})},[O]),Te=f.useCallback(h=>{Ze(h),O({peak:h})},[Ze,O]),dt=f.useCallback(h=>{be(h),O({tonemapGamma:h})},[be,O]),et=ln();f.useEffect(()=>{const h=n.current;if(!h)return;let U=!1;return Yt().then(D=>{var fe;if(U)return;const P=((fe=D.probeExtendedToneMapping)==null?void 0:fe.call(D))??!1,$=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,ae=P&&$&&(r||j==="none");g.current=ae,v(ae),r&&!ae&&Un(P?"no-hdr-display":"no-hdr-browser"),ss(h,{hdr:ae}).then(me=>{if(U){zr(me);return}o.current=me,B(!0)}).catch(me=>{U||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",me),M(!0))})}).catch(D=>{U||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",D),M(!0))}),()=>{U=!0,o.current&&(zr(o.current),o.current=null)}},[]),f.useEffect(()=>{const h=a.current;if(!h)return;const U=new ResizeObserver(()=>A(D=>D+1));return U.observe(h),()=>U.disconnect()},[]),f.useEffect(()=>{const h=a.current;if(!h)return;const U=new IntersectionObserver(D=>{const P=D[0];if(!P)return;const $=o.current;$&&($.setVisible(P.isIntersecting),P.isIntersecting?$.isParked&&($.restore(),A(V=>V+1)):$.park())},{threshold:0});return U.observe(h),()=>U.disconnect()},[]),f.useEffect(()=>{var D;if(!r||!R||u)return;const h=p.hdr;C.current=h;const U=ms(h);(D=o.current)==null||D.setSource(U),l(P=>P&&P.w===U.width&&P.h===U.height?P:{w:U.width,h:U.height}),Z(P=>P+1),w(P=>P+1)},[r,R,u,r?p.hdr:null]),f.useEffect(()=>{if(!r||!R||!u)return;const h=t.hdr,U=h.deep;C.current=h;let D=!1;return U.getGpuCsr().then(P=>{var $;D||(($=o.current)==null||$.setDeepSource(P,U.zMin,U.zMax),l(V=>V&&V.w===P.width&&V.h===P.height?V:{w:P.width,h:P.height}),Z(V=>V+1),w(V=>V+1))}).catch(P=>{D||console.warn("[cairn] deep GPU CSR upload failed:",P)}),()=>{D=!0}},[r,R,u,r?t.hdr.deep:null]),f.useEffect(()=>{if(r||!R)return;const h=t,U=h.imageUrl,D=F;if(!U){k.current=null,l(null),Z($=>$+1);return}let P=!1;return fn(U).then($=>{var fe,me;if(P||!$)return;let V=$;if(D!=="none"){const q=`gpu::${U}::${D}::ev${_e}::off${te}`,Ue=ma(q);if(Ue)V=Ue;else{const Fe=ga(D);V=ha($,D,Fe,_e,te),xa(q,V)}}k.current=$;const ae={data:V.data,width:V.width,height:V.height,format:"rgba8unorm"};(fe=o.current)==null||fe.setSource(ae),l(q=>q&&q.w===V.width&&q.h===V.height?q:{w:V.width,h:V.height}),(me=h.onNaturalSize)==null||me.call(h,V.width,V.height),Z(q=>q+1),w(q=>q+1)}),()=>{P=!0}},[r,R,r?null:t.imageUrl,r?null:F,r?0:_e,r?0:te]);const Ge=t.exposure??0,pt=t.offset??0,le=!r&&ce==="none",at=f.useCallback(()=>{const h=o.current;if(!h||!R||!x)return;const U=a.current,D=s.current,P=D?D.getBoundingClientRect():U?U.getBoundingClientRect():{width:x.w,height:x.h},$=Fn({zoom:H,pan:W},P,x.w,x.h);z(q=>q.x===$.x&&q.y===$.y&&q.w===$.w&&q.h===$.h?q:$),P.width>0&&P.height>0&&h.resize(Math.round(P.width*et),Math.round(P.height*et));const V=In($,P,x.w,x.h)>=dn?"nearest":"linear",ae=$,fe=pn(Ee,g.current?je:1,g.current,Se),me=r||le?{exposureEV:Ge+_e,offset:pt+te,operator:fe.operator,gamma:fe.gamma,isScalar:!1,hdrOut:fe.hdrOut,peak:fe.peak,srgbDecode:!r,uv:ae,filter:V}:{exposureEV:0,offset:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,srgbDecode:!1,uv:ae,filter:V};try{h.render(me)||M(!0)}catch(q){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",q),M(!0)}},[R,x,H,W.x,W.y,Ge,pt,_e,te,Ee,je,Se,le,r,ce,et]);i.current=at,f.useEffect(()=>{at()},[at,b,E]);const Mt=f.useCallback((h,U,D)=>{if(r){const q=C.current,Ue=x;if(!q||!Ue||h<0||U<0||h>=Ue.w||U>=Ue.h)return null;const Fe=q.shape.length===2?1:q.shape[2]??1,ot=(U*Ue.w+h)*Fe,ht=q.data,tt=q.precision==="f16-bits"?it=>mn(ht[it]??0):it=>ht[it]??0,Pt=Fe===1?[tt(ot)]:[tt(ot),tt(ot+1),tt(ot+2)];return Et(Pt,"unit",D)}const P=k.current;if(!P||h<0||U<0||h>=P.width||U>=P.height)return null;const $=(U*P.width+h)*4,V=P.data[$],ae=P.data[$+1],fe=P.data[$+2];return Et(ce!=="none"||V===ae&&ae===fe?[V]:[V,ae,fe],"uint8",D)},[r,x,ce]),Me=t.showAxes??!1,Ve=r?t.label??"":t.label,st=t.interpolation??"auto",Oe=st==="auto"?void 0:st,ve=r?void 0:t.overlay,$e=r?void 0:t.overlaySettings,Qt=r?!1:t.isDraggable??!1,Jt=r?void 0:t.onDragStart;if(y)return Q.jsx(gn,{...e});const Pe=ve&&($e!=null&&$e.enabled)&&x&&((((ye=ve.boxes)==null?void 0:ye.length)??0)>0||(((gt=ve.masks)==null?void 0:gt.length)??0)>0)?Q.jsx(ba,{data:ve,settings:$e,naturalWidth:x.w,naturalHeight:x.h}):void 0;return Q.jsx(hn,{paneAttrs:{"data-gpu-image-pane":"","data-gpu-backend-ready":R},viewportAttrs:{"data-gpu-image-viewport":""},toolbar:pe,paneRef:a,wrapperRef:s,zoom:H,pan:W,onViewportChange:de,naturalDims:x,checkerboard:"wrapper",wrapperClassName:"relative w-full h-full flex items-center justify-center",viewportPadding:Me&&x?"16px 4px 4px 28px":0,surface:Q.jsx("canvas",{ref:n,className:"w-full h-full block",style:{imageRendering:Oe},"data-gpu-image-canvas":!0}),showAxes:Me,overlayNode:Pe,overlay:{displayElRef:n,sample:Mt,version:J,hasSource:!0,sourceWindow:G},notationSeed:t.pixelValueNotation??"decimal",exportCanvasRef:n,requestRender:at,leadingMenus:r?[mr(Ee,h=>nt(h))]:le?[gr(ce,h=>Je(h)),mr(Ee,h=>nt(h))]:[gr(ce,h=>Je(h))],displayAdjust:{exposureEV:_e,offset:te,onExposureChange:ze,onOffsetChange:ue},extraSliders:[...(r||le)&&m?[{id:"peak",label:"PK",title:"Peak white (×SDR white) — the HDR ceiling P every operator clips at (Linear/sRGB/Gamma hard-clip at P; Reinhard/ACES roll off toward P). P=1 reproduces the SDR rendition exactly; double-click to type a value, including 'inf' for the raw browser-clipped extended look.",min:vn,max:bn,step:xn,value:je,onChange:Te,format:h=>Number.isFinite(h)?`${h.toFixed(1)}×`:"∞"}]:[],...(r||le)&&Rn(Ee)?[{id:"gamma",label:"γ",title:"Display gamma γ for the Gamma transfer — display = clamp(value)^(1/γ), tev-style. Default 2.2 (close to sRGB, not identical). Double-click to type a value.",min:En,max:wn,step:yn,value:Se,onChange:dt,format:h=>h.toFixed(1)}]:[]],depthSliders:p.sliders,regionSelect:u?{rect:p.region,queryLive:p.queryRegionWindow,commit:p.commitRegion,remove:p.removeRegion}:void 0,onReset:()=>{ne.reset(),Zt(),Ne.reset(),Le.reset(),p.reset()},extraModified:ne.isModified||lt||Ne.isModified||Le.isModified||p.isModified,label:Ve,showLabelChip:!!Ve,isDraggable:Qt,onDragStart:Jt})}const $t=new Map;function De(e){if($t.has(e.id))throw new Error(`registerDiffKernel: duplicate kernel id "${e.id}"`);$t.set(e.id,e)}function Xe(e){return $t.get(e)}function hs(){return Array.from($t.values())}function Nn(e,t){return{...e.params??{},...t??{}}}const xs={kind:"pointwise",id:"signed",label:"Signed Error",publicName:"signed",displayRange:"signed",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(a.rgb - b.rgb, 1.0);
}
`},bs={kind:"pointwise",id:"absolute",label:"Absolute Error",publicName:"abs",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(abs(a.rgb - b.rgb), 1.0);
}
`},vs={kind:"pointwise",id:"squared",label:"Squared Error",publicName:"square",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let d = a.rgb - b.rgb;
  return vec4<f32>(d * d, 1.0);
}
`},ys={kind:"pointwise",id:"relative_signed",label:"Relative Signed",publicName:"rel_signed",displayRange:"signed",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  return vec4<f32>((a.rgb - b.rgb) / denom, 1.0);
}
`},ws={kind:"pointwise",id:"relative_absolute",label:"Relative Absolute",publicName:"rel_abs",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  return vec4<f32>(abs(a.rgb - b.rgb) / denom, 1.0);
}
`},Es={kind:"pointwise",id:"relative_squared",label:"Relative Squared",publicName:"rel_square",displayRange:"unit",output:"per-channel",source:`
fn kernel(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let denom = max(a.rgb, vec3<f32>(1.0 / 255.0));
  let d = a.rgb - b.rgb;
  return vec4<f32>((d * d) / (denom * denom), 1.0);
}
`},zn=[[10135552/24577794,8788810/24577794,4435075/24577794],[2613072/12288897,8788810/12288897,887015/12288897],[1425312/73733382,8788810/73733382,70074185/73733382]];Ss(zn);const cr=[1.052156925,1,.91835767],Rs=.7;function Ss(e){const[t,r,n]=e[0],[a,s,o]=e[1],[i,u,d]=e[2],p=s*d-o*u,g=-(a*d-o*i),m=a*u-s*i,y=1/(t*p+r*g+n*m);return[[p*y,-(r*d-n*u)*y,(r*o-n*s)*y],[g*y,(t*d-n*i)*y,-(t*o-n*a)*y],[m*y,-(t*u-r*i)*y,(t*s-r*a)*y]]}function _s(e,t,r,n){return[e[0][0]*t+e[0][1]*r+e[0][2]*n,e[1][0]*t+e[1][1]*r+e[1][2]*n,e[2][0]*t+e[2][1]*r+e[2][2]*n]}const ur=6/29;function lr(e){return e>ur**3?Math.cbrt(e):e/(3*ur*ur)+4/29}function Hr(e,t,r){const[n,a,s]=_s(zn,e,t,r),o=lr(n*cr[0]),i=lr(a*cr[1]),u=lr(s*cr[2]),d=116*i-16,p=500*(o-i),g=200*(i-u);return[d,.01*d*p,.01*d*g]}function As(e,t){const r=e[0]-t[0],n=e[1]-t[1],a=e[2]-t[2];return Math.abs(r)+Math.sqrt(n*n+a*a)}function Ts(){const e=Hr(0,1,0),t=Hr(0,0,1);return Math.pow(As(e,t),Rs)}const Ms=Ts(),Vn=Ms,Ps=.082;function $n(e){const t=[1,1,34.1],r=[.0047,.0053,.04],n=[0,0,13.5],a=[1e-5,1e-5,.025],s=Math.max(...r,...a),o=Math.ceil(3*Math.sqrt(s/(2*Math.PI**2))*e),i=1/e,u=Math.PI**2,d=[0,0,0];for(let p=-o;p<=o;p++)for(let g=-o;g<=o;g++){const m=(g*i)**2+(p*i)**2;for(let v=0;v<3;v++)d[v]+=t[v]*Math.sqrt(Math.PI/r[v])*Math.exp(-u*m/r[v])+n[v]*Math.sqrt(Math.PI/a[v])*Math.exp(-u*m/a[v])}return{r:o,deltaX:i,sums:d}}function Wn(e){const t=.5*Ps*e,r=Math.ceil(3*t);let n=0,a=0,s=0;for(let o=-r;o<=r;o++)for(let i=-r;i<=r;i++){const u=Math.exp(-(i*i+o*o)/(2*t*t)),d=-i*u,p=(i*i/(t*t)-1)*u;d>0&&(n+=d),p>0?a+=p:s-=p}return{r,sd:t,edgeNorm:n,pointPos:a,pointNeg:s}}const Ds=`
${xe}
${jt}
${rt}
${St}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_map0: vec4<f32>; // offX, offY, fitFill, 0
@group(0) @binding(8) var<uniform> u_map1: vec4<f32>; // resultW, resultH, 0, 0
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.position.xy);
  let s = mapSample(src, px, u_map0.x, u_map0.y, u_map1.x, u_map1.y, u_map0.z);
  return vec4<f32>(flip_rgb2ycxcz(s.rgb), 1.0);
}
`,ks=`
${xe}
${jt}
${rt}
${St}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u_map0: vec4<f32>; // offX, offY, fitFill, 0
@group(0) @binding(8) var<uniform> u_map1: vec4<f32>; // resultW, resultH, 0, 0
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.position.xy);
  let s = mapSample(src, px, u_map0.x, u_map0.y, u_map1.x, u_map1.y, u_map0.z);
  return vec4<f32>(flip_linrgb2ycxcz(clamp(s.rgb, vec3<f32>(0.0), vec3<f32>(1.0))), 1.0);
}
`,Wt=`
${xe}
${jt}
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
`,Hn=`
${xe}
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
`;function ke(e,t){return{binding:e,resource:{uniform:new Float32Array(t)}}}function Ht(e,t,r){const n=r.sourceMap,a=n?t==="a"?n.offsetA:n.offsetB:{x:0,y:0},s=n!=null&&n.fill?1:0;return[ke(e,[a.x,a.y,s,0]),ke(e+1,[r.width,r.height,0,0])]}function Kt(e){return[ke(1,[e.deltaX,e.r,e.sums[0],e.sums[1]]),ke(2,[e.sums[2],0,0,0])]}function Kn(e){return[ke(4,[Vn,e.sd,e.r,e.edgeNorm]),ke(5,[e.pointPos,e.pointNeg,0,0])]}function qn(e,t,r,n,a,s=""){const o=$n(e),i=Wn(e),u=`ycxczA${s}`,d=`ycxczB${s}`,p=`labA${s}`,g=`labB${s}`,m=`flip${s}`;return{passes:[{name:u,shader:t,inputs:[r],output:u,uniforms:()=>Ht(1,"a",a)},{name:d,shader:t,inputs:[n],output:d,uniforms:()=>Ht(1,"b",a)},{name:p,shader:Wt,inputs:[u],output:p,uniforms:()=>Kt(o)},{name:g,shader:Wt,inputs:[d],output:g,uniforms:()=>Kt(o)},{name:m,shader:Hn,inputs:[p,g,u,d],output:m,uniforms:()=>Kn(i)}],flipRef:m}}const Bs={kind:"multipass",id:"flip",label:"FLIP (perceptual)",publicName:"flip",displayRange:"unit",output:"scalar",params:{ppd:67},buildPasses(e){const t=e.params.ppd??67,{passes:r,flipRef:n}=qn(t,Ds,"srcA","srcB",e);return{passes:r,final:n}}},Cs={kind:"multipass",id:"flip-ldr-forced",label:"FLIP (LDR forced)",publicName:"flip_ldr",displayRange:"unit",output:"scalar",params:{ppd:67},buildPasses(e){const t=e.params.ppd??67,{passes:r,flipRef:n}=qn(t,ks,"srcA","srcB",e);return{passes:r,final:n}}},Kr=`
${xe}
${jt}
${rt}
${St}
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
`,Ls=`
${xe}
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
`,Gs={kind:"multipass",id:"hdr-flip",label:"FLIP (perceptual)",publicName:"flip_hdr",displayRange:"unit",output:"scalar",params:{ppd:67,startExposure:0,stopExposure:4,numExposures:2},buildPasses(e){const t=e.params.ppd??67,r=e.params.startExposure??0,n=e.params.stopExposure??4,a=Math.max(2,Math.round(e.params.numExposures??2)),s=(n-r)/Math.max(a-1,1),o=$n(t),i=Wn(t),u=[];let d=null;for(let p=0;p<a;p++){const g=r+p*s,m=`_e${p}`,v=`ycxczA${m}`,y=`ycxczB${m}`,M=`labA${m}`,R=`labB${m}`,B=`acc${m}`;u.push({name:v,shader:Kr,inputs:["srcA"],output:v,uniforms:()=>[ke(1,[g,0,0,0]),...Ht(2,"a",e)]},{name:y,shader:Kr,inputs:["srcB"],output:y,uniforms:()=>[ke(1,[g,0,0,0]),...Ht(2,"b",e)]},{name:M,shader:Wt,inputs:[v],output:M,uniforms:()=>Kt(o)},{name:R,shader:Wt,inputs:[y],output:R,uniforms:()=>Kt(o)}),d===null?u.push({name:B,shader:Hn,inputs:[M,R,v,y],output:B,uniforms:()=>Kn(i)}):u.push({name:B,shader:Ls,inputs:[M,R,v,y,d],output:B,uniforms:()=>[ke(5,[Vn,i.sd,i.r,i.edgeNorm]),ke(6,[i.pointPos,i.pointNeg,0,0])]}),d=B}return{passes:u,final:d}}},Xn=.01,Yn=.03,qt=1,br=1.5,Ke=5,fr=[.2126,.7152,.0722];function dr(e){return e<=.04045?e/12.92:Math.pow((e+.055)/1.055,2.4)}function qr(e,t,r){const n=fr[0]*dr(e)+fr[1]*dr(t)+fr[2]*dr(r);return Math.min(1,Math.max(0,n))}function Os(e,t){const r=2*t+1,n=new Float64Array(r);let a=0;for(let s=-t,o=0;s<=t;s++,o++){const i=Math.exp(-.5*s*s/(e*e));n[o]=i,a+=i}for(let s=0;s<r;s++)n[s]=n[s]/a;return n}function Xr(e,t){if(t===1)return 0;const r=2*t;let n=(e%r+r)%r;return n>=t&&(n=r-1-n),n}const jn=()=>new Promise(e=>{typeof setTimeout=="function"?setTimeout(e,0):Promise.resolve().then(e)}),vr=64;async function wt(e,t,r,n,a,s){const o=new Float64Array(t*r);for(let u=0;u<r;u++){for(let d=0;d<t;d++){let p=0;for(let g=-a,m=0;g<=a;g++,m++)p+=n[m]*e[u*t+Xr(d+g,t)];o[u*t+d]=p}(u+1)%vr===0&&await s()}const i=new Float64Array(t*r);for(let u=0;u<r;u++){for(let d=0;d<t;d++){let p=0;for(let g=-a,m=0;g<=a;g++,m++)p+=n[m]*o[Xr(u+g,r)*t+d];i[u*t+d]=p}(u+1)%vr===0&&await s()}return i}async function Us(e,t,r,n,a=jn){const s=r*n;if(s<=0)return NaN;const o=Os(br,Ke),i=new Float64Array(s),u=new Float64Array(s),d=new Float64Array(s);for(let x=0;x<s;x++)i[x]=e[x]*e[x],u[x]=t[x]*t[x],d[x]=e[x]*t[x];const p=await wt(e,r,n,o,Ke,a),g=await wt(t,r,n,o,Ke,a),m=await wt(i,r,n,o,Ke,a),v=await wt(u,r,n,o,Ke,a),y=await wt(d,r,n,o,Ke,a),M=(Xn*qt)**2,R=(Yn*qt)**2;let B=0;for(let x=0;x<s;x++){const l=m[x]-p[x]*p[x],b=v[x]-g[x]*g[x],w=y[x]-p[x]*g[x],E=2*p[x]*g[x]+M,A=2*w+R,G=p[x]*p[x]+g[x]*g[x]+M,z=l+b+R;B+=E*A/(G*z)}return B/s}const Fs=`
fn ssim_srgb2linear(c: f32) -> f32 {
  if (c <= 0.04045) { return c / 12.92; }
  return pow((c + 0.055) / 1.055, 2.4);
}
fn ssim_luma(srgb: vec3<f32>) -> f32 {
  let lin = vec3<f32>(ssim_srgb2linear(srgb.r), ssim_srgb2linear(srgb.g), ssim_srgb2linear(srgb.b));
  return clamp(dot(lin, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
}
`,Zn=`
${xe}
${Fs}
${rt}
${St}
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
`,Is=`
${Zn}
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let y = ssim_moment_luma(in);
  return vec4<f32>(y.x, y.y, y.x * y.x, y.y * y.y);
}
`,Ns=`
${Zn}
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let y = ssim_moment_luma(in);
  return vec4<f32>(y.x * y.y, 0.0, 0.0, 0.0);
}
`,Yr=`
${xe}
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
`,zs=`
${xe}
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
`;function Rt(e,t){return{binding:e,resource:{uniform:new Float32Array(t)}}}function jr(e){const t=e.sourceMap,r=t?t.offsetA:{x:0,y:0},n=t?t.offsetB:{x:0,y:0},a=t!=null&&t.fill?1:0;return[Rt(2,[r.x,r.y,n.x,n.y]),Rt(3,[e.width,e.height,a,0])]}function Zr(e,t){const r=`${t}H`,n=`${t}V`;return{passes:[{name:r,shader:Yr,inputs:[e],output:r,uniforms:()=>[Rt(1,[1,0,Ke,br])]},{name:n,shader:Yr,inputs:[r],output:n,uniforms:()=>[Rt(1,[0,1,Ke,br])]}],out:n}}const Vs={kind:"multipass",id:"ssim",label:"SSIM (1−SSIM)",publicName:"ssim",displayRange:"unit",output:"scalar",buildPasses(e){const t=(Xn*qt)**2,r=(Yn*qt)**2,n=Zr("momA","statsA"),a=Zr("momB","statsB");return{passes:[{name:"momA",shader:Is,inputs:["srcA","srcB"],output:"momA",uniforms:jr},{name:"momB",shader:Ns,inputs:["srcA","srcB"],output:"momB",uniforms:jr},...n.passes,...a.passes,{name:"ssim",shader:zs,inputs:[n.out,a.out],output:"ssim",uniforms:()=>[Rt(2,[t,r,0,0])]}],final:"ssim"}}};let Qr=!1;function $s(){Qr||(Qr=!0,De(bs),De(xs),De(vs),De(ws),De(ys),De(Es),De(Bs),De(Gs),De(Cs),De(Vs))}$s();function Qn(){const e=[];for(const r of hs())r.kind==="pointwise"&&e.push({id:r.id,label:r.label});e.push({id:"flip",label:"FLIP (perceptual)"}),e.push({id:"flip_ldr",label:"FLIP (LDR forced)"});const t=Xe("ssim");return t&&e.push({id:t.id,label:t.label}),e}function Ws(e,t){return e==="flip"?t?"hdr-flip":"flip":e==="flip_ldr"||e==="flip-ldr-forced"?t?"flip-ldr-forced":"flip":e}const Hs=128,Ks=512*1024*1024;class qs{constructor(t=Hs,r=Ks){N(this,"map",new Map);N(this,"totalBytes",0);N(this,"maxEntries");N(this,"maxBytes");this.maxEntries=t,this.maxBytes=r}get(t){const r=this.map.get(t);return r&&(this.map.delete(t),this.map.set(t,r)),r}set(t,r){const n=this.map.get(t);n&&(this.totalBytes-=n.bytes,n.texture.destroy(),this.map.delete(t)),this.map.set(t,r),this.totalBytes+=r.bytes,this.evict()}accountReadbackBytes(t,r){let n=!1;for(const a of this.map.values())if(a===t){n=!0;break}n&&(t.bytes+=r,this.totalBytes+=r,this.evict())}evict(){for(;this.map.size>this.maxEntries||this.totalBytes>this.maxBytes;){const t=this.map.keys().next().value;if(t===void 0)break;const r=this.map.get(t);if(this.map.size===1)break;this.map.delete(t),this.totalBytes-=r.bytes,r.texture.destroy()}}clear(){for(const t of this.map.values())t.texture.destroy();this.map.clear(),this.totalBytes=0}get size(){return this.map.size}}const Jr=new WeakMap;function Er(e){let t=Jr.get(e);return t||(t=new qs,Jr.set(e,t)),t}function Xs(e,t,r){const n=t*r;if(n<=0)return NaN;let a=0;for(let s=0;s<n;s++)a+=e[s*4]??0;return 1-a/n}function en(e){return e==null||Number.isNaN(e)?"—":e.toFixed(4)}const tn=new WeakMap;function Ys(e,t,r){let n=tn.get(e);n||(n=new Map,tn.set(e,n));const a=n.get(t);if(a)return a;const s=r().catch(o=>{throw n.get(t)===s&&n.delete(t),o});return n.set(t,s),s}const rn=new WeakMap;function yr(e,t,r,n){let a=rn.get(e);a||(a=new Map,rn.set(e,a));const s=`${t}::${n}`;let o=a.get(s);return o||(o=e.createRenderPipeline({shaderWGSL:r,targetFormat:n}),a.set(s,o)),o}function js(e){return`
${xe}
${rt}
${St}
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
`}const Ut="rgba16float";let Jn=0;function Zs(){return Jn}function Qs(e,t,r,n,a,s){var R,B;const o=Xe(n);if(!o)throw new Error(`computeDiff: unknown diff kernel "${n}"`);const i=s??_t({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),u=i.result.w,d=i.result.h,p=i.fit==="fill"?1:0,g=Nn(o,a);if(Jn++,o.kind==="pointwise"){const x=e.createTexture(u,d,Ut),l=yr(e,`pw:${o.id}`,js(o.source),Ut),b=new Float32Array([i.offsetA.x,i.offsetA.y,i.offsetB.x,i.offsetB.y]),w=new Float32Array([u,d,p,0]);let E;try{E=e.createBindGroup(l,[{binding:0,resource:t},{binding:1,resource:r},{binding:2,resource:{uniform:b}},{binding:3,resource:{uniform:w}}]),e.renderFullscreen(x,l,E)}finally{(R=E==null?void 0:E.destroy)==null||R.call(E)}return x}const m={width:u,height:d,params:g,sourceMap:{fill:i.fit==="fill",offsetA:i.offsetA,offsetB:i.offsetB}},v=o.buildPasses(m),y=new Map([["srcA",t],["srcB",r]]),M=[];try{for(const l of v.passes){const b=e.createTexture(u,d,Ut);M.push(b),y.set(l.output,b);const w=yr(e,`mp:${o.id}:${l.name}`,l.shader,Ut),E=l.inputs.map((G,z)=>{const C=y.get(G);if(!C)throw new Error(`computeDiff: pass "${l.name}" input "${G}" not produced yet`);return{binding:z,resource:C}});l.uniforms&&E.push(...l.uniforms(m));let A;try{A=e.createBindGroup(w,E),e.renderFullscreen(b,w,A)}finally{(B=A==null?void 0:A.destroy)==null||B.call(A)}}const x=y.get(v.final);if(!x)throw new Error(`computeDiff: final ref "${v.final}" not produced`);for(const l of M)l!==x&&l.destroy();return x}catch(x){for(const l of M)l.destroy();throw x}}function Js(e,t){const r=Nn(e,t);return Object.keys(r).sort().map(a=>`${a}=${r[a]}`).join(",")}function eo(e,t,r,n,a){const s=Xe(r),o=s?Js(s,n):"",i=a?wr(a):"";return`${e}|${t}|${r}|${o}|${i}`}function ea(e,t,r,n,a,s,o,i){const u=Xe(n);if(!u)throw new Error(`ensureDiff: unknown diff kernel "${n}"`);const d=Er(e),p=i??_t({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),g=eo(s,o,n,a,p),m=d.get(g);if(m)return m;const v=Qs(e,t,r,n,a,p),y=p.result.w,M=p.result.h,R={texture:v,width:y,height:M,displayRange:u.displayRange,bytes:y*M*8};return d.set(g,R),R}function to(e,t,r){return`${e}|${t}|${r?wr(r):""}`}function ro(e,t,r,n,a,s){return Ys(e,to(n,a,s),()=>no(e,t,r,n,a,s))}async function no(e,t,r,n,a,s){try{const o=ea(e,t,r,"ssim",void 0,n,a,s);return o.ssimMean!==void 0?o.ssimMean:(o.ssimMeanPending||(o.ssimMeanPending=ta(e,o).then(i=>{const u=Xs(i,o.width,o.height);return o.ssimMean=u,u})),await o.ssimMeanPending)}catch{return ao(e,t,r,s)}}async function ao(e,t,r,n){const a=n??_t({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),s=a.result.w,o=a.result.h,i=s*o;if(i<=0)return NaN;const u=await e.readback(t),d=await e.readback(r),p=u instanceof Uint8Array?255:1,g=d instanceof Uint8Array?255:1,m=a.fit==="fill",v=Nt(u,t.width,t.height,p,a.offsetA,m,s,o),y=Nt(d,r.width,r.height,g,a.offsetB,m,s,o),M=new Float64Array(i),R=new Float64Array(i),B=[0,0,0],x=[0,0,0];for(let l=0;l<o;l++){for(let b=0;b<s;b++){v(b,l,B),y(b,l,x);const w=l*s+b;M[w]=qr(B[0],B[1],B[2]),R[w]=qr(x[0],x[1],x[2])}(l+1)%vr===0&&await jn()}return Us(M,R,s,o)}async function so(e,t,r,n,a){return t.scalars?t.scalars:(t.scalarsPending||(t.scalarsPending=kn(e,r,n,a).then(s=>(t.scalars=s,s))),t.scalarsPending)}async function ta(e,t){return t.resultSamples?t.resultSamples:(t.resultSamplesPending||(t.resultSamplesPending=e.readback(t.texture).then(r=>{const n=r instanceof Float32Array?r:Float32Array.from(r);return t.resultSamples=n,Er(e).accountReadbackBytes(t,n.byteLength),n})),t.resultSamplesPending)}function oo(e){return Er(e).size}const io=`
${xe}
${rt}
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
`,co={unit:0,signed:1,relative:2},uo={linear:0,signed:1,positive:2};function lo(e,t){if(t){if(t.length!==256*4)throw new Error(`renderDiffDisplay: colormap must be 256*4 floats, got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function fo(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function po(e,t,r,n,a){var v,y,M;const s=fo(t),o=yr(e,"diff-display",io,s),i=lo(e,a.colormap),u=new Float32Array([a.uv.x,a.uv.y,a.uv.w,a.uv.h]),d=new Float32Array([co[n],uo[a.cmapMode??"positive"],a.colormap?1:0,a.filter==="nearest"?0:1]),p=new Float32Array([a.exposureEV??0,a.offset??0,0,0]),g=new Float32Array([((v=a.sourceDims)==null?void 0:v.w)??0,((y=a.sourceDims)==null?void 0:y.h)??0,0,0]);let m;try{m=e.createBindGroup(o,[{binding:0,resource:r},{binding:1,resource:i},{binding:2,resource:{uniform:u}},{binding:3,resource:{uniform:d}},{binding:4,resource:{uniform:p}},{binding:5,resource:{uniform:g}}]),e.renderFullscreen(t,o,m)}finally{(M=m==null?void 0:m.destroy)==null||M.call(m),i.destroy()}}const nn=.6*.6*2.51,mo=.6*.03,go=0,an=.6*.6*2.43,ho=.6*.59,xo=.14;function sn(e){const t=(mo-ho*e)/(nn-an*e),r=(go-xo*e)/(nn-an*e);return-.5*t+Math.sqrt((.5*t)**2-r)}const bo=.85,vo=.85,on=11920928955078125e-23,pr=[.2126,.7152,.0722];function yo(e,t,r){const n=t*r;if(r===1){const a=e[n];return[a,a,a]}return[e[n],e[n+1],e[n+2]]}function wo(e,t,r,n=3,a={}){const s=t*r,o=sn(bo),i=sn(vo),u=new Float64Array(s);let d=0;for(let x=0;x<s;x++){const[l,b,w]=yo(e,x,n),E=l*pr[0]+b*pr[1]+w*pr[2];u[x]=E,E>d&&(d=E)}const p=Float64Array.from(u).sort(),g=s>>1,m=s%2===1?p[g]:p[g-1],v=Math.max(m,on),y=Math.max(d,on),M=a.startExposure??Math.log2(o/y),R=a.stopExposure??Math.log2(i/v),B=Math.max(2,Math.ceil(R-M));return{startExposure:M,stopExposure:R,numExposures:B}}function Eo({mode:e,kernel:t,kernelOptions:r,onSlide:n,onBlend:a,onKernel:s}){return{id:"compare-mode",title:"Compare / diff mode",menu:{options:[{id:"slide",label:"Slide"},{id:"blend",label:"Blend"},...r],value:e==="split"?"slide":e==="blend"?"blend":t,onSelect:u=>{u==="slide"?n():u==="blend"?a():s(u)}}}}function Ro(e){const t=Pa(e),r=new Float32Array(256*4);for(let n=0;n<256;n++)r[n*4+0]=t[n*3+0]/255,r[n*4+1]=t[n*3+1]/255,r[n*4+2]=t[n*3+2]/255,r[n*4+3]=1;return r}function So(e){const{width:t,height:r,channels:n}=e,a=t*r;if(e.precision==="f16-bits"){const u=e.data,d=new Uint16Array(a*4);for(let p=0;p<a;p++){const g=p*n,m=p*4;if(n===1){const v=u[g];d[m]=v,d[m+1]=v,d[m+2]=v,d[m+3]=Ft}else d[m]=u[g],d[m+1]=u[g+1],d[m+2]=u[g+2],d[m+3]=n>=4?u[g+3]:Ft}return{data:d,format:"rgba16float"}}const s=e.data,o=new Float32Array(a*4),i=u=>Number.isFinite(u)?u:0;for(let u=0;u<a;u++){const d=u*n;let p,g,m,v=1;n===1?p=g=m=i(s[d]):n===3?(p=i(s[d]),g=i(s[d+1]),m=i(s[d+2])):(p=i(s[d]),g=i(s[d+1]),m=i(s[d+2]),v=i(s[d+3]));const y=u*4;o[y]=p,o[y+1]=g,o[y+2]=m,o[y+3]=v}return{data:o,format:"rgba32float"}}function _o({imageUrl:e,baselineUrl:t,imageFloat:r,baselineFloat:n,mode:a,splitPosition:s,blendAlpha:o,onSplitPositionChange:i,onBlendAlphaChange:u,diffSubmode:d,colormap:p="none",align:g="top-left",fit:m="crop",diffKernel:v,onDiffKernelChange:y,onCompareModeChange:M,zoom:R,pan:B,onViewportChange:x,interpolation:l="auto",label:b="",pixelValueNotation:w="decimal",tonemap:E,peak:A,gamma:G,toolbar:z=!0,settingsSyncGroupId:C,syncIsAnchor:k}){var Pr;const J=f.useRef(null),Z=f.useRef(null),H=f.useRef(null),W=f.useRef(null),de=f.useRef(null),[pe,j]=f.useState(!1),[F,se]=f.useState(!1),ne=f.useRef(!1),[ce,Be]=f.useState(!1),[oe,we]=f.useState(null),[ee,Ee]=f.useState(null),[lt,Zt]=f.useState({a:!1,b:!1}),[Ce,At]=f.useState(0),[je,Ze]=f.useState(0),[Ne,Re]=f.useState(null),[Se,be]=f.useState(null),[Le,_e]=f.useState({x:0,y:0,w:1,h:1}),Tt=v??d??"absolute",[te,Qe,ft]=qe(Tt);f.useEffect(()=>{Qe(v??d??"absolute")},[v,d,Qe]);const Ae=f.useCallback(c=>{Qe(c),y==null||y(c)},[y,Qe]);f.useEffect(()=>{const c=J.current;if(c)return c.__cairnDiffKernel={current:te,set:Ae},()=>{c&&delete c.__cairnDiffKernel}},[te,Ae]);const[O,Je,nt]=qe(a);f.useEffect(()=>{Je(a)},[a,Je]);const ze=f.useCallback(c=>{Je(c),M==null||M(c)},[M,Je]),[ue,Te,dt]=qe(p);f.useEffect(()=>{Te(p)},[p,Te]);const[et,Ge]=f.useState(null);f.useEffect(()=>{Ge(null)},[E]);const pt=Sn(E),le=et??pt,at=et!==null&&et!==pt,Mt=()=>A!=null&&A>0?A:_n(E)??Xt,[Me,Ve,st]=qe(Mt()),[Oe,ve,$e]=qe(G&&G>0?G:cn);f.useEffect(()=>{Ve(Mt())},[A,E]),f.useEffect(()=>{G&&G>0&&ve(G)},[G,ve]);const Qt=f.useCallback(()=>{ze(nt.default),Te(dt.default),Ae(ft.default),Ge(null),st.reset(),$e.reset()},[ze,Te,Ae,nt.default,dt.default,ft.default,st,$e]),Jt=nt.isModified||dt.isModified||ft.isModified||at||st.isModified||$e.isModified,[Pe,mt]=f.useState(0),[ye,gt]=f.useState(0),h=f.useCallback(c=>{c.colormap!==void 0&&Te(c.colormap),c.tonemap!==void 0&&Ge(c.tonemap),c.tonemapGamma!==void 0&&ve(c.tonemapGamma),c.peak!==void 0&&Ve(c.peak),c.exposureEV!==void 0&&mt(c.exposureEV),c.offset!==void 0&&gt(c.offset),c.compareMode!==void 0&&ze(c.compareMode),c.diffKernel!==void 0&&Ae(c.diffKernel),c.splitPosition!==void 0&&(i==null||i(c.splitPosition)),c.blendAlpha!==void 0&&(u==null||u(c.blendAlpha))},[Te,Ge,ve,Ve,ze,Ae,i,u]),U=f.useCallback(()=>({colormap:ue,tonemap:le,tonemapGamma:Oe,peak:Me,exposureEV:Pe,offset:ye,compareMode:O,diffKernel:te,splitPosition:s,blendAlpha:o}),[ue,le,Oe,Me,Pe,ye,O,te,s,o]),D=un(C,!!k,U,h),P=f.useCallback(c=>{ze(c),D({compareMode:c})},[ze,D]),$=f.useCallback(c=>{Ae(c),D({diffKernel:c})},[Ae,D]),V=f.useCallback(c=>{Te(c),D({colormap:c})},[Te,D]),ae=f.useCallback(c=>{Ge(c),D({tonemap:c})},[Ge,D]),fe=f.useCallback(c=>{Ve(c),D({peak:c})},[Ve,D]),me=f.useCallback(c=>{ve(c),D({tonemapGamma:c})},[ve,D]),q=f.useCallback(c=>{mt(c),D({exposureEV:c})},[D]),Ue=f.useCallback(c=>{gt(c),D({offset:c})},[D]),Fe=f.useCallback(c=>{i==null||i(c),D({splitPosition:c})},[i,D]),ot=f.useMemo(()=>{const _=[Eo({mode:O,kernel:te,kernelOptions:Qn().map(S=>({id:S.id,label:S.label})),onSlide:()=>P("split"),onBlend:()=>P("blend"),onKernel:S=>{P("diff"),$(S)}})];return O==="diff"?_.push(gr(ue,S=>V(S))):_.push(mr(le,S=>ae(S))),_},[O,te,ue,le,$,P,V,ae]),ht=f.useRef(null),tt=f.useRef(null),Pt=f.useRef(null),it=f.useRef(null),[er,Rr]=f.useState(0),xt=f.useRef(null),bt=f.useRef(null),[ra,Sr]=f.useState(0),tr=ln();f.useEffect(()=>{const c=H.current;if(!c)return;let _=!1;return Yt().then(S=>{var T;if(!_)try{if(Bn())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const L=((T=S.probeExtendedToneMapping)==null?void 0:T.call(S))??!1,I=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,X=L&&I;ne.current=X,Be(X);const Y=S.createSurface(c,{hdr:X});W.current={device:S,surface:Y,texA:null,texB:null},se(!0)}catch(L){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",L),j(!0)}}).catch(S=>{_||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",S),j(!0))}),()=>{var T,L;_=!0;const S=W.current;S&&((T=S.texA)==null||T.destroy(),(L=S.texB)==null||L.destroy(),W.current=null)}},[]),f.useEffect(()=>{const c=J.current;if(!c)return;const _=new ResizeObserver(()=>Ze(S=>S+1));return _.observe(c),()=>_.disconnect()},[]),f.useEffect(()=>{if(!F)return;let c=!1;if(!W.current)return;async function S(T,L){if(L){const X=So(L);return{width:L.width,height:L.height,imageData:null,make:Y=>{const K=Y.createTexture(L.width,L.height,X.format);return K.write(X.data),K}}}if(!T)return null;const I=await fn(T);return I?{width:I.width,height:I.height,imageData:I,make:X=>{const Y=X.createTexture(I.width,I.height,"rgba8unorm");return Y.write(I.data),Y}}:null}return Promise.all([S(e,r),S(t,n)]).then(([T,L])=>{var ie,he;if(c||!W.current)return;const I=W.current;ht.current=(T==null?void 0:T.imageData)??null,tt.current=(L==null?void 0:L.imageData)??null,Pt.current=r??null,it.current=n??null,(ie=I.texA)==null||ie.destroy(),(he=I.texB)==null||he.destroy(),I.texA=null,I.texB=null;const X=T??L;if(!X){we(null),Ee(null),Rr(We=>We+1);return}const Y=L??X,K=T??X;I.texA=Y.make(I.device),I.texB=K.make(I.device),Ee({a:{w:Y.width,h:Y.height},b:{w:K.width,h:K.height}}),Zt({a:Y.imageData!=null,b:K.imageData!=null}),we({w:X.width,h:X.height}),Rr(We=>We+1),At(We=>We+1)}),()=>{c=!0}},[F,e,t,r,n]);const Dt=r!=null||n!=null,ge=f.useMemo(()=>Ws(te,Dt),[te,Dt]),vt=f.useMemo(()=>{if(!Dt)return null;const c=n??r;if(!c)return null;const _=c.precision==="f16-bits"?ya(c.data):c.data;return wo(_,c.width,c.height,c.channels)},[Dt,n,r]),_r=f.useMemo(()=>{var c;return wa(((c=Xe(ge))==null?void 0:c.displayRange)??"unit",ue==="none"?null:ue)},[ge,ue]),Ar=f.useMemo(()=>ue!=="none"?Ro(ue):void 0,[ue]),Ie=f.useMemo(()=>ee?_t(ee.a,ee.b,g,m,"b"):null,[ee,g,m]),na=f.useMemo(()=>Ie?wr(Ie):"none",[Ie]),kt=(n==null?void 0:n.contentKey)??t??(r==null?void 0:r.contentKey)??e??"none",Bt=(r==null?void 0:r.contentKey)??e??(n==null?void 0:n.contentKey)??t??"none",re=oe,yt=f.useCallback(()=>{const c=W.current;if(!F||!c||!c.surface||!c.texA||!c.texB||!oe)return;const _=re??oe,S=J.current,T=S?S.getBoundingClientRect():{width:_.w,height:_.h},L=Fn({zoom:R,pan:B},T,_.w,_.h);_e(K=>K.x===L.x&&K.y===L.y&&K.w===L.w&&K.h===L.h?K:L);const I=H.current;if(T.width>0&&T.height>0&&I&&c.surface){const K=Math.max(1,Math.round(T.width*tr)),ie=Math.max(1,Math.round(T.height*tr));(I.width!==K||I.height!==ie)&&(I.width=K,I.height=ie,c.surface.configure(K,ie))}const X=In(L,T,_.w,_.h)>=dn?"nearest":"linear",Y=L;try{if(O==="diff"){const K=Xe(ge)?ge:"absolute",ie=K==="hdr-flip"&&vt?{ppd:67,startExposure:vt.startExposure,stopExposure:vt.stopExposure,numExposures:vt.numExposures}:void 0,he=ea(c.device,c.texA,c.texB,K,ie,kt,Bt,Ie??void 0);de.current=he,po(c.device,c.surface,he.texture,he.displayRange,{uv:Y,cmapMode:_r,colormap:Ar,filter:X,sourceDims:_,exposureEV:Pe,offset:ye})}else{const K=pn(le,ne.current?Me:1,ne.current,Oe),ie={exposureEV:Pe,offset:ye,operator:K.operator,gamma:K.gamma,isScalar:!1,hdrOut:K.hdrOut,peak:K.peak,srgbDecodeA:lt.a,srgbDecodeB:lt.b,uv:Y,filter:X,mode:O,split:s,alpha:o};es(c.device,c.surface,c.texA,c.texB,ie)}}catch(K){console.warn("cairn-plot: GpuComparePane render failed, falling back to legacy pane",K),j(!0)}},[F,oe,re,Ie,R,B.x,B.y,O,s,o,Pe,ye,le,Me,Oe,lt,te,ge,vt,_r,Ar,e,t,r,n,kt,Bt,tr]);f.useEffect(()=>{yt()},[yt,Ce,je]);const ct=t!=null||n!=null;f.useEffect(()=>{const c=W.current;if(!F||!c||!c.texA||!c.texB||!ct){Re(null);return}let _=!1;const S=c.texA,T=c.texB,L=de.current,I=O==="diff"?Ie??void 0:void 0;return(O==="diff"&&L?so(c.device,L,S,T,I):kn(c.device,S,T,I)).then(Y=>{_||Re(Y)}),()=>{_=!0}},[F,Ce,ct,O,te,Ie]),f.useEffect(()=>{const c=W.current;if(!F||!c||!c.texA||!c.texB||!ct){be(null);return}let _=!1;be(null);const S=O==="diff"?Ie??void 0:void 0;return ro(c.device,c.texA,c.texB,kt,Bt,S).then(T=>{_||be(T)}).catch(()=>{_||be(null)}),()=>{_=!0}},[F,Ce,ct,O,na,kt,Bt]),f.useEffect(()=>{if(O!=="diff"){xt.current=null,bt.current=null;return}const c=W.current,_=de.current;if(!F||!c||!_)return;let S=!1;return xt.current=null,bt.current=null,Sr(T=>T+1),ta(c.device,_).then(T=>{S||(xt.current=T,bt.current={w:_.width,h:_.height},Sr(L=>L+1))}).catch(()=>{}),()=>{S=!0}},[F,O,ge,Ce,Ie]);const Tr=(c,_)=>(S,T,L)=>{const I=_.current;if(I){const{data:We,width:Dr,height:ia,channels:kr}=I;if(S<0||T<0||S>=Dr||T>=ia)return null;const Lt=(T*Dr+S)*kr,Gt=I.precision==="f16-bits"?ar=>mn(We[ar]??0):ar=>We[ar]??0,ca=kr===1?[Gt(Lt)]:[Gt(Lt),Gt(Lt+1),Gt(Lt+2)];return Et(ca,"unit",L)}const X=c.current;if(!X||S<0||T<0||S>=X.width||T>=X.height)return null;const Y=(T*X.width+S)*4,K=X.data[Y],ie=X.data[Y+1],he=X.data[Y+2];return Et(K===ie&&ie===he?[K]:[K,ie,he],"uint8",L)},Ct=f.useMemo(()=>Tr(ht,Pt),[]),rr=f.useMemo(()=>Tr(tt,it),[]),nr=f.useMemo(()=>(c,_,S)=>{var he;const T=xt.current,L=bt.current;if(!T||!L)return null;const{w:I,h:X}=L;if(c<0||_<0||c>=I||_>=X)return null;const Y=(_*I+c)*4,ie=(((he=Xe(ge))==null?void 0:he.output)??"per-channel")==="scalar"?[T[Y]??0]:[T[Y]??0,T[Y+1]??0,T[Y+2]??0];return Et(ie,"unit",S)},[ge]);f.useEffect(()=>{const c=J.current;if(c)return c.__cairnCompareProbe={sampleDiff:(_,S,T="decimal")=>nr(_,S,T),sampleFg:(_,S,T="decimal")=>Ct(_,S,T),sampleRef:(_,S,T="decimal")=>rr(_,S,T),get diffSamples(){return xt.current},get dims(){return re},get primaryDims(){return oe},get diffResultDims(){return bt.current},overlayTexelCenter:(_,S,T)=>{const L=H.current;if(!L||!re)return null;const I=L.getBoundingClientRect(),X=_==="a"?(ee==null?void 0:ee.a)??re:(ee==null?void 0:ee.b)??re,Y=Ea(S,T,{box:I,naturalWidth:re.w,naturalHeight:re.h,sourceWindow:Le},X);return{x:Y.x-I.left,y:Y.y-I.top}},get srcDims(){return ee},get overlayWindow(){return Le},readbackSurface:async()=>{const _=W.current,S=H.current;return!_||!_.surface||!S?null:(yt(),{data:await _.device.readback(_.surface),width:S.width,height:S.height})},get align(){return g},get fit(){return m},get resolvedKernelId(){return ge},get compareMode(){return O},computeCount:()=>Zs(),cacheSize:()=>W.current?oo(W.current.device):0,get ssimScalar(){return Se},get ssimText(){return en(Se)},get effectiveTonemap(){return le},get hdrEngaged(){return ce},get colormap(){return ue},get diffKernel(){return te},get splitPosition(){return s},get blendAlpha(){return o},get displayEV(){return Pe},get displayOffset(){return ye},get peak(){return Me},get tonemapGamma(){return Oe},changeCompareMode:P,changeDiffKernel:$,changeColormap:V,changeTonemap:ae,changeExposure:q,changeSplit:Fe},()=>{c&&delete c.__cairnCompareProbe}},[nr,Ct,rr,yt,oe,re,ee,Le,g,m,ge,O,Se,le,ce,ue,te,s,o,Pe,ye,Me,Oe,P,$,V,ae,q,Fe]);const aa=l==="auto"?void 0:l;if(pe)return r!=null||n!=null?Q.jsx(Ra,{}):O==="diff"?Q.jsx(gn,{toolbar:z,source:Sa(e),baselineUrl:t,diffMode:((Pr=Xe(ge))==null?void 0:Pr.kind)==="pointwise"?ge:"absolute",interpolation:l,colormap:ue,showAxes:!1,zoom:R,pan:B,onViewportChange:x,label:b,pixelValueNotation:w}):Q.jsx(_a,{imageUrl:e,baselineUrl:t,mode:O,splitPosition:s,blendAlpha:o,onSplitPositionChange:i,zoom:R,pan:B,onViewportChange:x,interpolation:l,label:b,pixelValueNotation:w});const sa=Q.jsxs(Q.Fragment,{children:[Q.jsx("canvas",{ref:H,className:"w-full h-full block",style:{imageRendering:aa},"data-gpu-compare-canvas":!0}),O==="split"&&Q.jsx(Ma,{splitPosition:s,onChange:Fe,onReset:()=>Fe(.5)})]}),Mr=!!b,oa=Mr?"bottom-7":"bottom-1";return Q.jsx(hn,{paneAttrs:{"data-gpu-compare-pane":"","data-gpu-compare-ready":F},viewportAttrs:{"data-gpu-compare-viewport":""},toolbar:z,paneRef:J,wrapperRef:Z,zoom:R,pan:B,onViewportChange:x,naturalDims:re,checkerboard:"pane",wrapperClassName:"relative w-full h-full flex items-center justify-center",viewportPadding:0,surface:sa,showAxes:!1,notationSeed:w,onReset:Qt,extraModified:Jt,exportCanvasRef:H,requestRender:yt,leadingMenus:ot,displayAdjust:{exposureEV:Pe,offset:ye,onExposureChange:q,onOffsetChange:Ue},extraSliders:[...ce&&O!=="diff"?[{id:"peak",label:"PK",title:"Peak white (×SDR white) — the HDR ceiling P every operator clips at (Linear/sRGB/Gamma hard-clip at P; Reinhard/ACES roll off toward P). P=1 reproduces the SDR rendition exactly; double-click to type a value, including 'inf' for the raw browser-clipped extended look.",min:vn,max:bn,step:xn,value:Me,onChange:fe,format:c=>Number.isFinite(c)?`${c.toFixed(1)}×`:"∞"}]:[],...O!=="diff"&&Rn(le)?[{id:"gamma",label:"γ",title:"Display gamma γ for the Gamma transfer — display = clamp(value)^(1/γ), tev-style. Default 2.2 (close to sRGB, not identical). Double-click to type a value.",min:En,max:wn,step:yn,value:Oe,onChange:me,format:c=>c.toFixed(1)}]:[]],label:"",showLabelChip:!1,overlay:{render:({notation:c,setOverlayActive:_})=>O==="split"?Q.jsxs(Q.Fragment,{children:[ct&&re&&Q.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-s)*100}% 0 0)`},children:Q.jsx(sr,{imageElRef:H,naturalWidth:re.w,naturalHeight:re.h,zoom:R,pan:B,sourceWindow:Le,sourceDims:(ee==null?void 0:ee.a)??re,sample:rr,notation:c,version:er})}),ct&&re&&Q.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${s*100}%)`},children:Q.jsx(sr,{imageElRef:H,naturalWidth:re.w,naturalHeight:re.h,zoom:R,pan:B,sourceWindow:Le,sourceDims:(ee==null?void 0:ee.b)??re,sample:Ct,notation:c,version:er,onActiveChange:_})})]}):re&&Q.jsx(sr,{imageElRef:H,naturalWidth:re.w,naturalHeight:re.h,zoom:R,pan:B,sourceWindow:Le,sample:O==="diff"?nr:Ct,notation:c,version:O==="diff"?ra:er,onActiveChange:_})},extraChips:Q.jsxs(Q.Fragment,{children:[O==="split"&&Q.jsx(Aa,{}),Mr?Q.jsx(Ta,{label:b,corner:"bottom-right"}):null,Ne&&Q.jsxs("span",{className:`absolute right-1 z-30 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${oa}`,"data-gpu-compare-metrics":!0,children:["MSE ",Ne.mse.toExponential(2)," · PSNR ",Number.isFinite(Ne.psnr)?Ne.psnr.toFixed(1):"∞"," dB · MAE"," ",Ne.mae.toExponential(2)," · SSIM ",en(Se)]})]})})}const Ao="cairn-plot:gpu-image-ready";async function To(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Yt(),window.__cairnPlotGpuImagePane=gs,window.__cairnPlotGpuComparePane=_o,window.__cairnPlotDiffMenuModes=Qn(),window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(Ao))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e),Un("no-webgpu")}}}To();

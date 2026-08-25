var ia=Object.defineProperty;var oa=(e,t,r)=>t in e?ia(e,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):e[t]=r;var U=(e,t,r)=>oa(e,typeof t!="symbol"?t+"":t,r);import{av as sa,aw as ca,ax as ua,ay as la,az as da,aA as Bn,H as dr,aB as fa,aC as ha,aD as Te,aE as fr,aF as pa,aG as ga,aH as ma,aI as On,aJ as ba,aK as va,aL as wa,aM as Xt,aN as xa,aO as hr,aP as pr,aQ as gr,aR as Ea,r as m,aS as mt,aT as Fe,aU as ya,aV as Sa,as as at,aW as Ra,aX as Ma,aY as Da,u as Ta,aZ as Ca,a_ as bt,a$ as Pa,b0 as Aa,am as _a,b1 as vt,b2 as Ba,b3 as Oa,b4 as rt,b5 as Ga,b6 as Ia,b7 as Ua,m as mr,b8 as ka,b9 as La,ba as Fa,bb as Na,bc as $a,bd as Va,be as Gn,bf as In,bg as za,bh as Ka,bi as Wa,l as br,bj as Un,bk as Ha,j,v as Ya,L as kn,C as ja,q as qa,bl as Xa,bm as Za,bn as Qa,bo as Ja,bp as ei,bq as ti,br as ni,bs as Ln,bt as ri,P as Ht,bu as ai,bv as ii,a2 as oi,bw as Fn,bx as De,by as si,bz as ci,bA as ui}from"./parse-overlay-Ba3Wl3I7.js";import{aW as li,aX as di,aY as fi}from"./index-C6PQZID0.js";import{r as vr,n as hi,w as pi}from"./capability-notice-jIjs9CwC.js";import"./parse-npz-Du4h7wjo.js";const Zt=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function wr(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"premultiplied",usage:Zt}),{hdr:!1,format:r}}function gi(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:Zt}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:Zt}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return wr(e,t)}}}const Et=256,Qt=new Map,Jt=new Map;function xr(e){if(Qt.has(e.id))throw new Error(`registerReduceOp: duplicate op id "${e.id}"`);Qt.set(e.id,e)}function Er(e){if(Jt.has(e.id))throw new Error(`registerReduceProgram: duplicate program id "${e.id}"`);Jt.set(e.id,e)}function Nn(e){return Qt.get(e)}function $n(e){return Jt.get(e)}xr({id:"sum",wgslIdentity:"0.0",wgslCombine:(e,t)=>`${e} + ${t}`,cpuIdentity:0,cpuCombine:(e,t)=>e+t,finalize:e=>e});xr({id:"mean",wgslIdentity:"0.0",wgslCombine:(e,t)=>`${e} + ${t}`,cpuIdentity:0,cpuCombine:(e,t)=>e+t,finalize:(e,t)=>t>0?e/t:NaN});Er({id:"channel",textureArity:1,lanes:1,perPixelWGSL:`
    let texel = textureLoad(t0, vec2<i32>(x, y), 0);
    vals[0] = texel[dims.channel];
  `,cpu:(e,t,r,n)=>[e(0,t,r)[n.channel??0]??0]});Er({id:"diffSqAbs",textureArity:2,lanes:2,perPixelWGSL:`
    let a = textureLoad(t0, vec2<i32>(x, y), 0);
    let b = textureLoad(t1, vec2<i32>(x, y), 0);
    let d = a.rgb - b.rgb;
    vals[0] = dot(d, d);
    vals[1] = abs(d.x) + abs(d.y) + abs(d.z);
  `,cpu:(e,t,r)=>{const n=e(0,t,r),a=e(1,t,r),s=(n[0]??0)-(a[0]??0),o=(n[1]??0)-(a[1]??0),u=(n[2]??0)-(a[2]??0);return[s*s+o*o+u*u,Math.abs(s)+Math.abs(o)+Math.abs(u)]}});function mi(e,t){const r=e.textureArity,n=e.lanes,a=r,s=r+1,o=["@group(0) @binding(0) var t0: texture_2d<f32>;"];r===2&&o.push("@group(0) @binding(1) var t1: texture_2d<f32>;");const u=[],b=[],S=[],x=[],P=[];for(let T=0;T<n;T++)u.push(`var<workgroup> shared${T}: array<f32, ${Et}>;`),P.push(`  vals[${T}] = ${t.wgslIdentity};`),b.push(`  shared${T}[lid.x] = vals[${T}];`),S.push(`      shared${T}[lid.x] = ${t.wgslCombine(`shared${T}[lid.x]`,`shared${T}[lid.x + stride]`)};`),x.push(`    partial[wgid.x * ${n}u + ${T}u] = shared${T}[0];`);return`
const WORKGROUP_SIZE: u32 = ${Et}u;

${o.join(`
`)}
@group(0) @binding(${a}) var<storage, read_write> partial: array<f32>;

struct Dims {
  width: u32,
  height: u32,
  count: u32,
  channel: u32,
};
@group(0) @binding(${s}) var<uniform> dims: Dims;

${u.join(`
`)}

@compute @workgroup_size(${Et})
fn cs_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>,
) {
  let idx = gid.x;
  var vals: array<f32, ${n}>;
${P.join(`
`)}
  if (idx < dims.count) {
    let x = i32(idx % dims.width);
    let y = i32(idx / dims.width);
${e.perPixelWGSL}
  }
${b.join(`
`)}
  workgroupBarrier();

  var stride = WORKGROUP_SIZE / 2u;
  loop {
    if (stride == 0u) {
      break;
    }
    if (lid.x < stride) {
${S.join(`
`)}
    }
    workgroupBarrier();
    stride = stride / 2u;
  }

  if (lid.x == 0u) {
${x.join(`
`)}
  }
}
`}function bi(e,t,r,n,a){const s=new Array(r).fill(n.cpuIdentity);for(let o=0;o<t;o++)for(let u=0;u<r;u++)s[u]=n.cpuCombine(s[u],e[o*r+u]??n.cpuIdentity);return s.map(o=>n.finalize(o,a))}const vi=`
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
`;class wi extends Error{constructor(r){super(r);U(this,"deviceLost",!0);this.name="DeviceLostError"}}async function Vn(e,t){try{await e.mapAsync(GPUMapMode.READ)}catch(r){if((r instanceof Error?r.name:"")==="AbortError"){const a=t.info;throw new wi("webgpu readback: buffer map aborted — device lost or destroyed mid-readback"+(a?` (reason=${String(a.reason)}${a.message?`: ${a.message}`:""})`:"")+`: ${r instanceof Error?r.message:String(r)}`)}throw r instanceof Error?r:new Error(String(r))}}function en(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function yr(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function xi(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let a;return r===0?a=n/1024*Math.pow(2,-14):r===31?a=n?NaN:1/0:a=(1+n/1024)*Math.pow(2,r-15),t?-a:a}const Ei={texture:0,sampler:1,uniform:2};function Yt(e,t){return e*3+Ei[t]}const yi={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Si(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const a=Number(n[1]),s=n[2]!==void 0,o=n[3].trim();if(s){const u=yi[o];if(u===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${o}" (binding ${a}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(a,{kind:"uniform",sizeBytes:u})}else o==="sampler"||o==="sampler_comparison"?t.set(a,{kind:"sampler"}):t.set(a,{kind:"texture"})}return t}class zn{constructor(t,r,n,a){U(this,"width");U(this,"height");U(this,"format");U(this,"gpuTexture");U(this,"device");U(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=a,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:en(a),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*yr(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class Kn{constructor(t){U(this,"_s");U(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Ri{constructor(t,r,n,a,s){U(this,"_p");U(this,"gpuPipeline");U(this,"bindings");U(this,"bindGroupLayout");U(this,"variants");U(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=s,this.variants=new Map([[a,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function Mi(e,t){const r=[];for(const[n,a]of t)a.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):a.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class Di{constructor(t){U(this,"_c");U(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class Ti{constructor(t,r,n,a,s){U(this,"width");U(this,"height");U(this,"paramsBuffer");U(this,"bindGroup");U(this,"buffers");U(this,"destroyed",!1);this.width=t,this.height=r,this.buffers=n,this.paramsBuffer=a,this.bindGroup=s}destroy(){if(!this.destroyed){for(const t of this.buffers)t.destroy();this.paramsBuffer.destroy(),this.destroyed=!0}}}class Ci{constructor(t,r){U(this,"_b");U(this,"gpuBindGroup");U(this,"ownedBuffers");U(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class Pi{constructor(t,r,n,a){U(this,"canvas");U(this,"hdr");U(this,"format");U(this,"context");U(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=a}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function wt(e){return"canvas"in e}async function Ai(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function a(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function s(c){return wt(c)?c.getCurrentTextureView():c.gpuTexture.createView()}function o(c){if(wt(c))return{width:c.canvas.width,height:c.canvas.height};const d=c;return{width:d.width,height:d.height}}let u=!1;const b={};t.lost.then(c=>{b.info=c,sa("webgpu-device-lost",{reason:c.reason,message:c.message})},()=>{});let S=null;function x(){var d,g;if(S!==null)return S;let c=!1;try{if(typeof document<"u"){const v=document.createElement("canvas");v.width=1,v.height=1;const p=v.getContext("webgpu");if(p)try{p.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:GPUTextureUsage.RENDER_ATTACHMENT});const h=(d=p.getConfiguration)==null?void 0:d.call(p);c=((g=h==null?void 0:h.toneMapping)==null?void 0:g.mode)==="extended"}catch{c=!1}finally{try{p.unconfigure()}catch{}}}}catch{c=!1}return S=c,c}const P=new Map;function T(c,d){const g=`${c.id}:${d.id}`;let v=P.get(g);if(!v){const p=t.createShaderModule({code:mi(c,d)}),h=c.textureArity,E=[];for(let I=0;I<h;I++)E.push({binding:I,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}});E.push({binding:h,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}),E.push({binding:h+1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}});const f=t.createBindGroupLayout({entries:E}),w=t.createPipelineLayout({bindGroupLayouts:[f]});v={pipeline:t.createComputePipeline({layout:w,compute:{module:p,entryPoint:"cs_main"}}),layout:f},P.set(g,v)}return v}async function A(c,d,g,v,p,h){const E=c.lanes,f=Math.max(0,v*p),w=Math.max(1,Math.ceil(f/Et)),{pipeline:O,layout:I}=T(c,d),_=w*E*4,K=t.createBuffer({size:_,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),X=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(X,0,new Uint32Array([Math.max(1,v),Math.max(1,p),f,h>>>0]));const de=g.map((Ee,se)=>({binding:se,resource:Ee.gpuTexture.createView()}));de.push({binding:c.textureArity,resource:{buffer:K}}),de.push({binding:c.textureArity+1,resource:{buffer:X}});const Y=t.createBindGroup({layout:I,entries:de}),V=t.createBuffer({size:_,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),q=t.createCommandEncoder(),Z=q.beginComputePass();Z.setPipeline(O),Z.setBindGroup(0,Y),Z.dispatchWorkgroups(w),Z.end(),q.copyBufferToBuffer(K,0,V,0,_),t.queue.submit([q.finish()]);try{await Vn(V,b)}catch(Ee){for(const se of[V,K,X])try{se.destroy()}catch{}throw Ee}const Ie=new Float32Array(V.getMappedRange()).slice();return V.unmap(),V.destroy(),K.destroy(),X.destroy(),bi(Ie,w,E,d,f)}let R=null,y=null;function L(){if(!R||!y){const c=t.createShaderModule({code:vi});y=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const d=t.createPipelineLayout({bindGroupLayouts:[y]});R=t.createRenderPipeline({layout:d,vertex:{module:c,entryPoint:"vs_main"},fragment:{module:c,entryPoint:"fs_main",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}})}return{pipeline:R,layout:y}}return{backend:"webgpu",capabilities:r,probeExtendedToneMapping:x,createTexture(c,d,g){return new zn(t,c,d,g)},createSampler(c){const d=(c==null?void 0:c.filter)==="linear"?"linear":"nearest",g=t.createSampler({magFilter:d,minFilter:d,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new Kn(g)},createRenderPipeline(c){const d=t.createShaderModule({code:c.shaderWGSL}),g=Si(c.shaderWGSL),v=en(c.targetFormat),p=Mi(t,g),h=t.createPipelineLayout({bindGroupLayouts:[p]}),E=w=>t.createRenderPipeline({layout:h,vertex:{module:d,entryPoint:"vs_main"},fragment:{module:d,entryPoint:"fs_main",targets:[{format:w}]},primitive:{topology:"triangle-list"}}),f=E(v);return new Ri(f,g,p,v,E)},createComputePipeline(c){const d=t.createShaderModule({code:c.shaderWGSL}),g=t.createComputePipeline({layout:"auto",compute:{module:d,entryPoint:"cs_main"}});return new Di(g)},createBindGroup(c,d){const g=c,v=new Map,p=[];for(const[E,f]of g.bindings)if(f.kind==="uniform"){const w=t.createBuffer({size:f.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});p.push(w),v.set(E,{binding:E,resource:{buffer:w}})}else f.kind==="sampler"&&v.set(E,{binding:E,resource:a()});for(const E of d){const f=E.resource;if(f instanceof zn){const w=Yt(E.binding,"texture");g.bindings.has(w)&&v.set(w,{binding:w,resource:f.gpuTexture.createView()})}else if(f instanceof Kn){const w=Yt(E.binding,"sampler");g.bindings.has(w)&&v.set(w,{binding:w,resource:f.gpuSampler})}else{const w=Yt(E.binding,"uniform"),O=g.bindings.get(w);if(O&&O.kind==="uniform"){const I=f.uniform,_=t.createBuffer({size:Math.max(O.sizeBytes,I.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(_,0,I.buffer,I.byteOffset,I.byteLength),p.push(_),v.set(w,{binding:w,resource:{buffer:_}})}}}const h=t.createBindGroup({layout:g.bindGroupLayout,entries:Array.from(v.values())});return new Ci(h,p)},createSurface(c,d){const g=c.getContext("webgpu");if(!g)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const v=d.hdr&&r.hdr,p=()=>v?gi(g,t):wr(g,t),h=p();return new Pi(c,g,h,p)},renderFullscreen(c,d,g){const v=d,p=g,h=s(c),{width:E,height:f}=o(c),w=wt(c)?c.format:en(c.format),O=v.pipelineFor(w),I=t.createCommandEncoder(),_=I.beginRenderPass({colorAttachments:[{view:h,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});_.setPipeline(O),_.setBindGroup(0,p.gpuBindGroup),_.setViewport(0,0,E,f,0,1),_.draw(3),_.end(),t.queue.submit([I.finish()])},createDeepSampleBuffers(c){const{layout:d}=L(),g=w=>{const O=t.createBuffer({size:w.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(O,0,w.buffer,w.byteOffset,w.byteLength),O},v=g(c.offsets),p=g(c.colors),h=g(c.zs),E=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),f=t.createBindGroup({layout:d,entries:[{binding:0,resource:{buffer:v}},{binding:1,resource:{buffer:p}},{binding:2,resource:{buffer:h}},{binding:3,resource:{buffer:E}}]});return new Ti(c.width,c.height,[v,p,h],E,f)},compositeDeep(c,d,g,v){const p=c,h=d,{pipeline:E}=L();t.queue.writeBuffer(p.paramsBuffer,0,new Float32Array([p.width,p.height,v,g]));const f=t.createCommandEncoder(),w=f.beginRenderPass({colorAttachments:[{view:h.gpuTexture.createView(),loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});w.setPipeline(E),w.setBindGroup(0,p.bindGroup),w.setViewport(0,0,h.width,h.height,0,1),w.draw(3),w.end(),t.queue.submit([f.finish()])},async readback(c){const d=wt(c),{width:g,height:v}=o(c),p=d?c.hdr?"rgba16float":"rgba8unorm":c.format,h=d&&c.format==="bgra8unorm",E=d?c.getCurrentGPUTexture():c.gpuTexture,f=yr(p),w=g*f,O=256,I=Math.ceil(w/O)*O,_=I*v,K=t.createBuffer({size:_,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),X=t.createCommandEncoder();X.copyTextureToBuffer({texture:E},{buffer:K,bytesPerRow:I,rowsPerImage:v},{width:g,height:v,depthOrArrayLayers:1}),t.queue.submit([X.finish()]);try{await Vn(K,b)}catch(V){try{K.destroy()}catch{}throw V}const de=new Uint8Array(K.getMappedRange()),Y=new Uint8Array(w*v);for(let V=0;V<v;V++){const q=V*I,Z=V*w;Y.set(de.subarray(q,q+w),Z)}if(K.unmap(),K.destroy(),p==="rgba8unorm"){if(h)for(let V=0;V<Y.length;V+=4){const q=Y[V],Z=Y[V+2];Y[V]=Z,Y[V+2]=q}return Y}if(p==="rgba16float"){const V=new Uint16Array(Y.buffer,Y.byteOffset,Y.byteLength/2),q=new Float32Array(V.length);for(let Z=0;Z<V.length;Z++)q[Z]=xi(V[Z]);return q}return new Float32Array(Y.buffer,Y.byteOffset,Y.byteLength/4)},async reduceDiffSumSquaredAbs(c,d,g,v){const p=$n("diffSqAbs"),h=Nn("sum"),[E,f]=await A(p,h,[c,d],g,v,0);return{sumSq:E,sumAbs:f}},async reduceTextureChannelMean(c,d,g,v){const p=$n("channel"),h=Nn("mean"),[E]=await A(p,h,[c],g,v,d);return E},destroy(){u||(t.destroy(),u=!0)},isContextLost(){return!1}}}let jt=null;async function _i(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return Ai()}function yt(){return jt||(jt=_i()),jt}function Bi(e){switch(e){case"center":return{v:"center",h:"center"};case"top-right":return{v:"top",h:"right"};case"bottom-left":return{v:"bottom",h:"left"};case"bottom-right":return{v:"bottom",h:"right"};case"top-left":default:return{v:"top",h:"left"}}}function Wn(e,t,r){const{v:n,h:a}=Bi(r),s=e.w-t.w,o=e.h-t.h,u=a==="left"?0:a==="right"?s:Math.floor(s/2),b=n==="top"?0:n==="bottom"?o:Math.floor(o/2);return{x:u,y:b}}function $e(e,t,r,n,a="b"){if(n==="fill"){const o=a==="a"?{w:e.w,h:e.h}:{w:t.w,h:t.h};return{fit:n,result:o,offsetA:{x:0,y:0},offsetB:{x:0,y:0}}}const s={w:Math.min(e.w,t.w),h:Math.min(e.h,t.h)};return{fit:n,result:s,offsetA:Wn(e,s,r),offsetB:Wn(t,s,r)}}function Sr(e){return`${e.fit}:${e.result.w}x${e.result.h}:${e.offsetA.x},${e.offsetA.y}:${e.offsetB.x},${e.offsetB.y}`}const Hn=.6*.6*2.51,Oi=.6*.03,Gi=0,Yn=.6*.6*2.43,Ii=.6*.59,Ui=.14;function jn(e){const t=(Oi-Ii*e)/(Hn-Yn*e),r=(Gi-Ui*e)/(Hn-Yn*e);return-.5*t+Math.sqrt((.5*t)**2-r)}const ki=.85,Li=.85,qn=11920928955078125e-23,qt=[.2126,.7152,.0722];function Fi(e,t,r){const n=t*r;if(r===1){const a=e[n];return[a,a,a]}return[e[n],e[n+1],e[n+2]]}function Ni(e,t,r,n=3,a={}){const s=t*r,o=jn(ki),u=jn(Li),b=new Float64Array(s);let S=0;for(let c=0;c<s;c++){const[d,g,v]=Fi(e,c,n),p=d*qt[0]+g*qt[1]+v*qt[2];b[c]=p,p>S&&(S=p)}const x=Float64Array.from(b).sort(),P=s>>1,T=s%2===1?x[P]:x[P-1],A=Math.max(T,qn),R=Math.max(S,qn),y=a.startExposure??Math.log2(o/R),L=a.stopExposure??Math.log2(u/A),C=Math.max(2,Math.ceil(L-y));return{startExposure:y,stopExposure:L,numExposures:C}}function $i(e,t,r){const n=t*r;if(n<=0)return NaN;let a=0;for(let s=0;s<n;s++)a+=e[s*4]??0;return 1-a/n}function Xn(e){return e==null||Number.isNaN(e)?"—":e.toFixed(4)}function Vi({mode:e,kernel:t,kernelOptions:r,onSplit:n,onKernel:a}){return{id:"compare-mode",title:"Compare / diff mode",menu:{options:[{id:"split",label:"Split"},...r],value:e==="split"?"split":t,onSelect:u=>{u==="split"?n():a(u)}}}}const zi=`
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
// Logical binding 9 (uniform vec4: DATA-encoding norm params — normMode,
// boundsMin, boundsMax, boundsActive) -> native binding 9*3+2 = 29. Only the
// scalar/LUT (isScalar) path reads it; it feeds cairnDataIndex (the norm
// reshape + min/max bounds affine). Defaults to vec4(0) when the caller omits it
// (zero-filled) — normMode 0 (linear) + boundsActive 0, so a colormap with no
// norm/bounds renders bit-for-bit as before. The power exponent reuses the gamma
// uniform (u_bind2.z), free on the lut path.
@group(0) @binding(29) var<uniform> u_bind9: vec4<f32>;
// Logical binding 10 (uniform vec4: DATA-encoding multi-channel REDUCE params —
// reduceMode, channelCount k, SCALAR-MODE enum (.z), gray encode-gamma (.w)) ->
// native binding 10*3+2 = 32. Only the scalar/LUT (isScalar) path reads it; it
// feeds cairnReduceScalar (the ℝᵏ→scalar collapse) BEFORE cairnDataIndex. .z is a
// scalar-MODE enum: 0 = LUT sample (table colormap), 1 = ANALYTIC signed-color
// (tev red-green: cairnSignedAnalyticColor + shared output-encode, no LUT bind),
// 2 = GRAY NONE (the plain-grayscale "none" DATA encoding: cairnDataIndex → scene-
// linear gray vec3 → shared output-encode; HDR-native, no LUT bind), 3 = TURBO
// false-color (tev-exact: the bound turbo table sampled at cairnTurboDataIndex —
// the FIXED log2 index BAKED into the encoding, bypassing cairnDataIndex's norm).
// .w carries the
// GRAY-NONE encode-gamma (0 = sRGB OETF, >0 = the 1/γ power curve) — the transfer
// the gray output-encode uses (the power-NORM exponent still rides u_bind2.z). Both
// .z and .w default to 0 when the caller omits the slot (zero-filled) → LUT mode +
// sRGB encode; with cairnReduceScalar's k<=1 guard a scalar colormap (k=1) renders
// bit-for-bit as before.
@group(0) @binding(32) var<uniform> u_bind10: vec4<f32>;
// Logical binding 11 (texture, SECOND source slot b — the reference/baseline of
// an arity-2 diff CONTENT op) -> native binding 11*3+0 = 33. For a single-image
// (arity-1) render this is a 1x1 placeholder the caller binds (WebGPU requires
// every declared binding to have a resource); the IDENTITY content op (opId 0)
// ignores b, so the single-image path is byte-for-byte unaffected. See
// engine/image-engine.ts's srcB handling + content-ops/wgsl.ts.
@group(0) @binding(33) var t_bind11: texture_2d<f32>;
// Logical binding 12 (uniform f32: contentOpId — the CONTENT-op dispatch id) ->
// native binding 12*3+2 = 38. Selects the content op cairnContent applies to the
// two sampled slots: 0 = IDENTITY (passthrough of a; the zero-filled default, so
// a caller that sets no op renders as before), 1.. = the direct diff ops
// (signed/absolute/…) assembled from the content-op registry. See
// content-ops/wgsl.ts (CONTENT_OP_ID).
@group(0) @binding(38) var<uniform> u_bind12: f32;
// Logical binding 13 (uniform vec4: COMPOSITOR param — the per-frame scalar the
// Phase-3 compositor content ops (split/blend) read) -> native binding 13*3+2 = 41.
// .x = the divider position (split) or the mix alpha (blend); .yzw reserved (0).
// Driven live (divider drag / blend slider) with NO shader recompile — only this
// uniform changes. Defaults to vec4(0) when the caller omits it (zero-filled): the
// diff/identity ops ignore it, so the single-image + diff paths are unaffected. See
// engine/image-engine.ts's contentParam handling + content-ops/wgsl.ts.
@group(0) @binding(41) var<uniform> u_bind13: vec4<f32>;
// Logical binding 14 (uniform vec4: DISPLAY-space post-processing — the 8-bit
// ImageProcessing block's brightness/contrast/flipSign) -> native binding
// 14*3+2 = 44. .x = brightness, .y = contrast, .z = flipSign (0/1); .w reserved.
// Applied as a FINAL affine in the ENCODED (display) color space AFTER the
// output-encode — the numeric mirror of the CPU SDR pane's CSS filter
// (media-compare/post-processing's brightness(1+b) contrast(1+c) invert), so one
// knob renders identically on the CPU (CSS) and GPU (shader) backends (audit H1).
// Defaults to vec4(0) when the caller omits it (zero-filled): brightness 0 +
// contrast 0 + flipSign 0 = cairnDisplayAdjust identity, so every existing case
// (and every path where the pane sets no processing) renders bit-for-bit as
// before. exposure/offset are NOT here — they are lifted top-level and applied in
// scene-linear space (u_bind2.x / u_bind6). Ported byte-identically from
// image/tonemap.ts's applyDisplayAdjust1.
@group(0) @binding(44) var<uniform> u_bind14: vec4<f32>;

// Display-transfer stage — the SDR sRGB/gamma OETF (+ the sRGB EOTF that
// LINEARIZES an 8-bit source when srgbDecode/u_bind8 is set) and the EXTENDED
// (unclamped, origin-mirrored) HDR-out encoders — ASSEMBLED from the shared
// OUTPUT_ENCODE_WGSL (image/encodings), the SAME block the diff-display blit
// (engine/diff-engine.ts) interpolates. Ported byte-identically from
// image/tonemap.ts's srgbOetf/srgbEotf/outputEncode + extended*; see that file's
// doc block for WHY the hdrOut path must transfer-encode (W3C ColorWeb-CG).
${ca}

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

// Manual bilinear blend for the SECOND source slot (t_bind11) — the arity-2 diff
// CONTENT ops sample both slots at the fragment source UV. A verbatim twin of
// sampleBilinearF on t_bind11 (WGSL textures are not first-class parameters, so
// the sampler is duplicated rather than parameterized). Unused by the single-image
// (identity) path.
fn sampleBilinearB(uv: vec2<f32>, dims: vec2<f32>) -> vec4<f32> {
  let texel = uv * dims - vec2<f32>(0.5);
  let base = floor(texel);
  let frac = texel - base;
  let maxX = i32(dims.x) - 1;
  let maxY = i32(dims.y) - 1;
  let x0 = clamp(i32(base.x), 0, maxX);
  let x1 = clamp(i32(base.x) + 1, 0, maxX);
  let y0 = clamp(i32(base.y), 0, maxY);
  let y1 = clamp(i32(base.y) + 1, 0, maxY);
  let c00 = textureLoad(t_bind11, vec2<i32>(x0, y0), 0);
  let c10 = textureLoad(t_bind11, vec2<i32>(x1, y0), 0);
  let c01 = textureLoad(t_bind11, vec2<i32>(x0, y1), 0);
  let c11 = textureLoad(t_bind11, vec2<i32>(x1, y1), 0);
  let top = mix(c00, c10, frac.x);
  let bot = mix(c01, c11, frac.x);
  return mix(top, bot, frac.y);
}

// Colormap LUT family — the SHARED cairnLutColor(lut, scalar, cmapMode,
// filterLinear) from image/encodings (LUT_FAMILY_WGSL), the SAME family the diff
// blit consumes. Its nearest/linear samplers are selected by the SAME filter
// flag (u_bind5) that picks nearest/bilinear source sampling, so a colormapped
// image shares ONE interpolation decision with the plain path: crisp round-half-
// UP nearest at the pixelated zoom, adjacent-entry blend at moderate zoom (so an
// interpolated scalar yields a smooth color instead of snapping to one of 256
// bins). The float single-image path uses cmap-mode 0 (linear / full ramp); the
// LUT holds DISPLAY (sRGB) colors written to the surface UNCHANGED (no output
// re-encode) — see the isScalar short-circuit in fs_main.
${ua}

// The curve helper fns (reinhardCurve/acesCurve/extended*Curve) + the
// operatorId-dispatched applyOperator are ASSEMBLED from the display-encoding
// registry (image/encodings) — the single source of truth shared with the CPU
// twins (image/tonemap.ts) and the compose path (kernels/prelude.wgsl.ts). Ids:
// 0=linear, 1=srgb, 2=reinhard, 3=aces, 4=extended, 5=extended-reinhard,
// 6=extended-aces, 7=extended-clamp, 8=gamma, 9=normal (remaps:true → the
// single-image path includes the normal remap; compose passes remaps:false).
// linear/srgb/gamma are the default clamp (no explicit branch); the display
// transfer lives in outputEncodeF, selected per operator by the gamma uniform.
${la({remaps:!0})}

// CONTENT stage — ASSEMBLED from the content-op registry (image/content-ops),
// the single source of truth for "what k-channel value does this texel carry".
// cairnContent(a, b, uv, param, opId) dispatches on the contentOpId uniform
// (u_bind12): opId 0 = IDENTITY (passthrough of the single sampled slot a — the
// sampled source enters the display pipeline here, byte-for-byte the pre-diff
// path); opId 1.. = the direct pointwise diff ops (signed/absolute/squared +
// relative variants), each the raw per-channel error over the two sampled slots
// a,b; and the COMPOSITOR ops split/blend, which composite a,b by the fragment
// SCREEN uv against the compositor param (u_bind13.x — the divider position /
// alpha). The display stage downstream (exposure, isScalar/reduce/dataIndex,
// applyOperator, output-encode) is unchanged and consumes cairnContent's output —
// a diff is displayed as a scalar error (reduce → colormap) via its
// defaultEncoding; a split/blend composite is LIGHT (k=3) displayed as a plain
// image (curves).
${da()}

// DISPLAY-space post-processing (brightness/contrast/flipSign) — the numeric
// mirror of image/tonemap.ts's applyDisplayAdjust1 (which itself is the numeric
// definition of the CPU SDR pane's CSS filter). Applied to the ENCODED display
// color AFTER the output-encode: brightness(1+b) then contrast(1+c) then, when
// flipSign, invert(1). UNCLAMPED — the surface write / readback clamps to [0,1],
// matching CSS rasterization. With the zero-filled default (b=0,c=0,flip=0) this
// is the identity, so every non-processing path is byte-for-byte unchanged.
fn cairnDisplayAdjust(c: vec3<f32>) -> vec3<f32> {
  let brightness = u_bind14.x;
  let contrast = u_bind14.y;
  let flip = u_bind14.z > 0.5;
  var v = c * (1.0 + brightness);
  v = (v - vec3<f32>(0.5)) * (1.0 + contrast) + vec3<f32>(0.5);
  if (flip) { v = vec3<f32>(1.0) - v; }
  return v;
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

  // SECOND source slot b — sampled at the same source UV from t_bind11 (its own
  // dims). Only the arity-2 diff CONTENT ops read it; for the single-image path
  // it is a 1x1 placeholder the IDENTITY op ignores, so this sample is inert.
  let srcDimsB = vec2<f32>(textureDimensions(t_bind11));
  var sampledB: vec4<f32>;
  if (filterLinear) {
    sampledB = sampleBilinearB(srcUV, srcDimsB);
  } else {
    let coordB = vec2<i32>(srcUV * srcDimsB);
    sampledB = textureLoad(t_bind11, coordB, 0);
  }

  let exposureEV = u_bind2.x;
  let operatorId = i32(round(u_bind2.y));
  let gamma = u_bind2.z;
  let isScalar = u_bind2.w > 0.5;
  let hdrOut = u_bind4 > 0.5;
  let offset = u_bind6;
  let peak = u_bind7;
  let srgbDecode = u_bind8 > 0.5;

  // CONTENT stage — the sampled source slot(s) enter the display pipeline through
  // the content-op registry (cairnContent, assembled above), dispatched by the
  // contentOpId uniform (u_bind12). opId 0 = IDENTITY (passthrough of a, the
  // zero-filled default), so content == sampled and the single-image display
  // pipeline below is byte-for-byte unchanged; opId 1.. = the direct diff ops
  // (raw per-channel error over a,b), which the display stage then encodes
  // (reduce -> colormap) via the op's defaultEncoding.
  let contentOpId = i32(round(u_bind12));
  // uv (fragment SCREEN uv) + u_bind13 (the compositor param) feed the split/
  // blend COMPOSITOR ops — the divider is a DEST-space cut (uv.x < param.x), so
  // it stays put under source zoom/pan exactly like GpuComparePane. The diff /
  // identity ops ignore both, so this is inert for every non-compositor op.
  let content = cairnContent(sampled, sampledB, uv, u_bind13, contentOpId);

  // 0) [SDR display-transfer path] sRGB-DECODE the sampled 8-bit source to
  //    linear light so exposure/offset + the chosen transfer operate on linear
  //    values (tev-style). Off for the HDR/float path (scene-linear already).
  var src = content.rgb;
  if (srgbDecode) {
    src = vec3<f32>(srgbEotf(src.r), srgbEotf(src.g), srgbEotf(src.b));
  }

  // 1) exposure + offset (TEV convention), in scene-linear space:
  //    v * 2^EV + offset. Offset is additive AFTER exposure, BEFORE the
  //    colormap / tone-map / output-encode stages below.
  var rgb = src * exp2(exposureEV) + vec3<f32>(offset);

  // 2) scalar image + colormap LUT family (the DATA encoding). The scalar (rgb.x,
  //    AFTER exposure/offset = the colormap SENSITIVITY) indexes the shared LUT
  //    family; the sampled value is the FINAL DISPLAY color (the LUT holds sRGB-
  //    encoded colormap colors), so a colormap SHORT-CIRCUITS the tone-map
  //    operator + output-encode stages entirely and returns straight to the
  //    surface — exactly the diff blit's convention, and why the two now share
  //    one family. cmap-mode 0 (linear/full ramp) for the float image. The LUT
  //    lookup still mirrors the source filter (linear at moderate zoom, nearest
  //    pixelated) so false-color interpolation never diverges from the plain path.
  if (isScalar) {
    // Multi-channel follow-up: a k>1 sample is first REDUCED to a scalar
    // (cairnReduceScalar — luminance/mean over the color channels, via u_bind10.x
    // + k=u_bind10.y), so a colormap is legal on RGB/RGBA sources, not only
    // isolated scalars. At k<=1 it returns rgb.x (the pre-follow-up scalar).
    // Then the norm reshape (linear/log/power via u_bind9.x, power exponent =
    // gamma) + the optional min/max bounds affine (u_bind9.yz, engaged by
    // boundsActive u_bind9.w). With the zero-filled default (normMode 0,
    // boundsActive 0) cairnDataIndex is the identity, so the exposure/offset
    // sensitivity (already folded into the reduced scalar) is the sole affine.
    let reduceMode = i32(round(u_bind10.x));
    let channelCount = i32(round(u_bind10.y));
    // u_bind10.z is a SCALAR-MODE enum, not a bare flag: 0 = LUT sample (table
    // colormap), 1 = ANALYTIC (computed signed color, tev red-green), 2 = GRAY
    // NONE (the plain-grayscale "none" data encoding — scalar → data index →
    // scene-linear gray → shared output-encode, HDR-native), 3 = TURBO false-color
    // (tev-exact: the bound turbo table sampled at cairnTurboDataIndex, the FIXED
    // log2 index baked into the encoding). Kept an enum (not flags) so a fresh
    // uniform slot stays free for the gray encode-gamma (.w).
    let scalarMode = i32(round(u_bind10.z));
    let analytic = scalarMode == 1;
    let scalar = cairnReduceScalar(rgb, reduceMode, channelCount);
    if (analytic) {
      // ANALYTIC signed error (tev-style red-green) — computed color, no LUT
      // bind. The reduced signed scalar (exposure already SCALED its amplitude)
      // maps to a SCENE-LINEAR color that flows through the SHARED output-encode
      // (like a curve), so |v|>1 survives on the extended/HDR surface while |v|<=1
      // renders identically on SDR. gamma here is the sRGB OETF path (hasGamma
      // false when the pane leaves gamma unset — the analytic entry has no γ).
      let lin = cairnSignedAnalyticColor(scalar);
      let hasG = gamma > 0.0;
      if (hdrOut) {
        let enc = vec3<f32>(
          extendedOutputEncodeF(lin.r, gamma, hasG),
          extendedOutputEncodeF(lin.g, gamma, hasG),
          extendedOutputEncodeF(lin.b, gamma, hasG),
        );
        return vec4<f32>(cairnDisplayAdjust(enc), 1.0);
      }
      let enc = vec3<f32>(
        outputEncodeF(lin.r, gamma, hasG),
        outputEncodeF(lin.g, gamma, hasG),
        outputEncodeF(lin.b, gamma, hasG),
      );
      return vec4<f32>(cairnDisplayAdjust(enc), 1.0);
    }
    let normMode = i32(round(u_bind9.x));
    let boundsActive = u_bind9.w > 0.5;
    // TURBO false-color (scalar-mode 3): the LUT index is tev's FIXED log2 mapping
    // (cairnTurboDataIndex), BAKED into the encoding — NOT the user-facing
    // cairnDataIndex norm/bounds path. Everything else (reduce, the bound turbo
    // table, the LUT sampler) is the ordinary table-LUT path.
    var idx = cairnDataIndex(scalar, normMode, u_bind9.y, u_bind9.z, boundsActive, gamma);
    if (scalarMode == 3) { idx = cairnTurboDataIndex(scalar); }
    if (scalarMode == 2) {
      // GRAY NONE (the plain-grayscale "none" DATA encoding). A single-channel
      // scalar is DATA, not light: it carries the SAME data index the LUT path
      // computes (cairnDataIndex — linear norm + no bounds = the RAW value passed
      // through UNCLAMPED; log/power/bounds map it to [0,1]), but its color is the
      // SCENE-LINEAR gray vec3(idx) run through the SHARED output-encode — exactly
      // like a curve / the analytic entry, NOT a baked-sRGB LUT sample. So the SDR
      // surface clamps to [0,1] (byte-identical to the old srgb/linear/gamma curve
      // for in-range values) while the extended/HDR surface lets idx>1 SURVIVE.
      // The output-encode transfer is the curve's own encode-gamma (u_bind10.w:
      // 0 = sRGB OETF, >0 = the 1/γ power curve — linear→1, gamma→γ). The power-
      // NORM exponent still rides the gamma uniform (u_bind2.z) inside
      // cairnDataIndex above, so the two never collide.
      let ge = u_bind10.w;
      let hasGe = ge > 0.0;
      if (hdrOut) {
        let e = extendedOutputEncodeF(idx, ge, hasGe);
        return vec4<f32>(cairnDisplayAdjust(vec3<f32>(e, e, e)), 1.0);
      }
      let e = outputEncodeF(idx, ge, hasGe);
      return vec4<f32>(cairnDisplayAdjust(vec3<f32>(e, e, e)), 1.0);
    }
    return vec4<f32>(cairnDisplayAdjust(cairnLutColor(t_bind1, idx, 0, filterLinear)), 1.0);
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
    let enc = vec3<f32>(
      extendedOutputEncodeF(rgb.r, gamma, hasGamma),
      extendedOutputEncodeF(rgb.g, gamma, hasGamma),
      extendedOutputEncodeF(rgb.b, gamma, hasGamma),
    );
    return vec4<f32>(cairnDisplayAdjust(enc), 1.0);
  }
  let enc = vec3<f32>(
    outputEncodeF(rgb.r, gamma, hasGamma),
    outputEncodeF(rgb.g, gamma, hasGamma),
    outputEncodeF(rgb.b, gamma, hasGamma),
  );
  return vec4<f32>(cairnDisplayAdjust(enc), 1.0);
}
`,Zn=new WeakMap;function Ki(e,t){let r=Zn.get(e);r||(r=new Map,Zn.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:zi,targetFormat:t}),r.set(t,n)),n}function Wi(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Qn(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function tn(e,t,r,n){var K;const a=Wi(t),s=Ki(e,a),o=Qn(e,n.isScalar?n.colormap:void 0),u=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,b=Bn[n.operator]??Bn.srgb,S=new Float32Array([n.exposureEV,b,u,n.isScalar?1:0]),x=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),P=new Float32Array([n.hdrOut?1:0]),T=new Float32Array([n.filter==="nearest"?0:1]),A=new Float32Array([n.offset??0]),R=new Float32Array([n.peak??dr]),y=new Float32Array([n.srgbDecode?1:0]),L=fa[n.norm??"linear"]??0,C=typeof n.normMin=="number"&&Number.isFinite(n.normMin)&&typeof n.normMax=="number"&&Number.isFinite(n.normMax),c=new Float32Array([L,C?n.normMin:0,C?n.normMax:0,C?1:0]),d=ha[n.reduce??"mean"]??0,g=typeof n.channelCount=="number"?n.channelCount:1,v=n.analytic?1:n.grayNone?2:n.turbo?3:0,p=typeof n.grayEncodeGamma=="number"&&n.grayEncodeGamma>0?n.grayEncodeGamma:0,h=new Float32Array([d,g,v,p]),E=new Float32Array([n.contentOpId??0]),f=new Float32Array([n.contentParam??0,0,0,0]),w=new Float32Array([n.brightness??0,n.contrast??0,n.flipSign?1:0,0]),O=n.srcB?void 0:Qn(e,void 0),I=n.srcB??O;let _;try{_=e.createBindGroup(s,[{binding:0,resource:r},{binding:1,resource:o},{binding:2,resource:{uniform:S}},{binding:3,resource:{uniform:x}},{binding:4,resource:{uniform:P}},{binding:5,resource:{uniform:T}},{binding:6,resource:{uniform:A}},{binding:7,resource:{uniform:R}},{binding:8,resource:{uniform:y}},{binding:9,resource:{uniform:c}},{binding:10,resource:{uniform:h}},{binding:11,resource:I},{binding:12,resource:{uniform:E}},{binding:13,resource:{uniform:f}},{binding:14,resource:{uniform:w}}]),e.renderFullscreen(t,s,_)}finally{(K=_==null?void 0:_.destroy)==null||K.call(_),o.destroy(),O==null||O.destroy()}}function Jn(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,a=t/r,s=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:s,mae:a}}async function Hi(e,t,r,n){const a=n??$e({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),s=a.result.w,o=a.result.h,u=s*o*3;if(u<=0)return{mse:0,psnr:1/0,mae:0};if(a.fit==="crop"&&a.offsetA.x===0&&a.offsetA.y===0&&a.offsetB.x===0&&a.offsetB.y===0&&e.reduceDiffSumSquaredAbs){const{sumSq:d,sumAbs:g}=await e.reduceDiffSumSquaredAbs(t,r,s,o);return Jn(d,g,u)}const S=await e.readback(t),x=await e.readback(r),P=S instanceof Uint8Array?255:1,T=x instanceof Uint8Array?255:1,A=St(S,t.width,t.height,P,a.offsetA,a.fit==="fill",s,o),R=St(x,r.width,r.height,T,a.offsetB,a.fit==="fill",s,o);let y=0,L=0;const C=[0,0,0],c=[0,0,0];for(let d=0;d<o;d++)for(let g=0;g<s;g++){A(g,d,C),R(g,d,c);for(let v=0;v<3;v++){const p=C[v]-c[v];y+=p*p,L+=Math.abs(p)}}return Jn(y,L,u)}function St(e,t,r,n,a,s,o,u){const b=(P,T,A)=>e[(T*t+P)*4+A]??0;if(!s)return(P,T,A)=>{const R=Math.min(Math.max(P+a.x,0),t-1),y=Math.min(Math.max(T+a.y,0),r-1);A[0]=b(R,y,0)/n,A[1]=b(R,y,1)/n,A[2]=b(R,y,2)/n};const S=t-1,x=r-1;return(P,T,A)=>{const R=(P+.5)/o,y=(T+.5)/u,L=R*t-.5,C=y*r-.5,c=Math.floor(L),d=Math.floor(C),g=L-c,v=C-d,p=Math.min(Math.max(c,0),S),h=Math.min(Math.max(c+1,0),S),E=Math.min(Math.max(d,0),x),f=Math.min(Math.max(d+1,0),x);for(let w=0;w<3;w++){const O=b(p,E,w),I=b(h,E,w),_=b(p,f,w),K=b(h,f,w),X=O+(I-O)*g,de=_+(K-_)*g;A[w]=(X+(de-X)*v)/n}}}const Yi=128,ji=512*1024*1024;class qi{constructor(t=Yi,r=ji){U(this,"map",new Map);U(this,"totalBytes",0);U(this,"maxEntries");U(this,"maxBytes");this.maxEntries=t,this.maxBytes=r}get(t){const r=this.map.get(t);return r&&(this.map.delete(t),this.map.set(t,r)),r}has(t){return this.map.has(t)}set(t,r){const n=this.map.get(t);n&&(this.totalBytes-=n.bytes,n.texture.destroy(),this.map.delete(t)),this.map.set(t,r),this.totalBytes+=r.bytes,this.evict()}accountReadbackBytes(t,r){let n=!1;for(const a of this.map.values())if(a===t){n=!0;break}n&&(t.bytes+=r,this.totalBytes+=r,this.evict())}evict(){for(;this.map.size>this.maxEntries||this.totalBytes>this.maxBytes;){const t=this.map.keys().next().value;if(t===void 0)break;const r=this.map.get(t);if(this.map.size===1)break;this.map.delete(t),this.totalBytes-=r.bytes,r.texture.destroy()}}clear(){for(const t of this.map.values())t.texture.destroy();this.map.clear(),this.totalBytes=0}get size(){return this.map.size}}const er=new WeakMap;function nn(e){let t=er.get(e);return t||(t=new qi,er.set(e,t)),t}const tr=new WeakMap;function Xi(e,t,r){let n=tr.get(e);n||(n=new Map,tr.set(e,n));const a=n.get(t);if(a)return a;const s=r().catch(o=>{throw n.get(t)===s&&n.delete(t),o});return n.set(t,s),s}const nr=new WeakMap;function rr(e,t,r,n){let a=nr.get(e);a||(a=new Map,nr.set(e,a));const s=`${t}::${n}`;let o=a.get(s);return o||(o=e.createRenderPipeline({shaderWGSL:r,targetFormat:n}),a.set(s,o)),o}function Zi(e){return`
${pa}
${ga}
${ma}
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
`}const xt="rgba16float";function Qi(e,t,r,n,a,s){var L,C;const o=Te(n);if(!o)throw new Error(`computeDiff: unknown diff kernel "${n}"`);const u=s??$e({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),b=u.result.w,S=u.result.h,x=u.fit==="fill"?1:0,P=fr(o,a);if(o.kind==="pointwise"){const c=e.createTexture(b,S,xt),d=rr(e,`pw:${o.id}`,Zi(o.source),xt),g=new Float32Array([u.offsetA.x,u.offsetA.y,u.offsetB.x,u.offsetB.y]),v=new Float32Array([b,S,x,0]);let p;try{p=e.createBindGroup(d,[{binding:0,resource:t},{binding:1,resource:r},{binding:2,resource:{uniform:g}},{binding:3,resource:{uniform:v}}]),e.renderFullscreen(c,d,p)}finally{(L=p==null?void 0:p.destroy)==null||L.call(p)}return c}const T={width:b,height:S,params:P,sourceMap:{fill:u.fit==="fill",offsetA:u.offsetA,offsetB:u.offsetB}},A=o.buildPasses(T),R=new Map([["srcA",t],["srcB",r]]),y=[];try{for(const d of A.passes){const g=e.createTexture(b,S,xt);y.push(g),R.set(d.output,g);const v=rr(e,`mp:${o.id}:${d.name}`,d.shader,xt),p=d.inputs.map((E,f)=>{const w=R.get(E);if(!w)throw new Error(`computeDiff: pass "${d.name}" input "${E}" not produced yet`);return{binding:f,resource:w}});d.uniforms&&p.push(...d.uniforms(T));let h;try{h=e.createBindGroup(v,p),e.renderFullscreen(g,v,h)}finally{(C=h==null?void 0:h.destroy)==null||C.call(h)}}const c=R.get(A.final);if(!c)throw new Error(`computeDiff: final ref "${A.final}" not produced`);for(const d of y)d!==c&&d.destroy();return c}catch(c){for(const d of y)d.destroy();throw c}}function Ji(e,t){const r=fr(e,t);return Object.keys(r).sort().map(a=>`${a}=${r[a]}`).join(",")}function Rr(e,t,r,n,a){const s=Te(r),o=s?Ji(s,n):"",u=a?Sr(a):"";return`${e}|${t}|${r}|${o}|${u}`}function ar(e,t,r,n,a,s,o,u){const b=u??$e({w:t.w,h:t.h},{w:r.w,h:r.h},"top-left","crop","b"),S=Rr(s,o,n,a,b);return nn(e).has(S)}function Mr(e,t,r,n,a,s,o,u){const b=Te(n);if(!b)throw new Error(`ensureDiff: unknown diff kernel "${n}"`);const S=nn(e),x=u??$e({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),P=Rr(s,o,n,a,x),T=S.get(P);if(T)return T;const A=Qi(e,t,r,n,a,x),R=x.result.w,y=x.result.h,L={texture:A,width:R,height:y,displayRange:b.displayRange,bytes:R*y*8};return S.set(P,L),L}function eo(e,t,r){return`${e}|${t}|${r?Sr(r):""}`}function to(e,t,r,n,a,s){return Xi(e,eo(n,a,s),()=>no(e,t,r,n,a,s))}async function no(e,t,r,n,a,s){try{const o=Mr(e,t,r,"ssim",void 0,n,a,s);return o.ssimMean!==void 0?o.ssimMean:(o.ssimMeanPending||(o.ssimMeanPending=ro(e,o).then(u=>(o.ssimMean=u,u))),await o.ssimMeanPending)}catch{return ao(e,t,r,s)}}async function ro(e,t){if(t.width*t.height<=0)return NaN;if(e.reduceTextureChannelMean)return 1-await e.reduceTextureChannelMean(t.texture,0,t.width,t.height);const n=await Dr(e,t);return $i(n,t.width,t.height)}async function ao(e,t,r,n){const a=n??$e({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),s=a.result.w,o=a.result.h,u=s*o;if(u<=0)return NaN;const b=await e.readback(t),S=await e.readback(r),x=b instanceof Uint8Array?255:1,P=S instanceof Uint8Array?255:1,T=a.fit==="fill",A=St(b,t.width,t.height,x,a.offsetA,T,s,o),R=St(S,r.width,r.height,P,a.offsetB,T,s,o),y=new Float64Array(u),L=new Float64Array(u),C=[0,0,0],c=[0,0,0];for(let d=0;d<o;d++){for(let g=0;g<s;g++){A(g,d,C),R(g,d,c);const v=d*s+g;y[v]=On(C[0],C[1],C[2]),L[v]=On(c[0],c[1],c[2])}(d+1)%ba===0&&await va()}return wa(y,L,s,o)}async function Dr(e,t){return t.resultSamples?t.resultSamples:(t.resultSamplesPending||(t.resultSamplesPending=e.readback(t.texture).then(r=>{const n=r instanceof Float32Array?r:Float32Array.from(r);return t.resultSamples=n,nn(e).accountReadbackBytes(t,n.byteLength),n})),t.resultSamplesPending)}function Tr(e){const t=e.analytic?1:e.grayNone?2:e.turbo?3:0,r=e.isScalar?e.colormap:void 0;let n;return r&&r.length>=1024&&(n=r[512]*1+r[513]*3+r[514]*7+r[1020]*11+r[1021]*13+r[1022]*17),{operator:e.operator,hdrOut:e.hdrOut,reduce:e.reduce,channelCount:e.channelCount,scalarMode:t,hasColormap:!!r,colormapSig:n,contentParam:e.contentParam}}const io=12,Cr=6;let oo=0;const xe=[];function ir(e){const t=xe.indexOf(e);t!==-1&&xe.splice(t,1),xe.push(e)}function so(e){const t=xe.indexOf(e);t!==-1&&xe.splice(t,1)}function Rt(e,t,r){if(r!==void 0){const a=e.retained.get(r);if(a)return e.retained.delete(r),e.retained.set(r,a),a;const s=e.device.createTexture(t.width,t.height,t.format);return s.write(t.data),e.retained.set(r,s),co(e),s}const n=e.device.createTexture(t.width,t.height,t.format);return n.write(t.data),n}function co(e){for(;e.retained.size>Cr;){let t;for(const[n,a]of e.retained)if(a!==e.srcTexture&&a!==e.srcTextureB){t=n;break}if(t===void 0)break;const r=e.retained.get(t);e.retained.delete(t),r.destroy()}}function Ne(e,t){e&&t===void 0&&e.destroy()}function uo(e){for(const t of e.retained.values())t.destroy();e.retained.clear()}function Ge(e){e.parked||(so(e),Ne(e.srcTexture,e.sourceKey),e.srcTexture=null,Ne(e.srcTextureB,e.sourceBKey),e.srcTextureB=null,uo(e),e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),e.deepSampleTex&&(e.deepSampleTex.destroy(),e.deepSampleTex=null),e.surface=null,e.parked=!0)}function or(e){for(;xe.length>io;){const t=xe.find(r=>r!==e&&!r.visible)??xe.find(r=>r!==e);if(!t)break;Ge(t)}}function it(e){if(e.disposed)return;if(xa())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){ir(e),or(e);return}if(!e.backingWidth||!e.backingHeight)return;const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const r=e.backingWidth,n=e.backingHeight;if(e.canvas.width=r,e.canvas.height=n,e.surface.configure(r,n),e.deep){const a=t.createTexture(e.deep.width,e.deep.height,"rgba16float");e.srcTexture=a,e.deepBuffers=t.createDeepSampleBuffers(e.deep),t.compositeDeep(e.deepBuffers,a,e.deepZNear,e.deepZFar)}else e.source&&(e.srcTexture=Rt(e,e.source,e.sourceKey));e.sourceB&&(e.srcTextureB=Rt(e,e.sourceB,e.sourceBKey)),e.parked=!1,ir(e),or(e)}const sr=8;function Pr(e,t,r,n){try{const a=e.hdr?"rgba16float":"rgba8unorm";e.deepSampleTex||(e.deepSampleTex=e.device.createTexture(sr,sr,a));const s=e.deepSampleTex;tn(e.device,s,t,r),e.device.readback(s).then(o=>{Ea(n,lo(o,e.hdr),e.paneId)}).catch(()=>{})}catch{}}function lo(e,t){let r=0,n=0,a=0,s=0;const o=t?1:1/255;for(let x=0;x+3<e.length;x+=4){const P=e[x+3]*(t?1:.00392156862745098),T=P<=0?0:P;r+=e[x]*o*T,n+=e[x+1]*o*T,a+=e[x+2]*o*T,s+=T}if(s<=0)return{r:0,g:0,b:0};let u=r/s,b=n/s,S=a/s;if(t){const x=Math.max(u,b,S,1);u/=x,b/=x,S/=x}return{r:Math.min(1,u),g:Math.min(1,b),b:Math.min(1,S)}}function cr(e,t){if(e.disposed||!e.source&&!e.deep||!e.backingWidth||!e.backingHeight)return!0;try{if(it(e),!e.surface||!e.srcTexture)return!1;const r=e.srcTextureB?{...t,srcB:e.srcTextureB}:t;if(tn(e.device,e.surface,e.srcTexture,r),hr()){const n={mode:"image",sourceKey:e.sourceKey,sourceBKey:e.sourceBKey,contentOpId:t.contentOpId,hasSrcB:e.srcTextureB!=null,isScalar:t.isScalar,compareIntended:t.compareIntended,authoredColormap:t.authoredColormap,...Tr(t)};pr(n),gr()&&Pr(e,e.srcTexture,r,n)}return!0}catch(r){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",r),e.parked=!1,Ge(e),!1}}function ur(e,t,r,n,a,s){if(e.disposed||!e.source&&!e.deep||!e.sourceB)return null;try{if(it(e),!e.surface||!e.srcTexture||!e.srcTextureB)return null;const o=Mr(e.device,e.srcTexture,e.srcTextureB,t,n,r.a,r.b,s);if(tn(e.device,e.surface,o.texture,a),hr()){const u={mode:"cached-diff",sourceKey:e.sourceKey,sourceBKey:e.sourceBKey,contentOpId:a.contentOpId,hasSrcB:e.srcTextureB!=null,isScalar:a.isScalar,...Tr(a)};pr(u),gr()&&Pr(e,o.texture,a,u)}return o}catch(o){return console.warn("cairn-plot engine: cached-diff pane render failed, falling back to legacy pane",o),e.parked=!1,Ge(e),null}}function fo(e,t){if(e.disposed||!e.source||!e.sourceB)return null;try{return it(e),!e.srcTexture||!e.srcTextureB?null:Hi(e.device,e.srcTexture,e.srcTextureB,t)}catch(r){return console.warn("cairn-plot engine: pane metrics compute failed",r),e.parked=!1,Ge(e),null}}function ho(e,t,r){if(e.disposed||!e.source||!e.sourceB)return null;try{return it(e),!e.srcTexture||!e.srcTextureB?null:to(e.device,e.srcTexture,e.srcTextureB,t.a,t.b,r)}catch(n){return console.warn("cairn-plot engine: pane SSIM compute failed",n),e.parked=!1,Ge(e),null}}function po(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t,r){if(!e.disposed)if(e.source=t,e.deep=null,e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),!e.parked&&e.surface){const n=e.srcTexture,a=e.sourceKey,s=Rt(e,t,r);n&&n!==s&&Ne(n,a),e.srcTexture=s,e.sourceKey=r}else e.sourceKey=r},setSourceB(t,r){if(!e.disposed)if(e.sourceB=t,!e.parked&&e.surface){const n=e.srcTextureB,a=e.sourceBKey;if(t){const s=Rt(e,t,r);n&&n!==s&&Ne(n,a),e.srcTextureB=s,e.sourceBKey=r}else n&&Ne(n,a),e.srcTextureB=null,e.sourceBKey=void 0}else e.sourceBKey=t?r:void 0},setDeepSource(t,r,n){if(!e.disposed&&(e.deep=t,e.deepZNear=r,e.deepZFar=n,e.source=null,!e.parked&&e.surface)){Ne(e.srcTexture,e.sourceKey),e.sourceKey=void 0,e.deepBuffers&&e.deepBuffers.destroy();const a=e.device.createTexture(t.width,t.height,"rgba16float");e.srcTexture=a,e.deepBuffers=e.device.createDeepSampleBuffers(t),e.device.compositeDeep(e.deepBuffers,a,r,n)}},setDeepWindow(t,r){e.disposed||(e.deepZNear=t,e.deepZFar=r,!e.parked&&e.deepBuffers&&e.srcTexture&&e.device.compositeDeep(e.deepBuffers,e.srcTexture,t,r))},resize(t,r){if(e.disposed)return;const n=Math.max(1,Math.round(t)),a=Math.max(1,Math.round(r));e.backingWidth===n&&e.backingHeight===a||(e.backingWidth=n,e.backingHeight=a,!e.parked&&e.surface&&(e.canvas.width=n,e.canvas.height=a,e.surface.configure(n,a)))},render(t){return cr(e,t)},renderDiffCached(t,r,n,a,s){return ur(e,t,r,n,a,s)},isDiffResultCached(t,r,n,a){return e.disposed||!e.source||!e.sourceB?!1:ar(e.device,{w:e.source.width,h:e.source.height},{w:e.sourceB.width,h:e.sourceB.height},t,n,r.a,r.b,a)},renderDiff(t,r,n,a,s){var b;const o=Te(t);if((o==null?void 0:o.kind)==="multipass"){const S=ur(e,t,r,(b=o.computeParams)==null?void 0:b.call(o,n),{...a,channelCount:1,isScalar:!0,norm:"linear"},s);return S?{entry:S}:"failed"}const u=Xt(t);return u===0?"hold":cr(e,{...a,contentOpId:u})?{entry:null}:"failed"},isDiffContentResident(t,r,n,a){var o;const s=Te(t);return(s==null?void 0:s.kind)!=="multipass"?Xt(t)!==0:e.disposed||!e.source||!e.sourceB?!1:ar(e.device,{w:e.source.width,h:e.source.height},{w:e.sourceB.width,h:e.sourceB.height},t,(o=s.computeParams)==null?void 0:o.call(s,n),r.a,r.b,a)},computeMetrics(t){return fo(e,t)},computeSsim(t,r){return ho(e,t,r)},readDiffResult(t){return e.disposed?null:Dr(e.device,t)},park(){e.disposed||Ge(e)},restore(){e.disposed||!e.source&&!e.deep||it(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Ge(e),e.source=null,e.sourceB=null,e.sourceKey=void 0,e.sourceBKey=void 0,e.deep=null,e.disposed=!0)}}}async function go(e,t){const r=await yt(),n={paneId:++oo,canvas:e,device:r,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,sourceB:null,srcTextureB:null,sourceKey:void 0,sourceBKey:void 0,retained:new Map,deep:null,deepZNear:-1/0,deepZFar:1/0,deepBuffers:null,deepSampleTex:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return po(n)}function lr(e){e.dispose()}function mo(e){var t;return((t=xe.find(r=>r.canvas===e))==null?void 0:t.surface)??null}function bo(e){const{hdrMode:t,naturalDims:r,sdrColormap:n,resolvedKernelId:a,hdrDataRef:s,sdrImageDataRef:o,refFloatRef:u,refU8Ref:b,diffSamplesRef:S,diffResultDimsRef:x}=e,P=m.useCallback((R,y,L)=>{if(t){const h=s.current,E=r;if(!h||!E||R<0||y<0||R>=E.w||y>=E.h)return null;const f=h.shape.length===2?1:h.shape[2]??1,w=(y*E.w+R)*f,O=mt(h.pixels),I=f===1?[O(w)]:[O(w),O(w+1),O(w+2)];return Fe(I,"unit",L)}const C=o.current;if(!C||R<0||y<0||R>=C.width||y>=C.height)return null;const c=(y*C.width+R)*4,d=C.data[c],g=C.data[c+1],v=C.data[c+2];return Fe(n!=="none"?[d]:[d,g,v],"uint8",L)},[t,r,n,s,o]),T=m.useCallback((R,y,L)=>{const C=Te(a);if((C==null?void 0:C.kind)==="multipass"){const h=S.current,E=x.current;if(!h||!E||R<0||y<0||R>=E.w||y>=E.h)return null;const f=(y*E.w+R)*4,w=C.output==="scalar"?[h[f]??0]:[h[f]??0,h[f+1]??0,h[f+2]??0];return Fe(w,"unit",L)}const c=ya(a);if(!c||!Sa(c))return null;const d=()=>{if(t){const f=s.current,w=r;if(!f||!w||R<0||y<0||R>=w.w||y>=w.h)return null;const O=f.shape.length===2?1:f.shape[2]??1,I=(y*w.w+R)*O,_=mt(f.pixels);return O===1?[_(I),_(I),_(I)]:[_(I),_(I+1),_(I+2)]}const h=o.current;if(!h||R<0||y<0||R>=h.width||y>=h.height)return null;const E=(y*h.width+R)*4;return[h.data[E]/255,h.data[E+1]/255,h.data[E+2]/255]},g=()=>{const h=u.current;if(h&&h.dtype==="float"){const{h:w,w:O,c:I}=at(h.shape);if(R<0||y<0||R>=O||y>=w)return null;const _=(y*O+R)*I,K=mt(h.pixels);return I===1?[K(_),K(_),K(_)]:[K(_),K(_+1),K(_+2)]}const E=b.current;if(!E||R<0||y<0||R>=E.width||y>=E.height)return null;const f=(y*E.width+R)*4;return[E.data[f]/255,E.data[f+1]/255,E.data[f+2]/255]},v=d(),p=g();return!v||!p?null:Fe(c.cpu([v,p],3),"unit",L)},[a,t,r,s,o,u,b,S,x]),A=m.useCallback((R,y,L)=>{const C=u.current;if(C&&C.dtype==="float"){const{h:g,w:v,c:p}=at(C.shape);if(R<0||y<0||R>=v||y>=g)return null;const h=(y*v+R)*p,E=mt(C.pixels),f=p===1?[E(h)]:[E(h),E(h+1),E(h+2)];return Fe(f,"unit",L)}const c=b.current;if(!c||R<0||y<0||R>=c.width||y>=c.height)return null;const d=(y*c.width+R)*4;return Fe([c.data[d],c.data[d+1],c.data[d+2]],"uint8",L)},[u,b]);return{samplePixel:P,sampleDiffPixel:T,sampleForeground:A}}function vo(e){const{diffMode:t,compositorMode:r,hasCompare:n,hdrMode:a,deepActive:s,imageUrl:o,contentKeyA:u,contentKeyB:b,hasBOperand:S,resolvedKernelId:x,compareOpMode:P,splitPosition:T,paneReady:A,appliedPrimaryId:R,appliedBId:y,naturalDims:L,refDims:C,isDiffContentResident:c}=e,d=t?"diff":r?"compositor":"image",g=n?`A:${u}`:a?s?"deep":"hdr":`img:${o}`,v=n&&S?`B:${b}`:null,p=A&&R===g&&y===v;return{mode:d,primaryId:g,bId:v,kernelId:t?x:"",contentParam:r?T:0,contentKey:`${g}|${v}|${t?x:""}|${r?P:""}`,sourcesApplied:p,resident:p&&!!L&&(t||r?!!C:!0)&&(t?c():!0)}}const wo={pixels:oi(new Float32Array(0)),shape:[0,0],dtype:"<f4"},xo=new Set(["linear","srgb","gamma"]);function Ar(e){const{h:t,w:r,c:n}=at(e.shape);if(e.pixels.kind==="f16-bits"){const o=e.pixels.bits,u=new Uint16Array(r*t*4);for(let b=0;b<r*t;b++){const S=b*n,x=b*4;if(n===1){const P=o[S];u[x]=P,u[x+1]=P,u[x+2]=P,u[x+3]=Fn}else u[x]=o[S],u[x+1]=o[S+1],u[x+2]=o[S+2],u[x+3]=n>=4?o[S+3]:Fn}return{data:u,width:r,height:t,format:"rgba16float"}}const a=e.pixels.values,s=new Float32Array(r*t*4);for(let o=0;o<r*t;o++){const u=o*n;let b,S,x,P=1;n===1?b=S=x=De(a[u]):n===3?(b=De(a[u]),S=De(a[u+1]),x=De(a[u+2])):(b=De(a[u]),S=De(a[u+1]),x=De(a[u+2]),P=De(a[u+3]));const T=o*4;s[T]=b,s[T+1]=S,s[T+2]=x,s[T+3]=P}return{data:s,width:r,height:t,format:"rgba32float"}}async function Eo(e){if(e.dtype==="float")return Ar({pixels:e.pixels,shape:e.shape,dtype:e.numpyDtype??"<f4",deep:e.deep});if(!e.url)return null;const t=await mr(e.url);return t?{data:t.data,width:t.width,height:t.height,format:"rgba8unorm"}:null}function yo(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const a=si({box:{left:0,top:0,width:t.width,height:t.height},naturalWidth:r,naturalHeight:n}),s=a.scale,o=a.visibleW*s,u=a.visibleH*s,b=a.imgLeft,S=a.imgTop,x=Math.max(e.zoom,1e-6),P=t.width/(x*o),T=t.height/(x*u),A=-b/o-e.pan.x/(x*o),R=-S/u-e.pan.y/(x*u);return{x:A,y:R,w:P,h:T}}function So(e,t,r,n){const a=e.w*r,s=e.h*n;return a<=0||s<=0||t.width<=0||t.height<=0?0:ci({box:{left:0,top:0,width:t.width,height:t.height},naturalWidth:r,naturalHeight:n,sourceWindow:{x:0,y:0,w:e.w,h:e.h}})}function Ro(e){var Mn,Dn,Tn,Cn,Pn;const t=Ra(e),r=Ma(t),n=e.compareSource,a=!!n,s=a?n.mode==="blend"?"split":n.mode??"diff":null,o=s==="split",u=s==="diff",b=o?"split":null,S=(n==null?void 0:n.splitPosition)??.5,x=m.useRef(null),P=m.useRef(null),T=m.useRef(null),A=m.useRef(null),R=m.useRef(null),y=r&&!!((Mn=t.hdr)!=null&&Mn.deep),L=m.useCallback((i,l)=>{var M,D;(M=A.current)==null||M.setDeepWindow(i,l),(D=R.current)==null||D.call(R)},[]),C=Da(r?t.hdr:wo,y?L:void 0),c=m.useRef(!1),[d,g]=m.useState(!1),[v,p]=m.useState(!1),[h,E]=m.useState(!1),[f,w]=m.useState(null),[O,I]=m.useState(0),[_,K]=m.useState(0),[X,de]=m.useState({x:0,y:0,w:1,h:1}),Y=m.useRef(null),V=m.useRef(null),[q,Z]=m.useState(0),Ve=m.useRef(null),Ie=m.useRef(null),Ee=m.useRef(new Map),se=m.useRef(void 0),ot=m.useRef(void 0),Mt=m.useRef(void 0),rn=m.useRef(null),an=m.useRef(0),on=m.useRef(void 0);m.useRef(-1);const _r=m.useCallback((i,l,M)=>{const D=Ee.current;for(D.has(i)&&D.delete(i),D.set(i,{upload:l,ref:M});D.size>Cr;){const k=D.keys().next().value;if(k===void 0)break;D.delete(k)}},[]),ae=(n==null?void 0:n.contentKeyA)??"diff:a",ye=(n==null?void 0:n.contentKeyB)??"diff:b",Ue=t.zoom??1,Ce=t.pan??{x:0,y:0},Br=t.onViewportChange,sn=t.toolbar??!0,fe=t.colormap??"none",st=t.tonemap,Or=m.useId(),cn=Ta([`vp-st-pane-${Or}`]),un=e.setSyncedSettings,G=un?e.syncedSettings:cn.settings,ct=un??cn.set,Dt=(()=>{const i=n==null?void 0:n.colormap;return i==null||i==="none"?null:i==="viridis"?"turbo":i})(),Tt=!!(n!=null&&n.onDiffKernelChange),[Gr,Ir,ze]=Ca((n==null?void 0:n.opId)??"absolute");m.useLayoutEffect(()=>{Tt||!n||Ir(n.opId??"absolute")},[Tt,n==null?void 0:n.opId,!!n]);const ce=Tt?n.opId??"absolute":(G==null?void 0:G.diffKernel)??Gr,Ke=m.useCallback(i=>{n!=null&&n.onDiffKernelChange?n.onDiffKernelChange(i):ct({diffKernel:i})},[n==null?void 0:n.onDiffKernelChange,ct]),Ct=e.source.dtype==="float"||(n==null?void 0:n.b.dtype)==="float",ie=u?ai(ce,!!Ct):ce,ln=Dt??bt(ie),Pt=m.useRef(null);Pt.current==null&&(Pt.current=a&&u?ln:fe);const he=r?at(C.hdr.shape).c:1,At=m.useCallback(i=>Pa(i),[]),Ur=typeof window<"u"&&!!window.__cairnDisableStackShared,ut=sn===!1||Ur||!!G,F=Aa({mode:r?"arity":"sdr",arity:he,curveSet:_a,propColormap:ut?fe:Pt.current??fe,propTonemap:st,resolveDefaultCurve:At,controlledSurface:ut,settings:G}),_t=()=>{const i=u?Dt??bt(ze.default):fe!=="none"?fe:At(st);F.setEncoding(i),W({encoding:i})},We=r?"none":F.colormap,He=r?F.colormap:"none",J=F.curveId,kr=F.hasParam("peak"),dn=fe!=="none"&&((Dn=vt(fe))==null?void 0:Dn.kind)==="lut",Bt=r&&he===1&&He==="none"&&xo.has(J),Ot=t.peak,Gt=Ot!=null&&Ot>0?Ot:ui(st)??dr,ue=(G==null?void 0:G.peak)!=null&&G.peak>0?G.peak:Gt,Lr=ue!==Gt,It=t.gamma,Ut=It&&It>0?It:Oa,pe=(G==null?void 0:G.tonemapGamma)!=null&&G.tonemapGamma>0?G.tonemapGamma:Ut,Fr=pe!==Ut,ne=(G==null?void 0:G.exposureEV)??0,re=(G==null?void 0:G.offset)??0,ee=t.colorRange,kt=!!((Tn=vt(F.encodingId))!=null&&Tn.turbo),fn=kt?"mean":Ln(he),ge=(G==null?void 0:G.reduce)??fn,H=m.useMemo(()=>(G==null?void 0:G.colorMin)!=null&&(G==null?void 0:G.colorMax)!=null?[G.colorMin,G.colorMax]:ee??null,[G==null?void 0:G.colorMin,G==null?void 0:G.colorMax,ee==null?void 0:ee[0],ee==null?void 0:ee[1]]),me=ee??null,Nr=((H==null?void 0:H[0])??null)!==((me==null?void 0:me[0])??null)||((H==null?void 0:H[1])??null)!==((me==null?void 0:me[1])??null),Pe=(F.isLut&&F.hasParam("min")||Bt)&&!!H&&Number.isFinite(H[0])&&Number.isFinite(H[1]),Se=m.useMemo(()=>{const i=ee??[0,1],l=i[0],M=i[1],D=M>l?M-l:1;return{lo:l,hi:M,span:D}},[ee==null?void 0:ee[0],ee==null?void 0:ee[1]]),be=Ba(F,ln),[Ae,Lt]=m.useState(null),[Ft,lt]=m.useState(null),[$r,Nt]=m.useState(0),[Q,hn]=m.useState(null),[ke,Vr]=m.useState(0),$t=m.useRef(null),Ye=m.useRef(null),je=m.useRef(null),zr=m.useCallback(()=>u?{encoding:rt("scalar",J,be),tonemapGamma:pe,peak:ue,exposureEV:ne,offset:re,reduce:ge,compareMode:"diff",diffKernel:ce}:{encoding:F.encodingId,tonemapGamma:pe,peak:ue,exposureEV:ne,offset:re,reduce:ge,...H?{colorMin:H[0],colorMax:H[1]}:{},...o?{compareMode:b,splitPosition:S}:{}},[u,be,ce,F.encodingId,F.colormap,J,pe,ue,ne,re,ge,H,o,b,S]),W=ct;Ga(t.settingsSyncGroupId,!!t.syncIsAnchor,ct,zr);const _e=m.useCallback(i=>{F.setEncoding(i),W({encoding:i})},[F,W]),pn=m.useCallback(i=>W({exposureEV:i}),[W]),gn=m.useCallback(i=>W({offset:i}),[W]),Vt=m.useCallback(i=>W({peak:i}),[W]),Kr=m.useCallback(i=>W({tonemapGamma:i}),[W]),Wr=m.useCallback(i=>W({reduce:i}),[W]),mn=m.useCallback(i=>W({colorMin:i[0],colorMax:i[1]}),[W]),Hr=m.useCallback(i=>W({infoPanel:i}),[W]),dt=m.useCallback(i=>{Ke(i);const l=bt(i);F.setEncoding(l),W({compareMode:"diff",diffKernel:i,encoding:rt("scalar",J,l)})},[Ke,W,F,J]),qe=m.useCallback(i=>{F.setEncoding(i==="none"?F.curveId:i),W({encoding:rt("scalar",J,i)})},[F,W,J]),Xe=m.useCallback(i=>{var l;(l=n==null?void 0:n.onCompareModeChange)==null||l.call(n,i),W({compareMode:i})},[n==null?void 0:n.onCompareModeChange,W]),Ze=m.useCallback(i=>{var l;(l=n==null?void 0:n.onSplitPositionChange)==null||l.call(n,i),W({splitPosition:i})},[n==null?void 0:n.onSplitPositionChange,W]);li(P,b==="split"?"split":"normal",Ze,{inStackedGrid:n==null?void 0:n.inStackedGrid,inOverlay:n==null?void 0:n.inOverlay});const zt=Ia();m.useEffect(()=>{const i=x.current;if(!i)return;let l=!1;return yt().then(M=>{var $;if(l)return;const D=(($=M.probeExtendedToneMapping)==null?void 0:$.call(M))??!1,k=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,B=D&&k&&(r||fe==="none");c.current=B,g(B),r&&!B&&vr(D?"no-hdr-display":"no-hdr-browser"),go(i,{hdr:B}).then(z=>{if(l){lr(z);return}A.current=z,E(!0)}).catch(z=>{l||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",z),p(!0))})}).catch(M=>{l||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",M),p(!0))}),()=>{l=!0,A.current&&(lr(A.current),A.current=null)}},[]),m.useEffect(()=>{const i=P.current;if(!i)return;const l=new ResizeObserver(()=>K(M=>M+1));return l.observe(i),()=>l.disconnect()},[]),m.useEffect(()=>{const i=P.current;if(!i)return;const l=new IntersectionObserver(M=>{const D=M[0];if(!D)return;const k=A.current;k&&(k.setVisible(D.isIntersecting),D.isIntersecting?k.isParked&&(k.restore(),K(N=>N+1)):k.park())},{threshold:0});return l.observe(i),()=>l.disconnect()},[]),m.useLayoutEffect(()=>{var M;if(!r||!h||y)return;const i=C.hdr;Y.current=i;const l=Ar(i);(M=A.current)==null||M.setSource(l,a?ae:void 0),se.current=a?`A:${ae}`:"hdr",w(D=>D&&D.w===l.width&&D.h===l.height?D:{w:l.width,h:l.height}),Z(D=>D+1),I(D=>D+1)},[r,h,y,r?C.hdr:null,a,a?ae:null]),m.useEffect(()=>{if(!r||!h||!y)return;const i=t.hdr,l=i.deep;Y.current=i;let M=!1;return l.getGpuCsr().then(D=>{var k;M||((k=A.current)==null||k.setDeepSource(D,l.zMin,l.zMax),se.current="deep",w(N=>N&&N.w===D.width&&N.h===D.height?N:{w:D.width,h:D.height}),Z(N=>N+1),I(N=>N+1))}).catch(D=>{M||console.warn("[cairn] deep GPU CSR upload failed:",D)}),()=>{M=!0}},[r,h,y,r?t.hdr.deep:null]),m.useLayoutEffect(()=>{if(r||!h)return;const i=t,l=i.imageUrl,M=a?"none":We;if(!l){V.current=null,se.current="img:",w(null),Z(B=>B+1);return}const D=a?ae:void 0,k=(B,$,z)=>{var Le,tt;V.current=B;const Be={data:$.data,width:$.width,height:$.height,format:"rgba8unorm"};(Le=A.current)==null||Le.setSource(Be,D),se.current=a?`A:${ae}`:`img:${l}`,w(oe=>oe&&oe.w===$.width&&oe.h===$.height?oe:{w:$.width,h:$.height}),(tt=z.onNaturalSize)==null||tt.call(z,$.width,$.height),Z(oe=>oe+1),I(oe=>oe+1)};if(M==="none"){const B=Ua(l);if(B){k(B,B,i);return}}let N=!1;return mr(l).then(B=>{if(N||!B)return;let $=B;if(M!=="none"){const z=`gpu::${l}::${M}::ev${ne}::off${re}`,Be=ka(z);if(Be)$=Be;else{const Le=La(M);$=Fa(B,M,Le,ne,re),Na(z,$)}}k(B,$,i)}),()=>{N=!0}},[r,h,r?null:t.imageUrl,r?null:We,r?0:ne,r?0:re,a,a?ae:null]),m.useLayoutEffect(()=>{var N;if(!h)return;const i=a?n==null?void 0:n.b:void 0;if(!i){(N=A.current)==null||N.setSourceB(null),ot.current=null,hn(null),Ve.current=null,Ie.current=null;return}const l=ye,M=B=>{var $;($=A.current)==null||$.setSourceB(B,l),ot.current=`B:${l}`,i.dtype==="float"?(Ve.current=i,Ie.current=null):(Ie.current={data:B.data,width:B.width,height:B.height},Ve.current=null),hn(z=>z&&z.w===B.width&&z.h===B.height?z:{w:B.width,h:B.height}),Vr(z=>z+1)},D=Ee.current.get(l);if(D){Ee.current.delete(l),Ee.current.set(l,D),M(D.upload);return}let k=!1;return Eo(i).then(B=>{k||!B||(_r(l,B,i),M(B))}),()=>{k=!0}},[h,a,n==null?void 0:n.b,ye]);const Re=m.useMemo(()=>!a||!f||!Q?null:$e(f,Q,(n==null?void 0:n.align)??"top-left",(n==null?void 0:n.fit)??"crop","b"),[a,f,Q,n==null?void 0:n.align,n==null?void 0:n.fit]),Kt=m.useMemo(()=>{if(!u||!Ct)return null;const i=e.source.dtype==="float"?e.source:null;if(!i)return null;const{h:l,w:M,c:D}=at(i.shape),k=$a(i.pixels);return Ni(k,M,l,D)},[u,Ct,e.source]),Qe=t.exposure??0,Je=t.offset??0,ve=r?void 0:t.processing,bn={brightness:(ve==null?void 0:ve.brightness)??0,contrast:(ve==null?void 0:ve.contrast)??0,flipSign:(ve==null?void 0:ve.flipSign)??!1},ft=!r&&We==="none",le=vo({diffMode:u,compositorMode:o,hasCompare:a,hdrMode:r,deepActive:y,imageUrl:t.imageUrl??"",contentKeyA:ae,contentKeyB:ye,hasBOperand:!!(n!=null&&n.b),resolvedKernelId:ie,compareOpMode:b,splitPosition:S,paneReady:h,appliedPrimaryId:se.current,appliedBId:ot.current,naturalDims:f,refDims:Q,isDiffContentResident:()=>{var i;return!!((i=A.current)!=null&&i.isDiffContentResident(ie,{a:ae,b:ye},{hdrExposures:Kt},Re??void 0))}}),Me=m.useCallback(()=>{var An;const i=A.current;if(!i||!h||!f)return!1;const l=P.current,D=T.current??l,k=D?D.getBoundingClientRect():null;if(!k||k.width<=0||k.height<=0)return!1;const N=yo({zoom:Ue,pan:Ce},k,f.w,f.h);de(te=>te.x===N.x&&te.y===N.y&&te.w===N.w&&te.h===N.h?te:N),i.resize(Math.round(k.width*zt),Math.round(k.height*zt));const B=So(N,k,f.w,f.h)>=Va?"nearest":"linear",$=N;if(se.current!==le.primaryId||ot.current!==le.bId)return!1;if(o){if(!Q)return!1;const te=Gn(J,c.current?ue:1,c.current,pe),Oe={exposureEV:Qe+ne,offset:Je+re,operator:te.operator,gamma:te.gamma,isScalar:!1,hdrOut:te.hdrOut,peak:te.peak,srgbDecode:!r,uv:$,filter:B,contentOpId:Xt(b),contentParam:S};try{i.render(Oe)||p(!0)}catch(we){console.warn("cairn-plot: GpuImagePane compositor render failed, falling back to legacy pane",we),p(!0)}return!0}if(u){if(!Q)return!1;const te=Te(ie)?ie:"absolute",Oe=be,we=Oe!=="none"?vt(Oe):void 0,Wt=!!(we!=null&&we.analytic),ra=!!(we!=null&&we.turbo),_n=Oe!=="none"&&!Wt?In(Oe):void 0,aa={exposureEV:ne,offset:re,operator:"linear",isScalar:Oe!=="none",reduce:"mean",channelCount:3,hdrOut:Wt?c.current:!1,srgbDecode:!1,uv:$,filter:B,...Wt?{analytic:!0}:{},...ra?{turbo:!0}:{},..._n?{colormap:_n}:{}};try{const nt=i.renderDiff(te,{a:ae,b:ye},{hdrExposures:Kt},aa,Re??void 0);if(nt==="hold")return!1;nt==="failed"?($t.current=null,p(!0)):$t.current=nt.entry}catch(nt){console.warn("cairn-plot: GpuImagePane diff render failed, falling back to legacy pane",nt),p(!0)}return!0}const z=Gn(J,c.current?ue:1,c.current,pe),Be=r&&He!=="none",Le=Be&&!!((An=vt(He))!=null&&An.analytic),tt=Pe?0:Qe+ne,oe=Pe?0:Je+re,na=Le?{exposureEV:Qe+ne,offset:Je+re,operator:"linear",isScalar:!0,analytic:!0,hdrOut:z.hdrOut,peak:z.peak,srgbDecode:!1,reduce:ge,channelCount:he,uv:$,filter:B}:Be?{exposureEV:tt,offset:oe,operator:"linear",gamma:1,isScalar:!0,colormap:In(He),hdrOut:!1,peak:z.peak,srgbDecode:!1,...kt?{turbo:!0}:{},reduce:ge,channelCount:he,...Pe&&H?{normMin:H[0],normMax:H[1]}:{},uv:$,filter:B}:Bt?{exposureEV:tt,offset:oe,operator:"linear",gamma:1,isScalar:!0,grayNone:!0,grayEncodeGamma:ii(J,pe)??0,hdrOut:z.hdrOut,peak:z.peak,srgbDecode:!1,reduce:ge,channelCount:he,...Pe&&H?{normMin:H[0],normMax:H[1]}:{},uv:$,filter:B}:r||ft?{exposureEV:Qe+ne,offset:Je+re,operator:z.operator,gamma:z.gamma,isScalar:!1,hdrOut:z.hdrOut,peak:z.peak,srgbDecode:!r,uv:$,filter:B,...bn}:{exposureEV:0,offset:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,srgbDecode:!1,uv:$,filter:B,...bn};if(a)return!1;try{i.render({...na,compareIntended:a,authoredColormap:dn})||p(!0)}catch(te){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",te),p(!0)}return!0},[h,f,Ue,Ce.x,Ce.y,Qe,Je,ne,re,J,ue,pe,ft,r,We,He,ge,he,H,Pe,zt,u,Q,ke,ie,be,Re,Kt,ae,ye,o,b,S,a,y,r?null:t.imageUrl,n==null?void 0:n.b,dn]);R.current=Me;const ht=m.useMemo(()=>({}),[Me]);on.current!==le.contentKey&&(on.current=le.contentKey,an.current+=1),an.current;const vn=()=>{const i=rn.current;return!!i&&i.id===ht&&i.uv===O&&i.ct===_},wn=()=>{rn.current={id:ht,uv:O,ct:_}};m.useLayoutEffect(()=>{if(le.contentKey===Mt.current||!le.resident||vn())return;Mt.current=le.contentKey,Me()&&wn()},[ht,O,_,le.resident,le.contentKey]),m.useEffect(()=>{if(Mt.current=le.contentKey,vn())return;Me()&&wn()},[ht,O,_]),m.useEffect(()=>{var M;if(!a||!h||!Q){Lt(null);return}let i=!1;const l=(M=A.current)==null?void 0:M.computeMetrics(Re??void 0);return l==null||l.then(D=>{i||Lt(D)}).catch(()=>{i||Lt(null)}),()=>{i=!0}},[a,h,Q,O,ke,ce,Re]),m.useEffect(()=>{var M;if(!a||!h||!Q){lt(null);return}let i=!1;lt(null);const l=(M=A.current)==null?void 0:M.computeSsim({a:ae,b:ye},Re??void 0);return l==null||l.then(D=>{i||lt(D)}).catch(()=>{i||lt(null)}),()=>{i=!0}},[a,h,Q,O,ke,ae,ye,Re]),m.useEffect(()=>{var D,k;if(!u){Ye.current=null,je.current=null;return}const i=Te(ie);if((i==null?void 0:i.kind)!=="multipass"){Ye.current=null,je.current=null,Nt(N=>N+1);return}const l=$t.current;if(!h||!l)return;let M=!1;return Ye.current=null,je.current=null,Nt(N=>N+1),(k=(D=A.current)==null?void 0:D.readDiffResult(l))==null||k.then(N=>{M||(Ye.current=N,je.current={w:l.width,h:l.height},Nt(B=>B+1))}).catch(()=>{}),()=>{M=!0}},[u,h,ie,O,ke,Re]),m.useEffect(()=>{const i=P.current;if(!(!i||!a))return i.__cairnImageDiffProbe={canvas:x.current,requestRender:Me,get compareMode(){return u?"diff":b},get diffKernel(){return ce},get resolvedKernelId(){return ie},get colormap(){return be},get encodingId(){return rt("scalar",J,be)},get effectiveTonemap(){return J},get metrics(){return Ae},get ssimText(){return Xn(Ft)},get splitPosition(){return S},changeSplit:Ze,get dims(){return f},get srcDims(){return f?{a:f,b:Q??f}:null},get overlayWindow(){return X},overlayTexelCenter:(l,M,D)=>{const k=x.current;if(!k||!f)return null;const N=k.getBoundingClientRect(),B=l==="a"?f:Q??f,$=za(M,D,{box:N,naturalWidth:f.w,naturalHeight:f.h,sourceWindow:X},B);return{x:$.x-N.left,y:$.y-N.top}},readbackSurface:async()=>{const l=x.current;if(!l)return null;Me();const M=mo(l);return M?{data:await(await yt()).readback(M),width:l.width,height:l.height}:null},changeCompareMode:Xe,changeDiffKernel:dt,changeDiffColormap:qe,changeTonemap:l=>_e(l),changeColormap:qe,home:()=>{const l=typeof window<"u"&&!!window.__cairnDisableCompareHomeReset;n!=null&&n.onCompareReset?l||n.onCompareReset():Ke(ze.default),_t()}},()=>{i&&delete i.__cairnImageDiffProbe}},[a,u,b,Me,ce,ie,be,J,Ae,Ft,S,Ze,f,Q,X,Xe,dt,qe,_e,Ke,ze,F,n]),m.useEffect(()=>{const i=P.current;if(i)return i.__cairnImagePaneProbe={get encodingId(){return F.encodingId},get colormap(){return F.colormap},get controlledSurface(){return ut},get peak(){return ue},changePeak:Vt,changeEncoding:_e,home:()=>_t()},()=>{i&&delete i.__cairnImagePaneProbe}},[F.encodingId,F.colormap,ut,ue,Vt,_e,F]);const{samplePixel:xn,sampleDiffPixel:Yr,sampleForeground:En}=bo({hdrMode:r,naturalDims:f,sdrColormap:We,resolvedKernelId:ie,hdrDataRef:Y,sdrImageDataRef:V,refFloatRef:Ve,refU8Ref:Ie,diffSamplesRef:Ye,diffResultDimsRef:je}),jr=m.useMemo(()=>{var i;if(r){const l=Y.current;if(!l)return;const M=(i=t.hdr)==null?void 0:i.deep;return Ka(l,q,M?()=>M.getGpuCsr():void 0)}return Wa(V.current,q)},[r,q]),qr=m.useMemo(()=>{if(!a)return[];const i=Vi({mode:o?b:"diff",kernel:ce,kernelOptions:br().map(M=>({id:M.id,label:M.label})),onSplit:()=>Xe("split"),onKernel:M=>{o&&Xe("diff"),dt(M)}});if(o)return[i,Un({value:F.encodingId,ids:F.ids,onSelect:_e})];const l=Ha({lutValue:be,onSelectLut:M=>qe(M)});return[i,l]},[a,o,b,ce,be,J,F.encodingId,F.ids,_e,Xe,dt,qe]),et=a?di({mode:u?"diff":b,diffKernel:ce,referenceLabel:n==null?void 0:n.referenceLabel,foregroundLabel:n==null?void 0:n.foregroundLabel}):{left:void 0,right:void 0},Xr=et.right?"bottom-7":"bottom-1",Zr=a?j.jsxs(j.Fragment,{children:[b==="split"&&j.jsx(Ya,{}),et.left?j.jsx(kn,{label:et.left,corner:"bottom-left",attrs:{"data-cairn-compare-caption":"reference"}}):null,et.right?j.jsx(kn,{label:et.right,corner:"bottom-right",attrs:{"data-cairn-compare-caption":"foreground"}}):null,Ae&&j.jsxs("span",{className:`absolute right-1 z-30 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${Xr}`,"data-gpu-compare-metrics":!0,children:["MSE ",Ae.mse.toExponential(2)," · PSNR"," ",Number.isFinite(Ae.psnr)?Ae.psnr.toFixed(1):"∞"," dB · MAE ",Ae.mae.toExponential(2)," · SSIM ",Xn(Ft)]})]}):void 0,yn=t.showAxes??!1,Sn=r?t.label??"":t.label,Rn=t.interpolation??"auto",Qr=Rn==="auto"?void 0:Rn,pt=t.overlay,gt=t.overlaySettings,Jr=r?!1:t.isDraggable??!1,ea=r?void 0:t.onDragStart;if(v)return j.jsx(ja,{...e});const ta=pt&&(gt!=null&&gt.enabled)&&f&&((((Cn=pt.boxes)==null?void 0:Cn.length)??0)>0||(((Pn=pt.masks)==null?void 0:Pn.length)??0)>0)?j.jsx(qa,{data:pt,settings:gt,naturalWidth:f.w,naturalHeight:f.h}):void 0;return j.jsx(Xa,{paneAttrs:{"data-gpu-image-pane":"","data-gpu-backend-ready":h},viewportAttrs:{"data-gpu-image-viewport":""},toolbar:sn,paneRef:P,wrapperRef:T,zoom:Ue,pan:Ce,onViewportChange:Br,naturalDims:f,checkerboard:"wrapper",wrapperClassName:"relative w-full h-full flex items-center justify-center",viewportPadding:!o&&yn&&f?"16px 4px 4px 28px":0,surface:j.jsxs(j.Fragment,{children:[j.jsx("canvas",{ref:x,className:"w-full h-full block",style:{imageRendering:Qr},"data-gpu-image-canvas":!0,"data-gpu-compare-canvas":o?"":void 0}),b==="split"&&j.jsx(fi,{splitPosition:S,onChange:Ze,onReset:()=>Ze(.5)})]}),showAxes:yn&&!o,overlayNode:ta,overlay:o?{render:({notation:i,setOverlayActive:l})=>b==="split"?j.jsxs(j.Fragment,{children:[f&&j.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-S)*100}% 0 0)`},children:j.jsx(Ht,{imageElRef:x,naturalWidth:f.w,naturalHeight:f.h,zoom:Ue,pan:Ce,sourceWindow:X,sourceDims:f,sample:xn,notation:i,version:q})}),f&&Q&&j.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${S*100}%)`},children:j.jsx(Ht,{imageElRef:x,naturalWidth:f.w,naturalHeight:f.h,zoom:Ue,pan:Ce,sourceWindow:X,sourceDims:Q,sample:En,notation:i,version:ke+q,onActiveChange:l})})]}):f&&Q&&j.jsx(Ht,{imageElRef:x,naturalWidth:f.w,naturalHeight:f.h,zoom:Ue,pan:Ce,sourceWindow:X,sourceDims:Q,sample:En,notation:i,version:ke+q,onActiveChange:l})}:{displayElRef:x,sample:u?Yr:xn,version:u?$r:q,hasSource:!0,sourceWindow:X},notationSeed:t.pixelValueNotation??"decimal",exportCanvasRef:x,requestRender:Me,histogram:a?void 0:jr,infoPanelSetting:G==null?void 0:G.infoPanel,onInfoPanelChange:Hr,leadingMenus:a?[...t.channelMenu?[t.channelMenu]:[],...qr]:[...t.channelMenu?[t.channelMenu]:[],Un({value:F.encodingId,ids:F.ids,onSelect:_e})],rowSegments:[...!u&&F.hasParam("reduce")&&he>1?[ri(ge,Wr)]:[]],displayAdjust:u?{exposureEV:ne,offset:re,onExposureChange:pn,onOffsetChange:gn}:F.hasParam("exposure")&&!Pe?{exposureEV:ne,offset:re,onExposureChange:pn,onOffsetChange:gn}:void 0,extraSliders:u?[]:[...(r||ft)&&d&&kr&&!Bt?[{id:"peak",label:"PK",title:"Peak white (×SDR white) — the HDR ceiling P every operator clips at (Linear/sRGB/Gamma hard-clip at P; Reinhard/ACES roll off toward P). P=1 reproduces the SDR rendition exactly; double-click to type a value, including 'inf' for the raw browser-clipped extended look.",min:Ja,max:Qa,step:Za,value:ue,onChange:Vt,format:i=>Number.isFinite(i)?`${i.toFixed(1)}×`:"∞"}]:[],...(r||ft)&&F.hasParam("gamma")?[{id:"gamma",label:"γ",title:"Display gamma γ for the Gamma transfer — display = clamp(value)^(1/γ), tev-style. Default 2.2 (close to sRGB, not identical). Double-click to type a value.",min:ni,max:ti,step:ei,value:pe,onChange:Kr,format:i=>i.toFixed(1)}]:[],...Pe&&H?[{id:"colorMin",label:"min",title:"Colormap domain minimum — the data value that maps to the bottom of the ramp.",min:Se.lo-Se.span,max:Se.hi,step:Se.span/100,value:H[0],onChange:i=>mn([i,H[1]]),format:i=>i.toPrecision(3)},{id:"colorMax",label:"max",title:"Colormap domain maximum — the data value that maps to the top of the ramp.",min:Se.lo,max:Se.hi+Se.span,step:Se.span/100,value:H[1],onChange:i=>mn([H[0],i]),format:i=>i.toPrecision(3)}]:[]],depthSliders:C.sliders,regionSelect:y?{rect:C.region,queryLive:C.queryRegionWindow,commit:C.commitRegion,remove:C.removeRegion}:void 0,onReset:()=>{var i;_t();{const l=u?Dt??bt(ze.default):fe,M=u?rt("scalar",J,l):l!=="none"?l:At(st);W({encoding:M,peak:Gt,tonemapGamma:Ut,exposureEV:0,offset:0,reduce:kt?"mean":Ln(he),...me?{colorMin:me[0],colorMax:me[1]}:{colorMin:void 0,colorMax:void 0},infoPanel:void 0})}if(C.reset(),(i=t.onChannelReset)==null||i.call(t),a){const l=typeof window<"u"&&!!window.__cairnDisableCompareHomeReset;n!=null&&n.onCompareReset?l||n.onCompareReset():Ke(ze.default)}},extraModified:F.encodingModified||Lr||Fr||ge!==fn||Nr||C.isModified||!!t.channelModified||a&&!!(n!=null&&n.compareModified),label:a?"":Sn,showLabelChip:!a&&!!Sn,extraChips:Zr,isDraggable:Jr,onDragStart:ea})}const Mo="cairn-plot:gpu-image-ready";async function Do(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await yt(),window.__cairnPlotGpuImagePane=Ro,window.__cairnPlotDiffMenuModes=br(),window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(Mo))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e);const t={hasGpu:"gpu"in navigator,isSecureContext:window.isSecureContext!==!1};vr(hi(t)),pi(t)}}}Do();

var pa=Object.defineProperty;var ha=(e,t,r)=>t in e?pa(e,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):e[t]=r;var k=(e,t,r)=>ha(e,typeof t!="symbol"?t+"":t,r);import{ay as ga,az as ma,aA as On,aB as ba,aC as va,aD as Un,aE as wa,aF as xa,aG as Ea,aH as ya,aI as In,aJ as Sa,aK as Ln,aL as Ma,aM as Ta,aN as kn,aO as Ra,aP as Da,aQ as Pa,aR as Ca,aS as Ba,aT as Aa,aU as Fn,U as wr,aV as _a,aW as Ga,aX as Oe,aY as xr,aZ as Oa,a_ as Ua,a$ as Ia,b0 as Nn,b1 as La,b2 as ka,b3 as Fa,b4 as tn,b5 as Na,b6 as Er,b7 as yr,b8 as Sr,b9 as za,r as b,ba as xt,bb as Ve,bc as Wa,bd as $a,av as Ke,be as Va,bf as Ha,bg as Ka,u as Ya,bh as ja,bi as Et,bj as qa,bk as Xa,ap as Za,O as yt,bl as Qa,bm as Ja,bn as ct,bo as es,bp as ts,bq as ns,m as Mr,br as rs,bs as as,bt as ss,bu as is,bv as os,bw as cs,bx as zn,by as Wn,bz as us,bA as ls,bB as St,bC as ds,bD as fs,l as Tr,bE as $n,bF as ps,j as te,v as hs,L as Vn,C as gs,q as ms,bG as bs,bH as vs,bI as ws,bJ as xs,bK as Es,bL as ys,bM as Ss,bN as Hn,bO as Ms,P as Xt,bP as Ts,bQ as Rs,bR as Ds,bS as Ps,a4 as Cs,bT as Kn,bU as Ge,bV as Bs,bW as As,bX as _s}from"./parse-overlay-CzLIzumD.js";import{aU as Gs,aV as Os,aW as Us}from"./index-9h42-voN.js";import{r as Rr,n as Is,w as Ls}from"./capability-notice-jIjs9CwC.js";import"./parse-npz-Cgvrq463.js";const nn=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function Dr(e,t){const r=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:r,alphaMode:"premultiplied",usage:nn}),{hdr:!1,format:r}}function ks(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:nn}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:nn}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return Dr(e,t)}}}const Rt=256,rn=new Map,an=new Map;function Pr(e){if(rn.has(e.id))throw new Error(`registerReduceOp: duplicate op id "${e.id}"`);rn.set(e.id,e)}function Cr(e){if(an.has(e.id))throw new Error(`registerReduceProgram: duplicate program id "${e.id}"`);an.set(e.id,e)}function Yn(e){return rn.get(e)}function jn(e){return an.get(e)}Pr({id:"sum",wgslIdentity:"0.0",wgslCombine:(e,t)=>`${e} + ${t}`,cpuIdentity:0,cpuCombine:(e,t)=>e+t,finalize:e=>e});Pr({id:"mean",wgslIdentity:"0.0",wgslCombine:(e,t)=>`${e} + ${t}`,cpuIdentity:0,cpuCombine:(e,t)=>e+t,finalize:(e,t)=>t>0?e/t:NaN});Cr({id:"channel",textureArity:1,lanes:1,perPixelWGSL:`
    let texel = textureLoad(t0, vec2<i32>(x, y), 0);
    vals[0] = texel[dims.channel];
  `,cpu:(e,t,r,n)=>[e(0,t,r)[n.channel??0]??0]});Cr({id:"diffSqAbs",textureArity:2,lanes:2,perPixelWGSL:`
    let a = textureLoad(t0, vec2<i32>(x, y), 0);
    let b = textureLoad(t1, vec2<i32>(x, y), 0);
    let d = a.rgb - b.rgb;
    vals[0] = dot(d, d);
    vals[1] = abs(d.x) + abs(d.y) + abs(d.z);
  `,cpu:(e,t,r)=>{const n=e(0,t,r),a=e(1,t,r),o=(n[0]??0)-(a[0]??0),s=(n[1]??0)-(a[1]??0),c=(n[2]??0)-(a[2]??0);return[o*o+s*s+c*c,Math.abs(o)+Math.abs(s)+Math.abs(c)]}});function Fs(e,t){const r=e.textureArity,n=e.lanes,a=r,o=r+1,s=["@group(0) @binding(0) var t0: texture_2d<f32>;"];r===2&&s.push("@group(0) @binding(1) var t1: texture_2d<f32>;");const c=[],v=[],y=[],x=[],A=[];for(let B=0;B<n;B++)c.push(`var<workgroup> shared${B}: array<f32, ${Rt}>;`),A.push(`  vals[${B}] = ${t.wgslIdentity};`),v.push(`  shared${B}[lid.x] = vals[${B}];`),y.push(`      shared${B}[lid.x] = ${t.wgslCombine(`shared${B}[lid.x]`,`shared${B}[lid.x + stride]`)};`),x.push(`    partial[wgid.x * ${n}u + ${B}u] = shared${B}[0];`);return`
const WORKGROUP_SIZE: u32 = ${Rt}u;

${s.join(`
`)}
@group(0) @binding(${a}) var<storage, read_write> partial: array<f32>;

struct Dims {
  width: u32,
  height: u32,
  count: u32,
  channel: u32,
};
@group(0) @binding(${o}) var<uniform> dims: Dims;

${c.join(`
`)}

@compute @workgroup_size(${Rt})
fn cs_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>,
) {
  let idx = gid.x;
  var vals: array<f32, ${n}>;
${A.join(`
`)}
  if (idx < dims.count) {
    let x = i32(idx % dims.width);
    let y = i32(idx / dims.width);
${e.perPixelWGSL}
  }
${v.join(`
`)}
  workgroupBarrier();

  var stride = WORKGROUP_SIZE / 2u;
  loop {
    if (stride == 0u) {
      break;
    }
    if (lid.x < stride) {
${y.join(`
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
`}function Ns(e,t,r,n,a){const o=new Array(r).fill(n.cpuIdentity);for(let s=0;s<t;s++)for(let c=0;c<r;c++)o[c]=n.cpuCombine(o[c],e[s*r+c]??n.cpuIdentity);return o.map(s=>n.finalize(s,a))}const zs=`
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
`;class Ws extends Error{constructor(r){super(r);k(this,"deviceLost",!0);this.name="DeviceLostError"}}async function Zt(e,t){try{await e.mapAsync(GPUMapMode.READ)}catch(r){if((r instanceof Error?r.name:"")==="AbortError"){const a=t.info;throw new Ws("webgpu readback: buffer map aborted — device lost or destroyed mid-readback"+(a?` (reason=${String(a.reason)}${a.message?`: ${a.message}`:""})`:"")+`: ${r instanceof Error?r.message:String(r)}`)}throw r instanceof Error?r:new Error(String(r))}}function sn(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Br(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function $s(e){const t=(e&32768)>>15,r=(e&31744)>>10,n=e&1023;let a;return r===0?a=n/1024*Math.pow(2,-14):r===31?a=n?NaN:1/0:a=(1+n/1024)*Math.pow(2,r-15),t?-a:a}const Vs={texture:0,sampler:1,uniform:2};function Qt(e,t){return e*3+Vs[t]}const Hs={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Ks(e){const t=new Map,r=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let n;for(;(n=r.exec(e))!==null;){const a=Number(n[1]),o=n[2]!==void 0,s=n[3].trim();if(o){const c=Hs[s];if(c===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${s}" (binding ${a}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(a,{kind:"uniform",sizeBytes:c})}else s==="sampler"||s==="sampler_comparison"?t.set(a,{kind:"sampler"}):t.set(a,{kind:"texture"})}return t}class qn{constructor(t,r,n,a){k(this,"width");k(this,"height");k(this,"format");k(this,"gpuTexture");k(this,"device");k(this,"destroyed",!1);this.device=t,this.width=r,this.height=n,this.format=a,this.gpuTexture=t.createTexture({size:{width:r,height:n,depthOrArrayLayers:1},format:sn(a),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const r=this.width*Br(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:r,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class Xn{constructor(t){k(this,"_s");k(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Ys{constructor(t,r,n,a,o){k(this,"_p");k(this,"gpuPipeline");k(this,"bindings");k(this,"bindGroupLayout");k(this,"variants");k(this,"buildVariant");this.gpuPipeline=t,this.bindings=r,this.bindGroupLayout=n,this.buildVariant=o,this.variants=new Map([[a,t]]),this._p=t}pipelineFor(t){let r=this.variants.get(t);return r||(r=this.buildVariant(t),this.variants.set(t,r)),r}}function js(e,t){const r=[];for(const[n,a]of t)a.kind==="uniform"?r.push({binding:n,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):a.kind==="sampler"?r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):r.push({binding:n,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:r})}class qs{constructor(t){k(this,"_c");k(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class Xs{constructor(t,r,n,a,o,s){k(this,"width");k(this,"height");k(this,"paramsBuffer");k(this,"bindGroup");k(this,"colorsBuffer");k(this,"zsBuffer");k(this,"sampleCount");k(this,"buffers");k(this,"destroyed",!1);this.width=t,this.height=r,this.buffers=n,this.colorsBuffer=n[1],this.zsBuffer=n[2],this.sampleCount=s,this.paramsBuffer=a,this.bindGroup=o}destroy(){if(!this.destroyed){for(const t of this.buffers)t.destroy();this.paramsBuffer.destroy(),this.destroyed=!0}}}class Zs{constructor(t,r){k(this,"_b");k(this,"gpuBindGroup");k(this,"ownedBuffers");k(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=r,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class Qs{constructor(t,r,n,a){k(this,"canvas");k(this,"hdr");k(this,"format");k(this,"context");k(this,"reconfigure");this.canvas=t,this.context=r,this.hdr=n.hdr,this.format=n.format,this.reconfigure=a}configure(t,r){this.canvas.width=t,this.canvas.height=r;const n=this.reconfigure();this.hdr=n.hdr,this.format=n.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function Mt(e){return"canvas"in e}async function Js(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),r={hdr:!0,compute:!0,float16:!0};let n=null;function a(){return n||(n=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),n}function o(l){return Mt(l)?l.getCurrentTextureView():l.gpuTexture.createView()}function s(l){if(Mt(l))return{width:l.canvas.width,height:l.canvas.height};const p=l;return{width:p.width,height:p.height}}let c=!1;const v={};t.lost.then(l=>{v.info=l,ga("webgpu-device-lost",{reason:l.reason,message:l.message})},()=>{});let y=null;function x(){var p,d;if(y!==null)return y;let l=!1;try{if(typeof document<"u"){const f=document.createElement("canvas");f.width=1,f.height=1;const u=f.getContext("webgpu");if(u)try{u.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:GPUTextureUsage.RENDER_ATTACHMENT});const m=(p=u.getConfiguration)==null?void 0:p.call(u);l=((d=m==null?void 0:m.toneMapping)==null?void 0:d.mode)==="extended"}catch{l=!1}finally{try{u.unconfigure()}catch{}}}}catch{l=!1}return y=l,l}const A=new Map;function B(l,p){const d=`${l.id}:${p.id}`;let f=A.get(d);if(!f){const u=t.createShaderModule({code:Fs(l,p)}),m=l.textureArity,w=[];for(let F=0;F<m;F++)w.push({binding:F,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}});w.push({binding:m,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}),w.push({binding:m+1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}});const R=t.createBindGroupLayout({entries:w}),g=t.createPipelineLayout({bindGroupLayouts:[R]});f={pipeline:t.createComputePipeline({layout:g,compute:{module:u,entryPoint:"cs_main"}}),layout:R},A.set(d,f)}return f}async function _(l,p,d,f,u,m){const w=l.lanes,R=Math.max(0,f*u),g=Math.max(1,Math.ceil(R/Rt)),{pipeline:O,layout:F}=B(l,p),q=g*w*4,X=t.createBuffer({size:q,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),Q=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(Q,0,new Uint32Array([Math.max(1,f),Math.max(1,u),R,m>>>0]));const J=d.map((se,ve)=>({binding:ve,resource:se.gpuTexture.createView()}));J.push({binding:l.textureArity,resource:{buffer:X}}),J.push({binding:l.textureArity+1,resource:{buffer:Q}});const K=t.createBindGroup({layout:F,entries:J}),W=t.createBuffer({size:q,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),ee=t.createCommandEncoder(),Z=ee.beginComputePass();Z.setPipeline(O),Z.setBindGroup(0,K),Z.dispatchWorkgroups(g),Z.end(),ee.copyBufferToBuffer(X,0,W,0,q),t.queue.submit([ee.finish()]);try{await Zt(W,v)}catch(se){for(const ve of[W,X,Q])try{ve.destroy()}catch{}throw se}const le=new Float32Array(W.getMappedRange()).slice();return W.unmap(),W.destroy(),X.destroy(),Q.destroy(),Ns(le,g,w,p,R)}let S=null,E=null;function $(){if(!S||!E){const l=t.createShaderModule({code:zs});E=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const p=t.createPipelineLayout({bindGroupLayouts:[E]});S=t.createRenderPipeline({layout:p,vertex:{module:l,entryPoint:"vs_main"},fragment:{module:l,entryPoint:"fs_main",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}})}return{pipeline:S,layout:E}}const P=new Map;function D(l,p,d){let f=P.get(l);if(!f){const u=t.createShaderModule({code:p()}),m=d.map((g,O)=>g==="texture"?{binding:O,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}}:{binding:O,visibility:GPUShaderStage.COMPUTE,buffer:{type:g}}),w=t.createBindGroupLayout({entries:m});f={pipeline:t.createComputePipeline({layout:t.createPipelineLayout({bindGroupLayouts:[w]}),compute:{module:u,entryPoint:"cs_main"}}),layout:w},P.set(l,f)}return f}async function C(l,p,d,f,u){const m=t.createBuffer({size:u,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),w=t.createCommandEncoder(),R=w.beginComputePass();R.setPipeline(l),R.setBindGroup(0,p),R.dispatchWorkgroups(d),R.end(),w.copyBufferToBuffer(f,0,m,0,u),t.queue.submit([w.finish()]);try{await Zt(m,v)}catch(O){try{m.destroy()}catch{}throw O}const g=m.getMappedRange().slice(0);return m.unmap(),m.destroy(),g}return{backend:"webgpu",capabilities:r,probeExtendedToneMapping:x,createTexture(l,p,d){return new qn(t,l,p,d)},createSampler(l){const p=(l==null?void 0:l.filter)==="linear"?"linear":"nearest",d=t.createSampler({magFilter:p,minFilter:p,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new Xn(d)},createRenderPipeline(l){const p=t.createShaderModule({code:l.shaderWGSL}),d=Ks(l.shaderWGSL),f=sn(l.targetFormat),u=js(t,d),m=t.createPipelineLayout({bindGroupLayouts:[u]}),w=g=>t.createRenderPipeline({layout:m,vertex:{module:p,entryPoint:"vs_main"},fragment:{module:p,entryPoint:"fs_main",targets:[{format:g}]},primitive:{topology:"triangle-list"}}),R=w(f);return new Ys(R,d,u,f,w)},createComputePipeline(l){const p=t.createShaderModule({code:l.shaderWGSL}),d=t.createComputePipeline({layout:"auto",compute:{module:p,entryPoint:"cs_main"}});return new qs(d)},createBindGroup(l,p){const d=l,f=new Map,u=[];for(const[w,R]of d.bindings)if(R.kind==="uniform"){const g=t.createBuffer({size:R.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});u.push(g),f.set(w,{binding:w,resource:{buffer:g}})}else R.kind==="sampler"&&f.set(w,{binding:w,resource:a()});for(const w of p){const R=w.resource;if(R instanceof qn){const g=Qt(w.binding,"texture");d.bindings.has(g)&&f.set(g,{binding:g,resource:R.gpuTexture.createView()})}else if(R instanceof Xn){const g=Qt(w.binding,"sampler");d.bindings.has(g)&&f.set(g,{binding:g,resource:R.gpuSampler})}else{const g=Qt(w.binding,"uniform"),O=d.bindings.get(g);if(O&&O.kind==="uniform"){const F=R.uniform,q=t.createBuffer({size:Math.max(O.sizeBytes,F.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(q,0,F.buffer,F.byteOffset,F.byteLength),u.push(q),f.set(g,{binding:g,resource:{buffer:q}})}}}const m=t.createBindGroup({layout:d.bindGroupLayout,entries:Array.from(f.values())});return new Zs(m,u)},createSurface(l,p){const d=l.getContext("webgpu");if(!d)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const f=p.hdr&&r.hdr,u=()=>f?ks(d,t):Dr(d,t),m=u();return new Qs(l,d,m,u)},renderFullscreen(l,p,d){const f=p,u=d,m=o(l),{width:w,height:R}=s(l),g=Mt(l)?l.format:sn(l.format),O=f.pipelineFor(g),F=t.createCommandEncoder(),q=F.beginRenderPass({colorAttachments:[{view:m,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});q.setPipeline(O),q.setBindGroup(0,u.gpuBindGroup),q.setViewport(0,0,w,R,0,1),q.draw(3),q.end(),t.queue.submit([F.finish()])},createDeepSampleBuffers(l){const{layout:p}=$(),d=g=>{const O=t.createBuffer({size:g.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(O,0,g.buffer,g.byteOffset,g.byteLength),O},f=d(l.offsets),u=d(l.colors),m=d(l.zs),w=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),R=t.createBindGroup({layout:p,entries:[{binding:0,resource:{buffer:f}},{binding:1,resource:{buffer:u}},{binding:2,resource:{buffer:m}},{binding:3,resource:{buffer:w}}]});return new Xs(l.width,l.height,[f,u,m],w,R,l.zs.length)},compositeDeep(l,p,d,f){const u=l,m=p,{pipeline:w}=$();t.queue.writeBuffer(u.paramsBuffer,0,new Float32Array([u.width,u.height,f,d]));const R=t.createCommandEncoder(),g=R.beginRenderPass({colorAttachments:[{view:m.gpuTexture.createView(),loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});g.setPipeline(w),g.setBindGroup(0,u.bindGroup),g.setViewport(0,0,m.width,m.height,0,1),g.draw(3),g.end(),t.queue.submit([R.finish()])},async readback(l){const p=Mt(l),{width:d,height:f}=s(l),u=p?l.hdr?"rgba16float":"rgba8unorm":l.format,m=p&&l.format==="bgra8unorm",w=p?l.getCurrentGPUTexture():l.gpuTexture,R=Br(u),g=d*R,O=256,F=Math.ceil(g/O)*O,q=F*f,X=t.createBuffer({size:q,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),Q=t.createCommandEncoder();Q.copyTextureToBuffer({texture:w},{buffer:X,bytesPerRow:F,rowsPerImage:f},{width:d,height:f,depthOrArrayLayers:1}),t.queue.submit([Q.finish()]);try{await Zt(X,v)}catch(W){try{X.destroy()}catch{}throw W}const J=new Uint8Array(X.getMappedRange()),K=new Uint8Array(g*f);for(let W=0;W<f;W++){const ee=W*F,Z=W*g;K.set(J.subarray(ee,ee+g),Z)}if(X.unmap(),X.destroy(),u==="rgba8unorm"){if(m)for(let W=0;W<K.length;W+=4){const ee=K[W],Z=K[W+2];K[W]=Z,K[W+2]=ee}return K}if(u==="rgba16float"){const W=new Uint16Array(K.buffer,K.byteOffset,K.byteLength/2),ee=new Float32Array(W.length);for(let Z=0;Z<W.length;Z++)ee[Z]=$s(W[Z]);return ee}return new Float32Array(K.buffer,K.byteOffset,K.byteLength/4)},async reduceDiffSumSquaredAbs(l,p,d,f){const u=jn("diffSqAbs"),m=Yn("sum"),[w,R]=await _(u,m,[l,p],d,f,0);return{sumSq:w,sumAbs:R}},async reduceTextureChannelMean(l,p,d,f){const u=jn("channel"),m=Yn("mean"),[w]=await _(u,m,[l],d,f,p);return w},async computeTevTextureHistogram(l,p,d,f){const u=l,m=Math.max(0,Math.floor(p)*Math.floor(d)),w=Math.max(1,Math.floor(f.bins)),R=Math.min(Ea,Math.max(0,f.seriesCount)),g=Math.min(ya,Math.max(0,f.channelCount)),O=new Uint32Array(R*w);if(m<=0)return{channelStats:In([],0).channelStats.slice(0,g),range:null,counts:O};const F=t.createBuffer({size:Sa,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),q={width:Math.floor(p),height:Math.floor(d),channelCount:g,seriesCount:R,u8Scale:f.u8Scale,bins:w,seriesWeights:f.seriesWeights};t.queue.writeBuffer(F,0,Ln(q));const X=Math.max(1,Math.ceil(m/Da)),Q=X*Ra*4,J=t.createBuffer({size:Q,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),K=t.createBuffer({size:Math.max(4,O.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});try{const W=D("hist:stats",Ma,["texture","storage","uniform"]),ee=t.createBindGroup({layout:W.layout,entries:[{binding:0,resource:u.gpuTexture.createView()},{binding:1,resource:{buffer:J}},{binding:2,resource:{buffer:F}}]}),Z=new Float32Array(await C(W.pipeline,ee,X,J,Q)),re=In(Z,X);if(re.range&&R>0){const le=Un(re.range.min,re.range.max,w),se=le.diffLog<1e-6?1:le.diffLog;t.queue.writeBuffer(F,0,Ln({...q,minLog:le.minLog,diffLog:se}));const ve=D("hist:bin",Ta,["texture","storage","uniform"]),ut=t.createBindGroup({layout:ve.layout,entries:[{binding:0,resource:u.gpuTexture.createView()},{binding:1,resource:{buffer:K}},{binding:2,resource:{buffer:F}}]}),lt=Math.max(1,Math.ceil(m/kn));O.set(new Uint32Array(await C(ve.pipeline,ut,lt,K,O.byteLength)))}return{channelStats:re.channelStats.slice(0,g),range:re.range,counts:O}}finally{for(const W of[J,K,F])try{W.destroy()}catch{}}},async computeDeepDepthHistogram(l,p){const d=l,f=d.sampleCount,u=Math.max(1,Math.floor(p));if(f<=0)return null;const m=t.createBuffer({size:ma,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(m,0,On({count:f,bins:u}));const w=Math.max(1,Math.ceil(f/kn)),R=w*2*4,g=t.createBuffer({size:R,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),O=t.createBuffer({size:u*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});try{const F=D("hist:deep-stats",ba,["read-only-storage","storage","uniform"]),q=t.createBindGroup({layout:F.layout,entries:[{binding:0,resource:{buffer:d.zsBuffer}},{binding:1,resource:{buffer:g}},{binding:2,resource:{buffer:m}}]}),X=new Float32Array(await C(F.pipeline,q,w,g,R)),Q=va(X,w);if(!Q)return null;const J=Un(Q.zMin,Q.zMax,u),K=J.diffLog<1e-6?1:J.diffLog;t.queue.writeBuffer(m,0,On({count:f,bins:u,minLog:J.minLog,diffLog:K}));const W=D("hist:deep-bin",wa,["read-only-storage","read-only-storage","storage","uniform"]),ee=t.createBindGroup({layout:W.layout,entries:[{binding:0,resource:{buffer:d.zsBuffer}},{binding:1,resource:{buffer:d.colorsBuffer}},{binding:2,resource:{buffer:O}},{binding:3,resource:{buffer:m}}]}),Z=new Uint32Array(await C(W.pipeline,ee,w,O,u*4)),re=new Float64Array(u);let le=0;for(let se=0;se<u;se++)re[se]=Z[se]/xa,le+=re[se];return{zMin:Q.zMin,zMax:Q.zMax,weights:re,totalWeight:le}}finally{for(const F of[g,O,m])try{F.destroy()}catch{}}},destroy(){c||(t.destroy(),c=!0)},isContextLost(){return!1}}}let Jt=null;async function ei(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return Js()}function Dt(){return Jt||(Jt=ei()),Jt}function ti(e){switch(e){case"center":return{v:"center",h:"center"};case"top-right":return{v:"top",h:"right"};case"bottom-left":return{v:"bottom",h:"left"};case"bottom-right":return{v:"bottom",h:"right"};case"top-left":default:return{v:"top",h:"left"}}}function Zn(e,t,r){const{v:n,h:a}=ti(r),o=e.w-t.w,s=e.h-t.h,c=a==="left"?0:a==="right"?o:Math.floor(o/2),v=n==="top"?0:n==="bottom"?s:Math.floor(s/2);return{x:c,y:v}}function Ye(e,t,r,n,a="b"){if(n==="fill"){const s=a==="a"?{w:e.w,h:e.h}:{w:t.w,h:t.h};return{fit:n,result:s,offsetA:{x:0,y:0},offsetB:{x:0,y:0}}}const o={w:Math.min(e.w,t.w),h:Math.min(e.h,t.h)};return{fit:n,result:o,offsetA:Zn(e,o,r),offsetB:Zn(t,o,r)}}function Ar(e){return`${e.fit}:${e.result.w}x${e.result.h}:${e.offsetA.x},${e.offsetA.y}:${e.offsetB.x},${e.offsetB.y}`}const Qn=.6*.6*2.51,ni=.6*.03,ri=0,Jn=.6*.6*2.43,ai=.6*.59,si=.14;function er(e){const t=(ni-ai*e)/(Qn-Jn*e),r=(ri-si*e)/(Qn-Jn*e);return-.5*t+Math.sqrt((.5*t)**2-r)}const ii=.85,oi=.85,tr=11920928955078125e-23,en=[.2126,.7152,.0722];function ci(e,t,r){const n=t*r;if(r===1){const a=e[n];return[a,a,a]}return[e[n],e[n+1],e[n+2]]}function ui(e,t,r,n=3,a={}){const o=t*r,s=er(ii),c=er(oi),v=new Float64Array(o);let y=0;for(let D=0;D<o;D++){const[C,z,l]=ci(e,D,n),p=C*en[0]+z*en[1]+l*en[2];v[D]=p,p>y&&(y=p)}const x=Float64Array.from(v).sort(),A=o>>1,B=o%2===1?x[A]:x[A-1],_=Math.max(B,tr),S=Math.max(y,tr),E=a.startExposure??Math.log2(s/S),$=a.stopExposure??Math.log2(c/_),P=Math.max(2,Math.ceil($-E));return{startExposure:E,stopExposure:$,numExposures:P}}function li(e,t,r){const n=t*r;if(n<=0)return NaN;let a=0;for(let o=0;o<n;o++)a+=e[o*4]??0;return 1-a/n}function nr(e){return e==null||Number.isNaN(e)?"—":e.toFixed(4)}function di({mode:e,kernel:t,kernelOptions:r,onSplit:n,onKernel:a}){return{id:"compare-mode",title:"Compare / diff mode",menu:{options:[{id:"split",label:"Split"},...r],value:e==="split"?"split":t,onSelect:c=>{c==="split"?n():a(c)}}}}const fi=`
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
${Pa}

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
${Ca}

// The curve helper fns (reinhardCurve/acesCurve/extended*Curve) + the
// operatorId-dispatched applyOperator are ASSEMBLED from the display-encoding
// registry (image/encodings) — the single source of truth shared with the CPU
// twins (image/tonemap.ts) and the compose path (kernels/prelude.wgsl.ts). Ids:
// 0=linear, 1=srgb, 2=reinhard, 3=aces, 4=extended, 5=extended-reinhard,
// 6=extended-aces, 7=extended-clamp, 8=gamma, 9=normal (remaps:true → the
// single-image path includes the normal remap; compose passes remaps:false).
// linear/srgb/gamma are the default clamp (no explicit branch); the display
// transfer lives in outputEncodeF, selected per operator by the gamma uniform.
${Ba({remaps:!0})}

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
${Aa()}

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
`,rr=new WeakMap;function pi(e,t){let r=rr.get(e);r||(r=new Map,rr.set(e,r));let n=r.get(t);return n||(n=e.createRenderPipeline({shaderWGSL:fi,targetFormat:t}),r.set(t,n)),n}function hi(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function ar(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const n=e.createTexture(256,1,"rgba32float");return n.write(t),n}const r=e.createTexture(1,1,"rgba32float");return r.write(new Float32Array([0,0,0,1])),r}function on(e,t,r,n){var O;const a=hi(t),o=pi(e,a),s=ar(e,n.isScalar?n.colormap:void 0),c=typeof n.gamma=="number"&&n.gamma>0?n.gamma:0,v=Fn[n.operator]??Fn.srgb,y=new Float32Array([n.exposureEV,v,c,n.isScalar?1:0]),x=new Float32Array([n.uv.x,n.uv.y,n.uv.w,n.uv.h]),A=new Float32Array([n.hdrOut?1:0]),B=new Float32Array([n.filter==="nearest"?0:1]),_=new Float32Array([n.offset??0]),S=new Float32Array([n.peak??wr]),E=new Float32Array([n.srgbDecode?1:0]),$=_a[n.norm??"linear"]??0,P=typeof n.normMin=="number"&&Number.isFinite(n.normMin)&&typeof n.normMax=="number"&&Number.isFinite(n.normMax),D=new Float32Array([$,P?n.normMin:0,P?n.normMax:0,P?1:0]),C=Ga[n.reduce??"mean"]??0,z=typeof n.channelCount=="number"?n.channelCount:1,l=n.analytic?1:n.grayNone?2:n.turbo?3:0,p=typeof n.grayEncodeGamma=="number"&&n.grayEncodeGamma>0?n.grayEncodeGamma:0,d=new Float32Array([C,z,l,p]),f=new Float32Array([n.contentOpId??0]),u=new Float32Array([n.contentParam??0,0,0,0]),m=new Float32Array([n.brightness??0,n.contrast??0,n.flipSign?1:0,0]),w=n.srcB?void 0:ar(e,void 0),R=n.srcB??w;let g;try{g=e.createBindGroup(o,[{binding:0,resource:r},{binding:1,resource:s},{binding:2,resource:{uniform:y}},{binding:3,resource:{uniform:x}},{binding:4,resource:{uniform:A}},{binding:5,resource:{uniform:B}},{binding:6,resource:{uniform:_}},{binding:7,resource:{uniform:S}},{binding:8,resource:{uniform:E}},{binding:9,resource:{uniform:D}},{binding:10,resource:{uniform:d}},{binding:11,resource:R},{binding:12,resource:{uniform:f}},{binding:13,resource:{uniform:u}},{binding:14,resource:{uniform:m}}]),e.renderFullscreen(t,o,g)}finally{(O=g==null?void 0:g.destroy)==null||O.call(g),s.destroy(),w==null||w.destroy()}}function sr(e,t,r){if(r<=0)return{mse:0,psnr:1/0,mae:0};const n=e/r,a=t/r,o=n<=0?1/0:10*Math.log10(1/n);return{mse:n,psnr:o,mae:a}}async function gi(e,t,r,n){const a=n??Ye({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),o=a.result.w,s=a.result.h,c=o*s*3;if(c<=0)return{mse:0,psnr:1/0,mae:0};if(a.fit==="crop"&&a.offsetA.x===0&&a.offsetA.y===0&&a.offsetB.x===0&&a.offsetB.y===0&&e.reduceDiffSumSquaredAbs){const{sumSq:C,sumAbs:z}=await e.reduceDiffSumSquaredAbs(t,r,o,s);return sr(C,z,c)}const y=await e.readback(t),x=await e.readback(r),A=y instanceof Uint8Array?255:1,B=x instanceof Uint8Array?255:1,_=Pt(y,t.width,t.height,A,a.offsetA,a.fit==="fill",o,s),S=Pt(x,r.width,r.height,B,a.offsetB,a.fit==="fill",o,s);let E=0,$=0;const P=[0,0,0],D=[0,0,0];for(let C=0;C<s;C++)for(let z=0;z<o;z++){_(z,C,P),S(z,C,D);for(let l=0;l<3;l++){const p=P[l]-D[l];E+=p*p,$+=Math.abs(p)}}return sr(E,$,c)}function Pt(e,t,r,n,a,o,s,c){const v=(A,B,_)=>e[(B*t+A)*4+_]??0;if(!o)return(A,B,_)=>{const S=Math.min(Math.max(A+a.x,0),t-1),E=Math.min(Math.max(B+a.y,0),r-1);_[0]=v(S,E,0)/n,_[1]=v(S,E,1)/n,_[2]=v(S,E,2)/n};const y=t-1,x=r-1;return(A,B,_)=>{const S=(A+.5)/s,E=(B+.5)/c,$=S*t-.5,P=E*r-.5,D=Math.floor($),C=Math.floor(P),z=$-D,l=P-C,p=Math.min(Math.max(D,0),y),d=Math.min(Math.max(D+1,0),y),f=Math.min(Math.max(C,0),x),u=Math.min(Math.max(C+1,0),x);for(let m=0;m<3;m++){const w=v(p,f,m),R=v(d,f,m),g=v(p,u,m),O=v(d,u,m),F=w+(R-w)*z,q=g+(O-g)*z;_[m]=(F+(q-F)*l)/n}}}const mi=128,bi=512*1024*1024;class vi{constructor(t=mi,r=bi){k(this,"map",new Map);k(this,"totalBytes",0);k(this,"maxEntries");k(this,"maxBytes");this.maxEntries=t,this.maxBytes=r}get(t){const r=this.map.get(t);return r&&(this.map.delete(t),this.map.set(t,r)),r}has(t){return this.map.has(t)}set(t,r){const n=this.map.get(t);n&&(this.totalBytes-=n.bytes,n.texture.destroy(),this.map.delete(t)),this.map.set(t,r),this.totalBytes+=r.bytes,this.evict()}accountReadbackBytes(t,r){let n=!1;for(const a of this.map.values())if(a===t){n=!0;break}n&&(t.bytes+=r,this.totalBytes+=r,this.evict())}evict(){for(;this.map.size>this.maxEntries||this.totalBytes>this.maxBytes;){const t=this.map.keys().next().value;if(t===void 0)break;const r=this.map.get(t);if(this.map.size===1)break;this.map.delete(t),this.totalBytes-=r.bytes,r.texture.destroy()}}clear(){for(const t of this.map.values())t.texture.destroy();this.map.clear(),this.totalBytes=0}get size(){return this.map.size}}const ir=new WeakMap;function cn(e){let t=ir.get(e);return t||(t=new vi,ir.set(e,t)),t}const or=new WeakMap;function wi(e,t,r){let n=or.get(e);n||(n=new Map,or.set(e,n));const a=n.get(t);if(a)return a;const o=r().catch(s=>{throw n.get(t)===o&&n.delete(t),s});return n.set(t,o),o}const cr=new WeakMap;function ur(e,t,r,n){let a=cr.get(e);a||(a=new Map,cr.set(e,a));const o=`${t}::${n}`;let s=a.get(o);return s||(s=e.createRenderPipeline({shaderWGSL:r,targetFormat:n}),a.set(o,s)),s}function xi(e){return`
${Oa}
${Ua}
${Ia}
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
`}const Tt="rgba16float";function Ei(e,t,r,n,a,o){var $,P;const s=Oe(n);if(!s)throw new Error(`computeDiff: unknown diff kernel "${n}"`);const c=o??Ye({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),v=c.result.w,y=c.result.h,x=c.fit==="fill"?1:0,A=xr(s,a);if(s.kind==="pointwise"){const D=e.createTexture(v,y,Tt),C=ur(e,`pw:${s.id}`,xi(s.source),Tt),z=new Float32Array([c.offsetA.x,c.offsetA.y,c.offsetB.x,c.offsetB.y]),l=new Float32Array([v,y,x,0]);let p;try{p=e.createBindGroup(C,[{binding:0,resource:t},{binding:1,resource:r},{binding:2,resource:{uniform:z}},{binding:3,resource:{uniform:l}}]),e.renderFullscreen(D,C,p)}finally{($=p==null?void 0:p.destroy)==null||$.call(p)}return D}const B={width:v,height:y,params:A,sourceMap:{fill:c.fit==="fill",offsetA:c.offsetA,offsetB:c.offsetB}},_=s.buildPasses(B),S=new Map([["srcA",t],["srcB",r]]),E=[];try{for(const C of _.passes){const z=e.createTexture(v,y,Tt);E.push(z),S.set(C.output,z);const l=ur(e,`mp:${s.id}:${C.name}`,C.shader,Tt),p=C.inputs.map((f,u)=>{const m=S.get(f);if(!m)throw new Error(`computeDiff: pass "${C.name}" input "${f}" not produced yet`);return{binding:u,resource:m}});C.uniforms&&p.push(...C.uniforms(B));let d;try{d=e.createBindGroup(l,p),e.renderFullscreen(z,l,d)}finally{(P=d==null?void 0:d.destroy)==null||P.call(d)}}const D=S.get(_.final);if(!D)throw new Error(`computeDiff: final ref "${_.final}" not produced`);for(const C of E)C!==D&&C.destroy();return D}catch(D){for(const C of E)C.destroy();throw D}}function yi(e,t){const r=xr(e,t);return Object.keys(r).sort().map(a=>`${a}=${r[a]}`).join(",")}function _r(e,t,r,n,a){const o=Oe(r),s=o?yi(o,n):"",c=a?Ar(a):"";return`${e}|${t}|${r}|${s}|${c}`}function lr(e,t,r,n,a,o,s,c){const v=c??Ye({w:t.w,h:t.h},{w:r.w,h:r.h},"top-left","crop","b"),y=_r(o,s,n,a,v);return cn(e).has(y)}function Gr(e,t,r,n,a,o,s,c){const v=Oe(n);if(!v)throw new Error(`ensureDiff: unknown diff kernel "${n}"`);const y=cn(e),x=c??Ye({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),A=_r(o,s,n,a,x),B=y.get(A);if(B)return B;const _=Ei(e,t,r,n,a,x),S=x.result.w,E=x.result.h,$={texture:_,width:S,height:E,displayRange:v.displayRange,bytes:S*E*8};return y.set(A,$),$}function Si(e,t,r){return`${e}|${t}|${r?Ar(r):""}`}function Mi(e,t,r,n,a,o){return wi(e,Si(n,a,o),()=>Ti(e,t,r,n,a,o))}async function Ti(e,t,r,n,a,o){try{const s=Gr(e,t,r,"ssim",void 0,n,a,o);return s.ssimMean!==void 0?s.ssimMean:(s.ssimMeanPending||(s.ssimMeanPending=Ri(e,s).then(c=>(s.ssimMean=c,c))),await s.ssimMeanPending)}catch{return Di(e,t,r,o)}}async function Ri(e,t){if(t.width*t.height<=0)return NaN;if(e.reduceTextureChannelMean)return 1-await e.reduceTextureChannelMean(t.texture,0,t.width,t.height);const n=await Or(e,t);return li(n,t.width,t.height)}async function Di(e,t,r,n){const a=n??Ye({w:t.width,h:t.height},{w:r.width,h:r.height},"top-left","crop","b"),o=a.result.w,s=a.result.h,c=o*s;if(c<=0)return NaN;const v=await e.readback(t),y=await e.readback(r),x=v instanceof Uint8Array?255:1,A=y instanceof Uint8Array?255:1,B=a.fit==="fill",_=Pt(v,t.width,t.height,x,a.offsetA,B,o,s),S=Pt(y,r.width,r.height,A,a.offsetB,B,o,s),E=new Float64Array(c),$=new Float64Array(c),P=[0,0,0],D=[0,0,0];for(let C=0;C<s;C++){for(let z=0;z<o;z++){_(z,C,P),S(z,C,D);const l=C*o+z;E[l]=Nn(P[0],P[1],P[2]),$[l]=Nn(D[0],D[1],D[2])}(C+1)%La===0&&await ka()}return Fa(E,$,o,s)}async function Or(e,t){return t.resultSamples?t.resultSamples:(t.resultSamplesPending||(t.resultSamplesPending=e.readback(t.texture).then(r=>{const n=r instanceof Float32Array?r:Float32Array.from(r);return t.resultSamples=n,cn(e).accountReadbackBytes(t,n.byteLength),n})),t.resultSamplesPending)}function Ur(e){const t=e.analytic?1:e.grayNone?2:e.turbo?3:0,r=e.isScalar?e.colormap:void 0;let n;return r&&r.length>=1024&&(n=r[512]*1+r[513]*3+r[514]*7+r[1020]*11+r[1021]*13+r[1022]*17),{operator:e.operator,hdrOut:e.hdrOut,reduce:e.reduce,channelCount:e.channelCount,scalarMode:t,hasColormap:!!r,colormapSig:n,contentParam:e.contentParam}}const Pi=12,Ir=6;let Ci=0;const De=[];function dr(e){const t=De.indexOf(e);t!==-1&&De.splice(t,1),De.push(e)}function Bi(e){const t=De.indexOf(e);t!==-1&&De.splice(t,1)}function Ct(e,t,r){if(r!==void 0){const a=e.retained.get(r);if(a)return e.retained.delete(r),e.retained.set(r,a),a;const o=e.device.createTexture(t.width,t.height,t.format);return o.write(t.data),e.retained.set(r,o),Ai(e),o}const n=e.device.createTexture(t.width,t.height,t.format);return n.write(t.data),n}function Ai(e){for(;e.retained.size>Ir;){let t;for(const[n,a]of e.retained)if(a!==e.srcTexture&&a!==e.srcTextureB){t=n;break}if(t===void 0)break;const r=e.retained.get(t);e.retained.delete(t),r.destroy()}}function He(e,t){e&&t===void 0&&e.destroy()}function _i(e){for(const t of e.retained.values())t.destroy();e.retained.clear()}function Pe(e){e.parked||(Bi(e),He(e.srcTexture,e.sourceKey),e.srcTexture=null,He(e.srcTextureB,e.sourceBKey),e.srcTextureB=null,_i(e),e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),e.deepSampleTex&&(e.deepSampleTex.destroy(),e.deepSampleTex=null),e.surface=null,e.parked=!0)}function fr(e){for(;De.length>Pi;){const t=De.find(r=>r!==e&&!r.visible)??De.find(r=>r!==e);if(!t)break;Pe(t)}}function Ne(e){if(e.disposed)return;if(Na())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){dr(e),fr(e);return}if(!e.backingWidth||!e.backingHeight)return;const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const r=e.backingWidth,n=e.backingHeight;if(e.canvas.width=r,e.canvas.height=n,e.surface.configure(r,n),e.deep){const a=t.createTexture(e.deep.width,e.deep.height,"rgba16float");e.srcTexture=a,e.deepBuffers=t.createDeepSampleBuffers(e.deep),t.compositeDeep(e.deepBuffers,a,e.deepZNear,e.deepZFar)}else e.source&&(e.srcTexture=Ct(e,e.source,e.sourceKey));e.sourceB&&(e.srcTextureB=Ct(e,e.sourceB,e.sourceBKey)),e.parked=!1,dr(e),fr(e)}const pr=8;function Lr(e,t,r,n){try{const a=e.hdr?"rgba16float":"rgba8unorm";e.deepSampleTex||(e.deepSampleTex=e.device.createTexture(pr,pr,a));const o=e.deepSampleTex;on(e.device,o,t,r),e.device.readback(o).then(s=>{za(n,Gi(s,e.hdr),e.paneId)}).catch(()=>{})}catch{}}function Gi(e,t){let r=0,n=0,a=0,o=0;const s=t?1:1/255;for(let x=0;x+3<e.length;x+=4){const A=e[x+3]*(t?1:.00392156862745098),B=A<=0?0:A;r+=e[x]*s*B,n+=e[x+1]*s*B,a+=e[x+2]*s*B,o+=B}if(o<=0)return{r:0,g:0,b:0};let c=r/o,v=n/o,y=a/o;if(t){const x=Math.max(c,v,y,1);c/=x,v/=x,y/=x}return{r:Math.min(1,c),g:Math.min(1,v),b:Math.min(1,y)}}function hr(e,t){if(e.disposed||!e.source&&!e.deep||!e.backingWidth||!e.backingHeight)return!0;try{if(Ne(e),!e.surface||!e.srcTexture)return!1;const r=e.srcTextureB?{...t,srcB:e.srcTextureB}:t;if(on(e.device,e.surface,e.srcTexture,r),Er()){const n={mode:"image",sourceKey:e.sourceKey,sourceBKey:e.sourceBKey,contentOpId:t.contentOpId,hasSrcB:e.srcTextureB!=null,isScalar:t.isScalar,compareIntended:t.compareIntended,authoredColormap:t.authoredColormap,...Ur(t)};yr(n),Sr()&&Lr(e,e.srcTexture,r,n)}return!0}catch(r){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",r),e.parked=!1,Pe(e),!1}}function gr(e,t,r,n,a,o){if(e.disposed||!e.source&&!e.deep||!e.sourceB)return null;try{if(Ne(e),!e.surface||!e.srcTexture||!e.srcTextureB)return null;const s=Gr(e.device,e.srcTexture,e.srcTextureB,t,n,r.a,r.b,o);if(on(e.device,e.surface,s.texture,a),Er()){const c={mode:"cached-diff",sourceKey:e.sourceKey,sourceBKey:e.sourceBKey,contentOpId:a.contentOpId,hasSrcB:e.srcTextureB!=null,isScalar:a.isScalar,...Ur(a)};yr(c),Sr()&&Lr(e,s.texture,a,c)}return s}catch(s){return console.warn("cairn-plot engine: cached-diff pane render failed, falling back to legacy pane",s),e.parked=!1,Pe(e),null}}function Oi(e,t){if(e.disposed||!e.source||!e.sourceB)return null;try{return Ne(e),!e.srcTexture||!e.srcTextureB?null:gi(e.device,e.srcTexture,e.srcTextureB,t)}catch(r){return console.warn("cairn-plot engine: pane metrics compute failed",r),e.parked=!1,Pe(e),null}}const mr=new WeakMap,br=new WeakMap;function Ui(e,t){var r;if(e.disposed||!e.source||e.deep)return null;try{Ne(e);const n=e.srcTexture,a=(r=e.device.computeTevTextureHistogram)==null?void 0:r.bind(e.device);if(!n||!a)return null;const o=`${t.channelCount}|${t.seriesCount}|${t.bins}|${t.u8Scale?1:0}|${Array.from(t.seriesWeights).join(",")}`;let s=mr.get(n);s||(s=new Map,mr.set(n,s));let c=s.get(o);return c||(c=a(n,n.width,n.height,t),s.set(o,c),c.catch(()=>s.delete(o))),c}catch(n){return console.warn("cairn-plot engine: pane histogram compute failed",n),e.parked=!1,Pe(e),null}}function Ii(e,t){var r;if(e.disposed||!e.deep)return null;try{Ne(e);const n=(r=e.device.computeDeepDepthHistogram)==null?void 0:r.bind(e.device);if(!e.deepBuffers||!n)return null;const a=e.deep;let o=br.get(a);o||(o=new Map,br.set(a,o));let s=o.get(t);return s||(s=n(e.deepBuffers,t),o.set(t,s),s.catch(()=>o.delete(t))),s}catch(n){return console.warn("cairn-plot engine: pane depth-histogram compute failed",n),e.parked=!1,Pe(e),null}}function Li(e,t,r){if(e.disposed||!e.source||!e.sourceB)return null;try{return Ne(e),!e.srcTexture||!e.srcTextureB?null:Mi(e.device,e.srcTexture,e.srcTextureB,t.a,t.b,r)}catch(n){return console.warn("cairn-plot engine: pane SSIM compute failed",n),e.parked=!1,Pe(e),null}}function ki(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t,r){if(!e.disposed)if(e.source=t,e.deep=null,e.deepBuffers&&(e.deepBuffers.destroy(),e.deepBuffers=null),!e.parked&&e.surface){const n=e.srcTexture,a=e.sourceKey,o=Ct(e,t,r);n&&n!==o&&He(n,a),e.srcTexture=o,e.sourceKey=r}else e.sourceKey=r},setSourceB(t,r){if(!e.disposed)if(e.sourceB=t,!e.parked&&e.surface){const n=e.srcTextureB,a=e.sourceBKey;if(t){const o=Ct(e,t,r);n&&n!==o&&He(n,a),e.srcTextureB=o,e.sourceBKey=r}else n&&He(n,a),e.srcTextureB=null,e.sourceBKey=void 0}else e.sourceBKey=t?r:void 0},setDeepSource(t,r,n){if(!e.disposed&&(e.deep=t,e.deepZNear=r,e.deepZFar=n,e.source=null,!e.parked&&e.surface)){He(e.srcTexture,e.sourceKey),e.sourceKey=void 0,e.deepBuffers&&e.deepBuffers.destroy();const a=e.device.createTexture(t.width,t.height,"rgba16float");e.srcTexture=a,e.deepBuffers=e.device.createDeepSampleBuffers(t),e.device.compositeDeep(e.deepBuffers,a,r,n)}},setDeepWindow(t,r){e.disposed||(e.deepZNear=t,e.deepZFar=r,!e.parked&&e.deepBuffers&&e.srcTexture&&e.device.compositeDeep(e.deepBuffers,e.srcTexture,t,r))},resize(t,r){if(e.disposed)return;const n=Math.max(1,Math.round(t)),a=Math.max(1,Math.round(r));e.backingWidth===n&&e.backingHeight===a||(e.backingWidth=n,e.backingHeight=a,!e.parked&&e.surface&&(e.canvas.width=n,e.canvas.height=a,e.surface.configure(n,a)))},render(t){return hr(e,t)},renderDiffCached(t,r,n,a,o){return gr(e,t,r,n,a,o)},isDiffResultCached(t,r,n,a){return e.disposed||!e.source||!e.sourceB?!1:lr(e.device,{w:e.source.width,h:e.source.height},{w:e.sourceB.width,h:e.sourceB.height},t,n,r.a,r.b,a)},renderDiff(t,r,n,a,o){var v;const s=Oe(t);if((s==null?void 0:s.kind)==="multipass"){const y=gr(e,t,r,(v=s.computeParams)==null?void 0:v.call(s,n),{...a,channelCount:1,isScalar:!0,norm:"linear"},o);return y?{entry:y}:"failed"}const c=tn(t);return c===0?"hold":hr(e,{...a,contentOpId:c})?{entry:null}:"failed"},isDiffContentResident(t,r,n,a){var s;const o=Oe(t);return(o==null?void 0:o.kind)!=="multipass"?tn(t)!==0:e.disposed||!e.source||!e.sourceB?!1:lr(e.device,{w:e.source.width,h:e.source.height},{w:e.sourceB.width,h:e.sourceB.height},t,(s=o.computeParams)==null?void 0:s.call(o,n),r.a,r.b,a)},computeHistogram(t){return Ui(e,t)},computeDepthHistogram(t){return Ii(e,t)},computeMetrics(t){return Oi(e,t)},computeSsim(t,r){return Li(e,t,r)},readDiffResult(t){return e.disposed?null:Or(e.device,t)},park(){e.disposed||Pe(e)},restore(){e.disposed||!e.source&&!e.deep||Ne(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Pe(e),e.source=null,e.sourceB=null,e.sourceKey=void 0,e.sourceBKey=void 0,e.deep=null,e.disposed=!0)}}}async function Fi(e,t){const r=await Dt(),n={paneId:++Ci,canvas:e,device:r,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,sourceB:null,srcTextureB:null,sourceKey:void 0,sourceBKey:void 0,retained:new Map,deep:null,deepZNear:-1/0,deepZFar:1/0,deepBuffers:null,deepSampleTex:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return ki(n)}function vr(e){e.dispose()}function Ni(e){var t;return((t=De.find(r=>r.canvas===e))==null?void 0:t.surface)??null}function zi(e){const{hdrMode:t,naturalDims:r,sdrColormap:n,resolvedKernelId:a,hdrDataRef:o,sdrImageDataRef:s,refFloatRef:c,refU8Ref:v,diffSamplesRef:y,diffResultDimsRef:x}=e,A=b.useCallback((S,E,$)=>{if(t){const d=o.current,f=r;if(!d||!f||S<0||E<0||S>=f.w||E>=f.h)return null;const u=d.shape.length===2?1:d.shape[2]??1,m=(E*f.w+S)*u,w=xt(d.pixels),R=u===1?[w(m)]:[w(m),w(m+1),w(m+2)];return Ve(R,"unit",$)}const P=s.current;if(!P||S<0||E<0||S>=P.width||E>=P.height)return null;const D=(E*P.width+S)*4,C=P.data[D],z=P.data[D+1],l=P.data[D+2];return Ve(n!=="none"?[C]:[C,z,l],"uint8",$)},[t,r,n,o,s]),B=b.useCallback((S,E,$)=>{const P=Oe(a);if((P==null?void 0:P.kind)==="multipass"){const d=y.current,f=x.current;if(!d||!f||S<0||E<0||S>=f.w||E>=f.h)return null;const u=(E*f.w+S)*4,m=P.output==="scalar"?[d[u]??0]:[d[u]??0,d[u+1]??0,d[u+2]??0];return Ve(m,"unit",$)}const D=Wa(a);if(!D||!$a(D))return null;const C=()=>{if(t){const u=o.current,m=r;if(!u||!m||S<0||E<0||S>=m.w||E>=m.h)return null;const w=u.shape.length===2?1:u.shape[2]??1,R=(E*m.w+S)*w,g=xt(u.pixels);return w===1?[g(R),g(R),g(R)]:[g(R),g(R+1),g(R+2)]}const d=s.current;if(!d||S<0||E<0||S>=d.width||E>=d.height)return null;const f=(E*d.width+S)*4;return[d.data[f]/255,d.data[f+1]/255,d.data[f+2]/255]},z=()=>{const d=c.current;if(d&&d.dtype==="float"){const{h:m,w,c:R}=Ke(d.shape);if(S<0||E<0||S>=w||E>=m)return null;const g=(E*w+S)*R,O=xt(d.pixels);return R===1?[O(g),O(g),O(g)]:[O(g),O(g+1),O(g+2)]}const f=v.current;if(!f||S<0||E<0||S>=f.width||E>=f.height)return null;const u=(E*f.width+S)*4;return[f.data[u]/255,f.data[u+1]/255,f.data[u+2]/255]},l=C(),p=z();return!l||!p?null:Ve(D.cpu([l,p],3),"unit",$)},[a,t,r,o,s,c,v,y,x]),_=b.useCallback((S,E,$)=>{const P=c.current;if(P&&P.dtype==="float"){const{h:z,w:l,c:p}=Ke(P.shape);if(S<0||E<0||S>=l||E>=z)return null;const d=(E*l+S)*p,f=xt(P.pixels),u=p===1?[f(d)]:[f(d),f(d+1),f(d+2)];return Ve(u,"unit",$)}const D=v.current;if(!D||S<0||E<0||S>=D.width||E>=D.height)return null;const C=(E*D.width+S)*4;return Ve([D.data[C],D.data[C+1],D.data[C+2]],"uint8",$)},[c,v]);return{samplePixel:A,sampleDiffPixel:B,sampleForeground:_}}function Wi(e){const{diffMode:t,compositorMode:r,hasCompare:n,hdrMode:a,deepActive:o,imageUrl:s,contentKeyA:c,contentKeyB:v,hasBOperand:y,resolvedKernelId:x,compareOpMode:A,splitPosition:B,paneReady:_,appliedPrimaryId:S,appliedBId:E,naturalDims:$,refDims:P,isDiffContentResident:D}=e,C=t?"diff":r?"compositor":"image",z=n?`A:${c}`:a?o?"deep":"hdr":`img:${s}`,l=n&&y?`B:${v}`:null,p=_&&S===z&&E===l;return{mode:C,primaryId:z,bId:l,kernelId:t?x:"",contentParam:r?B:0,contentKey:`${z}|${l}|${t?x:""}|${r?A:""}`,sourcesApplied:p,resident:p&&!!$&&(t||r?!!P:!0)&&(t?D():!0)}}const $i={pixels:Cs(new Float32Array(0)),shape:[0,0],dtype:"<f4"},Vi=new Set(["linear","srgb","gamma"]);function kr(e){const{h:t,w:r,c:n}=Ke(e.shape);if(e.pixels.kind==="f16-bits"){const s=e.pixels.bits,c=new Uint16Array(r*t*4);for(let v=0;v<r*t;v++){const y=v*n,x=v*4;if(n===1){const A=s[y];c[x]=A,c[x+1]=A,c[x+2]=A,c[x+3]=Kn}else c[x]=s[y],c[x+1]=s[y+1],c[x+2]=s[y+2],c[x+3]=n>=4?s[y+3]:Kn}return{data:c,width:r,height:t,format:"rgba16float"}}const a=e.pixels.values,o=new Float32Array(r*t*4);for(let s=0;s<r*t;s++){const c=s*n;let v,y,x,A=1;n===1?v=y=x=Ge(a[c]):n===3?(v=Ge(a[c]),y=Ge(a[c+1]),x=Ge(a[c+2])):(v=Ge(a[c]),y=Ge(a[c+1]),x=Ge(a[c+2]),A=Ge(a[c+3]));const B=s*4;o[B]=v,o[B+1]=y,o[B+2]=x,o[B+3]=A}return{data:o,width:r,height:t,format:"rgba32float"}}async function Hi(e){if(e.dtype==="float")return kr({pixels:e.pixels,shape:e.shape,dtype:e.numpyDtype??"<f4",deep:e.deep});if(!e.url)return null;const t=await Mr(e.url);return t?{data:t.data,width:t.width,height:t.height,format:"rgba8unorm"}:null}function Ki(e,t,r,n){if(r<=0||n<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const a=Bs({box:{left:0,top:0,width:t.width,height:t.height},naturalWidth:r,naturalHeight:n}),o=a.scale,s=a.visibleW*o,c=a.visibleH*o,v=a.imgLeft,y=a.imgTop,x=Math.max(e.zoom,1e-6),A=t.width/(x*s),B=t.height/(x*c),_=-v/s-e.pan.x/(x*s),S=-y/c-e.pan.y/(x*c);return{x:_,y:S,w:A,h:B}}function Yi(e,t,r,n){const a=e.w*r,o=e.h*n;return a<=0||o<=0||t.width<=0||t.height<=0?0:As({box:{left:0,top:0,width:t.width,height:t.height},naturalWidth:r,naturalHeight:n,sourceWindow:{x:0,y:0,w:e.w,h:e.h}})}function ji(e){var Dn,Pn,Cn,Bn,An;const t=Va(e),r=Ha(t),n=e.compareSource,a=!!n,o=a?n.mode==="blend"?"split":n.mode??"diff":null,s=o==="split",c=o==="diff",v=s?"split":null,y=(n==null?void 0:n.splitPosition)??.5,x=b.useRef(null),A=b.useRef(null),B=b.useRef(null),_=b.useRef(null),S=b.useRef(null),E=r&&!!((Dn=t.hdr)!=null&&Dn.deep),$=b.useCallback((i,h)=>{var M,T;(M=_.current)==null||M.setDeepWindow(i,h),(T=S.current)==null||T.call(S)},[]),P=Ka(r?t.hdr:$i,E?$:void 0),D=b.useRef(!1),[C,z]=b.useState(!1),[l,p]=b.useState(!1),[d,f]=b.useState(!1),[u,m]=b.useState(null),[w,R]=b.useState(0),[g,O]=b.useState(0),[F,q]=b.useState({x:0,y:0,w:1,h:1}),X=b.useRef(null),Q=b.useRef(null),[J,K]=b.useState(0),W=b.useRef(null),ee=b.useRef(null),Z=b.useRef(new Map),re=b.useRef(void 0),le=b.useRef(void 0),se=b.useRef(void 0),ve=b.useRef(null),ut=b.useRef(0),lt=b.useRef(void 0);b.useRef(-1);const Fr=b.useCallback((i,h,M)=>{const T=Z.current;for(T.has(i)&&T.delete(i),T.set(i,{upload:h,ref:M});T.size>Ir;){const U=T.keys().next().value;if(U===void 0)break;T.delete(U)}},[]),de=(n==null?void 0:n.contentKeyA)??"diff:a",Ce=(n==null?void 0:n.contentKeyB)??"diff:b",ze=t.zoom??1,Ue=t.pan??{x:0,y:0},Nr=t.onViewportChange,un=t.toolbar??!0,we=t.colormap??"none",dt=t.tonemap,zr=b.useId(),ln=Ya([`vp-st-pane-${zr}`]),dn=e.setSyncedSettings,L=dn?e.syncedSettings:ln.settings,ft=dn??ln.set,Bt=(()=>{const i=n==null?void 0:n.colormap;return i==null||i==="none"?null:i==="viridis"?"turbo":i})(),At=!!(n!=null&&n.onDiffKernelChange),[Wr,$r,je]=ja((n==null?void 0:n.opId)??"absolute");b.useLayoutEffect(()=>{At||!n||$r(n.opId??"absolute")},[At,n==null?void 0:n.opId,!!n]);const he=At?n.opId??"absolute":(L==null?void 0:L.diffKernel)??Wr,qe=b.useCallback(i=>{n!=null&&n.onDiffKernelChange?n.onDiffKernelChange(i):ft({diffKernel:i})},[n==null?void 0:n.onDiffKernelChange,ft]),_t=e.source.dtype==="float"||(n==null?void 0:n.b.dtype)==="float",fe=c?Ts(he,!!_t):he,fn=Bt??Et(fe),Gt=b.useRef(null);Gt.current==null&&(Gt.current=a&&c?fn:we);const xe=r?Ke(P.hdr.shape).c:1,Ot=b.useCallback(i=>qa(i),[]),Vr=typeof window<"u"&&!!window.__cairnDisableStackShared,pt=un===!1||Vr||!!L,V=Xa({mode:r?"arity":"sdr",arity:xe,curveSet:Za,propColormap:pt?we:Gt.current??we,propTonemap:dt,resolveDefaultCurve:Ot,controlledSurface:pt,settings:L}),Ut=()=>{const i=c?Bt??Et(je.default):we!=="none"?we:Ot(dt);V.setEncoding(i),Y({encoding:i})},Xe=r?"none":V.colormap,Ze=r?V.colormap:"none",ae=V.curveId,Hr=V.hasParam("peak"),pn=we!=="none"&&((Pn=yt(we))==null?void 0:Pn.kind)==="lut",It=r&&xe===1&&Ze==="none"&&Vi.has(ae),Lt=t.peak,kt=Lt!=null&&Lt>0?Lt:_s(dt)??wr,ge=(L==null?void 0:L.peak)!=null&&L.peak>0?L.peak:kt,Kr=ge!==kt,Ft=t.gamma,Nt=Ft&&Ft>0?Ft:Ja,Ee=(L==null?void 0:L.tonemapGamma)!=null&&L.tonemapGamma>0?L.tonemapGamma:Nt,Yr=Ee!==Nt,ce=(L==null?void 0:L.exposureEV)??0,ue=(L==null?void 0:L.offset)??0,ie=t.colorRange,zt=!!((Cn=yt(V.encodingId))!=null&&Cn.turbo),hn=zt?"mean":Hn(xe),ye=(L==null?void 0:L.reduce)??hn,j=b.useMemo(()=>(L==null?void 0:L.colorMin)!=null&&(L==null?void 0:L.colorMax)!=null?[L.colorMin,L.colorMax]:ie??null,[L==null?void 0:L.colorMin,L==null?void 0:L.colorMax,ie==null?void 0:ie[0],ie==null?void 0:ie[1]]),Se=ie??null,jr=((j==null?void 0:j[0])??null)!==((Se==null?void 0:Se[0])??null)||((j==null?void 0:j[1])??null)!==((Se==null?void 0:Se[1])??null),Ie=(V.isLut&&V.hasParam("min")||It)&&!!j&&Number.isFinite(j[0])&&Number.isFinite(j[1]),Be=b.useMemo(()=>{const i=ie??[0,1],h=i[0],M=i[1],T=M>h?M-h:1;return{lo:h,hi:M,span:T}},[ie==null?void 0:ie[0],ie==null?void 0:ie[1]]),Me=Qa(V,fn),[Le,Wt]=b.useState(null),[$t,ht]=b.useState(null),[qr,Vt]=b.useState(0),[ne,gn]=b.useState(null),[We,Xr]=b.useState(0),Ht=b.useRef(null),Qe=b.useRef(null),Je=b.useRef(null),Zr=b.useCallback(()=>c?{encoding:ct("scalar",ae,Me),tonemapGamma:Ee,peak:ge,exposureEV:ce,offset:ue,reduce:ye,compareMode:"diff",diffKernel:he}:{encoding:V.encodingId,tonemapGamma:Ee,peak:ge,exposureEV:ce,offset:ue,reduce:ye,...j?{colorMin:j[0],colorMax:j[1]}:{},...s?{compareMode:v,splitPosition:y}:{}},[c,Me,he,V.encodingId,V.colormap,ae,Ee,ge,ce,ue,ye,j,s,v,y]),Y=ft;es(t.settingsSyncGroupId,!!t.syncIsAnchor,ft,Zr);const ke=b.useCallback(i=>{V.setEncoding(i),Y({encoding:i})},[V,Y]),mn=b.useCallback(i=>Y({exposureEV:i}),[Y]),bn=b.useCallback(i=>Y({offset:i}),[Y]),Kt=b.useCallback(i=>Y({peak:i}),[Y]),Qr=b.useCallback(i=>Y({tonemapGamma:i}),[Y]),Jr=b.useCallback(i=>Y({reduce:i}),[Y]),vn=b.useCallback(i=>Y({colorMin:i[0],colorMax:i[1]}),[Y]),ea=b.useCallback(i=>Y({infoPanel:i}),[Y]),gt=b.useCallback(i=>{qe(i);const h=Et(i);V.setEncoding(h),Y({compareMode:"diff",diffKernel:i,encoding:ct("scalar",ae,h)})},[qe,Y,V,ae]),et=b.useCallback(i=>{V.setEncoding(i==="none"?V.curveId:i),Y({encoding:ct("scalar",ae,i)})},[V,Y,ae]),tt=b.useCallback(i=>{var h;(h=n==null?void 0:n.onCompareModeChange)==null||h.call(n,i),Y({compareMode:i})},[n==null?void 0:n.onCompareModeChange,Y]),nt=b.useCallback(i=>{var h;(h=n==null?void 0:n.onSplitPositionChange)==null||h.call(n,i),Y({splitPosition:i})},[n==null?void 0:n.onSplitPositionChange,Y]);Gs(A,v==="split"?"split":"normal",nt,{inStackedGrid:n==null?void 0:n.inStackedGrid,inOverlay:n==null?void 0:n.inOverlay});const Yt=ts();b.useEffect(()=>{const i=x.current;if(!i)return;let h=!1;return Dt().then(M=>{var N;if(h)return;const T=((N=M.probeExtendedToneMapping)==null?void 0:N.call(M))??!1,U=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,G=T&&U&&(r||we==="none");D.current=G,z(G),r&&!G&&Rr(T?"no-hdr-display":"no-hdr-browser"),Fi(i,{hdr:G}).then(H=>{if(h){vr(H);return}_.current=H,f(!0)}).catch(H=>{h||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",H),p(!0))})}).catch(M=>{h||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",M),p(!0))}),()=>{h=!0,_.current&&(vr(_.current),_.current=null)}},[]),b.useEffect(()=>{const i=A.current;if(!i)return;const h=new ResizeObserver(()=>O(M=>M+1));return h.observe(i),()=>h.disconnect()},[]),b.useEffect(()=>{const i=A.current;if(!i)return;const h=new IntersectionObserver(M=>{const T=M[0];if(!T)return;const U=_.current;U&&(U.setVisible(T.isIntersecting),T.isIntersecting?U.isParked&&(U.restore(),O(I=>I+1)):U.park())},{threshold:0});return h.observe(i),()=>h.disconnect()},[]),b.useLayoutEffect(()=>{var M;if(!r||!d||E)return;const i=P.hdr;X.current=i;const h=kr(i);(M=_.current)==null||M.setSource(h,a?de:void 0),re.current=a?`A:${de}`:"hdr",m(T=>T&&T.w===h.width&&T.h===h.height?T:{w:h.width,h:h.height}),K(T=>T+1),R(T=>T+1)},[r,d,E,r?P.hdr:null,a,a?de:null]),b.useEffect(()=>{if(!r||!d||!E)return;const i=t.hdr,h=i.deep;X.current=i;let M=!1;return h.getGpuCsr().then(T=>{var U;M||((U=_.current)==null||U.setDeepSource(T,h.zMin,h.zMax),re.current="deep",m(I=>I&&I.w===T.width&&I.h===T.height?I:{w:T.width,h:T.height}),K(I=>I+1),R(I=>I+1))}).catch(T=>{M||console.warn("[cairn] deep GPU CSR upload failed:",T)}),()=>{M=!0}},[r,d,E,r?t.hdr.deep:null]),b.useLayoutEffect(()=>{if(r||!d)return;const i=t,h=i.imageUrl,M=a?"none":Xe;if(!h){Q.current=null,re.current="img:",m(null),K(G=>G+1);return}const T=a?de:void 0,U=(G,N,H)=>{var $e,it;Q.current=G;const be={data:N.data,width:N.width,height:N.height,format:"rgba8unorm"};($e=_.current)==null||$e.setSource(be,T),re.current=a?`A:${de}`:`img:${h}`,m(pe=>pe&&pe.w===N.width&&pe.h===N.height?pe:{w:N.width,h:N.height}),(it=H.onNaturalSize)==null||it.call(H,N.width,N.height),K(pe=>pe+1),R(pe=>pe+1)};if(M==="none"){const G=ns(h);if(G){U(G,G,i);return}}let I=!1;return Mr(h).then(G=>{if(I||!G)return;let N=G;if(M!=="none"){const H=`gpu::${h}::${M}::ev${ce}::off${ue}`,be=rs(H);if(be)N=be;else{const $e=as(M);N=ss(G,M,$e,ce,ue),is(H,N)}}U(G,N,i)}),()=>{I=!0}},[r,d,r?null:t.imageUrl,r?null:Xe,r?0:ce,r?0:ue,a,a?de:null]),b.useLayoutEffect(()=>{var I;if(!d)return;const i=a?n==null?void 0:n.b:void 0;if(!i){(I=_.current)==null||I.setSourceB(null),le.current=null,gn(null),W.current=null,ee.current=null;return}const h=Ce,M=G=>{var N;(N=_.current)==null||N.setSourceB(G,h),le.current=`B:${h}`,i.dtype==="float"?(W.current=i,ee.current=null):(ee.current={data:G.data,width:G.width,height:G.height},W.current=null),gn(H=>H&&H.w===G.width&&H.h===G.height?H:{w:G.width,h:G.height}),Xr(H=>H+1)},T=Z.current.get(h);if(T){Z.current.delete(h),Z.current.set(h,T),M(T.upload);return}let U=!1;return Hi(i).then(G=>{U||!G||(Fr(h,G,i),M(G))}),()=>{U=!0}},[d,a,n==null?void 0:n.b,Ce]);const Ae=b.useMemo(()=>!a||!u||!ne?null:Ye(u,ne,(n==null?void 0:n.align)??"top-left",(n==null?void 0:n.fit)??"crop","b"),[a,u,ne,n==null?void 0:n.align,n==null?void 0:n.fit]),jt=b.useMemo(()=>{if(!c||!_t)return null;const i=e.source.dtype==="float"?e.source:null;if(!i)return null;const{h,w:M,c:T}=Ke(i.shape),U=os(i.pixels);return ui(U,M,h,T)},[c,_t,e.source]),rt=t.exposure??0,at=t.offset??0,Te=r?void 0:t.processing,wn={brightness:(Te==null?void 0:Te.brightness)??0,contrast:(Te==null?void 0:Te.contrast)??0,flipSign:(Te==null?void 0:Te.flipSign)??!1},mt=!r&&Xe==="none",me=Wi({diffMode:c,compositorMode:s,hasCompare:a,hdrMode:r,deepActive:E,imageUrl:t.imageUrl??"",contentKeyA:de,contentKeyB:Ce,hasBOperand:!!(n!=null&&n.b),resolvedKernelId:fe,compareOpMode:v,splitPosition:y,paneReady:d,appliedPrimaryId:re.current,appliedBId:le.current,naturalDims:u,refDims:ne,isDiffContentResident:()=>{var i;return!!((i=_.current)!=null&&i.isDiffContentResident(fe,{a:de,b:Ce},{hdrExposures:jt},Ae??void 0))}}),_e=b.useCallback(()=>{var _n;const i=_.current;if(!i||!d||!u)return!1;const h=A.current,T=B.current??h,U=T?T.getBoundingClientRect():null;if(!U||U.width<=0||U.height<=0)return!1;const I=Ki({zoom:ze,pan:Ue},U,u.w,u.h);q(oe=>oe.x===I.x&&oe.y===I.y&&oe.w===I.w&&oe.h===I.h?oe:I),i.resize(Math.round(U.width*Yt),Math.round(U.height*Yt));const G=Yi(I,U,u.w,u.h)>=cs?"nearest":"linear",N=I;if(re.current!==me.primaryId||le.current!==me.bId)return!1;if(s){if(!ne)return!1;const oe=zn(ae,D.current?ge:1,D.current,Ee),Fe={exposureEV:rt+ce,offset:at+ue,operator:oe.operator,gamma:oe.gamma,isScalar:!1,hdrOut:oe.hdrOut,peak:oe.peak,srgbDecode:!r,uv:N,filter:G,contentOpId:tn(v),contentParam:y};try{i.render(Fe)||p(!0)}catch(Re){console.warn("cairn-plot: GpuImagePane compositor render failed, falling back to legacy pane",Re),p(!0)}return!0}if(c){if(!ne)return!1;const oe=Oe(fe)?fe:"absolute",Fe=Me,Re=Fe!=="none"?yt(Fe):void 0,qt=!!(Re!=null&&Re.analytic),da=!!(Re!=null&&Re.turbo),Gn=Fe!=="none"&&!qt?Wn(Fe):void 0,fa={exposureEV:ce,offset:ue,operator:"linear",isScalar:Fe!=="none",reduce:"mean",channelCount:3,hdrOut:qt?D.current:!1,srgbDecode:!1,uv:N,filter:G,...qt?{analytic:!0}:{},...da?{turbo:!0}:{},...Gn?{colormap:Gn}:{}};try{const ot=i.renderDiff(oe,{a:de,b:Ce},{hdrExposures:jt},fa,Ae??void 0);if(ot==="hold")return!1;ot==="failed"?(Ht.current=null,p(!0)):Ht.current=ot.entry}catch(ot){console.warn("cairn-plot: GpuImagePane diff render failed, falling back to legacy pane",ot),p(!0)}return!0}const H=zn(ae,D.current?ge:1,D.current,Ee),be=r&&Ze!=="none",$e=be&&!!((_n=yt(Ze))!=null&&_n.analytic),it=Ie?0:rt+ce,pe=Ie?0:at+ue,la=$e?{exposureEV:rt+ce,offset:at+ue,operator:"linear",isScalar:!0,analytic:!0,hdrOut:H.hdrOut,peak:H.peak,srgbDecode:!1,reduce:ye,channelCount:xe,uv:N,filter:G}:be?{exposureEV:it,offset:pe,operator:"linear",gamma:1,isScalar:!0,colormap:Wn(Ze),hdrOut:!1,peak:H.peak,srgbDecode:!1,...zt?{turbo:!0}:{},reduce:ye,channelCount:xe,...Ie&&j?{normMin:j[0],normMax:j[1]}:{},uv:N,filter:G}:It?{exposureEV:it,offset:pe,operator:"linear",gamma:1,isScalar:!0,grayNone:!0,grayEncodeGamma:Rs(ae,Ee)??0,hdrOut:H.hdrOut,peak:H.peak,srgbDecode:!1,reduce:ye,channelCount:xe,...Ie&&j?{normMin:j[0],normMax:j[1]}:{},uv:N,filter:G}:r||mt?{exposureEV:rt+ce,offset:at+ue,operator:H.operator,gamma:H.gamma,isScalar:!1,hdrOut:H.hdrOut,peak:H.peak,srgbDecode:!r,uv:N,filter:G,...wn}:{exposureEV:0,offset:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,srgbDecode:!1,uv:N,filter:G,...wn};if(a)return!1;try{i.render({...la,compareIntended:a,authoredColormap:pn})||p(!0)}catch(oe){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",oe),p(!0)}return!0},[d,u,ze,Ue.x,Ue.y,rt,at,ce,ue,ae,ge,Ee,mt,r,Xe,Ze,ye,xe,j,Ie,Yt,c,ne,We,fe,Me,Ae,jt,de,Ce,s,v,y,a,E,r?null:t.imageUrl,n==null?void 0:n.b,pn]);S.current=_e;const bt=b.useMemo(()=>({}),[_e]);lt.current!==me.contentKey&&(lt.current=me.contentKey,ut.current+=1),ut.current;const xn=()=>{const i=ve.current;return!!i&&i.id===bt&&i.uv===w&&i.ct===g},En=()=>{ve.current={id:bt,uv:w,ct:g}};b.useLayoutEffect(()=>{if(me.contentKey===se.current||!me.resident||xn())return;se.current=me.contentKey,_e()&&En()},[bt,w,g,me.resident,me.contentKey]),b.useEffect(()=>{if(se.current=me.contentKey,xn())return;_e()&&En()},[bt,w,g]),b.useEffect(()=>{var M;if(!a||!d||!ne){Wt(null);return}let i=!1;const h=(M=_.current)==null?void 0:M.computeMetrics(Ae??void 0);return h==null||h.then(T=>{i||Wt(T)}).catch(()=>{i||Wt(null)}),()=>{i=!0}},[a,d,ne,w,We,he,Ae]),b.useEffect(()=>{var M;if(!a||!d||!ne){ht(null);return}let i=!1;ht(null);const h=(M=_.current)==null?void 0:M.computeSsim({a:de,b:Ce},Ae??void 0);return h==null||h.then(T=>{i||ht(T)}).catch(()=>{i||ht(null)}),()=>{i=!0}},[a,d,ne,w,We,de,Ce,Ae]),b.useEffect(()=>{var T,U;if(!c){Qe.current=null,Je.current=null;return}const i=Oe(fe);if((i==null?void 0:i.kind)!=="multipass"){Qe.current=null,Je.current=null,Vt(I=>I+1);return}const h=Ht.current;if(!d||!h)return;let M=!1;return Qe.current=null,Je.current=null,Vt(I=>I+1),(U=(T=_.current)==null?void 0:T.readDiffResult(h))==null||U.then(I=>{M||(Qe.current=I,Je.current={w:h.width,h:h.height},Vt(G=>G+1))}).catch(()=>{}),()=>{M=!0}},[c,d,fe,w,We,Ae]),b.useEffect(()=>{const i=A.current;if(!(!i||!a))return i.__cairnImageDiffProbe={canvas:x.current,requestRender:_e,get compareMode(){return c?"diff":v},get diffKernel(){return he},get resolvedKernelId(){return fe},get colormap(){return Me},get encodingId(){return ct("scalar",ae,Me)},get effectiveTonemap(){return ae},get metrics(){return Le},get ssimText(){return nr($t)},get splitPosition(){return y},changeSplit:nt,get dims(){return u},get srcDims(){return u?{a:u,b:ne??u}:null},get overlayWindow(){return F},overlayTexelCenter:(h,M,T)=>{const U=x.current;if(!U||!u)return null;const I=U.getBoundingClientRect(),G=h==="a"?u:ne??u,N=us(M,T,{box:I,naturalWidth:u.w,naturalHeight:u.h,sourceWindow:F},G);return{x:N.x-I.left,y:N.y-I.top}},readbackSurface:async()=>{const h=x.current;if(!h)return null;_e();const M=Ni(h);return M?{data:await(await Dt()).readback(M),width:h.width,height:h.height}:null},changeCompareMode:tt,changeDiffKernel:gt,changeDiffColormap:et,changeTonemap:h=>ke(h),changeColormap:et,home:()=>{const h=typeof window<"u"&&!!window.__cairnDisableCompareHomeReset;n!=null&&n.onCompareReset?h||n.onCompareReset():qe(je.default),Ut()}},()=>{i&&delete i.__cairnImageDiffProbe}},[a,c,v,_e,he,fe,Me,ae,Le,$t,y,nt,u,ne,F,tt,gt,et,ke,qe,je,V,n]),b.useEffect(()=>{const i=A.current;if(i)return i.__cairnImagePaneProbe={get encodingId(){return V.encodingId},get colormap(){return V.colormap},get controlledSurface(){return pt},get peak(){return ge},changePeak:Kt,changeEncoding:ke,home:()=>Ut()},()=>{i&&delete i.__cairnImagePaneProbe}},[V.encodingId,V.colormap,pt,ge,Kt,ke,V]);const{samplePixel:yn,sampleDiffPixel:ta,sampleForeground:Sn}=zi({hdrMode:r,naturalDims:u,sdrColormap:Xe,resolvedKernelId:fe,hdrDataRef:X,sdrImageDataRef:Q,refFloatRef:W,refU8Ref:ee,diffSamplesRef:Qe,diffResultDimsRef:Je}),na=b.useMemo(()=>{var M;const i=(T,U)=>async I=>{const G=_.current,N=Ds(I);if(!G||!N||T>4)return null;const H=G.computeHistogram({channelCount:T,seriesCount:I.length,seriesWeights:N,bins:St,u8Scale:U});if(!H)return null;const be=await H.catch(()=>null);return be?Ps(be,I,St):null};if(r){const T=X.current;if(!T)return;const U=(M=t.hdr)==null?void 0:M.deep,I=ls(T,J,U?()=>U.getGpuCsr():void 0);return U?{...I,computeDepthHistogram:async()=>{var H;const G=(H=_.current)==null?void 0:H.computeDepthHistogram(St);if(!G)return null;const N=await G.catch(()=>null);return N?ds(N.zMin,N.zMax,N.weights,St):null}}:{...I,computeTev:i(Ke(T.shape).c,!1)}}return{...fs(Q.current,J),computeTev:i(4,!0)}},[r,J]),ra=b.useMemo(()=>{if(!a)return[];const i=di({mode:s?v:"diff",kernel:he,kernelOptions:Tr().map(M=>({id:M.id,label:M.label})),onSplit:()=>tt("split"),onKernel:M=>{s&&tt("diff"),gt(M)}});if(s)return[i,$n({value:V.encodingId,ids:V.ids,onSelect:ke})];const h=ps({lutValue:Me,onSelectLut:M=>et(M)});return[i,h]},[a,s,v,he,Me,ae,V.encodingId,V.ids,ke,tt,gt,et]),st=a?Os({mode:c?"diff":v,diffKernel:he,referenceLabel:n==null?void 0:n.referenceLabel,foregroundLabel:n==null?void 0:n.foregroundLabel}):{left:void 0,right:void 0},aa=st.right?"bottom-7":"bottom-1",sa=a?te.jsxs(te.Fragment,{children:[v==="split"&&te.jsx(hs,{}),st.left?te.jsx(Vn,{label:st.left,corner:"bottom-left",attrs:{"data-cairn-compare-caption":"reference"}}):null,st.right?te.jsx(Vn,{label:st.right,corner:"bottom-right",attrs:{"data-cairn-compare-caption":"foreground"}}):null,Le&&te.jsxs("span",{className:`absolute right-1 z-30 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${aa}`,"data-gpu-compare-metrics":!0,children:["MSE ",Le.mse.toExponential(2)," · PSNR"," ",Number.isFinite(Le.psnr)?Le.psnr.toFixed(1):"∞"," dB · MAE ",Le.mae.toExponential(2)," · SSIM ",nr($t)]})]}):void 0,Mn=t.showAxes??!1,Tn=r?t.label??"":t.label,Rn=t.interpolation??"auto",ia=Rn==="auto"?void 0:Rn,vt=t.overlay,wt=t.overlaySettings,oa=r?!1:t.isDraggable??!1,ca=r?void 0:t.onDragStart;if(l)return te.jsx(gs,{...e});const ua=vt&&(wt!=null&&wt.enabled)&&u&&((((Bn=vt.boxes)==null?void 0:Bn.length)??0)>0||(((An=vt.masks)==null?void 0:An.length)??0)>0)?te.jsx(ms,{data:vt,settings:wt,naturalWidth:u.w,naturalHeight:u.h}):void 0;return te.jsx(bs,{paneAttrs:{"data-gpu-image-pane":"","data-gpu-backend-ready":d},viewportAttrs:{"data-gpu-image-viewport":""},toolbar:un,paneRef:A,wrapperRef:B,zoom:ze,pan:Ue,onViewportChange:Nr,naturalDims:u,checkerboard:"wrapper",wrapperClassName:"relative w-full h-full flex items-center justify-center",viewportPadding:!s&&Mn&&u?"16px 4px 4px 28px":0,surface:te.jsxs(te.Fragment,{children:[te.jsx("canvas",{ref:x,className:"w-full h-full block",style:{imageRendering:ia},"data-gpu-image-canvas":!0,"data-gpu-compare-canvas":s?"":void 0}),v==="split"&&te.jsx(Us,{splitPosition:y,onChange:nt,onReset:()=>nt(.5)})]}),showAxes:Mn&&!s,overlayNode:ua,overlay:s?{render:({notation:i,setOverlayActive:h})=>v==="split"?te.jsxs(te.Fragment,{children:[u&&te.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-y)*100}% 0 0)`},children:te.jsx(Xt,{imageElRef:x,naturalWidth:u.w,naturalHeight:u.h,zoom:ze,pan:Ue,sourceWindow:F,sourceDims:u,sample:yn,notation:i,version:J})}),u&&ne&&te.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${y*100}%)`},children:te.jsx(Xt,{imageElRef:x,naturalWidth:u.w,naturalHeight:u.h,zoom:ze,pan:Ue,sourceWindow:F,sourceDims:ne,sample:Sn,notation:i,version:We+J,onActiveChange:h})})]}):u&&ne&&te.jsx(Xt,{imageElRef:x,naturalWidth:u.w,naturalHeight:u.h,zoom:ze,pan:Ue,sourceWindow:F,sourceDims:ne,sample:Sn,notation:i,version:We+J,onActiveChange:h})}:{displayElRef:x,sample:c?ta:yn,version:c?qr:J,hasSource:!0,sourceWindow:F},notationSeed:t.pixelValueNotation??"decimal",exportCanvasRef:x,requestRender:_e,enlargeControl:e.enlargeControl,histogram:a?void 0:na,depthWindow:P.hasDeep?P.window:void 0,infoPanelSetting:L==null?void 0:L.infoPanel,onInfoPanelChange:ea,leadingMenus:a?[...t.channelMenu?[t.channelMenu]:[],...ra]:[...t.channelMenu?[t.channelMenu]:[],$n({value:V.encodingId,ids:V.ids,onSelect:ke})],rowSegments:[...!c&&V.hasParam("reduce")&&xe>1?[Ms(ye,Jr)]:[]],displayAdjust:c?{exposureEV:ce,offset:ue,onExposureChange:mn,onOffsetChange:bn}:V.hasParam("exposure")&&!Ie?{exposureEV:ce,offset:ue,onExposureChange:mn,onOffsetChange:bn}:void 0,extraSliders:c?[]:[...(r||mt)&&C&&Hr&&!It?[{id:"peak",label:"PK",title:"Peak white (×SDR white) — the HDR ceiling P every operator clips at (Linear/sRGB/Gamma hard-clip at P; Reinhard/ACES roll off toward P). P=1 reproduces the SDR rendition exactly; double-click to type a value, including 'inf' for the raw browser-clipped extended look.",min:xs,max:ws,step:vs,value:ge,onChange:Kt,format:i=>Number.isFinite(i)?`${i.toFixed(1)}×`:"∞"}]:[],...(r||mt)&&V.hasParam("gamma")?[{id:"gamma",label:"γ",title:"Display gamma γ for the Gamma transfer — display = clamp(value)^(1/γ), tev-style. Default 2.2 (close to sRGB, not identical). Double-click to type a value.",min:Ss,max:ys,step:Es,value:Ee,onChange:Qr,format:i=>i.toFixed(1)}]:[],...Ie&&j?[{id:"colorMin",label:"min",title:"Colormap domain minimum — the data value that maps to the bottom of the ramp.",min:Be.lo-Be.span,max:Be.hi,step:Be.span/100,value:j[0],onChange:i=>vn([i,j[1]]),format:i=>i.toPrecision(3)},{id:"colorMax",label:"max",title:"Colormap domain maximum — the data value that maps to the top of the ramp.",min:Be.lo,max:Be.hi+Be.span,step:Be.span/100,value:j[1],onChange:i=>vn([j[0],i]),format:i=>i.toPrecision(3)}]:[]],depthSliders:P.sliders,regionSelect:E?{rect:P.region,queryLive:P.queryRegionWindow,commit:P.commitRegion,remove:P.removeRegion}:void 0,onReset:()=>{var i;Ut();{const h=c?Bt??Et(je.default):we,M=c?ct("scalar",ae,h):h!=="none"?h:Ot(dt);Y({encoding:M,peak:kt,tonemapGamma:Nt,exposureEV:0,offset:0,reduce:zt?"mean":Hn(xe),...Se?{colorMin:Se[0],colorMax:Se[1]}:{colorMin:void 0,colorMax:void 0},infoPanel:void 0})}if(P.reset(),(i=t.onChannelReset)==null||i.call(t),a){const h=typeof window<"u"&&!!window.__cairnDisableCompareHomeReset;n!=null&&n.onCompareReset?h||n.onCompareReset():qe(je.default)}},extraModified:V.encodingModified||Kr||Yr||ye!==hn||jr||P.isModified||!!t.channelModified||a&&!!(n!=null&&n.compareModified),label:a?"":Tn,showLabelChip:!a&&!!Tn,extraChips:sa,isDraggable:oa,onDragStart:ca})}const qi="cairn-plot:gpu-image-ready";async function Xi(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Dt(),window.__cairnPlotGpuImagePane=ji,window.__cairnPlotDiffMenuModes=Tr(),window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(qi))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e);const t={hasGpu:"gpu"in navigator,isSecureContext:window.isSecureContext!==!1};Rr(Is(t)),Ls(t)}}}Xi();

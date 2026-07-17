var xr=Object.defineProperty;var yr=(a,s,Me)=>s in a?xr(a,s,{enumerable:!0,configurable:!0,writable:!0,value:Me}):a[s]=Me;var j=(a,s,Me)=>yr(a,typeof s!="symbol"?s+"":s,Me);(function(a,s){"use strict";const Me=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function st(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"premultiplied",usage:Me}),{hdr:!1,format:n}}function qt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:Me}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:Me}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return st(e,t)}}}const Zt=`
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
`;function Ve(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function ct(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function jt(e){const t=(e&32768)>>15,n=(e&31744)>>10,r=e&1023;let o;return n===0?o=r/1024*Math.pow(2,-14):n===31?o=r?NaN:1/0:o=(1+r/1024)*Math.pow(2,n-15),t?-o:o}const Kt={texture:0,sampler:1,uniform:2};function ze(e,t){return e*3+Kt[t]}const Qt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Jt(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let r;for(;(r=n.exec(e))!==null;){const o=Number(r[1]),i=r[2]!==void 0,c=r[3].trim();if(i){const u=Qt[c];if(u===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${c}" (binding ${o}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(o,{kind:"uniform",sizeBytes:u})}else c==="sampler"||c==="sampler_comparison"?t.set(o,{kind:"sampler"}):t.set(o,{kind:"texture"})}return t}class lt{constructor(t,n,r,o){j(this,"width");j(this,"height");j(this,"format");j(this,"gpuTexture");j(this,"device");j(this,"destroyed",!1);this.device=t,this.width=n,this.height=r,this.format=o,this.gpuTexture=t.createTexture({size:{width:n,height:r,depthOrArrayLayers:1},format:Ve(o),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*ct(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class ut{constructor(t){j(this,"_s");j(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class en{constructor(t,n,r,o,i){j(this,"_p");j(this,"gpuPipeline");j(this,"bindings");j(this,"bindGroupLayout");j(this,"variants");j(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=r,this.buildVariant=i,this.variants=new Map([[o,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function tn(e,t){const n=[];for(const[r,o]of t)o.kind==="uniform"?n.push({binding:r,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):o.kind==="sampler"?n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class nn{constructor(t){j(this,"_c");j(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class rn{constructor(t,n){j(this,"_b");j(this,"gpuBindGroup");j(this,"ownedBuffers");j(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class on{constructor(t,n,r,o){j(this,"canvas");j(this,"hdr");j(this,"format");j(this,"context");j(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=r.hdr,this.format=r.format,this.reconfigure=o}configure(t,n){this.canvas.width=t,this.canvas.height=n;const r=this.reconfigure();this.hdr=r.hdr,this.format=r.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function Le(e){return"canvas"in e}async function an(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let r=null;function o(){return r||(r=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),r}function i(l){return Le(l)?l.getCurrentTextureView():l.gpuTexture.createView()}function c(l){if(Le(l))return{width:l.canvas.width,height:l.canvas.height};const b=l;return{width:b.width,height:b.height}}let u=!1;const d=256;let f=null,x=null;function g(){if(!f||!x){const l=t.createShaderModule({code:Zt});x=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const b=t.createPipelineLayout({bindGroupLayouts:[x]});f=t.createComputePipeline({layout:b,compute:{module:l,entryPoint:"cs_main"}})}return{pipeline:f,layout:x}}return{backend:"webgpu",capabilities:n,createTexture(l,b,h){return new lt(t,l,b,h)},createSampler(l){const b=(l==null?void 0:l.filter)==="linear"?"linear":"nearest",h=t.createSampler({magFilter:b,minFilter:b,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new ut(h)},createRenderPipeline(l){const b=t.createShaderModule({code:l.shaderWGSL}),h=Jt(l.shaderWGSL),v=Ve(l.targetFormat),y=tn(t,h),p=t.createPipelineLayout({bindGroupLayouts:[y]}),w=m=>t.createRenderPipeline({layout:p,vertex:{module:b,entryPoint:"vs_main"},fragment:{module:b,entryPoint:"fs_main",targets:[{format:m}]},primitive:{topology:"triangle-list"}}),P=w(v);return new en(P,h,y,v,w)},createComputePipeline(l){const b=t.createShaderModule({code:l.shaderWGSL}),h=t.createComputePipeline({layout:"auto",compute:{module:b,entryPoint:"cs_main"}});return new nn(h)},createBindGroup(l,b){const h=l,v=new Map,y=[];for(const[w,P]of h.bindings)if(P.kind==="uniform"){const m=t.createBuffer({size:P.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});y.push(m),v.set(w,{binding:w,resource:{buffer:m}})}else P.kind==="sampler"&&v.set(w,{binding:w,resource:o()});for(const w of b){const P=w.resource;if(P instanceof lt){const m=ze(w.binding,"texture");h.bindings.has(m)&&v.set(m,{binding:m,resource:P.gpuTexture.createView()})}else if(P instanceof ut){const m=ze(w.binding,"sampler");h.bindings.has(m)&&v.set(m,{binding:m,resource:P.gpuSampler})}else{const m=ze(w.binding,"uniform"),C=h.bindings.get(m);if(C&&C.kind==="uniform"){const L=P.uniform,B=t.createBuffer({size:Math.max(C.sizeBytes,L.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(B,0,L.buffer,L.byteOffset,L.byteLength),y.push(B),v.set(m,{binding:m,resource:{buffer:B}})}}}const p=t.createBindGroup({layout:h.bindGroupLayout,entries:Array.from(v.values())});return new rn(p,y)},createSurface(l,b){const h=l.getContext("webgpu");if(!h)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const v=b.hdr&&n.hdr,y=()=>v?qt(h,t):st(h,t),p=y();return new on(l,h,p,y)},renderFullscreen(l,b,h){const v=b,y=h,p=i(l),{width:w,height:P}=c(l),m=Le(l)?l.format:Ve(l.format),C=v.pipelineFor(m),L=t.createCommandEncoder(),B=L.beginRenderPass({colorAttachments:[{view:p,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});B.setPipeline(C),B.setBindGroup(0,y.gpuBindGroup),B.setViewport(0,0,w,P,0,1),B.draw(3),B.end(),t.queue.submit([L.finish()])},async readback(l){const b=Le(l),{width:h,height:v}=c(l),y=b?l.hdr?"rgba16float":"rgba8unorm":l.format,p=b&&l.format==="bgra8unorm",w=b?l.getCurrentGPUTexture():l.gpuTexture,P=ct(y),m=h*P,C=256,L=Math.ceil(m/C)*C,B=L*v,V=t.createBuffer({size:B,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),H=t.createCommandEncoder();H.copyTextureToBuffer({texture:w},{buffer:V,bytesPerRow:L,rowsPerImage:v},{width:h,height:v,depthOrArrayLayers:1}),t.queue.submit([H.finish()]),await V.mapAsync(GPUMapMode.READ);const O=new Uint8Array(V.getMappedRange()),E=new Uint8Array(m*v);for(let I=0;I<v;I++){const F=I*L,X=I*m;E.set(O.subarray(F,F+m),X)}if(V.unmap(),V.destroy(),y==="rgba8unorm"){if(p)for(let I=0;I<E.length;I+=4){const F=E[I],X=E[I+2];E[I]=X,E[I+2]=F}return E}if(y==="rgba16float"){const I=new Uint16Array(E.buffer,E.byteOffset,E.byteLength/2),F=new Float32Array(I.length);for(let X=0;X<I.length;X++)F[X]=jt(I[X]);return F}return new Float32Array(E.buffer,E.byteOffset,E.byteLength/4)},async reduceDiffSumSquaredAbs(l,b,h,v){const y=l,p=b,w=Math.max(0,h*v),P=Math.max(1,Math.ceil(w/d)),{pipeline:m,layout:C}=g(),L=P*2*4,B=t.createBuffer({size:L,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),V=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(V,0,new Uint32Array([Math.max(1,h),Math.max(1,v),w,0]));const H=t.createBindGroup({layout:C,entries:[{binding:0,resource:y.gpuTexture.createView()},{binding:1,resource:p.gpuTexture.createView()},{binding:2,resource:{buffer:B}},{binding:3,resource:{buffer:V}}]}),O=t.createBuffer({size:L,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),E=t.createCommandEncoder(),I=E.beginComputePass();I.setPipeline(m),I.setBindGroup(0,H),I.dispatchWorkgroups(P),I.end(),E.copyBufferToBuffer(B,0,O,0,L),t.queue.submit([E.finish()]),await O.mapAsync(GPUMapMode.READ);const X=new Float32Array(O.getMappedRange()).slice();O.unmap(),O.destroy(),B.destroy(),V.destroy();let Z=0,te=0;for(let ee=0;ee<P;ee++)Z+=X[ee*2],te+=X[ee*2+1];return{sumSq:Z,sumAbs:te}},destroy(){u||(t.destroy(),u=!0)},isContextLost(){return!1}}}let $e=null;async function sn(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return an()}function Ue(){return $e||($e=sn()),$e}function cn(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function ln(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const o=n/255*(e.length-1),i=Math.floor(o),c=Math.min(i+1,e.length-1),u=o-i,[d,f,x]=cn(e[i],e[c],u);t[n*3]=Math.round(d),t[n*3+1]=Math.round(f),t[n*3+2]=Math.round(x)}return t}const dt={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},ft=new Set(["red-green","red-blue"]),ht=new Map;function We(e){let t=ht.get(e);if(!t){const n=dt[e]??dt.viridis;t=ln(n),ht.set(e,t)}return t}function Xe(e,t,n="linear"){const r=We(t),o=new ImageData(e.width,e.height),i=e.data,c=o.data;for(let u=0;u<i.length;u+=4){const d=(i[u]+i[u+1]+i[u+2])/3;let f;n==="positive"?f=Math.round(128+d/255*127):f=Math.round(d),f=Math.max(0,Math.min(255,f)),c[u]=r[f*3],c[u+1]=r[f*3+1],c[u+2]=r[f*3+2],c[u+3]=i[u+3]}return o}function gt(e){const t=new Map;return{get(n){return t.get(n)},set(n,r){if(t.size>=e){const o=t.keys().next().value;o!==void 0&&t.delete(o)}t.set(n,r)}}}const mt=gt(50);function He(e){return mt.get(e)}function Ye(e,t){mt.set(e,t)}const pt=gt(100);function un(e){return pt.get(e)}function dn(e,t){pt.set(e,t)}function fn(e,t,n){const r=Math.min(e.width,t.width),o=Math.min(e.height,t.height),i=new ImageData(r,o);for(let c=0;c<o;c++)for(let u=0;u<r;u++){const d=(c*e.width+u)*4,f=(c*t.width+u)*4,x=(c*r+u)*4;for(let g=0;g<3;g++){const M=e.data[d+g],l=t.data[f+g],b=M-l,h=Math.abs(b),v=Math.max(M,1);let y;switch(n){case"signed":y=(b+255)/2;break;case"absolute":y=h;break;case"squared":y=b*b/255;break;case"relative_signed":y=(b/v+1)*127.5;break;case"relative_absolute":y=h/v*255;break;case"relative_squared":y=b*b/(v*v)*255;break}i.data[x+g]=Math.min(255,Math.max(0,Math.round(y)))}i.data[x+3]=255}return i}async function De(e){const t=un(e);return t||new Promise(n=>{const r=new Image;r.onload=()=>{try{const o=document.createElement("canvas");o.width=r.naturalWidth,o.height=r.naturalHeight;const i=o.getContext("2d");if(!i){n(null);return}i.drawImage(r,0,0);const c=i.getImageData(0,0,o.width,o.height);dn(e,c),n(c)}catch(o){console.warn("[cairn] loadImageData failed:",o),n(null)}},r.onerror=o=>{console.warn("[cairn] loadImageData: image failed to load:",e,o),n(null)},r.src=e})}const hn={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},gn={linear:0,signed:1,positive:2},mn=`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,pn=`#version 300 es
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
}`;let Ae=null,$=null,ge=null,Ge=null;function vn(){if($)return $;try{if(typeof OffscreenCanvas<"u"?Ae=new OffscreenCanvas(1,1):Ae=document.createElement("canvas"),$=Ae.getContext("webgl2",{preserveDrawingBuffer:!0}),!$)return console.warn("[cairn] WebGL 2 not available"),null;const e=$.createShader($.VERTEX_SHADER);if($.shaderSource(e,mn),$.compileShader(e),!$.getShaderParameter(e,$.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",$.getShaderInfoLog(e)),null;const t=$.createShader($.FRAGMENT_SHADER);if($.shaderSource(t,pn),$.compileShader(t),!$.getShaderParameter(t,$.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",$.getShaderInfoLog(t)),null;if(ge=$.createProgram(),$.attachShader(ge,e),$.attachShader(ge,t),$.linkProgram(ge),!$.getProgramParameter(ge,$.LINK_STATUS))return console.error("[cairn] WebGL program link:",$.getProgramInfoLog(ge)),null;Ge=$.createVertexArray(),$.bindVertexArray(Ge);const n=$.createBuffer();$.bindBuffer($.ARRAY_BUFFER,n),$.bufferData($.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),$.STATIC_DRAW);const r=$.getAttribLocation(ge,"a_pos");return $.enableVertexAttribArray(r),$.vertexAttribPointer(r,2,$.FLOAT,!1,0,0),$.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),$}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function vt(e,t,n){const r=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),r}function bn(e,t,n){const r=new Uint8Array(1024);for(let i=0;i<256;i++)r[i*4]=t[i*3],r[i*4+1]=t[i*3+1],r[i*4+2]=t[i*3+2],r[i*4+3]=255;const o=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,o),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,r),o}function wn(e,t,n,r){const o=vn();if(!o||!ge||!Ge||!Ae)return null;const i=Math.min(e.width,t.width),c=Math.min(e.height,t.height);Ae.width=i,Ae.height=c,o.viewport(0,0,i,c);const u=vt(o,e,0),d=vt(o,t,1);let f=null;n.colormap?f=bn(o,n.colormap,2):(f=o.createTexture(),o.activeTexture(o.TEXTURE2),o.bindTexture(o.TEXTURE_2D,f),o.texImage2D(o.TEXTURE_2D,0,o.RGBA8,1,1,0,o.RGBA,o.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),o.useProgram(ge),o.uniform1i(o.getUniformLocation(ge,"u_baseline"),0),o.uniform1i(o.getUniformLocation(ge,"u_other"),1),o.uniform1i(o.getUniformLocation(ge,"u_lut"),2),o.uniform1i(o.getUniformLocation(ge,"u_diff_mode"),hn[n.diffMode]),o.uniform1i(o.getUniformLocation(ge,"u_cmap_mode"),gn[n.cmapMode]??0),o.uniform1i(o.getUniformLocation(ge,"u_use_colormap"),n.colormap?1:0),o.bindVertexArray(Ge),o.drawArrays(o.TRIANGLE_STRIP,0,4),o.bindVertexArray(null),r.width=i,r.height=c;const x=r.getContext("2d");return x&&(x.save(),x.scale(1,-1),x.drawImage(Ae,0,0,i,c,0,-c,i,c),x.restore()),o.deleteTexture(u),o.deleteTexture(d),o.deleteTexture(f),{width:i,height:c}}const xn={cardSettings:(e,t,n)=>`cairn:card-settings:${e}:${t}:${n}`,runLayout:e=>`cairn:run-layout:${e}`,collapsedSections:e=>`cairn:collapsed-sections:${e}`,comparisons:e=>`cairn:comparisons:${e}`,comparisonTemplates:e=>`cairn:comparison-templates:${e}`,reportTemplates:e=>`cairn:report-templates:${e}`,streamMode:"cairn:stream-mode",renderMode:"cairn:render-mode",scroll:e=>`cairn:scroll:${e}`,lastComparison:e=>`cairn:last-comparison:${e}`};function yn(){try{const e=localStorage.getItem(xn.renderMode);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const ye=e=>e<0?0:e>1?1:e,qe=e=>{const t=e<0?0:e;return t/(1+t)},Ze=e=>{const t=e<0?0:e,n=t*(2.51*t+.03),r=t*(2.43*t+.59)+.14;return ye(n/r)},bt={linear:([e,t,n])=>[ye(e),ye(t),ye(n)],srgb:([e,t,n])=>[ye(e),ye(t),ye(n)],reinhard:([e,t,n])=>[qe(e),qe(t),qe(n)],aces:([e,t,n])=>[Ze(e),Ze(t),Ze(n)],extended:([e,t,n])=>[e,t,n]},En="srgb";function _n(e){return e&&bt[e]||bt[En]}function je(e,t){return e*2**t}function Mn(e){const t=ye(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function Ke(e,t){return typeof t=="number"&&t>0?ye(Math.pow(ye(e),1/t)):Mn(e)}function wt(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Qe({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:r}){const o=wt(e),i=wt(t),c=[];for(let p=0;p<=e;p+=o)c.push(p);const u=[];for(let p=0;p<=t;p+=i)u.push(p);const d=1/n,f=8*d,x=-12*d,g=-2*d,M=r==null?void 0:r.current;let l=0,b=0,h=0,v=0;if(M){const p=M.clientWidth,w=M.clientHeight,P=p/e,m=w/t,C=Math.min(P,m);h=e*C,v=t*C,l=(p-h)/2,b=(w-v)/2}const y=M&&h>0;return a.jsxs(a.Fragment,{children:[a.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:y?b:0,transform:`translateY(${x}px)`,fontSize:f},children:c.map(p=>a.jsx("span",{className:"mono",style:{position:"absolute",left:y?l+p/e*h:`${p/e*100}%`,transform:"translateX(-50%)"},children:p},p))}),a.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:y?l:0,transform:`translateX(${g}px)`,fontSize:f},children:u.map(p=>a.jsx("span",{className:"mono",style:{position:"absolute",top:y?b+p/t*v:`${p/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*d}px`},children:p},p))})]})}function Je({label:e,isDraggable:t,onDragStart:n}){return a.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&a.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const xt=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function et(e){const t=xt.length;return xt[(e%t+t)%t]}function Pn(e){const n=s.useRef(null),[r,o]=s.useState({w:0,h:0}),i=s.useRef(null),c=s.useRef(null);return s.useEffect(()=>{var f;const u=n.current;if(u===c.current||((f=i.current)==null||f.disconnect(),i.current=null,c.current=u,!u))return;const d=new ResizeObserver(x=>{for(const g of x)o({w:g.contentRect.width,h:g.contentRect.height})});i.current=d,d.observe(u)}),s.useEffect(()=>()=>{var u;return(u=i.current)==null?void 0:u.disconnect()},[]),{ref:n,size:r}}function Tn(){const[e,t]=s.useState(!1);return s.useEffect(()=>{const n=i=>{(i.key==="Alt"||i.key==="Control"||i.key==="Meta")&&t(!0)},r=i=>{(i.key==="Alt"||i.key==="Control"||i.key==="Meta")&&t(!1)},o=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",r),window.addEventListener("blur",o),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",r),window.removeEventListener("blur",o)}},[]),e}const Sn=.25,tt=64;function yt(e,t,n,r){if(e<=0||t<=0||n<=0||r<=0)return tt;const o=Math.min(n/e,r/t);return o<=0?tt:Math.max(Math.max(n,r)/o,8)}function Ie(e){const{containerRef:t,zoom:n,pan:r,onViewportChange:o,minZoom:i=Sn,maxZoom:c=tt,naturalWidth:u,naturalHeight:d}=e,f=Tn(),x=s.useRef(f);x.current=f;const g=s.useRef({zoom:n,pan:r});g.current={zoom:n,pan:r};const M=s.useRef(o);M.current=o,s.useEffect(()=>{const p=t.current;if(!p||!o)return;const w=P=>{var F;if(!x.current)return;P.preventDefault(),P.stopPropagation();const m=P.deltaY<0?1.1:1/1.1,C=g.current,L=p.getBoundingClientRect(),B=u&&d?yt(u,d,L.width,L.height):c,V=Math.max(i,Math.min(B,C.zoom*m));if(C.zoom===V)return;const H=P.clientX-L.left,O=P.clientY-L.top,E=H-(H-C.pan.x)/C.zoom*V,I=O-(O-C.pan.y)/C.zoom*V;(F=M.current)==null||F.call(M,{zoom:V,pan:{x:E,y:I}})};return p.addEventListener("wheel",w,{passive:!1}),()=>p.removeEventListener("wheel",w)},[t,!!o,i,c,u,d]);const l=s.useRef(null),b=s.useCallback(p=>{!x.current||!M.current||(p.currentTarget.setPointerCapture(p.pointerId),l.current={pointerId:p.pointerId,startX:p.clientX,startY:p.clientY,panX:g.current.pan.x,panY:g.current.pan.y})},[]),h=s.useCallback(p=>{var C;const w=l.current;if(!w||w.pointerId!==p.pointerId)return;const P=p.clientX-w.startX,m=p.clientY-w.startY;(C=M.current)==null||C.call(M,{zoom:g.current.zoom,pan:{x:w.panX+P,y:w.panY+m}})},[]),v=s.useCallback(p=>{const w=l.current;if(!(!w||w.pointerId!==p.pointerId)){try{p.currentTarget.releasePointerCapture(p.pointerId)}catch{}l.current=null}},[]),y=f&&!!o;return{containerProps:{onPointerDown:b,onPointerMove:h,onPointerUp:v,onPointerCancel:v,style:{cursor:y?"move":void 0,touchAction:y?"none":void 0}},modifierActive:f}}function nt(){const[e,t]=s.useState(()=>typeof window<"u"&&window.devicePixelRatio||1);return s.useEffect(()=>{if(typeof matchMedia>"u")return;let n=!1,r=null;const o=()=>{n||(t(window.devicePixelRatio||1),i())};function i(){if(n)return;const c=window.devicePixelRatio||1;r=matchMedia(`(resolution: ${c}dppx)`),r.addEventListener("change",o,{once:!0})}return i(),()=>{n=!0,r==null||r.removeEventListener("change",o)}},[]),e}function Cn(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function Et(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function rt({data:e,settings:t,naturalWidth:n,naturalHeight:r}){const{ref:o,size:i}=Pn(),c=s.useRef(null),u=s.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),d=s.useMemo(()=>{const h=i.w,v=i.h;if(h<=0||v<=0||n<=0||r<=0)return null;const y=Math.min(h/n,v/r),p=n*y,w=r*y;return{left:(h-p)/2,top:(v-w)/2,width:p,height:w}},[i.w,i.h,n,r]),f=e.masks,x=t.showMasks&&!!f&&f.length>0,g=s.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(s.useEffect(()=>{if(!x||!f)return;const h=c.current;if(!h)return;(h.width!==n||h.height!==r)&&(h.width=n,h.height=r);const v=h.getContext("2d");if(!v)return;v.clearRect(0,0,h.width,h.height);let y=!1;const p=v.createImageData(n,r),w=p.data;let P=f.length,m=!1;const C=()=>{y||m&&v.putImageData(p,0,0)},L=document.createElement("canvas");L.width=n,L.height=r;const B=L.getContext("2d",{willReadFrequently:!0});for(const V of f){const H=new Image;H.onload=()=>{if(!y){if(B){B.clearRect(0,0,n,r),B.drawImage(H,0,0,n,r);const O=B.getImageData(0,0,n,r).data;for(let E=0;E<n*r;E++){const I=O[E*4];if(I===0||u.has(I))continue;const[F,X,Z]=Cn(et(I));w[E*4]=F,w[E*4+1]=X,w[E*4+2]=Z,w[E*4+3]=255,m=!0}}P-=1,P===0&&C()}},H.onerror=()=>{P-=1,P===0&&C()},H.src=`data:image/png;base64,${V.png_b64}`}return()=>{y=!0}},[x,f,n,r,g]),!d)return a.jsx("div",{ref:o,className:"absolute inset-0 pointer-events-none"});const M=e.boxes??[],l=t.showBoxes&&M.length>0,b=e.class_labels??{};return a.jsxs("div",{ref:o,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[x&&a.jsx("canvas",{ref:c,className:"absolute",style:{left:d.left,top:d.top,width:d.width,height:d.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),l&&a.jsx("svg",{className:"absolute",style:{left:d.left,top:d.top,width:d.width,height:d.height,overflow:"visible"},viewBox:`0 0 ${n} ${r}`,preserveAspectRatio:"none",children:M.map((h,v)=>{if(!Et(h,t,u))return null;const y=h.domain==="pixel"?1:n,p=h.domain==="pixel"?1:r,w=h.position.minX*y,P=h.position.minY*p,m=(h.position.maxX-h.position.minX)*y,C=(h.position.maxY-h.position.minY)*p;return a.jsx("rect",{x:w,y:P,width:m,height:C,fill:"none",stroke:et(h.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},v)})}),l&&a.jsx("div",{className:"absolute",style:{left:d.left,top:d.top,width:d.width,height:d.height},children:M.map((h,v)=>{if(!Et(h,t,u))return null;const y=h.domain==="pixel"?1/n:1,p=h.domain==="pixel"?1/r:1,w=h.position.minX*y*100,P=h.position.minY*p*100,m=h.label??b[String(h.class_id)]??`#${h.class_id}`,C=h.score!=null?` ${(h.score*100).toFixed(0)}%`:"";return!m&&!C?null:a.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${w}%`,top:`${P}%`,transform:"translateY(-100%)",backgroundColor:et(h.class_id)},children:a.jsxs("span",{className:"mono",children:[m,C]})},v)})})]})}const ot=30,se=["#ff5a5a","#39d353","#5b9bff"];function it(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function K(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):it(e/255):it(n==="int"?e*255:e)}const Dn={x:0,y:0,w:1,h:1};function Ee({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:r,pan:o,sample:i,notation:c="decimal",version:u=0,onActiveChange:d,sourceWindow:f=Dn}){const x=s.useRef(null),g=s.useRef(!1),M=nt(),l=s.useRef(d);l.current=d;const b=s.useCallback(v=>{var y;v!==g.current&&(g.current=v,(y=l.current)==null||y.call(l,v))},[]),h=s.useCallback(()=>{var de;const v=x.current,y=e.current;if(!v)return;const p=window.devicePixelRatio||1,w=v.clientWidth,P=v.clientHeight;if(w===0||P===0)return;v.width!==Math.round(w*p)&&(v.width=Math.round(w*p)),v.height!==Math.round(P*p)&&(v.height=Math.round(P*p));const m=v.getContext("2d");if(!m)return;if(m.setTransform(p,0,0,p,0,0),m.clearRect(0,0,w,P),!y||t<=0||n<=0){b(!1);return}const C=y.getBoundingClientRect(),L=v.getBoundingClientRect();if(C.width===0||C.height===0){b(!1);return}const B=f.x*t,V=f.y*n,H=f.w*t,O=f.h*n;if(H<=0||O<=0){b(!1);return}const E=Math.min(C.width/H,C.height/O);if(E<ot){b(!1);return}const I=H*E,F=O*E,X=C.left+(C.width-I)/2-L.left,Z=C.top+(C.height-F)/2-L.top,te=Math.max(Math.floor(B),Math.floor(B+(0-X)/E)),ee=Math.min(Math.ceil(B+H),Math.ceil(B+(w-X)/E)),ce=Math.max(Math.floor(V),Math.floor(V+(0-Z)/E)),oe=Math.min(Math.ceil(V+O),Math.ceil(V+(P-Z)/E));if(ee<=te||oe<=ce){b(!1);return}b(!0);const ue=X+(0-B)*E,me=Z+(0-V)*E,re=X+(t-B)*E,pe=Z+(n-V)*E;m.save(),m.beginPath(),m.rect(ue,me,re-ue,pe-me),m.clip(),m.textAlign="center",m.textBaseline="middle",m.lineJoin="round";const ve=E*.14,ie=E-ve*2;for(let fe=ce;fe<oe;fe++)for(let ae=te;ae<ee;ae++){if(ae<0||fe<0||ae>=t||fe>=n)continue;const W=i(ae,fe,c);if(!W||W.lines.length===0)continue;const Y=W.lines.length;let Q=1;for(const U of W.lines)U.length>Q&&(Q=U.length);const le=ie/(Y*1.15),ne=ie/(Q*.62)||le,_=Math.min(le,ne,24);if(_<6)continue;const A=X+(ae-B+.5)*E,S=Z+(fe-V+.5)*E,T=_*1.15,k=W.luminance<=.55,G=k?"#ffffff":"#000000";m.font=`${_}px ui-monospace, SFMono-Regular, Menlo, monospace`,m.lineWidth=Math.max(1.4,_*.16),m.strokeStyle=k?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let D=S-Y*T/2+T/2;for(let U=0;U<W.lines.length;U++){const R=W.lines[U];m.strokeText(R,A,D),m.fillStyle=((de=W.colors)==null?void 0:de[U])??G,m.fillText(R,A,D),D+=T}}m.restore()},[e,t,n,i,c,b,f]);return s.useEffect(()=>{h()},[h,r,o.x,o.y,u,c,f,M]),s.useEffect(()=>{const v=x.current;if(!v)return;const y=new ResizeObserver(()=>h());return y.observe(v),()=>y.disconnect()},[h]),a.jsx("canvas",{ref:x,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function at({notation:e,onChange:t,className:n=""}){return a.jsx("button",{type:"button",onClick:r=>{r.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:r=>r.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const An=`
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
`,kn=`
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
@group(0) @binding(23) var<uniform> u_bind7: f32; // filterMode (0=nearest, 1=linear)

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

// Manual bilinear blend over EITHER source texture (texA or texB — see
// image.wgsl.ts's sampleBilinearF doc comment for the full rationale; this
// is parameterized over which texture since compare.wgsl.ts has two).
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
  // Image-space UV, UNCLAMPED — Q18 (see image.wgsl.ts's doc comment). texA
  // and texB share one uvRect/srcUV, so this is a single in/out-of-bounds
  // decision for the whole fragment.
  let rawSrcUV = uvRect.xy + uv * uvRect.zw;
  if (rawSrcUV.x < 0.0 || rawSrcUV.x >= 1.0 || rawSrcUV.y < 0.0 || rawSrcUV.y >= 1.0) {
    return vec4<f32>(0.0);
  }
  let srcUV = clamp(rawSrcUV, vec2<f32>(0.0), vec2<f32>(0.999999));
  let filterLinear = u_bind7 > 0.5;

  let dimsA = vec2<f32>(textureDimensions(t_bind0));
  var sampledA: vec4<f32>;
  if (filterLinear) {
    sampledA = sampleBilinearOf(t_bind0, srcUV, dimsA);
  } else {
    sampledA = textureLoad(t_bind0, vec2<i32>(srcUV * dimsA), 0);
  }

  let dimsB = vec2<f32>(textureDimensions(t_bind1));
  var sampledB: vec4<f32>;
  if (filterLinear) {
    sampledB = sampleBilinearOf(t_bind1, srcUV, dimsB);
  } else {
    sampledB = textureLoad(t_bind1, vec2<i32>(srcUV * dimsB), 0);
  }

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
`,Fe={linear:0,srgb:1,reinhard:2,aces:3,extended:4},_t=new WeakMap;function In(e,t){let n=_t.get(e);n||(n=new Map,_t.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:An,targetFormat:t}),n.set(t,r)),r}function Mt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Pt(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const r=e.createTexture(256,1,"rgba32float");return r.write(t),r}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function Rn(e,t,n,r){var b;const o=Mt(t),i=In(e,o),c=Pt(e,r.isScalar?r.colormap:void 0),u=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,d=Fe[r.operator]??Fe.srgb,f=new Float32Array([r.exposureEV,d,u,r.isScalar?1:0]),x=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),g=new Float32Array([r.hdrOut?1:0]),M=new Float32Array([r.filter==="nearest"?0:1]);let l;try{l=e.createBindGroup(i,[{binding:0,resource:n},{binding:1,resource:c},{binding:2,resource:{uniform:f}},{binding:3,resource:{uniform:x}},{binding:4,resource:{uniform:g}},{binding:5,resource:{uniform:M}}]),e.renderFullscreen(t,i,l)}finally{(b=l==null?void 0:l.destroy)==null||b.call(l),c.destroy()}}const On={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Ln={linear:0,signed:1,positive:2},Un={split:0,blend:1,diff:2},Tt=new WeakMap;function Gn(e,t){let n=Tt.get(e);n||(n=new Map,Tt.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:kn,targetFormat:t}),n.set(t,r)),r}function Fn(e,t,n,r,o){var p;const i=Mt(t),c=Gn(e,i),u=o.mode==="diff"&&!!o.diffColormap,d=o.isScalar?o.colormap:u?o.diffColormap:void 0,f=Pt(e,d),x=typeof o.gamma=="number"&&o.gamma>0?o.gamma:0,g=Fe[o.operator]??Fe.srgb,M=new Float32Array([o.exposureEV,g,x,o.isScalar?1:0]),l=new Float32Array([o.uv.x,o.uv.y,o.uv.w,o.uv.h]),b=new Float32Array([Un[o.mode],o.split,o.alpha,On[o.diffSubmode]??0]),h=new Float32Array([Ln[o.diffCmapMode??"linear"]??0,o.hdrOut?1:0,u?1:0,0]),v=new Float32Array([o.filter==="nearest"?0:1]);let y;try{y=e.createBindGroup(c,[{binding:0,resource:n},{binding:1,resource:r},{binding:2,resource:f},{binding:3,resource:{uniform:M}},{binding:4,resource:{uniform:l}},{binding:5,resource:{uniform:b}},{binding:6,resource:{uniform:h}},{binding:7,resource:{uniform:v}}]),e.renderFullscreen(t,c,y)}finally{(p=y==null?void 0:y.destroy)==null||p.call(y),f.destroy()}}function St(e,t,n){if(n<=0)return{mse:0,psnr:1/0,mae:0};const r=e/n,o=t/n,i=r<=0?1/0:10*Math.log10(1/r);return{mse:r,psnr:i,mae:o}}async function Bn(e,t,n){const r=Math.min(t.width,n.width),o=Math.min(t.height,n.height),i=r*o*3;if(i<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:M,sumAbs:l}=await e.reduceDiffSumSquaredAbs(t,n,r,o);return St(M,l,i)}const c=await e.readback(t),u=await e.readback(n),d=c instanceof Uint8Array,f=u instanceof Uint8Array;let x=0,g=0;for(let M=0;M<o;M++)for(let l=0;l<r;l++){const b=(M*t.width+l)*4,h=(M*n.width+l)*4;for(let v=0;v<3;v++){const y=(c[b+v]??0)/(d?255:1),p=(u[h+v]??0)/(f?255:1),w=y-p;x+=w*w,g+=Math.abs(w)}}return St(x,g,i)}function Ct(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const Nn=12,Pe=[];function Dt(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1),Pe.push(e)}function Vn(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1)}function Be(e){e.parked||(Vn(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.parked=!0)}function At(e){for(;Pe.length>Nn;){const t=Pe.find(n=>n!==e&&!n.visible)??Pe.find(n=>n!==e);if(!t)break;Be(t)}}function kt(e){var o,i;if(e.disposed)return;if(Ct())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Dt(e),At(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const n=e.backingWidth||((o=e.source)==null?void 0:o.width)||1,r=e.backingHeight||((i=e.source)==null?void 0:i.height)||1;if(e.canvas.width=n,e.canvas.height=r,e.surface.configure(n,r),e.source){const c=t.createTexture(e.source.width,e.source.height,e.source.format);c.write(e.source.data),e.srcTexture=c}e.parked=!1,Dt(e),At(e)}function zn(e,t){if(e.disposed||!e.source)return!0;try{return kt(e),!e.surface||!e.srcTexture?!1:(Rn(e.device,e.surface,e.srcTexture,t),!0)}catch(n){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Be(e),!1}}function $n(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},resize(t,n){if(e.disposed)return;const r=Math.max(1,Math.round(t)),o=Math.max(1,Math.round(n));e.backingWidth===r&&e.backingHeight===o||(e.backingWidth=r,e.backingHeight=o,!e.parked&&e.surface&&(e.canvas.width=r,e.canvas.height=o,e.surface.configure(r,o)))},render(t){return zn(e,t)},park(){e.disposed||Be(e)},restore(){e.disposed||!e.source||kt(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Be(e),e.source=null,e.disposed=!0)}}}async function Wn(e,t){const n=await Ue(),r={canvas:e,device:n,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return $n(r)}function It(e){e.dispose()}function Xn(e,t){const{brightness:n,contrast:r,exposure:o,flipSign:i}=e;return[`url(#${t})`,`brightness(${(1+n)*Math.pow(2,o)})`,`contrast(${1+r})`,...i?["invert(1)"]:[]].join(" ")}function Rt(e){const n=`cairn-gamma-${s.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:r,contrast:o,gamma:i,exposure:c,offset:u,flipSign:d}=e,f=s.useMemo(()=>Xn(e,n),[n,r,o,c,d]);return{gammaFilterId:n,filterStr:f,gamma:i,offset:u}}function Ot({id:e,gamma:t,offset:n}){return a.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:a.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:a.jsxs("feComponentTransfer",{children:[a.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),a.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),a.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:n})]})})})}const Hn={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function Lt({imageUrl:e,baselineUrl:t,isBaseline:n=!1,diffMode:r,interpolation:o,colormap:i,showAxes:c,processing:u=Hn,zoom:d=1,pan:f={x:0,y:0},onViewportChange:x,onNaturalSize:g,label:M,isDraggable:l=!1,onDragStart:b,overlay:h,overlaySettings:v,pixelValueNotation:y="decimal"}){var k,G;const p=s.useRef(null),w=s.useRef(null),P=s.useRef(null),m=s.useRef(null),C=s.useRef(null),L=s.useRef(null),B=s.useRef(null),[V,H]=s.useState(0),O=s.useCallback(()=>H(D=>D+1),[]),[E,I]=s.useState(y),[F,X]=s.useState(!1),Z=s.useCallback(D=>{p.current=D,D&&(C.current=D)},[]),te=s.useCallback(D=>{w.current=D,D&&(C.current=D)},[]),ee=s.useCallback(D=>{D&&(C.current=D)},[]),[ce,oe]=s.useState(!1),[ue,me]=s.useState(!1),[re,pe]=s.useState(null),{flipSign:ve}=u,{gammaFilterId:ie,filterStr:de,gamma:fe,offset:ae}=Rt(u),W=`translate(${f.x}px, ${f.y}px) scale(${d})`,{containerProps:Y}=Ie({containerRef:m,zoom:d,pan:f,onViewportChange:x}),Q=!n&&r!=="none"&&t!=null&&e!=null,le=r!=="none"&&t!=null,ne=i!=="none"&&!Q&&!(n&&le)&&e!=null;s.useEffect(()=>{if(!ne||!e){me(!1);return}let D=!1;me(!1);const U=`${e}::${i}`,R=He(U);if(R){const N=w.current;if(N){N.width=R.width,N.height=R.height;const q=N.getContext("2d");q&&q.putImageData(R,0,0),B.current=R,O(),pe({w:R.width,h:R.height}),g==null||g(R.width,R.height),me(!0)}return}const z=new Image;return z.onload=()=>{if(D)return;const N=document.createElement("canvas");N.width=z.naturalWidth,N.height=z.naturalHeight;const q=N.getContext("2d");if(!q)return;q.drawImage(z,0,0);const be=q.getImageData(0,0,N.width,N.height),we=ft.has(i)?"positive":"linear",J=Xe(be,i,we);Ye(U,J);const xe=w.current;if(!xe||D)return;xe.width=J.width,xe.height=J.height;const he=xe.getContext("2d");he&&he.putImageData(J,0,0),B.current=J,O(),pe({w:J.width,h:J.height}),g==null||g(J.width,J.height),me(!0)},z.src=e,()=>{D=!0}},[ne,e,i]);const _=s.useCallback((D,U)=>{pe(R=>R&&R.w===D&&R.h===U?R:{w:D,h:U}),g==null||g(D,U)},[]);s.useEffect(()=>{if(!e){L.current=null,B.current=null,O();return}let D=!1;return De(e).then(U=>{D||(L.current=U,i==="none"&&(B.current=U),O())}),()=>{D=!0}},[e,i,O]);const A=s.useCallback((D,U,R)=>{const z=L.current;if(!z||D<0||U<0||D>=z.width||U>=z.height)return null;const N=(U*z.width+D)*4,q=z.data[N],be=z.data[N+1],we=z.data[N+2],J=B.current;let xe=q,he=be,_e=we;if(J&&J.width===z.width&&J.height===z.height){const ke=(U*J.width+D)*4;xe=J.data[ke],he=J.data[ke+1],_e=J.data[ke+2]}const Re=(.299*xe+.587*he+.114*_e)/255;return i!=="none"||q===be&&be===we?{lines:[K(q,"uint8",R)],luminance:Re}:{lines:[K(q,"uint8",R),K(be,"uint8",R),K(we,"uint8",R)],luminance:Re,colors:[se[0],se[1],se[2]]}},[i]);s.useEffect(()=>{if(!Q){oe(!1);return}let D=!1;const U=yn(),R=U==="gpu"||U==="auto",z=`${t}::${e}::${r}::${i}`;if(U!=="gpu"){const N=He(z);if(N){const q=p.current;if(q){(q.width!==N.width||q.height!==N.height)&&(q.width=N.width,q.height=N.height);const be=q.getContext("2d");be&&be.putImageData(N,0,0),_(N.width,N.height),oe(!0)}return}}return(async()=>{const[N,q]=await Promise.all([De(t),De(e)]);if(D||!N||!q)return;const we=r.includes("signed")?"signed":"positive",J=i!=="none"?We(i):null,xe={diffMode:r,colormap:J,cmapMode:we};if(R)try{const Oe=p.current;if(Oe){const ke=wn(N,q,xe,Oe);if(ke){if(D)return;_(ke.width,ke.height),oe(!0);return}}}catch(Oe){console.warn("[cairn] WebGL 2 diff error:",Oe)}if(U==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let he=fn(N,q,r);i!=="none"&&(he=Xe(he,i,we)),Ye(z,he);const _e=p.current;if(!_e||D)return;(_e.width!==he.width||_e.height!==he.height)&&(_e.width=he.width,_e.height=he.height);const Re=_e.getContext("2d");Re&&Re.putImageData(he,0,0),_(he.width,he.height),oe(!0)})(),()=>{D=!0}},[t,e,r,Q,i,g]);const S=o==="auto"?void 0:o,T=ve?{filter:"invert(1)"}:{};return a.jsxs("div",{className:"relative flex flex-col h-full",children:[a.jsx(Ot,{id:ie,gamma:fe,offset:ae}),a.jsxs("div",{ref:m,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:c&&re?"16px 4px 4px 28px":"4px",...Y.style},onPointerDown:Y.onPointerDown,onPointerMove:Y.onPointerMove,onPointerUp:Y.onPointerUp,onPointerCancel:Y.onPointerCancel,children:[a.jsxs("div",{ref:P,className:"relative w-full h-full",style:{transform:W,transformOrigin:"0 0"},children:[e?Q?a.jsxs(a.Fragment,{children:[!ce&&a.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),a.jsx("canvas",{ref:Z,className:"w-full h-full object-contain block",style:{display:ce?"block":"none",imageRendering:S,...T}})]}):ne?a.jsxs(a.Fragment,{children:[!ue&&a.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),a.jsx("canvas",{ref:te,className:"w-full h-full object-contain block",style:{display:ue?"block":"none",imageRendering:S,...T}})]}):a.jsx("img",{ref:ee,src:e,alt:M,className:"w-full h-full object-contain block",draggable:!1,style:{filter:de,imageRendering:S},onLoad:D=>{const U=D.currentTarget;pe({w:U.naturalWidth,h:U.naturalHeight}),g==null||g(U.naturalWidth,U.naturalHeight)}}):a.jsx("span",{className:"text-xs text-fg-muted",children:"no image"}),c&&re&&a.jsx(Qe,{naturalWidth:re.w,naturalHeight:re.h,zoom:d,containerRef:P}),h&&(v==null?void 0:v.enabled)&&re&&e&&((((k=h.boxes)==null?void 0:k.length)??0)>0||(((G=h.masks)==null?void 0:G.length)??0)>0)&&a.jsx(rt,{data:h,settings:v,naturalWidth:re.w,naturalHeight:re.h})]}),e&&re&&a.jsx(Ee,{imageElRef:C,naturalWidth:re.w,naturalHeight:re.h,zoom:d,pan:f,sample:A,notation:E,version:V,onActiveChange:X}),F&&a.jsx(at,{notation:E,onChange:I})]}),a.jsx(Je,{label:M,isDraggable:l,onDragStart:b})]})}function Yn(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`HdrImagePane: unsupported shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}const Te=e=>Number.isFinite(e)?e:0;function qn(e,t,n,r){const{h:o,w:i,c}=Yn(e.shape),u=e.data,d=_n(t),f=new Uint8ClampedArray(i*o*4);for(let x=0;x<i*o;x++){const g=x*c;let M,l,b,h=1;c===1?M=l=b=Te(u[g]):c===3?(M=Te(u[g]),l=Te(u[g+1]),b=Te(u[g+2])):(M=Te(u[g]),l=Te(u[g+1]),b=Te(u[g+2]),h=Te(u[g+3]));const v=[je(M,n),je(l,n),je(b,n)],[y,p,w]=d(v),P=x*4;f[P]=255*Ke(y,r),f[P+1]=255*Ke(p,r),f[P+2]=255*Ke(w,r),f[P+3]=255*(h<0?0:h>1?1:h)}return new ImageData(f,i,o)}function Zn({hdr:e,tonemap:t="srgb",exposure:n=0,gamma:r,showAxes:o=!1,label:i="",interpolation:c="auto",zoom:u=1,pan:d={x:0,y:0},onViewportChange:f,pixelValueNotation:x="decimal"}){const g=s.useRef(null),M=s.useRef(null),l=s.useRef(null),[b,h]=s.useState(null),v=s.useRef(null),[y,p]=s.useState(0),[w,P]=s.useState(x),[m,C]=s.useState(!1);s.useEffect(()=>{const O=g.current;if(!O)return;let E;try{E=qn(e,t,n,r)}catch(F){console.error("[cairn] HDR tone-map error:",F);return}(O.width!==E.width||O.height!==E.height)&&(O.width=E.width,O.height=E.height);const I=O.getContext("2d");I&&(I.putImageData(E,0,0),v.current=E,p(F=>F+1),h(F=>F&&F.w===E.width&&F.h===E.height?F:{w:E.width,h:E.height}))},[e,t,n,r]);const{containerProps:L}=Ie({containerRef:l,zoom:u,pan:d,onViewportChange:f}),B=s.useCallback((O,E,I)=>{const F=b;if(!F||O<0||E<0||O>=F.w||E>=F.h)return null;const X=e.shape.length===2?1:e.shape[2]??1,Z=(E*F.w+O)*X,te=e.data,ee=v.current;let ce=.5;if(ee&&ee.width===F.w&&ee.height===F.h){const oe=(E*F.w+O)*4;ce=(.299*ee.data[oe]+.587*ee.data[oe+1]+.114*ee.data[oe+2])/255}return X===1?{lines:[K(te[Z]??0,"unit",I)],luminance:ce}:{lines:[K(te[Z]??0,"unit",I),K(te[Z+1]??0,"unit",I),K(te[Z+2]??0,"unit",I)],luminance:ce,colors:[se[0],se[1],se[2]]}},[e,b]),V=c==="auto"?void 0:c,H=`translate(${d.x}px, ${d.y}px) scale(${u})`;return a.jsxs("div",{className:"relative flex flex-col h-full",children:[a.jsxs("div",{ref:l,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:o&&b?"16px 4px 4px 28px":"4px",...L.style},onPointerDown:L.onPointerDown,onPointerMove:L.onPointerMove,onPointerUp:L.onPointerUp,onPointerCancel:L.onPointerCancel,children:[a.jsxs("div",{ref:M,className:"relative w-full h-full",style:{transform:H,transformOrigin:"0 0"},children:[a.jsx("canvas",{ref:g,className:"w-full h-full object-contain block",style:{imageRendering:V}}),o&&b&&a.jsx(Qe,{naturalWidth:b.w,naturalHeight:b.h,zoom:u,containerRef:M})]}),b&&a.jsx(Ee,{imageElRef:g,naturalWidth:b.w,naturalHeight:b.h,zoom:u,pan:d,sample:B,notation:w,version:y,onActiveChange:C}),m&&a.jsx(at,{notation:w,onChange:P})]}),i?a.jsx(Je,{label:i}):null]})}const jn=["fill","fill-opacity","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-linecap","stroke-linejoin","opacity","color","font","font-family","font-size","font-weight","font-style","text-anchor","dominant-baseline","visibility","display"];function Ut(e,t){const n=getComputedStyle(e),r=jn.map(d=>`${d}:${n.getPropertyValue(d)}`).join(";"),o=t.getAttribute("style");t.setAttribute("style",o?`${o};${r}`:r);const i=e.children,c=t.children,u=Math.min(i.length,c.length);for(let d=0;d<u;d++)Ut(i[d],c[d])}function Gt(e){let t=e;for(;t;){const n=getComputedStyle(t).backgroundColor;if(n&&n!=="transparent"&&!n.startsWith("rgba(0, 0, 0, 0)"))return n;t=t.parentElement}return"#ffffff"}function Ft(e){const t=(e==null?void 0:e.scale)??(typeof window<"u"&&window.devicePixelRatio||1);return Math.min(Math.max(t,1),3)}async function Bt(e,t,n,r,o){const i=document.createElement("canvas");i.width=Math.max(1,Math.round(e*n)),i.height=Math.max(1,Math.round(t*n));const c=i.getContext("2d");if(!c)throw new Error("plot-to-png: 2D canvas context unavailable");return c.scale(n,n),r&&(c.fillStyle=r,c.fillRect(0,0,e,t)),o(c),await new Promise((u,d)=>i.toBlob(f=>f?u(f):d(new Error("plot-to-png: toBlob returned null")),"image/png"))}function Kn(e,t,n){const r=e.cloneNode(!0);Ut(e,r),r.setAttribute("width",String(t)),r.setAttribute("height",String(n)),r.setAttribute("xmlns","http://www.w3.org/2000/svg");const o=new XMLSerializer().serializeToString(r),i="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(o);return new Promise((c,u)=>{const d=new Image;d.onload=()=>c(d),d.onerror=()=>u(new Error("plot-to-png: SVG rasterization failed")),d.src=i})}async function Nt(e,t){const n=e.getBoundingClientRect(),r=n.width||e.width,o=n.height||e.height,i=(t==null?void 0:t.background)??Gt(e);return Bt(r,o,Ft(t),i,c=>c.drawImage(e,0,0,r,o))}async function Qn(e,t){const n=e.querySelector("svg"),r=Array.from(e.querySelectorAll("canvas")),o=e.getBoundingClientRect(),i=o.width||300,c=o.height||150,u=(t==null?void 0:t.background)??Gt(e);if(n){const d=n.getBoundingClientRect(),f=await Kn(n,d.width||i,d.height||c);return Bt(i,c,Ft(t),u,x=>{for(const g of r){const M=g.getBoundingClientRect();x.drawImage(g,M.left-o.left,M.top-o.top,M.width,M.height)}x.drawImage(f,d.left-o.left,d.top-o.top,d.width,d.height)})}if(r.length)return Nt(r[0],t);throw new Error("plot-to-png: no <svg> or <canvas> found under root")}function Jn(e,t){const n=URL.createObjectURL(e),r=document.createElement("a");r.href=n,r.download=t.endsWith(".png")?t:`${t}.png`,document.body.appendChild(r),r.click(),r.remove(),setTimeout(()=>URL.revokeObjectURL(n),1e3)}const er={"top-right":{top:6,right:6},"top-left":{top:6,left:6},"bottom-right":{bottom:6,right:6},"bottom-left":{bottom:6,left:6}},tr={boxZoom:a.jsx("rect",{x:"3.5",y:"3.5",width:"17",height:"17",rx:"1.5",strokeDasharray:"4 3"}),pan:a.jsxs(a.Fragment,{children:[a.jsx("path",{d:"M12 2v20M2 12h20"}),a.jsx("path",{d:"M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"})]}),zoomIn:a.jsxs(a.Fragment,{children:[a.jsx("circle",{cx:"10.5",cy:"10.5",r:"7"}),a.jsx("path",{d:"M21 21l-5.2-5.2M10.5 7.5v6M7.5 10.5h6"})]}),zoomOut:a.jsxs(a.Fragment,{children:[a.jsx("circle",{cx:"10.5",cy:"10.5",r:"7"}),a.jsx("path",{d:"M21 21l-5.2-5.2M7.5 10.5h6"})]}),autoscale:a.jsx("path",{d:"M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"}),home:a.jsx("path",{d:"M3 11l9-8 9 8M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5M9.5 21v-6h5v6"}),camera:a.jsxs(a.Fragment,{children:[a.jsx("path",{d:"M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"}),a.jsx("circle",{cx:"12",cy:"13.5",r:"3.3"})]})};function nr({name:e}){return a.jsx("svg",{viewBox:"0 0 24 24",width:"13",height:"13",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:tr[e]??null})}function Se({icon:e,label:t,title:n,active:r,disabled:o,onClick:i}){return a.jsx("button",{type:"button",disabled:o,onClick:c=>{c.stopPropagation(),!o&&i()},onPointerDown:c=>c.stopPropagation(),onDoubleClick:c=>c.stopPropagation(),"aria-label":n,"aria-pressed":r,"aria-disabled":o,title:n,className:["h-[22px] min-w-[22px] inline-flex items-center justify-center rounded",t?"px-1.5 text-[10px] font-mono":"text-xs",o?"opacity-40 cursor-default text-fg-muted":r?"bg-bg-hover text-accent":"text-fg-muted hover:text-fg hover:bg-bg-hover"].join(" "),children:t?a.jsx("span",{"aria-hidden":"true",children:t}):a.jsx(nr,{name:e??""})})}function Ne(){return a.jsx("span",{"aria-hidden":"true",className:"mx-0.5 h-3.5 w-px bg-border"})}function Vt({controller:e,config:t}){if((t==null?void 0:t.enabled)===!1)return null;const n=e.capabilities,r=t==null?void 0:t.buttons,o=(l,b)=>b&&(r==null?void 0:r[l])!==!1,i=l=>()=>e.setDragMode(l),c=o("zoom",n.zoom)||o("pan",n.pan),u=o("zoomIn",n.zoom)||o("zoomOut",n.zoom),d=o("autoscale",n.autoscale)||o("reset",n.reset),f=o("screenshot",n.screenshot),x=(t==null?void 0:t.leadingButtons)??[];if(!x.length&&!c&&!u&&!d&&!f)return null;const g=(t==null?void 0:t.position)??"top-right",M=(t==null?void 0:t.visibility)==="always";return a.jsxs("div",{style:{position:"absolute",pointerEvents:"auto",...er[g]},className:["z-20 flex items-center gap-0.5 rounded border border-border","bg-bg-elevated/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-opacity",M?"opacity-100":"opacity-0 group-hover:opacity-100"].join(" "),role:"toolbar","aria-label":"Plot controls",children:[x.length>0&&a.jsxs(a.Fragment,{children:[x.map(l=>a.jsx(Se,{icon:l.icon,label:l.label,title:l.title,active:l.active,disabled:l.disabled,onClick:l.onClick},l.id)),(c||u||d||f)&&a.jsx(Ne,{})]}),c&&a.jsxs(a.Fragment,{children:[o("zoom",n.zoom)&&a.jsx(Se,{icon:"boxZoom",title:"Box zoom",active:e.dragMode==="zoom",onClick:i("zoom")}),o("pan",n.pan)&&a.jsx(Se,{icon:"pan",title:"Pan",active:e.dragMode==="pan",onClick:i("pan")})]}),u&&a.jsxs(a.Fragment,{children:[c&&a.jsx(Ne,{}),o("zoomIn",n.zoom)&&a.jsx(Se,{icon:"zoomIn",title:"Zoom in",onClick:()=>e.zoomIn()}),o("zoomOut",n.zoom)&&a.jsx(Se,{icon:"zoomOut",title:"Zoom out",onClick:()=>e.zoomOut()})]}),d&&a.jsxs(a.Fragment,{children:[(c||u)&&a.jsx(Ne,{}),o("autoscale",n.autoscale)&&a.jsx(Se,{icon:"autoscale",title:"Autoscale",onClick:()=>e.autoscale()}),o("reset",n.reset)&&a.jsx(Se,{icon:"home",title:e.isModified?"Reset view":"Reset view (at home)",disabled:!e.isModified,onClick:()=>e.reset()})]}),f&&a.jsxs(a.Fragment,{children:[(c||u||d)&&a.jsx(Ne,{}),a.jsx(Se,{icon:"camera",title:"Download plot as PNG",onClick:()=>{e.toPNG({filename:"plot"}).then(l=>Jn(l,"plot.png")).catch(()=>{})}})]})]})}const rr={zoom:1,pan:{x:0,y:0}},zt=1.3,or=.25,ir=64,$t={buttons:{zoom:!1}};function Wt(e,t){return{id:"notation",label:e==="int"?"0–255":"0–1",title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",onClick:()=>t(e==="int"?"decimal":"int")}}function Xt({rootRef:e,canvasRef:t,zoom:n,pan:r,onViewportChange:o,naturalWidth:i,naturalHeight:c,minZoom:u=or,maxZoom:d=ir,requestRender:f}){const x=s.useCallback(P=>{var F;if(!o)return;const m=(F=e.current)==null?void 0:F.getBoundingClientRect(),C=(m==null?void 0:m.width)??0,L=(m==null?void 0:m.height)??0,B=i&&c&&C>0&&L>0?yt(i,c,C,L):d,V=Math.max(u,Math.min(B,n*P));if(V===n)return;const H=C/2,O=L/2,E=H-(H-r.x)/n*V,I=O-(O-r.y)/n*V;o({zoom:V,pan:{x:E,y:I}})},[o,e,i,c,d,u,n,r.x,r.y]),g=s.useCallback(()=>x(zt),[x]),M=s.useCallback(()=>x(1/zt),[x]),l=s.useCallback(()=>o==null?void 0:o(rr),[o]),b=s.useCallback(P=>{const m={scale:P==null?void 0:P.scale,filename:P==null?void 0:P.filename};f==null||f();const C=t==null?void 0:t.current;if(C)return Nt(C,m);const L=e.current;return L?Qn(L,m):Promise.reject(new Error("useImageController.toPNG: no canvas or root element to export"))},[t,e,f]),h=s.useMemo(()=>({zoom:!0,pan:!0,autoscale:!0,reset:!0,screenshot:!0,boxZoom:!1,select:!1,lasso:!1,hover:!1,spikelines:!1,hoverModes:!1,legend:!1,axisScaleToggle:!1,perAxisDrag:!1,brush:!1,reorder:!1}),[]),v=n!==1||r.x!==0||r.y!==0,y=s.useCallback(P=>{},[]),p=s.useCallback(P=>{},[]),w=s.useCallback(()=>{},[]);return s.useMemo(()=>({capabilities:h,dragMode:"pan",hoverMode:"closest",spikelines:!1,isModified:v,setDragMode:y,setHoverMode:p,toggleSpikelines:w,zoomIn:g,zoomOut:M,autoscale:l,reset:l,toPNG:b}),[h,v,y,p,w,g,M,l,b])}function ar(e){return"hdr"in e&&e.hdr!=null}const sr=["linear","srgb","reinhard","aces"];function cr(e){return e&&sr.includes(e)?e:"srgb"}const Ce=e=>Number.isFinite(e)?e:0;function lr(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function ur(e){const{h:t,w:n,c:r}=lr(e.shape),o=e.data,i=new Float32Array(n*t*4);for(let c=0;c<n*t;c++){const u=c*r;let d,f,x,g=1;r===1?d=f=x=Ce(o[u]):r===3?(d=Ce(o[u]),f=Ce(o[u+1]),x=Ce(o[u+2])):(d=Ce(o[u]),f=Ce(o[u+1]),x=Ce(o[u+2]),g=Ce(o[u+3]));const M=c*4;i[M]=d,i[M+1]=f,i[M+2]=x,i[M+3]=g}return{data:i,width:n,height:t,format:"rgba32float"}}function Ht(e,t,n,r){if(n<=0||r<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const o=Math.min(t.width/n,t.height/r),i=n*o,c=r*o,u=(t.width-i)/2,d=(t.height-c)/2,f=Math.max(e.zoom,1e-6),x=t.width/(f*i),g=t.height/(f*c),M=-u/i-e.pan.x/(f*i),l=-d/c-e.pan.y/(f*c);return{x:M,y:l,w:x,h:g}}function Yt(e,t,n,r){const o=e.w*n,i=e.h*r;return o<=0||i<=0||t.width<=0||t.height<=0?0:Math.min(t.width/o,t.height/i)}const dr={zoom:1,pan:{x:0,y:0}};function fr(e){var le,ne;const t=ar(e),n=s.useRef(null),r=s.useRef(null),o=s.useRef(null),i=s.useRef(null),c=s.useRef(!1),[u,d]=s.useState(!1),[f,x]=s.useState(!1),[g,M]=s.useState(null),[l,b]=s.useState(0),[h,v]=s.useState(0),[y,p]=s.useState({x:0,y:0,w:1,h:1}),w=s.useRef(null),P=s.useRef(null),[m,C]=s.useState(0),[L,B]=s.useState(e.pixelValueNotation??"decimal"),[V,H]=s.useState(!1),O=e.zoom??1,E=e.pan??{x:0,y:0},I=e.onViewportChange,F=t?"none":e.colormap??"none",X=nt();s.useEffect(()=>{const _=n.current;if(!_)return;let A=!1;return Ue().then(S=>{if(A)return;const T=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,k=S.capabilities.hdr&&T&&t;c.current=k,Wn(_,{hdr:k}).then(G=>{if(A){It(G);return}i.current=G,x(!0)}).catch(G=>{A||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",G),d(!0))})}).catch(S=>{A||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",S),d(!0))}),()=>{A=!0,i.current&&(It(i.current),i.current=null)}},[]);const{containerProps:Z}=Ie({containerRef:r,zoom:O,pan:E,onViewportChange:I,naturalWidth:g==null?void 0:g.w,naturalHeight:g==null?void 0:g.h}),te=s.useCallback(()=>{I==null||I(dr)},[I]);s.useEffect(()=>{const _=r.current;if(!_)return;const A=new ResizeObserver(()=>v(S=>S+1));return A.observe(_),()=>A.disconnect()},[]),s.useEffect(()=>{const _=r.current;if(!_)return;const A=new IntersectionObserver(S=>{const T=S[0];if(!T)return;const k=i.current;k&&(k.setVisible(T.isIntersecting),T.isIntersecting?k.isParked&&(k.restore(),v(G=>G+1)):k.park())},{threshold:0});return A.observe(_),()=>A.disconnect()},[]),s.useEffect(()=>{var S;if(!t||!f)return;const _=e.hdr;w.current=_;const A=ur(_);(S=i.current)==null||S.setSource(A),M(T=>T&&T.w===A.width&&T.h===A.height?T:{w:A.width,h:A.height}),C(T=>T+1),b(T=>T+1)},[t,f,t?e.hdr:null]),s.useEffect(()=>{if(t||!f)return;const _=e,A=_.imageUrl,S=_.colormap??"none";if(!A){P.current=null,M(null),C(k=>k+1);return}let T=!1;return De(A).then(k=>{var U,R;if(T||!k)return;let G=k;if(S!=="none"){const z=`gpu::${A}::${S}`,N=He(z);if(N)G=N;else{const q=ft.has(S)?"positive":"linear";G=Xe(k,S,q),Ye(z,G)}}P.current=k;const D={data:G.data,width:G.width,height:G.height,format:"rgba8unorm"};(U=i.current)==null||U.setSource(D),M(z=>z&&z.w===G.width&&z.h===G.height?z:{w:G.width,h:G.height}),(R=_.onNaturalSize)==null||R.call(_,G.width,G.height),C(z=>z+1),b(z=>z+1)}),()=>{T=!0}},[t,f,t?null:e.imageUrl,t?null:e.colormap]);const ee=t?e.exposure??0:0,ce=t?e.tonemap:void 0,oe=t?e.gamma:void 0,ue=s.useCallback(()=>{const _=i.current;if(!_||!f||!g)return;const A=r.current,S=o.current,T=S?S.getBoundingClientRect():A?A.getBoundingClientRect():{width:g.w,height:g.h},k=Ht({zoom:O,pan:E},T,g.w,g.h);p(R=>R.x===k.x&&R.y===k.y&&R.w===k.w&&R.h===k.h?R:k),T.width>0&&T.height>0&&_.resize(Math.round(T.width*X),Math.round(T.height*X));const G=Yt(k,T,g.w,g.h)>=ot?"nearest":"linear",D=k,U=t?{exposureEV:ee,operator:c.current?"extended":cr(ce),gamma:oe,isScalar:!1,hdrOut:c.current,uv:D,filter:G}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:D,filter:G};try{_.render(U)||d(!0)}catch(R){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",R),d(!0)}},[f,g,O,E.x,E.y,ee,ce,oe,t,X]);s.useEffect(()=>{ue()},[ue,l,h]);const me=Xt({rootRef:r,canvasRef:n,zoom:O,pan:E,onViewportChange:I,naturalWidth:g==null?void 0:g.w,naturalHeight:g==null?void 0:g.h,requestRender:ue}),re=s.useMemo(()=>({...$t,leadingButtons:V?[Wt(L,B)]:[]}),[V,L]),pe=s.useCallback((_,A,S)=>{if(t){const N=w.current,q=g;if(!N||!q||_<0||A<0||_>=q.w||A>=q.h)return null;const be=N.shape.length===2?1:N.shape[2]??1,we=(A*q.w+_)*be,J=N.data,xe=.5;return be===1?{lines:[K(J[we]??0,"unit",S)],luminance:xe}:{lines:[K(J[we]??0,"unit",S),K(J[we+1]??0,"unit",S),K(J[we+2]??0,"unit",S)],luminance:xe,colors:[se[0],se[1],se[2]]}}const T=P.current;if(!T||_<0||A<0||_>=T.width||A>=T.height)return null;const k=(A*T.width+_)*4,G=T.data[k],D=T.data[k+1],U=T.data[k+2],R=(.299*G+.587*D+.114*U)/255;return F!=="none"||G===D&&D===U?{lines:[K(G,"uint8",S)],luminance:R}:{lines:[K(G,"uint8",S),K(D,"uint8",S),K(U,"uint8",S)],luminance:R,colors:[se[0],se[1],se[2]]}},[t,g,F]),ve=e.showAxes??!1,ie=t?e.label??"":e.label,de=e.interpolation??"auto",fe=de==="auto"?void 0:de,ae=t?void 0:e.overlay,W=t?void 0:e.overlaySettings,Y=t?!1:e.isDraggable??!1,Q=t?void 0:e.onDragStart;return u?t?a.jsx(Zn,{hdr:e.hdr,tonemap:e.tonemap,exposure:e.exposure,gamma:e.gamma,showAxes:ve,label:ie,interpolation:de,zoom:e.zoom,pan:e.pan,onViewportChange:I,pixelValueNotation:e.pixelValueNotation}):a.jsx(Lt,{imageUrl:e.imageUrl,baselineUrl:e.baselineUrl??null,isBaseline:e.isBaseline,diffMode:e.diffMode??"none",interpolation:de,colormap:F,showAxes:ve,processing:e.processing,zoom:e.zoom,pan:e.pan,onViewportChange:I,onNaturalSize:e.onNaturalSize,label:ie,isDraggable:Y,onDragStart:Q,className:e.className,overlay:ae,overlaySettings:W,pixelValueNotation:e.pixelValueNotation}):a.jsxs("div",{className:"group relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":f,children:[a.jsx(Vt,{controller:me,config:re}),a.jsxs("div",{ref:r,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded",style:{padding:ve&&g?"16px 4px 4px 28px":0,...Z.style},onPointerDown:Z.onPointerDown,onPointerMove:Z.onPointerMove,onPointerUp:Z.onPointerUp,onPointerCancel:Z.onPointerCancel,onDoubleClick:te,"data-gpu-image-viewport":!0,children:[a.jsxs("div",{ref:o,className:"relative w-full h-full flex items-center justify-center cairn-checkerboard",children:[a.jsx("canvas",{ref:n,className:"w-full h-full block",style:{imageRendering:fe},"data-gpu-image-canvas":!0}),ve&&g&&a.jsx(Qe,{naturalWidth:g.w,naturalHeight:g.h,zoom:O,containerRef:o}),ae&&(W==null?void 0:W.enabled)&&g&&((((le=ae.boxes)==null?void 0:le.length)??0)>0||(((ne=ae.masks)==null?void 0:ne.length)??0)>0)&&a.jsx(rt,{data:ae,settings:W,naturalWidth:g.w,naturalHeight:g.h})]}),g&&a.jsx(Ee,{imageElRef:n,naturalWidth:g.w,naturalHeight:g.h,zoom:O,pan:E,sourceWindow:y,sample:pe,notation:L,version:m,onActiveChange:H})]}),ie?a.jsx(Je,{label:ie,isDraggable:Y,onDragStart:Q}):null]})}const hr={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function gr({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:o,onSplitPositionChange:i,zoom:c,pan:u,onViewportChange:d,processing:f=hr,interpolation:x="auto",label:g="",isDraggable:M=!1,onDragStart:l,overlay:b,overlaySettings:h,pixelValueNotation:v="decimal"}){var fe,ae;const y=s.useRef(null),[p,w]=s.useState(null),[P,m]=s.useState(null),[C,L]=s.useState(v),[B,V]=s.useState(!1),H=s.useRef(null),O=s.useRef(null),E=s.useRef(null),I=s.useRef(null),[F,X]=s.useState(0);s.useEffect(()=>{if(!e){E.current=null,X(Y=>Y+1);return}let W=!1;return De(e).then(Y=>{W||(E.current=Y,X(Q=>Q+1))}),()=>{W=!0}},[e]),s.useEffect(()=>{if(!t){I.current=null,X(Y=>Y+1);return}let W=!1;return De(t).then(Y=>{W||(I.current=Y,X(Q=>Q+1))}),()=>{W=!0}},[t]);const Z=W=>(Y,Q,le)=>{const ne=W.current;if(!ne||Y<0||Q<0||Y>=ne.width||Q>=ne.height)return null;const _=(Q*ne.width+Y)*4,A=ne.data[_],S=ne.data[_+1],T=ne.data[_+2],k=(.299*A+.587*S+.114*T)/255;return A===S&&S===T?{lines:[K(A,"uint8",le)],luminance:k}:{lines:[K(A,"uint8",le),K(S,"uint8",le),K(T,"uint8",le)],luminance:k,colors:[se[0],se[1],se[2]]}},te=s.useMemo(()=>Z(E),[]),ee=s.useMemo(()=>Z(I),[]),ce=!!b&&!!(h!=null&&h.enabled)&&!!p&&!!e&&((((fe=b.boxes)==null?void 0:fe.length)??0)>0||(((ae=b.masks)==null?void 0:ae.length)??0)>0),{gammaFilterId:oe,filterStr:ue,gamma:me,offset:re}=Rt(f),pe=`translate(${u.x}px, ${u.y}px) scale(${c})`,ve=x==="auto"?void 0:x,{containerProps:ie,modifierActive:de}=Ie({containerRef:y,zoom:c,pan:u,onViewportChange:d});return a.jsxs("div",{className:"relative flex flex-col h-full",children:[a.jsx(Ot,{id:oe,gamma:me,offset:re}),a.jsxs("div",{ref:y,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...ie.style},onPointerDown:ie.onPointerDown,onPointerMove:ie.onPointerMove,onPointerUp:ie.onPointerUp,onPointerCancel:ie.onPointerCancel,children:[a.jsxs("div",{className:"relative w-full h-full",children:[a.jsxs("div",{className:"relative w-full h-full",style:{transform:pe,transformOrigin:"0 0"},children:[a.jsx("img",{ref:H,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:ue,imageRendering:ve,...n==="blend"?{opacity:o}:{}},onLoad:W=>{const Y=W.currentTarget;w({w:Y.naturalWidth,h:Y.naturalHeight})}}),ce&&a.jsx(rt,{data:b,settings:h,naturalWidth:p.w,naturalHeight:p.h})]}),a.jsx("div",{className:"absolute inset-0 overflow-hidden",style:n==="split"?{clipPath:`inset(0 ${(1-r)*100}% 0 0)`}:void 0,children:a.jsx("div",{className:"w-full h-full",style:{transform:pe,transformOrigin:"0 0"},children:a.jsx("img",{ref:O,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:ue,imageRendering:ve,...n==="blend"?{opacity:1-o}:{}},onLoad:W=>{const Y=W.currentTarget;m({w:Y.naturalWidth,h:Y.naturalHeight})}})})}),n==="split"&&a.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>i==null?void 0:i(.5),onPointerDown:W=>{W.stopPropagation(),W.preventDefault();const Q=W.currentTarget.parentElement.getBoundingClientRect(),le=_=>{i==null||i(Math.max(0,Math.min(1,(_.clientX-Q.left)/Q.width)))},ne=()=>{window.removeEventListener("pointermove",le),window.removeEventListener("pointerup",ne)};window.addEventListener("pointermove",le),window.addEventListener("pointerup",ne)},children:a.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?a.jsxs(a.Fragment,{children:[t&&P&&a.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:a.jsx(Ee,{imageElRef:O,naturalWidth:P.w,naturalHeight:P.h,zoom:c,pan:u,sample:ee,notation:C,version:F})}),e&&p&&a.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:a.jsx(Ee,{imageElRef:H,naturalWidth:p.w,naturalHeight:p.h,zoom:c,pan:u,sample:te,notation:C,version:F,onActiveChange:V})})]}):e&&p&&a.jsx(Ee,{imageElRef:H,naturalWidth:p.w,naturalHeight:p.h,zoom:c,pan:u,sample:te,notation:C,version:F,onActiveChange:V}),B&&a.jsx(at,{notation:C,onChange:L})]}),a.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),a.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${M&&!de?" cairn-drag-grip":""}`,draggable:M&&!de,onDragStart:l,style:{cursor:M&&!de?"grab":void 0},children:[a.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),g]})]})}const mr={zoom:1,pan:{x:0,y:0}};function pr(e){const t=We(e),n=new Float32Array(256*4);for(let r=0;r<256;r++)n[r*4+0]=t[r*3+0]/255,n[r*4+1]=t[r*3+1]/255,n[r*4+2]=t[r*3+2]/255,n[r*4+3]=1;return n}function vr({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:o,onSplitPositionChange:i,diffSubmode:c,colormap:u="none",zoom:d,pan:f,onViewportChange:x,interpolation:g="auto",label:M="",pixelValueNotation:l="decimal"}){const b=s.useRef(null),h=s.useRef(null),v=s.useRef(null),[y,p]=s.useState(!1),[w,P]=s.useState(!1),[m,C]=s.useState(null),[L,B]=s.useState(0),[V,H]=s.useState(0),[O,E]=s.useState(null),[I,F]=s.useState(l),[X,Z]=s.useState(!1),[te,ee]=s.useState({x:0,y:0,w:1,h:1}),ce=s.useRef(null),oe=s.useRef(null),[ue,me]=s.useState(0),re=nt();s.useEffect(()=>{const _=h.current;if(!_)return;let A=!1;return Ue().then(S=>{if(!A)try{if(Ct())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const T=S.createSurface(_,{hdr:!1});v.current={device:S,surface:T,texA:null,texB:null},P(!0)}catch(T){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",T),p(!0)}}).catch(S=>{A||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",S),p(!0))}),()=>{var T,k;A=!0;const S=v.current;S&&((T=S.texA)==null||T.destroy(),(k=S.texB)==null||k.destroy(),v.current=null)}},[]),s.useEffect(()=>{const _=b.current;if(!_)return;const A=new ResizeObserver(()=>H(S=>S+1));return A.observe(_),()=>A.disconnect()},[]),s.useEffect(()=>{if(!w)return;let _=!1;if(!v.current)return;async function S(T){return T?De(T):null}return Promise.all([S(e),S(t)]).then(([T,k])=>{var R,z;if(_||!v.current)return;const G=v.current;ce.current=T,oe.current=k,(R=G.texA)==null||R.destroy(),(z=G.texB)==null||z.destroy(),G.texA=null,G.texB=null;const D=T??k;if(!D){C(null),me(N=>N+1);return}const U=N=>{const q=G.device.createTexture(N.width,N.height,"rgba8unorm");return q.write(N.data),q};G.texA=U(k??D),G.texB=U(T??D),C({w:D.width,h:D.height}),me(N=>N+1),B(N=>N+1)}),()=>{_=!0}},[w,e,t]);const pe=s.useMemo(()=>(c??"").includes("signed")?"signed":"positive",[c]),ve=s.useMemo(()=>u!=="none"?pr(u):void 0,[u]),ie=s.useCallback(()=>{const _=v.current;if(!w||!_||!_.surface||!_.texA||!_.texB||!m)return;const A=b.current,S=A?A.getBoundingClientRect():{width:m.w,height:m.h},T=Ht({zoom:d,pan:f},S,m.w,m.h);ee(R=>R.x===T.x&&R.y===T.y&&R.w===T.w&&R.h===T.h?R:T);const k=h.current;if(S.width>0&&S.height>0&&k&&_.surface){const R=Math.max(1,Math.round(S.width*re)),z=Math.max(1,Math.round(S.height*re));(k.width!==R||k.height!==z)&&(k.width=R,k.height=z,_.surface.configure(R,z))}const G=Yt(T,S,m.w,m.h)>=ot?"nearest":"linear",U={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:T,filter:G,mode:n,split:r,alpha:o,diffSubmode:c??"absolute",diffCmapMode:pe,diffColormap:n==="diff"?ve:void 0};try{Fn(_.device,_.surface,_.texA,_.texB,U)}catch(R){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",R),p(!0)}},[w,m,d,f.x,f.y,n,r,o,c,pe,ve,re]);s.useEffect(()=>{ie()},[ie,L,V]),s.useEffect(()=>{const _=v.current;if(!w||!_||!_.texA||!_.texB||!t){E(null);return}let A=!1;return Bn(_.device,_.texA,_.texB).then(S=>{A||E(S)}),()=>{A=!0}},[w,L,t]);const de=_=>(A,S,T)=>{const k=_.current;if(!k||A<0||S<0||A>=k.width||S>=k.height)return null;const G=(S*k.width+A)*4,D=k.data[G],U=k.data[G+1],R=k.data[G+2],z=(.299*D+.587*U+.114*R)/255;return D===U&&U===R?{lines:[K(D,"uint8",T)],luminance:z}:{lines:[K(D,"uint8",T),K(U,"uint8",T),K(R,"uint8",T)],luminance:z,colors:[se[0],se[1],se[2]]}},fe=s.useMemo(()=>de(ce),[]),ae=s.useMemo(()=>de(oe),[]),{containerProps:W}=Ie({containerRef:b,zoom:d,pan:f,onViewportChange:x,naturalWidth:m==null?void 0:m.w,naturalHeight:m==null?void 0:m.h}),Y=s.useCallback(()=>x==null?void 0:x(mr),[x]),Q=g==="auto"?void 0:g,le=Xt({rootRef:b,canvasRef:h,zoom:d,pan:f,onViewportChange:x,naturalWidth:m==null?void 0:m.w,naturalHeight:m==null?void 0:m.h,requestRender:ie}),ne=s.useMemo(()=>({...$t,leadingButtons:X?[Wt(I,F)]:[]}),[X,I]);return y?n==="diff"?a.jsx(Lt,{imageUrl:e,baselineUrl:t,diffMode:c??"signed",interpolation:g,colormap:u,showAxes:!1,zoom:d,pan:f,onViewportChange:x,label:M,pixelValueNotation:l}):a.jsx(gr,{imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:o,onSplitPositionChange:i,zoom:d,pan:f,onViewportChange:x,interpolation:g,label:M,pixelValueNotation:l}):a.jsxs("div",{className:"group relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":w,children:[a.jsx(Vt,{controller:le,config:ne}),a.jsxs("div",{ref:b,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...W.style},onPointerDown:W.onPointerDown,onPointerMove:W.onPointerMove,onPointerUp:W.onPointerUp,onPointerCancel:W.onPointerCancel,onDoubleClick:Y,"data-gpu-compare-viewport":!0,children:[a.jsxs("div",{className:"relative w-full h-full flex items-center justify-center",children:[a.jsx("canvas",{ref:h,className:"w-full h-full block",style:{imageRendering:Q},"data-gpu-compare-canvas":!0}),n==="split"&&a.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:_=>{_.stopPropagation(),i==null||i(.5)},onPointerDown:_=>{_.stopPropagation(),_.preventDefault();const S=_.currentTarget.parentElement.getBoundingClientRect(),T=G=>{i==null||i(Math.max(0,Math.min(1,(G.clientX-S.left)/S.width)))},k=()=>{window.removeEventListener("pointermove",T),window.removeEventListener("pointerup",k)};window.addEventListener("pointermove",T),window.addEventListener("pointerup",k)},children:a.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?a.jsxs(a.Fragment,{children:[t&&m&&a.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:a.jsx(Ee,{imageElRef:h,naturalWidth:m.w,naturalHeight:m.h,zoom:d,pan:f,sourceWindow:te,sample:ae,notation:I,version:ue})}),t&&m&&a.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:a.jsx(Ee,{imageElRef:h,naturalWidth:m.w,naturalHeight:m.h,zoom:d,pan:f,sourceWindow:te,sample:fe,notation:I,version:ue,onActiveChange:Z})})]}):m&&a.jsx(Ee,{imageElRef:h,naturalWidth:m.w,naturalHeight:m.h,zoom:d,pan:f,sourceWindow:te,sample:fe,notation:I,version:ue,onActiveChange:Z})]}),a.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),M?a.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:M}):null,O&&a.jsxs("span",{className:"absolute right-1.5 top-9 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono","data-gpu-compare-metrics":!0,children:["MSE ",O.mse.toExponential(2)," · PSNR ",Number.isFinite(O.psnr)?O.psnr.toFixed(1):"∞"," dB · MAE"," ",O.mae.toExponential(2)]})]})}const br="cairn-plot:gpu-image-ready";async function wr(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Ue(),window.__cairnPlotGpuImagePane=fr,window.__cairnPlotGpuComparePane=vr,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(br))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}wr()})(__cairnPlotJsxRuntime,__cairnPlotReact);

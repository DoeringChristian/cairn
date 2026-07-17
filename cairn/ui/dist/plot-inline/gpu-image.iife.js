var wr=Object.defineProperty;var xr=(i,s,Me)=>s in i?wr(i,s,{enumerable:!0,configurable:!0,writable:!0,value:Me}):i[s]=Me;var j=(i,s,Me)=>xr(i,typeof s!="symbol"?s+"":s,Me);(function(i,s){"use strict";const Me=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function st(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"premultiplied",usage:Me}),{hdr:!1,format:n}}function Yt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:Me}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:Me}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return st(e,t)}}}const qt=`
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
`;function Ve(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function ct(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Zt(e){const t=(e&32768)>>15,n=(e&31744)>>10,r=e&1023;let o;return n===0?o=r/1024*Math.pow(2,-14):n===31?o=r?NaN:1/0:o=(1+r/1024)*Math.pow(2,n-15),t?-o:o}const jt={texture:0,sampler:1,uniform:2};function $e(e,t){return e*3+jt[t]}const Kt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Qt(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let r;for(;(r=n.exec(e))!==null;){const o=Number(r[1]),a=r[2]!==void 0,c=r[3].trim();if(a){const l=Kt[c];if(l===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${c}" (binding ${o}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(o,{kind:"uniform",sizeBytes:l})}else c==="sampler"||c==="sampler_comparison"?t.set(o,{kind:"sampler"}):t.set(o,{kind:"texture"})}return t}class lt{constructor(t,n,r,o){j(this,"width");j(this,"height");j(this,"format");j(this,"gpuTexture");j(this,"device");j(this,"destroyed",!1);this.device=t,this.width=n,this.height=r,this.format=o,this.gpuTexture=t.createTexture({size:{width:n,height:r,depthOrArrayLayers:1},format:Ve(o),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*ct(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class ut{constructor(t){j(this,"_s");j(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Jt{constructor(t,n,r,o,a){j(this,"_p");j(this,"gpuPipeline");j(this,"bindings");j(this,"bindGroupLayout");j(this,"variants");j(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=r,this.buildVariant=a,this.variants=new Map([[o,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function en(e,t){const n=[];for(const[r,o]of t)o.kind==="uniform"?n.push({binding:r,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):o.kind==="sampler"?n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class tn{constructor(t){j(this,"_c");j(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class nn{constructor(t,n){j(this,"_b");j(this,"gpuBindGroup");j(this,"ownedBuffers");j(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class rn{constructor(t,n,r,o){j(this,"canvas");j(this,"hdr");j(this,"format");j(this,"context");j(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=r.hdr,this.format=r.format,this.reconfigure=o}configure(t,n){this.canvas.width=t,this.canvas.height=n;const r=this.reconfigure();this.hdr=r.hdr,this.format=r.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function Ue(e){return"canvas"in e}async function on(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let r=null;function o(){return r||(r=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),r}function a(m){return Ue(m)?m.getCurrentTextureView():m.gpuTexture.createView()}function c(m){if(Ue(m))return{width:m.canvas.width,height:m.canvas.height};const b=m;return{width:b.width,height:b.height}}let l=!1;const u=256;let f=null,M=null;function h(){if(!f||!M){const m=t.createShaderModule({code:qt});M=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const b=t.createPipelineLayout({bindGroupLayouts:[M]});f=t.createComputePipeline({layout:b,compute:{module:m,entryPoint:"cs_main"}})}return{pipeline:f,layout:M}}return{backend:"webgpu",capabilities:n,createTexture(m,b,d){return new lt(t,m,b,d)},createSampler(m){const b=(m==null?void 0:m.filter)==="linear"?"linear":"nearest",d=t.createSampler({magFilter:b,minFilter:b,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new ut(d)},createRenderPipeline(m){const b=t.createShaderModule({code:m.shaderWGSL}),d=Qt(m.shaderWGSL),v=Ve(m.targetFormat),y=en(t,d),p=t.createPipelineLayout({bindGroupLayouts:[y]}),w=g=>t.createRenderPipeline({layout:p,vertex:{module:b,entryPoint:"vs_main"},fragment:{module:b,entryPoint:"fs_main",targets:[{format:g}]},primitive:{topology:"triangle-list"}}),P=w(v);return new Jt(P,d,y,v,w)},createComputePipeline(m){const b=t.createShaderModule({code:m.shaderWGSL}),d=t.createComputePipeline({layout:"auto",compute:{module:b,entryPoint:"cs_main"}});return new tn(d)},createBindGroup(m,b){const d=m,v=new Map,y=[];for(const[w,P]of d.bindings)if(P.kind==="uniform"){const g=t.createBuffer({size:P.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});y.push(g),v.set(w,{binding:w,resource:{buffer:g}})}else P.kind==="sampler"&&v.set(w,{binding:w,resource:o()});for(const w of b){const P=w.resource;if(P instanceof lt){const g=$e(w.binding,"texture");d.bindings.has(g)&&v.set(g,{binding:g,resource:P.gpuTexture.createView()})}else if(P instanceof ut){const g=$e(w.binding,"sampler");d.bindings.has(g)&&v.set(g,{binding:g,resource:P.gpuSampler})}else{const g=$e(w.binding,"uniform"),C=d.bindings.get(g);if(C&&C.kind==="uniform"){const L=P.uniform,B=t.createBuffer({size:Math.max(C.sizeBytes,L.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(B,0,L.buffer,L.byteOffset,L.byteLength),y.push(B),v.set(g,{binding:g,resource:{buffer:B}})}}}const p=t.createBindGroup({layout:d.bindGroupLayout,entries:Array.from(v.values())});return new nn(p,y)},createSurface(m,b){const d=m.getContext("webgpu");if(!d)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const v=b.hdr&&n.hdr,y=()=>v?Yt(d,t):st(d,t),p=y();return new rn(m,d,p,y)},renderFullscreen(m,b,d){const v=b,y=d,p=a(m),{width:w,height:P}=c(m),g=Ue(m)?m.format:Ve(m.format),C=v.pipelineFor(g),L=t.createCommandEncoder(),B=L.beginRenderPass({colorAttachments:[{view:p,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});B.setPipeline(C),B.setBindGroup(0,y.gpuBindGroup),B.setViewport(0,0,w,P,0,1),B.draw(3),B.end(),t.queue.submit([L.finish()])},async readback(m){const b=Ue(m),{width:d,height:v}=c(m),y=b?m.hdr?"rgba16float":"rgba8unorm":m.format,p=b&&m.format==="bgra8unorm",w=b?m.getCurrentGPUTexture():m.gpuTexture,P=ct(y),g=d*P,C=256,L=Math.ceil(g/C)*C,B=L*v,N=t.createBuffer({size:B,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),H=t.createCommandEncoder();H.copyTextureToBuffer({texture:w},{buffer:N,bytesPerRow:L,rowsPerImage:v},{width:d,height:v,depthOrArrayLayers:1}),t.queue.submit([H.finish()]),await N.mapAsync(GPUMapMode.READ);const O=new Uint8Array(N.getMappedRange()),_=new Uint8Array(g*v);for(let k=0;k<v;k++){const G=k*L,z=k*g;_.set(O.subarray(G,G+g),z)}if(N.unmap(),N.destroy(),y==="rgba8unorm"){if(p)for(let k=0;k<_.length;k+=4){const G=_[k],z=_[k+2];_[k]=z,_[k+2]=G}return _}if(y==="rgba16float"){const k=new Uint16Array(_.buffer,_.byteOffset,_.byteLength/2),G=new Float32Array(k.length);for(let z=0;z<k.length;z++)G[z]=Zt(k[z]);return G}return new Float32Array(_.buffer,_.byteOffset,_.byteLength/4)},async reduceDiffSumSquaredAbs(m,b,d,v){const y=m,p=b,w=Math.max(0,d*v),P=Math.max(1,Math.ceil(w/u)),{pipeline:g,layout:C}=h(),L=P*2*4,B=t.createBuffer({size:L,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),N=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(N,0,new Uint32Array([Math.max(1,d),Math.max(1,v),w,0]));const H=t.createBindGroup({layout:C,entries:[{binding:0,resource:y.gpuTexture.createView()},{binding:1,resource:p.gpuTexture.createView()},{binding:2,resource:{buffer:B}},{binding:3,resource:{buffer:N}}]}),O=t.createBuffer({size:L,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),_=t.createCommandEncoder(),k=_.beginComputePass();k.setPipeline(g),k.setBindGroup(0,H),k.dispatchWorkgroups(P),k.end(),_.copyBufferToBuffer(B,0,O,0,L),t.queue.submit([_.finish()]),await O.mapAsync(GPUMapMode.READ);const z=new Float32Array(O.getMappedRange()).slice();O.unmap(),O.destroy(),B.destroy(),N.destroy();let q=0,ne=0;for(let ee=0;ee<P;ee++)q+=z[ee*2],ne+=z[ee*2+1];return{sumSq:q,sumAbs:ne}},destroy(){l||(t.destroy(),l=!0)},isContextLost(){return!1}}}let ze=null;async function an(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return on()}function Ge(){return ze||(ze=an()),ze}function sn(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function cn(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const o=n/255*(e.length-1),a=Math.floor(o),c=Math.min(a+1,e.length-1),l=o-a,[u,f,M]=sn(e[a],e[c],l);t[n*3]=Math.round(u),t[n*3+1]=Math.round(f),t[n*3+2]=Math.round(M)}return t}const dt={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},ft=new Set(["red-green","red-blue"]),ht=new Map;function We(e){let t=ht.get(e);if(!t){const n=dt[e]??dt.viridis;t=cn(n),ht.set(e,t)}return t}function Xe(e,t,n="linear"){const r=We(t),o=new ImageData(e.width,e.height),a=e.data,c=o.data;for(let l=0;l<a.length;l+=4){const u=(a[l]+a[l+1]+a[l+2])/3;let f;n==="positive"?f=Math.round(128+u/255*127):f=Math.round(u),f=Math.max(0,Math.min(255,f)),c[l]=r[f*3],c[l+1]=r[f*3+1],c[l+2]=r[f*3+2],c[l+3]=a[l+3]}return o}function gt(e){const t=new Map;return{get(n){return t.get(n)},set(n,r){if(t.size>=e){const o=t.keys().next().value;o!==void 0&&t.delete(o)}t.set(n,r)}}}const mt=gt(50);function He(e){return mt.get(e)}function Ye(e,t){mt.set(e,t)}const pt=gt(100);function ln(e){return pt.get(e)}function un(e,t){pt.set(e,t)}function dn(e,t,n){const r=Math.min(e.width,t.width),o=Math.min(e.height,t.height),a=new ImageData(r,o);for(let c=0;c<o;c++)for(let l=0;l<r;l++){const u=(c*e.width+l)*4,f=(c*t.width+l)*4,M=(c*r+l)*4;for(let h=0;h<3;h++){const E=e.data[u+h],m=t.data[f+h],b=E-m,d=Math.abs(b),v=Math.max(E,1);let y;switch(n){case"signed":y=(b+255)/2;break;case"absolute":y=d;break;case"squared":y=b*b/255;break;case"relative_signed":y=(b/v+1)*127.5;break;case"relative_absolute":y=d/v*255;break;case"relative_squared":y=b*b/(v*v)*255;break}a.data[M+h]=Math.min(255,Math.max(0,Math.round(y)))}a.data[M+3]=255}return a}async function Ce(e){const t=ln(e);return t||new Promise(n=>{const r=new Image;r.onload=()=>{try{const o=document.createElement("canvas");o.width=r.naturalWidth,o.height=r.naturalHeight;const a=o.getContext("2d");if(!a){n(null);return}a.drawImage(r,0,0);const c=a.getImageData(0,0,o.width,o.height);un(e,c),n(c)}catch(o){console.warn("[cairn] loadImageData failed:",o),n(null)}},r.onerror=o=>{console.warn("[cairn] loadImageData: image failed to load:",e,o),n(null)},r.src=e})}const fn={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},hn={linear:0,signed:1,positive:2},gn=`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,mn=`#version 300 es
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
}`;let De=null,V=null,ge=null,Fe=null;function pn(){if(V)return V;try{if(typeof OffscreenCanvas<"u"?De=new OffscreenCanvas(1,1):De=document.createElement("canvas"),V=De.getContext("webgl2",{preserveDrawingBuffer:!0}),!V)return console.warn("[cairn] WebGL 2 not available"),null;const e=V.createShader(V.VERTEX_SHADER);if(V.shaderSource(e,gn),V.compileShader(e),!V.getShaderParameter(e,V.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",V.getShaderInfoLog(e)),null;const t=V.createShader(V.FRAGMENT_SHADER);if(V.shaderSource(t,mn),V.compileShader(t),!V.getShaderParameter(t,V.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",V.getShaderInfoLog(t)),null;if(ge=V.createProgram(),V.attachShader(ge,e),V.attachShader(ge,t),V.linkProgram(ge),!V.getProgramParameter(ge,V.LINK_STATUS))return console.error("[cairn] WebGL program link:",V.getProgramInfoLog(ge)),null;Fe=V.createVertexArray(),V.bindVertexArray(Fe);const n=V.createBuffer();V.bindBuffer(V.ARRAY_BUFFER,n),V.bufferData(V.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),V.STATIC_DRAW);const r=V.getAttribLocation(ge,"a_pos");return V.enableVertexAttribArray(r),V.vertexAttribPointer(r,2,V.FLOAT,!1,0,0),V.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),V}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function vt(e,t,n){const r=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),r}function vn(e,t,n){const r=new Uint8Array(1024);for(let a=0;a<256;a++)r[a*4]=t[a*3],r[a*4+1]=t[a*3+1],r[a*4+2]=t[a*3+2],r[a*4+3]=255;const o=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,o),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,r),o}function bn(e,t,n,r){const o=pn();if(!o||!ge||!Fe||!De)return null;const a=Math.min(e.width,t.width),c=Math.min(e.height,t.height);De.width=a,De.height=c,o.viewport(0,0,a,c);const l=vt(o,e,0),u=vt(o,t,1);let f=null;n.colormap?f=vn(o,n.colormap,2):(f=o.createTexture(),o.activeTexture(o.TEXTURE2),o.bindTexture(o.TEXTURE_2D,f),o.texImage2D(o.TEXTURE_2D,0,o.RGBA8,1,1,0,o.RGBA,o.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),o.useProgram(ge),o.uniform1i(o.getUniformLocation(ge,"u_baseline"),0),o.uniform1i(o.getUniformLocation(ge,"u_other"),1),o.uniform1i(o.getUniformLocation(ge,"u_lut"),2),o.uniform1i(o.getUniformLocation(ge,"u_diff_mode"),fn[n.diffMode]),o.uniform1i(o.getUniformLocation(ge,"u_cmap_mode"),hn[n.cmapMode]??0),o.uniform1i(o.getUniformLocation(ge,"u_use_colormap"),n.colormap?1:0),o.bindVertexArray(Fe),o.drawArrays(o.TRIANGLE_STRIP,0,4),o.bindVertexArray(null),r.width=a,r.height=c;const M=r.getContext("2d");return M&&(M.save(),M.scale(1,-1),M.drawImage(De,0,0,a,c,0,-c,a,c),M.restore()),o.deleteTexture(l),o.deleteTexture(u),o.deleteTexture(f),{width:a,height:c}}const wn={cardSettings:(e,t,n)=>`cairn:card-settings:${e}:${t}:${n}`,runLayout:e=>`cairn:run-layout:${e}`,collapsedSections:e=>`cairn:collapsed-sections:${e}`,comparisons:e=>`cairn:comparisons:${e}`,comparisonTemplates:e=>`cairn:comparison-templates:${e}`,reportTemplates:e=>`cairn:report-templates:${e}`,streamMode:"cairn:stream-mode",renderMode:"cairn:render-mode",scroll:e=>`cairn:scroll:${e}`,lastComparison:e=>`cairn:last-comparison:${e}`};function xn(){try{const e=localStorage.getItem(wn.renderMode);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const xe=e=>e<0?0:e>1?1:e,qe=e=>{const t=e<0?0:e;return t/(1+t)},Ze=e=>{const t=e<0?0:e,n=t*(2.51*t+.03),r=t*(2.43*t+.59)+.14;return xe(n/r)},bt={linear:([e,t,n])=>[xe(e),xe(t),xe(n)],srgb:([e,t,n])=>[xe(e),xe(t),xe(n)],reinhard:([e,t,n])=>[qe(e),qe(t),qe(n)],aces:([e,t,n])=>[Ze(e),Ze(t),Ze(n)],extended:([e,t,n])=>[e,t,n]},yn="srgb";function En(e){return e&&bt[e]||bt[yn]}function je(e,t){return e*2**t}function _n(e){const t=xe(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function Ke(e,t){return typeof t=="number"&&t>0?xe(Math.pow(xe(e),1/t)):_n(e)}function wt(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Qe({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:r}){const o=wt(e),a=wt(t),c=[];for(let p=0;p<=e;p+=o)c.push(p);const l=[];for(let p=0;p<=t;p+=a)l.push(p);const u=1/n,f=8*u,M=-12*u,h=-2*u,E=r==null?void 0:r.current;let m=0,b=0,d=0,v=0;if(E){const p=E.clientWidth,w=E.clientHeight,P=p/e,g=w/t,C=Math.min(P,g);d=e*C,v=t*C,m=(p-d)/2,b=(w-v)/2}const y=E&&d>0;return i.jsxs(i.Fragment,{children:[i.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:y?b:0,transform:`translateY(${M}px)`,fontSize:f},children:c.map(p=>i.jsx("span",{className:"mono",style:{position:"absolute",left:y?m+p/e*d:`${p/e*100}%`,transform:"translateX(-50%)"},children:p},p))}),i.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:y?m:0,transform:`translateX(${h}px)`,fontSize:f},children:l.map(p=>i.jsx("span",{className:"mono",style:{position:"absolute",top:y?b+p/t*v:`${p/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*u}px`},children:p},p))})]})}function Je({label:e,isDraggable:t,onDragStart:n}){return i.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&i.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const xt=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function et(e){const t=xt.length;return xt[(e%t+t)%t]}function Mn(e){const n=s.useRef(null),[r,o]=s.useState({w:0,h:0}),a=s.useRef(null),c=s.useRef(null);return s.useEffect(()=>{var f;const l=n.current;if(l===c.current||((f=a.current)==null||f.disconnect(),a.current=null,c.current=l,!l))return;const u=new ResizeObserver(M=>{for(const h of M)o({w:h.contentRect.width,h:h.contentRect.height})});a.current=u,u.observe(l)}),s.useEffect(()=>()=>{var l;return(l=a.current)==null?void 0:l.disconnect()},[]),{ref:n,size:r}}function Pn(){const[e,t]=s.useState(!1);return s.useEffect(()=>{const n=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!0)},r=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!1)},o=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",r),window.addEventListener("blur",o),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",r),window.removeEventListener("blur",o)}},[]),e}const Tn=.25,tt=64;function yt(e,t,n,r){if(e<=0||t<=0||n<=0||r<=0)return tt;const o=Math.min(n/e,r/t);return o<=0?tt:Math.max(Math.max(n,r)/o,8)}function ke(e){const{containerRef:t,zoom:n,pan:r,onViewportChange:o,minZoom:a=Tn,maxZoom:c=tt,naturalWidth:l,naturalHeight:u}=e,f=Pn(),M=s.useRef(f);M.current=f;const h=s.useRef({zoom:n,pan:r});h.current={zoom:n,pan:r};const E=s.useRef(o);E.current=o,s.useEffect(()=>{const p=t.current;if(!p||!o)return;const w=P=>{var G;if(!M.current)return;P.preventDefault(),P.stopPropagation();const g=P.deltaY<0?1.1:1/1.1,C=h.current,L=p.getBoundingClientRect(),B=l&&u?yt(l,u,L.width,L.height):c,N=Math.max(a,Math.min(B,C.zoom*g));if(C.zoom===N)return;const H=P.clientX-L.left,O=P.clientY-L.top,_=H-(H-C.pan.x)/C.zoom*N,k=O-(O-C.pan.y)/C.zoom*N;(G=E.current)==null||G.call(E,{zoom:N,pan:{x:_,y:k}})};return p.addEventListener("wheel",w,{passive:!1}),()=>p.removeEventListener("wheel",w)},[t,!!o,a,c,l,u]);const m=s.useRef(null),b=s.useCallback(p=>{!M.current||!E.current||(p.currentTarget.setPointerCapture(p.pointerId),m.current={pointerId:p.pointerId,startX:p.clientX,startY:p.clientY,panX:h.current.pan.x,panY:h.current.pan.y})},[]),d=s.useCallback(p=>{var C;const w=m.current;if(!w||w.pointerId!==p.pointerId)return;const P=p.clientX-w.startX,g=p.clientY-w.startY;(C=E.current)==null||C.call(E,{zoom:h.current.zoom,pan:{x:w.panX+P,y:w.panY+g}})},[]),v=s.useCallback(p=>{const w=m.current;if(!(!w||w.pointerId!==p.pointerId)){try{p.currentTarget.releasePointerCapture(p.pointerId)}catch{}m.current=null}},[]),y=f&&!!o;return{containerProps:{onPointerDown:b,onPointerMove:d,onPointerUp:v,onPointerCancel:v,style:{cursor:y?"move":void 0,touchAction:y?"none":void 0}},modifierActive:f}}function nt(){const[e,t]=s.useState(()=>typeof window<"u"&&window.devicePixelRatio||1);return s.useEffect(()=>{if(typeof matchMedia>"u")return;let n=!1,r=null;const o=()=>{n||(t(window.devicePixelRatio||1),a())};function a(){if(n)return;const c=window.devicePixelRatio||1;r=matchMedia(`(resolution: ${c}dppx)`),r.addEventListener("change",o,{once:!0})}return a(),()=>{n=!0,r==null||r.removeEventListener("change",o)}},[]),e}function Sn(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function Et(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function rt({data:e,settings:t,naturalWidth:n,naturalHeight:r}){const{ref:o,size:a}=Mn(),c=s.useRef(null),l=s.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),u=s.useMemo(()=>{const d=a.w,v=a.h;if(d<=0||v<=0||n<=0||r<=0)return null;const y=Math.min(d/n,v/r),p=n*y,w=r*y;return{left:(d-p)/2,top:(v-w)/2,width:p,height:w}},[a.w,a.h,n,r]),f=e.masks,M=t.showMasks&&!!f&&f.length>0,h=s.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(s.useEffect(()=>{if(!M||!f)return;const d=c.current;if(!d)return;(d.width!==n||d.height!==r)&&(d.width=n,d.height=r);const v=d.getContext("2d");if(!v)return;v.clearRect(0,0,d.width,d.height);let y=!1;const p=v.createImageData(n,r),w=p.data;let P=f.length,g=!1;const C=()=>{y||g&&v.putImageData(p,0,0)},L=document.createElement("canvas");L.width=n,L.height=r;const B=L.getContext("2d",{willReadFrequently:!0});for(const N of f){const H=new Image;H.onload=()=>{if(!y){if(B){B.clearRect(0,0,n,r),B.drawImage(H,0,0,n,r);const O=B.getImageData(0,0,n,r).data;for(let _=0;_<n*r;_++){const k=O[_*4];if(k===0||l.has(k))continue;const[G,z,q]=Sn(et(k));w[_*4]=G,w[_*4+1]=z,w[_*4+2]=q,w[_*4+3]=255,g=!0}}P-=1,P===0&&C()}},H.onerror=()=>{P-=1,P===0&&C()},H.src=`data:image/png;base64,${N.png_b64}`}return()=>{y=!0}},[M,f,n,r,h]),!u)return i.jsx("div",{ref:o,className:"absolute inset-0 pointer-events-none"});const E=e.boxes??[],m=t.showBoxes&&E.length>0,b=e.class_labels??{};return i.jsxs("div",{ref:o,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[M&&i.jsx("canvas",{ref:c,className:"absolute",style:{left:u.left,top:u.top,width:u.width,height:u.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),m&&i.jsx("svg",{className:"absolute",style:{left:u.left,top:u.top,width:u.width,height:u.height,overflow:"visible"},viewBox:`0 0 ${n} ${r}`,preserveAspectRatio:"none",children:E.map((d,v)=>{if(!Et(d,t,l))return null;const y=d.domain==="pixel"?1:n,p=d.domain==="pixel"?1:r,w=d.position.minX*y,P=d.position.minY*p,g=(d.position.maxX-d.position.minX)*y,C=(d.position.maxY-d.position.minY)*p;return i.jsx("rect",{x:w,y:P,width:g,height:C,fill:"none",stroke:et(d.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},v)})}),m&&i.jsx("div",{className:"absolute",style:{left:u.left,top:u.top,width:u.width,height:u.height},children:E.map((d,v)=>{if(!Et(d,t,l))return null;const y=d.domain==="pixel"?1/n:1,p=d.domain==="pixel"?1/r:1,w=d.position.minX*y*100,P=d.position.minY*p*100,g=d.label??b[String(d.class_id)]??`#${d.class_id}`,C=d.score!=null?` ${(d.score*100).toFixed(0)}%`:"";return!g&&!C?null:i.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${w}%`,top:`${P}%`,transform:"translateY(-100%)",backgroundColor:et(d.class_id)},children:i.jsxs("span",{className:"mono",children:[g,C]})},v)})})]})}const ot=30,ce=["#ff5a5a","#39d353","#5b9bff"];function at(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function Q(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):at(e/255):at(n==="int"?e*255:e)}const Cn={x:0,y:0,w:1,h:1};function ye({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:r,pan:o,sample:a,notation:c="decimal",version:l=0,onActiveChange:u,sourceWindow:f=Cn}){const M=s.useRef(null),h=s.useRef(!1),E=nt(),m=s.useRef(u);m.current=u;const b=s.useCallback(v=>{var y;v!==h.current&&(h.current=v,(y=m.current)==null||y.call(m,v))},[]),d=s.useCallback(()=>{var be;const v=M.current,y=e.current;if(!v)return;const p=window.devicePixelRatio||1,w=v.clientWidth,P=v.clientHeight;if(w===0||P===0)return;v.width!==Math.round(w*p)&&(v.width=Math.round(w*p)),v.height!==Math.round(P*p)&&(v.height=Math.round(P*p));const g=v.getContext("2d");if(!g)return;if(g.setTransform(p,0,0,p,0,0),g.clearRect(0,0,w,P),!y||t<=0||n<=0){b(!1);return}const C=y.getBoundingClientRect(),L=v.getBoundingClientRect();if(C.width===0||C.height===0){b(!1);return}const B=f.x*t,N=f.y*n,H=f.w*t,O=f.h*n;if(H<=0||O<=0){b(!1);return}const _=Math.min(C.width/H,C.height/O);if(_<ot){b(!1);return}const k=H*_,G=O*_,z=C.left+(C.width-k)/2-L.left,q=C.top+(C.height-G)/2-L.top,ne=Math.max(Math.floor(B),Math.floor(B+(0-z)/_)),ee=Math.min(Math.ceil(B+H),Math.ceil(B+(w-z)/_)),le=Math.max(Math.floor(N),Math.floor(N+(0-q)/_)),ae=Math.min(Math.ceil(N+O),Math.ceil(N+(P-q)/_));if(ee<=ne||ae<=le){b(!1);return}b(!0);const fe=z+(0-B)*_,pe=q+(0-N)*_,re=z+(t-B)*_,ue=q+(n-N)*_;g.save(),g.beginPath(),g.rect(fe,pe,re-fe,ue-pe),g.clip(),g.textAlign="center",g.textBaseline="middle",g.lineJoin="round";const ve=_*.14,ie=_-ve*2;for(let oe=le;oe<ae;oe++)for(let se=ne;se<ee;se++){if(se<0||oe<0||se>=t||oe>=n)continue;const X=a(se,oe,c);if(!X||X.lines.length===0)continue;const Y=X.lines.length;let J=1;for(const D of X.lines)D.length>J&&(J=D.length);const de=ie/(Y*1.15),x=ie/(J*.62)||de,A=Math.min(de,x,24);if(A<6)continue;const S=z+(se-B+.5)*_,T=q+(oe-N+.5)*_,I=A*1.15,U=X.luminance<=.55,Z=U?"#ffffff":"#000000";g.font=`${A}px ui-monospace, SFMono-Regular, Menlo, monospace`,g.lineWidth=Math.max(1.4,A*.16),g.strokeStyle=U?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let R=T-Y*I/2+I/2;for(let D=0;D<X.lines.length;D++){const F=X.lines[D];g.strokeText(F,S,R),g.fillStyle=((be=X.colors)==null?void 0:be[D])??Z,g.fillText(F,S,R),R+=I}}g.restore()},[e,t,n,a,c,b,f]);return s.useEffect(()=>{d()},[d,r,o.x,o.y,l,c,f,E]),s.useEffect(()=>{const v=M.current;if(!v)return;const y=new ResizeObserver(()=>d());return y.observe(v),()=>y.disconnect()},[d]),i.jsx("canvas",{ref:M,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Re({notation:e,onChange:t,className:n=""}){return i.jsx("button",{type:"button",onClick:r=>{r.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:r=>r.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const Dn=`
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
`,An=`
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
`,Be={linear:0,srgb:1,reinhard:2,aces:3,extended:4},_t=new WeakMap;function In(e,t){let n=_t.get(e);n||(n=new Map,_t.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:Dn,targetFormat:t}),n.set(t,r)),r}function Mt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Pt(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const r=e.createTexture(256,1,"rgba32float");return r.write(t),r}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function kn(e,t,n,r){var b;const o=Mt(t),a=In(e,o),c=Pt(e,r.isScalar?r.colormap:void 0),l=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,u=Be[r.operator]??Be.srgb,f=new Float32Array([r.exposureEV,u,l,r.isScalar?1:0]),M=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),h=new Float32Array([r.hdrOut?1:0]),E=new Float32Array([r.filter==="nearest"?0:1]);let m;try{m=e.createBindGroup(a,[{binding:0,resource:n},{binding:1,resource:c},{binding:2,resource:{uniform:f}},{binding:3,resource:{uniform:M}},{binding:4,resource:{uniform:h}},{binding:5,resource:{uniform:E}}]),e.renderFullscreen(t,a,m)}finally{(b=m==null?void 0:m.destroy)==null||b.call(m),c.destroy()}}const Rn={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},On={linear:0,signed:1,positive:2},Ln={split:0,blend:1,diff:2},Tt=new WeakMap;function Un(e,t){let n=Tt.get(e);n||(n=new Map,Tt.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:An,targetFormat:t}),n.set(t,r)),r}function Gn(e,t,n,r,o){var p;const a=Mt(t),c=Un(e,a),l=o.mode==="diff"&&!!o.diffColormap,u=o.isScalar?o.colormap:l?o.diffColormap:void 0,f=Pt(e,u),M=typeof o.gamma=="number"&&o.gamma>0?o.gamma:0,h=Be[o.operator]??Be.srgb,E=new Float32Array([o.exposureEV,h,M,o.isScalar?1:0]),m=new Float32Array([o.uv.x,o.uv.y,o.uv.w,o.uv.h]),b=new Float32Array([Ln[o.mode],o.split,o.alpha,Rn[o.diffSubmode]??0]),d=new Float32Array([On[o.diffCmapMode??"linear"]??0,o.hdrOut?1:0,l?1:0,0]),v=new Float32Array([o.filter==="nearest"?0:1]);let y;try{y=e.createBindGroup(c,[{binding:0,resource:n},{binding:1,resource:r},{binding:2,resource:f},{binding:3,resource:{uniform:E}},{binding:4,resource:{uniform:m}},{binding:5,resource:{uniform:b}},{binding:6,resource:{uniform:d}},{binding:7,resource:{uniform:v}}]),e.renderFullscreen(t,c,y)}finally{(p=y==null?void 0:y.destroy)==null||p.call(y),f.destroy()}}function St(e,t,n){if(n<=0)return{mse:0,psnr:1/0,mae:0};const r=e/n,o=t/n,a=r<=0?1/0:10*Math.log10(1/r);return{mse:r,psnr:a,mae:o}}async function Fn(e,t,n){const r=Math.min(t.width,n.width),o=Math.min(t.height,n.height),a=r*o*3;if(a<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:E,sumAbs:m}=await e.reduceDiffSumSquaredAbs(t,n,r,o);return St(E,m,a)}const c=await e.readback(t),l=await e.readback(n),u=c instanceof Uint8Array,f=l instanceof Uint8Array;let M=0,h=0;for(let E=0;E<o;E++)for(let m=0;m<r;m++){const b=(E*t.width+m)*4,d=(E*n.width+m)*4;for(let v=0;v<3;v++){const y=(c[b+v]??0)/(u?255:1),p=(l[d+v]??0)/(f?255:1),w=y-p;M+=w*w,h+=Math.abs(w)}}return St(M,h,a)}function Ct(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const Bn=12,Pe=[];function Dt(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1),Pe.push(e)}function Nn(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1)}function Ne(e){e.parked||(Nn(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.parked=!0)}function At(e){for(;Pe.length>Bn;){const t=Pe.find(n=>n!==e&&!n.visible)??Pe.find(n=>n!==e);if(!t)break;Ne(t)}}function It(e){var o,a;if(e.disposed)return;if(Ct())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Dt(e),At(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const n=e.backingWidth||((o=e.source)==null?void 0:o.width)||1,r=e.backingHeight||((a=e.source)==null?void 0:a.height)||1;if(e.canvas.width=n,e.canvas.height=r,e.surface.configure(n,r),e.source){const c=t.createTexture(e.source.width,e.source.height,e.source.format);c.write(e.source.data),e.srcTexture=c}e.parked=!1,Dt(e),At(e)}function Vn(e,t){if(e.disposed||!e.source)return!0;try{return It(e),!e.surface||!e.srcTexture?!1:(kn(e.device,e.surface,e.srcTexture,t),!0)}catch(n){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Ne(e),!1}}function $n(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},resize(t,n){if(e.disposed)return;const r=Math.max(1,Math.round(t)),o=Math.max(1,Math.round(n));e.backingWidth===r&&e.backingHeight===o||(e.backingWidth=r,e.backingHeight=o,!e.parked&&e.surface&&(e.canvas.width=r,e.canvas.height=o,e.surface.configure(r,o)))},render(t){return Vn(e,t)},park(){e.disposed||Ne(e)},restore(){e.disposed||!e.source||It(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Ne(e),e.source=null,e.disposed=!0)}}}async function zn(e,t){const n=await Ge(),r={canvas:e,device:n,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return $n(r)}function kt(e){e.dispose()}function Wn(e,t){const{brightness:n,contrast:r,exposure:o,flipSign:a}=e;return[`url(#${t})`,`brightness(${(1+n)*Math.pow(2,o)})`,`contrast(${1+r})`,...a?["invert(1)"]:[]].join(" ")}function Rt(e){const n=`cairn-gamma-${s.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:r,contrast:o,gamma:a,exposure:c,offset:l,flipSign:u}=e,f=s.useMemo(()=>Wn(e,n),[n,r,o,c,u]);return{gammaFilterId:n,filterStr:f,gamma:a,offset:l}}function Ot({id:e,gamma:t,offset:n}){return i.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:i.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:i.jsxs("feComponentTransfer",{children:[i.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),i.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),i.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:n})]})})})}const Xn={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function Lt({imageUrl:e,baselineUrl:t,isBaseline:n=!1,diffMode:r,interpolation:o,colormap:a,showAxes:c,processing:l=Xn,zoom:u=1,pan:f={x:0,y:0},onViewportChange:M,onNaturalSize:h,label:E,isDraggable:m=!1,onDragStart:b,overlay:d,overlaySettings:v,pixelValueNotation:y="decimal"}){var U,Z;const p=s.useRef(null),w=s.useRef(null),P=s.useRef(null),g=s.useRef(null),C=s.useRef(null),L=s.useRef(null),B=s.useRef(null),[N,H]=s.useState(0),O=s.useCallback(()=>H(R=>R+1),[]),[_,k]=s.useState(y),[G,z]=s.useState(!1),q=s.useCallback(R=>{p.current=R,R&&(C.current=R)},[]),ne=s.useCallback(R=>{w.current=R,R&&(C.current=R)},[]),ee=s.useCallback(R=>{R&&(C.current=R)},[]),[le,ae]=s.useState(!1),[fe,pe]=s.useState(!1),[re,ue]=s.useState(null),{flipSign:ve}=l,{gammaFilterId:ie,filterStr:be,gamma:oe,offset:se}=Rt(l),X=`translate(${f.x}px, ${f.y}px) scale(${u})`,{containerProps:Y}=ke({containerRef:g,zoom:u,pan:f,onViewportChange:M}),J=!n&&r!=="none"&&t!=null&&e!=null,de=r!=="none"&&t!=null,x=a!=="none"&&!J&&!(n&&de)&&e!=null;s.useEffect(()=>{if(!x||!e){pe(!1);return}let R=!1;pe(!1);const D=`${e}::${a}`,F=He(D);if(F){const $=w.current;if($){$.width=F.width,$.height=F.height;const K=$.getContext("2d");K&&K.putImageData(F,0,0),B.current=F,O(),ue({w:F.width,h:F.height}),h==null||h(F.width,F.height),pe(!0)}return}const W=new Image;return W.onload=()=>{if(R)return;const $=document.createElement("canvas");$.width=W.naturalWidth,$.height=W.naturalHeight;const K=$.getContext("2d");if(!K)return;K.drawImage(W,0,0);const me=K.getImageData(0,0,$.width,$.height),we=ft.has(a)?"positive":"linear",te=Xe(me,a,we);Ye(D,te);const Ee=w.current;if(!Ee||R)return;Ee.width=te.width,Ee.height=te.height;const he=Ee.getContext("2d");he&&he.putImageData(te,0,0),B.current=te,O(),ue({w:te.width,h:te.height}),h==null||h(te.width,te.height),pe(!0)},W.src=e,()=>{R=!0}},[x,e,a]);const A=s.useCallback((R,D)=>{ue(F=>F&&F.w===R&&F.h===D?F:{w:R,h:D}),h==null||h(R,D)},[]);s.useEffect(()=>{if(!e){L.current=null,B.current=null,O();return}let R=!1;return Ce(e).then(D=>{R||(L.current=D,a==="none"&&(B.current=D),O())}),()=>{R=!0}},[e,a,O]);const S=s.useCallback((R,D,F)=>{const W=L.current;if(!W||R<0||D<0||R>=W.width||D>=W.height)return null;const $=(D*W.width+R)*4,K=W.data[$],me=W.data[$+1],we=W.data[$+2],te=B.current;let Ee=K,he=me,_e=we;if(te&&te.width===W.width&&te.height===W.height){const Ie=(D*te.width+R)*4;Ee=te.data[Ie],he=te.data[Ie+1],_e=te.data[Ie+2]}const Oe=(.299*Ee+.587*he+.114*_e)/255;return a!=="none"||K===me&&me===we?{lines:[Q(K,"uint8",F)],luminance:Oe}:{lines:[Q(K,"uint8",F),Q(me,"uint8",F),Q(we,"uint8",F)],luminance:Oe,colors:[ce[0],ce[1],ce[2]]}},[a]);s.useEffect(()=>{if(!J){ae(!1);return}let R=!1;const D=xn(),F=D==="gpu"||D==="auto",W=`${t}::${e}::${r}::${a}`;if(D!=="gpu"){const $=He(W);if($){const K=p.current;if(K){(K.width!==$.width||K.height!==$.height)&&(K.width=$.width,K.height=$.height);const me=K.getContext("2d");me&&me.putImageData($,0,0),A($.width,$.height),ae(!0)}return}}return(async()=>{const[$,K]=await Promise.all([Ce(t),Ce(e)]);if(R||!$||!K)return;const we=r.includes("signed")?"signed":"positive",te=a!=="none"?We(a):null,Ee={diffMode:r,colormap:te,cmapMode:we};if(F)try{const Le=p.current;if(Le){const Ie=bn($,K,Ee,Le);if(Ie){if(R)return;A(Ie.width,Ie.height),ae(!0);return}}}catch(Le){console.warn("[cairn] WebGL 2 diff error:",Le)}if(D==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let he=dn($,K,r);a!=="none"&&(he=Xe(he,a,we)),Ye(W,he);const _e=p.current;if(!_e||R)return;(_e.width!==he.width||_e.height!==he.height)&&(_e.width=he.width,_e.height=he.height);const Oe=_e.getContext("2d");Oe&&Oe.putImageData(he,0,0),A(he.width,he.height),ae(!0)})(),()=>{R=!0}},[t,e,r,J,a,h]);const T=o==="auto"?void 0:o,I=ve?{filter:"invert(1)"}:{};return i.jsxs("div",{className:"relative flex flex-col h-full",children:[i.jsx(Ot,{id:ie,gamma:oe,offset:se}),i.jsxs("div",{ref:g,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:c&&re?"16px 4px 4px 28px":"4px",...Y.style},onPointerDown:Y.onPointerDown,onPointerMove:Y.onPointerMove,onPointerUp:Y.onPointerUp,onPointerCancel:Y.onPointerCancel,children:[i.jsxs("div",{ref:P,className:"relative w-full h-full",style:{transform:X,transformOrigin:"0 0"},children:[e?J?i.jsxs(i.Fragment,{children:[!le&&i.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),i.jsx("canvas",{ref:q,className:"w-full h-full object-contain block",style:{display:le?"block":"none",imageRendering:T,...I}})]}):x?i.jsxs(i.Fragment,{children:[!fe&&i.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),i.jsx("canvas",{ref:ne,className:"w-full h-full object-contain block",style:{display:fe?"block":"none",imageRendering:T,...I}})]}):i.jsx("img",{ref:ee,src:e,alt:E,className:"w-full h-full object-contain block",draggable:!1,style:{filter:be,imageRendering:T},onLoad:R=>{const D=R.currentTarget;ue({w:D.naturalWidth,h:D.naturalHeight}),h==null||h(D.naturalWidth,D.naturalHeight)}}):i.jsx("span",{className:"text-xs text-fg-muted",children:"no image"}),c&&re&&i.jsx(Qe,{naturalWidth:re.w,naturalHeight:re.h,zoom:u,containerRef:P}),d&&(v==null?void 0:v.enabled)&&re&&e&&((((U=d.boxes)==null?void 0:U.length)??0)>0||(((Z=d.masks)==null?void 0:Z.length)??0)>0)&&i.jsx(rt,{data:d,settings:v,naturalWidth:re.w,naturalHeight:re.h})]}),e&&re&&i.jsx(ye,{imageElRef:C,naturalWidth:re.w,naturalHeight:re.h,zoom:u,pan:f,sample:S,notation:_,version:N,onActiveChange:z}),G&&i.jsx(Re,{notation:_,onChange:k})]}),i.jsx(Je,{label:E,isDraggable:m,onDragStart:b})]})}function Hn(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`HdrImagePane: unsupported shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}const Te=e=>Number.isFinite(e)?e:0;function Yn(e,t,n,r){const{h:o,w:a,c}=Hn(e.shape),l=e.data,u=En(t),f=new Uint8ClampedArray(a*o*4);for(let M=0;M<a*o;M++){const h=M*c;let E,m,b,d=1;c===1?E=m=b=Te(l[h]):c===3?(E=Te(l[h]),m=Te(l[h+1]),b=Te(l[h+2])):(E=Te(l[h]),m=Te(l[h+1]),b=Te(l[h+2]),d=Te(l[h+3]));const v=[je(E,n),je(m,n),je(b,n)],[y,p,w]=u(v),P=M*4;f[P]=255*Ke(y,r),f[P+1]=255*Ke(p,r),f[P+2]=255*Ke(w,r),f[P+3]=255*(d<0?0:d>1?1:d)}return new ImageData(f,a,o)}function qn({hdr:e,tonemap:t="srgb",exposure:n=0,gamma:r,showAxes:o=!1,label:a="",interpolation:c="auto",zoom:l=1,pan:u={x:0,y:0},onViewportChange:f,pixelValueNotation:M="decimal"}){const h=s.useRef(null),E=s.useRef(null),m=s.useRef(null),[b,d]=s.useState(null),v=s.useRef(null),[y,p]=s.useState(0),[w,P]=s.useState(M),[g,C]=s.useState(!1);s.useEffect(()=>{const O=h.current;if(!O)return;let _;try{_=Yn(e,t,n,r)}catch(G){console.error("[cairn] HDR tone-map error:",G);return}(O.width!==_.width||O.height!==_.height)&&(O.width=_.width,O.height=_.height);const k=O.getContext("2d");k&&(k.putImageData(_,0,0),v.current=_,p(G=>G+1),d(G=>G&&G.w===_.width&&G.h===_.height?G:{w:_.width,h:_.height}))},[e,t,n,r]);const{containerProps:L}=ke({containerRef:m,zoom:l,pan:u,onViewportChange:f}),B=s.useCallback((O,_,k)=>{const G=b;if(!G||O<0||_<0||O>=G.w||_>=G.h)return null;const z=e.shape.length===2?1:e.shape[2]??1,q=(_*G.w+O)*z,ne=e.data,ee=v.current;let le=.5;if(ee&&ee.width===G.w&&ee.height===G.h){const ae=(_*G.w+O)*4;le=(.299*ee.data[ae]+.587*ee.data[ae+1]+.114*ee.data[ae+2])/255}return z===1?{lines:[Q(ne[q]??0,"unit",k)],luminance:le}:{lines:[Q(ne[q]??0,"unit",k),Q(ne[q+1]??0,"unit",k),Q(ne[q+2]??0,"unit",k)],luminance:le,colors:[ce[0],ce[1],ce[2]]}},[e,b]),N=c==="auto"?void 0:c,H=`translate(${u.x}px, ${u.y}px) scale(${l})`;return i.jsxs("div",{className:"relative flex flex-col h-full",children:[i.jsxs("div",{ref:m,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:o&&b?"16px 4px 4px 28px":"4px",...L.style},onPointerDown:L.onPointerDown,onPointerMove:L.onPointerMove,onPointerUp:L.onPointerUp,onPointerCancel:L.onPointerCancel,children:[i.jsxs("div",{ref:E,className:"relative w-full h-full",style:{transform:H,transformOrigin:"0 0"},children:[i.jsx("canvas",{ref:h,className:"w-full h-full object-contain block",style:{imageRendering:N}}),o&&b&&i.jsx(Qe,{naturalWidth:b.w,naturalHeight:b.h,zoom:l,containerRef:E})]}),b&&i.jsx(ye,{imageElRef:h,naturalWidth:b.w,naturalHeight:b.h,zoom:l,pan:u,sample:B,notation:w,version:y,onActiveChange:C}),g&&i.jsx(Re,{notation:w,onChange:P})]}),a?i.jsx(Je,{label:a}):null]})}const Zn=["fill","fill-opacity","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-linecap","stroke-linejoin","opacity","color","font","font-family","font-size","font-weight","font-style","text-anchor","dominant-baseline","visibility","display"];function Ut(e,t){const n=getComputedStyle(e),r=Zn.map(u=>`${u}:${n.getPropertyValue(u)}`).join(";"),o=t.getAttribute("style");t.setAttribute("style",o?`${o};${r}`:r);const a=e.children,c=t.children,l=Math.min(a.length,c.length);for(let u=0;u<l;u++)Ut(a[u],c[u])}function Gt(e){let t=e;for(;t;){const n=getComputedStyle(t).backgroundColor;if(n&&n!=="transparent"&&!n.startsWith("rgba(0, 0, 0, 0)"))return n;t=t.parentElement}return"#ffffff"}function Ft(e){const t=(e==null?void 0:e.scale)??(typeof window<"u"&&window.devicePixelRatio||1);return Math.min(Math.max(t,1),3)}async function Bt(e,t,n,r,o){const a=document.createElement("canvas");a.width=Math.max(1,Math.round(e*n)),a.height=Math.max(1,Math.round(t*n));const c=a.getContext("2d");if(!c)throw new Error("plot-to-png: 2D canvas context unavailable");return c.scale(n,n),r&&(c.fillStyle=r,c.fillRect(0,0,e,t)),o(c),await new Promise((l,u)=>a.toBlob(f=>f?l(f):u(new Error("plot-to-png: toBlob returned null")),"image/png"))}function jn(e,t,n){const r=e.cloneNode(!0);Ut(e,r),r.setAttribute("width",String(t)),r.setAttribute("height",String(n)),r.setAttribute("xmlns","http://www.w3.org/2000/svg");const o=new XMLSerializer().serializeToString(r),a="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(o);return new Promise((c,l)=>{const u=new Image;u.onload=()=>c(u),u.onerror=()=>l(new Error("plot-to-png: SVG rasterization failed")),u.src=a})}async function Nt(e,t){const n=e.getBoundingClientRect(),r=n.width||e.width,o=n.height||e.height,a=(t==null?void 0:t.background)??Gt(e);return Bt(r,o,Ft(t),a,c=>c.drawImage(e,0,0,r,o))}async function Kn(e,t){const n=e.querySelector("svg"),r=Array.from(e.querySelectorAll("canvas")),o=e.getBoundingClientRect(),a=o.width||300,c=o.height||150,l=(t==null?void 0:t.background)??Gt(e);if(n){const u=n.getBoundingClientRect(),f=await jn(n,u.width||a,u.height||c);return Bt(a,c,Ft(t),l,M=>{for(const h of r){const E=h.getBoundingClientRect();M.drawImage(h,E.left-o.left,E.top-o.top,E.width,E.height)}M.drawImage(f,u.left-o.left,u.top-o.top,u.width,u.height)})}if(r.length)return Nt(r[0],t);throw new Error("plot-to-png: no <svg> or <canvas> found under root")}function Qn(e,t){const n=URL.createObjectURL(e),r=document.createElement("a");r.href=n,r.download=t.endsWith(".png")?t:`${t}.png`,document.body.appendChild(r),r.click(),r.remove(),setTimeout(()=>URL.revokeObjectURL(n),1e3)}const Jn={"top-right":{top:6,right:6},"top-left":{top:6,left:6},"bottom-right":{bottom:6,right:6},"bottom-left":{bottom:6,left:6}},er={boxZoom:i.jsx("rect",{x:"3.5",y:"3.5",width:"17",height:"17",rx:"1.5",strokeDasharray:"4 3"}),pan:i.jsxs(i.Fragment,{children:[i.jsx("path",{d:"M12 2v20M2 12h20"}),i.jsx("path",{d:"M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"})]}),zoomIn:i.jsxs(i.Fragment,{children:[i.jsx("circle",{cx:"10.5",cy:"10.5",r:"7"}),i.jsx("path",{d:"M21 21l-5.2-5.2M10.5 7.5v6M7.5 10.5h6"})]}),zoomOut:i.jsxs(i.Fragment,{children:[i.jsx("circle",{cx:"10.5",cy:"10.5",r:"7"}),i.jsx("path",{d:"M21 21l-5.2-5.2M7.5 10.5h6"})]}),autoscale:i.jsx("path",{d:"M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"}),home:i.jsx("path",{d:"M3 11l9-8 9 8M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5M9.5 21v-6h5v6"}),camera:i.jsxs(i.Fragment,{children:[i.jsx("path",{d:"M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"}),i.jsx("circle",{cx:"12",cy:"13.5",r:"3.3"})]})};function tr({name:e}){return i.jsx("svg",{viewBox:"0 0 24 24",width:"13",height:"13",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:er[e]??null})}function Ae({icon:e,title:t,active:n,disabled:r,onClick:o}){return i.jsx("button",{type:"button",disabled:r,onClick:a=>{a.stopPropagation(),!r&&o()},onPointerDown:a=>a.stopPropagation(),onDoubleClick:a=>a.stopPropagation(),"aria-label":t,"aria-pressed":n,"aria-disabled":r,title:t,className:["h-[22px] min-w-[22px] inline-flex items-center justify-center rounded text-xs",r?"opacity-40 cursor-default text-fg-muted":n?"bg-bg-hover text-accent":"text-fg-muted hover:text-fg hover:bg-bg-hover"].join(" "),children:i.jsx(tr,{name:e})})}function it(){return i.jsx("span",{"aria-hidden":"true",className:"mx-0.5 h-3.5 w-px bg-border"})}function Vt({controller:e,config:t}){if((t==null?void 0:t.enabled)===!1)return null;const n=e.capabilities,r=t==null?void 0:t.buttons,o=(E,m)=>m&&(r==null?void 0:r[E])!==!1,a=E=>()=>e.setDragMode(E),c=o("zoom",n.zoom)||o("pan",n.pan),l=o("zoomIn",n.zoom)||o("zoomOut",n.zoom),u=o("autoscale",n.autoscale)||o("reset",n.reset),f=o("screenshot",n.screenshot);if(!c&&!l&&!u&&!f)return null;const M=(t==null?void 0:t.position)??"top-right",h=(t==null?void 0:t.visibility)==="always";return i.jsxs("div",{style:{position:"absolute",pointerEvents:"auto",...Jn[M]},className:["z-10 flex items-center gap-0.5 rounded border border-border","bg-bg-elevated/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-opacity",h?"opacity-100":"opacity-0 group-hover:opacity-100"].join(" "),role:"toolbar","aria-label":"Plot controls",children:[c&&i.jsxs(i.Fragment,{children:[o("zoom",n.zoom)&&i.jsx(Ae,{icon:"boxZoom",title:"Box zoom",active:e.dragMode==="zoom",onClick:a("zoom")}),o("pan",n.pan)&&i.jsx(Ae,{icon:"pan",title:"Pan",active:e.dragMode==="pan",onClick:a("pan")})]}),l&&i.jsxs(i.Fragment,{children:[c&&i.jsx(it,{}),o("zoomIn",n.zoom)&&i.jsx(Ae,{icon:"zoomIn",title:"Zoom in",onClick:()=>e.zoomIn()}),o("zoomOut",n.zoom)&&i.jsx(Ae,{icon:"zoomOut",title:"Zoom out",onClick:()=>e.zoomOut()})]}),u&&i.jsxs(i.Fragment,{children:[(c||l)&&i.jsx(it,{}),o("autoscale",n.autoscale)&&i.jsx(Ae,{icon:"autoscale",title:"Autoscale",onClick:()=>e.autoscale()}),o("reset",n.reset)&&i.jsx(Ae,{icon:"home",title:e.isModified?"Reset view":"Reset view (at home)",disabled:!e.isModified,onClick:()=>e.reset()})]}),f&&i.jsxs(i.Fragment,{children:[(c||l||u)&&i.jsx(it,{}),i.jsx(Ae,{icon:"camera",title:"Download plot as PNG",onClick:()=>{e.toPNG({filename:"plot"}).then(E=>Qn(E,"plot.png")).catch(()=>{})}})]})]})}const nr={zoom:1,pan:{x:0,y:0}},$t=1.3,rr=.25,or=64,zt={buttons:{zoom:!1}};function Wt({rootRef:e,canvasRef:t,zoom:n,pan:r,onViewportChange:o,naturalWidth:a,naturalHeight:c,minZoom:l=rr,maxZoom:u=or,requestRender:f}){const M=s.useCallback(P=>{var G;if(!o)return;const g=(G=e.current)==null?void 0:G.getBoundingClientRect(),C=(g==null?void 0:g.width)??0,L=(g==null?void 0:g.height)??0,B=a&&c&&C>0&&L>0?yt(a,c,C,L):u,N=Math.max(l,Math.min(B,n*P));if(N===n)return;const H=C/2,O=L/2,_=H-(H-r.x)/n*N,k=O-(O-r.y)/n*N;o({zoom:N,pan:{x:_,y:k}})},[o,e,a,c,u,l,n,r.x,r.y]),h=s.useCallback(()=>M($t),[M]),E=s.useCallback(()=>M(1/$t),[M]),m=s.useCallback(()=>o==null?void 0:o(nr),[o]),b=s.useCallback(P=>{const g={scale:P==null?void 0:P.scale,filename:P==null?void 0:P.filename};f==null||f();const C=t==null?void 0:t.current;if(C)return Nt(C,g);const L=e.current;return L?Kn(L,g):Promise.reject(new Error("useImageController.toPNG: no canvas or root element to export"))},[t,e,f]),d=s.useMemo(()=>({zoom:!0,pan:!0,autoscale:!0,reset:!0,screenshot:!0,boxZoom:!1,select:!1,lasso:!1,hover:!1,spikelines:!1,hoverModes:!1,legend:!1,axisScaleToggle:!1,perAxisDrag:!1,brush:!1,reorder:!1}),[]),v=n!==1||r.x!==0||r.y!==0,y=s.useCallback(P=>{},[]),p=s.useCallback(P=>{},[]),w=s.useCallback(()=>{},[]);return s.useMemo(()=>({capabilities:d,dragMode:"pan",hoverMode:"closest",spikelines:!1,isModified:v,setDragMode:y,setHoverMode:p,toggleSpikelines:w,zoomIn:h,zoomOut:E,autoscale:m,reset:m,toPNG:b}),[d,v,y,p,w,h,E,m,b])}function ar(e){return"hdr"in e&&e.hdr!=null}const ir=["linear","srgb","reinhard","aces"];function sr(e){return e&&ir.includes(e)?e:"srgb"}const Se=e=>Number.isFinite(e)?e:0;function cr(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function lr(e){const{h:t,w:n,c:r}=cr(e.shape),o=e.data,a=new Float32Array(n*t*4);for(let c=0;c<n*t;c++){const l=c*r;let u,f,M,h=1;r===1?u=f=M=Se(o[l]):r===3?(u=Se(o[l]),f=Se(o[l+1]),M=Se(o[l+2])):(u=Se(o[l]),f=Se(o[l+1]),M=Se(o[l+2]),h=Se(o[l+3]));const E=c*4;a[E]=u,a[E+1]=f,a[E+2]=M,a[E+3]=h}return{data:a,width:n,height:t,format:"rgba32float"}}function Xt(e,t,n,r){if(n<=0||r<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const o=Math.min(t.width/n,t.height/r),a=n*o,c=r*o,l=(t.width-a)/2,u=(t.height-c)/2,f=Math.max(e.zoom,1e-6),M=t.width/(f*a),h=t.height/(f*c),E=-l/a-e.pan.x/(f*a),m=-u/c-e.pan.y/(f*c);return{x:E,y:m,w:M,h}}function Ht(e,t,n,r){const o=e.w*n,a=e.h*r;return o<=0||a<=0||t.width<=0||t.height<=0?0:Math.min(t.width/o,t.height/a)}const ur={zoom:1,pan:{x:0,y:0}};function dr(e){var J,de;const t=ar(e),n=s.useRef(null),r=s.useRef(null),o=s.useRef(null),a=s.useRef(null),c=s.useRef(!1),[l,u]=s.useState(!1),[f,M]=s.useState(!1),[h,E]=s.useState(null),[m,b]=s.useState(0),[d,v]=s.useState(0),[y,p]=s.useState({x:0,y:0,w:1,h:1}),w=s.useRef(null),P=s.useRef(null),[g,C]=s.useState(0),[L,B]=s.useState(e.pixelValueNotation??"decimal"),[N,H]=s.useState(!1),O=e.zoom??1,_=e.pan??{x:0,y:0},k=e.onViewportChange,G=t?"none":e.colormap??"none",z=nt();s.useEffect(()=>{const x=n.current;if(!x)return;let A=!1;return Ge().then(S=>{if(A)return;const T=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,I=S.capabilities.hdr&&T&&t;c.current=I,zn(x,{hdr:I}).then(U=>{if(A){kt(U);return}a.current=U,M(!0)}).catch(U=>{A||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",U),u(!0))})}).catch(S=>{A||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",S),u(!0))}),()=>{A=!0,a.current&&(kt(a.current),a.current=null)}},[]);const{containerProps:q}=ke({containerRef:r,zoom:O,pan:_,onViewportChange:k,naturalWidth:h==null?void 0:h.w,naturalHeight:h==null?void 0:h.h}),ne=s.useCallback(()=>{k==null||k(ur)},[k]);s.useEffect(()=>{const x=r.current;if(!x)return;const A=new ResizeObserver(()=>v(S=>S+1));return A.observe(x),()=>A.disconnect()},[]),s.useEffect(()=>{const x=r.current;if(!x)return;const A=new IntersectionObserver(S=>{const T=S[0];if(!T)return;const I=a.current;I&&(I.setVisible(T.isIntersecting),T.isIntersecting?I.isParked&&(I.restore(),v(U=>U+1)):I.park())},{threshold:0});return A.observe(x),()=>A.disconnect()},[]),s.useEffect(()=>{var S;if(!t||!f)return;const x=e.hdr;w.current=x;const A=lr(x);(S=a.current)==null||S.setSource(A),E(T=>T&&T.w===A.width&&T.h===A.height?T:{w:A.width,h:A.height}),C(T=>T+1),b(T=>T+1)},[t,f,t?e.hdr:null]),s.useEffect(()=>{if(t||!f)return;const x=e,A=x.imageUrl,S=x.colormap??"none";if(!A){P.current=null,E(null),C(I=>I+1);return}let T=!1;return Ce(A).then(I=>{var R,D;if(T||!I)return;let U=I;if(S!=="none"){const F=`gpu::${A}::${S}`,W=He(F);if(W)U=W;else{const $=ft.has(S)?"positive":"linear";U=Xe(I,S,$),Ye(F,U)}}P.current=I;const Z={data:U.data,width:U.width,height:U.height,format:"rgba8unorm"};(R=a.current)==null||R.setSource(Z),E(F=>F&&F.w===U.width&&F.h===U.height?F:{w:U.width,h:U.height}),(D=x.onNaturalSize)==null||D.call(x,U.width,U.height),C(F=>F+1),b(F=>F+1)}),()=>{T=!0}},[t,f,t?null:e.imageUrl,t?null:e.colormap]);const ee=t?e.exposure??0:0,le=t?e.tonemap:void 0,ae=t?e.gamma:void 0,fe=s.useCallback(()=>{const x=a.current;if(!x||!f||!h)return;const A=r.current,S=o.current,T=S?S.getBoundingClientRect():A?A.getBoundingClientRect():{width:h.w,height:h.h},I=Xt({zoom:O,pan:_},T,h.w,h.h);p(D=>D.x===I.x&&D.y===I.y&&D.w===I.w&&D.h===I.h?D:I),T.width>0&&T.height>0&&x.resize(Math.round(T.width*z),Math.round(T.height*z));const U=Ht(I,T,h.w,h.h)>=ot?"nearest":"linear",Z=I,R=t?{exposureEV:ee,operator:c.current?"extended":sr(le),gamma:ae,isScalar:!1,hdrOut:c.current,uv:Z,filter:U}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:Z,filter:U};try{x.render(R)||u(!0)}catch(D){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",D),u(!0)}},[f,h,O,_.x,_.y,ee,le,ae,t,z]);s.useEffect(()=>{fe()},[fe,m,d]);const pe=Wt({rootRef:r,canvasRef:n,zoom:O,pan:_,onViewportChange:k,naturalWidth:h==null?void 0:h.w,naturalHeight:h==null?void 0:h.h,requestRender:fe}),re=s.useCallback((x,A,S)=>{if(t){const W=w.current,$=h;if(!W||!$||x<0||A<0||x>=$.w||A>=$.h)return null;const K=W.shape.length===2?1:W.shape[2]??1,me=(A*$.w+x)*K,we=W.data,te=.5;return K===1?{lines:[Q(we[me]??0,"unit",S)],luminance:te}:{lines:[Q(we[me]??0,"unit",S),Q(we[me+1]??0,"unit",S),Q(we[me+2]??0,"unit",S)],luminance:te,colors:[ce[0],ce[1],ce[2]]}}const T=P.current;if(!T||x<0||A<0||x>=T.width||A>=T.height)return null;const I=(A*T.width+x)*4,U=T.data[I],Z=T.data[I+1],R=T.data[I+2],D=(.299*U+.587*Z+.114*R)/255;return G!=="none"||U===Z&&Z===R?{lines:[Q(U,"uint8",S)],luminance:D}:{lines:[Q(U,"uint8",S),Q(Z,"uint8",S),Q(R,"uint8",S)],luminance:D,colors:[ce[0],ce[1],ce[2]]}},[t,h,G]),ue=e.showAxes??!1,ve=t?e.label??"":e.label,ie=e.interpolation??"auto",be=ie==="auto"?void 0:ie,oe=t?void 0:e.overlay,se=t?void 0:e.overlaySettings,X=t?!1:e.isDraggable??!1,Y=t?void 0:e.onDragStart;return l?t?i.jsx(qn,{hdr:e.hdr,tonemap:e.tonemap,exposure:e.exposure,gamma:e.gamma,showAxes:ue,label:ve,interpolation:ie,zoom:e.zoom,pan:e.pan,onViewportChange:k,pixelValueNotation:e.pixelValueNotation}):i.jsx(Lt,{imageUrl:e.imageUrl,baselineUrl:e.baselineUrl??null,isBaseline:e.isBaseline,diffMode:e.diffMode??"none",interpolation:ie,colormap:G,showAxes:ue,processing:e.processing,zoom:e.zoom,pan:e.pan,onViewportChange:k,onNaturalSize:e.onNaturalSize,label:ve,isDraggable:X,onDragStart:Y,className:e.className,overlay:oe,overlaySettings:se,pixelValueNotation:e.pixelValueNotation}):i.jsxs("div",{className:"group relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":f,children:[i.jsx(Vt,{controller:pe,config:zt}),i.jsxs("div",{ref:r,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded",style:{padding:ue&&h?"16px 4px 4px 28px":0,...q.style},onPointerDown:q.onPointerDown,onPointerMove:q.onPointerMove,onPointerUp:q.onPointerUp,onPointerCancel:q.onPointerCancel,onDoubleClick:ne,"data-gpu-image-viewport":!0,children:[i.jsxs("div",{ref:o,className:"relative w-full h-full flex items-center justify-center cairn-checkerboard",children:[i.jsx("canvas",{ref:n,className:"w-full h-full block",style:{imageRendering:be},"data-gpu-image-canvas":!0}),ue&&h&&i.jsx(Qe,{naturalWidth:h.w,naturalHeight:h.h,zoom:O,containerRef:o}),oe&&(se==null?void 0:se.enabled)&&h&&((((J=oe.boxes)==null?void 0:J.length)??0)>0||(((de=oe.masks)==null?void 0:de.length)??0)>0)&&i.jsx(rt,{data:oe,settings:se,naturalWidth:h.w,naturalHeight:h.h})]}),h&&i.jsx(ye,{imageElRef:n,naturalWidth:h.w,naturalHeight:h.h,zoom:O,pan:_,sourceWindow:y,sample:re,notation:L,version:g,onActiveChange:H}),N&&i.jsx(Re,{notation:L,onChange:B})]}),ve?i.jsx(Je,{label:ve,isDraggable:X,onDragStart:Y}):null]})}const fr={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function hr({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:o,onSplitPositionChange:a,zoom:c,pan:l,onViewportChange:u,processing:f=fr,interpolation:M="auto",label:h="",isDraggable:E=!1,onDragStart:m,overlay:b,overlaySettings:d,pixelValueNotation:v="decimal"}){var oe,se;const y=s.useRef(null),[p,w]=s.useState(null),[P,g]=s.useState(null),[C,L]=s.useState(v),[B,N]=s.useState(!1),H=s.useRef(null),O=s.useRef(null),_=s.useRef(null),k=s.useRef(null),[G,z]=s.useState(0);s.useEffect(()=>{if(!e){_.current=null,z(Y=>Y+1);return}let X=!1;return Ce(e).then(Y=>{X||(_.current=Y,z(J=>J+1))}),()=>{X=!0}},[e]),s.useEffect(()=>{if(!t){k.current=null,z(Y=>Y+1);return}let X=!1;return Ce(t).then(Y=>{X||(k.current=Y,z(J=>J+1))}),()=>{X=!0}},[t]);const q=X=>(Y,J,de)=>{const x=X.current;if(!x||Y<0||J<0||Y>=x.width||J>=x.height)return null;const A=(J*x.width+Y)*4,S=x.data[A],T=x.data[A+1],I=x.data[A+2],U=(.299*S+.587*T+.114*I)/255;return S===T&&T===I?{lines:[Q(S,"uint8",de)],luminance:U}:{lines:[Q(S,"uint8",de),Q(T,"uint8",de),Q(I,"uint8",de)],luminance:U,colors:[ce[0],ce[1],ce[2]]}},ne=s.useMemo(()=>q(_),[]),ee=s.useMemo(()=>q(k),[]),le=!!b&&!!(d!=null&&d.enabled)&&!!p&&!!e&&((((oe=b.boxes)==null?void 0:oe.length)??0)>0||(((se=b.masks)==null?void 0:se.length)??0)>0),{gammaFilterId:ae,filterStr:fe,gamma:pe,offset:re}=Rt(f),ue=`translate(${l.x}px, ${l.y}px) scale(${c})`,ve=M==="auto"?void 0:M,{containerProps:ie,modifierActive:be}=ke({containerRef:y,zoom:c,pan:l,onViewportChange:u});return i.jsxs("div",{className:"relative flex flex-col h-full",children:[i.jsx(Ot,{id:ae,gamma:pe,offset:re}),i.jsxs("div",{ref:y,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...ie.style},onPointerDown:ie.onPointerDown,onPointerMove:ie.onPointerMove,onPointerUp:ie.onPointerUp,onPointerCancel:ie.onPointerCancel,children:[i.jsxs("div",{className:"relative w-full h-full",children:[i.jsxs("div",{className:"relative w-full h-full",style:{transform:ue,transformOrigin:"0 0"},children:[i.jsx("img",{ref:H,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:fe,imageRendering:ve,...n==="blend"?{opacity:o}:{}},onLoad:X=>{const Y=X.currentTarget;w({w:Y.naturalWidth,h:Y.naturalHeight})}}),le&&i.jsx(rt,{data:b,settings:d,naturalWidth:p.w,naturalHeight:p.h})]}),i.jsx("div",{className:"absolute inset-0 overflow-hidden",style:n==="split"?{clipPath:`inset(0 ${(1-r)*100}% 0 0)`}:void 0,children:i.jsx("div",{className:"w-full h-full",style:{transform:ue,transformOrigin:"0 0"},children:i.jsx("img",{ref:O,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:fe,imageRendering:ve,...n==="blend"?{opacity:1-o}:{}},onLoad:X=>{const Y=X.currentTarget;g({w:Y.naturalWidth,h:Y.naturalHeight})}})})}),n==="split"&&i.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>a==null?void 0:a(.5),onPointerDown:X=>{X.stopPropagation(),X.preventDefault();const J=X.currentTarget.parentElement.getBoundingClientRect(),de=A=>{a==null||a(Math.max(0,Math.min(1,(A.clientX-J.left)/J.width)))},x=()=>{window.removeEventListener("pointermove",de),window.removeEventListener("pointerup",x)};window.addEventListener("pointermove",de),window.addEventListener("pointerup",x)},children:i.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?i.jsxs(i.Fragment,{children:[t&&P&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:i.jsx(ye,{imageElRef:O,naturalWidth:P.w,naturalHeight:P.h,zoom:c,pan:l,sample:ee,notation:C,version:G})}),e&&p&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:i.jsx(ye,{imageElRef:H,naturalWidth:p.w,naturalHeight:p.h,zoom:c,pan:l,sample:ne,notation:C,version:G,onActiveChange:N})})]}):e&&p&&i.jsx(ye,{imageElRef:H,naturalWidth:p.w,naturalHeight:p.h,zoom:c,pan:l,sample:ne,notation:C,version:G,onActiveChange:N}),B&&i.jsx(Re,{notation:C,onChange:L})]}),i.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),i.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${E&&!be?" cairn-drag-grip":""}`,draggable:E&&!be,onDragStart:m,style:{cursor:E&&!be?"grab":void 0},children:[i.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),h]})]})}const gr={zoom:1,pan:{x:0,y:0}};function mr(e){const t=We(e),n=new Float32Array(256*4);for(let r=0;r<256;r++)n[r*4+0]=t[r*3+0]/255,n[r*4+1]=t[r*3+1]/255,n[r*4+2]=t[r*3+2]/255,n[r*4+3]=1;return n}function pr({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:o,onSplitPositionChange:a,diffSubmode:c,colormap:l="none",zoom:u,pan:f,onViewportChange:M,interpolation:h="auto",label:E="",pixelValueNotation:m="decimal"}){const b=s.useRef(null),d=s.useRef(null),v=s.useRef(null),[y,p]=s.useState(!1),[w,P]=s.useState(!1),[g,C]=s.useState(null),[L,B]=s.useState(0),[N,H]=s.useState(0),[O,_]=s.useState(null),[k,G]=s.useState(m),[z,q]=s.useState(!1),[ne,ee]=s.useState({x:0,y:0,w:1,h:1}),le=s.useRef(null),ae=s.useRef(null),[fe,pe]=s.useState(0),re=nt();s.useEffect(()=>{const x=d.current;if(!x)return;let A=!1;return Ge().then(S=>{if(!A)try{if(Ct())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const T=S.createSurface(x,{hdr:!1});v.current={device:S,surface:T,texA:null,texB:null},P(!0)}catch(T){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",T),p(!0)}}).catch(S=>{A||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",S),p(!0))}),()=>{var T,I;A=!0;const S=v.current;S&&((T=S.texA)==null||T.destroy(),(I=S.texB)==null||I.destroy(),v.current=null)}},[]),s.useEffect(()=>{const x=b.current;if(!x)return;const A=new ResizeObserver(()=>H(S=>S+1));return A.observe(x),()=>A.disconnect()},[]),s.useEffect(()=>{if(!w)return;let x=!1;if(!v.current)return;async function S(T){return T?Ce(T):null}return Promise.all([S(e),S(t)]).then(([T,I])=>{var D,F;if(x||!v.current)return;const U=v.current;le.current=T,ae.current=I,(D=U.texA)==null||D.destroy(),(F=U.texB)==null||F.destroy(),U.texA=null,U.texB=null;const Z=T??I;if(!Z){C(null),pe(W=>W+1);return}const R=W=>{const $=U.device.createTexture(W.width,W.height,"rgba8unorm");return $.write(W.data),$};U.texA=R(I??Z),U.texB=R(T??Z),C({w:Z.width,h:Z.height}),pe(W=>W+1),B(W=>W+1)}),()=>{x=!0}},[w,e,t]);const ue=s.useMemo(()=>(c??"").includes("signed")?"signed":"positive",[c]),ve=s.useMemo(()=>l!=="none"?mr(l):void 0,[l]),ie=s.useCallback(()=>{const x=v.current;if(!w||!x||!x.surface||!x.texA||!x.texB||!g)return;const A=b.current,S=A?A.getBoundingClientRect():{width:g.w,height:g.h},T=Xt({zoom:u,pan:f},S,g.w,g.h);ee(D=>D.x===T.x&&D.y===T.y&&D.w===T.w&&D.h===T.h?D:T);const I=d.current;if(S.width>0&&S.height>0&&I&&x.surface){const D=Math.max(1,Math.round(S.width*re)),F=Math.max(1,Math.round(S.height*re));(I.width!==D||I.height!==F)&&(I.width=D,I.height=F,x.surface.configure(D,F))}const U=Ht(T,S,g.w,g.h)>=ot?"nearest":"linear",R={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:T,filter:U,mode:n,split:r,alpha:o,diffSubmode:c??"absolute",diffCmapMode:ue,diffColormap:n==="diff"?ve:void 0};try{Gn(x.device,x.surface,x.texA,x.texB,R)}catch(D){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",D),p(!0)}},[w,g,u,f.x,f.y,n,r,o,c,ue,ve,re]);s.useEffect(()=>{ie()},[ie,L,N]),s.useEffect(()=>{const x=v.current;if(!w||!x||!x.texA||!x.texB||!t){_(null);return}let A=!1;return Fn(x.device,x.texA,x.texB).then(S=>{A||_(S)}),()=>{A=!0}},[w,L,t]);const be=x=>(A,S,T)=>{const I=x.current;if(!I||A<0||S<0||A>=I.width||S>=I.height)return null;const U=(S*I.width+A)*4,Z=I.data[U],R=I.data[U+1],D=I.data[U+2],F=(.299*Z+.587*R+.114*D)/255;return Z===R&&R===D?{lines:[Q(Z,"uint8",T)],luminance:F}:{lines:[Q(Z,"uint8",T),Q(R,"uint8",T),Q(D,"uint8",T)],luminance:F,colors:[ce[0],ce[1],ce[2]]}},oe=s.useMemo(()=>be(le),[]),se=s.useMemo(()=>be(ae),[]),{containerProps:X}=ke({containerRef:b,zoom:u,pan:f,onViewportChange:M,naturalWidth:g==null?void 0:g.w,naturalHeight:g==null?void 0:g.h}),Y=s.useCallback(()=>M==null?void 0:M(gr),[M]),J=h==="auto"?void 0:h,de=Wt({rootRef:b,canvasRef:d,zoom:u,pan:f,onViewportChange:M,naturalWidth:g==null?void 0:g.w,naturalHeight:g==null?void 0:g.h,requestRender:ie});return y?n==="diff"?i.jsx(Lt,{imageUrl:e,baselineUrl:t,diffMode:c??"signed",interpolation:h,colormap:l,showAxes:!1,zoom:u,pan:f,onViewportChange:M,label:E,pixelValueNotation:m}):i.jsx(hr,{imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:o,onSplitPositionChange:a,zoom:u,pan:f,onViewportChange:M,interpolation:h,label:E,pixelValueNotation:m}):i.jsxs("div",{className:"group relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":w,children:[i.jsx(Vt,{controller:de,config:{...zt,position:"bottom-left"}}),i.jsxs("div",{ref:b,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...X.style},onPointerDown:X.onPointerDown,onPointerMove:X.onPointerMove,onPointerUp:X.onPointerUp,onPointerCancel:X.onPointerCancel,onDoubleClick:Y,"data-gpu-compare-viewport":!0,children:[i.jsxs("div",{className:"relative w-full h-full flex items-center justify-center",children:[i.jsx("canvas",{ref:d,className:"w-full h-full block",style:{imageRendering:J},"data-gpu-compare-canvas":!0}),n==="split"&&i.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:x=>{x.stopPropagation(),a==null||a(.5)},onPointerDown:x=>{x.stopPropagation(),x.preventDefault();const S=x.currentTarget.parentElement.getBoundingClientRect(),T=U=>{a==null||a(Math.max(0,Math.min(1,(U.clientX-S.left)/S.width)))},I=()=>{window.removeEventListener("pointermove",T),window.removeEventListener("pointerup",I)};window.addEventListener("pointermove",T),window.addEventListener("pointerup",I)},children:i.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?i.jsxs(i.Fragment,{children:[t&&g&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:i.jsx(ye,{imageElRef:d,naturalWidth:g.w,naturalHeight:g.h,zoom:u,pan:f,sourceWindow:ne,sample:se,notation:k,version:fe})}),t&&g&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:i.jsx(ye,{imageElRef:d,naturalWidth:g.w,naturalHeight:g.h,zoom:u,pan:f,sourceWindow:ne,sample:oe,notation:k,version:fe,onActiveChange:q})})]}):g&&i.jsx(ye,{imageElRef:d,naturalWidth:g.w,naturalHeight:g.h,zoom:u,pan:f,sourceWindow:ne,sample:oe,notation:k,version:fe,onActiveChange:q}),z&&i.jsx(Re,{notation:k,onChange:G})]}),i.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),E?i.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:E}):null,O&&i.jsxs("span",{className:`absolute right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${z?"top-8":"top-1"}`,"data-gpu-compare-metrics":!0,children:["MSE ",O.mse.toExponential(2)," · PSNR ",Number.isFinite(O.psnr)?O.psnr.toFixed(1):"∞"," dB · MAE"," ",O.mae.toExponential(2)]})]})}const vr="cairn-plot:gpu-image-ready";async function br(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Ge(),window.__cairnPlotGpuImagePane=dr,window.__cairnPlotGpuComparePane=pr,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(vr))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}br()})(__cairnPlotJsxRuntime,__cairnPlotReact);

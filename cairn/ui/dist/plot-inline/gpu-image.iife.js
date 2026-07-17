var Qn=Object.defineProperty;var Jn=(s,a,_e)=>a in s?Qn(s,a,{enumerable:!0,configurable:!0,writable:!0,value:_e}):s[a]=_e;var Q=(s,a,_e)=>Jn(s,typeof a!="symbol"?a+"":a,_e);(function(s,a){"use strict";const _e=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function ot(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"premultiplied",usage:_e}),{hdr:!1,format:n}}function kt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:_e}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:_e}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return ot(e,t)}}}const Gt=`
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
`;function Ne(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function at(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Ot(e){const t=(e&32768)>>15,n=(e&31744)>>10,r=e&1023;let i;return n===0?i=r/1024*Math.pow(2,-14):n===31?i=r?NaN:1/0:i=(1+r/1024)*Math.pow(2,n-15),t?-i:i}const Ft={texture:0,sampler:1,uniform:2};function Ve(e,t){return e*3+Ft[t]}const Bt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Nt(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let r;for(;(r=n.exec(e))!==null;){const i=Number(r[1]),o=r[2]!==void 0,l=r[3].trim();if(o){const u=Bt[l];if(u===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${l}" (binding ${i}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(i,{kind:"uniform",sizeBytes:u})}else l==="sampler"||l==="sampler_comparison"?t.set(i,{kind:"sampler"}):t.set(i,{kind:"texture"})}return t}class st{constructor(t,n,r,i){Q(this,"width");Q(this,"height");Q(this,"format");Q(this,"gpuTexture");Q(this,"device");Q(this,"destroyed",!1);this.device=t,this.width=n,this.height=r,this.format=i,this.gpuTexture=t.createTexture({size:{width:n,height:r,depthOrArrayLayers:1},format:Ne(i),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*at(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class ct{constructor(t){Q(this,"_s");Q(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Vt{constructor(t,n,r,i,o){Q(this,"_p");Q(this,"gpuPipeline");Q(this,"bindings");Q(this,"bindGroupLayout");Q(this,"variants");Q(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=r,this.buildVariant=o,this.variants=new Map([[i,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function Wt(e,t){const n=[];for(const[r,i]of t)i.kind==="uniform"?n.push({binding:r,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):i.kind==="sampler"?n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class $t{constructor(t){Q(this,"_c");Q(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class Xt{constructor(t,n){Q(this,"_b");Q(this,"gpuBindGroup");Q(this,"ownedBuffers");Q(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class zt{constructor(t,n,r,i){Q(this,"canvas");Q(this,"hdr");Q(this,"format");Q(this,"context");Q(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=r.hdr,this.format=r.format,this.reconfigure=i}configure(t,n){this.canvas.width=t,this.canvas.height=n;const r=this.reconfigure();this.hdr=r.hdr,this.format=r.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function ke(e){return"canvas"in e}async function Ht(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let r=null;function i(){return r||(r=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),r}function o(d){return ke(d)?d.getCurrentTextureView():d.gpuTexture.createView()}function l(d){if(ke(d))return{width:d.canvas.width,height:d.canvas.height};const v=d;return{width:v.width,height:v.height}}let u=!1;const w=256;let h=null,T=null;function g(){if(!h||!T){const d=t.createShaderModule({code:Gt});T=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const v=t.createPipelineLayout({bindGroupLayouts:[T]});h=t.createComputePipeline({layout:v,compute:{module:d,entryPoint:"cs_main"}})}return{pipeline:h,layout:T}}return{backend:"webgpu",capabilities:n,createTexture(d,v,c){return new st(t,d,v,c)},createSampler(d){const v=(d==null?void 0:d.filter)==="linear"?"linear":"nearest",c=t.createSampler({magFilter:v,minFilter:v,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new ct(c)},createRenderPipeline(d){const v=t.createShaderModule({code:d.shaderWGSL}),c=Nt(d.shaderWGSL),m=Ne(d.targetFormat),y=Wt(t,c),f=t.createPipelineLayout({bindGroupLayouts:[y]}),x=p=>t.createRenderPipeline({layout:f,vertex:{module:v,entryPoint:"vs_main"},fragment:{module:v,entryPoint:"fs_main",targets:[{format:p}]},primitive:{topology:"triangle-list"}}),S=x(m);return new Vt(S,c,y,m,x)},createComputePipeline(d){const v=t.createShaderModule({code:d.shaderWGSL}),c=t.createComputePipeline({layout:"auto",compute:{module:v,entryPoint:"cs_main"}});return new $t(c)},createBindGroup(d,v){const c=d,m=new Map,y=[];for(const[x,S]of c.bindings)if(S.kind==="uniform"){const p=t.createBuffer({size:S.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});y.push(p),m.set(x,{binding:x,resource:{buffer:p}})}else S.kind==="sampler"&&m.set(x,{binding:x,resource:i()});for(const x of v){const S=x.resource;if(S instanceof st){const p=Ve(x.binding,"texture");c.bindings.has(p)&&m.set(p,{binding:p,resource:S.gpuTexture.createView()})}else if(S instanceof ct){const p=Ve(x.binding,"sampler");c.bindings.has(p)&&m.set(p,{binding:p,resource:S.gpuSampler})}else{const p=Ve(x.binding,"uniform"),A=c.bindings.get(p);if(A&&A.kind==="uniform"){const G=S.uniform,O=t.createBuffer({size:Math.max(A.sizeBytes,G.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(O,0,G.buffer,G.byteOffset,G.byteLength),y.push(O),m.set(p,{binding:p,resource:{buffer:O}})}}}const f=t.createBindGroup({layout:c.bindGroupLayout,entries:Array.from(m.values())});return new Xt(f,y)},createSurface(d,v){const c=d.getContext("webgpu");if(!c)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const m=v.hdr&&n.hdr,y=()=>m?kt(c,t):ot(c,t),f=y();return new zt(d,c,f,y)},renderFullscreen(d,v,c){const m=v,y=c,f=o(d),{width:x,height:S}=l(d),p=ke(d)?d.format:Ne(d.format),A=m.pipelineFor(p),G=t.createCommandEncoder(),O=G.beginRenderPass({colorAttachments:[{view:f,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});O.setPipeline(A),O.setBindGroup(0,y.gpuBindGroup),O.setViewport(0,0,x,S,0,1),O.draw(3),O.end(),t.queue.submit([G.finish()])},async readback(d){const v=ke(d),{width:c,height:m}=l(d),y=v?d.hdr?"rgba16float":"rgba8unorm":d.format,f=v&&d.format==="bgra8unorm",x=v?d.getCurrentGPUTexture():d.gpuTexture,S=at(y),p=c*S,A=256,G=Math.ceil(p/A)*A,O=G*m,W=t.createBuffer({size:O,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),q=t.createCommandEncoder();q.copyTextureToBuffer({texture:x},{buffer:W,bytesPerRow:G,rowsPerImage:m},{width:c,height:m,depthOrArrayLayers:1}),t.queue.submit([q.finish()]),await W.mapAsync(GPUMapMode.READ);const L=new Uint8Array(W.getMappedRange()),_=new Uint8Array(p*m);for(let I=0;I<m;I++){const F=I*G,V=I*p;_.set(L.subarray(F,F+p),V)}if(W.unmap(),W.destroy(),y==="rgba8unorm"){if(f)for(let I=0;I<_.length;I+=4){const F=_[I],V=_[I+2];_[I]=V,_[I+2]=F}return _}if(y==="rgba16float"){const I=new Uint16Array(_.buffer,_.byteOffset,_.byteLength/2),F=new Float32Array(I.length);for(let V=0;V<I.length;V++)F[V]=Ot(I[V]);return F}return new Float32Array(_.buffer,_.byteOffset,_.byteLength/4)},async reduceDiffSumSquaredAbs(d,v,c,m){const y=d,f=v,x=Math.max(0,c*m),S=Math.max(1,Math.ceil(x/w)),{pipeline:p,layout:A}=g(),G=S*2*4,O=t.createBuffer({size:G,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),W=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(W,0,new Uint32Array([Math.max(1,c),Math.max(1,m),x,0]));const q=t.createBindGroup({layout:A,entries:[{binding:0,resource:y.gpuTexture.createView()},{binding:1,resource:f.gpuTexture.createView()},{binding:2,resource:{buffer:O}},{binding:3,resource:{buffer:W}}]}),L=t.createBuffer({size:G,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),_=t.createCommandEncoder(),I=_.beginComputePass();I.setPipeline(p),I.setBindGroup(0,q),I.dispatchWorkgroups(S),I.end(),_.copyBufferToBuffer(O,0,L,0,G),t.queue.submit([_.finish()]),await L.mapAsync(GPUMapMode.READ);const V=new Float32Array(L.getMappedRange()).slice();L.unmap(),L.destroy(),O.destroy(),W.destroy();let j=0,ne=0;for(let ee=0;ee<S;ee++)j+=V[ee*2],ne+=V[ee*2+1];return{sumSq:j,sumAbs:ne}},destroy(){u||(t.destroy(),u=!0)},isContextLost(){return!1}}}let We=null;async function Yt(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return Ht()}function Ge(){return We||(We=Yt()),We}function qt(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function jt(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const i=n/255*(e.length-1),o=Math.floor(i),l=Math.min(o+1,e.length-1),u=i-o,[w,h,T]=qt(e[o],e[l],u);t[n*3]=Math.round(w),t[n*3+1]=Math.round(h),t[n*3+2]=Math.round(T)}return t}const lt={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},ut=new Set(["red-green","red-blue"]),dt=new Map;function $e(e){let t=dt.get(e);if(!t){const n=lt[e]??lt.viridis;t=jt(n),dt.set(e,t)}return t}function Xe(e,t,n="linear"){const r=$e(t),i=new ImageData(e.width,e.height),o=e.data,l=i.data;for(let u=0;u<o.length;u+=4){const w=(o[u]+o[u+1]+o[u+2])/3;let h;n==="positive"?h=Math.round(128+w/255*127):h=Math.round(w),h=Math.max(0,Math.min(255,h)),l[u]=r[h*3],l[u+1]=r[h*3+1],l[u+2]=r[h*3+2],l[u+3]=o[u+3]}return i}function ft(e){const t=new Map;return{get(n){return t.get(n)},set(n,r){if(t.size>=e){const i=t.keys().next().value;i!==void 0&&t.delete(i)}t.set(n,r)}}}const ht=ft(50);function ze(e){return ht.get(e)}function He(e,t){ht.set(e,t)}const gt=ft(100);function Kt(e){return gt.get(e)}function Zt(e,t){gt.set(e,t)}function Qt(e,t,n){const r=Math.min(e.width,t.width),i=Math.min(e.height,t.height),o=new ImageData(r,i);for(let l=0;l<i;l++)for(let u=0;u<r;u++){const w=(l*e.width+u)*4,h=(l*t.width+u)*4,T=(l*r+u)*4;for(let g=0;g<3;g++){const M=e.data[w+g],d=t.data[h+g],v=M-d,c=Math.abs(v),m=Math.max(M,1);let y;switch(n){case"signed":y=(v+255)/2;break;case"absolute":y=c;break;case"squared":y=v*v/255;break;case"relative_signed":y=(v/m+1)*127.5;break;case"relative_absolute":y=c/m*255;break;case"relative_squared":y=v*v/(m*m)*255;break}o.data[T+g]=Math.min(255,Math.max(0,Math.round(y)))}o.data[T+3]=255}return o}async function Re(e){const t=Kt(e);return t||new Promise(n=>{const r=new Image;r.onload=()=>{try{const i=document.createElement("canvas");i.width=r.naturalWidth,i.height=r.naturalHeight;const o=i.getContext("2d");if(!o){n(null);return}o.drawImage(r,0,0);const l=o.getImageData(0,0,i.width,i.height);Zt(e,l),n(l)}catch(i){console.warn("[cairn] loadImageData failed:",i),n(null)}},r.onerror=i=>{console.warn("[cairn] loadImageData: image failed to load:",e,i),n(null)},r.src=e})}const Jt={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},en={linear:0,signed:1,positive:2},tn=`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,nn=`#version 300 es
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
}`;let Ce=null,B=null,me=null,Oe=null;function rn(){if(B)return B;try{if(typeof OffscreenCanvas<"u"?Ce=new OffscreenCanvas(1,1):Ce=document.createElement("canvas"),B=Ce.getContext("webgl2",{preserveDrawingBuffer:!0}),!B)return console.warn("[cairn] WebGL 2 not available"),null;const e=B.createShader(B.VERTEX_SHADER);if(B.shaderSource(e,tn),B.compileShader(e),!B.getShaderParameter(e,B.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",B.getShaderInfoLog(e)),null;const t=B.createShader(B.FRAGMENT_SHADER);if(B.shaderSource(t,nn),B.compileShader(t),!B.getShaderParameter(t,B.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",B.getShaderInfoLog(t)),null;if(me=B.createProgram(),B.attachShader(me,e),B.attachShader(me,t),B.linkProgram(me),!B.getProgramParameter(me,B.LINK_STATUS))return console.error("[cairn] WebGL program link:",B.getProgramInfoLog(me)),null;Oe=B.createVertexArray(),B.bindVertexArray(Oe);const n=B.createBuffer();B.bindBuffer(B.ARRAY_BUFFER,n),B.bufferData(B.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),B.STATIC_DRAW);const r=B.getAttribLocation(me,"a_pos");return B.enableVertexAttribArray(r),B.vertexAttribPointer(r,2,B.FLOAT,!1,0,0),B.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),B}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function mt(e,t,n){const r=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),r}function on(e,t,n){const r=new Uint8Array(1024);for(let o=0;o<256;o++)r[o*4]=t[o*3],r[o*4+1]=t[o*3+1],r[o*4+2]=t[o*3+2],r[o*4+3]=255;const i=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,i),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,r),i}function an(e,t,n,r){const i=rn();if(!i||!me||!Oe||!Ce)return null;const o=Math.min(e.width,t.width),l=Math.min(e.height,t.height);Ce.width=o,Ce.height=l,i.viewport(0,0,o,l);const u=mt(i,e,0),w=mt(i,t,1);let h=null;n.colormap?h=on(i,n.colormap,2):(h=i.createTexture(),i.activeTexture(i.TEXTURE2),i.bindTexture(i.TEXTURE_2D,h),i.texImage2D(i.TEXTURE_2D,0,i.RGBA8,1,1,0,i.RGBA,i.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),i.useProgram(me),i.uniform1i(i.getUniformLocation(me,"u_baseline"),0),i.uniform1i(i.getUniformLocation(me,"u_other"),1),i.uniform1i(i.getUniformLocation(me,"u_lut"),2),i.uniform1i(i.getUniformLocation(me,"u_diff_mode"),Jt[n.diffMode]),i.uniform1i(i.getUniformLocation(me,"u_cmap_mode"),en[n.cmapMode]??0),i.uniform1i(i.getUniformLocation(me,"u_use_colormap"),n.colormap?1:0),i.bindVertexArray(Oe),i.drawArrays(i.TRIANGLE_STRIP,0,4),i.bindVertexArray(null),r.width=o,r.height=l;const T=r.getContext("2d");return T&&(T.save(),T.scale(1,-1),T.drawImage(Ce,0,0,o,l,0,-l,o,l),T.restore()),i.deleteTexture(u),i.deleteTexture(w),i.deleteTexture(h),{width:o,height:l}}const sn={cardSettings:(e,t,n)=>`cairn:card-settings:${e}:${t}:${n}`,runLayout:e=>`cairn:run-layout:${e}`,collapsedSections:e=>`cairn:collapsed-sections:${e}`,comparisons:e=>`cairn:comparisons:${e}`,comparisonTemplates:e=>`cairn:comparison-templates:${e}`,reportTemplates:e=>`cairn:report-templates:${e}`,streamMode:"cairn:stream-mode",renderMode:"cairn:render-mode",scroll:e=>`cairn:scroll:${e}`,lastComparison:e=>`cairn:last-comparison:${e}`};function cn(){try{const e=localStorage.getItem(sn.renderMode);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const we=e=>e<0?0:e>1?1:e,Ye=e=>{const t=e<0?0:e;return t/(1+t)},qe=e=>{const t=e<0?0:e,n=t*(2.51*t+.03),r=t*(2.43*t+.59)+.14;return we(n/r)},pt={linear:([e,t,n])=>[we(e),we(t),we(n)],srgb:([e,t,n])=>[we(e),we(t),we(n)],reinhard:([e,t,n])=>[Ye(e),Ye(t),Ye(n)],aces:([e,t,n])=>[qe(e),qe(t),qe(n)],extended:([e,t,n])=>[e,t,n]},ln="srgb";function un(e){return e&&pt[e]||pt[ln]}function je(e,t){return e*2**t}function dn(e){const t=we(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function Ke(e,t){return typeof t=="number"&&t>0?we(Math.pow(we(e),1/t)):dn(e)}function vt(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Ze({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:r}){const i=vt(e),o=vt(t),l=[];for(let f=0;f<=e;f+=i)l.push(f);const u=[];for(let f=0;f<=t;f+=o)u.push(f);const w=1/n,h=8*w,T=-12*w,g=-2*w,M=r==null?void 0:r.current;let d=0,v=0,c=0,m=0;if(M){const f=M.clientWidth,x=M.clientHeight,S=f/e,p=x/t,A=Math.min(S,p);c=e*A,m=t*A,d=(f-c)/2,v=(x-m)/2}const y=M&&c>0;return s.jsxs(s.Fragment,{children:[s.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:y?v:0,transform:`translateY(${T}px)`,fontSize:h},children:l.map(f=>s.jsx("span",{className:"mono",style:{position:"absolute",left:y?d+f/e*c:`${f/e*100}%`,transform:"translateX(-50%)"},children:f},f))}),s.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:y?d:0,transform:`translateX(${g}px)`,fontSize:h},children:u.map(f=>s.jsx("span",{className:"mono",style:{position:"absolute",top:y?v+f/t*m:`${f/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*w}px`},children:f},f))})]})}function Qe({label:e,isDraggable:t,onDragStart:n}){return s.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&s.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const bt=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function Je(e){const t=bt.length;return bt[(e%t+t)%t]}function fn(e){const n=a.useRef(null),[r,i]=a.useState({w:0,h:0}),o=a.useRef(null),l=a.useRef(null);return a.useEffect(()=>{var h;const u=n.current;if(u===l.current||((h=o.current)==null||h.disconnect(),o.current=null,l.current=u,!u))return;const w=new ResizeObserver(T=>{for(const g of T)i({w:g.contentRect.width,h:g.contentRect.height})});o.current=w,w.observe(u)}),a.useEffect(()=>()=>{var u;return(u=o.current)==null?void 0:u.disconnect()},[]),{ref:n,size:r}}function hn(){const[e,t]=a.useState(!1);return a.useEffect(()=>{const n=o=>{(o.key==="Alt"||o.key==="Control"||o.key==="Meta")&&t(!0)},r=o=>{(o.key==="Alt"||o.key==="Control"||o.key==="Meta")&&t(!1)},i=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",r),window.addEventListener("blur",i),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",r),window.removeEventListener("blur",i)}},[]),e}const gn=.25,et=64;function mn(e,t,n,r){if(e<=0||t<=0||n<=0||r<=0)return et;const i=Math.min(n/e,r/t);return i<=0?et:Math.max(Math.max(n,r)/i,8)}function Ae(e){const{containerRef:t,zoom:n,pan:r,onViewportChange:i,minZoom:o=gn,maxZoom:l=et,naturalWidth:u,naturalHeight:w}=e,h=hn(),T=a.useRef(h);T.current=h;const g=a.useRef({zoom:n,pan:r});g.current={zoom:n,pan:r};const M=a.useRef(i);M.current=i,a.useEffect(()=>{const f=t.current;if(!f||!i)return;const x=S=>{var F;if(!T.current)return;S.preventDefault(),S.stopPropagation();const p=S.deltaY<0?1.1:1/1.1,A=g.current,G=f.getBoundingClientRect(),O=u&&w?mn(u,w,G.width,G.height):l,W=Math.max(o,Math.min(O,A.zoom*p));if(A.zoom===W)return;const q=S.clientX-G.left,L=S.clientY-G.top,_=q-(q-A.pan.x)/A.zoom*W,I=L-(L-A.pan.y)/A.zoom*W;(F=M.current)==null||F.call(M,{zoom:W,pan:{x:_,y:I}})};return f.addEventListener("wheel",x,{passive:!1}),()=>f.removeEventListener("wheel",x)},[t,!!i,o,l,u,w]);const d=a.useRef(null),v=a.useCallback(f=>{!T.current||!M.current||(f.currentTarget.setPointerCapture(f.pointerId),d.current={pointerId:f.pointerId,startX:f.clientX,startY:f.clientY,panX:g.current.pan.x,panY:g.current.pan.y})},[]),c=a.useCallback(f=>{var A;const x=d.current;if(!x||x.pointerId!==f.pointerId)return;const S=f.clientX-x.startX,p=f.clientY-x.startY;(A=M.current)==null||A.call(M,{zoom:g.current.zoom,pan:{x:x.panX+S,y:x.panY+p}})},[]),m=a.useCallback(f=>{const x=d.current;if(!(!x||x.pointerId!==f.pointerId)){try{f.currentTarget.releasePointerCapture(f.pointerId)}catch{}d.current=null}},[]),y=h&&!!i;return{containerProps:{onPointerDown:v,onPointerMove:c,onPointerUp:m,onPointerCancel:m,style:{cursor:y?"move":void 0,touchAction:y?"none":void 0}},modifierActive:h}}function tt(){const[e,t]=a.useState(()=>typeof window<"u"&&window.devicePixelRatio||1);return a.useEffect(()=>{if(typeof matchMedia>"u")return;let n=!1,r=null;const i=()=>{n||(t(window.devicePixelRatio||1),o())};function o(){if(n)return;const l=window.devicePixelRatio||1;r=matchMedia(`(resolution: ${l}dppx)`),r.addEventListener("change",i,{once:!0})}return o(),()=>{n=!0,r==null||r.removeEventListener("change",i)}},[]),e}function pn(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function wt(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function nt({data:e,settings:t,naturalWidth:n,naturalHeight:r}){const{ref:i,size:o}=fn(),l=a.useRef(null),u=a.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),w=a.useMemo(()=>{const c=o.w,m=o.h;if(c<=0||m<=0||n<=0||r<=0)return null;const y=Math.min(c/n,m/r),f=n*y,x=r*y;return{left:(c-f)/2,top:(m-x)/2,width:f,height:x}},[o.w,o.h,n,r]),h=e.masks,T=t.showMasks&&!!h&&h.length>0,g=a.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(a.useEffect(()=>{if(!T||!h)return;const c=l.current;if(!c)return;(c.width!==n||c.height!==r)&&(c.width=n,c.height=r);const m=c.getContext("2d");if(!m)return;m.clearRect(0,0,c.width,c.height);let y=!1;const f=m.createImageData(n,r),x=f.data;let S=h.length,p=!1;const A=()=>{y||p&&m.putImageData(f,0,0)},G=document.createElement("canvas");G.width=n,G.height=r;const O=G.getContext("2d",{willReadFrequently:!0});for(const W of h){const q=new Image;q.onload=()=>{if(!y){if(O){O.clearRect(0,0,n,r),O.drawImage(q,0,0,n,r);const L=O.getImageData(0,0,n,r).data;for(let _=0;_<n*r;_++){const I=L[_*4];if(I===0||u.has(I))continue;const[F,V,j]=pn(Je(I));x[_*4]=F,x[_*4+1]=V,x[_*4+2]=j,x[_*4+3]=255,p=!0}}S-=1,S===0&&A()}},q.onerror=()=>{S-=1,S===0&&A()},q.src=`data:image/png;base64,${W.png_b64}`}return()=>{y=!0}},[T,h,n,r,g]),!w)return s.jsx("div",{ref:i,className:"absolute inset-0 pointer-events-none"});const M=e.boxes??[],d=t.showBoxes&&M.length>0,v=e.class_labels??{};return s.jsxs("div",{ref:i,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[T&&s.jsx("canvas",{ref:l,className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),d&&s.jsx("svg",{className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height,overflow:"visible"},viewBox:`0 0 ${n} ${r}`,preserveAspectRatio:"none",children:M.map((c,m)=>{if(!wt(c,t,u))return null;const y=c.domain==="pixel"?1:n,f=c.domain==="pixel"?1:r,x=c.position.minX*y,S=c.position.minY*f,p=(c.position.maxX-c.position.minX)*y,A=(c.position.maxY-c.position.minY)*f;return s.jsx("rect",{x,y:S,width:p,height:A,fill:"none",stroke:Je(c.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},m)})}),d&&s.jsx("div",{className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height},children:M.map((c,m)=>{if(!wt(c,t,u))return null;const y=c.domain==="pixel"?1/n:1,f=c.domain==="pixel"?1/r:1,x=c.position.minX*y*100,S=c.position.minY*f*100,p=c.label??v[String(c.class_id)]??`#${c.class_id}`,A=c.score!=null?` ${(c.score*100).toFixed(0)}%`:"";return!p&&!A?null:s.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${x}%`,top:`${S}%`,transform:"translateY(-100%)",backgroundColor:Je(c.class_id)},children:s.jsxs("span",{className:"mono",children:[p,A]})},m)})})]})}const rt=30,ce=["#ff5a5a","#39d353","#5b9bff"];function it(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function J(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):it(e/255):it(n==="int"?e*255:e)}const vn={x:0,y:0,w:1,h:1};function xe({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:r,pan:i,sample:o,notation:l="decimal",version:u=0,onActiveChange:w,sourceWindow:h=vn}){const T=a.useRef(null),g=a.useRef(!1),M=tt(),d=a.useRef(w);d.current=w;const v=a.useCallback(m=>{var y;m!==g.current&&(g.current=m,(y=d.current)==null||y.call(d,m))},[]),c=a.useCallback(()=>{var fe;const m=T.current,y=e.current;if(!m)return;const f=window.devicePixelRatio||1,x=m.clientWidth,S=m.clientHeight;if(x===0||S===0)return;m.width!==Math.round(x*f)&&(m.width=Math.round(x*f)),m.height!==Math.round(S*f)&&(m.height=Math.round(S*f));const p=m.getContext("2d");if(!p)return;if(p.setTransform(f,0,0,f,0,0),p.clearRect(0,0,x,S),!y||t<=0||n<=0){v(!1);return}const A=y.getBoundingClientRect(),G=m.getBoundingClientRect();if(A.width===0||A.height===0){v(!1);return}const O=h.x*t,W=h.y*n,q=h.w*t,L=h.h*n;if(q<=0||L<=0){v(!1);return}const _=Math.min(A.width/q,A.height/L);if(_<rt){v(!1);return}const I=q*_,F=L*_,V=A.left+(A.width-I)/2-G.left,j=A.top+(A.height-F)/2-G.top,ne=Math.max(Math.floor(O),Math.floor(O+(0-V)/_)),ee=Math.min(Math.ceil(O+q),Math.ceil(O+(x-V)/_)),le=Math.max(Math.floor(W),Math.floor(W+(0-j)/_)),oe=Math.min(Math.ceil(W+L),Math.ceil(W+(S-j)/_));if(ee<=ne||oe<=le){v(!1);return}v(!0);const pe=V+(0-O)*_,ue=j+(0-W)*_,te=V+(t-O)*_,de=j+(n-W)*_;p.save(),p.beginPath(),p.rect(pe,ue,te-pe,de-ue),p.clip(),p.textAlign="center",p.textBaseline="middle",p.lineJoin="round";const be=_*.14,ae=_-be*2;for(let he=le;he<oe;he++)for(let ie=ne;ie<ee;ie++){if(ie<0||he<0||ie>=t||he>=n)continue;const Y=o(ie,he,l);if(!Y||Y.lines.length===0)continue;const X=Y.lines.length;let b=1;for(const k of Y.lines)k.length>b&&(b=k.length);const R=ae/(X*1.15),P=ae/(b*.62)||R,E=Math.min(R,P,24);if(E<6)continue;const D=V+(ie-O+.5)*_,U=j+(he-W+.5)*_,z=E*1.15,K=Y.luminance<=.55,N=K?"#ffffff":"#000000";p.font=`${E}px ui-monospace, SFMono-Regular, Menlo, monospace`,p.lineWidth=Math.max(1.4,E*.16),p.strokeStyle=K?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let C=U-X*z/2+z/2;for(let k=0;k<Y.lines.length;k++){const $=Y.lines[k];p.strokeText($,D,C),p.fillStyle=((fe=Y.colors)==null?void 0:fe[k])??N,p.fillText($,D,C),C+=z}}p.restore()},[e,t,n,o,l,v,h]);return a.useEffect(()=>{c()},[c,r,i.x,i.y,u,l,h,M]),a.useEffect(()=>{const m=T.current;if(!m)return;const y=new ResizeObserver(()=>c());return y.observe(m),()=>y.disconnect()},[c]),s.jsx("canvas",{ref:T,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Ie({notation:e,onChange:t,className:n=""}){return s.jsx("button",{type:"button",onClick:r=>{r.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:r=>r.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const bn=`
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
`,wn=`
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
`,Fe={linear:0,srgb:1,reinhard:2,aces:3,extended:4},xt=new WeakMap;function xn(e,t){let n=xt.get(e);n||(n=new Map,xt.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:bn,targetFormat:t}),n.set(t,r)),r}function yt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Et(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const r=e.createTexture(256,1,"rgba32float");return r.write(t),r}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function yn(e,t,n,r){var v;const i=yt(t),o=xn(e,i),l=Et(e,r.isScalar?r.colormap:void 0),u=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,w=Fe[r.operator]??Fe.srgb,h=new Float32Array([r.exposureEV,w,u,r.isScalar?1:0]),T=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),g=new Float32Array([r.hdrOut?1:0]),M=new Float32Array([r.filter==="nearest"?0:1]);let d;try{d=e.createBindGroup(o,[{binding:0,resource:n},{binding:1,resource:l},{binding:2,resource:{uniform:h}},{binding:3,resource:{uniform:T}},{binding:4,resource:{uniform:g}},{binding:5,resource:{uniform:M}}]),e.renderFullscreen(t,o,d)}finally{(v=d==null?void 0:d.destroy)==null||v.call(d),l.destroy()}}const En={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},_n={linear:0,signed:1,positive:2},Pn={split:0,blend:1,diff:2},_t=new WeakMap;function Tn(e,t){let n=_t.get(e);n||(n=new Map,_t.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:wn,targetFormat:t}),n.set(t,r)),r}function Mn(e,t,n,r,i){var f;const o=yt(t),l=Tn(e,o),u=i.mode==="diff"&&!!i.diffColormap,w=i.isScalar?i.colormap:u?i.diffColormap:void 0,h=Et(e,w),T=typeof i.gamma=="number"&&i.gamma>0?i.gamma:0,g=Fe[i.operator]??Fe.srgb,M=new Float32Array([i.exposureEV,g,T,i.isScalar?1:0]),d=new Float32Array([i.uv.x,i.uv.y,i.uv.w,i.uv.h]),v=new Float32Array([Pn[i.mode],i.split,i.alpha,En[i.diffSubmode]??0]),c=new Float32Array([_n[i.diffCmapMode??"linear"]??0,i.hdrOut?1:0,u?1:0,0]),m=new Float32Array([i.filter==="nearest"?0:1]);let y;try{y=e.createBindGroup(l,[{binding:0,resource:n},{binding:1,resource:r},{binding:2,resource:h},{binding:3,resource:{uniform:M}},{binding:4,resource:{uniform:d}},{binding:5,resource:{uniform:v}},{binding:6,resource:{uniform:c}},{binding:7,resource:{uniform:m}}]),e.renderFullscreen(t,l,y)}finally{(f=y==null?void 0:y.destroy)==null||f.call(y),h.destroy()}}function Pt(e,t,n){if(n<=0)return{mse:0,psnr:1/0,mae:0};const r=e/n,i=t/n,o=r<=0?1/0:10*Math.log10(1/r);return{mse:r,psnr:o,mae:i}}async function Sn(e,t,n){const r=Math.min(t.width,n.width),i=Math.min(t.height,n.height),o=r*i*3;if(o<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:M,sumAbs:d}=await e.reduceDiffSumSquaredAbs(t,n,r,i);return Pt(M,d,o)}const l=await e.readback(t),u=await e.readback(n),w=l instanceof Uint8Array,h=u instanceof Uint8Array;let T=0,g=0;for(let M=0;M<i;M++)for(let d=0;d<r;d++){const v=(M*t.width+d)*4,c=(M*n.width+d)*4;for(let m=0;m<3;m++){const y=(l[v+m]??0)/(w?255:1),f=(u[c+m]??0)/(h?255:1),x=y-f;T+=x*x,g+=Math.abs(x)}}return Pt(T,g,o)}function Tt(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const Rn=12,Pe=[];function Mt(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1),Pe.push(e)}function Cn(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1)}function Be(e){e.parked||(Cn(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.parked=!0)}function St(e){for(;Pe.length>Rn;){const t=Pe.find(n=>n!==e&&!n.visible)??Pe.find(n=>n!==e);if(!t)break;Be(t)}}function Rt(e){var i,o;if(e.disposed)return;if(Tt())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Mt(e),St(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const n=e.backingWidth||((i=e.source)==null?void 0:i.width)||1,r=e.backingHeight||((o=e.source)==null?void 0:o.height)||1;if(e.canvas.width=n,e.canvas.height=r,e.surface.configure(n,r),e.source){const l=t.createTexture(e.source.width,e.source.height,e.source.format);l.write(e.source.data),e.srcTexture=l}e.parked=!1,Mt(e),St(e)}function Dn(e,t){if(e.disposed||!e.source)return!0;try{return Rt(e),!e.surface||!e.srcTexture?!1:(yn(e.device,e.surface,e.srcTexture,t),!0)}catch(n){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Be(e),!1}}function An(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},resize(t,n){if(e.disposed)return;const r=Math.max(1,Math.round(t)),i=Math.max(1,Math.round(n));e.backingWidth===r&&e.backingHeight===i||(e.backingWidth=r,e.backingHeight=i,!e.parked&&e.surface&&(e.canvas.width=r,e.canvas.height=i,e.surface.configure(r,i)))},render(t){return Dn(e,t)},park(){e.disposed||Be(e)},restore(){e.disposed||!e.source||Rt(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Be(e),e.source=null,e.disposed=!0)}}}async function In(e,t){const n=await Ge(),r={canvas:e,device:n,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return An(r)}function Ct(e){e.dispose()}function Un(e,t){const{brightness:n,contrast:r,exposure:i,flipSign:o}=e;return[`url(#${t})`,`brightness(${(1+n)*Math.pow(2,i)})`,`contrast(${1+r})`,...o?["invert(1)"]:[]].join(" ")}function Dt(e){const n=`cairn-gamma-${a.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:r,contrast:i,gamma:o,exposure:l,offset:u,flipSign:w}=e,h=a.useMemo(()=>Un(e,n),[n,r,i,l,w]);return{gammaFilterId:n,filterStr:h,gamma:o,offset:u}}function At({id:e,gamma:t,offset:n}){return s.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:s.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:s.jsxs("feComponentTransfer",{children:[s.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),s.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),s.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:n})]})})})}const Ln={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function It({imageUrl:e,baselineUrl:t,isBaseline:n=!1,diffMode:r,interpolation:i,colormap:o,showAxes:l,processing:u=Ln,zoom:w=1,pan:h={x:0,y:0},onViewportChange:T,onNaturalSize:g,label:M,isDraggable:d=!1,onDragStart:v,overlay:c,overlaySettings:m,pixelValueNotation:y="decimal"}){var K,N;const f=a.useRef(null),x=a.useRef(null),S=a.useRef(null),p=a.useRef(null),A=a.useRef(null),G=a.useRef(null),O=a.useRef(null),[W,q]=a.useState(0),L=a.useCallback(()=>q(C=>C+1),[]),[_,I]=a.useState(y),[F,V]=a.useState(!1),j=a.useCallback(C=>{f.current=C,C&&(A.current=C)},[]),ne=a.useCallback(C=>{x.current=C,C&&(A.current=C)},[]),ee=a.useCallback(C=>{C&&(A.current=C)},[]),[le,oe]=a.useState(!1),[pe,ue]=a.useState(!1),[te,de]=a.useState(null),{flipSign:be}=u,{gammaFilterId:ae,filterStr:fe,gamma:he,offset:ie}=Dt(u),Y=`translate(${h.x}px, ${h.y}px) scale(${w})`,{containerProps:X}=Ae({containerRef:p,zoom:w,pan:h,onViewportChange:T}),b=!n&&r!=="none"&&t!=null&&e!=null,R=r!=="none"&&t!=null,P=o!=="none"&&!b&&!(n&&R)&&e!=null;a.useEffect(()=>{if(!P||!e){ue(!1);return}let C=!1;ue(!1);const k=`${e}::${o}`,$=ze(k);if($){const H=x.current;if(H){H.width=$.width,H.height=$.height;const Z=H.getContext("2d");Z&&Z.putImageData($,0,0),O.current=$,L(),de({w:$.width,h:$.height}),g==null||g($.width,$.height),ue(!0)}return}const re=new Image;return re.onload=()=>{if(C)return;const H=document.createElement("canvas");H.width=re.naturalWidth,H.height=re.naturalHeight;const Z=H.getContext("2d");if(!Z)return;Z.drawImage(re,0,0);const ve=Z.getImageData(0,0,H.width,H.height),Se=ut.has(o)?"positive":"linear",se=Xe(ve,o,Se);He(k,se);const ye=x.current;if(!ye||C)return;ye.width=se.width,ye.height=se.height;const ge=ye.getContext("2d");ge&&ge.putImageData(se,0,0),O.current=se,L(),de({w:se.width,h:se.height}),g==null||g(se.width,se.height),ue(!0)},re.src=e,()=>{C=!0}},[P,e,o]);const E=a.useCallback((C,k)=>{de($=>$&&$.w===C&&$.h===k?$:{w:C,h:k}),g==null||g(C,k)},[]);a.useEffect(()=>{if(!e){G.current=null,O.current=null,L();return}let C=!1;return Re(e).then(k=>{C||(G.current=k,o==="none"&&(O.current=k),L())}),()=>{C=!0}},[e,o,L]);const D=a.useCallback((C,k,$)=>{const re=G.current;if(!re||C<0||k<0||C>=re.width||k>=re.height)return null;const H=(k*re.width+C)*4,Z=re.data[H],ve=re.data[H+1],Se=re.data[H+2],se=O.current;let ye=Z,ge=ve,Ee=Se;if(se&&se.width===re.width&&se.height===re.height){const De=(k*se.width+C)*4;ye=se.data[De],ge=se.data[De+1],Ee=se.data[De+2]}const Ue=(.299*ye+.587*ge+.114*Ee)/255;return o!=="none"||Z===ve&&ve===Se?{lines:[J(Z,"uint8",$)],luminance:Ue}:{lines:[J(Z,"uint8",$),J(ve,"uint8",$),J(Se,"uint8",$)],luminance:Ue,colors:[ce[0],ce[1],ce[2]]}},[o]);a.useEffect(()=>{if(!b){oe(!1);return}let C=!1;const k=cn(),$=k==="gpu"||k==="auto",re=`${t}::${e}::${r}::${o}`;if(k!=="gpu"){const H=ze(re);if(H){const Z=f.current;if(Z){(Z.width!==H.width||Z.height!==H.height)&&(Z.width=H.width,Z.height=H.height);const ve=Z.getContext("2d");ve&&ve.putImageData(H,0,0),E(H.width,H.height),oe(!0)}return}}return(async()=>{const[H,Z]=await Promise.all([Re(t),Re(e)]);if(C||!H||!Z)return;const Se=r.includes("signed")?"signed":"positive",se=o!=="none"?$e(o):null,ye={diffMode:r,colormap:se,cmapMode:Se};if($)try{const Le=f.current;if(Le){const De=an(H,Z,ye,Le);if(De){if(C)return;E(De.width,De.height),oe(!0);return}}}catch(Le){console.warn("[cairn] WebGL 2 diff error:",Le)}if(k==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let ge=Qt(H,Z,r);o!=="none"&&(ge=Xe(ge,o,Se)),He(re,ge);const Ee=f.current;if(!Ee||C)return;(Ee.width!==ge.width||Ee.height!==ge.height)&&(Ee.width=ge.width,Ee.height=ge.height);const Ue=Ee.getContext("2d");Ue&&Ue.putImageData(ge,0,0),E(ge.width,ge.height),oe(!0)})(),()=>{C=!0}},[t,e,r,b,o,g]);const U=i==="auto"?void 0:i,z=be?{filter:"invert(1)"}:{};return s.jsxs("div",{className:"relative flex flex-col h-full",children:[s.jsx(At,{id:ae,gamma:he,offset:ie}),s.jsxs("div",{ref:p,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:l&&te?"16px 4px 4px 28px":"4px",...X.style},onPointerDown:X.onPointerDown,onPointerMove:X.onPointerMove,onPointerUp:X.onPointerUp,onPointerCancel:X.onPointerCancel,children:[s.jsxs("div",{ref:S,className:"relative w-full h-full",style:{transform:Y,transformOrigin:"0 0"},children:[e?b?s.jsxs(s.Fragment,{children:[!le&&s.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),s.jsx("canvas",{ref:j,className:"w-full h-full object-contain block",style:{display:le?"block":"none",imageRendering:U,...z}})]}):P?s.jsxs(s.Fragment,{children:[!pe&&s.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),s.jsx("canvas",{ref:ne,className:"w-full h-full object-contain block",style:{display:pe?"block":"none",imageRendering:U,...z}})]}):s.jsx("img",{ref:ee,src:e,alt:M,className:"w-full h-full object-contain block",draggable:!1,style:{filter:fe,imageRendering:U},onLoad:C=>{const k=C.currentTarget;de({w:k.naturalWidth,h:k.naturalHeight}),g==null||g(k.naturalWidth,k.naturalHeight)}}):s.jsx("span",{className:"text-xs text-fg-muted",children:"no image"}),l&&te&&s.jsx(Ze,{naturalWidth:te.w,naturalHeight:te.h,zoom:w,containerRef:S}),c&&(m==null?void 0:m.enabled)&&te&&e&&((((K=c.boxes)==null?void 0:K.length)??0)>0||(((N=c.masks)==null?void 0:N.length)??0)>0)&&s.jsx(nt,{data:c,settings:m,naturalWidth:te.w,naturalHeight:te.h})]}),e&&te&&s.jsx(xe,{imageElRef:A,naturalWidth:te.w,naturalHeight:te.h,zoom:w,pan:h,sample:D,notation:_,version:W,onActiveChange:V}),F&&s.jsx(Ie,{notation:_,onChange:I})]}),s.jsx(Qe,{label:M,isDraggable:d,onDragStart:v})]})}function kn(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`HdrImagePane: unsupported shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}const Te=e=>Number.isFinite(e)?e:0;function Gn(e,t,n,r){const{h:i,w:o,c:l}=kn(e.shape),u=e.data,w=un(t),h=new Uint8ClampedArray(o*i*4);for(let T=0;T<o*i;T++){const g=T*l;let M,d,v,c=1;l===1?M=d=v=Te(u[g]):l===3?(M=Te(u[g]),d=Te(u[g+1]),v=Te(u[g+2])):(M=Te(u[g]),d=Te(u[g+1]),v=Te(u[g+2]),c=Te(u[g+3]));const m=[je(M,n),je(d,n),je(v,n)],[y,f,x]=w(m),S=T*4;h[S]=255*Ke(y,r),h[S+1]=255*Ke(f,r),h[S+2]=255*Ke(x,r),h[S+3]=255*(c<0?0:c>1?1:c)}return new ImageData(h,o,i)}function On({hdr:e,tonemap:t="srgb",exposure:n=0,gamma:r,showAxes:i=!1,label:o="",interpolation:l="auto",zoom:u=1,pan:w={x:0,y:0},onViewportChange:h,pixelValueNotation:T="decimal"}){const g=a.useRef(null),M=a.useRef(null),d=a.useRef(null),[v,c]=a.useState(null),m=a.useRef(null),[y,f]=a.useState(0),[x,S]=a.useState(T),[p,A]=a.useState(!1);a.useEffect(()=>{const L=g.current;if(!L)return;let _;try{_=Gn(e,t,n,r)}catch(F){console.error("[cairn] HDR tone-map error:",F);return}(L.width!==_.width||L.height!==_.height)&&(L.width=_.width,L.height=_.height);const I=L.getContext("2d");I&&(I.putImageData(_,0,0),m.current=_,f(F=>F+1),c(F=>F&&F.w===_.width&&F.h===_.height?F:{w:_.width,h:_.height}))},[e,t,n,r]);const{containerProps:G}=Ae({containerRef:d,zoom:u,pan:w,onViewportChange:h}),O=a.useCallback((L,_,I)=>{const F=v;if(!F||L<0||_<0||L>=F.w||_>=F.h)return null;const V=e.shape.length===2?1:e.shape[2]??1,j=(_*F.w+L)*V,ne=e.data,ee=m.current;let le=.5;if(ee&&ee.width===F.w&&ee.height===F.h){const oe=(_*F.w+L)*4;le=(.299*ee.data[oe]+.587*ee.data[oe+1]+.114*ee.data[oe+2])/255}return V===1?{lines:[J(ne[j]??0,"unit",I)],luminance:le}:{lines:[J(ne[j]??0,"unit",I),J(ne[j+1]??0,"unit",I),J(ne[j+2]??0,"unit",I)],luminance:le,colors:[ce[0],ce[1],ce[2]]}},[e,v]),W=l==="auto"?void 0:l,q=`translate(${w.x}px, ${w.y}px) scale(${u})`;return s.jsxs("div",{className:"relative flex flex-col h-full",children:[s.jsxs("div",{ref:d,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:i&&v?"16px 4px 4px 28px":"4px",...G.style},onPointerDown:G.onPointerDown,onPointerMove:G.onPointerMove,onPointerUp:G.onPointerUp,onPointerCancel:G.onPointerCancel,children:[s.jsxs("div",{ref:M,className:"relative w-full h-full",style:{transform:q,transformOrigin:"0 0"},children:[s.jsx("canvas",{ref:g,className:"w-full h-full object-contain block",style:{imageRendering:W}}),i&&v&&s.jsx(Ze,{naturalWidth:v.w,naturalHeight:v.h,zoom:u,containerRef:M})]}),v&&s.jsx(xe,{imageElRef:g,naturalWidth:v.w,naturalHeight:v.h,zoom:u,pan:w,sample:O,notation:x,version:y,onActiveChange:A}),p&&s.jsx(Ie,{notation:x,onChange:S})]}),o?s.jsx(Qe,{label:o}):null]})}function Fn(e){return"hdr"in e&&e.hdr!=null}const Bn=["linear","srgb","reinhard","aces"];function Nn(e){return e&&Bn.includes(e)?e:"srgb"}const Me=e=>Number.isFinite(e)?e:0;function Vn(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function Wn(e){const{h:t,w:n,c:r}=Vn(e.shape),i=e.data,o=new Float32Array(n*t*4);for(let l=0;l<n*t;l++){const u=l*r;let w,h,T,g=1;r===1?w=h=T=Me(i[u]):r===3?(w=Me(i[u]),h=Me(i[u+1]),T=Me(i[u+2])):(w=Me(i[u]),h=Me(i[u+1]),T=Me(i[u+2]),g=Me(i[u+3]));const M=l*4;o[M]=w,o[M+1]=h,o[M+2]=T,o[M+3]=g}return{data:o,width:n,height:t,format:"rgba32float"}}function Ut(e,t,n,r){if(n<=0||r<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const i=Math.min(t.width/n,t.height/r),o=n*i,l=r*i,u=(t.width-o)/2,w=(t.height-l)/2,h=Math.max(e.zoom,1e-6),T=t.width/(h*o),g=t.height/(h*l),M=-u/o-e.pan.x/(h*o),d=-w/l-e.pan.y/(h*l);return{x:M,y:d,w:T,h:g}}function Lt(e,t,n,r){const i=e.w*n,o=e.h*r;return i<=0||o<=0||t.width<=0||t.height<=0?0:Math.min(t.width/i,t.height/o)}const $n={zoom:1,pan:{x:0,y:0}};function Xn(e){var Y,X;const t=Fn(e),n=a.useRef(null),r=a.useRef(null),i=a.useRef(null),o=a.useRef(null),l=a.useRef(!1),[u,w]=a.useState(!1),[h,T]=a.useState(!1),[g,M]=a.useState(null),[d,v]=a.useState(0),[c,m]=a.useState(0),[y,f]=a.useState({x:0,y:0,w:1,h:1}),x=a.useRef(null),S=a.useRef(null),[p,A]=a.useState(0),[G,O]=a.useState(e.pixelValueNotation??"decimal"),[W,q]=a.useState(!1),L=e.zoom??1,_=e.pan??{x:0,y:0},I=e.onViewportChange,F=t?"none":e.colormap??"none",V=tt();a.useEffect(()=>{const b=n.current;if(!b)return;let R=!1;return Ge().then(P=>{if(R)return;const E=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,D=P.capabilities.hdr&&E&&t;l.current=D,In(b,{hdr:D}).then(U=>{if(R){Ct(U);return}o.current=U,T(!0)}).catch(U=>{R||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",U),w(!0))})}).catch(P=>{R||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",P),w(!0))}),()=>{R=!0,o.current&&(Ct(o.current),o.current=null)}},[]);const{containerProps:j}=Ae({containerRef:r,zoom:L,pan:_,onViewportChange:I,naturalWidth:g==null?void 0:g.w,naturalHeight:g==null?void 0:g.h}),ne=a.useCallback(()=>{I==null||I($n)},[I]);a.useEffect(()=>{const b=r.current;if(!b)return;const R=new ResizeObserver(()=>m(P=>P+1));return R.observe(b),()=>R.disconnect()},[]),a.useEffect(()=>{const b=r.current;if(!b)return;const R=new IntersectionObserver(P=>{const E=P[0];if(!E)return;const D=o.current;D&&(D.setVisible(E.isIntersecting),E.isIntersecting?D.isParked&&(D.restore(),m(U=>U+1)):D.park())},{threshold:0});return R.observe(b),()=>R.disconnect()},[]),a.useEffect(()=>{var P;if(!t||!h)return;const b=e.hdr;x.current=b;const R=Wn(b);(P=o.current)==null||P.setSource(R),M(E=>E&&E.w===R.width&&E.h===R.height?E:{w:R.width,h:R.height}),A(E=>E+1),v(E=>E+1)},[t,h,t?e.hdr:null]),a.useEffect(()=>{if(t||!h)return;const b=e,R=b.imageUrl,P=b.colormap??"none";if(!R){S.current=null,M(null),A(D=>D+1);return}let E=!1;return Re(R).then(D=>{var K,N;if(E||!D)return;let U=D;if(P!=="none"){const C=`gpu::${R}::${P}`,k=ze(C);if(k)U=k;else{const $=ut.has(P)?"positive":"linear";U=Xe(D,P,$),He(C,U)}}S.current=D;const z={data:U.data,width:U.width,height:U.height,format:"rgba8unorm"};(K=o.current)==null||K.setSource(z),M(C=>C&&C.w===U.width&&C.h===U.height?C:{w:U.width,h:U.height}),(N=b.onNaturalSize)==null||N.call(b,U.width,U.height),A(C=>C+1),v(C=>C+1)}),()=>{E=!0}},[t,h,t?null:e.imageUrl,t?null:e.colormap]);const ee=t?e.exposure??0:0,le=t?e.tonemap:void 0,oe=t?e.gamma:void 0;a.useEffect(()=>{const b=o.current;if(!b||!h||!g)return;const R=r.current,P=i.current,E=P?P.getBoundingClientRect():R?R.getBoundingClientRect():{width:g.w,height:g.h},D=Ut({zoom:L,pan:_},E,g.w,g.h);f(N=>N.x===D.x&&N.y===D.y&&N.w===D.w&&N.h===D.h?N:D),E.width>0&&E.height>0&&b.resize(Math.round(E.width*V),Math.round(E.height*V));const U=Lt(D,E,g.w,g.h)>=rt?"nearest":"linear",z=D,K=t?{exposureEV:ee,operator:l.current?"extended":Nn(le),gamma:oe,isScalar:!1,hdrOut:l.current,uv:z,filter:U}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:z,filter:U};try{b.render(K)||w(!0)}catch(N){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",N),w(!0)}},[h,g,d,L,_.x,_.y,ee,le,oe,c,t,V]);const pe=a.useCallback((b,R,P)=>{if(t){const k=x.current,$=g;if(!k||!$||b<0||R<0||b>=$.w||R>=$.h)return null;const re=k.shape.length===2?1:k.shape[2]??1,H=(R*$.w+b)*re,Z=k.data,ve=.5;return re===1?{lines:[J(Z[H]??0,"unit",P)],luminance:ve}:{lines:[J(Z[H]??0,"unit",P),J(Z[H+1]??0,"unit",P),J(Z[H+2]??0,"unit",P)],luminance:ve,colors:[ce[0],ce[1],ce[2]]}}const E=S.current;if(!E||b<0||R<0||b>=E.width||R>=E.height)return null;const D=(R*E.width+b)*4,U=E.data[D],z=E.data[D+1],K=E.data[D+2],N=(.299*U+.587*z+.114*K)/255;return F!=="none"||U===z&&z===K?{lines:[J(U,"uint8",P)],luminance:N}:{lines:[J(U,"uint8",P),J(z,"uint8",P),J(K,"uint8",P)],luminance:N,colors:[ce[0],ce[1],ce[2]]}},[t,g,F]),ue=e.showAxes??!1,te=t?e.label??"":e.label,de=e.interpolation??"auto",be=de==="auto"?void 0:de,ae=t?void 0:e.overlay,fe=t?void 0:e.overlaySettings,he=t?!1:e.isDraggable??!1,ie=t?void 0:e.onDragStart;return u?t?s.jsx(On,{hdr:e.hdr,tonemap:e.tonemap,exposure:e.exposure,gamma:e.gamma,showAxes:ue,label:te,interpolation:de,zoom:e.zoom,pan:e.pan,onViewportChange:I,pixelValueNotation:e.pixelValueNotation}):s.jsx(It,{imageUrl:e.imageUrl,baselineUrl:e.baselineUrl??null,isBaseline:e.isBaseline,diffMode:e.diffMode??"none",interpolation:de,colormap:F,showAxes:ue,processing:e.processing,zoom:e.zoom,pan:e.pan,onViewportChange:I,onNaturalSize:e.onNaturalSize,label:te,isDraggable:he,onDragStart:ie,className:e.className,overlay:ae,overlaySettings:fe,pixelValueNotation:e.pixelValueNotation}):s.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":h,children:[s.jsxs("div",{ref:r,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded",style:{padding:ue&&g?"16px 4px 4px 28px":0,...j.style},onPointerDown:j.onPointerDown,onPointerMove:j.onPointerMove,onPointerUp:j.onPointerUp,onPointerCancel:j.onPointerCancel,onDoubleClick:ne,"data-gpu-image-viewport":!0,children:[s.jsxs("div",{ref:i,className:"relative w-full h-full flex items-center justify-center cairn-checkerboard",children:[s.jsx("canvas",{ref:n,className:"w-full h-full block",style:{imageRendering:be},"data-gpu-image-canvas":!0}),ue&&g&&s.jsx(Ze,{naturalWidth:g.w,naturalHeight:g.h,zoom:L,containerRef:i}),ae&&(fe==null?void 0:fe.enabled)&&g&&((((Y=ae.boxes)==null?void 0:Y.length)??0)>0||(((X=ae.masks)==null?void 0:X.length)??0)>0)&&s.jsx(nt,{data:ae,settings:fe,naturalWidth:g.w,naturalHeight:g.h})]}),g&&s.jsx(xe,{imageElRef:n,naturalWidth:g.w,naturalHeight:g.h,zoom:L,pan:_,sourceWindow:y,sample:pe,notation:G,version:p,onActiveChange:q}),W&&s.jsx(Ie,{notation:G,onChange:O})]}),te?s.jsx(Qe,{label:te,isDraggable:he,onDragStart:ie}):null]})}const zn={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function Hn({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,zoom:l,pan:u,onViewportChange:w,processing:h=zn,interpolation:T="auto",label:g="",isDraggable:M=!1,onDragStart:d,overlay:v,overlaySettings:c,pixelValueNotation:m="decimal"}){var he,ie;const y=a.useRef(null),[f,x]=a.useState(null),[S,p]=a.useState(null),[A,G]=a.useState(m),[O,W]=a.useState(!1),q=a.useRef(null),L=a.useRef(null),_=a.useRef(null),I=a.useRef(null),[F,V]=a.useState(0);a.useEffect(()=>{if(!e){_.current=null,V(X=>X+1);return}let Y=!1;return Re(e).then(X=>{Y||(_.current=X,V(b=>b+1))}),()=>{Y=!0}},[e]),a.useEffect(()=>{if(!t){I.current=null,V(X=>X+1);return}let Y=!1;return Re(t).then(X=>{Y||(I.current=X,V(b=>b+1))}),()=>{Y=!0}},[t]);const j=Y=>(X,b,R)=>{const P=Y.current;if(!P||X<0||b<0||X>=P.width||b>=P.height)return null;const E=(b*P.width+X)*4,D=P.data[E],U=P.data[E+1],z=P.data[E+2],K=(.299*D+.587*U+.114*z)/255;return D===U&&U===z?{lines:[J(D,"uint8",R)],luminance:K}:{lines:[J(D,"uint8",R),J(U,"uint8",R),J(z,"uint8",R)],luminance:K,colors:[ce[0],ce[1],ce[2]]}},ne=a.useMemo(()=>j(_),[]),ee=a.useMemo(()=>j(I),[]),le=!!v&&!!(c!=null&&c.enabled)&&!!f&&!!e&&((((he=v.boxes)==null?void 0:he.length)??0)>0||(((ie=v.masks)==null?void 0:ie.length)??0)>0),{gammaFilterId:oe,filterStr:pe,gamma:ue,offset:te}=Dt(h),de=`translate(${u.x}px, ${u.y}px) scale(${l})`,be=T==="auto"?void 0:T,{containerProps:ae,modifierActive:fe}=Ae({containerRef:y,zoom:l,pan:u,onViewportChange:w});return s.jsxs("div",{className:"relative flex flex-col h-full",children:[s.jsx(At,{id:oe,gamma:ue,offset:te}),s.jsxs("div",{ref:y,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...ae.style},onPointerDown:ae.onPointerDown,onPointerMove:ae.onPointerMove,onPointerUp:ae.onPointerUp,onPointerCancel:ae.onPointerCancel,children:[s.jsxs("div",{className:"relative w-full h-full",children:[s.jsxs("div",{className:"relative w-full h-full",style:{transform:de,transformOrigin:"0 0"},children:[s.jsx("img",{ref:q,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:pe,imageRendering:be,...n==="blend"?{opacity:i}:{}},onLoad:Y=>{const X=Y.currentTarget;x({w:X.naturalWidth,h:X.naturalHeight})}}),le&&s.jsx(nt,{data:v,settings:c,naturalWidth:f.w,naturalHeight:f.h})]}),s.jsx("div",{className:"absolute inset-0 overflow-hidden",style:n==="split"?{clipPath:`inset(0 ${(1-r)*100}% 0 0)`}:void 0,children:s.jsx("div",{className:"w-full h-full",style:{transform:de,transformOrigin:"0 0"},children:s.jsx("img",{ref:L,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:pe,imageRendering:be,...n==="blend"?{opacity:1-i}:{}},onLoad:Y=>{const X=Y.currentTarget;p({w:X.naturalWidth,h:X.naturalHeight})}})})}),n==="split"&&s.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>o==null?void 0:o(.5),onPointerDown:Y=>{Y.stopPropagation(),Y.preventDefault();const b=Y.currentTarget.parentElement.getBoundingClientRect(),R=E=>{o==null||o(Math.max(0,Math.min(1,(E.clientX-b.left)/b.width)))},P=()=>{window.removeEventListener("pointermove",R),window.removeEventListener("pointerup",P)};window.addEventListener("pointermove",R),window.addEventListener("pointerup",P)},children:s.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?s.jsxs(s.Fragment,{children:[t&&S&&s.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:s.jsx(xe,{imageElRef:L,naturalWidth:S.w,naturalHeight:S.h,zoom:l,pan:u,sample:ee,notation:A,version:F})}),e&&f&&s.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:s.jsx(xe,{imageElRef:q,naturalWidth:f.w,naturalHeight:f.h,zoom:l,pan:u,sample:ne,notation:A,version:F,onActiveChange:W})})]}):e&&f&&s.jsx(xe,{imageElRef:q,naturalWidth:f.w,naturalHeight:f.h,zoom:l,pan:u,sample:ne,notation:A,version:F,onActiveChange:W}),O&&s.jsx(Ie,{notation:A,onChange:G})]}),s.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),s.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${M&&!fe?" cairn-drag-grip":""}`,draggable:M&&!fe,onDragStart:d,style:{cursor:M&&!fe?"grab":void 0},children:[s.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),g]})]})}const Yn={zoom:1,pan:{x:0,y:0}};function qn(e){const t=$e(e),n=new Float32Array(256*4);for(let r=0;r<256;r++)n[r*4+0]=t[r*3+0]/255,n[r*4+1]=t[r*3+1]/255,n[r*4+2]=t[r*3+2]/255,n[r*4+3]=1;return n}function jn({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,diffSubmode:l,colormap:u="none",zoom:w,pan:h,onViewportChange:T,interpolation:g="auto",label:M="",pixelValueNotation:d="decimal"}){const v=a.useRef(null),c=a.useRef(null),m=a.useRef(null),[y,f]=a.useState(!1),[x,S]=a.useState(!1),[p,A]=a.useState(null),[G,O]=a.useState(0),[W,q]=a.useState(0),[L,_]=a.useState(null),[I,F]=a.useState(d),[V,j]=a.useState(!1),[ne,ee]=a.useState({x:0,y:0,w:1,h:1}),le=a.useRef(null),oe=a.useRef(null),[pe,ue]=a.useState(0),te=tt();a.useEffect(()=>{const b=c.current;if(!b)return;let R=!1;return Ge().then(P=>{if(!R)try{if(Tt())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const E=P.createSurface(b,{hdr:!1});m.current={device:P,surface:E,texA:null,texB:null},S(!0)}catch(E){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",E),f(!0)}}).catch(P=>{R||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",P),f(!0))}),()=>{var E,D;R=!0;const P=m.current;P&&((E=P.texA)==null||E.destroy(),(D=P.texB)==null||D.destroy(),m.current=null)}},[]),a.useEffect(()=>{const b=v.current;if(!b)return;const R=new ResizeObserver(()=>q(P=>P+1));return R.observe(b),()=>R.disconnect()},[]),a.useEffect(()=>{if(!x)return;let b=!1;if(!m.current)return;async function P(E){return E?Re(E):null}return Promise.all([P(e),P(t)]).then(([E,D])=>{var N,C;if(b||!m.current)return;const U=m.current;le.current=E,oe.current=D,(N=U.texA)==null||N.destroy(),(C=U.texB)==null||C.destroy(),U.texA=null,U.texB=null;const z=E??D;if(!z){A(null),ue(k=>k+1);return}const K=k=>{const $=U.device.createTexture(k.width,k.height,"rgba8unorm");return $.write(k.data),$};U.texA=K(D??z),U.texB=K(E??z),A({w:z.width,h:z.height}),ue(k=>k+1),O(k=>k+1)}),()=>{b=!0}},[x,e,t]);const de=a.useMemo(()=>(l??"").includes("signed")?"signed":"positive",[l]),be=a.useMemo(()=>u!=="none"?qn(u):void 0,[u]);a.useEffect(()=>{const b=m.current;if(!x||!b||!b.surface||!b.texA||!b.texB||!p)return;const R=v.current,P=R?R.getBoundingClientRect():{width:p.w,height:p.h},E=Ut({zoom:w,pan:h},P,p.w,p.h);ee(N=>N.x===E.x&&N.y===E.y&&N.w===E.w&&N.h===E.h?N:E);const D=c.current;if(P.width>0&&P.height>0&&D&&b.surface){const N=Math.max(1,Math.round(P.width*te)),C=Math.max(1,Math.round(P.height*te));(D.width!==N||D.height!==C)&&(D.width=N,D.height=C,b.surface.configure(N,C))}const U=Lt(E,P,p.w,p.h)>=rt?"nearest":"linear",K={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:E,filter:U,mode:n,split:r,alpha:i,diffSubmode:l??"absolute",diffCmapMode:de,diffColormap:n==="diff"?be:void 0};try{Mn(b.device,b.surface,b.texA,b.texB,K)}catch(N){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",N),f(!0)}},[x,p,G,w,h.x,h.y,n,r,i,l,de,be,W,te]),a.useEffect(()=>{const b=m.current;if(!x||!b||!b.texA||!b.texB||!t){_(null);return}let R=!1;return Sn(b.device,b.texA,b.texB).then(P=>{R||_(P)}),()=>{R=!0}},[x,G,t]);const ae=b=>(R,P,E)=>{const D=b.current;if(!D||R<0||P<0||R>=D.width||P>=D.height)return null;const U=(P*D.width+R)*4,z=D.data[U],K=D.data[U+1],N=D.data[U+2],C=(.299*z+.587*K+.114*N)/255;return z===K&&K===N?{lines:[J(z,"uint8",E)],luminance:C}:{lines:[J(z,"uint8",E),J(K,"uint8",E),J(N,"uint8",E)],luminance:C,colors:[ce[0],ce[1],ce[2]]}},fe=a.useMemo(()=>ae(le),[]),he=a.useMemo(()=>ae(oe),[]),{containerProps:ie}=Ae({containerRef:v,zoom:w,pan:h,onViewportChange:T,naturalWidth:p==null?void 0:p.w,naturalHeight:p==null?void 0:p.h}),Y=a.useCallback(()=>T==null?void 0:T(Yn),[T]),X=g==="auto"?void 0:g;return y?n==="diff"?s.jsx(It,{imageUrl:e,baselineUrl:t,diffMode:l??"signed",interpolation:g,colormap:u,showAxes:!1,zoom:w,pan:h,onViewportChange:T,label:M,pixelValueNotation:d}):s.jsx(Hn,{imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,zoom:w,pan:h,onViewportChange:T,interpolation:g,label:M,pixelValueNotation:d}):s.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":x,children:[s.jsxs("div",{ref:v,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...ie.style},onPointerDown:ie.onPointerDown,onPointerMove:ie.onPointerMove,onPointerUp:ie.onPointerUp,onPointerCancel:ie.onPointerCancel,onDoubleClick:Y,"data-gpu-compare-viewport":!0,children:[s.jsxs("div",{className:"relative w-full h-full flex items-center justify-center",children:[s.jsx("canvas",{ref:c,className:"w-full h-full block",style:{imageRendering:X},"data-gpu-compare-canvas":!0}),n==="split"&&s.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:b=>{b.stopPropagation(),o==null||o(.5)},onPointerDown:b=>{b.stopPropagation(),b.preventDefault();const P=b.currentTarget.parentElement.getBoundingClientRect(),E=U=>{o==null||o(Math.max(0,Math.min(1,(U.clientX-P.left)/P.width)))},D=()=>{window.removeEventListener("pointermove",E),window.removeEventListener("pointerup",D)};window.addEventListener("pointermove",E),window.addEventListener("pointerup",D)},children:s.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?s.jsxs(s.Fragment,{children:[t&&p&&s.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:s.jsx(xe,{imageElRef:c,naturalWidth:p.w,naturalHeight:p.h,zoom:w,pan:h,sourceWindow:ne,sample:he,notation:I,version:pe})}),t&&p&&s.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:s.jsx(xe,{imageElRef:c,naturalWidth:p.w,naturalHeight:p.h,zoom:w,pan:h,sourceWindow:ne,sample:fe,notation:I,version:pe,onActiveChange:j})})]}):p&&s.jsx(xe,{imageElRef:c,naturalWidth:p.w,naturalHeight:p.h,zoom:w,pan:h,sourceWindow:ne,sample:fe,notation:I,version:pe,onActiveChange:j}),V&&s.jsx(Ie,{notation:I,onChange:F})]}),s.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),M?s.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:M}):null,L&&s.jsxs("span",{className:`absolute right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${V?"top-8":"top-1"}`,"data-gpu-compare-metrics":!0,children:["MSE ",L.mse.toExponential(2)," · PSNR ",Number.isFinite(L.psnr)?L.psnr.toFixed(1):"∞"," dB · MAE"," ",L.mae.toExponential(2)]})]})}const Kn="cairn-plot:gpu-image-ready";async function Zn(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Ge(),window.__cairnPlotGpuImagePane=Xn,window.__cairnPlotGpuComparePane=jn,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(Kn))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}Zn()})(__cairnPlotJsxRuntime,__cairnPlotReact);

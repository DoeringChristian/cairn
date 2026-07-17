var Qn=Object.defineProperty;var Jn=(l,a,_e)=>a in l?Qn(l,a,{enumerable:!0,configurable:!0,writable:!0,value:_e}):l[a]=_e;var Q=(l,a,_e)=>Jn(l,typeof a!="symbol"?a+"":a,_e);(function(l,a){"use strict";const _e=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function it(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"premultiplied",usage:_e}),{hdr:!1,format:n}}function kt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:_e}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:_e}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return it(e,t)}}}const Gt=`
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
`;function Ne(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function ot(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Ot(e){const t=(e&32768)>>15,n=(e&31744)>>10,r=e&1023;let i;return n===0?i=r/1024*Math.pow(2,-14):n===31?i=r?NaN:1/0:i=(1+r/1024)*Math.pow(2,n-15),t?-i:i}const Ft={texture:0,sampler:1,uniform:2};function Ve(e,t){return e*3+Ft[t]}const Bt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Nt(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let r;for(;(r=n.exec(e))!==null;){const i=Number(r[1]),o=r[2]!==void 0,f=r[3].trim();if(o){const u=Bt[f];if(u===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${f}" (binding ${i}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(i,{kind:"uniform",sizeBytes:u})}else f==="sampler"||f==="sampler_comparison"?t.set(i,{kind:"sampler"}):t.set(i,{kind:"texture"})}return t}class at{constructor(t,n,r,i){Q(this,"width");Q(this,"height");Q(this,"format");Q(this,"gpuTexture");Q(this,"device");Q(this,"destroyed",!1);this.device=t,this.width=n,this.height=r,this.format=i,this.gpuTexture=t.createTexture({size:{width:n,height:r,depthOrArrayLayers:1},format:Ne(i),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*ot(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class st{constructor(t){Q(this,"_s");Q(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Vt{constructor(t,n,r,i,o){Q(this,"_p");Q(this,"gpuPipeline");Q(this,"bindings");Q(this,"bindGroupLayout");Q(this,"variants");Q(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=r,this.buildVariant=o,this.variants=new Map([[i,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function $t(e,t){const n=[];for(const[r,i]of t)i.kind==="uniform"?n.push({binding:r,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):i.kind==="sampler"?n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class Wt{constructor(t){Q(this,"_c");Q(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class Xt{constructor(t,n){Q(this,"_b");Q(this,"gpuBindGroup");Q(this,"ownedBuffers");Q(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class zt{constructor(t,n,r,i){Q(this,"canvas");Q(this,"hdr");Q(this,"format");Q(this,"context");Q(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=r.hdr,this.format=r.format,this.reconfigure=i}configure(t,n){this.canvas.width=t,this.canvas.height=n;const r=this.reconfigure();this.hdr=r.hdr,this.format=r.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function ke(e){return"canvas"in e}async function Ht(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let r=null;function i(){return r||(r=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),r}function o(h){return ke(h)?h.getCurrentTextureView():h.gpuTexture.createView()}function f(h){if(ke(h))return{width:h.canvas.width,height:h.canvas.height};const m=h;return{width:m.width,height:m.height}}let u=!1;const x=256;let d=null,_=null;function g(){if(!d||!_){const h=t.createShaderModule({code:Gt});_=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const m=t.createPipelineLayout({bindGroupLayouts:[_]});d=t.createComputePipeline({layout:m,compute:{module:h,entryPoint:"cs_main"}})}return{pipeline:d,layout:_}}return{backend:"webgpu",capabilities:n,createTexture(h,m,s){return new at(t,h,m,s)},createSampler(h){const m=(h==null?void 0:h.filter)==="linear"?"linear":"nearest",s=t.createSampler({magFilter:m,minFilter:m,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new st(s)},createRenderPipeline(h){const m=t.createShaderModule({code:h.shaderWGSL}),s=Nt(h.shaderWGSL),c=Ne(h.targetFormat),v=$t(t,s),p=t.createPipelineLayout({bindGroupLayouts:[v]}),T=b=>t.createRenderPipeline({layout:p,vertex:{module:m,entryPoint:"vs_main"},fragment:{module:m,entryPoint:"fs_main",targets:[{format:b}]},primitive:{topology:"triangle-list"}}),S=T(c);return new Vt(S,s,v,c,T)},createComputePipeline(h){const m=t.createShaderModule({code:h.shaderWGSL}),s=t.createComputePipeline({layout:"auto",compute:{module:m,entryPoint:"cs_main"}});return new Wt(s)},createBindGroup(h,m){const s=h,c=new Map,v=[];for(const[T,S]of s.bindings)if(S.kind==="uniform"){const b=t.createBuffer({size:S.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});v.push(b),c.set(T,{binding:T,resource:{buffer:b}})}else S.kind==="sampler"&&c.set(T,{binding:T,resource:i()});for(const T of m){const S=T.resource;if(S instanceof at){const b=Ve(T.binding,"texture");s.bindings.has(b)&&c.set(b,{binding:b,resource:S.gpuTexture.createView()})}else if(S instanceof st){const b=Ve(T.binding,"sampler");s.bindings.has(b)&&c.set(b,{binding:b,resource:S.gpuSampler})}else{const b=Ve(T.binding,"uniform"),L=s.bindings.get(b);if(L&&L.kind==="uniform"){const O=S.uniform,G=t.createBuffer({size:Math.max(L.sizeBytes,O.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(G,0,O.buffer,O.byteOffset,O.byteLength),v.push(G),c.set(b,{binding:b,resource:{buffer:G}})}}}const p=t.createBindGroup({layout:s.bindGroupLayout,entries:Array.from(c.values())});return new Xt(p,v)},createSurface(h,m){const s=h.getContext("webgpu");if(!s)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const c=m.hdr&&n.hdr,v=()=>c?kt(s,t):it(s,t),p=v();return new zt(h,s,p,v)},renderFullscreen(h,m,s){const c=m,v=s,p=o(h),{width:T,height:S}=f(h),b=ke(h)?h.format:Ne(h.format),L=c.pipelineFor(b),O=t.createCommandEncoder(),G=O.beginRenderPass({colorAttachments:[{view:p,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});G.setPipeline(L),G.setBindGroup(0,v.gpuBindGroup),G.setViewport(0,0,T,S,0,1),G.draw(3),G.end(),t.queue.submit([O.finish()])},async readback(h){const m=ke(h),{width:s,height:c}=f(h),v=m?h.hdr?"rgba16float":"rgba8unorm":h.format,p=m&&h.format==="bgra8unorm",T=m?h.getCurrentGPUTexture():h.gpuTexture,S=ot(v),b=s*S,L=256,O=Math.ceil(b/L)*L,G=O*c,Y=t.createBuffer({size:G,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),Z=t.createCommandEncoder();Z.copyTextureToBuffer({texture:T},{buffer:Y,bytesPerRow:O,rowsPerImage:c},{width:s,height:c,depthOrArrayLayers:1}),t.queue.submit([Z.finish()]),await Y.mapAsync(GPUMapMode.READ);const k=new Uint8Array(Y.getMappedRange()),E=new Uint8Array(b*c);for(let U=0;U<c;U++){const F=U*O,W=U*b;E.set(k.subarray(F,F+b),W)}if(Y.unmap(),Y.destroy(),v==="rgba8unorm"){if(p)for(let U=0;U<E.length;U+=4){const F=E[U],W=E[U+2];E[U]=W,E[U+2]=F}return E}if(v==="rgba16float"){const U=new Uint16Array(E.buffer,E.byteOffset,E.byteLength/2),F=new Float32Array(U.length);for(let W=0;W<U.length;W++)F[W]=Ot(U[W]);return F}return new Float32Array(E.buffer,E.byteOffset,E.byteLength/4)},async reduceDiffSumSquaredAbs(h,m,s,c){const v=h,p=m,T=Math.max(0,s*c),S=Math.max(1,Math.ceil(T/x)),{pipeline:b,layout:L}=g(),O=S*2*4,G=t.createBuffer({size:O,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),Y=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(Y,0,new Uint32Array([Math.max(1,s),Math.max(1,c),T,0]));const Z=t.createBindGroup({layout:L,entries:[{binding:0,resource:v.gpuTexture.createView()},{binding:1,resource:p.gpuTexture.createView()},{binding:2,resource:{buffer:G}},{binding:3,resource:{buffer:Y}}]}),k=t.createBuffer({size:O,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),E=t.createCommandEncoder(),U=E.beginComputePass();U.setPipeline(b),U.setBindGroup(0,Z),U.dispatchWorkgroups(S),U.end(),E.copyBufferToBuffer(G,0,k,0,O),t.queue.submit([E.finish()]),await k.mapAsync(GPUMapMode.READ);const W=new Float32Array(k.getMappedRange()).slice();k.unmap(),k.destroy(),G.destroy(),Y.destroy();let K=0,ne=0;for(let ee=0;ee<S;ee++)K+=W[ee*2],ne+=W[ee*2+1];return{sumSq:K,sumAbs:ne}},destroy(){u||(t.destroy(),u=!0)},isContextLost(){return!1}}}let $e=null;async function Yt(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return Ht()}function Ge(){return $e||($e=Yt()),$e}function qt(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function jt(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const i=n/255*(e.length-1),o=Math.floor(i),f=Math.min(o+1,e.length-1),u=i-o,[x,d,_]=qt(e[o],e[f],u);t[n*3]=Math.round(x),t[n*3+1]=Math.round(d),t[n*3+2]=Math.round(_)}return t}const ct={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},lt=new Set(["red-green","red-blue"]),ut=new Map;function We(e){let t=ut.get(e);if(!t){const n=ct[e]??ct.viridis;t=jt(n),ut.set(e,t)}return t}function Xe(e,t,n="linear"){const r=We(t),i=new ImageData(e.width,e.height),o=e.data,f=i.data;for(let u=0;u<o.length;u+=4){const x=(o[u]+o[u+1]+o[u+2])/3;let d;n==="positive"?d=Math.round(128+x/255*127):d=Math.round(x),d=Math.max(0,Math.min(255,d)),f[u]=r[d*3],f[u+1]=r[d*3+1],f[u+2]=r[d*3+2],f[u+3]=o[u+3]}return i}function dt(e){const t=new Map;return{get(n){return t.get(n)},set(n,r){if(t.size>=e){const i=t.keys().next().value;i!==void 0&&t.delete(i)}t.set(n,r)}}}const ft=dt(50);function ze(e){return ft.get(e)}function He(e,t){ft.set(e,t)}const ht=dt(100);function Kt(e){return ht.get(e)}function Zt(e,t){ht.set(e,t)}function Qt(e,t,n){const r=Math.min(e.width,t.width),i=Math.min(e.height,t.height),o=new ImageData(r,i);for(let f=0;f<i;f++)for(let u=0;u<r;u++){const x=(f*e.width+u)*4,d=(f*t.width+u)*4,_=(f*r+u)*4;for(let g=0;g<3;g++){const A=e.data[x+g],h=t.data[d+g],m=A-h,s=Math.abs(m),c=Math.max(A,1);let v;switch(n){case"signed":v=(m+255)/2;break;case"absolute":v=s;break;case"squared":v=m*m/255;break;case"relative_signed":v=(m/c+1)*127.5;break;case"relative_absolute":v=s/c*255;break;case"relative_squared":v=m*m/(c*c)*255;break}o.data[_+g]=Math.min(255,Math.max(0,Math.round(v)))}o.data[_+3]=255}return o}async function Re(e){const t=Kt(e);return t||new Promise(n=>{const r=new Image;r.onload=()=>{try{const i=document.createElement("canvas");i.width=r.naturalWidth,i.height=r.naturalHeight;const o=i.getContext("2d");if(!o){n(null);return}o.drawImage(r,0,0);const f=o.getImageData(0,0,i.width,i.height);Zt(e,f),n(f)}catch(i){console.warn("[cairn] loadImageData failed:",i),n(null)}},r.onerror=i=>{console.warn("[cairn] loadImageData: image failed to load:",e,i),n(null)},r.src=e})}const Jt={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},en={linear:0,signed:1,positive:2},tn=`#version 300 es
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
}`;let Ce=null,B=null,pe=null,Oe=null;function rn(){if(B)return B;try{if(typeof OffscreenCanvas<"u"?Ce=new OffscreenCanvas(1,1):Ce=document.createElement("canvas"),B=Ce.getContext("webgl2",{preserveDrawingBuffer:!0}),!B)return console.warn("[cairn] WebGL 2 not available"),null;const e=B.createShader(B.VERTEX_SHADER);if(B.shaderSource(e,tn),B.compileShader(e),!B.getShaderParameter(e,B.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",B.getShaderInfoLog(e)),null;const t=B.createShader(B.FRAGMENT_SHADER);if(B.shaderSource(t,nn),B.compileShader(t),!B.getShaderParameter(t,B.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",B.getShaderInfoLog(t)),null;if(pe=B.createProgram(),B.attachShader(pe,e),B.attachShader(pe,t),B.linkProgram(pe),!B.getProgramParameter(pe,B.LINK_STATUS))return console.error("[cairn] WebGL program link:",B.getProgramInfoLog(pe)),null;Oe=B.createVertexArray(),B.bindVertexArray(Oe);const n=B.createBuffer();B.bindBuffer(B.ARRAY_BUFFER,n),B.bufferData(B.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),B.STATIC_DRAW);const r=B.getAttribLocation(pe,"a_pos");return B.enableVertexAttribArray(r),B.vertexAttribPointer(r,2,B.FLOAT,!1,0,0),B.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),B}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function gt(e,t,n){const r=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),r}function on(e,t,n){const r=new Uint8Array(1024);for(let o=0;o<256;o++)r[o*4]=t[o*3],r[o*4+1]=t[o*3+1],r[o*4+2]=t[o*3+2],r[o*4+3]=255;const i=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,i),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,r),i}function an(e,t,n,r){const i=rn();if(!i||!pe||!Oe||!Ce)return null;const o=Math.min(e.width,t.width),f=Math.min(e.height,t.height);Ce.width=o,Ce.height=f,i.viewport(0,0,o,f);const u=gt(i,e,0),x=gt(i,t,1);let d=null;n.colormap?d=on(i,n.colormap,2):(d=i.createTexture(),i.activeTexture(i.TEXTURE2),i.bindTexture(i.TEXTURE_2D,d),i.texImage2D(i.TEXTURE_2D,0,i.RGBA8,1,1,0,i.RGBA,i.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),i.useProgram(pe),i.uniform1i(i.getUniformLocation(pe,"u_baseline"),0),i.uniform1i(i.getUniformLocation(pe,"u_other"),1),i.uniform1i(i.getUniformLocation(pe,"u_lut"),2),i.uniform1i(i.getUniformLocation(pe,"u_diff_mode"),Jt[n.diffMode]),i.uniform1i(i.getUniformLocation(pe,"u_cmap_mode"),en[n.cmapMode]??0),i.uniform1i(i.getUniformLocation(pe,"u_use_colormap"),n.colormap?1:0),i.bindVertexArray(Oe),i.drawArrays(i.TRIANGLE_STRIP,0,4),i.bindVertexArray(null),r.width=o,r.height=f;const _=r.getContext("2d");return _&&(_.save(),_.scale(1,-1),_.drawImage(Ce,0,0,o,f,0,-f,o,f),_.restore()),i.deleteTexture(u),i.deleteTexture(x),i.deleteTexture(d),{width:o,height:f}}const sn={cardSettings:(e,t,n)=>`cairn:card-settings:${e}:${t}:${n}`,runLayout:e=>`cairn:run-layout:${e}`,collapsedSections:e=>`cairn:collapsed-sections:${e}`,comparisons:e=>`cairn:comparisons:${e}`,comparisonTemplates:e=>`cairn:comparison-templates:${e}`,reportTemplates:e=>`cairn:report-templates:${e}`,streamMode:"cairn:stream-mode",renderMode:"cairn:render-mode",scroll:e=>`cairn:scroll:${e}`,lastComparison:e=>`cairn:last-comparison:${e}`};function cn(){try{const e=localStorage.getItem(sn.renderMode);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const we=e=>e<0?0:e>1?1:e,Ye=e=>{const t=e<0?0:e;return t/(1+t)},qe=e=>{const t=e<0?0:e,n=t*(2.51*t+.03),r=t*(2.43*t+.59)+.14;return we(n/r)},mt={linear:([e,t,n])=>[we(e),we(t),we(n)],srgb:([e,t,n])=>[we(e),we(t),we(n)],reinhard:([e,t,n])=>[Ye(e),Ye(t),Ye(n)],aces:([e,t,n])=>[qe(e),qe(t),qe(n)],extended:([e,t,n])=>[e,t,n]},ln="srgb";function un(e){return e&&mt[e]||mt[ln]}function je(e,t){return e*2**t}function dn(e){const t=we(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function Ke(e,t){return typeof t=="number"&&t>0?we(Math.pow(we(e),1/t)):dn(e)}function pt(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Ze({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:r}){const i=pt(e),o=pt(t),f=[];for(let p=0;p<=e;p+=i)f.push(p);const u=[];for(let p=0;p<=t;p+=o)u.push(p);const x=1/n,d=8*x,_=-12*x,g=-2*x,A=r==null?void 0:r.current;let h=0,m=0,s=0,c=0;if(A){const p=A.clientWidth,T=A.clientHeight,S=p/e,b=T/t,L=Math.min(S,b);s=e*L,c=t*L,h=(p-s)/2,m=(T-c)/2}const v=A&&s>0;return l.jsxs(l.Fragment,{children:[l.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:v?m:0,transform:`translateY(${_}px)`,fontSize:d},children:f.map(p=>l.jsx("span",{className:"mono",style:{position:"absolute",left:v?h+p/e*s:`${p/e*100}%`,transform:"translateX(-50%)"},children:p},p))}),l.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:v?h:0,transform:`translateX(${g}px)`,fontSize:d},children:u.map(p=>l.jsx("span",{className:"mono",style:{position:"absolute",top:v?m+p/t*c:`${p/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*x}px`},children:p},p))})]})}function Qe({label:e,isDraggable:t,onDragStart:n}){return l.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&l.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const vt=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function Je(e){const t=vt.length;return vt[(e%t+t)%t]}function fn(e){const n=a.useRef(null),[r,i]=a.useState({w:0,h:0}),o=a.useRef(null),f=a.useRef(null);return a.useEffect(()=>{var d;const u=n.current;if(u===f.current||((d=o.current)==null||d.disconnect(),o.current=null,f.current=u,!u))return;const x=new ResizeObserver(_=>{for(const g of _)i({w:g.contentRect.width,h:g.contentRect.height})});o.current=x,x.observe(u)}),a.useEffect(()=>()=>{var u;return(u=o.current)==null?void 0:u.disconnect()},[]),{ref:n,size:r}}function hn(){const[e,t]=a.useState(!1);return a.useEffect(()=>{const n=o=>{(o.key==="Alt"||o.key==="Control"||o.key==="Meta")&&t(!0)},r=o=>{(o.key==="Alt"||o.key==="Control"||o.key==="Meta")&&t(!1)},i=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",r),window.addEventListener("blur",i),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",r),window.removeEventListener("blur",i)}},[]),e}const gn=.25,mn=16;function Ae(e){const{containerRef:t,zoom:n,pan:r,onViewportChange:i,minZoom:o=gn,maxZoom:f=mn}=e,u=hn(),x=a.useRef(u);x.current=u;const d=a.useRef({zoom:n,pan:r});d.current={zoom:n,pan:r};const _=a.useRef(i);_.current=i,a.useEffect(()=>{const c=t.current;if(!c||!i)return;const v=p=>{var k;if(!x.current)return;p.preventDefault(),p.stopPropagation();const T=p.deltaY<0?1.1:1/1.1,S=d.current,b=Math.max(o,Math.min(f,S.zoom*T));if(S.zoom===b)return;const L=c.getBoundingClientRect(),O=p.clientX-L.left,G=p.clientY-L.top,Y=O-(O-S.pan.x)/S.zoom*b,Z=G-(G-S.pan.y)/S.zoom*b;(k=_.current)==null||k.call(_,{zoom:b,pan:{x:Y,y:Z}})};return c.addEventListener("wheel",v,{passive:!1}),()=>c.removeEventListener("wheel",v)},[t,!!i,o,f]);const g=a.useRef(null),A=a.useCallback(c=>{!x.current||!_.current||(c.currentTarget.setPointerCapture(c.pointerId),g.current={pointerId:c.pointerId,startX:c.clientX,startY:c.clientY,panX:d.current.pan.x,panY:d.current.pan.y})},[]),h=a.useCallback(c=>{var S;const v=g.current;if(!v||v.pointerId!==c.pointerId)return;const p=c.clientX-v.startX,T=c.clientY-v.startY;(S=_.current)==null||S.call(_,{zoom:d.current.zoom,pan:{x:v.panX+p,y:v.panY+T}})},[]),m=a.useCallback(c=>{const v=g.current;if(!(!v||v.pointerId!==c.pointerId)){try{c.currentTarget.releasePointerCapture(c.pointerId)}catch{}g.current=null}},[]),s=u&&!!i;return{containerProps:{onPointerDown:A,onPointerMove:h,onPointerUp:m,onPointerCancel:m,style:{cursor:s?"move":void 0,touchAction:s?"none":void 0}},modifierActive:u}}function et(){const[e,t]=a.useState(()=>typeof window<"u"&&window.devicePixelRatio||1);return a.useEffect(()=>{if(typeof matchMedia>"u")return;let n=!1,r=null;const i=()=>{n||(t(window.devicePixelRatio||1),o())};function o(){if(n)return;const f=window.devicePixelRatio||1;r=matchMedia(`(resolution: ${f}dppx)`),r.addEventListener("change",i,{once:!0})}return o(),()=>{n=!0,r==null||r.removeEventListener("change",i)}},[]),e}function pn(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function bt(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function tt({data:e,settings:t,naturalWidth:n,naturalHeight:r}){const{ref:i,size:o}=fn(),f=a.useRef(null),u=a.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),x=a.useMemo(()=>{const s=o.w,c=o.h;if(s<=0||c<=0||n<=0||r<=0)return null;const v=Math.min(s/n,c/r),p=n*v,T=r*v;return{left:(s-p)/2,top:(c-T)/2,width:p,height:T}},[o.w,o.h,n,r]),d=e.masks,_=t.showMasks&&!!d&&d.length>0,g=a.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(a.useEffect(()=>{if(!_||!d)return;const s=f.current;if(!s)return;(s.width!==n||s.height!==r)&&(s.width=n,s.height=r);const c=s.getContext("2d");if(!c)return;c.clearRect(0,0,s.width,s.height);let v=!1;const p=c.createImageData(n,r),T=p.data;let S=d.length,b=!1;const L=()=>{v||b&&c.putImageData(p,0,0)},O=document.createElement("canvas");O.width=n,O.height=r;const G=O.getContext("2d",{willReadFrequently:!0});for(const Y of d){const Z=new Image;Z.onload=()=>{if(!v){if(G){G.clearRect(0,0,n,r),G.drawImage(Z,0,0,n,r);const k=G.getImageData(0,0,n,r).data;for(let E=0;E<n*r;E++){const U=k[E*4];if(U===0||u.has(U))continue;const[F,W,K]=pn(Je(U));T[E*4]=F,T[E*4+1]=W,T[E*4+2]=K,T[E*4+3]=255,b=!0}}S-=1,S===0&&L()}},Z.onerror=()=>{S-=1,S===0&&L()},Z.src=`data:image/png;base64,${Y.png_b64}`}return()=>{v=!0}},[_,d,n,r,g]),!x)return l.jsx("div",{ref:i,className:"absolute inset-0 pointer-events-none"});const A=e.boxes??[],h=t.showBoxes&&A.length>0,m=e.class_labels??{};return l.jsxs("div",{ref:i,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[_&&l.jsx("canvas",{ref:f,className:"absolute",style:{left:x.left,top:x.top,width:x.width,height:x.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),h&&l.jsx("svg",{className:"absolute",style:{left:x.left,top:x.top,width:x.width,height:x.height,overflow:"visible"},viewBox:`0 0 ${n} ${r}`,preserveAspectRatio:"none",children:A.map((s,c)=>{if(!bt(s,t,u))return null;const v=s.domain==="pixel"?1:n,p=s.domain==="pixel"?1:r,T=s.position.minX*v,S=s.position.minY*p,b=(s.position.maxX-s.position.minX)*v,L=(s.position.maxY-s.position.minY)*p;return l.jsx("rect",{x:T,y:S,width:b,height:L,fill:"none",stroke:Je(s.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},c)})}),h&&l.jsx("div",{className:"absolute",style:{left:x.left,top:x.top,width:x.width,height:x.height},children:A.map((s,c)=>{if(!bt(s,t,u))return null;const v=s.domain==="pixel"?1/n:1,p=s.domain==="pixel"?1/r:1,T=s.position.minX*v*100,S=s.position.minY*p*100,b=s.label??m[String(s.class_id)]??`#${s.class_id}`,L=s.score!=null?` ${(s.score*100).toFixed(0)}%`:"";return!b&&!L?null:l.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${T}%`,top:`${S}%`,transform:"translateY(-100%)",backgroundColor:Je(s.class_id)},children:l.jsxs("span",{className:"mono",children:[b,L]})},c)})})]})}const nt=30,le=["#ff5a5a","#39d353","#5b9bff"];function rt(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function J(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):rt(e/255):rt(n==="int"?e*255:e)}const vn={x:0,y:0,w:1,h:1};function xe({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:r,pan:i,sample:o,notation:f="decimal",version:u=0,onActiveChange:x,sourceWindow:d=vn}){const _=a.useRef(null),g=a.useRef(!1),A=et(),h=a.useRef(x);h.current=x;const m=a.useCallback(c=>{var v;c!==g.current&&(g.current=c,(v=h.current)==null||v.call(h,c))},[]),s=a.useCallback(()=>{var he;const c=_.current,v=e.current;if(!c)return;const p=window.devicePixelRatio||1,T=c.clientWidth,S=c.clientHeight;if(T===0||S===0)return;c.width!==Math.round(T*p)&&(c.width=Math.round(T*p)),c.height!==Math.round(S*p)&&(c.height=Math.round(S*p));const b=c.getContext("2d");if(!b)return;if(b.setTransform(p,0,0,p,0,0),b.clearRect(0,0,T,S),!v||t<=0||n<=0){m(!1);return}const L=v.getBoundingClientRect(),O=c.getBoundingClientRect();if(L.width===0||L.height===0){m(!1);return}const G=d.x*t,Y=d.y*n,Z=d.w*t,k=d.h*n;if(Z<=0||k<=0){m(!1);return}const E=Math.min(L.width/Z,L.height/k);if(E<nt){m(!1);return}const U=Z*E,F=k*E,W=L.left+(L.width-U)/2-O.left,K=L.top+(L.height-F)/2-O.top,ne=Math.max(Math.floor(G),Math.floor(G+(0-W)/E)),ee=Math.min(Math.ceil(G+Z),Math.ceil(G+(T-W)/E)),ue=Math.max(Math.floor(Y),Math.floor(Y+(0-K)/E)),ae=Math.min(Math.ceil(Y+k),Math.ceil(Y+(S-K)/E));if(ee<=ne||ae<=ue){m(!1);return}m(!0);const ve=W+(0-G)*E,de=K+(0-Y)*E,te=W+(t-G)*E,fe=K+(n-Y)*E;b.save(),b.beginPath(),b.rect(ve,de,te-ve,fe-de),b.clip(),b.textAlign="center",b.textBaseline="middle",b.lineJoin="round";const be=E*.14,se=E-be*2;for(let ge=ue;ge<ae;ge++)for(let re=ne;re<ee;re++){if(re<0||ge<0||re>=t||ge>=n)continue;const j=o(re,ge,f);if(!j||j.lines.length===0)continue;const q=j.lines.length;let w=1;for(const M of j.lines)M.length>w&&(w=M.length);const R=se/(q*1.15),P=se/(w*.62)||R,y=Math.min(R,P,24);if(y<6)continue;const I=W+(re-G+.5)*E,C=K+(ge-Y+.5)*E,$=y*1.15,H=j.luminance<=.55,ie=H?"#ffffff":"#000000";b.font=`${y}px ui-monospace, SFMono-Regular, Menlo, monospace`,b.lineWidth=Math.max(1.4,y*.16),b.strokeStyle=H?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let D=C-q*$/2+$/2;for(let M=0;M<j.lines.length;M++){const N=j.lines[M];b.strokeText(N,I,D),b.fillStyle=((he=j.colors)==null?void 0:he[M])??ie,b.fillText(N,I,D),D+=$}}b.restore()},[e,t,n,o,f,m,d]);return a.useEffect(()=>{s()},[s,r,i.x,i.y,u,f,d,A]),a.useEffect(()=>{const c=_.current;if(!c)return;const v=new ResizeObserver(()=>s());return v.observe(c),()=>v.disconnect()},[s]),l.jsx("canvas",{ref:_,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Ie({notation:e,onChange:t,className:n=""}){return l.jsx("button",{type:"button",onClick:r=>{r.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:r=>r.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const bn=`
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
`,Fe={linear:0,srgb:1,reinhard:2,aces:3,extended:4},wt=new WeakMap;function xn(e,t){let n=wt.get(e);n||(n=new Map,wt.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:bn,targetFormat:t}),n.set(t,r)),r}function xt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function yt(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const r=e.createTexture(256,1,"rgba32float");return r.write(t),r}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function yn(e,t,n,r){var m;const i=xt(t),o=xn(e,i),f=yt(e,r.isScalar?r.colormap:void 0),u=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,x=Fe[r.operator]??Fe.srgb,d=new Float32Array([r.exposureEV,x,u,r.isScalar?1:0]),_=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),g=new Float32Array([r.hdrOut?1:0]),A=new Float32Array([r.filter==="nearest"?0:1]);let h;try{h=e.createBindGroup(o,[{binding:0,resource:n},{binding:1,resource:f},{binding:2,resource:{uniform:d}},{binding:3,resource:{uniform:_}},{binding:4,resource:{uniform:g}},{binding:5,resource:{uniform:A}}]),e.renderFullscreen(t,o,h)}finally{(m=h==null?void 0:h.destroy)==null||m.call(h),f.destroy()}}const En={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},_n={linear:0,signed:1,positive:2},Pn={split:0,blend:1,diff:2},Et=new WeakMap;function Tn(e,t){let n=Et.get(e);n||(n=new Map,Et.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:wn,targetFormat:t}),n.set(t,r)),r}function Sn(e,t,n,r,i){var p;const o=xt(t),f=Tn(e,o),u=i.mode==="diff"&&!!i.diffColormap,x=i.isScalar?i.colormap:u?i.diffColormap:void 0,d=yt(e,x),_=typeof i.gamma=="number"&&i.gamma>0?i.gamma:0,g=Fe[i.operator]??Fe.srgb,A=new Float32Array([i.exposureEV,g,_,i.isScalar?1:0]),h=new Float32Array([i.uv.x,i.uv.y,i.uv.w,i.uv.h]),m=new Float32Array([Pn[i.mode],i.split,i.alpha,En[i.diffSubmode]??0]),s=new Float32Array([_n[i.diffCmapMode??"linear"]??0,i.hdrOut?1:0,u?1:0,0]),c=new Float32Array([i.filter==="nearest"?0:1]);let v;try{v=e.createBindGroup(f,[{binding:0,resource:n},{binding:1,resource:r},{binding:2,resource:d},{binding:3,resource:{uniform:A}},{binding:4,resource:{uniform:h}},{binding:5,resource:{uniform:m}},{binding:6,resource:{uniform:s}},{binding:7,resource:{uniform:c}}]),e.renderFullscreen(t,f,v)}finally{(p=v==null?void 0:v.destroy)==null||p.call(v),d.destroy()}}function _t(e,t,n){if(n<=0)return{mse:0,psnr:1/0,mae:0};const r=e/n,i=t/n,o=r<=0?1/0:10*Math.log10(1/r);return{mse:r,psnr:o,mae:i}}async function Mn(e,t,n){const r=Math.min(t.width,n.width),i=Math.min(t.height,n.height),o=r*i*3;if(o<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:A,sumAbs:h}=await e.reduceDiffSumSquaredAbs(t,n,r,i);return _t(A,h,o)}const f=await e.readback(t),u=await e.readback(n),x=f instanceof Uint8Array,d=u instanceof Uint8Array;let _=0,g=0;for(let A=0;A<i;A++)for(let h=0;h<r;h++){const m=(A*t.width+h)*4,s=(A*n.width+h)*4;for(let c=0;c<3;c++){const v=(f[m+c]??0)/(x?255:1),p=(u[s+c]??0)/(d?255:1),T=v-p;_+=T*T,g+=Math.abs(T)}}return _t(_,g,o)}function Pt(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const Rn=12,Pe=[];function Tt(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1),Pe.push(e)}function Cn(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1)}function Be(e){e.parked||(Cn(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.parked=!0)}function St(e){for(;Pe.length>Rn;){const t=Pe.find(n=>n!==e&&!n.visible)??Pe.find(n=>n!==e);if(!t)break;Be(t)}}function Mt(e){var i,o;if(e.disposed)return;if(Pt())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Tt(e),St(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const n=e.backingWidth||((i=e.source)==null?void 0:i.width)||1,r=e.backingHeight||((o=e.source)==null?void 0:o.height)||1;if(e.canvas.width=n,e.canvas.height=r,e.surface.configure(n,r),e.source){const f=t.createTexture(e.source.width,e.source.height,e.source.format);f.write(e.source.data),e.srcTexture=f}e.parked=!1,Tt(e),St(e)}function Dn(e,t){if(e.disposed||!e.source)return!0;try{return Mt(e),!e.surface||!e.srcTexture?!1:(yn(e.device,e.surface,e.srcTexture,t),!0)}catch(n){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Be(e),!1}}function An(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},resize(t,n){if(e.disposed)return;const r=Math.max(1,Math.round(t)),i=Math.max(1,Math.round(n));e.backingWidth===r&&e.backingHeight===i||(e.backingWidth=r,e.backingHeight=i,!e.parked&&e.surface&&(e.canvas.width=r,e.canvas.height=i,e.surface.configure(r,i)))},render(t){return Dn(e,t)},park(){e.disposed||Be(e)},restore(){e.disposed||!e.source||Mt(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Be(e),e.source=null,e.disposed=!0)}}}async function In(e,t){const n=await Ge(),r={canvas:e,device:n,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return An(r)}function Rt(e){e.dispose()}function Un(e,t){const{brightness:n,contrast:r,exposure:i,flipSign:o}=e;return[`url(#${t})`,`brightness(${(1+n)*Math.pow(2,i)})`,`contrast(${1+r})`,...o?["invert(1)"]:[]].join(" ")}function Ct(e){const n=`cairn-gamma-${a.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:r,contrast:i,gamma:o,exposure:f,offset:u,flipSign:x}=e,d=a.useMemo(()=>Un(e,n),[n,r,i,f,x]);return{gammaFilterId:n,filterStr:d,gamma:o,offset:u}}function Dt({id:e,gamma:t,offset:n}){return l.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:l.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:l.jsxs("feComponentTransfer",{children:[l.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),l.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),l.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:n})]})})})}const Ln={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function At({imageUrl:e,baselineUrl:t,isBaseline:n=!1,diffMode:r,interpolation:i,colormap:o,showAxes:f,processing:u=Ln,zoom:x=1,pan:d={x:0,y:0},onViewportChange:_,onNaturalSize:g,label:A,isDraggable:h=!1,onDragStart:m,overlay:s,overlaySettings:c,pixelValueNotation:v="decimal"}){var H,ie;const p=a.useRef(null),T=a.useRef(null),S=a.useRef(null),b=a.useRef(null),L=a.useRef(null),O=a.useRef(null),G=a.useRef(null),[Y,Z]=a.useState(0),k=a.useCallback(()=>Z(D=>D+1),[]),[E,U]=a.useState(v),[F,W]=a.useState(!1),K=a.useCallback(D=>{p.current=D,D&&(L.current=D)},[]),ne=a.useCallback(D=>{T.current=D,D&&(L.current=D)},[]),ee=a.useCallback(D=>{D&&(L.current=D)},[]),[ue,ae]=a.useState(!1),[ve,de]=a.useState(!1),[te,fe]=a.useState(null),{flipSign:be}=u,{gammaFilterId:se,filterStr:he,gamma:ge,offset:re}=Ct(u),j=`translate(${d.x}px, ${d.y}px) scale(${x})`,{containerProps:q}=Ae({containerRef:b,zoom:x,pan:d,onViewportChange:_}),w=!n&&r!=="none"&&t!=null&&e!=null,R=r!=="none"&&t!=null,P=o!=="none"&&!w&&!(n&&R)&&e!=null;a.useEffect(()=>{if(!P||!e){de(!1);return}let D=!1;de(!1);const M=`${e}::${o}`,N=ze(M);if(N){const V=T.current;if(V){V.width=N.width,V.height=N.height;const z=V.getContext("2d");z&&z.putImageData(N,0,0),G.current=N,k(),fe({w:N.width,h:N.height}),g==null||g(N.width,N.height),de(!0)}return}const X=new Image;return X.onload=()=>{if(D)return;const V=document.createElement("canvas");V.width=X.naturalWidth,V.height=X.naturalHeight;const z=V.getContext("2d");if(!z)return;z.drawImage(X,0,0);const oe=z.getImageData(0,0,V.width,V.height),Me=lt.has(o)?"positive":"linear",ce=Xe(oe,o,Me);He(M,ce);const ye=T.current;if(!ye||D)return;ye.width=ce.width,ye.height=ce.height;const me=ye.getContext("2d");me&&me.putImageData(ce,0,0),G.current=ce,k(),fe({w:ce.width,h:ce.height}),g==null||g(ce.width,ce.height),de(!0)},X.src=e,()=>{D=!0}},[P,e,o]);const y=a.useCallback((D,M)=>{fe(N=>N&&N.w===D&&N.h===M?N:{w:D,h:M}),g==null||g(D,M)},[]);a.useEffect(()=>{if(!e){O.current=null,G.current=null,k();return}let D=!1;return Re(e).then(M=>{D||(O.current=M,o==="none"&&(G.current=M),k())}),()=>{D=!0}},[e,o,k]);const I=a.useCallback((D,M,N)=>{const X=O.current;if(!X||D<0||M<0||D>=X.width||M>=X.height)return null;const V=(M*X.width+D)*4,z=X.data[V],oe=X.data[V+1],Me=X.data[V+2],ce=G.current;let ye=z,me=oe,Ee=Me;if(ce&&ce.width===X.width&&ce.height===X.height){const De=(M*ce.width+D)*4;ye=ce.data[De],me=ce.data[De+1],Ee=ce.data[De+2]}const Ue=(.299*ye+.587*me+.114*Ee)/255;return o!=="none"||z===oe&&oe===Me?{lines:[J(z,"uint8",N)],luminance:Ue}:{lines:[J(z,"uint8",N),J(oe,"uint8",N),J(Me,"uint8",N)],luminance:Ue,colors:[le[0],le[1],le[2]]}},[o]);a.useEffect(()=>{if(!w){ae(!1);return}let D=!1;const M=cn(),N=M==="gpu"||M==="auto",X=`${t}::${e}::${r}::${o}`;if(M!=="gpu"){const V=ze(X);if(V){const z=p.current;if(z){(z.width!==V.width||z.height!==V.height)&&(z.width=V.width,z.height=V.height);const oe=z.getContext("2d");oe&&oe.putImageData(V,0,0),y(V.width,V.height),ae(!0)}return}}return(async()=>{const[V,z]=await Promise.all([Re(t),Re(e)]);if(D||!V||!z)return;const Me=r.includes("signed")?"signed":"positive",ce=o!=="none"?We(o):null,ye={diffMode:r,colormap:ce,cmapMode:Me};if(N)try{const Le=p.current;if(Le){const De=an(V,z,ye,Le);if(De){if(D)return;y(De.width,De.height),ae(!0);return}}}catch(Le){console.warn("[cairn] WebGL 2 diff error:",Le)}if(M==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let me=Qt(V,z,r);o!=="none"&&(me=Xe(me,o,Me)),He(X,me);const Ee=p.current;if(!Ee||D)return;(Ee.width!==me.width||Ee.height!==me.height)&&(Ee.width=me.width,Ee.height=me.height);const Ue=Ee.getContext("2d");Ue&&Ue.putImageData(me,0,0),y(me.width,me.height),ae(!0)})(),()=>{D=!0}},[t,e,r,w,o,g]);const C=i==="auto"?void 0:i,$=be?{filter:"invert(1)"}:{};return l.jsxs("div",{className:"relative flex flex-col h-full",children:[l.jsx(Dt,{id:se,gamma:ge,offset:re}),l.jsxs("div",{ref:b,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:f&&te?"16px 4px 4px 28px":"4px",...q.style},onPointerDown:q.onPointerDown,onPointerMove:q.onPointerMove,onPointerUp:q.onPointerUp,onPointerCancel:q.onPointerCancel,children:[l.jsxs("div",{ref:S,className:"relative w-full h-full",style:{transform:j,transformOrigin:"0 0"},children:[e?w?l.jsxs(l.Fragment,{children:[!ue&&l.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),l.jsx("canvas",{ref:K,className:"w-full h-full object-contain block",style:{display:ue?"block":"none",imageRendering:C,...$}})]}):P?l.jsxs(l.Fragment,{children:[!ve&&l.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),l.jsx("canvas",{ref:ne,className:"w-full h-full object-contain block",style:{display:ve?"block":"none",imageRendering:C,...$}})]}):l.jsx("img",{ref:ee,src:e,alt:A,className:"w-full h-full object-contain block",draggable:!1,style:{filter:he,imageRendering:C},onLoad:D=>{const M=D.currentTarget;fe({w:M.naturalWidth,h:M.naturalHeight}),g==null||g(M.naturalWidth,M.naturalHeight)}}):l.jsx("span",{className:"text-xs text-fg-muted",children:"no image"}),f&&te&&l.jsx(Ze,{naturalWidth:te.w,naturalHeight:te.h,zoom:x,containerRef:S}),s&&(c==null?void 0:c.enabled)&&te&&e&&((((H=s.boxes)==null?void 0:H.length)??0)>0||(((ie=s.masks)==null?void 0:ie.length)??0)>0)&&l.jsx(tt,{data:s,settings:c,naturalWidth:te.w,naturalHeight:te.h})]}),e&&te&&l.jsx(xe,{imageElRef:L,naturalWidth:te.w,naturalHeight:te.h,zoom:x,pan:d,sample:I,notation:E,version:Y,onActiveChange:W}),F&&l.jsx(Ie,{notation:E,onChange:U})]}),l.jsx(Qe,{label:A,isDraggable:h,onDragStart:m})]})}function kn(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`HdrImagePane: unsupported shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}const Te=e=>Number.isFinite(e)?e:0;function Gn(e,t,n,r){const{h:i,w:o,c:f}=kn(e.shape),u=e.data,x=un(t),d=new Uint8ClampedArray(o*i*4);for(let _=0;_<o*i;_++){const g=_*f;let A,h,m,s=1;f===1?A=h=m=Te(u[g]):f===3?(A=Te(u[g]),h=Te(u[g+1]),m=Te(u[g+2])):(A=Te(u[g]),h=Te(u[g+1]),m=Te(u[g+2]),s=Te(u[g+3]));const c=[je(A,n),je(h,n),je(m,n)],[v,p,T]=x(c),S=_*4;d[S]=255*Ke(v,r),d[S+1]=255*Ke(p,r),d[S+2]=255*Ke(T,r),d[S+3]=255*(s<0?0:s>1?1:s)}return new ImageData(d,o,i)}function On({hdr:e,tonemap:t="srgb",exposure:n=0,gamma:r,showAxes:i=!1,label:o="",interpolation:f="auto",zoom:u=1,pan:x={x:0,y:0},onViewportChange:d,pixelValueNotation:_="decimal"}){const g=a.useRef(null),A=a.useRef(null),h=a.useRef(null),[m,s]=a.useState(null),c=a.useRef(null),[v,p]=a.useState(0),[T,S]=a.useState(_),[b,L]=a.useState(!1);a.useEffect(()=>{const k=g.current;if(!k)return;let E;try{E=Gn(e,t,n,r)}catch(F){console.error("[cairn] HDR tone-map error:",F);return}(k.width!==E.width||k.height!==E.height)&&(k.width=E.width,k.height=E.height);const U=k.getContext("2d");U&&(U.putImageData(E,0,0),c.current=E,p(F=>F+1),s(F=>F&&F.w===E.width&&F.h===E.height?F:{w:E.width,h:E.height}))},[e,t,n,r]);const{containerProps:O}=Ae({containerRef:h,zoom:u,pan:x,onViewportChange:d}),G=a.useCallback((k,E,U)=>{const F=m;if(!F||k<0||E<0||k>=F.w||E>=F.h)return null;const W=e.shape.length===2?1:e.shape[2]??1,K=(E*F.w+k)*W,ne=e.data,ee=c.current;let ue=.5;if(ee&&ee.width===F.w&&ee.height===F.h){const ae=(E*F.w+k)*4;ue=(.299*ee.data[ae]+.587*ee.data[ae+1]+.114*ee.data[ae+2])/255}return W===1?{lines:[J(ne[K]??0,"unit",U)],luminance:ue}:{lines:[J(ne[K]??0,"unit",U),J(ne[K+1]??0,"unit",U),J(ne[K+2]??0,"unit",U)],luminance:ue,colors:[le[0],le[1],le[2]]}},[e,m]),Y=f==="auto"?void 0:f,Z=`translate(${x.x}px, ${x.y}px) scale(${u})`;return l.jsxs("div",{className:"relative flex flex-col h-full",children:[l.jsxs("div",{ref:h,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:i&&m?"16px 4px 4px 28px":"4px",...O.style},onPointerDown:O.onPointerDown,onPointerMove:O.onPointerMove,onPointerUp:O.onPointerUp,onPointerCancel:O.onPointerCancel,children:[l.jsxs("div",{ref:A,className:"relative w-full h-full",style:{transform:Z,transformOrigin:"0 0"},children:[l.jsx("canvas",{ref:g,className:"w-full h-full object-contain block",style:{imageRendering:Y}}),i&&m&&l.jsx(Ze,{naturalWidth:m.w,naturalHeight:m.h,zoom:u,containerRef:A})]}),m&&l.jsx(xe,{imageElRef:g,naturalWidth:m.w,naturalHeight:m.h,zoom:u,pan:x,sample:G,notation:T,version:v,onActiveChange:L}),b&&l.jsx(Ie,{notation:T,onChange:S})]}),o?l.jsx(Qe,{label:o}):null]})}function Fn(e){return"hdr"in e&&e.hdr!=null}const Bn=["linear","srgb","reinhard","aces"];function Nn(e){return e&&Bn.includes(e)?e:"srgb"}const Se=e=>Number.isFinite(e)?e:0;function Vn(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function $n(e){const{h:t,w:n,c:r}=Vn(e.shape),i=e.data,o=new Float32Array(n*t*4);for(let f=0;f<n*t;f++){const u=f*r;let x,d,_,g=1;r===1?x=d=_=Se(i[u]):r===3?(x=Se(i[u]),d=Se(i[u+1]),_=Se(i[u+2])):(x=Se(i[u]),d=Se(i[u+1]),_=Se(i[u+2]),g=Se(i[u+3]));const A=f*4;o[A]=x,o[A+1]=d,o[A+2]=_,o[A+3]=g}return{data:o,width:n,height:t,format:"rgba32float"}}function It(e,t,n,r){if(n<=0||r<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const i=Math.min(t.width/n,t.height/r),o=n*i,f=r*i,u=(t.width-o)/2,x=(t.height-f)/2,d=Math.max(e.zoom,1e-6),_=1/d,g=1/d,A=(u*(1-d)-e.pan.x)/(o*d),h=(x*(1-d)-e.pan.y)/(f*d);return{x:A,y:h,w:_,h:g}}function Ut(e,t,n,r){const i=e.w*n,o=e.h*r;return i<=0||o<=0||t.width<=0||t.height<=0?0:Math.min(t.width/i,t.height/o)}function Lt(e,t,n){if(e.width<=0||e.height<=0||t<=0||n<=0)return{width:0,height:0};const r=Math.min(e.width/t,e.height/n);return{width:t*r,height:n*r}}const Wn={zoom:1,pan:{x:0,y:0}};function Xn(e){var j,q;const t=Fn(e),n=a.useRef(null),r=a.useRef(null),i=a.useRef(null),o=a.useRef(null),f=a.useRef(!1),[u,x]=a.useState(!1),[d,_]=a.useState(!1),[g,A]=a.useState(null),[h,m]=a.useState(0),[s,c]=a.useState(0),[v,p]=a.useState({x:0,y:0,w:1,h:1}),T=a.useRef(null),S=a.useRef(null),[b,L]=a.useState(0),[O,G]=a.useState(e.pixelValueNotation??"decimal"),[Y,Z]=a.useState(!1),k=e.zoom??1,E=e.pan??{x:0,y:0},U=e.onViewportChange,F=t?"none":e.colormap??"none",W=et();a.useEffect(()=>{const w=n.current;if(!w)return;let R=!1;return Ge().then(P=>{if(R)return;const y=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,I=P.capabilities.hdr&&y&&t;f.current=I,In(w,{hdr:I}).then(C=>{if(R){Rt(C);return}o.current=C,_(!0)}).catch(C=>{R||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",C),x(!0))})}).catch(P=>{R||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",P),x(!0))}),()=>{R=!0,o.current&&(Rt(o.current),o.current=null)}},[]);const{containerProps:K}=Ae({containerRef:r,zoom:k,pan:E,onViewportChange:U}),ne=a.useCallback(()=>{U==null||U(Wn)},[U]);a.useEffect(()=>{const w=r.current;if(!w)return;const R=new ResizeObserver(()=>c(P=>P+1));return R.observe(w),()=>R.disconnect()},[]),a.useEffect(()=>{const w=r.current;if(!w)return;const R=new IntersectionObserver(P=>{const y=P[0];if(!y)return;const I=o.current;I&&(I.setVisible(y.isIntersecting),y.isIntersecting?I.isParked&&(I.restore(),c(C=>C+1)):I.park())},{threshold:0});return R.observe(w),()=>R.disconnect()},[]),a.useEffect(()=>{var P;if(!t||!d)return;const w=e.hdr;T.current=w;const R=$n(w);(P=o.current)==null||P.setSource(R),A(y=>y&&y.w===R.width&&y.h===R.height?y:{w:R.width,h:R.height}),L(y=>y+1),m(y=>y+1)},[t,d,t?e.hdr:null]),a.useEffect(()=>{if(t||!d)return;const w=e,R=w.imageUrl,P=w.colormap??"none";if(!R){S.current=null,A(null),L(I=>I+1),n.current&&(n.current.style.width="",n.current.style.height="");return}let y=!1;return Re(R).then(I=>{var H,ie;if(y||!I)return;let C=I;if(P!=="none"){const D=`gpu::${R}::${P}`,M=ze(D);if(M)C=M;else{const N=lt.has(P)?"positive":"linear";C=Xe(I,P,N),He(D,C)}}S.current=I;const $={data:C.data,width:C.width,height:C.height,format:"rgba8unorm"};(H=o.current)==null||H.setSource($),A(D=>D&&D.w===C.width&&D.h===C.height?D:{w:C.width,h:C.height}),(ie=w.onNaturalSize)==null||ie.call(w,C.width,C.height),L(D=>D+1),m(D=>D+1)}),()=>{y=!0}},[t,d,t?null:e.imageUrl,t?null:e.colormap]);const ee=t?e.exposure??0:0,ue=t?e.tonemap:void 0,ae=t?e.gamma:void 0;a.useEffect(()=>{const w=o.current;if(!w||!d||!g)return;const R=r.current,P=R?R.getBoundingClientRect():{width:g.w,height:g.h},y=It({zoom:k,pan:E},P,g.w,g.h);p(X=>X.x===y.x&&X.y===y.y&&X.w===y.w&&X.h===y.h?X:y);const I=i.current,C=I?I.getBoundingClientRect():P,$=Lt(C,g.w,g.h),H=n.current;if($.width>0&&$.height>0&&H){const X=Math.round($.width),V=Math.round($.height),z=`${X}px`,oe=`${V}px`;H.style.width!==z&&(H.style.width=z),H.style.height!==oe&&(H.style.height=oe),w.resize(X*W,V*W)}const ie=$.width>0?$:H?H.getBoundingClientRect():P,D=Ut(y,ie,g.w,g.h)>=nt?"nearest":"linear",M=y,N=t?{exposureEV:ee,operator:f.current?"extended":Nn(ue),gamma:ae,isScalar:!1,hdrOut:f.current,uv:M,filter:D}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:M,filter:D};try{w.render(N)||x(!0)}catch(X){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",X),x(!0)}},[d,g,h,k,E.x,E.y,ee,ue,ae,s,t,W]);const ve=a.useCallback((w,R,P)=>{if(t){const M=T.current,N=g;if(!M||!N||w<0||R<0||w>=N.w||R>=N.h)return null;const X=M.shape.length===2?1:M.shape[2]??1,V=(R*N.w+w)*X,z=M.data,oe=.5;return X===1?{lines:[J(z[V]??0,"unit",P)],luminance:oe}:{lines:[J(z[V]??0,"unit",P),J(z[V+1]??0,"unit",P),J(z[V+2]??0,"unit",P)],luminance:oe,colors:[le[0],le[1],le[2]]}}const y=S.current;if(!y||w<0||R<0||w>=y.width||R>=y.height)return null;const I=(R*y.width+w)*4,C=y.data[I],$=y.data[I+1],H=y.data[I+2],ie=(.299*C+.587*$+.114*H)/255;return F!=="none"||C===$&&$===H?{lines:[J(C,"uint8",P)],luminance:ie}:{lines:[J(C,"uint8",P),J($,"uint8",P),J(H,"uint8",P)],luminance:ie,colors:[le[0],le[1],le[2]]}},[t,g,F]),de=e.showAxes??!1,te=t?e.label??"":e.label,fe=e.interpolation??"auto",be=fe==="auto"?void 0:fe,se=t?void 0:e.overlay,he=t?void 0:e.overlaySettings,ge=t?!1:e.isDraggable??!1,re=t?void 0:e.onDragStart;return u?t?l.jsx(On,{hdr:e.hdr,tonemap:e.tonemap,exposure:e.exposure,gamma:e.gamma,showAxes:de,label:te,interpolation:fe,zoom:e.zoom,pan:e.pan,onViewportChange:U,pixelValueNotation:e.pixelValueNotation}):l.jsx(At,{imageUrl:e.imageUrl,baselineUrl:e.baselineUrl??null,isBaseline:e.isBaseline,diffMode:e.diffMode??"none",interpolation:fe,colormap:F,showAxes:de,processing:e.processing,zoom:e.zoom,pan:e.pan,onViewportChange:U,onNaturalSize:e.onNaturalSize,label:te,isDraggable:ge,onDragStart:re,className:e.className,overlay:se,overlaySettings:he,pixelValueNotation:e.pixelValueNotation}):l.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":d,children:[l.jsxs("div",{ref:r,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:de&&g?"16px 4px 4px 28px":"4px",...K.style},onPointerDown:K.onPointerDown,onPointerMove:K.onPointerMove,onPointerUp:K.onPointerUp,onPointerCancel:K.onPointerCancel,onDoubleClick:ne,"data-gpu-image-viewport":!0,children:[l.jsxs("div",{ref:i,className:"relative w-full h-full flex items-center justify-center",children:[l.jsx("canvas",{ref:n,className:"w-full h-full block",style:{imageRendering:be},"data-gpu-image-canvas":!0}),de&&g&&l.jsx(Ze,{naturalWidth:g.w,naturalHeight:g.h,zoom:k,containerRef:i}),se&&(he==null?void 0:he.enabled)&&g&&((((j=se.boxes)==null?void 0:j.length)??0)>0||(((q=se.masks)==null?void 0:q.length)??0)>0)&&l.jsx(tt,{data:se,settings:he,naturalWidth:g.w,naturalHeight:g.h})]}),g&&l.jsx(xe,{imageElRef:n,naturalWidth:g.w,naturalHeight:g.h,zoom:k,pan:E,sourceWindow:v,sample:ve,notation:O,version:b,onActiveChange:Z}),Y&&l.jsx(Ie,{notation:O,onChange:G})]}),te?l.jsx(Qe,{label:te,isDraggable:ge,onDragStart:re}):null]})}const zn={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function Hn({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,zoom:f,pan:u,onViewportChange:x,processing:d=zn,interpolation:_="auto",label:g="",isDraggable:A=!1,onDragStart:h,overlay:m,overlaySettings:s,pixelValueNotation:c="decimal"}){var ge,re;const v=a.useRef(null),[p,T]=a.useState(null),[S,b]=a.useState(null),[L,O]=a.useState(c),[G,Y]=a.useState(!1),Z=a.useRef(null),k=a.useRef(null),E=a.useRef(null),U=a.useRef(null),[F,W]=a.useState(0);a.useEffect(()=>{if(!e){E.current=null,W(q=>q+1);return}let j=!1;return Re(e).then(q=>{j||(E.current=q,W(w=>w+1))}),()=>{j=!0}},[e]),a.useEffect(()=>{if(!t){U.current=null,W(q=>q+1);return}let j=!1;return Re(t).then(q=>{j||(U.current=q,W(w=>w+1))}),()=>{j=!0}},[t]);const K=j=>(q,w,R)=>{const P=j.current;if(!P||q<0||w<0||q>=P.width||w>=P.height)return null;const y=(w*P.width+q)*4,I=P.data[y],C=P.data[y+1],$=P.data[y+2],H=(.299*I+.587*C+.114*$)/255;return I===C&&C===$?{lines:[J(I,"uint8",R)],luminance:H}:{lines:[J(I,"uint8",R),J(C,"uint8",R),J($,"uint8",R)],luminance:H,colors:[le[0],le[1],le[2]]}},ne=a.useMemo(()=>K(E),[]),ee=a.useMemo(()=>K(U),[]),ue=!!m&&!!(s!=null&&s.enabled)&&!!p&&!!e&&((((ge=m.boxes)==null?void 0:ge.length)??0)>0||(((re=m.masks)==null?void 0:re.length)??0)>0),{gammaFilterId:ae,filterStr:ve,gamma:de,offset:te}=Ct(d),fe=`translate(${u.x}px, ${u.y}px) scale(${f})`,be=_==="auto"?void 0:_,{containerProps:se,modifierActive:he}=Ae({containerRef:v,zoom:f,pan:u,onViewportChange:x});return l.jsxs("div",{className:"relative flex flex-col h-full",children:[l.jsx(Dt,{id:ae,gamma:de,offset:te}),l.jsxs("div",{ref:v,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...se.style},onPointerDown:se.onPointerDown,onPointerMove:se.onPointerMove,onPointerUp:se.onPointerUp,onPointerCancel:se.onPointerCancel,children:[l.jsxs("div",{className:"relative w-full h-full",children:[l.jsxs("div",{className:"relative w-full h-full",style:{transform:fe,transformOrigin:"0 0"},children:[l.jsx("img",{ref:Z,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:ve,imageRendering:be,...n==="blend"?{opacity:i}:{}},onLoad:j=>{const q=j.currentTarget;T({w:q.naturalWidth,h:q.naturalHeight})}}),ue&&l.jsx(tt,{data:m,settings:s,naturalWidth:p.w,naturalHeight:p.h})]}),l.jsx("div",{className:"absolute inset-0 overflow-hidden",style:n==="split"?{clipPath:`inset(0 ${(1-r)*100}% 0 0)`}:void 0,children:l.jsx("div",{className:"w-full h-full",style:{transform:fe,transformOrigin:"0 0"},children:l.jsx("img",{ref:k,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:ve,imageRendering:be,...n==="blend"?{opacity:1-i}:{}},onLoad:j=>{const q=j.currentTarget;b({w:q.naturalWidth,h:q.naturalHeight})}})})}),n==="split"&&l.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>o==null?void 0:o(.5),onPointerDown:j=>{j.stopPropagation(),j.preventDefault();const w=j.currentTarget.parentElement.getBoundingClientRect(),R=y=>{o==null||o(Math.max(0,Math.min(1,(y.clientX-w.left)/w.width)))},P=()=>{window.removeEventListener("pointermove",R),window.removeEventListener("pointerup",P)};window.addEventListener("pointermove",R),window.addEventListener("pointerup",P)},children:l.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?l.jsxs(l.Fragment,{children:[t&&S&&l.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:l.jsx(xe,{imageElRef:k,naturalWidth:S.w,naturalHeight:S.h,zoom:f,pan:u,sample:ee,notation:L,version:F})}),e&&p&&l.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:l.jsx(xe,{imageElRef:Z,naturalWidth:p.w,naturalHeight:p.h,zoom:f,pan:u,sample:ne,notation:L,version:F,onActiveChange:Y})})]}):e&&p&&l.jsx(xe,{imageElRef:Z,naturalWidth:p.w,naturalHeight:p.h,zoom:f,pan:u,sample:ne,notation:L,version:F,onActiveChange:Y}),G&&l.jsx(Ie,{notation:L,onChange:O})]}),l.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),l.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${A&&!he?" cairn-drag-grip":""}`,draggable:A&&!he,onDragStart:h,style:{cursor:A&&!he?"grab":void 0},children:[l.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),g]})]})}const Yn={zoom:1,pan:{x:0,y:0}};function qn(e){const t=We(e),n=new Float32Array(256*4);for(let r=0;r<256;r++)n[r*4+0]=t[r*3+0]/255,n[r*4+1]=t[r*3+1]/255,n[r*4+2]=t[r*3+2]/255,n[r*4+3]=1;return n}function jn({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,diffSubmode:f,colormap:u="none",zoom:x,pan:d,onViewportChange:_,interpolation:g="auto",label:A="",pixelValueNotation:h="decimal"}){const m=a.useRef(null),s=a.useRef(null),c=a.useRef(null),[v,p]=a.useState(!1),[T,S]=a.useState(!1),[b,L]=a.useState(null),[O,G]=a.useState(0),[Y,Z]=a.useState(0),[k,E]=a.useState(null),[U,F]=a.useState(h),[W,K]=a.useState(!1),[ne,ee]=a.useState({x:0,y:0,w:1,h:1}),ue=a.useRef(null),ae=a.useRef(null),[ve,de]=a.useState(0),te=et();a.useEffect(()=>{const w=s.current;if(!w)return;let R=!1;return Ge().then(P=>{if(!R)try{if(Pt())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const y=P.createSurface(w,{hdr:!1});c.current={device:P,surface:y,texA:null,texB:null},S(!0)}catch(y){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",y),p(!0)}}).catch(P=>{R||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",P),p(!0))}),()=>{var y,I;R=!0;const P=c.current;P&&((y=P.texA)==null||y.destroy(),(I=P.texB)==null||I.destroy(),c.current=null)}},[]),a.useEffect(()=>{const w=m.current;if(!w)return;const R=new ResizeObserver(()=>Z(P=>P+1));return R.observe(w),()=>R.disconnect()},[]),a.useEffect(()=>{if(!T)return;let w=!1;if(!c.current)return;async function P(y){return y?Re(y):null}return Promise.all([P(e),P(t)]).then(([y,I])=>{var ie,D;if(w||!c.current)return;const C=c.current;ue.current=y,ae.current=I,(ie=C.texA)==null||ie.destroy(),(D=C.texB)==null||D.destroy(),C.texA=null,C.texB=null;const $=y??I;if(!$){L(null),de(M=>M+1),s.current&&(s.current.style.width="",s.current.style.height="");return}const H=M=>{const N=C.device.createTexture(M.width,M.height,"rgba8unorm");return N.write(M.data),N};C.texA=H(I??$),C.texB=H(y??$),L({w:$.width,h:$.height}),de(M=>M+1),G(M=>M+1)}),()=>{w=!0}},[T,e,t]);const fe=a.useMemo(()=>(f??"").includes("signed")?"signed":"positive",[f]),be=a.useMemo(()=>u!=="none"?qn(u):void 0,[u]);a.useEffect(()=>{const w=c.current;if(!T||!w||!w.surface||!w.texA||!w.texB||!b)return;const R=m.current,P=R?R.getBoundingClientRect():{width:b.w,height:b.h},y=It({zoom:x,pan:d},P,b.w,b.h);ee(M=>M.x===y.x&&M.y===y.y&&M.w===y.w&&M.h===y.h?M:y);const I=Lt(P,b.w,b.h),C=s.current;if(I.width>0&&I.height>0&&C&&w.surface){const M=Math.round(I.width),N=Math.round(I.height),X=`${M}px`,V=`${N}px`;C.style.width!==X&&(C.style.width=X),C.style.height!==V&&(C.style.height=V);const z=Math.max(1,Math.round(M*te)),oe=Math.max(1,Math.round(N*te));(C.width!==z||C.height!==oe)&&(C.width=z,C.height=oe,w.surface.configure(z,oe))}const $=I.width>0?I:C?C.getBoundingClientRect():P,H=Ut(y,$,b.w,b.h)>=nt?"nearest":"linear",D={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:y,filter:H,mode:n,split:r,alpha:i,diffSubmode:f??"absolute",diffCmapMode:fe,diffColormap:n==="diff"?be:void 0};try{Sn(w.device,w.surface,w.texA,w.texB,D)}catch(M){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",M),p(!0)}},[T,b,O,x,d.x,d.y,n,r,i,f,fe,be,Y,te]),a.useEffect(()=>{const w=c.current;if(!T||!w||!w.texA||!w.texB||!t){E(null);return}let R=!1;return Mn(w.device,w.texA,w.texB).then(P=>{R||E(P)}),()=>{R=!0}},[T,O,t]);const se=w=>(R,P,y)=>{const I=w.current;if(!I||R<0||P<0||R>=I.width||P>=I.height)return null;const C=(P*I.width+R)*4,$=I.data[C],H=I.data[C+1],ie=I.data[C+2],D=(.299*$+.587*H+.114*ie)/255;return $===H&&H===ie?{lines:[J($,"uint8",y)],luminance:D}:{lines:[J($,"uint8",y),J(H,"uint8",y),J(ie,"uint8",y)],luminance:D,colors:[le[0],le[1],le[2]]}},he=a.useMemo(()=>se(ue),[]),ge=a.useMemo(()=>se(ae),[]),{containerProps:re}=Ae({containerRef:m,zoom:x,pan:d,onViewportChange:_}),j=a.useCallback(()=>_==null?void 0:_(Yn),[_]),q=g==="auto"?void 0:g;return v?n==="diff"?l.jsx(At,{imageUrl:e,baselineUrl:t,diffMode:f??"signed",interpolation:g,colormap:u,showAxes:!1,zoom:x,pan:d,onViewportChange:_,label:A,pixelValueNotation:h}):l.jsx(Hn,{imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,zoom:x,pan:d,onViewportChange:_,interpolation:g,label:A,pixelValueNotation:h}):l.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":T,children:[l.jsxs("div",{ref:m,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...re.style},onPointerDown:re.onPointerDown,onPointerMove:re.onPointerMove,onPointerUp:re.onPointerUp,onPointerCancel:re.onPointerCancel,onDoubleClick:j,"data-gpu-compare-viewport":!0,children:[l.jsxs("div",{className:"relative w-full h-full flex items-center justify-center",children:[l.jsx("canvas",{ref:s,className:"w-full h-full block",style:{imageRendering:q},"data-gpu-compare-canvas":!0}),n==="split"&&l.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:w=>{w.stopPropagation(),o==null||o(.5)},onPointerDown:w=>{w.stopPropagation(),w.preventDefault();const P=w.currentTarget.parentElement.getBoundingClientRect(),y=C=>{o==null||o(Math.max(0,Math.min(1,(C.clientX-P.left)/P.width)))},I=()=>{window.removeEventListener("pointermove",y),window.removeEventListener("pointerup",I)};window.addEventListener("pointermove",y),window.addEventListener("pointerup",I)},children:l.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?l.jsxs(l.Fragment,{children:[t&&b&&l.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:l.jsx(xe,{imageElRef:s,naturalWidth:b.w,naturalHeight:b.h,zoom:x,pan:d,sourceWindow:ne,sample:ge,notation:U,version:ve})}),t&&b&&l.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:l.jsx(xe,{imageElRef:s,naturalWidth:b.w,naturalHeight:b.h,zoom:x,pan:d,sourceWindow:ne,sample:he,notation:U,version:ve,onActiveChange:K})})]}):b&&l.jsx(xe,{imageElRef:s,naturalWidth:b.w,naturalHeight:b.h,zoom:x,pan:d,sourceWindow:ne,sample:he,notation:U,version:ve,onActiveChange:K}),W&&l.jsx(Ie,{notation:U,onChange:F})]}),l.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),A?l.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:A}):null,k&&l.jsxs("span",{className:`absolute right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${W?"top-8":"top-1"}`,"data-gpu-compare-metrics":!0,children:["MSE ",k.mse.toExponential(2)," · PSNR ",Number.isFinite(k.psnr)?k.psnr.toFixed(1):"∞"," dB · MAE"," ",k.mae.toExponential(2)]})]})}const Kn="cairn-plot:gpu-image-ready";async function Zn(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Ge(),window.__cairnPlotGpuImagePane=Xn,window.__cairnPlotGpuComparePane=jn,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(Kn))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}Zn()})(__cairnPlotJsxRuntime,__cairnPlotReact);

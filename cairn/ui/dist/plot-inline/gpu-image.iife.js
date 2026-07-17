var Zn=Object.defineProperty;var Qn=(c,a,_e)=>a in c?Zn(c,a,{enumerable:!0,configurable:!0,writable:!0,value:_e}):c[a]=_e;var Q=(c,a,_e)=>Qn(c,typeof a!="symbol"?a+"":a,_e);(function(c,a){"use strict";const _e=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function it(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"premultiplied",usage:_e}),{hdr:!1,format:n}}function Lt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:_e}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:_e}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return it(e,t)}}}const kt=`
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
`;function Ne(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function ot(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Gt(e){const t=(e&32768)>>15,n=(e&31744)>>10,r=e&1023;let i;return n===0?i=r/1024*Math.pow(2,-14):n===31?i=r?NaN:1/0:i=(1+r/1024)*Math.pow(2,n-15),t?-i:i}const Ot={texture:0,sampler:1,uniform:2};function Ve(e,t){return e*3+Ot[t]}const Ft={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Bt(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let r;for(;(r=n.exec(e))!==null;){const i=Number(r[1]),o=r[2]!==void 0,d=r[3].trim();if(o){const u=Ft[d];if(u===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${d}" (binding ${i}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(i,{kind:"uniform",sizeBytes:u})}else d==="sampler"||d==="sampler_comparison"?t.set(i,{kind:"sampler"}):t.set(i,{kind:"texture"})}return t}class at{constructor(t,n,r,i){Q(this,"width");Q(this,"height");Q(this,"format");Q(this,"gpuTexture");Q(this,"device");Q(this,"destroyed",!1);this.device=t,this.width=n,this.height=r,this.format=i,this.gpuTexture=t.createTexture({size:{width:n,height:r,depthOrArrayLayers:1},format:Ne(i),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*ot(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class st{constructor(t){Q(this,"_s");Q(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Nt{constructor(t,n,r,i,o){Q(this,"_p");Q(this,"gpuPipeline");Q(this,"bindings");Q(this,"bindGroupLayout");Q(this,"variants");Q(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=r,this.buildVariant=o,this.variants=new Map([[i,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function Vt(e,t){const n=[];for(const[r,i]of t)i.kind==="uniform"?n.push({binding:r,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):i.kind==="sampler"?n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class Wt{constructor(t){Q(this,"_c");Q(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class $t{constructor(t,n){Q(this,"_b");Q(this,"gpuBindGroup");Q(this,"ownedBuffers");Q(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class Xt{constructor(t,n,r,i){Q(this,"canvas");Q(this,"hdr");Q(this,"format");Q(this,"context");Q(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=r.hdr,this.format=r.format,this.reconfigure=i}configure(t,n){this.canvas.width=t,this.canvas.height=n;const r=this.reconfigure();this.hdr=r.hdr,this.format=r.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function ke(e){return"canvas"in e}async function zt(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let r=null;function i(){return r||(r=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),r}function o(h){return ke(h)?h.getCurrentTextureView():h.gpuTexture.createView()}function d(h){if(ke(h))return{width:h.canvas.width,height:h.canvas.height};const m=h;return{width:m.width,height:m.height}}let u=!1;const x=256;let f=null,P=null;function g(){if(!f||!P){const h=t.createShaderModule({code:kt});P=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const m=t.createPipelineLayout({bindGroupLayouts:[P]});f=t.createComputePipeline({layout:m,compute:{module:h,entryPoint:"cs_main"}})}return{pipeline:f,layout:P}}return{backend:"webgpu",capabilities:n,createTexture(h,m,l){return new at(t,h,m,l)},createSampler(h){const m=(h==null?void 0:h.filter)==="linear"?"linear":"nearest",l=t.createSampler({magFilter:m,minFilter:m,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new st(l)},createRenderPipeline(h){const m=t.createShaderModule({code:h.shaderWGSL}),l=Bt(h.shaderWGSL),s=Ne(h.targetFormat),v=Vt(t,l),p=t.createPipelineLayout({bindGroupLayouts:[v]}),T=b=>t.createRenderPipeline({layout:p,vertex:{module:m,entryPoint:"vs_main"},fragment:{module:m,entryPoint:"fs_main",targets:[{format:b}]},primitive:{topology:"triangle-list"}}),S=T(s);return new Nt(S,l,v,s,T)},createComputePipeline(h){const m=t.createShaderModule({code:h.shaderWGSL}),l=t.createComputePipeline({layout:"auto",compute:{module:m,entryPoint:"cs_main"}});return new Wt(l)},createBindGroup(h,m){const l=h,s=new Map,v=[];for(const[T,S]of l.bindings)if(S.kind==="uniform"){const b=t.createBuffer({size:S.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});v.push(b),s.set(T,{binding:T,resource:{buffer:b}})}else S.kind==="sampler"&&s.set(T,{binding:T,resource:i()});for(const T of m){const S=T.resource;if(S instanceof at){const b=Ve(T.binding,"texture");l.bindings.has(b)&&s.set(b,{binding:b,resource:S.gpuTexture.createView()})}else if(S instanceof st){const b=Ve(T.binding,"sampler");l.bindings.has(b)&&s.set(b,{binding:b,resource:S.gpuSampler})}else{const b=Ve(T.binding,"uniform"),U=l.bindings.get(b);if(U&&U.kind==="uniform"){const O=S.uniform,G=t.createBuffer({size:Math.max(U.sizeBytes,O.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(G,0,O.buffer,O.byteOffset,O.byteLength),v.push(G),s.set(b,{binding:b,resource:{buffer:G}})}}}const p=t.createBindGroup({layout:l.bindGroupLayout,entries:Array.from(s.values())});return new $t(p,v)},createSurface(h,m){const l=h.getContext("webgpu");if(!l)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const s=m.hdr&&n.hdr,v=()=>s?Lt(l,t):it(l,t),p=v();return new Xt(h,l,p,v)},renderFullscreen(h,m,l){const s=m,v=l,p=o(h),{width:T,height:S}=d(h),b=ke(h)?h.format:Ne(h.format),U=s.pipelineFor(b),O=t.createCommandEncoder(),G=O.beginRenderPass({colorAttachments:[{view:p,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});G.setPipeline(U),G.setBindGroup(0,v.gpuBindGroup),G.setViewport(0,0,T,S,0,1),G.draw(3),G.end(),t.queue.submit([O.finish()])},async readback(h){const m=ke(h),{width:l,height:s}=d(h),v=m?h.hdr?"rgba16float":"rgba8unorm":h.format,p=m&&h.format==="bgra8unorm",T=m?h.getCurrentGPUTexture():h.gpuTexture,S=ot(v),b=l*S,U=256,O=Math.ceil(b/U)*U,G=O*s,$=t.createBuffer({size:G,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),j=t.createCommandEncoder();j.copyTextureToBuffer({texture:T},{buffer:$,bytesPerRow:O,rowsPerImage:s},{width:l,height:s,depthOrArrayLayers:1}),t.queue.submit([j.finish()]),await $.mapAsync(GPUMapMode.READ);const L=new Uint8Array($.getMappedRange()),E=new Uint8Array(b*s);for(let I=0;I<s;I++){const F=I*O,V=I*b;E.set(L.subarray(F,F+b),V)}if($.unmap(),$.destroy(),v==="rgba8unorm"){if(p)for(let I=0;I<E.length;I+=4){const F=E[I],V=E[I+2];E[I]=V,E[I+2]=F}return E}if(v==="rgba16float"){const I=new Uint16Array(E.buffer,E.byteOffset,E.byteLength/2),F=new Float32Array(I.length);for(let V=0;V<I.length;V++)F[V]=Gt(I[V]);return F}return new Float32Array(E.buffer,E.byteOffset,E.byteLength/4)},async reduceDiffSumSquaredAbs(h,m,l,s){const v=h,p=m,T=Math.max(0,l*s),S=Math.max(1,Math.ceil(T/x)),{pipeline:b,layout:U}=g(),O=S*2*4,G=t.createBuffer({size:O,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),$=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer($,0,new Uint32Array([Math.max(1,l),Math.max(1,s),T,0]));const j=t.createBindGroup({layout:U,entries:[{binding:0,resource:v.gpuTexture.createView()},{binding:1,resource:p.gpuTexture.createView()},{binding:2,resource:{buffer:G}},{binding:3,resource:{buffer:$}}]}),L=t.createBuffer({size:O,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),E=t.createCommandEncoder(),I=E.beginComputePass();I.setPipeline(b),I.setBindGroup(0,j),I.dispatchWorkgroups(S),I.end(),E.copyBufferToBuffer(G,0,L,0,O),t.queue.submit([E.finish()]),await L.mapAsync(GPUMapMode.READ);const V=new Float32Array(L.getMappedRange()).slice();L.unmap(),L.destroy(),G.destroy(),$.destroy();let q=0,ne=0;for(let ee=0;ee<S;ee++)q+=V[ee*2],ne+=V[ee*2+1];return{sumSq:q,sumAbs:ne}},destroy(){u||(t.destroy(),u=!0)},isContextLost(){return!1}}}let We=null;async function Ht(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return zt()}function Ge(){return We||(We=Ht()),We}function Yt(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function qt(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const i=n/255*(e.length-1),o=Math.floor(i),d=Math.min(o+1,e.length-1),u=i-o,[x,f,P]=Yt(e[o],e[d],u);t[n*3]=Math.round(x),t[n*3+1]=Math.round(f),t[n*3+2]=Math.round(P)}return t}const ct={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},lt=new Set(["red-green","red-blue"]),ut=new Map;function $e(e){let t=ut.get(e);if(!t){const n=ct[e]??ct.viridis;t=qt(n),ut.set(e,t)}return t}function Xe(e,t,n="linear"){const r=$e(t),i=new ImageData(e.width,e.height),o=e.data,d=i.data;for(let u=0;u<o.length;u+=4){const x=(o[u]+o[u+1]+o[u+2])/3;let f;n==="positive"?f=Math.round(128+x/255*127):f=Math.round(x),f=Math.max(0,Math.min(255,f)),d[u]=r[f*3],d[u+1]=r[f*3+1],d[u+2]=r[f*3+2],d[u+3]=o[u+3]}return i}function dt(e){const t=new Map;return{get(n){return t.get(n)},set(n,r){if(t.size>=e){const i=t.keys().next().value;i!==void 0&&t.delete(i)}t.set(n,r)}}}const ft=dt(50);function ze(e){return ft.get(e)}function He(e,t){ft.set(e,t)}const ht=dt(100);function jt(e){return ht.get(e)}function Kt(e,t){ht.set(e,t)}function Zt(e,t,n){const r=Math.min(e.width,t.width),i=Math.min(e.height,t.height),o=new ImageData(r,i);for(let d=0;d<i;d++)for(let u=0;u<r;u++){const x=(d*e.width+u)*4,f=(d*t.width+u)*4,P=(d*r+u)*4;for(let g=0;g<3;g++){const C=e.data[x+g],h=t.data[f+g],m=C-h,l=Math.abs(m),s=Math.max(C,1);let v;switch(n){case"signed":v=(m+255)/2;break;case"absolute":v=l;break;case"squared":v=m*m/255;break;case"relative_signed":v=(m/s+1)*127.5;break;case"relative_absolute":v=l/s*255;break;case"relative_squared":v=m*m/(s*s)*255;break}o.data[P+g]=Math.min(255,Math.max(0,Math.round(v)))}o.data[P+3]=255}return o}async function Re(e){const t=jt(e);return t||new Promise(n=>{const r=new Image;r.onload=()=>{try{const i=document.createElement("canvas");i.width=r.naturalWidth,i.height=r.naturalHeight;const o=i.getContext("2d");if(!o){n(null);return}o.drawImage(r,0,0);const d=o.getImageData(0,0,i.width,i.height);Kt(e,d),n(d)}catch(i){console.warn("[cairn] loadImageData failed:",i),n(null)}},r.onerror=i=>{console.warn("[cairn] loadImageData: image failed to load:",e,i),n(null)},r.src=e})}const Qt={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Jt={linear:0,signed:1,positive:2},en=`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,tn=`#version 300 es
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
}`;let De=null,B=null,me=null,Oe=null;function nn(){if(B)return B;try{if(typeof OffscreenCanvas<"u"?De=new OffscreenCanvas(1,1):De=document.createElement("canvas"),B=De.getContext("webgl2",{preserveDrawingBuffer:!0}),!B)return console.warn("[cairn] WebGL 2 not available"),null;const e=B.createShader(B.VERTEX_SHADER);if(B.shaderSource(e,en),B.compileShader(e),!B.getShaderParameter(e,B.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",B.getShaderInfoLog(e)),null;const t=B.createShader(B.FRAGMENT_SHADER);if(B.shaderSource(t,tn),B.compileShader(t),!B.getShaderParameter(t,B.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",B.getShaderInfoLog(t)),null;if(me=B.createProgram(),B.attachShader(me,e),B.attachShader(me,t),B.linkProgram(me),!B.getProgramParameter(me,B.LINK_STATUS))return console.error("[cairn] WebGL program link:",B.getProgramInfoLog(me)),null;Oe=B.createVertexArray(),B.bindVertexArray(Oe);const n=B.createBuffer();B.bindBuffer(B.ARRAY_BUFFER,n),B.bufferData(B.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),B.STATIC_DRAW);const r=B.getAttribLocation(me,"a_pos");return B.enableVertexAttribArray(r),B.vertexAttribPointer(r,2,B.FLOAT,!1,0,0),B.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),B}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function gt(e,t,n){const r=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),r}function rn(e,t,n){const r=new Uint8Array(1024);for(let o=0;o<256;o++)r[o*4]=t[o*3],r[o*4+1]=t[o*3+1],r[o*4+2]=t[o*3+2],r[o*4+3]=255;const i=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,i),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,r),i}function on(e,t,n,r){const i=nn();if(!i||!me||!Oe||!De)return null;const o=Math.min(e.width,t.width),d=Math.min(e.height,t.height);De.width=o,De.height=d,i.viewport(0,0,o,d);const u=gt(i,e,0),x=gt(i,t,1);let f=null;n.colormap?f=rn(i,n.colormap,2):(f=i.createTexture(),i.activeTexture(i.TEXTURE2),i.bindTexture(i.TEXTURE_2D,f),i.texImage2D(i.TEXTURE_2D,0,i.RGBA8,1,1,0,i.RGBA,i.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),i.useProgram(me),i.uniform1i(i.getUniformLocation(me,"u_baseline"),0),i.uniform1i(i.getUniformLocation(me,"u_other"),1),i.uniform1i(i.getUniformLocation(me,"u_lut"),2),i.uniform1i(i.getUniformLocation(me,"u_diff_mode"),Qt[n.diffMode]),i.uniform1i(i.getUniformLocation(me,"u_cmap_mode"),Jt[n.cmapMode]??0),i.uniform1i(i.getUniformLocation(me,"u_use_colormap"),n.colormap?1:0),i.bindVertexArray(Oe),i.drawArrays(i.TRIANGLE_STRIP,0,4),i.bindVertexArray(null),r.width=o,r.height=d;const P=r.getContext("2d");return P&&(P.save(),P.scale(1,-1),P.drawImage(De,0,0,o,d,0,-d,o,d),P.restore()),i.deleteTexture(u),i.deleteTexture(x),i.deleteTexture(f),{width:o,height:d}}const an={cardSettings:(e,t,n)=>`cairn:card-settings:${e}:${t}:${n}`,runLayout:e=>`cairn:run-layout:${e}`,collapsedSections:e=>`cairn:collapsed-sections:${e}`,comparisons:e=>`cairn:comparisons:${e}`,comparisonTemplates:e=>`cairn:comparison-templates:${e}`,reportTemplates:e=>`cairn:report-templates:${e}`,streamMode:"cairn:stream-mode",renderMode:"cairn:render-mode",scroll:e=>`cairn:scroll:${e}`,lastComparison:e=>`cairn:last-comparison:${e}`};function sn(){try{const e=localStorage.getItem(an.renderMode);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const we=e=>e<0?0:e>1?1:e,Ye=e=>{const t=e<0?0:e;return t/(1+t)},qe=e=>{const t=e<0?0:e,n=t*(2.51*t+.03),r=t*(2.43*t+.59)+.14;return we(n/r)},mt={linear:([e,t,n])=>[we(e),we(t),we(n)],srgb:([e,t,n])=>[we(e),we(t),we(n)],reinhard:([e,t,n])=>[Ye(e),Ye(t),Ye(n)],aces:([e,t,n])=>[qe(e),qe(t),qe(n)],extended:([e,t,n])=>[e,t,n]},cn="srgb";function ln(e){return e&&mt[e]||mt[cn]}function je(e,t){return e*2**t}function un(e){const t=we(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function Ke(e,t){return typeof t=="number"&&t>0?we(Math.pow(we(e),1/t)):un(e)}function pt(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Ze({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:r}){const i=pt(e),o=pt(t),d=[];for(let p=0;p<=e;p+=i)d.push(p);const u=[];for(let p=0;p<=t;p+=o)u.push(p);const x=1/n,f=8*x,P=-12*x,g=-2*x,C=r==null?void 0:r.current;let h=0,m=0,l=0,s=0;if(C){const p=C.clientWidth,T=C.clientHeight,S=p/e,b=T/t,U=Math.min(S,b);l=e*U,s=t*U,h=(p-l)/2,m=(T-s)/2}const v=C&&l>0;return c.jsxs(c.Fragment,{children:[c.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:v?m:0,transform:`translateY(${P}px)`,fontSize:f},children:d.map(p=>c.jsx("span",{className:"mono",style:{position:"absolute",left:v?h+p/e*l:`${p/e*100}%`,transform:"translateX(-50%)"},children:p},p))}),c.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:v?h:0,transform:`translateX(${g}px)`,fontSize:f},children:u.map(p=>c.jsx("span",{className:"mono",style:{position:"absolute",top:v?m+p/t*s:`${p/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*x}px`},children:p},p))})]})}function Qe({label:e,isDraggable:t,onDragStart:n}){return c.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&c.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const vt=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function Je(e){const t=vt.length;return vt[(e%t+t)%t]}function dn(e){const n=a.useRef(null),[r,i]=a.useState({w:0,h:0}),o=a.useRef(null),d=a.useRef(null);return a.useEffect(()=>{var f;const u=n.current;if(u===d.current||((f=o.current)==null||f.disconnect(),o.current=null,d.current=u,!u))return;const x=new ResizeObserver(P=>{for(const g of P)i({w:g.contentRect.width,h:g.contentRect.height})});o.current=x,x.observe(u)}),a.useEffect(()=>()=>{var u;return(u=o.current)==null?void 0:u.disconnect()},[]),{ref:n,size:r}}function fn(){const[e,t]=a.useState(!1);return a.useEffect(()=>{const n=o=>{(o.key==="Alt"||o.key==="Control"||o.key==="Meta")&&t(!0)},r=o=>{(o.key==="Alt"||o.key==="Control"||o.key==="Meta")&&t(!1)},i=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",r),window.addEventListener("blur",i),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",r),window.removeEventListener("blur",i)}},[]),e}const hn=.25,gn=64;function Ae(e){const{containerRef:t,zoom:n,pan:r,onViewportChange:i,minZoom:o=hn,maxZoom:d=gn}=e,u=fn(),x=a.useRef(u);x.current=u;const f=a.useRef({zoom:n,pan:r});f.current={zoom:n,pan:r};const P=a.useRef(i);P.current=i,a.useEffect(()=>{const s=t.current;if(!s||!i)return;const v=p=>{var L;if(!x.current)return;p.preventDefault(),p.stopPropagation();const T=p.deltaY<0?1.1:1/1.1,S=f.current,b=Math.max(o,Math.min(d,S.zoom*T));if(S.zoom===b)return;const U=s.getBoundingClientRect(),O=p.clientX-U.left,G=p.clientY-U.top,$=O-(O-S.pan.x)/S.zoom*b,j=G-(G-S.pan.y)/S.zoom*b;(L=P.current)==null||L.call(P,{zoom:b,pan:{x:$,y:j}})};return s.addEventListener("wheel",v,{passive:!1}),()=>s.removeEventListener("wheel",v)},[t,!!i,o,d]);const g=a.useRef(null),C=a.useCallback(s=>{!x.current||!P.current||(s.currentTarget.setPointerCapture(s.pointerId),g.current={pointerId:s.pointerId,startX:s.clientX,startY:s.clientY,panX:f.current.pan.x,panY:f.current.pan.y})},[]),h=a.useCallback(s=>{var S;const v=g.current;if(!v||v.pointerId!==s.pointerId)return;const p=s.clientX-v.startX,T=s.clientY-v.startY;(S=P.current)==null||S.call(P,{zoom:f.current.zoom,pan:{x:v.panX+p,y:v.panY+T}})},[]),m=a.useCallback(s=>{const v=g.current;if(!(!v||v.pointerId!==s.pointerId)){try{s.currentTarget.releasePointerCapture(s.pointerId)}catch{}g.current=null}},[]),l=u&&!!i;return{containerProps:{onPointerDown:C,onPointerMove:h,onPointerUp:m,onPointerCancel:m,style:{cursor:l?"move":void 0,touchAction:l?"none":void 0}},modifierActive:u}}function et(){const[e,t]=a.useState(()=>typeof window<"u"&&window.devicePixelRatio||1);return a.useEffect(()=>{if(typeof matchMedia>"u")return;let n=!1,r=null;const i=()=>{n||(t(window.devicePixelRatio||1),o())};function o(){if(n)return;const d=window.devicePixelRatio||1;r=matchMedia(`(resolution: ${d}dppx)`),r.addEventListener("change",i,{once:!0})}return o(),()=>{n=!0,r==null||r.removeEventListener("change",i)}},[]),e}function mn(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function bt(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function tt({data:e,settings:t,naturalWidth:n,naturalHeight:r}){const{ref:i,size:o}=dn(),d=a.useRef(null),u=a.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),x=a.useMemo(()=>{const l=o.w,s=o.h;if(l<=0||s<=0||n<=0||r<=0)return null;const v=Math.min(l/n,s/r),p=n*v,T=r*v;return{left:(l-p)/2,top:(s-T)/2,width:p,height:T}},[o.w,o.h,n,r]),f=e.masks,P=t.showMasks&&!!f&&f.length>0,g=a.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(a.useEffect(()=>{if(!P||!f)return;const l=d.current;if(!l)return;(l.width!==n||l.height!==r)&&(l.width=n,l.height=r);const s=l.getContext("2d");if(!s)return;s.clearRect(0,0,l.width,l.height);let v=!1;const p=s.createImageData(n,r),T=p.data;let S=f.length,b=!1;const U=()=>{v||b&&s.putImageData(p,0,0)},O=document.createElement("canvas");O.width=n,O.height=r;const G=O.getContext("2d",{willReadFrequently:!0});for(const $ of f){const j=new Image;j.onload=()=>{if(!v){if(G){G.clearRect(0,0,n,r),G.drawImage(j,0,0,n,r);const L=G.getImageData(0,0,n,r).data;for(let E=0;E<n*r;E++){const I=L[E*4];if(I===0||u.has(I))continue;const[F,V,q]=mn(Je(I));T[E*4]=F,T[E*4+1]=V,T[E*4+2]=q,T[E*4+3]=255,b=!0}}S-=1,S===0&&U()}},j.onerror=()=>{S-=1,S===0&&U()},j.src=`data:image/png;base64,${$.png_b64}`}return()=>{v=!0}},[P,f,n,r,g]),!x)return c.jsx("div",{ref:i,className:"absolute inset-0 pointer-events-none"});const C=e.boxes??[],h=t.showBoxes&&C.length>0,m=e.class_labels??{};return c.jsxs("div",{ref:i,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[P&&c.jsx("canvas",{ref:d,className:"absolute",style:{left:x.left,top:x.top,width:x.width,height:x.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),h&&c.jsx("svg",{className:"absolute",style:{left:x.left,top:x.top,width:x.width,height:x.height,overflow:"visible"},viewBox:`0 0 ${n} ${r}`,preserveAspectRatio:"none",children:C.map((l,s)=>{if(!bt(l,t,u))return null;const v=l.domain==="pixel"?1:n,p=l.domain==="pixel"?1:r,T=l.position.minX*v,S=l.position.minY*p,b=(l.position.maxX-l.position.minX)*v,U=(l.position.maxY-l.position.minY)*p;return c.jsx("rect",{x:T,y:S,width:b,height:U,fill:"none",stroke:Je(l.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},s)})}),h&&c.jsx("div",{className:"absolute",style:{left:x.left,top:x.top,width:x.width,height:x.height},children:C.map((l,s)=>{if(!bt(l,t,u))return null;const v=l.domain==="pixel"?1/n:1,p=l.domain==="pixel"?1/r:1,T=l.position.minX*v*100,S=l.position.minY*p*100,b=l.label??m[String(l.class_id)]??`#${l.class_id}`,U=l.score!=null?` ${(l.score*100).toFixed(0)}%`:"";return!b&&!U?null:c.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${T}%`,top:`${S}%`,transform:"translateY(-100%)",backgroundColor:Je(l.class_id)},children:c.jsxs("span",{className:"mono",children:[b,U]})},s)})})]})}const nt=30,ce=["#ff5a5a","#39d353","#5b9bff"];function rt(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function J(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):rt(e/255):rt(n==="int"?e*255:e)}const pn={x:0,y:0,w:1,h:1};function xe({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:r,pan:i,sample:o,notation:d="decimal",version:u=0,onActiveChange:x,sourceWindow:f=pn}){const P=a.useRef(null),g=a.useRef(!1),C=et(),h=a.useRef(x);h.current=x;const m=a.useCallback(s=>{var v;s!==g.current&&(g.current=s,(v=h.current)==null||v.call(h,s))},[]),l=a.useCallback(()=>{var fe;const s=P.current,v=e.current;if(!s)return;const p=window.devicePixelRatio||1,T=s.clientWidth,S=s.clientHeight;if(T===0||S===0)return;s.width!==Math.round(T*p)&&(s.width=Math.round(T*p)),s.height!==Math.round(S*p)&&(s.height=Math.round(S*p));const b=s.getContext("2d");if(!b)return;if(b.setTransform(p,0,0,p,0,0),b.clearRect(0,0,T,S),!v||t<=0||n<=0){m(!1);return}const U=v.getBoundingClientRect(),O=s.getBoundingClientRect();if(U.width===0||U.height===0){m(!1);return}const G=f.x*t,$=f.y*n,j=f.w*t,L=f.h*n;if(j<=0||L<=0){m(!1);return}const E=Math.min(U.width/j,U.height/L);if(E<nt){m(!1);return}const I=j*E,F=L*E,V=U.left+(U.width-I)/2-O.left,q=U.top+(U.height-F)/2-O.top,ne=Math.max(Math.floor(G),Math.floor(G+(0-V)/E)),ee=Math.min(Math.ceil(G+j),Math.ceil(G+(T-V)/E)),le=Math.max(Math.floor($),Math.floor($+(0-q)/E)),oe=Math.min(Math.ceil($+L),Math.ceil($+(S-q)/E));if(ee<=ne||oe<=le){m(!1);return}m(!0);const pe=V+(0-G)*E,ue=q+(0-$)*E,te=V+(t-G)*E,de=q+(n-$)*E;b.save(),b.beginPath(),b.rect(pe,ue,te-pe,de-ue),b.clip(),b.textAlign="center",b.textBaseline="middle",b.lineJoin="round";const be=E*.14,ae=E-be*2;for(let he=le;he<oe;he++)for(let ie=ne;ie<ee;ie++){if(ie<0||he<0||ie>=t||he>=n)continue;const Y=o(ie,he,d);if(!Y||Y.lines.length===0)continue;const X=Y.lines.length;let w=1;for(const k of Y.lines)k.length>w&&(w=k.length);const M=ae/(X*1.15),_=ae/(w*.62)||M,y=Math.min(M,_,24);if(y<6)continue;const D=V+(ie-G+.5)*E,A=q+(he-$+.5)*E,z=y*1.15,K=Y.luminance<=.55,N=K?"#ffffff":"#000000";b.font=`${y}px ui-monospace, SFMono-Regular, Menlo, monospace`,b.lineWidth=Math.max(1.4,y*.16),b.strokeStyle=K?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let R=A-X*z/2+z/2;for(let k=0;k<Y.lines.length;k++){const W=Y.lines[k];b.strokeText(W,D,R),b.fillStyle=((fe=Y.colors)==null?void 0:fe[k])??N,b.fillText(W,D,R),R+=z}}b.restore()},[e,t,n,o,d,m,f]);return a.useEffect(()=>{l()},[l,r,i.x,i.y,u,d,f,C]),a.useEffect(()=>{const s=P.current;if(!s)return;const v=new ResizeObserver(()=>l());return v.observe(s),()=>v.disconnect()},[l]),c.jsx("canvas",{ref:P,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Ie({notation:e,onChange:t,className:n=""}){return c.jsx("button",{type:"button",onClick:r=>{r.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:r=>r.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const vn=`
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
`,bn=`
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
`,Fe={linear:0,srgb:1,reinhard:2,aces:3,extended:4},wt=new WeakMap;function wn(e,t){let n=wt.get(e);n||(n=new Map,wt.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:vn,targetFormat:t}),n.set(t,r)),r}function xt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function yt(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const r=e.createTexture(256,1,"rgba32float");return r.write(t),r}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function xn(e,t,n,r){var m;const i=xt(t),o=wn(e,i),d=yt(e,r.isScalar?r.colormap:void 0),u=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,x=Fe[r.operator]??Fe.srgb,f=new Float32Array([r.exposureEV,x,u,r.isScalar?1:0]),P=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),g=new Float32Array([r.hdrOut?1:0]),C=new Float32Array([r.filter==="nearest"?0:1]);let h;try{h=e.createBindGroup(o,[{binding:0,resource:n},{binding:1,resource:d},{binding:2,resource:{uniform:f}},{binding:3,resource:{uniform:P}},{binding:4,resource:{uniform:g}},{binding:5,resource:{uniform:C}}]),e.renderFullscreen(t,o,h)}finally{(m=h==null?void 0:h.destroy)==null||m.call(h),d.destroy()}}const yn={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},En={linear:0,signed:1,positive:2},_n={split:0,blend:1,diff:2},Et=new WeakMap;function Pn(e,t){let n=Et.get(e);n||(n=new Map,Et.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:bn,targetFormat:t}),n.set(t,r)),r}function Tn(e,t,n,r,i){var p;const o=xt(t),d=Pn(e,o),u=i.mode==="diff"&&!!i.diffColormap,x=i.isScalar?i.colormap:u?i.diffColormap:void 0,f=yt(e,x),P=typeof i.gamma=="number"&&i.gamma>0?i.gamma:0,g=Fe[i.operator]??Fe.srgb,C=new Float32Array([i.exposureEV,g,P,i.isScalar?1:0]),h=new Float32Array([i.uv.x,i.uv.y,i.uv.w,i.uv.h]),m=new Float32Array([_n[i.mode],i.split,i.alpha,yn[i.diffSubmode]??0]),l=new Float32Array([En[i.diffCmapMode??"linear"]??0,i.hdrOut?1:0,u?1:0,0]),s=new Float32Array([i.filter==="nearest"?0:1]);let v;try{v=e.createBindGroup(d,[{binding:0,resource:n},{binding:1,resource:r},{binding:2,resource:f},{binding:3,resource:{uniform:C}},{binding:4,resource:{uniform:h}},{binding:5,resource:{uniform:m}},{binding:6,resource:{uniform:l}},{binding:7,resource:{uniform:s}}]),e.renderFullscreen(t,d,v)}finally{(p=v==null?void 0:v.destroy)==null||p.call(v),f.destroy()}}function _t(e,t,n){if(n<=0)return{mse:0,psnr:1/0,mae:0};const r=e/n,i=t/n,o=r<=0?1/0:10*Math.log10(1/r);return{mse:r,psnr:o,mae:i}}async function Sn(e,t,n){const r=Math.min(t.width,n.width),i=Math.min(t.height,n.height),o=r*i*3;if(o<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:C,sumAbs:h}=await e.reduceDiffSumSquaredAbs(t,n,r,i);return _t(C,h,o)}const d=await e.readback(t),u=await e.readback(n),x=d instanceof Uint8Array,f=u instanceof Uint8Array;let P=0,g=0;for(let C=0;C<i;C++)for(let h=0;h<r;h++){const m=(C*t.width+h)*4,l=(C*n.width+h)*4;for(let s=0;s<3;s++){const v=(d[m+s]??0)/(x?255:1),p=(u[l+s]??0)/(f?255:1),T=v-p;P+=T*T,g+=Math.abs(T)}}return _t(P,g,o)}function Pt(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const Mn=12,Pe=[];function Tt(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1),Pe.push(e)}function Rn(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1)}function Be(e){e.parked||(Rn(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.parked=!0)}function St(e){for(;Pe.length>Mn;){const t=Pe.find(n=>n!==e&&!n.visible)??Pe.find(n=>n!==e);if(!t)break;Be(t)}}function Mt(e){var i,o;if(e.disposed)return;if(Pt())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Tt(e),St(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const n=e.backingWidth||((i=e.source)==null?void 0:i.width)||1,r=e.backingHeight||((o=e.source)==null?void 0:o.height)||1;if(e.canvas.width=n,e.canvas.height=r,e.surface.configure(n,r),e.source){const d=t.createTexture(e.source.width,e.source.height,e.source.format);d.write(e.source.data),e.srcTexture=d}e.parked=!1,Tt(e),St(e)}function Dn(e,t){if(e.disposed||!e.source)return!0;try{return Mt(e),!e.surface||!e.srcTexture?!1:(xn(e.device,e.surface,e.srcTexture,t),!0)}catch(n){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Be(e),!1}}function Cn(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},resize(t,n){if(e.disposed)return;const r=Math.max(1,Math.round(t)),i=Math.max(1,Math.round(n));e.backingWidth===r&&e.backingHeight===i||(e.backingWidth=r,e.backingHeight=i,!e.parked&&e.surface&&(e.canvas.width=r,e.canvas.height=i,e.surface.configure(r,i)))},render(t){return Dn(e,t)},park(){e.disposed||Be(e)},restore(){e.disposed||!e.source||Mt(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Be(e),e.source=null,e.disposed=!0)}}}async function An(e,t){const n=await Ge(),r={canvas:e,device:n,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return Cn(r)}function Rt(e){e.dispose()}function In(e,t){const{brightness:n,contrast:r,exposure:i,flipSign:o}=e;return[`url(#${t})`,`brightness(${(1+n)*Math.pow(2,i)})`,`contrast(${1+r})`,...o?["invert(1)"]:[]].join(" ")}function Dt(e){const n=`cairn-gamma-${a.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:r,contrast:i,gamma:o,exposure:d,offset:u,flipSign:x}=e,f=a.useMemo(()=>In(e,n),[n,r,i,d,x]);return{gammaFilterId:n,filterStr:f,gamma:o,offset:u}}function Ct({id:e,gamma:t,offset:n}){return c.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:c.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:c.jsxs("feComponentTransfer",{children:[c.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),c.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),c.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:n})]})})})}const Un={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function At({imageUrl:e,baselineUrl:t,isBaseline:n=!1,diffMode:r,interpolation:i,colormap:o,showAxes:d,processing:u=Un,zoom:x=1,pan:f={x:0,y:0},onViewportChange:P,onNaturalSize:g,label:C,isDraggable:h=!1,onDragStart:m,overlay:l,overlaySettings:s,pixelValueNotation:v="decimal"}){var K,N;const p=a.useRef(null),T=a.useRef(null),S=a.useRef(null),b=a.useRef(null),U=a.useRef(null),O=a.useRef(null),G=a.useRef(null),[$,j]=a.useState(0),L=a.useCallback(()=>j(R=>R+1),[]),[E,I]=a.useState(v),[F,V]=a.useState(!1),q=a.useCallback(R=>{p.current=R,R&&(U.current=R)},[]),ne=a.useCallback(R=>{T.current=R,R&&(U.current=R)},[]),ee=a.useCallback(R=>{R&&(U.current=R)},[]),[le,oe]=a.useState(!1),[pe,ue]=a.useState(!1),[te,de]=a.useState(null),{flipSign:be}=u,{gammaFilterId:ae,filterStr:fe,gamma:he,offset:ie}=Dt(u),Y=`translate(${f.x}px, ${f.y}px) scale(${x})`,{containerProps:X}=Ae({containerRef:b,zoom:x,pan:f,onViewportChange:P}),w=!n&&r!=="none"&&t!=null&&e!=null,M=r!=="none"&&t!=null,_=o!=="none"&&!w&&!(n&&M)&&e!=null;a.useEffect(()=>{if(!_||!e){ue(!1);return}let R=!1;ue(!1);const k=`${e}::${o}`,W=ze(k);if(W){const H=T.current;if(H){H.width=W.width,H.height=W.height;const Z=H.getContext("2d");Z&&Z.putImageData(W,0,0),G.current=W,L(),de({w:W.width,h:W.height}),g==null||g(W.width,W.height),ue(!0)}return}const re=new Image;return re.onload=()=>{if(R)return;const H=document.createElement("canvas");H.width=re.naturalWidth,H.height=re.naturalHeight;const Z=H.getContext("2d");if(!Z)return;Z.drawImage(re,0,0);const ve=Z.getImageData(0,0,H.width,H.height),Me=lt.has(o)?"positive":"linear",se=Xe(ve,o,Me);He(k,se);const ye=T.current;if(!ye||R)return;ye.width=se.width,ye.height=se.height;const ge=ye.getContext("2d");ge&&ge.putImageData(se,0,0),G.current=se,L(),de({w:se.width,h:se.height}),g==null||g(se.width,se.height),ue(!0)},re.src=e,()=>{R=!0}},[_,e,o]);const y=a.useCallback((R,k)=>{de(W=>W&&W.w===R&&W.h===k?W:{w:R,h:k}),g==null||g(R,k)},[]);a.useEffect(()=>{if(!e){O.current=null,G.current=null,L();return}let R=!1;return Re(e).then(k=>{R||(O.current=k,o==="none"&&(G.current=k),L())}),()=>{R=!0}},[e,o,L]);const D=a.useCallback((R,k,W)=>{const re=O.current;if(!re||R<0||k<0||R>=re.width||k>=re.height)return null;const H=(k*re.width+R)*4,Z=re.data[H],ve=re.data[H+1],Me=re.data[H+2],se=G.current;let ye=Z,ge=ve,Ee=Me;if(se&&se.width===re.width&&se.height===re.height){const Ce=(k*se.width+R)*4;ye=se.data[Ce],ge=se.data[Ce+1],Ee=se.data[Ce+2]}const Ue=(.299*ye+.587*ge+.114*Ee)/255;return o!=="none"||Z===ve&&ve===Me?{lines:[J(Z,"uint8",W)],luminance:Ue}:{lines:[J(Z,"uint8",W),J(ve,"uint8",W),J(Me,"uint8",W)],luminance:Ue,colors:[ce[0],ce[1],ce[2]]}},[o]);a.useEffect(()=>{if(!w){oe(!1);return}let R=!1;const k=sn(),W=k==="gpu"||k==="auto",re=`${t}::${e}::${r}::${o}`;if(k!=="gpu"){const H=ze(re);if(H){const Z=p.current;if(Z){(Z.width!==H.width||Z.height!==H.height)&&(Z.width=H.width,Z.height=H.height);const ve=Z.getContext("2d");ve&&ve.putImageData(H,0,0),y(H.width,H.height),oe(!0)}return}}return(async()=>{const[H,Z]=await Promise.all([Re(t),Re(e)]);if(R||!H||!Z)return;const Me=r.includes("signed")?"signed":"positive",se=o!=="none"?$e(o):null,ye={diffMode:r,colormap:se,cmapMode:Me};if(W)try{const Le=p.current;if(Le){const Ce=on(H,Z,ye,Le);if(Ce){if(R)return;y(Ce.width,Ce.height),oe(!0);return}}}catch(Le){console.warn("[cairn] WebGL 2 diff error:",Le)}if(k==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let ge=Zt(H,Z,r);o!=="none"&&(ge=Xe(ge,o,Me)),He(re,ge);const Ee=p.current;if(!Ee||R)return;(Ee.width!==ge.width||Ee.height!==ge.height)&&(Ee.width=ge.width,Ee.height=ge.height);const Ue=Ee.getContext("2d");Ue&&Ue.putImageData(ge,0,0),y(ge.width,ge.height),oe(!0)})(),()=>{R=!0}},[t,e,r,w,o,g]);const A=i==="auto"?void 0:i,z=be?{filter:"invert(1)"}:{};return c.jsxs("div",{className:"relative flex flex-col h-full",children:[c.jsx(Ct,{id:ae,gamma:he,offset:ie}),c.jsxs("div",{ref:b,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:d&&te?"16px 4px 4px 28px":"4px",...X.style},onPointerDown:X.onPointerDown,onPointerMove:X.onPointerMove,onPointerUp:X.onPointerUp,onPointerCancel:X.onPointerCancel,children:[c.jsxs("div",{ref:S,className:"relative w-full h-full",style:{transform:Y,transformOrigin:"0 0"},children:[e?w?c.jsxs(c.Fragment,{children:[!le&&c.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),c.jsx("canvas",{ref:q,className:"w-full h-full object-contain block",style:{display:le?"block":"none",imageRendering:A,...z}})]}):_?c.jsxs(c.Fragment,{children:[!pe&&c.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),c.jsx("canvas",{ref:ne,className:"w-full h-full object-contain block",style:{display:pe?"block":"none",imageRendering:A,...z}})]}):c.jsx("img",{ref:ee,src:e,alt:C,className:"w-full h-full object-contain block",draggable:!1,style:{filter:fe,imageRendering:A},onLoad:R=>{const k=R.currentTarget;de({w:k.naturalWidth,h:k.naturalHeight}),g==null||g(k.naturalWidth,k.naturalHeight)}}):c.jsx("span",{className:"text-xs text-fg-muted",children:"no image"}),d&&te&&c.jsx(Ze,{naturalWidth:te.w,naturalHeight:te.h,zoom:x,containerRef:S}),l&&(s==null?void 0:s.enabled)&&te&&e&&((((K=l.boxes)==null?void 0:K.length)??0)>0||(((N=l.masks)==null?void 0:N.length)??0)>0)&&c.jsx(tt,{data:l,settings:s,naturalWidth:te.w,naturalHeight:te.h})]}),e&&te&&c.jsx(xe,{imageElRef:U,naturalWidth:te.w,naturalHeight:te.h,zoom:x,pan:f,sample:D,notation:E,version:$,onActiveChange:V}),F&&c.jsx(Ie,{notation:E,onChange:I})]}),c.jsx(Qe,{label:C,isDraggable:h,onDragStart:m})]})}function Ln(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`HdrImagePane: unsupported shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}const Te=e=>Number.isFinite(e)?e:0;function kn(e,t,n,r){const{h:i,w:o,c:d}=Ln(e.shape),u=e.data,x=ln(t),f=new Uint8ClampedArray(o*i*4);for(let P=0;P<o*i;P++){const g=P*d;let C,h,m,l=1;d===1?C=h=m=Te(u[g]):d===3?(C=Te(u[g]),h=Te(u[g+1]),m=Te(u[g+2])):(C=Te(u[g]),h=Te(u[g+1]),m=Te(u[g+2]),l=Te(u[g+3]));const s=[je(C,n),je(h,n),je(m,n)],[v,p,T]=x(s),S=P*4;f[S]=255*Ke(v,r),f[S+1]=255*Ke(p,r),f[S+2]=255*Ke(T,r),f[S+3]=255*(l<0?0:l>1?1:l)}return new ImageData(f,o,i)}function Gn({hdr:e,tonemap:t="srgb",exposure:n=0,gamma:r,showAxes:i=!1,label:o="",interpolation:d="auto",zoom:u=1,pan:x={x:0,y:0},onViewportChange:f,pixelValueNotation:P="decimal"}){const g=a.useRef(null),C=a.useRef(null),h=a.useRef(null),[m,l]=a.useState(null),s=a.useRef(null),[v,p]=a.useState(0),[T,S]=a.useState(P),[b,U]=a.useState(!1);a.useEffect(()=>{const L=g.current;if(!L)return;let E;try{E=kn(e,t,n,r)}catch(F){console.error("[cairn] HDR tone-map error:",F);return}(L.width!==E.width||L.height!==E.height)&&(L.width=E.width,L.height=E.height);const I=L.getContext("2d");I&&(I.putImageData(E,0,0),s.current=E,p(F=>F+1),l(F=>F&&F.w===E.width&&F.h===E.height?F:{w:E.width,h:E.height}))},[e,t,n,r]);const{containerProps:O}=Ae({containerRef:h,zoom:u,pan:x,onViewportChange:f}),G=a.useCallback((L,E,I)=>{const F=m;if(!F||L<0||E<0||L>=F.w||E>=F.h)return null;const V=e.shape.length===2?1:e.shape[2]??1,q=(E*F.w+L)*V,ne=e.data,ee=s.current;let le=.5;if(ee&&ee.width===F.w&&ee.height===F.h){const oe=(E*F.w+L)*4;le=(.299*ee.data[oe]+.587*ee.data[oe+1]+.114*ee.data[oe+2])/255}return V===1?{lines:[J(ne[q]??0,"unit",I)],luminance:le}:{lines:[J(ne[q]??0,"unit",I),J(ne[q+1]??0,"unit",I),J(ne[q+2]??0,"unit",I)],luminance:le,colors:[ce[0],ce[1],ce[2]]}},[e,m]),$=d==="auto"?void 0:d,j=`translate(${x.x}px, ${x.y}px) scale(${u})`;return c.jsxs("div",{className:"relative flex flex-col h-full",children:[c.jsxs("div",{ref:h,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:i&&m?"16px 4px 4px 28px":"4px",...O.style},onPointerDown:O.onPointerDown,onPointerMove:O.onPointerMove,onPointerUp:O.onPointerUp,onPointerCancel:O.onPointerCancel,children:[c.jsxs("div",{ref:C,className:"relative w-full h-full",style:{transform:j,transformOrigin:"0 0"},children:[c.jsx("canvas",{ref:g,className:"w-full h-full object-contain block",style:{imageRendering:$}}),i&&m&&c.jsx(Ze,{naturalWidth:m.w,naturalHeight:m.h,zoom:u,containerRef:C})]}),m&&c.jsx(xe,{imageElRef:g,naturalWidth:m.w,naturalHeight:m.h,zoom:u,pan:x,sample:G,notation:T,version:v,onActiveChange:U}),b&&c.jsx(Ie,{notation:T,onChange:S})]}),o?c.jsx(Qe,{label:o}):null]})}function On(e){return"hdr"in e&&e.hdr!=null}const Fn=["linear","srgb","reinhard","aces"];function Bn(e){return e&&Fn.includes(e)?e:"srgb"}const Se=e=>Number.isFinite(e)?e:0;function Nn(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function Vn(e){const{h:t,w:n,c:r}=Nn(e.shape),i=e.data,o=new Float32Array(n*t*4);for(let d=0;d<n*t;d++){const u=d*r;let x,f,P,g=1;r===1?x=f=P=Se(i[u]):r===3?(x=Se(i[u]),f=Se(i[u+1]),P=Se(i[u+2])):(x=Se(i[u]),f=Se(i[u+1]),P=Se(i[u+2]),g=Se(i[u+3]));const C=d*4;o[C]=x,o[C+1]=f,o[C+2]=P,o[C+3]=g}return{data:o,width:n,height:t,format:"rgba32float"}}function It(e,t,n,r){if(n<=0||r<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const i=Math.min(t.width/n,t.height/r),o=n*i,d=r*i,u=(t.width-o)/2,x=(t.height-d)/2,f=Math.max(e.zoom,1e-6),P=t.width/(f*o),g=t.height/(f*d),C=-u/o-e.pan.x/(f*o),h=-x/d-e.pan.y/(f*d);return{x:C,y:h,w:P,h:g}}function Ut(e,t,n,r){const i=e.w*n,o=e.h*r;return i<=0||o<=0||t.width<=0||t.height<=0?0:Math.min(t.width/i,t.height/o)}const Wn={zoom:1,pan:{x:0,y:0}};function $n(e){var Y,X;const t=On(e),n=a.useRef(null),r=a.useRef(null),i=a.useRef(null),o=a.useRef(null),d=a.useRef(!1),[u,x]=a.useState(!1),[f,P]=a.useState(!1),[g,C]=a.useState(null),[h,m]=a.useState(0),[l,s]=a.useState(0),[v,p]=a.useState({x:0,y:0,w:1,h:1}),T=a.useRef(null),S=a.useRef(null),[b,U]=a.useState(0),[O,G]=a.useState(e.pixelValueNotation??"decimal"),[$,j]=a.useState(!1),L=e.zoom??1,E=e.pan??{x:0,y:0},I=e.onViewportChange,F=t?"none":e.colormap??"none",V=et();a.useEffect(()=>{const w=n.current;if(!w)return;let M=!1;return Ge().then(_=>{if(M)return;const y=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,D=_.capabilities.hdr&&y&&t;d.current=D,An(w,{hdr:D}).then(A=>{if(M){Rt(A);return}o.current=A,P(!0)}).catch(A=>{M||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",A),x(!0))})}).catch(_=>{M||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",_),x(!0))}),()=>{M=!0,o.current&&(Rt(o.current),o.current=null)}},[]);const{containerProps:q}=Ae({containerRef:r,zoom:L,pan:E,onViewportChange:I}),ne=a.useCallback(()=>{I==null||I(Wn)},[I]);a.useEffect(()=>{const w=r.current;if(!w)return;const M=new ResizeObserver(()=>s(_=>_+1));return M.observe(w),()=>M.disconnect()},[]),a.useEffect(()=>{const w=r.current;if(!w)return;const M=new IntersectionObserver(_=>{const y=_[0];if(!y)return;const D=o.current;D&&(D.setVisible(y.isIntersecting),y.isIntersecting?D.isParked&&(D.restore(),s(A=>A+1)):D.park())},{threshold:0});return M.observe(w),()=>M.disconnect()},[]),a.useEffect(()=>{var _;if(!t||!f)return;const w=e.hdr;T.current=w;const M=Vn(w);(_=o.current)==null||_.setSource(M),C(y=>y&&y.w===M.width&&y.h===M.height?y:{w:M.width,h:M.height}),U(y=>y+1),m(y=>y+1)},[t,f,t?e.hdr:null]),a.useEffect(()=>{if(t||!f)return;const w=e,M=w.imageUrl,_=w.colormap??"none";if(!M){S.current=null,C(null),U(D=>D+1);return}let y=!1;return Re(M).then(D=>{var K,N;if(y||!D)return;let A=D;if(_!=="none"){const R=`gpu::${M}::${_}`,k=ze(R);if(k)A=k;else{const W=lt.has(_)?"positive":"linear";A=Xe(D,_,W),He(R,A)}}S.current=D;const z={data:A.data,width:A.width,height:A.height,format:"rgba8unorm"};(K=o.current)==null||K.setSource(z),C(R=>R&&R.w===A.width&&R.h===A.height?R:{w:A.width,h:A.height}),(N=w.onNaturalSize)==null||N.call(w,A.width,A.height),U(R=>R+1),m(R=>R+1)}),()=>{y=!0}},[t,f,t?null:e.imageUrl,t?null:e.colormap]);const ee=t?e.exposure??0:0,le=t?e.tonemap:void 0,oe=t?e.gamma:void 0;a.useEffect(()=>{const w=o.current;if(!w||!f||!g)return;const M=r.current,_=i.current,y=_?_.getBoundingClientRect():M?M.getBoundingClientRect():{width:g.w,height:g.h},D=It({zoom:L,pan:E},y,g.w,g.h);p(N=>N.x===D.x&&N.y===D.y&&N.w===D.w&&N.h===D.h?N:D),y.width>0&&y.height>0&&w.resize(Math.round(y.width*V),Math.round(y.height*V));const A=Ut(D,y,g.w,g.h)>=nt?"nearest":"linear",z=D,K=t?{exposureEV:ee,operator:d.current?"extended":Bn(le),gamma:oe,isScalar:!1,hdrOut:d.current,uv:z,filter:A}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:z,filter:A};try{w.render(K)||x(!0)}catch(N){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",N),x(!0)}},[f,g,h,L,E.x,E.y,ee,le,oe,l,t,V]);const pe=a.useCallback((w,M,_)=>{if(t){const k=T.current,W=g;if(!k||!W||w<0||M<0||w>=W.w||M>=W.h)return null;const re=k.shape.length===2?1:k.shape[2]??1,H=(M*W.w+w)*re,Z=k.data,ve=.5;return re===1?{lines:[J(Z[H]??0,"unit",_)],luminance:ve}:{lines:[J(Z[H]??0,"unit",_),J(Z[H+1]??0,"unit",_),J(Z[H+2]??0,"unit",_)],luminance:ve,colors:[ce[0],ce[1],ce[2]]}}const y=S.current;if(!y||w<0||M<0||w>=y.width||M>=y.height)return null;const D=(M*y.width+w)*4,A=y.data[D],z=y.data[D+1],K=y.data[D+2],N=(.299*A+.587*z+.114*K)/255;return F!=="none"||A===z&&z===K?{lines:[J(A,"uint8",_)],luminance:N}:{lines:[J(A,"uint8",_),J(z,"uint8",_),J(K,"uint8",_)],luminance:N,colors:[ce[0],ce[1],ce[2]]}},[t,g,F]),ue=e.showAxes??!1,te=t?e.label??"":e.label,de=e.interpolation??"auto",be=de==="auto"?void 0:de,ae=t?void 0:e.overlay,fe=t?void 0:e.overlaySettings,he=t?!1:e.isDraggable??!1,ie=t?void 0:e.onDragStart;return u?t?c.jsx(Gn,{hdr:e.hdr,tonemap:e.tonemap,exposure:e.exposure,gamma:e.gamma,showAxes:ue,label:te,interpolation:de,zoom:e.zoom,pan:e.pan,onViewportChange:I,pixelValueNotation:e.pixelValueNotation}):c.jsx(At,{imageUrl:e.imageUrl,baselineUrl:e.baselineUrl??null,isBaseline:e.isBaseline,diffMode:e.diffMode??"none",interpolation:de,colormap:F,showAxes:ue,processing:e.processing,zoom:e.zoom,pan:e.pan,onViewportChange:I,onNaturalSize:e.onNaturalSize,label:te,isDraggable:he,onDragStart:ie,className:e.className,overlay:ae,overlaySettings:fe,pixelValueNotation:e.pixelValueNotation}):c.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":f,children:[c.jsxs("div",{ref:r,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded",style:{padding:ue&&g?"16px 4px 4px 28px":0,...q.style},onPointerDown:q.onPointerDown,onPointerMove:q.onPointerMove,onPointerUp:q.onPointerUp,onPointerCancel:q.onPointerCancel,onDoubleClick:ne,"data-gpu-image-viewport":!0,children:[c.jsxs("div",{ref:i,className:"relative w-full h-full flex items-center justify-center cairn-checkerboard",children:[c.jsx("canvas",{ref:n,className:"w-full h-full block",style:{imageRendering:be},"data-gpu-image-canvas":!0}),ue&&g&&c.jsx(Ze,{naturalWidth:g.w,naturalHeight:g.h,zoom:L,containerRef:i}),ae&&(fe==null?void 0:fe.enabled)&&g&&((((Y=ae.boxes)==null?void 0:Y.length)??0)>0||(((X=ae.masks)==null?void 0:X.length)??0)>0)&&c.jsx(tt,{data:ae,settings:fe,naturalWidth:g.w,naturalHeight:g.h})]}),g&&c.jsx(xe,{imageElRef:n,naturalWidth:g.w,naturalHeight:g.h,zoom:L,pan:E,sourceWindow:v,sample:pe,notation:O,version:b,onActiveChange:j}),$&&c.jsx(Ie,{notation:O,onChange:G})]}),te?c.jsx(Qe,{label:te,isDraggable:he,onDragStart:ie}):null]})}const Xn={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function zn({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,zoom:d,pan:u,onViewportChange:x,processing:f=Xn,interpolation:P="auto",label:g="",isDraggable:C=!1,onDragStart:h,overlay:m,overlaySettings:l,pixelValueNotation:s="decimal"}){var he,ie;const v=a.useRef(null),[p,T]=a.useState(null),[S,b]=a.useState(null),[U,O]=a.useState(s),[G,$]=a.useState(!1),j=a.useRef(null),L=a.useRef(null),E=a.useRef(null),I=a.useRef(null),[F,V]=a.useState(0);a.useEffect(()=>{if(!e){E.current=null,V(X=>X+1);return}let Y=!1;return Re(e).then(X=>{Y||(E.current=X,V(w=>w+1))}),()=>{Y=!0}},[e]),a.useEffect(()=>{if(!t){I.current=null,V(X=>X+1);return}let Y=!1;return Re(t).then(X=>{Y||(I.current=X,V(w=>w+1))}),()=>{Y=!0}},[t]);const q=Y=>(X,w,M)=>{const _=Y.current;if(!_||X<0||w<0||X>=_.width||w>=_.height)return null;const y=(w*_.width+X)*4,D=_.data[y],A=_.data[y+1],z=_.data[y+2],K=(.299*D+.587*A+.114*z)/255;return D===A&&A===z?{lines:[J(D,"uint8",M)],luminance:K}:{lines:[J(D,"uint8",M),J(A,"uint8",M),J(z,"uint8",M)],luminance:K,colors:[ce[0],ce[1],ce[2]]}},ne=a.useMemo(()=>q(E),[]),ee=a.useMemo(()=>q(I),[]),le=!!m&&!!(l!=null&&l.enabled)&&!!p&&!!e&&((((he=m.boxes)==null?void 0:he.length)??0)>0||(((ie=m.masks)==null?void 0:ie.length)??0)>0),{gammaFilterId:oe,filterStr:pe,gamma:ue,offset:te}=Dt(f),de=`translate(${u.x}px, ${u.y}px) scale(${d})`,be=P==="auto"?void 0:P,{containerProps:ae,modifierActive:fe}=Ae({containerRef:v,zoom:d,pan:u,onViewportChange:x});return c.jsxs("div",{className:"relative flex flex-col h-full",children:[c.jsx(Ct,{id:oe,gamma:ue,offset:te}),c.jsxs("div",{ref:v,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...ae.style},onPointerDown:ae.onPointerDown,onPointerMove:ae.onPointerMove,onPointerUp:ae.onPointerUp,onPointerCancel:ae.onPointerCancel,children:[c.jsxs("div",{className:"relative w-full h-full",children:[c.jsxs("div",{className:"relative w-full h-full",style:{transform:de,transformOrigin:"0 0"},children:[c.jsx("img",{ref:j,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:pe,imageRendering:be,...n==="blend"?{opacity:i}:{}},onLoad:Y=>{const X=Y.currentTarget;T({w:X.naturalWidth,h:X.naturalHeight})}}),le&&c.jsx(tt,{data:m,settings:l,naturalWidth:p.w,naturalHeight:p.h})]}),c.jsx("div",{className:"absolute inset-0 overflow-hidden",style:n==="split"?{clipPath:`inset(0 ${(1-r)*100}% 0 0)`}:void 0,children:c.jsx("div",{className:"w-full h-full",style:{transform:de,transformOrigin:"0 0"},children:c.jsx("img",{ref:L,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:pe,imageRendering:be,...n==="blend"?{opacity:1-i}:{}},onLoad:Y=>{const X=Y.currentTarget;b({w:X.naturalWidth,h:X.naturalHeight})}})})}),n==="split"&&c.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>o==null?void 0:o(.5),onPointerDown:Y=>{Y.stopPropagation(),Y.preventDefault();const w=Y.currentTarget.parentElement.getBoundingClientRect(),M=y=>{o==null||o(Math.max(0,Math.min(1,(y.clientX-w.left)/w.width)))},_=()=>{window.removeEventListener("pointermove",M),window.removeEventListener("pointerup",_)};window.addEventListener("pointermove",M),window.addEventListener("pointerup",_)},children:c.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?c.jsxs(c.Fragment,{children:[t&&S&&c.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:c.jsx(xe,{imageElRef:L,naturalWidth:S.w,naturalHeight:S.h,zoom:d,pan:u,sample:ee,notation:U,version:F})}),e&&p&&c.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:c.jsx(xe,{imageElRef:j,naturalWidth:p.w,naturalHeight:p.h,zoom:d,pan:u,sample:ne,notation:U,version:F,onActiveChange:$})})]}):e&&p&&c.jsx(xe,{imageElRef:j,naturalWidth:p.w,naturalHeight:p.h,zoom:d,pan:u,sample:ne,notation:U,version:F,onActiveChange:$}),G&&c.jsx(Ie,{notation:U,onChange:O})]}),c.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),c.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${C&&!fe?" cairn-drag-grip":""}`,draggable:C&&!fe,onDragStart:h,style:{cursor:C&&!fe?"grab":void 0},children:[c.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),g]})]})}const Hn={zoom:1,pan:{x:0,y:0}};function Yn(e){const t=$e(e),n=new Float32Array(256*4);for(let r=0;r<256;r++)n[r*4+0]=t[r*3+0]/255,n[r*4+1]=t[r*3+1]/255,n[r*4+2]=t[r*3+2]/255,n[r*4+3]=1;return n}function qn({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,diffSubmode:d,colormap:u="none",zoom:x,pan:f,onViewportChange:P,interpolation:g="auto",label:C="",pixelValueNotation:h="decimal"}){const m=a.useRef(null),l=a.useRef(null),s=a.useRef(null),[v,p]=a.useState(!1),[T,S]=a.useState(!1),[b,U]=a.useState(null),[O,G]=a.useState(0),[$,j]=a.useState(0),[L,E]=a.useState(null),[I,F]=a.useState(h),[V,q]=a.useState(!1),[ne,ee]=a.useState({x:0,y:0,w:1,h:1}),le=a.useRef(null),oe=a.useRef(null),[pe,ue]=a.useState(0),te=et();a.useEffect(()=>{const w=l.current;if(!w)return;let M=!1;return Ge().then(_=>{if(!M)try{if(Pt())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const y=_.createSurface(w,{hdr:!1});s.current={device:_,surface:y,texA:null,texB:null},S(!0)}catch(y){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",y),p(!0)}}).catch(_=>{M||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",_),p(!0))}),()=>{var y,D;M=!0;const _=s.current;_&&((y=_.texA)==null||y.destroy(),(D=_.texB)==null||D.destroy(),s.current=null)}},[]),a.useEffect(()=>{const w=m.current;if(!w)return;const M=new ResizeObserver(()=>j(_=>_+1));return M.observe(w),()=>M.disconnect()},[]),a.useEffect(()=>{if(!T)return;let w=!1;if(!s.current)return;async function _(y){return y?Re(y):null}return Promise.all([_(e),_(t)]).then(([y,D])=>{var N,R;if(w||!s.current)return;const A=s.current;le.current=y,oe.current=D,(N=A.texA)==null||N.destroy(),(R=A.texB)==null||R.destroy(),A.texA=null,A.texB=null;const z=y??D;if(!z){U(null),ue(k=>k+1);return}const K=k=>{const W=A.device.createTexture(k.width,k.height,"rgba8unorm");return W.write(k.data),W};A.texA=K(D??z),A.texB=K(y??z),U({w:z.width,h:z.height}),ue(k=>k+1),G(k=>k+1)}),()=>{w=!0}},[T,e,t]);const de=a.useMemo(()=>(d??"").includes("signed")?"signed":"positive",[d]),be=a.useMemo(()=>u!=="none"?Yn(u):void 0,[u]);a.useEffect(()=>{const w=s.current;if(!T||!w||!w.surface||!w.texA||!w.texB||!b)return;const M=m.current,_=M?M.getBoundingClientRect():{width:b.w,height:b.h},y=It({zoom:x,pan:f},_,b.w,b.h);ee(N=>N.x===y.x&&N.y===y.y&&N.w===y.w&&N.h===y.h?N:y);const D=l.current;if(_.width>0&&_.height>0&&D&&w.surface){const N=Math.max(1,Math.round(_.width*te)),R=Math.max(1,Math.round(_.height*te));(D.width!==N||D.height!==R)&&(D.width=N,D.height=R,w.surface.configure(N,R))}const A=Ut(y,_,b.w,b.h)>=nt?"nearest":"linear",K={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:y,filter:A,mode:n,split:r,alpha:i,diffSubmode:d??"absolute",diffCmapMode:de,diffColormap:n==="diff"?be:void 0};try{Tn(w.device,w.surface,w.texA,w.texB,K)}catch(N){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",N),p(!0)}},[T,b,O,x,f.x,f.y,n,r,i,d,de,be,$,te]),a.useEffect(()=>{const w=s.current;if(!T||!w||!w.texA||!w.texB||!t){E(null);return}let M=!1;return Sn(w.device,w.texA,w.texB).then(_=>{M||E(_)}),()=>{M=!0}},[T,O,t]);const ae=w=>(M,_,y)=>{const D=w.current;if(!D||M<0||_<0||M>=D.width||_>=D.height)return null;const A=(_*D.width+M)*4,z=D.data[A],K=D.data[A+1],N=D.data[A+2],R=(.299*z+.587*K+.114*N)/255;return z===K&&K===N?{lines:[J(z,"uint8",y)],luminance:R}:{lines:[J(z,"uint8",y),J(K,"uint8",y),J(N,"uint8",y)],luminance:R,colors:[ce[0],ce[1],ce[2]]}},fe=a.useMemo(()=>ae(le),[]),he=a.useMemo(()=>ae(oe),[]),{containerProps:ie}=Ae({containerRef:m,zoom:x,pan:f,onViewportChange:P}),Y=a.useCallback(()=>P==null?void 0:P(Hn),[P]),X=g==="auto"?void 0:g;return v?n==="diff"?c.jsx(At,{imageUrl:e,baselineUrl:t,diffMode:d??"signed",interpolation:g,colormap:u,showAxes:!1,zoom:x,pan:f,onViewportChange:P,label:C,pixelValueNotation:h}):c.jsx(zn,{imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,zoom:x,pan:f,onViewportChange:P,interpolation:g,label:C,pixelValueNotation:h}):c.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":T,children:[c.jsxs("div",{ref:m,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...ie.style},onPointerDown:ie.onPointerDown,onPointerMove:ie.onPointerMove,onPointerUp:ie.onPointerUp,onPointerCancel:ie.onPointerCancel,onDoubleClick:Y,"data-gpu-compare-viewport":!0,children:[c.jsxs("div",{className:"relative w-full h-full flex items-center justify-center",children:[c.jsx("canvas",{ref:l,className:"w-full h-full block",style:{imageRendering:X},"data-gpu-compare-canvas":!0}),n==="split"&&c.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:w=>{w.stopPropagation(),o==null||o(.5)},onPointerDown:w=>{w.stopPropagation(),w.preventDefault();const _=w.currentTarget.parentElement.getBoundingClientRect(),y=A=>{o==null||o(Math.max(0,Math.min(1,(A.clientX-_.left)/_.width)))},D=()=>{window.removeEventListener("pointermove",y),window.removeEventListener("pointerup",D)};window.addEventListener("pointermove",y),window.addEventListener("pointerup",D)},children:c.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?c.jsxs(c.Fragment,{children:[t&&b&&c.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:c.jsx(xe,{imageElRef:l,naturalWidth:b.w,naturalHeight:b.h,zoom:x,pan:f,sourceWindow:ne,sample:he,notation:I,version:pe})}),t&&b&&c.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:c.jsx(xe,{imageElRef:l,naturalWidth:b.w,naturalHeight:b.h,zoom:x,pan:f,sourceWindow:ne,sample:fe,notation:I,version:pe,onActiveChange:q})})]}):b&&c.jsx(xe,{imageElRef:l,naturalWidth:b.w,naturalHeight:b.h,zoom:x,pan:f,sourceWindow:ne,sample:fe,notation:I,version:pe,onActiveChange:q}),V&&c.jsx(Ie,{notation:I,onChange:F})]}),c.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),C?c.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:C}):null,L&&c.jsxs("span",{className:`absolute right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${V?"top-8":"top-1"}`,"data-gpu-compare-metrics":!0,children:["MSE ",L.mse.toExponential(2)," · PSNR ",Number.isFinite(L.psnr)?L.psnr.toFixed(1):"∞"," dB · MAE"," ",L.mae.toExponential(2)]})]})}const jn="cairn-plot:gpu-image-ready";async function Kn(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Ge(),window.__cairnPlotGpuImagePane=$n,window.__cairnPlotGpuComparePane=qn,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(jn))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}Kn()})(__cairnPlotJsxRuntime,__cairnPlotReact);

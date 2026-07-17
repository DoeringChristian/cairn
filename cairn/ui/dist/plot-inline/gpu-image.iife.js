var Kn=Object.defineProperty;var Zn=(c,a,_e)=>a in c?Kn(c,a,{enumerable:!0,configurable:!0,writable:!0,value:_e}):c[a]=_e;var j=(c,a,_e)=>Zn(c,typeof a!="symbol"?a+"":a,_e);(function(c,a){"use strict";const _e=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function rt(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"premultiplied",usage:_e}),{hdr:!1,format:n}}function Ut(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:_e}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:_e}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return rt(e,t)}}}const Lt=`
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
`;function Ne(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function it(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Gt(e){const t=(e&32768)>>15,n=(e&31744)>>10,r=e&1023;let i;return n===0?i=r/1024*Math.pow(2,-14):n===31?i=r?NaN:1/0:i=(1+r/1024)*Math.pow(2,n-15),t?-i:i}const Ot={texture:0,sampler:1,uniform:2};function Ve(e,t){return e*3+Ot[t]}const kt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Ft(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let r;for(;(r=n.exec(e))!==null;){const i=Number(r[1]),o=r[2]!==void 0,h=r[3].trim();if(o){const u=kt[h];if(u===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${h}" (binding ${i}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(i,{kind:"uniform",sizeBytes:u})}else h==="sampler"||h==="sampler_comparison"?t.set(i,{kind:"sampler"}):t.set(i,{kind:"texture"})}return t}class ot{constructor(t,n,r,i){j(this,"width");j(this,"height");j(this,"format");j(this,"gpuTexture");j(this,"device");j(this,"destroyed",!1);this.device=t,this.width=n,this.height=r,this.format=i,this.gpuTexture=t.createTexture({size:{width:n,height:r,depthOrArrayLayers:1},format:Ne(i),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*it(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class at{constructor(t){j(this,"_s");j(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Bt{constructor(t,n,r,i,o){j(this,"_p");j(this,"gpuPipeline");j(this,"bindings");j(this,"bindGroupLayout");j(this,"variants");j(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=r,this.buildVariant=o,this.variants=new Map([[i,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function Nt(e,t){const n=[];for(const[r,i]of t)i.kind==="uniform"?n.push({binding:r,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):i.kind==="sampler"?n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class Vt{constructor(t){j(this,"_c");j(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class $t{constructor(t,n){j(this,"_b");j(this,"gpuBindGroup");j(this,"ownedBuffers");j(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class Xt{constructor(t,n,r,i){j(this,"canvas");j(this,"hdr");j(this,"format");j(this,"context");j(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=r.hdr,this.format=r.format,this.reconfigure=i}configure(t,n){this.canvas.width=t,this.canvas.height=n;const r=this.reconfigure();this.hdr=r.hdr,this.format=r.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function Ge(e){return"canvas"in e}async function Wt(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let r=null;function i(){return r||(r=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),r}function o(f){return Ge(f)?f.getCurrentTextureView():f.gpuTexture.createView()}function h(f){if(Ge(f))return{width:f.canvas.width,height:f.canvas.height};const v=f;return{width:v.width,height:v.height}}let u=!1;const w=256;let d=null,_=null;function g(){if(!d||!_){const f=t.createShaderModule({code:Lt});_=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const v=t.createPipelineLayout({bindGroupLayouts:[_]});d=t.createComputePipeline({layout:v,compute:{module:f,entryPoint:"cs_main"}})}return{pipeline:d,layout:_}}return{backend:"webgpu",capabilities:n,createTexture(f,v,s){return new ot(t,f,v,s)},createSampler(f){const v=(f==null?void 0:f.filter)==="linear"?"linear":"nearest",s=t.createSampler({magFilter:v,minFilter:v,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new at(s)},createRenderPipeline(f){const v=t.createShaderModule({code:f.shaderWGSL}),s=Ft(f.shaderWGSL),l=Ne(f.targetFormat),b=Nt(t,s),p=t.createPipelineLayout({bindGroupLayouts:[b]}),P=E=>t.createRenderPipeline({layout:p,vertex:{module:v,entryPoint:"vs_main"},fragment:{module:v,entryPoint:"fs_main",targets:[{format:E}]},primitive:{topology:"triangle-list"}}),y=P(l);return new Bt(y,s,b,l,P)},createComputePipeline(f){const v=t.createShaderModule({code:f.shaderWGSL}),s=t.createComputePipeline({layout:"auto",compute:{module:v,entryPoint:"cs_main"}});return new Vt(s)},createBindGroup(f,v){const s=f,l=new Map,b=[];for(const[P,y]of s.bindings)if(y.kind==="uniform"){const E=t.createBuffer({size:y.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});b.push(E),l.set(P,{binding:P,resource:{buffer:E}})}else y.kind==="sampler"&&l.set(P,{binding:P,resource:i()});for(const P of v){const y=P.resource;if(y instanceof ot){const E=Ve(P.binding,"texture");s.bindings.has(E)&&l.set(E,{binding:E,resource:y.gpuTexture.createView()})}else if(y instanceof at){const E=Ve(P.binding,"sampler");s.bindings.has(E)&&l.set(E,{binding:E,resource:y.gpuSampler})}else{const E=Ve(P.binding,"uniform"),G=s.bindings.get(E);if(G&&G.kind==="uniform"){const L=y.uniform,O=t.createBuffer({size:Math.max(G.sizeBytes,L.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(O,0,L.buffer,L.byteOffset,L.byteLength),b.push(O),l.set(E,{binding:E,resource:{buffer:O}})}}}const p=t.createBindGroup({layout:s.bindGroupLayout,entries:Array.from(l.values())});return new $t(p,b)},createSurface(f,v){const s=f.getContext("webgpu");if(!s)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const l=v.hdr&&n.hdr,b=()=>l?Ut(s,t):rt(s,t),p=b();return new Xt(f,s,p,b)},renderFullscreen(f,v,s){const l=v,b=s,p=o(f),{width:P,height:y}=h(f),E=Ge(f)?f.format:Ne(f.format),G=l.pipelineFor(E),L=t.createCommandEncoder(),O=L.beginRenderPass({colorAttachments:[{view:p,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});O.setPipeline(G),O.setBindGroup(0,b.gpuBindGroup),O.setViewport(0,0,P,y,0,1),O.draw(3),O.end(),t.queue.submit([L.finish()])},async readback(f){const v=Ge(f),{width:s,height:l}=h(f),b=v?f.hdr?"rgba16float":"rgba8unorm":f.format,p=v&&f.format==="bgra8unorm",P=v?f.getCurrentGPUTexture():f.gpuTexture,y=it(b),E=s*y,G=256,L=Math.ceil(E/G)*G,O=L*l,z=t.createBuffer({size:O,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),Y=t.createCommandEncoder();Y.copyTextureToBuffer({texture:P},{buffer:z,bytesPerRow:L,rowsPerImage:l},{width:s,height:l,depthOrArrayLayers:1}),t.queue.submit([Y.finish()]),await z.mapAsync(GPUMapMode.READ);const M=new Uint8Array(z.getMappedRange()),C=new Uint8Array(E*l);for(let I=0;I<l;I++){const k=I*L,B=I*E;C.set(M.subarray(k,k+E),B)}if(z.unmap(),z.destroy(),b==="rgba8unorm"){if(p)for(let I=0;I<C.length;I+=4){const k=C[I],B=C[I+2];C[I]=B,C[I+2]=k}return C}if(b==="rgba16float"){const I=new Uint16Array(C.buffer,C.byteOffset,C.byteLength/2),k=new Float32Array(I.length);for(let B=0;B<I.length;B++)k[B]=Gt(I[B]);return k}return new Float32Array(C.buffer,C.byteOffset,C.byteLength/4)},async reduceDiffSumSquaredAbs(f,v,s,l){const b=f,p=v,P=Math.max(0,s*l),y=Math.max(1,Math.ceil(P/w)),{pipeline:E,layout:G}=g(),L=y*2*4,O=t.createBuffer({size:L,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),z=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(z,0,new Uint32Array([Math.max(1,s),Math.max(1,l),P,0]));const Y=t.createBindGroup({layout:G,entries:[{binding:0,resource:b.gpuTexture.createView()},{binding:1,resource:p.gpuTexture.createView()},{binding:2,resource:{buffer:O}},{binding:3,resource:{buffer:z}}]}),M=t.createBuffer({size:L,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),C=t.createCommandEncoder(),I=C.beginComputePass();I.setPipeline(E),I.setBindGroup(0,Y),I.dispatchWorkgroups(y),I.end(),C.copyBufferToBuffer(O,0,M,0,L),t.queue.submit([C.finish()]),await M.mapAsync(GPUMapMode.READ);const B=new Float32Array(M.getMappedRange()).slice();M.unmap(),M.destroy(),O.destroy(),z.destroy();let te=0,ne=0;for(let ee=0;ee<y;ee++)te+=B[ee*2],ne+=B[ee*2+1];return{sumSq:te,sumAbs:ne}},destroy(){u||(t.destroy(),u=!0)},isContextLost(){return!1}}}let $e=null;async function zt(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return Wt()}function Oe(){return $e||($e=zt()),$e}function Yt(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function Ht(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const i=n/255*(e.length-1),o=Math.floor(i),h=Math.min(o+1,e.length-1),u=i-o,[w,d,_]=Yt(e[o],e[h],u);t[n*3]=Math.round(w),t[n*3+1]=Math.round(d),t[n*3+2]=Math.round(_)}return t}const st={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},ct=new Set(["red-green","red-blue"]),lt=new Map;function Xe(e){let t=lt.get(e);if(!t){const n=st[e]??st.viridis;t=Ht(n),lt.set(e,t)}return t}function We(e,t,n="linear"){const r=Xe(t),i=new ImageData(e.width,e.height),o=e.data,h=i.data;for(let u=0;u<o.length;u+=4){const w=(o[u]+o[u+1]+o[u+2])/3;let d;n==="positive"?d=Math.round(128+w/255*127):d=Math.round(w),d=Math.max(0,Math.min(255,d)),h[u]=r[d*3],h[u+1]=r[d*3+1],h[u+2]=r[d*3+2],h[u+3]=o[u+3]}return i}function ut(e){const t=new Map;return{get(n){return t.get(n)},set(n,r){if(t.size>=e){const i=t.keys().next().value;i!==void 0&&t.delete(i)}t.set(n,r)}}}const dt=ut(50);function ze(e){return dt.get(e)}function Ye(e,t){dt.set(e,t)}const ft=ut(100);function qt(e){return ft.get(e)}function jt(e,t){ft.set(e,t)}function Kt(e,t,n){const r=Math.min(e.width,t.width),i=Math.min(e.height,t.height),o=new ImageData(r,i);for(let h=0;h<i;h++)for(let u=0;u<r;u++){const w=(h*e.width+u)*4,d=(h*t.width+u)*4,_=(h*r+u)*4;for(let g=0;g<3;g++){const R=e.data[w+g],f=t.data[d+g],v=R-f,s=Math.abs(v),l=Math.max(R,1);let b;switch(n){case"signed":b=(v+255)/2;break;case"absolute":b=s;break;case"squared":b=v*v/255;break;case"relative_signed":b=(v/l+1)*127.5;break;case"relative_absolute":b=s/l*255;break;case"relative_squared":b=v*v/(l*l)*255;break}o.data[_+g]=Math.min(255,Math.max(0,Math.round(b)))}o.data[_+3]=255}return o}async function Me(e){const t=qt(e);return t||new Promise(n=>{const r=new Image;r.onload=()=>{try{const i=document.createElement("canvas");i.width=r.naturalWidth,i.height=r.naturalHeight;const o=i.getContext("2d");if(!o){n(null);return}o.drawImage(r,0,0);const h=o.getImageData(0,0,i.width,i.height);jt(e,h),n(h)}catch(i){console.warn("[cairn] loadImageData failed:",i),n(null)}},r.onerror=i=>{console.warn("[cairn] loadImageData: image failed to load:",e,i),n(null)},r.src=e})}const Zt={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Qt={linear:0,signed:1,positive:2},Jt=`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,en=`#version 300 es
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
}`;let Ce=null,F=null,pe=null,ke=null;function tn(){if(F)return F;try{if(typeof OffscreenCanvas<"u"?Ce=new OffscreenCanvas(1,1):Ce=document.createElement("canvas"),F=Ce.getContext("webgl2",{preserveDrawingBuffer:!0}),!F)return console.warn("[cairn] WebGL 2 not available"),null;const e=F.createShader(F.VERTEX_SHADER);if(F.shaderSource(e,Jt),F.compileShader(e),!F.getShaderParameter(e,F.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",F.getShaderInfoLog(e)),null;const t=F.createShader(F.FRAGMENT_SHADER);if(F.shaderSource(t,en),F.compileShader(t),!F.getShaderParameter(t,F.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",F.getShaderInfoLog(t)),null;if(pe=F.createProgram(),F.attachShader(pe,e),F.attachShader(pe,t),F.linkProgram(pe),!F.getProgramParameter(pe,F.LINK_STATUS))return console.error("[cairn] WebGL program link:",F.getProgramInfoLog(pe)),null;ke=F.createVertexArray(),F.bindVertexArray(ke);const n=F.createBuffer();F.bindBuffer(F.ARRAY_BUFFER,n),F.bufferData(F.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),F.STATIC_DRAW);const r=F.getAttribLocation(pe,"a_pos");return F.enableVertexAttribArray(r),F.vertexAttribPointer(r,2,F.FLOAT,!1,0,0),F.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),F}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function ht(e,t,n){const r=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),r}function nn(e,t,n){const r=new Uint8Array(1024);for(let o=0;o<256;o++)r[o*4]=t[o*3],r[o*4+1]=t[o*3+1],r[o*4+2]=t[o*3+2],r[o*4+3]=255;const i=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,i),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,r),i}function rn(e,t,n,r){const i=tn();if(!i||!pe||!ke||!Ce)return null;const o=Math.min(e.width,t.width),h=Math.min(e.height,t.height);Ce.width=o,Ce.height=h,i.viewport(0,0,o,h);const u=ht(i,e,0),w=ht(i,t,1);let d=null;n.colormap?d=nn(i,n.colormap,2):(d=i.createTexture(),i.activeTexture(i.TEXTURE2),i.bindTexture(i.TEXTURE_2D,d),i.texImage2D(i.TEXTURE_2D,0,i.RGBA8,1,1,0,i.RGBA,i.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),i.useProgram(pe),i.uniform1i(i.getUniformLocation(pe,"u_baseline"),0),i.uniform1i(i.getUniformLocation(pe,"u_other"),1),i.uniform1i(i.getUniformLocation(pe,"u_lut"),2),i.uniform1i(i.getUniformLocation(pe,"u_diff_mode"),Zt[n.diffMode]),i.uniform1i(i.getUniformLocation(pe,"u_cmap_mode"),Qt[n.cmapMode]??0),i.uniform1i(i.getUniformLocation(pe,"u_use_colormap"),n.colormap?1:0),i.bindVertexArray(ke),i.drawArrays(i.TRIANGLE_STRIP,0,4),i.bindVertexArray(null),r.width=o,r.height=h;const _=r.getContext("2d");return _&&(_.save(),_.scale(1,-1),_.drawImage(Ce,0,0,o,h,0,-h,o,h),_.restore()),i.deleteTexture(u),i.deleteTexture(w),i.deleteTexture(d),{width:o,height:h}}const on={cardSettings:(e,t,n)=>`cairn:card-settings:${e}:${t}:${n}`,runLayout:e=>`cairn:run-layout:${e}`,collapsedSections:e=>`cairn:collapsed-sections:${e}`,comparisons:e=>`cairn:comparisons:${e}`,comparisonTemplates:e=>`cairn:comparison-templates:${e}`,reportTemplates:e=>`cairn:report-templates:${e}`,streamMode:"cairn:stream-mode",renderMode:"cairn:render-mode",scroll:e=>`cairn:scroll:${e}`,lastComparison:e=>`cairn:last-comparison:${e}`};function an(){try{const e=localStorage.getItem(on.renderMode);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const be=e=>e<0?0:e>1?1:e,He=e=>{const t=e<0?0:e;return t/(1+t)},qe=e=>{const t=e<0?0:e,n=t*(2.51*t+.03),r=t*(2.43*t+.59)+.14;return be(n/r)},mt={linear:([e,t,n])=>[be(e),be(t),be(n)],srgb:([e,t,n])=>[be(e),be(t),be(n)],reinhard:([e,t,n])=>[He(e),He(t),He(n)],aces:([e,t,n])=>[qe(e),qe(t),qe(n)],extended:([e,t,n])=>[e,t,n]},sn="srgb";function cn(e){return e&&mt[e]||mt[sn]}function je(e,t){return e*2**t}function ln(e){const t=be(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function Ke(e,t){return typeof t=="number"&&t>0?be(Math.pow(be(e),1/t)):ln(e)}function gt(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Ze({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:r}){const i=gt(e),o=gt(t),h=[];for(let p=0;p<=e;p+=i)h.push(p);const u=[];for(let p=0;p<=t;p+=o)u.push(p);const w=1/n,d=8*w,_=-12*w,g=-2*w,R=r==null?void 0:r.current;let f=0,v=0,s=0,l=0;if(R){const p=R.clientWidth,P=R.clientHeight,y=p/e,E=P/t,G=Math.min(y,E);s=e*G,l=t*G,f=(p-s)/2,v=(P-l)/2}const b=R&&s>0;return c.jsxs(c.Fragment,{children:[c.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:b?v:0,transform:`translateY(${_}px)`,fontSize:d},children:h.map(p=>c.jsx("span",{className:"mono",style:{position:"absolute",left:b?f+p/e*s:`${p/e*100}%`,transform:"translateX(-50%)"},children:p},p))}),c.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:b?f:0,transform:`translateX(${g}px)`,fontSize:d},children:u.map(p=>c.jsx("span",{className:"mono",style:{position:"absolute",top:b?v+p/t*l:`${p/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*w}px`},children:p},p))})]})}function Qe({label:e,isDraggable:t,onDragStart:n}){return c.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&c.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const pt=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function Je(e){const t=pt.length;return pt[(e%t+t)%t]}function un(e){const n=a.useRef(null),[r,i]=a.useState({w:0,h:0}),o=a.useRef(null),h=a.useRef(null);return a.useEffect(()=>{var d;const u=n.current;if(u===h.current||((d=o.current)==null||d.disconnect(),o.current=null,h.current=u,!u))return;const w=new ResizeObserver(_=>{for(const g of _)i({w:g.contentRect.width,h:g.contentRect.height})});o.current=w,w.observe(u)}),a.useEffect(()=>()=>{var u;return(u=o.current)==null?void 0:u.disconnect()},[]),{ref:n,size:r}}function dn(){const[e,t]=a.useState(!1);return a.useEffect(()=>{const n=o=>{(o.key==="Alt"||o.key==="Control"||o.key==="Meta")&&t(!0)},r=o=>{(o.key==="Alt"||o.key==="Control"||o.key==="Meta")&&t(!1)},i=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",r),window.addEventListener("blur",i),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",r),window.removeEventListener("blur",i)}},[]),e}const fn=.25,hn=16;function Ae(e){const{containerRef:t,zoom:n,pan:r,onViewportChange:i,minZoom:o=fn,maxZoom:h=hn}=e,u=dn(),w=a.useRef(u);w.current=u;const d=a.useRef({zoom:n,pan:r});d.current={zoom:n,pan:r};const _=a.useRef(i);_.current=i,a.useEffect(()=>{const l=t.current;if(!l||!i)return;const b=p=>{var M;if(!w.current)return;p.preventDefault(),p.stopPropagation();const P=p.deltaY<0?1.1:1/1.1,y=d.current,E=Math.max(o,Math.min(h,y.zoom*P));if(y.zoom===E)return;const G=l.getBoundingClientRect(),L=p.clientX-G.left,O=p.clientY-G.top,z=L-(L-y.pan.x)/y.zoom*E,Y=O-(O-y.pan.y)/y.zoom*E;(M=_.current)==null||M.call(_,{zoom:E,pan:{x:z,y:Y}})};return l.addEventListener("wheel",b,{passive:!1}),()=>l.removeEventListener("wheel",b)},[t,!!i,o,h]);const g=a.useRef(null),R=a.useCallback(l=>{!w.current||!_.current||(l.currentTarget.setPointerCapture(l.pointerId),g.current={pointerId:l.pointerId,startX:l.clientX,startY:l.clientY,panX:d.current.pan.x,panY:d.current.pan.y})},[]),f=a.useCallback(l=>{var y;const b=g.current;if(!b||b.pointerId!==l.pointerId)return;const p=l.clientX-b.startX,P=l.clientY-b.startY;(y=_.current)==null||y.call(_,{zoom:d.current.zoom,pan:{x:b.panX+p,y:b.panY+P}})},[]),v=a.useCallback(l=>{const b=g.current;if(!(!b||b.pointerId!==l.pointerId)){try{l.currentTarget.releasePointerCapture(l.pointerId)}catch{}g.current=null}},[]),s=u&&!!i;return{containerProps:{onPointerDown:R,onPointerMove:f,onPointerUp:v,onPointerCancel:v,style:{cursor:s?"move":void 0,touchAction:s?"none":void 0}},modifierActive:u}}function mn(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function vt(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function et({data:e,settings:t,naturalWidth:n,naturalHeight:r}){const{ref:i,size:o}=un(),h=a.useRef(null),u=a.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),w=a.useMemo(()=>{const s=o.w,l=o.h;if(s<=0||l<=0||n<=0||r<=0)return null;const b=Math.min(s/n,l/r),p=n*b,P=r*b;return{left:(s-p)/2,top:(l-P)/2,width:p,height:P}},[o.w,o.h,n,r]),d=e.masks,_=t.showMasks&&!!d&&d.length>0,g=a.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(a.useEffect(()=>{if(!_||!d)return;const s=h.current;if(!s)return;(s.width!==n||s.height!==r)&&(s.width=n,s.height=r);const l=s.getContext("2d");if(!l)return;l.clearRect(0,0,s.width,s.height);let b=!1;const p=l.createImageData(n,r),P=p.data;let y=d.length,E=!1;const G=()=>{b||E&&l.putImageData(p,0,0)},L=document.createElement("canvas");L.width=n,L.height=r;const O=L.getContext("2d",{willReadFrequently:!0});for(const z of d){const Y=new Image;Y.onload=()=>{if(!b){if(O){O.clearRect(0,0,n,r),O.drawImage(Y,0,0,n,r);const M=O.getImageData(0,0,n,r).data;for(let C=0;C<n*r;C++){const I=M[C*4];if(I===0||u.has(I))continue;const[k,B,te]=mn(Je(I));P[C*4]=k,P[C*4+1]=B,P[C*4+2]=te,P[C*4+3]=255,E=!0}}y-=1,y===0&&G()}},Y.onerror=()=>{y-=1,y===0&&G()},Y.src=`data:image/png;base64,${z.png_b64}`}return()=>{b=!0}},[_,d,n,r,g]),!w)return c.jsx("div",{ref:i,className:"absolute inset-0 pointer-events-none"});const R=e.boxes??[],f=t.showBoxes&&R.length>0,v=e.class_labels??{};return c.jsxs("div",{ref:i,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[_&&c.jsx("canvas",{ref:h,className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),f&&c.jsx("svg",{className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height,overflow:"visible"},viewBox:`0 0 ${n} ${r}`,preserveAspectRatio:"none",children:R.map((s,l)=>{if(!vt(s,t,u))return null;const b=s.domain==="pixel"?1:n,p=s.domain==="pixel"?1:r,P=s.position.minX*b,y=s.position.minY*p,E=(s.position.maxX-s.position.minX)*b,G=(s.position.maxY-s.position.minY)*p;return c.jsx("rect",{x:P,y,width:E,height:G,fill:"none",stroke:Je(s.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},l)})}),f&&c.jsx("div",{className:"absolute",style:{left:w.left,top:w.top,width:w.width,height:w.height},children:R.map((s,l)=>{if(!vt(s,t,u))return null;const b=s.domain==="pixel"?1/n:1,p=s.domain==="pixel"?1/r:1,P=s.position.minX*b*100,y=s.position.minY*p*100,E=s.label??v[String(s.class_id)]??`#${s.class_id}`,G=s.score!=null?` ${(s.score*100).toFixed(0)}%`:"";return!E&&!G?null:c.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${P}%`,top:`${y}%`,transform:"translateY(-100%)",backgroundColor:Je(s.class_id)},children:c.jsxs("span",{className:"mono",children:[E,G]})},l)})})]})}const tt=30,se=["#ff5a5a","#39d353","#5b9bff"];function nt(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function J(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):nt(e/255):nt(n==="int"?e*255:e)}const gn={x:0,y:0,w:1,h:1};function we({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:r,pan:i,sample:o,notation:h="decimal",version:u=0,onActiveChange:w,sourceWindow:d=gn}){const _=a.useRef(null),g=a.useRef(!1),R=a.useRef(w);R.current=w;const f=a.useCallback(s=>{var l;s!==g.current&&(g.current=s,(l=R.current)==null||l.call(R,s))},[]),v=a.useCallback(()=>{var oe;const s=_.current,l=e.current;if(!s)return;const b=window.devicePixelRatio||1,p=s.clientWidth,P=s.clientHeight;if(p===0||P===0)return;s.width!==Math.round(p*b)&&(s.width=Math.round(p*b)),s.height!==Math.round(P*b)&&(s.height=Math.round(P*b));const y=s.getContext("2d");if(!y)return;if(y.setTransform(b,0,0,b,0,0),y.clearRect(0,0,p,P),!l||t<=0||n<=0){f(!1);return}const E=l.getBoundingClientRect(),G=s.getBoundingClientRect();if(E.width===0||E.height===0){f(!1);return}const L=d.x*t,O=d.y*n,z=d.w*t,Y=d.h*n;if(z<=0||Y<=0){f(!1);return}const M=Math.min(E.width/z,E.height/Y);if(M<tt){f(!1);return}const C=z*M,I=Y*M,k=E.left+(E.width-C)/2-G.left,B=E.top+(E.height-I)/2-G.top,te=Math.max(Math.floor(L),Math.floor(L+(0-k)/M)),ne=Math.min(Math.ceil(L+z),Math.ceil(L+(p-k)/M)),ee=Math.max(Math.floor(O),Math.floor(O+(0-B)/M)),ue=Math.min(Math.ceil(O+Y),Math.ceil(O+(P-B)/M));if(ne<=te||ue<=ee){f(!1);return}f(!0);const ce=k+(0-L)*M,de=B+(0-O)*M,he=k+(t-L)*M,re=B+(n-O)*M;y.save(),y.beginPath(),y.rect(ce,de,he-ce,re-de),y.clip(),y.textAlign="center",y.textBaseline="middle",y.lineJoin="round";const ve=M*.14,me=M-ve*2;for(let fe=ee;fe<ue;fe++)for(let ie=te;ie<ne;ie++){if(ie<0||fe<0||ie>=t||fe>=n)continue;const le=o(ie,fe,h);if(!le||le.lines.length===0)continue;const K=le.lines.length;let m=1;for(const A of le.lines)A.length>m&&(m=A.length);const T=me/(K*1.15),S=me/(m*.62)||T,x=Math.min(T,S,24);if(x<6)continue;const D=k+(ie-L+.5)*M,U=B+(fe-O+.5)*M,N=x*1.15,H=le.luminance<=.55,V=H?"#ffffff":"#000000";y.font=`${x}px ui-monospace, SFMono-Regular, Menlo, monospace`,y.lineWidth=Math.max(1.4,x*.16),y.strokeStyle=H?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let Z=U-K*N/2+N/2;for(let A=0;A<le.lines.length;A++){const $=le.lines[A];y.strokeText($,D,Z),y.fillStyle=((oe=le.colors)==null?void 0:oe[A])??V,y.fillText($,D,Z),Z+=N}}y.restore()},[e,t,n,o,h,f,d]);return a.useEffect(()=>{v()},[v,r,i.x,i.y,u,h,d]),a.useEffect(()=>{const s=_.current;if(!s)return;const l=new ResizeObserver(()=>v());return l.observe(s),()=>l.disconnect()},[v]),c.jsx("canvas",{ref:_,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Ie({notation:e,onChange:t,className:n=""}){return c.jsx("button",{type:"button",onClick:r=>{r.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:r=>r.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const pn=`
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
`,vn=`
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
`,Fe={linear:0,srgb:1,reinhard:2,aces:3,extended:4},bt=new WeakMap;function bn(e,t){let n=bt.get(e);n||(n=new Map,bt.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:pn,targetFormat:t}),n.set(t,r)),r}function xt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function wt(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const r=e.createTexture(256,1,"rgba32float");return r.write(t),r}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function xn(e,t,n,r){var v;const i=xt(t),o=bn(e,i),h=wt(e,r.isScalar?r.colormap:void 0),u=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,w=Fe[r.operator]??Fe.srgb,d=new Float32Array([r.exposureEV,w,u,r.isScalar?1:0]),_=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),g=new Float32Array([r.hdrOut?1:0]),R=new Float32Array([r.filter==="nearest"?0:1]);let f;try{f=e.createBindGroup(o,[{binding:0,resource:n},{binding:1,resource:h},{binding:2,resource:{uniform:d}},{binding:3,resource:{uniform:_}},{binding:4,resource:{uniform:g}},{binding:5,resource:{uniform:R}}]),e.renderFullscreen(t,o,f)}finally{(v=f==null?void 0:f.destroy)==null||v.call(f),h.destroy()}}const wn={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},yn={linear:0,signed:1,positive:2},En={split:0,blend:1,diff:2},yt=new WeakMap;function _n(e,t){let n=yt.get(e);n||(n=new Map,yt.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:vn,targetFormat:t}),n.set(t,r)),r}function Pn(e,t,n,r,i){var p;const o=xt(t),h=_n(e,o),u=i.mode==="diff"&&!!i.diffColormap,w=i.isScalar?i.colormap:u?i.diffColormap:void 0,d=wt(e,w),_=typeof i.gamma=="number"&&i.gamma>0?i.gamma:0,g=Fe[i.operator]??Fe.srgb,R=new Float32Array([i.exposureEV,g,_,i.isScalar?1:0]),f=new Float32Array([i.uv.x,i.uv.y,i.uv.w,i.uv.h]),v=new Float32Array([En[i.mode],i.split,i.alpha,wn[i.diffSubmode]??0]),s=new Float32Array([yn[i.diffCmapMode??"linear"]??0,i.hdrOut?1:0,u?1:0,0]),l=new Float32Array([i.filter==="nearest"?0:1]);let b;try{b=e.createBindGroup(h,[{binding:0,resource:n},{binding:1,resource:r},{binding:2,resource:d},{binding:3,resource:{uniform:R}},{binding:4,resource:{uniform:f}},{binding:5,resource:{uniform:v}},{binding:6,resource:{uniform:s}},{binding:7,resource:{uniform:l}}]),e.renderFullscreen(t,h,b)}finally{(p=b==null?void 0:b.destroy)==null||p.call(b),d.destroy()}}function Et(e,t,n){if(n<=0)return{mse:0,psnr:1/0,mae:0};const r=e/n,i=t/n,o=r<=0?1/0:10*Math.log10(1/r);return{mse:r,psnr:o,mae:i}}async function Tn(e,t,n){const r=Math.min(t.width,n.width),i=Math.min(t.height,n.height),o=r*i*3;if(o<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:R,sumAbs:f}=await e.reduceDiffSumSquaredAbs(t,n,r,i);return Et(R,f,o)}const h=await e.readback(t),u=await e.readback(n),w=h instanceof Uint8Array,d=u instanceof Uint8Array;let _=0,g=0;for(let R=0;R<i;R++)for(let f=0;f<r;f++){const v=(R*t.width+f)*4,s=(R*n.width+f)*4;for(let l=0;l<3;l++){const b=(h[v+l]??0)/(w?255:1),p=(u[s+l]??0)/(d?255:1),P=b-p;_+=P*P,g+=Math.abs(P)}}return Et(_,g,o)}function _t(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const Sn=12,Pe=[];function Pt(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1),Pe.push(e)}function Rn(e){const t=Pe.indexOf(e);t!==-1&&Pe.splice(t,1)}function Be(e){e.parked||(Rn(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.parked=!0)}function Tt(e){for(;Pe.length>Sn;){const t=Pe.find(n=>n!==e&&!n.visible)??Pe.find(n=>n!==e);if(!t)break;Be(t)}}function St(e){if(e.disposed)return;if(_t())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Pt(e),Tt(e);return}const t=e.device;if(e.surface=t.createSurface(e.canvas,{hdr:e.hdr}),e.source){e.canvas.width=e.source.width,e.canvas.height=e.source.height,e.surface.configure(e.source.width,e.source.height);const n=t.createTexture(e.source.width,e.source.height,e.source.format);n.write(e.source.data),e.srcTexture=n}e.parked=!1,Pt(e),Tt(e)}function Mn(e,t){if(e.disposed||!e.source)return!0;try{return St(e),!e.surface||!e.srcTexture?!1:(xn(e.device,e.surface,e.srcTexture,t),!0)}catch(n){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Be(e),!1}}function Cn(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.surface)){e.canvas.width=t.width,e.canvas.height=t.height,e.surface.configure(t.width,t.height),e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},render(t){return Mn(e,t)},park(){e.disposed||Be(e)},restore(){e.disposed||!e.source||St(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Be(e),e.source=null,e.disposed=!0)}}}async function Dn(e,t){const n=await Oe(),r={canvas:e,device:n,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0};return Cn(r)}function Rt(e){e.dispose()}function An(e,t){const{brightness:n,contrast:r,exposure:i,flipSign:o}=e;return[`url(#${t})`,`brightness(${(1+n)*Math.pow(2,i)})`,`contrast(${1+r})`,...o?["invert(1)"]:[]].join(" ")}function Mt(e){const n=`cairn-gamma-${a.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:r,contrast:i,gamma:o,exposure:h,offset:u,flipSign:w}=e,d=a.useMemo(()=>An(e,n),[n,r,i,h,w]);return{gammaFilterId:n,filterStr:d,gamma:o,offset:u}}function Ct({id:e,gamma:t,offset:n}){return c.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:c.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:c.jsxs("feComponentTransfer",{children:[c.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),c.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),c.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:n})]})})})}const In={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function Dt({imageUrl:e,baselineUrl:t,isBaseline:n=!1,diffMode:r,interpolation:i,colormap:o,showAxes:h,processing:u=In,zoom:w=1,pan:d={x:0,y:0},onViewportChange:_,onNaturalSize:g,label:R,isDraggable:f=!1,onDragStart:v,overlay:s,overlaySettings:l,pixelValueNotation:b="decimal"}){var V,Z;const p=a.useRef(null),P=a.useRef(null),y=a.useRef(null),E=a.useRef(null),G=a.useRef(null),L=a.useRef(null),O=a.useRef(null),[z,Y]=a.useState(0),M=a.useCallback(()=>Y(A=>A+1),[]),[C,I]=a.useState(b),[k,B]=a.useState(!1),te=a.useCallback(A=>{p.current=A,A&&(G.current=A)},[]),ne=a.useCallback(A=>{P.current=A,A&&(G.current=A)},[]),ee=a.useCallback(A=>{A&&(G.current=A)},[]),[ue,ce]=a.useState(!1),[de,he]=a.useState(!1),[re,ve]=a.useState(null),{flipSign:me}=u,{gammaFilterId:oe,filterStr:fe,gamma:ie,offset:le}=Mt(u),K=`translate(${d.x}px, ${d.y}px) scale(${w})`,{containerProps:m}=Ae({containerRef:E,zoom:w,pan:d,onViewportChange:_}),T=!n&&r!=="none"&&t!=null&&e!=null,S=r!=="none"&&t!=null,x=o!=="none"&&!T&&!(n&&S)&&e!=null;a.useEffect(()=>{if(!x||!e){he(!1);return}let A=!1;he(!1);const $=`${e}::${o}`,X=ze($);if(X){const W=P.current;if(W){W.width=X.width,W.height=X.height;const Q=W.getContext("2d");Q&&Q.putImageData(X,0,0),O.current=X,M(),ve({w:X.width,h:X.height}),g==null||g(X.width,X.height),he(!0)}return}const q=new Image;return q.onload=()=>{if(A)return;const W=document.createElement("canvas");W.width=q.naturalWidth,W.height=q.naturalHeight;const Q=W.getContext("2d");if(!Q)return;Q.drawImage(q,0,0);const xe=Q.getImageData(0,0,W.width,W.height),Re=ct.has(o)?"positive":"linear",ae=We(xe,o,Re);Ye($,ae);const ye=P.current;if(!ye||A)return;ye.width=ae.width,ye.height=ae.height;const ge=ye.getContext("2d");ge&&ge.putImageData(ae,0,0),O.current=ae,M(),ve({w:ae.width,h:ae.height}),g==null||g(ae.width,ae.height),he(!0)},q.src=e,()=>{A=!0}},[x,e,o]);const D=a.useCallback((A,$)=>{ve(X=>X&&X.w===A&&X.h===$?X:{w:A,h:$}),g==null||g(A,$)},[]);a.useEffect(()=>{if(!e){L.current=null,O.current=null,M();return}let A=!1;return Me(e).then($=>{A||(L.current=$,o==="none"&&(O.current=$),M())}),()=>{A=!0}},[e,o,M]);const U=a.useCallback((A,$,X)=>{const q=L.current;if(!q||A<0||$<0||A>=q.width||$>=q.height)return null;const W=($*q.width+A)*4,Q=q.data[W],xe=q.data[W+1],Re=q.data[W+2],ae=O.current;let ye=Q,ge=xe,Ee=Re;if(ae&&ae.width===q.width&&ae.height===q.height){const De=($*ae.width+A)*4;ye=ae.data[De],ge=ae.data[De+1],Ee=ae.data[De+2]}const Ue=(.299*ye+.587*ge+.114*Ee)/255;return o!=="none"||Q===xe&&xe===Re?{lines:[J(Q,"uint8",X)],luminance:Ue}:{lines:[J(Q,"uint8",X),J(xe,"uint8",X),J(Re,"uint8",X)],luminance:Ue,colors:[se[0],se[1],se[2]]}},[o]);a.useEffect(()=>{if(!T){ce(!1);return}let A=!1;const $=an(),X=$==="gpu"||$==="auto",q=`${t}::${e}::${r}::${o}`;if($!=="gpu"){const W=ze(q);if(W){const Q=p.current;if(Q){(Q.width!==W.width||Q.height!==W.height)&&(Q.width=W.width,Q.height=W.height);const xe=Q.getContext("2d");xe&&xe.putImageData(W,0,0),D(W.width,W.height),ce(!0)}return}}return(async()=>{const[W,Q]=await Promise.all([Me(t),Me(e)]);if(A||!W||!Q)return;const Re=r.includes("signed")?"signed":"positive",ae=o!=="none"?Xe(o):null,ye={diffMode:r,colormap:ae,cmapMode:Re};if(X)try{const Le=p.current;if(Le){const De=rn(W,Q,ye,Le);if(De){if(A)return;D(De.width,De.height),ce(!0);return}}}catch(Le){console.warn("[cairn] WebGL 2 diff error:",Le)}if($==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let ge=Kt(W,Q,r);o!=="none"&&(ge=We(ge,o,Re)),Ye(q,ge);const Ee=p.current;if(!Ee||A)return;(Ee.width!==ge.width||Ee.height!==ge.height)&&(Ee.width=ge.width,Ee.height=ge.height);const Ue=Ee.getContext("2d");Ue&&Ue.putImageData(ge,0,0),D(ge.width,ge.height),ce(!0)})(),()=>{A=!0}},[t,e,r,T,o,g]);const N=i==="auto"?void 0:i,H=me?{filter:"invert(1)"}:{};return c.jsxs("div",{className:"relative flex flex-col h-full",children:[c.jsx(Ct,{id:oe,gamma:ie,offset:le}),c.jsxs("div",{ref:E,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:h&&re?"16px 4px 4px 28px":"4px",...m.style},onPointerDown:m.onPointerDown,onPointerMove:m.onPointerMove,onPointerUp:m.onPointerUp,onPointerCancel:m.onPointerCancel,children:[c.jsxs("div",{ref:y,className:"relative w-full h-full",style:{transform:K,transformOrigin:"0 0"},children:[e?T?c.jsxs(c.Fragment,{children:[!ue&&c.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),c.jsx("canvas",{ref:te,className:"w-full h-full object-contain block",style:{display:ue?"block":"none",imageRendering:N,...H}})]}):x?c.jsxs(c.Fragment,{children:[!de&&c.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),c.jsx("canvas",{ref:ne,className:"w-full h-full object-contain block",style:{display:de?"block":"none",imageRendering:N,...H}})]}):c.jsx("img",{ref:ee,src:e,alt:R,className:"w-full h-full object-contain block",draggable:!1,style:{filter:fe,imageRendering:N},onLoad:A=>{const $=A.currentTarget;ve({w:$.naturalWidth,h:$.naturalHeight}),g==null||g($.naturalWidth,$.naturalHeight)}}):c.jsx("span",{className:"text-xs text-fg-muted",children:"no image"}),h&&re&&c.jsx(Ze,{naturalWidth:re.w,naturalHeight:re.h,zoom:w,containerRef:y}),s&&(l==null?void 0:l.enabled)&&re&&e&&((((V=s.boxes)==null?void 0:V.length)??0)>0||(((Z=s.masks)==null?void 0:Z.length)??0)>0)&&c.jsx(et,{data:s,settings:l,naturalWidth:re.w,naturalHeight:re.h})]}),e&&re&&c.jsx(we,{imageElRef:G,naturalWidth:re.w,naturalHeight:re.h,zoom:w,pan:d,sample:U,notation:C,version:z,onActiveChange:B}),k&&c.jsx(Ie,{notation:C,onChange:I})]}),c.jsx(Qe,{label:R,isDraggable:f,onDragStart:v})]})}function Un(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`HdrImagePane: unsupported shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}const Te=e=>Number.isFinite(e)?e:0;function Ln(e,t,n,r){const{h:i,w:o,c:h}=Un(e.shape),u=e.data,w=cn(t),d=new Uint8ClampedArray(o*i*4);for(let _=0;_<o*i;_++){const g=_*h;let R,f,v,s=1;h===1?R=f=v=Te(u[g]):h===3?(R=Te(u[g]),f=Te(u[g+1]),v=Te(u[g+2])):(R=Te(u[g]),f=Te(u[g+1]),v=Te(u[g+2]),s=Te(u[g+3]));const l=[je(R,n),je(f,n),je(v,n)],[b,p,P]=w(l),y=_*4;d[y]=255*Ke(b,r),d[y+1]=255*Ke(p,r),d[y+2]=255*Ke(P,r),d[y+3]=255*(s<0?0:s>1?1:s)}return new ImageData(d,o,i)}function Gn({hdr:e,tonemap:t="srgb",exposure:n=0,gamma:r,showAxes:i=!1,label:o="",interpolation:h="auto",zoom:u=1,pan:w={x:0,y:0},onViewportChange:d,pixelValueNotation:_="decimal"}){const g=a.useRef(null),R=a.useRef(null),f=a.useRef(null),[v,s]=a.useState(null),l=a.useRef(null),[b,p]=a.useState(0),[P,y]=a.useState(_),[E,G]=a.useState(!1);a.useEffect(()=>{const M=g.current;if(!M)return;let C;try{C=Ln(e,t,n,r)}catch(k){console.error("[cairn] HDR tone-map error:",k);return}(M.width!==C.width||M.height!==C.height)&&(M.width=C.width,M.height=C.height);const I=M.getContext("2d");I&&(I.putImageData(C,0,0),l.current=C,p(k=>k+1),s(k=>k&&k.w===C.width&&k.h===C.height?k:{w:C.width,h:C.height}))},[e,t,n,r]);const{containerProps:L}=Ae({containerRef:f,zoom:u,pan:w,onViewportChange:d}),O=a.useCallback((M,C,I)=>{const k=v;if(!k||M<0||C<0||M>=k.w||C>=k.h)return null;const B=e.shape.length===2?1:e.shape[2]??1,te=(C*k.w+M)*B,ne=e.data,ee=l.current;let ue=.5;if(ee&&ee.width===k.w&&ee.height===k.h){const ce=(C*k.w+M)*4;ue=(.299*ee.data[ce]+.587*ee.data[ce+1]+.114*ee.data[ce+2])/255}return B===1?{lines:[J(ne[te]??0,"unit",I)],luminance:ue}:{lines:[J(ne[te]??0,"unit",I),J(ne[te+1]??0,"unit",I),J(ne[te+2]??0,"unit",I)],luminance:ue,colors:[se[0],se[1],se[2]]}},[e,v]),z=h==="auto"?void 0:h,Y=`translate(${w.x}px, ${w.y}px) scale(${u})`;return c.jsxs("div",{className:"relative flex flex-col h-full",children:[c.jsxs("div",{ref:f,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:i&&v?"16px 4px 4px 28px":"4px",...L.style},onPointerDown:L.onPointerDown,onPointerMove:L.onPointerMove,onPointerUp:L.onPointerUp,onPointerCancel:L.onPointerCancel,children:[c.jsxs("div",{ref:R,className:"relative w-full h-full",style:{transform:Y,transformOrigin:"0 0"},children:[c.jsx("canvas",{ref:g,className:"w-full h-full object-contain block",style:{imageRendering:z}}),i&&v&&c.jsx(Ze,{naturalWidth:v.w,naturalHeight:v.h,zoom:u,containerRef:R})]}),v&&c.jsx(we,{imageElRef:g,naturalWidth:v.w,naturalHeight:v.h,zoom:u,pan:w,sample:O,notation:P,version:b,onActiveChange:G}),E&&c.jsx(Ie,{notation:P,onChange:y})]}),o?c.jsx(Qe,{label:o}):null]})}function On(e){return"hdr"in e&&e.hdr!=null}const kn=["linear","srgb","reinhard","aces"];function Fn(e){return e&&kn.includes(e)?e:"srgb"}const Se=e=>Number.isFinite(e)?e:0;function Bn(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function Nn(e){const{h:t,w:n,c:r}=Bn(e.shape),i=e.data,o=new Float32Array(n*t*4);for(let h=0;h<n*t;h++){const u=h*r;let w,d,_,g=1;r===1?w=d=_=Se(i[u]):r===3?(w=Se(i[u]),d=Se(i[u+1]),_=Se(i[u+2])):(w=Se(i[u]),d=Se(i[u+1]),_=Se(i[u+2]),g=Se(i[u+3]));const R=h*4;o[R]=w,o[R+1]=d,o[R+2]=_,o[R+3]=g}return{data:o,width:n,height:t,format:"rgba32float"}}function At(e,t,n,r){if(n<=0||r<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const i=Math.min(t.width/n,t.height/r),o=n*i,h=r*i,u=(t.width-o)/2,w=(t.height-h)/2,d=Math.max(e.zoom,1e-6),_=1/d,g=1/d,R=(u*(1-d)-e.pan.x)/(o*d),f=(w*(1-d)-e.pan.y)/(h*d);return{x:R,y:f,w:_,h:g}}function It(e,t,n,r){const i=e.w*n,o=e.h*r;return i<=0||o<=0||t.width<=0||t.height<=0?0:Math.min(t.width/i,t.height/o)}const Vn={zoom:1,pan:{x:0,y:0}};function $n(e){var le,K;const t=On(e),n=a.useRef(null),r=a.useRef(null),i=a.useRef(null),o=a.useRef(null),h=a.useRef(!1),[u,w]=a.useState(!1),[d,_]=a.useState(!1),[g,R]=a.useState(null),[f,v]=a.useState(0),[s,l]=a.useState(0),[b,p]=a.useState({x:0,y:0,w:1,h:1}),P=a.useRef(null),y=a.useRef(null),[E,G]=a.useState(0),[L,O]=a.useState(e.pixelValueNotation??"decimal"),[z,Y]=a.useState(!1),M=e.zoom??1,C=e.pan??{x:0,y:0},I=e.onViewportChange,k=t?"none":e.colormap??"none";a.useEffect(()=>{const m=n.current;if(!m)return;let T=!1;return Oe().then(S=>{if(T)return;const x=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,D=S.capabilities.hdr&&x&&t;h.current=D,Dn(m,{hdr:D}).then(U=>{if(T){Rt(U);return}o.current=U,_(!0)}).catch(U=>{T||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",U),w(!0))})}).catch(S=>{T||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",S),w(!0))}),()=>{T=!0,o.current&&(Rt(o.current),o.current=null)}},[]);const{containerProps:B}=Ae({containerRef:r,zoom:M,pan:C,onViewportChange:I}),te=a.useCallback(()=>{I==null||I(Vn)},[I]);a.useEffect(()=>{const m=r.current;if(!m)return;const T=new ResizeObserver(()=>l(S=>S+1));return T.observe(m),()=>T.disconnect()},[]),a.useEffect(()=>{const m=r.current;if(!m)return;const T=new IntersectionObserver(S=>{const x=S[0];if(!x)return;const D=o.current;D&&(D.setVisible(x.isIntersecting),x.isIntersecting?D.isParked&&(D.restore(),l(U=>U+1)):D.park())},{threshold:0});return T.observe(m),()=>T.disconnect()},[]),a.useEffect(()=>{var S;if(!t||!d)return;const m=e.hdr;P.current=m;const T=Nn(m);(S=o.current)==null||S.setSource(T),R(x=>x&&x.w===T.width&&x.h===T.height?x:{w:T.width,h:T.height}),G(x=>x+1),v(x=>x+1)},[t,d,t?e.hdr:null]),a.useEffect(()=>{if(t||!d)return;const m=e,T=m.imageUrl,S=m.colormap??"none";if(!T){y.current=null,R(null),G(D=>D+1);return}let x=!1;return Me(T).then(D=>{var H,V;if(x||!D)return;let U=D;if(S!=="none"){const Z=`gpu::${T}::${S}`,A=ze(Z);if(A)U=A;else{const $=ct.has(S)?"positive":"linear";U=We(D,S,$),Ye(Z,U)}}y.current=D;const N={data:U.data,width:U.width,height:U.height,format:"rgba8unorm"};(H=o.current)==null||H.setSource(N),R(Z=>Z&&Z.w===U.width&&Z.h===U.height?Z:{w:U.width,h:U.height}),(V=m.onNaturalSize)==null||V.call(m,U.width,U.height),G(Z=>Z+1),v(Z=>Z+1)}),()=>{x=!0}},[t,d,t?null:e.imageUrl,t?null:e.colormap]);const ne=t?e.exposure??0:0,ee=t?e.tonemap:void 0,ue=t?e.gamma:void 0;a.useEffect(()=>{const m=o.current;if(!m||!d||!g)return;const T=r.current,S=T?T.getBoundingClientRect():{width:g.w,height:g.h},x=At({zoom:M,pan:C},S,g.w,g.h);p(V=>V.x===x.x&&V.y===x.y&&V.w===x.w&&V.h===x.h?V:x);const D=n.current?n.current.getBoundingClientRect():S,U=It(x,D,g.w,g.h)>=tt?"nearest":"linear",N=x,H=t?{exposureEV:ne,operator:h.current?"extended":Fn(ee),gamma:ue,isScalar:!1,hdrOut:h.current,uv:N,filter:U}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:N,filter:U};try{m.render(H)||w(!0)}catch(V){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",V),w(!0)}},[d,g,f,M,C.x,C.y,ne,ee,ue,s,t]);const ce=a.useCallback((m,T,S)=>{if(t){const A=P.current,$=g;if(!A||!$||m<0||T<0||m>=$.w||T>=$.h)return null;const X=A.shape.length===2?1:A.shape[2]??1,q=(T*$.w+m)*X,W=A.data,Q=.5;return X===1?{lines:[J(W[q]??0,"unit",S)],luminance:Q}:{lines:[J(W[q]??0,"unit",S),J(W[q+1]??0,"unit",S),J(W[q+2]??0,"unit",S)],luminance:Q,colors:[se[0],se[1],se[2]]}}const x=y.current;if(!x||m<0||T<0||m>=x.width||T>=x.height)return null;const D=(T*x.width+m)*4,U=x.data[D],N=x.data[D+1],H=x.data[D+2],V=(.299*U+.587*N+.114*H)/255;return k!=="none"||U===N&&N===H?{lines:[J(U,"uint8",S)],luminance:V}:{lines:[J(U,"uint8",S),J(N,"uint8",S),J(H,"uint8",S)],luminance:V,colors:[se[0],se[1],se[2]]}},[t,g,k]),de=e.showAxes??!1,he=t?e.label??"":e.label,re=e.interpolation??"auto",ve=re==="auto"?void 0:re,me=t?void 0:e.overlay,oe=t?void 0:e.overlaySettings,fe=t?!1:e.isDraggable??!1,ie=t?void 0:e.onDragStart;return u?t?c.jsx(Gn,{hdr:e.hdr,tonemap:e.tonemap,exposure:e.exposure,gamma:e.gamma,showAxes:de,label:he,interpolation:re,zoom:e.zoom,pan:e.pan,onViewportChange:I,pixelValueNotation:e.pixelValueNotation}):c.jsx(Dt,{imageUrl:e.imageUrl,baselineUrl:e.baselineUrl??null,isBaseline:e.isBaseline,diffMode:e.diffMode??"none",interpolation:re,colormap:k,showAxes:de,processing:e.processing,zoom:e.zoom,pan:e.pan,onViewportChange:I,onNaturalSize:e.onNaturalSize,label:he,isDraggable:fe,onDragStart:ie,className:e.className,overlay:me,overlaySettings:oe,pixelValueNotation:e.pixelValueNotation}):c.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":d,children:[c.jsxs("div",{ref:r,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:de&&g?"16px 4px 4px 28px":"4px",...B.style},onPointerDown:B.onPointerDown,onPointerMove:B.onPointerMove,onPointerUp:B.onPointerUp,onPointerCancel:B.onPointerCancel,onDoubleClick:te,"data-gpu-image-viewport":!0,children:[c.jsxs("div",{ref:i,className:"relative w-full h-full",children:[c.jsx("canvas",{ref:n,className:"w-full h-full object-contain block",style:{imageRendering:ve},"data-gpu-image-canvas":!0}),de&&g&&c.jsx(Ze,{naturalWidth:g.w,naturalHeight:g.h,zoom:M,containerRef:i}),me&&(oe==null?void 0:oe.enabled)&&g&&((((le=me.boxes)==null?void 0:le.length)??0)>0||(((K=me.masks)==null?void 0:K.length)??0)>0)&&c.jsx(et,{data:me,settings:oe,naturalWidth:g.w,naturalHeight:g.h})]}),g&&c.jsx(we,{imageElRef:n,naturalWidth:g.w,naturalHeight:g.h,zoom:M,pan:C,sourceWindow:b,sample:ce,notation:L,version:E,onActiveChange:Y}),z&&c.jsx(Ie,{notation:L,onChange:O})]}),he?c.jsx(Qe,{label:he,isDraggable:fe,onDragStart:ie}):null]})}const Xn={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function Wn({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,zoom:h,pan:u,onViewportChange:w,processing:d=Xn,interpolation:_="auto",label:g="",isDraggable:R=!1,onDragStart:f,overlay:v,overlaySettings:s,pixelValueNotation:l="decimal"}){var ie,le;const b=a.useRef(null),[p,P]=a.useState(null),[y,E]=a.useState(null),[G,L]=a.useState(l),[O,z]=a.useState(!1),Y=a.useRef(null),M=a.useRef(null),C=a.useRef(null),I=a.useRef(null),[k,B]=a.useState(0);a.useEffect(()=>{if(!e){C.current=null,B(m=>m+1);return}let K=!1;return Me(e).then(m=>{K||(C.current=m,B(T=>T+1))}),()=>{K=!0}},[e]),a.useEffect(()=>{if(!t){I.current=null,B(m=>m+1);return}let K=!1;return Me(t).then(m=>{K||(I.current=m,B(T=>T+1))}),()=>{K=!0}},[t]);const te=K=>(m,T,S)=>{const x=K.current;if(!x||m<0||T<0||m>=x.width||T>=x.height)return null;const D=(T*x.width+m)*4,U=x.data[D],N=x.data[D+1],H=x.data[D+2],V=(.299*U+.587*N+.114*H)/255;return U===N&&N===H?{lines:[J(U,"uint8",S)],luminance:V}:{lines:[J(U,"uint8",S),J(N,"uint8",S),J(H,"uint8",S)],luminance:V,colors:[se[0],se[1],se[2]]}},ne=a.useMemo(()=>te(C),[]),ee=a.useMemo(()=>te(I),[]),ue=!!v&&!!(s!=null&&s.enabled)&&!!p&&!!e&&((((ie=v.boxes)==null?void 0:ie.length)??0)>0||(((le=v.masks)==null?void 0:le.length)??0)>0),{gammaFilterId:ce,filterStr:de,gamma:he,offset:re}=Mt(d),ve=`translate(${u.x}px, ${u.y}px) scale(${h})`,me=_==="auto"?void 0:_,{containerProps:oe,modifierActive:fe}=Ae({containerRef:b,zoom:h,pan:u,onViewportChange:w});return c.jsxs("div",{className:"relative flex flex-col h-full",children:[c.jsx(Ct,{id:ce,gamma:he,offset:re}),c.jsxs("div",{ref:b,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...oe.style},onPointerDown:oe.onPointerDown,onPointerMove:oe.onPointerMove,onPointerUp:oe.onPointerUp,onPointerCancel:oe.onPointerCancel,children:[c.jsxs("div",{className:"relative w-full h-full",children:[c.jsxs("div",{className:"relative w-full h-full",style:{transform:ve,transformOrigin:"0 0"},children:[c.jsx("img",{ref:Y,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:de,imageRendering:me,...n==="blend"?{opacity:i}:{}},onLoad:K=>{const m=K.currentTarget;P({w:m.naturalWidth,h:m.naturalHeight})}}),ue&&c.jsx(et,{data:v,settings:s,naturalWidth:p.w,naturalHeight:p.h})]}),c.jsx("div",{className:"absolute inset-0 overflow-hidden",style:n==="split"?{clipPath:`inset(0 ${(1-r)*100}% 0 0)`}:void 0,children:c.jsx("div",{className:"w-full h-full",style:{transform:ve,transformOrigin:"0 0"},children:c.jsx("img",{ref:M,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:de,imageRendering:me,...n==="blend"?{opacity:1-i}:{}},onLoad:K=>{const m=K.currentTarget;E({w:m.naturalWidth,h:m.naturalHeight})}})})}),n==="split"&&c.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>o==null?void 0:o(.5),onPointerDown:K=>{K.stopPropagation(),K.preventDefault();const T=K.currentTarget.parentElement.getBoundingClientRect(),S=D=>{o==null||o(Math.max(0,Math.min(1,(D.clientX-T.left)/T.width)))},x=()=>{window.removeEventListener("pointermove",S),window.removeEventListener("pointerup",x)};window.addEventListener("pointermove",S),window.addEventListener("pointerup",x)},children:c.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?c.jsxs(c.Fragment,{children:[t&&y&&c.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:c.jsx(we,{imageElRef:M,naturalWidth:y.w,naturalHeight:y.h,zoom:h,pan:u,sample:ee,notation:G,version:k})}),e&&p&&c.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:c.jsx(we,{imageElRef:Y,naturalWidth:p.w,naturalHeight:p.h,zoom:h,pan:u,sample:ne,notation:G,version:k,onActiveChange:z})})]}):e&&p&&c.jsx(we,{imageElRef:Y,naturalWidth:p.w,naturalHeight:p.h,zoom:h,pan:u,sample:ne,notation:G,version:k,onActiveChange:z}),O&&c.jsx(Ie,{notation:G,onChange:L})]}),c.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),c.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${R&&!fe?" cairn-drag-grip":""}`,draggable:R&&!fe,onDragStart:f,style:{cursor:R&&!fe?"grab":void 0},children:[c.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),g]})]})}const zn={zoom:1,pan:{x:0,y:0}};function Yn(e){const t=Xe(e),n=new Float32Array(256*4);for(let r=0;r<256;r++)n[r*4+0]=t[r*3+0]/255,n[r*4+1]=t[r*3+1]/255,n[r*4+2]=t[r*3+2]/255,n[r*4+3]=1;return n}function Hn({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,diffSubmode:h,colormap:u="none",zoom:w,pan:d,onViewportChange:_,interpolation:g="auto",label:R="",pixelValueNotation:f="decimal"}){const v=a.useRef(null),s=a.useRef(null),l=a.useRef(null),[b,p]=a.useState(!1),[P,y]=a.useState(!1),[E,G]=a.useState(null),[L,O]=a.useState(0),[z,Y]=a.useState(0),[M,C]=a.useState(null),[I,k]=a.useState(f),[B,te]=a.useState(!1),[ne,ee]=a.useState({x:0,y:0,w:1,h:1}),ue=a.useRef(null),ce=a.useRef(null),[de,he]=a.useState(0);a.useEffect(()=>{const m=s.current;if(!m)return;let T=!1;return Oe().then(S=>{if(!T)try{if(_t())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const x=S.createSurface(m,{hdr:!1});l.current={device:S,surface:x,texA:null,texB:null},y(!0)}catch(x){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",x),p(!0)}}).catch(S=>{T||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",S),p(!0))}),()=>{var x,D;T=!0;const S=l.current;S&&((x=S.texA)==null||x.destroy(),(D=S.texB)==null||D.destroy(),l.current=null)}},[]),a.useEffect(()=>{const m=v.current;if(!m)return;const T=new ResizeObserver(()=>Y(S=>S+1));return T.observe(m),()=>T.disconnect()},[]),a.useEffect(()=>{if(!P)return;let m=!1;if(!l.current)return;async function S(x){return x?Me(x):null}return Promise.all([S(e),S(t)]).then(([x,D])=>{var Z,A,$;if(m||!l.current)return;const U=l.current;ue.current=x,ce.current=D,(Z=U.texA)==null||Z.destroy(),(A=U.texB)==null||A.destroy(),U.texA=null,U.texB=null;const N=x??D;if(!N){G(null),he(X=>X+1);return}const H=X=>{const q=U.device.createTexture(X.width,X.height,"rgba8unorm");return q.write(X.data),q};U.texA=H(D??N),U.texB=H(x??N);const V=s.current;V.width=N.width,V.height=N.height,($=U.surface)==null||$.configure(N.width,N.height),G({w:N.width,h:N.height}),he(X=>X+1),O(X=>X+1)}),()=>{m=!0}},[P,e,t]);const re=a.useMemo(()=>(h??"").includes("signed")?"signed":"positive",[h]),ve=a.useMemo(()=>u!=="none"?Yn(u):void 0,[u]);a.useEffect(()=>{const m=l.current;if(!P||!m||!m.surface||!m.texA||!m.texB||!E)return;const T=v.current,S=T?T.getBoundingClientRect():{width:E.w,height:E.h},x=At({zoom:w,pan:d},S,E.w,E.h);ee(V=>V.x===x.x&&V.y===x.y&&V.w===x.w&&V.h===x.h?V:x);const D=s.current?s.current.getBoundingClientRect():S,U=It(x,D,E.w,E.h)>=tt?"nearest":"linear",H={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:x,filter:U,mode:n,split:r,alpha:i,diffSubmode:h??"absolute",diffCmapMode:re,diffColormap:n==="diff"?ve:void 0};try{Pn(m.device,m.surface,m.texA,m.texB,H)}catch(V){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",V),p(!0)}},[P,E,L,w,d.x,d.y,n,r,i,h,re,ve,z]),a.useEffect(()=>{const m=l.current;if(!P||!m||!m.texA||!m.texB||!t){C(null);return}let T=!1;return Tn(m.device,m.texA,m.texB).then(S=>{T||C(S)}),()=>{T=!0}},[P,L,t]);const me=m=>(T,S,x)=>{const D=m.current;if(!D||T<0||S<0||T>=D.width||S>=D.height)return null;const U=(S*D.width+T)*4,N=D.data[U],H=D.data[U+1],V=D.data[U+2],Z=(.299*N+.587*H+.114*V)/255;return N===H&&H===V?{lines:[J(N,"uint8",x)],luminance:Z}:{lines:[J(N,"uint8",x),J(H,"uint8",x),J(V,"uint8",x)],luminance:Z,colors:[se[0],se[1],se[2]]}},oe=a.useMemo(()=>me(ue),[]),fe=a.useMemo(()=>me(ce),[]),{containerProps:ie}=Ae({containerRef:v,zoom:w,pan:d,onViewportChange:_}),le=a.useCallback(()=>_==null?void 0:_(zn),[_]),K=g==="auto"?void 0:g;return b?n==="diff"?c.jsx(Dt,{imageUrl:e,baselineUrl:t,diffMode:h??"signed",interpolation:g,colormap:u,showAxes:!1,zoom:w,pan:d,onViewportChange:_,label:R,pixelValueNotation:f}):c.jsx(Wn,{imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:i,onSplitPositionChange:o,zoom:w,pan:d,onViewportChange:_,interpolation:g,label:R,pixelValueNotation:f}):c.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":P,children:[c.jsxs("div",{ref:v,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...ie.style},onPointerDown:ie.onPointerDown,onPointerMove:ie.onPointerMove,onPointerUp:ie.onPointerUp,onPointerCancel:ie.onPointerCancel,onDoubleClick:le,"data-gpu-compare-viewport":!0,children:[c.jsxs("div",{className:"relative w-full h-full",children:[c.jsx("canvas",{ref:s,className:"w-full h-full object-contain block",style:{imageRendering:K},"data-gpu-compare-canvas":!0}),n==="split"&&c.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:m=>{m.stopPropagation(),o==null||o(.5)},onPointerDown:m=>{m.stopPropagation(),m.preventDefault();const S=m.currentTarget.parentElement.getBoundingClientRect(),x=U=>{o==null||o(Math.max(0,Math.min(1,(U.clientX-S.left)/S.width)))},D=()=>{window.removeEventListener("pointermove",x),window.removeEventListener("pointerup",D)};window.addEventListener("pointermove",x),window.addEventListener("pointerup",D)},children:c.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?c.jsxs(c.Fragment,{children:[t&&E&&c.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:c.jsx(we,{imageElRef:s,naturalWidth:E.w,naturalHeight:E.h,zoom:w,pan:d,sourceWindow:ne,sample:fe,notation:I,version:de})}),t&&E&&c.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:c.jsx(we,{imageElRef:s,naturalWidth:E.w,naturalHeight:E.h,zoom:w,pan:d,sourceWindow:ne,sample:oe,notation:I,version:de,onActiveChange:te})})]}):E&&c.jsx(we,{imageElRef:s,naturalWidth:E.w,naturalHeight:E.h,zoom:w,pan:d,sourceWindow:ne,sample:oe,notation:I,version:de,onActiveChange:te}),B&&c.jsx(Ie,{notation:I,onChange:k})]}),c.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),R?c.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:R}):null,M&&c.jsxs("span",{className:`absolute right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono ${B?"top-8":"top-1"}`,"data-gpu-compare-metrics":!0,children:["MSE ",M.mse.toExponential(2)," · PSNR ",Number.isFinite(M.psnr)?M.psnr.toFixed(1):"∞"," dB · MAE"," ",M.mae.toExponential(2)]})]})}const qn="cairn-plot:gpu-image-ready";async function jn(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Oe(),window.__cairnPlotGpuImagePane=$n,window.__cairnPlotGpuComparePane=Hn,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(qn))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}jn()})(__cairnPlotJsxRuntime,__cairnPlotReact);

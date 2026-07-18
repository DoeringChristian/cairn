var wr=Object.defineProperty;var xr=(i,s,xe)=>s in i?wr(i,s,{enumerable:!0,configurable:!0,writable:!0,value:xe}):i[s]=xe;var q=(i,s,xe)=>xr(i,typeof s!="symbol"?s+"":s,xe);(function(i,s){"use strict";const xe=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function at(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"premultiplied",usage:xe}),{hdr:!1,format:n}}function Ht(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:xe}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:xe}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return at(e,t)}}}const Yt=`
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
`;function Ge(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function it(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function qt(e){const t=(e&32768)>>15,n=(e&31744)>>10,o=e&1023;let r;return n===0?r=o/1024*Math.pow(2,-14):n===31?r=o?NaN:1/0:r=(1+o/1024)*Math.pow(2,n-15),t?-r:r}const Zt={texture:0,sampler:1,uniform:2};function Fe(e,t){return e*3+Zt[t]}const jt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function Kt(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let o;for(;(o=n.exec(e))!==null;){const r=Number(o[1]),a=o[2]!==void 0,c=o[3].trim();if(a){const d=jt[c];if(d===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${c}" (binding ${r}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(r,{kind:"uniform",sizeBytes:d})}else c==="sampler"||c==="sampler_comparison"?t.set(r,{kind:"sampler"}):t.set(r,{kind:"texture"})}return t}class st{constructor(t,n,o,r){q(this,"width");q(this,"height");q(this,"format");q(this,"gpuTexture");q(this,"device");q(this,"destroyed",!1);this.device=t,this.width=n,this.height=o,this.format=r,this.gpuTexture=t.createTexture({size:{width:n,height:o,depthOrArrayLayers:1},format:Ge(r),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*it(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class ct{constructor(t){q(this,"_s");q(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Qt{constructor(t,n,o,r,a){q(this,"_p");q(this,"gpuPipeline");q(this,"bindings");q(this,"bindGroupLayout");q(this,"variants");q(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=o,this.buildVariant=a,this.variants=new Map([[r,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function Jt(e,t){const n=[];for(const[o,r]of t)r.kind==="uniform"?n.push({binding:o,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):r.kind==="sampler"?n.push({binding:o,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:o,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class en{constructor(t){q(this,"_c");q(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class tn{constructor(t,n){q(this,"_b");q(this,"gpuBindGroup");q(this,"ownedBuffers");q(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class nn{constructor(t,n,o,r){q(this,"canvas");q(this,"hdr");q(this,"format");q(this,"context");q(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=o.hdr,this.format=o.format,this.reconfigure=r}configure(t,n){this.canvas.width=t,this.canvas.height=n;const o=this.reconfigure();this.hdr=o.hdr,this.format=o.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function ke(e){return"canvas"in e}async function rn(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let o=null;function r(){return o||(o=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),o}function a(l){return ke(l)?l.getCurrentTextureView():l.gpuTexture.createView()}function c(l){if(ke(l))return{width:l.canvas.width,height:l.canvas.height};const x=l;return{width:x.width,height:x.height}}let d=!1;const g=256;let f=null,P=null;function v(){if(!f||!P){const l=t.createShaderModule({code:Yt});P=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const x=t.createPipelineLayout({bindGroupLayouts:[P]});f=t.createComputePipeline({layout:x,compute:{module:l,entryPoint:"cs_main"}})}return{pipeline:f,layout:P}}return{backend:"webgpu",capabilities:n,createTexture(l,x,h){return new st(t,l,x,h)},createSampler(l){const x=(l==null?void 0:l.filter)==="linear"?"linear":"nearest",h=t.createSampler({magFilter:x,minFilter:x,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new ct(h)},createRenderPipeline(l){const x=t.createShaderModule({code:l.shaderWGSL}),h=Kt(l.shaderWGSL),b=Ge(l.targetFormat),E=Jt(t,h),p=t.createPipelineLayout({bindGroupLayouts:[E]}),M=u=>t.createRenderPipeline({layout:p,vertex:{module:x,entryPoint:"vs_main"},fragment:{module:x,entryPoint:"fs_main",targets:[{format:u}]},primitive:{topology:"triangle-list"}}),S=M(b);return new Qt(S,h,E,b,M)},createComputePipeline(l){const x=t.createShaderModule({code:l.shaderWGSL}),h=t.createComputePipeline({layout:"auto",compute:{module:x,entryPoint:"cs_main"}});return new en(h)},createBindGroup(l,x){const h=l,b=new Map,E=[];for(const[M,S]of h.bindings)if(S.kind==="uniform"){const u=t.createBuffer({size:S.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});E.push(u),b.set(M,{binding:M,resource:{buffer:u}})}else S.kind==="sampler"&&b.set(M,{binding:M,resource:r()});for(const M of x){const S=M.resource;if(S instanceof st){const u=Fe(M.binding,"texture");h.bindings.has(u)&&b.set(u,{binding:u,resource:S.gpuTexture.createView()})}else if(S instanceof ct){const u=Fe(M.binding,"sampler");h.bindings.has(u)&&b.set(u,{binding:u,resource:S.gpuSampler})}else{const u=Fe(M.binding,"uniform"),_=h.bindings.get(u);if(_&&_.kind==="uniform"){const D=S.uniform,I=t.createBuffer({size:Math.max(_.sizeBytes,D.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(I,0,D.buffer,D.byteOffset,D.byteLength),E.push(I),b.set(u,{binding:u,resource:{buffer:I}})}}}const p=t.createBindGroup({layout:h.bindGroupLayout,entries:Array.from(b.values())});return new tn(p,E)},createSurface(l,x){const h=l.getContext("webgpu");if(!h)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const b=x.hdr&&n.hdr,E=()=>b?Ht(h,t):at(h,t),p=E();return new nn(l,h,p,E)},renderFullscreen(l,x,h){const b=x,E=h,p=a(l),{width:M,height:S}=c(l),u=ke(l)?l.format:Ge(l.format),_=b.pipelineFor(u),D=t.createCommandEncoder(),I=D.beginRenderPass({colorAttachments:[{view:p,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});I.setPipeline(_),I.setBindGroup(0,E.gpuBindGroup),I.setViewport(0,0,M,S,0,1),I.draw(3),I.end(),t.queue.submit([D.finish()])},async readback(l){const x=ke(l),{width:h,height:b}=c(l),E=x?l.hdr?"rgba16float":"rgba8unorm":l.format,p=x&&l.format==="bgra8unorm",M=x?l.getCurrentGPUTexture():l.gpuTexture,S=it(E),u=h*S,_=256,D=Math.ceil(u/_)*_,I=D*b,B=t.createBuffer({size:I,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),N=t.createCommandEncoder();N.copyTextureToBuffer({texture:M},{buffer:B,bytesPerRow:D,rowsPerImage:b},{width:h,height:b,depthOrArrayLayers:1}),t.queue.submit([N.finish()]),await B.mapAsync(GPUMapMode.READ);const O=new Uint8Array(B.getMappedRange()),A=new Uint8Array(u*b);for(let R=0;R<b;R++){const W=R*D,X=R*u;A.set(O.subarray(W,W+u),X)}if(B.unmap(),B.destroy(),E==="rgba8unorm"){if(p)for(let R=0;R<A.length;R+=4){const W=A[R],X=A[R+2];A[R]=X,A[R+2]=W}return A}if(E==="rgba16float"){const R=new Uint16Array(A.buffer,A.byteOffset,A.byteLength/2),W=new Float32Array(R.length);for(let X=0;X<R.length;X++)W[X]=qt(R[X]);return W}return new Float32Array(A.buffer,A.byteOffset,A.byteLength/4)},async reduceDiffSumSquaredAbs(l,x,h,b){const E=l,p=x,M=Math.max(0,h*b),S=Math.max(1,Math.ceil(M/g)),{pipeline:u,layout:_}=v(),D=S*2*4,I=t.createBuffer({size:D,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),B=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(B,0,new Uint32Array([Math.max(1,h),Math.max(1,b),M,0]));const N=t.createBindGroup({layout:_,entries:[{binding:0,resource:E.gpuTexture.createView()},{binding:1,resource:p.gpuTexture.createView()},{binding:2,resource:{buffer:I}},{binding:3,resource:{buffer:B}}]}),O=t.createBuffer({size:D,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),A=t.createCommandEncoder(),R=A.beginComputePass();R.setPipeline(u),R.setBindGroup(0,N),R.dispatchWorkgroups(S),R.end(),A.copyBufferToBuffer(I,0,O,0,D),t.queue.submit([A.finish()]),await O.mapAsync(GPUMapMode.READ);const X=new Float32Array(O.getMappedRange()).slice();O.unmap(),O.destroy(),I.destroy(),B.destroy();let Z=0,J=0;for(let ie=0;ie<S;ie++)Z+=X[ie*2],J+=X[ie*2+1];return{sumSq:Z,sumAbs:J}},destroy(){d||(t.destroy(),d=!0)},isContextLost(){return!1}}}let Be=null;async function on(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return rn()}function Ie(){return Be||(Be=on()),Be}function an(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function sn(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const r=n/255*(e.length-1),a=Math.floor(r),c=Math.min(a+1,e.length-1),d=r-a,[g,f,P]=an(e[a],e[c],d);t[n*3]=Math.round(g),t[n*3+1]=Math.round(f),t[n*3+2]=Math.round(P)}return t}const lt={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},ut=new Set(["red-green","red-blue"]),dt=new Map;function Ne(e){let t=dt.get(e);if(!t){const n=lt[e]??lt.viridis;t=sn(n),dt.set(e,t)}return t}function Ve(e,t,n="linear"){const o=Ne(t),r=new ImageData(e.width,e.height),a=e.data,c=r.data;for(let d=0;d<a.length;d+=4){const g=(a[d]+a[d+1]+a[d+2])/3;let f;n==="positive"?f=Math.round(128+g/255*127):f=Math.round(g),f=Math.max(0,Math.min(255,f)),c[d]=o[f*3],c[d+1]=o[f*3+1],c[d+2]=o[f*3+2],c[d+3]=a[d+3]}return r}function ft(e){const t=new Map;return{get(n){return t.get(n)},set(n,o){if(t.size>=e){const r=t.keys().next().value;r!==void 0&&t.delete(r)}t.set(n,o)}}}const ht=ft(50);function ze(e){return ht.get(e)}function $e(e,t){ht.set(e,t)}const gt=ft(100);function cn(e){return gt.get(e)}function ln(e,t){gt.set(e,t)}function un(e,t,n){const o=Math.min(e.width,t.width),r=Math.min(e.height,t.height),a=new ImageData(o,r);for(let c=0;c<r;c++)for(let d=0;d<o;d++){const g=(c*e.width+d)*4,f=(c*t.width+d)*4,P=(c*o+d)*4;for(let v=0;v<3;v++){const y=e.data[g+v],l=t.data[f+v],x=y-l,h=Math.abs(x),b=Math.max(y,1);let E;switch(n){case"signed":E=(x+255)/2;break;case"absolute":E=h;break;case"squared":E=x*x/255;break;case"relative_signed":E=(x/b+1)*127.5;break;case"relative_absolute":E=h/b*255;break;case"relative_squared":E=x*x/(b*b)*255;break}a.data[P+v]=Math.min(255,Math.max(0,Math.round(E)))}a.data[P+3]=255}return a}async function Te(e){const t=cn(e);return t||new Promise(n=>{const o=new Image;o.onload=()=>{try{const r=document.createElement("canvas");r.width=o.naturalWidth,r.height=o.naturalHeight;const a=r.getContext("2d");if(!a){n(null);return}a.drawImage(o,0,0);const c=a.getImageData(0,0,r.width,r.height);ln(e,c),n(c)}catch(r){console.warn("[cairn] loadImageData failed:",r),n(null)}},o.onerror=r=>{console.warn("[cairn] loadImageData: image failed to load:",e,r),n(null)},o.src=e})}const dn={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},fn={linear:0,signed:1,positive:2},hn=`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,gn=`#version 300 es
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
}`;let Ce=null,V=null,ue=null,Ue=null;function mn(){if(V)return V;try{if(typeof OffscreenCanvas<"u"?Ce=new OffscreenCanvas(1,1):Ce=document.createElement("canvas"),V=Ce.getContext("webgl2",{preserveDrawingBuffer:!0}),!V)return console.warn("[cairn] WebGL 2 not available"),null;const e=V.createShader(V.VERTEX_SHADER);if(V.shaderSource(e,hn),V.compileShader(e),!V.getShaderParameter(e,V.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",V.getShaderInfoLog(e)),null;const t=V.createShader(V.FRAGMENT_SHADER);if(V.shaderSource(t,gn),V.compileShader(t),!V.getShaderParameter(t,V.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",V.getShaderInfoLog(t)),null;if(ue=V.createProgram(),V.attachShader(ue,e),V.attachShader(ue,t),V.linkProgram(ue),!V.getProgramParameter(ue,V.LINK_STATUS))return console.error("[cairn] WebGL program link:",V.getProgramInfoLog(ue)),null;Ue=V.createVertexArray(),V.bindVertexArray(Ue);const n=V.createBuffer();V.bindBuffer(V.ARRAY_BUFFER,n),V.bufferData(V.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),V.STATIC_DRAW);const o=V.getAttribLocation(ue,"a_pos");return V.enableVertexAttribArray(o),V.vertexAttribPointer(o,2,V.FLOAT,!1,0,0),V.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),V}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function mt(e,t,n){const o=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,o),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),o}function pn(e,t,n){const o=new Uint8Array(1024);for(let a=0;a<256;a++)o[a*4]=t[a*3],o[a*4+1]=t[a*3+1],o[a*4+2]=t[a*3+2],o[a*4+3]=255;const r=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,o),r}function bn(e,t,n,o){const r=mn();if(!r||!ue||!Ue||!Ce)return null;const a=Math.min(e.width,t.width),c=Math.min(e.height,t.height);Ce.width=a,Ce.height=c,r.viewport(0,0,a,c);const d=mt(r,e,0),g=mt(r,t,1);let f=null;n.colormap?f=pn(r,n.colormap,2):(f=r.createTexture(),r.activeTexture(r.TEXTURE2),r.bindTexture(r.TEXTURE_2D,f),r.texImage2D(r.TEXTURE_2D,0,r.RGBA8,1,1,0,r.RGBA,r.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),r.useProgram(ue),r.uniform1i(r.getUniformLocation(ue,"u_baseline"),0),r.uniform1i(r.getUniformLocation(ue,"u_other"),1),r.uniform1i(r.getUniformLocation(ue,"u_lut"),2),r.uniform1i(r.getUniformLocation(ue,"u_diff_mode"),dn[n.diffMode]),r.uniform1i(r.getUniformLocation(ue,"u_cmap_mode"),fn[n.cmapMode]??0),r.uniform1i(r.getUniformLocation(ue,"u_use_colormap"),n.colormap?1:0),r.bindVertexArray(Ue),r.drawArrays(r.TRIANGLE_STRIP,0,4),r.bindVertexArray(null),o.width=a,o.height=c;const P=o.getContext("2d");return P&&(P.save(),P.scale(1,-1),P.drawImage(Ce,0,0,a,c,0,-c,a,c),P.restore()),r.deleteTexture(d),r.deleteTexture(g),r.deleteTexture(f),{width:a,height:c}}const vn={cardSettings:(e,t,n)=>`cairn:card-settings:${e}:${t}:${n}`,runLayout:e=>`cairn:run-layout:${e}`,collapsedSections:e=>`cairn:collapsed-sections:${e}`,comparisons:e=>`cairn:comparisons:${e}`,comparisonTemplates:e=>`cairn:comparison-templates:${e}`,reportTemplates:e=>`cairn:report-templates:${e}`,streamMode:"cairn:stream-mode",renderMode:"cairn:render-mode",scroll:e=>`cairn:scroll:${e}`,lastComparison:e=>`cairn:last-comparison:${e}`};function wn(){try{const e=localStorage.getItem(vn.renderMode);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const ve=e=>e<0?0:e>1?1:e,We=e=>{const t=e<0?0:e;return t/(1+t)},Xe=e=>{const t=e<0?0:e,n=t*(2.51*t+.03),o=t*(2.43*t+.59)+.14;return ve(n/o)},pt={linear:([e,t,n])=>[ve(e),ve(t),ve(n)],srgb:([e,t,n])=>[ve(e),ve(t),ve(n)],reinhard:([e,t,n])=>[We(e),We(t),We(n)],aces:([e,t,n])=>[Xe(e),Xe(t),Xe(n)],extended:([e,t,n])=>[e,t,n]},xn="srgb";function yn(e){return e&&pt[e]||pt[xn]}function He(e,t){return e*2**t}function En(e){const t=ve(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function Ye(e,t){return typeof t=="number"&&t>0?ve(Math.pow(ve(e),1/t)):En(e)}function bt(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function vt({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:o}){const r=bt(e),a=bt(t),c=[];for(let p=0;p<=e;p+=r)c.push(p);const d=[];for(let p=0;p<=t;p+=a)d.push(p);const g=1/n,f=8*g,P=-12*g,v=-2*g,y=o==null?void 0:o.current;let l=0,x=0,h=0,b=0;if(y){const p=y.clientWidth,M=y.clientHeight,S=p/e,u=M/t,_=Math.min(S,u);h=e*_,b=t*_,l=(p-h)/2,x=(M-b)/2}const E=y&&h>0;return i.jsxs(i.Fragment,{children:[i.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:E?x:0,transform:`translateY(${P}px)`,fontSize:f},children:c.map(p=>i.jsx("span",{className:"mono",style:{position:"absolute",left:E?l+p/e*h:`${p/e*100}%`,transform:"translateX(-50%)"},children:p},p))}),i.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:E?l:0,transform:`translateX(${v}px)`,fontSize:f},children:d.map(p=>i.jsx("span",{className:"mono",style:{position:"absolute",top:E?x+p/t*b:`${p/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*g}px`},children:p},p))})]})}function wt({label:e,isDraggable:t,onDragStart:n}){return i.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&i.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const xt=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function qe(e){const t=xt.length;return xt[(e%t+t)%t]}function _n(e){const n=s.useRef(null),[o,r]=s.useState({w:0,h:0}),a=s.useRef(null),c=s.useRef(null);return s.useEffect(()=>{var f;const d=n.current;if(d===c.current||((f=a.current)==null||f.disconnect(),a.current=null,c.current=d,!d))return;const g=new ResizeObserver(P=>{for(const v of P)r({w:v.contentRect.width,h:v.contentRect.height})});a.current=g,g.observe(d)}),s.useEffect(()=>()=>{var d;return(d=a.current)==null?void 0:d.disconnect()},[]),{ref:n,size:o}}function Mn(){const[e,t]=s.useState(!1);return s.useEffect(()=>{const n=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!0)},o=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!1)},r=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",o),window.addEventListener("blur",r),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",o),window.removeEventListener("blur",r)}},[]),e}const Pn=.25,Ze=64;function yt(e,t,n,o){if(e<=0||t<=0||n<=0||o<=0)return Ze;const r=Math.min(n/e,o/t);return r<=0?Ze:Math.max(Math.max(n,o)/r,8)}function De(e){const{containerRef:t,zoom:n,pan:o,onViewportChange:r,minZoom:a=Pn,maxZoom:c=Ze,naturalWidth:d,naturalHeight:g}=e,f=Mn(),P=s.useRef(f);P.current=f;const v=s.useRef({zoom:n,pan:o});v.current={zoom:n,pan:o};const y=s.useRef(r);y.current=r,s.useEffect(()=>{const p=t.current;if(!p||!r)return;const M=S=>{var W;if(!P.current)return;S.preventDefault(),S.stopPropagation();const u=S.deltaY<0?1.1:1/1.1,_=v.current,D=p.getBoundingClientRect(),I=d&&g?yt(d,g,D.width,D.height):c,B=Math.max(a,Math.min(I,_.zoom*u));if(_.zoom===B)return;const N=S.clientX-D.left,O=S.clientY-D.top,A=N-(N-_.pan.x)/_.zoom*B,R=O-(O-_.pan.y)/_.zoom*B;(W=y.current)==null||W.call(y,{zoom:B,pan:{x:A,y:R}})};return p.addEventListener("wheel",M,{passive:!1}),()=>p.removeEventListener("wheel",M)},[t,!!r,a,c,d,g]);const l=s.useRef(null),x=s.useCallback(p=>{!P.current||!y.current||(p.currentTarget.setPointerCapture(p.pointerId),l.current={pointerId:p.pointerId,startX:p.clientX,startY:p.clientY,panX:v.current.pan.x,panY:v.current.pan.y})},[]),h=s.useCallback(p=>{var _;const M=l.current;if(!M||M.pointerId!==p.pointerId)return;const S=p.clientX-M.startX,u=p.clientY-M.startY;(_=y.current)==null||_.call(y,{zoom:v.current.zoom,pan:{x:M.panX+S,y:M.panY+u}})},[]),b=s.useCallback(p=>{const M=l.current;if(!(!M||M.pointerId!==p.pointerId)){try{p.currentTarget.releasePointerCapture(p.pointerId)}catch{}l.current=null}},[]),E=f&&!!r;return{containerProps:{onPointerDown:x,onPointerMove:h,onPointerUp:b,onPointerCancel:b,style:{cursor:E?"move":void 0,touchAction:E?"none":void 0}},modifierActive:f}}function je(){const[e,t]=s.useState(()=>typeof window<"u"&&window.devicePixelRatio||1);return s.useEffect(()=>{if(typeof matchMedia>"u")return;let n=!1,o=null;const r=()=>{n||(t(window.devicePixelRatio||1),a())};function a(){if(n)return;const c=window.devicePixelRatio||1;o=matchMedia(`(resolution: ${c}dppx)`),o.addEventListener("change",r,{once:!0})}return a(),()=>{n=!0,o==null||o.removeEventListener("change",r)}},[]),e}function Sn(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function Et(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function Ke({data:e,settings:t,naturalWidth:n,naturalHeight:o}){const{ref:r,size:a}=_n(),c=s.useRef(null),d=s.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),g=s.useMemo(()=>{const h=a.w,b=a.h;if(h<=0||b<=0||n<=0||o<=0)return null;const E=Math.min(h/n,b/o),p=n*E,M=o*E;return{left:(h-p)/2,top:(b-M)/2,width:p,height:M}},[a.w,a.h,n,o]),f=e.masks,P=t.showMasks&&!!f&&f.length>0,v=s.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(s.useEffect(()=>{if(!P||!f)return;const h=c.current;if(!h)return;(h.width!==n||h.height!==o)&&(h.width=n,h.height=o);const b=h.getContext("2d");if(!b)return;b.clearRect(0,0,h.width,h.height);let E=!1;const p=b.createImageData(n,o),M=p.data;let S=f.length,u=!1;const _=()=>{E||u&&b.putImageData(p,0,0)},D=document.createElement("canvas");D.width=n,D.height=o;const I=D.getContext("2d",{willReadFrequently:!0});for(const B of f){const N=new Image;N.onload=()=>{if(!E){if(I){I.clearRect(0,0,n,o),I.drawImage(N,0,0,n,o);const O=I.getImageData(0,0,n,o).data;for(let A=0;A<n*o;A++){const R=O[A*4];if(R===0||d.has(R))continue;const[W,X,Z]=Sn(qe(R));M[A*4]=W,M[A*4+1]=X,M[A*4+2]=Z,M[A*4+3]=255,u=!0}}S-=1,S===0&&_()}},N.onerror=()=>{S-=1,S===0&&_()},N.src=`data:image/png;base64,${B.png_b64}`}return()=>{E=!0}},[P,f,n,o,v]),!g)return i.jsx("div",{ref:r,className:"absolute inset-0 pointer-events-none"});const y=e.boxes??[],l=t.showBoxes&&y.length>0,x=e.class_labels??{};return i.jsxs("div",{ref:r,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[P&&i.jsx("canvas",{ref:c,className:"absolute",style:{left:g.left,top:g.top,width:g.width,height:g.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),l&&i.jsx("svg",{className:"absolute",style:{left:g.left,top:g.top,width:g.width,height:g.height,overflow:"visible"},viewBox:`0 0 ${n} ${o}`,preserveAspectRatio:"none",children:y.map((h,b)=>{if(!Et(h,t,d))return null;const E=h.domain==="pixel"?1:n,p=h.domain==="pixel"?1:o,M=h.position.minX*E,S=h.position.minY*p,u=(h.position.maxX-h.position.minX)*E,_=(h.position.maxY-h.position.minY)*p;return i.jsx("rect",{x:M,y:S,width:u,height:_,fill:"none",stroke:qe(h.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},b)})}),l&&i.jsx("div",{className:"absolute",style:{left:g.left,top:g.top,width:g.width,height:g.height},children:y.map((h,b)=>{if(!Et(h,t,d))return null;const E=h.domain==="pixel"?1/n:1,p=h.domain==="pixel"?1/o:1,M=h.position.minX*E*100,S=h.position.minY*p*100,u=h.label??x[String(h.class_id)]??`#${h.class_id}`,_=h.score!=null?` ${(h.score*100).toFixed(0)}%`:"";return!u&&!_?null:i.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${M}%`,top:`${S}%`,transform:"translateY(-100%)",backgroundColor:qe(h.class_id)},children:i.jsxs("span",{className:"mono",children:[u,_]})},b)})})]})}const Qe=30,re=["#ff5a5a","#39d353","#5b9bff"];function Je(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function j(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):Je(e/255):Je(n==="int"?e*255:e)}const Tn={x:0,y:0,w:1,h:1};function ye({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:o,pan:r,sample:a,notation:c="decimal",version:d=0,onActiveChange:g,sourceWindow:f=Tn}){const P=s.useRef(null),v=s.useRef(!1),y=je(),l=s.useRef(g);l.current=g;const x=s.useCallback(b=>{var E;b!==v.current&&(v.current=b,(E=l.current)==null||E.call(l,b))},[]),h=s.useCallback(()=>{var ce;const b=P.current,E=e.current;if(!b)return;const p=window.devicePixelRatio||1,M=b.clientWidth,S=b.clientHeight;if(M===0||S===0)return;b.width!==Math.round(M*p)&&(b.width=Math.round(M*p)),b.height!==Math.round(S*p)&&(b.height=Math.round(S*p));const u=b.getContext("2d");if(!u)return;if(u.setTransform(p,0,0,p,0,0),u.clearRect(0,0,M,S),!E||t<=0||n<=0){x(!1);return}const _=E.getBoundingClientRect(),D=b.getBoundingClientRect();if(_.width===0||_.height===0){x(!1);return}const I=f.x*t,B=f.y*n,N=f.w*t,O=f.h*n;if(N<=0||O<=0){x(!1);return}const A=Math.min(_.width/N,_.height/O);if(A<Qe){x(!1);return}const R=N*A,W=O*A,X=_.left+(_.width-R)/2-D.left,Z=_.top+(_.height-W)/2-D.top,J=Math.max(Math.floor(I),Math.floor(I+(0-X)/A)),ie=Math.min(Math.ceil(I+N),Math.ceil(I+(M-X)/A)),de=Math.max(Math.floor(B),Math.floor(B+(0-Z)/A)),fe=Math.min(Math.ceil(B+O),Math.ceil(B+(S-Z)/A));if(ie<=J||fe<=de){x(!1);return}x(!0);const oe=X+(0-I)*A,me=Z+(0-B)*A,pe=X+(t-I)*A,be=Z+(n-B)*A;u.save(),u.beginPath(),u.rect(oe,me,pe-oe,be-me),u.clip(),u.textAlign="center",u.textBaseline="middle",u.lineJoin="round";const ge=A*.14,se=A-ge*2;for(let le=de;le<fe;le++)for(let Q=J;Q<ie;Q++){if(Q<0||le<0||Q>=t||le>=n)continue;const z=a(Q,le,c);if(!z||z.lines.length===0)continue;const Y=z.lines.length;let K=1;for(const G of z.lines)G.length>K&&(K=G.length);const ae=se/(Y*1.15),ee=se/(K*.62)||ae,C=Math.min(ae,ee,24);if(C<6)continue;const U=X+(Q-I+.5)*A,m=Z+(le-B+.5)*A,w=C*1.15,T=z.luminance<=.55,k=T?"#ffffff":"#000000";u.font=`${C}px ui-monospace, SFMono-Regular, Menlo, monospace`,u.lineWidth=Math.max(1.4,C*.16),u.strokeStyle=T?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let L=m-Y*w/2+w/2;for(let G=0;G<z.lines.length;G++){const F=z.lines[G];u.strokeText(F,U,L),u.fillStyle=((ce=z.colors)==null?void 0:ce[G])??k,u.fillText(F,U,L),L+=w}}u.restore()},[e,t,n,a,c,x,f]);return s.useEffect(()=>{h()},[h,o,r.x,r.y,d,c,f,y]),s.useEffect(()=>{const b=P.current;if(!b)return;const E=new ResizeObserver(()=>h());return E.observe(b),()=>E.disconnect()},[h]),i.jsx("canvas",{ref:P,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function _t({notation:e,onChange:t,className:n=""}){return i.jsx("button",{type:"button",onClick:o=>{o.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:o=>o.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const Cn=`
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
`,Re={linear:0,srgb:1,reinhard:2,aces:3,extended:4},Mt=new WeakMap;function kn(e,t){let n=Mt.get(e);n||(n=new Map,Mt.set(e,n));let o=n.get(t);return o||(o=e.createRenderPipeline({shaderWGSL:Cn,targetFormat:t}),n.set(t,o)),o}function Pt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function St(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const o=e.createTexture(256,1,"rgba32float");return o.write(t),o}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function In(e,t,n,o){var x;const r=Pt(t),a=kn(e,r),c=St(e,o.isScalar?o.colormap:void 0),d=typeof o.gamma=="number"&&o.gamma>0?o.gamma:0,g=Re[o.operator]??Re.srgb,f=new Float32Array([o.exposureEV,g,d,o.isScalar?1:0]),P=new Float32Array([o.uv.x,o.uv.y,o.uv.w,o.uv.h]),v=new Float32Array([o.hdrOut?1:0]),y=new Float32Array([o.filter==="nearest"?0:1]);let l;try{l=e.createBindGroup(a,[{binding:0,resource:n},{binding:1,resource:c},{binding:2,resource:{uniform:f}},{binding:3,resource:{uniform:P}},{binding:4,resource:{uniform:v}},{binding:5,resource:{uniform:y}}]),e.renderFullscreen(t,a,l)}finally{(x=l==null?void 0:l.destroy)==null||x.call(l),c.destroy()}}const Un={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Dn={linear:0,signed:1,positive:2},Rn={split:0,blend:1,diff:2},Tt=new WeakMap;function Ln(e,t){let n=Tt.get(e);n||(n=new Map,Tt.set(e,n));let o=n.get(t);return o||(o=e.createRenderPipeline({shaderWGSL:An,targetFormat:t}),n.set(t,o)),o}function On(e,t,n,o,r){var p;const a=Pt(t),c=Ln(e,a),d=r.mode==="diff"&&!!r.diffColormap,g=r.isScalar?r.colormap:d?r.diffColormap:void 0,f=St(e,g),P=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,v=Re[r.operator]??Re.srgb,y=new Float32Array([r.exposureEV,v,P,r.isScalar?1:0]),l=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),x=new Float32Array([Rn[r.mode],r.split,r.alpha,Un[r.diffSubmode]??0]),h=new Float32Array([Dn[r.diffCmapMode??"linear"]??0,r.hdrOut?1:0,d?1:0,0]),b=new Float32Array([r.filter==="nearest"?0:1]);let E;try{E=e.createBindGroup(c,[{binding:0,resource:n},{binding:1,resource:o},{binding:2,resource:f},{binding:3,resource:{uniform:y}},{binding:4,resource:{uniform:l}},{binding:5,resource:{uniform:x}},{binding:6,resource:{uniform:h}},{binding:7,resource:{uniform:b}}]),e.renderFullscreen(t,c,E)}finally{(p=E==null?void 0:E.destroy)==null||p.call(E),f.destroy()}}function Ct(e,t,n){if(n<=0)return{mse:0,psnr:1/0,mae:0};const o=e/n,r=t/n,a=o<=0?1/0:10*Math.log10(1/o);return{mse:o,psnr:a,mae:r}}async function Gn(e,t,n){const o=Math.min(t.width,n.width),r=Math.min(t.height,n.height),a=o*r*3;if(a<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:y,sumAbs:l}=await e.reduceDiffSumSquaredAbs(t,n,o,r);return Ct(y,l,a)}const c=await e.readback(t),d=await e.readback(n),g=c instanceof Uint8Array,f=d instanceof Uint8Array;let P=0,v=0;for(let y=0;y<r;y++)for(let l=0;l<o;l++){const x=(y*t.width+l)*4,h=(y*n.width+l)*4;for(let b=0;b<3;b++){const E=(c[x+b]??0)/(g?255:1),p=(d[h+b]??0)/(f?255:1),M=E-p;P+=M*M,v+=Math.abs(M)}}return Ct(P,v,a)}function At(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const Fn=12,Ee=[];function kt(e){const t=Ee.indexOf(e);t!==-1&&Ee.splice(t,1),Ee.push(e)}function Bn(e){const t=Ee.indexOf(e);t!==-1&&Ee.splice(t,1)}function Le(e){e.parked||(Bn(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.parked=!0)}function It(e){for(;Ee.length>Fn;){const t=Ee.find(n=>n!==e&&!n.visible)??Ee.find(n=>n!==e);if(!t)break;Le(t)}}function Ut(e){var r,a;if(e.disposed)return;if(At())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){kt(e),It(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const n=e.backingWidth||((r=e.source)==null?void 0:r.width)||1,o=e.backingHeight||((a=e.source)==null?void 0:a.height)||1;if(e.canvas.width=n,e.canvas.height=o,e.surface.configure(n,o),e.source){const c=t.createTexture(e.source.width,e.source.height,e.source.format);c.write(e.source.data),e.srcTexture=c}e.parked=!1,kt(e),It(e)}function Nn(e,t){if(e.disposed||!e.source)return!0;try{return Ut(e),!e.surface||!e.srcTexture?!1:(In(e.device,e.surface,e.srcTexture,t),!0)}catch(n){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Le(e),!1}}function Vn(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},resize(t,n){if(e.disposed)return;const o=Math.max(1,Math.round(t)),r=Math.max(1,Math.round(n));e.backingWidth===o&&e.backingHeight===r||(e.backingWidth=o,e.backingHeight=r,!e.parked&&e.surface&&(e.canvas.width=o,e.canvas.height=r,e.surface.configure(o,r)))},render(t){return Nn(e,t)},park(){e.disposed||Le(e)},restore(){e.disposed||!e.source||Ut(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Le(e),e.source=null,e.disposed=!0)}}}async function zn(e,t){const n=await Ie(),o={canvas:e,device:n,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return Vn(o)}function Dt(e){e.dispose()}function $n(e,t){const{brightness:n,contrast:o,exposure:r,flipSign:a}=e;return[`url(#${t})`,`brightness(${(1+n)*Math.pow(2,r)})`,`contrast(${1+o})`,...a?["invert(1)"]:[]].join(" ")}function Rt(e){const n=`cairn-gamma-${s.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:o,contrast:r,gamma:a,exposure:c,offset:d,flipSign:g}=e,f=s.useMemo(()=>$n(e,n),[n,o,r,c,g]);return{gammaFilterId:n,filterStr:f,gamma:a,offset:d}}function Lt({id:e,gamma:t,offset:n}){return i.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:i.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:i.jsxs("feComponentTransfer",{children:[i.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),i.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),i.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:n})]})})})}const Wn=["fill","fill-opacity","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-linecap","stroke-linejoin","opacity","color","font","font-family","font-size","font-weight","font-style","text-anchor","dominant-baseline","visibility","display"];function Ot(e,t){const n=getComputedStyle(e),o=Wn.map(g=>`${g}:${n.getPropertyValue(g)}`).join(";"),r=t.getAttribute("style");t.setAttribute("style",r?`${r};${o}`:o);const a=e.children,c=t.children,d=Math.min(a.length,c.length);for(let g=0;g<d;g++)Ot(a[g],c[g])}function Gt(e){let t=e;for(;t;){const n=getComputedStyle(t).backgroundColor;if(n&&n!=="transparent"&&!n.startsWith("rgba(0, 0, 0, 0)"))return n;t=t.parentElement}return"#ffffff"}function Ft(e){const t=(e==null?void 0:e.scale)??(typeof window<"u"&&window.devicePixelRatio||1);return Math.min(Math.max(t,1),3)}async function Bt(e,t,n,o,r){const a=document.createElement("canvas");a.width=Math.max(1,Math.round(e*n)),a.height=Math.max(1,Math.round(t*n));const c=a.getContext("2d");if(!c)throw new Error("plot-to-png: 2D canvas context unavailable");return c.scale(n,n),o&&(c.fillStyle=o,c.fillRect(0,0,e,t)),r(c),await new Promise((d,g)=>a.toBlob(f=>f?d(f):g(new Error("plot-to-png: toBlob returned null")),"image/png"))}function Xn(e,t,n){const o=e.cloneNode(!0);Ot(e,o),o.setAttribute("width",String(t)),o.setAttribute("height",String(n)),o.setAttribute("xmlns","http://www.w3.org/2000/svg");const r=new XMLSerializer().serializeToString(o),a="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(r);return new Promise((c,d)=>{const g=new Image;g.onload=()=>c(g),g.onerror=()=>d(new Error("plot-to-png: SVG rasterization failed")),g.src=a})}async function Nt(e,t){const n=e.getBoundingClientRect(),o=n.width||e.width,r=n.height||e.height,a=(t==null?void 0:t.background)??Gt(e);return Bt(o,r,Ft(t),a,c=>c.drawImage(e,0,0,o,r))}async function Hn(e,t){const n=e.querySelector("svg"),o=Array.from(e.querySelectorAll("canvas")),r=e.getBoundingClientRect(),a=r.width||300,c=r.height||150,d=(t==null?void 0:t.background)??Gt(e);if(n){const g=n.getBoundingClientRect(),f=await Xn(n,g.width||a,g.height||c);return Bt(a,c,Ft(t),d,P=>{for(const v of o){const y=v.getBoundingClientRect();P.drawImage(v,y.left-r.left,y.top-r.top,y.width,y.height)}P.drawImage(f,g.left-r.left,g.top-r.top,g.width,g.height)})}if(o.length)return Nt(o[0],t);throw new Error("plot-to-png: no <svg> or <canvas> found under root")}function Yn(e,t){const n=URL.createObjectURL(e),o=document.createElement("a");o.href=n,o.download=t.endsWith(".png")?t:`${t}.png`,document.body.appendChild(o),o.click(),o.remove(),setTimeout(()=>URL.revokeObjectURL(n),1e3)}const qn={"top-right":{top:6,right:6},"top-left":{top:6,left:6},"bottom-right":{bottom:6,right:6},"bottom-left":{bottom:6,left:6}},Zn={boxZoom:i.jsx("rect",{x:"3.5",y:"3.5",width:"17",height:"17",rx:"1.5",strokeDasharray:"4 3"}),pan:i.jsxs(i.Fragment,{children:[i.jsx("path",{d:"M12 2v20M2 12h20"}),i.jsx("path",{d:"M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"})]}),zoomIn:i.jsxs(i.Fragment,{children:[i.jsx("circle",{cx:"10.5",cy:"10.5",r:"7"}),i.jsx("path",{d:"M21 21l-5.2-5.2M10.5 7.5v6M7.5 10.5h6"})]}),zoomOut:i.jsxs(i.Fragment,{children:[i.jsx("circle",{cx:"10.5",cy:"10.5",r:"7"}),i.jsx("path",{d:"M21 21l-5.2-5.2M7.5 10.5h6"})]}),autoscale:i.jsx("path",{d:"M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"}),home:i.jsx("path",{d:"M3 11l9-8 9 8M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5M9.5 21v-6h5v6"}),camera:i.jsxs(i.Fragment,{children:[i.jsx("path",{d:"M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"}),i.jsx("circle",{cx:"12",cy:"13.5",r:"3.3"})]})};function jn({name:e}){return i.jsx("svg",{viewBox:"0 0 24 24",width:"13",height:"13",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:Zn[e]??null})}function _e({icon:e,label:t,title:n,active:o,disabled:r,onClick:a}){return i.jsx("button",{type:"button",disabled:r,onClick:c=>{c.stopPropagation(),!r&&a()},onPointerDown:c=>c.stopPropagation(),onDoubleClick:c=>c.stopPropagation(),"aria-label":n,"aria-pressed":o,"aria-disabled":r,title:n,className:["h-[22px] min-w-[22px] inline-flex items-center justify-center rounded",t?"px-1.5 text-[10px] font-mono":"text-xs",r?"opacity-40 cursor-default text-fg-muted":o?"bg-bg-hover text-accent":"text-fg-muted hover:text-fg hover:bg-bg-hover"].join(" "),children:t?i.jsx("span",{"aria-hidden":"true",children:t}):i.jsx(jn,{name:e??""})})}function Oe(){return i.jsx("span",{"aria-hidden":"true",className:"mx-0.5 h-3.5 w-px bg-border"})}function et({controller:e,config:t}){if((t==null?void 0:t.enabled)===!1)return null;const n=e.capabilities,o=t==null?void 0:t.buttons,r=(l,x)=>x&&(o==null?void 0:o[l])!==!1,a=l=>()=>e.setDragMode(l),c=r("zoom",n.zoom)||r("pan",n.pan),d=r("zoomIn",n.zoom)||r("zoomOut",n.zoom),g=r("autoscale",n.autoscale)||r("reset",n.reset),f=r("screenshot",n.screenshot),P=(t==null?void 0:t.leadingButtons)??[];if(!P.length&&!c&&!d&&!g&&!f)return null;const v=(t==null?void 0:t.position)??"top-right",y=(t==null?void 0:t.visibility)==="always";return i.jsxs("div",{style:{position:"absolute",pointerEvents:"auto",...qn[v]},className:["z-20 flex items-center gap-0.5 rounded border border-border","bg-bg-elevated/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-opacity",y?"opacity-100":"opacity-0 group-hover:opacity-100"].join(" "),role:"toolbar","aria-label":"Plot controls",children:[P.length>0&&i.jsxs(i.Fragment,{children:[P.map(l=>i.jsx(_e,{icon:l.icon,label:l.label,title:l.title,active:l.active,disabled:l.disabled,onClick:l.onClick},l.id)),(c||d||g||f)&&i.jsx(Oe,{})]}),c&&i.jsxs(i.Fragment,{children:[r("zoom",n.zoom)&&i.jsx(_e,{icon:"boxZoom",title:"Box zoom",active:e.dragMode==="zoom",onClick:a("zoom")}),r("pan",n.pan)&&i.jsx(_e,{icon:"pan",title:"Pan",active:e.dragMode==="pan",onClick:a("pan")})]}),d&&i.jsxs(i.Fragment,{children:[c&&i.jsx(Oe,{}),r("zoomIn",n.zoom)&&i.jsx(_e,{icon:"zoomIn",title:"Zoom in",onClick:()=>e.zoomIn()}),r("zoomOut",n.zoom)&&i.jsx(_e,{icon:"zoomOut",title:"Zoom out",onClick:()=>e.zoomOut()})]}),g&&i.jsxs(i.Fragment,{children:[(c||d)&&i.jsx(Oe,{}),r("autoscale",n.autoscale)&&i.jsx(_e,{icon:"autoscale",title:"Autoscale",onClick:()=>e.autoscale()}),r("reset",n.reset)&&i.jsx(_e,{icon:"home",title:e.isModified?"Reset view":"Reset view (at home)",disabled:!e.isModified,onClick:()=>e.reset()})]}),f&&i.jsxs(i.Fragment,{children:[(c||d||g)&&i.jsx(Oe,{}),i.jsx(_e,{icon:"camera",title:"Download plot as PNG",onClick:()=>{e.toPNG({filename:"plot"}).then(l=>Yn(l,"plot.png")).catch(()=>{})}})]})]})}const Kn={zoom:1,pan:{x:0,y:0}},Vt=1.3,Qn=.25,Jn=64,tt={buttons:{zoom:!1}};function nt(e,t){return{id:"notation",label:e==="int"?"0–255":"0–1",title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",onClick:()=>t(e==="int"?"decimal":"int")}}function rt({rootRef:e,canvasRef:t,zoom:n,pan:o,onViewportChange:r,naturalWidth:a,naturalHeight:c,minZoom:d=Qn,maxZoom:g=Jn,requestRender:f}){const P=s.useCallback(S=>{var W;if(!r)return;const u=(W=e.current)==null?void 0:W.getBoundingClientRect(),_=(u==null?void 0:u.width)??0,D=(u==null?void 0:u.height)??0,I=a&&c&&_>0&&D>0?yt(a,c,_,D):g,B=Math.max(d,Math.min(I,n*S));if(B===n)return;const N=_/2,O=D/2,A=N-(N-o.x)/n*B,R=O-(O-o.y)/n*B;r({zoom:B,pan:{x:A,y:R}})},[r,e,a,c,g,d,n,o.x,o.y]),v=s.useCallback(()=>P(Vt),[P]),y=s.useCallback(()=>P(1/Vt),[P]),l=s.useCallback(()=>r==null?void 0:r(Kn),[r]),x=s.useCallback(S=>{const u={scale:S==null?void 0:S.scale,filename:S==null?void 0:S.filename};f==null||f();const _=t==null?void 0:t.current;if(_)return Nt(_,u);const D=e.current;return D?Hn(D,u):Promise.reject(new Error("useImageController.toPNG: no canvas or root element to export"))},[t,e,f]),h=s.useMemo(()=>({zoom:!0,pan:!0,autoscale:!0,reset:!0,screenshot:!0,boxZoom:!1,select:!1,lasso:!1,hover:!1,spikelines:!1,hoverModes:!1,legend:!1,axisScaleToggle:!1,perAxisDrag:!1,brush:!1,reorder:!1}),[]),b=n!==1||o.x!==0||o.y!==0,E=s.useCallback(S=>{},[]),p=s.useCallback(S=>{},[]),M=s.useCallback(()=>{},[]);return s.useMemo(()=>({capabilities:h,dragMode:"pan",hoverMode:"closest",spikelines:!1,isModified:b,setDragMode:E,setHoverMode:p,toggleSpikelines:M,zoomIn:v,zoomOut:y,autoscale:l,reset:l,toPNG:x}),[h,b,E,p,M,v,y,l,x])}function zt(e){return"hdr"in e&&e.hdr!=null}const er={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1},tr={zoom:1,pan:{x:0,y:0}};function nr(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`CpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}const Me=e=>Number.isFinite(e)?e:0;function rr(e,t,n,o){const{h:r,w:a,c}=nr(e.shape),d=e.data,g=yn(t),f=new Uint8ClampedArray(a*r*4);for(let P=0;P<a*r;P++){const v=P*c;let y,l,x,h=1;c===1?y=l=x=Me(d[v]):c===3?(y=Me(d[v]),l=Me(d[v+1]),x=Me(d[v+2])):(y=Me(d[v]),l=Me(d[v+1]),x=Me(d[v+2]),h=Me(d[v+3]));const b=[He(y,n),He(l,n),He(x,n)],[E,p,M]=g(b),S=P*4;f[S]=255*Ye(E,o),f[S+1]=255*Ye(p,o),f[S+2]=255*Ye(M,o),f[S+3]=255*(h<0?0:h>1?1:h)}return new ImageData(f,a,r)}function $t({zoom:e,pan:t,onViewportChange:n,showAxes:o,naturalDims:r,label:a,showLabelChip:c,isDraggable:d=!1,onDragStart:g,toolbar:f,notationSeed:P,sample:v,pixelDataVersion:y,displayElRef:l,exportCanvasRef:x,hasPixelSource:h,header:b,overlayNode:E,children:p}){const M=s.useRef(null),S=s.useRef(null),[u,_]=s.useState(P),[D,I]=s.useState(!1),B=`translate(${t.x}px, ${t.y}px) scale(${e})`,{containerProps:N}=De({containerRef:M,zoom:e,pan:t,onViewportChange:n,naturalWidth:r==null?void 0:r.w,naturalHeight:r==null?void 0:r.h}),O=s.useCallback(()=>{n==null||n(tr)},[n]),A=rt({rootRef:M,canvasRef:x,zoom:e,pan:t,onViewportChange:n,naturalWidth:r==null?void 0:r.w,naturalHeight:r==null?void 0:r.h}),R=s.useMemo(()=>({...tt,leadingButtons:D?[nt(u,_)]:[]}),[D,u]);return i.jsxs("div",{className:`relative flex flex-col h-full${f?" group":""}`,"data-cpu-image-pane":!0,children:[b,f&&i.jsx(et,{controller:A,config:R}),i.jsxs("div",{ref:M,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:o&&r?"16px 4px 4px 28px":"4px",...N.style},onPointerDown:N.onPointerDown,onPointerMove:N.onPointerMove,onPointerUp:N.onPointerUp,onPointerCancel:N.onPointerCancel,onDoubleClick:O,"data-cpu-image-viewport":!0,children:[i.jsxs("div",{ref:S,className:"relative w-full h-full",style:{transform:B,transformOrigin:"0 0"},children:[p,o&&r&&i.jsx(vt,{naturalWidth:r.w,naturalHeight:r.h,zoom:e,containerRef:S}),E]}),h&&r&&i.jsx(ye,{imageElRef:l,naturalWidth:r.w,naturalHeight:r.h,zoom:e,pan:t,sample:v,notation:u,version:y,onActiveChange:I}),!f&&D&&i.jsx(_t,{notation:u,onChange:_})]}),c&&i.jsx(wt,{label:a,isDraggable:d,onDragStart:g})]})}function or(e){var C,U;const{imageUrl:t,baselineUrl:n=null,isBaseline:o=!1,diffMode:r="none",interpolation:a="auto",colormap:c="none",showAxes:d=!1,processing:g=er,zoom:f=1,pan:P={x:0,y:0},onViewportChange:v,onNaturalSize:y,label:l,isDraggable:x=!1,onDragStart:h,overlay:b,overlaySettings:E,pixelValueNotation:p="decimal",toolbar:M=!0}=e,S=s.useRef(null),u=s.useRef(null),_=s.useRef(null),D=s.useRef(null),I=s.useRef(null),[B,N]=s.useState(0),O=s.useCallback(()=>N(m=>m+1),[]),A=s.useMemo(()=>({get current(){const m=_.current;return m instanceof HTMLCanvasElement?m:null}}),[]),R=s.useCallback(m=>{S.current=m,m&&(_.current=m)},[]),W=s.useCallback(m=>{u.current=m,m&&(_.current=m)},[]),X=s.useCallback(m=>{m&&(_.current=m)},[]),[Z,J]=s.useState(!1),[ie,de]=s.useState(!1),[fe,oe]=s.useState(null),{flipSign:me}=g,{gammaFilterId:pe,filterStr:be,gamma:ge,offset:se}=Rt(g),ce=!o&&r!=="none"&&n!=null&&t!=null,le=r!=="none"&&n!=null,Q=c!=="none"&&!ce&&!(o&&le)&&t!=null;s.useEffect(()=>{if(!Q||!t){de(!1);return}let m=!1;de(!1);const w=`${t}::${c}`,T=ze(w);if(T){const L=u.current;if(L){L.width=T.width,L.height=T.height;const G=L.getContext("2d");G&&G.putImageData(T,0,0),I.current=T,O(),oe({w:T.width,h:T.height}),y==null||y(T.width,T.height),de(!0)}return}const k=new Image;return k.onload=()=>{if(m)return;const L=document.createElement("canvas");L.width=k.naturalWidth,L.height=k.naturalHeight;const G=L.getContext("2d");if(!G)return;G.drawImage(k,0,0);const F=G.getImageData(0,0,L.width,L.height),H=ut.has(c)?"positive":"linear",$=Ve(F,c,H);$e(w,$);const te=u.current;if(!te||m)return;te.width=$.width,te.height=$.height;const ne=te.getContext("2d");ne&&ne.putImageData($,0,0),I.current=$,O(),oe({w:$.width,h:$.height}),y==null||y($.width,$.height),de(!0)},k.src=t,()=>{m=!0}},[Q,t,c]);const z=s.useCallback((m,w)=>{oe(T=>T&&T.w===m&&T.h===w?T:{w:m,h:w}),y==null||y(m,w)},[]);s.useEffect(()=>{if(!t){D.current=null,I.current=null,O();return}let m=!1;return Te(t).then(w=>{m||(D.current=w,c==="none"&&(I.current=w),O())}),()=>{m=!0}},[t,c,O]);const Y=s.useCallback((m,w,T)=>{const k=D.current;if(!k||m<0||w<0||m>=k.width||w>=k.height)return null;const L=(w*k.width+m)*4,G=k.data[L],F=k.data[L+1],H=k.data[L+2],$=I.current;let te=G,ne=F,he=H;if($&&$.width===k.width&&$.height===k.height){const Ae=(w*$.width+m)*4;te=$.data[Ae],ne=$.data[Ae+1],he=$.data[Ae+2]}const we=(.299*te+.587*ne+.114*he)/255;return c!=="none"||G===F&&F===H?{lines:[j(G,"uint8",T)],luminance:we}:{lines:[j(G,"uint8",T),j(F,"uint8",T),j(H,"uint8",T)],luminance:we,colors:[re[0],re[1],re[2]]}},[c]);s.useEffect(()=>{if(!ce){J(!1);return}let m=!1;const w=wn(),T=w==="gpu"||w==="auto",k=`${n}::${t}::${r}::${c}`;if(w!=="gpu"){const L=ze(k);if(L){const G=S.current;if(G){(G.width!==L.width||G.height!==L.height)&&(G.width=L.width,G.height=L.height);const F=G.getContext("2d");F&&F.putImageData(L,0,0),z(L.width,L.height),J(!0)}return}}return(async()=>{const[L,G]=await Promise.all([Te(n),Te(t)]);if(m||!L||!G)return;const H=r.includes("signed")?"signed":"positive",$=c!=="none"?Ne(c):null,te={diffMode:r,colormap:$,cmapMode:H};if(T)try{const Se=S.current;if(Se){const Ae=bn(L,G,te,Se);if(Ae){if(m)return;z(Ae.width,Ae.height),J(!0);return}}}catch(Se){console.warn("[cairn] WebGL 2 diff error:",Se)}if(w==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let ne=un(L,G,r);c!=="none"&&(ne=Ve(ne,c,H)),$e(k,ne);const he=S.current;if(!he||m)return;(he.width!==ne.width||he.height!==ne.height)&&(he.width=ne.width,he.height=ne.height);const we=he.getContext("2d");we&&we.putImageData(ne,0,0),z(ne.width,ne.height),J(!0)})(),()=>{m=!0}},[n,t,r,ce,c,y]);const K=a==="auto"?void 0:a,ae=me?{filter:"invert(1)"}:{},ee=b&&(E!=null&&E.enabled)&&fe&&t&&((((C=b.boxes)==null?void 0:C.length)??0)>0||(((U=b.masks)==null?void 0:U.length)??0)>0)?i.jsx(Ke,{data:b,settings:E,naturalWidth:fe.w,naturalHeight:fe.h}):void 0;return i.jsx($t,{zoom:f,pan:P,onViewportChange:v,showAxes:d,naturalDims:fe,label:l,showLabelChip:!0,isDraggable:x,onDragStart:h,toolbar:M,notationSeed:p,sample:Y,pixelDataVersion:B,displayElRef:_,exportCanvasRef:A,hasPixelSource:!!t,header:i.jsx(Lt,{id:pe,gamma:ge,offset:se}),overlayNode:ee,children:t?ce?i.jsxs(i.Fragment,{children:[!Z&&i.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),i.jsx("canvas",{ref:R,className:"w-full h-full object-contain block",style:{display:Z?"block":"none",imageRendering:K,...ae}})]}):Q?i.jsxs(i.Fragment,{children:[!ie&&i.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),i.jsx("canvas",{ref:W,className:"w-full h-full object-contain block",style:{display:ie?"block":"none",imageRendering:K,...ae}})]}):i.jsx("img",{ref:X,src:t,alt:l,className:"w-full h-full object-contain block",draggable:!1,style:{filter:be,imageRendering:K},onLoad:m=>{const w=m.currentTarget;oe({w:w.naturalWidth,h:w.naturalHeight}),y==null||y(w.naturalWidth,w.naturalHeight)}}):i.jsx("span",{className:"text-xs text-fg-muted",children:"no image"})})}function ar(e){const{hdr:t,tonemap:n="srgb",exposure:o=0,gamma:r,showAxes:a=!1,label:c="",interpolation:d="auto",zoom:g=1,pan:f={x:0,y:0},onViewportChange:P,pixelValueNotation:v="decimal",toolbar:y=!0}=e,l=s.useRef(null),[x,h]=s.useState(null),b=s.useRef(null),[E,p]=s.useState(0);s.useEffect(()=>{const u=l.current;if(!u)return;let _;try{_=rr(t,n,o,r)}catch(I){console.error("[cairn] HDR tone-map error:",I);return}(u.width!==_.width||u.height!==_.height)&&(u.width=_.width,u.height=_.height);const D=u.getContext("2d");D&&(D.putImageData(_,0,0),b.current=_,p(I=>I+1),h(I=>I&&I.w===_.width&&I.h===_.height?I:{w:_.width,h:_.height}))},[t,n,o,r]);const M=s.useCallback((u,_,D)=>{const I=x;if(!I||u<0||_<0||u>=I.w||_>=I.h)return null;const B=t.shape.length===2?1:t.shape[2]??1,N=(_*I.w+u)*B,O=t.data,A=b.current;let R=.5;if(A&&A.width===I.w&&A.height===I.h){const W=(_*I.w+u)*4;R=(.299*A.data[W]+.587*A.data[W+1]+.114*A.data[W+2])/255}return B===1?{lines:[j(O[N]??0,"unit",D)],luminance:R}:{lines:[j(O[N]??0,"unit",D),j(O[N+1]??0,"unit",D),j(O[N+2]??0,"unit",D)],luminance:R,colors:[re[0],re[1],re[2]]}},[t,x]),S=d==="auto"?void 0:d;return i.jsx($t,{zoom:g,pan:f,onViewportChange:P,showAxes:a,naturalDims:x,label:c,showLabelChip:!!c,toolbar:y,notationSeed:v,sample:M,pixelDataVersion:E,displayElRef:l,exportCanvasRef:l,hasPixelSource:!0,children:i.jsx("canvas",{ref:l,className:"w-full h-full object-contain block",style:{imageRendering:S}})})}function ot(e){return zt(e)?i.jsx(ar,{...e}):i.jsx(or,{...e})}const ir=["linear","srgb","reinhard","aces"];function sr(e){return e&&ir.includes(e)?e:"srgb"}const Pe=e=>Number.isFinite(e)?e:0;function cr(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function lr(e){const{h:t,w:n,c:o}=cr(e.shape),r=e.data,a=new Float32Array(n*t*4);for(let c=0;c<n*t;c++){const d=c*o;let g,f,P,v=1;o===1?g=f=P=Pe(r[d]):o===3?(g=Pe(r[d]),f=Pe(r[d+1]),P=Pe(r[d+2])):(g=Pe(r[d]),f=Pe(r[d+1]),P=Pe(r[d+2]),v=Pe(r[d+3]));const y=c*4;a[y]=g,a[y+1]=f,a[y+2]=P,a[y+3]=v}return{data:a,width:n,height:t,format:"rgba32float"}}function Wt(e,t,n,o){if(n<=0||o<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const r=Math.min(t.width/n,t.height/o),a=n*r,c=o*r,d=(t.width-a)/2,g=(t.height-c)/2,f=Math.max(e.zoom,1e-6),P=t.width/(f*a),v=t.height/(f*c),y=-d/a-e.pan.x/(f*a),l=-g/c-e.pan.y/(f*c);return{x:y,y:l,w:P,h:v}}function Xt(e,t,n,o){const r=e.w*n,a=e.h*o;return r<=0||a<=0||t.width<=0||t.height<=0?0:Math.min(t.width/r,t.height/a)}const ur={zoom:1,pan:{x:0,y:0}};function dr(e){var ae,ee;const t=zt(e),n=s.useRef(null),o=s.useRef(null),r=s.useRef(null),a=s.useRef(null),c=s.useRef(!1),[d,g]=s.useState(!1),[f,P]=s.useState(!1),[v,y]=s.useState(null),[l,x]=s.useState(0),[h,b]=s.useState(0),[E,p]=s.useState({x:0,y:0,w:1,h:1}),M=s.useRef(null),S=s.useRef(null),[u,_]=s.useState(0),[D,I]=s.useState(e.pixelValueNotation??"decimal"),[B,N]=s.useState(!1),O=e.zoom??1,A=e.pan??{x:0,y:0},R=e.onViewportChange,W=t?"none":e.colormap??"none",X=je();s.useEffect(()=>{const C=n.current;if(!C)return;let U=!1;return Ie().then(m=>{if(U)return;const w=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,T=m.capabilities.hdr&&w&&t;c.current=T,zn(C,{hdr:T}).then(k=>{if(U){Dt(k);return}a.current=k,P(!0)}).catch(k=>{U||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",k),g(!0))})}).catch(m=>{U||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",m),g(!0))}),()=>{U=!0,a.current&&(Dt(a.current),a.current=null)}},[]);const{containerProps:Z}=De({containerRef:o,zoom:O,pan:A,onViewportChange:R,naturalWidth:v==null?void 0:v.w,naturalHeight:v==null?void 0:v.h}),J=s.useCallback(()=>{R==null||R(ur)},[R]);s.useEffect(()=>{const C=o.current;if(!C)return;const U=new ResizeObserver(()=>b(m=>m+1));return U.observe(C),()=>U.disconnect()},[]),s.useEffect(()=>{const C=o.current;if(!C)return;const U=new IntersectionObserver(m=>{const w=m[0];if(!w)return;const T=a.current;T&&(T.setVisible(w.isIntersecting),w.isIntersecting?T.isParked&&(T.restore(),b(k=>k+1)):T.park())},{threshold:0});return U.observe(C),()=>U.disconnect()},[]),s.useEffect(()=>{var m;if(!t||!f)return;const C=e.hdr;M.current=C;const U=lr(C);(m=a.current)==null||m.setSource(U),y(w=>w&&w.w===U.width&&w.h===U.height?w:{w:U.width,h:U.height}),_(w=>w+1),x(w=>w+1)},[t,f,t?e.hdr:null]),s.useEffect(()=>{if(t||!f)return;const C=e,U=C.imageUrl,m=C.colormap??"none";if(!U){S.current=null,y(null),_(T=>T+1);return}let w=!1;return Te(U).then(T=>{var G,F;if(w||!T)return;let k=T;if(m!=="none"){const H=`gpu::${U}::${m}`,$=ze(H);if($)k=$;else{const te=ut.has(m)?"positive":"linear";k=Ve(T,m,te),$e(H,k)}}S.current=T;const L={data:k.data,width:k.width,height:k.height,format:"rgba8unorm"};(G=a.current)==null||G.setSource(L),y(H=>H&&H.w===k.width&&H.h===k.height?H:{w:k.width,h:k.height}),(F=C.onNaturalSize)==null||F.call(C,k.width,k.height),_(H=>H+1),x(H=>H+1)}),()=>{w=!0}},[t,f,t?null:e.imageUrl,t?null:e.colormap]);const ie=t?e.exposure??0:0,de=t?e.tonemap:void 0,fe=t?e.gamma:void 0,oe=s.useCallback(()=>{const C=a.current;if(!C||!f||!v)return;const U=o.current,m=r.current,w=m?m.getBoundingClientRect():U?U.getBoundingClientRect():{width:v.w,height:v.h},T=Wt({zoom:O,pan:A},w,v.w,v.h);p(F=>F.x===T.x&&F.y===T.y&&F.w===T.w&&F.h===T.h?F:T),w.width>0&&w.height>0&&C.resize(Math.round(w.width*X),Math.round(w.height*X));const k=Xt(T,w,v.w,v.h)>=Qe?"nearest":"linear",L=T,G=t?{exposureEV:ie,operator:c.current?"extended":sr(de),gamma:fe,isScalar:!1,hdrOut:c.current,uv:L,filter:k}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:L,filter:k};try{C.render(G)||g(!0)}catch(F){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",F),g(!0)}},[f,v,O,A.x,A.y,ie,de,fe,t,X]);s.useEffect(()=>{oe()},[oe,l,h]);const me=rt({rootRef:o,canvasRef:n,zoom:O,pan:A,onViewportChange:R,naturalWidth:v==null?void 0:v.w,naturalHeight:v==null?void 0:v.h,requestRender:oe}),pe=s.useMemo(()=>({...tt,leadingButtons:B?[nt(D,I)]:[]}),[B,D]),be=s.useCallback((C,U,m)=>{if(t){const $=M.current,te=v;if(!$||!te||C<0||U<0||C>=te.w||U>=te.h)return null;const ne=$.shape.length===2?1:$.shape[2]??1,he=(U*te.w+C)*ne,we=$.data,Se=.5;return ne===1?{lines:[j(we[he]??0,"unit",m)],luminance:Se}:{lines:[j(we[he]??0,"unit",m),j(we[he+1]??0,"unit",m),j(we[he+2]??0,"unit",m)],luminance:Se,colors:[re[0],re[1],re[2]]}}const w=S.current;if(!w||C<0||U<0||C>=w.width||U>=w.height)return null;const T=(U*w.width+C)*4,k=w.data[T],L=w.data[T+1],G=w.data[T+2],F=(.299*k+.587*L+.114*G)/255;return W!=="none"||k===L&&L===G?{lines:[j(k,"uint8",m)],luminance:F}:{lines:[j(k,"uint8",m),j(L,"uint8",m),j(G,"uint8",m)],luminance:F,colors:[re[0],re[1],re[2]]}},[t,v,W]),ge=e.showAxes??!1,se=t?e.label??"":e.label,ce=e.interpolation??"auto",le=ce==="auto"?void 0:ce,Q=t?void 0:e.overlay,z=t?void 0:e.overlaySettings,Y=t?!1:e.isDraggable??!1,K=t?void 0:e.onDragStart;return d?t?i.jsx(ot,{...e}):i.jsx(ot,{...e}):i.jsxs("div",{className:"group relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":f,children:[i.jsx(et,{controller:me,config:pe}),i.jsxs("div",{ref:o,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded",style:{padding:ge&&v?"16px 4px 4px 28px":0,...Z.style},onPointerDown:Z.onPointerDown,onPointerMove:Z.onPointerMove,onPointerUp:Z.onPointerUp,onPointerCancel:Z.onPointerCancel,onDoubleClick:J,"data-gpu-image-viewport":!0,children:[i.jsxs("div",{ref:r,className:"relative w-full h-full flex items-center justify-center cairn-checkerboard",children:[i.jsx("canvas",{ref:n,className:"w-full h-full block",style:{imageRendering:le},"data-gpu-image-canvas":!0}),ge&&v&&i.jsx(vt,{naturalWidth:v.w,naturalHeight:v.h,zoom:O,containerRef:r}),Q&&(z==null?void 0:z.enabled)&&v&&((((ae=Q.boxes)==null?void 0:ae.length)??0)>0||(((ee=Q.masks)==null?void 0:ee.length)??0)>0)&&i.jsx(Ke,{data:Q,settings:z,naturalWidth:v.w,naturalHeight:v.h})]}),v&&i.jsx(ye,{imageElRef:n,naturalWidth:v.w,naturalHeight:v.h,zoom:O,pan:A,sourceWindow:E,sample:be,notation:D,version:u,onActiveChange:N})]}),se?i.jsx(wt,{label:se,isDraggable:Y,onDragStart:K}):null]})}const fr={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function hr({imageUrl:e,baselineUrl:t,mode:n,splitPosition:o,blendAlpha:r,onSplitPositionChange:a,zoom:c,pan:d,onViewportChange:g,processing:f=fr,interpolation:P="auto",label:v="",isDraggable:y=!1,onDragStart:l,overlay:x,overlaySettings:h,pixelValueNotation:b="decimal"}){var le,Q;const E=s.useRef(null),[p,M]=s.useState(null),[S,u]=s.useState(null),[_,D]=s.useState(b),[I,B]=s.useState(!1),N=s.useRef(null),O=s.useRef(null),A=s.useRef(null),R=s.useRef(null),[W,X]=s.useState(0);s.useEffect(()=>{if(!e){A.current=null,X(Y=>Y+1);return}let z=!1;return Te(e).then(Y=>{z||(A.current=Y,X(K=>K+1))}),()=>{z=!0}},[e]),s.useEffect(()=>{if(!t){R.current=null,X(Y=>Y+1);return}let z=!1;return Te(t).then(Y=>{z||(R.current=Y,X(K=>K+1))}),()=>{z=!0}},[t]);const Z=z=>(Y,K,ae)=>{const ee=z.current;if(!ee||Y<0||K<0||Y>=ee.width||K>=ee.height)return null;const C=(K*ee.width+Y)*4,U=ee.data[C],m=ee.data[C+1],w=ee.data[C+2],T=(.299*U+.587*m+.114*w)/255;return U===m&&m===w?{lines:[j(U,"uint8",ae)],luminance:T}:{lines:[j(U,"uint8",ae),j(m,"uint8",ae),j(w,"uint8",ae)],luminance:T,colors:[re[0],re[1],re[2]]}},J=s.useMemo(()=>Z(A),[]),ie=s.useMemo(()=>Z(R),[]),de=!!x&&!!(h!=null&&h.enabled)&&!!p&&!!e&&((((le=x.boxes)==null?void 0:le.length)??0)>0||(((Q=x.masks)==null?void 0:Q.length)??0)>0),{gammaFilterId:fe,filterStr:oe,gamma:me,offset:pe}=Rt(f),be=`translate(${d.x}px, ${d.y}px) scale(${c})`,ge=P==="auto"?void 0:P,{containerProps:se,modifierActive:ce}=De({containerRef:E,zoom:c,pan:d,onViewportChange:g});return i.jsxs("div",{className:"relative flex flex-col h-full",children:[i.jsx(Lt,{id:fe,gamma:me,offset:pe}),i.jsxs("div",{ref:E,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...se.style},onPointerDown:se.onPointerDown,onPointerMove:se.onPointerMove,onPointerUp:se.onPointerUp,onPointerCancel:se.onPointerCancel,children:[i.jsxs("div",{className:"relative w-full h-full",children:[i.jsxs("div",{className:"relative w-full h-full",style:{transform:be,transformOrigin:"0 0"},children:[i.jsx("img",{ref:N,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:oe,imageRendering:ge,...n==="blend"?{opacity:r}:{}},onLoad:z=>{const Y=z.currentTarget;M({w:Y.naturalWidth,h:Y.naturalHeight})}}),de&&i.jsx(Ke,{data:x,settings:h,naturalWidth:p.w,naturalHeight:p.h})]}),i.jsx("div",{className:"absolute inset-0 overflow-hidden",style:n==="split"?{clipPath:`inset(0 ${(1-o)*100}% 0 0)`}:void 0,children:i.jsx("div",{className:"w-full h-full",style:{transform:be,transformOrigin:"0 0"},children:i.jsx("img",{ref:O,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:oe,imageRendering:ge,...n==="blend"?{opacity:1-r}:{}},onLoad:z=>{const Y=z.currentTarget;u({w:Y.naturalWidth,h:Y.naturalHeight})}})})}),n==="split"&&i.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${o*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>a==null?void 0:a(.5),onPointerDown:z=>{z.stopPropagation(),z.preventDefault();const K=z.currentTarget.parentElement.getBoundingClientRect(),ae=C=>{a==null||a(Math.max(0,Math.min(1,(C.clientX-K.left)/K.width)))},ee=()=>{window.removeEventListener("pointermove",ae),window.removeEventListener("pointerup",ee)};window.addEventListener("pointermove",ae),window.addEventListener("pointerup",ee)},children:i.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?i.jsxs(i.Fragment,{children:[t&&S&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-o)*100}% 0 0)`},children:i.jsx(ye,{imageElRef:O,naturalWidth:S.w,naturalHeight:S.h,zoom:c,pan:d,sample:ie,notation:_,version:W})}),e&&p&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${o*100}%)`},children:i.jsx(ye,{imageElRef:N,naturalWidth:p.w,naturalHeight:p.h,zoom:c,pan:d,sample:J,notation:_,version:W,onActiveChange:B})})]}):e&&p&&i.jsx(ye,{imageElRef:N,naturalWidth:p.w,naturalHeight:p.h,zoom:c,pan:d,sample:J,notation:_,version:W,onActiveChange:B}),I&&i.jsx(_t,{notation:_,onChange:D})]}),i.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),i.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${y&&!ce?" cairn-drag-grip":""}`,draggable:y&&!ce,onDragStart:l,style:{cursor:y&&!ce?"grab":void 0},children:[i.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),v]})]})}const gr={zoom:1,pan:{x:0,y:0}};function mr(e){const t=Ne(e),n=new Float32Array(256*4);for(let o=0;o<256;o++)n[o*4+0]=t[o*3+0]/255,n[o*4+1]=t[o*3+1]/255,n[o*4+2]=t[o*3+2]/255,n[o*4+3]=1;return n}function pr({imageUrl:e,baselineUrl:t,mode:n,splitPosition:o,blendAlpha:r,onSplitPositionChange:a,diffSubmode:c,colormap:d="none",zoom:g,pan:f,onViewportChange:P,interpolation:v="auto",label:y="",pixelValueNotation:l="decimal"}){const x=s.useRef(null),h=s.useRef(null),b=s.useRef(null),[E,p]=s.useState(!1),[M,S]=s.useState(!1),[u,_]=s.useState(null),[D,I]=s.useState(0),[B,N]=s.useState(0),[O,A]=s.useState(null),[R,W]=s.useState(l),[X,Z]=s.useState(!1),[J,ie]=s.useState({x:0,y:0,w:1,h:1}),de=s.useRef(null),fe=s.useRef(null),[oe,me]=s.useState(0),pe=je();s.useEffect(()=>{const C=h.current;if(!C)return;let U=!1;return Ie().then(m=>{if(!U)try{if(At())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const w=m.createSurface(C,{hdr:!1});b.current={device:m,surface:w,texA:null,texB:null},S(!0)}catch(w){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",w),p(!0)}}).catch(m=>{U||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",m),p(!0))}),()=>{var w,T;U=!0;const m=b.current;m&&((w=m.texA)==null||w.destroy(),(T=m.texB)==null||T.destroy(),b.current=null)}},[]),s.useEffect(()=>{const C=x.current;if(!C)return;const U=new ResizeObserver(()=>N(m=>m+1));return U.observe(C),()=>U.disconnect()},[]),s.useEffect(()=>{if(!M)return;let C=!1;if(!b.current)return;async function m(w){return w?Te(w):null}return Promise.all([m(e),m(t)]).then(([w,T])=>{var F,H;if(C||!b.current)return;const k=b.current;de.current=w,fe.current=T,(F=k.texA)==null||F.destroy(),(H=k.texB)==null||H.destroy(),k.texA=null,k.texB=null;const L=w??T;if(!L){_(null),me($=>$+1);return}const G=$=>{const te=k.device.createTexture($.width,$.height,"rgba8unorm");return te.write($.data),te};k.texA=G(T??L),k.texB=G(w??L),_({w:L.width,h:L.height}),me($=>$+1),I($=>$+1)}),()=>{C=!0}},[M,e,t]);const be=s.useMemo(()=>(c??"").includes("signed")?"signed":"positive",[c]),ge=s.useMemo(()=>d!=="none"?mr(d):void 0,[d]),se=s.useCallback(()=>{const C=b.current;if(!M||!C||!C.surface||!C.texA||!C.texB||!u)return;const U=x.current,m=U?U.getBoundingClientRect():{width:u.w,height:u.h},w=Wt({zoom:g,pan:f},m,u.w,u.h);ie(F=>F.x===w.x&&F.y===w.y&&F.w===w.w&&F.h===w.h?F:w);const T=h.current;if(m.width>0&&m.height>0&&T&&C.surface){const F=Math.max(1,Math.round(m.width*pe)),H=Math.max(1,Math.round(m.height*pe));(T.width!==F||T.height!==H)&&(T.width=F,T.height=H,C.surface.configure(F,H))}const k=Xt(w,m,u.w,u.h)>=Qe?"nearest":"linear",G={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:w,filter:k,mode:n,split:o,alpha:r,diffSubmode:c??"absolute",diffCmapMode:be,diffColormap:n==="diff"?ge:void 0};try{On(C.device,C.surface,C.texA,C.texB,G)}catch(F){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",F),p(!0)}},[M,u,g,f.x,f.y,n,o,r,c,be,ge,pe]);s.useEffect(()=>{se()},[se,D,B]),s.useEffect(()=>{const C=b.current;if(!M||!C||!C.texA||!C.texB||!t){A(null);return}let U=!1;return Gn(C.device,C.texA,C.texB).then(m=>{U||A(m)}),()=>{U=!0}},[M,D,t]);const ce=C=>(U,m,w)=>{const T=C.current;if(!T||U<0||m<0||U>=T.width||m>=T.height)return null;const k=(m*T.width+U)*4,L=T.data[k],G=T.data[k+1],F=T.data[k+2],H=(.299*L+.587*G+.114*F)/255;return L===G&&G===F?{lines:[j(L,"uint8",w)],luminance:H}:{lines:[j(L,"uint8",w),j(G,"uint8",w),j(F,"uint8",w)],luminance:H,colors:[re[0],re[1],re[2]]}},le=s.useMemo(()=>ce(de),[]),Q=s.useMemo(()=>ce(fe),[]),{containerProps:z}=De({containerRef:x,zoom:g,pan:f,onViewportChange:P,naturalWidth:u==null?void 0:u.w,naturalHeight:u==null?void 0:u.h}),Y=s.useCallback(()=>P==null?void 0:P(gr),[P]),K=v==="auto"?void 0:v,ae=rt({rootRef:x,canvasRef:h,zoom:g,pan:f,onViewportChange:P,naturalWidth:u==null?void 0:u.w,naturalHeight:u==null?void 0:u.h,requestRender:se}),ee=s.useMemo(()=>({...tt,leadingButtons:X?[nt(R,W)]:[]}),[X,R]);return E?n==="diff"?i.jsx(ot,{imageUrl:e,baselineUrl:t,diffMode:c??"signed",interpolation:v,colormap:d,showAxes:!1,zoom:g,pan:f,onViewportChange:P,label:y,pixelValueNotation:l}):i.jsx(hr,{imageUrl:e,baselineUrl:t,mode:n,splitPosition:o,blendAlpha:r,onSplitPositionChange:a,zoom:g,pan:f,onViewportChange:P,interpolation:v,label:y,pixelValueNotation:l}):i.jsxs("div",{className:"group relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":M,children:[i.jsx(et,{controller:ae,config:ee}),i.jsxs("div",{ref:x,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...z.style},onPointerDown:z.onPointerDown,onPointerMove:z.onPointerMove,onPointerUp:z.onPointerUp,onPointerCancel:z.onPointerCancel,onDoubleClick:Y,"data-gpu-compare-viewport":!0,children:[i.jsxs("div",{className:"relative w-full h-full flex items-center justify-center",children:[i.jsx("canvas",{ref:h,className:"w-full h-full block",style:{imageRendering:K},"data-gpu-compare-canvas":!0}),n==="split"&&i.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${o*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:C=>{C.stopPropagation(),a==null||a(.5)},onPointerDown:C=>{C.stopPropagation(),C.preventDefault();const m=C.currentTarget.parentElement.getBoundingClientRect(),w=k=>{a==null||a(Math.max(0,Math.min(1,(k.clientX-m.left)/m.width)))},T=()=>{window.removeEventListener("pointermove",w),window.removeEventListener("pointerup",T)};window.addEventListener("pointermove",w),window.addEventListener("pointerup",T)},children:i.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?i.jsxs(i.Fragment,{children:[t&&u&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-o)*100}% 0 0)`},children:i.jsx(ye,{imageElRef:h,naturalWidth:u.w,naturalHeight:u.h,zoom:g,pan:f,sourceWindow:J,sample:Q,notation:R,version:oe})}),t&&u&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${o*100}%)`},children:i.jsx(ye,{imageElRef:h,naturalWidth:u.w,naturalHeight:u.h,zoom:g,pan:f,sourceWindow:J,sample:le,notation:R,version:oe,onActiveChange:Z})})]}):u&&i.jsx(ye,{imageElRef:h,naturalWidth:u.w,naturalHeight:u.h,zoom:g,pan:f,sourceWindow:J,sample:le,notation:R,version:oe,onActiveChange:Z})]}),i.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),y?i.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:y}):null,O&&i.jsxs("span",{className:"absolute right-1.5 top-9 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono","data-gpu-compare-metrics":!0,children:["MSE ",O.mse.toExponential(2)," · PSNR ",Number.isFinite(O.psnr)?O.psnr.toFixed(1):"∞"," dB · MAE"," ",O.mae.toExponential(2)]})]})}const br="cairn-plot:gpu-image-ready";async function vr(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Ie(),window.__cairnPlotGpuImagePane=dr,window.__cairnPlotGpuComparePane=pr,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(br))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}vr()})(__cairnPlotJsxRuntime,__cairnPlotReact);

var Fr=Object.defineProperty;var Br=(i,c,Pe)=>c in i?Fr(i,c,{enumerable:!0,configurable:!0,writable:!0,value:Pe}):i[c]=Pe;var q=(i,c,Pe)=>Br(i,typeof c!="symbol"?c+"":c,Pe);(function(i,c){"use strict";const Pe=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function ht(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"premultiplied",usage:Pe}),{hdr:!1,format:n}}function tn(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:Pe}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:Pe}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return ht(e,t)}}}const nn=`
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
`;function ze(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function gt(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function rn(e){const t=(e&32768)>>15,n=(e&31744)>>10,r=e&1023;let o;return n===0?o=r/1024*Math.pow(2,-14):n===31?o=r?NaN:1/0:o=(1+r/1024)*Math.pow(2,n-15),t?-o:o}const on={texture:0,sampler:1,uniform:2};function We(e,t){return e*3+on[t]}const an={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function sn(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let r;for(;(r=n.exec(e))!==null;){const o=Number(r[1]),a=r[2]!==void 0,s=r[3].trim();if(a){const h=an[s];if(h===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${s}" (binding ${o}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(o,{kind:"uniform",sizeBytes:h})}else s==="sampler"||s==="sampler_comparison"?t.set(o,{kind:"sampler"}):t.set(o,{kind:"texture"})}return t}class mt{constructor(t,n,r,o){q(this,"width");q(this,"height");q(this,"format");q(this,"gpuTexture");q(this,"device");q(this,"destroyed",!1);this.device=t,this.width=n,this.height=r,this.format=o,this.gpuTexture=t.createTexture({size:{width:n,height:r,depthOrArrayLayers:1},format:ze(o),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*gt(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class pt{constructor(t){q(this,"_s");q(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class cn{constructor(t,n,r,o,a){q(this,"_p");q(this,"gpuPipeline");q(this,"bindings");q(this,"bindGroupLayout");q(this,"variants");q(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=r,this.buildVariant=a,this.variants=new Map([[o,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function ln(e,t){const n=[];for(const[r,o]of t)o.kind==="uniform"?n.push({binding:r,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):o.kind==="sampler"?n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class un{constructor(t){q(this,"_c");q(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class dn{constructor(t,n){q(this,"_b");q(this,"gpuBindGroup");q(this,"ownedBuffers");q(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class fn{constructor(t,n,r,o){q(this,"canvas");q(this,"hdr");q(this,"format");q(this,"context");q(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=r.hdr,this.format=r.format,this.reconfigure=o}configure(t,n){this.canvas.width=t,this.canvas.height=n;const r=this.reconfigure();this.hdr=r.hdr,this.format=r.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function Re(e){return"canvas"in e}async function hn(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let r=null;function o(){return r||(r=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),r}function a(u){return Re(u)?u.getCurrentTextureView():u.gpuTexture.createView()}function s(u){if(Re(u))return{width:u.canvas.width,height:u.canvas.height};const y=u;return{width:y.width,height:y.height}}let h=!1;const g=256;let l=null,x=null;function p(){if(!l||!x){const u=t.createShaderModule({code:nn});x=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const y=t.createPipelineLayout({bindGroupLayouts:[x]});l=t.createComputePipeline({layout:y,compute:{module:u,entryPoint:"cs_main"}})}return{pipeline:l,layout:x}}return{backend:"webgpu",capabilities:n,createTexture(u,y,f){return new mt(t,u,y,f)},createSampler(u){const y=(u==null?void 0:u.filter)==="linear"?"linear":"nearest",f=t.createSampler({magFilter:y,minFilter:y,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new pt(f)},createRenderPipeline(u){const y=t.createShaderModule({code:u.shaderWGSL}),f=sn(u.shaderWGSL),b=ze(u.targetFormat),_=ln(t,f),v=t.createPipelineLayout({bindGroupLayouts:[_]}),P=d=>t.createRenderPipeline({layout:v,vertex:{module:y,entryPoint:"vs_main"},fragment:{module:y,entryPoint:"fs_main",targets:[{format:d}]},primitive:{topology:"triangle-list"}}),S=P(b);return new cn(S,f,_,b,P)},createComputePipeline(u){const y=t.createShaderModule({code:u.shaderWGSL}),f=t.createComputePipeline({layout:"auto",compute:{module:y,entryPoint:"cs_main"}});return new un(f)},createBindGroup(u,y){const f=u,b=new Map,_=[];for(const[P,S]of f.bindings)if(S.kind==="uniform"){const d=t.createBuffer({size:S.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});_.push(d),b.set(P,{binding:P,resource:{buffer:d}})}else S.kind==="sampler"&&b.set(P,{binding:P,resource:o()});for(const P of y){const S=P.resource;if(S instanceof mt){const d=We(P.binding,"texture");f.bindings.has(d)&&b.set(d,{binding:d,resource:S.gpuTexture.createView()})}else if(S instanceof pt){const d=We(P.binding,"sampler");f.bindings.has(d)&&b.set(d,{binding:d,resource:S.gpuSampler})}else{const d=We(P.binding,"uniform"),M=f.bindings.get(d);if(M&&M.kind==="uniform"){const D=S.uniform,I=t.createBuffer({size:Math.max(M.sizeBytes,D.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(I,0,D.buffer,D.byteOffset,D.byteLength),_.push(I),b.set(d,{binding:d,resource:{buffer:I}})}}}const v=t.createBindGroup({layout:f.bindGroupLayout,entries:Array.from(b.values())});return new dn(v,_)},createSurface(u,y){const f=u.getContext("webgpu");if(!f)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const b=y.hdr&&n.hdr,_=()=>b?tn(f,t):ht(f,t),v=_();return new fn(u,f,v,_)},renderFullscreen(u,y,f){const b=y,_=f,v=a(u),{width:P,height:S}=s(u),d=Re(u)?u.format:ze(u.format),M=b.pipelineFor(d),D=t.createCommandEncoder(),I=D.beginRenderPass({colorAttachments:[{view:v,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});I.setPipeline(M),I.setBindGroup(0,_.gpuBindGroup),I.setViewport(0,0,P,S,0,1),I.draw(3),I.end(),t.queue.submit([D.finish()])},async readback(u){const y=Re(u),{width:f,height:b}=s(u),_=y?u.hdr?"rgba16float":"rgba8unorm":u.format,v=y&&u.format==="bgra8unorm",P=y?u.getCurrentGPUTexture():u.gpuTexture,S=gt(_),d=f*S,M=256,D=Math.ceil(d/M)*M,I=D*b,B=t.createBuffer({size:I,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),N=t.createCommandEncoder();N.copyTextureToBuffer({texture:P},{buffer:B,bytesPerRow:D,rowsPerImage:b},{width:f,height:b,depthOrArrayLayers:1}),t.queue.submit([N.finish()]),await B.mapAsync(GPUMapMode.READ);const O=new Uint8Array(B.getMappedRange()),A=new Uint8Array(d*b);for(let R=0;R<b;R++){const X=R*D,$=R*d;A.set(O.subarray(X,X+d),$)}if(B.unmap(),B.destroy(),_==="rgba8unorm"){if(v)for(let R=0;R<A.length;R+=4){const X=A[R],$=A[R+2];A[R]=$,A[R+2]=X}return A}if(_==="rgba16float"){const R=new Uint16Array(A.buffer,A.byteOffset,A.byteLength/2),X=new Float32Array(R.length);for(let $=0;$<R.length;$++)X[$]=rn(R[$]);return X}return new Float32Array(A.buffer,A.byteOffset,A.byteLength/4)},async reduceDiffSumSquaredAbs(u,y,f,b){const _=u,v=y,P=Math.max(0,f*b),S=Math.max(1,Math.ceil(P/g)),{pipeline:d,layout:M}=p(),D=S*2*4,I=t.createBuffer({size:D,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),B=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(B,0,new Uint32Array([Math.max(1,f),Math.max(1,b),P,0]));const N=t.createBindGroup({layout:M,entries:[{binding:0,resource:_.gpuTexture.createView()},{binding:1,resource:v.gpuTexture.createView()},{binding:2,resource:{buffer:I}},{binding:3,resource:{buffer:B}}]}),O=t.createBuffer({size:D,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),A=t.createCommandEncoder(),R=A.beginComputePass();R.setPipeline(d),R.setBindGroup(0,N),R.dispatchWorkgroups(S),R.end(),A.copyBufferToBuffer(I,0,O,0,D),t.queue.submit([A.finish()]),await O.mapAsync(GPUMapMode.READ);const $=new Float32Array(O.getMappedRange()).slice();O.unmap(),O.destroy(),I.destroy(),B.destroy();let K=0,ee=0;for(let se=0;se<S;se++)K+=$[se*2],ee+=$[se*2+1];return{sumSq:K,sumAbs:ee}},destroy(){h||(t.destroy(),h=!0)},isContextLost(){return!1}}}let Xe=null;async function gn(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return hn()}function Le(){return Xe||(Xe=gn()),Xe}function mn(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function pn(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const o=n/255*(e.length-1),a=Math.floor(o),s=Math.min(a+1,e.length-1),h=o-a,[g,l,x]=mn(e[a],e[s],h);t[n*3]=Math.round(g),t[n*3+1]=Math.round(l),t[n*3+2]=Math.round(x)}return t}const vt={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},bt=new Set(["red-green","red-blue"]),wt=new Map;function $e(e){let t=wt.get(e);if(!t){const n=vt[e]??vt.viridis;t=pn(n),wt.set(e,t)}return t}function He(e,t,n="linear"){const r=$e(t),o=new ImageData(e.width,e.height),a=e.data,s=o.data;for(let h=0;h<a.length;h+=4){const g=(a[h]+a[h+1]+a[h+2])/3;let l;n==="positive"?l=Math.round(128+g/255*127):l=Math.round(g),l=Math.max(0,Math.min(255,l)),s[h]=r[l*3],s[h+1]=r[l*3+1],s[h+2]=r[l*3+2],s[h+3]=a[h+3]}return o}function xt(e){const t=new Map;return{get(n){return t.get(n)},set(n,r){if(t.size>=e){const o=t.keys().next().value;o!==void 0&&t.delete(o)}t.set(n,r)}}}const yt=xt(50);function Ye(e){return yt.get(e)}function qe(e,t){yt.set(e,t)}const Et=xt(100);function vn(e){return Et.get(e)}function bn(e,t){Et.set(e,t)}function wn(e,t,n){const r=Math.min(e.width,t.width),o=Math.min(e.height,t.height),a=new ImageData(r,o);for(let s=0;s<o;s++)for(let h=0;h<r;h++){const g=(s*e.width+h)*4,l=(s*t.width+h)*4,x=(s*r+h)*4;for(let p=0;p<3;p++){const E=e.data[g+p],u=t.data[l+p],y=E-u,f=Math.abs(y),b=Math.max(E,1);let _;switch(n){case"signed":_=(y+255)/2;break;case"absolute":_=f;break;case"squared":_=y*y/255;break;case"relative_signed":_=(y/b+1)*127.5;break;case"relative_absolute":_=f/b*255;break;case"relative_squared":_=y*y/(b*b)*255;break}a.data[x+p]=Math.min(255,Math.max(0,Math.round(_)))}a.data[x+3]=255}return a}async function ke(e){const t=vn(e);return t||new Promise(n=>{const r=new Image;r.onload=()=>{try{const o=document.createElement("canvas");o.width=r.naturalWidth,o.height=r.naturalHeight;const a=o.getContext("2d");if(!a){n(null);return}a.drawImage(r,0,0);const s=a.getImageData(0,0,o.width,o.height);bn(e,s),n(s)}catch(o){console.warn("[cairn] loadImageData failed:",o),n(null)}},r.onerror=o=>{console.warn("[cairn] loadImageData: image failed to load:",e,o),n(null)},r.src=e})}const xn={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},yn={linear:0,signed:1,positive:2},En=`#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`,_n=`#version 300 es
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
}`;let Ie=null,V=null,fe=null,Oe=null;function Mn(){if(V)return V;try{if(typeof OffscreenCanvas<"u"?Ie=new OffscreenCanvas(1,1):Ie=document.createElement("canvas"),V=Ie.getContext("webgl2",{preserveDrawingBuffer:!0}),!V)return console.warn("[cairn] WebGL 2 not available"),null;const e=V.createShader(V.VERTEX_SHADER);if(V.shaderSource(e,En),V.compileShader(e),!V.getShaderParameter(e,V.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",V.getShaderInfoLog(e)),null;const t=V.createShader(V.FRAGMENT_SHADER);if(V.shaderSource(t,_n),V.compileShader(t),!V.getShaderParameter(t,V.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",V.getShaderInfoLog(t)),null;if(fe=V.createProgram(),V.attachShader(fe,e),V.attachShader(fe,t),V.linkProgram(fe),!V.getProgramParameter(fe,V.LINK_STATUS))return console.error("[cairn] WebGL program link:",V.getProgramInfoLog(fe)),null;Oe=V.createVertexArray(),V.bindVertexArray(Oe);const n=V.createBuffer();V.bindBuffer(V.ARRAY_BUFFER,n),V.bufferData(V.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),V.STATIC_DRAW);const r=V.getAttribLocation(fe,"a_pos");return V.enableVertexAttribArray(r),V.vertexAttribPointer(r,2,V.FLOAT,!1,0,0),V.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),V}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function _t(e,t,n){const r=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),r}function Pn(e,t,n){const r=new Uint8Array(1024);for(let a=0;a<256;a++)r[a*4]=t[a*3],r[a*4+1]=t[a*3+1],r[a*4+2]=t[a*3+2],r[a*4+3]=255;const o=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,o),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,r),o}function Sn(e,t,n,r){const o=Mn();if(!o||!fe||!Oe||!Ie)return null;const a=Math.min(e.width,t.width),s=Math.min(e.height,t.height);Ie.width=a,Ie.height=s,o.viewport(0,0,a,s);const h=_t(o,e,0),g=_t(o,t,1);let l=null;n.colormap?l=Pn(o,n.colormap,2):(l=o.createTexture(),o.activeTexture(o.TEXTURE2),o.bindTexture(o.TEXTURE_2D,l),o.texImage2D(o.TEXTURE_2D,0,o.RGBA8,1,1,0,o.RGBA,o.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),o.useProgram(fe),o.uniform1i(o.getUniformLocation(fe,"u_baseline"),0),o.uniform1i(o.getUniformLocation(fe,"u_other"),1),o.uniform1i(o.getUniformLocation(fe,"u_lut"),2),o.uniform1i(o.getUniformLocation(fe,"u_diff_mode"),xn[n.diffMode]),o.uniform1i(o.getUniformLocation(fe,"u_cmap_mode"),yn[n.cmapMode]??0),o.uniform1i(o.getUniformLocation(fe,"u_use_colormap"),n.colormap?1:0),o.bindVertexArray(Oe),o.drawArrays(o.TRIANGLE_STRIP,0,4),o.bindVertexArray(null),r.width=a,r.height=s;const x=r.getContext("2d");return x&&(x.save(),x.scale(1,-1),x.drawImage(Ie,0,0,a,s,0,-s,a,s),x.restore()),o.deleteTexture(h),o.deleteTexture(g),o.deleteTexture(l),{width:a,height:s}}const Tn="cairn:render-mode";function Cn(){try{const e=localStorage.getItem(Tn);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const xe=e=>e<0?0:e>1?1:e,Ze=e=>{const t=e<0?0:e;return t/(1+t)},Ke=e=>{const t=e<0?0:e,n=t*(2.51*t+.03),r=t*(2.43*t+.59)+.14;return xe(n/r)},Mt={linear:([e,t,n])=>[xe(e),xe(t),xe(n)],srgb:([e,t,n])=>[xe(e),xe(t),xe(n)],reinhard:([e,t,n])=>[Ze(e),Ze(t),Ze(n)],aces:([e,t,n])=>[Ke(e),Ke(t),Ke(n)],extended:([e,t,n])=>[e,t,n]},An="srgb";function kn(e){return e&&Mt[e]||Mt[An]}function je(e,t){return e*2**t}function In(e){const t=xe(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function Qe(e,t){return typeof t=="number"&&t>0?xe(Math.pow(xe(e),1/t)):In(e)}const ye=new Uint32Array(512),Ee=new Uint32Array(512);for(let e=0;e<256;++e){const t=e-127;t<-27?(ye[e]=0,ye[e|256]=32768,Ee[e]=24,Ee[e|256]=24):t<-14?(ye[e]=1024>>-t-14,ye[e|256]=1024>>-t-14|32768,Ee[e]=-t-1,Ee[e|256]=-t-1):t<=15?(ye[e]=t+15<<10,ye[e|256]=t+15<<10|32768,Ee[e]=13,Ee[e|256]=13):t<128?(ye[e]=31744,ye[e|256]=64512,Ee[e]=24,Ee[e|256]=24):(ye[e]=31744,ye[e|256]=64512,Ee[e]=13,Ee[e|256]=13)}/*!
fflate - fast JavaScript compression/decompression
<https://101arrowz.github.io/fflate>
Licensed under MIT. https://github.com/101arrowz/fflate/blob/master/LICENSE
version 0.8.2
*/var De=Uint8Array,Pt=Uint16Array,Un=Int32Array,Dn=new De([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),Rn=new De([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),St=function(e,t){for(var n=new Pt(31),r=0;r<31;++r)n[r]=t+=1<<e[r-1];for(var o=new Un(n[30]),r=1;r<30;++r)for(var a=n[r];a<n[r+1];++a)o[a]=a-n[r]<<5|r;return{b:n,r:o}},Tt=St(Dn,2),Ln=Tt.b,On=Tt.r;Ln[28]=258,On[258]=28,St(Rn,0);for(var Gn=new Pt(32768),Z=0;Z<32768;++Z){var Se=(Z&43690)>>1|(Z&21845)<<1;Se=(Se&52428)>>2|(Se&13107)<<2,Se=(Se&61680)>>4|(Se&3855)<<4,Gn[Z]=((Se&65280)>>8|(Se&255)<<8)>>1}for(var Ge=new De(288),Z=0;Z<144;++Z)Ge[Z]=8;for(var Z=144;Z<256;++Z)Ge[Z]=9;for(var Z=256;Z<280;++Z)Ge[Z]=7;for(var Z=280;Z<288;++Z)Ge[Z]=8;for(var Fn=new De(32),Z=0;Z<32;++Z)Fn[Z]=5;var Bn=new De(0),Nn=typeof TextDecoder<"u"&&new TextDecoder,Vn=0;try{Nn.decode(Bn,{stream:!0}),Vn=1}catch{}function Ct(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function At({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:r}){const o=Ct(e),a=Ct(t),s=[];for(let v=0;v<=e;v+=o)s.push(v);const h=[];for(let v=0;v<=t;v+=a)h.push(v);const g=1/n,l=8*g,x=-12*g,p=-2*g,E=r==null?void 0:r.current;let u=0,y=0,f=0,b=0;if(E){const v=E.clientWidth,P=E.clientHeight,S=v/e,d=P/t,M=Math.min(S,d);f=e*M,b=t*M,u=(v-f)/2,y=(P-b)/2}const _=E&&f>0;return i.jsxs(i.Fragment,{children:[i.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:_?y:0,transform:`translateY(${x}px)`,fontSize:l},children:s.map(v=>i.jsx("span",{className:"mono",style:{position:"absolute",left:_?u+v/e*f:`${v/e*100}%`,transform:"translateX(-50%)"},children:v},v))}),i.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:_?u:0,transform:`translateX(${p}px)`,fontSize:l},children:h.map(v=>i.jsx("span",{className:"mono",style:{position:"absolute",top:_?y+v/t*b:`${v/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*g}px`},children:v},v))})]})}function kt({label:e,isDraggable:t,onDragStart:n}){return i.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&i.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const It=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function Je(e){const t=It.length;return It[(e%t+t)%t]}function zn(e){const n=c.useRef(null),[r,o]=c.useState({w:0,h:0}),a=c.useRef(null),s=c.useRef(null),h=c.useRef(null),g=c.useCallback((l,x)=>{o(p=>p.w===l&&p.h===x?p:{w:l,h:x})},[]);return c.useLayoutEffect(()=>{const l=n.current;if(!l||l===h.current)return;const x=l.getBoundingClientRect();(x.width>0||x.height>0)&&(h.current=l,g(x.width,x.height))}),c.useEffect(()=>{var p;const l=n.current;if(l===s.current||((p=a.current)==null||p.disconnect(),a.current=null,s.current=l,!l))return;const x=new ResizeObserver(E=>{for(const u of E)g(u.contentRect.width,u.contentRect.height)});a.current=x,x.observe(l)}),c.useEffect(()=>()=>{var l;return(l=a.current)==null?void 0:l.disconnect()},[]),{ref:n,size:r}}function Wn(){const[e,t]=c.useState(!1);return c.useEffect(()=>{const n=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!0)},r=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!1)},o=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",r),window.addEventListener("blur",o),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",r),window.removeEventListener("blur",o)}},[]),e}const Xn=.25,et=64;function Ut(e,t,n,r){if(e<=0||t<=0||n<=0||r<=0)return et;const o=Math.min(n/e,r/t);return o<=0?et:Math.max(Math.max(n,r)/o,8)}function Fe(e){const{containerRef:t,zoom:n,pan:r,onViewportChange:o,minZoom:a=Xn,maxZoom:s=et,naturalWidth:h,naturalHeight:g}=e,l=Wn(),x=c.useRef(l);x.current=l;const p=c.useRef({zoom:n,pan:r});p.current={zoom:n,pan:r};const E=c.useRef(o);E.current=o,c.useEffect(()=>{const v=t.current;if(!v||!o)return;const P=S=>{var X;if(!x.current)return;S.preventDefault(),S.stopPropagation();const d=S.deltaY<0?1.1:1/1.1,M=p.current,D=v.getBoundingClientRect(),I=h&&g?Ut(h,g,D.width,D.height):s,B=Math.max(a,Math.min(I,M.zoom*d));if(M.zoom===B)return;const N=S.clientX-D.left,O=S.clientY-D.top,A=N-(N-M.pan.x)/M.zoom*B,R=O-(O-M.pan.y)/M.zoom*B;(X=E.current)==null||X.call(E,{zoom:B,pan:{x:A,y:R}})};return v.addEventListener("wheel",P,{passive:!1}),()=>v.removeEventListener("wheel",P)},[t,!!o,a,s,h,g]);const u=c.useRef(null),y=c.useCallback(v=>{!x.current||!E.current||(v.currentTarget.setPointerCapture(v.pointerId),u.current={pointerId:v.pointerId,startX:v.clientX,startY:v.clientY,panX:p.current.pan.x,panY:p.current.pan.y})},[]),f=c.useCallback(v=>{var M;const P=u.current;if(!P||P.pointerId!==v.pointerId)return;const S=v.clientX-P.startX,d=v.clientY-P.startY;(M=E.current)==null||M.call(E,{zoom:p.current.zoom,pan:{x:P.panX+S,y:P.panY+d}})},[]),b=c.useCallback(v=>{const P=u.current;if(!(!P||P.pointerId!==v.pointerId)){try{v.currentTarget.releasePointerCapture(v.pointerId)}catch{}u.current=null}},[]),_=l&&!!o;return{containerProps:{onPointerDown:y,onPointerMove:f,onPointerUp:b,onPointerCancel:b,style:{cursor:_?"move":void 0,touchAction:_?"none":void 0}},modifierActive:l}}function tt(){const[e,t]=c.useState(()=>typeof window<"u"&&window.devicePixelRatio||1);return c.useEffect(()=>{if(typeof matchMedia>"u")return;let n=!1,r=null;const o=()=>{n||(t(window.devicePixelRatio||1),a())};function a(){if(n)return;const s=window.devicePixelRatio||1;r=matchMedia(`(resolution: ${s}dppx)`),r.addEventListener("change",o,{once:!0})}return a(),()=>{n=!0,r==null||r.removeEventListener("change",o)}},[]),e}function $n(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function Dt(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function nt({data:e,settings:t,naturalWidth:n,naturalHeight:r}){const{ref:o,size:a}=zn(),s=c.useRef(null),h=c.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),g=c.useMemo(()=>{const f=a.w,b=a.h;if(f<=0||b<=0||n<=0||r<=0)return null;const _=Math.min(f/n,b/r),v=n*_,P=r*_;return{left:(f-v)/2,top:(b-P)/2,width:v,height:P}},[a.w,a.h,n,r]),l=e.masks,x=t.showMasks&&!!l&&l.length>0,p=c.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(c.useEffect(()=>{if(!x||!l)return;const f=s.current;if(!f)return;(f.width!==n||f.height!==r)&&(f.width=n,f.height=r);const b=f.getContext("2d");if(!b)return;b.clearRect(0,0,f.width,f.height);let _=!1;const v=b.createImageData(n,r),P=v.data;let S=l.length,d=!1;const M=()=>{_||d&&b.putImageData(v,0,0)},D=document.createElement("canvas");D.width=n,D.height=r;const I=D.getContext("2d",{willReadFrequently:!0});for(const B of l){const N=new Image;N.onload=()=>{if(!_){if(I){I.clearRect(0,0,n,r),I.drawImage(N,0,0,n,r);const O=I.getImageData(0,0,n,r).data;for(let A=0;A<n*r;A++){const R=O[A*4];if(R===0||h.has(R))continue;const[X,$,K]=$n(Je(R));P[A*4]=X,P[A*4+1]=$,P[A*4+2]=K,P[A*4+3]=255,d=!0}}S-=1,S===0&&M()}},N.onerror=()=>{S-=1,S===0&&M()},N.src=`data:image/png;base64,${B.png_b64}`}return()=>{_=!0}},[x,l,n,r,p]),!g)return i.jsx("div",{ref:o,className:"absolute inset-0 pointer-events-none"});const E=e.boxes??[],u=t.showBoxes&&E.length>0,y=e.class_labels??{};return i.jsxs("div",{ref:o,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[x&&i.jsx("canvas",{ref:s,className:"absolute",style:{left:g.left,top:g.top,width:g.width,height:g.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),u&&i.jsx("svg",{className:"absolute",style:{left:g.left,top:g.top,width:g.width,height:g.height,overflow:"visible"},viewBox:`0 0 ${n} ${r}`,preserveAspectRatio:"none",children:E.map((f,b)=>{if(!Dt(f,t,h))return null;const _=f.domain==="pixel"?1:n,v=f.domain==="pixel"?1:r,P=f.position.minX*_,S=f.position.minY*v,d=(f.position.maxX-f.position.minX)*_,M=(f.position.maxY-f.position.minY)*v;return i.jsx("rect",{x:P,y:S,width:d,height:M,fill:"none",stroke:Je(f.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},b)})}),u&&i.jsx("div",{className:"absolute",style:{left:g.left,top:g.top,width:g.width,height:g.height},children:E.map((f,b)=>{if(!Dt(f,t,h))return null;const _=f.domain==="pixel"?1/n:1,v=f.domain==="pixel"?1/r:1,P=f.position.minX*_*100,S=f.position.minY*v*100,d=f.label??y[String(f.class_id)]??`#${f.class_id}`,M=f.score!=null?` ${(f.score*100).toFixed(0)}%`:"";return!d&&!M?null:i.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${P}%`,top:`${S}%`,transform:"translateY(-100%)",backgroundColor:Je(f.class_id)},children:i.jsxs("span",{className:"mono",children:[d,M]})},b)})})]})}const rt=30,oe=["#ff5a5a","#39d353","#5b9bff"];function ot(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function j(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):ot(e/255):ot(n==="int"?e*255:e)}const Hn={x:0,y:0,w:1,h:1};function Te({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:r,pan:o,sample:a,notation:s="decimal",version:h=0,onActiveChange:g,sourceWindow:l=Hn}){const x=c.useRef(null),p=c.useRef(!1),E=tt(),u=c.useRef(g);u.current=g;const y=c.useCallback(b=>{var _;b!==p.current&&(p.current=b,(_=u.current)==null||_.call(u,b))},[]),f=c.useCallback(()=>{var le;const b=x.current,_=e.current;if(!b)return;const v=window.devicePixelRatio||1,P=b.clientWidth,S=b.clientHeight;if(P===0||S===0)return;b.width!==Math.round(P*v)&&(b.width=Math.round(P*v)),b.height!==Math.round(S*v)&&(b.height=Math.round(S*v));const d=b.getContext("2d");if(!d)return;if(d.setTransform(v,0,0,v,0,0),d.clearRect(0,0,P,S),!_||t<=0||n<=0){y(!1);return}const M=_.getBoundingClientRect(),D=b.getBoundingClientRect();if(M.width===0||M.height===0){y(!1);return}const I=l.x*t,B=l.y*n,N=l.w*t,O=l.h*n;if(N<=0||O<=0){y(!1);return}const A=Math.min(M.width/N,M.height/O);if(A<rt){y(!1);return}const R=N*A,X=O*A,$=M.left+(M.width-R)/2-D.left,K=M.top+(M.height-X)/2-D.top,ee=Math.max(Math.floor(I),Math.floor(I+(0-$)/A)),se=Math.min(Math.ceil(I+N),Math.ceil(I+(P-$)/A)),he=Math.max(Math.floor(B),Math.floor(B+(0-K)/A)),ge=Math.min(Math.ceil(B+O),Math.ceil(B+(S-K)/A));if(se<=ee||ge<=he){y(!1);return}y(!0);const ae=$+(0-I)*A,ve=K+(0-B)*A,be=$+(t-I)*A,we=K+(n-B)*A;d.save(),d.beginPath(),d.rect(ae,ve,be-ae,we-ve),d.clip(),d.textAlign="center",d.textBaseline="middle",d.lineJoin="round";const pe=A*.14,ce=A-pe*2;for(let de=he;de<ge;de++)for(let J=ee;J<se;J++){if(J<0||de<0||J>=t||de>=n)continue;const z=a(J,de,s);if(!z||z.lines.length===0)continue;const Y=z.lines.length;let Q=1;for(const G of z.lines)G.length>Q&&(Q=G.length);const ie=ce/(Y*1.15),te=ce/(Q*.62)||ie,C=Math.min(ie,te,24);if(C<6)continue;const U=$+(J-I+.5)*A,m=K+(de-B+.5)*A,w=C*1.15,T=z.luminance<=.55,k=T?"#ffffff":"#000000";d.font=`${C}px ui-monospace, SFMono-Regular, Menlo, monospace`,d.lineWidth=Math.max(1.4,C*.16),d.strokeStyle=T?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let L=m-Y*w/2+w/2;for(let G=0;G<z.lines.length;G++){const F=z.lines[G];d.strokeText(F,U,L),d.fillStyle=((le=z.colors)==null?void 0:le[G])??k,d.fillText(F,U,L),L+=w}}d.restore()},[e,t,n,a,s,y,l]);return c.useEffect(()=>{f()},[f,r,o.x,o.y,h,s,l,E]),c.useEffect(()=>{const b=x.current;if(!b)return;const _=new ResizeObserver(()=>f());return _.observe(b),()=>_.disconnect()},[f]),i.jsx("canvas",{ref:x,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Rt({notation:e,onChange:t,className:n=""}){return i.jsx("button",{type:"button",onClick:r=>{r.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:r=>r.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const Yn=`
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
`,qn=`
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
`,Be={linear:0,srgb:1,reinhard:2,aces:3,extended:4},Lt=new WeakMap;function Zn(e,t){let n=Lt.get(e);n||(n=new Map,Lt.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:Yn,targetFormat:t}),n.set(t,r)),r}function Ot(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Gt(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const r=e.createTexture(256,1,"rgba32float");return r.write(t),r}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function Kn(e,t,n,r){var y;const o=Ot(t),a=Zn(e,o),s=Gt(e,r.isScalar?r.colormap:void 0),h=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,g=Be[r.operator]??Be.srgb,l=new Float32Array([r.exposureEV,g,h,r.isScalar?1:0]),x=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),p=new Float32Array([r.hdrOut?1:0]),E=new Float32Array([r.filter==="nearest"?0:1]);let u;try{u=e.createBindGroup(a,[{binding:0,resource:n},{binding:1,resource:s},{binding:2,resource:{uniform:l}},{binding:3,resource:{uniform:x}},{binding:4,resource:{uniform:p}},{binding:5,resource:{uniform:E}}]),e.renderFullscreen(t,a,u)}finally{(y=u==null?void 0:u.destroy)==null||y.call(u),s.destroy()}}const jn={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Qn={linear:0,signed:1,positive:2},Jn={split:0,blend:1,diff:2},Ft=new WeakMap;function er(e,t){let n=Ft.get(e);n||(n=new Map,Ft.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:qn,targetFormat:t}),n.set(t,r)),r}function tr(e,t,n,r,o){var v;const a=Ot(t),s=er(e,a),h=o.mode==="diff"&&!!o.diffColormap,g=o.isScalar?o.colormap:h?o.diffColormap:void 0,l=Gt(e,g),x=typeof o.gamma=="number"&&o.gamma>0?o.gamma:0,p=Be[o.operator]??Be.srgb,E=new Float32Array([o.exposureEV,p,x,o.isScalar?1:0]),u=new Float32Array([o.uv.x,o.uv.y,o.uv.w,o.uv.h]),y=new Float32Array([Jn[o.mode],o.split,o.alpha,jn[o.diffSubmode]??0]),f=new Float32Array([Qn[o.diffCmapMode??"linear"]??0,o.hdrOut?1:0,h?1:0,0]),b=new Float32Array([o.filter==="nearest"?0:1]);let _;try{_=e.createBindGroup(s,[{binding:0,resource:n},{binding:1,resource:r},{binding:2,resource:l},{binding:3,resource:{uniform:E}},{binding:4,resource:{uniform:u}},{binding:5,resource:{uniform:y}},{binding:6,resource:{uniform:f}},{binding:7,resource:{uniform:b}}]),e.renderFullscreen(t,s,_)}finally{(v=_==null?void 0:_.destroy)==null||v.call(_),l.destroy()}}function Bt(e,t,n){if(n<=0)return{mse:0,psnr:1/0,mae:0};const r=e/n,o=t/n,a=r<=0?1/0:10*Math.log10(1/r);return{mse:r,psnr:a,mae:o}}async function nr(e,t,n){const r=Math.min(t.width,n.width),o=Math.min(t.height,n.height),a=r*o*3;if(a<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:E,sumAbs:u}=await e.reduceDiffSumSquaredAbs(t,n,r,o);return Bt(E,u,a)}const s=await e.readback(t),h=await e.readback(n),g=s instanceof Uint8Array,l=h instanceof Uint8Array;let x=0,p=0;for(let E=0;E<o;E++)for(let u=0;u<r;u++){const y=(E*t.width+u)*4,f=(E*n.width+u)*4;for(let b=0;b<3;b++){const _=(s[y+b]??0)/(g?255:1),v=(h[f+b]??0)/(l?255:1),P=_-v;x+=P*P,p+=Math.abs(P)}}return Bt(x,p,a)}function Nt(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const rr=12,Ce=[];function Vt(e){const t=Ce.indexOf(e);t!==-1&&Ce.splice(t,1),Ce.push(e)}function or(e){const t=Ce.indexOf(e);t!==-1&&Ce.splice(t,1)}function Ne(e){e.parked||(or(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.parked=!0)}function zt(e){for(;Ce.length>rr;){const t=Ce.find(n=>n!==e&&!n.visible)??Ce.find(n=>n!==e);if(!t)break;Ne(t)}}function Wt(e){var o,a;if(e.disposed)return;if(Nt())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Vt(e),zt(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const n=e.backingWidth||((o=e.source)==null?void 0:o.width)||1,r=e.backingHeight||((a=e.source)==null?void 0:a.height)||1;if(e.canvas.width=n,e.canvas.height=r,e.surface.configure(n,r),e.source){const s=t.createTexture(e.source.width,e.source.height,e.source.format);s.write(e.source.data),e.srcTexture=s}e.parked=!1,Vt(e),zt(e)}function ar(e,t){if(e.disposed||!e.source)return!0;try{return Wt(e),!e.surface||!e.srcTexture?!1:(Kn(e.device,e.surface,e.srcTexture,t),!0)}catch(n){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Ne(e),!1}}function ir(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},resize(t,n){if(e.disposed)return;const r=Math.max(1,Math.round(t)),o=Math.max(1,Math.round(n));e.backingWidth===r&&e.backingHeight===o||(e.backingWidth=r,e.backingHeight=o,!e.parked&&e.surface&&(e.canvas.width=r,e.canvas.height=o,e.surface.configure(r,o)))},render(t){return ar(e,t)},park(){e.disposed||Ne(e)},restore(){e.disposed||!e.source||Wt(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Ne(e),e.source=null,e.disposed=!0)}}}async function sr(e,t){const n=await Le(),r={canvas:e,device:n,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return ir(r)}function Xt(e){e.dispose()}function cr(e,t){const{brightness:n,contrast:r,exposure:o,flipSign:a}=e;return[`url(#${t})`,`brightness(${(1+n)*Math.pow(2,o)})`,`contrast(${1+r})`,...a?["invert(1)"]:[]].join(" ")}function $t(e){const n=`cairn-gamma-${c.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:r,contrast:o,gamma:a,exposure:s,offset:h,flipSign:g}=e,l=c.useMemo(()=>cr(e,n),[n,r,o,s,g]);return{gammaFilterId:n,filterStr:l,gamma:a,offset:h}}function Ht({id:e,gamma:t,offset:n}){return i.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:i.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:i.jsxs("feComponentTransfer",{children:[i.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),i.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),i.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:n})]})})})}const lr=["fill","fill-opacity","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-linecap","stroke-linejoin","opacity","color","font","font-family","font-size","font-weight","font-style","text-anchor","dominant-baseline","visibility","display"];function Yt(e,t){const n=getComputedStyle(e),r=lr.map(g=>`${g}:${n.getPropertyValue(g)}`).join(";"),o=t.getAttribute("style");t.setAttribute("style",o?`${o};${r}`:r);const a=e.children,s=t.children,h=Math.min(a.length,s.length);for(let g=0;g<h;g++)Yt(a[g],s[g])}function at(e){let t=e;for(;t;){const n=getComputedStyle(t).backgroundColor;if(n&&n!=="transparent"&&!n.startsWith("rgba(0, 0, 0, 0)"))return n;t=t.parentElement}return"#ffffff"}function it(e){const t=(e==null?void 0:e.scale)??(typeof window<"u"&&window.devicePixelRatio||1);return Math.min(Math.max(t,1),3)}async function st(e,t,n,r,o){const a=document.createElement("canvas");a.width=Math.max(1,Math.round(e*n)),a.height=Math.max(1,Math.round(t*n));const s=a.getContext("2d");if(!s)throw new Error("plot-to-png: 2D canvas context unavailable");return s.scale(n,n),r&&(s.fillStyle=r,s.fillRect(0,0,e,t)),o(s),await new Promise((h,g)=>a.toBlob(l=>l?h(l):g(new Error("plot-to-png: toBlob returned null")),"image/png"))}function ur(e,t,n){const r=e.cloneNode(!0);Yt(e,r),r.setAttribute("width",String(t)),r.setAttribute("height",String(n)),r.setAttribute("xmlns","http://www.w3.org/2000/svg");const o=new XMLSerializer().serializeToString(r),a="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(o);return new Promise((s,h)=>{const g=new Image;g.onload=()=>s(g),g.onerror=()=>h(new Error("plot-to-png: SVG rasterization failed")),g.src=a})}async function qt(e,t){const n=e.getBoundingClientRect(),r=n.width||e.width,o=n.height||e.height,a=(t==null?void 0:t.background)??at(e);return st(r,o,it(t),a,s=>s.drawImage(e,0,0,r,o))}async function dr(e,t){const n=e.getBoundingClientRect(),r=n.width||e.naturalWidth||e.width,o=n.height||e.naturalHeight||e.height,a=(t==null?void 0:t.background)??at(e);try{return await st(r,o,it(t),a,s=>s.drawImage(e,0,0,r,o))}catch(s){throw new Error(`plot-to-png: cannot export <img> — the image source appears to be cross-origin (tainted canvas). Same-document data:/blob: images export fine. (${s instanceof Error?s.message:String(s)})`)}}function fr(e){const t=Array.from(e.querySelectorAll("img"));let n=null,r=0;for(const o of t){const a=o.getBoundingClientRect(),s=a.width*a.height;s>r&&(r=s,n=o)}return n}async function hr(e,t){const n=e.querySelector("svg"),r=Array.from(e.querySelectorAll("canvas")),o=e.getBoundingClientRect(),a=o.width||300,s=o.height||150,h=(t==null?void 0:t.background)??at(e);if(n){const l=n.getBoundingClientRect(),x=await ur(n,l.width||a,l.height||s);return st(a,s,it(t),h,p=>{for(const E of r){const u=E.getBoundingClientRect();p.drawImage(E,u.left-o.left,u.top-o.top,u.width,u.height)}p.drawImage(x,l.left-o.left,l.top-o.top,l.width,l.height)})}if(r.length)return qt(r[0],t);const g=fr(e);if(g)return dr(g,t);throw new Error("plot-to-png: no <svg>, <canvas>, or <img> found under root")}function gr(e,t){const n=URL.createObjectURL(e),r=document.createElement("a");r.href=n,r.download=t.endsWith(".png")?t:`${t}.png`,document.body.appendChild(r),r.click(),r.remove(),setTimeout(()=>URL.revokeObjectURL(n),1e3)}const mr={"top-right":{top:6,right:6},"top-left":{top:6,left:6},"bottom-right":{bottom:6,right:6},"bottom-left":{bottom:6,left:6}},pr={boxZoom:i.jsx("rect",{x:"3.5",y:"3.5",width:"17",height:"17",rx:"1.5",strokeDasharray:"4 3"}),select:i.jsxs(i.Fragment,{children:[i.jsx("rect",{x:"3",y:"3",width:"11",height:"11",rx:"1",strokeDasharray:"3 2.5"}),i.jsx("path",{d:"M12 12l8.5 3.3-3.4 1-1 3.4z",fill:"currentColor",stroke:"currentColor",strokeWidth:"1",strokeLinejoin:"round"})]}),lasso:i.jsxs(i.Fragment,{children:[i.jsx("path",{d:"M12 4c4.4 0 7.3 2.9 6.6 6.4-0.7 3.5-4.9 5.3-8.8 4.5C6.4 14.2 4.6 11.4 5.7 8.7 6.8 6 9.2 4 12 4z"}),i.jsx("path",{d:"M8.7 15.2c-1.3 0.9-1.8 2.3-1.2 3.5"}),i.jsx("circle",{cx:"7.7",cy:"19.6",r:"1.05",fill:"currentColor",stroke:"none"})]}),pan:i.jsxs(i.Fragment,{children:[i.jsx("path",{d:"M12 2v20M2 12h20"}),i.jsx("path",{d:"M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"})]}),zoomIn:i.jsxs(i.Fragment,{children:[i.jsx("circle",{cx:"10.5",cy:"10.5",r:"7"}),i.jsx("path",{d:"M21 21l-5.2-5.2M10.5 7.5v6M7.5 10.5h6"})]}),zoomOut:i.jsxs(i.Fragment,{children:[i.jsx("circle",{cx:"10.5",cy:"10.5",r:"7"}),i.jsx("path",{d:"M21 21l-5.2-5.2M7.5 10.5h6"})]}),autoscale:i.jsx("path",{d:"M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"}),home:i.jsx("path",{d:"M3 11l9-8 9 8M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5M9.5 21v-6h5v6"}),camera:i.jsxs(i.Fragment,{children:[i.jsx("path",{d:"M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"}),i.jsx("circle",{cx:"12",cy:"13.5",r:"3.3"})]})};function vr({name:e}){return i.jsx("svg",{viewBox:"0 0 24 24",width:"13",height:"13",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:pr[e]??null})}function _e({icon:e,label:t,title:n,active:r,disabled:o,onClick:a}){return i.jsx("button",{type:"button",disabled:o,onClick:s=>{s.stopPropagation(),!o&&a()},onPointerDown:s=>s.stopPropagation(),onDoubleClick:s=>s.stopPropagation(),"aria-label":n,"aria-pressed":r,"aria-disabled":o,title:n,className:["h-[22px] min-w-[22px] inline-flex items-center justify-center rounded",t?"px-1.5 text-[10px] font-mono":"text-xs",o?"opacity-40 cursor-default text-fg-muted":r?"bg-bg-hover text-accent":"text-fg-muted hover:text-fg hover:bg-bg-hover"].join(" "),children:t?i.jsx("span",{"aria-hidden":"true",children:t}):i.jsx(vr,{name:e??""})})}function Ve(){return i.jsx("span",{"aria-hidden":"true",className:"mx-0.5 h-3.5 w-px bg-border"})}function ct({controller:e,config:t}){if((t==null?void 0:t.enabled)===!1)return null;const n=e.capabilities,r=t==null?void 0:t.buttons,o=(u,y)=>y&&(r==null?void 0:r[u])!==!1,a=u=>()=>e.setDragMode(u),s=o("zoom",n.zoom)||o("pan",n.pan)||o("select",n.select)||o("lasso",n.lasso),h=o("zoomIn",n.zoom)||o("zoomOut",n.zoom),g=o("autoscale",n.autoscale)||o("reset",n.reset),l=o("screenshot",n.screenshot),x=(t==null?void 0:t.leadingButtons)??[];if(!x.length&&!s&&!h&&!g&&!l)return null;const p=(t==null?void 0:t.position)??"top-right",E=(t==null?void 0:t.visibility)==="always";return i.jsxs("div",{style:{position:"absolute",pointerEvents:"auto",...mr[p]},className:["z-20 flex items-center gap-0.5 rounded border border-border","bg-bg-elevated/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-opacity",E?"opacity-100":"opacity-0 group-hover:opacity-100"].join(" "),role:"toolbar","aria-label":"Plot controls",children:[x.length>0&&i.jsxs(i.Fragment,{children:[x.map(u=>i.jsx(_e,{icon:u.icon,label:u.label,title:u.title,active:u.active,disabled:u.disabled,onClick:u.onClick},u.id)),(s||h||g||l)&&i.jsx(Ve,{})]}),s&&i.jsxs(i.Fragment,{children:[o("zoom",n.zoom)&&i.jsx(_e,{icon:"boxZoom",title:"Box zoom",active:e.dragMode==="zoom",onClick:a("zoom")}),o("pan",n.pan)&&i.jsx(_e,{icon:"pan",title:"Pan",active:e.dragMode==="pan",onClick:a("pan")}),o("select",n.select)&&i.jsx(_e,{icon:"select",title:"Box select",active:e.dragMode==="select",onClick:a("select")}),o("lasso",n.lasso)&&i.jsx(_e,{icon:"lasso",title:"Lasso select",active:e.dragMode==="lasso",onClick:a("lasso")})]}),h&&i.jsxs(i.Fragment,{children:[s&&i.jsx(Ve,{}),o("zoomIn",n.zoom)&&i.jsx(_e,{icon:"zoomIn",title:"Zoom in",onClick:()=>e.zoomIn()}),o("zoomOut",n.zoom)&&i.jsx(_e,{icon:"zoomOut",title:"Zoom out",onClick:()=>e.zoomOut()})]}),g&&i.jsxs(i.Fragment,{children:[(s||h)&&i.jsx(Ve,{}),o("autoscale",n.autoscale)&&i.jsx(_e,{icon:"autoscale",title:"Autoscale",onClick:()=>e.autoscale()}),o("reset",n.reset)&&i.jsx(_e,{icon:"home",title:e.isModified?"Reset view":"Reset view (at home)",disabled:!e.isModified,onClick:()=>e.reset()})]}),l&&i.jsxs(i.Fragment,{children:[(s||h||g)&&i.jsx(Ve,{}),i.jsx(_e,{icon:"camera",title:"Download plot as PNG",onClick:()=>{e.toPNG({filename:"plot"}).then(u=>gr(u,"plot.png")).catch(()=>{})}})]})]})}const br={zoom:1,pan:{x:0,y:0}},Zt=1.3,wr=.25,xr=64,lt={buttons:{zoom:!1}};function ut(e,t){return{id:"notation",label:e==="int"?"0–255":"0–1",title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",onClick:()=>t(e==="int"?"decimal":"int")}}function dt({rootRef:e,canvasRef:t,zoom:n,pan:r,onViewportChange:o,naturalWidth:a,naturalHeight:s,minZoom:h=wr,maxZoom:g=xr,requestRender:l}){const x=c.useCallback(S=>{var X;if(!o)return;const d=(X=e.current)==null?void 0:X.getBoundingClientRect(),M=(d==null?void 0:d.width)??0,D=(d==null?void 0:d.height)??0,I=a&&s&&M>0&&D>0?Ut(a,s,M,D):g,B=Math.max(h,Math.min(I,n*S));if(B===n)return;const N=M/2,O=D/2,A=N-(N-r.x)/n*B,R=O-(O-r.y)/n*B;o({zoom:B,pan:{x:A,y:R}})},[o,e,a,s,g,h,n,r.x,r.y]),p=c.useCallback(()=>x(Zt),[x]),E=c.useCallback(()=>x(1/Zt),[x]),u=c.useCallback(()=>o==null?void 0:o(br),[o]),y=c.useCallback(S=>{const d={scale:S==null?void 0:S.scale,filename:S==null?void 0:S.filename};l==null||l();const M=t==null?void 0:t.current;if(M)return qt(M,d);const D=e.current;return D?hr(D,d):Promise.reject(new Error("useImageController.toPNG: no canvas or root element to export"))},[t,e,l]),f=c.useMemo(()=>({zoom:!0,pan:!0,autoscale:!0,reset:!0,screenshot:!0,boxZoom:!1,select:!1,lasso:!1,hover:!1,spikelines:!1,hoverModes:!1,legend:!1,axisScaleToggle:!1,perAxisDrag:!1,brush:!1,reorder:!1}),[]),b=n!==1||r.x!==0||r.y!==0,_=c.useCallback(S=>{},[]),v=c.useCallback(S=>{},[]),P=c.useCallback(()=>{},[]);return c.useMemo(()=>({capabilities:f,dragMode:"pan",hoverMode:"closest",spikelines:!1,isModified:b,setDragMode:_,setHoverMode:v,toggleSpikelines:P,zoomIn:p,zoomOut:E,autoscale:u,reset:u,toPNG:y}),[f,b,_,v,P,p,E,u,y])}function Kt(e){return"hdr"in e&&e.hdr!=null}function jt(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`cairn-plot image: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function ue(e){return Number.isFinite(e)?e:0}const yr={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1},Er={zoom:1,pan:{x:0,y:0}};function _r(e,t,n,r){const{h:o,w:a,c:s}=jt(e.shape),h=e.data,g=kn(t),l=new Uint8ClampedArray(a*o*4);for(let x=0;x<a*o;x++){const p=x*s;let E,u,y,f=1;s===1?E=u=y=ue(h[p]):s===3?(E=ue(h[p]),u=ue(h[p+1]),y=ue(h[p+2])):(E=ue(h[p]),u=ue(h[p+1]),y=ue(h[p+2]),f=ue(h[p+3]));const b=[je(E,n),je(u,n),je(y,n)],[_,v,P]=g(b),S=x*4;l[S]=255*Qe(_,r),l[S+1]=255*Qe(v,r),l[S+2]=255*Qe(P,r),l[S+3]=255*(f<0?0:f>1?1:f)}return new ImageData(l,a,o)}function Qt({zoom:e,pan:t,onViewportChange:n,showAxes:r,naturalDims:o,label:a,showLabelChip:s,isDraggable:h=!1,onDragStart:g,toolbar:l,notationSeed:x,sample:p,pixelDataVersion:E,displayElRef:u,exportCanvasRef:y,hasPixelSource:f,header:b,overlayNode:_,children:v}){const P=c.useRef(null),S=c.useRef(null),[d,M]=c.useState(x),[D,I]=c.useState(!1),B=`translate(${t.x}px, ${t.y}px) scale(${e})`,{containerProps:N}=Fe({containerRef:P,zoom:e,pan:t,onViewportChange:n,naturalWidth:o==null?void 0:o.w,naturalHeight:o==null?void 0:o.h}),O=c.useCallback(()=>{n==null||n(Er)},[n]),A=dt({rootRef:P,canvasRef:y,zoom:e,pan:t,onViewportChange:n,naturalWidth:o==null?void 0:o.w,naturalHeight:o==null?void 0:o.h}),R=c.useMemo(()=>({...lt,leadingButtons:D?[ut(d,M)]:[]}),[D,d]);return i.jsxs("div",{className:`relative flex flex-col h-full${l?" group":""}`,"data-cpu-image-pane":!0,children:[b,l&&i.jsx(ct,{controller:A,config:R}),i.jsxs("div",{ref:P,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:r&&o?"16px 4px 4px 28px":"4px",...N.style},onPointerDown:N.onPointerDown,onPointerMove:N.onPointerMove,onPointerUp:N.onPointerUp,onPointerCancel:N.onPointerCancel,onDoubleClick:O,"data-cpu-image-viewport":!0,children:[i.jsxs("div",{ref:S,className:"relative w-full h-full",style:{transform:B,transformOrigin:"0 0"},children:[v,r&&o&&i.jsx(At,{naturalWidth:o.w,naturalHeight:o.h,zoom:e,containerRef:S}),_]}),f&&o&&i.jsx(Te,{imageElRef:u,naturalWidth:o.w,naturalHeight:o.h,zoom:e,pan:t,sample:p,notation:d,version:E,onActiveChange:I}),!l&&D&&i.jsx(Rt,{notation:d,onChange:M})]}),s&&i.jsx(kt,{label:a,isDraggable:h,onDragStart:g})]})}function Mr(e){var C,U;const{imageUrl:t,baselineUrl:n=null,isBaseline:r=!1,diffMode:o="none",interpolation:a="auto",colormap:s="none",showAxes:h=!1,processing:g=yr,zoom:l=1,pan:x={x:0,y:0},onViewportChange:p,onNaturalSize:E,label:u,isDraggable:y=!1,onDragStart:f,overlay:b,overlaySettings:_,pixelValueNotation:v="decimal",toolbar:P=!0}=e,S=c.useRef(null),d=c.useRef(null),M=c.useRef(null),D=c.useRef(null),I=c.useRef(null),[B,N]=c.useState(0),O=c.useCallback(()=>N(m=>m+1),[]),A=c.useMemo(()=>({get current(){const m=M.current;return m instanceof HTMLCanvasElement?m:null}}),[]),R=c.useCallback(m=>{S.current=m,m&&(M.current=m)},[]),X=c.useCallback(m=>{d.current=m,m&&(M.current=m)},[]),$=c.useCallback(m=>{m&&(M.current=m)},[]),[K,ee]=c.useState(!1),[se,he]=c.useState(!1),[ge,ae]=c.useState(null),{flipSign:ve}=g,{gammaFilterId:be,filterStr:we,gamma:pe,offset:ce}=$t(g),le=!r&&o!=="none"&&n!=null&&t!=null,de=o!=="none"&&n!=null,J=s!=="none"&&!le&&!(r&&de)&&t!=null;c.useEffect(()=>{if(!J||!t){he(!1);return}let m=!1;he(!1);const w=`${t}::${s}`,T=Ye(w);if(T){const L=d.current;if(L){L.width=T.width,L.height=T.height;const G=L.getContext("2d");G&&G.putImageData(T,0,0),I.current=T,O(),ae({w:T.width,h:T.height}),E==null||E(T.width,T.height),he(!0)}return}const k=new Image;return k.onload=()=>{if(m)return;const L=document.createElement("canvas");L.width=k.naturalWidth,L.height=k.naturalHeight;const G=L.getContext("2d");if(!G)return;G.drawImage(k,0,0);const F=G.getImageData(0,0,L.width,L.height),H=bt.has(s)?"positive":"linear",W=He(F,s,H);qe(w,W);const ne=d.current;if(!ne||m)return;ne.width=W.width,ne.height=W.height;const re=ne.getContext("2d");re&&re.putImageData(W,0,0),I.current=W,O(),ae({w:W.width,h:W.height}),E==null||E(W.width,W.height),he(!0)},k.src=t,()=>{m=!0}},[J,t,s]);const z=c.useCallback((m,w)=>{ae(T=>T&&T.w===m&&T.h===w?T:{w:m,h:w}),E==null||E(m,w)},[]);c.useEffect(()=>{if(!t){D.current=null,I.current=null,O();return}let m=!1;return ke(t).then(w=>{m||(D.current=w,s==="none"&&(I.current=w),O())}),()=>{m=!0}},[t,s,O]);const Y=c.useCallback((m,w,T)=>{const k=D.current;if(!k||m<0||w<0||m>=k.width||w>=k.height)return null;const L=(w*k.width+m)*4,G=k.data[L],F=k.data[L+1],H=k.data[L+2],W=I.current;let ne=G,re=F,me=H;if(W&&W.width===k.width&&W.height===k.height){const Ue=(w*W.width+m)*4;ne=W.data[Ue],re=W.data[Ue+1],me=W.data[Ue+2]}const Me=(.299*ne+.587*re+.114*me)/255;return s!=="none"||G===F&&F===H?{lines:[j(G,"uint8",T)],luminance:Me}:{lines:[j(G,"uint8",T),j(F,"uint8",T),j(H,"uint8",T)],luminance:Me,colors:[oe[0],oe[1],oe[2]]}},[s]);c.useEffect(()=>{if(!le){ee(!1);return}let m=!1;const w=Cn(),T=w==="gpu"||w==="auto",k=`${n}::${t}::${o}::${s}`;if(w!=="gpu"){const L=Ye(k);if(L){const G=S.current;if(G){(G.width!==L.width||G.height!==L.height)&&(G.width=L.width,G.height=L.height);const F=G.getContext("2d");F&&F.putImageData(L,0,0),z(L.width,L.height),ee(!0)}return}}return(async()=>{const[L,G]=await Promise.all([ke(n),ke(t)]);if(m||!L||!G)return;const H=o.includes("signed")?"signed":"positive",W=s!=="none"?$e(s):null,ne={diffMode:o,colormap:W,cmapMode:H};if(T)try{const Ae=S.current;if(Ae){const Ue=Sn(L,G,ne,Ae);if(Ue){if(m)return;z(Ue.width,Ue.height),ee(!0);return}}}catch(Ae){console.warn("[cairn] WebGL 2 diff error:",Ae)}if(w==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let re=wn(L,G,o);s!=="none"&&(re=He(re,s,H)),qe(k,re);const me=S.current;if(!me||m)return;(me.width!==re.width||me.height!==re.height)&&(me.width=re.width,me.height=re.height);const Me=me.getContext("2d");Me&&Me.putImageData(re,0,0),z(re.width,re.height),ee(!0)})(),()=>{m=!0}},[n,t,o,le,s,E]);const Q=a==="auto"?void 0:a,ie=ve?{filter:"invert(1)"}:{},te=b&&(_!=null&&_.enabled)&&ge&&t&&((((C=b.boxes)==null?void 0:C.length)??0)>0||(((U=b.masks)==null?void 0:U.length)??0)>0)?i.jsx(nt,{data:b,settings:_,naturalWidth:ge.w,naturalHeight:ge.h}):void 0;return i.jsx(Qt,{zoom:l,pan:x,onViewportChange:p,showAxes:h,naturalDims:ge,label:u,showLabelChip:!0,isDraggable:y,onDragStart:f,toolbar:P,notationSeed:v,sample:Y,pixelDataVersion:B,displayElRef:M,exportCanvasRef:A,hasPixelSource:!!t,header:i.jsx(Ht,{id:be,gamma:pe,offset:ce}),overlayNode:te,children:t?le?i.jsxs(i.Fragment,{children:[!K&&i.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),i.jsx("canvas",{ref:R,className:"w-full h-full object-contain block",style:{display:K?"block":"none",imageRendering:Q,...ie}})]}):J?i.jsxs(i.Fragment,{children:[!se&&i.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),i.jsx("canvas",{ref:X,className:"w-full h-full object-contain block",style:{display:se?"block":"none",imageRendering:Q,...ie}})]}):i.jsx("img",{ref:$,src:t,alt:u,className:"w-full h-full object-contain block",draggable:!1,style:{filter:we,imageRendering:Q},onLoad:m=>{const w=m.currentTarget;ae({w:w.naturalWidth,h:w.naturalHeight}),E==null||E(w.naturalWidth,w.naturalHeight)}}):i.jsx("span",{className:"text-xs text-fg-muted",children:"no image"})})}function Pr(e){const{hdr:t,tonemap:n="srgb",exposure:r=0,gamma:o,showAxes:a=!1,label:s="",interpolation:h="auto",zoom:g=1,pan:l={x:0,y:0},onViewportChange:x,pixelValueNotation:p="decimal",toolbar:E=!0}=e,u=c.useRef(null),[y,f]=c.useState(null),b=c.useRef(null),[_,v]=c.useState(0);c.useEffect(()=>{const d=u.current;if(!d)return;let M;try{M=_r(t,n,r,o)}catch(I){console.error("[cairn] HDR tone-map error:",I);return}(d.width!==M.width||d.height!==M.height)&&(d.width=M.width,d.height=M.height);const D=d.getContext("2d");D&&(D.putImageData(M,0,0),b.current=M,v(I=>I+1),f(I=>I&&I.w===M.width&&I.h===M.height?I:{w:M.width,h:M.height}))},[t,n,r,o]);const P=c.useCallback((d,M,D)=>{const I=y;if(!I||d<0||M<0||d>=I.w||M>=I.h)return null;const B=t.shape.length===2?1:t.shape[2]??1,N=(M*I.w+d)*B,O=t.data,A=b.current;let R=.5;if(A&&A.width===I.w&&A.height===I.h){const X=(M*I.w+d)*4;R=(.299*A.data[X]+.587*A.data[X+1]+.114*A.data[X+2])/255}return B===1?{lines:[j(O[N]??0,"unit",D)],luminance:R}:{lines:[j(O[N]??0,"unit",D),j(O[N+1]??0,"unit",D),j(O[N+2]??0,"unit",D)],luminance:R,colors:[oe[0],oe[1],oe[2]]}},[t,y]),S=h==="auto"?void 0:h;return i.jsx(Qt,{zoom:g,pan:l,onViewportChange:x,showAxes:a,naturalDims:y,label:s,showLabelChip:!!s,toolbar:E,notationSeed:p,sample:P,pixelDataVersion:_,displayElRef:u,exportCanvasRef:u,hasPixelSource:!0,children:i.jsx("canvas",{ref:u,className:"w-full h-full object-contain block",style:{imageRendering:S}})})}function ft(e){return Kt(e)?i.jsx(Pr,{...e}):i.jsx(Mr,{...e})}const Sr=["linear","srgb","reinhard","aces"];function Tr(e){return e&&Sr.includes(e)?e:"srgb"}function Cr(e){const{h:t,w:n,c:r}=jt(e.shape),o=e.data,a=new Float32Array(n*t*4);for(let s=0;s<n*t;s++){const h=s*r;let g,l,x,p=1;r===1?g=l=x=ue(o[h]):r===3?(g=ue(o[h]),l=ue(o[h+1]),x=ue(o[h+2])):(g=ue(o[h]),l=ue(o[h+1]),x=ue(o[h+2]),p=ue(o[h+3]));const E=s*4;a[E]=g,a[E+1]=l,a[E+2]=x,a[E+3]=p}return{data:a,width:n,height:t,format:"rgba32float"}}function Jt(e,t,n,r){if(n<=0||r<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const o=Math.min(t.width/n,t.height/r),a=n*o,s=r*o,h=(t.width-a)/2,g=(t.height-s)/2,l=Math.max(e.zoom,1e-6),x=t.width/(l*a),p=t.height/(l*s),E=-h/a-e.pan.x/(l*a),u=-g/s-e.pan.y/(l*s);return{x:E,y:u,w:x,h:p}}function en(e,t,n,r){const o=e.w*n,a=e.h*r;return o<=0||a<=0||t.width<=0||t.height<=0?0:Math.min(t.width/o,t.height/a)}const Ar={zoom:1,pan:{x:0,y:0}};function kr(e){var ie,te;const t=Kt(e),n=c.useRef(null),r=c.useRef(null),o=c.useRef(null),a=c.useRef(null),s=c.useRef(!1),[h,g]=c.useState(!1),[l,x]=c.useState(!1),[p,E]=c.useState(null),[u,y]=c.useState(0),[f,b]=c.useState(0),[_,v]=c.useState({x:0,y:0,w:1,h:1}),P=c.useRef(null),S=c.useRef(null),[d,M]=c.useState(0),[D,I]=c.useState(e.pixelValueNotation??"decimal"),[B,N]=c.useState(!1),O=e.zoom??1,A=e.pan??{x:0,y:0},R=e.onViewportChange,X=t?"none":e.colormap??"none",$=tt();c.useEffect(()=>{const C=n.current;if(!C)return;let U=!1;return Le().then(m=>{if(U)return;const w=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,T=m.capabilities.hdr&&w&&t;s.current=T,sr(C,{hdr:T}).then(k=>{if(U){Xt(k);return}a.current=k,x(!0)}).catch(k=>{U||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",k),g(!0))})}).catch(m=>{U||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",m),g(!0))}),()=>{U=!0,a.current&&(Xt(a.current),a.current=null)}},[]);const{containerProps:K}=Fe({containerRef:r,zoom:O,pan:A,onViewportChange:R,naturalWidth:p==null?void 0:p.w,naturalHeight:p==null?void 0:p.h}),ee=c.useCallback(()=>{R==null||R(Ar)},[R]);c.useEffect(()=>{const C=r.current;if(!C)return;const U=new ResizeObserver(()=>b(m=>m+1));return U.observe(C),()=>U.disconnect()},[]),c.useEffect(()=>{const C=r.current;if(!C)return;const U=new IntersectionObserver(m=>{const w=m[0];if(!w)return;const T=a.current;T&&(T.setVisible(w.isIntersecting),w.isIntersecting?T.isParked&&(T.restore(),b(k=>k+1)):T.park())},{threshold:0});return U.observe(C),()=>U.disconnect()},[]),c.useEffect(()=>{var m;if(!t||!l)return;const C=e.hdr;P.current=C;const U=Cr(C);(m=a.current)==null||m.setSource(U),E(w=>w&&w.w===U.width&&w.h===U.height?w:{w:U.width,h:U.height}),M(w=>w+1),y(w=>w+1)},[t,l,t?e.hdr:null]),c.useEffect(()=>{if(t||!l)return;const C=e,U=C.imageUrl,m=C.colormap??"none";if(!U){S.current=null,E(null),M(T=>T+1);return}let w=!1;return ke(U).then(T=>{var G,F;if(w||!T)return;let k=T;if(m!=="none"){const H=`gpu::${U}::${m}`,W=Ye(H);if(W)k=W;else{const ne=bt.has(m)?"positive":"linear";k=He(T,m,ne),qe(H,k)}}S.current=T;const L={data:k.data,width:k.width,height:k.height,format:"rgba8unorm"};(G=a.current)==null||G.setSource(L),E(H=>H&&H.w===k.width&&H.h===k.height?H:{w:k.width,h:k.height}),(F=C.onNaturalSize)==null||F.call(C,k.width,k.height),M(H=>H+1),y(H=>H+1)}),()=>{w=!0}},[t,l,t?null:e.imageUrl,t?null:e.colormap]);const se=t?e.exposure??0:0,he=t?e.tonemap:void 0,ge=t?e.gamma:void 0,ae=c.useCallback(()=>{const C=a.current;if(!C||!l||!p)return;const U=r.current,m=o.current,w=m?m.getBoundingClientRect():U?U.getBoundingClientRect():{width:p.w,height:p.h},T=Jt({zoom:O,pan:A},w,p.w,p.h);v(F=>F.x===T.x&&F.y===T.y&&F.w===T.w&&F.h===T.h?F:T),w.width>0&&w.height>0&&C.resize(Math.round(w.width*$),Math.round(w.height*$));const k=en(T,w,p.w,p.h)>=rt?"nearest":"linear",L=T,G=t?{exposureEV:se,operator:s.current?"extended":Tr(he),gamma:ge,isScalar:!1,hdrOut:s.current,uv:L,filter:k}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:L,filter:k};try{C.render(G)||g(!0)}catch(F){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",F),g(!0)}},[l,p,O,A.x,A.y,se,he,ge,t,$]);c.useEffect(()=>{ae()},[ae,u,f]);const ve=dt({rootRef:r,canvasRef:n,zoom:O,pan:A,onViewportChange:R,naturalWidth:p==null?void 0:p.w,naturalHeight:p==null?void 0:p.h,requestRender:ae}),be=c.useMemo(()=>({...lt,leadingButtons:B?[ut(D,I)]:[]}),[B,D]),we=c.useCallback((C,U,m)=>{if(t){const W=P.current,ne=p;if(!W||!ne||C<0||U<0||C>=ne.w||U>=ne.h)return null;const re=W.shape.length===2?1:W.shape[2]??1,me=(U*ne.w+C)*re,Me=W.data,Ae=.5;return re===1?{lines:[j(Me[me]??0,"unit",m)],luminance:Ae}:{lines:[j(Me[me]??0,"unit",m),j(Me[me+1]??0,"unit",m),j(Me[me+2]??0,"unit",m)],luminance:Ae,colors:[oe[0],oe[1],oe[2]]}}const w=S.current;if(!w||C<0||U<0||C>=w.width||U>=w.height)return null;const T=(U*w.width+C)*4,k=w.data[T],L=w.data[T+1],G=w.data[T+2],F=(.299*k+.587*L+.114*G)/255;return X!=="none"||k===L&&L===G?{lines:[j(k,"uint8",m)],luminance:F}:{lines:[j(k,"uint8",m),j(L,"uint8",m),j(G,"uint8",m)],luminance:F,colors:[oe[0],oe[1],oe[2]]}},[t,p,X]),pe=e.showAxes??!1,ce=t?e.label??"":e.label,le=e.interpolation??"auto",de=le==="auto"?void 0:le,J=t?void 0:e.overlay,z=t?void 0:e.overlaySettings,Y=t?!1:e.isDraggable??!1,Q=t?void 0:e.onDragStart;return h?t?i.jsx(ft,{...e}):i.jsx(ft,{...e}):i.jsxs("div",{className:"group relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":l,children:[i.jsx(ct,{controller:ve,config:be}),i.jsxs("div",{ref:r,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded",style:{padding:pe&&p?"16px 4px 4px 28px":0,...K.style},onPointerDown:K.onPointerDown,onPointerMove:K.onPointerMove,onPointerUp:K.onPointerUp,onPointerCancel:K.onPointerCancel,onDoubleClick:ee,"data-gpu-image-viewport":!0,children:[i.jsxs("div",{ref:o,className:"relative w-full h-full flex items-center justify-center cairn-checkerboard",children:[i.jsx("canvas",{ref:n,className:"w-full h-full block",style:{imageRendering:de},"data-gpu-image-canvas":!0}),pe&&p&&i.jsx(At,{naturalWidth:p.w,naturalHeight:p.h,zoom:O,containerRef:o}),J&&(z==null?void 0:z.enabled)&&p&&((((ie=J.boxes)==null?void 0:ie.length)??0)>0||(((te=J.masks)==null?void 0:te.length)??0)>0)&&i.jsx(nt,{data:J,settings:z,naturalWidth:p.w,naturalHeight:p.h})]}),p&&i.jsx(Te,{imageElRef:n,naturalWidth:p.w,naturalHeight:p.h,zoom:O,pan:A,sourceWindow:_,sample:we,notation:D,version:d,onActiveChange:N})]}),ce?i.jsx(kt,{label:ce,isDraggable:Y,onDragStart:Q}):null]})}const Ir={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function Ur({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:o,onSplitPositionChange:a,zoom:s,pan:h,onViewportChange:g,processing:l=Ir,interpolation:x="auto",label:p="",isDraggable:E=!1,onDragStart:u,overlay:y,overlaySettings:f,pixelValueNotation:b="decimal"}){var de,J;const _=c.useRef(null),[v,P]=c.useState(null),[S,d]=c.useState(null),[M,D]=c.useState(b),[I,B]=c.useState(!1),N=c.useRef(null),O=c.useRef(null),A=c.useRef(null),R=c.useRef(null),[X,$]=c.useState(0);c.useEffect(()=>{if(!e){A.current=null,$(Y=>Y+1);return}let z=!1;return ke(e).then(Y=>{z||(A.current=Y,$(Q=>Q+1))}),()=>{z=!0}},[e]),c.useEffect(()=>{if(!t){R.current=null,$(Y=>Y+1);return}let z=!1;return ke(t).then(Y=>{z||(R.current=Y,$(Q=>Q+1))}),()=>{z=!0}},[t]);const K=z=>(Y,Q,ie)=>{const te=z.current;if(!te||Y<0||Q<0||Y>=te.width||Q>=te.height)return null;const C=(Q*te.width+Y)*4,U=te.data[C],m=te.data[C+1],w=te.data[C+2],T=(.299*U+.587*m+.114*w)/255;return U===m&&m===w?{lines:[j(U,"uint8",ie)],luminance:T}:{lines:[j(U,"uint8",ie),j(m,"uint8",ie),j(w,"uint8",ie)],luminance:T,colors:[oe[0],oe[1],oe[2]]}},ee=c.useMemo(()=>K(A),[]),se=c.useMemo(()=>K(R),[]),he=!!y&&!!(f!=null&&f.enabled)&&!!v&&!!e&&((((de=y.boxes)==null?void 0:de.length)??0)>0||(((J=y.masks)==null?void 0:J.length)??0)>0),{gammaFilterId:ge,filterStr:ae,gamma:ve,offset:be}=$t(l),we=`translate(${h.x}px, ${h.y}px) scale(${s})`,pe=x==="auto"?void 0:x,{containerProps:ce,modifierActive:le}=Fe({containerRef:_,zoom:s,pan:h,onViewportChange:g});return i.jsxs("div",{className:"relative flex flex-col h-full",children:[i.jsx(Ht,{id:ge,gamma:ve,offset:be}),i.jsxs("div",{ref:_,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...ce.style},onPointerDown:ce.onPointerDown,onPointerMove:ce.onPointerMove,onPointerUp:ce.onPointerUp,onPointerCancel:ce.onPointerCancel,children:[i.jsxs("div",{className:"relative w-full h-full",children:[i.jsxs("div",{className:"relative w-full h-full",style:{transform:we,transformOrigin:"0 0"},children:[i.jsx("img",{ref:N,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:ae,imageRendering:pe,...n==="blend"?{opacity:o}:{}},onLoad:z=>{const Y=z.currentTarget;P({w:Y.naturalWidth,h:Y.naturalHeight})}}),he&&i.jsx(nt,{data:y,settings:f,naturalWidth:v.w,naturalHeight:v.h})]}),i.jsx("div",{className:"absolute inset-0 overflow-hidden",style:n==="split"?{clipPath:`inset(0 ${(1-r)*100}% 0 0)`}:void 0,children:i.jsx("div",{className:"w-full h-full",style:{transform:we,transformOrigin:"0 0"},children:i.jsx("img",{ref:O,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:ae,imageRendering:pe,...n==="blend"?{opacity:1-o}:{}},onLoad:z=>{const Y=z.currentTarget;d({w:Y.naturalWidth,h:Y.naturalHeight})}})})}),n==="split"&&i.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>a==null?void 0:a(.5),onPointerDown:z=>{z.stopPropagation(),z.preventDefault();const Q=z.currentTarget.parentElement.getBoundingClientRect(),ie=C=>{a==null||a(Math.max(0,Math.min(1,(C.clientX-Q.left)/Q.width)))},te=()=>{window.removeEventListener("pointermove",ie),window.removeEventListener("pointerup",te)};window.addEventListener("pointermove",ie),window.addEventListener("pointerup",te)},children:i.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?i.jsxs(i.Fragment,{children:[t&&S&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:i.jsx(Te,{imageElRef:O,naturalWidth:S.w,naturalHeight:S.h,zoom:s,pan:h,sample:se,notation:M,version:X})}),e&&v&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:i.jsx(Te,{imageElRef:N,naturalWidth:v.w,naturalHeight:v.h,zoom:s,pan:h,sample:ee,notation:M,version:X,onActiveChange:B})})]}):e&&v&&i.jsx(Te,{imageElRef:N,naturalWidth:v.w,naturalHeight:v.h,zoom:s,pan:h,sample:ee,notation:M,version:X,onActiveChange:B}),I&&i.jsx(Rt,{notation:M,onChange:D})]}),i.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),i.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${E&&!le?" cairn-drag-grip":""}`,draggable:E&&!le,onDragStart:u,style:{cursor:E&&!le?"grab":void 0},children:[i.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),p]})]})}const Dr={zoom:1,pan:{x:0,y:0}};function Rr(e){const t=$e(e),n=new Float32Array(256*4);for(let r=0;r<256;r++)n[r*4+0]=t[r*3+0]/255,n[r*4+1]=t[r*3+1]/255,n[r*4+2]=t[r*3+2]/255,n[r*4+3]=1;return n}function Lr({imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:o,onSplitPositionChange:a,diffSubmode:s,colormap:h="none",zoom:g,pan:l,onViewportChange:x,interpolation:p="auto",label:E="",pixelValueNotation:u="decimal"}){const y=c.useRef(null),f=c.useRef(null),b=c.useRef(null),[_,v]=c.useState(!1),[P,S]=c.useState(!1),[d,M]=c.useState(null),[D,I]=c.useState(0),[B,N]=c.useState(0),[O,A]=c.useState(null),[R,X]=c.useState(u),[$,K]=c.useState(!1),[ee,se]=c.useState({x:0,y:0,w:1,h:1}),he=c.useRef(null),ge=c.useRef(null),[ae,ve]=c.useState(0),be=tt();c.useEffect(()=>{const C=f.current;if(!C)return;let U=!1;return Le().then(m=>{if(!U)try{if(Nt())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const w=m.createSurface(C,{hdr:!1});b.current={device:m,surface:w,texA:null,texB:null},S(!0)}catch(w){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",w),v(!0)}}).catch(m=>{U||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",m),v(!0))}),()=>{var w,T;U=!0;const m=b.current;m&&((w=m.texA)==null||w.destroy(),(T=m.texB)==null||T.destroy(),b.current=null)}},[]),c.useEffect(()=>{const C=y.current;if(!C)return;const U=new ResizeObserver(()=>N(m=>m+1));return U.observe(C),()=>U.disconnect()},[]),c.useEffect(()=>{if(!P)return;let C=!1;if(!b.current)return;async function m(w){return w?ke(w):null}return Promise.all([m(e),m(t)]).then(([w,T])=>{var F,H;if(C||!b.current)return;const k=b.current;he.current=w,ge.current=T,(F=k.texA)==null||F.destroy(),(H=k.texB)==null||H.destroy(),k.texA=null,k.texB=null;const L=w??T;if(!L){M(null),ve(W=>W+1);return}const G=W=>{const ne=k.device.createTexture(W.width,W.height,"rgba8unorm");return ne.write(W.data),ne};k.texA=G(T??L),k.texB=G(w??L),M({w:L.width,h:L.height}),ve(W=>W+1),I(W=>W+1)}),()=>{C=!0}},[P,e,t]);const we=c.useMemo(()=>(s??"").includes("signed")?"signed":"positive",[s]),pe=c.useMemo(()=>h!=="none"?Rr(h):void 0,[h]),ce=c.useCallback(()=>{const C=b.current;if(!P||!C||!C.surface||!C.texA||!C.texB||!d)return;const U=y.current,m=U?U.getBoundingClientRect():{width:d.w,height:d.h},w=Jt({zoom:g,pan:l},m,d.w,d.h);se(F=>F.x===w.x&&F.y===w.y&&F.w===w.w&&F.h===w.h?F:w);const T=f.current;if(m.width>0&&m.height>0&&T&&C.surface){const F=Math.max(1,Math.round(m.width*be)),H=Math.max(1,Math.round(m.height*be));(T.width!==F||T.height!==H)&&(T.width=F,T.height=H,C.surface.configure(F,H))}const k=en(w,m,d.w,d.h)>=rt?"nearest":"linear",G={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:w,filter:k,mode:n,split:r,alpha:o,diffSubmode:s??"absolute",diffCmapMode:we,diffColormap:n==="diff"?pe:void 0};try{tr(C.device,C.surface,C.texA,C.texB,G)}catch(F){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",F),v(!0)}},[P,d,g,l.x,l.y,n,r,o,s,we,pe,be]);c.useEffect(()=>{ce()},[ce,D,B]),c.useEffect(()=>{const C=b.current;if(!P||!C||!C.texA||!C.texB||!t){A(null);return}let U=!1;return nr(C.device,C.texA,C.texB).then(m=>{U||A(m)}),()=>{U=!0}},[P,D,t]);const le=C=>(U,m,w)=>{const T=C.current;if(!T||U<0||m<0||U>=T.width||m>=T.height)return null;const k=(m*T.width+U)*4,L=T.data[k],G=T.data[k+1],F=T.data[k+2],H=(.299*L+.587*G+.114*F)/255;return L===G&&G===F?{lines:[j(L,"uint8",w)],luminance:H}:{lines:[j(L,"uint8",w),j(G,"uint8",w),j(F,"uint8",w)],luminance:H,colors:[oe[0],oe[1],oe[2]]}},de=c.useMemo(()=>le(he),[]),J=c.useMemo(()=>le(ge),[]),{containerProps:z}=Fe({containerRef:y,zoom:g,pan:l,onViewportChange:x,naturalWidth:d==null?void 0:d.w,naturalHeight:d==null?void 0:d.h}),Y=c.useCallback(()=>x==null?void 0:x(Dr),[x]),Q=p==="auto"?void 0:p,ie=dt({rootRef:y,canvasRef:f,zoom:g,pan:l,onViewportChange:x,naturalWidth:d==null?void 0:d.w,naturalHeight:d==null?void 0:d.h,requestRender:ce}),te=c.useMemo(()=>({...lt,leadingButtons:$?[ut(R,X)]:[]}),[$,R]);return _?n==="diff"?i.jsx(ft,{imageUrl:e,baselineUrl:t,diffMode:s??"signed",interpolation:p,colormap:h,showAxes:!1,zoom:g,pan:l,onViewportChange:x,label:E,pixelValueNotation:u}):i.jsx(Ur,{imageUrl:e,baselineUrl:t,mode:n,splitPosition:r,blendAlpha:o,onSplitPositionChange:a,zoom:g,pan:l,onViewportChange:x,interpolation:p,label:E,pixelValueNotation:u}):i.jsxs("div",{className:"group relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":P,children:[i.jsx(ct,{controller:ie,config:te}),i.jsxs("div",{ref:y,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...z.style},onPointerDown:z.onPointerDown,onPointerMove:z.onPointerMove,onPointerUp:z.onPointerUp,onPointerCancel:z.onPointerCancel,onDoubleClick:Y,"data-gpu-compare-viewport":!0,children:[i.jsxs("div",{className:"relative w-full h-full flex items-center justify-center",children:[i.jsx("canvas",{ref:f,className:"w-full h-full block",style:{imageRendering:Q},"data-gpu-compare-canvas":!0}),n==="split"&&i.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${r*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:C=>{C.stopPropagation(),a==null||a(.5)},onPointerDown:C=>{C.stopPropagation(),C.preventDefault();const m=C.currentTarget.parentElement.getBoundingClientRect(),w=k=>{a==null||a(Math.max(0,Math.min(1,(k.clientX-m.left)/m.width)))},T=()=>{window.removeEventListener("pointermove",w),window.removeEventListener("pointerup",T)};window.addEventListener("pointermove",w),window.addEventListener("pointerup",T)},children:i.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?i.jsxs(i.Fragment,{children:[t&&d&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-r)*100}% 0 0)`},children:i.jsx(Te,{imageElRef:f,naturalWidth:d.w,naturalHeight:d.h,zoom:g,pan:l,sourceWindow:ee,sample:J,notation:R,version:ae})}),t&&d&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${r*100}%)`},children:i.jsx(Te,{imageElRef:f,naturalWidth:d.w,naturalHeight:d.h,zoom:g,pan:l,sourceWindow:ee,sample:de,notation:R,version:ae,onActiveChange:K})})]}):d&&i.jsx(Te,{imageElRef:f,naturalWidth:d.w,naturalHeight:d.h,zoom:g,pan:l,sourceWindow:ee,sample:de,notation:R,version:ae,onActiveChange:K})]}),i.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),E?i.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:E}):null,O&&i.jsxs("span",{className:"absolute right-1.5 top-9 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono","data-gpu-compare-metrics":!0,children:["MSE ",O.mse.toExponential(2)," · PSNR ",Number.isFinite(O.psnr)?O.psnr.toFixed(1):"∞"," dB · MAE"," ",O.mae.toExponential(2)]})]})}const Or="cairn-plot:gpu-image-ready";async function Gr(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Le(),window.__cairnPlotGpuImagePane=kr,window.__cairnPlotGpuComparePane=Lr,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(Or))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}Gr()})(__cairnPlotJsxRuntime,__cairnPlotReact);

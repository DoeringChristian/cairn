var wr=Object.defineProperty;var xr=(i,c,Ee)=>c in i?wr(i,c,{enumerable:!0,configurable:!0,writable:!0,value:Ee}):i[c]=Ee;var q=(i,c,Ee)=>xr(i,typeof c!="symbol"?c+"":c,Ee);(function(i,c){"use strict";const Ee=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function st(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"premultiplied",usage:Ee}),{hdr:!1,format:n}}function Ht(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"premultiplied",usage:Ee}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"premultiplied",usage:Ee}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return st(e,t)}}}const Yt=`
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
`;function Re(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function ct(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function qt(e){const t=(e&32768)>>15,n=(e&31744)>>10,o=e&1023;let r;return n===0?r=o/1024*Math.pow(2,-14):n===31?r=o?NaN:1/0:r=(1+o/1024)*Math.pow(2,n-15),t?-r:r}const Zt={texture:0,sampler:1,uniform:2};function Ge(e,t){return e*3+Zt[t]}const Kt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function jt(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let o;for(;(o=n.exec(e))!==null;){const r=Number(o[1]),a=o[2]!==void 0,s=o[3].trim();if(a){const f=Kt[s];if(f===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${s}" (binding ${r}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(r,{kind:"uniform",sizeBytes:f})}else s==="sampler"||s==="sampler_comparison"?t.set(r,{kind:"sampler"}):t.set(r,{kind:"texture"})}return t}class lt{constructor(t,n,o,r){q(this,"width");q(this,"height");q(this,"format");q(this,"gpuTexture");q(this,"device");q(this,"destroyed",!1);this.device=t,this.width=n,this.height=o,this.format=r,this.gpuTexture=t.createTexture({size:{width:n,height:o,depthOrArrayLayers:1},format:Re(r),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*ct(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class ut{constructor(t){q(this,"_s");q(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class Qt{constructor(t,n,o,r,a){q(this,"_p");q(this,"gpuPipeline");q(this,"bindings");q(this,"bindGroupLayout");q(this,"variants");q(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=o,this.buildVariant=a,this.variants=new Map([[r,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function Jt(e,t){const n=[];for(const[o,r]of t)r.kind==="uniform"?n.push({binding:o,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):r.kind==="sampler"?n.push({binding:o,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:o,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class en{constructor(t){q(this,"_c");q(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class tn{constructor(t,n){q(this,"_b");q(this,"gpuBindGroup");q(this,"ownedBuffers");q(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class nn{constructor(t,n,o,r){q(this,"canvas");q(this,"hdr");q(this,"format");q(this,"context");q(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=o.hdr,this.format=o.format,this.reconfigure=r}configure(t,n){this.canvas.width=t,this.canvas.height=n;const o=this.reconfigure();this.hdr=o.hdr,this.format=o.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function ke(e){return"canvas"in e}async function rn(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let o=null;function r(){return o||(o=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),o}function a(l){return ke(l)?l.getCurrentTextureView():l.gpuTexture.createView()}function s(l){if(ke(l))return{width:l.canvas.width,height:l.canvas.height};const x=l;return{width:x.width,height:x.height}}let f=!1;const g=256;let d=null,P=null;function v(){if(!d||!P){const l=t.createShaderModule({code:Yt});P=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});const x=t.createPipelineLayout({bindGroupLayouts:[P]});d=t.createComputePipeline({layout:x,compute:{module:l,entryPoint:"cs_main"}})}return{pipeline:d,layout:P}}return{backend:"webgpu",capabilities:n,createTexture(l,x,h){return new lt(t,l,x,h)},createSampler(l){const x=(l==null?void 0:l.filter)==="linear"?"linear":"nearest",h=t.createSampler({magFilter:x,minFilter:x,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new ut(h)},createRenderPipeline(l){const x=t.createShaderModule({code:l.shaderWGSL}),h=jt(l.shaderWGSL),b=Re(l.targetFormat),E=Jt(t,h),p=t.createPipelineLayout({bindGroupLayouts:[E]}),M=u=>t.createRenderPipeline({layout:p,vertex:{module:x,entryPoint:"vs_main"},fragment:{module:x,entryPoint:"fs_main",targets:[{format:u}]},primitive:{topology:"triangle-list"}}),S=M(b);return new Qt(S,h,E,b,M)},createComputePipeline(l){const x=t.createShaderModule({code:l.shaderWGSL}),h=t.createComputePipeline({layout:"auto",compute:{module:x,entryPoint:"cs_main"}});return new en(h)},createBindGroup(l,x){const h=l,b=new Map,E=[];for(const[M,S]of h.bindings)if(S.kind==="uniform"){const u=t.createBuffer({size:S.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});E.push(u),b.set(M,{binding:M,resource:{buffer:u}})}else S.kind==="sampler"&&b.set(M,{binding:M,resource:r()});for(const M of x){const S=M.resource;if(S instanceof lt){const u=Ge(M.binding,"texture");h.bindings.has(u)&&b.set(u,{binding:u,resource:S.gpuTexture.createView()})}else if(S instanceof ut){const u=Ge(M.binding,"sampler");h.bindings.has(u)&&b.set(u,{binding:u,resource:S.gpuSampler})}else{const u=Ge(M.binding,"uniform"),_=h.bindings.get(u);if(_&&_.kind==="uniform"){const D=S.uniform,I=t.createBuffer({size:Math.max(_.sizeBytes,D.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(I,0,D.buffer,D.byteOffset,D.byteLength),E.push(I),b.set(u,{binding:u,resource:{buffer:I}})}}}const p=t.createBindGroup({layout:h.bindGroupLayout,entries:Array.from(b.values())});return new tn(p,E)},createSurface(l,x){const h=l.getContext("webgpu");if(!h)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const b=x.hdr&&n.hdr,E=()=>b?Ht(h,t):st(h,t),p=E();return new nn(l,h,p,E)},renderFullscreen(l,x,h){const b=x,E=h,p=a(l),{width:M,height:S}=s(l),u=ke(l)?l.format:Re(l.format),_=b.pipelineFor(u),D=t.createCommandEncoder(),I=D.beginRenderPass({colorAttachments:[{view:p,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});I.setPipeline(_),I.setBindGroup(0,E.gpuBindGroup),I.setViewport(0,0,M,S,0,1),I.draw(3),I.end(),t.queue.submit([D.finish()])},async readback(l){const x=ke(l),{width:h,height:b}=s(l),E=x?l.hdr?"rgba16float":"rgba8unorm":l.format,p=x&&l.format==="bgra8unorm",M=x?l.getCurrentGPUTexture():l.gpuTexture,S=ct(E),u=h*S,_=256,D=Math.ceil(u/_)*_,I=D*b,B=t.createBuffer({size:I,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),N=t.createCommandEncoder();N.copyTextureToBuffer({texture:M},{buffer:B,bytesPerRow:D,rowsPerImage:b},{width:h,height:b,depthOrArrayLayers:1}),t.queue.submit([N.finish()]),await B.mapAsync(GPUMapMode.READ);const R=new Uint8Array(B.getMappedRange()),k=new Uint8Array(u*b);for(let L=0;L<b;L++){const $=L*D,X=L*u;k.set(R.subarray($,$+u),X)}if(B.unmap(),B.destroy(),E==="rgba8unorm"){if(p)for(let L=0;L<k.length;L+=4){const $=k[L],X=k[L+2];k[L]=X,k[L+2]=$}return k}if(E==="rgba16float"){const L=new Uint16Array(k.buffer,k.byteOffset,k.byteLength/2),$=new Float32Array(L.length);for(let X=0;X<L.length;X++)$[X]=qt(L[X]);return $}return new Float32Array(k.buffer,k.byteOffset,k.byteLength/4)},async reduceDiffSumSquaredAbs(l,x,h,b){const E=l,p=x,M=Math.max(0,h*b),S=Math.max(1,Math.ceil(M/g)),{pipeline:u,layout:_}=v(),D=S*2*4,I=t.createBuffer({size:D,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),B=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(B,0,new Uint32Array([Math.max(1,h),Math.max(1,b),M,0]));const N=t.createBindGroup({layout:_,entries:[{binding:0,resource:E.gpuTexture.createView()},{binding:1,resource:p.gpuTexture.createView()},{binding:2,resource:{buffer:I}},{binding:3,resource:{buffer:B}}]}),R=t.createBuffer({size:D,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),k=t.createCommandEncoder(),L=k.beginComputePass();L.setPipeline(u),L.setBindGroup(0,N),L.dispatchWorkgroups(S),L.end(),k.copyBufferToBuffer(I,0,R,0,D),t.queue.submit([k.finish()]),await R.mapAsync(GPUMapMode.READ);const X=new Float32Array(R.getMappedRange()).slice();R.unmap(),R.destroy(),I.destroy(),B.destroy();let Z=0,J=0;for(let ie=0;ie<S;ie++)Z+=X[ie*2],J+=X[ie*2+1];return{sumSq:Z,sumAbs:J}},destroy(){f||(t.destroy(),f=!0)},isContextLost(){return!1}}}let Fe=null;async function on(){if(typeof navigator>"u"||!("gpu"in navigator)||!navigator.gpu)throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");return rn()}function Ae(){return Fe||(Fe=on()),Fe}function an(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function sn(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const r=n/255*(e.length-1),a=Math.floor(r),s=Math.min(a+1,e.length-1),f=r-a,[g,d,P]=an(e[a],e[s],f);t[n*3]=Math.round(g),t[n*3+1]=Math.round(d),t[n*3+2]=Math.round(P)}return t}const dt={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},ft=new Set(["red-green","red-blue"]),ht=new Map;function Be(e){let t=ht.get(e);if(!t){const n=dt[e]??dt.viridis;t=sn(n),ht.set(e,t)}return t}function Ne(e,t,n="linear"){const o=Be(t),r=new ImageData(e.width,e.height),a=e.data,s=r.data;for(let f=0;f<a.length;f+=4){const g=(a[f]+a[f+1]+a[f+2])/3;let d;n==="positive"?d=Math.round(128+g/255*127):d=Math.round(g),d=Math.max(0,Math.min(255,d)),s[f]=o[d*3],s[f+1]=o[d*3+1],s[f+2]=o[d*3+2],s[f+3]=a[f+3]}return r}function gt(e){const t=new Map;return{get(n){return t.get(n)},set(n,o){if(t.size>=e){const r=t.keys().next().value;r!==void 0&&t.delete(r)}t.set(n,o)}}}const mt=gt(50);function Ve(e){return mt.get(e)}function ze(e,t){mt.set(e,t)}const pt=gt(100);function cn(e){return pt.get(e)}function ln(e,t){pt.set(e,t)}function un(e,t,n){const o=Math.min(e.width,t.width),r=Math.min(e.height,t.height),a=new ImageData(o,r);for(let s=0;s<r;s++)for(let f=0;f<o;f++){const g=(s*e.width+f)*4,d=(s*t.width+f)*4,P=(s*o+f)*4;for(let v=0;v<3;v++){const y=e.data[g+v],l=t.data[d+v],x=y-l,h=Math.abs(x),b=Math.max(y,1);let E;switch(n){case"signed":E=(x+255)/2;break;case"absolute":E=h;break;case"squared":E=x*x/255;break;case"relative_signed":E=(x/b+1)*127.5;break;case"relative_absolute":E=h/b*255;break;case"relative_squared":E=x*x/(b*b)*255;break}a.data[P+v]=Math.min(255,Math.max(0,Math.round(E)))}a.data[P+3]=255}return a}async function Se(e){const t=cn(e);return t||new Promise(n=>{const o=new Image;o.onload=()=>{try{const r=document.createElement("canvas");r.width=o.naturalWidth,r.height=o.naturalHeight;const a=r.getContext("2d");if(!a){n(null);return}a.drawImage(o,0,0);const s=a.getImageData(0,0,r.width,r.height);ln(e,s),n(s)}catch(r){console.warn("[cairn] loadImageData failed:",r),n(null)}},o.onerror=r=>{console.warn("[cairn] loadImageData: image failed to load:",e,r),n(null)},o.src=e})}const dn={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},fn={linear:0,signed:1,positive:2},hn=`#version 300 es
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
}`;let Te=null,V=null,de=null,Ie=null;function mn(){if(V)return V;try{if(typeof OffscreenCanvas<"u"?Te=new OffscreenCanvas(1,1):Te=document.createElement("canvas"),V=Te.getContext("webgl2",{preserveDrawingBuffer:!0}),!V)return console.warn("[cairn] WebGL 2 not available"),null;const e=V.createShader(V.VERTEX_SHADER);if(V.shaderSource(e,hn),V.compileShader(e),!V.getShaderParameter(e,V.COMPILE_STATUS))return console.error("[cairn] WebGL vertex shader:",V.getShaderInfoLog(e)),null;const t=V.createShader(V.FRAGMENT_SHADER);if(V.shaderSource(t,gn),V.compileShader(t),!V.getShaderParameter(t,V.COMPILE_STATUS))return console.error("[cairn] WebGL fragment shader:",V.getShaderInfoLog(t)),null;if(de=V.createProgram(),V.attachShader(de,e),V.attachShader(de,t),V.linkProgram(de),!V.getProgramParameter(de,V.LINK_STATUS))return console.error("[cairn] WebGL program link:",V.getProgramInfoLog(de)),null;Ie=V.createVertexArray(),V.bindVertexArray(Ie);const n=V.createBuffer();V.bindBuffer(V.ARRAY_BUFFER,n),V.bufferData(V.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),V.STATIC_DRAW);const o=V.getAttribLocation(de,"a_pos");return V.enableVertexAttribArray(o),V.vertexAttribPointer(o,2,V.FLOAT,!1,0,0),V.bindVertexArray(null),console.info("[cairn] WebGL 2 diff initialized"),V}catch(e){return console.warn("[cairn] WebGL 2 init failed:",e),null}}function bt(e,t,n){const o=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,o),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,t.width,t.height,0,e.RGBA,e.UNSIGNED_BYTE,t.data),o}function pn(e,t,n){const o=new Uint8Array(1024);for(let a=0;a<256;a++)o[a*4]=t[a*3],o[a*4+1]=t[a*3+1],o[a*4+2]=t[a*3+2],o[a*4+3]=255;const r=e.createTexture();return e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,256,1,0,e.RGBA,e.UNSIGNED_BYTE,o),r}function bn(e,t,n,o){const r=mn();if(!r||!de||!Ie||!Te)return null;const a=Math.min(e.width,t.width),s=Math.min(e.height,t.height);Te.width=a,Te.height=s,r.viewport(0,0,a,s);const f=bt(r,e,0),g=bt(r,t,1);let d=null;n.colormap?d=pn(r,n.colormap,2):(d=r.createTexture(),r.activeTexture(r.TEXTURE2),r.bindTexture(r.TEXTURE_2D,d),r.texImage2D(r.TEXTURE_2D,0,r.RGBA8,1,1,0,r.RGBA,r.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]))),r.useProgram(de),r.uniform1i(r.getUniformLocation(de,"u_baseline"),0),r.uniform1i(r.getUniformLocation(de,"u_other"),1),r.uniform1i(r.getUniformLocation(de,"u_lut"),2),r.uniform1i(r.getUniformLocation(de,"u_diff_mode"),dn[n.diffMode]),r.uniform1i(r.getUniformLocation(de,"u_cmap_mode"),fn[n.cmapMode]??0),r.uniform1i(r.getUniformLocation(de,"u_use_colormap"),n.colormap?1:0),r.bindVertexArray(Ie),r.drawArrays(r.TRIANGLE_STRIP,0,4),r.bindVertexArray(null),o.width=a,o.height=s;const P=o.getContext("2d");return P&&(P.save(),P.scale(1,-1),P.drawImage(Te,0,0,a,s,0,-s,a,s),P.restore()),r.deleteTexture(f),r.deleteTexture(g),r.deleteTexture(d),{width:a,height:s}}const vn={cardSettings:(e,t,n)=>`cairn:card-settings:${e}:${t}:${n}`,runLayout:e=>`cairn:run-layout:${e}`,collapsedSections:e=>`cairn:collapsed-sections:${e}`,comparisons:e=>`cairn:comparisons:${e}`,comparisonTemplates:e=>`cairn:comparison-templates:${e}`,reportTemplates:e=>`cairn:report-templates:${e}`,streamMode:"cairn:stream-mode",renderMode:"cairn:render-mode",scroll:e=>`cairn:scroll:${e}`,lastComparison:e=>`cairn:last-comparison:${e}`};function wn(){try{const e=localStorage.getItem(vn.renderMode);if(e==="gpu"||e==="cpu"||e==="auto")return e}catch{}return"auto"}const we=e=>e<0?0:e>1?1:e,We=e=>{const t=e<0?0:e;return t/(1+t)},$e=e=>{const t=e<0?0:e,n=t*(2.51*t+.03),o=t*(2.43*t+.59)+.14;return we(n/o)},vt={linear:([e,t,n])=>[we(e),we(t),we(n)],srgb:([e,t,n])=>[we(e),we(t),we(n)],reinhard:([e,t,n])=>[We(e),We(t),We(n)],aces:([e,t,n])=>[$e(e),$e(t),$e(n)],extended:([e,t,n])=>[e,t,n]},xn="srgb";function yn(e){return e&&vt[e]||vt[xn]}function Xe(e,t){return e*2**t}function En(e){const t=we(e);return t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}function He(e,t){return typeof t=="number"&&t>0?we(Math.pow(we(e),1/t)):En(e)}function wt(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function xt({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:o}){const r=wt(e),a=wt(t),s=[];for(let p=0;p<=e;p+=r)s.push(p);const f=[];for(let p=0;p<=t;p+=a)f.push(p);const g=1/n,d=8*g,P=-12*g,v=-2*g,y=o==null?void 0:o.current;let l=0,x=0,h=0,b=0;if(y){const p=y.clientWidth,M=y.clientHeight,S=p/e,u=M/t,_=Math.min(S,u);h=e*_,b=t*_,l=(p-h)/2,x=(M-b)/2}const E=y&&h>0;return i.jsxs(i.Fragment,{children:[i.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:E?x:0,transform:`translateY(${P}px)`,fontSize:d},children:s.map(p=>i.jsx("span",{className:"mono",style:{position:"absolute",left:E?l+p/e*h:`${p/e*100}%`,transform:"translateX(-50%)"},children:p},p))}),i.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:E?l:0,transform:`translateX(${v}px)`,fontSize:d},children:f.map(p=>i.jsx("span",{className:"mono",style:{position:"absolute",top:E?x+p/t*b:`${p/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*g}px`},children:p},p))})]})}function yt({label:e,isDraggable:t,onDragStart:n}){return i.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&i.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const Et=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function Ye(e){const t=Et.length;return Et[(e%t+t)%t]}function _n(e){const n=c.useRef(null),[o,r]=c.useState({w:0,h:0}),a=c.useRef(null),s=c.useRef(null);return c.useEffect(()=>{var d;const f=n.current;if(f===s.current||((d=a.current)==null||d.disconnect(),a.current=null,s.current=f,!f))return;const g=new ResizeObserver(P=>{for(const v of P)r({w:v.contentRect.width,h:v.contentRect.height})});a.current=g,g.observe(f)}),c.useEffect(()=>()=>{var f;return(f=a.current)==null?void 0:f.disconnect()},[]),{ref:n,size:o}}function Mn(){const[e,t]=c.useState(!1);return c.useEffect(()=>{const n=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!0)},o=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!1)},r=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",o),window.addEventListener("blur",r),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",o),window.removeEventListener("blur",r)}},[]),e}const Pn=.25,qe=64;function _t(e,t,n,o){if(e<=0||t<=0||n<=0||o<=0)return qe;const r=Math.min(n/e,o/t);return r<=0?qe:Math.max(Math.max(n,o)/r,8)}function Ue(e){const{containerRef:t,zoom:n,pan:o,onViewportChange:r,minZoom:a=Pn,maxZoom:s=qe,naturalWidth:f,naturalHeight:g}=e,d=Mn(),P=c.useRef(d);P.current=d;const v=c.useRef({zoom:n,pan:o});v.current={zoom:n,pan:o};const y=c.useRef(r);y.current=r,c.useEffect(()=>{const p=t.current;if(!p||!r)return;const M=S=>{var $;if(!P.current)return;S.preventDefault(),S.stopPropagation();const u=S.deltaY<0?1.1:1/1.1,_=v.current,D=p.getBoundingClientRect(),I=f&&g?_t(f,g,D.width,D.height):s,B=Math.max(a,Math.min(I,_.zoom*u));if(_.zoom===B)return;const N=S.clientX-D.left,R=S.clientY-D.top,k=N-(N-_.pan.x)/_.zoom*B,L=R-(R-_.pan.y)/_.zoom*B;($=y.current)==null||$.call(y,{zoom:B,pan:{x:k,y:L}})};return p.addEventListener("wheel",M,{passive:!1}),()=>p.removeEventListener("wheel",M)},[t,!!r,a,s,f,g]);const l=c.useRef(null),x=c.useCallback(p=>{!P.current||!y.current||(p.currentTarget.setPointerCapture(p.pointerId),l.current={pointerId:p.pointerId,startX:p.clientX,startY:p.clientY,panX:v.current.pan.x,panY:v.current.pan.y})},[]),h=c.useCallback(p=>{var _;const M=l.current;if(!M||M.pointerId!==p.pointerId)return;const S=p.clientX-M.startX,u=p.clientY-M.startY;(_=y.current)==null||_.call(y,{zoom:v.current.zoom,pan:{x:M.panX+S,y:M.panY+u}})},[]),b=c.useCallback(p=>{const M=l.current;if(!(!M||M.pointerId!==p.pointerId)){try{p.currentTarget.releasePointerCapture(p.pointerId)}catch{}l.current=null}},[]),E=d&&!!r;return{containerProps:{onPointerDown:x,onPointerMove:h,onPointerUp:b,onPointerCancel:b,style:{cursor:E?"move":void 0,touchAction:E?"none":void 0}},modifierActive:d}}function Ze(){const[e,t]=c.useState(()=>typeof window<"u"&&window.devicePixelRatio||1);return c.useEffect(()=>{if(typeof matchMedia>"u")return;let n=!1,o=null;const r=()=>{n||(t(window.devicePixelRatio||1),a())};function a(){if(n)return;const s=window.devicePixelRatio||1;o=matchMedia(`(resolution: ${s}dppx)`),o.addEventListener("change",r,{once:!0})}return a(),()=>{n=!0,o==null||o.removeEventListener("change",r)}},[]),e}function Sn(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function Mt(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function Ke({data:e,settings:t,naturalWidth:n,naturalHeight:o}){const{ref:r,size:a}=_n(),s=c.useRef(null),f=c.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),g=c.useMemo(()=>{const h=a.w,b=a.h;if(h<=0||b<=0||n<=0||o<=0)return null;const E=Math.min(h/n,b/o),p=n*E,M=o*E;return{left:(h-p)/2,top:(b-M)/2,width:p,height:M}},[a.w,a.h,n,o]),d=e.masks,P=t.showMasks&&!!d&&d.length>0,v=c.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(c.useEffect(()=>{if(!P||!d)return;const h=s.current;if(!h)return;(h.width!==n||h.height!==o)&&(h.width=n,h.height=o);const b=h.getContext("2d");if(!b)return;b.clearRect(0,0,h.width,h.height);let E=!1;const p=b.createImageData(n,o),M=p.data;let S=d.length,u=!1;const _=()=>{E||u&&b.putImageData(p,0,0)},D=document.createElement("canvas");D.width=n,D.height=o;const I=D.getContext("2d",{willReadFrequently:!0});for(const B of d){const N=new Image;N.onload=()=>{if(!E){if(I){I.clearRect(0,0,n,o),I.drawImage(N,0,0,n,o);const R=I.getImageData(0,0,n,o).data;for(let k=0;k<n*o;k++){const L=R[k*4];if(L===0||f.has(L))continue;const[$,X,Z]=Sn(Ye(L));M[k*4]=$,M[k*4+1]=X,M[k*4+2]=Z,M[k*4+3]=255,u=!0}}S-=1,S===0&&_()}},N.onerror=()=>{S-=1,S===0&&_()},N.src=`data:image/png;base64,${B.png_b64}`}return()=>{E=!0}},[P,d,n,o,v]),!g)return i.jsx("div",{ref:r,className:"absolute inset-0 pointer-events-none"});const y=e.boxes??[],l=t.showBoxes&&y.length>0,x=e.class_labels??{};return i.jsxs("div",{ref:r,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[P&&i.jsx("canvas",{ref:s,className:"absolute",style:{left:g.left,top:g.top,width:g.width,height:g.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),l&&i.jsx("svg",{className:"absolute",style:{left:g.left,top:g.top,width:g.width,height:g.height,overflow:"visible"},viewBox:`0 0 ${n} ${o}`,preserveAspectRatio:"none",children:y.map((h,b)=>{if(!Mt(h,t,f))return null;const E=h.domain==="pixel"?1:n,p=h.domain==="pixel"?1:o,M=h.position.minX*E,S=h.position.minY*p,u=(h.position.maxX-h.position.minX)*E,_=(h.position.maxY-h.position.minY)*p;return i.jsx("rect",{x:M,y:S,width:u,height:_,fill:"none",stroke:Ye(h.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},b)})}),l&&i.jsx("div",{className:"absolute",style:{left:g.left,top:g.top,width:g.width,height:g.height},children:y.map((h,b)=>{if(!Mt(h,t,f))return null;const E=h.domain==="pixel"?1/n:1,p=h.domain==="pixel"?1/o:1,M=h.position.minX*E*100,S=h.position.minY*p*100,u=h.label??x[String(h.class_id)]??`#${h.class_id}`,_=h.score!=null?` ${(h.score*100).toFixed(0)}%`:"";return!u&&!_?null:i.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${M}%`,top:`${S}%`,transform:"translateY(-100%)",backgroundColor:Ye(h.class_id)},children:i.jsxs("span",{className:"mono",children:[u,_]})},b)})})]})}const je=30,re=["#ff5a5a","#39d353","#5b9bff"];function Qe(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function K(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):Qe(e/255):Qe(n==="int"?e*255:e)}const Tn={x:0,y:0,w:1,h:1};function _e({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:o,pan:r,sample:a,notation:s="decimal",version:f=0,onActiveChange:g,sourceWindow:d=Tn}){const P=c.useRef(null),v=c.useRef(!1),y=Ze(),l=c.useRef(g);l.current=g;const x=c.useCallback(b=>{var E;b!==v.current&&(v.current=b,(E=l.current)==null||E.call(l,b))},[]),h=c.useCallback(()=>{var ce;const b=P.current,E=e.current;if(!b)return;const p=window.devicePixelRatio||1,M=b.clientWidth,S=b.clientHeight;if(M===0||S===0)return;b.width!==Math.round(M*p)&&(b.width=Math.round(M*p)),b.height!==Math.round(S*p)&&(b.height=Math.round(S*p));const u=b.getContext("2d");if(!u)return;if(u.setTransform(p,0,0,p,0,0),u.clearRect(0,0,M,S),!E||t<=0||n<=0){x(!1);return}const _=E.getBoundingClientRect(),D=b.getBoundingClientRect();if(_.width===0||_.height===0){x(!1);return}const I=d.x*t,B=d.y*n,N=d.w*t,R=d.h*n;if(N<=0||R<=0){x(!1);return}const k=Math.min(_.width/N,_.height/R);if(k<je){x(!1);return}const L=N*k,$=R*k,X=_.left+(_.width-L)/2-D.left,Z=_.top+(_.height-$)/2-D.top,J=Math.max(Math.floor(I),Math.floor(I+(0-X)/k)),ie=Math.min(Math.ceil(I+N),Math.ceil(I+(M-X)/k)),fe=Math.max(Math.floor(B),Math.floor(B+(0-Z)/k)),he=Math.min(Math.ceil(B+R),Math.ceil(B+(S-Z)/k));if(ie<=J||he<=fe){x(!1);return}x(!0);const oe=X+(0-I)*k,pe=Z+(0-B)*k,be=X+(t-I)*k,ve=Z+(n-B)*k;u.save(),u.beginPath(),u.rect(oe,pe,be-oe,ve-pe),u.clip(),u.textAlign="center",u.textBaseline="middle",u.lineJoin="round";const me=k*.14,se=k-me*2;for(let ue=fe;ue<he;ue++)for(let Q=J;Q<ie;Q++){if(Q<0||ue<0||Q>=t||ue>=n)continue;const z=a(Q,ue,s);if(!z||z.lines.length===0)continue;const Y=z.lines.length;let j=1;for(const G of z.lines)G.length>j&&(j=G.length);const ae=se/(Y*1.15),ee=se/(j*.62)||ae,C=Math.min(ae,ee,24);if(C<6)continue;const U=X+(Q-I+.5)*k,m=Z+(ue-B+.5)*k,w=C*1.15,T=z.luminance<=.55,A=T?"#ffffff":"#000000";u.font=`${C}px ui-monospace, SFMono-Regular, Menlo, monospace`,u.lineWidth=Math.max(1.4,C*.16),u.strokeStyle=T?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let O=m-Y*w/2+w/2;for(let G=0;G<z.lines.length;G++){const F=z.lines[G];u.strokeText(F,U,O),u.fillStyle=((ce=z.colors)==null?void 0:ce[G])??A,u.fillText(F,U,O),O+=w}}u.restore()},[e,t,n,a,s,x,d]);return c.useEffect(()=>{h()},[h,o,r.x,r.y,f,s,d,y]),c.useEffect(()=>{const b=P.current;if(!b)return;const E=new ResizeObserver(()=>h());return E.observe(b),()=>E.disconnect()},[h]),i.jsx("canvas",{ref:P,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Pt({notation:e,onChange:t,className:n=""}){return i.jsx("button",{type:"button",onClick:o=>{o.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:o=>o.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const Cn=`
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
`,De={linear:0,srgb:1,reinhard:2,aces:3,extended:4},St=new WeakMap;function An(e,t){let n=St.get(e);n||(n=new Map,St.set(e,n));let o=n.get(t);return o||(o=e.createRenderPipeline({shaderWGSL:Cn,targetFormat:t}),n.set(t,o)),o}function Tt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Ct(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const o=e.createTexture(256,1,"rgba32float");return o.write(t),o}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function In(e,t,n,o){var x;const r=Tt(t),a=An(e,r),s=Ct(e,o.isScalar?o.colormap:void 0),f=typeof o.gamma=="number"&&o.gamma>0?o.gamma:0,g=De[o.operator]??De.srgb,d=new Float32Array([o.exposureEV,g,f,o.isScalar?1:0]),P=new Float32Array([o.uv.x,o.uv.y,o.uv.w,o.uv.h]),v=new Float32Array([o.hdrOut?1:0]),y=new Float32Array([o.filter==="nearest"?0:1]);let l;try{l=e.createBindGroup(a,[{binding:0,resource:n},{binding:1,resource:s},{binding:2,resource:{uniform:d}},{binding:3,resource:{uniform:P}},{binding:4,resource:{uniform:v}},{binding:5,resource:{uniform:y}}]),e.renderFullscreen(t,a,l)}finally{(x=l==null?void 0:l.destroy)==null||x.call(l),s.destroy()}}const Un={signed:0,absolute:1,squared:2,relative_signed:3,relative_absolute:4,relative_squared:5},Dn={linear:0,signed:1,positive:2},Ln={split:0,blend:1,diff:2},kt=new WeakMap;function On(e,t){let n=kt.get(e);n||(n=new Map,kt.set(e,n));let o=n.get(t);return o||(o=e.createRenderPipeline({shaderWGSL:kn,targetFormat:t}),n.set(t,o)),o}function Rn(e,t,n,o,r){var p;const a=Tt(t),s=On(e,a),f=r.mode==="diff"&&!!r.diffColormap,g=r.isScalar?r.colormap:f?r.diffColormap:void 0,d=Ct(e,g),P=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,v=De[r.operator]??De.srgb,y=new Float32Array([r.exposureEV,v,P,r.isScalar?1:0]),l=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),x=new Float32Array([Ln[r.mode],r.split,r.alpha,Un[r.diffSubmode]??0]),h=new Float32Array([Dn[r.diffCmapMode??"linear"]??0,r.hdrOut?1:0,f?1:0,0]),b=new Float32Array([r.filter==="nearest"?0:1]);let E;try{E=e.createBindGroup(s,[{binding:0,resource:n},{binding:1,resource:o},{binding:2,resource:d},{binding:3,resource:{uniform:y}},{binding:4,resource:{uniform:l}},{binding:5,resource:{uniform:x}},{binding:6,resource:{uniform:h}},{binding:7,resource:{uniform:b}}]),e.renderFullscreen(t,s,E)}finally{(p=E==null?void 0:E.destroy)==null||p.call(E),d.destroy()}}function At(e,t,n){if(n<=0)return{mse:0,psnr:1/0,mae:0};const o=e/n,r=t/n,a=o<=0?1/0:10*Math.log10(1/o);return{mse:o,psnr:a,mae:r}}async function Gn(e,t,n){const o=Math.min(t.width,n.width),r=Math.min(t.height,n.height),a=o*r*3;if(a<=0)return{mse:0,psnr:1/0,mae:0};if(e.reduceDiffSumSquaredAbs){const{sumSq:y,sumAbs:l}=await e.reduceDiffSumSquaredAbs(t,n,o,r);return At(y,l,a)}const s=await e.readback(t),f=await e.readback(n),g=s instanceof Uint8Array,d=f instanceof Uint8Array;let P=0,v=0;for(let y=0;y<r;y++)for(let l=0;l<o;l++){const x=(y*t.width+l)*4,h=(y*n.width+l)*4;for(let b=0;b<3;b++){const E=(s[x+b]??0)/(g?255:1),p=(f[h+b]??0)/(d?255:1),M=E-p;P+=M*M,v+=Math.abs(M)}}return At(P,v,a)}function It(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceEngineFail")}catch{return!1}}const Fn=12,Me=[];function Ut(e){const t=Me.indexOf(e);t!==-1&&Me.splice(t,1),Me.push(e)}function Bn(e){const t=Me.indexOf(e);t!==-1&&Me.splice(t,1)}function Le(e){e.parked||(Bn(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.parked=!0)}function Dt(e){for(;Me.length>Fn;){const t=Me.find(n=>n!==e&&!n.visible)??Me.find(n=>n!==e);if(!t)break;Le(t)}}function Lt(e){var r,a;if(e.disposed)return;if(It())throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");if(!e.parked&&e.surface){Ut(e),Dt(e);return}const t=e.device;e.surface=t.createSurface(e.canvas,{hdr:e.hdr});const n=e.backingWidth||((r=e.source)==null?void 0:r.width)||1,o=e.backingHeight||((a=e.source)==null?void 0:a.height)||1;if(e.canvas.width=n,e.canvas.height=o,e.surface.configure(n,o),e.source){const s=t.createTexture(e.source.width,e.source.height,e.source.format);s.write(e.source.data),e.srcTexture=s}e.parked=!1,Ut(e),Dt(e)}function Nn(e,t){if(e.disposed||!e.source)return!0;try{return Lt(e),!e.surface||!e.srcTexture?!1:(In(e.device,e.surface,e.srcTexture,t),!0)}catch(n){return console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane",n),e.parked=!1,Le(e),!1}}function Vn(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.surface)){e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},resize(t,n){if(e.disposed)return;const o=Math.max(1,Math.round(t)),r=Math.max(1,Math.round(n));e.backingWidth===o&&e.backingHeight===r||(e.backingWidth=o,e.backingHeight=r,!e.parked&&e.surface&&(e.canvas.width=o,e.canvas.height=r,e.surface.configure(o,r)))},render(t){return Nn(e,t)},park(){e.disposed||Le(e)},restore(){e.disposed||!e.source||Lt(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(Le(e),e.source=null,e.disposed=!0)}}}async function zn(e,t){const n=await Ae(),o={canvas:e,device:n,hdr:(t==null?void 0:t.hdr)??!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,backingWidth:0,backingHeight:0};return Vn(o)}function Ot(e){e.dispose()}function Wn(e,t){const{brightness:n,contrast:o,exposure:r,flipSign:a}=e;return[`url(#${t})`,`brightness(${(1+n)*Math.pow(2,r)})`,`contrast(${1+o})`,...a?["invert(1)"]:[]].join(" ")}function Rt(e){const n=`cairn-gamma-${c.useId().replace(/[^a-zA-Z0-9_-]/g,"-")}`,{brightness:o,contrast:r,gamma:a,exposure:s,offset:f,flipSign:g}=e,d=c.useMemo(()=>Wn(e,n),[n,o,r,s,g]);return{gammaFilterId:n,filterStr:d,gamma:a,offset:f}}function Gt({id:e,gamma:t,offset:n}){return i.jsx("svg",{"aria-hidden":"true",style:{position:"absolute",width:0,height:0},children:i.jsx("filter",{id:e,colorInterpolationFilters:"sRGB",children:i.jsxs("feComponentTransfer",{children:[i.jsx("feFuncR",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),i.jsx("feFuncG",{type:"gamma",amplitude:1,exponent:1/t,offset:n}),i.jsx("feFuncB",{type:"gamma",amplitude:1,exponent:1/t,offset:n})]})})})}const $n=["fill","fill-opacity","stroke","stroke-width","stroke-opacity","stroke-dasharray","stroke-linecap","stroke-linejoin","opacity","color","font","font-family","font-size","font-weight","font-style","text-anchor","dominant-baseline","visibility","display"];function Ft(e,t){const n=getComputedStyle(e),o=$n.map(g=>`${g}:${n.getPropertyValue(g)}`).join(";"),r=t.getAttribute("style");t.setAttribute("style",r?`${r};${o}`:o);const a=e.children,s=t.children,f=Math.min(a.length,s.length);for(let g=0;g<f;g++)Ft(a[g],s[g])}function Je(e){let t=e;for(;t;){const n=getComputedStyle(t).backgroundColor;if(n&&n!=="transparent"&&!n.startsWith("rgba(0, 0, 0, 0)"))return n;t=t.parentElement}return"#ffffff"}function et(e){const t=(e==null?void 0:e.scale)??(typeof window<"u"&&window.devicePixelRatio||1);return Math.min(Math.max(t,1),3)}async function tt(e,t,n,o,r){const a=document.createElement("canvas");a.width=Math.max(1,Math.round(e*n)),a.height=Math.max(1,Math.round(t*n));const s=a.getContext("2d");if(!s)throw new Error("plot-to-png: 2D canvas context unavailable");return s.scale(n,n),o&&(s.fillStyle=o,s.fillRect(0,0,e,t)),r(s),await new Promise((f,g)=>a.toBlob(d=>d?f(d):g(new Error("plot-to-png: toBlob returned null")),"image/png"))}function Xn(e,t,n){const o=e.cloneNode(!0);Ft(e,o),o.setAttribute("width",String(t)),o.setAttribute("height",String(n)),o.setAttribute("xmlns","http://www.w3.org/2000/svg");const r=new XMLSerializer().serializeToString(o),a="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(r);return new Promise((s,f)=>{const g=new Image;g.onload=()=>s(g),g.onerror=()=>f(new Error("plot-to-png: SVG rasterization failed")),g.src=a})}async function Bt(e,t){const n=e.getBoundingClientRect(),o=n.width||e.width,r=n.height||e.height,a=(t==null?void 0:t.background)??Je(e);return tt(o,r,et(t),a,s=>s.drawImage(e,0,0,o,r))}async function Hn(e,t){const n=e.getBoundingClientRect(),o=n.width||e.naturalWidth||e.width,r=n.height||e.naturalHeight||e.height,a=(t==null?void 0:t.background)??Je(e);try{return await tt(o,r,et(t),a,s=>s.drawImage(e,0,0,o,r))}catch(s){throw new Error(`plot-to-png: cannot export <img> — the image source appears to be cross-origin (tainted canvas). Same-document data:/blob: images export fine. (${s instanceof Error?s.message:String(s)})`)}}function Yn(e){const t=Array.from(e.querySelectorAll("img"));let n=null,o=0;for(const r of t){const a=r.getBoundingClientRect(),s=a.width*a.height;s>o&&(o=s,n=r)}return n}async function qn(e,t){const n=e.querySelector("svg"),o=Array.from(e.querySelectorAll("canvas")),r=e.getBoundingClientRect(),a=r.width||300,s=r.height||150,f=(t==null?void 0:t.background)??Je(e);if(n){const d=n.getBoundingClientRect(),P=await Xn(n,d.width||a,d.height||s);return tt(a,s,et(t),f,v=>{for(const y of o){const l=y.getBoundingClientRect();v.drawImage(y,l.left-r.left,l.top-r.top,l.width,l.height)}v.drawImage(P,d.left-r.left,d.top-r.top,d.width,d.height)})}if(o.length)return Bt(o[0],t);const g=Yn(e);if(g)return Hn(g,t);throw new Error("plot-to-png: no <svg>, <canvas>, or <img> found under root")}function Zn(e,t){const n=URL.createObjectURL(e),o=document.createElement("a");o.href=n,o.download=t.endsWith(".png")?t:`${t}.png`,document.body.appendChild(o),o.click(),o.remove(),setTimeout(()=>URL.revokeObjectURL(n),1e3)}const Kn={"top-right":{top:6,right:6},"top-left":{top:6,left:6},"bottom-right":{bottom:6,right:6},"bottom-left":{bottom:6,left:6}},jn={boxZoom:i.jsx("rect",{x:"3.5",y:"3.5",width:"17",height:"17",rx:"1.5",strokeDasharray:"4 3"}),select:i.jsxs(i.Fragment,{children:[i.jsx("rect",{x:"3",y:"3",width:"11",height:"11",rx:"1",strokeDasharray:"3 2.5"}),i.jsx("path",{d:"M12 12l8.5 3.3-3.4 1-1 3.4z",fill:"currentColor",stroke:"currentColor",strokeWidth:"1",strokeLinejoin:"round"})]}),lasso:i.jsxs(i.Fragment,{children:[i.jsx("path",{d:"M12 4c4.4 0 7.3 2.9 6.6 6.4-0.7 3.5-4.9 5.3-8.8 4.5C6.4 14.2 4.6 11.4 5.7 8.7 6.8 6 9.2 4 12 4z"}),i.jsx("path",{d:"M8.7 15.2c-1.3 0.9-1.8 2.3-1.2 3.5"}),i.jsx("circle",{cx:"7.7",cy:"19.6",r:"1.05",fill:"currentColor",stroke:"none"})]}),pan:i.jsxs(i.Fragment,{children:[i.jsx("path",{d:"M12 2v20M2 12h20"}),i.jsx("path",{d:"M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"})]}),zoomIn:i.jsxs(i.Fragment,{children:[i.jsx("circle",{cx:"10.5",cy:"10.5",r:"7"}),i.jsx("path",{d:"M21 21l-5.2-5.2M10.5 7.5v6M7.5 10.5h6"})]}),zoomOut:i.jsxs(i.Fragment,{children:[i.jsx("circle",{cx:"10.5",cy:"10.5",r:"7"}),i.jsx("path",{d:"M21 21l-5.2-5.2M7.5 10.5h6"})]}),autoscale:i.jsx("path",{d:"M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"}),home:i.jsx("path",{d:"M3 11l9-8 9 8M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5M9.5 21v-6h5v6"}),camera:i.jsxs(i.Fragment,{children:[i.jsx("path",{d:"M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"}),i.jsx("circle",{cx:"12",cy:"13.5",r:"3.3"})]})};function Qn({name:e}){return i.jsx("svg",{viewBox:"0 0 24 24",width:"13",height:"13",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:jn[e]??null})}function xe({icon:e,label:t,title:n,active:o,disabled:r,onClick:a}){return i.jsx("button",{type:"button",disabled:r,onClick:s=>{s.stopPropagation(),!r&&a()},onPointerDown:s=>s.stopPropagation(),onDoubleClick:s=>s.stopPropagation(),"aria-label":n,"aria-pressed":o,"aria-disabled":r,title:n,className:["h-[22px] min-w-[22px] inline-flex items-center justify-center rounded",t?"px-1.5 text-[10px] font-mono":"text-xs",r?"opacity-40 cursor-default text-fg-muted":o?"bg-bg-hover text-accent":"text-fg-muted hover:text-fg hover:bg-bg-hover"].join(" "),children:t?i.jsx("span",{"aria-hidden":"true",children:t}):i.jsx(Qn,{name:e??""})})}function Oe(){return i.jsx("span",{"aria-hidden":"true",className:"mx-0.5 h-3.5 w-px bg-border"})}function nt({controller:e,config:t}){if((t==null?void 0:t.enabled)===!1)return null;const n=e.capabilities,o=t==null?void 0:t.buttons,r=(l,x)=>x&&(o==null?void 0:o[l])!==!1,a=l=>()=>e.setDragMode(l),s=r("zoom",n.zoom)||r("pan",n.pan)||r("select",n.select)||r("lasso",n.lasso),f=r("zoomIn",n.zoom)||r("zoomOut",n.zoom),g=r("autoscale",n.autoscale)||r("reset",n.reset),d=r("screenshot",n.screenshot),P=(t==null?void 0:t.leadingButtons)??[];if(!P.length&&!s&&!f&&!g&&!d)return null;const v=(t==null?void 0:t.position)??"top-right",y=(t==null?void 0:t.visibility)==="always";return i.jsxs("div",{style:{position:"absolute",pointerEvents:"auto",...Kn[v]},className:["z-20 flex items-center gap-0.5 rounded border border-border","bg-bg-elevated/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-opacity",y?"opacity-100":"opacity-0 group-hover:opacity-100"].join(" "),role:"toolbar","aria-label":"Plot controls",children:[P.length>0&&i.jsxs(i.Fragment,{children:[P.map(l=>i.jsx(xe,{icon:l.icon,label:l.label,title:l.title,active:l.active,disabled:l.disabled,onClick:l.onClick},l.id)),(s||f||g||d)&&i.jsx(Oe,{})]}),s&&i.jsxs(i.Fragment,{children:[r("zoom",n.zoom)&&i.jsx(xe,{icon:"boxZoom",title:"Box zoom",active:e.dragMode==="zoom",onClick:a("zoom")}),r("pan",n.pan)&&i.jsx(xe,{icon:"pan",title:"Pan",active:e.dragMode==="pan",onClick:a("pan")}),r("select",n.select)&&i.jsx(xe,{icon:"select",title:"Box select",active:e.dragMode==="select",onClick:a("select")}),r("lasso",n.lasso)&&i.jsx(xe,{icon:"lasso",title:"Lasso select",active:e.dragMode==="lasso",onClick:a("lasso")})]}),f&&i.jsxs(i.Fragment,{children:[s&&i.jsx(Oe,{}),r("zoomIn",n.zoom)&&i.jsx(xe,{icon:"zoomIn",title:"Zoom in",onClick:()=>e.zoomIn()}),r("zoomOut",n.zoom)&&i.jsx(xe,{icon:"zoomOut",title:"Zoom out",onClick:()=>e.zoomOut()})]}),g&&i.jsxs(i.Fragment,{children:[(s||f)&&i.jsx(Oe,{}),r("autoscale",n.autoscale)&&i.jsx(xe,{icon:"autoscale",title:"Autoscale",onClick:()=>e.autoscale()}),r("reset",n.reset)&&i.jsx(xe,{icon:"home",title:e.isModified?"Reset view":"Reset view (at home)",disabled:!e.isModified,onClick:()=>e.reset()})]}),d&&i.jsxs(i.Fragment,{children:[(s||f||g)&&i.jsx(Oe,{}),i.jsx(xe,{icon:"camera",title:"Download plot as PNG",onClick:()=>{e.toPNG({filename:"plot"}).then(l=>Zn(l,"plot.png")).catch(()=>{})}})]})]})}const Jn={zoom:1,pan:{x:0,y:0}},Nt=1.3,er=.25,tr=64,rt={buttons:{zoom:!1}};function ot(e,t){return{id:"notation",label:e==="int"?"0–255":"0–1",title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",onClick:()=>t(e==="int"?"decimal":"int")}}function at({rootRef:e,canvasRef:t,zoom:n,pan:o,onViewportChange:r,naturalWidth:a,naturalHeight:s,minZoom:f=er,maxZoom:g=tr,requestRender:d}){const P=c.useCallback(S=>{var $;if(!r)return;const u=($=e.current)==null?void 0:$.getBoundingClientRect(),_=(u==null?void 0:u.width)??0,D=(u==null?void 0:u.height)??0,I=a&&s&&_>0&&D>0?_t(a,s,_,D):g,B=Math.max(f,Math.min(I,n*S));if(B===n)return;const N=_/2,R=D/2,k=N-(N-o.x)/n*B,L=R-(R-o.y)/n*B;r({zoom:B,pan:{x:k,y:L}})},[r,e,a,s,g,f,n,o.x,o.y]),v=c.useCallback(()=>P(Nt),[P]),y=c.useCallback(()=>P(1/Nt),[P]),l=c.useCallback(()=>r==null?void 0:r(Jn),[r]),x=c.useCallback(S=>{const u={scale:S==null?void 0:S.scale,filename:S==null?void 0:S.filename};d==null||d();const _=t==null?void 0:t.current;if(_)return Bt(_,u);const D=e.current;return D?qn(D,u):Promise.reject(new Error("useImageController.toPNG: no canvas or root element to export"))},[t,e,d]),h=c.useMemo(()=>({zoom:!0,pan:!0,autoscale:!0,reset:!0,screenshot:!0,boxZoom:!1,select:!1,lasso:!1,hover:!1,spikelines:!1,hoverModes:!1,legend:!1,axisScaleToggle:!1,perAxisDrag:!1,brush:!1,reorder:!1}),[]),b=n!==1||o.x!==0||o.y!==0,E=c.useCallback(S=>{},[]),p=c.useCallback(S=>{},[]),M=c.useCallback(()=>{},[]);return c.useMemo(()=>({capabilities:h,dragMode:"pan",hoverMode:"closest",spikelines:!1,isModified:b,setDragMode:E,setHoverMode:p,toggleSpikelines:M,zoomIn:v,zoomOut:y,autoscale:l,reset:l,toPNG:x}),[h,b,E,p,M,v,y,l,x])}function Vt(e){return"hdr"in e&&e.hdr!=null}function zt(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`cairn-plot image: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function le(e){return Number.isFinite(e)?e:0}const nr={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1},rr={zoom:1,pan:{x:0,y:0}};function or(e,t,n,o){const{h:r,w:a,c:s}=zt(e.shape),f=e.data,g=yn(t),d=new Uint8ClampedArray(a*r*4);for(let P=0;P<a*r;P++){const v=P*s;let y,l,x,h=1;s===1?y=l=x=le(f[v]):s===3?(y=le(f[v]),l=le(f[v+1]),x=le(f[v+2])):(y=le(f[v]),l=le(f[v+1]),x=le(f[v+2]),h=le(f[v+3]));const b=[Xe(y,n),Xe(l,n),Xe(x,n)],[E,p,M]=g(b),S=P*4;d[S]=255*He(E,o),d[S+1]=255*He(p,o),d[S+2]=255*He(M,o),d[S+3]=255*(h<0?0:h>1?1:h)}return new ImageData(d,a,r)}function Wt({zoom:e,pan:t,onViewportChange:n,showAxes:o,naturalDims:r,label:a,showLabelChip:s,isDraggable:f=!1,onDragStart:g,toolbar:d,notationSeed:P,sample:v,pixelDataVersion:y,displayElRef:l,exportCanvasRef:x,hasPixelSource:h,header:b,overlayNode:E,children:p}){const M=c.useRef(null),S=c.useRef(null),[u,_]=c.useState(P),[D,I]=c.useState(!1),B=`translate(${t.x}px, ${t.y}px) scale(${e})`,{containerProps:N}=Ue({containerRef:M,zoom:e,pan:t,onViewportChange:n,naturalWidth:r==null?void 0:r.w,naturalHeight:r==null?void 0:r.h}),R=c.useCallback(()=>{n==null||n(rr)},[n]),k=at({rootRef:M,canvasRef:x,zoom:e,pan:t,onViewportChange:n,naturalWidth:r==null?void 0:r.w,naturalHeight:r==null?void 0:r.h}),L=c.useMemo(()=>({...rt,leadingButtons:D?[ot(u,_)]:[]}),[D,u]);return i.jsxs("div",{className:`relative flex flex-col h-full${d?" group":""}`,"data-cpu-image-pane":!0,children:[b,d&&i.jsx(nt,{controller:k,config:L}),i.jsxs("div",{ref:M,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:o&&r?"16px 4px 4px 28px":"4px",...N.style},onPointerDown:N.onPointerDown,onPointerMove:N.onPointerMove,onPointerUp:N.onPointerUp,onPointerCancel:N.onPointerCancel,onDoubleClick:R,"data-cpu-image-viewport":!0,children:[i.jsxs("div",{ref:S,className:"relative w-full h-full",style:{transform:B,transformOrigin:"0 0"},children:[p,o&&r&&i.jsx(xt,{naturalWidth:r.w,naturalHeight:r.h,zoom:e,containerRef:S}),E]}),h&&r&&i.jsx(_e,{imageElRef:l,naturalWidth:r.w,naturalHeight:r.h,zoom:e,pan:t,sample:v,notation:u,version:y,onActiveChange:I}),!d&&D&&i.jsx(Pt,{notation:u,onChange:_})]}),s&&i.jsx(yt,{label:a,isDraggable:f,onDragStart:g})]})}function ar(e){var C,U;const{imageUrl:t,baselineUrl:n=null,isBaseline:o=!1,diffMode:r="none",interpolation:a="auto",colormap:s="none",showAxes:f=!1,processing:g=nr,zoom:d=1,pan:P={x:0,y:0},onViewportChange:v,onNaturalSize:y,label:l,isDraggable:x=!1,onDragStart:h,overlay:b,overlaySettings:E,pixelValueNotation:p="decimal",toolbar:M=!0}=e,S=c.useRef(null),u=c.useRef(null),_=c.useRef(null),D=c.useRef(null),I=c.useRef(null),[B,N]=c.useState(0),R=c.useCallback(()=>N(m=>m+1),[]),k=c.useMemo(()=>({get current(){const m=_.current;return m instanceof HTMLCanvasElement?m:null}}),[]),L=c.useCallback(m=>{S.current=m,m&&(_.current=m)},[]),$=c.useCallback(m=>{u.current=m,m&&(_.current=m)},[]),X=c.useCallback(m=>{m&&(_.current=m)},[]),[Z,J]=c.useState(!1),[ie,fe]=c.useState(!1),[he,oe]=c.useState(null),{flipSign:pe}=g,{gammaFilterId:be,filterStr:ve,gamma:me,offset:se}=Rt(g),ce=!o&&r!=="none"&&n!=null&&t!=null,ue=r!=="none"&&n!=null,Q=s!=="none"&&!ce&&!(o&&ue)&&t!=null;c.useEffect(()=>{if(!Q||!t){fe(!1);return}let m=!1;fe(!1);const w=`${t}::${s}`,T=Ve(w);if(T){const O=u.current;if(O){O.width=T.width,O.height=T.height;const G=O.getContext("2d");G&&G.putImageData(T,0,0),I.current=T,R(),oe({w:T.width,h:T.height}),y==null||y(T.width,T.height),fe(!0)}return}const A=new Image;return A.onload=()=>{if(m)return;const O=document.createElement("canvas");O.width=A.naturalWidth,O.height=A.naturalHeight;const G=O.getContext("2d");if(!G)return;G.drawImage(A,0,0);const F=G.getImageData(0,0,O.width,O.height),H=ft.has(s)?"positive":"linear",W=Ne(F,s,H);ze(w,W);const te=u.current;if(!te||m)return;te.width=W.width,te.height=W.height;const ne=te.getContext("2d");ne&&ne.putImageData(W,0,0),I.current=W,R(),oe({w:W.width,h:W.height}),y==null||y(W.width,W.height),fe(!0)},A.src=t,()=>{m=!0}},[Q,t,s]);const z=c.useCallback((m,w)=>{oe(T=>T&&T.w===m&&T.h===w?T:{w:m,h:w}),y==null||y(m,w)},[]);c.useEffect(()=>{if(!t){D.current=null,I.current=null,R();return}let m=!1;return Se(t).then(w=>{m||(D.current=w,s==="none"&&(I.current=w),R())}),()=>{m=!0}},[t,s,R]);const Y=c.useCallback((m,w,T)=>{const A=D.current;if(!A||m<0||w<0||m>=A.width||w>=A.height)return null;const O=(w*A.width+m)*4,G=A.data[O],F=A.data[O+1],H=A.data[O+2],W=I.current;let te=G,ne=F,ge=H;if(W&&W.width===A.width&&W.height===A.height){const Ce=(w*W.width+m)*4;te=W.data[Ce],ne=W.data[Ce+1],ge=W.data[Ce+2]}const ye=(.299*te+.587*ne+.114*ge)/255;return s!=="none"||G===F&&F===H?{lines:[K(G,"uint8",T)],luminance:ye}:{lines:[K(G,"uint8",T),K(F,"uint8",T),K(H,"uint8",T)],luminance:ye,colors:[re[0],re[1],re[2]]}},[s]);c.useEffect(()=>{if(!ce){J(!1);return}let m=!1;const w=wn(),T=w==="gpu"||w==="auto",A=`${n}::${t}::${r}::${s}`;if(w!=="gpu"){const O=Ve(A);if(O){const G=S.current;if(G){(G.width!==O.width||G.height!==O.height)&&(G.width=O.width,G.height=O.height);const F=G.getContext("2d");F&&F.putImageData(O,0,0),z(O.width,O.height),J(!0)}return}}return(async()=>{const[O,G]=await Promise.all([Se(n),Se(t)]);if(m||!O||!G)return;const H=r.includes("signed")?"signed":"positive",W=s!=="none"?Be(s):null,te={diffMode:r,colormap:W,cmapMode:H};if(T)try{const Pe=S.current;if(Pe){const Ce=bn(O,G,te,Pe);if(Ce){if(m)return;z(Ce.width,Ce.height),J(!0);return}}}catch(Pe){console.warn("[cairn] WebGL 2 diff error:",Pe)}if(w==="gpu"){console.error("[cairn] WebGL 2 unavailable — set render mode to 'Auto' or 'CPU'");return}let ne=un(O,G,r);s!=="none"&&(ne=Ne(ne,s,H)),ze(A,ne);const ge=S.current;if(!ge||m)return;(ge.width!==ne.width||ge.height!==ne.height)&&(ge.width=ne.width,ge.height=ne.height);const ye=ge.getContext("2d");ye&&ye.putImageData(ne,0,0),z(ne.width,ne.height),J(!0)})(),()=>{m=!0}},[n,t,r,ce,s,y]);const j=a==="auto"?void 0:a,ae=pe?{filter:"invert(1)"}:{},ee=b&&(E!=null&&E.enabled)&&he&&t&&((((C=b.boxes)==null?void 0:C.length)??0)>0||(((U=b.masks)==null?void 0:U.length)??0)>0)?i.jsx(Ke,{data:b,settings:E,naturalWidth:he.w,naturalHeight:he.h}):void 0;return i.jsx(Wt,{zoom:d,pan:P,onViewportChange:v,showAxes:f,naturalDims:he,label:l,showLabelChip:!0,isDraggable:x,onDragStart:h,toolbar:M,notationSeed:p,sample:Y,pixelDataVersion:B,displayElRef:_,exportCanvasRef:k,hasPixelSource:!!t,header:i.jsx(Gt,{id:be,gamma:me,offset:se}),overlayNode:ee,children:t?ce?i.jsxs(i.Fragment,{children:[!Z&&i.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"computing diff..."}),i.jsx("canvas",{ref:L,className:"w-full h-full object-contain block",style:{display:Z?"block":"none",imageRendering:j,...ae}})]}):Q?i.jsxs(i.Fragment,{children:[!ie&&i.jsx("span",{className:"text-xs text-fg-muted motion-safe:animate-pulse",children:"applying colormap..."}),i.jsx("canvas",{ref:$,className:"w-full h-full object-contain block",style:{display:ie?"block":"none",imageRendering:j,...ae}})]}):i.jsx("img",{ref:X,src:t,alt:l,className:"w-full h-full object-contain block",draggable:!1,style:{filter:ve,imageRendering:j},onLoad:m=>{const w=m.currentTarget;oe({w:w.naturalWidth,h:w.naturalHeight}),y==null||y(w.naturalWidth,w.naturalHeight)}}):i.jsx("span",{className:"text-xs text-fg-muted",children:"no image"})})}function ir(e){const{hdr:t,tonemap:n="srgb",exposure:o=0,gamma:r,showAxes:a=!1,label:s="",interpolation:f="auto",zoom:g=1,pan:d={x:0,y:0},onViewportChange:P,pixelValueNotation:v="decimal",toolbar:y=!0}=e,l=c.useRef(null),[x,h]=c.useState(null),b=c.useRef(null),[E,p]=c.useState(0);c.useEffect(()=>{const u=l.current;if(!u)return;let _;try{_=or(t,n,o,r)}catch(I){console.error("[cairn] HDR tone-map error:",I);return}(u.width!==_.width||u.height!==_.height)&&(u.width=_.width,u.height=_.height);const D=u.getContext("2d");D&&(D.putImageData(_,0,0),b.current=_,p(I=>I+1),h(I=>I&&I.w===_.width&&I.h===_.height?I:{w:_.width,h:_.height}))},[t,n,o,r]);const M=c.useCallback((u,_,D)=>{const I=x;if(!I||u<0||_<0||u>=I.w||_>=I.h)return null;const B=t.shape.length===2?1:t.shape[2]??1,N=(_*I.w+u)*B,R=t.data,k=b.current;let L=.5;if(k&&k.width===I.w&&k.height===I.h){const $=(_*I.w+u)*4;L=(.299*k.data[$]+.587*k.data[$+1]+.114*k.data[$+2])/255}return B===1?{lines:[K(R[N]??0,"unit",D)],luminance:L}:{lines:[K(R[N]??0,"unit",D),K(R[N+1]??0,"unit",D),K(R[N+2]??0,"unit",D)],luminance:L,colors:[re[0],re[1],re[2]]}},[t,x]),S=f==="auto"?void 0:f;return i.jsx(Wt,{zoom:g,pan:d,onViewportChange:P,showAxes:a,naturalDims:x,label:s,showLabelChip:!!s,toolbar:y,notationSeed:v,sample:M,pixelDataVersion:E,displayElRef:l,exportCanvasRef:l,hasPixelSource:!0,children:i.jsx("canvas",{ref:l,className:"w-full h-full object-contain block",style:{imageRendering:S}})})}function it(e){return Vt(e)?i.jsx(ir,{...e}):i.jsx(ar,{...e})}const sr=["linear","srgb","reinhard","aces"];function cr(e){return e&&sr.includes(e)?e:"srgb"}function lr(e){const{h:t,w:n,c:o}=zt(e.shape),r=e.data,a=new Float32Array(n*t*4);for(let s=0;s<n*t;s++){const f=s*o;let g,d,P,v=1;o===1?g=d=P=le(r[f]):o===3?(g=le(r[f]),d=le(r[f+1]),P=le(r[f+2])):(g=le(r[f]),d=le(r[f+1]),P=le(r[f+2]),v=le(r[f+3]));const y=s*4;a[y]=g,a[y+1]=d,a[y+2]=P,a[y+3]=v}return{data:a,width:n,height:t,format:"rgba32float"}}function $t(e,t,n,o){if(n<=0||o<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const r=Math.min(t.width/n,t.height/o),a=n*r,s=o*r,f=(t.width-a)/2,g=(t.height-s)/2,d=Math.max(e.zoom,1e-6),P=t.width/(d*a),v=t.height/(d*s),y=-f/a-e.pan.x/(d*a),l=-g/s-e.pan.y/(d*s);return{x:y,y:l,w:P,h:v}}function Xt(e,t,n,o){const r=e.w*n,a=e.h*o;return r<=0||a<=0||t.width<=0||t.height<=0?0:Math.min(t.width/r,t.height/a)}const ur={zoom:1,pan:{x:0,y:0}};function dr(e){var ae,ee;const t=Vt(e),n=c.useRef(null),o=c.useRef(null),r=c.useRef(null),a=c.useRef(null),s=c.useRef(!1),[f,g]=c.useState(!1),[d,P]=c.useState(!1),[v,y]=c.useState(null),[l,x]=c.useState(0),[h,b]=c.useState(0),[E,p]=c.useState({x:0,y:0,w:1,h:1}),M=c.useRef(null),S=c.useRef(null),[u,_]=c.useState(0),[D,I]=c.useState(e.pixelValueNotation??"decimal"),[B,N]=c.useState(!1),R=e.zoom??1,k=e.pan??{x:0,y:0},L=e.onViewportChange,$=t?"none":e.colormap??"none",X=Ze();c.useEffect(()=>{const C=n.current;if(!C)return;let U=!1;return Ae().then(m=>{if(U)return;const w=typeof matchMedia<"u"&&matchMedia("(dynamic-range: high)").matches,T=m.capabilities.hdr&&w&&t;s.current=T,zn(C,{hdr:T}).then(A=>{if(U){Ot(A);return}a.current=A,P(!0)}).catch(A=>{U||(console.warn("cairn-plot: GpuImagePane failed to acquire a pool handle, falling back to legacy pane",A),g(!0))})}).catch(m=>{U||(console.warn("cairn-plot: GpuImagePane could not resolve a GPU device, falling back to legacy pane",m),g(!0))}),()=>{U=!0,a.current&&(Ot(a.current),a.current=null)}},[]);const{containerProps:Z}=Ue({containerRef:o,zoom:R,pan:k,onViewportChange:L,naturalWidth:v==null?void 0:v.w,naturalHeight:v==null?void 0:v.h}),J=c.useCallback(()=>{L==null||L(ur)},[L]);c.useEffect(()=>{const C=o.current;if(!C)return;const U=new ResizeObserver(()=>b(m=>m+1));return U.observe(C),()=>U.disconnect()},[]),c.useEffect(()=>{const C=o.current;if(!C)return;const U=new IntersectionObserver(m=>{const w=m[0];if(!w)return;const T=a.current;T&&(T.setVisible(w.isIntersecting),w.isIntersecting?T.isParked&&(T.restore(),b(A=>A+1)):T.park())},{threshold:0});return U.observe(C),()=>U.disconnect()},[]),c.useEffect(()=>{var m;if(!t||!d)return;const C=e.hdr;M.current=C;const U=lr(C);(m=a.current)==null||m.setSource(U),y(w=>w&&w.w===U.width&&w.h===U.height?w:{w:U.width,h:U.height}),_(w=>w+1),x(w=>w+1)},[t,d,t?e.hdr:null]),c.useEffect(()=>{if(t||!d)return;const C=e,U=C.imageUrl,m=C.colormap??"none";if(!U){S.current=null,y(null),_(T=>T+1);return}let w=!1;return Se(U).then(T=>{var G,F;if(w||!T)return;let A=T;if(m!=="none"){const H=`gpu::${U}::${m}`,W=Ve(H);if(W)A=W;else{const te=ft.has(m)?"positive":"linear";A=Ne(T,m,te),ze(H,A)}}S.current=T;const O={data:A.data,width:A.width,height:A.height,format:"rgba8unorm"};(G=a.current)==null||G.setSource(O),y(H=>H&&H.w===A.width&&H.h===A.height?H:{w:A.width,h:A.height}),(F=C.onNaturalSize)==null||F.call(C,A.width,A.height),_(H=>H+1),x(H=>H+1)}),()=>{w=!0}},[t,d,t?null:e.imageUrl,t?null:e.colormap]);const ie=t?e.exposure??0:0,fe=t?e.tonemap:void 0,he=t?e.gamma:void 0,oe=c.useCallback(()=>{const C=a.current;if(!C||!d||!v)return;const U=o.current,m=r.current,w=m?m.getBoundingClientRect():U?U.getBoundingClientRect():{width:v.w,height:v.h},T=$t({zoom:R,pan:k},w,v.w,v.h);p(F=>F.x===T.x&&F.y===T.y&&F.w===T.w&&F.h===T.h?F:T),w.width>0&&w.height>0&&C.resize(Math.round(w.width*X),Math.round(w.height*X));const A=Xt(T,w,v.w,v.h)>=je?"nearest":"linear",O=T,G=t?{exposureEV:ie,operator:s.current?"extended":cr(fe),gamma:he,isScalar:!1,hdrOut:s.current,uv:O,filter:A}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:O,filter:A};try{C.render(G)||g(!0)}catch(F){console.warn("cairn-plot: GpuImagePane render failed, falling back to legacy pane",F),g(!0)}},[d,v,R,k.x,k.y,ie,fe,he,t,X]);c.useEffect(()=>{oe()},[oe,l,h]);const pe=at({rootRef:o,canvasRef:n,zoom:R,pan:k,onViewportChange:L,naturalWidth:v==null?void 0:v.w,naturalHeight:v==null?void 0:v.h,requestRender:oe}),be=c.useMemo(()=>({...rt,leadingButtons:B?[ot(D,I)]:[]}),[B,D]),ve=c.useCallback((C,U,m)=>{if(t){const W=M.current,te=v;if(!W||!te||C<0||U<0||C>=te.w||U>=te.h)return null;const ne=W.shape.length===2?1:W.shape[2]??1,ge=(U*te.w+C)*ne,ye=W.data,Pe=.5;return ne===1?{lines:[K(ye[ge]??0,"unit",m)],luminance:Pe}:{lines:[K(ye[ge]??0,"unit",m),K(ye[ge+1]??0,"unit",m),K(ye[ge+2]??0,"unit",m)],luminance:Pe,colors:[re[0],re[1],re[2]]}}const w=S.current;if(!w||C<0||U<0||C>=w.width||U>=w.height)return null;const T=(U*w.width+C)*4,A=w.data[T],O=w.data[T+1],G=w.data[T+2],F=(.299*A+.587*O+.114*G)/255;return $!=="none"||A===O&&O===G?{lines:[K(A,"uint8",m)],luminance:F}:{lines:[K(A,"uint8",m),K(O,"uint8",m),K(G,"uint8",m)],luminance:F,colors:[re[0],re[1],re[2]]}},[t,v,$]),me=e.showAxes??!1,se=t?e.label??"":e.label,ce=e.interpolation??"auto",ue=ce==="auto"?void 0:ce,Q=t?void 0:e.overlay,z=t?void 0:e.overlaySettings,Y=t?!1:e.isDraggable??!1,j=t?void 0:e.onDragStart;return f?t?i.jsx(it,{...e}):i.jsx(it,{...e}):i.jsxs("div",{className:"group relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":d,children:[i.jsx(nt,{controller:pe,config:be}),i.jsxs("div",{ref:o,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded",style:{padding:me&&v?"16px 4px 4px 28px":0,...Z.style},onPointerDown:Z.onPointerDown,onPointerMove:Z.onPointerMove,onPointerUp:Z.onPointerUp,onPointerCancel:Z.onPointerCancel,onDoubleClick:J,"data-gpu-image-viewport":!0,children:[i.jsxs("div",{ref:r,className:"relative w-full h-full flex items-center justify-center cairn-checkerboard",children:[i.jsx("canvas",{ref:n,className:"w-full h-full block",style:{imageRendering:ue},"data-gpu-image-canvas":!0}),me&&v&&i.jsx(xt,{naturalWidth:v.w,naturalHeight:v.h,zoom:R,containerRef:r}),Q&&(z==null?void 0:z.enabled)&&v&&((((ae=Q.boxes)==null?void 0:ae.length)??0)>0||(((ee=Q.masks)==null?void 0:ee.length)??0)>0)&&i.jsx(Ke,{data:Q,settings:z,naturalWidth:v.w,naturalHeight:v.h})]}),v&&i.jsx(_e,{imageElRef:n,naturalWidth:v.w,naturalHeight:v.h,zoom:R,pan:k,sourceWindow:E,sample:ve,notation:D,version:u,onActiveChange:N})]}),se?i.jsx(yt,{label:se,isDraggable:Y,onDragStart:j}):null]})}const fr={brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1};function hr({imageUrl:e,baselineUrl:t,mode:n,splitPosition:o,blendAlpha:r,onSplitPositionChange:a,zoom:s,pan:f,onViewportChange:g,processing:d=fr,interpolation:P="auto",label:v="",isDraggable:y=!1,onDragStart:l,overlay:x,overlaySettings:h,pixelValueNotation:b="decimal"}){var ue,Q;const E=c.useRef(null),[p,M]=c.useState(null),[S,u]=c.useState(null),[_,D]=c.useState(b),[I,B]=c.useState(!1),N=c.useRef(null),R=c.useRef(null),k=c.useRef(null),L=c.useRef(null),[$,X]=c.useState(0);c.useEffect(()=>{if(!e){k.current=null,X(Y=>Y+1);return}let z=!1;return Se(e).then(Y=>{z||(k.current=Y,X(j=>j+1))}),()=>{z=!0}},[e]),c.useEffect(()=>{if(!t){L.current=null,X(Y=>Y+1);return}let z=!1;return Se(t).then(Y=>{z||(L.current=Y,X(j=>j+1))}),()=>{z=!0}},[t]);const Z=z=>(Y,j,ae)=>{const ee=z.current;if(!ee||Y<0||j<0||Y>=ee.width||j>=ee.height)return null;const C=(j*ee.width+Y)*4,U=ee.data[C],m=ee.data[C+1],w=ee.data[C+2],T=(.299*U+.587*m+.114*w)/255;return U===m&&m===w?{lines:[K(U,"uint8",ae)],luminance:T}:{lines:[K(U,"uint8",ae),K(m,"uint8",ae),K(w,"uint8",ae)],luminance:T,colors:[re[0],re[1],re[2]]}},J=c.useMemo(()=>Z(k),[]),ie=c.useMemo(()=>Z(L),[]),fe=!!x&&!!(h!=null&&h.enabled)&&!!p&&!!e&&((((ue=x.boxes)==null?void 0:ue.length)??0)>0||(((Q=x.masks)==null?void 0:Q.length)??0)>0),{gammaFilterId:he,filterStr:oe,gamma:pe,offset:be}=Rt(d),ve=`translate(${f.x}px, ${f.y}px) scale(${s})`,me=P==="auto"?void 0:P,{containerProps:se,modifierActive:ce}=Ue({containerRef:E,zoom:s,pan:f,onViewportChange:g});return i.jsxs("div",{className:"relative flex flex-col h-full",children:[i.jsx(Gt,{id:he,gamma:pe,offset:be}),i.jsxs("div",{ref:E,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...se.style},onPointerDown:se.onPointerDown,onPointerMove:se.onPointerMove,onPointerUp:se.onPointerUp,onPointerCancel:se.onPointerCancel,children:[i.jsxs("div",{className:"relative w-full h-full",children:[i.jsxs("div",{className:"relative w-full h-full",style:{transform:ve,transformOrigin:"0 0"},children:[i.jsx("img",{ref:N,src:e??void 0,alt:"pred",className:"w-full h-full object-contain block",draggable:!1,style:{filter:oe,imageRendering:me,...n==="blend"?{opacity:r}:{}},onLoad:z=>{const Y=z.currentTarget;M({w:Y.naturalWidth,h:Y.naturalHeight})}}),fe&&i.jsx(Ke,{data:x,settings:h,naturalWidth:p.w,naturalHeight:p.h})]}),i.jsx("div",{className:"absolute inset-0 overflow-hidden",style:n==="split"?{clipPath:`inset(0 ${(1-o)*100}% 0 0)`}:void 0,children:i.jsx("div",{className:"w-full h-full",style:{transform:ve,transformOrigin:"0 0"},children:i.jsx("img",{ref:R,src:t??void 0,alt:"ref",className:"w-full h-full object-contain block",draggable:!1,style:{filter:oe,imageRendering:me,...n==="blend"?{opacity:1-r}:{}},onLoad:z=>{const Y=z.currentTarget;u({w:Y.naturalWidth,h:Y.naturalHeight})}})})}),n==="split"&&i.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${o*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:()=>a==null?void 0:a(.5),onPointerDown:z=>{z.stopPropagation(),z.preventDefault();const j=z.currentTarget.parentElement.getBoundingClientRect(),ae=C=>{a==null||a(Math.max(0,Math.min(1,(C.clientX-j.left)/j.width)))},ee=()=>{window.removeEventListener("pointermove",ae),window.removeEventListener("pointerup",ee)};window.addEventListener("pointermove",ae),window.addEventListener("pointerup",ee)},children:i.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?i.jsxs(i.Fragment,{children:[t&&S&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-o)*100}% 0 0)`},children:i.jsx(_e,{imageElRef:R,naturalWidth:S.w,naturalHeight:S.h,zoom:s,pan:f,sample:ie,notation:_,version:$})}),e&&p&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${o*100}%)`},children:i.jsx(_e,{imageElRef:N,naturalWidth:p.w,naturalHeight:p.h,zoom:s,pan:f,sample:J,notation:_,version:$,onActiveChange:B})})]}):e&&p&&i.jsx(_e,{imageElRef:N,naturalWidth:p.w,naturalHeight:p.h,zoom:s,pan:f,sample:J,notation:_,version:$,onActiveChange:B}),I&&i.jsx(Pt,{notation:_,onChange:D})]}),i.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),i.jsxs("span",{className:`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${y&&!ce?" cairn-drag-grip":""}`,draggable:y&&!ce,onDragStart:l,style:{cursor:y&&!ce?"grab":void 0},children:[i.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50"}),v]})]})}const gr={zoom:1,pan:{x:0,y:0}};function mr(e){const t=Be(e),n=new Float32Array(256*4);for(let o=0;o<256;o++)n[o*4+0]=t[o*3+0]/255,n[o*4+1]=t[o*3+1]/255,n[o*4+2]=t[o*3+2]/255,n[o*4+3]=1;return n}function pr({imageUrl:e,baselineUrl:t,mode:n,splitPosition:o,blendAlpha:r,onSplitPositionChange:a,diffSubmode:s,colormap:f="none",zoom:g,pan:d,onViewportChange:P,interpolation:v="auto",label:y="",pixelValueNotation:l="decimal"}){const x=c.useRef(null),h=c.useRef(null),b=c.useRef(null),[E,p]=c.useState(!1),[M,S]=c.useState(!1),[u,_]=c.useState(null),[D,I]=c.useState(0),[B,N]=c.useState(0),[R,k]=c.useState(null),[L,$]=c.useState(l),[X,Z]=c.useState(!1),[J,ie]=c.useState({x:0,y:0,w:1,h:1}),fe=c.useRef(null),he=c.useRef(null),[oe,pe]=c.useState(0),be=Ze();c.useEffect(()=>{const C=h.current;if(!C)return;let U=!1;return Ae().then(m=>{if(!U)try{if(It())throw new Error("cairn-plot engine: forced compare-pane activation failure (?forceEngineFail test hook)");const w=m.createSurface(C,{hdr:!1});b.current={device:m,surface:w,texA:null,texB:null},S(!0)}catch(w){console.warn("cairn-plot: GpuComparePane failed to activate, falling back to legacy pane",w),p(!0)}}).catch(m=>{U||(console.warn("cairn-plot: GpuComparePane could not resolve a GPU device, falling back to legacy pane",m),p(!0))}),()=>{var w,T;U=!0;const m=b.current;m&&((w=m.texA)==null||w.destroy(),(T=m.texB)==null||T.destroy(),b.current=null)}},[]),c.useEffect(()=>{const C=x.current;if(!C)return;const U=new ResizeObserver(()=>N(m=>m+1));return U.observe(C),()=>U.disconnect()},[]),c.useEffect(()=>{if(!M)return;let C=!1;if(!b.current)return;async function m(w){return w?Se(w):null}return Promise.all([m(e),m(t)]).then(([w,T])=>{var F,H;if(C||!b.current)return;const A=b.current;fe.current=w,he.current=T,(F=A.texA)==null||F.destroy(),(H=A.texB)==null||H.destroy(),A.texA=null,A.texB=null;const O=w??T;if(!O){_(null),pe(W=>W+1);return}const G=W=>{const te=A.device.createTexture(W.width,W.height,"rgba8unorm");return te.write(W.data),te};A.texA=G(T??O),A.texB=G(w??O),_({w:O.width,h:O.height}),pe(W=>W+1),I(W=>W+1)}),()=>{C=!0}},[M,e,t]);const ve=c.useMemo(()=>(s??"").includes("signed")?"signed":"positive",[s]),me=c.useMemo(()=>f!=="none"?mr(f):void 0,[f]),se=c.useCallback(()=>{const C=b.current;if(!M||!C||!C.surface||!C.texA||!C.texB||!u)return;const U=x.current,m=U?U.getBoundingClientRect():{width:u.w,height:u.h},w=$t({zoom:g,pan:d},m,u.w,u.h);ie(F=>F.x===w.x&&F.y===w.y&&F.w===w.w&&F.h===w.h?F:w);const T=h.current;if(m.width>0&&m.height>0&&T&&C.surface){const F=Math.max(1,Math.round(m.width*be)),H=Math.max(1,Math.round(m.height*be));(T.width!==F||T.height!==H)&&(T.width=F,T.height=H,C.surface.configure(F,H))}const A=Xt(w,m,u.w,u.h)>=je?"nearest":"linear",G={exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:w,filter:A,mode:n,split:o,alpha:r,diffSubmode:s??"absolute",diffCmapMode:ve,diffColormap:n==="diff"?me:void 0};try{Rn(C.device,C.surface,C.texA,C.texB,G)}catch(F){console.warn("cairn-plot: GpuComparePane renderCompare failed, falling back to legacy pane",F),p(!0)}},[M,u,g,d.x,d.y,n,o,r,s,ve,me,be]);c.useEffect(()=>{se()},[se,D,B]),c.useEffect(()=>{const C=b.current;if(!M||!C||!C.texA||!C.texB||!t){k(null);return}let U=!1;return Gn(C.device,C.texA,C.texB).then(m=>{U||k(m)}),()=>{U=!0}},[M,D,t]);const ce=C=>(U,m,w)=>{const T=C.current;if(!T||U<0||m<0||U>=T.width||m>=T.height)return null;const A=(m*T.width+U)*4,O=T.data[A],G=T.data[A+1],F=T.data[A+2],H=(.299*O+.587*G+.114*F)/255;return O===G&&G===F?{lines:[K(O,"uint8",w)],luminance:H}:{lines:[K(O,"uint8",w),K(G,"uint8",w),K(F,"uint8",w)],luminance:H,colors:[re[0],re[1],re[2]]}},ue=c.useMemo(()=>ce(fe),[]),Q=c.useMemo(()=>ce(he),[]),{containerProps:z}=Ue({containerRef:x,zoom:g,pan:d,onViewportChange:P,naturalWidth:u==null?void 0:u.w,naturalHeight:u==null?void 0:u.h}),Y=c.useCallback(()=>P==null?void 0:P(gr),[P]),j=v==="auto"?void 0:v,ae=at({rootRef:x,canvasRef:h,zoom:g,pan:d,onViewportChange:P,naturalWidth:u==null?void 0:u.w,naturalHeight:u==null?void 0:u.h,requestRender:se}),ee=c.useMemo(()=>({...rt,leadingButtons:X?[ot(L,$)]:[]}),[X,L]);return E?n==="diff"?i.jsx(it,{imageUrl:e,baselineUrl:t,diffMode:s??"signed",interpolation:v,colormap:f,showAxes:!1,zoom:g,pan:d,onViewportChange:P,label:y,pixelValueNotation:l}):i.jsx(hr,{imageUrl:e,baselineUrl:t,mode:n,splitPosition:o,blendAlpha:r,onSplitPositionChange:a,zoom:g,pan:d,onViewportChange:P,interpolation:v,label:y,pixelValueNotation:l}):i.jsxs("div",{className:"group relative flex flex-col h-full","data-gpu-compare-pane":!0,"data-gpu-compare-ready":M,children:[i.jsx(nt,{controller:ae,config:ee}),i.jsxs("div",{ref:x,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:0,...z.style},onPointerDown:z.onPointerDown,onPointerMove:z.onPointerMove,onPointerUp:z.onPointerUp,onPointerCancel:z.onPointerCancel,onDoubleClick:Y,"data-gpu-compare-viewport":!0,children:[i.jsxs("div",{className:"relative w-full h-full flex items-center justify-center",children:[i.jsx("canvas",{ref:h,className:"w-full h-full block",style:{imageRendering:j},"data-gpu-compare-canvas":!0}),n==="split"&&i.jsx("div",{className:"absolute top-0 bottom-0 z-20 flex items-center",style:{left:`${o*100}%`,transform:"translateX(-50%)",cursor:"col-resize"},onDoubleClick:C=>{C.stopPropagation(),a==null||a(.5)},onPointerDown:C=>{C.stopPropagation(),C.preventDefault();const m=C.currentTarget.parentElement.getBoundingClientRect(),w=A=>{a==null||a(Math.max(0,Math.min(1,(A.clientX-m.left)/m.width)))},T=()=>{window.removeEventListener("pointermove",w),window.removeEventListener("pointerup",T)};window.addEventListener("pointermove",w),window.addEventListener("pointerup",T)},children:i.jsx("div",{className:"w-1 h-full bg-accent/80 rounded-full"})})]}),n==="split"?i.jsxs(i.Fragment,{children:[t&&u&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 ${(1-o)*100}% 0 0)`},children:i.jsx(_e,{imageElRef:h,naturalWidth:u.w,naturalHeight:u.h,zoom:g,pan:d,sourceWindow:J,sample:Q,notation:L,version:oe})}),t&&u&&i.jsx("div",{className:"absolute inset-0 overflow-hidden pointer-events-none",style:{clipPath:`inset(0 0 0 ${o*100}%)`},children:i.jsx(_e,{imageElRef:h,naturalWidth:u.w,naturalHeight:u.h,zoom:g,pan:d,sourceWindow:J,sample:ue,notation:L,version:oe,onActiveChange:Z})})]}):u&&i.jsx(_e,{imageElRef:h,naturalWidth:u.w,naturalHeight:u.h,zoom:g,pan:d,sourceWindow:J,sample:ue,notation:L,version:oe,onActiveChange:Z})]}),i.jsx("span",{className:"absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm",children:"REF"}),y?i.jsx("span",{className:"absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm",children:y}):null,R&&i.jsxs("span",{className:"absolute right-1.5 top-9 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm font-mono","data-gpu-compare-metrics":!0,children:["MSE ",R.mse.toExponential(2)," · PSNR ",Number.isFinite(R.psnr)?R.psnr.toFixed(1):"∞"," dB · MAE"," ",R.mae.toExponential(2)]})]})}const br="cairn-plot:gpu-image-ready";async function vr(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}try{await Ae(),window.__cairnPlotGpuImagePane=dr,window.__cairnPlotGpuComparePane=pr,window.__cairnPlotUseGpuImage=!0,window.__cairnPlotGpuImageLoaded=!0,window.dispatchEvent(new Event(br))}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}vr()})(__cairnPlotJsxRuntime,__cairnPlotReact);

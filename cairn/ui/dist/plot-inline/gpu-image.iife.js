var jt=Object.defineProperty;var Jt=(y,b,J)=>b in y?jt(y,b,{enumerable:!0,configurable:!0,writable:!0,value:J}):y[b]=J;var _=(y,b,J)=>Jt(y,typeof b!="symbol"?b+"":b,J);(function(y,b){"use strict";function J(e,t){switch(t){case"rgba8unorm":return{internalFormat:e.RGBA8,format:e.RGBA,type:e.UNSIGNED_BYTE};case"rgba16float":return{internalFormat:e.RGBA16F,format:e.RGBA,type:e.HALF_FLOAT};case"rgba32float":return{internalFormat:e.RGBA32F,format:e.RGBA,type:e.FLOAT};case"r32float":return{internalFormat:e.R32F,format:e.RED,type:e.FLOAT};default:{const n=t;throw new Error(`webgl2 device: unknown TextureFormat ${String(n)}`)}}}function $e(e){return e==="rgba16float"||e==="rgba32float"||e==="r32float"}function We(e){const t="#pragma vertex",n="#pragma fragment",r=e.indexOf(t),i=e.indexOf(n);if(r===-1||i===-1||i<r)throw new Error("webgl2 device: shaderGLSL must contain '#pragma vertex' followed by '#pragma fragment' (see engine/shaders/passthrough.glsl.ts)");const a=e.slice(r+t.length,i).trim(),g=e.slice(i+n.length).trim();return{vertex:a,fragment:g}}function ve(e,t,n){const r=e.createShader(t);if(!r)throw new Error("webgl2 device: gl.createShader failed");if(e.shaderSource(r,n),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS)){const i=e.getShaderInfoLog(r);e.deleteShader(r);const a=t===e.VERTEX_SHADER?"vertex":"fragment";throw new Error(`webgl2 device: ${a} shader compile failed: ${i}
---source---
${n}`)}return r}function Ye(e,t,n){const r=ve(e,e.VERTEX_SHADER,t),i=ve(e,e.FRAGMENT_SHADER,n),a=e.createProgram();if(!a)throw new Error("webgl2 device: gl.createProgram failed");if(e.attachShader(a,r),e.attachShader(a,i),e.linkProgram(a),e.deleteShader(r),e.deleteShader(i),!e.getProgramParameter(a,e.LINK_STATUS)){const g=e.getProgramInfoLog(a);throw e.deleteProgram(a),new Error(`webgl2 device: program link failed: ${g}`)}return a}function He(){const e=document.createElement("canvas");e.width=1,e.height=1;const t=e.getContext("webgl2");if(!t)throw new Error("webgl2 device: WebGL2 is not supported in this browser");const n=!!t.getExtension("EXT_color_buffer_float"),r=t.getExtension("WEBGL_lose_context");return r==null||r.loseContext(),{hdr:!1,compute:!1,float16:n}}class we{constructor(t,n,r,i){_(this,"width");_(this,"height");_(this,"format");_(this,"glTexture");_(this,"gl");_(this,"info");_(this,"destroyed",!1);this.gl=t,this.width=n,this.height=r,this.format=i,this.info=J(t,i);const a=t.createTexture();if(!a)throw new Error("webgl2 device: gl.createTexture failed");this.glTexture=a,t.bindTexture(t.TEXTURE_2D,a),t.texImage2D(t.TEXTURE_2D,0,this.info.internalFormat,n,r,0,this.info.format,this.info.type,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.bindTexture(t.TEXTURE_2D,null)}write(t){if(this.destroyed)throw new Error("webgl2 device: write() on a destroyed texture");const n=this.gl;n.bindTexture(n.TEXTURE_2D,this.glTexture),n.pixelStorei(n.UNPACK_ALIGNMENT,1),n.texSubImage2D(n.TEXTURE_2D,0,0,0,this.width,this.height,this.info.format,this.info.type,t),n.bindTexture(n.TEXTURE_2D,null)}destroy(){this.destroyed||(this.gl.deleteTexture(this.glTexture),this.destroyed=!0)}}class xe{constructor(t,n){_(this,"_s");_(this,"glSampler");const r=t.createSampler();if(!r)throw new Error("webgl2 device: gl.createSampler failed");this.glSampler=r;const i=(n==null?void 0:n.filter)==="nearest"?t.NEAREST:t.LINEAR;t.samplerParameteri(r,t.TEXTURE_MIN_FILTER,i),t.samplerParameteri(r,t.TEXTURE_MAG_FILTER,i),t.samplerParameteri(r,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.samplerParameteri(r,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this._s=r}}class qe{constructor(t,n){_(this,"_p");_(this,"program");_(this,"targetFormat");this.program=t,this.targetFormat=n,this._p=t}}class Ke{constructor(t){_(this,"_b");_(this,"entries");this.entries=t,this._b=t}destroy(){}}class Ze{constructor(t){_(this,"canvas");_(this,"hdr",!1);this.canvas=t}configure(t,n){this.canvas.width=t,this.canvas.height=n}getCurrentTextureView(){return null}}function je(e,t,n,r){const i=e.getUniformLocation(t,`u_bind${n}`);if(!i)return;if(r instanceof Int32Array)switch(r.length){case 1:e.uniform1iv(i,r);return;case 2:e.uniform2iv(i,r);return;case 3:e.uniform3iv(i,r);return;case 4:e.uniform4iv(i,r);return;default:e.uniform1iv(i,r);return}const a=r instanceof Float32Array?r:new Float32Array(r.buffer,r.byteOffset,r.byteLength/4);switch(a.length){case 1:e.uniform1fv(i,a);return;case 2:e.uniform2fv(i,a);return;case 3:e.uniform3fv(i,a);return;case 4:e.uniform4fv(i,a);return;case 16:e.uniformMatrix4fv(i,!1,a);return;default:e.uniform1fv(i,a);return}}function Ee(){let e=null,t=null,n=null,r=null;const i=He();function a(o,c){e=o,t=c,n=o.createFramebuffer(),r=o.createVertexArray(),o.getExtension("OES_texture_float_linear"),o.getExtension("EXT_color_buffer_float")}function g(){if(e)return e;const o=document.createElement("canvas");o.width=1,o.height=1;const c=o.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!c)throw new Error("webgl2 device: WebGL2 is not supported in this browser");return a(c,o),c}function p(o,c){if("canvas"in c)return o.bindFramebuffer(o.FRAMEBUFFER,null),{width:c.canvas.width,height:c.canvas.height,isFloat:!1};const l=c;o.bindFramebuffer(o.FRAMEBUFFER,n),o.framebufferTexture2D(o.FRAMEBUFFER,o.COLOR_ATTACHMENT0,o.TEXTURE_2D,l.glTexture,0);const s=o.checkFramebufferStatus(o.FRAMEBUFFER);if(s!==o.FRAMEBUFFER_COMPLETE)throw new Error(`webgl2 device: framebuffer incomplete for target texture (format=${l.format}, status=0x${s.toString(16)}). Float formats need EXT_color_buffer_float as a render target (capabilities.float16=${i.float16}).`);return{width:l.width,height:l.height,isFloat:$e(l.format)}}return{backend:"webgl2",capabilities:i,createTexture(o,c,l){const s=g();return new we(s,o,c,l)},createSampler(o){const c=g();return new xe(c,o)},createRenderPipeline(o){const c=g(),{vertex:l,fragment:s}=We(o.shaderGLSL),w=Ye(c,l,s);return new qe(w,o.targetFormat)},createComputePipeline:void 0,createBindGroup(o,c){return new Ke(c)},createSurface(o,c){if(e&&t&&t!==o)throw new Error("webgl2 device: this device already owns a WebGL2 context bound to a different canvas. WebGL2 has no cross-canvas resource sharing — create one createWebGL2Device() per on-screen canvas (see engine/pool.ts).");if(!e){const l=o.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!l)throw new Error("webgl2 device: WebGL2 is not supported on the given canvas");a(l,o)}if("drawingBufferColorSpace"in e)try{e.drawingBufferColorSpace="display-p3"}catch{}return new Ze(o)},renderFullscreen(o,c,l){const s=g(),w=c,x=l,{width:u,height:m}=p(s,o);s.viewport(0,0,u,m),s.disable(s.DEPTH_TEST),s.disable(s.BLEND),s.disable(s.CULL_FACE),s.useProgram(w.program),s.bindVertexArray(r);for(const d of x.entries){const h=d.resource;if(h instanceof we){s.activeTexture(s.TEXTURE0+d.binding),s.bindTexture(s.TEXTURE_2D,h.glTexture);const v=s.getUniformLocation(w.program,`t_bind${d.binding}`);v&&s.uniform1i(v,d.binding)}else h instanceof xe?s.bindSampler(d.binding,h.glSampler):je(s,w.program,d.binding,h.uniform)}s.drawArrays(s.TRIANGLES,0,3),s.bindVertexArray(null),s.bindFramebuffer(s.FRAMEBUFFER,null)},async readback(o){const c=g(),{width:l,height:s,isFloat:w}=p(c,o);if(w){const u=new Float32Array(l*s*4);return c.readPixels(0,0,l,s,c.RGBA,c.FLOAT,u),c.bindFramebuffer(c.FRAMEBUFFER,null),u}const x=new Uint8Array(l*s*4);return c.readPixels(0,0,l,s,c.RGBA,c.UNSIGNED_BYTE,x),c.bindFramebuffer(c.FRAMEBUFFER,null),x},destroy(){if(!e)return;n&&e.deleteFramebuffer(n),r&&e.deleteVertexArray(r);const o=e.getExtension("WEBGL_lose_context");o==null||o.loseContext(),e=null,t=null,n=null,r=null}}}const de=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function _e(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"opaque",usage:de}),{hdr:!1,format:n}}function Je(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"opaque",usage:de}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"opaque",usage:de}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return _e(e,t)}}}function fe(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Te(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Qe(e){const t=(e&32768)>>15,n=(e&31744)>>10,r=e&1023;let i;return n===0?i=r/1024*Math.pow(2,-14):n===31?i=r?NaN:1/0:i=(1+r/1024)*Math.pow(2,n-15),t?-i:i}const et={texture:0,sampler:1,uniform:2};function he(e,t){return e*3+et[t]}const tt={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function nt(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let r;for(;(r=n.exec(e))!==null;){const i=Number(r[1]),a=r[2]!==void 0,g=r[3].trim();if(a){const p=tt[g];if(p===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${g}" (binding ${i}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(i,{kind:"uniform",sizeBytes:p})}else g==="sampler"||g==="sampler_comparison"?t.set(i,{kind:"sampler"}):t.set(i,{kind:"texture"})}return t}class ye{constructor(t,n,r,i){_(this,"width");_(this,"height");_(this,"format");_(this,"gpuTexture");_(this,"device");_(this,"destroyed",!1);this.device=t,this.width=n,this.height=r,this.format=i,this.gpuTexture=t.createTexture({size:{width:n,height:r,depthOrArrayLayers:1},format:fe(i),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*Te(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class Re{constructor(t){_(this,"_s");_(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class rt{constructor(t,n,r,i,a){_(this,"_p");_(this,"gpuPipeline");_(this,"bindings");_(this,"bindGroupLayout");_(this,"variants");_(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=r,this.buildVariant=a,this.variants=new Map([[i,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function ot(e,t){const n=[];for(const[r,i]of t)i.kind==="uniform"?n.push({binding:r,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):i.kind==="sampler"?n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class it{constructor(t){_(this,"_c");_(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class at{constructor(t,n){_(this,"_b");_(this,"gpuBindGroup");_(this,"ownedBuffers");_(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class st{constructor(t,n,r,i){_(this,"canvas");_(this,"hdr");_(this,"format");_(this,"context");_(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=r.hdr,this.format=r.format,this.reconfigure=i}configure(t,n){this.canvas.width=t,this.canvas.height=n;const r=this.reconfigure();this.hdr=r.hdr,this.format=r.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function ae(e){return"canvas"in e}async function ct(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let r=null;function i(){return r||(r=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),r}function a(o){return ae(o)?o.getCurrentTextureView():o.gpuTexture.createView()}function g(o){if(ae(o))return{width:o.canvas.width,height:o.canvas.height};const c=o;return{width:c.width,height:c.height}}let p=!1;return{backend:"webgpu",capabilities:n,createTexture(o,c,l){return new ye(t,o,c,l)},createSampler(o){const c=(o==null?void 0:o.filter)==="linear"?"linear":"nearest",l=t.createSampler({magFilter:c,minFilter:c,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new Re(l)},createRenderPipeline(o){const c=t.createShaderModule({code:o.shaderWGSL}),l=nt(o.shaderWGSL),s=fe(o.targetFormat),w=ot(t,l),x=t.createPipelineLayout({bindGroupLayouts:[w]}),u=d=>t.createRenderPipeline({layout:x,vertex:{module:c,entryPoint:"vs_main"},fragment:{module:c,entryPoint:"fs_main",targets:[{format:d}]},primitive:{topology:"triangle-list"}}),m=u(s);return new rt(m,l,w,s,u)},createComputePipeline(o){const c=t.createShaderModule({code:o.shaderWGSL}),l=t.createComputePipeline({layout:"auto",compute:{module:c,entryPoint:"cs_main"}});return new it(l)},createBindGroup(o,c){const l=o,s=new Map,w=[];for(const[u,m]of l.bindings)if(m.kind==="uniform"){const d=t.createBuffer({size:m.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});w.push(d),s.set(u,{binding:u,resource:{buffer:d}})}else m.kind==="sampler"&&s.set(u,{binding:u,resource:i()});for(const u of c){const m=u.resource;if(m instanceof ye){const d=he(u.binding,"texture");l.bindings.has(d)&&s.set(d,{binding:d,resource:m.gpuTexture.createView()})}else if(m instanceof Re){const d=he(u.binding,"sampler");l.bindings.has(d)&&s.set(d,{binding:d,resource:m.gpuSampler})}else{const d=he(u.binding,"uniform"),h=l.bindings.get(d);if(h&&h.kind==="uniform"){const v=m.uniform,E=t.createBuffer({size:Math.max(h.sizeBytes,v.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(E,0,v.buffer,v.byteOffset,v.byteLength),w.push(E),s.set(d,{binding:d,resource:{buffer:E}})}}}const x=t.createBindGroup({layout:l.bindGroupLayout,entries:Array.from(s.values())});return new at(x,w)},createSurface(o,c){const l=o.getContext("webgpu");if(!l)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const s=c.hdr&&n.hdr,w=()=>s?Je(l,t):_e(l,t),x=w();return new st(o,l,x,w)},renderFullscreen(o,c,l){const s=c,w=l,x=a(o),{width:u,height:m}=g(o),d=ae(o)?o.format:fe(o.format),h=s.pipelineFor(d),v=t.createCommandEncoder(),E=v.beginRenderPass({colorAttachments:[{view:x,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});E.setPipeline(h),E.setBindGroup(0,w.gpuBindGroup),E.setViewport(0,0,u,m,0,1),E.draw(3),E.end(),t.queue.submit([v.finish()])},async readback(o){const c=ae(o),{width:l,height:s}=g(o),w=c?o.hdr?"rgba16float":"rgba8unorm":o.format,x=c&&o.format==="bgra8unorm",u=c?o.getCurrentGPUTexture():o.gpuTexture,m=Te(w),d=l*m,h=256,v=Math.ceil(d/h)*h,E=v*s,M=t.createBuffer({size:E,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),T=t.createCommandEncoder();T.copyTextureToBuffer({texture:u},{buffer:M,bytesPerRow:v,rowsPerImage:s},{width:l,height:s,depthOrArrayLayers:1}),t.queue.submit([T.finish()]),await M.mapAsync(GPUMapMode.READ);const I=new Uint8Array(M.getMappedRange()),S=new Uint8Array(d*s);for(let L=0;L<s;L++){const G=L*v,D=L*d;S.set(I.subarray(G,G+d),D)}if(M.unmap(),M.destroy(),w==="rgba8unorm"){if(x)for(let L=0;L<S.length;L+=4){const G=S[L],D=S[L+2];S[L]=D,S[L+2]=G}return S}if(w==="rgba16float"){const L=new Uint16Array(S.buffer,S.byteOffset,S.byteLength/2),G=new Float32Array(L.length);for(let D=0;D<L.length;D++)G[D]=Qe(L[D]);return G}return new Float32Array(S.buffer,S.byteOffset,S.byteLength/4)},destroy(){p||(t.destroy(),p=!0)}}}let ge=null;function ut(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceWebGL2")}catch{return!1}}async function lt(e){if(!e&&typeof navigator<"u"&&"gpu"in navigator&&!!navigator.gpu)try{return await ct()}catch{}return Ee()}function Pe(e){if(!ge){const t=ut();ge=lt(t)}return ge}function dt(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function ft(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const i=n/255*(e.length-1),a=Math.floor(i),g=Math.min(a+1,e.length-1),p=i-a,[f,o,c]=dt(e[a],e[g],p);t[n*3]=Math.round(f),t[n*3+1]=Math.round(o),t[n*3+2]=Math.round(c)}return t}const Se={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},ht=new Set(["red-green","red-blue"]),Ce=new Map;function gt(e){let t=Ce.get(e);if(!t){const n=Se[e]??Se.viridis;t=ft(n),Ce.set(e,t)}return t}function mt(e,t,n="linear"){const r=gt(t),i=new ImageData(e.width,e.height),a=e.data,g=i.data;for(let p=0;p<a.length;p+=4){const f=(a[p]+a[p+1]+a[p+2])/3;let o;n==="positive"?o=Math.round(128+f/255*127):o=Math.round(f),o=Math.max(0,Math.min(255,o)),g[p]=r[o*3],g[p+1]=r[o*3+1],g[p+2]=r[o*3+2],g[p+3]=a[p+3]}return i}function Fe(e){const t=new Map;return{get(n){return t.get(n)},set(n,r){if(t.size>=e){const i=t.keys().next().value;i!==void 0&&t.delete(i)}t.set(n,r)}}}const Le=Fe(50);function pt(e){return Le.get(e)}function bt(e,t){Le.set(e,t)}const Me=Fe(100);function vt(e){return Me.get(e)}function wt(e,t){Me.set(e,t)}async function xt(e){const t=vt(e);return t||new Promise(n=>{const r=new Image;r.onload=()=>{try{const i=document.createElement("canvas");i.width=r.naturalWidth,i.height=r.naturalHeight;const a=i.getContext("2d");if(!a){n(null);return}a.drawImage(r,0,0);const g=a.getImageData(0,0,i.width,i.height);wt(e,g),n(g)}catch(i){console.warn("[cairn] loadImageData failed:",i),n(null)}},r.onerror=i=>{console.warn("[cairn] loadImageData: image failed to load:",e,i),n(null)},r.src=e})}function Ge(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function Et({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:r}){const i=Ge(e),a=Ge(t),g=[];for(let h=0;h<=e;h+=i)g.push(h);const p=[];for(let h=0;h<=t;h+=a)p.push(h);const f=1/n,o=8*f,c=-12*f,l=-2*f,s=r==null?void 0:r.current;let w=0,x=0,u=0,m=0;if(s){const h=s.clientWidth,v=s.clientHeight,E=h/e,M=v/t,T=Math.min(E,M);u=e*T,m=t*T,w=(h-u)/2,x=(v-m)/2}const d=s&&u>0;return y.jsxs(y.Fragment,{children:[y.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:d?x:0,transform:`translateY(${c}px)`,fontSize:o},children:g.map(h=>y.jsx("span",{className:"mono",style:{position:"absolute",left:d?w+h/e*u:`${h/e*100}%`,transform:"translateX(-50%)"},children:h},h))}),y.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:d?w:0,transform:`translateX(${l}px)`,fontSize:o},children:p.map(h=>y.jsx("span",{className:"mono",style:{position:"absolute",top:d?x+h/t*m:`${h/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*f}px`},children:h},h))})]})}function _t({label:e,isDraggable:t,onDragStart:n}){return y.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&y.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const Ae=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function me(e){const t=Ae.length;return Ae[(e%t+t)%t]}function Tt(e){const n=b.useRef(null),[r,i]=b.useState({w:0,h:0}),a=b.useRef(null),g=b.useRef(null);return b.useEffect(()=>{var o;const p=n.current;if(p===g.current||((o=a.current)==null||o.disconnect(),a.current=null,g.current=p,!p))return;const f=new ResizeObserver(c=>{for(const l of c)i({w:l.contentRect.width,h:l.contentRect.height})});a.current=f,f.observe(p)}),b.useEffect(()=>()=>{var p;return(p=a.current)==null?void 0:p.disconnect()},[]),{ref:n,size:r}}function yt(){const[e,t]=b.useState(!1);return b.useEffect(()=>{const n=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!0)},r=a=>{(a.key==="Alt"||a.key==="Control"||a.key==="Meta")&&t(!1)},i=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",r),window.addEventListener("blur",i),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",r),window.removeEventListener("blur",i)}},[]),e}const Rt=.25,Pt=16;function St(e){const{containerRef:t,zoom:n,pan:r,onViewportChange:i,minZoom:a=Rt,maxZoom:g=Pt}=e,p=yt(),f=b.useRef(p);f.current=p;const o=b.useRef({zoom:n,pan:r});o.current={zoom:n,pan:r};const c=b.useRef(i);c.current=i,b.useEffect(()=>{const m=t.current;if(!m||!i)return;const d=h=>{var D;if(!f.current)return;h.preventDefault(),h.stopPropagation();const v=h.deltaY<0?1.1:1/1.1,E=o.current,M=Math.max(a,Math.min(g,E.zoom*v));if(E.zoom===M)return;const T=m.getBoundingClientRect(),I=h.clientX-T.left,S=h.clientY-T.top,L=I-(I-E.pan.x)/E.zoom*M,G=S-(S-E.pan.y)/E.zoom*M;(D=c.current)==null||D.call(c,{zoom:M,pan:{x:L,y:G}})};return m.addEventListener("wheel",d,{passive:!1}),()=>m.removeEventListener("wheel",d)},[t,!!i,a,g]);const l=b.useRef(null),s=b.useCallback(m=>{!f.current||!c.current||(m.currentTarget.setPointerCapture(m.pointerId),l.current={pointerId:m.pointerId,startX:m.clientX,startY:m.clientY,panX:o.current.pan.x,panY:o.current.pan.y})},[]),w=b.useCallback(m=>{var E;const d=l.current;if(!d||d.pointerId!==m.pointerId)return;const h=m.clientX-d.startX,v=m.clientY-d.startY;(E=c.current)==null||E.call(c,{zoom:o.current.zoom,pan:{x:d.panX+h,y:d.panY+v}})},[]),x=b.useCallback(m=>{const d=l.current;if(!(!d||d.pointerId!==m.pointerId)){try{m.currentTarget.releasePointerCapture(m.pointerId)}catch{}l.current=null}},[]),u=p&&!!i;return{containerProps:{onPointerDown:s,onPointerMove:w,onPointerUp:x,onPointerCancel:x,style:{cursor:u?"move":void 0,touchAction:u?"none":void 0}},modifierActive:p}}function Ct(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function Ue(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function Ft({data:e,settings:t,naturalWidth:n,naturalHeight:r}){const{ref:i,size:a}=Tt(),g=b.useRef(null),p=b.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),f=b.useMemo(()=>{const u=a.w,m=a.h;if(u<=0||m<=0||n<=0||r<=0)return null;const d=Math.min(u/n,m/r),h=n*d,v=r*d;return{left:(u-h)/2,top:(m-v)/2,width:h,height:v}},[a.w,a.h,n,r]),o=e.masks,c=t.showMasks&&!!o&&o.length>0,l=b.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(b.useEffect(()=>{if(!c||!o)return;const u=g.current;if(!u)return;(u.width!==n||u.height!==r)&&(u.width=n,u.height=r);const m=u.getContext("2d");if(!m)return;m.clearRect(0,0,u.width,u.height);let d=!1;const h=m.createImageData(n,r),v=h.data;let E=o.length,M=!1;const T=()=>{d||M&&m.putImageData(h,0,0)},I=document.createElement("canvas");I.width=n,I.height=r;const S=I.getContext("2d",{willReadFrequently:!0});for(const L of o){const G=new Image;G.onload=()=>{if(!d){if(S){S.clearRect(0,0,n,r),S.drawImage(G,0,0,n,r);const D=S.getImageData(0,0,n,r).data;for(let k=0;k<n*r;k++){const V=D[k*4];if(V===0||p.has(V))continue;const[Y,ne,H]=Ct(me(V));v[k*4]=Y,v[k*4+1]=ne,v[k*4+2]=H,v[k*4+3]=255,M=!0}}E-=1,E===0&&T()}},G.onerror=()=>{E-=1,E===0&&T()},G.src=`data:image/png;base64,${L.png_b64}`}return()=>{d=!0}},[c,o,n,r,l]),!f)return y.jsx("div",{ref:i,className:"absolute inset-0 pointer-events-none"});const s=e.boxes??[],w=t.showBoxes&&s.length>0,x=e.class_labels??{};return y.jsxs("div",{ref:i,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[c&&y.jsx("canvas",{ref:g,className:"absolute",style:{left:f.left,top:f.top,width:f.width,height:f.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),w&&y.jsx("svg",{className:"absolute",style:{left:f.left,top:f.top,width:f.width,height:f.height,overflow:"visible"},viewBox:`0 0 ${n} ${r}`,preserveAspectRatio:"none",children:s.map((u,m)=>{if(!Ue(u,t,p))return null;const d=u.domain==="pixel"?1:n,h=u.domain==="pixel"?1:r,v=u.position.minX*d,E=u.position.minY*h,M=(u.position.maxX-u.position.minX)*d,T=(u.position.maxY-u.position.minY)*h;return y.jsx("rect",{x:v,y:E,width:M,height:T,fill:"none",stroke:me(u.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},m)})}),w&&y.jsx("div",{className:"absolute",style:{left:f.left,top:f.top,width:f.width,height:f.height},children:s.map((u,m)=>{if(!Ue(u,t,p))return null;const d=u.domain==="pixel"?1/n:1,h=u.domain==="pixel"?1/r:1,v=u.position.minX*d*100,E=u.position.minY*h*100,M=u.label??x[String(u.class_id)]??`#${u.class_id}`,T=u.score!=null?` ${(u.score*100).toFixed(0)}%`:"";return!M&&!T?null:y.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${v}%`,top:`${E}%`,transform:"translateY(-100%)",backgroundColor:me(u.class_id)},children:y.jsxs("span",{className:"mono",children:[M,T]})},m)})})]})}const Lt=30,Q=["#ff5a5a","#39d353","#5b9bff"];function pe(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function z(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):pe(e/255):pe(n==="int"?e*255:e)}function Mt({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:r,pan:i,sample:a,notation:g="decimal",version:p=0,onActiveChange:f}){const o=b.useRef(null),c=b.useRef(!1),l=b.useRef(f);l.current=f;const s=b.useCallback(x=>{var u;x!==c.current&&(c.current=x,(u=l.current)==null||u.call(l,x))},[]),w=b.useCallback(()=>{var re;const x=o.current,u=e.current;if(!x)return;const m=window.devicePixelRatio||1,d=x.clientWidth,h=x.clientHeight;if(d===0||h===0)return;x.width!==Math.round(d*m)&&(x.width=Math.round(d*m)),x.height!==Math.round(h*m)&&(x.height=Math.round(h*m));const v=x.getContext("2d");if(!v)return;if(v.setTransform(m,0,0,m,0,0),v.clearRect(0,0,d,h),!u||t<=0||n<=0){s(!1);return}const E=u.getBoundingClientRect(),M=x.getBoundingClientRect();if(E.width===0||E.height===0){s(!1);return}const T=Math.min(E.width/t,E.height/n);if(T<Lt){s(!1);return}const I=t*T,S=n*T,L=E.left+(E.width-I)/2-M.left,G=E.top+(E.height-S)/2-M.top,D=Math.max(0,Math.floor((0-L)/T)),k=Math.min(t,Math.ceil((d-L)/T)),V=Math.max(0,Math.floor((0-G)/T)),Y=Math.min(n,Math.ceil((h-G)/T));if(k<=D||Y<=V){s(!1);return}s(!0),v.textAlign="center",v.textBaseline="middle",v.lineJoin="round";const ne=T*.14,H=T-ne*2;for(let q=V;q<Y;q++)for(let ee=D;ee<k;ee++){const N=a(ee,q,g);if(!N||N.lines.length===0)continue;const K=N.lines.length;let oe=1;for(const O of N.lines)O.length>oe&&(oe=O.length);const se=H/(K*1.15),ce=H/(oe*.62)||se,Z=Math.min(se,ce,24);if(Z<6)continue;const R=L+(ee+.5)*T,P=G+(q+.5)*T,C=Z*1.15,F=N.luminance<=.55,U=F?"#ffffff":"#000000";v.font=`${Z}px ui-monospace, SFMono-Regular, Menlo, monospace`,v.lineWidth=Math.max(1.4,Z*.16),v.strokeStyle=F?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let A=P-K*C/2+C/2;for(let O=0;O<N.lines.length;O++){const X=N.lines[O];v.strokeText(X,R,A),v.fillStyle=((re=N.colors)==null?void 0:re[O])??U,v.fillText(X,R,A),A+=C}}},[e,t,n,a,g,s]);return b.useEffect(()=>{w()},[w,r,i.x,i.y,p,g]),b.useEffect(()=>{const x=o.current;if(!x)return;const u=new ResizeObserver(()=>w());return u.observe(x),()=>u.disconnect()},[w]),y.jsx("canvas",{ref:o,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function Gt({notation:e,onChange:t,className:n=""}){return y.jsx("button",{type:"button",onClick:r=>{r.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:r=>r.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const At=`
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

// operatorId: 0=linear, 1=srgb, 2=reinhard, 3=aces (matches TONEMAP_OPERATORS
// key order in image/tonemap.ts). linear/srgb are the SAME clamp — the sRGB
// OETF lives in outputEncodeF, not here.
fn applyOperator(rgb: vec3<f32>, operatorId: i32) -> vec3<f32> {
  if (operatorId == 2) {
    return vec3<f32>(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z));
  }
  if (operatorId == 3) {
    return vec3<f32>(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z));
  }
  // 0 (linear) and 1 (srgb), and any unrecognized id, fall back to the clamp.
  return clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let srcDims = vec2<f32>(textureDimensions(t_bind0));
  let uvRect = u_bind3;
  let uv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(0.999999));
  let srcUV = clamp(uvRect.xy + uv * uvRect.zw, vec2<f32>(0.0), vec2<f32>(0.999999));
  let coord = vec2<i32>(srcUV * srcDims);
  let sampled = textureLoad(t_bind0, coord, 0);

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
`,Ut=`#pragma vertex
#version 300 es
// Fullscreen-triangle vertex shader — see passthrough.glsl.ts's doc comment.
out vec2 v_uv;
void main() {
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
#pragma fragment
#version 300 es
precision highp float;
precision highp int;

// Bind-group convention (see engine/webgl2/device.ts doc comment):
//   - Texture entry at binding=0 -> t_bind0 (source image).
//   - Texture entry at binding=1 -> t_bind1 (256x1 colormap LUT, or a 1x1
//     placeholder when ImageParams.colormap is absent).
//   - {uniform} entry at binding=2 -> u_bind2 (vec4: exposureEV, operator,
//     gamma, isScalar) — see image.wgsl.ts's doc comment for field order.
//   - {uniform} entry at binding=3 -> u_bind3 (vec4: uvRect.x, .y, .w, .h).
//   - {uniform} entry at binding=4 -> u_bind4 (float: hdrOut).
uniform sampler2D t_bind0;
uniform sampler2D t_bind1;
uniform vec4 u_bind2;
uniform vec4 u_bind3;
uniform float u_bind4;

in vec2 v_uv;
out vec4 fragColor;

// --- ported verbatim from image/tonemap.ts ---

float srgbOetf(float x) {
  float v = clamp(x, 0.0, 1.0);
  if (v <= 0.0031308) {
    return 12.92 * v;
  }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

float outputEncodeF(float x, float gamma, bool hasGamma) {
  if (hasGamma) {
    return clamp(pow(clamp(x, 0.0, 1.0), 1.0 / gamma), 0.0, 1.0);
  }
  return srgbOetf(x);
}

float reinhardCurve(float x) {
  float v = max(x, 0.0);
  return v / (1.0 + v);
}

float acesCurve(float x) {
  float v = max(x, 0.0);
  float num = v * (2.51 * v + 0.03);
  float den = v * (2.43 * v + 0.59) + 0.14;
  return clamp(num / den, 0.0, 1.0);
}

// operatorId: 0=linear, 1=srgb, 2=reinhard, 3=aces — matches image.wgsl.ts.
vec3 applyOperator(vec3 rgb, int operatorId) {
  if (operatorId == 2) {
    return vec3(reinhardCurve(rgb.x), reinhardCurve(rgb.y), reinhardCurve(rgb.z));
  }
  if (operatorId == 3) {
    return vec3(acesCurve(rgb.x), acesCurve(rgb.y), acesCurve(rgb.z));
  }
  return clamp(rgb, 0.0, 1.0);
}

void main() {
  vec2 srcDims = vec2(textureSize(t_bind0, 0));
  vec4 uvRect = u_bind3;
  vec2 uv = clamp(v_uv, 0.0, 0.999999);
  vec2 srcUV = clamp(uvRect.xy + uv * uvRect.zw, 0.0, 0.999999);
  ivec2 coord = ivec2(srcUV * srcDims);
  vec4 sampled = texelFetch(t_bind0, coord, 0);

  float exposureEV = u_bind2.x;
  int operatorId = int(round(u_bind2.y));
  float gamma = u_bind2.z;
  bool isScalar = u_bind2.w > 0.5;
  bool hdrOut = u_bind4 > 0.5;

  // 1) exposure, in scene-linear space: v * 2^EV.
  vec3 rgb = sampled.rgb * exp2(exposureEV);

  // 2) scalar image + colormap LUT (GPU-only pipeline stage; see image.wgsl.ts doc).
  if (isScalar) {
    float idxF = clamp(rgb.x, 0.0, 1.0) * 255.0;
    // Deterministic round-half-up (matches CPU Math.round for non-negative
    // inputs) — GLSL's round() is implementation-defined at k+0.5 boundaries
    // (and can disagree with both Math.round AND WGSL's round-half-to-EVEN).
    // See image.wgsl.ts for the mirrored fix.
    int idx = clamp(int(floor(idxF + 0.5)), 0, 255);
    vec4 lutColor = texelFetch(t_bind1, ivec2(idx, 0), 0);
    rgb = lutColor.rgb;
  }

  // 3) tone-map operator: HDR [0,inf) -> display-linear [0,1].
  rgb = applyOperator(rgb, operatorId);

  // 4) output-encode (skipped for an HDR-linear target).
  if (hdrOut) {
    fragColor = vec4(rgb, 1.0);
    return;
  }
  bool hasGamma = gamma > 0.0;
  fragColor = vec4(
    outputEncodeF(rgb.r, gamma, hasGamma),
    outputEncodeF(rgb.g, gamma, hasGamma),
    outputEncodeF(rgb.b, gamma, hasGamma),
    1.0
  );
}
`,De={linear:0,srgb:1,reinhard:2,aces:3},Ie=new WeakMap;function Dt(e,t){let n=Ie.get(e);n||(n=new Map,Ie.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:At,shaderGLSL:Ut,targetFormat:t}),n.set(t,r)),r}function It(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Ot(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const r=e.createTexture(256,1,"rgba32float");return r.write(t),r}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function kt(e,t,n,r){var w;const i=It(t),a=Dt(e,i),g=Ot(e,r.isScalar?r.colormap:void 0),p=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,f=De[r.operator]??De.srgb,o=new Float32Array([r.exposureEV,f,p,r.isScalar?1:0]),c=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),l=new Float32Array([r.hdrOut?1:0]);let s;try{s=e.createBindGroup(a,[{binding:0,resource:n},{binding:1,resource:g},{binding:2,resource:{uniform:o}},{binding:3,resource:{uniform:c}},{binding:4,resource:{uniform:l}}]),e.renderFullscreen(t,a,s)}finally{(w=s==null?void 0:s.destroy)==null||w.call(s),g.destroy()}}const Nt=12,W=[];function Oe(e){const t=W.indexOf(e);t!==-1&&W.splice(t,1),W.push(e)}function Bt(e){const t=W.indexOf(e);t!==-1&&W.splice(t,1)}function be(e){e.parked||(Bt(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.device&&e.device!==e.sharedDevice&&e.device.destroy(),e.device=null,e.parked=!0)}function ke(e){for(;W.length>Nt;){const t=W.find(n=>n!==e);if(!t)break;be(t)}}function Ne(e){if(e.disposed)return;if(!e.parked&&e.surface){Oe(e),ke(e);return}const t=e.sharedDevice.backend==="webgl2"?Ee():e.sharedDevice;if(e.device=t,e.surface=t.createSurface(e.canvas,{hdr:e.hdr}),e.source){e.canvas.width=e.source.width,e.canvas.height=e.source.height,e.surface.configure(e.source.width,e.source.height);const n=t.createTexture(e.source.width,e.source.height,e.source.format);n.write(e.source.data),e.srcTexture=n}e.parked=!1,Oe(e),ke(e)}function Vt(e){return{canvas:e.canvas,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.device&&e.surface)){e.canvas.width=t.width,e.canvas.height=t.height,e.surface.configure(t.width,t.height),e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},render(t){e.disposed||!e.source||(Ne(e),!(!e.device||!e.surface||!e.srcTexture)&&kt(e.device,e.surface,e.srcTexture,t))},park(){e.disposed||be(e)},restore(){e.disposed||!e.source||Ne(e)},dispose(){e.disposed||(be(e),e.source=null,e.disposed=!0)}}}async function Xt(e,t){const n=await Pe();return Vt({canvas:e,sharedDevice:n,device:null,hdr:!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1})}function Be(e){e.dispose()}function zt(e){return"hdr"in e&&e.hdr!=null}const $t=["linear","srgb","reinhard","aces"];function Wt(e){return e&&$t.includes(e)?e:"srgb"}const $=e=>Number.isFinite(e)?e:0;function Yt(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function Ht(e){const{h:t,w:n,c:r}=Yt(e.shape),i=e.data,a=new Float32Array(n*t*4);for(let g=0;g<n*t;g++){const p=g*r;let f,o,c,l=1;r===1?f=o=c=$(i[p]):r===3?(f=$(i[p]),o=$(i[p+1]),c=$(i[p+2])):(f=$(i[p]),o=$(i[p+1]),c=$(i[p+2]),l=$(i[p+3]));const s=g*4;a[s]=f,a[s+1]=o,a[s+2]=c,a[s+3]=l}return{data:a,width:n,height:t,format:"rgba32float"}}function qt(e,t,n,r){if(n<=0||r<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const i=Math.min(t.width/n,t.height/r),a=n*i,g=r*i,p=(t.width-a)/2,f=(t.height-g)/2,o=Math.max(e.zoom,1e-6),c=1/o,l=1/o,s=(p*(1-o)-e.pan.x)/(a*o),w=(f*(1-o)-e.pan.y)/(g*o);return{x:s,y:w,w:c,h:l}}const Kt={zoom:1,pan:{x:0,y:0}};function Ve(e){var ce,Z;const t=zt(e),n=b.useRef(null),r=b.useRef(null),i=b.useRef(null),a=b.useRef(null),[g,p]=b.useState(!1),[f,o]=b.useState(null),[c,l]=b.useState(0),[s,w]=b.useState(0),x=b.useRef(null),u=b.useRef(null),[m,d]=b.useState(0),[h,v]=b.useState(e.pixelValueNotation??"decimal"),[E,M]=b.useState(!1),T=e.zoom??1,I=e.pan??{x:0,y:0},S=e.onViewportChange,L=t?"none":e.colormap??"none";b.useEffect(()=>{const R=n.current;if(!R)return;let P=!1;return Xt(R).then(C=>{if(P){Be(C);return}a.current=C,p(!0)}),()=>{P=!0,a.current&&(Be(a.current),a.current=null)}},[]);const{containerProps:G}=St({containerRef:r,zoom:T,pan:I,onViewportChange:S}),D=b.useCallback(()=>{S==null||S(Kt)},[S]);b.useEffect(()=>{const R=r.current;if(!R)return;const P=new ResizeObserver(()=>w(C=>C+1));return P.observe(R),()=>P.disconnect()},[]),b.useEffect(()=>{const R=r.current;if(!R)return;const P=new IntersectionObserver(C=>{const F=C[0];if(!F)return;const U=a.current;U&&(F.isIntersecting?U.isParked&&(U.restore(),w(A=>A+1)):U.park())},{threshold:0});return P.observe(R),()=>P.disconnect()},[]),b.useEffect(()=>{var C;if(!t||!g)return;const R=e.hdr;x.current=R;const P=Ht(R);(C=a.current)==null||C.setSource(P),o(F=>F&&F.w===P.width&&F.h===P.height?F:{w:P.width,h:P.height}),d(F=>F+1),l(F=>F+1)},[t,g,t?e.hdr:null]),b.useEffect(()=>{if(t||!g)return;const R=e,P=R.imageUrl,C=R.colormap??"none";if(!P){u.current=null,o(null),d(U=>U+1);return}let F=!1;return xt(P).then(U=>{var X,ie;if(F||!U)return;let A=U;if(C!=="none"){const B=`gpu::${P}::${C}`,j=pt(B);if(j)A=j;else{const te=ht.has(C)?"positive":"linear";A=mt(U,C,te),bt(B,A)}}u.current=U;const O={data:A.data,width:A.width,height:A.height,format:"rgba8unorm"};(X=a.current)==null||X.setSource(O),o(B=>B&&B.w===A.width&&B.h===A.height?B:{w:A.width,h:A.height}),(ie=R.onNaturalSize)==null||ie.call(R,A.width,A.height),d(B=>B+1),l(B=>B+1)}),()=>{F=!0}},[t,g,t?null:e.imageUrl,t?null:e.colormap]);const k=t?e.exposure??0:0,V=t?e.tonemap:void 0,Y=t?e.gamma:void 0;b.useEffect(()=>{const R=a.current;if(!R||!g||!f)return;const P=r.current,C=P?P.getBoundingClientRect():{width:f.w,height:f.h},F=qt({zoom:T,pan:I},C,f.w,f.h),U=t?{exposureEV:k,operator:Wt(V),gamma:Y,isScalar:!1,hdrOut:!1,uv:F}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:F};R.render(U)},[g,f,c,T,I.x,I.y,k,V,Y,s,t]);const ne=b.useCallback((R,P,C)=>{if(t){const j=x.current,te=f;if(!j||!te||R<0||P<0||R>=te.w||P>=te.h)return null;const Xe=j.shape.length===2?1:j.shape[2]??1,ue=(P*te.w+R)*Xe,le=j.data,ze=.5;return Xe===1?{lines:[z(le[ue]??0,"unit",C)],luminance:ze}:{lines:[z(le[ue]??0,"unit",C),z(le[ue+1]??0,"unit",C),z(le[ue+2]??0,"unit",C)],luminance:ze,colors:[Q[0],Q[1],Q[2]]}}const F=u.current;if(!F||R<0||P<0||R>=F.width||P>=F.height)return null;const U=(P*F.width+R)*4,A=F.data[U],O=F.data[U+1],X=F.data[U+2],ie=(.299*A+.587*O+.114*X)/255;return L!=="none"||A===O&&O===X?{lines:[z(A,"uint8",C)],luminance:ie}:{lines:[z(A,"uint8",C),z(O,"uint8",C),z(X,"uint8",C)],luminance:ie,colors:[Q[0],Q[1],Q[2]]}},[t,f,L]),H=e.showAxes??!1,re=t?e.label??"":e.label,q=e.interpolation??"auto",ee=q==="auto"?void 0:q,N=t?void 0:e.overlay,K=t?void 0:e.overlaySettings,oe=t?!1:e.isDraggable??!1,se=t?void 0:e.onDragStart;return y.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":g,children:[y.jsxs("div",{ref:r,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:H&&f?"16px 4px 4px 28px":"4px",...G.style},onPointerDown:G.onPointerDown,onPointerMove:G.onPointerMove,onPointerUp:G.onPointerUp,onPointerCancel:G.onPointerCancel,onDoubleClick:D,"data-gpu-image-viewport":!0,children:[y.jsxs("div",{ref:i,className:"relative w-full h-full",children:[y.jsx("canvas",{ref:n,className:"w-full h-full object-contain block",style:{imageRendering:ee},"data-gpu-image-canvas":!0}),H&&f&&y.jsx(Et,{naturalWidth:f.w,naturalHeight:f.h,zoom:T,containerRef:i}),N&&(K==null?void 0:K.enabled)&&f&&((((ce=N.boxes)==null?void 0:ce.length)??0)>0||(((Z=N.masks)==null?void 0:Z.length)??0)>0)&&y.jsx(Ft,{data:N,settings:K,naturalWidth:f.w,naturalHeight:f.h})]}),f&&y.jsx(Mt,{imageElRef:n,naturalWidth:f.w,naturalHeight:f.h,zoom:T,pan:I,sample:ne,notation:h,version:m,onActiveChange:M}),E&&y.jsx(Gt,{notation:h,onChange:v})]}),re?y.jsx(_t,{label:re,isDraggable:oe,onDragStart:se}):null]})}async function Zt(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}if(typeof window.__cairnPlotRegisterRenderer!="function"){console.error("cairn-plot gpu-image addon: core bundle not installed (window.__cairnPlotRegisterRenderer missing) — staying on legacy panes.");return}try{await Pe(),window.__cairnPlotRegisterRenderer("image",Ve),window.__cairnPlotRegisterRenderer("imagehdr",Ve),window.__cairnPlotGpuImageLoaded=!0}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}Zt()})(__cairnPlotJsxRuntime,__cairnPlotReact);

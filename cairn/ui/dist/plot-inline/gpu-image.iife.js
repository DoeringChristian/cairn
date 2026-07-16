var nn=Object.defineProperty;var rn=(y,v,J)=>v in y?nn(y,v,{enumerable:!0,configurable:!0,writable:!0,value:J}):y[v]=J;var _=(y,v,J)=>rn(y,typeof v!="symbol"?v+"":v,J);(function(y,v){"use strict";function J(e,t){switch(t){case"rgba8unorm":return{internalFormat:e.RGBA8,format:e.RGBA,type:e.UNSIGNED_BYTE};case"rgba16float":return{internalFormat:e.RGBA16F,format:e.RGBA,type:e.HALF_FLOAT};case"rgba32float":return{internalFormat:e.RGBA32F,format:e.RGBA,type:e.FLOAT};case"r32float":return{internalFormat:e.R32F,format:e.RED,type:e.FLOAT};default:{const n=t;throw new Error(`webgl2 device: unknown TextureFormat ${String(n)}`)}}}function He(e){return e==="rgba16float"||e==="rgba32float"||e==="r32float"}function qe(e){const t="#pragma vertex",n="#pragma fragment",r=e.indexOf(t),o=e.indexOf(n);if(r===-1||o===-1||o<r)throw new Error("webgl2 device: shaderGLSL must contain '#pragma vertex' followed by '#pragma fragment' (see engine/shaders/passthrough.glsl.ts)");const s=e.slice(r+t.length,o).trim(),b=e.slice(o+n.length).trim();return{vertex:s,fragment:b}}function ve(e,t,n){const r=e.createShader(t);if(!r)throw new Error("webgl2 device: gl.createShader failed");if(e.shaderSource(r,n),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS)){const o=e.getShaderInfoLog(r);e.deleteShader(r);const s=t===e.VERTEX_SHADER?"vertex":"fragment";throw new Error(`webgl2 device: ${s} shader compile failed: ${o}
---source---
${n}`)}return r}function Ke(e,t,n){const r=ve(e,e.VERTEX_SHADER,t),o=ve(e,e.FRAGMENT_SHADER,n),s=e.createProgram();if(!s)throw new Error("webgl2 device: gl.createProgram failed");if(e.attachShader(s,r),e.attachShader(s,o),e.linkProgram(s),e.deleteShader(r),e.deleteShader(o),!e.getProgramParameter(s,e.LINK_STATUS)){const b=e.getProgramInfoLog(s);throw e.deleteProgram(s),new Error(`webgl2 device: program link failed: ${b}`)}return s}function Ze(){const e=document.createElement("canvas");e.width=1,e.height=1;const t=e.getContext("webgl2");if(!t)throw new Error("webgl2 device: WebGL2 is not supported in this browser");const n=!!t.getExtension("EXT_color_buffer_float"),r=t.getExtension("WEBGL_lose_context");return r==null||r.loseContext(),{hdr:!1,compute:!1,float16:n}}class we{constructor(t,n,r,o){_(this,"width");_(this,"height");_(this,"format");_(this,"glTexture");_(this,"gl");_(this,"info");_(this,"destroyed",!1);this.gl=t,this.width=n,this.height=r,this.format=o,this.info=J(t,o);const s=t.createTexture();if(!s)throw new Error("webgl2 device: gl.createTexture failed");this.glTexture=s,t.bindTexture(t.TEXTURE_2D,s),t.texImage2D(t.TEXTURE_2D,0,this.info.internalFormat,n,r,0,this.info.format,this.info.type,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.bindTexture(t.TEXTURE_2D,null)}write(t){if(this.destroyed)throw new Error("webgl2 device: write() on a destroyed texture");const n=this.gl;n.bindTexture(n.TEXTURE_2D,this.glTexture),n.pixelStorei(n.UNPACK_ALIGNMENT,1),n.texSubImage2D(n.TEXTURE_2D,0,0,0,this.width,this.height,this.info.format,this.info.type,t),n.bindTexture(n.TEXTURE_2D,null)}destroy(){this.destroyed||(this.gl.deleteTexture(this.glTexture),this.destroyed=!0)}}class xe{constructor(t,n){_(this,"_s");_(this,"glSampler");const r=t.createSampler();if(!r)throw new Error("webgl2 device: gl.createSampler failed");this.glSampler=r;const o=(n==null?void 0:n.filter)==="nearest"?t.NEAREST:t.LINEAR;t.samplerParameteri(r,t.TEXTURE_MIN_FILTER,o),t.samplerParameteri(r,t.TEXTURE_MAG_FILTER,o),t.samplerParameteri(r,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.samplerParameteri(r,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this._s=r}}class je{constructor(t,n){_(this,"_p");_(this,"program");_(this,"targetFormat");this.program=t,this.targetFormat=n,this._p=t}}class Je{constructor(t){_(this,"_b");_(this,"entries");this.entries=t,this._b=t}destroy(){}}class Qe{constructor(t){_(this,"canvas");_(this,"hdr",!1);this.canvas=t}configure(t,n){this.canvas.width=t,this.canvas.height=n}getCurrentTextureView(){return null}}function et(e,t,n,r){const o=e.getUniformLocation(t,`u_bind${n}`);if(!o)return;if(r instanceof Int32Array)switch(r.length){case 1:e.uniform1iv(o,r);return;case 2:e.uniform2iv(o,r);return;case 3:e.uniform3iv(o,r);return;case 4:e.uniform4iv(o,r);return;default:e.uniform1iv(o,r);return}const s=r instanceof Float32Array?r:new Float32Array(r.buffer,r.byteOffset,r.byteLength/4);switch(s.length){case 1:e.uniform1fv(o,s);return;case 2:e.uniform2fv(o,s);return;case 3:e.uniform3fv(o,s);return;case 4:e.uniform4fv(o,s);return;case 16:e.uniformMatrix4fv(o,!1,s);return;default:e.uniform1fv(o,s);return}}const Ee=new WeakSet;function tt(e){Ee.has(e)||(Ee.add(e),e.addEventListener("webglcontextlost",t=>{t.preventDefault()},!1))}function _e(){let e=null,t=null,n=null,r=null;const o=Ze();function s(i){n=i.createFramebuffer(),r=i.createVertexArray(),i.getExtension("OES_texture_float_linear"),i.getExtension("EXT_color_buffer_float")}function b(i,c){if(e=i,t=c,tt(c),!i.isContextLost()){s(i);return}n=null,r=null;const d=()=>{c.removeEventListener("webglcontextrestored",d),e===i&&s(i)};c.addEventListener("webglcontextrestored",d,!1)}function p(){if(e)return e;const i=document.createElement("canvas");i.width=1,i.height=1;const c=i.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!c)throw new Error("webgl2 device: WebGL2 is not supported in this browser");return b(c,i),c}function f(i,c){if("canvas"in c)return i.bindFramebuffer(i.FRAMEBUFFER,null),{width:c.canvas.width,height:c.canvas.height,isFloat:!1};const d=c;i.bindFramebuffer(i.FRAMEBUFFER,n),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,d.glTexture,0);const u=i.checkFramebufferStatus(i.FRAMEBUFFER);if(u!==i.FRAMEBUFFER_COMPLETE)throw new Error(`webgl2 device: framebuffer incomplete for target texture (format=${d.format}, status=0x${u.toString(16)}). Float formats need EXT_color_buffer_float as a render target (capabilities.float16=${o.float16}).`);return{width:d.width,height:d.height,isFloat:He(d.format)}}return{backend:"webgl2",capabilities:o,createTexture(i,c,d){const u=p();return new we(u,i,c,d)},createSampler(i){const c=p();return new xe(c,i)},createRenderPipeline(i){const c=p(),{vertex:d,fragment:u}=qe(i.shaderGLSL),x=Ke(c,d,u);return new je(x,i.targetFormat)},createComputePipeline:void 0,createBindGroup(i,c){return new Je(c)},createSurface(i,c){var d;if(e&&t&&t!==i)throw new Error("webgl2 device: this device already owns a WebGL2 context bound to a different canvas. WebGL2 has no cross-canvas resource sharing — create one createWebGL2Device() per on-screen canvas (see engine/pool.ts).");if(!e){const u=i.getContext("webgl2",{alpha:!0,antialias:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1});if(!u)throw new Error("webgl2 device: WebGL2 is not supported on the given canvas");u.isContextLost()&&((d=u.getExtension("WEBGL_lose_context"))==null||d.restoreContext()),b(u,i)}if("drawingBufferColorSpace"in e)try{e.drawingBufferColorSpace="display-p3"}catch{}return new Qe(i)},renderFullscreen(i,c,d){const u=p(),x=c,l=d,{width:h,height:g}=f(u,i);u.viewport(0,0,h,g),u.disable(u.DEPTH_TEST),u.disable(u.BLEND),u.disable(u.CULL_FACE),u.useProgram(x.program),u.bindVertexArray(r);for(const m of l.entries){const w=m.resource;if(w instanceof we){u.activeTexture(u.TEXTURE0+m.binding),u.bindTexture(u.TEXTURE_2D,w.glTexture);const E=u.getUniformLocation(x.program,`t_bind${m.binding}`);E&&u.uniform1i(E,m.binding)}else w instanceof xe?u.bindSampler(m.binding,w.glSampler):et(u,x.program,m.binding,w.uniform)}u.drawArrays(u.TRIANGLES,0,3),u.bindVertexArray(null),u.bindFramebuffer(u.FRAMEBUFFER,null)},async readback(i){const c=p(),{width:d,height:u,isFloat:x}=f(c,i);if(x){const h=new Float32Array(d*u*4);return c.readPixels(0,0,d,u,c.RGBA,c.FLOAT,h),c.bindFramebuffer(c.FRAMEBUFFER,null),h}const l=new Uint8Array(d*u*4);return c.readPixels(0,0,d,u,c.RGBA,c.UNSIGNED_BYTE,l),c.bindFramebuffer(c.FRAMEBUFFER,null),l},destroy(){if(!e)return;n&&e.deleteFramebuffer(n),r&&e.deleteVertexArray(r);const i=e.getExtension("WEBGL_lose_context");i==null||i.loseContext(),e=null,t=null,n=null,r=null},isContextLost(){return e?e.isContextLost():!1}}}const fe=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC;function Te(e,t){const n=navigator.gpu.getPreferredCanvasFormat();return e.configure({device:t,format:n,alphaMode:"opaque",usage:fe}),{hdr:!1,format:n}}function nt(e,t){try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"extended"},alphaMode:"opaque",usage:fe}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"extended"}}catch{try{return e.configure({device:t,format:"rgba16float",colorSpace:"display-p3",toneMapping:{mode:"standard"},alphaMode:"opaque",usage:fe}),{hdr:!0,format:"rgba16float",colorSpace:"display-p3",toneMappingMode:"standard"}}catch{return Te(e,t)}}}function he(e){switch(e){case"rgba8unorm":return"rgba8unorm";case"rgba16float":return"rgba16float";case"rgba32float":return"rgba32float";case"r32float":return"r32float";default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function Re(e){switch(e){case"rgba8unorm":return 4;case"rgba16float":return 8;case"rgba32float":return 16;case"r32float":return 4;default:{const t=e;throw new Error(`webgpu device: unknown TextureFormat ${String(t)}`)}}}function rt(e){const t=(e&32768)>>15,n=(e&31744)>>10,r=e&1023;let o;return n===0?o=r/1024*Math.pow(2,-14):n===31?o=r?NaN:1/0:o=(1+r/1024)*Math.pow(2,n-15),t?-o:o}const ot={texture:0,sampler:1,uniform:2};function ge(e,t){return e*3+ot[t]}const it={f32:4,i32:4,u32:4,"vec2<f32>":8,vec2f:8,"vec3<f32>":12,vec3f:12,"vec4<f32>":16,vec4f:16,"mat4x4<f32>":64,mat4x4f:64};function st(e){const t=new Map,n=/@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;let r;for(;(r=n.exec(e))!==null;){const o=Number(r[1]),s=r[2]!==void 0,b=r[3].trim();if(s){const p=it[b];if(p===void 0)throw new Error(`webgpu device: parseWGSLBindings doesn't know the size of uniform type "${b}" (binding ${o}). Add it to WGSL_UNIFORM_TYPE_SIZE.`);t.set(o,{kind:"uniform",sizeBytes:p})}else b==="sampler"||b==="sampler_comparison"?t.set(o,{kind:"sampler"}):t.set(o,{kind:"texture"})}return t}class ye{constructor(t,n,r,o){_(this,"width");_(this,"height");_(this,"format");_(this,"gpuTexture");_(this,"device");_(this,"destroyed",!1);this.device=t,this.width=n,this.height=r,this.format=o,this.gpuTexture=t.createTexture({size:{width:n,height:r,depthOrArrayLayers:1},format:he(o),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT})}write(t){if(this.destroyed)throw new Error("webgpu device: write() on a destroyed texture");const n=this.width*Re(this.format);this.device.queue.writeTexture({texture:this.gpuTexture},t,{bytesPerRow:n,rowsPerImage:this.height},{width:this.width,height:this.height,depthOrArrayLayers:1})}destroy(){this.destroyed||(this.gpuTexture.destroy(),this.destroyed=!0)}}class Se{constructor(t){_(this,"_s");_(this,"gpuSampler");this.gpuSampler=t,this._s=t}}class at{constructor(t,n,r,o,s){_(this,"_p");_(this,"gpuPipeline");_(this,"bindings");_(this,"bindGroupLayout");_(this,"variants");_(this,"buildVariant");this.gpuPipeline=t,this.bindings=n,this.bindGroupLayout=r,this.buildVariant=s,this.variants=new Map([[o,t]]),this._p=t}pipelineFor(t){let n=this.variants.get(t);return n||(n=this.buildVariant(t),this.variants.set(t,n)),n}}function ct(e,t){const n=[];for(const[r,o]of t)o.kind==="uniform"?n.push({binding:r,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}):o.kind==="sampler"?n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}):n.push({binding:r,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}});return e.createBindGroupLayout({entries:n})}class ut{constructor(t){_(this,"_c");_(this,"gpuPipeline");this.gpuPipeline=t,this._c=t}}class lt{constructor(t,n){_(this,"_b");_(this,"gpuBindGroup");_(this,"ownedBuffers");_(this,"destroyed",!1);this.gpuBindGroup=t,this.ownedBuffers=n,this._b=t}destroy(){if(!this.destroyed){for(const t of this.ownedBuffers)t.destroy();this.destroyed=!0}}}class dt{constructor(t,n,r,o){_(this,"canvas");_(this,"hdr");_(this,"format");_(this,"context");_(this,"reconfigure");this.canvas=t,this.context=n,this.hdr=r.hdr,this.format=r.format,this.reconfigure=o}configure(t,n){this.canvas.width=t,this.canvas.height=n;const r=this.reconfigure();this.hdr=r.hdr,this.format=r.format}getCurrentTextureView(){return this.context.getCurrentTexture().createView()}getCurrentGPUTexture(){return this.context.getCurrentTexture()}}function se(e){return"canvas"in e}async function ft(){if(!("gpu"in navigator)||!navigator.gpu)throw new Error("webgpu device: navigator.gpu is not available in this browser");const e=await navigator.gpu.requestAdapter();if(!e)throw new Error("webgpu device: requestAdapter() returned null");const t=await e.requestDevice(),n={hdr:!0,compute:!0,float16:!0};let r=null;function o(){return r||(r=t.createSampler({magFilter:"nearest",minFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"})),r}function s(a){return se(a)?a.getCurrentTextureView():a.gpuTexture.createView()}function b(a){if(se(a))return{width:a.canvas.width,height:a.canvas.height};const i=a;return{width:i.width,height:i.height}}let p=!1;return{backend:"webgpu",capabilities:n,createTexture(a,i,c){return new ye(t,a,i,c)},createSampler(a){const i=(a==null?void 0:a.filter)==="linear"?"linear":"nearest",c=t.createSampler({magFilter:i,minFilter:i,addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});return new Se(c)},createRenderPipeline(a){const i=t.createShaderModule({code:a.shaderWGSL}),c=st(a.shaderWGSL),d=he(a.targetFormat),u=ct(t,c),x=t.createPipelineLayout({bindGroupLayouts:[u]}),l=g=>t.createRenderPipeline({layout:x,vertex:{module:i,entryPoint:"vs_main"},fragment:{module:i,entryPoint:"fs_main",targets:[{format:g}]},primitive:{topology:"triangle-list"}}),h=l(d);return new at(h,c,u,d,l)},createComputePipeline(a){const i=t.createShaderModule({code:a.shaderWGSL}),c=t.createComputePipeline({layout:"auto",compute:{module:i,entryPoint:"cs_main"}});return new ut(c)},createBindGroup(a,i){const c=a,d=new Map,u=[];for(const[l,h]of c.bindings)if(h.kind==="uniform"){const g=t.createBuffer({size:h.sizeBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});u.push(g),d.set(l,{binding:l,resource:{buffer:g}})}else h.kind==="sampler"&&d.set(l,{binding:l,resource:o()});for(const l of i){const h=l.resource;if(h instanceof ye){const g=ge(l.binding,"texture");c.bindings.has(g)&&d.set(g,{binding:g,resource:h.gpuTexture.createView()})}else if(h instanceof Se){const g=ge(l.binding,"sampler");c.bindings.has(g)&&d.set(g,{binding:g,resource:h.gpuSampler})}else{const g=ge(l.binding,"uniform"),m=c.bindings.get(g);if(m&&m.kind==="uniform"){const w=h.uniform,E=t.createBuffer({size:Math.max(m.sizeBytes,w.byteLength),usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(E,0,w.buffer,w.byteOffset,w.byteLength),u.push(E),d.set(g,{binding:g,resource:{buffer:E}})}}}const x=t.createBindGroup({layout:c.bindGroupLayout,entries:Array.from(d.values())});return new lt(x,u)},createSurface(a,i){const c=a.getContext("webgpu");if(!c)throw new Error("webgpu device: canvas.getContext('webgpu') returned null");const d=i.hdr&&n.hdr,u=()=>d?nt(c,t):Te(c,t),x=u();return new dt(a,c,x,u)},renderFullscreen(a,i,c){const d=i,u=c,x=s(a),{width:l,height:h}=b(a),g=se(a)?a.format:he(a.format),m=d.pipelineFor(g),w=t.createCommandEncoder(),E=w.beginRenderPass({colorAttachments:[{view:x,loadOp:"clear",clearValue:{r:0,g:0,b:0,a:0},storeOp:"store"}]});E.setPipeline(m),E.setBindGroup(0,u.gpuBindGroup),E.setViewport(0,0,l,h,0,1),E.draw(3),E.end(),t.queue.submit([w.finish()])},async readback(a){const i=se(a),{width:c,height:d}=b(a),u=i?a.hdr?"rgba16float":"rgba8unorm":a.format,x=i&&a.format==="bgra8unorm",l=i?a.getCurrentGPUTexture():a.gpuTexture,h=Re(u),g=c*h,m=256,w=Math.ceil(g/m)*m,E=w*d,A=t.createBuffer({size:E,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),R=t.createCommandEncoder();R.copyTextureToBuffer({texture:l},{buffer:A,bytesPerRow:w,rowsPerImage:d},{width:c,height:d,depthOrArrayLayers:1}),t.queue.submit([R.finish()]),await A.mapAsync(GPUMapMode.READ);const I=new Uint8Array(A.getMappedRange()),L=new Uint8Array(g*d);for(let F=0;F<d;F++){const M=F*w,D=F*g;L.set(I.subarray(M,M+g),D)}if(A.unmap(),A.destroy(),u==="rgba8unorm"){if(x)for(let F=0;F<L.length;F+=4){const M=L[F],D=L[F+2];L[F]=D,L[F+2]=M}return L}if(u==="rgba16float"){const F=new Uint16Array(L.buffer,L.byteOffset,L.byteLength/2),M=new Float32Array(F.length);for(let D=0;D<F.length;D++)M[D]=rt(F[D]);return M}return new Float32Array(L.buffer,L.byteOffset,L.byteLength/4)},destroy(){p||(t.destroy(),p=!0)},isContextLost(){return!1}}}let me=null;function ht(){if(typeof location>"u")return!1;try{return new URLSearchParams(location.search).has("forceWebGL2")}catch{return!1}}async function gt(e){if(!e&&typeof navigator<"u"&&"gpu"in navigator&&!!navigator.gpu)try{return await ft()}catch{}return _e()}function Pe(e){if(!me){const t=ht();me=gt(t)}return me}function mt(e,t,n){return[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n]}function pt(e){const t=new Uint8Array(768);for(let n=0;n<256;n++){const o=n/255*(e.length-1),s=Math.floor(o),b=Math.min(s+1,e.length-1),p=o-s,[f,a,i]=mt(e[s],e[b],p);t[n*3]=Math.round(f),t[n*3+1]=Math.round(a),t[n*3+2]=Math.round(i)}return t}const Le={viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],"red-green":[[215,25,28],[255,255,255],[26,150,65]],"red-blue":[[215,25,28],[255,255,255],[44,123,182]]},bt=new Set(["red-green","red-blue"]),Ce=new Map;function vt(e){let t=Ce.get(e);if(!t){const n=Le[e]??Le.viridis;t=pt(n),Ce.set(e,t)}return t}function wt(e,t,n="linear"){const r=vt(t),o=new ImageData(e.width,e.height),s=e.data,b=o.data;for(let p=0;p<s.length;p+=4){const f=(s[p]+s[p+1]+s[p+2])/3;let a;n==="positive"?a=Math.round(128+f/255*127):a=Math.round(f),a=Math.max(0,Math.min(255,a)),b[p]=r[a*3],b[p+1]=r[a*3+1],b[p+2]=r[a*3+2],b[p+3]=s[p+3]}return o}function Fe(e){const t=new Map;return{get(n){return t.get(n)},set(n,r){if(t.size>=e){const o=t.keys().next().value;o!==void 0&&t.delete(o)}t.set(n,r)}}}const Ae=Fe(50);function xt(e){return Ae.get(e)}function Et(e,t){Ae.set(e,t)}const Me=Fe(100);function _t(e){return Me.get(e)}function Tt(e,t){Me.set(e,t)}async function Rt(e){const t=_t(e);return t||new Promise(n=>{const r=new Image;r.onload=()=>{try{const o=document.createElement("canvas");o.width=r.naturalWidth,o.height=r.naturalHeight;const s=o.getContext("2d");if(!s){n(null);return}s.drawImage(r,0,0);const b=s.getImageData(0,0,o.width,o.height);Tt(e,b),n(b)}catch(o){console.warn("[cairn] loadImageData failed:",o),n(null)}},r.onerror=o=>{console.warn("[cairn] loadImageData: image failed to load:",e,o),n(null)},r.src=e})}function Ge(e){return e<=32?4:e<=128?16:e<=512?64:e<=2048?256:512}function yt({naturalWidth:e,naturalHeight:t,zoom:n=1,containerRef:r}){const o=Ge(e),s=Ge(t),b=[];for(let m=0;m<=e;m+=o)b.push(m);const p=[];for(let m=0;m<=t;m+=s)p.push(m);const f=1/n,a=8*f,i=-12*f,c=-2*f,d=r==null?void 0:r.current;let u=0,x=0,l=0,h=0;if(d){const m=d.clientWidth,w=d.clientHeight,E=m/e,A=w/t,R=Math.min(E,A);l=e*R,h=t*R,u=(m-l)/2,x=(w-h)/2}const g=d&&l>0;return y.jsxs(y.Fragment,{children:[y.jsx("div",{className:"absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none",style:{top:g?x:0,transform:`translateY(${i}px)`,fontSize:a},children:b.map(m=>y.jsx("span",{className:"mono",style:{position:"absolute",left:g?u+m/e*l:`${m/e*100}%`,transform:"translateX(-50%)"},children:m},m))}),y.jsx("div",{className:"absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none",style:{left:g?u:0,transform:`translateX(${c}px)`,fontSize:a},children:p.map(m=>y.jsx("span",{className:"mono",style:{position:"absolute",top:g?x+m/t*h:`${m/t*100}%`,transform:"translate(-100%, -50%)",paddingRight:`${3*f}px`},children:m},m))})]})}function St({label:e,isDraggable:t,onDragStart:n}){return y.jsxs("span",{className:`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${t?" cairn-drag-grip":""}`,draggable:t,onDragStart:n,style:{cursor:t?"grab":void 0},children:[t&&y.jsx("i",{className:"fa-solid fa-grip-vertical text-[8px] opacity-50","aria-hidden":"true"}),e]})}const Ue=["#0969da","#d29922","#3fb950","#f85149","#c678dd","#56d4dd"];function pe(e){const t=Ue.length;return Ue[(e%t+t)%t]}function Pt(e){const n=v.useRef(null),[r,o]=v.useState({w:0,h:0}),s=v.useRef(null),b=v.useRef(null);return v.useEffect(()=>{var a;const p=n.current;if(p===b.current||((a=s.current)==null||a.disconnect(),s.current=null,b.current=p,!p))return;const f=new ResizeObserver(i=>{for(const c of i)o({w:c.contentRect.width,h:c.contentRect.height})});s.current=f,f.observe(p)}),v.useEffect(()=>()=>{var p;return(p=s.current)==null?void 0:p.disconnect()},[]),{ref:n,size:r}}function Lt(){const[e,t]=v.useState(!1);return v.useEffect(()=>{const n=s=>{(s.key==="Alt"||s.key==="Control"||s.key==="Meta")&&t(!0)},r=s=>{(s.key==="Alt"||s.key==="Control"||s.key==="Meta")&&t(!1)},o=()=>t(!1);return window.addEventListener("keydown",n),window.addEventListener("keyup",r),window.addEventListener("blur",o),()=>{window.removeEventListener("keydown",n),window.removeEventListener("keyup",r),window.removeEventListener("blur",o)}},[]),e}const Ct=.25,Ft=16;function At(e){const{containerRef:t,zoom:n,pan:r,onViewportChange:o,minZoom:s=Ct,maxZoom:b=Ft}=e,p=Lt(),f=v.useRef(p);f.current=p;const a=v.useRef({zoom:n,pan:r});a.current={zoom:n,pan:r};const i=v.useRef(o);i.current=o,v.useEffect(()=>{const h=t.current;if(!h||!o)return;const g=m=>{var D;if(!f.current)return;m.preventDefault(),m.stopPropagation();const w=m.deltaY<0?1.1:1/1.1,E=a.current,A=Math.max(s,Math.min(b,E.zoom*w));if(E.zoom===A)return;const R=h.getBoundingClientRect(),I=m.clientX-R.left,L=m.clientY-R.top,F=I-(I-E.pan.x)/E.zoom*A,M=L-(L-E.pan.y)/E.zoom*A;(D=i.current)==null||D.call(i,{zoom:A,pan:{x:F,y:M}})};return h.addEventListener("wheel",g,{passive:!1}),()=>h.removeEventListener("wheel",g)},[t,!!o,s,b]);const c=v.useRef(null),d=v.useCallback(h=>{!f.current||!i.current||(h.currentTarget.setPointerCapture(h.pointerId),c.current={pointerId:h.pointerId,startX:h.clientX,startY:h.clientY,panX:a.current.pan.x,panY:a.current.pan.y})},[]),u=v.useCallback(h=>{var E;const g=c.current;if(!g||g.pointerId!==h.pointerId)return;const m=h.clientX-g.startX,w=h.clientY-g.startY;(E=i.current)==null||E.call(i,{zoom:a.current.zoom,pan:{x:g.panX+m,y:g.panY+w}})},[]),x=v.useCallback(h=>{const g=c.current;if(!(!g||g.pointerId!==h.pointerId)){try{h.currentTarget.releasePointerCapture(h.pointerId)}catch{}c.current=null}},[]),l=p&&!!o;return{containerProps:{onPointerDown:d,onPointerMove:u,onPointerUp:x,onPointerCancel:x,style:{cursor:l?"move":void 0,touchAction:l?"none":void 0}},modifierActive:p}}function Mt(e){const t=e.replace("#","");return[parseInt(t.slice(0,2),16),parseInt(t.slice(2,4),16),parseInt(t.slice(4,6),16)]}function De(e,t,n){return!(n.has(e.class_id)||e.score!=null&&e.score<t.scoreThreshold)}function Gt({data:e,settings:t,naturalWidth:n,naturalHeight:r}){const{ref:o,size:s}=Pt(),b=v.useRef(null),p=v.useMemo(()=>new Set(t.hiddenClasses),[t.hiddenClasses]),f=v.useMemo(()=>{const l=s.w,h=s.h;if(l<=0||h<=0||n<=0||r<=0)return null;const g=Math.min(l/n,h/r),m=n*g,w=r*g;return{left:(l-m)/2,top:(h-w)/2,width:m,height:w}},[s.w,s.h,n,r]),a=e.masks,i=t.showMasks&&!!a&&a.length>0,c=v.useMemo(()=>t.hiddenClasses.join(","),[t.hiddenClasses]);if(v.useEffect(()=>{if(!i||!a)return;const l=b.current;if(!l)return;(l.width!==n||l.height!==r)&&(l.width=n,l.height=r);const h=l.getContext("2d");if(!h)return;h.clearRect(0,0,l.width,l.height);let g=!1;const m=h.createImageData(n,r),w=m.data;let E=a.length,A=!1;const R=()=>{g||A&&h.putImageData(m,0,0)},I=document.createElement("canvas");I.width=n,I.height=r;const L=I.getContext("2d",{willReadFrequently:!0});for(const F of a){const M=new Image;M.onload=()=>{if(!g){if(L){L.clearRect(0,0,n,r),L.drawImage(M,0,0,n,r);const D=L.getImageData(0,0,n,r).data;for(let k=0;k<n*r;k++){const V=D[k*4];if(V===0||p.has(V))continue;const[Y,ne,H]=Mt(pe(V));w[k*4]=Y,w[k*4+1]=ne,w[k*4+2]=H,w[k*4+3]=255,A=!0}}E-=1,E===0&&R()}},M.onerror=()=>{E-=1,E===0&&R()},M.src=`data:image/png;base64,${F.png_b64}`}return()=>{g=!0}},[i,a,n,r,c]),!f)return y.jsx("div",{ref:o,className:"absolute inset-0 pointer-events-none"});const d=e.boxes??[],u=t.showBoxes&&d.length>0,x=e.class_labels??{};return y.jsxs("div",{ref:o,className:"absolute inset-0 pointer-events-none overflow-hidden",children:[i&&y.jsx("canvas",{ref:b,className:"absolute",style:{left:f.left,top:f.top,width:f.width,height:f.height,opacity:t.maskOpacity,imageRendering:"pixelated"}}),u&&y.jsx("svg",{className:"absolute",style:{left:f.left,top:f.top,width:f.width,height:f.height,overflow:"visible"},viewBox:`0 0 ${n} ${r}`,preserveAspectRatio:"none",children:d.map((l,h)=>{if(!De(l,t,p))return null;const g=l.domain==="pixel"?1:n,m=l.domain==="pixel"?1:r,w=l.position.minX*g,E=l.position.minY*m,A=(l.position.maxX-l.position.minX)*g,R=(l.position.maxY-l.position.minY)*m;return y.jsx("rect",{x:w,y:E,width:A,height:R,fill:"none",stroke:pe(l.class_id),strokeWidth:2,vectorEffect:"non-scaling-stroke"},h)})}),u&&y.jsx("div",{className:"absolute",style:{left:f.left,top:f.top,width:f.width,height:f.height},children:d.map((l,h)=>{if(!De(l,t,p))return null;const g=l.domain==="pixel"?1/n:1,m=l.domain==="pixel"?1/r:1,w=l.position.minX*g*100,E=l.position.minY*m*100,A=l.label??x[String(l.class_id)]??`#${l.class_id}`,R=l.score!=null?` ${(l.score*100).toFixed(0)}%`:"";return!A&&!R?null:y.jsx("span",{className:"absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white",style:{left:`${w}%`,top:`${E}%`,transform:"translateY(-100%)",backgroundColor:pe(l.class_id)},children:y.jsxs("span",{className:"mono",children:[A,R]})},h)})})]})}const Ut=30,Q=["#ff5a5a","#39d353","#5b9bff"];function be(e){if(!Number.isFinite(e))return"0";const t=Math.abs(e);return t!==0&&(t<.001||t>=1e4)?e.toExponential(1):String(Number(e.toPrecision(3)))}function z(e,t,n){return t==="uint8"?n==="int"?String(Math.round(e)):be(e/255):be(n==="int"?e*255:e)}function Dt({imageElRef:e,naturalWidth:t,naturalHeight:n,zoom:r,pan:o,sample:s,notation:b="decimal",version:p=0,onActiveChange:f}){const a=v.useRef(null),i=v.useRef(!1),c=v.useRef(f);c.current=f;const d=v.useCallback(x=>{var l;x!==i.current&&(i.current=x,(l=c.current)==null||l.call(c,x))},[]),u=v.useCallback(()=>{var re;const x=a.current,l=e.current;if(!x)return;const h=window.devicePixelRatio||1,g=x.clientWidth,m=x.clientHeight;if(g===0||m===0)return;x.width!==Math.round(g*h)&&(x.width=Math.round(g*h)),x.height!==Math.round(m*h)&&(x.height=Math.round(m*h));const w=x.getContext("2d");if(!w)return;if(w.setTransform(h,0,0,h,0,0),w.clearRect(0,0,g,m),!l||t<=0||n<=0){d(!1);return}const E=l.getBoundingClientRect(),A=x.getBoundingClientRect();if(E.width===0||E.height===0){d(!1);return}const R=Math.min(E.width/t,E.height/n);if(R<Ut){d(!1);return}const I=t*R,L=n*R,F=E.left+(E.width-I)/2-A.left,M=E.top+(E.height-L)/2-A.top,D=Math.max(0,Math.floor((0-F)/R)),k=Math.min(t,Math.ceil((g-F)/R)),V=Math.max(0,Math.floor((0-M)/R)),Y=Math.min(n,Math.ceil((m-M)/R));if(k<=D||Y<=V){d(!1);return}d(!0),w.textAlign="center",w.textBaseline="middle",w.lineJoin="round";const ne=R*.14,H=R-ne*2;for(let q=V;q<Y;q++)for(let ee=D;ee<k;ee++){const N=s(ee,q,b);if(!N||N.lines.length===0)continue;const K=N.lines.length;let oe=1;for(const O of N.lines)O.length>oe&&(oe=O.length);const ce=H/(K*1.15),ue=H/(oe*.62)||ce,Z=Math.min(ce,ue,24);if(Z<6)continue;const S=F+(ee+.5)*R,P=M+(q+.5)*R,C=Z*1.15,T=N.luminance<=.55,U=T?"#ffffff":"#000000";w.font=`${Z}px ui-monospace, SFMono-Regular, Menlo, monospace`,w.lineWidth=Math.max(1.4,Z*.16),w.strokeStyle=T?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.9)";let G=P-K*C/2+C/2;for(let O=0;O<N.lines.length;O++){const X=N.lines[O];w.strokeText(X,S,G),w.fillStyle=((re=N.colors)==null?void 0:re[O])??U,w.fillText(X,S,G),G+=C}}},[e,t,n,s,b,d]);return v.useEffect(()=>{u()},[u,r,o.x,o.y,p,b]),v.useEffect(()=>{const x=a.current;if(!x)return;const l=new ResizeObserver(()=>u());return l.observe(x),()=>l.disconnect()},[u]),y.jsx("canvas",{ref:a,className:"absolute inset-0 w-full h-full pointer-events-none z-10","aria-hidden":!0})}function It({notation:e,onChange:t,className:n=""}){return y.jsx("button",{type:"button",onClick:r=>{r.stopPropagation(),t(e==="int"?"decimal":"int")},onPointerDown:r=>r.stopPropagation(),className:`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${n}`,title:"Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)",children:e==="int"?"0–255":"0–1"})}const Ot=`
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
`,kt=`#pragma vertex
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
`,Ie={linear:0,srgb:1,reinhard:2,aces:3},Oe=new WeakMap;function Nt(e,t){let n=Oe.get(e);n||(n=new Map,Oe.set(e,n));let r=n.get(t);return r||(r=e.createRenderPipeline({shaderWGSL:Ot,shaderGLSL:kt,targetFormat:t}),n.set(t,r)),r}function Bt(e){return"canvas"in e?e.hdr?"rgba16float":"rgba8unorm":e.format}function Vt(e,t){if(t){if(t.length!==256*4)throw new Error(`renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${t.length}`);const r=e.createTexture(256,1,"rgba32float");return r.write(t),r}const n=e.createTexture(1,1,"rgba32float");return n.write(new Float32Array([0,0,0,1])),n}function Xt(e,t,n,r){var u;const o=Bt(t),s=Nt(e,o),b=Vt(e,r.isScalar?r.colormap:void 0),p=typeof r.gamma=="number"&&r.gamma>0?r.gamma:0,f=Ie[r.operator]??Ie.srgb,a=new Float32Array([r.exposureEV,f,p,r.isScalar?1:0]),i=new Float32Array([r.uv.x,r.uv.y,r.uv.w,r.uv.h]),c=new Float32Array([r.hdrOut?1:0]);let d;try{d=e.createBindGroup(s,[{binding:0,resource:n},{binding:1,resource:b},{binding:2,resource:{uniform:a}},{binding:3,resource:{uniform:i}},{binding:4,resource:{uniform:c}}]),e.renderFullscreen(t,s,d)}finally{(u=d==null?void 0:d.destroy)==null||u.call(d),b.destroy()}}const zt=12,$=[];function ke(e){const t=$.indexOf(e);t!==-1&&$.splice(t,1),$.push(e)}function $t(e){const t=$.indexOf(e);t!==-1&&$.splice(t,1)}function ae(e){e.parked||($t(e),e.srcTexture&&(e.srcTexture.destroy(),e.srcTexture=null),e.surface=null,e.device&&e.device!==e.sharedDevice&&e.device.destroy(),e.device=null,e.parked=!0)}function Ne(e){for(;$.length>zt;){const t=$.find(n=>n!==e&&!n.visible)??$.find(n=>n!==e);if(!t)break;ae(t)}}function Be(e){if(e.disposed)return;if(!e.parked&&e.surface){ke(e),Ne(e);return}const t=e.sharedDevice.backend==="webgl2"?_e():e.sharedDevice;if(e.device=t,e.surface=t.createSurface(e.canvas,{hdr:e.hdr}),e.source){e.canvas.width=e.source.width,e.canvas.height=e.source.height,e.surface.configure(e.source.width,e.source.height);const n=t.createTexture(e.source.width,e.source.height,e.source.format);n.write(e.source.data),e.srcTexture=n}e.parked=!1,ke(e),Ne(e)}const Wt=30;function Ve(e,t){if(!(e.disposed||!e.source)&&(Be(e),!(!e.device||!e.surface||!e.srcTexture))){if(e.device.isContextLost()){Xe(e,t);return}try{Xt(e.device,e.surface,e.srcTexture,t),e.restoreRetries=0}catch(n){if(e.device.isContextLost()){Xe(e,t);return}throw n}}}function Xe(e,t){if(!e.disposed){if(e.restoreRetries>=Wt){e.restoreRetries=0;return}e.restoreRetries++,ae(e),requestAnimationFrame(()=>Ve(e,t))}}function Yt(e){return{canvas:e.canvas,backend:e.sharedDevice.backend,get isParked(){return e.parked},setSource(t){if(!e.disposed&&(e.source=t,!e.parked&&e.device&&e.surface)){e.canvas.width=t.width,e.canvas.height=t.height,e.surface.configure(t.width,t.height),e.srcTexture&&e.srcTexture.destroy();const n=e.device.createTexture(t.width,t.height,t.format);n.write(t.data),e.srcTexture=n}},render(t){Ve(e,t)},park(){e.disposed||ae(e)},restore(){e.disposed||!e.source||Be(e)},setVisible(t){e.disposed||(e.visible=t)},dispose(){e.disposed||(ae(e),e.source=null,e.disposed=!0)}}}async function Ht(e,t){const n=await Pe();return Yt({canvas:e,sharedDevice:n,device:null,hdr:!1,surface:null,srcTexture:null,source:null,parked:!0,disposed:!1,visible:!0,restoreRetries:0})}function ze(e){e.dispose()}function qt(e){return"hdr"in e&&e.hdr!=null}const Kt=["linear","srgb","reinhard","aces"];function Zt(e){return e&&Kt.includes(e)?e:"srgb"}const W=e=>Number.isFinite(e)?e:0;function jt(e){if(e.length===2)return{h:e[0],w:e[1],c:1};if(e.length===3)return{h:e[0],w:e[1],c:e[2]};throw new Error(`GpuImagePane: unsupported HDR shape [${e.join(",")}] (want [H,W] or [H,W,C]).`)}function Jt(e){const{h:t,w:n,c:r}=jt(e.shape),o=e.data,s=new Float32Array(n*t*4);for(let b=0;b<n*t;b++){const p=b*r;let f,a,i,c=1;r===1?f=a=i=W(o[p]):r===3?(f=W(o[p]),a=W(o[p+1]),i=W(o[p+2])):(f=W(o[p]),a=W(o[p+1]),i=W(o[p+2]),c=W(o[p+3]));const d=b*4;s[d]=f,s[d+1]=a,s[d+2]=i,s[d+3]=c}return{data:s,width:n,height:t,format:"rgba32float"}}function Qt(e,t,n,r){if(n<=0||r<=0||t.width<=0||t.height<=0)return{x:0,y:0,w:1,h:1};const o=Math.min(t.width/n,t.height/r),s=n*o,b=r*o,p=(t.width-s)/2,f=(t.height-b)/2,a=Math.max(e.zoom,1e-6),i=1/a,c=1/a,d=(p*(1-a)-e.pan.x)/(s*a),u=(f*(1-a)-e.pan.y)/(b*a);return{x:d,y:u,w:i,h:c}}const en={zoom:1,pan:{x:0,y:0}};function $e(e){var ue,Z;const t=qt(e),n=v.useRef(null),r=v.useRef(null),o=v.useRef(null),s=v.useRef(null),[b,p]=v.useState(!1),[f,a]=v.useState(null),[i,c]=v.useState(0),[d,u]=v.useState(0),x=v.useRef(null),l=v.useRef(null),[h,g]=v.useState(0),[m,w]=v.useState(e.pixelValueNotation??"decimal"),[E,A]=v.useState(!1),R=e.zoom??1,I=e.pan??{x:0,y:0},L=e.onViewportChange,F=t?"none":e.colormap??"none";v.useEffect(()=>{const S=n.current;if(!S)return;let P=!1;return Ht(S).then(C=>{if(P){ze(C);return}s.current=C,p(!0)}),()=>{P=!0,s.current&&(ze(s.current),s.current=null)}},[]);const{containerProps:M}=At({containerRef:r,zoom:R,pan:I,onViewportChange:L}),D=v.useCallback(()=>{L==null||L(en)},[L]);v.useEffect(()=>{const S=r.current;if(!S)return;const P=new ResizeObserver(()=>u(C=>C+1));return P.observe(S),()=>P.disconnect()},[]),v.useEffect(()=>{const S=r.current;if(!S)return;const P=new IntersectionObserver(C=>{const T=C[0];if(!T)return;const U=s.current;U&&(U.setVisible(T.isIntersecting),T.isIntersecting?U.isParked&&(U.restore(),u(G=>G+1)):U.park())},{threshold:0});return P.observe(S),()=>P.disconnect()},[]),v.useEffect(()=>{var C;if(!t||!b)return;const S=e.hdr;x.current=S;const P=Jt(S);(C=s.current)==null||C.setSource(P),a(T=>T&&T.w===P.width&&T.h===P.height?T:{w:P.width,h:P.height}),g(T=>T+1),c(T=>T+1)},[t,b,t?e.hdr:null]),v.useEffect(()=>{if(t||!b)return;const S=e,P=S.imageUrl,C=S.colormap??"none";if(!P){l.current=null,a(null),g(U=>U+1);return}let T=!1;return Rt(P).then(U=>{var X,ie;if(T||!U)return;let G=U;if(C!=="none"){const B=`gpu::${P}::${C}`,j=xt(B);if(j)G=j;else{const te=bt.has(C)?"positive":"linear";G=wt(U,C,te),Et(B,G)}}l.current=U;const O={data:G.data,width:G.width,height:G.height,format:"rgba8unorm"};(X=s.current)==null||X.setSource(O),a(B=>B&&B.w===G.width&&B.h===G.height?B:{w:G.width,h:G.height}),(ie=S.onNaturalSize)==null||ie.call(S,G.width,G.height),g(B=>B+1),c(B=>B+1)}),()=>{T=!0}},[t,b,t?null:e.imageUrl,t?null:e.colormap]);const k=t?e.exposure??0:0,V=t?e.tonemap:void 0,Y=t?e.gamma:void 0;v.useEffect(()=>{const S=s.current;if(!S||!b||!f)return;const P=r.current,C=P?P.getBoundingClientRect():{width:f.w,height:f.h};let T=Qt({zoom:R,pan:I},C,f.w,f.h);S.backend==="webgl2"&&(T={x:T.x,y:T.y+T.h,w:T.w,h:-T.h});const U=t?{exposureEV:k,operator:Zt(V),gamma:Y,isScalar:!1,hdrOut:!1,uv:T}:{exposureEV:0,operator:"linear",gamma:1,isScalar:!1,hdrOut:!1,uv:T};S.render(U)},[b,f,i,R,I.x,I.y,k,V,Y,d,t]);const ne=v.useCallback((S,P,C)=>{if(t){const j=x.current,te=f;if(!j||!te||S<0||P<0||S>=te.w||P>=te.h)return null;const We=j.shape.length===2?1:j.shape[2]??1,le=(P*te.w+S)*We,de=j.data,Ye=.5;return We===1?{lines:[z(de[le]??0,"unit",C)],luminance:Ye}:{lines:[z(de[le]??0,"unit",C),z(de[le+1]??0,"unit",C),z(de[le+2]??0,"unit",C)],luminance:Ye,colors:[Q[0],Q[1],Q[2]]}}const T=l.current;if(!T||S<0||P<0||S>=T.width||P>=T.height)return null;const U=(P*T.width+S)*4,G=T.data[U],O=T.data[U+1],X=T.data[U+2],ie=(.299*G+.587*O+.114*X)/255;return F!=="none"||G===O&&O===X?{lines:[z(G,"uint8",C)],luminance:ie}:{lines:[z(G,"uint8",C),z(O,"uint8",C),z(X,"uint8",C)],luminance:ie,colors:[Q[0],Q[1],Q[2]]}},[t,f,F]),H=e.showAxes??!1,re=t?e.label??"":e.label,q=e.interpolation??"auto",ee=q==="auto"?void 0:q,N=t?void 0:e.overlay,K=t?void 0:e.overlaySettings,oe=t?!1:e.isDraggable??!1,ce=t?void 0:e.onDragStart;return y.jsxs("div",{className:"relative flex flex-col h-full","data-gpu-image-pane":!0,"data-gpu-backend-ready":b,children:[y.jsxs("div",{ref:r,className:"relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard",style:{padding:H&&f?"16px 4px 4px 28px":"4px",...M.style},onPointerDown:M.onPointerDown,onPointerMove:M.onPointerMove,onPointerUp:M.onPointerUp,onPointerCancel:M.onPointerCancel,onDoubleClick:D,"data-gpu-image-viewport":!0,children:[y.jsxs("div",{ref:o,className:"relative w-full h-full",children:[y.jsx("canvas",{ref:n,className:"w-full h-full object-contain block",style:{imageRendering:ee},"data-gpu-image-canvas":!0}),H&&f&&y.jsx(yt,{naturalWidth:f.w,naturalHeight:f.h,zoom:R,containerRef:o}),N&&(K==null?void 0:K.enabled)&&f&&((((ue=N.boxes)==null?void 0:ue.length)??0)>0||(((Z=N.masks)==null?void 0:Z.length)??0)>0)&&y.jsx(Gt,{data:N,settings:K,naturalWidth:f.w,naturalHeight:f.h})]}),f&&y.jsx(Dt,{imageElRef:n,naturalWidth:f.w,naturalHeight:f.h,zoom:R,pan:I,sample:ne,notation:m,version:h,onActiveChange:A}),E&&y.jsx(It,{notation:m,onChange:w})]}),re?y.jsx(St,{label:re,isDraggable:oe,onDragStart:ce}):null]})}async function tn(){if(!window.__cairnPlotGpuImageLoaded){if(window.__cairnPlotUseGpuImage===!1){console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");return}if(typeof window.__cairnPlotRegisterRenderer!="function"){console.error("cairn-plot gpu-image addon: core bundle not installed (window.__cairnPlotRegisterRenderer missing) — staying on legacy panes.");return}try{await Pe(),window.__cairnPlotRegisterRenderer("image",$e),window.__cairnPlotRegisterRenderer("imagehdr",$e),window.__cairnPlotGpuImageLoaded=!0}catch(e){console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes",e)}}}tn()})(__cairnPlotJsxRuntime,__cairnPlotReact);

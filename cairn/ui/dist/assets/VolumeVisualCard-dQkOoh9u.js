import{w as n,r as y,a4 as me,a0 as X,a1 as de,s as L,x as I,J as D,d as fe,e as pe,a2 as ve}from"./index-B8_Es86A.js";import{u as xe,n as he,R as ge,U as te,o as U,C as E,V as A,p as be,q as ye,G as Me,s as je,l as Se,t as Ce,v as we,d as ie,e as ne,f as De,w as Te,h as Ve,i as Ne,r as Re,O as J,j as ke}from"./diff-Dr1nosOp.js";const Oe={dark:856343,light:16185594},K=256;let P=null;function Pe(){if(P!==null)return P;try{const e=document.createElement("canvas").getContext("webgl2");if(e){const i=e.getExtension("WEBGL_lose_context");i==null||i.loseContext()}P=!!e}catch{P=!1}return P}function Ee({className:a}){return n.jsx("div",{className:a??"relative h-full w-full",children:n.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[n.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),n.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function Fe(a,e,i){const o=i-e||1,t=new Uint8Array(a.length);for(let r=0;r<a.length;r++){const s=(a[r]-e)/o;t[r]=Math.max(0,Math.min(255,Math.round(s*255)))}return t}function ee(a){const e=me(a),i=new Uint8Array(256*4);for(let t=0;t<256;t++)i[t*4]=e[t*3],i[t*4+1]=e[t*3+1],i[t*4+2]=e[t*3+2],i[t*4+3]=255;const o=new Ce(i,256,1,we,te);return o.minFilter=U,o.magFilter=U,o.wrapS=E,o.wrapT=E,o.needsUpdate=!0,o}const ze=`precision highp float;

in vec3 position;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

out vec3 vOrigin;
out vec3 vDirection;

void main() {
  // Camera position transformed into this mesh's local (object) space.
  vOrigin = ( inverse( modelMatrix ) * vec4( cameraPosition, 1.0 ) ).xyz;
  vDirection = position - vOrigin;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`,Ie=`precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${K}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${K};
const vec3 BOX_MIN = vec3( -0.5 );
const vec3 BOX_MAX = vec3( 0.5 );

// Ray/box intersection (slab method) against the local unit box.
vec2 hitBox( vec3 orig, vec3 dir ) {
  vec3 invDir = 1.0 / dir;
  vec3 t0s = ( BOX_MIN - orig ) * invDir;
  vec3 t1s = ( BOX_MAX - orig ) * invDir;
  vec3 tsmaller = min( t0s, t1s );
  vec3 tbigger  = max( t0s, t1s );
  float t0 = max( tsmaller.x, max( tsmaller.y, tsmaller.z ) );
  float t1 = min( tbigger.x, min( tbigger.y, tbigger.z ) );
  return vec2( t0, t1 );
}

// Local-space position [-0.5,0.5]^3 -> texture coordinate [0,1]^3.
vec3 toTexCoord( vec3 localPos ) { return localPos + 0.5; }

bool inClip( vec3 uv ) {
  return all( greaterThanEqual( uv, uClipMin ) ) && all( lessThanEqual( uv, uClipMax ) );
}

// Density at a texture coordinate, zero outside the clip box (slicing).
float sampleDensity( vec3 uv ) {
  if ( !inClip( uv ) ) return 0.0;
  return texture( uData, uv ).r;
}

vec3 computeGradient( vec3 uv ) {
  float dx = sampleDensity( uv + vec3( uTexelSize.x, 0.0, 0.0 ) ) - sampleDensity( uv - vec3( uTexelSize.x, 0.0, 0.0 ) );
  float dy = sampleDensity( uv + vec3( 0.0, uTexelSize.y, 0.0 ) ) - sampleDensity( uv - vec3( 0.0, uTexelSize.y, 0.0 ) );
  float dz = sampleDensity( uv + vec3( 0.0, 0.0, uTexelSize.z ) ) - sampleDensity( uv - vec3( 0.0, 0.0, uTexelSize.z ) );
  return vec3( dx, dy, dz );
}

void main() {
  vec3 rayDir = normalize( vDirection );
  vec2 bounds = hitBox( vOrigin, rayDir );
  if ( bounds.x > bounds.y ) discard; // ray misses the box entirely

  float t0 = max( bounds.x, 0.0 ); // camera may be inside the box
  float t1 = bounds.y;
  if ( t1 <= t0 ) discard;

  float steps = clamp( uSteps, 1.0, float( MAX_STEPS ) );
  float dt = ( t1 - t0 ) / steps;

  if ( uMode == 0 ) {
    // ---- MIP: maximum-intensity projection ----
    float maxDensity = 0.0;
    float t = t0;
    for ( int i = 0; i < MAX_STEPS; i++ ) {
      if ( float( i ) >= steps ) break;
      vec3 uv = toTexCoord( vOrigin + rayDir * t );
      maxDensity = max( maxDensity, sampleDensity( uv ) );
      t += dt;
    }
    if ( maxDensity <= 0.001 ) discard; // ray hit nothing (or was clipped away)
    outColor = vec4( texture( uLUT, vec2( maxDensity, 0.5 ) ).rgb, 1.0 );
  } else {
    // ---- ISO: first-hit isosurface, gradient-shaded ----
    float prevD = sampleDensity( toTexCoord( vOrigin + rayDir * t0 ) );
    float t = t0 + dt;
    bool hit = false;
    vec3 hitUv = vec3( 0.0 );
    for ( int i = 1; i < MAX_STEPS; i++ ) {
      if ( float( i ) >= steps ) break;
      vec3 uv = toTexCoord( vOrigin + rayDir * t );
      float d = sampleDensity( uv );
      if ( prevD < uIsovalue && d >= uIsovalue ) {
        // Sub-step refinement: linearly interpolate the crossing point
        // between the previous and current samples.
        float denom = max( d - prevD, 1e-6 );
        float frac = ( uIsovalue - prevD ) / denom;
        hitUv = toTexCoord( vOrigin + rayDir * ( t - dt + dt * frac ) );
        hit = true;
        break;
      }
      prevD = d;
      t += dt;
    }
    if ( !hit ) discard;
    vec3 grad = computeGradient( hitUv );
    // Outward normal = -gradient (see function docstring above).
    vec3 normal = length( grad ) > 1e-6 ? -normalize( grad ) : vec3( 0.0, 0.0, 1.0 );
    vec3 lightDir = normalize( vec3( 0.4, 0.6, 0.7 ) );
    float diffuse = max( dot( normal, lightDir ), 0.0 );
    float shade = 0.35 + 0.65 * diffuse; // ambient floor + lambert term
    vec3 base = texture( uLUT, vec2( uIsovalue, 0.5 ) ).rgb;
    outColor = vec4( base * shade, 1.0 );
  }
}
`;function Ue(a,e,i){const[o,t,r]=a,s=r*e[2],l=t*e[1],d=o*e[0],u=i[2],c=i[1],m=i[0];return{scale:[s,l,d],position:[u+s/2,c+l/2,m+d/2],bounds:{min:[u,c,m],max:[u+s,c+l,m+d]}}}function Ae({data:a,shape:e,spacing:i,origin:o,vmin:t,vmax:r,mode:s,isovalue:l,colormap:d,steps:u,clip:c,background:m,className:f,sync:v=null,onFrame:h}){const{containerRef:R,canvasRef:T,requestRender:k,fitToBounds:p,refs:F}=xe({background:Oe[m],sync:v,onFrame:h}),b=y.useRef(null),V=y.useRef(null),j=y.useRef(null),w=y.useRef(null),S=y.useRef(null);return y.useEffect(()=>{var Y,$,Z,Q;const x=F.scene.current;if(!x)return;b.current&&(x.remove(b.current),(Y=V.current)==null||Y.dispose(),($=j.current)==null||$.dispose(),(Z=w.current)==null||Z.dispose(),(Q=S.current)==null||Q.dispose());const[g,C,O]=e,se=Fe(a,t,r),M=new he(se,O,C,g);M.format=ge,M.type=te,M.minFilter=U,M.magFilter=U,M.wrapR=E,M.wrapS=E,M.wrapT=E,M.needsUpdate=!0;const W=ee(d),re={uData:{value:M},uLUT:{value:W},uMode:{value:s==="mip"?0:1},uSteps:{value:u},uIsovalue:{value:l},uClipMin:{value:new A(...c.min)},uClipMax:{value:new A(...c.max)},uTexelSize:{value:new A(1/O,1/C,1/g)}},q=new be({glslVersion:Me,vertexShader:ze,fragmentShader:Ie,uniforms:re,side:ye,transparent:!1}),H=new je(1,1,1),z=new Se(H,q),{scale:le,position:ue,bounds:ce}=Ue(e,i,o);z.scale.set(...le),z.position.set(...ue),x.add(z),b.current=z,V.current=H,j.current=q,w.current=M,S.current=W,p(ce)},[a,e,i,o,t,r]),y.useEffect(()=>{var C;const x=j.current;if(!x)return;(C=S.current)==null||C.dispose();const g=ee(d);S.current=g,x.uniforms.uLUT.value=g,k()},[d]),y.useEffect(()=>{const x=j.current;if(!x)return;const g=x.uniforms;g.uMode.value=s==="mip"?0:1,g.uSteps.value=u,g.uIsovalue.value=l,g.uClipMin.value.set(...c.min),g.uClipMax.value.set(...c.max),k()},[s,l,u,c]),y.useEffect(()=>()=>{var x,g,C,O;(x=V.current)==null||x.dispose(),(g=j.current)==null||g.dispose(),(C=w.current)==null||C.dispose(),(O=S.current)==null||O.dispose()},[]),n.jsx("div",{ref:R,className:f??"relative h-full w-full",children:n.jsx("canvas",{ref:T,className:"block h-full w-full rounded"})})}function N(a){return Pe()?n.jsx(Ae,{...a}):n.jsx(Ee,{className:a.className})}function G(a){return{mode:a.renderMode,isovalue:a.isovalue,colormap:a.colormap,steps:a.steps,clipMin:a.clipMin,clipMax:a.clipMax,background:a.background}}function _({item:a,view:e,sync:i,label:o,isDraggable:t,onDragStart:r,onFrame:s,colorRange:l}){if(!a)return n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"});const{arrays:d,meta:u}=a,[c,m]=l??[u.vmin,u.vmax];return n.jsxs("div",{className:"relative flex h-full w-full flex-col overflow-hidden rounded bg-bg",children:[n.jsx("div",{className:"flex flex-1 min-h-0 overflow-hidden",children:n.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:n.jsx(N,{data:d.data,shape:u.shape,spacing:u.spacing,origin:u.origin,vmin:c,vmax:m,mode:e.mode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clip:{min:e.clipMin,max:e.clipMax},background:e.background,sync:i,onFrame:s})})}),n.jsx("div",{className:"mono px-1 py-0.5 text-[10px] text-fg-subtle",children:`${u.shape.join("×")} · vmin ${u.vmin.toFixed(3)} · vmax ${u.vmax.toFixed(3)}`}),n.jsx(X,{label:o,isDraggable:t,onDragStart:r})]})}function Le({item:a,reference:e,view:i,sync:o,label:t,isDraggable:r,onDragStart:s,colorRange:l}){const d=Ve(o);if(!e)return n.jsx(_,{item:a,view:i,sync:o,label:t,isDraggable:r,onDragStart:s,colorRange:l});const[u,c]=l??[e.meta.vmin,e.meta.vmax];return n.jsxs("div",{className:"flex h-full w-full gap-0.5",children:[n.jsxs("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg",children:[n.jsx(N,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:u,vmax:c,mode:i.mode,isovalue:i.isovalue,colormap:i.colormap,steps:i.steps,clip:{min:i.clipMin,max:i.clipMax},background:i.background,sync:d}),n.jsx(X,{label:"REF"})]}),n.jsx("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded bg-bg",children:a?n.jsx(_,{item:a,view:i,sync:d,label:t,isDraggable:r,onDragStart:s,colorRange:l}):n.jsx("div",{className:"flex h-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"})})]})}function _e({data:a,reference:e,settings:i,cameraSyncGroupId:o,label:t,isDraggable:r,onDragStart:s,colorRange:l}){const d=o?{groupId:o}:null,u=G(i);if(!a||!e)return n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"});if(!(a.meta.shape[0]===e.meta.shape[0]&&a.meta.shape[1]===e.meta.shape[1]&&a.meta.shape[2]===e.meta.shape[2]))return n.jsxs("div",{className:"flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted",children:["Shape mismatch: ",a.meta.shape.join("×")," vs ",e.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const m=i.diffColormap??"viridis",f=a.meta.shape[0]*a.meta.shape[1]*a.meta.shape[2],v=ie(a.arrays.data,e.arrays.data,f),h=l??ne(v,m),R=m==="viridis"?Te(v):v;return n.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[n.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:n.jsx(N,{data:R,shape:a.meta.shape,spacing:a.meta.spacing,origin:a.meta.origin,vmin:h[0],vmax:h[1],mode:u.mode,isovalue:u.isovalue,colormap:m,steps:u.steps,clip:{min:u.clipMin,max:u.clipMax},background:u.background,sync:d})}),n.jsx(X,{label:t,isDraggable:r,onDragStart:s})]})}function Be(a,e){const i=a,o=e;return!i||!o?!1:i.meta.shape[0]===o.meta.shape[0]&&i.meta.shape[1]===o.meta.shape[1]&&i.meta.shape[2]===o.meta.shape[2]}function Xe(a){const{items:e,referenceItems:i,settings:o,nativeMode:t}=a;if(t==="diff-value"){const l=o.diffColormap??"viridis",d=[];for(let c=0;c<e.length;c++){const m=e[c],f=i[c];if(!m||!f||m.meta.shape[0]!==f.meta.shape[0]||m.meta.shape[1]!==f.meta.shape[1]||m.meta.shape[2]!==f.meta.shape[2])continue;const v=m.meta.shape[0]*m.meta.shape[1]*m.meta.shape[2],h=ie(m.arrays.data,f.arrays.data,v);d.push(ne(h,l))}const u=De(d,l);return u?{colormap:l,min:u[0],max:u[1]}:null}let r=1/0,s=-1/0;for(const l of[...e,...i])l&&(r=Math.min(r,l.meta.vmin),s=Math.max(s,l.meta.vmax));return!Number.isFinite(r)||!Number.isFinite(s)?null:{colormap:o.colormap,min:r,max:s}}const Ge={coreModes:["normal","side","split","blend","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:Be,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],hasSteps:!0,postProcessing:!1,overlays:!1,colorbar:"never",cameraSync:!0,resetView:"always",crossTypeCompare:!0,webglContextsPerPane:1,maxPanes:4,label:{placement:"bottom-left",draggable:!0},downloadExtension:".npz"};async function We(a){const e=await fetch(pe.artifactUrl(a));if(!e.ok)throw new Error(`failed to fetch volume (${e.status})`);const i=await ve(await e.arrayBuffer());if(!i.data)throw new Error("volume artifact is missing its 'data' array");return Float32Array.from(i.data.data)}function B(a){return fe({queries:a.map(e=>({queryKey:["volume-npz",e],enabled:!!e,staleTime:1/0,queryFn:()=>We(e)}))})}function qe(a){const{hashes:e,referenceHashes:i,metadata:o,referenceMetadata:t}=a,r=B(e),s=B(i);return y.useMemo(()=>{const l=e.map((c,m)=>{var h;if(!c)return null;const f=(h=r[m])==null?void 0:h.data,v=L(o==null?void 0:o[m]);return!f||!v?null:{arrays:{data:f},meta:v}}),d=i.map((c,m)=>{var h;if(!c)return null;const f=(h=s[m])==null?void 0:h.data,v=L(t==null?void 0:t[m]);return!f||!v?null:{arrays:{data:f},meta:v}}),u=r.some(c=>c.isLoading)||s.some(c=>c.isLoading);return{items:l,referenceItems:d,isLoading:u}},[e.join("|"),i.join("|"),(o??[]).join("|"),(t??[]).join("|"),r.map(l=>l.dataUpdatedAt).join("|"),s.map(l=>l.dataUpdatedAt).join("|")])}function oa({hash:a,metadata:e,onFrame:i}){const[o]=B([a]),t=L(e),r=Ne(),s=G(oe());return y.useEffect(()=>{r.dataUrl&&i({kind:"dataUrl",dataUrl:r.dataUrl})},[r.dataUrl]),!(o!=null&&o.data)||!t?null:n.jsx(N,{data:o.data,shape:t.shape,spacing:t.spacing,origin:t.origin,vmin:t.vmin,vmax:t.vmax,mode:s.mode,isovalue:s.isovalue,colormap:s.colormap,steps:s.steps,clip:{min:s.clipMin,max:s.clipMax},background:s.background,onFrame:r.onFrame})}function oe(){return{renderMode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark",syncViews:!0,brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1,zoom:1,pan:{x:0,y:0},diffMode:"none"}}const He=new Set(["normal","side","split","blend","diff"]),Ye=new Set(["mip","iso"]);function $e(a){const e=a;let i=a;if(typeof e.mode=="string"&&Ye.has(e.mode)&&(i={...i,renderMode:e.mode,mode:void 0}),i.mode==null&&i.nativeMode==null&&typeof e.compareMode=="string"){const o=e.compareMode;o==="diff-value"?i={...i,nativeMode:o}:He.has(o)&&(i={...i,mode:o})}return i.diffMode==="none"&&typeof e.diffSubmode=="string"&&(i={...i,diffMode:e.diffSubmode}),i}function Ze(a){const{data:e,reference:i,settings:o,mode:t,diffMode:r,cameraSyncGroupId:s,label:l,isBaseline:d,isDraggable:u,onDragStart:c,splitPosition:m,onSplitPositionChange:f,blendAlpha:v,crossTypeReferenceUrl:h,crossTypeAlignForDiff:R,colorRange:T}=a,k=s?{groupId:s}:null,p=G(o),F=h!=null,b=i==null&&!F?"normal":t,V=(j,w)=>{const[S,x]=T??[e.meta.vmin,e.meta.vmax];return n.jsx(N,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:S,vmax:x,mode:p.mode,isovalue:p.isovalue,colormap:p.colormap,steps:p.steps,clip:{min:p.clipMin,max:p.clipMax},background:p.background,sync:w,onFrame:j})};return F&&b!=="normal"?e?n.jsx(J,{mode:b,primary:{kind:"live",render:V},reference:{kind:"frame",frameSource:{kind:"url",url:h}},diffSubmode:r,colormap:o.diffColormap??"viridis",splitPosition:m??.5,onSplitPositionChange:f??(()=>{}),blendAlpha:v??.5,primaryLabel:l,alignForDiff:R}):n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):b==="side"?n.jsx(Le,{item:e,reference:i??null,view:p,sync:k,label:l,isDraggable:u,onDragStart:c,colorRange:T}):ke(b)&&(b==="split"||b==="blend"||b==="diff")?!e||!i?n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):n.jsx(J,{mode:b,primary:{kind:"live",render:V},reference:{kind:"live",render:(j,w)=>{const[S,x]=T??[i.meta.vmin,i.meta.vmax];return n.jsx(N,{data:i.arrays.data,shape:i.meta.shape,spacing:i.meta.spacing,origin:i.meta.origin,vmin:S,vmax:x,mode:p.mode,isovalue:p.isovalue,colormap:p.colormap,steps:p.steps,clip:{min:p.clipMin,max:p.clipMax},background:p.background,sync:w,onFrame:j})}},diffSubmode:r,colormap:o.diffColormap??"viridis",splitPosition:m??.5,onSplitPositionChange:f??(()=>{}),blendAlpha:v??.5,primaryLabel:l}):n.jsx(_,{item:e,view:p,sync:k,label:l,isDraggable:u,onDragStart:c,colorRange:T})}const Qe=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],Je=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],Ke=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],ea=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function aa({settings:a,update:e}){const i=(t,r)=>{const s=[...a.clipMin];s[t]=Math.min(r,a.clipMax[t]),e({clipMin:s})},o=(t,r)=>{const s=[...a.clipMax];s[t]=Math.max(r,a.clipMin[t]),e({clipMax:s})};return n.jsxs(n.Fragment,{children:[n.jsx(I,{label:"Render mode",value:a.renderMode,onChange:t=>e({renderMode:t}),options:Qe}),a.renderMode==="iso"&&n.jsx(D,{label:"Isovalue",value:a.isovalue,onChange:t=>e({isovalue:t}),min:0,max:1,step:.01,format:t=>t.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),n.jsx(I,{label:"Colormap",value:a.colormap,onChange:t=>e({colormap:t}),options:Je}),n.jsx(I,{label:"Quality",value:String(a.steps),onChange:t=>e({steps:Number(t)}),options:Ke,description:"Raymarch step count — higher is finer but slower"}),n.jsx(I,{label:"Background",value:a.background,onChange:t=>e({background:t}),options:ea}),n.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[n.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),n.jsx(D,{label:"Clip X min",value:a.clipMin[0],onChange:t=>i(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(D,{label:"Clip X max",value:a.clipMax[0],onChange:t=>o(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(D,{label:"Clip Y min",value:a.clipMin[1],onChange:t=>i(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(D,{label:"Clip Y max",value:a.clipMax[1],onChange:t=>o(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(D,{label:"Clip Z min",value:a.clipMin[2],onChange:t=>i(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(D,{label:"Clip Z max",value:a.clipMax[2],onChange:t=>o(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)})]})]})}const ae={kind:"camera3d",position:[0,0,5],target:[0,0,0],zoom:1},ta={objectType:"volume",capabilities:Ge,useData:qe,defaultSettings:oe,migrateSettings:$e,viewFromSettings:()=>ae,viewToSettingsPatch:()=>({}),defaultView:()=>ae,onResetView:a=>Re(a),Pane:Ze,SettingsControls:aa,nativeDiff:{render:_e},activeColorbar:Xe};function sa(a){return n.jsx(de,{...a,viewport:ta})}export{oa as VolumeForeignFrame,sa as default,ta as volumeViewportModule};

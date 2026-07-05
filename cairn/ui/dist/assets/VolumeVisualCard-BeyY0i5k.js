import{w as o,r as y,a6 as le,a0 as K,a1 as _,a2 as ue,x as V,J as j,a3 as ce,i as Y,d as me,e as de,a4 as fe}from"./index-Bguajs3c.js";import{u as pe,i as ve,R as xe,U as ee,j as k,C as P,V as L,k as he,l as ge,G as be,m as ye,g as Me,n as Ce,o as je,d as De,p as we,q as Se,r as Te,O as Re}from"./diff-BPxwWdxN.js";const Ve={dark:856343,light:16185594},Z=256;let O=null;function Oe(){if(O!==null)return O;try{const e=document.createElement("canvas").getContext("webgl2");if(e){const i=e.getExtension("WEBGL_lose_context");i==null||i.loseContext()}O=!!e}catch{O=!1}return O}function Pe({className:a}){return o.jsx("div",{className:a??"relative h-full w-full",children:o.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[o.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),o.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function Ee(a,e,i){const n=i-e||1,t=new Uint8Array(a.length);for(let r=0;r<a.length;r++){const s=(a[r]-e)/n;t[r]=Math.max(0,Math.min(255,Math.round(s*255)))}return t}function Q(a){const e=le(a),i=new Uint8Array(256*4);for(let t=0;t<256;t++)i[t*4]=e[t*3],i[t*4+1]=e[t*3+1],i[t*4+2]=e[t*3+2],i[t*4+3]=255;const n=new Ce(i,256,1,je,ee);return n.minFilter=k,n.magFilter=k,n.wrapS=P,n.wrapT=P,n.needsUpdate=!0,n}const Ne=`precision highp float;

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
`,ke=`precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${Z}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${Z};
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
`;function ze(a,e,i){const[n,t,r]=a,s=r*e[2],c=t*e[1],l=n*e[0],v=i[2],u=i[1],d=i[0];return{scale:[s,c,l],position:[v+s/2,u+c/2,d+l/2],bounds:{min:[v,u,d],max:[v+s,u+c,d+l]}}}function Ie({data:a,shape:e,spacing:i,origin:n,vmin:t,vmax:r,mode:s,isovalue:c,colormap:l,steps:v,clip:u,background:d,className:x,sync:f=null,onFrame:h}){const{containerRef:m,canvasRef:M,requestRender:D,fitToBounds:w,refs:te}=pe({background:Ve[d],sync:f,onFrame:h}),z=y.useRef(null),I=y.useRef(null),S=y.useRef(null),A=y.useRef(null),T=y.useRef(null);return y.useEffect(()=>{var X,W,q,H;const g=te.scene.current;if(!g)return;z.current&&(g.remove(z.current),(X=I.current)==null||X.dispose(),(W=S.current)==null||W.dispose(),(q=A.current)==null||q.dispose(),(H=T.current)==null||H.dispose());const[p,C,R]=e,ie=Ee(a,t,r),b=new ve(ie,R,C,p);b.format=xe,b.type=ee,b.minFilter=k,b.magFilter=k,b.wrapR=P,b.wrapS=P,b.wrapT=P,b.needsUpdate=!0;const U=Q(l),oe={uData:{value:b},uLUT:{value:U},uMode:{value:s==="mip"?0:1},uSteps:{value:v},uIsovalue:{value:c},uClipMin:{value:new L(...u.min)},uClipMax:{value:new L(...u.max)},uTexelSize:{value:new L(1/R,1/C,1/p)}},B=new he({glslVersion:be,vertexShader:Ne,fragmentShader:ke,uniforms:oe,side:ge,transparent:!1}),G=new ye(1,1,1),N=new Me(G,B),{scale:ne,position:se,bounds:re}=ze(e,i,n);N.scale.set(...ne),N.position.set(...se),g.add(N),z.current=N,I.current=G,S.current=B,A.current=b,T.current=U,w(re)},[a,e,i,n,t,r]),y.useEffect(()=>{var C;const g=S.current;if(!g)return;(C=T.current)==null||C.dispose();const p=Q(l);T.current=p,g.uniforms.uLUT.value=p,D()},[l]),y.useEffect(()=>{const g=S.current;if(!g)return;const p=g.uniforms;p.uMode.value=s==="mip"?0:1,p.uSteps.value=v,p.uIsovalue.value=c,p.uClipMin.value.set(...u.min),p.uClipMax.value.set(...u.max),D()},[s,c,v,u]),y.useEffect(()=>()=>{var g,p,C,R;(g=I.current)==null||g.dispose(),(p=S.current)==null||p.dispose(),(C=A.current)==null||C.dispose(),(R=T.current)==null||R.dispose()},[]),o.jsx("div",{ref:m,className:x??"relative h-full w-full",children:o.jsx("canvas",{ref:M,className:"block h-full w-full rounded"})})}function E(a){return Oe()?o.jsx(Ie,{...a}):o.jsx(Pe,{className:a.className})}function ae(a){return{mode:a.renderMode,isovalue:a.isovalue,colormap:a.colormap,steps:a.steps,clipMin:a.clipMin,clipMax:a.clipMax,background:a.background}}function F({item:a,view:e,sync:i,label:n,isDraggable:t,onDragStart:r,onFrame:s}){if(!a)return o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"});const{arrays:c,meta:l}=a;return o.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[o.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:o.jsx(E,{data:c.data,shape:l.shape,spacing:l.spacing,origin:l.origin,vmin:l.vmin,vmax:l.vmax,mode:e.mode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clip:{min:e.clipMin,max:e.clipMax},background:e.background,sync:i,onFrame:s})}),o.jsx(K,{colormap:e.colormap,min:l.vmin,max:l.vmax}),o.jsx(_,{label:n,isDraggable:t,onDragStart:r})]})}function Ae({item:a,reference:e,view:i,sync:n,label:t,isDraggable:r,onDragStart:s}){return e?o.jsxs("div",{className:"flex h-full w-full gap-0.5",children:[o.jsxs("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg",children:[o.jsx(E,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:e.meta.vmin,vmax:e.meta.vmax,mode:i.mode,isovalue:i.isovalue,colormap:i.colormap,steps:i.steps,clip:{min:i.clipMin,max:i.clipMax},background:i.background,sync:n}),o.jsx(_,{label:"REF"})]}),o.jsx("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded bg-bg",children:a?o.jsx(F,{item:a,view:i,sync:n,label:t,isDraggable:r,onDragStart:s}):o.jsx("div",{className:"flex h-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"})})]}):o.jsx(F,{item:a,view:i,sync:n,label:t,isDraggable:r,onDragStart:s})}function Le({data:a,reference:e,settings:i,cameraSyncGroupId:n,label:t,isDraggable:r,onDragStart:s}){const c=n?{groupId:n}:null,l=ae(i);if(!a||!e)return o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"});if(!(a.meta.shape[0]===e.meta.shape[0]&&a.meta.shape[1]===e.meta.shape[1]&&a.meta.shape[2]===e.meta.shape[2]))return o.jsxs("div",{className:"flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted",children:["Shape mismatch: ",a.meta.shape.join("×")," vs ",e.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const u=i.diffColormap??"viridis",d=a.meta.shape[0]*a.meta.shape[1]*a.meta.shape[2],x=De(a.arrays.data,e.arrays.data,d),f=we(x,u),h=u==="viridis"?Se(x):x;return o.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[o.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:o.jsx(E,{data:h,shape:a.meta.shape,spacing:a.meta.spacing,origin:a.meta.origin,vmin:f[0],vmax:f[1],mode:l.mode,isovalue:l.isovalue,colormap:u,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,sync:c})}),o.jsx(K,{colormap:u,min:f[0],max:f[1]}),o.jsx(_,{label:t,isDraggable:r,onDragStart:s})]})}function Fe(a,e){const i=a,n=e;return!i||!n?!1:i.meta.shape[0]===n.meta.shape[0]&&i.meta.shape[1]===n.meta.shape[1]&&i.meta.shape[2]===n.meta.shape[2]}const _e={coreModes:["normal","side","split","blend","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:Fe,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],hasSteps:!0,postProcessing:!1,overlays:!1,colorbar:"always",cameraSync:!0,resetView:"always",crossTypeCompare:!1,webglContextsPerPane:1,maxPanes:4,label:{placement:"bottom-left",draggable:!0},downloadExtension:".npz"};async function Ue(a){const e=await fetch(de.artifactUrl(a));if(!e.ok)throw new Error(`failed to fetch volume (${e.status})`);const i=await fe(await e.arrayBuffer());if(!i.data)throw new Error("volume artifact is missing its 'data' array");return Float32Array.from(i.data.data)}function $(a){return me({queries:a.map(e=>({queryKey:["volume-npz",e],enabled:!!e,staleTime:1/0,queryFn:()=>Ue(e)}))})}function Be(a){const{hashes:e,referenceHashes:i,metadata:n,referenceMetadata:t}=a,r=$(e),s=$(i);return y.useMemo(()=>{const c=e.map((u,d)=>{var h;if(!u)return null;const x=(h=r[d])==null?void 0:h.data,f=Y(n==null?void 0:n[d]);return!x||!f?null:{arrays:{data:x},meta:f}}),l=i.map((u,d)=>{var h;if(!u)return null;const x=(h=s[d])==null?void 0:h.data,f=Y(t==null?void 0:t[d]);return!x||!f?null:{arrays:{data:x},meta:f}}),v=r.some(u=>u.isLoading)||s.some(u=>u.isLoading);return{items:c,referenceItems:l,isLoading:v}},[e.join("|"),i.join("|"),(n??[]).join("|"),(t??[]).join("|"),r.map(c=>c.dataUpdatedAt).join("|"),s.map(c=>c.dataUpdatedAt).join("|")])}function Ge(){return{renderMode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark",brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1,zoom:1,pan:{x:0,y:0},diffMode:"none"}}const Xe=new Set(["normal","side","split","blend","diff"]),We=new Set(["mip","iso"]);function qe(a){const e=a;let i=a;if(typeof e.mode=="string"&&We.has(e.mode)&&(i={...i,renderMode:e.mode,mode:void 0}),i.mode==null&&i.nativeMode==null&&typeof e.compareMode=="string"){const n=e.compareMode;n==="diff-value"?i={...i,nativeMode:n}:Xe.has(n)&&(i={...i,mode:n})}return i.diffMode==="none"&&typeof e.diffSubmode=="string"&&(i={...i,diffMode:e.diffSubmode}),i}function He(a){const{data:e,reference:i,settings:n,mode:t,diffMode:r,cameraSyncGroupId:s,label:c,isBaseline:l,isDraggable:v,onDragStart:u,splitPosition:d,onSplitPositionChange:x,blendAlpha:f}=a,h=s?{groupId:s}:null,m=ae(n),M=i==null?"normal":t;return M==="side"?o.jsx(Ae,{item:e,reference:i??null,view:m,sync:h,label:c,isDraggable:v,onDragStart:u}):ce(M)&&(M==="split"||M==="blend"||M==="diff")?!e||!i?o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):o.jsx(Re,{mode:M,renderPrimary:(D,w)=>o.jsx(E,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:e.meta.vmin,vmax:e.meta.vmax,mode:m.mode,isovalue:m.isovalue,colormap:m.colormap,steps:m.steps,clip:{min:m.clipMin,max:m.clipMax},background:m.background,sync:w,onFrame:D}),renderReference:(D,w)=>o.jsx(E,{data:i.arrays.data,shape:i.meta.shape,spacing:i.meta.spacing,origin:i.meta.origin,vmin:i.meta.vmin,vmax:i.meta.vmax,mode:m.mode,isovalue:m.isovalue,colormap:m.colormap,steps:m.steps,clip:{min:m.clipMin,max:m.clipMax},background:m.background,sync:w,onFrame:D}),diffSubmode:r,colormap:n.diffColormap??"viridis",splitPosition:d??.5,onSplitPositionChange:x??(()=>{}),blendAlpha:f??.5,primaryLabel:c}):o.jsx(F,{item:e,view:m,sync:h,label:c,isDraggable:v,onDragStart:u})}const Ye=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],Ze=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],Qe=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],$e=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function Je({settings:a,update:e}){const i=(t,r)=>{const s=[...a.clipMin];s[t]=Math.min(r,a.clipMax[t]),e({clipMin:s})},n=(t,r)=>{const s=[...a.clipMax];s[t]=Math.max(r,a.clipMin[t]),e({clipMax:s})};return o.jsxs(o.Fragment,{children:[o.jsx(V,{label:"Render mode",value:a.renderMode,onChange:t=>e({renderMode:t}),options:Ye}),a.renderMode==="iso"&&o.jsx(j,{label:"Isovalue",value:a.isovalue,onChange:t=>e({isovalue:t}),min:0,max:1,step:.01,format:t=>t.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),o.jsx(V,{label:"Colormap",value:a.colormap,onChange:t=>e({colormap:t}),options:Ze}),o.jsx(V,{label:"Quality",value:String(a.steps),onChange:t=>e({steps:Number(t)}),options:Qe,description:"Raymarch step count — higher is finer but slower"}),o.jsx(V,{label:"Background",value:a.background,onChange:t=>e({background:t}),options:$e}),o.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[o.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),o.jsx(j,{label:"Clip X min",value:a.clipMin[0],onChange:t=>i(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(j,{label:"Clip X max",value:a.clipMax[0],onChange:t=>n(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(j,{label:"Clip Y min",value:a.clipMin[1],onChange:t=>i(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(j,{label:"Clip Y max",value:a.clipMax[1],onChange:t=>n(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(j,{label:"Clip Z min",value:a.clipMin[2],onChange:t=>i(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(j,{label:"Clip Z max",value:a.clipMax[2],onChange:t=>n(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)})]}),o.jsx(V,{label:"Diff colormap",value:a.diffColormap??"viridis",onChange:t=>e({diffColormap:t}),options:[{value:"viridis",label:"Viridis (magnitude)"},{value:"red-green",label:"Red – Green (signed)"}],description:"Color mapping for the native diff mode (diff-value)"})]})}const J={kind:"camera3d",position:[0,0,5],target:[0,0,0],zoom:1},Ke={objectType:"volume",capabilities:_e,useData:Be,defaultSettings:Ge,migrateSettings:qe,viewFromSettings:()=>J,viewToSettingsPatch:()=>({}),defaultView:()=>J,onResetView:a=>Te(a),Pane:He,SettingsControls:Je,nativeDiff:{render:Le}};function ta(a){return o.jsx(ue,{...a,viewport:Ke})}export{ta as default,Ke as volumeViewportModule};

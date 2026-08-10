import{j as i,a_ as ve,r as g,d as xe,aw as ie,av as he,A as be,i as ge,n as Me}from"./parse-overlay-DVkN5vTG.js";import{bo as ye,J as X,b5 as I,bh as T,b6 as ee,z as we,p as Se}from"./index-CeLtsJ48.js";import{u as Ce,o as De,R as je,U as se,p as L,C as F,q as B,s as Te,t as Pe,G as Ae,v as Oe,m as Ve,S as ke,w as Re,x as Ie,d as re,e as le,f as Ee,V as _,y as Fe,h as Ne,i as ze,j as Ue,r as Le,O as ae,k as _e}from"./OffscreenComparePanes-C2TTohHp.js";import"./parse-npz-CwUs9V2k.js";const Be={dark:856343,light:16185594},oe=256;let E=null;function Xe(){if(E!==null)return E;try{const e=document.createElement("canvas").getContext("webgl2");if(e){const t=e.getExtension("WEBGL_lose_context");t==null||t.loseContext()}E=!!e}catch{E=!1}return E}function Ge(a,e,t){const n=t-e||1,o=new Uint8Array(a.length);for(let r=0;r<a.length;r++){const s=(a[r]-e)/n;o[r]=Math.max(0,Math.min(255,Math.round(s*255)))}return o}function te(a){const e=xe(a),t=new Uint8Array(256*4);for(let o=0;o<256;o++)t[o*4]=e[o*3],t[o*4+1]=e[o*3+1],t[o*4+2]=e[o*3+2],t[o*4+3]=255;const n=new Re(t,256,1,Ie,se);return n.minFilter=L,n.magFilter=L,n.wrapS=F,n.wrapT=F,n.needsUpdate=!0,n}const We=`precision highp float;

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
`,Ye=`precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${oe}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${oe};
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
`;function Ze(a,e,t){const[n,o,r]=a,s=r*e[2],c=o*e[1],p=n*e[0],l=t[2],m=t[1],u=t[0];return{scale:[s,c,p],position:[l+s/2,m+c/2,u+p/2],bounds:{min:[l,m,u],max:[l+s,m+c,u+p]}}}function qe({data:a,shape:e,spacing:t,origin:n,vmin:o,vmax:r,mode:s,isovalue:c,colormap:p,steps:l,clip:m,background:u,className:f,sync:v=null,onFrame:x,showAxes:O=!1,showPlanes:P=!1,cameraMode:N="orbital"}){const d=Ce({background:Be[u],sync:v,showAxes:O,showPlanes:P,cameraMode:N,onFrame:x}),{requestRender:V,fitToBounds:M,refs:z}=d,C=g.useRef(null),D=g.useRef(null),w=g.useRef(null),j=g.useRef(null),k=g.useRef(null);return g.useEffect(()=>{var $,Q,J,K;const b=z.scene.current;if(!b)return;C.current&&(b.remove(C.current),($=D.current)==null||$.dispose(),(Q=w.current)==null||Q.dispose(),(J=j.current)==null||J.dispose(),(K=k.current)==null||K.dispose());const[h,S,R]=e,me=Ge(a,o,r),y=new De(me,R,S,h);y.format=je,y.type=se,y.minFilter=L,y.magFilter=L,y.wrapR=F,y.wrapS=F,y.wrapT=F,y.needsUpdate=!0;const Z=te(p),ue={uData:{value:y},uLUT:{value:Z},uMode:{value:s==="mip"?0:1},uSteps:{value:l},uIsovalue:{value:c},uClipMin:{value:new B(...m.min)},uClipMax:{value:new B(...m.max)},uTexelSize:{value:new B(1/R,1/S,1/h)}},q=new Te({glslVersion:Ae,vertexShader:We,fragmentShader:Ye,uniforms:ue,side:Pe,transparent:!1}),H=new Oe(1,1,1),U=new Ve(H,q),{scale:de,position:pe,bounds:fe}=Ze(e,t,n);U.scale.set(...de),U.position.set(...pe),b.add(U),C.current=U,D.current=H,w.current=q,j.current=y,k.current=Z,M(fe)},[a,e,t,n,o,r]),g.useEffect(()=>{var S;const b=w.current;if(!b)return;(S=k.current)==null||S.dispose();const h=te(p);k.current=h,b.uniforms.uLUT.value=h,V()},[p]),g.useEffect(()=>{const b=w.current;if(!b)return;const h=b.uniforms;h.uMode.value=s==="mip"?0:1,h.uSteps.value=l,h.uIsovalue.value=c,h.uClipMin.value.set(...m.min),h.uClipMax.value.set(...m.max),V()},[s,c,l,m]),g.useEffect(()=>()=>{var b,h,S,R;(b=D.current)==null||b.dispose(),(h=w.current)==null||h.dispose(),(S=j.current)==null||S.dispose(),(R=k.current)==null||R.dispose()},[]),i.jsx(ke,{handle:d,className:f})}function A(a){return Xe()?i.jsx(qe,{...a}):i.jsx(ve,{className:a.className,title:"WebGL2 unavailable",body:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})}function Y(a){return{mode:a.renderMode,isovalue:a.isovalue,colormap:a.colormap,steps:a.steps,clipMin:a.clipMin,clipMax:a.clipMax,background:a.background,showAxes:a.showAxes??!1,showPlanes:a.showPlanes??!1,cameraMode:a.cameraMode??"orbital"}}function G({item:a,view:e,sync:t,label:n,isDraggable:o,onDragStart:r,onFrame:s,colorRange:c}){if(!a)return i.jsx(_,{variant:"empty",children:"no volume logged yet"});const{arrays:p,meta:l}=a,[m,u]=c??[l.vmin,l.vmax];return i.jsxs("div",{className:"relative flex h-full w-full flex-col overflow-hidden rounded bg-bg",children:[i.jsx("div",{className:"flex flex-1 min-h-0 overflow-hidden",children:i.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:i.jsx(A,{data:p.data,shape:l.shape,spacing:l.spacing,origin:l.origin,vmin:m,vmax:u,mode:e.mode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clip:{min:e.clipMin,max:e.clipMax},background:e.background,showAxes:e.showAxes,showPlanes:e.showPlanes,cameraMode:e.cameraMode,sync:t,onFrame:s})})}),i.jsx(ze,{text:`${l.shape.join("×")} · vmin ${l.vmin.toFixed(3)} · vmax ${l.vmax.toFixed(3)}`}),i.jsx(ie,{label:n,isDraggable:o,onDragStart:r})]})}function He({item:a,reference:e,view:t,sync:n,label:o,isDraggable:r,onDragStart:s,colorRange:c}){const p=Ne(n);if(!e)return i.jsx(G,{item:a,view:t,sync:n,label:o,isDraggable:r,onDragStart:s,colorRange:c});const[l,m]=c??[e.meta.vmin,e.meta.vmax];return i.jsxs("div",{className:"flex h-full w-full gap-0.5",children:[i.jsxs("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg",children:[i.jsx(A,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:l,vmax:m,mode:t.mode,isovalue:t.isovalue,colormap:t.colormap,steps:t.steps,clip:{min:t.clipMin,max:t.clipMax},background:t.background,showAxes:t.showAxes,showPlanes:t.showPlanes,cameraMode:t.cameraMode,sync:p}),i.jsx(he,{})]}),i.jsx("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded bg-bg",children:a?i.jsx(G,{item:a,view:t,sync:p,label:o,isDraggable:r,onDragStart:s,colorRange:c}):i.jsx(_,{variant:"empty",children:"no volume logged yet"})})]})}function $e({data:a,reference:e,settings:t,cameraSyncGroupId:n,label:o,isDraggable:r,onDragStart:s,colorRange:c}){const p=n?{groupId:n}:null,l=Y(t);if(!a||!e)return i.jsx(_,{variant:"loading",children:"loading…"});if(!(a.meta.shape[0]===e.meta.shape[0]&&a.meta.shape[1]===e.meta.shape[1]&&a.meta.shape[2]===e.meta.shape[2]))return i.jsxs(_,{variant:"error",children:["Shape mismatch: ",a.meta.shape.join("×")," vs ",e.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const u=t.diffColormap??"viridis",f=a.meta.shape[0]*a.meta.shape[1]*a.meta.shape[2],v=re(a.arrays.data,e.arrays.data,f),x=c??le(v,u),O=u==="viridis"?Fe(v):v;return i.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[i.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:i.jsx(A,{data:O,shape:a.meta.shape,spacing:a.meta.spacing,origin:a.meta.origin,vmin:x[0],vmax:x[1],mode:l.mode,isovalue:l.isovalue,colormap:u,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,showAxes:l.showAxes,showPlanes:l.showPlanes,cameraMode:l.cameraMode,sync:p})}),i.jsx(ie,{label:o,isDraggable:r,onDragStart:s})]})}function Qe(a,e){const t=a,n=e;return!t||!n?!1:t.meta.shape[0]===n.meta.shape[0]&&t.meta.shape[1]===n.meta.shape[1]&&t.meta.shape[2]===n.meta.shape[2]}function Je(a){const{items:e,referenceItems:t,settings:n,nativeMode:o}=a;if(o==="diff-value"){const c=n.diffColormap??"viridis",p=[];for(let m=0;m<e.length;m++){const u=e[m],f=t[m];if(!u||!f||u.meta.shape[0]!==f.meta.shape[0]||u.meta.shape[1]!==f.meta.shape[1]||u.meta.shape[2]!==f.meta.shape[2])continue;const v=u.meta.shape[0]*u.meta.shape[1]*u.meta.shape[2],x=re(u.arrays.data,f.arrays.data,v);p.push(le(x,c))}const l=Ee(p,c);return l?{colormap:c,min:l[0],max:l[1]}:null}let r=1/0,s=-1/0;for(const c of[...e,...t])c&&(r=Math.min(r,c.meta.vmin),s=Math.max(s,c.meta.vmax));return!Number.isFinite(r)||!Number.isFinite(s)?null:{colormap:n.colormap,min:r,max:s}}const Ke={coreModes:["normal","side","split","blend","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:Qe,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],hasSteps:!0,postProcessing:!1,overlays:!1,colorbar:"never",cameraSync:!0,resetView:"always",crossTypeCompare:!0,webglContextsPerPane:1,maxPanes:4,label:{placement:"bottom-left",draggable:!0},downloadExtension:".npz"},ea=Me(a=>Se.artifactUrl(a));function W(a){return we({queries:a.map(e=>({queryKey:["volume-npz",e],enabled:!!e,staleTime:1/0,queryFn:()=>be(e,ea)}))})}function aa(a){const{hashes:e,referenceHashes:t,metadata:n,referenceMetadata:o}=a,r=W(e),s=W(t);return g.useMemo(()=>{const c=e.map((m,u)=>{var x;if(!m)return null;const f=(x=r[u])==null?void 0:x.data,v=X(n==null?void 0:n[u]);return!f||!v?null:{arrays:{data:f},meta:v}}),p=t.map((m,u)=>{var x;if(!m)return null;const f=(x=s[u])==null?void 0:x.data,v=X(o==null?void 0:o[u]);return!f||!v?null:{arrays:{data:f},meta:v}}),l=r.some(m=>m.isLoading)||s.some(m=>m.isLoading);return{items:c,referenceItems:p,isLoading:l}},[e.join("|"),t.join("|"),(n??[]).join("|"),(o??[]).join("|"),r.map(c=>c.dataUpdatedAt).join("|"),s.map(c=>c.dataUpdatedAt).join("|")])}function ha({hash:a,metadata:e,onFrame:t}){const[n]=W([a]),o=X(e),r=Ue(),s=Y(ce());return g.useEffect(()=>{r.dataUrl&&t({kind:"dataUrl",dataUrl:r.dataUrl})},[r.dataUrl]),!(n!=null&&n.data)||!o?null:i.jsx(A,{data:n.data,shape:o.shape,spacing:o.spacing,origin:o.origin,vmin:o.vmin,vmax:o.vmax,mode:s.mode,isovalue:s.isovalue,colormap:s.colormap,steps:s.steps,clip:{min:s.clipMin,max:s.clipMax},background:s.background,showAxes:s.showAxes,showPlanes:s.showPlanes,cameraMode:s.cameraMode,onFrame:r.onFrame})}function ce(){return{renderMode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark",showAxes:!1,showPlanes:!1,cameraMode:"orbital",syncViews:!0,brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1,zoom:1,pan:{x:0,y:0},diffMode:"none"}}const oa=new Set(["normal","side","split","blend","diff"]),ta=new Set(["mip","iso"]);function na(a){const e=a;let t=a;if(typeof e.mode=="string"&&ta.has(e.mode)&&(t={...t,renderMode:e.mode,mode:void 0}),t.mode==null&&t.nativeMode==null&&typeof e.compareMode=="string"){const n=e.compareMode;n==="diff-value"?t={...t,nativeMode:n}:oa.has(n)&&(t={...t,mode:n})}return t.diffMode==="none"&&typeof e.diffSubmode=="string"&&(t={...t,diffMode:e.diffSubmode}),t}function ia(a){const{data:e,reference:t,settings:n,mode:o,diffMode:r,cameraSyncGroupId:s,label:c,isBaseline:p,isDraggable:l,onDragStart:m,splitPosition:u,onSplitPositionChange:f,blendAlpha:v,crossTypeReferenceUrl:x,crossTypeAlignForDiff:O,colorRange:P}=a,N=s?{groupId:s}:null,d=Y(n),V=x!=null,M=t==null&&!V?"normal":o,z=(C,D)=>{const[w,j]=P??[e.meta.vmin,e.meta.vmax];return i.jsx(A,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:w,vmax:j,mode:d.mode,isovalue:d.isovalue,colormap:d.colormap,steps:d.steps,clip:{min:d.clipMin,max:d.clipMax},background:d.background,showAxes:d.showAxes,showPlanes:d.showPlanes,cameraMode:d.cameraMode,sync:D,onFrame:C})};return V&&M!=="normal"?e?i.jsx(ae,{mode:M,syncGroupId:s??null,primary:{kind:"live",render:z},reference:{kind:"frame",frameSource:{kind:"url",url:x}},diffSubmode:r,colormap:n.diffColormap??"viridis",splitPosition:u??.5,onSplitPositionChange:f??(()=>{}),blendAlpha:v??.5,primaryLabel:c,alignForDiff:O}):i.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):M==="side"?i.jsx(He,{item:e,reference:t??null,view:d,sync:N,label:c,isDraggable:l,onDragStart:m,colorRange:P}):_e(M)&&(M==="split"||M==="blend"||M==="diff")?!e||!t?i.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):i.jsx(ae,{mode:M,syncGroupId:s??null,primary:{kind:"live",render:z},reference:{kind:"live",render:(C,D)=>{const[w,j]=P??[t.meta.vmin,t.meta.vmax];return i.jsx(A,{data:t.arrays.data,shape:t.meta.shape,spacing:t.meta.spacing,origin:t.meta.origin,vmin:w,vmax:j,mode:d.mode,isovalue:d.isovalue,colormap:d.colormap,steps:d.steps,clip:{min:d.clipMin,max:d.clipMax},background:d.background,showAxes:d.showAxes,showPlanes:d.showPlanes,cameraMode:d.cameraMode,sync:D,onFrame:C})}},diffSubmode:r,colormap:n.diffColormap??"viridis",splitPosition:u??.5,onSplitPositionChange:f??(()=>{}),blendAlpha:v??.5,primaryLabel:c}):i.jsx(G,{item:e,view:d,sync:N,label:c,isDraggable:l,onDragStart:m,colorRange:P})}const sa=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],ra=ge.map(a=>({value:a.id,label:a.label})),la=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],ca=[{value:"orbital",label:"Orbital"},{value:"turntable",label:"Turntable"}],ma=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function ua({settings:a,update:e}){const t=(o,r)=>{const s=[...a.clipMin];s[o]=Math.min(r,a.clipMax[o]),e({clipMin:s})},n=(o,r)=>{const s=[...a.clipMax];s[o]=Math.max(r,a.clipMin[o]),e({clipMax:s})};return i.jsxs(i.Fragment,{children:[i.jsx(I,{label:"Render mode",value:a.renderMode,onChange:o=>e({renderMode:o}),options:sa}),a.renderMode==="iso"&&i.jsx(T,{label:"Isovalue",value:a.isovalue,onChange:o=>e({isovalue:o}),min:0,max:1,step:.01,format:o=>o.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),i.jsx(I,{label:"Colormap",value:a.colormap,onChange:o=>e({colormap:o}),options:ra}),i.jsx(I,{label:"Quality",value:String(a.steps),onChange:o=>e({steps:Number(o)}),options:la,description:"Raymarch step count — higher is finer but slower"}),i.jsx(I,{label:"Background",value:a.background,onChange:o=>e({background:o}),options:ma}),i.jsx(ee,{label:"Show axes",checked:!!a.showAxes,onChange:o=>e({showAxes:o}),description:"Colored XYZ origin lines + grid, sized to the fitted view"}),i.jsx(ee,{label:"Show planes",checked:!!a.showPlanes,onChange:o=>e({showPlanes:o}),description:"Faint XY/YZ/XZ reference planes through the origin"}),i.jsx(I,{label:"Orientation",value:a.cameraMode??"orbital",onChange:o=>e({cameraMode:o}),options:ca,description:"Turntable locks world-up and spins about it; orbital is free orbit"}),i.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[i.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),i.jsx(T,{label:"Clip X min",value:a.clipMin[0],onChange:o=>t(0,o),min:0,max:1,step:.01,format:o=>o.toFixed(2)}),i.jsx(T,{label:"Clip X max",value:a.clipMax[0],onChange:o=>n(0,o),min:0,max:1,step:.01,format:o=>o.toFixed(2)}),i.jsx(T,{label:"Clip Y min",value:a.clipMin[1],onChange:o=>t(1,o),min:0,max:1,step:.01,format:o=>o.toFixed(2)}),i.jsx(T,{label:"Clip Y max",value:a.clipMax[1],onChange:o=>n(1,o),min:0,max:1,step:.01,format:o=>o.toFixed(2)}),i.jsx(T,{label:"Clip Z min",value:a.clipMin[2],onChange:o=>t(2,o),min:0,max:1,step:.01,format:o=>o.toFixed(2)}),i.jsx(T,{label:"Clip Z max",value:a.clipMax[2],onChange:o=>n(2,o),min:0,max:1,step:.01,format:o=>o.toFixed(2)})]})]})}const ne={kind:"camera3d",position:[0,0,5],target:[0,0,0],zoom:1},da={objectType:"volume",capabilities:Ke,useData:aa,defaultSettings:ce,migrateSettings:na,viewFromSettings:()=>ne,viewToSettingsPatch:()=>({}),defaultView:()=>ne,onResetView:a=>Le(a),Pane:ia,SettingsControls:ua,nativeDiff:{render:$e},activeColorbar:Je};function ba(a){return i.jsx(ye,{...a,viewport:da})}export{ha as VolumeForeignFrame,ba as default,da as volumeViewportModule};

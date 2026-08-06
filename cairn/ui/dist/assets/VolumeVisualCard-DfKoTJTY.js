import{j as i,aZ as ve,r as g,d as xe,av as ie,au as he,z as be,m as ge}from"./parse-overlay-lS9yzqnX.js";import{bo as Me,J as X,b5 as E,bh as T,b6 as ee,z as ye,p as we}from"./index-BGUYXpUc.js";import{u as Se,o as Ce,R as De,U as se,p as L,C as F,q as B,s as je,t as Te,G as Pe,v as Ae,m as Oe,S as Ve,w as ke,x as Re,d as re,e as le,f as Ee,V as _,y as Ie,h as Fe,i as ze,j as Ne,r as Ue,O as ae,k as Le}from"./OffscreenComparePanes-BX12BfZB.js";import"./parse-npz-D2r_QiBi.js";const _e={dark:856343,light:16185594},oe=256;let I=null;function Be(){if(I!==null)return I;try{const e=document.createElement("canvas").getContext("webgl2");if(e){const n=e.getExtension("WEBGL_lose_context");n==null||n.loseContext()}I=!!e}catch{I=!1}return I}function Xe(o,e,n){const t=n-e||1,a=new Uint8Array(o.length);for(let r=0;r<o.length;r++){const s=(o[r]-e)/t;a[r]=Math.max(0,Math.min(255,Math.round(s*255)))}return a}function ne(o){const e=xe(o),n=new Uint8Array(256*4);for(let a=0;a<256;a++)n[a*4]=e[a*3],n[a*4+1]=e[a*3+1],n[a*4+2]=e[a*3+2],n[a*4+3]=255;const t=new ke(n,256,1,Re,se);return t.minFilter=L,t.magFilter=L,t.wrapS=F,t.wrapT=F,t.needsUpdate=!0,t}const Ge=`precision highp float;

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
`,We=`precision highp float;
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
`;function Ye(o,e,n){const[t,a,r]=o,s=r*e[2],c=a*e[1],p=t*e[0],l=n[2],m=n[1],u=n[0];return{scale:[s,c,p],position:[l+s/2,m+c/2,u+p/2],bounds:{min:[l,m,u],max:[l+s,m+c,u+p]}}}function Ze({data:o,shape:e,spacing:n,origin:t,vmin:a,vmax:r,mode:s,isovalue:c,colormap:p,steps:l,clip:m,background:u,className:f,sync:v=null,onFrame:x,showAxes:O=!1,showPlanes:P=!1,cameraMode:z="orbital"}){const d=Se({background:_e[u],sync:v,showAxes:O,showPlanes:P,cameraMode:z,onFrame:x}),{requestRender:V,fitToBounds:M,refs:N}=d,C=g.useRef(null),D=g.useRef(null),w=g.useRef(null),j=g.useRef(null),k=g.useRef(null);return g.useEffect(()=>{var $,Q,J,K;const b=N.scene.current;if(!b)return;C.current&&(b.remove(C.current),($=D.current)==null||$.dispose(),(Q=w.current)==null||Q.dispose(),(J=j.current)==null||J.dispose(),(K=k.current)==null||K.dispose());const[h,S,R]=e,me=Xe(o,a,r),y=new Ce(me,R,S,h);y.format=De,y.type=se,y.minFilter=L,y.magFilter=L,y.wrapR=F,y.wrapS=F,y.wrapT=F,y.needsUpdate=!0;const Z=ne(p),ue={uData:{value:y},uLUT:{value:Z},uMode:{value:s==="mip"?0:1},uSteps:{value:l},uIsovalue:{value:c},uClipMin:{value:new B(...m.min)},uClipMax:{value:new B(...m.max)},uTexelSize:{value:new B(1/R,1/S,1/h)}},q=new je({glslVersion:Pe,vertexShader:Ge,fragmentShader:We,uniforms:ue,side:Te,transparent:!1}),H=new Ae(1,1,1),U=new Oe(H,q),{scale:de,position:pe,bounds:fe}=Ye(e,n,t);U.scale.set(...de),U.position.set(...pe),b.add(U),C.current=U,D.current=H,w.current=q,j.current=y,k.current=Z,M(fe)},[o,e,n,t,a,r]),g.useEffect(()=>{var S;const b=w.current;if(!b)return;(S=k.current)==null||S.dispose();const h=ne(p);k.current=h,b.uniforms.uLUT.value=h,V()},[p]),g.useEffect(()=>{const b=w.current;if(!b)return;const h=b.uniforms;h.uMode.value=s==="mip"?0:1,h.uSteps.value=l,h.uIsovalue.value=c,h.uClipMin.value.set(...m.min),h.uClipMax.value.set(...m.max),V()},[s,c,l,m]),g.useEffect(()=>()=>{var b,h,S,R;(b=D.current)==null||b.dispose(),(h=w.current)==null||h.dispose(),(S=j.current)==null||S.dispose(),(R=k.current)==null||R.dispose()},[]),i.jsx(Ve,{handle:d,className:f})}function A(o){return Be()?i.jsx(Ze,{...o}):i.jsx(ve,{className:o.className,title:"WebGL2 unavailable",body:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})}function Y(o){return{mode:o.renderMode,isovalue:o.isovalue,colormap:o.colormap,steps:o.steps,clipMin:o.clipMin,clipMax:o.clipMax,background:o.background,showAxes:o.showAxes??!1,showPlanes:o.showPlanes??!1,cameraMode:o.cameraMode??"orbital"}}function G({item:o,view:e,sync:n,label:t,isDraggable:a,onDragStart:r,onFrame:s,colorRange:c}){if(!o)return i.jsx(_,{variant:"empty",children:"no volume logged yet"});const{arrays:p,meta:l}=o,[m,u]=c??[l.vmin,l.vmax];return i.jsxs("div",{className:"relative flex h-full w-full flex-col overflow-hidden rounded bg-bg",children:[i.jsx("div",{className:"flex flex-1 min-h-0 overflow-hidden",children:i.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:i.jsx(A,{data:p.data,shape:l.shape,spacing:l.spacing,origin:l.origin,vmin:m,vmax:u,mode:e.mode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clip:{min:e.clipMin,max:e.clipMax},background:e.background,showAxes:e.showAxes,showPlanes:e.showPlanes,cameraMode:e.cameraMode,sync:n,onFrame:s})})}),i.jsx(ze,{text:`${l.shape.join("×")} · vmin ${l.vmin.toFixed(3)} · vmax ${l.vmax.toFixed(3)}`}),i.jsx(ie,{label:t,isDraggable:a,onDragStart:r})]})}function qe({item:o,reference:e,view:n,sync:t,label:a,isDraggable:r,onDragStart:s,colorRange:c}){const p=Fe(t);if(!e)return i.jsx(G,{item:o,view:n,sync:t,label:a,isDraggable:r,onDragStart:s,colorRange:c});const[l,m]=c??[e.meta.vmin,e.meta.vmax];return i.jsxs("div",{className:"flex h-full w-full gap-0.5",children:[i.jsxs("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg",children:[i.jsx(A,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:l,vmax:m,mode:n.mode,isovalue:n.isovalue,colormap:n.colormap,steps:n.steps,clip:{min:n.clipMin,max:n.clipMax},background:n.background,showAxes:n.showAxes,showPlanes:n.showPlanes,cameraMode:n.cameraMode,sync:p}),i.jsx(he,{})]}),i.jsx("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded bg-bg",children:o?i.jsx(G,{item:o,view:n,sync:p,label:a,isDraggable:r,onDragStart:s,colorRange:c}):i.jsx(_,{variant:"empty",children:"no volume logged yet"})})]})}function He({data:o,reference:e,settings:n,cameraSyncGroupId:t,label:a,isDraggable:r,onDragStart:s,colorRange:c}){const p=t?{groupId:t}:null,l=Y(n);if(!o||!e)return i.jsx(_,{variant:"loading",children:"loading…"});if(!(o.meta.shape[0]===e.meta.shape[0]&&o.meta.shape[1]===e.meta.shape[1]&&o.meta.shape[2]===e.meta.shape[2]))return i.jsxs(_,{variant:"error",children:["Shape mismatch: ",o.meta.shape.join("×")," vs ",e.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const u=n.diffColormap??"viridis",f=o.meta.shape[0]*o.meta.shape[1]*o.meta.shape[2],v=re(o.arrays.data,e.arrays.data,f),x=c??le(v,u),O=u==="viridis"?Ie(v):v;return i.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[i.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:i.jsx(A,{data:O,shape:o.meta.shape,spacing:o.meta.spacing,origin:o.meta.origin,vmin:x[0],vmax:x[1],mode:l.mode,isovalue:l.isovalue,colormap:u,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,showAxes:l.showAxes,showPlanes:l.showPlanes,cameraMode:l.cameraMode,sync:p})}),i.jsx(ie,{label:a,isDraggable:r,onDragStart:s})]})}function $e(o,e){const n=o,t=e;return!n||!t?!1:n.meta.shape[0]===t.meta.shape[0]&&n.meta.shape[1]===t.meta.shape[1]&&n.meta.shape[2]===t.meta.shape[2]}function Qe(o){const{items:e,referenceItems:n,settings:t,nativeMode:a}=o;if(a==="diff-value"){const c=t.diffColormap??"viridis",p=[];for(let m=0;m<e.length;m++){const u=e[m],f=n[m];if(!u||!f||u.meta.shape[0]!==f.meta.shape[0]||u.meta.shape[1]!==f.meta.shape[1]||u.meta.shape[2]!==f.meta.shape[2])continue;const v=u.meta.shape[0]*u.meta.shape[1]*u.meta.shape[2],x=re(u.arrays.data,f.arrays.data,v);p.push(le(x,c))}const l=Ee(p,c);return l?{colormap:c,min:l[0],max:l[1]}:null}let r=1/0,s=-1/0;for(const c of[...e,...n])c&&(r=Math.min(r,c.meta.vmin),s=Math.max(s,c.meta.vmax));return!Number.isFinite(r)||!Number.isFinite(s)?null:{colormap:t.colormap,min:r,max:s}}const Je={coreModes:["normal","side","split","blend","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:$e,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],hasSteps:!0,postProcessing:!1,overlays:!1,colorbar:"never",cameraSync:!0,resetView:"always",crossTypeCompare:!0,webglContextsPerPane:1,maxPanes:4,label:{placement:"bottom-left",draggable:!0},downloadExtension:".npz"},Ke=ge(o=>we.artifactUrl(o));function W(o){return ye({queries:o.map(e=>({queryKey:["volume-npz",e],enabled:!!e,staleTime:1/0,queryFn:()=>be(e,Ke)}))})}function ea(o){const{hashes:e,referenceHashes:n,metadata:t,referenceMetadata:a}=o,r=W(e),s=W(n);return g.useMemo(()=>{const c=e.map((m,u)=>{var x;if(!m)return null;const f=(x=r[u])==null?void 0:x.data,v=X(t==null?void 0:t[u]);return!f||!v?null:{arrays:{data:f},meta:v}}),p=n.map((m,u)=>{var x;if(!m)return null;const f=(x=s[u])==null?void 0:x.data,v=X(a==null?void 0:a[u]);return!f||!v?null:{arrays:{data:f},meta:v}}),l=r.some(m=>m.isLoading)||s.some(m=>m.isLoading);return{items:c,referenceItems:p,isLoading:l}},[e.join("|"),n.join("|"),(t??[]).join("|"),(a??[]).join("|"),r.map(c=>c.dataUpdatedAt).join("|"),s.map(c=>c.dataUpdatedAt).join("|")])}function xa({hash:o,metadata:e,onFrame:n}){const[t]=W([o]),a=X(e),r=Ne(),s=Y(ce());return g.useEffect(()=>{r.dataUrl&&n({kind:"dataUrl",dataUrl:r.dataUrl})},[r.dataUrl]),!(t!=null&&t.data)||!a?null:i.jsx(A,{data:t.data,shape:a.shape,spacing:a.spacing,origin:a.origin,vmin:a.vmin,vmax:a.vmax,mode:s.mode,isovalue:s.isovalue,colormap:s.colormap,steps:s.steps,clip:{min:s.clipMin,max:s.clipMax},background:s.background,showAxes:s.showAxes,showPlanes:s.showPlanes,cameraMode:s.cameraMode,onFrame:r.onFrame})}function ce(){return{renderMode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark",showAxes:!1,showPlanes:!1,cameraMode:"orbital",syncViews:!0,brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1,zoom:1,pan:{x:0,y:0},diffMode:"none"}}const aa=new Set(["normal","side","split","blend","diff"]),oa=new Set(["mip","iso"]);function na(o){const e=o;let n=o;if(typeof e.mode=="string"&&oa.has(e.mode)&&(n={...n,renderMode:e.mode,mode:void 0}),n.mode==null&&n.nativeMode==null&&typeof e.compareMode=="string"){const t=e.compareMode;t==="diff-value"?n={...n,nativeMode:t}:aa.has(t)&&(n={...n,mode:t})}return n.diffMode==="none"&&typeof e.diffSubmode=="string"&&(n={...n,diffMode:e.diffSubmode}),n}function ta(o){const{data:e,reference:n,settings:t,mode:a,diffMode:r,cameraSyncGroupId:s,label:c,isBaseline:p,isDraggable:l,onDragStart:m,splitPosition:u,onSplitPositionChange:f,blendAlpha:v,crossTypeReferenceUrl:x,crossTypeAlignForDiff:O,colorRange:P}=o,z=s?{groupId:s}:null,d=Y(t),V=x!=null,M=n==null&&!V?"normal":a,N=(C,D)=>{const[w,j]=P??[e.meta.vmin,e.meta.vmax];return i.jsx(A,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:w,vmax:j,mode:d.mode,isovalue:d.isovalue,colormap:d.colormap,steps:d.steps,clip:{min:d.clipMin,max:d.clipMax},background:d.background,showAxes:d.showAxes,showPlanes:d.showPlanes,cameraMode:d.cameraMode,sync:D,onFrame:C})};return V&&M!=="normal"?e?i.jsx(ae,{mode:M,syncGroupId:s??null,primary:{kind:"live",render:N},reference:{kind:"frame",frameSource:{kind:"url",url:x}},diffSubmode:r,colormap:t.diffColormap??"viridis",splitPosition:u??.5,onSplitPositionChange:f??(()=>{}),blendAlpha:v??.5,primaryLabel:c,alignForDiff:O}):i.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):M==="side"?i.jsx(qe,{item:e,reference:n??null,view:d,sync:z,label:c,isDraggable:l,onDragStart:m,colorRange:P}):Le(M)&&(M==="split"||M==="blend"||M==="diff")?!e||!n?i.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):i.jsx(ae,{mode:M,syncGroupId:s??null,primary:{kind:"live",render:N},reference:{kind:"live",render:(C,D)=>{const[w,j]=P??[n.meta.vmin,n.meta.vmax];return i.jsx(A,{data:n.arrays.data,shape:n.meta.shape,spacing:n.meta.spacing,origin:n.meta.origin,vmin:w,vmax:j,mode:d.mode,isovalue:d.isovalue,colormap:d.colormap,steps:d.steps,clip:{min:d.clipMin,max:d.clipMax},background:d.background,showAxes:d.showAxes,showPlanes:d.showPlanes,cameraMode:d.cameraMode,sync:D,onFrame:C})}},diffSubmode:r,colormap:t.diffColormap??"viridis",splitPosition:u??.5,onSplitPositionChange:f??(()=>{}),blendAlpha:v??.5,primaryLabel:c}):i.jsx(G,{item:e,view:d,sync:z,label:c,isDraggable:l,onDragStart:m,colorRange:P})}const ia=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],sa=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],ra=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],la=[{value:"orbital",label:"Orbital"},{value:"turntable",label:"Turntable"}],ca=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function ma({settings:o,update:e}){const n=(a,r)=>{const s=[...o.clipMin];s[a]=Math.min(r,o.clipMax[a]),e({clipMin:s})},t=(a,r)=>{const s=[...o.clipMax];s[a]=Math.max(r,o.clipMin[a]),e({clipMax:s})};return i.jsxs(i.Fragment,{children:[i.jsx(E,{label:"Render mode",value:o.renderMode,onChange:a=>e({renderMode:a}),options:ia}),o.renderMode==="iso"&&i.jsx(T,{label:"Isovalue",value:o.isovalue,onChange:a=>e({isovalue:a}),min:0,max:1,step:.01,format:a=>a.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),i.jsx(E,{label:"Colormap",value:o.colormap,onChange:a=>e({colormap:a}),options:sa}),i.jsx(E,{label:"Quality",value:String(o.steps),onChange:a=>e({steps:Number(a)}),options:ra,description:"Raymarch step count — higher is finer but slower"}),i.jsx(E,{label:"Background",value:o.background,onChange:a=>e({background:a}),options:ca}),i.jsx(ee,{label:"Show axes",checked:!!o.showAxes,onChange:a=>e({showAxes:a}),description:"Colored XYZ origin lines + grid, sized to the fitted view"}),i.jsx(ee,{label:"Show planes",checked:!!o.showPlanes,onChange:a=>e({showPlanes:a}),description:"Faint XY/YZ/XZ reference planes through the origin"}),i.jsx(E,{label:"Orientation",value:o.cameraMode??"orbital",onChange:a=>e({cameraMode:a}),options:la,description:"Turntable locks world-up and spins about it; orbital is free orbit"}),i.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[i.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),i.jsx(T,{label:"Clip X min",value:o.clipMin[0],onChange:a=>n(0,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),i.jsx(T,{label:"Clip X max",value:o.clipMax[0],onChange:a=>t(0,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),i.jsx(T,{label:"Clip Y min",value:o.clipMin[1],onChange:a=>n(1,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),i.jsx(T,{label:"Clip Y max",value:o.clipMax[1],onChange:a=>t(1,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),i.jsx(T,{label:"Clip Z min",value:o.clipMin[2],onChange:a=>n(2,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),i.jsx(T,{label:"Clip Z max",value:o.clipMax[2],onChange:a=>t(2,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)})]})]})}const te={kind:"camera3d",position:[0,0,5],target:[0,0,0],zoom:1},ua={objectType:"volume",capabilities:Je,useData:ea,defaultSettings:ce,migrateSettings:na,viewFromSettings:()=>te,viewToSettingsPatch:()=>({}),defaultView:()=>te,onResetView:o=>Ue(o),Pane:ta,SettingsControls:ma,nativeDiff:{render:He},activeColorbar:Qe};function ha(o){return i.jsx(Me,{...o,viewport:ua})}export{xa as VolumeForeignFrame,ha as default,ua as volumeViewportModule};

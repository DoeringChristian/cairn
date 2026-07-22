import{j as n,r as b,d as fe,aj as W,M as xe,i as ve}from"./parse-overlay-p_i7Mkvi.js";import{bn as he,J as B,b4 as R,bg as T,b5 as ee,z as ge,p as be}from"./index-yDxzvzT-.js";import{u as Me,n as ye,R as we,U as ie,o as L,C as F,V as _,p as Se,q as je,G as Ce,s as De,l as Te,S as Pe,t as Ae,v as Oe,d as se,e as re,f as Ve,w as ke,h as Ne,i as Re,r as Ee,O as ae,j as Fe}from"./diff-DUVFtAGe.js";const Ie={dark:856343,light:16185594},te=256;let E=null;function ze(){if(E!==null)return E;try{const e=document.createElement("canvas").getContext("webgl2");if(e){const o=e.getExtension("WEBGL_lose_context");o==null||o.loseContext()}E=!!e}catch{E=!1}return E}function Ue({className:a}){return n.jsx("div",{className:a??"relative h-full w-full",children:n.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[n.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),n.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function Le(a,e,o){const i=o-e||1,t=new Uint8Array(a.length);for(let r=0;r<a.length;r++){const s=(a[r]-e)/i;t[r]=Math.max(0,Math.min(255,Math.round(s*255)))}return t}function oe(a){const e=fe(a),o=new Uint8Array(256*4);for(let t=0;t<256;t++)o[t*4]=e[t*3],o[t*4+1]=e[t*3+1],o[t*4+2]=e[t*3+2],o[t*4+3]=255;const i=new Ae(o,256,1,Oe,ie);return i.minFilter=L,i.magFilter=L,i.wrapS=F,i.wrapT=F,i.needsUpdate=!0,i}const _e=`precision highp float;

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
`,Be=`precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${te}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${te};
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
`;function Xe(a,e,o){const[i,t,r]=a,s=r*e[2],c=t*e[1],p=i*e[0],l=o[2],u=o[1],m=o[0];return{scale:[s,c,p],position:[l+s/2,u+c/2,m+p/2],bounds:{min:[l,u,m],max:[l+s,u+c,m+p]}}}function Ge({data:a,shape:e,spacing:o,origin:i,vmin:t,vmax:r,mode:s,isovalue:c,colormap:p,steps:l,clip:u,background:m,className:f,sync:x=null,onFrame:v,showAxes:O=!1,showPlanes:P=!1,cameraMode:I="orbital"}){const d=Me({background:Ie[m],sync:x,showAxes:O,showPlanes:P,cameraMode:I,onFrame:v}),{requestRender:V,fitToBounds:M,refs:z}=d,j=b.useRef(null),C=b.useRef(null),w=b.useRef(null),D=b.useRef(null),k=b.useRef(null);return b.useEffect(()=>{var $,Q,J,K;const g=z.scene.current;if(!g)return;j.current&&(g.remove(j.current),($=C.current)==null||$.dispose(),(Q=w.current)==null||Q.dispose(),(J=D.current)==null||J.dispose(),(K=k.current)==null||K.dispose());const[h,S,N]=e,ce=Le(a,t,r),y=new ye(ce,N,S,h);y.format=we,y.type=ie,y.minFilter=L,y.magFilter=L,y.wrapR=F,y.wrapS=F,y.wrapT=F,y.needsUpdate=!0;const Z=oe(p),ue={uData:{value:y},uLUT:{value:Z},uMode:{value:s==="mip"?0:1},uSteps:{value:l},uIsovalue:{value:c},uClipMin:{value:new _(...u.min)},uClipMax:{value:new _(...u.max)},uTexelSize:{value:new _(1/N,1/S,1/h)}},q=new Se({glslVersion:Ce,vertexShader:_e,fragmentShader:Be,uniforms:ue,side:je,transparent:!1}),H=new De(1,1,1),U=new Te(H,q),{scale:me,position:de,bounds:pe}=Xe(e,o,i);U.scale.set(...me),U.position.set(...de),g.add(U),j.current=U,C.current=H,w.current=q,D.current=y,k.current=Z,M(pe)},[a,e,o,i,t,r]),b.useEffect(()=>{var S;const g=w.current;if(!g)return;(S=k.current)==null||S.dispose();const h=oe(p);k.current=h,g.uniforms.uLUT.value=h,V()},[p]),b.useEffect(()=>{const g=w.current;if(!g)return;const h=g.uniforms;h.uMode.value=s==="mip"?0:1,h.uSteps.value=l,h.uIsovalue.value=c,h.uClipMin.value.set(...u.min),h.uClipMax.value.set(...u.max),V()},[s,c,l,u]),b.useEffect(()=>()=>{var g,h,S,N;(g=C.current)==null||g.dispose(),(h=w.current)==null||h.dispose(),(S=D.current)==null||S.dispose(),(N=k.current)==null||N.dispose()},[]),n.jsx(Pe,{handle:d,className:f})}function A(a){return ze()?n.jsx(Ge,{...a}):n.jsx(Ue,{className:a.className})}function Y(a){return{mode:a.renderMode,isovalue:a.isovalue,colormap:a.colormap,steps:a.steps,clipMin:a.clipMin,clipMax:a.clipMax,background:a.background,showAxes:a.showAxes??!1,showPlanes:a.showPlanes??!1,cameraMode:a.cameraMode??"orbital"}}function X({item:a,view:e,sync:o,label:i,isDraggable:t,onDragStart:r,onFrame:s,colorRange:c}){if(!a)return n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"});const{arrays:p,meta:l}=a,[u,m]=c??[l.vmin,l.vmax];return n.jsxs("div",{className:"relative flex h-full w-full flex-col overflow-hidden rounded bg-bg",children:[n.jsx("div",{className:"flex flex-1 min-h-0 overflow-hidden",children:n.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:n.jsx(A,{data:p.data,shape:l.shape,spacing:l.spacing,origin:l.origin,vmin:u,vmax:m,mode:e.mode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clip:{min:e.clipMin,max:e.clipMax},background:e.background,showAxes:e.showAxes,showPlanes:e.showPlanes,cameraMode:e.cameraMode,sync:o,onFrame:s})})}),n.jsx("div",{className:"pointer-events-none absolute left-1 top-1 z-10 mono rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-subtle backdrop-blur-sm",children:`${l.shape.join("×")} · vmin ${l.vmin.toFixed(3)} · vmax ${l.vmax.toFixed(3)}`}),n.jsx(W,{label:i,isDraggable:t,onDragStart:r})]})}function We({item:a,reference:e,view:o,sync:i,label:t,isDraggable:r,onDragStart:s,colorRange:c}){const p=Ne(i);if(!e)return n.jsx(X,{item:a,view:o,sync:i,label:t,isDraggable:r,onDragStart:s,colorRange:c});const[l,u]=c??[e.meta.vmin,e.meta.vmax];return n.jsxs("div",{className:"flex h-full w-full gap-0.5",children:[n.jsxs("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg",children:[n.jsx(A,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:l,vmax:u,mode:o.mode,isovalue:o.isovalue,colormap:o.colormap,steps:o.steps,clip:{min:o.clipMin,max:o.clipMax},background:o.background,showAxes:o.showAxes,showPlanes:o.showPlanes,cameraMode:o.cameraMode,sync:p}),n.jsx(W,{label:"REF"})]}),n.jsx("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded bg-bg",children:a?n.jsx(X,{item:a,view:o,sync:p,label:t,isDraggable:r,onDragStart:s,colorRange:c}):n.jsx("div",{className:"flex h-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"})})]})}function Ye({data:a,reference:e,settings:o,cameraSyncGroupId:i,label:t,isDraggable:r,onDragStart:s,colorRange:c}){const p=i?{groupId:i}:null,l=Y(o);if(!a||!e)return n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"});if(!(a.meta.shape[0]===e.meta.shape[0]&&a.meta.shape[1]===e.meta.shape[1]&&a.meta.shape[2]===e.meta.shape[2]))return n.jsxs("div",{className:"flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted",children:["Shape mismatch: ",a.meta.shape.join("×")," vs ",e.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const m=o.diffColormap??"viridis",f=a.meta.shape[0]*a.meta.shape[1]*a.meta.shape[2],x=se(a.arrays.data,e.arrays.data,f),v=c??re(x,m),O=m==="viridis"?ke(x):x;return n.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[n.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:n.jsx(A,{data:O,shape:a.meta.shape,spacing:a.meta.spacing,origin:a.meta.origin,vmin:v[0],vmax:v[1],mode:l.mode,isovalue:l.isovalue,colormap:m,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,showAxes:l.showAxes,showPlanes:l.showPlanes,cameraMode:l.cameraMode,sync:p})}),n.jsx(W,{label:t,isDraggable:r,onDragStart:s})]})}function Ze(a,e){const o=a,i=e;return!o||!i?!1:o.meta.shape[0]===i.meta.shape[0]&&o.meta.shape[1]===i.meta.shape[1]&&o.meta.shape[2]===i.meta.shape[2]}function qe(a){const{items:e,referenceItems:o,settings:i,nativeMode:t}=a;if(t==="diff-value"){const c=i.diffColormap??"viridis",p=[];for(let u=0;u<e.length;u++){const m=e[u],f=o[u];if(!m||!f||m.meta.shape[0]!==f.meta.shape[0]||m.meta.shape[1]!==f.meta.shape[1]||m.meta.shape[2]!==f.meta.shape[2])continue;const x=m.meta.shape[0]*m.meta.shape[1]*m.meta.shape[2],v=se(m.arrays.data,f.arrays.data,x);p.push(re(v,c))}const l=Ve(p,c);return l?{colormap:c,min:l[0],max:l[1]}:null}let r=1/0,s=-1/0;for(const c of[...e,...o])c&&(r=Math.min(r,c.meta.vmin),s=Math.max(s,c.meta.vmax));return!Number.isFinite(r)||!Number.isFinite(s)?null:{colormap:i.colormap,min:r,max:s}}const He={coreModes:["normal","side","split","blend","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:Ze,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],hasSteps:!0,postProcessing:!1,overlays:!1,colorbar:"never",cameraSync:!0,resetView:"always",crossTypeCompare:!0,webglContextsPerPane:1,maxPanes:4,label:{placement:"bottom-left",draggable:!0},downloadExtension:".npz"},$e=ve(a=>be.artifactUrl(a));function G(a){return ge({queries:a.map(e=>({queryKey:["volume-npz",e],enabled:!!e,staleTime:1/0,queryFn:()=>xe(e,$e)}))})}function Qe(a){const{hashes:e,referenceHashes:o,metadata:i,referenceMetadata:t}=a,r=G(e),s=G(o);return b.useMemo(()=>{const c=e.map((u,m)=>{var v;if(!u)return null;const f=(v=r[m])==null?void 0:v.data,x=B(i==null?void 0:i[m]);return!f||!x?null:{arrays:{data:f},meta:x}}),p=o.map((u,m)=>{var v;if(!u)return null;const f=(v=s[m])==null?void 0:v.data,x=B(t==null?void 0:t[m]);return!f||!x?null:{arrays:{data:f},meta:x}}),l=r.some(u=>u.isLoading)||s.some(u=>u.isLoading);return{items:c,referenceItems:p,isLoading:l}},[e.join("|"),o.join("|"),(i??[]).join("|"),(t??[]).join("|"),r.map(c=>c.dataUpdatedAt).join("|"),s.map(c=>c.dataUpdatedAt).join("|")])}function da({hash:a,metadata:e,onFrame:o}){const[i]=G([a]),t=B(e),r=Re(),s=Y(le());return b.useEffect(()=>{r.dataUrl&&o({kind:"dataUrl",dataUrl:r.dataUrl})},[r.dataUrl]),!(i!=null&&i.data)||!t?null:n.jsx(A,{data:i.data,shape:t.shape,spacing:t.spacing,origin:t.origin,vmin:t.vmin,vmax:t.vmax,mode:s.mode,isovalue:s.isovalue,colormap:s.colormap,steps:s.steps,clip:{min:s.clipMin,max:s.clipMax},background:s.background,showAxes:s.showAxes,showPlanes:s.showPlanes,cameraMode:s.cameraMode,onFrame:r.onFrame})}function le(){return{renderMode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark",showAxes:!1,showPlanes:!1,cameraMode:"orbital",syncViews:!0,brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1,zoom:1,pan:{x:0,y:0},diffMode:"none"}}const Je=new Set(["normal","side","split","blend","diff"]),Ke=new Set(["mip","iso"]);function ea(a){const e=a;let o=a;if(typeof e.mode=="string"&&Ke.has(e.mode)&&(o={...o,renderMode:e.mode,mode:void 0}),o.mode==null&&o.nativeMode==null&&typeof e.compareMode=="string"){const i=e.compareMode;i==="diff-value"?o={...o,nativeMode:i}:Je.has(i)&&(o={...o,mode:i})}return o.diffMode==="none"&&typeof e.diffSubmode=="string"&&(o={...o,diffMode:e.diffSubmode}),o}function aa(a){const{data:e,reference:o,settings:i,mode:t,diffMode:r,cameraSyncGroupId:s,label:c,isBaseline:p,isDraggable:l,onDragStart:u,splitPosition:m,onSplitPositionChange:f,blendAlpha:x,crossTypeReferenceUrl:v,crossTypeAlignForDiff:O,colorRange:P}=a,I=s?{groupId:s}:null,d=Y(i),V=v!=null,M=o==null&&!V?"normal":t,z=(j,C)=>{const[w,D]=P??[e.meta.vmin,e.meta.vmax];return n.jsx(A,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:w,vmax:D,mode:d.mode,isovalue:d.isovalue,colormap:d.colormap,steps:d.steps,clip:{min:d.clipMin,max:d.clipMax},background:d.background,showAxes:d.showAxes,showPlanes:d.showPlanes,cameraMode:d.cameraMode,sync:C,onFrame:j})};return V&&M!=="normal"?e?n.jsx(ae,{mode:M,syncGroupId:s??null,primary:{kind:"live",render:z},reference:{kind:"frame",frameSource:{kind:"url",url:v}},diffSubmode:r,colormap:i.diffColormap??"viridis",splitPosition:m??.5,onSplitPositionChange:f??(()=>{}),blendAlpha:x??.5,primaryLabel:c,alignForDiff:O}):n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):M==="side"?n.jsx(We,{item:e,reference:o??null,view:d,sync:I,label:c,isDraggable:l,onDragStart:u,colorRange:P}):Fe(M)&&(M==="split"||M==="blend"||M==="diff")?!e||!o?n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):n.jsx(ae,{mode:M,syncGroupId:s??null,primary:{kind:"live",render:z},reference:{kind:"live",render:(j,C)=>{const[w,D]=P??[o.meta.vmin,o.meta.vmax];return n.jsx(A,{data:o.arrays.data,shape:o.meta.shape,spacing:o.meta.spacing,origin:o.meta.origin,vmin:w,vmax:D,mode:d.mode,isovalue:d.isovalue,colormap:d.colormap,steps:d.steps,clip:{min:d.clipMin,max:d.clipMax},background:d.background,showAxes:d.showAxes,showPlanes:d.showPlanes,cameraMode:d.cameraMode,sync:C,onFrame:j})}},diffSubmode:r,colormap:i.diffColormap??"viridis",splitPosition:m??.5,onSplitPositionChange:f??(()=>{}),blendAlpha:x??.5,primaryLabel:c}):n.jsx(X,{item:e,view:d,sync:I,label:c,isDraggable:l,onDragStart:u,colorRange:P})}const ta=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],oa=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],na=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],ia=[{value:"orbital",label:"Orbital"},{value:"turntable",label:"Turntable"}],sa=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function ra({settings:a,update:e}){const o=(t,r)=>{const s=[...a.clipMin];s[t]=Math.min(r,a.clipMax[t]),e({clipMin:s})},i=(t,r)=>{const s=[...a.clipMax];s[t]=Math.max(r,a.clipMin[t]),e({clipMax:s})};return n.jsxs(n.Fragment,{children:[n.jsx(R,{label:"Render mode",value:a.renderMode,onChange:t=>e({renderMode:t}),options:ta}),a.renderMode==="iso"&&n.jsx(T,{label:"Isovalue",value:a.isovalue,onChange:t=>e({isovalue:t}),min:0,max:1,step:.01,format:t=>t.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),n.jsx(R,{label:"Colormap",value:a.colormap,onChange:t=>e({colormap:t}),options:oa}),n.jsx(R,{label:"Quality",value:String(a.steps),onChange:t=>e({steps:Number(t)}),options:na,description:"Raymarch step count — higher is finer but slower"}),n.jsx(R,{label:"Background",value:a.background,onChange:t=>e({background:t}),options:sa}),n.jsx(ee,{label:"Show axes",checked:!!a.showAxes,onChange:t=>e({showAxes:t}),description:"Colored XYZ origin lines + grid, sized to the fitted view"}),n.jsx(ee,{label:"Show planes",checked:!!a.showPlanes,onChange:t=>e({showPlanes:t}),description:"Faint XY/YZ/XZ reference planes through the origin"}),n.jsx(R,{label:"Orientation",value:a.cameraMode??"orbital",onChange:t=>e({cameraMode:t}),options:ia,description:"Turntable locks world-up and spins about it; orbital is free orbit"}),n.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[n.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),n.jsx(T,{label:"Clip X min",value:a.clipMin[0],onChange:t=>o(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(T,{label:"Clip X max",value:a.clipMax[0],onChange:t=>i(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(T,{label:"Clip Y min",value:a.clipMin[1],onChange:t=>o(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(T,{label:"Clip Y max",value:a.clipMax[1],onChange:t=>i(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(T,{label:"Clip Z min",value:a.clipMin[2],onChange:t=>o(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(T,{label:"Clip Z max",value:a.clipMax[2],onChange:t=>i(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)})]})]})}const ne={kind:"camera3d",position:[0,0,5],target:[0,0,0],zoom:1},la={objectType:"volume",capabilities:He,useData:Qe,defaultSettings:le,migrateSettings:ea,viewFromSettings:()=>ne,viewToSettingsPatch:()=>({}),defaultView:()=>ne,onResetView:a=>Ee(a),Pane:aa,SettingsControls:ra,nativeDiff:{render:Ye},activeColorbar:qe};function pa(a){return n.jsx(he,{...a,viewport:la})}export{da as VolumeForeignFrame,pa as default,la as volumeViewportModule};

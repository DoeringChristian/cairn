import{w as n,r as y,a5 as ue,a0 as U,a1 as ce,x as P,J as j,a2 as me,i as Z,d as de,e as fe,a3 as pe}from"./index-Bl05AfnN.js";import{u as ve,l as xe,R as he,U as ee,m as A,C as z,V as L,n as ge,o as be,G as ye,p as Me,j as Ce,q as Se,s as De,d as ae,e as te,f as je,t as we,h as Te,r as Ve,O as Re}from"./diff-C4RTwnis.js";const Ne={dark:856343,light:16185594},Q=256;let E=null;function Oe(){if(E!==null)return E;try{const e=document.createElement("canvas").getContext("webgl2");if(e){const i=e.getExtension("WEBGL_lose_context");i==null||i.loseContext()}E=!!e}catch{E=!1}return E}function Pe({className:a}){return n.jsx("div",{className:a??"relative h-full w-full",children:n.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[n.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),n.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function Ee(a,e,i){const o=i-e||1,t=new Uint8Array(a.length);for(let l=0;l<a.length;l++){const s=(a[l]-e)/o;t[l]=Math.max(0,Math.min(255,Math.round(s*255)))}return t}function $(a){const e=ue(a),i=new Uint8Array(256*4);for(let t=0;t<256;t++)i[t*4]=e[t*3],i[t*4+1]=e[t*3+1],i[t*4+2]=e[t*3+2],i[t*4+3]=255;const o=new Se(i,256,1,De,ee);return o.minFilter=A,o.magFilter=A,o.wrapS=z,o.wrapT=z,o.needsUpdate=!0,o}const ze=`precision highp float;

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
uniform float uSteps;       // <= ${Q}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${Q};
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
`;function Ie(a,e,i){const[o,t,l]=a,s=l*e[2],r=t*e[1],d=o*e[0],u=i[2],c=i[1],m=i[0];return{scale:[s,r,d],position:[u+s/2,c+r/2,m+d/2],bounds:{min:[u,c,m],max:[u+s,c+r,m+d]}}}function Ae({data:a,shape:e,spacing:i,origin:o,vmin:t,vmax:l,mode:s,isovalue:r,colormap:d,steps:u,clip:c,background:m,className:p,sync:x=null,onFrame:v}){const{containerRef:w,canvasRef:f,requestRender:M,fitToBounds:T,refs:V}=ve({background:Ne[m],sync:x,onFrame:v}),S=y.useRef(null),D=y.useRef(null),R=y.useRef(null),F=y.useRef(null),N=y.useRef(null);return y.useEffect(()=>{var W,q,H,Y;const g=V.scene.current;if(!g)return;S.current&&(g.remove(S.current),(W=D.current)==null||W.dispose(),(q=R.current)==null||q.dispose(),(H=F.current)==null||H.dispose(),(Y=N.current)==null||Y.dispose());const[h,C,O]=e,ne=Ee(a,t,l),b=new xe(ne,O,C,h);b.format=he,b.type=ee,b.minFilter=A,b.magFilter=A,b.wrapR=z,b.wrapS=z,b.wrapT=z,b.needsUpdate=!0;const B=$(d),oe={uData:{value:b},uLUT:{value:B},uMode:{value:s==="mip"?0:1},uSteps:{value:u},uIsovalue:{value:r},uClipMin:{value:new L(...c.min)},uClipMax:{value:new L(...c.max)},uTexelSize:{value:new L(1/O,1/C,1/h)}},G=new ge({glslVersion:ye,vertexShader:ze,fragmentShader:ke,uniforms:oe,side:be,transparent:!1}),X=new Me(1,1,1),I=new Ce(X,G),{scale:se,position:re,bounds:le}=Ie(e,i,o);I.scale.set(...se),I.position.set(...re),g.add(I),S.current=I,D.current=X,R.current=G,F.current=b,N.current=B,T(le)},[a,e,i,o,t,l]),y.useEffect(()=>{var C;const g=R.current;if(!g)return;(C=N.current)==null||C.dispose();const h=$(d);N.current=h,g.uniforms.uLUT.value=h,M()},[d]),y.useEffect(()=>{const g=R.current;if(!g)return;const h=g.uniforms;h.uMode.value=s==="mip"?0:1,h.uSteps.value=u,h.uIsovalue.value=r,h.uClipMin.value.set(...c.min),h.uClipMax.value.set(...c.max),M()},[s,r,u,c]),y.useEffect(()=>()=>{var g,h,C,O;(g=D.current)==null||g.dispose(),(h=R.current)==null||h.dispose(),(C=F.current)==null||C.dispose(),(O=N.current)==null||O.dispose()},[]),n.jsx("div",{ref:w,className:p??"relative h-full w-full",children:n.jsx("canvas",{ref:f,className:"block h-full w-full rounded"})})}function k(a){return Oe()?n.jsx(Ae,{...a}):n.jsx(Pe,{className:a.className})}function ie(a){return{mode:a.renderMode,isovalue:a.isovalue,colormap:a.colormap,steps:a.steps,clipMin:a.clipMin,clipMax:a.clipMax,background:a.background}}function _({item:a,view:e,sync:i,label:o,isDraggable:t,onDragStart:l,onFrame:s,colorRange:r}){if(!a)return n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"});const{arrays:d,meta:u}=a,[c,m]=r??[u.vmin,u.vmax];return n.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[n.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:n.jsx(k,{data:d.data,shape:u.shape,spacing:u.spacing,origin:u.origin,vmin:c,vmax:m,mode:e.mode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clip:{min:e.clipMin,max:e.clipMax},background:e.background,sync:i,onFrame:s})}),n.jsx(U,{label:o,isDraggable:t,onDragStart:l})]})}function Fe({item:a,reference:e,view:i,sync:o,label:t,isDraggable:l,onDragStart:s,colorRange:r}){const d=Te(o);if(!e)return n.jsx(_,{item:a,view:i,sync:o,label:t,isDraggable:l,onDragStart:s,colorRange:r});const[u,c]=r??[e.meta.vmin,e.meta.vmax];return n.jsxs("div",{className:"flex h-full w-full gap-0.5",children:[n.jsxs("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg",children:[n.jsx(k,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:u,vmax:c,mode:i.mode,isovalue:i.isovalue,colormap:i.colormap,steps:i.steps,clip:{min:i.clipMin,max:i.clipMax},background:i.background,sync:d}),n.jsx(U,{label:"REF"})]}),n.jsx("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded bg-bg",children:a?n.jsx(_,{item:a,view:i,sync:d,label:t,isDraggable:l,onDragStart:s,colorRange:r}):n.jsx("div",{className:"flex h-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"})})]})}function Le({data:a,reference:e,settings:i,cameraSyncGroupId:o,label:t,isDraggable:l,onDragStart:s,colorRange:r}){const d=o?{groupId:o}:null,u=ie(i);if(!a||!e)return n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"});if(!(a.meta.shape[0]===e.meta.shape[0]&&a.meta.shape[1]===e.meta.shape[1]&&a.meta.shape[2]===e.meta.shape[2]))return n.jsxs("div",{className:"flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted",children:["Shape mismatch: ",a.meta.shape.join("×")," vs ",e.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const m=i.diffColormap??"viridis",p=a.meta.shape[0]*a.meta.shape[1]*a.meta.shape[2],x=ae(a.arrays.data,e.arrays.data,p),v=r??te(x,m),w=m==="viridis"?we(x):x;return n.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[n.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:n.jsx(k,{data:w,shape:a.meta.shape,spacing:a.meta.spacing,origin:a.meta.origin,vmin:v[0],vmax:v[1],mode:u.mode,isovalue:u.isovalue,colormap:m,steps:u.steps,clip:{min:u.clipMin,max:u.clipMax},background:u.background,sync:d})}),n.jsx(U,{label:t,isDraggable:l,onDragStart:s})]})}function _e(a,e){const i=a,o=e;return!i||!o?!1:i.meta.shape[0]===o.meta.shape[0]&&i.meta.shape[1]===o.meta.shape[1]&&i.meta.shape[2]===o.meta.shape[2]}function Ue(a){const{items:e,referenceItems:i,settings:o,nativeMode:t}=a;if(t==="diff-value"){const r=o.diffColormap??"viridis",d=[];for(let c=0;c<e.length;c++){const m=e[c],p=i[c];if(!m||!p||m.meta.shape[0]!==p.meta.shape[0]||m.meta.shape[1]!==p.meta.shape[1]||m.meta.shape[2]!==p.meta.shape[2])continue;const x=m.meta.shape[0]*m.meta.shape[1]*m.meta.shape[2],v=ae(m.arrays.data,p.arrays.data,x);d.push(te(v,r))}const u=je(d,r);return u?{colormap:r,min:u[0],max:u[1]}:null}let l=1/0,s=-1/0;for(const r of[...e,...i])r&&(l=Math.min(l,r.meta.vmin),s=Math.max(s,r.meta.vmax));return!Number.isFinite(l)||!Number.isFinite(s)?null:{colormap:o.colormap,min:l,max:s}}const Be={coreModes:["normal","side","split","blend","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:_e,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],hasSteps:!0,postProcessing:!1,overlays:!1,colorbar:"never",cameraSync:!0,resetView:"always",crossTypeCompare:!1,webglContextsPerPane:1,maxPanes:4,label:{placement:"bottom-left",draggable:!0},downloadExtension:".npz"};async function Ge(a){const e=await fetch(fe.artifactUrl(a));if(!e.ok)throw new Error(`failed to fetch volume (${e.status})`);const i=await pe(await e.arrayBuffer());if(!i.data)throw new Error("volume artifact is missing its 'data' array");return Float32Array.from(i.data.data)}function J(a){return de({queries:a.map(e=>({queryKey:["volume-npz",e],enabled:!!e,staleTime:1/0,queryFn:()=>Ge(e)}))})}function Xe(a){const{hashes:e,referenceHashes:i,metadata:o,referenceMetadata:t}=a,l=J(e),s=J(i);return y.useMemo(()=>{const r=e.map((c,m)=>{var v;if(!c)return null;const p=(v=l[m])==null?void 0:v.data,x=Z(o==null?void 0:o[m]);return!p||!x?null:{arrays:{data:p},meta:x}}),d=i.map((c,m)=>{var v;if(!c)return null;const p=(v=s[m])==null?void 0:v.data,x=Z(t==null?void 0:t[m]);return!p||!x?null:{arrays:{data:p},meta:x}}),u=l.some(c=>c.isLoading)||s.some(c=>c.isLoading);return{items:r,referenceItems:d,isLoading:u}},[e.join("|"),i.join("|"),(o??[]).join("|"),(t??[]).join("|"),l.map(r=>r.dataUpdatedAt).join("|"),s.map(r=>r.dataUpdatedAt).join("|")])}function We(){return{renderMode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark",syncViews:!0,brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1,zoom:1,pan:{x:0,y:0},diffMode:"none"}}const qe=new Set(["normal","side","split","blend","diff"]),He=new Set(["mip","iso"]);function Ye(a){const e=a;let i=a;if(typeof e.mode=="string"&&He.has(e.mode)&&(i={...i,renderMode:e.mode,mode:void 0}),i.mode==null&&i.nativeMode==null&&typeof e.compareMode=="string"){const o=e.compareMode;o==="diff-value"?i={...i,nativeMode:o}:qe.has(o)&&(i={...i,mode:o})}return i.diffMode==="none"&&typeof e.diffSubmode=="string"&&(i={...i,diffMode:e.diffSubmode}),i}function Ze(a){const{data:e,reference:i,settings:o,mode:t,diffMode:l,cameraSyncGroupId:s,label:r,isBaseline:d,isDraggable:u,onDragStart:c,splitPosition:m,onSplitPositionChange:p,blendAlpha:x,colorRange:v}=a,w=s?{groupId:s}:null,f=ie(o),M=i==null?"normal":t;return M==="side"?n.jsx(Fe,{item:e,reference:i??null,view:f,sync:w,label:r,isDraggable:u,onDragStart:c,colorRange:v}):me(M)&&(M==="split"||M==="blend"||M==="diff")?!e||!i?n.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):n.jsx(Re,{mode:M,renderPrimary:(T,V)=>{const[S,D]=v??[e.meta.vmin,e.meta.vmax];return n.jsx(k,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:S,vmax:D,mode:f.mode,isovalue:f.isovalue,colormap:f.colormap,steps:f.steps,clip:{min:f.clipMin,max:f.clipMax},background:f.background,sync:V,onFrame:T})},renderReference:(T,V)=>{const[S,D]=v??[i.meta.vmin,i.meta.vmax];return n.jsx(k,{data:i.arrays.data,shape:i.meta.shape,spacing:i.meta.spacing,origin:i.meta.origin,vmin:S,vmax:D,mode:f.mode,isovalue:f.isovalue,colormap:f.colormap,steps:f.steps,clip:{min:f.clipMin,max:f.clipMax},background:f.background,sync:V,onFrame:T})},diffSubmode:l,colormap:o.diffColormap??"viridis",splitPosition:m??.5,onSplitPositionChange:p??(()=>{}),blendAlpha:x??.5,primaryLabel:r}):n.jsx(_,{item:e,view:f,sync:w,label:r,isDraggable:u,onDragStart:c,colorRange:v})}const Qe=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],$e=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],Je=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],Ke=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function ea({settings:a,update:e}){const i=(t,l)=>{const s=[...a.clipMin];s[t]=Math.min(l,a.clipMax[t]),e({clipMin:s})},o=(t,l)=>{const s=[...a.clipMax];s[t]=Math.max(l,a.clipMin[t]),e({clipMax:s})};return n.jsxs(n.Fragment,{children:[n.jsx(P,{label:"Render mode",value:a.renderMode,onChange:t=>e({renderMode:t}),options:Qe}),a.renderMode==="iso"&&n.jsx(j,{label:"Isovalue",value:a.isovalue,onChange:t=>e({isovalue:t}),min:0,max:1,step:.01,format:t=>t.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),n.jsx(P,{label:"Colormap",value:a.colormap,onChange:t=>e({colormap:t}),options:$e}),n.jsx(P,{label:"Quality",value:String(a.steps),onChange:t=>e({steps:Number(t)}),options:Je,description:"Raymarch step count — higher is finer but slower"}),n.jsx(P,{label:"Background",value:a.background,onChange:t=>e({background:t}),options:Ke}),n.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[n.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),n.jsx(j,{label:"Clip X min",value:a.clipMin[0],onChange:t=>i(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(j,{label:"Clip X max",value:a.clipMax[0],onChange:t=>o(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(j,{label:"Clip Y min",value:a.clipMin[1],onChange:t=>i(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(j,{label:"Clip Y max",value:a.clipMax[1],onChange:t=>o(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(j,{label:"Clip Z min",value:a.clipMin[2],onChange:t=>i(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),n.jsx(j,{label:"Clip Z max",value:a.clipMax[2],onChange:t=>o(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)})]}),n.jsx(P,{label:"Diff colormap",value:a.diffColormap??"viridis",onChange:t=>e({diffColormap:t}),options:[{value:"viridis",label:"Viridis (magnitude)"},{value:"red-green",label:"Red – Green (signed)"}],description:"Color mapping for the native diff mode (diff-value)"})]})}const K={kind:"camera3d",position:[0,0,5],target:[0,0,0],zoom:1},aa={objectType:"volume",capabilities:Be,useData:Xe,defaultSettings:We,migrateSettings:Ye,viewFromSettings:()=>K,viewToSettingsPatch:()=>({}),defaultView:()=>K,onResetView:a=>Ve(a),Pane:Ze,SettingsControls:ea,nativeDiff:{render:Le},activeColorbar:Ue};function na(a){return n.jsx(ce,{...a,viewport:aa})}export{na as default,aa as volumeViewportModule};

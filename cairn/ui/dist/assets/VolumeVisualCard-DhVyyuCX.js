import{w as o,r as M,a6 as ue,a0 as ae,a1 as _,a2 as ce,x as V,J as S,a3 as me,i as Z,d as de,e as fe,a4 as pe}from"./index-D5NXEsd6.js";import{u as ve,i as xe,R as he,U as te,j as A,C as P,V as I,k as ge,l as be,G as ye,m as Me,g as Ce,n as je,o as De,d as Se,p as we,q as Te,r as Re,O as Q}from"./diff-BUPI0yXZ.js";const Ve={dark:856343,light:16185594},$=256;let O=null;function Oe(){if(O!==null)return O;try{const e=document.createElement("canvas").getContext("webgl2");if(e){const i=e.getExtension("WEBGL_lose_context");i==null||i.loseContext()}O=!!e}catch{O=!1}return O}function Pe({className:a}){return o.jsx("div",{className:a??"relative h-full w-full",children:o.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[o.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),o.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function ke(a,e,i){const n=i-e||1,t=new Uint8Array(a.length);for(let s=0;s<a.length;s++){const r=(a[s]-e)/n;t[s]=Math.max(0,Math.min(255,Math.round(r*255)))}return t}function J(a){const e=ue(a),i=new Uint8Array(256*4);for(let t=0;t<256;t++)i[t*4]=e[t*3],i[t*4+1]=e[t*3+1],i[t*4+2]=e[t*3+2],i[t*4+3]=255;const n=new je(i,256,1,De,te);return n.minFilter=A,n.magFilter=A,n.wrapS=P,n.wrapT=P,n.needsUpdate=!0,n}const Ne=`precision highp float;

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
`,Ee=`precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${$}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${$};
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
`;function ze(a,e,i){const[n,t,s]=a,r=s*e[2],c=t*e[1],l=n*e[0],x=i[2],u=i[1],d=i[0];return{scale:[r,c,l],position:[x+r/2,u+c/2,d+l/2],bounds:{min:[x,u,d],max:[x+r,u+c,d+l]}}}function Ae({data:a,shape:e,spacing:i,origin:n,vmin:t,vmax:s,mode:r,isovalue:c,colormap:l,steps:x,clip:u,background:d,className:p,sync:f=null,onFrame:h}){const{containerRef:L,canvasRef:N,requestRender:m,fitToBounds:E,refs:b}=ve({background:Ve[d],sync:f,onFrame:h}),w=M.useRef(null),D=M.useRef(null),C=M.useRef(null),F=M.useRef(null),T=M.useRef(null);return M.useEffect(()=>{var W,q,H,Y;const g=b.scene.current;if(!g)return;w.current&&(g.remove(w.current),(W=D.current)==null||W.dispose(),(q=C.current)==null||q.dispose(),(H=F.current)==null||H.dispose(),(Y=T.current)==null||Y.dispose());const[v,j,R]=e,oe=ke(a,t,s),y=new xe(oe,R,j,v);y.format=he,y.type=te,y.minFilter=A,y.magFilter=A,y.wrapR=P,y.wrapS=P,y.wrapT=P,y.needsUpdate=!0;const B=J(l),ne={uData:{value:y},uLUT:{value:B},uMode:{value:r==="mip"?0:1},uSteps:{value:x},uIsovalue:{value:c},uClipMin:{value:new I(...u.min)},uClipMax:{value:new I(...u.max)},uTexelSize:{value:new I(1/R,1/j,1/v)}},G=new ge({glslVersion:ye,vertexShader:Ne,fragmentShader:Ee,uniforms:ne,side:be,transparent:!1}),X=new Me(1,1,1),z=new Ce(X,G),{scale:re,position:se,bounds:le}=ze(e,i,n);z.scale.set(...re),z.position.set(...se),g.add(z),w.current=z,D.current=X,C.current=G,F.current=y,T.current=B,E(le)},[a,e,i,n,t,s]),M.useEffect(()=>{var j;const g=C.current;if(!g)return;(j=T.current)==null||j.dispose();const v=J(l);T.current=v,g.uniforms.uLUT.value=v,m()},[l]),M.useEffect(()=>{const g=C.current;if(!g)return;const v=g.uniforms;v.uMode.value=r==="mip"?0:1,v.uSteps.value=x,v.uIsovalue.value=c,v.uClipMin.value.set(...u.min),v.uClipMax.value.set(...u.max),m()},[r,c,x,u]),M.useEffect(()=>()=>{var g,v,j,R;(g=D.current)==null||g.dispose(),(v=C.current)==null||v.dispose(),(j=F.current)==null||j.dispose(),(R=T.current)==null||R.dispose()},[]),o.jsx("div",{ref:L,className:p??"relative h-full w-full",children:o.jsx("canvas",{ref:N,className:"block h-full w-full rounded"})})}function k(a){return Oe()?o.jsx(Ae,{...a}):o.jsx(Pe,{className:a.className})}function ie(a){return{mode:a.renderMode,isovalue:a.isovalue,colormap:a.colormap,steps:a.steps,clipMin:a.clipMin,clipMax:a.clipMax,background:a.background}}function U({item:a,view:e,sync:i,label:n,isDraggable:t,onDragStart:s,onFrame:r}){if(!a)return o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"});const{arrays:c,meta:l}=a;return o.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[o.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:o.jsx(k,{data:c.data,shape:l.shape,spacing:l.spacing,origin:l.origin,vmin:l.vmin,vmax:l.vmax,mode:e.mode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clip:{min:e.clipMin,max:e.clipMax},background:e.background,sync:i,onFrame:r})}),o.jsx(ae,{colormap:e.colormap,min:l.vmin,max:l.vmax}),o.jsx(_,{label:n,isDraggable:t,onDragStart:s})]})}function Le({item:a,reference:e,view:i,sync:n,label:t,isDraggable:s,onDragStart:r}){return e?o.jsxs("div",{className:"flex h-full w-full gap-0.5",children:[o.jsxs("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg",children:[o.jsx(k,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:e.meta.vmin,vmax:e.meta.vmax,mode:i.mode,isovalue:i.isovalue,colormap:i.colormap,steps:i.steps,clip:{min:i.clipMin,max:i.clipMax},background:i.background,sync:n}),o.jsx(_,{label:"REF"})]}),o.jsx("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded bg-bg",children:a?o.jsx(U,{item:a,view:i,sync:n,label:t,isDraggable:s,onDragStart:r}):o.jsx("div",{className:"flex h-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"})})]}):o.jsx(U,{item:a,view:i,sync:n,label:t,isDraggable:s,onDragStart:r})}function Fe({data:a,reference:e,settings:i,cameraSyncGroupId:n,label:t,isDraggable:s,onDragStart:r}){const c=n?{groupId:n}:null,l=ie(i);if(!a||!e)return o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"});if(!(a.meta.shape[0]===e.meta.shape[0]&&a.meta.shape[1]===e.meta.shape[1]&&a.meta.shape[2]===e.meta.shape[2]))return o.jsxs("div",{className:"flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted",children:["Shape mismatch: ",a.meta.shape.join("×")," vs ",e.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const u=i.diffColormap??"viridis",d=a.meta.shape[0]*a.meta.shape[1]*a.meta.shape[2],p=Se(a.arrays.data,e.arrays.data,d),f=we(p,u),h=u==="viridis"?Te(p):p;return o.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[o.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:o.jsx(k,{data:h,shape:a.meta.shape,spacing:a.meta.spacing,origin:a.meta.origin,vmin:f[0],vmax:f[1],mode:l.mode,isovalue:l.isovalue,colormap:u,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,sync:c})}),o.jsx(ae,{colormap:u,min:f[0],max:f[1]}),o.jsx(_,{label:t,isDraggable:s,onDragStart:r})]})}function Ie(a,e){const i=a,n=e;return!i||!n?!1:i.meta.shape[0]===n.meta.shape[0]&&i.meta.shape[1]===n.meta.shape[1]&&i.meta.shape[2]===n.meta.shape[2]}const Ue={coreModes:["normal","side","split","blend","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:Ie,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],hasSteps:!0,postProcessing:!1,overlays:!1,colorbar:"always",cameraSync:!0,resetView:"always",crossTypeCompare:!1,webglContextsPerPane:1,maxPanes:4,label:{placement:"bottom-left",draggable:!0},downloadExtension:".npz"};async function _e(a){const e=await fetch(fe.artifactUrl(a));if(!e.ok)throw new Error(`failed to fetch volume (${e.status})`);const i=await pe(await e.arrayBuffer());if(!i.data)throw new Error("volume artifact is missing its 'data' array");return Float32Array.from(i.data.data)}function K(a){return de({queries:a.map(e=>({queryKey:["volume-npz",e],enabled:!!e,staleTime:1/0,queryFn:()=>_e(e)}))})}function Be(a){const{hashes:e,referenceHashes:i,metadata:n,referenceMetadata:t}=a,s=K(e),r=K(i);return M.useMemo(()=>{const c=e.map((u,d)=>{var h;if(!u)return null;const p=(h=s[d])==null?void 0:h.data,f=Z(n==null?void 0:n[d]);return!p||!f?null:{arrays:{data:p},meta:f}}),l=i.map((u,d)=>{var h;if(!u)return null;const p=(h=r[d])==null?void 0:h.data,f=Z(t==null?void 0:t[d]);return!p||!f?null:{arrays:{data:p},meta:f}}),x=s.some(u=>u.isLoading)||r.some(u=>u.isLoading);return{items:c,referenceItems:l,isLoading:x}},[e.join("|"),i.join("|"),(n??[]).join("|"),(t??[]).join("|"),s.map(c=>c.dataUpdatedAt).join("|"),r.map(c=>c.dataUpdatedAt).join("|")])}function Ge(){return{renderMode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark",brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1,zoom:1,pan:{x:0,y:0},diffMode:"none"}}const Xe=new Set(["normal","side","split","blend","diff"]),We=new Set(["mip","iso"]);function qe(a){const e=a;let i=a;if(typeof e.mode=="string"&&We.has(e.mode)&&(i={...i,renderMode:e.mode,mode:void 0}),i.mode==null&&i.nativeMode==null&&typeof e.compareMode=="string"){const n=e.compareMode;n==="diff-value"?i={...i,nativeMode:n}:Xe.has(n)&&(i={...i,mode:n})}return i.diffMode==="none"&&typeof e.diffSubmode=="string"&&(i={...i,diffMode:e.diffSubmode}),i}function He(a){const{data:e,reference:i,settings:n,mode:t,diffMode:s,cameraSyncGroupId:r,label:c,isBaseline:l,isDraggable:x,onDragStart:u,splitPosition:d,onSplitPositionChange:p,blendAlpha:f,crossTypeReferenceUrl:h,crossTypeAlignForDiff:L}=a,N=r?{groupId:r}:null,m=ie(n),E=h!=null,b=i==null&&!E?"normal":t,w=(D,C)=>o.jsx(k,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:e.meta.vmin,vmax:e.meta.vmax,mode:m.mode,isovalue:m.isovalue,colormap:m.colormap,steps:m.steps,clip:{min:m.clipMin,max:m.clipMax},background:m.background,sync:C,onFrame:D});return E&&b!=="normal"?e?o.jsx(Q,{mode:b,primary:{kind:"live",render:w},reference:{kind:"frame",frameSource:{kind:"url",url:h}},diffSubmode:s,colormap:n.diffColormap??"viridis",splitPosition:d??.5,onSplitPositionChange:p??(()=>{}),blendAlpha:f??.5,primaryLabel:c,alignForDiff:L}):o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):b==="side"?o.jsx(Le,{item:e,reference:i??null,view:m,sync:N,label:c,isDraggable:x,onDragStart:u}):me(b)&&(b==="split"||b==="blend"||b==="diff")?!e||!i?o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):o.jsx(Q,{mode:b,primary:{kind:"live",render:w},reference:{kind:"live",render:(D,C)=>o.jsx(k,{data:i.arrays.data,shape:i.meta.shape,spacing:i.meta.spacing,origin:i.meta.origin,vmin:i.meta.vmin,vmax:i.meta.vmax,mode:m.mode,isovalue:m.isovalue,colormap:m.colormap,steps:m.steps,clip:{min:m.clipMin,max:m.clipMax},background:m.background,sync:C,onFrame:D})},diffSubmode:s,colormap:n.diffColormap??"viridis",splitPosition:d??.5,onSplitPositionChange:p??(()=>{}),blendAlpha:f??.5,primaryLabel:c}):o.jsx(U,{item:e,view:m,sync:N,label:c,isDraggable:x,onDragStart:u})}const Ye=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],Ze=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],Qe=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],$e=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function Je({settings:a,update:e}){const i=(t,s)=>{const r=[...a.clipMin];r[t]=Math.min(s,a.clipMax[t]),e({clipMin:r})},n=(t,s)=>{const r=[...a.clipMax];r[t]=Math.max(s,a.clipMin[t]),e({clipMax:r})};return o.jsxs(o.Fragment,{children:[o.jsx(V,{label:"Render mode",value:a.renderMode,onChange:t=>e({renderMode:t}),options:Ye}),a.renderMode==="iso"&&o.jsx(S,{label:"Isovalue",value:a.isovalue,onChange:t=>e({isovalue:t}),min:0,max:1,step:.01,format:t=>t.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),o.jsx(V,{label:"Colormap",value:a.colormap,onChange:t=>e({colormap:t}),options:Ze}),o.jsx(V,{label:"Quality",value:String(a.steps),onChange:t=>e({steps:Number(t)}),options:Qe,description:"Raymarch step count — higher is finer but slower"}),o.jsx(V,{label:"Background",value:a.background,onChange:t=>e({background:t}),options:$e}),o.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[o.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),o.jsx(S,{label:"Clip X min",value:a.clipMin[0],onChange:t=>i(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(S,{label:"Clip X max",value:a.clipMax[0],onChange:t=>n(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(S,{label:"Clip Y min",value:a.clipMin[1],onChange:t=>i(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(S,{label:"Clip Y max",value:a.clipMax[1],onChange:t=>n(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(S,{label:"Clip Z min",value:a.clipMin[2],onChange:t=>i(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(S,{label:"Clip Z max",value:a.clipMax[2],onChange:t=>n(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)})]}),o.jsx(V,{label:"Diff colormap",value:a.diffColormap??"viridis",onChange:t=>e({diffColormap:t}),options:[{value:"viridis",label:"Viridis (magnitude)"},{value:"red-green",label:"Red – Green (signed)"}],description:"Color mapping for the native diff mode (diff-value)"})]})}const ee={kind:"camera3d",position:[0,0,5],target:[0,0,0],zoom:1},Ke={objectType:"volume",capabilities:Ue,useData:Be,defaultSettings:Ge,migrateSettings:qe,viewFromSettings:()=>ee,viewToSettingsPatch:()=>({}),defaultView:()=>ee,onResetView:a=>Re(a),Pane:He,SettingsControls:Je,nativeDiff:{render:Fe}};function ta(a){return o.jsx(ce,{...a,viewport:Ke})}export{ta as default,Ke as volumeViewportModule};

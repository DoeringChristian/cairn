import{w as o,r as b,a6 as ce,a0 as te,a1 as G,a2 as me,i as I,x as k,J as D,a3 as de,d as fe,e as pe,a4 as ve}from"./index-CCyHq-Nm.js";import{u as xe,j as he,R as ge,U as ie,k as F,C as P,V as L,l as be,m as ye,G as Me,n as je,h as Ce,o as Se,p as De,d as we,q as Te,s as Re,f as Ve,r as ke,O as J}from"./diff-CVgG-KZm.js";const Oe={dark:856343,light:16185594},K=256;let O=null;function Pe(){if(O!==null)return O;try{const e=document.createElement("canvas").getContext("webgl2");if(e){const i=e.getExtension("WEBGL_lose_context");i==null||i.loseContext()}O=!!e}catch{O=!1}return O}function Ee({className:t}){return o.jsx("div",{className:t??"relative h-full w-full",children:o.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[o.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),o.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function Ne(t,e,i){const n=i-e||1,a=new Uint8Array(t.length);for(let s=0;s<t.length;s++){const r=(t[s]-e)/n;a[s]=Math.max(0,Math.min(255,Math.round(r*255)))}return a}function ee(t){const e=ce(t),i=new Uint8Array(256*4);for(let a=0;a<256;a++)i[a*4]=e[a*3],i[a*4+1]=e[a*3+1],i[a*4+2]=e[a*3+2],i[a*4+3]=255;const n=new Se(i,256,1,De,ie);return n.minFilter=F,n.magFilter=F,n.wrapS=P,n.wrapT=P,n.needsUpdate=!0,n}const ze=`precision highp float;

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
`,Fe=`precision highp float;
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
`;function Ue(t,e,i){const[n,a,s]=t,r=s*e[2],c=a*e[1],l=n*e[0],x=i[2],u=i[1],d=i[0];return{scale:[r,c,l],position:[x+r/2,u+c/2,d+l/2],bounds:{min:[x,u,d],max:[x+r,u+c,d+l]}}}function Ae({data:t,shape:e,spacing:i,origin:n,vmin:a,vmax:s,mode:r,isovalue:c,colormap:l,steps:x,clip:u,background:d,className:p,sync:f=null,onFrame:h}){const{containerRef:U,canvasRef:E,requestRender:m,fitToBounds:N,refs:y}=xe({background:Oe[d],sync:f,onFrame:h}),w=b.useRef(null),S=b.useRef(null),j=b.useRef(null),A=b.useRef(null),R=b.useRef(null);return b.useEffect(()=>{var Y,Z,Q,$;const g=y.scene.current;if(!g)return;w.current&&(g.remove(w.current),(Y=S.current)==null||Y.dispose(),(Z=j.current)==null||Z.dispose(),(Q=A.current)==null||Q.dispose(),($=R.current)==null||$.dispose());const[v,C,V]=e,ne=Ne(t,a,s),M=new he(ne,V,C,v);M.format=ge,M.type=ie,M.minFilter=F,M.magFilter=F,M.wrapR=P,M.wrapS=P,M.wrapT=P,M.needsUpdate=!0;const W=ee(l),re={uData:{value:M},uLUT:{value:W},uMode:{value:r==="mip"?0:1},uSteps:{value:x},uIsovalue:{value:c},uClipMin:{value:new L(...u.min)},uClipMax:{value:new L(...u.max)},uTexelSize:{value:new L(1/V,1/C,1/v)}},q=new be({glslVersion:Me,vertexShader:ze,fragmentShader:Fe,uniforms:re,side:ye,transparent:!1}),H=new je(1,1,1),z=new Ce(H,q),{scale:se,position:le,bounds:ue}=Ue(e,i,n);z.scale.set(...se),z.position.set(...le),g.add(z),w.current=z,S.current=H,j.current=q,A.current=M,R.current=W,N(ue)},[t,e,i,n,a,s]),b.useEffect(()=>{var C;const g=j.current;if(!g)return;(C=R.current)==null||C.dispose();const v=ee(l);R.current=v,g.uniforms.uLUT.value=v,m()},[l]),b.useEffect(()=>{const g=j.current;if(!g)return;const v=g.uniforms;v.uMode.value=r==="mip"?0:1,v.uSteps.value=x,v.uIsovalue.value=c,v.uClipMin.value.set(...u.min),v.uClipMax.value.set(...u.max),m()},[r,c,x,u]),b.useEffect(()=>()=>{var g,v,C,V;(g=S.current)==null||g.dispose(),(v=j.current)==null||v.dispose(),(C=A.current)==null||C.dispose(),(V=R.current)==null||V.dispose()},[]),o.jsx("div",{ref:U,className:p??"relative h-full w-full",children:o.jsx("canvas",{ref:E,className:"block h-full w-full rounded"})})}function T(t){return Pe()?o.jsx(Ae,{...t}):o.jsx(Ee,{className:t.className})}function X(t){return{mode:t.renderMode,isovalue:t.isovalue,colormap:t.colormap,steps:t.steps,clipMin:t.clipMin,clipMax:t.clipMax,background:t.background}}function _({item:t,view:e,sync:i,label:n,isDraggable:a,onDragStart:s,onFrame:r}){if(!t)return o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"});const{arrays:c,meta:l}=t;return o.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[o.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:o.jsx(T,{data:c.data,shape:l.shape,spacing:l.spacing,origin:l.origin,vmin:l.vmin,vmax:l.vmax,mode:e.mode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clip:{min:e.clipMin,max:e.clipMax},background:e.background,sync:i,onFrame:r})}),o.jsx(te,{colormap:e.colormap,min:l.vmin,max:l.vmax}),o.jsx(G,{label:n,isDraggable:a,onDragStart:s})]})}function Le({item:t,reference:e,view:i,sync:n,label:a,isDraggable:s,onDragStart:r}){return e?o.jsxs("div",{className:"flex h-full w-full gap-0.5",children:[o.jsxs("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg",children:[o.jsx(T,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:e.meta.vmin,vmax:e.meta.vmax,mode:i.mode,isovalue:i.isovalue,colormap:i.colormap,steps:i.steps,clip:{min:i.clipMin,max:i.clipMax},background:i.background,sync:n}),o.jsx(G,{label:"REF"})]}),o.jsx("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded bg-bg",children:t?o.jsx(_,{item:t,view:i,sync:n,label:a,isDraggable:s,onDragStart:r}):o.jsx("div",{className:"flex h-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"})})]}):o.jsx(_,{item:t,view:i,sync:n,label:a,isDraggable:s,onDragStart:r})}function Ie({data:t,reference:e,settings:i,cameraSyncGroupId:n,label:a,isDraggable:s,onDragStart:r}){const c=n?{groupId:n}:null,l=X(i);if(!t||!e)return o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"});if(!(t.meta.shape[0]===e.meta.shape[0]&&t.meta.shape[1]===e.meta.shape[1]&&t.meta.shape[2]===e.meta.shape[2]))return o.jsxs("div",{className:"flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted",children:["Shape mismatch: ",t.meta.shape.join("×")," vs ",e.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const u=i.diffColormap??"viridis",d=t.meta.shape[0]*t.meta.shape[1]*t.meta.shape[2],p=we(t.arrays.data,e.arrays.data,d),f=Te(p,u),h=u==="viridis"?Re(p):p;return o.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[o.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:o.jsx(T,{data:h,shape:t.meta.shape,spacing:t.meta.spacing,origin:t.meta.origin,vmin:f[0],vmax:f[1],mode:l.mode,isovalue:l.isovalue,colormap:u,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,sync:c})}),o.jsx(te,{colormap:u,min:f[0],max:f[1]}),o.jsx(G,{label:a,isDraggable:s,onDragStart:r})]})}function _e(t,e){const i=t,n=e;return!i||!n?!1:i.meta.shape[0]===n.meta.shape[0]&&i.meta.shape[1]===n.meta.shape[1]&&i.meta.shape[2]===n.meta.shape[2]}const Be={coreModes:["normal","side","split","blend","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:_e,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],hasSteps:!0,postProcessing:!1,overlays:!1,colorbar:"always",cameraSync:!0,resetView:"always",crossTypeCompare:!0,webglContextsPerPane:1,maxPanes:4,label:{placement:"bottom-left",draggable:!0},downloadExtension:".npz"};async function Ge(t){const e=await fetch(pe.artifactUrl(t));if(!e.ok)throw new Error(`failed to fetch volume (${e.status})`);const i=await ve(await e.arrayBuffer());if(!i.data)throw new Error("volume artifact is missing its 'data' array");return Float32Array.from(i.data.data)}function B(t){return fe({queries:t.map(e=>({queryKey:["volume-npz",e],enabled:!!e,staleTime:1/0,queryFn:()=>Ge(e)}))})}function Xe(t){const{hashes:e,referenceHashes:i,metadata:n,referenceMetadata:a}=t,s=B(e),r=B(i);return b.useMemo(()=>{const c=e.map((u,d)=>{var h;if(!u)return null;const p=(h=s[d])==null?void 0:h.data,f=I(n==null?void 0:n[d]);return!p||!f?null:{arrays:{data:p},meta:f}}),l=i.map((u,d)=>{var h;if(!u)return null;const p=(h=r[d])==null?void 0:h.data,f=I(a==null?void 0:a[d]);return!p||!f?null:{arrays:{data:p},meta:f}}),x=s.some(u=>u.isLoading)||r.some(u=>u.isLoading);return{items:c,referenceItems:l,isLoading:x}},[e.join("|"),i.join("|"),(n??[]).join("|"),(a??[]).join("|"),s.map(c=>c.dataUpdatedAt).join("|"),r.map(c=>c.dataUpdatedAt).join("|")])}function ia({hash:t,metadata:e,onFrame:i}){const[n]=B([t]),a=I(e),s=Ve(),r=X(oe());return b.useEffect(()=>{s.dataUrl&&i({kind:"dataUrl",dataUrl:s.dataUrl})},[s.dataUrl]),!(n!=null&&n.data)||!a?null:o.jsx(T,{data:n.data,shape:a.shape,spacing:a.spacing,origin:a.origin,vmin:a.vmin,vmax:a.vmax,mode:r.mode,isovalue:r.isovalue,colormap:r.colormap,steps:r.steps,clip:{min:r.clipMin,max:r.clipMax},background:r.background,onFrame:s.onFrame})}function oe(){return{renderMode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark",brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1,zoom:1,pan:{x:0,y:0},diffMode:"none"}}const We=new Set(["normal","side","split","blend","diff"]),qe=new Set(["mip","iso"]);function He(t){const e=t;let i=t;if(typeof e.mode=="string"&&qe.has(e.mode)&&(i={...i,renderMode:e.mode,mode:void 0}),i.mode==null&&i.nativeMode==null&&typeof e.compareMode=="string"){const n=e.compareMode;n==="diff-value"?i={...i,nativeMode:n}:We.has(n)&&(i={...i,mode:n})}return i.diffMode==="none"&&typeof e.diffSubmode=="string"&&(i={...i,diffMode:e.diffSubmode}),i}function Ye(t){const{data:e,reference:i,settings:n,mode:a,diffMode:s,cameraSyncGroupId:r,label:c,isBaseline:l,isDraggable:x,onDragStart:u,splitPosition:d,onSplitPositionChange:p,blendAlpha:f,crossTypeReferenceUrl:h,crossTypeAlignForDiff:U}=t,E=r?{groupId:r}:null,m=X(n),N=h!=null,y=i==null&&!N?"normal":a,w=(S,j)=>o.jsx(T,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:e.meta.vmin,vmax:e.meta.vmax,mode:m.mode,isovalue:m.isovalue,colormap:m.colormap,steps:m.steps,clip:{min:m.clipMin,max:m.clipMax},background:m.background,sync:j,onFrame:S});return N&&y!=="normal"?e?o.jsx(J,{mode:y,primary:{kind:"live",render:w},reference:{kind:"frame",frameSource:{kind:"url",url:h}},diffSubmode:s,colormap:n.diffColormap??"viridis",splitPosition:d??.5,onSplitPositionChange:p??(()=>{}),blendAlpha:f??.5,primaryLabel:c,alignForDiff:U}):o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):y==="side"?o.jsx(Le,{item:e,reference:i??null,view:m,sync:E,label:c,isDraggable:x,onDragStart:u}):de(y)&&(y==="split"||y==="blend"||y==="diff")?!e||!i?o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):o.jsx(J,{mode:y,primary:{kind:"live",render:w},reference:{kind:"live",render:(S,j)=>o.jsx(T,{data:i.arrays.data,shape:i.meta.shape,spacing:i.meta.spacing,origin:i.meta.origin,vmin:i.meta.vmin,vmax:i.meta.vmax,mode:m.mode,isovalue:m.isovalue,colormap:m.colormap,steps:m.steps,clip:{min:m.clipMin,max:m.clipMax},background:m.background,sync:j,onFrame:S})},diffSubmode:s,colormap:n.diffColormap??"viridis",splitPosition:d??.5,onSplitPositionChange:p??(()=>{}),blendAlpha:f??.5,primaryLabel:c}):o.jsx(_,{item:e,view:m,sync:E,label:c,isDraggable:x,onDragStart:u})}const Ze=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],Qe=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],$e=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],Je=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function Ke({settings:t,update:e}){const i=(a,s)=>{const r=[...t.clipMin];r[a]=Math.min(s,t.clipMax[a]),e({clipMin:r})},n=(a,s)=>{const r=[...t.clipMax];r[a]=Math.max(s,t.clipMin[a]),e({clipMax:r})};return o.jsxs(o.Fragment,{children:[o.jsx(k,{label:"Render mode",value:t.renderMode,onChange:a=>e({renderMode:a}),options:Ze}),t.renderMode==="iso"&&o.jsx(D,{label:"Isovalue",value:t.isovalue,onChange:a=>e({isovalue:a}),min:0,max:1,step:.01,format:a=>a.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),o.jsx(k,{label:"Colormap",value:t.colormap,onChange:a=>e({colormap:a}),options:Qe}),o.jsx(k,{label:"Quality",value:String(t.steps),onChange:a=>e({steps:Number(a)}),options:$e,description:"Raymarch step count — higher is finer but slower"}),o.jsx(k,{label:"Background",value:t.background,onChange:a=>e({background:a}),options:Je}),o.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[o.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),o.jsx(D,{label:"Clip X min",value:t.clipMin[0],onChange:a=>i(0,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),o.jsx(D,{label:"Clip X max",value:t.clipMax[0],onChange:a=>n(0,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),o.jsx(D,{label:"Clip Y min",value:t.clipMin[1],onChange:a=>i(1,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),o.jsx(D,{label:"Clip Y max",value:t.clipMax[1],onChange:a=>n(1,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),o.jsx(D,{label:"Clip Z min",value:t.clipMin[2],onChange:a=>i(2,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),o.jsx(D,{label:"Clip Z max",value:t.clipMax[2],onChange:a=>n(2,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)})]}),o.jsx(k,{label:"Diff colormap",value:t.diffColormap??"viridis",onChange:a=>e({diffColormap:a}),options:[{value:"viridis",label:"Viridis (magnitude)"},{value:"red-green",label:"Red – Green (signed)"}],description:"Color mapping for the native diff mode (diff-value)"})]})}const ae={kind:"camera3d",position:[0,0,5],target:[0,0,0],zoom:1},ea={objectType:"volume",capabilities:Be,useData:Xe,defaultSettings:oe,migrateSettings:He,viewFromSettings:()=>ae,viewToSettingsPatch:()=>({}),defaultView:()=>ae,onResetView:t=>ke(t),Pane:Ye,SettingsControls:Ke,nativeDiff:{render:Ie}};function oa(t){return o.jsx(me,{...t,viewport:ea})}export{ia as VolumeForeignFrame,oa as default,ea as volumeViewportModule};

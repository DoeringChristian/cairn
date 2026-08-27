import{j as s,y as fe,r as g,d as ve,L as ne,a4 as xe,J as he,Q as be}from"./parse-overlay-Dax7NZ2Y.js";import{br as ge,I as X,b8 as R,bq as T,b9 as K,y as Me,o as ye}from"./index-C-3lJHz4.js";import{u as we,n as Ce,R as Se,U as ie,o as L,C as I,p as _,q as De,s as je,G as Te,t as Pe,l as Oe,S as Ae,v as Ve,w as Re,d as se,e as re,f as ke,V as B,x as Ie,h as Ee,i as Fe,r as ze,O as ee,j as Le}from"./OffscreenComparePanes-C23dPQpu.js";import"./parse-npz-BWaJKlSe.js";const Ue={dark:856343,light:16185594},ae=256;let k=null;function Ne(){if(k!==null)return k;try{const o=document.createElement("canvas").getContext("webgl2");if(o){const t=o.getExtension("WEBGL_lose_context");t==null||t.loseContext()}k=!!o}catch{k=!1}return k}function _e(e,o,t){const n=t-o||1,a=new Uint8Array(e.length);for(let r=0;r<e.length;r++){const i=(e[r]-o)/n;a[r]=Math.max(0,Math.min(255,Math.round(i*255)))}return a}function oe(e){const o=ve(e),t=new Uint8Array(256*4);for(let a=0;a<256;a++)t[a*4]=o[a*3],t[a*4+1]=o[a*3+1],t[a*4+2]=o[a*3+2],t[a*4+3]=255;const n=new Ve(t,256,1,Re,ie);return n.minFilter=L,n.magFilter=L,n.wrapS=I,n.wrapT=I,n.needsUpdate=!0,n}const Xe=`precision highp float;

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
uniform float uSteps;       // <= ${ae}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${ae};
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
`;function Ge(e,o,t){const[n,a,r]=e,i=r*o[2],c=a*o[1],f=n*o[0],l=t[2],m=t[1],u=t[0];return{scale:[i,c,f],position:[l+i/2,m+c/2,u+f/2],bounds:{min:[l,m,u],max:[l+i,m+c,u+f]}}}function We({data:e,shape:o,spacing:t,origin:n,vmin:a,vmax:r,mode:i,isovalue:c,colormap:f,steps:l,clip:m,background:u,className:p,sync:v=null,onFrame:x,showAxes:S=!1,showPlanes:U=!1,cameraMode:d="orbital"}){const P=we({background:Ue[u],sync:v,showAxes:S,showPlanes:U,cameraMode:d,onFrame:x}),{requestRender:y,fitToBounds:F,refs:O}=P,D=g.useRef(null),j=g.useRef(null),w=g.useRef(null),N=g.useRef(null),A=g.useRef(null);return g.useEffect(()=>{var H,$,Q,J;const b=O.scene.current;if(!b)return;D.current&&(b.remove(D.current),(H=j.current)==null||H.dispose(),($=w.current)==null||$.dispose(),(Q=N.current)==null||Q.dispose(),(J=A.current)==null||J.dispose());const[h,C,V]=o,ce=_e(e,a,r),M=new Ce(ce,V,C,h);M.format=Se,M.type=ie,M.minFilter=L,M.magFilter=L,M.wrapR=I,M.wrapS=I,M.wrapT=I,M.needsUpdate=!0;const Y=oe(f),ue={uData:{value:M},uLUT:{value:Y},uMode:{value:i==="mip"?0:1},uSteps:{value:l},uIsovalue:{value:c},uClipMin:{value:new _(...m.min)},uClipMax:{value:new _(...m.max)},uTexelSize:{value:new _(1/V,1/C,1/h)}},q=new De({glslVersion:Te,vertexShader:Xe,fragmentShader:Be,uniforms:ue,side:je,transparent:!1}),Z=new Pe(1,1,1),z=new Oe(Z,q),{scale:me,position:de,bounds:pe}=Ge(o,t,n);z.scale.set(...me),z.position.set(...de),b.add(z),D.current=z,j.current=Z,w.current=q,N.current=M,A.current=Y,F(pe)},[e,o,t,n,a,r]),g.useEffect(()=>{var C;const b=w.current;if(!b)return;(C=A.current)==null||C.dispose();const h=oe(f);A.current=h,b.uniforms.uLUT.value=h,y()},[f]),g.useEffect(()=>{const b=w.current;if(!b)return;const h=b.uniforms;h.uMode.value=i==="mip"?0:1,h.uSteps.value=l,h.uIsovalue.value=c,h.uClipMin.value.set(...m.min),h.uClipMax.value.set(...m.max),y()},[i,c,l,m]),g.useEffect(()=>()=>{var b,h,C,V;(b=j.current)==null||b.dispose(),(h=w.current)==null||h.dispose(),(C=N.current)==null||C.dispose(),(V=A.current)==null||V.dispose()},[]),s.jsx(Ae,{handle:P,className:p})}function E(e){return Ne()?s.jsx(We,{...e}):s.jsx(fe,{className:e.className,title:"WebGL2 unavailable",body:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})}function W(e){return{mode:e.renderMode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clipMin:e.clipMin,clipMax:e.clipMax,background:e.background,showAxes:e.showAxes??!1,showPlanes:e.showPlanes??!1,cameraMode:e.cameraMode??"orbital"}}function Ye({item:e,view:o,sync:t,label:n,isDraggable:a,onDragStart:r,onFrame:i,colorRange:c}){if(!e)return s.jsx(B,{variant:"empty",children:"no volume logged yet"});const{arrays:f,meta:l}=e,[m,u]=c??[l.vmin,l.vmax];return s.jsxs("div",{className:"relative flex h-full w-full flex-col overflow-hidden rounded bg-bg",children:[s.jsx("div",{className:"flex flex-1 min-h-0 overflow-hidden",children:s.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:s.jsx(E,{data:f.data,shape:l.shape,spacing:l.spacing,origin:l.origin,vmin:m,vmax:u,mode:o.mode,isovalue:o.isovalue,colormap:o.colormap,steps:o.steps,clip:{min:o.clipMin,max:o.clipMax},background:o.background,showAxes:o.showAxes,showPlanes:o.showPlanes,cameraMode:o.cameraMode,sync:t,onFrame:i})})}),s.jsx(Ee,{text:`${l.shape.join("×")} · vmin ${l.vmin.toFixed(3)} · vmax ${l.vmax.toFixed(3)}`}),s.jsx(ne,{label:n,isDraggable:a,onDragStart:r})]})}function qe({data:e,reference:o,settings:t,cameraSyncGroupId:n,label:a,isDraggable:r,onDragStart:i,colorRange:c}){const f=n?{groupId:n}:null,l=W(t);if(!e||!o)return s.jsx(B,{variant:"loading",children:"loading…"});if(!(e.meta.shape[0]===o.meta.shape[0]&&e.meta.shape[1]===o.meta.shape[1]&&e.meta.shape[2]===o.meta.shape[2]))return s.jsxs(B,{variant:"error",children:["Shape mismatch: ",e.meta.shape.join("×")," vs ",o.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const u=t.diffColormap??"turbo",p=e.meta.shape[0]*e.meta.shape[1]*e.meta.shape[2],v=se(e.arrays.data,o.arrays.data,p),x=c??re(v,u),S=u==="turbo"?Ie(v):v;return s.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[s.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:s.jsx(E,{data:S,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:x[0],vmax:x[1],mode:l.mode,isovalue:l.isovalue,colormap:u,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,showAxes:l.showAxes,showPlanes:l.showPlanes,cameraMode:l.cameraMode,sync:f})}),s.jsx(ne,{label:a,isDraggable:r,onDragStart:i})]})}function Ze(e,o){const t=e,n=o;return!t||!n?!1:t.meta.shape[0]===n.meta.shape[0]&&t.meta.shape[1]===n.meta.shape[1]&&t.meta.shape[2]===n.meta.shape[2]}function He(e){const{items:o,referenceItems:t,settings:n,nativeMode:a}=e;if(a==="diff-value"){const c=n.diffColormap??"turbo",f=[];for(let m=0;m<o.length;m++){const u=o[m],p=t[m];if(!u||!p||u.meta.shape[0]!==p.meta.shape[0]||u.meta.shape[1]!==p.meta.shape[1]||u.meta.shape[2]!==p.meta.shape[2])continue;const v=u.meta.shape[0]*u.meta.shape[1]*u.meta.shape[2],x=se(u.arrays.data,p.arrays.data,v);f.push(re(x,c))}const l=ke(f,c);return l?{colormap:c,min:l[0],max:l[1]}:null}let r=1/0,i=-1/0;for(const c of[...o,...t])c&&(r=Math.min(r,c.meta.vmin),i=Math.max(i,c.meta.vmax));return!Number.isFinite(r)||!Number.isFinite(i)?null:{colormap:n.colormap,min:r,max:i}}const $e={coreModes:["normal","split","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:Ze,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],hasSteps:!0,postProcessing:!1,overlays:!1,colorbar:"never",cameraSync:!0,resetView:"always",crossTypeCompare:!0,webglContextsPerPane:1,maxPanes:4,label:{placement:"bottom-left",draggable:!0},downloadExtension:".npz"},Qe=be(e=>ye.artifactUrl(e));function G(e){return Me({queries:e.map(o=>({queryKey:["volume-npz",o],enabled:!!o,staleTime:1/0,queryFn:()=>xe(o,Qe)}))})}function Je(e){const{hashes:o,referenceHashes:t,metadata:n,referenceMetadata:a}=e,r=G(o),i=G(t);return g.useMemo(()=>{const c=o.map((m,u)=>{var x;if(!m)return null;const p=(x=r[u])==null?void 0:x.data,v=X(n==null?void 0:n[u]);return!p||!v?null:{arrays:{data:p},meta:v}}),f=t.map((m,u)=>{var x;if(!m)return null;const p=(x=i[u])==null?void 0:x.data,v=X(a==null?void 0:a[u]);return!p||!v?null:{arrays:{data:p},meta:v}}),l=r.some(m=>m.isLoading)||i.some(m=>m.isLoading);return{items:c,referenceItems:f,isLoading:l}},[o.join("|"),t.join("|"),(n??[]).join("|"),(a??[]).join("|"),r.map(c=>c.dataUpdatedAt).join("|"),i.map(c=>c.dataUpdatedAt).join("|")])}function fa({hash:e,metadata:o,onFrame:t}){const[n]=G([e]),a=X(o),r=Fe(),i=W(le());return g.useEffect(()=>{r.dataUrl&&t({kind:"dataUrl",dataUrl:r.dataUrl})},[r.dataUrl]),!(n!=null&&n.data)||!a?null:s.jsx(E,{data:n.data,shape:a.shape,spacing:a.spacing,origin:a.origin,vmin:a.vmin,vmax:a.vmax,mode:i.mode,isovalue:i.isovalue,colormap:i.colormap,steps:i.steps,clip:{min:i.clipMin,max:i.clipMax},background:i.background,showAxes:i.showAxes,showPlanes:i.showPlanes,cameraMode:i.cameraMode,onFrame:r.onFrame})}function le(){return{renderMode:"mip",isovalue:.5,colormap:"turbo",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark",showAxes:!1,showPlanes:!1,cameraMode:"orbital",syncViews:!0,brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1,zoom:1,pan:{x:0,y:0},diffMode:"none"}}const Ke=new Set(["normal","split","blend","diff"]),ea=new Set(["mip","iso"]);function aa(e){const o=e;let t=e;if(typeof o.mode=="string"&&ea.has(o.mode)&&(t={...t,renderMode:o.mode,mode:void 0}),t.mode==null&&t.nativeMode==null&&typeof o.compareMode=="string"){const n=o.compareMode;n==="diff-value"?t={...t,nativeMode:n}:Ke.has(n)&&(t={...t,mode:n==="blend"?"split":n})}return t.diffMode==="none"&&typeof o.diffSubmode=="string"&&(t={...t,diffMode:o.diffSubmode}),t}function oa(e){const{data:o,reference:t,settings:n,mode:a,diffMode:r,cameraSyncGroupId:i,label:c,isBaseline:f,isDraggable:l,onDragStart:m,splitPosition:u,onSplitPositionChange:p,crossTypeReferenceUrl:v,crossTypeAlignForDiff:x,colorRange:S}=e,U=i?{groupId:i}:null,d=W(n),P=v!=null,y=t==null&&!P?"normal":a,F=(O,D)=>{const[j,w]=S??[o.meta.vmin,o.meta.vmax];return s.jsx(E,{data:o.arrays.data,shape:o.meta.shape,spacing:o.meta.spacing,origin:o.meta.origin,vmin:j,vmax:w,mode:d.mode,isovalue:d.isovalue,colormap:d.colormap,steps:d.steps,clip:{min:d.clipMin,max:d.clipMax},background:d.background,showAxes:d.showAxes,showPlanes:d.showPlanes,cameraMode:d.cameraMode,sync:D,onFrame:O})};return P&&y!=="normal"?o?s.jsx(ee,{mode:y,syncGroupId:i??null,primary:{kind:"live",render:F},reference:{kind:"frame",frameSource:{kind:"url",url:v}},diffSubmode:r,colormap:n.diffColormap??"turbo",splitPosition:u??.5,onSplitPositionChange:p??(()=>{}),primaryLabel:c,alignForDiff:x}):s.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):Le(y)&&(y==="split"||y==="diff")?!o||!t?s.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):s.jsx(ee,{mode:y,syncGroupId:i??null,primary:{kind:"live",render:F},reference:{kind:"live",render:(O,D)=>{const[j,w]=S??[t.meta.vmin,t.meta.vmax];return s.jsx(E,{data:t.arrays.data,shape:t.meta.shape,spacing:t.meta.spacing,origin:t.meta.origin,vmin:j,vmax:w,mode:d.mode,isovalue:d.isovalue,colormap:d.colormap,steps:d.steps,clip:{min:d.clipMin,max:d.clipMax},background:d.background,showAxes:d.showAxes,showPlanes:d.showPlanes,cameraMode:d.cameraMode,sync:D,onFrame:O})}},diffSubmode:r,colormap:n.diffColormap??"turbo",splitPosition:u??.5,onSplitPositionChange:p??(()=>{}),primaryLabel:c}):s.jsx(Ye,{item:o,view:d,sync:U,label:c,isDraggable:l,onDragStart:m,colorRange:S})}const ta=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],na=he.map(e=>({value:e.id,label:e.label})),ia=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],sa=[{value:"orbital",label:"Orbital"},{value:"turntable",label:"Turntable"}],ra=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function la({settings:e,update:o}){const t=(a,r)=>{const i=[...e.clipMin];i[a]=Math.min(r,e.clipMax[a]),o({clipMin:i})},n=(a,r)=>{const i=[...e.clipMax];i[a]=Math.max(r,e.clipMin[a]),o({clipMax:i})};return s.jsxs(s.Fragment,{children:[s.jsx(R,{label:"Render mode",value:e.renderMode,onChange:a=>o({renderMode:a}),options:ta}),e.renderMode==="iso"&&s.jsx(T,{label:"Isovalue",value:e.isovalue,onChange:a=>o({isovalue:a}),min:0,max:1,step:.01,format:a=>a.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),s.jsx(R,{label:"Colormap",value:e.colormap,onChange:a=>o({colormap:a}),options:na}),s.jsx(R,{label:"Quality",value:String(e.steps),onChange:a=>o({steps:Number(a)}),options:ia,description:"Raymarch step count — higher is finer but slower"}),s.jsx(R,{label:"Background",value:e.background,onChange:a=>o({background:a}),options:ra}),s.jsx(K,{label:"Show axes",checked:!!e.showAxes,onChange:a=>o({showAxes:a}),description:"Colored XYZ origin lines + grid, sized to the fitted view"}),s.jsx(K,{label:"Show planes",checked:!!e.showPlanes,onChange:a=>o({showPlanes:a}),description:"Faint XY/YZ/XZ reference planes through the origin"}),s.jsx(R,{label:"Orientation",value:e.cameraMode??"orbital",onChange:a=>o({cameraMode:a}),options:sa,description:"Turntable locks world-up and spins about it; orbital is free orbit"}),s.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[s.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),s.jsx(T,{label:"Clip X min",value:e.clipMin[0],onChange:a=>t(0,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),s.jsx(T,{label:"Clip X max",value:e.clipMax[0],onChange:a=>n(0,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),s.jsx(T,{label:"Clip Y min",value:e.clipMin[1],onChange:a=>t(1,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),s.jsx(T,{label:"Clip Y max",value:e.clipMax[1],onChange:a=>n(1,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),s.jsx(T,{label:"Clip Z min",value:e.clipMin[2],onChange:a=>t(2,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)}),s.jsx(T,{label:"Clip Z max",value:e.clipMax[2],onChange:a=>n(2,a),min:0,max:1,step:.01,format:a=>a.toFixed(2)})]})]})}const te={kind:"camera3d",position:[0,0,5],target:[0,0,0],zoom:1},ca={objectType:"volume",capabilities:$e,useData:Je,defaultSettings:le,migrateSettings:aa,viewFromSettings:()=>te,viewToSettingsPatch:()=>({}),defaultView:()=>te,onResetView:e=>ze(e),Pane:oa,SettingsControls:la,nativeDiff:{render:qe},activeColorbar:He};function va(e){return s.jsx(ge,{...e,viewport:ca})}export{fa as VolumeForeignFrame,va as default,ca as volumeViewportModule};

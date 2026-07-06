import{w as o,r as y,a4 as me,a0 as G,a1 as de,s as L,x as z,J as T,T as fe,d as pe,e as xe,a2 as ve}from"./index-CDW5Gfpo.js";import{u as he,n as ge,R as be,U as te,o as I,C as R,V as U,p as ye,q as Me,G as we,s as Se,l as Ce,S as je,t as De,v as Te,d as ie,e as oe,f as Ae,w as Ve,h as ke,i as Ne,r as Oe,O as J,j as Pe}from"./diff-BPYnoEQa.js";const Re={dark:856343,light:16185594},K=256;let P=null;function Ee(){if(P!==null)return P;try{const e=document.createElement("canvas").getContext("webgl2");if(e){const i=e.getExtension("WEBGL_lose_context");i==null||i.loseContext()}P=!!e}catch{P=!1}return P}function Fe({className:a}){return o.jsx("div",{className:a??"relative h-full w-full",children:o.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[o.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),o.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function ze(a,e,i){const n=i-e||1,t=new Uint8Array(a.length);for(let r=0;r<a.length;r++){const s=(a[r]-e)/n;t[r]=Math.max(0,Math.min(255,Math.round(s*255)))}return t}function ee(a){const e=me(a),i=new Uint8Array(256*4);for(let t=0;t<256;t++)i[t*4]=e[t*3],i[t*4+1]=e[t*3+1],i[t*4+2]=e[t*3+2],i[t*4+3]=255;const n=new De(i,256,1,Te,te);return n.minFilter=I,n.magFilter=I,n.wrapS=R,n.wrapT=R,n.needsUpdate=!0,n}const Ie=`precision highp float;

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
`,Ue=`precision highp float;
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
`;function Le(a,e,i){const[n,t,r]=a,s=r*e[2],u=t*e[1],d=n*e[0],l=i[2],c=i[1],m=i[0];return{scale:[s,u,d],position:[l+s/2,c+u/2,m+d/2],bounds:{min:[l,c,m],max:[l+s,c+u,m+d]}}}function _e({data:a,shape:e,spacing:i,origin:n,vmin:t,vmax:r,mode:s,isovalue:u,colormap:d,steps:l,clip:c,background:m,className:p,sync:x=null,onFrame:h,showAxes:k=!1}){const j=he({background:Re[m],sync:x,showAxes:k,onFrame:h}),{requestRender:N,fitToBounds:f,refs:E}=j,b=y.useRef(null),A=y.useRef(null),w=y.useRef(null),D=y.useRef(null),S=y.useRef(null);return y.useEffect(()=>{var H,Z,$,Q;const v=E.scene.current;if(!v)return;b.current&&(v.remove(b.current),(H=A.current)==null||H.dispose(),(Z=w.current)==null||Z.dispose(),($=D.current)==null||$.dispose(),(Q=S.current)==null||Q.dispose());const[g,C,O]=e,se=ze(a,t,r),M=new ge(se,O,C,g);M.format=be,M.type=te,M.minFilter=I,M.magFilter=I,M.wrapR=R,M.wrapS=R,M.wrapT=R,M.needsUpdate=!0;const W=ee(d),re={uData:{value:M},uLUT:{value:W},uMode:{value:s==="mip"?0:1},uSteps:{value:l},uIsovalue:{value:u},uClipMin:{value:new U(...c.min)},uClipMax:{value:new U(...c.max)},uTexelSize:{value:new U(1/O,1/C,1/g)}},Y=new ye({glslVersion:we,vertexShader:Ie,fragmentShader:Ue,uniforms:re,side:Me,transparent:!1}),q=new Se(1,1,1),F=new Ce(q,Y),{scale:le,position:ue,bounds:ce}=Le(e,i,n);F.scale.set(...le),F.position.set(...ue),v.add(F),b.current=F,A.current=q,w.current=Y,D.current=M,S.current=W,f(ce)},[a,e,i,n,t,r]),y.useEffect(()=>{var C;const v=w.current;if(!v)return;(C=S.current)==null||C.dispose();const g=ee(d);S.current=g,v.uniforms.uLUT.value=g,N()},[d]),y.useEffect(()=>{const v=w.current;if(!v)return;const g=v.uniforms;g.uMode.value=s==="mip"?0:1,g.uSteps.value=l,g.uIsovalue.value=u,g.uClipMin.value.set(...c.min),g.uClipMax.value.set(...c.max),N()},[s,u,l,c]),y.useEffect(()=>()=>{var v,g,C,O;(v=A.current)==null||v.dispose(),(g=w.current)==null||g.dispose(),(C=D.current)==null||C.dispose(),(O=S.current)==null||O.dispose()},[]),o.jsx(je,{handle:j,className:p})}function V(a){return Ee()?o.jsx(_e,{...a}):o.jsx(Fe,{className:a.className})}function X(a){return{mode:a.renderMode,isovalue:a.isovalue,colormap:a.colormap,steps:a.steps,clipMin:a.clipMin,clipMax:a.clipMax,background:a.background,showAxes:a.showAxes??!1}}function _({item:a,view:e,sync:i,label:n,isDraggable:t,onDragStart:r,onFrame:s,colorRange:u}){if(!a)return o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"});const{arrays:d,meta:l}=a,[c,m]=u??[l.vmin,l.vmax];return o.jsxs("div",{className:"relative flex h-full w-full flex-col overflow-hidden rounded bg-bg",children:[o.jsx("div",{className:"flex flex-1 min-h-0 overflow-hidden",children:o.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:o.jsx(V,{data:d.data,shape:l.shape,spacing:l.spacing,origin:l.origin,vmin:c,vmax:m,mode:e.mode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clip:{min:e.clipMin,max:e.clipMax},background:e.background,showAxes:e.showAxes,sync:i,onFrame:s})})}),o.jsx("div",{className:"mono px-1 py-0.5 text-[10px] text-fg-subtle",children:`${l.shape.join("×")} · vmin ${l.vmin.toFixed(3)} · vmax ${l.vmax.toFixed(3)}`}),o.jsx(G,{label:n,isDraggable:t,onDragStart:r})]})}function Be({item:a,reference:e,view:i,sync:n,label:t,isDraggable:r,onDragStart:s,colorRange:u}){const d=ke(n);if(!e)return o.jsx(_,{item:a,view:i,sync:n,label:t,isDraggable:r,onDragStart:s,colorRange:u});const[l,c]=u??[e.meta.vmin,e.meta.vmax];return o.jsxs("div",{className:"flex h-full w-full gap-0.5",children:[o.jsxs("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded border border-accent/20 bg-bg",children:[o.jsx(V,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:l,vmax:c,mode:i.mode,isovalue:i.isovalue,colormap:i.colormap,steps:i.steps,clip:{min:i.clipMin,max:i.clipMax},background:i.background,showAxes:i.showAxes,sync:d}),o.jsx(G,{label:"REF"})]}),o.jsx("div",{className:"relative flex-1 min-w-0 overflow-hidden rounded bg-bg",children:a?o.jsx(_,{item:a,view:i,sync:d,label:t,isDraggable:r,onDragStart:s,colorRange:u}):o.jsx("div",{className:"flex h-full items-center justify-center text-sm text-fg-muted",children:"no volume logged yet"})})]})}function Ge({data:a,reference:e,settings:i,cameraSyncGroupId:n,label:t,isDraggable:r,onDragStart:s,colorRange:u}){const d=n?{groupId:n}:null,l=X(i);if(!a||!e)return o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"});if(!(a.meta.shape[0]===e.meta.shape[0]&&a.meta.shape[1]===e.meta.shape[1]&&a.meta.shape[2]===e.meta.shape[2]))return o.jsxs("div",{className:"flex h-full w-full items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted",children:["Shape mismatch: ",a.meta.shape.join("×")," vs ",e.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const m=i.diffColormap??"viridis",p=a.meta.shape[0]*a.meta.shape[1]*a.meta.shape[2],x=ie(a.arrays.data,e.arrays.data,p),h=u??oe(x,m),k=m==="viridis"?Ve(x):x;return o.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[o.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:o.jsx(V,{data:k,shape:a.meta.shape,spacing:a.meta.spacing,origin:a.meta.origin,vmin:h[0],vmax:h[1],mode:l.mode,isovalue:l.isovalue,colormap:m,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,showAxes:l.showAxes,sync:d})}),o.jsx(G,{label:t,isDraggable:r,onDragStart:s})]})}function Xe(a,e){const i=a,n=e;return!i||!n?!1:i.meta.shape[0]===n.meta.shape[0]&&i.meta.shape[1]===n.meta.shape[1]&&i.meta.shape[2]===n.meta.shape[2]}function We(a){const{items:e,referenceItems:i,settings:n,nativeMode:t}=a;if(t==="diff-value"){const u=n.diffColormap??"viridis",d=[];for(let c=0;c<e.length;c++){const m=e[c],p=i[c];if(!m||!p||m.meta.shape[0]!==p.meta.shape[0]||m.meta.shape[1]!==p.meta.shape[1]||m.meta.shape[2]!==p.meta.shape[2])continue;const x=m.meta.shape[0]*m.meta.shape[1]*m.meta.shape[2],h=ie(m.arrays.data,p.arrays.data,x);d.push(oe(h,u))}const l=Ae(d,u);return l?{colormap:u,min:l[0],max:l[1]}:null}let r=1/0,s=-1/0;for(const u of[...e,...i])u&&(r=Math.min(r,u.meta.vmin),s=Math.max(s,u.meta.vmax));return!Number.isFinite(r)||!Number.isFinite(s)?null:{colormap:n.colormap,min:r,max:s}}const Ye={coreModes:["normal","side","split","blend","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:Xe,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],hasSteps:!0,postProcessing:!1,overlays:!1,colorbar:"never",cameraSync:!0,resetView:"always",crossTypeCompare:!0,webglContextsPerPane:1,maxPanes:4,label:{placement:"bottom-left",draggable:!0},downloadExtension:".npz"};async function qe(a){const e=await fetch(xe.artifactUrl(a));if(!e.ok)throw new Error(`failed to fetch volume (${e.status})`);const i=await ve(await e.arrayBuffer());if(!i.data)throw new Error("volume artifact is missing its 'data' array");return Float32Array.from(i.data.data)}function B(a){return pe({queries:a.map(e=>({queryKey:["volume-npz",e],enabled:!!e,staleTime:1/0,queryFn:()=>qe(e)}))})}function He(a){const{hashes:e,referenceHashes:i,metadata:n,referenceMetadata:t}=a,r=B(e),s=B(i);return y.useMemo(()=>{const u=e.map((c,m)=>{var h;if(!c)return null;const p=(h=r[m])==null?void 0:h.data,x=L(n==null?void 0:n[m]);return!p||!x?null:{arrays:{data:p},meta:x}}),d=i.map((c,m)=>{var h;if(!c)return null;const p=(h=s[m])==null?void 0:h.data,x=L(t==null?void 0:t[m]);return!p||!x?null:{arrays:{data:p},meta:x}}),l=r.some(c=>c.isLoading)||s.some(c=>c.isLoading);return{items:u,referenceItems:d,isLoading:l}},[e.join("|"),i.join("|"),(n??[]).join("|"),(t??[]).join("|"),r.map(u=>u.dataUpdatedAt).join("|"),s.map(u=>u.dataUpdatedAt).join("|")])}function ra({hash:a,metadata:e,onFrame:i}){const[n]=B([a]),t=L(e),r=Ne(),s=X(ne());return y.useEffect(()=>{r.dataUrl&&i({kind:"dataUrl",dataUrl:r.dataUrl})},[r.dataUrl]),!(n!=null&&n.data)||!t?null:o.jsx(V,{data:n.data,shape:t.shape,spacing:t.spacing,origin:t.origin,vmin:t.vmin,vmax:t.vmax,mode:s.mode,isovalue:s.isovalue,colormap:s.colormap,steps:s.steps,clip:{min:s.clipMin,max:s.clipMax},background:s.background,showAxes:s.showAxes,onFrame:r.onFrame})}function ne(){return{renderMode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark",showAxes:!1,syncViews:!0,brightness:0,contrast:0,gamma:1,exposure:0,offset:0,flipSign:!1,zoom:1,pan:{x:0,y:0},diffMode:"none"}}const Ze=new Set(["normal","side","split","blend","diff"]),$e=new Set(["mip","iso"]);function Qe(a){const e=a;let i=a;if(typeof e.mode=="string"&&$e.has(e.mode)&&(i={...i,renderMode:e.mode,mode:void 0}),i.mode==null&&i.nativeMode==null&&typeof e.compareMode=="string"){const n=e.compareMode;n==="diff-value"?i={...i,nativeMode:n}:Ze.has(n)&&(i={...i,mode:n})}return i.diffMode==="none"&&typeof e.diffSubmode=="string"&&(i={...i,diffMode:e.diffSubmode}),i}function Je(a){const{data:e,reference:i,settings:n,mode:t,diffMode:r,cameraSyncGroupId:s,label:u,isBaseline:d,isDraggable:l,onDragStart:c,splitPosition:m,onSplitPositionChange:p,blendAlpha:x,crossTypeReferenceUrl:h,crossTypeAlignForDiff:k,colorRange:j}=a,N=s?{groupId:s}:null,f=X(n),E=h!=null,b=i==null&&!E?"normal":t,A=(w,D)=>{const[S,v]=j??[e.meta.vmin,e.meta.vmax];return o.jsx(V,{data:e.arrays.data,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:S,vmax:v,mode:f.mode,isovalue:f.isovalue,colormap:f.colormap,steps:f.steps,clip:{min:f.clipMin,max:f.clipMax},background:f.background,showAxes:f.showAxes,sync:D,onFrame:w})};return E&&b!=="normal"?e?o.jsx(J,{mode:b,syncGroupId:s??null,primary:{kind:"live",render:A},reference:{kind:"frame",frameSource:{kind:"url",url:h}},diffSubmode:r,colormap:n.diffColormap??"viridis",splitPosition:m??.5,onSplitPositionChange:p??(()=>{}),blendAlpha:x??.5,primaryLabel:u,alignForDiff:k}):o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):b==="side"?o.jsx(Be,{item:e,reference:i??null,view:f,sync:N,label:u,isDraggable:l,onDragStart:c,colorRange:j}):Pe(b)&&(b==="split"||b==="blend"||b==="diff")?!e||!i?o.jsx("div",{className:"flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse",children:"loading…"}):o.jsx(J,{mode:b,syncGroupId:s??null,primary:{kind:"live",render:A},reference:{kind:"live",render:(w,D)=>{const[S,v]=j??[i.meta.vmin,i.meta.vmax];return o.jsx(V,{data:i.arrays.data,shape:i.meta.shape,spacing:i.meta.spacing,origin:i.meta.origin,vmin:S,vmax:v,mode:f.mode,isovalue:f.isovalue,colormap:f.colormap,steps:f.steps,clip:{min:f.clipMin,max:f.clipMax},background:f.background,showAxes:f.showAxes,sync:D,onFrame:w})}},diffSubmode:r,colormap:n.diffColormap??"viridis",splitPosition:m??.5,onSplitPositionChange:p??(()=>{}),blendAlpha:x??.5,primaryLabel:u}):o.jsx(_,{item:e,view:f,sync:N,label:u,isDraggable:l,onDragStart:c,colorRange:j})}const Ke=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],ea=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],aa=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],ta=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function ia({settings:a,update:e}){const i=(t,r)=>{const s=[...a.clipMin];s[t]=Math.min(r,a.clipMax[t]),e({clipMin:s})},n=(t,r)=>{const s=[...a.clipMax];s[t]=Math.max(r,a.clipMin[t]),e({clipMax:s})};return o.jsxs(o.Fragment,{children:[o.jsx(z,{label:"Render mode",value:a.renderMode,onChange:t=>e({renderMode:t}),options:Ke}),a.renderMode==="iso"&&o.jsx(T,{label:"Isovalue",value:a.isovalue,onChange:t=>e({isovalue:t}),min:0,max:1,step:.01,format:t=>t.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),o.jsx(z,{label:"Colormap",value:a.colormap,onChange:t=>e({colormap:t}),options:ea}),o.jsx(z,{label:"Quality",value:String(a.steps),onChange:t=>e({steps:Number(t)}),options:aa,description:"Raymarch step count — higher is finer but slower"}),o.jsx(z,{label:"Background",value:a.background,onChange:t=>e({background:t}),options:ta}),o.jsx(fe,{label:"Show axes",checked:!!a.showAxes,onChange:t=>e({showAxes:t}),description:"Colored XYZ origin lines + grid, sized to the fitted view"}),o.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[o.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),o.jsx(T,{label:"Clip X min",value:a.clipMin[0],onChange:t=>i(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(T,{label:"Clip X max",value:a.clipMax[0],onChange:t=>n(0,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(T,{label:"Clip Y min",value:a.clipMin[1],onChange:t=>i(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(T,{label:"Clip Y max",value:a.clipMax[1],onChange:t=>n(1,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(T,{label:"Clip Z min",value:a.clipMin[2],onChange:t=>i(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)}),o.jsx(T,{label:"Clip Z max",value:a.clipMax[2],onChange:t=>n(2,t),min:0,max:1,step:.01,format:t=>t.toFixed(2)})]})]})}const ae={kind:"camera3d",position:[0,0,5],target:[0,0,0],zoom:1},oa={objectType:"volume",capabilities:Ye,useData:He,defaultSettings:ne,migrateSettings:Qe,viewFromSettings:()=>ae,viewToSettingsPatch:()=>({}),defaultView:()=>ae,onResetView:a=>Oe(a),Pane:Je,SettingsControls:ia,nativeDiff:{render:Ge},activeColorbar:We};function la(a){return o.jsx(de,{...a,viewport:oa})}export{ra as VolumeForeignFrame,la as default,oa as volumeViewportModule};

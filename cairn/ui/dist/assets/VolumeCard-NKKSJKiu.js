import{w as t,r as p,a7 as Fe,u as Be,a as Le,a0 as ze,a1 as Ve,b as xe,d as Ue,e as pe,q as Xe,f as Ge,i as ae,m as qe,j as $e,k as We,l as He,t as ce,s as Se,C as Ke,x as V,J as F,T as Qe,A as Ye,B as Ze,D as Je,R as et,F as ue,G as ye,M as _e,a2 as Te,a3 as tt,a4 as at,h as nt,E as st,a5 as ot}from"./index-CsRe86AG.js";import{u as it,l as rt,R as lt,U as Pe,m as te,n as X,V as de,o as ct,p as ut,G as dt,q as mt,j as pt,s as ft,t as xt,c as ht,d as vt,C as gt,r as bt,i as Mt,O as Ct,f as St,v as yt,w as jt}from"./diff-C_cB6wnb.js";const Dt={dark:856343,light:16185594},je=256;let U=null;function _t(){if(U!==null)return U;try{const n=document.createElement("canvas").getContext("webgl2");if(n){const s=n.getExtension("WEBGL_lose_context");s==null||s.loseContext()}U=!!n}catch{U=!1}return U}function Tt({className:o}){return t.jsx("div",{className:o??"relative h-full w-full",children:t.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[t.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),t.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function Pt(o,n,s){const d=s-n||1,u=new Uint8Array(o.length);for(let x=0;x<o.length;x++){const l=(o[x]-n)/d;u[x]=Math.max(0,Math.min(255,Math.round(l*255)))}return u}function De(o){const n=Fe(o),s=new Uint8Array(256*4);for(let u=0;u<256;u++)s[u*4]=n[u*3],s[u*4+1]=n[u*3+1],s[u*4+2]=n[u*3+2],s[u*4+3]=255;const d=new ft(s,256,1,xt,Pe);return d.minFilter=te,d.magFilter=te,d.wrapS=X,d.wrapT=X,d.needsUpdate=!0,d}const Rt=`precision highp float;

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
`,Nt=`precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${je}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${je};
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
`;function At(o,n,s){const[d,u,x]=o,l=x*n[2],a=u*n[1],r=d*n[0],c=s[2],g=s[1],y=s[0];return{scale:[l,a,r],position:[c+l/2,g+a/2,y+r/2],bounds:{min:[c,g,y],max:[c+l,g+a,y+r]}}}function wt({data:o,shape:n,spacing:s,origin:d,vmin:u,vmax:x,mode:l,isovalue:a,colormap:r,steps:c,clip:g,background:y,className:h,sync:R=null,onFrame:T}){const{containerRef:E,canvasRef:j,requestRender:w,fitToBounds:N,refs:P}=it({background:Dt[y],sync:R,onFrame:T}),m=p.useRef(null),M=p.useRef(null),C=p.useRef(null),k=p.useRef(null),O=p.useRef(null);return p.useEffect(()=>{var H,K,Q,Y;const D=P.scene.current;if(!D)return;m.current&&(D.remove(m.current),(H=M.current)==null||H.dispose(),(K=C.current)==null||K.dispose(),(Q=k.current)==null||Q.dispose(),(Y=O.current)==null||Y.dispose());const[b,S,A]=n,_=Pt(o,u,x),f=new rt(_,A,S,b);f.format=lt,f.type=Pe,f.minFilter=te,f.magFilter=te,f.wrapR=X,f.wrapS=X,f.wrapT=X,f.needsUpdate=!0;const G=De(r),ne={uData:{value:f},uLUT:{value:G},uMode:{value:l==="mip"?0:1},uSteps:{value:c},uIsovalue:{value:a},uClipMin:{value:new de(...g.min)},uClipMax:{value:new de(...g.max)},uTexelSize:{value:new de(1/A,1/S,1/b)}},L=new ct({glslVersion:dt,vertexShader:Rt,fragmentShader:Nt,uniforms:ne,side:ut,transparent:!1}),q=new mt(1,1,1),B=new pt(q,L),{scale:$,position:se,bounds:W}=At(n,s,d);B.scale.set(...$),B.position.set(...se),D.add(B),m.current=B,M.current=q,C.current=L,k.current=f,O.current=G,N(W)},[o,n,s,d,u,x]),p.useEffect(()=>{var S;const D=C.current;if(!D)return;(S=O.current)==null||S.dispose();const b=De(r);O.current=b,D.uniforms.uLUT.value=b,w()},[r]),p.useEffect(()=>{const D=C.current;if(!D)return;const b=D.uniforms;b.uMode.value=l==="mip"?0:1,b.uSteps.value=c,b.uIsovalue.value=a,b.uClipMin.value.set(...g.min),b.uClipMax.value.set(...g.max),w()},[l,a,c,g]),p.useEffect(()=>()=>{var D,b,S,A;(D=M.current)==null||D.dispose(),(b=C.current)==null||b.dispose(),(S=k.current)==null||S.dispose(),(A=O.current)==null||A.dispose()},[]),t.jsx("div",{ref:E,className:h??"relative h-full w-full",children:t.jsx("canvas",{ref:j,className:"block h-full w-full rounded"})})}function ee(o){return _t()?t.jsx(wt,{...o}):t.jsx(Tt,{className:o.className})}const kt=o=>({version:1,metrics:[o],mode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark"}),me=4,Ot=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],It=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],Et=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],Ft=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}],Bt=[{value:"diff-value",label:"Diff: value (native)"}];function fe(o){return st({queryKey:["volume-npz",o],enabled:!!o,staleTime:1/0,queryFn:async()=>{const n=await fetch(pe.artifactUrl(o));if(!n.ok)throw new Error(`failed to fetch volume (${n.status})`);const s=await ot(await n.arrayBuffer());if(!s.data)throw new Error("volume artifact is missing its 'data' array");return Float32Array.from(s.data.data)}})}function he({hash:o,meta:n,view:s,fill:d}){const u=fe(o);return o?u.isLoading?t.jsx("div",{className:d?"flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover":"h-64 motion-safe:animate-pulse rounded bg-bg-hover"}):u.isError||!u.data||!n?t.jsx("div",{className:"text-sm text-fg-muted",children:"failed to load volume"}):t.jsxs("div",{className:d?"flex flex-1 min-h-0 flex-col":"flex flex-col",children:[t.jsxs("div",{className:d?"flex flex-1 min-h-0":"flex h-64",children:[t.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:t.jsx(ee,{data:u.data,shape:n.shape,spacing:n.spacing,origin:n.origin,vmin:n.vmin,vmax:n.vmax,mode:s.mode,isovalue:s.isovalue,colormap:s.colormap,steps:s.steps,clip:{min:s.clipMin,max:s.clipMax},background:s.background,sync:s.sync})}),t.jsx(Te,{colormap:s.colormap,min:n.vmin,max:n.vmax})]}),t.jsxs("div",{className:"mono mt-1 text-xs text-fg-subtle",children:[`${n.shape.join("×")} · vmin ${n.vmin.toFixed(3)} · vmax ${n.vmax.toFixed(3)}`," · double-click to re-fit"]})]}):t.jsx("div",{className:"text-sm text-fg-muted",children:"no volume logged yet"})}function Lt({runId:o,m:n,targetStep:s,view:d}){const u=n.runId??o,x=xe(u,n.name,{context:n.context_hash||void 0,maxPoints:500}),l=p.useMemo(()=>{var c;return(((c=x.data)==null?void 0:c.points)??[]).filter(g=>g.artifact_hash)},[x.data]),a=p.useMemo(()=>nt(l,s)??l[0],[l,s]),r=p.useMemo(()=>ae(a==null?void 0:a.artifact_metadata),[a]);return x.isLoading?t.jsx("div",{className:"h-64 motion-safe:animate-pulse rounded bg-bg-hover"}):t.jsx("div",{className:"rounded bg-bg p-2",children:t.jsx(he,{hash:(a==null?void 0:a.artifact_hash)??void 0,meta:r,view:d})})}function zt({runId:o,primaryHash:n,primaryMeta:s,referenceTag:d,referenceHash:u,mode:x,view:l,settings:a,updateSettings:r,paneLabel:c}){const g=xe(d.runId??o,d.name,{context:d.context_hash||void 0,maxPoints:500}),y=p.useMemo(()=>{var M;return(((M=g.data)==null?void 0:M.points)??[]).find(C=>C.artifact_hash===u)},[g.data,u]),h=p.useMemo(()=>ae(y==null?void 0:y.artifact_metadata),[y]),R=fe(n),T=fe(u);if(x==="normal")return t.jsx("div",{className:"absolute inset-0 flex flex-col",children:t.jsx(he,{hash:n,meta:s,view:l,fill:!0})});if(!R.data||!T.data||!s||!h)return t.jsx("div",{className:"absolute inset-0 motion-safe:animate-pulse rounded bg-bg-hover"});if(Mt(x)&&(x==="split"||x==="blend"||x==="diff"))return t.jsx("div",{className:"absolute inset-0 flex overflow-hidden rounded bg-bg",children:t.jsx(Ct,{mode:x,renderPrimary:(M,C)=>t.jsx(ee,{data:R.data,shape:s.shape,spacing:s.spacing,origin:s.origin,vmin:s.vmin,vmax:s.vmax,mode:l.mode,isovalue:l.isovalue,colormap:l.colormap,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,sync:C,onFrame:M}),renderReference:(M,C)=>t.jsx(ee,{data:T.data,shape:h.shape,spacing:h.spacing,origin:h.origin,vmin:h.vmin,vmax:h.vmax,mode:l.mode,isovalue:l.isovalue,colormap:l.colormap,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,sync:C,onFrame:M}),diffSubmode:a.diffSubmode??"signed",colormap:a.diffColormap??"viridis",splitPosition:a.splitPosition??.5,onSplitPositionChange:M=>r({splitPosition:M}),blendAlpha:a.blendAlpha??.5,primaryLabel:c})});if(!(s.shape[0]===h.shape[0]&&s.shape[1]===h.shape[1]&&s.shape[2]===h.shape[2]))return t.jsxs("div",{className:"absolute inset-0 flex items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted",children:["Shape mismatch: ",s.shape.join("×")," vs ",h.shape.join("×")," — native diff needs matching voxel grid shape."]});const j=a.diffColormap??"viridis",w=s.shape[0]*s.shape[1]*s.shape[2],N=St(R.data,T.data,w),P=yt(N,j),m=j==="viridis"?jt(N):N;return t.jsxs("div",{className:"absolute inset-0 flex overflow-hidden rounded bg-bg",children:[t.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:t.jsx(ee,{data:m,shape:s.shape,spacing:s.spacing,origin:s.origin,vmin:P[0],vmax:P[1],mode:l.mode,isovalue:l.isovalue,colormap:j,steps:l.steps,clip:{min:l.clipMin,max:l.clipMax},background:l.background,sync:l.sync})}),t.jsx(Te,{colormap:j,min:P[0],max:P[1]})]})}function Vt({runId:o,panes:n,paneKeys:s,paneLabels:d,perSeriesStepMap:u,perSeriesPoints:x,currentStep:l,safeIdx:a,view:r,settings:c,updateSettings:g,inModal:y}){const h=c.externalBaseline,R=c.referenceMode??"global",T=h!=null,{perPaneHash:E}=tt({runId:o,perSeriesStepMap:u,perSeriesPoints:x,seriesBaselineIndex:T?void 0:n.length>=2?1:void 0,seriesBaselineFixedStep:c.refFixedStep,external:h,externalScope:R,panes:n,currentStep:l,safeIdx:a}),j=n.map((m,M)=>M).filter(m=>!(T&&R==="global"&&h&&n[m].name===h.name&&(n[m].runId??o)===(h.runId??o)||!T&&m===1)),w=c.compareMode??"side",N=j.map(m=>s[m]),P=new Map(j.map(m=>[s[m],{runId:n[m].runId??o,name:n[m].name,context_hash:n[m].context_hash}]));return t.jsx(_e,{paneKeys:N,labels:d,inModal:y,onPaneWidthsChange:()=>{},dragTags:P,renderPane:(m,M)=>{const C=j[M],k=u[C]??new Map,O=(x[C]??[]).map(f=>f.step),{hash:D}=at(k,l,O),b=(x[C]??[]).find(f=>f.artifact_hash===D),S=ae(b==null?void 0:b.artifact_metadata),A=E(C),_=T?R==="per-run"?{runId:n[C].runId??o,name:h.name,context_hash:h.context_hash}:{runId:h.runId??o,name:h.name,context_hash:h.context_hash}:{runId:n[1].runId??o,name:n[1].name,context_hash:n[1].context_hash};return t.jsx(zt,{runId:o,primaryHash:D,primaryMeta:S,referenceTag:_,referenceHash:A,mode:w,view:r,settings:c,updateSettings:g,paneLabel:n[C].name},s[C])}})}function Gt({runId:o,metric:n,extraSeries:s,controlledSeries:d,settingsKeyOverride:u,onRemove:x,autoOpenSettings:l}){var Ce;const{settings:a,updateSettings:r,effectiveMetrics:c,allRunIds:g,multipleRuns:y}=Be({runId:o,metric:n,extraSeries:s,controlledSeries:d,settingsKeyOverride:u,makeDefaults:(e,i)=>({...kt(e),metrics:i})}),{highlight:h,dropProps:R}=Le(c,r),T=p.useCallback((e,i)=>{r({externalBaseline:{runId:e.runId,name:e.name,context_hash:e.context_hash},referenceMode:i,compareMode:"diff"})},[r]),{highlight:E,dropProps:j}=ze({onSeriesDrop:e=>T(e,"per-run"),onViewportDrop:e=>T(e,"global")}),w=Ve(!!a.syncViews),N={mode:a.mode,isovalue:a.isovalue,colormap:a.colormap,steps:a.steps,clipMin:a.clipMin,clipMax:a.clipMax,background:a.background,sync:w?{groupId:w}:null},P=xe(o,n.name,{context:n.context_hash||void 0,maxPoints:500}),m=p.useMemo(()=>{var e;return(((e=P.data)==null?void 0:e.points)??[]).filter(i=>i.artifact_hash)},[P.data]),M=Ue({queries:c.length>1?c.map(e=>{const i=e.runId??o;return{queryKey:Xe.sequence(i,e.name,e.context_hash),queryFn:()=>pe.sequence(i,e.name,{context:e.context_hash||void 0,maxPoints:500}),refetchInterval:2e3,staleTime:2e3}}):[]}),C=p.useMemo(()=>{var i;const e=[m];if(c.length>1)for(const v of M){const le=((i=v.data)==null?void 0:i.points)??[];e.push(le.filter(Ee=>Ee.artifact_hash))}return e},[c.length,m,M]),k=p.useMemo(()=>c.length<=1?[m]:M.map(e=>{var i;return(((i=e.data)==null?void 0:i.points)??[]).filter(v=>v.artifact_hash)}),[c.length,m,M]),O=p.useMemo(()=>k.map(e=>{const i=new Map;for(const v of e)i.set(v.step,v);return i}),[k]),{globalSteps:D,safeIdx:b,currentStep:S,onSliderChange:A}=Ge({seriesPoints:C,persistedIdx:a.sliderStep,updateSettings:r}),_=p.useMemo(()=>{const e=m.find(v=>v.step===S&&v.artifact_hash);if(e)return e;let i;for(const v of m)if(v.step<=S&&v.artifact_hash)i=v;else if(v.step>S)break;return i},[m,S]),f=p.useMemo(()=>ae(_==null?void 0:_.artifact_metadata),[_]),G=p.useMemo(()=>((f==null?void 0:f.properties)??[]).map(e=>e.name),[f]),[ne,L]=p.useState(l??!1),q=p.useMemo(()=>[{runId:o,name:n.name,context_hash:n.context_hash}],[o,n.name,n.context_hash]),B=qe(),{selectedIds:$,selectedArray:se,toggle:W,clear:H}=$e(),K=We(),{runInfoMap:Q}=He(g),Y=f?`${f.shape.join("×")} · spacing [${f.spacing.map(e=>e.toFixed(2)).join(", ")}]`:`${n.count} step${n.count!==1?"s":""}`,z=a.externalBaseline!=null,ve=c.length>1||z,oe=z||c.length>=2,ge=p.useRef(null),I=p.useMemo(()=>c.slice(0,me),[c]),be=p.useMemo(()=>I.map(ce),[I]),Z=p.useMemo(()=>{const e=new Map;if(y)for(const i of I)e.set(ce(i),Se(i.runId??o,g));return e},[y,I,g,o,B]),Re=p.useMemo(()=>{const e=new Map;for(const i of I){const v=ce(i);Z.has(v)&&e.set(v,{runId:i.runId??o,name:i.name,context_hash:i.context_hash})}return e},[I,Z,o]),J=ht(!z&&oe?(Ce=M[1])==null?void 0:Ce.data:void 0,a.refFixedStep,S),Ne=z||!!f&&!!J&&f.shape[0]===J.shape[0]&&f.shape[1]===J.shape[1]&&f.shape[2]===J.shape[2],Ae=()=>P.isLoading?t.jsx("div",{className:"flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover"}):t.jsxs(t.Fragment,{children:[t.jsx(he,{hash:(_==null?void 0:_.artifact_hash)??void 0,meta:f,view:N,fill:!0}),t.jsx(ue,{points:m,currentIndex:b,onChange:A,xAxis:a.xAxis,onXAxisChange:e=>r({xAxis:e}),className:"mt-3"})]}),we=e=>t.jsxs(t.Fragment,{children:[c.length>me&&t.jsx("div",{className:"mono mb-2 text-xs text-fg-subtle",children:`showing ${me} of ${c.length}`}),t.jsx(_e,{paneKeys:be,labels:Z,inModal:e,paneWidths:a.paneWidths,onPaneWidthsChange:i=>r({paneWidths:i}),dragTags:Re,renderPane:(i,v)=>{const le=I[v];return t.jsx(Lt,{runId:o,m:le,targetStep:S,view:N},i)}}),t.jsx(ue,{points:m,currentIndex:b,onChange:A,xAxis:a.xAxis,onXAxisChange:i=>r({xAxis:i}),className:"mt-3"}),t.jsx(ye,{metrics:c,controlledSeries:d,runId:o,allRunIds:g,onMetricsChange:i=>r({metrics:i}),onClick:y?W:void 0,selectedIds:$})]}),ke=e=>t.jsxs(t.Fragment,{children:[t.jsx(Vt,{runId:o,panes:I,paneKeys:be,paneLabels:Z,perSeriesStepMap:O,perSeriesPoints:k,currentStep:S,safeIdx:b,view:N,settings:a,updateSettings:r,inModal:e}),t.jsx(ue,{points:m,currentIndex:b,onChange:A,xAxis:a.xAxis,onXAxisChange:i=>r({xAxis:i}),className:"mt-3"}),t.jsx(ye,{metrics:c,controlledSeries:d,runId:o,allRunIds:g,onMetricsChange:i=>r({metrics:i}),onClick:y?W:void 0,selectedIds:$})]}),Oe=oe&&!!a.compareMode&&a.compareMode!=="side",Me=e=>ve?Oe?ke(e):we(e):Ae(),Ie=!K&&t.jsx(et,{selectedRunIds:se,allRunIds:g,onClear:H,runInfo:Q,label:"Volume selection"}),ie=(e,i)=>{const v=[...a.clipMin];v[e]=Math.min(i,a.clipMax[e]),r({clipMin:v})},re=(e,i)=>{const v=[...a.clipMax];v[e]=Math.max(i,a.clipMin[e]),r({clipMax:v})};return t.jsx(Ke,{cardKind:"volume",defaultHeight:380,cardRef:ge,settings:a,updateSettings:r,title:n.name,subtitle:Y,onSettings:()=>L(!0),onRemove:x,onDownload:_!=null&&_.artifact_hash?()=>Ze(pe.artifactUrl(_.artifact_hash),Je(n.name,_.step,_.artifact_mime,".npz")):void 0,addToComparisonSlot:t.jsx(Ye,{cardType:"volume",series:q}),onResetView:()=>bt(ge.current),viewModified:!0,dropHighlight:h,dropProps:R,selectionPanel:Ie,settingsPanel:t.jsxs(t.Fragment,{children:[t.jsx(V,{label:"Render mode",value:a.mode,onChange:e=>r({mode:e}),options:Ot}),a.mode==="iso"&&t.jsx(F,{label:"Isovalue",value:a.isovalue,onChange:e=>r({isovalue:e}),min:0,max:1,step:.01,format:e=>e.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),t.jsx(V,{label:"Colormap",value:a.colormap,onChange:e=>r({colormap:e}),options:It}),t.jsx(vt,{properties:G,value:a.property??null,onChange:e=>r({property:e})}),t.jsx(V,{label:"Quality",value:String(a.steps),onChange:e=>r({steps:Number(e)}),options:Et,description:"Raymarch step count — higher is finer but slower"}),t.jsx(V,{label:"Background",value:a.background,onChange:e=>r({background:e}),options:Ft}),t.jsx(Qe,{label:"Sync 3D views",checked:!!a.syncViews,onChange:e=>r({syncViews:e}),description:"Share orbit/zoom/pan live with this card's other panes and any other sync-enabled 3D card on this page"}),t.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[t.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),t.jsx(F,{label:"Clip X min",value:a.clipMin[0],onChange:e=>ie(0,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.jsx(F,{label:"Clip X max",value:a.clipMax[0],onChange:e=>re(0,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.jsx(F,{label:"Clip Y min",value:a.clipMin[1],onChange:e=>ie(1,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.jsx(F,{label:"Clip Y max",value:a.clipMax[1],onChange:e=>re(1,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.jsx(F,{label:"Clip Z min",value:a.clipMin[2],onChange:e=>ie(2,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.jsx(F,{label:"Clip Z max",value:a.clipMax[2],onChange:e=>re(2,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)})]}),oe&&t.jsx(gt,{mode:a.compareMode??"side",onModeChange:e=>r({compareMode:e}),nativeModes:Bt,topologyOk:Ne,topologyHint:"Native diff needs the same voxel grid shape — disabled for this pair",diffColormap:a.diffColormap??"viridis",onDiffColormapChange:e=>r({diffColormap:e}),diffSubmode:a.diffSubmode??"signed",onDiffSubmodeChange:e=>r({diffSubmode:e}),splitPosition:a.splitPosition??.5,onSplitPositionChange:e=>r({splitPosition:e}),blendAlpha:a.blendAlpha??.5,onBlendAlphaChange:e=>r({blendAlpha:e}),refFixedStep:a.refFixedStep,onRefFixedStepChange:e=>r({refFixedStep:e}),currentStep:S,maxStep:Math.max(...D,1)}),ve&&z&&t.jsx(V,{label:"Reference mode",value:a.referenceMode??"global",onChange:e=>r({referenceMode:e}),options:[{value:"per-run",label:"Per-run (each run uses its own copy of the ref tag)"},{value:"global",label:"Global (same ref for all runs)"}]}),t.jsxs("div",{className:"mt-2",children:[t.jsx("label",{className:"block text-[10px] uppercase tracking-wide text-fg-muted mb-1",children:"Reference source"}),a.externalBaseline?t.jsxs("div",{className:"flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted",children:[t.jsxs("span",{className:"mono truncate flex-1",children:[a.externalBaseline.name,a.externalBaseline.runId&&a.externalBaseline.runId!==o?` · ${Se(a.externalBaseline.runId,g)}`:""]}),t.jsx("button",{type:"button",onClick:()=>r({externalBaseline:void 0,referenceMode:void 0}),className:"text-fg-subtle hover:text-fg shrink-0",title:"Remove external reference",children:"×"})]}):t.jsx("p",{className:"text-[10px] text-fg-subtle mb-1",children:"Drag a series chip onto the card (per-run), or drag a pane's viewport label onto it (global)."})]})]}),modalOpen:ne,onModalClose:()=>L(!1),modalContent:t.jsx("div",{className:`flex flex-col h-full${E?" outline outline-2 outline-accent -outline-offset-2":""}`,onDragOver:j.onDragOver,onDragLeave:j.onDragLeave,onDrop:j.onDrop,children:Me(!0)}),scrollIntoViewOnMount:l,children:t.jsx("div",{className:`flex flex-1 min-h-0 flex-col${E?" outline outline-2 outline-accent -outline-offset-2":""}`,onDragOver:j.onDragOver,onDragLeave:j.onDragLeave,onDrop:j.onDrop,children:Me(!1)})})}export{Gt as default};

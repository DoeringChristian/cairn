import{v as a,r as c,a4 as Oe,u as Ae,a as ke,$ as Ie,b as K,d as we,e as ue,q as Ee,f as ze,i as X,m as Le,j as Ve,k as Be,l as Ue,o as ge,s as qe,h as Se,C as Xe,w as I,H as N,T as be,A as Ge,z as We,B as $e,R as He,E as le,F as Me,M as Qe,a0 as je,a1 as Ye,D as Ke,a2 as Ze}from"./index-CnQ2IwI1.js";import{u as Je,k as ea,R as aa,U as De,l as Z,C as q,V as ce,m as ta,n as sa,G as oa,o as na,i as ia,p as ra,q as la,c as ca,d as da,O as ua,f as ma,r as pa,s as fa}from"./diff-B68lqDDv.js";const xa={dark:856343,light:16185594},ye=256;let U=null;function ha(){if(U!==null)return U;try{const s=document.createElement("canvas").getContext("webgl2");if(s){const i=s.getExtension("WEBGL_lose_context");i==null||i.loseContext()}U=!!s}catch{U=!1}return U}function va({className:o}){return a.jsx("div",{className:o??"relative h-full w-full",children:a.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[a.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),a.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function ga(o,s,i){const p=i-s||1,n=new Uint8Array(o.length);for(let x=0;x<o.length;x++){const b=(o[x]-s)/p;n[x]=Math.max(0,Math.min(255,Math.round(b*255)))}return n}function Ce(o){const s=Oe(o),i=new Uint8Array(256*4);for(let n=0;n<256;n++)i[n*4]=s[n*3],i[n*4+1]=s[n*3+1],i[n*4+2]=s[n*3+2],i[n*4+3]=255;const p=new ra(i,256,1,la,De);return p.minFilter=Z,p.magFilter=Z,p.wrapS=q,p.wrapT=q,p.needsUpdate=!0,p}const ba=`precision highp float;

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
`,Ma=`precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${ye}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${ye};
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
`;function ya(o,s,i){const[p,n,x]=o,b=x*s[2],t=n*s[1],r=p*s[0],u=i[2],v=i[1],S=i[0];return{scale:[b,t,r],position:[u+b/2,v+t/2,S+r/2],bounds:{min:[u,v,S],max:[u+b,v+t,S+r]}}}function Ca({data:o,shape:s,spacing:i,origin:p,vmin:n,vmax:x,mode:b,isovalue:t,colormap:r,steps:u,clip:v,background:S,className:w,sync:A=null,onFrame:O}){const{containerRef:h,canvasRef:y,requestRender:j,fitToBounds:P,refs:R}=Je({background:xa[S],sync:A,onFrame:O}),z=c.useRef(null),D=c.useRef(null),C=c.useRef(null),_=c.useRef(null),f=c.useRef(null);return c.useEffect(()=>{var E,W,F,$;const m=R.scene.current;if(!m)return;z.current&&(m.remove(z.current),(E=D.current)==null||E.dispose(),(W=C.current)==null||W.dispose(),(F=_.current)==null||F.dispose(),($=f.current)==null||$.dispose());const[l,M,k]=s,J=ga(o,n,x),T=new ea(J,k,M,l);T.format=aa,T.type=De,T.minFilter=Z,T.magFilter=Z,T.wrapR=q,T.wrapS=q,T.wrapT=q,T.needsUpdate=!0;const V=Ce(r),ee={uData:{value:T},uLUT:{value:V},uMode:{value:b==="mip"?0:1},uSteps:{value:u},uIsovalue:{value:t},uClipMin:{value:new ce(...v.min)},uClipMax:{value:new ce(...v.max)},uTexelSize:{value:new ce(1/k,1/M,1/l)}},B=new ta({glslVersion:oa,vertexShader:ba,fragmentShader:Ma,uniforms:ee,side:sa,transparent:!1}),G=new na(1,1,1),L=new ia(G,B),{scale:ae,position:te,bounds:se}=ya(s,i,p);L.scale.set(...ae),L.position.set(...te),m.add(L),z.current=L,D.current=G,C.current=B,_.current=T,f.current=V,P(se)},[o,s,i,p,n,x]),c.useEffect(()=>{var M;const m=C.current;if(!m)return;(M=f.current)==null||M.dispose();const l=Ce(r);f.current=l,m.uniforms.uLUT.value=l,j()},[r]),c.useEffect(()=>{const m=C.current;if(!m)return;const l=m.uniforms;l.uMode.value=b==="mip"?0:1,l.uSteps.value=u,l.uIsovalue.value=t,l.uClipMin.value.set(...v.min),l.uClipMax.value.set(...v.max),j()},[b,t,u,v]),c.useEffect(()=>()=>{var m,l,M,k;(m=D.current)==null||m.dispose(),(l=C.current)==null||l.dispose(),(M=_.current)==null||M.dispose(),(k=f.current)==null||k.dispose()},[]),a.jsx("div",{ref:h,className:w??"relative h-full w-full",children:a.jsx("canvas",{ref:y,className:"block h-full w-full rounded"})})}function Y(o){return ha()?a.jsx(Ca,{...o}):a.jsx(va,{className:o.className})}const Sa=o=>({version:1,metrics:[o],mode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark"}),de=4,ja=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],Da=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],Ta=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],_a=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}],Pa=[{value:"red-green",label:"Red–green (signed)"},{value:"viridis",label:"Viridis (magnitude)"}],Ra=[{value:"signed",label:"Signed"},{value:"absolute",label:"Absolute"},{value:"squared",label:"Squared"},{value:"relative_signed",label:"Relative signed"},{value:"relative_absolute",label:"Relative absolute"},{value:"relative_squared",label:"Relative squared"}];function Fa(o){return[{value:"side",label:"Side by side (default)"},{value:"normal",label:"Normal (primary only)"},{value:"split",label:"Split (image-space)"},{value:"blend",label:"Blend (image-space)"},{value:"diff",label:"Pixel diff (image-space)"},{value:"diff-value",label:"Diff: value (native)",disabled:!o}]}function me(o){return Ke({queryKey:["volume-npz",o],enabled:!!o,staleTime:1/0,queryFn:async()=>{const s=await fetch(ue.artifactUrl(o));if(!s.ok)throw new Error(`failed to fetch volume (${s.status})`);const i=await Ze(await s.arrayBuffer());if(!i.data)throw new Error("volume artifact is missing its 'data' array");return Float32Array.from(i.data.data)}})}function pe({hash:o,meta:s,view:i}){const p=me(o);return o?p.isLoading?a.jsx("div",{className:"h-64 motion-safe:animate-pulse rounded bg-bg-hover"}):p.isError||!p.data||!s?a.jsx("div",{className:"text-sm text-fg-muted",children:"failed to load volume"}):a.jsxs("div",{className:"flex flex-col",children:[a.jsxs("div",{className:"flex h-64",children:[a.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:a.jsx(Y,{data:p.data,shape:s.shape,spacing:s.spacing,origin:s.origin,vmin:s.vmin,vmax:s.vmax,mode:i.mode,isovalue:i.isovalue,colormap:i.colormap,steps:i.steps,clip:{min:i.clipMin,max:i.clipMax},background:i.background,sync:i.sync})}),a.jsx(je,{colormap:i.colormap,min:s.vmin,max:s.vmax})]}),a.jsxs("div",{className:"mono mt-1 text-xs text-fg-subtle",children:[`${s.shape.join("×")} · vmin ${s.vmin.toFixed(3)} · vmax ${s.vmax.toFixed(3)}`," · double-click to re-fit"]})]}):a.jsx("div",{className:"text-sm text-fg-muted",children:"no volume logged yet"})}function Na({runId:o,m:s,targetStep:i,view:p}){const n=s.runId??o,x=K(n,s.name,{context:s.context_hash||void 0,maxPoints:500}),b=c.useMemo(()=>{var u;return(((u=x.data)==null?void 0:u.points)??[]).filter(v=>v.artifact_hash)},[x.data]),t=c.useMemo(()=>Se(b,i)??b[0],[b,i]),r=c.useMemo(()=>X(t==null?void 0:t.artifact_metadata),[t]);return x.isLoading?a.jsx("div",{className:"h-64 motion-safe:animate-pulse rounded bg-bg-hover"}):a.jsx("div",{className:"rounded bg-bg p-2",children:a.jsx(pe,{hash:(t==null?void 0:t.artifact_hash)??void 0,meta:r,view:p})})}function Oa({runId:o,primaryMetric:s,referenceMetric:i,currentStep:p,view:n,settings:x,updateSettings:b}){const t=K(s.runId??o,s.name,{context:s.context_hash||void 0,maxPoints:500}),r=K(i.runId??o,i.name,{context:i.context_hash||void 0,maxPoints:500}),u=c.useMemo(()=>{var l;return(((l=t.data)==null?void 0:l.points)??[]).filter(M=>M.artifact_hash)},[t.data]),v=c.useMemo(()=>{var l;return(((l=r.data)==null?void 0:l.points)??[]).filter(M=>M.artifact_hash)},[r.data]),{primaryHash:S,referenceHash:w}=da({primaryPoints:u,referencePoints:v,currentStep:p,refFixedStep:x.refFixedStep}),A=c.useMemo(()=>u.find(l=>l.artifact_hash===S),[u,S]),O=c.useMemo(()=>v.find(l=>l.artifact_hash===w),[v,w]),h=c.useMemo(()=>X(A==null?void 0:A.artifact_metadata),[A]),y=c.useMemo(()=>X(O==null?void 0:O.artifact_metadata),[O]),j=me(S),P=me(w),R=x.compareMode??"side";if(R==="normal")return a.jsx(pe,{hash:S,meta:h,view:n});if(!j.data||!P.data||!h||!y)return a.jsx("div",{className:"h-64 motion-safe:animate-pulse rounded bg-bg-hover"});if(Ye(R)&&(R==="split"||R==="blend"||R==="diff"))return a.jsx("div",{className:"h-64 overflow-hidden rounded bg-bg",children:a.jsx(ua,{mode:R,renderPrimary:(l,M)=>a.jsx(Y,{data:j.data,shape:h.shape,spacing:h.spacing,origin:h.origin,vmin:h.vmin,vmax:h.vmax,mode:n.mode,isovalue:n.isovalue,colormap:n.colormap,steps:n.steps,clip:{min:n.clipMin,max:n.clipMax},background:n.background,sync:M,onFrame:l}),renderReference:(l,M)=>a.jsx(Y,{data:P.data,shape:y.shape,spacing:y.spacing,origin:y.origin,vmin:y.vmin,vmax:y.vmax,mode:n.mode,isovalue:n.isovalue,colormap:n.colormap,steps:n.steps,clip:{min:n.clipMin,max:n.clipMax},background:n.background,sync:M,onFrame:l}),diffSubmode:x.diffSubmode??"signed",colormap:x.diffColormap??"viridis",splitPosition:x.splitPosition??.5,onSplitPositionChange:l=>b({splitPosition:l}),blendAlpha:x.blendAlpha??.5,primaryLabel:s.name})});if(!(h.shape[0]===y.shape[0]&&h.shape[1]===y.shape[1]&&h.shape[2]===y.shape[2]))return a.jsxs("div",{className:"flex h-64 items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted",children:["Shape mismatch: ",h.shape.join("×")," vs ",y.shape.join("×")," — native diff needs matching voxel grid shape."]});const D=x.diffColormap??"viridis",C=h.shape[0]*h.shape[1]*h.shape[2],_=ma(j.data,P.data,C),f=pa(_,D),m=D==="viridis"?fa(_):_;return a.jsxs("div",{className:"flex h-64 overflow-hidden rounded bg-bg",children:[a.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:a.jsx(Y,{data:m,shape:h.shape,spacing:h.spacing,origin:h.origin,vmin:f[0],vmax:f[1],mode:n.mode,isovalue:n.isovalue,colormap:D,steps:n.steps,clip:{min:n.clipMin,max:n.clipMax},background:n.background,sync:n.sync})}),a.jsx(je,{colormap:D,min:f[0],max:f[1]})]})}function Ia({runId:o,metric:s,extraSeries:i,controlledSeries:p,settingsKeyOverride:n,onRemove:x,autoOpenSettings:b}){const{settings:t,updateSettings:r,effectiveMetrics:u,allRunIds:v,multipleRuns:S}=Ae({runId:o,metric:s,extraSeries:i,controlledSeries:p,settingsKeyOverride:n,makeDefaults:(e,d)=>({...Sa(e),metrics:d})}),{highlight:w,dropProps:A}=ke(u,r),O=Ie(!!t.syncViews),h={mode:t.mode,isovalue:t.isovalue,colormap:t.colormap,steps:t.steps,clipMin:t.clipMin,clipMax:t.clipMax,background:t.background,sync:O?{groupId:O}:null},y=K(o,s.name,{context:s.context_hash||void 0,maxPoints:500}),j=c.useMemo(()=>{var e;return(((e=y.data)==null?void 0:e.points)??[]).filter(d=>d.artifact_hash)},[y.data]),P=we({queries:u.length>1?u.map(e=>{const d=e.runId??o;return{queryKey:Ee.sequence(d,e.name,e.context_hash),queryFn:()=>ue.sequence(d,e.name,{context:e.context_hash||void 0,maxPoints:500}),refetchInterval:2e3,staleTime:2e3}}):[]}),R=c.useMemo(()=>{var d;const e=[j];if(u.length>1)for(const g of P){const re=((d=g.data)==null?void 0:d.points)??[];e.push(re.filter(Ne=>Ne.artifact_hash))}return e},[u.length,j,P]),{globalSteps:z,safeIdx:D,currentStep:C,onSliderChange:_}=ze({seriesPoints:R,persistedIdx:t.sliderStep,updateSettings:r}),f=c.useMemo(()=>{const e=j.find(g=>g.step===C&&g.artifact_hash);if(e)return e;let d;for(const g of j)if(g.step<=C&&g.artifact_hash)d=g;else if(g.step>C)break;return d},[j,C]),m=c.useMemo(()=>X(f==null?void 0:f.artifact_metadata),[f]),l=c.useMemo(()=>((m==null?void 0:m.properties)??[]).map(e=>e.name),[m]),[M,k]=c.useState(b??!1),J=c.useMemo(()=>[{runId:o,name:s.name,context_hash:s.context_hash}],[o,s.name,s.context_hash]),T=Le(),{selectedIds:V,selectedArray:ee,toggle:B,clear:G}=Ve(),L=Be(),{runInfoMap:ae}=Ue(v),te=m?`${m.shape.join("×")} · spacing [${m.spacing.map(e=>e.toFixed(2)).join(", ")}]`:`${s.count} step${s.count!==1?"s":""}`,se=u.length>1,E=u.length===2,W=c.useRef(null),F=c.useMemo(()=>u.slice(0,de),[u]),$=c.useMemo(()=>F.map(ge),[F]),Te=c.useMemo(()=>{const e=new Map;if(S)for(const d of F)e.set(ge(d),qe(d.runId??o,v));return e},[S,F,v,o,T]),oe=c.useMemo(()=>{var e,d;return E?(((d=(e=P[1])==null?void 0:e.data)==null?void 0:d.points)??[]).filter(g=>g.artifact_hash):[]},[E,P]),fe=t.refFixedStep??C,H=c.useMemo(()=>Se(oe,fe)??oe[0],[oe,fe]),Q=c.useMemo(()=>X(H==null?void 0:H.artifact_metadata),[H]),xe=!!m&&!!Q&&m.shape[0]===Q.shape[0]&&m.shape[1]===Q.shape[1]&&m.shape[2]===Q.shape[2],_e=()=>y.isLoading?a.jsx("div",{className:"h-64 motion-safe:animate-pulse rounded bg-bg-hover"}):a.jsxs(a.Fragment,{children:[a.jsx(pe,{hash:(f==null?void 0:f.artifact_hash)??void 0,meta:m,view:h}),a.jsx(le,{points:j,currentIndex:D,onChange:_,xAxis:t.xAxis,onXAxisChange:e=>r({xAxis:e}),className:"mt-3"})]}),Pe=e=>a.jsxs(a.Fragment,{children:[u.length>de&&a.jsx("div",{className:"mono mb-2 text-xs text-fg-subtle",children:`showing ${de} of ${u.length}`}),a.jsx(Qe,{paneKeys:$,labels:Te,inModal:e,paneWidths:t.paneWidths,onPaneWidthsChange:d=>r({paneWidths:d}),renderPane:(d,g)=>{const re=F[g];return a.jsx(Na,{runId:o,m:re,targetStep:C,view:h},d)}}),a.jsx(le,{points:j,currentIndex:D,onChange:_,xAxis:t.xAxis,onXAxisChange:d=>r({xAxis:d}),className:"mt-3"}),a.jsx(Me,{metrics:u,controlledSeries:p,runId:o,allRunIds:v,onMetricsChange:d=>r({metrics:d}),onClick:S?B:void 0,selectedIds:V})]}),Re=()=>a.jsxs(a.Fragment,{children:[a.jsx(Oa,{runId:o,primaryMetric:F[0],referenceMetric:F[1],currentStep:C,view:h,settings:t,updateSettings:r}),a.jsx(le,{points:j,currentIndex:D,onChange:_,xAxis:t.xAxis,onXAxisChange:e=>r({xAxis:e}),className:"mt-3"}),a.jsx(Me,{metrics:u,controlledSeries:p,runId:o,allRunIds:v,onMetricsChange:e=>r({metrics:e}),onClick:S?B:void 0,selectedIds:V})]}),he=E&&!!t.compareMode&&t.compareMode!=="side",ve=e=>se?he?Re():Pe(e):_e(),Fe=!L&&a.jsx(He,{selectedRunIds:ee,allRunIds:v,onClear:G,runInfo:ae,label:"Volume selection"}),ne=(e,d)=>{const g=[...t.clipMin];g[e]=Math.min(d,t.clipMax[e]),r({clipMin:g})},ie=(e,d)=>{const g=[...t.clipMax];g[e]=Math.max(d,t.clipMin[e]),r({clipMax:g})};return a.jsx(Xe,{cardRef:W,settings:t,updateSettings:r,title:s.name,subtitle:te,onSettings:()=>k(!0),onRemove:x,onDownload:f!=null&&f.artifact_hash?()=>We(ue.artifactUrl(f.artifact_hash),$e(s.name,f.step,f.artifact_mime,".npz")):void 0,addToComparisonSlot:a.jsx(Ge,{cardType:"volume",series:J}),dropHighlight:w,dropProps:A,selectionPanel:Fe,settingsPanel:a.jsxs(a.Fragment,{children:[a.jsx(I,{label:"Render mode",value:t.mode,onChange:e=>r({mode:e}),options:ja}),t.mode==="iso"&&a.jsx(N,{label:"Isovalue",value:t.isovalue,onChange:e=>r({isovalue:e}),min:0,max:1,step:.01,format:e=>e.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),a.jsx(I,{label:"Colormap",value:t.colormap,onChange:e=>r({colormap:e}),options:Da}),a.jsx(ca,{properties:l,value:t.property??null,onChange:e=>r({property:e})}),a.jsx(I,{label:"Quality",value:String(t.steps),onChange:e=>r({steps:Number(e)}),options:Ta,description:"Raymarch step count — higher is finer but slower"}),a.jsx(I,{label:"Background",value:t.background,onChange:e=>r({background:e}),options:_a}),a.jsx(be,{label:"Sync 3D views",checked:!!t.syncViews,onChange:e=>r({syncViews:e}),description:"Share orbit/zoom/pan live with this card's other panes and any other sync-enabled 3D card on this page"}),a.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[a.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),a.jsx(N,{label:"Clip X min",value:t.clipMin[0],onChange:e=>ne(0,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(N,{label:"Clip X max",value:t.clipMax[0],onChange:e=>ie(0,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(N,{label:"Clip Y min",value:t.clipMin[1],onChange:e=>ne(1,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(N,{label:"Clip Y max",value:t.clipMax[1],onChange:e=>ie(1,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(N,{label:"Clip Z min",value:t.clipMin[2],onChange:e=>ne(2,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(N,{label:"Clip Z max",value:t.clipMax[2],onChange:e=>ie(2,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)})]}),E&&a.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[a.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Compare (2 series)"}),a.jsx(I,{label:"Compare mode",value:t.compareMode??"side",onChange:e=>r({compareMode:e}),options:Fa(xe),description:xe?void 0:"Native diff needs the same voxel grid shape — disabled for this pair"}),he&&a.jsxs(a.Fragment,{children:[t.compareMode==="diff-value"&&a.jsx(I,{label:"Diff colormap",value:t.diffColormap??"viridis",onChange:e=>r({diffColormap:e}),options:Pa}),t.compareMode==="diff"&&a.jsxs(a.Fragment,{children:[a.jsx(I,{label:"Pixel-diff submode",value:t.diffSubmode??"signed",onChange:e=>r({diffSubmode:e}),options:Ra}),a.jsx(I,{label:"Pixel-diff colormap",value:t.diffColormap??"viridis",onChange:e=>r({diffColormap:e}),options:[{value:"viridis",label:"Viridis"},{value:"red-green",label:"Red-green"},{value:"red-blue",label:"Red-blue"}]})]}),t.compareMode==="split"&&a.jsx(N,{label:"Split position",value:t.splitPosition??.5,onChange:e=>r({splitPosition:e}),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.compareMode==="blend"&&a.jsx(N,{label:"Blend alpha",value:t.blendAlpha??.5,onChange:e=>r({blendAlpha:e}),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(be,{label:"Pin reference to a fixed step",checked:t.refFixedStep!=null,onChange:e=>r({refFixedStep:e?C:void 0}),description:"Off = per-iteration (reference tracks the same step as the primary series)"}),t.refFixedStep!=null&&a.jsx(N,{label:"Reference step",value:t.refFixedStep,onChange:e=>r({refFixedStep:Math.round(e)}),min:0,max:Math.max(...z,t.refFixedStep,1),step:1,format:e=>e.toFixed(0)})]})]})]}),modalOpen:M,onModalClose:()=>k(!1),modalContent:a.jsx("div",{className:"flex flex-col h-full",children:ve(!0)}),scrollIntoViewOnMount:b,children:a.jsx(a.Fragment,{children:ve(!1)})})}export{Ia as default};

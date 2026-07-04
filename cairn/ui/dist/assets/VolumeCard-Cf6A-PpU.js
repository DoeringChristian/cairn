import{w as a,r as c,a5 as _e,u as Re,a as Ae,a0 as Ne,b as Q,d as Oe,e as ce,q as we,f as Fe,i as K,m as ke,j as Ee,k as Ie,l as ze,t as fe,s as Ve,C as Le,x as H,J as k,T as Be,A as Ue,B as Xe,D as Ge,R as qe,F as ie,G as xe,M as We,a1 as ge,a2 as He,h as $e,E as Qe,a3 as Ke}from"./index-DhVyfppk.js";import{u as Ye,l as Ze,R as Je,U as be,m as Y,n as X,V as re,o as ea,p as aa,G as ta,q as sa,j as na,s as oa,t as ia,c as ra,d as la,C as ca,r as ua,e as da,O as ma,g as pa,v as fa,w as xa}from"./diff-Cg6A2tua.js";const ha={dark:856343,light:16185594},he=256;let U=null;function va(){if(U!==null)return U;try{const s=document.createElement("canvas").getContext("webgl2");if(s){const i=s.getExtension("WEBGL_lose_context");i==null||i.loseContext()}U=!!s}catch{U=!1}return U}function ga({className:o}){return a.jsx("div",{className:o??"relative h-full w-full",children:a.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[a.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),a.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function ba(o,s,i){const p=i-s||1,n=new Uint8Array(o.length);for(let x=0;x<o.length;x++){const g=(o[x]-s)/p;n[x]=Math.max(0,Math.min(255,Math.round(g*255)))}return n}function ve(o){const s=_e(o),i=new Uint8Array(256*4);for(let n=0;n<256;n++)i[n*4]=s[n*3],i[n*4+1]=s[n*3+1],i[n*4+2]=s[n*3+2],i[n*4+3]=255;const p=new oa(i,256,1,ia,be);return p.minFilter=Y,p.magFilter=Y,p.wrapS=X,p.wrapT=X,p.needsUpdate=!0,p}const Ma=`precision highp float;

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
`,Ca=`precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${he}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${he};
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
`;function ya(o,s,i){const[p,n,x]=o,g=x*s[2],t=n*s[1],r=p*s[0],u=i[2],v=i[1],S=i[0];return{scale:[g,t,r],position:[u+g/2,v+t/2,S+r/2],bounds:{min:[u,v,S],max:[u+g,v+t,S+r]}}}function Sa({data:o,shape:s,spacing:i,origin:p,vmin:n,vmax:x,mode:g,isovalue:t,colormap:r,steps:u,clip:v,background:S,className:F,sync:O=null,onFrame:A}){const{containerRef:h,canvasRef:C,requestRender:j,fitToBounds:N,refs:_}=Ye({background:ha[S],sync:O,onFrame:A}),E=c.useRef(null),D=c.useRef(null),y=c.useRef(null),P=c.useRef(null),f=c.useRef(null);return c.useEffect(()=>{var z,B,R,q;const d=_.scene.current;if(!d)return;E.current&&(d.remove(E.current),(z=D.current)==null||z.dispose(),(B=y.current)==null||B.dispose(),(R=P.current)==null||R.dispose(),(q=f.current)==null||q.dispose());const[l,b,w]=s,Z=ba(o,n,x),T=new Ze(Z,w,b,l);T.format=Je,T.type=be,T.minFilter=Y,T.magFilter=Y,T.wrapR=X,T.wrapS=X,T.wrapT=X,T.needsUpdate=!0;const V=ve(r),J={uData:{value:T},uLUT:{value:V},uMode:{value:g==="mip"?0:1},uSteps:{value:u},uIsovalue:{value:t},uClipMin:{value:new re(...v.min)},uClipMax:{value:new re(...v.max)},uTexelSize:{value:new re(1/w,1/b,1/l)}},L=new ea({glslVersion:ta,vertexShader:Ma,fragmentShader:Ca,uniforms:J,side:aa,transparent:!1}),G=new sa(1,1,1),I=new na(G,L),{scale:ee,position:ae,bounds:te}=ya(s,i,p);I.scale.set(...ee),I.position.set(...ae),d.add(I),E.current=I,D.current=G,y.current=L,P.current=T,f.current=V,N(te)},[o,s,i,p,n,x]),c.useEffect(()=>{var b;const d=y.current;if(!d)return;(b=f.current)==null||b.dispose();const l=ve(r);f.current=l,d.uniforms.uLUT.value=l,j()},[r]),c.useEffect(()=>{const d=y.current;if(!d)return;const l=d.uniforms;l.uMode.value=g==="mip"?0:1,l.uSteps.value=u,l.uIsovalue.value=t,l.uClipMin.value.set(...v.min),l.uClipMax.value.set(...v.max),j()},[g,t,u,v]),c.useEffect(()=>()=>{var d,l,b,w;(d=D.current)==null||d.dispose(),(l=y.current)==null||l.dispose(),(b=P.current)==null||b.dispose(),(w=f.current)==null||w.dispose()},[]),a.jsx("div",{ref:h,className:F??"relative h-full w-full",children:a.jsx("canvas",{ref:C,className:"block h-full w-full rounded"})})}function $(o){return va()?a.jsx(Sa,{...o}):a.jsx(ga,{className:o.className})}const ja=o=>({version:1,metrics:[o],mode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark"}),le=4,Da=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],Ta=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],Pa=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],_a=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}],Ra=[{value:"diff-value",label:"Diff: value (native)"}];function ue(o){return Qe({queryKey:["volume-npz",o],enabled:!!o,staleTime:1/0,queryFn:async()=>{const s=await fetch(ce.artifactUrl(o));if(!s.ok)throw new Error(`failed to fetch volume (${s.status})`);const i=await Ke(await s.arrayBuffer());if(!i.data)throw new Error("volume artifact is missing its 'data' array");return Float32Array.from(i.data.data)}})}function de({hash:o,meta:s,view:i,fill:p}){const n=ue(o);return o?n.isLoading?a.jsx("div",{className:p?"flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover":"h-64 motion-safe:animate-pulse rounded bg-bg-hover"}):n.isError||!n.data||!s?a.jsx("div",{className:"text-sm text-fg-muted",children:"failed to load volume"}):a.jsxs("div",{className:p?"flex flex-1 min-h-0 flex-col":"flex flex-col",children:[a.jsxs("div",{className:p?"flex flex-1 min-h-0":"flex h-64",children:[a.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:a.jsx($,{data:n.data,shape:s.shape,spacing:s.spacing,origin:s.origin,vmin:s.vmin,vmax:s.vmax,mode:i.mode,isovalue:i.isovalue,colormap:i.colormap,steps:i.steps,clip:{min:i.clipMin,max:i.clipMax},background:i.background,sync:i.sync})}),a.jsx(ge,{colormap:i.colormap,min:s.vmin,max:s.vmax})]}),a.jsxs("div",{className:"mono mt-1 text-xs text-fg-subtle",children:[`${s.shape.join("×")} · vmin ${s.vmin.toFixed(3)} · vmax ${s.vmax.toFixed(3)}`," · double-click to re-fit"]})]}):a.jsx("div",{className:"text-sm text-fg-muted",children:"no volume logged yet"})}function Aa({runId:o,m:s,targetStep:i,view:p}){const n=s.runId??o,x=Q(n,s.name,{context:s.context_hash||void 0,maxPoints:500}),g=c.useMemo(()=>{var u;return(((u=x.data)==null?void 0:u.points)??[]).filter(v=>v.artifact_hash)},[x.data]),t=c.useMemo(()=>$e(g,i)??g[0],[g,i]),r=c.useMemo(()=>K(t==null?void 0:t.artifact_metadata),[t]);return x.isLoading?a.jsx("div",{className:"h-64 motion-safe:animate-pulse rounded bg-bg-hover"}):a.jsx("div",{className:"rounded bg-bg p-2",children:a.jsx(de,{hash:(t==null?void 0:t.artifact_hash)??void 0,meta:r,view:p})})}function Na({runId:o,primaryMetric:s,referenceMetric:i,currentStep:p,view:n,settings:x,updateSettings:g}){const t=Q(s.runId??o,s.name,{context:s.context_hash||void 0,maxPoints:500}),r=Q(i.runId??o,i.name,{context:i.context_hash||void 0,maxPoints:500}),u=c.useMemo(()=>{var l;return(((l=t.data)==null?void 0:l.points)??[]).filter(b=>b.artifact_hash)},[t.data]),v=c.useMemo(()=>{var l;return(((l=r.data)==null?void 0:l.points)??[]).filter(b=>b.artifact_hash)},[r.data]),{primaryHash:S,referenceHash:F}=da({primaryPoints:u,referencePoints:v,currentStep:p,refFixedStep:x.refFixedStep}),O=c.useMemo(()=>u.find(l=>l.artifact_hash===S),[u,S]),A=c.useMemo(()=>v.find(l=>l.artifact_hash===F),[v,F]),h=c.useMemo(()=>K(O==null?void 0:O.artifact_metadata),[O]),C=c.useMemo(()=>K(A==null?void 0:A.artifact_metadata),[A]),j=ue(S),N=ue(F),_=x.compareMode??"side";if(_==="normal")return a.jsx(de,{hash:S,meta:h,view:n,fill:!0});if(!j.data||!N.data||!h||!C)return a.jsx("div",{className:"flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover"});if(He(_)&&(_==="split"||_==="blend"||_==="diff"))return a.jsx("div",{className:"flex-1 min-h-0 overflow-hidden rounded bg-bg",children:a.jsx(ma,{mode:_,renderPrimary:(l,b)=>a.jsx($,{data:j.data,shape:h.shape,spacing:h.spacing,origin:h.origin,vmin:h.vmin,vmax:h.vmax,mode:n.mode,isovalue:n.isovalue,colormap:n.colormap,steps:n.steps,clip:{min:n.clipMin,max:n.clipMax},background:n.background,sync:b,onFrame:l}),renderReference:(l,b)=>a.jsx($,{data:N.data,shape:C.shape,spacing:C.spacing,origin:C.origin,vmin:C.vmin,vmax:C.vmax,mode:n.mode,isovalue:n.isovalue,colormap:n.colormap,steps:n.steps,clip:{min:n.clipMin,max:n.clipMax},background:n.background,sync:b,onFrame:l}),diffSubmode:x.diffSubmode??"signed",colormap:x.diffColormap??"viridis",splitPosition:x.splitPosition??.5,onSplitPositionChange:l=>g({splitPosition:l}),blendAlpha:x.blendAlpha??.5,primaryLabel:s.name})});if(!(h.shape[0]===C.shape[0]&&h.shape[1]===C.shape[1]&&h.shape[2]===C.shape[2]))return a.jsxs("div",{className:"flex flex-1 min-h-0 items-center justify-center rounded bg-bg p-4 text-center text-sm text-fg-muted",children:["Shape mismatch: ",h.shape.join("×")," vs ",C.shape.join("×")," — native diff needs matching voxel grid shape."]});const D=x.diffColormap??"viridis",y=h.shape[0]*h.shape[1]*h.shape[2],P=pa(j.data,N.data,y),f=fa(P,D),d=D==="viridis"?xa(P):P;return a.jsxs("div",{className:"flex flex-1 min-h-0 overflow-hidden rounded bg-bg",children:[a.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:a.jsx($,{data:d,shape:h.shape,spacing:h.spacing,origin:h.origin,vmin:f[0],vmax:f[1],mode:n.mode,isovalue:n.isovalue,colormap:D,steps:n.steps,clip:{min:n.clipMin,max:n.clipMax},background:n.background,sync:n.sync})}),a.jsx(ge,{colormap:D,min:f[0],max:f[1]})]})}function Fa({runId:o,metric:s,extraSeries:i,controlledSeries:p,settingsKeyOverride:n,onRemove:x,autoOpenSettings:g}){var pe;const{settings:t,updateSettings:r,effectiveMetrics:u,allRunIds:v,multipleRuns:S}=Re({runId:o,metric:s,extraSeries:i,controlledSeries:p,settingsKeyOverride:n,makeDefaults:(e,m)=>({...ja(e),metrics:m})}),{highlight:F,dropProps:O}=Ae(u,r),A=Ne(!!t.syncViews),h={mode:t.mode,isovalue:t.isovalue,colormap:t.colormap,steps:t.steps,clipMin:t.clipMin,clipMax:t.clipMax,background:t.background,sync:A?{groupId:A}:null},C=Q(o,s.name,{context:s.context_hash||void 0,maxPoints:500}),j=c.useMemo(()=>{var e;return(((e=C.data)==null?void 0:e.points)??[]).filter(m=>m.artifact_hash)},[C.data]),N=Oe({queries:u.length>1?u.map(e=>{const m=e.runId??o;return{queryKey:we.sequence(m,e.name,e.context_hash),queryFn:()=>ce.sequence(m,e.name,{context:e.context_hash||void 0,maxPoints:500}),refetchInterval:2e3,staleTime:2e3}}):[]}),_=c.useMemo(()=>{var m;const e=[j];if(u.length>1)for(const M of N){const oe=((m=M.data)==null?void 0:m.points)??[];e.push(oe.filter(Pe=>Pe.artifact_hash))}return e},[u.length,j,N]),{globalSteps:E,safeIdx:D,currentStep:y,onSliderChange:P}=Fe({seriesPoints:_,persistedIdx:t.sliderStep,updateSettings:r}),f=c.useMemo(()=>{const e=j.find(M=>M.step===y&&M.artifact_hash);if(e)return e;let m;for(const M of j)if(M.step<=y&&M.artifact_hash)m=M;else if(M.step>y)break;return m},[j,y]),d=c.useMemo(()=>K(f==null?void 0:f.artifact_metadata),[f]),l=c.useMemo(()=>((d==null?void 0:d.properties)??[]).map(e=>e.name),[d]),[b,w]=c.useState(g??!1),Z=c.useMemo(()=>[{runId:o,name:s.name,context_hash:s.context_hash}],[o,s.name,s.context_hash]),T=ke(),{selectedIds:V,selectedArray:J,toggle:L,clear:G}=Ee(),I=Ie(),{runInfoMap:ee}=ze(v),ae=d?`${d.shape.join("×")} · spacing [${d.spacing.map(e=>e.toFixed(2)).join(", ")}]`:`${s.count} step${s.count!==1?"s":""}`,te=u.length>1,z=u.length===2,B=c.useRef(null),R=c.useMemo(()=>u.slice(0,le),[u]),q=c.useMemo(()=>R.map(fe),[R]),Me=c.useMemo(()=>{const e=new Map;if(S)for(const m of R)e.set(fe(m),Ve(m.runId??o,v));return e},[S,R,v,o,T]),W=ra(z?(pe=N[1])==null?void 0:pe.data:void 0,t.refFixedStep,y),Ce=!!d&&!!W&&d.shape[0]===W.shape[0]&&d.shape[1]===W.shape[1]&&d.shape[2]===W.shape[2],ye=()=>C.isLoading?a.jsx("div",{className:"flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover"}):a.jsxs(a.Fragment,{children:[a.jsx(de,{hash:(f==null?void 0:f.artifact_hash)??void 0,meta:d,view:h,fill:!0}),a.jsx(ie,{points:j,currentIndex:D,onChange:P,xAxis:t.xAxis,onXAxisChange:e=>r({xAxis:e}),className:"mt-3"})]}),Se=e=>a.jsxs(a.Fragment,{children:[u.length>le&&a.jsx("div",{className:"mono mb-2 text-xs text-fg-subtle",children:`showing ${le} of ${u.length}`}),a.jsx(We,{paneKeys:q,labels:Me,inModal:e,paneWidths:t.paneWidths,onPaneWidthsChange:m=>r({paneWidths:m}),renderPane:(m,M)=>{const oe=R[M];return a.jsx(Aa,{runId:o,m:oe,targetStep:y,view:h},m)}}),a.jsx(ie,{points:j,currentIndex:D,onChange:P,xAxis:t.xAxis,onXAxisChange:m=>r({xAxis:m}),className:"mt-3"}),a.jsx(xe,{metrics:u,controlledSeries:p,runId:o,allRunIds:v,onMetricsChange:m=>r({metrics:m}),onClick:S?L:void 0,selectedIds:V})]}),je=()=>a.jsxs(a.Fragment,{children:[a.jsx(Na,{runId:o,primaryMetric:R[0],referenceMetric:R[1],currentStep:y,view:h,settings:t,updateSettings:r}),a.jsx(ie,{points:j,currentIndex:D,onChange:P,xAxis:t.xAxis,onXAxisChange:e=>r({xAxis:e}),className:"mt-3"}),a.jsx(xe,{metrics:u,controlledSeries:p,runId:o,allRunIds:v,onMetricsChange:e=>r({metrics:e}),onClick:S?L:void 0,selectedIds:V})]}),De=z&&!!t.compareMode&&t.compareMode!=="side",me=e=>te?De?je():Se(e):ye(),Te=!I&&a.jsx(qe,{selectedRunIds:J,allRunIds:v,onClear:G,runInfo:ee,label:"Volume selection"}),se=(e,m)=>{const M=[...t.clipMin];M[e]=Math.min(m,t.clipMax[e]),r({clipMin:M})},ne=(e,m)=>{const M=[...t.clipMax];M[e]=Math.max(m,t.clipMin[e]),r({clipMax:M})};return a.jsx(Le,{cardKind:"volume",defaultHeight:380,cardRef:B,settings:t,updateSettings:r,title:s.name,subtitle:ae,onSettings:()=>w(!0),onRemove:x,onDownload:f!=null&&f.artifact_hash?()=>Xe(ce.artifactUrl(f.artifact_hash),Ge(s.name,f.step,f.artifact_mime,".npz")):void 0,addToComparisonSlot:a.jsx(Ue,{cardType:"volume",series:Z}),onResetView:()=>ua(B.current),viewModified:!0,dropHighlight:F,dropProps:O,selectionPanel:Te,settingsPanel:a.jsxs(a.Fragment,{children:[a.jsx(H,{label:"Render mode",value:t.mode,onChange:e=>r({mode:e}),options:Da}),t.mode==="iso"&&a.jsx(k,{label:"Isovalue",value:t.isovalue,onChange:e=>r({isovalue:e}),min:0,max:1,step:.01,format:e=>e.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),a.jsx(H,{label:"Colormap",value:t.colormap,onChange:e=>r({colormap:e}),options:Ta}),a.jsx(la,{properties:l,value:t.property??null,onChange:e=>r({property:e})}),a.jsx(H,{label:"Quality",value:String(t.steps),onChange:e=>r({steps:Number(e)}),options:Pa,description:"Raymarch step count — higher is finer but slower"}),a.jsx(H,{label:"Background",value:t.background,onChange:e=>r({background:e}),options:_a}),a.jsx(Be,{label:"Sync 3D views",checked:!!t.syncViews,onChange:e=>r({syncViews:e}),description:"Share orbit/zoom/pan live with this card's other panes and any other sync-enabled 3D card on this page"}),a.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[a.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),a.jsx(k,{label:"Clip X min",value:t.clipMin[0],onChange:e=>se(0,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(k,{label:"Clip X max",value:t.clipMax[0],onChange:e=>ne(0,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(k,{label:"Clip Y min",value:t.clipMin[1],onChange:e=>se(1,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(k,{label:"Clip Y max",value:t.clipMax[1],onChange:e=>ne(1,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(k,{label:"Clip Z min",value:t.clipMin[2],onChange:e=>se(2,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),a.jsx(k,{label:"Clip Z max",value:t.clipMax[2],onChange:e=>ne(2,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)})]}),z&&a.jsx(ca,{mode:t.compareMode??"side",onModeChange:e=>r({compareMode:e}),nativeModes:Ra,topologyOk:Ce,topologyHint:"Native diff needs the same voxel grid shape — disabled for this pair",diffColormap:t.diffColormap??"viridis",onDiffColormapChange:e=>r({diffColormap:e}),diffSubmode:t.diffSubmode??"signed",onDiffSubmodeChange:e=>r({diffSubmode:e}),splitPosition:t.splitPosition??.5,onSplitPositionChange:e=>r({splitPosition:e}),blendAlpha:t.blendAlpha??.5,onBlendAlphaChange:e=>r({blendAlpha:e}),refFixedStep:t.refFixedStep,onRefFixedStepChange:e=>r({refFixedStep:e}),currentStep:y,maxStep:Math.max(...E,1)})]}),modalOpen:b,onModalClose:()=>w(!1),modalContent:a.jsx("div",{className:"flex flex-col h-full",children:me(!0)}),scrollIntoViewOnMount:g,children:a.jsx(a.Fragment,{children:me(!1)})})}export{Fa as default};

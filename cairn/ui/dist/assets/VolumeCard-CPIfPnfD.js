import{v as t,r as u,a3 as ve,u as he,a as ge,$ as be,b as ce,d as Me,e as se,q as ye,f as Ce,i as ue,m as Se,j as De,k as je,l as Te,o as oe,s as we,C as Re,w as X,H as T,T as _e,A as Pe,z as Ne,B as Ae,R as Ie,M as ze,E as ie,F as Ee,h as Oe,a1 as Fe,D as ke,a2 as Le}from"./index-CSTblsr4.js";import{u as Ve,f as Ue,R as Be,U as de,g as G,C as I,V as te,h as Xe,i as Ge,G as qe,j as We,d as $e,k as He,l as Ye}from"./use-scene3d-BGOHAXMP.js";const Ke={dark:856343,light:16185594},re=256;let A=null;function Qe(){if(A!==null)return A;try{const a=document.createElement("canvas").getContext("webgl2");if(a){const o=a.getExtension("WEBGL_lose_context");o==null||o.loseContext()}A=!!a}catch{A=!1}return A}function Ze({className:n}){return t.jsx("div",{className:n??"relative h-full w-full",children:t.jsxs("div",{className:"flex h-full w-full flex-col items-center justify-center gap-1 rounded bg-bg-hover p-4 text-center",children:[t.jsx("div",{className:"text-sm font-semibold text-fg",children:"WebGL2 unavailable"}),t.jsx("div",{className:"text-xs text-fg-muted",children:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})]})})}function Je(n,a,o){const l=o-a||1,d=new Uint8Array(n.length);for(let g=0;g<n.length;g++){const v=(n[g]-a)/l;d[g]=Math.max(0,Math.min(255,Math.round(v*255)))}return d}function le(n){const a=ve(n),o=new Uint8Array(256*4);for(let d=0;d<256;d++)o[d*4]=a[d*3],o[d*4+1]=a[d*3+1],o[d*4+2]=a[d*3+2],o[d*4+3]=255;const l=new He(o,256,1,Ye,de);return l.minFilter=G,l.magFilter=G,l.wrapS=I,l.wrapT=I,l.needsUpdate=!0,l}const et=`precision highp float;

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
`,tt=`precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${re}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${re};
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
`;function at(n,a,o){const[l,d,g]=n,v=g*a[2],s=d*a[1],r=l*a[0],c=o[2],x=o[1],C=o[0];return{scale:[v,s,r],position:[c+v/2,x+s/2,C+r/2],bounds:{min:[c,x,C],max:[c+v,x+s,C+r]}}}function st({data:n,shape:a,spacing:o,origin:l,vmin:d,vmax:g,mode:v,isovalue:s,colormap:r,steps:c,clip:x,background:C,className:q,sync:W=null}){const{containerRef:z,canvasRef:E,requestRender:w,fitToBounds:S,refs:O}=Ve({background:Ke[C],sync:W}),N=u.useRef(null),R=u.useRef(null),M=u.useRef(null),_=u.useRef(null),m=u.useRef(null);return u.useEffect(()=>{var D,V,U,B;const p=O.scene.current;if(!p)return;N.current&&(p.remove(N.current),(D=R.current)==null||D.dispose(),(V=M.current)==null||V.dispose(),(U=_.current)==null||U.dispose(),(B=m.current)==null||B.dispose());const[h,y,j]=a,$=Je(n,d,g),b=new Ue($,j,y,h);b.format=Be,b.type=de,b.minFilter=G,b.magFilter=G,b.wrapR=I,b.wrapS=I,b.wrapT=I,b.needsUpdate=!0;const F=le(r),H={uData:{value:b},uLUT:{value:F},uMode:{value:v==="mip"?0:1},uSteps:{value:c},uIsovalue:{value:s},uClipMin:{value:new te(...x.min)},uClipMax:{value:new te(...x.max)},uTexelSize:{value:new te(1/j,1/y,1/h)}},k=new Xe({glslVersion:qe,vertexShader:et,fragmentShader:tt,uniforms:H,side:Ge,transparent:!1}),L=new We(1,1,1),P=new $e(L,k),{scale:Y,position:K,bounds:Q}=at(a,o,l);P.scale.set(...Y),P.position.set(...K),p.add(P),N.current=P,R.current=L,M.current=k,_.current=b,m.current=F,S(Q)},[n,a,o,l,d,g]),u.useEffect(()=>{var y;const p=M.current;if(!p)return;(y=m.current)==null||y.dispose();const h=le(r);m.current=h,p.uniforms.uLUT.value=h,w()},[r]),u.useEffect(()=>{const p=M.current;if(!p)return;const h=p.uniforms;h.uMode.value=v==="mip"?0:1,h.uSteps.value=c,h.uIsovalue.value=s,h.uClipMin.value.set(...x.min),h.uClipMax.value.set(...x.max),w()},[v,s,c,x]),u.useEffect(()=>()=>{var p,h,y,j;(p=R.current)==null||p.dispose(),(h=M.current)==null||h.dispose(),(y=_.current)==null||y.dispose(),(j=m.current)==null||j.dispose()},[]),t.jsx("div",{ref:z,className:q??"relative h-full w-full",children:t.jsx("canvas",{ref:E,className:"block h-full w-full rounded"})})}function nt(n){return Qe()?t.jsx(st,{...n}):t.jsx(Ze,{className:n.className})}const ot=n=>({version:1,metrics:[n],mode:"mip",isovalue:.5,colormap:"viridis",steps:128,clipMin:[0,0,0],clipMax:[1,1,1],background:"dark"}),ae=4,it=[{value:"mip",label:"MIP (max-intensity projection)"},{value:"iso",label:"Isosurface"}],rt=[{value:"viridis",label:"Viridis"},{value:"red-blue",label:"Red–Blue"},{value:"red-green",label:"Red–Green"}],lt=[{value:"64",label:"64 steps (fast)"},{value:"128",label:"128 steps"},{value:"256",label:"256 steps (fine)"}],ct=[{value:"dark",label:"Dark"},{value:"light",label:"Light"}];function ut(n){return ke({queryKey:["volume-npz",n],enabled:!!n,staleTime:1/0,queryFn:async()=>{const a=await fetch(se.artifactUrl(n));if(!a.ok)throw new Error(`failed to fetch volume (${a.status})`);const o=await Le(await a.arrayBuffer());if(!o.data)throw new Error("volume artifact is missing its 'data' array");return Float32Array.from(o.data.data)}})}function me({hash:n,meta:a,view:o}){const l=ut(n);return n?l.isLoading?t.jsx("div",{className:"h-64 motion-safe:animate-pulse rounded bg-bg-hover"}):l.isError||!l.data||!a?t.jsx("div",{className:"text-sm text-fg-muted",children:"failed to load volume"}):t.jsxs("div",{className:"flex flex-col",children:[t.jsxs("div",{className:"flex h-64",children:[t.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:t.jsx(nt,{data:l.data,shape:a.shape,spacing:a.spacing,origin:a.origin,vmin:a.vmin,vmax:a.vmax,mode:o.mode,isovalue:o.isovalue,colormap:o.colormap,steps:o.steps,clip:{min:o.clipMin,max:o.clipMax},background:o.background,sync:o.sync})}),t.jsx(Fe,{colormap:o.colormap,min:a.vmin,max:a.vmax})]}),t.jsxs("div",{className:"mono mt-1 text-xs text-fg-subtle",children:[`${a.shape.join("×")} · vmin ${a.vmin.toFixed(3)} · vmax ${a.vmax.toFixed(3)}`," · double-click to re-fit"]})]}):t.jsx("div",{className:"text-sm text-fg-muted",children:"no volume logged yet"})}function dt({runId:n,m:a,targetStep:o,view:l}){const d=a.runId??n,g=ce(d,a.name,{context:a.context_hash||void 0,maxPoints:500}),v=u.useMemo(()=>{var c;return(((c=g.data)==null?void 0:c.points)??[]).filter(x=>x.artifact_hash)},[g.data]),s=u.useMemo(()=>Oe(v,o)??v[0],[v,o]),r=u.useMemo(()=>ue(s==null?void 0:s.artifact_metadata),[s]);return g.isLoading?t.jsx("div",{className:"h-64 motion-safe:animate-pulse rounded bg-bg-hover"}):t.jsx("div",{className:"rounded bg-bg p-2",children:t.jsx(me,{hash:(s==null?void 0:s.artifact_hash)??void 0,meta:r,view:l})})}function pt({runId:n,metric:a,extraSeries:o,controlledSeries:l,settingsKeyOverride:d,onRemove:g,autoOpenSettings:v}){const{settings:s,updateSettings:r,effectiveMetrics:c,allRunIds:x,multipleRuns:C}=he({runId:n,metric:a,extraSeries:o,controlledSeries:l,settingsKeyOverride:d,makeDefaults:(e,i)=>({...ot(e),metrics:i})}),{highlight:q,dropProps:W}=ge(c,r),z=be(!!s.syncViews),E={mode:s.mode,isovalue:s.isovalue,colormap:s.colormap,steps:s.steps,clipMin:s.clipMin,clipMax:s.clipMax,background:s.background,sync:z?{groupId:z}:null},w=ce(n,a.name,{context:a.context_hash||void 0,maxPoints:500}),S=u.useMemo(()=>{var e;return(((e=w.data)==null?void 0:e.points)??[]).filter(i=>i.artifact_hash)},[w.data]),O=Me({queries:c.length>1?c.map(e=>{const i=e.runId??n;return{queryKey:ye.sequence(i,e.name,e.context_hash),queryFn:()=>se.sequence(i,e.name,{context:e.context_hash||void 0,maxPoints:500}),refetchInterval:2e3,staleTime:2e3}}):[]}),N=u.useMemo(()=>{var i;const e=[S];if(c.length>1)for(const f of O){const ee=((i=f.data)==null?void 0:i.points)??[];e.push(ee.filter(fe=>fe.artifact_hash))}return e},[c.length,S,O]),{safeIdx:R,currentStep:M,onSliderChange:_}=Ce({seriesPoints:N,persistedIdx:s.sliderStep,updateSettings:r}),m=u.useMemo(()=>{const e=S.find(f=>f.step===M&&f.artifact_hash);if(e)return e;let i;for(const f of S)if(f.step<=M&&f.artifact_hash)i=f;else if(f.step>M)break;return i},[S,M]),p=u.useMemo(()=>ue(m==null?void 0:m.artifact_metadata),[m]),[h,y]=u.useState(v??!1),j=u.useMemo(()=>[{runId:n,name:a.name,context_hash:a.context_hash}],[n,a.name,a.context_hash]),$=Se(),{selectedIds:b,selectedArray:F,toggle:H,clear:k}=De(),L=je(),{runInfoMap:P}=Te(x),Y=p?`${p.shape.join("×")} · spacing [${p.spacing.map(e=>e.toFixed(2)).join(", ")}]`:`${a.count} step${a.count!==1?"s":""}`,K=c.length>1,Q=u.useRef(null),D=u.useMemo(()=>c.slice(0,ae),[c]),V=u.useMemo(()=>D.map(oe),[D]),U=u.useMemo(()=>{const e=new Map;if(C)for(const i of D)e.set(oe(i),we(i.runId??n,x));return e},[C,D,x,n,$]),B=()=>w.isLoading?t.jsx("div",{className:"h-64 motion-safe:animate-pulse rounded bg-bg-hover"}):t.jsxs(t.Fragment,{children:[t.jsx(me,{hash:(m==null?void 0:m.artifact_hash)??void 0,meta:p,view:E}),t.jsx(ie,{points:S,currentIndex:R,onChange:_,xAxis:s.xAxis,onXAxisChange:e=>r({xAxis:e}),className:"mt-3"})]}),xe=e=>t.jsxs(t.Fragment,{children:[c.length>ae&&t.jsx("div",{className:"mono mb-2 text-xs text-fg-subtle",children:`showing ${ae} of ${c.length}`}),t.jsx(ze,{paneKeys:V,labels:U,inModal:e,paneWidths:s.paneWidths,onPaneWidthsChange:i=>r({paneWidths:i}),renderPane:(i,f)=>{const ee=D[f];return t.jsx(dt,{runId:n,m:ee,targetStep:M,view:E},i)}}),t.jsx(ie,{points:S,currentIndex:R,onChange:_,xAxis:s.xAxis,onXAxisChange:i=>r({xAxis:i}),className:"mt-3"}),t.jsx(Ee,{metrics:c,controlledSeries:l,runId:n,allRunIds:x,onMetricsChange:i=>r({metrics:i}),onClick:C?H:void 0,selectedIds:b})]}),ne=e=>K?xe(e):B(),pe=!L&&t.jsx(Ie,{selectedRunIds:F,allRunIds:x,onClear:k,runInfo:P,label:"Volume selection"}),Z=(e,i)=>{const f=[...s.clipMin];f[e]=Math.min(i,s.clipMax[e]),r({clipMin:f})},J=(e,i)=>{const f=[...s.clipMax];f[e]=Math.max(i,s.clipMin[e]),r({clipMax:f})};return t.jsx(Re,{cardRef:Q,settings:s,updateSettings:r,title:a.name,subtitle:Y,onSettings:()=>y(!0),onRemove:g,onDownload:m!=null&&m.artifact_hash?()=>Ne(se.artifactUrl(m.artifact_hash),Ae(a.name,m.step,m.artifact_mime,".npz")):void 0,addToComparisonSlot:t.jsx(Pe,{cardType:"volume",series:j}),dropHighlight:q,dropProps:W,selectionPanel:pe,settingsPanel:t.jsxs(t.Fragment,{children:[t.jsx(X,{label:"Render mode",value:s.mode,onChange:e=>r({mode:e}),options:it}),s.mode==="iso"&&t.jsx(T,{label:"Isovalue",value:s.isovalue,onChange:e=>r({isovalue:e}),min:0,max:1,step:.01,format:e=>e.toFixed(2),description:"Fraction of the [vmin, vmax] value range"}),t.jsx(X,{label:"Colormap",value:s.colormap,onChange:e=>r({colormap:e}),options:rt}),t.jsx(X,{label:"Quality",value:String(s.steps),onChange:e=>r({steps:Number(e)}),options:lt,description:"Raymarch step count — higher is finer but slower"}),t.jsx(X,{label:"Background",value:s.background,onChange:e=>r({background:e}),options:ct}),t.jsx(_e,{label:"Sync 3D views",checked:!!s.syncViews,onChange:e=>r({syncViews:e}),description:"Share orbit/zoom/pan live with this card's other panes and any other sync-enabled 3D card on this page"}),t.jsxs("div",{className:"mt-2 border-t border-border-subtle pt-2",children:[t.jsx("div",{className:"mb-1 text-xs font-semibold text-fg-muted",children:"Clip box (slices the volume; axes follow the box's local X/Y/Z — width/height/depth of the [D,H,W] array)"}),t.jsx(T,{label:"Clip X min",value:s.clipMin[0],onChange:e=>Z(0,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.jsx(T,{label:"Clip X max",value:s.clipMax[0],onChange:e=>J(0,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.jsx(T,{label:"Clip Y min",value:s.clipMin[1],onChange:e=>Z(1,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.jsx(T,{label:"Clip Y max",value:s.clipMax[1],onChange:e=>J(1,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.jsx(T,{label:"Clip Z min",value:s.clipMin[2],onChange:e=>Z(2,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)}),t.jsx(T,{label:"Clip Z max",value:s.clipMax[2],onChange:e=>J(2,e),min:0,max:1,step:.01,format:e=>e.toFixed(2)})]})]}),modalOpen:h,onModalClose:()=>y(!1),modalContent:t.jsx("div",{className:"flex flex-col h-full",children:ne(!0)}),scrollIntoViewOnMount:v,children:t.jsx(t.Fragment,{children:ne(!1)})})}export{pt as default};

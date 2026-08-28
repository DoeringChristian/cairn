import{j as m,K as ie,r as h,g as se,L as W}from"./PlotHost-BfZ9MSSl.js";import{u as re,n as le,R as ue,U as H,o as z,C as S,p as A,q as ce,s as me,G as de,t as fe,l as pe,S as ve,v as xe,w as he,V as O,e as ge,g as $,h as q,i as be,x as ye}from"./ViewportPlaceholder-BFtfZa4x.js";const De={dark:856343,light:16185594},F=256;let T=null;function Me(){if(T!==null)return T;try{const t=document.createElement("canvas").getContext("webgl2");if(t){const a=t.getExtension("WEBGL_lose_context");a==null||a.loseContext()}T=!!t}catch{T=!1}return T}function we(e,t,a){const n=a-t||1,i=new Uint8Array(e.length);for(let l=0;l<e.length;l++){const u=(e[l]-t)/n;i[l]=Math.max(0,Math.min(255,Math.round(u*255)))}return i}function G(e){const t=se(e),a=new Uint8Array(256*4);for(let i=0;i<256;i++)a[i*4]=t[i*3],a[i*4+1]=t[i*3+1],a[i*4+2]=t[i*3+2],a[i*4+3]=255;const n=new xe(a,256,1,he,H);return n.minFilter=z,n.magFilter=z,n.wrapS=S,n.wrapT=S,n.needsUpdate=!0,n}const Te=`precision highp float;

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
`,Se=`precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uData;
uniform sampler2D uLUT;
uniform int uMode;          // 0 = MIP, 1 = ISO
uniform float uSteps;       // <= ${F}.0
uniform float uIsovalue;    // normalized [0,1]
uniform vec3 uClipMin;      // normalized [0,1], texture-space (x=W,y=H,z=D)
uniform vec3 uClipMax;
uniform vec3 uTexelSize;    // (1/W, 1/H, 1/D), for the gradient step

const int MAX_STEPS = ${F};
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
`;function Ce(e,t,a){const[n,i,l]=e,u=l*t[2],r=i*t[1],d=n*t[0],o=a[2],c=a[1],s=a[0];return{scale:[u,r,d],position:[o+u/2,c+r/2,s+d/2],bounds:{min:[o,c,s],max:[o+u,c+r,s+d]}}}function ze({data:e,shape:t,spacing:a,origin:n,vmin:i,vmax:l,mode:u,isovalue:r,colormap:d,steps:o,clip:c,background:s,className:x,sync:b=null,onFrame:y,showAxes:j=!1,showPlanes:Z=!1,cameraMode:K="orbital"}){const V=re({background:De[s],sync:b,showAxes:j,showPlanes:Z,cameraMode:K,onFrame:y}),{requestRender:L,fitToBounds:J,refs:Q}=V,R=h.useRef(null),P=h.useRef(null),D=h.useRef(null),E=h.useRef(null),M=h.useRef(null);return h.useEffect(()=>{var k,N,X,B;const p=Q.scene.current;if(!p)return;R.current&&(p.remove(R.current),(k=P.current)==null||k.dispose(),(N=D.current)==null||N.dispose(),(X=E.current)==null||X.dispose(),(B=M.current)==null||B.dispose());const[f,g,w]=t,ee=we(e,i,l),v=new le(ee,w,g,f);v.format=ue,v.type=H,v.minFilter=z,v.magFilter=z,v.wrapR=S,v.wrapS=S,v.wrapT=S,v.needsUpdate=!0;const U=G(d),te={uData:{value:v},uLUT:{value:U},uMode:{value:u==="mip"?0:1},uSteps:{value:o},uIsovalue:{value:r},uClipMin:{value:new A(...c.min)},uClipMax:{value:new A(...c.max)},uTexelSize:{value:new A(1/w,1/g,1/f)}},I=new ce({glslVersion:de,vertexShader:Te,fragmentShader:Se,uniforms:te,side:me,transparent:!1}),_=new fe(1,1,1),C=new pe(_,I),{scale:ae,position:oe,bounds:ne}=Ce(t,a,n);C.scale.set(...ae),C.position.set(...oe),p.add(C),R.current=C,P.current=_,D.current=I,E.current=v,M.current=U,J(ne)},[e,t,a,n,i,l]),h.useEffect(()=>{var g;const p=D.current;if(!p)return;(g=M.current)==null||g.dispose();const f=G(d);M.current=f,p.uniforms.uLUT.value=f,L()},[d]),h.useEffect(()=>{const p=D.current;if(!p)return;const f=p.uniforms;f.uMode.value=u==="mip"?0:1,f.uSteps.value=o,f.uIsovalue.value=r,f.uClipMin.value.set(...c.min),f.uClipMax.value.set(...c.max),L()},[u,r,o,c]),h.useEffect(()=>()=>{var p,f,g,w;(p=P.current)==null||p.dispose(),(f=D.current)==null||f.dispose(),(g=E.current)==null||g.dispose(),(w=M.current)==null||w.dispose()},[]),m.jsx(ve,{handle:V,className:x})}function Y(e){return Me()?m.jsx(ze,{...e}):m.jsx(ie,{className:e.className,title:"WebGL2 unavailable",body:"Volume rendering needs WebGL2 (raymarched 3D textures), which this browser or GPU doesn't support."})}function je(e){return{mode:e.renderMode,isovalue:e.isovalue,colormap:e.colormap,steps:e.steps,clipMin:e.clipMin,clipMax:e.clipMax,background:e.background,showAxes:e.showAxes??!1,showPlanes:e.showPlanes??!1,cameraMode:e.cameraMode??"orbital"}}function Ae({item:e,view:t,sync:a,label:n,isDraggable:i,onDragStart:l,onFrame:u,colorRange:r}){if(!e)return m.jsx(O,{variant:"empty",children:"no volume logged yet"});const{arrays:d,meta:o}=e,[c,s]=r??[o.vmin,o.vmax];return m.jsxs("div",{className:"relative flex h-full w-full flex-col overflow-hidden rounded bg-bg",children:[m.jsx("div",{className:"flex flex-1 min-h-0 overflow-hidden",children:m.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:m.jsx(Y,{data:d.data,shape:o.shape,spacing:o.spacing,origin:o.origin,vmin:c,vmax:s,mode:t.mode,isovalue:t.isovalue,colormap:t.colormap,steps:t.steps,clip:{min:t.clipMin,max:t.clipMax},background:t.background,showAxes:t.showAxes,showPlanes:t.showPlanes,cameraMode:t.cameraMode,sync:a,onFrame:u})})}),m.jsx(ge,{text:`${o.shape.join("×")} · vmin ${o.vmin.toFixed(3)} · vmax ${o.vmax.toFixed(3)}`}),m.jsx(W,{label:n,isDraggable:i,onDragStart:l})]})}function Oe({data:e,reference:t,settings:a,cameraSyncGroupId:n,label:i,isDraggable:l,onDragStart:u,colorRange:r}){const d=n?{groupId:n}:null,o=je(a);if(!e||!t)return m.jsx(O,{variant:"loading",children:"loading…"});if(!(e.meta.shape[0]===t.meta.shape[0]&&e.meta.shape[1]===t.meta.shape[1]&&e.meta.shape[2]===t.meta.shape[2]))return m.jsxs(O,{variant:"error",children:["Shape mismatch: ",e.meta.shape.join("×")," vs ",t.meta.shape.join("×")," — native diff needs matching voxel grid shape."]});const s=a.diffColormap??"turbo",x=e.meta.shape[0]*e.meta.shape[1]*e.meta.shape[2],b=$(e.arrays.data,t.arrays.data,x),y=r??q(b,s),j=s==="turbo"?ye(b):b;return m.jsxs("div",{className:"relative flex h-full w-full overflow-hidden rounded bg-bg",children:[m.jsx("div",{className:"min-w-0 flex-1 overflow-hidden rounded bg-bg",children:m.jsx(Y,{data:j,shape:e.meta.shape,spacing:e.meta.spacing,origin:e.meta.origin,vmin:y[0],vmax:y[1],mode:o.mode,isovalue:o.isovalue,colormap:s,steps:o.steps,clip:{min:o.clipMin,max:o.clipMax},background:o.background,showAxes:o.showAxes,showPlanes:o.showPlanes,cameraMode:o.cameraMode,sync:d})}),m.jsx(W,{label:i,isDraggable:l,onDragStart:u})]})}function Re(e,t){const a=e,n=t;return!a||!n?!1:a.meta.shape[0]===n.meta.shape[0]&&a.meta.shape[1]===n.meta.shape[1]&&a.meta.shape[2]===n.meta.shape[2]}function Ve(e){const{items:t,referenceItems:a,settings:n,nativeMode:i}=e;if(i==="diff-value"){const r=n.diffColormap??"turbo",d=[];for(let c=0;c<t.length;c++){const s=t[c],x=a[c];if(!s||!x||s.meta.shape[0]!==x.meta.shape[0]||s.meta.shape[1]!==x.meta.shape[1]||s.meta.shape[2]!==x.meta.shape[2])continue;const b=s.meta.shape[0]*s.meta.shape[1]*s.meta.shape[2],y=$(s.arrays.data,x.arrays.data,b);d.push(q(y,r))}const o=be(d,r);return o?{colormap:r,min:o[0],max:o[1]}:null}let l=1/0,u=-1/0;for(const r of[...t,...a])r&&(l=Math.min(l,r.meta.vmin),u=Math.max(u,r.meta.vmax));return!Number.isFinite(l)||!Number.isFinite(u)?null:{colormap:n.colormap,min:l,max:u}}const Le={coreModes:["normal","split","diff"],nativeModes:[{mode:"diff-value",label:"Diff: value (native)",enabledFor:Re,disabledReason:"Native diff needs the same voxel grid shape — disabled for this pair"}],maxPanes:4,downloadExtension:".npz"};export{Oe as V,Ve as a,Y as b,Ae as c,je as r,Le as v};

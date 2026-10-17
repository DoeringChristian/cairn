(function(){
var started=false,urls=[];
function post(m){m.v=1;try{parent.postMessage(m,"*")}catch(e){}}
function fail(e){post({type:"cairn:error",message:String(e&&e.message||e),stack:e&&e.stack?String(e.stack):undefined})}
addEventListener("error",function(e){fail(e.error||e.message)});
addEventListener("unhandledrejection",function(e){fail(e.reason)});
addEventListener("pagehide",function(){urls.forEach(function(u){URL.revokeObjectURL(u)})});
addEventListener("message",function(e){
  var d=e.data;
  if(e.source!==parent||!d||d.type!=="cairn:boot"||started)return;
  started=true;
  var byPath={};
  for(var i=0;i<d.files.length;i++){var f=d.files[i];var u=URL.createObjectURL(new Blob([f.data],{type:f.mime}));byPath[f.path]=u;urls.push(u)}
  var map={imports:{}};
  for(var k in d.imports){if(byPath[d.imports[k]])map.imports[k]=byPath[d.imports[k]]}
  window.__cairnFiles=byPath;
  var s=document.createElement("script");s.type="importmap";s.textContent=JSON.stringify(map);document.head.appendChild(s);
  import("cairn:sdk").then(function(){return import(d.entry)}).then(function(){post({type:"cairn:loaded"})},fail);
});
post({type:"cairn:ready",sdk:"1"});
})();

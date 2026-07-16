<<<<<<<< HEAD:cairn/ui/dist/assets/emit-auto-height-BzP3bXEB.js
import{r as s}from"./index-R1UJV9iO.js";function c(t){s.useEffect(()=>{const e=t.current;if(!e)return;const o=()=>{const n=Math.ceil(e.getBoundingClientRect().height);n>0&&window.parent.postMessage({type:"cairn:resize",height:n,protocolVersion:1},"*")},r=new ResizeObserver(o);return r.observe(e),o(),()=>r.disconnect()},[t])}export{c as u};
========
import{r as s}from"./index-DuwebVNa.js";function c(t){s.useEffect(()=>{const e=t.current;if(!e)return;const o=()=>{const n=Math.ceil(e.getBoundingClientRect().height);n>0&&window.parent.postMessage({type:"cairn:resize",height:n,protocolVersion:1},"*")},r=new ResizeObserver(o);return r.observe(e),o(),()=>r.disconnect()},[t])}export{c as u};
>>>>>>>> a3be810e (cairn-plot mesh: per-face color renderer (non-indexed expansion)):cairn/ui/dist/assets/emit-auto-height-CVfNWtgA.js

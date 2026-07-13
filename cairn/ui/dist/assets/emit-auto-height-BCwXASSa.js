<<<<<<<< HEAD:cairn/ui/dist/assets/emit-auto-height-Bb1s1cC6.js
import{r as s}from"./index-BBPFn1ea.js";function c(t){s.useEffect(()=>{const e=t.current;if(!e)return;const o=()=>{const n=Math.ceil(e.getBoundingClientRect().height);n>0&&window.parent.postMessage({type:"cairn:resize",height:n,protocolVersion:1},"*")},r=new ResizeObserver(o);return r.observe(e),o(),()=>r.disconnect()},[t])}export{c as u};
========
import{r as s}from"./index-Bcfn3xoO.js";function c(t){s.useEffect(()=>{const e=t.current;if(!e)return;const o=()=>{const n=Math.ceil(e.getBoundingClientRect().height);n>0&&window.parent.postMessage({type:"cairn:resize",height:n,protocolVersion:1},"*")},r=new ResizeObserver(o);return r.observe(e),o(),()=>r.disconnect()},[t])}export{c as u};
>>>>>>>> 2d438f68 (WIP: TEV pixel-value overlay):cairn/ui/dist/assets/emit-auto-height-BCwXASSa.js

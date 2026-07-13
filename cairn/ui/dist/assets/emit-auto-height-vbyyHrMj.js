<<<<<<<< HEAD:cairn/ui/dist/assets/emit-auto-height-DLSquu-Q.js
import{r as s}from"./index-Zk28HdQ9.js";function c(t){s.useEffect(()=>{const e=t.current;if(!e)return;const o=()=>{const n=Math.ceil(e.getBoundingClientRect().height);n>0&&window.parent.postMessage({type:"cairn:resize",height:n,protocolVersion:1},"*")},r=new ResizeObserver(o);return r.observe(e),o(),()=>r.disconnect()},[t])}export{c as u};
========
import{r as s}from"./index-Yjr4QtHv.js";function c(t){s.useEffect(()=>{const e=t.current;if(!e)return;const o=()=>{const n=Math.ceil(e.getBoundingClientRect().height);n>0&&window.parent.postMessage({type:"cairn:resize",height:n,protocolVersion:1},"*")},r=new ResizeObserver(o);return r.observe(e),o(),()=>r.disconnect()},[t])}export{c as u};
>>>>>>>> 7219a14a (cairn-plot Stage 1: shared theme tokens + formatter dedup):cairn/ui/dist/assets/emit-auto-height-vbyyHrMj.js

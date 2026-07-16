<<<<<<<< HEAD:cairn/ui/dist/assets/emit-auto-height-B4Z1qGwM.js
import{r as s}from"./index-DU0nah67.js";function c(t){s.useEffect(()=>{const e=t.current;if(!e)return;const o=()=>{const n=Math.ceil(e.getBoundingClientRect().height);n>0&&window.parent.postMessage({type:"cairn:resize",height:n,protocolVersion:1},"*")},r=new ResizeObserver(o);return r.observe(e),o(),()=>r.disconnect()},[t])}export{c as u};
========
import{r as s}from"./index-c45QQZtE.js";function c(t){s.useEffect(()=>{const e=t.current;if(!e)return;const o=()=>{const n=Math.ceil(e.getBoundingClientRect().height);n>0&&window.parent.postMessage({type:"cairn:resize",height:n,protocolVersion:1},"*")},r=new ResizeObserver(o);return r.observe(e),o(),()=>r.disconnect()},[t])}export{c as u};
>>>>>>>> 63a5bd36 (cairn-plot parity S0: controller types + widen ChartDragMode + adapter skeleton):cairn/ui/dist/assets/emit-auto-height-CBNk09iT.js

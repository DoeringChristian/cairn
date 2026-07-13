<<<<<<<< HEAD:cairn/ui/dist/assets/emit-auto-height-nixgmSUG.js
import{r as s}from"./index-BCJmveFO.js";function c(t){s.useEffect(()=>{const e=t.current;if(!e)return;const o=()=>{const n=Math.ceil(e.getBoundingClientRect().height);n>0&&window.parent.postMessage({type:"cairn:resize",height:n,protocolVersion:1},"*")},r=new ResizeObserver(o);return r.observe(e),o(),()=>r.disconnect()},[t])}export{c as u};
========
import{r as s}from"./index-V7BHW2i0.js";function c(t){s.useEffect(()=>{const e=t.current;if(!e)return;const o=()=>{const n=Math.ceil(e.getBoundingClientRect().height);n>0&&window.parent.postMessage({type:"cairn:resize",height:n,protocolVersion:1},"*")},r=new ResizeObserver(o);return r.observe(e),o(),()=>r.disconnect()},[t])}export{c as u};
>>>>>>>> 57f20ff8 (cairn-plot zoom Step 3: HistogramPlot bars unified viewport):cairn/ui/dist/assets/emit-auto-height-BkLPpJaV.js

import { useEffect, useState } from "react";

export interface EngineDiffKernel {
  id: string;
  label: string;
}

/**
 * The engine diff KERNELS (the six pointwise diffs plus FLIP / HDR-FLIP /
 * SSIM) the gpu-image addon publishes on `window.__cairnPlotDiffMenuModes`
 * once WebGPU initializes, plus whether the engine is available. GPU-gated:
 * empty on a non-WebGPU browser (or before the addon's async device check
 * resolves). Re-renders on the addon's ready event so the kernel menu fills
 * in live. Extracted verbatim from the dissolved media shell.
 */
export function useEngineDiffKernels(): { kernels: EngineDiffKernel[]; gpuAvailable: boolean } {
  const read = () => {
    const w = window as unknown as {
      __cairnPlotDiffMenuModes?: EngineDiffKernel[];
      __cairnPlotGpuImageLoaded?: boolean;
    };
    return { kernels: w.__cairnPlotDiffMenuModes ?? [], gpuAvailable: !!w.__cairnPlotGpuImageLoaded };
  };
  const [state, setState] = useState<{ kernels: EngineDiffKernel[]; gpuAvailable: boolean }>(read);
  useEffect(() => {
    const onReady = () => setState(read());
    window.addEventListener("cairn-plot:gpu-image-ready", onReady);
    onReady(); // the addon may have resolved between the initial render and this effect
    return () => window.removeEventListener("cairn-plot:gpu-image-ready", onReady);
  }, []);
  return state;
}

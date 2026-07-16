export type Backend = "webgpu" | "webgl2";
export interface Capabilities { hdr: boolean; compute: boolean; float16: boolean; }
export type TextureFormat = "rgba8unorm" | "rgba16float" | "rgba32float" | "r32float";
export interface Texture { readonly width: number; readonly height: number; readonly format: TextureFormat; write(data: ArrayBufferView): void; destroy(): void; }
export interface Sampler { readonly _s: unknown; }
export interface RenderPipeline { readonly _p: unknown; }
export interface ComputePipeline { readonly _c: unknown; }
export interface BindGroupEntry { binding: number; resource: Texture | Sampler | { uniform: ArrayBufferView }; }
/**
 * `destroy?()` is optional because WebGL2 bind groups (`engine/webgl2/device.ts`'s
 * `GLBindGroup`) own no GPU resources of their own — they're just a captured
 * `BindGroupEntry[]` replayed against borrowed textures/samplers/program
 * uniforms at draw time, so there's nothing to free. WebGPU bind groups
 * (`engine/webgpu/device.ts`'s `WGPUBindGroup`) DO allocate owned
 * `GPUBuffer`s per `createBindGroup()` call (one per declared uniform
 * binding) and MUST implement `destroy()` to release them — callers that
 * rebuild bind groups per frame (a real render loop) must call
 * `bindGroup.destroy?.()` once a bind group is no longer needed, or those
 * buffers leak until `Device.destroy()`.
 */
export interface BindGroup { readonly _b: unknown; destroy?(): void; }
export interface Surface { readonly canvas: HTMLCanvasElement; readonly hdr: boolean; configure(width: number, height: number): void; getCurrentTextureView(): unknown; }
export interface Device {
  readonly backend: Backend;
  readonly capabilities: Capabilities;
  createTexture(width: number, height: number, format: TextureFormat): Texture;
  createSampler(opts?: { filter?: "nearest" | "linear" }): Sampler;
  createRenderPipeline(spec: { shaderWGSL: string; shaderGLSL: string; targetFormat: TextureFormat; }): RenderPipeline;
  createComputePipeline?(spec: { shaderWGSL: string }): ComputePipeline;
  createBindGroup(pipeline: RenderPipeline, entries: BindGroupEntry[]): BindGroup;
  createSurface(canvas: HTMLCanvasElement, opts: { hdr: boolean }): Surface;
  renderFullscreen(target: Surface | Texture, pipeline: RenderPipeline, bindGroup: BindGroup): void;
  readback(source: Surface | Texture): Promise<Uint8Array | Float32Array>;
  /**
   * GPU-side parallel reduction (Task 7) over the `[0,width)x[0,height)`
   * region of `texA`/`texB` (RGB channels only): sum of squared per-channel
   * diffs (`sumSq`) and sum of absolute per-channel diffs (`sumAbs`), used by
   * `engine/image-engine.ts`'s `computeMetrics`. WebGPU-only (see
   * `engine/shaders/reduce.wgsl.ts`'s module doc for why) — `undefined` on
   * WebGL2, where `computeMetrics` falls back to `readback()` + a CPU loop
   * instead. `width`/`height` may be smaller than either texture's own
   * dimensions (the caller passes the `min(texA,texB)` comparison region).
   */
  reduceDiffSumSquaredAbs?(
    texA: Texture,
    texB: Texture,
    width: number,
    height: number,
  ): Promise<{ sumSq: number; sumAbs: number }>;
  destroy(): void;
  /**
   * True while this device's underlying GPU context is LOST and awaiting
   * (asynchronous) browser restoration — meaningful for WebGL2 only, where
   * `engine/webgl2/device.ts`'s `createSurface` may hand back a canvas's
   * previously-lost context (a canvas can host only ONE context per type)
   * and proactively call `restoreContext()`, which does not complete
   * synchronously. WebGPU never has this state (`createSurface` is always a
   * safe idempotent re-configure — see `webgpu/device.ts`'s doc), so its
   * implementation always returns `false`. Callers (`engine/pool.ts`'s
   * `render()`) must not issue GL/GPU work while this is `true`.
   */
  isContextLost(): boolean;
}

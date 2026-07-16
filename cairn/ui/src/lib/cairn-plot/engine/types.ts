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
  destroy(): void;
}

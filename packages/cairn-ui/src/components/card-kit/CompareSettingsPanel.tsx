import Select from "../settings/Select";
import Slider from "../settings/Slider";
import Toggle from "../settings/Toggle";
type Colormap = string;
type DiffMode = string;
type DiffColormap = string;

const DIFF_COLORMAP_OPTIONS = ["turbo", "magma", "gray"].map((value) => ({ value, label: value }));
const DIFF_SUBMODE_OPTIONS = ["absolute", "signed", "squared", "relative_absolute"].map((value) => ({ value, label: value }));
const PIXEL_DIFF_COLORMAP_OPTIONS = DIFF_COLORMAP_OPTIONS;

function compareModeOptions<M extends string>(
  nativeModes: Array<{ value: M; label: string }>,
  topologyOk: boolean,
): Array<{ value: M; label: string; disabled?: boolean }> {
  const core = ["normal", "split", "blend", "diff"].map((value) => ({ value: value as M, label: value }));
  return [...core, ...nativeModes.map((option) => ({ ...option, disabled: !topologyOk }))];
}

// ---------------------------------------------------------------------------
// The ONE "Compare (2 series)" settings block, shared by all four 3D cards
// (mesh/pointcloud/boxes3d/volume). Each card previously repeated this ~85
// lines of JSX verbatim; they now pass a small per-type descriptor (which
// native modes exist + the topology hint) and thread their settings through
// typed callbacks. Behavior is identical.
//
// The core comparison kinds (side/normal/split/blend/diff) + the diff option
// lists are the SAME media-compare data every card shares; they now live ONCE
// in the lib (`media-compare/compare-settings.ts`). Native per-type kinds
// (diff-property/diff-geometry/diff-position/diff-value) differ per card, so
// they arrive via `nativeModes` and are enumerated with the core kinds by the
// lib `enumerateCompareModeOptions`.
// ---------------------------------------------------------------------------

export interface CompareSettingsPanelProps<M extends string> {
  mode: M;
  onModeChange: (v: M) => void;
  /** Native per-type kinds appended after the core kinds (e.g. mesh's
   *  `diff-property`/`diff-geometry`). Disabled in the select when
   *  `topologyOk` is false. */
  nativeModes: Array<{ value: M; label: string }>;
  /** Whether the two series' topology matches (drives native-mode enabling
   *  + the select description). */
  topologyOk: boolean;
  /** Reason text shown when native modes are disabled. */
  topologyHint: string;

  diffColormap: DiffColormap;
  onDiffColormapChange: (v: DiffColormap) => void;
  diffSubmode: DiffMode;
  onDiffSubmodeChange: (v: DiffMode) => void;
  /** Persisted ENGINE diff-kernel selection (`flip`/`flip_ldr`/`ssim` or a
   *  pointwise id) — the value of the kernel select below, threaded so pane-side
   *  kernel changes (embed/report seeds) stay in sync. Falls back to
   *  `diffSubmode` when unset. */
  diffKernel?: string;
  onDiffKernelChange?: (v: string) => void;
  splitPosition: number;
  onSplitPositionChange: (v: number) => void;
  blendAlpha: number;
  onBlendAlphaChange: (v: number) => void;
  refFixedStep: number | undefined;
  onRefFixedStepChange: (v: number | undefined) => void;
  currentStep: number;
  /** Upper bound for the reference-step slider (usually max logged step). */
  maxStep: number;
}

export function CompareSettingsPanel<M extends string>({
  mode,
  onModeChange,
  nativeModes,
  topologyOk,
  topologyHint,
  diffColormap,
  onDiffColormapChange,
  diffSubmode,
  onDiffSubmodeChange,
  diffKernel,
  onDiffKernelChange,
  splitPosition,
  onSplitPositionChange,
  blendAlpha,
  onBlendAlphaChange,
  refFixedStep,
  onRefFixedStepChange,
  currentStep,
  maxStep,
}: CompareSettingsPanelProps<M>) {
  const options = compareModeOptions(nativeModes, topologyOk);
  const nativeValues = new Set<string>(nativeModes.map((o) => o.value));
  const isNative = nativeValues.has(mode);

  // ENGINE diff KERNELS from the gpu-image registry — the FULL kernel menu
  // (the six pointwise diffs plus FLIP / HDR-FLIP / SSIM), enumerated via the
  // same `enumerateCompareModeOptions` seam, GPU-gated. Empty on a non-WebGPU
  // browser (the addon publishes the list only once its device check resolves),
  // in which case the panel falls back to the plain pointwise submode select.
  const engineKernelList =
    (window as unknown as { __cairnPlotDiffMenuModes?: Array<{ id: string; label: string }> })
      .__cairnPlotDiffMenuModes ?? [];
  const gpuAvailable = !!(window as unknown as { __cairnPlotGpuImageLoaded?: boolean })
    .__cairnPlotGpuImageLoaded;
  const kernelOptions = gpuAvailable
    ? engineKernelList.map((kernel) => ({ value: kernel.id, label: kernel.label }))
    : [];
  const showKernelSelect = !!onDiffKernelChange && kernelOptions.length > 0;

  return (
    <div className="mt-2 border-t border-border-subtle pt-2">
      <div className="mb-1 text-xs font-semibold text-fg-muted">Compare</div>
      <Select
        label="Compare mode"
        value={mode}
        onChange={onModeChange}
        options={options}
        description={topologyOk ? undefined : topologyHint}
      />
      {/* Every surviving mode (normal/split/blend/diff) is a compare mode; the
          per-mode sub-controls below are each gated on their own mode. */}
      {isNative && (
            <Select
              label="Diff colormap"
              value={diffColormap}
              onChange={onDiffColormapChange}
              options={[...DIFF_COLORMAP_OPTIONS]}
            />
          )}
          {mode === ("diff" as M) && (
            <>
              {showKernelSelect ? (
                <Select
                  label="Diff kernel"
                  value={diffKernel ?? diffSubmode}
                  onChange={(v) => onDiffKernelChange!(v)}
                  options={kernelOptions}
                  description="Pointwise diffs plus the GPU perceptual kernels (FLIP / HDR-FLIP / SSIM)"
                />
              ) : (
                <Select
                  label="Pixel-diff submode"
                  value={diffSubmode}
                  onChange={onDiffSubmodeChange}
                  options={[...DIFF_SUBMODE_OPTIONS]}
                />
              )}
              <Select
                label="Pixel-diff colormap"
                value={diffColormap as Colormap}
                onChange={(v) => onDiffColormapChange(v as DiffColormap)}
                options={[...PIXEL_DIFF_COLORMAP_OPTIONS]}
              />
            </>
          )}
          {mode === ("split" as M) && (
            <Slider
              label="Split position"
              value={splitPosition}
              onChange={onSplitPositionChange}
              min={0}
              max={1}
              step={0.01}
              format={(v) => v.toFixed(2)}
            />
          )}
          {mode === ("blend" as M) && (
            <Slider
              label="Blend alpha"
              value={blendAlpha}
              onChange={onBlendAlphaChange}
              min={0}
              max={1}
              step={0.01}
              format={(v) => v.toFixed(2)}
            />
          )}
          <Toggle
            label="Pin reference to a fixed step"
            checked={refFixedStep != null}
            onChange={(v) => onRefFixedStepChange(v ? currentStep : undefined)}
            description="Off = per-iteration (reference tracks the same step as the primary series)"
          />
          {refFixedStep != null && (
            <Slider
              label="Reference step"
              value={refFixedStep}
              onChange={(v) => onRefFixedStepChange(Math.round(v))}
              min={0}
              max={Math.max(maxStep, refFixedStep, 1)}
              step={1}
              format={(v) => v.toFixed(0)}
            />
          )}
    </div>
  );
}

export default CompareSettingsPanel;

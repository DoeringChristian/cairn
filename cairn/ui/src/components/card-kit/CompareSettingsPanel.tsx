import Select from "../settings/Select";
import Slider from "../settings/Slider";
import Toggle from "../settings/Toggle";
import type { Colormap, DiffMode } from "../../lib/cairn-plot/types";
import type { DiffColormap } from "../../lib/cairn-plot/three/diff";

// ---------------------------------------------------------------------------
// The ONE "Compare (2 series)" settings block, shared by all four 3D cards
// (mesh/pointcloud/boxes3d/volume). Each card previously repeated this ~85
// lines of JSX plus the DIFF_* option constants verbatim; they now pass a
// small per-type descriptor (which native modes exist + the topology hint)
// and thread their settings through typed callbacks. Behavior is identical.
//
// The core comparison kinds (side/normal/split/blend/diff) are the SAME
// media-compare enum every card shares; the labels live here ONCE. Native
// per-type kinds (diff-property/diff-geometry/diff-position/diff-value)
// differ per card, so they arrive via `nativeModes`.
// ---------------------------------------------------------------------------

/** The two native-diff-mode colormaps (signed red-green / magnitude viridis)
 *  — shared here so the four cards don't each re-declare the identical list. */
const DIFF_COLORMAP_OPTIONS: Array<{ value: DiffColormap; label: string }> = [
  { value: "red-green", label: "Red–green (signed)" },
  { value: "viridis", label: "Viridis (magnitude)" },
];

/** Pixel-diff sub-modes for the image-space "diff" compositor mode. */
const DIFF_SUBMODE_OPTIONS: Array<{ value: DiffMode; label: string }> = [
  { value: "signed", label: "Signed" },
  { value: "absolute", label: "Absolute" },
  { value: "squared", label: "Squared" },
  { value: "relative_signed", label: "Relative signed" },
  { value: "relative_absolute", label: "Relative absolute" },
  { value: "relative_squared", label: "Relative squared" },
];

/** Pixel-diff false-color maps for the image-space "diff" compositor mode. */
const PIXEL_DIFF_COLORMAP_OPTIONS: Array<{ value: Colormap; label: string }> = [
  { value: "viridis", label: "Viridis" },
  { value: "red-green", label: "Red-green" },
  { value: "red-blue", label: "Red-blue" },
];

/** The five core (image-space) media-compare kinds, labelled once. Cast to
 *  the caller's mode union `M` at use — every `MediaCompareMode<TExtra>`
 *  includes these kinds by construction. */
const CORE_COMPARE_LABELS: Array<{ value: string; label: string }> = [
  { value: "side", label: "Side by side (default)" },
  { value: "normal", label: "Normal (primary only)" },
  { value: "split", label: "Split (image-space)" },
  { value: "blend", label: "Blend (image-space)" },
  { value: "diff", label: "Pixel diff (image-space)" },
];

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
  splitPosition,
  onSplitPositionChange,
  blendAlpha,
  onBlendAlphaChange,
  refFixedStep,
  onRefFixedStepChange,
  currentStep,
  maxStep,
}: CompareSettingsPanelProps<M>) {
  const options: Array<{ value: M; label: string; disabled?: boolean }> = [
    ...CORE_COMPARE_LABELS.map((o) => ({ value: o.value as M, label: o.label })),
    ...nativeModes.map((o) => ({ value: o.value, label: o.label, disabled: !topologyOk })),
  ];
  const nativeValues = new Set<string>(nativeModes.map((o) => o.value));
  const isNative = nativeValues.has(mode);
  const usingCompareMode = mode !== ("side" as M);

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
      {usingCompareMode && (
        <>
          {isNative && (
            <Select
              label="Diff colormap"
              value={diffColormap}
              onChange={onDiffColormapChange}
              options={DIFF_COLORMAP_OPTIONS}
            />
          )}
          {mode === ("diff" as M) && (
            <>
              <Select
                label="Pixel-diff submode"
                value={diffSubmode}
                onChange={onDiffSubmodeChange}
                options={DIFF_SUBMODE_OPTIONS}
              />
              <Select
                label="Pixel-diff colormap"
                value={diffColormap as Colormap}
                onChange={(v) => onDiffColormapChange(v as DiffColormap)}
                options={PIXEL_DIFF_COLORMAP_OPTIONS}
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
        </>
      )}
    </div>
  );
}

export default CompareSettingsPanel;

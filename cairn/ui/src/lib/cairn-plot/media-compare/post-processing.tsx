import { useId, useMemo } from "react";
import type { ImageProcessing } from "../types";

// ---------------------------------------------------------------------------
// Image-space post-processing: brightness/contrast/gamma/exposure/flip-sign.
//
// This is the ONE implementation, moved from renderers/gamma-filter.tsx
// (formerly private to ImagePane/CompareImagePane). It produces a CSS
// `filter` string plus a scoped SVG gamma filter, both usable on ANY
// rendered element — an `<img>`, a `<canvas>` (diff / false-color output),
// or — in WS-VC2 — an offscreen 3D render target composited into an
// `<img>`/`<canvas>` element. No 3D wiring happens in this workstream; this
// module only does the factoring so that adoption is a call-site change,
// not a reimplementation.
// ---------------------------------------------------------------------------

/** Pure CSS `filter` function list for brightness/contrast/exposure/flip
 *  (everything except gamma, which needs the SVG `feComponentTransfer` since
 *  CSS has no gamma filter function). Split out so non-React canvas callers
 *  (e.g. a 3D card painting into an offscreen canvas) can compose it without
 *  the `useGammaFilter` hook. */
export function buildProcessingFilterList(
  processing: ImageProcessing,
  gammaFilterId: string,
): string {
  const { brightness, contrast, exposure, flipSign } = processing;
  return [
    `url(#${gammaFilterId})`,
    `brightness(${(1 + brightness) * Math.pow(2, exposure)})`,
    `contrast(${1 + contrast})`,
    ...(flipSign ? ["invert(1)"] : []),
  ].join(" ");
}

/**
 * Shared SVG gamma-filter + CSS `filter` string derivation used by the image
 * renderers (ImagePane, media-compare compositor). The gamma correction runs
 * through an SVG `feComponentTransfer` (scoped by a unique id), while
 * brightness/contrast/exposure/flip are composed as CSS filter functions on
 * top.
 */
export function useGammaFilter(processing: ImageProcessing): {
  gammaFilterId: string;
  filterStr: string;
  gamma: number;
  offset: number;
} {
  const rawId = useId();
  const gammaFilterId = `cairn-gamma-${rawId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const { brightness, contrast, gamma, exposure, offset, flipSign } = processing;

  const filterStr = useMemo(
    () => buildProcessingFilterList(processing, gammaFilterId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gammaFilterId, brightness, contrast, exposure, flipSign],
  );

  return { gammaFilterId, filterStr, gamma, offset };
}

/**
 * The off-screen SVG `<filter>` element referenced by `filterStr` via its id.
 * Render once per pane; scoped to the component through the unique id.
 */
export function GammaFilterSvg({
  id,
  gamma,
  offset,
}: {
  id: string;
  gamma: number;
  offset: number;
}) {
  return (
    <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="gamma" amplitude={1} exponent={1 / gamma} offset={offset} />
          <feFuncG type="gamma" amplitude={1} exponent={1 / gamma} offset={offset} />
          <feFuncB type="gamma" amplitude={1} exponent={1 / gamma} offset={offset} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

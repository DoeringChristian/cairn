import { useId, useMemo } from "react";
import type { ImageProcessingProps } from "./ImagePane";

/**
 * Shared SVG gamma-filter + CSS `filter` string derivation used by the image
 * renderers (ImagePane, CompareImagePane). The gamma correction runs through an
 * SVG `feComponentTransfer` (scoped by a unique id), while brightness/contrast/
 * exposure/flip are composed as CSS filter functions on top.
 */
export function useGammaFilter(processing: ImageProcessingProps): {
  gammaFilterId: string;
  filterStr: string;
  gamma: number;
  offset: number;
} {
  const rawId = useId();
  const gammaFilterId = `cairn-gamma-${rawId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const { brightness, contrast, gamma, exposure, offset, flipSign } = processing;

  const filterStr = useMemo(
    () =>
      [
        `url(#${gammaFilterId})`,
        `brightness(${(1 + brightness) * Math.pow(2, exposure)})`,
        `contrast(${1 + contrast})`,
        ...(flipSign ? ["invert(1)"] : []),
      ].join(" "),
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

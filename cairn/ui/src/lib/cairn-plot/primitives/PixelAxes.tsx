import type { RefObject } from "react";

interface Props {
  naturalWidth: number;
  naturalHeight: number;
  zoom?: number;
  containerRef?: RefObject<HTMLElement | null>;
}

function tickInterval(dim: number): number {
  if (dim <= 32) return 4;
  if (dim <= 128) return 16;
  if (dim <= 512) return 64;
  if (dim <= 2048) return 256;
  return 512;
}

export default function PixelAxes({
  naturalWidth,
  naturalHeight,
  zoom = 1,
  containerRef,
}: Props) {
  const xInterval = tickInterval(naturalWidth);
  const yInterval = tickInterval(naturalHeight);

  const xTicks: number[] = [];
  for (let x = 0; x <= naturalWidth; x += xInterval) xTicks.push(x);

  const yTicks: number[] = [];
  for (let y = 0; y <= naturalHeight; y += yInterval) yTicks.push(y);

  const counterScale = 1 / zoom;
  const fontSize = 8 * counterScale;
  const topOffset = -12 * counterScale;
  const leftOffset = -2 * counterScale;

  const el = containerRef?.current;
  let imgLeft = 0,
    imgTop = 0,
    imgW = 0,
    imgH = 0;
  if (el) {
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const scaleX = cw / naturalWidth;
    const scaleY = ch / naturalHeight;
    const scale = Math.min(scaleX, scaleY);
    imgW = naturalWidth * scale;
    imgH = naturalHeight * scale;
    imgLeft = (cw - imgW) / 2;
    imgTop = (ch - imgH) / 2;
  }

  const useBounds = el && imgW > 0;

  return (
    <>
      <div
        className="absolute left-0 right-0 text-fg-muted leading-none pointer-events-none select-none"
        style={{
          top: useBounds ? imgTop : 0,
          transform: `translateY(${topOffset}px)`,
          fontSize,
        }}
      >
        {xTicks.map((x) => (
          <span
            key={x}
            className="mono"
            style={{
              position: "absolute",
              left: useBounds
                ? imgLeft + (x / naturalWidth) * imgW
                : `${(x / naturalWidth) * 100}%`,
              transform: "translateX(-50%)",
            }}
          >
            {x}
          </span>
        ))}
      </div>
      <div
        className="absolute top-0 bottom-0 text-fg-muted leading-none pointer-events-none select-none"
        style={{
          left: useBounds ? imgLeft : 0,
          transform: `translateX(${leftOffset}px)`,
          fontSize,
        }}
      >
        {yTicks.map((y) => (
          <span
            key={y}
            className="mono"
            style={{
              position: "absolute",
              top: useBounds
                ? imgTop + (y / naturalHeight) * imgH
                : `${(y / naturalHeight) * 100}%`,
              transform: "translate(-100%, -50%)",
              paddingRight: `${3 * counterScale}px`,
            }}
          >
            {y}
          </span>
        ))}
      </div>
    </>
  );
}

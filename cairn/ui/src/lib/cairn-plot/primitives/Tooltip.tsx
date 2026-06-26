import type { ReactNode } from "react";

interface TooltipProps {
  x: number;
  y: number;
  containerW: number;
  containerH: number;
  width?: number;
  children: ReactNode;
}

export default function Tooltip({
  x,
  y,
  containerW,
  containerH,
  width = 220,
  children,
}: TooltipProps) {
  const gap = 14;
  const flipX = x + width + gap > containerW;
  const flipY = y > containerH - 100;
  return (
    <div
      className="pointer-events-none absolute z-50 rounded border border-border bg-bg-elevated shadow-lg p-2 text-xs w-fit"
      style={{
        maxWidth: width,
        left: flipX ? Math.max(4, x - width - gap + 10) : x + gap,
        top: flipY ? y - 80 : y - 8,
      }}
    >
      {children}
    </div>
  );
}

import { useEffect, useMemo, useRef } from "react";
import type {
  ImageOverlayData,
  ImageOverlaySettings,
  OverlayBox,
} from "../types";
import { overlayClassColor } from "../types";
import { useContainerSize } from "../hooks";

export interface ImageOverlayProps {
  data: ImageOverlayData;
  settings: ImageOverlaySettings;
  /** Natural (intrinsic) pixel dimensions of the underlying image. */
  naturalWidth: number;
  naturalHeight: number;
}

/** Hex "#rrggbb" -> [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function boxVisible(
  box: OverlayBox,
  settings: ImageOverlaySettings,
  hidden: Set<number>,
): boolean {
  if (hidden.has(box.class_id)) return false;
  if (box.score != null && box.score < settings.scoreThreshold) return false;
  return true;
}

/**
 * Absolutely-positioned annotation layer (boxes + masks) that sits *inside* the
 * image's transformed wrapper, so it inherits the exact zoom/pan CSS transform.
 * Self-contained: measures its own layout box (ResizeObserver, transform-immune)
 * to letterbox the annotations onto the `object-contain` image rectangle.
 */
export default function ImageOverlay({
  data,
  settings,
  naturalWidth,
  naturalHeight,
}: ImageOverlayProps) {
  const { ref, size } = useContainerSize<HTMLDivElement>();
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const hidden = useMemo(
    () => new Set(settings.hiddenClasses),
    [settings.hiddenClasses],
  );

  // Contained (letterboxed) rectangle of the image within our layout box.
  const rect = useMemo(() => {
    const cw = size.w;
    const ch = size.h;
    if (cw <= 0 || ch <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
      return null;
    }
    const scale = Math.min(cw / naturalWidth, ch / naturalHeight);
    const dispW = naturalWidth * scale;
    const dispH = naturalHeight * scale;
    return {
      left: (cw - dispW) / 2,
      top: (ch - dispH) / 2,
      width: dispW,
      height: dispH,
    };
  }, [size.w, size.h, naturalWidth, naturalHeight]);

  // -----------------------------------------------------------------------
  // Masks: decode each PNG, colorize by class id, composite onto one canvas.
  // -----------------------------------------------------------------------
  const masks = data.masks;
  const showMasks = settings.showMasks && !!masks && masks.length > 0;
  const hiddenKey = useMemo(
    () => settings.hiddenClasses.join(","),
    [settings.hiddenClasses],
  );

  useEffect(() => {
    if (!showMasks || !masks) return;
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    if (canvas.width !== naturalWidth || canvas.height !== naturalHeight) {
      canvas.width = naturalWidth;
      canvas.height = naturalHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let cancelled = false;
    const out = ctx.createImageData(naturalWidth, naturalHeight);
    const outData = out.data;
    let pending = masks.length;
    let anyDrawn = false;

    const finish = () => {
      if (cancelled) return;
      if (anyDrawn) ctx.putImageData(out, 0, 0);
    };

    const decode = document.createElement("canvas");
    decode.width = naturalWidth;
    decode.height = naturalHeight;
    const dctx = decode.getContext("2d", { willReadFrequently: true });

    for (const mask of masks) {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        if (dctx) {
          dctx.clearRect(0, 0, naturalWidth, naturalHeight);
          dctx.drawImage(img, 0, 0, naturalWidth, naturalHeight);
          const src = dctx.getImageData(0, 0, naturalWidth, naturalHeight).data;
          for (let i = 0; i < naturalWidth * naturalHeight; i++) {
            const classId = src[i * 4]!; // grayscale -> class id
            if (classId === 0) continue; // background
            if (hidden.has(classId)) continue;
            const [r, g, b] = hexToRgb(overlayClassColor(classId));
            outData[i * 4] = r;
            outData[i * 4 + 1] = g;
            outData[i * 4 + 2] = b;
            outData[i * 4 + 3] = 255;
            anyDrawn = true;
          }
        }
        pending -= 1;
        if (pending === 0) finish();
      };
      img.onerror = () => {
        pending -= 1;
        if (pending === 0) finish();
      };
      img.src = `data:image/png;base64,${mask.png_b64}`;
    }

    return () => {
      cancelled = true;
    };
    // hiddenKey drives re-colorize when class visibility changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMasks, masks, naturalWidth, naturalHeight, hiddenKey]);

  if (!rect) {
    return <div ref={ref} className="absolute inset-0 pointer-events-none" />;
  }

  const boxes = data.boxes ?? [];
  const showBoxes = settings.showBoxes && boxes.length > 0;
  const classLabels = data.class_labels ?? {};

  return (
    <div ref={ref} className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Masks (canvas, natural-res, CSS-scaled to the contained rect) */}
      {showMasks && (
        <canvas
          ref={maskCanvasRef}
          className="absolute"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            opacity: settings.maskOpacity,
            imageRendering: "pixelated",
          }}
        />
      )}

      {/* Boxes (SVG in image pixel coordinates via viewBox) */}
      {showBoxes && (
        <svg
          className="absolute"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            overflow: "visible",
          }}
          viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
          preserveAspectRatio="none"
        >
          {boxes.map((box, i) => {
            if (!boxVisible(box, settings, hidden)) return null;
            const px = box.domain === "pixel" ? 1 : naturalWidth;
            const py = box.domain === "pixel" ? 1 : naturalHeight;
            const x = box.position.minX * px;
            const y = box.position.minY * py;
            const w = (box.position.maxX - box.position.minX) * px;
            const h = (box.position.maxY - box.position.minY) * py;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={w}
                height={h}
                fill="none"
                stroke={overlayClassColor(box.class_id)}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      )}

      {/* Box labels (HTML chips, unscaled font, positioned as % of the rect) */}
      {showBoxes && (
        <div
          className="absolute"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          {boxes.map((box, i) => {
            if (!boxVisible(box, settings, hidden)) return null;
            const fx = box.domain === "pixel" ? 1 / naturalWidth : 1;
            const fy = box.domain === "pixel" ? 1 / naturalHeight : 1;
            const leftPct = box.position.minX * fx * 100;
            const topPct = box.position.minY * fy * 100;
            const name =
              box.label ?? classLabels[String(box.class_id)] ?? `#${box.class_id}`;
            const scoreTxt = box.score != null ? ` ${(box.score * 100).toFixed(0)}%` : "";
            if (!name && !scoreTxt) return null;
            return (
              <span
                key={i}
                className="absolute whitespace-nowrap rounded px-1 text-[10px] leading-tight text-white"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  transform: "translateY(-100%)",
                  backgroundColor: overlayClassColor(box.class_id),
                }}
              >
                <span className="mono">{name}{scoreTxt}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import type { SequenceMeta } from "../api/types";
import { useCardSettings } from "../lib/card-settings";
import CardHeader from "./CardHeader";
import SettingsPopover from "./SettingsPopover";
import Slider from "./settings/Slider";

interface Props {
  runId: string;
  metric: SequenceMeta;
}

interface ImageSettings {
  version: 1;
  brightness: number; // -1..1, default 0
  contrast: number; // -1..1, default 0
  gamma: number; // 0.1..3, default 1
  zoom: number; // 0.25..16, default 1
  pan: { x: number; y: number }; // default {0,0}
}

const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  version: 1,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  zoom: 1,
  pan: { x: 0, y: 0 },
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;

function isModified(s: ImageSettings): boolean {
  return (
    s.brightness !== 0 ||
    s.contrast !== 0 ||
    s.gamma !== 1 ||
    s.zoom !== 1 ||
    s.pan.x !== 0 ||
    s.pan.y !== 0
  );
}

export default function ImageGalleryCard({ runId, metric }: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 500,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];

  const settingsKey = useMemo(
    () => ({
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    }),
    [runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings, resetSettings] = useCardSettings(
    settingsKey,
    DEFAULT_IMAGE_SETTINGS,
  );

  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Unique, DOM-safe filter id per card instance for SVG gamma.
  const rawId = useId();
  const gammaFilterId = `cairn-gamma-${rawId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  // Image container ref for native non-passive wheel listener.
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Track latest settings/zoom in refs for event handlers to avoid stale closures.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Native non-passive wheel listener so preventDefault() actually works.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const cur = settingsRef.current.zoom;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur * factor));
      updateSettings({ zoom: nextZoom });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
    };
  }, [updateSettings]);

  // Pointer drag for panning.
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (settingsRef.current.zoom <= 1) return;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        panX: settingsRef.current.pan.x,
        panY: settingsRef.current.pan.y,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      updateSettings({ pan: { x: s.panX + dx, y: s.panY + dy } });
    },
    [updateSettings],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragStateRef.current = null;
    },
    [],
  );

  const filterStr = [
    `url(#${gammaFilterId})`,
    `brightness(${1 + settings.brightness})`,
    `contrast(${1 + settings.contrast})`,
  ].join(" ");

  const transformStr = `translate(${settings.pan.x}px, ${settings.pan.y}px) scale(${settings.zoom})`;

  const modified = isModified(settings);
  const canPan = settings.zoom > 1;

  const subtitle =
    points.length > 0
      ? `step ${current?.step ?? "\u2014"} of ${points.length}`
      : `${metric.count} pts`;

  return (
    <div className="card p-4">
      {/* SVG gamma filter, one per card instance. */}
      <svg
        aria-hidden="true"
        style={{ position: "absolute", width: 0, height: 0 }}
      >
        <filter id={gammaFilterId} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR
              type="gamma"
              amplitude={1}
              exponent={1 / settings.gamma}
              offset={0}
            />
            <feFuncG
              type="gamma"
              amplitude={1}
              exponent={1 / settings.gamma}
              offset={0}
            />
            <feFuncB
              type="gamma"
              amplitude={1}
              exponent={1 / settings.gamma}
              offset={0}
            />
          </feComponentTransfer>
        </filter>
      </svg>

      <CardHeader title={metric.name} subtitle={subtitle}>
        {modified && (
          <button
            type="button"
            onClick={() => resetSettings()}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Reset image settings"
            title="Reset image settings"
          >
            {"\u21BA"}
          </button>
        )}
        <button
          ref={settingsBtnRef}
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
          aria-label="Image settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          title="Image settings"
        >
          {"\u2699"}
        </button>
      </CardHeader>

      {q.isLoading ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : current?.artifact_hash ? (
        <>
          <div
            ref={containerRef}
            className="flex justify-center rounded bg-bg p-2"
            style={{
              overflow: "hidden",
              cursor: canPan ? "move" : "default",
              touchAction: canPan ? "none" : undefined,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              src={api.artifactUrl(current.artifact_hash)}
              alt={`${metric.name} @ step ${current.step}`}
              className="max-h-64 object-contain"
              draggable={false}
              style={{
                filter: filterStr,
                transform: transformStr,
                transformOrigin: "center center",
              }}
            />
          </div>
          {points.length > 1 && (
            <input
              type="range"
              min={0}
              max={points.length - 1}
              value={safeIdx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
        </>
      ) : (
        <div className="text-sm text-fg-muted">no image logged yet</div>
      )}

      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        anchorRef={settingsBtnRef}
        title="Image"
      >
        <Slider
          label="Brightness"
          value={settings.brightness}
          onChange={(v) => updateSettings({ brightness: v })}
          min={-1}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="Contrast"
          value={settings.contrast}
          onChange={(v) => updateSettings({ contrast: v })}
          min={-1}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="Gamma"
          value={settings.gamma}
          onChange={(v) => updateSettings({ gamma: v })}
          min={0.1}
          max={3}
          step={0.01}
          format={(v) => v.toFixed(2)}
          description="1 = no change; <1 brightens shadows, >1 darkens"
        />
        <Slider
          label="Zoom"
          value={settings.zoom}
          onChange={(v) => updateSettings({ zoom: v })}
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          format={(v) => `${v.toFixed(2)}x`}
          description="Scroll on the image to zoom; drag to pan when zoomed in."
        />
        <button
          type="button"
          className="btn w-full mt-2"
          onClick={() => {
            resetSettings();
            setSettingsOpen(false);
          }}
        >
          Reset to defaults
        </button>
      </SettingsPopover>
    </div>
  );
}

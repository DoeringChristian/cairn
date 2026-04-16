import { useMemo, useRef, useState } from "react";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { useCardSettings } from "../lib/card-settings";
import CardHeader from "./CardHeader";
import SettingsPopover from "./SettingsPopover";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";
import type { SequenceMeta } from "../api/types";

interface VideoMetadata {
  fps: number;
  num_frames: number;
  width: number;
  height: number;
  channels: number;
  preview?: string;
}

interface Props {
  runId: string;
  metric: SequenceMeta;
}

interface VideoSettings {
  version: 1;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  preload: "metadata" | "auto" | "none";
}

const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  version: 1,
  autoplay: false,
  loop: false,
  muted: false,
  preload: "metadata",
};

export default function VideoPlayerCard({ runId, metric }: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];
  const meta = safeJsonParse<VideoMetadata>(current?.artifact_metadata);

  const [settings, updateSettings, resetSettings] = useCardSettings<VideoSettings>(
    {
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    },
    DEFAULT_VIDEO_SETTINGS,
  );

  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const subtitle =
    points.length > 0
      ? `step ${current?.step ?? "—"} of ${points.length}`
      : `${metric.count} pts`;

  return (
    <div className="card p-4">
      <CardHeader title={metric.name} subtitle={subtitle}>
        <button
          ref={settingsBtnRef}
          type="button"
          aria-label="Card settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
        >
          ⚙
        </button>
      </CardHeader>
      {q.isLoading ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : current?.artifact_hash ? (
        <>
          <div className="flex justify-center rounded bg-bg p-2">
            <video
              key={current.artifact_hash}
              controls
              autoPlay={settings.autoplay}
              loop={settings.loop}
              muted={settings.muted}
              preload={settings.preload}
              src={api.artifactUrl(current.artifact_hash)}
              poster={meta?.preview}
              className="max-h-64 object-contain"
            />
          </div>
          {meta && (
            <div className="mono mt-2 text-xs text-fg-subtle">
              {meta.width}×{meta.height} · {meta.num_frames} frames @ {meta.fps}
              fps
            </div>
          )}
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
        <div className="text-sm text-fg-muted">no video logged yet</div>
      )}
      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        anchorRef={settingsBtnRef}
        title="Video"
      >
        <Toggle
          label="Autoplay"
          checked={settings.autoplay}
          onChange={(v) => updateSettings({ autoplay: v })}
        />
        <Toggle
          label="Loop"
          checked={settings.loop}
          onChange={(v) => updateSettings({ loop: v })}
        />
        <Toggle
          label="Muted"
          checked={settings.muted}
          onChange={(v) => updateSettings({ muted: v })}
        />
        <Select<VideoSettings["preload"]>
          label="Preload"
          value={settings.preload}
          onChange={(v) => updateSettings({ preload: v })}
          options={[
            { value: "metadata", label: "Metadata" },
            { value: "auto", label: "Auto (full)" },
            { value: "none", label: "None" },
          ]}
        />
        <button
          type="button"
          onClick={() => resetSettings()}
          className="btn w-full mt-2"
        >
          Reset to defaults
        </button>
      </SettingsPopover>
    </div>
  );
}

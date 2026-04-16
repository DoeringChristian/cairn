import { useMemo, useRef, useState } from "react";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { useCardSettings } from "../lib/card-settings";
import CardHeader from "./CardHeader";
import SettingsPopover from "./SettingsPopover";
import Toggle from "./settings/Toggle";
import type { SequenceMeta } from "../api/types";

interface Props {
  runId: string;
  metric: SequenceMeta;
}

interface AudioMeta {
  sample_rate: number;
  duration: number;
  channels: number;
  peaks: number[];
  num_samples: number;
}

interface AudioSettings {
  version: 1;
  autoplay: boolean;
}

const DEFAULT_AUDIO_SETTINGS: AudioSettings = { version: 1, autoplay: false };

const ACCENT = "#539bf5";

function Waveform({ peaks }: { peaks: number[] }) {
  // Fixed viewBox so the SVG scales cleanly to any width. Bars are centered
  // vertically, mirrored above and below the midline, height proportional to
  // the peak value (already normalized to [0,1]).
  const width = 320;
  const height = 48;
  const n = peaks.length;
  if (n === 0) return null;
  const slot = width / n;
  const barW = Math.max(1, slot * 0.7);
  const mid = height / 2;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-12 w-full"
      aria-hidden="true"
    >
      {peaks.map((p, i) => {
        const clamped = Math.max(0, Math.min(1, p));
        const h = clamped * mid;
        const x = i * slot + (slot - barW) / 2;
        return (
          <rect
            key={i}
            x={x}
            y={mid - h}
            width={barW}
            height={h * 2}
            fill={ACCENT}
          />
        );
      })}
    </svg>
  );
}

export default function AudioPlayerCard({ runId, metric }: Props) {
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

  const meta = useMemo(
    () => safeJsonParse<AudioMeta>(current?.artifact_metadata),
    [current],
  );

  const [settings, updateSettings, resetSettings] = useCardSettings<AudioSettings>(
    {
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    },
    DEFAULT_AUDIO_SETTINGS,
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
          <div className="rounded bg-bg p-2">
            {meta?.peaks && meta.peaks.length > 0 ? (
              <Waveform peaks={meta.peaks} />
            ) : (
              <div className="h-12" />
            )}
            <audio
              key={current.artifact_hash}
              controls
              autoPlay={settings.autoplay}
              src={api.artifactUrl(current.artifact_hash)}
              className="mt-2 w-full"
            />
            {meta && (
              <div className="mono mt-1 text-xs text-fg-subtle">
                {`${meta.sample_rate} Hz · ${meta.duration}s · ${
                  meta.channels === 1
                    ? "mono"
                    : meta.channels === 2
                      ? "stereo"
                      : `${meta.channels}ch`
                }`}
              </div>
            )}
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
        <div className="text-sm text-fg-muted">no audio logged yet</div>
      )}
      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        anchorRef={settingsBtnRef}
        title="Audio"
      >
        <Toggle
          label="Autoplay"
          checked={settings.autoplay}
          onChange={(v) => updateSettings({ autoplay: v })}
          description="Play the clip automatically when the card loads"
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
